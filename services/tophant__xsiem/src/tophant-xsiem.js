import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { URL } from "node:url";
import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const jwtCache = new Map();

export function httpCall(method, url, reqBody, headers, timeoutMs, insecure, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const reqModule = isHttps ? httpsRequest : httpRequest;
    const bodyStr = reqBody ? JSON.stringify(reqBody, (_k, v) => typeof v === "bigint" ? v.toString() : v) : null;

    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: method.toUpperCase(),
      headers: Object.assign(
        { "Accept": "application/json" },
        bodyStr ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(bodyStr) } : {},
      ),
      timeout: timeoutMs || 30000,
      rejectUnauthorized: insecure ? false : true,
    };

    for (const [k, v] of Object.entries(headers || {})) {
      if (v !== undefined && v !== null) opts.headers[k] = v;
    }

    const req = reqModule(opts, (res) => {
      const chunks = [];
      let received = 0;
      let settled = false;
      res.on("data", (chunk) => {
        received += chunk.length;
        if (received > MAX_RESPONSE_BYTES) {
          settled = true;
          res.destroy();
          reject(new GrpcError(grpcStatus.RESOURCE_EXHAUSTED, "XSIEM response body exceeds 10 MiB"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("error", (e) => {
        if (!settled) reject(new GrpcError(grpcStatus.UNAVAILABLE, `XSIEM response error: ${e.message}`));
      });
      res.on("end", () => {
        if (settled) return;
        const respBody = Buffer.concat(chunks).toString("utf8");
        const sc = res.statusCode;

        if (sc === 302 || sc === 301 || sc === 307 || sc === 308) {
          const loc = res.headers.location;
          if (loc) {
            if (redirectCount >= MAX_REDIRECTS) {
              return reject(new GrpcError(grpcStatus.UNAVAILABLE, "XSIEM exceeded redirect limit"));
            }
            const target = new URL(loc, parsed);
            if (target.origin !== parsed.origin) {
              return reject(new GrpcError(grpcStatus.PERMISSION_DENIED, "XSIEM refused cross-origin redirect"));
            }
            const redirectMethod = (sc === 301 || sc === 302) ? "GET" : method;
            return resolve(httpCall(redirectMethod, target.href, redirectMethod === "GET" ? null : reqBody, headers, timeoutMs, insecure, redirectCount + 1));
          }
        }

        if (sc === 401 || sc === 403) {
          return reject(new GrpcError(grpcStatus.PERMISSION_DENIED, `XSIEM HTTP ${sc}: unauthorized`));
        }
        if (sc >= 500) {
          return reject(new GrpcError(grpcStatus.UNAVAILABLE, `XSIEM HTTP ${sc}: server error`));
        }
        if (sc >= 400) {
          return reject(new GrpcError(grpcStatus.INVALID_ARGUMENT, `XSIEM HTTP ${sc}: ${respBody.substring(0, 200)}`));
        }
        try {
          const json = JSON.parse(respBody);
          if (json.code === 40001) {
            return reject(new GrpcError(grpcStatus.INVALID_ARGUMENT, json.msg || "XSIEM client parameter error"));
          }
          if (json.code === 50001) {
            return reject(new GrpcError(grpcStatus.UNAVAILABLE, json.msg || json.detail || "XSIEM server error"));
          }
          resolve(json);
        } catch (e) {
          if (e instanceof GrpcError) return reject(e);
          reject(new GrpcError(grpcStatus.UNAVAILABLE, `XSIEM returned non-JSON (HTTP ${sc})`));
        }
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new GrpcError(grpcStatus.UNAVAILABLE, `XSIEM timeout after ${opts.timeout}ms`));
    });

    req.on("error", (e) => {
      reject(new GrpcError(grpcStatus.UNAVAILABLE, `XSIEM unreachable: ${e.message}`));
    });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function hostUrl(config) {
  const host = config.xsiemHost;
  if (/^https?:\/\//.test(host)) return host;
  return `https://${host}`;
}

async function getJwt(config, secret) {
  const base = hostUrl(config);
  const mmToken = secret.mmToken;
  const url = `${base}/api/platform/mmlogin`;
  const data = await httpCall("POST", url, { mmToken }, {}, config.timeoutMs, config.insecure);
  const jwt = data?.data?.mmToken;
  if (!jwt) throw new GrpcError(grpcStatus.PERMISSION_DENIED, "mmToken exchange failed: no JWT in response");
  return jwt;
}

function jwtExpiry(jwt) {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
    return Number(payload.exp) * 1000;
  } catch {
    return Date.now() + 5 * 60 * 1000;
  }
}

function apiBase(config) {
  return `${hostUrl(config)}/api/xsiem`;
}

async function authHeaders(config, secret) {
  const key = `${hostUrl(config)}\0${secret.mmToken}`;
  let cached = jwtCache.get(key);
  if (!cached || cached.expiresAt <= Date.now() + 30_000) {
    const jwt = await getJwt(config, secret);
    cached = { jwt, expiresAt: jwtExpiry(jwt) };
    jwtCache.set(key, cached);
  }
  const jwt = cached.jwt;
  return { Authorization: `Bearer ${jwt}` };
}

export function clearJwtCache() {
  jwtCache.clear();
}

export async function queryAlerts(config, secret, req) {
  if (!req.size) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "size is required");
  const hdrs = await authHeaders(config, secret);
  const body = { page: req.page || 1, size: req.size };
  if (req.alarmName) body.alarmName = req.alarmName;
  if (req.status) body.status = req.status;
  if (req.severity) body.severity = req.severity;
  if (req.alarmTypeId) body.alarmTypeId = req.alarmTypeId;
  if (req.startTime && req.endTime) body.dateRange = [req.startTime, req.endTime];
  if (req.sortField) body.sortField = req.sortField;
  if (req.sortOrder) body.sortOrder = req.sortOrder;
  if (req.ruleId) body.ruleId = req.ruleId;
  if (req.ruleTag) body.ruleTag = req.ruleTag;
  if (req.srcAddr) body.srcAddr = req.srcAddr;
  if (req.dstAddr) body.dstAddr = req.dstAddr;
  if (req.filterDsl) body.filterDsl = req.filterDsl;
  const data = await httpCall("POST", `${apiBase(config)}/alert/query`, body, hdrs, config.timeoutMs, config.insecure);
  return { data: (data.data || data || []) };
}

export async function alertAggCount(config, secret, req) {
  const hdrs = await authHeaders(config, secret);
  const body = { aggType: 0, defAggType: req.defAggType ?? 0 };
  if (req.startTime && req.endTime) body.dateRange = [req.startTime, req.endTime];
  if (req.alarmName) body.alarmName = req.alarmName;
  if (req.status) body.status = req.status;
  if (req.severity) body.severity = req.severity;
  if (req.alarmTypeId) body.alarmTypeId = req.alarmTypeId;
  if (req.ruleId) body.ruleId = req.ruleId;
  if (req.ruleTag) body.ruleTag = req.ruleTag;
  if (req.srcAddr) body.srcAddr = req.srcAddr;
  if (req.dstAddr) body.dstAddr = req.dstAddr;
  if (req.filterDsl) body.filterDsl = req.filterDsl;
  const data = await httpCall("POST", `${apiBase(config)}/alert/aggCount`, body, hdrs, config.timeoutMs, config.insecure);
  return { count: (data.data || data).count || 0 };
}

export async function alertAggDetail(config, secret, req) {
  if (!req.aggQueryJson) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "aggQueryJson is required");
  const hdrs = await authHeaders(config, secret);
  let body;
  try { body = JSON.parse(req.aggQueryJson); } catch (e) {
    throw new GrpcError(grpcStatus.INVALID_ARGUMENT, `aggQueryJson is not valid JSON: ${e.message}`);
  }
  const data = await httpCall("POST", `${apiBase(config)}/alert/aggDetail`, body, hdrs, config.timeoutMs, config.insecure);
  const d = data.data || data;
  return {
    alarmTypeCount: d.alarmTypeCount || 0, alarmCount: d.alarmCount || 0,
    attackerCount: d.attackerCount || 0, suffererCount: d.suffererCount || 0,
    topKAlarmName: d.topKAlarmName || [],
  };
}

export async function batchUpdateAlertStatus(config, secret, req) {
  if (!req.ids || req.ids.length === 0) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "ids is required");
  if (!req.status) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "status is required");
  const hdrs = await authHeaders(config, secret);
  await httpCall("PUT", `${apiBase(config)}/alarm/batchStatus`, { ids: req.ids, status: req.status }, hdrs, config.timeoutMs, config.insecure);
  return { success: true };
}

export async function queryDevices(config, secret, req) {
  if (!req.size) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "size is required");
  const hdrs = await authHeaders(config, secret);
  const data = await httpCall("POST", `${apiBase(config)}/connector2/page`, { page: req.page || 1, size: req.size, categoryBelongList: [""] }, hdrs, config.timeoutMs, config.insecure);
  const d = data.data || data;
  const items = (d.items || []).map(it => ({
    id: it.id || "", name: it.name || "", sourceName: it.sourceName || "",
    flowStatus: it.flowStatus || "", port: it.port || 0, tlp: it.tlp || "",
    categoryBelongName: it.categoryBelongName || "", updatedTime: it.updatedTime || "",
  }));
  return { total: d.total || items.length, items };
}

export async function queryCollectors(config, secret, req) {
  if (!req.size) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "size is required");
  const hdrs = await authHeaders(config, secret);
  const body = { page: req.page || 1, size: req.size, name: req.name || "", sourceName: req.sourceName || "", port: 0, connectorIdList: [], flowStatus: req.flowStatus || "", categoryBelongIdList: [] };
  const data = await httpCall("POST", `${apiBase(config)}/transform/page`, body, hdrs, config.timeoutMs, config.insecure);
  const d = data.data || data;
  const items = (d.items || []).map(it => ({
    id: it.id || "", name: it.name || "", sourceName: it.sourceName || "",
    flowStatus: it.flowStatus || "", port: it.port || 0, tlp: it.tlp || "",
    connectorName: it.connectorName || "", updatedTime: it.updatedTime || "",
    logCount: it.logCount || "0", failCount: it.failCount || "0",
  }));
  return { total: d.total || items.length, items };
}

export const handlers = {
  "tophant.xsiem.XsiemService/QueryAlerts": (ctx) => queryAlerts(ctx.config, ctx.secret, ctx.request),
  "tophant.xsiem.XsiemService/AlertAggCount": (ctx) => alertAggCount(ctx.config, ctx.secret, ctx.request),
  "tophant.xsiem.XsiemService/AlertAggDetail": (ctx) => alertAggDetail(ctx.config, ctx.secret, ctx.request),
  "tophant.xsiem.XsiemService/BatchUpdateAlertStatus": (ctx) => batchUpdateAlertStatus(ctx.config, ctx.secret, ctx.request),
  "tophant.xsiem.XsiemService/QueryDevices": (ctx) => queryDevices(ctx.config, ctx.secret, ctx.request),
  "tophant.xsiem.XsiemService/QueryCollectors": (ctx) => queryCollectors(ctx.config, ctx.secret, ctx.request),
};
