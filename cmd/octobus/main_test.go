package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"octobus/internal/cli"
	"octobus/internal/domain"
	"octobus/internal/store"

	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	grpc_health_v1 "google.golang.org/grpc/health/grpc_health_v1"
)

func TestMain(m *testing.M) {
	if os.Getenv("OCTOBUS_CMD_HELPER") == "1" {
		runCmdHelper()
		return
	}
	if os.Getenv("OCTOBUS_BOOTSTRAP_ADMIN_TOKEN") == "" {
		if err := os.Setenv("OCTOBUS_BOOTSTRAP_ADMIN_TOKEN", "test-bootstrap-token"); err != nil {
			panic(err)
		}
		defer os.Unsetenv("OCTOBUS_BOOTSTRAP_ADMIN_TOKEN")
	}
	os.Exit(m.Run())
}

func TestInitializeAdminAuthBootstrapsOnlyWhenStoreIsEmpty(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	t.Setenv("OCTOBUS_BOOTSTRAP_ADMIN_TOKEN", "bootstrap-secret")
	if err := initializeAdminAuth(context.Background(), st); err != nil {
		t.Fatal(err)
	}
	requires, err := st.AdminRequiresToken(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !requires {
		t.Fatal("bootstrap token was not persisted")
	}
	ok, err := st.VerifyAdminToken(context.Background(), "bootstrap-secret")
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("bootstrap token was not usable")
	}
}

func TestInitializeAdminAuthFailsClosedWithoutBootstrapToken(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	t.Setenv("OCTOBUS_BOOTSTRAP_ADMIN_TOKEN", "")
	if err := initializeAdminAuth(context.Background(), st); err == nil || !strings.Contains(err.Error(), "OCTOBUS_BOOTSTRAP_ADMIN_TOKEN") {
		t.Fatalf("missing bootstrap token error = %v", err)
	}
}

func TestRootAddrFlagOverridesAdminCommands(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/admin/v1/status" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "ok"})
	}))
	defer server.Close()

	var out bytes.Buffer
	adminCLI := &cli.CLI{AdminAddr: "127.0.0.1:1", Client: server.Client(), Stdout: &out}
	cmd := newRootCommand(adminCLI)
	cmd.SetArgs([]string{"--addr", server.URL, "status"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), `"status": "ok"`) {
		t.Fatalf("unexpected output: %s", out.String())
	}
}

func TestServeReturnsPublicBindError(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()

	err = serve(serveOptions{dataDir: t.TempDir(), addr: ln.Addr().String()})
	if err == nil || !strings.Contains(err.Error(), "address already in use") {
		t.Fatalf("expected public bind error, got %v", err)
	}
}

func TestServeShutsDownRecoveredInstancesWhenPublicBindFails(t *testing.T) {
	if testing.Short() {
		t.Skip("helper process fixture")
	}
	dataDir, instanceID := setupServeRecoverFixture(t)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()

	err = serve(serveOptions{dataDir: dataDir, addr: ln.Addr().String()})
	if err == nil || !strings.Contains(err.Error(), "address already in use") {
		t.Fatalf("expected public bind error, got %v", err)
	}
	assertRecoveredInstanceStopped(t, dataDir, instanceID)
}

func TestServeShutsDownRecoveredInstancesWhenStartupInventoryFails(t *testing.T) {
	if testing.Short() {
		t.Skip("helper process fixture")
	}
	dataDir, instanceID := setupServeRecoverFixture(t)
	inventoryErr := errors.New("startup inventory failed")

	err := serve(serveOptions{
		dataDir: dataDir,
		addr:    "127.0.0.1:0",
		startupInventory: func(context.Context, *slog.Logger, *store.Store) error {
			return inventoryErr
		},
	})
	if !errors.Is(err, inventoryErr) {
		t.Fatalf("expected startup inventory error, got %v", err)
	}
	assertRecoveredInstanceStopped(t, dataDir, instanceID)
}

func TestRunReturnsCommandError(t *testing.T) {
	if err := run([]string{"unknown"}); err == nil || !strings.Contains(err.Error(), "unknown command") {
		t.Fatalf("expected unknown command error, got %v", err)
	}
}

