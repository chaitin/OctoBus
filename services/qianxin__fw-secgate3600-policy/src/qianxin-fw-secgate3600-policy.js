import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const PKG = 'QIANXIN_FW_SecGate3600_Policy.QIANXIN_FW_SecGate3600_Policy';
export const LOGIN_PATH = `/${PKG}/Login`;
export const LIST_PATH = `/${PKG}/ListSecPolicy`;
export const SET_PATH = `/${PKG}/SetSecPolicy`;
export const MOVE_PATH = `/${PKG}/MoveSecPolicyPriority`;
export const LOGOUT_PATH = `/${PKG}/Logout`;

export const METHOD_LOGIN_FULL = `${PKG}/Login`;
export const METHOD_LIST_FULL = `${PKG}/ListSecPolicy`;
export const METHOD_SET_FULL = `${PKG}/SetSecPolicy`;
export const METHOD_MOVE_FULL = `${PKG}/MoveSecPolicyPriority`;
export const METHOD_LOGOUT_FULL = `${PKG}/Logout`;

export const LOGIN_URI = '/v1.0/login';
export const REST_URI = '/v1.0/rest/';
export const LOGOUT_URI = '/v1.0/out';
export const SEC_MODULE = 'sec_policy';
export const FN_GET = 'get_sec_policy';
export const FN_SET = 'set_sec_policy';
export const FN_MOVE = 'set_move_sec_policy_pri';
export const MOVE_DIRECTS = ['top', 'end', 'before', 'after'];
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

