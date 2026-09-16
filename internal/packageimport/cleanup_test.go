package packageimport

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func servicesDirFor(t *testing.T, dataDir string) string {
	t.Helper()
	dir := filepath.Join(dataDir, "artifacts", "services")
	mustMkdirAll(t, dir)
	return dir
}

func TestSweepRemovesStagingAndSupersededBackup(t *testing.T) {
	dataDir := t.TempDir()
	services := servicesDirFor(t, dataDir)
	mustMkdirAll(t, filepath.Join(services, ".staging-recursive-import", "runtime"))
	mustMkdirAll(t, filepath.Join(services, ".staging-echo", "package"))
	// A backup WITH a live service directory is superseded: the swap finished.
	mustMkdirAll(t, filepath.Join(services, ".echo.previous", "runtime"))
	mustMkdirAll(t, filepath.Join(services, "echo", "runtime"))
	mustMkdirAll(t, filepath.Join(services, "ondemand", "runtime"))

	result, err := SweepStaleImportDirs(dataDir, time.Now(), 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Removed) != 3 {
		t.Fatalf("removed=%v, want 3 entries", result.Removed)
	}
	if len(result.Stranded) != 0 {
		t.Fatalf("stranded=%v, want none", result.Stranded)
	}
	for _, name := range []string{".staging-recursive-import", ".staging-echo", ".echo.previous"} {
		if _, err := os.Stat(filepath.Join(services, name)); !os.IsNotExist(err) {
			t.Fatalf("expected %s to be removed, stat err=%v", name, err)
		}
	}
	for _, name := range []string{"echo", "ondemand"} {
		if _, err := os.Stat(filepath.Join(services, name, "runtime")); err != nil {
			t.Fatalf("expected live service %s to survive: %v", name, err)
		}
	}
}

// A backup whose live service directory is missing is the only surviving copy
// of that service. Deleting it would destroy the version an operator needs to
// restore, so the sweep must leave it alone and report it.
func TestSweepKeepsBackupWhenLiveServiceDirIsGone(t *testing.T) {
	dataDir := t.TempDir()
	services := servicesDirFor(t, dataDir)
	backup := filepath.Join(services, ".echo.previous")
	mustMkdirAll(t, filepath.Join(backup, "runtime"))
	writeTestFile(t, filepath.Join(backup, "runtime", "service.json"), "{}", 0o644)
	// No artifacts/services/echo exists: the process died between the two
	// renames in replaceServiceDir.

	result, err := SweepStaleImportDirs(dataDir, time.Now(), 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Removed) != 0 {
		t.Fatalf("removed=%v, want none: the backup is the last copy of echo", result.Removed)
	}
	if len(result.Stranded) != 1 || result.Stranded[0] != backup {
		t.Fatalf("stranded=%v, want [%s]", result.Stranded, backup)
	}
	if _, err := os.Stat(filepath.Join(backup, "runtime", "service.json")); err != nil {
		t.Fatalf("the last surviving copy was destroyed: %v", err)
	}
}

// os.Rename does not update the renamed directory's mtime, so a .previous
// directory inherits the mtime of the service directory it came from. An age
// based check would therefore treat a just-created backup as ancient and
// delete the only copy of the service. The sweep must not consult mtime for
// backups at all.
func TestSweepDoesNotAgeOutBackupWithInheritedMtime(t *testing.T) {
	dataDir := t.TempDir()
	services := servicesDirFor(t, dataDir)

	// Simulate a service imported long ago, then moved to .previous by a swap
	// that never completed.
	serviceDir := filepath.Join(services, "echo")
	mustMkdirAll(t, filepath.Join(serviceDir, "runtime"))
	old := time.Now().Add(-30 * 24 * time.Hour)
	if err := os.Chtimes(serviceDir, old, old); err != nil {
		t.Fatal(err)
	}
	backup := filepath.Join(services, ".echo.previous")
	if err := os.Rename(serviceDir, backup); err != nil {
		t.Fatal(err)
	}
	info, err := os.Lstat(backup)
	if err != nil {
		t.Fatal(err)
	}
	if time.Since(info.ModTime()) <= 24*time.Hour {
		t.Skip("this filesystem updates mtime on rename; the scenario cannot be reproduced here")
	}

	result, err := SweepStaleImportDirs(dataDir, time.Now(), 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Removed) != 0 {
		t.Fatalf("removed=%v, want none: the grace period must not be consulted for backups", result.Removed)
	}
	if len(result.Stranded) != 1 {
		t.Fatalf("stranded=%v, want the backup to be reported", result.Stranded)
	}
	if _, err := os.Stat(backup); err != nil {
		t.Fatalf("backup with inherited mtime was deleted: %v", err)
	}
}

func TestSweepStagingRespectsMinAge(t *testing.T) {
	dataDir := t.TempDir()
	services := servicesDirFor(t, dataDir)
	stale := filepath.Join(services, ".staging-echo")
	mustMkdirAll(t, stale)

	result, err := SweepStaleImportDirs(dataDir, time.Now(), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Removed) != 0 {
		t.Fatalf("removed=%v, want none inside the grace period", result.Removed)
	}
	if _, err := os.Stat(stale); err != nil {
		t.Fatalf("expected fresh staging dir to survive: %v", err)
	}

	old := time.Now().Add(-48 * time.Hour)
	if err := os.Chtimes(stale, old, old); err != nil {
		t.Fatal(err)
	}
	result, err = SweepStaleImportDirs(dataDir, time.Now(), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Removed) != 1 {
		t.Fatalf("removed=%v, want 1 entry", result.Removed)
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatalf("expected stale staging dir to be removed, stat err=%v", err)
	}
}

func TestSweepMissingServicesDir(t *testing.T) {
	result, err := SweepStaleImportDirs(filepath.Join(t.TempDir(), "absent"), time.Now(), 0)
	if err != nil {
		t.Fatalf("expected no error for a missing services dir, got %v", err)
	}
	if len(result.Removed) != 0 || len(result.Stranded) != 0 {
		t.Fatalf("result=%+v, want empty", result)
	}
}

func TestSweepLeavesUnrelatedDotDirs(t *testing.T) {
	dataDir := t.TempDir()
	services := servicesDirFor(t, dataDir)
	keep := filepath.Join(services, ".something-else")
	mustMkdirAll(t, keep)

	result, err := SweepStaleImportDirs(dataDir, time.Now(), 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Removed) != 0 || len(result.Stranded) != 0 {
		t.Fatalf("result=%+v, want empty", result)
	}
	if _, err := os.Stat(keep); err != nil {
		t.Fatalf("expected unrelated dot dir to survive: %v", err)
	}
}

func mustMkdirAll(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatal(err)
	}
}
