package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v5"

	"octobus/internal/domain"
	"octobus/internal/packageimport"
	"octobus/internal/protocol"
	"octobus/internal/store"
	"octobus/internal/supervisor"
)

type fakeServiceImporter struct {
	importFn          func(context.Context, packageimport.Options) (packageimport.Result, error)
	importRecursiveFn func(context.Context, packageimport.Options) (packageimport.RecursiveResult, error)
}

func (f fakeServiceImporter) Import(ctx context.Context, opts packageimport.Options) (packageimport.Result, error) {
	if f.importFn == nil {
		return packageimport.Result{}, errors.New("unexpected single service import")
	}
	return f.importFn(ctx, opts)
}

func (f fakeServiceImporter) ImportRecursive(ctx context.Context, opts packageimport.Options) (packageimport.RecursiveResult, error) {
	if f.importRecursiveFn == nil {
		return packageimport.RecursiveResult{}, errors.New("unexpected recursive service import")
	}
	return f.importRecursiveFn(ctx, opts)
}

func TestStatus(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "echo", Methods: []domain.Method{{FullName: "echo.v1.EchoService/Echo", Unary: true}}}); err != nil {
		t.Fatal(err)
	}
	srv := &Server{Store: st, Importer: &packageimport.Importer{DataDir: dataDir, Store: st}, Supervisor: supervisor.New(dataDir, st)}
	req := httptest.NewRequest(http.MethodGet, "/admin/v1/status", nil)
	w := httptest.NewRecorder()
	srv.Handler().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status code = %d body=%s", w.Code, w.Body.String())
	}
	var body struct {
		Status   string `json:"status"`
		Services int    `json:"services"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Status != "ok" || body.Services != 1 {
		t.Fatalf("status body=%+v", body)
	}
}

func TestNewHTTPServerSetsTimeouts(t *testing.T) {
	server := NewHTTPServer("127.0.0.1:0", http.NotFoundHandler())
	if server.ReadHeaderTimeout != 5*time.Second {
		t.Fatalf("ReadHeaderTimeout=%v", server.ReadHeaderTimeout)
	}
	if server.ReadTimeout != 30*time.Second {
		t.Fatalf("ReadTimeout=%v", server.ReadTimeout)
	}
	if server.IdleTimeout != 2*time.Minute {
		t.Fatalf("IdleTimeout=%v", server.IdleTimeout)
	}
	if server.WriteTimeout != 0 {
		t.Fatalf("WriteTimeout=%v", server.WriteTimeout)
	}
}

func TestResourceCRUDRoutes(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "echo", Methods: []domain.Method{{FullName: "echo.v1.EchoService/Echo", Unary: true}}}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: false, Status: domain.StatusStopped, NodeEntry: "echo", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	srv := &Server{Store: st, Supervisor: supervisor.New(dataDir, st)}

	body := serveAdmin(t, srv, http.MethodGet, "/admin/v1/services", nil, http.StatusOK)
	if !bytes.Contains(body, []byte(`"services"`)) {
		t.Fatalf("service list body=%s", body)
	}
	body = serveAdmin(t, srv, http.MethodPatch, "/admin/v1/services/echo", bytes.NewBufferString(`{"name":"Echo Updated"}`), http.StatusOK)
	if !bytes.Contains(body, []byte("Echo Updated")) {
		t.Fatalf("service update body=%s", body)
	}

	body = serveAdmin(t, srv, http.MethodPatch, "/admin/v1/instances/echo-test", bytes.NewBufferString(`{"name":"Renamed"}`), http.StatusOK)
	if !bytes.Contains(body, []byte("Renamed")) {
		t.Fatalf("instance update body=%s", body)
	}
	body = serveAdmin(t, srv, http.MethodPost, "/admin/v1/instances/echo-test/secret", bytes.NewBufferString(`{"secret":{"apiToken":"admin-secret"}}`), http.StatusOK)
	if bytes.Contains(body, []byte("admin-secret")) || bytes.Contains(body, []byte("SecretJSON")) {
		t.Fatalf("instance secret update response leaked secret: %s", body)
	}
	if !bytes.Contains(body, []byte("SecretSHA256")) {
		t.Fatalf("instance secret update response missing hash: %s", body)
	}
	inst, err := st.GetInstance(ctx, "echo-test")
	if err != nil {
		t.Fatal(err)
	}
	if string(inst.SecretJSON) != `{"apiToken":"admin-secret"}` {
		t.Fatalf("secret was not persisted: %s", inst.SecretJSON)
	}

	serveAdmin(t, srv, http.MethodPost, "/admin/v1/capsets", bytes.NewBufferString(`{"id":"dev","name":"Dev","enabled":true}`), http.StatusOK)
	body = serveAdmin(t, srv, http.MethodPost, "/admin/v1/capsets/dev/instances", bytes.NewBufferString(`{"instance_id":"echo-test","all_methods":false}`), http.StatusOK)
	var capsetInstance domain.CapsetInstance
	if err := json.Unmarshal(body, &capsetInstance); err != nil {
		t.Fatal(err)
	}
	if capsetInstance.CreatedAt.IsZero() || capsetInstance.UpdatedAt.IsZero() {
		t.Fatalf("capset instance response has zero timestamps: %s", body)
	}
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/capsets/dev/methods", bytes.NewBufferString(`{"instance_id":"echo-test","method":"echo.v1.EchoService/Echo","mcp_tool":"echo_tool"}`), http.StatusOK)
	body = serveAdmin(t, srv, http.MethodGet, "/admin/v1/capsets/dev/methods", nil, http.StatusOK)
	if !bytes.Contains(body, []byte("echo_tool")) {
		t.Fatalf("capset methods body=%s", body)
	}
	serveAdmin(t, srv, http.MethodDelete, "/admin/v1/capsets/dev/methods?instance_id=echo-test&method=echo.v1.EchoService%2FEcho", nil, http.StatusOK)
	body = serveAdmin(t, srv, http.MethodGet, "/admin/v1/capsets/dev/methods", nil, http.StatusOK)
	var listed struct {
		Methods []domain.CapsetMethod `json:"methods"`
	}
	if err := json.Unmarshal(body, &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.Methods) != 0 {
		t.Fatalf("method not deleted: %s", body)
	}
	body = serveAdmin(t, srv, http.MethodPost, "/admin/v1/capsets/dev/tokens", bytes.NewBufferString(`{"id":"key-one","name":"Primary","token":"secret-one"}`), http.StatusOK)
	if bytes.Contains(body, []byte("secret-one")) || !bytes.Contains(body, []byte(domain.CapsetTokenHash("secret-one"))) {
		t.Fatalf("capset token response leaked secret or missed hash: %s", body)
	}
	if ok, err := st.VerifyCapsetToken(ctx, "dev", "secret-one"); err != nil || !ok {
		t.Fatalf("stored token verification ok=%v err=%v", ok, err)
	}
	body = serveAdmin(t, srv, http.MethodGet, "/admin/v1/capsets/dev/tokens", nil, http.StatusOK)
	if bytes.Contains(body, []byte("secret-one")) || !bytes.Contains(body, []byte("key-one")) {
		t.Fatalf("capset token list response mismatch: %s", body)
	}
	serveAdmin(t, srv, http.MethodDelete, "/admin/v1/capsets/dev/tokens/key-one", nil, http.StatusOK)
	if ok, err := st.VerifyCapsetToken(ctx, "dev", "secret-one"); err != nil || ok {
		t.Fatalf("deleted token verification ok=%v err=%v", ok, err)
	}
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/capsets", bytes.NewBufferString(`{"id":"default-all","name":"Default All","enabled":true}`), http.StatusOK)
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/capsets/default-all/instances", bytes.NewBufferString(`{"instance_id":"echo-test"}`), http.StatusOK)
	body = serveAdmin(t, srv, http.MethodGet, "/admin/v1/capsets/default-all/methods", nil, http.StatusOK)
	if !bytes.Contains(body, []byte("echo.v1.EchoService/Echo")) {
		t.Fatalf("omitted all_methods should default to selected methods: %s", body)
	}
	serveAdmin(t, srv, http.MethodDelete, "/admin/v1/capsets/dev/instances/echo-test", nil, http.StatusOK)
	serveAdmin(t, srv, http.MethodDelete, "/admin/v1/capsets/dev", nil, http.StatusOK)
	serveAdmin(t, srv, http.MethodDelete, "/admin/v1/instances/echo-test", nil, http.StatusOK)
	serveAdmin(t, srv, http.MethodDelete, "/admin/v1/services/echo", nil, http.StatusOK)
}

func TestAdminWriteOperationsLogStructuredEventsAndRedactSecrets(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "echo", Methods: []domain.Method{
		{FullName: "echo.v1.EchoService/Echo", ServiceFullName: "echo.v1.EchoService", Name: "Echo", Unary: true},
		{FullName: "echo.v1.EchoService/Stream", ServiceFullName: "echo.v1.EchoService", Name: "Stream", ServerStreaming: true},
	}}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: false, Status: domain.StatusStopped, NodeEntry: "echo", ConfigJSON: []byte(`{}`), SecretJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	sup := supervisor.New(dataDir, st)
	sup.Logger = slog.New(slog.NewTextHandler(&out, &slog.HandlerOptions{Level: slog.LevelInfo}))
	srv := &Server{Store: st, Supervisor: sup, Logger: slog.New(slog.NewTextHandler(&out, &slog.HandlerOptions{Level: slog.LevelInfo}))}

	serveAdmin(t, srv, http.MethodPost, "/admin/v1/tokens", bytes.NewBufferString(`{"id":"admin-key","name":"Admin","token":"admin-secret"}`), http.StatusOK)
	serveAdminWithToken(t, srv, http.MethodPost, "/admin/v1/tokens", bytes.NewBufferString(`{"id":"admin-key-two","token":"admin-secret-two"}`), "admin-secret", http.StatusOK)
	serveAdminWithToken(t, srv, http.MethodDelete, "/admin/v1/tokens/admin-key", nil, "admin-secret-two", http.StatusOK)
	serveAdminWithToken(t, srv, http.MethodPatch, "/admin/v1/services/echo", bytes.NewBufferString(`{"name":"Echo Updated"}`), "admin-secret-two", http.StatusOK)
	serveAdminWithToken(t, srv, http.MethodPost, "/admin/v1/instances/echo-test/config", bytes.NewBufferString(`{"config":{"token":"config-secret"},"restart":false}`), "admin-secret-two", http.StatusOK)
	serveAdminWithToken(t, srv, http.MethodPost, "/admin/v1/instances/echo-test/secret", bytes.NewBufferString(`{"secret":{"apiToken":"instance-secret"},"restart":false}`), "admin-secret-two", http.StatusOK)
	serveAdminWithToken(t, srv, http.MethodPost, "/admin/v1/capsets", bytes.NewBufferString(`{"id":"dev","name":"Dev","enabled":true}`), "admin-secret-two", http.StatusOK)
	serveAdminWithToken(t, srv, http.MethodPatch, "/admin/v1/capsets/dev", bytes.NewBufferString(`{"enabled":false}`), "admin-secret-two", http.StatusOK)
	serveAdminWithToken(t, srv, http.MethodPatch, "/admin/v1/capsets/dev", bytes.NewBufferString(`{"enabled":true}`), "admin-secret-two", http.StatusOK)
	serveAdminWithToken(t, srv, http.MethodPost, "/admin/v1/capsets/dev/instances", bytes.NewBufferString(`{"instance_id":"echo-test","all_methods":false}`), "admin-secret-two", http.StatusOK)
	serveAdminWithToken(t, srv, http.MethodPost, "/admin/v1/capsets/dev/methods", bytes.NewBufferString(`{"instance_id":"echo-test","method":"echo.v1.EchoService/Echo","mcp_tool":"echo_tool"}`), "admin-secret-two", http.StatusOK)
	serveAdminWithToken(t, srv, http.MethodDelete, "/admin/v1/capsets/dev/methods?instance_id=echo-test&method=echo.v1.EchoService%2FEcho", nil, "admin-secret-two", http.StatusOK)
	serveAdminWithToken(t, srv, http.MethodPost, "/admin/v1/capsets/dev/tokens", bytes.NewBufferString(`{"id":"cap-key","token":"cap-secret"}`), "admin-secret-two", http.StatusOK)
	serveAdminWithToken(t, srv, http.MethodDelete, "/admin/v1/capsets/dev/tokens/cap-key", nil, "admin-secret-two", http.StatusOK)
	serveAdminWithToken(t, srv, http.MethodDelete, "/admin/v1/capsets/dev/instances/echo-test", nil, "admin-secret-two", http.StatusOK)
	serveAdminWithToken(t, srv, http.MethodDelete, "/admin/v1/capsets/dev", nil, "admin-secret-two", http.StatusOK)
	serveAdminWithToken(t, srv, http.MethodDelete, "/admin/v1/instances/echo-test", nil, "admin-secret-two", http.StatusOK)
	serveAdminWithToken(t, srv, http.MethodDelete, "/admin/v1/services/echo", nil, "admin-secret-two", http.StatusOK)
	serveAdminWithToken(t, srv, http.MethodDelete, "/admin/v1/tokens/admin-key-two", nil, "admin-secret-two", http.StatusOK)

	got := out.String()
	for _, want := range []string{
		"msg=admin_token_created token_id=admin-key",
		"msg=admin_token_created token_id=admin-key-two",
		"msg=admin_token_deleted token_id=admin-key",
		"msg=service_metadata_updated service_id=echo",
		"msg=instance_config_updated instance_id=echo-test config_sha256=",
		"msg=instance_secret_updated instance_id=echo-test secret_sha256=",
		"msg=capset_created capset_id=dev",
		"msg=capset_updated capset_id=dev enabled=false",
		"msg=capset_instance_added capset_id=dev instance_id=echo-test all_methods=false",
		"msg=capset_method_selected capset_id=dev instance_id=echo-test method=echo.v1.EchoService/Echo mcp_tool=echo_tool",
		"msg=capset_method_removed capset_id=dev instance_id=echo-test method=echo.v1.EchoService/Echo",
		"msg=capset_token_created capset_id=dev token_id=cap-key",
		"msg=capset_token_deleted capset_id=dev token_id=cap-key",
		"msg=capset_instance_removed capset_id=dev instance_id=echo-test",
		"msg=capset_deleted capset_id=dev",
		"msg=instance_delete instance_id=echo-test",
		"msg=service_deleted service_id=echo",
		"msg=admin_token_deleted token_id=admin-key-two",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("admin log missing %q in:\n%s", want, got)
		}
	}
	for _, forbidden := range []string{"admin-secret", "admin-secret-two", "config-secret", "instance-secret", "cap-secret", `{"token"`, `{"apiToken"`, "Authorization"} {
		if strings.Contains(got, forbidden) {
			t.Fatalf("admin log leaked %q in:\n%s", forbidden, got)
		}
	}
}

func TestAdminServiceImportAndRestartLogs(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	pkg := filepath.Join(root, "pkg")
	writeAdminGitPackage(t, pkg, `{"schema":"chaitin.octobus.service.v1","name":"echo","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	var out bytes.Buffer
	sup := supervisor.New(dataDir, st)
	srv := &Server{
		Store:      st,
		Importer:   &packageimport.Importer{DataDir: dataDir, Store: st},
		Supervisor: sup,
		Logger:     slog.New(slog.NewTextHandler(&out, &slog.HandlerOptions{Level: slog.LevelInfo})),
	}

	serveAdmin(t, srv, http.MethodPost, "/admin/v1/services/import", bytes.NewBufferString(fmt.Sprintf(`{"service_id":"echo","source":%q,"offline":true,"reinstall":true,"build":"never"}`, pkg)), http.StatusOK)
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-alpha", ServiceID: "echo", Name: "Alpha", Enabled: true, Status: domain.StatusStopped, NodeEntry: "echo", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/services/import", bytes.NewBufferString(fmt.Sprintf(`{"service_id":"echo","source":%q,"offline":true,"build":"never"}`, pkg)), http.StatusConflict)
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/services/import", bytes.NewBufferString(`{"service_id":"bad/id","source":"https://user:p%40ss@example.invalid/repo.git","offline":true}`), http.StatusBadRequest)

	got := out.String()
	for _, want := range []string{
		"msg=service_import_started service_id=echo offline=true reinstall=true build=never",
		"msg=service_import_done service_id=echo runtime_mode=long-running descriptor_sha256=",
		"method_count=1",
		"msg=service_instances_restart_started service_id=echo count=0",
		"msg=service_instances_restart_done service_id=echo restarted_count=0 failed_count=0",
		"msg=service_instances_restart_started service_id=echo count=1",
		"msg=service_instances_restart_failed service_id=echo failed_count=1",
		"msg=service_instances_restart_done service_id=echo restarted_count=0 failed_count=1",
		"msg=service_import_started service_id=bad/id offline=true reinstall=false build=\"\"",
		"msg=service_import_failed service_id=bad/id",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("service import log missing %q in:\n%s", want, got)
		}
	}
	for _, forbidden := range []string{"p@ss", "p%40ss", "https://user:"} {
		if strings.Contains(got, forbidden) {
			t.Fatalf("service import log leaked %q in:\n%s", forbidden, got)
		}
	}
}

func TestAdminRecursiveServiceImportValidation(t *testing.T) {
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := &Server{Store: st, Importer: fakeServiceImporter{}, Supervisor: supervisor.New(dataDir, st)}
	tests := []struct {
		name string
		body string
		want string
	}{
		{name: "missing source", body: `{"recursive":true}`, want: "service package source is required"},
		{name: "service id", body: `{"recursive":true,"service_id":"echo","source":"npm:pkg"}`, want: "service_id cannot be used with recursive import"},
		{name: "name", body: `{"recursive":true,"name":"Echo","source":"npm:pkg"}`, want: "name cannot be used with recursive import"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			body := serveAdmin(t, srv, http.MethodPost, "/admin/v1/services/import", bytes.NewBufferString(tc.body), http.StatusBadRequest)
			if !bytes.Contains(body, []byte(tc.want)) {
				t.Fatalf("body=%s want %q", body, tc.want)
			}
		})
	}
}

