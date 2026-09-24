package e2e

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc/metadata"

	"octobus/internal/hardening"
)

// hardeningProbe replaces the calculator's label so the runtime reports what
// it can actually do, rather than what process.permission.has claims: has()
// returns false for any unknown scope name too, so a renamed scope would pass
// silently. Each attempt reports "allowed" or the error code it failed with.
// Writing the workdir must succeed, which pins down that the grants apply at
// all; reading the daemon database and starting a child must be denied.
const hardeningProbe = `label: (() => {
        const attempt = (fn) => { try { fn(); return "allowed"; } catch (e) { return e.code ?? String(e); } };
        return JSON.stringify({
          label: config.label || "",
          writeWorkdir: attempt(() => fs.writeFileSync(path.join(process.cwd(), "hardening-probe.txt"), "ok")),
          readDB: attempt(() => fs.readFileSync(path.resolve(process.cwd(), "..", "..", "octobus.db"))),
          child: attempt(() => process.getBuiltinModule("node:child_process").execFileSync(process.execPath, ["-e", ""])),
          canary: process.env.OCTOBUS_E2E_CANARY ?? null,
        });
      })(),`

type hardeningReport struct {
	Label        string  `json:"label"`
	WriteWorkdir string  `json:"writeWorkdir"`
	ReadDB       string  `json:"readDB"`
	Child        string  `json:"child"`
	Canary       *string `json:"canary"`
}

// TestRuntimeHardeningRunsRealNodeServices checks that real SDK services run
// at level node in both runtime modes, and that each runtime reports the
// restrictions of that level from the inside.
func TestRuntimeHardeningRunsRealNodeServices(t *testing.T) {
	// Skip only when node is missing or too old. A node that fails the daemon's
	// NODE_OPTIONS probe must fail this test at daemon startup, not skip it.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	out, err := exec.CommandContext(ctx, "node", "--version").Output()
	cancel()
	if err != nil {
		t.Skipf("runtime hardening needs node on PATH: %v", err)
	}
	if _, err := hardening.ParseNodeVersion(strings.TrimSpace(string(out))); err != nil {
		t.Skipf("runtime hardening needs a supported node on PATH: %v", err)
	}
	h := newHarnessWithDaemonEnv(t, "OCTOBUS_RUNTIME_HARDENING=node", "OCTOBUS_E2E_CANARY=leaked")
	configPath := filepath.Join(h.root, "config.json")
	writeJSONFile(t, configPath, map[string]any{"label": "hardened"})
	secretPath := filepath.Join(h.root, "secret.json")
	writeJSONFile(t, secretPath, map[string]any{"apiToken": "hardened-secret"})

	h.mustCLI("service", "import", "calculator", hardeningProbePackage(t, calculatorPackagePath(t)))
	h.mustCLI("instance", "create", "calc-long", "--service", "calculator", "--config", configPath, "--secret", secretPath)
	h.mustCLI("service", "import", "calculator-on-demand", hardeningProbePackage(t, calculatorOnDemandPackagePath(t)))
	h.mustCLI("instance", "create", "calc-demand", "--service", "calculator-on-demand", "--config", configPath, "--secret", secretPath, "--no-start")
	h.mustCLI("capset", "create", "dev", "--name", "DevAgent")
	h.mustCLI("capset", "add-instance", "dev", "calc-long")
	h.mustCLI("capset", "add-instance", "dev", "calc-demand")
	h.waitCatalogRunning()

	// No subtests: the harness helpers fail through the parent test. On
	// failure, log the runtime's own logs, which hold any permission-model
	// denial, instead of the daemon buffers the harness is still writing to.
	for _, tc := range []struct{ serviceID, instanceID string }{
		{"calculator", "calc-long"},
		{"calculator-on-demand", "calc-demand"},
	} {
		fail := func(format string, args ...any) {
			t.Helper()
			logRuntimeLogs(t, h, tc.instanceID)
			t.Fatalf(tc.instanceID+": "+format, args...)
		}
		serviceRow := h.readDB(`SELECT descriptor_path FROM services WHERE id = ?`, tc.serviceID)
		files := descriptorFiles(t, serviceRow["descriptor_path"])
		req := protoJSONToWire(t, mustMessage(t, files, "calculator.v1.BinaryOperationRequest"), `{"left":20,"right":22}`)
		raw, err := h.grpcInvoke(context.Background(), "calculator.v1.CalculatorService/Add", metadata.Pairs(
			"x-octobus-capset", "dev",
			"x-octobus-instance", tc.instanceID,
		), req)
		if err != nil {
			fail("invoke: %v", err)
		}
		resp := wireToMap(t, mustMessage(t, files, "calculator.v1.CalculatorResponse"), raw)
		if resp["result"] != float64(42) || resp["secretToken"] != "hardened-secret" || resp["instanceId"] != tc.instanceID {
			fail("unexpected hardened response: %+v", resp)
		}
		label, _ := resp["label"].(string)
		var report hardeningReport
		if err := json.Unmarshal([]byte(label), &report); err != nil {
			fail("runtime did not return a hardening report: %q: %v", label, err)
		}
		if report.Label != "hardened" {
			fail("runtime lost its config: %+v", report)
		}
		if report.WriteWorkdir != "allowed" {
			fail("runtime cannot write its own workdir: %s", label)
		}
		if report.ReadDB != "ERR_ACCESS_DENIED" || report.Child != "ERR_ACCESS_DENIED" {
			fail("runtime may read octobus.db or start child processes: %s", label)
		}
		if report.Canary != nil {
			fail("daemon environment leaked into the runtime: %s", label)
		}
	}
}

// logRuntimeLogs logs an instance's runtime logs. Long-running runtimes write
// them to the instance dir; on-demand errors are part of the invoke error.
func logRuntimeLogs(t *testing.T, h *harness, instanceID string) {
	t.Helper()
	for _, name := range []string{"stdout.log", "stderr.log"} {
		if raw, err := os.ReadFile(filepath.Join(h.dataDir, "instances", instanceID, name)); err == nil {
			t.Logf("%s/%s:\n%s", instanceID, name, raw)
		}
	}
}

// hardeningProbePackage copies an example calculator package and swaps its
// label for hardeningProbe.
func hardeningProbePackage(t *testing.T, src string) string {
	t.Helper()
	dst := filepath.Join(t.TempDir(), filepath.Base(src))
	copyDirForTest(t, src, dst)
	entry := filepath.Join(dst, "bin", "calculator.js")
	raw, err := os.ReadFile(entry)
	if err != nil {
		t.Fatal(err)
	}
	const original = `label: config.label || "",`
	if !strings.Contains(string(raw), original) {
		t.Fatalf("%s no longer sets the label as %q; update hardeningProbe", entry, original)
	}
	if err := os.WriteFile(entry, []byte(strings.Replace(string(raw), original, hardeningProbe, 1)), 0o755); err != nil {
		t.Fatal(err)
	}
	return dst
}
