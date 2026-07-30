import test from "node:test";
import assert from "node:assert/strict";

import { fromJson } from "@bufbuild/protobuf";
import { StructSchema } from "@bufbuild/protobuf/wkt";
import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

import {
  DEFAULT_RPC_PATH,
  DEFAULT_TIMEOUT_MS,
  InsightClient,
  InsightClientError,
  normalizeBaseUrl,
  normalizeRpcPath,
  normalizeTimeoutMs,
  toJsonSafe,
} from "../src/insight-client.js";
import {
  METHODS,
  RPC_METHODS,
  buildAssetParams,
  buildListOrdersQuery,
  buildPagedParams,
  buildVulnerabilityParams,
  handlers,
  resolveSettings,
  toGrpcError,
  toPlainObject,
} from "../src/insight-service.js";

const okResponse = (payload) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(payload),
});

const errorResponse = (status, payload) => ({
  ok: false,
  status,
  text: async () => JSON.stringify(payload),
});

const context = (request = {}, fetchImpl = async (_url, init) => {
  const body = JSON.parse(init.body);
  return okResponse({ jsonrpc: "2.0", id: body.id, result: { ok: true } });
}) => ({
  request,
  config: { baseUrl: "https://insight.example", timeoutMs: 5000 },
  secret: { token: "test-token" },
  fetchImpl,
});

test("normalization and request helpers cover supported scalar forms", () => {
  assert.equal(normalizeBaseUrl(" https://example.test/base/?x=1#x "), "https://example.test/base");
  assert.equal(normalizeBaseUrl("http://example.test/"), "http://example.test");
  assert.throws(() => normalizeBaseUrl(""), /baseUrl is required/);
  assert.throws(() => normalizeBaseUrl("not a URL"), /valid HTTP/);
  assert.throws(() => normalizeBaseUrl("ftp://example.test"), /HTTP or HTTPS/);
  assert.equal(normalizeRpcPath(), DEFAULT_RPC_PATH);
  assert.equal(normalizeRpcPath("rpc"), "/rpc");
  assert.equal(normalizeRpcPath(""), DEFAULT_RPC_PATH);
  assert.equal(normalizeTimeoutMs(), DEFAULT_TIMEOUT_MS);
  assert.equal(normalizeTimeoutMs("bad"), DEFAULT_TIMEOUT_MS);
  assert.equal(normalizeTimeoutMs(2), 1000);
  assert.equal(normalizeTimeoutMs(999999), 120000);
  assert.deepEqual(toJsonSafe({ small: 2n, large: 9007199254740993n, values: [3n] }), {
    small: 2,
    large: "9007199254740993",
    values: [3],
  });

  assert.deepEqual(buildPagedParams({ count: 4n, offset: 2n }), { count: 4, offset: 2 });
  assert.deepEqual(buildPagedParams({ count: -1, offset: -1 }), { count: 20, offset: 0 });
  assert.deepEqual(buildPagedParams({ count: 5000, offset: "bad" }), { count: 1000, offset: 0 });
  assert.deepEqual(toPlainObject(null), {});
  assert.deepEqual(toPlainObject([]), {});
  assert.deepEqual(toPlainObject({ a: 1 }), { a: 1 });
  const struct = fromJson(StructSchema, { region: "cn", enabled: true });
  assert.deepEqual(toPlainObject(struct), { region: "cn", enabled: true });
  assert.deepEqual(buildAssetParams({ count: 2, filter: struct }), {
    count: 2,
    offset: 0,
    filter: { region: "cn", enabled: true },
  });
  assert.deepEqual(buildVulnerabilityParams({ params: { rel_asset: false, severity: "high" } }), {
    rel_asset: false,
    severity: "high",
    count: 20,
    offset: 0,
  });
  assert.deepEqual(buildListOrdersQuery({
    page: 2,
    size: 5,
    name: " demo ",
    status: 3,
    isTimeout: false,
  }), {
    page: 2,
    size: 5,
    name: "demo",
    status: 3,
    is_timeout: false,
  });
  assert.deepEqual(buildListOrdersQuery({}), {
    page: 1,
    size: 20,
    name: undefined,
    status: undefined,
    is_timeout: undefined,
  });
});

