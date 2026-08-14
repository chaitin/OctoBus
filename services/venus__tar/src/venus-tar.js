import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const METHOD_HEALTH_CHECK_FULL = 'Venus_TAR.TARService/HealthCheck';
export const METHOD_LOGIN_FULL = 'Venus_TAR.TARService/Login';
export const METHOD_LOGOUT_FULL = 'Venus_TAR.TARService/Logout';
export const METHOD_GET_CURRENT_USER_FULL = 'Venus_TAR.TARService/GetCurrentUser';
export const METHOD_REQUEST_FULL = 'Venus_TAR.TARService/Request';
export const METHOD_GET_DASHBOARD_OVERVIEW_FULL = 'Venus_TAR.TARService/GetDashboardOverview';
export const METHOD_GET_ALARM_TOTAL_FULL = 'Venus_TAR.TARService/GetAlarmTotal';
export const METHOD_LIST_EVENT_LOGS_FULL = 'Venus_TAR.TARService/ListEventLogs';
export const METHOD_LIST_ASSETS_FULL = 'Venus_TAR.TARService/ListAssets';
export const METHOD_GET_ASSET_BY_ID_FULL = 'Venus_TAR.TARService/GetAssetById';
export const METHOD_GET_PCAP_DETAIL_FULL = 'Venus_TAR.TARService/GetPcapDetail';
export const METHOD_TRACK_PCAP_FLOW_FULL = 'Venus_TAR.TARService/TrackPcapFlow';

export const CHECK_CODE_PATH = '/user/checkCode';
export const LOGIN_PATH = '/user/login';
export const LOGOUT_PATH = '/user/logout';
export const CURRENT_USER_PATH = '/user/info';
export const DEFAULT_TIMEOUT_MS = 8000;
export const DEFAULT_FORM_STATE = '1';
export const DEFAULT_API_PREFIX = '/tar';
export const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const MAX_SESSION_CACHE_ENTRIES = 128;

const CORE_ENDPOINTS = {
  [METHOD_GET_DASHBOARD_OVERVIEW_FULL]: { method: 'POST', path: '/dashboard/overview' },
  [METHOD_GET_ALARM_TOTAL_FULL]: { method: 'POST', path: '/dashboard/statistics/total' },
  [METHOD_LIST_EVENT_LOGS_FULL]: { method: 'POST', path: '/eventLog/detailPage' },
  [METHOD_LIST_ASSETS_FULL]: { method: 'POST', path: '/asset/page' },
  [METHOD_GET_ASSET_BY_ID_FULL]: { method: 'POST', path: '/asset/getAssetById' },
  [METHOD_GET_PCAP_DETAIL_FULL]: { method: 'POST', path: '/pcap/detail' },
  [METHOD_TRACK_PCAP_FLOW_FULL]: { method: 'POST', path: '/pcap/trackFlow' },
};

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const SESSION_CACHE = new Map();
let insecureDispatcher;

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  RESOURCE_EXHAUSTED: grpcStatus.RESOURCE_EXHAUSTED,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object') {
    if (hasOwn(value, 'value')) return unwrapScalar(value.value);
    if (hasOwn(value, 'stringValue')) return unwrapScalar(value.stringValue);
    if (hasOwn(value, 'numberValue')) return unwrapScalar(value.numberValue);
    if (hasOwn(value, 'boolValue')) return unwrapScalar(value.boolValue);
  }
  return value;
};

const pickString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return undefined;
};

const pickFirstString = (values) => {
  for (const value of values) {
    const str = pickString(value);
    if (str !== undefined && str.trim()) return str.trim();
  }
  return undefined;
};

const pickBoolean = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return Number.isNaN(raw) ? undefined : raw !== 0;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) return false;
  }
  return undefined;
};

const pickFirstBoolean = (values) => {
  for (const value of values) {
    const bool = pickBoolean(value);
    if (bool !== undefined) return bool;
  }
  return undefined;
};

const optionalPositiveNumber = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? num : undefined;
};

const isPlainObject = (input) => Boolean(input) && typeof input === 'object' && Object.getPrototypeOf(input) === Object.prototype;

const sanitizeHeaders = (headers) => {
  const raw = unwrapScalar(headers);
  if (!isPlainObject(raw)) return {};
  const normalized = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!key) continue;
    normalized[key] = String(unwrapScalar(value) ?? '');
  }
  return normalized;
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

