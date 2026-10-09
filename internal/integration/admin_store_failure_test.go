package integration

import (
	"net/http"
	"strings"
	"testing"

	"octobus/internal/store"
)

// renameTable takes a table out from under the handlers' queries. Renaming is
// enough to make them fail with "no such table" and keeps the schema intact,
// where a DROP would need the foreign keys relaxed on a pooled connection that
// store.Open re-enables per connection.
func renameTable(t *testing.T, st *store.Store, table string) {
	t.Helper()
	if _, err := st.DB().Exec(`ALTER TABLE ` + table + ` RENAME TO ` + table + `_gone`); err != nil {
		t.Fatal(err)
	}
}

// adminRoute is one request the store-failure cases exercise.
type adminRoute struct {
	method string
	path   string
	body   any
}

// A store that cannot answer has to surface on every route that reads it. A
// route that reports success or an empty result instead would tell an operator
// that a service, instance or capset is gone when the query never ran.
//
// The fault is a dropped table rather than a closed store: closing it fails the
// admin token lookup in the middleware first, so no handler would ever run.
func TestAdminReportsStoreFailures(t *testing.T) {
	cases := []struct {
		table  string
		routes []adminRoute
	}{
		{
			table: "services",
			routes: []adminRoute{
				{method: http.MethodGet, path: "/admin/v1/services"},
				{method: http.MethodGet, path: "/admin/v1/services/echo"},
				{method: http.MethodPatch, path: "/admin/v1/services/echo", body: map[string]any{"name": "Renamed"}},
			},
		},
		{
			table: "instances",
			routes: []adminRoute{
				{method: http.MethodGet, path: "/admin/v1/instances"},
				{method: http.MethodGet, path: "/admin/v1/instances/echo-test"},
				{method: http.MethodPatch, path: "/admin/v1/instances/echo-test", body: map[string]any{"name": "Renamed"}},
				{method: http.MethodDelete, path: "/admin/v1/instances/echo-test"},
			},
		},
		{
			table: "capsets",
			routes: []adminRoute{
				{method: http.MethodGet, path: "/admin/v1/capsets"},
				{method: http.MethodGet, path: "/admin/v1/capsets/dev"},
				{method: http.MethodPatch, path: "/admin/v1/capsets/dev", body: map[string]any{"name": "Renamed"}},
				{method: http.MethodDelete, path: "/admin/v1/capsets/dev"},
			},
		},
		{
			table: "capset_instances",
			// Ordered so every route succeeds against the healthy fixture: the
			// delete clears the row the add then re-creates.
			routes: []adminRoute{
				{method: http.MethodGet, path: "/admin/v1/capsets/dev/instances"},
				{method: http.MethodDelete, path: "/admin/v1/capsets/dev/instances/echo-test"},
				{method: http.MethodPost, path: "/admin/v1/capsets/dev/instances", body: map[string]any{"instance_id": "echo-test"}},
			},
		},
		{
			table: "capset_methods",
			routes: []adminRoute{
				{method: http.MethodGet, path: "/admin/v1/capsets/dev/methods"},
			},
		},
		{
			table: "capset_tokens",
			routes: []adminRoute{
				{method: http.MethodGet, path: "/admin/v1/capsets/dev/tokens"},
			},
		},
	}

	// Deleting a service an instance still uses is refused by a guard that reads
	// the instance table, so it never reaches the dropped one. That refusal is
	// worth its own assertion: it is what keeps a delete from orphaning a runtime.
	t.Run("deleting a service in use is refused", func(t *testing.T) {
		_, srv, _ := fixtureForErrorRoutes(t)
		w := adminResponse(t, srv, http.MethodDelete, "/admin/v1/services/echo", nil)
		if w.Code < 400 {
			t.Fatalf("status=%d body=%s want a refusal", w.Code, w.Body.String())
		}
		if !strings.Contains(w.Body.String(), "is used by instance") {
			t.Fatalf("body=%s want the referential refusal named", w.Body.String())
		}
	})

	for _, tc := range cases {
		t.Run("without "+tc.table, func(t *testing.T) {
			// Fresh fixtures on both sides, so the routes that delete are run
			// against state they have not already changed.
			_, healthy, _ := fixtureForErrorRoutes(t)
			st, srv, _ := fixtureForErrorRoutes(t)
			renameTable(t, st, tc.table)

			for _, route := range tc.routes {
				// The same route has to answer while the table is there. That is
				// what makes the table the reason for the failure below, without
				// asserting on the error text the client receives.
				if w := adminResponse(t, healthy, route.method, route.path, route.body); w.Code >= 400 {
					t.Fatalf("with %s: %s %s status=%d body=%s want success", tc.table, route.method, route.path, w.Code, w.Body.String())
				}
				w := adminResponse(t, srv, route.method, route.path, route.body)
				if w.Code < 400 {
					t.Fatalf("without %s: %s %s status=%d body=%s want an error", tc.table, route.method, route.path, w.Code, w.Body.String())
				}
			}
		})
	}
}
