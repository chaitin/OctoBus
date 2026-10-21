# Instance lifecycle: leak reconciliation and the scale-to-zero runtime mode

> Renamed from "scale-to-zero" before release: the mode's contract is that idle means
> zero processes, and scale-to-zero is the established term for it. This
> document uses the final name throughout.

Two problems share one infrastructure: repeated whole-package syncs leak Node
processes, and on-demand instances pay a cold start on every call. This document
is the state machine the implementation follows; it is the source of truth for
the transitions, not the code.

## Problem 1: sync leaks resident processes

`CreateInstance` upserts the full instance row on every call, and `Start`
overwrites `procs[instanceID]` without stopping the previous process. The
replaced `processState` is never killed or waited on: the old Node process
outlives the supervisor's knowledge of it. Every whole-package sync calls
`CreateInstance` once per sync instance, so every sync leaks one process per
instance (observed: +10 processes per sync in staging and production).

Fix, in layers:

1. **Update semantics** (correctness). `CreateInstance` on an existing instance
   no longer overwrites the row blind. It compares the incoming config/secret
   (by SHA-256), name, service binding and runtime mode with the stored row:

   - nothing changed: return the stored instance untouched. No process work.
   - changed: update the row (preserving `Enabled`, `Status`, `PID`,
     `CreatedAt`), write the config file, then:
     - effective mode unchanged, instance has a resident process: restart it to
       load the new config/secret.
     - effective mode unchanged, no resident process: nothing else.
     - effective mode changed: run the mode transition (below).

   A manually stopped instance stays stopped: sync updates what the package
   defines, it does not flip operator intent (`Enabled`).

2. **Reconciliation** (backstop). `ReconcileProcesses` runs every
   `OCTOBUS_RECONCILE_INTERVAL` (default 5m) and converges three drift classes:

   | Class | Definition | Action |
   |---|---|---|
   | orphan | a serve-shaped process claiming our `OCTOBUS_INSTANCE_ID` and cwd under our data dir, whose instance is not tracked (or whose pid is not the tracked one) | SIGKILL the pid, log `reconcile_orphan_killed` |
   | missing | DB row enabled + effective long-running, status claims liveness (`starting`/`running`/`degraded`), but no tracked process | start it, log `reconcile_missing_restarted` |
   | surplus | tracked process whose row is disabled or effective on-demand | stop it, log `reconcile_surplus_stopped` |

   Orphans are identified by `/proc`: environ must claim the instance id, cwd
   must resolve inside this daemon's `instances/<id>` workdir (a second daemon
   on the same host claims the same env var but not the cwd), and argv must be
   serve-shaped (`--runtime serve`). Processes younger than a 60s grace window
   are skipped: a start in flight is tracked within microseconds of
   `cmd.Start`, so anything untracked and young is either that window or a
   future reconcile's business. The pid is signalled directly, never by group:
   at hardening level `off` the runtime shares the daemon's process group, and
   a group signal would kill the daemon.

   Stale rows (pid dead, status claims liveness, no tracked process) are
   repaired to `stopped` with `Enabled` preserved before missing-recovery runs,
   so a scale-to-zero row left running by a `kill -9` comes back cold instead of
   being
   "recovered" as a phantom.

3. **Concurrency** (idempotence). Every instance gains a per-instance gate. The
   public operations (`CreateInstance`, `Start`, `Stop`, `Restart`,
   `SetRuntimeMode`, `EnsureStarted`, `UpdateConfig`, `UpdateSecret`) hold it
   for their whole body; internal helpers (`startLocked`, `stopLocked`,
   `restartLocked`) require the caller to hold it. Lock order is gate →
   `s.mu`; nothing under `s.mu` takes a gate. A repeated `CreateInstance` with
   identical config/secret is now a read, so sync races with manual operations
   converge on last intent instead of stacking processes.

## Problem 2: on-demand cold starts

93–95% of production calls to manual instances land within 10 minutes of the
previous call, while every call pays ~450ms of cold start. The `scale-to-zero` runtime
mode keeps a resident `serve` process warm between calls and stops it after an
idle timeout.

