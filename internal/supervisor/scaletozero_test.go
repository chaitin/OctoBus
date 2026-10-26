package supervisor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
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
	t.Cleanup(func() { _ = sup.Stop(context.Background(), "stz-ref") })
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
	if runtime.GOOS != "linux" {
		t.Skip("the orphan scan reads /proc (linux only)")
	}
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
	// protects in-flight starts would misread it as not-ours.
	eventually(t, 5*time.Second, func() bool {
		_, ok := inspectServeProcess(orphanPID, dataDir, map[string]string{})
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
	// A /proc stat parse failure must not invent a start time: the scanner
	// sees ok=false, substitutes the current time, and marks the process
	// inexact -- grace-protected and never a kill candidate.
	start, ok := processStartTime(nil)
	if ok || !start.IsZero() {
		t.Fatalf("a parse failure must return (zero, false), got (%v, %v)", start, ok)
	}
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
	// wait() takes the instance gate before its procs/row section, so the
	// fresh start below is serialized against the exit write. What this pins
	// is the outcome: the stale degraded write may not clobber the new
	// generation's running row.
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
	if err := sup.landOnDemandRow(ctx, "od-norm", domain.RuntimeModeOnDemand); err != nil {
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

func TestNormalizeOnDemandWorksWithOldModeStillInRow(t *testing.T) {
	// Both switch-to-on-demand failure paths fire before the target mode has
	// been committed to the row: the row still carries the old runtime_mode,
	// so a row-based guard would silently do nothing and leave the instance
	// enabled/stopped -- unusable by the gateway until an import rewrote it.
	// The target mode is therefore an explicit parameter.
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
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "od-switch", ServiceID: "echo", Enabled: true, Status: domain.StatusStopped, NodeEntry: "fixture-entry", ConfigJSON: []byte(`{}`), SecretJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	// The row still says long-running; the switch requests the explicit
	// on-demand override. The helper must persist that override too: status
	// without the override strands the row as long-running+running+no pid,
	// which the reconcile missing pass would resurrect under the old mode.
	unlock := sup.lockInstance("od-switch")
	if err := sup.landOnDemandRow(ctx, "od-switch", domain.RuntimeModeOnDemand); err != nil {
		t.Fatal(err)
	}
	unlock()
	got, err := st.GetInstance(ctx, "od-switch")
	if err != nil {
		t.Fatal(err)
	}
	if got.RuntimeMode != domain.RuntimeModeOnDemand {
		t.Fatalf("requested override not persisted: %q", got.RuntimeMode)
	}
	if !got.Enabled || got.Status != domain.StatusRunning || got.PID != nil {
		t.Fatalf("row not normalized while old mode was still stored: %+v", got)
	}

	// The inherit case: an empty override must stay empty. Writing the
	// effective mode here would solder an explicit on-demand override onto an
	// inheriting instance, and it would never follow the service's mode again.
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "od-inherit", ServiceID: "echo", Enabled: true, Status: domain.StatusStopped, NodeEntry: "fixture-entry", ConfigJSON: []byte(`{}`), SecretJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	unlock2 := sup.lockInstance("od-inherit")
	if err := sup.landOnDemandRow(ctx, "od-inherit", ""); err != nil {
		t.Fatal(err)
	}
	unlock2()
	got2, err := st.GetInstance(ctx, "od-inherit")
	if err != nil {
		t.Fatal(err)
	}
	if got2.RuntimeMode != "" {
		t.Fatalf("an empty override must stay empty, got %q", got2.RuntimeMode)
	}
	if !got2.Enabled || got2.Status != domain.StatusRunning || got2.PID != nil {
		t.Fatalf("inherit row not normalized: %+v", got2)
	}
}

func TestReconcileSurplusKeepsDisabledResidentStopped(t *testing.T) {
	// A disabled long-running instance with a tracked process (an operator
	// stop that lost its process write) enters the surplus pass. Stopping it
	// must land the row enabled=false/stopped and leave it there: normalizing
	// it to on-demand's resting state would re-enable the instance and the
	// next pass's missing scan would start it right back, silently undoing
	// the operator.
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
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "disabled-surplus", ServiceID: "echo", Start: true}); err != nil {
		t.Fatal(err)
	}
	// Operator-disabled row under a live tracked process.
	inst, err := st.GetInstance(ctx, "disabled-surplus")
	if err != nil {
		t.Fatal(err)
	}
	inst.Enabled = false
	if err := st.UpsertInstance(ctx, inst); err != nil {
		t.Fatal(err)
	}
	if !sup.TracksInstance("disabled-surplus") {
		t.Fatal("expected the process to still be tracked")
	}

	sup.ReconcileProcesses(ctx)

	if sup.TracksInstance("disabled-surplus") {
		t.Fatal("surplus process was not stopped")
	}
	got, err := st.GetInstance(ctx, "disabled-surplus")
	if err != nil {
		t.Fatal(err)
	}
	if got.Enabled || got.Status != domain.StatusStopped || got.PID != nil {
		t.Fatalf("disabled resident row must stay disabled/stopped, got %+v", got)
	}
	// Settle the helper process before t.TempDir cleanup: the surplus stop's
	// SIGKILL races the cleanup's RemoveAll on a Windows-less best-effort
	// basis only, and a still-occupied workdir fails the whole test.
	_ = sup.Shutdown(context.Background())
}

// TestScaleToZeroRefReleaseIsStateScoped pins the ownership rule for request
// refs: refs live on the process state, so a straggler release from an exited
// process decrements the old state and cannot affect its successor.
func TestScaleToZeroRefReleaseIsStateScoped(t *testing.T) {
	sup := New(t.TempDir(), nil)

	oldState := &processState{done: make(chan struct{})}
	newState := &processState{done: make(chan struct{})}
	sup.mu.Lock()
	sup.procs["stz-gen"] = oldState
	oldState.refs++
	sup.mu.Unlock()

	// The process exits: wait() removes its state, dropping its refs.
	sup.mu.Lock()
	delete(sup.procs, "stz-gen")
	sup.mu.Unlock()

	// A request for the successor takes its own ref.
	sup.mu.Lock()
	sup.procs["stz-gen"] = newState
	newState.refs++
	sup.mu.Unlock()

	// The old request's late release decrements the old state only.
	sup.releaseRef(oldState)
	sup.mu.Lock()
	got := newState.refs
	sup.mu.Unlock()
	if got != 1 {
		t.Fatalf("old release clobbered the successor: refs=%d, want 1", got)
	}

	// The successor's own release still clears its count.
	sup.releaseRef(newState)
	sup.mu.Lock()
	got = newState.refs
	sup.mu.Unlock()
	if got != 0 {
		t.Fatalf("successor ref not released: %d", got)
	}
}

func TestWithinDir(t *testing.T) {
	dir := filepath.Join(string(filepath.Separator), "data", "instances", "a")
	cases := []struct {
		path string
		want bool
	}{
		{dir, true},
		{filepath.Join(dir, "pkg"), true},
		{filepath.Join(dir, "..", "b"), false},
		{filepath.Join(string(filepath.Separator), "data", "instances", "ab"), false},
		{filepath.Join(string(filepath.Separator), "other"), false},
	}
	for _, tc := range cases {
		if got := withinDir(dir, tc.path); got != tc.want {
			t.Errorf("withinDir(%q, %q) = %v, want %v", dir, tc.path, got, tc.want)
		}
	}
}

// TestReconcileRepairsStaleScaleToZeroRow covers the kill -9 remnant of a warm
// scale-to-zero instance: the row claims running with a dead pid, so reconcile
// must land it back on the cold state (enabled, stopped, no pid/addr) without
// starting it.
func TestReconcileRepairsStaleScaleToZeroRow(t *testing.T) {
	dataDir, st, _ := setupSupervisorHelperRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{
		ID: "stz-stale", ServiceID: "echo", RuntimeMode: domain.RuntimeModeScaleToZero,
	}); err != nil {
		t.Fatal(err)
	}
	inst, err := st.GetInstance(ctx, "stz-stale")
	if err != nil {
		t.Fatal(err)
	}
	inst.Enabled = true
	inst.Status = domain.StatusRunning
	dead := 2147483647 - 1
	inst.PID = &dead
	inst.ListenAddr = "127.0.0.1:1"
	if err := st.UpsertInstance(ctx, inst); err != nil {
		t.Fatal(err)
	}

	sup.ReconcileProcesses(ctx)

	got, err := st.GetInstance(ctx, "stz-stale")
	if err != nil {
		t.Fatal(err)
	}
	if !got.Enabled || got.Status != domain.StatusStopped || got.PID != nil || got.ListenAddr != "" {
		t.Fatalf("stale scale-to-zero row not repaired to cold: %+v", got)
	}
	if sup.TracksInstance("stz-stale") {
		t.Fatal("repairing a stale row must not start the instance")
	}
}

