import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { grpcStatus } from "@chaitin-ai/octobus-sdk";

import { buildAuthHeaders, handlers, normalizeBaseUrl } from "../src/geyecloud-atd.js";

const assertGrpcError = async (fn, code, message) => {
  await assert.rejects(fn, (err) => {
    assert.equal(err.code, code);
    if (message) assert.match(err.message, message);
    return true;
  });
};

test("normalizeBaseUrl removes UI hash and trailing slash", () => {
  assert.equal(normalizeBaseUrl("https://192.0.2.10:5443/#/workBench"), "https://192.0.2.10:5443");
});

test("normalizeBaseUrl rejects malformed and unsupported URLs", () => {
  assert.throws(
    () => normalizeBaseUrl("not a url"),
    (err) => {
      assert.equal(err.code, grpcStatus.INVALID_ARGUMENT);
      assert.match(err.message, /valid URL/);
      return true;
    },
  );
  assert.throws(
    () => normalizeBaseUrl("ftp://192.0.2.10"),
    (err) => {
      assert.equal(err.code, grpcStatus.INVALID_ARGUMENT);
      assert.match(err.message, /http or https/);
      return true;
    },
  );
});

test("normalizeBaseUrl strips embedded credentials, query, and hash", () => {
  assert.equal(
    normalizeBaseUrl("https://user:pass@192.0.2.10:5443/?token=secret#/workBench"),
    "https://192.0.2.10:5443",
  );
});

test("buildAuthHeaders sends api-key and ATD signature headers", () => {
  const headers = buildAuthHeaders("dummy-api-key", 1774249367000, "nonce-value");
  assert.equal(headers["api-key"], "dummy-api-key");
  assert.equal(headers["user-key"], "");
  assert.equal(headers["X-Ca-Timestamp"], "1774249367000");
  assert.equal(headers["X-Ca-Nonce"], "nonce-value");
  assert.equal(headers["X-Ca-Sign"], crypto.createHash("md5").update("1774249367000nonce-value").digest("hex"));
});

test("buildAuthHeaders rejects an empty API key", () => {
  assert.throws(() => buildAuthHeaders("", 1, "n"), (err) => err.code === grpcStatus.INVALID_ARGUMENT);
});

test("AggregateThreatEvents accepts lowerCamelCase request fields and maps aggregate response", async () => {
  const handler = handlers["geyecloud.atd.v1.GEYECloudATD/AggregateThreatEvents"];
  const calls = [];
  globalThis.__geyeCloudAtdTestRequest = async (url, options) => {
    calls.push({ url, options });
    return {
      statusCode: 200,
      body: JSON.stringify({
        msg: "success",
        code: 200,
        agg: {
          count: 2,
          totalCount: 12,
          list: [
            { key: "high", value: 10 },
            { key: "low", value: 2 }
          ]
        }
      })
    };
  };
  try {
    const result = await handler({
      request: {
        start: 1773644567000,
        end: 1774249367000,
        page: 1,
        pageSize: 10,
        terms: "severity",
        tableName: "hw"
      },
      config: { baseUrl: "https://atd.example.com/#/workBench", skipTlsVerify: true },
      secret: { apiKey: "dummy-api-key" }
    });
    assert.equal(result.code, 200);
    assert.equal(result.count, 2);
    assert.equal(result.total_count, 12);
    assert.equal(result.items[0].key, "high");
    assert.equal(calls[0].url.pathname, "/workbenchApi/furious/elasticSearch/aggregate");
    assert.equal(calls[0].options.headers["api-key"], "dummy-api-key");
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      start: 1773644567000,
      end: 1774249367000,
      from: 1,
      size: 10,
      terms: "severity",
      tableName: "hw"
    });
  } finally {
    delete globalThis.__geyeCloudAtdTestRequest;
  }
});

