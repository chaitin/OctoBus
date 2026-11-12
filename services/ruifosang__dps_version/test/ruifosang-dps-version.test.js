import assert from "node:assert/strict";
import test from "node:test";

import { GrpcError, grpcStatus, loadServicePackage } from "@chaitin-ai/octobus-sdk";

import { ENDPOINTS } from "../src/endpoints.js";
import { _test, handlers } from "../src/ruifosang-dps-version.js";
import { service } from "../src/service.js";

const SERVICE = "Ruifosang_DPS_Version.Ruifosang_DPS_Version";
const originalFetch = globalThis.fetch;

const byRpc = (rpc) => {
  const entry = ENDPOINTS.find((item) => item.rpc === rpc);
  assert.ok(entry, "missing endpoint " + rpc);
  return entry;
};

const responseHeaders = (init = {}) => {
  const lower = new Map();
  for (const [name, value] of Object.entries(init)) {
    lower.set(name.toLowerCase(), Array.isArray(value) ? value : [String(value)]);
  }
  return {
    get(name) {
      const values = lower.get(String(name).toLowerCase());
      return values ? values[0] : null;
    },
    getSetCookie() {
      return lower.get("set-cookie") ?? [];
    },
  };
};

const makeResponse = (status, options = {}) => {
  const body = options.body === undefined ? "" : options.body;
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: responseHeaders(options.headers ?? {}),
    text: async () => bytes.toString("utf8"),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
};

const buildCtx = (request, overrides = {}) => ({
  request,
  config: { baseUrl: "https://dps.example.com", ...(overrides.config ?? {}) },
  secret: { ...(overrides.secret ?? {}) },
});

const call = async (rpc, request, overrides = {}) => {
  return handlers[SERVICE + "/" + rpc](buildCtx(request, overrides));
};

const captureFetch = (impl) => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return impl(String(url), init ?? {});
  };
  return calls;
};

const expectGrpc = async (fn, code) => {
  let caught;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, "expected handler to reject");
  assert.ok(caught instanceof GrpcError, "expected GrpcError, got " + caught);
  assert.equal(caught.code, code);
  return caught;
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("service definition exposes a handler for every endpoint", () => {
  assert.equal(typeof service, "object");
  assert.equal(ENDPOINTS.length, 152);
  assert.equal(Object.keys(service.handlers).length, 152);
  assert.equal(Object.keys(handlers).length, 152);
  const rpcs = new Set();
  for (const entry of ENDPOINTS) {
    assert.equal(rpcs.has(entry.rpc), false, "duplicate rpc " + entry.rpc);
    rpcs.add(entry.rpc);
    assert.equal(typeof handlers[SERVICE + "/" + entry.rpc], "function");
    assert.match(entry.path, /^\//);
    assert.ok(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(entry.http));
  }
});

test("endpoint metadata matches the vendor document for representative operations", () => {
  assert.deepEqual(
    { http: byRpc("GetLiveness").http, path: byRpc("GetLiveness").path },
    { http: "GET", path: "/livez" },
  );
  assert.deepEqual(
    { http: byRpc("PatchAsset").http, path: byRpc("PatchAsset").path, body: byRpc("PatchAsset").hasBody },
    { http: "PATCH", path: "/v1/assets/{id}", body: true },
  );
  const archive = byRpc("GetArchiveEntryBytes");
  assert.equal(archive.binary, true);
  assert.deepEqual(archive.params, [
    { name: "sha256", field: "sha256" },
    { name: "index", field: "index" },
  ]);
  assert.deepEqual(archive.headers, [{ name: "range", field: "range" }]);
  assert.equal(byRpc("HeadArchiveEntryBytes").head, true);
  const ifMatch = byRpc("PutSensorProtocolAnalysis").headers;
  assert.deepEqual(ifMatch, [{ name: "if-match", field: "ifMatch", required: true }]);
});

test("GET forwards query parameters, arrays and booleans", async () => {
  const calls = captureFetch(() => makeResponse(200, {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items: [], total: 0 }),
  }));

  const result = await call("ListAssets", {
    fromSec: 1700000000n,
    untilSec: "1700003600",
    q: "http",
    role: ["server", "client"],
    isLocal: true,
    page: 2,
    pageSize: 50,
  });

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(url.origin + url.pathname, "https://dps.example.com/v1/assets");
  assert.equal(url.searchParams.get("from_sec"), "1700000000");
  assert.equal(url.searchParams.get("until_sec"), "1700003600");
  assert.equal(url.searchParams.get("q"), "http");
  assert.deepEqual(url.searchParams.getAll("role"), ["server", "client"]);
  assert.equal(url.searchParams.get("is_local"), "true");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("page_size"), "50");
  assert.equal(url.searchParams.has("band"), false);
  assert.equal(calls[0].init.headers.accept, "application/json");
  assert.equal(calls[0].init.body, undefined);
  assert.deepEqual(result, {
    httpStatus: 200,
    contentType: "application/json",
    data: { items: [], total: 0 },
  });
});

