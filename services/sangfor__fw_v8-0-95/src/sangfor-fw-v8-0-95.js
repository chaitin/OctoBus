import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";
import { Agent, fetch as undiciFetch } from "undici";

export const METHOD_LOGIN_FULL = "Sangfor_FW_V8095.Sangfor_FW_V8095/Login";
export const METHOD_KEEP_ALIVE_FULL = "Sangfor_FW_V8095.Sangfor_FW_V8095/KeepAlive";
export const METHOD_LOGOUT_FULL = "Sangfor_FW_V8095.Sangfor_FW_V8095/Logout";
export const METHOD_LIST_BLACK_WHITE_FULL = "Sangfor_FW_V8095.Sangfor_FW_V8095/ListBlackWhiteList";
export const METHOD_ADD_BLACKLIST_FULL = "Sangfor_FW_V8095.Sangfor_FW_V8095/AddBlacklist";
export const METHOD_REMOVE_BLACKLIST_FULL = "Sangfor_FW_V8095.Sangfor_FW_V8095/RemoveBlacklist";
export const METHOD_LIST_BLOCKED_IP_FULL = "Sangfor_FW_V8095.Sangfor_FW_V8095/ListBlockedIP";
export const METHOD_BLOCK_IP_FULL = "Sangfor_FW_V8095.Sangfor_FW_V8095/BlockIP";
export const METHOD_UNBLOCK_IP_FULL = "Sangfor_FW_V8095.Sangfor_FW_V8095/UnblockIP";
export const METHOD_GET_BLOCK_TIME_FULL = "Sangfor_FW_V8095.Sangfor_FW_V8095/GetBlockTime";
export const METHOD_SET_BLOCK_TIME_FULL = "Sangfor_FW_V8095.Sangfor_FW_V8095/SetBlockTime";
export const METHOD_LIST_IP_GROUPS_FULL = "Sangfor_FW_V8095.Sangfor_FW_V8095/ListIPGroups";
export const METHOD_GET_IP_GROUP_FULL = "Sangfor_FW_V8095.Sangfor_FW_V8095/GetIPGroup";
export const METHOD_ADD_IP_GROUP_FULL = "Sangfor_FW_V8095.Sangfor_FW_V8095/AddIPGroup";
export const METHOD_DELETE_IP_GROUP_FULL = "Sangfor_FW_V8095.Sangfor_FW_V8095/DeleteIPGroup";
export const METHOD_BUSINESS_BLOCK_IP_FULL = "Sangfor_FW_V8095.Sangfor_FW_V8095/BusinessBlockIP";
export const METHOD_BUSINESS_UNBLOCK_IP_FULL = "Sangfor_FW_V8095.Sangfor_FW_V8095/BusinessUnblockIP";
export const METHOD_QUERY_SESSIONS_FULL = "Sangfor_FW_V8095.Sangfor_FW_V8095/QuerySessions";
export const METHOD_BLOCK_SESSION_FULL = "Sangfor_FW_V8095.Sangfor_FW_V8095/BlockSession";
export const METHOD_LIST_SECURITY_POLICIES_FULL = "Sangfor_FW_V8095.Sangfor_FW_V8095/ListSecurityPolicies";
export const METHOD_GET_SECURITY_POLICY_FULL = "Sangfor_FW_V8095.Sangfor_FW_V8095/GetSecurityPolicy";

const DEFAULT_NAMESPACE = "public";
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_BLACKLIST_DESCRIPTION = "OctoBus block";
const DEFAULT_ATTACK = "PLT-MANUAL";
const DEFAULT_CREATOR = "AF";

const SUCCESS_CODES = new Set([0]);
const IDEMPOTENT_ADD_CODES = new Set([0, 17]);
const IDEMPOTENT_DELETE_CODES = new Set([0, 1004]);

let skipTlsVerifyDispatcher;

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const unwrap = (value) => {
  if (value === undefined || value === null) return "";
  if (typeof value === "object" && hasOwn(value, "value")) return unwrap(value.value);
  return String(value);
};

