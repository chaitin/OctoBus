import { spawn } from "node:child_process";
import { test } from "node:test";
import { deepStrictEqual } from "node:assert";
import { checkCve } from "../src/cisa-kev.js";
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

test("cisa__kev — Check returns inKev=true for known CVE", () => {
  const r = checkCve(baseConfig, "CVE-2021-44228");
  deepStrictEqual(r.inKev, true);
  deepStrictEqual(r.entry.vendorProject, "Apache");
  deepStrictEqual(r.entry.knownRansomwareCampaignUse, "Known");
});

test("cisa__kev — Check returns inKev=false for unknown CVE", () => {
  const r = checkCve(baseConfig, "CVE-9999-99999");
  deepStrictEqual(r.inKev, false);
});

test("cisa__kev — Check rejects empty cveId", () => {
  let err;
  try {
    checkCve(baseConfig, "");
  } catch (e) {
    err = e;
  }
  deepStrictEqual(err instanceof GrpcError, true);
  deepStrictEqual(err.code, grpcStatus.INVALID_ARGUMENT);
});

test("cisa__kev — falls back when primary is unavailable", () => {
  const r = checkCve({
    ...baseConfig,
    kevPrimaryUrl: `http://127.0.0.1:${MOCK_PORT}/down`,
    kevFallbackUrl: `http://127.0.0.1:${MOCK_PORT}/fallback.json`,
  }, "CVE-2022-22965");
  deepStrictEqual(r.inKev, true);
  deepStrictEqual(r.entry.vendorProject, "VMware");
});

test("cisa__kev — fails when both sources return unusable content", () => {
  let err;
  try {
    checkCve({
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

test("cleanup", () => {
  if (mockProcess) mockProcess.kill();
});

