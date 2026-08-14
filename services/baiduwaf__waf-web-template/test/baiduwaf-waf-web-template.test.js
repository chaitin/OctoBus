import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

import {
  METHOD_WEBTEMPLATEDELETE_FULL,
  METHOD_WEBTEMPLATEDETAIL_FULL,
  METHOD_WEBTEMPLATELIST_FULL,
  METHOD_WEBTEMPLATESAVE_FULL,
  METHOD_WEBTEMPLATESWITCH_FULL,
  METHOD_WHITERULESDELETE_FULL,
  METHOD_WHITERULESDETAIL_FULL,
  METHOD_WHITERULESLIST_FULL,
  METHOD_WHITERULESSWITCH_FULL,
  METHOD_REGIONRULESLIST_FULL,
  WEBTEMPLATEDELETE_PATH,
  WEBTEMPLATEDETAIL_PATH,
  WEBTEMPLATELIST_PATH,
  WEBTEMPLATESAVE_PATH,
  WEBTEMPLATESWITCH_PATH,
  WHITERULESDELETE_PATH,
  WHITERULESDETAIL_PATH,
  WHITERULESLIST_PATH,
  WHITERULESSWITCH_PATH,
  REGIONRULESLIST_PATH,
  _test,
  handlers,
  rpcdef,
} from "../src/baiduwaf-waf-web-template.js";
import { service } from "../src/service.js";
import { createMockServer } from "./mock_upstream.js";

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;
const protoPath = new URL("../proto/waf_web_template.proto", import.meta.url);

const textResponse = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: () => "application/json" },
  text: async () => body,
});

const jsonResponse = (status, body) => textResponse(status, JSON.stringify(body));

const setFetch = (impl) => {
  globalThis.fetch = impl;
};

const expectGrpcError = async (fn, legacyCode, checker = () => {}) => {
  let caught;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, "expected function to reject");
  assert.ok(caught instanceof GrpcError);
  assert.equal(caught.legacyCode, legacyCode);
  assert.equal(caught.code, ({
    FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
    INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
    PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
    UNKNOWN: grpcStatus.UNKNOWN,
  })[legacyCode]);
  checker(caught);
};

const expectRejectPayload = async (fn, code, httpStatus, reasonPattern, options = {}) => {
  await expectGrpcError(fn, code, (err) => {
    const payload = JSON.parse(err.message);
    assert.equal(payload.code, code);
    assert.equal(payload.http_status, httpStatus);
    assert.equal(typeof payload.http_body, "string");
    if (reasonPattern) assert.match(payload.reason, reasonPattern);
    if (options.httpBodyLength !== undefined) assert.equal(payload.http_body.length, options.httpBodyLength);
    if (options.httpBody !== undefined) assert.equal(payload.http_body, options.httpBody);
  });
};

const buildCtx = (overrides = {}) => ({
  config: {
    api_base: "http://api.example.com",
    ...(overrides.config || {}),
  },
  secret: {
    access_key: "test-ak",
    secret_key: "test-sk",
    ...(overrides.secret || {}),
  },
  bindings: { ...(overrides.bindings || {}) },
  limits: { timeoutMs: 5000, ...(overrides.limits || {}) },
  meta: { instance_id: "inst", request_id: "req", ...(overrides.meta || {}) },
  req: overrides.req || {},
  request: overrides.request,
});

test.beforeEach(() => {
  console.log = () => {};
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalConsoleLog;
});

test("service exports handlers and rpcdef paths", () => {
  assert.equal(typeof service, "object");
  assert.equal(typeof handlers[METHOD_WEBTEMPLATEDETAIL_FULL], "function");
  assert.equal(typeof handlers[METHOD_WEBTEMPLATESAVE_FULL], "function");
  assert.equal(typeof handlers[METHOD_WEBTEMPLATESWITCH_FULL], "function");
  assert.equal(typeof handlers[METHOD_WEBTEMPLATELIST_FULL], "function");
  assert.equal(typeof handlers[METHOD_WEBTEMPLATEDELETE_FULL], "function");
  assert.equal(typeof handlers[METHOD_WHITERULESDETAIL_FULL], "function");
  assert.equal(typeof handlers[METHOD_WHITERULESDELETE_FULL], "function");
  assert.equal(typeof handlers[METHOD_WHITERULESSWITCH_FULL], "function");
  assert.equal(typeof handlers[METHOD_WHITERULESLIST_FULL], "function");
  assert.equal(typeof handlers[METHOD_REGIONRULESLIST_FULL], "function");
  const routes = rpcdef(buildCtx());
  assert.equal(typeof routes[WEBTEMPLATEDETAIL_PATH], "function");
  assert.equal(typeof routes[WEBTEMPLATESAVE_PATH], "function");
  assert.equal(typeof routes[WEBTEMPLATESWITCH_PATH], "function");
  assert.equal(typeof routes[WEBTEMPLATELIST_PATH], "function");
  assert.equal(typeof routes[WEBTEMPLATEDELETE_PATH], "function");
  assert.equal(typeof routes[WHITERULESDETAIL_PATH], "function");
  assert.equal(typeof routes[WHITERULESDELETE_PATH], "function");
  assert.equal(typeof routes[WHITERULESSWITCH_PATH], "function");
  assert.equal(typeof routes[WHITERULESLIST_PATH], "function");
  assert.equal(typeof routes[REGIONRULESLIST_PATH], "function");
});