func TestServeReturnsDataDirError(t *testing.T) {
	file := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := serve(serveOptions{dataDir: filepath.Join(file, "child"), addr: "127.0.0.1:0"}); err == nil {
		t.Fatal("expected data dir mkdir error")
	}
}

func TestLogStartupInventory(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	if err := st.UpsertService(ctx, domain.Service{ID: "calculator", Name: "Calculator", NodeEntry: "calculator.js"}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "calculator-test", ServiceID: "calculator", Enabled: true, Status: domain.StatusRunning, ListenAddr: "127.0.0.1:12345", ConfigJSON: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "calculator-disabled", ServiceID: "calculator", Enabled: false, Status: domain.StatusStopped, ConfigJSON: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertCapset(ctx, domain.Capset{ID: "dev", Name: "DevAgent", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertCapset(ctx, domain.Capset{ID: "qa", Name: "QA", Enabled: false}); err != nil {
		t.Fatal(err)
	}

	var out bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&out, &slog.HandlerOptions{Level: slog.LevelInfo}))
	if err := logStartupInventory(ctx, logger, st); err != nil {
		t.Fatal(err)
	}
	got := out.String()
	for _, want := range []string{
		"msg=startup_inventory capsets=2 instances=2",
		"msg=startup_capset capset_id=dev enabled=true name=DevAgent",
		"msg=startup_capset capset_id=qa enabled=false name=QA",
		"msg=startup_instance instance_id=calculator-disabled service_id=calculator enabled=false status=stopped listen_addr=\"\"",
		"msg=startup_instance instance_id=calculator-test service_id=calculator enabled=true status=running listen_addr=127.0.0.1:12345",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("startup inventory missing %q in:\n%s", want, got)
		}
	}
}

func TestServeLogsDaemonLifecycle(t *testing.T) {
	if testing.Short() {
		t.Skip("signal-based serve test")
	}
	addr := freeAddr(t)
	var out bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&out, &slog.HandlerOptions{Level: slog.LevelInfo}))
	errc := make(chan error, 1)
	go func() {
		errc <- serve(serveOptions{dataDir: t.TempDir(), addr: addr, logger: logger})
	}()
	waitForHTTP(t, "http://"+addr+"/admin/v1/status")
	proc, err := os.FindProcess(os.Getpid())
	if err != nil {
		t.Fatal(err)
	}
	if err := proc.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-errc:
		if err != nil {
			t.Fatalf("serve returned error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("serve did not stop after SIGTERM")
	}
	got := out.String()
	for _, want := range []string{
		"msg=daemon_starting",
		"addr=" + addr,
		"data_dir=",
		"msg=recover_enabled_started",
		"msg=recover_enabled_done count=0",
		"msg=startup_inventory",
		"msg=daemon_listening addr=" + addr,
		"msg=daemon_shutdown_started",
		"msg=daemon_shutdown_done",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("serve log missing %q in:\n%s", want, got)
		}
	}
}

func TestServeStopsOnSignal(t *testing.T) {
	if testing.Short() {
		t.Skip("signal-based serve test")
	}
	addr := freeAddr(t)
	errc := make(chan error, 1)
	go func() {
		errc <- serve(serveOptions{dataDir: t.TempDir(), addr: addr})
	}()
	waitForHTTP(t, "http://"+addr+"/admin/v1/status")
	proc, err := os.FindProcess(os.Getpid())
	if err != nil {
		t.Fatal(err)
	}
	if err := proc.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-errc:
		if err != nil {
			t.Fatalf("serve returned error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("serve did not stop after SIGTERM")
	}
}

func TestDefaultDataDir(t *testing.T) {
	t.Setenv("OCTOBUS_DATA_DIR", "")
	if got := defaultDataDir(); got != ".octobus" {
		t.Fatalf("expected .octobus, got %q", got)
	}

	want := filepath.Join(t.TempDir(), "data")
	t.Setenv("OCTOBUS_DATA_DIR", want)
	if got := defaultDataDir(); got != want {
		t.Fatalf("expected env data dir %q, got %q", want, got)
	}
}

func TestEnvDefaultAndRootCommandDefaultAddr(t *testing.T) {
	t.Setenv("OCTOBUS_ADDR", "")
	if got := envDefault("OCTOBUS_ADDR", "fallback"); got != "fallback" {
		t.Fatalf("envDefault fallback=%q", got)
	}
	t.Setenv("OCTOBUS_ADDR", "127.0.0.1:1234")
	if got := envDefault("OCTOBUS_ADDR", "fallback"); got != "127.0.0.1:1234" {
		t.Fatalf("envDefault env=%q", got)
	}
	adminCLI := &cli.CLI{}
	_ = newRootCommand(adminCLI)
	if adminCLI.AdminAddr != "127.0.0.1:1234" {
		t.Fatalf("default admin addr=%q", adminCLI.AdminAddr)
	}
}

func TestRootCommandRoutesAdminCommands(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/admin/v1/status" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "ok"})
	}))
	defer server.Close()

	var out bytes.Buffer
	adminCLI := &cli.CLI{AdminAddr: strings.TrimPrefix(server.URL, "http://"), Client: server.Client(), Stdout: &out}
	cmd := newRootCommand(adminCLI)
	cmd.SetArgs([]string{"status"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), `"status": "ok"`) {
		t.Fatalf("unexpected output: %s", out.String())
	}
}

