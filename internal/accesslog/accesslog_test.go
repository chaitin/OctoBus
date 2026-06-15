package accesslog

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestOpenAppendCreatesPrivateNDJSON(t *testing.T) {
	dir := t.TempDir()
	logger, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := logger.Append(Record{
		TS:         time.Date(2026, 6, 10, 10, 15, 30, 123000000, time.FixedZone("offset", 8*60*60)),
		Protocol:   "connect",
		Capset:     "dev",
		Service:    "calculator",
		Instance:   "calculator-test",
		Method:     "calculator.v1.CalculatorService/Add",
		Route:      "/capsets/dev/connect/calculator-test/calculator.v1.CalculatorService/Add",
		HTTPMethod: "POST",
		HTTPStatus: httpStatusOK,
		GRPCCode:   "OK",
		DurationMS: 12,
		RemoteAddr: "127.0.0.1:54321",
		UserAgent:  "curl/8.5.0",
	}); err != nil {
		t.Fatal(err)
	}
	if err := logger.Close(); err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(dir, FileName)
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("mode=%#o want 0600", got)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSuffix(string(raw), "\n"), "\n")
	if len(lines) != 1 {
		t.Fatalf("lines=%d raw=%q", len(lines), raw)
	}
	var got Record
	if err := json.Unmarshal([]byte(lines[0]), &got); err != nil {
		t.Fatal(err)
	}
	if got.TS.Location() != time.UTC {
		t.Fatalf("timestamp location=%v want UTC", got.TS.Location())
	}
	if got.Protocol != "connect" || got.Capset != "dev" || got.HTTPStatus != httpStatusOK || got.GRPCCode != "OK" {
		t.Fatalf("unexpected record=%+v", got)
	}
}

func TestAppendConcurrentWritesAreLineSafe(t *testing.T) {
	dir := t.TempDir()
	logger, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := logger.Append(Record{Protocol: "mcp", Capset: "dev", HTTPStatus: httpStatusOK}); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if err := logger.Close(); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, FileName))
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSuffix(string(raw), "\n"), "\n")
	if len(lines) != 100 {
		t.Fatalf("lines=%d", len(lines))
	}
	for _, line := range lines {
		var record Record
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatalf("invalid line %q: %v", line, err)
		}
	}
}

func TestFilterLinesByFieldsAndLimits(t *testing.T) {
	input := strings.Join([]string{
		`{"capset":"dev","instance":"one","service":"calc","method":"A"}`,
		`{"capset":"dev","instance":"two","service":"calc","method":"B"}`,
		`{"capset":"qa","instance":"one","service":"calc","method":"C"}`,
		`{"capset":"dev","instance":"one","service":"echo","method":"D"}`,
	}, "\n") + "\n"

	var out bytes.Buffer
	err := FilterLines(strings.NewReader(input), Filter{Capset: "dev", Instance: "one", Service: "calc", Limit: 0, LimitSet: true}, &out)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.TrimSpace(out.String()); got != `{"capset":"dev","instance":"one","service":"calc","method":"A"}` {
		t.Fatalf("filtered=%q", got)
	}

	out.Reset()
	if err := FilterLines(strings.NewReader(input), Filter{Capset: "dev", Limit: 2, LimitSet: true}, &out); err != nil {
		t.Fatal(err)
	}
	if got := strings.Count(out.String(), "\n"); got != 2 {
		t.Fatalf("limit count=%d body=%q", got, out.String())
	}

	out.Reset()
	if err := FilterLines(strings.NewReader(input), Filter{Capset: "dev", Tail: 2, TailSet: true}, &out); err != nil {
		t.Fatal(err)
	}
	want := strings.Join([]string{
		`{"capset":"dev","instance":"two","service":"calc","method":"B"}`,
		`{"capset":"dev","instance":"one","service":"echo","method":"D"}`,
	}, "\n") + "\n"
	if got := out.String(); got != want {
		t.Fatalf("tail output=%q want=%q", got, want)
	}

	out.Reset()
	if err := FilterLines(strings.NewReader(input), Filter{Capset: "dev", Tail: 0, TailSet: true}, &out); err != nil {
		t.Fatal(err)
	}
	if out.Len() != 0 {
		t.Fatalf("tail 0 output=%q", out.String())
	}
}

