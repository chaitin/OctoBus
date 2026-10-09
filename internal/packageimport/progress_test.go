package packageimport

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// Every stage reports progress before it does its work, and an import must stop
// when the sink reporting it fails. TestImporterProgressErrorAbortsAndCleansStaging
// covers build_package; this covers the stages around it.
func TestImportAbortsWhenProgressReportingFailsAtAnyStage(t *testing.T) {
	stages := []struct {
		name   string
		dryRun bool
	}{
		{name: "prepare_source"},
		{name: "validate_manifest"},
		{name: "prepare_runtime"},
		{name: "compile_descriptor"},
		{name: "commit_service"},
		{name: "preview", dryRun: true},
	}

	for _, tc := range stages {
		t.Run(tc.name, func(t *testing.T) {
			dataDir, s := openTestStore(t)
			pkg := writeTestPackage(t, t.TempDir(), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
			progressErr := errors.New("progress sink closed")
			_, err := (&Importer{DataDir: dataDir, Store: s}).Import(context.Background(), Options{
				ServiceID: "echo",
				Source:    pkg,
				Offline:   true,
				DryRun:    tc.dryRun,
				Progress: func(event ImportProgressEvent) error {
					if event.Stage == tc.name {
						return progressErr
					}
					return nil
				},
			})
			if !errors.Is(err, progressErr) {
				t.Fatalf("err=%v want %v", err, progressErr)
			}
			if _, err := s.GetService(context.Background(), "echo"); err == nil {
				t.Fatalf("service was committed after the %s progress failure", tc.name)
			}
			if _, err := os.Stat(filepath.Join(dataDir, "artifacts", "services", ".staging-echo")); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("staging cleanup err=%v", err)
			}
		})
	}
}

func TestAcquireImportLockReportsWaitingAndHonorsProgressFailure(t *testing.T) {
	dataDir, s := openTestStore(t)
	imp := &Importer{DataDir: dataDir, Store: s}
	unlock, err := imp.acquireImportLock(context.Background(), Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()

	// A queued importer announces the wait, and a failing sink ends it there
	// rather than leaving it blocked behind the running import.
	progressErr := errors.New("progress sink closed")
	var events []ImportProgressEvent
	if _, err := imp.acquireImportLock(context.Background(), Options{
		Progress: func(event ImportProgressEvent) error {
			events = append(events, event)
			return progressErr
		},
	}); !errors.Is(err, progressErr) {
		t.Fatalf("err=%v want %v", err, progressErr)
	}
	if !hasImportProgressStage(events, "waiting_for_import_lock") {
		t.Fatalf("events=%+v want a waiting_for_import_lock report", events)
	}
}
