package packageimport

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
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

func TestRecoverServiceDirsIgnoresUnrelatedEntries(t *testing.T) {
	dataDir, s := openTestStore(t)
	importer := &Importer{DataDir: dataDir, Store: s}
	_, servicesDir := importRecoveryFixture(t, importer)
	for _, name := range []string{".staging-echo", ".previous"} {
		dir := filepath.Join(servicesDir, name)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "keep"), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	report, err := importer.RecoverServiceDirs(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Restored) != 0 || len(report.Discarded) != 0 {
		t.Fatalf("unexpected recovery report: %+v", report)
	}
	for _, name := range []string{"echo", ".staging-echo", ".previous"} {
		if _, err := os.Stat(filepath.Join(servicesDir, name)); err != nil {
			t.Fatalf("%s was touched by recovery: %v", name, err)
		}
	}
}
