package e2e

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
)

// serveProcessCount counts live `--runtime serve` processes in the daemon's
// instance workdirs. The daemon runs in this test process tree, so a leak is a
// descendant here and shows up in the count.
func serveProcessCount(t *testing.T, dataDir string) int {
	t.Helper()
	entries, err := os.ReadDir("/proc")
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}
		argvRaw, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/cmdline")
		if err != nil {
			continue
		}
		argv := strings.Split(string(argvRaw), "\x00")
		isServe := false
		for i, arg := range argv {
			if arg == "--runtime" && i+1 < len(argv) && argv[i+1] == "serve" {
				isServe = true
				break
			}
		}
		if !isServe {
			continue
		}
		cwd, err := os.Readlink("/proc/" + strconv.Itoa(pid) + "/cwd")
		if err != nil || !strings.HasPrefix(cwd, dataDir+string(os.PathSeparator)+"instances") {
			continue
		}
		count++
	}
	return count
}

// TestRepeatedInstanceCreateDoesNotLeakProcesses reproduces the whole-package
// sync leak: the upstream management client's whole-package sync calls
// instance create once per instance on every sync. Before the fix each call
// stacked another node process; after, it is a no-op.
func TestRepeatedInstanceCreateDoesNotLeakProcesses(t *testing.T) {
	h := newHarness(t)
	importCalculator(t, h, "calculator")

	configPath := filepath.Join(h.root, "config.json")
	writeJSONFile(t, configPath, map[string]any{"label": "sync"})
	secretPath := filepath.Join(h.root, "secret.json")
	writeJSONFile(t, secretPath, map[string]any{"apiToken": "s"})

	// The first create starts the resident process.
	h.mustCLI("instance", "create", "sync-victim", "--service", "calculator", "--config", configPath, "--secret", secretPath)
	before := serveProcessCount(t, h.dataDir)
	if before != 1 {
		t.Fatalf("expected 1 serve process after create, got %d", before)
	}

	// Ten syncs later: same call, same process.
	for i := 0; i < 10; i++ {
		h.mustCLI("instance", "create", "sync-victim", "--service", "calculator", "--config", configPath, "--secret", secretPath)
	}
	after := serveProcessCount(t, h.dataDir)
	if after != 1 {
		t.Fatalf("repeated create leaked processes: %d serve processes (was %d)", after, before)
	}

	// A content change restarts in place: still exactly one process.
	writeJSONFile(t, configPath, map[string]any{"label": "sync2"})
	h.mustCLI("instance", "create", "sync-victim", "--service", "calculator", "--config", configPath, "--secret", secretPath)
	if count := serveProcessCount(t, h.dataDir); count != 1 {
		t.Fatalf("content-changing create leaked: %d serve processes", count)
	}
	inst := h.readDB(`SELECT pid FROM instances WHERE id = ?`, "sync-victim")
	firstPID := h.readDB(`SELECT pid FROM instances WHERE id = ?`, "sync-victim")
	_ = inst
	if firstPID["pid"] == "" {
		t.Fatal("instance has no pid after restart")
	}
}