test("path parameters are substituted and encoded", async () => {
  const calls = captureFetch(() => makeResponse(204));

  const result = await call("GetAsset", { id: "asset/a b", fromSec: 1, untilSec: 2 });

  assert.equal(calls[0].url, "https://dps.example.com/v1/assets/asset%2Fa%20b?from_sec=1&until_sec=2");
  assert.deepEqual(result, { httpStatus: 204 });
});

test("integer path parameters accept numeric zero", async () => {
  const calls = captureFetch(() => makeResponse(200, { body: Buffer.from([1, 2, 3]) }));

  const result = await call("GetArchiveEntryBytes", { sha256: "ab".repeat(32), index: 0, range: "bytes=0-1" });

  assert.equal(calls[0].url, "https://dps.example.com/v1/files/" + "ab".repeat(32) + "/archive/entries/0/bytes");
  assert.equal(calls[0].init.headers.range, "bytes=0-1");
  assert.equal(calls[0].init.headers.accept, "*/*");
  assert.equal(result.httpStatus, 200);
  assert.deepEqual(Buffer.from(result.binaryBody), Buffer.from([1, 2, 3]));
  assert.equal(result.data, undefined);
});

test("missing required path and query parameters are rejected locally", async () => {
  const calls = captureFetch(() => makeResponse(200));

  await expectGrpc(() => call("GetAsset", { fromSec: 1, untilSec: 2 }), grpcStatus.INVALID_ARGUMENT);
  await expectGrpc(() => call("GetAsset", { id: "   ", fromSec: 1, untilSec: 2 }), grpcStatus.INVALID_ARGUMENT);
  await expectGrpc(() => call("ListAssets", { untilSec: 2 }), grpcStatus.INVALID_ARGUMENT);
  await expectGrpc(() => call("ListAssets", { fromSec: 1 }), grpcStatus.INVALID_ARGUMENT);

  assert.equal(calls.length, 0);
});

test("required header parameters are enforced", async () => {
  const calls = captureFetch(() => makeResponse(200));

  await expectGrpc(
    () => call("PutSensorProtocolAnalysis", { id: "sensor-1", body: { desired: true } }),
    grpcStatus.INVALID_ARGUMENT,
  );
  assert.equal(calls.length, 0);

  await call("PutSensorProtocolAnalysis", { id: "sensor-1", ifMatch: 'W/"7"', body: { desired: true } });
  assert.equal(calls[0].init.headers["if-match"], 'W/"7"');
  assert.equal(calls[0].init.method, "PUT");
  assert.equal(calls[0].init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), { desired: true });
});

test("request bodies are sent as JSON and validated", async () => {
  const calls = captureFetch(() => makeResponse(200, {
    headers: { "content-type": "application/json" },
    body: "{}",
  }));

  await expectGrpc(() => call("ConfirmDeviceCandidates", {}), grpcStatus.INVALID_ARGUMENT);
  await expectGrpc(() => call("ConfirmDeviceCandidates", { body: [] }), grpcStatus.INVALID_ARGUMENT);
  await expectGrpc(() => call("ConfirmDeviceCandidates", { body: "x" }), grpcStatus.INVALID_ARGUMENT);
  assert.equal(calls.length, 0);

  await call("ConfirmDeviceCandidates", { body: { confirmations: [{ id: "d-1" }] } });
  assert.equal(calls[0].init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), { confirmations: [{ id: "d-1" }] });
});

