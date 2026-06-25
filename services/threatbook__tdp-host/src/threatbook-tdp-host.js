// 微步在线 TDP（威胁检测平台）web 控制台 API 适配。
// 覆盖能力：查询失陷主机汇总列表 /api/web/host/getFallHostSumList。
// 认证方式：tdp-authentication 头部令牌（非 api_key/HMAC，与 threatbook__tdp 联动封禁包互补）。
import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const METHOD_QUERY_FALL_HOST_PATH = '/ThreatBook_TDP_Host.ThreatBook_TDP_Host/QueryFallHostList';
export const METHOD_QUERY_FALL_HOST_FULL = 'ThreatBook_TDP_Host.ThreatBook_TDP_Host/QueryFallHostList';

export const DEFAULT_TIMEOUT_MS = 5000;
export const FALL_HOST_PATH = '/api/web/host/getFallHostSumList';
export const TDP_AUTH_HEADER = 'tdp-authentication';
export const DEFAULT_WINDOW_SECONDS = 7 * 24 * 60 * 60;
export const TRANSPORT_SUCCESS_CODES = new Set([200, 201, 204]);

export const DEFAULT_DIRECTIONS = ['in', 'lateral', 'out'];
export const DEFAULT_THREAT_TYPES = [
  'exploit', 'ransom', 'phishing', 'unknown_url', 'file', 'virus', 'tunneling',
  'infil', 'dc', 'persistence', 'shell', 'c2', 'trojan', 'botnet', 'worm', 'rat',
  'dga', 'mining', 'exfil', 'dnslog', 'attack_out', 'hfish_honeypot', 'post_exploit',
];
export const DEFAULT_FUZZY_FIELDS = ['threat.name', 'external_ip', 'machine', 'assets.name', 'data', 'machine_name'];

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const trimString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

const toInt = (value, fallback = 0) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return fallback;
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.trunc(num);
};

const toValue = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return Number.isFinite(value) ? { numberValue: value } : { stringValue: String(value) };
  if (typeof value === 'boolean') return { boolValue: value };
  if (Array.isArray(value)) {
    return { listValue: { values: value.map(toValue).filter((item) => item !== undefined) } };
  }
  if (typeof value === 'object') {
    const fields = {};
    for (const [key, innerValue] of Object.entries(value)) {
      fields[key] = toValue(innerValue) ?? { nullValue: 'NULL_VALUE' };
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(value) };
};

const extractList = (rawList) => {
  const raw = unwrapScalar(rawList);
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object' && Array.isArray(raw.values)) return raw.values;
  return [];
};

const normalizeStringList = (rawList, fallback = []) => {
  const items = extractList(rawList)
    .map((item) => trimString(item))
    .filter((item) => item);
  return items.length > 0 ? items : [...fallback];
};

// 把 protobuf Struct / 普通对象解析为 JS 对象（用于 extra_condition 透传）。
const plainStruct = (value) => {
  const raw = unwrapScalar(value);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  if (raw.fields && typeof raw.fields === 'object') {
    const out = {};
    for (const [key, field] of Object.entries(raw.fields)) out[key] = decodeStructField(field);
    return out;
  }
  return raw;
};

const decodeStructField = (field) => {
  if (!field || typeof field !== 'object') return field;
  if (hasOwn(field, 'stringValue')) return field.stringValue;
  if (hasOwn(field, 'numberValue')) return field.numberValue;
  if (hasOwn(field, 'boolValue')) return field.boolValue;
  if (hasOwn(field, 'nullValue')) return null;
  if (hasOwn(field, 'listValue')) return (field.listValue?.values ?? []).map(decodeStructField);
  if (hasOwn(field, 'structValue')) {
    const out = {};
    for (const [key, inner] of Object.entries(field.structValue?.fields ?? {})) out[key] = decodeStructField(inner);
    return out;
  }
  return field;
};

const normalizeBaseUrl = (url) => {
  const base = trimString(url);
  if (!/^https?:\/\//i.test(base)) return null;
  return base.replace(/\/+$/, '');
};

const toBoolean = (value) => {
  const raw = unwrapScalar(value);
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw !== 0;
  if (typeof raw === 'string') {
    const text = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'n', 'off', ''].includes(text)) return false;
  }
  return false;
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx.config ?? {}),
  ...(ctx.secret ?? {}),
  ...(ctx.bindings ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.req ?? ctx.request ?? {},
});

const normalizeBindings = (rawBindings = {}) => {
  const baseUrl = normalizeBaseUrl(firstDefined(rawBindings.restBaseUrl, rawBindings.baseUrl));
  if (!baseUrl) throw errorWithCode('INVALID_ARGUMENT', 'restBaseUrl/baseUrl binding is required (http/https)');
  const token = trimString(firstDefined(
    rawBindings.tdp_authentication,
    rawBindings.tdpAuthentication,
    rawBindings.token,
  ));
  if (!token) throw errorWithCode('INVALID_ARGUMENT', 'tdp_authentication token binding is required');
  const headers = rawBindings.headers && typeof rawBindings.headers === 'object' ? rawBindings.headers : {};
  const skipTlsVerify = toBoolean(firstDefined(rawBindings.tlsInsecureSkipVerify, rawBindings.skipTlsVerify));
  return { baseUrl, token, headers, skipTlsVerify };
};

