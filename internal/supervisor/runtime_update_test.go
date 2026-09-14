package supervisor

import (
	"context"
	"errors"
	"testing"

	"octobus/internal/domain"
	"octobus/internal/store"
)

func TestRuntimeControlRejectionPrecedesInstanceMutation(t *testing.T) {
	st, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	if err := st.UpsertService(ctx, domain.Service{ID: "on-demand", Name: "On Demand", RuntimeMode: domain.RuntimeModeOnDemand}); err != nil {
		t.Fatal(err)
	}
	originalConfig := []byte(`{"value":"before"}`)
	originalSecret := []byte(`{"token":"before"}`)
	if err := st.UpsertInstance(ctx, domain.Instance{ID: "instance", ServiceID: "on-demand", Name: "Instance", Enabled: true, Status: domain.StatusRunning, ConfigJSON: originalConfig, SecretJSON: originalSecret}); err != nil {
		t.Fatal(err)
	}

	sup := New(t.TempDir(), st)
	if _, err := sup.UpdateConfig(ctx, "instance", []byte(`{"value":"after"}`), true); !errors.Is(err, ErrUnsupportedRuntimeControl) {
		t.Fatalf("config restart error = %v", err)
	}
	if _, err := sup.UpdateSecret(ctx, "instance", []byte(`{"token":"after"}`), true); !errors.Is(err, ErrUnsupportedRuntimeControl) {
		t.Fatalf("secret restart error = %v", err)
	}
	got, err := st.GetInstance(ctx, "instance")
	if err != nil {
		t.Fatal(err)
	}
	if string(got.ConfigJSON) != string(originalConfig) || string(got.SecretJSON) != string(originalSecret) {
		t.Fatalf("rejected runtime control mutated instance: %+v", got)
	}
}
