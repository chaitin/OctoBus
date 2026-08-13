/**
 * NSFOCUS WAF V6.0.7 单元测试。
 * 覆盖网络层访问控制 /l4acl 接口的签名、参数校验、请求体和响应体映射。
 */
import test from "node:test";
import assert from "node:assert/strict";

import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

import {
  METHOD_BLOCK_IP,
  METHOD_LIST_BLOCKED_IPS,
  METHOD_UNBLOCK_IP,
  _test,
  handlers,
} from "../src/nsfocus-waf-v6-0-7.js";
import { service } from "../src/service.js";

const originalFetch = globalThis.fetch;

/** 构建测试上下文 */
const buildCtx = (overrides = {}) => ({
  config: {
    endpoint: "https://waf.example.com:8443",
    accountId: "admin",
    ...(overrides.config || {}),
  },
  secret: {
    pwd: "nsfocus",
    ...(overrides.secret || {}),
  },
  request: overrides.request || {},
});

/** 构造 fetch mock 响应 */
const response = (status, body) => ({
  status,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ======================== BlockIP（网络层访问控制）=======================

test("BlockIP 预置 token，POST /l4acl 创建封禁策略", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    // GET /l4acl — 查询现有策略（用于 index 自动分配）
    if (String(url).endsWith("/rest/v3/l4acl") && init.method === "GET") {
      return response(200, [{ index: "1", name: "existing" }]);
    }
    // POST /l4acl — 创建策略
    if (String(url).endsWith("/rest/v3/l4acl") && init.method === "POST") {
      return response(207, {
        result: [{ multi_result: "created successfully", multi_status: 200, name: "octobus", id: "82894423" }],
      });
    }
    throw new Error(`unexpected call ${url}`);
  };

  const res = await handlers[METHOD_BLOCK_IP](buildCtx({
    secret: { token: "tok", seceret_key: "secret" },
    request: {
      ips: ["1.1.1.1", "1.1.1.2"],
      policy_name: "octobus",
      action: "2",
      protocol: "0",
    },
  }));

  assert.equal(calls.length, 2); // GET /l4acl + POST /l4acl
  assert.equal(calls[0].init.method, "GET");
  assert.match(calls[0].url, /\/rest\/v3\/l4acl$/);

  // 验证 POST 请求体
  assert.equal(calls[1].init.method, "POST");
  assert.match(calls[1].url, /\/rest\/v3\/l4acl$/);
  const createBody = JSON.parse(calls[1].init.body);
  assert.equal(createBody[0].name, "octobus");
  assert.equal(createBody[0].index, "2"); // 自动分配: max(1) + 1 = 2
  assert.equal(createBody[0].action, "2");
  assert.equal(createBody[0].alarm, "1");
  assert.equal(createBody[0].enabled, "true");
  assert.equal(createBody[0].protocol, "0");
  // 验证 iptables src 中的 IP
  assert.deepEqual(createBody[0].iptables[0].src.iplist, [
    { ip: "1.1.1.1", mask: "255.255.255.255" },
    { ip: "1.1.1.2", mask: "255.255.255.255" },
  ]);
  // 验证 dst 为全零
  assert.deepEqual(createBody[0].iptables[0].dst.iplist, [
    { ip: "0.0.0.0", mask: "0.0.0.0" },
  ]);

  // 验证响应
  assert.equal(res.policy_id, "82894423");
  assert.equal(res.name, "octobus");
  assert.equal(res.result, "created successfully");
  assert.ok(res.raw);
});

test("BlockIP 使用用户指定的 index", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    // POST /l4acl — 创建策略
    if (String(url).endsWith("/rest/v3/l4acl") && init.method === "POST") {
      return response(207, {
        result: [{ multi_result: "created successfully", multi_status: 200, name: "myrule", id: "100" }],
      });
    }
    throw new Error(`unexpected call ${url}`);
  };

  const res = await handlers[METHOD_BLOCK_IP](buildCtx({
    secret: { token: "tok", seceret_key: "secret" },
    request: { ips: ["1.1.1.1"], index: "99" },
  }));

  // 当用户指定了 index，不调用 GET /l4acl
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body[0].index, "99");
  assert.equal(res.policy_id, "100");
});

// ======================== ListBlockedIPs ========================

