//go:build !windows

package hardening

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// stubNode puts a node on PATH that runs body with no arguments at all, so the
// checks that run before the runtime probe can be driven independently.
func stubNode(t *testing.T, body string) {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "node"), []byte("#!/bin/sh\n"+body+"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
}

// Both failure modes of the version query have to name what node did: a node
// that cannot run at all, and one whose version cannot be read.
func TestCheckNodeReportsVersionQueryFailures(t *testing.T) {
	t.Run("node does not run", func(t *testing.T) {
		stubNode(t, `echo "node: command not found" >&2; exit 127`)
		_, err := CheckNode(context.Background(), testRules(t))
		if err == nil || !strings.Contains(err.Error(), "run node --version") {
			t.Fatalf("CheckNode = %v, want a version query failure", err)
		}
	})

	t.Run("version cannot be parsed", func(t *testing.T) {
		stubNode(t, `echo "not-a-version"; exit 0`)
		_, err := CheckNode(context.Background(), testRules(t))
		if err == nil || !strings.Contains(err.Error(), "unrecognized node version") {
			t.Fatalf("CheckNode = %v, want a version parse failure", err)
		}
	})
}