### Runtime modes

| Mode | Process model | Start allowed | Stop allowed |
|---|---|---|---|
| `long-running` | resident, supervisor-restarted on exit | yes | yes |
| `on-demand` | one process per call (`invoke`) | rejected | rejected |
| `scale-to-zero` | resident, started on first call, stopped when idle | yes (warms) | yes |

`scale-to-zero` is accepted wherever a runtime mode is validated (service
manifests and instance overrides). An instance override still wins over the service mode.

Create semantics differ per mode: a new on-demand instance is created
enabled and logically running (no process to start), a new scale-to-zero instance is
created enabled and stopped (`start` would warm it immediately, defeating the
mode for bulk syncs), and a new long-running instance honors `start`. A
service import restarts warm scale-to-zero instances in place but leaves cold ones
cold: waking every scale-to-zero instance of a service is what traffic is for, not
imports.

### Instance states (DB row)

The row keeps its existing fields; `scale-to-zero` adds no column. The state of a scale-to-zero
instance is:

| State | `Enabled` | `Status` | `PID` | Meaning |
|---|---|---|---|---|
| cold | true | `stopped` | nil | will start on next call |
| warm | true | `running` | set | resident process serving calls |
| disabled | false | `stopped` | nil | operator stopped it; calls fail |
| degraded | true | `degraded` | nil | warm process exited unexpectedly; next call restarts |

In-memory only: `lastActivity[id]` (LRU + idle clock), `refs[id]` (active
requests, see below). Both live in the supervisor, guarded by `s.mu`.

### Transitions

| From \ To | cold | warm | disabled | degraded |
|---|---|---|---|---|
| cold | — | `EnsureStarted` (call), `Start` | operator `Stop` | — |
| warm | idle TTL (no refs), LRU eviction (no refs), daemon shutdown | — | operator `Stop` | process exit (crash) |
| disabled | — | admin `Start` | — | — |
| degraded | row repaired to cold by reconcile | `EnsureStarted` (call), `Start` | operator `Stop` | — |

Warm → cold by idle or LRU runs `stopProcess(inst, enabled=true)`: the row
keeps `Enabled=true` and returns to `stopped`, so the next call starts the
instance again. A manual `Stop` passes `enabled=false` — that distinction is
what separates "parked by the supervisor" from "stopped by an operator", and it
is why the two paths must not share an enabled value.

A warm scale-to-zero instance whose process exits on its own is **not** auto-restarted
(unlike long-running): `wait` marks it `degraded` and stops there. Restart-on-
exit would fight the idle stopper and spin processes nobody is calling. The
next call goes through `EnsureStarted`, which treats any untracked state as
startable.

### Mode transitions (`SetRuntimeMode`, service mode changes, sync)

| Before → After | Process action |
|---|---|
| long-running → on-demand | stop resident; row becomes enabled/running/no pid (existing behavior) |
| long-running → scale-to-zero | keep resident running (the process is the same) |
| scale-to-zero → long-running | warm: keep running; cold: start if enabled |
| on-demand → scale-to-zero | normalize fake-running row to cold (enabled/`stopped`/no pid); no start |
| scale-to-zero → on-demand | stop resident if warm; row becomes enabled/running/no pid |
| on-demand → long-running | start if enabled (existing behavior, incl. rollback on failure) |

`RecoverEnabled` at daemon start still starts only effective long-running
instances: scale-to-zero instances come back cold after a restart. That is deliberate —
restarting every scale-to-zero instance at boot would reintroduce the memory profile
scale-to-zero exists to remove.

### EnsureStarted (the hot path)

```
EnsureStarted(ctx, id):
  hold gate(id)                                  // singleflight: N callers, one start
  if procs[id] exists: lastActivity[id]=now; hot hit; return nil
  row := DB[id]; must be Enabled, else Unavailable
  lastActivity[id]=now; count cold start
  return startLocked(ctx, id)                    // full health-checked start (≤5s)
```

Concurrent first calls queue on the gate and return once the winner finishes;
second-and-later callers see the tracked process and return in microseconds.
Because the gate is per instance, one instance's 5s start never delays another.

