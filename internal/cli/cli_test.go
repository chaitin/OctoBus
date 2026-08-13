package cli

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"octobus/internal/packageimport"
	"octobus/internal/version"
)

func TestStatusUsesAdminAPIAndRedacts(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/admin/v1/status" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "ok", "apiToken": "secret"})
	}))
	defer server.Close()
	addr := strings.TrimPrefix(server.URL, "http://")
	var out bytes.Buffer
	c := &CLI{AdminAddr: addr, Client: server.Client(), Stdout: &out}
	if err := c.Run([]string{"status"}); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.String(), "secret") || !strings.Contains(out.String(), "******") {
		t.Fatalf("output was not redacted: %s", out.String())
	}
}

func TestRedactJSONKeepsSecretStatusAndHidesSensitiveValues(t *testing.T) {
	raw := []byte(`{
		"ID": "echo-test",
		"HasSecret": true,
		"SecretSHA256": "abcdef",
		"Config": {
			"apiToken": "runtime-secret",
			"displayName": "Echo"
		},
		"SecretSchemaPath": "secret.schema.json",
		"PackageSource": "https://user:p%40ss@example.com/acme/repo.git"
	}`)
	got := string(redactJSON(raw))
	if !strings.Contains(got, `"HasSecret": true`) {
		t.Fatalf("HasSecret should remain a boolean status field: %s", got)
	}
	if !strings.Contains(got, `"SecretSchemaPath": "secret.schema.json"`) {
		t.Fatalf("SecretSchemaPath should remain visible as schema metadata: %s", got)
	}
	for _, leaked := range []string{"abcdef", "runtime-secret", "p%40ss", "p@ss"} {
		if strings.Contains(got, leaked) {
			t.Fatalf("redacted output leaked %q: %s", leaked, got)
		}
	}
	for _, want := range []string{`"SecretSHA256": "******"`, `"apiToken": "******"`, `https://user:******@example.com`} {
		if !strings.Contains(got, want) {
			t.Fatalf("redacted output missing %q: %s", want, got)
		}
	}
}

func TestAddrFlagOverridesAdminAPIAddress(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/admin/v1/status" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "ok"})
	}))
	defer server.Close()

	var out bytes.Buffer
	c := &CLI{AdminAddr: "127.0.0.1:1", Client: server.Client(), Stdout: &out}
	if err := c.Run([]string{"--addr", server.URL, "status"}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), `"status": "ok"`) {
		t.Fatalf("unexpected output: %s", out.String())
	}
}

func TestAddrFlagSupportsHTTPS(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/admin/v1/status" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "ok"})
	}))
	defer server.Close()

	var out bytes.Buffer
	c := &CLI{AdminAddr: "127.0.0.1:1", Client: server.Client(), Stdout: &out}
	if err := c.Run([]string{"--addr", server.URL, "status"}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), `"status": "ok"`) {
		t.Fatalf("unexpected output: %s", out.String())
	}
}

func TestRootCommandUsage(t *testing.T) {
	var runOut bytes.Buffer
	c := &CLI{Stdout: &runOut}
	if err := c.Run(nil); err != nil {
		t.Fatalf("root command should print help without error: %v", err)
	}

	cmd := c.Command()
	var helpOut bytes.Buffer
	cmd.SetOut(&helpOut)
	cmd.SetArgs([]string{"--help"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if runOut.String() != helpOut.String() {
		t.Fatalf("root output should match help output:\nroot=%q\nhelp=%q", runOut.String(), helpOut.String())
	}
	if !strings.Contains(runOut.String(), "Usage:\n  "+cmd.UseLine()) {
		t.Fatalf("unexpected help usage: %q", runOut.String())
	}
	if strings.Contains(runOut.String(), "octobus [command]") {
		t.Fatalf("help usage should not include alternate root command form: %q", runOut.String())
	}
}

func TestVersionCommandPrintsBuildInfo(t *testing.T) {
	oldVersion, oldCommit, oldDate := version.Version, version.Commit, version.Date
	version.Version = "abc1234"
	version.Commit = "abc1234"
	version.Date = "2026-06-15T01:02:03Z"
	t.Cleanup(func() {
		version.Version = oldVersion
		version.Commit = oldCommit
		version.Date = oldDate
	})

	var out bytes.Buffer
	c := &CLI{Stdout: &out}
	if err := c.Run([]string{"version"}); err != nil {
		t.Fatal(err)
	}
	want := "version: abc1234\ncommit: abc1234\ndate: 2026-06-15T01:02:03Z\n"
	if out.String() != want {
		t.Fatalf("unexpected version output: %q", out.String())
	}
}

func TestAdminBaseURL(t *testing.T) {
	tests := []struct {
		addr string
		want string
	}{
		{"127.0.0.1:9000", "http://127.0.0.1:9000"},
		{"localhost:9000", "http://localhost:9000"},
		{"http://192.0.2.10:9000", "http://192.0.2.10:9000"},
		{"https://example.com:9443", "https://example.com:9443"},
		{"http://localhost:9000/", "http://localhost:9000"},
		{"http://localhost:9000/base", "http://localhost:9000"},
	}
	for _, tc := range tests {
		t.Run(tc.addr, func(t *testing.T) {
			got, err := adminBaseURL(tc.addr)
			if err != nil {
				t.Fatal(err)
			}
			if got != tc.want {
				t.Fatalf("adminBaseURL(%q) = %q, want %q", tc.addr, got, tc.want)
			}
		})
	}

	for _, addr := range []string{"", "ftp://127.0.0.1:9000", "http://"} {
		t.Run("invalid_"+addr, func(t *testing.T) {
			if _, err := adminBaseURL(addr); err == nil {
				t.Fatalf("adminBaseURL(%q) should fail", addr)
			}
		})
	}
}

func TestServiceImportRequest(t *testing.T) {
	gitSource := "https://user:p%40ss@example.com/acme/repo.git//svc@v1.0.0"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/admin/v1/services/import" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		if req["service_id"] != "echo" || req["source"] != gitSource || req["offline"] != true {
			t.Fatalf("unexpected body: %+v", req)
		}
		if r.Header.Get("Accept") != "application/x-ndjson" {
			t.Fatalf("Accept=%q", r.Header.Get("Accept"))
		}
		_, _ = fmt.Fprintln(w, `{"type":"complete","status":"ok","service":{"ID":"echo"},"restarted_instances":[],"restart_errors":[]}`)
	}))
	defer server.Close()
	var out bytes.Buffer
	client := server.Client()
	client.Timeout = time.Minute
	c := &CLI{AdminAddr: strings.TrimPrefix(server.URL, "http://"), Client: client, Stdout: &out}
	if err := c.Run([]string{"service", "import", "echo", "--offline", gitSource}); err != nil {
		t.Fatal(err)
	}
	if c.Client.Timeout != time.Minute {
		t.Fatalf("client timeout mutated to %v", c.Client.Timeout)
	}
	if !strings.Contains(out.String(), `"ID": "echo"`) {
		t.Fatalf("stdout missing final service JSON: %s", out.String())
	}
}

