package supervisor

import (
	"bytes"
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"octobus/internal/domain"
)

const (
	// orphanGrace skips processes too young to judge. A start registers its
	// process in procs within microseconds of cmd.Start, so anything untracked
	// and young is either that registration window or a future pass's business.
	orphanGrace = 60 * time.Second
	// maxOrphansPerPass bounds one reconcile pass. A pathological daemon
	// (hundreds of orphans) converges over passes instead of signaling a
	// pid range in one sweep.
	maxOrphansPerPass = 32
)

// ReconcileProcesses converges real runtime processes with supervisor state.
// It is the backstop that catches every path the earlier layers miss: a sync
// leak from an older daemon, a stop that timed out, a kill -9 that left stale
// rows, a crash whose restart raced a manual stop.
//
// Drift classes:
//
//   - orphan: a serve-shaped process whose OCTOBUS_INSTANCE_ID env claims an
//     instance this supervisor does not track (or whose pid differs from the
//     tracked one), with a cwd inside this daemon's instance workdirs. Killed.
//   - stale row: a DB row whose status claims liveness but whose pid is dead
//     and which this supervisor does not track. Repaired to stopped before
//     recovery runs, so recovery does not resurrect a phantom.
//   - missing: an enabled long-running row with no tracked process and no live
//     pid after stale repair. Restarted per RecoverEnabled semantics.
//   - surplus: a tracked process whose row is disabled or effectively
//     on-demand. Stopped.
func (s *Supervisor) ReconcileProcesses(ctx context.Context) {
	if s.DataDir == "" {
		return
	}
	logger := s.logger()
	now := time.Now()

	live := map[int]serveProcess{}
	if runtime.GOOS == "linux" {
		live = s.listServeProcesses()
	} else {
		// Row repair and surplus stops below still work; only process
		// attribution needs /proc. Say so once instead of warning every pass.
		s.warnOrphanScanUnavailable(logger)
	}

	// --- orphans ---------------------------------------------------------
	orphans := 0
	grace := s.orphanGraceForTest
	if grace <= 0 {
		grace = orphanGrace
	}
	for pid, info := range live {
		if !info.exact || now.Sub(info.start) < grace {
			continue
		}
		s.mu.Lock()
		state := s.procs[info.instanceID]
		tracked := state != nil && state.cmd.Process != nil && state.cmd.Process.Pid == pid
		s.mu.Unlock()
		if tracked {
			continue
		}
		if orphans >= maxOrphansPerPass {
			logger.Warn("reconcile_orphan_deferred", "instance_id", info.instanceID, "pid", pid)
			continue
		}
		orphans++
		// Re-read the start time before signalling: a scanned process that
		// exited in the meantime may have had its pid recycled, and the
		// signal would land on an unrelated process. A mismatch (or a
		// vanished /proc entry) skips the kill; the next pass re-scans and
		// decides afresh.
		if cur, ok := pidStart(pid); !ok || cur != info.start {
			continue
		}
		// Signal the pid directly, never the group: at hardening level off the
		// runtime shares the daemon's process group, and a group signal would
		// kill the daemon itself.
		if err := killPID(pid); err != nil {
			logger.Warn("reconcile_orphan_kill_failed", "instance_id", info.instanceID, "pid", pid, "error", err)
			continue
		}
		s.mu.Lock()
		s.counters.OrphansKilled++
		s.mu.Unlock()
		logger.Warn("reconcile_orphan_killed", "instance_id", info.instanceID, "pid", pid)
	}

	// --- tracked processes vs rows ---------------------------------------
	instances, err := s.Store.ListInstances(ctx)
	if err != nil {
		logger.Warn("reconcile_list_instances_failed", "error", err)
		return
	}
	byID := make(map[string]domain.Instance, len(instances))
	for _, inst := range instances {
		byID[inst.ID] = inst
	}

	s.mu.Lock()
	trackedIDs := make([]string, 0, len(s.procs))
	for id := range s.procs {
		trackedIDs = append(trackedIDs, id)
	}
	s.mu.Unlock()

	// --- surplus: tracked but the row says it must not run ---------------
	for _, id := range trackedIDs {
		inst, ok := byID[id]
		if !ok {
			// The row was deleted under us; DeleteInstance stops the process
			// itself, so a tracker here is a race the next pass settles.
			continue
		}
		svc, err := s.Store.GetService(ctx, inst.ServiceID)
		if err != nil {
			continue
		}
		if inst.Enabled && residentMode(domain.EffectiveRuntimeMode(svc, inst)) {
			continue
		}
		stopped := false
		err = s.withGate(id, func() error {
			inst, err := s.Store.GetInstance(ctx, id)
			if err != nil {
				return err
			}
			svc, err := s.Store.GetService(ctx, inst.ServiceID)
			if err != nil {
				return err
			}
			s.mu.Lock()
			tracked := s.procs[id] != nil
			s.mu.Unlock()
			if !tracked || (inst.Enabled && residentMode(domain.EffectiveRuntimeMode(svc, inst))) {
				return nil
			}
			stopErr := s.stopProcess(ctx, inst, inst.Enabled)
			if stopErr == nil {
				stopped = true
			}
			// Only an on-demand row has no stopped state: it serves enabled
			// and running with no process, so the stop must land it there or
			// the gateway answers Unavailable. A disabled resident row keeps
			// its operator stop -- normalizing it would re-enable the
			// instance and the next pass would start it right back.
			if domain.EffectiveRuntimeMode(svc, inst) == domain.RuntimeModeOnDemand {
				if err := s.landOnDemandRow(ctx, id, inst.RuntimeMode); err != nil {
					logger.Warn("reconcile_surplus_normalize_failed", "instance_id", id, "error", err)
				}
			}
			return stopErr
		})
		if err != nil {
			logger.Warn("reconcile_surplus_stop_failed", "instance_id", id, "error", err)
		} else if stopped {
			s.mu.Lock()
			s.counters.SurplusStopped++
			s.mu.Unlock()
			logger.Warn("reconcile_surplus_stopped", "instance_id", id)
		}
	}

	// --- stale rows, then missing ----------------------------------------
	// A stale row is a liveness claim with no live process. Every resident
	// mode can carry one (a kill -9 leaves a scale-to-zero row claiming
	// running too), so repair all of them; only long-running rows are then
	// restarted.
	var scaleToZeroStale []string
	var missings []string
	for _, inst := range instances {
		if !inst.Enabled || !claimsLiveness(inst.Status) {
			continue
		}
		svc, err := s.Store.GetService(ctx, inst.ServiceID)
		if err != nil {
			continue
		}
		mode := domain.EffectiveRuntimeMode(svc, inst)
		if !residentMode(mode) {
			continue
		}
		s.mu.Lock()
		tracked := s.procs[inst.ID] != nil
		s.mu.Unlock()
		if tracked {
			continue
		}
		if inst.PID != nil && pidAlive(*inst.PID) && pidOwnedByInstance(*inst.PID, inst.ID) {
			continue
		}
		if mode == domain.RuntimeModeLongRunning {
			missings = append(missings, inst.ID)
		} else {
			scaleToZeroStale = append(scaleToZeroStale, inst.ID)
		}
	}

	for _, id := range scaleToZeroStale {
		err := s.withGate(id, func() error {
			inst, err := s.Store.GetInstance(ctx, id)
			if err != nil {
				return err
			}
			svc, err := s.Store.GetService(ctx, inst.ServiceID)
			if err != nil {
				return err
			}
			if !inst.Enabled || !claimsLiveness(inst.Status) ||
				domain.EffectiveRuntimeMode(svc, inst) != domain.RuntimeModeScaleToZero {
				return nil
			}
			// A degraded row has no pid left to probe: the exit watcher wrote
			// degraded with PID=nil, and that is exactly the shape the repair
			// exists for. Only a live pid that still claims this instance
			// means someone else owns the row.
			if inst.PID != nil && pidAlive(*inst.PID) && pidOwnedByInstance(*inst.PID, id) {
				return nil
			}
			s.mu.Lock()
			tracked := s.procs[id] != nil
			s.mu.Unlock()
			if tracked {
				return nil
			}
			inst.PID = nil
			inst.ListenAddr = ""
			inst.Status = domain.StatusStopped
			if err := s.Store.UpsertInstance(ctx, inst); err != nil {
				return err
			}
			s.notifyInstanceChanged(id)
			logger.Warn("reconcile_stale_row_repaired", "instance_id", id)
			return nil
		})
		if err != nil {
			logger.Warn("reconcile_stale_row_repair_failed", "instance_id", id, "error", err)
		}
	}

	for _, id := range missings {
		restarted := false
		err := s.withGate(id, func() error {
			// Re-read and re-verify inside the gate: the snapshot predates it,
			// and an operator Stop (or a mode change) that landed in between
			// must win -- recovering over it would silently undo the stop.
			inst, err := s.Store.GetInstance(ctx, id)
			if err != nil {
				return err
			}
			svc, err := s.Store.GetService(ctx, inst.ServiceID)
			if err != nil {
				return err
			}
			if !inst.Enabled || !claimsLiveness(inst.Status) ||
				domain.EffectiveRuntimeMode(svc, inst) != domain.RuntimeModeLongRunning {
				return nil
			}
			// Repair the stale row first so recovery does not race its own
			// UpsertInstance during start. A pid that is alive but no longer
			// claims this instance is a recycled pid: clear it so the restart
			// below writes a real one.
			if inst.PID != nil && !(pidAlive(*inst.PID) && pidOwnedByInstance(*inst.PID, id)) {
				inst.PID = nil
				inst.ListenAddr = ""
				inst.Status = domain.StatusStopped
				if err := s.Store.UpsertInstance(ctx, inst); err != nil {
					return err
				}
			}
			s.mu.Lock()
			tracked := s.procs[id] != nil
			s.mu.Unlock()
			if tracked {
				return nil
			}
			restarted = true
			return s.startLocked(ctx, id)
		})
		if err != nil {
			logger.Warn("reconcile_missing_restart_failed", "instance_id", id, "error", err)
			continue
		}
		if restarted {
			s.mu.Lock()
			s.counters.MissingRestarted++
			s.mu.Unlock()
			logger.Warn("reconcile_missing_restarted", "instance_id", id)
		}
	}

	s.mu.Lock()
	s.counters.ReconcilePasses++
	passes := s.counters.ReconcilePasses
	orphansKilled := s.counters.OrphansKilled
	missingRestarted := s.counters.MissingRestarted
	surplusStopped := s.counters.SurplusStopped
	s.mu.Unlock()
	logger.Info("reconcile_pass_done",
		"passes", passes,
		"orphans", orphans,
		"orphans_killed_total", orphansKilled,
		"missing", len(missings),
		"missing_restarted_total", missingRestarted,
		"surplus_stopped_total", surplusStopped,
		"tracked", len(trackedIDs),
		"instances", len(instances))
}