test("WebTemplateDetail rejects missing credentials", async () => {
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { templateKey: "tpl-1" }, secret: { access_key: "", secret_key: "test-sk" } }))[WEBTEMPLATEDETAIL_PATH](),
    "INVALID_ARGUMENT",
    (err) => assert.match(err.message, /access_key is required/),
  );
});

test("WebTemplateDetail rejects missing templateKey", async () => {
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: {} }))[WEBTEMPLATEDETAIL_PATH](),
    "INVALID_ARGUMENT",
    (err) => assert.match(err.message, /templateKey is required/),
  );
});

test("WebTemplateSave rejects missing required fields", async () => {
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { name: "demo" } }))[WEBTEMPLATESAVE_PATH](),
    "INVALID_ARGUMENT",
    (err) => assert.match(err.message, /switch is required/),
  );
});

test("WebTemplateSwitch rejects missing templateKey", async () => {
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { switch: 1 } }))[WEBTEMPLATESWITCH_PATH](),
    "INVALID_ARGUMENT",
    (err) => assert.match(err.message, /templateKey is required/),
  );
});

test("WebTemplateList rejects missing required fields", async () => {
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { pageNo: 1, pageSize: 10, switch: -1, action: "" } }))[WEBTEMPLATELIST_PATH](),
    "INVALID_ARGUMENT",
    (err) => assert.match(err.message, /templateName is required/),
  );
});

test("WebTemplateDelete rejects missing templateKey", async () => {
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: {} }))[WEBTEMPLATEDELETE_PATH](),
    "INVALID_ARGUMENT",
    (err) => assert.match(err.message, /templateKey is required/),
  );
});

test("WhiteRulesdetail rejects missing ruleKey", async () => {
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: {} }))[WHITERULESDETAIL_PATH](),
    "INVALID_ARGUMENT",
    (err) => assert.match(err.message, /ruleKey is required/),
  );
});

test("WhiteRulesdelete rejects missing ruleKey", async () => {
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: {} }))[WHITERULESDELETE_PATH](),
    "INVALID_ARGUMENT",
    (err) => assert.match(err.message, /ruleKey is required/),
  );
});

test("WhiteRulesswitch rejects missing switch", async () => {
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { ruleKey: "rule-1" } }))[WHITERULESSWITCH_PATH](),
    "INVALID_ARGUMENT",
    (err) => assert.match(err.message, /switch is required/),
  );
});

test("WhiteRuleslist rejects missing pageSize", async () => {
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { pageNo: 1 } }))[WHITERULESLIST_PATH](),
    "INVALID_ARGUMENT",
    (err) => assert.match(err.message, /pageSize is required/),
  );
});

test("RegionRuleslist rejects missing pageSize", async () => {
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { pageNo: 1 } }))[REGIONRULESLIST_PATH](),
    "INVALID_ARGUMENT",
    (err) => assert.match(err.message, /pageSize is required/),
  );
});

test("WebTemplateDetail returns success on HTTP 200", async () => {
  let capturedUrl = "";
  let capturedInit;

  setFetch(async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return jsonResponse(200, {
      status: 0,
      success: true,
      result: {
        switch: 1,
        protectionDomains: ["example.com"],
        templateType: "high",
        templateKey: "tpl-1",
        action: "block",
        groupKey: "high",
        ruleName: "SQL注入防护",
        ruleID: 10001,
        groupName: "高",
      },
    });
  });

  const res = await rpcdef(buildCtx({ req: { templateKey: "tpl-1" } }))[WEBTEMPLATEDETAIL_PATH]();

  assert.equal(res.success, true);
  assert.equal(res.result.templateKey, "tpl-1");
  assert.match(capturedUrl, /\/v1\/waf\/webTemplate\/detail\?templateKey=tpl-1/);
  assert.equal(capturedInit.method, "GET");
  assert.match(capturedInit.headers.Authorization, /^bce-auth-v1\/test-ak\//);
  assert.equal(capturedInit.headers["x-engine-instance"], "inst");
  assert.equal(capturedInit.headers["x-request-id"], "req");
});

test("WebTemplateSave sends JSON body and returns templateKey", async () => {
  let capturedInit;

  setFetch(async (_url, init) => {
    capturedInit = init;
    return jsonResponse(200, {
      status: 200,
      result: { templateKey: "template-abc123" },
    });
  });

  const res = await rpcdef(buildCtx({
    req: {
      name: "我的防护模板",
      bindInfo: [{ instanceID: "instance-001", subdomains: ["www.example.com"] }],
      switch: 1,
      templateType: "saas",
      action: "log",
      rulesGroupID: "middle",
    },
  }))[WEBTEMPLATESAVE_PATH]();

  const body = JSON.parse(capturedInit.body);
  assert.equal(capturedInit.method, "POST");
  assert.equal(body.name, "我的防护模板");
  assert.equal(body.rulesGroupID, "middle");
  assert.deepEqual(body.bindInfo, [{ instanceID: "instance-001", subdomains: ["www.example.com"] }]);
  assert.equal(res.result.templateKey, "template-abc123");
});

