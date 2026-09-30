package protocol

import (
	"bytes"
	"connectrpc.com/connect"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/labstack/echo/v5"
	v3 "github.com/pb33f/libopenapi/datamodel/high/v3"

	"octobus/internal/accesslog"
	"octobus/internal/descriptors"
	"octobus/internal/domain"
	"octobus/internal/store"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
)

type memoryAccessLogger struct {
	mu      sync.Mutex
	records []accesslog.Record
	err     error
}

func TestBackendUnaryTimeout(t *testing.T) {
	tests := []struct {
		name  string
		value string
		want  time.Duration
	}{
		{name: "default", value: "", want: 30 * time.Second},
		{name: "override", value: " 2m ", want: 2 * time.Minute},
		{name: "malformed", value: "not-a-duration", want: 30 * time.Second},
		{name: "zero", value: "0s", want: 30 * time.Second},
		{name: "negative", value: "-1s", want: 30 * time.Second},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("OCTOBUS_BACKEND_UNARY_TIMEOUT", test.value)
			if got := backendUnaryTimeout(); got != test.want {
				t.Fatalf("backendUnaryTimeout() = %v, want %v", got, test.want)
			}
		})
	}
}

func (l *memoryAccessLogger) Append(record accesslog.Record) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.err != nil {
		return l.err
	}
	l.records = append(l.records, record)
	return nil
}

func (l *memoryAccessLogger) Records() []accesslog.Record {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]accesslog.Record(nil), l.records...)
}

func assertAccessRecord(t *testing.T, logger *memoryAccessLogger, want accesslog.Record) {
	t.Helper()
	for _, got := range logger.Records() {
		if want.Protocol != "" && got.Protocol != want.Protocol {
			continue
		}
		if want.Capset != "" && got.Capset != want.Capset {
			continue
		}
		if want.Service != "" && got.Service != want.Service {
			continue
		}
		if want.Instance != "" && got.Instance != want.Instance {
			continue
		}
		if want.Method != "" && got.Method != want.Method {
			continue
		}
		if want.Tool != "" && got.Tool != want.Tool {
			continue
		}
		if want.Route != "" && got.Route != want.Route {
			continue
		}
		if want.HTTPMethod != "" && got.HTTPMethod != want.HTTPMethod {
			continue
		}
		if want.HTTPStatus != 0 && got.HTTPStatus != want.HTTPStatus {
			continue
		}
		if want.GRPCCode != "" && got.GRPCCode != want.GRPCCode {
			continue
		}
		if want.RemoteAddr != "" && got.RemoteAddr != want.RemoteAddr {
			continue
		}
		if want.UserAgent != "" && got.UserAgent != want.UserAgent {
			continue
		}
		if got.DurationMS < 0 {
			t.Fatalf("negative duration record=%+v", got)
		}
		return
	}
	t.Fatalf("missing access record %+v in %+v", want, logger.Records())
}

func TestProtocolDaemonLogsFailuresOnlyAndAccessLogWriteFailure(t *testing.T) {
	var out bytes.Buffer
	accessLogger := &memoryAccessLogger{}
	gateway := &Gateway{AccessLogger: accessLogger, Logger: slog.New(slog.NewTextHandler(&out, &slog.HandlerOptions{Level: slog.LevelInfo}))}
	start := time.Now()
	okRecord := accesslog.Record{
		Protocol:   "connect",
		Capset:     "dev",
		Service:    "echo",
		Instance:   "echo-test",
		Method:     "echo.v1.EchoService/Echo",
		Route:      "/capsets/dev/connect/echo-test/echo.v1.EchoService/Echo",
		HTTPMethod: http.MethodPost,
	}
	gateway.finishHTTPAccessLog(start, okRecord, http.StatusOK)
	if got := out.String(); got != "" {
		t.Fatalf("successful protocol request wrote daemon log:\n%s", got)
	}

	failed := okRecord
	failed.Method = "echo.v1.EchoService/Missing"
	failed.GRPCCode = codes.NotFound.String()
	gateway.finishHTTPAccessLog(start, failed, http.StatusNotFound)
	got := out.String()
	for _, want := range []string{
		"level=WARN msg=protocol_request_failed",
		"protocol=connect",
		"capset=dev",
		"service=echo",
		"instance=echo-test",
		"method=echo.v1.EchoService/Missing",
		"route=/capsets/dev/connect/echo-test/echo.v1.EchoService/Echo",
		"http_status=404",
		"grpc_code=NotFound",
		"duration_ms=",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("protocol failure log missing %q in:\n%s", want, got)
		}
	}
	for _, forbidden := range []string{"Authorization", "Bearer", "request_body", "response_body", "business_metadata"} {
		if strings.Contains(got, forbidden) {
			t.Fatalf("protocol failure log leaked %q in:\n%s", forbidden, got)
		}
	}

	out.Reset()
	internal := okRecord
	internal.GRPCCode = codes.Internal.String()
	gateway.finishHTTPAccessLog(start, internal, http.StatusInternalServerError)
	if got := out.String(); !strings.Contains(got, "level=ERROR msg=protocol_request_failed") || !strings.Contains(got, "grpc_code=Internal") {
		t.Fatalf("internal protocol failure log mismatch:\n%s", got)
	}

	out.Reset()
	accessLogger.err = errors.New("disk full")
	gateway.finishHTTPAccessLog(start, okRecord, http.StatusOK)
	if got := out.String(); !strings.Contains(got, "level=ERROR msg=access_log_write_failed") || !strings.Contains(got, "disk full") {
		t.Fatalf("access log write failure log mismatch:\n%s", got)
	}
}

