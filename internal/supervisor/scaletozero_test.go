package supervisor

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"sync"
	"syscall"
	"testing"
	"time"

	"octobus/internal/domain"
	"octobus/internal/store"
)

// setupScaleToZeroRuntime prepares a service whose mode is scale-to-zero and
// a helper entry
// that passes health checks.
func setupScaleToZeroRuntime(t *testing.T) (string, *store.Store) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is unix-only")
	}
	dataDir, st, _ := setupSupervisorHelperRuntime(t)
	ctx := context.Background()
	svc, err := st.GetService(ctx, "echo")
	if err != nil {
		t.Fatal(err)
	}
	svc.RuntimeMode = domain.RuntimeModeScaleToZero
	if err := st.UpsertService(ctx, svc); err != nil {
		t.Fatal(err)
	}
	return dataDir, st
}

func TestScaleToZeroEnsureStartedAndReuse(t *testing.T) {
	dataDir, st := setupScaleToZeroRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "stz-one", ServiceID: "echo", Config: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if sup.TracksInstance("stz-one") {
		t.Fatal("scale-to-zero instance must come cold")
	}
	release, err := sup.EnsureStarted(ctx, "stz-one")
	if err != nil {
		t.Fatal(err)
	}
	if !sup.TracksInstance("stz-one") {
		t.Fatal("EnsureStarted did not warm the instance")
	}
	release()
	release2, err := sup.EnsureStarted(ctx, "stz-one")
	if err != nil {
		t.Fatal(err)
	}
	release2()
	sup.mu.Lock()
	cold, hot := sup.counters.ScaleToZeroColdStarts, sup.counters.ScaleToZeroHotHits
	sup.mu.Unlock()
	if cold != 1 || hot != 1 {
		t.Fatalf("cold=%d hot=%d want 1/1", cold, hot)
	}
	_ = sup.Stop(ctx, "stz-one")
}

func TestScaleToZeroEnsureStartedConcurrentSingleflight(t *testing.T) {
	dataDir, st := setupScaleToZeroRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "stz-many", ServiceID: "echo"}); err != nil {
		t.Fatal(err)
	}
	const callers = 8
	start := make(chan struct{})
	var wg sync.WaitGroup
	errs := make([]error, callers)
	for i := 0; i < callers; i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			release, err := sup.EnsureStarted(ctx, "stz-many")
			if err == nil {
				release()
			}
			errs[i] = err
		}()
	}
	close(start)
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("caller %d: %v", i, err)
		}
	}
	sup.mu.Lock()
	cold := sup.counters.ScaleToZeroColdStarts
	sup.mu.Unlock()
	if cold != 1 {
		t.Fatalf("cold starts=%d want 1 (singleflight failed)", cold)
	}
	_ = sup.Stop(ctx, "stz-many")
}

func TestScaleToZeroIdleStopThenRecall(t *testing.T) {
	dataDir, st := setupScaleToZeroRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "stz-idle", ServiceID: "echo"}); err != nil {
		t.Fatal(err)
	}
	release, err := sup.EnsureStarted(ctx, "stz-idle")
	if err != nil {
		t.Fatal(err)
	}
	release()
	sup.mu.Lock()
	sup.lastActivity["stz-idle"] = time.Now().Add(-2 * time.Minute)
	sup.mu.Unlock()
	if !sup.parkIfStillIdle(ctx, "stz-idle", time.Now().Add(-time.Minute)) {
		t.Fatal("expected the idle instance to park")
	}
	if sup.TracksInstance("stz-idle") {
		t.Fatal("parked instance is still tracked")
	}
	inst, err := st.GetInstance(ctx, "stz-idle")
	if err != nil {
		t.Fatal(err)
	}
	if !inst.Enabled || inst.Status != domain.StatusStopped || inst.PID != nil {
		t.Fatalf("parked row must be enabled/stopped/no pid, got %+v", inst)
	}
	// The next call re-warms.
	release2, err := sup.EnsureStarted(ctx, "stz-idle")
	if err != nil {
		t.Fatal(err)
	}
	release2()
	if !sup.TracksInstance("stz-idle") {
		t.Fatal("parked instance did not re-warm")
	}
	_ = sup.Stop(ctx, "stz-idle")
}