func TestAdminRecursiveServiceImportAggregatesResponse(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	services := []domain.Service{
		{ID: "alpha-service", Name: "Alpha", PackageSource: "fixture//alpha", PackageArtifactPath: "pkg-alpha", PackageSHA256: "pkgsha-alpha", DescriptorPath: "desc-alpha", DescriptorSHA256: "descsha-alpha", DescriptorVersion: "descsha-alpha", NodeEntry: "bin/alpha-service.js", RuntimeMode: domain.RuntimeModeLongRunning},
		{ID: "beta-service", Name: "Beta", PackageSource: "fixture//beta", PackageArtifactPath: "pkg-beta", PackageSHA256: "pkgsha-beta", DescriptorPath: "desc-beta", DescriptorSHA256: "descsha-beta", DescriptorVersion: "descsha-beta", NodeEntry: "bin/beta-service.js", RuntimeMode: domain.RuntimeModeOnDemand},
	}
	for _, svc := range services {
		if err := st.UpsertService(ctx, svc); err != nil {
			t.Fatal(err)
		}
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "beta-enabled", ServiceID: "beta-service", Name: "Beta Enabled", Enabled: true, Status: domain.StatusStopped, NodeEntry: "bin/beta-service.js", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	source := "npm:@chaitin-ai/octobus-tentacles"
	srv := &Server{
		Store:      st,
		Supervisor: supervisor.New(dataDir, st),
		Importer: fakeServiceImporter{importRecursiveFn: func(ctx context.Context, opts packageimport.Options) (packageimport.RecursiveResult, error) {
			if !opts.Recursive || opts.Source != source || opts.ServiceID != "" || opts.Name != "" {
				t.Fatalf("unexpected recursive options: %+v", opts)
			}
			return packageimport.RecursiveResult{Services: services, ServiceCount: len(services)}, nil
		}},
	}
	body := serveAdmin(t, srv, http.MethodPost, "/admin/v1/services/import", bytes.NewBufferString(fmt.Sprintf(`{"recursive":true,"source":%q,"offline":true,"build":"never"}`, source)), http.StatusOK)
	var got struct {
		Services           []domain.Service    `json:"services"`
		ServiceCount       int                 `json:"service_count"`
		RestartedInstances map[string][]string `json:"restarted_instances"`
		RestartErrors      map[string][]string `json:"restart_errors"`
	}
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatal(err)
	}
	if got.ServiceCount != 2 || len(got.Services) != 2 {
		t.Fatalf("unexpected recursive response: %+v", got)
	}
	for _, id := range []string{"alpha-service", "beta-service"} {
		if got.RestartedInstances[id] == nil || len(got.RestartedInstances[id]) != 0 {
			t.Fatalf("restarted_instances[%s]=%v", id, got.RestartedInstances[id])
		}
		if got.RestartErrors[id] == nil || len(got.RestartErrors[id]) != 0 {
			t.Fatalf("restart_errors[%s]=%v", id, got.RestartErrors[id])
		}
	}
}