func TestCatalogConnectMCPAndGRPCProxy(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	compiled := compileFixture(t, dataDir)
	files, err := protodesc.NewFiles(compiled.Files)
	if err != nil {
		t.Fatal(err)
	}
	reqAny, err := files.FindDescriptorByName("echo.v1.EchoRequest")
	if err != nil {
		t.Fatal(err)
	}
	respAny, err := files.FindDescriptorByName("echo.v1.EchoResponse")
	if err != nil {
		t.Fatal(err)
	}
	reqDesc := reqAny.(protoreflect.MessageDescriptor)
	respDesc := respAny.(protoreflect.MessageDescriptor)
	backendAddr, stopBackend := startRawBackend(t, reqDesc, respDesc)
	defer stopBackend()

	service := domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: filepath.Join(dataDir, "descriptor.protoset"), DescriptorSHA256: compiled.DescriptorSHA256, DescriptorVersion: compiled.DescriptorVersion, NodeEntry: "echo", Methods: compiled.Methods}
	if err := st.UpsertService(ctx, service); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: true, Status: domain.StatusRunning, ListenAddr: backendAddr, NodeEntry: "echo", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:echo-test", CapsetID: "dev", ServiceID: "echo", InstanceID: "echo-test", IncludeAllMethods: true, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-test", MethodFullName: "echo.v1.EchoService/Echo", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	gateway := &Gateway{Store: st}

	cat, err := gateway.CatalogWithOptions(ctx, "dev", CatalogOptions{IncludeGRPC: true, IncludeMCP: true, IncludeConnect: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(cat.GRPC) != 1 || len(cat.MCP) != 1 || len(cat.ConnectRPC) != 1 {
		t.Fatalf("unexpected catalog sections: %+v", cat)
	}
	if cat.GRPC[0].MethodPath != "/echo.v1.EchoService/Echo" || cat.ConnectRPC[0].Endpoint != "/capsets/dev/connect/echo-test/echo.v1.EchoService/Echo" || cat.ConnectRPC[0].OpenAPIURL != "/capsets/dev/openapi.json" || cat.MCP[0].ToolName != "echo__echo-test__echo" {
		t.Fatalf("unexpected catalog: %+v", cat)
	}
	wantGRPCMetadata := map[string]string{"x-octobus-capset": "dev", "x-octobus-instance": "echo-test"}
	if !reflect.DeepEqual(cat.GRPC[0].Metadata, wantGRPCMetadata) {
		t.Fatalf("grpc metadata=%+v want %+v", cat.GRPC[0].Metadata, wantGRPCMetadata)
	}
	md := RenderCatalogMarkdown(cat)
	for _, want := range []string{
		"## Schema Discovery",
		"use server reflection with `x-octobus-capset=dev` metadata",
		"call `tools/list` on the table `Endpoint`",
		"POST JSON to the table `Endpoint` path",
		"| Method | Metadata | Request | Response |",
		"| Endpoint | Tool | Method | Request | Response |",
		"| Endpoint | OpenAPI | Procedure | Request | Response |",
		"`/echo.v1.EchoService/Echo`",
		"`echo__echo-test__echo`",
	} {
		if !bytes.Contains(md, []byte(want)) {
			t.Fatalf("catalog markdown missing %q:\n%s", want, md)
		}
	}
	for _, old := range []string{"Content Types", "Descriptor", "Backend", "Runtime"} {
		if bytes.Contains(md, []byte(old)) {
			t.Fatalf("catalog markdown still contains old column %q:\n%s", old, md)
		}
	}

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, cat.ConnectRPC[0].Endpoint, bytes.NewBufferString(`{"text":"hi","unknown":true}`))
	req.Header.Set("Content-Type", "application/json")
	gateway.HandleConnectRPC(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("strict Connect status = %d body=%s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, cat.ConnectRPC[0].Endpoint, bytes.NewBufferString(`{"text":"hi"}`))
	req.Header.Set("Content-Type", "application/json")
	gateway.HandleConnectRPC(w, req)
	if w.Code != http.StatusOK || !bytes.Contains(w.Body.Bytes(), []byte(`"echoed":"hi"`)) {
		t.Fatalf("Connect response status=%d body=%s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/c/dev/i/echo-test/echo.v1.EchoService/Echo", bytes.NewBufferString(`{"text":"old"}`))
	req.Header.Set("Content-Type", "application/json")
	gateway.HandleConnectRPC(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("old short Connect route status=%d body=%s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/capsets/dev/services/echo/instances/echo-test/connect/echo.v1.EchoService/Echo", bytes.NewBufferString(`{"text":"old"}`))
	req.Header.Set("Content-Type", "application/json")
	gateway.HandleConnectRPC(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("old full Connect route status=%d body=%s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, cat.ConnectRPC[0].Endpoint, bytes.NewReader(bytes.Repeat([]byte("x"), int(DefaultMaxRequestBytes)+1)))
	req.Header.Set("Content-Type", "application/json")
	gateway.HandleConnectRPC(w, req)
	if w.Code != http.StatusTooManyRequests || !bytes.Contains(w.Body.Bytes(), []byte("resource_exhausted")) {
		t.Fatalf("oversized Connect response status=%d body=%s", w.Code, w.Body.String())
	}
	if _, err := st.AddCapsetToken(ctx, domain.CapsetToken{ID: "key-one", CapsetID: "dev"}, "secret-one"); err != nil {
		t.Fatal(err)
	}
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, cat.ConnectRPC[0].Endpoint, bytes.NewBufferString(`{"text":"locked"}`))
	req.Header.Set("Content-Type", "application/json")
	gateway.HandleConnectRPC(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("Connect without token status=%d body=%s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, cat.ConnectRPC[0].Endpoint, bytes.NewBufferString(`{"text":"bad"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer wrong")
	gateway.HandleConnectRPC(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("Connect wrong token status=%d body=%s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, cat.ConnectRPC[0].Endpoint, bytes.NewBufferString(`{"text":"authorized"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer secret-one")
	gateway.HandleConnectRPC(w, req)
	if w.Code != http.StatusOK || !bytes.Contains(w.Body.Bytes(), []byte(`"echoed":"authorized"`)) {
		t.Fatalf("Connect valid token status=%d body=%s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/capsets/dev/openapi.json", nil)
	gateway.Handler().ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("OpenAPI without token status=%d body=%s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/capsets/dev/openapi.json", nil)
	req.Header.Set("Authorization", "Bearer secret-one")
	gateway.Handler().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("OpenAPI valid token status=%d body=%s", w.Code, w.Body.String())
	}
	if err := st.DeleteCapsetToken(ctx, "dev", "key-one"); err != nil {
		t.Fatal(err)
	}

	client := connect.NewClient[dynamicpb.Message, dynamicpb.Message](
		&http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			rec := httptest.NewRecorder()
			gateway.HandleConnectRPC(rec, req)
			return rec.Result(), nil
		})},
		"http://octobus.test"+cat.ConnectRPC[0].Endpoint,
		connect.WithCodec(&dynamicProtoJSONCodec{desc: respDesc}),
	)
	connectReq := dynamicpb.NewMessage(reqDesc)
	connectReq.Set(reqDesc.Fields().ByName("text"), protoreflect.ValueOfString("client"))
	connectResp, err := client.CallUnary(ctx, connect.NewRequest(connectReq))
	if err != nil {
		t.Fatal(err)
	}
	if got := connectResp.Msg.Get(respDesc.Fields().ByName("echoed")).String(); got != "client" {
		t.Fatalf("Connect client response=%q", got)
	}

	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/capsets/dev/mcp", bytes.NewBufferString(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`))
	gateway.HandleMCP(w, req)
	if w.Code != http.StatusOK || !bytes.Contains(w.Body.Bytes(), []byte(`echo__echo-test__echo`)) {
		t.Fatalf("MCP tools/list body=%s", w.Body.String())
	}
	var mcpList struct {
		Result struct {
			Tools []struct {
				InputSchema map[string]any `json:"inputSchema"`
			} `json:"tools"`
		} `json:"result"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &mcpList); err != nil {
		t.Fatal(err)
	}
	if len(mcpList.Result.Tools) != 1 {
		t.Fatalf("unexpected MCP tools/list body=%s", w.Body.String())
	}
	assertSchemaProperty(t, mcpList.Result.Tools[0].InputSchema, "text", "string")
	assertSchemaProperty(t, mcpList.Result.Tools[0].InputSchema, "count", "integer")
	assertSchemaProperty(t, mcpList.Result.Tools[0].InputSchema, "active", "boolean")
	assertSchemaProperty(t, mcpList.Result.Tools[0].InputSchema, "tags", "array")
	assertSchemaProperty(t, mcpList.Result.Tools[0].InputSchema, "labels", "object")
	assertSchemaProperty(t, mcpList.Result.Tools[0].InputSchema, "mode", "string")

	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/capsets/dev/mcp", bytes.NewBufferString(`{"jsonrpc":"2.0","id":10,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"codex","version":"test"},"capabilities":{}}}`))
	gateway.HandleMCP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("MCP initialize status=%d body=%s", w.Code, w.Body.String())
	}
	var initResp struct {
		Result struct {
			ProtocolVersion string `json:"protocolVersion"`
			ServerInfo      struct {
				Name string `json:"name"`
			} `json:"serverInfo"`
			Capabilities struct {
				Tools map[string]any `json:"tools"`
			} `json:"capabilities"`
		} `json:"result"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &initResp); err != nil {
		t.Fatal(err)
	}
	if initResp.Result.ProtocolVersion == "" || initResp.Result.ServerInfo.Name != "octobus" || initResp.Result.Capabilities.Tools == nil {
		t.Fatalf("unexpected MCP initialize body=%s", w.Body.String())
	}

	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/capsets/dev/mcp", bytes.NewBufferString(`{"jsonrpc":"2.0","method":"notifications/initialized"}`))
	gateway.HandleMCP(w, req)
	if w.Code != http.StatusAccepted || w.Body.Len() != 0 {
		t.Fatalf("MCP initialized notification status=%d body=%s", w.Code, w.Body.String())
	}

	for _, tc := range []struct {
		method string
		key    string
	}{
		{method: "ping"},
		{method: "resources/list", key: "resources"},
		{method: "resources/templates/list", key: "resourceTemplates"},
		{method: "prompts/list", key: "prompts"},
	} {
		t.Run("MCP "+tc.method, func(t *testing.T) {
			w := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/capsets/dev/mcp", bytes.NewBufferString(fmt.Sprintf(`{"jsonrpc":"2.0","id":11,"method":%q}`, tc.method)))
			gateway.HandleMCP(w, req)
			if w.Code != http.StatusOK {
				t.Fatalf("MCP %s status=%d body=%s", tc.method, w.Code, w.Body.String())
			}
			var resp struct {
				Result map[string]any `json:"result"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
				t.Fatal(err)
			}
			if resp.Result == nil {
				t.Fatalf("MCP %s missing result body=%s", tc.method, w.Body.String())
			}
			if tc.key != "" {
				items, ok := resp.Result[tc.key].([]any)
				if !ok || len(items) != 0 {
					t.Fatalf("MCP %s result[%s]=%#v, want empty list", tc.method, tc.key, resp.Result[tc.key])
				}
			}
		})
	}

	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/capsets/dev/mcp", bytes.NewBufferString(`{"jsonrpc":"2.0","method":"notifications/cancelled"}`))
	gateway.HandleMCP(w, req)
	if w.Code != http.StatusAccepted || w.Body.Len() != 0 {
		t.Fatalf("MCP notification status=%d body=%s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/capsets/dev/mcp", bytes.NewBufferString(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"echo__echo-test__echo","arguments":{"text":"yo"}}}`))
	gateway.HandleMCP(w, req)
	if w.Code != http.StatusOK || !bytes.Contains(w.Body.Bytes(), []byte(`"echoed":"yo"`)) {
		t.Fatalf("MCP tools/call body=%s", w.Body.String())
	}
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/capsets/dev/mcp", bytes.NewReader(bytes.Repeat([]byte("x"), int(DefaultMaxRequestBytes)+1)))
	gateway.HandleMCP(w, req)
	if w.Code != http.StatusRequestEntityTooLarge || !bytes.Contains(w.Body.Bytes(), []byte("request body too large")) {
		t.Fatalf("oversized MCP response status=%d body=%s", w.Code, w.Body.String())
	}
	if _, err := st.AddCapsetToken(ctx, domain.CapsetToken{ID: "key-one", CapsetID: "dev"}, "secret-one"); err != nil {
		t.Fatal(err)
	}
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/capsets/dev/mcp", bytes.NewBufferString(`{"jsonrpc":"2.0","id":3,"method":"tools/list"}`))
	gateway.HandleMCP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("MCP without token status=%d body=%s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/capsets/dev/mcp", bytes.NewBufferString(`{"jsonrpc":"2.0","id":4,"method":"tools/list"}`))
	req.Header.Set("Authorization", "Bearer secret-one")
	gateway.HandleMCP(w, req)
	if w.Code != http.StatusOK || !bytes.Contains(w.Body.Bytes(), []byte(`echo__echo-test__echo`)) {
		t.Fatalf("MCP valid token status=%d body=%s", w.Code, w.Body.String())
	}

	reqMsg := dynamicpb.NewMessage(reqDesc)
	_ = protojson.Unmarshal([]byte(`{"text":"grpc"}`), reqMsg)
	reqRaw, _ := proto.Marshal(reqMsg)
	if _, err := gateway.UnaryProxy(ctx, "/echo.v1.EchoService/Echo", reqRaw); status.Code(err) != codes.InvalidArgument || !strings.Contains(err.Error(), "x-octobus-capset and x-octobus-instance metadata are required") {
		t.Fatalf("missing metadata err=%v", err)
	}
	grpcCtx := metadata.NewIncomingContext(ctx, metadata.Pairs("x-octobus-capset", "dev", "x-octobus-instance", "echo-test"))
	if _, err := gateway.UnaryProxy(grpcCtx, "/echo.v1.EchoService/Echo", reqRaw); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("gRPC missing token code=%v err=%v", status.Code(err), err)
	}
	badGRPCCtx := metadata.NewIncomingContext(ctx, metadata.Pairs("x-octobus-capset", "dev", "x-octobus-instance", "echo-test", "authorization", "Bearer wrong"))
	if _, err := gateway.UnaryProxy(badGRPCCtx, "/echo.v1.EchoService/Echo", reqRaw); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("gRPC wrong token code=%v err=%v", status.Code(err), err)
	}
	grpcCtx = metadata.NewIncomingContext(ctx, metadata.Pairs("x-octobus-capset", "dev", "x-octobus-instance", "echo-test", "authorization", "Bearer secret-one"))
	respRaw, err := gateway.UnaryProxy(grpcCtx, "/echo.v1.EchoService/Echo", reqRaw)
	if err != nil {
		t.Fatal(err)
	}
	compatCtx := metadata.NewIncomingContext(ctx, metadata.Pairs("x-octobus-capset", "dev", "x-octobus-instance", "echo-test", "x-octobus-service", "wrong-or-old-value", "authorization", "Bearer secret-one"))
	if _, err := gateway.UnaryProxy(compatCtx, "/echo.v1.EchoService/Echo", reqRaw); err != nil {
		t.Fatalf("deprecated x-octobus-service should be ignored: %v", err)
	}
	respMsg := dynamicpb.NewMessage(respDesc)
	if err := proto.Unmarshal(respRaw, respMsg); err != nil {
		t.Fatal(err)
	}
	respJSON, _ := protojson.Marshal(respMsg)
	if !bytes.Contains(respJSON, []byte(`"echoed":"grpc"`)) {
		t.Fatalf("gRPC proxy response = %s", respJSON)
	}
}

func TestConnectRPCForwardsAllowedBusinessHeaders(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	compiled := compileFixture(t, dataDir)
	files, err := protodesc.NewFiles(compiled.Files)
	if err != nil {
		t.Fatal(err)
	}
	reqAny, err := files.FindDescriptorByName("echo.v1.EchoRequest")
	if err != nil {
		t.Fatal(err)
	}
	respAny, err := files.FindDescriptorByName("echo.v1.EchoResponse")
	if err != nil {
		t.Fatal(err)
	}
	reqDesc := reqAny.(protoreflect.MessageDescriptor)
	respDesc := respAny.(protoreflect.MessageDescriptor)
	backendAddr, stopBackend, captured := startMetadataRawBackend(t, reqDesc, respDesc)
	defer stopBackend()

	service := domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: filepath.Join(dataDir, "descriptor.protoset"), DescriptorSHA256: compiled.DescriptorSHA256, DescriptorVersion: compiled.DescriptorVersion, NodeEntry: "echo", Methods: compiled.Methods}
	if err := st.UpsertService(ctx, service); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: true, Status: domain.StatusRunning, ListenAddr: backendAddr, NodeEntry: "echo", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:echo-test", CapsetID: "dev", ServiceID: "echo", InstanceID: "echo-test", IncludeAllMethods: true, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-test", MethodFullName: "echo.v1.EchoService/Echo", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	gateway := &Gateway{Store: st}

	req := httptest.NewRequest(http.MethodPost, "/capsets/dev/connect/echo-test/echo.v1.EchoService/Echo", bytes.NewBufferString(`{"text":"metadata"}`))
	req.Host = "gateway.test"
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer frontend-secret")
	req.Header.Set("Connection", "close")
	req.Header.Set("X-Business-Request-Id", "req-1")
	req.Header.Set("X-Octobus-Ext-Username", "alice")
	req.Header.Set("X-Octobus-Capset", "wrong")
	req.Header.Set("X-Octobus-Instance", "wrong")
	w := httptest.NewRecorder()
	gateway.HandleConnectRPC(w, req)
	if w.Code != http.StatusOK || !bytes.Contains(w.Body.Bytes(), []byte(`"echoed":"metadata"`)) {
		t.Fatalf("Connect response status=%d body=%s", w.Code, w.Body.String())
	}

	var md metadata.MD
	select {
	case md = <-captured:
	case <-time.After(2 * time.Second):
		t.Fatal("backend did not capture metadata")
	}
	if got := md.Get("x-business-request-id"); len(got) != 1 || got[0] != "req-1" {
		t.Fatalf("business request id metadata=%v", md)
	}
	if got := md.Get("x-octobus-ext-username"); len(got) != 1 || got[0] != "alice" {
		t.Fatalf("octobus extension metadata=%v", md)
	}
	for _, forbidden := range []string{"authorization", "connection", "x-octobus-capset", "x-octobus-instance"} {
		if got := md.Get(forbidden); len(got) != 0 {
			t.Fatalf("forbidden metadata %s=%v in %v", forbidden, got, md)
		}
	}
	for _, leakedValue := range []string{"frontend-secret", "application/json", "close", "gateway.test", "wrong"} {
		for key, vals := range md {
			for _, val := range vals {
				if strings.Contains(val, leakedValue) {
					t.Fatalf("frontend header value %q leaked via %s=%v in %v", leakedValue, key, vals, md)
				}
			}
		}
	}
}

func TestAccessLogRecordsProtocolEntrypoints(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	compiled := compileFixture(t, dataDir)
	files, err := protodesc.NewFiles(compiled.Files)
	if err != nil {
		t.Fatal(err)
	}
	reqAny, err := files.FindDescriptorByName("echo.v1.EchoRequest")
	if err != nil {
		t.Fatal(err)
	}
	respAny, err := files.FindDescriptorByName("echo.v1.EchoResponse")
	if err != nil {
		t.Fatal(err)
	}
	reqDesc := reqAny.(protoreflect.MessageDescriptor)
	respDesc := respAny.(protoreflect.MessageDescriptor)
	backendAddr, stopBackend := startRawBackend(t, reqDesc, respDesc)
	defer stopBackend()

	service := domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: filepath.Join(dataDir, "descriptor.protoset"), DescriptorSHA256: compiled.DescriptorSHA256, DescriptorVersion: compiled.DescriptorVersion, NodeEntry: "echo", Methods: compiled.Methods}
	if err := st.UpsertService(ctx, service); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: true, Status: domain.StatusRunning, ListenAddr: backendAddr, NodeEntry: "echo", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:echo-test", CapsetID: "dev", ServiceID: "echo", InstanceID: "echo-test", IncludeAllMethods: true, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-test", MethodFullName: "echo.v1.EchoService/Echo", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	logger := &memoryAccessLogger{}
	gateway := &Gateway{Store: st, DataDir: dataDir, AccessLogger: logger}
	cat, err := gateway.CatalogWithOptions(ctx, "dev", CatalogOptions{IncludeGRPC: true, IncludeMCP: true, IncludeConnect: true})
	if err != nil {
		t.Fatal(err)
	}

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, cat.ConnectRPC[0].Endpoint, bytes.NewBufferString(`{"text":"connect"}`))
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = "127.0.0.1:10001"
	req.Header.Set("User-Agent", "connect-test")
	gateway.HandleConnectRPC(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("Connect status=%d body=%s", w.Code, w.Body.String())
	}
	assertAccessRecord(t, logger, accesslog.Record{
		Protocol:   "connect",
		Capset:     "dev",
		Service:    "echo",
		Instance:   "echo-test",
		Method:     "echo.v1.EchoService/Echo",
		Route:      cat.ConnectRPC[0].Endpoint,
		HTTPMethod: http.MethodPost,
		HTTPStatus: http.StatusOK,
		GRPCCode:   codes.OK.String(),
		RemoteAddr: "127.0.0.1:10001",
		UserAgent:  "connect-test",
	})

	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/capsets/dev/connect/echo-test/echo.v1.EchoService/Missing", bytes.NewBufferString(`{}`))
	req.Header.Set("Content-Type", "application/json")
	gateway.HandleConnectRPC(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("Connect missing status=%d body=%s", w.Code, w.Body.String())
	}
	assertAccessRecord(t, logger, accesslog.Record{
		Protocol:   "connect",
		Capset:     "dev",
		Instance:   "echo-test",
		Method:     "echo.v1.EchoService/Missing",
		Route:      "/capsets/dev/connect/echo-test/echo.v1.EchoService/Missing",
		HTTPMethod: http.MethodPost,
		HTTPStatus: http.StatusNotFound,
		GRPCCode:   codes.NotFound.String(),
	})

	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/capsets/dev/mcp", bytes.NewBufferString(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`))
	gateway.HandleMCP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("MCP tools/list status=%d body=%s", w.Code, w.Body.String())
	}
	assertAccessRecord(t, logger, accesslog.Record{
		Protocol:   "mcp",
		Capset:     "dev",
		Method:     "tools/list",
		Route:      "/capsets/dev/mcp",
		HTTPMethod: http.MethodPost,
		HTTPStatus: http.StatusOK,
		GRPCCode:   codes.OK.String(),
	})

	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/capsets/dev/mcp", bytes.NewBufferString(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"echo__echo-test__echo","arguments":{"text":"mcp"}}}`))
	gateway.HandleMCP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("MCP tools/call status=%d body=%s", w.Code, w.Body.String())
	}
	assertAccessRecord(t, logger, accesslog.Record{
		Protocol:   "mcp",
		Capset:     "dev",
		Service:    "echo",
		Instance:   "echo-test",
		Method:     "echo.v1.EchoService/Echo",
		Tool:       "echo__echo-test__echo",
		Route:      "/capsets/dev/mcp",
		HTTPMethod: http.MethodPost,
		HTTPStatus: http.StatusOK,
		GRPCCode:   codes.OK.String(),
	})

	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/capsets/dev/mcp", bytes.NewBufferString(`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"missing","arguments":{}}}`))
	gateway.HandleMCP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("MCP missing tool status=%d body=%s", w.Code, w.Body.String())
	}
	assertAccessRecord(t, logger, accesslog.Record{
		Protocol:   "mcp",
		Capset:     "dev",
		Method:     "tools/call",
		Tool:       "missing",
		Route:      "/capsets/dev/mcp",
		HTTPMethod: http.MethodPost,
		HTTPStatus: http.StatusOK,
		GRPCCode:   codes.NotFound.String(),
	})

	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/capsets/dev/openapi.json", nil)
	gateway.Handler().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("OpenAPI status=%d body=%s", w.Code, w.Body.String())
	}
	assertAccessRecord(t, logger, accesslog.Record{
		Protocol:   "openapi",
		Capset:     "dev",
		Route:      "/capsets/dev/openapi.json",
		HTTPMethod: http.MethodGet,
		HTTPStatus: http.StatusOK,
		GRPCCode:   codes.OK.String(),
	})

	frontAddr, stopFront := startGatewayGRPC(t, gateway)
	defer stopFront()
	conn, err := grpc.NewClient(frontAddr, grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithDefaultCallOptions(grpc.ForceCodec(rawCodec{})))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	frontCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs("x-octobus-capset", "dev", "x-octobus-instance", "echo-test"))
	out := newRawFrame(nil)
	if err := conn.Invoke(frontCtx, "/echo.v1.EchoService/Echo", echoRawFrame(t, reqDesc, "grpc", 0), out); err != nil {
		t.Fatal(err)
	}
	assertAccessRecord(t, logger, accesslog.Record{
		Protocol: "grpc",
		Capset:   "dev",
		Service:  "echo",
		Instance: "echo-test",
		Method:   "echo.v1.EchoService/Echo",
		Route:    "/echo.v1.EchoService/Echo",
		GRPCCode: codes.OK.String(),
	})
}