test("settings merge config, bindings, and secret without exposing token in requests", () => {
  const fetchImpl = async () => okResponse({});
  assert.deepEqual(resolveSettings({
    config: { baseUrl: "http://config", sendJwtCookie: false },
    bindings: { baseUrl: "http://binding", rpcPath: "rpc", skipTlsVerify: true },
    secret: { token: "secret" },
    fetchImpl,
  }), {
    baseUrl: "http://binding",
    rpcPath: "rpc",
    token: "secret",
    timeoutMs: undefined,
    skipTlsVerify: true,
    sendJwtCookie: false,
    fetchImpl,
  });
  assert.equal(resolveSettings({ bindings: { insightBaseUrl: "http://legacy", insightToken: "t" } }).baseUrl, "http://legacy");
});

test("client sends JSON-RPC envelopes and dual authentication", async () => {
  let captured;
  const client = new InsightClient({
    baseUrl: "https://example.test/insight",
    token: "secret",
    rpcPath: "custom-rpc",
    fetchImpl: async (url, init) => {
      captured = { url: String(url), init };
      const body = JSON.parse(init.body);
      return okResponse({ jsonrpc: "2.0", id: body.id, result: { total: 1 } });
    },
  });
  assert.deepEqual(await client.callRpc("Demo.List", { id: 4n }), { total: 1 });
  assert.equal(captured.url, "https://example.test/insight/custom-rpc");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers.authorization, "Bearer secret");
  assert.equal(captured.init.headers.cookie, "jwt=secret");
  assert.equal(captured.init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(captured.init.body), {
    jsonrpc: "2.0",
    id: "0",
    method: "Demo.List",
    params: { id: 4 },
  });
  assert.throws(() => client.buildUrl("relative"), /start with/);
  await client.close();
});

test("client supports REST queries, no-cookie mode, and TLS dispatcher", async () => {
  let captured;
  const client = new InsightClient({
    baseUrl: "http://example.test",
    token: "secret",
    sendJwtCookie: false,
    skipTlsVerify: true,
    fetchImpl: async (url, init) => {
      captured = { url: String(url), init };
      return okResponse({ code: 0, data: { id: 1 } });
    },
  });
  assert.deepEqual(await client.callRest("GET", "/api/items", {
    query: { page: 2, missing: undefined, empty: "" },
  }), { code: 0, data: { id: 1 } });
  assert.equal(captured.url, "http://example.test/api/items?page=2");
  assert.equal(captured.init.method, "GET");
  assert.equal(Object.hasOwn(captured.init.headers, "cookie"), false);
  assert.ok(captured.init.dispatcher);
  await client.close();
  assert.throws(() => new InsightClient({ baseUrl: "http://x", token: "" }), /token is required/);
});

test("all public JSON-RPC handlers map to the methods published by chaitin-cli", async () => {
  const cases = [
    [METHODS.LIST_TASKS, RPC_METHODS.LIST_TASKS, { count: 3, offset: 2 }, { count: 3, offset: 2 }],
    [METHODS.LIST_IP_ASSETS, RPC_METHODS.LIST_IP_ASSETS, { count: 2, filter: { ip: "10.0.0.1" } }, { count: 2, offset: 0, filter: { ip: "10.0.0.1" } }],
    [METHODS.LIST_WEB_ASSETS, RPC_METHODS.LIST_WEB_ASSETS, {}, { count: 20, offset: 0, filter: {} }],
    [METHODS.LIST_SOFTWARE_ASSETS, RPC_METHODS.LIST_SOFTWARE_ASSETS, {}, { count: 20, offset: 0, filter: {} }],
    [METHODS.LIST_ASSET_TAGS, RPC_METHODS.LIST_ASSET_TAGS, {}, { count: 20, offset: 0, filter: {} }],
    [METHODS.LIST_ASSET_BUSINESSES, RPC_METHODS.LIST_ASSET_BUSINESSES, {}, { count: 20, offset: 0, filter: {} }],
    [METHODS.LIST_IP_VULNERABILITIES, RPC_METHODS.LIST_IP_VULNERABILITIES, { params: { severity: "high" } }, { severity: "high", count: 20, offset: 0, rel_asset: true }],
    [METHODS.LIST_WEB_VULNERABILITIES, RPC_METHODS.LIST_WEB_VULNERABILITIES, {}, { count: 20, offset: 0, rel_asset: true }],
  ];

  for (const [handlerName, expectedMethod, request, expectedParams] of cases) {
    let actual;
    const result = await handlers[handlerName](context(request, async (_url, init) => {
      actual = JSON.parse(init.body);
      return okResponse({ jsonrpc: "2.0", id: actual.id, result: { method: actual.method } });
    }));
    assert.equal(actual.method, expectedMethod);
    assert.deepEqual(actual.params, expectedParams);
    assert.deepEqual(result, { result: { method: expectedMethod } });
  }
});

