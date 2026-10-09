package store

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"octobus/internal/domain"
)

// A service written without a runtime mode or service root is a row from before
// those columns existed (or a caller that omitted them): it has to store the
// defaults rather than leave the daemon with an empty mode to interpret.
func TestServiceDefaultsRuntimeModeAndServiceRoot(t *testing.T) {
	st, err := Open(filepath.Join(t.TempDir(), "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()

	if err := st.UpsertService(ctx, domain.Service{ID: "legacy", Name: "Legacy"}); err != nil {
		t.Fatal(err)
	}
	svc, err := st.GetService(ctx, "legacy")
	if err != nil {
		t.Fatal(err)
	}
	if svc.RuntimeMode != domain.RuntimeModeLongRunning {
		t.Fatalf("runtime mode=%q want %q", svc.RuntimeMode, domain.RuntimeModeLongRunning)
	}
	if svc.ServiceRoot != "." {
		t.Fatalf("service root=%q want %q", svc.ServiceRoot, ".")
	}
}

// An empty secret never authenticates, and that answer does not need the store:
// the short circuit keeps an unauthenticated request from touching the database.
func TestVerifyCapsetTokenRejectsAnEmptySecret(t *testing.T) {
	st, err := Open(filepath.Join(t.TempDir(), "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	ok, err := st.VerifyCapsetToken(context.Background(), "dev", "")
	if err != nil {
		t.Fatalf("err=%v want no error", err)
	}
	if ok {
		t.Fatal("an empty secret authenticated against a capset")
	}
}

func TestDeleteCapsetTokenReportsAMissingToken(t *testing.T) {
	st, err := Open(filepath.Join(t.TempDir(), "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	if err := st.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev", Enabled: true}); err != nil {
		t.Fatal(err)
	}

	if err := st.DeleteCapsetToken(ctx, "dev", "absent"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("err=%v want sql.ErrNoRows", err)
	}
}