func TestGRPCProxyStreamingMethods(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	compiled := compileFixture(t, dataDir)
	files, err := protodesc.NewFiles(compiled.Files)
	if err != nil {
		t.Fatal(err)
	}
	reqAny, err := files.FindDescriptorByName("echo.v1.EchoRequest")
	if err != nil {
		t.Fatal(err)
	}
	respAny, err := files.FindDescriptorByName("echo.v1.EchoResponse")
	if err != nil {
		t.Fatal(err)
	}
	reqDesc := reqAny.(protoreflect.MessageDescriptor)
	respDesc := respAny.(protoreflect.MessageDescriptor)
	backendAddr, stopBackend := startStreamingRawBackend(t, reqDesc, respDesc)
	defer stopBackend()

	service := domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: filepath.Join(dataDir, "descriptor.protoset"), DescriptorSHA256: compiled.DescriptorSHA256, DescriptorVersion: compiled.DescriptorVersion, NodeEntry: "echo", Methods: compiled.Methods}
	if err := st.UpsertService(ctx, service); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: true, Status: domain.StatusRunning, ListenAddr: backendAddr, NodeEntry: "echo", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:echo-test", CapsetID: "dev", ServiceID: "echo", InstanceID: "echo-test", IncludeAllMethods: true, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{"echo.v1.EchoService/Echo", "echo.v1.EchoService/ServerStream", "echo.v1.EchoService/ClientStream", "echo.v1.EchoService/BidiStream", "echo.v1.EchoService/FailStream"} {
		if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-test", MethodFullName: method, Enabled: true}); err != nil {
			t.Fatal(err)
		}
	}
	gateway := &Gateway{Store: st}
	grpcCtx := metadata.NewIncomingContext(ctx, metadata.Pairs(
		"x-octobus-capset", "dev",
		"x-octobus-instance", "echo-test",
		"x-business-request-id", "req-1",
		"x-octobus-ext-username", "alice",
	))

	stream, err := gateway.newBackendStream(grpcCtx, mustFindExposed(t, st, "ServerStream"))
	if err != nil {
		t.Fatal(err)
	}
	if err := stream.SendMsg(echoRawFrame(t, reqDesc, "server", 2)); err != nil {
		t.Fatal(err)
	}
	if err := stream.CloseSend(); err != nil {
		t.Fatal(err)
	}
	if got := recvEchoTexts(t, stream, respDesc); !equalStrings(got, []string{"server-1", "server-2"}) {
		t.Fatalf("server stream responses=%v", got)
	}

	stream, err = gateway.newBackendStream(grpcCtx, mustFindExposed(t, st, "ClientStream"))
	if err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"a", "b"} {
		if err := stream.SendMsg(echoRawFrame(t, reqDesc, text, 0)); err != nil {
			t.Fatal(err)
		}
	}
	if err := stream.CloseSend(); err != nil {
		t.Fatal(err)
	}
	resp := newRawFrame(nil)
	if err := stream.RecvMsg(resp); err != nil {
		t.Fatal(err)
	}
	if got := echoText(t, respDesc, resp.Bytes()); got != "a,b" {
		t.Fatalf("client stream response=%q", got)
	}

	stream, err = gateway.newBackendStream(grpcCtx, mustFindExposed(t, st, "BidiStream"))
	if err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"x", "y"} {
		if err := stream.SendMsg(echoRawFrame(t, reqDesc, text, 0)); err != nil {
			t.Fatal(err)
		}
		resp := newRawFrame(nil)
		if err := stream.RecvMsg(resp); err != nil {
			t.Fatal(err)
		}
		if got := echoText(t, respDesc, resp.Bytes()); got != "bidi:"+text {
			t.Fatalf("bidi response=%q", got)
		}
	}
	if err := stream.CloseSend(); err != nil {
		t.Fatal(err)
	}

	stream, err = gateway.newBackendStream(grpcCtx, mustFindExposed(t, st, "FailStream"))
	if err != nil {
		t.Fatal(err)
	}
	if err := stream.SendMsg(echoRawFrame(t, reqDesc, "fail", 0)); err != nil {
		t.Fatal(err)
	}
	if err := stream.CloseSend(); err != nil {
		t.Fatal(err)
	}
	err = stream.RecvMsg(newRawFrame(nil))
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("backend error code=%v err=%v", status.Code(err), err)
	}

	frontAddr, stopFront := startGatewayGRPC(t, gateway)
	defer stopFront()
	conn, err := grpc.NewClient(frontAddr, grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithDefaultCallOptions(grpc.ForceCodec(rawCodec{})))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	frontCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs(
		"x-octobus-capset", "dev",
		"x-octobus-instance", "echo-test",
		"x-business-request-id", "req-1",
	))
	out := newRawFrame(nil)
	if err := conn.Invoke(frontCtx, "/echo.v1.EchoService/Echo", echoRawFrame(t, reqDesc, "front", 0), out); err != nil {
		t.Fatal(err)
	}
	if got := echoText(t, respDesc, out.Bytes()); got != "front" {
		t.Fatalf("front unary response=%q", got)
	}
	frontServer, err := conn.NewStream(frontCtx, &grpc.StreamDesc{StreamName: "ServerStream", ServerStreams: true}, "/echo.v1.EchoService/ServerStream")
	if err != nil {
		t.Fatal(err)
	}
	if err := frontServer.SendMsg(echoRawFrame(t, reqDesc, "front-server", 2)); err != nil {
		t.Fatal(err)
	}
	if err := frontServer.CloseSend(); err != nil {
		t.Fatal(err)
	}
	if got := recvEchoTexts(t, frontServer, respDesc); !equalStrings(got, []string{"front-server-1", "front-server-2"}) {
		t.Fatalf("front server stream responses=%v", got)
	}
	frontClient, err := conn.NewStream(frontCtx, &grpc.StreamDesc{StreamName: "ClientStream", ClientStreams: true}, "/echo.v1.EchoService/ClientStream")
	if err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"front-a", "front-b"} {
		if err := frontClient.SendMsg(echoRawFrame(t, reqDesc, text, 0)); err != nil {
			t.Fatal(err)
		}
	}
	if err := frontClient.CloseSend(); err != nil {
		t.Fatal(err)
	}
	out = newRawFrame(nil)
	if err := frontClient.RecvMsg(out); err != nil {
		t.Fatal(err)
	}
	if got := echoText(t, respDesc, out.Bytes()); got != "front-a,front-b" {
		t.Fatalf("front client stream response=%q", got)
	}
	if err := frontClient.RecvMsg(newRawFrame(nil)); !errors.Is(err, io.EOF) {
		t.Fatalf("front client extra recv err=%v", err)
	}
	frontBidi, err := conn.NewStream(frontCtx, &grpc.StreamDesc{StreamName: "BidiStream", ClientStreams: true, ServerStreams: true}, "/echo.v1.EchoService/BidiStream")
	if err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"front-x", "front-y"} {
		if err := frontBidi.SendMsg(echoRawFrame(t, reqDesc, text, 0)); err != nil {
			t.Fatal(err)
		}
		out := newRawFrame(nil)
		if err := frontBidi.RecvMsg(out); err != nil {
			t.Fatal(err)
		}
		if got := echoText(t, respDesc, out.Bytes()); got != "bidi:"+text {
			t.Fatalf("front bidi response=%q", got)
		}
	}
	if err := frontBidi.CloseSend(); err != nil {
		t.Fatal(err)
	}
	if err := frontBidi.RecvMsg(newRawFrame(nil)); !errors.Is(err, io.EOF) {
		t.Fatalf("front bidi final recv err=%v", err)
	}
}

func TestGatewayOnDemandInvokeSuccessAndIsolatedMetadata(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is unix-only")
	}
	ctx := context.Background()
	dataDir := t.TempDir()
	st, item, reqRaw, respDesc := seedOnDemandGateway(t, dataDir)
	defer st.Close()
	item.Service.ServiceRoot = "services/echo"
	writeOnDemandEntry(t, dataDir, "echo", item.Service.ServiceRoot, `#!/bin/sh
set -eu
if [ "$1" != "--runtime" ] || [ "$2" != "invoke" ]; then
  echo "missing runtime prefix: $*" >&2
  exit 2
fi
metadata=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--metadata" ]; then metadata="$2"; break; fi
  shift
done
cp "$metadata" "$OCTOBUS_PACKAGE_DIR/metadata-$OCTOBUS_INSTANCE_ID-$$.json"
cat
`)
	gateway := &Gateway{Store: st, DataDir: dataDir}

	grpcCtx := metadata.NewIncomingContext(ctx, metadata.Pairs(
		"x-octobus-capset", "dev",
		"x-octobus-instance", "echo-test",
		"x-business-request-id", "req-1",
	))
	respRaw, err := gateway.invokeRaw(grpcCtx, item, reqRaw)
	if err != nil {
		t.Fatal(err)
	}
	resp := dynamicpb.NewMessage(respDesc)
	if err := proto.Unmarshal(respRaw, resp); err != nil {
		t.Fatal(err)
	}
	if got := resp.Get(respDesc.Fields().ByName("echoed")).String(); got != "on-demand" {
		t.Fatalf("response echoed=%q", got)
	}
	matches, err := filepath.Glob(filepath.Join(dataDir, "artifacts/services/echo/runtime/services/echo/metadata-echo-test-*.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 1 {
		t.Fatalf("metadata files=%v", matches)
	}
	raw, err := os.ReadFile(matches[0])
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("x-octobus-capset")) || !bytes.Contains(raw, []byte("x-business-request-id")) {
		t.Fatalf("metadata not stripped/preserved: %s", raw)
	}
	if len(gateway.conns) != 0 {
		t.Fatalf("on-demand invoke populated backend connection cache: %+v", gateway.conns)
	}
}

func TestGatewayOnDemandConcurrentRequestsUseIndependentMetadataFiles(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is unix-only")
	}
	ctx := context.Background()
	dataDir := t.TempDir()
	st, item, reqRaw, _ := seedOnDemandGateway(t, dataDir)
	defer st.Close()
	writeOnDemandEntry(t, dataDir, "echo", item.Service.ServiceRoot, `#!/bin/sh
set -eu
metadata=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--metadata" ]; then metadata="$2"; break; fi
  shift
done
dir=$(dirname "$metadata")
base=$(basename "$dir")
dest="$OCTOBUS_PACKAGE_DIR/metadata-$base.json"
cp "$metadata" "$dest"
cat
`)
	gateway := &Gateway{Store: st, DataDir: dataDir}
	errs := make(chan error, 2)
	for _, reqID := range []string{"req-a", "req-b"} {
		reqID := reqID
		go func() {
			grpcCtx := metadata.NewIncomingContext(ctx, metadata.Pairs(
				"x-octobus-capset", "dev",
				"x-octobus-instance", "echo-test",
				"x-business-request-id", reqID,
			))
			_, err := gateway.invokeRaw(grpcCtx, item, reqRaw)
			errs <- err
		}()
	}
	for i := 0; i < 2; i++ {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}
	matches, err := filepath.Glob(filepath.Join(dataDir, "artifacts/services/echo/runtime/metadata-invoke-*.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 2 {
		t.Fatalf("metadata files=%v", matches)
	}
	seen := map[string]bool{}
	for _, match := range matches {
		raw, err := os.ReadFile(match)
		if err != nil {
			t.Fatal(err)
		}
		if bytes.Contains(raw, []byte("req-a")) {
			seen["req-a"] = true
		}
		if bytes.Contains(raw, []byte("req-b")) {
			seen["req-b"] = true
		}
	}
	if !seen["req-a"] || !seen["req-b"] {
		t.Fatalf("metadata files did not preserve independent request ids: %+v", seen)
	}
}