test("all public REST handlers preserve the paths and parameters published by chaitin-cli", async () => {
  const cases = [
    [METHODS.START_TASK, { id: "task-1" }, "POST", "/exposure/api/task/reexecute", {}, { id: "task-1" }],
    [METHODS.STOP_TASK, { id: "exec-1" }, "POST", "/exposure/api/task/stop", {}, { id: "exec-1" }],
    [METHODS.GET_TASK_STATUS, { executionId: "exec-2" }, "GET", "/exposure/api/task/execution", { id: "exec-2" }, undefined],
    [METHODS.LIST_TASK_RESULTS, { taskId: "task-2" }, "GET", "/exposure/api/result", { task_id: "task-2" }, undefined],
    [METHODS.COMPARE_TASK_RESULTS, { executionId: "exec-3" }, "GET", "/exposure/api/result/comparison", { exec_id: "exec-3" }, undefined],
    [METHODS.GET_ASSET_SNAPSHOT, {}, "GET", "/exposure/api/snapshot/asset", {}, undefined],
    [METHODS.LIST_ORDERS, { page: 2, size: 10, name: "order", status: 1, is_timeout: true }, "GET", "/workflow/api/orders/all", { page: "2", size: "10", name: "order", status: "1", is_timeout: "true" }, undefined],
    [METHODS.GET_LICENSE, {}, "GET", "/mgt/api/license", {}, undefined],
    [METHODS.GET_MACHINE_ID, {}, "GET", "/mgt/api/noauth/machine_id", {}, undefined],
  ];

  for (const [handlerName, request, method, pathname, query, body] of cases) {
    let actual;
    const result = await handlers[handlerName](context(request, async (url, init) => {
      const parsed = new URL(url);
      actual = {
        method: init.method,
        pathname: parsed.pathname,
        query: Object.fromEntries(parsed.searchParams),
        body: init.body ? JSON.parse(init.body) : undefined,
      };
      return okResponse({ code: 0, data: { ok: true } });
    }));
    assert.deepEqual(actual, { method, pathname, query, body });
    assert.deepEqual(result, { result: { code: 0, data: { ok: true } } });
  }
});

test("health check reports success and failure without leaking errors as RPC failures", async () => {
  const success = await handlers[METHODS.HEALTH_CHECK](context({}, async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.method, RPC_METHODS.LIST_SOFTWARE_ASSETS);
    assert.deepEqual(body.params, { count: 1, offset: 0, filter: {} });
    return okResponse({ jsonrpc: "2.0", id: body.id, result: { total: 0 } });
  }));
  assert.deepEqual(success, { reachable: true, message: "Insight API is reachable" });

  const failure = await handlers[METHODS.HEALTH_CHECK](context({}, async () => {
    throw new Error("connection refused");
  }));
  assert.deepEqual(failure, { reachable: false, message: "connection refused" });
});

test("required IDs fail closed with INVALID_ARGUMENT", async () => {
  for (const method of [METHODS.START_TASK, METHODS.STOP_TASK, METHODS.GET_TASK_STATUS, METHODS.COMPARE_TASK_RESULTS]) {
    await assert.rejects(
      handlers[method](context()),
      (error) => error instanceof GrpcError && error.code === grpcStatus.INVALID_ARGUMENT,
    );
  }
});

