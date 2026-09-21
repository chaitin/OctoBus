package protocol

import (
	"bytes"
	"context"
	"io"
	"strings"
	"testing"
)

func TestBoundedBufferCapsOutputWithoutBlockingProcess(t *testing.T) {
	var buf boundedBuffer
	buf.Limit = 4
	written, err := buf.Write([]byte("oversized"))
	if err != nil {
		t.Fatal(err)
	}
	if written != len("oversized") {
		t.Fatalf("reported written bytes = %d", written)
	}
	if !buf.Truncated || !bytes.Equal(buf.Bytes(), []byte("over")) {
		t.Fatalf("bounded output = %q truncated=%v", buf.Bytes(), buf.Truncated)
	}
	if _, err := buf.Write([]byte("more")); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(buf.Bytes(), []byte("over")) {
		t.Fatalf("buffer grew after truncation: %q", buf.Bytes())
	}
}

// onlyReader hides an underlying reader's io.WriterTo so io.Copy must check
// the destination's io.ReaderFrom (the old embedded bytes.Buffer promoted
// ReadFrom and bypassed the limit) or fall back to the generic Write loop.
type onlyReader struct {
	r io.Reader
}

func (o onlyReader) Read(p []byte) (int, error) { return o.r.Read(p) }

func TestBoundedBufferCapsIoCopyFastPath(t *testing.T) {
	var buf boundedBuffer
	buf.Limit = 4
	if _, err := io.Copy(&buf, onlyReader{strings.NewReader("oversized")}); err != nil {
		t.Fatal(err)
	}
	if !buf.Truncated || !bytes.Equal(buf.Bytes(), []byte("over")) {
		t.Fatalf("io.Copy output = %q truncated=%v", buf.Bytes(), buf.Truncated)
	}
}

func TestOnDemandSlotsRejectWhenCapacityIsFull(t *testing.T) {
	gateway := &Gateway{}
	for i := 0; i < maxOnDemandConcurrent; i++ {
		if !gateway.acquireOnDemandSlot(context.Background()) {
			t.Fatalf("slot %d was not acquired", i)
		}
	}
	if gateway.acquireOnDemandSlot(context.Background()) {
		t.Fatal("acquired a slot beyond the configured capacity")
	}
	for i := 0; i < maxOnDemandConcurrent; i++ {
		gateway.releaseOnDemandSlot()
	}
}
