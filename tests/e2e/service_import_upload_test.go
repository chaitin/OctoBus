package e2e

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

type importPreview struct {
	DryRun  bool `json:"dry_run"`
	Update  bool `json:"update"`
	Service struct {
		DescriptorVersion string `json:"DescriptorVersion"`
		DescriptorSHA256  string `json:"DescriptorSHA256"`
		NodeEntry         string `json:"NodeEntry"`
		RuntimeMode       string `json:"RuntimeMode"`
		Methods           []struct {
			FullName string `json:"full_name"`
		} `json:"Methods"`
	} `json:"service"`
}

func decodeImportPreview(t *testing.T, raw string) importPreview {
	t.Helper()
	var preview importPreview
	if err := json.Unmarshal([]byte(raw), &preview); err != nil {
		t.Fatalf("decode import preview: %v\n%s", err, raw)
	}
	return preview
}

func (p importPreview) methodSet() map[string]bool {
	set := make(map[string]bool, len(p.Service.Methods))
	for _, method := range p.Service.Methods {
		set[method.FullName] = true
	}
	return set
}

func TestServiceImportDryRunPreviewsWithoutImporting(t *testing.T) {
	h := newHarness(t)
	clientRoot := filepath.Join(h.root, "client")
	pkgV1 := createFixturePackage(t, clientRoot, fixtureV1)

	preview := decodeImportPreview(t, h.mustCLIInDir(pkgV1, "service", "import", "echo", "--offline", "--dry-run", "."))
	if !preview.DryRun || preview.Update {
		t.Fatalf("dry run flags regressed: dry_run=%v update=%v", preview.DryRun, preview.Update)
	}
	if methods := preview.methodSet(); len(methods) != 4 || !methods["echo.v1.EchoService/Echo"] || !methods["echo.v1.EchoService/ServerStream"] {
		t.Fatalf("dry run preview methods regressed: %+v", methods)
	}
	if preview.Service.DescriptorVersion == "" || preview.Service.DescriptorSHA256 == "" || preview.Service.NodeEntry == "" || preview.Service.RuntimeMode == "" {
		t.Fatalf("dry run preview metadata regressed: %+v", preview.Service)
	}
	var listed struct {
		Services []struct {
			ID string `json:"ID"`
		} `json:"services"`
	}
	if err := json.Unmarshal([]byte(h.mustCLI("service", "list")), &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.Services) != 0 {
		t.Fatalf("dry run imported services: %+v", listed.Services)
	}

	h.mustCLIInDir(pkgV1, "service", "import", "echo", "--offline", ".")
	var stored struct {
		DescriptorVersion string `json:"DescriptorVersion"`
		DescriptorSHA256  string `json:"DescriptorSHA256"`
		NodeEntry         string `json:"NodeEntry"`
		RuntimeMode       string `json:"RuntimeMode"`
	}
	if err := json.Unmarshal([]byte(h.mustCLI("service", "get", "echo")), &stored); err != nil {
		t.Fatal(err)
	}
	if stored.DescriptorSHA256 != preview.Service.DescriptorSHA256 || stored.DescriptorVersion != preview.Service.DescriptorVersion ||
		stored.NodeEntry != preview.Service.NodeEntry || stored.RuntimeMode != preview.Service.RuntimeMode {
		t.Fatalf("real import diverged from dry run preview: stored=%+v preview=%+v", stored, preview.Service)
	}

	// Previewing another package version reports an update and leaves the stored service alone.
	pkgV2 := createFixturePackage(t, clientRoot, fixtureV2)
	updatePreview := decodeImportPreview(t, h.mustCLIInDir(pkgV2, "service", "import", "echo", "--offline", "--dry-run", "."))
	if !updatePreview.DryRun || !updatePreview.Update {
		t.Fatalf("existing service not reported as update: dry_run=%v update=%v", updatePreview.DryRun, updatePreview.Update)
	}
	if methods := updatePreview.methodSet(); len(methods) != 1 || !methods["echo.v1.EchoService/Ping"] {
		t.Fatalf("update preview methods regressed: %+v", methods)
	}
	if row := h.readDB(`SELECT descriptor_sha256 FROM services WHERE id = ?`, "echo"); row["descriptor_sha256"] != stored.DescriptorSHA256 {
		t.Fatalf("dry run replaced the stored service: %q want %q", row["descriptor_sha256"], stored.DescriptorSHA256)
	}

	h.mustCLIInDir(pkgV2, "service", "import", "echo", "--offline", ".")
	if row := h.readDB(`SELECT descriptor_sha256 FROM services WHERE id = ?`, "echo"); row["descriptor_sha256"] != updatePreview.Service.DescriptorSHA256 {
		t.Fatalf("update import descriptor=%q preview=%q", row["descriptor_sha256"], updatePreview.Service.DescriptorSHA256)
	}
}

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