const trim = (value) => unwrap(value).trim();

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const fail = (code, message) => new GrpcError(grpcCodeFor(code), message);

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

const toInt = (value, fallback) => {
  const raw = typeof value === "object" && hasOwn(value, "value") ? value.value : value;
  if (raw === undefined || raw === null || raw === "") return fallback;
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.trunc(num);
};

const asArray = (value) => {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.values)) return value.values;
  return [value];
};

const stringList = (value) => asArray(value).map(trim).filter(Boolean);

const plainObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  if (value.fields && typeof value.fields === "object") {
    return Object.fromEntries(Object.entries(value.fields).map(([key, field]) => [key, fromProtoValue(field)]));
  }
  return value;
};

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

const normalizeBaseUrl = (value) => {
  try {
    const url = new URL(trim(value));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
};

const redact = (value) => String(value ?? "")
  .replace(/(token|password|cookie|authorization)(["'\s:=]+)[^\s,"'}]+/gi, "$1$2[REDACTED]")
  .slice(0, 512);

const readBoundedText = async (res) => {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw fail("UNAVAILABLE", "upstream response exceeded size limit");
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw fail("UNAVAILABLE", "upstream response exceeded size limit");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
};

const normalizeNamespace = (value) => {
  const ns = trim(value) || DEFAULT_NAMESPACE;
  if (!/^[A-Za-z0-9_.-]+$/.test(ns)) throw fail("INVALID_ARGUMENT", "namespace contains unsupported characters");
  return ns;
};

const requireToken = (ctx, req = {}) => {
  const token = trim(firstDefined(req.token, ctx.token));
  if (!token) throw fail("INVALID_ARGUMENT", "token is required, or configure username/password for auto login");
  return token;
};

const requireCredentials = (ctx, req = {}) => {
  const username = trim(firstDefined(req.username, req.name, ctx.secret.username, ctx.secret.user));
  const password = trim(firstDefined(req.password, ctx.secret.password));
  if (!username) throw fail("INVALID_ARGUMENT", "username is required");
  if (!password) throw fail("INVALID_ARGUMENT", "password is required");
  return { username, password };
};

const mapResponse = (json, rawJson) => {
  const code = Number(json?.code ?? 0);
  return {
    code: Number.isFinite(code) ? code : 0,
    message: trim(json?.message),
    data: json?.data ?? null,
    raw_json: rawJson,
  };
};

const assertApiSuccess = (response, allowedCodes, action) => {
  if (allowedCodes.has(response.code)) return response;
  if (response.code === 1 || response.code === 13) {
    throw fail("PERMISSION_DENIED", `${action} failed: code=${response.code} ${response.message}`);
  }
  if (response.code === 1003 || response.code === 1012) {
    throw fail("UNAUTHENTICATED", `${action} failed: code=${response.code} ${response.message}`);
  }
  if (response.code === 22 || response.code === 1001 || response.code === 1005) {
    throw fail("INVALID_ARGUMENT", `${action} failed: code=${response.code} ${response.message}`);
  }
  throw fail("FAILED_PRECONDITION", `${action} failed: code=${response.code} ${response.message}`);
};

const buildQuery = (params) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : "";
};

const nameSegment = (value, field = "name") => {
  const name = trim(value);
  if (!name) throw fail("INVALID_ARGUMENT", `${field} is required`);
  return encodeURIComponent(name);
};

const getSkipTlsVerifyDispatcher = () => {
  skipTlsVerifyDispatcher ??= new Agent({ connect: { rejectUnauthorized: false } });
  return skipTlsVerifyDispatcher;
};

const createContext = (runtimeCtx = {}) => {
  const config = runtimeCtx.config ?? {};
  const secret = runtimeCtx.secret ?? {};
  const bindings = { ...config, ...secret, ...(runtimeCtx.bindings ?? {}) };
  const baseUrl = [bindings.host, bindings.baseUrl, bindings.restBaseUrl]
    .map(normalizeBaseUrl)
    .find(Boolean) ?? "";
  if (!baseUrl) throw fail("INVALID_ARGUMENT", "config.host/baseUrl/restBaseUrl must be an http(s) URL");
  const namespace = normalizeNamespace(bindings.namespace);
  const timeoutMs = Math.max(1, toInt(firstDefined(runtimeCtx.limits?.timeoutMs, bindings.timeoutMs), DEFAULT_TIMEOUT_MS));
  const headers = bindings.headers && typeof bindings.headers === "object" ? bindings.headers : {};
  const dispatcher = toBool(bindings.skipTlsVerify) ? getSkipTlsVerifyDispatcher() : undefined;
  return { baseUrl, namespace, timeoutMs, headers, dispatcher, secret, token: trim(bindings.token) };
};

const path = (ctx, suffix) => `/api/v1/namespaces/${encodeURIComponent(ctx.namespace)}${suffix}`;
const batchPath = (ctx, suffix) => `/api/batch/v1/namespaces/${encodeURIComponent(ctx.namespace)}${suffix}`;

const apiFetch = async (ctx, method, apiPath, { token, body, query } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);
  const url = `${ctx.baseUrl}${apiPath}${query ? buildQuery(query) : ""}`;
  const headers = {
    ...ctx.headers,
    Accept: "application/json",
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    ...(token ? { Cookie: `token=${encodeURIComponent(token)}` } : {}),
  };
  try {
    const res = await undiciFetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      dispatcher: ctx.dispatcher,
      redirect: "error",
    });
    const raw = await readBoundedText(res);
    if (!res.ok) {
      const detail = redact(raw);
      if (res.status === 401 || res.status === 403) throw fail("PERMISSION_DENIED", `upstream HTTP ${res.status}: ${detail}`);
      if (res.status >= 400 && res.status < 500) throw fail("FAILED_PRECONDITION", `upstream HTTP ${res.status}: ${detail}`);
      throw fail("UNAVAILABLE", `upstream HTTP ${res.status}: ${detail}`);
    }
    const json = raw ? JSON.parse(raw) : {};
    return mapResponse(json, raw);
  } catch (err) {
    if (err instanceof GrpcError) throw err;
    if (err?.name === "AbortError") throw fail("UNAVAILABLE", `upstream timeout after ${ctx.timeoutMs}ms`);
    if (err instanceof SyntaxError) throw fail("UNKNOWN", "upstream response is not valid JSON");
    throw fail("UNAVAILABLE", redact(err?.message || "upstream request failed"));
  } finally {
    clearTimeout(timer);
  }
};