func TestFilterLinesDefaultLimitAndAll(t *testing.T) {
	var b strings.Builder
	for i := 0; i < DefaultLimit+5; i++ {
		b.WriteString(`{"capset":"dev"}` + "\n")
	}
	var out bytes.Buffer
	if err := FilterLines(strings.NewReader(b.String()), Filter{}, &out); err != nil {
		t.Fatal(err)
	}
	if got := strings.Count(out.String(), "\n"); got != DefaultLimit {
		t.Fatalf("default limit count=%d want %d", got, DefaultLimit)
	}

	out.Reset()
	if err := FilterLines(strings.NewReader(b.String()), Filter{Limit: 0, LimitSet: true}, &out); err != nil {
		t.Fatal(err)
	}
	if got := strings.Count(out.String(), "\n"); got != DefaultLimit+5 {
		t.Fatalf("all limit count=%d", got)
	}
}

func TestReadFileEmptyMissingAndInvalidLimit(t *testing.T) {
	dir := t.TempDir()
	var out bytes.Buffer
	if err := ReadFile(filepath.Join(dir, "missing.log"), Filter{Limit: -1, LimitSet: true}, &out); err == nil {
		t.Fatal("expected invalid read limit error")
	}
	if err := ReadFile(filepath.Join(dir, "missing.log"), Filter{}, &out); err != nil {
		t.Fatal(err)
	}
	if out.Len() != 0 {
		t.Fatalf("missing output=%q", out.String())
	}
	path := filepath.Join(dir, FileName)
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := ReadFile(path, Filter{}, &out); err != nil {
		t.Fatal(err)
	}
	if err := FilterLines(strings.NewReader(""), Filter{Limit: -1, LimitSet: true}, &out); err == nil {
		t.Fatal("expected invalid limit error")
	}
	if err := FilterLines(strings.NewReader(""), Filter{Tail: -1, TailSet: true}, &out); err == nil {
		t.Fatal("expected invalid tail error")
	}
	if err := FilterLines(strings.NewReader(""), Filter{Limit: 1, LimitSet: true, Tail: 1, TailSet: true}, &out); err == nil {
		t.Fatal("expected limit tail conflict error")
	}
}

func TestNilLoggerCloseAppendAreNoops(t *testing.T) {
	var logger *Logger
	if err := logger.Close(); err != nil {
		t.Fatal(err)
	}
	if err := logger.Append(Record{Protocol: "grpc"}); err != nil {
		t.Fatal(err)
	}

	logger = &Logger{}
	if err := logger.Close(); err != nil {
		t.Fatal(err)
	}
	if err := logger.Append(Record{Protocol: "grpc"}); err != nil {
		t.Fatal(err)
	}
}

func TestAppendReturnsMarshalAndWriteErrors(t *testing.T) {
	dir := t.TempDir()
	logger, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := logger.Append(Record{TS: time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)}); err == nil {
		t.Fatal("expected marshal error")
	}
	if err := logger.Close(); err != nil {
		t.Fatal(err)
	}
	if err := logger.Append(Record{Protocol: "grpc"}); err == nil {
		t.Fatal("expected write error")
	}
}

func TestOpenReturnsCreateError(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "not-a-dir")
	if err := os.WriteFile(filePath, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(filePath); err == nil {
		t.Fatal("expected open error")
	}
}

func TestFilterLinesErrors(t *testing.T) {
	tests := []struct {
		name   string
		input  string
		filter Filter
		writer func() *errorWriter
	}{
		{
			name:  "invalid json",
			input: "{not-json}\n",
		},
		{
			name:   "line write error",
			input:  `{"capset":"dev"}` + "\n",
			writer: func() *errorWriter { return &errorWriter{failOn: 1} },
		},
		{
			name:   "newline write error",
			input:  `{"capset":"dev"}` + "\n",
			writer: func() *errorWriter { return &errorWriter{failOn: 2} },
		},
		{
			name:   "tail line write error",
			input:  `{"capset":"dev"}` + "\n",
			filter: Filter{Tail: 1, TailSet: true},
			writer: func() *errorWriter { return &errorWriter{failOn: 1} },
		},
		{
			name:   "tail newline write error",
			input:  `{"capset":"dev"}` + "\n",
			filter: Filter{Tail: 1, TailSet: true},
			writer: func() *errorWriter { return &errorWriter{failOn: 2} },
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var out bytes.Buffer
			var w interface{ Write([]byte) (int, error) } = &out
			if tt.writer != nil {
				w = tt.writer()
			}
			if err := FilterLines(strings.NewReader(tt.input), tt.filter, w); err == nil {
				t.Fatal("expected error")
			}
		})
	}
}

