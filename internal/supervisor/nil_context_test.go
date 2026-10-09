package supervisor

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"octobus/internal/domain"
	"octobus/internal/store"
)

// The daemon builds its supervisor with New, but the type is also constructed
// directly and reached through embedded daemons and tests. A zero value and a
// nil context have to be handled rather than crash: these guards run at startup,
// where a panic takes the daemon down before it can report anything.
func TestZeroValueSupervisorHandlesNilState(t *testing.T) {
	zero := &Supervisor{}
	// Deliberately nil: the guards being tested exist for callers that build the
	// supervisor directly, and a nil context must reach them rather than a panic.
	var nilCtx context.Context

	if got := zero.lifecycleContext(); got == nil {
		t.Fatal("lifecycleContext() = nil, want a background context")
	}
	if err := zero.lifecycleErr(); err != nil {
		t.Fatalf("lifecycleErr() = %v, want nil", err)
	}
	if got := zero.backoff(3); got <= 0 {
		t.Fatalf("backoff(3) = %v, want the default schedule", got)
	}

	ctx, finish, err := zero.beginOperation(nilCtx)
	if err != nil {
		t.Fatal(err)
	}
	if ctx == nil || finish == nil {
		t.Fatal("beginOperation(nil) returned a nil context or finish func")
	}
	finish()

	var nilSupervisor *Supervisor
	if logger := nilSupervisor.logger(); logger == nil {
		t.Fatal("logger() on a nil supervisor = nil, want a nop logger")
	}
	if pid := processPID(nil); pid != 0 {
		t.Fatalf("processPID(nil) = %d, want 0", pid)
	}
}

// A nil context means "no deadline and no cancellation" rather than a panic, on
// every entry point that takes one.
func TestSupervisorAcceptsANilContext(t *testing.T) {
	root := t.TempDir()
	st, err := store.Open(filepath.Join(root, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	if err := st.UpsertService(ctx, domain.Service{
		ID: "svc", Name: "Svc", PackageSource: "fixture", PackageArtifactPath: "pkg",
		PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha",
		DescriptorVersion: "descsha", NodeEntry: "entry",
	}); err != nil {
		t.Fatal(err)
	}
	sup := New(root, st)
	inst := domain.Instance{ID: "nil-ctx", ServiceID: "svc", Status: domain.StatusStopped}
	var nilCtx context.Context

	if err := sup.stopProcess(nilCtx, inst, false); err != nil {
		t.Fatalf("stopProcess(nil) err=%v", err)
	}
	if err := sup.persistStoppedInstance(nilCtx, inst, true); err != nil {
		t.Fatalf("persistStoppedInstance(nil) err=%v", err)
	}
	done := make(chan struct{})
	close(done)
	if err := waitProcessDone(nilCtx, done, time.Second); err != nil {
		t.Fatalf("waitProcessDone(nil) err=%v", err)
	}
	if err := sup.Shutdown(nilCtx); err != nil {
		t.Fatalf("Shutdown(nil) err=%v", err)
	}
}
