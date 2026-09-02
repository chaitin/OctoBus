package e2e

import (
	"context"
	"math"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
)

func TestCalculatorOnDemandExampleInvokesAllProtocols(t *testing.T) {
	h := newHarness(t)
	configPath := filepath.Join(h.root, "config.json")
	writeJSONFile(t, configPath, map[string]any{"label": "on-demand"})
	secretPath := filepath.Join(h.root, "secret.json")
	writeJSONFile(t, secretPath, map[string]any{"apiToken": "runtime-secret"})

	h.mustCLI("service", "import", "calculator-on-demand", calculatorOnDemandPackagePath(t))
	if out := h.mustCLI("service", "get", "calculator-on-demand"); !strings.Contains(out, `"RuntimeMode": "on-demand"`) {
		t.Fatalf("service get missing on-demand runtime mode: %s", out)
	}
	h.mustCLI("instance", "create", "calculator-test", "--service", "calculator-on-demand", "--config", configPath, "--secret", secretPath, "--no-start")
	h.mustCLI("capset", "create", "dev", "--name", "DevAgent")
	h.mustCLI("capset", "add-instance", "dev", "calculator-test")

	row := h.readDB(`SELECT runtime_mode FROM services WHERE id = ?`, "calculator-on-demand")
	if row["runtime_mode"] != "on-demand" {
		t.Fatalf("runtime_mode=%q", row["runtime_mode"])
	}
	inst := h.readDB(`SELECT enabled, status, pid, listen_addr FROM instances WHERE id = ?`, "calculator-test")
	if inst["enabled"] != "1" || inst["status"] != "running" || inst["pid"] != "" || inst["listen_addr"] != "" {
		t.Fatalf("unexpected on-demand calculator instance row: %+v", inst)
	}

	cat := h.waitCatalogRunning()
	add := requireMethod(t, cat, "calculator.v1.CalculatorService/Add")
	if add.ServiceID != "calculator-on-demand" || add.RuntimeMode != "on-demand" || add.BackendInstanceStatus != "running" {
		t.Fatalf("unexpected Connect catalog item: %+v", add)
	}
	if requireGRPCMethod(t, cat, "calculator.v1.CalculatorService/Add").RuntimeMode != "on-demand" {
		t.Fatalf("gRPC catalog missing on-demand runtime: %+v", cat.GRPC)
	}
	mcpAdd := requireMCPMethod(t, cat, "calculator.v1.CalculatorService/Add")
	if mcpAdd.RuntimeMode != "on-demand" {
		t.Fatalf("MCP catalog missing on-demand runtime: %+v", cat.MCP)
	}

	serviceRow := h.readDB(`SELECT descriptor_path FROM services WHERE id = ?`, "calculator-on-demand")
	files := descriptorFiles(t, serviceRow["descriptor_path"])
	reqDesc := mustMessage(t, files, "calculator.v1.BinaryOperationRequest")
	respDesc := mustMessage(t, files, "calculator.v1.CalculatorResponse")
	req := protoJSONToWire(t, reqDesc, `{"left":20,"right":22}`)
	grpcRaw, err := h.grpcInvoke(context.Background(), "calculator.v1.CalculatorService/Add", metadata.Pairs(
		"x-octobus-capset", "dev",
		"x-octobus-instance", "calculator-test",
		"x-octobus-ext-business-request-id", "od-calc-1",
		"x-octobus-ext-username", "od-alice",
	), req)
	if err != nil {
		t.Fatal(err)
	}
	grpcResp := wireToMap(t, respDesc, grpcRaw)
	want := map[string]any{
		"result":            float64(42),
		"serviceId":         "calculator-on-demand",
		"instanceId":        "calculator-test",
		"label":             "on-demand",
		"businessRequestId": "od-calc-1",
		"secretToken":       "runtime-secret",
	}
	for key, value := range want {
		if grpcResp[key] != value {
			t.Fatalf("grpc %s=%v want %v in %+v", key, grpcResp[key], value, grpcResp)
		}
	}
	assertBackendMetadata(t, h, "calculator-test", "od-calc-1", "od-alice")

	var connectResp map[string]any
	h.publicConnectWithHeaders(add.Endpoint, `{"left":7,"right":5}`, map[string]string{
		"x-octobus-ext-business-request-id": "od-calc-connect",
		"x-octobus-ext-username":            "od-bob",
		"x-octobus-capset":                  "wrong",
		"x-octobus-instance":                "wrong",
	}, http.StatusOK, &connectResp)
	if math.Abs(connectResp["result"].(float64)-12) > 0.000001 || connectResp["serviceId"] != "calculator-on-demand" || connectResp["label"] != "on-demand" || connectResp["businessRequestId"] != "od-calc-connect" {
		t.Fatalf("unexpected Connect response: %+v", connectResp)
	}
	assertBackendMetadata(t, h, "calculator-test", "od-calc-connect", "od-bob")

	var mcpResp map[string]any
	h.mcpWithHeaders(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"`+mcpAdd.ToolName+`","arguments":{"left":9,"right":3}}}`, map[string]string{
		"x-octobus-ext-business-request-id": "od-calc-mcp",
		"x-octobus-ext-username":            "od-carol",
		"x-octobus-capset":                  "wrong",
		"x-octobus-instance":                "wrong",
	}, &mcpResp)
	structured := mcpResp["result"].(map[string]any)["structuredContent"].(map[string]any)
	if math.Abs(structured["result"].(float64)-12) > 0.000001 || structured["serviceId"] != "calculator-on-demand" || structured["secretToken"] != "runtime-secret" {
		t.Fatalf("unexpected MCP response: %+v", mcpResp)
	}
	if structured["businessRequestId"] != "od-calc-mcp" {
		t.Fatalf("MCP businessRequestId=%v in %+v", structured["businessRequestId"], structured)
	}
	assertBackendMetadata(t, h, "calculator-test", "od-calc-mcp", "od-carol")

	after := h.readDB(`SELECT pid, listen_addr FROM instances WHERE id = ?`, "calculator-test")
	if after["pid"] != "" || after["listen_addr"] != "" {
		t.Fatalf("on-demand calculator invoke persisted runtime resource: %+v", after)
	}
}

func TestOnDemandRuntimeInvokesAllProtocolsAndLifecycleControls(t *testing.T) {
	h := newHarness(t)
	pkg := createOnDemandFixturePackage(t, h.root)
	configPath := filepath.Join(h.root, "config.json")
	writeJSONFile(t, configPath, map[string]any{"token": "first-token", "projectKey": "first-project"})
	secretPath := filepath.Join(h.root, "secret.json")
	writeJSONFile(t, secretPath, map[string]any{"apiToken": "first-secret"})

	h.mustCLI("service", "import", "echo", "--offline", pkg)
	if out := h.mustCLI("service", "list"); !strings.Contains(out, `"RuntimeMode": "on-demand"`) {
		t.Fatalf("service list missing on-demand runtime mode: %s", out)
	}
	if out := h.mustCLI("service", "get", "echo"); !strings.Contains(out, `"RuntimeMode": "on-demand"`) {
		t.Fatalf("service get missing on-demand runtime mode: %s", out)
	}
	h.mustCLI("instance", "create", "echo-test", "--service", "echo", "--config", configPath, "--secret", secretPath, "--no-start")
	h.mustCLI("capset", "create", "dev", "--name", "DevAgent")
	h.mustCLI("capset", "add-instance", "dev", "echo-test")

	row := h.readDB(`SELECT runtime_mode FROM services WHERE id = ?`, "echo")
	if row["runtime_mode"] != "on-demand" {
		t.Fatalf("runtime_mode=%q", row["runtime_mode"])
	}
	inst := h.readDB(`SELECT enabled, status, pid, listen_addr FROM instances WHERE id = ?`, "echo-test")
	if inst["enabled"] != "1" || inst["status"] != "running" || inst["pid"] != "" || inst["listen_addr"] != "" {
		t.Fatalf("unexpected on-demand instance row: %+v", inst)
	}

	cat := h.waitCatalogRunning()
	echoMethod := requireMethod(t, cat, "echo.v1.EchoService/Echo")
	if echoMethod.RuntimeMode != "on-demand" || echoMethod.BackendInstanceStatus != "running" {
		t.Fatalf("unexpected on-demand catalog item: %+v", echoMethod)
	}
	if requireGRPCMethod(t, cat, "echo.v1.EchoService/Echo").RuntimeMode != "on-demand" {
		t.Fatalf("grpc catalog missing on-demand runtime: %+v", cat.GRPC)
	}
	requireGRPCMethod(t, cat, "echo.v1.EchoService/ServerStream")
	if requireMCPMethod(t, cat, "echo.v1.EchoService/Echo").RuntimeMode != "on-demand" {
		t.Fatalf("mcp catalog missing on-demand runtime: %+v", cat.MCP)
	}

	serviceRow := h.readDB(`SELECT descriptor_path FROM services WHERE id = ?`, "echo")
	files := descriptorFiles(t, serviceRow["descriptor_path"])
	reqDesc := mustMessage(t, files, "echo.v1.EchoRequest")
	respDesc := mustMessage(t, files, "echo.v1.EchoResponse")
	req := protoJSONToWire(t, reqDesc, `{"projectId":"p","text":"grpc"}`)
	grpcRaw, err := h.grpcInvoke(context.Background(), "echo.v1.EchoService/Echo", metadata.Pairs(
		"x-octobus-capset", "dev",
		"x-octobus-instance", "echo-test",
		"x-octobus-ext-business-request-id", "od-1",
		"x-octobus-ext-username", "echo-alice",
	), req)
	if err != nil {
		t.Fatal(err)
	}
	grpcResp := wireToMap(t, respDesc, grpcRaw)
	_, err = h.grpcInvoke(context.Background(), "echo.v1.EchoService/ServerStream", metadata.Pairs(
		"x-octobus-capset", "dev",
		"x-octobus-instance", "echo-test",
	), req)
	assertStatusCode(t, err, codes.Unimplemented)
	if grpcResp["text"] != "grpc" || grpcResp["configToken"] != "first-token" || grpcResp["serviceId"] != "echo" || grpcResp["instanceId"] != "echo-test" || grpcResp["businessRequestId"] != "od-1" {
		t.Fatalf("unexpected grpc response: %+v", grpcResp)
	}

	var connectResp map[string]any
	h.publicConnectWithHeaders(echoMethod.Endpoint, `{"projectId":"p","text":"connect"}`, map[string]string{
		"x-octobus-ext-business-request-id": "od-connect",
		"x-octobus-ext-username":            "echo-bob",
		"x-octobus-capset":                  "wrong",
		"x-octobus-instance":                "wrong",
	}, http.StatusOK, &connectResp)
	if connectResp["text"] != "connect" || connectResp["configToken"] != "first-token" || connectResp["businessRequestId"] != "od-connect" {
		t.Fatalf("unexpected connect response: %+v", connectResp)
	}
	var mcpResp map[string]any
	h.mcp(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo__echo-test__echo","arguments":{"projectId":"p","text":"mcp"}}}`, &mcpResp)
	structured := mcpResp["result"].(map[string]any)["structuredContent"].(map[string]any)
	if structured["text"] != "mcp" || structured["configToken"] != "first-token" {
		t.Fatalf("unexpected mcp response: %+v", mcpResp)
	}

	after := h.readDB(`SELECT pid, listen_addr FROM instances WHERE id = ?`, "echo-test")
	if after["pid"] != "" || after["listen_addr"] != "" {
		t.Fatalf("on-demand invoke persisted runtime resource: %+v", after)
	}

	writeJSONFile(t, configPath, map[string]any{"token": "second-token", "projectKey": "second-project"})
	h.mustCLI("instance", "update-config", "echo-test", "--config", configPath)
	writeJSONFile(t, secretPath, map[string]any{"apiToken": "second-secret"})
	h.mustCLI("instance", "update-secret", "echo-test", "--secret", secretPath)
	var cfg map[string]any
	configMethod := requireMethod(t, cat, "echo.v1.EchoService/GetConfig")
	h.publicConnect(configMethod.Endpoint, `{}`, http.StatusOK, &cfg)
	if cfg["token"] != "second-token" || cfg["projectKey"] != "second-project" || cfg["secretToken"] != "second-secret" {
		t.Fatalf("updated config/secret not visible to new request: %+v", cfg)
	}

	for _, args := range [][]string{
		{"instance", "start", "echo-test"},
		{"instance", "stop", "echo-test"},
		{"instance", "restart", "echo-test"},
		{"instance", "update-config", "echo-test", "--config", configPath, "--restart"},
		{"instance", "update-secret", "echo-test", "--secret", secretPath, "--restart"},
	} {
		out := h.runCLI(args...)
		if out.err == nil || !strings.Contains(out.stderr, "on-demand runtime mode does not support persistent runtime control") {
			t.Fatalf("%v should fail with on-demand control error: %+v", args, out)
		}
	}

	_, err = h.grpcInvoke(context.Background(), "echo.v1.EchoService/Fail", metadata.Pairs(
		"x-octobus-capset", "dev",
		"x-octobus-instance", "echo-test",
	), req)
	assertStatusCode(t, err, codes.PermissionDenied)

	h.restart()
	postRestart := h.readDB(`SELECT pid, listen_addr FROM instances WHERE id = ?`, "echo-test")
	if postRestart["pid"] != "" || postRestart["listen_addr"] != "" {
		t.Fatalf("daemon restart prestarted on-demand instance: %+v", postRestart)
	}
	h.publicConnect(echoMethod.Endpoint, `{"projectId":"p","text":"after-restart"}`, http.StatusOK, &connectResp)
	if connectResp["text"] != "after-restart" || connectResp["configToken"] != "second-token" {
		t.Fatalf("post-restart on-demand invoke failed: %+v", connectResp)
	}
}

