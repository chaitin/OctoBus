// Mock upstream for Tencent Cloud Lighthouse Firewall API
import http from "node:http";

const httpPort = Number(process.env.HTTP_PORT || 18081);

const MOCK_RESPONSES = {
  DescribeFirewallRules: {
    TotalCount: 2,
    FirewallRuleSet: [
      { AppType: "Custom", Protocol: "TCP", Port: "22", CidrBlock: "10.0.0.1/32", Action: "ACCEPT", FirewallRuleDescription: "ssh" },
      { AppType: "Custom", Protocol: "TCP", Port: "ALL", CidrBlock: "1.2.3.4", Action: "DROP", FirewallRuleDescription: "octobus-block-ip" },
    ],
    RequestId: "mock-req-describe",
  },
  CreateFirewallRules: { RequestId: "mock-req-create" },
  DeleteFirewallRules: { RequestId: "mock-req-delete" },
  ModifyFirewallRules: { RequestId: "mock-req-modify" },
  ApplyFirewallTemplate: { RequestId: "mock-req-apply" },
};

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let body = {};
  if (chunks.length) {
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")) || {}; }
    catch { /* ignore malformed request body */ }
  }
  const action = req.headers["x-tc-action"] || "Unknown";

  if (body.InstanceId === "fail-unauthorized") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ Response: { Error: { Code: "UnauthorizedOperation", Message: "mock permission denied" }, RequestId: "mock-err" } }));
    return;
  }

  const result = MOCK_RESPONSES[action] || { RequestId: "mock-req-unknown" };
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ Response: result }));
});

export function createMockUpstream() {
  return server;
}

if (process.argv[1] && process.argv[1].endsWith("mock_upstream.js")) {
  server.listen(httpPort, () => {
    console.log(`[mock-lighthouse] listening on :${httpPort}`);
  });
}
