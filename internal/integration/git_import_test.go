package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"octobus/internal/admin"
	"octobus/internal/packageimport"
	"octobus/internal/store"
	"octobus/internal/supervisor"
)

var integrationCommitRE = regexp.MustCompile(`^[0-9a-f]{40}$`)

func TestHTTPSGitAdminImportIntegrationRedactsCredentials(t *testing.T) {
	requireIntegrationGit(t)
	t.Setenv("GIT_SSL_NO_VERIFY", "true")
	t.Setenv("NO_PROXY", "127.0.0.1,localhost")
	t.Setenv("no_proxy", "127.0.0.1,localhost")

	ctx := context.Background()
	root := t.TempDir()
	gitRepo := createIntegrationGitRepo(t, root, "user", "p@ss")
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := &admin.Server{Store: st, Importer: &packageimport.Importer{DataDir: dataDir, Store: st}, Supervisor: supervisor.New(dataDir, st)}
	source := strings.Replace(gitRepo.URL, "https://", "https://user:p%40ss@", 1) + "//svc@v1.0.0"

	body := postIntegrationAdmin(t, srv, map[string]any{"service_id": "echo", "source": source, "offline": true}, http.StatusOK)
	for _, leaked := range []string{"p@ss", "p%40ss"} {
		if bytes.Contains(body, []byte(leaked)) {
			t.Fatalf("admin response leaked credential %q: %s", leaked, body)
		}
	}
	if !bytes.Contains(body, []byte("******")) {
		t.Fatalf("admin response did not contain redacted source: %s", body)
	}

	var res struct {
		Service struct {
			PackageSource       string `json:"PackageSource"`
			PackageVersion      string `json:"PackageVersion"`
			PackageArtifactPath string `json:"PackageArtifactPath"`
			PackageSHA256       string `json:"PackageSHA256"`
			DescriptorPath      string `json:"DescriptorPath"`
			DescriptorSHA256    string `json:"DescriptorSHA256"`
			Methods             []any  `json:"Methods"`
		} `json:"service"`
	}
	if err := json.Unmarshal(body, &res); err != nil {
		t.Fatal(err)
	}
	if res.Service.PackageVersion != gitRepo.Tags["v1.0.0"] || !integrationCommitRE.MatchString(res.Service.PackageVersion) {
		t.Fatalf("response package version=%q want %q", res.Service.PackageVersion, gitRepo.Tags["v1.0.0"])
	}
	if res.Service.PackageArtifactPath == "" || res.Service.PackageSHA256 == "" || res.Service.DescriptorPath == "" || res.Service.DescriptorSHA256 == "" || len(res.Service.Methods) == 0 {
		t.Fatalf("response missing imported service metadata: %+v", res.Service)
	}
	for _, path := range []string{res.Service.PackageArtifactPath, res.Service.DescriptorPath, filepath.Join(dataDir, "artifacts/services/echo/runtime/svc/service.json")} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("expected imported artifact %s: %v", path, err)
		}
	}

	stored, err := st.GetService(ctx, "echo")
	if err != nil {
		t.Fatal(err)
	}
	if stored.PackageVersion != gitRepo.Tags["v1.0.0"] || !integrationCommitRE.MatchString(stored.PackageVersion) {
		t.Fatalf("stored package version=%q want %q", stored.PackageVersion, gitRepo.Tags["v1.0.0"])
	}
	if strings.Contains(stored.PackageSource, "p@ss") || strings.Contains(stored.PackageSource, "p%40ss") || !strings.Contains(stored.PackageSource, "******") {
		t.Fatalf("stored source not redacted: %s", stored.PackageSource)
	}
}

