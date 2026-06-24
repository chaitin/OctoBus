// 奇安信网神 SecGate3600 防火墙 V3.6.6.0 RESTful API 适配。
// 覆盖能力：登录、IP 地址黑名单封禁/解禁/查询、注销。
import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const SVC = 'QIANXIN_FW_SecGate3600_V3_6_6.QIANXIN_FW_SecGate3600_V3_6_6';
export const LOGIN_PATH = `/${SVC}/Login`;
export const BLOCK_PATH = `/${SVC}/BlockIP`;
export const UNBLOCK_PATH = `/${SVC}/UnblockIP`;
export const QUERY_PATH = `/${SVC}/QueryBlacklist`;
export const LOGOUT_PATH = `/${SVC}/Logout`;

export const METHOD_LOGIN_FULL = `${SVC}/Login`;
export const METHOD_BLOCK_FULL = `${SVC}/BlockIP`;
export const METHOD_UNBLOCK_FULL = `${SVC}/UnblockIP`;
export const METHOD_QUERY_FULL = `${SVC}/QueryBlacklist`;
export const METHOD_LOGOUT_FULL = `${SVC}/Logout`;

export const LOGIN_URI = '/v1.0/login';
export const REST_URI = '/v1.0/rest/';
export const LOGOUT_URI = '/v1.0/out';
export const BLACKLIST_MODULE = 'addr_blacklist';
export const ADD_FUNCTION = 'add_blacklist_ip';
export const DEL_FUNCTION = 'del_blacklist_by_id';
export const GET_FUNCTION = 'get_blacklist_config';
export const DEFAULT_TIMEOUT_MS = 5000;

const sessionCache = new Map();

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
const firstDefined = (...vals) => vals.find((val) => val !== undefined && val !== null);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const toTrimmedString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

const requireString = (value, fieldName) => {
  const text = toTrimmedString(value);
  if (!text) throw errorWithCode('INVALID_ARGUMENT', `${fieldName} is required`);
  return text;
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.secret ?? {}),
  ...(ctx?.bindings ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.req ?? ctx.request ?? {},
});

const parseAuthority = (authority) => {
  if (!authority) return null;
  const colonIndex = authority.lastIndexOf(':');
  if (colonIndex <= 0) return null;
  const hostPart = authority.slice(0, colonIndex);
  const portPart = authority.slice(colonIndex + 1);
  if (!hostPart || !/^\d+$/.test(portPart)) return null;
  return { hostPart, portPart };
};

