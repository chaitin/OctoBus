import assert from "node:assert/strict";
import test from "node:test";

import { rpcdef, _test } from "../src/venus-maf.js";

const jsonResponse = (body, options = {}) => ({
  ok: options.ok ?? true,
  status: options.status ?? 200,
  headers: { get: () => "" },
  text: async () => typeof body === "string" ? JSON.stringify(body) : JSON.stringify(body),
});

const baseCtx = {
  config: { baseUrl: "https://maf.example.local/monitor", insecureSkipTlsVerify: false },
  secret: { username: "adm", password: "secret" },
};

test("helpers hash password and normalize UI URL to origin", () => {
  assert.equal(_test.sha256Hex("secret"), "2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b");
  assert.equal(_test.normalizeOrigin("https://maf.example.local/monitor"), "https://maf.example.local");
  assert.equal(_test.normalizePrefix("api/v3/"), "/api/v3");
});

test("CreateSite builds expected upstream requests and verifies list", async () => {
  const calls = [];
  global.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/api/v3/login")) {
      return jsonResponse({ code: 0, msg: "success", data: { authorization: "token-1" } });
    }
    if (url.endsWith("/api/v3/protect/vs/add")) return jsonResponse("success");
    if (url.includes("/api/v3/protect/vs/find?")) {
      return jsonResponse({
        code: 0,
        msg: "success",
        data: {
          list: [{ id: 7, name: "octobus-maf-site", ip: "192.0.2.10", port: 8080, http_type: "http", enable: 1 }],
          total: 1,
          page: 1,
          pageSize: 10,
        },
      });
    }
    throw new Error(`unexpected ${url}`);
  };
  const req = {
    name: "octobus-maf-site",
    ip: "192.0.2.10",
    port: 8080,
    server_name: ["maf.example.local"],
    upstream: { server_addr: [{ ip: "198.51.100.1", port: 8080 }] },
  };
  const res = await rpcdef({ ...baseCtx, req })["/Venus_MAF.Venus_MAF/CreateSite"]();
  assert.equal(res.ok, true);
  assert.equal(calls[1].url, "https://maf.example.local/api/v3/protect/vs/add");
  const payload = JSON.parse(calls[1].init.body);
  assert.equal(payload.enable, 1);
  assert.equal(payload.upstream.load_balance_algo, "round_robin");
});

test("DeleteSite resolves id by name when id is omitted", async () => {
  const writes = [];
  let findCount = 0;
  global.fetch = async (url, init = {}) => {
    if (url.endsWith("/api/v3/login")) {
      return jsonResponse({ code: 0, msg: "success", data: { authorization: "token-1" } });
    }
    if (url.includes("/api/v3/protect/vs/find?")) {
      findCount += 1;
      if (findCount > 1) return jsonResponse({ code: 0, msg: "success", data: { list: [], total: 0 } });
      return jsonResponse({ code: 0, msg: "success", data: { list: [{ id: 9, name: "site-a" }], total: 1 } });
    }
    if (url.endsWith("/api/v3/protect/vs/delete")) {
      writes.push(JSON.parse(init.body));
      return jsonResponse("success");
    }
    throw new Error(`unexpected ${url}`);
  };
  const res = await rpcdef({ ...baseCtx, req: { name: "site-a" } })["/Venus_MAF.Venus_MAF/DeleteSite"]();
  assert.equal(res.ok, true);
  assert.deepEqual(writes[0], [{ id: 9, name: "site-a" }]);
});

test("UploadCustomSensitiveWords sends multipart body", async () => {
  const calls = [];
  global.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/api/v3/login")) {
      return jsonResponse({ code: 0, msg: "success", data: { authorization: "token-1" } });
    }
    if (url.endsWith("/api/v3/protect/tmpl/llm/customize/file")) return jsonResponse("words.txt");
    throw new Error(`unexpected ${url}`);
  };
  const res = await rpcdef({
    ...baseCtx,
    req: { filename: "words.txt", content: "secret-word\n" },
  })["/Venus_MAF.Venus_MAF/UploadCustomSensitiveWords"]();
  assert.equal(res.ok, true);
  assert.equal(res.origin_file_name, "words.txt");
  assert.match(calls[1].init.headers["Content-Type"], /^multipart\/form-data; boundary=/);
  assert.match(calls[1].init.body.toString("utf8"), /secret-word/);
});

test("UploadCustomSensitiveWords escapes multipart filename parameters", () => {
  const multipart = _test.buildMultipart({
    fieldName: "file",
    filename: 'bad"name\\with\r\nbreak.txt',
    content: "secret-word\n",
  });

  assert.match(
    multipart.body.toString("utf8"),
    /filename="bad\\"name\\\\with__break\.txt"/,
  );
});

test("default fetch path uses AbortSignal timeout", async () => {
  const calls = [];
  global.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    return jsonResponse({ code: 0, msg: "success", data: { authorization: "token-1" } });
  };

  await rpcdef({ ...baseCtx, config: { ...baseCtx.config, timeoutMs: 1234 } })["/Venus_MAF.Venus_MAF/HealthCheck"]();

  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal("timeoutMs" in calls[0].init, false);
});

test("upstream auth failure maps to UNAUTHENTICATED", async () => {
  global.fetch = async () => ({
    ok: false,
    status: 401,
    headers: { get: () => "" },
    text: async () => "unauthorized",
  });
  await assert.rejects(
    rpcdef({ ...baseCtx, req: {} })["/Venus_MAF.Venus_MAF/HealthCheck"](),
    /UNAUTHENTICATED/,
  );
});
