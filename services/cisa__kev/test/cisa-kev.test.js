import { spawn } from "node:child_process";
import { test } from "node:test";
import { deepStrictEqual, rejects } from "node:assert";
import { _test, checkCve } from "../src/cisa-kev.js";
import { service } from "../src/service.js";
import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

async function waitPort(port, ms = 5000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      await fetch(`http://127.0.0.1:${port}/`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`mock server on port ${port} did not become ready in ${ms}ms`);
}

const MOCK_PORT = 19003;
let mockProcess;
const MOCK_DIR = new URL(".", import.meta.url).pathname.replace(/\/test\/$/, "");
const baseConfig = {
  timeoutMs: 30000,
  kevCacheTtlMs: 0,
  kevPrimaryUrl: `http://127.0.0.1:${MOCK_PORT}/catalog.json`,
  kevFallbackUrl: `http://127.0.0.1:${MOCK_PORT}/fallback.json`,
};

test("setup mock upstream", async () => {
  mockProcess = spawn("node", ["test/mock_upstream.js"], {
    cwd: MOCK_DIR,
    env: { ...process.env, HTTP_PORT: String(MOCK_PORT) },
    stdio: "pipe",
  });
  await waitPort(MOCK_PORT);
});

test("cisa__kev — Check returns inKev=true for known CVE", async () => {
  const r = await checkCve(baseConfig, "CVE-2021-44228");
  deepStrictEqual(r.inKev, true);
  deepStrictEqual(r.entry.vendorProject, "Apache");
  deepStrictEqual(r.entry.knownRansomwareCampaignUse, "Known");
});

test("cisa__kev — Check returns inKev=false for unknown CVE", async () => {
  const r = await checkCve(baseConfig, "CVE-9999-99999");
  deepStrictEqual(r.inKev, false);
});

test("cisa__kev — Check rejects empty cveId", async () => {
  let err;
  try {
    await checkCve(baseConfig, "");
  } catch (e) {
    err = e;
  }
  deepStrictEqual(err instanceof GrpcError, true);
  deepStrictEqual(err.code, grpcStatus.INVALID_ARGUMENT);
});

test("cisa__kev — Check rejects non-string cveId", async () => {
  await rejects(() => checkCve(baseConfig, 1234), (err) => (
    err instanceof GrpcError && err.code === grpcStatus.INVALID_ARGUMENT
  ));
});

test("cisa__kev — falls back when primary is unavailable", async () => {
  const r = await checkCve({
    ...baseConfig,
    kevPrimaryUrl: `http://127.0.0.1:${MOCK_PORT}/down`,
    kevFallbackUrl: `http://127.0.0.1:${MOCK_PORT}/fallback.json`,
  }, "CVE-2022-22965");
  deepStrictEqual(r.inKev, true);
  deepStrictEqual(r.entry.vendorProject, "VMware");
});

test("cisa__kev — fails when both sources return unusable content", async () => {
  let err;
  try {
    await checkCve({
      ...baseConfig,
      kevPrimaryUrl: `http://127.0.0.1:${MOCK_PORT}/html`,
      kevFallbackUrl: `http://127.0.0.1:${MOCK_PORT}/down`,
    }, "CVE-2021-44228");
  } catch (e) {
    err = e;
  }
  deepStrictEqual(err instanceof GrpcError, true);
  deepStrictEqual(err.code, grpcStatus.UNAVAILABLE);
});

test("cisa__kev — preserves the last upstream error when both sources fail", async () => {
  await rejects(() => checkCve({
    ...baseConfig,
    kevPrimaryUrl: `http://127.0.0.1:${MOCK_PORT}/down`,
    kevFallbackUrl: `http://127.0.0.1:${MOCK_PORT}/down`,
  }, "CVE-2021-44228"), (err) => (
    err instanceof GrpcError
      && err.code === grpcStatus.UNAVAILABLE
      && /HTTP/.test(err.message)
  ));
});

test("cisa__kev — maps HTTP, invalid JSON, timeout, and network errors", async () => {
  await rejects(() => _test.httpGetJson(`http://127.0.0.1:${MOCK_PORT}/html`, 1000), (err) => (
    err instanceof GrpcError && err.code === grpcStatus.INVALID_ARGUMENT
  ));

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ status: 200, text: async () => "not-json" });
    await rejects(() => _test.httpGetJson("https://example.test", 1000), /non-JSON/);

    globalThis.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    });
    await rejects(() => _test.httpGetJson("https://example.test", 1), /timeout after 1ms/);

    globalThis.fetch = async () => { throw new Error("socket closed"); };
    await rejects(() => _test.httpGetJson("https://example.test", 1000), /socket closed/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cisa__kev — caches successful catalogs for the configured source pair", async () => {
  _test.resetCache();
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls += 1;
    return originalFetch(...args);
  };
  const config = { ...baseConfig, kevCacheTtlMs: 60_000 };
  try {
    await checkCve(config, "CVE-2021-44228");
    await checkCve(config, "CVE-9999-99999");
  } finally {
    globalThis.fetch = originalFetch;
  }
  deepStrictEqual(calls, 1);
});

test("cisa__kev — treats a successful catalog without vulnerabilities as empty", async () => {
  _test.resetCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 200, text: async () => JSON.stringify({ title: "empty" }) });
  try {
    deepStrictEqual(await _test.fetchCatalog({
      kevPrimaryUrl: "https://primary.example.test",
      kevFallbackUrl: "https://fallback.example.test",
      kevCacheTtlMs: 0,
    }), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cisa__kev — safely fills absent optional KEV entry fields", async () => {
  _test.resetCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    status: 200,
    text: async () => JSON.stringify({ vulnerabilities: [{ cveID: "CVE-2026-0001" }] }),
  });
  try {
    const result = await checkCve({
      kevPrimaryUrl: "https://primary.example.test",
      kevFallbackUrl: "https://fallback.example.test",
      kevCacheTtlMs: 0,
    }, "cve-2026-0001");
    deepStrictEqual(result.entry, {
      cveId: "CVE-2026-0001",
      vendorProject: "",
      product: "",
      vulnerabilityName: "",
      dateAdded: "",
      shortDescription: "",
      requiredAction: "",
      dueDate: "",
      knownRansomwareCampaignUse: "",
      notes: "",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cisa__kev — service handlers read request/config from ctx", async () => {
  const method = "cisa.kev.KevService/Check";
  const r = await service.handlers[method]({
    config: baseConfig,
    request: { cveId: "CVE-2021-44228" },
  });
  deepStrictEqual(r.inKev, true);
  deepStrictEqual(r.entry.vendorProject, "Apache");
});

test("cleanup", () => {
  if (mockProcess) mockProcess.kill();
});
