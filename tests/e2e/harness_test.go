package e2e

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/encoding"
	"google.golang.org/grpc/health"
	grpc_health_v1 "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
	"google.golang.org/protobuf/types/dynamicpb"
)

var repoRoot = findRepoRoot()

func TestMain(m *testing.M) {
	if os.Getenv("OCTOBUS_E2E_HELPER_PROCESS") == "1" {
		runFixtureBackend()
		return
	}
	os.Exit(m.Run())
}

type harness struct {
	t          *testing.T
	root       string
	dataDir    string
	bin        string
	publicAddr string
	cmd        *exec.Cmd
	stdout     bytes.Buffer
	stderr     bytes.Buffer
	client     *http.Client
}

type cliResult struct {
	stdout string
	stderr string
	code   int
	err    error
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	root := t.TempDir()
	h := &harness{
		t:       t,
		root:    root,
		dataDir: filepath.Join(root, "data"),
		bin:     filepath.Join(root, "octobus"),
		client:  &http.Client{Timeout: 10 * time.Second},
	}
	h.publicAddr = freeAddr(t)
	buildArgs := []string{"build", "-trimpath", "-tags", "netgo,osusergo", "-o", h.bin}
	if coverageDir := e2eCoverageDir(); coverageDir != "" {
		if err := os.MkdirAll(coverageDir, 0o755); err != nil {
			t.Fatalf("create e2e coverage dir: %v", err)
		}
		coverpkg := os.Getenv("OCTOBUS_E2E_COVERPKG")
		if coverpkg == "" {
			coverpkg = "./..."
		}
		buildArgs = append(buildArgs, "-cover", "-coverpkg="+coverpkg)
	}
	buildArgs = append(buildArgs, "./cmd/octobus")
	build := exec.Command("go", buildArgs...)
	build.Dir = repoRoot
	build.Env = append(os.Environ(), "CGO_ENABLED=0")
	out, err := build.CombinedOutput()
	if err != nil {
		t.Fatalf("build octobus failed: %v\n%s", err, out)
	}
	h.start()
	t.Cleanup(h.stop)
	return h
}

func e2eCoverageDir() string {
	return os.Getenv("OCTOBUS_E2E_COVERAGE_DIR")
}

func e2eSubprocessEnv(extra ...string) []string {
	env := make([]string, 0, len(os.Environ())+len(extra))
	for _, entry := range os.Environ() {
		if strings.HasPrefix(entry, "GOCOVERDIR=") {
			continue
		}
		env = append(env, entry)
	}
	if coverageDir := e2eCoverageDir(); coverageDir != "" {
		env = append(env, "GOCOVERDIR="+coverageDir)
	}
	return append(env, extra...)
}

func (h *harness) start() {
	h.t.Helper()
	if h.cmd != nil && h.cmd.Process != nil {
		h.t.Fatal("daemon already started")
	}
	h.stdout.Reset()
	h.stderr.Reset()
	cmd := exec.Command(h.bin, "serve", "--data-dir", h.dataDir, "--addr", h.publicAddr)
	cmd.Dir = repoRoot
	cmd.Env = e2eSubprocessEnv("OCTOBUS_E2E_HELPER_BINARY="+os.Args[0], "OCTOBUS_E2E_REPO_ROOT="+repoRoot, "GIT_SSL_NO_VERIFY=true", "NO_PROXY=127.0.0.1,localhost", "no_proxy=127.0.0.1,localhost")
	cmd.Stdout = &h.stdout
	cmd.Stderr = &h.stderr
	if err := cmd.Start(); err != nil {
		h.t.Fatalf("start daemon: %v", err)
	}
	h.cmd = cmd
	h.waitReady()
}

func (h *harness) stop() {
	h.t.Helper()
	if h.cmd == nil || h.cmd.Process == nil {
		return
	}
	_ = h.cmd.Process.Signal(os.Interrupt)
	done := make(chan error, 1)
	go func() { done <- h.cmd.Wait() }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		_ = h.cmd.Process.Kill()
		<-done
	}
	h.cmd = nil
}

func (h *harness) restart() {
	h.t.Helper()
	h.stop()
	h.start()
}

func (h *harness) waitReady() {
	h.t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	var last string
	for time.Now().Before(deadline) {
		resp, err := h.client.Get("http://" + h.publicAddr + "/admin/v1/status")
		if err == nil {
			body, _ := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			last = string(body)
			if resp.StatusCode == http.StatusOK {
				return
			}
		} else {
			last = err.Error()
		}
		time.Sleep(100 * time.Millisecond)
	}
	h.dumpDiagnostics()
	h.t.Fatalf("daemon did not become ready at %s: %s", h.publicAddr, last)
}

