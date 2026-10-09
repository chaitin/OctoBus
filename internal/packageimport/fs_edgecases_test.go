package packageimport

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// The sweeps walk directories the daemon shares with whatever else has written
// into the data dir, so they must skip entries that do not match the layout they
// own instead of failing on them.
func TestRecoverServiceDirsIgnoresEntriesThatAreNotServiceDirs(t *testing.T) {
	dataDir, s := openTestStore(t)
	importer := &Importer{DataDir: dataDir, Store: s}
	_, servicesDir := importRecoveryFixture(t, importer)

	// Regular files whose names match the staging and backup shapes. Removing the
	// first or rolling the second back would destroy data the layout never owned.
	writeTestFile(t, filepath.Join(servicesDir, ".staging-junk"), "not a dir", 0o644)
	writeTestFile(t, filepath.Join(servicesDir, ".echo.previous"), "not a dir", 0o644)

	report, err := importer.RecoverServiceDirs(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Staging) != 0 || len(report.Restored) != 0 || len(report.Discarded) != 0 {
		t.Fatalf("report=%+v want no action", report)
	}
	if got := mustReadFile(t, filepath.Join(servicesDir, ".staging-junk")); string(got) != "not a dir" {
		t.Fatalf("staging-shaped file was modified: %q", got)
	}
	if got := mustReadFile(t, filepath.Join(servicesDir, ".echo.previous")); string(got) != "not a dir" {
		t.Fatalf("backup-shaped file was modified: %q", got)
	}
	if _, err := s.GetService(context.Background(), "echo"); err != nil {
		t.Fatalf("imported service lost: %v", err)
	}
}

// A backup whose service row is gone belongs to a commit the store never saw, so
// the backup is the only copy of a version worth keeping: it is rolled back into
// place rather than discarded.
func TestRecoverServiceDirsRollsBackBackupWithNoStoreRow(t *testing.T) {
	dataDir, s := openTestStore(t)
	importer := &Importer{DataDir: dataDir, Store: s}
	servicesDir := filepath.Join(dataDir, "artifacts", "services")
	mustMkdirAll(t, filepath.Join(servicesDir, "ghost"))
	mustMkdirAll(t, filepath.Join(servicesDir, ".ghost.previous"))
	writeTestFile(t, filepath.Join(servicesDir, "ghost", "service.json"), `{"uncommitted":true}`, 0o644)
	writeTestFile(t, filepath.Join(servicesDir, ".ghost.previous", "service.json"), "{}", 0o644)

	report, err := importer.RecoverServiceDirs(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Restored) != 1 || report.Restored[0] != "ghost" {
		t.Fatalf("report=%+v want ghost restored", report)
	}
	if got := mustReadFile(t, filepath.Join(servicesDir, "ghost", "service.json")); string(got) != "{}" {
		t.Fatalf("live dir=%q want the backup contents", got)
	}
	if _, err := os.Stat(filepath.Join(servicesDir, ".ghost.previous")); !os.IsNotExist(err) {
		t.Fatalf("backup survived the rollback: %v", err)
	}
}

func TestSweepOrphanedTreesIgnoresFilesInTheTreeStore(t *testing.T) {
	dataDir := t.TempDir()
	servicesDirFor(t, dataDir)
	storeDir := sharedTreesDir(dataDir)
	mustMkdirAll(t, storeDir)
	writeTestFile(t, filepath.Join(storeDir, "README"), "not a tree", 0o644)
	makeSharedTree(t, dataDir, "orphan-tree")

	removed, err := (&Importer{DataDir: dataDir}).SweepOrphanedTrees(context.Background(), time.Now(), 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(removed) != 1 || filepath.Base(removed[0]) != "orphan-tree" {
		t.Fatalf("removed=%v want the orphan only", removed)
	}
	if got := mustReadFile(t, filepath.Join(storeDir, "README")); string(got) != "not a tree" {
		t.Fatalf("stray file was modified: %q", got)
	}
}

// With no services dir, nothing on disk can reference a tree, so every tree in
// the store is collectable.
func TestSweepOrphanedTreesCollectsEverythingWithoutServicesDir(t *testing.T) {
	dataDir := t.TempDir()
	orphan := makeSharedTree(t, dataDir, "orphan-tree")

	removed, err := (&Importer{DataDir: dataDir}).SweepOrphanedTrees(context.Background(), time.Now(), 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(removed) != 1 {
		t.Fatalf("removed=%v want the lone tree", removed)
	}
	if _, err := os.Stat(orphan); !os.IsNotExist(err) {
		t.Fatalf("tree survived: %v", err)
	}
}

// The walk stops below the deepest directory that can hold a link, so content
// hanging off a runtime tree is never visited and cannot pin a tree by accident.
func TestSweepOrphanedTreesIgnoresLinksBelowTheSupportedDepth(t *testing.T) {
	dataDir := t.TempDir()
	servicesDir := servicesDirFor(t, dataDir)
	makeSharedTree(t, dataDir, "deep-tree")
	tree := filepath.Join(sharedTreesDir(dataDir), "deep-tree")

	deepDir := filepath.Join(servicesDir, "echo", "runtime", "node_modules", "pkg")
	mustMkdirAll(t, deepDir)
	if err := os.Symlink(tree, filepath.Join(deepDir, "package")); err != nil {
		t.Fatal(err)
	}

	removed, err := (&Importer{DataDir: dataDir}).SweepOrphanedTrees(context.Background(), time.Now(), 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(removed) != 1 || filepath.Base(removed[0]) != "deep-tree" {
		t.Fatalf("removed=%v want the tree referenced only below the walked depth", removed)
	}
}
