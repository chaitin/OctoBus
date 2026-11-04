// Chaitin SafeLine WAF 控制台账号密码版（无 OpenAPI/API-Token 的授权场景）。
// 通过 POST /api/LoginAPI 登录拿到 Django sessionid 会话，后续读接口走 Cookie 会话认证。
// 绑定：endpoint（必填）、headers（可选）、timeoutMs（可选）、proxy_url（可选 socks5）。

import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const DEFAULT_TIMEOUT_MS = 1500;

const LOGIN = 'Chaitin_WAF_SAFELINE_LOGIN.Chaitin_WAF_SAFELINE_LOGIN/Login';
const GET_PROFILE = 'Chaitin_WAF_SAFELINE_LOGIN.Chaitin_WAF_SAFELINE_LOGIN/GetProfile';
const GET_OVERVIEW = 'Chaitin_WAF_SAFELINE_LOGIN.Chaitin_WAF_SAFELINE_LOGIN/GetOverview';
const SEARCH_DETECT_LOG = 'Chaitin_WAF_SAFELINE_LOGIN.Chaitin_WAF_SAFELINE_LOGIN/SearchDetectLog';
const GET_ES_INDICES = 'Chaitin_WAF_SAFELINE_LOGIN.Chaitin_WAF_SAFELINE_LOGIN/GetESIndices';

// --- gRPC error helpers ---

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  DEADLINE_EXCEEDED: grpcStatus.DEADLINE_EXCEEDED,
  NOT_FOUND: grpcStatus.NOT_FOUND,
  INTERNAL: grpcStatus.INTERNAL,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

// --- proto Value/Struct helpers ---

const toValue = (val) => {
  if (val === undefined || val === null) return { nullValue: 'NULL_VALUE' };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'number') return { numberValue: val };
  if (typeof val === 'boolean') return { boolValue: val };
  if (Array.isArray(val)) {
    return { listValue: { values: val.map((item) => toValue(item)) } };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      fields[k] = toValue(v);
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(val) };
};

// --- 基础工具 ---

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const firstDefined = (...vals) => vals.find((v) => v !== undefined && v !== null);

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

const pickStringField = (req, keys) => {
  for (const key of keys) {
    if (hasOwn(req, key)) return String(unwrapScalar(req[key]) ?? '');
  }
  return undefined;
};

const toBoolean = (val) => {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'object' && val !== null && 'value' in val) return toBoolean(val.value);
  if (typeof val === 'string') {
    const normalized = val.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    return null;
  }
  if (typeof val === 'number') {
    if (val === 1) return true;
    if (val === 0) return false;
    return null;
  }
  return null;
};

const toQueryNumber = (val, allowZero = false) => {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'object' && 'value' in val) return toQueryNumber(val.value, allowZero);
  const num = Number(val);
  if (!Number.isInteger(num) || Number.isNaN(num)) return undefined;
  if (!allowZero && num <= 0) return undefined;
  if (allowZero && num < 0) return undefined;
  return num;
};

const toInt64 = (val) => {
  if (val === undefined || val === null) return null;
  if (typeof val === 'object' && 'value' in val) return toInt64(val.value);
  const num = Number(val);
  if (!Number.isInteger(num) || Number.isNaN(num)) return null;
  return num;
};

const unwrapValue = (v) => {
  if (v === undefined || v === null) return null;
  const kind = v?.kind;
  if (kind === undefined || typeof v !== 'object') return v;
  switch (kind.case) {
    case 'nullValue': return null;
    case 'numberValue': return kind.value;
    case 'stringValue': return kind.value;
    case 'boolValue': return kind.value;
    case 'structValue': return unwrapStruct(kind.value);
    case 'listValue': return (kind.value?.values ?? []).map(unwrapValue);
    default: return null;
  }
};

const unwrapStruct = (s) => {
  if (s === undefined || s === null) return {};
  const fields = s?.fields ?? {};
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = unwrapValue(v);
  return out;
};

