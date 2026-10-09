package integration

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"octobus/internal/accesslog"
	"octobus/internal/admin"
	"octobus/internal/protocol"
	"octobus/internal/store"
)

// newAccessLogServer returns an admin server whose access log is a file the test
// owns, so the endpoint's filtering can be asserted against known records.
func newAccessLogServer(t *testing.T) (*admin.Server, string) {
	t.Helper()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	path := filepath.Join(root, accesslog.FileName)
	return &admin.Server{Store: st, AccessLogPath: path}, path
}

func writeAccessLog(t *testing.T, path string, records ...accesslog.Record) {
	t.Helper()
	var buf bytes.Buffer
	for _, record := range records {
		raw, err := json.Marshal(record)
		if err != nil {
			t.Fatal(err)
		}
		buf.Write(raw)
		buf.WriteByte('\n')
	}
	if err := os.WriteFile(path, buf.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
}

func appendAccessLog(t *testing.T, path string, record accesslog.Record) {
	t.Helper()
	raw, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	appendAccessLogRaw(t, path, string(raw))
}

func appendAccessLogRaw(t *testing.T, path, line string) {
	t.Helper()
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if _, err := f.Write([]byte(line + "\n")); err != nil {
		t.Fatal(err)
	}
}

func accessLogRecord(capset, instance, service, method string) accesslog.Record {
	return accesslog.Record{
		TS:         time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC),
		Protocol:   "connect",
		Capset:     capset,
		Service:    service,
		Instance:   instance,
		Method:     method,
		HTTPStatus: http.StatusOK,
	}
}