func TestGatewayOnDemandErrorMapping(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is unix-only")
	}
	ctx := context.Background()
	dataDir := t.TempDir()
	st, item, reqRaw, _ := seedOnDemandGateway(t, dataDir)
	defer st.Close()
	gateway := &Gateway{Store: st, DataDir: dataDir}
	grpcCtx := metadata.NewIncomingContext(ctx, metadata.Pairs("x-octobus-capset", "dev", "x-octobus-instance", "echo-test"))

	writeOnDemandEntry(t, dataDir, "echo", item.Service.ServiceRoot, `#!/bin/sh
echo 'OCTOBUS_ERROR:{"code":"PERMISSION_DENIED","message":"fixture denied"}' >&2
exit 7
`)
	if _, err := gateway.invokeRaw(grpcCtx, item, reqRaw); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("OCTOBUS_ERROR code=%v err=%v", status.Code(err), err)
	}

	writeOnDemandEntry(t, dataDir, "echo", item.Service.ServiceRoot, `#!/bin/sh
echo plain failure >&2
exit 8
`)
	if _, err := gateway.invokeRaw(grpcCtx, item, reqRaw); status.Code(err) != codes.Internal {
		t.Fatalf("plain failure code=%v err=%v", status.Code(err), err)
	}

	writeOnDemandEntry(t, dataDir, "echo", item.Service.ServiceRoot, `#!/bin/sh
echo 'not protobuf'
`)
	if _, err := gateway.invokeRaw(grpcCtx, item, reqRaw); status.Code(err) != codes.Internal {
		t.Fatalf("invalid protobuf response code=%v err=%v", status.Code(err), err)
	}

	writeOnDemandEntry(t, dataDir, "echo", item.Service.ServiceRoot, `#!/bin/sh
echo 'OCTOBUS_ERROR:{"code":"INVALID_ARGUMENT","message":"bad"}' >&2
echo 'trailing log' >&2
exit 9
`)
	if _, err := gateway.invokeRaw(grpcCtx, item, reqRaw); status.Code(err) != codes.Internal {
		t.Fatalf("trailing stderr after OCTOBUS_ERROR code=%v err=%v", status.Code(err), err)
	}

	writeOnDemandEntry(t, dataDir, "echo", item.Service.ServiceRoot, `#!/bin/sh
echo 'OCTOBUS_ERROR:{"code":"PERMISSION_DENIED","message":"fixture denied"}' >&2
echo 'program not built with -cover' >&2
exit 9
`)
	if _, err := gateway.invokeRaw(grpcCtx, item, reqRaw); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("coverage runtime stderr after OCTOBUS_ERROR code=%v err=%v", status.Code(err), err)
	}

	writeOnDemandEntry(t, dataDir, "echo", item.Service.ServiceRoot, `#!/bin/sh
echo 'OCTOBUS_ERROR:{"code":"PERMISSION_DENIED","message":"fixture denied"}' >&2
echo 'warning: GOCOVERDIR not set, no coverage data emitted' >&2
exit 9
`)
	if _, err := gateway.invokeRaw(grpcCtx, item, reqRaw); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("missing GOCOVERDIR warning after OCTOBUS_ERROR code=%v err=%v", status.Code(err), err)
	}

	writeOnDemandEntry(t, dataDir, "echo", item.Service.ServiceRoot, `#!/bin/sh
echo 'OCTOBUS_ERROR:not-json' >&2
exit 10
`)
	if _, err := gateway.invokeRaw(grpcCtx, item, reqRaw); status.Code(err) != codes.Internal {
		t.Fatalf("malformed OCTOBUS_ERROR code=%v err=%v", status.Code(err), err)
	}

	writeOnDemandEntry(t, dataDir, "echo", item.Service.ServiceRoot, `#!/bin/sh
echo 'OCTOBUS_ERROR:{"code":"NOT_A_CODE","message":"bad"}' >&2
exit 11
`)
	if _, err := gateway.invokeRaw(grpcCtx, item, reqRaw); status.Code(err) != codes.Internal {
		t.Fatalf("unknown OCTOBUS_ERROR code=%v err=%v", status.Code(err), err)
	}
}

func TestGatewayOnDemandRuntimeFailures(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is unix-only")
	}
	ctx := context.Background()
	dataDir := t.TempDir()
	st, item, reqRaw, _ := seedOnDemandGateway(t, dataDir)
	defer st.Close()
	grpcCtx := metadata.NewIncomingContext(ctx, metadata.Pairs("x-octobus-capset", "dev", "x-octobus-instance", "echo-test"))

	if _, err := (&Gateway{Store: st}).invokeRaw(grpcCtx, item, reqRaw); status.Code(err) != codes.Internal {
		t.Fatalf("missing DataDir code=%v err=%v", status.Code(err), err)
	}

	if _, err := (&Gateway{Store: st, DataDir: dataDir}).invokeRaw(grpcCtx, item, reqRaw); status.Code(err) != codes.Internal {
		t.Fatalf("missing entry code=%v err=%v", status.Code(err), err)
	}

	writeOnDemandEntry(t, dataDir, "echo", item.Service.ServiceRoot, `#!/bin/sh
sleep 2
cat
`)
	timeoutCtx, cancel := context.WithTimeout(grpcCtx, 20*time.Millisecond)
	defer cancel()
	if _, err := (&Gateway{Store: st, DataDir: dataDir}).invokeRaw(timeoutCtx, item, reqRaw); status.Code(err) != codes.DeadlineExceeded {
		t.Fatalf("timeout code=%v err=%v", status.Code(err), err)
	}
}

func TestCatalogDefaultsEmptyAndMarkdownOpenAPI(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.CreateCapset(ctx, domain.Capset{ID: "empty", Name: "Empty", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	gateway := &Gateway{Store: st}
	cat, err := gateway.Catalog(ctx, "empty")
	if err != nil {
		t.Fatal(err)
	}
	if len(cat.GRPC) != 0 || cat.MCP == nil || cat.ConnectRPC == nil {
		t.Fatalf("empty catalog should have stable empty arrays: %+v", cat)
	}
	md := RenderCatalogMarkdown(cat)
	if !bytes.Contains(md, []byte("## Schema Discovery")) || !bytes.Contains(md, []byte("## gRPC")) || bytes.Contains(md, []byte("## MCP")) || bytes.Contains(md, []byte("## Connect RPC")) {
		t.Fatalf("default markdown sections wrong:\n%s", md)
	}
	if !bytes.Contains(md, []byte("server reflection with `x-octobus-capset=empty` metadata")) {
		t.Fatalf("default markdown missing gRPC schema discovery:\n%s", md)
	}
	raw, err := gateway.OpenAPI(ctx, "empty", "json")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(raw, []byte(`"openapi"`)) || !bytes.Contains(raw, []byte(`"paths": {}`)) {
		t.Fatalf("empty openapi json=%s", raw)
	}
	w := httptest.NewRecorder()
	gateway.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/capsets/empty/openapi.json", nil))
	if w.Code != http.StatusOK || !bytes.Contains(w.Body.Bytes(), []byte(`"openapi"`)) {
		t.Fatalf("agent OpenAPI status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestCatalogMarksMissingDescriptorAsDegraded(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	compiled := compileFixture(t, dataDir)
	descriptorPath := filepath.Join(dataDir, "descriptor.protoset")
	if err := os.Remove(descriptorPath); err != nil {
		t.Fatal(err)
	}
	service := domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: descriptorPath, DescriptorSHA256: compiled.DescriptorSHA256, DescriptorVersion: compiled.DescriptorVersion, NodeEntry: "echo", Methods: compiled.Methods}
	if err := st.UpsertService(ctx, service); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: true, Status: domain.StatusRunning, ListenAddr: "127.0.0.1:1", NodeEntry: "echo", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:echo-test", CapsetID: "dev", ServiceID: "echo", InstanceID: "echo-test", IncludeAllMethods: true, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-test", MethodFullName: "echo.v1.EchoService/Echo", Enabled: true}); err != nil {
		t.Fatal(err)
	}

	cat, err := (&Gateway{Store: st}).CatalogWithOptions(ctx, "dev", CatalogOptions{IncludeGRPC: true, IncludeMCP: true, IncludeConnect: true})
	if err != nil {
		t.Fatal(err)
	}
	if got := cat.GRPC[0].BackendInstanceStatus; got != string(domain.StatusDegraded) {
		t.Fatalf("grpc backend status=%q, want degraded", got)
	}
	if got := cat.MCP[0].BackendInstanceStatus; got != string(domain.StatusDegraded) {
		t.Fatalf("mcp backend status=%q, want degraded", got)
	}
	if got := cat.ConnectRPC[0].BackendInstanceStatus; got != string(domain.StatusDegraded) {
		t.Fatalf("connect backend status=%q, want degraded", got)
	}
}

func TestGatewayReusesBackendConnection(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	compiled := compileFixture(t, dataDir)
	files, err := protodesc.NewFiles(compiled.Files)
	if err != nil {
		t.Fatal(err)
	}
	reqAny, err := files.FindDescriptorByName("echo.v1.EchoRequest")
	if err != nil {
		t.Fatal(err)
	}
	respAny, err := files.FindDescriptorByName("echo.v1.EchoResponse")
	if err != nil {
		t.Fatal(err)
	}
	reqDesc := reqAny.(protoreflect.MessageDescriptor)
	respDesc := respAny.(protoreflect.MessageDescriptor)
	backendAddr, stopBackend, accepted := startCountingRawBackend(t, reqDesc, respDesc)
	defer stopBackend()

	service := domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: filepath.Join(dataDir, "descriptor.protoset"), DescriptorSHA256: compiled.DescriptorSHA256, DescriptorVersion: compiled.DescriptorVersion, NodeEntry: "echo", Methods: compiled.Methods}
	if err := st.UpsertService(ctx, service); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: true, Status: domain.StatusRunning, ListenAddr: backendAddr, NodeEntry: "echo", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:echo-test", CapsetID: "dev", ServiceID: "echo", InstanceID: "echo-test", IncludeAllMethods: true, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-test", MethodFullName: "echo.v1.EchoService/Echo", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	gateway := &Gateway{Store: st}
	defer gateway.Close()

	reqMsg := dynamicpb.NewMessage(reqDesc)
	_ = protojson.Unmarshal([]byte(`{"text":"grpc"}`), reqMsg)
	reqRaw, _ := proto.Marshal(reqMsg)
	grpcCtx := metadata.NewIncomingContext(ctx, metadata.Pairs("x-octobus-capset", "dev", "x-octobus-instance", "echo-test"))
	for i := 0; i < 3; i++ {
		if _, err := gateway.UnaryProxy(grpcCtx, "/echo.v1.EchoService/Echo", reqRaw); err != nil {
			t.Fatal(err)
		}
	}
	if got := accepted.Load(); got != 1 {
		t.Fatalf("accepted backend connections=%d, want 1", got)
	}
}

func TestGatewayReplacesConnectionWhenBackendAddressChanges(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	compiled := compileFixture(t, dataDir)
	files, err := protodesc.NewFiles(compiled.Files)
	if err != nil {
		t.Fatal(err)
	}
	reqAny, err := files.FindDescriptorByName("echo.v1.EchoRequest")
	if err != nil {
		t.Fatal(err)
	}
	respAny, err := files.FindDescriptorByName("echo.v1.EchoResponse")
	if err != nil {
		t.Fatal(err)
	}
	reqDesc := reqAny.(protoreflect.MessageDescriptor)
	respDesc := respAny.(protoreflect.MessageDescriptor)
	firstAddr, stopFirst, firstAccepted := startCountingRawBackend(t, reqDesc, respDesc)
	defer stopFirst()
	secondAddr, stopSecond, secondAccepted := startCountingRawBackend(t, reqDesc, respDesc)
	defer stopSecond()

	service := domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: filepath.Join(dataDir, "descriptor.protoset"), DescriptorSHA256: compiled.DescriptorSHA256, DescriptorVersion: compiled.DescriptorVersion, NodeEntry: "echo", Methods: compiled.Methods}
	if err := st.UpsertService(ctx, service); err != nil {
		t.Fatal(err)
	}
	inst := domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: true, Status: domain.StatusRunning, ListenAddr: firstAddr, NodeEntry: "echo", ConfigJSON: []byte(`{}`)}
	if err := st.UpsertInstance(ctx, inst); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:echo-test", CapsetID: "dev", ServiceID: "echo", InstanceID: "echo-test", IncludeAllMethods: true, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-test", MethodFullName: "echo.v1.EchoService/Echo", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	gateway := &Gateway{Store: st}
	defer gateway.Close()

	reqMsg := dynamicpb.NewMessage(reqDesc)
	_ = protojson.Unmarshal([]byte(`{"text":"grpc"}`), reqMsg)
	reqRaw, _ := proto.Marshal(reqMsg)
	grpcCtx := metadata.NewIncomingContext(ctx, metadata.Pairs("x-octobus-capset", "dev", "x-octobus-instance", "echo-test"))
	if _, err := gateway.UnaryProxy(grpcCtx, "/echo.v1.EchoService/Echo", reqRaw); err != nil {
		t.Fatal(err)
	}
	inst.ListenAddr = secondAddr
	if err := st.UpsertInstance(ctx, inst); err != nil {
		t.Fatal(err)
	}
	if _, err := gateway.UnaryProxy(grpcCtx, "/echo.v1.EchoService/Echo", reqRaw); err != nil {
		t.Fatal(err)
	}
	if got := firstAccepted.Load(); got != 1 {
		t.Fatalf("first backend accepted connections=%d, want 1", got)
	}
	if got := secondAccepted.Load(); got != 1 {
		t.Fatalf("second backend accepted connections=%d, want 1", got)
	}
}