test("WebTemplateSave accepts runtime-decoded rulesGroupId alias", async () => {
  let capturedInit;

  setFetch(async (_url, init) => {
    capturedInit = init;
    return jsonResponse(200, {
      status: 200,
      result: { templateKey: "template-xyz" },
    });
  });

  const res = await rpcdef(buildCtx({
    req: {
      name: "我的防护模板",
      bindInfo: [],
      switch: 1,
      templateType: "saas",
      action: "log",
      rulesGroupId: "middle",
    },
  }))[WEBTEMPLATESAVE_PATH]();

  const body = JSON.parse(capturedInit.body);
  assert.equal(body.rulesGroupID, "middle");
  assert.equal(res.result.templateKey, "template-xyz");
});

test("WebTemplateSwitch sends JSON body and returns success", async () => {
  let capturedInit;

  setFetch(async (_url, init) => {
    capturedInit = init;
    return jsonResponse(200, {
      success: true,
      status: 200,
    });
  });

  const res = await rpcdef(buildCtx({ req: { templateKey: "template-001", switch: 1 } }))[WEBTEMPLATESWITCH_PATH]();

  const body = JSON.parse(capturedInit.body);
  assert.equal(capturedInit.method, "POST");
  assert.equal(body.templateKey, "template-001");
  assert.equal(body.switch, 1);
  assert.equal(res.success, true);
  assert.equal(res.status, 200);
});

test("WebTemplateList sends JSON body and maps nested result list", async () => {
  let capturedInit;

  setFetch(async (_url, init) => {
    capturedInit = init;
    return jsonResponse(200, {
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
            ruleID: 123,
          }
        ],
        totalCount: 1,
      }
    });
  });

  const res = await rpcdef(buildCtx({
    req: {
      pageNo: 1,
      pageSize: 10,
      switch: -1,
      action: "",
      templateName: "",
      subdomains: ["example.com"],
      ruleID: 123,
    },
  }))[WEBTEMPLATELIST_PATH]();

  const body = JSON.parse(capturedInit.body);
  assert.equal(body.pageNo, 1);
  assert.equal(body.pageSize, 10);
  assert.equal(body.switch, -1);
  assert.equal(body.action, "");
  assert.equal(body.templateName, "");
  assert.deepEqual(body.subdomains, ["example.com"]);
  assert.equal(body.ruleID, 123);
  assert.equal(res.success, true);
  assert.equal(res.result.totalCount, 1);
  assert.equal(res.result.result[0].templateKey, "web-list-001");
});

test("WebTemplateList accepts ruleId alias", async () => {
  let capturedInit;

  setFetch(async (_url, init) => {
    capturedInit = init;
    return jsonResponse(200, {
      status: 200,
      success: true,
      result: {
        result: [],
        totalCount: 0,
      }
    });
  });

  await rpcdef(buildCtx({
    req: {
      pageNo: 1,
      pageSize: 10,
      switch: -1,
      action: "",
      templateName: "",
      ruleId: 321,
    },
  }))[WEBTEMPLATELIST_PATH]();

  const body = JSON.parse(capturedInit.body);
  assert.equal(body.ruleID, 321);
});

test("WebTemplateDelete returns idempotent success on HTTP 404", async () => {
  setFetch(async () => jsonResponse(404, { success: false, message: "resource not found" }));

  const res = await rpcdef(buildCtx({ req: { templateKey: "gone-key" } }))[WEBTEMPLATEDELETE_PATH]();

  assert.equal(res.success, true);
  assert.equal(res.alreadyGone, true);
  assert.deepEqual(res.result, {});
});

test("WhiteRulesdetail uses GET query and maps targets", async () => {
  let capturedUrl = "";
  let capturedInit;

  setFetch(async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return jsonResponse(200, {
      success: true,
      status: 200,
      result: {
        ruleName: "白名单规则",
        ruleID: 1001,
        ruleType: "saas",
        protectionDomains: ["example.com"],
        switch: 1,
        updateTime: "2026-03-10T00:00:00Z",
        targets: [{ field: "header", key: "User-Agent", match: "contains", value: ["curl"] }],
      },
    });
  });

  const res = await rpcdef(buildCtx({ req: { ruleKey: "rule-1" } }))[WHITERULESDETAIL_PATH]();

  assert.match(capturedUrl, /\/v1\/waf\/whiteRules\/detail\?ruleKey=rule-1/);
  assert.equal(capturedInit.method, "GET");
  assert.equal(res.success, true);
  assert.equal(res.result.ruleName, "白名单规则");
  assert.equal(res.result.targets[0].key, "User-Agent");
  assert.deepEqual(res.result.targets[0].value, ["curl"]);
});

