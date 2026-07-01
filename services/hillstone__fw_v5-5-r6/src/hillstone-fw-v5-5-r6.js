import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const LOGIN_PATH = '/HILLSTONE_FW_V55R6.HILLSTONE_FW_V55R6/Login';
export const CREATE_ADDR_GROUP_PATH = '/HILLSTONE_FW_V55R6.HILLSTONE_FW_V55R6/CreateAddrGroup';
export const UPDATE_ADDR_GROUP_PATH = '/HILLSTONE_FW_V55R6.HILLSTONE_FW_V55R6/UpdateAddrGroup';
export const QUERY_ADDR_GROUP_PATH = '/HILLSTONE_FW_V55R6.HILLSTONE_FW_V55R6/QueryAddrGroup';

export const METHOD_LOGIN_FULL = 'HILLSTONE_FW_V55R6.HILLSTONE_FW_V55R6/Login';
export const METHOD_CREATE_ADDR_GROUP_FULL = 'HILLSTONE_FW_V55R6.HILLSTONE_FW_V55R6/CreateAddrGroup';
export const METHOD_UPDATE_ADDR_GROUP_FULL = 'HILLSTONE_FW_V55R6.HILLSTONE_FW_V55R6/UpdateAddrGroup';
export const METHOD_QUERY_ADDR_GROUP_FULL = 'HILLSTONE_FW_V55R6.HILLSTONE_FW_V55R6/QueryAddrGroup';

export const CONTENT_TYPE = 'text/plain;charset=UTF-8';
export const DEFAULT_TIMEOUT_MS = 1500;
export const DEFAULT_LANG = 'zh_CN';
export const DEFAULT_LIMIT = 100;

const SESSION_CACHE = new Map();
let insecureDispatcherPromise;

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
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

const pickFirst = (source, keys) => {
  for (const key of keys) {
    if (hasOwn(source, key)) return unwrapScalar(source[key]);
  }
  return undefined;
};

const toTrimmedString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

const toInteger = (value, fallback = 0) => {
  const raw = unwrapScalar(value);
  const num = Number(raw);
  if (!Number.isFinite(num) || Number.isNaN(num)) return fallback;
  return Math.trunc(num);
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.bindings ?? {}),
  ...(ctx?.secret ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.request ?? ctx.req ?? {},
});

const requestFromContext = (ctx = {}) => ctx?.request ?? ctx?.req ?? {};

const normalizeBaseUrl = (value) => {
  const raw = toTrimmedString(value);
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.replace(/\/+$/, '');
};

const resolveHost = (bindings) => normalizeBaseUrl(firstDefined(
  pickFirst(bindings, ['host']),
  pickFirst(bindings, ['restBaseUrl']),
  pickFirst(bindings, ['rest_base_url']),
  pickFirst(bindings, ['baseUrl']),
  pickFirst(bindings, ['base_url']),
  pickFirst(bindings, ['endpoint']),
));

const resolveUsername = (bindings) => toTrimmedString(firstDefined(
  pickFirst(bindings, ['username']),
  pickFirst(bindings, ['userName']),
  pickFirst(bindings, ['user']),
));

const resolvePassword = (bindings) => toTrimmedString(pickFirst(bindings, ['password']));

const resolveTimeoutMs = (ctx) => {
  const bindings = mergedBindings(ctx);
  const raw = Number(firstDefined(ctx?.limits?.timeoutMs, bindings.timeoutMs, bindings.timeout_ms, DEFAULT_TIMEOUT_MS));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

const shouldSkipTlsVerify = (bindings) => Boolean(bindings?.skipTlsVerify || bindings?.tlsInsecureSkipVerify || bindings?.insecureSkipVerify);

const createTlsDispatcher = async (skipTlsVerify) => {
  if (!skipTlsVerify) return undefined;
  insecureDispatcherPromise ??= import('undici').then(({ Agent }) => new Agent({
    connect: { rejectUnauthorized: false },
  }));
  return insecureDispatcherPromise;
};

const buildTlsOptions = async (bindings) => {
  const dispatcher = await createTlsDispatcher(shouldSkipTlsVerify(bindings));
  return dispatcher ? { dispatcher } : {};
};

const fetchWithTimeout = async (url, init = {}, options = {}) => {
  const rawTimeout = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const parentSignal = init.signal;
  const abortFromParent = () => controller.abort(parentSignal.reason);
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else if (typeof parentSignal.addEventListener === 'function') {
      parentSignal.addEventListener('abort', abortFromParent, { once: true });
    }
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const tlsOptions = await buildTlsOptions(options.bindings);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      ...tlsOptions,
    });
  } finally {
    clearTimeout(timer);
    if (parentSignal && typeof parentSignal.removeEventListener === 'function') {
      parentSignal.removeEventListener('abort', abortFromParent);
    }
  }
};