func waitForFile(t *testing.T, path string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(path); err == nil {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("file did not appear: %s", path)
}

func (h *harness) runCLI(args ...string) cliResult {
	h.t.Helper()
	return h.runCLIInDir(repoRoot, args...)
}

func (h *harness) runCLIInDir(dir string, args ...string) cliResult {
	h.t.Helper()
	cmd := exec.Command(h.bin, args...)
	cmd.Dir = dir
	cmd.Env = e2eSubprocessEnv("OCTOBUS_ADDR="+h.publicAddr, "OCTOBUS_DATA_DIR="+h.dataDir, "GIT_SSL_NO_VERIFY=true", "NO_PROXY=127.0.0.1,localhost", "no_proxy=127.0.0.1,localhost")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	res := cliResult{stdout: stdout.String(), stderr: stderr.String(), err: err}
	if err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			res.code = exit.ExitCode()
		} else {
			res.code = -1
		}
	}
	return res
}

func (h *harness) mustCLI(args ...string) string {
	h.t.Helper()
	res := h.runCLI(args...)
	if res.err != nil {
		h.dumpDiagnostics()
		h.t.Fatalf("octobus %s failed: code=%d err=%v\nstdout=%s\nstderr=%s", strings.Join(args, " "), res.code, res.err, res.stdout, res.stderr)
	}
	return res.stdout
}

func (h *harness) mustCLIInDir(dir string, args ...string) string {
	h.t.Helper()
	res := h.runCLIInDir(dir, args...)
	if res.err != nil {
		h.dumpDiagnostics()
		h.t.Fatalf("octobus %s in %s failed: code=%d err=%v\nstdout=%s\nstderr=%s", strings.Join(args, " "), dir, res.code, res.err, res.stdout, res.stderr)
	}
	return res.stdout
}

func (h *harness) adminJSON(method, path string, body any, want int, out any) []byte {
	return h.adminJSONWithToken(method, path, body, "", want, out)
}