const normalizeBaseUrl = (value) => {
  const raw = toTrimmedString(value);
  if (!raw) return '';
  const normalized = raw.replace(/\/+$/, '');
  const schemeMatch = normalized.match(/^(https?):\/\//i);
  if (!schemeMatch) return '';
  const rest = normalized.slice(schemeMatch[0].length);
  const pathIndex = rest.search(/[/?#]/);
  const authority = pathIndex >= 0 ? rest.slice(0, pathIndex) : rest;
  const suffix = pathIndex >= 0 ? rest.slice(pathIndex) : '';
  if (!parseAuthority(authority)) return '';
  if (suffix && suffix !== '/') return '';
  return `${schemeMatch[1].toLowerCase()}://${authority}`;
};

const requireHost = (req, ctx) => {
  const host = normalizeBaseUrl(firstDefined(
    req?.host,
    ctx?.bindings?.host,
    ctx?.bindings?.restBaseUrl,
    ctx?.bindings?.baseUrl,
    ctx?.bindings?.rest_base_url,
    ctx?.bindings?.base_url,
  ));
  if (!host) throw errorWithCode('INVALID_ARGUMENT', 'host is required');
  return host;
};

const resolveTimeoutMs = (ctx) => {
  const bindings = mergedBindings(ctx);
  const raw = Number(firstDefined(ctx?.limits?.timeoutMs, bindings.timeoutMs, bindings.timeout_ms, DEFAULT_TIMEOUT_MS));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

const toBoolean = (value) => {
  const raw = unwrapScalar(value);
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) return false;
  }
  return false;
};

const buildTlsOptions = (bindings) => {
  if (!toBoolean(bindings?.skipTlsVerify) && !toBoolean(bindings?.tlsInsecureSkipVerify) && !toBoolean(bindings?.insecureSkipVerify)) return {};
  return { skipTlsVerify: true, tlsInsecureSkipVerify: true, insecureSkipVerify: true };
};

const buildHeaders = (ctx, extra = {}) => ({ ...(ctx?.bindings?.headers || {}), ...extra });

const getInstanceKey = (ctx) => String(ctx?.meta?.instance_id || ctx?.meta?.instanceId || 'default');

const getInstanceSessionMap = (ctx) => {
  const key = getInstanceKey(ctx);
  let map = sessionCache.get(key);
  if (!map) {
    map = new Map();
    sessionCache.set(key, map);
  }
  return map;
};

const getSession = (ctx, host) => getInstanceSessionMap(ctx).get(host);
const setSession = (ctx, host, session) => getInstanceSessionMap(ctx).set(host, session);
const clearSession = (ctx, host) => getInstanceSessionMap(ctx).delete(host);

const requireSession = (ctx, host) => {
  const session = getSession(ctx, host);
  if (!session?.cookie || !session?.token) throw errorWithCode('FAILED_PRECONDITION', 'call Login first');
  return session;
};

const toInt64 = (value, fallback = 0) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return fallback;
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.trunc(num);
};

const toValue = (val) => {
  const raw = unwrapScalar(val);
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'string') return { stringValue: raw };
  if (typeof raw === 'number') return { numberValue: raw };
  if (typeof raw === 'boolean') return { boolValue: raw };
  if (Array.isArray(raw)) return { listValue: { values: raw.map((item) => toValue(item) ?? { nullValue: 'NULL_VALUE' }) } };
  if (typeof raw === 'object') {
    const fields = {};
    for (const [key, value] of Object.entries(raw)) fields[key] = toValue(value) ?? { nullValue: 'NULL_VALUE' };
    return { structValue: { fields } };
  }
  return { stringValue: String(raw) };
};

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const fetchUpstream = async (ctx, url, init = {}) => {
  try {
    const response = await fetch(url, {
      timeoutMs: resolveTimeoutMs(ctx),
      ...buildTlsOptions(ctx?.bindings || {}),
      ...init,
      headers: buildHeaders(ctx, init.headers || {}),
    });
    const text = await response.text();
    return { status: Number(response.status), text: String(text ?? ''), res: response };
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', err?.cause?.message || err?.message || 'fetch failed');
  }
};

const parseJsonOrThrow = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', 'response is not valid JSON');
  }
};

const requireJsonBody = (text) => {
  if (!String(text || '').trim()) throw errorWithCode('UNKNOWN', 'response body is empty');
  return parseJsonOrThrow(text);
};

// SecGate3600 业务报文统一为 [{head, data}] 或 {head, data}，取首个对象。
const firstEnvelope = (json) => {
  if (Array.isArray(json)) return isPlainObject(json[0]) ? json[0] : {};
  return isPlainObject(json) ? json : {};
};

const throwForAuthStatus = (ctx, host, status) => {
  if (status === 401 || status === 403) {
    clearSession(ctx, host);
    throw errorWithCode('PERMISSION_DENIED', `upstream http ${status}`);
  }
};

const getSetCookies = (res) => {
  const headers = res?.headers;
  if (headers && typeof headers.getSetCookie === 'function') {
    const values = headers.getSetCookie();
    return Array.isArray(values) ? values : [];
  }
  if (headers && typeof headers.get === 'function') {
    const combined = headers.get('set-cookie');
    return combined ? [String(combined)] : [];
  }
  return [];
};

const mergeCookieHeader = (setCookies, token) => {
  const pairs = new Map();
  for (const item of setCookies || []) {
    const raw = String(item || '').trim();
    if (!raw) continue;
    const pair = raw.split(';')[0]?.trim();
    if (!pair) continue;
    const eqIndex = pair.indexOf('=');
    if (eqIndex <= 0) continue;
    pairs.set(pair.slice(0, eqIndex).trim(), pair);
  }
  if (token) pairs.set('token', `token=${token}`);
  return Array.from(pairs.values()).join('; ');
};