test("WhiteRulesdelete uses DELETE query and returns result array", async () => {
  let capturedUrl = "";
  let capturedInit;

  setFetch(async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return jsonResponse(200, {
      success: true,
      result: [],
    });
  });

  const res = await rpcdef(buildCtx({ req: { ruleKey: "rule-1" } }))[WHITERULESDELETE_PATH]();

  assert.match(capturedUrl, /\/v1\/waf\/whiteRules\/delete\?ruleKey=rule-1/);
  assert.equal(capturedInit.method, "DELETE");
  assert.equal(res.success, true);
  assert.equal(res.alreadyGone, false);
  assert.deepEqual(res.result, []);
});

test("WhiteRulesdelete returns idempotent success on HTTP 404", async () => {
  setFetch(async () => jsonResponse(404, { success: false, message: "resource not found" }));

  const res = await rpcdef(buildCtx({ req: { ruleKey: "gone-rule" } }))[WHITERULESDELETE_PATH]();

  assert.equal(res.success, true);
  assert.equal(res.alreadyGone, true);
  assert.deepEqual(res.result, []);
});

test("WhiteRulesdelete proto declares alreadyGone field", async () => {
  const proto = await readFile(protoPath, "utf8");
  assert.match(proto, /message WhiteRulesdeleteResponse \{[\s\S]*bool already_gone = 3 \[json_name = "alreadyGone"\];[\s\S]*\}/);
});

test("WhiteRulesdelete returns alreadyGone false on HTTP 200", async () => {
  setFetch(async () => jsonResponse(200, { success: true, result: [] }));

  const res = await rpcdef(buildCtx({ req: { ruleKey: "rule-1" } }))[WHITERULESDELETE_PATH]();

  assert.equal(res.alreadyGone, false);
});

test("WhiteRulesswitch sends JSON body and returns array", async () => {
  let capturedInit;

  setFetch(async (_url, init) => {
    capturedInit = init;
    return jsonResponse(200, {
      success: true,
      result: ["example"],
    });
  });

  const res = await rpcdef(buildCtx({ req: { ruleKey: "rule-1", switch: 1 } }))[WHITERULESSWITCH_PATH]();

  const body = JSON.parse(capturedInit.body);
  assert.equal(capturedInit.method, "POST");
  assert.equal(body.ruleKey, "rule-1");
  assert.equal(body.switch, 1);
  assert.equal(res.success, true);
  assert.deepEqual(res.result, ["example"]);
});

test("WhiteRuleslist sends optional filters only when present", async () => {
  const capturedBodies = [];

  setFetch(async (_url, init) => {
    capturedBodies.push(JSON.parse(init.body));
    return jsonResponse(200, {
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
            ruleKey: "rule-key-123",
            ruleID: 1001,
            ignoreModules: ["base"],
            ignoreIds: [],
          }
        ],
        totalCount: 1,
      },
    });
  });

  const res1 = await rpcdef(buildCtx({
    req: {
      pageNo: 1,
      pageSize: 10,
    },
  }))[WHITERULESLIST_PATH]();

  const res2 = await rpcdef(buildCtx({
    req: {
      pageNo: 2,
      pageSize: 20,
      switch: 0,
      subdomain: ["www.example.com"],
      ruleId: "rule-id-2",
      ruleName: "白名单",
    },
  }))[WHITERULESLIST_PATH]();

  assert.deepEqual(capturedBodies[0], { pageNo: 1, pageSize: 10 });
  assert.deepEqual(capturedBodies[1], {
    pageNo: 2,
    pageSize: 20,
    switch: 0,
    subdomain: ["www.example.com"],
    ruleID: "rule-id-2",
    ruleName: "白名单",
  });
  assert.equal(res1.result.totalCount, 1);
  assert.equal(res2.result.result[0].ruleKey, "rule-key-123");
  assert.deepEqual(res2.result.result[0].ignoreModules, ["base"]);
});

test("RegionRuleslist sends optional filters only when present", async () => {
  const capturedBodies = [];

  setFetch(async (_url, init) => {
    capturedBodies.push(JSON.parse(init.body));
    return jsonResponse(200, {
      success: true,
      status: 200,
      result: {
        result: [
          {
            ruleName: "封禁海外访问",
            protectionDomains: ["www.example.com"],
            switch: 1,
            updateTime: "2023-10-01 12:00:00",
            ruleKey: "rule_key_001",
            ruleID: 1001,
            ruleType: "saas",
            action: "deny",
            value: { domestic: [], overseas: ["US", "JP"] },
          }
        ],
        totalCount: 1,
      },
    });
  });

  const res1 = await rpcdef(buildCtx({ req: { pageNo: 1, pageSize: 10 } }))[REGIONRULESLIST_PATH]();
  const res2 = await rpcdef(buildCtx({
    req: {
      pageNo: 2,
      pageSize: 20,
      switch: 1,
      subdomain: ["example.com"],
      ruleID: "rule123",
      ruleName: "测试规则",
      action: "deny",
    },
  }))[REGIONRULESLIST_PATH]();

  assert.deepEqual(capturedBodies[0], { pageNo: 1, pageSize: 10 });
  assert.deepEqual(capturedBodies[1], {
    pageNo: 2,
    pageSize: 20,
    switch: 1,
    subdomain: ["example.com"],
    ruleID: "rule123",
    ruleName: "测试规则",
    action: "deny",
  });
  assert.deepEqual(res1.result.result[0].value.overseas, ["US", "JP"]);
  assert.equal(res2.result.result[0].action, "deny");
});

