package accesslog

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// A follow that starts before the log exists waits for it instead of failing or
// returning an empty stream. waitOpen is the wait itself, so calling it directly
// covers that path without the caller racing to create the file at the right
// moment.
func TestWaitOpenReturnsTheFileOnceItAppears(t *testing.T) {
	path := filepath.Join(t.TempDir(), FileName)
	done := make(chan struct{})
	defer close(done)

	type result struct {
		file *os.File
		err  error
	}
	results := make(chan result, 1)
	go func() {
		file, err := waitOpen(path, done)
		results <- result{file: file, err: err}
	}()

	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-results:
		if got.err != nil {
			t.Fatalf("waitOpen err=%v", got.err)
		}
		if got.file == nil {
			t.Fatal("waitOpen returned no file after the log appeared")
		}
		_ = got.file.Close()
	case <-time.After(5 * time.Second):
		t.Fatal("waitOpen did not return after the log appeared")
	}
}

// A caller that goes away while waiting is released rather than left waiting for
// a file that may never appear.
func TestWaitOpenReturnsWhenTheCallerGoesAway(t *testing.T) {
	done := make(chan struct{})
	close(done)

	file, err := waitOpen(filepath.Join(t.TempDir(), "absent.log"), done)
	if err != nil {
		t.Fatalf("waitOpen err=%v", err)
	}
	if file != nil {
		_ = file.Close()
		t.Fatal("waitOpen returned a file for a log that does not exist")
	}
}
