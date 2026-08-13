package packageimport

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"octobus/internal/domain"
)

type sourceKind int

const (
	sourceLocal sourceKind = iota
	sourceNPM
	sourceRemoteArchive
	sourceHTTPSGit
	sourceUnsupportedGit
)

type gitSource struct {
	Original      string
	Remote        string
	Redacted      string
	Subdir        string
	Ref           string
	User          string
	Password      string
	CredentialURL string
	ScrubValues   []string
}

func classifySource(source string) sourceKind {
	if strings.HasPrefix(source, "npm:") {
		return sourceNPM
	}
	if isRemoteArchiveSource(source) {
		return sourceRemoteArchive
	}
	if strings.HasPrefix(source, "https://") {
		return sourceHTTPSGit
	}
	if strings.Contains(source, "://") && looksLikeGitScheme(source) {
		return sourceUnsupportedGit
	}
	return sourceLocal
}

func isRemoteArchiveSource(source string) bool {
	u, err := url.Parse(source)
	if err != nil {
		return false
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}
	path := strings.ToLower(u.Path)
	return strings.HasSuffix(path, ".tgz") || strings.HasSuffix(path, ".tar.gz") || strings.HasSuffix(path, ".zip")
}

func looksLikeGitScheme(source string) bool {
	scheme := source
	if idx := strings.Index(source, "://"); idx >= 0 {
		scheme = source[:idx]
	}
	return scheme == "http" || scheme == "ssh" || scheme == "git" || strings.Contains(scheme, "git")
}

func parseGitSource(raw string) (gitSource, error) {
	if raw == "" {
		return gitSource{}, errors.New("Git source is required")
	}
	if !strings.HasPrefix(raw, "https://") {
		if strings.Contains(raw, "://") && looksLikeGitScheme(raw) {
			return gitSource{}, fmt.Errorf("unsupported Git source %q: only https:// Git remotes are supported", raw)
		}
		return gitSource{}, fmt.Errorf("not an HTTPS Git source: %q", raw)
	}
	u, err := url.Parse(raw)
	if err != nil {
		return gitSource{}, fmt.Errorf("invalid Git source %q: %w", raw, err)
	}
	if u.Scheme != "https" {
		return gitSource{}, fmt.Errorf("unsupported Git source %q: only https:// Git remotes are supported", raw)
	}
	if u.Host == "" {
		return gitSource{}, fmt.Errorf("invalid Git source %q: missing host", raw)
	}
	if u.RawQuery != "" {
		return gitSource{}, errors.New("invalid Git source: query strings are not supported")
	}
	if u.Fragment != "" {
		return gitSource{}, errors.New("invalid Git source: fragments are not supported")
	}
	ref, sourceWithoutRef := splitGitRef(raw)
	if ref == "" {
		ref = "latest"
	}
	u, err = url.Parse(sourceWithoutRef)
	if err != nil {
		return gitSource{}, fmt.Errorf("invalid Git source %q: %w", raw, err)
	}
	repoPath, subdir, hasSubdir := strings.Cut(u.EscapedPath(), "//")
	if hasSubdir {
		if subdir == "" {
			return gitSource{}, errors.New("invalid Git source: subdir after // must not be empty")
		}
		decodedSubdir, err := url.PathUnescape(subdir)
		if err != nil {
			return gitSource{}, fmt.Errorf("invalid Git source subdir: %w", err)
		}
		if err := validateGitSubdir(decodedSubdir); err != nil {
			return gitSource{}, err
		}
		subdir, err = cleanServiceRoot(decodedSubdir)
		if err != nil {
			return gitSource{}, err
		}
	}
	u.Path = repoPath
	u.RawPath = repoPath
	user, password := "", ""
	if u.User != nil {
		user = u.User.Username()
		password, _ = u.User.Password()
	}
	remote := *u
	remote.User = nil
	credentialURL := remote.String()
	redactedURL := remote.String()
	if u.User != nil {
		credentialURL = u.String()
		redactedURL = redactedGitRemote(u)
	}
	redacted := redactedURL
	if hasSubdir {
		redacted += "//" + subdir
	}
	if ref != "" && ref != "latest" {
		redacted += "@" + ref
	} else if strings.HasSuffix(raw, "@latest") {
		redacted += "@latest"
	}
	scrubValues := []string{raw, credentialURL}
	if user != "" {
		scrubValues = append(scrubValues, user)
	}
	if password != "" {
		scrubValues = append(scrubValues, password, url.PathEscape(password), url.QueryEscape(password))
	}
	return gitSource{
		Original:      raw,
		Remote:        remote.String(),
		Redacted:      redacted,
		Subdir:        subdir,
		Ref:           ref,
		User:          user,
		Password:      password,
		CredentialURL: credentialURL,
		ScrubValues:   scrubValues,
	}, nil
}

