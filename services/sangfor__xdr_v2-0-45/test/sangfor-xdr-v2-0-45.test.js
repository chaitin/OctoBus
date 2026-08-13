import assert from "node:assert/strict";
import { createCipheriv, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

import { _test as clientInternals, createXdrClient } from "../src/client.js";
import {
  METHOD_GET_ALERT_CONTEXT,
  METHOD_GET_INCIDENT_CONTEXT,
  METHOD_SEARCH_ALERTS,
  METHOD_SEARCH_ASSETS,
  METHOD_SEARCH_INCIDENTS,
  METHOD_SEARCH_RISK_HOSTS,
  METHOD_SEARCH_VULNERABILITIES,
  _test as handlerInternals,
  createHandlers,
} from "../src/sangfor-xdr-v2-0-45.js";
import { service } from "../src/service.js";
import { _test as signerInternals, decodeAuthCode, signRequest } from "../src/signer.js";
import { createXdrMockServer, mockResponse } from "./mock_upstream.js";

const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const encryptNoPadding = (plaintext, key) => {
  const input = Buffer.from(plaintext.padEnd(Math.ceil(plaintext.length / 16) * 16, " "), "utf8");
  const cipher = createCipheriv("aes-256-cbc", key, Buffer.alloc(16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(input), cipher.final()]).toString("hex");
};

const buildAuthCode = (accessKey, secretKey) => {
  const parts = [
    "client-id",
    "domain",
    "client-name",
    "XDR",
    "2.0.45",
    "10.0.0.1",
    "openapi",
    "extended",
    "description",
    "",
    "",
    "v4",
    "",
    "",
  ];
  const key = createHash("sha256")
    .update([parts[0], parts[1], parts[2], parts[3], parts[4], parts[5], parts[6], parts[11]].join("+"))
    .digest();
  parts[9] = encryptNoPadding(accessKey, key);
  parts[10] = encryptNoPadding(secretKey, key);
  return Buffer.from(parts.join("|"), "utf8").toString("hex");
};

test("proto exposes exactly the seven Issue #140 RPC methods", () => {
  const proto = fs.readFileSync(path.join(serviceRoot, "proto", "sangfor_xdr_v2_0_45.proto"), "utf8");
  const methods = [...proto.matchAll(/\brpc\s+([A-Za-z0-9_]+)\s*\(/g)].map((match) => match[1]);
  assert.deepEqual(methods, [
    "SearchIncidents",
    "GetIncidentContext",
    "SearchAlerts",
    "GetAlertContext",
    "SearchAssets",
    "SearchRiskHosts",
    "SearchVulnerabilities",
  ]);
});

test("proto models XDR numeric asset and branch identifiers as int64", () => {
  const proto = fs.readFileSync(path.join(serviceRoot, "proto", "sangfor_xdr_v2_0_45.proto"), "utf8");
  for (const field of ["asset_ids", "branch_ids", "business_ids", "host_asset_ids", "host_branch_ids", "asset_branch_ids"]) {
    assert.match(proto, new RegExp(`repeated int64 ${field}\\s*=`));
  }
});

test("decodeAuthCode extracts the same AK/SK represented by Sangfor linkage code", () => {
  const authCode = buildAuthCode("ACCESSKEY", "SECRETKEY");
  assert.deepEqual(decodeAuthCode(authCode), {
    accessKey: "ACCESSKEY",
    secretKey: "SECRETKEY",
  });
});

test("signRequest matches a fixed Sangfor HMAC-SHA256 vector", () => {
  const result = signRequest({
    method: "POST",
    url: "https://xdr.example.com/api/xdr/v1/assets/list",
    headers: {
      "content-type": "application/json",
      "sign-date": "20260102T030405Z",
    },
    body: "{\"page\":1,\"pageSize\":10}",
    accessKey: "ACCESSKEY",
    secretKey: "SECRETKEY",
  });

  assert.equal(result.headers["sdk-host"], "xdr.example.com");
  assert.equal(result.headers["sdk-content-type"], "application/json");
  assert.equal(
    result.headers.Authorization,
    "algorithm=HMAC-SHA256, Access=ACCESSKEY, SignedHeaders=content-type;sdk-content-type;sdk-host;sign-date, Signature=8744848C728A59743414FA88D25A5F948B72B249016A376325281794B6676594",
  );
});

test("signer validates malformed credentials and canonicalizes URI/query edge cases", () => {
  assert.throws(() => decodeAuthCode("not-hex"), /hexadecimal/);
  assert.throws(() => decodeAuthCode(Buffer.from("too|few").toString("hex")), /14 fields/);

  const emptyCredentialCode = buildAuthCode(" ", "SECRETKEY");
  assert.throws(() => decodeAuthCode(emptyCredentialCode), /empty credentials/);

  assert.throws(() => signRequest({
    url: "https://xdr.example.com/a",
    accessKey: "a",
    secretKey: "b",
  }), /method and url/);
  assert.throws(() => signRequest({
    method: "GET",
    url: "https://xdr.example.com/a",
  }), /accessKey and secretKey/);
  assert.throws(() => signRequest({
    method: "GET",
    url: "https://xdr.example.com/a",
    headers: { Authorization: "already-signed" },
    accessKey: "a",
    secretKey: "b",
  }), /must not contain Authorization/);

  assert.equal(
    signerInternals.canonicalQuery(new URL("https://xdr.example.com/a?b=2&a=x/y z&b=1")),
    "a=x/y+z&b=1&b=2",
  );
  assert.equal(signerInternals.canonicalUri("/路径 a"), "/%E8%B7%AF%E5%BE%84%20a/");
  assert.equal(signerInternals.canonicalPayloadHash("中 a").length, 64);

  const defaultHeaders = signRequest({
    method: "GET",
    url: "https://xdr.example.com/no-trailing-slash",
    accessKey: "a",
    secretKey: "b",
    now: new Date("2026-01-02T03:04:05Z"),
  }).headers;
  assert.equal(defaultHeaders["sdk-content-type"], "application/json");
  assert.equal(defaultHeaders["sign-date"], "20260102T030405Z");
});

const makeContext = (overrides = {}) => ({
  config: {
    baseUrl: "https://xdr.example.com",
    timeoutMs: 2000,
    ...(overrides.config ?? {}),
  },
  secret: {
    accessKey: "ACCESSKEY",
    secretKey: "SECRETKEY",
    ...(overrides.secret ?? {}),
  },
});

const expectGrpcCode = async (fn, code) => {
  await assert.rejects(async () => fn(), (error) => {
    assert.ok(error instanceof GrpcError);
    assert.equal(error.code, code);
    return true;
  });
};

test("XDR client validates base URL and credentials before sending", async () => {
  await expectGrpcCode(
    () => createXdrClient(makeContext({ config: { baseUrl: "" } }), { fetchImpl: async () => mockResponse(200, {}) }).post("/x", {}),
    grpcStatus.INVALID_ARGUMENT,
  );
  await expectGrpcCode(
    () => createXdrClient(makeContext({ secret: { accessKey: "", secretKey: "" } }), { fetchImpl: async () => mockResponse(200, {}) }).post("/x", {}),
    grpcStatus.UNAUTHENTICATED,
  );
  await expectGrpcCode(
    () => createXdrClient(makeContext({ config: { baseUrl: "ftp://xdr.example.com" } })),
    grpcStatus.INVALID_ARGUMENT,
  );
  await expectGrpcCode(
    () => createXdrClient(makeContext({ config: { timeoutMs: 0 } })),
    grpcStatus.INVALID_ARGUMENT,
  );
  await expectGrpcCode(
    () => createXdrClient(makeContext({ secret: { accessKey: "", secretKey: "", authCode: "abcd" } })),
    grpcStatus.INVALID_ARGUMENT,
  );

  const authCode = buildAuthCode("ACCESSKEY", "SECRETKEY");
  assert.deepEqual(clientInternals.resolveCredentials({ authCode }), {
    accessKey: "ACCESSKEY",
    secretKey: "SECRETKEY",
  });
});

test("XDR client signs and sends the final JSON request without later mutation", async () => {
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url: String(url), init: structuredClone(init) };
    return mockResponse(200, {
      code: "Success",
      message: "ok",
      data: { total: 1, page: 1, pageSize: 10, item: [{ uuId: "incident-1" }] },
    });
  };
  const client = createXdrClient(makeContext(), {
    fetchImpl,
    now: () => new Date("2026-01-02T03:04:05Z"),
  });

  const result = await client.post("/api/xdr/v1/incidents/list", { page: 1, pageSize: 10 });

  assert.equal(captured.url, "https://xdr.example.com/api/xdr/v1/incidents/list");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.body, "{\"page\":1,\"pageSize\":10}");
  assert.match(captured.init.headers.Authorization, /^algorithm=HMAC-SHA256,/);
  assert.equal(captured.init.headers["sign-date"], "20260102T030405Z");
  assert.equal(result.data.total, 1);
});

