package supervisor

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"octobus/internal/domain"
	"octobus/internal/store"

	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	grpc_health_v1 "google.golang.org/grpc/health/grpc_health_v1"
)

func TestMain(m *testing.M) {
	if os.Getenv("OCTOBUS_SUPERVISOR_HELPER") == "1" {
		runSupervisorHelper()
		return
	}
	os.Exit(m.Run())
}

func TestCreateUpdateStopInstance(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is unix-only")
	}
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	serviceRuntime := filepath.Join(dataDir, "artifacts/services/echo/runtime")
	if err := os.MkdirAll(serviceRuntime, 0o755); err != nil {
		t.Fatal(err)
	}
	entry := filepath.Join(serviceRuntime, "fixture-entry")
	if err := os.WriteFile(entry, []byte("#!/bin/sh\necho service=$OCTOBUS_SERVICE_ID instance=$OCTOBUS_INSTANCE_ID\nsleep 30\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "fixture-entry"}); err != nil {
		t.Fatal(err)
	}
	sup := New(dataDir, st)
	inst, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "echo-test", ServiceID: "echo", Config: json.RawMessage(`{"token":"a"}`), Secret: json.RawMessage(`{"apiToken":"s1"}`), Start: false})
	if err != nil {
		t.Fatal(err)
	}
	if inst.Enabled || inst.Status != domain.StatusStopped {
		t.Fatalf("unexpected initial instance: %+v", inst)
	}
	configPath := filepath.Join(dataDir, "instances/echo-test/config.json")
	info, err := os.Stat(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("config mode = %o", info.Mode().Perm())
	}
	secretPath := filepath.Join(dataDir, "instances/echo-test/secret.json")
	if _, err := os.Stat(secretPath); !os.IsNotExist(err) {
		t.Fatalf("secret file should not be persisted, stat err=%v", err)
	}
	updated, err := sup.UpdateConfig(ctx, "echo-test", []byte(`{"token":"b"}`), false)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Status != domain.StatusStopped || updated.ConfigSHA256 != domain.ConfigHash([]byte(`{"token":"b"}`)) {
		t.Fatalf("unexpected update result: %+v", updated)
	}
	updatedSecret, err := sup.UpdateSecret(ctx, "echo-test", []byte(`{"apiToken":"s2"}`), false)
	if err != nil {
		t.Fatal(err)
	}
	if updatedSecret.Status != domain.StatusStopped || updatedSecret.SecretSHA256 != domain.HashBytes([]byte(`{"apiToken":"s2"}`)) {
		t.Fatalf("unexpected secret update result: %+v", updatedSecret)
	}
	if err := sup.Start(ctx, "echo-test"); err == nil {
		t.Fatal("expected start to fail health check for shell fixture")
	}
	failed, err := st.GetInstance(ctx, "echo-test")
	if err != nil {
		t.Fatal(err)
	}
	if failed.Status != domain.StatusFailed {
		t.Fatalf("status after failed health = %s", failed.Status)
	}
	sup.mu.Lock()
	_, running := sup.procs["echo-test"]
	sup.mu.Unlock()
	if running {
		t.Fatal("failed health check left process state in supervisor")
	}
	_ = sup.Stop(ctx, "echo-test")
}

func TestSupervisorLogsCreateUpdateAndRedactsSensitiveInputs(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "missing-entry"}); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	sup := New(dataDir, st)
	sup.Logger = slog.New(slog.NewTextHandler(&out, &slog.HandlerOptions{Level: slog.LevelInfo}))
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "echo-test", ServiceID: "echo", Config: json.RawMessage(`{"token":"config-secret"}`), Secret: json.RawMessage(`{"apiToken":"secret-value"}`), Start: false}); err != nil {
		t.Fatal(err)
	}
	if _, err := sup.UpdateConfig(ctx, "echo-test", []byte(`{"token":"next-config-secret"}`), false); err != nil {
		t.Fatal(err)
	}
	if _, err := sup.UpdateSecret(ctx, "echo-test", []byte(`{"apiToken":"next-secret-value"}`), false); err != nil {
		t.Fatal(err)
	}
	got := out.String()
	for _, want := range []string{
		"msg=instance_create instance_id=echo-test service_id=echo runtime_mode=long-running start=false",
		"msg=instance_config_updated instance_id=echo-test config_sha256=" + domain.ConfigHash([]byte(`{"token":"next-config-secret"}`)) + " restart=false",
		"msg=instance_secret_updated instance_id=echo-test secret_sha256=" + domain.HashBytes([]byte(`{"apiToken":"next-secret-value"}`)) + " restart=false",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("log missing %q in:\n%s", want, got)
		}
	}
	for _, forbidden := range []string{"config-secret", "next-config-secret", "secret-value", "next-secret-value", `{"token"`, `{"apiToken"`} {
		if strings.Contains(got, forbidden) {
			t.Fatalf("supervisor log leaked %q in:\n%s", forbidden, got)
		}
	}
}