func TestServiceImportRecursiveRequest(t *testing.T) {
	source := "npm:@chaitin-ai/octobus-tentacles"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/admin/v1/services/import" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		if req["recursive"] != true || req["source"] != source || req["build"] != "auto" {
			t.Fatalf("unexpected recursive body: %+v", req)
		}
		if _, ok := req["service_id"]; ok {
			t.Fatalf("recursive request should not include service_id: %+v", req)
		}
		if _, ok := req["name"]; ok {
			t.Fatalf("recursive request should not include name: %+v", req)
		}
		_, _ = fmt.Fprintln(w, `{"type":"complete","status":"ok","services":[],"restarted_instances":{},"restart_errors":{}}`)
	}))
	defer server.Close()
	c := &CLI{AdminAddr: strings.TrimPrefix(server.URL, "http://"), Client: server.Client(), Stdout: io.Discard}
	if err := c.Run([]string{"service", "import", "--recursive", source}); err != nil {
		t.Fatal(err)
	}
}

func TestServiceImportStreamProgressAndComplete(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Accept") != "application/x-ndjson" {
			t.Fatalf("Accept=%q", r.Header.Get("Accept"))
		}
		_, _ = fmt.Fprintln(w, `{"type":"status","stage":"prepare_source","message":"Preparing service package","service_id":"echo"}`)
		_, _ = fmt.Fprintln(w, `{"type":"complete","status":"ok","service":{"ID":"echo","PackageSource":"https://user:p%40ss@example.com/repo.git"},"restarted_instances":[],"restart_errors":[]}`)
	}))
	defer server.Close()
	var stdout, stderr bytes.Buffer
	c := &CLI{AdminAddr: strings.TrimPrefix(server.URL, "http://"), Client: server.Client(), Stdout: &stdout, Stderr: &stderr}
	if err := c.Run([]string{"service", "import", "echo", "npm:pkg"}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(stderr.String(), "echo: Preparing service package") {
		t.Fatalf("stderr=%q", stderr.String())
	}
	if !strings.Contains(stdout.String(), `"ID": "echo"`) || strings.Contains(stdout.String(), "p%40ss") || !strings.Contains(stdout.String(), "******") {
		t.Fatalf("stdout not redacted final JSON: %s", stdout.String())
	}
}

func TestServiceImportStreamErrorEventReturnsError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = fmt.Fprintln(w, `{"type":"error","stage":"prepare_runtime","error":"npm install --omit=dev: context canceled"}`)
	}))
	defer server.Close()
	c := &CLI{AdminAddr: strings.TrimPrefix(server.URL, "http://"), Client: server.Client(), Stdout: io.Discard, Stderr: io.Discard}
	err := c.Run([]string{"service", "import", "echo", "npm:pkg"})
	if err == nil || !strings.Contains(err.Error(), "context canceled") {
		t.Fatalf("err=%v", err)
	}
}

func TestServiceImportStreamDegradedReturnsErrorAfterOutput(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = fmt.Fprintln(w, `{"type":"complete","status":"degraded","service":{"ID":"echo"},"restarted_instances":[],"restart_errors":["echo-test: boom"]}`)
	}))
	defer server.Close()
	var out bytes.Buffer
	c := &CLI{AdminAddr: strings.TrimPrefix(server.URL, "http://"), Client: server.Client(), Stdout: &out, Stderr: io.Discard}
	err := c.Run([]string{"service", "import", "echo", "npm:pkg"})
	if err == nil || !strings.Contains(err.Error(), "degraded") {
		t.Fatalf("err=%v", err)
	}
	if !strings.Contains(out.String(), `"status": "degraded"`) {
		t.Fatalf("stdout=%s", out.String())
	}
}

func TestServiceImportRecursiveRequestConvertsLocalNPMSourceToAbsolutePath(t *testing.T) {
	tmp := t.TempDir()
	pkg := filepath.Join(tmp, "pkg")
	if err := os.Mkdir(pkg, 0o755); err != nil {
		t.Fatal(err)
	}
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatal(err)
		}
	})
	if err := os.Chdir(tmp); err != nil {
		t.Fatal(err)
	}
	absPkg, err := filepath.Abs("pkg")
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		want := "npm:" + absPkg
		if req["recursive"] != true || req["source"] != want {
			t.Fatalf("unexpected recursive body: %+v want source %q", req, want)
		}
		_, _ = fmt.Fprintln(w, `{"type":"complete","status":"ok","services":[],"restarted_instances":{},"restart_errors":{}}`)
	}))
	defer server.Close()
	c := &CLI{AdminAddr: strings.TrimPrefix(server.URL, "http://"), Client: server.Client(), Stdout: io.Discard}
	if err := c.Run([]string{"service", "import", "--recursive", "--source-mode", "remote", "npm:./pkg"}); err != nil {
		t.Fatal(err)
	}
}

func TestNormalizeImportSourcePreservesServiceRoot(t *testing.T) {
	tmp := t.TempDir()
	pkg := filepath.Join(tmp, "pkg")
	if err := os.Mkdir(pkg, 0o755); err != nil {
		t.Fatal(err)
	}
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatal(err)
		}
	})
	if err := os.Chdir(tmp); err != nil {
		t.Fatal(err)
	}
	absPkg, err := filepath.Abs("pkg")
	if err != nil {
		t.Fatal(err)
	}
	gitSource := "https://user:p%40ss@example.com/acme/repo.git//svc@v1.0.0"
	tests := []struct {
		name   string
		source string
		want   string
	}{
		{name: "local service root", source: "./pkg//nested", want: absPkg + "//nested"},
		{name: "npm local service root", source: "npm:./pkg//nested", want: "npm:" + absPkg + "//nested"},
		{name: "https git unchanged", source: gitSource, want: gitSource},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := normalizeImportSource(tc.source)
			if err != nil {
				t.Fatal(err)
			}
			if got != tc.want {
				t.Fatalf("normalizeImportSource(%q)=%q want %q", tc.source, got, tc.want)
			}
		})
	}
}