func TestScaleToZeroRefBlocksIdleStop(t *testing.T) {
	dataDir, st := setupScaleToZeroRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "stz-ref", ServiceID: "echo"}); err != nil {
		t.Fatal(err)
	}
	release, err := sup.EnsureStarted(ctx, "stz-ref")
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	sup.mu.Lock()
	sup.lastActivity["stz-ref"] = time.Now().Add(-2 * time.Minute)
	sup.mu.Unlock()
	if sup.parkIfStillIdle(ctx, "stz-ref", time.Now().Add(-time.Minute)) {
		t.Fatal("a held ref must block the idle stop")
	}
	if !sup.TracksInstance("stz-ref") {
		t.Fatal("instance was parked despite a held ref")
	}
}

func TestScaleToZeroScanParksExpiredAndKeepsFresh(t *testing.T) {
	dataDir, st := setupScaleToZeroRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	for _, id := range []string{"stz-a", "stz-b"} {
		if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: id, ServiceID: "echo"}); err != nil {
			t.Fatal(err)
		}
		release, err := sup.EnsureStarted(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		release()
	}
	sup.mu.Lock()
	sup.lastActivity["stz-a"] = time.Now().Add(-2 * time.Minute)
	sup.lastActivity["stz-b"] = time.Now()
	sup.stzIdleTTL = time.Minute
	sup.stzMaxWarm = 0
	sup.mu.Unlock()
	sup.scanScaleToZero(ctx)
	if sup.TracksInstance("stz-a") {
		t.Fatal("expired instance was not parked")
	}
	if !sup.TracksInstance("stz-b") {
		t.Fatal("fresh instance was parked")
	}
	_ = sup.Stop(ctx, "stz-b")
}

func TestScaleToZeroLRUEviction(t *testing.T) {
	dataDir, st := setupScaleToZeroRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	warm := func(id string, age time.Duration) {
		t.Helper()
		if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: id, ServiceID: "echo"}); err != nil {
			t.Fatal(err)
		}
		release, err := sup.EnsureStarted(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		release()
		sup.mu.Lock()
		sup.lastActivity[id] = time.Now().Add(-age)
		sup.mu.Unlock()
	}
	warm("stz-old", 10*time.Minute)
	warm("stz-new", time.Minute)
	sup.mu.Lock()
	sup.stzIdleTTL = time.Hour
	sup.stzMaxWarm = 1
	sup.mu.Unlock()
	sup.scanScaleToZero(ctx)
	if sup.TracksInstance("stz-old") {
		t.Fatal("LRU did not evict the oldest warm instance")
	}
	if !sup.TracksInstance("stz-new") {
		t.Fatal("LRU evicted the recently used instance")
	}
	_ = sup.Stop(ctx, "stz-new")
}

func TestScaleToZeroWaitDoesNotRestartAfterExit(t *testing.T) {
	dataDir, st := setupScaleToZeroRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "stz-exit", ServiceID: "echo"}); err != nil {
		t.Fatal(err)
	}
	release, err := sup.EnsureStarted(ctx, "stz-exit")
	if err != nil {
		t.Fatal(err)
	}
	release()
	inst, err := st.GetInstance(ctx, "stz-exit")
	if err != nil {
		t.Fatal(err)
	}
	if inst.PID == nil {
		t.Fatal("no pid recorded")
	}
	pid := *inst.PID
	// Kill the process out from under the supervisor: the scale-to-zero wait
	// path must
	// mark degraded and stop there, never schedule a restart.
	if err := syscall.Kill(pid, syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	eventually(t, 5*time.Second, func() bool {
		got, err := st.GetInstance(ctx, "stz-exit")
		return err == nil && got.Status == domain.StatusDegraded
	})
	time.Sleep(3 * time.Second)
	if sup.TracksInstance("stz-exit") {
		t.Fatal("scale-to-zero instance was restarted after exit")
	}
}

