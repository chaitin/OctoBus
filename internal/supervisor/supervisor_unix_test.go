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

	"octobus/internal/hardening"
	"octobus/internal/proctest"
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
	// Only a child that is still running is ours to kill; a pid that exited may
	// already belong to another process.
	defer func() {
		if !proctest.Exited(pid) {
			_ = syscall.Kill(pid, syscall.SIGKILL)
		}
	}()
	proctest.WaitExited(t, pid)
}
