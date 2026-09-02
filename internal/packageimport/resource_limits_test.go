package packageimport

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCopyWithByteLimitAllowsExactSize(t *testing.T) {
	var dst bytes.Buffer
	if err := copyWithByteLimit(&dst, strings.NewReader("exact"), int64(len("exact"))); err != nil {
		t.Fatal(err)
	}
	if dst.String() != "exact" {
		t.Fatalf("copied content = %q", dst.String())
	}
}

func TestCopyWithByteLimitRejectsOversizedContent(t *testing.T) {
	var dst bytes.Buffer
	err := copyWithByteLimit(&dst, strings.NewReader("oversized"), 4)
	if err == nil || !strings.Contains(err.Error(), "byte limit") {
		t.Fatalf("copy limit error = %v", err)
	}
}

func TestTarExtractionEnforcesExpandedSizeLimit(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "package.tgz")
	file, err := os.Create(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	gz := gzip.NewWriter(file)
	tarWriter := tar.NewWriter(gz)
	body := []byte("0123456789")
	if err := tarWriter.WriteHeader(&tar.Header{Name: "package/data", Mode: 0o600, Size: int64(len(body))}); err != nil {
		t.Fatal(err)
	}
	if _, err := tarWriter.Write(body); err != nil {
		t.Fatal(err)
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	err = untarGzWithLimits(archivePath, t.TempDir(), archiveExtractionLimits{
		MaxFiles:      10,
		MaxEntryBytes: 5,
		MaxTotalBytes: 5,
	})
	if err == nil || !strings.Contains(err.Error(), "byte limit") {
		t.Fatalf("tar limit error = %v", err)
	}
}

func TestTarExtractionEnforcesFileCountLimit(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "package.tgz")
	writeTarArchive(t, archivePath, tarEntry{name: "package/a", body: "a"}, tarEntry{name: "package/b", body: "b"})
	err := untarGzWithLimits(archivePath, t.TempDir(), archiveExtractionLimits{MaxFiles: 1, MaxEntryBytes: 10, MaxTotalBytes: 10})
	if err == nil || !strings.Contains(err.Error(), "file limit") {
		t.Fatalf("tar file limit error = %v", err)
	}
}

func TestTarExtractionEnforcesTotalExpandedSizeLimit(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "package.tgz")
	writeTarArchive(t, archivePath, tarEntry{name: "package/a", body: "abc"}, tarEntry{name: "package/b", body: "def"})
	err := untarGzWithLimits(archivePath, t.TempDir(), archiveExtractionLimits{MaxFiles: 10, MaxEntryBytes: 10, MaxTotalBytes: 5})
	if err == nil || !strings.Contains(err.Error(), "expanded byte limit") {
		t.Fatalf("tar total size error = %v", err)
	}
}

func TestZipExtractionEnforcesEntryAndTotalSizeLimits(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "package.zip")
	writeZipArchive(t, archivePath, "package/a", "abc")
	// The entry-size check is covered independently; this archive is enough to
	// exercise the total-size check after the first entry.
	archivePath = filepath.Join(t.TempDir(), "package.zip")
	writeZipArchive(t, archivePath, "package/a", "abcdef")
	if err := unzipWithLimits(archivePath, t.TempDir(), archiveExtractionLimits{MaxFiles: 10, MaxEntryBytes: 2, MaxTotalBytes: 10}); err == nil || !strings.Contains(err.Error(), "byte limit") {
		t.Fatalf("zip entry size error = %v", err)
	}
	if err := unzipWithLimits(archivePath, t.TempDir(), archiveExtractionLimits{MaxFiles: 10, MaxEntryBytes: 10, MaxTotalBytes: 5}); err == nil || !strings.Contains(err.Error(), "expanded byte limit") {
		t.Fatalf("zip total size error = %v", err)
	}
}

func TestZipExtractionAllowsArchiveWithinLimits(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "package.zip")
	writeZipArchive(t, archivePath, "package/data", "ok")
	dst := t.TempDir()
	if err := unzipWithLimits(archivePath, dst, archiveExtractionLimits{MaxFiles: 10, MaxEntryBytes: 10, MaxTotalBytes: 10}); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(filepath.Join(dst, "package", "data"))
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "ok" {
		t.Fatalf("extracted content = %q", content)
	}
}

func TestZipExtractionEnforcesFileCountLimit(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "package.zip")
	file, err := os.Create(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	zipWriter := zip.NewWriter(file)
	for _, name := range []string{"package/a", "package/b"} {
		entry, err := zipWriter.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write(bytes.Repeat([]byte{'x'}, 1)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	err = unzipWithLimits(archivePath, t.TempDir(), archiveExtractionLimits{
		MaxFiles:      1,
		MaxEntryBytes: 10,
		MaxTotalBytes: 10,
	})
	if err == nil || !strings.Contains(err.Error(), "file limit") {
		t.Fatalf("zip limit error = %v", err)
	}
}
