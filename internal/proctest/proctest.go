//go:build !windows

// Package proctest helps tests wait for processes they did not start directly,
// such as descendants of a runtime, to exit.
package proctest

import (
	"bytes"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// Exited reports whether pid has exited. A zombie counts as exited: signal 0
// still reaches it, and in a container whose init does not reap orphans it
// stays in the process table indefinitely.
func Exited(pid int) bool {
	if syscall.Kill(pid, 0) != nil {
		return true
	}
	if raw, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat"); err == nil {
		// The state field follows the parenthesised command name.
		if i := bytes.LastIndexByte(raw, ')'); i >= 0 && i+2 < len(raw) {
			return raw[i+2] == 'Z'
		}
		return false
	}
	// No procfs (macOS): ask ps. It fails once the pid is gone, and the next
	// signal 0 check reports that.
	out, err := exec.Command("ps", "-o", "stat=", "-p", strconv.Itoa(pid)).Output()
	return err == nil && strings.HasPrefix(strings.TrimSpace(string(out)), "Z")
}

// WaitExited fails t unless pid exits within five seconds.
func WaitExited(t testing.TB, pid int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if Exited(pid) {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("process %d is still running", pid)
}
