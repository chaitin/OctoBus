/* node:coverage disable */
import http from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";

const BCE_CONTENT_TYPE = "application/json;charset=utf-8";
const BCE_EXPIRE_SECONDS = 1800;
const BCE_SIGNED_HEADERS = "content-type;host;x-bce-date";

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => resolve(Buffer.concat(chunks).toString()));
  req.on("error", reject);
});

const sendJson = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

const bceEncode = (value, safe = "-_.~") => {
  const safeChars = new Set(String(safe).split(""));
  let result = "";
  for (const ch of String(value)) {
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || safeChars.has(ch)) {
      result += ch;
      continue;
    }
    for (const byte of Buffer.from(ch)) {
      result += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return result;
};

const buildCanonicalQueryString = (queryParams = {}) => Object.entries(queryParams)
  .filter(([, value]) => value !== undefined && value !== null && value !== "")
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, value]) => `${bceEncode(key)}=${bceEncode(value)}`)
  .join("&");

const buildCanonicalHeaders = (headersToSign = {}) => Object.entries(headersToSign)
  .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
  .map(([key, value]) => `${bceEncode(key.toLowerCase(), "-_.~")}:${bceEncode(value)}`)
  .join("\n");

const buildCanonicalRequest = (method, uri, queryParams, headersToSign) => [
  String(method || "GET").toUpperCase(),
  bceEncode(uri, "/-_.~"),
  buildCanonicalQueryString(queryParams),
  buildCanonicalHeaders(headersToSign),
].join("\n");

const buildExpectedAuthorization = ({ accessKey, secretKey, method, pathname, queryParams, host, xBceDate }) => {
  const headersToSign = {
    Host: host,
    "Content-Type": BCE_CONTENT_TYPE,
    "x-bce-date": xBceDate,
  };
  const canonicalRequest = buildCanonicalRequest(method, pathname, queryParams, headersToSign);
  const authStringPrefix = `bce-auth-v1/${accessKey}/${xBceDate}/${BCE_EXPIRE_SECONDS}`;
  const signingKey = createHmac("sha256", secretKey).update(authStringPrefix).digest();
  const signature = createHmac("sha256", signingKey).update(canonicalRequest).digest("hex");
  return `${authStringPrefix}/${BCE_SIGNED_HEADERS}/${signature}`;
};

const verifyAuthorization = (req, url) => {
  const authHeader = String(req.headers.authorization || "");
  const xBceDate = String(req.headers["x-bce-date"] || "");
  if (!authHeader.startsWith("bce-auth-v1/test-ak/")) {
    return "unauthorized: invalid Authorization header";
  }
  if (!xBceDate) {
    return "unauthorized: missing x-bce-date";
  }

  const queryParams = Object.fromEntries(url.searchParams.entries());
  const expected = buildExpectedAuthorization({
    accessKey: "test-ak",
    secretKey: "test-sk",
    method: req.method || "GET",
    pathname: url.pathname,
    queryParams,
    host: String(req.headers.host || ""),
    xBceDate,
  });

  const actualBuffer = Buffer.from(authHeader);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return "unauthorized: signature mismatch";
  }

  return "";
};