test("ListFileDetectionLogs maps file detection pagination", async () => {
  const handler = handlers["geyecloud.atd.v1.GEYECloudATD/ListFileDetectionLogs"];
  const calls = [];
  globalThis.__geyeCloudAtdTestRequest = async (url, options) => {
    calls.push({ url, options });
    return {
      statusCode: 200,
      body: JSON.stringify({
        msg: "success",
        code: 200,
        data: {
          total: 1,
          size: 20,
          current: 1,
          page: 1,
          records: [
            {
              timestamp: 1774249367000,
              uuid: "evt-1",
              file_name: "sample.exe",
              file_md5: "44d88612fea8a8f36de82e1278abb02f",
              file_type: "exe",
              file_size: "12KB",
              src_ip: "192.0.2.20",
              dst_ip: "198.51.100.10",
              severity: 3,
              classtype: "恶意文件",
              category: "特洛伊木马通信",
              engine_type: "sandbox",
              sensor_id: 1001
            }
          ]
        }
      })
    };
  };
  try {
    const result = await handler({
      request: {
        start: 1773644567000,
        end: 1774249367000,
        page: 1,
        pageSize: 20,
        isTranslate: "false",
        fileMd5: "44d88612fea8a8f36de82e1278abb02f"
      },
      config: { baseUrl: "https://atd.example.com", skipTlsVerify: true },
      secret: { apiKey: "dummy-api-key" }
    });
    assert.equal(calls[0].url.pathname, "/workbenchApi/furious/fileDetectionLog/list");
    const requestBody = JSON.parse(calls[0].options.body);
    assert.equal(requestBody.fileMd5, "44d88612fea8a8f36de82e1278abb02f");
    assert.equal(requestBody.isTranslate, false);
    assert.equal(result.total, 1);
    assert.equal(result.items[0].file_name, "sample.exe");
  } finally {
    delete globalThis.__geyeCloudAtdTestRequest;
  }
});

test("GetSituationOverview performs readonly dashboard GET calls", async () => {
  const handler = handlers["geyecloud.atd.v1.GEYECloudATD/GetSituationOverview"];
  const calls = [];
  globalThis.__geyeCloudAtdTestRequest = async (url, options) => {
    calls.push({ url, options });
    return {
      statusCode: 200,
      body: JSON.stringify({ msg: "success", code: 200, data: { value: calls.length } })
    };
  };
  try {
    const result = await handler({
      request: {},
      config: { baseUrl: "https://atd.example.com", skipTlsVerify: true },
      secret: { apiKey: "dummy-api-key" }
    });
    assert.equal(calls[0].options.method, "GET");
    assert.equal(calls[0].url.pathname, "/workbenchApi/furious/situationAwareness/security_pyramid/logs_statistics");
    assert.equal(result.sections.length, 5);
    assert.equal(result.sections[0].name, "logs_statistics");
  } finally {
    delete globalThis.__geyeCloudAtdTestRequest;
  }
});

test("SearchThreatEvents maps advanced search response", async () => {
  const handler = handlers["geyecloud.atd.v1.GEYECloudATD/SearchThreatEvents"];
  const calls = [];
  globalThis.__geyeCloudAtdTestRequest = async (url, options) => {
    calls.push({ url, options });
    return {
      statusCode: 200,
      body: JSON.stringify({
        total: 1,
        size: 10,
        current: 1,
        page: 1,
        records: [
          {
            timestamp: 1774249367000,
            uuid: "evt-2",
            severity: "高危",
            category: "特洛伊木马通信",
            classtype: "恶意文件",
            src_ip: "192.0.2.20",
            dst_ip: "198.51.100.10",
            attack_status: "攻击成功",
            kill_chain: "命令控制",
            app_proto: "https",
            sensor_id: 1001,
            event_source: "atd"
          }
        ]
      })
    };
  };
  try {
    const result = await handler({
      request: {
        start: 1773644567000,
        end: 1774249367000,
        tableName: "hw",
        srcIp: "192.0.2.20",
        page: 1,
        pageSize: 10
      },
      config: { baseUrl: "https://atd.example.com", skipTlsVerify: true },
      secret: { apiKey: "dummy-api-key" }
    });
    assert.equal(calls[0].url.pathname, "/workbenchApi/furious/searchCenter/advanced/searchData");
    assert.equal(JSON.parse(calls[0].options.body).src_ip, "192.0.2.20");
    assert.equal(result.total, 1);
    assert.equal(result.items[0].kill_chain, "命令控制");
    assert.equal(result.items[0].severity_text, "高危");
  } finally {
    delete globalThis.__geyeCloudAtdTestRequest;
  }
});

