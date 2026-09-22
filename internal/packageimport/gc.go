package packageimport

import (
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// OrphanTreeMinAge is how long an unreferenced tree must sit untouched before
// collection removes it.
//
// The reference walk cannot see the window between a tree being published in
// prepareServiceRuntime and the first service directory linking to it in
// stageServiceCommit. That window is not short: a recursive import spans the
// whole service discovery and descriptor compilation loop in between, and a
// single import spans descriptor compilation.
//
// The window only matters if a second daemon sweeps while the first is
// importing, which the daemon cannot rule out -- imports are serialized per
// process, and shutdown waits on an in-flight import rather than cancelling
// it. Removing a tree in that window leaves the import renaming dangling links
// into place, and rename does not fail on a dangling link, so the damage
// surfaces only when the supervisor stats the entrypoint.
//
// An age floor defends against every shape of that window without needing to
// enumerate them, which is why it is the primary defence rather than the
// reference walk. Collection runs at startup, so the only trees skipped are
// ones published moments ago.
const OrphanTreeMinAge = time.Hour

// SweepOrphanedTrees removes shared runtime trees that no service directory
// points at any more.
//
// Nothing else reclaims them. A tree is published per distinct runtime content,
// so every change to a package's dependencies leaves the previous tree behind,
// and deleting a service never touches the filesystem at all. Without this the
// store grows without bound for the life of the daemon.
//
// Liveness is read from the links themselves rather than from the store,
// because the key is a composite fingerprint that cannot be recomputed from
// anything SQLite holds.
//
// A tree is removed only when it is both unreferenced and older than
// OrphanTreeMinAge. Both conditions matter: see the const for why the age floor
// carries the safety, and referencedSharedTrees for what the walk covers.
//
// Call this at startup, before the server accepts requests, so that no import
// can publish a tree while it runs.
func SweepOrphanedTrees(dataDir string, now time.Time, minAge time.Duration) ([]string, error) {
	storeDir := sharedTreesDir(dataDir)
	entries, err := os.ReadDir(storeDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	referenced, err := referencedSharedTrees(dataDir)
	if err != nil {
		return nil, err
	}
	var removed []string
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		path := filepath.Join(storeDir, entry.Name())
		if referenced[path] {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		if minAge > 0 && now.Sub(info.ModTime()) < minAge {
			continue
		}
		if err := os.RemoveAll(path); err != nil {
			return removed, fmt.Errorf("remove orphaned runtime tree %s: %w", path, err)
		}
		removed = append(removed, path)
	}
	return removed, nil
}

// referencedSharedTrees returns the set of shared tree paths that service
// directories link to, including trees reachable only through a crash backup or
// an import still in flight.
//
// Walks a fixed depth rather than only the live service directories, because
// a tree is created before it is linked into place:
//
//	services/<id>/{package,runtime}                          committed service
//	services/.<id>.previous/{package,runtime}                crash backup
//	services/.staging-<id>/service/{package,runtime}         import in flight
//	services/.staging-recursive-import/service/{pkg,runtime} import in flight
//
// Leaving out the staging entries would let a sweep running in a second daemon
// delete a tree the first daemon has published but not yet committed, and the
// import would then rename dangling links into place. The daemon cannot rule
// that out: imports are serialized per process, and shutdown waits on an
// in-flight import rather than cancelling it, so an operator who restarts
// against the same data dir can end up with two daemons.
func referencedSharedTrees(dataDir string) (map[string]bool, error) {
	servicesDir := filepath.Join(dataDir, "artifacts", "services")
	referenced := make(map[string]bool)
	err := filepath.WalkDir(servicesDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			if os.IsNotExist(err) {
				return nil
			}
			return err
		}
		if !d.IsDir() {
			return nil
		}
		// Depth guard: services/<entry>/<sub>/<name> is as deep as any layout
		// goes. Anything deeper cannot hold a tree link.
		rel, err := filepath.Rel(servicesDir, path)
		if err != nil {
			return nil
		}
		if depthOf(rel) > 3 {
			return filepath.SkipDir
		}
		for _, name := range []string{"package", "runtime"} {
			target, err := os.Readlink(filepath.Join(path, name))
			if err != nil {
				// Not a symlink: either an older layout with real directories,
				// or a service with no such entry. Neither references a tree.
				continue
			}
			referenced[filepath.Clean(target)] = true
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return referenced, nil
}

// depthOf counts path separators, with "." as depth 0.
func depthOf(rel string) int {
	if rel == "." {
		return 0
	}
	depth := 1
	for _, r := range rel {
		if r == filepath.Separator {
			depth++
		}
	}
	return depth
}
