package integration

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"octobus/internal/admin"
	"octobus/internal/packageimport"
	"octobus/internal/store"
)

// newImportServer is an admin server with an importer, which is all the import
// routes need to parse and reject a request.
func newImportServer(t *testing.T) (*admin.Server, string) {
	t.Helper()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return &admin.Server{Store: st, Importer: &packageimport.Importer{DataDir: dataDir, Store: st}}, dataDir
}

func postMultipartImport(t *testing.T, srv *admin.Server, parts ...[2]string) (int, string) {
	t.Helper()
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	for _, part := range parts {
		field, err := writer.CreateFormField(part[0])
		if err != nil {
			t.Fatal(err)
		}
		if _, err := field.Write([]byte(part[1])); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/admin/v1/services/import", &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	srv.Handler().ServeHTTP(w, req)
	return w.Code, w.Body.String()
}

// The daemon streams a recursive import and accepts an uploaded package as
// multipart. Both surfaces are reachable by a client that gets the shape wrong,
// and each rejected shape has to name what is missing instead of importing
// something partial.
func TestAdminServiceImportRejectsMalformedUploads(t *testing.T) {
	srv, _ := newImportServer(t)

	options := `{"service_id":"uploaded","source":"client-upload:uploaded-package"}`

	cases := []struct {
		name  string
		parts [][2]string
		want  string
	}{
		{
			name:  "options part is required",
			parts: [][2]string{{"upload_kind", "directory"}, {"package", "data"}},
			want:  "options part is required",
		},
		{
			name:  "upload kind is required",
			parts: [][2]string{{"options", options}, {"package", "data"}},
			want:  "upload_kind field is required",
		},
		{
			name:  "package part is required",
			parts: [][2]string{{"options", options}, {"upload_kind", "directory"}},
			want:  "package part is required",
		},
		{
			name:  "duplicate options are rejected",
			parts: [][2]string{{"options", options}, {"options", options}, {"upload_kind", "directory"}, {"package", "data"}},
			want:  "duplicate options part",
		},
		{
			name:  "duplicate upload kind is rejected",
			parts: [][2]string{{"options", options}, {"upload_kind", "directory"}, {"upload_kind", "directory"}, {"package", "data"}},
			want:  "duplicate upload_kind field",
		},
		{
			name:  "duplicate package is rejected",
			parts: [][2]string{{"options", options}, {"upload_kind", "directory"}, {"package", "data"}, {"package", "data"}},
			want:  "duplicate package part",
		},
		{
			name:  "unknown upload kind is rejected",
			parts: [][2]string{{"options", options}, {"upload_kind", "tarball"}, {"package", "data"}},
			want:  "expected directory, archive, or npm-local",
		},
		{
			name:  "unexpected field is rejected",
			parts: [][2]string{{"options", options}, {"upload_kind", "directory"}, {"package", "data"}, {"extra", "x"}},
			want:  "unexpected multipart service import field",
		},
		{
			name:  "options must decode",
			parts: [][2]string{{"options", `{"service_id":`}, {"upload_kind", "directory"}, {"package", "data"}},
			want:  "decode multipart options",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			code, body := postMultipartImport(t, srv, tc.parts...)
			if code != http.StatusBadRequest {
				t.Fatalf("status=%d body=%s want 400", code, body)
			}
			if !strings.Contains(body, tc.want) {
				t.Fatalf("body=%s want it to contain %q", body, tc.want)
			}
		})
	}
}

// An uploaded package that cannot be unpacked fails the import: committing an
// empty package would leave the daemon with a service whose runtime is missing.
func TestAdminServiceImportRejectsUnpackableUploads(t *testing.T) {
	srv, _ := newImportServer(t)

	// An archive upload is recognised by its extension, so each kind carries its
	// own source name and its own unpacker.
	cases := []struct{ kind, source, want string }{
		{kind: "directory", source: "client-upload:uploaded-package", want: "gzip"},
		{kind: "archive", source: "client-upload:uploaded-package.tgz", want: "gzip"},
		{kind: "archive", source: "client-upload:uploaded-package.zip", want: "zip"},
	}
	for _, tc := range cases {
		t.Run(tc.source, func(t *testing.T) {
			code, body := postMultipartImport(t, srv,
				[2]string{"options", `{"service_id":"uploaded","source":"` + tc.source + `"}`},
				[2]string{"upload_kind", tc.kind},
				[2]string{"package", "this is not an archive"},
			)
			if code != http.StatusBadRequest {
				t.Fatalf("status=%d body=%s want 400", code, body)
			}
			// The body has to be an unpacking failure, not the earlier rejection
			// of a source that is not marked as an upload.
			if !strings.Contains(body, tc.want) {
				t.Fatalf("body=%s want the unpack failure named", body)
			}
		})
	}
}

// tarGzOf builds an archive of the given entries, so an upload can be unpackable
// but still not the package layout the daemon requires.
func tarGzOf(t *testing.T, entries map[string]string) string {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for name, body := range entries {
		if err := tw.WriteHeader(&tar.Header{Name: name, Mode: 0o644, Size: int64(len(body))}); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.String()
}

// An upload that unpacks but does not carry a package root is refused: importing
// it would commit a service with no runtime files.
func TestAdminServiceImportRejectsUploadsWithoutAPackageRoot(t *testing.T) {
	srv, dataDir := newImportServer(t)
	options := `{"service_id":"uploaded","source":"client-upload:uploaded-package"}`

	code, body := postMultipartImport(t, srv,
		[2]string{"options", options},
		[2]string{"upload_kind", "directory"},
		[2]string{"package", tarGzOf(t, map[string]string{"service.json": "{}"})},
	)
	if code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s want 400", code, body)
	}
	if !strings.Contains(body, "package root") {
		t.Fatalf("body=%s want the missing package root named", body)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "artifacts", "services", "uploaded")); !os.IsNotExist(err) {
		t.Fatalf("rejected upload left a service dir behind: %v", err)
	}
}

