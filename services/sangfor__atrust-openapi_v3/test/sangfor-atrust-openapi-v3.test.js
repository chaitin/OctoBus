import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { grpcStatus } from "@chaitin-ai/octobus-sdk";

import { _test, handlers as contextHandlers, rpcdef } from "../src/sangfor-atrust-openapi-v3.js";
import { startMockUpstream } from "./mock_upstream.js";

const handlers = _test.requestHandlers;

const baseCtx = (upstream) => ({
  config: {
    host: upstream.baseUrl,
    timeoutMs: 1000,
  },
  secret: {
    apiId: upstream.apiId,
    apiSecret: upstream.apiSecret,
  },
});

test("signing string follows aTrust OpenAPI V3 documentation", () => {
  const timestamp = "1700000000";
  const nonce = "nonce-1";
  const apiId = "api-id";
  const apiSecret = "api-secret";
  const apiPath = "/api/v1/admin/login";
  const query = { username: "sf", password: "123" };
  const body = { status: 1, type: "test" };
  const signingString = "/api/v1/admin/login?password=123&username=sf&{\"status\":1,\"type\":\"test\"}";
  const key = `appId=${apiId}&appSecret=${apiSecret}&timestamp=${timestamp}&nonce=${nonce}`;
  const expected = crypto.createHmac("sha256", key).update(signingString).digest("hex");

  assert.equal(_test.signingString(apiPath, query, body), signingString);
  assert.equal(_test.sign({ apiId, apiSecret, timestamp, nonce, apiPath, query, body }), expected);
});

test("signing string keeps non-ASCII query values unescaped", () => {
  assert.equal(
    _test.signingString("/api/v1/userDirectory/query", { name: "本地用户目录" }),
    "/api/v1/userDirectory/query?name=本地用户目录",
  );
  assert.equal(_test.queryString({ name: "本地用户目录" }), "?name=%E6%9C%AC%E5%9C%B0%E7%94%A8%E6%88%B7%E7%9B%AE%E5%BD%95");
});

test("online user query sends signed GET with sorted query", async () => {
  const upstream = await startMockUpstream();
  try {
    const response = await handlers["Sangfor_Atrust_OpenAPI_V3.Sangfor_Atrust_OpenAPI_V3/ListOnlineUsers"]({
      page_size: 20,
      page_index: 1,
      search_value: "zhang",
    }, baseCtx(upstream));
    assert.equal(response.code, "0");
    assert.equal(response.trace_id, "trace-online");
    assert.equal(response.data.count, 1);

    const request = upstream.state.requests.at(-1);
    assert.equal(request.signedError, "");
    assert.equal(request.pathname, "/api/v1/monitor/getUserStatus");
    assert.equal(request.signingString, "/api/v1/monitor/getUserStatus?pageIndex=1&pageSize=20&searchValue=zhang");
  } finally {
    await upstream.close();
  }
});

test("kickout users sends compact JSON body in signature", async () => {
  const upstream = await startMockUpstream();
  try {
    const response = await handlers["Sangfor_Atrust_OpenAPI_V3.Sangfor_Atrust_OpenAPI_V3/KickoutUsers"]({
      user_list: [{ name: "zhangsan", user_directory_name: "local" }],
    }, baseCtx(upstream));
    assert.equal(response.code, "0");
    assert.deepEqual(upstream.state.kicked[0], {
      userList: [{ name: "zhangsan", userDirectoryName: "local" }],
    });

    const request = upstream.state.requests.at(-1);
    assert.equal(request.signedError, "");
    assert.equal(request.bodyText, "{\"userList\":[{\"name\":\"zhangsan\",\"userDirectoryName\":\"local\"}]}");
    assert.equal(request.signingString, `/api/v1/monitor/kickoutUsers?${request.bodyText}`);
  } finally {
    await upstream.close();
  }
});