// --- 配置解析 ---

const normalizeBaseUrl = (url) => {
  const base = String(url || '').trim();
  if (!/^https?:\/\//i.test(base)) return '';
  return base.replace(/\/+$/, '');
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.bindings ?? {}),
  ...(ctx?.secret ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  req: ctx?.req ?? ctx?.request ?? {},
});

const resolveBaseUrl = (bindings) => normalizeBaseUrl(firstDefined(bindings?.endpoint, bindings?.restBaseUrl, bindings?.baseUrl));

const resolveProxyUrl = (bindings = {}) => String(firstDefined(bindings?.proxy_url, bindings?.proxyUrl) || '').trim();

const resolveTimeoutMs = (bindings = {}) => {
  const timeout = Number(bindings?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS;
};

const resolveSkipTlsVerify = (bindings = {}) => Boolean(
  firstDefined(bindings?.skipTlsVerify, bindings?.skip_tls_verify, bindings?.tlsInsecureSkipVerify)
);

const resolveCredential = (bindings, keys, field) => {
  const value = firstDefined(pickFirst(bindings, keys), '');
  const text = String(value || '').trim();
  if (!text) throw errorWithCode('INVALID_ARGUMENT', `${field} is required in secret`);
  return text;
};

// --- 会话存储（long-running node 内存会话） ---

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 分钟
const SESSION_MAX = 1000;
const sessions = new Map();

const sessionKey = () => crypto.randomUUID();

const pruneSessions = () => {
  const now = Date.now();
  for (const [k, v] of sessions) {
    if (now - v.createdAt > SESSION_TTL_MS) sessions.delete(k);
  }
};

const getSession = (token) => {
  if (!token) return null;
  const session = sessions.get(String(token));
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(String(token));
    return null;
  }
  return session;
};

const setSession = (token, data) => {
  pruneSessions();
  if (sessions.size >= SESSION_MAX) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
    if (oldest) sessions.delete(oldest[0]);
  }
  sessions.set(String(token), { ...data, createdAt: Date.now() });
};

const removeSession = (token) => {
  sessions.delete(String(token));
};

// --- HTTP 客户端（支持 socks5 隧道 + Set-Cookie 捕获） ---

let insecureDispatcherPromise;
const createTlsDispatcher = async (skipTlsVerify) => {
  if (!skipTlsVerify) return undefined;
  insecureDispatcherPromise ??= import('undici').then(({ Agent }) => new Agent({
    connect: { rejectUnauthorized: false },
  }));
  return insecureDispatcherPromise;
};

const fetchWithTimeout = async (url, init = {}, { timeoutMs, skipTlsVerify }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const dispatcher = await createTlsDispatcher(skipTlsVerify);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
    });
  } finally {
    clearTimeout(timer);
  }
};

const proxiedFetch = (url, { method = 'GET', headers = {}, body } = {}, { timeoutMs, proxyUrl, skipTlsVerify } = {}) => new Promise((resolve, reject) => {
  const target = new URL(url);
  const mod = target.protocol === 'https:' ? https : http;
  const agent = new SocksProxyAgent(proxyUrl);

  const req = mod.request(target, {
    method,
    headers,
    agent,
    rejectUnauthorized: !skipTlsVerify,
  }, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => {
      const bodyText = Buffer.concat(chunks).toString('utf8');
      const headerMap = {};
      const setCookies = [];
      for (const [name, value] of Object.entries(res.headers)) {
        const key = name.toLowerCase();
        if (key === 'set-cookie') setCookies.push(...(Array.isArray(value) ? value : [value]));
        else if (!(key in headerMap)) headerMap[key] = Array.isArray(value) ? value.join(', ') : value;
      }
      resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        headers: {
          get: (name) => headerMap[String(name).toLowerCase()] ?? null,
          getSetCookie: () => setCookies,
        },
        text: async () => bodyText,
      });
    });
  });

  req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
  req.on('error', (err) => {
    if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') {
      reject(errorWithCode('DEADLINE_EXCEEDED', `RPC timeout after ${timeoutMs}ms`));
    } else {
      reject(errorWithCode('UNAVAILABLE', err.message || 'proxied request failed'));
    }
  });
  if (body !== undefined && body !== null) req.write(String(body));
  req.end();
});

