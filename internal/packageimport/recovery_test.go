package packageimport

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"octobus/internal/store"
)

const recoveryTestManifest = `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`

func importRecoveryFixture(t *testing.T, importer *Importer) (dataDir, servicesDir string) {
	t.Helper()
	pkg := writeTestPackage(t, t.TempDir(), recoveryTestManifest)
	if _, err := importer.Import(context.Background(), Options{ServiceID: "echo", Source: pkg, Offline: true}); err != nil {
		t.Fatal(err)
	}
	servicesDir = filepath.Join(importer.DataDir, "artifacts", "services")
	return importer.DataDir, servicesDir
}

func mustReadFile(t *testing.T, path string) []byte {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// A crash between the two renames of a commit leaves the service dir missing
// with the previous version in the backup.
func TestRecoverServiceDirsRestoresMissingServiceDir(t *testing.T) {
	ctx := context.Background()
	dataDir, s := openTestStore(t)
	importer := &Importer{DataDir: dataDir, Store: s}
	_, servicesDir := importRecoveryFixture(t, importer)
	descriptorPath := filepath.Join(servicesDir, "echo", "descriptor.protoset")
	want := mustReadFile(t, descriptorPath)
	if err := os.Rename(filepath.Join(servicesDir, "echo"), filepath.Join(servicesDir, ".echo.previous")); err != nil {
		t.Fatal(err)
	}

	report, err := importer.RecoverServiceDirs(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Restored) != 1 || report.Restored[0] != "echo" || len(report.Discarded) != 0 {
		t.Fatalf("unexpected recovery report: %+v", report)
	}
	if got := mustReadFile(t, descriptorPath); string(got) != string(want) {
		t.Fatalf("restored descriptor does not match the backup")
	}
	if _, err := os.Stat(filepath.Join(servicesDir, ".echo.previous")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("backup survived recovery: %v", err)
	}
	if _, err := os.Stat(filepath.Join(servicesDir, ".staging-echo")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("recovery left staging behind: %v", err)
	}

	again, err := importer.RecoverServiceDirs(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(again.Restored) != 0 || len(again.Discarded) != 0 {
		t.Fatalf("second recovery was not a no-op: %+v", again)
	}
}

// A crash after the swap but before the store upsert leaves a new service dir on
// disk while the store still describes the previous one, so the commit has to be
// rolled back for the two to agree again.
func TestRecoverServiceDirsRollsBackInterruptedCommit(t *testing.T) {
	ctx := context.Background()
	dataDir, s := openTestStore(t)
	importer := &Importer{DataDir: dataDir, Store: s}
	_, servicesDir := importRecoveryFixture(t, importer)
	serviceDir := filepath.Join(servicesDir, "echo")
	descriptorPath := filepath.Join(serviceDir, "descriptor.protoset")
	deployed := mustReadFile(t, descriptorPath)

	if err := copyDir(serviceDir, filepath.Join(servicesDir, ".echo.previous")); err != nil {
		t.Fatal(err)
	}
	// The new version reached the disk, the store was never updated.
	if err := os.WriteFile(descriptorPath, []byte("uncommitted descriptor"), 0o644); err != nil {
		t.Fatal(err)
	}

	report, err := importer.RecoverServiceDirs(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Restored) != 1 || report.Restored[0] != "echo" || len(report.Discarded) != 0 {
		t.Fatalf("unexpected recovery report: %+v", report)
	}
	if got := mustReadFile(t, descriptorPath); string(got) != string(deployed) {
		t.Fatalf("service dir was not rolled back to the deployed version")
	}
	if _, err := os.Stat(filepath.Join(servicesDir, ".echo.previous")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("backup survived recovery: %v", err)
	}
}

// A crash after the store upsert but before the backup cleanup leaves a service
// dir the store already agrees with, so only the backup is dropped.
func TestRecoverServiceDirsDiscardsBackupOfCommittedService(t *testing.T) {
	ctx := context.Background()
	dataDir, s := openTestStore(t)
	importer := &Importer{DataDir: dataDir, Store: s}
	_, servicesDir := importRecoveryFixture(t, importer)
	serviceDir := filepath.Join(servicesDir, "echo")
	descriptorPath := filepath.Join(serviceDir, "descriptor.protoset")
	committed := mustReadFile(t, descriptorPath)
	backupDir := filepath.Join(servicesDir, ".echo.previous")
	if err := copyDir(serviceDir, backupDir); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(backupDir, "stale-marker"), []byte("old version"), 0o644); err != nil {
		t.Fatal(err)
	}

	report, err := importer.RecoverServiceDirs(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Discarded) != 1 || report.Discarded[0] != "echo" || len(report.Restored) != 0 {
		t.Fatalf("unexpected recovery report: %+v", report)
	}
	if got := mustReadFile(t, descriptorPath); string(got) != string(committed) {
		t.Fatalf("committed service dir was modified")
	}
	if _, err := os.Stat(backupDir); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stale backup survived recovery: %v", err)
	}
}