// claimsLiveness reports whether a row status says a process should exist. A
// failed start is included: nothing else retries it, and an enabled
// long-running instance that failed its health check must be recovered by this
// backstop (a scale-to-zero failed row is repaired to cold instead).
func claimsLiveness(status domain.InstanceStatus) bool {
	switch status {
	case domain.StatusStarting, domain.StatusRunning, domain.StatusDegraded, domain.StatusFailed:
		return true
	}
	return false
}

// residentMode reports whether a mode keeps a resident process that the row's
// enabled bit allows: long-running always, scale-to-zero while warm. The
// reconcile surplus pass must not treat a warm scale-to-zero process as
// surplus -- parking them is the scale-to-zero scan's job, on its TTL, not
// the reconcile's.
func residentMode(mode domain.RuntimeMode) bool {
	return mode == domain.RuntimeModeLongRunning || mode == domain.RuntimeModeScaleToZero
}

// pidAlive reports whether pid names a live process. A zombie counts as alive:
// it still occupies the slot the row recorded, and the exit watcher owns its
// reaping.
func pidAlive(pid int) bool {
	return killPIDProbe(pid) == nil
}

// warnOrphanScanUnavailable reports once that the orphan backstop cannot
// attribute processes on this platform.
func (s *Supervisor) warnOrphanScanUnavailable(logger *slog.Logger) {
	s.mu.Lock()
	warned := s.procScanWarned
	s.procScanWarned = true
	s.mu.Unlock()
	if !warned {
		logger.Info("reconcile_orphan_scan_unavailable", "goos", runtime.GOOS, "reason", "process attribution requires /proc")
	}
}