const fetchSafeline = async (url, init, bindings) => {
  const proxyUrl = resolveProxyUrl(bindings);
  const timeoutMs = resolveTimeoutMs(bindings);
  const skipTlsVerify = resolveSkipTlsVerify(bindings);
  if (proxyUrl) {
    return proxiedFetch(url, init, { timeoutMs, proxyUrl, skipTlsVerify });
  }
  try {
    return await fetchWithTimeout(url, init, { timeoutMs, skipTlsVerify });
  } catch (e) {
    const isAbort = e?.name === 'AbortError' || e?.code === 'ABORT_ERR';
    if (isAbort) {
      throw errorWithCode('DEADLINE_EXCEEDED', `RPC timeout after ${timeoutMs}ms`);
    }
    const reason = e?.cause?.message || e?.message || 'fetch failed';
    throw errorWithCode('UNAVAILABLE', reason);
  }
};

// --- Cookie 解析 ---

const cookiePair = (setCookie) => String(setCookie || '').split(';')[0].trim();

const findCookieValue = (setCookies, name) => {
  const prefix = `${name}=`;
  for (const c of (setCookies || [])) {
    const pair = cookiePair(c);
    if (pair.startsWith(prefix)) return pair.slice(prefix.length);
  }
  return '';
};

const readSetCookies = (res) => {
  if (typeof res?.headers?.getSetCookie === 'function') {
    const cookies = res.headers.getSetCookie();
    if (Array.isArray(cookies)) return cookies;
  }
  const raw = res?.headers?.get?.('set-cookie');
  return raw ? [raw] : [];
};

// --- 响应处理 ---

const throwForHttpError = (status, text) => {
  if (status === 401 || status === 403) {
    throw errorWithCode('PERMISSION_DENIED', `upstream http ${status}: ${text}`);
  }
  if (status >= 400 && status < 500) {
    throw errorWithCode('FAILED_PRECONDITION', `upstream http ${status}: ${text}`);
  }
  if (status >= 500) {
    throw errorWithCode('UNAVAILABLE', `upstream http ${status}: ${text}`);
  }
};

// 巡检只读方法：Safeline 业务级 err（如 login-required）直接映射为 gRPC 错误，便于 agent 判定失败。
const throwForBusinessError = (json) => {
  const err = json?.err;
  if (err === null || err === undefined) return;
  const suffix = json?.msg ? `: ${json.msg}` : '';
  const code = String(err).toLowerCase();
  if (code.includes('login') || code.includes('permission') || code.includes('forbidden') || code.includes('auth') || code.includes('denied')) {
    throw errorWithCode('PERMISSION_DENIED', `${err}${suffix}`);
  }
  if (code.includes('invalid') || code.includes('required') || code.includes('bad')) {
    throw errorWithCode('INVALID_ARGUMENT', `${err}${suffix}`);
  }
  if (code.includes('not_found') || code.includes('notfound') || code.includes('not found')) {
    throw errorWithCode('NOT_FOUND', `${err}${suffix}`);
  }
  throw errorWithCode('INTERNAL', `${err}${suffix}`);
};

const readJsonResponse = async (res, emptyValue) => {
  const text = await res.text();
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    throwForHttpError(res.status, text);
  }
  if (!text.trim()) {
    return emptyValue;
  }
  if (contentType.includes('application/json')) {
    return JSON.parse(text);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', 'response is not valid JSON');
  }
};

// --- 登录 ---

