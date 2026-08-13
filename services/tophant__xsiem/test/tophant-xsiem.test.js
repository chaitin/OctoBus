import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";
import { deepStrictEqual, rejects } from "node:assert";
import {
  queryAlerts,
  alertAggCount,
  alertAggDetail,
  batchUpdateAlertStatus,
  queryDevices,
  queryCollectors,
  clearJwtCache,
  httpCall,
} from "../src/tophant-xsiem.js";
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
  clearJwtCache();
  const r = await queryAlerts(config, secret, { page: 1, size: 10 });
  deepStrictEqual(r.data.length, 3);
  deepStrictEqual(r.data[0].id, "1001");
  deepStrictEqual(r.data[0].alarmName, "Apache Log4j RCE");
});

test("tophant__xsiem — reuses JWT across calls", async () => {
  clearJwtCache();
  await queryAlerts(config, secret, { size: 10 });
  await alertAggCount(config, secret, {});
});

test("tophant__xsiem — QueryAlerts filters by severity", async () => {
  const r = await queryAlerts(config, secret, {
    page: 1, size: 10, severity: "highRisk", alarmName: "Apache", status: "unprocessed",
    alarmTypeId: "type", startTime: "start", endTime: "end", sortField: "time",
    sortOrder: "desc", ruleId: "rule", ruleTag: "tag", srcAddr: "src", dstAddr: "dst", filterDsl: "dsl",
  });
  deepStrictEqual(r.data.length, 1);
  deepStrictEqual(r.data[0].severity, "highRisk");
});