export const createMockServer = async (options = {}) => {
  const requests = [];

  const server = http.createServer((req, res) => {
    (async () => {
      const url = new URL(req.url || "/", "http://localhost");
      const body = await readBody(req);
      requests.push({ method: req.method, url: String(req.url), body, headers: req.headers });

      const authError = verifyAuthorization(req, url);
      if (authError) {
        sendJson(res, 401, { success: false, message: authError });
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/waf/webTemplate/detail") {
        const templateKey = url.searchParams.get("templateKey")?.trim();
        if (!templateKey) {
          sendJson(res, 400, { success: false, message: "templateKey is required" });
          return;
        }
        if (templateKey === "not-found-key") {
          sendJson(res, 404, { success: false, message: "resource not found" });
          return;
        }
        if (templateKey === "server-error-key") {
          sendJson(res, 500, { success: false, message: "internal server error" });
          return;
        }
        if (templateKey === "bad-json-key") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end("not-valid-json{{{");
          return;
        }
        sendJson(res, 200, {
          status: 0,
          result: {
            switch: 1,
            protectionDomains: ["example.com"],
            templateType: "high",
            templateKey,
            action: "block",
            groupKey: "high",
            ruleName: "SQL注入防护",
            ruleID: 10001,
            groupName: "高"
          },
          success: true
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/waf/webTemplate/save") {
        let payload;
        try {
          payload = JSON.parse(body || "{}");
        } catch {
          sendJson(res, 400, { success: false, message: "request body must be JSON" });
          return;
        }
        if (!payload.name || payload.switch === undefined || !payload.templateType || !payload.action || !payload.rulesGroupID) {
          sendJson(res, 400, { success: false, message: "missing required fields" });
          return;
        }
        if (payload.name === "server-error") {
          sendJson(res, 500, { success: false, message: "internal server error" });
          return;
        }
        if (payload.name === "bad-json") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end("not-valid-json{{{");
          return;
        }
        sendJson(res, 200, {
          status: 200,
          result: {
            templateKey: payload.templateKey || "template-abc123"
          }
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/waf/webTemplate/switch") {
        let payload;
        try {
          payload = JSON.parse(body || "{}");
        } catch {
          sendJson(res, 400, { success: false, message: "request body must be JSON" });
          return;
        }
        if (!payload.templateKey || payload.switch === undefined) {
          sendJson(res, 400, { success: false, message: "missing required fields" });
          return;
        }
        if (payload.templateKey === "server-error-key") {
          sendJson(res, 500, { success: false, message: "internal server error" });
          return;
        }
        if (payload.templateKey === "bad-json-key") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end("not-valid-json{{{");
          return;
        }
        sendJson(res, 200, {
          success: true,
          status: 200,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/waf/webTemplate/list") {
        let payload;
        try {
          payload = JSON.parse(body || "{}");
        } catch {
          sendJson(res, 400, { success: false, message: "request body must be JSON" });
          return;
        }
        if (payload.pageNo === undefined || payload.pageSize === undefined || payload.switch === undefined || payload.action === undefined || payload.templateName === undefined) {
          sendJson(res, 400, { success: false, message: "missing required fields" });
          return;
        }
        if (payload.templateName === "server-error") {
          sendJson(res, 500, { success: false, message: "internal server error" });
          return;
        }
        if (payload.templateName === "bad-json") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end("not-valid-json{{{");
          return;
        }
        sendJson(res, 200, {
          status: 200,
          success: true,
          result: {
            result: [
              {
                ruleName: "规则名称",
                templateKey: "web-list-001",
                templateType: "saas",
                protectionDomains: ["example.com"],
                action: "deny",
                switch: 1,
                updateTime: "2023-01-01 00:00:00",
                ruleID: payload.ruleID ?? 123,
              }
            ],
            totalCount: 1,
          }
        });
        return;
      }

      if (req.method === "DELETE" && url.pathname === "/v1/waf/webTemplate/delete") {
        const templateKey = url.searchParams.get("templateKey")?.trim();
        if (!templateKey) {
          sendJson(res, 400, { success: false, message: "templateKey is required" });
          return;
        }
        if (templateKey === "gone-key") {
          sendJson(res, 404, { success: false, message: "resource not found" });
          return;
        }
        if (templateKey === "server-error-key") {
          sendJson(res, 500, { success: false, message: "internal server error" });
          return;
        }
        if (templateKey === "bad-json-key") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end("not-valid-json{{{");
          return;
        }
        sendJson(res, 200, {
          success: true,
          result: {}
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/waf/whiteRules/detail") {
        const ruleKey = url.searchParams.get("ruleKey")?.trim();
        if (!ruleKey) {
          sendJson(res, 400, { success: false, message: "ruleKey is required" });
          return;
        }
        if (ruleKey === "server-error-key") {
          sendJson(res, 500, { success: false, message: "internal server error" });
          return;
        }
        if (ruleKey === "bad-json-key") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end("not-valid-json{{{");
          return;
        }
        sendJson(res, 200, {
          success: true,
          status: 200,
          result: {
            ruleName: "白名单规则",
            ruleID: 1001,
            ruleType: "saas",
            protectionDomains: ["example.com"],
            switch: 1,
            updateTime: "2026-03-10T00:00:00Z",
            targets: [
              {
                field: "header",
                key: "User-Agent",
                match: "contains",
                value: ["curl"]
              }
            ]
          }
        });
        return;
      }

      if (req.method === "DELETE" && url.pathname === "/v1/waf/whiteRules/delete") {
        const ruleKey = url.searchParams.get("ruleKey")?.trim();
        if (!ruleKey) {
          sendJson(res, 400, { success: false, message: "ruleKey is required" });
          return;
        }
        if (ruleKey === "gone-rule") {
          sendJson(res, 404, { success: false, message: "resource not found" });
          return;
        }
        if (ruleKey === "server-error-key") {
          sendJson(res, 500, { success: false, message: "internal server error" });
          return;
        }
        if (ruleKey === "bad-json-key") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end("not-valid-json{{{");
          return;
        }
        sendJson(res, 200, {
          success: true,
          result: []
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/waf/whiteRules/switch") {
        let payload;
        try {
          payload = JSON.parse(body || "{}");
        } catch {
          sendJson(res, 400, { success: false, message: "request body must be JSON" });
          return;
        }
        if (!payload.ruleKey || payload.switch === undefined) {
          sendJson(res, 400, { success: false, message: "missing required fields" });
          return;
        }
        if (payload.ruleKey === "server-error-key") {
          sendJson(res, 500, { success: false, message: "internal server error" });
          return;
        }
        if (payload.ruleKey === "bad-json-key") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end("not-valid-json{{{");
          return;
        }
        sendJson(res, 200, {
          success: true,
          result: ["example"]
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/waf/whiteRules/list") {
        let payload;
        try {
          payload = JSON.parse(body || "{}");
        } catch {
          sendJson(res, 400, { success: false, message: "request body must be JSON" });
          return;
        }
        if (payload.pageNo === undefined || payload.pageSize === undefined) {
          sendJson(res, 400, { success: false, message: "missing required fields" });
          return;
        }
        if (payload.ruleName === "server-error") {
          sendJson(res, 500, { success: false, message: "internal server error" });
          return;
        }
        if (payload.ruleName === "bad-json") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end("not-valid-json{{{");
          return;
        }
        sendJson(res, 200, {
          success: true,
          status: 200,
          result: {
            result: [
              {
                ruleName: "示例规则",
                ruleType: "saas",
                protectionDomains: ["example.com"],
                switch: 1,
                updateTime: "2023-10-27T10:00:00Z",
                ruleKey: payload.ruleID ? `rule-${payload.ruleID}` : "rule-key-123",
                ruleID: 1001,
                ignoreModules: ["base"],
                ignoreIds: []
              }
            ],
            totalCount: 1
          }
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/waf/regionRules/list") {
        let payload;
        try {
          payload = JSON.parse(body || "{}");
        } catch {
          sendJson(res, 400, { success: false, message: "request body must be JSON" });
          return;
        }
        if (payload.pageNo === undefined || payload.pageSize === undefined) {
          sendJson(res, 400, { success: false, message: "missing required fields" });
          return;
        }
        if (payload.ruleName === "server-error") {
          sendJson(res, 500, { success: false, message: "internal server error" });
          return;
        }
        if (payload.ruleName === "bad-json") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end("not-valid-json{{{");
          return;
        }
        sendJson(res, 200, {
          success: true,
          status: 200,
          result: {
            result: [
              {
                ruleName: "封禁海外访问",
                protectionDomains: ["www.example.com"],
                switch: 1,
                updateTime: "2023-10-01 12:00:00",
                ruleKey: payload.ruleID ? `region-${payload.ruleID}` : "rule_key_001",
                ruleID: 1001,
                ruleType: "saas",
                action: payload.action ?? "deny",
                value: {
                  domestic: [],
                  overseas: ["US", "JP"]
                }
              }
            ],
            totalCount: 1
          }
        });
        return;
      }

      sendJson(res, 404, { success: false, message: "not found" });
    })().catch((err) => {
      sendJson(res, 500, { message: err?.message || "internal error" });
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    requests,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  };
};