func TestCreateInstanceRepeatedNoopDoesNotGrowProcesses(t *testing.T) {
	dataDir, st := setupScaleToZeroRuntime(t)
	ctx := context.Background()
	// The service is long-running for this test: the leak report is about
	// resident processes.
	svc, err := st.GetService(ctx, "echo")
	if err != nil {
		t.Fatal(err)
	}
	svc.RuntimeMode = domain.RuntimeModeLongRunning
	if err := st.UpsertService(ctx, svc); err != nil {
		t.Fatal(err)
	}
	sup := New(dataDir, st)
	for i := 0; i < 3; i++ {
		if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "sync-leak", ServiceID: "echo", Start: true}); err != nil {
			t.Fatal(err)
		}
	}
	if !sup.TracksInstance("sync-leak") {
		t.Fatal("instance is not running after create+start")
	}
	inst, err := st.GetInstance(ctx, "sync-leak")
	if err != nil {
		t.Fatal(err)
	}
	firstPID := *inst.PID
	// Same content again: a read, not a restart.
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "sync-leak", ServiceID: "echo", Start: true}); err != nil {
		t.Fatal(err)
	}
	after, err := st.GetInstance(ctx, "sync-leak")
	if err != nil {
		t.Fatal(err)
	}
	if after.PID == nil || *after.PID != firstPID {
		t.Fatalf("noop create restarted the process: %v -> %v", firstPID, after.PID)
	}
	// Changed config: restart in place, one process, not two.
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "sync-leak", ServiceID: "echo", Config: json.RawMessage(`{"token":"b"}`), Start: true}); err != nil {
		t.Fatal(err)
	}
	updated, err := st.GetInstance(ctx, "sync-leak")
	if err != nil {
		t.Fatal(err)
	}
	if updated.PID == nil || *updated.PID == firstPID {
		t.Fatalf("content change did not restart the process: %v -> %v", firstPID, updated.PID)
	}
	if sup.TracksInstance("sync-leak") == false {
		t.Fatal("instance untracked after restart")
	}
	_ = sup.Stop(ctx, "sync-leak")
}

func TestCreateInstanceSyncDoesNotFlipOperatorStop(t *testing.T) {
	dataDir, st, _ := setupSupervisorHelperRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "sync-stop", ServiceID: "echo"}); err != nil {
		t.Fatal(err)
	}
	if err := sup.Stop(ctx, "sync-stop"); err != nil {
		t.Fatal(err)
	}
	// The sync path re-sends the same create request; an operator stop must
	// survive it.
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "sync-stop", ServiceID: "echo"}); err != nil {
		t.Fatal(err)
	}
	inst, err := st.GetInstance(ctx, "sync-stop")
	if err != nil {
		t.Fatal(err)
	}
	if inst.Enabled || inst.Status != domain.StatusStopped {
		t.Fatalf("sync flipped operator stop: %+v", inst)
	}
}