func TestStartStopAndWaitSuccessfulHelperProcess(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("helper process fixture is unix-oriented")
	}
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	serviceRuntime := filepath.Join(dataDir, "artifacts/services/echo/runtime")
	if err := os.MkdirAll(serviceRuntime, 0o755); err != nil {
		t.Fatal(err)
	}
	entry := filepath.Join(serviceRuntime, "fixture-entry")
	if err := writeSupervisorHelperEntry(entry); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "fixture-entry"}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: false, Status: domain.StatusStopped, NodeEntry: "fixture-entry", ConfigJSON: []byte(`{}`), SecretJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	sup := New(dataDir, st)
	var out bytes.Buffer
	sup.Logger = slog.New(slog.NewTextHandler(&out, &slog.HandlerOptions{Level: slog.LevelInfo}))
	if err := sup.Start(ctx, "echo-test"); err != nil {
		t.Fatal(err)
	}
	started, err := st.GetInstance(ctx, "echo-test")
	if err != nil {
		t.Fatal(err)
	}
	if !started.Enabled || started.Status != domain.StatusRunning || started.PID == nil || started.ListenAddr == "" {
		t.Fatalf("started instance=%+v", started)
	}
	sup.mu.Lock()
	state := sup.procs["echo-test"]
	sup.mu.Unlock()
	if state == nil {
		t.Fatal("start did not retain process state")
	}
	if err := sup.Stop(ctx, "echo-test"); err != nil {
		t.Fatal(err)
	}
	<-state.done
	stopped, err := st.GetInstance(ctx, "echo-test")
	if err != nil {
		t.Fatal(err)
	}
	if stopped.Enabled || stopped.Status != domain.StatusStopped || stopped.PID != nil {
		t.Fatalf("stopped instance=%+v", stopped)
	}
	got := out.String()
	for _, want := range []string{
		"msg=instance_starting instance_id=echo-test service_id=echo attempt=1",
		"msg=instance_started instance_id=echo-test pid=",
		"listen_addr=127.0.0.1:",
		"msg=instance_health_ready instance_id=echo-test listen_addr=127.0.0.1:",
		"msg=instance_stopping instance_id=echo-test",
		"msg=instance_stopped instance_id=echo-test",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("supervisor log missing %q in:\n%s", want, got)
		}
	}
	if strings.Contains(got, "instance_exited") {
		t.Fatalf("normal stop logged abnormal exit:\n%s", got)
	}
}

func TestKilledEnabledProcessAutoRecovers(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("helper process fixture is unix-oriented")
	}
	dataDir, st, entry := setupSupervisorHelperRuntime(t)
	ctx := context.Background()
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: false, Status: domain.StatusStopped, NodeEntry: entry, ConfigJSON: []byte(`{}`), SecretJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	sup := New(dataDir, st)
	var out bytes.Buffer
	sup.Logger = slog.New(slog.NewTextHandler(&out, &slog.HandlerOptions{Level: slog.LevelInfo}))
	if err := sup.Start(ctx, "echo-test"); err != nil {
		t.Fatal(err)
	}
	started, err := st.GetInstance(ctx, "echo-test")
	if err != nil {
		t.Fatal(err)
	}
	if started.PID == nil {
		t.Fatalf("started instance missing pid: %+v", started)
	}
	oldPID := *started.PID
	proc, err := os.FindProcess(oldPID)
	if err != nil {
		t.Fatal(err)
	}
	if err := proc.Kill(); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		inst, err := st.GetInstance(ctx, "echo-test")
		if err != nil {
			t.Fatal(err)
		}
		if inst.Status == domain.StatusRunning && inst.PID != nil && *inst.PID != oldPID && inst.ListenAddr != "" {
			_ = sup.Stop(ctx, "echo-test")
			got := out.String()
			for _, want := range []string{
				"msg=instance_exited instance_id=echo-test pid=",
				"attempt=1",
				"msg=instance_degraded instance_id=echo-test attempt=1",
				"msg=instance_restart_scheduled instance_id=echo-test attempt=2 delay=1s",
				"msg=instance_starting instance_id=echo-test service_id=echo attempt=2",
			} {
				if !strings.Contains(got, want) {
					t.Fatalf("supervisor recovery log missing %q in:\n%s", want, got)
				}
			}
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	inst, _ := st.GetInstance(ctx, "echo-test")
	t.Fatalf("killed process did not recover: before=%+v after=%+v", started, inst)
}

func TestStartWithRelativeDataDirRequiresMatchingWorkingDirectory(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is unix-only")
	}
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	serviceRuntime := filepath.Join(dataDir, "artifacts/services/echo/runtime")
	if err := os.MkdirAll(serviceRuntime, 0o755); err != nil {
		t.Fatal(err)
	}
	entry := filepath.Join(serviceRuntime, "fixture-entry")
	if err := os.WriteFile(entry, []byte("#!/bin/sh\nsleep 30\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "fixture-entry"}); err != nil {
		t.Fatal(err)
	}
	inst := domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "echo-test", Enabled: true, Status: domain.StatusStopped, NodeEntry: "fixture-entry", ConfigJSON: []byte(`{}`)}
	if err := st.UpsertInstance(ctx, inst); err != nil {
		t.Fatal(err)
	}

	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatalf("restore cwd: %v", err)
		}
	}()
	if err := os.Chdir(root); err != nil {
		t.Fatal(err)
	}
	sup := New("data", st)
	err = sup.Start(ctx, "echo-test")
	if err == nil {
		t.Fatal("expected health check failure")
	}
	if strings.Contains(err.Error(), "no such file or directory") {
		t.Fatalf("relative data dir resolved runtime entry from child cwd: %v", err)
	}
	_ = sup.Stop(ctx, "echo-test")
}

