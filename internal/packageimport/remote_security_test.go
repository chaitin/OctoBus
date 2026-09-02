package packageimport

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"testing"
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
