package e2e

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc/metadata"
)

func TestConnectAndMCPSemanticsAndErrors(t *testing.T) {
	h := newHarness(t)
	cat := setupEcho(t, h)
	echo := requireMethod(t, cat, "echo.v1.EchoService/Echo")
	streaming := "echo.v1.EchoService/ServerStream"

	var connectResp map[string]any
	h.publicConnect(echo.Endpoint, `{"projectId":"json-name","text":"connect"}`, http.StatusOK, &connectResp)
	if connectResp["projectId"] != "json-name" || connectResp["text"] != "connect" {
		t.Fatalf("Connect did not honor protobuf jsonName: %+v", connectResp)
	}
	if _, ok := connectResp["zeroBool"]; ok {
		t.Fatalf("Connect should omit zero value fields: %+v", connectResp)
	}

	var invalid map[string]any
	h.publicConnect(echo.Endpoint, `{"projectId":"p","unknownField":true}`, http.StatusBadRequest, &invalid)
	assertConnectError(t, invalid, "INVALID_ARGUMENT")

	var missing map[string]any
	h.publicConnect("/capsets/dev/connect/echo-test/"+streaming, `{}`, http.StatusNotImplemented, &missing)
	assertConnectError(t, missing, "UNIMPLEMENTED")

	h.mustCLI("instance", "stop", "echo-test")
	var unavailable map[string]any
	h.publicConnect(echo.Endpoint, `{"text":"stopped"}`, http.StatusServiceUnavailable, &unavailable)
	assertConnectError(t, unavailable, "UNAVAILABLE")
	h.mustCLI("instance", "start", "echo-test")
	cat = h.waitCatalogRunning()
	waitConnectOK(t, h, requireMethod(t, cat, "echo.v1.EchoService/Echo").Endpoint)

	var list map[string]any
	h.mcp(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`, &list)
	tools := list["result"].(map[string]any)["tools"].([]any)
	if !hasTool(tools, "echo__echo-test__echo") || hasTool(tools, "echo__echo-test__server_stream") {
		t.Fatalf("MCP tools/list should expose only selected unary methods: %+v", tools)
	}

	var unknownTool map[string]any
	h.mcp(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"missing","arguments":{}}}`, &unknownTool)
	assertMCPToolError(t, unknownTool, "NOT_FOUND")

	var streamingTool map[string]any
	h.mcp(`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"echo__echo-test__server_stream","arguments":{}}}`, &streamingTool)
	assertMCPToolError(t, streamingTool, "UNIMPLEMENTED")

	var grpcErrorTool map[string]any
	h.mcp(`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"echo__echo-test__fail","arguments":{"text":"x"}}}`, &grpcErrorTool)
	assertMCPToolError(t, grpcErrorTool, "PERMISSION_DENIED")
	if _, ok := grpcErrorTool["error"]; ok {
		t.Fatalf("backend gRPC errors must be tool results, not JSON-RPC errors: %+v", grpcErrorTool)
	}
}

func TestStreamingMethodsAreGRPCOnly(t *testing.T) {
	h := newHarness(t)
	cat := setupEcho(t, h)
	requireGRPCMethod(t, cat, "echo.v1.EchoService/ServerStream")
	for _, item := range cat.ConnectRPC {
		if strings.Contains(item.MethodFullName, "ServerStream") {
			t.Fatalf("streaming method was exposed in catalog: %+v", cat.ConnectRPC)
		}
	}
	out := h.runCLI("capset", "select-method", "dev", "echo-test", "/echo.v1.EchoService/ServerStream")
	if out.err == nil || !strings.Contains(out.stderr, "UNIQUE constraint failed") {
		t.Fatalf("selecting already selected streaming method should fail as duplicate: %+v", out)
	}
	if _, err := h.grpcInvoke(context.Background(), "echo.v1.EchoService/ServerStream", metadata.Pairs(
		"x-octobus-capset", "dev",
		"x-octobus-instance", "echo-test",
	), nil); err != nil {
		t.Fatalf("selected streaming method should be reachable over gRPC: %v", err)
	}
}

