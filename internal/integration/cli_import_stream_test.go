package integration

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"octobus/internal/cli"
)

// stubImportStream answers an import with the given ndjson events, which is the
// shape the daemon streams for a recursive or long import.
func stubImportStream(t *testing.T, events ...string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/admin/v1/services/import" {
			t.Errorf("unexpected admin path %s", r.URL.Path)
		}
		if got := r.Header.Get("Accept"); got != "application/x-ndjson" {
			t.Errorf("Accept=%q want the stream content type", got)
		}
		w.Header().Set("Content-Type", "application/x-ndjson")
		w.WriteHeader(http.StatusOK)
		for _, event := range events {
			if _, err := w.Write([]byte(event + "\n")); err != nil {
				return
			}
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func runImportAgainstStream(t *testing.T, events ...string) (string, string, error) {
	t.Helper()
	srv := stubImportStream(t, events...)
	var stdout, stderr bytes.Buffer
	c := &cli.CLI{
		AdminAddr: strings.TrimPrefix(srv.URL, "http://"),
		Client:    srv.Client(),
		Stdout:    &stdout,
		Stderr:    &stderr,
	}
	err := c.Run([]string{
		"service", "import", "echo", "https://example.invalid/echo.git",
		"--source-mode", "remote", "--offline",
	})
	return stdout.String(), stderr.String(), err
}

func TestCLIServiceImportStreamReportsProgress(t *testing.T) {
	stdout, stderr, err := runImportAgainstStream(t,
		`{"type":"status","stage":"prepare_source","message":"Preparing service package","service_id":"echo"}`,
		`{"type":"progress","stage":"prepare_runtime"}`,
		`{"type":"progress"}`,
		`{"type":"complete","status":"ok","service_id":"echo","manifest":"{}"}`,
	)
	if err != nil {
		t.Fatalf("err=%v stderr=%s", err, stderr)
	}
	if !strings.Contains(stderr, "Preparing service package") {
		t.Fatalf("stderr=%q want the status message", stderr)
	}
	// A progress event with no message falls back to its stage, and one with
	// neither prints nothing rather than an empty line.
	if !strings.Contains(stderr, "prepare_runtime") {
		t.Fatalf("stderr=%q want the stage as the fallback message", stderr)
	}
	if got := strings.Count(strings.TrimSpace(stderr), "\n"); got != 1 {
		t.Fatalf("stderr=%q want exactly the two labelled lines", stderr)
	}
	var body map[string]any
	if err := json.Unmarshal([]byte(strings.TrimSpace(stdout)), &body); err != nil {
		t.Fatalf("stdout=%q is not the completion JSON: %v", stdout, err)
	}
	// The completion printer drops the stream bookkeeping fields and keeps the
	// payload, so the manifest is what reaches the caller.
	if body["manifest"] != "{}" {
		t.Fatalf("completion body=%v want the manifest payload", body)
	}
	if _, ok := body["service_id"]; ok {
		t.Fatalf("completion body=%v kept a stream bookkeeping field", body)
	}
}

func TestCLIServiceImportStreamFailures(t *testing.T) {
	cases := []struct {
		name   string
		events []string
		want   string
		stderr string
	}{
		{
			name:   "error event carries the failure",
			events: []string{`{"type":"error","error":"import blew up"}`},
			want:   "import blew up",
		},
		{
			name:   "error event without a message still fails",
			events: []string{`{"type":"error"}`},
			want:   "service import failed",
		},
		{
			name:   "unknown event type is rejected",
			events: []string{`{"type":"unexpected"}`},
			want:   `unknown service import stream event type "unexpected"`,
		},
		{
			name:   "stream ending without a completion fails",
			events: []string{`{"type":"status","stage":"prepare_source"}`},
			want:   "ended without a complete event",
		},
		{
			name:   "malformed event line fails",
			events: []string{`{"type":`},
			want:   "unexpected",
		},
		{
			name:   "degraded completion fails",
			events: []string{`{"type":"complete","status":"degraded","service_id":"echo"}`},
			want:   "degraded",
		},
		{
			name:   "dry run completion announces the preview",
			events: []string{`{"type":"complete","status":"ok","dry_run":true,"service_id":"echo"}`},
			want:   "",
			stderr: "dry run: nothing was imported and no instances were restarted",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, stderr, err := runImportAgainstStream(t, tc.events...)
			if tc.want == "" {
				if err != nil {
					t.Fatalf("err=%v stderr=%s", err, stderr)
				}
			} else if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err=%v want it to contain %q", err, tc.want)
			}
			if tc.stderr != "" && !strings.Contains(stderr, tc.stderr) {
				t.Fatalf("stderr=%q want it to contain %q", stderr, tc.stderr)
			}
		})
	}
}