func accessLogLines(t *testing.T, body io.Reader) []accesslog.Record {
	t.Helper()
	var out []accesslog.Record
	scanner := bufio.NewScanner(body)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var record accesslog.Record
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatalf("decode access log line %q: %v", line, err)
		}
		out = append(out, record)
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func getAccessLog(t *testing.T, srv *admin.Server, query string) (*httptest.ResponseRecorder, []accesslog.Record) {
	t.Helper()
	w := httptest.NewRecorder()
	srv.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/admin/v1/logs/access"+query, nil))
	if w.Code != http.StatusOK {
		t.Fatalf("GET /admin/v1/logs/access%s status=%d body=%s", query, w.Code, w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); ct != accesslog.ContentType {
		t.Fatalf("GET /admin/v1/logs/access%s content-type=%q want=%q", query, ct, accesslog.ContentType)
	}
	return w, accessLogLines(t, w.Body)
}

func accessLogMethods(records []accesslog.Record) []string {
	out := make([]string, 0, len(records))
	for _, record := range records {
		out = append(out, record.Method)
	}
	return out
}

func TestAccessLogEndpointFiltersLimitAndTail(t *testing.T) {
	srv, path := newAccessLogServer(t)
	writeAccessLog(t, path,
		accessLogRecord("dev", "calc01", "calculator", "Add"),
		accessLogRecord("dev", "calc01", "calculator", "Subtract"),
		accessLogRecord("other", "calc02", "echo", "Echo"),
	)

	cases := []struct {
		name  string
		query string
		want  []string
	}{
		{name: "unfiltered returns every record", query: "", want: []string{"Add", "Subtract", "Echo"}},
		{name: "capset narrows", query: "?capset=dev", want: []string{"Add", "Subtract"}},
		{name: "instance narrows", query: "?instance=calc02", want: []string{"Echo"}},
		{name: "service narrows", query: "?service=echo", want: []string{"Echo"}},
		{name: "filters combine", query: "?capset=dev&instance=calc01&service=calculator", want: []string{"Add", "Subtract"}},
		{name: "unknown capset matches nothing", query: "?capset=absent", want: nil},
		{name: "limit truncates from the start", query: "?limit=1", want: []string{"Add"}},
		// The two zero values mean different things on purpose, and the `logs` flag
		// help says so: --limit 0 returns all, --tail 0 skips existing records.
		{name: "limit zero means unlimited", query: "?limit=0", want: []string{"Add", "Subtract", "Echo"}},
		{name: "tail keeps the newest records in order", query: "?tail=2", want: []string{"Subtract", "Echo"}},
		{name: "tail zero keeps nothing", query: "?tail=0", want: nil},
		{name: "tail larger than the file keeps everything", query: "?tail=9", want: []string{"Add", "Subtract", "Echo"}},
		{name: "limit and filters combine", query: "?capset=dev&limit=1", want: []string{"Add"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, records := getAccessLog(t, srv, tc.query)
			got := accessLogMethods(records)
			if strings.Join(got, ",") != strings.Join(tc.want, ",") {
				t.Fatalf("GET %s methods=%v want=%v", tc.query, got, tc.want)
			}
		})
	}

	t.Run("missing log file reads as empty", func(t *testing.T) {
		empty, err := store.Open(filepath.Join(t.TempDir(), "octobus.db"))
		if err != nil {
			t.Fatal(err)
		}
		defer empty.Close()
		srv := &admin.Server{Store: empty, AccessLogPath: filepath.Join(t.TempDir(), accesslog.FileName)}
		_, records := getAccessLog(t, srv, "")
		if len(records) != 0 {
			t.Fatalf("records=%v want none", records)
		}
	})

	t.Run("path falls back to the gateway data dir", func(t *testing.T) {
		root := t.TempDir()
		writeAccessLog(t, filepath.Join(root, accesslog.FileName), accessLogRecord("dev", "calc01", "calculator", "Add"))
		st, err := store.Open(filepath.Join(root, "data", "octobus.db"))
		if err != nil {
			t.Fatal(err)
		}
		defer st.Close()
		srv := &admin.Server{Store: st, Gateway: &protocol.Gateway{DataDir: root}}
		_, records := getAccessLog(t, srv, "")
		if len(records) != 1 || records[0].Method != "Add" {
			t.Fatalf("records=%v want the gateway data dir log", records)
		}
	})

	t.Run("a malformed record is a server error", func(t *testing.T) {
		root := t.TempDir()
		path := filepath.Join(root, accesslog.FileName)
		if err := os.WriteFile(path, []byte("{\"ts\":\"2026-10-08T12:00:00Z\",\"method\":\"Add\"}\nnot-json\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		st, err := store.Open(filepath.Join(root, "data", "octobus.db"))
		if err != nil {
			t.Fatal(err)
		}
		defer st.Close()
		srv := &admin.Server{Store: st, AccessLogPath: path}
		w := assertAdminStatus(t, srv, http.MethodGet, "/admin/v1/logs/access", nil, http.StatusInternalServerError)
		if !strings.Contains(w.Body.String(), "parse access log line") {
			t.Fatalf("body=%s want the parse failure named", w.Body.String())
		}
	})

	t.Run("unreadable log is a server error", func(t *testing.T) {
		root := t.TempDir()
		// A directory where the log goes opens as a file but cannot be read.
		path := filepath.Join(root, accesslog.FileName)
		if err := os.MkdirAll(path, 0o755); err != nil {
			t.Fatal(err)
		}
		st, err := store.Open(filepath.Join(root, "data", "octobus.db"))
		if err != nil {
			t.Fatal(err)
		}
		defer st.Close()
		srv := &admin.Server{Store: st, AccessLogPath: path}
		assertAdminStatus(t, srv, http.MethodGet, "/admin/v1/logs/access", nil, http.StatusInternalServerError)
	})

	t.Run("unconfigured log path is a server error", func(t *testing.T) {
		st, err := store.Open(filepath.Join(t.TempDir(), "octobus.db"))
		if err != nil {
			t.Fatal(err)
		}
		defer st.Close()
		srv := &admin.Server{Store: st}
		w := assertAdminStatus(t, srv, http.MethodGet, "/admin/v1/logs/access", nil, http.StatusInternalServerError)
		if !strings.Contains(w.Body.String(), "access log path is not configured") {
			t.Fatalf("body=%s", w.Body.String())
		}
	})

	t.Run("invalid query is rejected", func(t *testing.T) {
		cases := []struct {
			query string
			want  string
		}{
			{query: "?limit=", want: "limit must be"},
			{query: "?limit=-1", want: "limit must be"},
			{query: "?limit=abc", want: "limit must be"},
			{query: "?tail=", want: "tail must be"},
			{query: "?tail=-1", want: "tail must be"},
			{query: "?tail=abc", want: "tail must be"},
			{query: "?limit=1&tail=1", want: "mutually exclusive"},
			{query: "?follow=maybe", want: "follow must be true or false"},
		}
		for _, tc := range cases {
			w := assertAdminStatus(t, srv, http.MethodGet, "/admin/v1/logs/access"+tc.query, nil, http.StatusBadRequest)
			if !strings.Contains(w.Body.String(), tc.want) {
				t.Fatalf("GET %s body=%s want %q", tc.query, w.Body.String(), tc.want)
			}
		}
	})

	t.Run("non-GET is rejected", func(t *testing.T) {
		assertAdminStatus(t, srv, http.MethodPost, "/admin/v1/logs/access", nil, http.StatusMethodNotAllowed)
	})
}

func TestAccessLogEndpointFollowStreamsExistingAndNewRecords(t *testing.T) {
	srv, path := newAccessLogServer(t)
	writeAccessLog(t, path,
		accessLogRecord("dev", "calc01", "calculator", "Add"),
		accessLogRecord("other", "calc02", "echo", "Echo"),
	)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	httpSrv := httptest.NewServer(srv.Handler())
	defer httpSrv.Close()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, httpSrv.URL+"/admin/v1/logs/access?follow=true&capset=dev", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := httpSrv.Client().Do(req)
	if err != nil {
		t.Fatalf("follow request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("follow status=%d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != accesslog.ContentType {
		t.Fatalf("follow content-type=%q want=%q", ct, accesslog.ContentType)
	}

	lines := make(chan string, 8)
	go func() {
		defer close(lines)
		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			if line := strings.TrimSpace(scanner.Text()); line != "" {
				lines <- line
			}
		}
		_ = scanner.Err()
	}()
	next := func(want string) {
		t.Helper()
		select {
		case line, ok := <-lines:
			if !ok {
				t.Fatalf("follow stream ended before %q", want)
			}
			if !strings.Contains(line, want) {
				t.Fatalf("follow delivered %q want it to contain %q", line, want)
			}
		case <-time.After(10 * time.Second):
			t.Fatalf("timed out waiting for %q on the follow stream", want)
		}
	}

	// The existing matching records are replayed first; the non-matching capset is
	// filtered out of the replay.
	next(`"method":"Add"`)
	appendAccessLog(t, path, accessLogRecord("dev", "calc01", "calculator", "Subtract"))
	next(`"method":"Subtract"`)

	// A record that cannot be parsed ends the follow with a reported failure
	// rather than silently skipping it — and ends it here, which is why the
	// disconnect path is a test of its own: nothing else closes this stream.
	appendAccessLogRaw(t, path, "not-json")
	next("ACCESS_LOG_FOLLOW_FAILED")
}

// A client that goes away ends the follow rather than leaving the handler
// streaming into a socket nobody reads. Nothing else closes this stream, so the
// assertion can only be satisfied by the disconnect being noticed.
func TestAccessLogEndpointFollowStopsWhenTheClientDisconnects(t *testing.T) {
	srv, path := newAccessLogServer(t)
	writeAccessLog(t, path, accessLogRecord("dev", "calc01", "calculator", "Add"))

	// The handler returning is what the disconnect has to cause, so observe that
	// rather than the client's view of the body: a client that cancelled sees its
	// own body close whether or not the server noticed, which makes an assertion
	// on it pass while the handler streams on into nothing.
	handlerReturned := make(chan struct{})
	httpSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(handlerReturned)
		srv.Handler().ServeHTTP(w, r)
	}))
	// Close only when the test is otherwise passing: Close waits for outstanding
	// requests, so a handler that never returns — the failure this test is for —
	// would make closing hang until the test binary's timeout instead of letting
	// the assertion above report it.
	defer func() {
		if !t.Failed() {
			httpSrv.Close()
		}
	}()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, httpSrv.URL+"/admin/v1/logs/access?follow=true", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := httpSrv.Client().Do(req)
	if err != nil {
		t.Fatalf("follow request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("follow status=%d", resp.StatusCode)
	}

	lines := make(chan string, 4)
	go func() {
		defer close(lines)
		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			if line := strings.TrimSpace(scanner.Text()); line != "" {
				lines <- line
			}
		}
		_ = scanner.Err()
	}()

	// The replay shows the handler is streaming before the client goes away.
	select {
	case line := <-lines:
		if !strings.Contains(line, `"method":"Add"`) {
			t.Fatalf("follow line=%s", line)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the follow stream did not replay the existing log")
	}

	cancel()
	select {
	case <-handlerReturned:
	case <-time.After(10 * time.Second):
		t.Fatal("the follow handler is still streaming after the client disconnected")
	}
}
