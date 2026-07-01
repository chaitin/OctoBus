import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const METHOD_LOGIN_PATH = '/Sangfor_FW_V8045.Sangfor_FW_V8045/Login';
export const METHOD_BLOCK_PATH = '/Sangfor_FW_V8045.Sangfor_FW_V8045/BlockIP';
export const METHOD_UNBLOCK_PATH = '/Sangfor_FW_V8045.Sangfor_FW_V8045/UnblockIP';
export const METHOD_LOGOUT_PATH = '/Sangfor_FW_V8045.Sangfor_FW_V8045/Logout';

export const METHOD_LOGIN_FULL = 'Sangfor_FW_V8045.Sangfor_FW_V8045/Login';
export const METHOD_BLOCK_FULL = 'Sangfor_FW_V8045.Sangfor_FW_V8045/BlockIP';
export const METHOD_UNBLOCK_FULL = 'Sangfor_FW_V8045.Sangfor_FW_V8045/UnblockIP';
export const METHOD_LOGOUT_FULL = 'Sangfor_FW_V8045.Sangfor_FW_V8045/Logout';

export const LOGIN_PATH = '/api/v1/namespaces/public/login';
export const BLOCK_PATH = '/api/batch/v1/namespaces/public/whiteblacklist';
export const UNBLOCK_PATH = `${BLOCK_PATH}?_method=delete`;
export const LOGOUT_PATH = '/api/v1/namespaces/public/logout';
export const DEFAULT_TIMEOUT_MS = 5000;
export const BLOCK_SUCCESS_CODES = new Set([0, 17]);
export const UNBLOCK_SUCCESS_CODES = new Set([0, 1004]);

const SERVICE_NAME = 'Sangfor_FW_V8045';
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

const unwrapString = (source) => {
  if (source === undefined || source === null) return '';
  if (typeof source === 'object' && source !== null && hasOwn(source, 'value')) return unwrapString(source.value);
  return String(source);
};

const pickString = (source) => {
  if (source === undefined || source === null) return undefined;
  return unwrapString(source);
};

const normalizeBaseUrl = (raw) => {
  const trimmed = unwrapString(raw).trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;
  return trimmed.replace(/\/+$/, '');
};

const extractStringList = (value) => {
  if (value === undefined || value === null) return undefined;
  const list = Array.isArray(value) ? value : Array.isArray(value?.values) ? value.values : undefined;
  if (!list) return undefined;
  return list.map((item) => {
    if (item === undefined || item === null) throw errorWithCode('INVALID_ARGUMENT', 'addresses elements must be non-empty strings');
    return unwrapString(item).trim();
  });
};

const ensureAddresses = (req = {}) => {
  const candidates = [req.addresses, req.ip_list, req.ipList, req.targets];
  const found = candidates.reduce((acc, item) => (acc !== undefined ? acc : extractStringList(item)), undefined);
  if (!found) throw errorWithCode('INVALID_ARGUMENT', 'addresses/ip_list must be a non-empty array');
  const filtered = found.filter((ip) => ip);
  if (filtered.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'addresses/ip_list must contain at least one IP');
  return filtered;
};

const resolveLoginField = (bindingValue, fieldName) => {
  const binding = pickString(bindingValue);
  if (binding && binding.trim()) return binding.trim();
  throw errorWithCode('INVALID_ARGUMENT', `${fieldName} is required via secret or config`);
};

const toBoolean = (value) => {
  const raw = value && typeof value === 'object' && hasOwn(value, 'value') ? value.value : value;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw !== 0;
  if (typeof raw === 'string') {
    const text = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'n', 'off', ''].includes(text)) return false;
  }
  return false;
};