func TestResolveImportSourceTransferModes(t *testing.T) {
	tmp := t.TempDir()
	pkg := filepath.Join(tmp, "pkg")
	if err := os.Mkdir(pkg, 0o755); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(tmp, "service.tar.gz")
	if err := os.WriteFile(archive, []byte("fixture"), 0o644); err != nil {
		t.Fatal(err)
	}
	unsupported := filepath.Join(tmp, "notes.txt")
	if err := os.WriteFile(unsupported, []byte("fixture"), 0o644); err != nil {
		t.Fatal(err)
	}
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatal(err)
		}
	})
	if err := os.Chdir(tmp); err != nil {
		t.Fatal(err)
	}
	absPkg, err := filepath.Abs("pkg")
	if err != nil {
		t.Fatal(err)
	}
	absUnsupported, err := filepath.Abs("notes.txt")
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name       string
		source     string
		mode       string
		wantSource string
		wantUpload bool
		wantPath   string
		wantKind   packageimport.UploadKind
		wantErr    string
	}{
		{name: "auto local directory", source: "./pkg//nested", mode: "auto", wantSource: "client-upload:pkg//nested", wantUpload: true, wantPath: absPkg, wantKind: packageimport.UploadKindDirectory},
		{name: "auto local archive", source: "service.tar.gz", mode: "auto", wantSource: "client-upload:service.tar.gz", wantUpload: true, wantPath: archive, wantKind: packageimport.UploadKindArchive},
		{name: "auto npm local", source: "npm:./pkg", mode: "auto", wantSource: "client-upload:pkg", wantUpload: true, wantPath: absPkg, wantKind: packageimport.UploadKindNPMLocal},
		{name: "auto missing keeps json", source: "missing", mode: "auto", wantSource: "missing"},
		{name: "auto unsupported file keeps json", source: "notes.txt", mode: "auto", wantSource: absUnsupported},
		{name: "remote local directory keeps json", source: "./pkg", mode: "remote", wantSource: absPkg},
		{name: "upload missing fails", source: "missing", mode: "upload", wantErr: "--source-mode upload requires"},
		{name: "upload unsupported fails", source: "notes.txt", mode: "upload", wantErr: "--source-mode upload requires"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := resolveImportSourceTransfer(tc.source, tc.mode)
			if tc.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("resolveImportSourceTransfer error=%v want %q", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got.Source != tc.wantSource || got.Upload != tc.wantUpload {
				t.Fatalf("transfer=%+v want source=%q upload=%v", got, tc.wantSource, tc.wantUpload)
			}
			if tc.wantUpload {
				if got.Local.Path != tc.wantPath || got.Local.Source != tc.wantSource || got.Local.UploadKind != tc.wantKind {
					t.Fatalf("local transfer=%+v want path=%q source=%q kind=%q", got.Local, tc.wantPath, tc.wantSource, tc.wantKind)
				}
				if strings.Contains(got.Source, tmp) {
					t.Fatalf("upload source leaked absolute path: %+v", got)
				}
			}
		})
	}
}

func TestServiceImportAutoUploadsLocalDirectoryWithLoopbackAdminAddr(t *testing.T) {
	tmp := t.TempDir()
	pkg := filepath.Join(tmp, "pkg")
	if err := os.MkdirAll(filepath.Join(pkg, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pkg, "service.json"), []byte(`{"name":"echo"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pkg, "sub", "entry.js"), []byte("console.log('ok')"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("service.json", filepath.Join(pkg, "link.json")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatal(err)
		}
	})
	if err := os.Chdir(tmp); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Accept") != "application/x-ndjson" || !strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
			t.Fatalf("unexpected headers: Accept=%q Content-Type=%q", r.Header.Get("Accept"), r.Header.Get("Content-Type"))
		}
		options, uploadKind, pkgBytes := readServiceImportMultipartRequest(t, r)
		if options["service_id"] != "echo" || options["source"] != "client-upload:pkg" {
			t.Fatalf("unexpected multipart options: %+v", options)
		}
		if strings.Contains(fmt.Sprint(options["source"]), tmp) {
			t.Fatalf("multipart options leaked local path: %+v", options)
		}
		if uploadKind != string(packageimport.UploadKindDirectory) {
			t.Fatalf("upload_kind=%q", uploadKind)
		}
		entries := readTarGzEntryNames(t, pkgBytes)
		for _, want := range []string{"package/service.json", "package/sub/entry.js"} {
			if !entries[want] {
				t.Fatalf("directory upload missing %s in entries %+v", want, entries)
			}
		}
		if entries["package/link.json"] {
			t.Fatalf("directory upload should skip symlink entries: %+v", entries)
		}
		_, _ = fmt.Fprintln(w, `{"type":"complete","status":"ok","service":{"ID":"echo"},"restarted_instances":[],"restart_errors":[]}`)
	}))
	defer server.Close()
	if !strings.Contains(server.URL, "127.0.0.1") {
		t.Fatalf("test server is not using a loopback address: %s", server.URL)
	}
	c := &CLI{AdminAddr: strings.TrimPrefix(server.URL, "http://"), Client: server.Client(), Stdout: io.Discard}
	if err := c.Run([]string{"service", "import", "echo", "./pkg"}); err != nil {
		t.Fatal(err)
	}
}

func TestServiceImportAutoKeepsHTTPArchiveJSON(t *testing.T) {
	source := "https://example.com/packages/echo.tgz"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
			t.Fatalf("Content-Type=%q", r.Header.Get("Content-Type"))
		}
		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		if req["service_id"] != "echo" || req["source"] != source {
			t.Fatalf("unexpected HTTP archive JSON body: %+v", req)
		}
		_, _ = fmt.Fprintln(w, `{"type":"complete","status":"ok","service":{"ID":"echo"},"restarted_instances":[],"restart_errors":[]}`)
	}))
	defer server.Close()
	c := &CLI{AdminAddr: strings.TrimPrefix(server.URL, "http://"), Client: server.Client(), Stdout: io.Discard}
	if err := c.Run([]string{"service", "import", "echo", source}); err != nil {
		t.Fatal(err)
	}
}

func TestServiceImportMultipartUploadsArchiveAndNPMLocal(t *testing.T) {
	tmp := t.TempDir()
	archive := filepath.Join(tmp, "service.zip")
	if err := os.WriteFile(archive, []byte("zip bytes"), 0o644); err != nil {
		t.Fatal(err)
	}
	pkg := filepath.Join(tmp, "pkg")
	if err := os.Mkdir(pkg, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pkg, "package.json"), []byte(`{"name":"fixture"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatal(err)
		}
	})
	if err := os.Chdir(tmp); err != nil {
		t.Fatal(err)
	}
	var seen []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		options, uploadKind, pkgBytes := readServiceImportMultipartRequest(t, r)
		seen = append(seen, uploadKind)
		switch uploadKind {
		case string(packageimport.UploadKindArchive):
			if options["source"] != "client-upload:service.zip" || string(pkgBytes) != "zip bytes" {
				t.Fatalf("archive multipart mismatch options=%+v body=%q", options, pkgBytes)
			}
		case string(packageimport.UploadKindNPMLocal):
			if options["source"] != "client-upload:pkg" {
				t.Fatalf("npm-local multipart options mismatch: %+v", options)
			}
			entries := readTarGzEntryNames(t, pkgBytes)
			if !entries["package/package.json"] {
				t.Fatalf("npm-local directory upload missing package file in entries %+v", entries)
			}
		default:
			t.Fatalf("unexpected upload_kind=%q", uploadKind)
		}
		_, _ = fmt.Fprintln(w, `{"type":"complete","status":"ok","service":{"ID":"echo"},"restarted_instances":[],"restart_errors":[]}`)
	}))
	defer server.Close()
	c := &CLI{AdminAddr: strings.TrimPrefix(server.URL, "http://"), Client: server.Client(), Stdout: io.Discard}
	if err := c.Run([]string{"service", "import", "--source-mode", "upload", "echo", "service.zip"}); err != nil {
		t.Fatal(err)
	}
	if err := c.Run([]string{"service", "import", "echo", "npm:./pkg"}); err != nil {
		t.Fatal(err)
	}
	if strings.Join(seen, ",") != "archive,npm-local" {
		t.Fatalf("upload kinds=%v", seen)
	}
}