test("user, group, role, resource, directory, and device query methods map documented paths", async () => {
  const upstream = await startMockUpstream();
  try {
    const ctx = baseCtx(upstream);
    const user = await handlers["Sangfor_Atrust_OpenAPI_V3.Sangfor_Atrust_OpenAPI_V3/QueryUser"]({
      directory_domain: "local",
      name: "zhangsan",
    }, ctx);
    assert.equal(user.data.id, "user-1");

    const users = await handlers["Sangfor_Atrust_OpenAPI_V3.Sangfor_Atrust_OpenAPI_V3/ListUsers"]({
      directory_domain: "local",
      page_size: 50,
      page_index: 1,
      search_by_path: "/",
      recursive: 1,
    }, ctx);
    assert.equal(users.data.request.directoryDomain, "local");

    const group = await handlers["Sangfor_Atrust_OpenAPI_V3.Sangfor_Atrust_OpenAPI_V3/QueryGroup"]({
      directory_domain: "local",
      full_path: "/dev",
    }, ctx);
    assert.equal(group.data.id, "group-1");

    const groups = await handlers["Sangfor_Atrust_OpenAPI_V3.Sangfor_Atrust_OpenAPI_V3/ListGroups"]({
      body: { directoryDomain: "local", pageSize: 20 },
    }, ctx);
    assert.equal(groups.data.data.length, 1);

    const role = await handlers["Sangfor_Atrust_OpenAPI_V3.Sangfor_Atrust_OpenAPI_V3/QueryRole"]({ id: "role-1", directory_domain: "local" }, ctx);
    assert.equal(role.data.name, "admin");

    const roles = await handlers["Sangfor_Atrust_OpenAPI_V3.Sangfor_Atrust_OpenAPI_V3/ListRoles"]({ directory_domain: "local" }, ctx);
    assert.equal(roles.data.data.length, 1);

    const resources = await handlers["Sangfor_Atrust_OpenAPI_V3.Sangfor_Atrust_OpenAPI_V3/ListResources"]({ filter: "name", search_value: "oa" }, ctx);
    assert.equal(resources.data.filter, "name");

    const resource = await handlers["Sangfor_Atrust_OpenAPI_V3.Sangfor_Atrust_OpenAPI_V3/QueryResource"]({ id: "res-1" }, ctx);
    assert.equal(resource.data.name, "oa");

    const resourceGroups = await handlers["Sangfor_Atrust_OpenAPI_V3.Sangfor_Atrust_OpenAPI_V3/ListResourceGroups"]({ search_value: "default" }, ctx);
    assert.equal(resourceGroups.data.resourceGroup[0].id, "default");

    const directories = await handlers["Sangfor_Atrust_OpenAPI_V3.Sangfor_Atrust_OpenAPI_V3/ListUserDirectories"]({}, ctx);
    assert.equal(directories.data[0].name, "local");

    const directory = await handlers["Sangfor_Atrust_OpenAPI_V3.Sangfor_Atrust_OpenAPI_V3/QueryUserDirectory"]({ name: "local" }, ctx);
    assert.equal(directory.data.type, "local");

    const devices = await handlers["Sangfor_Atrust_OpenAPI_V3.Sangfor_Atrust_OpenAPI_V3/ListDevices"]({ page_size: 10 }, ctx);
    assert.equal(devices.data.data[0].id, "device-1");

    const device = await handlers["Sangfor_Atrust_OpenAPI_V3.Sangfor_Atrust_OpenAPI_V3/QueryDevice"]({ external_id: "asset-1" }, ctx);
    assert.equal(device.data.name, "pc-1");

    const paths = upstream.state.requests.map((request) => request.pathname);
    assert.deepEqual(paths, [
      "/api/v3/user/queryByName",
      "/api/v3/user/queryAll",
      "/api/v3/group/queryByFullPath",
      "/api/v3/group/queryAll",
      "/api/v3/role/queryById",
      "/api/v3/role/queryAll",
      "/api/v3/resource/queryAll",
      "/api/v3/resource/queryById",
      "/api/v3/resourceGroup/queryAll",
      "/api/v1/userDirectory/queryAll",
      "/api/v1/userDirectory/query",
      "/api/v1/device/queryAll",
      "/api/v1/device/query",
    ]);
    const deviceListRequest = upstream.state.requests.find((request) => request.pathname === "/api/v1/device/queryAll");
    assert.equal(deviceListRequest.method, "POST");
    assert.equal(deviceListRequest.bodyText, "{\"pageSize\":10}");
    assert.ok(upstream.state.requests.every((request) => request.signedError === ""));
  } finally {
    await upstream.close();
  }
});

test("skipTlsVerify reuses dispatcher", () => {
  const ctx = {
    config: {
      host: "https://example.test:4433",
      skipTlsVerify: true,
    },
    secret: {
      apiId: "id",
      apiSecret: "secret",
    },
  };

  const first = _test.createContext(ctx).dispatcher;
  const second = _test.createContext(ctx).dispatcher;
  assert.ok(first);
  assert.equal(first, second);
});

test("timestampOffsetSeconds shifts signing timestamp", () => {
  const ctx = {
    apiId: "id",
    apiSecret: "secret",
    timestampOffsetSeconds: 28800,
  };
  const headers = _test.authHeaders(ctx, "/api/v1/test", {}, undefined, 1700000000000, "nonce");
  assert.equal(headers["x-ca-timestamp"], "1700028800");
});