func TestReconcileKillsOrphanServeProcess(t *testing.T) {
	dataDir, st, _ := setupSupervisorHelperRuntime(t)
	ctx := context.Background()
	svc, err := st.GetService(ctx, "echo")
	if err != nil {
		t.Fatal(err)
	}
	svc.RuntimeMode = domain.RuntimeModeLongRunning
	if err := st.UpsertService(ctx, svc); err != nil {
		t.Fatal(err)
	}
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "orphan-victim", ServiceID: "echo", Start: true}); err != nil {
		t.Fatal(err)
	}
	inst, err := st.GetInstance(ctx, "orphan-victim")
	if err != nil {
		t.Fatal(err)
	}
	goodPID := *inst.PID
	// Start a second, untracked serve process for the same instance: the shape
	// of the sync leak.
	orphanPID := startOrphanServe(t, dataDir, "orphan-victim")
	// Wait until the orphan has exec'd its final image: /proc entries for a
	// fork in flight still carry the shell's argv, and the grace window that
	// protects production starts would misread it as not-ours.
	eventually(t, 5*time.Second, func() bool {
		_, ok := inspectServeProcess(orphanPID, dataDir)
		return ok
	})
	// The grace window protects young processes; the test hook shrinks it to
	// nothing so this pass judges the fresh orphan.
	sup.orphanGraceForTest = time.Nanosecond
	sup.ReconcileProcesses(ctx)
	if !processExited(orphanPID) {
		t.Fatalf("orphan pid %d survived reconcile", orphanPID)
	}
	if !sup.TracksInstance("orphan-victim") {
		t.Fatal("tracked process was disturbed by reconcile")
	}
	_ = goodPID
	_ = sup.Stop(ctx, "orphan-victim")
}

// processExited waits until pid is gone or a zombie. The test process is the
// orphan's parent and never waits it, so an exited child lingers as a zombie:
// signal 0 still succeeds against it, and the state byte is the real answer.
func processExited(pid int) bool {
	for i := 0; i < 100; i++ {
		raw, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat")
		if err != nil {
			return true
		}
		if i := bytes.LastIndexByte(raw, ')'); i >= 0 && i+2 < len(raw) && raw[i+2] == 'Z' {
			return true
		}
		time.Sleep(20 * time.Millisecond)
	}
	return false
}

// startOrphanServe launches the helper entry with serve args but outside the
// supervisor, mimicking a leaked process. It returns the child's pid.
func startOrphanServe(t *testing.T, dataDir, instanceID string) int {
	t.Helper()
	entry := filepath.Join(dataDir, "artifacts/services/echo/runtime/fixture-entry")
	cmd := exec.Command(entry, "--runtime", "serve", "--host", "127.0.0.1", "--port", "0", "--config", filepath.Join(dataDir, "instances", instanceID, "config.json"), "--workdir", filepath.Join(dataDir, "instances", instanceID))
	cmd.Env = append(os.Environ(), "OCTOBUS_INSTANCE_ID="+instanceID, "OCTOBUS_SUPERVISOR_HELPER=1")
	cmd.Dir = filepath.Join(dataDir, "instances", instanceID)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	pid := cmd.Process.Pid
	t.Cleanup(func() { _ = cmd.Process.Kill() })
	return pid
}

func TestReconcileRepairsStaleRow(t *testing.T) {
	dataDir, st, _ := setupSupervisorHelperRuntime(t)
	ctx := context.Background()
	svc, err := st.GetService(ctx, "echo")
	if err != nil {
		t.Fatal(err)
	}
	svc.RuntimeMode = domain.RuntimeModeLongRunning
	if err := st.UpsertService(ctx, svc); err != nil {
		t.Fatal(err)
	}
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "stale-row", ServiceID: "echo", Start: true}); err != nil {
		t.Fatal(err)
	}
	// Fake a liveness claim with a dead pid: the shape of a kill -9 remnant.
	inst, err := st.GetInstance(ctx, "stale-row")
	if err != nil {
		t.Fatal(err)
	}
	_ = sup.Stop(ctx, "stale-row")
	inst.Enabled = true
	inst.Status = domain.StatusRunning
	dead := 2147483647 - 1
	inst.PID = &dead
	if err := st.UpsertInstance(ctx, inst); err != nil {
		t.Fatal(err)
	}
	sup.ReconcileProcesses(ctx)
	// The stale row is repaired and the enabled long-running instance is
	// restarted.
	got, err := st.GetInstance(ctx, "stale-row")
	if err != nil {
		t.Fatal(err)
	}
	if got.PID == nil || *got.PID == dead {
		t.Fatalf("stale row not repaired: %+v", got)
	}
	_ = sup.Stop(ctx, "stale-row")
}

