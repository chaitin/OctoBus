//go:build !windows

package hardening

import (
	"errors"
	"os"
	"os/exec"
	"syscall"
)

func setProcessGroup(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true
}

func ownsProcessGroup(cmd *exec.Cmd) bool {
	return cmd.SysProcAttr != nil && cmd.SysProcAttr.Setpgid
}

// Signal delivers sig to the runtime. A runtime started with its own process
// group receives it group-wide, so descendants are signalled too.
func Signal(cmd *exec.Cmd, sig os.Signal) error {
	if cmd == nil || cmd.Process == nil {
		return os.ErrProcessDone
	}
	proc := cmd.Process
	sysSig, ok := sig.(syscall.Signal)
	if !ok || !ownsProcessGroup(cmd) {
		return proc.Signal(sig)
	}
	// Once the leader is reaped its pid may be reused by an unrelated group.
	// os.Process tracks reaping and is safe to query while Wait runs. A reap
	// between this check and the group signal still leaves a narrow window,
	// which also needs the kernel to reuse the pid inside it.
	if err := proc.Signal(syscall.Signal(0)); errors.Is(err, os.ErrProcessDone) {
		return err
	}
	if err := syscall.Kill(-proc.Pid, sysSig); err != nil {
		if errors.Is(err, syscall.ESRCH) {
			return proc.Signal(sig)
		}
		return err
	}
	return nil
}

// Kill forcibly terminates the runtime and, when it owns a process group, all
// of its descendants.
func Kill(cmd *exec.Cmd) error {
	return Signal(cmd, syscall.SIGKILL)
}

// KillGroup terminates descendants left in the runtime's process group after
// the leader exited. Call it right after Wait returns.
//
// Wait has already reaped the leader, so its pid is free for the kernel to
// reuse, and a group signal could in principle reach a new group that took it
// over. KillGroup therefore skips the signal whenever a live process holds
// that pid: a reaped leader whose pid resolves to nothing can only leave
// behind this runtime's own orphaned group, while a pid that is alive again
// belongs to someone else. The cost of that check is a missed cleanup in a
// rare race; the alternative is killing an unrelated group.
func KillGroup(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil || !ownsProcessGroup(cmd) {
		return
	}
	pid := cmd.Process.Pid
	if err := syscall.Kill(pid, 0); err == nil || !errors.Is(err, syscall.ESRCH) {
		return
	}
	_ = syscall.Kill(-pid, syscall.SIGKILL)
}