// TestScaleToZeroWarmRecycle covers the scale-to-zero lifecycle against the real daemon and a
// real node runtime: cold start on first call, warm reuse, idle park, recall.
func TestScaleToZeroWarmRecycle(t *testing.T) {
	h := newHarnessWithDaemonEnv(t, "OCTOBUS_SCALE_TO_ZERO_IDLE_TTL=3s")
	importCalculator(t, h, "calculator")

	configPath := filepath.Join(h.root, "config.json")
	writeJSONFile(t, configPath, map[string]any{"label": "scale-to-zero"})
	secretPath := filepath.Join(h.root, "secret.json")
	writeJSONFile(t, secretPath, map[string]any{"apiToken": "s"})
	h.mustCLI("instance", "create", "stz-calc", "--service", "calculator", "--runtime-mode", "scale-to-zero", "--config", configPath, "--secret", secretPath, "--no-start")

	inst := h.readDB(`SELECT enabled, status, pid FROM instances WHERE id = ?`, "stz-calc")
	if inst["enabled"] != "1" || inst["status"] != "stopped" || inst["pid"] != "" {
		t.Fatalf("scale-to-zero instance must come cold and enabled, got %+v", inst)
	}
	if serveProcessCount(t, h.dataDir) != 0 {
		t.Fatal("scale-to-zero instance must not start a process at create")
	}

	h.mustCLI("capset", "create", "dev", "--name", "DevAgent")
	h.mustCLI("capset", "add-instance", "dev", "stz-calc")
	// A scale-to-zero backend is legitimately "stopped" until the first call, so the
	// catalog-running helper does not apply; wait for the method to be exposed.
	waitForExposedMethod(t, h)

	invoke := func() map[string]any {
		files := descriptorFiles(t, h.readDB(`SELECT descriptor_path FROM services WHERE id = ?`, "calculator")["descriptor_path"])
		reqDesc := mustMessage(t, files, "calculator.v1.BinaryOperationRequest")
		respDesc := mustMessage(t, files, "calculator.v1.CalculatorResponse")
		req := protoJSONToWire(t, reqDesc, `{"left":20,"right":22}`)
		raw, err := h.grpcInvoke(context.Background(), "calculator.v1.CalculatorService/Add", metadata.Pairs(
			"x-octobus-capset", "dev",
			"x-octobus-instance", "stz-calc",
		), req)
		if err != nil {
			t.Fatalf("invoke: %v", err)
		}
		return wireToMap(t, respDesc, raw)
	}

	// First call: cold start, then the answer.
	resp := invoke()
	if resp["result"] != float64(42) {
		t.Fatalf("first call result=%v", resp["result"])
	}
	if serveProcessCount(t, h.dataDir) != 1 {
		t.Fatal("first call did not warm exactly one process")
	}
	firstPID := h.readDB(`SELECT pid FROM instances WHERE id = ?`, "stz-calc")["pid"]
	if firstPID == "" {
		t.Fatal("warmed instance has no pid")

	}
	// Second call inside the TTL: warm path, same process.
	resp = invoke()
	if resp["result"] != float64(42) {
		t.Fatalf("warm call result=%v", resp["result"])
	}
	warmPID := h.readDB(`SELECT pid FROM instances WHERE id = ?`, "stz-calc")["pid"]
	if warmPID != firstPID {
		t.Fatalf("warm call restarted the process: %s -> %s", firstPID, warmPID)
	}

	// Idle past the TTL: the scan parks it, row cold and enabled.
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if serveProcessCount(t, h.dataDir) == 0 {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	if serveProcessCount(t, h.dataDir) != 0 {
		t.Fatal("idle instance was not parked within 30s")
	}
	// The process is gone; the row write can lag it under parallel e2e load
	// (bounded SQLite connections), so wait for convergence instead of
	// asserting the instant the process count drops.
	parkedRow := ""
	for attempt := 0; attempt < 50; attempt++ {
		parked := h.readDB(`SELECT enabled, status, pid FROM instances WHERE id = ?`, "stz-calc")
		parkedRow = fmt.Sprintf("%+v", parked)
		if parked["enabled"] == "1" && parked["status"] == "stopped" && parked["pid"] == "" {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	if !strings.Contains(parkedRow, "status:stopped") {
		t.Fatalf("parked row never converged to enabled/stopped/no pid, last=%s", parkedRow)
	}

	// The next call re-warms a fresh process.
	resp = invoke()
	if resp["result"] != float64(42) {
		t.Fatalf("recall result=%v", resp["result"])
	}
	recallPID := h.readDB(`SELECT pid FROM instances WHERE id = ?`, "stz-calc")["pid"]
	if recallPID == "" || recallPID == firstPID {
		t.Fatalf("recall did not start a fresh process: %s -> %s", firstPID, recallPID)
	}
}

// TestScaleToZeroConcurrentCallsStartOnce proves the singleflight under a real
// daemon: N simultaneous first calls produce one cold start, and all get the
// right answer.
func TestScaleToZeroConcurrentCallsStartOnce(t *testing.T) {
	h := newHarnessWithDaemonEnv(t, "OCTOBUS_SCALE_TO_ZERO_IDLE_TTL=60s")
	importCalculator(t, h, "calculator")

	configPath := filepath.Join(h.root, "config.json")
	writeJSONFile(t, configPath, map[string]any{"label": "concurrent"})
	secretPath := filepath.Join(h.root, "secret.json")
	writeJSONFile(t, secretPath, map[string]any{"apiToken": "s"})
	h.mustCLI("instance", "create", "stz-conc", "--service", "calculator", "--runtime-mode", "scale-to-zero", "--config", configPath, "--secret", secretPath, "--no-start")
	h.mustCLI("capset", "create", "dev", "--name", "DevAgent")
	h.mustCLI("capset", "add-instance", "dev", "stz-conc")
	waitForExposedMethod(t, h)

	files := descriptorFiles(t, h.readDB(`SELECT descriptor_path FROM services WHERE id = ?`, "calculator")["descriptor_path"])
	reqDesc := mustMessage(t, files, "calculator.v1.BinaryOperationRequest")
	respDesc := mustMessage(t, files, "calculator.v1.CalculatorResponse")
	req := protoJSONToWire(t, reqDesc, `{"left":1,"right":2}`)

	const callers = 8
	type result struct {
		value any
		pid   string
	}
	results := make([]result, callers)
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < callers; i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			raw, err := h.grpcInvoke(context.Background(), "calculator.v1.CalculatorService/Add", metadata.Pairs(
				"x-octobus-capset", "dev",
				"x-octobus-instance", "stz-conc",
			), req)
			if err != nil {
				t.Errorf("caller %d: %v", i, err)
				return
			}
			resp := wireToMap(t, respDesc, raw)
			results[i] = result{value: resp["result"], pid: h.readDB(`SELECT pid FROM instances WHERE id = ?`, "stz-conc")["pid"]}
		}()
	}
	close(start)
	wg.Wait()
	for i, r := range results {
		if r.value != float64(3) {
			t.Fatalf("caller %d result=%v want 3", i, r.value)
		}
	}
	// One warm process, and every caller observed the same pid: no caller
	// raced a second start.
	if got := serveProcessCount(t, h.dataDir); got != 1 {
		t.Fatalf("concurrent first calls left %d serve processes, want 1", got)
	}
	pid := h.readDB(`SELECT pid FROM instances WHERE id = ?`, "stz-conc")["pid"]
	for i, r := range results {
		if r.pid != pid {
			t.Fatalf("caller %d saw pid %q, instance pid is %q", i, r.pid, pid)
		}
	}
}

// TestScaleToZeroDisabledInstanceRejectsCalls checks the operator-stop contract: a
// manual stop disables the scale-to-zero instance and calls fail until an explicit
// start.
func TestScaleToZeroDisabledInstanceRejectsCalls(t *testing.T) {
	h := newHarnessWithDaemonEnv(t, "OCTOBUS_SCALE_TO_ZERO_IDLE_TTL=60s")
	importCalculator(t, h, "calculator")
	h.mustCLI("instance", "create", "stz-op", "--service", "calculator", "--runtime-mode", "scale-to-zero", "--config-json", `{"label":"op"}`, "--no-start")
	h.mustCLI("capset", "create", "dev", "--name", "DevAgent")
	h.mustCLI("capset", "add-instance", "dev", "stz-op")
	waitForExposedMethod(t, h)

	files := descriptorFiles(t, h.readDB(`SELECT descriptor_path FROM services WHERE id = ?`, "calculator")["descriptor_path"])
	reqDesc := mustMessage(t, files, "calculator.v1.BinaryOperationRequest")
	req := protoJSONToWire(t, reqDesc, `{"left":1,"right":1}`)

	_, err := h.grpcInvoke(context.Background(), "calculator.v1.CalculatorService/Add", metadata.Pairs(
		"x-octobus-capset", "dev",
		"x-octobus-instance", "stz-op",
	), req)
	if err != nil {
		t.Fatalf("cold scale-to-zero instance should start on call: %v", err)
	}

	// Operator stop: enabled=0.
	h.mustCLI("instance", "stop", "stz-op")
	stopped := h.readDB(`SELECT enabled, status, pid FROM instances WHERE id = ?`, "stz-op")
	if stopped["enabled"] != "0" || stopped["pid"] != "" {
		t.Fatalf("operator stop must disable, got %+v", stopped)
	}
	_, err = h.grpcInvoke(context.Background(), "calculator.v1.CalculatorService/Add", metadata.Pairs(
		"x-octobus-capset", "dev",
		"x-octobus-instance", "stz-op",
	), req)
	if err == nil {
		t.Fatal("call to a stopped scale-to-zero instance should fail")
	}
	if !strings.Contains(err.Error(), codes.Unavailable.String()) && !strings.Contains(err.Error(), "stopped") {
		t.Fatalf("expected Unavailable, got %v", err)
	}

	// An explicit start re-enables.
	h.mustCLI("instance", "start", "stz-op")
	raw, err := h.grpcInvoke(context.Background(), "calculator.v1.CalculatorService/Add", metadata.Pairs(
		"x-octobus-capset", "dev",
		"x-octobus-instance", "stz-op",
	), req)
	if err != nil {
		t.Fatalf("call after start: %v", err)
	}
	resp := wireToMap(t, mustMessage(t, files, "calculator.v1.CalculatorResponse"), raw)
	if resp["result"] != float64(2) {
		t.Fatalf("result=%v", resp["result"])
	}
}

// waitForExposedMethod waits until the capset exposes the calculator Add
// method. Unlike waitCatalogRunning it does not require the backend to be
// running: a scale-to-zero backend is stopped until its first call warms it.
func waitForExposedMethod(t *testing.T, h *harness) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	var cat catalog
	for time.Now().Before(deadline) {
		h.adminJSON("GET", "/admin/v1/catalog/dev?all=true", nil, 200, &cat)
		for _, item := range cat.ConnectRPC {
			if item.MethodFullName == "calculator.v1.CalculatorService/Add" {
				return
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("calculator Add was not exposed by the capset")
}