func readServiceImportMultipartRequest(t *testing.T, r *http.Request) (map[string]any, string, []byte) {
	t.Helper()
	reader, err := r.MultipartReader()
	if err != nil {
		t.Fatal(err)
	}
	var options map[string]any
	var uploadKind string
	var packageBytes []byte
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		switch part.FormName() {
		case "options":
			if err := json.NewDecoder(part).Decode(&options); err != nil {
				t.Fatal(err)
			}
		case "upload_kind":
			raw, err := io.ReadAll(part)
			if err != nil {
				t.Fatal(err)
			}
			uploadKind = string(raw)
		case "package":
			raw, err := io.ReadAll(part)
			if err != nil {
				t.Fatal(err)
			}
			packageBytes = raw
		default:
			t.Fatalf("unexpected multipart field %q", part.FormName())
		}
	}
	if options == nil || uploadKind == "" || packageBytes == nil {
		t.Fatalf("incomplete multipart request options=%+v uploadKind=%q packageBytes=%d", options, uploadKind, len(packageBytes))
	}
	return options, uploadKind, packageBytes
}

func readTarGzEntryNames(t *testing.T, raw []byte) map[string]bool {
	t.Helper()
	gz, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	defer gz.Close()
	reader := tar.NewReader(gz)
	entries := map[string]bool{}
	for {
		header, err := reader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		entries[header.Name] = true
	}
	return entries
}

func TestServiceImportRequestConvertsLocalSourceToAbsolutePath(t *testing.T) {
	tmp := t.TempDir()
	source := filepath.Join(tmp, "service.tgz")
	if err := os.WriteFile(source, []byte("fixture"), 0o644); err != nil {
		t.Fatal(err)
	}
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatal(err)
		}
	})
	if err := os.Chdir(tmp); err != nil {
		t.Fatal(err)
	}
	absSource, err := filepath.Abs("service.tgz")
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		if req["source"] != absSource {
			t.Fatalf("source=%q want %q", req["source"], absSource)
		}
		_, _ = fmt.Fprintln(w, `{"type":"complete","status":"ok","service":{"ID":"echo"},"restarted_instances":[],"restart_errors":[]}`)
	}))
	defer server.Close()
	c := &CLI{AdminAddr: strings.TrimPrefix(server.URL, "http://"), Client: server.Client(), Stdout: io.Discard}
	if err := c.Run([]string{"service", "import", "--source-mode", "remote", "echo", "service.tgz"}); err != nil {
		t.Fatal(err)
	}
}

func TestServiceImportRequestConvertsLocalNPMSourceToAbsolutePath(t *testing.T) {
	tmp := t.TempDir()
	pkg := filepath.Join(tmp, "pkg")
	if err := os.Mkdir(pkg, 0o755); err != nil {
		t.Fatal(err)
	}
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatal(err)
		}
	})
	if err := os.Chdir(tmp); err != nil {
		t.Fatal(err)
	}
	absPkg, err := filepath.Abs("pkg")
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		want := "npm:" + absPkg
		if req["source"] != want {
			t.Fatalf("source=%q want %q", req["source"], want)
		}
		_, _ = fmt.Fprintln(w, `{"type":"complete","status":"ok","service":{"ID":"echo"},"restarted_instances":[],"restart_errors":[]}`)
	}))
	defer server.Close()
	c := &CLI{AdminAddr: strings.TrimPrefix(server.URL, "http://"), Client: server.Client(), Stdout: io.Discard}
	if err := c.Run([]string{"service", "import", "--source-mode", "remote", "echo", "npm:./pkg"}); err != nil {
		t.Fatal(err)
	}
}

func TestCLIRedactsCredentialURLsInServiceResponses(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/admin/v1/services/echo" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ID":            "echo",
			"PackageSource": "https://user:p%40ss@example.com/acme/repo.git//svc@v1.0.0",
		})
	}))
	defer server.Close()
	var out bytes.Buffer
	c := &CLI{AdminAddr: strings.TrimPrefix(server.URL, "http://"), Client: server.Client(), Stdout: &out}
	if err := c.Run([]string{"service", "get", "echo"}); err != nil {
		t.Fatal(err)
	}
	got := out.String()
	if strings.Contains(got, "p%40ss") || strings.Contains(got, "p@ss") || !strings.Contains(got, "******") {
		t.Fatalf("output did not redact credential URL: %s", got)
	}
}

func TestInstanceCreateReadsConfig(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.json")
	if err := os.WriteFile(configPath, []byte(`{"password":"secret"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/admin/v1/instances" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		config := req["config"].(map[string]any)
		if config["password"] != "secret" {
			t.Fatalf("unexpected config: %+v", req)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "echo-test"})
	}))
	defer server.Close()
	var out bytes.Buffer
	c := &CLI{AdminAddr: strings.TrimPrefix(server.URL, "http://"), Client: server.Client(), Stdout: &out}
	if err := c.Run([]string{"instance", "create", "echo-test", "--service", "echo", "--config", configPath, "--no-start"}); err != nil {
		t.Fatal(err)
	}
}

func TestInstanceCreateWithoutConfigUsesEmptyObject(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/admin/v1/instances" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		config := req["config"].(map[string]any)
		if len(config) != 0 {
			t.Fatalf("unexpected config: %+v", req)
		}
		secret := req["secret"].(map[string]any)
		if len(secret) != 0 {
			t.Fatalf("unexpected secret: %+v", req)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "echo-test"})
	}))
	defer server.Close()
	var out bytes.Buffer
	c := &CLI{AdminAddr: strings.TrimPrefix(server.URL, "http://"), Client: server.Client(), Stdout: &out}
	if err := c.Run([]string{"instance", "create", "echo-test", "--service", "echo", "--no-start"}); err != nil {
		t.Fatal(err)
	}
}

func TestInstanceCreateReadsInlineConfigJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/admin/v1/instances" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		config := req["config"].(map[string]any)
		if config["label"] != "inline" {
			t.Fatalf("unexpected config: %+v", req)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "echo-test"})
	}))
	defer server.Close()
	var out bytes.Buffer
	c := &CLI{AdminAddr: strings.TrimPrefix(server.URL, "http://"), Client: server.Client(), Stdout: &out}
	if err := c.Run([]string{"instance", "create", "echo-test", "--service", "echo", "--config-json", `{"label":"inline"}`, "--no-start"}); err != nil {
		t.Fatal(err)
	}
}

func TestInstanceCreateReadsSecret(t *testing.T) {
	dir := t.TempDir()
	secretPath := filepath.Join(dir, "secret.json")
	if err := os.WriteFile(secretPath, []byte(`{"apiToken":"secret"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/admin/v1/instances" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		config := req["config"].(map[string]any)
		secret := req["secret"].(map[string]any)
		if len(config) != 0 || secret["apiToken"] != "secret" {
			t.Fatalf("unexpected request: %+v", req)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "echo-test"})
	}))
	defer server.Close()
	var out bytes.Buffer
	c := &CLI{AdminAddr: strings.TrimPrefix(server.URL, "http://"), Client: server.Client(), Stdout: &out}
	if err := c.Run([]string{"instance", "create", "echo-test", "--service", "echo", "--secret", secretPath, "--no-start"}); err != nil {
		t.Fatal(err)
	}
}

func TestInstanceCreateReadsInlineSecretJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/admin/v1/instances" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		secret := req["secret"].(map[string]any)
		if secret["apiToken"] != "inline" {
			t.Fatalf("unexpected secret: %+v", req)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "echo-test"})
	}))
	defer server.Close()
	var out bytes.Buffer
	c := &CLI{AdminAddr: strings.TrimPrefix(server.URL, "http://"), Client: server.Client(), Stdout: &out}
	if err := c.Run([]string{"instance", "create", "echo-test", "--service", "echo", "--secret-json", `{"apiToken":"inline"}`, "--no-start"}); err != nil {
		t.Fatal(err)
	}
}