const doLogin = async (bindings) => {
  const baseUrl = resolveBaseUrl(bindings);
  if (!baseUrl) {
    throw errorWithCode('INVALID_ARGUMENT', 'endpoint is required (https://...)');
  }
  const username = resolveCredential(bindings, ['bindUser'], 'username');
  const password = resolveCredential(bindings, ['bindPassword'], 'password');

  // 1. 获取 csrftoken（Django CSRF cookie；前端通过 GET /api/CSRFTokenAPI 下发，失败可忽略）
  let csrftoken = '';
  try {
    const csrfRes = await fetchSafeline(`${baseUrl}/api/CSRFTokenAPI`, { method: 'GET', headers: {} }, bindings);
    csrftoken = findCookieValue(readSetCookies(csrfRes), 'csrftoken');
  } catch {
    csrftoken = '';
  }

  // 2. 登录（Django CSRF 需要 x-csrftoken 头 + csrftoken cookie + Referer 头匹配 Host）
  const headers = { 'content-type': 'application/json', referer: `${baseUrl}/` };
  if (csrftoken) {
    headers['cookie'] = `csrftoken=${csrftoken}`;
    headers['x-csrftoken'] = csrftoken;
  }
  const res = await fetchSafeline(`${baseUrl}/api/LoginAPI`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ username, password }),
  }, bindings);
  const json = await readJsonResponse(res, { err: null, msg: '', data: {} });
  throwForBusinessError(json);

  const sessionid = findCookieValue(readSetCookies(res), 'sessionid');
  if (!sessionid) {
    throw errorWithCode('PERMISSION_DENIED', 'login did not return a sessionid cookie');
  }
  return {
    sessionid,
    username,
    permissions: Array.isArray(json?.data?.permissions) ? json.data.permissions : [],
  };
};

// --- 会话读请求 ---

const requireSessionToken = (req) => {
  const token = String(firstDefined(req?.session_token, req?.sessionToken) || '').trim();
  if (!token) throw errorWithCode('INVALID_ARGUMENT', 'session_token is required');
  return token;
};

const authenticatedGet = async (req, bindings, path, emptyValue) => {
  const token = requireSessionToken(req);
  const session = getSession(token);
  if (!session) throw errorWithCode('PERMISSION_DENIED', 'invalid or expired session_token, please Login again');

  const baseUrl = resolveBaseUrl(bindings);
  if (!baseUrl) {
    throw errorWithCode('INVALID_ARGUMENT', 'endpoint is required (https://...)');
  }
  const headers = { cookie: `sessionid=${session.sessionid}` };

  let json;
  try {
    const res = await fetchSafeline(`${baseUrl}${path}`, { method: 'GET', headers }, bindings);
    json = await readJsonResponse(res, emptyValue);
    throwForBusinessError(json);
  } catch (err) {
    if (err?.legacyCode === 'PERMISSION_DENIED') removeSession(token);
    throw err;
  }
  return json;
};

// --- handlers ---

async function handleLogin(_req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const { sessionid, username, permissions } = await doLogin(callCtx.bindings);
  const token = sessionKey();
  setSession(token, { sessionid, username });
  return {
    code: 0,
    msg: 'ok',
    session_token: token,
    username,
    permissions,
  };
}

async function handleGetProfile(req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const json = await authenticatedGet(req, callCtx.bindings, '/api/ProfileAPI', { err: null, msg: '', data: {} });
  return { err: toValue(json?.err), msg: toValue(json?.msg), data: json?.data ?? {} };
}

