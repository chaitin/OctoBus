package e2e

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/reflection/grpc_reflection_v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/descriptorpb"
)

func TestFullUserFlowInvokesAllProtocolsAndPersistsData(t *testing.T) {
	h := newHarness(t)
	configPath := filepath.Join(h.root, "config.json")
	writeJSONFile(t, configPath, map[string]any{"label": "primary"})
	secretPath := filepath.Join(h.root, "secret.json")
	writeJSONFile(t, secretPath, map[string]any{"apiToken": "runtime-secret"})

	importCalculator(t, h, "calculator")
	h.mustCLI("instance", "create", "calculator-test", "--service", "calculator", "--config", configPath, "--secret", secretPath)
	h.mustCLI("capset", "create", "dev", "--name", "DevAgent", "--description", "developer tools")
	h.mustCLI("capset", "add-instance", "dev", "calculator-test")

	cat := h.waitCatalogRunning()
	if cat.CapsetID != "dev" || cat.Name != "DevAgent" || cat.Description != "developer tools" {
		t.Fatalf("unexpected catalog identity: %+v", cat)
	}
	if len(cat.ConnectRPC) != 2 || len(cat.GRPC) != 2 || len(cat.MCP) != 2 {
		t.Fatalf("all-methods should expose 2 unary methods per protocol, got %+v", cat)
	}
	add := requireMethod(t, cat, "calculator.v1.CalculatorService/Add")
	if add.ServiceID != "calculator" || add.InstanceID != "calculator-test" {
		t.Fatalf("unexpected catalog item: %+v", add)
	}
	if add.Endpoint != "/capsets/dev/connect/calculator-test/calculator.v1.CalculatorService/Add" {
		t.Fatalf("unexpected Connect endpoint: %s", add.Endpoint)
	}
	if add.OpenAPIURL != "/capsets/dev/openapi.json" {
		t.Fatalf("unexpected OpenAPI URL: %s", add.OpenAPIURL)
	}
	if requireMCPMethod(t, cat, "calculator.v1.CalculatorService/Add").ToolName != "calculator__calculator-test__add" {
		t.Fatalf("unexpected MCP tool: %+v", cat.MCP)
	}
	grpcItem := requireGRPCMethod(t, cat, "calculator.v1.CalculatorService/Add")
	if len(grpcItem.Metadata) != 2 || grpcItem.Metadata["x-octobus-capset"] != "dev" || grpcItem.Metadata["x-octobus-instance"] != "calculator-test" {
		t.Fatalf("unexpected grpc metadata: %+v", grpcItem.Metadata)
	}
	if add.DescriptorSHA256 == "" || add.DescriptorVersion == "" {
		t.Fatalf("missing descriptor identity: %+v", add)
	}
	if add.RequestMessageName != "calculator.v1.BinaryOperationRequest" || add.ResponseMessageName != "calculator.v1.CalculatorResponse" {
		t.Fatalf("unexpected message names: %+v", add)
	}

	assertDataDirState(t, h, "calculator", "calculator-test")
	serviceRow := h.readDB(`SELECT package_artifact_path, package_sha256, descriptor_path, descriptor_sha256, descriptor_version, methods_json FROM services WHERE id = ?`, "calculator")
	for _, key := range []string{"package_artifact_path", "package_sha256", "descriptor_path", "descriptor_sha256", "descriptor_version", "methods_json"} {
		if serviceRow[key] == "" {
			t.Fatalf("services.%s is empty: %+v", key, serviceRow)
		}
	}
	instanceRow := h.readDB(`SELECT enabled, status, pid, listen_addr, config_sha256, secret_sha256 FROM instances WHERE id = ?`, "calculator-test")
	if instanceRow["enabled"] != "1" || instanceRow["status"] != "running" || instanceRow["pid"] == "" || instanceRow["listen_addr"] == "" || instanceRow["config_sha256"] == "" || instanceRow["secret_sha256"] == "" {
		t.Fatalf("unexpected instance row: %+v", instanceRow)
	}

	files := descriptorFiles(t, serviceRow["descriptor_path"])
	reqDesc := mustMessage(t, files, "calculator.v1.BinaryOperationRequest")
	respDesc := mustMessage(t, files, "calculator.v1.CalculatorResponse")
	req := protoJSONToWire(t, reqDesc, `{"left":20,"right":22}`)
	grpcRaw, err := h.grpcInvoke(context.Background(), "calculator.v1.CalculatorService/Add", metadata.Pairs(
		"x-octobus-capset", "dev",
		"x-octobus-instance", "calculator-test",
		"x-octobus-ext-business-request-id", "req-1",
		"x-octobus-ext-username", "alice",
	), req)
	if err != nil {
		t.Fatal(err)
	}
	compatRaw, err := h.grpcInvoke(context.Background(), "calculator.v1.CalculatorService/Add", metadata.Pairs(
		"x-octobus-capset", "dev",
		"x-octobus-instance", "calculator-test",
		"x-octobus-service", "wrong-or-old-value",
		"x-octobus-ext-business-request-id", "req-1",
		"x-octobus-ext-username", "alice",
	), req)
	if err != nil {
		t.Fatalf("deprecated x-octobus-service should be ignored: %v", err)
	}
	compatResp := wireToMap(t, respDesc, compatRaw)
	if compatResp["serviceId"] != "calculator" || compatResp["instanceId"] != "calculator-test" || compatResp["result"] != float64(42) {
		t.Fatalf("compat grpc response did not route to calculator-test: %+v", compatResp)
	}
	grpcResp := wireToMap(t, respDesc, grpcRaw)
	want := map[string]any{"result": float64(42), "serviceId": "calculator", "instanceId": "calculator-test", "label": "primary", "businessRequestId": "req-1", "secretToken": "runtime-secret"}
	for key, value := range want {
		if grpcResp[key] != value {
			t.Fatalf("grpc %s=%v want %v in %+v", key, grpcResp[key], value, grpcResp)
		}
	}
	assertBackendMetadata(t, h, "calculator-test", "req-1", "alice")

	var restResp map[string]any
	h.publicConnectWithHeaders(add.Endpoint, `{"left":20,"right":22}`, map[string]string{
		"x-octobus-ext-business-request-id": "req-connect",
		"x-octobus-ext-username":            "bob",
		"x-octobus-capset":                  "wrong",
		"x-octobus-instance":                "wrong",
		"Authorization":                     "Bearer frontend-secret",
	}, http.StatusOK, &restResp)
	for _, key := range []string{"result", "serviceId", "instanceId", "label", "secretToken"} {
		if restResp[key] != grpcResp[key] {
			t.Fatalf("Connect and gRPC differ for %s: connect=%+v grpc=%+v", key, restResp, grpcResp)
		}
	}
	if restResp["businessRequestId"] != "req-connect" {
		t.Fatalf("Connect businessRequestId=%v in %+v", restResp["businessRequestId"], restResp)
	}
	assertBackendMetadata(t, h, "calculator-test", "req-connect", "bob")
	if math.Abs(restResp["result"].(float64)-42) > 0.000001 {
		t.Fatalf("Connect Add returned wrong result: %+v", restResp)
	}
	var oldShortResp map[string]any
	h.publicConnect("/c/dev/i/calculator-test/calculator.v1.CalculatorService/Add", `{"left":1,"right":2}`, http.StatusNotFound, &oldShortResp)
	var oldFullResp map[string]any
	h.publicConnect("/capsets/dev/services/calculator/instances/calculator-test/connect/calculator.v1.CalculatorService/Add", `{"left":1,"right":2}`, http.StatusNotFound, &oldFullResp)
	protoRespRaw := h.publicConnectProto(add.Endpoint, req, http.StatusOK)
	protoResp := wireToMap(t, respDesc, protoRespRaw)
	if protoResp["result"] != float64(42) || protoResp["serviceId"] != "calculator" {
		t.Fatalf("Connect proto response differs: %+v", protoResp)
	}

	openapi := h.adminJSON(http.MethodGet, "/admin/v1/catalog/dev/openapi.json", nil, http.StatusOK, nil)
	if !strings.Contains(string(openapi), add.Endpoint) || strings.Contains(string(openapi), "/rest/") || strings.Contains(string(openapi), "/c/") || strings.Contains(string(openapi), "/services/") {
		t.Fatalf("unexpected OpenAPI document: %s", openapi)
	}
	assertConnectProtocolVersionHeaderOptional(t, openapi, add.Endpoint)
	agentOpenAPI := h.publicGET("/capsets/dev/openapi.json", http.StatusOK)
	if !strings.Contains(string(agentOpenAPI), add.Endpoint) || strings.Contains(string(agentOpenAPI), "/c/") || strings.Contains(string(agentOpenAPI), "/services/") {
		t.Fatalf("unexpected agent OpenAPI document: %s", agentOpenAPI)
	}
	openapiYAML := h.mustCLI("catalog", "dev", "--openapi-yaml")
	if !strings.Contains(openapiYAML, add.Endpoint) || !strings.Contains(openapiYAML, "openapi:") {
		t.Fatalf("unexpected OpenAPI YAML: %s", openapiYAML)
	}
	md := h.mustCLI("catalog", "dev", "--connect", "--md")
	for _, want := range []string{
		"## Schema Discovery",
		"POST JSON to the table `Endpoint` path",
		"## Connect RPC",
		"| Endpoint | OpenAPI | Procedure | Request | Response |",
		add.Endpoint,
		"`calculator.v1.BinaryOperationRequest`",
		"`calculator.v1.CalculatorResponse`",
	} {
		if !strings.Contains(md, want) {
			t.Fatalf("catalog markdown missing %q: %s", want, md)
		}
	}
	for _, old := range []string{"Content Types", "Descriptor", "Backend", "Runtime"} {
		if strings.Contains(md, old) {
			t.Fatalf("catalog markdown still contains old column %q: %s", old, md)
		}
	}
	md = h.mustCLI("catalog", "dev", "--all", "--md")
	for _, want := range []string{
		"use server reflection with `x-octobus-capset=dev` metadata",
		"call `tools/list` on the table `Endpoint`",
		"POST JSON to the table `Endpoint` path",
	} {
		if !strings.Contains(md, want) {
			t.Fatalf("all-protocol catalog markdown missing %q: %s", want, md)
		}
	}
	if !strings.Contains(md, "## Connect RPC") || !strings.Contains(md, add.Endpoint) {
		t.Fatalf("unexpected catalog markdown: %s", md)
	}
	jsonOut := h.mustCLI("catalog", "dev", "--all", "--json")
	if !strings.Contains(jsonOut, `"connect_rpc"`) || strings.Contains(jsonOut, `"methods"`) {
		t.Fatalf("unexpected catalog json output: %s", jsonOut)
	}

	var list map[string]any
	h.mcp(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`, &list)
	result := list["result"].(map[string]any)
	tools := result["tools"].([]any)
	if !hasTool(tools, "calculator__calculator-test__add") {
		t.Fatalf("MCP tools/list missing calculator tool: %+v", list)
	}
	addTool := findTool(t, tools, "calculator__calculator-test__add")
	addSchema := addTool["inputSchema"].(map[string]any)
	assertToolInputProperty(t, addSchema, "left", "number")
	assertToolInputProperty(t, addSchema, "right", "number")

	var call map[string]any
	h.mcp(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"calculator__calculator-test__add","arguments":{"left":20,"right":22}}}`, &call)
	callResult := call["result"].(map[string]any)
	structured := callResult["structuredContent"].(map[string]any)
	if structured["result"] != float64(42) || structured["label"] != "primary" {
		t.Fatalf("unexpected MCP structured content: %+v", structured)
	}
	content := callResult["content"].([]any)[0].(map[string]any)
	if content["type"] != "text" || !strings.Contains(content["text"].(string), `"result":42`) {
		t.Fatalf("unexpected MCP text content: %+v", content)
	}

	var mdCall map[string]any
	h.mcpWithHeaders(`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"calculator__calculator-test__add","arguments":{"left":20,"right":22}}}`, map[string]string{
		"x-octobus-ext-business-request-id": "req-mcp",
		"x-octobus-ext-username":            "carol",
		"x-octobus-capset":                  "wrong",
		"x-octobus-instance":                "wrong",
	}, &mdCall)
	mdResult := mdCall["result"].(map[string]any)["structuredContent"].(map[string]any)
	if mdResult["businessRequestId"] != "req-mcp" {
		t.Fatalf("MCP businessRequestId=%v in %+v", mdResult["businessRequestId"], mdResult)
	}
	assertBackendMetadata(t, h, "calculator-test", "req-mcp", "carol")

	logs := h.mustCLI("logs", "--capset", "dev", "--instance", "calculator-test", "--service", "calculator", "--limit", "0")
	assertAccessLogContains(t, logs, map[string]any{
		"protocol":    "connect",
		"capset":      "dev",
		"service":     "calculator",
		"instance":    "calculator-test",
		"method":      "calculator.v1.CalculatorService/Add",
		"route":       add.Endpoint,
		"http_method": "POST",
	})
	assertAccessLogContains(t, logs, map[string]any{
		"protocol": "mcp",
		"capset":   "dev",
		"service":  "calculator",
		"instance": "calculator-test",
		"method":   "calculator.v1.CalculatorService/Add",
		"tool":     "calculator__calculator-test__add",
	})
	for _, forbidden := range []string{"runtime-secret", "apiToken", "Authorization", "businessRequestId", "req-1"} {
		if strings.Contains(logs, forbidden) {
			t.Fatalf("access logs leaked %q: %s", forbidden, logs)
		}
	}
}