func TestAdminRecursiveServiceImportDegradedOnRestartFailure(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	service := domain.Service{ID: "alpha-service", Name: "Alpha", PackageSource: "fixture//alpha", PackageArtifactPath: "pkg-alpha", PackageSHA256: "pkgsha-alpha", DescriptorPath: "desc-alpha", DescriptorSHA256: "descsha-alpha", DescriptorVersion: "descsha-alpha", NodeEntry: "bin/alpha-service.js", RuntimeMode: domain.RuntimeModeLongRunning}
	if err := st.UpsertService(ctx, service); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "alpha-enabled", ServiceID: "alpha-service", Name: "Alpha Enabled", Enabled: true, Status: domain.StatusStopped, NodeEntry: "bin/alpha-service.js", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	srv := &Server{
		Store:      st,
		Supervisor: supervisor.New(dataDir, st),
		Importer: fakeServiceImporter{importRecursiveFn: func(ctx context.Context, opts packageimport.Options) (packageimport.RecursiveResult, error) {
			return packageimport.RecursiveResult{Services: []domain.Service{service}, ServiceCount: 1}, nil
		}},
	}
	body := serveAdmin(t, srv, http.MethodPost, "/admin/v1/services/import", bytes.NewBufferString(`{"recursive":true,"source":"npm:fixture","offline":true,"build":"never"}`), http.StatusConflict)
	var got struct {
		Status             string              `json:"status"`
		RestartedInstances map[string][]string `json:"restarted_instances"`
		RestartErrors      map[string][]string `json:"restart_errors"`
	}
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatal(err)
	}
	if got.Status != "degraded" || len(got.RestartErrors["alpha-service"]) == 0 {
		t.Fatalf("unexpected degraded response: %+v body=%s", got, body)
	}
	if len(got.RestartedInstances["alpha-service"]) != 0 {
		t.Fatalf("unexpected restarted instances: %+v", got.RestartedInstances)
	}
}

func TestAdminRecursiveServiceImportLogsDoNotLeakSourceCredentials(t *testing.T) {
	var out bytes.Buffer
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	service := domain.Service{ID: "alpha-service", Name: "Alpha", PackageSource: "https://user:******@example.com/repo.git//alpha", PackageArtifactPath: "pkg-alpha", PackageSHA256: "pkgsha-alpha", DescriptorPath: "desc-alpha", DescriptorSHA256: "descsha-alpha", DescriptorVersion: "descsha-alpha", NodeEntry: "bin/alpha-service.js", RuntimeMode: domain.RuntimeModeOnDemand}
	srv := &Server{
		Store: st,
		Importer: fakeServiceImporter{importRecursiveFn: func(ctx context.Context, opts packageimport.Options) (packageimport.RecursiveResult, error) {
			return packageimport.RecursiveResult{Services: []domain.Service{service}, ServiceCount: 1}, nil
		}},
		Logger: slog.New(slog.NewTextHandler(&out, &slog.HandlerOptions{Level: slog.LevelInfo})),
	}
	source := "https://user:p%40ss@example.com/repo.git"
	body := serveAdmin(t, srv, http.MethodPost, "/admin/v1/services/import", bytes.NewBufferString(fmt.Sprintf(`{"recursive":true,"source":%q,"offline":true}`, source)), http.StatusOK)
	for _, leaked := range []string{"p%40ss", "p@ss", "https://user:p"} {
		if bytes.Contains(body, []byte(leaked)) {
			t.Fatalf("recursive import response leaked %q: %s", leaked, body)
		}
		if strings.Contains(out.String(), leaked) {
			t.Fatalf("recursive import logs leaked %q: %s", leaked, out.String())
		}
	}
	if !bytes.Contains(body, []byte("******")) {
		t.Fatalf("recursive import response did not include redacted source: %s", body)
	}
}

func TestAdminMethodAndValidationBoundaries(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	service := domain.Service{
		ID:                  "echo",
		Name:                "Echo",
		PackageSource:       "fixture",
		PackageArtifactPath: "pkg",
		PackageSHA256:       "pkgsha",
		DescriptorPath:      "desc",
		DescriptorSHA256:    "descsha",
		DescriptorVersion:   "descsha",
		NodeEntry:           "echo",
		Methods: []domain.Method{
			{FullName: "echo.v1.EchoService/Echo", ServiceFullName: "echo.v1.EchoService", Name: "Echo", Unary: true},
			{FullName: "echo.v1.EchoService/Stream", ServiceFullName: "echo.v1.EchoService", Name: "Stream", ServerStreaming: true},
		},
	}
	if err := st.UpsertService(ctx, service); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: false, Status: domain.StatusStopped, NodeEntry: "echo", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	srv := &Server{Store: st, Importer: &packageimport.Importer{DataDir: dataDir, Store: st}, Supervisor: supervisor.New(dataDir, st), Gateway: &protocol.Gateway{Store: st}}

	serveAdmin(t, srv, http.MethodPost, "/admin/v1/services/echo", nil, http.StatusMethodNotAllowed)
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/status", nil, http.StatusMethodNotAllowed)
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/services", nil, http.StatusMethodNotAllowed)
	serveAdmin(t, srv, http.MethodPatch, "/admin/v1/services/echo", bytes.NewBufferString(`{"name":""}`), http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodGet, "/admin/v1/services/missing", nil, http.StatusNotFound)
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/services/import", bytes.NewBufferString(`{}`), http.StatusBadRequest)

	serveAdmin(t, srv, http.MethodPut, "/admin/v1/instances", nil, http.StatusMethodNotAllowed)
	serveAdmin(t, srv, http.MethodPatch, "/admin/v1/instances/echo-test", bytes.NewBufferString(`{"name":""}`), http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodPatch, "/admin/v1/instances/missing", bytes.NewBufferString(`{"name":"x"}`), http.StatusNotFound)
	serveAdmin(t, srv, http.MethodGet, "/admin/v1/instances/echo-test/restart", nil, http.StatusMethodNotAllowed)
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/instances/echo-test/unknown", nil, http.StatusNotFound)
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/instances/echo-test/config", bytes.NewBufferString(`{"config":{}`), http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/instances/echo-test/secret", bytes.NewBufferString(`{"secret":{}`), http.StatusBadRequest)

	serveAdmin(t, srv, http.MethodPut, "/admin/v1/capsets", nil, http.StatusMethodNotAllowed)
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/capsets", bytes.NewBufferString(`{"id":"qa","name":"QA","enabled":false}`), http.StatusOK)
	created, err := st.GetCapset(ctx, "qa")
	if err != nil {
		t.Fatal(err)
	}
	if !created.Enabled {
		t.Fatal("created capset should default to enabled")
	}
	serveAdmin(t, srv, http.MethodGet, "/admin/v1/capsets/missing", nil, http.StatusNotFound)
	serveAdmin(t, srv, http.MethodPatch, "/admin/v1/capsets/dev", bytes.NewBufferString(`{"name":""}`), http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodPut, "/admin/v1/capsets/dev", nil, http.StatusMethodNotAllowed)
	serveAdmin(t, srv, http.MethodGet, "/admin/v1/capsets/dev/instances", nil, http.StatusOK)
	serveAdmin(t, srv, http.MethodDelete, "/admin/v1/capsets/dev/instances", nil, http.StatusMethodNotAllowed)
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/capsets/dev/instances", bytes.NewBufferString(`{"instance_id":"echo-test","all_methods":true}`), http.StatusOK)
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/capsets/dev/methods", bytes.NewBufferString(`{"instance_id":"echo-test","method":"echo.v1.EchoService/Missing"}`), http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodPut, "/admin/v1/capsets/dev/methods", nil, http.StatusMethodNotAllowed)
	serveAdmin(t, srv, http.MethodDelete, "/admin/v1/capsets/dev/methods", nil, http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodPut, "/admin/v1/capsets/dev/tokens", nil, http.StatusMethodNotAllowed)
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/capsets/dev/tokens", bytes.NewBufferString(`{"id":"key"}`), http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/capsets/missing/tokens", bytes.NewBufferString(`{"id":"key","token":"secret"}`), http.StatusNotFound)
	serveAdmin(t, srv, http.MethodGet, "/admin/v1/capsets/dev/tokens/key", nil, http.StatusMethodNotAllowed)
	serveAdmin(t, srv, http.MethodDelete, "/admin/v1/capsets/dev/tokens/missing", nil, http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodPatch, "/admin/v1/capsets/dev/instances/echo-test", nil, http.StatusMethodNotAllowed)
	serveAdmin(t, srv, http.MethodGet, "/admin/v1/capsets/dev/unknown", nil, http.StatusNotFound)
}

