import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { grpcStatus } from "@chaitin-ai/octobus-sdk";
import { _test, handlers, METHODS } from "../src/h3c-secpath.js";

const startServer = async (responder) => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, headers: req.headers });
    responder(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((resolve) => server.close(resolve)) };
};
const json = (res, body, status = 200, headers = {}) => {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/yang-data+json", ...headers });
  res.end(text);
};
const context = (baseUrl, request = {}, config = {}) => ({
  config: { host: baseUrl, timeoutMs: 1000, ...config },
  secret: { username: "octobus-user", password: "octobus-password" }, request,
});

test("exports exactly ten current SDK single-context handlers", () => {
  assert.deepEqual(Object.keys(handlers).sort(), Object.values(METHODS).sort());
  for (const value of Object.values(handlers)) assert.equal(typeof value, "function");
});

test("all list methods call their documented RESTCONF paths and map arrays", async () => {
  const upstream = await startServer((req, res) => json(res, { envelope: { entries: [{ name: req.url }] } }));
  try {
    const requests = {
      GetSecurityZones: {}, GetZonePairs: {},
      GetIPv4SecurityPolicies: { pageSize: 25, ruleName: "allow web" },
      GetIPv4ObjectGroups: { groupName: "servers" }, GetServiceGroups: { groupName: "https" },
      GetSessions: { maxCount: 12 }, GetInterfaces: { ifName: "GigabitEthernet1/0/1" },
      GetACLGroups: { groupName: "acl 2000" }, GetNATStaticMappings: { pageSize: 10 },
    };
    for (const [name, request] of Object.entries(requests)) {
      const response = await handlers[METHODS[name]](context(upstream.baseUrl, request));
      assert.equal(response.count, 1);
      assert.ok(response.items[0].structValue);
    }
    assert.equal(upstream.requests.length, 9);
    assert.match(upstream.requests[2].url, /page_size=25/);
    assert.match(upstream.requests[2].url, /rule_name=allow\+web/);
    assert.match(upstream.requests[5].url, /maxCount=12/);
    assert.equal(upstream.requests[0].headers.authorization, `Basic ${Buffer.from("octobus-user:octobus-password").toString("base64")}`);
    assert.match(upstream.requests[0].headers.accept, /yang-data/);
  } finally { await upstream.close(); }
});

test("device base unwraps containers without dropping scalar siblings", async () => {
  const upstream = await startServer((_req, res) => json(res, { "comware-device:Device": { Base: { name: "SecPath", version: 7, active: true, sysInfo: { vendor: "H3C" } } } }));
  try {
    const response = await handlers[METHODS.GetDeviceBase](context(upstream.baseUrl));
    assert.equal(response.info.structValue.fields.name.stringValue, "SecPath");
    assert.equal(response.info.structValue.fields.version.numberValue, 7);
    assert.equal(response.info.structValue.fields.active.boolValue, true);
    assert.equal(response.info.structValue.fields.sysInfo.structValue.fields.vendor.stringValue, "H3C");
  } finally { await upstream.close(); }
});

test("404 is an empty result while other client and server errors are mapped", async () => {
  for (const [status, expected] of [[401, grpcStatus.PERMISSION_DENIED], [403, grpcStatus.PERMISSION_DENIED], [409, grpcStatus.FAILED_PRECONDITION], [500, grpcStatus.UNAVAILABLE]]) {
    const upstream = await startServer((_req, res) => json(res, { password: "must-not-leak" }, status));
    try {
      await assert.rejects(handlers[METHODS.GetSecurityZones](context(upstream.baseUrl)), (error) => {
        assert.equal(error.code, expected);
        assert.doesNotMatch(error.message, /must-not-leak/);
        return true;
      });
    } finally { await upstream.close(); }
  }
  const upstream = await startServer((_req, res) => json(res, {}, 404));
  try { assert.deepEqual(await handlers[METHODS.GetSecurityZones](context(upstream.baseUrl)), { items: [], count: 0 }); }
  finally { await upstream.close(); }
});

test("rejects invalid JSON, empty responses, redirects and network failures", async () => {
  const cases = [
    (req, res) => { res.writeHead(200); res.end("not-json"); },
    (req, res) => { res.writeHead(200); res.end(); },
    (req, res) => { res.writeHead(302, { location: "/login" }); res.end(); },
  ];
  for (const responder of cases) {
    const upstream = await startServer(responder);
    try { await assert.rejects(handlers[METHODS.GetSecurityZones](context(upstream.baseUrl))); }
    finally { await upstream.close(); }
  }
  await assert.rejects(handlers[METHODS.GetSecurityZones](context("http://127.0.0.1:1")), (error) => error.code === grpcStatus.UNAVAILABLE);
});

