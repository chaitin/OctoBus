import { spawn } from "node:child_process";
import { test } from "node:test";
import { deepStrictEqual } from "node:assert";
import {
  queryAlerts,
  alertAggCount,
  alertAggDetail,
  batchUpdateAlertStatus,
  queryDevices,
  queryCollectors,
} from "../src/tophant-xsiem.js";
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

const XSIEM_PORT = 19005;
let mockProcess;
const MOCK_DIR = new URL(".", import.meta.url).pathname.replace(/\/test\/$/, "");
const config = {
  xsiemHost: `http://127.0.0.1:${XSIEM_PORT}`,
  timeoutMs: 30000,
  insecure: false,
};
const secret = { mmToken: "test-mock-token" };

test("setup mock upstream", async () => {
  mockProcess = spawn("node", ["test/mock_upstream.js"], {
    cwd: MOCK_DIR,
    env: { ...process.env, HTTP_PORT: String(XSIEM_PORT) },
    stdio: "pipe",
  });
  await waitPort(XSIEM_PORT);
});

test("tophant__xsiem — QueryAlerts returns alert list", async () => {
  const r = await queryAlerts(config, secret, { page: 1, size: 10 });
  deepStrictEqual(r.data.length, 3);
  deepStrictEqual(r.data[0].id, "1001");
  deepStrictEqual(r.data[0].alarmName, "Apache Log4j RCE");
});

test("tophant__xsiem — QueryAlerts filters by severity", async () => {
  const r = await queryAlerts(config, secret, { page: 1, size: 10, severity: "highRisk" });
  deepStrictEqual(r.data.length, 1);
  deepStrictEqual(r.data[0].severity, "highRisk");
});

test("tophant__xsiem — AlertAggCount returns count", async () => {
  const r = await alertAggCount(config, secret, { defAggType: 0 });
  deepStrictEqual(r.count, 3);
});

test("tophant__xsiem — AlertAggDetail returns agg info", async () => {
  const r = await alertAggDetail(config, secret, { aggQueryJson: JSON.stringify({ defAggType: 0 }) });
  deepStrictEqual(r.alarmCount, 3);
  deepStrictEqual(r.attackerCount, 3);
  deepStrictEqual(r.topKAlarmName.length, 3);
});

test("tophant__xsiem — BatchUpdateAlertStatus succeeds", async () => {
  const r = await batchUpdateAlertStatus(config, secret, { ids: ["1001", "1002"], status: "processed" });
  deepStrictEqual(r.success, true);
});

test("tophant__xsiem — BatchUpdateAlertStatus rejects empty ids", async () => {
  let err;
  try {
    await batchUpdateAlertStatus(config, secret, { ids: [], status: "processed" });
  } catch (e) {
    err = e;
  }
  deepStrictEqual(err instanceof GrpcError, true);
  deepStrictEqual(err.code, grpcStatus.INVALID_ARGUMENT);
});

test("tophant__xsiem — QueryDevices returns device list", async () => {
  const r = await queryDevices(config, secret, { page: 1, size: 10 });
  deepStrictEqual(r.total, 2);
  deepStrictEqual(r.items.length, 2);
  deepStrictEqual(r.items[0].name, "核心防火墙");
});

test("tophant__xsiem — QueryCollectors returns collector list", async () => {
  const r = await queryCollectors(config, secret, { page: 1, size: 10 });
  deepStrictEqual(r.total, 2);
  deepStrictEqual(r.items.length, 2);
  deepStrictEqual(r.items[0].name, "采集器-A");
});

test("tophant__xsiem — QueryAlerts rejects missing size", async () => {
  let err;
  try {
    await queryAlerts(config, secret, { page: 1 });
  } catch (e) {
    err = e;
  }
  deepStrictEqual(err instanceof GrpcError, true);
  deepStrictEqual(err.code, grpcStatus.INVALID_ARGUMENT);
});

test("cleanup", () => {
  if (mockProcess) mockProcess.kill();
});