test("ListSceneMonitors maps unwrapped scene monitor pagination", async () => {
  const handler = handlers["geyecloud.atd.v1.GEYECloudATD/ListSceneMonitors"];
  globalThis.__geyeCloudAtdTestRequest = async () => ({
    statusCode: 200,
    body: JSON.stringify({
      total: 1,
      size: 1,
      current: 1,
      page: 1,
      records: [{ monitorId: 1, monitorName: "test" }]
    })
  });
  try {
    const result = await handler({
      request: { page: 1, pageSize: 1 },
      config: { baseUrl: "https://atd.example.com", skipTlsVerify: true },
      secret: { apiKey: "dummy-api-key" }
    });
    assert.equal(result.total, 1);
    assert.equal(JSON.parse(result.items[0].raw_json).monitorId, 1);
  } finally {
    delete globalThis.__geyeCloudAtdTestRequest;
  }
});

test("GetNetworkLogDetail sends detail id as upstream uuid", async () => {
  const handler = handlers["geyecloud.atd.v1.GEYECloudATD/GetNetworkLogDetail"];
  const calls = [];
  globalThis.__geyeCloudAtdTestRequest = async (url, options) => {
    calls.push({ url, options });
    return {
      statusCode: 200,
      body: JSON.stringify({
        msg: "success",
        code: 200,
        data: {
          uuid: "net-1",
          uid: "net-1",
          timestamp: 1774249367000,
          src_ip: "192.0.2.20",
          dst_ip: "198.51.100.10"
        }
      })
    };
  };
  try {
    const result = await handler({
      request: {
        detailId: "net-1",
        queryTimestamp: 1774249367000,
        start: 1773644567000,
        end: 1774249367000
      },
      config: { baseUrl: "https://atd.example.com", skipTlsVerify: true },
      secret: { apiKey: "dummy-api-key" }
    });
    assert.equal(calls[0].url.pathname, "/workbenchApi/furious/netWorkLog/details");
    assert.equal(JSON.parse(calls[0].options.body).uuid, "net-1");
    assert.equal(JSON.parse(calls[0].options.body).detailId, undefined);
    assert.equal(result.log.uid, "net-1");
  } finally {
    delete globalThis.__geyeCloudAtdTestRequest;
  }
});

test("remaining read handlers validate, send filters, and map successful responses", async () => {
  const calls = [];
  globalThis.__geyeCloudAtdTestRequest = async (url, options) => {
    calls.push({ url, body: options.body && JSON.parse(options.body) });
    const path = url.pathname;
    if (path.endsWith("/timeTrend")) return { statusCode: 200, body: JSON.stringify({ code: 200, msg: "success", data: [{ timestamp: 1, time: "now", count: 2 }] }) };
    if (path.endsWith("/dimensionStatistics")) return { statusCode: 200, body: JSON.stringify({ code: 200, msg: "success", data: [{ key: "k", name: "n", value: 3, count: 4 }] }) };
    if (path.endsWith("/netWorkLog/list")) return { statusCode: 200, body: JSON.stringify({ code: 200, msg: "success", data: { total: 1, size: 20, current: 1, page: 1, records: [{ uuid: "n1", src_port: 1, dst_port: 2 }] } }) };
    if (path.endsWith("/fileDetectionLog/details")) return { statusCode: 200, body: JSON.stringify({ code: 200, msg: "success", data: { uuid: "f1", file_name: "a.exe", severity: 3 } }) };
    if (path.endsWith("/severityNumber")) return { statusCode: 200, body: JSON.stringify({ code: 200, msg: "success", data: { total: 5, danger: 1, high: 1, middle: 1, low: 1, safe: 1 } }) };
    if (path.endsWith("/searchFromMonitor")) return { statusCode: 200, body: JSON.stringify({ code: 200, msg: "success", data: { total: 1, records: [{ uuid: "e1", severity: 2 }] } }) };
    if (path.endsWith("/searchDataDetail")) return { statusCode: 200, body: JSON.stringify({ code: 200, msg: "success", data: { uuid: "e2", severity: 3 } }) };
    throw new Error(`unexpected ${path}`);
  };
  const ctx = (request) => ({ request, config: { baseUrl: "https://atd.example.com" }, secret: { apiKey: "key" } });
  try {
    const range = { start: 1, end: 2 };
    assert.equal((await handlers["geyecloud.atd.v1.GEYECloudATD/GetNetworkLogTimeTrend"](ctx(range))).items[0].count, 2);
    assert.equal((await handlers["geyecloud.atd.v1.GEYECloudATD/GetNetworkLogDimensionStatistics"](ctx({ ...range, dimensionKey: "srcIp" }))).items[0].value, 3);
    assert.equal((await handlers["geyecloud.atd.v1.GEYECloudATD/ListNetworkLogs"](ctx({ ...range, isTranslate: "yes", srcPort: 443 }))).items[0].uid, "n1");
    assert.equal((await handlers["geyecloud.atd.v1.GEYECloudATD/GetFileDetectionLogDetail"](ctx({ detailId: "f1", queryTimestamp: 2, fileMd5: "abc" }))).log.file_name, "a.exe");
    assert.equal((await handlers["geyecloud.atd.v1.GEYECloudATD/GetFileDetectionSeverityStats"](ctx(range))).total, 5);
    assert.equal((await handlers["geyecloud.atd.v1.GEYECloudATD/SearchSceneMonitorEvents"](ctx({ sceneId: 1 }))).items[0].uuid, "e1");
    assert.equal((await handlers["geyecloud.atd.v1.GEYECloudATD/GetThreatEventDetail"](ctx({ uuid: "e2", sensorId: "s1" }))).event.uuid, "e2");
    assert.equal(calls.length, 7);
  } finally { delete globalThis.__geyeCloudAtdTestRequest; }
});

