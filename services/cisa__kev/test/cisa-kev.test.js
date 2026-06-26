import { spawn } from "node:child_process";
import { test } from "node:test";
import { deepStrictEqual } from "node:assert";

async function waitPort(port, ms = 5000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { await fetch(`http://127.0.0.1:${port}/`); return; } catch (e) { await new Promise(r => setTimeout(r, 100)); }
  }
}

async function invoke(body) {
  const r = await fetch("http://127.0.0.1:9000/capsets/test/connect/cisa-kev-test/cisa.kev.KevService/Check", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return r.json();
}

const MOCK_PORT = 19003;
let mockProcess;

test("cisa__kev — Check returns inKev=true for known CVE", async (t) => {
  mockProcess = spawn("node", ["test/mock_upstream.js"], {
    cwd: new URL(".", import.meta.url).pathname.replace(/\/test\/$/, ""),
    env: { ...process.env, HTTP_PORT: String(MOCK_PORT) },
    stdio: "pipe",
  });
  await waitPort(MOCK_PORT);

  const r = await invoke({ cveId: "CVE-2021-44228" });
  deepStrictEqual(r.code, undefined, `unexpected error: ${JSON.stringify(r)}`);
  deepStrictEqual(r.inKev, true);
  deepStrictEqual(r.entry.vendorProject, "Apache");
  deepStrictEqual(r.entry.knownRansomwareCampaignUse, "Known");
});

test("cisa__kev — Check returns inKev=false for unknown CVE", async (t) => {
  const r = await invoke({ cveId: "CVE-9999-99999" });
  deepStrictEqual(r.code, undefined);
  deepStrictEqual(r.inKev, false);
});

test("cisa__kev — Check rejects empty cveId", async (t) => {
  const r = await invoke({ cveId: "" });
  deepStrictEqual(r.code, "invalid_argument");
});

test("cleanup", () => { if (mockProcess) mockProcess.kill(); });