func TestAdminRoutesCoverAdditionalSuccessBranches(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	service := domain.Service{
		ID:                  "echo",
		Name:                "Echo",
		PackageSource:       "fixture",
		PackageArtifactPath: "pkg",
		PackageSHA256:       "pkgsha",
		DescriptorPath:      "desc",
		DescriptorSHA256:    "descsha",
		DescriptorVersion:   "descsha",
		NodeEntry:           "echo",
		Methods: []domain.Method{
			{FullName: "echo.v1.EchoService/Echo", ServiceFullName: "echo.v1.EchoService", Name: "Echo", Unary: true},
			{FullName: "echo.v1.EchoService/Stream", ServiceFullName: "echo.v1.EchoService", Name: "Stream", ServerStreaming: true},
		},
	}
	if err := st.UpsertService(ctx, service); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: false, Status: domain.StatusStopped, NodeEntry: "echo", ConfigJSON: []byte(`{}`), SecretJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	srv := &Server{Store: st, Supervisor: supervisor.New(dataDir, st)}

	body := serveAdmin(t, srv, http.MethodPost, "/admin/v1/instances", bytes.NewBufferString(`{"id":"created","service_id":"echo","name":"","config":{},"secret":{},"start":false}`), http.StatusOK)
	if !bytes.Contains(body, []byte(`"ID":"created"`)) || !bytes.Contains(body, []byte(`"Name":"created"`)) {
		t.Fatalf("created instance body=%s", body)
	}
	body = serveAdmin(t, srv, http.MethodGet, "/admin/v1/instances", nil, http.StatusOK)
	if !bytes.Contains(body, []byte(`"instances"`)) || !bytes.Contains(body, []byte(`"created"`)) {
		t.Fatalf("instances body=%s", body)
	}

	body = serveAdmin(t, srv, http.MethodPost, "/admin/v1/capsets", bytes.NewBufferString(`{"id":"dev","name":"Dev"}`), http.StatusOK)
	if !bytes.Contains(body, []byte(`"Enabled":true`)) {
		t.Fatalf("capset create body=%s", body)
	}
	var capset domain.Capset
	if err := json.Unmarshal(body, &capset); err != nil {
		t.Fatal(err)
	}
	if capset.CreatedAt.IsZero() || capset.UpdatedAt.IsZero() {
		t.Fatalf("capset create response has zero timestamps: %s", body)
	}
	body = serveAdmin(t, srv, http.MethodGet, "/admin/v1/capsets", nil, http.StatusOK)
	if !bytes.Contains(body, []byte(`"capsets"`)) {
		t.Fatalf("capsets body=%s", body)
	}
	body = serveAdmin(t, srv, http.MethodPatch, "/admin/v1/capsets/dev", bytes.NewBufferString(`{"description":"updated","enabled":false}`), http.StatusOK)
	if !bytes.Contains(body, []byte(`"Description":"updated"`)) || !bytes.Contains(body, []byte(`"Enabled":false`)) {
		t.Fatalf("capset patch body=%s", body)
	}
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/capsets/dev/instances", bytes.NewBufferString(`{"instance_id":"echo-test","all_methods":true,"no_all_methods":true}`), http.StatusOK)
	methods := serveAdmin(t, srv, http.MethodGet, "/admin/v1/capsets/dev/methods", nil, http.StatusOK)
	if bytes.Contains(methods, []byte("echo.v1.EchoService/Echo")) {
		t.Fatalf("no_all_methods should skip method insertion: %s", methods)
	}
	body = serveAdmin(t, srv, http.MethodPost, "/admin/v1/capsets/dev/methods", bytes.NewBufferString(`{"instance_id":"echo-test","method":"/echo.v1.EchoService/Stream","mcp_tool":"ignored"}`), http.StatusOK)
	if !bytes.Contains(body, []byte(`"method":"echo.v1.EchoService/Stream"`)) || !bytes.Contains(body, []byte(`"mcp_tool":""`)) {
		t.Fatalf("streaming method body=%s", body)
	}
	serveAdmin(t, srv, http.MethodDelete, "/admin/v1/capsets/dev/instances/echo-test", nil, http.StatusOK)
	serveAdmin(t, srv, http.MethodDelete, "/admin/v1/capsets/dev", nil, http.StatusOK)
	serveAdmin(t, srv, http.MethodDelete, "/admin/v1/instances/created", nil, http.StatusOK)
	serveAdmin(t, srv, http.MethodDelete, "/admin/v1/instances/echo-test", nil, http.StatusOK)
	serveAdmin(t, srv, http.MethodDelete, "/admin/v1/services/echo", nil, http.StatusOK)
}