// instanceIDFromEnviron returns the OCTOBUS_INSTANCE_ID value in a /proc
// environ blob. Attribution and pid-identity checks share this so the two
// cannot disagree about who owns a pid.
func instanceIDFromEnviron(raw []byte) (string, bool) {
	for _, kv := range bytes.Split(raw, []byte{0}) {
		if key, value, ok := strings.Cut(string(kv), "="); ok && key == "OCTOBUS_INSTANCE_ID" {
			return value, true
		}
	}
	return "", false
}

// pidOwnedByInstance reports whether a live pid still belongs to the instance:
// on linux its environ must claim the instance id, so a recycled pid that
// reads as alive no longer pins the row. Platforms without /proc answer true,
// degrading the caller to the plain pidAlive probe.
func pidOwnedByInstance(pid int, instanceID string) bool {
	if runtime.GOOS != "linux" {
		return true
	}
	raw, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/environ")
	if err != nil {
		// Gone, or owned by another user: either way not provably ours.
		return false
	}
	value, ok := instanceIDFromEnviron(raw)
	return ok && value == instanceID
}

// pidStart re-reads a process's start time for the kill re-check. ok is false
// when the process is gone or its stat cannot be parsed.
func pidStart(pid int) (time.Time, bool) {
	raw, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat")
	if err != nil {
		return time.Time{}, false
	}
	return processStartTime(raw)
}