func TestReconcileKeepsWarmScaleToZeroInstances(t *testing.T) {
	// The reconcile surplus pass must not park a warm scale-to-zero instance:
	// the scale-to-zero scan owns parking, on its TTL. Before the fix every reconcile pass
	// stopped every warm scale-to-zero instance, defeating the mode.
	dataDir, st := setupScaleToZeroRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "stz-keep", ServiceID: "echo"}); err != nil {
		t.Fatal(err)
	}
	release, err := sup.EnsureStarted(ctx, "stz-keep")
	if err != nil {
		t.Fatal(err)
	}
	release()
	if !sup.TracksInstance("stz-keep") {
		t.Fatal("instance did not warm")
	}
	inst, err := st.GetInstance(ctx, "stz-keep")
	if err != nil {
		t.Fatal(err)
	}
	warmPID := *inst.PID

	sup.ReconcileProcesses(ctx)

	if !sup.TracksInstance("stz-keep") {
		t.Fatal("reconcile parked a warm scale-to-zero instance")
	}
	got, err := st.GetInstance(ctx, "stz-keep")
	if err != nil {
		t.Fatal(err)
	}
	if got.PID == nil || *got.PID != warmPID {
		t.Fatalf("reconcile restarted the warm scale-to-zero process: %d -> %v", warmPID, got.PID)
	}
	_ = sup.Stop(ctx, "stz-keep")
}

func TestReconcileStillStopsSurplus(t *testing.T) {
	// The scale-to-zero exemption must not swallow the surplus class: a
	// tracked process
	// on a disabled long-running row is still stopped.
	dataDir, st, _ := setupSupervisorHelperRuntime(t)
	ctx := context.Background()
	svc, err := st.GetService(ctx, "echo")
	if err != nil {
		t.Fatal(err)
	}
	svc.RuntimeMode = domain.RuntimeModeLongRunning
	if err := st.UpsertService(ctx, svc); err != nil {
		t.Fatal(err)
	}
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "surplus-victim", ServiceID: "echo", Start: true}); err != nil {
		t.Fatal(err)
	}
	// Disable the row under the process: the shape of a stop that lost its
	// process write.
	inst, err := st.GetInstance(ctx, "surplus-victim")
	if err != nil {
		t.Fatal(err)
	}
	inst.Enabled = false
	if err := st.UpsertInstance(ctx, inst); err != nil {
		t.Fatal(err)
	}
	sup.ReconcileProcesses(ctx)
	if sup.TracksInstance("surplus-victim") {
		t.Fatal("reconcile kept a process whose row is disabled")
	}
}

func TestReconcileGraceProtectsUnparseableStartTimes(t *testing.T) {
	// A /proc stat parse failure must read as brand-new (grace), not as
	// process-start-of-time (kill). The zero time made the window test pass
	// for the wrong reason and any transient read failure lethal.
	before := time.Now()
	failed := processStartTime(nil)
	if failed.Before(before) {
		t.Fatalf("a parse failure must yield a fresh timestamp, got %v (before %v)", failed, before)
	}
	// And the window check itself must skip such a process this pass.
	if failed.Sub(before) < orphanGrace {
		return
	}
	t.Fatal("a fresh timestamp must fall inside the grace window")
}