const normalizeBaseUrl = (rawUrl) => {
  const value = pickFirstString([rawUrl]);
  if (!value) return '';
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)
      || url.username || url.password || url.search || url.hash) return '';
    return url.origin;
  } catch {
    return '';
  }
};

const normalizeApiPrefix = (rawPrefix) => {
  const value = pickString(rawPrefix);
  if (value === undefined) return DEFAULT_API_PREFIX;
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') return '';
  if (/^https?:\/\//i.test(trimmed)) {
    throw errorWithCode('FAILED_PRECONDITION', 'apiPrefix must be a path prefix, not a URL');
  }
  const stripped = trimmed.replace(/^\/+|\/+$/g, '');
  return stripped ? `/${stripped}` : '';
};

const resolveTimeoutMs = (ctx = {}) => optionalPositiveNumber(ctx.bindings?.timeoutMs)
  ?? optionalPositiveNumber(ctx.limits?.timeoutMs)
  ?? DEFAULT_TIMEOUT_MS;

const resolveMaxResponseBytes = (ctx = {}) => optionalPositiveNumber(ctx.bindings?.maxResponseBytes)
  ?? DEFAULT_MAX_RESPONSE_BYTES;

const buildSessionKey = (ctx, env) => [
  pickFirstString([ctx.instanceId, ctx.instance_id, ctx.meta?.instance_id, ctx.meta?.instanceId]) || 'default-instance',
  env.baseUrl,
  env.apiPrefix,
  env.username || '',
  createHash('sha256').update(env.password || '').digest('hex'),
].join('\u001f');

const buildEnv = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings || {};
  const baseUrl = normalizeBaseUrl(pickFirstString([bindings.baseUrl, bindings.restBaseUrl, bindings.host]));
  if (!baseUrl) throw errorWithCode('FAILED_PRECONDITION', 'bindings.baseUrl/restBaseUrl must be a valid http(s) URL');
  const token = pickFirstString([bindings.token, bindings.accessToken]);
  const cookie = pickFirstString([bindings.cookie]);
  const username = pickFirstString([bindings.username, bindings.user]);
  const password = pickFirstString([bindings.password, bindings.pass]);
  if (!token && !cookie && (!username || !password)) {
    throw errorWithCode('FAILED_PRECONDITION', 'token/cookie or username/password is required');
  }
  const env = {
    baseUrl,
    username,
    password,
    token,
    cookie,
    apiPrefix: normalizeApiPrefix(bindings.apiPrefix),
    formState: pickFirstString([bindings.formState]) || DEFAULT_FORM_STATE,
    checkCode: pickFirstString([bindings.checkCode]),
    codeKey: pickFirstString([bindings.codeKey]),
    timeoutMs: resolveTimeoutMs(callCtx),
    maxResponseBytes: resolveMaxResponseBytes(callCtx),
    headers: sanitizeHeaders(bindings.headers),
    skipTlsVerify: pickFirstBoolean([bindings.skipTlsVerify, bindings.tlsInsecureSkipVerify]) || false,
  };
  return { ...env, sessionKey: buildSessionKey(callCtx, env) };
};

const requestIdOf = (req = {}) => pickFirstString([req.request_id, req.requestId]) || '';

const parseJsonBody = (jsonBody) => {
  const text = pickString(jsonBody);
  if (!text || !text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithCode('INVALID_ARGUMENT', 'json_body must be valid JSON');
  }
};

const stringifyJson = (value) => JSON.stringify(value ?? null);

const extractToken = (json = {}) => pickFirstString([
  json.tokenValue,
  json.token,
  json.value,
  json?.data?.tokenValue,
  json?.data?.token,
  json?.data?.value,
  json?.message?.tokenValue,
  json?.message?.token,
]);

const extractCookie = (headers) => {
  const setCookie = headers?.get?.('set-cookie') || '';
  if (!setCookie) return '';
  return setCookie.split(';')[0] || '';
};

const getSession = (env) => {
  const session = SESSION_CACHE.get(env.sessionKey);
  if (session) {
    SESSION_CACHE.delete(env.sessionKey);
    SESSION_CACHE.set(env.sessionKey, session);
  }
  return session;
};