func freeAddr(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	return ln.Addr().String()
}

func waitForHTTP(t *testing.T, url string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			cancel()
			t.Fatal(err)
		}
		resp, err := http.DefaultClient.Do(req)
		cancel()
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("server did not become ready at %s", url)
}

func setupServeRecoverFixture(t *testing.T) (string, string) {
	t.Helper()
	dataDir := filepath.Join(t.TempDir(), "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	ctx := context.Background()
	serviceRuntime := filepath.Join(dataDir, "artifacts/services/echo/runtime")
	if err := os.MkdirAll(serviceRuntime, 0o755); err != nil {
		t.Fatal(err)
	}
	entry := "fixture-entry"
	if err := writeCmdHelperEntry(filepath.Join(serviceRuntime, entry)); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertService(ctx, domain.Service{
		ID:                "echo",
		Name:              "Echo",
		PackageSource:     "fixture",
		PackageSHA256:     "pkgsha",
		DescriptorPath:    "desc",
		DescriptorSHA256:  "descsha",
		DescriptorVersion: "descsha",
		NodeEntry:         entry,
	}); err != nil {
		t.Fatal(err)
	}
	instanceID := "echo-test"
	if err := st.UpsertInstance(ctx, domain.Instance{
		ID:         instanceID,
		ServiceID:  "echo",
		Name:       "Echo Test",
		Enabled:    true,
		Status:     domain.StatusStopped,
		NodeEntry:  entry,
		ConfigJSON: json.RawMessage(`{}`),
		SecretJSON: json.RawMessage(`{}`),
	}); err != nil {
		t.Fatal(err)
	}
	return dataDir, instanceID
}

func writeCmdHelperEntry(path string) error {
	body := fmt.Sprintf("#!/bin/sh\nexec env OCTOBUS_CMD_HELPER=1 %q -test.run=TestMain -- \"$@\"\n", os.Args[0])
	return os.WriteFile(path, []byte(body), 0o755)
}

func assertRecoveredInstanceStopped(t *testing.T, dataDir, instanceID string) {
	t.Helper()
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	inst, err := st.GetInstance(context.Background(), instanceID)
	if err != nil {
		t.Fatal(err)
	}
	if !inst.Enabled || inst.Status != domain.StatusStopped || inst.PID != nil || inst.ListenAddr != "" {
		t.Fatalf("recovered instance was not stopped cleanly: %+v", inst)
	}
}

func runCmdHelper() {
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
	if sep+2 >= len(args) || args[sep+1] != "--runtime" || args[sep+2] != "serve" {
		os.Exit(2)
	}
	for i := sep + 1; i < len(args)-1; i++ {
		if args[i] == "--port" {
			port = args[i+1]
			break
		}
	}
	if _, err := strconv.Atoi(port); err != nil {
		os.Exit(2)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		os.Exit(2)
	}
	srv := grpc.NewServer()
	healthServer := health.NewServer()
	healthServer.SetServingStatus("", grpc_health_v1.HealthCheckResponse_SERVING)
	grpc_health_v1.RegisterHealthServer(srv, healthServer)
	go func() {
		_ = srv.Serve(ln)
	}()
	waitForInterrupt()
	srv.Stop()
}

func waitForInterrupt() {
	select {}
}
