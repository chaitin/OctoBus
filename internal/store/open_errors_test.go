package store

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// Opening has to fail loudly on a path the process cannot use, rather than
// returning a store that will fail later at the first write.
func TestOpenReportsUnusablePaths(t *testing.T) {
	t.Run("file is not a database", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "octobus.db")
		if err := os.WriteFile(path, []byte("this is not sqlite"), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := Open(path); err == nil {
			t.Fatal("opening a file that is not a database succeeded")
		}
	})

	t.Run("path is a directory", func(t *testing.T) {
		dir := t.TempDir()
		if _, err := Open(dir); err == nil {
			t.Fatal("opening a database where a directory is succeeded")
		}
	})

	t.Run("path is not creatable", func(t *testing.T) {
		if runtime.GOOS == "windows" {
			t.Skip("read-only directory permissions are not enforced the same way")
		}
		if os.Geteuid() == 0 {
			t.Skip("root ignores directory permissions")
		}
		dir := filepath.Join(t.TempDir(), "readonly")
		if err := os.MkdirAll(dir, 0o500); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = os.Chmod(dir, 0o700) })
		_, err := Open(filepath.Join(dir, "octobus.db"))
		if err == nil {
			t.Fatal("opening a database in a read-only directory succeeded")
		}
		if !strings.Contains(err.Error(), "permission denied") {
			t.Fatalf("err=%v want a permission failure", err)
		}
	})
}
