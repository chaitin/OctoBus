package supervisor

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"

	"octobus/internal/domain"
	"octobus/internal/store"
)

// Every lifecycle call starts by reading the instance and its service, so a
// store that cannot answer has to fail the call instead of acting on a zero
// value: starting or deleting the wrong instance is worse than refusing.
//
// Each case seeds the service and instance it will read first, so the failure
// can only come from the dropped table — against an empty store the call fails
// with "no rows" whether the table exists or not, which would pass while
// proving nothing. The error has to name the table for the same reason.
func TestLifecycleCallsReportStoreFailures(t *testing.T) {
	ctx := context.Background()

	seed := func(t *testing.T, st *store.Store) {
		t.Helper()
		if err := st.UpsertService(ctx, domain.Service{
			ID: "svc", Name: "Svc", PackageSource: "fixture", PackageArtifactPath: "pkg",
			PackageSHA256: "pkgsha", DescriptorPath: "desc", DescriptorSHA256: "descsha",
			DescriptorVersion: "descsha", NodeEntry: "entry",
		}); err != nil {
			t.Fatal(err)
		}
		if err := st.UpsertInstance(ctx, domain.Instance{ID: "inst", ServiceID: "svc", Status: domain.StatusStopped}); err != nil {
			t.Fatal(err)
		}
	}

	cases := []struct {
		name  string
		table string
		call  func(*Supervisor) error
	}{
		{
			name:  "Start without instances",
			table: "instances",
			call:  func(sup *Supervisor) error { return sup.Start(ctx, "inst") },
		},
		{
			name:  "Start without services",
			table: "services",
			call:  func(sup *Supervisor) error { return sup.Start(ctx, "inst") },
		},
		{
			name:  "Stop without instances",
			table: "instances",
			call:  func(sup *Supervisor) error { return sup.Stop(ctx, "inst") },
		},
		{
			name:  "Restart without instances",
			table: "instances",
			call:  func(sup *Supervisor) error { return sup.Restart(ctx, "inst") },
		},
		{
			name:  "Delete without instances",
			table: "instances",
			call:  func(sup *Supervisor) error { return sup.DeleteInstance(ctx, "inst") },
		},
		{
			name:  "UpdateConfig without instances",
			table: "instances",
			call: func(sup *Supervisor) error {
				_, err := sup.UpdateConfig(ctx, "inst", json.RawMessage(`{}`), false)
				return err
			},
		},
		{
			name:  "UpdateSecret without instances",
			table: "instances",
			call: func(sup *Supervisor) error {
				_, err := sup.UpdateSecret(ctx, "inst", json.RawMessage(`{}`), false)
				return err
			},
		},
		{
			name:  "CreateInstance without instances",
			table: "instances",
			call: func(sup *Supervisor) error {
				_, err := sup.CreateInstance(ctx, CreateInstanceRequest{
					ID: "other", ServiceID: "svc",
					Config: json.RawMessage(`{}`), Secret: json.RawMessage(`{}`),
				})
				return err
			},
		},
		{
			name:  "RecoverEnabled without instances",
			table: "instances",
			call:  func(sup *Supervisor) error { _, err := sup.RecoverEnabled(ctx); return err },
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Two supervisors whose stores differ only in that table. The call has to
			// fail in one and not the same way in the other, which is what attributes
			// the failure to the table; asserting on the database's error text would
			// instead break the day something wraps that text, a change this should
			// allow. The healthy call is not asserted to succeed: these fixtures hold no
			// runnable runtime, so several of them fail for reasons of their own.
			healthy := seededSupervisor(t, seed)
			broken := seededSupervisor(t, seed)
			// The fault is the table disappearing from under its queries. Renaming it
			// leaves the schema intact and needs no foreign-key juggling, which a DROP
			// would: that pragma is connection-scoped while the pool re-enables it per
			// connection.
			if _, err := broken.Store.DB().ExecContext(ctx, `ALTER TABLE `+tc.table+` RENAME TO `+tc.table+`_gone`); err != nil {
				t.Fatal(err)
			}

			brokenErr := tc.call(broken)
			if brokenErr == nil {
				t.Fatalf("%s acted on a store without %s", tc.name, tc.table)
			}
			if healthyErr := tc.call(healthy); healthyErr != nil && healthyErr.Error() == brokenErr.Error() {
				t.Fatalf("%s failed the same way with and without %s: %v", tc.name, tc.table, brokenErr)
			}
		})
	}
}

// seededSupervisor builds a supervisor over a store seeded with the rows a case
// reads.
func seededSupervisor(t *testing.T, seed func(*testing.T, *store.Store)) *Supervisor {
	t.Helper()
	root := t.TempDir()
	st, err := store.Open(filepath.Join(root, "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	seed(t, st)
	return New(root, st)
}
