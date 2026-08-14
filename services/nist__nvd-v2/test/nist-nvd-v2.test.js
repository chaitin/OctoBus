import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";
import { _test, extractCveDetails, handlers, lookupCve, searchCves } from "../src/nist-nvd-v2.js";
import { service } from "../src/service.js";

const port = 20_000 + (process.pid % 10_000);
const config = { nvdBaseUrl: `http://127.0.0.1:${port}/`, timeoutMs: 1_000 };
let mock;

async function waitForMock() {
  for (let attempts = 0; attempts < 50; attempts += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).status === 204) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("mock upstream did not start");
}

async function expectsGrpcError(fn, code) {
  await assert.rejects(fn, (error) => error instanceof GrpcError && error.code === code);
}

test("setup mock upstream", async () => {
  mock = spawn("node", ["test/mock_upstream.js"], { cwd: new URL("..", import.meta.url), env: { ...process.env, HTTP_PORT: String(port) } });
  await waitForMock();
});

test("LookupCve returns the complete protobuf-safe record", async () => {
  const result = await lookupCve(config, {}, "cve-2021-44228");
  assert.equal(result.cveId, "CVE-2021-44228");
  assert.equal(result.severity, "CRITICAL");
  assert.equal(result.cvssV31Score, 10);
  assert.deepEqual(result.cweIds, ["CWE-20", "CWE-400"]);
  assert.equal(result.affectedProducts[0].vendor, "apache");
});

test("LookupCve validates input and maps absence to NOT_FOUND", async () => {
  await expectsGrpcError(() => lookupCve(config, {}, "not-a-cve"), grpcStatus.INVALID_ARGUMENT);
  await expectsGrpcError(() => lookupCve(config, {}, "CVE-0000-0000"), grpcStatus.NOT_FOUND);
});

test("SearchCves supports every request field and retries transient upstream errors", async () => {
  const result = await searchCves(config, { nvdApiKey: "test-key" }, { keyword: "RETRY", severity: "high", skip: 0, limit: 99, pubStartDate: "2024-01-01T00:00:00.000", pubEndDate: "2024-12-31T00:00:00.000" });
  assert.equal(result.total, 0);
  await expectsGrpcError(() => searchCves(config, {}, { severity: "bad" }), grpcStatus.INVALID_ARGUMENT);
  await expectsGrpcError(() => searchCves(config, {}, { limit: -1 }), grpcStatus.INVALID_ARGUMENT);
});

test("SearchCves returns records, and handlers use ctx request/config/secret", async () => {
  const result = await handlers["nist.nvd.v2.NvdService/SearchCves"]({ config, secret: {}, request: { keyword: "log4j", limit: 5 } });
  assert.equal(result.total, 1);
  assert.equal(result.data[0].cveId, "CVE-2021-44228");
  assert.equal((await searchCves(config, {}, { keyword: "log4j", severity: "" })).total, 1);
  assert.equal((await searchCves(config, {}, {})).total, 1);
  assert.equal((await searchCves(config, {}, { limit: 0 })).total, 1);
  assert.equal(typeof service.handlers["nist.nvd.v2.NvdService/LookupCve"], "function");
});

test("HTTP errors and invalid base URLs have deterministic gRPC mappings", async () => {
  await expectsGrpcError(() => searchCves(config, {}, { keyword: "AUTH_FAIL" }), grpcStatus.PERMISSION_DENIED);
  await expectsGrpcError(() => searchCves(config, {}, { keyword: "INVALID" }), grpcStatus.INVALID_ARGUMENT);
  await expectsGrpcError(() => lookupCve({ nvdBaseUrl: "file:///tmp/nvd" }, {}, "CVE-2021-44228"), grpcStatus.INVALID_ARGUMENT);
  await expectsGrpcError(() => lookupCve({ nvdBaseUrl: "http://127.0.0.1:1/", timeoutMs: 10 }, {}, "CVE-2021-44228"), grpcStatus.UNAVAILABLE);
});

