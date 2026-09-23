package hardening

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"slices"
	"strconv"
	"strings"
	"time"
)

// Node describes the node binary that runtimes launch with. Its zero value
// means node was never checked, and Apply rejects it at LevelNode: guessing
// would either drop network access on Node.js 25+ or pass a flag that older
// versions refuse to start with.
type Node struct {
	major int
}

// grantsNet reports whether the permission model gates network access
// (Node.js 25+). Earlier versions reject --allow-net in NODE_OPTIONS, so the
// flag is only passed when it is needed to keep network access.
func (n Node) grantsNet() bool {
	return n.major >= 25
}

// checkWaitDelay bounds how long a node check waits for its output after the
// context ends, so a descendant holding the pipes cannot stall startup.
const checkWaitDelay = time.Second

// CheckNode verifies that the node on PATH supports the stable --permission
// flag and starts the way a hardened runtime starts. Runtimes resolve node
// through the same PATH, so a node that fails here would otherwise make every
// hardened runtime exit at startup.
func CheckNode(ctx context.Context) (Node, error) {
	// Runtimes never inherit the daemon's NODE_OPTIONS, so neither check does:
	// a flag there that node rejects must not fail or skew the checks.
	env := slices.DeleteFunc(os.Environ(), func(entry string) bool {
		return strings.HasPrefix(entry, "NODE_OPTIONS=")
	})
	version := exec.CommandContext(ctx, "node", "--version")
	version.Env = env
	version.WaitDelay = checkWaitDelay
	out, err := version.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return Node{}, fmt.Errorf("run node --version: %w: %s", err, strings.TrimSpace(string(exitErr.Stderr)))
		}
		return Node{}, fmt.Errorf("run node --version: %w", err)
	}
	versionText := strings.TrimSpace(string(out))
	node, err := ParseNodeVersion(versionText)
	if err != nil {
		return Node{}, err
	}
	// The version only predicts which flags node accepts, so run node once the
	// way a runtime runs: with the runtime environment, including
	// NODE_OPTIONS and HOME, and from the workdir. A temp dir stands in for
	// the service dir and workdir; its name has a space, so the quoted
	// directory grants are checked too.
	dir, err := os.MkdirTemp("", "octobus node probe ")
	if err != nil {
		return Node{}, fmt.Errorf("create node probe dir: %w", err)
	}
	defer os.RemoveAll(dir)
	spec := Spec{Level: LevelNode, Node: node, ServiceDir: dir, Workdir: dir}
	probe := exec.CommandContext(ctx, "node", "-e", "")
	probe.Env = Env(spec)
	probe.Dir = dir
	probe.WaitDelay = checkWaitDelay
	if out, err := probe.CombinedOutput(); err != nil {
		return Node{}, fmt.Errorf("node %s does not start as a hardened runtime (NODE_OPTIONS %q): %w: %s", versionText, NodeOptions(spec), err, strings.TrimSpace(string(out)))
	}
	return node, nil
}

// ParseNodeVersion accepts `node --version` output for versions whose
// --permission flag is stable: 22.13+, 23.5+, and 24+.
func ParseNodeVersion(version string) (Node, error) {
	parts := strings.SplitN(strings.TrimPrefix(version, "v"), ".", 3)
	if len(parts) < 2 {
		return Node{}, fmt.Errorf("unrecognized node version %q", version)
	}
	major, errMajor := strconv.Atoi(parts[0])
	minor, errMinor := strconv.Atoi(parts[1])
	if errMajor != nil || errMinor != nil {
		return Node{}, fmt.Errorf("unrecognized node version %q", version)
	}
	supported := major >= 24 || (major == 23 && minor >= 5) || (major == 22 && minor >= 13)
	if !supported {
		return Node{}, fmt.Errorf("node %s does not support --permission; runtime hardening level node requires Node.js 22.13+, 23.5+, or 24+", version)
	}
	return Node{major: major}, nil
}