test("ListBlockedIPs 查询所有策略并映射字段", async () => {
  let capturedUrl;
  globalThis.fetch = async (url, init) => {
    capturedUrl = String(url);
    return response(200, [{
      id: "82894423",
      name: "test-policy",
      index: "5",
      protocol: "0",
      alarm: "1",
      action: "2",
      enabled: "true",
      iptables: [{
        src: {
          iplist: [{ ip: "1.1.1.1", mask: "255.255.255.255" }],
          port1: "0", port2: "0", typeid: "0"
        },
        mulsrc: "false", id: "0",
        dst: {
          iplist: [{ ip: "0.0.0.0", mask: "0.0.0.0" }],
          port1: "0", port2: "0", typeid: "0"
        }
      }]
    }]);
  };

  const res = await handlers[METHOD_LIST_BLOCKED_IPS](buildCtx({
    secret: { token: "tok", secretKey: "secret" },
  }));

  assert.match(capturedUrl, /\/rest\/v3\/l4acl$/);
  assert.equal(res.policies.length, 1);
  assert.equal(res.policies[0].policy_id, "82894423");
  assert.equal(res.policies[0].name, "test-policy");
  assert.equal(res.policies[0].index, "5");
  assert.equal(res.policies[0].action, "2");
  assert.deepEqual(res.policies[0].blocked_ips, [{ ip: "1.1.1.1", mask: "255.255.255.255" }]);
});

test("ListBlockedIPs 按 IP 过滤", async () => {
  globalThis.fetch = async (url) => {
    return response(200, [
      { id: "1", name: "a", index: "1", iptables: [{ src: { iplist: [{ ip: "1.1.1.1", mask: "255.255.255.255" }], port1: "0", port2: "0", typeid: "0" }, mulsrc: "false", id: "0", dst: { iplist: [{ ip: "0.0.0.0", mask: "0.0.0.0" }], port1: "0", port2: "0", typeid: "0" }}] },
      { id: "2", name: "b", index: "2", iptables: [{ src: { iplist: [{ ip: "2.2.2.2", mask: "255.255.255.255" }], port1: "0", port2: "0", typeid: "0" }, mulsrc: "false", id: "0", dst: { iplist: [{ ip: "0.0.0.0", mask: "0.0.0.0" }], port1: "0", port2: "0", typeid: "0" }}] },
    ]);
  };

  const res = await handlers[METHOD_LIST_BLOCKED_IPS](buildCtx({
    secret: { token: "tok", secretKey: "secret" },
    request: { ips: ["1.1.1.1"] },
  }));

  assert.equal(res.policies.length, 1);
  assert.equal(res.policies[0].policy_id, "1");
});

test("ListBlockedIPs 查询单个策略", async () => {
  let capturedUrl;
  globalThis.fetch = async (url) => {
    capturedUrl = String(url);
    return response(200, { id: "82894423", name: "single", index: "1", iptables: [] });
  };

  await handlers[METHOD_LIST_BLOCKED_IPS](buildCtx({
    secret: { token: "tok", secretKey: "secret" },
    request: { policy_id: "82894423" },
  }));

  assert.match(capturedUrl, /\/rest\/v3\/l4acl\/82894423$/);
});

// ======================== UnblockIP ========================

test("UnblockIP 按 policy_ids 直接删除", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return response(200, { result: "delete successfully" });
  };

  const res = await handlers[METHOD_UNBLOCK_IP](buildCtx({
    secret: { token: "tok", secretKey: "secret" },
    request: { policy_ids: ["82894423", "82894424"] },
  }));

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/rest\/v3\/l4acl\/82894423$/);
  assert.equal(calls[0].init.method, "DELETE");
  assert.match(calls[1].url, /\/rest\/v3\/l4acl\/82894424$/);
  assert.equal(calls[1].init.method, "DELETE");
  assert.equal(res.results.length, 2);
  assert.equal(res.results[0].result, "delete successfully");
  assert.equal(res.results[1].result, "delete successfully");
});