test("CVE extraction falls back through NVD metric versions", () => {
  assert.equal(extractCveDetails({ id: "CVE-2025-0001", metrics: { cvssMetricV30: [{ cvssData: { baseScore: 8.1, baseSeverity: "HIGH" } }] } }).severity, "HIGH");
  assert.equal(extractCveDetails({ id: "CVE-2025-0002", metrics: { cvssMetricV2: [{ cvssData: { baseScore: 5 } }] } }).severity, "MEDIUM");
  assert.equal(_test.timeoutMs(-1), 30_000);
  assert.equal(_test.timeoutMs(999_999), 120_000);
  assert.equal(_test.appendQuery("https://example.test/api", { value: "a b" }).searchParams.get("value"), "a b");
});

test("CVE extraction excludes NVD CWE placeholders", () => {
  const { cweIds } = extractCveDetails({
    weaknesses: [{ description: [
      { value: "CWE-79" }, { value: "NVD-CWE-noinfo" }, { value: "NVD-CWE-Other" }, { value: "cwe-89" },
    ] }],
  });
  assert.deepEqual(cweIds, ["CWE-79", "cwe-89"]);
});

test("CVE extraction represents affected CPE version ranges", () => {
  const [exclusiveEnd, exclusiveStart, inclusiveEnd, literal] = extractCveDetails({
    configurations: [{ nodes: [{ cpeMatch: [
      { criteria: "cpe:2.3:a:apache:log4j:*:*:*:*:*:*:*:*", versionStartIncluding: "2.0", versionEndExcluding: "2.15.0" },
      { criteria: "cpe:2.3:a:vendor:product:*:*:*:*:*:*:*:*", versionStartExcluding: "1.0", versionEndIncluding: "3.0" },
      { criteria: "cpe:2.3:a:vendor:other:*:*:*:*:*:*:*:*", versionEndIncluding: "4.0" },
      { criteria: "cpe:2.3:a:vendor:literal:1.2.3:*:*:*:*:*:*:*" },
    ] }] }],
  }).affectedProducts;
  assert.equal(exclusiveEnd.version, ">= 2.0 < 2.15.0");
  assert.equal(exclusiveStart.version, "> 1.0 <= 3.0");
  assert.equal(inclusiveEnd.version, "<= 4.0");
  assert.equal(literal.version, "1.2.3");
});

test("HTTP client maps malformed responses, retries, and timeouts without exposing secrets", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => "not json" });
    await expectsGrpcError(() => _test.httpGetJson("https://example.test", {}, 1_000), grpcStatus.UNAVAILABLE);

    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => String(10 << 20) },
      text: async () => { throw new Error("body should not be read"); },
    });
    await expectsGrpcError(() => _test.httpGetJson("https://example.test", {}, 1_000), grpcStatus.UNAVAILABLE);

    let attempts = 0;
    globalThis.fetch = async () => ({ ok: attempts++ > 0, status: attempts > 1 ? 200 : 503, text: async () => attempts > 1 ? "{}" : "temporarily unavailable" });
    assert.deepEqual(await _test.httpGetJson("https://example.test", {}, 1_000), {});

    globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true }));
    await expectsGrpcError(() => _test.httpGetJson("https://example.test", {}, 1), grpcStatus.UNAVAILABLE);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("extraction handles sparse NVD documents and explicit HTTP error classes", () => {
  assert.deepEqual(extractCveDetails(null), {});
  const record = extractCveDetails({ id: "CVE-2025-0003", descriptions: [{ lang: "fr", value: "ignored" }], metrics: {}, weaknesses: [{}], references: [{}], configurations: [{ nodes: [{}] }] });
  assert.equal(record.description, "");
  assert.equal(record.references[0].url, "");
  assert.equal(record.affectedProducts.length, 0);
  assert.equal(_test.mapHttpError(401, "").code, grpcStatus.PERMISSION_DENIED);
  assert.equal(_test.mapHttpError(429, "").code, grpcStatus.UNAVAILABLE);
  assert.equal(_test.mapHttpError(400, "bad").code, grpcStatus.INVALID_ARGUMENT);
});

test("cleanup", () => mock?.kill());