func TestKnownStreamingMethodRemainsUnsupportedOutsideGRPC(t *testing.T) {
	h := newHarness(t)
	setupEcho(t, h)
	streaming := "echo.v1.EchoService/ServerStream"

	var connectResp map[string]any
	h.publicConnect("/capsets/dev/connect/echo-test/"+streaming, `{}`, http.StatusNotImplemented, &connectResp)
	assertConnectError(t, connectResp, "UNIMPLEMENTED")

	var mcp map[string]any
	h.mcp(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo__echo-test__server_stream","arguments":{}}}`, &mcp)
	assertMCPToolError(t, mcp, "UNIMPLEMENTED")
}

func TestIDAdminAndCLIBoundaries(t *testing.T) {
	h := newHarness(t)
	badService := h.runCLI("service", "import", "1bad", "--offline", calculatorPackagePath(t))
	if badService.err == nil || !strings.Contains(badService.stderr, "invalid service id") {
		t.Fatalf("invalid service id should be rejected: %+v", badService)
	}

	goodConfig := filepath.Join(h.root, "config.json")
	writeJSONFile(t, goodConfig, map[string]any{"label": "boundary"})
	importCalculator(t, h, "calculator")
	badInstance := h.runCLI("instance", "create", "1bad", "--service", "calculator", "--config", goodConfig)
	if badInstance.err == nil || !strings.Contains(badInstance.stderr, "invalid instance id") {
		t.Fatalf("invalid instance id should be rejected: %+v", badInstance)
	}
	badCapset := h.runCLI("capset", "create", "1bad", "--name", "Bad")
	if badCapset.err == nil || !strings.Contains(badCapset.stderr, "invalid capset id") {
		t.Fatalf("invalid capset id should be rejected: %+v", badCapset)
	}
	h.mustCLI("capset", "create", "dev", "--name", "DevAgent")
	h.mustCLI("admin-token", "add", "admin-one", "--token", "admin-secret")
	var status map[string]any
	h.adminJSONWithToken(http.MethodGet, "/admin/v1/status", nil, "", http.StatusOK, &status)
	if status["status"] != "ok" {
		t.Fatalf("status should remain available without admin token: %+v", status)
	}
	h.adminJSONWithToken(http.MethodGet, "/admin/v1/capsets", nil, "", http.StatusUnauthorized, nil)
	h.adminJSONWithToken(http.MethodGet, "/admin/v1/capsets", nil, "wrong", http.StatusUnauthorized, nil)
	var caps map[string]any
	h.adminJSONWithToken(http.MethodGet, "/admin/v1/capsets", nil, "admin-secret", http.StatusOK, &caps)
	if !strings.Contains(string(h.adminJSONWithToken(http.MethodGet, "/admin/v1/tokens", nil, "admin-secret", http.StatusOK, nil)), "admin-one") {
		t.Fatalf("admin token was not listed")
	}
	// The CLI prefers OCTOBUS_ADMIN_TOKEN over .env, so leave the variable out
	// to make the .env file the only source.
	h.cliAdminToken = ""
	dotEnv := filepath.Join(repoRoot, ".env")
	oldDotEnv, readDotEnvErr := os.ReadFile(dotEnv)
	if readDotEnvErr != nil && !os.IsNotExist(readDotEnvErr) {
		t.Fatal(readDotEnvErr)
	}
	if err := os.WriteFile(dotEnv, []byte("OCTOBUS_ADMIN_TOKEN=admin-secret\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if readDotEnvErr == nil {
			if err := os.WriteFile(dotEnv, oldDotEnv, 0o600); err != nil {
				t.Fatal(err)
			}
			return
		}
		if err := os.Remove(dotEnv); err != nil && !os.IsNotExist(err) {
			t.Fatal(err)
		}
	})
	if out := h.mustCLI("capset", "list"); !strings.Contains(out, `"ID": "dev"`) {
		t.Fatalf("capset list with .env admin token missing dev: %s", out)
	}

	h.stop()
	offlineWrite := h.runCLI("capset", "create", "offline", "--name", "Offline")
	if offlineWrite.err == nil || !strings.Contains(offlineWrite.stderr, "run `octobus serve` first") {
		t.Fatalf("CLI write without daemon should fail through admin API: %+v", offlineWrite)
	}
	rows := h.readDB(`SELECT count(*) AS count FROM capsets WHERE id = ?`, "offline")
	if rows["count"] != "0" {
		t.Fatalf("CLI modified SQLite while daemon was stopped: %+v", rows)
	}
}

func TestToolNameConflictRequiresExplicitName(t *testing.T) {
	h := newHarness(t)
	configPath := filepath.Join(h.root, "config.json")
	writeJSONFile(t, configPath, map[string]any{"label": "tools"})
	importCalculator(t, h, "calculator")
	h.mustCLI("instance", "create", "calculator-test", "--service", "calculator", "--config", configPath)
	h.mustCLI("capset", "create", "dev", "--name", "DevAgent")
	h.mustCLI("capset", "add-instance", "dev", "calculator-test", "--no-all-methods")
	h.mustCLI("capset", "select-method", "dev", "calculator-test", "/calculator.v1.CalculatorService/Add", "--mcp-tool", "shared_tool")
	dup := h.runCLI("capset", "select-method", "dev", "calculator-test", "/calculator.v1.CalculatorService/Subtract", "--mcp-tool", "shared_tool")
	if dup.err == nil || !strings.Contains(dup.stderr, "MCP tool name conflict") {
		t.Fatalf("duplicate explicit MCP tool should fail: %+v", dup)
	}
	h.mustCLI("capset", "select-method", "dev", "calculator-test", "/calculator.v1.CalculatorService/Subtract", "--mcp-tool", "subtract_custom")
	cat := h.waitCatalogRunning()
	if requireMCPMethod(t, cat, "calculator.v1.CalculatorService/Subtract").ToolName != "subtract_custom" {
		t.Fatalf("explicit MCP tool name was not persisted: %+v", cat)
	}
}

func assertConnectError(t *testing.T, body map[string]any, code string) {
	t.Helper()
	want := strings.ToLower(code)
	if got, ok := body["code"].(string); !ok || got != want {
		t.Fatalf("Connect code=%v want %s body=%+v", body["code"], want, body)
	}
}

func assertMCPToolError(t *testing.T, body map[string]any, code string) {
	t.Helper()
	result := body["result"].(map[string]any)
	structured := result["structuredContent"].(map[string]any)
	errObj := structured["error"].(map[string]any)
	if errObj["code"] != code {
		t.Fatalf("MCP tool error code=%v want %s body=%+v", errObj["code"], code, body)
	}
}

func waitConnectOK(t *testing.T, h *harness, path string) {
	t.Helper()
	for i := 0; i < 50; i++ {
		if strings.Contains(path, "echo.v1.EchoService") {
			status, body, err := h.publicConnectResult(path, `{"text":"ready"}`)
			if err == nil && status == http.StatusOK && strings.Contains(string(body), `"ready"`) {
				return
			}
		} else {
			status, body, err := h.publicConnectResult(path, `{"left":2,"right":3}`)
			if err == nil && status == http.StatusOK {
				var resp map[string]any
				if json.Unmarshal(body, &resp) == nil {
					if result, ok := resp["result"].(float64); ok && math.Abs(result-5) <= 0.000001 {
						return
					}
				}
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("backend did not become reachable")
}