func TestStreamingJSGRPCEndToEnd(t *testing.T) {
	h := newHarness(t)
	configPath := filepath.Join(h.root, "streaming-config.json")
	writeJSONFile(t, configPath, map[string]any{"label": "stream-label"})
	secretPath := filepath.Join(h.root, "streaming-secret.json")
	writeJSONFile(t, secretPath, map[string]any{"apiToken": "stream-secret"})

	h.mustCLI("service", "import", "streaming", streamingPackagePath(t))
	h.mustCLI("instance", "create", "streaming-test", "--service", "streaming", "--config", configPath, "--secret", secretPath)
	h.mustCLI("capset", "create", "dev", "--name", "DevAgent")
	h.mustCLI("capset", "add-instance", "dev", "streaming-test")

	cat := h.waitCatalogRunning()
	if len(cat.GRPC) != 4 || len(cat.ConnectRPC) != 1 || len(cat.MCP) != 1 {
		t.Fatalf("streaming catalog should expose all gRPC methods and unary-only MCP/Connect: %+v", cat)
	}
	for _, method := range []string{
		"streaming.v1.StreamingService/Echo",
		"streaming.v1.StreamingService/Expand",
		"streaming.v1.StreamingService/Collect",
		"streaming.v1.StreamingService/Chat",
	} {
		requireGRPCMethod(t, cat, method)
	}
	requireMethod(t, cat, "streaming.v1.StreamingService/Echo")
	requireMCPMethod(t, cat, "streaming.v1.StreamingService/Echo")
	for _, item := range cat.ConnectRPC {
		if item.MethodFullName != "streaming.v1.StreamingService/Echo" {
			t.Fatalf("Connect catalog includes streaming method: %+v", cat.ConnectRPC)
		}
	}

	serviceRow := h.readDB(`SELECT descriptor_path FROM services WHERE id = ?`, "streaming")
	files := descriptorFiles(t, serviceRow["descriptor_path"])
	reqDesc := mustMessage(t, files, "streaming.v1.StreamRequest")
	respDesc := mustMessage(t, files, "streaming.v1.StreamResponse")
	md := metadata.Pairs(
		"x-octobus-capset", "dev",
		"x-octobus-instance", "streaming-test",
		"x-business-request-id", "req-stream",
	)

	unaryReq := protoJSONToWire(t, reqDesc, `{"text":"hello","count":7}`)
	unaryRaw, err := h.grpcInvoke(context.Background(), "streaming.v1.StreamingService/Echo", md, unaryReq)
	if err != nil {
		t.Fatal(err)
	}
	unary := wireToMap(t, respDesc, unaryRaw)
	if unary["text"] != "hello" || unary["label"] != "stream-label" || unary["businessRequestId"] != "req-stream" || unary["secretToken"] != "stream-secret" {
		t.Fatalf("unexpected unary response: %+v", unary)
	}

	conn, err := h.grpcConn()
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	ctx := metadata.NewOutgoingContext(context.Background(), md)
	expand, err := conn.NewStream(ctx, &grpc.StreamDesc{StreamName: "Expand", ServerStreams: true}, "/streaming.v1.StreamingService/Expand")
	if err != nil {
		t.Fatal(err)
	}
	if err := expand.SendMsg(newRawFrame(protoJSONToWire(t, reqDesc, `{"text":"item","count":3}`))); err != nil {
		t.Fatal(err)
	}
	if err := expand.CloseSend(); err != nil {
		t.Fatal(err)
	}
	if got := recvStreamTexts(t, expand, respDesc); !stringSlicesEqual(got, []string{"item", "item", "item"}) {
		t.Fatalf("server streaming responses=%v", got)
	}

	collect, err := conn.NewStream(ctx, &grpc.StreamDesc{StreamName: "Collect", ClientStreams: true}, "/streaming.v1.StreamingService/Collect")
	if err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"a", "b", "c"} {
		if err := collect.SendMsg(newRawFrame(protoJSONToWire(t, reqDesc, `{"text":"`+text+`"}`))); err != nil {
			t.Fatal(err)
		}
	}
	if err := collect.CloseSend(); err != nil {
		t.Fatal(err)
	}
	respFrame := newRawFrame(nil)
	if err := collect.RecvMsg(respFrame); err != nil {
		t.Fatal(err)
	}
	collectResp := wireToMap(t, respDesc, respFrame.Bytes())
	if collectResp["text"] != "a,b,c" || collectResp["index"] != float64(3) {
		t.Fatalf("client streaming response=%+v", collectResp)
	}

	chat, err := conn.NewStream(ctx, &grpc.StreamDesc{StreamName: "Chat", ClientStreams: true, ServerStreams: true}, "/streaming.v1.StreamingService/Chat")
	if err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"x", "y"} {
		if err := chat.SendMsg(newRawFrame(protoJSONToWire(t, reqDesc, `{"text":"`+text+`"}`))); err != nil {
			t.Fatal(err)
		}
		respFrame := newRawFrame(nil)
		if err := chat.RecvMsg(respFrame); err != nil {
			t.Fatal(err)
		}
		if got := wireToMap(t, respDesc, respFrame.Bytes())["text"]; got != text {
			t.Fatalf("bidi response text=%v want %s", got, text)
		}
	}
	if err := chat.CloseSend(); err != nil {
		t.Fatal(err)
	}

	var toolsList map[string]any
	h.mcp(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`, &toolsList)
	tools := toolsList["result"].(map[string]any)["tools"].([]any)
	if hasTool(tools, "streaming__streaming-test__expand") || hasTool(tools, "streaming__streaming-test__collect") || hasTool(tools, "streaming__streaming-test__chat") {
		t.Fatalf("MCP tools/list includes streaming methods: %+v", tools)
	}
	openAPI := h.publicGET("/capsets/dev/openapi.json", http.StatusOK)
	if strings.Contains(string(openAPI), "Expand") || strings.Contains(string(openAPI), "Collect") || strings.Contains(string(openAPI), "Chat") {
		t.Fatalf("OpenAPI includes streaming methods:\n%s", openAPI)
	}
}

func TestGRPCReflectionVisibilityIsCapsetScoped(t *testing.T) {
	h := newHarness(t)
	setupCalculator(t, h)

	conn, err := h.reflectionConn()
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	client := grpc_reflection_v1.NewServerReflectionClient(conn)

	ctx := metadata.NewOutgoingContext(context.Background(), metadata.Pairs("x-octobus-capset", "dev"))
	stream, err := client.ServerReflectionInfo(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := stream.Send(&grpc_reflection_v1.ServerReflectionRequest{MessageRequest: &grpc_reflection_v1.ServerReflectionRequest_ListServices{ListServices: ""}}); err != nil {
		t.Fatal(err)
	}
	resp, err := stream.Recv()
	if err != nil {
		t.Fatal(err)
	}
	services := resp.GetListServicesResponse().GetService()
	if len(services) != 1 || services[0].GetName() != "calculator.v1.CalculatorService" {
		t.Fatalf("unexpected services: %+v", services)
	}

	if err := stream.Send(&grpc_reflection_v1.ServerReflectionRequest{MessageRequest: &grpc_reflection_v1.ServerReflectionRequest_FileContainingSymbol{FileContainingSymbol: "calculator.v1.CalculatorService"}}); err != nil {
		t.Fatal(err)
	}
	fileResp, err := stream.Recv()
	if err != nil {
		t.Fatal(err)
	}
	if len(fileResp.GetFileDescriptorResponse().GetFileDescriptorProto()) == 0 {
		t.Fatalf("missing descriptor closure: %+v", fileResp)
	}

	noCapset, err := client.ServerReflectionInfo(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	err = noCapset.Send(&grpc_reflection_v1.ServerReflectionRequest{MessageRequest: &grpc_reflection_v1.ServerReflectionRequest_ListServices{ListServices: ""}})
	if err == nil {
		_, err = noCapset.Recv()
	}
	assertStatusCode(t, err, codes.InvalidArgument)

	missingCtx := metadata.NewOutgoingContext(context.Background(), metadata.Pairs("x-octobus-capset", "missing"))
	missing, err := client.ServerReflectionInfo(missingCtx)
	if err != nil {
		t.Fatal(err)
	}
	err = missing.Send(&grpc_reflection_v1.ServerReflectionRequest{MessageRequest: &grpc_reflection_v1.ServerReflectionRequest_ListServices{ListServices: ""}})
	if err == nil {
		_, err = missing.Recv()
	}
	assertStatusCode(t, err, codes.NotFound)
}

func TestPartialMethodSelectionLimitsReflectionAndInvocation(t *testing.T) {
	h := newHarness(t)
	configPath := filepath.Join(h.root, "config.json")
	writeJSONFile(t, configPath, map[string]any{"label": "partial"})
	importCalculator(t, h, "calculator")
	h.mustCLI("instance", "create", "calculator-test", "--service", "calculator", "--config", configPath)
	h.mustCLI("capset", "create", "dev", "--name", "DevAgent")
	h.mustCLI("capset", "add-instance", "dev", "calculator-test", "--no-all-methods")
	h.mustCLI("capset", "select-method", "dev", "calculator-test", "/calculator.v1.CalculatorService/Add")
	cat := h.waitCatalogRunning()
	if len(cat.ConnectRPC) != 1 || cat.ConnectRPC[0].MethodFullName != "calculator.v1.CalculatorService/Add" {
		t.Fatalf("partial catalog should expose only Add: %+v", cat.ConnectRPC)
	}

	conn, err := h.reflectionConn()
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	client := grpc_reflection_v1.NewServerReflectionClient(conn)
	ctx := metadata.NewOutgoingContext(context.Background(), metadata.Pairs("x-octobus-capset", "dev"))
	stream, err := client.ServerReflectionInfo(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := stream.Send(&grpc_reflection_v1.ServerReflectionRequest{MessageRequest: &grpc_reflection_v1.ServerReflectionRequest_FileContainingSymbol{FileContainingSymbol: "calculator.v1.CalculatorService"}}); err != nil {
		t.Fatal(err)
	}
	resp, err := stream.Recv()
	if err != nil {
		t.Fatal(err)
	}
	files := resp.GetFileDescriptorResponse().GetFileDescriptorProto()
	if len(files) == 0 {
		t.Fatal("reflection returned no file descriptors")
	}
	set := &descriptorpb.FileDescriptorSet{}
	for _, raw := range files {
		file := &descriptorpb.FileDescriptorProto{}
		if err := proto.Unmarshal(raw, file); err != nil {
			t.Fatal(err)
		}
		set.File = append(set.File, file)
	}
	refFiles, err := protodesc.NewFiles(set)
	if err != nil {
		t.Fatal(err)
	}
	desc, err := refFiles.FindDescriptorByName("calculator.v1.CalculatorService")
	if err != nil {
		t.Fatal(err)
	}
	methods := desc.(protoreflect.ServiceDescriptor).Methods()
	if methods.Len() != 1 || string(methods.Get(0).Name()) != "Add" {
		t.Fatalf("reflection should expose only selected Add method, got %d methods", methods.Len())
	}

	_, err = h.grpcInvoke(context.Background(), "calculator.v1.CalculatorService/Subtract", metadata.Pairs(
		"x-octobus-capset", "dev",
		"x-octobus-instance", "calculator-test",
	), nil)
	assertStatusCode(t, err, codes.NotFound)
}

func setupCalculator(t *testing.T, h *harness) catalog {
	t.Helper()
	configPath := filepath.Join(h.root, "calculator.config.json")
	writeJSONFile(t, configPath, map[string]any{"label": "e2e"})
	importCalculator(t, h, "calculator")
	h.mustCLI("instance", "create", "calculator-test", "--service", "calculator", "--config", configPath)
	h.mustCLI("capset", "create", "dev", "--name", "DevAgent")
	h.mustCLI("capset", "add-instance", "dev", "calculator-test")
	return h.waitCatalogRunning()
}

func setupEcho(t *testing.T, h *harness) catalog {
	t.Helper()
	pkg := createFixturePackage(t, h.root, fixtureV1)
	configPath := filepath.Join(h.root, "config.json")
	writeJSONFile(t, configPath, map[string]any{"token": "secret-token", "projectKey": "project-a"})
	secretPath := filepath.Join(h.root, "echo-secret.json")
	writeJSONFile(t, secretPath, map[string]any{"apiToken": "fixture-secret"})
	h.mustCLI("service", "import", "echo", "--offline", pkg)
	h.mustCLI("instance", "create", "echo-test", "--service", "echo", "--config", configPath, "--secret", secretPath)
	h.mustCLI("capset", "create", "dev", "--name", "DevAgent")
	h.mustCLI("capset", "add-instance", "dev", "echo-test")
	return h.waitCatalogRunning()
}

func assertAccessLogContains(t *testing.T, logs string, want map[string]any) {
	t.Helper()
	for _, line := range strings.Split(strings.TrimSpace(logs), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var record map[string]any
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatalf("invalid access log line %q: %v", line, err)
		}
		matches := true
		for key, value := range want {
			if record[key] != value {
				matches = false
				break
			}
		}
		if matches {
			return
		}
	}
	t.Fatalf("access logs missing %+v in:\n%s", want, logs)
}

func calculatorPackagePath(t *testing.T) string {
	t.Helper()
	path := filepath.Join(repoRoot, "examples", "calculator-js")
	if _, err := os.Stat(filepath.Join(path, "service.json")); err != nil {
		t.Fatalf("calculator example package missing: %v", err)
	}
	return path
}

func calculatorOnDemandPackagePath(t *testing.T) string {
	t.Helper()
	path := filepath.Join(repoRoot, "examples", "calculator-on-demand-js")
	if _, err := os.Stat(filepath.Join(path, "service.json")); err != nil {
		t.Fatalf("calculator on-demand example package missing: %v", err)
	}
	return path
}

func streamingPackagePath(t *testing.T) string {
	t.Helper()
	path := filepath.Join(repoRoot, "examples", "streaming-js")
	if _, err := os.Stat(filepath.Join(path, "service.json")); err != nil {
		t.Fatalf("streaming example package missing: %v", err)
	}
	return path
}

func importCalculator(t *testing.T, h *harness, serviceID string) {
	t.Helper()
	h.mustCLI("service", "import", serviceID, calculatorPackagePath(t))
}

func recvStreamTexts(t *testing.T, stream grpc.ClientStream, desc protoreflect.MessageDescriptor) []string {
	t.Helper()
	var out []string
	for {
		resp := newRawFrame(nil)
		err := stream.RecvMsg(resp)
		if errors.Is(err, io.EOF) {
			return out
		}
		if err != nil {
			t.Fatal(err)
		}
		item := wireToMap(t, desc, resp.Bytes())
		text, _ := item["text"].(string)
		out = append(out, text)
	}
}

func stringSlicesEqual(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func requireMethod(t *testing.T, cat catalog, method string) connectCatalogItem {
	t.Helper()
	for _, item := range cat.ConnectRPC {
		if item.MethodFullName == method {
			return item
		}
	}
	t.Fatalf("catalog missing Connect method %s: %+v", method, cat.ConnectRPC)
	return connectCatalogItem{}
}

func requireGRPCMethod(t *testing.T, cat catalog, method string) grpcCatalogItem {
	t.Helper()
	for _, item := range cat.GRPC {
		if item.MethodFullName == method {
			return item
		}
	}
	t.Fatalf("catalog missing gRPC method %s: %+v", method, cat.GRPC)
	return grpcCatalogItem{}
}

func requireMCPMethod(t *testing.T, cat catalog, method string) mcpCatalogItem {
	t.Helper()
	for _, item := range cat.MCP {
		if item.MethodFullName == method {
			return item
		}
	}
	t.Fatalf("catalog missing MCP method %s: %+v", method, cat.MCP)
	return mcpCatalogItem{}
}

func assertDataDirState(t *testing.T, h *harness, serviceID, instanceID string) {
	t.Helper()
	for _, path := range []string{
		filepath.Join(h.dataDir, "octobus.db"),
		filepath.Join(h.dataDir, "artifacts", "services", serviceID, "runtime"),
		filepath.Join(h.dataDir, "artifacts", "services", serviceID, "descriptor.protoset"),
	} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("missing %s: %v", path, err)
		}
	}
	artifacts, err := filepath.Glob(filepath.Join(h.dataDir, "artifacts", "services", serviceID, "*.tgz"))
	if err != nil || len(artifacts) != 1 {
		t.Fatalf("expected one package artifact for %s, got %v err=%v", serviceID, artifacts, err)
	}
	for _, path := range []string{
		filepath.Join(h.dataDir, "instances", instanceID, "config.json"),
		filepath.Join(h.dataDir, "instances", instanceID, "stdout.log"),
		filepath.Join(h.dataDir, "instances", instanceID, "stderr.log"),
	} {
		if got := fileMode(t, path); got != 0o600 {
			t.Fatalf("%s mode=%o want 600", path, got)
		}
	}
	if _, err := os.Stat(filepath.Join(h.dataDir, "instances", instanceID, "secret.json")); !os.IsNotExist(err) {
		t.Fatalf("secret file should not be persisted, stat err=%v", err)
	}
}

func assertBackendMetadata(t *testing.T, h *harness, instanceID, requestID, username string) {
	t.Helper()
	metadataPath := filepath.Join(h.dataDir, "instances", instanceID, "metadata.json")
	rawMetadata, err := os.ReadFile(metadataPath)
	if err != nil {
		t.Fatal(err)
	}
	var backendMD map[string][]string
	if err := json.Unmarshal(rawMetadata, &backendMD); err != nil {
		t.Fatal(err)
	}
	for key := range backendMD {
		if key == "x-octobus-capset" || key == "x-octobus-instance" || key == "x-octobus-service" || key == "authorization" {
			t.Fatalf("routing metadata leaked to backend: %+v", backendMD)
		}
	}
	if vals := backendMD["x-octobus-ext-business-request-id"]; len(vals) != 1 || vals[0] != requestID {
		t.Fatalf("business metadata was not forwarded: %+v", backendMD)
	}
	if vals := backendMD["x-octobus-ext-username"]; len(vals) != 1 || vals[0] != username {
		t.Fatalf("octobus extension metadata was not forwarded: %+v", backendMD)
	}
}

func assertConnectProtocolVersionHeaderOptional(t *testing.T, raw []byte, path string) {
	t.Helper()
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("decode OpenAPI JSON: %v\n%s", err, raw)
	}
	paths, ok := doc["paths"].(map[string]any)
	if !ok {
		t.Fatalf("OpenAPI paths missing: %s", raw)
	}
	pathItem, ok := paths[path].(map[string]any)
	if !ok {
		t.Fatalf("OpenAPI path %s missing: %s", path, raw)
	}
	post, ok := pathItem["post"].(map[string]any)
	if !ok {
		t.Fatalf("OpenAPI path %s missing post operation: %+v", path, pathItem)
	}
	params, ok := post["parameters"].([]any)
	if !ok {
		t.Fatalf("OpenAPI path %s missing parameters: %+v", path, post)
	}
	for _, rawParam := range params {
		param, ok := rawParam.(map[string]any)
		if !ok {
			continue
		}
		if param["name"] != "Connect-Protocol-Version" || param["in"] != "header" {
			continue
		}
		if required, _ := param["required"].(bool); required {
			t.Fatalf("Connect-Protocol-Version should not be required: %+v", param)
		}
		return
	}
	t.Fatalf("Connect-Protocol-Version header missing from %s: %+v", path, params)
}