func TestInstanceCreateReadsSecretFromStdin(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/admin/v1/instances" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		secret := req["secret"].(map[string]any)
		if secret["apiToken"] != "stdin" {
			t.Fatalf("unexpected secret: %+v", req)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "echo-test"})
	}))
	defer server.Close()
	var out bytes.Buffer
	c := &CLI{AdminAddr: strings.TrimPrefix(server.URL, "http://"), Client: server.Client(), Stdin: strings.NewReader(`{"apiToken":"stdin"}`), Stdout: &out}
	if err := c.Run([]string{"instance", "create", "echo-test", "--service", "echo", "--secret", "-", "--no-start"}); err != nil {
		t.Fatal(err)
	}
}

func TestInstanceCreateReadsConfigFromStdin(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/admin/v1/instances" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		config := req["config"].(map[string]any)
		if config["label"] != "stdin" {
			t.Fatalf("unexpected config: %+v", req)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "echo-test"})
	}))
	defer server.Close()
	var out bytes.Buffer
	c := &CLI{AdminAddr: strings.TrimPrefix(server.URL, "http://"), Client: server.Client(), Stdin: strings.NewReader(`{"label":"stdin"}`), Stdout: &out}
	if err := c.Run([]string{"instance", "create", "echo-test", "--service", "echo", "--config", "-", "--no-start"}); err != nil {
		t.Fatal(err)
	}
}

func TestCRUDCommandRequests(t *testing.T) {
	tests := []struct {
		args   []string
		method string
		path   string
		body   string
	}{
		{[]string{"service", "list"}, http.MethodGet, "/admin/v1/services", ""},
		{[]string{"service", "get", "echo"}, http.MethodGet, "/admin/v1/services/echo", ""},
		{[]string{"service", "update", "echo", "--name", "Echo Updated"}, http.MethodPatch, "/admin/v1/services/echo", `"name":"Echo Updated"`},
		{[]string{"service", "delete", "echo"}, http.MethodDelete, "/admin/v1/services/echo", ""},
		{[]string{"instance", "list"}, http.MethodGet, "/admin/v1/instances", ""},
		{[]string{"instance", "get", "echo-test"}, http.MethodGet, "/admin/v1/instances/echo-test", ""},
		{[]string{"instance", "update", "echo-test", "--name", "Renamed"}, http.MethodPatch, "/admin/v1/instances/echo-test", `"name":"Renamed"`},
		{[]string{"instance", "delete", "echo-test"}, http.MethodDelete, "/admin/v1/instances/echo-test", ""},
		{[]string{"instance", "update-config", "echo-test", "--config-json", `{"label":"inline"}`}, http.MethodPost, "/admin/v1/instances/echo-test/config", `"label":"inline"`},
		{[]string{"instance", "update-secret", "echo-test", "--secret-json", `{"apiToken":"inline"}`}, http.MethodPost, "/admin/v1/instances/echo-test/secret", `"apiToken":"inline"`},
		{[]string{"capset", "list"}, http.MethodGet, "/admin/v1/capsets", ""},
		{[]string{"capset", "get", "dev"}, http.MethodGet, "/admin/v1/capsets/dev", ""},
		{[]string{"capset", "update", "dev", "--description", "tools", "--enabled=false"}, http.MethodPatch, "/admin/v1/capsets/dev", `"enabled":false`},
		{[]string{"capset", "delete", "dev"}, http.MethodDelete, "/admin/v1/capsets/dev", ""},
		{[]string{"capset", "add-instance", "dev", "echo-test"}, http.MethodPost, "/admin/v1/capsets/dev/instances", `"all_methods":true`},
		{[]string{"capset", "add-instance", "dev", "echo-test", "--no-all-methods"}, http.MethodPost, "/admin/v1/capsets/dev/instances", `"no_all_methods":true`},
		{[]string{"capset", "list-instances", "dev"}, http.MethodGet, "/admin/v1/capsets/dev/instances", ""},
		{[]string{"capset", "remove-instance", "dev", "echo-test"}, http.MethodDelete, "/admin/v1/capsets/dev/instances/echo-test", ""},
		{[]string{"capset", "list-methods", "dev"}, http.MethodGet, "/admin/v1/capsets/dev/methods", ""},
		{[]string{"capset", "unselect-method", "dev", "echo-test", "/echo.v1.EchoService/Echo"}, http.MethodDelete, "/admin/v1/capsets/dev/methods?instance_id=echo-test&method=%2Fecho.v1.EchoService%2FEcho", ""},
		{[]string{"capset", "add-token", "dev", "key-one", "--name", "Primary", "--token", "secret-one"}, http.MethodPost, "/admin/v1/capsets/dev/tokens", `"token":"secret-one"`},
		{[]string{"capset", "list-tokens", "dev"}, http.MethodGet, "/admin/v1/capsets/dev/tokens", ""},
		{[]string{"capset", "remove-token", "dev", "key-one"}, http.MethodDelete, "/admin/v1/capsets/dev/tokens/key-one", ""},
		{[]string{"admin-token", "add", "key-one", "--name", "Primary", "--token", "secret-one"}, http.MethodPost, "/admin/v1/tokens", `"token":"secret-one"`},
		{[]string{"admin-token", "list"}, http.MethodGet, "/admin/v1/tokens", ""},
		{[]string{"admin-token", "get", "key-one"}, http.MethodGet, "/admin/v1/tokens/key-one", ""},
		{[]string{"admin-token", "delete", "key-one"}, http.MethodDelete, "/admin/v1/tokens/key-one", ""},
		{[]string{"admin-token", "remove", "key-one"}, http.MethodDelete, "/admin/v1/tokens/key-one", ""},
		{[]string{"catalog", "dev"}, http.MethodGet, "/admin/v1/catalog/dev?format=json&grpc=true", ""},
		{[]string{"catalog", "dev", "--grpc", "--mcp"}, http.MethodGet, "/admin/v1/catalog/dev?format=json&grpc=true&mcp=true", ""},
		{[]string{"catalog", "dev", "--connect", "--json"}, http.MethodGet, "/admin/v1/catalog/dev?connect=true&format=json", ""},
		{[]string{"catalog", "dev", "--all", "--md"}, http.MethodGet, "/admin/v1/catalog/dev?all=true&format=md", ""},
		{[]string{"catalog", "dev", "--openapi-json"}, http.MethodGet, "/admin/v1/catalog/dev/openapi.json", ""},
		{[]string{"catalog", "dev", "--openapi-yaml"}, http.MethodGet, "/admin/v1/catalog/dev/openapi.yaml", ""},
		{[]string{"logs"}, http.MethodGet, "/admin/v1/logs/access", ""},
		{[]string{"logs", "--capset", "dev", "--instance", "calculator-test", "--service", "calculator", "--limit", "0"}, http.MethodGet, "/admin/v1/logs/access?capset=dev&instance=calculator-test&limit=0&service=calculator", ""},
		{[]string{"logs", "--tail", "10"}, http.MethodGet, "/admin/v1/logs/access?tail=10", ""},
		{[]string{"logs", "-f", "--tail", "0"}, http.MethodGet, "/admin/v1/logs/access?follow=true&tail=0", ""},
	}
	for _, tc := range tests {
		t.Run(strings.Join(tc.args, "_"), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != tc.method || r.URL.RequestURI() != tc.path {
					t.Fatalf("unexpected request %s %s", r.Method, r.URL.RequestURI())
				}
				if tc.body != "" {
					raw, err := io.ReadAll(r.Body)
					if err != nil {
						t.Fatal(err)
					}
					if !strings.Contains(string(raw), tc.body) {
						t.Fatalf("body %s does not contain %s", raw, tc.body)
					}
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
			}))
			defer server.Close()
			var out bytes.Buffer
			c := &CLI{AdminAddr: strings.TrimPrefix(server.URL, "http://"), Client: server.Client(), Stdout: &out}
			if err := c.Run(tc.args); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestTokenSourceInputs(t *testing.T) {
	tokenPath := filepath.Join(t.TempDir(), "token.txt")
	if err := os.WriteFile(tokenPath, []byte(" file-secret \n"), 0o600); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name      string
		args      []string
		stdin     string
		wantPath  string
		wantToken string
	}{
		{
			name:      "admin token file",
			args:      []string{"admin-token", "add", "local", "--token-file", tokenPath},
			wantPath:  "/admin/v1/tokens",
			wantToken: "file-secret",
		},
		{
			name:      "admin token stdin",
			args:      []string{"admin-token", "add", "local", "--token-stdin"},
			stdin:     " stdin-secret\n",
			wantPath:  "/admin/v1/tokens",
			wantToken: "stdin-secret",
		},
		{
			name:      "admin token file dash",
			args:      []string{"admin-token", "add", "local", "--token-file", "-"},
			stdin:     " dash-secret\n",
			wantPath:  "/admin/v1/tokens",
			wantToken: "dash-secret",
		},
		{
			name:      "capset token file",
			args:      []string{"capset", "add-token", "dev", "local", "--token-file", tokenPath},
			wantPath:  "/admin/v1/capsets/dev/tokens",
			wantToken: "file-secret",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPost || r.URL.Path != tc.wantPath {
					t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
				}
				var req map[string]any
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
					t.Fatal(err)
				}
				if req["token"] != tc.wantToken {
					t.Fatalf("token=%q want %q", req["token"], tc.wantToken)
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
			}))
			defer server.Close()
			c := &CLI{AdminAddr: strings.TrimPrefix(server.URL, "http://"), Client: server.Client(), Stdin: strings.NewReader(tc.stdin), Stdout: io.Discard}
			if err := c.Run(tc.args); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestTokenSourceValidation(t *testing.T) {
	c := &CLI{AdminAddr: "127.0.0.1:1", Client: &http.Client{}, Stdin: strings.NewReader("  \n"), Stdout: io.Discard}
	tests := []struct {
		name string
		args []string
		want string
	}{
		{name: "missing", args: []string{"admin-token", "add", "local"}, want: "token source is required"},
		{name: "mutual exclusion", args: []string{"admin-token", "add", "local", "--token", "a", "--token-stdin"}, want: "mutually exclusive"},
		{name: "empty stdin", args: []string{"admin-token", "add", "local", "--token-stdin"}, want: "token source is empty"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := c.Run(tc.args)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("args=%v err=%v want %q", tc.args, err, tc.want)
			}
		})
	}
}

