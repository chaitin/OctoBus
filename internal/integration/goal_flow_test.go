package integration

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"octobus/internal/admin"
	"octobus/internal/cli"
	"octobus/internal/domain"
	"octobus/internal/packageimport"
	"octobus/internal/protocol"
	"octobus/internal/server"
	"octobus/internal/store"
	"octobus/internal/supervisor"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/encoding"
	"google.golang.org/grpc/health"
	grpc_health_v1 "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/reflection/grpc_reflection_v1"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
	"google.golang.org/protobuf/types/dynamicpb"
)

func TestGoalFlowImportInstanceCapsetAndInvokeAllProtocols(t *testing.T) {
	if os.Getenv("OCTOBUS_HELPER_PROCESS") == "1" {
		runHelperProcess()
		return
	}
	ctx := context.Background()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	pkgDir := createFixturePackage(t, root)
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	imp := &packageimport.Importer{DataDir: dataDir, Store: st}
	res, err := imp.Import(ctx, packageimport.Options{ServiceID: "echo", Source: pkgDir, Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	if res.Service.PackageSHA256 == "" || len(res.Service.Methods) != 1 {
		t.Fatalf("unexpected import result: %+v", res.Service)
	}

	t.Setenv("OCTOBUS_HELPER_BINARY", os.Args[0])
	sup := supervisor.New(dataDir, st)
	gateway := &protocol.Gateway{Store: st}
	adminSrv := &admin.Server{Store: st, Importer: imp, Supervisor: sup, Gateway: gateway}
	defer sup.Stop(context.Background(), "echo-test")

	postAdmin(t, adminSrv, "/admin/v1/instances", map[string]any{"id": "echo-test", "service_id": "echo", "config": map[string]any{"token": "secret"}, "start": true})
	inst, err := st.GetInstance(ctx, "echo-test")
	if err != nil {
		t.Fatal(err)
	}
	if inst.Status != domain.StatusRunning || inst.ListenAddr == "" {
		logProcessOutput(t, dataDir, "echo-test")
		t.Fatalf("instance not ready: %+v", inst)
	}

	postAdmin(t, adminSrv, "/admin/v1/capsets", map[string]any{"id": "dev", "name": "DevAgent", "enabled": true})
	postAdmin(t, adminSrv, "/admin/v1/capsets/dev/instances", map[string]any{"instance_id": "echo-test", "all_methods": true})
	cat := getCatalog(t, adminSrv)
	if len(cat.ConnectRPC) != 1 || len(cat.MCP) != 1 || cat.MCP[0].ToolName != "echo__echo-test__echo" {
		t.Fatalf("unexpected catalog: %+v", cat)
	}
	md := getCatalogMarkdown(t, adminSrv)
	for _, want := range []string{
		"## Schema Discovery",
		"use server reflection with `x-octobus-capset=dev` metadata",
		"call `tools/list` on the table `Endpoint`",
		"POST JSON to the table `Endpoint` path",
		"| Endpoint | OpenAPI | Procedure | Request | Response |",
		"`/capsets/dev/connect/echo-test/echo.v1.EchoService/Echo`",
		"`echo.v1.EchoMessage`",
	} {
		if !strings.Contains(md, want) {
			t.Fatalf("catalog markdown missing %q:\n%s", want, md)
		}
	}
	for _, old := range []string{"Content Types", "Descriptor", "Backend", "Runtime"} {
		if strings.Contains(md, old) {
			t.Fatalf("catalog markdown still contains old column %q:\n%s", old, md)
		}
	}

	files, err := protodesc.NewFiles(mustLoadDescriptor(t, res.Service.DescriptorPath))
	if err != nil {
		t.Fatal(err)
	}
	reqDesc := mustMessage(t, files, "echo.v1.EchoMessage")
	reqMsg := dynamicpb.NewMessage(reqDesc)
	reqMsg.Set(reqDesc.Fields().ByName("text"), protoreflect.ValueOfString("grpc"))
	reqRaw, err := proto.Marshal(reqMsg)
	if err != nil {
		t.Fatal(err)
	}
	grpcAddr, stopGRPC := startGatewayGRPC(t, gateway)
	defer stopGRPC()
	conn, err := grpc.NewClient(grpcAddr, grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithDefaultCallOptions(grpc.ForceCodec(testRawCodec{})))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	grpcCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs("x-octobus-capset", "dev", "x-octobus-instance", "echo-test"))
	grpcOut := newTestRawFrame(nil)
	if err := conn.Invoke(grpcCtx, "/echo.v1.EchoService/Echo", newTestRawFrame(reqRaw), grpcOut); err != nil {
		t.Fatal(err)
	}
	if got := decodeText(t, reqDesc, grpcOut.Bytes()); got != "grpc" {
		t.Fatalf("grpc response text = %q", got)
	}

	connectReq := httptest.NewRequest(http.MethodPost, cat.ConnectRPC[0].Endpoint, bytes.NewBufferString(`{"text":"connect"}`))
	connectReq.Header.Set("Content-Type", "application/json")
	connectResp := httptest.NewRecorder()
	gateway.HandleConnectRPC(connectResp, connectReq)
	if connectResp.Code != http.StatusOK || !bytes.Contains(connectResp.Body.Bytes(), []byte(`"text":"connect"`)) {
		t.Fatalf("Connect status=%d body=%s", connectResp.Code, connectResp.Body.String())
	}

	mcpList := httptest.NewRecorder()
	gateway.HandleMCP(mcpList, httptest.NewRequest(http.MethodPost, "/capsets/dev/mcp", bytes.NewBufferString(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)))
	if mcpList.Code != http.StatusOK || !bytes.Contains(mcpList.Body.Bytes(), []byte("echo__echo-test__echo")) {
		t.Fatalf("MCP list status=%d body=%s", mcpList.Code, mcpList.Body.String())
	}
	mcpCall := httptest.NewRecorder()
	gateway.HandleMCP(mcpCall, httptest.NewRequest(http.MethodPost, "/capsets/dev/mcp", bytes.NewBufferString(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"echo__echo-test__echo","arguments":{"text":"mcp"}}}`)))
	if mcpCall.Code != http.StatusOK || !bytes.Contains(mcpCall.Body.Bytes(), []byte(`"text":"mcp"`)) {
		t.Fatalf("MCP call status=%d body=%s", mcpCall.Code, mcpCall.Body.String())
	}

	reflClient := grpc_reflection_v1.NewServerReflectionClient(conn)
	reflCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs("x-octobus-capset", "dev"))
	refl, err := reflClient.ServerReflectionInfo(reflCtx)
	if err != nil {
		t.Fatal(err)
	}
	if err := refl.Send(&grpc_reflection_v1.ServerReflectionRequest{MessageRequest: &grpc_reflection_v1.ServerReflectionRequest_ListServices{ListServices: ""}}); err != nil {
		t.Fatal(err)
	}
	reflResp, err := refl.Recv()
	if err != nil {
		t.Fatal(err)
	}
	services := reflResp.GetListServicesResponse().GetService()
	if len(services) != 1 || services[0].GetName() != "echo.v1.EchoService" {
		t.Fatalf("reflection services = %+v", services)
	}
}

func TestCombinedHTTPHandlerServesAdminAndGatewayOpenAPI(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	imp := &packageimport.Importer{DataDir: dataDir, Store: st}
	res, err := imp.Import(ctx, packageimport.Options{ServiceID: "echo", Source: createFixturePackage(t, root), Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	inst := domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Status: domain.StatusStopped, ConfigJSON: json.RawMessage(`{}`), Enabled: true}
	if err := st.UpsertInstance(ctx, inst); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	ci := domain.CapsetInstance{CapsetID: "dev", ServiceID: "echo", InstanceID: "echo-test", IncludeAllMethods: true, Enabled: true}
	if err := st.AddCapsetInstance(ctx, ci); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{
		CapsetInstanceID: "dev:echo-test",
		MethodFullName:   res.Service.Methods[0].FullName,
		Enabled:          true,
	}); err != nil {
		t.Fatal(err)
	}

	gateway := &protocol.Gateway{Store: st}
	adminSrv := &admin.Server{Store: st, Importer: imp, Supervisor: supervisor.New(dataDir, st), Gateway: gateway}
	handler := server.Handler(adminSrv.Handler(), gateway)

	status := httptest.NewRecorder()
	handler.ServeHTTP(status, httptest.NewRequest(http.MethodGet, "/admin/v1/status", nil))
	if status.Code != http.StatusOK || !bytes.Contains(status.Body.Bytes(), []byte(`"status":"ok"`)) {
		t.Fatalf("admin status=%d body=%s", status.Code, status.Body.String())
	}

	openAPIJSON := httptest.NewRecorder()
	handler.ServeHTTP(openAPIJSON, httptest.NewRequest(http.MethodGet, "/capsets/dev/openapi.json", nil))
	if openAPIJSON.Code != http.StatusOK || openAPIJSON.Header().Get("Content-Type") != "application/json" || !bytes.Contains(openAPIJSON.Body.Bytes(), []byte(`/capsets/dev/connect/echo-test/echo.v1.EchoService/Echo`)) {
		t.Fatalf("openapi json status=%d content-type=%q body=%s", openAPIJSON.Code, openAPIJSON.Header().Get("Content-Type"), openAPIJSON.Body.String())
	}

	openAPIYAML := httptest.NewRecorder()
	handler.ServeHTTP(openAPIYAML, httptest.NewRequest(http.MethodGet, "/capsets/dev/openapi.yaml", nil))
	if openAPIYAML.Code != http.StatusOK || openAPIYAML.Header().Get("Content-Type") != "application/yaml" || !bytes.Contains(openAPIYAML.Body.Bytes(), []byte("/capsets/dev/connect/echo-test/echo.v1.EchoService/Echo")) {
		t.Fatalf("openapi yaml status=%d content-type=%q body=%s", openAPIYAML.Code, openAPIYAML.Header().Get("Content-Type"), openAPIYAML.Body.String())
	}
}

func TestServiceUpdateRestartsEnabledInstanceAndRemovesInvalidBindings(t *testing.T) {
	if os.Getenv("OCTOBUS_HELPER_PROCESS") == "1" {
		runHelperProcess()
		return
	}
	ctx := context.Background()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	t.Setenv("OCTOBUS_HELPER_BINARY", os.Args[0])
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	imp := &packageimport.Importer{DataDir: dataDir, Store: st}
	if _, err := imp.Import(ctx, packageimport.Options{ServiceID: "echo", Source: createFixturePackage(t, root), Offline: true}); err != nil {
		t.Fatal(err)
	}
	sup := supervisor.New(dataDir, st)
	gateway := &protocol.Gateway{Store: st}
	adminSrv := &admin.Server{Store: st, Importer: imp, Supervisor: sup, Gateway: gateway}
	defer sup.Stop(context.Background(), "echo-test")

	postAdmin(t, adminSrv, "/admin/v1/instances", map[string]any{"id": "echo-test", "service_id": "echo", "config": map[string]any{}, "start": true})
	postAdmin(t, adminSrv, "/admin/v1/capsets", map[string]any{"id": "dev", "name": "DevAgent", "enabled": true})
	postAdmin(t, adminSrv, "/admin/v1/capsets/dev/instances", map[string]any{"instance_id": "echo-test", "all_methods": true})
	before, err := st.GetInstance(ctx, "echo-test")
	if err != nil {
		t.Fatal(err)
	}
	if before.PID == nil || before.Status != domain.StatusRunning {
		t.Fatalf("instance not running before update: %+v", before)
	}

	updatedPkg := createFixturePackageWithProto(t, root, "fixture-v2", `syntax = "proto3";
package echo.v1;
service EchoService { rpc Other(EchoMessage) returns (EchoMessage); }
message EchoMessage { string text = 1; }
`)
	postAdmin(t, adminSrv, "/admin/v1/services/import", map[string]any{"service_id": "echo", "source": updatedPkg, "offline": true})
	after, err := st.GetInstance(ctx, "echo-test")
	if err != nil {
		t.Fatal(err)
	}
	if after.Status != domain.StatusRunning || after.PID == nil || *after.PID == *before.PID {
		t.Fatalf("instance was not restarted after service update: before=%+v after=%+v", before, after)
	}
	cat, err := gateway.CatalogWithOptions(ctx, "dev", protocol.CatalogOptions{IncludeGRPC: true, IncludeMCP: true, IncludeConnect: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(cat.GRPC) != 0 {
		t.Fatalf("expected stale method binding to disappear from catalog: %+v", cat)
	}
	mcpList := httptest.NewRecorder()
	gateway.HandleMCP(mcpList, httptest.NewRequest(http.MethodPost, "/capsets/dev/mcp", bytes.NewBufferString(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)))
	if bytes.Contains(mcpList.Body.Bytes(), []byte("echo__echo-test__echo")) {
		t.Fatalf("stale tool remained in MCP list: %s", mcpList.Body.String())
	}
}

func TestRunningConfigUpdateRestartsOnlyWhenRequested(t *testing.T) {
	if os.Getenv("OCTOBUS_HELPER_PROCESS") == "1" {
		runHelperProcess()
		return
	}
	ctx := context.Background()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	t.Setenv("OCTOBUS_HELPER_BINARY", os.Args[0])
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	imp := &packageimport.Importer{DataDir: dataDir, Store: st}
	if _, err := imp.Import(ctx, packageimport.Options{ServiceID: "echo", Source: createFixturePackage(t, root), Offline: true}); err != nil {
		t.Fatal(err)
	}
	sup := supervisor.New(dataDir, st)
	adminSrv := &admin.Server{Store: st, Importer: imp, Supervisor: sup, Gateway: &protocol.Gateway{Store: st}}
	defer sup.Stop(context.Background(), "echo-test")
	postAdmin(t, adminSrv, "/admin/v1/instances", map[string]any{"id": "echo-test", "service_id": "echo", "config": map[string]any{"token": "a"}, "start": true})
	before, err := st.GetInstance(ctx, "echo-test")
	if err != nil {
		t.Fatal(err)
	}
	if before.PID == nil {
		t.Fatalf("missing pid before config update: %+v", before)
	}

	postAdmin(t, adminSrv, "/admin/v1/instances/echo-test/config", map[string]any{"config": map[string]any{"token": "b"}, "restart": false})
	noRestart, err := st.GetInstance(ctx, "echo-test")
	if err != nil {
		t.Fatal(err)
	}
	if noRestart.PID == nil || *noRestart.PID != *before.PID || noRestart.ListenAddr != before.ListenAddr {
		t.Fatalf("config update without restart changed process: before=%+v after=%+v", before, noRestart)
	}

	postAdmin(t, adminSrv, "/admin/v1/instances/echo-test/config", map[string]any{"config": map[string]any{"token": "c"}, "restart": true})
	restarted, err := st.GetInstance(ctx, "echo-test")
	if err != nil {
		t.Fatal(err)
	}
	if restarted.Status != domain.StatusRunning || restarted.PID == nil || (*restarted.PID == *before.PID && restarted.ListenAddr == before.ListenAddr) {
		t.Fatalf("config update with restart did not restart process: before=%+v after=%+v", before, restarted)
	}
}

func TestRecoverEnabledStartsPersistedInstance(t *testing.T) {
	if os.Getenv("OCTOBUS_HELPER_PROCESS") == "1" {
		runHelperProcess()
		return
	}
	ctx := context.Background()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	t.Setenv("OCTOBUS_HELPER_BINARY", os.Args[0])
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	imp := &packageimport.Importer{DataDir: dataDir, Store: st}
	res, err := imp.Import(ctx, packageimport.Options{ServiceID: "echo", Source: createFixturePackage(t, root), Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	inst := domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: true, Status: domain.StatusStopped, NodeEntry: res.Service.NodeEntry, ConfigJSON: []byte(`{}`)}
	if err := st.UpsertInstance(ctx, inst); err != nil {
		t.Fatal(err)
	}
	fresh := supervisor.New(dataDir, st)
	defer fresh.Stop(context.Background(), "echo-test")
	count, err := fresh.RecoverEnabled(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("recover count=%d want 1", count)
	}
	recovered, err := st.GetInstance(ctx, "echo-test")
	if err != nil {
		t.Fatal(err)
	}
	if recovered.Status != domain.StatusRunning || recovered.PID == nil || recovered.ListenAddr == "" {
		t.Fatalf("enabled instance was not recovered: %+v", recovered)
	}
}

func TestGRPCStreamingProxyIntegration(t *testing.T) {
	if os.Getenv("OCTOBUS_HELPER_PROCESS") == "1" {
		runHelperProcess()
		return
	}
	ctx := context.Background()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	t.Setenv("OCTOBUS_HELPER_BINARY", os.Args[0])
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	pkgDir := createFixturePackageWithProto(t, root, "streaming-fixture", `syntax = "proto3";
package echo.v1;
service EchoService {
  rpc Echo(EchoMessage) returns (EchoMessage);
  rpc ServerStream(EchoMessage) returns (stream EchoMessage);
  rpc ClientStream(stream EchoMessage) returns (EchoMessage);
  rpc BidiStream(stream EchoMessage) returns (stream EchoMessage);
}
message EchoMessage { string text = 1; }
`)
	imp := &packageimport.Importer{DataDir: dataDir, Store: st}
	res, err := imp.Import(ctx, packageimport.Options{ServiceID: "streaming", Source: pkgDir, Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	sup := supervisor.New(dataDir, st)
	gateway := &protocol.Gateway{Store: st}
	adminSrv := &admin.Server{Store: st, Importer: imp, Supervisor: sup, Gateway: gateway}
	defer sup.Stop(context.Background(), "streaming-test")

	postAdmin(t, adminSrv, "/admin/v1/instances", map[string]any{"id": "streaming-test", "service_id": "streaming", "config": map[string]any{}, "start": true})
	postAdmin(t, adminSrv, "/admin/v1/capsets", map[string]any{"id": "dev", "name": "DevAgent", "enabled": true})
	postAdmin(t, adminSrv, "/admin/v1/capsets/dev/instances", map[string]any{"instance_id": "streaming-test", "all_methods": true})

	cat, err := gateway.CatalogWithOptions(ctx, "dev", protocol.CatalogOptions{IncludeGRPC: true, IncludeMCP: true, IncludeConnect: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(cat.GRPC) != 4 || len(cat.ConnectRPC) != 1 || len(cat.MCP) != 1 {
		t.Fatalf("streaming catalog should expose all gRPC methods and unary-only Connect/MCP: %+v", cat)
	}
	for _, streamingRoute := range []string{
		"/capsets/dev/connect/streaming-test/echo.v1.EchoService/ServerStream",
		"/capsets/dev/connect/streaming-test/echo.v1.EchoService/ClientStream",
		"/capsets/dev/connect/streaming-test/echo.v1.EchoService/BidiStream",
	} {
		w := httptest.NewRecorder()
		gateway.HandleConnectRPC(w, httptest.NewRequest(http.MethodPost, streamingRoute, bytes.NewBufferString(`{"text":"stream"}`)))
		if w.Code != http.StatusNotImplemented {
			t.Fatalf("streaming Connect route %s status=%d body=%s", streamingRoute, w.Code, w.Body.String())
		}
	}
	mcpStream := httptest.NewRecorder()
	gateway.HandleMCP(mcpStream, httptest.NewRequest(http.MethodPost, "/capsets/dev/mcp", bytes.NewBufferString(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"streaming__streaming-test__server_stream","arguments":{"text":"stream"}}}`)))
	if mcpStream.Code != http.StatusOK || !bytes.Contains(mcpStream.Body.Bytes(), []byte("UNIMPLEMENTED")) {
		t.Fatalf("streaming MCP status=%d body=%s", mcpStream.Code, mcpStream.Body.String())
	}

	files, err := protodesc.NewFiles(mustLoadDescriptor(t, res.Service.DescriptorPath))
	if err != nil {
		t.Fatal(err)
	}
	msgDesc := mustMessage(t, files, "echo.v1.EchoMessage")
	gatewayAddr, stopGateway := startGatewayGRPC(t, gateway)
	defer stopGateway()
	conn, err := grpc.NewClient(gatewayAddr, grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithDefaultCallOptions(grpc.ForceCodec(testRawCodec{})))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	grpcCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs("x-octobus-capset", "dev", "x-octobus-instance", "streaming-test"))

	serverStream, err := conn.NewStream(grpcCtx, &grpc.StreamDesc{StreamName: "ServerStream", ServerStreams: true}, "/echo.v1.EchoService/ServerStream")
	if err != nil {
		t.Fatal(err)
	}
	if err := serverStream.SendMsg(echoFrame(t, msgDesc, "server")); err != nil {
		t.Fatal(err)
	}
	if err := serverStream.CloseSend(); err != nil {
		t.Fatal(err)
	}
	assertStreamResponse(t, serverStream, msgDesc, "server")
	assertStreamEOF(t, serverStream)

	clientStream, err := conn.NewStream(grpcCtx, &grpc.StreamDesc{StreamName: "ClientStream", ClientStreams: true}, "/echo.v1.EchoService/ClientStream")
	if err != nil {
		t.Fatal(err)
	}
	if err := clientStream.SendMsg(echoFrame(t, msgDesc, "client")); err != nil {
		t.Fatal(err)
	}
	if err := clientStream.CloseSend(); err != nil {
		t.Fatal(err)
	}
	assertStreamResponse(t, clientStream, msgDesc, "client")
	assertStreamEOF(t, clientStream)

	bidiStream, err := conn.NewStream(grpcCtx, &grpc.StreamDesc{StreamName: "BidiStream", ClientStreams: true, ServerStreams: true}, "/echo.v1.EchoService/BidiStream")
	if err != nil {
		t.Fatal(err)
	}
	if err := bidiStream.SendMsg(echoFrame(t, msgDesc, "bidi")); err != nil {
		t.Fatal(err)
	}
	assertStreamResponse(t, bidiStream, msgDesc, "bidi")
	if err := bidiStream.CloseSend(); err != nil {
		t.Fatal(err)
	}
	assertStreamEOF(t, bidiStream)
}