test("HTTP, business, transport, and JSON-RPC errors map to stable gRPC errors", async () => {
  const httpCases = [
    [401, "UNAUTHENTICATED", grpcStatus.UNAUTHENTICATED],
    [403, "PERMISSION_DENIED", grpcStatus.PERMISSION_DENIED],
    [404, "NOT_FOUND", grpcStatus.NOT_FOUND],
    [429, "RESOURCE_EXHAUSTED", grpcStatus.RESOURCE_EXHAUSTED],
    [500, "UNAVAILABLE", grpcStatus.UNAVAILABLE],
  ];
  for (const [status, _name, expected] of httpCases) {
    await assert.rejects(
      handlers[METHODS.GET_LICENSE](context({}, async () => errorResponse(status, { msg: `http-${status}` }))),
      (error) => error instanceof GrpcError && error.code === expected,
    );
  }

  const businessCases = [
    [400, grpcStatus.INVALID_ARGUMENT],
    [401, grpcStatus.UNAUTHENTICATED],
    [403, grpcStatus.PERMISSION_DENIED],
    [404, grpcStatus.NOT_FOUND],
    [409, grpcStatus.FAILED_PRECONDITION],
    [413, grpcStatus.RESOURCE_EXHAUSTED],
    [500, grpcStatus.UNAVAILABLE],
    [100, grpcStatus.UNKNOWN],
  ];
  for (const [code, expected] of businessCases) {
    await assert.rejects(
      handlers[METHODS.GET_LICENSE](context({}, async () => okResponse({ code, msg: `business-${code}` }))),
      (error) => error instanceof GrpcError && error.code === expected,
    );
  }

  await assert.rejects(
    handlers[METHODS.LIST_TASKS](context({}, async (_url, init) => {
      const body = JSON.parse(init.body);
      return okResponse({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message: "bad params" } });
    })),
    (error) => error instanceof GrpcError && error.code === grpcStatus.INVALID_ARGUMENT,
  );
});

test("client rejects malformed upstream responses", async () => {
  const rpcPayloads = [
    null,
    { jsonrpc: "1.0", id: "0", result: {} },
    { jsonrpc: "2.0", id: "wrong", result: {} },
    { jsonrpc: "2.0", id: "0" },
    { jsonrpc: "2.0", id: "0", result: {}, error: {} },
    { jsonrpc: "2.0", id: "0", error: { code: -32601, message: "missing" } },
    { jsonrpc: "2.0", id: "0", error: { code: -32000, message: "upstream" } },
  ];
  for (const payload of rpcPayloads) {
    const client = new InsightClient({
      baseUrl: "http://example.test",
      token: "secret",
      fetchImpl: async () => okResponse(payload),
    });
    await assert.rejects(client.callRpc("Demo.List"), InsightClientError);
  }

  const nonJson = new InsightClient({
    baseUrl: "http://example.test",
    token: "secret",
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => "not-json" }),
  });
  await assert.rejects(nonJson.callRest("GET", "/api"), /non-JSON/);

  const network = new InsightClient({
    baseUrl: "http://example.test",
    token: "secret",
    fetchImpl: async () => { throw new Error("network down"); },
  });
  await assert.rejects(network.callRest("GET", "/api"), /network down/);
  await assert.rejects(network.callRpc(""), /method is required/);
});

test("explicit error conversion preserves gRPC errors and handles unknown errors", () => {
  const grpcError = new GrpcError(grpcStatus.NOT_FOUND, "missing");
  assert.equal(toGrpcError(grpcError), grpcError);
  assert.equal(toGrpcError(new InsightClientError("denied", { code: "PERMISSION_DENIED" })).code, grpcStatus.PERMISSION_DENIED);
  assert.equal(toGrpcError(new Error("boom")).code, grpcStatus.UNKNOWN);
  assert.equal(toGrpcError(null).message, "Insight request failed");
  assert.equal(Object.keys(handlers).length, 18);
});
