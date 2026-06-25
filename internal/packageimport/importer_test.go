package packageimport

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"octobus/internal/domain"
	"octobus/internal/store"
)

func TestImporterImportsDirectoryPackage(t *testing.T) {
	dataDir, s := openTestStore(t)
	pkg := writeTestPackage(t, t.TempDir(), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	res, err := (&Importer{DataDir: dataDir, Store: s}).Import(context.Background(), Options{ServiceID: "echo", Source: pkg, Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	if res.Service.ID != "echo" || res.Service.Name != "echo-wrapper" || res.Service.PackageSHA256 == "" || len(res.Service.Methods) != 1 {
		t.Fatalf("unexpected import result: %+v", res.Service)
	}
	if res.Service.RuntimeMode != domain.RuntimeModeLongRunning {
		t.Fatalf("runtime mode=%q", res.Service.RuntimeMode)
	}
	if res.Manifest.Name != "echo-wrapper" || res.Service.ServiceRoot != "." {
		t.Fatalf("single service metadata regressed: result=%+v manifest=%+v", res.Service, res.Manifest)
	}
	if res.Service.NodeEntry != filepath.Clean("bin/echo.js") {
		t.Fatalf("node entry=%q", res.Service.NodeEntry)
	}
	for _, path := range []string{res.Service.PackageArtifactPath, res.Service.DescriptorPath, filepath.Join(dataDir, "artifacts/services/echo/runtime/service.json")} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("expected artifact %s: %v", path, err)
		}
	}
}

func TestImporterReportsSingleServiceProgress(t *testing.T) {
	dataDir, s := openTestStore(t)
	pkg := writeTestPackage(t, t.TempDir(), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	var events []ImportProgressEvent
	_, err := (&Importer{DataDir: dataDir, Store: s}).Import(context.Background(), Options{
		ServiceID: "echo",
		Source:    pkg,
		Offline:   true,
		Progress: func(event ImportProgressEvent) error {
			events = append(events, event)
			return nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, stage := range []string{"prepare_source", "build_package", "validate_manifest", "prepare_runtime", "compile_descriptor", "commit_service"} {
		if !hasImportProgressStage(events, stage) {
			t.Fatalf("missing progress stage %q in %+v", stage, events)
		}
	}
}

func TestImporterProgressErrorAbortsAndCleansStaging(t *testing.T) {
	dataDir, s := openTestStore(t)
	pkg := writeTestPackage(t, t.TempDir(), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	progressErr := errors.New("progress sink closed")
	_, err := (&Importer{DataDir: dataDir, Store: s}).Import(context.Background(), Options{
		ServiceID: "echo",
		Source:    pkg,
		Offline:   true,
		Progress: func(event ImportProgressEvent) error {
			if event.Stage == "build_package" {
				return progressErr
			}
			return nil
		},
	})
	if !errors.Is(err, progressErr) {
		t.Fatalf("err=%v want %v", err, progressErr)
	}
	if _, err := s.GetService(context.Background(), "echo"); err == nil {
		t.Fatal("service was committed after progress failure")
	}
	if _, err := os.Stat(filepath.Join(dataDir, "artifacts", "services", ".staging-echo")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("staging cleanup err=%v", err)
	}
}

func TestImporterImportsDirectoryPackageServiceRoot(t *testing.T) {
	dataDir, s := openTestStore(t)
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "package.json"), `{"name":"multi","version":"1.0.0","bin":{"hanqing-ticket":"bin/hanqing-ticket.js","other-service":"bin/other.js"},"files":["bin","Hanqing_Ticket","Other"]}`, 0o644)
	if err := os.MkdirAll(filepath.Join(root, "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(root, "bin/hanqing-ticket.js"), "#!/bin/sh\n", 0o755)
	writeTestFile(t, filepath.Join(root, "bin/other.js"), "#!/bin/sh\n", 0o755)
	serviceRoot := filepath.Join(root, "Hanqing_Ticket")
	if err := os.MkdirAll(filepath.Join(serviceRoot, "proto"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(serviceRoot, "service.json"), `{"schema":"chaitin.octobus.service.v1","name":"hanqing-ticket","configSchema":"config.schema.json","secretSchema":"secret.schema.json","proto":{"roots":["proto"],"files":["proto/hanqing_ticket.proto"]}}`, 0o644)
	writeTestFile(t, filepath.Join(serviceRoot, "config.schema.json"), `{"type":"object"}`, 0o644)
	writeTestFile(t, filepath.Join(serviceRoot, "secret.schema.json"), `{"type":"object"}`, 0o644)
	writeTestFile(t, filepath.Join(serviceRoot, "proto/hanqing_ticket.proto"), `syntax = "proto3";
package hanqing.ticket.v1;
service TicketService { rpc List(ListRequest) returns (ListResponse); }
message ListRequest { string query = 1; }
message ListResponse { string text = 1; }
`, 0o644)

	source := root + "//Hanqing_Ticket"
	res, err := (&Importer{DataDir: dataDir, Store: s}).Import(context.Background(), Options{ServiceID: "hanqing", Source: source, Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	if res.Service.ServiceRoot != "Hanqing_Ticket" || res.Service.PackageSource != source || res.Service.NodeEntry != filepath.Clean("bin/hanqing-ticket.js") {
		t.Fatalf("unexpected service import metadata: %+v", res.Service)
	}
	for _, path := range []string{
		filepath.Join(dataDir, "artifacts/services/hanqing/package/package.json"),
		filepath.Join(dataDir, "artifacts/services/hanqing/package/Hanqing_Ticket/service.json"),
		filepath.Join(dataDir, "artifacts/services/hanqing/runtime/package.json"),
		filepath.Join(dataDir, "artifacts/services/hanqing/runtime/Hanqing_Ticket/service.json"),
		res.Service.ConfigSchemaPath,
		res.Service.SecretSchemaPath,
	} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("expected service-root artifact %s: %v", path, err)
		}
	}
	if len(res.Service.Methods) != 1 || res.Service.Methods[0].FullName != "hanqing.ticket.v1.TicketService/List" {
		t.Fatalf("descriptor was not compiled from service root: %+v", res.Service.Methods)
	}
}

func TestImporterImportRecursiveImportsMultiServicePackage(t *testing.T) {
	dataDir, s := openTestStore(t)
	pkg := writeMultiServiceTestPackage(t, t.TempDir())
	var events []ImportProgressEvent
	res, err := (&Importer{DataDir: dataDir, Store: s}).ImportRecursive(context.Background(), Options{
		Source:    pkg.Root,
		Recursive: true,
		Offline:   true,
		Build:     "never",
		Progress: func(event ImportProgressEvent) error {
			events = append(events, event)
			return nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !hasImportProgressStage(events, "prepare_source") || !hasImportProgressStage(events, "prepare_runtime") {
		t.Fatalf("recursive import missing package-level progress: %+v", events)
	}
	compileEvents := 0
	for _, event := range events {
		if event.Stage == "compile_descriptor" {
			compileEvents++
			if event.Current == 0 || event.Total != len(pkg.Services) || event.ServiceID == "" {
				t.Fatalf("bad recursive compile progress event: %+v", event)
			}
		}
	}
	if compileEvents != len(pkg.Services) {
		t.Fatalf("compile progress events=%d want %d in %+v", compileEvents, len(pkg.Services), events)
	}
	if res.ServiceCount != len(pkg.Services) || len(res.Services) != len(pkg.Services) || len(res.Manifests) != len(pkg.Services) {
		t.Fatalf("unexpected recursive result: %+v", res)
	}
	gotByID := map[string]domain.Service{}
	for _, svc := range res.Services {
		gotByID[svc.ID] = svc
	}
	for _, want := range pkg.Services {
		svc, ok := gotByID[want.ID]
		if !ok {
			t.Fatalf("service %s missing from result: %+v", want.ID, res.Services)
		}
		if svc.Name != want.ID+" display" || svc.PackageSource != sourceWithServiceRoot(pkg.Root, want.ServiceRoot) || svc.ServiceRoot != want.ServiceRoot || svc.NodeEntry != filepath.Clean(want.NodeEntry) {
			t.Fatalf("service %s metadata mismatch: %+v", want.ID, svc)
		}
		if len(svc.Methods) != 1 || svc.Methods[0].FullName != want.MethodFull {
			t.Fatalf("service %s methods mismatch: %+v", want.ID, svc.Methods)
		}
		for _, path := range []string{svc.PackageArtifactPath, svc.DescriptorPath, svc.ConfigSchemaPath, svc.SecretSchemaPath} {
			if _, err := os.Stat(path); err != nil {
				t.Fatalf("service %s expected artifact %s: %v", want.ID, path, err)
			}
		}
		stored, err := s.GetService(context.Background(), want.ID)
		if err != nil {
			t.Fatal(err)
		}
		if stored.PackageSource != svc.PackageSource || stored.ServiceRoot != svc.ServiceRoot {
			t.Fatalf("stored service %s mismatch: %+v", want.ID, stored)
		}
	}
}

func TestImporterImportRecursiveHonorsScanRoot(t *testing.T) {
	dataDir, s := openTestStore(t)
	pkg := writeMultiServiceTestPackage(t, t.TempDir())
	res, err := (&Importer{DataDir: dataDir, Store: s}).ImportRecursive(context.Background(), Options{Source: pkg.Root + "//nested", Recursive: true, Offline: true, Build: "never"})
	if err != nil {
		t.Fatal(err)
	}
	if res.ServiceCount != 1 || len(res.Services) != 1 || res.Services[0].ID != "gamma-service" || res.Services[0].ServiceRoot != "nested/vendor__gamma" {
		t.Fatalf("unexpected scan-root recursive result: %+v", res)
	}
	if _, err := s.GetService(context.Background(), "alpha-service"); err == nil {
		t.Fatal("service outside scan root was imported")
	}
}

func TestImporterImportRecursiveImportsRootService(t *testing.T) {
	dataDir, s := openTestStore(t)
	pkg := writeTestPackage(t, t.TempDir(), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","displayName":"Echo Wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	res, err := (&Importer{DataDir: dataDir, Store: s}).ImportRecursive(context.Background(), Options{Source: pkg, Recursive: true, Offline: true, Build: "never"})
	if err != nil {
		t.Fatal(err)
	}
	if res.ServiceCount != 1 || len(res.Services) != 1 {
		t.Fatalf("unexpected root recursive result: %+v", res)
	}
	svc := res.Services[0]
	if svc.ID != "echo-wrapper" || svc.Name != "Echo Wrapper" || svc.ServiceRoot != "." || svc.PackageSource != pkg {
		t.Fatalf("root service metadata mismatch: %+v", svc)
	}
}

func TestImporterImportRecursivePrevalidationFailuresKeepStoreEmpty(t *testing.T) {
	tests := []struct {
		name  string
		setup func(t *testing.T, pkg multiServiceTestPackage) string
		want  string
	}{
		{
			name: "duplicate id",
			setup: func(t *testing.T, pkg multiServiceTestPackage) string {
				updateMultiServiceManifestName(t, pkg.Root, "vendor__beta", "alpha-service")
				return pkg.Root
			},
			want: "duplicate service id",
		},
		{
			name: "invalid id",
			setup: func(t *testing.T, pkg multiServiceTestPackage) string {
				updateMultiServiceManifestName(t, pkg.Root, "vendor__alpha", "bad/id")
				updatePackageBin(t, pkg.Root, func(bin map[string]string) {
					bin["bad/id"] = "bin/alpha-service.js"
				})
				return pkg.Root
			},
			want: "invalid service id",
		},
		{
			name: "missing bin",
			setup: func(t *testing.T, pkg multiServiceTestPackage) string {
				updatePackageBin(t, pkg.Root, func(bin map[string]string) {
					delete(bin, "beta-service")
				})
				return pkg.Root
			},
			want: "package.json bin",
		},
		{
			name: "missing schema",
			setup: func(t *testing.T, pkg multiServiceTestPackage) string {
				if err := os.Remove(filepath.Join(pkg.Root, "vendor__alpha", "config.schema.json")); err != nil {
					t.Fatal(err)
				}
				return pkg.Root
			},
			want: "configSchema",
		},
		{
			name: "bad proto",
			setup: func(t *testing.T, pkg multiServiceTestPackage) string {
				writeTestFile(t, filepath.Join(pkg.Root, "vendor__alpha", "proto", "service.proto"), "not proto\n", 0o644)
				return pkg.Root
			},
			want: "compile service vendor__alpha descriptor",
		},
		{
			name: "empty scan root",
			setup: func(t *testing.T, pkg multiServiceTestPackage) string {
				if err := os.MkdirAll(filepath.Join(pkg.Root, "empty-scan"), 0o755); err != nil {
					t.Fatal(err)
				}
				writeTestFile(t, filepath.Join(pkg.Root, "empty-scan", "README.md"), "empty\n", 0o644)
				updatePackageFiles(t, pkg.Root, func(files []string) []string {
					return append(files, "empty-scan")
				})
				return pkg.Root + "//empty-scan"
			},
			want: "no service roots found",
		},
		{
			name: "missing scan root",
			setup: func(t *testing.T, pkg multiServiceTestPackage) string {
				return pkg.Root + "//missing"
			},
			want: "scan root",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			dataDir, s := openTestStore(t)
			pkg := writeMultiServiceTestPackage(t, t.TempDir())
			source := tc.setup(t, pkg)
			_, err := (&Importer{DataDir: dataDir, Store: s}).ImportRecursive(context.Background(), Options{Source: source, Recursive: true, Offline: true, Build: "never"})
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("ImportRecursive error=%v want %q", err, tc.want)
			}
			services, err := s.ListServices(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			if len(services) != 0 {
				t.Fatalf("recursive prevalidation failure committed services: %+v", services)
			}
		})
	}
}

func TestImporterImportRecursiveReimportPreservesExistingName(t *testing.T) {
	ctx := context.Background()
	dataDir, s := openTestStore(t)
	firstPkg := writeMultiServiceTestPackage(t, t.TempDir())
	secondPkg := writeMultiServiceTestPackage(t, t.TempDir())
	updateMultiServiceManifestName(t, secondPkg.Root, "vendor__alpha", "alpha-service")
	updateMultiServiceManifestName(t, secondPkg.Root, "vendor__beta", "beta-service")
	updateMultiServiceManifestName(t, secondPkg.Root, "nested/vendor__gamma", "gamma-service")
	imp := &Importer{DataDir: dataDir, Store: s}
	if _, err := imp.ImportRecursive(ctx, Options{Source: firstPkg.Root, Recursive: true, Offline: true, Build: "never"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateServiceMetadata(ctx, "alpha-service", "User Renamed Alpha"); err != nil {
		t.Fatal(err)
	}
	res, err := imp.ImportRecursive(ctx, Options{Source: secondPkg.Root, Recursive: true, Offline: true, Build: "never"})
	if err != nil {
		t.Fatal(err)
	}
	for _, svc := range res.Services {
		if svc.ID == "alpha-service" && svc.Name != "User Renamed Alpha" {
			t.Fatalf("recursive reimport did not preserve existing name: %+v", svc)
		}
		if svc.ID == "beta-service" && svc.Name != "beta-service display" {
			t.Fatalf("unexpected beta service name: %+v", svc)
		}
	}
	stored, err := s.GetService(ctx, "alpha-service")
	if err != nil {
		t.Fatal(err)
	}
	if stored.Name != "User Renamed Alpha" {
		t.Fatalf("stored name=%q want preserved user name", stored.Name)
	}
}

func TestImporterKeepsLocalExampleSDKAfterRuntimeDependencyPreparation(t *testing.T) {
	dataDir, s := openTestStore(t)
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "go.mod"), "module fixture\n", 0o644)
	if err := os.MkdirAll(filepath.Join(root, "sdk", "dist"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(root, "sdk/package.json"), `{"name":"@chaitin-ai/octobus-sdk"}`, 0o644)
	writeTestFile(t, filepath.Join(root, "sdk/dist/cli.js"), "console.log('local sdk')\n", 0o644)

	pkg := writeTestPackage(t, filepath.Join(root, "examples", "calculator"), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	writeTestFile(t, filepath.Join(pkg, "package.json"), `{"name":"octobus-calculator-js","version":"1.0.0","bin":{"echo-wrapper":"bin/echo.js"},"dependencies":{"@chaitin-ai/octobus-sdk":"*"}}`, 0o644)
	if err := os.MkdirAll(filepath.Join(pkg, "node_modules", "@chaitin-ai", "octobus-sdk", "dist"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(pkg, "node_modules/@chaitin-ai/octobus-sdk/dist/cli.js"), "console.log('registry sdk')\n", 0o644)

	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatalf("restore cwd: %v", err)
		}
	}()
	if err := os.Chdir(root); err != nil {
		t.Fatal(err)
	}

	res, err := (&Importer{DataDir: dataDir, Store: s}).Import(context.Background(), Options{ServiceID: "echo", Source: pkg, Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(dataDir, "artifacts", "services", res.Service.ID, "runtime", "node_modules", "@chaitin-ai", "octobus-sdk", "dist", "cli.js"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "console.log('local sdk')\n" {
		t.Fatalf("runtime sdk was not replaced after dependency preparation: %s", got)
	}
}

func TestImporterInjectsLocalExampleSDKBeforeRuntimeDependencyPreparation(t *testing.T) {
	dataDir, s := openTestStore(t)
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "go.mod"), "module fixture\n", 0o644)
	if err := os.MkdirAll(filepath.Join(root, "sdk", "dist"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(root, "sdk/package.json"), `{"name":"@chaitin-ai/octobus-sdk"}`, 0o644)
	writeTestFile(t, filepath.Join(root, "sdk/dist/cli.js"), "console.log('local sdk')\n", 0o644)

	pkg := writeTestPackage(t, filepath.Join(root, "examples", "calculator"), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	writeTestFile(t, filepath.Join(pkg, "package.json"), `{"name":"octobus-calculator-js","version":"1.0.0","bin":{"echo-wrapper":"bin/echo.js"},"dependencies":{"@chaitin-ai/octobus-sdk":"^0.4.3"}}`, 0o644)

	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatalf("restore cwd: %v", err)
		}
	}()
	if err := os.Chdir(root); err != nil {
		t.Fatal(err)
	}

	res, err := (&Importer{DataDir: dataDir, Store: s}).Import(context.Background(), Options{ServiceID: "echo", Source: pkg, Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(dataDir, "artifacts", "services", res.Service.ID, "runtime", "node_modules", "@chaitin-ai", "octobus-sdk", "dist", "cli.js"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "console.log('local sdk')\n" {
		t.Fatalf("runtime sdk was not injected before dependency preparation: %s", got)
	}
}

func TestImporterImportsDirectoryPackageWithNodeBinSymlink(t *testing.T) {
	dataDir, s := openTestStore(t)
	pkg := writeTestPackage(t, t.TempDir(), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	binDir := filepath.Join(pkg, "node_modules", ".bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("../../package.json", filepath.Join(binDir, "echo-wrapper")); err != nil {
		t.Fatal(err)
	}

	if _, err := (&Importer{DataDir: dataDir, Store: s}).Import(context.Background(), Options{ServiceID: "echo", Source: pkg, Offline: true}); err != nil {
		t.Fatal(err)
	}
}

func TestImporterImportsOnDemandRuntimeMode(t *testing.T) {
	dataDir, s := openTestStore(t)
	pkg := writeTestPackage(t, t.TempDir(), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","runtime":{"mode":"on-demand","future":true},"configSchema":"config.schema.json","secretSchema":"secret.schema.json","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	res, err := (&Importer{DataDir: dataDir, Store: s}).Import(context.Background(), Options{ServiceID: "echo", Source: pkg, Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	if res.Service.RuntimeMode != domain.RuntimeModeOnDemand {
		t.Fatalf("runtime mode=%q", res.Service.RuntimeMode)
	}
	if !strings.Contains(string(res.Manifest.Runtime), `"future":true`) {
		t.Fatalf("runtime extension was not preserved: %s", res.Manifest.Runtime)
	}
	for _, path := range []string{
		res.Service.PackageArtifactPath,
		res.Service.DescriptorPath,
		res.Service.ConfigSchemaPath,
		res.Service.SecretSchemaPath,
		filepath.Join(dataDir, "artifacts/services/echo/package/service.json"),
		filepath.Join(dataDir, "artifacts/services/echo/runtime/service.json"),
	} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("expected on-demand artifact %s: %v", path, err)
		}
	}
}

func TestImporterRejectsInvalidRuntimeMode(t *testing.T) {
	dataDir, s := openTestStore(t)
	pkg := writeTestPackage(t, t.TempDir(), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","runtime":{"mode":"invalid"},"proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	_, err := (&Importer{DataDir: dataDir, Store: s}).Import(context.Background(), Options{ServiceID: "echo", Source: pkg, Offline: true})
	if err == nil {
		t.Fatal("expected invalid runtime mode error")
	}
	if !strings.Contains(err.Error(), "runtime.mode") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSplitSourceServiceRoot(t *testing.T) {
	tests := []struct {
		source      string
		wantSource  string
		wantRoot    string
		wantErrText string
	}{
		{source: "./tentacle", wantSource: "./tentacle", wantRoot: "."},
		{source: "./tentacle//Hanqing_Ticket", wantSource: "./tentacle", wantRoot: "Hanqing_Ticket"},
		{source: "./tentacle//services/ticket/", wantSource: "./tentacle", wantRoot: "services/ticket"},
		{source: "./tentacle//services//ticket", wantSource: "./tentacle", wantRoot: "services/ticket"},
		{source: "npm:@scope/tentacle@1.0.0//services/ticket", wantSource: "npm:@scope/tentacle@1.0.0", wantRoot: "services/ticket"},
		{source: "npm:./tentacle//nested/vendor__gamma", wantSource: "npm:./tentacle", wantRoot: "nested/vendor__gamma"},
		{source: "./tentacle.tgz//services/../ticket", wantErrText: "must not contain .."},
		{source: "./tentacle.tgz///abs", wantErrText: "must be relative"},
		{source: "./tentacle.tgz//", wantErrText: "must not be empty"},
		{source: "//svc", wantErrText: "source is required"},
		{source: "https://github.com/acme/tentacle.git//svc@main", wantSource: "https://github.com/acme/tentacle.git//svc@main", wantRoot: "."},
		{source: "ssh://github.com/acme/tentacle.git//svc", wantSource: "ssh://github.com/acme/tentacle.git//svc", wantRoot: "."},
	}
	for _, tc := range tests {
		t.Run(tc.source, func(t *testing.T) {
			gotSource, gotRoot, err := splitSourceServiceRoot(tc.source)
			if tc.wantErrText != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErrText) {
					t.Fatalf("expected error containing %q, got %v", tc.wantErrText, err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if gotSource != tc.wantSource || gotRoot != tc.wantRoot {
				t.Fatalf("split source=%q root=%q, want source=%q root=%q", gotSource, gotRoot, tc.wantSource, tc.wantRoot)
			}
		})
	}
}

func TestDiscoverServiceRoots(t *testing.T) {
	pkg := writeMultiServiceTestPackage(t, t.TempDir())
	roots, err := discoverServiceRoots(pkg.Root, ".")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"nested/vendor__gamma", "vendor__alpha", "vendor__beta"}
	if strings.Join(roots, ",") != strings.Join(want, ",") {
		t.Fatalf("discoverServiceRoots(.)=%v want %v", roots, want)
	}
	roots, err = discoverServiceRoots(pkg.Root, "")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(roots, ",") != strings.Join(want, ",") {
		t.Fatalf("discoverServiceRoots(empty)=%v want %v", roots, want)
	}
}

func TestDiscoverServiceRootsScanRoot(t *testing.T) {
	pkg := writeMultiServiceTestPackage(t, t.TempDir())
	roots, err := discoverServiceRoots(pkg.Root, "nested")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"nested/vendor__gamma"}
	if strings.Join(roots, ",") != strings.Join(want, ",") {
		t.Fatalf("discoverServiceRoots(nested)=%v want %v", roots, want)
	}
}

func TestDiscoverServiceRootsStopsAtRootService(t *testing.T) {
	root := t.TempDir()
	writeTestPackage(t, root, `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	writeMultiServiceRoot(t, root, multiServiceTestService{ServiceRoot: "nested/vendor__gamma", ID: "gamma-service", NodeEntry: "bin/gamma-service.js", MethodFull: "gamma.v1.GammaService/Call"})
	roots, err := discoverServiceRoots(root, ".")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"."}
	if strings.Join(roots, ",") != strings.Join(want, ",") {
		t.Fatalf("discoverServiceRoots(root service)=%v want %v", roots, want)
	}
}

func TestDiscoverServiceRootsErrors(t *testing.T) {
	pkg := writeMultiServiceTestPackage(t, t.TempDir())
	writeTestFile(t, filepath.Join(pkg.Root, "plain-file"), "fixture", 0o644)
	tests := []struct {
		name     string
		scanRoot string
		want     string
	}{
		{name: "missing", scanRoot: "missing", want: "scan root"},
		{name: "file", scanRoot: "plain-file", want: "is not a directory"},
		{name: "empty", scanRoot: "plain-dir", want: "no service roots found"},
		{name: "invalid", scanRoot: "../outside", want: "must stay inside package"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := discoverServiceRoots(pkg.Root, tc.scanRoot)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("discoverServiceRoots(%q) error=%v want %q", tc.scanRoot, err, tc.want)
			}
		})
	}
}

func TestImporterUsesDisplayNameByDefault(t *testing.T) {
	dataDir, s := openTestStore(t)
	pkg := writeTestPackage(t, t.TempDir(), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","displayName":"Echo Wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)

	res, err := (&Importer{DataDir: dataDir, Store: s}).Import(context.Background(), Options{ServiceID: "echo", Source: pkg, Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	if res.Service.Name != "Echo Wrapper" {
		t.Fatalf("expected display name, got %q", res.Service.Name)
	}
}

func TestImporterCommandLineNameOverridesManifestName(t *testing.T) {
	dataDir, s := openTestStore(t)
	pkg := writeTestPackage(t, t.TempDir(), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","displayName":"Echo Wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)

	res, err := (&Importer{DataDir: dataDir, Store: s}).Import(context.Background(), Options{ServiceID: "echo", Name: "Custom Echo", Source: pkg, Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	if res.Service.Name != "Custom Echo" {
		t.Fatalf("expected override name, got %q", res.Service.Name)
	}
}

func TestImporterReimportPreservesExistingNameWithoutOverride(t *testing.T) {
	ctx := context.Background()
	dataDir, s := openTestStore(t)
	firstPkg := writeTestPackage(t, filepath.Join(t.TempDir(), "first"), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","displayName":"Echo Wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	secondPkg := writeTestPackage(t, filepath.Join(t.TempDir(), "second"), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper-v2","displayName":"Echo Wrapper V2","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	imp := &Importer{DataDir: dataDir, Store: s}

	if _, err := imp.Import(ctx, Options{ServiceID: "echo", Source: firstPkg, Offline: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateServiceMetadata(ctx, "echo", "User Renamed Echo"); err != nil {
		t.Fatal(err)
	}
	res, err := imp.Import(ctx, Options{ServiceID: "echo", Source: secondPkg, Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	if res.Service.Name != "User Renamed Echo" {
		t.Fatalf("expected existing name to be preserved, got %q", res.Service.Name)
	}
}

func TestImporterReimportWithNameOverridesExistingName(t *testing.T) {
	ctx := context.Background()
	dataDir, s := openTestStore(t)
	pkg := writeTestPackage(t, t.TempDir(), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","displayName":"Echo Wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	imp := &Importer{DataDir: dataDir, Store: s}

	if _, err := imp.Import(ctx, Options{ServiceID: "echo", Source: pkg, Offline: true}); err != nil {
		t.Fatal(err)
	}
	res, err := imp.Import(ctx, Options{ServiceID: "echo", Name: "Explicit Echo", Source: pkg, Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	if res.Service.Name != "Explicit Echo" {
		t.Fatalf("expected explicit name override, got %q", res.Service.Name)
	}
}

func TestImporterRollsBackServiceDirWhenStoreCommitFails(t *testing.T) {
	ctx := context.Background()
	dataDir, s := openTestStore(t)
	firstPkg := writeTestPackage(t, filepath.Join(t.TempDir(), "first"), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	imp := &Importer{DataDir: dataDir, Store: s}
	if _, err := imp.Import(ctx, Options{ServiceID: "echo", Source: firstPkg, Build: "never", Offline: true}); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(dataDir, "artifacts/services/echo/package/rollback-marker.txt")
	writeTestFile(t, marker, "old", 0o644)

	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	secondStore, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	if err := secondStore.Close(); err != nil {
		t.Fatal(err)
	}
	secondPkg := writeTestPackage(t, filepath.Join(t.TempDir(), "second"), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper-v2","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	_, err = (&Importer{DataDir: dataDir, Store: secondStore}).Import(ctx, Options{ServiceID: "echo", Source: secondPkg, Build: "never", Offline: true})
	if err == nil {
		t.Fatal("expected closed store import error")
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatalf("old service directory was not restored: %v", err)
	}
}

func TestImporterRejectsManifestID(t *testing.T) {
	dataDir, s := openTestStore(t)
	pkg := writeTestPackage(t, t.TempDir(), `{"schema":"chaitin.octobus.service.v1","id":"echo-from-manifest","name":"echo-wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)

	_, err := (&Importer{DataDir: dataDir, Store: s}).Import(context.Background(), Options{ServiceID: "echo", Source: pkg, Offline: true})
	if err == nil {
		t.Fatal("expected manifest id error")
	}
	if !strings.Contains(err.Error(), "must not define id") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestImporterRejectsManifestEntry(t *testing.T) {
	dataDir, s := openTestStore(t)
	pkg := writeTestPackage(t, t.TempDir(), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","entry":"bin/echo.js","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	_, err := (&Importer{DataDir: dataDir, Store: s}).Import(context.Background(), Options{ServiceID: "echo", Source: pkg, Offline: true})
	if err == nil || !strings.Contains(err.Error(), "must not define entry") {
		t.Fatalf("expected manifest entry error, got %v", err)
	}
}

func TestImporterRejectsInvalidPackageBin(t *testing.T) {
	tests := []struct {
		name        string
		packageJSON string
		want        string
	}{
		{name: "missing", packageJSON: `{"name":"echo-wrapper","version":"1.0.0"}`, want: "bin is required"},
		{name: "multi missing service bin", packageJSON: `{"name":"echo-wrapper","version":"1.0.0","bin":{"a":"bin/a.js","b":"bin/b.js"}}`, want: `missing entry for service "echo-wrapper"`},
		{name: "absolute", packageJSON: `{"name":"echo-wrapper","version":"1.0.0","bin":"/bin/echo"}`, want: "relative"},
		{name: "missing target", packageJSON: `{"name":"echo-wrapper","version":"1.0.0","bin":"bin/missing.js"}`, want: "does not exist"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			dataDir, s := openTestStore(t)
			pkg := writeTestPackage(t, t.TempDir(), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
			writeTestFile(t, filepath.Join(pkg, "package.json"), tc.packageJSON, 0o644)
			_, err := (&Importer{DataDir: dataDir, Store: s}).Import(context.Background(), Options{ServiceID: "echo", Source: pkg, Offline: true})
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected %q error, got %v", tc.want, err)
			}
		})
	}
}

func TestImporterRejectsIntermediateImportFailures(t *testing.T) {
	tests := []struct {
		name string
		edit func(string)
		want string
	}{
		{
			name: "missing manifest",
			edit: func(pkg string) {
				if err := os.Remove(filepath.Join(pkg, "service.json")); err != nil {
					t.Fatal(err)
				}
			},
			want: "service.json",
		},
		{
			name: "invalid manifest json",
			edit: func(pkg string) {
				writeTestFile(t, filepath.Join(pkg, "service.json"), `{`, 0o644)
			},
			want: "unexpected end",
		},
		{
			name: "invalid runtime mode",
			edit: func(pkg string) {
				writeTestFile(t, filepath.Join(pkg, "service.json"), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","runtime":{"mode":"bad"},"proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`, 0o644)
			},
			want: "invalid runtime.mode",
		},
		{
			name: "missing proto",
			edit: func(pkg string) {
				if err := os.Remove(filepath.Join(pkg, "proto/echo.proto")); err != nil {
					t.Fatal(err)
				}
			},
			want: "compile proto descriptor",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			dataDir, s := openTestStore(t)
			pkg := writeTestPackage(t, t.TempDir(), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
			tc.edit(pkg)
			_, err := (&Importer{DataDir: dataDir, Store: s}).Import(context.Background(), Options{ServiceID: "echo", Source: pkg, Offline: true})
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected %q error, got %v", tc.want, err)
			}
		})
	}
}

func TestImporterRejectsConfigSchemaOutsidePackage(t *testing.T) {
	dataDir, s := openTestStore(t)
	pkg := writeTestPackage(t, t.TempDir(), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","configSchema":"../schema.json","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	_, err := (&Importer{DataDir: dataDir, Store: s}).Import(context.Background(), Options{ServiceID: "echo", Source: pkg, Offline: true})
	if err == nil || !strings.Contains(err.Error(), "configSchema") {
		t.Fatalf("expected configSchema path error, got %v", err)
	}
}

func TestImporterRejectsSecretSchemaOutsidePackage(t *testing.T) {
	dataDir, s := openTestStore(t)
	pkg := writeTestPackage(t, t.TempDir(), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","secretSchema":"../schema.json","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	_, err := (&Importer{DataDir: dataDir, Store: s}).Import(context.Background(), Options{ServiceID: "echo", Source: pkg, Offline: true})
	if err == nil || !strings.Contains(err.Error(), "secretSchema") {
		t.Fatalf("expected secretSchema path error, got %v", err)
	}
}

func TestImporterRejectsMissingSchemaFilesAfterPackaging(t *testing.T) {
	tests := []struct {
		name     string
		manifest string
		want     string
	}{
		{
			name:     "config",
			manifest: `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","configSchema":"missing-config.schema.json","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`,
			want:     "configSchema",
		},
		{
			name:     "secret",
			manifest: `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","secretSchema":"missing-secret.schema.json","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`,
			want:     "secretSchema",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			dataDir, s := openTestStore(t)
			pkg := writeTestPackage(t, t.TempDir(), tc.manifest)
			_, err := (&Importer{DataDir: dataDir, Store: s}).Import(context.Background(), Options{ServiceID: "echo", Source: pkg, Offline: true})
			if err == nil || !strings.Contains(err.Error(), tc.want) || !strings.Contains(err.Error(), "does not exist") {
				t.Fatalf("expected missing %s error, got %v", tc.want, err)
			}
		})
	}
}

func TestImporterBuildsSourcePackageWithNpmPack(t *testing.T) {
	if _, err := exec.LookPath("npm"); err != nil {
		t.Skip("npm not installed")
	}
	dataDir, s := openTestStore(t)
	pkg := writeTestPackage(t, t.TempDir(), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	if err := os.Remove(filepath.Join(pkg, "bin/echo.js")); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(pkg, "package.json"), `{"name":"echo-wrapper","version":"1.0.0","bin":{"echo-wrapper":"bin/echo.js"},"scripts":{"build":"mkdir -p bin && printf '#!/bin/sh\n' > bin/echo.js"}}`, 0o644)

	res, err := (&Importer{DataDir: dataDir, Store: s}).Import(context.Background(), Options{ServiceID: "echo", Source: pkg, Build: "auto"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "artifacts/services/echo/package/bin/echo.js")); err != nil {
		t.Fatalf("built package entry missing: %v", err)
	}
	if filepath.Base(res.Service.PackageArtifactPath) == "package.tgz" {
		t.Fatalf("expected npm-packed artifact name, got %s", res.Service.PackageArtifactPath)
	}
}

func TestImporterPacksBuiltLocalDirectoryWithNpmPack(t *testing.T) {
	if _, err := exec.LookPath("npm"); err != nil {
		t.Skip("npm not installed")
	}
	dataDir, s := openTestStore(t)
	pkg := writeTestPackage(t, t.TempDir(), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	writeTestFile(t, filepath.Join(pkg, ".npmignore"), "ignored.txt\n", 0o644)
	writeTestFile(t, filepath.Join(pkg, "ignored.txt"), "not packaged\n", 0o644)

	res, err := (&Importer{DataDir: dataDir, Store: s}).Import(context.Background(), Options{ServiceID: "echo", Source: pkg, Build: "never", Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(res.Service.PackageArtifactPath) == "package.tgz" {
		t.Fatalf("expected npm-packed artifact name, got %s", res.Service.PackageArtifactPath)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "artifacts/services/echo/package/ignored.txt")); !os.IsNotExist(err) {
		t.Fatalf("expected npm ignore rules to omit ignored.txt, stat err=%v", err)
	}
}

func TestImporterImportsLocalDirectoryThroughNPMSource(t *testing.T) {
	if _, err := exec.LookPath("npm"); err != nil {
		t.Skip("npm not installed")
	}
	dataDir, s := openTestStore(t)
	pkg := writeTestPackage(t, t.TempDir(), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)

	res, err := (&Importer{DataDir: dataDir, Store: s}).Import(context.Background(), Options{ServiceID: "echo", Source: "npm:" + pkg, Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	if res.Service.ID != "echo" || res.Service.PackageSHA256 == "" || res.Service.PackageSource != "npm:"+pkg {
		t.Fatalf("unexpected npm import result: %+v", res.Service)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "artifacts/services/echo/package/service.json")); err != nil {
		t.Fatalf("npm package was not unpacked into service artifact dir: %v", err)
	}
}

func TestImporterRejectsEarlyInvalidOptions(t *testing.T) {
	if _, err := (&Importer{}).Import(context.Background(), Options{ServiceID: "echo", Source: "fixture"}); err == nil || !strings.Contains(err.Error(), "store is required") {
		t.Fatalf("expected missing store error, got %v", err)
	}
	dataDir, s := openTestStore(t)
	imp := &Importer{DataDir: dataDir, Store: s}
	if _, err := imp.Import(context.Background(), Options{ServiceID: "bad/id", Source: "fixture"}); err == nil || !strings.Contains(err.Error(), "service id") {
		t.Fatalf("expected invalid id error, got %v", err)
	}
	if _, err := imp.Import(context.Background(), Options{ServiceID: "echo"}); err == nil || !strings.Contains(err.Error(), "source is required") {
		t.Fatalf("expected missing source error, got %v", err)
	}
	pkg := writeTestPackage(t, t.TempDir(), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	if _, err := imp.Import(context.Background(), Options{ServiceID: "echo", Source: pkg, Build: "sometimes", Offline: true}); err == nil || !strings.Contains(err.Error(), "invalid build policy") {
		t.Fatalf("expected invalid build policy error, got %v", err)
	}
}

func TestPrepareSourceFileArchives(t *testing.T) {
	dataDir, s := openTestStore(t)
	imp := &Importer{DataDir: dataDir, Store: s}
	pkg := writeTestPackage(t, t.TempDir(), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)

	tgz := filepath.Join(t.TempDir(), "package.tar.gz")
	writeTarGzPackage(t, tgz, pkg)
	prepared, err := imp.prepareSource(context.Background(), Options{Source: tgz}, filepath.Join(t.TempDir(), "tgz-staging"))
	if err != nil {
		t.Fatal(err)
	}
	if prepared.BuildAllowed || filepath.Base(prepared.ArtifactPath) != "package.tgz" {
		t.Fatalf("unexpected tgz prepared source: %+v", prepared)
	}
	if _, err := os.Stat(filepath.Join(prepared.PackageDir, "service.json")); err != nil {
		t.Fatalf("tgz package was not normalized: %v", err)
	}

	zipPath := filepath.Join(t.TempDir(), "package.zip")
	writeZipPackage(t, zipPath, pkg)
	prepared, err = imp.prepareSource(context.Background(), Options{Source: zipPath}, filepath.Join(t.TempDir(), "zip-staging"))
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(prepared.ArtifactPath) != "package.zip" {
		t.Fatalf("unexpected zip artifact path: %+v", prepared)
	}
	if _, err := os.Stat(filepath.Join(prepared.PackageDir, "service.json")); err != nil {
		t.Fatalf("zip package was not extracted: %v", err)
	}
}

func TestPrepareSourceRemoteArchives(t *testing.T) {
	dataDir, s := openTestStore(t)
	imp := &Importer{DataDir: dataDir, Store: s}
	pkg := writeTestPackage(t, t.TempDir(), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)

	tgz := filepath.Join(t.TempDir(), "package.tgz")
	writeTarGzPackage(t, tgz, pkg)
	zipPath := filepath.Join(t.TempDir(), "package.zip")
	writeZipPackage(t, zipPath, pkg)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/package.tgz":
			http.ServeFile(w, r, tgz)
		case "/package.zip":
			http.ServeFile(w, r, zipPath)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	prepared, err := imp.prepareSource(context.Background(), Options{Source: server.URL + "/package.tgz?X-Amz-Signature=test"}, filepath.Join(t.TempDir(), "remote-tgz-staging"))
	if err != nil {
		t.Fatal(err)
	}
	if prepared.BuildAllowed || filepath.Base(prepared.ArtifactPath) != "package.tgz" || prepared.PackageSource != server.URL+"/package.tgz" {
		t.Fatalf("unexpected remote tgz prepared source: %+v", prepared)
	}
	if _, err := os.Stat(filepath.Join(prepared.PackageDir, "service.json")); err != nil {
		t.Fatalf("remote tgz package was not extracted: %v", err)
	}

	prepared, err = imp.prepareSource(context.Background(), Options{Source: server.URL + "/package.zip"}, filepath.Join(t.TempDir(), "remote-zip-staging"))
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(prepared.ArtifactPath) != "package.zip" {
		t.Fatalf("unexpected remote zip artifact path: %+v", prepared)
	}
	if _, err := os.Stat(filepath.Join(prepared.PackageDir, "service.json")); err != nil {
		t.Fatalf("remote zip package was not extracted: %v", err)
	}
}

func TestPrepareSourceRemoteArchiveErrorsRedactSignedURL(t *testing.T) {
	dataDir, s := openTestStore(t)
	imp := &Importer{DataDir: dataDir, Store: s}
	server := httptest.NewServer(http.NotFoundHandler())
	defer server.Close()

	source := server.URL + "/missing.zip?X-Amz-Signature=secret"
	_, err := imp.prepareSource(context.Background(), Options{Source: source}, filepath.Join(t.TempDir(), "remote-error-staging"))
	if err == nil {
		t.Fatal("expected remote archive download error")
	}
	if strings.Contains(err.Error(), "X-Amz-Signature") || strings.Contains(err.Error(), "secret") {
		t.Fatalf("remote archive error leaked signed URL: %v", err)
	}
	if !strings.Contains(err.Error(), server.URL+"/missing.zip") {
		t.Fatalf("remote archive error lost useful source context: %v", err)
	}
}

func TestArchiveExtractorsRejectUnsafePaths(t *testing.T) {
	tgz := filepath.Join(t.TempDir(), "unsafe.tgz")
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	if err := tw.WriteHeader(&tar.Header{Name: "../escape.txt", Mode: 0o644, Size: int64(len("x"))}); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write([]byte("x")); err != nil {
		t.Fatal(err)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(tgz, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := untarGz(tgz, t.TempDir()); err == nil || !strings.Contains(err.Error(), "unsafe archive path") {
		t.Fatalf("expected unsafe tar path error, got %v", err)
	}

	zipPath := filepath.Join(t.TempDir(), "unsafe.zip")
	out, err := os.Create(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(out)
	w, err := zw.Create("../escape.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write([]byte("x")); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := out.Close(); err != nil {
		t.Fatal(err)
	}
	if err := unzip(zipPath, t.TempDir()); err == nil || !strings.Contains(err.Error(), "unsafe archive path") {
		t.Fatalf("expected unsafe zip path error, got %v", err)
	}
}

func TestBuildSourcePackagePoliciesAndHelpers(t *testing.T) {
	ctx := context.Background()
	pkg := writeTestPackage(t, t.TempDir(), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	prepared := preparedSource{ArtifactPath: filepath.Join(pkg, "package.tgz"), PackageDir: pkg}
	writeTestFile(t, prepared.ArtifactPath, "artifact", 0o644)
	if got, err := buildSourcePackage(ctx, prepared, t.TempDir(), BuildAlways, true); err == nil || !strings.Contains(err.Error(), "only supported") || got.PackageDir != "" {
		t.Fatalf("expected non-buildable build=always error, got prepared=%+v err=%v", got, err)
	}
	got, err := buildSourcePackage(ctx, prepared, t.TempDir(), BuildAuto, true)
	if err != nil {
		t.Fatal(err)
	}
	if got.PackageDir != pkg {
		t.Fatalf("non-buildable source should be returned unchanged: %+v", got)
	}

	buildable := preparedSource{ArtifactPath: filepath.Join(pkg, "package.tgz"), PackageDir: pkg, BuildAllowed: true}
	if err := os.Remove(filepath.Join(pkg, "bin/echo.js")); err != nil {
		t.Fatal(err)
	}
	if _, err := buildSourcePackage(ctx, buildable, t.TempDir(), BuildNever, true); err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("expected missing bin error, got %v", err)
	}
	writeTestFile(t, filepath.Join(pkg, "package.json"), `{"name":"echo-wrapper","version":"1.0.0","bin":{"echo-wrapper":"bin/echo.js"},"scripts":{}}`, 0o644)
	if _, err := buildSourcePackage(ctx, buildable, t.TempDir(), BuildAlways, true); err == nil || !strings.Contains(err.Error(), "requires package.json scripts") {
		t.Fatalf("expected missing build script error, got %v", err)
	}

	if got := selectBuildScript(map[string]string{"build": "build", "prepare": "prepare", "prepack": "prepack"}); got != "prepack" {
		t.Fatalf("selected build script %q", got)
	}
	if got := selectBuildScript(map[string]string{"build": "build"}); got != "build" {
		t.Fatalf("selected build script %q", got)
	}
	if got := selectBuildScript(nil); got != "" {
		t.Fatalf("selected build script %q", got)
	}
}

func TestBuildSourcePackageAutoPacksExistingEntry(t *testing.T) {
	if _, err := exec.LookPath("npm"); err != nil {
		t.Skip("npm not installed")
	}
	ctx := context.Background()
	pkg := writeTestPackage(t, t.TempDir(), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	prepared := preparedSource{ArtifactPath: filepath.Join(pkg, "package.tgz"), PackageDir: pkg, BuildAllowed: true}
	writeTestFile(t, prepared.ArtifactPath, "artifact", 0o644)

	got, err := buildSourcePackage(ctx, prepared, t.TempDir(), BuildAuto, true)
	if err != nil {
		t.Fatal(err)
	}
	if got.ArtifactPath == prepared.ArtifactPath || got.PackageSHA256 == "" {
		t.Fatalf("package was not repacked: %+v", got)
	}
	if _, err := os.Stat(filepath.Join(got.PackageDir, "service.json")); err != nil {
		t.Fatalf("packed package was not extracted: %v", err)
	}
}

func TestPackageRuntimeDependencyHelpers(t *testing.T) {
	dir := t.TempDir()
	if err := prepareRuntime(context.Background(), dir, true, false); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(dir, "package.json"), `{"dependencies":{"left-pad":"1.3.0","local":"file:local-pkg"}}`, 0o644)
	if packageLocalFileDependenciesAvailable(dir) {
		t.Fatal("missing local file dependency should not be available")
	}
	if err := os.MkdirAll(filepath.Join(dir, "local-pkg"), 0o755); err != nil {
		t.Fatal(err)
	}
	if !packageLocalFileDependenciesAvailable(dir) {
		t.Fatal("existing local file dependency should be available")
	}
	if runtimeDependenciesInstalled(dir) {
		t.Fatal("dependencies should not be installed yet")
	}
	if err := os.MkdirAll(filepath.Join(dir, "node_modules", "left-pad"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "node_modules", "local"), 0o755); err != nil {
		t.Fatal(err)
	}
	if !runtimeDependenciesInstalled(dir) {
		t.Fatal("dependencies should be detected as installed")
	}

	noDeps := t.TempDir()
	writeTestFile(t, filepath.Join(noDeps, "package.json"), `{}`, 0o644)
	if runtimeDependenciesInstalled(noDeps) {
		t.Fatal("empty dependencies without node_modules should not be installed")
	}
	if err := os.Mkdir(filepath.Join(noDeps, "node_modules"), 0o755); err != nil {
		t.Fatal(err)
	}
	if !runtimeDependenciesInstalled(noDeps) {
		t.Fatal("empty dependencies with node_modules should be installed")
	}
	writeTestFile(t, filepath.Join(dir, "package.json"), `{"dependencies":{"bad":"file:../outside"}}`, 0o644)
	if packageLocalFileDependenciesAvailable(dir) {
		t.Fatal("escaping local file dependency should not be available")
	}
	writeTestFile(t, filepath.Join(dir, "package.json"), `{`, 0o644)
	if _, err := packageDependencies(dir); err == nil {
		t.Fatal("expected invalid package.json dependency error")
	}
	writeTestFile(t, filepath.Join(dir, "package.json"), `{"dependencies":{"local-dev":"file:local-pkg","remote":"1.0.0"}}`, 0o644)
	if !hasLocalFileDependency(dir) {
		t.Fatal("file dependency should be detected")
	}
	writeTestFile(t, filepath.Join(dir, "package.json"), `{"dependencies":{"left-pad":"1.3.0"}}`, 0o644)
	if hasLocalFileDependency(dir) {
		t.Fatal("registry dependency should not count as local file dependency")
	}
	if err := prepareSourceRuntimeDependencies(context.Background(), dir, true); err != nil {
		t.Fatal(err)
	}
	if err := prepareSourceRuntimeDependencies(context.Background(), filepath.Join(t.TempDir(), "missing"), true); err != nil {
		t.Fatal(err)
	}

	reinstall := t.TempDir()
	writeTestFile(t, filepath.Join(reinstall, "package.json"), `{"dependencies":{"local":"file:missing-local"}}`, 0o644)
	if err := os.MkdirAll(filepath.Join(reinstall, "node_modules", "local"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := prepareRuntime(context.Background(), reinstall, true, true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(reinstall, "node_modules")); !os.IsNotExist(err) {
		t.Fatalf("reinstall did not remove node_modules: %v", err)
	}

	noPackageJSON := t.TempDir()
	if runtimeDependenciesInstalled(noPackageJSON) {
		t.Fatal("missing package.json should not count as installed dependencies")
	}
	if packageLocalFileDependenciesAvailable(noPackageJSON) {
		t.Fatal("missing package.json should not report local file dependencies")
	}
}

func TestNPMInstallSelectsCIAndOfflineArgs(t *testing.T) {
	binDir := t.TempDir()
	logPath := filepath.Join(t.TempDir(), "npm-args.log")
	writeTestFile(t, filepath.Join(binDir, "npm"), "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$NPM_ARGS_LOG\"\n", 0o755)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("NPM_ARGS_LOG", logPath)

	lockDir := t.TempDir()
	writeTestFile(t, filepath.Join(lockDir, "package-lock.json"), `{}`, 0o644)
	if err := npmInstall(context.Background(), lockDir, true, true); err != nil {
		t.Fatal(err)
	}
	shrinkwrapDir := t.TempDir()
	writeTestFile(t, filepath.Join(shrinkwrapDir, "npm-shrinkwrap.json"), `{}`, 0o644)
	if err := npmInstall(context.Background(), shrinkwrapDir, false, false); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
	if len(lines) != 2 {
		t.Fatalf("npm invocations=%q", raw)
	}
	if lines[0] != "ci --omit=dev --offline" {
		t.Fatalf("lockfile args=%q", lines[0])
	}
	if lines[1] != "ci" {
		t.Fatalf("shrinkwrap args=%q", lines[1])
	}
}

func TestNpmPackOutputAndErrorBranches(t *testing.T) {
	binDir := t.TempDir()
	logPath := filepath.Join(t.TempDir(), "npm-mode.log")
	writeTestFile(t, filepath.Join(binDir, "npm"), `#!/bin/sh
case "$NPM_FAKE_MODE" in
empty) exit 0 ;;
fail) printf 'boom\n' >&2; exit 7 ;;
*) printf 'notice\npkg-1.0.0.tgz\n' ;;
esac
`, 0o755)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("NPM_FAKE_LOG", logPath)

	t.Setenv("NPM_FAKE_MODE", "ok")
	packed, err := npmPack(context.Background(), t.TempDir(), filepath.Join(t.TempDir(), "packed"))
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(packed) != "pkg-1.0.0.tgz" {
		t.Fatalf("packed path=%q", packed)
	}

	t.Setenv("NPM_FAKE_MODE", "empty")
	if _, err := npmPack(context.Background(), t.TempDir(), filepath.Join(t.TempDir(), "packed")); err == nil || !strings.Contains(err.Error(), "did not produce") {
		t.Fatalf("expected empty npm pack output error, got %v", err)
	}

	t.Setenv("NPM_FAKE_MODE", "fail")
	if _, err := runNPMOutput(context.Background(), t.TempDir(), []string{"pack"}); err == nil || !strings.Contains(err.Error(), "boom") {
		t.Fatalf("expected npm failure output, got %v", err)
	}
}

func TestPackageJSONAndPathHelpers(t *testing.T) {
	dir := t.TempDir()
	writeTestFile(t, filepath.Join(dir, "package.json"), `{"name":"echo-wrapper","bin":"bin/echo.js","scripts":{"build":"tsc"}}`, 0o644)
	if err := os.MkdirAll(filepath.Join(dir, "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(dir, "bin/echo.js"), "console.log('ok')", 0o644)
	entry, err := inferPackageBin(dir)
	if err != nil {
		t.Fatal(err)
	}
	if entry != filepath.Clean("bin/echo.js") {
		t.Fatalf("entry=%q", entry)
	}
	scripts, err := readPackageScripts(dir)
	if err != nil {
		t.Fatal(err)
	}
	if scripts["build"] != "tsc" {
		t.Fatalf("scripts=%+v", scripts)
	}
	if err := validatePackageFile(dir, "bin", "package.json bin"); err == nil || !strings.Contains(err.Error(), "regular file") {
		t.Fatalf("expected regular file error, got %v", err)
	}

	writeTestFile(t, filepath.Join(dir, "package.json"), `{"name":"echo-wrapper","bin":{"echo-wrapper":42}}`, 0o644)
	if _, err := parsePackageBin(dir); err == nil || !strings.Contains(err.Error(), "target must be a string") {
		t.Fatalf("expected non-string bin target error, got %v", err)
	}
	writeTestFile(t, filepath.Join(dir, "package.json"), `{"name":"echo-wrapper","bin":{"echo-wrapper":"bin/echo.js"}}`, 0o644)
	if entry, err := parsePackageBin(dir); err != nil || entry != filepath.Clean("bin/echo.js") {
		t.Fatalf("expected single map bin target, entry=%q err=%v", entry, err)
	}
	writeTestFile(t, filepath.Join(dir, "package.json"), `{"name":"echo-wrapper","bin":{}}`, 0o644)
	if _, err := parsePackageBinTargets(dir); err == nil || !strings.Contains(err.Error(), "bin is required") {
		t.Fatalf("expected empty bin target error, got %v", err)
	}
	writeTestFile(t, filepath.Join(dir, "package.json"), `{"name":"echo-wrapper","bin":{"echo-wrapper":42}}`, 0o644)
	if _, err := parsePackageBinTargets(dir); err == nil || !strings.Contains(err.Error(), "target must be a string") {
		t.Fatalf("expected non-string bin target list error, got %v", err)
	}
	writeTestFile(t, filepath.Join(dir, "package.json"), `{"name":"echo-wrapper","bin":"/bin/echo.js"}`, 0o644)
	if _, err := parsePackageBinTargets(dir); err == nil || !strings.Contains(err.Error(), "relative") {
		t.Fatalf("expected invalid bin target list error, got %v", err)
	}
	writeTestFile(t, filepath.Join(dir, "package.json"), `{`, 0o644)
	if _, err := parsePackageBin(dir); err == nil {
		t.Fatal("expected invalid package.json error")
	}
	if _, err := parsePackageBinTargets(dir); err == nil {
		t.Fatal("expected invalid package.json target list error")
	}
	missing := filepath.Join(t.TempDir(), "missing")
	if _, err := readPackageScripts(missing); err == nil {
		t.Fatal("expected package.json read error")
	}
	if _, err := parsePackageBinTargets(missing); err == nil || !strings.Contains(err.Error(), "package.json cannot be read") {
		t.Fatalf("expected package bin targets read error, got %v", err)
	}
	if _, err := inferPackageBin(missing); err == nil || !strings.Contains(err.Error(), "package.json cannot be read") {
		t.Fatalf("expected infer package bin read error, got %v", err)
	}

	outside := t.TempDir()
	writeTestFile(t, filepath.Join(outside, "entry.js"), "console.log('outside')", 0o644)
	if err := validatePackageFile(dir, filepath.Join("..", filepath.Base(outside), "entry.js"), "package.json bin"); err == nil {
		t.Fatal("expected path outside package error")
	}
	if err := validatePackageFile(dir, "missing.js", "package.json bin"); err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("expected missing package file error, got %v", err)
	}
}

func TestPackageBinServiceNameBranches(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(dir, "bin/echo.js"), "console.log('echo')", 0o644)

	writeTestFile(t, filepath.Join(dir, "package.json"), `{"bin":{"echo":"bin/echo.js","other":"bin/missing.js"}}`, 0o644)
	entry, err := parsePackageBinForService(dir, "echo")
	if err != nil {
		t.Fatal(err)
	}
	if entry != filepath.Clean("bin/echo.js") {
		t.Fatalf("entry=%q", entry)
	}
	if entry, err := inferPackageBinForService(dir, "echo"); err != nil || entry != filepath.Clean("bin/echo.js") {
		t.Fatalf("infer entry=%q err=%v", entry, err)
	}
	if !packageBinTargetsExist(dir, []string{"bin/echo.js"}) {
		t.Fatal("existing bin target was not detected")
	}
	if packageBinTargetsExist(dir, []string{"bin/missing.js"}) {
		t.Fatal("missing bin target was reported as existing")
	}

	if _, err := parsePackageBinForService(dir, "missing"); err == nil || !strings.Contains(err.Error(), "missing entry") {
		t.Fatalf("expected missing service bin error, got %v", err)
	}
	writeTestFile(t, filepath.Join(dir, "package.json"), `{"bin":{"echo":42}}`, 0o644)
	if _, err := parsePackageBinForService(dir, "echo"); err == nil || !strings.Contains(err.Error(), "target must be a string") {
		t.Fatalf("expected non-string service bin error, got %v", err)
	}
	writeTestFile(t, filepath.Join(dir, "package.json"), `{"bin":{"echo":"/abs.js"}}`, 0o644)
	if _, err := parsePackageBinForService(dir, "echo"); err == nil || !strings.Contains(err.Error(), "relative") {
		t.Fatalf("expected invalid service bin path error, got %v", err)
	}
	writeTestFile(t, filepath.Join(dir, "package.json"), `{"bin":"bin/missing.js"}`, 0o644)
	if _, err := inferPackageBinForService(dir, ""); err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("expected missing inferred bin file error, got %v", err)
	}
	writeTestFile(t, filepath.Join(dir, "package.json"), `{"bin":"/abs.js"}`, 0o644)
	if _, err := parsePackageBinForService(dir, ""); err == nil || !strings.Contains(err.Error(), "relative") {
		t.Fatalf("expected invalid string bin path error, got %v", err)
	}
}

func TestManifestAndSourceRootHelpers(t *testing.T) {
	dir := t.TempDir()
	if _, err := readManifest(dir); err == nil {
		t.Fatal("expected missing manifest error")
	}
	writeTestFile(t, filepath.Join(dir, "service.json"), `{"schema":42}`, 0o644)
	if _, err := readManifest(dir); err == nil {
		t.Fatal("expected manifest type error")
	}

	if got := recursiveBasePackageSource("not-git//svc", "fallback"); got != "fallback" {
		t.Fatalf("non-git recursive base=%q", got)
	}
	if got := recursiveBasePackageSource("https://%zz", "fallback"); got != "fallback" {
		t.Fatalf("invalid git recursive base=%q", got)
	}
	if got := recursiveBasePackageSource("https://host.example/repo.git//svc", "fallback"); got != "https://host.example/repo.git" {
		t.Fatalf("git recursive base without ref=%q", got)
	}
	if got := sourceWithServiceRootForPackage("https://host.example/repo.git", "svc"); got != "https://host.example/repo.git//svc" {
		t.Fatalf("git source with root without ref=%q", got)
	}
}

func TestRepoRootAndNormalizePackageDirHelpers(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "go.mod"), "module fixture\n", 0o644)
	if err := os.MkdirAll(filepath.Join(root, "sdk"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(root, "sdk/package.json"), `{"name":"sdk"}`, 0o644)
	child := filepath.Join(root, "a", "b")
	if err := os.MkdirAll(child, 0o755); err != nil {
		t.Fatal(err)
	}
	got, err := findRepoRootFrom(child)
	if err != nil {
		t.Fatal(err)
	}
	if got != root {
		t.Fatalf("repo root=%q want %q", got, root)
	}
	if _, err := findRepoRootFrom(t.TempDir()); err == nil {
		t.Fatal("expected missing repo root error")
	}

	pkg := filepath.Join(t.TempDir(), "package")
	nested := filepath.Join(pkg, "echo-wrapper")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := normalizePackageDir(pkg); got != nested {
		t.Fatalf("single child normalized to %q want %q", got, nested)
	}
	writeTestFile(t, filepath.Join(pkg, "service.json"), `{}`, 0o644)
	if got := normalizePackageDir(pkg); got != pkg {
		t.Fatalf("service root normalized to %q want %q", got, pkg)
	}

	multi := t.TempDir()
	if err := os.Mkdir(filepath.Join(multi, "one"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(multi, "two"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got := normalizePackageDir(multi); got != multi {
		t.Fatalf("multi child normalized to %q want %q", got, multi)
	}
}

func TestReplaceServiceDirRollbackAndCleanup(t *testing.T) {
	parent := t.TempDir()
	serviceDir := filepath.Join(parent, "svc")
	prepared := filepath.Join(parent, "prepared")
	if err := os.MkdirAll(prepared, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(prepared, "new.txt"), "new", 0o644)
	rollback, cleanup, err := replaceServiceDir(serviceDir, prepared)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(serviceDir, "new.txt")); err != nil {
		t.Fatalf("prepared dir not moved into service dir: %v", err)
	}
	if err := rollback(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(serviceDir); !os.IsNotExist(err) {
		t.Fatalf("new service dir was not removed on rollback: %v", err)
	}
	if err := cleanup(); err != nil {
		t.Fatal(err)
	}

	if err := os.MkdirAll(serviceDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(serviceDir, "old.txt"), "old", 0o644)
	prepared = filepath.Join(parent, "prepared2")
	if err := os.MkdirAll(prepared, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(prepared, "new.txt"), "new", 0o644)
	rollback, cleanup, err = replaceServiceDir(serviceDir, prepared)
	if err != nil {
		t.Fatal(err)
	}
	if err := rollback(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(serviceDir, "old.txt")); err != nil {
		t.Fatalf("old service dir was not restored: %v", err)
	}
	if err := cleanup(); err != nil {
		t.Fatal(err)
	}
	if _, _, err := replaceServiceDir(filepath.Join(parent, "missing-prepared-target"), filepath.Join(parent, "missing-prepared")); err == nil {
		t.Fatal("expected missing prepared dir rename error")
	}
}

func TestCopyFileAndCopyDirHelpers(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.txt")
	writeTestFile(t, src, "hello", 0o640)
	dst := filepath.Join(dir, "nested", "dst.txt")
	if err := copyFile(src, dst, 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "hello" {
		t.Fatalf("copied body=%q", got)
	}
	if info, err := os.Stat(dst); err != nil || info.Mode().Perm() != 0o600 {
		if err != nil {
			t.Fatal(err)
		}
		t.Fatalf("copied mode=%v", info.Mode().Perm())
	}
	if err := copyFile(filepath.Join(dir, "missing.txt"), filepath.Join(dir, "bad", "dst.txt"), 0o600); err == nil {
		t.Fatal("expected missing source error")
	}
	if err := copyFile(src, filepath.Join(dir, "nested"), 0o600); err == nil {
		t.Fatal("expected destination directory error")
	}
	if err := copyFile(treeReadErrorSource(t, dir), filepath.Join(dir, "read-error.txt"), 0o600); err == nil {
		t.Fatal("expected source read error")
	}

	tree := filepath.Join(dir, "tree")
	if err := os.MkdirAll(filepath.Join(tree, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(tree, "sub/file.txt"), "data", 0o644)
	if err := os.Symlink("sub/file.txt", filepath.Join(tree, "link.txt")); err != nil {
		t.Fatal(err)
	}
	copied := filepath.Join(dir, "copied")
	if err := copyDir(tree, copied); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(copied, "sub/file.txt")); err != nil {
		t.Fatalf("regular file not copied: %v", err)
	}
	if _, err := os.Lstat(filepath.Join(copied, "link.txt")); !os.IsNotExist(err) {
		t.Fatalf("symlink should be skipped, err=%v", err)
	}
	if err := copyDir(filepath.Join(dir, "missing-tree"), filepath.Join(dir, "missing-copy")); err == nil {
		t.Fatal("expected missing tree copy error")
	}
}

func treeReadErrorSource(t *testing.T, dir string) string {
	t.Helper()
	sourceDir := filepath.Join(dir, "source-dir")
	if err := os.MkdirAll(sourceDir, 0o755); err != nil {
		t.Fatal(err)
	}
	return sourceDir
}

func TestTarGzUntarAndUnzipHelpers(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	if err := os.MkdirAll(filepath.Join(src, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(src, "sub", "file.txt"), "hello", 0o640)
	if err := os.Symlink("sub/file.txt", filepath.Join(src, "link.txt")); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(dir, "package.tgz")
	if err := tarGzDir(src, archive); err != nil {
		t.Fatal(err)
	}
	extracted := filepath.Join(dir, "extracted")
	if err := untarGz(archive, extracted); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(extracted, "package", "sub", "file.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "hello" {
		t.Fatalf("untar body=%q", got)
	}
	if _, err := os.Lstat(filepath.Join(extracted, "package", "link.txt")); !os.IsNotExist(err) {
		t.Fatalf("symlink should not be archived, err=%v", err)
	}

	zipPath := filepath.Join(dir, "package.zip")
	zipFile, err := os.Create(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(zipFile)
	dirInfo, err := os.Stat(src)
	if err != nil {
		t.Fatal(err)
	}
	dirHeaderInfo, err := zip.FileInfoHeader(dirInfo)
	if err != nil {
		t.Fatal(err)
	}
	dirHeaderInfo.Name = "package/"
	dirHeader, err := zw.CreateHeader(dirHeaderInfo)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := dirHeader.Write(nil); err != nil {
		t.Fatal(err)
	}
	fileHeader, err := zw.Create("package/bin.js")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fileHeader.Write([]byte("console.log('zip')")); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := zipFile.Close(); err != nil {
		t.Fatal(err)
	}
	unzipped := filepath.Join(dir, "unzipped")
	if err := unzip(zipPath, unzipped); err != nil {
		t.Fatal(err)
	}
	got, err = os.ReadFile(filepath.Join(unzipped, "package", "bin.js"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "console.log('zip')" {
		t.Fatalf("unzip body=%q", got)
	}

	unsafeTGZ := filepath.Join(dir, "unsafe.tgz")
	writeTarArchive(t, unsafeTGZ, tarEntry{name: "../escape.txt", body: "bad"})
	if err := untarGz(unsafeTGZ, filepath.Join(dir, "unsafe-out")); err == nil || !strings.Contains(err.Error(), "unsafe archive path") {
		t.Fatalf("expected unsafe tgz path error, got %v", err)
	}
	unsafeZip := filepath.Join(dir, "unsafe.zip")
	writeZipArchive(t, unsafeZip, "../escape.txt", "bad")
	if err := unzip(unsafeZip, filepath.Join(dir, "unsafe-zip-out")); err == nil || !strings.Contains(err.Error(), "unsafe archive path") {
		t.Fatalf("expected unsafe zip path error, got %v", err)
	}
	if err := tarGzDir(filepath.Join(dir, "missing-src"), filepath.Join(dir, "missing-src.tgz")); err == nil {
		t.Fatal("expected missing source tar error")
	}
	if err := untarGz(filepath.Join(dir, "missing.tgz"), filepath.Join(dir, "missing-out")); err == nil {
		t.Fatal("expected missing tgz error")
	}
	invalidTar := filepath.Join(dir, "invalid-tar.tgz")
	var invalid bytes.Buffer
	invalidGz := gzip.NewWriter(&invalid)
	if _, err := invalidGz.Write([]byte("not tar")); err != nil {
		t.Fatal(err)
	}
	if err := invalidGz.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(invalidTar, invalid.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := untarGz(invalidTar, filepath.Join(dir, "invalid-tar-out")); err == nil {
		t.Fatal("expected invalid tar error")
	}
	if err := unzip(filepath.Join(dir, "missing.zip"), filepath.Join(dir, "missing-zip-out")); err == nil {
		t.Fatal("expected missing zip error")
	}
}

func TestPrepareSourceRejectsUnsupportedAndInvalidArchives(t *testing.T) {
	dataDir, s := openTestStore(t)
	imp := &Importer{DataDir: dataDir, Store: s}

	if _, err := imp.prepareSource(context.Background(), Options{Source: "ssh://github.com/acme/repo.git"}, t.TempDir()); err == nil || !strings.Contains(err.Error(), "only https:// Git remotes are supported") {
		t.Fatalf("expected unsupported git source parse error, got %v", err)
	}
	if _, err := imp.prepareSource(context.Background(), Options{Source: filepath.Join(t.TempDir(), "missing.tgz")}, t.TempDir()); err == nil {
		t.Fatal("expected missing source error")
	}

	badArchive := filepath.Join(t.TempDir(), "package.tgz")
	writeTestFile(t, badArchive, "not gzip", 0o644)
	if _, err := imp.prepareSource(context.Background(), Options{Source: badArchive}, t.TempDir()); err == nil {
		t.Fatal("expected invalid archive error")
	}
}

func TestReplaceLocalExampleSDKBranches(t *testing.T) {
	plain := t.TempDir()
	writeTestFile(t, filepath.Join(plain, "package.json"), `{"name":"plain"}`, 0o644)
	if err := replaceLocalExampleSDK(plain); err != nil {
		t.Fatal(err)
	}
	withSDK := t.TempDir()
	writeTestFile(t, filepath.Join(withSDK, "package.json"), `{"name":"plain","dependencies":{"@chaitin-ai/octobus-sdk":"*"}}`, 0o644)
	if err := replaceLocalExampleSDK(withSDK); err != nil {
		t.Fatal(err)
	}

	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "go.mod"), "module fixture\n", 0o644)
	if err := os.MkdirAll(filepath.Join(root, "sdk", "dist"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(root, "sdk/package.json"), `{"name":"@chaitin-ai/octobus-sdk"}`, 0o644)
	writeTestFile(t, filepath.Join(root, "sdk/dist/cli.js"), "console.log('local sdk')\n", 0o644)
	runtimeDir := filepath.Join(root, "examples", "streaming")
	if err := os.MkdirAll(filepath.Join(runtimeDir, "node_modules/@chaitin-ai/octobus-sdk"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(runtimeDir, "package.json"), `{"name":"octobus-calculator-js","dependencies":{"@chaitin-ai/octobus-sdk":"*"}}`, 0o644)
	writeTestFile(t, filepath.Join(runtimeDir, "node_modules/@chaitin-ai/octobus-sdk/old.txt"), "old", 0o644)
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatalf("restore cwd: %v", err)
		}
	}()
	if err := os.Chdir(filepath.Join(root, "examples")); err != nil {
		t.Fatal(err)
	}
	if err := replaceLocalExampleSDK(runtimeDir); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(runtimeDir, "node_modules/@chaitin-ai/octobus-sdk/dist/cli.js"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "console.log('local sdk')\n" {
		t.Fatalf("local sdk was not copied: %s", got)
	}
	if _, err := os.Stat(filepath.Join(runtimeDir, "node_modules/@chaitin-ai/octobus-sdk/old.txt")); !os.IsNotExist(err) {
		t.Fatalf("old sdk directory was not replaced: %v", err)
	}

	missingDistRoot := t.TempDir()
	writeTestFile(t, filepath.Join(missingDistRoot, "go.mod"), "module fixture\n", 0o644)
	if err := os.MkdirAll(filepath.Join(missingDistRoot, "sdk"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(missingDistRoot, "sdk/package.json"), `{"name":"@chaitin-ai/octobus-sdk"}`, 0o644)
	missingDistRuntime := filepath.Join(missingDistRoot, "examples", "calculator")
	if err := os.MkdirAll(missingDistRuntime, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(missingDistRuntime, "package.json"), `{"name":"octobus-calculator-js","dependencies":{"@chaitin-ai/octobus-sdk":"*"}}`, 0o644)
	if err := os.Chdir(missingDistRoot); err != nil {
		t.Fatal(err)
	}
	err = replaceLocalExampleSDK(missingDistRuntime)
	if err == nil || !strings.Contains(err.Error(), "task sdk:build") || !strings.Contains(err.Error(), filepath.Join("sdk", "dist", "cli.js")) {
		t.Fatalf("expected actionable missing local sdk build error, got %v", err)
	}

	missingRoot := t.TempDir()
	writeTestFile(t, filepath.Join(missingRoot, "package.json"), `{"name":"octobus-calculator-js","dependencies":{"@chaitin-ai/octobus-sdk":"*"}}`, 0o644)
	if err := os.Chdir(missingRoot); err != nil {
		t.Fatal(err)
	}
	if err := replaceLocalExampleSDK(missingRoot); err == nil || !strings.Contains(err.Error(), "repo root") {
		t.Fatalf("expected missing repo root error, got %v", err)
	}
}

func openTestStore(t *testing.T) (string, *store.Store) {
	t.Helper()
	dataDir := filepath.Join(t.TempDir(), "data")
	s, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := s.Close(); err != nil {
			t.Fatal(err)
		}
	})
	return dataDir, s
}

func writeTestPackage(t *testing.T, pkg, manifest string) string {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(pkg, "proto"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(pkg, "node_modules"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(pkg, "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(pkg, "service.json"), manifest, 0o644)
	writeTestFile(t, filepath.Join(pkg, "package.json"), `{"name":"echo-wrapper","version":"1.0.0","bin":{"`+testManifestName(t, manifest)+`":"bin/echo.js"}}`, 0o644)
	writeTestFile(t, filepath.Join(pkg, "bin/echo.js"), "#!/bin/sh\n", 0o755)
	writeTestFile(t, filepath.Join(pkg, "config.schema.json"), `{"type":"object"}`, 0o644)
	writeTestFile(t, filepath.Join(pkg, "secret.schema.json"), `{"type":"object"}`, 0o644)
	writeTestFile(t, filepath.Join(pkg, "proto/echo.proto"), `syntax = "proto3";
package echo.v1;
service EchoService { rpc Echo(EchoRequest) returns (EchoResponse); }
message EchoRequest { string text = 1; }
message EchoResponse { string text = 1; }
`, 0o644)
	return pkg
}

type multiServiceTestPackage struct {
	Root     string
	Services []multiServiceTestService
}

type multiServiceTestService struct {
	ServiceRoot string
	ID          string
	NodeEntry   string
	MethodFull  string
}

func writeMultiServiceTestPackage(t *testing.T, root string) multiServiceTestPackage {
	t.Helper()
	services := []multiServiceTestService{
		{ServiceRoot: "vendor__alpha", ID: "alpha-service", NodeEntry: "bin/alpha-service.js", MethodFull: "alpha.v1.AlphaService/Call"},
		{ServiceRoot: "vendor__beta", ID: "beta-service", NodeEntry: "bin/beta-service.js", MethodFull: "beta.v1.BetaService/Call"},
		{ServiceRoot: "nested/vendor__gamma", ID: "gamma-service", NodeEntry: "bin/gamma-service.js", MethodFull: "gamma.v1.GammaService/Call"},
	}
	if err := os.MkdirAll(filepath.Join(root, "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "node_modules"), 0o755); err != nil {
		t.Fatal(err)
	}
	bin := map[string]string{}
	files := []string{"bin", "vendor__alpha", "vendor__beta", "nested"}
	for _, service := range services {
		bin[service.ID] = service.NodeEntry
		writeTestFile(t, filepath.Join(root, filepath.FromSlash(service.NodeEntry)), "#!/bin/sh\n", 0o755)
		writeMultiServiceRoot(t, root, service)
	}
	pkg := map[string]any{
		"name":    "multi-service-fixture",
		"version": "1.0.0",
		"bin":     bin,
		"files":   files,
	}
	raw, err := json.Marshal(pkg)
	if err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(root, "package.json"), string(raw), 0o644)
	writeIgnoredServiceJSON(t, filepath.Join(root, "node_modules", "ignored"))
	writeIgnoredServiceJSON(t, filepath.Join(root, ".git", "ignored"))
	writeIgnoredServiceJSON(t, filepath.Join(root, ".hidden", "ignored"))
	if err := os.MkdirAll(filepath.Join(root, "plain-dir"), 0o755); err != nil {
		t.Fatal(err)
	}
	return multiServiceTestPackage{Root: root, Services: services}
}

func writeMultiServiceRoot(t *testing.T, root string, service multiServiceTestService) {
	t.Helper()
	serviceDir := filepath.Join(root, filepath.FromSlash(service.ServiceRoot))
	if err := os.MkdirAll(serviceDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(serviceDir, "proto"), 0o755); err != nil {
		t.Fatal(err)
	}
	methodService, _, ok := strings.Cut(service.MethodFull, "/")
	if !ok {
		t.Fatalf("invalid method full name %q", service.MethodFull)
	}
	lastDot := strings.LastIndex(methodService, ".")
	if lastDot < 0 {
		t.Fatalf("invalid method full name %q", service.MethodFull)
	}
	protoPackage := methodService[:lastDot]
	serviceName := methodService[lastDot+1:]
	manifest := map[string]any{
		"schema":       "chaitin.octobus.service.v1",
		"name":         service.ID,
		"displayName":  service.ID + " display",
		"configSchema": "config.schema.json",
		"secretSchema": "secret.schema.json",
		"proto": map[string]any{
			"roots": []string{"proto"},
			"files": []string{"proto/service.proto"},
		},
	}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(serviceDir, "service.json"), string(raw), 0o644)
	writeTestFile(t, filepath.Join(serviceDir, "config.schema.json"), `{"type":"object"}`, 0o644)
	writeTestFile(t, filepath.Join(serviceDir, "secret.schema.json"), `{"type":"object"}`, 0o644)
	writeTestFile(t, filepath.Join(serviceDir, "proto/service.proto"), `syntax = "proto3";
package `+protoPackage+`;
service `+serviceName+` { rpc Call(CallRequest) returns (CallResponse); }
message CallRequest { string text = 1; }
message CallResponse { string text = 1; }
`, 0o644)
}

func writeIgnoredServiceJSON(t *testing.T, dir string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(dir, "service.json"), `{"schema":"chaitin.octobus.service.v1","name":"ignored","proto":{"roots":["proto"],"files":["proto/ignored.proto"]}}`, 0o644)
}

func updateMultiServiceManifestName(t *testing.T, root, serviceRoot, name string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(serviceRoot), "service.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var manifest map[string]any
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	manifest["name"] = name
	manifest["displayName"] = name + " display"
	updated, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, path, string(updated), 0o644)
}

func updatePackageBin(t *testing.T, root string, mutate func(map[string]string)) {
	t.Helper()
	path := filepath.Join(root, "package.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var pkg struct {
		Name    string            `json:"name"`
		Version string            `json:"version"`
		Bin     map[string]string `json:"bin"`
		Files   []string          `json:"files"`
	}
	if err := json.Unmarshal(raw, &pkg); err != nil {
		t.Fatal(err)
	}
	mutate(pkg.Bin)
	updated, err := json.Marshal(pkg)
	if err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, path, string(updated), 0o644)
}

func updatePackageFiles(t *testing.T, root string, mutate func([]string) []string) {
	t.Helper()
	path := filepath.Join(root, "package.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var pkg struct {
		Name    string            `json:"name"`
		Version string            `json:"version"`
		Bin     map[string]string `json:"bin"`
		Files   []string          `json:"files"`
	}
	if err := json.Unmarshal(raw, &pkg); err != nil {
		t.Fatal(err)
	}
	pkg.Files = mutate(pkg.Files)
	updated, err := json.Marshal(pkg)
	if err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, path, string(updated), 0o644)
}

func testManifestName(t *testing.T, manifest string) string {
	t.Helper()
	var m struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal([]byte(manifest), &m); err != nil || m.Name == "" {
		return "echo-wrapper"
	}
	return m.Name
}

func writeTestFile(t *testing.T, path, body string, mode os.FileMode) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), mode); err != nil {
		t.Fatal(err)
	}
}

func writeTarGzPackage(t *testing.T, dst, src string) {
	t.Helper()
	out, err := os.Create(dst)
	if err != nil {
		t.Fatal(err)
	}
	defer out.Close()
	gz := gzip.NewWriter(out)
	defer gz.Close()
	tw := tar.NewWriter(gz)
	defer tw.Close()
	walkPackage(t, src, func(path, rel string, info os.FileInfo) {
		hdr, err := tar.FileInfoHeader(info, "")
		if err != nil {
			t.Fatal(err)
		}
		hdr.Name = filepath.ToSlash(filepath.Join("package", rel))
		if err := tw.WriteHeader(hdr); err != nil {
			t.Fatal(err)
		}
		if info.IsDir() {
			return
		}
		in, err := os.Open(path)
		if err != nil {
			t.Fatal(err)
		}
		defer in.Close()
		if _, err := io.Copy(tw, in); err != nil {
			t.Fatal(err)
		}
	})
}

func writeZipPackage(t *testing.T, dst, src string) {
	t.Helper()
	out, err := os.Create(dst)
	if err != nil {
		t.Fatal(err)
	}
	defer out.Close()
	zw := zip.NewWriter(out)
	defer zw.Close()
	walkPackage(t, src, func(path, rel string, info os.FileInfo) {
		name := filepath.ToSlash(filepath.Join("package", rel))
		if info.IsDir() {
			name += "/"
		}
		header, err := zip.FileInfoHeader(info)
		if err != nil {
			t.Fatal(err)
		}
		header.Name = name
		w, err := zw.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		if info.IsDir() {
			return
		}
		in, err := os.Open(path)
		if err != nil {
			t.Fatal(err)
		}
		defer in.Close()
		if _, err := io.Copy(w, in); err != nil {
			t.Fatal(err)
		}
	})
}

type tarEntry struct {
	name string
	body string
}

func writeTarArchive(t *testing.T, dst string, entries ...tarEntry) {
	t.Helper()
	out, err := os.Create(dst)
	if err != nil {
		t.Fatal(err)
	}
	defer out.Close()
	gz := gzip.NewWriter(out)
	defer gz.Close()
	tw := tar.NewWriter(gz)
	defer tw.Close()
	for _, entry := range entries {
		hdr := &tar.Header{Name: entry.name, Mode: 0o644, Size: int64(len(entry.body)), Typeflag: tar.TypeReg}
		if err := tw.WriteHeader(hdr); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write([]byte(entry.body)); err != nil {
			t.Fatal(err)
		}
	}
}

func writeZipArchive(t *testing.T, dst, name, body string) {
	t.Helper()
	out, err := os.Create(dst)
	if err != nil {
		t.Fatal(err)
	}
	defer out.Close()
	zw := zip.NewWriter(out)
	defer zw.Close()
	w, err := zw.Create(name)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write([]byte(body)); err != nil {
		t.Fatal(err)
	}
}

func walkPackage(t *testing.T, src string, fn func(path, rel string, info os.FileInfo)) {
	t.Helper()
	if err := filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if path == src {
			return nil
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		fn(path, rel, info)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func hasImportProgressStage(events []ImportProgressEvent, stage string) bool {
	for _, event := range events {
		if event.Stage == stage {
			return true
		}
	}
	return false
}