// TestScaleToZeroParkRechecksRuntimeMode pins the park guard: a mode switch to
// long-running that lands after the scan collected the id must not be parked --
// a parked long-running row is enabled/stopped and nothing restarts it.
func TestScaleToZeroParkRechecksRuntimeMode(t *testing.T) {
	dataDir, st := setupScaleToZeroRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "stz-mode", ServiceID: "echo"}); err != nil {
		t.Fatal(err)
	}
	release, err := sup.EnsureStarted(ctx, "stz-mode")
	if err != nil {
		t.Fatal(err)
	}
	release()
	// The operator switches the service to long-running while the scan is in
	// flight; the warm process is kept (SetRuntimeMode semantics).
	svc, err := st.GetService(ctx, "echo")
	if err != nil {
		t.Fatal(err)
	}
	svc.RuntimeMode = domain.RuntimeModeLongRunning
	if err := st.UpsertService(ctx, svc); err != nil {
		t.Fatal(err)
	}
	sup.mu.Lock()
	sup.lastActivity["stz-mode"] = time.Now().Add(-2 * time.Minute)
	sup.mu.Unlock()
	if sup.parkIfStillIdle(ctx, "stz-mode", time.Now().Add(-time.Minute)) {
		t.Fatal("parked an instance whose effective mode is no longer scale-to-zero")
	}
	if !sup.TracksInstance("stz-mode") {
		t.Fatal("the park attempt disturbed a long-running process")
	}
	_ = sup.Stop(ctx, "stz-mode")
}

