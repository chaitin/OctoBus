package packageimport

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestDefaultRemoteTargetValidatorRejectsPrivateAndSpecialAddresses(t *testing.T) {
	for _, raw := range []string{
		"http://127.0.0.1/package.tgz",
		"https://localhost/package.tgz",
		"http://169.254.169.254/package.tgz",
		"http://192.0.2.8/package.tgz",
		"http://[::1]/package.tgz",
	} {
		err := DefaultRemoteTargetValidator(context.Background(), raw)
		if err == nil {
			t.Fatalf("validator accepted %s", raw)
		}
		if !strings.Contains(err.Error(), "private or special") {
			t.Fatalf("unexpected error for %s: %v", raw, err)
		}
	}
}

func TestDefaultRemoteTargetValidatorRejectsUnsupportedURLs(t *testing.T) {
	if err := DefaultRemoteTargetValidator(context.Background(), "file:///tmp/package.tgz"); err == nil {
		t.Fatal("validator accepted a non-HTTP URL")
	}
}

func TestRemoteHTTPClientDisablesAmbientProxy(t *testing.T) {
	client := newRemoteHTTPClient(DefaultRemoteTargetValidator)
	transport, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("transport type = %T", client.Transport)
	}
	if transport.Proxy != nil {
		t.Fatal("validated remote client inherited an ambient proxy")
	}
}

func TestRemoteHTTPClientRevalidatesRedirects(t *testing.T) {
	validator := func(_ context.Context, raw string) error {
		if strings.HasSuffix(raw, "/internal") {
			return context.Canceled
		}
		return nil
	}
	client := newRemoteHTTPClient(validator)
	redirect, err := url.Parse("https://public.example/internal")
	if err != nil {
		t.Fatal(err)
	}
	err = client.CheckRedirect(&http.Request{URL: redirect, Method: http.MethodGet}, nil)
	if err == nil || !strings.Contains(err.Error(), context.Canceled.Error()) {
		t.Fatalf("redirect validation error = %v", err)
	}
}

func TestPrepareGitSourceRejectsPrivateRemoteBeforeGitFetch(t *testing.T) {
	imp := &Importer{RemoteTargetValidator: DefaultRemoteTargetValidator}
	_, err := imp.prepareGitSource(context.Background(), "https://127.0.0.1/repo.git", t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "private or special") {
		t.Fatalf("private Git remote error = %v", err)
	}
}

// recordedCalls collects the URLs passed to a RemoteTargetValidator. The
// validator is invoked from the proxy's serving goroutine, so reads from the
// test goroutine must go through snapshot to stay race-free.
type recordedCalls struct {
	mu    sync.Mutex
	calls []string
}

func (r *recordedCalls) add(raw string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, raw)
}

func (r *recordedCalls) snapshot() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.calls...)
}

// hostAllowlistValidator implements the documented host-level contract for
// RemoteTargetValidator: it decides on scheme, host, and port and must not
// depend on a path, because Git CONNECT validation receives a synthetic
// "https://host:port" URL.
func hostAllowlistValidator(allowedHost string) (func(context.Context, string) error, *recordedCalls) {
	seen := &recordedCalls{}
	return func(_ context.Context, raw string) error {
		seen.add(raw)
		u, err := url.Parse(raw)
		if err != nil {
			return err
		}
		if u.Hostname() != allowedHost {
			return fmt.Errorf("remote host %q is not allowed", u.Hostname())
		}
		return nil
	}, seen
}

// readStatusLine reads one HTTP response status line and fails the test if
// the proxy never terminates it with a real CRLF (a literal backslash-r
// backslash-n cannot be parsed by git and stalls until EOF).
func readStatusLine(t *testing.T, conn net.Conn) string {
	t.Helper()
	status, err := bufio.NewReader(conn).ReadString('\n')
	if err != nil {
		t.Fatalf("read status line: %v", err)
	}
	if !strings.HasSuffix(status, "\r\n") {
		t.Fatalf("status line %q is not terminated by CRLF", status)
	}
	return strings.TrimSuffix(status, "\r\n")
}