const setSession = (key, session) => {
  SESSION_CACHE.delete(key);
  SESSION_CACHE.set(key, session);
  while (SESSION_CACHE.size > MAX_SESSION_CACHE_ENTRIES) {
    SESSION_CACHE.delete(SESSION_CACHE.keys().next().value);
  }
};

const clearSessionCache = () => SESSION_CACHE.clear();

const isJsonContentType = (contentType) => String(contentType || '').toLowerCase().includes('json');

const headersToObject = (headers) => {
  const result = {};
  headers?.forEach?.((value, key) => {
    result[key] = value;
  });
  return result;
};

const mapHttpStatus = (status) => {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'PERMISSION_DENIED';
  if (status >= 400 && status < 500) return 'FAILED_PRECONDITION';
  return 'UNAVAILABLE';
};

const buildUrl = (env, path, query = {}) => {
  const rawPath = pickFirstString([path]);
  if (!rawPath || !rawPath.startsWith('/') || /^https?:\/\//i.test(rawPath)) {
    throw errorWithCode('INVALID_ARGUMENT', 'path must be an absolute path beginning with /');
  }
  const url = new URL(`${env.baseUrl}${rawPath}`);
  const rawQuery = unwrapScalar(query);
  if (isPlainObject(rawQuery)) {
    for (const [key, value] of Object.entries(rawQuery)) {
      if (!key || value === undefined || value === null) continue;
      url.searchParams.set(key, String(unwrapScalar(value) ?? ''));
    }
  }
  return url;
};

const withApiPrefix = (env, path) => {
  const rawPath = pickFirstString([path]);
  if (!rawPath || !env.apiPrefix) return rawPath;
  if (rawPath === env.apiPrefix || rawPath.startsWith(`${env.apiPrefix}/`)) return rawPath;
  return `${env.apiPrefix}${rawPath}`;
};

const buildApiUrl = (env, path, query = {}) => buildUrl(env, withApiPrefix(env, path), query);

const applyAuthHeaders = (headers, auth = {}) => {
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  if (auth.cookie) headers.Cookie = auth.cookie;
};

const doFetch = async (env, options) => {
  const headers = {
    'content-type': 'application/json',
    ...env.headers,
    ...(options.headers || {}),
  };
  applyAuthHeaders(headers, options.auth || {});
  const fetchOptions = {
    method: options.method,
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(env.timeoutMs),
  };
  if (options.body !== undefined) fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  if (env.skipTlsVerify) {
    insecureDispatcher ??= new Agent({ connect: { rejectUnauthorized: false } });
    fetchOptions.dispatcher = insecureDispatcher;
  }
  try {
    return await fetch(options.url, fetchOptions);
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', `${options.action || 'request'} failed: ${err?.cause?.message || err?.message || 'fetch failed'}`);
  }
};

const readBoundedBuffer = async (response, env) => {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > env.maxResponseBytes) {
    throw errorWithCode('RESOURCE_EXHAUSTED', 'upstream response exceeds configured size limit');
  }
  const bytes = typeof response.arrayBuffer === 'function'
    ? Buffer.from(await response.arrayBuffer())
    : Buffer.from(await response.text(), 'utf8');
  if (bytes.length > env.maxResponseBytes) {
    throw errorWithCode('RESOURCE_EXHAUSTED', 'upstream response exceeds configured size limit');
  }
  return bytes;
};

const readRestResponse = async (response, env, requestId = '') => {
  const headers = headersToObject(response.headers);
  const body = await readBoundedBuffer(response, env);
  if (isJsonContentType(headers['content-type'])) {
    return {
      status_code: response.status,
      headers,
      json_body: body.toString('utf8') || 'null',
      raw_body_base64: '',
      request_id: requestId,
    };
  }
  return {
    status_code: response.status,
    headers,
    json_body: '',
    raw_body_base64: body.toString('base64'),
    request_id: requestId,
  };
};

const ensureOk = async (response, env, action) => {
  if (response.ok) return;
  await readBoundedBuffer(response, env);
  throw errorWithCode(mapHttpStatus(response.status), `${action} upstream returned HTTP ${response.status}`);
};

const requestJson = async (env, { method = 'GET', path, query, body, auth, headers, action = 'request', apiPrefix = true }) => {
  const url = apiPrefix ? buildApiUrl(env, path, query) : buildUrl(env, path, query);
  const response = await doFetch(env, { url, method, body, auth, headers, action });
  await ensureOk(response, env, action);
  const text = (await readBoundedBuffer(response, env)).toString('utf8');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', `${action} response is not valid JSON`);
  }
};