func TestCreateInstanceReturnsStartError(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is unix-only")
	}
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	serviceRuntime := filepath.Join(dataDir, "artifacts/services/echo/runtime")
	if err := os.MkdirAll(serviceRuntime, 0o755); err != nil {
		t.Fatal(err)
	}
	entry := filepath.Join(serviceRuntime, "fixture-entry")
	if err := os.WriteFile(entry, []byte("#!/bin/sh\nsleep 30\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "fixture-entry"}); err != nil {
		t.Fatal(err)
	}
	sup := New(dataDir, st)
	var out bytes.Buffer
	sup.Logger = slog.New(slog.NewTextHandler(&out, &slog.HandlerOptions{Level: slog.LevelInfo}))
	inst, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "echo-test", ServiceID: "echo", Start: true})
	if err == nil {
		t.Fatal("expected create to return start error")
	}
	if inst.Status != domain.StatusFailed {
		t.Fatalf("create returned status %s, want failed", inst.Status)
	}
	stored, getErr := st.GetInstance(ctx, "echo-test")
	if getErr != nil {
		t.Fatal(getErr)
	}
	if stored.Status != domain.StatusFailed {
		t.Fatalf("stored status %s, want failed", stored.Status)
	}
	got := out.String()
	for _, want := range []string{
		"msg=instance_create instance_id=echo-test service_id=echo runtime_mode=long-running start=true",
		"msg=instance_starting instance_id=echo-test service_id=echo attempt=1",
		"msg=instance_started instance_id=echo-test pid=",
		"msg=instance_health_failed instance_id=echo-test listen_addr=127.0.0.1:",
		"msg=instance_start_failed instance_id=echo-test attempt=1",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("failed start log missing %q in:\n%s", want, got)
		}
	}
	_ = sup.Stop(ctx, "echo-test")
}

func TestCreateInstanceEarlyErrorBranches(t *testing.T) {
	ctx := context.Background()
	t.Run("invalid id", func(t *testing.T) {
		dataDir := filepath.Join(t.TempDir(), "data")
		st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
		if err != nil {
			t.Fatal(err)
		}
		defer st.Close()
		_, err = New(dataDir, st).CreateInstance(ctx, CreateInstanceRequest{ID: "bad/id", ServiceID: "echo"})
		if err == nil || !strings.Contains(err.Error(), "instance id") {
			t.Fatalf("expected instance id error, got %v", err)
		}
	})

	t.Run("missing service", func(t *testing.T) {
		dataDir := filepath.Join(t.TempDir(), "data")
		st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
		if err != nil {
			t.Fatal(err)
		}
		defer st.Close()
		if _, err := New(dataDir, st).CreateInstance(ctx, CreateInstanceRequest{ID: "echo-test", ServiceID: "missing"}); !errors.Is(err, sql.ErrNoRows) {
			t.Fatalf("err=%v want sql.ErrNoRows", err)
		}
	})

	t.Run("config write error", func(t *testing.T) {
		dataDir := filepath.Join(t.TempDir(), "data")
		st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
		if err != nil {
			t.Fatal(err)
		}
		defer st.Close()
		if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "entry"}); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dataDir, "instances"), []byte("not a directory"), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := New(dataDir, st).CreateInstance(ctx, CreateInstanceRequest{ID: "echo-test", ServiceID: "echo"}); err == nil {
			t.Fatal("expected config write error")
		}
	})

}

func TestStartRejectsBadRuntimeEntries(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("executable permissions are unix-oriented")
	}
	ctx := context.Background()
	for _, tc := range []struct {
		name      string
		write     func(*testing.T, string)
		want      string
		wantState domain.InstanceStatus
	}{
		{
			name: "directory",
			write: func(t *testing.T, entry string) {
				t.Helper()
				if err := os.MkdirAll(entry, 0o755); err != nil {
					t.Fatal(err)
				}
			},
			want:      "not a regular file",
			wantState: domain.StatusStopped,
		},
		{
			name: "not executable",
			write: func(t *testing.T, entry string) {
				t.Helper()
				if err := os.WriteFile(entry, []byte("#!/bin/sh\nexit 0\n"), 0o644); err != nil {
					t.Fatal(err)
				}
			},
			want:      "permission denied",
			wantState: domain.StatusFailed,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dataDir := filepath.Join(t.TempDir(), "data")
			st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
			if err != nil {
				t.Fatal(err)
			}
			defer st.Close()
			serviceRuntime := filepath.Join(dataDir, "artifacts/services/echo/runtime")
			if err := os.MkdirAll(serviceRuntime, 0o755); err != nil {
				t.Fatal(err)
			}
			tc.write(t, filepath.Join(serviceRuntime, "fixture-entry"))
			if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "fixture-entry"}); err != nil {
				t.Fatal(err)
			}
			if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: false, Status: domain.StatusStopped, NodeEntry: "fixture-entry", ConfigJSON: []byte(`{}`), SecretJSON: []byte(`{}`)}); err != nil {
				t.Fatal(err)
			}
			sup := New(dataDir, st)
			err = sup.Start(ctx, "echo-test")
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected %q start error, got %v", tc.want, err)
			}
			inst, err := st.GetInstance(ctx, "echo-test")
			if err != nil {
				t.Fatal(err)
			}
			if inst.Status != tc.wantState {
				t.Fatalf("status=%s want %s", inst.Status, tc.wantState)
			}
		})
	}
}

