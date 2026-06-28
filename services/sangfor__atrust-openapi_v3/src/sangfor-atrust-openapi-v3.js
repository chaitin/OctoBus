import crypto from "node:crypto";

import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";
import { Agent, fetch as undiciFetch } from "undici";

export const SERVICE_FULL = "Sangfor_Atrust_OpenAPI_V3.Sangfor_Atrust_OpenAPI_V3";

export const METHOD_LIST_ONLINE_USERS_FULL = `${SERVICE_FULL}/ListOnlineUsers`;
export const METHOD_KICKOUT_USERS_FULL = `${SERVICE_FULL}/KickoutUsers`;
export const METHOD_QUERY_USER_FULL = `${SERVICE_FULL}/QueryUser`;
export const METHOD_LIST_USERS_FULL = `${SERVICE_FULL}/ListUsers`;
export const METHOD_QUERY_GROUP_FULL = `${SERVICE_FULL}/QueryGroup`;
export const METHOD_LIST_GROUPS_FULL = `${SERVICE_FULL}/ListGroups`;
export const METHOD_QUERY_ROLE_FULL = `${SERVICE_FULL}/QueryRole`;
export const METHOD_LIST_ROLES_FULL = `${SERVICE_FULL}/ListRoles`;
export const METHOD_LIST_RESOURCES_FULL = `${SERVICE_FULL}/ListResources`;
export const METHOD_QUERY_RESOURCE_FULL = `${SERVICE_FULL}/QueryResource`;
export const METHOD_LIST_RESOURCE_GROUPS_FULL = `${SERVICE_FULL}/ListResourceGroups`;
export const METHOD_LIST_USER_DIRECTORIES_FULL = `${SERVICE_FULL}/ListUserDirectories`;
export const METHOD_QUERY_USER_DIRECTORY_FULL = `${SERVICE_FULL}/QueryUserDirectory`;
export const METHOD_LIST_DEVICES_FULL = `${SERVICE_FULL}/ListDevices`;
export const METHOD_QUERY_DEVICE_FULL = `${SERVICE_FULL}/QueryDevice`;

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const DEFAULT_LANG = "zh-CN";
const JSON_CONTENT_TYPE = "application/json;charset=UTF-8";

const QUERY_USER_PATHS = {
  id: "/api/v3/user/queryById",
  name: "/api/v3/user/queryByName",
  external_id: "/api/v3/user/queryByExternalId",
};

const QUERY_GROUP_PATHS = {
  id: "/api/v3/group/queryById",
  full_path: "/api/v3/group/queryByFullPath",
  external_id: "/api/v3/group/queryByExternalId",
};

const QUERY_ROLE_PATHS = {
  id: "/api/v3/role/queryById",
  name: "/api/v3/role/queryByName",
  external_id: "/api/v3/role/queryByExternalId",
};

const QUERY_RESOURCE_PATHS = {
  id: "/api/v3/resource/queryById",
  name: "/api/v3/resource/queryByName",
};


let skipTlsVerifyDispatcher;

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const unwrap = (value) => {
  if (value === undefined || value === null) return "";
  if (typeof value === "object" && hasOwn(value, "value")) return unwrap(value.value);
  return String(value);
};

const trim = (value) => unwrap(value).trim();

const toInt = (value, fallback) => {
  const raw = typeof value === "object" && hasOwn(value, "value") ? value.value : value;
  if (raw === undefined || raw === null || raw === "") return fallback;
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.trunc(num);
};

const toBool = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === "") return defaultValue;
  const raw = typeof value === "object" && hasOwn(value, "value") ? value.value : value;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  const text = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(text)) return true;
  if (["0", "false", "no", "n", "off"].includes(text)) return false;
  return defaultValue;
};

const asArray = (value) => {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.values)) return value.values;
  return [value];
};

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const fail = (code, message) => new GrpcError(grpcCodeFor(code), message);

const fromProtoValue = (value) => {
  if (!value || typeof value !== "object") return value;
  if (hasOwn(value, "stringValue")) return value.stringValue;
  if (hasOwn(value, "numberValue")) return value.numberValue;
  if (hasOwn(value, "boolValue")) return value.boolValue;
  if (hasOwn(value, "nullValue")) return null;
  if (hasOwn(value, "listValue")) return asArray(value.listValue?.values).map(fromProtoValue);
  if (hasOwn(value, "structValue")) return plainObject(value.structValue);
  return value;
};

const plainObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  if (value.fields && typeof value.fields === "object") {
    return Object.fromEntries(Object.entries(value.fields).map(([key, field]) => [key, fromProtoValue(field)]));
  }
  return value;
};

const normalizeBaseUrl = (value) => {
  try {
    const url = new URL(trim(value));
    const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) return "";
    if (url.username || url.password || url.search || url.hash) return "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
};

const normalizeHeaderValue = (value) => {
  if (value === undefined || value === null) return "";
  if (typeof value === "object" && hasOwn(value, "value")) return normalizeHeaderValue(value.value);
  return String(value);
};

const normalizeHeaders = (value) => {
  const prohibited = new Set([
    "authorization", "connection", "content-length", "content-type", "cookie", "host",
    "proxy-authorization", "transfer-encoding", "x-ca-key", "x-ca-nonce", "x-ca-sign", "x-ca-timestamp",
  ]);
  const result = {};
  for (const [rawKey, rawValue] of Object.entries(plainObject(value))) {
    const key = trim(rawKey).toLowerCase();
    const headerValue = normalizeHeaderValue(rawValue);
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(key) || prohibited.has(key)) continue;
    if (/[\r\n]/.test(headerValue)) continue;
    result[key] = headerValue;
  }
  return result;
};

const getSkipTlsVerifyDispatcher = () => {
  skipTlsVerifyDispatcher ??= new Agent({ connect: { rejectUnauthorized: false } });
  return skipTlsVerifyDispatcher;
};

const createContext = (runtimeCtx = {}) => {
  const config = runtimeCtx.config ?? {};
  const secret = runtimeCtx.secret ?? {};
  const bindings = { ...config, ...secret, ...(runtimeCtx.bindings ?? {}) };
  // Prefer URL-named aliases so automated schema synthesis cannot shadow them
  // with a host:port-only sample for the legacy `host` field.
  const baseUrl = normalizeBaseUrl(firstDefined(bindings.baseUrl, bindings.restBaseUrl, bindings.host));
  if (!baseUrl) throw fail("INVALID_ARGUMENT", "config.host/baseUrl/restBaseUrl must be an http(s) URL");
  const apiId = trim(firstDefined(bindings.apiId, bindings.xCaKey, bindings.api_id));
  const apiSecret = trim(firstDefined(bindings.apiSecret, bindings.xCaSecret, bindings.api_secret));
  if (!apiId) throw fail("INVALID_ARGUMENT", "secret.apiId is required");
  if (!apiSecret) throw fail("INVALID_ARGUMENT", "secret.apiSecret is required");
  const timeoutMs = Math.max(1, toInt(firstDefined(runtimeCtx.limits?.timeoutMs, bindings.timeoutMs), DEFAULT_TIMEOUT_MS));
  const headers = normalizeHeaders(bindings.headers);
  const dispatcher = toBool(bindings.skipTlsVerify) ? getSkipTlsVerifyDispatcher() : undefined;
  const lang = trim(bindings.lang) || DEFAULT_LANG;
  const timestampOffsetSeconds = toInt(bindings.timestampOffsetSeconds, 0);
  const maxResponseBytes = Math.min(
    MAX_RESPONSE_BYTES,
    Math.max(1, toInt(bindings.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES)),
  );
  return { apiId, apiSecret, baseUrl, dispatcher, headers, lang, maxResponseBytes, timeoutMs, timestampOffsetSeconds };
};

const normalizeQuery = (query = {}) => {
  const result = {};
  for (const [key, value] of Object.entries(plainObject(query))) {
    if (value === undefined || value === null || value === "") continue;
    result[key] = String(value);
  }
  return result;
};

const canonicalQuery = (query = {}) => Object.entries(normalizeQuery(query))
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([key, value]) => `${key}=${value}`)
  .join("&");

const compactJson = (body) => {
  if (body === undefined || body === null) return "";
  return JSON.stringify(plainObject(body));
};

