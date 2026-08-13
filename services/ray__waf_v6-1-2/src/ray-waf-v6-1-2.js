import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const LOGIN_PATH = '/RAY_WAF_V612.RAY_WAF_V612/Login';
export const QUERY_BLACKLIST_PATH = '/RAY_WAF_V612.RAY_WAF_V612/QueryBlacklist';
export const BLOCK_IP_PATH = '/RAY_WAF_V612.RAY_WAF_V612/BlockIP';
export const UNBLOCK_IP_PATH = '/RAY_WAF_V612.RAY_WAF_V612/UnblockIP';

export const METHOD_LOGIN_FULL = 'RAY_WAF_V612.RAY_WAF_V612/Login';
export const METHOD_QUERY_BLACKLIST_FULL = 'RAY_WAF_V612.RAY_WAF_V612/QueryBlacklist';
export const METHOD_BLOCK_IP_FULL = 'RAY_WAF_V612.RAY_WAF_V612/BlockIP';
export const METHOD_UNBLOCK_IP_FULL = 'RAY_WAF_V612.RAY_WAF_V612/UnblockIP';

export const DEFAULT_TIMEOUT_MS = 1500;
export const DEFAULT_BLOCK_IDS = '0';
export const DEFAULT_TYPE = '0';
export const DEFAULT_DIRECTION = '0';
export const DEFAULT_COLOR = '0';
export const DEFAULT_MASK = '255.255.255.0';
export const DEFAULT_REMARK = '长亭科技万象对接';
export const DEFAULT_GROUP_ID = '0';
export const DEFAULT_GROUP_ID_VALUE = '';

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

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return String(value);
};

const pickString = (source, keys) => {
  for (const key of keys) {
    if (hasOwn(source, key)) return unwrapScalar(source[key]).trim();
  }
  return '';
};

const normalizeBaseUrl = (value) => {
  const raw = unwrapScalar(value).trim();
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.replace(/\/+$/, '');
};

const resolveHost = (req = {}, bindings = {}) => {
  const direct = firstDefined(req.host, req.baseUrl, req.base_url, bindings.host, bindings.restBaseUrl, bindings.baseUrl);
  return normalizeBaseUrl(direct);
};

const resolveUser = (req = {}, bindings = {}) => pickString({ ...bindings, ...req }, ['user', 'username']);

const resolvePassword = (req = {}, bindings = {}) => pickString({ ...bindings, ...req }, ['password']);

const resolveRandom = (req = {}, bindings = {}) => pickString({ ...bindings, ...req }, ['random']);

const optionalUint32 = (value) => {
  const raw = firstDefined(value?.value, value);
  if (raw === undefined || raw === null) return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num) || Number.isNaN(num) || num <= 0) return undefined;
  return Math.trunc(num);
};

const resolveTimeoutMs = (ctx = {}) => firstDefined(
  optionalUint32(ctx.limits?.timeoutMs),
  optionalUint32(ctx.bindings?.timeoutMs),
  DEFAULT_TIMEOUT_MS,
);

const toBoolean = (value) => {
  const raw = firstDefined(value?.value, value);
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return Number.isNaN(raw) ? false : raw !== 0;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) return false;
  }
  return false;
};

let insecureTlsDispatcher;

const getInsecureTlsDispatcher = () => {
  insecureTlsDispatcher ??= new Agent({ connect: { rejectUnauthorized: false } });
  return insecureTlsDispatcher;
};

const buildTlsOptions = (bindings = {}) => {
  if (!toBoolean(bindings.skipTlsVerify) && !toBoolean(bindings.tlsInsecureSkipVerify) && !toBoolean(bindings.insecureSkipVerify)) {
    return {};
  }
  return { dispatcher: getInsecureTlsDispatcher() };
};

const buildHeaders = (bindings = {}, meta = {}, extra = {}) => ({
  ...(bindings.headers || {}),
  'x-engine-instance': meta.instance_id || meta.instanceId || 'unknown',
  'x-request-id': meta.request_id || meta.requestId || 'unknown',
  ...extra,
});