func TestCLIAdminTokenAuthorizationSources(t *testing.T) {
	tmp := t.TempDir()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatal(err)
		}
	})
	if err := os.Chdir(tmp); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(".octobus.yml", []byte("adminToken: yaml-token\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	assertCLIAuthToken(t, []string{"service", "list"}, "yaml-token")

	if err := os.WriteFile(".env", []byte("OCTOBUS_ADMIN_TOKEN=env-file-token\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	assertCLIAuthToken(t, []string{"service", "list"}, "env-file-token")

	t.Setenv("OCTOBUS_ADMIN_TOKEN", "env-token")
	assertCLIAuthToken(t, []string{"service", "list"}, "env-token")
	assertCLIAuthToken(t, []string{"status"}, "")
}

func TestCLIAdminTokenIgnoresDotEnvDirectory(t *testing.T) {
	tmp := t.TempDir()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatal(err)
		}
	})
	if err := os.Chdir(tmp); err != nil {
		t.Fatal(err)
	}

	if err := os.Mkdir(".env", 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(".octobus.yml", []byte("adminToken: yaml-token\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	assertCLIAuthToken(t, []string{"service", "list"}, "yaml-token")
}

func TestCLIAdminTokenConfigErrors(t *testing.T) {
	tmp := t.TempDir()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatal(err)
		}
	})
	if err := os.Chdir(tmp); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(".octobus.yml", []byte("admin_token: 123\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("request should not be sent when admin token config is invalid")
	}))
	defer server.Close()
	var out bytes.Buffer
	c := &CLI{AdminAddr: strings.TrimPrefix(server.URL, "http://"), Client: server.Client(), Stdout: &out}
	err = c.Run([]string{"service", "list"})
	if err == nil || !strings.Contains(err.Error(), "admin_token in .octobus.yml must be a string") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func assertCLIAuthToken(t *testing.T, args []string, want string) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if got != want {
			t.Fatalf("%v Authorization token=%q want %q", args, got, want)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}))
	defer server.Close()
	var out bytes.Buffer
	c := &CLI{AdminAddr: strings.TrimPrefix(server.URL, "http://"), Client: server.Client(), Stdout: &out}
	if err := c.Run(args); err != nil {
		t.Fatal(err)
	}
}

func TestCatalogCommandValidationAndRawOutput(t *testing.T) {
	var out bytes.Buffer
	c := &CLI{AdminAddr: "127.0.0.1:1", Client: &http.Client{}, Stdout: &out}
	if err := c.Run([]string{"catalog"}); err == nil || !strings.Contains(err.Error(), "capset id is required") {
		t.Fatalf("missing capset error=%v", err)
	}
	if err := c.Run([]string{"catalog", "dev", "--all", "--grpc"}); err == nil || !strings.Contains(err.Error(), "mutually exclusive") {
		t.Fatalf("all conflict error=%v", err)
	}
	if err := c.Run([]string{"catalog", "dev", "--json", "--md"}); err == nil || !strings.Contains(err.Error(), "mutually exclusive") {
		t.Fatalf("format conflict error=%v", err)
	}
	if err := c.Run([]string{"catalog", "dev", "--openapi-json", "--connect"}); err == nil || !strings.Contains(err.Error(), "conflict") {
		t.Fatalf("openapi conflict error=%v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/admin/v1/catalog/dev" || r.URL.Query().Get("format") != "md" {
			t.Fatalf("unexpected request %s", r.URL.RequestURI())
		}
		w.Header().Set("Content-Type", "text/markdown")
		_, _ = w.Write([]byte("# Catalog\n"))
	}))
	defer server.Close()
	out.Reset()
	c = &CLI{AdminAddr: strings.TrimPrefix(server.URL, "http://"), Client: server.Client(), Stdout: &out}
	if err := c.Run([]string{"catalog", "dev", "--md"}); err != nil {
		t.Fatal(err)
	}
	if got := out.String(); got != "# Catalog\n\n" {
		t.Fatalf("raw markdown output=%q", got)
	}
}