// TestCreateInstanceOnDemandToScaleToZeroStaysCold pins the sync path: flipping
// an on-demand instance to scale-to-zero lands the cold state and starts
// nothing -- a bulk sync must not wake every instance of the service.
func TestCreateInstanceOnDemandToScaleToZeroStaysCold(t *testing.T) {
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
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "od-stz", ServiceID: "echo"}); err != nil {
		t.Fatal(err)
	}
	got, err := sup.CreateInstance(ctx, CreateInstanceRequest{
		ID: "od-stz", ServiceID: "echo", RuntimeMode: domain.RuntimeModeScaleToZero,
		Config: json.RawMessage(`{"changed":true}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != domain.StatusStopped || got.PID != nil || got.ListenAddr != "" {
		t.Fatalf("on-demand to scale-to-zero did not land cold: %+v", got)
	}
	if sup.TracksInstance("od-stz") {
		t.Fatal("sync switched to scale-to-zero started a resident process")
	}
}

// TestCreateInstanceUpdatePropagatesRestartError pins the error contract: a
// content-changing sync whose in-place restart fails must report the failure,
// not a successful read of a stopped instance.
func TestCreateInstanceUpdatePropagatesRestartError(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is unix-only")
	}
	dataDir, st, entry := setupSupervisorHelperRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "stz-restart", ServiceID: "echo", Start: true}); err != nil {
		t.Fatal(err)
	}
	// Break the runtime so the restart's health check fails.
	entryPath := filepath.Join(dataDir, "artifacts", "services", "echo", "runtime", entry)
	if err := os.WriteFile(entryPath, []byte("#!/bin/sh\nexit 1\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	inst, err := sup.CreateInstance(ctx, CreateInstanceRequest{
		ID: "stz-restart", ServiceID: "echo", Config: json.RawMessage(`{"changed":true}`),
	})
	if err == nil {
		t.Fatal("a failed in-place restart was reported as success")
	}
	if inst.Status != domain.StatusFailed {
		t.Fatalf("returned status %s, want failed", inst.Status)
	}
	_ = sup.Stop(ctx, "stz-restart")
}

// TestCreateInstanceModeChangeReloadsChangedContent pins the mode-switch
// reload: a sync that changes content and runtime mode together must reload
// the resident process in place, not leave it serving the previous config.
func TestCreateInstanceModeChangeReloadsChangedContent(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is unix-only")
	}
	dataDir, st, _ := setupSupervisorHelperRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "mode-reload", ServiceID: "echo", Start: true}); err != nil {
		t.Fatal(err)
	}
	before, err := st.GetInstance(ctx, "mode-reload")
	if err != nil {
		t.Fatal(err)
	}
	if before.PID == nil {
		t.Fatal("expected a warm process before the switch")
	}
	got, err := sup.CreateInstance(ctx, CreateInstanceRequest{
		ID: "mode-reload", ServiceID: "echo", RuntimeMode: domain.RuntimeModeScaleToZero,
		Config: json.RawMessage(`{"changed":true}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.RuntimeMode != domain.RuntimeModeScaleToZero {
		t.Fatalf("runtime mode = %s, want scale-to-zero", got.RuntimeMode)
	}
	if got.PID == nil || *got.PID == *before.PID {
		t.Fatalf("warm process was not reloaded on the content change: %+v", got)
	}
	if !sup.TracksInstance("mode-reload") {
		t.Fatal("reload lost the resident process")
	}
	_ = sup.Stop(ctx, "mode-reload")
}

// TestApplyServiceRuntimeModeLandsOnDemandRowColdForScaleToZero pins the
// service-flip path: an on-demand row (enabled/running, no process) must land
// on scale-to-zero's cold state when its service switches modes.
func TestApplyServiceRuntimeModeLandsOnDemandRowColdForScaleToZero(t *testing.T) {
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
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "od-flip", ServiceID: "echo"}); err != nil {
		t.Fatal(err)
	}
	// The service flips on-demand -> scale-to-zero; the import path then calls
	// ApplyServiceRuntimeMode for the (untracked) instances.
	svc.RuntimeMode = domain.RuntimeModeScaleToZero
	if err := st.UpsertService(ctx, svc); err != nil {
		t.Fatal(err)
	}
	if err := sup.ApplyServiceRuntimeMode(ctx, "od-flip"); err != nil {
		t.Fatal(err)
	}
	got, err := st.GetInstance(ctx, "od-flip")
	if err != nil {
		t.Fatal(err)
	}
	if !got.Enabled || got.Status != domain.StatusStopped || got.PID != nil || got.ListenAddr != "" {
		t.Fatalf("on-demand row did not land cold for scale-to-zero: %+v", got)
	}
}

// TestReconcileRepairsDegradedScaleToZeroRow covers the crash remnant: wait()
// writes degraded with no pid, and reconcile must land that row on the cold
// state instead of leaving it degraded until the next call.
func TestReconcileRepairsDegradedScaleToZeroRow(t *testing.T) {
	dataDir, st, _ := setupSupervisorHelperRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{
		ID: "stz-degraded", ServiceID: "echo", RuntimeMode: domain.RuntimeModeScaleToZero,
	}); err != nil {
		t.Fatal(err)
	}
	inst, err := st.GetInstance(ctx, "stz-degraded")
	if err != nil {
		t.Fatal(err)
	}
	inst.Enabled = true
	inst.Status = domain.StatusDegraded
	inst.PID = nil
	inst.ListenAddr = ""
	if err := st.UpsertInstance(ctx, inst); err != nil {
		t.Fatal(err)
	}

	sup.ReconcileProcesses(ctx)

	got, err := st.GetInstance(ctx, "stz-degraded")
	if err != nil {
		t.Fatal(err)
	}
	if !got.Enabled || got.Status != domain.StatusStopped || got.PID != nil || got.ListenAddr != "" {
		t.Fatalf("degraded scale-to-zero row not repaired to cold: %+v", got)
	}
	if sup.TracksInstance("stz-degraded") {
		t.Fatal("repairing a degraded row must not start the instance")
	}
}

// TestCreateInstanceRebindRunsModeTransition pins the rebind path: the
// before-mode comes from the OLD service, so moving an instance from an
// on-demand service to a long-running one starts the resident process instead
// of leaving a running-looking row with no process.
func TestCreateInstanceRebindRunsModeTransition(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is unix-only")
	}
	dataDir, st, entry := setupSupervisorHelperRuntime(t)
	ctx := context.Background()
	if err := st.UpsertService(ctx, domain.Service{ID: "echo-od", Name: "Echo OD", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: entry, RuntimeMode: domain.RuntimeModeOnDemand}); err != nil {
		t.Fatal(err)
	}
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "rebind", ServiceID: "echo-od"}); err != nil {
		t.Fatal(err)
	}
	if sup.TracksInstance("rebind") {
		t.Fatal("on-demand instance must not have a resident process")
	}

	got, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "rebind", ServiceID: "echo"})
	if err != nil {
		t.Fatal(err)
	}
	if got.ServiceID != "echo" {
		t.Fatalf("service id = %s, want echo", got.ServiceID)
	}
	if !sup.TracksInstance("rebind") {
		t.Fatal("rebind to a long-running service did not start the resident process")
	}
	if got.Status != domain.StatusRunning || got.PID == nil {
		t.Fatalf("rebound instance not running: %+v", got)
	}
	_ = sup.Stop(ctx, "rebind")
}

// TestApplyServiceRuntimeModeReloadsWarmScaleToZeroProcess pins the warm-race
// fix: a warm scale-to-zero process must be reloaded in place, never stopped
// under a request that warmed it between the caller's check and the gate.
func TestApplyServiceRuntimeModeReloadsWarmScaleToZeroProcess(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is unix-only")
	}
	dataDir, st, _ := setupSupervisorHelperRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{
		ID: "warm-flip", ServiceID: "echo", RuntimeMode: domain.RuntimeModeScaleToZero, Start: true,
	}); err != nil {
		t.Fatal(err)
	}
	// New scale-to-zero instances are created cold by design (a start would
	// defeat the mode for bulk syncs), so warm it the way a request would.
	release, err := sup.EnsureStarted(ctx, "warm-flip")
	if err != nil {
		t.Fatal(err)
	}
	release()
	before, err := st.GetInstance(ctx, "warm-flip")
	if err != nil {
		t.Fatal(err)
	}
	if before.PID == nil {
		t.Fatal("expected a warm process before the flip")
	}
	svc, err := st.GetService(ctx, "echo")
	if err != nil {
		t.Fatal(err)
	}
	svc.RuntimeMode = domain.RuntimeModeScaleToZero
	if err := st.UpsertService(ctx, svc); err != nil {
		t.Fatal(err)
	}
	if err := sup.ApplyServiceRuntimeMode(ctx, "warm-flip"); err != nil {
		t.Fatal(err)
	}
	after, err := st.GetInstance(ctx, "warm-flip")
	if err != nil {
		t.Fatal(err)
	}
	if !sup.TracksInstance("warm-flip") {
		t.Fatal("warm process was not kept")
	}
	if after.PID == nil || *after.PID == *before.PID {
		t.Fatalf("warm process was not reloaded: %+v", after)
	}
	_ = sup.Stop(ctx, "warm-flip")
}

