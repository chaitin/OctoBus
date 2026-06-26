import { spawn } from "node:child_process";
import { test } from "node:test";
import { deepStrictEqual } from "node:assert";

async function waitPort(port, ms = 5000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { await fetch(`http://127.0.0.1:${port}/`); return; } catch (e) { await new Promise(r => setTimeout(r, 100)); }
  }
}

async function invoke(method, body) {
  const r = await fetch(`http://127.0.0.1:9000/capsets/test/connect/first-epss-v1-test/first.epss.v1.EpssService/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return r.json();
}

const MOCK_PORT = 19002;
let mockProcess;

test("first__epss-v1 — GetScores returns scores for known CVEs", async (t) => {
  mockProcess = spawn("node", ["test/mock_upstream.js"], {
    cwd: new URL(".", import.meta.url).pathname.replace(/\/test\/$/, ""),
    env: { ...process.env, HTTP_PORT: String(MOCK_PORT) },
    stdio: "pipe",
  });
  await waitPort(MOCK_PORT);

  const r = await invoke("GetScores", { cveIds: ["CVE-2021-44228", "CVE-2022-22965"] });
  deepStrictEqual(r.code, undefined, `unexpected error: ${JSON.stringify(r)}`);
  deepStrictEqual(r.data.length, 2);
  deepStrictEqual(r.data[0].cveId, "CVE-2021-44228");
  deepStrictEqual(typeof r.data[0].epss, "number", "epss must be a number");
  deepStrictEqual(r.data[0].epss > 0, true);
});

test("first__epss-v1 — GetScores returns empty for empty cveIds", async (t) => {
  const r = await invoke("GetScores", { cveIds: [] });
  deepStrictEqual(r.code, undefined);
  deepStrictEqual(r.data.length, 0);
});

test("first__epss-v1 — GetScores rejects non-array cveIds", async (t) => {
  const r = await invoke("GetScores", { cveIds: "not-an-array" });
  deepStrictEqual(r.code, "invalid_argument");
});

test("cleanup", () => { if (mockProcess) mockProcess.kill(); });
