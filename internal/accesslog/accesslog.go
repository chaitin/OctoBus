package accesslog

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	FileName               = "access.log"
	ContentType            = "application/x-ndjson"
	DefaultLimit           = 200
	MaxFilterEntries       = 10_000
	MaxResponseBytes int64 = 64 << 20
)

type Record struct {
	TS         time.Time `json:"ts"`
	Protocol   string    `json:"protocol"`
	Capset     string    `json:"capset"`
	Service    string    `json:"service"`
	Instance   string    `json:"instance"`
	Method     string    `json:"method"`
	Tool       string    `json:"tool"`
	Route      string    `json:"route"`
	HTTPMethod string    `json:"http_method"`
	HTTPStatus int       `json:"http_status"`
	GRPCCode   string    `json:"grpc_code"`
	DurationMS int64     `json:"duration_ms"`
	RemoteAddr string    `json:"remote_addr"`
	UserAgent  string    `json:"user_agent"`
}

type Logger struct {
	mu sync.Mutex
	f  *os.File
}

func Open(dataDir string) (*Logger, error) {
	path := filepath.Join(dataDir, FileName)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	if err := f.Chmod(0o600); err != nil {
		_ = f.Close()
		return nil, err
	}
	return &Logger{f: f}, nil
}

func (l *Logger) Close() error {
	if l == nil || l.f == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.f.Close()
}

func (l *Logger) Append(record Record) error {
	if l == nil || l.f == nil {
		return nil
	}
	if record.TS.IsZero() {
		record.TS = time.Now().UTC()
	} else {
		record.TS = record.TS.UTC()
	}
	line, err := json.Marshal(record)
	if err != nil {
		return err
	}
	line = append(line, '\n')

	l.mu.Lock()
	defer l.mu.Unlock()
	_, err = l.f.Write(line)
	return err
}

type Filter struct {
	Capset   string
	Instance string
	Service  string
	Limit    int
	LimitSet bool
	Tail     int
	TailSet  bool
	Follow   bool
}

func ReadFile(path string, filter Filter, w io.Writer) error {
	if err := validateFilterLimits(filter); err != nil {
		return err
	}
	f, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	defer f.Close()
	return FilterLines(f, filter, w)
}

func FilterLines(r io.Reader, filter Filter, w io.Writer) error {
	if err := validateFilterLimits(filter); err != nil {
		return err
	}
	if filter.LimitSet && filter.TailSet {
		return fmt.Errorf("limit and tail are mutually exclusive")
	}
	limit := DefaultLimit
	if filter.LimitSet {
		limit = filter.Limit
	}
	if filter.LimitSet && limit == 0 {
		limit = -1
	}
	if filter.TailSet {
		limit = -1
	}

	scanner := bufio.NewScanner(r)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 10*1024*1024)
	written := 0
	tail := make([][]byte, 0, filter.Tail)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var record Record
		if err := json.Unmarshal(line, &record); err != nil {
			return fmt.Errorf("parse access log line: %w", err)
		}
		if !matches(record, filter) {
			continue
		}
		if filter.TailSet {
			if filter.Tail == 0 {
				continue
			}
			lineCopy := append([]byte(nil), line...)
			if len(tail) < filter.Tail {
				tail = append(tail, lineCopy)
			} else {
				copy(tail, tail[1:])
				tail[len(tail)-1] = lineCopy
			}
			continue
		}
		if _, err := w.Write(line); err != nil {
			return err
		}
		if _, err := w.Write([]byte("\n")); err != nil {
			return err
		}
		written++
		if limit > 0 && written >= limit {
			break
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	for _, line := range tail {
		if _, err := w.Write(line); err != nil {
			return err
		}
		if _, err := w.Write([]byte("\n")); err != nil {
			return err
		}
	}
	return nil
}

func validateFilterLimits(filter Filter) error {
	if filter.Limit < 0 {
		return fmt.Errorf("limit must be non-negative")
	}
	if filter.Tail < 0 {
		return fmt.Errorf("tail must be non-negative")
	}
	if filter.Limit > MaxFilterEntries {
		return fmt.Errorf("limit must not exceed %d", MaxFilterEntries)
	}
	if filter.Tail > MaxFilterEntries {
		return fmt.Errorf("tail must not exceed %d", MaxFilterEntries)
	}
	return nil
}

func FollowFile(path string, filter Filter, w io.Writer, done <-chan struct{}) error {
	if err := validateFilterLimits(filter); err != nil {
		return err
	}
	f, err := os.Open(path)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		f, err = waitOpen(path, done)
		if err != nil {
			return err
		}
		if f == nil {
			return nil
		}
	}
	defer f.Close()
	if err := FilterLines(f, filter, w); err != nil {
		return err
	}
	if flusher, ok := w.(interface{ Flush() }); ok {
		flusher.Flush()
	}
	for {
		select {
		case <-done:
			return nil
		default:
		}
		line, err := readNextLine(f, done)
		if err != nil {
			return err
		}
		if line == nil {
			return nil
		}
		if len(line) == 0 {
			continue
		}
		var record Record
		if err := json.Unmarshal(line, &record); err != nil {
			return fmt.Errorf("parse access log line: %w", err)
		}
		if !matches(record, filter) {
			continue
		}
		if _, err := w.Write(line); err != nil {
			return err
		}
		if _, err := w.Write([]byte("\n")); err != nil {
			return err
		}
		if flusher, ok := w.(interface{ Flush() }); ok {
			flusher.Flush()
		}
	}
}

func waitOpen(path string, done <-chan struct{}) (*os.File, error) {
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-done:
			return nil, nil
		case <-ticker.C:
			f, err := os.Open(path)
			if err == nil {
				return f, nil
			}
			if !errors.Is(err, os.ErrNotExist) {
				return nil, err
			}
		}
	}
}

func readNextLine(f *os.File, done <-chan struct{}) ([]byte, error) {
	var line []byte
	buf := make([]byte, 1)
	for {
		n, err := f.Read(buf)
		if n > 0 {
			if buf[0] == '\n' {
				return line, nil
			}
			line = append(line, buf[0])
			continue
		}
		if err == nil {
			continue
		}
		if !errors.Is(err, io.EOF) {
			return nil, err
		}
		select {
		case <-done:
			return nil, nil
		case <-time.After(200 * time.Millisecond):
		}
	}
}

func matches(record Record, filter Filter) bool {
	if filter.Capset != "" && record.Capset != filter.Capset {
		return false
	}
	if filter.Instance != "" && record.Instance != filter.Instance {
		return false
	}
	if filter.Service != "" && record.Service != filter.Service {
		return false
	}
	return true
}