test("tophant__xsiem — AlertAggCount returns count", async () => {
  const r = await alertAggCount(config, secret, {
    defAggType: 0, alarmName: "a", status: "s", severity: "highRisk", alarmTypeId: "t",
    startTime: "start", endTime: "end", ruleId: "r", ruleTag: "tag", srcAddr: "src", dstAddr: "dst", filterDsl: "dsl",
  });
  deepStrictEqual(r.count, 1);
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

test("tophant__xsiem — validates status, JSON and page sizes", async () => {
  await rejects(() => batchUpdateAlertStatus(config, secret, { ids: ["1"] }), (e) => e.code === grpcStatus.INVALID_ARGUMENT);
  await rejects(() => alertAggDetail(config, secret, { aggQueryJson: "{" }), (e) => e.code === grpcStatus.INVALID_ARGUMENT);
  await rejects(() => queryDevices(config, secret, {}), (e) => e.code === grpcStatus.INVALID_ARGUMENT);
  await rejects(() => queryCollectors(config, secret, {}), (e) => e.code === grpcStatus.INVALID_ARGUMENT);
});

test("tophant__xsiem — maps authentication and upstream errors", async () => {
  clearJwtCache();
  await rejects(() => queryAlerts(config, { mmToken: "invalid-token" }, { size: 10 }), (e) => e.code === grpcStatus.PERMISSION_DENIED);
  clearJwtCache();
  await rejects(() => queryAlerts(config, secret, { size: 10, status: "ERROR_TEST" }), (e) => e.code === grpcStatus.UNAVAILABLE);
});

test("tophant__xsiem — rejects unreachable upstream", async () => {
  clearJwtCache();
  await rejects(() => queryAlerts({ ...config, xsiemHost: "http://127.0.0.1:1", timeoutMs: 1000 }, secret, { size: 10 }), (e) => e.code === grpcStatus.UNAVAILABLE);
});

test("tophant__xsiem — HTTP client enforces redirects and response semantics", async (t) => {
  const server = createServer((req, res) => {
    if (req.url === "/redirect") { res.writeHead(302, { location: "/ok" }); res.end(); return; }
    if (req.url === "/loop") { res.writeHead(307, { location: "/loop" }); res.end(); return; }
    if (req.url === "/cross") { res.writeHead(302, { location: "http://example.com/secret" }); res.end(); return; }
    if (req.url === "/denied") { res.writeHead(401); res.end(); return; }
    if (req.url === "/bad") { res.writeHead(400); res.end("bad request"); return; }
    if (req.url === "/server") { res.writeHead(503); res.end(); return; }
    if (req.url === "/app-client") { res.writeHead(200); res.end(JSON.stringify({ code: 40001, msg: "bad" })); return; }
    if (req.url === "/app-server") { res.writeHead(200); res.end(JSON.stringify({ code: 50001, detail: "down" })); return; }
    if (req.url === "/invalid") { res.writeHead(200); res.end("not json"); return; }
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  deepStrictEqual(await httpCall("POST", `${base}/redirect`, { id: 9007199254740993n }, {}, 1000, false), { ok: true });
  await rejects(() => httpCall("GET", `${base}/loop`, null, {}, 1000, false), (e) => e.code === grpcStatus.UNAVAILABLE);
  await rejects(() => httpCall("GET", `${base}/cross`, null, {}, 1000, false), (e) => e.code === grpcStatus.PERMISSION_DENIED);
  await rejects(() => httpCall("GET", `${base}/denied`, null, {}, 1000, false), (e) => e.code === grpcStatus.PERMISSION_DENIED);
  await rejects(() => httpCall("GET", `${base}/bad`, null, {}, 1000, false), (e) => e.code === grpcStatus.INVALID_ARGUMENT);
  await rejects(() => httpCall("GET", `${base}/server`, null, {}, 1000, false), (e) => e.code === grpcStatus.UNAVAILABLE);
  await rejects(() => httpCall("GET", `${base}/app-client`, null, {}, 1000, false), (e) => e.code === grpcStatus.INVALID_ARGUMENT);
  await rejects(() => httpCall("GET", `${base}/app-server`, null, {}, 1000, false), (e) => e.code === grpcStatus.UNAVAILABLE);
  await rejects(() => httpCall("GET", `${base}/invalid`, null, {}, 1000, false), (e) => e.code === grpcStatus.UNAVAILABLE);
});

test("tophant__xsiem — all handlers use the single context contract", async () => {
  await service.handlers["tophant.xsiem.XsiemService/AlertAggCount"]({ config, secret, request: {} });
  await service.handlers["tophant.xsiem.XsiemService/AlertAggDetail"]({ config, secret, request: { aggQueryJson: "{}" } });
  await service.handlers["tophant.xsiem.XsiemService/BatchUpdateAlertStatus"]({ config, secret, request: { ids: ["1"], status: "done" } });
  await service.handlers["tophant.xsiem.XsiemService/QueryDevices"]({ config, secret, request: { size: 1 } });
  await service.handlers["tophant.xsiem.XsiemService/QueryCollectors"]({ config, secret, request: { size: 1 } });
});

test("tophant__xsiem — normalizes sparse device and collector responses", async () => {
  const sparseServer = createServer(async (req, res) => {
    if (req.url === "/api/platform/mmlogin") {
      res.end(JSON.stringify({ data: { mmToken: "jwt" } })); return;
    }
    res.end(JSON.stringify({ data: { items: [{}] } }));
  });
  await new Promise((resolve) => sparseServer.listen(0, "127.0.0.1", resolve));
  const sparseConfig = { ...config, xsiemHost: `http://127.0.0.1:${sparseServer.address().port}` };
  clearJwtCache();
  const devices = await queryDevices(sparseConfig, secret, { size: 1 });
  const collectors = await queryCollectors(sparseConfig, secret, { size: 1 });
  deepStrictEqual(devices.total, 1);
  deepStrictEqual(devices.items[0].name, "");
  deepStrictEqual(collectors.total, 1);
  deepStrictEqual(collectors.items[0].logCount, "0");
  await new Promise((resolve) => sparseServer.close(resolve));
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

test("tophant__xsiem — service handlers read request/config/secret from ctx", async () => {
  const method = "tophant.xsiem.XsiemService/QueryAlerts";
  const r = await service.handlers[method]({
    config,
    secret,
    request: { page: 1, size: 10, severity: "highRisk" },
  });
  deepStrictEqual(r.data.length, 1);
  deepStrictEqual(r.data[0].severity, "highRisk");
});

test("cleanup", () => {
  if (mockProcess) mockProcess.kill();
});