func splitGitRef(raw string) (string, string) {
	pathStart := strings.Index(raw, "://")
	if pathStart >= 0 {
		pathStart += len("://")
		if slash := strings.Index(raw[pathStart:], "/"); slash >= 0 {
			pathStart += slash
		} else {
			pathStart = len(raw)
		}
	} else {
		pathStart = 0
	}
	refAt := -1
	for i := len(raw) - 1; i >= pathStart; i-- {
		if raw[i] == '@' {
			refAt = i
			break
		}
	}
	if refAt < 0 {
		return "", raw
	}
	ref := raw[refAt+1:]
	if ref == "" {
		return "", raw
	}
	return ref, raw[:refAt]
}

func redactedGitRemote(u *url.URL) string {
	user := u.User.Username()
	auth := "******"
	if _, ok := u.User.Password(); ok {
		auth = user + ":******"
	}
	return u.Scheme + "://" + auth + "@" + u.Host + u.EscapedPath()
}

func validateGitSubdir(subdir string) error {
	return domain.ValidatePackageRelativePath("Git source subdir", subdir)
}

func (i *Importer) prepareGitSource(ctx context.Context, rawSource, staging string) (preparedSource, error) {
	src, err := parseGitSource(rawSource)
	if err != nil {
		return preparedSource{}, err
	}
	runner, err := newGitRunner(src, staging)
	if err != nil {
		return preparedSource{}, err
	}
	repoDir := filepath.Join(staging, "git")
	if err := os.MkdirAll(repoDir, 0o755); err != nil {
		return preparedSource{}, err
	}
	if err := runner.run(ctx, repoDir, "init", "--bare", "."); err != nil {
		return preparedSource{}, err
	}
	if err := runner.run(ctx, repoDir, "remote", "add", "origin", src.Remote); err != nil {
		return preparedSource{}, err
	}
	if err := runner.run(ctx, repoDir, "fetch", "--tags", "--force", "origin", "+refs/heads/*:refs/remotes/origin/*", "HEAD:refs/remotes/origin/HEAD"); err != nil {
		return preparedSource{}, err
	}
	commit, err := resolveGitCommit(ctx, runner, repoDir, src.Ref)
	if err != nil {
		return preparedSource{}, err
	}
	artifactPath := filepath.Join(staging, "package.tgz")
	if err := gitArchivePackage(ctx, runner, repoDir, commit, "", artifactPath); err != nil {
		return preparedSource{}, err
	}
	packageDir := filepath.Join(staging, "package")
	if err := untarGz(artifactPath, packageDir); err != nil {
		return preparedSource{}, err
	}
	b, err := os.ReadFile(artifactPath)
	if err != nil {
		return preparedSource{}, err
	}
	return preparedSource{
		ArtifactPath:   artifactPath,
		PackageDir:     packageDir,
		PackageSHA256:  domain.HashBytes(b),
		PackageSource:  src.Redacted,
		PackageVersion: commit,
		ServiceRoot:    serviceRootOrDefault(src.Subdir),
		BuildAllowed:   true,
	}, nil
}

