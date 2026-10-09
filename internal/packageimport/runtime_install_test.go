package packageimport

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A package whose runtime dependencies cannot be installed has to fail the
// import: committing it would leave a service whose runtime cannot start.
func TestImportFailsWhenRuntimeDependenciesCannotBeInstalled(t *testing.T) {
	dataDir, s := openTestStore(t)
	pkg := writeTestPackage(t, t.TempDir(), recoveryTestManifest)
	// A dependency that cannot resolve, so the install fails without a network.
	writeTestFile(t, filepath.Join(pkg, "package.json"), `{"name":"echo-wrapper","version":"1.0.0","bin":{"echo-wrapper":"bin/echo.js"},"dependencies":{"octobus-absent-package-0000":"^9.9.9"}}`, 0o644)

	_, err := (&Importer{DataDir: dataDir, Store: s}).Import(context.Background(), Options{
		ServiceID: "echo",
		Source:    pkg,
		Offline:   true,
	})
	if err == nil {
		t.Fatal("importing a package whose dependencies cannot install succeeded")
	}
	// The failure has to be the install: any other error would mean the case
	// passed without reaching the step it is about.
	if !strings.Contains(err.Error(), "npm install") {
		t.Fatalf("err=%v want the dependency install to be the failure", err)
	}
	if _, err := s.GetService(context.Background(), "echo"); err == nil {
		t.Fatal("a service was committed from a package that could not be installed")
	}
	if _, err := os.Stat(filepath.Join(dataDir, "artifacts", "services", ".staging-echo")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("staging cleanup err=%v", err)
	}
}