test("HEAD endpoints return headers without a payload", async () => {
  captureFetch(() => makeResponse(206, {
    headers: { "content-range": "bytes 0-9/100", "accept-ranges": "bytes" },
  }));

  const result = await call("HeadArchiveEntryBytes", { sha256: "aa".repeat(32), index: 4 });

  assert.equal(result.httpStatus, 206);
  assert.equal(result.data, undefined);
  assert.equal(result.binaryBody, undefined);
  assert.deepEqual(result.headers, [
    { name: "content-range", value: "bytes 0-9/100" },
    { name: "accept-ranges", value: "bytes" },
  ]);
});

test("redirects are not followed, so a login page is never mistaken for data", async () => {
  const calls = captureFetch(() => makeResponse(302, { headers: { location: "/login" } }));

  const error = await expectGrpc(() => call("GetLiveness", {}), grpcStatus.UNKNOWN);
  assert.equal(error.httpStatus, 302);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.redirect, "manual");

  await expectGrpc(() => call("GetLiveness", {}, { config: { followRedirects: true } }), grpcStatus.UNKNOWN);
  assert.equal(calls[1].init.redirect, "follow");
});

test("the timeout also covers reading the response body", async () => {
  globalThis.fetch = (url, init) => Promise.resolve({
    status: 200,
    ok: true,
    headers: responseHeaders({ "content-type": "application/json" }),
    text: async () => "",
    // Mimic a body that never finishes arriving.
    arrayBuffer: () => new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    }),
  });

  await expectGrpc(() => call("GetLiveness", {}, { config: { timeoutMs: 5 } }), grpcStatus.DEADLINE_EXCEEDED);
});

test("compressed responses drop a content-length that no longer matches the payload", async () => {
  captureFetch(() => makeResponse(200, {
    headers: { "content-type": "application/json", "content-encoding": "gzip", "content-length": "45" },
    body: '{"ok":true,"padding":"' + "x".repeat(200) + '"}',
  }));

  const result = await call("GetLiveness", {});

  assert.equal(result.data.ok, true);
  assert.equal(result.headers, undefined);
});

test("blank secret values fall back to the configured ones", async () => {
  const calls = captureFetch(() => makeResponse(200));

  await call("GetMe", {}, { config: { cookie: "config-cookie=1" }, secret: { cookie: "", token: "  " } });

  assert.equal(calls[0].init.headers.cookie, "config-cookie=1");
  assert.equal(calls[0].init.headers.authorization, undefined);
});

test("byte requests ask for identity encoding", async () => {
  const calls = captureFetch(() => makeResponse(200, { body: Buffer.from([7]) }));

  await call("GetFileBytes", { sha256: "ef".repeat(32) });

  assert.equal(calls[0].init.headers["accept-encoding"], "identity");
});

test("304 Not Modified is returned with its validators instead of raised", async () => {
  captureFetch(() => makeResponse(304, { headers: { etag: 'W/"v3"' } }));

  const result = await call("ListArchiveEntries", { sha256: "ee".repeat(32) });

  assert.deepEqual(result, {
    httpStatus: 304,
    headers: [{ name: "etag", value: 'W/"v3"' }],
  });
});

test("non-JSON payloads are returned as text", async () => {
  captureFetch(() => makeResponse(200, {
    headers: { "content-type": "text/csv; charset=utf-8" },
    body: "a,b\n1,2\n",
  }));

  const result = await call("GetLiveness", {});

  assert.equal(result.data, "a,b\n1,2\n");
  assert.equal(result.binaryBody, undefined);
});

test("JSON responses without a content type are still parsed", async () => {
  captureFetch(() => makeResponse(200, { body: '{"ok":true}' }));

  const result = await call("GetReadiness", {});

  assert.deepEqual(result.data, { ok: true });
});

