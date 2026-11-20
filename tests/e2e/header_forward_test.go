package e2e

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHTTPHeaderForwardingToServicePackage(t *testing.T) {
	h := newHarnessWithDaemonEnv(t, "OCTOBUS_HTTP_HEADER_FORWARD=Authorization=x-octobus-ext-authorization")
	importCalculator(t, h, "calculator")
	h.mustCLI("instance", "create", "calculator-test", "--service", "calculator")
	h.mustCLI("capset", "create", "dev")
	h.mustCLI("capset", "add-instance", "dev", "calculator-test")
	add := requireMethod(t, h.waitCatalogRunning(), "calculator.v1.CalculatorService/Add")
	for _, protocol := range []string{"connect", "mcp"} {
		for _, present := range []bool{true, false} {
			headers := map[string]string{"x-octobus-ext-authorization": "forged-forward-value"}
			if present {
				headers["Authorization"] = "Bearer original-forward-value"
			}
			var response map[string]any
			if protocol == "connect" {
				h.publicConnectWithHeaders(add.Endpoint, `{"left":20,"right":22}`, headers, http.StatusOK, &response)
				if response["result"] != float64(42) {
					t.Fatal("unexpected Connect result")
				}
			} else {
				h.mcpWithHeaders(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"calculator__calculator-test__add","arguments":{"left":20,"right":22}}}`, headers, &response)
				if response["result"].(map[string]any)["structuredContent"].(map[string]any)["result"] != float64(42) {
					t.Fatal("unexpected MCP result")
				}
			}
			raw, err := os.ReadFile(filepath.Join(h.dataDir, "instances", "calculator-test", "metadata.json"))
			if err != nil {
				t.Fatal(err)
			}
			var md map[string][]string
			if err := json.Unmarshal(raw, &md); err != nil {
				t.Fatal(err)
			}
			got := md["x-octobus-ext-authorization"]
			if present {
				if len(got) != 1 || got[0] != "Bearer original-forward-value" {
					t.Fatal("package did not receive original authorization")
				}
			} else if len(got) != 0 {
				t.Fatal("package received forged authorization")
			}
			if len(md["authorization"]) != 0 {
				t.Fatal("raw authorization leaked")
			}
		}
	}
	logs := h.mustCLI("logs", "--capset", "dev", "--limit", "0")
	for _, value := range []string{"Bearer original-forward-value", "forged-forward-value"} {
		if strings.Contains(logs, value) {
			t.Fatal("header value leaked in access logs")
		}
	}
	h.stop()
	if strings.Contains(h.stderr.String(), "Bearer original-forward-value") || strings.Contains(h.stderr.String(), "forged-forward-value") {
		t.Fatal("header value leaked in daemon logs")
	}
}