func TestRecoverServiceDirsToleratesMissingServicesDir(t *testing.T) {
	dataDir, s := openTestStore(t)
	report, err := (&Importer{DataDir: dataDir, Store: s}).RecoverServiceDirs(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Restored) != 0 || len(report.Discarded) != 0 {
		t.Fatalf("unexpected recovery report: %+v", report)
	}
}

func TestRecoverServiceDirsCleansAbandonedStagingTrees(t *testing.T) {
	dataDir, s := openTestStore(t)
	importer := &Importer{DataDir: dataDir, Store: s}
	_, servicesDir := importRecoveryFixture(t, importer)
	stagingDir := filepath.Join(servicesDir, ".staging-echo")
	if err := os.MkdirAll(filepath.Join(stagingDir, "runtime", "node_modules"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stagingDir, "package.tgz"), []byte("leftover"), 0o644); err != nil {
		t.Fatal(err)
	}
	// A directory that only looks like a backup must survive the sweep.
	notABackup := filepath.Join(servicesDir, ".previous")
	if err := os.MkdirAll(notABackup, 0o755); err != nil {
		t.Fatal(err)
	}

	report, err := importer.RecoverServiceDirs(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Staging) != 1 || report.Staging[0] != ".staging-echo" || len(report.Restored) != 0 || len(report.Discarded) != 0 {
		t.Fatalf("unexpected recovery report: %+v", report)
	}
	if _, err := os.Stat(stagingDir); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("leftover staging tree survived recovery: %v", err)
	}
	for _, name := range []string{"echo", ".previous"} {
		if _, err := os.Stat(filepath.Join(servicesDir, name)); err != nil {
			t.Fatalf("%s was touched by recovery: %v", name, err)
		}
	}
}

// A package whose .proto did not change hashes to the same descriptor as the
// version it replaces, so the package artifact has to decide too.
func TestRecoverServiceDirsRollsBackWhenOnlyThePackageChanged(t *testing.T) {
	ctx := context.Background()
	dataDir, s := openTestStore(t)
	importer := &Importer{DataDir: dataDir, Store: s}
	_, servicesDir := importRecoveryFixture(t, importer)
	serviceDir := filepath.Join(servicesDir, "echo")
	stored, err := s.GetService(ctx, "echo")
	if err != nil {
		t.Fatal(err)
	}
	artifactPath := filepath.Join(serviceDir, filepath.Base(stored.PackageArtifactPath))
	deployed := mustReadFile(t, artifactPath)
	if err := copyDir(serviceDir, filepath.Join(servicesDir, ".echo.previous")); err != nil {
		t.Fatal(err)
	}
	// The new package reached the disk with an unchanged descriptor, and the
	// store was never updated.
	if err := os.WriteFile(artifactPath, []byte("uncommitted package"), 0o644); err != nil {
		t.Fatal(err)
	}

	report, err := importer.RecoverServiceDirs(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Restored) != 1 || report.Restored[0] != "echo" || len(report.Discarded) != 0 {
		t.Fatalf("unexpected recovery report: %+v", report)
	}
	if got := mustReadFile(t, artifactPath); string(got) != string(deployed) {
		t.Fatalf("service dir was not rolled back to the deployed package")
	}
}

// One unreadable service must not stop the sweep: the rest still need their
// dirs back before instances are recovered.
func TestRecoverServiceDirsContinuesAfterPerServiceFailure(t *testing.T) {
	dataDir := filepath.Join(t.TempDir(), "data")
	s, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	servicesDir := filepath.Join(dataDir, "artifacts", "services")
	// alpha exists on disk, so recovery has to consult the store and fails once
	// the store is closed; zulu has no live dir, so it is restorable without it.
	if err := os.MkdirAll(filepath.Join(servicesDir, "alpha"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(servicesDir, ".alpha.previous"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(servicesDir, ".zulu.previous"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	report, err := (&Importer{DataDir: dataDir, Store: s}).RecoverServiceDirs(context.Background())
	if err == nil {
		t.Fatal("expected the failed service to be reported")
	}
	if len(report.Restored) != 1 || report.Restored[0] != "zulu" {
		t.Fatalf("sweep stopped before restoring later services: report=%+v err=%v", report, err)
	}
	if _, statErr := os.Stat(filepath.Join(servicesDir, "zulu")); statErr != nil {
		t.Fatalf("zulu was not restored: %v", statErr)
	}
	if _, statErr := os.Stat(filepath.Join(servicesDir, ".alpha.previous")); statErr != nil {
		t.Fatalf("failed service should keep its backup: %v", statErr)
	}
}