func TestAdminAdditionalErrorBranches(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	service := domain.Service{
		ID:                  "echo",
		Name:                "Echo",
		PackageSource:       "fixture",
		PackageArtifactPath: "pkg",
		PackageSHA256:       "pkgsha",
		DescriptorPath:      "desc",
		DescriptorSHA256:    "descsha",
		DescriptorVersion:   "descsha",
		NodeEntry:           "echo",
		Methods: []domain.Method{
			{FullName: "echo.v1.EchoService/Echo", ServiceFullName: "echo.v1.EchoService", Name: "Echo", Unary: true},
			{FullName: "echo.v1.EchoService/Stream", ServiceFullName: "echo.v1.EchoService", Name: "Stream", ServerStreaming: true},
		},
	}
	if err := st.UpsertService(ctx, service); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertService(ctx, domain.Service{ID: "other", Name: "Other", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "other"}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: false, Status: domain.StatusStopped, NodeEntry: "echo", ConfigJSON: []byte(`{}`), SecretJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "other-test", ServiceID: "other", Name: "Other Test", Enabled: false, Status: domain.StatusStopped, NodeEntry: "other", ConfigJSON: []byte(`{}`), SecretJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	srv := &Server{Store: st, Supervisor: supervisor.New(dataDir, st)}

	serveAdmin(t, srv, http.MethodPatch, "/admin/v1/services/echo", bytes.NewBufferString(`{`), http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodDelete, "/admin/v1/services/missing", nil, http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/instances", bytes.NewBufferString(`{`), http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/instances", bytes.NewBufferString(`{"id":"bad/id","service_id":"echo"}`), http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodGet, "/admin/v1/instances/missing", nil, http.StatusNotFound)
	serveAdmin(t, srv, http.MethodPatch, "/admin/v1/instances/echo-test", bytes.NewBufferString(`{`), http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodDelete, "/admin/v1/instances/missing", nil, http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodGet, "/admin/v1/instances/echo-test/start", nil, http.StatusMethodNotAllowed)

	serveAdmin(t, srv, http.MethodPost, "/admin/v1/capsets", bytes.NewBufferString(`{`), http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/capsets", bytes.NewBufferString(`{"id":"bad/id","name":"Bad"}`), http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodPatch, "/admin/v1/capsets/dev", bytes.NewBufferString(`{`), http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodPatch, "/admin/v1/capsets/missing", bytes.NewBufferString(`{"name":"Missing"}`), http.StatusNotFound)
	serveAdmin(t, srv, http.MethodDelete, "/admin/v1/capsets/missing", nil, http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/capsets/dev/instances", bytes.NewBufferString(`{`), http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/capsets/dev/instances", bytes.NewBufferString(`{"instance_id":"missing","all_methods":true}`), http.StatusNotFound)
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/capsets/dev/instances", bytes.NewBufferString(`{"instance_id":"echo-test","all_methods":true}`), http.StatusOK)
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/capsets/dev/instances", bytes.NewBufferString(`{"instance_id":"echo-test","all_methods":true}`), http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodDelete, "/admin/v1/capsets/dev/instances/missing", nil, http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/capsets/dev/methods", bytes.NewBufferString(`{`), http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/capsets/dev/methods", bytes.NewBufferString(`{"instance_id":"missing","method":"echo.v1.EchoService/Echo"}`), http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/capsets/dev/methods", bytes.NewBufferString(`{"instance_id":"echo-test","method":"echo.v1.EchoService/Echo"}`), http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodDelete, "/admin/v1/capsets/dev/methods?instance_id=echo-test&method=echo.v1.EchoService%2FMissing", nil, http.StatusBadRequest)
}

func TestAdminDirectHandlerBranches(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	service := domain.Service{
		ID:                  "echo",
		Name:                "Echo",
		PackageSource:       "fixture",
		PackageArtifactPath: "pkg",
		PackageSHA256:       "pkgsha",
		DescriptorPath:      "desc",
		DescriptorSHA256:    "descsha",
		DescriptorVersion:   "descsha",
		NodeEntry:           "echo",
		Methods:             []domain.Method{{FullName: "echo.v1.EchoService/Echo", ServiceFullName: "echo.v1.EchoService", Name: "Echo", Unary: true}},
	}
	if err := st.UpsertService(ctx, service); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: false, Status: domain.StatusStopped, NodeEntry: "echo", ConfigJSON: []byte(`{}`), SecretJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	srv := &Server{Store: st, Supervisor: supervisor.New(dataDir, st), Gateway: &protocol.Gateway{Store: st}}

	call := func(fn func(http.ResponseWriter, *http.Request), method, path string, want int) []byte {
		t.Helper()
		w := httptest.NewRecorder()
		fn(w, httptest.NewRequest(method, path, nil))
		if w.Code != want {
			t.Fatalf("%s %s status=%d body=%s want %d", method, path, w.Code, w.Body.String(), want)
		}
		return w.Body.Bytes()
	}
	call(func(w http.ResponseWriter, r *http.Request) { srv.handleCatalog(w, r, "dev") }, http.MethodPost, "/admin/v1/catalog/dev", http.StatusMethodNotAllowed)
	call(func(w http.ResponseWriter, r *http.Request) { srv.handleCatalog(w, r, "dev") }, http.MethodGet, "/admin/v1/catalog/dev?grpc=maybe", http.StatusBadRequest)
	call(func(w http.ResponseWriter, r *http.Request) { srv.handleCatalogOpenAPI(w, r, "dev", "json") }, http.MethodPost, "/admin/v1/catalog/dev/openapi.json", http.StatusMethodNotAllowed)
	call(func(w http.ResponseWriter, r *http.Request) { srv.handleStatus(w, r) }, http.MethodPost, "/admin/v1/status", http.StatusMethodNotAllowed)
	call(func(w http.ResponseWriter, r *http.Request) { srv.handleServiceImport(w, r) }, http.MethodGet, "/admin/v1/services/import", http.StatusMethodNotAllowed)
	call(func(w http.ResponseWriter, r *http.Request) { srv.handleServices(w, r) }, http.MethodPost, "/admin/v1/services", http.StatusMethodNotAllowed)
	call(func(w http.ResponseWriter, r *http.Request) { srv.handleServicePath(w, r, "") }, http.MethodGet, "/admin/v1/services/", http.StatusNotFound)
	call(func(w http.ResponseWriter, r *http.Request) { srv.handleInstancePath(w, r, "", "") }, http.MethodGet, "/admin/v1/instances/", http.StatusNotFound)
	call(func(w http.ResponseWriter, r *http.Request) { srv.handleInstancePath(w, r, "echo-test", "") }, http.MethodPut, "/admin/v1/instances/echo-test", http.StatusMethodNotAllowed)
	call(func(w http.ResponseWriter, r *http.Request) { srv.handleInstancePath(w, r, "echo-test", "start") }, http.MethodGet, "/admin/v1/instances/echo-test/start", http.StatusMethodNotAllowed)
	call(func(w http.ResponseWriter, r *http.Request) { srv.handleCapsetPath(w, r, "dev", "", "") }, http.MethodPut, "/admin/v1/capsets/dev", http.StatusMethodNotAllowed)
	call(func(w http.ResponseWriter, r *http.Request) { srv.handleCapsetPath(w, r, "dev", "instances", "") }, http.MethodPut, "/admin/v1/capsets/dev/instances", http.StatusMethodNotAllowed)
	call(func(w http.ResponseWriter, r *http.Request) {
		srv.handleCapsetPath(w, r, "dev", "instances", "echo-test")
	}, http.MethodGet, "/admin/v1/capsets/dev/instances/echo-test", http.StatusMethodNotAllowed)
	call(func(w http.ResponseWriter, r *http.Request) { srv.handleCapsetPath(w, r, "dev", "methods", "") }, http.MethodPut, "/admin/v1/capsets/dev/methods", http.StatusMethodNotAllowed)
	call(func(w http.ResponseWriter, r *http.Request) { srv.handleCapsetPath(w, r, "dev", "unknown", "") }, http.MethodGet, "/admin/v1/capsets/dev/unknown", http.StatusNotFound)

	// Cover successful direct branches that are otherwise hidden behind route helpers.
	call(func(w http.ResponseWriter, r *http.Request) { srv.handleServicePath(w, r, "echo") }, http.MethodGet, "/admin/v1/services/echo", http.StatusOK)
	call(func(w http.ResponseWriter, r *http.Request) { srv.handleCapsetPath(w, r, "dev", "", "") }, http.MethodGet, "/admin/v1/capsets/dev", http.StatusOK)
	call(func(w http.ResponseWriter, r *http.Request) { srv.handleCapsetPath(w, r, "dev", "instances", "") }, http.MethodGet, "/admin/v1/capsets/dev/instances", http.StatusOK)
}

func TestAdminCapsetTokenRoutes(t *testing.T) {
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
	srv := &Server{Store: st}

	body := serveAdmin(t, srv, http.MethodGet, "/admin/v1/capsets/dev/tokens", nil, http.StatusOK)
	if !bytes.Contains(body, []byte(`"tokens":null`)) {
		t.Fatalf("empty tokens body=%s", body)
	}
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/capsets/dev/tokens", bytes.NewBufferString(`{`), http.StatusBadRequest)
	body = serveAdmin(t, srv, http.MethodPost, "/admin/v1/capsets/dev/tokens", bytes.NewBufferString(`{"id":"key","token":"secret"}`), http.StatusOK)
	if bytes.Contains(body, []byte("secret")) || !bytes.Contains(body, []byte(`"Name":"key"`)) {
		t.Fatalf("created token response=%s", body)
	}
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/capsets/dev/tokens", bytes.NewBufferString(`{"id":"key","token":"secret"}`), http.StatusBadRequest)
	body = serveAdmin(t, srv, http.MethodGet, "/admin/v1/capsets/dev/tokens", nil, http.StatusOK)
	if bytes.Contains(body, []byte("secret")) || !bytes.Contains(body, []byte(domain.CapsetTokenHash("secret"))) {
		t.Fatalf("listed token response=%s", body)
	}
	serveAdmin(t, srv, http.MethodDelete, "/admin/v1/capsets/dev/tokens/key", nil, http.StatusOK)
	body = serveAdmin(t, srv, http.MethodGet, "/admin/v1/capsets/dev/tokens", nil, http.StatusOK)
	if bytes.Contains(body, []byte("key")) {
		t.Fatalf("deleted token still listed: %s", body)
	}
}

func TestAdminTokenRoutesAndAuthorization(t *testing.T) {
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
	srv := &Server{Store: st}

	body := serveAdmin(t, srv, http.MethodGet, "/admin/v1/tokens", nil, http.StatusOK)
	if !bytes.Contains(body, []byte(`"tokens":null`)) {
		t.Fatalf("empty admin tokens body=%s", body)
	}
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/tokens", bytes.NewBufferString(`{`), http.StatusBadRequest)
	body = serveAdmin(t, srv, http.MethodPost, "/admin/v1/tokens", bytes.NewBufferString(`{"id":"key-one","name":"Primary","token":"secret-one"}`), http.StatusOK)
	if bytes.Contains(body, []byte("secret-one")) || !bytes.Contains(body, []byte(`"Name":"Primary"`)) {
		t.Fatalf("created admin token response=%s", body)
	}

	serveAdmin(t, srv, http.MethodGet, "/admin/v1/status", nil, http.StatusOK)
	serveAdmin(t, srv, http.MethodGet, "/admin/v1/capsets", nil, http.StatusUnauthorized)
	serveAdminWithToken(t, srv, http.MethodGet, "/admin/v1/capsets", nil, "wrong", http.StatusUnauthorized)
	serveAdminWithToken(t, srv, http.MethodGet, "/admin/v1/capsets", nil, "secret-one", http.StatusOK)

	body = serveAdminWithToken(t, srv, http.MethodGet, "/admin/v1/tokens/key-one", nil, "secret-one", http.StatusOK)
	if bytes.Contains(body, []byte("secret-one")) || !bytes.Contains(body, []byte(domain.AdminTokenHash("secret-one"))) {
		t.Fatalf("admin token get response=%s", body)
	}
	if token, err := st.GetAdminToken(ctx, "key-one"); err != nil {
		t.Fatal(err)
	} else if token.LastUsedAt.IsZero() {
		t.Fatalf("authorization did not update last used: %+v", token)
	}
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/tokens", bytes.NewBufferString(`{"id":"key-two","token":"secret-two"}`), http.StatusUnauthorized)
	serveAdminWithToken(t, srv, http.MethodPost, "/admin/v1/tokens", bytes.NewBufferString(`{"id":"key-two","token":"secret-two"}`), "secret-one", http.StatusOK)
	body = serveAdminWithToken(t, srv, http.MethodGet, "/admin/v1/tokens", nil, "secret-two", http.StatusOK)
	if bytes.Contains(body, []byte("secret-two")) || !bytes.Contains(body, []byte(`"ID":"key-two"`)) {
		t.Fatalf("admin token list response=%s", body)
	}

	serveAdminWithToken(t, srv, http.MethodDelete, "/admin/v1/tokens/key-one", nil, "secret-two", http.StatusOK)
	serveAdminWithToken(t, srv, http.MethodGet, "/admin/v1/capsets", nil, "secret-one", http.StatusUnauthorized)
	serveAdminWithToken(t, srv, http.MethodDelete, "/admin/v1/tokens/key-two", nil, "secret-two", http.StatusOK)
	serveAdmin(t, srv, http.MethodGet, "/admin/v1/capsets", nil, http.StatusOK)
}

func TestAdminTokenRouteBoundaries(t *testing.T) {
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := &Server{Store: st}

	serveAdmin(t, srv, http.MethodPut, "/admin/v1/tokens", nil, http.StatusMethodNotAllowed)
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/tokens", bytes.NewBufferString(`{"id":"key"}`), http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodGet, "/admin/v1/tokens/missing", nil, http.StatusNotFound)
	serveAdmin(t, srv, http.MethodPatch, "/admin/v1/tokens/missing", nil, http.StatusMethodNotAllowed)
	serveAdmin(t, srv, http.MethodDelete, "/admin/v1/tokens/missing", nil, http.StatusBadRequest)
}

func TestAdminStoreErrorsReturnInternalStatus(t *testing.T) {
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	srv := &Server{Store: st, Supervisor: supervisor.New(dataDir, st)}
	if err := st.Close(); err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		name string
		path string
	}{
		{name: "status", path: "/admin/v1/status"},
		{name: "admin tokens", path: "/admin/v1/tokens"},
		{name: "services", path: "/admin/v1/services"},
		{name: "instances", path: "/admin/v1/instances"},
		{name: "capsets", path: "/admin/v1/capsets"},
		{name: "capset instances", path: "/admin/v1/capsets/dev/instances"},
		{name: "capset methods", path: "/admin/v1/capsets/dev/methods"},
		{name: "capset tokens", path: "/admin/v1/capsets/dev/tokens"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := serveAdmin(t, srv, http.MethodGet, tc.path, nil, http.StatusInternalServerError)
			if !bytes.Contains(body, []byte("database is closed")) {
				t.Fatalf("body=%s", body)
			}
		})
	}
}

