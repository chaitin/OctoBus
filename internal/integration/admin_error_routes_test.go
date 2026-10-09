package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"octobus/internal/admin"
	"octobus/internal/domain"
	"octobus/internal/packageimport"
	"octobus/internal/protocol"
	"octobus/internal/store"
	"octobus/internal/supervisor"
)

// Exposing an instance the capset already exposes is refused rather than
// silently replacing the method selection that was made for it.
func TestAdminCapsetInstanceAddIsRejectedTwice(t *testing.T) {
	_, srv, _ := fixtureForErrorRoutes(t)
	postAdmin(t, srv, "/admin/v1/capsets", map[string]any{"id": "second", "name": "Second", "enabled": true})
	postAdmin(t, srv, "/admin/v1/capsets/second/instances", map[string]any{"instance_id": "echo-test"})

	assertAdminStatus(t, srv, http.MethodPost, "/admin/v1/capsets/second/instances", map[string]any{"instance_id": "echo-test"}, http.StatusBadRequest)
	// The capset still exposes the instance exactly once, which is what makes the
	// rejection attributable to the duplicate rather than to any other failure.
	w := assertAdminStatus(t, srv, http.MethodGet, "/admin/v1/capsets/second/instances", nil, http.StatusOK)
	var listing struct {
		Instances []struct {
			InstanceID string
		} `json:"instances"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &listing); err != nil {
		t.Fatal(err)
	}
	if len(listing.Instances) != 1 || listing.Instances[0].InstanceID != "echo-test" {
		t.Fatalf("capset instances=%+v want exactly the one already added", listing.Instances)
	}
}

// A recursive preview streams the same events a real import does, so the CLI can
// report progress for a dry run.
func TestAdminStreamingRecursiveDryRunReportsProgress(t *testing.T) {
	ctx := context.Background()
	srv, _ := newImportServer(t)
	pkg := createRecursiveFixturePackage(t, t.TempDir())

	body, err := json.Marshal(map[string]any{"recursive": true, "source": pkg, "offline": true, "dry_run": true})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/admin/v1/services/import", bytes.NewReader(body))
	req.Header.Set("Accept", "application/x-ndjson")
	w := httptest.NewRecorder()
	srv.Handler().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	stream := w.Body.String()
	for _, want := range []string{`"stage":"validate_manifest"`, `"stage":"preview"`, `"dry_run":true`} {
		if !strings.Contains(stream, want) {
			t.Fatalf("stream=%s want it to contain %s", stream, want)
		}
	}
	if count, err := srv.Store.CountServices(ctx); err != nil || count != 0 {
		t.Fatalf("service count=%d err=%v want nothing committed", count, err)
	}
}

// fixtureForErrorRoutes imports the echo fixture and exposes it through a capset,
// which is the smallest state the admin, Connect and MCP error routes need.
func fixtureForErrorRoutes(t *testing.T) (*store.Store, *admin.Server, *protocol.Gateway) {
	t.Helper()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	imp := &packageimport.Importer{DataDir: dataDir, Store: st}
	sup := supervisor.New(dataDir, st)
	gateway := &protocol.Gateway{Store: st, DataDir: dataDir}
	srv := &admin.Server{Store: st, Importer: imp, Supervisor: sup, Gateway: gateway}

	postAdmin(t, srv, "/admin/v1/services/import", map[string]any{
		"service_id": "echo", "source": createFixturePackage(t, root), "offline": true,
	})
	postAdmin(t, srv, "/admin/v1/instances", map[string]any{
		"id": "echo-test", "service_id": "echo", "config": map[string]any{}, "start": false,
	})
	postAdmin(t, srv, "/admin/v1/capsets", map[string]any{"id": "dev", "name": "DevAgent", "enabled": true})
	postAdmin(t, srv, "/admin/v1/capsets/dev/instances", map[string]any{"instance_id": "echo-test", "all_methods": true})
	return st, srv, gateway
}

// adminResponse performs an admin request and returns the recorder, for the
// cases whose contract is "this fails and says why" rather than one exact status.
func adminResponse(t *testing.T, srv *admin.Server, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(raw)
	} else {
		reader = bytes.NewReader(nil)
	}
	w := httptest.NewRecorder()
	srv.Handler().ServeHTTP(w, httptest.NewRequest(method, path, reader))
	return w
}

// assertAdminStatusWithToken is assertAdminStatus for the routes that need the
// admin token once one exists.
func assertAdminStatusWithToken(t *testing.T, srv *admin.Server, token, method, path string, body any, want int) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, path, reader)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	srv.Handler().ServeHTTP(w, req)
	if w.Code != want {
		t.Fatalf("%s %s status=%d want=%d body=%s", method, path, w.Code, want, w.Body.String())
	}
	return w
}

func TestAdminAdminTokenRoutesRejectInvalidRequests(t *testing.T) {
	_, srv, _ := fixtureForErrorRoutes(t)

	// With no token configured the control plane is open, which is the state a
	// local daemon starts in.
	w := assertAdminStatus(t, srv, http.MethodPost, "/admin/v1/tokens", map[string]any{}, http.StatusBadRequest)
	if !bytes.Contains(w.Body.Bytes(), []byte("token id and token are required")) {
		t.Fatalf("body=%s", w.Body.String())
	}
	postAdmin(t, srv, "/admin/v1/tokens", map[string]any{"id": "ops", "name": "Ops", "token": "ops-secret-value"})

	// The first token flips every admin route to requiring authentication.
	w = assertAdminStatus(t, srv, http.MethodGet, "/admin/v1/tokens", nil, http.StatusUnauthorized)
	if !bytes.Contains(w.Body.Bytes(), []byte("admin token is required")) {
		t.Fatalf("body=%s", w.Body.String())
	}

	// The id identifies the token, so a second one with the same id is refused
	// rather than silently replacing the secret a caller already holds. That the
	// first secret still authenticates is what makes the refusal attributable to
	// the duplicate rather than to anything else.
	assertAdminStatusWithToken(t, srv, "ops-secret-value", http.MethodPost, "/admin/v1/tokens", map[string]any{"id": "ops", "name": "Ops", "token": "other-secret"}, http.StatusBadRequest)
	assertAdminStatusWithToken(t, srv, "ops-secret-value", http.MethodGet, "/admin/v1/capsets", nil, http.StatusOK)
	assertAdminStatusWithToken(t, srv, "other-secret", http.MethodGet, "/admin/v1/capsets", nil, http.StatusUnauthorized)

	assertAdminStatusWithToken(t, srv, "ops-secret-value", http.MethodGet, "/admin/v1/tokens/absent", nil, http.StatusNotFound)
	if w := assertAdminStatusWithToken(t, srv, "ops-secret-value", http.MethodGet, "/admin/v1/tokens/ops", nil, http.StatusOK); !bytes.Contains(w.Body.Bytes(), []byte("ops")) {
		t.Fatalf("body=%s", w.Body.String())
	}
}

func TestAdminUnknownIDsAreReported(t *testing.T) {
	_, srv, _ := fixtureForErrorRoutes(t)

	// Reads answer 404 for an id the store does not have.
	notFound := []struct{ method, path string }{
		{method: http.MethodGet, path: "/admin/v1/services/absent"},
		{method: http.MethodGet, path: "/admin/v1/instances/absent"},
		{method: http.MethodGet, path: "/admin/v1/capsets/absent"},
	}
	for _, tc := range notFound {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			assertAdminStatus(t, srv, tc.method, tc.path, nil, http.StatusNotFound)
		})
	}

	// Writes report a failure as well. The status is asserted as "an error"
	// rather than a specific code on purpose: the handlers pass the store's
	// no-rows error straight through today, which answers 400 carrying the raw
	// `sql: no rows in result set` text. Pinning that would make the obvious fix
	// — a 404 naming the resource, with the SQL text kept out of the response —
	// look like a regression. What has to stay true either way is that the write
	// fails and says why.
	writes := []struct {
		method string
		path   string
		body   any
	}{
		{method: http.MethodPatch, path: "/admin/v1/services/absent", body: map[string]any{"name": "Nope"}},
		{method: http.MethodDelete, path: "/admin/v1/services/absent"},
		{method: http.MethodDelete, path: "/admin/v1/instances/absent"},
		{method: http.MethodDelete, path: "/admin/v1/capsets/absent"},
		{method: http.MethodDelete, path: "/admin/v1/capsets/dev/tokens/absent"},
		{method: http.MethodDelete, path: "/admin/v1/capsets/dev/instances/absent"},
	}
	for _, tc := range writes {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			w := adminResponse(t, srv, tc.method, tc.path, tc.body)
			if w.Code < 400 {
				t.Fatalf("status=%d body=%s want an error", w.Code, w.Body.String())
			}
			if w.Body.Len() == 0 {
				t.Fatal("the write failed without saying why")
			}
		})
	}
}

func TestConnectRejectsUnknownMethodsAndMissingTokens(t *testing.T) {
	st, _, gateway := fixtureForErrorRoutes(t)
	ctx := context.Background()

	t.Run("unknown method is not found", func(t *testing.T) {
		w := httptest.NewRecorder()
		gateway.HandleConnectRPC(w, httptest.NewRequest(http.MethodPost, "/capsets/dev/connect/echo-test/echo.v1.EchoService/Missing", bytes.NewBufferString(`{"text":"x"}`)))
		if w.Code != http.StatusNotFound {
			t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
		}
	})

	t.Run("a capset token is required when the capset has one", func(t *testing.T) {
		if _, err := st.AddCapsetToken(ctx, domain.CapsetToken{ID: "dev-token", CapsetID: "dev", Name: "Dev token"}, "capset-secret-value"); err != nil {
			t.Fatal(err)
		}
		w := httptest.NewRecorder()
		gateway.HandleConnectRPC(w, httptest.NewRequest(http.MethodPost, "/capsets/dev/connect/echo-test/echo.v1.EchoService/Echo", bytes.NewBufferString(`{"text":"x"}`)))
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("status=%d body=%s want 401", w.Code, w.Body.String())
		}
	})
}

func TestMCPRejectsMalformedRequests(t *testing.T) {
	_, _, gateway := fixtureForErrorRoutes(t)
	post := func(t *testing.T, body string) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		gateway.HandleMCP(w, httptest.NewRequest(http.MethodPost, "/capsets/dev/mcp", bytes.NewBufferString(body)))
		if w.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
		}
		return w
	}

	t.Run("params that are not an object are invalid", func(t *testing.T) {
		w := post(t, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":"not-an-object"}`)
		if !bytes.Contains(w.Body.Bytes(), []byte("invalid tools/call params")) {
			t.Fatalf("body=%s", w.Body.String())
		}
	})

	t.Run("an unknown tool is not found", func(t *testing.T) {
		w := post(t, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"absent","arguments":{}}}`)
		if !bytes.Contains(w.Body.Bytes(), []byte("tool not found")) {
			t.Fatalf("body=%s", w.Body.String())
		}
	})

	t.Run("an unknown method is rejected", func(t *testing.T) {
		w := post(t, `{"jsonrpc":"2.0","id":1,"method":"tools/purge"}`)
		var resp struct {
			Error *struct {
				Code int `json:"code"`
			} `json:"error"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
		if resp.Error == nil {
			t.Fatalf("body=%s want a JSON-RPC error", w.Body.String())
		}
	})
}

// A recursive preview walks the same package a real import would and reports what
// it would do, without committing anything.
func TestAdminRecursiveDryRunPreviewsEveryService(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := &admin.Server{Store: st, Importer: &packageimport.Importer{DataDir: dataDir, Store: st}}

	pkg := createRecursiveFixturePackage(t, root)
	w := assertAdminStatus(t, srv, http.MethodPost, "/admin/v1/services/import", map[string]any{
		"recursive": true, "source": pkg, "offline": true, "dry_run": true,
	}, http.StatusOK)
	if !bytes.Contains(w.Body.Bytes(), []byte(`"dry_run":true`)) {
		t.Fatalf("body=%s want a dry run result", w.Body.String())
	}
	if count, err := st.CountServices(ctx); err != nil || count != 0 {
		t.Fatalf("service count=%d err=%v want nothing committed", count, err)
	}
}
