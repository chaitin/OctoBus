import crypto from "node:crypto";
import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_SIGNATURE_EXPIRES_SECONDS = 300;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const API_PREFIX = "/api";

export const METHOD_LIST_GROUPS = "huorong.endpoint_security_management_system.v2_0_19_3.HuorongEndpointSecurityManagementSystem/ListGroups";
export const METHOD_LIST_ONLINE_MACS = "huorong.endpoint_security_management_system.v2_0_19_3.HuorongEndpointSecurityManagementSystem/ListOnlineMacs";
export const METHOD_LIST_CLIENTS = "huorong.endpoint_security_management_system.v2_0_19_3.HuorongEndpointSecurityManagementSystem/ListClients";
export const METHOD_GET_CLIENT_DETAILS = "huorong.endpoint_security_management_system.v2_0_19_3.HuorongEndpointSecurityManagementSystem/GetClientDetails";
export const METHOD_LIST_HIGH_RISK_CLIENTS = "huorong.endpoint_security_management_system.v2_0_19_3.HuorongEndpointSecurityManagementSystem/ListHighRiskClients";
export const METHOD_LIST_VIRUS_EVENTS = "huorong.endpoint_security_management_system.v2_0_19_3.HuorongEndpointSecurityManagementSystem/ListVirusEvents";
export const METHOD_CREATE_SCAN_TASK = "huorong.endpoint_security_management_system.v2_0_19_3.HuorongEndpointSecurityManagementSystem/CreateScanTask";
export const METHOD_CREATE_ISOLATION_TASK = "huorong.endpoint_security_management_system.v2_0_19_3.HuorongEndpointSecurityManagementSystem/CreateIsolationTask";
export const METHOD_SEND_NOTIFICATION = "huorong.endpoint_security_management_system.v2_0_19_3.HuorongEndpointSecurityManagementSystem/SendNotification";

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  DEADLINE_EXCEEDED: grpcStatus.DEADLINE_EXCEEDED,
  INTERNAL: grpcStatus.INTERNAL,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const firstDefined = (...vals) => vals.find((v) => v !== undefined && v !== null);

const unwrapValue = (val) => {
  if (val && typeof val === "object" && hasOwn(val, "value")) return val.value;
  return val;
};

const unwrapString = (val) => {
  const raw = unwrapValue(val);
  if (raw === undefined || raw === null) return "";
  return String(raw);
};

const parseHeaders = (value) => {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      return {};
    }
  }
  return {};
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.secret ?? {}),
  ...(ctx?.bindings ?? {}),
});