test("required request fields and credentials are rejected before upstream calls", async () => {
  const aggregate = handlers["geyecloud.atd.v1.GEYECloudATD/AggregateThreatEvents"];
  await assertGrpcError(() => aggregate({ request: { start: 0, end: 2, terms: "x" }, config: { baseUrl: "https://atd.example.com" }, secret: { apiKey: "key" } }), grpcStatus.INVALID_ARGUMENT, /start/);
  await assertGrpcError(() => aggregate({ request: { start: 1, end: 2 }, config: { baseUrl: "https://atd.example.com" }, secret: { apiKey: "key" } }), grpcStatus.INVALID_ARGUMENT, /terms/);
  await assertGrpcError(() => aggregate({ request: { start: 1, end: 2, terms: "x" }, config: { baseUrl: "https://atd.example.com" }, secret: {} }), grpcStatus.INVALID_ARGUMENT, /apiKey/);
  await assertGrpcError(() => handlers["geyecloud.atd.v1.GEYECloudATD/SearchSceneMonitorEvents"]({ request: { sceneId: 0 }, config: { baseUrl: "https://atd.example.com" }, secret: { apiKey: "key" } }), grpcStatus.INVALID_ARGUMENT, /scene_id/);
});

test("boolean, numeric defaults, alternate envelopes, and upstream error codes are handled", async () => {
  const list = handlers["geyecloud.atd.v1.GEYECloudATD/ListNetworkLogs"];
  const search = handlers["geyecloud.atd.v1.GEYECloudATD/SearchThreatEvents"];
  const requestBodies = [];
  globalThis.__geyeCloudAtdTestRequest = async (_url, options) => {
    requestBodies.push(JSON.parse(options.body));
    return { statusCode: 200, body: JSON.stringify({ code: 200, msg: "success", data: { total: "bad", records: [] } }) };
  };
  const base = { config: { host: "http://atd.example.com", timeoutMs: -1, insecureSkipVerify: true }, secret: { apiKey: "key" } };
  try {
    await list({ ...base, req: { startTime: 1, endTime: 2, isTranslate: "0", pageNo: "bad", size: "bad" } });
    await list({ ...base, req: { start: 1, end: 2, isTranslate: "true" } });
    await search({ ...base, req: { start: 1, end: 2, severity: "high", order: "asc" } });
    assert.equal(requestBodies[0].isTranslate, false);
    assert.equal(requestBodies[1].isTranslate, true);
    assert.equal(requestBodies[2].order, "asc");
  } finally { delete globalThis.__geyeCloudAtdTestRequest; }

  const aggregate = handlers["geyecloud.atd.v1.GEYECloudATD/AggregateThreatEvents"];
  for (const [code, expected] of [[401, grpcStatus.UNAUTHENTICATED], [403, grpcStatus.PERMISSION_DENIED], [404, grpcStatus.NOT_FOUND], [500, grpcStatus.UNAVAILABLE], [9, grpcStatus.UNKNOWN]]) {
    globalThis.__geyeCloudAtdTestRequest = async () => ({ statusCode: 200, body: JSON.stringify({ code, msg: "failed" }) });
    await assertGrpcError(() => aggregate({ request: { start: 1, end: 2, terms: "x" }, config: { baseUrl: "https://atd.example.com" }, secret: { apiKey: "key" } }), expected, /failed/);
  }
  delete globalThis.__geyeCloudAtdTestRequest;
});

