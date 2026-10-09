package protocol

import (
	"context"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"testing"

	"octobus/internal/accesslog"
	"octobus/internal/descriptors"
	"octobus/internal/domain"
	"octobus/internal/store"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/reflection/grpc_reflection_v1"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/descriptorpb"
)

func TestReflectionIndexOnlyExposesBoundServicesAndMethods(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	protoDir := filepath.Join(dataDir, "pkg/proto")
	if err := os.MkdirAll(protoDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(protoDir, "visible.proto"), []byte(`syntax = "proto3";
package visible.v1;
service VisibleService {
  rpc Echo(EchoRequest) returns (EchoResponse);
  rpc HiddenMethod(EchoRequest) returns (EchoResponse);
}
message EchoRequest { string text = 1; }
message EchoResponse { string text = 1; }
`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(protoDir, "hidden.proto"), []byte(`syntax = "proto3";
package hidden.v1;
service HiddenService { rpc Hidden(HiddenRequest) returns (HiddenResponse); }
message HiddenRequest { string text = 1; }
message HiddenResponse { string text = 1; }
`), 0o644); err != nil {
		t.Fatal(err)
	}
	compiled, err := descriptors.Compile(descriptors.CompileRequest{PackageDir: filepath.Join(dataDir, "pkg"), ProtoRoots: []string{"proto"}, ProtoFiles: []string{"proto/visible.proto", "proto/hidden.proto"}, DescriptorPath: filepath.Join(dataDir, "descriptor.protoset")})
	if err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.UpsertService(ctx, domain.Service{ID: "svc", Name: "Svc", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: filepath.Join(dataDir, "descriptor.protoset"), DescriptorSHA256: compiled.DescriptorSHA256, DescriptorVersion: compiled.DescriptorVersion, NodeEntry: "svc", Methods: compiled.Methods}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "inst", ServiceID: "svc", Name: "Inst", Enabled: true, Status: domain.StatusRunning, NodeEntry: "svc", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:inst", CapsetID: "dev", ServiceID: "svc", InstanceID: "inst", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:inst", MethodFullName: "visible.v1.VisibleService/Echo", Enabled: true}); err != nil {
		t.Fatal(err)
	}

	idx, err := (&ReflectionServer{Store: st}).index(ctx, "dev")
	if err != nil {
		t.Fatal(err)
	}
	if !idx.services["visible.v1.VisibleService"] || idx.services["hidden.v1.HiddenService"] {
		t.Fatalf("unexpected services: %+v", idx.services)
	}
	if idx.symbolToFile["visible.v1.VisibleService.Echo"] == "" {
		t.Fatal("visible method was not indexed")
	}
	if idx.symbolToFile["visible.v1.VisibleService.HiddenMethod"] != "" {
		t.Fatal("unbound method was indexed")
	}
	if idx.symbolToFile["hidden.v1.HiddenService"] != "" {
		t.Fatal("hidden service was indexed")
	}
	for name := range idx.files {
		if filepath.Base(name) == "hidden.proto" {
			t.Fatal("hidden file was included in reflection closure")
		}
	}
	var visible *descriptorpb.FileDescriptorProto
	for name := range idx.files {
		if filepath.Base(name) != "visible.proto" {
			continue
		}
		for _, raw := range idx.closure(name) {
			file := &descriptorpb.FileDescriptorProto{}
			if err := proto.Unmarshal(raw, file); err != nil {
				t.Fatal(err)
			}
			if filepath.Base(file.GetName()) == "visible.proto" {
				visible = file
			}
		}
	}
	if visible == nil {
		t.Fatal("visible descriptor was not returned")
	}
	if len(visible.GetService()) != 1 || visible.GetService()[0].GetName() != "VisibleService" {
		t.Fatalf("unexpected reflected services: %+v", visible.GetService())
	}
	methods := visible.GetService()[0].GetMethod()
	if len(methods) != 1 || methods[0].GetName() != "Echo" {
		t.Fatalf("unexpected reflected methods: %+v", methods)
	}
}