const signingString = (apiPath, query = {}, body) => {
  const queryText = canonicalQuery(query);
  const bodyText = compactJson(body);
  if (queryText && bodyText) return `${apiPath}?${queryText}&${bodyText}`;
  if (queryText) return `${apiPath}?${queryText}`;
  if (bodyText) return `${apiPath}?${bodyText}`;
  return apiPath;
};

const sign = ({ apiId, apiSecret, timestamp, nonce, apiPath, query, body }) => {
  const key = `appId=${apiId}&appSecret=${apiSecret}&timestamp=${timestamp}&nonce=${nonce}`;
  return crypto.createHmac("sha256", key).update(signingString(apiPath, query, body)).digest("hex");
};

const authHeaders = (ctx, apiPath, query, body, now = Date.now(), nonce = crypto.randomUUID()) => {
  const timestamp = String(Math.floor(now / 1000) + toInt(ctx.timestampOffsetSeconds, 0));
  return {
    "content-type": JSON_CONTENT_TYPE,
    "x-ca-key": ctx.apiId,
    "x-ca-timestamp": timestamp,
    "x-ca-nonce": nonce,
    "x-ca-sign": sign({ ...ctx, timestamp, nonce, apiPath, query, body }),
  };
};

const queryString = (query = {}) => {
  const normalized = normalizeQuery(query);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(normalized).sort(([left], [right]) => left.localeCompare(right))) {
    params.set(key, value);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
};

const mapResponse = (httpStatus, json, rawJson) => ({
  http_status: httpStatus,
  code: String(json?.code ?? ""),
  msg: trim(firstDefined(json?.msg, json?.message)),
  trace_id: trim(firstDefined(json?.traceId, json?.trace_id)),
  data: json?.data ?? null,
  raw_json: rawJson,
});

const parseJson = (raw) => {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw fail("FAILED_PRECONDITION", `upstream returned invalid JSON: ${err.message}`);
  }
};