const login = async (req = {}, runtimeCtx = {}) => {
  const ctx = createContext(runtimeCtx);
  const { username, password } = requireCredentials(ctx, req);
  const response = await apiFetch(ctx, "POST", path(ctx, "/login"), {
    body: { name: username, password },
  });
  assertApiSuccess(response, SUCCESS_CODES, "Login");
  const token = trim(response.data?.loginResult?.token);
  if (!token) throw fail("UNKNOWN", "login succeeded but token is empty");
  return { ...response, token };
};

const withToken = async (req, runtimeCtx) => {
  const ctx = createContext(runtimeCtx);
  const explicit = trim(req?.token);
  if (explicit) return { ctx, token: explicit };
  if (ctx.token) return { ctx, token: ctx.token };
  const loginResponse = await login({}, runtimeCtx);
  return { ctx, token: loginResponse.token };
};

const keepAlive = async (req = {}, runtimeCtx = {}) => {
  const { ctx, token } = await withToken(req, runtimeCtx);
  const response = await apiFetch(ctx, "GET", path(ctx, "/keepalive"), { token });
  return assertApiSuccess(response, SUCCESS_CODES, "KeepAlive");
};

const logout = async (req = {}, runtimeCtx = {}) => {
  const ctx = createContext(runtimeCtx);
  const token = requireToken(ctx, req);
  const response = await apiFetch(ctx, "POST", path(ctx, "/logout"), {
    token,
    body: { loginResult: { token }, namespace: ctx.namespace },
  });
  return assertApiSuccess(response, SUCCESS_CODES, "Logout");
};