test("SDK handlers use ctx.request", async () => {
  setFetch(async () => jsonResponse(200, {
    status: 0,
    success: true,
    result: {
      switch: 1,
      protectionDomains: ["example.com"],
      templateType: "high",
      templateKey: "tpl-from-request",
      action: "block",
      groupKey: "high",
      ruleName: "SQL注入防护",
      ruleID: 10001,
      groupName: "高",
    },
  }));

  const res = await handlers[METHOD_WEBTEMPLATEDETAIL_FULL](buildCtx({ request: { templateKey: "tpl-from-request" } }));
  assert.equal(res.result.templateKey, "tpl-from-request");
});

test("HTTP 401 maps to PERMISSION_DENIED", async () => {
  setFetch(async () => jsonResponse(401, { message: "unauthorized" }));
  await expectRejectPayload(
    () => rpcdef(buildCtx({ req: { templateKey: "tpl-1" } }))[WEBTEMPLATEDETAIL_PATH](),
    "PERMISSION_DENIED",
    401,
    /upstream http 401/,
  );
});

test("HTTP 400 maps to FAILED_PRECONDITION", async () => {
  setFetch(async () => jsonResponse(400, { message: "bad request" }));
  await expectRejectPayload(
    () => rpcdef(buildCtx({ req: { templateKey: "template-001", switch: 1 } }))[WEBTEMPLATESWITCH_PATH](),
    "FAILED_PRECONDITION",
    400,
    /upstream http 400/,
  );
});

test("HTTP 500 maps to UNAVAILABLE", async () => {
  setFetch(async () => jsonResponse(500, { message: "server error" }));
  await expectRejectPayload(
    () => rpcdef(buildCtx({ req: { templateKey: "server-error-key" } }))[WEBTEMPLATEDETAIL_PATH](),
    "UNAVAILABLE",
    500,
    /upstream http 500/,
  );
});

test("WhiteRules invalid JSON response maps to UNKNOWN", async () => {
  setFetch(async () => textResponse(200, "not-valid-json!!!"));
  await expectRejectPayload(
    () => rpcdef(buildCtx({ req: { ruleKey: "bad-json-key" } }))[WHITERULESDETAIL_PATH](),
    "UNKNOWN",
    0,
    /not valid JSON/,
  );
});

test("HTTP error body is not exposed to callers", async () => {
  const longBody = "x".repeat(_test.MAX_HTTP_BODY_CHARS + 50);
  setFetch(async () => textResponse(500, longBody));
  await expectRejectPayload(
    () => rpcdef(buildCtx({ req: { templateKey: "tpl-1" } }))[WEBTEMPLATEDETAIL_PATH](),
    "UNAVAILABLE",
    500,
    /upstream http 500/,
    { httpBody: "" },
  );
});

test("oversized upstream response maps to UNAVAILABLE", async () => {
  setFetch(async () => textResponse(200, "x".repeat(9)));
  await expectRejectPayload(
    () => rpcdef(buildCtx({ req: { templateKey: "tpl-1" }, config: { maxResponseBytes: 8 } }))[WEBTEMPLATEDETAIL_PATH](),
    "UNAVAILABLE",
    0,
    /exceeds 8 bytes/,
  );
});

test("native fetch timeout maps to UNAVAILABLE", async () => {
  setFetch((_url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" })));
    void resolve;
  }));
  await expectRejectPayload(
    () => rpcdef(buildCtx({ req: { templateKey: "tpl-1" }, limits: { timeoutMs: 10 } }))[WEBTEMPLATEDETAIL_PATH](),
    "UNAVAILABLE",
    0,
    /request timed out/,
  );
});

test("network error maps to UNAVAILABLE", async () => {
  setFetch(async () => {
    throw Object.assign(new Error("fetch failed"), { cause: new Error("connection refused") });
  });
  await expectRejectPayload(
    () => rpcdef(buildCtx({ req: { templateKey: "tpl-1" } }))[WEBTEMPLATEDETAIL_PATH](),
    "UNAVAILABLE",
    0,
    /connection refused/,
  );
});