test("UnblockIP 按 IP 查找并删除", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/rest/v3/l4acl") && init.method === "GET") {
      return response(200, [
        { id: "100", index: "1", name: "rule-a", iptables: [{ src: { iplist: [{ ip: "1.1.1.1", mask: "255.255.255.255" }], port1: "0", port2: "0", typeid: "0" }, mulsrc: "false", id: "0", dst: { iplist: [{ ip: "0.0.0.0", mask: "0.0.0.0" }], port1: "0", port2: "0", typeid: "0" }}] },
        { id: "200", index: "2", name: "rule-b", iptables: [{ src: { iplist: [{ ip: "2.2.2.2", mask: "255.255.255.255" }], port1: "0", port2: "0", typeid: "0" }, mulsrc: "false", id: "0", dst: { iplist: [{ ip: "0.0.0.0", mask: "0.0.0.0" }], port1: "0", port2: "0", typeid: "0" }}] },
      ]);
    }
    return response(200, { result: "delete successfully" });
  };

  const res = await handlers[METHOD_UNBLOCK_IP](buildCtx({
    secret: { token: "tok", secretKey: "secret" },
    request: { ips: ["1.1.1.1"] },
  }));

  // 第一次 GET 查询所有策略，第二次 DELETE 匹配的策略
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/rest\/v3\/l4acl$/);
  assert.match(calls[1].url, /\/rest\/v3\/l4acl\/100$/);
  assert.equal(calls[1].init.method, "DELETE");
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].policy_id, "100");
});

// ======================== 参数校验与错误映射 ========================

test("参数校验: ips 必填", async () => {
  await assert.rejects(
    () => handlers[METHOD_BLOCK_IP](buildCtx({ request: { ips: [] } })),
    /ips is required/,
  );
});

test("HTTP 401 映射为 UNAUTHENTICATED", async () => {
  globalThis.fetch = async () => response(401, { result: "unauthorized" });
  await assert.rejects(
    () => handlers[METHOD_LIST_BLOCKED_IPS](buildCtx({ secret: { token: "tok", secretKey: "secret" } })),
    (err) => err instanceof GrpcError && err.code === grpcStatus.UNAUTHENTICATED,
  );
});

test("网络错误映射为 UNAVAILABLE", async () => {
  globalThis.fetch = async () => { throw new Error("connection refused"); };
  await assert.rejects(
    () => handlers[METHOD_LIST_BLOCKED_IPS](buildCtx({ secret: { token: "tok", secretKey: "secret" } })),
    (err) => err instanceof GrpcError && err.code === grpcStatus.UNAVAILABLE,
  );
});

test("UnblockIP 无 ips 且无 policy_ids 时抛错", async () => {
  await assert.rejects(
    () => handlers[METHOD_UNBLOCK_IP](buildCtx({
      secret: { token: "tok", secretKey: "secret" },
      request: {},
    })),
    /ips or policy_ids is required/,
  );
});

// ======================== 辅助函数单测 ========================

test("extractBlockedIps 从策略中提取 IP 列表", () => {
  const policy = {
    iptables: [
      {
        src: { iplist: [{ ip: "1.1.1.1", mask: "255.255.255.255" }], port1: "0", port2: "0", typeid: "0" },
        mulsrc: "false", id: "0",
        dst: { iplist: [{ ip: "0.0.0.0", mask: "0.0.0.0" }], port1: "0", port2: "0", typeid: "0" },
      },
      {
        src: { iplist: [{ ip: "1.1.1.2", mask: "255.255.255.255" }], port1: "0", port2: "0", typeid: "0" },
        mulsrc: "false", id: "1",
        dst: { iplist: [{ ip: "0.0.0.0", mask: "0.0.0.0" }], port1: "0", port2: "0", typeid: "0" },
      },
    ],
  };
  const ips = _test.extractBlockedIps(policy);
  assert.deepEqual(ips, [
    { ip: "1.1.1.1", mask: "255.255.255.255" },
    { ip: "1.1.1.2", mask: "255.255.255.255" },
  ]);
});

test("extractL4CreateResult 解析 POST /l4acl 响应", () => {
  const json = {
    result: [
      { multi_result: "created successfully", multi_status: 200, name: "policy-a", id: "82894423" },
    ],
  };
  const results = _test.extractL4CreateResult(json);
  assert.deepEqual(results, [
    { result: "created successfully", policy_id: "82894423", name: "policy-a" },
  ]);
});

