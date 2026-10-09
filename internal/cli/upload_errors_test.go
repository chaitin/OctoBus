package cli

import (
	"errors"
	"mime/multipart"
	"os"
	"path/filepath"
	"testing"

	"octobus/internal/packageimport"
)

// failingWriter fails every write, standing in for a full disk or a closed
// connection while the upload body is being built.
type failingWriter struct{ err error }

func (w failingWriter) Write([]byte) (int, error) { return 0, w.err }

// Building the upload body has to report a failed write instead of posting a
// truncated package, which the daemon would import as an empty one.
func TestServiceImportUploadReportsWriteFailures(t *testing.T) {
	writeErr := errors.New("no space left on device")
	source := localImportSource{
		Path:       t.TempDir(),
		UploadKind: packageimport.UploadKindDirectory,
	}
	if err := os.WriteFile(filepath.Join(source.Path, "service.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}

	t.Run("multipart body", func(t *testing.T) {
		writer := multipart.NewWriter(failingWriter{err: writeErr})
		err := writeServiceImportMultipart(writer, map[string]any{"service_id": "echo"}, source)
		if !errors.Is(err, writeErr) {
			t.Fatalf("err=%v want %v", err, writeErr)
		}
	})

	t.Run("directory archive", func(t *testing.T) {
		if err := writeImportDirectoryTarGz(source.Path, failingWriter{err: writeErr}); !errors.Is(err, writeErr) {
			t.Fatalf("err=%v want %v", err, writeErr)
		}
	})
}
