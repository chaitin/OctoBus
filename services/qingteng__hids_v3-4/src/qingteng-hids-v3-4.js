import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const LOGIN_PATH = '/QingTeng_HIDS_V34.QingTeng_HIDS_V34/Login';
export const QUERY_HOST_ASSETS_PATH = '/QingTeng_HIDS_V34.QingTeng_HIDS_V34/QueryHostAssets';
export const CREATE_HOST_ISOLATION_PATH = '/QingTeng_HIDS_V34.QingTeng_HIDS_V34/CreateHostIsolation';
export const DELETE_HOST_ISOLATION_PATH = '/QingTeng_HIDS_V34.QingTeng_HIDS_V34/DeleteHostIsolation';

export const METHOD_LOGIN_FULL = 'QingTeng_HIDS_V34.QingTeng_HIDS_V34/Login';
export const METHOD_QUERY_HOST_ASSETS_FULL = 'QingTeng_HIDS_V34.QingTeng_HIDS_V34/QueryHostAssets';
export const METHOD_CREATE_HOST_ISOLATION_FULL = 'QingTeng_HIDS_V34.QingTeng_HIDS_V34/CreateHostIsolation';
export const METHOD_DELETE_HOST_ISOLATION_FULL = 'QingTeng_HIDS_V34.QingTeng_HIDS_V34/DeleteHostIsolation';

export const UPSTREAM_LOGIN_PATH = '/v1/api/auth';
export const UPSTREAM_QUERY_HOST_ASSETS_PATH = '/external/api/assets/host';
export const UPSTREAM_CREATE_HOST_ISOLATION_PATH = '/external/api/ms-srv/api/segmentation/create';
export const UPSTREAM_DELETE_HOST_ISOLATION_PATH = '/external/api/ms-srv/api/segmentation/realDel';

export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_REMARK = '自动化创建隔离任务';

const SERVICE_NAME = 'QingTeng_HIDS_V34';
const SYSTEM_TYPES = new Set(['linux', 'win']);
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

const upstreamError = (code, message, details = {}) => {
  const rawBody = typeof details.rawBody === 'string' ? details.rawBody : '';
  const payload = {
    code,
    message,
    http_status: Number.isFinite(Number(details.httpStatus)) ? Number(details.httpStatus) : 0,
    raw_body: '',
    raw_body_length: rawBody.length,
    reason: String(details.reason || '').trim(),
  };
  const err = new GrpcError(grpcCodeFor(code), JSON.stringify(payload));
  err.legacyCode = code;
  err.httpStatus = payload.http_status;
  err.rawBody = payload.raw_body;
  err.reason = payload.reason;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const unwrapString = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrapString(value.value);
  return String(value);
};

const pickString = (obj, keys) => {
  for (const key of keys) {
    if (!hasOwn(obj, key)) continue;
    const value = unwrapString(obj[key]).trim();
    if (value) return value;
  }
  return '';
};

const normalizeBaseUrl = (value) => {
  const raw = unwrapString(value).trim();
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.replace(/\/+$/, '');
};

const optionalUint32 = (value) => {
  const raw = firstDefined(value?.value, value);
  if (raw === undefined || raw === null) return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num) || Number.isNaN(num) || num <= 0) return undefined;
  return Math.trunc(num);
};

const toBoolean = (value) => {
  const raw = firstDefined(value?.value, value);
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return Number.isNaN(raw) ? false : raw !== 0;
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
  req: ctx.request ?? ctx.req ?? {},
});

const requestFromContext = (ctx = {}) => ctx?.request ?? ctx?.req ?? {};

const resolveTimeoutMs = (ctx = {}) => firstDefined(
  optionalUint32(ctx.limits?.timeoutMs),
  optionalUint32(ctx.bindings?.timeoutMs),
  DEFAULT_TIMEOUT_MS,
);

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

const buildLogPrefix = (ctx = {}, action) => {
  const meta = ctx.meta || {};
  const labels = [];
  if (meta.instance_id || meta.instanceId) labels.push(`inst=${meta.instance_id || meta.instanceId}`);
  if (meta.request_id || meta.requestId) labels.push(`req=${meta.request_id || meta.requestId}`);
  return `[${SERVICE_NAME}][${action}]${labels.length ? `[${labels.join(' ')}]` : ''}`;
};

