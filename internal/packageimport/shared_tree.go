package packageimport

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
)

// A recursive import materializes the whole distribution package once and then
// copies it, plus the runtime tree built from it, into every discovered
// service directory. Across N services those copies are byte-identical: only
// descriptor.protoset differs. For an 11 service package that is roughly
// 11 x 5,785 files of pure duplication.
//
// Shared trees remove the duplication. The runtime tree is built once, moved
// into a content-addressed directory under artifacts/runtimes, and each
// service directory gets a symlink to it instead of a copy.
//
// Every consumer already follows symlinks: the supervisor and the on-demand
// gateway both resolve the entrypoint with os.Stat plus Mode().IsRegular(),
// ConfigSchemaPath is read with os.ReadFile, and validatePackageFile compares
// absolute paths lexically. os.RemoveAll does not follow symlinks, so the swap
// and rollback paths in replaceServiceDir unlink the link and leave the shared
// tree intact.

// preparedRuntime is the outcome of building a runtime tree for one import run.
//
// Exactly one field is set. SharedDir is used when the tree was published to
// the content-addressed store and can be symlinked into service directories.
// StagingDir is the fallback for imports that are not shareable, and is copied
// per service exactly as before.
type preparedRuntime struct {
	SharedDir  string
	StagingDir string
}

// buildCount, when non-nil, counts runtime tree builds. It exists so tests can
// observe whether a shared tree was rebuilt or reused; nothing in production
// sets it, so the cost is a single nil check per import.
var buildCount *int

func sharedTreesDir(dataDir string) string {
	return filepath.Join(dataDir, "artifacts", "runtimes")
}

// runtimeTreeKey derives the content address for a prepared runtime tree.
//
// PackageSHA256 alone is not a sound key. It covers only the npm-packed
// artifact, while the runtime tree is that package plus whatever node_modules
// were carried in from the build. Two imports can share an artifact hash yet
// differ in RuntimeNodeModulesDir, and both --offline and --reinstall change
// what npm install produces. A key collision would silently serve one service
// another service's dependencies, so every input is folded in here.
func runtimeTreeKey(prepared preparedSource, opts Options) string {
	h := sha256.New()
	for _, part := range []string{
		"v1",
		prepared.PackageSHA256,
		strconv.FormatBool(opts.Offline),
		strconv.FormatBool(opts.Reinstall),
		nodeModulesFingerprint(prepared.RuntimeNodeModulesDir),
	} {
		io.WriteString(h, part)
		io.WriteString(h, "\x00")
	}
	return hex.EncodeToString(h.Sum(nil))
}

// nodeModulesFingerprint identifies a node_modules tree by the SHA-256 of its
// contents, over the sorted "relative path:size:content-hash" manifest.
//
// The hash must cover contents, not just the path and size. The runtime tree
// built from this directory is cached by key and never rebuilt while the key
// holds, so a fingerprint that misses a same-length content change would serve
// a stale dependency tree indefinitely, with no error and no rebuild. Measured
// at 51MB / 6k files this costs ~5s, against an import that this change took
// from 42s to 3s: worth paying for a sound key.
//
// It must not use mtimes. copyDir preserves only permission bits, so mtimes
// differ on every run; folding them in would change the key every time and the
// tree would never be reused.
func nodeModulesFingerprint(dir string) string {
	if dir == "" {
		return ""
	}
	var lines []string
	contents := sha256.New()
	_ = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return nil
		}
		contents.Reset()
		if !info.Mode().IsRegular() {
			// Symlinks and other non-regular entries are not copied by copyDir,
			// so they cannot affect the built tree. Record the name so the
			// manifest still reflects the layout, but no content.
			lines = append(lines, filepath.ToSlash(rel)+":"+strconv.FormatInt(info.Size(), 10)+":-")
			return nil
		}
		f, err := os.Open(path)
		if err != nil {
			return nil
		}
		_, copyErr := io.Copy(contents, f)
		closeErr := f.Close()
		if copyErr != nil || closeErr != nil {
			return nil
		}
		lines = append(lines, filepath.ToSlash(rel)+":"+strconv.FormatInt(info.Size(), 10)+":"+hex.EncodeToString(contents.Sum(nil)))
		return nil
	})
	sort.Strings(lines)
	h := sha256.New()
	for _, line := range lines {
		io.WriteString(h, line)
		io.WriteString(h, "\n")
	}
	return hex.EncodeToString(h.Sum(nil))
}

func packageName(packageDir string) (string, error) {
	b, err := os.ReadFile(filepath.Join(packageDir, "package.json"))
	if err != nil {
		return "", err
	}
	var pkg struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(b, &pkg); err != nil {
		return "", err
	}
	return pkg.Name, nil
}