const listBlackWhiteList = async (req = {}, runtimeCtx = {}) => {
  const { ctx, token } = await withToken(req, runtimeCtx);
  const type = (trim(req.type) || "BLACK").toUpperCase();
  const response = await apiFetch(ctx, "GET", path(ctx, "/whiteblacklist"), {
    token,
    query: {
      type,
      _search: trim(req.search),
      url: trim(req.url),
      _start: toInt(req.start, undefined),
      _length: toInt(req.length, undefined),
    },
  });
  return assertApiSuccess(response, SUCCESS_CODES, "ListBlackWhiteList");
};

const buildBlacklistEntries = (req = {}) => {
  const targets = stringList(firstDefined(req.targets, req.addresses, req.ips));
  if (targets.length === 0) throw fail("INVALID_ARGUMENT", "targets must contain at least one entry");
  const description = trim(req.description) || DEFAULT_BLACKLIST_DESCRIPTION;
  const enable = toBool(req.enable, true);
  return targets.map((url) => ({ url, type: "BLACK", description, enable }));
};

const addBlacklist = async (req = {}, runtimeCtx = {}) => {
  const { ctx, token } = await withToken(req, runtimeCtx);
  const overrideMode = trim(req.override_mode || req.overrideMode);
  const response = await apiFetch(ctx, "POST", batchPath(ctx, "/whiteblacklist"), {
    token,
    body: buildBlacklistEntries(req),
    query: { override: overrideMode },
  });
  return assertApiSuccess(response, IDEMPOTENT_ADD_CODES, "AddBlacklist");
};

const removeBlacklist = async (req = {}, runtimeCtx = {}) => {
  const { ctx, token } = await withToken(req, runtimeCtx);
  const response = await apiFetch(ctx, "POST", batchPath(ctx, "/whiteblacklist"), {
    token,
    body: buildBlacklistEntries(req).map(({ url }) => ({ url })),
    query: { _method: "delete" },
  });
  return assertApiSuccess(response, IDEMPOTENT_DELETE_CODES, "RemoveBlacklist");
};

const listBlockedIP = async (req = {}, runtimeCtx = {}) => {
  const { ctx, token } = await withToken(req, runtimeCtx);
  const response = await apiFetch(ctx, "GET", path(ctx, "/blockip"), {
    token,
    query: {
      _search: trim(req.search),
      _start: toInt(req.start, undefined),
      _length: toInt(req.length, undefined),
    },
  });
  return assertApiSuccess(response, SUCCESS_CODES, "ListBlockedIP");
};

const blockIP = async (req = {}, runtimeCtx = {}) => {
  const srcIP = stringList(req.src_ips || req.srcIP || req.srcIp);
  const dstIP = stringList(req.dst_ips || req.dstIP || req.dstIp);
  const dns = stringList(req.dns);
  const url = stringList(req.urls || req.url);
  const targetTypes = [
    ["SRC", "srcIP", srcIP],
    ["DST", "dstIP", dstIP],
    ["DNS", "dns", dns],
    ["URL", "url", url],
  ].filter(([, , values]) => values.length > 0);
  if (targetTypes.length === 0) {
    throw fail("INVALID_ARGUMENT", "one of src_ips, dst_ips, dns, or urls is required");
  }
  if (targetTypes.length > 1) {
    throw fail("INVALID_ARGUMENT", "only one target type can be used per BlockIP request");
  }
  const { ctx, token } = await withToken(req, runtimeCtx);
  const [ipType, targetKey, targetValues] = targetTypes[0];
  const body = {
    ipType,
    [targetKey]: targetValues,
    ...(toInt(req.dst_port ?? req.dstPort, 0) > 0 ? { dstPort: toInt(req.dst_port ?? req.dstPort, 0) } : {}),
    blockTime: trim(req.block_time || req.blockTime) || "1d",
    attack: trim(req.attack) || DEFAULT_ATTACK,
    ...(trim(req.scope) ? { scope: trim(req.scope) } : {}),
  };
  const response = await apiFetch(ctx, "POST", batchPath(ctx, "/blockip"), {
    token,
    body,
    query: { creator: trim(req.creator) || DEFAULT_CREATOR },
  });
  return assertApiSuccess(response, IDEMPOTENT_ADD_CODES, "BlockIP");
};

