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
  const r = await fetch("http://127.0.0.1:9000/capsets/dev/connect/tophant-xsiem-test/tophant.xsiem.XsiemService/" + method, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return r.json();
}

const XSIEM_PORT = 19005;
let mockProcess;
const MOCK_DIR = new URL(".", import.meta.url).pathname.replace(/\/test\/$/, "");

test("tophant__xsiem — QueryAlerts returns alert list", async () => {
  mockProcess = spawn("node", ["test/mock_upstream.js"], {
    cwd: MOCK_DIR, env: { ...process.env, HTTP_PORT: String(XSIEM_PORT) }, stdio: "pipe",
  });
  await waitPort(XSIEM_PORT);

  const r = await invoke("QueryAlerts", { page: 1, size: 10 });
  deepStrictEqual(r.code, undefined, `unexpected error: ${JSON.stringify(r)}`);
  deepStrictEqual(r.data.length, 3);
  deepStrictEqual(r.data[0].id, "1001");
  deepStrictEqual(r.data[0].alarmName, "Apache Log4j RCE");
});

test("tophant__xsiem — QueryAlerts filters by severity", async () => {
  const r = await invoke("QueryAlerts", { page: 1, size: 10, severity: "highRisk" });
  deepStrictEqual(r.code, undefined);
  deepStrictEqual(r.data.length, 1);
  deepStrictEqual(r.data[0].severity, "highRisk");
});

test("tophant__xsiem — GetAlertDetail returns full detail", async () => {
  const r = await invoke("GetAlertDetail", { id: "1001" });
  deepStrictEqual(r.code, undefined);
  deepStrictEqual(r.alarmName, "Apache Log4j RCE");
  deepStrictEqual(r.ruleId, "rule-001");
  deepStrictEqual(r.attackPhase.length >= 1, true);
  deepStrictEqual(r.alarmTypeName.length >= 1, true);
  deepStrictEqual(r.evtID, "evt-1001");
});

test("tophant__xsiem — GetAlertDetail returns error for missing id", async () => {
  const r = await invoke("GetAlertDetail", { id: "9999" });
  deepStrictEqual(r.code, "invalid_argument");
});

test("tophant__xsiem — AlertAggCount returns count", async () => {
  const r = await invoke("AlertAggCount", { defAggType: 0 });
  deepStrictEqual(r.code, undefined);
  deepStrictEqual(r.count, 3);
});

test("tophant__xsiem — AlertAggDetail returns agg info", async () => {
  const r = await invoke("AlertAggDetail", { aggQueryJson: JSON.stringify({ defAggType: 0 }) });
  deepStrictEqual(r.code, undefined);
  deepStrictEqual(r.alarmCount, 3);
  deepStrictEqual(r.attackerCount, 3);
  deepStrictEqual(r.topKAlarmName.length, 3);
});

test("tophant__xsiem — BatchUpdateAlertStatus succeeds", async () => {
  const r = await invoke("BatchUpdateAlertStatus", { ids: ["1001", "1002"], status: "processed" });
  deepStrictEqual(r.code, undefined);
  deepStrictEqual(r.success, true);
});

test("tophant__xsiem — BatchUpdateAlertStatus rejects empty ids", async () => {
  const r = await invoke("BatchUpdateAlertStatus", { ids: [], status: "processed" });
  deepStrictEqual(r.code, "invalid_argument");
});

test("tophant__xsiem — QueryDevices returns device list", async () => {
  const r = await invoke("QueryDevices", { page: 1, size: 10 });
  deepStrictEqual(r.code, undefined);
  deepStrictEqual(r.total, 2);
  deepStrictEqual(r.items.length, 2);
  deepStrictEqual(r.items[0].name, "核心防火墙");
});

test("tophant__xsiem — QueryCollectors returns collector list", async () => {
  const r = await invoke("QueryCollectors", { page: 1, size: 10 });
  deepStrictEqual(r.code, undefined);
  deepStrictEqual(r.total, 2);
  deepStrictEqual(r.items.length, 2);
  deepStrictEqual(r.items[0].name, "采集器-A");
});

test("tophant__xsiem — QueryAlerts rejects missing size", async () => {
  const r = await invoke("QueryAlerts", { page: 1 });
  deepStrictEqual(r.code, "invalid_argument");
});

test("cleanup", () => { if (mockProcess) { mockProcess.kill(); } });