test("timeout aborts a stalled upstream request", async () => {
  const upstream = await startServer(() => {});
  try {
    await assert.rejects(handlers[METHODS.GetSecurityZones](context(upstream.baseUrl, {}, { timeoutMs: 10 })), (error) => {
      assert.equal(error.code, grpcStatus.UNAVAILABLE); assert.match(error.message, /timeout/); return true;
    });
  } finally { await upstream.close(); }
});

test("bounds responses using content-length and streamed bytes", async () => {
  const declared = await startServer((_req, res) => { res.writeHead(200, { "content-length": _test.MAX_RESPONSE_BYTES + 1 }); res.end(); });
  try { await assert.rejects(handlers[METHODS.GetSecurityZones](context(declared.baseUrl)), /size limit/); }
  finally { await declared.close(); }
  const streamed = await startServer((_req, res) => { res.writeHead(200); res.end("x".repeat(_test.MAX_RESPONSE_BYTES + 1)); });
  try { await assert.rejects(handlers[METHODS.GetSecurityZones](context(streamed.baseUrl)), /size limit/); }
  finally { await streamed.close(); }
});

test("validates URL and credentials without leaking embedded secrets", async () => {
  const invalid = ["", "ftp://example.test", "https://user:secret@example.test", "https://example.test/?token=x", "not-a-url"];
  for (const host of invalid) await assert.rejects(handlers[METHODS.GetSecurityZones](context(host)), (error) => error.code === grpcStatus.INVALID_ARGUMENT);
  await assert.rejects(handlers[METHODS.GetSecurityZones]({ config: { host: "https://example.test" }, secret: { password: "x" } }), /username/);
  await assert.rejects(handlers[METHODS.GetSecurityZones]({ config: { host: "https://example.test" }, secret: { username: "x" } }), /password/);
});

test("normalizers cover wrappers, protobuf values, queries, redaction, and TLS opt-in", () => {
  assert.equal(_test.asBool({ value: true }), true); assert.equal(_test.asBool("off", true), false);
  assert.equal(_test.asBool("unknown", true), true); assert.equal(_test.asInt({ value: "12.8" }, 1), 12);
  assert.equal(_test.asInt("bad", 7), 7); assert.equal(_test.normalizeBaseUrl("https://example.test/"), "https://example.test");
  assert.match(_test.redact("authorization: bearer-secret password=secret"), /\[REDACTED\]/);
  assert.deepEqual(_test.toValue([null, "x", 2, false]).listValue.values[0], { nullValue: "NULL_VALUE" });
  assert.deepEqual(_test.toValue(Symbol.for("x")), { stringValue: "Symbol(x)" });
  assert.deepEqual(_test.extractList({ a: { b: [] } }), []); assert.equal(_test.extractDevice("x"), "x");
  assert.equal(_test.extractDevice(null), null); assert.deepEqual(_test.extractDevice([]), []);
  assert.deepEqual(_test.extractDevice({ wrapper: { value: 1, nested: { kept: true } } }), { value: 1, nested: { kept: true } });
  assert.deepEqual(_test.extractDevice({ wrapper: {} }), {});
  assert.match(_test.queryFor("GetInterfaces", { if_name: { value: "GE1/0/1" } }), /if_name=GE1%2F0%2F1/);
  assert.equal(_test.queryFor("GetDeviceBase", {}), "");
  const first = _test.createContext({ config: { host: "https://example.test", skipTlsVerify: true }, secret: { username: "u", password: "p" } });
  const second = _test.createContext({ config: { host: "https://example.test", skipTlsVerify: true }, secret: { username: "u", password: "p" } });
  assert.ok(first.dispatcher); assert.equal(first.dispatcher, second.dispatcher);
});

test("bounded reader supports response-like test doubles without a stream", async () => {
  assert.equal(await _test.readBoundedText({ headers: { get: () => null }, text: async () => "ok" }), "ok");
  await assert.rejects(
    _test.readBoundedText({ headers: { get: () => null }, text: async () => "x".repeat(_test.MAX_RESPONSE_BYTES + 1) }),
    /size limit/,
  );
});