func TestOnDemandRuntimeIntegration(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	imp := &packageimport.Importer{DataDir: dataDir, Store: st}
	res, err := imp.Import(ctx, packageimport.Options{ServiceID: "ondemand", Source: createOnDemandFixturePackage(t, root), Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	if res.Service.RuntimeMode != domain.RuntimeModeOnDemand {
		t.Fatalf("runtime mode=%q", res.Service.RuntimeMode)
	}
	sup := supervisor.New(dataDir, st)
	gateway := &protocol.Gateway{Store: st, DataDir: dataDir}
	adminSrv := &admin.Server{Store: st, Importer: imp, Supervisor: sup, Gateway: gateway}

	postAdmin(t, adminSrv, "/admin/v1/instances", map[string]any{"id": "ondemand-test", "service_id": "ondemand", "config": map[string]any{"token": "cfg"}, "secret": map[string]any{"apiToken": "sec"}, "start": false})
	inst, err := st.GetInstance(ctx, "ondemand-test")
	if err != nil {
		t.Fatal(err)
	}
	if !inst.Enabled || inst.Status != domain.StatusRunning || inst.PID != nil || inst.ListenAddr != "" {
		t.Fatalf("unexpected on-demand instance: %+v", inst)
	}
	postAdmin(t, adminSrv, "/admin/v1/capsets", map[string]any{"id": "dev", "name": "DevAgent", "enabled": true})
	postAdmin(t, adminSrv, "/admin/v1/capsets/dev/instances", map[string]any{"instance_id": "ondemand-test", "all_methods": true})

	files, err := protodesc.NewFiles(mustLoadDescriptor(t, res.Service.DescriptorPath))
	if err != nil {
		t.Fatal(err)
	}
	msgDesc := mustMessage(t, files, "echo.v1.EchoMessage")
	req := echoFrame(t, msgDesc, "ondemand")
	grpcAddr, stopGRPC := startGatewayGRPC(t, gateway)
	defer stopGRPC()
	conn, err := grpc.NewClient(grpcAddr, grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithDefaultCallOptions(grpc.ForceCodec(testRawCodec{})))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	grpcCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs("x-octobus-capset", "dev", "x-octobus-instance", "ondemand-test", "x-business-request-id", "integration-od"))
	grpcOut := newTestRawFrame(nil)
	if err := conn.Invoke(grpcCtx, "/echo.v1.EchoService/Echo", req, grpcOut); err != nil {
		t.Fatal(err)
	}
	if got := decodeText(t, msgDesc, grpcOut.Bytes()); got != "ondemand" {
		t.Fatalf("on-demand grpc response=%q", got)
	}
	metadataCopy := filepath.Join(dataDir, "artifacts", "services", "ondemand", "runtime", "last-metadata.json")
	metadataRaw, err := os.ReadFile(metadataCopy)
	if err != nil {
		t.Fatalf("read copied metadata: %v", err)
	}
	if !bytes.Contains(metadataRaw, []byte("x-business-request-id")) || bytes.Contains(metadataRaw, []byte("x-octobus-capset")) {
		t.Fatalf("unexpected on-demand metadata: %s", metadataRaw)
	}

	cat, err := gateway.CatalogWithOptions(ctx, "dev", protocol.CatalogOptions{IncludeGRPC: true, IncludeMCP: true, IncludeConnect: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(cat.ConnectRPC) != 5 || len(cat.MCP) != 5 || len(cat.GRPC) != 5 {
		t.Fatalf("unexpected on-demand catalog: %+v", cat)
	}
	connectReq := httptest.NewRequest(http.MethodPost, "/capsets/dev/connect/ondemand-test/echo.v1.EchoService/Echo", bytes.NewBufferString(`{"text":"connect-od"}`))
	connectReq.Header.Set("Content-Type", "application/json")
	connectResp := httptest.NewRecorder()
	gateway.HandleConnectRPC(connectResp, connectReq)
	if connectResp.Code != http.StatusOK || !bytes.Contains(connectResp.Body.Bytes(), []byte(`"text":"connect-od"`)) {
		t.Fatalf("on-demand Connect status=%d body=%s", connectResp.Code, connectResp.Body.String())
	}
	mcpCall := httptest.NewRecorder()
	gateway.HandleMCP(mcpCall, httptest.NewRequest(http.MethodPost, "/capsets/dev/mcp", bytes.NewBufferString(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ondemand__ondemand-test__echo","arguments":{"text":"mcp-od"}}}`)))
	if mcpCall.Code != http.StatusOK || !bytes.Contains(mcpCall.Body.Bytes(), []byte(`"text":"mcp-od"`)) {
		t.Fatalf("on-demand MCP status=%d body=%s", mcpCall.Code, mcpCall.Body.String())
	}

	err = conn.Invoke(grpcCtx, "/echo.v1.EchoService/Fail", req, newTestRawFrame(nil))
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("on-demand error code=%v err=%v", status.Code(err), err)
	}
	for _, tc := range []struct {
		method     string
		tool       string
		wantStatus int
		wantCode   string
	}{
		{method: "Invalid", tool: "invalid", wantStatus: http.StatusBadRequest, wantCode: "INVALID_ARGUMENT"},
		{method: "Exhausted", tool: "exhausted", wantStatus: http.StatusTooManyRequests, wantCode: "RESOURCE_EXHAUSTED"},
		{method: "Unavailable", tool: "unavailable", wantStatus: http.StatusServiceUnavailable, wantCode: "UNAVAILABLE"},
	} {
		connectErrReq := httptest.NewRequest(http.MethodPost, "/capsets/dev/connect/ondemand-test/echo.v1.EchoService/"+tc.method, bytes.NewBufferString(`{"text":"err"}`))
		connectErrReq.Header.Set("Content-Type", "application/json")
		connectErrResp := httptest.NewRecorder()
		gateway.HandleConnectRPC(connectErrResp, connectErrReq)
		if connectErrResp.Code != tc.wantStatus || !bytes.Contains(connectErrResp.Body.Bytes(), []byte(strings.ToLower(tc.wantCode))) {
			t.Fatalf("on-demand Connect %s status=%d body=%s", tc.method, connectErrResp.Code, connectErrResp.Body.String())
		}
		mcpErr := httptest.NewRecorder()
		gateway.HandleMCP(mcpErr, httptest.NewRequest(http.MethodPost, "/capsets/dev/mcp", bytes.NewBufferString(`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"ondemand__ondemand-test__`+tc.tool+`","arguments":{"text":"err"}}}`)))
		if mcpErr.Code != http.StatusOK || !bytes.Contains(mcpErr.Body.Bytes(), []byte(tc.wantCode)) {
			t.Fatalf("on-demand MCP %s status=%d body=%s", tc.method, mcpErr.Code, mcpErr.Body.String())
		}
	}
	for _, action := range []string{"start", "stop", "restart"} {
		w := postAdminStatus(t, adminSrv, "/admin/v1/instances/ondemand-test/"+action, map[string]any{}, http.StatusBadRequest)
		if !bytes.Contains(w.Body.Bytes(), []byte(supervisor.ErrUnsupportedRuntimeControl.Error())) {
			t.Fatalf("on-demand %s body=%s", action, w.Body.String())
		}
	}
	w := postAdminStatus(t, adminSrv, "/admin/v1/instances/ondemand-test/config", map[string]any{"config": map[string]any{"token": "next"}, "restart": true}, http.StatusBadRequest)
	if !bytes.Contains(w.Body.Bytes(), []byte(supervisor.ErrUnsupportedRuntimeControl.Error())) {
		t.Fatalf("on-demand config restart body=%s", w.Body.String())
	}
	after, err := st.GetInstance(ctx, "ondemand-test")
	if err != nil {
		t.Fatal(err)
	}
	if after.PID != nil || after.ListenAddr != "" {
		t.Fatalf("on-demand invoke persisted runtime resources: %+v", after)
	}
}

func TestImportBuildsSourcePackageIntegration(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	imp := &packageimport.Importer{DataDir: dataDir, Store: st}
	adminSrv := &admin.Server{Store: st, Importer: imp, Supervisor: supervisor.New(dataDir, st), Gateway: &protocol.Gateway{Store: st}}

	source := createBuildFixturePackage(t, root, "build-fixture")
	body := postAdminStatus(t, adminSrv, "/admin/v1/services/import", map[string]any{"service_id": "built", "source": source, "build": "always"}, http.StatusOK).Body.Bytes()
	if !bytes.Contains(body, []byte(`"NodeEntry":"bin/entry"`)) {
		t.Fatalf("built import response missing node entry: %s", body)
	}
	svc, err := st.GetService(ctx, "built")
	if err != nil {
		t.Fatal(err)
	}
	if svc.NodeEntry != "bin/entry" || len(svc.Methods) != 1 {
		t.Fatalf("unexpected built service: %+v", svc)
	}
	for _, path := range []string{
		filepath.Join(dataDir, "artifacts", "services", "built", "package", "bin", "entry"),
		filepath.Join(dataDir, "artifacts", "services", "built", "runtime", "bin", "entry"),
		svc.PackageArtifactPath,
		svc.DescriptorPath,
	} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("expected built artifact %s: %v", path, err)
		}
	}

	postAdminStatus(t, adminSrv, "/admin/v1/services/import", map[string]any{"service_id": "built", "source": createBuildFixturePackage(t, root, "build-never-fixture"), "build": "never"}, http.StatusBadRequest)
}

func TestIntegrationBoundaryRoutesAndArchiveImports(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	imp := &packageimport.Importer{DataDir: dataDir, Store: st}
	sup := supervisor.New(dataDir, st)
	gateway := &protocol.Gateway{Store: st, DataDir: dataDir}
	adminSrv := &admin.Server{Store: st, Importer: imp, Supervisor: sup, Gateway: gateway}

	zipSource := zipPackage(t, createFixturePackage(t, root), filepath.Join(root, "fixture.zip"))
	postAdminStatus(t, adminSrv, "/admin/v1/services/import", map[string]any{"service_id": "zip", "source": zipSource, "offline": true}, http.StatusOK)
	postAdminStatus(t, adminSrv, "/admin/v1/services/import", map[string]any{"service_id": "npmfail", "source": "npm:not-a-real-octobus-package-for-integration-coverage-0000"}, http.StatusBadRequest)
	postAdminStatus(t, adminSrv, "/admin/v1/services/import", map[string]any{"service_id": "gitfail", "source": "ssh://example.invalid/repo.git"}, http.StatusBadRequest)

	postAdmin(t, adminSrv, "/admin/v1/instances", map[string]any{"id": "zip-test", "service_id": "zip", "config": map[string]any{}, "start": false})
	postAdmin(t, adminSrv, "/admin/v1/capsets", map[string]any{"id": "dev", "name": "DevAgent", "enabled": true})
	postAdmin(t, adminSrv, "/admin/v1/capsets/dev/instances", map[string]any{"instance_id": "zip-test", "all_methods": true})
	postAdminStatus(t, adminSrv, "/admin/v1/capsets/dev/instances", map[string]any{"instance_id": "missing", "all_methods": true}, http.StatusNotFound)
	postAdminStatus(t, adminSrv, "/admin/v1/capsets/dev/methods", map[string]any{"instance_id": "zip-test", "method": "echo.v1.EchoService/Missing"}, http.StatusBadRequest)
	postAdminStatus(t, adminSrv, "/admin/v1/instances/zip-test/config", map[string]any{"config": map[string]any{"from": "config"}}, http.StatusOK)
	postAdminStatus(t, adminSrv, "/admin/v1/instances/zip-test/secret", map[string]any{"secret": map[string]any{"apiToken": "secret"}}, http.StatusOK)
	patchAdminStatus(t, adminSrv, "/admin/v1/instances/zip-test", map[string]any{"name": ""}, http.StatusBadRequest)
	patchAdminStatus(t, adminSrv, "/admin/v1/capsets/dev", map[string]any{"name": ""}, http.StatusBadRequest)

	assertAdminStatus(t, adminSrv, http.MethodGet, "/admin/v1/catalog/missing", nil, http.StatusNotFound)
	assertAdminStatus(t, adminSrv, http.MethodGet, "/admin/v1/catalog/dev?format=xml", nil, http.StatusBadRequest)
	assertAdminStatus(t, &admin.Server{Store: st}, http.MethodGet, "/admin/v1/catalog/dev", nil, http.StatusInternalServerError)
	assertAdminStatus(t, adminSrv, http.MethodGet, "/admin/v1/catalog/missing/openapi.json", nil, http.StatusNotFound)
	assertAdminStatus(t, adminSrv, http.MethodPost, "/admin/v1/status", nil, http.StatusMethodNotAllowed)
	assertAdminStatus(t, adminSrv, http.MethodPost, "/admin/v1/services", nil, http.StatusMethodNotAllowed)
	assertAdminStatus(t, adminSrv, http.MethodPost, "/admin/v1/services/zip", nil, http.StatusMethodNotAllowed)
	assertAdminStatus(t, adminSrv, http.MethodPut, "/admin/v1/instances", nil, http.StatusMethodNotAllowed)
	assertAdminStatus(t, adminSrv, http.MethodPost, "/admin/v1/instances/zip-test/unknown", map[string]any{}, http.StatusNotFound)
	assertAdminStatus(t, adminSrv, http.MethodPut, "/admin/v1/capsets", nil, http.StatusMethodNotAllowed)
	assertAdminStatus(t, adminSrv, http.MethodPost, "/admin/v1/capsets/dev", nil, http.StatusMethodNotAllowed)
	assertAdminStatus(t, adminSrv, http.MethodGet, "/admin/v1/unknown", nil, http.StatusNotFound)

	combined := server.CombinedHandler(adminSrv.Handler(), http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
	}), gateway)
	adminResp := httptest.NewRecorder()
	combined.ServeHTTP(adminResp, httptest.NewRequest(http.MethodGet, "/admin/v1/status", nil))
	if adminResp.Code != http.StatusOK {
		t.Fatalf("combined admin status=%d body=%s", adminResp.Code, adminResp.Body.String())
	}
	connectResp := httptest.NewRecorder()
	connectReq := httptest.NewRequest(http.MethodPost, "/capsets/dev/connect/zip-test/echo.v1.EchoService/Echo", bytes.NewBufferString(`{"text":"x"}`))
	connectReq.Header.Set("Content-Type", "application/json")
	combined.ServeHTTP(connectResp, connectReq)
	if connectResp.Code != http.StatusServiceUnavailable {
		t.Fatalf("combined gateway status=%d body=%s", connectResp.Code, connectResp.Body.String())
	}
	grpcResp := httptest.NewRecorder()
	grpcReq := httptest.NewRequest(http.MethodPost, "/anything", nil)
	grpcReq.ProtoMajor = 2
	grpcReq.Header.Set("Content-Type", "application/grpc")
	combined.ServeHTTP(grpcResp, grpcReq)
	if grpcResp.Code != http.StatusAccepted {
		t.Fatalf("combined grpc status=%d", grpcResp.Code)
	}
	publicResp := httptest.NewRecorder()
	server.PublicHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) }), gateway).ServeHTTP(publicResp, grpcReq)
	if publicResp.Code != http.StatusNoContent {
		t.Fatalf("public grpc status=%d", publicResp.Code)
	}

	httpSrv := httptest.NewServer(adminSrv.Handler())
	defer httpSrv.Close()
	t.Setenv("OCTOBUS_ADDR", strings.TrimPrefix(httpSrv.URL, "http://"))
	c := cli.New()
	c.Client = httpSrv.Client()
	var out bytes.Buffer
	c.Stdout = &out
	c.Stdin = strings.NewReader(`{"from":"stdin"}`)
	if err := c.Run([]string{"instance", "update-config", "zip-test", "--config", "-"}); err != nil {
		t.Fatalf("cli stdin config: %v\n%s", err, out.String())
	}
	if !bytes.Contains(out.Bytes(), []byte(`"from": "stdin"`)) {
		t.Fatalf("cli stdout missing stdin config: %s", out.String())
	}
	out.Reset()
	if err := c.Run([]string{"catalog", "dev", "--md"}); err != nil {
		t.Fatalf("cli catalog md: %v", err)
	}
	if !strings.Contains(out.String(), "Schema Discovery") {
		t.Fatalf("cli markdown output=%s", out.String())
	}

	if _, err := st.GetCapsetMethod(ctx, "dev:zip-test", "echo.v1.EchoService/Echo"); err != nil {
		t.Fatal(err)
	}
	if _, err := gateway.Catalog(ctx, "dev"); err != nil {
		t.Fatal(err)
	}
	if raw, err := protocol.DescriptorBytesForCatalog(ctx, st, "dev"); err != nil || len(raw) == 0 {
		t.Fatalf("descriptor bytes len=%d err=%v", len(raw), err)
	}
	gateway.InvalidateInstance("zip-test")
	_ = gateway.Close()
}

