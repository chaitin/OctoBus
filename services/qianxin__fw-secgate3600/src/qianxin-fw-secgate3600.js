import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const LOGIN_PATH = '/QIANXIN_FW_SecGate3600.QIANXIN_FW_SecGate3600/Login';
export const UPDATE_PATH = '/QIANXIN_FW_SecGate3600.QIANXIN_FW_SecGate3600/UpdateAddressGroup';
export const LOGOUT_PATH = '/QIANXIN_FW_SecGate3600.QIANXIN_FW_SecGate3600/Logout';

export const METHOD_LOGIN_FULL = 'QIANXIN_FW_SecGate3600.QIANXIN_FW_SecGate3600/Login';
export const METHOD_UPDATE_FULL = 'QIANXIN_FW_SecGate3600.QIANXIN_FW_SecGate3600/UpdateAddressGroup';
export const METHOD_LOGOUT_FULL = 'QIANXIN_FW_SecGate3600.QIANXIN_FW_SecGate3600/Logout';

export const LOGIN_URI = '/v1.0/login';
export const UPDATE_URI = '/v1.0/rest/';
export const LOGOUT_URI = '/v1.0/out';
export const FIXED_MODULE = 'obj_address';
export const FIXED_FUNCTION = 'set_obj_addr_conf';
export const FIXED_ADDR_TYPE = 'host';
export const DEFAULT_TIMEOUT_MS = 5000;

const sessionCache = new Map();

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
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
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrapScalar(value.value);
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
  ...(ctx?.bindings ?? {}),
  ...(ctx?.config ?? {}),
  ...(ctx?.secret ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.request ?? ctx.req ?? {},
});

const requestFromContext = (ctx = {}) => ctx.request ?? ctx.req ?? {};