test("helper functions cover edge cases", () => {
  assert.equal(_test.unwrapString(undefined), "");
  assert.equal(_test.unwrapString(null), "");
  assert.equal(_test.unwrapString({ value: { value: "x" } }), "x");
  assert.equal(_test.normalizeBaseUrl("https://api.example.com///"), "https://api.example.com");
  assert.equal(_test.normalizeBaseUrl("ftp://api.example.com"), "");
  assert.deepEqual(_test.pickStringArray({}, ["missing"]), []);
  assert.deepEqual(_test.pickStringArray({ values: ["a", { value: "b" }, ""] }, ["values"]), ["a", "b"]);
  assert.equal(_test.resolveAccessKey({ ak: "ak1" }), "ak1");
  assert.equal(_test.resolveSecretKey({ sk: "sk1" }), "sk1");

  assert.deepEqual(_test.buildTlsOptions({ skipTlsVerify: true }), {
    skipTlsVerify: true,
    tlsInsecureSkipVerify: true,
    insecureSkipVerify: true,
  });
  assert.deepEqual(_test.buildTlsOptions({}), {});
  assert.equal(_test.buildTlsOptions({ tlsInsecureSkipVerify: true }).skipTlsVerify, true);
  assert.equal(_test.buildTlsOptions({ insecureSkipVerify: true }).skipTlsVerify, true);
  assert.equal(_test.resolveMaxResponseBytes({ bindings: { max_response_bytes: 16 } }), 16);
  assert.equal(_test.resolveMaxResponseBytes({ bindings: { maxResponseBytes: 0 } }), 4 * 1024 * 1024);

  assert.equal(_test.mapHttpStatusToCode(401), "PERMISSION_DENIED");
  assert.equal(_test.mapHttpStatusToCode(403), "PERMISSION_DENIED");
  assert.equal(_test.mapHttpStatusToCode(404), "FAILED_PRECONDITION");
  assert.equal(_test.mapHttpStatusToCode(500), "UNAVAILABLE");
  assert.equal(_test.MAX_HTTP_BODY_CHARS, 200);
  assert.equal(_test.truncateHttpBody("abcdef", 3), "abc");
  assert.equal(_test.truncateHttpBody(undefined), "");

  assert.equal(
    _test.buildUrl("https://api.example.com", "/v1/waf/webTemplate/detail", { templateKey: "abc" }),
    "https://api.example.com/v1/waf/webTemplate/detail?templateKey=abc",
  );
  assert.equal(_test.pickString({ a: "", b: "hello" }, ["a", "b", "c"]), "hello");
  assert.equal(_test.pickString(null, ["a"]), "");
  assert.equal(_test.grpcCodeFor("not-a-code"), grpcStatus.UNKNOWN);
  assert.equal(_test.firstDefined(undefined, null, "ok"), "ok");
  assert.equal(_test.hasOwn(null, "x"), false);
  assert.deepEqual(_test.resolveCallContext({ request: { x: 1 } }).req, { x: 1 });
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: -1 }, bindings: {} }), 10000);
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeout_ms: 25 } }), 25);
  assert.equal(_test.toInteger("12.9", 0), 12);
  assert.equal(_test.toInteger(NaN, 0), 0);
  assert.equal(_test.toInteger(undefined, 5), 5);
  assert.equal(_test.bceEncode("/v1/waf/webTemplate/detail", "/-_.~"), "/v1/waf/webTemplate/detail");
  assert.equal(_test.buildCanonicalQueryString({ b: 2, a: 1 }), "a=1&b=2");
  const expectedCanonicalRequest = _test.buildCanonicalRequest(
    "GET",
    "/v1/waf/webTemplate/detail",
    { templateKey: "abc" },
    {
      Host: "api.example.com",
      "Content-Type": _test.BCE_CONTENT_TYPE,
      "x-bce-date": "2026-06-29T00:00:00Z",
    },
  );
  const authStringPrefix = `bce-auth-v1/test-ak/2026-06-29T00:00:00Z/${_test.BCE_EXPIRE_SECONDS}`;
  const expectedSignature = createHmac("sha256", createHmac("sha256", "test-sk").update(authStringPrefix).digest())
    .update(expectedCanonicalRequest)
    .digest("hex");
  assert.equal(
    _test.buildBceAuthorization({
      accessKey: "test-ak",
      secretKey: "test-sk",
      method: "GET",
      uri: "/v1/waf/webTemplate/detail",
      queryParams: { templateKey: "abc" },
      host: "api.example.com",
      xBceDate: "2026-06-29T00:00:00Z",
    }),
    `bce-auth-v1/test-ak/2026-06-29T00:00:00Z/${_test.BCE_EXPIRE_SECONDS}/${_test.BCE_SIGNED_HEADERS}/${expectedSignature}`,
  );
  assert.match(
    _test.buildBceAuthorization({
      accessKey: "test-ak",
      secretKey: "test-sk",
      method: "GET",
      uri: "/v1/waf/webTemplate/detail",
      queryParams: { templateKey: "abc" },
      host: "api.example.com",
      xBceDate: "2026-06-29T00:00:00Z",
    }),
    /^bce-auth-v1\/test-ak\/2026-06-29T00:00:00Z\/1800\/content-type;host;x-bce-date\//,
  );
  assert.deepEqual(_test.mapWhiteRulesdetailTarget({ field: "header", key: "k", match: "contains", value: ["a"] }), {
    field: "header",
    key: "k",
    match: "contains",
    value: ["a"],
  });
  assert.equal(_test.mapWebTemplateDetailResult(null), undefined);
  assert.equal(_test.mapWebTemplateSaveResult(null), undefined);
  assert.equal(_test.mapWebTemplateListItem(null), undefined);
  assert.deepEqual(_test.mapWebTemplateListResult({ result: null, total_count: "2" }), { result: [], totalCount: 2 });
  assert.equal(_test.mapWhiteRulesdetailTarget(null), undefined);
  assert.deepEqual(_test.mapWhiteRulesdetailTarget({ value: null }), { field: "", key: "", match: "", value: [] });
  assert.equal(_test.mapWhiteRulesdetailResult(null), undefined);
  assert.deepEqual(_test.mapWhiteRulesdetailResult({ targets: null }).targets, []);
  assert.equal(_test.mapWhiteRuleslistItem(null), undefined);
  assert.deepEqual(_test.mapWhiteRuleslistResult({ result: null, total_count: 3 }), { result: [], totalCount: 3 });
  assert.equal(_test.mapRegionRuleslistValue(null), undefined);
  assert.deepEqual(_test.mapRegionRuleslistValue({ domestic: null, overseas: null }), { domestic: [], overseas: [] });
  assert.equal(_test.mapRegionRuleslistItem(null), undefined);
  assert.deepEqual(_test.mapRegionRuleslistItem({}), {
    ruleName: "", protectionDomains: [], switch: undefined, updateTime: "", ruleKey: "",
    ruleID: 0, ruleType: "", action: "", value: undefined,
  });
  assert.equal(_test.mapRegionRuleslistResult(null), undefined);
  assert.deepEqual(_test.mapRegionRuleslistResult({ result: null }), { result: [], totalCount: undefined });
  assert.deepEqual(_test.mapWhiteRuleslistItem({
    ruleName: "demo",
    ruleType: "saas",
    protectionDomains: ["example.com"],
    switch: 1,
    updateTime: "2026-03-10T00:00:00Z",
    ruleKey: "rule-1",
    ruleID: 1001,
    ignoreModules: ["base"],
    ignoreIds: ["1"],
  }), {
    ruleName: "demo",
    ruleType: "saas",
    protectionDomains: ["example.com"],
    switch: 1,
    updateTime: "2026-03-10T00:00:00Z",
    ruleKey: "rule-1",
    ruleID: 1001,
    ignoreModules: ["base"],
    ignoreIds: ["1"],
  });
  assert.deepEqual(_test.mapRegionRuleslistValue({ domestic: [], overseas: ["US"] }), {
    domestic: [],
    overseas: ["US"],
  });
});