func serviceRootOrDefault(serviceRoot string) string {
	if serviceRoot == "" {
		return "."
	}
	return serviceRoot
}

type gitRunner struct {
	source gitSource
	env    []string
}

func newGitRunner(src gitSource, staging string) (*gitRunner, error) {
	if _, err := exec.LookPath("git"); err != nil {
		return nil, errors.New("git is required to import HTTPS Git sources; install git and ensure it is on PATH")
	}
	env := os.Environ()
	if src.User != "" || src.Password != "" {
		askpass, err := writeGitAskpass(staging, src)
		if err != nil {
			return nil, err
		}
		env = append(env,
			"GIT_ASKPASS="+askpass,
			"GIT_TERMINAL_PROMPT=0",
			"OCTOBUS_GIT_USERNAME="+src.User,
			"OCTOBUS_GIT_PASSWORD="+src.Password,
		)
	} else {
		env = append(env, "GIT_TERMINAL_PROMPT=0")
	}
	return &gitRunner{source: src, env: env}, nil
}

func writeGitAskpass(staging string, src gitSource) (string, error) {
	path := filepath.Join(staging, "git-askpass.sh")
	body := `#!/bin/sh
case "$1" in
*Username*) printf '%s\n' "$OCTOBUS_GIT_USERNAME" ;;
*Password*) printf '%s\n' "$OCTOBUS_GIT_PASSWORD" ;;
*) printf '\n' ;;
esac
`
	if err := os.WriteFile(path, []byte(body), 0o700); err != nil {
		return "", err
	}
	return path, nil
}

func (r *gitRunner) run(ctx context.Context, dir string, args ...string) error {
	_, err := r.output(ctx, dir, args...)
	return err
}

func (r *gitRunner) output(ctx context.Context, dir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Env = r.env
	var out strings.Builder
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git %s: %w: %s", scrubGitText(r.source, strings.Join(args, " ")), err, scrubGitText(r.source, strings.TrimSpace(out.String())))
	}
	return out.String(), nil
}

func resolveGitCommit(ctx context.Context, runner *gitRunner, repoDir, ref string) (string, error) {
	if ref == "" || ref == "latest" {
		tag, err := highestStableSemVerTag(ctx, runner, repoDir)
		if err != nil {
			return "", err
		}
		if tag != "" {
			return revParseCommit(ctx, runner, repoDir, "refs/tags/"+tag+"^{}")
		}
		return revParseCommit(ctx, runner, repoDir, "refs/remotes/origin/HEAD")
	}
	candidates := []string{
		ref + "^{commit}",
		"refs/tags/" + ref + "^{commit}",
		"refs/remotes/origin/" + ref + "^{commit}",
	}
	var lastErr error
	for _, candidate := range candidates {
		commit, err := revParseCommit(ctx, runner, repoDir, candidate)
		if err == nil {
			return commit, nil
		}
		lastErr = err
	}
	return "", fmt.Errorf("resolve Git ref %q: %w", scrubGitText(runner.source, ref), lastErr)
}

func revParseCommit(ctx context.Context, runner *gitRunner, repoDir, rev string) (string, error) {
	out, err := runner.output(ctx, repoDir, "rev-parse", "--verify", rev)
	if err != nil {
		return "", err
	}
	commit := strings.TrimSpace(out)
	if !isFullCommitSHA(commit) {
		return "", fmt.Errorf("Git revision %q resolved to invalid commit %q", rev, commit)
	}
	return commit, nil
}

func highestStableSemVerTag(ctx context.Context, runner *gitRunner, repoDir string) (string, error) {
	out, err := runner.output(ctx, repoDir, "for-each-ref", "--format=%(refname:strip=2)", "refs/tags")
	if err != nil {
		return "", err
	}
	var versions []semverTag
	for _, line := range strings.Split(out, "\n") {
		tag := strings.TrimSpace(line)
		if tag == "" {
			continue
		}
		v, ok := parseStableSemVerTag(tag)
		if ok {
			versions = append(versions, v)
		}
	}
	sort.Slice(versions, func(i, j int) bool {
		return versions[i].less(versions[j])
	})
	if len(versions) == 0 {
		return "", nil
	}
	return versions[len(versions)-1].tag, nil
}