func TestHTTPSGitAdminImportIntegrationDryRunPreviewsWithoutCommit(t *testing.T) {
	requireIntegrationGit(t)
	t.Setenv("GIT_SSL_NO_VERIFY", "true")
	t.Setenv("NO_PROXY", "127.0.0.1,localhost")
	t.Setenv("no_proxy", "127.0.0.1,localhost")

	ctx := context.Background()
	root := t.TempDir()
	gitRepo := createIntegrationGitRepo(t, root, "user", "p@ss")
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := &admin.Server{Store: st, Importer: &packageimport.Importer{DataDir: dataDir, Store: st}, Supervisor: supervisor.New(dataDir, st)}
	source := strings.Replace(gitRepo.URL, "https://", "https://user:p%40ss@", 1) + "//svc@v1.0.0"

	body := postIntegrationAdmin(t, srv, map[string]any{"service_id": "echo", "source": source, "offline": true, "dry_run": true}, http.StatusOK)
	for _, leaked := range []string{"p@ss", "p%40ss"} {
		if bytes.Contains(body, []byte(leaked)) {
			t.Fatalf("dry run response leaked credential %q: %s", leaked, body)
		}
	}
	var res struct {
		DryRun  bool `json:"dry_run"`
		Update  bool `json:"update"`
		Service struct {
			PackageVersion    string `json:"PackageVersion"`
			DescriptorVersion string `json:"DescriptorVersion"`
			DescriptorSHA256  string `json:"DescriptorSHA256"`
			NodeEntry         string `json:"NodeEntry"`
			RuntimeMode       string `json:"RuntimeMode"`
			Methods           []any  `json:"Methods"`
		} `json:"service"`
	}
	if err := json.Unmarshal(body, &res); err != nil {
		t.Fatal(err)
	}
	if !res.DryRun || res.Update {
		t.Fatalf("dry run flags regressed: dry_run=%v update=%v body=%s", res.DryRun, res.Update, body)
	}
	if len(res.Service.Methods) == 0 || res.Service.DescriptorVersion == "" || res.Service.NodeEntry == "" || res.Service.RuntimeMode == "" {
		t.Fatalf("dry run preview missing metadata: %s", body)
	}
	if res.Service.PackageVersion != gitRepo.Tags["v1.0.0"] {
		t.Fatalf("dry run package version=%q want %q", res.Service.PackageVersion, gitRepo.Tags["v1.0.0"])
	}
	if _, err := st.GetService(ctx, "echo"); err == nil {
		t.Fatal("dry run persisted the service")
	}
	if _, err := os.Stat(filepath.Join(dataDir, "artifacts", "services", "echo")); !os.IsNotExist(err) {
		t.Fatalf("dry run created the service dir: %v", err)
	}

	postIntegrationAdmin(t, srv, map[string]any{"service_id": "echo", "source": source, "offline": true}, http.StatusOK)
	stored, err := st.GetService(ctx, "echo")
	if err != nil {
		t.Fatal(err)
	}
	if stored.DescriptorSHA256 != res.Service.DescriptorSHA256 || len(stored.Methods) != len(res.Service.Methods) {
		t.Fatalf("real import diverged from dry run preview: stored=%+v preview=%+v", stored, res.Service)
	}
}

func TestHTTPSGitAdminImportIntegrationBadCredentialsDoNotPersist(t *testing.T) {
	requireIntegrationGit(t)
	t.Setenv("GIT_SSL_NO_VERIFY", "true")
	t.Setenv("NO_PROXY", "127.0.0.1,localhost")
	t.Setenv("no_proxy", "127.0.0.1,localhost")

	ctx := context.Background()
	root := t.TempDir()
	gitRepo := createIntegrationGitRepo(t, root, "user", "good")
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := &admin.Server{Store: st, Importer: &packageimport.Importer{DataDir: dataDir, Store: st}, Supervisor: supervisor.New(dataDir, st)}
	source := strings.Replace(gitRepo.URL, "https://", "https://user:badsecret@", 1) + "//svc@v1.0.0"

	body := postIntegrationAdmin(t, srv, map[string]any{"service_id": "echo", "source": source, "offline": true}, http.StatusBadRequest)
	if bytes.Contains(body, []byte("badsecret")) {
		t.Fatalf("admin error leaked credential: %s", body)
	}
	if _, err := st.GetService(ctx, "echo"); err == nil {
		t.Fatal("bad credentials persisted service row")
	}
}