func TestMCPToolsCacheCopiesAndInvalidatesOnExposureChange(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	compiled := compileFixture(t, dataDir)
	service := domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: filepath.Join(dataDir, "descriptor.protoset"), DescriptorSHA256: compiled.DescriptorSHA256, DescriptorVersion: compiled.DescriptorVersion, NodeEntry: "echo", Methods: compiled.Methods}
	if err := st.UpsertService(ctx, service); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: true, Status: domain.StatusRunning, ListenAddr: "127.0.0.1:1", NodeEntry: "echo", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:echo-test", CapsetID: "dev", ServiceID: "echo", InstanceID: "echo-test", IncludeAllMethods: true, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-test", MethodFullName: "echo.v1.EchoService/Echo", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	gateway := &Gateway{Store: st}

	tools, err := gateway.mcpTools(ctx, "dev")
	if err != nil {
		t.Fatal(err)
	}
	if len(tools) != 1 {
		t.Fatalf("tools len=%d, want 1", len(tools))
	}
	tools[0]["name"] = "mutated"
	schema := tools[0]["inputSchema"].(map[string]any)
	delete(schema["properties"].(map[string]any), "text")

	cached, err := gateway.mcpTools(ctx, "dev")
	if err != nil {
		t.Fatal(err)
	}
	if cached[0]["name"] != "echo__echo-test__echo" {
		t.Fatalf("cached tool name=%v", cached[0]["name"])
	}
	assertSchemaProperty(t, cached[0]["inputSchema"].(map[string]any), "text", "string")

	if err := st.DeleteCapsetMethod(ctx, "dev", "echo-test", "echo.v1.EchoService/Echo"); err != nil {
		t.Fatal(err)
	}
	if _, err := gateway.mcpTools(ctx, "dev"); err == nil {
		t.Fatal("mcpTools after deleting the only method returned nil error")
	}
	if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-test", MethodFullName: "echo.v1.EchoService/Echo", MCPToolName: "custom_echo", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	updated, err := gateway.mcpTools(ctx, "dev")
	if err != nil {
		t.Fatal(err)
	}
	if len(updated) != 1 || updated[0]["name"] != "custom_echo" {
		t.Fatalf("updated tools=%+v", updated)
	}
}

func TestMCPToolsIncludeProtoComments(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	compiled := compileFixture(t, dataDir)
	service := domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: filepath.Join(dataDir, "descriptor.protoset"), DescriptorSHA256: compiled.DescriptorSHA256, DescriptorVersion: compiled.DescriptorVersion, NodeEntry: "echo", Methods: compiled.Methods}
	if err := st.UpsertService(ctx, service); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: true, Status: domain.StatusRunning, ListenAddr: "127.0.0.1:1", NodeEntry: "echo", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:echo-test", CapsetID: "dev", ServiceID: "echo", InstanceID: "echo-test", IncludeAllMethods: true, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-test", MethodFullName: "echo.v1.EchoService/Echo", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-test", MethodFullName: "echo.v1.EchoService/NoComment", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	tools, err := (&Gateway{Store: st}).mcpTools(ctx, "dev")
	if err != nil {
		t.Fatal(err)
	}
	if len(tools) != 2 {
		t.Fatalf("tools len=%d, want 2", len(tools))
	}
	commentedTool := findToolByDescription(t, tools, "Echoes text for callers.")
	if got := commentedTool["description"]; got != "Echoes text for callers." {
		t.Fatalf("tool description=%q", got)
	}
	schema := commentedTool["inputSchema"].(map[string]any)
	if got := schema["description"]; got != "Request payload for echo." {
		t.Fatalf("schema description=%q", got)
	}
	assertSchemaPropertyDescription(t, schema, "text", "Text to echo.")
	assertSchemaPropertyDescription(t, schema, "child", "Nested request details.\n\nNested request metadata.")
	assertSchemaPropertyDescription(t, schema, "children", "Repeated child details.")
	assertSchemaPropertyDescription(t, schema, "child_by_name", "Child details by name.")
	assertNestedSchemaPropertyDescription(t, schemaProperty(t, schema, "child"), "name", "Child display name.")
	assertNestedSchemaPropertyDescription(t, schemaItems(t, schemaProperty(t, schema, "children")), "name", "Child display name.")
	assertNestedSchemaPropertyDescription(t, schemaAdditionalProperties(t, schemaProperty(t, schema, "child_by_name")), "name", "Child display name.")
	assertOneOfPropertyDescription(t, schema, "email", "Email destination.")
	assertOneOfPropertyDescription(t, schema, "phone", "Phone destination.")
	findToolByDescription(t, tools, "echo.v1.EchoService/NoComment")
}

func compileFixture(t *testing.T, dataDir string) descriptors.CompileResult {
	t.Helper()
	protoDir := filepath.Join(dataDir, "pkg/proto")
	if err := os.MkdirAll(protoDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(protoDir, "echo.proto"), []byte(`syntax = "proto3";
package echo.v1;
service EchoService {
  // Echoes text for callers.
  rpc Echo(EchoRequest) returns (EchoResponse);
  rpc NoComment(EchoRequest) returns (EchoResponse);
  rpc ServerStream(EchoRequest) returns (stream EchoResponse);
  rpc ClientStream(stream EchoRequest) returns (EchoResponse);
  rpc BidiStream(stream EchoRequest) returns (stream EchoResponse);
  rpc FailStream(EchoRequest) returns (stream EchoResponse);
}

// Request payload for echo.
message EchoRequest {
  // Text to echo.
  string text = 1;
  int32 count = 2;
  bool active = 3;
  repeated string tags = 4;
  map<string, int32> labels = 5;
  Mode mode = 6;
  // Nested request details.
  ChildRequest child = 7;
  // Repeated child details.
  repeated ChildRequest children = 8;
  // Child details by name.
  map<string, ChildRequest> child_by_name = 9;
  oneof destination {
    // Email destination.
    string email = 10;
    // Phone destination.
    string phone = 11;
  }
}
enum Mode {
  MODE_UNSPECIFIED = 0;
  MODE_FAST = 1;
}
// Nested request metadata.
message ChildRequest {
  // Child display name.
  string name = 1;
}
message EchoResponse { string echoed = 1; }
`), 0o644); err != nil {
		t.Fatal(err)
	}
	res, err := descriptors.Compile(descriptors.CompileRequest{PackageDir: filepath.Join(dataDir, "pkg"), ProtoRoots: []string{"proto"}, ProtoFiles: []string{"proto/echo.proto"}, DescriptorPath: filepath.Join(dataDir, "descriptor.protoset")})
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func seedOnDemandGateway(t *testing.T, dataDir string) (*store.Store, store.ExposedMethod, []byte, protoreflect.MessageDescriptor) {
	t.Helper()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	compiled := compileFixture(t, dataDir)
	files, err := protodesc.NewFiles(compiled.Files)
	if err != nil {
		t.Fatal(err)
	}
	reqAny, err := files.FindDescriptorByName("echo.v1.EchoRequest")
	if err != nil {
		t.Fatal(err)
	}
	respAny, err := files.FindDescriptorByName("echo.v1.EchoResponse")
	if err != nil {
		t.Fatal(err)
	}
	reqDesc := reqAny.(protoreflect.MessageDescriptor)
	respDesc := respAny.(protoreflect.MessageDescriptor)
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: filepath.Join(dataDir, "descriptor.protoset"), DescriptorSHA256: compiled.DescriptorSHA256, DescriptorVersion: compiled.DescriptorVersion, NodeEntry: "invoke-entry", RuntimeMode: domain.RuntimeModeOnDemand, Methods: compiled.Methods}); err != nil {
		t.Fatal(err)
	}
	workdir := filepath.Join(dataDir, "instances/echo-test")
	if err := os.MkdirAll(workdir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workdir, "config.json"), []byte(`{}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: true, Status: domain.StatusRunning, NodeEntry: "invoke-entry", ConfigJSON: []byte(`{}`), SecretJSON: []byte(`{"apiToken":"db-secret"}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:echo-test", CapsetID: "dev", ServiceID: "echo", InstanceID: "echo-test", IncludeAllMethods: true, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-test", MethodFullName: "echo.v1.EchoService/Echo", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	item, err := st.FindExposedMethod(ctx, "dev", "echo", "echo-test", "echo.v1.EchoService/Echo")
	if err != nil {
		t.Fatal(err)
	}
	req := dynamicpb.NewMessage(reqDesc)
	req.Set(reqDesc.Fields().ByName("text"), protoreflect.ValueOfString("on-demand"))
	reqRaw, err := proto.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	return st, item, reqRaw, respDesc
}

func writeOnDemandEntry(t *testing.T, dataDir, serviceID, serviceRoot, script string) {
	t.Helper()
	runtimeDir := filepath.Join(dataDir, "artifacts/services", serviceID, "runtime")
	if err := os.MkdirAll(runtimeDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if serviceRoot != "" && serviceRoot != "." {
		if err := os.MkdirAll(filepath.Join(runtimeDir, filepath.FromSlash(serviceRoot)), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	entry := filepath.Join(runtimeDir, "invoke-entry")
	if err := os.WriteFile(entry, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
}

func assertSchemaProperty(t *testing.T, schema map[string]any, name, wantType string) {
	t.Helper()
	property := schemaProperty(t, schema, name)
	if gotType := property["type"]; gotType != wantType {
		t.Fatalf("schema property %q type=%v want %s", name, gotType, wantType)
	}
}

func assertSchemaPropertyDescription(t *testing.T, schema map[string]any, name, wantDescription string) {
	t.Helper()
	property := schemaProperty(t, schema, name)
	if gotDescription := property["description"]; gotDescription != wantDescription {
		t.Fatalf("schema property %q description=%q want %q", name, gotDescription, wantDescription)
	}
}

func assertNestedSchemaPropertyDescription(t *testing.T, schema map[string]any, name, wantDescription string) {
	t.Helper()
	property := schemaProperty(t, schema, name)
	if gotDescription := property["description"]; gotDescription != wantDescription {
		t.Fatalf("nested schema property %q description=%q want %q", name, gotDescription, wantDescription)
	}
}

func assertOneOfPropertyDescription(t *testing.T, schema map[string]any, name, wantDescription string) {
	t.Helper()
	for _, group := range schemaAnyOf(t, schema) {
		for _, branch := range schemaOneOf(t, group) {
			props, ok := branch["properties"].(map[string]any)
			if !ok {
				t.Fatalf("oneof branch properties missing: %+v", branch)
			}
			rawProperty, ok := props[name]
			if !ok {
				continue
			}
			property, ok := rawProperty.(map[string]any)
			if !ok {
				t.Fatalf("oneof property %q has unexpected shape: %+v", name, rawProperty)
			}
			if gotDescription := property["description"]; gotDescription != wantDescription {
				t.Fatalf("oneof property %q description=%q want %q", name, gotDescription, wantDescription)
			}
			return
		}
	}
	t.Fatalf("oneof property %q missing in schema: %+v", name, schema)
}

func findToolByDescription(t *testing.T, tools []map[string]any, description string) map[string]any {
	t.Helper()
	for _, tool := range tools {
		if tool["description"] == description {
			return tool
		}
	}
	t.Fatalf("tool with description %q missing: %+v", description, tools)
	return nil
}

func schemaProperty(t *testing.T, schema map[string]any, name string) map[string]any {
	t.Helper()
	properties, ok := schema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("schema properties missing: %+v", schema)
	}
	rawProperty, ok := properties[name]
	if !ok {
		t.Fatalf("schema property %q missing: %+v", name, properties)
	}
	property, ok := rawProperty.(map[string]any)
	if !ok {
		t.Fatalf("schema property %q has unexpected shape: %+v", name, rawProperty)
	}
	return property
}

func schemaItems(t *testing.T, schema map[string]any) map[string]any {
	t.Helper()
	items, ok := schema["items"].(map[string]any)
	if !ok {
		t.Fatalf("schema items missing: %+v", schema)
	}
	return items
}

func schemaAdditionalProperties(t *testing.T, schema map[string]any) map[string]any {
	t.Helper()
	additionalProperties, ok := schema["additionalProperties"].(map[string]any)
	if !ok {
		t.Fatalf("schema additionalProperties missing: %+v", schema)
	}
	return additionalProperties
}

func schemaAnyOf(t *testing.T, schema map[string]any) []map[string]any {
	t.Helper()
	anyOf, ok := schema["anyOf"].([]map[string]any)
	if !ok {
		t.Fatalf("schema anyOf missing: %+v", schema)
	}
	return anyOf
}

func schemaOneOf(t *testing.T, schema map[string]any) []map[string]any {
	t.Helper()
	oneOf, ok := schema["oneOf"].([]map[string]any)
	if !ok {
		t.Fatalf("schema oneOf missing: %+v", schema)
	}
	return oneOf
}

func startRawBackend(t *testing.T, reqDesc, respDesc protoreflect.MessageDescriptor) (string, func()) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := grpc.NewServer(grpc.ForceServerCodec(rawCodec{}), grpc.UnknownServiceHandler(func(_ any, stream grpc.ServerStream) error {
		reqFrame := newRawFrame(nil)
		if err := stream.RecvMsg(reqFrame); err != nil {
			return err
		}
		req := dynamicpb.NewMessage(reqDesc)
		if err := proto.Unmarshal(reqFrame.Bytes(), req); err != nil {
			return err
		}
		text := req.Get(req.Descriptor().Fields().ByName("text")).String()
		resp := dynamicpb.NewMessage(respDesc)
		resp.Set(resp.Descriptor().Fields().ByName("echoed"), protoreflect.ValueOfString(text))
		respRaw, _ := proto.Marshal(resp)
		return stream.SendMsg(newRawFrame(respRaw))
	}))
	go srv.Serve(ln)
	return ln.Addr().String(), srv.Stop
}

func startMetadataRawBackend(t *testing.T, reqDesc, respDesc protoreflect.MessageDescriptor) (string, func(), <-chan metadata.MD) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	captured := make(chan metadata.MD, 1)
	srv := grpc.NewServer(grpc.ForceServerCodec(rawCodec{}), grpc.UnknownServiceHandler(func(_ any, stream grpc.ServerStream) error {
		if md, ok := metadata.FromIncomingContext(stream.Context()); ok {
			select {
			case captured <- md.Copy():
			default:
			}
		}
		reqFrame := newRawFrame(nil)
		if err := stream.RecvMsg(reqFrame); err != nil {
			return err
		}
		req := dynamicpb.NewMessage(reqDesc)
		if err := proto.Unmarshal(reqFrame.Bytes(), req); err != nil {
			return err
		}
		text := req.Get(req.Descriptor().Fields().ByName("text")).String()
		resp := dynamicpb.NewMessage(respDesc)
		resp.Set(resp.Descriptor().Fields().ByName("echoed"), protoreflect.ValueOfString(text))
		respRaw, _ := proto.Marshal(resp)
		return stream.SendMsg(newRawFrame(respRaw))
	}))
	go srv.Serve(ln)
	return ln.Addr().String(), srv.Stop, captured
}

func startCountingRawBackend(t *testing.T, reqDesc, respDesc protoreflect.MessageDescriptor) (string, func(), *atomic.Int64) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	counting := &countingListener{Listener: ln}
	srv := grpc.NewServer(grpc.ForceServerCodec(rawCodec{}), grpc.UnknownServiceHandler(func(_ any, stream grpc.ServerStream) error {
		reqFrame := newRawFrame(nil)
		if err := stream.RecvMsg(reqFrame); err != nil {
			return err
		}
		req := dynamicpb.NewMessage(reqDesc)
		if err := proto.Unmarshal(reqFrame.Bytes(), req); err != nil {
			return err
		}
		text := req.Get(req.Descriptor().Fields().ByName("text")).String()
		resp := dynamicpb.NewMessage(respDesc)
		resp.Set(resp.Descriptor().Fields().ByName("echoed"), protoreflect.ValueOfString(text))
		respRaw, _ := proto.Marshal(resp)
		return stream.SendMsg(newRawFrame(respRaw))
	}))
	go srv.Serve(counting)
	return ln.Addr().String(), srv.Stop, &counting.accepted
}