// TestReconcileRecycledPIDDoesNotPinStaleRow pins the pid-identity check: a
// row whose pid is alive but belongs to another process (the shape of a
// recycled pid after a kill -9) must be repaired and restarted, not skipped.
func TestReconcileRecycledPIDDoesNotPinStaleRow(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("pid identity reads /proc (linux only)")
	}
	dataDir, st, _ := setupSupervisorHelperRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "recycled", ServiceID: "echo", Start: true}); err != nil {
		t.Fatal(err)
	}
	if err := sup.Stop(ctx, "recycled"); err != nil {
		t.Fatal(err)
	}
	inst, err := st.GetInstance(ctx, "recycled")
	if err != nil {
		t.Fatal(err)
	}
	live := os.Getpid()
	inst.Enabled = true
	inst.Status = domain.StatusRunning
	inst.PID = &live
	inst.ListenAddr = "127.0.0.1:1"
	if err := st.UpsertInstance(ctx, inst); err != nil {
		t.Fatal(err)
	}

	sup.ReconcileProcesses(ctx)

	got, err := st.GetInstance(ctx, "recycled")
	if err != nil {
		t.Fatal(err)
	}
	if got.PID == nil || *got.PID == live {
		t.Fatalf("recycled pid still pins the row: %+v", got)
	}
	if !sup.TracksInstance("recycled") {
		t.Fatal("long-running instance with a recycled pid was not restarted")
	}
	_ = sup.Stop(ctx, "recycled")
}

// TestApplyServiceRuntimeModeNormalizesColdInstanceForOnDemand pins the
// service-flip path into on-demand: a cold (untracked, enabled/stopped) row
// must still be normalized to on-demand's enabled/running shape, or every call
// is rejected and no other pass repairs it.
func TestApplyServiceRuntimeModeNormalizesColdInstanceForOnDemand(t *testing.T) {
	dataDir, st := setupScaleToZeroRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "od-cold", ServiceID: "echo"}); err != nil {
		t.Fatal(err)
	}
	// The service flips to on-demand while the instance is cold.
	svc, err := st.GetService(ctx, "echo")
	if err != nil {
		t.Fatal(err)
	}
	svc.RuntimeMode = domain.RuntimeModeOnDemand
	if err := st.UpsertService(ctx, svc); err != nil {
		t.Fatal(err)
	}
	if err := sup.ApplyServiceRuntimeMode(ctx, "od-cold"); err != nil {
		t.Fatal(err)
	}
	got, err := st.GetInstance(ctx, "od-cold")
	if err != nil {
		t.Fatal(err)
	}
	if !got.Enabled || got.Status != domain.StatusRunning || got.PID != nil || got.ListenAddr != "" {
		t.Fatalf("cold row not normalized for on-demand: %+v", got)
	}
}

// TestSetRuntimeModeRefreshesIdleClockForWarmProcess pins the keep-resident
// transition: a long-running process older than the idle TTL must not be
// parked by the next scan right after it switches to scale-to-zero.
func TestSetRuntimeModeRefreshesIdleClockForWarmProcess(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is unix-only")
	}
	dataDir, st, _ := setupSupervisorHelperRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "mode-clock", ServiceID: "echo", Start: true}); err != nil {
		t.Fatal(err)
	}
	// The instance has been running for an hour: the clock still holds start.
	sup.mu.Lock()
	sup.lastActivity["mode-clock"] = time.Now().Add(-time.Hour)
	sup.mu.Unlock()
	// The scan that will judge this instance started before the switch.
	scannedAt := time.Now()
	if _, err := sup.SetRuntimeMode(ctx, "mode-clock", domain.RuntimeModeScaleToZero); err != nil {
		t.Fatal(err)
	}
	if !sup.TracksInstance("mode-clock") {
		t.Fatal("switch to scale-to-zero must keep the warm process")
	}
	sup.mu.Lock()
	activity := sup.lastActivity["mode-clock"]
	sup.mu.Unlock()
	if time.Since(activity) > time.Minute {
		t.Fatalf("idle clock was not refreshed on the keep-resident switch: %v", time.Since(activity))
	}
	if sup.parkIfStillIdle(ctx, "mode-clock", scannedAt) {
		t.Fatal("the fresh clock must keep the instance out of the idle stop")
	}
	_ = sup.Stop(ctx, "mode-clock")
}

// TestCreateInstanceNameOnlyChangeDoesNotRestart pins the cosmetic path: a
// display-name change must not bounce a live process (the process never reads
// the name).
func TestCreateInstanceNameOnlyChangeDoesNotRestart(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is unix-only")
	}
	dataDir, st, _ := setupSupervisorHelperRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "cosmetic", ServiceID: "echo", Start: true}); err != nil {
		t.Fatal(err)
	}
	before, err := st.GetInstance(ctx, "cosmetic")
	if err != nil {
		t.Fatal(err)
	}
	got, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "cosmetic", ServiceID: "echo", Name: "New Label"})
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "New Label" {
		t.Fatalf("name = %q, want New Label", got.Name)
	}
	if got.PID == nil || before.PID == nil || *got.PID != *before.PID {
		t.Fatalf("a cosmetic change restarted the process: before=%v after=%v", before.PID, got.PID)
	}
	if !sup.TracksInstance("cosmetic") {
		t.Fatal("the live process was disturbed")
	}
	_ = sup.Stop(ctx, "cosmetic")
}

