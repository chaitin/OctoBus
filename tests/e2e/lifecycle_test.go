package e2e

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
)

func TestCLIResourceCRUDCommands(t *testing.T) {
	h := newHarness(t)
	cat := setupCalculator(t, h)
	add := requireMethod(t, cat, "calculator.v1.CalculatorService/Add")

	if out := h.mustCLI("service", "list"); !strings.Contains(out, `"ID": "calculator"`) {
		t.Fatalf("service list missing calculator: %s", out)
	}
	if out := h.mustCLI("service", "get", "calculator"); !strings.Contains(out, `"Name": "Calculator JS"`) || !strings.Contains(out, `"SecretSchemaPath"`) {
		t.Fatalf("service get missing service: %s", out)
	}
	if out := h.mustCLI("service", "update", "calculator", "--name", "Calculator Updated"); !strings.Contains(out, `"Name": "Calculator Updated"`) {
		t.Fatalf("service update failed: %s", out)
	}

	if out := h.mustCLI("instance", "list"); !strings.Contains(out, `"ID": "calculator-test"`) {
		t.Fatalf("instance list missing calculator-test: %s", out)
	}
	if out := h.mustCLI("instance", "get", "calculator-test"); !strings.Contains(out, `"ID": "calculator-test"`) || !strings.Contains(out, `"HasSecret": false`) {
		t.Fatalf("instance get missing calculator-test: %s", out)
	}
	if out := h.mustCLI("instance", "update", "calculator-test", "--name", "Calculator Renamed"); !strings.Contains(out, `"Name": "Calculator Renamed"`) {
		t.Fatalf("instance update failed: %s", out)
	}

	if out := h.mustCLI("capset", "list"); !strings.Contains(out, `"ID": "dev"`) {
		t.Fatalf("capset list missing dev: %s", out)
	}
	if out := h.mustCLI("capset", "get", "dev"); !strings.Contains(out, `"Name": "DevAgent"`) {
		t.Fatalf("capset get missing dev: %s", out)
	}
	if out := h.mustCLI("capset", "update", "dev", "--name", "Dev Updated", "--description", "updated tools", "--enabled=false"); !strings.Contains(out, `"Enabled": false`) {
		t.Fatalf("capset update failed: %s", out)
	}
	var unavailable map[string]any
	h.publicConnect(add.Endpoint, `{"left":1,"right":2}`, http.StatusNotFound, &unavailable)
	assertConnectError(t, unavailable, "NOT_FOUND")
	h.mustCLI("capset", "update", "dev", "--enabled=true")

	if out := h.mustCLI("capset", "list-instances", "dev"); !strings.Contains(out, `"InstanceID": "calculator-test"`) {
		t.Fatalf("capset list-instances missing calculator-test: %s", out)
	}
	if out := h.mustCLI("capset", "list-methods", "dev"); !strings.Contains(out, `calculator.v1.CalculatorService/Add`) {
		t.Fatalf("capset list-methods missing calculator method: %s", out)
	}
	h.mustCLI("capset", "unselect-method", "dev", "calculator-test", "/calculator.v1.CalculatorService/Add")
	var missing map[string]any
	h.publicConnect(add.Endpoint, `{"left":1,"right":2}`, http.StatusNotFound, &missing)
	assertConnectError(t, missing, "NOT_FOUND")

	h.mustCLI("capset", "remove-instance", "dev", "calculator-test")
	if rows := h.readDB(`SELECT count(*) AS count FROM capset_instances WHERE capset_id = ?`, "dev"); rows["count"] != "0" {
		t.Fatalf("capset instance was not removed: %+v", rows)
	}
	h.mustCLI("capset", "delete", "dev")
	h.mustCLI("instance", "delete", "calculator-test")
	if rows := h.readDB(`SELECT count(*) AS count FROM instances WHERE id = ?`, "calculator-test"); rows["count"] != "0" {
		t.Fatalf("instance was not deleted: %+v", rows)
	}
	h.mustCLI("service", "delete", "calculator")
	if rows := h.readDB(`SELECT count(*) AS count FROM services WHERE id = ?`, "calculator"); rows["count"] != "0" {
		t.Fatalf("service was not deleted: %+v", rows)
	}
}

