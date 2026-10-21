//go:build windows

package supervisor

import "os"

// killPID terminates pid. Windows has no POSIX signals, so TerminateProcess
// (os.Process.Kill) is the SIGKILL equivalent.
func killPID(pid int) error {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	defer proc.Release()
	return proc.Kill()
}

// killPIDProbe opens a handle to test liveness. os.FindProcess runs
// OpenProcess, which fails when pid is not running; an exited process whose
// object is still open stays reachable, matching the Unix probe's
// zombie-counts-as-alive rule.
func killPIDProbe(pid int) error {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return proc.Release()
}
