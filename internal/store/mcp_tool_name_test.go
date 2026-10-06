package store

import (
	"context"
	"errors"
	"strings"
	"testing"

	"octobus/internal/domain"
)

func TestMigrateReportsExistingMCPToolConflicts(t *testing.T) {
	st, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo"}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-instance", ServiceID: "echo", Name: "Echo", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:echo-instance", CapsetID: "dev", ServiceID: "echo", InstanceID: "echo-instance", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-instance", MethodFullName: "echo.Echo/Call", MCPToolName: "shared_tool", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.DB().ExecContext(ctx, `DROP INDEX uq_capset_methods_mcp_tool_key`); err != nil {
		t.Fatal(err)
	}
	if _, err := st.DB().ExecContext(ctx, `INSERT INTO capset_methods (id, capset_instance_id, method_full_name, mcp_tool_name, mcp_tool_key, created_at, updated_at) VALUES (?, ?, ?, ?, '', ?, ?)`, "duplicate", "dev:echo-instance", "echo.Echo/Other", "shared_tool", "", ""); err != nil {
		t.Fatal(err)
	}
	if err := st.Migrate(ctx); err == nil || !strings.Contains(err.Error(), "conflicting methods") {
		t.Fatalf("migration conflict error = %v", err)
	}
}

func TestMigrateReportsCrossInstanceConflictsWithLegacyIndex(t *testing.T) {
	// Simulate a database created by an older release: the mcp_tool_key column
	// holds instance-scoped keys (capset_instance_id || sep || name), and
	// uq_capset_methods_mcp_tool_key is the legacy instance-scoped unique
	// index, so the same tool name can legitimately exist on two instances of
	// one capset. Upgrading to capset-scoped keys must surface the friendly
	// conflict error, not the raw UNIQUE constraint failure from the stale
	// index.
	st, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo"}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-instance", ServiceID: "echo", Name: "Echo", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-copy", ServiceID: "echo", Name: "Echo Copy", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	for _, instanceID := range []string{"echo-instance", "echo-copy"} {
		if err := st.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:" + instanceID, CapsetID: "dev", ServiceID: "echo", InstanceID: instanceID, Enabled: true}); err != nil {
			t.Fatal(err)
		}
	}

	// Rebuild the state an old database would have before this release runs.
	if _, err := st.DB().ExecContext(ctx, `DROP INDEX uq_capset_methods_mcp_tool_key`); err != nil {
		t.Fatal(err)
	}
	for i, method := range []string{"echo.Echo/Call", "echo.Echo/Other"} {
		instanceID := "echo-instance"
		if i == 1 {
			instanceID = "echo-copy"
		}
		if _, err := st.DB().ExecContext(ctx, `INSERT INTO capset_methods (id, capset_instance_id, method_full_name, mcp_tool_name, mcp_tool_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, "legacy-"+method, "dev:"+instanceID, method, "shared_tool", "dev:"+instanceID+string(rune(31))+"shared_tool", "", ""); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := st.DB().ExecContext(ctx, `CREATE UNIQUE INDEX uq_capset_methods_mcp_tool_key ON capset_methods(mcp_tool_key) WHERE mcp_tool_key <> ''`); err != nil {
		t.Fatal(err)
	}

	err = st.Migrate(ctx)
	if err == nil {
		t.Fatal("migration succeeded with conflicting MCP tool names")
	}
	if strings.Contains(err.Error(), "UNIQUE") && !strings.Contains(err.Error(), "conflicting methods") {
		t.Fatalf("migration surfaced the raw UNIQUE error instead of the friendly conflict: %v", err)
	}
	if !strings.Contains(err.Error(), "conflicting methods") || !strings.Contains(err.Error(), `"shared_tool"`) || !strings.Contains(err.Error(), `"dev"`) {
		t.Fatalf("migration conflict error should name tool and capset: %v", err)
	}
	if strings.Contains(err.Error(), string(rune(31))) {
		t.Fatalf("migration conflict error leaks the internal key separator: %v", err)
	}

	// The conflict must be detected before any destructive step: the legacy
	// instance-scoped index and the instance-scoped keys must be untouched so
	// the database can be rolled back losslessly and still rejects duplicate
	// mcp_tool_key writes.
	var indexName string
	if err := st.DB().QueryRowContext(ctx, `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'uq_capset_methods_mcp_tool_key'`).Scan(&indexName); err != nil {
		t.Fatalf("legacy unique index was dropped by the failed migration: %v", err)
	}
	var legacyKey string
	if err := st.DB().QueryRowContext(ctx, `SELECT mcp_tool_key FROM capset_methods WHERE id = 'legacy-echo.Echo/Call'`).Scan(&legacyKey); err != nil {
		t.Fatal(err)
	}
	if legacyKey != "dev:echo-instance"+string(rune(31))+"shared_tool" {
		t.Fatalf("failed migration rewrote instance-scoped key to %q", legacyKey)
	}
}

func TestAddCapsetMethodEnforcesToolNameUniquenessWithinCapset(t *testing.T) {
	st, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()

	if err := st.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo"}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-instance", ServiceID: "echo", Name: "Echo", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	for _, capsetID := range []string{"dev", "qa"} {
		if err := st.CreateCapset(ctx, domain.Capset{ID: capsetID, Name: capsetID, Enabled: true}); err != nil {
			t.Fatal(err)
		}
		if err := st.AddCapsetInstance(ctx, domain.CapsetInstance{ID: capsetID + ":echo-instance", CapsetID: capsetID, ServiceID: "echo", InstanceID: "echo-instance", Enabled: true}); err != nil {
			t.Fatal(err)
		}
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "echo-copy", ServiceID: "echo", Name: "Echo Copy", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:echo-copy", CapsetID: "dev", ServiceID: "echo", InstanceID: "echo-copy", Enabled: true}); err != nil {
		t.Fatal(err)
	}

	first := domain.CapsetMethod{CapsetInstanceID: "dev:echo-instance", MethodFullName: "echo.Echo/Call", MCPToolName: "shared_tool", Enabled: true}
	if err := st.AddCapsetMethod(ctx, first); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-instance", MethodFullName: "echo.Echo/Other", MCPToolName: "shared_tool", Enabled: true}); !errors.Is(err, ErrMCPToolNameConflict) {
		t.Fatalf("duplicate tool error = %v", err)
	}
	if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:echo-copy", MethodFullName: "echo.Echo/Call", MCPToolName: "shared_tool", Enabled: true}); !errors.Is(err, ErrMCPToolNameConflict) {
		t.Fatalf("cross-instance duplicate tool error = %v", err)
	}
	if err := st.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "qa:echo-instance", MethodFullName: "echo.Echo/Call", MCPToolName: "shared_tool", Enabled: true}); err != nil {
		t.Fatalf("same tool in another capset error = %v", err)
	}
}
