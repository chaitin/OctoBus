package packageimport

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"octobus/internal/domain"
)

// previousDirSuffix names the backup a commit keeps while it swaps a service
// dir into place. It is shared with replaceServiceDir.
const previousDirSuffix = ".previous"

// stagingDirPrefix names the working tree an import builds in and removes when
// it returns. Every staging dir shares the prefix so a startup sweep can find
// the ones a crash left behind.
const stagingDirPrefix = ".staging-"

// descriptorFileName is the compiled descriptor stored inside a service dir.
const descriptorFileName = "descriptor.protoset"

// ServiceDirRecovery reports what a startup sweep changed.
type ServiceDirRecovery struct {
	// Restored lists services whose interrupted commit was rolled back to the
	// version the store still describes.
	Restored []string
	// Discarded lists services whose backup was left behind by a commit that
	// completed.
	Discarded []string
	// Staging lists the working trees a crashed import left behind.
	Staging []string
}

// RecoverServiceDirs finishes service commits that a crash interrupted, and
// clears the working trees a crashed import abandoned.
//
// A commit swaps a service dir through `.<service id>.previous` and only then
// updates the store, so a crash can leave the service dir missing with its
// previous version in the backup, or leave the backup behind with the disk and
// the store possibly disagreeing. The store decides between the two: a service
// dir whose descriptor and package artifact both still hash to the stored
// values is the committed one and only needs the leftover backup removed, and
// anything else is rolled back so that the disk matches the row again.
//
// Call it before instances are recovered, so that a restored service dir is in
// place before anything starts from it. A failure on one service does not stop
// the sweep, because every other service still needs its dir back. It is safe
// to run repeatedly.
func (i *Importer) RecoverServiceDirs(ctx context.Context) (ServiceDirRecovery, error) {
	report := ServiceDirRecovery{Restored: []string{}, Discarded: []string{}, Staging: []string{}}
	servicesDir := filepath.Join(i.DataDir, "artifacts", "services")
	entries, err := os.ReadDir(servicesDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return report, nil
		}
		return report, fmt.Errorf("scan service dirs: %w", err)
	}
	var errs []error
	for _, entry := range entries {
		if name, ok := stagingDirName(entry); ok {
			// Nothing can be importing at startup, so a staging tree here is
			// left over from a crash. Without this it is only reclaimed by
			// importing that same service again.
			if err := os.RemoveAll(filepath.Join(servicesDir, name)); err != nil {
				errs = append(errs, fmt.Errorf("remove leftover staging tree %s: %w", name, err))
				continue
			}
			report.Staging = append(report.Staging, name)
			continue
		}
		serviceID, ok := backupServiceID(entry)
		if !ok {
			continue
		}
		backupDir := filepath.Join(servicesDir, entry.Name())
		serviceDir := filepath.Join(servicesDir, serviceID)
		rollback, err := i.interruptedCommitNeedsRollback(ctx, serviceID, serviceDir)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		if rollback {
			// Remove before renaming: renaming onto a non-empty dir fails. A
			// crash in between leaves the backup in place, so the next start
			// repeats this instead of losing the previous version.
			if err := os.RemoveAll(serviceDir); err != nil {
				errs = append(errs, fmt.Errorf("roll back interrupted commit for service %s: %w", serviceID, err))
				continue
			}
			if err := os.Rename(backupDir, serviceDir); err != nil {
				errs = append(errs, fmt.Errorf("restore service dir %s: %w", serviceID, err))
				continue
			}
			report.Restored = append(report.Restored, serviceID)
			continue
		}
		if err := os.RemoveAll(backupDir); err != nil {
			errs = append(errs, fmt.Errorf("remove leftover backup for service %s: %w", serviceID, err))
			continue
		}
		report.Discarded = append(report.Discarded, serviceID)
	}
	return report, errors.Join(errs...)
}

// stagingDirName reports the name of a staging tree entry.
//
// Backups are excluded explicitly: a service id may begin with the staging
// prefix, and `.<id>.previous` for such a service starts with it too, so the
// two namespaces overlap. A staging name never ends with the backup suffix for
// the same reason a service id cannot contain a dot.
func stagingDirName(entry os.DirEntry) (string, bool) {
	name := entry.Name()
	if !entry.IsDir() || !strings.HasPrefix(name, stagingDirPrefix) || strings.HasSuffix(name, previousDirSuffix) {
		return "", false
	}
	return name, true
}

// backupServiceID reports the service id that a `.<id>.previous` entry backs up.
func backupServiceID(entry os.DirEntry) (string, bool) {
	name := entry.Name()
	if !entry.IsDir() {
		return "", false
	}
	trimmed, ok := strings.CutSuffix(name, previousDirSuffix)
	if !ok {
		return "", false
	}
	serviceID, ok := strings.CutPrefix(trimmed, ".")
	if !ok || domain.ValidateID("service", serviceID) != nil {
		return "", false
	}
	return serviceID, true
}

// interruptedCommitNeedsRollback reports whether the interrupted commit for
// serviceID has to go back to its backup.
//
// It compares both artifacts the store identifies a version by. The descriptor
// alone only covers the proto surface, so a re-import that changes the package
// but not its .proto would otherwise look like a completed commit while the row
// still describes the previous package. Anything that cannot be verified is
// rolled back: the backup is the only copy of the version the row names.
func (i *Importer) interruptedCommitNeedsRollback(ctx context.Context, serviceID, serviceDir string) (bool, error) {
	if _, err := os.Stat(serviceDir); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			// The swap moved the live dir away before installing the new one.
			return true, nil
		}
		return false, fmt.Errorf("stat service dir %s: %w", serviceID, err)
	}
	stored, err := i.Store.GetService(ctx, serviceID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// Nothing references this service dir; keep the version that was
			// committed rather than one the store never saw.
			return true, nil
		}
		return false, fmt.Errorf("read service %s: %w", serviceID, err)
	}
	descriptor, err := os.ReadFile(filepath.Join(serviceDir, descriptorFileName))
	if err != nil {
		return true, nil
	}
	if stored.DescriptorSHA256 != domain.HashBytes(descriptor) {
		return true, nil
	}
	artifact, err := os.ReadFile(filepath.Join(serviceDir, filepath.Base(stored.PackageArtifactPath)))
	if err != nil {
		return true, nil
	}
	return stored.PackageSHA256 != domain.HashBytes(artifact), nil
}
