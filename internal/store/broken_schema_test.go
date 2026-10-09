package store

import (
	"context"
	"path/filepath"
	"testing"

	"octobus/internal/domain"
)

// A store whose schema is not the one the code expects (a drift, a half-run
// migration, corruption) has to return an error from every method that touches
// the missing table. Silent zero values would reach callers as "no such service"
// or an empty listing.
//
// Every case seeds what it is about to read, so the only failure left is the
// missing table: against an empty store a read fails with "no rows" whether the
// table exists or not, which would pass while proving nothing. The error has to
// name the table for the same reason.
// openSeededTestStore opens a store and seeds it with the rows a case reads.
func openSeededTestStore(t *testing.T, seed func(*Store) error) *Store {
	t.Helper()
	st, err := Open(filepath.Join(t.TempDir(), "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	if err := seed(st); err != nil {
		t.Fatalf("seeding the rows to read: %v", err)
	}
	return st
}

func TestStoreMethodsReportABrokenSchema(t *testing.T) {
	ctx := context.Background()

	seedService := func(s *Store) error {
		return s.UpsertService(ctx, domain.Service{ID: "echo", Name: "Echo"})
	}
	seedInstance := func(s *Store) error {
		if err := seedService(s); err != nil {
			return err
		}
		return s.UpsertInstance(ctx, domain.Instance{ID: "inst", ServiceID: "echo"})
	}
	seedCapset := func(s *Store) error {
		return s.CreateCapset(ctx, domain.Capset{ID: "dev", Name: "Dev"})
	}
	seedCapsetInstance := func(s *Store) error {
		if err := seedInstance(s); err != nil {
			return err
		}
		if err := seedCapset(s); err != nil {
			return err
		}
		return s.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:inst", CapsetID: "dev", ServiceID: "echo", InstanceID: "inst"})
	}
	seedCapsetMethod := func(s *Store) error {
		if err := seedCapsetInstance(s); err != nil {
			return err
		}
		return s.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:inst", MethodFullName: "echo.v1.EchoService/Echo"})
	}
	seedCapsetToken := func(s *Store) error {
		if err := seedCapset(s); err != nil {
			return err
		}
		_, err := s.AddCapsetToken(ctx, domain.CapsetToken{ID: "tok", CapsetID: "dev", Name: "Token"}, "capset-secret")
		return err
	}
	seedAdminToken := func(s *Store) error {
		_, err := s.AddAdminToken(ctx, domain.AdminToken{ID: "ops", Name: "Ops"}, "admin-secret")
		return err
	}

	cases := []struct {
		table string
		seed  func(*Store) error
		calls map[string]func(*Store) error
	}{
		{
			table: "services",
			seed:  seedService,
			calls: map[string]func(*Store) error{
				"UpsertService": func(s *Store) error {
					return s.UpsertService(ctx, domain.Service{ID: "echo", Name: "Renamed"})
				},
				"ListServices":  func(s *Store) error { _, err := s.ListServices(ctx); return err },
				"GetService":    func(s *Store) error { _, err := s.GetService(ctx, "echo"); return err },
				"DeleteService": func(s *Store) error { return s.DeleteService(ctx, "echo") },
			},
		},
		{
			table: "instances",
			seed:  seedInstance,
			calls: map[string]func(*Store) error{
				"UpsertInstance": func(s *Store) error {
					return s.UpsertInstance(ctx, domain.Instance{ID: "inst", ServiceID: "echo", Name: "Renamed"})
				},
				"ListInstances":  func(s *Store) error { _, err := s.ListInstances(ctx); return err },
				"GetInstance":    func(s *Store) error { _, err := s.GetInstance(ctx, "inst"); return err },
				"DeleteInstance": func(s *Store) error { return s.DeleteInstance(ctx, "inst") },
			},
		},
		{
			table: "capsets",
			seed:  seedCapset,
			calls: map[string]func(*Store) error{
				"CreateCapset": func(s *Store) error {
					return s.CreateCapset(ctx, domain.Capset{ID: "other", Name: "Other"})
				},
				"ListCapsets":  func(s *Store) error { _, err := s.ListCapsets(ctx); return err },
				"GetCapset":    func(s *Store) error { _, err := s.GetCapset(ctx, "dev"); return err },
				"DeleteCapset": func(s *Store) error { return s.DeleteCapset(ctx, "dev") },
			},
		},
		{
			table: "capset_instances",
			seed:  seedCapsetInstance,
			calls: map[string]func(*Store) error{
				"AddCapsetInstance": func(s *Store) error {
					return s.AddCapsetInstance(ctx, domain.CapsetInstance{ID: "dev:inst2", CapsetID: "dev", ServiceID: "echo", InstanceID: "inst"})
				},
				"ListCapsetInstances": func(s *Store) error { _, err := s.ListCapsetInstances(ctx, "dev"); return err },
				"DeleteCapsetInstance": func(s *Store) error {
					return s.DeleteCapsetInstance(ctx, "dev", "inst")
				},
			},
		},
		{
			table: "capset_methods",
			seed:  seedCapsetMethod,
			calls: map[string]func(*Store) error{
				"AddCapsetMethod": func(s *Store) error {
					return s.AddCapsetMethod(ctx, domain.CapsetMethod{CapsetInstanceID: "dev:inst", MethodFullName: "echo.v1.EchoService/Other"})
				},
				"ListCapsetMethods": func(s *Store) error { _, err := s.ListCapsetMethods(ctx, "dev"); return err },
			},
		},
		{
			table: "capset_tokens",
			seed:  seedCapsetToken,
			calls: map[string]func(*Store) error{
				"AddCapsetToken": func(s *Store) error {
					_, err := s.AddCapsetToken(ctx, domain.CapsetToken{ID: "tok2", CapsetID: "dev", Name: "Token"}, "secret")
					return err
				},
				"DeleteCapsetToken":   func(s *Store) error { return s.DeleteCapsetToken(ctx, "dev", "tok") },
				"CapsetRequiresToken": func(s *Store) error { _, err := s.CapsetRequiresToken(ctx, "dev"); return err },
			},
		},
		{
			table: "admin_tokens",
			seed:  seedAdminToken,
			calls: map[string]func(*Store) error{
				"AddAdminToken": func(s *Store) error {
					_, err := s.AddAdminToken(ctx, domain.AdminToken{ID: "ops2", Name: "Ops"}, "other-secret")
					return err
				},
				"AdminRequiresToken": func(s *Store) error { _, err := s.AdminRequiresToken(ctx); return err },
			},
		},
	}

	for _, tc := range cases {
		for name, call := range tc.calls {
			t.Run(name+" without "+tc.table, func(t *testing.T) {
				// Two stores that differ only in that table, so the call succeeding in
				// one and failing in the other is what attributes the failure to it.
				// Asserting on the database's error text would instead break the day
				// something wraps that text, which is a change this should allow.
				healthy := openSeededTestStore(t, tc.seed)
				if err := call(healthy); err != nil {
					t.Fatalf("%s with %s present: %v", name, tc.table, err)
				}

				broken := openSeededTestStore(t, tc.seed)
				// The fault is the table disappearing from under its queries. Renaming
				// it leaves the schema intact and needs no foreign-key juggling, which a
				// DROP would: that pragma is connection-scoped while the pool re-enables
				// it per connection.
				if _, err := broken.DB().ExecContext(ctx, `ALTER TABLE `+tc.table+` RENAME TO `+tc.table+`_gone`); err != nil {
					t.Fatal(err)
				}
				if err := call(broken); err == nil {
					t.Fatalf("%s succeeded against a store without %s", name, tc.table)
				}
			})
		}
	}
}