test("complete network, file, and threat records are mapped without dropping fields", async () => {
  let response;
  globalThis.__geyeCloudAtdTestRequest = async () => ({ statusCode: 200, body: JSON.stringify(response) });
  const ctx = (request) => ({ request, config: { baseUrl: "https://atd.example.com" }, secret: { apiKey: "key" } });
  try {
    response = { code: 200, msg: "success", data: { total: 1, size: 1, current: 1, page: 1, records: [{ timestamp: 1, uid: "u", src_ip: "a", src_port: 1, dst_ip: "b", dst_port: 2, app_proto: "http", host: "h", uri: "/", proto: "tcp", bytes: 3, packets: 4, sensor_id: 5 }] } };
    const network = await handlers["geyecloud.atd.v1.GEYECloudATD/ListNetworkLogs"](ctx({ start: 1, end: 2, srcIp: "a", dstIp: "b", appProto: "http", host: "h", queryString: "q", filterQueryString: "f", dstPort: 2, uri: "/", uid: "u", uuid: "x", sort: "timestamp" }));
    assert.equal(network.items[0].packets, 4);
    response = { code: 200, msg: "success", data: { total: 1, records: [{ timestamp: 1, uuid: "f", file_name: "n", file_md5: "m", file_type: "exe", file_size: "1", src_ip: "a", dst_ip: "b", severity: 2, classtype: "c", category: "g", engine_type: "e", sensor_id: 3 }] } };
    const file = await handlers["geyecloud.atd.v1.GEYECloudATD/ListFileDetectionLogs"](ctx({ start: 1, end: 2, emailFrom: "x@y", srcIp: "a", dstIp: "b", appProto: "smtp", host: "h", queryString: "q", filterQueryString: "f", fileType: "exe" }));
    assert.equal(file.items[0].engine_type, "e");
    response = { code: 200, msg: "success", data: { total: 1, records: [{ timestamp: 1, uuid: "t", severity: 2, severity_text: "high", category: "g", classtype: "c", src_ip: "a", dst_ip: "b", attack_status: "ok", kill_chain: "k", app_proto: "http", sensor_id: 3, event_source: "s" }] } };
    const threat = await handlers["geyecloud.atd.v1.GEYECloudATD/SearchThreatEvents"](ctx({ start: 1, end: 2, category: "g", classtype: "c", dstIp: "b", attackStatus: "ok", appProto: "http", sensorId: "3", visitDirection: "in", appendQuery: "a", quickQuery: "q", filterQuery: "f", filterString: "s", orderBy: "timestamp" }));
    assert.equal(threat.items[0].event_source, "s");
  } finally { delete globalThis.__geyeCloudAtdTestRequest; }
});