func TestReflectionRequiresTokenWhenCapsetHasTokens(t *testing.T) {
	ctx := context.Background()
	st, err := store.Open(filepath.Join(t.TempDir(), "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	server := &ReflectionServer{Store: st}
	if err := server.authorize(ctx, "dev"); err != nil {
		t.Fatalf("token-free capset should authorize: %v", err)
	}
	if _, err := st.AddCapsetToken(ctx, domain.CapsetToken{ID: "key", CapsetID: "dev"}, "secret"); err != nil {
		t.Fatal(err)
	}
	if err := server.authorize(ctx, "dev"); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("missing token code=%v err=%v", status.Code(err), err)
	}
	wrongCtx := metadata.NewIncomingContext(ctx, metadata.Pairs("authorization", "Bearer wrong"))
	if err := server.authorize(wrongCtx, "dev"); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("wrong token code=%v err=%v", status.Code(err), err)
	}
	validCtx := metadata.NewIncomingContext(ctx, metadata.Pairs("authorization", "Bearer secret"))
	if err := server.authorize(validCtx, "dev"); err != nil {
		t.Fatalf("valid token should authorize: %v", err)
	}
}

func TestReflectionIndexCacheAndClosureCopies(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	protoDir := filepath.Join(dataDir, "pkg/proto")
	if err := os.MkdirAll(protoDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(protoDir, "visible.proto"), []byte(`syntax = "proto3";
package visible.v1;
service VisibleService {
  rpc Echo(EchoRequest) returns (EchoResponse);
  rpc Ping(EchoRequest) returns (EchoResponse);
}
message EchoRequest { string text = 1; }
message EchoResponse { string text = 1; }
`), 0o644); err != nil {
		t.Fatal(err)
	}
	compiled, err := descriptors.Compile(descriptors.CompileRequest{PackageDir: filepath.Join(dataDir, "pkg"), ProtoRoots: []string{"proto"}, ProtoFiles: []string{"proto/visible.proto"}, DescriptorPath: filepath.Join(dataDir, "descriptor.protoset")})
	if err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.UpsertService(ctx, domain.Service{ID: "svc", Name: "Svc", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: filepath.Join(dataDir, "descriptor.protoset"), DescriptorSHA256: compiled.DescriptorSHA256, DescriptorVersion: compiled.DescriptorVersion, NodeEntry: "svc", Methods: compiled.Methods}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "inst", ServiceID: "svc", Name: "Inst", Enabled: true, Status: domain.StatusRunning, NodeEntry: "svc", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:inst", CapsetID: "dev", ServiceID: "svc", InstanceID: "inst", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:inst", MethodFullName: "visible.v1.VisibleService/Echo", Enabled: true}); err != nil {
		t.Fatal(err)
	}

	server := &ReflectionServer{Store: st}
	first, err := server.index(ctx, "dev")
	if err != nil {
		t.Fatal(err)
	}
	second, err := server.index(ctx, "dev")
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatal("reflection index cache did not return the cached index")
	}
	file := first.symbolToFile["visible.v1.VisibleService.Echo"]
	closure := first.closure(file)
	if len(closure) == 0 || len(first.closures[file]) == 0 {
		t.Fatalf("closure was not cached for %q", file)
	}
	closure[0][0] ^= 0xff
	again := first.closure(file)
	if closure[0][0] == again[0][0] {
		t.Fatal("closure returned mutable cached bytes")
	}

	if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:inst", MethodFullName: "visible.v1.VisibleService/Ping", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	updated, err := server.index(ctx, "dev")
	if err != nil {
		t.Fatal(err)
	}
	if updated == first {
		t.Fatal("reflection index cache did not invalidate after exposure change")
	}
	if updated.symbolToFile["visible.v1.VisibleService.Ping"] == "" {
		t.Fatal("newly exposed method was not indexed")
	}
}