func TestOnDemandUpdatesDoNotTerminateInflightRequest(t *testing.T) {
	h := newHarness(t)
	pkg := createOnDemandFixturePackage(t, h.root)
	configPath := filepath.Join(h.root, "config.json")
	writeJSONFile(t, configPath, map[string]any{"token": "old-token", "projectKey": "old-project"})

	h.mustCLI("service", "import", "echo", "--offline", pkg)
	h.mustCLI("instance", "create", "echo-test", "--service", "echo", "--config", configPath)
	h.mustCLI("capset", "create", "dev", "--name", "DevAgent")
	h.mustCLI("capset", "add-instance", "dev", "echo-test")
	h.waitCatalogRunning()
	serviceRow := h.readDB(`SELECT descriptor_path FROM services WHERE id = ?`, "echo")
	files := descriptorFiles(t, serviceRow["descriptor_path"])
	reqDesc := mustMessage(t, files, "echo.v1.EchoRequest")
	respDesc := mustMessage(t, files, "echo.v1.EchoResponse")
	req := protoJSONToWire(t, reqDesc, `{"projectId":"p","text":"inflight"}`)
	startedPath := filepath.Join(h.root, "inflight-started")

	var wg sync.WaitGroup
	wg.Add(1)
	inflight := make(chan map[string]any, 1)
	go func() {
		defer wg.Done()
		raw, err := h.grpcInvoke(context.Background(), "echo.v1.EchoService/Echo", metadata.Pairs(
			"x-octobus-capset", "dev",
			"x-octobus-instance", "echo-test",
			"x-sleep-ms", "500",
			"x-started-file", startedPath,
		), req)
		if err != nil {
			t.Error(err)
			return
		}
		inflight <- wireToMap(t, respDesc, raw)
	}()

	waitForFile(t, startedPath)
	writeJSONFile(t, configPath, map[string]any{"token": "new-token", "projectKey": "new-project"})
	h.mustCLI("instance", "update-config", "echo-test", "--config", configPath)
	h.mustCLI("service", "import", "echo", "--offline", createOnDemandFixturePackageWithTokenPrefix(t, h.root, "updated-"))
	wg.Wait()
	oldResp := <-inflight
	if oldResp["text"] != "inflight" || oldResp["configToken"] != "old-token" {
		t.Fatalf("inflight request did not keep startup config: %+v", oldResp)
	}

	var newResp map[string]any
	echoMethod := requireMethod(t, h.waitCatalogRunning(), "echo.v1.EchoService/Echo")
	h.publicConnect(echoMethod.Endpoint, `{"projectId":"p","text":"new"}`, http.StatusOK, &newResp)
	if newResp["text"] != "new" || newResp["configToken"] != "updated-new-token" {
		t.Fatalf("new request did not use updated runtime and config: %+v", newResp)
	}
}