test("XDR client maps upstream HTTP status families to gRPC errors", async () => {
  const cases = [
    [401, grpcStatus.UNAUTHENTICATED],
    [403, grpcStatus.PERMISSION_DENIED],
    [404, grpcStatus.NOT_FOUND],
    [400, grpcStatus.FAILED_PRECONDITION],
    [429, grpcStatus.UNAVAILABLE],
    [503, grpcStatus.UNAVAILABLE],
  ];
  for (const [status, code] of cases) {
    const client = createXdrClient(makeContext(), {
      fetchImpl: async () => mockResponse(status, { code: "Error", message: "upstream rejected request" }),
    });
    await expectGrpcCode(() => client.post("/api/xdr/v1/assets/list", {}), code);
  }
});

test("XDR client maps network failures and non-success business codes", async () => {
  const networkClient = createXdrClient(makeContext(), {
    fetchImpl: async () => {
      throw new Error("connect ECONNREFUSED");
    },
  });
  await expectGrpcCode(() => networkClient.post("/api/xdr/v1/assets/list", {}), grpcStatus.UNAVAILABLE);

  const businessClient = createXdrClient(makeContext(), {
    fetchImpl: async () => mockResponse(200, { code: "InvalidParameter", message: "pageSize too large" }),
  });
  await expectGrpcCode(() => businessClient.post("/api/xdr/v1/assets/list", {}), grpcStatus.FAILED_PRECONDITION);

  const timeoutClient = createXdrClient(makeContext(), {
    fetchImpl: async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    },
  });
  await assert.rejects(
    () => timeoutClient.post("/api/xdr/v1/assets/list", {}),
    (error) => error.code === grpcStatus.UNAVAILABLE && /timed out/.test(error.message),
  );
});

