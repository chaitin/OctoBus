package packageimport

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSweepStaleImportDirsRemovesOnlyOldTemporaryDirectories(t *testing.T) {
	root := t.TempDir()
	stale := filepath.Join(root, ".staging-echo-old")
	fresh := filepath.Join(root, ".staging-echo-fresh")
	unrelated := filepath.Join(root, "service")
	for _, path := range []string{stale, fresh, unrelated} {
		if err := os.Mkdir(path, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	old := time.Now().Add(-staleImportDirAge - time.Minute)
	if err := os.Chtimes(stale, old, old); err != nil {
		t.Fatal(err)
	}
	if err := sweepStaleImportDirs(root); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatalf("stale directory still exists: %v", err)
	}
	for _, path := range []string{fresh, unrelated} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("unexpectedly removed %s: %v", path, err)
		}
	}
}