const normalizeBaseUrl = (url) => {
  const base = String(url || "").trim();
  if (!/^https?:\/\//i.test(base)) return null;
  return base.replace(/\/+$/, "");
};

const toStruct = (obj) => (obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {});

const toValue = (val) => {
  if (val === undefined || val === null) return null;
  return val;
};

const toInteger = (val) => {
  const raw = unwrapValue(val);
  if (raw === undefined || raw === null || raw === "") return null;
  const num = Number(raw);
  if (!Number.isInteger(num) || Number.isNaN(num)) return null;
  return num;
};

const toOptionalInt = (val, name, { min = undefined, max = undefined } = {}) => {
  const raw = unwrapValue(val);
  if (raw === undefined || raw === null || raw === "") return undefined;
  const num = toInteger(raw);
  if (num === null) throw errorWithCode("INVALID_ARGUMENT", `${name} must be an integer`);
  if (min !== undefined && num < min) throw errorWithCode("INVALID_ARGUMENT", `${name} must be >= ${min}`);
  if (max !== undefined && num > max) throw errorWithCode("INVALID_ARGUMENT", `${name} must be <= ${max}`);
  return num;
};

const toLimit = (val) => toOptionalInt(val, "limit", { min: 1, max: MAX_LIMIT }) ?? DEFAULT_LIMIT;

const toOffset = (val) => toOptionalInt(val, "offset", { min: 0 }) ?? 0;

const unwrapStringList = (val, name, { required = false } = {}) => {
  const raw = unwrapValue(val);
  if (raw === undefined || raw === null) {
    if (required) throw errorWithCode("INVALID_ARGUMENT", `${name} is required`);
    return [];
  }
  const source = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray(raw.values) ? raw.values : null;
  if (source === null) throw errorWithCode("INVALID_ARGUMENT", `${name} must be an array`);
  if (required && source.length === 0) throw errorWithCode("INVALID_ARGUMENT", `${name} must be non-empty`);
  return source.map((item) => {
    const normalized = unwrapString(item).trim();
    if (!normalized) throw errorWithCode("INVALID_ARGUMENT", `${name} elements must be non-empty strings`);
    return normalized;
  });
};

const unwrapIntList = (val, name) => {
  const raw = unwrapValue(val);
  if (raw === undefined || raw === null) return [];
  const source = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray(raw.values) ? raw.values : null;
  if (source === null) throw errorWithCode("INVALID_ARGUMENT", `${name} must be an int64 array`);
  return source.map((item) => {
    const num = toInteger(item);
    if (num === null) throw errorWithCode("INVALID_ARGUMENT", `${name} elements must be integers`);
    return num;
  });
};

const toOptionalBool = (val, fallback) => {
  const raw = unwrapValue(val);
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  throw errorWithCode("INVALID_ARGUMENT", "boolean fields must be bool, 0/1, or true/false string");
};

const jsonBody = (payload) => JSON.stringify(payload ?? {});

const contentMD5 = (body) => crypto.createHash("md5").update(body).digest("base64");

const buildAuthorization = ({ accessKeyId, accessKeySecret, method, path, body, expires }) => {
  const md5 = contentMD5(body);
  const canonicalizedResource = path.replace(/^\//, "");
  const stringToSign = `${accessKeyId}\n${expires}\n${method}\n${md5}\n${canonicalizedResource}`;
  const signature = encodeURIComponent(crypto.createHmac("sha1", accessKeySecret).update(stringToSign).digest("base64"));
  return {
    contentMD5: md5,
    authorization: `HRESS${accessKeyId}:${expires}:${signature}`,
    canonicalizedResource,
  };
};

const mapHuorongError = (json) => {
  if (!json || Number(json.errno ?? 0) === 0) return;
  const errno = Number(json.errno);
  const message = json.errmsg || `Huorong API error ${errno}`;
  if (errno === 1) throw errorWithCode("UNAUTHENTICATED", message);
  if (errno === 2) throw errorWithCode("INVALID_ARGUMENT", message);
  if (errno === 4) throw errorWithCode("PERMISSION_DENIED", message);
  throw errorWithCode("INTERNAL", message);
};

const mapHttpError = (status, text) => {
  if (status === 401) throw errorWithCode("UNAUTHENTICATED", `HTTP ${status}: ${text || "unauthorized"}`);
  if (status === 403) throw errorWithCode("PERMISSION_DENIED", `HTTP ${status}: ${text || "forbidden"}`);
  if (status >= 500) throw errorWithCode("UNAVAILABLE", `HTTP ${status}: ${text || "server error"}`);
  if (status >= 400) throw errorWithCode("INVALID_ARGUMENT", `HTTP ${status}: ${text || "request failed"}`);
};

const readJsonResponse = async (res) => {
  const text = await res.text();
  if (!res.ok) mapHttpError(res.status, text);
  try {
    const json = text ? JSON.parse(text) : {};
    mapHuorongError(json);
    return json;
  } catch (err) {
    if (err instanceof GrpcError) throw err;
    throw errorWithCode("UNAVAILABLE", `invalid JSON response: ${err.message}`);
  }
};

const resolveCallContext = (ctxOrReq = {}, maybeReq = {}, maybeCtx = {}) => {
  if (ctxOrReq && (hasOwn(ctxOrReq, "request") || hasOwn(ctxOrReq, "req") || hasOwn(ctxOrReq, "bindings") || hasOwn(ctxOrReq, "config") || hasOwn(ctxOrReq, "secret"))) {
    return { req: ctxOrReq.request ?? ctxOrReq.req ?? {}, ctx: ctxOrReq };
  }
  return {
    req: ctxOrReq ?? {},
    ctx: {
      ...(maybeCtx ?? {}),
      req: maybeReq ?? {},
      bindings: maybeCtx?.bindings ?? {},
      config: maybeCtx?.config ?? {},
      secret: maybeCtx?.secret ?? {},
      limits: maybeCtx?.limits ?? {},
      meta: maybeCtx?.meta ?? {},
    },
  };
};

const createClient = (ctx) => {
  const bindings = mergedBindings(ctx);
  const endpoint = normalizeBaseUrl(firstDefined(bindings.endpoint, bindings.baseUrl, bindings.base_url, bindings.restBaseUrl, bindings.rest_base_url));
  if (!endpoint) throw errorWithCode("INVALID_ARGUMENT", "endpoint/baseUrl is required and must start with http:// or https://");

  const accessKeyId = unwrapString(firstDefined(bindings.accessKeyId, bindings.access_key_id, bindings.secretId, bindings.secret_id)).trim();
  const accessKeySecret = unwrapString(firstDefined(bindings.accessKeySecret, bindings.access_key_secret, bindings.secretKey, bindings.secret_key)).trim();
  if (!accessKeyId) throw errorWithCode("INVALID_ARGUMENT", "accessKeyId/secretId is required");
  if (!accessKeySecret) throw errorWithCode("INVALID_ARGUMENT", "accessKeySecret/secretKey is required");

  const timeoutMs = toOptionalInt(firstDefined(ctx?.limits?.timeoutMs, bindings.timeoutMs, bindings.timeout_ms), "timeoutMs", { min: 1 }) ?? DEFAULT_TIMEOUT_MS;
  const signatureExpiresSeconds = toOptionalInt(firstDefined(bindings.signatureExpiresSeconds, bindings.signature_expires_seconds), "signatureExpiresSeconds", { min: 1 }) ?? DEFAULT_SIGNATURE_EXPIRES_SECONDS;
  const baseHeaders = parseHeaders(bindings.headers);

  const request = async (path, payload = {}) => {
    const method = "POST";
    const body = jsonBody(payload);
    const expires = Math.floor(Date.now() / 1000) + signatureExpiresSeconds;
    const auth = buildAuthorization({ accessKeyId, accessKeySecret, method, path, body, expires });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${endpoint}${path}`, {
        method,
        headers: {
          ...baseHeaders,
          "Content-Type": "application/json; charset=utf-8",
          "Content-MD5": auth.contentMD5,
          Authorization: auth.authorization,
        },
        body,
        signal: controller.signal,
      });
      return await readJsonResponse(res);
    } catch (err) {
      if (err instanceof GrpcError) throw err;
      if (err?.name === "AbortError") throw errorWithCode("DEADLINE_EXCEEDED", `request timed out after ${timeoutMs}ms`);
      throw errorWithCode("UNAVAILABLE", err?.message || "network request failed");
    } finally {
      clearTimeout(timer);
    }
  };

  return { request };
};

const mapClient = (item = {}) => ({
  id: Number(item.id ?? 0),
  client_id: String(item.client_id ?? item.cid ?? ""),
  local_ip: String(item.local_ip ?? item.ip_addr ?? ""),
  connect_ip: String(item.connect_ip ?? item.call_ip ?? ""),
  mac: String(item.mac ?? ""),
  client_name: String(item.client_name ?? ""),
  computer_name: String(item.computer_name ?? item.hostname ?? ""),
  group_id: Number(item.group_id ?? item.gid ?? 0),
  os_version: String(item.os_version ?? item.osver ?? ""),
  version: String(item.version ?? item.prodver ?? ""),
  definitions: String(item.definitions ?? ""),
  is_online: Boolean(item.is_online ?? item.stat === 2),
  last_connect_time: Number(item.last_connect_time ?? 0),
  last_seen_time: Number(item.last_seen_time ?? 0),
  first_appear_time: Number(item.first_appear_time ?? 0),
  last_off_time: Number(item.last_off_time ?? 0),
  this_on_time: Number(item.this_on_time ?? 0),
});

const mapClientDetails = (item = {}) => ({
  base: mapClient(item),
  hardware: toStruct(item.hardware),
  software: Array.isArray(item.software) ? item.software.map(toStruct) : [],
  assets: Array.isArray(item.assets) ? item.assets.map(toStruct) : [],
  netconf: Array.isArray(item.netconf) ? item.netconf.map(toStruct) : [],
  raw: toStruct(item),
});

const listData = (data) => (Array.isArray(data?.list) ? data.list : []);

const pagedPayload = (req) => ({
  limit: toLimit(firstDefined(req.limit, req.count)),
  offset: toOffset(req.offset),
});

const callListGroups = async (ctx) => {
  const json = await createClient(ctx).request(`${API_PREFIX}/group/_list`, {});
  const data = toStruct(json.data);
  return {
    groups: listData(data).map((item) => ({
      group_id: Number(item.group_id ?? 0),
      parent_group: Number(item.parent_group ?? 0),
      group_name: String(item.group_name ?? ""),
    })),
    raw: data,
  };
};

const callListOnlineMacs = async (ctx, req) => {
  const json = await createClient(ctx).request(`${API_PREFIX}/clnts/_online`, pagedPayload(req));
  const data = toStruct(json.data);
  return {
    records: listData(data).map((item) => ({ mac: typeof item === "string" ? item : String(item.mac ?? "") })),
    total: Number(data.total ?? 0),
    raw: data,
  };
};

const callListClients = async (ctx, req) => {
  const json = await createClient(ctx).request(`${API_PREFIX}/clnts/_list`, pagedPayload(req));
  const data = toStruct(json.data);
  return {
    clients: listData(data).map(mapClient),
    total: Number(data.total ?? 0),
    raw: data,
  };
};

const callGetClientDetails = async (ctx, req) => {
  const clients = unwrapStringList(req.clients, "clients");
  const mac = unwrapStringList(req.mac, "mac");
  const options = unwrapStringList(req.options, "options");
  if (clients.length === 0 && mac.length === 0) {
    throw errorWithCode("INVALID_ARGUMENT", "clients or mac must be provided");
  }
  const payload = {};
  if (clients.length > 0) payload.clients = clients;
  if (mac.length > 0) payload.mac = mac;
  if (options.length > 0) payload.options = options;
  const json = await createClient(ctx).request(`${API_PREFIX}/clnts/_info2`, payload);
  const data = toStruct(json.data);
  return {
    clients: listData(data).map(mapClientDetails),
    raw: data,
  };
};

const callListHighRiskClients = async (ctx, req) => {
  const json = await createClient(ctx).request(`${API_PREFIX}/clnts/_leak`, pagedPayload(req));
  const data = toStruct(json.data);
  return {
    clients: listData(data).map((item = {}) => ({
      cid: String(item.cid ?? ""),
      hostname: String(item.hostname ?? ""),
      client_name: String(item.client_name ?? ""),
      group_name: String(item.group_name ?? ""),
      group_id: Number(item.group_id ?? 0),
      ip_addr: String(item.ip_addr ?? ""),
      call_ip: String(item.call_ip ?? ""),
      mac: String(item.mac ?? ""),
      osver: String(item.osver ?? ""),
      os_type: String(item.os_type ?? ""),
      prodver: String(item.prodver ?? ""),
      virdb: Number(item.virdb ?? 0),
      stat: Number(item.stat ?? 0),
    })),
    all_client: Number(data.all_client ?? 0),
    risk_client: Number(data.risk_client ?? 0),
    raw: data,
  };
};

const callListVirusEvents = async (ctx, req) => {
  const type = toOptionalInt(req.type, "type", { min: 0, max: 2 }) ?? 2;
  const payload = {
    type,
    limit: toLimit(firstDefined(req.limit, req.count)),
    offset: toOffset(req.offset),
  };
  if (type === 0) {
    const clientId = unwrapString(req.client_id || req.clientId).trim();
    if (!clientId) throw errorWithCode("INVALID_ARGUMENT", "client_id is required when type=0");
    payload.client_id = clientId;
  }
  if (type === 1) {
    const groupId = toOptionalInt(firstDefined(req.group_id, req.groupId), "group_id", { min: 1 });
    if (groupId === undefined) throw errorWithCode("INVALID_ARGUMENT", "group_id is required when type=1");
    payload.group_id = groupId;
  }
  const beginTime = toOptionalInt(firstDefined(req.begin_time, req.beginTime), "begin_time", { min: 0 });
  const endTime = toOptionalInt(firstDefined(req.end_time, req.endTime), "end_time", { min: 0 });
  if (beginTime !== undefined) payload.begin_time = beginTime;
  if (endTime !== undefined) payload.end_time = endTime;
  const json = await createClient(ctx).request(`${API_PREFIX}/clnts/_virus_events`, payload);
  const data = toStruct(json.data);
  return {
    records: listData(data).map((item = {}) => ({
      group_id: Number(item.group_id ?? 0),
      client_id: String(item.client_id ?? ""),
      client_name: String(item.client_name ?? ""),
      computer_name: String(item.computer_name ?? ""),
      local_ip: String(item.local_ip ?? ""),
      connect_ip: String(item.connect_ip ?? ""),
      mac: String(item.mac ?? ""),
      count: Number(item.count ?? 0),
      result: {
        success: Number(item.result?.success ?? 0),
        fail: Number(item.result?.fail ?? 0),
        ignored: Number(item.result?.ignored ?? 0),
        trusted: Number(item.result?.trusted ?? 0),
      },
    })),
    total: Number(data.total ?? 0),
    raw: data,
  };
};

const taskResponse = (json) => ({
  errno: Number(json.errno ?? 0),
  errmsg: String(json.errmsg ?? ""),
  data: toValue(json.data),
  raw: toStruct(json),
});

const baseTaskTargetPayload = (req) => {
  const clients = unwrapStringList(req.clients, "clients");
  const groups = unwrapIntList(firstDefined(req.groups, req.group_ids, req.groupIds), "groups");
  if (clients.length > 0 && groups.length > 0) {
    throw errorWithCode("INVALID_ARGUMENT", "clients and groups cannot be used together");
  }
  if (clients.length === 0 && groups.length === 0) {
    throw errorWithCode("INVALID_ARGUMENT", "clients or groups must be provided");
  }
  return clients.length > 0 ? { clients } : { groups };
};

const callCreateScanTask = async (ctx, req) => {
  const scanType = unwrapString(firstDefined(req.scan_type, req.scanType)).trim() || "quick_scan";
  if (!["quick_scan", "custom_scan", "full_scan"].includes(scanType)) {
    throw errorWithCode("INVALID_ARGUMENT", "scan_type must be quick_scan, custom_scan, or full_scan");
  }
  const param = {
    whitelist_ignore: toOptionalBool(firstDefined(req.whitelist_ignore, req.whitelistIgnore), false),
    scan_maxspeed: toOptionalBool(firstDefined(req.scan_maxspeed, req.scanMaxspeed), false),
    clean_automate: toOptionalBool(firstDefined(req.clean_automate, req.cleanAutomate), true),
    clean_quarantine: toOptionalBool(firstDefined(req.clean_quarantine, req.cleanQuarantine), true),
    scan_end_halt: toOptionalBool(firstDefined(req.scan_end_halt, req.scanEndHalt), false),
    cannot_cancel: toOptionalBool(firstDefined(req.cannot_cancel, req.cannotCancel), true),
  };
  const scanList = unwrapStringList(firstDefined(req.scan_list, req.scanList), "scan_list");
  if (scanType === "custom_scan") {
    if (scanList.length === 0) throw errorWithCode("INVALID_ARGUMENT", "scan_list is required when scan_type=custom_scan");
    param.scan_list = scanList;
  }
  const payload = {
    type: scanType,
    param,
    ...baseTaskTargetPayload(req),
  };
  const json = await createClient(ctx).request(`${API_PREFIX}/task/_create`, payload);
  return taskResponse(json);
};

const callCreateIsolationTask = async (ctx, req) => {
  const payload = {
    type: "netctrl",
    param: {
      net_isolation: Boolean(firstDefined(req.net_isolation, req.netIsolation, false)),
    },
    ...baseTaskTargetPayload({ ...req, groups: [] }),
  };
  const json = await createClient(ctx).request(`${API_PREFIX}/task/_create`, payload);
  return taskResponse(json);
};

const callSendNotification = async (ctx, req) => {
  const text = unwrapString(req.text).trim();
  if (!text) throw errorWithCode("INVALID_ARGUMENT", "text is required");
  const payload = {
    type: "message",
    param: { text },
    ...baseTaskTargetPayload({ ...req, groups: [] }),
  };
  const json = await createClient(ctx).request(`${API_PREFIX}/task/_create`, payload);
  return taskResponse(json);
};

const handler = (fn) => async (ctxOrReq = {}, maybeReq = {}, maybeCtx = {}) => {
  const { req, ctx } = resolveCallContext(ctxOrReq, maybeReq, maybeCtx);
  return fn(ctx, req ?? {});
};

export const handlers = {
  [METHOD_LIST_GROUPS]: handler(callListGroups),
  [METHOD_LIST_ONLINE_MACS]: handler(callListOnlineMacs),
  [METHOD_LIST_CLIENTS]: handler(callListClients),
  [METHOD_GET_CLIENT_DETAILS]: handler(callGetClientDetails),
  [METHOD_LIST_HIGH_RISK_CLIENTS]: handler(callListHighRiskClients),
  [METHOD_LIST_VIRUS_EVENTS]: handler(callListVirusEvents),
  [METHOD_CREATE_SCAN_TASK]: handler(callCreateScanTask),
  [METHOD_CREATE_ISOLATION_TASK]: handler(callCreateIsolationTask),
  [METHOD_SEND_NOTIFICATION]: handler(callSendNotification),
};

export const _test = {
  buildAuthorization,
  contentMD5,
  createClient,
  errorWithCode,
  firstDefined,
  handlers,
  mapHuorongError,
  mapClient,
  mapClientDetails,
  mergedBindings,
  normalizeBaseUrl,
  parseHeaders,
  resolveCallContext,
  toLimit,
  toOffset,
  unwrapStringList,
};