test("XDR client rejects invalid successful JSON and accepts success-code variants", async () => {
  for (const body of ["not-json", ""]) {
    const client = createXdrClient(makeContext(), {
      fetchImpl: async () => mockResponse(200, body),
    });
    await expectGrpcCode(() => client.get("/api/xdr/v1/assets/department"), grpcStatus.UNKNOWN);
  }
  for (const code of [undefined, null, "", 0, "0", "Success", "success"]) {
    assert.equal(clientInternals.ensureBusinessSuccess({ code }).code, code);
  }
  assert.throws(
    () => clientInternals.ensureBusinessSuccess(null),
    (error) => error.code === grpcStatus.UNKNOWN,
  );
  assert.throws(
    () => clientInternals.ensureBusinessSuccess({ code: "Failure" }),
    (error) => error.code === grpcStatus.FAILED_PRECONDITION && /XDR business request failed/.test(error.message),
  );
  assert.match(clientInternals.mapHttpError(400, {}).message, /upstream HTTP 400$/);
});

test("XDR client uses the default undici transport with and without an insecure dispatcher", async () => {
  const mock = await createXdrMockServer();
  try {
    const secureClient = createXdrClient(makeContext({ config: { baseUrl: mock.baseUrl, headers: null } }));
    const insecureClient = createXdrClient(makeContext({ config: { baseUrl: mock.baseUrl, skipTlsVerify: true } }));
    assert.equal((await secureClient.get("health")).data.ok, true);
    assert.equal((await insecureClient.post("/search", { page: 1 })).data.ok, true);
  } finally {
    await mock.close();
  }
  assert.deepEqual(mock.requests, [
    { method: "GET", url: "/health", body: "" },
    { method: "POST", url: "/search", body: "{\"page\":1}" },
  ]);
});

const createCapturingHandlers = (response = {
  code: "Success",
  message: "ok",
  data: { total: 2, page: 1, pageSize: 20, item: [{ id: "one" }] },
}) => {
  const calls = [];
  const client = {
    post: async (path, body) => {
      calls.push({ method: "POST", path, body });
      return structuredClone(response);
    },
    get: async (path) => {
      calls.push({ method: "GET", path });
      return structuredClone(response);
    },
  };
  return {
    calls,
    handlers: createHandlers(() => client),
  };
};

