// Package egressrules ships the egress restrictions a service runtime loads, and
// where they are written. Whether they are injected is the hardening level's
// decision, not this package's.
package egressrules

import (
	"bytes"
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
)

// rulesSource holds the rules, embedded so the file a runtime loads is
// always the file this binary was built with.
//
//go:embed rules.cjs
var rulesSource []byte

const (
	// supportDirName is the data directory subtree the rules are written to. It
	// is not under artifacts/services, which a service import replaces
	// wholesale (internal/packageimport replaceServiceDir).
	supportDirName = "runtime-support"
	rulesFileName  = "egress-rules.cjs"
)

// RefusalMarker is the prefix the rules write to a runtime's standard error when
// they refuse a destination. The daemon looks for it in an on-demand runtime's
// output, which reaches nobody otherwise: a long-running runtime writes the line
// into its own instance log, and an on-demand runtime has no such log.
//
// Kept in step with the string rules.cjs writes, which the rules' own test
// checks.
const RefusalMarker = "egress refused: "

// Path returns the file Ensure writes the rules to. It is the single definition
// of that path, so the file the daemon writes and the file a runtime is told to
// load cannot drift apart.
func Path(dataDir string) string {
	return filepath.Join(dataDir, supportDirName, rulesFileName)
}

// Ensure writes the rules into dataDir and returns its path.
//
// It creates dataDir as well: the daemon's own MkdirAll runs after the node
// check, and this file has to exist before that check, which loads it to probe
// whether a hardened runtime starts.
func Ensure(dataDir string) (string, error) {
	if dataDir == "" {
		return "", fmt.Errorf("egressrules: data dir is required")
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return "", fmt.Errorf("egressrules: create data dir: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(Path(dataDir)), 0o755); err != nil {
		return "", fmt.Errorf("egressrules: create %s: %w", supportDirName, err)
	}
	path := Path(dataDir)
	// Leave an identical file alone; that is the ordinary case after the first
	// startup.
	if existing, err := os.ReadFile(path); err == nil && bytes.Equal(existing, rulesSource) {
		return path, nil
	}
	if err := os.WriteFile(path, rulesSource, 0o644); err != nil {
		return "", fmt.Errorf("egressrules: write rules: %w", err)
	}
	return path, nil
}