var semverTagPattern = regexp.MustCompile(`^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$`)

type semverTag struct {
	tag                 string
	major, minor, patch int
}

func parseStableSemVerTag(tag string) (semverTag, bool) {
	m := semverTagPattern.FindStringSubmatch(tag)
	if m == nil {
		return semverTag{}, false
	}
	major, _ := strconv.Atoi(m[1])
	minor, _ := strconv.Atoi(m[2])
	patch, _ := strconv.Atoi(m[3])
	return semverTag{tag: tag, major: major, minor: minor, patch: patch}, true
}

func (v semverTag) less(other semverTag) bool {
	if v.major != other.major {
		return v.major < other.major
	}
	if v.minor != other.minor {
		return v.minor < other.minor
	}
	return v.patch < other.patch
}

func gitArchivePackage(ctx context.Context, runner *gitRunner, repoDir, commit, subdir, artifactPath string) error {
	prefix := subdir
	if prefix != "" {
		prefix = strings.Trim(prefix, "/") + "/"
	} else {
		prefix = "."
	}
	cmd := exec.CommandContext(ctx, "git", "archive", "--format=tar", commit, "--", prefix)
	cmd.Dir = repoDir
	cmd.Env = runner.env
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return err
	}
	outFile, err := os.Create(artifactPath)
	if err != nil {
		_ = cmd.Wait()
		return err
	}
	gz := gzip.NewWriter(outFile)
	tw := tar.NewWriter(gz)
	copyErr := rewriteGitArchive(stdout, tw, subdir)
	closeTar := tw.Close()
	closeGz := gz.Close()
	closeFile := outFile.Close()
	waitErr := cmd.Wait()
	if copyErr != nil {
		return copyErr
	}
	if closeTar != nil {
		return closeTar
	}
	if closeGz != nil {
		return closeGz
	}
	if closeFile != nil {
		return closeFile
	}
	if waitErr != nil {
		return fmt.Errorf("git archive: %w: %s", waitErr, scrubGitText(runner.source, strings.TrimSpace(stderr.String())))
	}
	return nil
}

func rewriteGitArchive(in io.Reader, out *tar.Writer, subdir string) error {
	tr := tar.NewReader(in)
	trim := ""
	if subdir != "" {
		trim = strings.Trim(filepath.ToSlash(subdir), "/") + "/"
	}
	for {
		hdr, err := tr.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		name := filepath.ToSlash(hdr.Name)
		if trim != "" {
			name = strings.TrimPrefix(name, trim)
		}
		name = strings.TrimPrefix(name, "/")
		if name == "" {
			continue
		}
		hdr.Name = name
		if err := out.WriteHeader(hdr); err != nil {
			return err
		}
		if hdr.Typeflag == tar.TypeReg || hdr.Typeflag == tar.TypeRegA {
			if _, err := io.Copy(out, tr); err != nil {
				return err
			}
		}
	}
}

func scrubGitText(src gitSource, text string) string {
	out := text
	replacements := map[string]string{}
	for _, value := range src.ScrubValues {
		if value == "" {
			continue
		}
		replacements[value] = "******"
		if decoded, err := url.QueryUnescape(value); err == nil && decoded != value {
			replacements[decoded] = "******"
		}
	}
	for raw, redacted := range replacements {
		out = strings.ReplaceAll(out, raw, redacted)
	}
	return out
}

func isFullCommitSHA(s string) bool {
	if len(s) != 40 {
		return false
	}
	for _, r := range s {
		if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') {
			continue
		}
		return false
	}
	return true
}