async function handleGetOverview(req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const duration = String(firstDefined(req?.duration, req?.Duration) || '').trim();
  if (!duration) {
    throw errorWithCode('INVALID_ARGUMENT', 'duration is required');
  }
  const queryParts = [`duration=${encodeURIComponent(duration)}`];
  const totalVal = firstDefined(req?.total, req?.Total);
  if (totalVal !== undefined && totalVal !== null) {
    const b = toBoolean(totalVal);
    if (b !== null) queryParts.push(`total=${b ? 'true' : 'false'}`);
  }
  const optionalParams = [
    ['location', ['location', 'Location']],
    ['request_number', ['request_number', 'requestNumber']],
    ['src_ip', ['src_ip', 'srcIp']],
    ['attack_type', ['attack_type', 'attackType']],
    ['risk_level', ['risk_level', 'riskLevel']],
    ['host', ['host', 'Host']],
  ];
  for (const [key, keys] of optionalParams) {
    const val = pickStringField(req, keys);
    if (val !== undefined && val !== '') queryParts.push(`${key}=${encodeURIComponent(val)}`);
  }
  const json = await authenticatedGet(req, callCtx.bindings, `/api/OverviewAPI?${queryParts.join('&')}`, { err: null, msg: '', data: {} });
  return { err: toValue(json?.err), msg: toValue(json?.msg), data: json?.data ?? {} };
}

async function handleSearchDetectLog(req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const queryParts = ['scope=log:detect_log'];
  const count = toQueryNumber(firstDefined(req?.count, req?.Count));
  const offset = toQueryNumber(firstDefined(req?.offset, req?.Offset), true);
  if (count !== undefined) queryParts.push(`count=${count}`);
  if (offset !== undefined) queryParts.push(`offset=${offset}`);
  const tStart = toInt64(firstDefined(req?.time_range_start, req?.timeRangeStart));
  const tEnd = toInt64(firstDefined(req?.time_range_end, req?.timeRangeEnd));
  if (tStart !== null) queryParts.push(`req_start_time__gte=${tStart}`);
  if (tEnd !== null) queryParts.push(`req_start_time__lte=${tEnd}`);
  for (const [k, v] of Object.entries(unwrapStruct(firstDefined(req?.filters, req?.Filters)))) {
    if (v === null || v === undefined) continue;
    queryParts.push(`${encodeURIComponent(k)}=${encodeURIComponent(Array.isArray(v) ? v.join(',') : String(v))}`);
  }
  const json = await authenticatedGet(req, callCtx.bindings, `/api/FilterV2API?${queryParts.join('&')}`, { err: null, msg: '', data: { items: [], total: 0 } });
  const data = json?.data && typeof json.data === 'object' ? json.data : {};
  const items = Array.isArray(data?.items) ? data.items : [];
  const n = Number(data?.total);
  const total = Number.isInteger(n) && !Number.isNaN(n) ? n : 0;
  return { err: toValue(json?.err), msg: toValue(json?.msg), data: { items, total } };
}

async function handleGetESIndices(req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const alias = String(firstDefined(req?.alias, req?.Alias) || 'detect_log').trim() || 'detect_log';
  const json = await authenticatedGet(req, callCtx.bindings, `/api/ESIndices?alias=${encodeURIComponent(alias)}`, { err: null, msg: '', data: {} });
  return { err: toValue(json?.err), msg: toValue(json?.msg), data: json?.data ?? {} };
}

const adapt = (fn) => (sdkCtx) => fn(sdkCtx?.request ?? sdkCtx?.req ?? {}, sdkCtx);

export const handlers = {
  [LOGIN]: adapt(handleLogin),
  [GET_PROFILE]: adapt(handleGetProfile),
  [GET_OVERVIEW]: adapt(handleGetOverview),
  [SEARCH_DETECT_LOG]: adapt(handleSearchDetectLog),
  [GET_ES_INDICES]: adapt(handleGetESIndices),
};

export const _test = {
  cookiePair,
  errorWithCode,
  findCookieValue,
  mergedBindings,
  normalizeBaseUrl,
  resolveBaseUrl,
  resolveCallContext,
  resolveCredential,
  resolveProxyUrl,
  resolveSkipTlsVerify,
  resolveTimeoutMs,
  toBoolean,
  toInt64,
  toQueryNumber,
  toValue,
  unwrapStruct,
  unwrapValue,
  readSetCookies,
  doLogin,
  querySessions: () => new Map(sessions),
  clearSessions: () => sessions.clear(),
  getSession,
  setSession,
  removeSession,
};