test("SearchIncidents maps common filters and lets typed fields override extra filters", async () => {
  const { calls, handlers } = createCapturingHandlers();
  const result = await handlers[METHOD_SEARCH_INCIDENTS]({
    start_timestamp: 100,
    endTimestamp: 200,
    page: 1,
    page_size: 20,
    severities: [3, 4],
    data_sources: ["EDR"],
    extra_filters: { page: 99, customFilter: "custom" },
  }, makeContext());

  assert.deepEqual(calls[0], {
    method: "POST",
    path: "/api/xdr/v1/incidents/list",
    body: {
      page: 1,
      customFilter: "custom",
      startTimestamp: 100,
      endTimestamp: 200,
      pageSize: 20,
      severities: [3, 4],
      dataSources: ["EDR"],
    },
  });
  assert.equal(result.total, 2);
  assert.deepEqual(result.data.item, [{ id: "one" }]);
  assert.equal(result.raw_json, undefined);
});

test("SearchAlerts maps alert-specific filters", async () => {
  const { calls, handlers } = createCapturingHandlers();
  await handlers[METHOD_SEARCH_ALERTS]({
    page: 2,
    pageSize: 50,
    alert_deal_status: [0, 10],
    source_ips: ["1.1.1.1"],
    destinationIps: ["10.0.0.1"],
  }, makeContext());
  assert.deepEqual(calls[0], {
    method: "POST",
    path: "/api/xdr/v1/alerts/list",
    body: {
      page: 2,
      pageSize: 50,
      alertDealStatus: [0, 10],
      srcIps: ["1.1.1.1"],
      dstIps: ["10.0.0.1"],
    },
  });
});

test("SearchAssets maps asset lookup fields", async () => {
  const { calls, handlers } = createCapturingHandlers();
  await handlers[METHOD_SEARCH_ASSETS]({
    page: 1,
    page_size: 10,
    ip: "10.0.0.8",
    asset_ids: [111],
    branchIds: [1],
  }, makeContext());
  assert.deepEqual(calls[0], {
    method: "POST",
    path: "/api/xdr/v1/assets/list",
    body: {
      page: 1,
      pageSize: 10,
      ip: "10.0.0.8",
      assetIds: [111],
      branchIds: [1],
    },
  });
});

test("SearchRiskHosts maps risk-host filters", async () => {
  const { calls, handlers } = createCapturingHandlers();
  await handlers[METHOD_SEARCH_RISK_HOSTS]({
    host_asset_ids: [10],
    hostBranchIds: [1],
    page: 1,
    page_size: 25,
  }, makeContext());
  assert.deepEqual(calls[0], {
    method: "POST",
    path: "/api/xdr/v1/riskassets/list",
    body: {
      hostAssetIds: [10],
      hostBranchIds: [1],
      page: 1,
      pageSize: 25,
    },
  });
});

test("SearchVulnerabilities maps vulnerability and weak-password filters", async () => {
  const { calls, handlers } = createCapturingHandlers();
  await handlers[METHOD_SEARCH_VULNERABILITIES]({
    startTimestamp: 100,
    page_size: 100,
    data_type: "loophole",
    asset_ip: "10.0.0.8",
    attack_types: ["web"],
    asset_branch_ids: [1],
    riskLevels: [3, 4],
  }, makeContext());
  assert.deepEqual(calls[0], {
    method: "POST",
    path: "/api/xdr/v1/vuls/risk/list",
    body: {
      startTimestamp: 100,
      pageSize: 100,
      dataType: "loophole",
      assetIp: "10.0.0.8",
      attackTypes: ["web"],
      assetBranchIds: [1],
      riskLevels: [3, 4],
    },
  });
});

test("GetAlertContext requires UUID and returns structured alert proof", async () => {
  const { calls, handlers } = createCapturingHandlers({
    code: "Success",
    message: "ok",
    data: { proofType: "network", sourceIp: "1.1.1.1" },
  });
  await expectGrpcCode(() => handlers[METHOD_GET_ALERT_CONTEXT]({}, makeContext()), grpcStatus.INVALID_ARGUMENT);

  const result = await handlers[METHOD_GET_ALERT_CONTEXT]({ uuid: "alert-1" }, makeContext());
  assert.deepEqual(calls[0], {
    method: "GET",
    path: "/api/xdr/v1/alerts/alert-1/proof",
  });
  assert.deepEqual(result.data, { proofType: "network", sourceIp: "1.1.1.1" });
  assert.equal(result.raw_json, undefined);
});