func TestAdminInstanceActionsSuccessAndServiceDeleteInUse(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "missing-entry"}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: false, Status: domain.StatusStopped, NodeEntry: "missing-entry", ConfigJSON: []byte(`{}`), SecretJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	srv := &Server{Store: st, Supervisor: supervisor.New(dataDir, st)}

	serveAdmin(t, srv, http.MethodPost, "/admin/v1/instances/echo-test/config", bytes.NewBufferString(`{"config":{"token":"next"},"restart":false}`), http.StatusOK)
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/instances/echo-test/secret", bytes.NewBufferString(`{"secret":{"apiToken":"next"},"restart":false}`), http.StatusOK)
	body := serveAdmin(t, srv, http.MethodPost, "/admin/v1/instances/echo-test/restart", nil, http.StatusOK)
	if !bytes.Contains(body, []byte(`"Status":"stopped"`)) {
		t.Fatalf("restart disabled body=%s", body)
	}
	serveAdmin(t, srv, http.MethodDelete, "/admin/v1/services/echo", nil, http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodDelete, "/admin/v1/instances/echo-test", nil, http.StatusOK)
	serveAdmin(t, srv, http.MethodDelete, "/admin/v1/services/echo", nil, http.StatusOK)
}

func TestAdminCatalogGatewayRequired(t *testing.T) {
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := &Server{Store: st}
	serveAdmin(t, srv, http.MethodGet, "/admin/v1/catalog/dev", nil, http.StatusInternalServerError)
	serveAdmin(t, srv, http.MethodGet, "/admin/v1/catalog/dev/openapi.json", nil, http.StatusInternalServerError)
	serveAdmin(t, srv, http.MethodPost, "/admin/v1/catalog/dev", nil, http.StatusMethodNotAllowed)
}

func TestAdminRestartEnabledServiceInstancesSummaries(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	service := domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "missing-entry"}
	if err := st.UpsertService(ctx, service); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"alpha", "beta"} {
		if err := st.UpsertInstance(ctx, domain.Instance{ID: id, ServiceID: "echo", Name: id, Enabled: true, Status: domain.StatusStopped, NodeEntry: "missing-entry", ConfigJSON: []byte(`{}`)}); err != nil {
			t.Fatal(err)
		}
	}
	srv := &Server{Store: st, Supervisor: supervisor.New(dataDir, st)}
	restarted, restartErrs := srv.restartEnabledServiceInstances(ctx, "echo")
	if len(restarted) != 0 || len(restartErrs) != 2 {
		t.Fatalf("restart summary restarted=%v errors=%v", restarted, restartErrs)
	}
	if !strings.Contains(restartErrs[0], "alpha:") || !strings.Contains(restartErrs[1], "beta:") {
		t.Fatalf("restart errors not ordered by instance: %v", restartErrs)
	}

	service.RuntimeMode = domain.RuntimeModeOnDemand
	if err := st.UpsertService(ctx, service); err != nil {
		t.Fatal(err)
	}
	restarted, restartErrs = srv.restartEnabledServiceInstances(ctx, "echo")
	if len(restarted) != 0 || len(restartErrs) != 0 {
		t.Fatalf("on-demand restart summary restarted=%v errors=%v", restarted, restartErrs)
	}
	if restarted, restartErrs := srv.restartEnabledServiceInstances(ctx, "missing"); restarted != nil || len(restartErrs) != 1 {
		t.Fatalf("missing service restart summary restarted=%v errors=%v", restarted, restartErrs)
	}
	if restarted, restartErrs := (&Server{Store: st}).restartEnabledServiceInstances(ctx, "echo"); restarted != nil || restartErrs != nil {
		t.Fatalf("nil supervisor restart summary restarted=%v errors=%v", restarted, restartErrs)
	}
}

func TestListenAndServeStopsWhenContextCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	errc := make(chan error, 1)
	go func() {
		errc <- ListenAndServe(ctx, "127.0.0.1:0", http.NotFoundHandler())
	}()
	time.Sleep(50 * time.Millisecond)
	cancel()
	select {
	case err := <-errc:
		if err != nil {
			t.Fatalf("ListenAndServe returned error: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("ListenAndServe did not stop after context cancellation")
	}
	if err := ListenAndServe(context.Background(), "bad-address", http.NotFoundHandler()); err == nil {
		t.Fatal("expected listen error for bad address")
	}
}

func TestCapsetAddInstanceMissingCapsetReturnsNotFound(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "echo", Methods: []domain.Method{{FullName: "echo.v1.EchoService/Echo", Unary: true}}}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: true, Status: domain.StatusStopped, NodeEntry: "echo", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	srv := &Server{Store: st, Supervisor: supervisor.New(dataDir, st)}

	body := serveAdmin(t, srv, http.MethodPost, "/admin/v1/capsets/missing/instances", bytes.NewBufferString(`{"instance_id":"echo-test","all_methods":true}`), http.StatusNotFound)
	if !bytes.Contains(body, []byte("capset not found")) {
		t.Fatalf("missing capset body=%s", body)
	}
	if bytes.Contains(body, []byte("FOREIGN KEY constraint failed")) {
		t.Fatalf("leaked storage constraint error: %s", body)
	}
}

func TestCapsetAddInstanceMissingInstanceReturnsNotFound(t *testing.T) {
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
	srv := &Server{Store: st, Supervisor: supervisor.New(dataDir, st)}

	body := serveAdmin(t, srv, http.MethodPost, "/admin/v1/capsets/dev/instances", bytes.NewBufferString(`{"instance_id":"missing","all_methods":true}`), http.StatusNotFound)
	if !bytes.Contains(body, []byte("instance not found")) {
		t.Fatalf("body=%s", body)
	}
}

func TestOnDemandRuntimeControlRoutesRejectPersistentActions(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "echo", RuntimeMode: domain.RuntimeModeOnDemand, Methods: []domain.Method{{FullName: "echo.v1.EchoService/Echo", Unary: true}}}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: true, Status: domain.StatusRunning, NodeEntry: "echo", ConfigJSON: []byte(`{}`), SecretJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	srv := &Server{Store: st, Supervisor: supervisor.New(dataDir, st)}

	for _, tc := range []struct {
		path string
		body string
	}{
		{path: "/admin/v1/instances/echo-test/start", body: `{}`},
		{path: "/admin/v1/instances/echo-test/stop", body: `{}`},
		{path: "/admin/v1/instances/echo-test/restart", body: `{}`},
		{path: "/admin/v1/instances/echo-test/config", body: `{"config":{},"restart":true}`},
		{path: "/admin/v1/instances/echo-test/secret", body: `{"secret":{},"restart":true}`},
	} {
		body := serveAdmin(t, srv, http.MethodPost, tc.path, bytes.NewBufferString(tc.body), http.StatusBadRequest)
		if !bytes.Contains(body, []byte(supervisor.ErrUnsupportedRuntimeControl.Error())) {
			t.Fatalf("%s body=%s", tc.path, body)
		}
	}
}

func TestServiceRoutesIncludeRuntimeMode(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "echo", RuntimeMode: domain.RuntimeModeOnDemand}); err != nil {
		t.Fatal(err)
	}
	srv := &Server{Store: st, Supervisor: supervisor.New(dataDir, st)}

	for _, path := range []string{"/admin/v1/services", "/admin/v1/services/echo"} {
		body := serveAdmin(t, srv, http.MethodGet, path, nil, http.StatusOK)
		if !bytes.Contains(body, []byte(`"RuntimeMode":"on-demand"`)) {
			t.Fatalf("%s did not include runtime mode: %s", path, body)
		}
	}
}

func TestCatalogRoutesValidationAndFormats(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Description: "tools", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	srv := &Server{Store: st, Gateway: &protocol.Gateway{Store: st}}

	body := serveAdmin(t, srv, http.MethodGet, "/admin/v1/catalog/dev", nil, http.StatusOK)
	if !bytes.Contains(body, []byte(`"grpc"`)) || bytes.Contains(body, []byte(`"methods"`)) || bytes.Contains(body, []byte(`"rest"`)) {
		t.Fatalf("unexpected default catalog body=%s", body)
	}
	body = serveAdmin(t, srv, http.MethodGet, "/admin/v1/catalog/dev?all=true&format=md", nil, http.StatusOK)
	if !bytes.Contains(body, []byte("## gRPC")) || !bytes.Contains(body, []byte("## MCP")) || !bytes.Contains(body, []byte("## Connect RPC")) {
		t.Fatalf("unexpected markdown catalog=%s", body)
	}
	for _, want := range []string{
		"## Schema Discovery",
		"use server reflection with `x-octobus-capset=dev` metadata",
		"call `tools/list` on the table `Endpoint`",
		"POST JSON to the table `Endpoint` path",
	} {
		if !bytes.Contains(body, []byte(want)) {
			t.Fatalf("markdown catalog missing %q: %s", want, body)
		}
	}
	body = serveAdmin(t, srv, http.MethodGet, "/admin/v1/catalog/dev/openapi.json", nil, http.StatusOK)
	if !bytes.Contains(body, []byte(`"openapi"`)) || !bytes.Contains(body, []byte(`"paths"`)) {
		t.Fatalf("unexpected openapi json=%s", body)
	}
	body = serveAdmin(t, srv, http.MethodGet, "/admin/v1/catalog/dev/openapi.yaml", nil, http.StatusOK)
	if !bytes.Contains(body, []byte("openapi:")) || !bytes.Contains(body, []byte("paths:")) {
		t.Fatalf("unexpected openapi yaml=%s", body)
	}
	serveAdmin(t, srv, http.MethodGet, "/admin/v1/catalog/dev?all=true&grpc=true", nil, http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodGet, "/admin/v1/catalog/dev?format=html", nil, http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodGet, "/admin/v1/catalog/missing", nil, http.StatusNotFound)
	serveAdmin(t, srv, http.MethodGet, "/admin/v1/capsets/dev/catalog", nil, http.StatusNotFound)
}