// TestEnsureStartedReplacesExitedTrackedState pins the crash window: a tracked
// state whose done channel is already closed must be treated as cold (the
// request would otherwise be sent to a dead address).
func TestEnsureStartedReplacesExitedTrackedState(t *testing.T) {
	dataDir, st := setupScaleToZeroRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "stz-exited", ServiceID: "echo"}); err != nil {
		t.Fatal(err)
	}
	exited := &processState{done: make(chan struct{})}
	close(exited.done)
	sup.mu.Lock()
	sup.procs["stz-exited"] = exited
	sup.mu.Unlock()

	release, err := sup.EnsureStarted(ctx, "stz-exited")
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	sup.mu.Lock()
	current := sup.procs["stz-exited"]
	sup.mu.Unlock()
	if current == nil || current == exited {
		t.Fatal("EnsureStarted reported a hot hit on an exited process")
	}
	_ = sup.Stop(ctx, "stz-exited")
}

// TestRestartIfWarmKeepsColdInstancesCold pins the import helper: a cold
// scale-to-zero instance must not be woken by a restart request.
func TestRestartIfWarmKeepsColdInstancesCold(t *testing.T) {
	dataDir, st := setupScaleToZeroRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "stz-cold-restart", ServiceID: "echo"}); err != nil {
		t.Fatal(err)
	}
	warm, err := sup.RestartIfWarm(ctx, "stz-cold-restart")
	if err != nil {
		t.Fatal(err)
	}
	if warm || sup.TracksInstance("stz-cold-restart") {
		t.Fatal("RestartIfWarm woke a cold instance")
	}
}

// TestStartOnRunningInstanceIsIdempotent pins the start contract: retrying a
// start on a healthy instance reports success and leaves the process alone.
func TestStartOnRunningInstanceIsIdempotent(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is unix-only")
	}
	dataDir, st, _ := setupSupervisorHelperRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "start-noop", ServiceID: "echo", Start: true}); err != nil {
		t.Fatal(err)
	}
	before, err := st.GetInstance(ctx, "start-noop")
	if err != nil {
		t.Fatal(err)
	}
	if err := sup.Start(ctx, "start-noop"); err != nil {
		t.Fatalf("Start on a running instance: %v", err)
	}
	after, err := st.GetInstance(ctx, "start-noop")
	if err != nil {
		t.Fatal(err)
	}
	if before.PID == nil || after.PID == nil || *before.PID != *after.PID {
		t.Fatalf("Start bounced the process: before=%v after=%v", before.PID, after.PID)
	}
	if !sup.TracksInstance("start-noop") {
		t.Fatal("Start lost the tracked process")
	}
	_ = sup.Stop(ctx, "start-noop")
}

// TestCreateInstanceRetriesFailedInstance pins recovery: a sync retry of an
// unchanged, enabled instance whose last start failed must try again instead
// of returning the failed row with a nil error.
func TestCreateInstanceRetriesFailedInstance(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is unix-only")
	}
	dataDir, st, entry := setupSupervisorHelperRuntime(t)
	ctx := context.Background()
	entryPath := filepath.Join(dataDir, "artifacts", "services", "echo", "runtime", entry)
	if err := os.WriteFile(entryPath, []byte("#!/bin/sh\nexit 1\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	sup := New(dataDir, st)
	req := CreateInstanceRequest{ID: "retry-failed", ServiceID: "echo", Start: true}
	if _, err := sup.CreateInstance(ctx, req); err == nil {
		t.Fatal("expected the first start to fail")
	}
	failed, err := st.GetInstance(ctx, "retry-failed")
	if err != nil {
		t.Fatal(err)
	}
	if failed.Status != domain.StatusFailed {
		t.Fatalf("status = %s, want failed", failed.Status)
	}
	// Fix the runtime and retry the identical request.
	if err := writeSupervisorHelperEntry(entryPath); err != nil {
		t.Fatal(err)
	}
	got, err := sup.CreateInstance(ctx, req)
	if err != nil {
		t.Fatalf("retry did not recover the instance: %v", err)
	}
	if got.Status != domain.StatusRunning || got.PID == nil {
		t.Fatalf("retry left the instance down: %+v", got)
	}
	if !sup.TracksInstance("retry-failed") {
		t.Fatal("retry did not start a process")
	}
	_ = sup.Stop(ctx, "retry-failed")
}

// TestReconcileRestartsFailedLongRunningInstance pins the failed-status
// recovery: a failed start leaves nothing else to retry it, so the reconcile
// backstop must treat failed as a liveness claim.
func TestReconcileRestartsFailedLongRunningInstance(t *testing.T) {
	dataDir, st, _ := setupSupervisorHelperRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "failed-recover", ServiceID: "echo"}); err != nil {
		t.Fatal(err)
	}
	inst, err := st.GetInstance(ctx, "failed-recover")
	if err != nil {
		t.Fatal(err)
	}
	inst.Enabled = true
	inst.Status = domain.StatusFailed
	inst.PID = nil
	if err := st.UpsertInstance(ctx, inst); err != nil {
		t.Fatal(err)
	}
	sup.ReconcileProcesses(ctx)
	if !sup.TracksInstance("failed-recover") {
		t.Fatal("failed long-running instance was not restarted")
	}
	_ = sup.Stop(ctx, "failed-recover")
}

// TestUpdateConfigRestartKeepsColdScaleToZeroCold pins the cold-instance guard:
// an explicit --restart reloads content but must not warm a parked instance.
func TestUpdateConfigRestartKeepsColdScaleToZeroCold(t *testing.T) {
	dataDir, st := setupScaleToZeroRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "stz-cold-update", ServiceID: "echo"}); err != nil {
		t.Fatal(err)
	}
	if _, err := sup.UpdateConfig(ctx, "stz-cold-update", []byte(`{"changed":true}`), true); err != nil {
		t.Fatal(err)
	}
	if sup.TracksInstance("stz-cold-update") {
		t.Fatal("--restart warmed a cold scale-to-zero instance")
	}
	got, err := st.GetInstance(ctx, "stz-cold-update")
	if err != nil {
		t.Fatal(err)
	}
	if !got.Enabled || got.Status != domain.StatusStopped || got.PID != nil {
		t.Fatalf("cold instance changed state: %+v", got)
	}
}