func TestScaleToZeroEnsureStartedSurvivesCallerCancellation(t *testing.T) {
	// The winning request hanging up mid-start must not kill the start the
	// queued callers are waiting for: the start runs detached, so the next
	// caller warms instantly instead of paying another cold start.
	dataDir, st := setupScaleToZeroRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "stz-detach", ServiceID: "echo"}); err != nil {
		t.Fatal(err)
	}
	// A caller that gives up before the start completes. The start runs on a
	// detached context, so EnsureStarted does not fail with the caller's
	// cancellation -- the caller discovers it when the response cannot be
	// delivered, and the start everyone is queued for completes anyway.
	callerCtx, cancel := context.WithCancel(ctx)
	go func() {
		time.Sleep(20 * time.Millisecond)
		cancel()
	}()
	release, err := sup.EnsureStarted(callerCtx, "stz-detach")
	if err == nil {
		release()
	}
	// The start survives on its detached context and completes.
	eventually(t, 10*time.Second, func() bool {
		return sup.TracksInstance("stz-detach")
	})
	// The next caller gets the warm instance.
	release2, err := sup.EnsureStarted(ctx, "stz-detach")
	if err != nil {
		t.Fatalf("next caller after a cancelled start: %v", err)
	}
	release2()
	_ = sup.Stop(ctx, "stz-detach")
}

func TestStartInitializesIdleClock(t *testing.T) {
	// Every warm path must start the idle clock at process registration: an
	// admin-started (or restarted, or recovered) scale-to-zero instance buys a
	// full TTL, not one scan interval. Before the fix only EnsureStarted
	// initialized the clock, so an explicit start was parked within a minute.
	dataDir, st := setupScaleToZeroRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "stz-clock", ServiceID: "echo"}); err != nil {
		t.Fatal(err)
	}
	// Admin Start, not EnsureStarted.
	if err := sup.Start(ctx, "stz-clock"); err != nil {
		t.Fatal(err)
	}
	sup.mu.Lock()
	activity, ok := sup.lastActivity["stz-clock"]
	sup.mu.Unlock()
	if !ok {
		t.Fatal("admin Start did not initialize the idle clock")
	}
	if age := time.Since(activity); age > time.Minute {
		t.Fatalf("idle clock starts too old: %v", age)
	}
	// The scan must not park it.
	sup.stzIdleTTL = time.Hour
	sup.stzMaxWarm = 0
	sup.scanScaleToZero(ctx)
	if !sup.TracksInstance("stz-clock") {
		t.Fatal("freshly started instance was parked on the first scan")
	}
	_ = sup.Stop(ctx, "stz-clock")
}

func TestReconcileMissingDoesNotResurrectOperatorStop(t *testing.T) {
	// The missing-recovery snapshot predates the gate. An operator Stop that
	// lands after the snapshot must win: recovery inside the gate re-verifies
	// Enabled instead of silently undoing the stop.
	dataDir, st, _ := setupSupervisorHelperRuntime(t)
	ctx := context.Background()
	svc, err := st.GetService(ctx, "echo")
	if err != nil {
		t.Fatal(err)
	}
	svc.RuntimeMode = domain.RuntimeModeLongRunning
	if err := st.UpsertService(ctx, svc); err != nil {
		t.Fatal(err)
	}
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "no-resurrect", ServiceID: "echo", Start: true}); err != nil {
		t.Fatal(err)
	}
	// Simulate the operator Stop landing after the reconcile snapshot: disable
	// the row and untrack the process while the row still claims liveness.
	// Wait for the exit watcher to settle first: its own degraded write must
	// not land after our Enabled=false and re-enable the row behind the test.
	inst, err := st.GetInstance(ctx, "no-resurrect")
	if err != nil {
		t.Fatal(err)
	}
	if err := syscall.Kill(*inst.PID, syscall.SIGKILL); err != nil {
		t.Fatal(err)
	}
	eventually(t, 5*time.Second, func() bool {
		sup.mu.Lock()
		tracked := sup.procs["no-resurrect"] != nil
		sup.mu.Unlock()
		return !tracked
	})
	inst, err = st.GetInstance(ctx, "no-resurrect")
	if err != nil {
		t.Fatal(err)
	}
	// The watcher may or may not have written its degraded row yet; both are
	// fine. All the scenario needs is a disabled row claiming liveness with a
	// dead pid -- exactly what an operator stop leaves behind when it lost the
	// race to a crash.
	inst.Enabled = false
	inst.Status = domain.StatusRunning
	if inst.PID != nil {
		dead := *inst.PID
		inst.PID = &dead
	}
	if err := st.UpsertInstance(ctx, inst); err != nil {
		t.Fatal(err)
	}
	sup.mu.Lock()
	delete(sup.procs, "no-resurrect")
	sup.mu.Unlock()

	sup.ReconcileProcesses(ctx)

	got, err := st.GetInstance(ctx, "no-resurrect")
	if err != nil {
		t.Fatal(err)
	}
	if got.Enabled {
		t.Fatal("reconcile resurrected an instance the operator stopped after the snapshot")
	}
	if sup.TracksInstance("no-resurrect") {
		t.Fatal("reconcile started a process for a disabled instance")
	}
}