const logFlow = (ctx, action, details) => {
  const prefix = buildLogPrefix(ctx, action);
  try {
    console.log(prefix, JSON.stringify(details));
  } catch {
    console.log(prefix, details);
  }
};

const sha1Hex = (input) => crypto.createHash('sha1').update(String(input ?? ''), 'utf8').digest('hex');

const resolveHost = (bindings = {}) => {
  const host = normalizeBaseUrl(firstDefined(bindings.host, bindings.restBaseUrl, bindings.baseUrl));
  if (!host) throw errorWithCode('INVALID_ARGUMENT', 'host/baseUrl is required in bindings');
  return host;
};

const resolveUsername = (bindings = {}) => {
  const username = pickString(bindings, ['username', 'user']);
  if (!username) throw errorWithCode('INVALID_ARGUMENT', 'username/user is required in bindings');
  return username;
};

const resolvePassword = (bindings = {}) => {
  const password = pickString(bindings, ['password']);
  if (!password) throw errorWithCode('INVALID_ARGUMENT', 'password is required in bindings');
  return password;
};

const requireString = (value, field) => {
  const text = unwrapString(value).trim();
  if (!text) throw errorWithCode('INVALID_ARGUMENT', `${field} is required`);
  return text;
};

const requireAgentIds = (value) => {
  const source = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray(value.values)
      ? value.values
      : null;
  if (!source || source.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'agent_ids must be a non-empty array');
  const agentIds = source.map((item) => unwrapString(item).trim()).filter(Boolean);
  if (agentIds.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'agent_ids must contain at least one non-empty value');
  return agentIds;
};

const requireSystemType = (value) => {
  const systemType = unwrapString(value).trim().toLowerCase();
  if (!SYSTEM_TYPES.has(systemType)) throw errorWithCode('INVALID_ARGUMENT', 'system_type must be linux or win');
  return systemType;
};

const buildSessionKey = (ctx = {}, host) => {
  const meta = ctx.meta || {};
  const instanceId = String(meta.instance_id || meta.instanceId || 'default-instance').trim() || 'default-instance';
  return `${instanceId}::${host}`;
};

const getSession = (ctx, host) => sessionCache.get(buildSessionKey(ctx, host));

const setSession = (ctx, host, session) => {
  sessionCache.set(buildSessionKey(ctx, host), { ...session, host });
};

const clearSession = (ctx, host) => {
  sessionCache.delete(buildSessionKey(ctx, host));
};

const buildCommonHeaders = (ctx = {}, extra = {}) => {
  const bindings = ctx.bindings || {};
  const meta = ctx.meta || {};
  return {
    ...(bindings.headers || {}),
    'x-engine-instance': meta.instance_id || meta.instanceId || 'unknown',
    'x-request-id': meta.request_id || meta.requestId || 'unknown',
    ...extra,
  };
};

const mapHttpStatusToCode = (status) => {
  if (status === 401 || status === 403) return 'PERMISSION_DENIED';
  if (status >= 400 && status < 500) return 'FAILED_PRECONDITION';
  return 'UNAVAILABLE';
};

const parseJsonBody = (text, status, action) => {
  try {
    return JSON.parse(text);
  } catch {
    throw upstreamError('UNKNOWN', `qingteng ${action} response is not valid JSON`, {
      httpStatus: status,
      rawBody: text,
      reason: 'response is not valid JSON',
    });
  }
};

const fetchText = async (ctx, url, init = {}) => {
  let res;
  try {
    res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(resolveTimeoutMs(ctx)),
      ...buildTlsOptions(ctx.bindings || {}),
    });
  } catch (err) {
    throw upstreamError('UNAVAILABLE', 'qingteng upstream request failed', {
      httpStatus: 0,
      rawBody: '',
      reason: err?.cause?.message || err?.message || 'fetch failed',
    });
  }

  let text;
  try {
    text = await res.text();
  } catch (err) {
    throw upstreamError('UNKNOWN', 'qingteng upstream response body read failed', {
      httpStatus: res.status,
      rawBody: '',
      reason: err?.message || 'response body read failed',
    });
  }
  return { status: res.status, text, headers: res.headers };
};