const parseAuthority = (authority) => {
  if (!authority) return null;
  if (authority.startsWith('[')) {
    const closeIndex = authority.indexOf(']');
    if (closeIndex <= 0) return null;
    const hostPart = authority.slice(0, closeIndex + 1);
    const rest = authority.slice(closeIndex + 1);
    if (!rest.startsWith(':')) return null;
    const portPart = rest.slice(1);
    if (!/^\d+$/.test(portPart)) return null;
    return { hostPart, portPart };
  }
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

let insecureTlsDispatcher;

const getInsecureTlsDispatcher = () => {
  insecureTlsDispatcher ??= new Agent({ connect: { rejectUnauthorized: false } });
  return insecureTlsDispatcher;
};

const buildTlsOptions = (bindings) => {
  if (!toBoolean(bindings?.skipTlsVerify) && !toBoolean(bindings?.tlsInsecureSkipVerify) && !toBoolean(bindings?.insecureSkipVerify)) return {};
  return { dispatcher: getInsecureTlsDispatcher() };
};

const buildHeaders = (ctx, extra = {}) => ({
  ...(ctx?.bindings?.headers || {}),
  ...extra,
});

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

const pickCredential = (ctx, fieldNames, fieldLabel) => {
  const secret = ctx?.secret || {};
  const config = ctx?.config || {};
  const bindings = ctx?.bindings || {};
  for (const field of fieldNames) {
    const value = firstDefined(secret[field], config[field], bindings[field]);
    const text = toTrimmedString(value);
    if (text) return text;
  }
  throw errorWithCode('INVALID_ARGUMENT', `${fieldLabel} is required`);
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
  if (Array.isArray(raw)) {
    return { listValue: { values: raw.map((item) => toValue(item) ?? { nullValue: 'NULL_VALUE' }) } };
  }
  if (typeof raw === 'object') {
    const fields = {};
    for (const [key, value] of Object.entries(raw)) fields[key] = toValue(value) ?? { nullValue: 'NULL_VALUE' };
    return { structValue: { fields } };
  }
  return { stringValue: String(raw) };
};

const fetchUpstream = async (ctx, url, init = {}) => {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(resolveTimeoutMs(ctx)),
      ...buildTlsOptions(ctx?.bindings || {}),
      headers: buildHeaders(ctx, init.headers || {}),
    });
    const text = await response.text();
    return {
      status: Number(response.status),
      text: String(text ?? ''),
      res: response,
    };
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

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const validateLoginJson = (json) => {
  if (!isPlainObject(json) || typeof json.success !== 'boolean' || !isPlainObject(json.result)) {
    throw errorWithCode('UNKNOWN', 'login response schema is invalid');
  }
  const errorCode = toTrimmedString(json.result.error_code);
  if (!errorCode) throw errorWithCode('UNKNOWN', 'login response schema is invalid');
  if (json.success === true && !toTrimmedString(json.result.token)) {
    throw errorWithCode('UNKNOWN', 'login response schema is invalid');
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
    const key = pair.slice(0, eqIndex).trim();
    pairs.set(key, pair);
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

const resolveLoginUsername = (req, ctx) =>
  pickCredential(ctx, ['user', 'username'], 'username');

const resolveLoginPassword = (req, ctx) =>
  pickCredential(ctx, ['password'], 'password');

const resolveLogoutUsername = (req, ctx, session) =>
  requireString(firstDefined(session?.username, ctx?.secret?.user, ctx?.secret?.username, ctx?.config?.user, ctx?.config?.username, ctx?.bindings?.user, ctx?.bindings?.username), 'username');

const normalizeAddressItem = (item, fieldName) => {
  const source = item || {};
  const addrType = toTrimmedString(firstDefined(source.addr_type, source.addrType, FIXED_ADDR_TYPE)) || FIXED_ADDR_TYPE;
  if (addrType !== FIXED_ADDR_TYPE) throw errorWithCode('INVALID_ARGUMENT', `${fieldName}.addr_type must be ${FIXED_ADDR_TYPE}`);
  return {
    ip: requireString(source.ip, `${fieldName}.ip`),
    addr_type: addrType,
  };
};

const normalizeAddressItems = (value, fieldName) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw errorWithCode('INVALID_ARGUMENT', `${fieldName} must be an array`);
  return value.map((item, index) => normalizeAddressItem(item, `${fieldName}[${index}]`));
};

const normalizeGroupObject = (item, index) => {
  const source = item || {};
  const name = requireString(source.name, `entries[${index}].body.obj_addr[].name`);
  return {
    name,
    oldname: toTrimmedString(source.oldname) || name,
    ...(toTrimmedString(source.desc) ? { desc: toTrimmedString(source.desc) } : {}),
    include: normalizeAddressItems(source.include, `entries[${index}].body.obj_addr[].include`),
    exclude: normalizeAddressItems(source.exclude, `entries[${index}].body.obj_addr[].exclude`),
  };
};

const normalizeGroupObjects = (value, index) => {
  if (!Array.isArray(value) || value.length === 0) {
    throw errorWithCode('INVALID_ARGUMENT', `entries[${index}].body.obj_addr must be a non-empty array`);
  }
  return value.map((item) => normalizeGroupObject(item, index));
};

const normalizeUpdateEntries = (req) => {
  const entries = Array.isArray(req?.entries) ? req.entries : [];
  if (entries.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'entries must be a non-empty array');
  return entries.map((entry, index) => {
    const head = entry?.head || {};
    const body = entry?.body || {};
    const moduleValue = toTrimmedString(firstDefined(head.module, FIXED_MODULE)) || FIXED_MODULE;
    const functionValue = toTrimmedString(firstDefined(head.function, FIXED_FUNCTION)) || FIXED_FUNCTION;
    if (moduleValue !== FIXED_MODULE) throw errorWithCode('INVALID_ARGUMENT', `entries[${index}].head.module must be ${FIXED_MODULE}`);
    if (functionValue !== FIXED_FUNCTION) throw errorWithCode('INVALID_ARGUMENT', `entries[${index}].head.function must be ${FIXED_FUNCTION}`);
    return {
      head: { module: moduleValue, function: functionValue },
      body: { obj_addr: normalizeGroupObjects(body.obj_addr, index) },
    };
  });
};

const toLoginResponse = (status, text, res, json) => {
  const resultObject = isPlainObject(json?.result) ? json.result : {};
  return {
    success: json?.success === true,
    result: {
      error_code: toTrimmedString(resultObject.error_code),
      token: '',
      raw: undefined,
    },
    http_status: Number(status),
    raw_body: '',
    raw_json: undefined,
    headers: [],
  };
};

const toUpdateResponse = (status, text, res, json) => {
  const head = isPlainObject(json?.head) ? json.head : {};
  return {
    head: {
      error_code: toInt64(head.error_code, 0),
      message: toTrimmedString(firstDefined(head.message, head.error_message, head.errmsg)),
      raw: toValue(head),
    },
    body: toValue(json?.body),
    http_status: Number(status),
    raw_body: '',
    raw_json: undefined,
    headers: [],
  };
};

const toLogoutResponse = (status, text, res, json) => ({
  raw_json: undefined,
  http_status: Number(status),
  raw_body: '',
  headers: [],
});

const handleLogin = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const request = req ?? callCtx.req ?? {};
  const host = requireHost(request, callCtx);
  const username = resolveLoginUsername(request, callCtx);
  const password = resolveLoginPassword(request, callCtx);
  const upstream = await fetchUpstream(callCtx, `${host}${LOGIN_URI}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const json = requireJsonBody(upstream.text);
  validateLoginJson(json);
  const response = toLoginResponse(upstream.status, upstream.text, upstream.res, json);
  const token = toTrimmedString(json?.result?.token);
  if (response.success && response.result.error_code === 'success' && token) {
    const cookie = mergeCookieHeader(getSetCookies(upstream.res), token);
    if (cookie) {
      setSession(callCtx, host, {
        token,
        cookie,
        username,
        login_at_ms: Date.now(),
      });
    }
  }
  return response;
};

const handleUpdateAddressGroup = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const request = req ?? callCtx.req ?? {};
  const host = requireHost(request, callCtx);
  const session = requireSession(callCtx, host);
  const entries = normalizeUpdateEntries(request);
  const upstream = await fetchUpstream(callCtx, `${host}${UPDATE_URI}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: session.cookie,
    },
    body: JSON.stringify(entries),
  });
  if (upstream.status === 401 || upstream.status === 403) clearSession(callCtx, host);
  const json = requireJsonBody(upstream.text);
  return toUpdateResponse(upstream.status, upstream.text, upstream.res, json);
};

