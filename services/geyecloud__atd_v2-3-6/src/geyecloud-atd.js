import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

const API_PREFIX = "/workbenchApi/furious";
const DEFAULT_TIMEOUT_MS = 10_000;

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");

const getReq = (ctx) => ctx?.request ?? ctx?.req ?? {};

const mergedBindings = (ctx = {}) => ({
  ...(ctx.config ?? {}),
  ...(ctx.secret ?? {}),
  ...(ctx.bindings ?? {}),
});

const toTrimmedString = (value) => {
  if (value === undefined || value === null) return "";
  return String(value).trim();
};

const toInt = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
};

const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "no"].includes(normalized)) return false;
    if (["true", "1", "yes"].includes(normalized)) return true;
  }
  return Boolean(value);
};

const requireString = (value, field) => {
  const str = toTrimmedString(value);
  if (!str) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, `${field} is required`);
  return str;
};

const requireInt64 = (value, field) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new GrpcError(grpcStatus.INVALID_ARGUMENT, `${field} must be a positive millisecond timestamp`);
  }
  return Math.trunc(number);
};

const requirePositiveInteger = (value, field) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new GrpcError(grpcStatus.INVALID_ARGUMENT, `${field} must be a positive integer`);
  }
  return Math.trunc(number);
};

export const normalizeBaseUrl = (value) => {
  const baseUrl = requireString(value, "config.baseUrl");
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "config.baseUrl is not a valid URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "config.baseUrl must use http or https");
  }
  parsed.username = "";
  parsed.password = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
};