test("malformed JSON bodies fall back to text", async () => {
  captureFetch(() => makeResponse(200, {
    headers: { "content-type": "application/json" },
    body: "{not-json",
  }));

  const result = await call("GetHealth", {});

  assert.equal(result.data, "{not-json");
});

test("byte endpoints return binary bodies and forwarded headers", async () => {
  captureFetch(() => makeResponse(200, {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": "4",
      "set-cookie": ["a=1; Path=/", "b=2; Path=/"],
    },
    body: Buffer.from([0, 1, 2, 3]),
  }));

  const result = await call("GetFileBytes", { sha256: "cd".repeat(32) });

  assert.deepEqual(Buffer.from(result.binaryBody), Buffer.from([0, 1, 2, 3]));
  assert.equal(result.contentType, "application/octet-stream");
  assert.deepEqual(result.headers, [
    { name: "content-length", value: "4" },
    { name: "set-cookie", value: "a=1; Path=/" },
    { name: "set-cookie", value: "b=2; Path=/" },
  ]);
});

test("upstream problem responses map to gRPC errors with diagnostics", async () => {
  captureFetch(() => makeResponse(401, {
    headers: { "content-type": "application/problem+json" },
    body: JSON.stringify({
      type: "about:blank",
      title: "unauthorized",
      status: 401,
      code: "UNAUTHENTICATED",
      detail: "session expired",
      trace_id: "trace-9",
    }),
  }));

  const error = await expectGrpc(() => call("GetMe", {}), grpcStatus.UNAUTHENTICATED);
  assert.equal(error.httpStatus, 401);
  assert.equal(error.problemCode, "UNAUTHENTICATED");
  assert.equal(error.traceId, "trace-9");
  assert.match(error.message, /DPS GetMe failed: HTTP 401/);
  assert.match(error.message, /code=UNAUTHENTICATED/);
  assert.match(error.message, /trace_id=trace-9/);
});

test("plain-text failures keep the upstream status and body excerpt", async () => {
  captureFetch(() => makeResponse(503, {
    headers: { "content-type": "text/plain" },
    body: "packet exec unavailable\n",
  }));

  const error = await expectGrpc(() => call("StreamPackets", { body: { packet_id: "p-1" } }), grpcStatus.UNAVAILABLE);
  assert.equal(error.httpStatus, 503);
  assert.match(error.message, /packet exec unavailable/);
});

test("failures without a body and with a location header remain diagnosable", async () => {
  captureFetch(() => makeResponse(302, { headers: { location: "/login" } }));

  const error = await expectGrpc(() => call("ListAssets", { fromSec: 1, untilSec: 2 }), grpcStatus.UNKNOWN);
  assert.equal(error.httpStatus, 302);
  assert.match(error.message, /location=\/login/);
});

test("documented status codes map onto gRPC codes", () => {
  const map = _test.grpcCodeForHttpStatus;
  assert.equal(map(400), grpcStatus.INVALID_ARGUMENT);
  assert.equal(map(401), grpcStatus.UNAUTHENTICATED);
  assert.equal(map(403), grpcStatus.PERMISSION_DENIED);
  assert.equal(map(404), grpcStatus.NOT_FOUND);
  assert.equal(map(409), grpcStatus.ABORTED);
  assert.equal(map(410), grpcStatus.NOT_FOUND);
  assert.equal(map(413), grpcStatus.RESOURCE_EXHAUSTED);
  assert.equal(map(415), grpcStatus.INVALID_ARGUMENT);
  assert.equal(map(416), grpcStatus.OUT_OF_RANGE);
  assert.equal(map(422), grpcStatus.INVALID_ARGUMENT);
  assert.equal(map(428), grpcStatus.FAILED_PRECONDITION);
  assert.equal(map(429), grpcStatus.RESOURCE_EXHAUSTED);
  assert.equal(map(500), grpcStatus.UNAVAILABLE);
  assert.equal(map(503), grpcStatus.UNAVAILABLE);
  assert.equal(map(418), grpcStatus.UNKNOWN);
});