// serveProcess is one live runtime process found on the host.
type serveProcess struct {
	instanceID string
	start      time.Time
	// exact reports whether start comes from a parseable /proc stat record.
	// Only exact processes are kill candidates: an unparseable one stays
	// grace-protected forever rather than guessed at.
	exact bool
}

// listServeProcesses returns the live, serve-shaped runtime processes this
// daemon can attribute, keyed by pid. A process qualifies when its environ
// carries OCTOBUS_INSTANCE_ID, its cwd resolves inside this daemon's
// instances/<id> workdir (a second daemon on the host claims the same env but
// not the cwd), and its argv is serve-shaped. Unattributable processes are
// left alone: the supervisor never kills what it cannot prove is its own.
func (s *Supervisor) listServeProcesses() map[int]serveProcess {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		s.logger().Warn("reconcile_proc_scan_failed", "error", err)
		return nil
	}
	out := make(map[int]serveProcess)
	// Resolved instance workdirs, memoized per pass: every serve process of
	// one instance shares the same workdir, and EvalSymlinks is not cheap.
	workdirs := make(map[string]string)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		pid, err := strconv.Atoi(entry.Name())
		if err != nil || pid == os.Getpid() {
			continue
		}
		info, ok := inspectServeProcess(pid, s.DataDir, workdirs)
		if ok {
			out[pid] = info
		}
	}
	return out
}