test("logFlow handles circular references", () => {
  const calls = [];
  console.log = (...args) => calls.push(args);
  const circular = {};
  circular.self = circular;
  _test.logFlow({ meta: { instance_id: "inst" } }, "test", circular);
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /BaiduWAF_WAFWebTemplate.*test.*inst=inst/);
});

test("mock upstream detail end-to-end", async () => {
  const mockServer = await createMockServer();
  try {
    const ctx = buildCtx({
      config: { api_base: mockServer.url },
      req: { templateKey: "template_key_example" },
      meta: { instance_id: "mock-inst" },
    });
    const res = await rpcdef(ctx)[WEBTEMPLATEDETAIL_PATH]();
    assert.equal(res.success, true);
    assert.equal(res.result.templateKey, "template_key_example");
    assert.ok(mockServer.requests.length >= 1);
    assert.equal(mockServer.requests[0].method, "GET");
  } finally {
    await mockServer.close();
  }
});

test("node transport supports GET bodies and enforces response limits", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true,"padding":"0123456789"}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await _test.fetchText(
      buildCtx(),
      url,
      { method: "GET", body: "{}" },
    );
    assert.equal(response.http_status, 200);
    assert.match(response.http_body, /padding/);

    await expectRejectPayload(
      () => _test.fetchText(
        buildCtx({ config: { maxResponseBytes: 8 } }),
        url,
      ),
      "UNAVAILABLE",
      0,
      /exceeds 8 bytes/,
    );
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("mock upstream save end-to-end", async () => {
  const mockServer = await createMockServer();
  try {
    const ctx = buildCtx({
      config: { api_base: mockServer.url },
      req: {
        name: "我的防护模板",
        bindInfo: [{ instanceID: "instance-001", subdomains: ["www.example.com"] }],
        switch: 1,
        templateType: "saas",
        action: "log",
        rulesGroupID: "middle",
      },
    });
    const res = await rpcdef(ctx)[WEBTEMPLATESAVE_PATH]();
    assert.equal(res.status, 200);
    assert.equal(res.result.templateKey, "template-abc123");
    assert.ok(mockServer.requests.some((req) => req.method === "POST" && req.url.startsWith("/v1/waf/webTemplate/save")));
  } finally {
    await mockServer.close();
  }
});

test("mock upstream switch end-to-end", async () => {
  const mockServer = await createMockServer();
  try {
    const ctx = buildCtx({
      config: { api_base: mockServer.url },
      req: { templateKey: "template-abc123", switch: 1 },
    });
    const res = await rpcdef(ctx)[WEBTEMPLATESWITCH_PATH]();
    assert.equal(res.success, true);
    assert.equal(res.status, 200);
    assert.ok(mockServer.requests.some((req) => req.method === "POST" && req.url.startsWith("/v1/waf/webTemplate/switch")));
  } finally {
    await mockServer.close();
  }
});

