package domain

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestValidateID(t *testing.T) {
	valid := []string{"dev", "release-agent", "gitlab_test", "A123"}
	for _, id := range valid {
		if err := ValidateID("test", id); err != nil {
			t.Fatalf("%s should be valid: %v", id, err)
		}
	}
	invalid := []string{"", "1dev", "bad.dot", "bad/slash", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
	for _, id := range invalid {
		if err := ValidateID("test", id); err == nil {
			t.Fatalf("%s should be invalid", id)
		}
	}
}

func TestMCPToolName(t *testing.T) {
	got := MCPToolName("gitlab", "gitlab-prod", "gitlab.MergeRequestService/ListMergeRequests")
	want := "gitlab__gitlab-prod__list_merge_requests"
	if got != want {
		t.Fatalf("tool name = %q, want %q", got, want)
	}
	got = MCPToolName("svc", "inst", "HTTP-JSON.Path/Do Thing")
	if got != "svc__inst__do__thing" {
		t.Fatalf("mixed separator tool name=%q", got)
	}
}

func TestDescriptorVersion(t *testing.T) {
	if got := DescriptorVersion("1234567890abcdef"); got != "1234567890ab" {
		t.Fatalf("version = %q", got)
	}
	if got := DescriptorVersion("short"); got != "short" {
		t.Fatalf("short version = %q", got)
	}
}

func TestManifestRuntimeMode(t *testing.T) {
	tests := []struct {
		name    string
		runtime string
		want    RuntimeMode
		wantErr bool
	}{
		{name: "missing", want: RuntimeModeLongRunning},
		{name: "empty object", runtime: `{}`, want: RuntimeModeLongRunning},
		{name: "long running", runtime: `{"mode":"long-running"}`, want: RuntimeModeLongRunning},
		{name: "on demand", runtime: `{"mode":"on-demand"}`, want: RuntimeModeOnDemand},
		{name: "invalid", runtime: `{"mode":"bad"}`, wantErr: true},
		{name: "invalid json", runtime: `{`, wantErr: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			m := ServiceManifest{
				Schema: "chaitin.octobus.service.v1",
				Name:   "svc",
				Proto:  ManifestProto{Roots: []string{"proto"}, Files: []string{"proto/svc.proto"}},
			}
			if tc.runtime != "" {
				m.Runtime = []byte(tc.runtime)
			}
			got, err := ManifestRuntimeMode(m)
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected error")
				}
				if validateErr := ValidateManifest(m); validateErr == nil {
					t.Fatal("ValidateManifest accepted invalid runtime mode")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got != tc.want {
				t.Fatalf("mode=%q want %q", got, tc.want)
			}
			if err := ValidateManifest(m); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestValidateManifestContract(t *testing.T) {
	valid := ServiceManifest{
		Schema: ServiceManifestSchemaV1,
		Name:   "svc",
		Proto:  ManifestProto{Roots: []string{"proto"}, Files: []string{"proto/svc.proto"}},
	}
	if err := ValidateManifest(valid); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name string
		edit func(*ServiceManifest)
	}{
		{name: "missing schema", edit: func(m *ServiceManifest) { m.Schema = "" }},
		{name: "schema", edit: func(m *ServiceManifest) { m.Schema = "other" }},
		{name: "missing name", edit: func(m *ServiceManifest) { m.Name = "" }},
		{name: "entry", edit: func(m *ServiceManifest) { m.Entry = "bin/svc" }},
		{name: "missing proto roots", edit: func(m *ServiceManifest) { m.Proto.Roots = nil }},
		{name: "missing proto files", edit: func(m *ServiceManifest) { m.Proto.Files = nil }},
		{name: "absolute proto root", edit: func(m *ServiceManifest) { m.Proto.Roots = []string{"/proto"} }},
		{name: "escaping proto file", edit: func(m *ServiceManifest) { m.Proto.Files = []string{"../svc.proto"} }},
		{name: "escaping config schema", edit: func(m *ServiceManifest) { m.ConfigSchema = "../config.schema.json" }},
		{name: "escaping secret schema", edit: func(m *ServiceManifest) { m.SecretSchema = "../secret.schema.json" }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			m := valid
			tc.edit(&m)
			if err := ValidateManifest(m); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestValidatePackageRelativePathBoundaries(t *testing.T) {
	tests := []string{"", "/abs/path", ".", "..", "../service.json"}
	for _, value := range tests {
		t.Run(value, func(t *testing.T) {
			if err := ValidatePackageRelativePath("test path", value); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
	if err := ValidatePackageRelativePath("test path", "proto/service.proto"); err != nil {
		t.Fatal(err)
	}
}

func TestConfigHashAndRedactionHelpers(t *testing.T) {
	raw := []byte(`{"a":1}`)
	if got := ConfigHash(raw); got != HashBytes(raw) {
		t.Fatalf("ConfigHash=%q HashBytes=%q", got, HashBytes(raw))
	}
	if got := CapsetTokenHash("capset-token"); got != HashBytes([]byte("capset-token")) {
		t.Fatalf("CapsetTokenHash=%q", got)
	}
	if got := AdminTokenHash("admin-token"); got != HashBytes([]byte("admin-token")) {
		t.Fatalf("AdminTokenHash=%q", got)
	}
	secretCases := []string{"password", "apiToken", "client_secret", "privateKey"}
	for _, key := range secretCases {
		if got := RedactConfigValue(key, "value"); got != "******" {
			t.Fatalf("RedactConfigValue(%q)=%v", key, got)
		}
	}
	if got := RedactConfigValue("displayName", "value"); got != "value" {
		t.Fatalf("non-secret value was redacted: %v", got)
	}
}

func TestManifestRuntimeModePreservesUnknownRuntimeFields(t *testing.T) {
	var m ServiceManifest
	if err := json.Unmarshal([]byte(`{"runtime":{"mode":"on-demand","vendor":true}}`), &m); err != nil {
		t.Fatal(err)
	}
	mode, err := ManifestRuntimeMode(m)
	if err != nil {
		t.Fatal(err)
	}
	if mode != RuntimeModeOnDemand {
		t.Fatalf("mode=%q", mode)
	}
	if !strings.Contains(string(m.Runtime), `"vendor":true`) {
		t.Fatalf("runtime extension field was not preserved: %s", m.Runtime)
	}
}