const buildHeaders = (ctx, extra = {}) => ({
  ...(ctx?.bindings?.headers || {}),
  'Content-Type': CONTENT_TYPE,
  ...extra,
});

const buildCookieHeader = (cookies) => {
  if (!cookies || typeof cookies !== 'object') return '';
  const parts = [];
  const fieldMap = {
    fromrootvsys: 'fromrootvsys',
    role: 'role',
    vsysId: 'vsysId',
    token: 'token',
    username: 'username',
    lang: 'lang',
  };
  for (const [key, cookieName] of Object.entries(fieldMap)) {
    const value = unwrapScalar(cookies[key]);
    if (value !== undefined && value !== null && value !== '') {
      parts.push(`${cookieName}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.join('; ');
};

const getInstanceKey = (ctx) => String(ctx?.meta?.instance_id || ctx?.meta?.instanceId || 'default');

const getInstanceSessionMap = (ctx) => {
  const key = getInstanceKey(ctx);
  let map = SESSION_CACHE.get(key);
  if (!map) {
    map = new Map();
    SESSION_CACHE.set(key, map);
  }
  return map;
};

const getSession = (ctx, host) => getInstanceSessionMap(ctx).get(host);
const setSession = (ctx, host, session) => getInstanceSessionMap(ctx).set(host, session);
const clearSession = (ctx, host) => getInstanceSessionMap(ctx).delete(host);
const clearAllSessions = () => SESSION_CACHE.clear();

const buildLoginPayload = (username, password, lang) => ({
  userName: username,
  password,
  encodeUserName: '0',
  encodePassword: '0',
  lang: lang || DEFAULT_LANG,
});

const asArray = (value) => {
  const raw = unwrapScalar(value);
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.values)) return raw.values.map((item) => unwrapScalar(item));
  return [];
};

const normalizeAddrGroups = (groups) => {
  const list = asArray(groups);
  if (list.length === 0) return null;
  return list.map((group) => {
    const name = toTrimmedString(pickFirst(group, ['name']));
    if (!name) {
      throw errorWithCode('INVALID_ARGUMENT', 'addr_groups[].name is required');
    }
    const ip = asArray(pickFirst(group, ['ip'])).map((entry) => ({
      ip_addr: String(firstDefined(pickFirst(entry, ['ip_addr']), '') ?? ''),
      netmask: String(firstDefined(pickFirst(entry, ['netmask']), '32') ?? '32'),
      flag: toInteger(pickFirst(entry, ['flag']), 0),
    }));
    return { name, ip };
  });
};

const requireHost = (ctx) => {
  const host = resolveHost(ctx?.bindings || {});
  if (!host) throw errorWithCode('INVALID_ARGUMENT', 'host/baseUrl is required in bindings');
  return host;
};

const requireUsername = (ctx) => {
  const username = resolveUsername(ctx?.bindings || {});
  if (!username) throw errorWithCode('INVALID_ARGUMENT', 'username is required in bindings');
  return username;
};

const requirePassword = (ctx) => {
  const password = resolvePassword(ctx?.bindings || {});
  if (!password) throw errorWithCode('INVALID_ARGUMENT', 'password is required in bindings');
  return password;
};

const requireSession = (ctx, host) => {
  const session = getSession(ctx, host);
  if (!session) throw errorWithCode('FAILED_PRECONDITION', 'call Login first');
  return session;
};

const logFlow = (ctx, action, details) => {
  const meta = ctx?.meta || {};
  const trace = [];
  if (meta.instance_id || meta.instanceId) trace.push(`inst=${meta.instance_id || meta.instanceId}`);
  if (meta.request_id || meta.requestId) trace.push(`req=${meta.request_id || meta.requestId}`);
  const prefix = `[HILLSTONE_FW_V55R6][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
  try {
    console.log(prefix, JSON.stringify(details));
  } catch {
    console.log(prefix, details);
  }
};

const fetchWithStatus = async (url, init, ctx) => {
  const callCtx = resolveCallContext(ctx);
  let res;
  try {
    res = await fetchWithTimeout(url, init, { timeoutMs: resolveTimeoutMs(callCtx), bindings: callCtx.bindings });
  } catch (err) {
    const errMsg = err?.cause?.message || err?.message || 'fetch failed';
    logFlow(callCtx, 'fetch:error', { url, error: errMsg });
    return { httpStatus: 0, httpBody: errMsg };
  }
  const httpStatus = res.status;
  const httpBody = await res.text();
  logFlow(callCtx, 'fetch:response', { url, httpStatus, bodyLength: httpBody?.length || 0 });
  return { httpStatus, httpBody };
};

const throwForStatus = (httpStatus, httpBody) => {
  const bodyText = String(httpBody ?? '');
  const err = errorWithCode(
    httpStatus === 0 ? 'UNAVAILABLE' : 'FAILED_PRECONDITION',
    `upstream http ${httpStatus}`,
  );
  err.response = { http_status: httpStatus, http_body: '', http_body_length: bodyText.length };
  throw err;
};

const normalizeLoginResult = (parsed) => {
  if (Array.isArray(parsed?.result)) return parsed.result[0];
  if (parsed?.result && typeof parsed.result === 'object') return parsed.result;
  return null;
};

const extractSessionFromLogin = (username, lang, httpStatus, httpBody) => {
  if (httpStatus < 200 || httpStatus >= 300) return null;
  let parsed;
  try {
    parsed = JSON.parse(String(httpBody ?? ''));
  } catch {
    return null;
  }
  if (parsed?.success === false) return null;
  const result = normalizeLoginResult(parsed);
  if (!result || typeof result !== 'object') return null;
  const token = toTrimmedString(pickFirst(result, ['token']));
  const role = toTrimmedString(pickFirst(result, ['role']));
  const vsysId = toTrimmedString(pickFirst(result, ['vsysId', 'vsys_id']));
  const fromrootvsys = toTrimmedString(pickFirst(result, ['fromrootvsys']));
  if (!token) return null;
  return {
    fromrootvsys,
    role,
    vsysId,
    token,
    username,
    lang: lang || DEFAULT_LANG,
  };
};

const handleLogin = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const host = requireHost(callCtx);
  const username = requireUsername(callCtx);
  const password = requirePassword(callCtx);
  const lang = toTrimmedString(firstDefined(req?.lang, DEFAULT_LANG)) || DEFAULT_LANG;
  const url = `${host}/rest/doc/login`;

  logFlow(callCtx, 'Login', { url, lang });
  const { httpStatus, httpBody } = await fetchWithStatus(url, {
    method: 'POST',
    headers: buildHeaders(callCtx),
    body: JSON.stringify(buildLoginPayload(username, password, lang)),
  }, callCtx);

  const session = extractSessionFromLogin(username, lang, httpStatus, httpBody);
  if (session) setSession(callCtx, host, session);
  if (httpStatus >= 200 && httpStatus < 300) return { http_status: httpStatus, http_body: '' };
  throwForStatus(httpStatus, httpBody);
};

const handleCreateAddrGroup = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const host = requireHost(callCtx);
  const session = requireSession(callCtx, host);
  const addrGroups = normalizeAddrGroups(req?.addr_groups);
  if (!addrGroups) throw errorWithCode('INVALID_ARGUMENT', 'addr_groups is required and must be non-empty');
  const url = `${host}/rest/doc/addrbook`;

  logFlow(callCtx, 'CreateAddrGroup', { url, groups: addrGroups.length });
  const { httpStatus, httpBody } = await fetchWithStatus(url, {
    method: 'POST',
    headers: buildHeaders(callCtx, { Cookie: buildCookieHeader(session) }),
    body: JSON.stringify(addrGroups),
  }, callCtx);

  if (httpStatus >= 200 && httpStatus < 300) return { http_status: httpStatus, http_body: '' };
  if (httpStatus === 401 || httpStatus === 403) clearSession(callCtx, host);
  throwForStatus(httpStatus, httpBody);
};

const handleUpdateAddrGroup = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const host = requireHost(callCtx);
  const session = requireSession(callCtx, host);
  const addrGroups = normalizeAddrGroups(req?.addr_groups);
  if (!addrGroups) throw errorWithCode('INVALID_ARGUMENT', 'addr_groups is required and must be non-empty');
  const url = `${host}/rest/doc/addrbook`;

  logFlow(callCtx, 'UpdateAddrGroup', { url, groups: addrGroups.length });
  const { httpStatus, httpBody } = await fetchWithStatus(url, {
    method: 'PUT',
    headers: buildHeaders(callCtx, { Cookie: buildCookieHeader(session) }),
    body: JSON.stringify(addrGroups),
  }, callCtx);

  if (httpStatus >= 200 && httpStatus < 300) return { http_status: httpStatus, http_body: '' };
  if (httpStatus === 401 || httpStatus === 403) clearSession(callCtx, host);
  throwForStatus(httpStatus, httpBody);
};

const handleQueryAddrGroup = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const host = requireHost(callCtx);
  const session = requireSession(callCtx, host);
  const name = toTrimmedString(req?.name);
  if (!name) throw errorWithCode('INVALID_ARGUMENT', 'name is required');
  const limit = toInteger(firstDefined(req?.limit, DEFAULT_LIMIT), DEFAULT_LIMIT);
  if (limit <= 0) throw errorWithCode('INVALID_ARGUMENT', 'limit must be positive');
  const query = {
    conditions: [{ field: 'name', value: name }],
    start: 0,
    limit,
    page: 1,
  };
  const url = `${host}/rest/doc/addrbook?query=${encodeURIComponent(JSON.stringify(query))}`;

  logFlow(callCtx, 'QueryAddrGroup', { url, name, limit });
  const { httpStatus, httpBody } = await fetchWithStatus(url, {
    method: 'GET',
    headers: buildHeaders(callCtx, { Cookie: buildCookieHeader(session) }),
  }, callCtx);

  if (httpStatus >= 200 && httpStatus < 300) return { http_status: httpStatus, http_body: '' };
  if (httpStatus === 401 || httpStatus === 403) clearSession(callCtx, host);
  throwForStatus(httpStatus, httpBody);
};

