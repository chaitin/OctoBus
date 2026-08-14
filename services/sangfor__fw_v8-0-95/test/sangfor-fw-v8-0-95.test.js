import assert from "node:assert/strict";
import test from "node:test";

import { grpcStatus } from "@chaitin-ai/octobus-sdk";

import { _test, handlers } from "../src/sangfor-fw-v8-0-95.js";
import { startMockUpstream } from "./mock_upstream.js";

const baseCtx = (baseUrl) => ({
  config: {
    host: baseUrl,
    namespace: "public",
    timeoutMs: 1000,
  },
  secret: {
    username: "mock-user",
    password: "mock-password",
  },
});

test("login, keepalive, and logout map Sangfor auth endpoints", async () => {
  const upstream = await startMockUpstream();
  try {
    const ctx = baseCtx(upstream.baseUrl);
    const login = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/Login"]({}, ctx);
    assert.equal(login.code, 0);
    assert.equal(login.token, "mock-token");

    const keepAlive = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/KeepAlive"]({ token: login.token }, ctx);
    assert.equal(keepAlive.code, 0);

    const logout = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/Logout"]({ token: login.token }, ctx);
    assert.equal(logout.code, 0);
    assert.equal(upstream.state.keepAlives, 1);
    assert.equal(upstream.state.logouts, 1);
  } finally {
    await upstream.close();
  }
});

test("blacklist add, list, and remove use documented batch endpoints", async () => {
  const upstream = await startMockUpstream();
  try {
    const ctx = baseCtx(upstream.baseUrl);
    const add = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/AddBlacklist"]({
      targets: ["192.0.2.10", "example.test"],
      description: "test",
    }, ctx);
    assert.equal(add.code, 0);
    assert.equal(upstream.state.blacklist.length, 2);

    const list = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/ListBlackWhiteList"]({ type: "BLACK" }, ctx);
    assert.equal(list.data.itemLength, 2);

    const remove = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/RemoveBlacklist"]({
      targets: ["192.0.2.10"],
    }, ctx);
    assert.equal(remove.code, 0);
    assert.equal(upstream.state.blacklist.length, 1);
  } finally {
    await upstream.close();
  }
});

test("block IP, unblock IP, and block time map documented operation center APIs", async () => {
  const upstream = await startMockUpstream();
  try {
    const ctx = baseCtx(upstream.baseUrl);
    const block = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/BlockIP"]({
      src_ips: ["198.51.100.10"],
      block_time: "3d",
    }, ctx);
    assert.equal(block.code, 0);
    assert.equal(upstream.state.blockIp[0].ipType, "SRC");
    assert.deepEqual(upstream.state.blockIp[0].srcIP, ["198.51.100.10"]);

    const list = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/ListBlockedIP"]({}, ctx);
    assert.equal(list.data.itemLength, 1);

    const setTime = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/SetBlockTime"]({
      block_time: "2h",
    }, ctx);
    assert.equal(setTime.data.blockTime, "2h");

    const getTime = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/GetBlockTime"]({}, ctx);
    assert.equal(getTime.data.blockTime, "2h");

    const unblock = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/UnblockIP"]({
      items: [{ src_ip: "198.51.100.10" }],
    }, ctx);
    assert.equal(unblock.code, 0);
    assert.equal(upstream.state.blockIp.length, 0);
  } finally {
    await upstream.close();
  }
});

test("skipTlsVerify reuses one dispatcher", () => {
  const ctx = {
    config: {
      host: "https://example.test",
      skipTlsVerify: true,
    },
  };

  const first = _test.createContext(ctx).dispatcher;
  const second = _test.createContext(ctx).dispatcher;

  assert.ok(first);
  assert.equal(first, second);
});

test("block IP rejects mixed target types", async () => {
  const upstream = await startMockUpstream();
  try {
    const ctx = baseCtx(upstream.baseUrl);

    await assert.rejects(
      handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/BlockIP"]({
        src_ips: ["198.51.100.10"],
        dst_ips: ["198.51.100.20"],
      }, ctx),
      (err) => {
        assert.equal(err.code, grpcStatus.INVALID_ARGUMENT);
        assert.match(err.message, /only one target type/);
        return true;
      },
    );
    assert.equal(upstream.state.requests.length, 0);
  } finally {
    await upstream.close();
  }
});

