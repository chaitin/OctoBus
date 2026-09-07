package packageimport

import (
	"bufio"
	"context"
	"fmt"
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

// hostAllowlistValidator implements the documented host-level contract for
// RemoteTargetValidator: it decides on scheme, host, and port and must not
// depend on a path, because Git CONNECT validation receives a synthetic
// "https://host:port" URL.
func hostAllowlistValidator(allowedHost string) (func(context.Context, string) error, *[]string) {
	var seen sync.Mutex
	var calls []string
	return func(_ context.Context, raw string) error {
		seen.Lock()
		calls = append(calls, raw)
		seen.Unlock()
		u, err := url.Parse(raw)
		if err != nil {
			return err
		}
		if u.Hostname() != allowedHost {
			return fmt.Errorf("remote host %q is not allowed", u.Hostname())
		}
		return nil
	}, &calls
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
	status, err := bufio.NewReader(conn).ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(status, "403") {
		t.Fatalf("CONNECT status = %q, want 403", strings.TrimSpace(status))
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
	status, err := bufio.NewReader(conn).ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(status, "403") {
		t.Fatalf("CONNECT status = %q, want 403 for loopback resolution", strings.TrimSpace(status))
	}
	if len(*calls) == 0 || !strings.HasPrefix((*calls)[0], "https://localhost:443") {
		t.Fatalf("validator calls = %v, want synthetic https://localhost:443 URL", *calls)
	}
}