test("a missing or malformed baseUrl is rejected before any request", async () => {
  const calls = captureFetch(() => makeResponse(200));

  await expectGrpc(() => call("GetLiveness", {}, { config: { baseUrl: "" } }), grpcStatus.INVALID_ARGUMENT);
  await expectGrpc(() => call("GetLiveness", {}, { config: { baseUrl: "dps.example.com" } }), grpcStatus.INVALID_ARGUMENT);
  assert.equal(calls.length, 0);
});

test("baseUrl variants and trailing slashes are normalized", async () => {
  assert.equal(_test.normalizeBaseUrl("https://dps.example.com/"), "https://dps.example.com");
  assert.equal(_test.normalizeBaseUrl("http://dps:8080///"), "http://dps:8080");
  assert.equal(_test.normalizeBaseUrl("ftp://dps"), "");
  assert.equal(_test.normalizeBaseUrl(undefined), "");

  const calls = captureFetch(() => makeResponse(200));
  await call("GetLiveness", {}, { config: { baseUrl: undefined, base_url: "https://alt.example.com/" } });
  assert.equal(calls[0].url, "https://alt.example.com/livez");
  await call("GetLiveness", {}, { config: { baseUrl: null, endpoint: "https://third.example.com" } });
  assert.equal(calls[1].url, "https://third.example.com/livez");
});

test("credentials and extra headers are sent", async () => {
  const calls = captureFetch(() => makeResponse(200));

  await call("GetMe", {}, {
    config: { headers: { "x-tenant": "acme" }, cookie: "config=1" },
    secret: { token: "secret-token", cookie: "secret=2" },
  });

  assert.equal(calls[0].init.headers.authorization, "Bearer secret-token");
  assert.equal(calls[0].init.headers.cookie, "secret=2");
  assert.equal(calls[0].init.headers["x-tenant"], "acme");

  await call("GetMe", {}, { config: { headers: '{"x-team":"blue"}', cookie: "only-config=1" } });
  assert.equal(calls[1].init.headers["x-team"], "blue");
  assert.equal(calls[1].init.headers.cookie, "only-config=1");
  assert.equal(calls[1].init.headers.authorization, undefined);
});

test("timeouts surface as DEADLINE_EXCEEDED", async () => {
  globalThis.fetch = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error("aborted")));
  });

  await expectGrpc(
    () => call("GetLiveness", {}, { config: { timeoutMs: 5 } }),
    grpcStatus.DEADLINE_EXCEEDED,
  );
});

test("transport failures surface as UNAVAILABLE", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };

  const error = await expectGrpc(() => call("GetLiveness", {}), grpcStatus.UNAVAILABLE);
  assert.match(error.message, /fetch failed/);
});

test("TLS skipping installs an undici dispatcher", async () => {
  const calls = captureFetch(() => makeResponse(200));

  await call("GetLiveness", {}, { config: { skipTlsVerify: true } });

  assert.equal(calls.length, 1);
  assert.ok(calls[0].init.dispatcher, "expected an undici dispatcher");
});

test("helper coverage: field lookup, scalar formatting and header parsing", () => {
  assert.equal(_test.snakeCase("pageSize"), "page_size");
  assert.equal(_test.snakeCase("ifMatch"), "if_match");
  assert.equal(_test.fieldValue({ pageSize: 1 }, "pageSize"), 1);
  assert.equal(_test.fieldValue({ page_size: 2 }, "pageSize"), 2);
  assert.equal(_test.fieldValue({}, "pageSize"), undefined);
  assert.equal(_test.fieldValue(undefined, "pageSize"), undefined);
  assert.equal(_test.scalarText(7n), "7");
  assert.equal(_test.scalarText(true), "true");
  assert.equal(_test.scalarText(1.5), "1.5");
  assert.equal(_test.scalarText(" padded "), "padded");
  assert.throws(() => _test.scalarText(Number.NaN), /number is not finite/);

  assert.deepEqual(_test.resolveHeaders(undefined), {});
  assert.deepEqual(_test.resolveHeaders(""), {});
  assert.deepEqual(_test.resolveHeaders("not json"), {});
  assert.deepEqual(_test.resolveHeaders([1]), {});
  assert.deepEqual(_test.resolveHeaders({ a: " 1 ", b: "", c: 2 }), { a: "1", c: "2" });

  assert.equal(_test.resolveTimeoutMs({}), 15000);
  assert.equal(_test.resolveTimeoutMs({ timeoutMs: 250 }), 250);
  assert.equal(_test.resolveTimeoutMs({ timeout_ms: "250" }), 250);
  assert.equal(_test.resolveTimeoutMs({ timeoutMs: 0 }), 15000);
  assert.equal(_test.resolveTimeoutMs({ timeoutMs: "abc" }), 15000);

  assert.equal(_test.methodFullName("GetMe"), SERVICE + "/GetMe");
  assert.equal(_test.resolveBody(byRpc("GetLiveness"), {}), undefined);
});

