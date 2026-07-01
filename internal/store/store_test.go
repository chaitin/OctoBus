package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"octobus/internal/domain"
)

func TestOpenPathBoundaryErrors(t *testing.T) {
	dir := t.TempDir()
	parentFile := filepath.Join(dir, "parent-file")
	if err := os.WriteFile(parentFile, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(filepath.Join(parentFile, "octobus.db")); err == nil {
		t.Fatal("expected parent path mkdir error")
	}
	if _, err := Open(dir); err == nil {
		t.Fatal("expected directory open error")
	}
}

func TestAddColumnIfMissingErrors(t *testing.T) {
	s, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()

	if err := addColumnIfMissing(ctx, s.DB(), "missing_table", "extra", "TEXT"); err == nil {
		t.Fatal("expected alter missing table error")
	}
	if err := addColumnIfMissing(ctx, s.DB(), "services", "runtime_mode", "TEXT"); err != nil {
		t.Fatalf("existing column should be a no-op: %v", err)
	}
	if err := addColumnIfMissing(ctx, s.DB(), "services", "bad_definition", "NOT A VALID COLUMN TYPE ???"); err == nil {
		t.Fatal("expected invalid column definition error")
	}
}

func TestStoreServiceAndInstance(t *testing.T) {
	s, err := Open(t.TempDir() + "/octobus.db")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	ctx := context.Background()
	svc := domain.Service{
		ID:                  "gitlab",
		Name:                "GitLab",
		PackageSource:       "fixture",
		PackageArtifactPath: "/tmp/package.tgz",
		PackageSHA256:       "pkgsha",
		DescriptorPath:      "/tmp/descriptor.protoset",
		DescriptorSHA256:    "descsha",
		DescriptorVersion:   "descsha",
		NodeEntry:           "gitlab-wrapper",
		ServiceRoot:         "services/gitlab",
		ConfigSchemaPath:    "/tmp/config.schema.json",
		SecretSchemaPath:    "/tmp/secret.schema.json",
		Methods: []domain.Method{{
			FullName:        "gitlab.MergeRequestService/List",
			ServiceFullName: "gitlab.MergeRequestService",
			Name:            "List",
			InputFullName:   "gitlab.ListRequest",
			OutputFullName:  "gitlab.ListResponse",
			Unary:           true,
		}},
	}
	if err := s.UpsertService(ctx, svc); err != nil {
		t.Fatal(err)
	}
	stored, err := s.GetService(ctx, "gitlab")
	if err != nil {
		t.Fatal(err)
	}
	if stored.NodeEntry != "gitlab-wrapper" || len(stored.Methods) != 1 || !stored.Methods[0].Unary {
		t.Fatalf("stored service mismatch: %+v", stored)
	}
	if stored.RuntimeMode != domain.RuntimeModeLongRunning {
		t.Fatalf("default runtime mode = %q", stored.RuntimeMode)
	}
	if stored.ServiceRoot != "services/gitlab" {
		t.Fatalf("service root = %q", stored.ServiceRoot)
	}
	if stored.ConfigSchemaPath != svc.ConfigSchemaPath || stored.SecretSchemaPath != svc.SecretSchemaPath {
		t.Fatalf("schema paths mismatch: %+v", stored)
	}
	svc.RuntimeMode = domain.RuntimeModeOnDemand
	if err := s.UpsertService(ctx, svc); err != nil {
		t.Fatal(err)
	}
	stored, err = s.GetService(ctx, "gitlab")
	if err != nil {
		t.Fatal(err)
	}
	if stored.RuntimeMode != domain.RuntimeModeOnDemand {
		t.Fatalf("updated runtime mode = %q", stored.RuntimeMode)
	}

	config := json.RawMessage(`{"token":"secret"}`)
	secret := json.RawMessage(`{"apiToken":"secret-token"}`)
	inst := domain.Instance{ID: "gitlab-test", ServiceID: "gitlab", Name: "GitLab Test", Enabled: true, NodeEntry: "gitlab-wrapper", ConfigJSON: config, SecretJSON: secret}
	if err := s.UpsertInstance(ctx, inst); err != nil {
		t.Fatal(err)
	}
	storedInst, err := s.GetInstance(ctx, "gitlab-test")
	if err != nil {
		t.Fatal(err)
	}
	if storedInst.ConfigSHA256 != domain.ConfigHash(config) {
		t.Fatalf("config sha = %q", storedInst.ConfigSHA256)
	}
	if string(storedInst.SecretJSON) != string(secret) || storedInst.SecretSHA256 != domain.HashBytes(secret) {
		t.Fatalf("secret was not stored with hash: %+v", storedInst)
	}
}

func TestStoreMigrationAddsServiceColumns(t *testing.T) {
	s, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	if _, err := s.DB().ExecContext(ctx, `ALTER TABLE services DROP COLUMN runtime_mode`); err != nil {
		t.Skipf("sqlite does not support DROP COLUMN in this environment: %v", err)
	}
	if _, err := s.DB().ExecContext(ctx, `ALTER TABLE services DROP COLUMN secret_schema_path`); err != nil {
		t.Skipf("sqlite does not support DROP COLUMN in this environment: %v", err)
	}
	if err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	rows, err := s.DB().QueryContext(ctx, `PRAGMA table_info(services)`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, typ string
		var notNull, pk int
		var defaultValue any
		if err := rows.Scan(&cid, &name, &typ, &notNull, &defaultValue, &pk); err != nil {
			t.Fatal(err)
		}
		switch name {
		case "runtime_mode", "secret_schema_path":
			found[name] = true
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"runtime_mode", "secret_schema_path"} {
		if !found[name] {
			t.Fatalf("%s column was not added", name)
		}
	}
}

func TestStoreCRUDAndBindingDeletes(t *testing.T) {
	s, err := Open(t.TempDir() + "/octobus.db")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	ctx := context.Background()
	svc := domain.Service{ID: "echo", Name: "Echo", PackageSource: "fixture", PackageArtifactPath: "pkg", PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha", DescriptorVersion: "descsha", NodeEntry: "entry", Methods: []domain.Method{{FullName: "echo.v1.EchoService/Echo", Unary: true}}}
	if err := s.UpsertService(ctx, svc); err != nil {
		t.Fatal(err)
	}
	count, err := s.CountServices(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("service count=%d, want 1", count)
	}
	updatedSvc, err := s.UpdateServiceMetadata(ctx, "echo", "Echo Updated")
	if err != nil {
		t.Fatal(err)
	}
	if updatedSvc.Name != "Echo Updated" {
		t.Fatalf("service name=%q", updatedSvc.Name)
	}

	if err := s.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: true, NodeEntry: "entry", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteService(ctx, "echo"); err == nil {
		t.Fatal("expected service in use error")
	} else {
		var inUse ServiceInUseError
		if !errors.As(err, &inUse) || inUse.InstanceID != "echo-test" {
			t.Fatalf("unexpected delete error: %v", err)
		}
	}
	if err := s.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := s.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:echo-test", CapsetID: "dev", ServiceID: "echo", InstanceID: "echo-test", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := s.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-test", MethodFullName: "/echo.v1.EchoService/Echo", MCPToolName: "echo_tool", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetCapsetMethod(ctx, "dev:echo-test", "echo.v1.EchoService/Echo"); err != nil {
		t.Fatal(err)
	}

	if err := s.DeleteCapsetMethod(ctx, "dev", "echo-test", "/echo.v1.EchoService/Echo"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetCapsetMethod(ctx, "dev:echo-test", "echo.v1.EchoService/Echo"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("deleted method err=%v", err)
	}
	if err := s.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-test", MethodFullName: "echo.v1.EchoService/Echo", MCPToolName: "echo_tool", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteCapsetInstance(ctx, "dev", "echo-test"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetCapsetInstance(ctx, "dev:echo-test"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("deleted capset instance err=%v", err)
	}
	if err := s.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:echo-test", CapsetID: "dev", ServiceID: "echo", InstanceID: "echo-test", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := s.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-test", MethodFullName: "echo.v1.EchoService/Echo", MCPToolName: "echo_tool", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteInstance(ctx, "echo-test"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetInstance(ctx, "echo-test"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("deleted instance err=%v", err)
	}
	methods, err := s.ListCapsetMethods(ctx, "dev:echo-test")
	if err != nil {
		t.Fatal(err)
	}
	if len(methods) != 0 {
		t.Fatalf("capset methods were not deleted: %+v", methods)
	}

	if err := s.DeleteCapset(ctx, "dev"); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteService(ctx, "echo"); err != nil {
		t.Fatal(err)
	}
}

func TestCapsetTokenCRUDAndVerification(t *testing.T) {
	s, err := Open(t.TempDir() + "/octobus.db")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	if err := s.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	requires, err := s.CapsetRequiresToken(ctx, "dev")
	if err != nil {
		t.Fatal(err)
	}
	if requires {
		t.Fatal("new capset should not require a token")
	}
	ok, err := s.VerifyCapsetToken(ctx, "dev", "secret-one")
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("empty token set should not verify any token")
	}

	first, err := s.AddCapsetToken(ctx, domain.CapsetToken{ID: "key-one", CapsetID: "dev", Name: "Primary"}, "secret-one")
	if err != nil {
		t.Fatal(err)
	}
	if first.TokenHash == "secret-one" || first.TokenHash != domain.CapsetTokenHash("secret-one") {
		t.Fatalf("token hash mismatch or plaintext stored: %+v", first)
	}
	if first.CreatedAt.IsZero() || !first.LastUsedAt.IsZero() {
		t.Fatalf("unexpected token timestamps: %+v", first)
	}
	if _, err := s.AddCapsetToken(ctx, domain.CapsetToken{ID: "key-two", CapsetID: "dev"}, "secret-two"); err != nil {
		t.Fatal(err)
	}
	requires, err = s.CapsetRequiresToken(ctx, "dev")
	if err != nil {
		t.Fatal(err)
	}
	if !requires {
		t.Fatal("capset should require a token after tokens are added")
	}
	if ok, err = s.VerifyCapsetToken(ctx, "dev", "wrong"); err != nil || ok {
		t.Fatalf("wrong token ok=%v err=%v", ok, err)
	}
	if ok, err = s.VerifyCapsetToken(ctx, "dev", "secret-one"); err != nil || !ok {
		t.Fatalf("first token ok=%v err=%v", ok, err)
	}
	if ok, err = s.VerifyCapsetToken(ctx, "dev", "secret-two"); err != nil || !ok {
		t.Fatalf("second token ok=%v err=%v", ok, err)
	}
	used, err := s.GetCapsetToken(ctx, "dev", "key-one")
	if err != nil {
		t.Fatal(err)
	}
	if used.LastUsedAt.IsZero() {
		t.Fatalf("last used timestamp was not updated: %+v", used)
	}
	tokens, err := s.ListCapsetTokens(ctx, "dev")
	if err != nil {
		t.Fatal(err)
	}
	if len(tokens) != 2 || tokens[0].ID != "key-one" || tokens[1].Name != "key-two" {
		t.Fatalf("tokens mismatch: %+v", tokens)
	}
	if err := s.DeleteCapsetToken(ctx, "dev", "key-one"); err != nil {
		t.Fatal(err)
	}
	if ok, err = s.VerifyCapsetToken(ctx, "dev", "secret-one"); err != nil || ok {
		t.Fatalf("deleted token ok=%v err=%v", ok, err)
	}
	if ok, err = s.VerifyCapsetToken(ctx, "dev", "secret-two"); err != nil || !ok {
		t.Fatalf("remaining token ok=%v err=%v", ok, err)
	}
	if err := s.DeleteCapsetToken(ctx, "dev", "key-two"); err != nil {
		t.Fatal(err)
	}
	requires, err = s.CapsetRequiresToken(ctx, "dev")
	if err != nil {
		t.Fatal(err)
	}
	if requires {
		t.Fatal("capset should stop requiring tokens after all tokens are deleted")
	}
}

func TestCapsetTokenValidationAndCascadeDelete(t *testing.T) {
	s, err := Open(t.TempDir() + "/octobus.db")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	if err := s.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddCapsetToken(ctx, domain.CapsetToken{ID: "bad/id", CapsetID: "dev"}, "secret"); err == nil {
		t.Fatal("expected invalid token id error")
	}
	if _, err := s.AddCapsetToken(ctx, domain.CapsetToken{ID: "key", CapsetID: "dev"}, ""); err == nil {
		t.Fatal("expected missing secret error")
	}
	if _, err := s.AddCapsetToken(ctx, domain.CapsetToken{ID: "key", CapsetID: "missing"}, "secret"); err == nil {
		t.Fatal("expected missing capset foreign key error")
	}
	if _, err := s.AddCapsetToken(ctx, domain.CapsetToken{ID: "key", CapsetID: "dev"}, "secret"); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteCapset(ctx, "dev"); err != nil {
		t.Fatal(err)
	}
	tokens, err := s.ListCapsetTokens(ctx, "dev")
	if err != nil {
		t.Fatal(err)
	}
	if len(tokens) != 0 {
		t.Fatalf("tokens were not deleted with capset: %+v", tokens)
	}
}

func TestAdminTokenCRUDAndVerification(t *testing.T) {
	s, err := Open(t.TempDir() + "/octobus.db")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()

	requires, err := s.AdminRequiresToken(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if requires {
		t.Fatal("admin API should not require a token before admin tokens are added")
	}
	ok, err := s.VerifyAdminToken(ctx, "secret-one")
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("empty admin token set should not verify any token")
	}

	first, err := s.AddAdminToken(ctx, domain.AdminToken{ID: "key-one", Name: "Primary"}, "secret-one")
	if err != nil {
		t.Fatal(err)
	}
	if first.TokenHash == "secret-one" || first.TokenHash != domain.AdminTokenHash("secret-one") {
		t.Fatalf("admin token hash mismatch or plaintext stored: %+v", first)
	}
	if first.CreatedAt.IsZero() || !first.LastUsedAt.IsZero() {
		t.Fatalf("unexpected admin token timestamps: %+v", first)
	}
	if _, err := s.AddAdminToken(ctx, domain.AdminToken{ID: "key-two"}, "secret-two"); err != nil {
		t.Fatal(err)
	}
	requires, err = s.AdminRequiresToken(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !requires {
		t.Fatal("admin API should require a token after admin tokens are added")
	}
	if ok, err = s.VerifyAdminToken(ctx, "wrong"); err != nil || ok {
		t.Fatalf("wrong admin token ok=%v err=%v", ok, err)
	}
	if ok, err = s.VerifyAdminToken(ctx, "secret-one"); err != nil || !ok {
		t.Fatalf("first admin token ok=%v err=%v", ok, err)
	}
	if ok, err = s.VerifyAdminToken(ctx, "secret-two"); err != nil || !ok {
		t.Fatalf("second admin token ok=%v err=%v", ok, err)
	}
	used, err := s.GetAdminToken(ctx, "key-one")
	if err != nil {
		t.Fatal(err)
	}
	if used.LastUsedAt.IsZero() {
		t.Fatalf("admin token last used timestamp was not updated: %+v", used)
	}
	tokens, err := s.ListAdminTokens(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(tokens) != 2 || tokens[0].ID != "key-one" || tokens[1].Name != "key-two" {
		t.Fatalf("admin tokens mismatch: %+v", tokens)
	}
	if err := s.DeleteAdminToken(ctx, "key-one"); err != nil {
		t.Fatal(err)
	}
	if ok, err = s.VerifyAdminToken(ctx, "secret-one"); err != nil || ok {
		t.Fatalf("deleted admin token ok=%v err=%v", ok, err)
	}
	if ok, err = s.VerifyAdminToken(ctx, "secret-two"); err != nil || !ok {
		t.Fatalf("remaining admin token ok=%v err=%v", ok, err)
	}
	if err := s.DeleteAdminToken(ctx, "key-two"); err != nil {
		t.Fatal(err)
	}
	requires, err = s.AdminRequiresToken(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if requires {
		t.Fatal("admin API should stop requiring tokens after all admin tokens are deleted")
	}
}

func TestAdminTokenValidation(t *testing.T) {
	s, err := Open(t.TempDir() + "/octobus.db")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()

	if _, err := s.AddAdminToken(ctx, domain.AdminToken{ID: "bad/id"}, "secret"); err == nil {
		t.Fatal("expected invalid admin token id error")
	}
	if _, err := s.AddAdminToken(ctx, domain.AdminToken{ID: "key"}, ""); err == nil {
		t.Fatal("expected missing admin token secret error")
	}
	if _, err := s.AddAdminToken(ctx, domain.AdminToken{ID: "key"}, "secret"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddAdminToken(ctx, domain.AdminToken{ID: "key"}, "secret"); err == nil {
		t.Fatal("expected duplicate admin token id error")
	}
	if err := s.DeleteAdminToken(ctx, "missing"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("delete missing admin token err=%v", err)
	}
}

func TestStoreDeleteMissingRowsAndServiceInUseError(t *testing.T) {
	s, err := Open(t.TempDir() + "/octobus.db")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	if got := (ServiceInUseError{ServiceID: "svc", InstanceID: "inst"}).Error(); got != `service "svc" is used by instance "inst"` {
		t.Fatalf("unexpected in-use error string: %s", got)
	}
	for _, tc := range []struct {
		name string
		fn   func() error
	}{
		{name: "service", fn: func() error { return s.DeleteService(ctx, "missing") }},
		{name: "instance", fn: func() error { return s.DeleteInstance(ctx, "missing") }},
		{name: "capset", fn: func() error { return s.DeleteCapset(ctx, "missing") }},
		{name: "capset instance", fn: func() error { return s.DeleteCapsetInstance(ctx, "dev", "missing") }},
		{name: "capset method", fn: func() error { return s.DeleteCapsetMethod(ctx, "dev", "missing", "svc/Method") }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.fn(); !errors.Is(err, sql.ErrNoRows) {
				t.Fatalf("err=%v want sql.ErrNoRows", err)
			}
		})
	}
}

func TestStoreFindKnownStreamingMethodFallbacks(t *testing.T) {
	s, err := Open(t.TempDir() + "/octobus.db")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	svc := domain.Service{
		ID:                  "echo",
		Name:                "Echo",
		PackageSource:       "fixture",
		PackageArtifactPath: "pkg",
		PackageSHA256:       "pkgsha",
		DescriptorPath:      "desc",
		DescriptorSHA256:    "descsha",
		DescriptorVersion:   "descsha",
		NodeEntry:           "entry",
		Methods: []domain.Method{
			{FullName: "echo.v1.EchoService/Echo", ServiceFullName: "echo.v1.EchoService", Name: "Echo", Unary: true},
			{FullName: "echo.v1.EchoService/Stream", ServiceFullName: "echo.v1.EchoService", Name: "Stream", ServerStreaming: true},
		},
	}
	if err := s.UpsertService(ctx, svc); err != nil {
		t.Fatal(err)
	}
	if err := s.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: true, Status: domain.StatusRunning, NodeEntry: "entry", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := s.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:echo-test", CapsetID: "dev", ServiceID: "echo", InstanceID: "echo-test", IncludeAllMethods: true, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := s.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-test", MethodFullName: "echo.v1.EchoService/Stream", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if item, err := s.FindExposedMethod(ctx, "dev", "echo", "echo-test", "echo.v1.EchoService/Stream"); err != nil || item.Method.Unary {
		t.Fatalf("FindExposedMethod streaming item=%+v err=%v", item, err)
	}
	if item, err := s.FindExposedMethodByInstance(ctx, "dev", "echo-test", "echo.v1.EchoService/Stream"); err != nil || item.Method.Unary {
		t.Fatalf("FindExposedMethodByInstance streaming item=%+v err=%v", item, err)
	}
	if err := s.DeleteCapsetMethod(ctx, "dev", "echo-test", "echo.v1.EchoService/Stream"); err != nil {
		t.Fatal(err)
	}
	streamTool := domain.MCPToolName("echo", "echo-test", "echo.v1.EchoService/Stream")
	if _, err := s.FindTool(ctx, "dev", streamTool); !errors.Is(err, domain.ErrMethodNotUnary) {
		t.Fatalf("FindTool streaming err=%v", err)
	}
	if _, err := s.FindTool(ctx, "dev", "missing_tool"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("FindTool missing err=%v", err)
	}
}

func TestListQueriesMatchGetResults(t *testing.T) {
	s, err := Open(t.TempDir() + "/octobus.db")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	ctx := context.Background()
	seedListFixture(t, ctx, s)

	services, err := s.ListServices(ctx)
	if err != nil {
		t.Fatal(err)
	}
	wantService, err := s.GetService(ctx, "echo")
	if err != nil {
		t.Fatal(err)
	}
	if len(services) != 1 || !reflect.DeepEqual(services[0], wantService) {
		t.Fatalf("ListServices mismatch:\n got %+v\nwant %+v", services, wantService)
	}

	instances, err := s.ListInstances(ctx)
	if err != nil {
		t.Fatal(err)
	}
	wantInstance, err := s.GetInstance(ctx, "echo-test")
	if err != nil {
		t.Fatal(err)
	}
	if len(instances) != 1 || !reflect.DeepEqual(instances[0], wantInstance) {
		t.Fatalf("ListInstances mismatch:\n got %+v\nwant %+v", instances, wantInstance)
	}

	enabledInstances, err := s.ListEnabledInstancesByService(ctx, "echo")
	if err != nil {
		t.Fatal(err)
	}
	if len(enabledInstances) != 1 || !reflect.DeepEqual(enabledInstances[0], wantInstance) {
		t.Fatalf("ListEnabledInstancesByService mismatch:\n got %+v\nwant %+v", enabledInstances, wantInstance)
	}

	capsets, err := s.ListCapsets(ctx)
	if err != nil {
		t.Fatal(err)
	}
	wantCapset, err := s.GetCapset(ctx, "dev")
	if err != nil {
		t.Fatal(err)
	}
	if len(capsets) != 1 || !reflect.DeepEqual(capsets[0], wantCapset) {
		t.Fatalf("ListCapsets mismatch:\n got %+v\nwant %+v", capsets, wantCapset)
	}

	capsetInstances, err := s.ListCapsetInstances(ctx, "dev")
	if err != nil {
		t.Fatal(err)
	}
	wantCapsetInstance, err := s.GetCapsetInstance(ctx, "dev:echo-test")
	if err != nil {
		t.Fatal(err)
	}
	if len(capsetInstances) != 1 || !reflect.DeepEqual(capsetInstances[0], wantCapsetInstance) {
		t.Fatalf("ListCapsetInstances mismatch:\n got %+v\nwant %+v", capsetInstances, wantCapsetInstance)
	}

	methods, err := s.ListCapsetMethods(ctx, "dev:echo-test")
	if err != nil {
		t.Fatal(err)
	}
	wantMethod, err := s.GetCapsetMethod(ctx, "dev:echo-test", "echo.v1.EchoService/Echo")
	if err != nil {
		t.Fatal(err)
	}
	if len(methods) != 2 || !reflect.DeepEqual(methods[0], wantMethod) {
		t.Fatalf("ListCapsetMethods mismatch:\n got %+v\nwant %+v", methods, wantMethod)
	}
}

func TestListQueriesCompleteAboveConnectionLimit(t *testing.T) {
	s, err := Open(t.TempDir() + "/octobus.db")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	ctx := context.Background()
	seedListFixture(t, ctx, s)

	listCalls := []struct {
		name string
		fn   func(context.Context) error
	}{
		{"services", func(ctx context.Context) error {
			_, err := s.ListServices(ctx)
			return err
		}},
		{"instances", func(ctx context.Context) error {
			_, err := s.ListInstances(ctx)
			return err
		}},
		{"enabled instances", func(ctx context.Context) error {
			_, err := s.ListEnabledInstancesByService(ctx, "echo")
			return err
		}},
		{"capsets", func(ctx context.Context) error {
			_, err := s.ListCapsets(ctx)
			return err
		}},
		{"capset instances", func(ctx context.Context) error {
			_, err := s.ListCapsetInstances(ctx, "dev")
			return err
		}},
		{"capset methods", func(ctx context.Context) error {
			_, err := s.ListCapsetMethods(ctx, "dev:echo-test")
			return err
		}},
	}

	for _, tc := range listCalls {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			errs := make(chan error, 8)
			var wg sync.WaitGroup
			for i := 0; i < 8; i++ {
				wg.Add(1)
				go func() {
					defer wg.Done()
					errs <- tc.fn(ctx)
				}()
			}
			wg.Wait()
			close(errs)
			for err := range errs {
				if err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}

func TestFindExposedMethodAndToolMatchListPath(t *testing.T) {
	s, err := Open(t.TempDir() + "/octobus.db")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	ctx := context.Background()
	seedListFixture(t, ctx, s)
	if err := s.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-test", MethodFullName: "echo.v1.EchoService/DefaultTool", Enabled: true}); err != nil {
		t.Fatal(err)
	}

	items, err := s.ListExposedMethods(ctx, "dev")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 0 && items[0].Service.RuntimeMode != domain.RuntimeModeLongRunning {
		t.Fatalf("exposed method runtime mode = %q", items[0].Service.RuntimeMode)
	}
	if len(items) != 0 && items[0].Service.ServiceRoot != "services/echo" {
		t.Fatalf("exposed method service root = %q", items[0].Service.ServiceRoot)
	}
	if len(items) != 3 {
		t.Fatalf("exposed methods len=%d, want 3: %+v", len(items), items)
	}

	for _, item := range items {
		byMethod, err := s.FindExposedMethod(ctx, item.Capset.ID, item.Service.ID, item.Instance.ID, item.Method.FullName)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(byMethod, item) {
			t.Fatalf("FindExposedMethod mismatch:\n got %+v\nwant %+v", byMethod, item)
		}

		byInstance, err := s.FindExposedMethodByInstance(ctx, item.Capset.ID, item.Instance.ID, item.Method.FullName)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(byInstance, item) {
			t.Fatalf("FindExposedMethodByInstance mismatch:\n got %+v\nwant %+v", byInstance, item)
		}
		if item.ConnectPath != ConnectRPCPath(item.Capset.ID, item.Instance.ID, item.Method.FullName) {
			t.Fatalf("ConnectPath=%q", item.ConnectPath)
		}

		if item.Method.Unary {
			byTool, err := s.FindTool(ctx, item.Capset.ID, item.MCPToolName)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(byTool, item) {
				t.Fatalf("FindTool mismatch:\n got %+v\nwant %+v", byTool, item)
			}

			exists, err := s.MCPToolNameExists(ctx, item.Capset.ID, item.MCPToolName)
			if err != nil {
				t.Fatal(err)
			}
			if !exists {
				t.Fatalf("MCPToolNameExists(%q)=false, want true", item.MCPToolName)
			}
		}
	}

	exists, err := s.MCPToolNameExists(ctx, "dev", "missing_tool")
	if err != nil {
		t.Fatal(err)
	}
	if exists {
		t.Fatal("MCPToolNameExists(missing_tool)=true, want false")
	}
}

func TestFindExposedMethodDistinguishesKnownStreamingMethods(t *testing.T) {
	s, err := Open(t.TempDir() + "/octobus.db")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	ctx := context.Background()
	seedListFixture(t, ctx, s)

	item, err := s.FindExposedMethod(ctx, "dev", "echo", "echo-test", "echo.v1.EchoService/ServerStream")
	if err != nil {
		t.Fatalf("FindExposedMethod streaming err=%v", err)
	}
	if item.Method.Unary || !item.Method.ServerStreaming {
		t.Fatalf("FindExposedMethod streaming item=%+v", item.Method)
	}

	item, err = s.FindExposedMethodByInstance(ctx, "dev", "echo-test", "echo.v1.EchoService/ServerStream")
	if err != nil {
		t.Fatalf("FindExposedMethodByInstance streaming err=%v", err)
	}
	if item.Method.Unary || !item.Method.ServerStreaming {
		t.Fatalf("FindExposedMethodByInstance streaming item=%+v", item.Method)
	}

	_, err = s.FindTool(ctx, "dev", "echo__echo-test__server_stream")
	if !errors.Is(err, domain.ErrMethodNotUnary) {
		t.Fatalf("FindTool err=%v want domain.ErrMethodNotUnary", err)
	}

	_, err = s.FindExposedMethod(ctx, "dev", "echo", "echo-test", "echo.v1.EchoService/Missing")
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("missing method err=%v want sql.ErrNoRows", err)
	}
}

func TestFindKnownCapsetMethod(t *testing.T) {
	s, err := Open(t.TempDir() + "/octobus.db")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	ctx := context.Background()
	seedListFixture(t, ctx, s)

	method, err := s.findKnownCapsetMethod(ctx, "dev", "echo", "echo-test", "/echo.v1.EchoService/Echo")
	if err != nil {
		t.Fatal(err)
	}
	if method.FullName != "echo.v1.EchoService/Echo" || !method.Unary {
		t.Fatalf("method=%+v", method)
	}
	if _, err := s.findKnownCapsetMethod(ctx, "dev", "echo", "echo-test", "echo.v1.EchoService/Missing"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("missing method err=%v", err)
	}
	if _, err := s.findKnownCapsetMethod(ctx, "missing", "echo", "echo-test", "echo.v1.EchoService/Echo"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("missing capset err=%v", err)
	}
}

func TestStoreAdditionalBoundaryBranches(t *testing.T) {
	s, err := Open(t.TempDir() + "/octobus.db")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	ctx := context.Background()
	seedListFixture(t, ctx, s)

	if err := s.UpsertService(ctx, domain.Service{ID: "bad/id", RuntimeMode: domain.RuntimeModeLongRunning}); err == nil {
		t.Fatal("expected invalid service id error")
	}
	if err := s.UpsertService(ctx, domain.Service{ID: "bad-runtime", RuntimeMode: domain.RuntimeMode("invalid")}); err == nil {
		t.Fatal("expected invalid runtime mode error")
	}
	if _, err := s.UpdateServiceMetadata(ctx, "echo", ""); err == nil || !strings.Contains(err.Error(), "service name is required") {
		t.Fatalf("expected empty service name error, got %v", err)
	}
	if _, err := s.UpdateServiceMetadata(ctx, "missing", "Missing"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("missing service update err=%v", err)
	}
	if err := s.UpsertInstance(ctx, domain.Instance{ID: "bad/id", ServiceID: "echo"}); err == nil {
		t.Fatal("expected invalid instance id error")
	}
	if err := s.UpsertInstance(ctx, domain.Instance{ID: "bad-service", ServiceID: "bad/id"}); err == nil {
		t.Fatal("expected invalid instance service id error")
	}
	if err := s.CreateCapset(ctx, domain.Capset{ID: "bad/id"}); err == nil {
		t.Fatal("expected invalid capset id error")
	}
	if err := s.UpsertCapset(ctx, domain.Capset{ID: "bad/id"}); err == nil {
		t.Fatal("expected invalid upsert capset id error")
	}

	disabled := domain.Capset{ID: "disabled", Name: "Disabled", Enabled: false}
	if err := s.UpsertCapset(ctx, disabled); err != nil {
		t.Fatal(err)
	}
	gotDisabled, err := s.GetCapset(ctx, "disabled")
	if err != nil {
		t.Fatal(err)
	}
	if gotDisabled.Enabled {
		t.Fatalf("disabled capset stored as enabled: %+v", gotDisabled)
	}
	if got := boolInt(true); got != 1 {
		t.Fatalf("boolInt(true)=%d", got)
	}
	if got := boolInt(false); got != 0 {
		t.Fatalf("boolInt(false)=%d", got)
	}
}

func TestFindToolAmbiguousAndStreamingCustomNames(t *testing.T) {
	s, err := Open(t.TempDir() + "/octobus.db")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	ctx := context.Background()
	seedListFixture(t, ctx, s)

	if err := s.UpsertInstance(ctx, domain.Instance{ID: "echo-copy", ServiceID: "echo", Name: "Echo Copy", Enabled: true, NodeEntry: "entry", ConfigJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := s.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:echo-copy", CapsetID: "dev", ServiceID: "echo", InstanceID: "echo-copy", IncludeAllMethods: false, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := s.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-copy", MethodFullName: "echo.v1.EchoService/Echo", MCPToolName: "echo_tool", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.FindTool(ctx, "dev", "echo_tool"); err == nil || !strings.Contains(err.Error(), "ambiguous MCP tool name") {
		t.Fatalf("expected ambiguous MCP tool error, got %v", err)
	}
	if exists, err := s.MCPToolNameExists(ctx, "dev", "echo_tool"); err == nil || !strings.Contains(err.Error(), "ambiguous MCP tool name") || exists {
		t.Fatalf("MCPToolNameExists ambiguous exists=%v err=%v", exists, err)
	}

	if err := s.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-copy", MethodFullName: "echo.v1.EchoService/ServerStream", MCPToolName: "stream_custom", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.FindTool(ctx, "dev", "stream_custom"); !errors.Is(err, domain.ErrMethodNotUnary) {
		t.Fatalf("custom streaming tool err=%v", err)
	}
	if _, err := s.FindExposedMethodByInstance(ctx, "dev", "echo-test", "echo.v1.EchoService/Missing"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("missing method by instance err=%v", err)
	}
}

func TestScanHelpersReturnScanAndDecodeErrors(t *testing.T) {
	scanErr := errors.New("scan failed")
	errScanner := scannerFunc(func(dest ...any) error { return scanErr })
	for _, tc := range []struct {
		name string
		fn   func() error
	}{
		{name: "service", fn: func() error { _, err := scanService(errScanner); return err }},
		{name: "instance", fn: func() error { _, err := scanInstance(errScanner); return err }},
		{name: "capset", fn: func() error { _, err := scanCapset(errScanner); return err }},
		{name: "capset instance", fn: func() error { _, err := scanCapsetInstance(errScanner); return err }},
		{name: "capset method", fn: func() error { _, err := scanCapsetMethod(errScanner); return err }},
		{name: "exposed method", fn: func() error {
			_, _, err := scanExposedMethod(errScanner, map[string]domain.Service{})
			return err
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.fn(); !errors.Is(err, scanErr) {
				t.Fatalf("err=%v want %v", err, scanErr)
			}
		})
	}

	_, err := scanService(scannerFunc(func(dest ...any) error {
		values := []any{
			"svc", "Svc", "source", "pkg", "pkgsha", "1.0.0", "proto", "protosha", "desc", "descsha", "descver", "{", "entry", ".", string(domain.RuntimeModeLongRunning), "config.schema.json", "secret.schema.json", "bad-created", "bad-updated",
		}
		scanValues(t, dest, values...)
		return nil
	}))
	if err == nil {
		t.Fatal("expected invalid service methods JSON error")
	}

	_, ok, err := scanExposedMethod(scannerFunc(func(dest ...any) error {
		scanExposedValues(t, dest, "{", "echo.v1.EchoService/Echo")
		return nil
	}), map[string]domain.Service{})
	if err == nil || ok {
		t.Fatalf("expected invalid exposed methods JSON error, ok=%v err=%v", ok, err)
	}

	item, ok, err := scanExposedMethod(scannerFunc(func(dest ...any) error {
		scanExposedValues(t, dest, `[{"fullName":"echo.v1.EchoService/Echo","name":"Echo","unary":true}]`, "echo.v1.EchoService/Missing")
		return nil
	}), map[string]domain.Service{})
	if err != nil || ok || item.Method.FullName != "" {
		t.Fatalf("missing exposed method item=%+v ok=%v err=%v", item, ok, err)
	}
}

func TestStoreClosedDBErrorBranches(t *testing.T) {
	s, err := Open(t.TempDir() + "/octobus.db")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	service := domain.Service{
		ID:                  "echo",
		Name:                "Echo",
		PackageSource:       "fixture",
		PackageArtifactPath: "pkg",
		PackageSHA256:       "pkgsha",
		DescriptorPath:      "desc",
		DescriptorSHA256:    "descsha",
		DescriptorVersion:   "descsha",
		NodeEntry:           "entry",
		Methods:             []domain.Method{{FullName: "echo.v1.EchoService/Echo", Unary: true}},
	}

	for _, tc := range []struct {
		name string
		fn   func() error
	}{
		{name: "migrate", fn: func() error { return s.Migrate(ctx) }},
		{name: "add column", fn: func() error { return addColumnIfMissing(ctx, s.DB(), "services", "closed_db_column", "TEXT") }},
		{name: "upsert service", fn: func() error { return s.UpsertService(ctx, service) }},
		{name: "list services", fn: func() error { _, err := s.ListServices(ctx); return err }},
		{name: "count services", fn: func() error { _, err := s.CountServices(ctx); return err }},
		{name: "update service", fn: func() error { _, err := s.UpdateServiceMetadata(ctx, "echo", "Echo"); return err }},
		{name: "delete service", fn: func() error { return s.DeleteService(ctx, "echo") }},
		{name: "upsert instance", fn: func() error {
			return s.UpsertInstance(ctx, domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", ConfigJSON: []byte(`{}`)})
		}},
		{name: "list instances", fn: func() error { _, err := s.ListInstances(ctx); return err }},
		{name: "list enabled instances", fn: func() error { _, err := s.ListEnabledInstancesByService(ctx, "echo"); return err }},
		{name: "delete instance", fn: func() error { return s.DeleteInstance(ctx, "echo-test") }},
		{name: "upsert capset", fn: func() error { return s.UpsertCapset(ctx, domain.Capset{ID: "dev", Name: "Dev"}) }},
		{name: "create capset", fn: func() error { return s.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev"}) }},
		{name: "list capsets", fn: func() error { _, err := s.ListCapsets(ctx); return err }},
		{name: "delete capset", fn: func() error { return s.DeleteCapset(ctx, "dev") }},
		{name: "add capset token", fn: func() error {
			_, err := s.AddCapsetToken(ctx, domain.CapsetToken{ID: "key", CapsetID: "dev"}, "secret")
			return err
		}},
		{name: "get capset token", fn: func() error { _, err := s.GetCapsetToken(ctx, "dev", "key"); return err }},
		{name: "list capset tokens", fn: func() error { _, err := s.ListCapsetTokens(ctx, "dev"); return err }},
		{name: "delete capset token", fn: func() error { return s.DeleteCapsetToken(ctx, "dev", "key") }},
		{name: "capset requires token", fn: func() error { _, err := s.CapsetRequiresToken(ctx, "dev"); return err }},
		{name: "verify capset token", fn: func() error { _, err := s.VerifyCapsetToken(ctx, "dev", "secret"); return err }},
		{name: "add admin token", fn: func() error {
			_, err := s.AddAdminToken(ctx, domain.AdminToken{ID: "key"}, "secret")
			return err
		}},
		{name: "get admin token", fn: func() error { _, err := s.GetAdminToken(ctx, "key"); return err }},
		{name: "list admin tokens", fn: func() error { _, err := s.ListAdminTokens(ctx); return err }},
		{name: "delete admin token", fn: func() error { return s.DeleteAdminToken(ctx, "key") }},
		{name: "admin requires token", fn: func() error { _, err := s.AdminRequiresToken(ctx); return err }},
		{name: "verify admin token", fn: func() error { _, err := s.VerifyAdminToken(ctx, "secret"); return err }},
		{name: "add capset instance", fn: func() error {
			return s.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:echo-test", CapsetID: "dev", ServiceID: "echo", InstanceID: "echo-test"})
		}},
		{name: "list capset instances", fn: func() error { _, err := s.ListCapsetInstances(ctx, "dev"); return err }},
		{name: "delete capset instance", fn: func() error { return s.DeleteCapsetInstance(ctx, "dev", "echo-test") }},
		{name: "add capset method", fn: func() error {
			return s.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-test", MethodFullName: "echo.v1.EchoService/Echo"})
		}},
		{name: "list capset methods", fn: func() error { _, err := s.ListCapsetMethods(ctx, "dev:echo-test"); return err }},
		{name: "delete capset method", fn: func() error { return s.DeleteCapsetMethod(ctx, "dev", "echo-test", "echo.v1.EchoService/Echo") }},
		{name: "query exposed methods", fn: func() error { _, err := s.queryExposedMethods(ctx, "c.id = ?", []any{"dev"}, ""); return err }},
		{name: "find known capset method", fn: func() error {
			_, err := s.findKnownCapsetMethod(ctx, "dev", "echo", "echo-test", "echo.v1.EchoService/Echo")
			return err
		}},
		{name: "find known capset method by instance", fn: func() error {
			_, err := s.findKnownCapsetMethodByInstance(ctx, "dev", "echo-test", "echo.v1.EchoService/Echo")
			return err
		}},
		{name: "find known streaming tool", fn: func() error { return s.findKnownStreamingTool(ctx, "dev", "echo__echo-test__stream") }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.fn(); err == nil {
				t.Fatal("expected closed database error")
			}
		})
	}
}

func TestMigrateCreatesIndexesIdempotently(t *testing.T) {
	s, err := Open(t.TempDir() + "/octobus.db")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	ctx := context.Background()
	if err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}

	wantIndexes := []string{
		"idx_instances_service_enabled",
		"idx_capset_instances_capset",
		"idx_capset_instances_instance",
		"idx_capset_instances_service_instance",
		"idx_capset_methods_instance_method",
		"idx_capset_methods_mcp_tool",
		"idx_capset_tokens_hash",
	}
	for _, name := range wantIndexes {
		var got string
		err := s.DB().QueryRowContext(ctx, `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`, name).Scan(&got)
		if err != nil {
			t.Fatalf("index %s missing: %v", name, err)
		}
	}
}

type scannerFunc func(dest ...any) error

func (f scannerFunc) Scan(dest ...any) error { return f(dest...) }

func scanValues(t *testing.T, dest []any, values ...any) {
	t.Helper()
	if len(dest) != len(values) {
		t.Fatalf("scan destination count=%d, values=%d", len(dest), len(values))
	}
	for i, value := range values {
		switch ptr := dest[i].(type) {
		case *string:
			*ptr = value.(string)
		case *int:
			*ptr = value.(int)
		case *sql.NullInt64:
			if value == nil {
				*ptr = sql.NullInt64{}
				continue
			}
			*ptr = sql.NullInt64{Int64: int64(value.(int)), Valid: true}
		default:
			t.Fatalf("unsupported scan destination %d: %T", i, dest[i])
		}
	}
}

func scanExposedValues(t *testing.T, dest []any, methodsJSON, methodFullName string) {
	t.Helper()
	scanValues(t, dest,
		"dev", "Dev", "Development", 1, "bad-created", "bad-updated",
		"dev:echo-test", "dev", "echo", "echo-test", "echo", 1, 1, "bad-created", "bad-updated",
		"dev:echo-test:"+methodFullName, "dev:echo-test", methodFullName, "echo", "", 1, "bad-created", "bad-updated",
		"echo-test", "echo", "Echo Test", 1, string(domain.StatusRunning), 123, "127.0.0.1:1", "entry", `{"mode":"test"}`, "configsha", "bad-created", "bad-updated",
		"echo", "Echo", "source", "pkg", "pkgsha", "1.0.0", "proto", "protosha", "desc", "descsha", "descver", methodsJSON, "entry", "services/echo", string(domain.RuntimeModeLongRunning), "config.schema.json", "secret.schema.json", "bad-created", "bad-updated",
	)
}

func seedListFixture(t *testing.T, ctx context.Context, s *Store) {
	t.Helper()
	svc := domain.Service{
		ID:                  "echo",
		Name:                "Echo",
		PackageSource:       "fixture",
		PackageArtifactPath: "pkg",
		PackageSHA256:       "pkgsha",
		DescriptorPath:      "desc",
		DescriptorSHA256:    "descsha",
		DescriptorVersion:   "descsha",
		NodeEntry:           "entry",
		ServiceRoot:         "services/echo",
		Methods: []domain.Method{{
			FullName:        "echo.v1.EchoService/Echo",
			ServiceFullName: "echo.v1.EchoService",
			Name:            "Echo",
			InputFullName:   "echo.v1.EchoRequest",
			OutputFullName:  "echo.v1.EchoResponse",
			Unary:           true,
		}, {
			FullName:        "echo.v1.EchoService/DefaultTool",
			ServiceFullName: "echo.v1.EchoService",
			Name:            "DefaultTool",
			InputFullName:   "echo.v1.DefaultToolRequest",
			OutputFullName:  "echo.v1.DefaultToolResponse",
			Unary:           true,
		}, {
			FullName:        "echo.v1.EchoService/ServerStream",
			ServiceFullName: "echo.v1.EchoService",
			Name:            "ServerStream",
			InputFullName:   "echo.v1.EchoRequest",
			OutputFullName:  "echo.v1.EchoResponse",
			ServerStreaming: true,
		}},
	}
	if err := s.UpsertService(ctx, svc); err != nil {
		t.Fatal(err)
	}
	inst := domain.Instance{ID: "echo-test", ServiceID: "echo", Name: "Echo Test", Enabled: true, NodeEntry: "entry", ConfigJSON: []byte(`{"mode":"test"}`)}
	if err := s.UpsertInstance(ctx, inst); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Description: "Development", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	ci := domain.CapsetInstance{ID: "dev:echo-test", CapsetID: "dev", ServiceID: "echo", InstanceID: "echo-test", Alias: "echo", IncludeAllMethods: true, Enabled: true}
	if err := s.AddCapsetInstance(ctx, ci); err != nil {
		t.Fatal(err)
	}
	method := domain.CapsetMethod{CapsetInstanceID: "dev:echo-test", MethodFullName: "/echo.v1.EchoService/Echo", RestAlias: "echo", MCPToolName: "echo_tool", Enabled: true}
	if err := s.AddCapsetMethod(ctx, method); err != nil {
		t.Fatal(err)
	}
	if err := s.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-test", MethodFullName: "echo.v1.EchoService/ServerStream", Enabled: true}); err != nil {
		t.Fatal(err)
	}
}