const login = async (env, req = {}) => {
  if (env.token || env.cookie) {
    return {
      token: env.token || '',
      cookie: env.cookie || '',
      message: 'using pre-issued credentials',
    };
  }
  if (!env.username || !env.password) throw errorWithCode('FAILED_PRECONDITION', 'username/password is required for login');
  const captcha = await requestJson(env, { path: CHECK_CODE_PATH, method: 'GET', action: 'captcha' });
  const codeKey = pickFirstString([req.code_key, req.codeKey, env.codeKey, captcha.codeKey]);
  const checkCode = pickFirstString([req.check_code, req.checkCode, env.checkCode]);
  if (!checkCode) throw errorWithCode('FAILED_PRECONDITION', 'checkCode is required for TAR captcha login');
  const url = buildApiUrl(env, LOGIN_PATH);
  const response = await doFetch(env, {
    url,
    method: 'POST',
    action: 'login',
    body: {
      logonName: env.username,
      pwd: env.password,
      formState: env.formState,
      checkCode,
      codeKey,
    },
  });
  await ensureOk(response, env, 'login');
  const cookie = extractCookie(response.headers);
  const text = (await readBoundedBuffer(response, env)).toString('utf8');
  let json = {};
  if (text.trim()) {
    try {
      json = JSON.parse(text);
    } catch {
      throw errorWithCode('UNKNOWN', 'login response is not valid JSON');
    }
  }
  const code = json.code ?? json.result;
  if (code !== undefined && String(code) !== '0' && String(code).toLowerCase() !== 'success') {
    const message = pickFirstString([json.msg, json.message]);
    throw errorWithCode('UNAUTHENTICATED', `login failed${message ? `: ${message}` : ''}`);
  }
  const token = extractToken(json);
  if (!token && !cookie) throw errorWithCode('UNAUTHENTICATED', 'login did not return token or cookie');
  setSession(env.sessionKey, { token: token || '', cookie });
  return { token: token || '', cookie, message: pickString(json.msg) || pickString(json.message) || 'login ok' };
};

const getAuth = async (env, req = {}) => {
  if (env.token || env.cookie) return { token: env.token || '', cookie: env.cookie || '' };
  const session = getSession(env);
  if (session?.token || session?.cookie) return session;
  if (session?.loginPromise) return session.loginPromise;
  const loginPromise = login(env, req);
  setSession(env.sessionKey, { loginPromise });
  try {
    return await loginPromise;
  } finally {
    const current = getSession(env);
    if (current?.loginPromise === loginPromise) SESSION_CACHE.delete(env.sessionKey);
  }
};

const clearSession = (env) => {
  if (!env.token && !env.cookie) SESSION_CACHE.delete(env.sessionKey);
};

const executeRestRequest = async (env, req = {}, { retry = true } = {}) => {
  const method = pickFirstString([req.method])?.toUpperCase();
  if (!method) throw errorWithCode('INVALID_ARGUMENT', 'method is required');
  if (!ALLOWED_METHODS.has(method)) throw errorWithCode('INVALID_ARGUMENT', `unsupported method: ${method}`);
  const url = buildUrl(env, req.path, req.query);
  const body = req.raw_body_base64
    ? Buffer.from(pickString(req.raw_body_base64) || '', 'base64').toString('utf8')
    : (req.json_body !== undefined && req.json_body !== '' ? stringifyJson(parseJsonBody(req.json_body)) : undefined);
  const auth = await getAuth(env, req);
  const response = await doFetch(env, {
    url,
    method,
    body,
    auth,
    headers: sanitizeHeaders(req.headers),
    action: 'request',
  });
  if ((response.status === 401 || response.status === 403) && retry && !env.token && !env.cookie) {
    clearSession(env);
    await readBoundedBuffer(response, env);
    return executeRestRequest(env, req, { retry: false });
  }
  if (!response.ok) {
    await readBoundedBuffer(response, env);
    throw errorWithCode(mapHttpStatus(response.status), `request upstream returned HTTP ${response.status}`);
  }
  return readRestResponse(response, env, requestIdOf(req));
};

