package supervisor

import (
	"context"
	"testing"

	"octobus/internal/domain"
)

func TestSetRuntimeModeEqualModeKeepsScaleToZeroCache(t *testing.T) {
	dataDir, st := setupScaleToZeroRuntime(t)
	ctx := context.Background()
	sup := New(dataDir, st)
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "eq-stz", ServiceID: "echo", RuntimeMode: domain.RuntimeModeScaleToZero}); err != nil {
		t.Fatal(err)
	}
	release, err := sup.EnsureStarted(ctx, "eq-stz")
	if err != nil {
		t.Fatal(err)
	}
	release()
	if _, err := sup.SetRuntimeMode(ctx, "eq-stz", domain.RuntimeModeScaleToZero); err != nil {
		t.Fatal(err)
	}
	sup.mu.Lock()
	var cached bool
	if st := sup.procs["eq-stz"]; st != nil {
		cached = st.scaleToZero
	}
	sup.mu.Unlock()
	if !cached {
		t.Fatal("equal-mode switch lost the scale-to-zero state on the process")
	}
	// And the reverse: switching to long-running must clear it immediately.
	if _, err := sup.SetRuntimeMode(ctx, "eq-stz", domain.RuntimeModeLongRunning); err != nil {
		t.Fatal(err)
	}
	sup.mu.Lock()
	cached = false
	if st := sup.procs["eq-stz"]; st != nil {
		cached = st.scaleToZero
	}
	sup.mu.Unlock()
	if cached {
		t.Fatal("switch to long-running left a stale scale-to-zero state on the process")
	}
	_ = sup.Stop(ctx, "eq-stz")
}