const businessBlockIP = async (req = {}, runtimeCtx = {}) => {
  return blockIP({ ...req, scope: "BUSINESS" }, runtimeCtx);
};

const unblockIP = async (req = {}, runtimeCtx = {}) => {
  const { ctx, token } = await withToken(req, runtimeCtx);
  const items = asArray(req.items).map((item) => ({
    ...(trim(item.src_ip || item.srcIP || item.srcIp) ? { srcIP: trim(item.src_ip || item.srcIP || item.srcIp) } : {}),
    ...(trim(item.dst_ip || item.dstIP || item.dstIp) ? { dstIP: trim(item.dst_ip || item.dstIP || item.dstIp) } : {}),
    ...(trim(item.dns) ? { dns: trim(item.dns) } : {}),
    ...(trim(item.url) ? { url: trim(item.url) } : {}),
    ...(toInt(item.dst_port ?? item.dstPort, 0) > 0 ? { dstPort: toInt(item.dst_port ?? item.dstPort, 0) } : {}),
    attack: trim(item.attack) || DEFAULT_ATTACK,
    scope: trim(item.scope) || "GLOBAL",
  })).filter((item) => item.srcIP || item.dstIP || item.dns || item.url);
  if (items.length === 0) throw fail("INVALID_ARGUMENT", "items must contain at least one src_ip, dst_ip, dns, or url entry");
  const response = await apiFetch(ctx, "POST", batchPath(ctx, "/blockip"), {
    token,
    body: items,
    query: { _method: "delete" },
  });
  return assertApiSuccess(response, IDEMPOTENT_DELETE_CODES, "UnblockIP");
};

const businessUnblockIP = async (req = {}, runtimeCtx = {}) => {
  return unblockIP({
    ...req,
    items: asArray(req.items).map((item) => ({ ...item, scope: "BUSINESS" })),
  }, runtimeCtx);
};

const getBlockTime = async (req = {}, runtimeCtx = {}) => {
  const { ctx, token } = await withToken(req, runtimeCtx);
  const response = await apiFetch(ctx, "GET", path(ctx, "/blockiptime"), { token });
  return assertApiSuccess(response, SUCCESS_CODES, "GetBlockTime");
};

const setBlockTime = async (req = {}, runtimeCtx = {}) => {
  const { ctx, token } = await withToken(req, runtimeCtx);
  const blockTime = trim(req.block_time || req.blockTime);
  if (!/^\d+[mhd]$/.test(blockTime)) throw fail("INVALID_ARGUMENT", "block_time must use Sangfor duration format, for example 30m, 1h, or 1d");
  const response = await apiFetch(ctx, "PATCH", path(ctx, "/blockiptime"), {
    token,
    body: { blockTime },
  });
  return assertApiSuccess(response, SUCCESS_CODES, "SetBlockTime");
};

const listIPGroups = async (req = {}, runtimeCtx = {}) => {
  const { ctx, token } = await withToken(req, runtimeCtx);
  const response = await apiFetch(ctx, "GET", path(ctx, "/ipgroups"), {
    token,
    query: {
      _search: trim(req.search),
      __nameprefix: trim(req.name_prefix || req.namePrefix),
      _start: toInt(req.start, undefined),
      _length: toInt(req.length, undefined),
      businessType: trim(req.business_type || req.businessType),
      addressType: trim(req.address_type || req.addressType),
      important: trim(req.important),
      _order: trim(req.order),
      _sortby: trim(req.sort_by || req.sortBy),
      _select: trim(req.select),
      hasref: trim(req.has_ref || req.hasRef),
      excludeAll: trim(req.exclude_all || req.excludeAll),
      hasSensitiveData: trim(req.has_sensitive_data || req.hasSensitiveData),
      getRefBy: trim(req.get_ref_by || req.getRefBy),
      excludeOobManagePeerIPGroup: firstDefined(req.exclude_oob_manage_peer_ip_group, req.excludeOobManagePeerIPGroup),
    },
  });
  return assertApiSuccess(response, SUCCESS_CODES, "ListIPGroups");
};