test("successful sparse responses receive stable protobuf defaults", async () => {
  globalThis.__geyeCloudAtdTestRequest = async (url) => {
    const pagination = url.pathname.includes("/list") || url.pathname.includes("searchData") || url.pathname.includes("searchFromMonitor");
    return { statusCode: 200, body: JSON.stringify(pagination ? { records: [] } : { code: 200, msg: "success" }) };
  };
  const ctx = (request) => ({ request, config: { baseUrl: "https://atd.example.com" }, secret: { apiKey: "key" } });
  try {
    const agg = await handlers["geyecloud.atd.v1.GEYECloudATD/AggregateThreatEvents"](ctx({ start: 1, end: 2, terms: "x" }));
    assert.deepEqual(agg.items, []);
    const trend = await handlers["geyecloud.atd.v1.GEYECloudATD/GetNetworkLogTimeTrend"](ctx({ start: 1, end: 2 }));
    assert.deepEqual(trend.items, []);
    const dim = await handlers["geyecloud.atd.v1.GEYECloudATD/GetNetworkLogDimensionStatistics"](ctx({ start: 1, end: 2, dimensionKey: "src" }));
    assert.deepEqual(dim.items, []);
    const detail = await handlers["geyecloud.atd.v1.GEYECloudATD/GetNetworkLogDetail"](ctx({ detailId: "x", queryTimestamp: 1 }));
    assert.equal(detail.log.uid, "");
    const fileDetail = await handlers["geyecloud.atd.v1.GEYECloudATD/GetFileDetectionLogDetail"](ctx({ detailId: "x", queryTimestamp: 1 }));
    assert.equal(fileDetail.log.uuid, "");
    const stats = await handlers["geyecloud.atd.v1.GEYECloudATD/GetFileDetectionSeverityStats"](ctx({ start: 1, end: 2 }));
    assert.equal(stats.total, 0);
    const event = await handlers["geyecloud.atd.v1.GEYECloudATD/GetThreatEventDetail"](ctx({ uuid: "x" }));
    assert.equal(event.event.uuid, "");
  } finally { delete globalThis.__geyeCloudAtdTestRequest; }
});

test("validation rejects blank URLs, timestamps, identifiers, and dimensions", async () => {
  assert.throws(() => normalizeBaseUrl("  "), (err) => err.code === grpcStatus.INVALID_ARGUMENT);
  const ctx = (request) => ({ request, config: { baseUrl: "https://atd.example.com" }, secret: { apiKey: "key" } });
  await assertGrpcError(() => handlers["geyecloud.atd.v1.GEYECloudATD/GetNetworkLogTimeTrend"](ctx({ start: "bad", end: 2 })), grpcStatus.INVALID_ARGUMENT, /start/);
  await assertGrpcError(() => handlers["geyecloud.atd.v1.GEYECloudATD/GetNetworkLogDimensionStatistics"](ctx({ start: 1, end: 2, dimensionKey: "" })), grpcStatus.INVALID_ARGUMENT, /dimension_key/);
  await assertGrpcError(() => handlers["geyecloud.atd.v1.GEYECloudATD/GetNetworkLogDetail"](ctx({ detailId: "", queryTimestamp: 1 })), grpcStatus.INVALID_ARGUMENT, /detail_id/);
  await assertGrpcError(() => handlers["geyecloud.atd.v1.GEYECloudATD/GetFileDetectionLogDetail"](ctx({ detailId: "x", queryTimestamp: -1 })), grpcStatus.INVALID_ARGUMENT, /query_timestamp/);
  await assertGrpcError(() => handlers["geyecloud.atd.v1.GEYECloudATD/GetThreatEventDetail"](ctx({ uuid: "" })), grpcStatus.INVALID_ARGUMENT, /uuid/);
});

test("alternate scene envelope and empty responses are normalized", async () => {
  const scene = handlers["geyecloud.atd.v1.GEYECloudATD/ListSceneMonitors"];
  globalThis.__geyeCloudAtdTestRequest = async () => ({ statusCode: 200, body: JSON.stringify({ code: 200, msg: "success", data: { data: { total: 2, records: [{ id: 1 }] } } }) });
  try {
    const nested = await scene({ request: { name: "n", sceneType: 1, startTime: 1, endTime: 2, indexName: "i", userName: "u" }, config: { baseUrl: "https://atd.example.com" }, secret: { apiKey: "key" } });
    assert.equal(nested.total, 2);
    assert.equal(nested.items.length, 1);
    globalThis.__geyeCloudAtdTestRequest = async () => ({ statusCode: 200, body: JSON.stringify({ code: 200, msg: "success", data: {} }) });
    const empty = await scene({ request: {}, config: { baseUrl: "https://atd.example.com" }, secret: { apiKey: "key" } });
    assert.deepEqual(empty.items, []);
  } finally { delete globalThis.__geyeCloudAtdTestRequest; }
});

test("scene filters accept canonical id and table fields", async () => {
  let body;
  globalThis.__geyeCloudAtdTestRequest = async (_url, options) => { body = JSON.parse(options.body); return { statusCode: 200, body: JSON.stringify({ code: 200, msg: "success", data: { records: [] } }) }; };
  try {
    await handlers["geyecloud.atd.v1.GEYECloudATD/ListSceneMonitors"]({ request: { id: 7, type: 2, tableName: "hw" }, config: { baseUrl: "https://atd.example.com" }, secret: { apiKey: "key" } });
    assert.equal(body.id, 7);
    assert.equal(body.type, 2);
    assert.equal(body.tableName, "hw");
  } finally { delete globalThis.__geyeCloudAtdTestRequest; }
});

