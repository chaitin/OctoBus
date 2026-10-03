package packageimport

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"testing"
	"time"
)

// inodeOf returns the inode of the file or directory a path resolves to,
// following symlinks. Comparing Lstat output would compare the links
// themselves, which says nothing about whether they share a target.
func inodeOf(t *testing.T, path string) uint64 {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		t.Skip("inode comparison requires a unix Stat_t")
	}
	return stat.Ino
}

func isSymlink(t *testing.T, path string) bool {
	t.Helper()
	info, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	return info.Mode()&os.ModeSymlink != 0
}

func sharedTreeEntries(t *testing.T, dataDir string) []string {
	t.Helper()
	entries, err := os.ReadDir(sharedTreesDir(dataDir))
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		t.Fatal(err)
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	return names
}

func TestImportRecursiveSharesOneTreeAcrossServices(t *testing.T) {
	ctx := context.Background()
	dataDir, s := openTestStore(t)
	pkg := writeMultiServiceTestPackage(t, t.TempDir())
	imp := &Importer{DataDir: dataDir, Store: s}

	res, err := imp.ImportRecursive(ctx, Options{Source: pkg.Root, Build: "never", Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Services) != 3 {
		t.Fatalf("imported %d services, want 3", len(res.Services))
	}

	shared := sharedTreeEntries(t, dataDir)
	if len(shared) != 1 {
		t.Fatalf("shared trees=%v, want exactly 1 for a 3 service package", shared)
	}

	for _, svc := range res.Services {
		for _, name := range []string{"package", "runtime"} {
			path := filepath.Join(dataDir, "artifacts", "services", svc.ID, name)
			if !isSymlink(t, path) {
				t.Fatalf("%s/%s is not a symlink; the tree was copied, not shared", svc.ID, name)
			}
			// The link must resolve, and both links must reach the same tree.
			target, err := os.Readlink(path)
			if err != nil {
				t.Fatal(err)
			}
			if !filepath.IsAbs(target) {
				t.Fatalf("%s/%s target %q is not absolute", svc.ID, name, target)
			}
			if got := filepath.Base(target); got != shared[0] {
				t.Fatalf("%s/%s points at %q, want the shared tree %q", svc.ID, name, got, shared[0])
			}
		}
		// Both package/ and runtime/ must reach the same shared tree, since the
		// runtime tree is the package tree plus installed dependencies.
		pkgIno := inodeOf(t, filepath.Join(dataDir, "artifacts", "services", svc.ID, "package"))
		runIno := inodeOf(t, filepath.Join(dataDir, "artifacts", "services", svc.ID, "runtime"))
		if pkgIno != runIno {
			t.Fatalf("%s: package/ and runtime/ point at different trees", svc.ID)
		}
	}
}

func TestImportRecursiveSharedTreeIsReadableThroughTheLink(t *testing.T) {
	ctx := context.Background()
	dataDir, s := openTestStore(t)
	pkg := writeMultiServiceTestPackage(t, t.TempDir())
	imp := &Importer{DataDir: dataDir, Store: s}

	res, err := imp.ImportRecursive(ctx, Options{Source: pkg.Root, Build: "never", Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	svc := res.Services[0]
	serviceDir := filepath.Join(dataDir, "artifacts", "services", svc.ID)

	// The daemon reads the entrypoint and the schemas through these paths.
	if _, err := os.Stat(filepath.Join(serviceDir, "runtime", svc.NodeEntry)); err != nil {
		t.Fatalf("runtime entry is not reachable through the shared link: %v", err)
	}
	if _, err := os.Stat(filepath.Join(serviceDir, "package", svc.NodeEntry)); err != nil {
		t.Fatalf("package entry is not reachable through the shared link: %v", err)
	}
	if svc.ConfigSchemaPath != "" {
		if _, err := os.Stat(svc.ConfigSchemaPath); err != nil {
			t.Fatalf("config schema is not reachable: %v", err)
		}
	}
	if _, err := os.Stat(svc.DescriptorPath); err != nil {
		t.Fatalf("descriptor is not reachable: %v", err)
	}
}

func TestImportRecursiveReimportReusesSharedTree(t *testing.T) {
	ctx := context.Background()
	dataDir, s := openTestStore(t)
	pkg := writeMultiServiceTestPackage(t, t.TempDir())
	imp := &Importer{DataDir: dataDir, Store: s}

	if _, err := imp.ImportRecursive(ctx, Options{Source: pkg.Root, Build: "never", Offline: true}); err != nil {
		t.Fatal(err)
	}
	shared := sharedTreeEntries(t, dataDir)
	if len(shared) != 1 {
		t.Fatalf("shared trees=%v, want 1", shared)
	}
	before := inodeOf(t, filepath.Join(sharedTreesDir(dataDir), shared[0]))

	// Re-import the same package. The tree is content-addressed, so nothing
	// should be rebuilt or duplicated.
	if _, err := imp.ImportRecursive(ctx, Options{Source: pkg.Root, Build: "never", Offline: true}); err != nil {
		t.Fatal(err)
	}
	shared = sharedTreeEntries(t, dataDir)
	if len(shared) != 1 {
		t.Fatalf("shared trees=%v after re-import, want still 1", shared)
	}
	after := inodeOf(t, filepath.Join(sharedTreesDir(dataDir), shared[0]))
	if before != after {
		t.Fatalf("shared tree was rebuilt on re-import: inode %d -> %d", before, after)
	}
}

// TestPrepareServiceRuntimeSkipsRebuildWhenTreeExists pins the reuse fast path.
//
// Reuse has to mean "do not build", not merely "produce the same result": an
// earlier version of this code rebuilt the tree on every import and relied on
// publishSharedTree to discard the result, which leaves byte-identical state on
// disk. Only a build counter can tell the two apart.
func TestPrepareServiceRuntimeSkipsRebuildWhenTreeExists(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	pkg := writeMultiServiceTestPackage(t, filepath.Join(root, "pkg"))
	dataDir := filepath.Join(root, "data")
	staging := filepath.Join(root, "staging")
	if err := os.MkdirAll(staging, 0o755); err != nil {
		t.Fatal(err)
	}
	prepared := preparedSource{PackageDir: pkg.Root, PackageSHA256: "sha", ServiceRoot: "."}
	opts := Options{Build: "never", Offline: true}

	var builds int
	buildCount = &builds
	defer func() { buildCount = nil }()

	first, err := prepareServiceRuntime(ctx, dataDir, prepared, staging, opts)
	if err != nil {
		t.Fatal(err)
	}
	if first.SharedDir == "" {
		t.Fatal("expected a shared tree")
	}
	if builds != 1 {
		t.Fatalf("first import built the tree %d times, want 1", builds)
	}

	second, err := prepareServiceRuntime(ctx, dataDir, prepared, staging, opts)
	if err != nil {
		t.Fatal(err)
	}
	if second.SharedDir != first.SharedDir {
		t.Fatalf("second import used %q, want the existing tree %q", second.SharedDir, first.SharedDir)
	}
	if builds != 1 {
		t.Fatalf("second import rebuilt the tree (%d builds); the published tree was not reused", builds)
	}
	// The reused tree must still contain every discovered service root. A
	// multi-service package has no service.json at the tree root, so check the
	// per-service manifests instead.
	for _, service := range pkg.Services {
		manifest := filepath.Join(second.SharedDir, filepath.FromSlash(service.ServiceRoot), "service.json")
		if _, err := os.Stat(manifest); err != nil {
			t.Fatalf("reused tree is missing %s: %v", service.ServiceRoot, err)
		}
	}
}

func TestDeleteServiceDirLeavesSharedTreeIntact(t *testing.T) {
	ctx := context.Background()
	dataDir, s := openTestStore(t)
	pkg := writeMultiServiceTestPackage(t, t.TempDir())
	imp := &Importer{DataDir: dataDir, Store: s}

	res, err := imp.ImportRecursive(ctx, Options{Source: pkg.Root, Build: "never", Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	shared := sharedTreeEntries(t, dataDir)
	if len(shared) != 1 {
		t.Fatalf("shared trees=%v, want 1", shared)
	}
	treePath := filepath.Join(sharedTreesDir(dataDir), shared[0])
	before := inodeOf(t, treePath)

	// Removing a service directory is the operation that would destroy a
	// shared tree if os.RemoveAll followed symlinks. It must not.
	serviceDir := filepath.Join(dataDir, "artifacts", "services", res.Services[0].ID)
	if err := os.RemoveAll(serviceDir); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(treePath); err != nil {
		t.Fatalf("shared tree was destroyed by RemoveAll of a service dir: %v", err)
	}
	if after := inodeOf(t, treePath); after != before {
		t.Fatalf("shared tree inode changed: %d -> %d", before, after)
	}
	// The other service must keep working.
	other := filepath.Join(dataDir, "artifacts", "services", res.Services[1].ID, "runtime")
	if _, err := os.Stat(filepath.Join(other, res.Services[1].NodeEntry)); err != nil {
		t.Fatalf("sibling service lost its runtime: %v", err)
	}
}

func TestImportReinstallKeepsRealDirectories(t *testing.T) {
	ctx := context.Background()
	dataDir, s := openTestStore(t)
	pkg := writeTestPackage(t, filepath.Join(t.TempDir(), "pkg"), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	imp := &Importer{DataDir: dataDir, Store: s}

	// --reinstall wipes node_modules, so it must not publish or reuse a shared
	// tree that other services may be running on.
	if _, err := imp.Import(ctx, Options{ServiceID: "echo", Source: pkg, Build: "never", Offline: true, Reinstall: true}); err != nil {
		t.Fatal(err)
	}
	if shared := sharedTreeEntries(t, dataDir); len(shared) != 0 {
		t.Fatalf("shared trees=%v, want none for --reinstall", shared)
	}
	runtimeDir := filepath.Join(dataDir, "artifacts", "services", "echo", "runtime")
	if isSymlink(t, runtimeDir) {
		t.Fatal("runtime is a symlink under --reinstall, want a real directory")
	}
	if _, err := os.Stat(filepath.Join(runtimeDir, "service.json")); err != nil {
		t.Fatalf("runtime tree is incomplete: %v", err)
	}
}

// A tree whose dependencies get installed during the import depends on state
// the key cannot capture: the effective registry and its contents, and the npm
// version. A published tree is never rebuilt while its key holds, so reusing
// one would pin services to an old resolution silently.
func TestSharingEligibleRejectsTreeNeedingInstall(t *testing.T) {
	// No dependencies at all: nothing is resolved against the registry. The
	// lockfile refresh prepareRuntime runs for such a tree is a deterministic
	// local operation, so the tree remains a pure function of the package.
	noDeps := t.TempDir()
	writeTestFile(t, filepath.Join(noDeps, "package.json"), `{"name":"no-deps","dependencies":{}}`, 0o644)
	if !sharingEligible(preparedSource{PackageDir: noDeps}, Options{}) {
		t.Fatal("a package with no dependencies installs nothing and should be shareable")
	}

	// Declared but not carried: npmInstall resolves them at import time, so the
	// tree depends on the effective registry and npm version, neither of which
	// is in the key.
	needsInstall := t.TempDir()
	writeTestFile(t, filepath.Join(needsInstall, "package.json"),
		`{"name":"needs-install","dependencies":{"left-pad":"^1.0.0"}}`, 0o644)
	if sharingEligible(preparedSource{PackageDir: needsInstall}, Options{}) {
		t.Fatal("a tree built by installing at import time must not be shared")
	}

	// Declared and carried inside the package, which is how a packed service
	// package ships: bundledDependencies land in package/node_modules. Nothing
	// is resolved at import time, so it is shareable again. Getting this wrong
	// in the other direction would silently drop the optimisation for every
	// real package.
	carried := t.TempDir()
	writeTestFile(t, filepath.Join(carried, "package.json"),
		`{"name":"carried","dependencies":{"left-pad":"^1.0.0"}}`, 0o644)
	mustMkdirAll(t, filepath.Join(carried, "node_modules", "left-pad"))
	writeTestFile(t, filepath.Join(carried, "node_modules", "left-pad", "index.js"), "module.exports=1", 0o644)
	if !sharingEligible(preparedSource{PackageDir: carried}, Options{}) {
		t.Fatal("a package that carries its dependencies installs nothing and should be shareable")
	}

	// Scoped dependency names must be matched against their directory path.
	scoped := t.TempDir()
	writeTestFile(t, filepath.Join(scoped, "package.json"),
		`{"name":"scoped","dependencies":{"@scope/pkg":"^1.0.0"}}`, 0o644)
	if sharingEligible(preparedSource{PackageDir: scoped}, Options{}) {
		t.Fatal("unscoped match would wrongly find @scope/pkg and mark this shareable")
	}
	mustMkdirAll(t, filepath.Join(scoped, "node_modules", "@scope", "pkg"))
	writeTestFile(t, filepath.Join(scoped, "node_modules", "@scope", "pkg", "index.js"), "x", 0o644)
	if !sharingEligible(preparedSource{PackageDir: scoped}, Options{}) {
		t.Fatal("scoped dependency carried in node_modules should be shareable")
	}
}

func TestSharingEligibleRejectsReinstallAndLocalExamples(t *testing.T) {
	dir := t.TempDir()
	writeTestFile(t, filepath.Join(dir, "package.json"), `{"name":"plain","dependencies":{}}`, 0o644)
	if sharingEligible(preparedSource{PackageDir: dir}, Options{Reinstall: true}) {
		t.Fatal("--reinstall wipes node_modules and must not share")
	}

	for name := range localExamplePackageNames {
		local := t.TempDir()
		writeTestFile(t, filepath.Join(local, "package.json"), `{"name":"`+name+`","dependencies":{}}`, 0o644)
		if sharingEligible(preparedSource{PackageDir: local}, Options{}) {
			t.Fatalf("%s embeds the live sdk/ tree and must not share", name)
		}
	}
}

// mustRuntimeTreeKey adapts runtimeTreeKey's error return for tests that only
// care about the key. A fingerprint failure here is a test setup problem, not
// a case under test.
func mustRuntimeTreeKey(t *testing.T, prepared preparedSource, opts Options) string {
	t.Helper()
	key, err := runtimeTreeKey(prepared, opts)
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func TestRuntimeTreeKeySeparatesVariants(t *testing.T) {
	base := preparedSource{PackageSHA256: "abc", RuntimeNodeModulesDir: ""}
	baseKey := mustRuntimeTreeKey(t, base, Options{})
	if baseKey == "" {
		t.Fatal("key must not be empty")
	}
	if got := mustRuntimeTreeKey(t, base, Options{}); got != baseKey {
		t.Fatalf("key is not deterministic: %q vs %q", got, baseKey)
	}
	for name, opts := range map[string]Options{
		"offline":   {Offline: true},
		"reinstall": {Reinstall: true},
	} {
		if mustRuntimeTreeKey(t, base, opts) == baseKey {
			t.Fatalf("%s must produce a different key from the default", name)
		}
	}
	other := preparedSource{PackageSHA256: "def"}
	if mustRuntimeTreeKey(t, other, Options{}) == baseKey {
		t.Fatal("a different package hash must produce a different key")
	}
}

func TestRuntimeTreeKeyIncludesNodeModulesFingerprint(t *testing.T) {
	dir := t.TempDir()
	writeTestFile(t, filepath.Join(dir, "index.js"), "a", 0o644)
	withDeps := preparedSource{PackageSHA256: "same", RuntimeNodeModulesDir: dir}

	if mustRuntimeTreeKey(t, withDeps, Options{}) == mustRuntimeTreeKey(t, preparedSource{PackageSHA256: "same"}, Options{}) {
		t.Fatal("carried-in node_modules must change the key; otherwise two different runtime trees collide")
	}

	before := mustRuntimeTreeKey(t, withDeps, Options{})
	writeTestFile(t, filepath.Join(dir, "extra.js"), "bb", 0o644)
	if mustRuntimeTreeKey(t, withDeps, Options{}) == before {
		t.Fatal("adding a file to node_modules must change the key")
	}
}

// The fingerprint is recomputed on every import, so it has to be stable across
// runs. copyDir preserves permission bits but not mtimes, so anything derived
// from mtimes would differ each time and the shared tree would never be reused.
func TestNodeModulesFingerprintIgnoresMtime(t *testing.T) {
	dir := t.TempDir()
	writeTestFile(t, filepath.Join(dir, "a.js"), "a", 0o644)
	before, err := nodeModulesFingerprint(dir)
	if err != nil {
		t.Fatal(err)
	}

	old := time.Now().Add(-72 * time.Hour)
	if err := os.Chtimes(filepath.Join(dir, "a.js"), old, old); err != nil {
		t.Fatal(err)
	}
	after, err := nodeModulesFingerprint(dir)
	if err != nil {
		t.Fatal(err)
	}
	if after != before {
		t.Fatalf("fingerprint changed with mtime alone: %q -> %q", before, after)
	}
}

func TestNodeModulesFingerprintDetectsContentChange(t *testing.T) {
	dir := t.TempDir()
	writeTestFile(t, filepath.Join(dir, "a.js"), "a", 0o644)
	before, err := nodeModulesFingerprint(dir)
	if err != nil {
		t.Fatal(err)
	}
	// Same path, different size: a dependency set that changed must be seen.
	writeTestFile(t, filepath.Join(dir, "a.js"), "aaaa", 0o644)
	after, err := nodeModulesFingerprint(dir)
	if err != nil {
		t.Fatal(err)
	}
	if after == before {
		t.Fatal("fingerprint did not change when a file's size changed")
	}
}

func TestNodeModulesFingerprintEmptyDirIsStable(t *testing.T) {
	got, err := nodeModulesFingerprint("")
	if err != nil {
		t.Fatal(err)
	}
	if got != "" {
		t.Fatalf("empty node_modules dir must fingerprint as empty, got %q", got)
	}
	dir := t.TempDir()
	fp, err := nodeModulesFingerprint(dir)
	if err != nil {
		t.Fatal(err)
	}
	if fp == "" {
		t.Fatal("an existing but empty node_modules dir must not fingerprint as absent")
	}
}

// An unreadable file must fail the fingerprint rather than be skipped. A
// dropped hash line can make two different trees share a key, and the stale
// tree would then be served with no error and no rebuild -- the exact failure
// the content hash exists to prevent.
func TestNodeModulesFingerprintFailsOnUnreadableFile(t *testing.T) {
	dir := t.TempDir()
	writeTestFile(t, filepath.Join(dir, "good.js"), "a", 0o644)
	blocked := filepath.Join(dir, "blocked.js")
	writeTestFile(t, blocked, "b", 0o000)
	if runtime.GOOS != "windows" {
		// root would still read it; the test user is not root.
		if _, err := nodeModulesFingerprint(dir); err == nil {
			t.Fatal("an unreadable file must fail the fingerprint, not be skipped")
		}
	}
	os.Remove(blocked)

	// A missing directory is an error too: the caller asked to fingerprint a
	// tree it believed existed, and silence would hide a real problem.
	if _, err := nodeModulesFingerprint(filepath.Join(dir, "absent")); err == nil {
		t.Fatal("a missing node_modules dir must fail, not fingerprint as empty")
	}
}

// needsRuntimeInstall predicts what prepareRuntime's gate, willRuntimeInstall,
// will decide about the tree buildRuntimeTree assembles: PackageDir with
// RuntimeNodeModulesDir's node_modules laid over it. A drift between the two
// either publishes trees an install would have rebuilt (the stale-tree failure
// the gate exists to prevent) or refuses to share packed packages. The cases
// cover each dependency field --omit=dev resolves, so widening the install
// surface without widening the prediction fails here.
//
// Zero-dependency packages are deliberately absent: for them the two answers
// legitimately differ. willRuntimeInstall says an install runs (npm refreshes
// the lockfile), while needsRuntimeInstall says the tree is shareable -- the
// lockfile refresh is a deterministic local operation with no registry input,
// verified empirically, so there is nothing for the key to miss. This test
// pins the registry-bearing shapes; TestSharingEligibleRejectsTreeNeedingInstall
// pins the zero-dependency verdict.
func TestNeedsRuntimeInstallMatchesPrepareRuntime(t *testing.T) {
	tests := []struct {
		name string
		// pkg is written as the package.json of PackageDir.
		pkg string
		// carried lists dependency names present in the package's own
		// node_modules; carriedExternal in RuntimeNodeModulesDir's.
		carried         []string
		carriedExternal []string
	}{
		{name: "dependencies carried in package", pkg: `{"name":"a","dependencies":{"left-pad":"^1"}}`, carried: []string{"left-pad"}},
		{name: "dependencies carried externally", pkg: `{"name":"a","dependencies":{"left-pad":"^1"}}`, carriedExternal: []string{"left-pad"}},
		{name: "optionalDependencies carried in package", pkg: `{"name":"a","optionalDependencies":{"left-pad":"^1"}}`, carried: []string{"left-pad"}},
		{name: "optionalDependencies missing", pkg: `{"name":"a","optionalDependencies":{"left-pad":"^1"}}`},
		{name: "peerDependencies carried in package", pkg: `{"name":"a","peerDependencies":{"left-pad":"^1"}}`, carried: []string{"left-pad"}},
		{name: "peerDependencies missing", pkg: `{"name":"a","peerDependencies":{"left-pad":"^1"}}`},
		{name: "optional overrides dependencies on the same name", pkg: `{"name":"a","dependencies":{"left-pad":"^1","other":"^1"},"optionalDependencies":{"left-pad":"^2"}}`, carried: []string{"other"}},
		{name: "mixed fields, one missing", pkg: `{"name":"a","dependencies":{"a-dep":"^1"},"optionalDependencies":{"opt-dep":"^1"}}`, carried: []string{"a-dep"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			pkgDir := t.TempDir()
			writeTestFile(t, filepath.Join(pkgDir, "package.json"), tc.pkg, 0o644)
			writeDeps := func(root string, names []string) {
				for _, name := range names {
					dir := filepath.Join(root, "node_modules", filepath.FromSlash(name))
					mustMkdirAll(t, dir)
					writeTestFile(t, filepath.Join(dir, "index.js"), "module.exports=1", 0o644)
				}
			}
			writeDeps(pkgDir, tc.carried)

			external := t.TempDir()
			writeDeps(external, tc.carriedExternal)

			prepared := preparedSource{PackageDir: pkgDir, RuntimeNodeModulesDir: external}
			predicted := needsRuntimeInstall(prepared)

			// Assemble the tree the way buildRuntimeTree does and ask the gate
			// prepareRuntime actually branches on.
			assembled := t.TempDir()
			if err := copyDir(pkgDir, assembled); err != nil {
				t.Fatal(err)
			}
			if external != "" {
				if err := copyDir(external, filepath.Join(assembled, "node_modules")); err != nil {
					t.Fatal(err)
				}
			}
			wouldInstall := willRuntimeInstall(assembled, false)
			if predicted != wouldInstall {
				t.Fatalf("needsRuntimeInstall=%v but willRuntimeInstall=%v on the assembled tree; the gate and the prediction disagree", predicted, wouldInstall)
			}
		})
	}
}

// A peer marked optional through peerDependenciesMeta is skipped by npm when
// unresolvable, so its absence does not make the tree depend on the registry.
// It must not predict an install, and its presence in node_modules must
// satisfy the check like any other carried dependency.
func TestNeedsRuntimeInstallTreatsOptionalPeersAsOptional(t *testing.T) {
	pkg := `{"name":"a","peerDependencies":{"left-pad":"^1.0.0"},"peerDependenciesMeta":{"left-pad":{"optional":true}}}`

	// Declared but not carried: npm skips it, so the tree stays a pure
	// function of the package and no install is predicted.
	absent := t.TempDir()
	writeTestFile(t, filepath.Join(absent, "package.json"), pkg, 0o644)
	if needsRuntimeInstall(preparedSource{PackageDir: absent}) {
		t.Fatal("an unresolvable optional peer must not predict an install; npm skips it")
	}

	// Carried: satisfied like any other dependency.
	carried := t.TempDir()
	writeTestFile(t, filepath.Join(carried, "package.json"), pkg, 0o644)
	mustMkdirAll(t, filepath.Join(carried, "node_modules", "left-pad"))
	writeTestFile(t, filepath.Join(carried, "node_modules", "left-pad", "index.js"), "module.exports=1", 0o644)
	if needsRuntimeInstall(preparedSource{PackageDir: carried}) {
		t.Fatal("a carried optional peer must satisfy the check")
	}

	// The non-optional twin must still predict an install when missing.
	hard := t.TempDir()
	writeTestFile(t, filepath.Join(hard, "package.json"),
		`{"name":"b","peerDependencies":{"left-pad":"^1.0.0"}}`, 0o644)
	if !needsRuntimeInstall(preparedSource{PackageDir: hard}) {
		t.Fatal("a missing non-optional peer must still predict an install")
	}
}

// An optionalDependencies entry whose file: target is missing installs
// cleanly -- npm skips it -- so it must neither veto the install gate nor,
// given that the install then runs, escape the prediction: a declared-but-
// missing optional still predicts an install, and the gate must agree.
func TestOptionalFileDependencyMissingDoesNotVetoInstall(t *testing.T) {
	pkg := t.TempDir()
	writeTestFile(t, filepath.Join(pkg, "package.json"),
		`{"name":"a","optionalDependencies":{"missing-local":"file:./vendor/missing"}}`, 0o644)

	// The gate: an actually assembled tree, as buildRuntimeTree would build.
	assembled := t.TempDir()
	if err := copyDir(pkg, assembled); err != nil {
		t.Fatal(err)
	}
	if !willRuntimeInstall(assembled, false) {
		t.Fatal("a missing optional file: target must not veto the install; npm skips it")
	}

	// The prediction agrees: declared but not carried predicts an install.
	if !needsRuntimeInstall(preparedSource{PackageDir: pkg}) {
		t.Fatal("a declared-but-missing optional dependency must predict an install")
	}

	// The regular file: twin still vetoes.
	hard := t.TempDir()
	writeTestFile(t, filepath.Join(hard, "package.json"),
		`{"name":"b","dependencies":{"missing-local":"file:./vendor/missing"}}`, 0o644)
	hardAssembled := t.TempDir()
	if err := copyDir(hard, hardAssembled); err != nil {
		t.Fatal(err)
	}
	if willRuntimeInstall(hardAssembled, false) {
		t.Fatal("a missing regular file: target must veto the install as before")
	}
}

// The hardening read grant is the resolved tree, not the whole store: other
// services' trees hold their code, and a compromised runtime has no business
// reading them. A legacy service (real directories) references no tree and
// yields no grant. A link pointing outside the store grants the target itself
// -- the store root would not cover the target, so falling back to it would
// widen the surface without letting the service start, which is why the
// subtest below asserts the store root must never come back.
func TestSharedTreeReadGrants(t *testing.T) {
	dataDir := t.TempDir()
	store := SharedTreesDir(dataDir)
	servicesDir := filepath.Join(dataDir, "artifacts", "services")
	mustMkdirAll(t, servicesDir)
	tree := makeSharedTree(t, dataDir, "some-tree")

	t.Run("linked service grants its tree", func(t *testing.T) {
		dir := filepath.Join(servicesDir, "linked")
		mustMkdirAll(t, dir)
		for _, entry := range []string{"package", "runtime"} {
			if err := os.Symlink(tree, filepath.Join(dir, entry)); err != nil {
				t.Fatal(err)
			}
		}
		grants := SharedTreeReadGrants(dataDir, "linked")
		if len(grants) != 1 || grants[0] != tree {
			t.Fatalf("grants=%v, want exactly [%s]", grants, tree)
		}
	})

	t.Run("legacy real directories grant nothing", func(t *testing.T) {
		dir := filepath.Join(servicesDir, "legacy")
		mustMkdirAll(t, filepath.Join(dir, "package"))
		mustMkdirAll(t, filepath.Join(dir, "runtime"))
		if grants := SharedTreeReadGrants(dataDir, "legacy"); len(grants) != 0 {
			t.Fatalf("grants=%v, want none for real directories", grants)
		}
	})

	t.Run("target outside the store grants the target itself", func(t *testing.T) {
		dir := filepath.Join(servicesDir, "weird")
		mustMkdirAll(t, dir)
		outside := t.TempDir()
		if err := os.Symlink(outside, filepath.Join(dir, "runtime")); err != nil {
			t.Fatal(err)
		}
		// The store root would not cover the target anyway -- the runtime's
		// entry resolves under it and Node would still refuse -- so granting
		// it directly is both narrower and the only thing that starts.
		grants := SharedTreeReadGrants(dataDir, "weird")
		if len(grants) != 1 || grants[0] != filepath.Clean(outside) {
			t.Fatalf("grants=%v, want the resolved target %s", grants, outside)
		}
		if len(grants) == 1 && grants[0] == store {
			t.Fatalf("grants=%v, must not fall back to the store root", grants)
		}
	})

	t.Run("absent service yields no grant", func(t *testing.T) {
		if grants := SharedTreeReadGrants(dataDir, "absent"); len(grants) != 0 {
			t.Fatalf("grants=%v, want none", grants)
		}
	})
}
