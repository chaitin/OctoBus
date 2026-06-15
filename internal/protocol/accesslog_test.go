package protocol

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/peer"
)

func TestStatusRecorderDefaultsUnwrapAndFlush(t *testing.T) {
	base := httptest.NewRecorder()
	rec := newStatusRecorder(base)

	if got := rec.Status(); got != http.StatusOK {
		t.Fatalf("default status=%d want %d", got, http.StatusOK)
	}
	if got := rec.Unwrap(); got != base {
		t.Fatalf("unwrap=%T want base recorder", got)
	}
	rec.Flush()
	if !base.Flushed {
		t.Fatal("expected wrapped response writer to flush")
	}
}

func TestNilGatewayLoggerReturnsNop(t *testing.T) {
	var gateway *Gateway
	if gateway.logger() == nil {
		t.Fatal("expected non-nil logger")
	}
}

func TestParseGRPCCodeEdgeCases(t *testing.T) {
	if got := parseGRPCCode(""); got != codes.OK {
		t.Fatalf("empty code=%v want %v", got, codes.OK)
	}
	if got := parseGRPCCode("not-a-code"); got != codes.Unknown {
		t.Fatalf("invalid code=%v want %v", got, codes.Unknown)
	}
}

func TestProtocolFailureLevelHTTPFallbacks(t *testing.T) {
	if got := protocolFailureLevel(codes.OK, http.StatusInternalServerError); got != slog.LevelError {
		t.Fatalf("500 level=%v want error", got)
	}
	if got := protocolFailureLevel(codes.OK, http.StatusBadRequest); got != slog.LevelWarn {
		t.Fatalf("400 level=%v want warn", got)
	}
}

func TestGRPCCodeFromHTTPStatusMappings(t *testing.T) {
	tests := []struct {
		status int
		want   codes.Code
	}{
		{0, codes.OK},
		{http.StatusUnauthorized, codes.Unauthenticated},
		{http.StatusForbidden, codes.PermissionDenied},
		{http.StatusNotFound, codes.NotFound},
		{http.StatusRequestTimeout, codes.DeadlineExceeded},
		{http.StatusConflict, codes.Aborted},
		{http.StatusNotImplemented, codes.Unimplemented},
		{http.StatusGatewayTimeout, codes.DeadlineExceeded},
		{http.StatusPartialContent, codes.OK},
		{http.StatusBadGateway, codes.Internal},
		{http.StatusTeapot, codes.Unknown},
	}

	for _, tt := range tests {
		t.Run(http.StatusText(tt.status), func(t *testing.T) {
			if got := grpcCodeFromHTTPStatus(tt.status); got != tt.want {
				t.Fatalf("code=%v want %v", got, tt.want)
			}
		})
	}
}

func TestGRPCRemoteAddrMissingPeerOrAddress(t *testing.T) {
	if got := grpcRemoteAddr(context.Background()); got != "" {
		t.Fatalf("missing peer addr=%q want empty", got)
	}
	ctx := peer.NewContext(context.Background(), &peer.Peer{})
	if got := grpcRemoteAddr(ctx); got != "" {
		t.Fatalf("nil peer addr=%q want empty", got)
	}
}

func TestTrimGRPCMethodEdgeCases(t *testing.T) {
	if got := trimGRPCMethod(""); got != "" {
		t.Fatalf("empty method=%q want empty", got)
	}
	if got := trimGRPCMethod("pkg.Service/Method"); got != "pkg.Service/Method" {
		t.Fatalf("method=%q", got)
	}
}