const getIPGroup = async (req = {}, runtimeCtx = {}) => {
  const { ctx, token } = await withToken(req, runtimeCtx);
  const response = await apiFetch(ctx, "GET", `${path(ctx, "/ipgroups")}/${nameSegment(req.name)}`, {
    token,
    query: { _search: trim(req.search) },
  });
  return assertApiSuccess(response, SUCCESS_CODES, "GetIPGroup");
};

const buildIPGroupBody = (req = {}) => {
  const name = trim(req.name);
  if (!name) throw fail("INVALID_ARGUMENT", "name is required");
  const ipRanges = asArray(req.ip_ranges || req.ipRanges).map((range) => ({
    start: trim(range.start),
    ...(trim(range.end) ? { end: trim(range.end) } : {}),
    ...(toInt(range.bits, 0) > 0 ? { bits: toInt(range.bits, 0) } : {}),
  })).filter((range) => range.start);
  const domains = stringList(req.domains);
  const refIpGroup = stringList(req.ref_ip_group || req.refIpGroup);
  if (ipRanges.length + domains.length + refIpGroup.length === 0) {
    throw fail("INVALID_ARGUMENT", "one of ip_ranges, domains, or ref_ip_group is required");
  }
  return {
    name,
    businessType: trim(req.business_type || req.businessType) || "IP",
    ...(trim(req.description) ? { description: trim(req.description) } : {}),
    addressType: trim(req.address_type || req.addressType) || "IPV4",
    ...(ipRanges.length ? { ipRanges } : {}),
    ...(domains.length ? { domains } : {}),
    ...(trim(req.domains_detect_mode || req.domainsDetectMode) ? { domainsDetectMode: trim(req.domains_detect_mode || req.domainsDetectMode) } : {}),
    ...(refIpGroup.length ? { refIpGroup } : {}),
    ...(trim(req.important) ? { important: trim(req.important) } : {}),
    ...(trim(req.data_status || req.dataStatus) ? { dataStatus: trim(req.data_status || req.dataStatus) } : {}),
  };
};

const addIPGroup = async (req = {}, runtimeCtx = {}) => {
  const { ctx, token } = await withToken(req, runtimeCtx);
  const response = await apiFetch(ctx, "POST", path(ctx, "/ipgroups"), {
    token,
    body: buildIPGroupBody(req),
  });
  return assertApiSuccess(response, IDEMPOTENT_ADD_CODES, "AddIPGroup");
};

const deleteIPGroup = async (req = {}, runtimeCtx = {}) => {
  const { ctx, token } = await withToken(req, runtimeCtx);
  const response = await apiFetch(ctx, "DELETE", `${path(ctx, "/ipgroups")}/${nameSegment(req.name)}`, { token });
  return assertApiSuccess(response, IDEMPOTENT_DELETE_CODES, "DeleteIPGroup");
};

const querySessions = async (req = {}, runtimeCtx = {}) => {
  const { ctx, token } = await withToken(req, runtimeCtx);
  const response = await apiFetch(ctx, "POST", path(ctx, "/sessions"), {
    token,
    query: {
      _method: "get",
      _start: toInt(req.start, undefined),
      _length: toInt(req.length, undefined),
      _privateoffset: trim(req.private_offset || req.privateOffset),
    },
    body: plainObject(req.filter),
  });
  return assertApiSuccess(response, SUCCESS_CODES, "QuerySessions");
};

const blockSession = async (req = {}, runtimeCtx = {}) => {
  const body = {
    srcIp: trim(req.src_ip || req.srcIp),
    dstIp: trim(req.dst_ip || req.dstIp),
    proto: toInt(req.proto, 0),
    srcPort: toInt(req.src_port || req.srcPort, 0),
    dstPort: toInt(req.dst_port || req.dstPort, 0),
  };
  for (const [key, value] of Object.entries(body)) {
    if (!value) throw fail("INVALID_ARGUMENT", `${key} is required`);
  }
  const { ctx, token } = await withToken(req, runtimeCtx);
  const response = await apiFetch(ctx, "PATCH", path(ctx, "/sessions/status"), { token, body });
  return assertApiSuccess(response, SUCCESS_CODES, "BlockSession");
};

