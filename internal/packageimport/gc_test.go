package packageimport

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func makeSharedTree(t *testing.T, dataDir, key string) string {
	t.Helper()
	dir := filepath.Join(sharedTreesDir(dataDir), key)
	mustMkdirAll(t, dir)
	writeTestFile(t, filepath.Join(dir, "service.json"), "{}", 0o644)
	return dir
}

func TestSweepOrphanedTreesRemovesUnreferenced(t *testing.T) {
	dataDir := t.TempDir()
	servicesDir := servicesDirFor(t, dataDir)
	live := makeSharedTree(t, dataDir, "live-tree")
	orphan := makeSharedTree(t, dataDir, "orphan-tree")

	// One service links at the live tree.
	mustMkdirAll(t, filepath.Join(servicesDir, "echo"))
	if err := os.Symlink(live, filepath.Join(servicesDir, "echo", "runtime")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(live, filepath.Join(servicesDir, "echo", "package")); err != nil {
		t.Fatal(err)
	}

	removed, err := SweepOrphanedTrees(dataDir, time.Now(), 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(removed) != 1 || filepath.Base(removed[0]) != "orphan-tree" {
		t.Fatalf("removed=%v, want the orphan only", removed)
	}
	if _, err := os.Stat(live); err != nil {
		t.Fatalf("referenced tree was removed: %v", err)
	}
	if _, err := os.Stat(orphan); !os.IsNotExist(err) {
		t.Fatalf("orphan tree survived: %v", err)
	}
}

// A backup kept by SweepStaleImportDirs because its live service directory is
// missing is the only copy of that service. The tree it points at must not be
// collected out from under it.
func TestSweepOrphanedTreesKeepsTreeReferencedOnlyByStrandedBackup(t *testing.T) {
	dataDir := t.TempDir()
	servicesDir := servicesDirFor(t, dataDir)
	tree := makeSharedTree(t, dataDir, "stranded-tree")

	backup := filepath.Join(servicesDir, ".echo.previous")
	mustMkdirAll(t, backup)
	if err := os.Symlink(tree, filepath.Join(backup, "runtime")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(tree, filepath.Join(backup, "package")); err != nil {
		t.Fatal(err)
	}

	// Confirm the staging sweep keeps this backup, then that GC keeps its tree.
	swept, err := SweepStaleImportDirs(dataDir, time.Now(), 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(swept.Stranded) != 1 {
		t.Fatalf("stranded=%v, want the backup to be preserved", swept.Stranded)
	}

	removed, err := SweepOrphanedTrees(dataDir, time.Now(), 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(removed) != 0 {
		t.Fatalf("removed=%v, want none: the stranded backup still needs this tree", removed)
	}
	// The backup must still resolve through the link.
	if _, err := os.Stat(filepath.Join(backup, "runtime", "service.json")); err != nil {
		t.Fatalf("stranded backup lost its tree: %v", err)
	}
}

// A tree is published before it is linked into place, so between those two
// steps it has no reference under a live service directory. A sweep running in
// a second daemon must not collect it, or the first daemon renames dangling
// links into place and the service fails at start with "runtime entry is not
// available".
//
// Two daemons on one data dir is reachable: imports are serialized per process
// and shutdown waits on an in-flight import rather than cancelling it, so a
// restart can overlap the old daemon.
func TestSweepOrphanedTreesKeepsTreeOfImportInFlight(t *testing.T) {
	for _, name := range []string{".staging-recursive-import", ".staging-echo"} {
		t.Run(name, func(t *testing.T) {
			dataDir := t.TempDir()
			servicesDir := servicesDirFor(t, dataDir)
			tree := makeSharedTree(t, dataDir, "inflight-tree")

			// The commit directory stageServiceCommit builds, after publish and
			// before replaceServiceDir renames it into place.
			commit := filepath.Join(servicesDir, name, "service")
			mustMkdirAll(t, commit)
			for _, entry := range []string{"package", "runtime"} {
				if err := os.Symlink(tree, filepath.Join(commit, entry)); err != nil {
					t.Fatal(err)
				}
			}

			removed, err := SweepOrphanedTrees(dataDir, time.Now(), 0)
			if err != nil {
				t.Fatal(err)
			}
			if len(removed) != 0 {
				t.Fatalf("removed=%v, want none: the import in flight still needs this tree", removed)
			}
			for _, entry := range []string{"package", "runtime"} {
				if _, err := os.Stat(filepath.Join(commit, entry, "service.json")); err != nil {
					t.Fatalf("commit dir %s lost its tree: %v", entry, err)
				}
			}
		})
	}
}

// The depth-bounded walk must still descend far enough to see every layout,
// and must not treat a deep unrelated directory as a reference.
func TestSweepOrphanedTreesStillCollectsRealOrphan(t *testing.T) {
	dataDir := t.TempDir()
	servicesDir := servicesDirFor(t, dataDir)
	// A service with real directories, and a deep unrelated tree inside it.
	mustMkdirAll(t, filepath.Join(servicesDir, "legacy", "runtime", "node_modules", "deep"))
	orphan := makeSharedTree(t, dataDir, "real-orphan")

	removed, err := SweepOrphanedTrees(dataDir, time.Now(), 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(removed) != 1 || removed[0] != orphan {
		t.Fatalf("removed=%v, want the real orphan", removed)
	}
}

// A tree is published in prepareServiceRuntime, but the first service
// directory does not link to it until stageServiceCommit. Nothing references it
// in between, and that window is not short: a recursive import spans the whole
// service discovery and descriptor compilation loop.
//
// The reference walk cannot see this window, so the age floor has to. Without
// it a sweep in a second daemon collects a tree the first daemon is still
// using, and the import renames dangling links into place.
func TestSweepOrphanedTreesKeepsFreshlyPublishedTree(t *testing.T) {
	dataDir := t.TempDir()
	servicesDirFor(t, dataDir)
	// Published moments ago, no links yet.
	tree := makeSharedTree(t, dataDir, "just-published")

	removed, err := SweepOrphanedTrees(dataDir, time.Now(), OrphanTreeMinAge)
	if err != nil {
		t.Fatal(err)
	}
	if len(removed) != 0 {
		t.Fatalf("removed=%v, want none: a just-published tree may be an import in progress", removed)
	}
	if _, err := os.Stat(tree); err != nil {
		t.Fatalf("freshly published tree was collected: %v", err)
	}
}

// The age floor must not stop old orphans from being reclaimed, or the store
// grows without bound -- the thing collection exists to prevent.
func TestSweepOrphanedTreesCollectsAgedOrphan(t *testing.T) {
	dataDir := t.TempDir()
	servicesDirFor(t, dataDir)
	tree := makeSharedTree(t, dataDir, "aged-orphan")
	old := time.Now().Add(-48 * time.Hour)
	if err := os.Chtimes(tree, old, old); err != nil {
		t.Fatal(err)
	}

	removed, err := SweepOrphanedTrees(dataDir, time.Now(), OrphanTreeMinAge)
	if err != nil {
		t.Fatal(err)
	}
	if len(removed) != 1 || removed[0] != tree {
		t.Fatalf("removed=%v, want the aged orphan", removed)
	}
}

// A referenced tree is kept regardless of age.
func TestSweepOrphanedTreesKeepsAgedButReferencedTree(t *testing.T) {
	dataDir := t.TempDir()
	servicesDir := servicesDirFor(t, dataDir)
	tree := makeSharedTree(t, dataDir, "aged-live")
	old := time.Now().Add(-48 * time.Hour)
	if err := os.Chtimes(tree, old, old); err != nil {
		t.Fatal(err)
	}
	mustMkdirAll(t, filepath.Join(servicesDir, "echo"))
	if err := os.Symlink(tree, filepath.Join(servicesDir, "echo", "runtime")); err != nil {
		t.Fatal(err)
	}

	removed, err := SweepOrphanedTrees(dataDir, time.Now(), OrphanTreeMinAge)
	if err != nil {
		t.Fatal(err)
	}
	if len(removed) != 0 {
		t.Fatalf("removed=%v, want none: the tree is still referenced", removed)
	}
}

func TestSweepOrphanedTreesKeepsRealDirectoriesAlone(t *testing.T) {
	dataDir := t.TempDir()
	servicesDir := servicesDirFor(t, dataDir)
	// An old-layout service with real directories references no tree.
	mustMkdirAll(t, filepath.Join(servicesDir, "legacy", "package"))
	mustMkdirAll(t, filepath.Join(servicesDir, "legacy", "runtime"))
	tree := makeSharedTree(t, dataDir, "unreferenced")

	removed, err := SweepOrphanedTrees(dataDir, time.Now(), 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(removed) != 1 || removed[0] != tree {
		t.Fatalf("removed=%v, want just the unreferenced tree", removed)
	}
	if _, err := os.Stat(filepath.Join(servicesDir, "legacy", "runtime")); err != nil {
		t.Fatalf("legacy service directory was touched: %v", err)
	}
}

func TestSweepOrphanedTreesMissingStore(t *testing.T) {
	removed, err := SweepOrphanedTrees(filepath.Join(t.TempDir(), "absent"), time.Now(), 0)
	if err != nil {
		t.Fatalf("expected no error for a missing store, got %v", err)
	}
	if len(removed) != 0 {
		t.Fatalf("removed=%v, want none", removed)
	}
}

// End to end: importing a package, then re-importing it after its content
// changes, leaves the superseded tree collectable.
func TestSweepOrphanedTreesAfterReimportWithChangedContent(t *testing.T) {
	ctx := context.Background()
	dataDir, s := openTestStore(t)
	imp := &Importer{DataDir: dataDir, Store: s}

	first := writeTestPackage(t, filepath.Join(t.TempDir(), "a"), `{"schema":"chaitin.octobus.service.v1","name":"echo-a","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	if _, err := imp.Import(ctx, Options{ServiceID: "echo", Source: first, Build: "never", Offline: true}); err != nil {
		t.Fatal(err)
	}
	if n := len(sharedTreeEntries(t, dataDir)); n != 1 {
		t.Fatalf("shared trees=%d, want 1", n)
	}

	// A genuinely different package produces a different key, so the previous
	// tree becomes unreferenced once the service directory is swapped.
	second := writeTestPackage(t, filepath.Join(t.TempDir(), "b"), `{"schema":"chaitin.octobus.service.v1","name":"echo-b","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	if _, err := imp.Import(ctx, Options{ServiceID: "echo", Source: second, Build: "never", Offline: true}); err != nil {
		t.Fatal(err)
	}
	if n := len(sharedTreeEntries(t, dataDir)); n != 2 {
		t.Fatalf("shared trees=%d, want 2 before collection", n)
	}

	removed, err := SweepOrphanedTrees(dataDir, time.Now(), 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(removed) != 1 {
		t.Fatalf("removed=%v, want the superseded tree", removed)
	}
	remaining := sharedTreeEntries(t, dataDir)
	if len(remaining) != 1 {
		t.Fatalf("shared trees=%d after collection, want 1", len(remaining))
	}
	// The surviving tree must be the one the service still points at.
	link, err := os.Readlink(filepath.Join(dataDir, "artifacts", "services", "echo", "runtime"))
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(link) != remaining[0] {
		t.Fatalf("collected the live tree: service points at %s, kept %v", filepath.Base(link), remaining)
	}
}