func (h *harness) adminJSONWithToken(method, path string, body any, token string, want int, out any) []byte {
	h.t.Helper()
	raw := []byte(nil)
	if body != nil {
		var err error
		raw, err = json.Marshal(body)
		if err != nil {
			h.t.Fatal(err)
		}
	}
	req, err := http.NewRequest(method, "http://"+h.publicAddr+path, bytes.NewReader(raw))
	if err != nil {
		h.t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := h.client.Do(req)
	if err != nil {
		h.t.Fatal(err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		h.t.Fatal(err)
	}
	if resp.StatusCode != want {
		h.dumpDiagnostics()
		h.t.Fatalf("%s %s status=%d want=%d body=%s", method, path, resp.StatusCode, want, respBody)
	}
	if out != nil && len(respBody) > 0 {
		if err := json.Unmarshal(respBody, out); err != nil {
			h.t.Fatalf("decode %s %s: %v\n%s", method, path, err, respBody)
		}
	}
	return respBody
}

func (h *harness) publicConnect(path string, body string, want int, out any) []byte {
	h.t.Helper()
	status, respBody, err := h.publicConnectResultWithHeaders(path, body, nil)
	if err != nil {
		h.t.Fatal(err)
	}
	if status != want {
		h.dumpDiagnostics()
		h.t.Fatalf("Connect %s status=%d want=%d body=%s", path, status, want, respBody)
	}
	if out != nil {
		if err := json.Unmarshal(respBody, out); err != nil {
			h.t.Fatalf("decode Connect response: %v\n%s", err, respBody)
		}
	}
	return respBody
}

func (h *harness) publicConnectWithHeaders(path string, body string, headers map[string]string, want int, out any) []byte {
	h.t.Helper()
	status, respBody, err := h.publicConnectResultWithHeaders(path, body, headers)
	if err != nil {
		h.t.Fatal(err)
	}
	if status != want {
		h.dumpDiagnostics()
		h.t.Fatalf("Connect %s status=%d want=%d body=%s", path, status, want, respBody)
	}
	if out != nil {
		if err := json.Unmarshal(respBody, out); err != nil {
			h.t.Fatalf("decode Connect response: %v\n%s", err, respBody)
		}
	}
	return respBody
}

func (h *harness) publicConnectResult(path string, body string) (int, []byte, error) {
	h.t.Helper()
	return h.publicConnectResultWithHeaders(path, body, nil)
}

func (h *harness) publicGET(path string, want int) []byte {
	h.t.Helper()
	resp, err := h.client.Get("http://" + h.publicAddr + path)
	if err != nil {
		h.t.Fatal(err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		h.t.Fatal(err)
	}
	if resp.StatusCode != want {
		h.dumpDiagnostics()
		h.t.Fatalf("GET %s status=%d want=%d body=%s", path, resp.StatusCode, want, respBody)
	}
	return respBody
}

func (h *harness) publicConnectResultWithHeaders(path string, body string, headers map[string]string) (int, []byte, error) {
	h.t.Helper()
	req, err := http.NewRequest(http.MethodPost, "http://"+h.publicAddr+path, strings.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	resp, err := h.client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, nil, err
	}
	return resp.StatusCode, respBody, nil
}

func (h *harness) publicConnectProto(path string, body []byte, want int) []byte {
	h.t.Helper()
	resp, err := h.client.Post("http://"+h.publicAddr+path, "application/proto", bytes.NewReader(body))
	if err != nil {
		h.t.Fatal(err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		h.t.Fatal(err)
	}
	if resp.StatusCode != want {
		h.dumpDiagnostics()
		h.t.Fatalf("Connect proto %s status=%d want=%d body=%s", path, resp.StatusCode, want, respBody)
	}
	return respBody
}

func (h *harness) mcp(body string, out any) []byte {
	h.t.Helper()
	resp, err := h.client.Post("http://"+h.publicAddr+"/capsets/dev/mcp", "application/json", strings.NewReader(body))
	if err != nil {
		h.t.Fatal(err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		h.t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		h.dumpDiagnostics()
		h.t.Fatalf("MCP status=%d body=%s", resp.StatusCode, respBody)
	}
	if out != nil {
		if err := json.Unmarshal(respBody, out); err != nil {
			h.t.Fatalf("decode MCP response: %v\n%s", err, respBody)
		}
	}
	return respBody
}

func (h *harness) grpcInvoke(ctx context.Context, method string, md metadata.MD, req []byte) ([]byte, error) {
	conn, err := h.grpcConn()
	if err != nil {
		h.t.Fatal(err)
	}
	defer conn.Close()
	out := newRawFrame(nil)
	if md != nil {
		ctx = metadata.NewOutgoingContext(ctx, md)
	}
	err = conn.Invoke(ctx, "/"+strings.TrimPrefix(method, "/"), newRawFrame(req), out)
	if err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func (h *harness) grpcConn() (*grpc.ClientConn, error) {
	return grpc.NewClient(h.publicAddr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithDefaultCallOptions(grpc.ForceCodec(rawCodec{})),
		grpc.WithContextDialer(func(ctx context.Context, addr string) (net.Conn, error) {
			d := net.Dialer{}
			return d.DialContext(ctx, "tcp", addr)
		}),
	)
}

func (h *harness) reflectionConn() (*grpc.ClientConn, error) {
	return grpc.NewClient(h.publicAddr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithContextDialer(func(ctx context.Context, addr string) (net.Conn, error) {
			d := net.Dialer{}
			return d.DialContext(ctx, "tcp", addr)
		}),
	)
}

func (h *harness) readDB(query string, args ...any) map[string]string {
	h.t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(h.dataDir, "octobus.db"))
	if err != nil {
		h.t.Fatal(err)
	}
	defer db.Close()
	rows, err := db.Query(query, args...)
	if err != nil {
		h.t.Fatal(err)
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		h.t.Fatal(err)
	}
	if !rows.Next() {
		h.t.Fatalf("query returned no rows: %s", query)
	}
	vals := make([]sql.NullString, len(cols))
	ptrs := make([]any, len(cols))
	for i := range vals {
		ptrs[i] = &vals[i]
	}
	if err := rows.Scan(ptrs...); err != nil {
		h.t.Fatal(err)
	}
	out := map[string]string{}
	for i, col := range cols {
		if vals[i].Valid {
			out[col] = vals[i].String
		}
	}
	return out
}

func (h *harness) waitCatalogRunning() catalog {
	h.t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	var cat catalog
	for time.Now().Before(deadline) {
		h.adminJSON(http.MethodGet, "/admin/v1/catalog/dev?all=true", nil, http.StatusOK, &cat)
		if len(cat.ConnectRPC) > 0 {
			allRunning := true
			for _, item := range cat.ConnectRPC {
				if item.BackendInstanceStatus != "running" {
					allRunning = false
				}
			}
			if allRunning {
				return cat
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	h.dumpDiagnostics()
	h.t.Fatal("catalog backend did not become running")
	return catalog{}
}

func (h *harness) dumpDiagnostics() {
	h.t.Helper()
	h.t.Logf("addr=%s data=%s", h.publicAddr, h.dataDir)
	h.t.Logf("daemon stdout:\n%s", h.stdout.String())
	h.t.Logf("daemon stderr:\n%s", h.stderr.String())
	for _, instance := range []string{"calculator-test", "echo-test", "echo-disabled", "echo-a", "echo-b"} {
		for _, logName := range []string{"stdout.log", "stderr.log", "metadata.json"} {
			path := filepath.Join(h.dataDir, "instances", instance, logName)
			raw, err := os.ReadFile(path)
			if err == nil {
				h.t.Logf("%s/%s:\n%s", instance, logName, raw)
			}
		}
	}
}

type catalog struct {
	CapsetID    string               `json:"capset_id"`
	Name        string               `json:"name"`
	Description string               `json:"description"`
	GRPC        []grpcCatalogItem    `json:"grpc"`
	MCP         []mcpCatalogItem     `json:"mcp"`
	ConnectRPC  []connectCatalogItem `json:"connect_rpc"`
}

type grpcCatalogItem struct {
	ServiceID             string            `json:"service_id"`
	RuntimeMode           string            `json:"runtime_mode"`
	InstanceID            string            `json:"instance_id"`
	MethodFullName        string            `json:"method_full_name"`
	MethodPath            string            `json:"method_path"`
	Metadata              map[string]string `json:"metadata"`
	DescriptorVersion     string            `json:"descriptor_version"`
	DescriptorSHA256      string            `json:"descriptor_sha256"`
	RequestMessageName    string            `json:"request_message_full_name"`
	ResponseMessageName   string            `json:"response_message_full_name"`
	BackendInstanceStatus string            `json:"backend_instance_status"`
}

type mcpCatalogItem struct {
	ServiceID             string `json:"service_id"`
	RuntimeMode           string `json:"runtime_mode"`
	InstanceID            string `json:"instance_id"`
	MethodFullName        string `json:"method_full_name"`
	Endpoint              string `json:"endpoint"`
	ToolName              string `json:"tool_name"`
	DescriptorVersion     string `json:"descriptor_version"`
	DescriptorSHA256      string `json:"descriptor_sha256"`
	RequestMessageName    string `json:"request_message_full_name"`
	ResponseMessageName   string `json:"response_message_full_name"`
	BackendInstanceStatus string `json:"backend_instance_status"`
}

type connectCatalogItem struct {
	ServiceID             string   `json:"service_id"`
	RuntimeMode           string   `json:"runtime_mode"`
	InstanceID            string   `json:"instance_id"`
	MethodFullName        string   `json:"method_full_name"`
	Procedure             string   `json:"procedure"`
	Endpoint              string   `json:"endpoint"`
	OpenAPIURL            string   `json:"openapi_url"`
	HTTPMethod            string   `json:"http_method"`
	ContentTypes          []string `json:"content_types"`
	DescriptorVersion     string   `json:"descriptor_version"`
	DescriptorSHA256      string   `json:"descriptor_sha256"`
	RequestMessageName    string   `json:"request_message_full_name"`
	ResponseMessageName   string   `json:"response_message_full_name"`
	BackendInstanceStatus string   `json:"backend_instance_status"`
}

type fixtureVersion string

const (
	fixtureV1 fixtureVersion = "v1"
	fixtureV2 fixtureVersion = "v2"
)

func createFixturePackage(t *testing.T, root string, version fixtureVersion) string {
	t.Helper()
	pkg := filepath.Join(root, "fixture-"+string(version)+"-"+strconv.FormatInt(time.Now().UnixNano(), 10))
	for _, dir := range []string{filepath.Join(pkg, "proto"), filepath.Join(pkg, "node_modules")} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	entry := filepath.Join(pkg, "bin", "entry")
	if err := os.MkdirAll(filepath.Dir(entry), 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, entry, "#!/bin/sh\nunset GOCOVERDIR\nOCTOBUS_E2E_HELPER_PROCESS=1 OCTOBUS_E2E_FIXTURE_VERSION="+string(version)+" exec \"$OCTOBUS_E2E_HELPER_BINARY\" -- \"$@\"\n", 0o755)
	writeFile(t, filepath.Join(pkg, "package.json"), `{"name":"echo-wrapper","version":"1.0.0","bin":{"echo-wrapper":"bin/entry"}}`, 0o644)
	writeFile(t, filepath.Join(pkg, "service.json"), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","displayName":"Echo Wrapper","proto":{"roots":["proto"],"files":["proto/echo.proto"]},"configSchema":"config.schema.json","secretSchema":"secret.schema.json"}`, 0o644)
	writeFile(t, filepath.Join(pkg, "config.schema.json"), `{"type":"object","required":["token"],"properties":{"token":{"type":"string"},"projectKey":{"type":"string"},"mode":{"type":"string"}}}`, 0o644)
	writeFile(t, filepath.Join(pkg, "secret.schema.json"), `{"type":"object","properties":{"apiToken":{"type":"string"}},"additionalProperties":false}`, 0o644)
	if version == fixtureV2 {
		writeFile(t, filepath.Join(pkg, "proto/echo.proto"), protoV2, 0o644)
	} else {
		writeFile(t, filepath.Join(pkg, "proto/echo.proto"), protoV1, 0o644)
	}
	return pkg
}

func createOnDemandFixturePackage(t *testing.T, root string) string {
	t.Helper()
	return createOnDemandFixturePackageWithTokenPrefix(t, root, "")
}

func createOnDemandFixturePackageWithTokenPrefix(t *testing.T, root, tokenPrefix string) string {
	t.Helper()
	pkg := createFixturePackage(t, root, fixtureV1)
	if strings.ContainsAny(tokenPrefix, " \t\n'\"\\$") {
		t.Fatalf("unsupported token prefix for shell fixture: %q", tokenPrefix)
	}
	env := "OCTOBUS_E2E_HELPER_PROCESS=1 OCTOBUS_E2E_FIXTURE_VERSION=v1"
	if tokenPrefix != "" {
		env += " OCTOBUS_E2E_CONFIG_TOKEN_PREFIX=" + tokenPrefix
	}
	writeFile(t, filepath.Join(pkg, "bin/entry"), "#!/bin/sh\nunset GOCOVERDIR\n"+env+" exec \"$OCTOBUS_E2E_HELPER_BINARY\" -- \"$@\"\n", 0o755)
	writeFile(t, filepath.Join(pkg, "service.json"), `{"schema":"chaitin.octobus.service.v1","name":"echo-wrapper","displayName":"Echo Wrapper","runtime":{"mode":"on-demand"},"proto":{"roots":["proto"],"files":["proto/echo.proto"]},"configSchema":"config.schema.json","secretSchema":"secret.schema.json"}`, 0o644)
	return pkg
}

type gitFixtureRepo struct {
	Server *httptest.Server
	URL    string
	Tags   map[string]string
}

func createHTTPSGitFixtureRepo(t *testing.T, root string, username, password string) gitFixtureRepo {
	t.Helper()
	requireE2EGit(t)
	work := filepath.Join(root, "git-work-"+strconv.FormatInt(time.Now().UnixNano(), 10))
	if err := os.MkdirAll(work, 0o755); err != nil {
		t.Fatal(err)
	}
	e2eGit(t, work, "init", "-b", "main")
	e2eGit(t, work, "config", "user.email", "test@example.com")
	e2eGit(t, work, "config", "user.name", "Test User")

	pkgV1 := createFixturePackage(t, root, fixtureV1)
	copyDirForTest(t, pkgV1, filepath.Join(work, "svc"))
	copyGitDistributionRootForTest(t, pkgV1, work)
	e2eGit(t, work, "add", ".")
	e2eGit(t, work, "commit", "-m", "v1")
	v1 := strings.TrimSpace(e2eGit(t, work, "rev-parse", "HEAD"))
	e2eGit(t, work, "tag", "v1.0.0")

	if err := os.RemoveAll(filepath.Join(work, "svc")); err != nil {
		t.Fatal(err)
	}
	pkgV2 := createFixturePackage(t, root, fixtureV2)
	copyDirForTest(t, pkgV2, filepath.Join(work, "svc"))
	copyGitDistributionRootForTest(t, pkgV2, work)
	e2eGit(t, work, "add", ".")
	e2eGit(t, work, "commit", "-m", "v2")
	v2 := strings.TrimSpace(e2eGit(t, work, "rev-parse", "HEAD"))
	e2eGit(t, work, "tag", "v1.2.0")

	if err := os.RemoveAll(filepath.Join(work, "svc")); err != nil {
		t.Fatal(err)
	}
	pkgRC := createFixturePackage(t, root, fixtureV1)
	copyDirForTest(t, pkgRC, filepath.Join(work, "svc"))
	copyGitDistributionRootForTest(t, pkgRC, work)
	e2eGit(t, work, "add", ".")
	e2eGit(t, work, "commit", "-m", "rc")
	e2eGit(t, work, "tag", "v1.3.0-rc.1")

	bare := filepath.Join(root, "repo-"+strconv.FormatInt(time.Now().UnixNano(), 10)+".git")
	e2eGit(t, root, "clone", "--bare", work, bare)
	server := newE2EGitHTTPServer(t, bare, username, password)
	t.Cleanup(server.Close)
	return gitFixtureRepo{Server: server, URL: server.URL + "/" + filepath.Base(bare), Tags: map[string]string{"v1.0.0": v1, "v1.2.0": v2}}
}

func requireE2EGit(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
}

func e2eGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return string(out)
}

func newE2EGitHTTPServer(t *testing.T, bareRepo, username, password string) *httptest.Server {
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
		writeE2ECGIResponse(t, w, out)
	}))
	srv.EnableHTTP2 = false
	srv.StartTLS()
	return srv
}

func writeE2ECGIResponse(t *testing.T, w http.ResponseWriter, raw []byte) {
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

func copyDirForTest(t *testing.T, src, dst string) {
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

func copyGitDistributionRootForTest(t *testing.T, pkg, work string) {
	t.Helper()
	copyDirForTest(t, filepath.Join(pkg, "bin"), filepath.Join(work, "bin"))
	copyDirForTest(t, filepath.Join(pkg, "node_modules"), filepath.Join(work, "node_modules"))
	copyFileForTest(t, filepath.Join(pkg, "package.json"), filepath.Join(work, "package.json"))
}

func copyFileForTest(t *testing.T, src, dst string) {
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

const protoV1 = `syntax = "proto3";
package echo.v1;

service EchoService {
  rpc Echo(EchoRequest) returns (EchoResponse);
  rpc GetConfig(Empty) returns (ConfigResponse);
  rpc Fail(EchoRequest) returns (EchoResponse);
  rpc ServerStream(EchoRequest) returns (stream EchoResponse);
}

message Empty {}

message EchoRequest {
  string project_id = 1 [json_name = "projectId"];
  string text = 2;
}

message EchoResponse {
  string project_id = 1 [json_name = "projectId"];
  string text = 2;
  string config_token = 3 [json_name = "configToken"];
  string service_id = 4 [json_name = "serviceId"];
  string instance_id = 5 [json_name = "instanceId"];
  string business_request_id = 6 [json_name = "businessRequestId"];
  bool zero_bool = 7 [json_name = "zeroBool"];
}

message ConfigResponse {
  string token = 1;
  string project_key = 2 [json_name = "projectKey"];
  string secret_token = 3 [json_name = "secretToken"];
}
`

const protoV2 = `syntax = "proto3";
package echo.v1;

service EchoService {
  rpc Ping(EchoRequest) returns (EchoResponse);
}

message EchoRequest {
  string project_id = 1 [json_name = "projectId"];
  string text = 2;
}

message EchoResponse {
  string project_id = 1 [json_name = "projectId"];
  string text = 2;
  string config_token = 3 [json_name = "configToken"];
  string service_id = 4 [json_name = "serviceId"];
  string instance_id = 5 [json_name = "instanceId"];
  string business_request_id = 6 [json_name = "businessRequestId"];
  bool zero_bool = 7 [json_name = "zeroBool"];
}
`

func writeFile(t *testing.T, path, body string, mode os.FileMode) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), mode); err != nil {
		t.Fatal(err)
	}
}

func writeJSONFile(t *testing.T, path string, v any) {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
}

func loadDescriptorSet(t *testing.T, path string) *descriptorpb.FileDescriptorSet {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	set := &descriptorpb.FileDescriptorSet{}
	if err := proto.Unmarshal(raw, set); err != nil {
		t.Fatal(err)
	}
	return set
}

func descriptorFiles(t *testing.T, path string) *protoregistry.Files {
	t.Helper()
	files, err := protodesc.NewFiles(loadDescriptorSet(t, path))
	if err != nil {
		t.Fatal(err)
	}
	return files
}

func mustMessage(t *testing.T, files *protoregistry.Files, fullName string) protoreflect.MessageDescriptor {
	t.Helper()
	desc, err := files.FindDescriptorByName(protoreflect.FullName(fullName))
	if err != nil {
		t.Fatal(err)
	}
	msg, ok := desc.(protoreflect.MessageDescriptor)
	if !ok {
		t.Fatalf("%s is not a message", fullName)
	}
	return msg
}

func protoJSONToWire(t *testing.T, msg protoreflect.MessageDescriptor, raw string) []byte {
	t.Helper()
	m := dynamicpb.NewMessage(msg)
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal([]byte(raw), m); err != nil {
		t.Fatal(err)
	}
	out, err := proto.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func wireToMap(t *testing.T, msg protoreflect.MessageDescriptor, raw []byte) map[string]any {
	t.Helper()
	m := dynamicpb.NewMessage(msg)
	if err := proto.Unmarshal(raw, m); err != nil {
		t.Fatal(err)
	}
	js, err := (protojson.MarshalOptions{UseProtoNames: false, EmitUnpopulated: false}).Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err := json.Unmarshal(js, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func runFixtureBackend() {
	args := os.Args
	sep := -1
	for i, arg := range args {
		if arg == "--" {
			sep = i
			break
		}
	}
	if sep < 0 {
		os.Exit(2)
	}
	if sep+2 < len(args) && args[sep+1] == "--runtime" && args[sep+2] == "invoke" {
		runFixtureInvoke(args[sep+3:])
		return
	}
	port, configPath, secretPath, secretFD, workdir, serviceID, instanceID := "", "", "", "", "", "", ""
	for i := sep + 1; i < len(args)-1; i++ {
		switch args[i] {
		case "--port":
			port = args[i+1]
		case "--config":
			configPath = args[i+1]
		case "--secret":
			secretPath = args[i+1]
		case "--secret-fd":
			secretFD = args[i+1]
		case "--workdir":
			workdir = args[i+1]
		case "--service":
			serviceID = args[i+1]
		case "--instance":
			instanceID = args[i+1]
		}
	}
	if _, err := strconv.Atoi(port); err != nil {
		os.Exit(2)
	}
	rawConfig, err := os.ReadFile(configPath)
	if err != nil {
		os.Exit(2)
	}
	var cfg map[string]any
	if err := json.Unmarshal(rawConfig, &cfg); err != nil {
		os.Exit(2)
	}
	secret := map[string]any{}
	if secretPath != "" || secretFD != "" {
		secret, err = readFixtureSecret(secretPath, secretFD)
		if err != nil {
			os.Exit(2)
		}
	}
	ln, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		os.Exit(2)
	}
	srv := grpc.NewServer(grpc.ForceServerCodec(rawCodec{}), grpc.UnknownServiceHandler(func(_ any, stream grpc.ServerStream) error {
		method, _ := grpc.MethodFromServerStream(stream)
		req := newRawFrame(nil)
		if err := stream.RecvMsg(req); err != nil {
			return err
		}
		md, _ := metadata.FromIncomingContext(stream.Context())
		_ = writeMetadata(workdir, md)
		if strings.HasSuffix(method, "/Fail") {
			return status.Error(codes.PermissionDenied, "fixture denied")
		}
		resp, err := fixtureResponse(method, req.Bytes(), cfg, secret, serviceID, instanceID, md)
		if err != nil {
			return err
		}
		return stream.SendMsg(newRawFrame(resp))
	}))
	healthServer := health.NewServer()
	healthServer.SetServingStatus("", grpc_health_v1.HealthCheckResponse_SERVING)
	grpc_health_v1.RegisterHealthServer(srv, healthServer)
	if err := srv.Serve(ln); err != nil && !strings.Contains(err.Error(), "use of closed network connection") {
		os.Exit(1)
	}
}

func runFixtureInvoke(args []string) {
	method, configPath, secretPath, secretFD, metadataPath, workdir, serviceID, instanceID := "", "", "", "", "", "", "", ""
	for i := 0; i < len(args)-1; i++ {
		switch args[i] {
		case "--method":
			method = args[i+1]
		case "--config":
			configPath = args[i+1]
		case "--secret":
			secretPath = args[i+1]
		case "--secret-fd":
			secretFD = args[i+1]
		case "--metadata":
			metadataPath = args[i+1]
		case "--workdir":
			workdir = args[i+1]
		case "--service":
			serviceID = args[i+1]
		case "--instance":
			instanceID = args[i+1]
		}
	}
	cfg, err := readFixtureJSON(configPath)
	if err != nil {
		os.Exit(2)
	}
	secret := map[string]any{}
	if secretPath != "" || secretFD != "" {
		secret, err = readFixtureSecret(secretPath, secretFD)
		if err != nil {
			os.Exit(2)
		}
	}
	md, err := readFixtureMetadata(metadataPath)
	if err != nil {
		os.Exit(2)
	}
	req, err := io.ReadAll(os.Stdin)
	if err != nil {
		os.Exit(2)
	}
	if vals := md.Get("x-started-file"); len(vals) > 0 {
		marker := vals[0]
		if !filepath.IsAbs(marker) && workdir != "" {
			marker = filepath.Join(workdir, marker)
		}
		_ = os.WriteFile(marker, []byte("started"), 0o600)
	}
	if vals := md.Get("x-sleep-ms"); len(vals) > 0 {
		if ms, err := strconv.Atoi(vals[0]); err == nil && ms > 0 {
			time.Sleep(time.Duration(ms) * time.Millisecond)
		}
	}
	if strings.HasSuffix(method, "/Fail") {
		fmt.Fprintln(os.Stderr, `OCTOBUS_ERROR:{"code":"PERMISSION_DENIED","message":"fixture denied"}`)
		os.Exit(7)
	}
	resp, err := fixtureResponse("/"+method, req, cfg, secret, serviceID, instanceID, md)
	if err != nil {
		fmt.Fprintf(os.Stderr, "OCTOBUS_ERROR:%s\n", `{"code":"INTERNAL","message":"fixture invoke failed"}`)
		os.Exit(8)
	}
	if _, err := os.Stdout.Write(resp); err != nil {
		os.Exit(1)
	}
}

func readFixtureJSON(path string) (map[string]any, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	out := map[string]any{}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func readFixtureSecret(pathValue, fdValue string) (map[string]any, error) {
	if pathValue != "" {
		return readFixtureJSON(pathValue)
	}
	fd, err := strconv.Atoi(fdValue)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), "secret-fd")
	if file == nil {
		return nil, fmt.Errorf("invalid secret fd %d", fd)
	}
	defer file.Close()
	raw, err := io.ReadAll(file)
	if err != nil {
		return nil, err
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func readFixtureMetadata(path string) (metadata.MD, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	values := map[string][]string{}
	if err := json.Unmarshal(raw, &values); err != nil {
		return nil, err
	}
	return metadata.MD(values), nil
}

func fixtureResponse(method string, req []byte, cfg, secret map[string]any, serviceID, instanceID string, md metadata.MD) ([]byte, error) {
	version := fixtureVersion(os.Getenv("OCTOBUS_E2E_FIXTURE_VERSION"))
	configToken := os.Getenv("OCTOBUS_E2E_CONFIG_TOKEN_PREFIX") + fmt.Sprint(cfg["token"])
	var protoText string
	if version == fixtureV2 {
		protoText = protoV2
	} else {
		protoText = protoV1
	}
	tmp, err := os.MkdirTemp("", "octobus-e2e-proto-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp)
	protoPath := filepath.Join(tmp, "echo.proto")
	if err := os.WriteFile(protoPath, []byte(protoText), 0o644); err != nil {
		return nil, err
	}
	descPath := filepath.Join(tmp, "echo.protoset")
	cmd := exec.Command("protoc", "--include_imports", "--descriptor_set_out="+descPath, "-I"+tmp, protoPath)
	if out, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("fixture protoc: %w: %s", err, out)
	}
	rawDesc, err := os.ReadFile(descPath)
	if err != nil {
		return nil, err
	}
	set := &descriptorpb.FileDescriptorSet{}
	if err := proto.Unmarshal(rawDesc, set); err != nil {
		return nil, err
	}
	files, err := protodesc.NewFiles(set)
	if err != nil {
		return nil, err
	}
	if strings.HasSuffix(method, "/GetConfig") {
		respDesc, _ := files.FindDescriptorByName("echo.v1.ConfigResponse")
		resp := dynamicpb.NewMessage(respDesc.(protoreflect.MessageDescriptor))
		resp.Set(resp.Descriptor().Fields().ByName("token"), protoreflect.ValueOfString(configToken))
		if v, ok := cfg["projectKey"].(string); ok {
			resp.Set(resp.Descriptor().Fields().ByName("project_key"), protoreflect.ValueOfString(v))
		}
		if v, ok := secret["apiToken"].(string); ok {
			resp.Set(resp.Descriptor().Fields().ByName("secret_token"), protoreflect.ValueOfString(v))
		}
		return proto.Marshal(resp)
	}
	reqDesc, _ := files.FindDescriptorByName("echo.v1.EchoRequest")
	reqMsg := dynamicpb.NewMessage(reqDesc.(protoreflect.MessageDescriptor))
	if err := proto.Unmarshal(req, reqMsg); err != nil {
		return nil, err
	}
	respDesc, _ := files.FindDescriptorByName("echo.v1.EchoResponse")
	resp := dynamicpb.NewMessage(respDesc.(protoreflect.MessageDescriptor))
	fields := resp.Descriptor().Fields()
	resp.Set(fields.ByName("project_id"), reqMsg.Get(reqMsg.Descriptor().Fields().ByName("project_id")))
	resp.Set(fields.ByName("text"), reqMsg.Get(reqMsg.Descriptor().Fields().ByName("text")))
	resp.Set(fields.ByName("config_token"), protoreflect.ValueOfString(configToken))
	resp.Set(fields.ByName("service_id"), protoreflect.ValueOfString(serviceID))
	resp.Set(fields.ByName("instance_id"), protoreflect.ValueOfString(instanceID))
	if vals := md.Get("x-octobus-ext-business-request-id"); len(vals) > 0 {
		resp.Set(fields.ByName("business_request_id"), protoreflect.ValueOfString(vals[0]))
	} else if vals := md.Get("x-business-request-id"); len(vals) > 0 {
		resp.Set(fields.ByName("business_request_id"), protoreflect.ValueOfString(vals[0]))
	}
	return proto.Marshal(resp)
}

func writeMetadata(workdir string, md metadata.MD) error {
	out := map[string][]string{}
	for k, vals := range md {
		out[k] = vals
	}
	raw, err := json.Marshal(out)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(workdir, "metadata.json"), raw, 0o600)
}

type rawFrame []byte

func newRawFrame(b []byte) *rawFrame { f := rawFrame(b); return &f }
func (f *rawFrame) Reset()           { *f = (*f)[:0] }
func (f *rawFrame) String() string   { return base64.StdEncoding.EncodeToString(*f) }
func (f *rawFrame) ProtoMessage()    {}
func (f *rawFrame) Bytes() []byte    { return []byte(*f) }

type rawCodec struct{}

func (rawCodec) Name() string { return "proto" }
func (rawCodec) Marshal(v any) ([]byte, error) {
	switch x := v.(type) {
	case *rawFrame:
		return x.Bytes(), nil
	case rawFrame:
		return []byte(x), nil
	case proto.Message:
		return proto.Marshal(x)
	default:
		return nil, fmt.Errorf("unsupported marshal type %T", v)
	}
}
func (rawCodec) Unmarshal(data []byte, v any) error {
	switch x := v.(type) {
	case *rawFrame:
		*x = append((*x)[:0], data...)
		return nil
	case proto.Message:
		return proto.Unmarshal(data, x)
	default:
		return fmt.Errorf("unsupported unmarshal type %T", v)
	}
}

var _ encoding.Codec = rawCodec{}

func freeAddr(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	return ln.Addr().String()
}

func fileMode(t *testing.T, path string) os.FileMode {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return info.Mode().Perm()
}

func findRepoRoot() string {
	if v := os.Getenv("OCTOBUS_E2E_REPO_ROOT"); v != "" {
		return v
	}
	if os.Getenv("OCTOBUS_E2E_HELPER_PROCESS") == "1" {
		return ""
	}
	dir, err := os.Getwd()
	if err != nil {
		panic(err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			panic("repo root not found")
		}
		dir = parent
	}
}

func hasTool(tools []any, name string) bool {
	for _, tool := range tools {
		m, ok := tool.(map[string]any)
		if ok && m["name"] == name {
			return true
		}
	}
	return false
}

func findTool(t *testing.T, tools []any, name string) map[string]any {
	t.Helper()
	for _, tool := range tools {
		m, ok := tool.(map[string]any)
		if ok && m["name"] == name {
			return m
		}
	}
	t.Fatalf("tool %q not found in %+v", name, tools)
	return nil
}

func assertToolInputProperty(t *testing.T, schema map[string]any, name, wantType string) {
	t.Helper()
	properties, ok := schema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("input schema properties missing: %+v", schema)
	}
	rawProperty, ok := properties[name]
	if !ok {
		t.Fatalf("input schema property %q missing: %+v", name, properties)
	}
	property, ok := rawProperty.(map[string]any)
	if !ok {
		t.Fatalf("input schema property %q has unexpected shape: %+v", name, rawProperty)
	}
	if gotType := property["type"]; gotType != wantType {
		t.Fatalf("input schema property %q type=%v want %s", name, gotType, wantType)
	}
}

func assertStatusCode(t *testing.T, err error, code codes.Code) {
	t.Helper()
	st, ok := status.FromError(err)
	if !ok || st.Code() != code {
		t.Fatalf("status=%v want=%s err=%v", st.Code(), code, err)
	}
}
