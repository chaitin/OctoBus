//go:build !windows

package cli

import (
	"bytes"
	"mime/multipart"
	"path/filepath"
	"strings"
	"syscall"
	"testing"

	"octobus/internal/packageimport"
)

// A source that is neither a directory nor a regular file cannot be uploaded, and
// saying so beats streaming whatever the device yields.
//
// Guarded by a build constraint rather than a runtime check: syscall.Mkfifo does
// not exist on Windows, so a Windows build would not compile this file at all and
// the skip would never run.
func TestServiceImportUploadRejectsNonRegularSources(t *testing.T) {
	fifo := filepath.Join(t.TempDir(), "package")
	if err := syscall.Mkfifo(fifo, 0o600); err != nil {
		t.Fatal(err)
	}

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	err := writeServiceImportMultipart(writer, map[string]any{"service_id": "echo"}, localImportSource{
		Path:       fifo,
		UploadKind: packageimport.UploadKindArchive,
	})
	if err == nil || !strings.Contains(err.Error(), "not a regular file") {
		t.Fatalf("err=%v want a non-regular file rejection", err)
	}
}