const extractLoginSession = (status, text) => {
  const json = parseJsonBody(text, status, 'login');
  const comId = pickString(json?.data || {}, ['comId']);
  const jwt = pickString(json?.data || {}, ['jwt']);
  const signKey = pickString(json?.data || {}, ['signKey']);
  if (!comId || !jwt || !signKey) {
    throw upstreamError('UNKNOWN', 'qingteng login response missing credentials', {
      httpStatus: status,
      rawBody: text,
      reason: 'login response missing comId/jwt/signKey',
    });
  }
  return { comId, jwt, signKey, raw: json };
};

const loginOnce = async (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const host = resolveHost(callCtx.bindings);
  const username = resolveUsername(callCtx.bindings);
  const password = resolvePassword(callCtx.bindings);
  const body = JSON.stringify({ username, password });
  logFlow(callCtx, 'Login:start', { host });
  const response = await fetchText(callCtx, `${host}${UPSTREAM_LOGIN_PATH}`, {
    method: 'POST',
    headers: buildCommonHeaders(callCtx, { 'Content-Type': 'application/json' }),
    body,
  });
  if (response.status < 200 || response.status >= 300) {
    throw upstreamError(mapHttpStatusToCode(response.status), 'qingteng login failed', {
      httpStatus: response.status,
      rawBody: response.text,
      reason: `upstream http ${response.status}`,
    });
  }
  const session = extractLoginSession(response.status, response.text);
  setSession(callCtx, host, session);
  logFlow(callCtx, 'Login:success', { host, http_status: response.status });
  return {
    host,
    session,
    response: {
      http_status: response.status,
      raw_body: '',
    },
  };
};

const ensureAuthenticated = async (ctx = {}, options = {}) => {
  const callCtx = resolveCallContext(ctx);
  const host = resolveHost(callCtx.bindings);
  if (!options.forceRefresh) {
    const cached = getSession(callCtx, host);
    if (cached?.comId && cached?.jwt && cached?.signKey) return { host, session: cached };
  }
  const loggedIn = await loginOnce(callCtx);
  return { host: loggedIn.host, session: loggedIn.session };
};

const encodeQueryComponent = (value) => encodeURIComponent(String(value)).replace(/%20/g, '+');

const buildSortedQuery = (params = {}) => {
  const pairs = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  return pairs.map(([key, value]) => `${encodeQueryComponent(key)}=${encodeQueryComponent(value)}`).join('&');
};