test("mock upstream list end-to-end", async () => {
  const mockServer = await createMockServer();
  try {
    const ctx = buildCtx({
      config: { api_base: mockServer.url },
      req: {
        pageNo: 1,
        pageSize: 10,
        switch: -1,
        action: "",
        templateName: "",
      },
    });
    const res = await rpcdef(ctx)[WEBTEMPLATELIST_PATH]();
    assert.equal(res.success, true);
    assert.equal(res.result.totalCount, 1);
    assert.ok(mockServer.requests.some((req) => req.method === "POST" && req.url.startsWith("/v1/waf/webTemplate/list")));
  } finally {
    await mockServer.close();
  }
});

test("mock upstream delete end-to-end", async () => {
  const mockServer = await createMockServer();
  try {
    const ctx = buildCtx({
      config: { api_base: mockServer.url },
      req: { templateKey: "template-abc123" },
    });
    const res = await rpcdef(ctx)[WEBTEMPLATEDELETE_PATH]();
    assert.equal(res.success, true);
    assert.equal(res.alreadyGone, false);
    assert.ok(mockServer.requests.some((req) => req.method === "DELETE" && req.url.startsWith("/v1/waf/webTemplate/delete?templateKey=template-abc123")));
  } finally {
    await mockServer.close();
  }
});

test("mock upstream whiteRulesdetail end-to-end", async () => {
  const mockServer = await createMockServer();
  try {
    const ctx = buildCtx({
      config: { api_base: mockServer.url },
      req: { ruleKey: "rule-key-123" },
    });
    const res = await rpcdef(ctx)[WHITERULESDETAIL_PATH]();
    assert.equal(res.success, true);
    assert.equal(res.result.ruleID, 1001);
    assert.ok(mockServer.requests.some((req) => req.method === "GET" && req.url.startsWith("/v1/waf/whiteRules/detail?ruleKey=rule-key-123")));
  } finally {
    await mockServer.close();
  }
});

test("mock upstream whiteRulesdelete end-to-end", async () => {
  const mockServer = await createMockServer();
  try {
    const ctx = buildCtx({
      config: { api_base: mockServer.url },
      req: { ruleKey: "rule-key-123" },
    });
    const res = await rpcdef(ctx)[WHITERULESDELETE_PATH]();
    assert.equal(res.success, true);
    assert.equal(res.alreadyGone, false);
    assert.deepEqual(res.result, []);
    assert.ok(mockServer.requests.some((req) => req.method === "DELETE" && req.url.startsWith("/v1/waf/whiteRules/delete?ruleKey=rule-key-123")));
  } finally {
    await mockServer.close();
  }
});

test("mock upstream whiteRulesdelete returns idempotent success on 404", async () => {
  const mockServer = await createMockServer();
  try {
    const ctx = buildCtx({
      config: { api_base: mockServer.url },
      req: { ruleKey: "gone-rule" },
    });
    const res = await rpcdef(ctx)[WHITERULESDELETE_PATH]();
    assert.equal(res.success, true);
    assert.equal(res.alreadyGone, true);
    assert.deepEqual(res.result, []);
  } finally {
    await mockServer.close();
  }
});

test("mock upstream whiteRulesswitch end-to-end", async () => {
  const mockServer = await createMockServer();
  try {
    const ctx = buildCtx({
      config: { api_base: mockServer.url },
      req: { ruleKey: "rule-key-123", switch: 1 },
    });
    const res = await rpcdef(ctx)[WHITERULESSWITCH_PATH]();
    assert.equal(res.success, true);
    assert.deepEqual(res.result, ["example"]);
    assert.ok(mockServer.requests.some((req) => req.method === "POST" && req.url.startsWith("/v1/waf/whiteRules/switch")));
  } finally {
    await mockServer.close();
  }
});

test("mock upstream whiteRuleslist end-to-end", async () => {
  const mockServer = await createMockServer();
  try {
    const ctx = buildCtx({
      config: { api_base: mockServer.url },
      req: {
        pageNo: 1,
        pageSize: 10,
      },
    });
    const res = await rpcdef(ctx)[WHITERULESLIST_PATH]();
    assert.equal(res.success, true);
    assert.equal(res.result.totalCount, 1);
    assert.equal(res.result.result[0].ruleKey, "rule-key-123");
    assert.ok(mockServer.requests.some((req) => req.method === "POST" && req.url.startsWith("/v1/waf/whiteRules/list")));
  } finally {
    await mockServer.close();
  }
});

test("mock upstream regionRuleslist end-to-end", async () => {
  const mockServer = await createMockServer();
  try {
    const ctx = buildCtx({
      config: { api_base: mockServer.url },
      req: { pageNo: 1, pageSize: 10 },
    });
    const res = await rpcdef(ctx)[REGIONRULESLIST_PATH]();
    assert.equal(res.success, true);
    assert.equal(res.result.totalCount, 1);
    assert.ok(mockServer.requests.some((req) => req.method === "POST" && req.url.startsWith("/v1/waf/regionRules/list")));
  } finally {
    await mockServer.close();
  }
});

test("service object is not empty", () => {
  assert.ok(service);
  assert.equal(typeof service, "object");
});
