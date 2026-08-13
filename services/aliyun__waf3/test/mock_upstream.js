import http from "node:http";

// Mock 阿里云 WAF OpenAPI 服务器
// 用于本地测试，不依赖真实阿里云环境

let ruleCounter = 1000;
const rules = new Map();

const PORT = process.env.MOCK_PORT || 18080;

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", chunk => { body += chunk; });
  req.on("end", () => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    // 合并 query string 和 POST body 参数
    const queryParams = Object.fromEntries(url.searchParams);
    const bodyParams = {};
    if (body) {
      body.split("&").forEach(p => { const [k,v] = p.split("="); if(k) bodyParams[decodeURIComponent(k)] = decodeURIComponent(v||""); });
    }
    const params = { ...bodyParams, ...queryParams };

    // 签名校验（mock 不做真实验签，仅校验必填参数存在）
    if (!params.AccessKeyId && !params.Signature) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ Code: "MissingParameter", Message: "AccessKeyId is required" }));
      return;
    }

    // 通过 action 参数路由
    const action = params.Action;

    const sendJSON = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };

    switch (action) {
      // ── DescribeDefenseTemplates ──
      case "DescribeDefenseTemplates":
        sendJSON(200, {
          Templates: [
            { TemplateId: 9999, TemplateName: "default", TemplateType: "user_default", Status: 1, DefenseScene: "ip_blacklist" }
          ],
          TotalCount: 1,
          RequestId: "mock-request-1"
        });
        break;

      // ── CreateDefenseRule ──
      case "CreateDefenseRule": {
        const ruleId = String(++ruleCounter);
        const rulesJson = params.Rules ? JSON.parse(decodeURIComponent(params.Rules)) : [];
        rules.set(ruleId, {
          RuleId: ruleId,
          DefenseScene: params.DefenseScene || "",
          Rules: JSON.stringify(rulesJson),
          Status: 1
        });
        sendJSON(200, { RuleId: ruleId, RequestId: "mock-request-2" });
        break;
      }

      // ── ModifyDefenseRule ──
      case "ModifyDefenseRule": {
        const ruleId = params.RuleId;
        if (!rules.has(ruleId)) {
          sendJSON(404, { Code: "NotFound", Message: "Rule not found" });
          return;
        }
        const rulesJson = params.Rules ? JSON.parse(decodeURIComponent(params.Rules)) : [];
        rules.set(ruleId, { ...rules.get(ruleId), Rules: JSON.stringify(rulesJson) });
        sendJSON(200, { RequestId: "mock-request-3" });
        break;
      }

      // ── DescribeDefenseRule ──
      case "DescribeDefenseRule": {
        const ruleId = params.RuleId;
        if (!rules.has(ruleId)) {
          sendJSON(200, { Rule: { RuleId: ruleId, Rules: JSON.stringify([{ name: "mock", remoteAddr: ["1.2.3.4"], action: "block", status: 1 }]) } });
          return;
        }
        sendJSON(200, { Rule: rules.get(ruleId) });
        break;
      }

      // ── DescribeDefenseRules ──
      case "DescribeDefenseRules":
        const allRules = Array.from(rules.values()).filter(r =>
          !params.DefenseScene || r.DefenseScene === params.DefenseScene
        );
        sendJSON(200, { DefenseRules: allRules, TotalCount: allRules.length, RequestId: "mock-request-4" });
        break;

      // ── DeleteDefenseRule ──
      case "DeleteDefenseRule":
        rules.delete(params.RuleId);
        sendJSON(200, { RequestId: "mock-request-5" });
        break;

      // ── DescribeSecurityEventTopNMetric ──
      case "DescribeSecurityEventTopNMetric":
        sendJSON(200, {
          SecurityEventTopNValues: [
            { Name: "45.33.32.156", Value: 23 },
            { Name: "222.128.21.91", Value: 17 }
          ],
          RequestId: "mock-request-6"
        });
        break;

      // ── DescribeDefenseResources ──
      case "DescribeDefenseResources":
        sendJSON(200, {
          Resources: [
            {
              Resource: "i-example-8080-ecs",
              Pattern: "instance_port",
              Product: "ecs",
              ResourceStatus: "active",
              Detail: { instanceId: "i-example", port: 8080, protocol: "http" }
            }
          ],
          TotalCount: 1,
          RequestId: "mock-request-7"
        });
        break;

      // ── 模拟认证失败 ──
      default:
        if (action === "InvalidAccessKeyId") {
          sendJSON(401, { Code: "InvalidAccessKeyId.NotFound", Message: "The AccessKey ID is invalid" });
        } else if (action === "Forbidden") {
          sendJSON(403, { Code: "Forbidden.NoPermission", Message: "No permission" });
        } else if (action === "Throttling") {
          sendJSON(429, { Code: "Throttling.User", Message: "Request was throttled" });
        } else {
          sendJSON(200, { RequestId: "mock-request-unknown" });
        }
    }
  });
});

server.listen(PORT, () => {
  if (process.env.NODE_ENV !== "test") {
    console.log(`Mock Alibaba Cloud WAF API listening on http://127.0.0.1:${PORT}`);
  }
});

export { server, PORT };