const resolveTimeoutMs = (ctx = {}) => {
  const raw = Number(firstDefined(ctx.limits?.timeoutMs, ctx.bindings?.timeoutMs, DEFAULT_TIMEOUT_MS));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

const nowSeconds = () => Math.floor(Date.now() / 1000);

const buildLogPrefix = (meta = {}, action) => {
  const trace = [];
  if (meta.instance_id || meta.instanceId) trace.push(`inst=${meta.instance_id || meta.instanceId}`);
  if (meta.request_id || meta.requestId) trace.push(`req=${meta.request_id || meta.requestId}`);
  return `[ThreatBook_TDP_Host][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
};

const logFlow = (meta, action, details) => {
  const prefix = buildLogPrefix(meta, action);
  try {
    console.log(prefix, JSON.stringify(details));
  } catch {
    console.log(prefix, details);
  }
};

// 依据请求构造 TDP web API 的 {condition, page} 报文，缺省值对齐控制台抓包。
const buildQueryPayload = (req = {}) => {
  const timeTo = toInt(req.time_to ?? req.timeTo, 0) || nowSeconds();
  const timeFrom = toInt(req.time_from ?? req.timeFrom, 0) || (timeTo - DEFAULT_WINDOW_SECONDS);
  const condition = {
    direction: normalizeStringList(req.direction, DEFAULT_DIRECTIONS),
    result: trimString(req.result),
    threat_type: normalizeStringList(req.threat_type ?? req.threatType, DEFAULT_THREAT_TYPES),
    asset_section: [],
    time_from: timeFrom,
    time_to: timeTo,
    machine_type: [],
    assets_group: [],
    status: normalizeStringList(req.status),
    disposal_status: normalizeStringList(req.disposal_status ?? req.disposalStatus),
    host_type: [],
    asset_levels: [],
    fuzzy: { keyword: trimString(req.keyword), fieldlist: [...DEFAULT_FUZZY_FIELDS] },
    host_disposal_status: [],
    ...plainStruct(req.extra_condition ?? req.extraCondition),
  };
  const page = {
    cur_page: toInt(req.cur_page ?? req.curPage, 1) || 1,
    page_size: toInt(req.page_size ?? req.pageSize, 20) || 20,
    sort_by: trimString(req.sort_by ?? req.sortBy) || 'severity',
    sort_flag: trimString(req.sort_flag ?? req.sortFlag) || 'desc',
  };
  return { condition, page };
};

const mapHttpError = (statusCode, text) => {
  if (statusCode === 401 || statusCode === 403) throw errorWithCode('PERMISSION_DENIED', `upstream http ${statusCode}: ${text}`);
  if (statusCode >= 400 && statusCode < 500) throw errorWithCode('FAILED_PRECONDITION', `upstream http ${statusCode}: ${text}`);
  throw errorWithCode('UNAVAILABLE', `upstream http ${statusCode}: ${text}`);
};

const prepareRuntime = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  return {
    ...callCtx,
    bindings: normalizeBindings(callCtx.bindings),
    timeoutMs: resolveTimeoutMs(callCtx),
  };
};

const queryFallHostList = async (req = {}, ctx = {}) => {
  const runtime = prepareRuntime(ctx);
  const startTime = Date.now();
  const payload = buildQueryPayload(req);
  const url = `${runtime.bindings.baseUrl}${FALL_HOST_PATH}`;
  const headers = {
    'Content-Type': 'application/json;charset=UTF-8',
    Accept: 'application/json, text/plain, */*',
    [TDP_AUTH_HEADER]: runtime.bindings.token,
    ...runtime.bindings.headers,
  };
  const tlsOptions = runtime.bindings.skipTlsVerify ? { insecureSkipVerify: true, tlsInsecureSkipVerify: true, skipTlsVerify: true } : {};

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      timeoutMs: runtime.timeoutMs,
      ...tlsOptions,
    });
  } catch (err) {
    const reason = err?.cause?.message || err?.message || 'fetch failed';
    logFlow(runtime.meta, 'QueryFallHostList', { attempt_url: runtime.bindings.baseUrl, status: 'fetch_error', latency: Date.now() - startTime, reason });
    throw errorWithCode('UNAVAILABLE', reason);
  }

  let text;
  try {
    text = await res.text();
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', err?.message || 'response read failed');
  }
  const statusCode = res.status;
  if (!TRANSPORT_SUCCESS_CODES.has(statusCode)) mapHttpError(statusCode, text);

  if (!String(text || '').trim()) throw errorWithCode('UNKNOWN', 'response body is empty');
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', 'response is not valid JSON');
  }

  const responseCode = toInt(json?.response_code, 0);
  if (responseCode !== 0) {
    const message = trimString(firstDefined(json?.response_message, json?.message)) || `response_code ${responseCode}`;
    throw errorWithCode('FAILED_PRECONDITION', `upstream business error: ${message}`);
  }

  const data = json && typeof json.data === 'object' && json.data !== null ? json.data : {};
  const items = Array.isArray(data.items) ? data.items : [];
  logFlow(runtime.meta, 'QueryFallHostList', {
    attempt_url: runtime.bindings.baseUrl,
    http_status: statusCode,
    response_code: responseCode,
    item_count: items.length,
    cur_page: payload.page.cur_page,
    latency: Date.now() - startTime,
  });

  return {
    response_code: responseCode,
    item_count: items.length,
    data: toValue(data),
    raw_json: toValue(json),
  };
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_QUERY_FALL_HOST_PATH]: async (req) => queryFallHostList(req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_QUERY_FALL_HOST_FULL]: (req, ctx = {}) => queryFallHostList(req, ctx),
};

export const _test = {
  buildLogPrefix,
  buildQueryPayload,
  decodeStructField,
  errorWithCode,
  extractList,
  firstDefined,
  grpcCodeFor,
  hasOwn,
  logFlow,
  mapHttpError,
  mergedBindings,
  normalizeBaseUrl,
  normalizeBindings,
  normalizeStringList,
  nowSeconds,
  plainStruct,
  prepareRuntime,
  queryFallHostList,
  resolveCallContext,
  resolveTimeoutMs,
  toBoolean,
  toInt,
  toValue,
  trimString,
  unwrapScalar,
};