func TestCatalogOpenAPIDescriptorErrorIsInternal(t *testing.T) {
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
		DescriptorVersion:   "descsha",
		NodeEntry:           "echo",
		Methods:             []domain.Method{{FullName: "echo.v1.EchoService/Echo", ServiceFullName: "echo.v1.EchoService", Name: "Echo", InputFullName: "echo.v1.EchoRequest", OutputFullName: "echo.v1.EchoResponse", Unary: true}},
	}
	if err := st.UpsertService(ctx, service); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: true, Status: domain.StatusRunning, NodeEntry: "echo", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:echo-test", CapsetID: "dev", ServiceID: "echo", InstanceID: "echo-test", IncludeAllMethods: true, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-test", MethodFullName: "echo.v1.EchoService/Echo", Enabled: true}); err != nil {
		t.Fatal(err)
	}

	srv := &Server{Store: st, Gateway: &protocol.Gateway{Store: st}}
	body := serveAdmin(t, srv, http.MethodGet, "/admin/v1/catalog/dev/openapi.json", nil, http.StatusInternalServerError)
	if !bytes.Contains(body, []byte("descriptor load failed")) {
		t.Fatalf("unexpected error body=%s", body)
	}
}

func TestAccessLogRouteReturnsFilteredNDJSON(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	path := filepath.Join(dataDir, "access.log")
	lines := strings.Join([]string{
		`{"ts":"2026-06-10T10:00:00Z","capset":"dev","instance":"calculator-test","service":"calculator","method":"calculator.v1.CalculatorService/Add"}`,
		`{"ts":"2026-06-10T10:00:01Z","capset":"dev","instance":"echo-test","service":"echo","method":"echo.v1.EchoService/Echo"}`,
		`{"ts":"2026-06-10T10:00:02Z","capset":"qa","instance":"calculator-test","service":"calculator","method":"calculator.v1.CalculatorService/Add"}`,
	}, "\n") + "\n"
	if err := os.WriteFile(path, []byte(lines), 0o600); err != nil {
		t.Fatal(err)
	}
	srv := &Server{Store: st, AccessLogPath: path}

	body := serveAdmin(t, srv, http.MethodGet, "/admin/v1/logs/access?capset=dev&service=calculator&limit=0", nil, http.StatusOK)
	want := `{"ts":"2026-06-10T10:00:00Z","capset":"dev","instance":"calculator-test","service":"calculator","method":"calculator.v1.CalculatorService/Add"}` + "\n"
	if string(body) != want {
		t.Fatalf("body=%q want=%q", body, want)
	}
	req := httptest.NewRequest(http.MethodGet, "/admin/v1/logs/access?limit=1", nil)
	w := httptest.NewRecorder()
	srv.Handler().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	if got := w.Header().Get("Content-Type"); got != "application/x-ndjson" {
		t.Fatalf("content-type=%q", got)
	}

	body = serveAdmin(t, srv, http.MethodGet, "/admin/v1/logs/access?instance=echo-test&limit=1", nil, http.StatusOK)
	if !bytes.Contains(body, []byte(`"service":"echo"`)) || bytes.Contains(body, []byte(`"service":"calculator"`)) {
		t.Fatalf("filtered body=%s", body)
	}
	body = serveAdmin(t, srv, http.MethodGet, "/admin/v1/logs/access?service=calculator&tail=1", nil, http.StatusOK)
	if !bytes.Contains(body, []byte(`"capset":"qa"`)) || bytes.Contains(body, []byte(`"capset":"dev"`)) {
		t.Fatalf("tail body=%s", body)
	}
	serveAdmin(t, srv, http.MethodGet, "/admin/v1/logs/access?limit=-1", nil, http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodGet, "/admin/v1/logs/access?limit=abc", nil, http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodGet, "/admin/v1/logs/access?tail=-1", nil, http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodGet, "/admin/v1/logs/access?limit=1&tail=1", nil, http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodGet, "/admin/v1/logs/access?limit=1&follow=true", nil, http.StatusBadRequest)
	serveAdmin(t, srv, http.MethodGet, "/admin/v1/logs/access?follow=maybe", nil, http.StatusBadRequest)

	missing := &Server{Store: st, AccessLogPath: filepath.Join(dataDir, "missing.log")}
	body = serveAdmin(t, missing, http.MethodGet, "/admin/v1/logs/access", nil, http.StatusOK)
	if len(body) != 0 {
		t.Fatalf("missing log body=%q", body)
	}

	if _, err := st.AddAdminToken(ctx, domain.AdminToken{ID: "key", Name: "Key"}, "secret"); err != nil {
		t.Fatal(err)
	}
	serveAdmin(t, srv, http.MethodGet, "/admin/v1/logs/access", nil, http.StatusUnauthorized)
	serveAdminWithToken(t, srv, http.MethodGet, "/admin/v1/logs/access", nil, "secret", http.StatusOK)
}

func TestAccessLogFollowFailureWritesDaemonLog(t *testing.T) {
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	var out bytes.Buffer
	srv := &Server{
		Store:         st,
		AccessLogPath: dataDir,
		Logger:        slog.New(slog.NewTextHandler(&out, &slog.HandlerOptions{Level: slog.LevelInfo})),
	}
	body := serveAdmin(t, srv, http.MethodGet, "/admin/v1/logs/access?follow=true&tail=0", nil, http.StatusOK)
	if !bytes.Contains(body, []byte("ACCESS_LOG_FOLLOW_FAILED")) {
		t.Fatalf("follow failure body=%s", body)
	}
	got := out.String()
	if !strings.Contains(got, "level=WARN msg=access_log_follow_failed") {
		t.Fatalf("missing follow failure daemon log:\n%s", got)
	}
}

func TestAccessLogHandlerBoundaries(t *testing.T) {
	srv := &Server{}

	req := httptest.NewRequest(http.MethodPost, "/admin/v1/logs/access", nil)
	w := httptest.NewRecorder()
	srv.handleAccessLogs(w, req)
	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("method status=%d body=%s", w.Code, w.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/admin/v1/logs/access", nil)
	w = httptest.NewRecorder()
	srv.handleAccessLogs(w, req)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("missing path status=%d body=%s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "access log path is not configured") {
		t.Fatalf("missing path body=%s", w.Body.String())
	}
}

func TestParseAccessLogQueryBoundaries(t *testing.T) {
	for _, path := range []string{
		"/admin/v1/logs/access?limit=",
		"/admin/v1/logs/access?tail=",
	} {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			if _, err := parseAccessLogQuery(req); err == nil {
				t.Fatalf("expected query error for %s", path)
			}
		})
	}

	req := httptest.NewRequest(http.MethodGet, "/admin/v1/logs/access?follow=true", nil)
	filter, err := parseAccessLogQuery(req)
	if err != nil {
		t.Fatal(err)
	}
	if !filter.Follow || !filter.TailSet || filter.Tail == 0 {
		t.Fatalf("follow default filter=%+v", filter)
	}

	req = httptest.NewRequest(http.MethodGet, "/admin/v1/logs/access?follow=false", nil)
	filter, err = parseAccessLogQuery(req)
	if err != nil {
		t.Fatal(err)
	}
	if filter.Follow || filter.TailSet {
		t.Fatalf("follow=false filter=%+v", filter)
	}
}

func TestParseCatalogQueryBoundaries(t *testing.T) {
	for _, path := range []string{
		"/admin/v1/catalog/dev?mcp=maybe",
		"/admin/v1/catalog/dev?connect=maybe",
		"/admin/v1/catalog/dev?all=maybe",
	} {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			if _, _, err := parseCatalogQuery(req); err == nil {
				t.Fatalf("expected query error for %s", path)
			}
		})
	}

	req := httptest.NewRequest(http.MethodGet, "/admin/v1/catalog/dev?grpc=false&mcp=false&connect=false", nil)
	opts, format, err := parseCatalogQuery(req)
	if err != nil {
		t.Fatal(err)
	}
	if format != "json" || !opts.IncludeGRPC || opts.IncludeMCP || opts.IncludeConnect {
		t.Fatalf("default grpc opts=%+v format=%q", opts, format)
	}

	req = httptest.NewRequest(http.MethodGet, "/admin/v1/catalog/dev?all=true&format=md", nil)
	opts, format, err = parseCatalogQuery(req)
	if err != nil {
		t.Fatal(err)
	}
	if format != "md" || !opts.IncludeGRPC || !opts.IncludeMCP || !opts.IncludeConnect {
		t.Fatalf("all opts=%+v format=%q", opts, format)
	}
}

func TestFlushResponseWriterFlushesUnderlyingWriter(t *testing.T) {
	rec := httptest.NewRecorder()
	flushResponseWriter{ResponseWriter: rec}.Flush()
	if !rec.Flushed {
		t.Fatal("underlying response writer was not flushed")
	}
}

func TestLoggerAndEchoErrorStatusHelpers(t *testing.T) {
	var srv *Server
	if srv.logger() == nil {
		t.Fatal("nil server logger is nil")
	}
	if got := echoErrorStatus(echo.NewHTTPError(http.StatusTeapot, "teapot")); got != http.StatusTeapot {
		t.Fatalf("echo error status=%d", got)
	}
	if got := echoErrorStatus(errors.New("boom")); got != http.StatusInternalServerError {
		t.Fatalf("plain error status=%d", got)
	}
}

func serveAdmin(t *testing.T, srv *Server, method, path string, body *bytes.Buffer, want int) []byte {
	return serveAdminWithToken(t, srv, method, path, body, "", want)
}

func serveAdminWithToken(t *testing.T, srv *Server, method, path string, body *bytes.Buffer, token string, want int) []byte {
	t.Helper()
	var reqBody *bytes.Buffer
	if body == nil {
		reqBody = bytes.NewBuffer(nil)
	} else {
		reqBody = body
	}
	req := httptest.NewRequest(method, path, reqBody)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	srv.Handler().ServeHTTP(w, req)
	if w.Code != want {
		t.Fatalf("%s %s status=%d want=%d body=%s", method, path, w.Code, want, w.Body.String())
	}
	return w.Body.Bytes()
}