func startStreamingRawBackend(t *testing.T, reqDesc, respDesc protoreflect.MessageDescriptor) (string, func()) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := grpc.NewServer(grpc.ForceServerCodec(rawCodec{}), grpc.UnknownServiceHandler(func(_ any, stream grpc.ServerStream) error {
		method, _ := grpc.MethodFromServerStream(stream)
		switch strings.TrimPrefix(method, "/") {
		case "echo.v1.EchoService/Echo":
			reqFrame := newRawFrame(nil)
			if err := stream.RecvMsg(reqFrame); err != nil {
				return err
			}
			return stream.SendMsg(echoRespRawFrame(t, respDesc, echoText(t, reqDesc, reqFrame.Bytes())))
		case "echo.v1.EchoService/ServerStream":
			reqFrame := newRawFrame(nil)
			if err := stream.RecvMsg(reqFrame); err != nil {
				return err
			}
			text := echoText(t, reqDesc, reqFrame.Bytes())
			count := echoCount(t, reqDesc, reqFrame.Bytes())
			for i := int32(1); i <= count; i++ {
				if err := stream.SendMsg(echoRespRawFrame(t, respDesc, fmt.Sprintf("%s-%d", text, i))); err != nil {
					return err
				}
			}
			return nil
		case "echo.v1.EchoService/ClientStream":
			var texts []string
			for {
				reqFrame := newRawFrame(nil)
				err := stream.RecvMsg(reqFrame)
				if errors.Is(err, io.EOF) {
					return stream.SendMsg(echoRespRawFrame(t, respDesc, strings.Join(texts, ",")))
				}
				if err != nil {
					return err
				}
				texts = append(texts, echoText(t, reqDesc, reqFrame.Bytes()))
			}
		case "echo.v1.EchoService/BidiStream":
			for {
				reqFrame := newRawFrame(nil)
				err := stream.RecvMsg(reqFrame)
				if errors.Is(err, io.EOF) {
					return nil
				}
				if err != nil {
					return err
				}
				if err := stream.SendMsg(echoRespRawFrame(t, respDesc, "bidi:"+echoText(t, reqDesc, reqFrame.Bytes()))); err != nil {
					return err
				}
			}
		case "echo.v1.EchoService/FailStream":
			return status.Error(codes.PermissionDenied, "stream denied")
		default:
			return status.Error(codes.Unimplemented, "unknown method")
		}
	}))
	go srv.Serve(ln)
	return ln.Addr().String(), srv.Stop
}

func startGatewayGRPC(t *testing.T, gateway *Gateway) (string, func()) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := GRPCServer(gateway)
	go srv.Serve(ln)
	return ln.Addr().String(), srv.Stop
}

func mustFindExposed(t *testing.T, st *store.Store, methodName string) store.ExposedMethod {
	t.Helper()
	item, err := st.FindExposedMethod(context.Background(), "dev", "echo", "echo-test", "echo.v1.EchoService/"+methodName)
	if err != nil {
		t.Fatal(err)
	}
	return item
}

func echoRawFrame(t *testing.T, desc protoreflect.MessageDescriptor, text string, count int32) *rawFrame {
	t.Helper()
	msg := dynamicpb.NewMessage(desc)
	msg.Set(desc.Fields().ByName("text"), protoreflect.ValueOfString(text))
	if field := desc.Fields().ByName("count"); field != nil {
		msg.Set(field, protoreflect.ValueOfInt32(count))
	}
	raw, err := proto.Marshal(msg)
	if err != nil {
		t.Fatal(err)
	}
	return newRawFrame(raw)
}

func echoRespRawFrame(t *testing.T, desc protoreflect.MessageDescriptor, text string) *rawFrame {
	t.Helper()
	msg := dynamicpb.NewMessage(desc)
	field := desc.Fields().ByName("echoed")
	if field == nil {
		field = desc.Fields().ByName("text")
	}
	msg.Set(field, protoreflect.ValueOfString(text))
	raw, err := proto.Marshal(msg)
	if err != nil {
		t.Fatal(err)
	}
	return newRawFrame(raw)
}

func echoText(t *testing.T, desc protoreflect.MessageDescriptor, raw []byte) string {
	t.Helper()
	msg := dynamicpb.NewMessage(desc)
	if err := proto.Unmarshal(raw, msg); err != nil {
		t.Fatal(err)
	}
	field := desc.Fields().ByName("text")
	if field == nil {
		field = desc.Fields().ByName("echoed")
	}
	return msg.Get(field).String()
}

func echoCount(t *testing.T, desc protoreflect.MessageDescriptor, raw []byte) int32 {
	t.Helper()
	msg := dynamicpb.NewMessage(desc)
	if err := proto.Unmarshal(raw, msg); err != nil {
		t.Fatal(err)
	}
	field := desc.Fields().ByName("count")
	if field == nil {
		return 0
	}
	return int32(msg.Get(field).Int())
}

func recvEchoTexts(t *testing.T, stream grpc.ClientStream, desc protoreflect.MessageDescriptor) []string {
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
		out = append(out, echoText(t, desc, resp.Bytes()))
	}
}

func equalStrings(left, right []string) bool {
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

func TestGatewayHandlerAndOpenAPIBoundaries(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	gateway := &Gateway{Store: st}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/missing", nil)
	gateway.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound || !bytes.Contains(rec.Body.Bytes(), []byte("not found")) {
		t.Fatalf("unknown route status=%d body=%s", rec.Code, rec.Body.String())
	}

	if _, err := gateway.OpenAPI(ctx, "dev", "xml"); err == nil || !strings.Contains(err.Error(), "unsupported OpenAPI format") {
		t.Fatalf("expected unsupported format error, got %v", err)
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/capsets/dev/openapi.yaml", nil)
	gateway.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "application/yaml" || !bytes.Contains(rec.Body.Bytes(), []byte("openapi:")) {
		t.Fatalf("openapi yaml status=%d type=%q body=%s", rec.Code, rec.Header().Get("Content-Type"), rec.Body.String())
	}

	if err := st.UpsertCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: false}); err != nil {
		t.Fatal(err)
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/capsets/dev/openapi.json", nil)
	gateway.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("disabled capset openapi status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestGatewayOpenAPIForExposedConnectMethods(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	compiled := compileFixture(t, dataDir)
	service := domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: filepath.Join(dataDir, "descriptor.protoset"), DescriptorSHA256: compiled.DescriptorSHA256, DescriptorVersion: compiled.DescriptorVersion, NodeEntry: "echo", Methods: compiled.Methods}
	if err := st.UpsertService(ctx, service); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: true, Status: domain.StatusRunning, ListenAddr: "127.0.0.1:1", NodeEntry: "echo", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Description: "connect docs", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:echo-test", CapsetID: "dev", ServiceID: "echo", InstanceID: "echo-test", IncludeAllMethods: true, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{"echo.v1.EchoService/Echo", "echo.v1.EchoService/NoComment"} {
		if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-test", MethodFullName: method, Enabled: true}); err != nil {
			t.Fatal(err)
		}
	}

	gateway := &Gateway{Store: st}
	raw, err := gateway.OpenAPI(ctx, "dev", "json")
	if err != nil {
		t.Fatal(err)
	}
	body := string(raw)
	for _, want := range []string{
		`"/capsets/dev/connect/echo-test/echo.v1.EchoService/Echo"`,
		`"/capsets/dev/connect/echo-test/echo.v1.EchoService/NoComment"`,
		`"operationId": "dev_echo_echo_test_echo_v1_EchoService_Echo_post"`,
		`"operationId": "dev_echo_echo_test_echo_v1_EchoService_NoComment_post"`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("OpenAPI JSON missing %q:\n%s", want, body)
		}
	}
	doc := mustOpenAPIModel(t, raw)
	if _, ok := doc.Paths.PathItems.Get("/echo.v1.EchoService/Echo"); ok {
		t.Fatalf("source OpenAPI path was not rewritten:\n%s", body)
	}
	assertConnectProtocolVersionNotRequired(t, doc, "/capsets/dev/connect/echo-test/echo.v1.EchoService/Echo")
	yamlRaw, err := gateway.OpenAPI(ctx, "dev", "yaml")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(yamlRaw, []byte("/capsets/dev/connect/echo-test/echo.v1.EchoService/Echo")) {
		t.Fatalf("OpenAPI YAML missing rewritten path:\n%s", yamlRaw)
	}
}

func mustOpenAPIModel(t *testing.T, raw []byte) *v3.Document {
	t.Helper()
	doc, err := openAPIModel(raw)
	if err != nil {
		t.Fatal(err)
	}
	return doc
}

func assertConnectProtocolVersionNotRequired(t *testing.T, doc *v3.Document, path string) {
	t.Helper()
	pathItem, ok := doc.Paths.PathItems.Get(path)
	if !ok {
		t.Fatalf("OpenAPI path %s missing", path)
	}
	if pathItem.Post == nil {
		t.Fatalf("OpenAPI path %s missing post operation", path)
	}
	param := findHeaderParameter(pathItem.Post, "Connect-Protocol-Version")
	if param == nil {
		t.Fatalf("Connect-Protocol-Version header missing from %s", path)
	}
	if param.Required != nil && *param.Required {
		t.Fatalf("Connect-Protocol-Version should not be required: %+v", param)
	}
}

func findHeaderParameter(op *v3.Operation, name string) *v3.Parameter {
	for _, param := range op.Parameters {
		if param != nil && strings.EqualFold(param.In, "header") && strings.EqualFold(param.Name, name) {
			return param
		}
	}
	return nil
}

func TestOpenAPIMergeComponentMaps(t *testing.T) {
	dst := map[string]any{
		"schemas": map[string]any{
			"Echo": map[string]any{"type": "object"},
		},
		"securitySchemes": "not-a-map",
	}
	src := map[string]any{
		"schemas": map[string]any{
			"Echo": map[string]any{"type": "object"},
			"New":  map[string]any{"type": "string"},
		},
		"responses": map[string]any{
			"NotFound": map[string]any{"description": "missing"},
		},
	}
	merged, err := mergeComponentMaps(dst, src)
	if err != nil {
		t.Fatal(err)
	}
	schemas := merged["schemas"].(map[string]any)
	if _, ok := schemas["New"]; !ok {
		t.Fatalf("new schema was not merged: %+v", merged)
	}
	if merged["securitySchemes"] != "not-a-map" {
		t.Fatalf("non-map section changed: %+v", merged)
	}
	src["schemas"].(map[string]any)["Echo"] = map[string]any{"type": "array"}
	if _, err := mergeComponentMaps(dst, src); err == nil || !strings.Contains(err.Error(), "incompatible OpenAPI component schemas.Echo") {
		t.Fatalf("expected incompatible component error, got %v", err)
	}
}

func TestGatewayOpenAPIHelperBranches(t *testing.T) {
	dataDir := t.TempDir()
	compiled := compileFixture(t, dataDir)
	items := []store.ExposedMethod{
		{
			Capset:         domain.Capset{ID: "dev"},
			Service:        domain.Service{ID: "echo", DescriptorPath: filepath.Join(dataDir, "descriptor.protoset")},
			Instance:       domain.Instance{ID: "echo-test"},
			CapsetMethod:   domain.CapsetMethod{ID: "one"},
			CapsetInstance: domain.CapsetInstance{ID: "dev:echo-test"},
			Method:         compiled.Methods[0],
			ConnectPath:    "/capsets/dev/connect/echo-test/echo.v1.EchoService/Echo",
		},
		{
			Service: domain.Service{DescriptorPath: filepath.Join(dataDir, "descriptor.protoset")},
			Method:  domain.Method{ServiceFullName: compiled.Methods[0].ServiceFullName},
		},
	}
	if names := uniqueServiceNames(items); len(names) != 1 || names[0] != "echo.v1.EchoService" {
		t.Fatalf("unique service names=%v", names)
	}
	raw := []byte(`{
		"openapi":"3.1.0",
		"info":{"title":"test","version":"v"},
		"paths":{"/echo.v1.EchoService/Echo":{"post":{"responses":{"200":{"description":"ok"}}}}},
		"components":{"schemas":{"EchoRequest":{"type":"object"}}}
	}`)
	rewritten, err := rewriteOpenAPI(raw, items[:1])
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := rewritten.Paths.PathItems.Get(items[0].ConnectPath); !ok {
		t.Fatalf("rewritten OpenAPI missing %s", items[0].ConnectPath)
	}
	if _, ok := rewritten.Paths.PathItems.Get("/echo.v1.EchoService/Echo"); ok {
		t.Fatal("rewritten OpenAPI still has source path")
	}
	badItem := items[0]
	badItem.Method.FullName = "echo.v1.EchoService/Missing"
	if _, err := rewriteOpenAPI(raw, []store.ExposedMethod{badItem}); err == nil || !strings.Contains(err.Error(), "generated OpenAPI missing path") {
		t.Fatalf("expected missing path error, got %v", err)
	}
	if _, err := rewriteOpenAPI([]byte(`not-json`), items[:1]); err == nil {
		t.Fatal("expected invalid OpenAPI error")
	}
	merged, err := mergeOpenAPIDocuments(Catalog{CapsetID: "dev"}, []*v3.Document{rewritten})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := merged.Paths.PathItems.Get(items[0].ConnectPath); !ok {
		t.Fatal("merged OpenAPI missing rewritten path")
	}
}