test("query and header builders reuse wire names from the document", () => {
  const entry = byRpc("ListAssets");
  const params = _test.buildQuery(entry, { fromSec: 1, untilSec: 2, role: ["a", "b"], sensorId: ["s1"] });
  assert.equal(params.get("from_sec"), "1");
  assert.equal(params.get("until_sec"), "2");
  assert.deepEqual(params.getAll("role"), ["a", "b"]);
  assert.deepEqual(params.getAll("sensor_id"), ["s1"]);

  const headers = _test.buildHeaders(byRpc("GetArchiveEntryBytes"), { range: "bytes=0-1" }, {}, false);
  assert.equal(headers.range, "bytes=0-1");
  assert.equal(headers["content-type"], undefined);

  assert.throws(
    () => _test.buildPath(byRpc("GetAsset"), {}),
    /missing required path parameter "id"/,
  );
});

test("describeFailure handles empty and malformed problem payloads", () => {
  assert.deepEqual(_test.describeFailure(500, "", []), { message: "HTTP 500", problem: undefined });
  assert.deepEqual(_test.describeFailure(400, "<html>", []), { message: "HTTP 400 | <html>", problem: undefined });
  const parsed = _test.describeFailure(409, '{"title":"conflict","status":409}', []);
  assert.equal(parsed.message, "HTTP 409 | conflict");
  assert.deepEqual(parsed.problem, { title: "conflict", status: 409 });
});

test("a path parameter omitted by the caller never decodes to zero", async () => {
  // Regression: proto3 implicit presence turned an absent numeric path parameter into 0,
  // so DeleteSite with no id issued DELETE /v1/sites/0. The request must travel through the
  // real protobuf codec, because only the wire round-trip loses presence.
  const runtime = loadServicePackage(new URL("..", import.meta.url).pathname);
  const definition = runtime.grpcServices[0].definition;
  const calls = captureFetch(() => makeResponse(204));

  for (const [rpc, request] of [
    ["DeleteSite", {}],
    ["DeleteAppRule", {}],
    ["HeadArchiveEntryBytes", { sha256: "aa".repeat(32) }],
    ["PutAppEntry", { body: { x: 1 } }],
  ]) {
    const decoded = definition[rpc].requestDeserialize(definition[rpc].requestSerialize(request));
    await expectGrpc(
      () => handlers[SERVICE + "/" + rpc](buildCtx(decoded)),
      grpcStatus.INVALID_ARGUMENT,
    );
  }
  assert.equal(calls.length, 0, "no request may be sent for a missing path parameter");

  // An explicit zero is a real value and must still be sent.
  const zero = definition.HeadArchiveEntryBytes.requestDeserialize(
    definition.HeadArchiveEntryBytes.requestSerialize({ sha256: "aa".repeat(32), index: 0 }),
  );
  await handlers[SERVICE + "/HeadArchiveEntryBytes"](buildCtx(zero));
  assert.match(calls[0].url, /\/archive\/entries\/0\/bytes$/);
});

test("collectHeaders tolerates responses without getSetCookie", () => {
  const plain = {
    headers: {
      get: (name) => (name === "etag" ? 'W/"1"' : null),
    },
  };
  assert.deepEqual(_test.collectHeaders(plain), [{ name: "etag", value: 'W/"1"' }]);
});
