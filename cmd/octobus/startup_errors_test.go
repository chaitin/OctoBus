package main

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"octobus/internal/domain"
	"octobus/internal/hardening"
	"octobus/internal/store"
)

// captureStderr swaps os.Stderr for a pipe so a warning written where no writer
// was supplied can be asserted instead of leaking into the test output.
func captureStderr(t *testing.T) func() string {
	t.Helper()
	original := os.Stderr
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stderr = w
	return func() string {
		t.Helper()
		os.Stderr = original
		if err := w.Close(); err != nil {
			t.Fatal(err)
		}
		out, err := io.ReadAll(r)
		if err != nil {
			t.Fatal(err)
		}
		if err := r.Close(); err != nil {
			t.Fatal(err)
		}
		return string(out)
	}
}

// Each startup step that touches the data dir can fail before the daemon serves
// anything; startup has to report which one, not bind a port and hang.
// serveUntilFailure runs serve and requires it to fail on its own. Every case
// below plants a startup fault; if one of those ever stops being a fault, serve
// blocks in its serving loop until go test's timeout instead of reporting a
// failed assertion.
func serveUntilFailure(t *testing.T, opts serveOptions) error {
	t.Helper()
	done := make(chan error, 1)
	go func() { done <- serve(opts) }()
	select {
	case err := <-done:
		return err
	case <-time.After(30 * time.Second):
		t.Fatal("serve did not fail; the planted startup fault is no longer one")
		return nil
	}
}

func TestServeReportsStartupResourceFailures(t *testing.T) {
	t.Run("database path is a directory", func(t *testing.T) {
		dataDir := t.TempDir()
		if err := os.MkdirAll(filepath.Join(dataDir, "octobus.db"), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := serveUntilFailure(t, serveOptions{dataDir: dataDir, addr: "127.0.0.1:0", stderr: io.Discard}); err == nil {
			t.Fatal("expected the store open to fail")
		}
	})

	t.Run("access log path is a directory", func(t *testing.T) {
		dataDir := t.TempDir()
		if err := os.MkdirAll(filepath.Join(dataDir, "access.log"), 0o755); err != nil {
			t.Fatal(err)
		}
		err := serveUntilFailure(t, serveOptions{dataDir: dataDir, addr: "127.0.0.1:0", stderr: io.Discard})
		if err == nil || !strings.Contains(err.Error(), "open access log") {
			t.Fatalf("err=%v want an access log failure", err)
		}
	})

	t.Run("runtime rules cannot be written", func(t *testing.T) {
		file := filepath.Join(t.TempDir(), "file")
		if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		err := serveUntilFailure(t, serveOptions{
			dataDir:          filepath.Join(file, "data"),
			addr:             "127.0.0.1:0",
			runtimeHardening: hardening.LevelNode,
			stderr:           io.Discard,
		})
		if err == nil || !strings.Contains(err.Error(), "runtime hardening") {
			t.Fatalf("err=%v want a runtime hardening failure", err)
		}
	})

	t.Run("admin authentication is uninitialized", func(t *testing.T) {
		t.Setenv("OCTOBUS_BOOTSTRAP_ADMIN_TOKEN", "")
		err := serveUntilFailure(t, serveOptions{dataDir: t.TempDir(), addr: "127.0.0.1:0", stderr: io.Discard})
		if err == nil || !strings.Contains(err.Error(), "initialize admin authentication") {
			t.Fatalf("err=%v want an admin authentication failure", err)
		}
	})
}

// initializeAdminAuth warns on os.Stderr when the caller supplied no writer, so
// the fixed dev token is announced even on the code path that has no logger yet.
func TestInitializeAdminAuthDevWarnsOnStderrWithoutAWriter(t *testing.T) {
	t.Setenv("OCTOBUS_BOOTSTRAP_ADMIN_TOKEN", "")
	st, err := store.Open(filepath.Join(t.TempDir(), "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	drain := captureStderr(t)
	err = initializeAdminAuth(context.Background(), st, adminAuthOptions{dev: true, addr: "127.0.0.1:9000"})
	warning := drain()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(warning, devAdminTokenSecret) {
		t.Fatalf("stderr=%q want it to name the dev token", warning)
	}
}

func TestCheckLeftoverDevAdminTokenWarnsOnStderrAndRejectsBadAddress(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	if _, err := st.AddAdminToken(ctx, domain.AdminToken{ID: devAdminTokenID, Name: devAdminTokenName}, devAdminTokenSecret); err != nil {
		t.Fatal(err)
	}

	t.Run("no writer warns on stderr", func(t *testing.T) {
		drain := captureStderr(t)
		err := checkLeftoverDevAdminToken(ctx, st, "127.0.0.1:9000", nil)
		warning := drain()
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(warning, devAdminTokenID) {
			t.Fatalf("stderr=%q want it to name the leftover token", warning)
		}
	})

	t.Run("unparsable address is rejected", func(t *testing.T) {
		err := checkLeftoverDevAdminToken(ctx, st, "not-an-address", io.Discard)
		if err == nil || !strings.Contains(err.Error(), "parse listen address") {
			t.Fatalf("err=%v want an address parse failure", err)
		}
	})
}

func TestListenAddrIsLoopbackRejectsMalformedAddress(t *testing.T) {
	if _, err := listenAddrIsLoopback("not-an-address"); err == nil {
		t.Fatal("expected a split host/port error")
	}
}

func TestListenAddrIsLoopbackTreatsHostnamesAsRemote(t *testing.T) {
	ok, err := listenAddrIsLoopback("octobus.example:9000")
	if err != nil {
		t.Fatalf("err=%v want a resolved non-loopback host", err)
	}
	if ok {
		t.Fatal("a hostname is not a loopback address")
	}
}
