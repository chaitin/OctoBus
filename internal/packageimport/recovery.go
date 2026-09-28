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
}

// RecoverServiceDirs finishes service commits that a crash interrupted.
//
// A commit swaps a service dir through `.<service id>.previous` and only then
// updates the store, so a crash can leave the service dir missing with its
// previous version in the backup, or leave the backup behind with the disk and
// the store possibly disagreeing. The store decides between the two: a service
// dir whose descriptor still matches the stored hash is the committed one and
// only needs the leftover backup removed, and anything else is rolled back so
// that the disk matches the row again.
//
// Call it before instances are recovered, so that a restored service dir is in
// place before anything starts from it. It is safe to run repeatedly.
func (i *Importer) RecoverServiceDirs(ctx context.Context) (ServiceDirRecovery, error) {
	report := ServiceDirRecovery{Restored: []string{}, Discarded: []string{}}
	servicesDir := filepath.Join(i.DataDir, "artifacts", "services")
	entries, err := os.ReadDir(servicesDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return report, nil
		}
		return report, fmt.Errorf("scan service dirs: %w", err)
	}
	for _, entry := range entries {
		serviceID, ok := backupServiceID(entry)
		if !ok {
			continue
		}
		serviceDir := filepath.Join(servicesDir, serviceID)
		backupDir := filepath.Join(servicesDir, entry.Name())
		rollback, err := i.interruptedCommitNeedsRollback(ctx, serviceID, serviceDir)
		if err != nil {
			return report, err
		}
		if rollback {
			// Remove before renaming: renaming onto a non-empty dir fails. A
			// crash in between leaves the backup in place, so the next start
			// repeats this instead of losing the previous version.
			if err := os.RemoveAll(serviceDir); err != nil {
				return report, fmt.Errorf("roll back interrupted commit for service %s: %w", serviceID, err)
			}
			if err := os.Rename(backupDir, serviceDir); err != nil {
				return report, fmt.Errorf("restore service dir %s: %w", serviceID, err)
			}
			report.Restored = append(report.Restored, serviceID)
			continue
		}
		if err := os.RemoveAll(backupDir); err != nil {
			return report, fmt.Errorf("remove leftover backup for service %s: %w", serviceID, err)
		}
		report.Discarded = append(report.Discarded, serviceID)
	}
	return report, nil
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
func (i *Importer) interruptedCommitNeedsRollback(ctx context.Context, serviceID, serviceDir string) (bool, error) {
	if _, err := os.Stat(serviceDir); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			// The swap moved the live dir away before installing the new one.
			return true, nil
		}
		return false, fmt.Errorf("stat service dir %s: %w", serviceID, err)
	}
	raw, err := os.ReadFile(filepath.Join(serviceDir, descriptorFileName))
	if err != nil {
		// Without a readable descriptor the new dir cannot be told apart from
		// the deployed one, so fall back to the version the store describes.
		return true, nil
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
	return stored.DescriptorSHA256 != domain.HashBytes(raw), nil
}