func TestSchemaValidationIntegration(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	imp := &packageimport.Importer{DataDir: dataDir, Store: st}
	sup := supervisor.New(dataDir, st)
	adminSrv := &admin.Server{Store: st, Importer: imp, Supervisor: sup, Gateway: &protocol.Gateway{Store: st}}

	res, err := imp.Import(ctx, packageimport.Options{ServiceID: "schema", Source: createSchemaFixturePackage(t, root), Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	if res.Service.ConfigSchemaPath == "" || res.Service.SecretSchemaPath == "" {
		t.Fatalf("schema paths not stored: %+v", res.Service)
	}
	postAdminStatus(t, adminSrv, "/admin/v1/instances", map[string]any{"id": "bad-config", "service_id": "schema", "config": map[string]any{"token": 123}, "secret": map[string]any{"apiToken": "secret"}, "start": false}, http.StatusBadRequest)
	postAdminStatus(t, adminSrv, "/admin/v1/instances", map[string]any{"id": "bad-secret", "service_id": "schema", "config": map[string]any{"token": "cfg"}, "secret": map[string]any{"apiToken": 123}, "start": false}, http.StatusBadRequest)
	postAdmin(t, adminSrv, "/admin/v1/instances", map[string]any{"id": "schema-test", "service_id": "schema", "config": map[string]any{"token": "cfg"}, "secret": map[string]any{"apiToken": "secret"}, "start": false})
	postAdminStatus(t, adminSrv, "/admin/v1/instances/schema-test/config", map[string]any{"config": map[string]any{"token": 123}}, http.StatusBadRequest)
	postAdminStatus(t, adminSrv, "/admin/v1/instances/schema-test/secret", map[string]any{"secret": map[string]any{"apiToken": 123}}, http.StatusBadRequest)
	postAdmin(t, adminSrv, "/admin/v1/instances/schema-test/config", map[string]any{"config": map[string]any{"token": "next"}})
	postAdmin(t, adminSrv, "/admin/v1/instances/schema-test/secret", map[string]any{"secret": map[string]any{"apiToken": "next-secret"}})
}

func TestProtocolUtilityIntegration(t *testing.T) {
	if os.Getenv("OCTOBUS_HELPER_PROCESS") == "1" {
		runHelperProcess()
		return
	}
	ctx := context.Background()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	t.Setenv("OCTOBUS_HELPER_BINARY", os.Args[0])
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	imp := &packageimport.Importer{DataDir: dataDir, Store: st}
	if _, err := imp.Import(ctx, packageimport.Options{ServiceID: "echo", Source: createFixturePackage(t, root), Offline: true}); err != nil {
		t.Fatal(err)
	}
	sup := supervisor.New(dataDir, st)
	gateway := &protocol.Gateway{Store: st}
	adminSrv := &admin.Server{Store: st, Importer: imp, Supervisor: sup, Gateway: gateway}
	defer sup.Stop(context.Background(), "echo-test")
	postAdmin(t, adminSrv, "/admin/v1/instances", map[string]any{"id": "echo-test", "service_id": "echo", "config": map[string]any{}, "start": true})
	postAdmin(t, adminSrv, "/admin/v1/capsets", map[string]any{"id": "dev", "name": "DevAgent", "enabled": true})
	postAdmin(t, adminSrv, "/admin/v1/capsets/dev/instances", map[string]any{"instance_id": "echo-test", "all_methods": true})

	files, err := protodesc.NewFiles(mustLoadDescriptor(t, filepath.Join(dataDir, "artifacts", "services", "echo", "descriptor.protoset")))
	if err != nil {
		t.Fatal(err)
	}
	msgDesc := mustMessage(t, files, "echo.v1.EchoMessage")
	grpcCtx := metadata.NewIncomingContext(ctx, metadata.Pairs("x-octobus-capset", "dev", "x-octobus-instance", "echo-test"))
	out, err := gateway.UnaryProxy(grpcCtx, "/echo.v1.EchoService/Echo", echoFrame(t, msgDesc, "proxy").Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if got := decodeText(t, msgDesc, out); got != "proxy" {
		t.Fatalf("unary proxy text=%q", got)
	}
	if _, err := gateway.UnaryProxy(context.Background(), "/echo.v1.EchoService/Echo", nil); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("unary proxy missing metadata code=%v err=%v", status.Code(err), err)
	}
	missingMethodReq := httptest.NewRequest(http.MethodPost, "/capsets/dev/connect/echo-test/echo.v1.EchoService/Missing", bytes.NewBufferString(`{"text":"missing"}`))
	missingMethodReq.Header.Set("Content-Type", "application/json")
	missingMethodResp := httptest.NewRecorder()
	gateway.HandleConnectRPC(missingMethodResp, missingMethodReq)
	if missingMethodResp.Code != http.StatusNotFound {
		t.Fatalf("missing Connect method status=%d body=%s", missingMethodResp.Code, missingMethodResp.Body.String())
	}

	mcpInit := httptest.NewRecorder()
	gateway.HandleMCP(mcpInit, httptest.NewRequest(http.MethodPost, "/capsets/dev/mcp", bytes.NewBufferString(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}`)))
	if mcpInit.Code != http.StatusOK || !bytes.Contains(mcpInit.Body.Bytes(), []byte("2025-06-18")) {
		t.Fatalf("mcp initialize status=%d body=%s", mcpInit.Code, mcpInit.Body.String())
	}
	mcpNotify := httptest.NewRecorder()
	gateway.HandleMCP(mcpNotify, httptest.NewRequest(http.MethodPost, "/capsets/dev/mcp", bytes.NewBufferString(`{"jsonrpc":"2.0","method":"notifications/initialized"}`)))
	if mcpNotify.Code != http.StatusAccepted {
		t.Fatalf("mcp notification status=%d", mcpNotify.Code)
	}
	mcpBad := httptest.NewRecorder()
	gateway.HandleMCP(mcpBad, httptest.NewRequest(http.MethodPost, "/capsets/dev/mcp", bytes.NewBufferString(`{"jsonrpc":"2.0","id":2,"method":"unknown"}`)))
	if mcpBad.Code != http.StatusOK || !bytes.Contains(mcpBad.Body.Bytes(), []byte("unsupported MCP method")) {
		t.Fatalf("mcp unsupported status=%d body=%s", mcpBad.Code, mcpBad.Body.String())
	}
	largeReq := httptest.NewRequest(http.MethodPost, "/capsets/dev/mcp", strings.NewReader("{}"))
	largeReq.ContentLength = protocol.DefaultMaxRequestBytes + 1
	largeResp := httptest.NewRecorder()
	gateway.HandleMCP(largeResp, largeReq)
	if largeResp.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("large mcp status=%d body=%s", largeResp.Code, largeResp.Body.String())
	}

	listenCtx, cancel := context.WithCancel(ctx)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	if err := ln.Close(); err != nil {
		t.Fatal(err)
	}
	errc := make(chan error, 1)
	go func() {
		errc <- admin.ListenAndServe(listenCtx, addr, adminSrv.Handler())
	}()
	statusCode := waitHTTPStatus(t, "http://"+addr+"/admin/v1/status")
	if statusCode != http.StatusOK {
		cancel()
		t.Fatalf("listen status=%d", statusCode)
	}
	cancel()
	if err := <-errc; err != nil {
		t.Fatal(err)
	}
}

func TestCLIAdminGatewayAndStoreIntegrationCRUD(t *testing.T) {
	if os.Getenv("OCTOBUS_HELPER_PROCESS") == "1" {
		runHelperProcess()
		return
	}
	ctx := context.Background()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	t.Setenv("OCTOBUS_HELPER_BINARY", os.Args[0])
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	imp := &packageimport.Importer{DataDir: dataDir, Store: st}
	sup := supervisor.New(dataDir, st)
	gateway := &protocol.Gateway{Store: st}
	adminSrv := &admin.Server{Store: st, Importer: imp, Supervisor: sup, Gateway: gateway}
	httpSrv := httptest.NewServer(adminSrv.Handler())
	defer httpSrv.Close()

	c := &cli.CLI{AdminAddr: strings.TrimPrefix(httpSrv.URL, "http://"), Client: httpSrv.Client(), Stdout: &bytes.Buffer{}}
	runCLI := func(args ...string) string {
		t.Helper()
		var out bytes.Buffer
		c.Stdout = &out
		if err := c.Run(args); err != nil {
			t.Fatalf("octobus %s: %v\n%s", strings.Join(args, " "), err, out.String())
		}
		return out.String()
	}

	clientRoot := filepath.Join(root, "client")
	pkgSource := createFixturePackage(t, clientRoot)
	runCLI("service", "import", "echo", "--offline", pkgSource)
	importedEcho, err := st.GetService(ctx, "echo")
	if err != nil {
		t.Fatal(err)
	}
	if importedEcho.PackageSource != "client-upload:fixture" || strings.Contains(importedEcho.PackageSource, pkgSource) {
		t.Fatalf("uploaded CLI import package source mismatch: %+v", importedEcho)
	}
	runCLI("status")
	runCLI("service", "list")
	runCLI("service", "get", "echo")
	runCLI("service", "update", "echo", "--name", "Echo Updated")
	runCLI("instance", "create", "echo-test", "--service", "echo", "--config-json", `{"token":"a"}`, "--secret-json", `{"apiToken":"s"}`, "--no-start")
	runCLI("instance", "list")
	runCLI("instance", "get", "echo-test")
	runCLI("instance", "update", "echo-test", "--name", "Echo Renamed")
	runCLI("instance", "update-config", "echo-test", "--config-json", `{"token":"b"}`)
	runCLI("instance", "update-secret", "echo-test", "--secret-json", `{"apiToken":"next"}`)
	runCLI("capset", "create", "dev", "--name", "DevAgent", "--description", "tools")
	runCLI("capset", "list")
	runCLI("capset", "get", "dev")
	runCLI("capset", "update", "dev", "--description", "updated", "--enabled=false")
	runCLI("capset", "update", "dev", "--enabled=true")
	runCLI("capset", "add-instance", "dev", "echo-test", "--no-all-methods")
	runCLI("capset", "list-instances", "dev")
	runCLI("capset", "select-method", "dev", "echo-test", "echo.v1.EchoService/Echo", "--mcp-tool", "echo_tool")
	runCLI("capset", "list-methods", "dev")
	runCLI("catalog", "dev", "--all")
	runCLI("catalog", "dev", "--openapi-json")
	runCLI("catalog", "dev", "--openapi-yaml")

	connectReq := httptest.NewRequest(http.MethodPost, "/capsets/dev/connect/echo-test/echo.v1.EchoService/Echo", bytes.NewBufferString(`{"text":"stopped"}`))
	connectReq.Header.Set("Content-Type", "application/json")
	connectResp := httptest.NewRecorder()
	gateway.Handler().ServeHTTP(connectResp, connectReq)
	if connectResp.Code != http.StatusServiceUnavailable {
		t.Fatalf("stopped Connect status=%d body=%s", connectResp.Code, connectResp.Body.String())
	}
	mcpList := httptest.NewRecorder()
	gateway.Handler().ServeHTTP(mcpList, httptest.NewRequest(http.MethodPost, "/capsets/dev/mcp", bytes.NewBufferString(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)))
	if mcpList.Code != http.StatusOK || !bytes.Contains(mcpList.Body.Bytes(), []byte("echo_tool")) {
		t.Fatalf("MCP list status=%d body=%s", mcpList.Code, mcpList.Body.String())
	}

	runCLI("capset", "unselect-method", "dev", "echo-test", "echo.v1.EchoService/Echo")
	runCLI("capset", "remove-instance", "dev", "echo-test")
	runCLI("capset", "delete", "dev")
	runCLI("instance", "delete", "echo-test")
	runCLI("service", "delete", "echo")
	if count, err := st.CountServices(ctx); err != nil || count != 0 {
		t.Fatalf("service cleanup count=%d err=%v", count, err)
	}
}

func TestCLIRecursiveServiceImportListsServices(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	pkgDir := createRecursiveFixturePackage(t, root)
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	imp := &packageimport.Importer{DataDir: dataDir, Store: st}
	adminSrv := &admin.Server{Store: st, Importer: imp, Supervisor: supervisor.New(dataDir, st)}
	httpSrv := httptest.NewServer(adminSrv.Handler())
	defer httpSrv.Close()

	c := &cli.CLI{AdminAddr: strings.TrimPrefix(httpSrv.URL, "http://"), Client: httpSrv.Client(), Stdout: &bytes.Buffer{}}
	runCLI := func(args ...string) string {
		t.Helper()
		var out bytes.Buffer
		c.Stdout = &out
		if err := c.Run(args); err != nil {
			t.Fatalf("octobus %s: %v\n%s", strings.Join(args, " "), err, out.String())
		}
		return out.String()
	}
	importOut := runCLI("service", "import", "--recursive", "--offline", "--build", "never", pkgDir)
	var imported struct {
		ServiceCount int `json:"service_count"`
	}
	if err := json.Unmarshal([]byte(importOut), &imported); err != nil {
		t.Fatal(err)
	}
	if imported.ServiceCount != 2 {
		t.Fatalf("recursive import service_count=%d output=%s", imported.ServiceCount, importOut)
	}
	listOut := runCLI("service", "list")
	var listed struct {
		Services []domain.Service `json:"services"`
	}
	if err := json.Unmarshal([]byte(listOut), &listed); err != nil {
		t.Fatal(err)
	}
	byID := map[string]domain.Service{}
	for _, svc := range listed.Services {
		byID[svc.ID] = svc
	}
	for _, want := range []struct {
		id          string
		serviceRoot string
		nodeEntry   string
	}{
		{id: "alpha-service", serviceRoot: "vendor__alpha", nodeEntry: "bin/alpha-service.js"},
		{id: "beta-service", serviceRoot: "nested/vendor__beta", nodeEntry: "bin/beta-service.js"},
	} {
		svc, ok := byID[want.id]
		if !ok {
			t.Fatalf("service %s missing from service list: %s", want.id, listOut)
		}
		wantSource := "client-upload:recursive-fixture//" + want.serviceRoot
		if svc.ServiceRoot != want.serviceRoot || svc.NodeEntry != want.nodeEntry || svc.PackageSource != wantSource {
			t.Fatalf("service %s metadata mismatch: %+v", want.id, svc)
		}
		stored, err := st.GetService(context.Background(), want.id)
		if err != nil {
			t.Fatal(err)
		}
		if stored.ServiceRoot != want.serviceRoot || stored.NodeEntry != want.nodeEntry || stored.PackageSource != wantSource {
			t.Fatalf("stored service %s metadata mismatch: %+v", want.id, stored)
		}
	}
}

func TestCLIServiceImportUploadArchiveAndRemoteModeIntegration(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	clientRoot := filepath.Join(root, "client")
	pkgDir := createFixturePackage(t, clientRoot)
	zipSource := zipPackage(t, pkgDir, filepath.Join(clientRoot, "fixture.zip"))
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	imp := &packageimport.Importer{DataDir: dataDir, Store: st}
	adminSrv := &admin.Server{Store: st, Importer: imp, Supervisor: supervisor.New(dataDir, st)}
	httpSrv := httptest.NewServer(adminSrv.Handler())
	defer httpSrv.Close()

	c := &cli.CLI{AdminAddr: strings.TrimPrefix(httpSrv.URL, "http://"), Client: httpSrv.Client(), Stdout: &bytes.Buffer{}}
	runCLI := func(args ...string) string {
		t.Helper()
		var out bytes.Buffer
		c.Stdout = &out
		if err := c.Run(args); err != nil {
			t.Fatalf("octobus %s: %v\n%s", strings.Join(args, " "), err, out.String())
		}
		return out.String()
	}

	runCLI("service", "import", "--source-mode", "upload", "--offline", "zip", zipSource)
	zipSvc, err := st.GetService(context.Background(), "zip")
	if err != nil {
		t.Fatal(err)
	}
	if zipSvc.PackageSource != "client-upload:fixture.zip" || strings.Contains(zipSvc.PackageSource, zipSource) {
		t.Fatalf("uploaded archive package source mismatch: %+v", zipSvc)
	}
	var out bytes.Buffer
	c.Stdout = &out
	err = c.Run([]string{"service", "import", "--source-mode", "upload", "--build", "always", "--offline", "zipfail", zipSource})
	if err == nil || !strings.Contains(err.Error(), "--build=always is only supported") {
		t.Fatalf("expected uploaded archive build=always error, got %v output=%s", err, out.String())
	}
	if _, err := st.GetService(context.Background(), "zipfail"); err == nil {
		t.Fatal("zipfail service was committed after build=always upload failure")
	}

	runCLI("service", "import", "--source-mode", "remote", "--offline", "remote", pkgDir)
	remoteSvc, err := st.GetService(context.Background(), "remote")
	if err != nil {
		t.Fatal(err)
	}
	if remoteSvc.PackageSource != pkgDir {
		t.Fatalf("remote source mode package source=%q want %q", remoteSvc.PackageSource, pkgDir)
	}
}

func TestRecursiveServiceImportRestartDegradedIntegration(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	pkgDir := createRecursiveFixturePackage(t, root)
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	imp := &packageimport.Importer{DataDir: dataDir, Store: st}
	sup := supervisor.New(dataDir, st)
	adminSrv := &admin.Server{Store: st, Importer: imp, Supervisor: sup}
	if _, err := imp.ImportRecursive(ctx, packageimport.Options{Source: pkgDir, Recursive: true, Offline: true, Build: "never"}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "alpha-enabled", ServiceID: "alpha-service", Name: "Alpha Enabled", Enabled: true, Status: domain.StatusStopped, NodeEntry: "bin/alpha-service.js", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	resp := postAdminStatus(t, adminSrv, "/admin/v1/services/import", map[string]any{"recursive": true, "source": pkgDir, "offline": true, "build": "never"}, http.StatusConflict)
	var body struct {
		Status        string              `json:"status"`
		RestartErrors map[string][]string `json:"restart_errors"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Status != "degraded" || len(body.RestartErrors["alpha-service"]) == 0 {
		t.Fatalf("unexpected recursive degraded response: %+v body=%s", body, resp.Body.String())
	}
	if _, err := st.GetService(ctx, "alpha-service"); err != nil {
		t.Fatalf("imported service was rolled back after restart failure: %v", err)
	}
}

func createFixturePackage(t *testing.T, root string) string {
	return createFixturePackageWithProto(t, root, "fixture", `syntax = "proto3";
package echo.v1;
service EchoService { rpc Echo(EchoMessage) returns (EchoMessage); }
message EchoMessage { string text = 1; }
`)
}

func createRecursiveFixturePackage(t *testing.T, root string) string {
	t.Helper()
	pkg := filepath.Join(root, "recursive-fixture")
	for _, dir := range []string{
		filepath.Join(pkg, "bin"),
		filepath.Join(pkg, "vendor__alpha", "proto"),
		filepath.Join(pkg, "nested", "vendor__beta", "proto"),
	} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	writeFile(t, filepath.Join(pkg, "package.json"), `{"name":"recursive-fixture","version":"1.0.0","bin":{"alpha-service":"bin/alpha-service.js","beta-service":"bin/beta-service.js"}}`, 0o644)
	writeFile(t, filepath.Join(pkg, "bin", "alpha-service.js"), "#!/bin/sh\n", 0o755)
	writeFile(t, filepath.Join(pkg, "bin", "beta-service.js"), "#!/bin/sh\n", 0o755)
	writeFile(t, filepath.Join(pkg, "vendor__alpha", "service.json"), `{"schema":"chaitin.octobus.service.v1","name":"alpha-service","displayName":"Alpha Service","proto":{"roots":["proto"],"files":["proto/alpha.proto"]}}`, 0o644)
	writeFile(t, filepath.Join(pkg, "vendor__alpha", "proto", "alpha.proto"), `syntax = "proto3";
package alpha.v1;
service AlphaService { rpc Call(AlphaRequest) returns (AlphaResponse); }
message AlphaRequest { string text = 1; }
message AlphaResponse { string text = 1; }
`, 0o644)
	writeFile(t, filepath.Join(pkg, "nested", "vendor__beta", "service.json"), `{"schema":"chaitin.octobus.service.v1","name":"beta-service","displayName":"Beta Service","proto":{"roots":["proto"],"files":["proto/beta.proto"]}}`, 0o644)
	writeFile(t, filepath.Join(pkg, "nested", "vendor__beta", "proto", "beta.proto"), `syntax = "proto3";
package beta.v1;
service BetaService { rpc Call(BetaRequest) returns (BetaResponse); }
message BetaRequest { string text = 1; }
message BetaResponse { string text = 1; }
`, 0o644)
	return pkg
}

func createFixturePackageWithProto(t *testing.T, root, name, protoBody string) string {
	t.Helper()
	pkg := filepath.Join(root, name)
	for _, dir := range []string{filepath.Join(pkg, "proto"), filepath.Join(pkg, "node_modules")} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	entry := filepath.Join(pkg, "bin", "entry")
	if err := os.MkdirAll(filepath.Dir(entry), 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, entry, "#!/bin/sh\nOCTOBUS_HELPER_PROCESS=1 exec \"$OCTOBUS_HELPER_BINARY\" -test.run TestGoalFlowImportInstanceCapsetAndInvokeAllProtocols -- \"$@\"\n", 0o755)
	writeFile(t, filepath.Join(pkg, "service.json"), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`, 0o644)
	writeFile(t, filepath.Join(pkg, "package.json"), `{"name":"echo-wrapper","version":"1.0.0","bin":{"echo-wrapper":"bin/entry"}}`, 0o644)
	writeFile(t, filepath.Join(pkg, "proto/echo.proto"), protoBody, 0o644)
	return pkg
}

func createOnDemandFixturePackage(t *testing.T, root string) string {
	t.Helper()
	pkg := filepath.Join(root, "ondemand-fixture")
	for _, dir := range []string{filepath.Join(pkg, "proto"), filepath.Join(pkg, "node_modules"), filepath.Join(pkg, "bin")} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	writeFile(t, filepath.Join(pkg, "service.json"), `{"schema":"chaitin.octobus.service.v1","name":"ondemand-wrapper","runtime":{"mode":"on-demand"},"proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`, 0o644)
	writeFile(t, filepath.Join(pkg, "package.json"), `{"name":"ondemand-wrapper","version":"1.0.0","bin":{"ondemand-wrapper":"bin/invoke"}}`, 0o644)
	writeFile(t, filepath.Join(pkg, "proto/echo.proto"), `syntax = "proto3";
package echo.v1;
service EchoService {
  rpc Echo(EchoMessage) returns (EchoMessage);
  rpc Fail(EchoMessage) returns (EchoMessage);
  rpc Invalid(EchoMessage) returns (EchoMessage);
  rpc Exhausted(EchoMessage) returns (EchoMessage);
  rpc Unavailable(EchoMessage) returns (EchoMessage);
}
message EchoMessage { string text = 1; }
`, 0o644)
	writeFile(t, filepath.Join(pkg, "bin/invoke"), `#!/bin/sh
set -eu
metadata=
method=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --metadata) metadata="$2"; shift 2 ;;
    --method) method="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [ -n "$metadata" ]; then
  cp "$metadata" "$OCTOBUS_PACKAGE_DIR/last-metadata.json"
fi
if [ "$method" = "echo.v1.EchoService/Fail" ]; then
  echo 'OCTOBUS_ERROR:{"code":"PERMISSION_DENIED","message":"fixture denied"}' >&2
  exit 7
fi
if [ "$method" = "echo.v1.EchoService/Invalid" ]; then
  echo 'OCTOBUS_ERROR:{"code":"INVALID_ARGUMENT","message":"fixture invalid"}' >&2
  exit 7
fi
if [ "$method" = "echo.v1.EchoService/Exhausted" ]; then
  echo 'OCTOBUS_ERROR:{"code":"RESOURCE_EXHAUSTED","message":"fixture exhausted"}' >&2
  exit 7
fi
if [ "$method" = "echo.v1.EchoService/Unavailable" ]; then
  echo 'OCTOBUS_ERROR:{"code":"UNAVAILABLE","message":"fixture unavailable"}' >&2
  exit 7
fi
cat
`, 0o755)
	return pkg
}

func createBuildFixturePackage(t *testing.T, root, name string) string {
	t.Helper()
	pkg := filepath.Join(root, name)
	for _, dir := range []string{filepath.Join(pkg, "src"), filepath.Join(pkg, "proto")} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	writeFile(t, filepath.Join(pkg, "service.json"), `{"schema":"chaitin.octobus.service.v1","name":"build-wrapper","displayName":"Build Wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`, 0o644)
	writeFile(t, filepath.Join(pkg, "package.json"), `{"name":"build-wrapper","version":"1.0.0","bin":{"build-wrapper":"bin/entry"},"scripts":{"build":"node src/build.js"}}`, 0o644)
	writeFile(t, filepath.Join(pkg, "src", "build.js"), `const fs = require("fs");
fs.mkdirSync("bin", { recursive: true });
fs.writeFileSync("bin/entry", "#!/bin/sh\nexit 0\n", { mode: 0o755 });
`, 0o644)
	writeFile(t, filepath.Join(pkg, "proto/echo.proto"), `syntax = "proto3";
package echo.v1;
service EchoService { rpc Echo(EchoMessage) returns (EchoMessage); }
message EchoMessage { string text = 1; }
`, 0o644)
	return pkg
}

func createSchemaFixturePackage(t *testing.T, root string) string {
	t.Helper()
	pkg := createFixturePackageWithProto(t, root, "schema-fixture", `syntax = "proto3";
package echo.v1;
service EchoService { rpc Echo(EchoMessage) returns (EchoMessage); }
message EchoMessage { string text = 1; }
`)
	writeFile(t, filepath.Join(pkg, "service.json"), `{"schema":"chaitin.octobus.service.v1","name":"schema-wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]},"configSchema":"config.schema.json","secretSchema":"secret.schema.json"}`, 0o644)
	writeFile(t, filepath.Join(pkg, "package.json"), `{"name":"schema-wrapper","version":"1.0.0","bin":{"schema-wrapper":"bin/entry"}}`, 0o644)
	writeFile(t, filepath.Join(pkg, "config.schema.json"), `{"type":"object","required":["token"],"properties":{"token":{"type":"string"}},"additionalProperties":false}`, 0o644)
	writeFile(t, filepath.Join(pkg, "secret.schema.json"), `{"type":"object","required":["apiToken"],"properties":{"apiToken":{"type":"string"}},"additionalProperties":false}`, 0o644)
	return pkg
}

func zipPackage(t *testing.T, sourceDir, dest string) string {
	t.Helper()
	f, err := os.Create(dest)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	zw := zip.NewWriter(f)
	defer zw.Close()
	if err := filepath.WalkDir(sourceDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(sourceDir, path)
		if err != nil {
			return err
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		header, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		header.Name = filepath.ToSlash(filepath.Join("package", rel))
		header.Method = zip.Deflate
		w, err := zw.CreateHeader(header)
		if err != nil {
			return err
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		_, err = w.Write(raw)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	return dest
}

func writeFile(t *testing.T, path, body string, mode os.FileMode) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), mode); err != nil {
		t.Fatal(err)
	}
}

func logProcessOutput(t *testing.T, dataDir, instanceID string) {
	t.Helper()
	for _, name := range []string{"stdout.log", "stderr.log"} {
		path := filepath.Join(dataDir, "instances", instanceID, name)
		raw, err := os.ReadFile(path)
		if err == nil {
			t.Logf("%s: %s", name, raw)
		}
	}
}

func postAdmin(t *testing.T, srv *admin.Server, path string, body any) {
	t.Helper()
	postAdminStatus(t, srv, path, body, http.StatusOK)
}

func postAdminStatus(t *testing.T, srv *admin.Server, path string, body any, want int) *httptest.ResponseRecorder {
	t.Helper()
	return assertAdminStatus(t, srv, http.MethodPost, path, body, want)
}

func patchAdminStatus(t *testing.T, srv *admin.Server, path string, body any, want int) *httptest.ResponseRecorder {
	t.Helper()
	return assertAdminStatus(t, srv, http.MethodPatch, path, body, want)
}

func assertAdminStatus(t *testing.T, srv *admin.Server, method, path string, body any, want int) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	raw, err := json.Marshal(body)
	if body != nil {
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(raw)
	}
	w := httptest.NewRecorder()
	srv.Handler().ServeHTTP(w, httptest.NewRequest(method, path, reader))
	if w.Code != want {
		t.Fatalf("%s %s status=%d want=%d body=%s", method, path, w.Code, want, w.Body.String())
	}
	return w
}

func getCatalog(t *testing.T, srv *admin.Server) protocol.Catalog {
	t.Helper()
	w := httptest.NewRecorder()
	srv.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/admin/v1/catalog/dev?all=true", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("catalog status=%d body=%s", w.Code, w.Body.String())
	}
	var cat protocol.Catalog
	if err := json.Unmarshal(w.Body.Bytes(), &cat); err != nil {
		t.Fatal(err)
	}
	return cat
}

func getCatalogMarkdown(t *testing.T, srv *admin.Server) string {
	t.Helper()
	w := httptest.NewRecorder()
	srv.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/admin/v1/catalog/dev?all=true&format=md", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("catalog markdown status=%d body=%s", w.Code, w.Body.String())
	}
	return w.Body.String()
}

func mustLoadDescriptor(t *testing.T, path string) *descriptorpb.FileDescriptorSet {
	t.Helper()
	set, err := protocol.LoadServiceDescriptorSet(path)
	if err != nil {
		t.Fatal(err)
	}
	return set
}

func mustMessage(t *testing.T, files *protoregistry.Files, name string) protoreflect.MessageDescriptor {
	t.Helper()
	desc, err := files.FindDescriptorByName(protoreflect.FullName(name))
	if err != nil {
		t.Fatal(err)
	}
	msg, ok := desc.(protoreflect.MessageDescriptor)
	if !ok {
		t.Fatalf("%s is not a message", name)
	}
	return msg
}

func startGatewayGRPC(t *testing.T, gateway *protocol.Gateway) (string, func()) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := protocol.GRPCServer(gateway)
	go srv.Serve(ln)
	return ln.Addr().String(), srv.Stop
}

func decodeText(t *testing.T, desc protoreflect.MessageDescriptor, raw []byte) string {
	t.Helper()
	msg := dynamicpb.NewMessage(desc)
	if err := proto.Unmarshal(raw, msg); err != nil {
		t.Fatal(err)
	}
	return msg.Get(desc.Fields().ByName("text")).String()
}

func echoFrame(t *testing.T, desc protoreflect.MessageDescriptor, text string) *testRawFrame {
	t.Helper()
	msg := dynamicpb.NewMessage(desc)
	msg.Set(desc.Fields().ByName("text"), protoreflect.ValueOfString(text))
	raw, err := proto.Marshal(msg)
	if err != nil {
		t.Fatal(err)
	}
	return newTestRawFrame(raw)
}

func assertStreamResponse(t *testing.T, stream grpc.ClientStream, desc protoreflect.MessageDescriptor, want string) {
	t.Helper()
	resp := newTestRawFrame(nil)
	if err := stream.RecvMsg(resp); err != nil {
		t.Fatal(err)
	}
	if got := decodeText(t, desc, resp.Bytes()); got != want {
		t.Fatalf("stream response text=%q want %q", got, want)
	}
}

func assertStreamEOF(t *testing.T, stream grpc.ClientStream) {
	t.Helper()
	if err := stream.RecvMsg(newTestRawFrame(nil)); !errors.Is(err, io.EOF) {
		t.Fatalf("stream RecvMsg err=%v want EOF", err)
	}
}

func waitHTTPStatus(t *testing.T, url string) int {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	var lastErr error
	for time.Now().Before(deadline) {
		resp, err := http.Get(url)
		if err == nil {
			defer resp.Body.Close()
			return resp.StatusCode
		}
		lastErr = err
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("GET %s did not become ready: %v", url, lastErr)
	return 0
}

func runHelperProcess() {
	args := os.Args
	sep := 0
	for i, arg := range args {
		if arg == "--" {
			sep = i
			break
		}
	}
	if sep == 0 {
		os.Exit(2)
	}
	port := ""
	for i := sep + 1; i < len(args)-1; i++ {
		if args[i] == "--port" {
			port = args[i+1]
		}
	}
	if _, err := strconv.Atoi(port); err != nil {
		os.Exit(2)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		os.Exit(2)
	}
	srv := grpc.NewServer(grpc.ForceServerCodec(testRawCodec{}), grpc.UnknownServiceHandler(func(_ any, stream grpc.ServerStream) error {
		method, _ := grpc.MethodFromServerStream(stream)
		if strings.HasSuffix(method, "/ClientStream") {
			req := newTestRawFrame(nil)
			for {
				err := stream.RecvMsg(req)
				if errors.Is(err, io.EOF) {
					return stream.SendMsg(req)
				}
				if err != nil {
					return err
				}
			}
		}
		if strings.HasSuffix(method, "/BidiStream") {
			for {
				req := newTestRawFrame(nil)
				err := stream.RecvMsg(req)
				if errors.Is(err, io.EOF) {
					return nil
				}
				if err != nil {
					return err
				}
				if err := stream.SendMsg(newTestRawFrame(req.Bytes())); err != nil {
					return err
				}
			}
		}
		req := newTestRawFrame(nil)
		if err := stream.RecvMsg(req); err != nil {
			return err
		}
		return stream.SendMsg(newTestRawFrame(req.Bytes()))
	}))
	healthServer := health.NewServer()
	healthServer.SetServingStatus("", grpc_health_v1.HealthCheckResponse_SERVING)
	grpc_health_v1.RegisterHealthServer(srv, healthServer)
	if err := srv.Serve(ln); err != nil && !strings.Contains(err.Error(), "use of closed network connection") {
		os.Exit(1)
	}
}

type testRawFrame []byte

func newTestRawFrame(b []byte) *testRawFrame { f := testRawFrame(b); return &f }
func (f *testRawFrame) Reset()               { *f = (*f)[:0] }
func (f *testRawFrame) String() string       { return base64.StdEncoding.EncodeToString(*f) }
func (f *testRawFrame) ProtoMessage()        {}
func (f *testRawFrame) Bytes() []byte        { return []byte(*f) }

type testRawCodec struct{}

func (testRawCodec) Name() string { return "proto" }
func (testRawCodec) Marshal(v any) ([]byte, error) {
	switch x := v.(type) {
	case *testRawFrame:
		return x.Bytes(), nil
	case testRawFrame:
		return []byte(x), nil
	case proto.Message:
		return proto.Marshal(x)
	default:
		return nil, nil
	}
}
func (testRawCodec) Unmarshal(data []byte, v any) error {
	switch x := v.(type) {
	case *testRawFrame:
		*x = append((*x)[:0], data...)
		return nil
	case proto.Message:
		return proto.Unmarshal(data, x)
	default:
		return nil
	}
}

var _ encoding.Codec = testRawCodec{}