// TestEnsureStartedSharesRecentStartFailure pins the failure side of the
// singleflight: callers queued behind a failed start reuse its error instead of
// each running another health-checked start.
func TestEnsureStartedSharesRecentStartFailure(t *testing.T) {
	dataDir, st := setupScaleToZeroRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "stz-fail", ServiceID: "echo"}); err != nil {
		t.Fatal(err)
	}
	failure := errors.New("start failed")
	sup.mu.Lock()
	sup.startFailures["stz-fail"] = startFailure{err: failure, at: time.Now()}
	sup.mu.Unlock()
	if _, err := sup.EnsureStarted(ctx, "stz-fail"); !errors.Is(err, failure) {
		t.Fatalf("EnsureStarted err = %v, want the shared failure", err)
	}
	if sup.TracksInstance("stz-fail") {
		t.Fatal("EnsureStarted started a process despite the shared failure")
	}
}

// TestRestartIfWarmIgnoresExitedTrackedState pins the warm check: an entry
// whose process already exited is not warm, and must not be reported as
// restarted by an import.
func TestRestartIfWarmIgnoresExitedTrackedState(t *testing.T) {
	dataDir, st := setupScaleToZeroRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "stz-exited-restart", ServiceID: "echo"}); err != nil {
		t.Fatal(err)
	}
	exited := &processState{done: make(chan struct{})}
	close(exited.done)
	sup.mu.Lock()
	sup.procs["stz-exited-restart"] = exited
	sup.mu.Unlock()
	if sup.TracksInstance("stz-exited-restart") {
		t.Fatal("an exited process was reported as warm")
	}
	warm, err := sup.RestartIfWarm(ctx, "stz-exited-restart")
	if err != nil {
		t.Fatal(err)
	}
	if warm {
		t.Fatal("RestartIfWarm reported a restart for an exited process")
	}
}

// TestShutdownAfterInstanceDeleteSucceeds pins forgetInstance: a deleted
// instance must not leave its generation behind and poison a clean shutdown.
func TestShutdownAfterInstanceDeleteSucceeds(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is unix-only")
	}
	dataDir, st, _ := setupSupervisorHelperRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "deleted-then-shutdown", ServiceID: "echo", Start: true}); err != nil {
		t.Fatal(err)
	}
	if err := sup.DeleteInstance(ctx, "deleted-then-shutdown"); err != nil {
		t.Fatal(err)
	}
	if err := sup.Shutdown(ctx); err != nil {
		t.Fatalf("shutdown after delete: %v", err)
	}
}

// TestEnsureStartedRejectsCanceledContext pins the gate-entry check: a caller
// that gave up while queued must not take a ref or start the process.
func TestEnsureStartedRejectsCanceledContext(t *testing.T) {
	dataDir, st := setupScaleToZeroRuntime(t)
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(context.Background(), CreateInstanceRequest{ID: "stz-canceled", ServiceID: "echo"}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := sup.EnsureStarted(ctx, "stz-canceled"); !errors.Is(err, context.Canceled) {
		t.Fatalf("EnsureStarted err = %v, want context.Canceled", err)
	}
	if sup.TracksInstance("stz-canceled") {
		t.Fatal("a canceled request started the instance")
	}
	sup.mu.Lock()
	refs := 0
	if st := sup.procs["stz-canceled"]; st != nil {
		refs = st.refs
	}
	sup.mu.Unlock()
	if refs != 0 {
		t.Fatalf("a canceled request took %d refs", refs)
	}
}

// TestCreateInstanceFailedScaleToZeroLandsCold pins the sync recovery rule: a
// failed scale-to-zero row comes back cold, not warm, or a bulk sync would
// wake every failed instance.
func TestCreateInstanceFailedScaleToZeroLandsCold(t *testing.T) {
	dataDir, st := setupScaleToZeroRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "stz-failed-sync", ServiceID: "echo"}); err != nil {
		t.Fatal(err)
	}
	inst, err := st.GetInstance(ctx, "stz-failed-sync")
	if err != nil {
		t.Fatal(err)
	}
	inst.Enabled = true
	inst.Status = domain.StatusFailed
	inst.PID = nil
	if err := st.UpsertInstance(ctx, inst); err != nil {
		t.Fatal(err)
	}
	got, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "stz-failed-sync", ServiceID: "echo"})
	if err != nil {
		t.Fatal(err)
	}
	if sup.TracksInstance("stz-failed-sync") {
		t.Fatal("a failed scale-to-zero instance was warmed by a sync")
	}
	if !got.Enabled || got.Status != domain.StatusStopped {
		t.Fatalf("failed scale-to-zero row did not land cold: %+v", got)
	}
}

