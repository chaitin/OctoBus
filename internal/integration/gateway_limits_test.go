package integration

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// oversizeBody builds a request whose body exceeds the gateway limit without a
// Content-Length to reject it up front, which is the chunked case a caller can
// send and the one the limit has to catch while reading.
func oversizeBody(t *testing.T, path, prefix string) *http.Request {
	t.Helper()
	body := prefix + strings.Repeat("x", 1<<20) + `"}`
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.ContentLength = -1
	return req
}

// A body past the limit is refused as too large rather than parsed as a
// malformed one, so a client can tell a size problem from a payload problem.
//
// The two surfaces answer with different statuses for the same condition: the
// MCP handler writes 413 itself, while Connect maps ResourceExhausted through
// the Connect error writer, which is 429 by that protocol's own mapping. Each is
// pinned here as that surface's contract rather than as one shared number.
func TestGatewayRejectsOversizedRequestBodies(t *testing.T) {
	_, _, gateway := fixtureForErrorRoutes(t)

	t.Run("mcp", func(t *testing.T) {
		w := httptest.NewRecorder()
		gateway.HandleMCP(w, oversizeBody(t, "/capsets/dev/mcp", `{"jsonrpc":"2.0","id":1,"method":"initialize","params":"`))
		if w.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("status=%d body=%s want 413", w.Code, w.Body.String())
		}
		if !strings.Contains(w.Body.String(), "too large") {
			t.Fatalf("body=%s want a size failure", w.Body.String())
		}
	})

	t.Run("connect", func(t *testing.T) {
		w := httptest.NewRecorder()
		gateway.HandleConnectRPC(w, oversizeBody(t, "/capsets/dev/connect/echo-test/echo.v1.EchoService/Echo", `{"text":"`))
		if w.Code != http.StatusTooManyRequests {
			t.Fatalf("status=%d body=%s want the connect ResourceExhausted status", w.Code, w.Body.String())
		}
	})
}
