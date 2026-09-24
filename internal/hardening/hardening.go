// Package hardening prepares Node service runtime processes. At LevelOff a
// runtime launches just as the daemon itself runs. At LevelNode it gets an
// environment allowlist, the Node.js permission model, a heap limit, and a
// dedicated process group so stop signals reach its descendants.
package hardening

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// maxOldSpaceMB caps the V8 old-generation heap of a runtime process at
// LevelNode. It is deliberately not configurable: a per-daemon knob cannot
// express per-service needs, so a service that needs more memory is a reason
// to revisit the limit, not to tune it per deployment.
const maxOldSpaceMB = 512

// passthroughEnv lists daemon environment variables a runtime may inherit.
// Everything else, including credentials exported in the daemon's shell and
// any caller-provided NODE_OPTIONS, is dropped.
var passthroughEnv = []string{
	"PATH",
	"LANG",
	"LC_ALL",
	"TZ",
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"NO_PROXY",
	"http_proxy",
	"https_proxy",
	"no_proxy",
	"NODE_EXTRA_CA_CERTS",
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
	// Windows needs these to resolve executables and system libraries.
	"SystemRoot",
	"PATHEXT",
	"COMSPEC",
}

// Spec describes how one runtime process is launched.
type Spec struct {
	// Level selects how much of the runtime's behavior is restricted.
	Level Level
	// ServiceDir holds the runtime code, node_modules, and descriptor; read-only.
	ServiceDir string
	// Workdir holds instance config, logs, and temp files; read-write.
	Workdir string
	// Env carries OCTOBUS_* context variables appended to the environment.
	Env []string
	// Node describes the node binary, as reported by CheckNode. It is required
	// at LevelNode.
	Node Node
}

// Apply configures cmd to run as described by spec. It must be called before
// cmd.Start.
func Apply(cmd *exec.Cmd, spec Spec) error {
	// Both dirs are required at every level, although only LevelNode uses
	// them, so a caller that omits them fails at once rather than only after
	// the level is switched to node.
	if spec.ServiceDir == "" || spec.Workdir == "" {
		return fmt.Errorf("hardening: service dir and workdir are required")
	}
	// Validate the level here too, not only in ParseLevel: Level is set
	// directly on Supervisor and Gateway, and an unknown level must fail
	// closed rather than launch the runtime unrestricted. An empty level is
	// LevelOff, as in ParseLevel and the zero Supervisor and Gateway.
	switch spec.Level {
	case "", LevelOff:
		cmd.Env = append(os.Environ(), spec.Env...)
		return nil
	case LevelNode:
	default:
		return fmt.Errorf("hardening: unsupported level %q", spec.Level)
	}
	if spec.Node == (Node{}) {
		return fmt.Errorf("hardening: level %s requires a node checked at daemon startup", LevelNode)
	}
	setProcessGroup(cmd)
	tmpDir := filepath.Join(spec.Workdir, "tmp")
	if err := os.MkdirAll(tmpDir, 0o700); err != nil {
		return fmt.Errorf("hardening: create runtime temp dir: %w", err)
	}
	// Node realpaths the entry script and stats each symlinked ancestor (such as
	// /var on macOS), which lies outside the granted dirs. Launching from the
	// resolved paths keeps that walk inside the grant.
	if resolved, err := filepath.EvalSymlinks(cmd.Path); err == nil {
		cmd.Path = resolved
	}
	if cmd.Dir != "" {
		if resolved, err := filepath.EvalSymlinks(cmd.Dir); err == nil {
			cmd.Dir = resolved
		}
	}
	cmd.Env = runtimeEnv(spec)
	return nil
}

// runtimeEnv returns the LevelNode environment for a runtime process. It
// ignores spec.Level; callers go through Apply, which checks the level first.
func runtimeEnv(spec Spec) []string {
	env := make([]string, 0, len(passthroughEnv)+len(spec.Env)+6)
	for _, key := range passthroughEnv {
		if value, ok := os.LookupEnv(key); ok {
			env = append(env, key+"="+value)
		}
	}
	tmpDir := filepath.Join(spec.Workdir, "tmp")
	env = append(env,
		"HOME="+spec.Workdir,
		"USERPROFILE="+spec.Workdir,
		// os.tmpdir() reads TMPDIR on Unix and TEMP/TMP on Windows.
		"TMPDIR="+tmpDir,
		"TEMP="+tmpDir,
		"TMP="+tmpDir,
		"NODE_OPTIONS="+nodeOptions(spec),
	)
	return append(env, spec.Env...)
}

// nodeOptions builds the NODE_OPTIONS value enabling the Node.js permission
// model. Runtime entries are shebang scripts, so flags cannot be passed on the
// command line directly.
func nodeOptions(spec Spec) string {
	opts := []string{"--permission"}
	for _, dir := range pathVariants(spec.ServiceDir, spec.Workdir) {
		opts = append(opts, "--allow-fs-read="+quoteNodeOption(dir))
	}
	for _, dir := range pathVariants(spec.Workdir) {
		opts = append(opts, "--allow-fs-write="+quoteNodeOption(dir))
	}
	if spec.Node.grantsNet() {
		opts = append(opts, "--allow-net")
	}
	opts = append(opts, fmt.Sprintf("--max-old-space-size=%d", maxOldSpaceMB))
	return strings.Join(opts, " ")
}

// pathVariants returns each absolute path plus its symlink-resolved form when
// different. Node's module loader checks realpaths (for example /private/var on
// macOS), while other fs calls check the path as given.
func pathVariants(paths ...string) []string {
	seen := map[string]bool{}
	var out []string
	add := func(p string) {
		if p != "" && !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	for _, p := range paths {
		if p == "" {
			// filepath.Abs("") is the daemon's cwd; never grant it implicitly.
			continue
		}
		if abs, err := filepath.Abs(p); err == nil {
			p = abs
		}
		add(p)
		if resolved, err := filepath.EvalSymlinks(p); err == nil {
			add(resolved)
		}
	}
	return out
}

// quoteNodeOption quotes a value so NODE_OPTIONS keeps paths containing spaces,
// quotes, or Windows backslashes intact.
func quoteNodeOption(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `"`, `\"`)
	return `"` + value + `"`
}