test("boolean request values remain boolean", async () => {
  let body;
  globalThis.__geyeCloudAtdTestRequest = async (_url, options) => { body = JSON.parse(options.body); return { statusCode: 200, body: JSON.stringify({ code: 200, msg: "success", data: { records: [] } }) }; };
  try {
    await handlers["geyecloud.atd.v1.GEYECloudATD/ListNetworkLogs"]({ request: { start: 1, end: 2, isTranslate: true }, config: { baseUrl: "https://atd.example.com" }, secret: { apiKey: "key" } });
    assert.equal(body.isTranslate, true);
  } finally { delete globalThis.__geyeCloudAtdTestRequest; }
});

test("upstream HTTP errors are mapped to unavailable", async () => {
  const handler = handlers["geyecloud.atd.v1.GEYECloudATD/AggregateThreatEvents"];
  globalThis.__geyeCloudAtdTestRequest = async () => ({
    statusCode: 503,
    body: "service unavailable",
  });
  try {
    await assertGrpcError(
      () =>
        handler({
          request: { start: 1773644567000, end: 1774249367000, terms: "severity" },
          config: { baseUrl: "https://atd.example.com" },
          secret: { apiKey: "dummy-api-key" },
        }),
      grpcStatus.UNAVAILABLE,
      /upstream http 503/,
    );
  } finally {
    delete globalThis.__geyeCloudAtdTestRequest;
  }
});

test("invalid JSON upstream responses are mapped to unknown", async () => {
  const handler = handlers["geyecloud.atd.v1.GEYECloudATD/AggregateThreatEvents"];
  globalThis.__geyeCloudAtdTestRequest = async () => ({
    statusCode: 200,
    body: "<html>not json</html>",
  });
  try {
    await assertGrpcError(
      () =>
        handler({
          request: { start: 1773644567000, end: 1774249367000, terms: "severity" },
          config: { baseUrl: "https://atd.example.com" },
          secret: { apiKey: "dummy-api-key" },
        }),
      grpcStatus.UNKNOWN,
      /not valid JSON/,
    );
  } finally {
    delete globalThis.__geyeCloudAtdTestRequest;
  }
});

test("network exceptions are mapped to unavailable", async () => {
  const handler = handlers["geyecloud.atd.v1.GEYECloudATD/AggregateThreatEvents"];
  globalThis.__geyeCloudAtdTestRequest = async () => {
    throw new Error("request timeout");
  };
  try {
    await assertGrpcError(
      () =>
        handler({
          request: { start: 1773644567000, end: 1774249367000, terms: "severity" },
          config: { baseUrl: "https://atd.example.com" },
          secret: { apiKey: "dummy-api-key" },
        }),
      grpcStatus.UNAVAILABLE,
      /request timeout/,
    );
  } finally {
    delete globalThis.__geyeCloudAtdTestRequest;
  }
});

test("upstream application errors are mapped to grpc statuses", async () => {
  const handler = handlers["geyecloud.atd.v1.GEYECloudATD/AggregateThreatEvents"];
  const cases = [
    [401, grpcStatus.UNAUTHENTICATED],
    [403, grpcStatus.PERMISSION_DENIED],
    [404, grpcStatus.NOT_FOUND],
    [500, grpcStatus.UNAVAILABLE],
  ];

  for (const [upstreamCode, grpcCode] of cases) {
    globalThis.__geyeCloudAtdTestRequest = async () => ({
      statusCode: 200,
      body: JSON.stringify({ code: upstreamCode, msg: `error ${upstreamCode}` }),
    });
    await assertGrpcError(
      () =>
        handler({
          request: { start: 1773644567000, end: 1774249367000, terms: "severity" },
          config: { baseUrl: "https://atd.example.com" },
          secret: { apiKey: "dummy-api-key" },
        }),
      grpcCode,
      new RegExp(`error ${upstreamCode}`),
    );
  }

  delete globalThis.__geyeCloudAtdTestRequest;
});