test("network object methods map /ipgroups endpoints", async () => {
  const upstream = await startMockUpstream();
  try {
    const ctx = baseCtx(upstream.baseUrl);

    const add = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/AddIPGroup"]({
      name: "octobus-test",
      ip_ranges: [{ start: "192.0.2.1", end: "192.0.2.2" }],
    }, ctx);
    assert.equal(add.code, 0);
    assert.equal(add.data.name, "octobus-test");

    const list = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/ListIPGroups"]({ search: "octobus" }, ctx);
    assert.equal(list.code, 0);
    assert.ok(list.data.itemLength >= 1);

    const get = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/GetIPGroup"]({ name: "octobus-test" }, ctx);
    assert.equal(get.data.name, "octobus-test");

    const del = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/DeleteIPGroup"]({ name: "octobus-test" }, ctx);
    assert.equal(del.data.name, "octobus-test");
  } finally {
    await upstream.close();
  }
});

test("business block methods use BUSINESS scope", async () => {
  const upstream = await startMockUpstream();
  try {
    const ctx = baseCtx(upstream.baseUrl);

    const block = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/BusinessBlockIP"]({
      src_ips: ["198.51.100.30"],
      block_time: "30m",
    }, ctx);
    assert.equal(block.code, 0);
    assert.equal(upstream.state.blockIp[0].scope, "BUSINESS");

    const unblock = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/BusinessUnblockIP"]({
      items: [{ src_ip: "198.51.100.30" }],
    }, ctx);
    assert.equal(unblock.code, 0);
    assert.equal(unblock.data[0].scope, "BUSINESS");
  } finally {
    await upstream.close();
  }
});

test("session query and block map sessions endpoints", async () => {
  const upstream = await startMockUpstream();
  try {
    const ctx = baseCtx(upstream.baseUrl);

    const query = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/QuerySessions"]({
      length: 10,
      filter: { srcIp: { start: "198.51.100.10" }, displayMode: 1 },
    }, ctx);
    assert.equal(query.code, 0);
    assert.equal(query.data.itemLength, 1);
    assert.equal(query.data.filter.srcIp.start, "198.51.100.10");

    const block = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/BlockSession"]({
      src_ip: "198.51.100.10",
      dst_ip: "203.0.113.10",
      proto: 6,
      src_port: 12345,
      dst_port: 443,
    }, ctx);
    assert.equal(block.code, 0);
    assert.equal(upstream.state.blockedSessions[0].dstPort, 443);
  } finally {
    await upstream.close();
  }
});

test("security policy methods are read only", async () => {
  const upstream = await startMockUpstream();
  try {
    const ctx = baseCtx(upstream.baseUrl);

    const list = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/ListSecurityPolicies"]({
      policy_type: "INTERNET_ACCESS",
    }, ctx);
    assert.equal(list.code, 0);
    assert.equal(list.data.itemLength, 1);

    const get = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/GetSecurityPolicy"]({ name: "allow-web" }, ctx);
    assert.equal(get.data.name, "allow-web");

    const securityRequests = upstream.state.requests.filter((request) => request.pathname.includes("/securitys"));
    assert.deepEqual(securityRequests.map((request) => request.method), ["GET", "GET"]);
  } finally {
    await upstream.close();
  }
});