func TestServiceUpdateRestartsEnabledInstanceAndKeepsBindingsStatic(t *testing.T) {
	h := newHarness(t)
	setupEcho(t, h)
	before := h.readDB(`SELECT pid, listen_addr FROM instances WHERE id = ?`, "echo-test")
	beforeService := h.readDB(`SELECT descriptor_sha256, descriptor_version FROM services WHERE id = ?`, "echo")

	pkgV2 := createFixturePackage(t, h.root, fixtureV2)
	out := h.mustCLI("service", "import", "echo", "--offline", pkgV2)
	if !strings.Contains(out, "echo-test") {
		t.Fatalf("service update should report restarted instance: %s", out)
	}
	after := h.readDB(`SELECT pid, listen_addr FROM instances WHERE id = ?`, "echo-test")
	afterService := h.readDB(`SELECT descriptor_sha256, descriptor_version FROM services WHERE id = ?`, "echo")
	if afterService["descriptor_sha256"] == beforeService["descriptor_sha256"] || afterService["descriptor_version"] == beforeService["descriptor_version"] {
		t.Fatalf("descriptor identity did not change: before=%+v after=%+v", beforeService, afterService)
	}
	if after["pid"] == before["pid"] && after["listen_addr"] == before["listen_addr"] {
		t.Fatalf("enabled instance was not restarted: before=%+v after=%+v", before, after)
	}

	var cat catalog
	h.adminJSON(http.MethodGet, "/admin/v1/catalog/dev", nil, http.StatusOK, &cat)
	if len(cat.GRPC) != 0 || len(cat.ConnectRPC) != 0 || len(cat.MCP) != 0 {
		t.Fatalf("stale method binding remained in catalog: %+v", cat)
	}
	var tools map[string]any
	h.mcp(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`, &tools)
	assertMCPToolError(t, tools, "NOT_FOUND")
	var missing map[string]any
	h.publicConnect("/capsets/dev/connect/echo-test/echo.v1.EchoService/Echo", `{"text":"old"}`, http.StatusNotFound, &missing)
	assertConnectError(t, missing, "NOT_FOUND")

	h.mustCLI("capset", "select-method", "dev", "echo-test", "/echo.v1.EchoService/Ping")
	cat = h.waitCatalogRunning()
	ping := requireMethod(t, cat, "echo.v1.EchoService/Ping")
	var pingResp map[string]any
	h.publicConnect(ping.Endpoint, `{"text":"new"}`, http.StatusOK, &pingResp)
	if pingResp["text"] != "new" {
		t.Fatalf("Ping call failed: %+v", pingResp)
	}
}

func TestDaemonRestartRecoversEnabledAndLeavesDisabledStopped(t *testing.T) {
	h := newHarness(t)
	cat := setupCalculator(t, h)
	add := requireMethod(t, cat, "calculator.v1.CalculatorService/Add")
	var before map[string]any
	h.publicConnect(add.Endpoint, `{"left":1,"right":2}`, http.StatusOK, &before)

	h.restart()
	cat = h.waitCatalogRunning()
	add = requireMethod(t, cat, "calculator.v1.CalculatorService/Add")
	var after map[string]any
	h.publicConnect(add.Endpoint, `{"left":3,"right":4}`, http.StatusOK, &after)
	if math.Abs(after["result"].(float64)-7) > 0.000001 || after["label"] != "e2e" {
		t.Fatalf("config was not restored after daemon restart: %+v", after)
	}
	row := h.readDB(`SELECT enabled, status, pid, listen_addr FROM instances WHERE id = ?`, "calculator-test")
	if row["enabled"] != "1" || row["status"] != "running" || row["pid"] == "" || row["listen_addr"] == "" {
		t.Fatalf("enabled instance was not recovered: %+v", row)
	}

	h.mustCLI("instance", "stop", "calculator-test")
	h.restart()
	stopped := h.readDB(`SELECT enabled, status, pid FROM instances WHERE id = ?`, "calculator-test")
	if stopped["enabled"] != "0" || stopped["status"] != "stopped" || stopped["pid"] != "" {
		t.Fatalf("disabled instance should stay stopped after daemon restart: %+v", stopped)
	}
	var unavailable map[string]any
	h.publicConnect(add.Endpoint, `{"left":1,"right":2}`, http.StatusServiceUnavailable, &unavailable)
	assertConnectError(t, unavailable, "UNAVAILABLE")
}

func TestDaemonRestoresInterruptedServiceCommitBeforeStartingInstances(t *testing.T) {
	h := newHarness(t)
	cat := setupCalculator(t, h)
	add := requireMethod(t, cat, "calculator.v1.CalculatorService/Add")

	// Simulate a crash between the two renames of a commit: the live dir is gone
	// and only the backup is left. The enabled instance below cannot start from
	// the service dir until that backup is restored.
	h.stop()
	servicesDir := filepath.Join(h.dataDir, "artifacts", "services")
	if err := os.Rename(filepath.Join(servicesDir, "calculator"), filepath.Join(servicesDir, ".calculator.previous")); err != nil {
		t.Fatal(err)
	}
	h.start()

	if _, err := os.Stat(filepath.Join(servicesDir, "calculator", "descriptor.protoset")); err != nil {
		t.Fatalf("daemon did not restore the interrupted service commit: %v", err)
	}
	if _, err := os.Stat(filepath.Join(servicesDir, ".calculator.previous")); !os.IsNotExist(err) {
		t.Fatalf("backup survived recovery: %v", err)
	}
	cat = h.waitCatalogRunning()
	add = requireMethod(t, cat, "calculator.v1.CalculatorService/Add")
	var after map[string]any
	h.publicConnect(add.Endpoint, `{"left":1,"right":2}`, http.StatusOK, &after)
	if math.Abs(after["result"].(float64)-3) > 0.000001 {
		t.Fatalf("instance did not come back from the restored service dir: %+v", after)
	}
	row := h.readDB(`SELECT status, pid FROM instances WHERE id = ?`, "calculator-test")
	if row["status"] != "running" || row["pid"] == "" {
		t.Fatalf("enabled instance was not recovered: %+v", row)
	}
}

func TestKilledLongRunningInstanceAutoRecovers(t *testing.T) {
	h := newHarness(t)
	cat := setupCalculator(t, h)
	add := requireMethod(t, cat, "calculator.v1.CalculatorService/Add")
	before := h.readDB(`SELECT pid, listen_addr FROM instances WHERE id = ?`, "calculator-test")
	oldPID, err := strconv.Atoi(before["pid"])
	if err != nil {
		t.Fatalf("invalid pid row: %+v", before)
	}
	proc, err := os.FindProcess(oldPID)
	if err != nil {
		t.Fatal(err)
	}
	if err := proc.Kill(); err != nil {
		t.Fatal(err)
	}

	deadline := time.Now().Add(10 * time.Second)
	var recovered map[string]string
	for time.Now().Before(deadline) {
		recovered = h.readDB(`SELECT enabled, status, pid, listen_addr FROM instances WHERE id = ?`, "calculator-test")
		if recovered["enabled"] == "1" && recovered["status"] == "running" && recovered["pid"] != "" && recovered["pid"] != before["pid"] && recovered["listen_addr"] != "" && recovered["listen_addr"] != before["listen_addr"] {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if recovered["pid"] == before["pid"] || recovered["status"] != "running" {
		h.dumpDiagnostics()
		t.Fatalf("killed instance did not recover: before=%+v after=%+v", before, recovered)
	}

	var resp map[string]any
	for time.Now().Before(deadline) {
		cat = h.waitCatalogRunning()
		add = requireMethod(t, cat, "calculator.v1.CalculatorService/Add")
		status, body, err := h.publicConnectResult(add.Endpoint, `{"left":5,"right":6}`)
		if err == nil && status == http.StatusOK {
			if err := json.Unmarshal(body, &resp); err != nil {
				t.Fatalf("decode recovered response: %v\n%s", err, body)
			}
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if resp == nil {
		h.dumpDiagnostics()
		t.Fatalf("recovered process did not accept calls: before=%+v after=%+v", before, recovered)
	}
	if math.Abs(resp["result"].(float64)-11) > 0.000001 {
		t.Fatalf("recovered process returned unexpected response: %+v", resp)
	}
}

func TestInstanceConfigUpdateValidationRestartHashAndRedaction(t *testing.T) {
	h := newHarness(t)
	cat := setupEcho(t, h)
	getConfig := requireMethod(t, cat, "echo.v1.EchoService/GetConfig")
	before := h.readDB(`SELECT pid, listen_addr, config_sha256, secret_sha256 FROM instances WHERE id = ?`, "echo-test")

	badMissing := filepath.Join(h.root, "bad-missing.json")
	writeJSONFile(t, badMissing, map[string]any{"projectKey": "p"})
	res := h.runCLI("instance", "update-config", "echo-test", "--config", badMissing)
	if res.err == nil || !strings.Contains(res.stderr, "missing property 'token'") {
		t.Fatalf("missing required config should fail: %+v", res)
	}
	stillBefore := h.readDB(`SELECT config_sha256 FROM instances WHERE id = ?`, "echo-test")
	if stillBefore["config_sha256"] != before["config_sha256"] {
		t.Fatalf("failed config update changed persisted hash: before=%+v after=%+v", before, stillBefore)
	}

	badType := filepath.Join(h.root, "bad-type.json")
	writeJSONFile(t, badType, map[string]any{"token": 123})
	res = h.runCLI("instance", "update-config", "echo-test", "--config", badType)
	if res.err == nil || !strings.Contains(res.stderr, "want string") {
		t.Fatalf("wrong-type config should fail: %+v", res)
	}

	newConfig := filepath.Join(h.root, "new-config.json")
	writeJSONFile(t, newConfig, map[string]any{"token": "new-secret", "projectKey": "project-b", "apiKey": "value"})
	out := h.mustCLI("instance", "update-config", "echo-test", "--config", newConfig)
	if strings.Contains(out, "new-secret") || strings.Contains(out, "value") || !strings.Contains(out, "******") {
		t.Fatalf("CLI output did not redact sensitive config values: %s", out)
	}
	noRestart := h.readDB(`SELECT pid, listen_addr, config_json, config_sha256 FROM instances WHERE id = ?`, "echo-test")
	if noRestart["pid"] != before["pid"] || noRestart["listen_addr"] != before["listen_addr"] {
		t.Fatalf("config update without restart changed process: before=%+v after=%+v", before, noRestart)
	}
	if noRestart["config_sha256"] == before["config_sha256"] {
		t.Fatalf("config hash did not change after update: before=%+v after=%+v", before, noRestart)
	}
	if got := fileMode(t, filepath.Join(h.dataDir, "instances", "echo-test", "config.json")); got != 0o600 {
		t.Fatalf("config file mode=%o want 600", got)
	}
	var cfg map[string]any
	h.publicConnect(getConfig.Endpoint, `{}`, http.StatusOK, &cfg)
	if cfg["token"] != "secret-token" {
		t.Fatalf("running process should still have old config without restart: %+v", cfg)
	}
	if cfg["secretToken"] != "fixture-secret" {
		t.Fatalf("running process did not load initial secret: %+v", cfg)
	}

	badSecret := filepath.Join(h.root, "bad-secret.json")
	writeJSONFile(t, badSecret, map[string]any{"apiToken": 123})
	res = h.runCLI("instance", "update-secret", "echo-test", "--secret", badSecret)
	if res.err == nil || !strings.Contains(res.stderr, "secret does not match schema") {
		t.Fatalf("wrong-type secret should fail: %+v", res)
	}
	secretStillBefore := h.readDB(`SELECT secret_sha256 FROM instances WHERE id = ?`, "echo-test")
	if secretStillBefore["secret_sha256"] != before["secret_sha256"] {
		t.Fatalf("failed secret update changed persisted hash: before=%+v after=%+v", before, secretStillBefore)
	}

	newSecret := filepath.Join(h.root, "new-secret.json")
	writeJSONFile(t, newSecret, map[string]any{"apiToken": "rotated-secret"})
	secretOut := h.mustCLI("instance", "update-secret", "echo-test", "--secret", newSecret)
	if strings.Contains(secretOut, "rotated-secret") || !strings.Contains(secretOut, "******") {
		t.Fatalf("CLI output did not redact sensitive secret values: %s", secretOut)
	}
	secretNoRestart := h.readDB(`SELECT pid, listen_addr, secret_json, secret_sha256 FROM instances WHERE id = ?`, "echo-test")
	if secretNoRestart["pid"] != before["pid"] || secretNoRestart["listen_addr"] != before["listen_addr"] {
		t.Fatalf("secret update without restart changed process: before=%+v after=%+v", before, secretNoRestart)
	}
	if secretNoRestart["secret_sha256"] == before["secret_sha256"] {
		t.Fatalf("secret hash did not change after update: before=%+v after=%+v", before, secretNoRestart)
	}
	if _, err := os.Stat(filepath.Join(h.dataDir, "instances", "echo-test", "secret.json")); !os.IsNotExist(err) {
		t.Fatalf("secret file should not be persisted, stat err=%v", err)
	}
	h.publicConnect(getConfig.Endpoint, `{}`, http.StatusOK, &cfg)
	if cfg["secretToken"] != "fixture-secret" {
		t.Fatalf("running process should still have old secret without restart: %+v", cfg)
	}

	restartOut := h.mustCLI("instance", "update-config", "echo-test", "--config", newConfig, "--restart")
	if strings.Contains(restartOut, "new-secret") || strings.Contains(restartOut, "value") || !strings.Contains(restartOut, "******") {
		t.Fatalf("restart config output did not redact sensitive values: %s", restartOut)
	}
	restarted := h.readDB(`SELECT pid, listen_addr, config_json, config_sha256 FROM instances WHERE id = ?`, "echo-test")
	if restarted["pid"] == noRestart["pid"] && restarted["listen_addr"] == noRestart["listen_addr"] {
		t.Fatalf("config update with restart did not replace process: before=%+v after=%+v", noRestart, restarted)
	}
	cat = h.waitCatalogRunning()
	getConfig = requireMethod(t, cat, "echo.v1.EchoService/GetConfig")
	waitConnectOK(t, h, requireMethod(t, cat, "echo.v1.EchoService/Echo").Endpoint)
	h.publicConnect(getConfig.Endpoint, `{}`, http.StatusOK, &cfg)
	if cfg["token"] != "new-secret" || cfg["projectKey"] != "project-b" || cfg["secretToken"] != "rotated-secret" {
		t.Fatalf("restarted process did not load new config and secret: %+v", cfg)
	}

	restartSecretOut := h.mustCLI("instance", "update-secret", "echo-test", "--secret-json", `{"apiToken":"restart-secret"}`, "--restart")
	if strings.Contains(restartSecretOut, "restart-secret") || !strings.Contains(restartSecretOut, "******") {
		t.Fatalf("restart secret output did not redact sensitive values: %s", restartSecretOut)
	}
	cat = h.waitCatalogRunning()
	getConfig = requireMethod(t, cat, "echo.v1.EchoService/GetConfig")
	h.publicConnect(getConfig.Endpoint, `{}`, http.StatusOK, &cfg)
	if cfg["secretToken"] != "restart-secret" {
		t.Fatalf("secret update with restart did not load new secret: %+v", cfg)
	}
}

func TestOldGRPCBindingFailsAfterServiceUpdate(t *testing.T) {
	h := newHarness(t)
	setupEcho(t, h)
	h.mustCLI("service", "import", "echo", "--offline", createFixturePackage(t, h.root, fixtureV2))
	_, err := h.grpcInvoke(context.Background(), "echo.v1.EchoService/Echo", metadata.Pairs(
		"x-octobus-capset", "dev",
		"x-octobus-instance", "echo-test",
	), nil)
	assertStatusCode(t, err, codes.NotFound)
}