const resolveTimeoutMs = (bindings = {}) => {
  const raw = Number(bindings.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

const shouldSkipTlsVerify = (bindings = {}) =>
  Boolean(bindings.skipTlsVerify ?? bindings.tlsInsecureSkipVerify ?? bindings.insecureSkipVerify);

export const buildAuthHeaders = (apiKey, timestamp = Date.now(), nonce = crypto.randomUUID()) => {
  const timestampText = String(timestamp);
  return {
    "Content-Type": "application/json",
    "api-key": requireString(apiKey, "secret.apiKey"),
    "user-key": "",
    "X-Ca-Timestamp": timestampText,
    "X-Ca-Nonce": nonce,
    "X-Ca-Sign": crypto.createHash("md5").update(`${timestampText}${nonce}`).digest("hex"),
  };
};

const buildUrl = (baseUrl, path) => new URL(`${baseUrl}${API_PREFIX}${path}`);

const httpRequest = (url, options, bindings) =>
  new Promise((resolve, reject) => {
    if (typeof globalThis.__geyeCloudAtdTestRequest === "function") {
      Promise.resolve(globalThis.__geyeCloudAtdTestRequest(url, options, bindings)).then(resolve, reject);
      return;
    }
    const body = options.body ? Buffer.from(options.body) : undefined;
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(
      url,
      {
        method: options.method,
        headers: {
          ...options.headers,
          ...(body ? { "Content-Length": String(body.length) } : {}),
        },
        rejectUnauthorized: !shouldSkipTlsVerify(bindings),
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 500,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(resolveTimeoutMs(bindings), () => {
      req.destroy(new Error("request timeout"));
    });
    if (body) req.write(body);
    req.end();
  });

const mapUpstreamError = (json) => {
  const code = toInt(json?.code, 0);
  const message = json?.msg || json?.message || `upstream returned code ${code}`;
  if ([401, 40101, 40102, 40203, 40204].includes(code)) {
    return new GrpcError(grpcStatus.UNAUTHENTICATED, message);
  }
  if ([403, 40201, 40205].includes(code)) {
    return new GrpcError(grpcStatus.PERMISSION_DENIED, message);
  }
  if (code === 404) return new GrpcError(grpcStatus.NOT_FOUND, message);
  if (code >= 500) return new GrpcError(grpcStatus.UNAVAILABLE, message);
  return new GrpcError(grpcStatus.UNKNOWN, message);
};

const looksLikePagination = (json) =>
  Boolean(json && typeof json === "object" && (Array.isArray(json.records) || json.total !== undefined));

const normalizeSuccessEnvelope = (json) => {
  if (looksLikePagination(json)) {
    return {
      msg: json.msg ?? "success",
      code: toInt(json.code, 200),
      data: json,
    };
  }
  if (looksLikePagination(json?.data)) return json;
  return json;
};

const callAtd = async (ctx, path, body, requestOptions = {}) => {
  const bindings = mergedBindings(ctx);
  const baseUrl = normalizeBaseUrl(bindings.baseUrl ?? bindings.host);
  const apiKey = requireString(bindings.apiKey, "secret.apiKey");
  const method = requestOptions.method ?? "POST";
  let response;
  try {
    response = await httpRequest(
      buildUrl(baseUrl, path),
      {
        method,
        headers: buildAuthHeaders(apiKey),
        body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
      },
      bindings,
    );
  } catch (err) {
    throw new GrpcError(grpcStatus.UNAVAILABLE, err?.message || "upstream request failed");
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new GrpcError(grpcStatus.UNAVAILABLE, `upstream http ${response.statusCode}`);
  }

  let json;
  try {
    json = JSON.parse(response.body);
  } catch {
    throw new GrpcError(grpcStatus.UNKNOWN, "upstream response is not valid JSON");
  }

  const normalized = normalizeSuccessEnvelope(json);
  if (toInt(normalized.code, 0) !== 200 || (normalized.msg && normalized.msg !== "success")) {
    throw mapUpstreamError(json);
  }
  return normalized;
};

const baseTimeRange = (req) => ({
  start: requireInt64(firstDefined(req.start, req.startTime), "start"),
  end: requireInt64(firstDefined(req.end, req.endTime), "end"),
});

const addOptional = (target, pairs) => {
  for (const [key, value] of pairs) {
    if (value !== undefined && value !== null && value !== "") target[key] = value;
  }
  return target;
};

const networkLogFilters = (req) =>
  addOptional(baseTimeRange(req), [
    ["srcIp", toTrimmedString(firstDefined(req.src_ip, req.srcIp))],
    ["dstIp", toTrimmedString(firstDefined(req.dst_ip, req.dstIp))],
    ["appProto", toTrimmedString(firstDefined(req.app_proto, req.appProto))],
    ["host", toTrimmedString(req.host)],
    ["queryString", toTrimmedString(firstDefined(req.query_string, req.queryString))],
    ["filterQueryString", toTrimmedString(firstDefined(req.filter_query_string, req.filterQueryString))],
  ]);

const fileDetectionFilters = (req) =>
  addOptional(baseTimeRange(req), [
    ["fileMd5", toTrimmedString(firstDefined(req.file_md5, req.fileMd5))],
    ["emailFrom", toTrimmedString(firstDefined(req.email_from, req.emailFrom))],
    ["srcIp", toTrimmedString(firstDefined(req.src_ip, req.srcIp))],
    ["dstIp", toTrimmedString(firstDefined(req.dst_ip, req.dstIp))],
    ["appProto", toTrimmedString(firstDefined(req.app_proto, req.appProto))],
    ["host", toTrimmedString(req.host)],
    ["queryString", toTrimmedString(firstDefined(req.query_string, req.queryString))],
    ["filterQueryString", toTrimmedString(firstDefined(req.filter_query_string, req.filterQueryString))],
    ["fileType", toTrimmedString(firstDefined(req.file_type, req.fileType))],
  ]);

const mapNetworkLog = (item = {}) => ({
  timestamp: toInt(item.timestamp, 0),
  uid: toTrimmedString(firstDefined(item.uid, item.uuid)),
  src_ip: toTrimmedString(item.src_ip),
  src_port: toInt(item.src_port, 0),
  dst_ip: toTrimmedString(item.dst_ip),
  dst_port: toInt(item.dst_port, 0),
  app_proto: toTrimmedString(item.app_proto),
  host: toTrimmedString(item.host),
  uri: toTrimmedString(item.uri),
  proto: toTrimmedString(item.proto),
  bytes: toInt(item.bytes, 0),
  packets: toInt(item.packets, 0),
  sensor_id: toInt(item.sensor_id, 0),
});

const mapFileDetectionLog = (item = {}) => ({
  timestamp: toInt(item.timestamp, 0),
  uuid: toTrimmedString(item.uuid),
  file_name: toTrimmedString(item.file_name),
  file_md5: toTrimmedString(item.file_md5),
  file_type: toTrimmedString(item.file_type),
  file_size: toTrimmedString(item.file_size),
  src_ip: toTrimmedString(item.src_ip),
  dst_ip: toTrimmedString(item.dst_ip),
  severity: toInt(item.severity, 0),
  classtype: toTrimmedString(item.classtype),
  category: toTrimmedString(item.category),
  engine_type: toTrimmedString(item.engine_type),
  sensor_id: toInt(item.sensor_id, 0),
});

const mapThreatEvent = (item = {}) => ({
  timestamp: toInt(item.timestamp, 0),
  uuid: toTrimmedString(item.uuid),
  severity: toInt(item.severity, 0),
  severity_text: typeof item.severity === "string" ? toTrimmedString(item.severity) : toTrimmedString(item.severity_text),
  category: toTrimmedString(item.category),
  classtype: toTrimmedString(item.classtype),
  src_ip: toTrimmedString(item.src_ip),
  dst_ip: toTrimmedString(item.dst_ip),
  attack_status: toTrimmedString(item.attack_status),
  kill_chain: toTrimmedString(item.kill_chain),
  app_proto: toTrimmedString(item.app_proto),
  sensor_id: toInt(item.sensor_id, 0),
  event_source: toTrimmedString(item.event_source),
});

const pagedResponse = (json, mapper) => {
  const data = looksLikePagination(json) ? json : json.data ?? {};
  return {
    code: toInt(json.code, 200),
    message: json.msg ?? "success",
    total: toInt(data.total, 0),
    page_size: toInt(data.size, 0),
    current: toInt(data.current, 0),
    pages: toInt(data.page, 0),
    items: Array.isArray(data.records) ? data.records.map(mapper) : [],
  };
};

const advancedThreatFilters = (req, { requireTimeRange = true } = {}) =>
  addOptional(requireTimeRange ? baseTimeRange(req) : {}, [
    ["tableName", toTrimmedString(firstDefined(req.table_name, req.tableName)) || "hw"],
    ["from", toInt(firstDefined(req.page, req.from), 1)],
    ["size", toInt(firstDefined(req.page_size, req.pageSize, req.size), 20)],
    ["severity", toTrimmedString(req.severity)],
    ["category", toTrimmedString(req.category)],
    ["classtype", toTrimmedString(req.classtype)],
    ["src_ip", toTrimmedString(firstDefined(req.src_ip, req.srcIp))],
    ["dst_ip", toTrimmedString(firstDefined(req.dst_ip, req.dstIp))],
    ["attack_status", toTrimmedString(firstDefined(req.attack_status, req.attackStatus))],
    ["app_proto", toTrimmedString(firstDefined(req.app_proto, req.appProto))],
    ["sensor_id", toTrimmedString(firstDefined(req.sensor_id, req.sensorId))],
    ["visit_direction", toTrimmedString(firstDefined(req.visit_direction, req.visitDirection))],
    ["appendQuery", toTrimmedString(firstDefined(req.append_query, req.appendQuery))],
    ["quickQuery", toTrimmedString(firstDefined(req.quick_query, req.quickQuery))],
    ["filterQuery", toTrimmedString(firstDefined(req.filter_query, req.filterQuery))],
    ["filterString", toTrimmedString(firstDefined(req.filter_string, req.filterString))],
    ["orderBy", toTrimmedString(firstDefined(req.order_by, req.orderBy))],
    ["order", toTrimmedString(req.order) || "desc"],
  ]);

const sceneMonitorFilters = (req) =>
  addOptional(
    {
      from: toInt(firstDefined(req.page, req.from), 1),
      size: toInt(firstDefined(req.page_size, req.pageSize, req.size), 10),
    },
    [
      ["name", toTrimmedString(req.name)],
      ["tableName", toTrimmedString(firstDefined(req.table_name, req.tableName))],
      ["id", firstDefined(req.id, req.scene_id, req.sceneId)],
      ["type", firstDefined(req.type, req.scene_type, req.sceneType)],
      ["start", firstDefined(req.start, req.startTime)],
      ["end", firstDefined(req.end, req.endTime)],
      ["indexName", toTrimmedString(firstDefined(req.index_name, req.indexName))],
      ["userName", toTrimmedString(firstDefined(req.user_name, req.userName))],
    ],
  );

const SITUATION_SECTIONS = [
  ["logs_statistics", "/situationAwareness/security_pyramid/logs_statistics"],
  ["access_logs_trend", "/situationAwareness/security_pyramid/access_logs_trend"],
  ["event_classification", "/situationAwareness/host-threat-event/event_classification"],
  ["hot_event", "/situationAwareness/host-threat-event/hot_event"],
  ["attacker_total", "/situationAwareness/attacker/total"],
];

export const handlers = {
  "geyecloud.atd.v1.GEYECloudATD/AggregateThreatEvents": async (ctx) => {
    const req = getReq(ctx);
    const json = await callAtd(ctx, "/elasticSearch/aggregate", {
      ...baseTimeRange(req),
      from: toInt(firstDefined(req.page, req.from), 1),
      size: toInt(firstDefined(req.page_size, req.pageSize, req.size), 10),
      terms: requireString(req.terms, "terms"),
      tableName: toTrimmedString(firstDefined(req.table_name, req.tableName)) || "hw",
    });
    return {
      code: toInt(json.code, 0),
      message: json.msg ?? "",
      count: toInt(json.agg?.count, 0),
      total_count: toInt(json.agg?.totalCount, 0),
      items: Array.isArray(json.agg?.list)
        ? json.agg.list.map((item) => ({ key: toTrimmedString(item.key), value: toInt(item.value, 0) }))
        : [],
    };
  },

  "geyecloud.atd.v1.GEYECloudATD/GetNetworkLogTimeTrend": async (ctx) => {
    const json = await callAtd(ctx, "/netWorkLog/timeTrend", networkLogFilters(getReq(ctx)));
    return {
      code: toInt(json.code, 0),
      message: json.msg ?? "",
      items: Array.isArray(json.data)
        ? json.data.map((item) => ({
            timestamp: toInt(item.timestamp, 0),
            time: toTrimmedString(item.time),
            count: toInt(item.count, 0),
          }))
        : [],
    };
  },

  "geyecloud.atd.v1.GEYECloudATD/GetNetworkLogDimensionStatistics": async (ctx) => {
    const req = getReq(ctx);
    const json = await callAtd(
      ctx,
      "/netWorkLog/dimensionStatistics",
      addOptional(
        {
          ...networkLogFilters(req),
          dimensionKey: requireString(firstDefined(req.dimension_key, req.dimensionKey), "dimension_key"),
        },
        [
          ["pageNo", toInt(firstDefined(req.page, req.pageNo), 1)],
          ["size", toInt(firstDefined(req.page_size, req.pageSize, req.size), 10)],
        ],
      ),
    );
    return {
      code: toInt(json.code, 0),
      message: json.msg ?? "",
      items: Array.isArray(json.data)
        ? json.data.map((item) => ({
            key: toTrimmedString(item.key),
            name: toTrimmedString(item.name),
            value: toInt(item.value, 0),
            count: toInt(item.count, 0),
          }))
        : [],
    };
  },

  "geyecloud.atd.v1.GEYECloudATD/ListNetworkLogs": async (ctx) => {
    const req = getReq(ctx);
    const json = await callAtd(
      ctx,
      "/netWorkLog/list",
      addOptional(networkLogFilters(req), [
        ["srcPort", toTrimmedString(firstDefined(req.src_port, req.srcPort))],
        ["dstPort", toTrimmedString(firstDefined(req.dst_port, req.dstPort))],
        ["uri", toTrimmedString(req.uri)],
        ["uid", toTrimmedString(req.uid)],
        ["uuid", toTrimmedString(req.uuid)],
        ["sort", toTrimmedString(req.sort)],
        ["order", toTrimmedString(req.order) || "desc"],
        ["pageNo", toInt(firstDefined(req.page, req.pageNo), 1)],
        ["size", toInt(firstDefined(req.page_size, req.pageSize, req.size), 20)],
        ["isTranslate", toBool(firstDefined(req.is_translate, req.isTranslate), false)],
      ]),
    );
    const data = json.data ?? {};
    return {
      code: toInt(json.code, 0),
      message: json.msg ?? "",
      total: toInt(data.total, 0),
      page_size: toInt(data.size, 0),
      current: toInt(data.current, 0),
      pages: toInt(data.page, 0),
      items: Array.isArray(data.records) ? data.records.map(mapNetworkLog) : [],
    };
  },

  "geyecloud.atd.v1.GEYECloudATD/GetNetworkLogDetail": async (ctx) => {
    const req = getReq(ctx);
    const json = await callAtd(
      ctx,
      "/netWorkLog/details",
      addOptional(
        {
          uuid: requireString(firstDefined(req.detail_id, req.detailId, req.uuid), "detail_id"),
          queryTimestamp: requireInt64(firstDefined(req.query_timestamp, req.queryTimestamp), "query_timestamp"),
        },
        [
          ["start", firstDefined(req.start, req.startTime)],
          ["end", firstDefined(req.end, req.endTime)],
        ],
      ),
    );
    return {
      code: toInt(json.code, 0),
      message: json.msg ?? "",
      log: mapNetworkLog(json.data ?? {}),
    };
  },

  "geyecloud.atd.v1.GEYECloudATD/ListFileDetectionLogs": async (ctx) => {
    const req = getReq(ctx);
    const json = await callAtd(
      ctx,
      "/fileDetectionLog/list",
      addOptional(fileDetectionFilters(req), [
        ["sort", toTrimmedString(req.sort)],
        ["order", toTrimmedString(req.order) || "desc"],
        ["pageNo", toInt(firstDefined(req.page, req.pageNo), 1)],
        ["size", toInt(firstDefined(req.page_size, req.pageSize, req.size), 20)],
        ["isTranslate", toBool(firstDefined(req.is_translate, req.isTranslate), false)],
      ]),
    );
    return pagedResponse(json, mapFileDetectionLog);
  },

  "geyecloud.atd.v1.GEYECloudATD/GetFileDetectionLogDetail": async (ctx) => {
    const req = getReq(ctx);
    const json = await callAtd(
      ctx,
      "/fileDetectionLog/details",
      addOptional(
        {
          detailId: requireString(firstDefined(req.detail_id, req.detailId, req.uuid), "detail_id"),
          queryTimestamp: requireInt64(firstDefined(req.query_timestamp, req.queryTimestamp), "query_timestamp"),
        },
        [
          ["start", firstDefined(req.start, req.startTime)],
          ["end", firstDefined(req.end, req.endTime)],
          ["fileMd5", toTrimmedString(firstDefined(req.file_md5, req.fileMd5))],
        ],
      ),
    );
    return {
      code: toInt(json.code, 0),
      message: json.msg ?? "",
      log: mapFileDetectionLog(json.data ?? {}),
    };
  },

  "geyecloud.atd.v1.GEYECloudATD/GetFileDetectionSeverityStats": async (ctx) => {
    const req = getReq(ctx);
    const json = await callAtd(ctx, "/fileDetectionLog/severityNumber", fileDetectionFilters(req));
    const data = json.data ?? {};
    return {
      code: toInt(json.code, 0),
      message: json.msg ?? "",
      total: toInt(data.total, 0),
      danger: toInt(data.danger, 0),
      high: toInt(data.high, 0),
      middle: toInt(data.middle, 0),
      low: toInt(data.low, 0),
      safe: toInt(data.safe, 0),
    };
  },

  "geyecloud.atd.v1.GEYECloudATD/ListSceneMonitors": async (ctx) => {
    const json = await callAtd(ctx, "/sceneMonitor/querySceneMonitor", sceneMonitorFilters(getReq(ctx)));
    const data = looksLikePagination(json) ? json : json.data ?? {};
    const records = Array.isArray(data.records) ? data.records : Array.isArray(data.data?.records) ? data.data.records : [];
    return {
      code: toInt(json.code, 0),
      message: json.msg ?? "",
      total: toInt(firstDefined(data.total, data.data?.total), 0),
      items: records.map((item) => ({ raw_json: JSON.stringify(item) })),
    };
  },

  "geyecloud.atd.v1.GEYECloudATD/SearchSceneMonitorEvents": async (ctx) => {
    const req = getReq(ctx);
    const json = await callAtd(
      ctx,
      "/sceneMonitor/searchFromMonitor",
      {
        ...sceneMonitorFilters(req),
        id: requirePositiveInteger(firstDefined(req.id, req.scene_id, req.sceneId), "scene_id"),
      },
    );
    return pagedResponse(json, mapThreatEvent);
  },

  "geyecloud.atd.v1.GEYECloudATD/GetSituationOverview": async (ctx) => {
    const sections = [];
    for (const [name, path] of SITUATION_SECTIONS) {
      const json = await callAtd(ctx, path, undefined, { method: "GET" });
      sections.push({ name, raw_json: JSON.stringify(json.data ?? null) });
    }
    return {
      code: 200,
      message: "success",
      sections,
    };
  },

  "geyecloud.atd.v1.GEYECloudATD/SearchThreatEvents": async (ctx) => {
    const json = await callAtd(ctx, "/searchCenter/advanced/searchData", advancedThreatFilters(getReq(ctx)));
    return pagedResponse(json, mapThreatEvent);
  },

  "geyecloud.atd.v1.GEYECloudATD/GetThreatEventDetail": async (ctx) => {
    const req = getReq(ctx);
    const json = await callAtd(
      ctx,
      "/searchCenter/advanced/searchDataDetail",
      addOptional(advancedThreatFilters(req, { requireTimeRange: false }), [
        ["uuid", requireString(req.uuid, "uuid")],
        ["sensorId", toTrimmedString(firstDefined(req.sensor_id, req.sensorId))],
        ["ip", toTrimmedString(req.ip)],
      ]),
    );
    return {
      code: toInt(json.code, 0),
      message: json.msg ?? "",
      event: mapThreatEvent(json.data ?? {}),
      raw_json: JSON.stringify(json.data ?? null),
    };
  },
};
