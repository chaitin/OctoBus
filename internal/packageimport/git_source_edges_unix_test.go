//go:build !windows

package packageimport

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A rev-parse answering with anything but a full commit SHA is a failure, not a
// revision to fetch: that SHA is what the import records and pins.
//
// The stub is a shell script, so this is guarded by a build constraint rather
// than a runtime check: on Windows a file named `git` with no executable
// extension is not found by exec at all, so the test would fail there rather
// than skip.
func TestRevParseCommitRejectsNonCommitOutput(t *testing.T) {
	binDir := t.TempDir()
	script := filepath.Join(binDir, "git")
	if err := os.WriteFile(script, []byte("#!/bin/sh\necho not-a-commit-sha\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	// exec resolves "git" against the test process PATH, so the stub has to come
	// first there rather than in the runner's environment.
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	runner := &gitRunner{
		source: gitSource{Original: "https://example.invalid/repo.git", Remote: "https://example.invalid/repo.git", Ref: "HEAD"},
	}
	if _, err := revParseCommit(context.Background(), runner, t.TempDir(), "HEAD"); err == nil || !strings.Contains(err.Error(), "invalid commit") {
		t.Fatalf("err=%v want an invalid commit error", err)
	}
}