// A recursive import validates every service in the package before committing
// any of them, including the schema files each one declares.
func TestAdminRecursiveImportRejectsAMissingSchemaFile(t *testing.T) {
	ctx := context.Background()
	srv, _ := newImportServer(t)
	pkg := createRecursiveFixturePackage(t, t.TempDir())
	writeFile(t, filepath.Join(pkg, "vendor__alpha", "service.json"), `{"schema":"chaitin.octobus.service.v1","name":"alpha-service","proto":{"roots":["proto"],"files":["proto/alpha.proto"]},"secretSchema":"secret.schema.json"}`, 0o644)

	w := assertAdminStatus(t, srv, http.MethodPost, "/admin/v1/services/import", map[string]any{
		"recursive": true, "source": pkg, "offline": true,
	}, http.StatusBadRequest)
	if !strings.Contains(w.Body.String(), "secretSchema") {
		t.Fatalf("body=%s want the missing schema named", w.Body.String())
	}

	if count, err := srv.Store.CountServices(ctx); err != nil || count != 0 {
		t.Fatalf("service count=%d err=%v want nothing committed", count, err)
	}
}

func TestAdminRecursiveImportValidatesItsRequest(t *testing.T) {
	root := t.TempDir()
	st, err := store.Open(filepath.Join(root, "data", "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := &admin.Server{Store: st, Importer: &packageimport.Importer{DataDir: filepath.Join(root, "data"), Store: st}}

	cases := []struct {
		name string
		body map[string]any
		want string
	}{
		{name: "source is required", body: map[string]any{"recursive": true}, want: "source is required"},
		{name: "service id is rejected", body: map[string]any{"recursive": true, "source": "/nonexistent", "service_id": "one"}, want: "service_id cannot be used with recursive import"},
		{name: "name is rejected", body: map[string]any{"recursive": true, "source": "/nonexistent", "name": "One"}, want: "name cannot be used with recursive import"},
		// The failure names the source the daemon could not read.
		{name: "unreadable source fails", body: map[string]any{"recursive": true, "source": "/nonexistent/package", "offline": true}, want: "nonexistent/package"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := assertAdminStatus(t, srv, http.MethodPost, "/admin/v1/services/import", tc.body, http.StatusBadRequest)
			if !strings.Contains(w.Body.String(), tc.want) {
				t.Fatalf("body=%s want it to contain %q", w.Body.String(), tc.want)
			}
		})
	}
}

// The schema endpoint returns the schemas a service declares, and reports a
// broken or missing schema file rather than handing a client a truncated form.
func TestAdminServiceSchemaReportsUnreadableSchemaFiles(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := &admin.Server{Store: st, Importer: &packageimport.Importer{DataDir: dataDir, Store: st}}
	postAdmin(t, srv, "/admin/v1/services/import", map[string]any{
		"service_id": "schema", "source": createSchemaFixturePackage(t, root), "offline": true,
	})

	svc, err := st.GetService(ctx, "schema")
	if err != nil {
		t.Fatal(err)
	}
	configPath, secretPath := svc.ConfigSchemaPath, svc.SecretSchemaPath
	if configPath == "" || secretPath == "" {
		t.Fatalf("imported service has no schema paths: config=%q secret=%q", configPath, secretPath)
	}

	w := assertAdminStatus(t, srv, http.MethodGet, "/admin/v1/services/schema/schema", nil, http.StatusOK)
	var body struct {
		Config json.RawMessage `json:"config"`
		Secret json.RawMessage `json:"secret"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(body.Config, []byte("properties")) || !bytes.Contains(body.Secret, []byte("apiToken")) {
		t.Fatalf("schema body=%s want both declared schemas", w.Body.String())
	}

	assertAdminStatus(t, srv, http.MethodGet, "/admin/v1/services/absent/schema", nil, http.StatusNotFound)

	// A schema file that is not JSON, and one that is gone.
	if err := os.WriteFile(configPath, []byte("{"), 0o644); err != nil {
		t.Fatal(err)
	}
	w = assertAdminStatus(t, srv, http.MethodGet, "/admin/v1/services/schema/schema", nil, http.StatusInternalServerError)
	if !strings.Contains(w.Body.String(), "not valid JSON") {
		t.Fatalf("body=%s want an invalid JSON report", w.Body.String())
	}
	if err := os.Remove(configPath); err != nil {
		t.Fatal(err)
	}
	w = assertAdminStatus(t, srv, http.MethodGet, "/admin/v1/services/schema/schema", nil, http.StatusInternalServerError)
	if !strings.Contains(w.Body.String(), "read schema file") {
		t.Fatalf("body=%s want a read failure report", w.Body.String())
	}
	// Restore the config schema so the next failures are the secret schema's.
	if err := os.WriteFile(configPath, []byte(`{"type":"object"}`), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(secretPath, []byte("{"), 0o644); err != nil {
		t.Fatal(err)
	}
	w = assertAdminStatus(t, srv, http.MethodGet, "/admin/v1/services/schema/schema", nil, http.StatusInternalServerError)
	if !strings.Contains(w.Body.String(), "not valid JSON") {
		t.Fatalf("body=%s want an invalid JSON report for the secret schema", w.Body.String())
	}
	if err := os.Remove(secretPath); err != nil {
		t.Fatal(err)
	}
	assertAdminStatus(t, srv, http.MethodGet, "/admin/v1/services/schema/schema", nil, http.StatusInternalServerError)
}
