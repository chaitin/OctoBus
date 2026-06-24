import { Buffer } from 'node:buffer';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const METHOD_HEALTH_CHECK_PATH = '/Venus_TAR.TARService/HealthCheck';
export const METHOD_LOGIN_PATH = '/Venus_TAR.TARService/Login';
export const METHOD_LOGOUT_PATH = '/Venus_TAR.TARService/Logout';
export const METHOD_GET_CURRENT_USER_PATH = '/Venus_TAR.TARService/GetCurrentUser';
export const METHOD_REQUEST_PATH = '/Venus_TAR.TARService/Request';
export const METHOD_GET_DASHBOARD_OVERVIEW_PATH = '/Venus_TAR.TARService/GetDashboardOverview';
export const METHOD_GET_ALARM_TOTAL_PATH = '/Venus_TAR.TARService/GetAlarmTotal';
export const METHOD_LIST_EVENT_LOGS_PATH = '/Venus_TAR.TARService/ListEventLogs';
export const METHOD_LIST_ASSETS_PATH = '/Venus_TAR.TARService/ListAssets';
export const METHOD_GET_ASSET_BY_ID_PATH = '/Venus_TAR.TARService/GetAssetById';
export const METHOD_GET_PCAP_DETAIL_PATH = '/Venus_TAR.TARService/GetPcapDetail';
export const METHOD_TRACK_PCAP_FLOW_PATH = '/Venus_TAR.TARService/TrackPcapFlow';

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
const ENV_CACHE = new WeakMap();

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
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
  const trimmed = value.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed)) return '';
  return trimmed;
};

const resolveTimeoutMs = (ctx = {}) => optionalPositiveNumber(ctx.bindings?.timeoutMs)
  ?? optionalPositiveNumber(ctx.limits?.timeoutMs)
  ?? DEFAULT_TIMEOUT_MS;

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
  return {
    baseUrl,
    username,
    password,
    token,
    cookie,
    formState: pickFirstString([bindings.formState]) || DEFAULT_FORM_STATE,
    checkCode: pickFirstString([bindings.checkCode]),
    codeKey: pickFirstString([bindings.codeKey]),
    timeoutMs: resolveTimeoutMs(callCtx),
    headers: sanitizeHeaders(bindings.headers),
    skipTlsVerify: pickFirstBoolean([bindings.skipTlsVerify, bindings.tlsInsecureSkipVerify]) || false,
    session: { token: '', cookie: '' },
  };
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
    timeoutMs: env.timeoutMs,
  };
  if (options.body !== undefined) fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  if (env.skipTlsVerify) {
    fetchOptions.insecureSkipVerify = true;
    fetchOptions.tlsInsecureSkipVerify = true;
  }
  try {
    return await fetch(options.url, fetchOptions);
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', `${options.action || 'request'} failed: ${err?.cause?.message || err?.message || 'fetch failed'}`);
  }
};

const readRestResponse = async (response, requestId = '') => {
  const headers = headersToObject(response.headers);
  const text = await response.text();
  if (isJsonContentType(headers['content-type'])) {
    return {
      status_code: response.status,
      headers,
      json_body: text || 'null',
      raw_body_base64: '',
      request_id: requestId,
    };
  }
  return {
    status_code: response.status,
    headers,
    json_body: '',
    raw_body_base64: Buffer.from(text).toString('base64'),
    request_id: requestId,
  };
};

const ensureOk = async (response, action) => {
  if (response.ok) return;
  const text = await response.text();
  throw errorWithCode(mapHttpStatus(response.status), `${action} upstream http ${response.status}: ${text}`);
};

const requestJson = async (env, { method = 'GET', path, query, body, auth, headers, action = 'request' }) => {
  const url = buildUrl(env, path, query);
  const response = await doFetch(env, { url, method, body, auth, headers, action });
  await ensureOk(response, action);
  const text = await response.text();
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
  const url = buildUrl(env, LOGIN_PATH);
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
  await ensureOk(response, 'login');
  const cookie = extractCookie(response.headers);
  const text = await response.text();
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
    throw errorWithCode('UNAUTHENTICATED', `login failed: ${text}`);
  }
  const token = extractToken(json);
  if (!token && !cookie) throw errorWithCode('UNAUTHENTICATED', 'login did not return token or cookie');
  env.session = { token: token || '', cookie };
  return { token: token || '', cookie, message: pickString(json.msg) || pickString(json.message) || 'login ok' };
};

const getAuth = async (env, req = {}) => {
  if (env.token || env.cookie) return { token: env.token || '', cookie: env.cookie || '' };
  if (env.session?.token || env.session?.cookie) return env.session;
  return login(env, req);
};

