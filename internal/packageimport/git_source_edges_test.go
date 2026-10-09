package packageimport

import (
	"strings"
	"testing"
)

// A Git import needs git on PATH. When it is missing the failure has to name the
// fix rather than surface as a bare exec error from inside the import.
func TestNewGitRunnerRequiresGitOnPath(t *testing.T) {
	t.Setenv("PATH", "")
	src, err := parseGitSource("https://example.invalid/repo.git")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := newGitRunner(src, t.TempDir()); err == nil || !strings.Contains(err.Error(), "install git") {
		t.Fatalf("err=%v want a message naming the missing git", err)
	}
}