test("context validation rejects unsafe endpoints and missing credentials", () => {
  for (const host of ["http://example.test", "ftp://example.test", "https://user:pass@example.test", "not-a-url"]) {
    assert.throws(() => _test.createContext({ config: { host }, secret: { apiId: "id", apiSecret: "secret" } }),
      (err) => err.code === grpcStatus.INVALID_ARGUMENT);
  }
  assert.throws(() => _test.createContext({ config: { host: "https://example.test" }, secret: { apiSecret: "secret" } }),
    /apiId is required/);
  assert.throws(() => _test.createContext({ config: { host: "https://example.test" }, secret: { apiId: "id" } }),
    /apiSecret is required/);

  const ctx = _test.createContext({
    config: {
      host: "https://example.test/",
      timeoutMs: "invalid",
      maxResponseBytes: 99999999,
      headers: {
        "X-Custom": { value: "ok" },
        Authorization: "secret",
        "bad header": "no",
        "x-lines": "first\r\nsecond",
      },
    },
    secret: { apiId: { value: "id" }, apiSecret: { value: "secret" } },
  });
  assert.equal(ctx.baseUrl, "https://example.test");
  assert.equal(ctx.timeoutMs, 5000);
  assert.equal(ctx.maxResponseBytes, 10 * 1024 * 1024);
  assert.deepEqual(ctx.headers, { "x-custom": "ok" });
});

test("protobuf values and helper edge cases are normalized", () => {
  assert.deepEqual(_test.plainObject({ fields: {
    text: { stringValue: "value" }, count: { numberValue: 2 }, enabled: { boolValue: true },
    empty: { nullValue: 0 }, list: { listValue: { values: [{ stringValue: "one" }] } },
    nested: { structValue: { fields: { key: { stringValue: "nested" } } } }, untouched: {},
  } }), { text: "value", count: 2, enabled: true, empty: null, list: ["one"], nested: { key: "nested" }, untouched: {} });
  assert.deepEqual(_test.normalizeQuery({ empty: "", nil: null, absent: undefined, zero: 0 }), { zero: "0" });
  assert.equal(_test.compactJson(null), "");
  assert.equal(_test.signingString("/path", {}, { ok: true }), '/path?{"ok":true}');
  assert.equal(_test.signingString("/path"), "/path");
  assert.equal(_test.queryString({}), "");
  assert.deepEqual(_test.bodyWithPaging({ page_size: -1, page_index: 2, recursive: 0 }), { pageIndex: 2, recursive: 0 });
  assert.deepEqual(_test.queryWithPaging({ id: "id", name: "name" }), { id: "id", name: "name" });
});

test("invalid requests fail before contacting upstream", async () => {
  const upstream = await startMockUpstream();
  try {
    const ctx = baseCtx(upstream);
    const cases = [
      ["KickoutUsers", {}, /id_list or user_list/],
      ["QueryUser", {}, /requires one of/],
      ["QueryUserDirectory", {}, /requires id or name/],
      ["QueryDevice", {}, /requires id/],
    ];
    for (const [method, request, message] of cases) {
      await assert.rejects(async () => handlers[`Sangfor_Atrust_OpenAPI_V3.Sangfor_Atrust_OpenAPI_V3/${method}`](request, ctx),
        (err) => err.code === grpcStatus.INVALID_ARGUMENT && message.test(err.message));
    }
  } finally {
    await upstream.close();
  }
});

test("upstream failures are mapped without leaking response secrets", async () => {
  const upstream = await startMockUpstream();
  try {
    const call = (testMode, overrides = {}) => handlers["Sangfor_Atrust_OpenAPI_V3.Sangfor_Atrust_OpenAPI_V3/ListOnlineUsers"](
      { query: { testMode } }, { ...baseCtx(upstream), ...overrides },
    );
    await assert.rejects(call("denied"), (err) => err.code === grpcStatus.PERMISSION_DENIED && !err.message.includes("must-not-leak"));
    await assert.rejects(call("unavailable"), (err) => err.code === grpcStatus.UNAVAILABLE && !err.message.includes("must-not-leak"));
    await assert.rejects(call("bad-request"), (err) => err.code === grpcStatus.FAILED_PRECONDITION && /invalid filter/.test(err.message));
    await assert.rejects(call("invalid-json"), (err) => err.code === grpcStatus.FAILED_PRECONDITION && /invalid JSON/.test(err.message));
    await assert.rejects(call("large", { config: { ...baseCtx(upstream).config, maxResponseBytes: 32 } }),
      (err) => err.code === grpcStatus.FAILED_PRECONDITION && /exceeds 32 bytes/.test(err.message));
    await assert.rejects(call("slow", { config: { ...baseCtx(upstream).config, timeoutMs: 5 } }),
      (err) => err.code === grpcStatus.UNAVAILABLE);
  } finally {
    await upstream.close();
  }
});

test("rpcdef exposes every handler using one runtime context", () => {
  const methods = rpcdef({ config: {}, secret: {} });
  assert.equal(Object.keys(methods).length, Object.keys(contextHandlers).length);
  assert.ok(Object.keys(methods).every((method) => method.startsWith("/Sangfor_Atrust_OpenAPI_V3.")));
});

test("SDK handlers consume request and bindings from one context", async () => {
  const upstream = await startMockUpstream();
  try {
    const response = await contextHandlers["Sangfor_Atrust_OpenAPI_V3.Sangfor_Atrust_OpenAPI_V3/ListOnlineUsers"]({
      ...baseCtx(upstream),
      req: { page_size: 1 },
    });
    assert.equal(response.code, "0");
  } finally {
    await upstream.close();
  }
});