const buildGetPayloadInfo = (params = {}) =>
  Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}${String(value)}`)
    .join('');

const buildSignedHeaders = (ctx, session, payloadInfo, timestamp) => ({
  ...buildCommonHeaders(ctx, {
    'Content-Type': 'application/json',
    comId: session.comId,
    timestamp: String(timestamp),
    sign: sha1Hex(`${session.comId}${payloadInfo}${timestamp}${session.signKey}`),
    Authorization: `Bearer ${session.jwt}`,
  }),
});

const runSignedRequest = async (ctx = {}, requestFactory) => {
  const callCtx = resolveCallContext(ctx);
  const execute = async (auth) => {
    const request = requestFactory(auth);
    return {
      host: auth.host,
      ...request,
      response: await fetchText(callCtx, request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      }),
    };
  };

  let auth = await ensureAuthenticated(callCtx);
  let result = await execute(auth);
  if (result.response.status === 401 || result.response.status === 403) {
    clearSession(callCtx, result.host);
    auth = await ensureAuthenticated(callCtx, { forceRefresh: true });
    result = await execute(auth);
  }

  if (result.response.status < 200 || result.response.status >= 300) {
    throw upstreamError(mapHttpStatusToCode(result.response.status), 'qingteng upstream request failed', {
      httpStatus: result.response.status,
      rawBody: result.response.text,
      reason: `upstream http ${result.response.status}`,
    });
  }

  return {
    http_status: result.response.status,
    raw_body: '',
  };
};

const handleLogin = async (_req, ctx = {}) => {
  const result = await loginOnce(ctx);
  return result.response;
};

const handleQueryHostAssets = async (req = {}, ctx = {}) => {
  const ip = requireString(req.ip, 'ip');
  const systemType = requireSystemType(req.system_type ?? req.systemType);
  const query = { ip };
  return runSignedRequest(ctx, ({ host, session }) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const queryString = buildSortedQuery(query);
    return {
      method: 'GET',
      url: `${host}${UPSTREAM_QUERY_HOST_ASSETS_PATH}/${encodeURIComponent(systemType)}?${queryString}`,
      headers: buildSignedHeaders(ctx, session, buildGetPayloadInfo(query), timestamp),
    };
  });
};

const handleCreateHostIsolation = async (req = {}, ctx = {}) => {
  const agentIds = requireAgentIds(firstDefined(req.agent_ids, req.agentIds));
  const remark = unwrapString(req.remark).trim() || DEFAULT_REMARK;
  return runSignedRequest(ctx, ({ host, session }) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = { agentIds, direction: 'all', remark };
    const body = JSON.stringify(payload);
    return {
      method: 'POST',
      url: `${host}${UPSTREAM_CREATE_HOST_ISOLATION_PATH}`,
      headers: buildSignedHeaders(ctx, session, body, timestamp),
      body,
    };
  });
};

const handleDeleteHostIsolation = async (req = {}, ctx = {}) => {
  const agentIds = requireAgentIds(firstDefined(req.agent_ids, req.agentIds));
  return runSignedRequest(ctx, ({ host, session }) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = { agentIds };
    const body = JSON.stringify(payload);
    return {
      method: 'DELETE',
      url: `${host}${UPSTREAM_DELETE_HOST_ISOLATION_PATH}`,
      headers: buildSignedHeaders(ctx, session, body, timestamp),
      body,
    };
  });
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [LOGIN_PATH]: async (req) => handleLogin(req ?? callCtx.req ?? {}, callCtx),
    [QUERY_HOST_ASSETS_PATH]: async (req) => handleQueryHostAssets(req ?? callCtx.req ?? {}, callCtx),
    [CREATE_HOST_ISOLATION_PATH]: async (req) => handleCreateHostIsolation(req ?? callCtx.req ?? {}, callCtx),
    [DELETE_HOST_ISOLATION_PATH]: async (req) => handleDeleteHostIsolation(req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_LOGIN_FULL]: (ctx = {}) => handleLogin(requestFromContext(ctx), ctx),
  [METHOD_QUERY_HOST_ASSETS_FULL]: (ctx = {}) => handleQueryHostAssets(requestFromContext(ctx), ctx),
  [METHOD_CREATE_HOST_ISOLATION_FULL]: (ctx = {}) => handleCreateHostIsolation(requestFromContext(ctx), ctx),
  [METHOD_DELETE_HOST_ISOLATION_FULL]: (ctx = {}) => handleDeleteHostIsolation(requestFromContext(ctx), ctx),
};

export const _test = {
  buildCommonHeaders,
  buildGetPayloadInfo,
  buildLogPrefix,
  buildSessionKey,
  buildSignedHeaders,
  buildSortedQuery,
  buildTlsOptions,
  clearSession,
  clearSessionCache: () => sessionCache.clear(),
  encodeQueryComponent,
  ensureAuthenticated,
  errorWithCode,
  extractLoginSession,
  fetchText,
  firstDefined,
  getCachedSessionCount: () => sessionCache.size,
  getSession,
  handleCreateHostIsolation,
  handleDeleteHostIsolation,
  handleLogin,
  handleQueryHostAssets,
  hasOwn,
  loginOnce,
  logFlow,
  mapHttpStatusToCode,
  normalizeBaseUrl,
  optionalUint32,
  parseJsonBody,
  pickString,
  requireAgentIds,
  requireString,
  requireSystemType,
  resolveCallContext,
  resolveHost,
  resolvePassword,
  resolveTimeoutMs,
  resolveUsername,
  runSignedRequest,
  setSession,
  sha1Hex,
  toBoolean,
  unwrapString,
  upstreamError,
};
