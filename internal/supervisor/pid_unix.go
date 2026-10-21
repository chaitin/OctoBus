//go:build !windows

package supervisor

import "syscall"

// killPID sends SIGKILL to pid.
func killPID(pid int) error {
	return syscall.Kill(pid, syscall.SIGKILL)
}

// killPIDProbe sends signal 0 to test liveness.
func killPIDProbe(pid int) error {
	return syscall.Kill(pid, 0)
}