const listSecurityPolicies = async (req = {}, runtimeCtx = {}) => {
  const { ctx, token } = await withToken(req, runtimeCtx);
  const response = await apiFetch(ctx, "GET", path(ctx, "/securitys"), {
    token,
    query: {
      _search: trim(req.search),
      _start: toInt(req.start, undefined),
      _length: toInt(req.length, undefined),
      policyType: trim(req.policy_type || req.policyType),
      srcip: trim(req.srcip || req.src_ip || req.srcIp),
      dstip: trim(req.dstip || req.dst_ip || req.dstIp),
      _order: trim(req.order),
      _sortby: trim(req.sort_by || req.sortBy),
      _select: trim(req.select),
    },
  });
  return assertApiSuccess(response, SUCCESS_CODES, "ListSecurityPolicies");
};

const getSecurityPolicy = async (req = {}, runtimeCtx = {}) => {
  const { ctx, token } = await withToken(req, runtimeCtx);
  const response = await apiFetch(ctx, "GET", `${path(ctx, "/securitys")}/${nameSegment(req.name)}`, { token });
  return assertApiSuccess(response, SUCCESS_CODES, "GetSecurityPolicy");
};

const contextHandler = (operation) => async (first = {}, legacyCtx) => {
  if (legacyCtx !== undefined) return operation(first, legacyCtx);
  return operation(first.req ?? first.request ?? {}, first);
};

export const handlers = {
  [METHOD_LOGIN_FULL]: contextHandler(login),
  [METHOD_KEEP_ALIVE_FULL]: contextHandler(keepAlive),
  [METHOD_LOGOUT_FULL]: contextHandler(logout),
  [METHOD_LIST_BLACK_WHITE_FULL]: contextHandler(listBlackWhiteList),
  [METHOD_ADD_BLACKLIST_FULL]: contextHandler(addBlacklist),
  [METHOD_REMOVE_BLACKLIST_FULL]: contextHandler(removeBlacklist),
  [METHOD_LIST_BLOCKED_IP_FULL]: contextHandler(listBlockedIP),
  [METHOD_BLOCK_IP_FULL]: contextHandler(blockIP),
  [METHOD_UNBLOCK_IP_FULL]: contextHandler(unblockIP),
  [METHOD_GET_BLOCK_TIME_FULL]: contextHandler(getBlockTime),
  [METHOD_SET_BLOCK_TIME_FULL]: contextHandler(setBlockTime),
  [METHOD_LIST_IP_GROUPS_FULL]: contextHandler(listIPGroups),
  [METHOD_GET_IP_GROUP_FULL]: contextHandler(getIPGroup),
  [METHOD_ADD_IP_GROUP_FULL]: contextHandler(addIPGroup),
  [METHOD_DELETE_IP_GROUP_FULL]: contextHandler(deleteIPGroup),
  [METHOD_BUSINESS_BLOCK_IP_FULL]: contextHandler(businessBlockIP),
  [METHOD_BUSINESS_UNBLOCK_IP_FULL]: contextHandler(businessUnblockIP),
  [METHOD_QUERY_SESSIONS_FULL]: contextHandler(querySessions),
  [METHOD_BLOCK_SESSION_FULL]: contextHandler(blockSession),
  [METHOD_LIST_SECURITY_POLICIES_FULL]: contextHandler(listSecurityPolicies),
  [METHOD_GET_SECURITY_POLICY_FULL]: contextHandler(getSecurityPolicy),
};

export const _test = {
  asArray,
  buildIPGroupBody,
  buildBlacklistEntries,
  buildQuery,
  createContext,
  fromProtoValue,
  getSkipTlsVerifyDispatcher,
  handlers,
  mapResponse,
  normalizeBaseUrl,
  normalizeNamespace,
  plainObject,
  readBoundedText,
  redact,
  stringList,
  toBool,
  toInt,
};