func TestLogsCommandValidationAndRawOutput(t *testing.T) {
	var out bytes.Buffer
	c := &CLI{AdminAddr: "127.0.0.1:1", Client: &http.Client{}, Stdout: &out}
	if err := c.Run([]string{"logs", "--limit", "-1"}); err == nil || !strings.Contains(err.Error(), "limit must be non-negative") {
		t.Fatalf("negative limit error=%v", err)
	}
	if err := c.Run([]string{"logs", "--tail", "-1"}); err == nil || !strings.Contains(err.Error(), "tail must be non-negative") {
		t.Fatalf("negative tail error=%v", err)
	}
	if err := c.Run([]string{"logs", "--limit", "1", "--tail", "1"}); err == nil || !strings.Contains(err.Error(), "limit and tail are mutually exclusive") {
		t.Fatalf("limit tail conflict error=%v", err)
	}
	if err := c.Run([]string{"logs", "--limit", "1", "-f"}); err == nil || !strings.Contains(err.Error(), "limit and follow are mutually exclusive") {
		t.Fatalf("limit follow conflict error=%v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.RequestURI() != "/admin/v1/logs/access?capset=dev&limit=1" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.RequestURI())
		}
		w.Header().Set("Content-Type", "application/x-ndjson")
		_, _ = w.Write([]byte(`{"capset":"dev","service":"calculator"}` + "\n"))
	}))
	defer server.Close()
	out.Reset()
	c = &CLI{AdminAddr: strings.TrimPrefix(server.URL, "http://"), Client: server.Client(), Stdout: &out}
	if err := c.Run([]string{"logs", "--capset", "dev", "--limit", "1"}); err != nil {
		t.Fatal(err)
	}
	if got := out.String(); got != `{"capset":"dev","service":"calculator"}`+"\n\n" {
		t.Fatalf("raw logs output=%q", got)
	}
	out.Reset()
	cmd := c.Command()
	cmd.SetOut(&out)
	cmd.SetArgs([]string{"logs", "--help"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "--instance") {
		t.Fatalf("logs help missing filters:\n%s", out.String())
	}
}

