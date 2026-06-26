package packageimport

import (
	"archive/tar"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestParseGitSourceAcceptsSupportedForms(t *testing.T) {
	tests := []struct {
		name          string
		source        string
		remote        string
		subdir        string
		ref           string
		redacted      string
		user          string
		password      string
		credentialURL string
	}{
		{
			name:     "github root with git suffix",
			source:   "https://github.com/acme/services.git@v1.2.3",
			remote:   "https://github.com/acme/services.git",
			ref:      "v1.2.3",
			redacted: "https://github.com/acme/services.git@v1.2.3",
		},
		{
			name:     "github root without git suffix",
			source:   "https://github.com/acme/services@main",
			remote:   "https://github.com/acme/services",
			ref:      "main",
			redacted: "https://github.com/acme/services@main",
		},
		{
			name:     "github subdir",
			source:   "https://github.com/acme/services.git//calculator@v1.2.3",
			remote:   "https://github.com/acme/services.git",
			subdir:   "calculator",
			ref:      "v1.2.3",
			redacted: "https://github.com/acme/services.git//calculator@v1.2.3",
		},
		{
			name:     "gitlab nested group with subdir",
			source:   "https://gitlab.com/group/platform/services//packages/tools@release",
			remote:   "https://gitlab.com/group/platform/services",
			subdir:   "packages/tools",
			ref:      "release",
			redacted: "https://gitlab.com/group/platform/services//packages/tools@release",
		},
		{
			name:     "subdir with slash ref",
			source:   "https://github.com/acme/services.git//services/nested@feature/subdir",
			remote:   "https://github.com/acme/services.git",
			subdir:   "services/nested",
			ref:      "feature/subdir",
			redacted: "https://github.com/acme/services.git//services/nested@feature/subdir",
		},
		{
			name:     "omitted ref means latest",
			source:   "https://gitlab.com/group/platform-services",
			remote:   "https://gitlab.com/group/platform-services",
			ref:      "latest",
			redacted: "https://gitlab.com/group/platform-services",
		},
		{
			name:          "user password",
			source:        "https://user:password@host.example/repo.git",
			remote:        "https://host.example/repo.git",
			ref:           "latest",
			redacted:      "https://user:******@host.example/repo.git",
			user:          "user",
			password:      "password",
			credentialURL: "https://user:password@host.example/repo.git",
		},
		{
			name:          "token",
			source:        "https://token@host.example/repo.git",
			remote:        "https://host.example/repo.git",
			ref:           "latest",
			redacted:      "https://******@host.example/repo.git",
			user:          "token",
			credentialURL: "https://token@host.example/repo.git",
		},
		{
			name:          "percent encoded password",
			source:        "https://user:p%40ss@host.example/repo.git",
			remote:        "https://host.example/repo.git",
			ref:           "latest",
			redacted:      "https://user:******@host.example/repo.git",
			user:          "user",
			password:      "p@ss",
			credentialURL: "https://user:p%40ss@host.example/repo.git",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseGitSource(tc.source)
			if err != nil {
				t.Fatal(err)
			}
			if got.Remote != tc.remote || got.Subdir != tc.subdir || got.Ref != tc.ref || got.Redacted != tc.redacted || got.User != tc.user || got.Password != tc.password {
				t.Fatalf("parse mismatch:\ngot=%+v\nwant remote=%q subdir=%q ref=%q redacted=%q user=%q password=%q", got, tc.remote, tc.subdir, tc.ref, tc.redacted, tc.user, tc.password)
			}
			if tc.credentialURL != "" && got.CredentialURL != tc.credentialURL {
				t.Fatalf("credentialURL=%q want %q", got.CredentialURL, tc.credentialURL)
			}
		})
	}
}

func TestParseGitSourceRejectsInvalidForms(t *testing.T) {
	for _, source := range []string{
		"http://github.com/acme/repo.git",
		"ssh://github.com/acme/repo.git",
		"git+https://github.com/acme/repo.git",
		"https://%zz",
		"https:///acme/repo.git",
		"https://github.com/acme/repo.git?x=1",
		"https://github.com/acme/repo.git#main",
		"https://github.com/acme/repo.git//@v1.0.0",
		"https://github.com/acme/repo.git//bad%zz@v1.0.0",
		"https://github.com/acme/repo.git///abs@v1.0.0",
		"https://github.com/acme/repo.git//../svc@v1.0.0",
		"https://github.com/acme/repo.git//svc/../other@v1.0.0",
	} {
		t.Run(source, func(t *testing.T) {
			if _, err := parseGitSource(source); err == nil {
				t.Fatal("expected parse error")
			}
		})
	}
}