// TestCreateInstanceContentChangeRecoversFailedRow pins the same-mode recovery:
// a content-changing sync against a failed, process-less row must start the
// instance instead of returning it with a nil error.
func TestCreateInstanceContentChangeRecoversFailedRow(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is unix-only")
	}
	dataDir, st, _ := setupSupervisorHelperRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "failed-content", ServiceID: "echo"}); err != nil {
		t.Fatal(err)
	}
	inst, err := st.GetInstance(ctx, "failed-content")
	if err != nil {
		t.Fatal(err)
	}
	inst.Enabled = true
	inst.Status = domain.StatusFailed
	inst.PID = nil
	if err := st.UpsertInstance(ctx, inst); err != nil {
		t.Fatal(err)
	}
	got, err := sup.CreateInstance(ctx, CreateInstanceRequest{
		ID: "failed-content", ServiceID: "echo", Config: json.RawMessage(`{"changed":true}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != domain.StatusRunning || got.PID == nil {
		t.Fatalf("content-changing sync left the failed row down: %+v", got)
	}
	if !sup.TracksInstance("failed-content") {
		t.Fatal("content-changing sync did not start the process")
	}
	_ = sup.Stop(ctx, "failed-content")
}

// TestUpdateConfigRestartClearsStaleListenAddr pins the disabled-restart write:
// the pre-stop snapshot must not resurrect the address stopProcess cleared.
func TestUpdateConfigRestartClearsStaleListenAddr(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is unix-only")
	}
	dataDir, st, _ := setupSupervisorHelperRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "stale-addr", ServiceID: "echo", Start: true}); err != nil {
		t.Fatal(err)
	}
	inst, err := st.GetInstance(ctx, "stale-addr")
	if err != nil {
		t.Fatal(err)
	}
	// The shape the bug needs: disabled row that still carries an address.
	inst.Enabled = false
	inst.Status = domain.StatusStopped
	inst.PID = nil
	inst.ListenAddr = "127.0.0.1:1"
	if err := st.UpsertInstance(ctx, inst); err != nil {
		t.Fatal(err)
	}
	if _, err := sup.UpdateConfig(ctx, "stale-addr", []byte(`{}`), true); err != nil {
		t.Fatal(err)
	}
	got, err := st.GetInstance(ctx, "stale-addr")
	if err != nil {
		t.Fatal(err)
	}
	if got.ListenAddr != "" {
		t.Fatalf("disabled restart restored a stale listen address: %q", got.ListenAddr)
	}
}

// TestEnsureStartedDisabledDoesNotCountColdStart pins the metric ordering: a
// stopped instance is not a cold start and must not touch the activity clock.
func TestEnsureStartedDisabledDoesNotCountColdStart(t *testing.T) {
	dataDir, st := setupScaleToZeroRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "stz-disabled-count", ServiceID: "echo"}); err != nil {
		t.Fatal(err)
	}
	inst, err := st.GetInstance(ctx, "stz-disabled-count")
	if err != nil {
		t.Fatal(err)
	}
	inst.Enabled = false
	if err := st.UpsertInstance(ctx, inst); err != nil {
		t.Fatal(err)
	}
	sup.mu.Lock()
	before := sup.counters.ScaleToZeroColdStarts
	sup.mu.Unlock()
	if _, err := sup.EnsureStarted(ctx, "stz-disabled-count"); err == nil {
		t.Fatal("EnsureStarted on a disabled instance returned nil")
	}
	sup.mu.Lock()
	after := sup.counters.ScaleToZeroColdStarts
	activity := sup.lastActivity["stz-disabled-count"]
	sup.mu.Unlock()
	if after != before {
		t.Fatalf("disabled call counted as a cold start: %d -> %d", before, after)
	}
	if !activity.IsZero() {
		t.Fatalf("disabled call touched the activity clock: %v", activity)
	}
}

// TestSetRuntimeModeStalePIDStartsLongRunning pins the failed-row switch: a
// health-check failure leaves the row failed with a stale pid, and switching
// to long-running must start a real process, not read the pid as warm.
func TestSetRuntimeModeStalePIDStartsLongRunning(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is unix-only")
	}
	dataDir, st := setupScaleToZeroRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "stale-pid-switch", ServiceID: "echo"}); err != nil {
		t.Fatal(err)
	}
	inst, err := st.GetInstance(ctx, "stale-pid-switch")
	if err != nil {
		t.Fatal(err)
	}
	// The shape a failed start leaves behind: enabled/failed with a stale pid.
	stale := 2147483647 - 1
	inst.Enabled = true
	inst.Status = domain.StatusFailed
	inst.PID = &stale
	if err := st.UpsertInstance(ctx, inst); err != nil {
		t.Fatal(err)
	}
	if _, err := sup.SetRuntimeMode(ctx, "stale-pid-switch", domain.RuntimeModeLongRunning); err != nil {
		t.Fatal(err)
	}
	if !sup.TracksInstance("stale-pid-switch") {
		t.Fatal("switch to long-running did not start a process")
	}
	_ = sup.Stop(ctx, "stale-pid-switch")
}

// TestDeleteTrackedOnDemandInstanceStopsProcess pins the delete path: an
// on-demand instance with a stray tracked process must not leak it.
func TestDeleteTrackedOnDemandInstanceStopsProcess(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is unix-only")
	}
	dataDir, st, _ := setupSupervisorHelperRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "od-delete", ServiceID: "echo", Start: true}); err != nil {
		t.Fatal(err)
	}
	if !sup.TracksInstance("od-delete") {
		t.Fatal("expected a warm process")
	}
	// The import that flips the service to on-demand lands after the process
	// was tracked: exactly the surplus shape reconcile exists to clean up.
	svc, err := st.GetService(ctx, "echo")
	if err != nil {
		t.Fatal(err)
	}
	svc.RuntimeMode = domain.RuntimeModeOnDemand
	if err := st.UpsertService(ctx, svc); err != nil {
		t.Fatal(err)
	}
	if err := sup.DeleteInstance(ctx, "od-delete"); err != nil {
		t.Fatal(err)
	}
	if sup.TracksInstance("od-delete") {
		t.Fatal("delete left the tracked process behind")
	}
	if _, err := st.GetInstance(ctx, "od-delete"); err == nil {
		t.Fatal("row survived the delete")
	}
}

// TestApplyServiceRuntimeModeKeepsOperatorStop pins the stop rule: an import
// flipping a service's mode must not re-enable an operator-stopped instance.
func TestApplyServiceRuntimeModeKeepsOperatorStop(t *testing.T) {
	dataDir, st := setupScaleToZeroRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "stz-stopped-flip", ServiceID: "echo"}); err != nil {
		t.Fatal(err)
	}
	if err := sup.Stop(ctx, "stz-stopped-flip"); err != nil {
		t.Fatal(err)
	}
	svc, err := st.GetService(ctx, "echo")
	if err != nil {
		t.Fatal(err)
	}
	svc.RuntimeMode = domain.RuntimeModeOnDemand
	if err := st.UpsertService(ctx, svc); err != nil {
		t.Fatal(err)
	}
	if err := sup.ApplyServiceRuntimeMode(ctx, "stz-stopped-flip"); err != nil {
		t.Fatal(err)
	}
	got, err := st.GetInstance(ctx, "stz-stopped-flip")
	if err != nil {
		t.Fatal(err)
	}
	if got.Enabled {
		t.Fatalf("import re-enabled an operator-stopped instance: %+v", got)
	}
}

// TestCreateInstanceNormalizesOnDemandRowShape pins the sync repair: an
// on-demand row stuck in enabled/stopped is normalized to enabled/running by
// an otherwise unchanged create.
func TestCreateInstanceNormalizesOnDemandRowShape(t *testing.T) {
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
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "od-shape", ServiceID: "echo", Enabled: true, Status: domain.StatusStopped, NodeEntry: "fixture-entry", ConfigJSON: []byte(`{}`), SecretJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	sup := New(dataDir, st)
	got, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "od-shape", ServiceID: "echo"})
	if err != nil {
		t.Fatal(err)
	}
	if !got.Enabled || got.Status != domain.StatusRunning || got.PID != nil {
		t.Fatalf("on-demand row shape not normalized: %+v", got)
	}
}

// TestLiveProcessLockedIsReadOnly pins the observation contract: an
// exited-but-unreaped entry is reported cold, and wait() keeps its ownership
// (the entry is not pruned out from under it).
func TestLiveProcessLockedIsReadOnly(t *testing.T) {
	sup := New(t.TempDir(), nil)
	exited := &processState{done: make(chan struct{})}
	close(exited.done)
	sup.mu.Lock()
	sup.procs["read-only"] = exited
	live := sup.liveProcessLocked("read-only")
	_, stillThere := sup.procs["read-only"]
	sup.mu.Unlock()
	if live {
		t.Fatal("an exited process was reported live")
	}
	if !stillThere {
		t.Fatal("liveProcessLocked pruned the entry; wait() loses ownership")
	}
}

// TestScanParksAfterModeSwitch pins the scan's cache gate: a long-running
// instance that switches to scale-to-zero (cache set by the switch) must be
// parked by the next scan, never stranded warm behind the anyScaleToZero
// early return.
func TestScanParksAfterModeSwitch(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is unix-only")
	}
	dataDir, st, _ := setupSupervisorHelperRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "switch-park", ServiceID: "echo", Start: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := sup.SetRuntimeMode(ctx, "switch-park", domain.RuntimeModeScaleToZero); err != nil {
		t.Fatal(err)
	}
	if !sup.TracksInstance("switch-park") {
		t.Fatal("switch lost the resident process")
	}
	sup.mu.Lock()
	sup.stzIdleTTL = time.Minute
	sup.lastActivity["switch-park"] = time.Now().Add(-2 * time.Minute)
	sup.mu.Unlock()
	sup.scanScaleToZero(ctx)
	if sup.TracksInstance("switch-park") {
		t.Fatal("the scan never parked the switched instance")
	}
	got, err := st.GetInstance(ctx, "switch-park")
	if err != nil {
		t.Fatal(err)
	}
	if !got.Enabled || got.Status != domain.StatusStopped {
		t.Fatalf("parked row shape wrong: %+v", got)
	}
}

// TestSetRuntimeModeEqualModeNormalizesOnDemandShape pins the equal-mode PATCH:
// an on-demand row stuck in enabled/stopped is normalized when the operator
// re-applies the mode.
func TestSetRuntimeModeEqualModeNormalizesOnDemandShape(t *testing.T) {
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
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "od-equal", ServiceID: "echo", Enabled: true, Status: domain.StatusStopped, NodeEntry: "fixture-entry", ConfigJSON: []byte(`{}`), SecretJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	sup := New(dataDir, st)
	if _, err := sup.SetRuntimeMode(ctx, "od-equal", domain.RuntimeModeOnDemand); err != nil {
		t.Fatal(err)
	}
	got, err := st.GetInstance(ctx, "od-equal")
	if err != nil {
		t.Fatal(err)
	}
	if !got.Enabled || got.Status != domain.StatusRunning || got.PID != nil {
		t.Fatalf("equal-mode PATCH did not normalize the on-demand shape: %+v", got)
	}
}

// TestRestartLockedNormalizesCrashRemnant pins the cold-stz shortcut: a row
// still claiming a running process after a crash is landed cold, and the
// restart reports success honestly (the content was written, nothing to
// restart).
func TestRestartLockedNormalizesCrashRemnant(t *testing.T) {
	dataDir, st := setupScaleToZeroRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "stz-remnant", ServiceID: "echo"}); err != nil {
		t.Fatal(err)
	}
	inst, err := st.GetInstance(ctx, "stz-remnant")
	if err != nil {
		t.Fatal(err)
	}
	// The shape a kill -9 remnant leaves: running with a stale pid/addr and
	// no tracked process.
	stale := 2147483647 - 1
	inst.Enabled = true
	inst.Status = domain.StatusRunning
	inst.PID = &stale
	inst.ListenAddr = "127.0.0.1:1"
	if err := st.UpsertInstance(ctx, inst); err != nil {
		t.Fatal(err)
	}
	unlock := sup.lockInstance("stz-remnant")
	err = sup.restartLocked(ctx, "stz-remnant", true)
	unlock()
	if err != nil {
		t.Fatal(err)
	}
	got, err := st.GetInstance(ctx, "stz-remnant")
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != domain.StatusStopped || got.PID != nil || got.ListenAddr != "" {
		t.Fatalf("crash remnant not landed cold: %+v", got)
	}
	if sup.TracksInstance("stz-remnant") {
		t.Fatal("the remnant restart warmed the instance")
	}
}

// TestCreateInstanceOnDemandRebindRollsBack pins the od -> long-running switch:
// a failed start must roll the row back to on-demand's servable shape,
// mirroring SetRuntimeMode's failure handling.
func TestCreateInstanceOnDemandRebindRollsBack(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is unix-only")
	}
	dataDir, st, entry := setupSupervisorHelperRuntime(t)
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
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "od-rebind", ServiceID: "echo"}); err != nil {
		t.Fatal(err)
	}
	// Break the runtime so the switch's start fails its health check.
	entryPath := filepath.Join(dataDir, "artifacts", "services", "echo", "runtime", entry)
	if err := os.WriteFile(entryPath, []byte("#!/bin/sh\nexit 1\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	got, err := sup.CreateInstance(ctx, CreateInstanceRequest{
		ID: "od-rebind", ServiceID: "echo", RuntimeMode: domain.RuntimeModeLongRunning,
	})
	if err == nil {
		t.Fatal("expected the switch to fail its health check")
	}
	_ = got
	// The rollback restores the on-demand servable shape with the previous
	// (empty = inherit) override, mirroring SetRuntimeMode's failure handling.
	fresh, err := st.GetInstance(ctx, "od-rebind")
	if err != nil {
		t.Fatal(err)
	}
	if fresh.RuntimeMode != "" {
		t.Fatalf("override = %q, want empty (inherit)", fresh.RuntimeMode)
	}
	if fresh.Enabled != true || fresh.Status != domain.StatusRunning || fresh.PID != nil {
		t.Fatalf("rollback left the row unservable: enabled=%v status=%s pid=%v", fresh.Enabled, fresh.Status, fresh.PID)
	}
}