test("GetIncidentContext fetches proof and all entity groups by default", async () => {
  const calls = [];
  const client = {
    get: async (path) => {
      calls.push(path);
      return { code: "Success", data: { path } };
    },
  };
  const handlers = createHandlers(() => client);

  const result = await handlers[METHOD_GET_INCIDENT_CONTEXT]({ uuid: "incident-1" }, makeContext());

  assert.deepEqual(calls, [
    "/api/xdr/v1/incidents/incident-1/proof",
    "/api/xdr/v1/incidents/incident-1/entities/process",
    "/api/xdr/v1/incidents/incident-1/entities/file",
    "/api/xdr/v1/incidents/incident-1/entities/host",
    "/api/xdr/v1/incidents/incident-1/entities/ip",
    "/api/xdr/v1/incidents/incident-1/entities/innerip",
    "/api/xdr/v1/incidents/incident-1/entities/dns",
  ]);
  assert.equal(result.proof.path, calls[0]);
  assert.equal(result.processes.path, calls[1]);
  assert.equal(result.files.path, calls[2]);
  assert.equal(result.hosts.path, calls[3]);
  assert.equal(result.external_ips.path, calls[4]);
  assert.equal(result.internal_ips.path, calls[5]);
  assert.equal(result.dns.path, calls[6]);
});

test("GetIncidentContext only fetches explicitly selected entity groups", async () => {
  const calls = [];
  const handlers = createHandlers(() => ({
    get: async (path) => {
      calls.push(path);
      return { code: "Success", data: { path } };
    },
  }));

  const result = await handlers[METHOD_GET_INCIDENT_CONTEXT]({
    uuid: "incident/with slash",
    include_files: true,
  }, makeContext());

  assert.deepEqual(calls, [
    "/api/xdr/v1/incidents/incident%2Fwith%20slash/proof",
    "/api/xdr/v1/incidents/incident%2Fwith%20slash/entities/file",
  ]);
  assert.equal(result.processes, undefined);
  assert.equal(result.files.path, calls[1]);
});

test("GetIncidentContext propagates an entity lookup failure", async () => {
  const expected = new GrpcError(grpcStatus.UNAVAILABLE, "file lookup unavailable");
  const handlers = createHandlers(() => ({
    get: async (path) => {
      if (path.endsWith("/entities/file")) throw expected;
      return { code: "Success", data: {} };
    },
  }));

  await assert.rejects(
    () => handlers[METHOD_GET_INCIDENT_CONTEXT]({ uuid: "incident-1", include_files: true }, makeContext()),
    (error) => error === expected,
  );
});

test("SDK service registers exactly the seven Issue #140 handlers", () => {
  assert.deepEqual(Object.keys(service.handlers).sort(), [
    METHOD_GET_ALERT_CONTEXT,
    METHOD_GET_INCIDENT_CONTEXT,
    METHOD_SEARCH_ALERTS,
    METHOD_SEARCH_ASSETS,
    METHOD_SEARCH_INCIDENTS,
    METHOD_SEARCH_RISK_HOSTS,
    METHOD_SEARCH_VULNERABILITIES,
  ].sort());
});

test("SDK-style handler context passes request, config, and secret to the XDR client", async () => {
  let receivedContext;
  let receivedBody;
  const handlers = createHandlers((context) => {
    receivedContext = context;
    return {
      post: async (_path, body) => {
        receivedBody = body;
        return { code: "Success", data: { item: [], total: 0 } };
      },
    };
  });

  await handlers[METHOD_SEARCH_INCIDENTS]({
    request: {
      startTimestamp: 0n,
      endTimestamp: 1_750_000_000n,
      page: 1,
      pageSize: 5,
    },
    config: { baseUrl: "https://xdr.example.com" },
    secret: { authCode: "test-auth-code" },
  });

  assert.deepEqual(receivedContext.config, { baseUrl: "https://xdr.example.com" });
  assert.deepEqual(receivedContext.secret, { authCode: "test-auth-code" });
  assert.deepEqual(receivedBody, {
    endTimestamp: 1_750_000_000,
    page: 1,
    pageSize: 5,
  });
  assert.doesNotThrow(() => JSON.stringify(receivedBody));
});

test("handler mapping helpers cover empty values and response fallbacks", () => {
  for (const value of [undefined, null, "", 0, []]) {
    assert.equal(handlerInternals.meaningful(value), false);
  }
  assert.equal(handlerInternals.meaningful(false), true);
  assert.deepEqual(handlerInternals.extraFilters({ extra_filters: [] }), {});
  assert.deepEqual(handlerInternals.extraFilters({ extraFilters: { value: 1 } }), { value: 1 });
  assert.deepEqual(handlerInternals.contextData({ code: "Success" }), { code: "Success" });
  assert.deepEqual(handlerInternals.searchResponse({}), {
    code: "",
    message: "",
    total: 0,
    page: 0,
    page_size: 0,
    data: null,
    raw_json: undefined,
  });
});