// sharingEligible reports whether this runtime tree may be published to the
// content-addressed store.
//
// Three cases must keep the old per-service copy:
//
//   - --reinstall: prepareRuntime wipes node_modules. Sharing that tree would
//     destroy dependencies other services are running on, and publishing over
//     a tree that is already in use is not safe either.
//   - local example packages: replaceLocalExampleSDK copies the SDK out of the
//     live working tree, which is not part of the key. Reusing a stale tree
//     would serve whatever the checkout looked like during an earlier import.
//   - trees whose dependencies get installed during the import. When the source
//     carries no node_modules and the package declares runtime dependencies,
//     prepareRuntime runs npmInstall, and the result depends on state the key
//     cannot capture: the effective registry and its contents, and the npm
//     version. A range declared with no lockfile resolves differently against a
//     different registry, and a published tree is never rebuilt while its key
//     holds, so those services would keep running on the old resolution --
//     silently, with no error and no rebuild.
//
// The test mirrors prepareRuntime's own gate rather than calling it: the
// question is whether an install WOULD run, and prepareRuntime answers that by
// installing. A package with no runtime dependencies never reaches npmInstall,
// so its tree is a pure function of the package and stays shareable.
//
// All three are rare paths, so falling back to a full copy costs little.
func sharingEligible(prepared preparedSource, opts Options) bool {
	if opts.Reinstall {
		return false
	}
	if needsRuntimeInstall(prepared) {
		return false
	}
	name, err := packageName(prepared.PackageDir)
	if err != nil {
		return false
	}
	return !localExamplePackageNames[name]
}

// needsRuntimeInstall reports whether importing this package would run
// npmInstall, which is the condition under which the built tree stops being a
// pure function of the package.
//
// It asks the same question prepareRuntime asks -- are the declared
// dependencies already present in what will become the runtime tree -- rather
// than whether any install could conceivably run. A package that carries its
// dependencies, via bundledDependencies in the artifact or via
// RuntimeNodeModulesDir from the build, installs nothing and stays shareable;
// that is the common case for a packed service package.
func needsRuntimeInstall(prepared preparedSource) bool {
	deps, err := packageDependencies(prepared.PackageDir)
	if err != nil || len(deps) == 0 {
		// Nothing declared: an install would have nothing to resolve.
		return false
	}
	for name := range deps {
		rel := filepath.FromSlash(name)
		if _, err := os.Stat(filepath.Join(prepared.PackageDir, "node_modules", rel)); err == nil {
			continue
		}
		if prepared.RuntimeNodeModulesDir != "" {
			if _, err := os.Stat(filepath.Join(prepared.RuntimeNodeModulesDir, rel)); err == nil {
				continue
			}
		}
		// Declared but not carried: prepareRuntime resolves it against the
		// registry, so the result depends on state the key does not capture.
		return true
	}
	return false
}

// existingSharedTree reports whether a complete tree is already published
// under key, returning its path if so.
//
// A published tree is immutable, so its presence means the tree that would be
// built is byte-identical and the build can be skipped. Only a directory that
// actually contains the tree counts: publishSharedTree moves the finished tree
// into place with a single rename, so a directory under the store is either
// complete or absent, never partial.
func existingSharedTree(storeDir, key string) (string, bool) {
	target := filepath.Join(storeDir, key)
	info, err := os.Stat(target)
	if err != nil || !info.IsDir() {
		return "", false
	}
	return target, true
}

// publishSharedTree moves a freshly built tree into the content-addressed
// store, or reuses the existing one.
//
// Reuse is the common case on a re-import, and it is where the time is saved:
// callers check existingSharedTree first, so reaching the reuse branch here
// means another publish won the race.
func publishSharedTree(buildDir, storeDir, key string) (string, error) {
	target := filepath.Join(storeDir, key)
	if _, err := os.Stat(target); err == nil {
		// A concurrent import published this key first; its tree wins.
		return target, os.RemoveAll(buildDir)
	}
	if err := os.MkdirAll(storeDir, 0o755); err != nil {
		return "", err
	}
	if err := os.Rename(buildDir, target); err != nil {
		if _, statErr := os.Stat(target); statErr == nil {
			return target, os.RemoveAll(buildDir)
		}
		return "", err
	}
	return target, nil
}

// linkSharedTree points linkPath at target.
//
// The target is absolute. Absolute paths make the link independent of how deep
// the staging directory sits, which removes a whole class of off-by-one bugs:
// a relative link has to be written for the final location while the link
// itself is still created in staging. Nothing is lost, because the data dir is
// already unrelocatable -- PackageArtifactPath, DescriptorPath and
// ConfigSchemaPath are stored absolute in SQLite.
func linkSharedTree(linkPath, target string) error {
	return os.Symlink(target, linkPath)
}

// buildRuntimeTree materializes the runtime tree for one import run.
//
// The tree is always built in staging first. Publishing is a separate step so
// that the shared tree only ever appears fully formed, and therefore immutable
// for as long as services point at it.
//
// buildCount, when non-nil, is incremented for each build. Reuse is otherwise
// invisible from outside: a rebuild is followed by publishSharedTree discarding
// the result, leaving the same bytes on disk as skipping the build entirely.
// Tests set it to tell the two apart.
func buildRuntimeTree(ctx context.Context, prepared preparedSource, buildDir string, opts Options) error {
	if buildCount != nil {
		*buildCount++
	}
	if err := copyDir(prepared.PackageDir, buildDir); err != nil {
		return err
	}
	if prepared.RuntimeNodeModulesDir != "" {
		if err := copyDir(prepared.RuntimeNodeModulesDir, filepath.Join(buildDir, "node_modules")); err != nil {
			return err
		}
	}
	if err := replaceLocalExampleSDK(buildDir); err != nil {
		return err
	}
	if err := prepareRuntime(ctx, buildDir, opts.Offline, opts.Reinstall); err != nil {
		return err
	}
	return replaceLocalExampleSDK(buildDir)
}
