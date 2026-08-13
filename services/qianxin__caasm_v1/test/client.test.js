import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { createServer } from "node:http";
import { once } from "node:events";

import { createClient } from "../src/client.js";

let server;
let baseUrl;
let lastRequest;

// Start a mock CAASM upstream that records the last request and replies
// according to the configured handler logic.
before(async () => {
  server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
      lastRequest = { method: req.method, url: req.url, headers: req.headers, body };

      // Route by URL path suffix to simulate different CAASM responses
      // (pathPrefix may prepend segments, so match on suffix)
      const suffix = req.url.split("/").pop();
      if (suffix === "ok") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ items: [{ id: 1 }], total: 1 }));
        return;
      }
      if (suffix === "unauth") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ message: "invalid credentials" }));
        return;
      }
      if (suffix === "forbidden") {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ message: "no permission" }));
        return;
      }
      if (suffix === "server-error") {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ trace: "internal stack trace" }));
        return;
      }
      if (suffix === "client-error") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      if (suffix === "non-json") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<html>not json</html>");
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unknown route" }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  baseUrl = `http://${addr.address}:${addr.port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

const validSecret = { appKey: "test-key", appSecret: "test-secret" };

function makeClient(overrides = {}) {
  return createClient(
    { baseUrl, pathPrefix: "", timeoutMs: 5000, ...overrides },
    validSecret
  );
}

describe("createClient", () => {
  it("sends POST with JSON body and parses JSON response", async () => {
    const call = makeClient();
    const result = await call("/ok", { offset: 0, limit: 10 });
    assert.deepEqual(result, { items: [{ id: 1 }], total: 1 });
    assert.equal(lastRequest.method, "POST");
    assert.equal(lastRequest.url, "/ok");
    assert.equal(lastRequest.headers["content-type"], "application/json");
    assert.deepEqual(lastRequest.body, { offset: 0, limit: 10 });
    // auth-credentials header should be present
    assert.ok(lastRequest.headers["auth-credentials"]);
  });

  it("includes auth-credentials header from buildAuthHeader", async () => {
    const call = makeClient();
    await call("/ok", {});
    const creds = lastRequest.headers["auth-credentials"];
    assert.match(creds, /appKey=test-key/);
    assert.match(creds, /nonce=\d{6}/);
    assert.match(creds, /timestamp=\d{10}/);
    assert.match(creds, /version=1\.0\.0/);
    assert.match(creds, /signature=[a-f0-9]{64}/);
  });

  it("prepends pathPrefix to the request path", async () => {
    const call = makeClient({ pathPrefix: "/caasm/v1/biz-service" });
    await call("/ok", {});
    assert.equal(lastRequest.url, "/caasm/v1/biz-service/ok");
  });

  it("returns UNAUTHENTICATED on HTTP 401", async () => {
    const call = makeClient();
    await assert.rejects(() => call("/unauth", {}), (err) => {
      assert.match(err.message, /CAASM auth rejected \(HTTP 401\)/);
      return true;
    });
  });

  it("returns UNAUTHENTICATED on HTTP 403", async () => {
    const call = makeClient();
    await assert.rejects(() => call("/forbidden", {}), (err) => {
      assert.match(err.message, /CAASM auth rejected \(HTTP 403\)/);
      return true;
    });
  });

  it("returns UNAVAILABLE on HTTP 5xx without leaking response body", async () => {
    const call = makeClient();
    await assert.rejects(() => call("/server-error", {}), (err) => {
      assert.match(err.message, /CAASM upstream error \(HTTP 500\)/);
      // Response body (internal stack trace) must NOT appear in the error message
      assert.doesNotMatch(err.message, /internal stack trace/);
      return true;
    });
  });

  it("returns UNAVAILABLE on HTTP 4xx without leaking response body", async () => {
    const call = makeClient();
    await assert.rejects(() => call("/client-error", {}), (err) => {
      assert.match(err.message, /CAASM HTTP 404/);
      assert.doesNotMatch(err.message, /not found/);
      return true;
    });
  });

  it("returns UNAVAILABLE on non-JSON response without leaking body", async () => {
    const call = makeClient();
    await assert.rejects(() => call("/non-json", {}), (err) => {
      assert.match(err.message, /CAASM returned non-JSON \(HTTP 200\)/);
      assert.doesNotMatch(err.message, /<html>|not json/);
      return true;
    });
  });

  it("returns UNAVAILABLE on network error (ECONNREFUSED)", async () => {
    // Point to a port that is not listening — server.close() in `after` frees the real port
    const call = createClient(
      { baseUrl: "http://127.0.0.1:1", pathPrefix: "", timeoutMs: 1000 },
      validSecret
    );
    await assert.rejects(() => call("/ok", {}), (err) => {
      assert.match(err.message, /CAASM request failed/);
      return true;
    });
  });

  it("returns UNAVAILABLE on timeout", async () => {
    // Use a separate server that never responds
    const slowServer = createServer((req, res) => {
      // intentionally never end the response
    });
    slowServer.listen(0, "127.0.0.1");
    await once(slowServer, "listening");
    const addr = slowServer.address();
    const slowUrl = `http://${addr.address}:${addr.port}`;

    const call = createClient(
      { baseUrl: slowUrl, pathPrefix: "", timeoutMs: 200 },
      validSecret
    );
    try {
      await assert.rejects(() => call("/ok", {}), (err) => {
        assert.match(err.message, /timed out after 200ms/);
        return true;
      });
    } finally {
      slowServer.closeAllConnections?.();
      await new Promise((r) => slowServer.close(() => r()));
    }
  });

  it("throws INVALID_ARGUMENT for invalid baseUrl", () => {
    assert.throws(
      () => createClient({ baseUrl: "not-a-valid-url", pathPrefix: "" }, validSecret),
      /config.baseUrl is not a valid URL/
    );
  });

  it("throws UNAUTHENTICATED when baseUrl is missing", () => {
    assert.throws(
      () => createClient({}, validSecret),
      /config.baseUrl is required/
    );
  });

  it("throws UNAUTHENTICATED when appKey/appSecret are missing", () => {
    assert.throws(
      () => createClient({ baseUrl: "http://127.0.0.1" }, {}),
      /secret.appKey and secret.appSecret are required/
    );
  });
});