func TestGatewayMarkdownAndSchemaHelperBranches(t *testing.T) {
	empty := RenderCatalogMarkdown(Catalog{
		CapsetID:       "dev|pipe",
		Name:           "Dev",
		Description:    "line one\nline two",
		GRPC:           []GRPCCatalogItem{},
		MCP:            []MCPCatalogItem{},
		ConnectRPC:     []ConnectRPCCatalogItem{},
		includeGRPC:    true,
		includeMCP:     true,
		includeConnect: true,
	})
	if strings.Count(string(empty), "No entries.") != 3 || !bytes.Contains(empty, []byte("dev\\|pipe")) {
		t.Fatalf("empty catalog markdown missing empty sections or escaping:\n%s", empty)
	}
	nilSections := RenderCatalogMarkdown(Catalog{CapsetID: "dev", includeGRPC: true, includeMCP: true, includeConnect: true})
	if bytes.Contains(nilSections, []byte("## gRPC")) || bytes.Contains(nilSections, []byte("No entries.")) {
		t.Fatalf("nil catalog sections should be omitted:\n%s", nilSections)
	}
	noDiscovery := RenderCatalogMarkdown(Catalog{CapsetID: "dev"})
	if bytes.Contains(noDiscovery, []byte("## Schema Discovery")) {
		t.Fatalf("schema discovery should be omitted when no sections are included:\n%s", noDiscovery)
	}

	dataDir := t.TempDir()
	compiled := compileFixture(t, dataDir)
	files, err := protodesc.NewFiles(compiled.Files)
	if err != nil {
		t.Fatal(err)
	}
	reqAny, err := files.FindDescriptorByName("echo.v1.EchoRequest")
	if err != nil {
		t.Fatal(err)
	}
	reqDesc := reqAny.(protoreflect.MessageDescriptor)
	if _, err := findMethod(files, "echo.v1.EchoRequest/Echo"); err == nil || !strings.Contains(err.Error(), "is not a service") {
		t.Fatalf("expected not service error, got %v", err)
	}
	schema := map[string]any{
		"properties": map[string]any{
			"text":  "not-a-map",
			"count": map[string]any{"type": "integer"},
		},
		"anyOf": []map[string]any{
			{"oneOf": "not-a-list"},
			{"oneOf": []map[string]any{
				{"properties": "not-a-map"},
				{"properties": map[string]any{
					"missing": map[string]any{},
					"email":   "not-a-map",
					"phone":   map[string]any{"type": "string"},
				}},
			}},
		},
	}
	annotateMCPSchemaWithProtoComments(schema, reqDesc)
	if got := schemaProperty(t, schema, "count")["description"]; got != nil {
		t.Fatalf("uncommented count unexpectedly described: %v", got)
	}
	if phone := schema["anyOf"].([]map[string]any)[1]["oneOf"].([]map[string]any)[1]["properties"].(map[string]any)["phone"].(map[string]any); phone["description"] != "Phone destination." {
		t.Fatalf("phone oneof was not annotated: %+v", phone)
	}
	annotateMCPSchemaWithProtoComments(map[string]any{}, nil)
	if got := formatProtoComment(protoreflect.SourceLocation{LeadingComments: " leading ", TrailingComments: " trailing "}); got != "leading\n\ntrailing" {
		t.Fatalf("formatted proto comment=%q", got)
	}
}

func TestGatewayAdditionalErrorBranches(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	compiled := compileFixture(t, dataDir)
	service := domain.Service{
		ID:                  "echo",
		Name:                "Echo",
		PackageSource:       "fixture",
		PackageArtifactPath: "pkg",
		PackageSHA256:       "pkgsha",
		DescriptorPath:      filepath.Join(dataDir, "descriptor.protoset"),
		DescriptorSHA256:    compiled.DescriptorSHA256,
		DescriptorVersion:   compiled.DescriptorVersion,
		NodeEntry:           "echo",
		Methods:             compiled.Methods,
	}
	if err := st.UpsertService(ctx, service); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: true, Status: domain.StatusRunning, NodeEntry: "echo", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:echo-test", CapsetID: "dev", ServiceID: "echo", InstanceID: "echo-test", IncludeAllMethods: true, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-test", MethodFullName: "echo.v1.EchoService/ServerStream", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	gateway := &Gateway{Store: st}

	w := httptest.NewRecorder()
	gateway.HandleConnectRPC(w, httptest.NewRequest(http.MethodPost, "/bad/connect/path", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("bad Connect route status=%d body=%s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	gateway.HandleConnectRPC(w, httptest.NewRequest(http.MethodPost, "/capsets/dev/connect/echo-test/echo.v1.EchoService/ServerStream", bytes.NewBufferString(`{}`)))
	if w.Code != http.StatusNotImplemented {
		t.Fatalf("streaming Connect route status=%d body=%s", w.Code, w.Body.String())
	}

	for _, tc := range []struct {
		name   string
		method string
		body   string
		want   int
		token  string
	}{
		{name: "method", method: http.MethodGet, body: `{}`, want: http.StatusMethodNotAllowed, token: "method not allowed"},
		{name: "json", method: http.MethodPost, body: `{`, want: http.StatusBadRequest, token: "invalid JSON"},
		{name: "unknown", method: http.MethodPost, body: `{"jsonrpc":"2.0","id":2,"method":"unknown"}`, want: http.StatusOK, token: "unsupported MCP method"},
		{name: "missing tool", method: http.MethodPost, body: `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"missing","arguments":{}}}`, want: http.StatusOK, token: "tool not found"},
		{name: "streaming tool", method: http.MethodPost, body: `{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"echo__echo-test__server_stream","arguments":{}}}`, want: http.StatusOK, token: "method is not a unary service method"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			gateway.HandleMCP(w, httptest.NewRequest(tc.method, "/capsets/dev/mcp", bytes.NewBufferString(tc.body)))
			if w.Code != tc.want || !strings.Contains(w.Body.String(), tc.token) {
				t.Fatalf("MCP status=%d body=%s want %d containing %q", w.Code, w.Body.String(), tc.want, tc.token)
			}
		})
	}

	brokenService := service
	brokenService.ID = "broken"
	brokenService.DescriptorPath = filepath.Join(dataDir, "missing.protoset")
	if err := st.UpsertService(ctx, brokenService); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "broken-test", ServiceID: "broken", Name: "Broken Test", Enabled: true, Status: domain.StatusRunning, NodeEntry: "echo", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:broken-test", CapsetID: "dev", ServiceID: "broken", InstanceID: "broken-test", IncludeAllMethods: true, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:broken-test", MethodFullName: "echo.v1.EchoService/Echo", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	w = httptest.NewRecorder()
	gateway.handleOpenAPI(w, httptest.NewRequest(http.MethodGet, "/capsets/dev/openapi.json", nil), "dev", "json")
	if w.Code != http.StatusInternalServerError || !strings.Contains(w.Body.String(), "descriptor load failed") {
		t.Fatalf("OpenAPI internal status=%d body=%s", w.Code, w.Body.String())
	}

	item, err := st.FindExposedMethod(ctx, "dev", "echo", "echo-test", "echo.v1.EchoService/ServerStream")
	if err != nil {
		t.Fatal(err)
	}
	item.Method.FullName = "echo.v1.EchoService"
	if _, _, err := gateway.methodDescriptor(item); err == nil || !strings.Contains(err.Error(), "invalid method full name") {
		t.Fatalf("expected invalid method name error, got %v", err)
	}
	item.Method.FullName = "echo.v1.EchoService/Missing"
	if _, _, err := gateway.methodDescriptor(item); err == nil || !strings.Contains(err.Error(), "method echo.v1.EchoService/Missing not found") {
		t.Fatalf("expected missing method error, got %v", err)
	}

	if err := grpcStatusToConnectError(errors.New("plain")); connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("plain grpc conversion code=%v err=%v", connect.CodeOf(err), err)
	}
}

func TestConnectAndPublicCodeMappings(t *testing.T) {
	cases := map[codes.Code]connect.Code{
		codes.Canceled:           connect.CodeCanceled,
		codes.Unknown:            connect.CodeUnknown,
		codes.InvalidArgument:    connect.CodeInvalidArgument,
		codes.DeadlineExceeded:   connect.CodeDeadlineExceeded,
		codes.NotFound:           connect.CodeNotFound,
		codes.AlreadyExists:      connect.CodeAlreadyExists,
		codes.PermissionDenied:   connect.CodePermissionDenied,
		codes.ResourceExhausted:  connect.CodeResourceExhausted,
		codes.FailedPrecondition: connect.CodeFailedPrecondition,
		codes.Aborted:            connect.CodeAborted,
		codes.OutOfRange:         connect.CodeOutOfRange,
		codes.Unimplemented:      connect.CodeUnimplemented,
		codes.Internal:           connect.CodeInternal,
		codes.Unavailable:        connect.CodeUnavailable,
		codes.DataLoss:           connect.CodeDataLoss,
		codes.Unauthenticated:    connect.CodeUnauthenticated,
	}
	for grpcCode, connectCode := range cases {
		if got := connectCodeFromGRPC(grpcCode); got != connectCode {
			t.Fatalf("%v mapped to %v want %v", grpcCode, got, connectCode)
		}
	}
	if got := connectCodeFromGRPC(codes.OK); got != connect.CodeUnknown {
		t.Fatalf("OK mapped to %v", got)
	}
	for _, name := range []string{"OK", "CANCELLED", "UNKNOWN", "INVALID_ARGUMENT", "DEADLINE_EXCEEDED", "NOT_FOUND", "ALREADY_EXISTS", "PERMISSION_DENIED", "RESOURCE_EXHAUSTED", "FAILED_PRECONDITION", "ABORTED", "OUT_OF_RANGE", "UNIMPLEMENTED", "INTERNAL", "UNAVAILABLE", "DATA_LOSS", "UNAUTHENTICATED"} {
		if _, ok := grpcCodeByName(name); !ok {
			t.Fatalf("grpc code name %s was not recognized", name)
		}
	}
	if _, ok := grpcCodeByName("NOT_A_CODE"); ok {
		t.Fatal("unknown grpc code name was recognized")
	}
	for grpcCode, want := range map[codes.Code]string{
		codes.OK:                 "OK",
		codes.Canceled:           "CANCELLED",
		codes.Unknown:            "UNKNOWN",
		codes.InvalidArgument:    "INVALID_ARGUMENT",
		codes.DeadlineExceeded:   "DEADLINE_EXCEEDED",
		codes.NotFound:           "NOT_FOUND",
		codes.AlreadyExists:      "ALREADY_EXISTS",
		codes.PermissionDenied:   "PERMISSION_DENIED",
		codes.ResourceExhausted:  "RESOURCE_EXHAUSTED",
		codes.FailedPrecondition: "FAILED_PRECONDITION",
		codes.Aborted:            "ABORTED",
		codes.OutOfRange:         "OUT_OF_RANGE",
		codes.Unimplemented:      "UNIMPLEMENTED",
		codes.Internal:           "INTERNAL",
		codes.Unavailable:        "UNAVAILABLE",
		codes.DataLoss:           "DATA_LOSS",
		codes.Unauthenticated:    "UNAUTHENTICATED",
		codes.Code(99):           "CODE(99)",
	} {
		if got := publicCode(grpcCode); got != want {
			t.Fatalf("public code %v=%q want %q", grpcCode, got, want)
		}
	}
}

func TestCodecAndMetadataHelpers(t *testing.T) {
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-octobus-capset", "dev", "authorization", "Bearer token", "x-octobus-service", "wrong-or-old-value", "X-Octobus-Instance", "echo", "x-octobus-future-control", "hidden", "x-octobus-ext-username", "alice"))
	clean := stripOctobusMetadata(ctx)
	if clean.Get("x-octobus-capset") != nil || clean.Get("x-octobus-service") != nil || clean.Get("x-octobus-instance") != nil || clean.Get("x-octobus-future-control") != nil {
		t.Fatalf("octobus metadata was not stripped: %v", clean)
	}
	if got := clean.Get("authorization"); len(got) != 1 || got[0] != "Bearer token" {
		t.Fatalf("non-octobus metadata was not preserved: %v", clean)
	}
	if got := clean.Get("x-octobus-ext-username"); len(got) != 1 || got[0] != "alice" {
		t.Fatalf("octobus extension metadata was not preserved: %v", clean)
	}
	if firstMD(clean, "missing") != "" || firstMD(clean, "authorization") != "Bearer token" {
		t.Fatalf("firstMD returned unexpected value")
	}

	frame := newRawFrame([]byte("abc"))
	if frame.String() != base64.StdEncoding.EncodeToString([]byte("abc")) || string(frame.Bytes()) != "abc" {
		t.Fatalf("raw frame mismatch: string=%q bytes=%q", frame.String(), frame.Bytes())
	}
	frame.ProtoMessage()
	frame.Reset()
	if len(frame.Bytes()) != 0 {
		t.Fatalf("raw frame was not reset: %q", frame.Bytes())
	}
	codec := rawCodec{}
	if b, err := codec.Marshal(rawFrame("xyz")); err != nil || string(b) != "xyz" {
		t.Fatalf("raw marshal=%q err=%v", b, err)
	}
	if _, err := codec.Marshal("bad"); err == nil || !strings.Contains(err.Error(), "unsupported raw marshal type") {
		t.Fatalf("expected raw marshal type error, got %v", err)
	}
	if err := codec.Unmarshal([]byte("def"), frame); err != nil || string(frame.Bytes()) != "def" {
		t.Fatalf("raw unmarshal frame=%q err=%v", frame.Bytes(), err)
	}
	if err := codec.Unmarshal([]byte("def"), "bad"); err == nil || !strings.Contains(err.Error(), "unsupported raw unmarshal type") {
		t.Fatalf("expected raw unmarshal type error, got %v", err)
	}

	strict := strictProtoJSONCodec{name: "json"}
	if strict.Name() != "json" {
		t.Fatalf("codec name=%q", strict.Name())
	}
	if _, err := strict.Marshal("bad"); err == nil || !strings.Contains(err.Error(), "not a proto message") {
		t.Fatalf("expected strict marshal type error, got %v", err)
	}
	if err := strict.Unmarshal(nil, "bad"); err == nil || !strings.Contains(err.Error(), "not a proto message") {
		t.Fatalf("expected strict unmarshal type error, got %v", err)
	}
	files, err := protodesc.NewFiles(compileFixture(t, t.TempDir()).Files)
	if err != nil {
		t.Fatal(err)
	}
	desc, err := files.FindDescriptorByName("echo.v1.EchoRequest")
	if err != nil {
		t.Fatal(err)
	}
	msg := dynamicpb.NewMessage(desc.(protoreflect.MessageDescriptor))
	if err := strict.Unmarshal([]byte(" \n\t "), msg); err != nil {
		t.Fatalf("empty strict unmarshal failed: %v", err)
	}
}

func TestGatewayLookupAndRouteHelpers(t *testing.T) {
	for _, path := range []string{"/missing", "/capsets/dev/mcp", "/capsets/dev/connect"} {
		if _, ok := parseConnectPath(path); ok {
			t.Fatalf("unexpectedly parsed %q", path)
		}
	}
	route, ok := parseConnectPath("/capsets/dev/connect/echo-test/echo.v1.EchoService/Echo")
	if !ok || route.CapsetID != "dev" || route.InstanceID != "echo-test" || route.MethodFullName != "echo.v1.EchoService/Echo" {
		t.Fatalf("bad parsed route: %+v ok=%v", route, ok)
	}
	ctx := context.WithValue(context.Background(), routeParamsKey{}, map[string]string{"capset_id": "dev"})
	if got := routeParam(ctx, "capset_id"); got != "dev" {
		t.Fatalf("route param=%q", got)
	}
	ctx = context.WithValue(context.Background(), connectRouteParamsKey{}, route)
	if got, ok := connectRouteParamsFromContext(ctx); !ok || got != route {
		t.Fatalf("context route=%+v ok=%v", got, ok)
	}
	item := store.ExposedMethod{
		Capset:         domain.Capset{ID: "dev"},
		Service:        domain.Service{ID: "echo"},
		Instance:       domain.Instance{ID: "echo-test"},
		Method:         domain.Method{FullName: "echo.v1.EchoService/Echo"},
		DescriptorHash: "hash",
		DescriptorVer:  "ver",
		CapsetMethod:   domain.CapsetMethod{ID: "7"},
	}
	key := connectHandlerCacheKey(item)
	for _, want := range []string{"dev", "echo", "echo-test", "echo.v1.EchoService/Echo", "hash", "ver", "7"} {
		if !strings.Contains(key, want) {
			t.Fatalf("connect cache key %q missing %q", key, want)
		}
	}
	if requestBodyTooLarge(httptest.NewRequest(http.MethodPost, "/", nil)) {
		t.Fatal("empty request should not be too large")
	}
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.ContentLength = DefaultMaxRequestBytes + 1
	if !requestBodyTooLarge(req) {
		t.Fatal("large request was not detected")
	}
	if echoErrorStatus(echo.NewHTTPError(http.StatusTeapot, "teapot")) != http.StatusTeapot {
		t.Fatal("echo status coder was not used")
	}
	if echoErrorStatus(errors.New("plain")) != http.StatusInternalServerError {
		t.Fatal("plain error did not map to 500")
	}
	f := newRawFrame([]byte("x"))
	f.ProtoMessage()
}

func TestGatewayGRPCAndConnectLookupErrors(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	service := domain.Service{
		ID:                  "echo",
		Name:                "Echo",
		PackageSource:       "fixture",
		PackageArtifactPath: "pkg",
		PackageSHA256:       "pkgsha",
		DescriptorPath:      filepath.Join(dataDir, "missing.protoset"),
		DescriptorSHA256:    "descsha",
		DescriptorVersion:   "descver",
		NodeEntry:           "entry",
		Methods: []domain.Method{
			{FullName: "echo.v1.EchoService/Echo", ServiceFullName: "echo.v1.EchoService", Name: "Echo", Unary: true},
			{FullName: "echo.v1.EchoService/Stream", ServiceFullName: "echo.v1.EchoService", Name: "Stream", ServerStreaming: true},
		},
	}
	if err := st.UpsertService(ctx, service); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: true, Status: domain.StatusRunning, NodeEntry: "entry", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:echo-test", CapsetID: "dev", ServiceID: "echo", InstanceID: "echo-test", IncludeAllMethods: true, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-test", MethodFullName: "echo.v1.EchoService/Stream", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	gateway := &Gateway{Store: st}
	if _, err := gateway.UnaryProxy(ctx, "/echo.v1.EchoService/Echo", nil); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("missing metadata code=%v err=%v", status.Code(err), err)
	}
	mdCtx := metadata.NewIncomingContext(ctx, metadata.Pairs("x-octobus-capset", "dev", "x-octobus-instance", "echo-test"))
	if _, err := gateway.UnaryProxy(mdCtx, "/echo.v1.EchoService/Stream", nil); status.Code(err) != codes.Unimplemented {
		t.Fatalf("streaming unary proxy code=%v err=%v", status.Code(err), err)
	}
	if _, err := gateway.findConnectExposedMethod(ctx, connectRouteParams{CapsetID: "dev", InstanceID: "echo-test", MethodFullName: "echo.v1.EchoService/Stream"}); !errors.Is(err, domain.ErrMethodNotUnary) {
		t.Fatalf("connect streaming lookup err=%v", err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/capsets/dev/connect/echo-test/echo.v1.EchoService/Stream", nil)
	gateway.HandleConnectRPC(rec, req)
	if rec.Code != http.StatusNotImplemented || !bytes.Contains(rec.Body.Bytes(), []byte("unimplemented")) {
		t.Fatalf("connect streaming status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestDescriptorBytesForCatalogAndGRPCServer(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	compiled := compileFixture(t, dataDir)
	service := domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: filepath.Join(dataDir, "descriptor.protoset"), DescriptorSHA256: compiled.DescriptorSHA256, DescriptorVersion: compiled.DescriptorVersion, NodeEntry: "echo", Methods: compiled.Methods}
	if err := st.UpsertService(ctx, service); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-one", ServiceID: "echo", Name: "Echo One", Enabled: true, Status: domain.StatusRunning, NodeEntry: "echo", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-two", ServiceID: "echo", Name: "Echo Two", Enabled: true, Status: domain.StatusRunning, NodeEntry: "echo", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	for _, instID := range []string{"echo-one", "echo-two"} {
		ciID := "dev:" + instID
		if err := st.AddCapsetInstance(ctx, domain.CapsetInstance{ID: ciID, CapsetID: "dev", ServiceID: "echo", InstanceID: instID, Enabled: true}); err != nil {
			t.Fatal(err)
		}
		if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: ciID, MethodFullName: "echo.v1.EchoService/Echo", Enabled: true}); err != nil {
			t.Fatal(err)
		}
	}

	raw, err := DescriptorBytesForCatalog(ctx, st, "dev")
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) != len(compiled.Files.GetFile()) {
		t.Fatalf("descriptor bytes count=%d want %d", len(raw), len(compiled.Files.GetFile()))
	}
	if _, err := DescriptorBytesForCatalog(ctx, st, "missing"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("missing catalog descriptor err=%v", err)
	}
	grpcServer := GRPCServer(&Gateway{Store: st})
	if grpcServer == nil {
		t.Fatal("GRPCServer returned nil")
	}
	grpcServer.Stop()
}