const optionalUint32 = (value) => {
  const raw = value && typeof value === 'object' && hasOwn(value, 'value') ? value.value : value;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return Math.trunc(num);
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

const requestFromContext = (ctx = {}) => ctx.request ?? ctx.req ?? {};

const buildLogPrefix = (meta = {}, action) => {
  const labels = [];
  if (meta.instance_id || meta.instanceId) labels.push(`inst=${meta.instance_id || meta.instanceId}`);
  if (meta.request_id || meta.requestId) labels.push(`req=${meta.request_id || meta.requestId}`);
  return `[${SERVICE_NAME}][${action}]${labels.length ? `[${labels.join(' ')}]` : ''}`;
};

const getInstanceId = (ctx = {}) => String(ctx?.meta?.instance_id || ctx?.meta?.instanceId || 'unknown');
const buildSessionKey = (ctx, baseUrl) => `${getInstanceId(ctx)}::${baseUrl}`;
const setSession = (ctx, baseUrl, session) => sessionCache.set(buildSessionKey(ctx, baseUrl), session);
const getSession = (ctx, baseUrl) => sessionCache.get(buildSessionKey(ctx, baseUrl));
const clearSession = (ctx, baseUrl) => sessionCache.delete(buildSessionKey(ctx, baseUrl));
const clearSessionCache = () => sessionCache.clear();
const requireToken = (ctx, baseUrl) => {
  const token = unwrapString(getSession(ctx, baseUrl)?.token).trim();
  if (!token) throw errorWithCode('FAILED_PRECONDITION', 'call Login first');
  return token;
};

const logInfo = (meta, action, payload) => {
  const prefix = buildLogPrefix(meta, action);
  try {
    console.log(prefix, JSON.stringify(payload));
  } catch {
    console.log(prefix, payload);
  }
};

const logError = (meta, action, payload) => {
  const prefix = buildLogPrefix(meta, action);
  try {
    console.error(prefix, JSON.stringify(payload));
  } catch {
    console.error(prefix, payload);
  }
};

const parseJson = (text, contentType = '') => {
  if (!String(text || '').trim()) return null;
  if (String(contentType).includes('application/json')) return JSON.parse(text);
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', 'response is not valid JSON');
  }
};

const mapHttpError = (res, bodyText) => {
  const text = String(bodyText || '');
  if (res.status === 401 || res.status === 403) throw errorWithCode('PERMISSION_DENIED', `upstream http ${res.status}: ${text}`);
  if (res.status >= 400 && res.status < 500) throw errorWithCode('FAILED_PRECONDITION', `upstream http ${res.status}: ${text}`);
  throw errorWithCode('UNAVAILABLE', `upstream http ${res.status}: ${text}`);
};

const buildTlsOptions = (bindings = {}) => {
  if (!toBoolean(bindings.skipTlsVerify) && !toBoolean(bindings.tlsInsecureSkipVerify) && !toBoolean(bindings.insecureSkipVerify)) return {};
  return { dispatcher: getInsecureTlsDispatcher() };
};

let insecureTlsDispatcher;

const getInsecureTlsDispatcher = () => {
  insecureTlsDispatcher ??= new Agent({ connect: { rejectUnauthorized: false } });
  return insecureTlsDispatcher;
};

const fetchJson = async (url, init, { bindings = {}, timeoutMs }) => {
  let res;
  try {
    res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      ...buildTlsOptions(bindings),
    });
  } catch (err) {
    const reason = err?.cause?.message || err?.message || 'fetch failed';
    throw errorWithCode('UNAVAILABLE', reason);
  }
  const headers = res.headers || { get: () => '' };
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') || '' : headers['content-type'] || '';
  const text = await res.text();
  if (!res.ok) mapHttpError(res, text);
  return { json: parseJson(text, contentType), text };
};

const buildCookie = (token) => `token=${encodeURIComponent(token)}`;

const mapSangforResponse = (json) => ({
  code: typeof json?.code === 'number' ? json.code : Number(json?.code ?? 0),
  message: typeof json?.message === 'string' ? json.message : String(json?.message ?? ''),
  data: json?.data ?? null,
});

const requireJsonObject = (json, action) => {
  if (!json || typeof json !== 'object') throw errorWithCode('UNKNOWN', `${action} response is empty or invalid`);
  return json;
};

const ensureBaseUrl = (bindings = {}) => {
  const candidate = normalizeBaseUrl(firstDefined(bindings.host, bindings.restBaseUrl, bindings.baseUrl));
  if (!candidate) throw errorWithCode('INVALID_ARGUMENT', 'bindings.host/restBaseUrl/baseUrl must be http(s)');
  return candidate;
};

const resolveTimeoutMs = (ctx = {}, bindings = {}) => firstDefined(
  optionalUint32(ctx.limits?.timeoutMs),
  optionalUint32(bindings.timeoutMs),
  DEFAULT_TIMEOUT_MS,
);

