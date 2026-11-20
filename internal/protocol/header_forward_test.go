package protocol

import (
	"net/http"
	"reflect"
	"testing"
)

func TestParseHTTPHeaderForwards(t *testing.T) {
	for _, rule := range []string{"Authorization", "=x-octobus-ext-auth", "Bad Name=x-octobus-ext-auth", "Authorization=authorization", "Authorization=x-octobus-ext-", "Authorization=x-octobus-ext-ba\nd", "Authorization=x-octobus-ext-bad:name", "X-Octobus-Ext-Auth=x-octobus-ext-auth", "Host=x-octobus-ext-host"} {
		t.Run(rule, func(t *testing.T) {
			if _, err := ParseHTTPHeaderForwards([]string{rule}); err == nil {
				t.Fatal("expected invalid rule")
			}
		})
	}
	if _, err := ParseHTTPHeaderForwards([]string{"Authorization=x-octobus-ext-auth", "Cookie=X-Octobus-Ext-Auth"}); err == nil {
		t.Fatal("expected duplicate target error")
	}
}

func TestHTTPHeaderForwards(t *testing.T) {
	rules, err := ParseHTTPHeaderForwards([]string{" Authorization = X-Octobus-Ext-Auth ", "Missing=x-octobus-ext-missing", "X-Octobus-Ext-Auth=x-octobus-ext-original", "Authorization=x-octobus-ext-second"})
	if err != nil {
		t.Fatal(err)
	}
	headers := http.Header{"aUtHoRiZaTiOn": {"Bearer first", "Bearer second"}, "x-octobus-ext-auth": {"forged"}, "X-Octobus-Ext-Missing": {"forged"}}
	original := headers.Clone()
	out := rules.apply(headers)
	for _, target := range []string{"X-Octobus-Ext-Auth", "X-Octobus-Ext-Second"} {
		if !reflect.DeepEqual(out.Values(target), []string{"Bearer first", "Bearer second"}) {
			t.Fatalf("unexpected copied values for %s", target)
		}
	}
	if len(out.Values("X-Octobus-Ext-Missing")) != 0 {
		t.Fatal("missing source must clear target")
	}
	if out.Get("X-Octobus-Ext-Original") != "forged" {
		t.Fatal("rules must use original headers, not chain")
	}
	if !reflect.DeepEqual(headers, original) {
		t.Fatal("original headers changed")
	}
	if !reflect.DeepEqual((HTTPHeaderForwards{}).apply(headers), original) {
		t.Fatal("default must preserve headers")
	}
}

func TestHTTPHeaderForwardsCredentialSources(t *testing.T) {
	if got := (HTTPHeaderForwards{}).CredentialSources(); len(got) != 0 {
		t.Fatalf("unexpected default credential sources: %v", got)
	}
	rules, err := ParseHTTPHeaderForwards([]string{
		"Authorization=x-octobus-ext-auth",
		" Cookie =x-octobus-ext-cookie",
		"Proxy-Authorization=x-octobus-ext-proxy",
		"X-Octobus-Ext-Auth=x-octobus-ext-other",
		"Cookie=x-octobus-ext-second-cookie",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"authorization", "cookie", "proxy-authorization"}
	if got := rules.CredentialSources(); !reflect.DeepEqual(got, want) {
		t.Fatalf("want %v, got %v", want, got)
	}
}
