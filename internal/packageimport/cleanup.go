package packageimport

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// importMu serializes import runs inside one daemon process.
//
// Staging lives at fixed paths under artifacts/services: .staging-<serviceID>
// for a single import, .staging-recursive-import for a recursive one. Without
// this lock two concurrent imports would RemoveAll each other's in-flight
// staging tree, and two imports of the same service id would race on the same
// final service directory and the same .<id>.previous backup path.
var importMu sync.Mutex

// StaleImportDirAge is how long an abandoned staging directory must sit
// untouched before the startup sweep removes it.
//
// The sweep only runs at daemon startup, when in principle no import can be in
// flight, so this is a second line of defence rather than the primary
// guarantee. It matters because nothing bounds shutdown: a daemon waiting on an
// in-flight import does not exit, so an operator restarting it can end up with
// a new daemon sweeping the old one's live staging tree.
const StaleImportDirAge = 24 * time.Hour

// SweepResult reports what the startup sweep found.
type SweepResult struct {
	// Removed lists directories that were reclaimed.
	Removed []string
	// Stranded lists .<id>.previous directories that were deliberately kept
	// because the live service directory is missing, making them the only
	// remaining copy of that service. An operator has to restore or discard
	// them by hand.
	Stranded []string
}

// SweepStaleImportDirs removes staging and backup directories left behind by
// imports that were killed before their deferred cleanup could run.
//
// Two kinds of leftovers accumulate, and they are not equally disposable:
//
//   - .staging-<id> and .staging-recursive-import: nothing references these, so
//     an old one is always safe to remove. Each holds a full copy of the
//     package tree, which is why they are worth reclaiming.
//
//   - .<id>.previous: the process died between the two renames in
//     replaceServiceDir. Whether this is garbage or the only surviving copy
//     depends on whether the service directory it was renamed away from got
//     replaced before the crash. It is removed only when artifacts/services/<id>
//     is present, which means the swap completed and the backup is superseded.
//     When the live directory is absent the backup is the last copy of that
//     service and is reported as stranded instead.
//
// The age check applies only to staging. It cannot be used for .<id>.previous:
// os.Rename does not update the renamed directory's mtime, so a backup inherits
// the mtime of the service directory it came from and appears arbitrarily old
// the moment it is created. An age check there would delete a just-created
// backup immediately -- exactly the copy an operator needs.
//
// Call this before the daemon starts serving requests.
func SweepStaleImportDirs(dataDir string, now time.Time, minAge time.Duration) (SweepResult, error) {
	servicesDir := filepath.Join(dataDir, "artifacts", "services")
	entries, err := os.ReadDir(servicesDir)
	if err != nil {
		if os.IsNotExist(err) {
			return SweepResult{}, nil
		}
		return SweepResult{}, err
	}
	var result SweepResult
	for _, entry := range entries {
		name := entry.Name()
		path := filepath.Join(servicesDir, name)

		switch {
		case isStagingDirName(name):
			info, err := entry.Info()
			if err != nil {
				continue
			}
			if minAge > 0 && now.Sub(info.ModTime()) < minAge {
				continue
			}
			if err := os.RemoveAll(path); err != nil {
				return result, fmt.Errorf("remove stale import dir %s: %w", path, err)
			}
			result.Removed = append(result.Removed, path)

		case isBackupDirName(name):
			if backupIsSuperseded(servicesDir, name) {
				if err := os.RemoveAll(path); err != nil {
					return result, fmt.Errorf("remove stale import dir %s: %w", path, err)
				}
				result.Removed = append(result.Removed, path)
				continue
			}
			result.Stranded = append(result.Stranded, path)
		}
	}
	return result, nil
}

// backupIsSuperseded reports whether the live service directory for a
// .<id>.previous backup is present, meaning the swap completed and the backup
// is no longer the current version.
func backupIsSuperseded(servicesDir, backupName string) bool {
	serviceID := strings.TrimSuffix(strings.TrimPrefix(backupName, "."), ".previous")
	if serviceID == "" {
		return false
	}
	_, err := os.Lstat(filepath.Join(servicesDir, serviceID))
	return err == nil
}

func isStagingDirName(name string) bool {
	return strings.HasPrefix(name, ".staging-")
}

func isBackupDirName(name string) bool {
	return strings.HasPrefix(name, ".") && strings.HasSuffix(name, ".previous")
}