func TestReflectionAccessLog(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	compiled := compileFixture(t, dataDir)
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: filepath.Join(dataDir, "descriptor.protoset"), DescriptorSHA256: compiled.DescriptorSHA256, DescriptorVersion: compiled.DescriptorVersion, NodeEntry: "echo", Methods: compiled.Methods}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: true, Status: domain.StatusRunning, NodeEntry: "echo", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:echo-test", CapsetID: "dev", ServiceID: "echo", InstanceID: "echo-test", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-test", MethodFullName: "echo.v1.EchoService/Echo", Enabled: true}); err != nil {
		t.Fatal(err)
	}

	logger := &memoryAccessLogger{}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := GRPCServer(&Gateway{Store: st, AccessLogger: logger})
	go srv.Serve(ln)
	defer srv.Stop()
	conn, err := grpc.NewClient(ln.Addr().String(), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	client := grpc_reflection_v1.NewServerReflectionClient(conn)

	stream, err := client.ServerReflectionInfo(metadata.NewOutgoingContext(ctx, metadata.Pairs("x-octobus-capset", "dev")))
	if err != nil {
		t.Fatal(err)
	}
	if err := stream.Send(&grpc_reflection_v1.ServerReflectionRequest{MessageRequest: &grpc_reflection_v1.ServerReflectionRequest_ListServices{ListServices: ""}}); err != nil {
		t.Fatal(err)
	}
	if _, err := stream.Recv(); err != nil {
		t.Fatal(err)
	}
	if err := stream.CloseSend(); err != nil {
		t.Fatal(err)
	}
	if _, err := stream.Recv(); !errors.Is(err, io.EOF) {
		t.Fatalf("reflection close err=%v", err)
	}
	assertAccessRecord(t, logger, accesslog.Record{
		Protocol: "grpc_reflection",
		Capset:   "dev",
		Route:    "/grpc.reflection.v1.ServerReflection/ServerReflectionInfo",
		GRPCCode: codes.OK.String(),
	})

	// Reflection clients resolve descriptors by symbol and by file name, and the
	// server has to answer every request shape rather than only listing services.
	variants := []struct {
		name    string
		request *grpc_reflection_v1.ServerReflectionRequest
		code    codes.Code
	}{
		{
			name:    "known symbol",
			request: &grpc_reflection_v1.ServerReflectionRequest{MessageRequest: &grpc_reflection_v1.ServerReflectionRequest_FileContainingSymbol{FileContainingSymbol: "echo.v1.EchoService"}},
			code:    codes.OK,
		},
		{
			name:    "unknown symbol",
			request: &grpc_reflection_v1.ServerReflectionRequest{MessageRequest: &grpc_reflection_v1.ServerReflectionRequest_FileContainingSymbol{FileContainingSymbol: "echo.v1.Missing"}},
			code:    codes.NotFound,
		},
		{
			name:    "known file",
			request: &grpc_reflection_v1.ServerReflectionRequest{MessageRequest: &grpc_reflection_v1.ServerReflectionRequest_FileByFilename{FileByFilename: "echo.proto"}},
			code:    codes.OK,
		},
		{
			name:    "unknown file",
			request: &grpc_reflection_v1.ServerReflectionRequest{MessageRequest: &grpc_reflection_v1.ServerReflectionRequest_FileByFilename{FileByFilename: "missing.proto"}},
			code:    codes.NotFound,
		},
		{
			name:    "unsupported request",
			request: &grpc_reflection_v1.ServerReflectionRequest{MessageRequest: &grpc_reflection_v1.ServerReflectionRequest_AllExtensionNumbersOfType{AllExtensionNumbersOfType: "echo.v1.EchoService"}},
			code:    codes.Unimplemented,
		},
	}
	for _, tc := range variants {
		t.Run(tc.name, func(t *testing.T) {
			stream, err := client.ServerReflectionInfo(metadata.NewOutgoingContext(ctx, metadata.Pairs("x-octobus-capset", "dev")))
			if err != nil {
				t.Fatal(err)
			}
			if err := stream.Send(tc.request); err != nil {
				t.Fatal(err)
			}
			resp, err := stream.Recv()
			if err != nil {
				t.Fatal(err)
			}
			if err := stream.CloseSend(); err != nil {
				t.Fatal(err)
			}
			// Read to EOF so the handler has returned, and with it written the
			// stream's access log record, before the caller inspects the log.
			if _, err := stream.Recv(); !errors.Is(err, io.EOF) {
				t.Fatalf("reflection %s stream close err=%v", tc.name, err)
			}
			got := codes.OK
			if errResp := resp.GetErrorResponse(); errResp != nil {
				got = codes.Code(errResp.GetErrorCode())
			}
			if got != tc.code {
				t.Fatalf("reflection %s code=%v want %v (resp=%+v)", tc.name, got, tc.code, resp)
			}
		})
	}

	before := len(logger.Records())
	noCapset, err := client.ServerReflectionInfo(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_ = noCapset.Send(&grpc_reflection_v1.ServerReflectionRequest{MessageRequest: &grpc_reflection_v1.ServerReflectionRequest_ListServices{ListServices: ""}})
	if _, err := noCapset.Recv(); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("no capset reflection code=%v err=%v", status.Code(err), err)
	}
	if got := len(logger.Records()); got != before {
		t.Fatalf("reflection without capset wrote log count=%d before=%d records=%+v", got, before, logger.Records())
	}
}

func TestReflectionError(t *testing.T) {
	resp := reflectionError(codes.NotFound, "missing symbol")
	if resp.ErrorResponse.GetErrorCode() != int32(codes.NotFound) {
		t.Fatalf("code=%d", resp.ErrorResponse.GetErrorCode())
	}
	if resp.ErrorResponse.GetErrorMessage() != "missing symbol" {
		t.Fatalf("message=%q", resp.ErrorResponse.GetErrorMessage())
	}
}