func TestStartAndUpdateWriteErrors(t *testing.T) {
	ctx := context.Background()
	for _, tc := range []struct {
		name  string
		setup func(*testing.T, string)
		fn    func(*Supervisor) error
	}{
		{
			name: "start config",
			setup: func(t *testing.T, dataDir string) {
				t.Helper()
				if err := os.WriteFile(filepath.Join(dataDir, "instances"), []byte("not a directory"), 0o600); err != nil {
					t.Fatal(err)
				}
			},
			fn: func(sup *Supervisor) error { return sup.Start(ctx, "echo-test") },
		},
		{
			name: "update config",
			setup: func(t *testing.T, dataDir string) {
				t.Helper()
				if err := os.MkdirAll(filepath.Join(dataDir, "instances", "echo-test", "config.json"), 0o700); err != nil {
					t.Fatal(err)
				}
			},
			fn: func(sup *Supervisor) error {
				_, err := sup.UpdateConfig(ctx, "echo-test", []byte(`{"next":true}`), false)
				return err
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dataDir := filepath.Join(t.TempDir(), "data")
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
			tc.setup(t, dataDir)
			if err := tc.fn(New(dataDir, st)); err == nil {
				t.Fatal("expected write error")
			}
		})
	}
}

func TestConfigSchemaValidation(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	schemaPath := filepath.Join(root, "config.schema.json")
	if err := os.WriteFile(schemaPath, []byte(`{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","required":["token"],"properties":{"token":{"type":"string"},"mode":{"enum":["dev","prod"]}},"additionalProperties":false}`), 0o644); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "fixture-entry", ConfigSchemaPath: schemaPath}); err != nil {
		t.Fatal(err)
	}
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "bad", ServiceID: "echo", Config: json.RawMessage(`{"token":1}`)}); err == nil {
		t.Fatal("expected schema validation error")
	}
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "bad-enum", ServiceID: "echo", Config: json.RawMessage(`{"token":"ok","mode":"test"}`)}); err == nil {
		t.Fatal("expected enum validation error")
	}
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "bad-additional", ServiceID: "echo", Config: json.RawMessage(`{"token":"ok","extra":true}`)}); err == nil {
		t.Fatal("expected additionalProperties validation error")
	}
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "good", ServiceID: "echo", Config: json.RawMessage(`{"token":"ok","mode":"dev"}`)}); err != nil {
		t.Fatal(err)
	}
}

func TestSecretSchemaValidation(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	schemaPath := filepath.Join(root, "secret.schema.json")
	if err := os.WriteFile(schemaPath, []byte(`{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","required":["apiToken"],"properties":{"apiToken":{"type":"string","minLength":3}},"additionalProperties":false}`), 0o644); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "fixture-entry", SecretSchemaPath: schemaPath}); err != nil {
		t.Fatal(err)
	}
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "bad", ServiceID: "echo", Secret: json.RawMessage(`{"apiToken":1}`)}); err == nil || !strings.Contains(err.Error(), "secret does not match schema") {
		t.Fatalf("expected secret schema validation error, got %v", err)
	}
	if _, err := st.GetInstance(ctx, "bad"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("invalid secret created instance: %v", err)
	}
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "good", ServiceID: "echo", Secret: json.RawMessage(`{"apiToken":"abc"}`)}); err != nil {
		t.Fatal(err)
	}
	before, err := st.GetInstance(ctx, "good")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := sup.UpdateSecret(ctx, "good", []byte(`{"apiToken":"x"}`), false); err == nil || !strings.Contains(err.Error(), "secret does not match schema") {
		t.Fatalf("expected update secret schema validation error, got %v", err)
	}
	after, err := st.GetInstance(ctx, "good")
	if err != nil {
		t.Fatal(err)
	}
	if string(after.SecretJSON) != string(before.SecretJSON) || after.SecretSHA256 != before.SecretSHA256 {
		t.Fatalf("invalid secret update mutated stored secret: before=%+v after=%+v", before, after)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "instances", "good", "secret.json")); !os.IsNotExist(err) {
		t.Fatalf("secret file should not be persisted, stat err=%v", err)
	}
	if updated, err := sup.UpdateSecret(ctx, "good", []byte(`{"apiToken":"def"}`), false); err != nil {
		t.Fatal(err)
	} else if updated.SecretSHA256 != domain.HashBytes([]byte(`{"apiToken":"def"}`)) {
		t.Fatalf("valid secret update hash mismatch: %+v", updated)
	}
}

