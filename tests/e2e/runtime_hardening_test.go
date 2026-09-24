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

	"octobus/internal/egressrules"
	"octobus/internal/hardening"
)

// hardeningProbe replaces the calculator's label so the runtime reports what
// it can actually do, rather than what process.permission.has claims: has()
// returns false for any unknown scope name too, so a renamed scope would pass
// silently. Each attempt reports "allowed" or the error code it failed with.
// Writing the workdir must succeed, which pins down that the grants apply at
// all; reading the daemon database and starting a child must be denied.
//
// The egress rules are reported three ways: that the daemon injected them (the
// --require this process was launched with), that the file it names loads, and
// what that file refuses. Reading NODE_OPTIONS is the direct evidence of
// injection, and the rest is the rules' own answer, so all three are available
// synchronously — a refusal on a real dial now arrives as an error event, which
// a probe that builds a label cannot wait for. The patched calls themselves are
// covered by internal/egressrules' tests, under the same flags.
const hardeningProbe = `label: (() => {
        const attempt = (fn) => { try { fn(); return "allowed"; } catch (e) { return e.code ?? String(e); } };
        const rulesPath = (() => {
          const found = /--require="((?:[^"\\]|\\.)*)"/.exec(process.env.NODE_OPTIONS || "");
          return found ? found[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\") : null;
        })();
        // The entry is ESM, where require is not defined, so the module is
        // loaded through createRequire. It is already in the cache from the
        // --require above.
        const rules = (() => {
          if (!rulesPath) return null;
          try {
            const { createRequire } = process.getBuiltinModule("node:module");
            return createRequire(path.join(process.cwd(), "probe.cjs"))(rulesPath);
          } catch { return null; }
        })();
        const verdict = (address) => (rules ? (rules.classify(address) ? "refused" : "allowed") : "unknown");
        // Trigger one refusal, so the test can check the runtime's own log
        // carries it: a refusal is otherwise invisible to an operator.
        process.getBuiltinModule("node:net").connect({ host: "127.0.0.1", port: 9 }).on("error", () => {});
        // Loading the rules is not the same as the patches being in place, so
        // the functions they replace are named here too.
        const installed = [
          process.getBuiltinModule("node:net").connect.name,
          process.getBuiltinModule("node:net").createConnection.name,
          process.getBuiltinModule("node:net").Socket.prototype.connect.name,
          process.getBuiltinModule("node:dns").lookup.name,
          process.getBuiltinModule("node:dns").promises.lookup.name,
          String(globalThis.fetch.name),
        ].join(",");
        return JSON.stringify({
          label: config.label || "",
          writeWorkdir: attempt(() => fs.writeFileSync(path.join(process.cwd(), "hardening-probe.txt"), "ok")),
          readDB: attempt(() => fs.readFileSync(path.resolve(process.cwd(), "..", "..", "octobus.db"))),
          child: attempt(() => process.getBuiltinModule("node:child_process").execFileSync(process.execPath, ["-e", ""])),
          canary: process.env.OCTOBUS_E2E_CANARY ?? null,
          rulesInjected: rulesPath ? "yes" : "no",
          rulesLoaded: rules ? "yes" : "no",
          patches: installed,
          loopback: verdict("127.0.0.1"),
          private_: verdict("10.255.255.1"),
        });
      })(),`

type hardeningReport struct {
	Label         string  `json:"label"`
	WriteWorkdir  string  `json:"writeWorkdir"`
	ReadDB        string  `json:"readDB"`
	Child         string  `json:"child"`
	Canary        *string `json:"canary"`
	RulesInjected string  `json:"rulesInjected"`
	RulesLoaded   string  `json:"rulesLoaded"`
	Patches       string  `json:"patches"`
	Loopback      string  `json:"loopback"`
	Private       string  `json:"private_"`
}

// hardeningPatches is what the runtime must report for the functions the rules
// replace: the names of their replacements, in the order the probe reads them.
const hardeningPatches = "patchedConnect,patchedConnect,patchedSocketConnect,patchedLookup,patchedLookup,patchedFetch"

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
	mustCLIWithRuntimeLogs(t, h, "calc-long", "instance", "create", "calc-long", "--service", "calculator", "--config", configPath, "--secret", secretPath)
	h.mustCLI("service", "import", "calculator-on-demand", hardeningProbePackage(t, calculatorOnDemandPackagePath(t)))
	mustCLIWithRuntimeLogs(t, h, "calc-demand", "instance", "create", "calc-demand", "--service", "calculator-on-demand", "--config", configPath, "--secret", secretPath, "--no-start")
	h.mustCLI("capset", "create", "dev", "--name", "DevAgent")
	h.mustCLI("capset", "add-instance", "dev", "calc-long")
	h.mustCLI("capset", "add-instance", "dev", "calc-demand")
	h.waitCatalogRunning()

	// No subtests: the harness helpers fail through the parent test. On
	// failure, log the runtime's own logs, which hold any permission-model
	// denial, instead of the daemon buffers the harness is still writing to.
	for _, tc := range []struct {
		serviceID, instanceID string
		checkLog              bool
	}{
		{"calculator", "calc-long", true},
		// An on-demand runtime reports its stderr through the invoke error
		// rather than into the instance directory.
		{"calculator-on-demand", "calc-demand", false},
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
		if report.RulesInjected != "yes" || report.RulesLoaded != "yes" {
			// The daemon builds NODE_OPTIONS for every runtime; if it stopped
			// carrying the rules, or named a file the runtime cannot load, the
			// restrictions would be gone without anything else failing.
			fail("runtime was not given the egress rules: %s", label)
		}
		if report.Patches != hardeningPatches {
			// Loading the rules is not the same as their patches being in
			// place, and a patch that stopped being applied would leave every
			// address allowed.
			fail("the rules did not replace the functions they check: %s", label)
		}
		if report.Loopback != "refused" {
			fail("runtime does not refuse loopback: %s", label)
		}
		if report.Private != "allowed" {
			// Private addresses are what this platform brokers; refusing them
			// would refuse the product.
			fail("runtime refuses a private address: %s", label)
		}
		if report.Canary != nil {
			fail("daemon environment leaked into the runtime: %s", label)
		}
		if tc.checkLog {
			// The refusal has to reach the runtime's own log. The audit records
			// the call as allowed and the runtime writes nothing else, so this
			// line is the only place an operator can see that a destination was
			// refused.
			raw, err := os.ReadFile(filepath.Join(h.dataDir, "instances", tc.instanceID, "stderr.log"))
			if err != nil {
				fail("runtime log is not readable: %v", err)
			}
			if !strings.Contains(string(raw), egressrules.RefusalMarker) {
				fail("a refusal left no trace in the runtime log: %s", label)
			}
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

// mustCLIWithRuntimeLogs is mustCLI, with the instance's own logs on failure.
// A runtime that does not come up leaves the reason there rather than in the
// daemon output the harness prints, and the instance directories are its own.
func mustCLIWithRuntimeLogs(t *testing.T, h *harness, instanceID string, args ...string) {
	t.Helper()
	res := h.runCLI(args...)
	if res.err == nil {
		return
	}
	logRuntimeLogs(t, h, instanceID)
	t.Fatalf("octobus %s failed: code=%d err=%v\nstdout=%s\nstderr=%s",
		strings.Join(args, " "), res.code, res.err, res.stdout, res.stderr)
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