const buildEngineHeaders = (bindings = {}, meta = {}) => ({
  ...(bindings.headers && typeof bindings.headers === 'object' ? bindings.headers : {}),
  'x-engine-instance': meta.instance_id || meta.instanceId || 'unknown',
  'x-request-id': meta.request_id || meta.requestId || 'unknown',
});

const buildBlockPayload = (addresses, description) => addresses.map((ip) => ({
  url: ip,
  enable: true,
  type: 'BLACK',
  description: description || 'Block IP',
}));

const buildUnblockPayload = (addresses) => addresses.map((ip) => ({
  url: ip,
  type: 'BLACK',
}));

const ensureSuccessCode = (code, allowedSet, action, message) => {
  if (allowedSet.has(code)) return;
  throw errorWithCode('FAILED_PRECONDITION', `${action} failed: code=${code} message=${message || 'unknown'}`);
};

const makeRuntime = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings || {};
  const meta = callCtx.meta || {};
  const timeoutMs = resolveTimeoutMs(callCtx, bindings);
  const engineHeaders = buildEngineHeaders(bindings, meta);

  const runLogin = async (_req = {}) => {
    const baseUrl = ensureBaseUrl(bindings);
    const name = resolveLoginField(pickString(bindings.user)?.trim() ? bindings.user : bindings.username, 'user');
    const password = resolveLoginField(bindings.password, 'password');
    const payload = { name, password };
    logInfo(meta, 'Login:start', { baseUrl });
    let json;
    try {
      ({ json } = await fetchJson(`${baseUrl}${LOGIN_PATH}`, {
        method: 'POST',
        headers: { ...engineHeaders, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }, { bindings, timeoutMs }));
    } catch (err) {
      logError(meta, 'Login:http-error', { baseUrl, error: err.message });
      throw err;
    }
    const body = requireJsonObject(json, 'Login');
    const mapped = mapSangforResponse(body);
    if (mapped.code !== 0) {
      logError(meta, 'Login:failed', mapped);
      throw errorWithCode('PERMISSION_DENIED', `login failed: code=${mapped.code} message=${mapped.message || 'unknown'}`);
    }
    const token = unwrapString(body?.data?.loginResult?.token).trim();
    if (!token) throw errorWithCode('UNKNOWN', 'login succeeded but token is empty');
    setSession(callCtx, baseUrl, { token });
    logInfo(meta, 'Login:success', { baseUrl });
    return { ...mapped, token: '', data: null };
  };

  const runBlock = async (req = {}) => {
    const baseUrl = ensureBaseUrl(bindings);
    const token = requireToken(callCtx, baseUrl);
    const addresses = ensureAddresses(req);
    const description = unwrapString(req.description).trim() || 'Block IP';
    logInfo(meta, 'BlockIP:start', { baseUrl, count: addresses.length });
    let json;
    try {
      ({ json } = await fetchJson(`${baseUrl}${BLOCK_PATH}`, {
        method: 'POST',
        headers: { ...engineHeaders, 'content-type': 'application/json', Cookie: buildCookie(token) },
        body: JSON.stringify(buildBlockPayload(addresses, description)),
      }, { bindings, timeoutMs }));
    } catch (err) {
      logError(meta, 'BlockIP:http-error', { baseUrl, error: err.message });
      throw err;
    }
    const mapped = mapSangforResponse(requireJsonObject(json, 'BlockIP'));
    try {
      ensureSuccessCode(mapped.code, BLOCK_SUCCESS_CODES, 'BlockIP', mapped.message);
    } catch (err) {
      logError(meta, 'BlockIP:failed', mapped);
      throw err;
    }
    logInfo(meta, 'BlockIP:success', { baseUrl, code: mapped.code, count: addresses.length });
    return mapped;
  };

  const runUnblock = async (req = {}) => {
    const baseUrl = ensureBaseUrl(bindings);
    const token = requireToken(callCtx, baseUrl);
    const addresses = ensureAddresses(req);
    logInfo(meta, 'UnblockIP:start', { baseUrl, count: addresses.length });
    let json;
    try {
      ({ json } = await fetchJson(`${baseUrl}${UNBLOCK_PATH}`, {
        method: 'POST',
        headers: { ...engineHeaders, 'content-type': 'application/json', Cookie: buildCookie(token) },
        body: JSON.stringify(buildUnblockPayload(addresses)),
      }, { bindings, timeoutMs }));
    } catch (err) {
      logError(meta, 'UnblockIP:http-error', { baseUrl, error: err.message });
      throw err;
    }
    const mapped = mapSangforResponse(requireJsonObject(json, 'UnblockIP'));
    try {
      ensureSuccessCode(mapped.code, UNBLOCK_SUCCESS_CODES, 'UnblockIP', mapped.message);
    } catch (err) {
      logError(meta, 'UnblockIP:failed', mapped);
      throw err;
    }
    logInfo(meta, 'UnblockIP:success', { baseUrl, code: mapped.code, count: addresses.length });
    return mapped;
  };

  const runLogout = async (req = {}) => {
    const baseUrl = ensureBaseUrl(bindings);
    const token = requireToken(callCtx, baseUrl);
    logInfo(meta, 'Logout:start', { baseUrl });
    let json;
    try {
      ({ json } = await fetchJson(`${baseUrl}${LOGOUT_PATH}`, {
        method: 'POST',
        headers: { ...engineHeaders, 'content-type': 'application/json', Cookie: buildCookie(token) },
        body: JSON.stringify({}),
      }, { bindings, timeoutMs }));
    } catch (err) {
      logError(meta, 'Logout:http-error', { baseUrl, error: err.message });
      throw err;
    }
    const mapped = mapSangforResponse(requireJsonObject(json, 'Logout'));
    if (mapped.code !== 0) {
      logError(meta, 'Logout:failed', mapped);
      throw errorWithCode('FAILED_PRECONDITION', `logout failed: code=${mapped.code} message=${mapped.message || 'unknown'}`);
    }
    clearSession(callCtx, baseUrl);
    logInfo(meta, 'Logout:success', { baseUrl });
    return mapped;
  };

  return { callCtx, runLogin, runBlock, runUnblock, runLogout };
};