func TestLogsFollowStreamsRawOutput(t *testing.T) {
	var out bytes.Buffer
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.RequestURI() != "/admin/v1/logs/access?follow=true&tail=1" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.RequestURI())
		}
		w.Header().Set("Content-Type", "application/x-ndjson")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"method":"old"}` + "\n"))
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		_, _ = w.Write([]byte(`{"method":"new"}` + "\n"))
	}))
	defer server.Close()

	c := &CLI{AdminAddr: strings.TrimPrefix(server.URL, "http://"), Client: server.Client(), Stdout: &out}
	if err := c.Run([]string{"logs", "--follow", "--tail", "1"}); err != nil {
		t.Fatal(err)
	}
	if got := out.String(); got != "{\"method\":\"old\"}\n{\"method\":\"new\"}\n" {
		t.Fatalf("stream output=%q", got)
	}
}

func TestConfigSourceValidation(t *testing.T) {
	var out bytes.Buffer
	c := &CLI{AdminAddr: "127.0.0.1:1", Client: &http.Client{}, Stdout: &out}
	err := c.Run([]string{"instance", "create", "echo-test", "--service", "echo", "--config", "config.json", "--config-json", `{}`})
	if err == nil || !strings.Contains(err.Error(), "mutually exclusive") {
		t.Fatalf("unexpected error: %v", err)
	}

	err = c.Run([]string{"instance", "create", "echo-test", "--service", "echo", "--config-json", `{bad`})
	if err == nil || !strings.Contains(err.Error(), "invalid --config-json") {
		t.Fatalf("unexpected error: %v", err)
	}

	err = c.Run([]string{"instance", "update-config", "echo-test"})
	if err == nil || !strings.Contains(err.Error(), "requires --config or --config-json") {
		t.Fatalf("unexpected error: %v", err)
	}

	err = c.Run([]string{"instance", "create", "echo-test", "--service", "echo", "--secret", "secret.json", "--secret-json", `{}`})
	if err == nil || !strings.Contains(err.Error(), "--secret and --secret-json are mutually exclusive") {
		t.Fatalf("unexpected error: %v", err)
	}

	err = c.Run([]string{"instance", "create", "echo-test", "--service", "echo", "--secret-json", `{bad`})
	if err == nil || !strings.Contains(err.Error(), "invalid --secret-json") {
		t.Fatalf("unexpected error: %v", err)
	}

	err = c.Run([]string{"instance", "update-secret", "echo-test"})
	if err == nil || !strings.Contains(err.Error(), "requires --secret or --secret-json") {
		t.Fatalf("unexpected error: %v", err)
	}

	err = c.Run([]string{"instance", "create", "echo-test", "--service", "echo", "--config", "-", "--secret", "-"})
	if err == nil || !strings.Contains(err.Error(), "cannot read both --config - and --secret -") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestCommandValidationErrors(t *testing.T) {
	tests := []struct {
		name string
		args []string
		want string
	}{
		{name: "service usage", args: []string{"service"}, want: "usage: octobus service"},
		{name: "service import id", args: []string{"service", "import"}, want: "service id is required"},
		{name: "service import source", args: []string{"service", "import", "pkg"}, want: "service source is required"},
		{name: "service import recursive source", args: []string{"service", "import", "--recursive"}, want: "service source is required"},
		{name: "service import recursive extra arg", args: []string{"service", "import", "--recursive", "pkg", "extra"}, want: "accepts 1 arg(s), received 2"},
		{name: "service import recursive name", args: []string{"service", "import", "--recursive", "--name", "Name", "pkg"}, want: "--name cannot be used with --recursive"},
		{name: "service import source mode", args: []string{"service", "import", "--source-mode", "other", "echo", "missing"}, want: "invalid source mode"},
		{name: "service update id", args: []string{"service", "update"}, want: "service id is required"},
		{name: "service update name", args: []string{"service", "update", "echo"}, want: "service name is required"},
		{name: "service get", args: []string{"service", "get"}, want: "service id is required"},
		{name: "service delete", args: []string{"service", "delete"}, want: "service id is required"},
		{name: "instance usage", args: []string{"instance"}, want: "usage: octobus instance"},
		{name: "instance create id", args: []string{"instance", "create"}, want: "instance id is required"},
		{name: "instance create service", args: []string{"instance", "create", "echo-test"}, want: "service id is required"},
		{name: "instance update id", args: []string{"instance", "update"}, want: "instance id is required"},
		{name: "instance update name", args: []string{"instance", "update", "echo-test"}, want: "instance name is required"},
		{name: "instance update config id", args: []string{"instance", "update-config", "--config-json", `{}`}, want: "instance id is required"},
		{name: "instance update secret id", args: []string{"instance", "update-secret", "--secret-json", `{}`}, want: "instance id is required"},
		{name: "instance start", args: []string{"instance", "start"}, want: "instance id is required"},
		{name: "instance stop", args: []string{"instance", "stop"}, want: "instance id is required"},
		{name: "instance restart", args: []string{"instance", "restart"}, want: "instance id is required"},
		{name: "instance get", args: []string{"instance", "get"}, want: "instance id is required"},
		{name: "instance delete", args: []string{"instance", "delete"}, want: "instance id is required"},
		{name: "capset usage", args: []string{"capset"}, want: "usage: octobus capset"},
		{name: "capset create", args: []string{"capset", "create"}, want: "capset id is required"},
		{name: "capset update id", args: []string{"capset", "update", "--name", "Dev"}, want: "capset id is required"},
		{name: "capset update fields", args: []string{"capset", "update", "dev"}, want: "requires at least one field"},
		{name: "capset add instance capset", args: []string{"capset", "add-instance"}, want: "capset id is required"},
		{name: "capset add instance instance", args: []string{"capset", "add-instance", "dev"}, want: "instance id is required"},
		{name: "capset remove instance capset", args: []string{"capset", "remove-instance"}, want: "capset id is required"},
		{name: "capset remove instance instance", args: []string{"capset", "remove-instance", "dev"}, want: "instance id is required"},
		{name: "capset list instances", args: []string{"capset", "list-instances"}, want: "capset id is required"},
		{name: "capset select method capset", args: []string{"capset", "select-method"}, want: "capset id is required"},
		{name: "capset select method instance", args: []string{"capset", "select-method", "dev"}, want: "instance id is required"},
		{name: "capset select method method", args: []string{"capset", "select-method", "dev", "echo-test"}, want: "method is required"},
		{name: "capset unselect method method", args: []string{"capset", "unselect-method", "dev", "echo-test"}, want: "method is required"},
		{name: "capset list methods", args: []string{"capset", "list-methods"}, want: "capset id is required"},
		{name: "capset add token capset", args: []string{"capset", "add-token"}, want: "capset id is required"},
		{name: "capset add token id", args: []string{"capset", "add-token", "dev"}, want: "token id is required"},
		{name: "capset add token source", args: []string{"capset", "add-token", "dev", "key"}, want: "token source is required"},
		{name: "capset list tokens", args: []string{"capset", "list-tokens"}, want: "capset id is required"},
		{name: "capset remove token capset", args: []string{"capset", "remove-token"}, want: "capset id is required"},
		{name: "capset remove token id", args: []string{"capset", "remove-token", "dev"}, want: "token id is required"},
		{name: "capset get", args: []string{"capset", "get"}, want: "capset id is required"},
		{name: "capset delete", args: []string{"capset", "delete"}, want: "capset id is required"},
		{name: "admin token usage", args: []string{"admin-token"}, want: "usage: octobus admin-token"},
		{name: "admin token add id", args: []string{"admin-token", "add"}, want: "token id is required"},
		{name: "admin token add source", args: []string{"admin-token", "add", "key"}, want: "token source is required"},
		{name: "admin token get", args: []string{"admin-token", "get"}, want: "token id is required"},
		{name: "admin token delete", args: []string{"admin-token", "delete"}, want: "token id is required"},
		{name: "admin token remove", args: []string{"admin-token", "remove"}, want: "token id is required"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var out bytes.Buffer
			c := &CLI{AdminAddr: "127.0.0.1:1", Client: &http.Client{}, Stdout: &out}
			err := c.Run(tc.args)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("args=%v err=%v want %q", tc.args, err, tc.want)
			}
		})
	}
}

func TestOldResourceFlagsAreRejected(t *testing.T) {
	tests := [][]string{
		{"service", "get", "--id", "calculator"},
		{"service", "import", "--id", "calculator", "./examples/calculator-js"},
		{"instance", "restart", "--instance", "calculator-test"},
		{"instance", "create", "--id", "calculator-test", "--service", "calculator"},
		{"instance", "create", "calculator-test", "--service", "calculator", "--start=false"},
		{"capset", "list-methods", "--capset", "dev"},
		{"capset", "select-method", "--capset", "dev", "--instance", "calculator-test", "--method", "/calculator.v1.CalculatorService/Add"},
		{"capset", "add-instance", "dev", "calculator-test", "--all-methods"},
		{"catalog", "--capset", "dev"},
	}
	for _, args := range tests {
		t.Run(strings.Join(args, "_"), func(t *testing.T) {
			c := &CLI{AdminAddr: "127.0.0.1:1", Client: &http.Client{}, Stdout: io.Discard}
			err := c.Run(args)
			if err == nil || !strings.Contains(err.Error(), "unknown flag") {
				t.Fatalf("args=%v err=%v want unknown flag", args, err)
			}
		})
	}
}

func TestCLIHelpUsesFinalCommandShape(t *testing.T) {
	for _, args := range [][]string{
		{"service", "--help"},
		{"service", "import", "--help"},
		{"instance", "restart", "--help"},
		{"capset", "select-method", "--help"},
		{"admin-token", "--help"},
		{"admin-token", "add", "--help"},
		{"catalog", "--help"},
	} {
		t.Run(strings.Join(args, "_"), func(t *testing.T) {
			var out bytes.Buffer
			cmd := (&CLI{}).Command()
			cmd.SetOut(&out)
			cmd.SetArgs(args)
			if err := cmd.Execute(); err != nil {
				t.Fatal(err)
			}
			help := out.String()
			for _, forbidden := range []string{
				"--id",
				"--instance",
				"--capset",
				"--method",
				"--all-methods",
				"--start",
				"Get a instance record",
				"Delete a admin token record",
				"usage: octobus admin-token <add|list|get|remove>",
			} {
				if strings.Contains(help, forbidden) {
					t.Fatalf("help for %v contains %q:\n%s", args, forbidden, help)
				}
			}
			if strings.Join(args, " ") == "service import --help" && strings.Contains(help, "--all") {
				t.Fatalf("service import help contains --all alias:\n%s", help)
			}
		})
	}
}

func TestConfigSourceFileErrors(t *testing.T) {
	var out bytes.Buffer
	c := &CLI{AdminAddr: "127.0.0.1:1", Client: &http.Client{}, Stdout: &out}
	for _, tc := range []struct {
		name string
		args []string
		want string
	}{
		{name: "missing config file", args: []string{"instance", "create", "echo-test", "--service", "echo", "--config", filepath.Join(t.TempDir(), "missing.json"), "--no-start"}, want: "no such file"},
		{name: "missing secret file", args: []string{"instance", "create", "echo-test", "--service", "echo", "--secret", filepath.Join(t.TempDir(), "missing.json"), "--no-start"}, want: "no such file"},
		{name: "invalid config file", args: []string{"instance", "update-config", "echo-test", "--config", writeTempJSON(t, `{bad`)}, want: "invalid --config"},
		{name: "invalid secret file", args: []string{"instance", "update-secret", "echo-test", "--secret", writeTempJSON(t, `{bad`)}, want: "invalid --secret"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := c.Run(tc.args)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("args=%v err=%v want %q", tc.args, err, tc.want)
			}
		})
	}
}

func TestDaemonDownMessage(t *testing.T) {
	var out bytes.Buffer
	c := &CLI{AdminAddr: "127.0.0.1:1", Client: &http.Client{}, Stdout: &out}
	err := c.Run([]string{"status"})
	if err == nil || !strings.Contains(err.Error(), "run `octobus serve` first") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func writeTempJSON(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "payload.json")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}