func TestWaitDoesNotClobberFreshGeneration(t *testing.T) {
	// The exit watcher runs outside the gate. A request that warmed a fresh
	// process while the old process's wait was between the procs deletion and
	// the row write must win: the stale degraded write may not clobber the
	// new generation's running row.
	dataDir, st := setupScaleToZeroRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "stz-race", ServiceID: "echo"}); err != nil {
		t.Fatal(err)
	}
	release, err := sup.EnsureStarted(ctx, "stz-race")
	if err != nil {
		t.Fatal(err)
	}
	release()
	// The old generation dies. wait() will race the fresh start below.
	old, err := st.GetInstance(ctx, "stz-race")
	if err != nil {
		t.Fatal(err)
	}
	oldPID := *old.PID
	oldInst, _ := st.GetInstance(ctx, "stz-race")
	_ = oldInst
	if err := syscall.Kill(oldPID, syscall.SIGKILL); err != nil {
		t.Fatal(err)
	}
	// Give the exit watcher time to reach its row-write section, then warm a
	// fresh generation that the stale write must not destroy.
	time.Sleep(50 * time.Millisecond)
	release2, err := sup.EnsureStarted(ctx, "stz-race")
	if err != nil {
		t.Fatal(err)
	}
	release2()
	// Wait past the watcher's write window.
	time.Sleep(500 * time.Millisecond)
	got, err := st.GetInstance(ctx, "stz-race")
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != domain.StatusRunning || got.PID == nil {
		t.Fatalf("stale exit write clobbered the fresh generation: %+v", got)
	}
	_ = sup.Stop(ctx, "stz-race")
}

func TestNormalizeStaticModeRowAfterStopTimeout(t *testing.T) {
	// An on-demand instance has no stopped state. After a surplus stop (the
	// defensive path) or a switch whose stop timed out, the row must land in
	// enabled/running/no-pid so the gateway keeps serving.
	dataDir, st, _ := setupSupervisorHelperRuntime(t)
	ctx := context.Background()
	svc, err := st.GetService(ctx, "echo")
	if err != nil {
		t.Fatal(err)
	}
	svc.RuntimeMode = domain.RuntimeModeOnDemand
	if err := st.UpsertService(ctx, svc); err != nil {
		t.Fatal(err)
	}
	sup := New(dataDir, st)
	// A row in the impossible shape the fix exists for: enabled+stopped.
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "od-norm", ServiceID: "echo", Enabled: true, Status: domain.StatusStopped, NodeEntry: "fixture-entry", ConfigJSON: []byte(`{}`), SecretJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	unlock := sup.lockInstance("od-norm")
	if err := sup.normalizeStaticModeRow(ctx, "od-norm"); err != nil {
		t.Fatal(err)
	}
	unlock()
	got, err := st.GetInstance(ctx, "od-norm")
	if err != nil {
		t.Fatal(err)
	}
	if !got.Enabled || got.Status != domain.StatusRunning || got.PID != nil {
		t.Fatalf("on-demand row not normalized to its resting state: %+v", got)
	}
}
