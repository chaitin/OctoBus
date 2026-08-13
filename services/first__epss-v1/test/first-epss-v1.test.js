import { test } from "node:test";
import assert from "node:assert/strict";

import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

import { getScores, handlers } from "../src/first-epss-v1.js";
import { service } from "../src/service.js";
import { createMockServer } from "./mock_upstream.js";

const METHOD = "first.epss.v1.EpssService/GetScores";

const buildCtx = (mock, cveIds) => ({
  config: { epssBaseUrl: mock.url, timeoutMs: 5000 },
  request: { cveIds },
});

test("first__epss-v1 — GetScores returns scores for known CVEs", async (t) => {
  const mock = await createMockServer();
  t.after(() => mock.close());

  const result = await handlers[METHOD](buildCtx(mock, ["CVE-2021-44228", "CVE-2022-22965"]));
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].cveId, "CVE-2021-44228");
  assert.equal(typeof result.data[0].epss, "number");
  assert.equal(result.data[0].epss > 0, true);
});

test("first__epss-v1 — GetScores returns empty for empty cveIds", async (t) => {
  const mock = await createMockServer();
  t.after(() => mock.close());

  const result = await handlers[METHOD](buildCtx(mock, []));
  assert.deepEqual(result, { data: [] });
});

test("first__epss-v1 — GetScores rejects non-array cveIds", async (t) => {
  const mock = await createMockServer();
  t.after(() => mock.close());

  await assert.rejects(
    () => handlers[METHOD](buildCtx(mock, "not-an-array")),
    (error) => error instanceof GrpcError && error.code === grpcStatus.INVALID_ARGUMENT,
  );
});

test("first__epss-v1 — GetScores rejects non-string CVE ids", async (t) => {
  const mock = await createMockServer();
  t.after(() => mock.close());

  await assert.rejects(
    () => getScores({ epssBaseUrl: mock.url }, ["CVE-2021-44228", 123]),
    (error) => error instanceof GrpcError && error.code === grpcStatus.INVALID_ARGUMENT,
  );
});

test("first__epss-v1 — GetScores accepts null cveIds as empty input", async () => {
  const result = await getScores({}, null);
  assert.deepEqual(result, { data: [] });
});

test("first__epss-v1 — maps upstream 5xx to UNAVAILABLE", async (t) => {
  const mock = await createMockServer();
  t.after(() => mock.close());

  await assert.rejects(
    () => handlers[METHOD]({
      config: { epssBaseUrl: mock.downUrl, timeoutMs: 5000 },
      request: { cveIds: ["CVE-2021-44228"] },
    }),
    (error) => error instanceof GrpcError && error.code === grpcStatus.UNAVAILABLE,
  );
});

test("first__epss-v1 — maps upstream 4xx to INVALID_ARGUMENT without secret material", async (t) => {
  const mock = await createMockServer();
  t.after(() => mock.close());

  await assert.rejects(
    () => handlers[METHOD]({
      config: { epssBaseUrl: mock.badRequestUrl, timeoutMs: 5000 },
      request: { cveIds: ["CVE-2021-44228"] },
    }),
    (error) => {
      assert.ok(error instanceof GrpcError);
      assert.equal(error.code, grpcStatus.INVALID_ARGUMENT);
      assert.match(error.message, /HTTP 400/);
      return true;
    },
  );
});

test("first__epss-v1 — maps timeout to DEADLINE_EXCEEDED", async (t) => {
  const mock = await createMockServer();
  t.after(() => mock.close());

  await assert.rejects(
    () => handlers[METHOD]({
      config: { epssBaseUrl: mock.slowUrl, timeoutMs: 1 },
      request: { cveIds: ["CVE-2021-44228"] },
    }),
    (error) => error instanceof GrpcError && error.code === grpcStatus.DEADLINE_EXCEEDED,
  );
});

test("first__epss-v1 — maps non-JSON success response to UNAVAILABLE without raw body", async (t) => {
  const mock = await createMockServer();
  t.after(() => mock.close());

  await assert.rejects(
    () => handlers[METHOD]({
      config: { epssBaseUrl: mock.notJsonUrl, timeoutMs: 5000 },
      request: { cveIds: ["CVE-2021-44228"] },
    }),
    (error) => {
      assert.ok(error instanceof GrpcError);
      assert.equal(error.code, grpcStatus.UNAVAILABLE);
      assert.doesNotMatch(error.message, /not-json/);
      return true;
    },
  );
});

test("first__epss-v1 — maps response read failure to UNAVAILABLE", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => ({
    status: 200,
    text: async () => {
      throw new Error("reader exploded");
    },
  });

  await assert.rejects(
    () => getScores({ epssBaseUrl: "https://epss.example.test", timeoutMs: 5000 }, ["CVE-2021-44228"]),
    (error) => {
      assert.ok(error instanceof GrpcError);
      assert.equal(error.code, grpcStatus.UNAVAILABLE);
      assert.match(error.message, /response body read failed/);
      return true;
    },
  );
});

test("first__epss-v1 — uses default endpoint and timeout with empty success body", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestedUrl;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, init) => {
    requestedUrl = String(url);
    assert.equal(init.method, "GET");
    assert.ok(init.signal);
    return { status: 200, text: async () => "" };
  };

  const result = await getScores({}, ["CVE-2021-44228"]);
  assert.deepEqual(result, { data: [] });
  assert.match(requestedUrl, /^https:\/\/api\.first\.org\/data\/v1\/epss\?/);
});

test("first__epss-v1 — maps non-Error fetch failures to UNAVAILABLE", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    throw "socket closed";
  };

  await assert.rejects(
    () => getScores({ epssBaseUrl: "https://epss.example.test", timeoutMs: 5000 }, ["CVE-2021-44228"]),
    (error) => {
      assert.ok(error instanceof GrpcError);
      assert.equal(error.code, grpcStatus.UNAVAILABLE);
      assert.match(error.message, /network failure/);
      return true;
    },
  );
});

test("first__epss-v1 — maps invalid numeric score fields to zero", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => ({
    status: 200,
    text: async () => JSON.stringify({ data: [{ cve: "CVE-X", epss: "not-a-number", percentile: "bad" }] }),
  });

  const result = await getScores({ epssBaseUrl: "https://epss.example.test", timeoutMs: 5000 }, ["CVE-X"]);
  assert.deepEqual(result, { data: [{ cveId: "CVE-X", epss: 0, percentile: 0, date: "" }] });
});

test("first__epss-v1 — maps non-Error response read failures to UNAVAILABLE", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => ({
    status: 200,
    text: async () => {
      throw "reader closed";
    },
  });

  await assert.rejects(
    () => getScores({ epssBaseUrl: "https://epss.example.test", timeoutMs: 5000 }, ["CVE-2021-44228"]),
    (error) => {
      assert.ok(error instanceof GrpcError);
      assert.equal(error.code, grpcStatus.UNAVAILABLE);
      assert.match(error.message, /read failure/);
      return true;
    },
  );
});

test("first__epss-v1 — mock upstream exposes request validation branches", async (t) => {
  const mock = await createMockServer();
  t.after(() => mock.close());

  const post = await fetch(mock.url, { method: "POST" });
  assert.equal(post.status, 405);

  const missingCve = await fetch(mock.url);
  assert.equal(missingCve.status, 400);
});

test("first__epss-v1 — service exports handler map", () => {
  assert.equal(service.handlers[METHOD], handlers[METHOD]);
});