const clearSession = (env) => {
  env.session = { token: '', cookie: '' };
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
    await response.text();
    return executeRestRequest(env, req, { retry: false });
  }
  if (!response.ok) {
    const text = await response.text();
    throw errorWithCode(mapHttpStatus(response.status), `request upstream http ${response.status}: ${text}`);
  }
  return readRestResponse(response, requestIdOf(req));
};

const executeJsonEndpoint = async (env, req = {}, endpoint) => {
  const restReq = {
    method: endpoint.method,
    path: endpoint.path,
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

const cachedEnvFor = (ctx = {}) => {
  if (!ctx || typeof ctx !== 'object') return buildEnv(ctx);
  const cached = ENV_CACHE.get(ctx);
  if (cached) return cached;
  const env = buildEnv(ctx);
  ENV_CACHE.set(ctx, env);
  return env;
};

const runWithEnv = (req = {}, ctx = {}, executor) => executor(cachedEnvFor(ctx), req);

const makeJsonHandler = (methodFull) => (req = {}, ctx = {}) => runWithEnv(req, ctx, (env) => executeJsonEndpoint(env, req, CORE_ENDPOINTS[methodFull]));

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  let cachedEnv;
  const resolveEnv = () => {
    if (!cachedEnv) cachedEnv = buildEnv(callCtx);
    return cachedEnv;
  };
  const getReq = (incoming) => ({ ...(callCtx.req || {}), ...(incoming || {}) });
  return {
    [METHOD_HEALTH_CHECK_PATH]: async (req) => executeHealthCheck(resolveEnv(), getReq(req)),
    [METHOD_LOGIN_PATH]: async (req) => executeLogin(resolveEnv(), getReq(req)),
    [METHOD_LOGOUT_PATH]: async (req) => executeLogout(resolveEnv(), getReq(req)),
    [METHOD_GET_CURRENT_USER_PATH]: async (req) => executeCurrentUser(resolveEnv(), getReq(req)),
    [METHOD_REQUEST_PATH]: async (req) => executeRestRequest(resolveEnv(), getReq(req)),
    [METHOD_GET_DASHBOARD_OVERVIEW_PATH]: async (req) => executeJsonEndpoint(resolveEnv(), getReq(req), CORE_ENDPOINTS[METHOD_GET_DASHBOARD_OVERVIEW_FULL]),
    [METHOD_GET_ALARM_TOTAL_PATH]: async (req) => executeJsonEndpoint(resolveEnv(), getReq(req), CORE_ENDPOINTS[METHOD_GET_ALARM_TOTAL_FULL]),
    [METHOD_LIST_EVENT_LOGS_PATH]: async (req) => executeJsonEndpoint(resolveEnv(), getReq(req), CORE_ENDPOINTS[METHOD_LIST_EVENT_LOGS_FULL]),
    [METHOD_LIST_ASSETS_PATH]: async (req) => executeJsonEndpoint(resolveEnv(), getReq(req), CORE_ENDPOINTS[METHOD_LIST_ASSETS_FULL]),
    [METHOD_GET_ASSET_BY_ID_PATH]: async (req) => executeJsonEndpoint(resolveEnv(), getReq(req), CORE_ENDPOINTS[METHOD_GET_ASSET_BY_ID_FULL]),
    [METHOD_GET_PCAP_DETAIL_PATH]: async (req) => executeJsonEndpoint(resolveEnv(), getReq(req), CORE_ENDPOINTS[METHOD_GET_PCAP_DETAIL_FULL]),
    [METHOD_TRACK_PCAP_FLOW_PATH]: async (req) => executeJsonEndpoint(resolveEnv(), getReq(req), CORE_ENDPOINTS[METHOD_TRACK_PCAP_FLOW_FULL]),
  };
}

export const handlers = {
  [METHOD_HEALTH_CHECK_FULL]: (req, ctx = {}) => runWithEnv(req, ctx, (env) => executeHealthCheck(env)),
  [METHOD_LOGIN_FULL]: (req, ctx = {}) => runWithEnv(req, ctx, (env) => executeLogin(env, req)),
  [METHOD_LOGOUT_FULL]: (req, ctx = {}) => runWithEnv(req, ctx, (env) => executeLogout(env)),
  [METHOD_GET_CURRENT_USER_FULL]: (req, ctx = {}) => runWithEnv(req, ctx, (env) => executeCurrentUser(env, req)),
  [METHOD_REQUEST_FULL]: (req, ctx = {}) => runWithEnv(req, ctx, (env) => executeRestRequest(env, req)),
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
  cachedEnvFor,
  buildUrl,
  clearSession,
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
  stringifyJson,
  unwrapScalar,
};