const buildTlsOptions = (bindings) => {
  if (!toBoolean(bindings?.skipTlsVerify) && !toBoolean(bindings?.tlsInsecureSkipVerify) && !toBoolean(bindings?.insecureSkipVerify)) return {};
  return {
    skipTlsVerify: true,
    tlsInsecureSkipVerify: true,
    insecureSkipVerify: true,
  };
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
      timeoutMs: resolveTimeoutMs(ctx),
      ...buildTlsOptions(ctx?.bindings || {}),
      ...init,
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
  requireString(firstDefined(req?.username, ctx?.bindings?.user, ctx?.bindings?.username), 'username');

const resolveLoginPassword = (req, ctx) =>
  requireString(firstDefined(req?.password, ctx?.bindings?.password), 'password');

const resolveLogoutUsername = (req, ctx, session) =>
  requireString(firstDefined(req?.username, session?.username, ctx?.bindings?.user, ctx?.bindings?.username), 'username');

const NAME_MAX = 63;

const normalizeListNames = (req) => {
  const raw = Array.isArray(req?.names) ? req.names : [];
  const names = [];
  for (const item of raw) {
    if (item === undefined || item === null) continue;
    const name = String(unwrapScalar(item) ?? '').trim();
    if (name !== '' && name.length > NAME_MAX) {
      throw errorWithCode('INVALID_ARGUMENT', `name "${name}" must be 1-${NAME_MAX} characters`);
    }
    names.push(name);
  }
  return names;
};

const buildGetSecPolicyEntry = (req) => {
  const isDetail = toBoolean(firstDefined(req?.is_detail, req?.isDetail));
  const names = normalizeListNames(req);
  const list = names.length === 0
    ? [{ name: '', is_detail: isDetail }]
    : names.map((name) => ({ name, is_detail: isDetail }));
  const pageIndex = toInt64(firstDefined(req?.page_index, req?.pageIndex), 0);
  const pageSize = toInt64(firstDefined(req?.page_size, req?.pageSize), 0);
  return {
    head: {
      module: SEC_MODULE,
      function: FN_GET,
      page_index: pageIndex > 0 ? pageIndex : 1,
      page_size: pageSize > 0 ? pageSize : 20,
      language: 'CN',
    },
    body: { sec_policy: list },
  };
};

const normalizePolicies = (req) => {
  const raw = Array.isArray(req?.policies) ? req.policies : [];
  if (raw.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'policies must be a non-empty array');
  return raw.map((item, index) => {
    if (!isPlainObject(item)) throw errorWithCode('INVALID_ARGUMENT', `policies[${index}] must be an object`);
    if (!toTrimmedString(item.name)) throw errorWithCode('INVALID_ARGUMENT', `policies[${index}].name is required`);
    return item;
  });
};

const normalizeMoves = (req) => {
  const raw = Array.isArray(req?.moves) ? req.moves : [];
  if (raw.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'moves must be a non-empty array');
  return raw.map((item, index) => {
    const source = item || {};
    const name = requireString(source.name, `moves[${index}].name`);
    const direct = toTrimmedString(firstDefined(source.direct, source.Direct)).toLowerCase();
    if (!MOVE_DIRECTS.includes(direct)) {
      throw errorWithCode('INVALID_ARGUMENT', `moves[${index}].direct must be one of ${MOVE_DIRECTS.join(', ')}`);
    }
    let dstName = toTrimmedString(firstDefined(source.dst_name, source.dstName));
    if (direct === 'before' || direct === 'after') {
      if (!dstName) throw errorWithCode('INVALID_ARGUMENT', `moves[${index}].dst_name is required when direct is ${direct}`);
    } else {
      dstName = '';
    }
    return { name, direct, dst_name: dstName };
  });
};

const toLoginResponse = (status, text, res, json) => {
  const resultObject = isPlainObject(json?.result) ? json.result : {};
  return {
    success: json?.success === true,
    result: {
      error_code: toTrimmedString(resultObject.error_code),
      token: toTrimmedString(resultObject.token),
      raw: toValue(resultObject),
    },
    http_status: Number(status),
    raw_body: String(text ?? ''),
    raw_json: toValue(json),
    headers: extractHeaders(res),
  };
};

const toRestResponse = (status, text, res, json) => {
  const head = isPlainObject(json?.head) ? json.head : {};
  return {
    head: {
      error_code: toInt64(head.error_code, 0),
      message: toTrimmedString(firstDefined(head.error_string, head.message, head.error_message, head.errmsg)),
      total: toInt64(head.total, 0),
      raw: toValue(head),
    },
    data: toValue(firstDefined(json?.data, json?.body)),
    http_status: Number(status),
    raw_body: String(text ?? ''),
    raw_json: toValue(json),
    headers: extractHeaders(res),
  };
};

const toLogoutResponse = (status, text, res, json) => ({
  raw_json: json === undefined ? undefined : toValue(json),
  http_status: Number(status),
  raw_body: String(text ?? ''),
  headers: extractHeaders(res),
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
  if (response.success && response.result.error_code === 'success' && response.result.token) {
    const cookie = mergeCookieHeader(getSetCookies(upstream.res), response.result.token);
    if (cookie) {
      setSession(callCtx, host, {
        token: response.result.token,
        cookie,
        username,
        login_at_ms: Date.now(),
      });
    }
  }
  return response;
};

const callRestEntry = async (callCtx, host, entry) => {
  const session = requireSession(callCtx, host);
  const upstream = await fetchUpstream(callCtx, `${host}${REST_URI}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: session.cookie,
    },
    body: JSON.stringify([entry]),
  });
  if (upstream.status === 401 || upstream.status === 403) clearSession(callCtx, host);
  const json = requireJsonBody(upstream.text);
  return toRestResponse(upstream.status, upstream.text, upstream.res, json);
};

const handleListSecPolicy = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const request = req ?? callCtx.req ?? {};
  const host = requireHost(request, callCtx);
  const entry = buildGetSecPolicyEntry(request);
  return callRestEntry(callCtx, host, entry);
};

const handleSetSecPolicy = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const request = req ?? callCtx.req ?? {};
  const host = requireHost(request, callCtx);
  const policies = normalizePolicies(request);
  const entry = { head: { module: SEC_MODULE, function: FN_SET }, body: { sec_policy: policies } };
  return callRestEntry(callCtx, host, entry);
};

const handleMoveSecPolicyPriority = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const request = req ?? callCtx.req ?? {};
  const host = requireHost(request, callCtx);
  const moves = normalizeMoves(request);
  const entry = { head: { module: SEC_MODULE, function: FN_MOVE }, body: { sec_policy: moves } };
  return callRestEntry(callCtx, host, entry);
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
    [LIST_PATH]: async (req) => handleListSecPolicy(req ?? callCtx.req ?? {}, callCtx),
    [SET_PATH]: async (req) => handleSetSecPolicy(req ?? callCtx.req ?? {}, callCtx),
    [MOVE_PATH]: async (req) => handleMoveSecPolicyPriority(req ?? callCtx.req ?? {}, callCtx),
    [LOGOUT_PATH]: async (req) => handleLogout(req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_LOGIN_FULL]: (req, ctx = {}) => handleLogin(req, ctx),
  [METHOD_LIST_FULL]: (req, ctx = {}) => handleListSecPolicy(req, ctx),
  [METHOD_SET_FULL]: (req, ctx = {}) => handleSetSecPolicy(req, ctx),
  [METHOD_MOVE_FULL]: (req, ctx = {}) => handleMoveSecPolicyPriority(req, ctx),
  [METHOD_LOGOUT_FULL]: (req, ctx = {}) => handleLogout(req, ctx),
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
  buildGetSecPolicyEntry,
  normalizeBaseUrl,
  normalizeListNames,
  normalizeMoves,
  normalizePolicies,
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
  toRestResponse,
  toValue,
  validateLoginJson,
};