func TestGatewayInvalidationClosesMatchingConnections(t *testing.T) {
	gateway := &Gateway{conns: map[string]*grpc.ClientConn{}}
	one, err := grpc.NewClient("127.0.0.1:1", grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	two, err := grpc.NewClient("127.0.0.1:2", grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	other, err := grpc.NewClient("127.0.0.1:3", grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	gateway.conns["echo-test\x00127.0.0.1:1"] = one
	gateway.conns["echo-test\x00127.0.0.1:2"] = two
	gateway.conns["other\x00127.0.0.1:3"] = other

	gateway.InvalidateInstance("echo-test")
	if _, ok := gateway.conns["echo-test\x00127.0.0.1:1"]; ok {
		t.Fatal("first matching connection was not removed")
	}
	if _, ok := gateway.conns["echo-test\x00127.0.0.1:2"]; ok {
		t.Fatal("second matching connection was not removed")
	}
	if _, ok := gateway.conns["other\x00127.0.0.1:3"]; !ok {
		t.Fatal("non-matching connection was removed")
	}
	if err := gateway.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestGatewayInvokeJSONAndStreamErrorPaths(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	compiled := compileFixture(t, dataDir)
	service := domain.Service{
		ID:                  "echo",
		Name:                "Echo",
		PackageSource:       "fixture",
		PackageArtifactPath: "pkg",
		PackageSHA256:       "pkgsha",
		DescriptorPath:      filepath.Join(dataDir, "descriptor.protoset"),
		DescriptorSHA256:    compiled.DescriptorSHA256,
		DescriptorVersion:   compiled.DescriptorVersion,
		NodeEntry:           "echo",
		Methods:             compiled.Methods,
	}
	if err := st.UpsertService(ctx, service); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: true, Status: domain.StatusStopped, NodeEntry: "echo", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:echo-test", CapsetID: "dev", ServiceID: "echo", InstanceID: "echo-test", IncludeAllMethods: true, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{"echo.v1.EchoService/Echo", "echo.v1.EchoService/ServerStream"} {
		if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-test", MethodFullName: method, Enabled: true}); err != nil {
			t.Fatal(err)
		}
	}
	gateway := &Gateway{Store: st}
	item := mustFindExposed(t, st, "Echo")
	if _, err := gateway.invokeJSON(ctx, item, bytes.NewBufferString(`{"text":`)); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("invalid JSON code=%v err=%v", status.Code(err), err)
	}
	if _, err := gateway.invokeJSON(ctx, item, errReader{err: &http.MaxBytesError{Limit: 1}}); status.Code(err) != codes.ResourceExhausted {
		t.Fatalf("oversized read code=%v err=%v", status.Code(err), err)
	}
	item.Method.InputFullName = "echo.v1.MissingRequest"
	if _, err := gateway.invokeJSON(ctx, item, bytes.NewBufferString(`{}`)); status.Code(err) != codes.Internal {
		t.Fatalf("missing input code=%v err=%v", status.Code(err), err)
	}
	item = mustFindExposed(t, st, "Echo")
	item.Service.DescriptorPath = filepath.Join(dataDir, "missing.protoset")
	if _, err := gateway.invokeJSON(ctx, item, bytes.NewBufferString(`{}`)); status.Code(err) != codes.Internal {
		t.Fatalf("missing descriptor code=%v err=%v", status.Code(err), err)
	}

	streamItem := mustFindExposed(t, st, "ServerStream")
	if _, err := gateway.newBackendStream(ctx, streamItem); status.Code(err) != codes.Unavailable {
		t.Fatalf("stopped instance stream code=%v err=%v", status.Code(err), err)
	}
	streamItem.Instance.Status = domain.StatusRunning
	streamItem.Instance.ListenAddr = "bufconn:test"
	if _, err := gateway.newBackendStream(ctx, streamItem); status.Code(err) != codes.Unavailable {
		t.Fatalf("bufconn stream code=%v err=%v", status.Code(err), err)
	}
	streamItem.Service.RuntimeMode = domain.RuntimeModeOnDemand
	if _, err := gateway.newBackendStream(ctx, streamItem); status.Code(err) != codes.Unimplemented {
		t.Fatalf("on-demand stream code=%v err=%v", status.Code(err), err)
	}
}

type errReader struct {
	err error
}

func (r errReader) Read([]byte) (int, error) {
	return 0, r.err
}

func TestMergeComponentsAndCloneAny(t *testing.T) {
	dstDoc, err := openAPIModel([]byte(`{"openapi":"3.1.0","info":{"title":"dst","version":"v"},"paths":{},"components":{"schemas":{"Echo":{"type":"object"}}}}`))
	if err != nil {
		t.Fatal(err)
	}
	srcDoc, err := openAPIModel([]byte(`{"openapi":"3.1.0","info":{"title":"src","version":"v"},"paths":{},"components":{"schemas":{"Echo":{"type":"object"},"Other":{"type":"string"}}}}`))
	if err != nil {
		t.Fatal(err)
	}
	if err := mergeComponents(dstDoc.Components, srcDoc.Components); err != nil {
		t.Fatal(err)
	}
	if _, ok := dstDoc.Components.Schemas.Get("Other"); !ok {
		t.Fatal("merged component schema missing")
	}
	srcDoc, err = openAPIModel([]byte(`{"openapi":"3.1.0","info":{"title":"src","version":"v"},"paths":{},"components":{"schemas":{"Echo":{"type":"array"}}}}`))
	if err != nil {
		t.Fatal(err)
	}
	if err := mergeComponents(dstDoc.Components, srcDoc.Components); err == nil || !strings.Contains(err.Error(), "incompatible OpenAPI component") {
		t.Fatalf("expected incompatible component error, got %v", err)
	}
	original := []any{map[string]any{"nested": []any{"value"}}}
	cloned := cloneAny(original).([]any)
	cloned[0].(map[string]any)["nested"].([]any)[0] = "changed"
	if original[0].(map[string]any)["nested"].([]any)[0] != "value" {
		t.Fatal("cloneAny did not deep copy nested values")
	}
}

type countingListener struct {
	net.Listener
	accepted atomic.Int64
}

func (l *countingListener) Accept() (net.Conn, error) {
	conn, err := l.Listener.Accept()
	if err == nil {
		l.accepted.Add(1)
	}
	return conn, err
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

type dynamicProtoJSONCodec struct {
	desc protoreflect.MessageDescriptor
}

func (dynamicProtoJSONCodec) Name() string {
	return "json"
}

func (dynamicProtoJSONCodec) Marshal(v any) ([]byte, error) {
	msg, ok := v.(proto.Message)
	if !ok {
		return nil, status.Errorf(codes.Internal, "not a proto message: %T", v)
	}
	return protojson.Marshal(msg)
}

func (c dynamicProtoJSONCodec) Unmarshal(data []byte, v any) error {
	msg, ok := v.(proto.Message)
	if !ok {
		return status.Errorf(codes.Internal, "not a proto message: %T", v)
	}
	if dynamic, ok := v.(*dynamicpb.Message); ok && c.desc != nil {
		*dynamic = *dynamicpb.NewMessage(c.desc)
		msg = dynamic
	}
	return protojson.Unmarshal(data, msg)
}