const getInstanceId = (ctx = {}) => String(ctx?.meta?.instance_id || ctx?.meta?.instanceId || 'unknown');
const buildSessionKey = (ctx, host) => `${getInstanceId(ctx)}::${host}`;
const setSession = (ctx, host, session) => sessionCache.set(buildSessionKey(ctx, host), session);
const getSession = (ctx, host) => sessionCache.get(buildSessionKey(ctx, host));
const clearSession = (ctx, host) => sessionCache.delete(buildSessionKey(ctx, host));
const clearSessionCache = () => sessionCache.clear();

const normalizeSuccess = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return normalizeSuccess(value.value);
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0' || normalized === '') return false;
  }
  return null;
};

const stringifyJson = (value) => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const toInteger = (value, fallback = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num) || Number.isNaN(num)) return fallback;
  return Math.trunc(num);
};

const stringifyCell = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return stringifyJson(value);
};

const isIPv4 = (value) => {
  const raw = String(value || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255 && part.length <= 3);
};

const logFlow = (ctx = {}, action, details) => {
  const meta = ctx.meta || {};
  const trace = [];
  if (meta.instance_id || meta.instanceId) trace.push(`inst=${meta.instance_id || meta.instanceId}`);
  if (meta.request_id || meta.requestId) trace.push(`req=${meta.request_id || meta.requestId}`);
  const prefix = `[RAY_WAF_V612][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
  try {
    console.log(prefix, JSON.stringify(details));
  } catch {
    console.log(prefix, details);
  }
};

const throwForHttpStatus = (status, text) => {
  const summary = `upstream http ${status}; body_length=${String(text || '').length}`;
  if (status === 401 || status === 403) throw errorWithCode('PERMISSION_DENIED', summary);
  if (status >= 400 && status < 500) throw errorWithCode('FAILED_PRECONDITION', summary);
  throw errorWithCode('UNAVAILABLE', summary);
};

const parseJsonBody = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', 'response is not valid JSON');
  }
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx.config ?? {}),
  ...(ctx.bindings ?? {}),
  ...(ctx.secret ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.request ?? ctx.req ?? {},
});

const requestFromContext = (ctx = {}) => ctx?.request ?? ctx?.req ?? {};

const fetchJson = async (ctx = {}, url, init = {}) => {
  const callCtx = resolveCallContext(ctx);
  let res;
  try {
    res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(resolveTimeoutMs(callCtx)),
      ...buildTlsOptions(callCtx.bindings),
      headers: buildHeaders(callCtx.bindings, callCtx.meta, init.headers || {}),
    });
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', err?.cause?.message || err?.message || 'fetch failed');
  }

  const text = await res.text();
  const ok = res.ok ?? (res.status >= 200 && res.status < 300);
  if (!ok) throwForHttpStatus(res.status, text);
  if (!String(text || '').trim()) throw errorWithCode('UNKNOWN', 'response body is empty');
  return { json: parseJsonBody(text), text };
};

const requireHost = (ctx) => {
  const host = resolveHost({}, ctx.bindings || {});
  if (!host) throw errorWithCode('INVALID_ARGUMENT', 'host/baseUrl is required');
  return host;
};

const requireUser = (ctx) => {
  const user = resolveUser({}, ctx.bindings || {});
  if (!user) throw errorWithCode('INVALID_ARGUMENT', 'user is required');
  return user;
};

const requirePassword = (ctx) => {
  const password = resolvePassword({}, ctx.bindings || {});
  if (!password) throw errorWithCode('INVALID_ARGUMENT', 'password is required');
  return password;
};

const requireRandom = (ctx) => {
  const host = requireHost(ctx);
  const random = String(getSession(ctx, host)?.random || '').trim();
  if (!random) throw errorWithCode('INVALID_ARGUMENT', 'random is required');
  return random;
};

const buildUrl = (baseUrl, path, query = {}) => {
  const normalizedBase = String(baseUrl || '').replace(/\/+$/, '');
  const normalizedPath = String(path || '').replace(/^\/+/, '');
  const pairs = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  const joined = `${normalizedBase}/${normalizedPath}`;
  return pairs.length === 0 ? joined : `${joined}?${pairs.join('&')}`;
};

const handleLogin = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const host = requireHost(callCtx);
  const user = requireUser(callCtx);
  const password = requirePassword(callCtx);
  const url = buildUrl(host, '/apicenter/login/', { username: user, password });
  const started = Date.now();
  const { json, text } = await fetchJson(callCtx, url, { method: 'GET' });
  const success = normalizeSuccess(json?.success);
  if (success !== true) throw errorWithCode('FAILED_PRECONDITION', '用户登录失败');
  const random = stringifyCell(json?.random).trim();
  if (!random) throw errorWithCode('UNKNOWN', 'login response missing random');
  setSession(callCtx, host, { random });
  const result = {
    success: true,
    success_raw: stringifyCell(json?.success),
    random: '',
    adminid: stringifyCell(json?.adminid),
    pwd_comp: stringifyCell(json?.pwd_comp),
    pwd_lasttime: stringifyCell(json?.pwd_lasttime),
    pwd_len: stringifyCell(json?.pwd_len),
    pwd_update_cycle: stringifyCell(json?.pwd_update_cycle),
    redirecturl: stringifyCell(json?.redirecturl),
    reminder: stringifyCell(json?.reminder),
    userauth: stringifyCell(json?.userauth),
    raw_json: '',
  };
  logFlow(callCtx, 'Login', { host, user, elapsed_ms: Date.now() - started, success: true });
  return result;
};

const mapBlacklistRecord = (item) => {
  if (!Array.isArray(item)) throw errorWithCode('UNKNOWN', 'aaData item must be an array');
  return {
    id: stringifyCell(item[0]),
    ip: stringifyCell(item[1]),
    mask: stringifyCell(item[2]),
    type: toInteger(item[3], 0),
    direction: toInteger(item[4], 0),
    remark: stringifyCell(item[5]),
    extra_columns: item.slice(6).map((entry) => stringifyCell(entry)),
    raw_json: '',
  };
};

const handleQueryBlacklist = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const host = requireHost(callCtx);
  const user = requireUser(callCtx);
  const random = requireRandom(callCtx);
  const started = Date.now();
  const url = buildUrl(host, '/apicenter/', { action: 'blacklist_query', username: user, random });
  const { json, text } = await fetchJson(callCtx, url, { method: 'GET' });
  if (!Array.isArray(json?.aaData)) throw errorWithCode('UNKNOWN', 'blacklist query response missing aaData');
  const result = {
    records: json.aaData.map(mapBlacklistRecord),
    i_total_display_records: toInteger(json?.iTotalDisplayRecords, 0),
    i_total_records: toInteger(json?.iTotalRecords, 0),
    s_echo: stringifyCell(json?.sEcho),
    raw_json: '',
  };
  logFlow(callCtx, 'QueryBlacklist', { host, user, record_count: result.records.length, elapsed_ms: Date.now() - started, success: true });
  return result;
};

const requireIpv4 = (value) => {
  const ip = String(value || '').trim();
  if (!ip) throw errorWithCode('INVALID_ARGUMENT', 'ip is required');
  if (!isIPv4(ip)) throw errorWithCode('INVALID_ARGUMENT', 'ip must be a valid IPv4 address');
  return ip;
};

const handleBlockIP = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const host = requireHost(callCtx);
  const user = requireUser(callCtx);
  const random = requireRandom(callCtx);
  const ip = requireIpv4(req.ip);
  const payload = {
    ids: pickString(req, ['ids']) || DEFAULT_BLOCK_IDS,
    type: pickString(req, ['type']) || DEFAULT_TYPE,
    direction: pickString(req, ['direction']) || DEFAULT_DIRECTION,
    color: pickString(req, ['color']) || DEFAULT_COLOR,
    ip,
    mask: pickString(req, ['mask']) || DEFAULT_MASK,
    remark: pickString(req, ['remark']) || DEFAULT_REMARK,
    groupid: pickString(req, ['groupid']) || DEFAULT_GROUP_ID,
    groupid_value: hasOwn(req || {}, 'groupid_value') ? stringifyCell(req.groupid_value) : DEFAULT_GROUP_ID_VALUE,
  };
  const url = buildUrl(host, '/apicenter/', { action: 'blacklist_update', username: user, random });
  const started = Date.now();
  const { json, text } = await fetchJson(callCtx, url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const success = normalizeSuccess(json?.success);
  if (success !== true) throw errorWithCode('FAILED_PRECONDITION', stringifyCell(json?.errormessage) || '封禁IP失败');
  const id = stringifyCell(json?.id).trim();
  if (!id) throw errorWithCode('UNKNOWN', 'block ip response missing id');
  const result = {
    success: true,
    success_raw: stringifyCell(json?.success),
    id,
    errormessage: stringifyCell(json?.errormessage),
    raw_json: '',
  };
  logFlow(callCtx, 'BlockIP', { host, user, ip, ids: payload.ids, elapsed_ms: Date.now() - started, success: true });
  return result;
};

const handleUnblockIP = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const host = requireHost(callCtx);
  const user = requireUser(callCtx);
  const random = requireRandom(callCtx);
  const ids = pickString(req, ['ids']);
  if (!ids) throw errorWithCode('INVALID_ARGUMENT', 'ids is required');
  const url = buildUrl(host, '/apicenter/', { action: 'blacklist_del', username: user, random });
  const started = Date.now();
  const { json, text } = await fetchJson(callCtx, url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  const success = normalizeSuccess(json?.success);
  if (success !== true) throw errorWithCode('FAILED_PRECONDITION', stringifyCell(json?.errormessage) || '解封IP失败');
  const result = {
    success: true,
    success_raw: stringifyCell(json?.success),
    errormessage: stringifyCell(json?.errormessage),
    raw_json: '',
  };
  logFlow(callCtx, 'UnblockIP', { host, user, ids, elapsed_ms: Date.now() - started, success: true });
  return result;
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [LOGIN_PATH]: async (req) => handleLogin(req ?? callCtx.req ?? {}, callCtx),
    [QUERY_BLACKLIST_PATH]: async (req) => handleQueryBlacklist(req ?? callCtx.req ?? {}, callCtx),
    [BLOCK_IP_PATH]: async (req) => handleBlockIP(req ?? callCtx.req ?? {}, callCtx),
    [UNBLOCK_IP_PATH]: async (req) => handleUnblockIP(req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_LOGIN_FULL]: (ctx = {}) => handleLogin(requestFromContext(ctx), ctx),
  [METHOD_QUERY_BLACKLIST_FULL]: (ctx = {}) => handleQueryBlacklist(requestFromContext(ctx), ctx),
  [METHOD_BLOCK_IP_FULL]: (ctx = {}) => handleBlockIP(requestFromContext(ctx), ctx),
  [METHOD_UNBLOCK_IP_FULL]: (ctx = {}) => handleUnblockIP(requestFromContext(ctx), ctx),
};

export const _test = {
  buildHeaders,
  buildSessionKey,
  buildTlsOptions,
  buildUrl,
  clearSession,
  clearSessionCache,
  errorWithCode,
  fetchJson,
  firstDefined,
  getSession,
  handleBlockIP,
  handleLogin,
  handleQueryBlacklist,
  handleUnblockIP,
  hasOwn,
  isIPv4,
  logFlow,
  mapBlacklistRecord,
  normalizeBaseUrl,
  normalizeSuccess,
  optionalUint32,
  parseJsonBody,
  pickString,
  requireHost,
  requireIpv4,
  requirePassword,
  requireRandom,
  requireUser,
  resolveCallContext,
  resolveHost,
  resolvePassword,
  resolveRandom,
  resolveTimeoutMs,
  resolveUser,
  setSession,
  stringifyCell,
  stringifyJson,
  throwForHttpStatus,
  toBoolean,
  toInteger,
  unwrapScalar,
};
