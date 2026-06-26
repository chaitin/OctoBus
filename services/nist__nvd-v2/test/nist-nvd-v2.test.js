import { spawn } from "node:child_process";
import { test } from "node:test";
import { deepStrictEqual } from "node:assert";

async function waitPort(port, ms = 5000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { await fetch(`http://127.0.0.1:${port}/`); return; } catch (e) { await new Promise(r => setTimeout(r, 100)); }
  }
}

async function invoke(port, method, body) {
  const r = await fetch(`http://127.0.0.1:${port}/capsets/test/connect/nist-nvd-v2-test/nist.nvd.v2.NvdService/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return r.json();
}

const NVD_PORT = 19001;
let mockProcess;

test("nist__nvd-v2 — LookupCve returns full CVE record", async (t) => {
  mockProcess = spawn("node", ["test/mock_upstream.js"], {
    cwd: new URL(".", import.meta.url).pathname.replace(/\/test\/$/, ""),
    env: { ...process.env, HTTP_PORT: String(NVD_PORT) },
    stdio: "pipe",
  });
  await waitPort(NVD_PORT);

  const r = await invoke(9000, "LookupCve", { cveId: "CVE-2021-44228" });
  deepStrictEqual(r.code, undefined, `unexpected error: ${JSON.stringify(r)}`);
  deepStrictEqual(r.cveId, "CVE-2021-44228");
  deepStrictEqual(r.cvssV31Score, 10);
  deepStrictEqual(r.severity, "CRITICAL");
  deepStrictEqual(r.cweIds.length >= 2, true);
  deepStrictEqual(r.references.length >= 1, true);
  deepStrictEqual(r.affectedProducts.length >= 1, true);
});

test("nist__nvd-v2 — LookupCve returns empty result for unknown CVE", async (t) => {
  const r = await invoke(9000, "LookupCve", { cveId: "CVE-0000-0000" });
  deepStrictEqual(r.code, "invalid_argument", "should return INVALID_ARGUMENT for missing CVE");
});

test("nist__nvd-v2 — SearchCves returns results", async (t) => {
  const r = await invoke(9000, "SearchCves", { keyword: "log4j", limit: 5 });
  deepStrictEqual(r.code, undefined);
  deepStrictEqual(r.total, 1);
  deepStrictEqual(r.data.length, 1);
  deepStrictEqual(r.data[0].cveId, "CVE-2021-44228");
});

test("nist__nvd-v2 — LookupCve rejects empty cveId", async (t) => {
  const r = await invoke(9000, "LookupCve", {});
  deepStrictEqual(r.code, "invalid_argument");
});

test("cleanup", () => { if (mockProcess) { mockProcess.kill(); } });