const readBoundedBody = async (res, maxBytes) => {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel();
    throw fail("FAILED_PRECONDITION", `upstream response exceeds ${maxBytes} bytes`);
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw fail("FAILED_PRECONDITION", `upstream response exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
};

const assertApiSuccess = (response, action) => {
  if (response.http_status >= 200 && response.http_status < 300 && ["", "0", "OK"].includes(response.code)) {
    return response;
  }
  if (response.http_status === 401 || response.http_status === 403) {
    throw fail("PERMISSION_DENIED", `${action} failed: upstream rejected the credentials (HTTP ${response.http_status})`);
  }
  if (response.http_status >= 500) {
    throw fail("UNAVAILABLE", `${action} failed: upstream unavailable (HTTP ${response.http_status})`);
  }
  throw fail("FAILED_PRECONDITION", `${action} failed: HTTP ${response.http_status} code=${response.code} ${response.msg}`);
};

const apiFetch = async (ctx, method, apiPath, { query, body, action } = {}) => {
  const normalizedQuery = normalizeQuery(query);
  const normalizedBody = body === undefined ? undefined : plainObject(body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);
  const url = `${ctx.baseUrl}${apiPath}${queryString(normalizedQuery)}`;
  try {
    const res = await undiciFetch(url, {
      method,
      headers: {
        ...ctx.headers,
        Accept: "application/json",
        ...authHeaders(ctx, apiPath, normalizedQuery, normalizedBody),
      },
      body: normalizedBody === undefined ? undefined : compactJson(normalizedBody),
      signal: controller.signal,
      dispatcher: ctx.dispatcher,
      redirect: "error",
    });
    const raw = await readBoundedBody(res, ctx.maxResponseBytes);
    const response = mapResponse(Number(res.status || 0), parseJson(raw), raw);
    return assertApiSuccess(response, action || `${method} ${apiPath}`);
  } catch (err) {
    if (err instanceof GrpcError) throw err;
    throw fail("UNAVAILABLE", `${method} ${apiPath} failed: ${err?.message || "fetch failed"}`);
  } finally {
    clearTimeout(timer);
  }
};

const withLang = (ctx, query = {}) => ({ lang: ctx.lang, ...normalizeQuery(query) });

const bodyWithPaging = (req = {}) => {
  const body = { ...plainObject(req.body) };
  if (trim(req.directory_domain)) body.directoryDomain = trim(req.directory_domain);
  const pageSize = toInt(req.page_size, 0);
  const pageIndex = toInt(req.page_index, 0);
  if (pageSize > 0) body.pageSize = pageSize;
  if (pageIndex > 0) body.pageIndex = pageIndex;
  if (trim(req.search_by_path)) body.searchByPath = trim(req.search_by_path);
  if (req.recursive !== undefined && req.recursive !== null) body.recursive = toInt(req.recursive, 0);
  return body;
};

const queryWithPaging = (req = {}) => {
  const query = { ...normalizeQuery(req.query) };
  const pageSize = toInt(req.page_size, 0);
  const pageIndex = toInt(req.page_index, 0);
  if (pageSize > 0) query.pageSize = String(pageSize);
  if (pageIndex > 0) query.pageIndex = String(pageIndex);
  if (trim(req.search_value)) query.searchValue = trim(req.search_value);
  if (trim(req.filter)) query.filter = trim(req.filter);
  if (trim(req.id)) query.id = trim(req.id);
  if (trim(req.name)) query.name = trim(req.name);
  return query;
};

const entityQuery = (req = {}, key, value) => {
  const query = { ...normalizeQuery(req.query) };
  if (trim(req.directory_domain)) query.directoryDomain = trim(req.directory_domain);
  query[key] = value;
  return query;
};

const selectEntity = (req = {}, selectors, entityName) => {
  const candidates = [
    ["id", trim(req.id), "id"],
    ["name", trim(req.name), "name"],
    ["external_id", trim(req.external_id), "externalId"],
    ["full_path", trim(req.full_path), "fullPath"],
  ];
  for (const [selector, value, queryKey] of candidates) {
    if (!value || !selectors[selector]) continue;
    return { path: selectors[selector], query: entityQuery(req, queryKey, value) };
  }
  throw fail("INVALID_ARGUMENT", `${entityName} requires one of: ${Object.keys(selectors).join(", ")}`);
};

const handleListOnlineUsers = (req = {}, runtimeCtx = {}) => {
  const ctx = createContext(runtimeCtx);
  return apiFetch(ctx, "GET", "/api/v1/monitor/getUserStatus", {
    query: queryWithPaging(req),
    action: "ListOnlineUsers",
  });
};

const handleKickoutUsers = (req = {}, runtimeCtx = {}) => {
  const ctx = createContext(runtimeCtx);
  const idList = asArray(req.id_list ?? req.idList).map(trim).filter(Boolean);
  const userList = asArray(req.user_list ?? req.userList)
    .map((item) => plainObject(item))
    .map((item) => ({
      name: trim(item.name),
      userDirectoryName: trim(firstDefined(item.user_directory_name, item.userDirectoryName)),
    }))
    .filter((item) => item.name && item.userDirectoryName);
  if (idList.length === 0 && userList.length === 0) {
    throw fail("INVALID_ARGUMENT", "id_list or user_list is required");
  }
  return apiFetch(ctx, "POST", "/api/v1/monitor/kickoutUsers", {
    body: { ...(idList.length ? { idList } : {}), ...(userList.length ? { userList } : {}) },
    action: "KickoutUsers",
  });
};

const handleQueryEntity = (req, runtimeCtx, selectors, entityName) => {
  const ctx = createContext(runtimeCtx);
  const selected = selectEntity(req, selectors, entityName);
  return apiFetch(ctx, "GET", selected.path, { query: selected.query, action: `Query${entityName}` });
};

const handlePostList = (req, runtimeCtx, path, action) => {
  const ctx = createContext(runtimeCtx);
  return apiFetch(ctx, "POST", path, { query: withLang(ctx), body: bodyWithPaging(req), action });
};

const handleGetList = (req, runtimeCtx, path, action) => {
  const ctx = createContext(runtimeCtx);
  return apiFetch(ctx, "GET", path, { query: queryWithPaging(req), action });
};

const handleUserDirectoryQuery = (req = {}, runtimeCtx = {}) => {
  const ctx = createContext(runtimeCtx);
  const query = { ...normalizeQuery(req.query) };
  if (trim(req.id)) query.id = trim(req.id);
  if (trim(req.name)) query.name = trim(req.name);
  if (!query.id && !query.name) throw fail("INVALID_ARGUMENT", "QueryUserDirectory requires id or name");
  return apiFetch(ctx, "GET", "/api/v1/userDirectory/query", { query, action: "QueryUserDirectory" });
};

const handleDeviceQuery = (req = {}, runtimeCtx = {}) => {
  const ctx = createContext(runtimeCtx);
  const query = { ...normalizeQuery(req.query) };
  for (const [requestKey, queryKey] of [["id", "id"], ["name", "name"], ["external_id", "externalId"]]) {
    if (trim(req[requestKey])) query[queryKey] = trim(req[requestKey]);
  }
  if (Object.keys(query).length === 0) throw fail("INVALID_ARGUMENT", "QueryDevice requires id, name, external_id, or query");
  return apiFetch(ctx, "GET", "/api/v1/device/query", { query, action: "QueryDevice" });
};

const handleListDevices = (req = {}, runtimeCtx = {}) => {
  const ctx = createContext(runtimeCtx);
  const body = { ...normalizeQuery(req.query) };
  const pageSize = toInt(req.page_size, 0);
  const pageIndex = toInt(req.page_index, 0);
  if (pageSize > 0) body.pageSize = pageSize;
  if (pageIndex > 0) body.pageIndex = pageIndex;
  return apiFetch(ctx, "POST", "/api/v1/device/queryAll", { body, action: "ListDevices" });
};

const requestHandlers = {
  [METHOD_LIST_ONLINE_USERS_FULL]: handleListOnlineUsers,
  [METHOD_KICKOUT_USERS_FULL]: handleKickoutUsers,
  [METHOD_QUERY_USER_FULL]: (request, callContext) => handleQueryEntity(request, callContext, QUERY_USER_PATHS, "User"),
  [METHOD_LIST_USERS_FULL]: (request, callContext) => handlePostList(request, callContext, "/api/v3/user/queryAll", "ListUsers"),
  [METHOD_QUERY_GROUP_FULL]: (request, callContext) => handleQueryEntity(request, callContext, QUERY_GROUP_PATHS, "Group"),
  [METHOD_LIST_GROUPS_FULL]: (request, callContext) => handlePostList(request, callContext, "/api/v3/group/queryAll", "ListGroups"),
  [METHOD_QUERY_ROLE_FULL]: (request, callContext) => handleQueryEntity(request, callContext, QUERY_ROLE_PATHS, "Role"),
  [METHOD_LIST_ROLES_FULL]: (request, callContext) => handlePostList(request, callContext, "/api/v3/role/queryAll", "ListRoles"),
  [METHOD_LIST_RESOURCES_FULL]: (request, callContext) => handleGetList(request, callContext, "/api/v3/resource/queryAll", "ListResources"),
  [METHOD_QUERY_RESOURCE_FULL]: (request, callContext) => handleQueryEntity(request, callContext, QUERY_RESOURCE_PATHS, "Resource"),
  [METHOD_LIST_RESOURCE_GROUPS_FULL]: (request, callContext) => handleGetList(request, callContext, "/api/v3/resourceGroup/queryAll", "ListResourceGroups"),
  [METHOD_LIST_USER_DIRECTORIES_FULL]: (request, callContext) => handleGetList(request, callContext, "/api/v1/userDirectory/queryAll", "ListUserDirectories"),
  [METHOD_QUERY_USER_DIRECTORY_FULL]: handleUserDirectoryQuery,
  [METHOD_LIST_DEVICES_FULL]: handleListDevices,
  [METHOD_QUERY_DEVICE_FULL]: handleDeviceQuery,
};

export function rpcdef(ctx = {}) {
  return Object.fromEntries(Object.entries(requestHandlers).map(([method, handler]) => [`/${method}`, (req) => handler(req, ctx)]));
}

export const handlers = Object.fromEntries(Object.entries(requestHandlers).map(([method, handler]) => [
  method,
  async (ctx = {}) => handler(ctx.req ?? ctx.request ?? {}, ctx),
]));

export const _test = {
  authHeaders,
  bodyWithPaging,
  canonicalQuery,
  compactJson,
  createContext,
  fail,
  fromProtoValue,
  normalizeQuery,
  normalizeHeaders,
  plainObject,
  queryString,
  queryWithPaging,
  readBoundedBody,
  requestHandlers,
  sign,
  signingString,
};