const executeJsonEndpoint = async (env, req = {}, endpoint) => {
  const restReq = {
    method: endpoint.method,
    path: withApiPrefix(env, endpoint.path),
    request_id: requestIdOf(req),
  };
  if (endpoint.method !== 'GET') restReq.json_body = req.json_body || '{}';
  const response = await executeRestRequest(env, restReq);
  return {
    json_body: response.json_body,
    request_id: response.request_id,
  };
};

const executeHealthCheck = async (env) => {
  await getAuth(env);
  return { ok: true, message: 'authenticated' };
};

const executeLogin = async (env, req = {}) => {
  const result = await login(env, req);
  return {
    authenticated: Boolean(result.token || result.cookie),
    token: result.token,
    cookie: result.cookie,
    message: result.message,
  };
};

const executeLogout = async (env) => {
  const auth = await getAuth(env);
  try {
    await requestJson(env, { path: LOGOUT_PATH, method: 'GET', auth, action: 'logout' });
  } finally {
    clearSession(env);
  }
  return { ok: true, message: 'logout ok' };
};

const executeCurrentUser = async (env, req = {}) => executeJsonEndpoint(env, req, { method: 'GET', path: CURRENT_USER_PATH });

const requestFor = (ctx = {}) => ctx.request ?? ctx.req ?? {};
const runWithEnv = (ctx = {}, executor) => {
  const req = requestFor(ctx);
  return executor(buildEnv(ctx), req);
};
const makeHandler = (executor) => (ctx = {}) => runWithEnv(ctx, executor);
const makeJsonHandler = (methodFull) => makeHandler(
  (env, req) => executeJsonEndpoint(env, req, CORE_ENDPOINTS[methodFull]),
);

export const handlers = {
  [METHOD_HEALTH_CHECK_FULL]: makeHandler((env) => executeHealthCheck(env)),
  [METHOD_LOGIN_FULL]: makeHandler((env, req) => executeLogin(env, req)),
  [METHOD_LOGOUT_FULL]: makeHandler((env) => executeLogout(env)),
  [METHOD_GET_CURRENT_USER_FULL]: makeHandler((env, req) => executeCurrentUser(env, req)),
  [METHOD_REQUEST_FULL]: makeHandler((env, req) => executeRestRequest(env, req)),
  [METHOD_GET_DASHBOARD_OVERVIEW_FULL]: makeJsonHandler(METHOD_GET_DASHBOARD_OVERVIEW_FULL),
  [METHOD_GET_ALARM_TOTAL_FULL]: makeJsonHandler(METHOD_GET_ALARM_TOTAL_FULL),
  [METHOD_LIST_EVENT_LOGS_FULL]: makeJsonHandler(METHOD_LIST_EVENT_LOGS_FULL),
  [METHOD_LIST_ASSETS_FULL]: makeJsonHandler(METHOD_LIST_ASSETS_FULL),
  [METHOD_GET_ASSET_BY_ID_FULL]: makeJsonHandler(METHOD_GET_ASSET_BY_ID_FULL),
  [METHOD_GET_PCAP_DETAIL_FULL]: makeJsonHandler(METHOD_GET_PCAP_DETAIL_FULL),
  [METHOD_TRACK_PCAP_FLOW_FULL]: makeJsonHandler(METHOD_TRACK_PCAP_FLOW_FULL),
};

export const _test = {
  buildEnv,
  buildApiUrl,
  buildUrl,
  clearSession,
  clearSessionCache,
  doFetch,
  errorWithCode,
  executeCurrentUser,
  executeHealthCheck,
  executeJsonEndpoint,
  executeLogin,
  executeLogout,
  executeRestRequest,
  extractCookie,
  extractToken,
  getAuth,
  grpcCodeFor,
  hasOwn,
  isJsonContentType,
  isPlainObject,
  login,
  mapHttpStatus,
  normalizeApiPrefix,
  normalizeBaseUrl,
  optionalPositiveNumber,
  parseJsonBody,
  pickBoolean,
  pickFirstBoolean,
  pickFirstString,
  pickString,
  readRestResponse,
  requestIdOf,
  requestJson,
  resolveCallContext,
  resolveTimeoutMs,
  sanitizeHeaders,
  sessionCacheSize: () => SESSION_CACHE.size,
  stringifyJson,
  unwrapScalar,
};
