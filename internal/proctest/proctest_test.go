//go:build !windows

package proctest

import (
	"os/exec"
	"syscall"
	"testing"
	"time"
)

func TestExitedTreatsZombieAsExited(t *testing.T) {
	cmd := exec.Command("sleep", "30")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}()
	pid := cmd.Process.Pid
	if Exited(pid) {
		t.Fatal("running process reported as exited")
	}
	// Kill without Wait: the child stays a zombie until we reap it.
	if err := syscall.Kill(pid, syscall.SIGKILL); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for !Exited(pid) {
		if time.Now().After(deadline) {
			t.Fatal("zombie reported as running")
		}
		time.Sleep(20 * time.Millisecond)
	}
	if syscall.Kill(pid, 0) != nil {
		t.Fatal("test is not exercising a zombie: signal 0 no longer reaches it")
	}
}

func TestExitedKeepsProcessesWeCannotSignalRunning(t *testing.T) {
	// pid 1 is always running. A non-root caller gets EPERM from signal 0,
	// which must not read as exited.
	if Exited(1) {
		t.Fatal("pid 1 reported as exited")
	}
}

func TestWaitExitedReturnsOnceTheProcessExits(t *testing.T) {
	cmd := exec.Command("sleep", "0.2")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		close(done)
	}()
	WaitExited(t, cmd.Process.Pid)
	<-done
}