const extractHeaders = (res) => {
  const map = new Map();
  const headers = res?.headers;
  if (headers && typeof headers.forEach === 'function') {
    headers.forEach((value, key) => {
      const lower = String(key || '').toLowerCase();
      if (!lower) return;
      const existing = map.get(lower) || [];
      existing.push(String(value ?? ''));
      map.set(lower, existing);
    });
  }
  const setCookies = getSetCookies(res);
  if (setCookies.length > 0) map.set('set-cookie', setCookies.map((value) => String(value ?? '')));
  return Array.from(map.entries()).map(([key, values]) => ({ key, values }));
};

const sendRestEnvelope = async (ctx, host, session, fn, body) => {
  const upstream = await fetchUpstream(ctx, `${host}${REST_URI}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: session.cookie },
    body: JSON.stringify([{ head: { module: BLACKLIST_MODULE, function: fn }, body }]),
  });
  throwForAuthStatus(ctx, host, upstream.status);
  const json = requireJsonBody(upstream.text);
  return { upstream, json, head: isPlainObject(firstEnvelope(json).head) ? firstEnvelope(json).head : {} };
};

// ---- request normalization ----

const normalizeBlockItem = (item, index) => {
  const source = item || {};
  const ipStart = requireString(source.ip_start ?? source.ipStart, `items[${index}].ip_start`);
  const ipEnd = toTrimmedString(source.ip_end ?? source.ipEnd) || ipStart;
  const entry = { ip_start: ipStart, ip_end: ipEnd, enable: toTrimmedString(source.enable) || 'enable' };
  const desc = toTrimmedString(source.desc);
  if (desc) entry.desc = desc;
  const schedule = toTrimmedString(source.schedule);
  if (schedule) entry.schedule = schedule;
  return entry;
};

const normalizeBlockItems = (req) => {
  const items = Array.isArray(req?.items) ? req.items : [];
  if (items.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'items must be a non-empty array');
  return items.map((item, index) => normalizeBlockItem(item, index));
};

const normalizeUnblockTarget = (target, index) => {
  const source = target || {};
  const ipStart = requireString(source.ip_start ?? source.ipStart, `targets[${index}].ip_start`);
  return { ip_start: ipStart, ip_end: toTrimmedString(source.ip_end ?? source.ipEnd) || ipStart };
};

const normalizeUnblockTargets = (req) => {
  const targets = Array.isArray(req?.targets) ? req.targets : [];
  if (targets.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'targets must be a non-empty array');
  return targets.map((target, index) => normalizeUnblockTarget(target, index));
};

// ---- handlers ----

const handleLogin = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const request = req ?? {};
  const host = requireHost(request, callCtx);
  const username = requireString(firstDefined(request?.username, callCtx?.bindings?.user, callCtx?.bindings?.username), 'username');
  const password = requireString(firstDefined(request?.password, callCtx?.bindings?.password), 'password');
  const upstream = await fetchUpstream(callCtx, `${host}${LOGIN_URI}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const json = requireJsonBody(upstream.text);
  const result = isPlainObject(json?.result) ? json.result : {};
  const token = toTrimmedString(result.token);
  const success = json?.success === true;
  if (success && token) {
    const cookie = mergeCookieHeader(getSetCookies(upstream.res), token);
    if (cookie) setSession(callCtx, host, { token, cookie, username, login_at_ms: Date.now() });
  }
  return {
    success,
    token,
    error_code: toTrimmedString(result.error_code),
    http_status: Number(upstream.status),
    raw_body: String(upstream.text ?? ''),
    raw_json: toValue(json),
    headers: extractHeaders(upstream.res),
  };
};

const handleBlockIP = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const request = req ?? {};
  const host = requireHost(request, callCtx);
  const session = requireSession(callCtx, host);
  const items = normalizeBlockItems(request);
  const results = [];
  // 设备不支持批量下发，逐条提交。
  for (const item of items) {
    const { upstream, json, head } = await sendRestEnvelope(callCtx, host, session, ADD_FUNCTION, {
      addr_blacklist_cp: { blacklist_cp: [item] },
    });
    results.push({
      ip_start: item.ip_start,
      ip_end: item.ip_end,
      error_code: toInt64(head.error_code, 0),
      error_string: toTrimmedString(firstDefined(head.error_string, head.message)),
      http_status: Number(upstream.status),
      raw_json: toValue(json),
    });
  }
  return { results };
};