func TestRecursiveGitPackageSourceRedactsCredentials(t *testing.T) {
	raw := "https://user:p%40ss@host.example/repo.git//scan-root@v1.0.0"
	base := recursiveBasePackageSource(raw, raw)
	got := sourceWithServiceRootForPackage(base, "scan-root/vendor__alpha")
	want := "https://user:******@host.example/repo.git//scan-root/vendor__alpha@v1.0.0"
	if got != want {
		t.Fatalf("recursive git package source=%q want %q", got, want)
	}
	for _, leaked := range []string{"p%40ss", "p@ss"} {
		if strings.Contains(got, leaked) {
			t.Fatalf("recursive git package source leaked %q: %s", leaked, got)
		}
	}
}

func TestGitSourceAdditionalParsingBranches(t *testing.T) {
	if got := looksLikeGitScheme("file"); got {
		t.Fatal("file scheme should not look like a git scheme")
	}
	if got := looksLikeGitScheme("git+ssh://example.com/repo.git"); !got {
		t.Fatal("git+ssh should look like a git scheme")
	}
	if _, err := parseGitSource(""); err == nil || !strings.Contains(err.Error(), "required") {
		t.Fatalf("expected empty source error, got %v", err)
	}
	if _, err := parseGitSource("file:///tmp/repo"); err == nil || !strings.Contains(err.Error(), "not an HTTPS Git source") {
		t.Fatalf("expected non-git URL error, got %v", err)
	}
	src, err := parseGitSource("https://example.com/repo.git@")
	if err != nil {
		t.Fatal(err)
	}
	if src.Ref != "latest" || src.Remote != "https://example.com/repo.git@" {
		t.Fatalf("empty ref should stay in remote and default latest: %+v", src)
	}
	src, err = parseGitSource("https://example.com/repo.git@latest")
	if err != nil {
		t.Fatal(err)
	}
	if src.Redacted != "https://example.com/repo.git@latest" {
		t.Fatalf("explicit latest was not preserved: %s", src.Redacted)
	}
	if err := validateGitSubdir("svc/."); err != nil {
		t.Fatalf("clean subdir rejected: %v", err)
	}
	if err := validateGitSubdir("."); err == nil {
		t.Fatal("expected dot subdir error")
	}
	if ref, without := splitGitRef("package@v1.2.3"); ref != "v1.2.3" || without != "package" {
		t.Fatalf("split no-scheme ref=%q without=%q", ref, without)
	}
	if ref, without := splitGitRef("https://host.example"); ref != "" || without != "https://host.example" {
		t.Fatalf("split host-only ref=%q without=%q", ref, without)
	}
}

func TestLatestStableSemVerSelection(t *testing.T) {
	tags := []string{"v1.2.0", "v1.10.0", "v2.0.0", "v1.3.0-rc.1", "1.99.0", "v2.0.0-rc.1"}
	var versions []semverTag
	for _, tag := range tags {
		if v, ok := parseStableSemVerTag(tag); ok {
			versions = append(versions, v)
		}
	}
	if len(versions) != 3 {
		t.Fatalf("stable versions=%+v", versions)
	}
	for i := 1; i < len(versions); i++ {
		for j := i; j > 0 && versions[j].less(versions[j-1]); j-- {
			versions[j], versions[j-1] = versions[j-1], versions[j]
		}
	}
	if got := versions[len(versions)-1].tag; got != "v2.0.0" {
		t.Fatalf("highest stable tag=%q", got)
	}
	if !versions[0].less(semverTag{tag: "v1.2.1", major: 1, minor: 2, patch: 1}) {
		t.Fatal("patch version comparison did not order lower patch first")
	}
}

