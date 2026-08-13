package e2e

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestServiceImportAutoUploadsClientLocalDirectory(t *testing.T) {
	h := newHarness(t)
	clientRoot := filepath.Join(h.root, "client")
	pkg := createFixturePackage(t, clientRoot, fixtureV1)

	h.mustCLIInDir(pkg, "service", "import", "echo", "--offline", ".")

	row := h.readDB(`SELECT package_source, package_sha256, descriptor_sha256 FROM services WHERE id = ?`, "echo")
	wantSource := "client-upload:" + filepath.Base(pkg)
	if row["package_source"] != wantSource {
		t.Fatalf("package_source=%q want %q; row=%+v", row["package_source"], wantSource, row)
	}
	if strings.Contains(row["package_source"], pkg) || strings.Contains(row["package_source"], clientRoot) {
		t.Fatalf("package_source leaked client path: row=%+v clientRoot=%s pkg=%s", row, clientRoot, pkg)
	}
	if row["package_sha256"] == "" || row["descriptor_sha256"] == "" {
		t.Fatalf("import did not persist package and descriptor hashes: %+v", row)
	}
}