test("buildL4AclPayload 生成正确的请求体", () => {
  const req = { policy_name: "test", alarm: "1", action: "2", protocol: "0", enabled: "true" };
  const payload = _test.buildL4AclPayload(req, ["1.1.1.1", "1.1.1.2"], "5");
  assert.equal(payload.length, 1);
  assert.equal(payload[0].name, "test");
  assert.equal(payload[0].index, "5");
  assert.equal(payload[0].alarm, "1");
  assert.equal(payload[0].action, "2");
  assert.equal(payload[0].protocol, "0");
  assert.equal(payload[0].enabled, "true");
  assert.deepEqual(payload[0].iptables[0].src.iplist, [
    { ip: "1.1.1.1", mask: "255.255.255.255" },
    { ip: "1.1.1.2", mask: "255.255.255.255" },
  ]);
  assert.deepEqual(payload[0].iptables[0].dst.iplist, [
    { ip: "0.0.0.0", mask: "0.0.0.0" },
  ]);
});

test("签名辅助函数符合 PDF 规范", () => {
  assert.equal(_test.md5("/l4acl"), "f7aa749a8c9f14ebecd5466061a8117c");
  assert.equal(_test.normalizeBool("true", false), true);
  assert.equal(_test.normalizeBool("0", true), false);
  const query = _test.buildQuery({ b: "4", a: "3" });
  assert.deepEqual(_test.queryEntriesForSignature(query), [["a", "3"], ["b", "4"]]);
  // 验证 sha1
  const sig = _test.sha1("hello");
  assert.equal(typeof sig, "string");
  assert.equal(sig.length, 40);
});

test("输入规整辅助函数覆盖包装值、JSON headers 和列表别名", () => {
  assert.equal(_test.coerceString({ value: 42 }), "42");
  assert.equal(_test.coerceString(null), "");
  assert.deepEqual(_test.parseHeaders('{"X-Test":"yes"}'), { "X-Test": "yes" });
  assert.deepEqual(_test.parseHeaders("not-json"), {});
  assert.deepEqual(_test.parseHeaders(["bad"]), {});
  assert.deepEqual(_test.normalizeList({ values: "a, b" }), ["a", "b"]);
  assert.deepEqual(_test.normalizeList(""), []);
});

test("值转换辅助函数覆盖所有 protobuf Value 类型", () => {
  assert.deepEqual(_test.toValue(null), { nullValue: "NULL_VALUE" });
  assert.deepEqual(_test.toValue("x"), { stringValue: "x" });
  assert.deepEqual(_test.toValue(3), { numberValue: 3 });
  assert.deepEqual(_test.toValue(true), { boolValue: true });
  assert.deepEqual(_test.toValue(["x"]), { listValue: { values: [{ stringValue: "x" }] } });
  assert.deepEqual(_test.toStruct(null), { fields: {} });
  assert.deepEqual(_test.toStruct({ ok: true }), { fields: { ok: { boolValue: true } } });
});

test("HTTP 错误状态映射保留明确的 gRPC 语义", () => {
  const cases = [
    [400, grpcStatus.INVALID_ARGUMENT], [409, grpcStatus.INVALID_ARGUMENT],
    [403, grpcStatus.PERMISSION_DENIED], [404, grpcStatus.NOT_FOUND],
    [410, grpcStatus.NOT_FOUND], [503, grpcStatus.UNAVAILABLE],
    [418, grpcStatus.UNKNOWN],
  ];
  for (const [status, code] of cases) {
    assert.equal(_test.mapHTTPError(status, { message: "failure" }, "", true).code, code);
  }
  assert.equal(_test.mapHTTPError(418, {}, "", false).code, grpcStatus.UNAUTHENTICATED);
  assert.throws(() => _test.parseJSON("not-json"), /non-JSON/);
});

test("BlockIP 自动 index 冲突后重试并采用递增 index", async () => {
  const posted = [];
  globalThis.fetch = async (url, init) => {
    if (init.method === "GET") return response(200, [{ index: "4" }]);
    posted.push(JSON.parse(init.body)[0].index);
    if (posted.length === 1) return response(207, { result: [{ multi_result: "index conflict" }] });
    return response(207, { result: [{ multi_result: "created successfully", id: "ok" }] });
  };
  const result = await handlers[METHOD_BLOCK_IP](buildCtx({
    secret: { token: "tok", secretKey: "secret" }, request: { ips: ["1.2.3.4"] },
  }));
  assert.deepEqual(posted, ["5", "6"]);
  assert.equal(result.policy_id, "ok");
});