const handleUnblockIP = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const request = req ?? {};
  const host = requireHost(request, callCtx);
  const session = requireSession(callCtx, host);
  const targets = normalizeUnblockTargets(request);
  const results = [];
  for (const target of targets) {
    const { upstream, json, head } = await sendRestEnvelope(callCtx, host, session, DEL_FUNCTION, {
      addr_blacklist_cp: { blacklist_cp: [target] },
    });
    results.push({
      ip_start: target.ip_start,
      ip_end: target.ip_end,
      error_code: toInt64(head.error_code, 0),
      error_string: toTrimmedString(firstDefined(head.error_string, head.message)),
      http_status: Number(upstream.status),
      raw_json: toValue(json),
    });
  }
  return { results };
};

const handleQueryBlacklist = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const request = req ?? {};
  const host = requireHost(request, callCtx);
  const session = requireSession(callCtx, host);
  const searchKey = toTrimmedString(request?.search_key ?? request?.searchKey);
  const body = { addr_blacklist_cp: searchKey ? { search_key: searchKey } : {} };
  const { upstream, json, head } = await sendRestEnvelope(callCtx, host, session, GET_FUNCTION, body);
  const envelope = firstEnvelope(json);
  return {
    error_code: toInt64(head.error_code, 0),
    error_string: toTrimmedString(firstDefined(head.error_string, head.message)),
    total: toInt64(head.total, 0),
    data: toValue(envelope.data),
    http_status: Number(upstream.status),
    raw_json: toValue(json),
    headers: extractHeaders(upstream.res),
  };
};

const handleLogout = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const request = req ?? {};
  const host = requireHost(request, callCtx);
  const session = requireSession(callCtx, host);
  const username = requireString(firstDefined(request?.username, session?.username, callCtx?.bindings?.user, callCtx?.bindings?.username), 'username');
  const upstream = await fetchUpstream(callCtx, `${host}${LOGOUT_URI}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: session.cookie },
    body: JSON.stringify({ username }),
  });
  clearSession(callCtx, host);
  const base = {
    http_status: Number(upstream.status),
    raw_body: String(upstream.text ?? ''),
    headers: extractHeaders(upstream.res),
  };
  if (!String(upstream.text || '').trim()) {
    if (upstream.status >= 200 && upstream.status < 300) return { ...base, raw_json: undefined };
    throw errorWithCode('UNKNOWN', 'response body is empty');
  }
  return { ...base, raw_json: toValue(parseJsonOrThrow(upstream.text)) };
};

export function rpcdef(ctx) {
  const callCtx = resolveCallContext(ctx);
  // 无显式 req 时回落到 ctx.req（rpcdef 主要作为测试/直调入口）。
  const pick = (req) => req ?? callCtx.req;
  return {
    [LOGIN_PATH]: async (req) => handleLogin(pick(req), callCtx),
    [BLOCK_PATH]: async (req) => handleBlockIP(pick(req), callCtx),
    [UNBLOCK_PATH]: async (req) => handleUnblockIP(pick(req), callCtx),
    [QUERY_PATH]: async (req) => handleQueryBlacklist(pick(req), callCtx),
    [LOGOUT_PATH]: async (req) => handleLogout(pick(req), callCtx),
  };
}

export const handlers = {
  [METHOD_LOGIN_FULL]: (req, ctx = {}) => handleLogin(req, ctx),
  [METHOD_BLOCK_FULL]: (req, ctx = {}) => handleBlockIP(req, ctx),
  [METHOD_UNBLOCK_FULL]: (req, ctx = {}) => handleUnblockIP(req, ctx),
  [METHOD_QUERY_FULL]: (req, ctx = {}) => handleQueryBlacklist(req, ctx),
  [METHOD_LOGOUT_FULL]: (req, ctx = {}) => handleLogout(req, ctx),
};

export const _test = {
  buildHeaders,
  buildTlsOptions,
  clearSession,
  errorWithCode,
  extractHeaders,
  fetchUpstream,
  firstEnvelope,
  getInstanceKey,
  getSession,
  getSetCookies,
  mergeCookieHeader,
  normalizeBaseUrl,
  normalizeBlockItem,
  normalizeBlockItems,
  normalizeUnblockTargets,
  parseAuthority,
  parseJsonOrThrow,
  requireHost,
  requireJsonBody,
  resolveCallContext,
  resolveTimeoutMs,
  sessionCache,
  setSession,
  toBoolean,
  toInt64,
  toTrimmedString,
  toValue,
};