func TestFilterLinesSkipsBlankLines(t *testing.T) {
	var out bytes.Buffer
	if err := FilterLines(strings.NewReader("\n"+`{"capset":"dev"}`+"\n"), Filter{}, &out); err != nil {
		t.Fatal(err)
	}
	if got := out.String(); got != `{"capset":"dev"}`+"\n" {
		t.Fatalf("output=%q", got)
	}
}

func TestFilterLinesScannerError(t *testing.T) {
	var out bytes.Buffer
	if err := FilterLines(errorReader{}, Filter{}, &out); !errors.Is(err, errReadFailed) {
		t.Fatalf("error=%v want %v", err, errReadFailed)
	}
}

func TestFollowFileStreamsAppendedMatchingLines(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, FileName)
	initial := strings.Join([]string{
		`{"capset":"dev","method":"old-one"}`,
		`{"capset":"qa","method":"old-two"}`,
		`{"capset":"dev","method":"old-three"}`,
	}, "\n") + "\n"
	if err := os.WriteFile(path, []byte(initial), 0o600); err != nil {
		t.Fatal(err)
	}

	done := make(chan struct{})
	var out safeBuffer
	errc := make(chan error, 1)
	go func() {
		errc <- FollowFile(path, Filter{Capset: "dev", Tail: 1, TailSet: true, Follow: true}, &out, done)
	}()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if strings.Contains(out.String(), "old-three") {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got := out.String(); !strings.Contains(got, "old-three") || strings.Contains(got, "old-one") {
		close(done)
		t.Fatalf("initial tail output=%q", got)
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		close(done)
		t.Fatal(err)
	}
	if _, err := f.WriteString(`{"capset":"qa","method":"skip"}` + "\n"); err != nil {
		close(done)
		t.Fatal(err)
	}
	if _, err := f.WriteString(`{"capset":"dev","method":"new"}` + "\n"); err != nil {
		close(done)
		t.Fatal(err)
	}
	_ = f.Close()

	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if strings.Contains(out.String(), `"method":"new"`) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	close(done)
	if err := <-errc; err != nil {
		t.Fatal(err)
	}
	got := out.String()
	if !strings.Contains(got, `"method":"new"`) || strings.Contains(got, `"method":"skip"`) {
		t.Fatalf("follow output=%q", got)
	}
}

func TestFollowFileValidationAndInitialErrors(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, FileName)
	var out bytes.Buffer
	done := make(chan struct{})
	close(done)

	if err := FollowFile(path, Filter{Limit: -1, LimitSet: true}, &out, done); err == nil {
		t.Fatal("expected invalid limit error")
	}
	if err := FollowFile(path, Filter{Tail: -1, TailSet: true}, &out, done); err == nil {
		t.Fatal("expected invalid tail error")
	}
	if err := FollowFile(filepath.Join(dir, "missing.log"), Filter{}, &out, done); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(path, []byte("{bad-json}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := FollowFile(path, Filter{}, &out, done); err == nil {
		t.Fatal("expected initial filter error")
	}
}

func TestFollowFileFlushesInitialOutput(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, FileName)
	if err := os.WriteFile(path, []byte(`{"capset":"dev"}`+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	close(done)
	out := &flushBuffer{}
	if err := FollowFile(path, Filter{}, out, done); err != nil {
		t.Fatal(err)
	}
	if out.flushes != 1 {
		t.Fatalf("flushes=%d want 1", out.flushes)
	}
}

func TestReadNextLineReturnsReadError(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, FileName)
	if err := os.WriteFile(path, []byte("partial"), 0o600); err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := readNextLine(f, make(chan struct{})); err == nil {
		t.Fatal("expected read error")
	}
}

const httpStatusOK = 200

var (
	errReadFailed  = errors.New("read failed")
	errWriteFailed = errors.New("write failed")
)

type errorReader struct{}

func (errorReader) Read([]byte) (int, error) {
	return 0, errReadFailed
}

type errorWriter struct {
	writes int
	failOn int
}

func (w *errorWriter) Write(p []byte) (int, error) {
	w.writes++
	if w.writes == w.failOn {
		return 0, errWriteFailed
	}
	return len(p), nil
}

type safeBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (b *safeBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.Write(p)
}

func (b *safeBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.String()
}

type flushBuffer struct {
	bytes.Buffer
	flushes int
}

func (b *flushBuffer) Flush() {
	b.flushes++
}
