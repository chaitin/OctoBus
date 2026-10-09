package integration

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"octobus/internal/protocol"
)

// gatewayOutcome is the status and body a gateway answer is compared by.
type gatewayOutcome struct {
	status int
	body   string
}

// A gateway whose store cannot answer has to report it rather than an empty
// result, and the answer has to change when the tables it reads are gone, so the
// lookup is attributable to them.
//
// What these cases do not assert, deliberately: that a store failure is
// distinguishable from a genuine lookup miss. The gateway maps a store failure
// onto its lookup-miss responses ("method is not exposed by capset", "tool not
// found"), so on the Connect and tools/call paths the two are the same answer
// today, and separating them is a change to that mapping rather than to these
// tests. It is listed as an open question in the pull request. The tools/list
// case is the exception: there a store failure is asserted to differ from a
// capset that genuinely exposes nothing, because the two are distinguishable
// without touching the mapping.
func TestGatewayReportsStoreFailures(t *testing.T) {
	cases := []struct {
		name string
		call func(*protocol.Gateway) gatewayOutcome
		// distinguishes names what the store failure must not look like, where a
		// baseline for it exists without changing the lookup-miss mapping.
		distinguishes func(t *testing.T, failure gatewayOutcome, gateway func(*protocol.Gateway) gatewayOutcome)
		fails         func(gatewayOutcome) bool
	}{
		{
			name: "connect",
			call: func(gateway *protocol.Gateway) gatewayOutcome {
				req := httptest.NewRequest(http.MethodPost, "/capsets/dev/connect/echo-test/echo.v1.EchoService/Echo", strings.NewReader(`{"text":"x"}`))
				req.Header.Set("Content-Type", "application/json")
				w := httptest.NewRecorder()
				gateway.HandleConnectRPC(w, req)
				return gatewayOutcome{status: w.Code, body: w.Body.String()}
			},
			fails: func(o gatewayOutcome) bool { return o.status >= 400 },
		},
		{
			name: "mcp tools list",
			call: func(gateway *protocol.Gateway) gatewayOutcome {
				return mcpCall(gateway, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
			},
			distinguishes: func(t *testing.T, failure gatewayOutcome, call func(*protocol.Gateway) gatewayOutcome) {
				t.Helper()
				_, srv, empty := fixtureForErrorRoutes(t)
				// The capset exists here; it simply exposes nothing, which the
				// gateway answers as "capset not found" rather than an empty list.
				assertAdminStatus(t, srv, http.MethodDelete, "/admin/v1/capsets/dev/instances/echo-test", nil, http.StatusOK)
				genuineMiss := call(empty)
				if genuineMiss == failure {
					t.Fatalf("a store failure is reported the same way as a capset that exposes nothing: %+v", failure)
				}
			},
			fails: func(o gatewayOutcome) bool { return strings.Contains(o.body, `"error"`) },
		},
		{
			name: "mcp tools call",
			call: func(gateway *protocol.Gateway) gatewayOutcome {
				return mcpCall(gateway, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo__echo-test__echo","arguments":{"text":"x"}}}`)
			},
			fails: func(o gatewayOutcome) bool { return strings.Contains(o.body, `"error"`) },
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, _, healthyGateway := fixtureForErrorRoutes(t)
			st, _, brokenGateway := fixtureForErrorRoutes(t)
			for _, table := range []string{"capset_methods", "capset_instances"} {
				renameTable(t, st, table)
			}

			healthy := tc.call(healthyGateway)
			failure := tc.call(brokenGateway)

			// Changing at all is the attribution: the gateway read the dropped
			// tables to answer. The healthy baseline is not asserted to succeed:
			// for Connect and tools/call it is already a failure, because the
			// fixture's instance is not running.
			if healthy == failure {
				t.Fatalf("the answer did not change without the tables: %+v", failure)
			}
			if !tc.fails(failure) {
				t.Fatalf("without the tables the gateway answered %+v, want a failure", failure)
			}
			if tc.distinguishes != nil {
				tc.distinguishes(t, failure, tc.call)
			}
		})
	}
}

func mcpCall(gateway *protocol.Gateway, body string) gatewayOutcome {
	w := httptest.NewRecorder()
	gateway.HandleMCP(w, httptest.NewRequest(http.MethodPost, "/capsets/dev/mcp", strings.NewReader(body)))
	return gatewayOutcome{status: w.Code, body: w.Body.String()}
}
