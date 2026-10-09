package supervisor

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"octobus/internal/domain"
	"octobus/internal/store"
)

// A runtime that launches but never answers its health check must fail the start
// instead of being recorded as running: the daemon would otherwise report a
// healthy instance that nothing can reach. It stays enabled so the next start or
// daemon restart retries it.
func TestStartFailsWhenTheRuntimeNeverBecomesHealthy(t *testing.T) {
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

	serviceRuntime := filepath.Join(dataDir, "artifacts/services/unhealthy/runtime")
	if err := os.MkdirAll(serviceRuntime, 0o755); err != nil {
		t.Fatal(err)
	}
	// Ignores the runtime arguments it is given and exits, so the port the
	// supervisor waits on is never opened.
	entry := filepath.Join(serviceRuntime, "fixture-entry")
	if err := os.WriteFile(entry, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertService(ctx, domain.Service{
		ID: "unhealthy", Name: "Unhealthy", PackageSource: "fixture", PackageArtifactPath: "pkg",
		PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha",
		DescriptorVersion: "descsha", NodeEntry: "fixture-entry",
	}); err != nil {
		t.Fatal(err)
	}

	sup := New(dataDir, st)
	defer func() { _ = sup.Shutdown(ctx) }()
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{
		ID: "unhealthy-test", ServiceID: "unhealthy",
		Config: json.RawMessage(`{}`), Secret: json.RawMessage(`{}`), Start: false,
	}); err != nil {
		t.Fatal(err)
	}

	if err := sup.Start(ctx, "unhealthy-test"); err == nil {
		t.Fatal("starting a runtime that never listens reported success")
	}
	inst, err := st.GetInstance(ctx, "unhealthy-test")
	if err != nil {
		t.Fatal(err)
	}
	if inst.Status != domain.StatusFailed {
		t.Fatalf("status=%q want %q after a failed health check", inst.Status, domain.StatusFailed)
	}
	if !inst.Enabled {
		t.Fatal("a failed start disabled the instance instead of leaving it to retry")
	}
}
