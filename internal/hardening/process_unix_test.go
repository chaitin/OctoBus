//go:build !windows

package hardening

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

// startWithGrandchild launches a shell that backgrounds a long sleep, writes
// the sleep's pid, and then runs leaderScript. It returns the grandchild pid.
func startWithGrandchild(t *testing.T, level Level, leaderScript string) (*exec.Cmd, string) {
	t.Helper()
	workdir := t.TempDir()
	pidFile := filepath.Join(workdir, "child.pid")
	cmd := exec.Command("/bin/sh", "-c", `sleep 30 & echo $! > "$1"; `+leaderScript, "sh", pidFile)
	if err := Apply(cmd, Spec{Level: level, Node: testNode(t, "v24.0.0"), ServiceDir: t.TempDir(), Workdir: workdir}); err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if raw, err := os.ReadFile(pidFile); err == nil && strings.TrimSpace(string(raw)) != "" {
			return cmd, strings.TrimSpace(string(raw))
		}
		time.Sleep(20 * time.Millisecond)
	}
	_ = Kill(cmd)
	t.Fatal("child pid not written")
	return nil, ""
}

func waitGone(t *testing.T, pid string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if exec.Command("kill", "-0", pid).Run() != nil {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("process %s survived", pid)
}

func TestKillReachesProcessGroup(t *testing.T) {
	cmd, childPID := startWithGrandchild(t, LevelNode, "wait")
	if err := Kill(cmd); err != nil {
		t.Fatal(err)
	}
	_ = cmd.Wait()
	waitGone(t, childPID)
}

func TestKillGroupReapsDescendantsAfterLeaderExits(t *testing.T) {
	// The leader exits on its own while its background child keeps running.
	cmd, childPID := startWithGrandchild(t, LevelNode, "exit 0")
	if err := cmd.Wait(); err != nil {
		t.Fatal(err)
	}
	if exec.Command("kill", "-0", childPID).Run() != nil {
		t.Fatal("grandchild exited before KillGroup; test is not exercising the orphan case")
	}
	KillGroup(cmd)
	waitGone(t, childPID)
}

func TestSignalAfterReapSkipsGroup(t *testing.T) {
	cmd, childPID := startWithGrandchild(t, LevelNode, "exit 0")
	if err := cmd.Wait(); err != nil {
		t.Fatal(err)
	}
	// The leader is reaped, so its pid may already belong to another group.
	if err := Signal(cmd, os.Interrupt); err != os.ErrProcessDone {
		t.Fatalf("Signal after reap = %v, want ErrProcessDone", err)
	}
	KillGroup(cmd)
	waitGone(t, childPID)
}

func TestKillGroupAtLevelOffIsNoop(t *testing.T) {
	cmd, childPID := startWithGrandchild(t, LevelOff, "exit 0")
	if err := cmd.Wait(); err != nil {
		t.Fatal(err)
	}
	KillGroup(cmd)
	time.Sleep(100 * time.Millisecond)
	if exec.Command("kill", "-0", childPID).Run() != nil {
		t.Fatal("KillGroup touched a runtime that shares the daemon process group")
	}
	_ = exec.Command("kill", childPID).Run()
}

func TestKillGroupSkipsReusedPid(t *testing.T) {
	// Stand in for a pid that a live, unrelated process group took over after
	// our leader was reaped: KillGroup must leave it alone.
	victim, victimChild := startWithGrandchild(t, LevelNode, "wait")
	defer func() {
		_ = Kill(victim)
		_ = victim.Wait()
	}()
	impostor := &exec.Cmd{SysProcAttr: &syscall.SysProcAttr{Setpgid: true}, Process: victim.Process}
	KillGroup(impostor)
	time.Sleep(200 * time.Millisecond)
	if exec.Command("kill", "-0", victimChild).Run() != nil {
		t.Fatal("KillGroup killed a live process group that reused the pid")
	}
}