func TestStrictJSON(t *testing.T) {
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := &Server{Store: st, Importer: &packageimport.Importer{DataDir: dataDir, Store: st}, Supervisor: supervisor.New(dataDir, st)}
	req := httptest.NewRequest(http.MethodPost, "/admin/v1/services/import", bytes.NewBufferString(`{"unknown":true}`))
	w := httptest.NewRecorder()
	srv.Handler().ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status code = %d body=%s", w.Code, w.Body.String())
	}
}

func TestHTTPSGitServiceImportRedactsCredentials(t *testing.T) {
	requireAdminGit(t)
	t.Setenv("GIT_SSL_NO_VERIFY", "true")
	t.Setenv("NO_PROXY", "127.0.0.1,localhost")
	t.Setenv("no_proxy", "127.0.0.1,localhost")
	root := t.TempDir()
	work := filepath.Join(root, "work")
	adminGitInit(t, work)
	writeAdminGitPackage(t, work, `{"schema":"chaitin.octobus.service.v1","name":"echo","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	adminGit(t, work, "add", ".")
	adminGit(t, work, "commit", "-m", "initial")
	commit := strings.TrimSpace(adminGit(t, work, "rev-parse", "HEAD"))
	adminGit(t, work, "tag", "v1.0.0")
	bare := filepath.Join(root, "repo.git")
	adminGit(t, root, "clone", "--bare", work, bare)
	gitSrv := newAdminGitHTTPServer(t, bare, "user", "p@ss")
	defer gitSrv.Close()

	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := &Server{Store: st, Importer: &packageimport.Importer{DataDir: dataDir, Store: st}, Supervisor: supervisor.New(dataDir, st)}
	source := strings.Replace(gitSrv.URL+"/repo.git", "https://", "https://user:p%40ss@", 1) + "@v1.0.0"
	body := serveAdmin(t, srv, http.MethodPost, "/admin/v1/services/import", bytes.NewBufferString(fmt.Sprintf(`{"service_id":"echo","source":%q,"offline":true}`, source)), http.StatusOK)
	for _, leaked := range []string{"p@ss", "p%40ss"} {
		if bytes.Contains(body, []byte(leaked)) {
			t.Fatalf("admin response leaked credential %q: %s", leaked, body)
		}
	}
	if !bytes.Contains(body, []byte("******")) {
		t.Fatalf("admin response did not include redacted source: %s", body)
	}
	stored, err := st.GetService(context.Background(), "echo")
	if err != nil {
		t.Fatal(err)
	}
	if stored.PackageVersion != commit || !commitRE.MatchString(stored.PackageVersion) {
		t.Fatalf("stored version=%q want %q", stored.PackageVersion, commit)
	}
	if strings.Contains(stored.PackageSource, "p@ss") || strings.Contains(stored.PackageSource, "p%40ss") || !strings.Contains(stored.PackageSource, "******") {
		t.Fatalf("stored source not redacted: %s", stored.PackageSource)
	}
}

func TestHTTPSGitServiceImportBadCredentialsDoNotLeakOrPersist(t *testing.T) {
	requireAdminGit(t)
	t.Setenv("GIT_SSL_NO_VERIFY", "true")
	t.Setenv("NO_PROXY", "127.0.0.1,localhost")
	t.Setenv("no_proxy", "127.0.0.1,localhost")
	root := t.TempDir()
	work := filepath.Join(root, "work")
	adminGitInit(t, work)
	writeAdminGitPackage(t, work, `{"schema":"chaitin.octobus.service.v1","name":"echo","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	adminGit(t, work, "add", ".")
	adminGit(t, work, "commit", "-m", "initial")
	bare := filepath.Join(root, "repo.git")
	adminGit(t, root, "clone", "--bare", work, bare)
	gitSrv := newAdminGitHTTPServer(t, bare, "user", "good")
	defer gitSrv.Close()

	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := &Server{Store: st, Importer: &packageimport.Importer{DataDir: dataDir, Store: st}, Supervisor: supervisor.New(dataDir, st)}
	source := strings.Replace(gitSrv.URL+"/repo.git", "https://", "https://user:badtoken@", 1) + "@v1.0.0"
	body := serveAdmin(t, srv, http.MethodPost, "/admin/v1/services/import", bytes.NewBufferString(fmt.Sprintf(`{"service_id":"echo","source":%q,"offline":true}`, source)), http.StatusBadRequest)
	if bytes.Contains(body, []byte("badtoken")) {
		t.Fatalf("admin error leaked credential: %s", body)
	}
	if _, err := st.GetService(context.Background(), "echo"); err == nil {
		t.Fatal("bad credentials persisted service row")
	}
}

func TestCapsetRejectsDuplicateMCPToolName(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	service := domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "echo", Methods: []domain.Method{{FullName: "echo.v1.EchoService/Echo", ServiceFullName: "echo.v1.EchoService", Name: "Echo", Unary: true}}}
	if err := st.UpsertService(ctx, service); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"one", "two"} {
		if err := st.UpsertInstance(ctx, domain.Instance{ID: id, ServiceID: "echo", Name: id, Enabled: true, Status: domain.StatusRunning, NodeEntry: "echo", ConfigJSON: []byte(`{}`)}); err != nil {
			t.Fatal(err)
		}
	}
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:one", CapsetID: "dev", ServiceID: "echo", InstanceID: "one", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:two", CapsetID: "dev", ServiceID: "echo", InstanceID: "two", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	srv := &Server{Store: st, Gateway: &protocol.Gateway{Store: st}}

	req := httptest.NewRequest(http.MethodPost, "/admin/v1/capsets/dev/methods", bytes.NewBufferString(`{"instance_id":"one","method":"echo.v1.EchoService/Echo","mcp_tool":"same_tool"}`))
	w := httptest.NewRecorder()
	srv.Handler().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("first select status = %d body=%s", w.Code, w.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/admin/v1/capsets/dev/methods", bytes.NewBufferString(`{"instance_id":"two","method":"echo.v1.EchoService/Echo","mcp_tool":"same_tool"}`))
	w = httptest.NewRecorder()
	srv.Handler().ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest || !bytes.Contains(w.Body.Bytes(), []byte("MCP tool name conflict")) {
		t.Fatalf("duplicate select status = %d body=%s", w.Code, w.Body.String())
	}
}

var commitRE = regexp.MustCompile(`^[0-9a-f]{40}$`)

func requireAdminGit(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
}

func adminGitInit(t *testing.T, dir string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	adminGit(t, dir, "init", "-b", "main")
	adminGit(t, dir, "config", "user.email", "test@example.com")
	adminGit(t, dir, "config", "user.name", "Test User")
}

func writeAdminGitPackage(t *testing.T, pkg, manifest string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(pkg, "proto"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(pkg, "node_modules"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(pkg, "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pkg, "service.json"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pkg, "package.json"), []byte(`{"name":"echo-wrapper","version":"1.0.0","bin":{"`+adminTestManifestName(t, manifest)+`":"bin/echo.js"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pkg, "bin/echo.js"), []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	proto := `syntax = "proto3";
package echo.v1;
service EchoService { rpc Echo(EchoRequest) returns (EchoResponse); }
message EchoRequest { string text = 1; }
message EchoResponse { string text = 1; }
`
	if err := os.WriteFile(filepath.Join(pkg, "proto/echo.proto"), []byte(proto), 0o644); err != nil {
		t.Fatal(err)
	}
}

func adminTestManifestName(t *testing.T, manifest string) string {
	t.Helper()
	var m struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal([]byte(manifest), &m); err != nil || m.Name == "" {
		return "echo-wrapper"
	}
	return m.Name
}

func adminGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return string(out)
}

func newAdminGitHTTPServer(t *testing.T, bareRepo, username, password string) *httptest.Server {
	t.Helper()
	projectRoot := filepath.Dir(bareRepo)
	repoName := filepath.Base(bareRepo)
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if username != "" || password != "" {
			gotUser, gotPassword, ok := r.BasicAuth()
			if !ok || gotUser != username || gotPassword != password {
				w.Header().Set("WWW-Authenticate", `Basic realm="octobus"`)
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
		}
		if !strings.HasPrefix(r.URL.Path, "/"+repoName) {
			http.NotFound(w, r)
			return
		}
		cmd := exec.Command("git", "http-backend")
		cmd.Env = append(os.Environ(),
			"GIT_PROJECT_ROOT="+projectRoot,
			"GIT_HTTP_EXPORT_ALL=1",
			"REQUEST_METHOD="+r.Method,
			"PATH_INFO="+r.URL.Path,
			"QUERY_STRING="+r.URL.RawQuery,
			"CONTENT_TYPE="+r.Header.Get("Content-Type"),
			"REMOTE_USER="+username,
		)
		cmd.Stdin = r.Body
		out, err := cmd.Output()
		if err != nil {
			var exitErr *exec.ExitError
			if errors.As(err, &exitErr) {
				t.Logf("git http-backend stderr: %s", exitErr.Stderr)
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeAdminCGIResponse(t, w, out)
	}))
	srv.EnableHTTP2 = false
	srv.StartTLS()
	return srv
}

func writeAdminCGIResponse(t *testing.T, w http.ResponseWriter, raw []byte) {
	t.Helper()
	headerEnd := strings.Index(string(raw), "\r\n\r\n")
	sepLen := 4
	if headerEnd < 0 {
		headerEnd = strings.Index(string(raw), "\n\n")
		sepLen = 2
	}
	if headerEnd < 0 {
		t.Fatalf("invalid CGI response: %q", raw)
	}
	headers := string(raw[:headerEnd])
	status := http.StatusOK
	for _, line := range strings.Split(strings.ReplaceAll(headers, "\r\n", "\n"), "\n") {
		if line == "" {
			continue
		}
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		value = strings.TrimSpace(value)
		if strings.EqualFold(key, "Status") {
			fmt.Sscanf(value, "%d", &status)
			continue
		}
		w.Header().Add(key, value)
	}
	w.WriteHeader(status)
	_, _ = w.Write(raw[headerEnd+sepLen:])
}
