package store

import (
	"context"
	"os"
	"strings"
	"testing"

	"octobus/internal/domain"
)

func TestInstanceSecretsAreEncryptedAtRestAndReadableAcrossReopen(t *testing.T) {
	dbPath := t.TempDir() + "/octobus.db"
	ctx := context.Background()
	st, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertService(ctx, domain.Service{ID: "secret-service", Name: "Secret Service"}); err != nil {
		t.Fatal(err)
	}
	plain := []byte(`{"apiToken":"do-not-store-plaintext"}`)
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "secret-instance", ServiceID: "secret-service", Name: "Instance", SecretJSON: plain}); err != nil {
		t.Fatal(err)
	}
	var stored string
	if err := st.DB().QueryRowContext(ctx, `SELECT secret_json FROM instances WHERE id = ?`, "secret-instance").Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(stored, "do-not-store-plaintext") || !strings.HasPrefix(stored, encryptedSecretPrefix) {
		t.Fatalf("secret at rest is not encrypted: %q", stored)
	}
	if err := st.Close(); err != nil {
		t.Fatal(err)
	}

	st, err = Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	got, err := st.GetInstance(ctx, "secret-instance")
	if err != nil {
		t.Fatal(err)
	}
	if string(got.SecretJSON) != string(plain) {
		t.Fatalf("decrypted secret = %s", got.SecretJSON)
	}
}

func TestOpenFailsWhenSecretKeyIsMissingForEncryptedData(t *testing.T) {
	t.Setenv(secretKeyEnv, "")
	dbPath := t.TempDir() + "/octobus.db"
	ctx := context.Background()
	st, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertService(ctx, domain.Service{ID: "secret-service", Name: "Secret Service"}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "secret-instance", ServiceID: "secret-service", Name: "Instance", SecretJSON: []byte(`{"token":"value"}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(dbPath + ".secret-key"); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(dbPath); err == nil || !strings.Contains(err.Error(), "encrypted instance secrets exist") {
		t.Fatalf("missing secret key error = %v", err)
	}
}

func TestLegacyInstanceSecretsAreEncryptedDuringMigration(t *testing.T) {
	dbPath := t.TempDir() + "/octobus.db"
	ctx := context.Background()
	st, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertService(ctx, domain.Service{ID: "legacy-service", Name: "Legacy Service"}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "legacy-instance", ServiceID: "legacy-service", Name: "Instance", SecretJSON: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.DB().ExecContext(ctx, `UPDATE instances SET secret_json = ? WHERE id = ?`, `{"legacy":"secret"}`, "legacy-instance"); err != nil {
		t.Fatal(err)
	}
	if err := st.Close(); err != nil {
		t.Fatal(err)
	}

	st, err = Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	var stored string
	if err := st.DB().QueryRowContext(ctx, `SELECT secret_json FROM instances WHERE id = ?`, "legacy-instance").Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(stored, "legacy") || !strings.HasPrefix(stored, encryptedSecretPrefix) {
		t.Fatalf("legacy secret was not migrated: %q", stored)
	}
	got, err := st.GetInstance(ctx, "legacy-instance")
	if err != nil {
		t.Fatal(err)
	}
	if string(got.SecretJSON) != `{"legacy":"secret"}` {
		t.Fatalf("migrated secret = %s", got.SecretJSON)
	}
}