test("normalizers handle protobuf wrappers and reject unsafe configuration", () => {
  assert.equal(_test.toBool({ value: true }), true);
  assert.equal(_test.toBool(0), false);
  assert.equal(_test.toBool("yes"), true);
  assert.equal(_test.toBool("off"), false);
  assert.equal(_test.toBool("unknown", true), true);
  assert.equal(_test.toInt({ value: "12.8" }, 1), 12);
  assert.equal(_test.toInt("bad", 7), 7);
  assert.deepEqual(_test.asArray({ values: ["a", "b"] }), ["a", "b"]);
  assert.deepEqual(_test.asArray("a"), ["a"]);
  assert.deepEqual(_test.stringList([" a ", "", { value: "b" }]), ["a", "b"]);
  assert.deepEqual(_test.fromProtoValue({ listValue: { values: [{ stringValue: "a" }, { numberValue: 2 }, { boolValue: true }, { nullValue: 0 }] } }), ["a", 2, true, null]);
  assert.deepEqual(_test.fromProtoValue({ unknown: "preserved" }), { unknown: "preserved" });
  assert.deepEqual(_test.plainObject({ fields: { a: { stringValue: "x" }, nested: { structValue: { fields: { ok: { boolValue: true } } } } } }), { a: "x", nested: { ok: true } });
  assert.deepEqual(_test.plainObject([]), {});
  assert.equal(_test.normalizeBaseUrl("https://example.test/"), "https://example.test");
  assert.equal(_test.normalizeBaseUrl("ftp://example.test"), "");
  assert.equal(_test.normalizeBaseUrl("https://user:secret@example.test"), "");
  assert.equal(_test.normalizeBaseUrl("not a url"), "");
  assert.throws(() => _test.normalizeNamespace("bad/path"), /unsupported/);
  assert.throws(() => _test.buildIPGroupBody({ name: "empty" }), /one of ip_ranges/);
  assert.match(_test.redact("password=secret token: abc"), /\[REDACTED\]/);
});

test("current SDK single-context handler ABI reads request", async () => {
  const upstream = await startMockUpstream();
  try {
    const ctx = { ...baseCtx(upstream.baseUrl), request: { username: "mock-user", password: "mock-password" } };
    const response = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/Login"](ctx);
    assert.equal(response.token, "mock-token");
  } finally {
    await upstream.close();
  }
});

test("input validation fails before upstream calls", async () => {
  const upstream = await startMockUpstream();
  try {
    const ctx = baseCtx(upstream.baseUrl);
    await assert.rejects(handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/BlockIP"]({}, ctx), /one of src_ips/);
    await assert.rejects(handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/AddIPGroup"]({}, ctx), /name is required/);
    await assert.rejects(handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/BlockSession"]({}, ctx), /srcIp is required/);
    await assert.rejects(handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/Login"]({}, { config: { host: upstream.baseUrl }, secret: {} }), /username is required/);
    await assert.rejects(handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/Logout"]({}, { config: { host: upstream.baseUrl } }), /token is required/);
  } finally {
    await upstream.close();
  }
});

test("upstream HTTP, API, parse, and response-bound failures are mapped safely", async () => {
  const upstream = await startMockUpstream();
  try {
    const ctx = baseCtx(upstream.baseUrl);
    const keepAlive = () => handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/KeepAlive"]({ token: "mock-token" }, ctx);
    for (const [status, expected] of [[401, grpcStatus.PERMISSION_DENIED], [400, grpcStatus.FAILED_PRECONDITION], [500, grpcStatus.UNAVAILABLE]]) {
      upstream.state.forced = { status, body: { password: "must-not-leak" } };
      await assert.rejects(keepAlive(), (error) => error.code === expected && !error.message.includes("must-not-leak"));
    }
    upstream.state.forced = { status: 200, body: "not-json" };
    await assert.rejects(keepAlive(), (error) => error.code === grpcStatus.UNKNOWN);
    for (const [code, expected] of [[1, grpcStatus.PERMISSION_DENIED], [1003, grpcStatus.UNAUTHENTICATED], [22, grpcStatus.INVALID_ARGUMENT], [999, grpcStatus.FAILED_PRECONDITION]]) {
      upstream.state.forced = { status: 200, body: { code, message: "failure", data: "" } };
      await assert.rejects(keepAlive(), (error) => error.code === expected);
    }
    upstream.state.forced = { status: 200, body: "x".repeat(1024 * 1024 + 1) };
    await assert.rejects(keepAlive(), /size limit/);
  } finally {
    await upstream.close();
  }
});