const handleLogout = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const request = req ?? callCtx.req ?? {};
  const host = requireHost(request, callCtx);
  const session = requireSession(callCtx, host);
  const username = resolveLogoutUsername(request, callCtx, session);
  const upstream = await fetchUpstream(callCtx, `${host}${LOGOUT_URI}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: session.cookie,
    },
    body: JSON.stringify({ username }),
  });
  clearSession(callCtx, host);
  if (!String(upstream.text || '').trim()) {
    if (upstream.status >= 200 && upstream.status < 300) return toLogoutResponse(upstream.status, upstream.text, upstream.res, undefined);
    throw errorWithCode('UNKNOWN', 'response body is empty');
  }
  const json = parseJsonOrThrow(upstream.text);
  return toLogoutResponse(upstream.status, upstream.text, upstream.res, json);
};

export function rpcdef(ctx) {
  const callCtx = resolveCallContext(ctx);
  return {
    [LOGIN_PATH]: async (req) => handleLogin(req ?? callCtx.req ?? {}, callCtx),
    [UPDATE_PATH]: async (req) => handleUpdateAddressGroup(req ?? callCtx.req ?? {}, callCtx),
    [LOGOUT_PATH]: async (req) => handleLogout(req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_LOGIN_FULL]: (ctx = {}) => handleLogin(requestFromContext(ctx), ctx),
  [METHOD_UPDATE_FULL]: (ctx = {}) => handleUpdateAddressGroup(requestFromContext(ctx), ctx),
  [METHOD_LOGOUT_FULL]: (ctx = {}) => handleLogout(requestFromContext(ctx), ctx),
};

export const _test = {
  buildHeaders,
  buildTlsOptions,
  clearSession,
  errorWithCode,
  extractHeaders,
  fetchUpstream,
  getInstanceKey,
  getInstanceSessionMap,
  getSession,
  getSetCookies,
  mergeCookieHeader,
  normalizeAddressItem,
  normalizeAddressItems,
  normalizeBaseUrl,
  normalizeGroupObject,
  normalizeUpdateEntries,
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
  toLoginResponse,
  toLogoutResponse,
  toTrimmedString,
  toUpdateResponse,
  toValue,
  validateLoginJson,
};
