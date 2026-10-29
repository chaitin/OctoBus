package admin

import (
	"bytes"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"octobus/internal/accesslog"
)

func TestParseAccessLogQueryRejectsUnboundedEntryCounts(t *testing.T) {
	for _, name := range []string{"limit", "tail"} {
		req := httptest.NewRequest("GET", "/admin/v1/logs/access?"+name+"="+strconv.Itoa(accesslog.MaxFilterEntries+1), nil)
		if _, err := parseAccessLogQuery(req); err == nil {
			t.Fatalf("%s query was accepted", name)
		}
	}
}

func TestBoundedLogBufferRejectsOversizedResponse(t *testing.T) {
	var out boundedLogBuffer
	out.Remaining = 3
	if _, err := out.Write([]byte("four")); err == nil {
		t.Fatal("oversized access log response was accepted")
	}
	if out.Len() != 0 || !bytes.Equal(out.Bytes(), nil) {
		t.Fatalf("partial oversized response was retained: %q", out.Bytes())
	}
	if !strings.Contains(errAccessLogResponseTooLarge.Error(), "size limit") {
		t.Fatal("oversize error does not describe the configured limit")
	}
}
