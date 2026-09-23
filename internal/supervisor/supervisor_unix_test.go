//go:build !windows

package supervisor

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"octobus/internal/hardening"
)

func TestFailedStartKillsHardenedProcessGroup(t *testing.T) {
	dataDir, st, entry := setupSupervisorHelperRuntime(t)
	pidFile := filepath.Join(t.TempDir(), "child.pid")
	// The leader leaves a background child behind and exits before it ever
	// becomes healthy, so cleanup happens in cleanupFailedStart.
	script := fmt.Sprintf("#!/bin/sh\nsleep 30 &\necho $! > %q\nexit 1\n", pidFile)
	if err := os.WriteFile(filepath.Join(dataDir, "artifacts/services/echo/runtime", entry), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	sup := New(dataDir, st)
	sup.RuntimeHardening = hardening.LevelNode
	node, err := hardening.ParseNodeVersion("v24.0.0")
	if err != nil {
		t.Fatal(err)
	}
	sup.RuntimeNode = node
	ctx := context.Background()
	if _, err := sup.CreateInstance(ctx, CreateInstanceRequest{ID: "echo-test", ServiceID: "echo", Start: false}); err != nil {
		t.Fatal(err)
	}
	if err := sup.Start(ctx, "echo-test"); err == nil {
		t.Fatal("expected start to fail health check")
	}
	raw, err := os.ReadFile(pidFile)
	if err != nil {
		t.Fatal(err)
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if syscall.Kill(pid, 0) != nil {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	_ = syscall.Kill(pid, syscall.SIGKILL)
	t.Fatalf("background child %d survived failed start", pid)
}
