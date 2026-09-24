//go:build windows

package hardening

import (
	"os"
	"os/exec"
)

func setProcessGroup(*exec.Cmd) {}

// Signal delivers sig to the runtime process. Windows has no POSIX process
// groups, so descendants are not signalled.
func Signal(cmd *exec.Cmd, sig os.Signal) error {
	if cmd == nil || cmd.Process == nil {
		return os.ErrProcessDone
	}
	return cmd.Process.Signal(sig)
}

// Kill forcibly terminates the runtime process.
func Kill(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return os.ErrProcessDone
	}
	return cmd.Process.Kill()
}

// KillGroup is a no-op on Windows, which has no POSIX process groups.
func KillGroup(*exec.Cmd) {}