export function rpcdef(ctx = {}) {
  const runtime = makeRuntime(ctx);
  return {
    [METHOD_LOGIN_PATH]: async (req) => runtime.runLogin(req ?? runtime.callCtx.req ?? {}),
    [METHOD_BLOCK_PATH]: async (req) => runtime.runBlock(req ?? runtime.callCtx.req ?? {}),
    [METHOD_UNBLOCK_PATH]: async (req) => runtime.runUnblock(req ?? runtime.callCtx.req ?? {}),
    [METHOD_LOGOUT_PATH]: async (req) => runtime.runLogout(req ?? runtime.callCtx.req ?? {}),
  };
}

export const handlers = {
  [METHOD_LOGIN_FULL]: (ctx = {}) => makeRuntime({ ...ctx, request: requestFromContext(ctx) }).runLogin(requestFromContext(ctx)),
  [METHOD_BLOCK_FULL]: (ctx = {}) => makeRuntime({ ...ctx, request: requestFromContext(ctx) }).runBlock(requestFromContext(ctx)),
  [METHOD_UNBLOCK_FULL]: (ctx = {}) => makeRuntime({ ...ctx, request: requestFromContext(ctx) }).runUnblock(requestFromContext(ctx)),
  [METHOD_LOGOUT_FULL]: (ctx = {}) => makeRuntime({ ...ctx, request: requestFromContext(ctx) }).runLogout(requestFromContext(ctx)),
};

export const _test = {
  buildBlockPayload,
  buildCookie,
  buildEngineHeaders,
  buildLogPrefix,
  buildSessionKey,
  buildTlsOptions,
  buildUnblockPayload,
  clearSession,
  clearSessionCache,
  ensureAddresses,
  ensureBaseUrl,
  ensureSuccessCode,
  errorWithCode,
  extractStringList,
  fetchJson,
  firstDefined,
  getSession,
  hasOwn,
  getInstanceId,
  logError,
  logInfo,
  makeRuntime,
  mapHttpError,
  mapSangforResponse,
  normalizeBaseUrl,
  optionalUint32,
  parseJson,
  pickString,
  requireJsonObject,
  requireToken,
  resolveCallContext,
  resolveLoginField,
  resolveTimeoutMs,
  setSession,
  toBoolean,
  unwrapString,
};