// inspectServeProcess attributes one pid, or reports that it is not ours.
// workdirs memoizes EvalSymlinks results per instance id across the scan.
func inspectServeProcess(pid int, dataDir string, workdirs map[string]string) (serveProcess, bool) {
	envRaw, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/environ")
	if err != nil {
		return serveProcess{}, false
	}
	instanceID, ok := instanceIDFromEnviron(envRaw)
	if !ok || instanceID == "" {
		return serveProcess{}, false
	}
	if err := domain.ValidateID("instance", instanceID); err != nil {
		return serveProcess{}, false
	}
	cwd, err := os.Readlink("/proc/" + strconv.Itoa(pid) + "/cwd")
	if err != nil {
		return serveProcess{}, false
	}
	workdir, ok := workdirs[instanceID]
	if !ok {
		resolved, err := filepath.EvalSymlinks(filepath.Join(dataDir, "instances", instanceID))
		if err != nil {
			return serveProcess{}, false
		}
		workdirs[instanceID] = resolved
		workdir = resolved
	}
	// Accept the workdir and anything below it. A runtime that leaves the
	// workdir entirely is not attributed: the supervisor only kills what it
	// can prove belongs to this instance.
	if !withinDir(workdir, cwd) {
		return serveProcess{}, false
	}
	argvRaw, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/cmdline")
	if err != nil {
		return serveProcess{}, false
	}
	if !isServeArgv(bytes.Split(argvRaw, []byte{0})) {
		return serveProcess{}, false
	}
	stat, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat")
	if err != nil {
		return serveProcess{}, false
	}
	start, exact := processStartTime(stat)
	if !exact {
		// Unparseable start time: report it as brand-new so the grace window
		// protects the process, and mark it inexact so the killer never
		// trusts its identity.
		start = time.Now()
	}
	return serveProcess{instanceID: instanceID, start: start, exact: exact}, true
}

// isServeArgv reports whether argv matches the runtime's serve invocation
// (--runtime serve). Invoke processes are deliberately not matched: they live
// for one call and are bounded by the gateway.
func isServeArgv(argv [][]byte) bool {
	for i, arg := range argv {
		if string(arg) == "--runtime" && i+1 < len(argv) && string(argv[i+1]) == "serve" {
			return true
		}
	}
	return false
}

// processStartTime extracts field 22 (starttime, in clock ticks since boot)
// from a /proc/<pid>/stat record. The comm field may contain spaces and
// parentheses, so parsing starts after its closing parenthesis. ok is false
// on any parse failure: the caller then treats the process as brand new for
// the grace window and never trusts its identity.
func processStartTime(stat []byte) (time.Time, bool) {
	i := bytes.LastIndexByte(stat, ')')
	if i < 0 || i+2 >= len(stat) {
		return time.Time{}, false
	}
	fields := strings.Fields(string(stat[i+2:]))
	// fields[0] is state (field 3); starttime is field 22, i.e. index 19 here.
	if len(fields) < 20 {
		return time.Time{}, false
	}
	ticks, err := strconv.ParseInt(fields[19], 10, 64)
	if err != nil {
		return time.Time{}, false
	}
	btime := bootTime()
	if btime.IsZero() {
		return time.Time{}, false
	}
	// Multiply by one tick (10ms) rather than by a second: ticks * 1e9
	// overflows int64 once uptime passes ~2.9 years, which silently breaks
	// the grace window and stops orphan reaping on long-lived hosts.
	return btime.Add(time.Duration(ticks) * (time.Second / clockTickHz)), true
}

// withinDir reports whether path is dir itself or lies below it.
func withinDir(dir, path string) bool {
	rel, err := filepath.Rel(dir, path)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
}

// clockTickHz is the userspace ABI value on Linux (sysconf(_SC_CLK_TCK)); the
// kernel exports /proc/stat starttime in these units and the value has been
// fixed at 100 for as long /proc has existed.
const clockTickHz = 100

// bootTime returns the kernel boot time, read once: /proc/stat's btime is
// constant for the life of the boot, and the orphan scan would otherwise
// re-read and re-parse the file once per attributed process. A failed first
// read stays failed (the scan then grace-protects everything) until the next
// daemon start, which matches the scan's fail-safe posture.
var (
	btimeOnce  sync.Once
	btimeValue time.Time
)

func bootTime() time.Time {
	btimeOnce.Do(func() {
		raw, err := os.ReadFile("/proc/stat")
		if err != nil {
			return
		}
		for _, line := range strings.Split(string(raw), "\n") {
			if btime, ok := strings.CutPrefix(line, "btime "); ok {
				seconds, err := strconv.ParseInt(strings.TrimSpace(btime), 10, 64)
				if err != nil {
					return
				}
				btimeValue = time.Unix(seconds, 0)
			}
		}
	})
	return btimeValue
}