test("BlockIP 对确定性上游创建错误返回 INVALID_ARGUMENT", async () => {
  globalThis.fetch = async (_url, init) => init.method === "GET"
    ? response(200, [])
    : response(207, { result: [{ multi_result: "invalid address" }] });
  await assert.rejects(
    handlers[METHOD_BLOCK_IP](buildCtx({ secret: { token: "t", secretKey: "s" }, request: { ips: ["bad"] } })),
    (err) => err.code === grpcStatus.INVALID_ARGUMENT,
  );
});

test("token 登录支持 JWT 时钟偏移，并拒绝缺失密钥的响应", async () => {
  const jwt = `x.${Buffer.from(JSON.stringify({ iat: Math.floor(Date.now() / 1000) + 10 })).toString("base64")}.x`;
  globalThis.fetch = async () => response(200, { token: jwt, seceret_key: "secret" });
  const client = new _test.NSFOCUSWAFClient({ endpoint: "https://waf.example", accountId: "a", pwd: "p" });
  await client.ensureToken();
  assert.ok(client.clockOffset >= 9);

  globalThis.fetch = async () => response(200, { token: "only-token" });
  const invalid = new _test.NSFOCUSWAFClient({ endpoint: "https://waf.example", accountId: "a", pwd: "p" });
  await assert.rejects(invalid.ensureToken(), /must include token/);
});

test("UnblockIP 将 NOT_FOUND 视为幂等成功并重试瞬态错误", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return response(503, { message: "busy" });
    return response(404, { message: "gone" });
  };
  const result = await handlers[METHOD_UNBLOCK_IP](buildCtx({
    secret: { token: "t", secretKey: "s" }, request: { policy_ids: ["42"] },
  }));
  assert.equal(calls, 2);
  assert.match(result.results[0].result, /already deleted/);
});

test("客户端配置别名、路径与 query 构造保持兼容", () => {
  const client = new _test.NSFOCUSWAFClient({
    baseUrl: "https://waf.example///", apiVersion: "/v4", account_id: "user",
    password: "pass", timeout_ms: "7000", skip_tls_verify: 1,
  });
  assert.equal(client.baseUrl, "https://waf.example");
  assert.equal(client.restPath("l4acl"), "/rest/v4/l4acl");
  assert.equal(client.accountId, "user");
  assert.equal(client.timeoutMs, 7000);
  assert.equal(client.skipTlsVerify, true);
  assert.throws(() => new _test.NSFOCUSWAFClient({ endpoint: "waf.example" }), /http\(s\) URL/);
  const query = _test.buildQuery({ absent: null, empty: "", list: ["a", "b"], none: [], n: 3 });
  assert.equal(query.toString(), "list=a%2Cb&n=3");
});

test("签名请求头包含认证信息且空 query/body 不参与散列", () => {
  const client = new _test.NSFOCUSWAFClient({ endpoint: "https://waf.example", token: "t", secretKey: "s" });
  const headers = client.signatureHeaders("/rest/v3/l4acl", new URLSearchParams(), "");
  assert.equal(headers.Authorization, "Bearer t");
  assert.equal(headers.Nonce.length, 10);
  assert.match(headers.Signature, /^[a-f0-9]{40}$/);
});

test("BlockIP 限制批量 IP 数量", async () => {
  await assert.rejects(
    handlers[METHOD_BLOCK_IP](buildCtx({ request: { ips: Array.from({ length: 11 }, (_, i) => `10.0.0.${i}`) } })),
    /at most 10/,
  );
});

test("UnblockIP 对确定性删除错误保留原始错误码", async () => {
  globalThis.fetch = async () => response(401, { message: "bad token" });
  await assert.rejects(
    handlers[METHOD_UNBLOCK_IP](buildCtx({
      secret: { token: "t", secretKey: "s" }, request: { policy_ids: ["42"] },
    })),
    (err) => err.code === grpcStatus.UNAUTHENTICATED,
  );
});