// TestGitProxyRejectsNonCONNECTWith405 covers the 405 status line (and its
// CRLF termination) written when a connection is not a CONNECT request.
func TestGitProxyRejectsNonCONNECTWith405(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	validate, _ := hostAllowlistValidator("allowed.example.com")
	proxy, err := startValidatedGitProxy(ctx, validate)
	if err != nil {
		t.Fatal(err)
	}
	defer proxy.Close()

	conn, err := net.DialTimeout("tcp", proxy.listener.Addr().String(), 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := fmt.Fprintf(conn, "GET / HTTP/1.1\r\nHost: allowed.example.com\r\n\r\n"); err != nil {
		t.Fatal(err)
	}
	if got := readStatusLine(t, conn); got != "HTTP/1.1 405 Method Not Allowed" {
		t.Fatalf("CONNECT status = %q, want 405", got)
	}
}

// TestGitProxyCONNECTRejectsNonAllowlistedHost exercises the CONNECT
// validation path that previously had no direct coverage: a policy that
// allows only one host must reject CONNECT targets outside that allowlist.
func TestGitProxyCONNECTRejectsNonAllowlistedHost(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	validate, _ := hostAllowlistValidator("allowed.example.com")
	proxy, err := startValidatedGitProxy(ctx, validate)
	if err != nil {
		t.Fatal(err)
	}
	defer proxy.Close()

	conn, err := net.DialTimeout("tcp", proxy.listener.Addr().String(), 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := fmt.Fprintf(conn, "CONNECT denied.example.com:443 HTTP/1.1\r\nHost: denied.example.com:443\r\n\r\n"); err != nil {
		t.Fatal(err)
	}
	if got := readStatusLine(t, conn); !strings.Contains(got, "403") {
		t.Fatalf("CONNECT status = %q, want 403", got)
	}
}

// TestGitProxyCONNECTNeverRelaxesIPPinAndUsesSyntheticURL checks that the
// proxy still rejects a host the policy allows when the host resolves to a
// forbidden address (DNS pinning is not bypassed by a permissive policy), and
// that the validator is consulted with a synthetic host-only URL.
func TestGitProxyCONNECTNeverRelaxesIPPinAndUsesSyntheticURL(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	validate, calls := hostAllowlistValidator("localhost")
	proxy, err := startValidatedGitProxy(ctx, validate)
	if err != nil {
		t.Fatal(err)
	}
	defer proxy.Close()

	conn, err := net.DialTimeout("tcp", proxy.listener.Addr().String(), 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := fmt.Fprintf(conn, "CONNECT localhost:443 HTTP/1.1\r\nHost: localhost:443\r\n\r\n"); err != nil {
		t.Fatal(err)
	}
	if got := readStatusLine(t, conn); !strings.Contains(got, "403") {
		t.Fatalf("CONNECT status = %q, want 403 for loopback resolution", got)
	}
	seen := calls.snapshot()
	if len(seen) == 0 || !strings.HasPrefix(seen[0], "https://localhost:443") {
		t.Fatalf("validator calls = %v, want synthetic https://localhost:443 URL", seen)
	}
}

// TestGitProxyCONNECTWritesRealCRLF200Status covers the most security-relevant
// status line: the 200 Connection Established response that git must parse to
// proceed with the TLS tunnel. A literal "\r\n" (backslash r backslash n)
// regression fails this test with an io.EOF from ReadString('\n').
func TestGitProxyCONNECTWritesRealCRLF200Status(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	validate, _ := hostAllowlistValidator("target.invalid")
	// Do not dial an external target: hand the proxy a pipe whose peer is
	// held by this test, standing in for the CONNECT destination.
	tunneled, remotePeer := net.Pipe()
	defer remotePeer.Close()
	proxy, err := startValidatedGitProxy(ctx, validate, func(_ context.Context, address string, _ func(context.Context, string) error) (net.Conn, error) {
		if address != "target.invalid:443" {
			t.Errorf("dial address = %q, want target.invalid:443", address)
		}
		return tunneled, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	defer proxy.Close()

	conn, err := net.DialTimeout("tcp", proxy.listener.Addr().String(), 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := fmt.Fprintf(conn, "CONNECT target.invalid:443 HTTP/1.1\r\nHost: target.invalid:443\r\n\r\n"); err != nil {
		t.Fatal(err)
	}
	if got := readStatusLine(t, conn); got != "HTTP/1.1 200 Connection Established" {
		t.Fatalf("CONNECT status = %q, want 200 Connection Established", got)
	}

	// Verify the established tunnel carries bytes in both directions.
	clientReader := bufio.NewReader(conn)
	if _, err := fmt.Fprintf(conn, "hello through tunnel"); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, len("hello through tunnel"))
	if _, err := remotePeer.Read(buf); err != nil {
		t.Fatalf("read tunneled bytes: %v", err)
	}
	if string(buf) != "hello through tunnel" {
		t.Fatalf("tunneled bytes = %q", buf)
	}
	if _, err := remotePeer.Write([]byte("reply from origin")); err != nil {
		t.Fatal(err)
	}
	reply := make([]byte, len("reply from origin"))
	if _, err := io.ReadFull(clientReader, reply); err != nil {
		t.Fatalf("read tunneled reply: %v", err)
	}
	if string(reply) != "reply from origin" {
		t.Fatalf("tunneled reply = %q", reply)
	}
}

// staticResolver resolves every hostname to a fixed address list.
type staticResolver struct {
	ips []net.IPAddr
}

func (s staticResolver) LookupIPAddr(_ context.Context, _ string) ([]net.IPAddr, error) {
	return s.ips, nil
}

// TestDialValidatedRemoteSkipsForbiddenAndConnectsAllowed exercises the real
// dialValidatedRemote address-selection loop: forbidden addresses from the
// resolution list must be skipped and the first allowed one dialed.
func TestDialValidatedRemoteSkipsForbiddenAndConnectsAllowed(t *testing.T) {
	ctx := context.Background()
	var dialed []string
	dial := func(_ context.Context, network, address string) (net.Conn, error) {
		dialed = append(dialed, address)
		conn, _ := net.Pipe()
		return conn, nil
	}
	resolver := staticResolver{ips: []net.IPAddr{
		{IP: net.ParseIP("127.0.0.1")},     // loopback: forbidden
		{IP: net.ParseIP("10.0.0.5")},      // RFC1918: forbidden
		{IP: net.ParseIP("203.0.113.7")},   // TEST-NET-3: forbidden
		{IP: net.ParseIP("93.184.216.34")}, // example.com: allowed
	}}
	allowAll := func(_ context.Context, _ string) error { return nil }
	conn, err := dialValidatedRemoteWith(ctx, "allowed.example:443", allowAll, resolver, dial)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if len(dialed) != 1 || dialed[0] != "93.184.216.34:443" {
		t.Fatalf("dialed addresses = %v, want only the allowed 93.184.216.34:443", dialed)
	}
}

// TestDialValidatedRemoteFailsWhenEveryAddressIsForbidden locks the error
// contract when DNS returns only addresses that must never be dialed.
func TestDialValidatedRemoteFailsWhenEveryAddressIsForbidden(t *testing.T) {
	ctx := context.Background()
	resolver := staticResolver{ips: []net.IPAddr{
		{IP: net.ParseIP("127.0.0.1")},
		{IP: net.ParseIP("::1")},
	}}
	var dialed []string
	dial := func(_ context.Context, network, address string) (net.Conn, error) {
		dialed = append(dialed, address)
		conn, _ := net.Pipe()
		return conn, nil
	}
	allowAll := func(_ context.Context, _ string) error { return nil }
	_, err := dialValidatedRemoteWith(ctx, "loopback.test:443", allowAll, resolver, dial)
	if err == nil || !strings.Contains(err.Error(), "unable to connect to allowed address") {
		t.Fatalf("all-forbidden error = %v", err)
	}
	if len(dialed) != 0 {
		t.Fatalf("dialed %d forbidden addresses: %v", len(dialed), dialed)
	}
}

// TestDialValidatedRemoteHonorsValidatorFailure checks that a policy rejection
// aborts before any DNS resolution or dial happens.
func TestDialValidatedRemoteHonorsValidatorFailure(t *testing.T) {
	ctx := context.Background()
	reject := func(_ context.Context, raw string) error { return fmt.Errorf("policy rejects %s", raw) }
	var dialed bool
	dial := func(_ context.Context, network, address string) (net.Conn, error) {
		dialed = true
		conn, _ := net.Pipe()
		return conn, nil
	}
	_, err := dialValidatedRemoteWith(ctx, "denied.example:443", reject, staticResolver{}, dial)
	if err == nil || !strings.Contains(err.Error(), "policy rejects") {
		t.Fatalf("validator error = %v", err)
	}
	if dialed {
		t.Fatal("dialed despite validator rejection")
	}
}