func TestGitCredentialScrubbing(t *testing.T) {
	src, err := parseGitSource("https://user:p%40ss@host.example/repo.git//svc@v1.0.0")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(src.Redacted, "p@ss") || strings.Contains(src.Redacted, "p%40ss") {
		t.Fatalf("redacted source leaks password: %s", src.Redacted)
	}
	scrubbed := scrubGitText(src, "failed for https://user:p%40ss@host.example/repo.git with user p@ss p%40ss")
	for _, raw := range []string{"p@ss", "p%40ss", "https://user:p%40ss@host.example/repo.git"} {
		if strings.Contains(scrubbed, raw) {
			t.Fatalf("scrubbed text leaks %q: %s", raw, scrubbed)
		}
	}
	if !strings.Contains(scrubbed, "******") {
		t.Fatalf("scrubbed text missing redaction marker: %s", scrubbed)
	}
	if got := scrubGitText(gitSource{ScrubValues: []string{"", "safe"}}, "safe unsafe"); got != "****** un******" {
		t.Fatalf("unexpected scrubbed text: %s", got)
	}
}

func TestGitRunnerAndArchiveHelpers(t *testing.T) {
	requireGit(t)
	src, err := parseGitSource("https://user:p%40ss@example.com/repo.git")
	if err != nil {
		t.Fatal(err)
	}
	runner, err := newGitRunner(src, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := runner.output(context.Background(), t.TempDir(), "definitely-not-a-git-command", "p@ss"); err == nil || strings.Contains(err.Error(), "p@ss") || strings.Contains(err.Error(), "p%40ss") {
		t.Fatalf("expected scrubbed git error, got %v", err)
	}
	if _, err := highestStableSemVerTag(context.Background(), runner, t.TempDir()); err == nil {
		t.Fatal("expected git tag listing error outside a repository")
	}
	if got := isFullCommitSHA(strings.Repeat("a", 40)); !got {
		t.Fatal("valid commit sha rejected")
	}
	for _, value := range []string{strings.Repeat("a", 39), strings.Repeat("g", 40)} {
		if isFullCommitSHA(value) {
			t.Fatalf("invalid commit sha accepted: %q", value)
		}
	}

	var in bytes.Buffer
	tw := tar.NewWriter(&in)
	if err := tw.WriteHeader(&tar.Header{Name: "svc/", Typeflag: tar.TypeDir, Mode: 0o755}); err != nil {
		t.Fatal(err)
	}
	if err := tw.WriteHeader(&tar.Header{Name: "svc/file.txt", Typeflag: tar.TypeReg, Mode: 0o644, Size: int64(len("body"))}); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write([]byte("body")); err != nil {
		t.Fatal(err)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	outTar := tar.NewWriter(&out)
	if err := rewriteGitArchive(&in, outTar, "svc"); err != nil {
		t.Fatal(err)
	}
	if err := outTar.Close(); err != nil {
		t.Fatal(err)
	}
	tr := tar.NewReader(&out)
	hdr, err := tr.Next()
	if err != nil {
		t.Fatal(err)
	}
	if hdr.Name != "file.txt" {
		t.Fatalf("rewritten header=%q", hdr.Name)
	}
	body, err := io.ReadAll(tr)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "body" {
		t.Fatalf("rewritten body=%q", body)
	}

	if err := rewriteGitArchive(strings.NewReader("not a tar stream"), tar.NewWriter(io.Discard), ""); err == nil {
		t.Fatal("expected invalid tar stream error")
	}
	var closedInput bytes.Buffer
	closedInputTar := tar.NewWriter(&closedInput)
	if err := closedInputTar.WriteHeader(&tar.Header{Name: "file.txt", Typeflag: tar.TypeReg, Mode: 0o644}); err != nil {
		t.Fatal(err)
	}
	if err := closedInputTar.Close(); err != nil {
		t.Fatal(err)
	}
	closedTar := tar.NewWriter(io.Discard)
	if err := closedTar.Close(); err != nil {
		t.Fatal(err)
	}
	if err := rewriteGitArchive(&closedInput, closedTar, ""); err == nil {
		t.Fatal("expected closed tar writer error")
	}
}

func TestGitAskpassWriteError(t *testing.T) {
	src, err := parseGitSource("https://user:p%40ss@host.example/repo.git")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := writeGitAskpass(filepath.Join(t.TempDir(), "missing"), src); err == nil {
		t.Fatal("expected askpass write error")
	}
}

func TestGitArchivePackageHelperBranches(t *testing.T) {
	requireGit(t)
	root := t.TempDir()
	work := filepath.Join(root, "work")
	gitInit(t, work)
	if err := os.MkdirAll(filepath.Join(work, "svc"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(work, "svc", "file.txt"), "body", 0o644)
	gitCommit(t, work, "initial")
	commit := gitRevParse(t, work, "HEAD")

	src, err := parseGitSource("https://host.example/repo.git")
	if err != nil {
		t.Fatal(err)
	}
	runner := &gitRunner{source: src, env: os.Environ()}
	artifact := filepath.Join(root, "svc.tgz")
	if err := gitArchivePackage(context.Background(), runner, work, commit, "svc", artifact); err != nil {
		t.Fatal(err)
	}
	extracted := filepath.Join(root, "extracted")
	if err := untarGz(artifact, extracted); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(extracted, "file.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "body" {
		t.Fatalf("archived subdir body=%q", got)
	}

	if err := gitArchivePackage(context.Background(), runner, work, commit, "svc", filepath.Join(root, "missing", "svc.tgz")); err == nil {
		t.Fatal("expected artifact create error")
	}
	if err := gitArchivePackage(context.Background(), runner, work, strings.Repeat("0", 40), "", filepath.Join(root, "bad.tgz")); err == nil {
		t.Fatal("expected git archive wait error")
	}
}

func TestGitAskpassArgvDoesNotContainPassword(t *testing.T) {
	src, err := parseGitSource("https://user:p%40ss@host.example/repo.git")
	if err != nil {
		t.Fatal(err)
	}
	runner, err := newGitRunner(src, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	args := []string{"fetch", "origin", src.Remote}
	if strings.Contains(strings.Join(args, " "), "p@ss") || strings.Contains(strings.Join(args, " "), "p%40ss") {
		t.Fatalf("git argv leaks password: %q", args)
	}
	found := false
	for _, env := range runner.env {
		if strings.HasPrefix(env, "GIT_ASKPASS=") {
			found = true
		}
	}
	if !found {
		t.Fatal("expected GIT_ASKPASS to be configured")
	}
}

func TestSourceDispatchClassifiesInputs(t *testing.T) {
	tests := map[string]sourceKind{
		"npm:@scope/pkg@1.0.0":                           sourceNPM,
		"https://example.com/r.git":                      sourceHTTPSGit,
		"https://example.com/package.zip?signature=test": sourceRemoteArchive,
		"http://example.com/package.tgz?signature=test":  sourceRemoteArchive,
		"./package.tgz":                                  sourceLocal,
		"http://example.com/r.git":                       sourceUnsupportedGit,
		"ssh://example.com/r.git":                        sourceUnsupportedGit,
		"git+https://example/r.git":                      sourceUnsupportedGit,
	}
	for source, want := range tests {
		if got := classifySource(source); got != want {
			t.Fatalf("classifySource(%q)=%v want %v", source, got, want)
		}
	}
}

func TestImporterImportsHTTPSGitRootSubdirCredentialsAndLatest(t *testing.T) {
	requireGit(t)
	t.Setenv("GIT_SSL_NO_VERIFY", "true")
	t.Setenv("NO_PROXY", "127.0.0.1,localhost")
	t.Setenv("no_proxy", "127.0.0.1,localhost")
	root := t.TempDir()
	work := filepath.Join(root, "work")
	gitInit(t, work)
	writeTestPackage(t, work, `{"schema":"chaitin.octobus.service.v1","name":"echo-v1","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	gitCommit(t, work, "v1")
	v100 := gitRevParse(t, work, "HEAD")
	gitTag(t, work, "v1.0.0")
	writeTestPackage(t, work, `{"schema":"chaitin.octobus.service.v1","name":"echo-v12","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	gitCommit(t, work, "v12")
	v120 := gitRevParse(t, work, "HEAD")
	gitTag(t, work, "v1.2.0")
	writeTestPackage(t, work, `{"schema":"chaitin.octobus.service.v1","name":"echo-rc","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	gitCommit(t, work, "rc")
	gitTag(t, work, "v1.3.0-rc.1")
	subpkg := filepath.Join(work, "services", "nested")
	writeTestPackage(t, subpkg, `{"schema":"chaitin.octobus.service.v1","name":"nested","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	writeTestFile(t, filepath.Join(work, "package.json"), `{"name":"echo-wrapper","version":"1.0.0","bin":{"echo-rc":"bin/echo.js","nested":"bin/echo.js"}}`, 0o644)
	gitAddCommit(t, work, "subdir")
	gitBranch(t, work, "feature/subdir")

	bare := filepath.Join(root, "repo.git")
	git(t, root, "clone", "--bare", work, bare)
	publicSrv := newGitHTTPServer(t, bare, "", "")
	defer publicSrv.Close()
	authSrv := newGitHTTPServer(t, bare, "user", "p@ss")
	defer authSrv.Close()

	dataDir, s := openTestStore(t)
	imp := &Importer{DataDir: dataDir, Store: s}
	sourceBase := publicSrv.URL + "/repo.git"

	rootRes, err := imp.Import(context.Background(), Options{ServiceID: "root", Source: sourceBase + "@v1.0.0", Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	if rootRes.Service.PackageVersion != v100 {
		t.Fatalf("root commit=%s want %s", rootRes.Service.PackageVersion, v100)
	}
	if rootRes.Service.PackageSHA256 == "" || rootRes.Service.DescriptorSHA256 == "" || len(rootRes.Service.Methods) == 0 {
		t.Fatalf("root import missing metadata: %+v", rootRes.Service)
	}

	credSource := strings.Replace(authSrv.URL+"/repo.git", "https://", "https://user:p%40ss@", 1) + "@latest"
	latestRes, err := imp.Import(context.Background(), Options{ServiceID: "latest", Source: credSource, Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	if latestRes.Service.PackageVersion != v120 {
		t.Fatalf("latest commit=%s want %s", latestRes.Service.PackageVersion, v120)
	}
	if strings.Contains(latestRes.Service.PackageSource, "p@ss") || strings.Contains(latestRes.Service.PackageSource, "p%40ss") || !strings.Contains(latestRes.Service.PackageSource, "******") {
		t.Fatalf("credentialed source not redacted: %s", latestRes.Service.PackageSource)
	}

	subdirRes, err := imp.Import(context.Background(), Options{ServiceID: "subdir", Source: sourceBase + "//services/nested@feature/subdir", Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	if subdirRes.Service.Name != "nested" {
		t.Fatalf("subdir service was not imported: %+v", subdirRes.Service)
	}
	if subdirRes.Service.ServiceRoot != "services/nested" || subdirRes.Service.PackageSource != sourceBase+"//services/nested@feature/subdir" {
		t.Fatalf("subdir metadata mismatch: %+v", subdirRes.Service)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "artifacts/services/subdir/runtime/service.json")); err != nil {
		t.Fatalf("root service.json missing from full runtime root: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "artifacts/services/subdir/runtime/services/nested/service.json")); err != nil {
		t.Fatalf("subdir service.json missing under runtime service root: %v", err)
	}
}

func TestImporterLatestFallsBackToDefaultBranchHead(t *testing.T) {
	requireGit(t)
	t.Setenv("GIT_SSL_NO_VERIFY", "true")
	t.Setenv("NO_PROXY", "127.0.0.1,localhost")
	t.Setenv("no_proxy", "127.0.0.1,localhost")
	root := t.TempDir()
	work := filepath.Join(root, "work")
	gitInit(t, work)
	writeTestPackage(t, work, `{"schema":"chaitin.octobus.service.v1","name":"echo","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	gitCommit(t, work, "initial")
	head := gitRevParse(t, work, "HEAD")
	gitTag(t, work, "v9.0.0-rc.1")
	bare := filepath.Join(root, "repo.git")
	git(t, root, "clone", "--bare", work, bare)
	srv := newGitHTTPServer(t, bare, "", "")
	defer srv.Close()

	dataDir, s := openTestStore(t)
	res, err := (&Importer{DataDir: dataDir, Store: s}).Import(context.Background(), Options{ServiceID: "echo", Source: srv.URL + "/repo.git@latest", Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	if res.Service.PackageVersion != head {
		t.Fatalf("fallback commit=%s want %s", res.Service.PackageVersion, head)
	}
}

func TestImporterBadGitCredentialsDoNotLeakOrPersist(t *testing.T) {
	requireGit(t)
	t.Setenv("GIT_SSL_NO_VERIFY", "true")
	t.Setenv("NO_PROXY", "127.0.0.1,localhost")
	t.Setenv("no_proxy", "127.0.0.1,localhost")
	root := t.TempDir()
	work := filepath.Join(root, "work")
	gitInit(t, work)
	writeTestPackage(t, work, `{"schema":"chaitin.octobus.service.v1","name":"echo","proto":{"roots":["proto"],"files":["proto/echo.proto"]}}`)
	gitCommit(t, work, "initial")
	bare := filepath.Join(root, "repo.git")
	git(t, root, "clone", "--bare", work, bare)
	srv := newGitHTTPServer(t, bare, "user", "good")
	defer srv.Close()

	dataDir, s := openTestStore(t)
	badSource := strings.Replace(srv.URL, "https://", "https://user:badsecret@", 1) + "/repo.git@v1.0.0"
	_, err := (&Importer{DataDir: dataDir, Store: s}).Import(context.Background(), Options{ServiceID: "echo", Source: badSource, Offline: true})
	if err == nil {
		t.Fatal("expected bad credentials error")
	}
	if strings.Contains(err.Error(), "badsecret") {
		t.Fatalf("error leaked password: %v", err)
	}
	if _, getErr := s.GetService(context.Background(), "echo"); getErr == nil {
		t.Fatal("failed import persisted service")
	}
}

func requireGit(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
}

func gitInit(t *testing.T, dir string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	git(t, dir, "init", "-b", "main")
	git(t, dir, "config", "user.email", "test@example.com")
	git(t, dir, "config", "user.name", "Test User")
}

func gitCommit(t *testing.T, dir, msg string) {
	t.Helper()
	gitAddCommit(t, dir, msg)
}

func gitAddCommit(t *testing.T, dir, msg string) {
	t.Helper()
	git(t, dir, "add", ".")
	git(t, dir, "commit", "-m", msg)
}

func gitTag(t *testing.T, dir, tag string) {
	t.Helper()
	git(t, dir, "tag", tag)
}

func gitBranch(t *testing.T, dir, branch string) {
	t.Helper()
	git(t, dir, "branch", branch)
}

func gitRevParse(t *testing.T, dir, rev string) string {
	t.Helper()
	out := git(t, dir, "rev-parse", rev)
	return strings.TrimSpace(out)
}

func git(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return string(out)
}

func newGitHTTPServer(t *testing.T, bareRepo, username, password string) *httptest.Server {
	t.Helper()
	projectRoot := filepath.Dir(bareRepo)
	repoName := filepath.Base(bareRepo)
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if username != "" || password != "" {
			gotUser, gotPassword, ok := r.BasicAuth()
			if !ok || gotUser != username || gotPassword != password {
				w.Header().Set("WWW-Authenticate", `Basic realm="octobus"`)
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
		}
		if !strings.HasPrefix(r.URL.Path, "/"+repoName) {
			http.NotFound(w, r)
			return
		}
		cmd := exec.Command("git", "http-backend")
		cmd.Env = append(os.Environ(),
			"GIT_PROJECT_ROOT="+projectRoot,
			"GIT_HTTP_EXPORT_ALL=1",
			"REQUEST_METHOD="+r.Method,
			"PATH_INFO="+r.URL.Path,
			"QUERY_STRING="+r.URL.RawQuery,
			"CONTENT_TYPE="+r.Header.Get("Content-Type"),
			"REMOTE_USER="+username,
		)
		cmd.Stdin = r.Body
		out, err := cmd.Output()
		if err != nil {
			var exitErr *exec.ExitError
			if errors.As(err, &exitErr) {
				t.Logf("git http-backend stderr: %s", exitErr.Stderr)
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeCGIResponse(t, w, out)
	}))
	srv.EnableHTTP2 = false
	srv.StartTLS()
	return srv
}

func writeCGIResponse(t *testing.T, w http.ResponseWriter, raw []byte) {
	t.Helper()
	headerEnd := strings.Index(string(raw), "\r\n\r\n")
	sepLen := 4
	if headerEnd < 0 {
		headerEnd = strings.Index(string(raw), "\n\n")
		sepLen = 2
	}
	if headerEnd < 0 {
		t.Fatalf("invalid CGI response: %q", raw)
	}
	headers := string(raw[:headerEnd])
	status := http.StatusOK
	for _, line := range strings.Split(strings.ReplaceAll(headers, "\r\n", "\n"), "\n") {
		if line == "" {
			continue
		}
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		value = strings.TrimSpace(value)
		if strings.EqualFold(key, "Status") {
			fmt.Sscanf(value, "%d", &status)
			continue
		}
		w.Header().Add(key, value)
	}
	w.WriteHeader(status)
	_, _ = w.Write(raw[headerEnd+sepLen:])
}

var commitRE = regexp.MustCompile(`^[0-9a-f]{40}$`)

func assertCommitSHA(t *testing.T, value string) {
	t.Helper()
	if !commitRE.MatchString(value) {
		t.Fatalf("not a commit SHA: %q", value)
	}
}