func TestValidateJSONSchemaErrorBranches(t *testing.T) {
	dir := t.TempDir()
	schemaPath := filepath.Join(dir, "schema.json")
	if err := validateConfigSchema(schemaPath, []byte(`{}`)); err == nil {
		t.Fatal("expected missing schema file error")
	}
	if err := os.WriteFile(schemaPath, []byte(`{`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := validateConfigSchema(schemaPath, []byte(`{}`)); err == nil || !strings.Contains(err.Error(), "invalid config schema") {
		t.Fatalf("expected invalid schema error, got %v", err)
	}
	if err := os.WriteFile(schemaPath, []byte(`{"type":"object"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := validateConfigSchema(schemaPath, []byte(`{`)); err == nil || !strings.Contains(err.Error(), "invalid config JSON") {
		t.Fatalf("expected invalid config JSON error, got %v", err)
	}
}

func TestRecoverEnabledAggregatesMultipleInstances(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is unix-only")
	}
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	serviceRuntime := filepath.Join(dataDir, "artifacts/services/echo/runtime")
	if err := os.MkdirAll(serviceRuntime, 0o755); err != nil {
		t.Fatal(err)
	}
	entry := filepath.Join(serviceRuntime, "fixture-entry")
	if err := os.WriteFile(entry, []byte("#!/bin/sh\nsleep 30\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "fixture-entry"}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"alpha", "beta"} {
		inst := domain.Instance{ID: id, ServiceID: "echo", Name: id, Enabled: true, Status: domain.StatusStopped, NodeEntry: "fixture-entry", ConfigJSON: []byte(`{}`)}
		if err := st.UpsertInstance(ctx, inst); err != nil {
			t.Fatal(err)
		}
	}
	sup := New(dataDir, st)
	count, err := sup.RecoverEnabled(ctx)
	if err == nil {
		t.Fatal("expected recovery errors")
	}
	if count != 2 {
		t.Fatalf("recover count=%d want 2", count)
	}
	msg := err.Error()
	alpha := strings.Index(msg, "alpha:")
	beta := strings.Index(msg, "beta:")
	if alpha < 0 || beta < 0 || alpha > beta {
		t.Fatalf("recovery errors not reported in instance order: %v", err)
	}
	sup.mu.Lock()
	defer sup.mu.Unlock()
	if len(sup.procs) != 0 {
		t.Fatalf("failed recovery left process state: %+v", sup.procs)
	}
}

func TestOnDemandInstanceLifecycleDoesNotStartProcess(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "missing-entry", RuntimeMode: domain.RuntimeModeOnDemand}); err != nil {
		t.Fatal(err)
	}
	sup := New(dataDir, st)
	inst, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "echo-test", ServiceID: "echo", Config: json.RawMessage(`{"token":"a"}`), Secret: json.RawMessage(`{"apiToken":"s1"}`), Start: true})
	if err != nil {
		t.Fatal(err)
	}
	if !inst.Enabled || inst.Status != domain.StatusRunning || inst.PID != nil || inst.ListenAddr != "" {
		t.Fatalf("unexpected on-demand instance: %+v", inst)
	}
	sup.mu.Lock()
	procs := len(sup.procs)
	sup.mu.Unlock()
	if procs != 0 {
		t.Fatalf("on-demand create started process state: %+v", sup.procs)
	}

	updated, err := sup.UpdateConfig(ctx, "echo-test", []byte(`{"token":"b"}`), false)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Status != domain.StatusRunning || updated.ConfigSHA256 != domain.ConfigHash([]byte(`{"token":"b"}`)) {
		t.Fatalf("unexpected config update: %+v", updated)
	}
	updatedSecret, err := sup.UpdateSecret(ctx, "echo-test", []byte(`{"apiToken":"s2"}`), false)
	if err != nil {
		t.Fatal(err)
	}
	if updatedSecret.Status != domain.StatusRunning || updatedSecret.SecretSHA256 != domain.HashBytes([]byte(`{"apiToken":"s2"}`)) {
		t.Fatalf("unexpected secret update: %+v", updatedSecret)
	}
	for _, action := range []struct {
		name string
		fn   func() error
	}{
		{"start", func() error { return sup.Start(ctx, "echo-test") }},
		{"stop", func() error { return sup.Stop(ctx, "echo-test") }},
		{"restart", func() error { return sup.Restart(ctx, "echo-test") }},
		{"update config restart", func() error {
			_, err := sup.UpdateConfig(ctx, "echo-test", []byte(`{"token":"c"}`), true)
			return err
		}},
		{"update secret restart", func() error {
			_, err := sup.UpdateSecret(ctx, "echo-test", []byte(`{"apiToken":"s3"}`), true)
			return err
		}},
	} {
		if err := action.fn(); !errors.Is(err, ErrUnsupportedRuntimeControl) {
			t.Fatalf("%s err=%v want ErrUnsupportedRuntimeControl", action.name, err)
		}
	}
}

func TestRecoverEnabledSkipsOnDemandInstances(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "missing-entry", RuntimeMode: domain.RuntimeModeOnDemand}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: true, Status: domain.StatusRunning, NodeEntry: "missing-entry", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	sup := New(dataDir, st)
	count, err := sup.RecoverEnabled(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("recover count=%d want 0", count)
	}
	sup.mu.Lock()
	defer sup.mu.Unlock()
	if len(sup.procs) != 0 {
		t.Fatalf("recover started on-demand process: %+v", sup.procs)
	}
}

func TestOnDemandDeleteInstanceCascadesBindingsWithoutStoppingProcess(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "missing-entry", RuntimeMode: domain.RuntimeModeOnDemand}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: true, Status: domain.StatusRunning, NodeEntry: "missing-entry", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:echo-test", CapsetID: "dev", ServiceID: "echo", InstanceID: "echo-test", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-test", MethodFullName: "echo.v1.EchoService/Echo", MCPToolName: "echo_tool", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	sup := New(dataDir, st)
	if err := sup.DeleteInstance(ctx, "echo-test"); err != nil {
		t.Fatal(err)
	}
	if _, err := st.GetInstance(ctx, "echo-test"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("GetInstance err=%v want sql.ErrNoRows", err)
	}
	cis, err := st.ListCapsetInstances(ctx, "dev")
	if err != nil {
		t.Fatal(err)
	}
	if len(cis) != 0 {
		t.Fatalf("capset instance binding not deleted: %+v", cis)
	}
	methods, err := st.ListCapsetMethods(ctx, "dev:echo-test")
	if err != nil {
		t.Fatal(err)
	}
	if len(methods) != 0 {
		t.Fatalf("capset method binding not deleted: %+v", methods)
	}
	sup.mu.Lock()
	defer sup.mu.Unlock()
	if len(sup.procs) != 0 {
		t.Fatalf("delete touched process state: %+v", sup.procs)
	}
}

func TestRestartDisabledAndDeleteLongRunningInstanceWithoutProcess(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "missing-entry"}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "disabled", ServiceID: "echo", Name: "Disabled", Enabled: false, Status: domain.StatusFailed, PID: ptr(1234), ListenAddr: "127.0.0.1:1", NodeEntry: "missing-entry", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	sup := New(dataDir, st)
	var out bytes.Buffer
	sup.Logger = slog.New(slog.NewTextHandler(&out, &slog.HandlerOptions{Level: slog.LevelInfo}))
	if err := sup.Restart(ctx, "disabled"); err != nil {
		t.Fatal(err)
	}
	restarted, err := st.GetInstance(ctx, "disabled")
	if err != nil {
		t.Fatal(err)
	}
	if restarted.Enabled || restarted.Status != domain.StatusStopped || restarted.PID != nil {
		t.Fatalf("disabled restart did not persist stopped state: %+v", restarted)
	}
	if err := sup.DeleteInstance(ctx, "disabled"); err != nil {
		t.Fatal(err)
	}
	if _, err := st.GetInstance(ctx, "disabled"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("deleted instance err=%v want sql.ErrNoRows", err)
	}
	got := out.String()
	for _, want := range []string{
		"msg=instance_restart_requested instance_id=disabled",
		"msg=instance_stopping instance_id=disabled",
		"msg=instance_stopped instance_id=disabled",
		"msg=instance_delete instance_id=disabled",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("restart/delete log missing %q in:\n%s", want, got)
		}
	}
}

func TestUpdateEmptyConfigSecretAndMissingRuntimeControls(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "missing-entry"}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: false, Status: domain.StatusStopped, NodeEntry: "missing-entry", ConfigJSON: []byte(`{"old":true}`), SecretJSON: []byte(`{"old":true}`)}); err != nil {
		t.Fatal(err)
	}
	sup := New(dataDir, st)
	updated, err := sup.UpdateConfig(ctx, "echo-test", nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if string(updated.ConfigJSON) != `{}` {
		t.Fatalf("empty config update=%s", updated.ConfigJSON)
	}
	updated, err = sup.UpdateSecret(ctx, "echo-test", nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if string(updated.SecretJSON) != `{}` {
		t.Fatalf("empty secret update=%s", updated.SecretJSON)
	}
	for _, tc := range []struct {
		name string
		fn   func() error
	}{
		{name: "start", fn: func() error { return sup.Start(ctx, "missing") }},
		{name: "stop", fn: func() error { return sup.Stop(ctx, "missing") }},
		{name: "restart", fn: func() error { return sup.Restart(ctx, "missing") }},
		{name: "delete", fn: func() error { return sup.DeleteInstance(ctx, "missing") }},
		{name: "update config", fn: func() error { _, err := sup.UpdateConfig(ctx, "missing", nil, false); return err }},
		{name: "update secret", fn: func() error { _, err := sup.UpdateSecret(ctx, "missing", nil, false); return err }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.fn(); !errors.Is(err, sql.ErrNoRows) {
				t.Fatalf("err=%v want sql.ErrNoRows", err)
			}
		})
	}
}

func TestWaitMarksEnabledInstanceDegraded(t *testing.T) {
	ctx := context.Background()
	dataDir := filepath.Join(t.TempDir(), "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "entry"}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: true, Status: domain.StatusRunning, NodeEntry: "entry", ConfigJSON: []byte(`{}`), SecretJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	sup := New(dataDir, st)
	cmd := exec.Command("sh", "-c", "exit 0")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	stdout, err := os.CreateTemp(t.TempDir(), "stdout-*")
	if err != nil {
		t.Fatal(err)
	}
	stderr, err := os.CreateTemp(t.TempDir(), "stderr-*")
	if err != nil {
		t.Fatal(err)
	}
	state := &processState{cmd: cmd, done: make(chan struct{})}
	sup.mu.Lock()
	sup.procs["echo-test"] = state
	sup.mu.Unlock()

	sup.wait("echo-test", state, stdout, stderr)
	<-state.done
	inst, err := st.GetInstance(ctx, "echo-test")
	if err != nil {
		t.Fatal(err)
	}
	if inst.Status != domain.StatusDegraded || inst.PID != nil {
		t.Fatalf("instance after wait=%+v", inst)
	}
}

func TestWaitMarksEnabledInstanceDegradedAfterProcessError(t *testing.T) {
	ctx := context.Background()
	dataDir := filepath.Join(t.TempDir(), "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "entry"}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: true, Status: domain.StatusRunning, NodeEntry: "entry", ConfigJSON: []byte(`{}`), SecretJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	sup := New(dataDir, st)
	cmd := exec.Command("sh", "-c", "exit 9")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	stdout, err := os.CreateTemp(t.TempDir(), "stdout-*")
	if err != nil {
		t.Fatal(err)
	}
	stderr, err := os.CreateTemp(t.TempDir(), "stderr-*")
	if err != nil {
		t.Fatal(err)
	}
	state := &processState{cmd: cmd, done: make(chan struct{})}
	sup.mu.Lock()
	sup.procs["echo-test"] = state
	sup.mu.Unlock()

	sup.wait("echo-test", state, stdout, stderr)
	<-state.done
	inst, err := st.GetInstance(ctx, "echo-test")
	if err != nil {
		t.Fatal(err)
	}
	if inst.Status != domain.StatusDegraded || inst.PID != nil {
		t.Fatalf("instance after process error=%+v", inst)
	}
}

func TestStopProcessCleansRuntimeSecretAfterWaitTimeout(t *testing.T) {
	ctx := context.Background()
	dataDir := filepath.Join(t.TempDir(), "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "entry"}); err != nil {
		t.Fatal(err)
	}
	inst := domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: true, Status: domain.StatusRunning, NodeEntry: "entry", ConfigJSON: []byte(`{}`), SecretJSON: []byte(`{}`)}
	if err := st.UpsertInstance(ctx, inst); err != nil {
		t.Fatal(err)
	}
	sup := New(dataDir, st)
	cmd := exec.Command("sh", "-c", "exit 0")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	cleanupCalls := 0
	state := &processState{cmd: cmd, done: make(chan struct{}), cleanup: func() { cleanupCalls++ }}
	sup.mu.Lock()
	sup.procs["echo-test"] = state
	sup.mu.Unlock()

	if err := sup.stopProcess(ctx, inst, false); err != nil {
		t.Fatal(err)
	}
	if cleanupCalls != 1 {
		t.Fatalf("cleanup calls after stop timeout=%d want 1", cleanupCalls)
	}
	state.cleanupRuntimeSecret()
	if cleanupCalls != 1 {
		t.Fatalf("cleanup should be idempotent, calls=%d", cleanupCalls)
	}
	_ = cmd.Wait()
}

func TestWaitReturnsWhenInstanceDisabledOrStateReplaced(t *testing.T) {
	ctx := context.Background()
	dataDir := filepath.Join(t.TempDir(), "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "entry"}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "disabled", ServiceID: "echo", Name: "Disabled", Enabled: false, Status: domain.StatusStopped, NodeEntry: "entry", ConfigJSON: []byte(`{}`), SecretJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	sup := New(dataDir, st)
	cmd := exec.Command("sh", "-c", "exit 0")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	stdout, err := os.CreateTemp(t.TempDir(), "stdout-*")
	if err != nil {
		t.Fatal(err)
	}
	stderr, err := os.CreateTemp(t.TempDir(), "stderr-*")
	if err != nil {
		t.Fatal(err)
	}
	state := &processState{cmd: cmd, done: make(chan struct{})}
	sup.mu.Lock()
	sup.procs["disabled"] = &processState{}
	sup.mu.Unlock()

	sup.wait("disabled", state, stdout, stderr)
	<-state.done
	inst, err := st.GetInstance(ctx, "disabled")
	if err != nil {
		t.Fatal(err)
	}
	if inst.Status != domain.StatusStopped {
		t.Fatalf("disabled wait mutated instance: %+v", inst)
	}
}

func TestSupervisorSmallHelpersAndRestartBackoffBranches(t *testing.T) {
	dataDir := filepath.Join(t.TempDir(), "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "missing-entry"}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "disabled", ServiceID: "echo", Name: "Disabled", Enabled: false, Status: domain.StatusStopped, NodeEntry: "missing-entry", ConfigJSON: []byte(`{}`), SecretJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	sup := New(dataDir, st)

	file, closeSecret, err := secretReadFile(nil)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := io.ReadAll(file)
	closeSecret()
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `{}` {
		t.Fatalf("empty secret fd=%s", raw)
	}
	if _, _, err := freeLocalPort(); err != nil {
		t.Fatal(err)
	}

	errs := RunBounded([]string{"a", "b"}, 0, func(id string) error {
		if id == "b" {
			return errors.New("boom")
		}
		return nil
	})
	if len(errs) != 1 || errs[0].Error() != "boom" {
		t.Fatalf("RunBounded errors=%v", errs)
	}

	sup.restartAfterBackoff("missing", 0, 0)
	sup.restartAfterBackoff("disabled", 0, 0)
}

func TestRestartAfterBackoffFailedStartMarksDegraded(t *testing.T) {
	dataDir := filepath.Join(t.TempDir(), "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "missing-entry"}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: true, Status: domain.StatusRunning, NodeEntry: "missing-entry", ConfigJSON: []byte(`{}`), SecretJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	sup := New(dataDir, st)
	sup.mu.Lock()
	generation := sup.nextGenerationLocked("echo-test")
	sup.mu.Unlock()
	sup.restartAfterBackoff("echo-test", 0, generation)
	inst, err := st.GetInstance(ctx, "echo-test")
	if err != nil {
		t.Fatal(err)
	}
	if inst.Status != domain.StatusDegraded || inst.PID != nil {
		t.Fatalf("restart backoff instance=%+v", inst)
	}
	inst.Enabled = false
	inst.Status = domain.StatusStopped
	if err := st.UpsertInstance(ctx, inst); err != nil {
		t.Fatal(err)
	}
}

func TestRecoverEnabledStartsLongRunningAndSkipsOnDemandInMixedSet(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	if err := st.UpsertService(ctx, domain.Service{ID: "long", Name: "Long", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "missing-long-entry", RuntimeMode: domain.RuntimeModeLongRunning}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertService(ctx, domain.Service{ID: "ondemand", Name: "On Demand", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "missing-on-demand-entry", RuntimeMode: domain.RuntimeModeOnDemand}); err != nil {
		t.Fatal(err)
	}
	for _, inst := range []domain.Instance{
		{ID: "long-test", ServiceID: "long", Name: "Long Test", Enabled: true, Status: domain.StatusStopped, NodeEntry: "missing-long-entry", ConfigJSON: []byte(`{}`)},
		{ID: "ondemand-test", ServiceID: "ondemand", Name: "On Demand Test", Enabled: true, Status: domain.StatusRunning, NodeEntry: "missing-on-demand-entry", ConfigJSON: []byte(`{}`)},
	} {
		if err := st.UpsertInstance(ctx, inst); err != nil {
			t.Fatal(err)
		}
	}
	sup := New(dataDir, st)
	count, err := sup.RecoverEnabled(ctx)
	if err == nil {
		t.Fatal("expected long-running recovery error")
	}
	if count != 1 {
		t.Fatalf("recover count=%d want 1", count)
	}
	msg := err.Error()
	if !strings.Contains(msg, "long-test:") {
		t.Fatalf("recovery did not attempt long-running instance: %v", err)
	}
	if strings.Contains(msg, "ondemand-test") {
		t.Fatalf("recovery attempted on-demand instance: %v", err)
	}
	od, err := st.GetInstance(ctx, "ondemand-test")
	if err != nil {
		t.Fatal(err)
	}
	if od.Status != domain.StatusRunning || od.PID != nil || od.ListenAddr != "" {
		t.Fatalf("on-demand instance was mutated by recovery: %+v", od)
	}
}

func TestBackoff(t *testing.T) {
	if backoff(0) != time.Second || backoff(1) != time.Second || backoff(2) != 2*time.Second || backoff(20) != 30*time.Second {
		t.Fatalf("unexpected backoff sequence")
	}
}

func writeSupervisorHelperEntry(path string) error {
	body := fmt.Sprintf("#!/bin/sh\nexec env OCTOBUS_SUPERVISOR_HELPER=1 %q -test.run=TestMain -- \"$@\"\n", os.Args[0])
	return os.WriteFile(path, []byte(body), 0o755)
}

func setupSupervisorHelperRuntime(t *testing.T) (string, *store.Store, string) {
	t.Helper()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
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
	if err := writeSupervisorHelperEntry(filepath.Join(serviceRuntime, entry)); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: entry}); err != nil {
		t.Fatal(err)
	}
	return dataDir, st, entry
}

func runSupervisorHelper() {
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

func ptr[T any](v T) *T {
	return &v
}