type integrationGitRepo struct {
	URL  string
	Tags map[string]string
}

func createIntegrationGitRepo(t *testing.T, root, username, password string) integrationGitRepo {
	t.Helper()
	work := filepath.Join(root, "git-work")
	integrationGitInit(t, work)
	pkg := createFixturePackageWithProto(t, filepath.Join(root, "fixtures"), "svc", `syntax = "proto3";
package echo.v1;
service EchoService { rpc Echo(EchoMessage) returns (EchoMessage); }
message EchoMessage { string text = 1; }
	`)
	copyDirForIntegrationGit(t, pkg, filepath.Join(work, "svc"))
	copyDirForIntegrationGit(t, filepath.Join(pkg, "bin"), filepath.Join(work, "bin"))
	copyDirForIntegrationGit(t, filepath.Join(pkg, "node_modules"), filepath.Join(work, "node_modules"))
	copyFileForIntegrationGit(t, filepath.Join(pkg, "package.json"), filepath.Join(work, "package.json"))
	integrationGit(t, work, "add", ".")
	integrationGit(t, work, "commit", "-m", "v1")
	v100 := strings.TrimSpace(integrationGit(t, work, "rev-parse", "HEAD"))
	integrationGit(t, work, "tag", "v1.0.0")
	bare := filepath.Join(root, "repo.git")
	integrationGit(t, root, "clone", "--bare", work, bare)
	server := newIntegrationGitHTTPServer(t, bare, username, password)
	t.Cleanup(server.Close)
	return integrationGitRepo{URL: server.URL + "/repo.git", Tags: map[string]string{"v1.0.0": v100}}
}

func requireIntegrationGit(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
}

func integrationGitInit(t *testing.T, dir string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	integrationGit(t, dir, "init", "-b", "main")
	integrationGit(t, dir, "config", "user.email", "test@example.com")
	integrationGit(t, dir, "config", "user.name", "Test User")
}

func integrationGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return string(out)
}

func newIntegrationGitHTTPServer(t *testing.T, bareRepo, username, password string) *httptest.Server {
	t.Helper()
	projectRoot := filepath.Dir(bareRepo)
	repoName := filepath.Base(bareRepo)
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
		writeIntegrationCGIResponse(t, w, out)
	}))
	server.EnableHTTP2 = false
	server.StartTLS()
	return server
}

func writeIntegrationCGIResponse(t *testing.T, w http.ResponseWriter, raw []byte) {
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

func postIntegrationAdmin(t *testing.T, srv *admin.Server, body any, want int) []byte {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	srv.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/admin/v1/services/import", bytes.NewReader(raw)))
	if w.Code != want {
		t.Fatalf("POST /admin/v1/services/import status=%d want=%d body=%s", w.Code, want, w.Body.String())
	}
	return w.Body.Bytes()
}

func copyDirForIntegrationGit(t *testing.T, src, dst string) {
	t.Helper()
	if err := filepath.WalkDir(src, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil || rel == "." {
			return err
		}
		target := filepath.Join(dst, rel)
		info, err := d.Info()
		if err != nil {
			return err
		}
		if d.IsDir() {
			return os.MkdirAll(target, info.Mode().Perm())
		}
		if info.Mode().Type() != 0 {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		return os.WriteFile(target, raw, info.Mode().Perm())
	}); err != nil {
		t.Fatal(err)
	}
}

func copyFileForIntegrationGit(t *testing.T, src, dst string) {
	t.Helper()
	raw, err := os.ReadFile(src)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dst, raw, 0o644); err != nil {
		t.Fatal(err)
	}
}