The winning caller's request does not drive the start: the start runs on a
context detached from it (bounded by the start's own health timeout). A caller
that hangs up mid-start therefore cannot kill the process everyone else is
queued for, and queued callers see the start's real outcome instead of someone
else's cancellation. The cost is a start nobody waits for, capped at the
health-check window; the alternative — failing every queued caller on one
disconnect — punishes exactly the concurrency the singleflight exists to
merge.

The gateway calls `EnsureStarted` from `invokeRaw` and `newBackendStream` when
the effective mode is `scale-to-zero`, then follows the existing long-running backend
path (cached `g.conns` connection, raw codec). `OnInstanceChanged` already
invalidates cached connections on stop, so a re-warmed instance gets a fresh
connection automatically.

### Idle stopper and LRU (one scan loop)

Every scan (interval = clamp(TTL/4, 1s, 1m); TTL default 15m from
`OCTOBUS_SCALE_TO_ZERO_IDLE_TTL`):

1. Re-check under the instance gate before stopping: if `lastActivity` was
   refreshed past the TTL decision or `refs > 0`, skip.
2. Idle: warm scale-to-zero instance with `now - lastActivity > TTL` and no refs → stop
   (warm → cold), log `scale_to_zero_idle_stopped`.
3. LRU: while warm scale-to-zero count > `OCTOBUS_SCALE_TO_ZERO_MAX_INSTANCES` (default 32, env
   `OCTOBUS_SCALE_TO_ZERO_MAX_INSTANCES`): stop the instance with the oldest
   `lastActivity` among those with no refs, log `scale_to_zero_lru_evicted`.

`refs` counts in-flight requests. Unary calls acquire around the backend call;
streaming proxies acquire from `newBackendStream` until the proxy returns. A
live stream therefore cannot be idled out even if no message flows for longer
than the TTL; per-message `TouchInstance` calls keep LRU ordering honest for
long-lived streams.

### Shutdown

`Shutdown` stops warm scale-to-zero instances (tracked or pid-set) alongside
long-running ones, so no resident process outlives the daemon. Cold scale-to-zero rows
are left alone.

## Counters and logs

The supervisor counts, and logs at each event plus one summary line per
reconcile pass: scale-to-zero cold starts, scale-to-zero hot hits, idle stops, LRU evictions,
orphans killed, missing restarts, surplus stops. There is no Prometheus
endpoint in the daemon today; structured logs are the metrics surface until
one exists.

## Deliberate deviations from the original proposal

- The proposal had the sync path call `EnsureInstanceStopped` before
  `CreateInstance`. With update semantics that is redundant and would blip
  every healthy instance on every sync; a restart happens only when
  config/secret actually changed.
- The proposal mentioned a per-instance `lockInstance` that does not exist in
  the code; the gate is that lock, introduced here.
- Idle stop reuses `stopProcess` with `enabled=true` rather than inventing a
  third stop flavor; the enabled bit is the parking-vs-operator distinction.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `OCTOBUS_SCALE_TO_ZERO_IDLE_TTL` | `15m` | warm idle duration before the stopper parks a scale-to-zero instance |
| `OCTOBUS_SCALE_TO_ZERO_MAX_INSTANCES` | `32` | warm scale-to-zero instance cap; overflow evicted LRU |
| `OCTOBUS_RECONCILE_INTERVAL` | `5m` | period of `ReconcileProcesses` |

## Test plan

Unit (supervisor): create-update idempotence, mode transition matrix, warm→cold
on idle TTL, LRU eviction, refs blocking idle stop, EnsureStarted
singleflight under concurrency, degraded-then-recall, wait() not restarting
scale-to-zero, reconcile orphan/missing/surplus against real child processes.

E2E (real daemon, real fixture services): repeated instance create does not
grow the process count; scale-to-zero cold start → hot call → idle stop → recall;
concurrent calls produce one start; daemon shutdown leaves no node processes.

Manual verification on this machine mirrors the production incident: import a
fixture, re-run the create call N times, count node processes before/after.