export function rpcdef(ctx) {
  const callCtx = resolveCallContext(ctx);
  return {
    [LOGIN_PATH]: async () => handleLogin(callCtx.req || {}, callCtx),
    [CREATE_ADDR_GROUP_PATH]: async () => handleCreateAddrGroup(callCtx.req || {}, callCtx),
    [UPDATE_ADDR_GROUP_PATH]: async () => handleUpdateAddrGroup(callCtx.req || {}, callCtx),
    [QUERY_ADDR_GROUP_PATH]: async () => handleQueryAddrGroup(callCtx.req || {}, callCtx),
  };
}

export const handlers = {
  [METHOD_LOGIN_FULL]: (ctx = {}) => handleLogin(requestFromContext(ctx), ctx),
  [METHOD_CREATE_ADDR_GROUP_FULL]: (ctx = {}) => handleCreateAddrGroup(requestFromContext(ctx), ctx),
  [METHOD_UPDATE_ADDR_GROUP_FULL]: (ctx = {}) => handleUpdateAddrGroup(requestFromContext(ctx), ctx),
  [METHOD_QUERY_ADDR_GROUP_FULL]: (ctx = {}) => handleQueryAddrGroup(requestFromContext(ctx), ctx),
};

export const _test = {
  buildHeaders,
  buildCookieHeader,
  buildLoginPayload,
  buildTlsOptions,
  clearAllSessions,
  clearSession,
  createTlsDispatcher,
  errorWithCode,
  extractSessionFromLogin,
  fetchWithTimeout,
  fetchWithStatus,
  getInstanceKey,
  getSession,
  normalizeAddrGroups,
  requireSession,
  resolveHost,
  resolvePassword,
  resolveTimeoutMs,
  resolveUsername,
  setSession,
  shouldSkipTlsVerify,
  throwForStatus,
  toInteger,
};
