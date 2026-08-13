import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const LIST_PATH = '/Sangfor_AF_V8035R1.Sangfor_AF_V8035R1/ListWhiteBlackListEntries';
export const GET_PATH = '/Sangfor_AF_V8035R1.Sangfor_AF_V8035R1/GetWhiteBlackListEntry';
export const CREATE_PATH = '/Sangfor_AF_V8035R1.Sangfor_AF_V8035R1/CreateWhiteBlackListEntry';
export const DELETE_PATH = '/Sangfor_AF_V8035R1.Sangfor_AF_V8035R1/DeleteWhiteBlackListEntry';

export const METHOD_LIST_FULL = 'Sangfor_AF_V8035R1.Sangfor_AF_V8035R1/ListWhiteBlackListEntries';
export const METHOD_GET_FULL = 'Sangfor_AF_V8035R1.Sangfor_AF_V8035R1/GetWhiteBlackListEntry';
export const METHOD_CREATE_FULL = 'Sangfor_AF_V8035R1.Sangfor_AF_V8035R1/CreateWhiteBlackListEntry';
export const METHOD_DELETE_FULL = 'Sangfor_AF_V8035R1.Sangfor_AF_V8035R1/DeleteWhiteBlackListEntry';

export const DEFAULT_TIMEOUT_MS = 10000;

const AUTH_EXPIRED_CODES = new Set([1003, 1012]);
const sessionCache = new Map();
const MAX_SESSION_CACHE_ENTRIES = 128;
let insecureTlsDispatcher;

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
export const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

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

const toBoolean = (value, fallback = false) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const text = raw.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(text)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(text)) return false;
  }
  return fallback;
};

const toInteger = (value, fallback) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return fallback;
  const num = Number(raw);
  return Number.isFinite(num) ? Math.trunc(num) : fallback;
};

const errorWithStatus = (status, message, afCode) => {
  const err = new GrpcError(status, message);
  if (afCode !== undefined) err.afCode = afCode;
  return err;
};

const grpcStatusForAfCode = (code) => {
  if (code === 1) return grpcStatus.UNAUTHENTICATED;
  if (code === 13) return grpcStatus.PERMISSION_DENIED;
  if ([22, 1001, 1005].includes(code)) return grpcStatus.INVALID_ARGUMENT;
  if ([1003, 1012].includes(code)) return grpcStatus.UNAUTHENTICATED;
  if (code === 1004) return grpcStatus.NOT_FOUND;
  if (code === 110) return grpcStatus.DEADLINE_EXCEEDED;
  return grpcStatus.FAILED_PRECONDITION;
};

const afError = (code, message) => errorWithStatus(grpcStatusForAfCode(code), `Sangfor AF API error ${code}: ${message || 'unknown error'}`, code);

const normalizeBaseUrl = (value) => {
  const raw = toTrimmedString(value).replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw;
};

const normalizeNamespace = (value) => toTrimmedString(value) || 'public';

const mergedBindings = (ctx = {}) => ({
  ...(ctx.config ?? {}),
  ...(ctx.bindings ?? {}),
  ...(ctx.secret ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  config: ctx.config ?? {},
  secret: ctx.secret ?? {},
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.request ?? ctx.req ?? {},
});

const requestFromContext = (ctx = {}) => ctx.request ?? ctx.req ?? {};

const resolveConfig = (ctx) => {
  const bindings = ctx.bindings ?? mergedBindings(ctx);
  const host = normalizeBaseUrl(firstDefined(bindings.host, bindings.baseUrl, bindings.base_url, bindings.restBaseUrl, bindings.rest_base_url));
  if (!host) throw errorWithStatus(grpcStatus.INVALID_ARGUMENT, 'host is required and must be an http(s) URL');
  return {
    host,
    namespace: normalizeNamespace(firstDefined(bindings.namespace, bindings.nameSpace)),
    timeoutMs: toInteger(firstDefined(ctx.limits?.timeoutMs, bindings.timeoutMs, bindings.timeout_ms), DEFAULT_TIMEOUT_MS),
    skipTlsVerify: toBoolean(firstDefined(bindings.skipTlsVerify, bindings.skip_tls_verify, bindings.tlsInsecureSkipVerify, bindings.insecureSkipVerify), false),
  };
};

const resolveSecret = (ctx) => {
  const bindings = ctx.bindings ?? mergedBindings(ctx);
  const username = toTrimmedString(firstDefined(bindings.username, bindings.user, ctx.secret?.username, ctx.secret?.user));
  const password = toTrimmedString(firstDefined(bindings.password, ctx.secret?.password));
  if (!username) throw errorWithStatus(grpcStatus.INVALID_ARGUMENT, 'username is required');
  if (!password) throw errorWithStatus(grpcStatus.INVALID_ARGUMENT, 'password is required');
  return { username, password };
};

const getSessionKey = (ctx, host, namespace) => `${ctx.meta?.instance_id || ctx.meta?.instanceId || 'default'}::${host}::${namespace}`;
const getSession = (ctx, host, namespace) => sessionCache.get(getSessionKey(ctx, host, namespace));
const setSession = (ctx, host, namespace, token) => {
  const key = getSessionKey(ctx, host, namespace);
  sessionCache.delete(key);
  sessionCache.set(key, { token });
  while (sessionCache.size > MAX_SESSION_CACHE_ENTRIES) {
    sessionCache.delete(sessionCache.keys().next().value);
  }
};
const clearSession = (ctx, host, namespace) => sessionCache.delete(getSessionKey(ctx, host, namespace));

const getInsecureTlsDispatcher = () => {
  insecureTlsDispatcher ??= new Agent({ connect: { rejectUnauthorized: false } });
  return insecureTlsDispatcher;
};

const buildTlsOptions = (config) => (config.skipTlsVerify ? { dispatcher: getInsecureTlsDispatcher() } : {});

const namespacePath = (namespace, suffix = '') => `/api/v1/namespaces/${encodeURIComponent(namespace)}${suffix}`;

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithStatus(grpcStatus.UNKNOWN, 'upstream response is not valid JSON');
  }
};

const requestAf = async (ctx, method, path, { query = {}, body, token } = {}) => {
  const config = resolveConfig(ctx);
  const url = new URL(`${config.host}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const headers = { Accept: 'application/json, text/plain, */*' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Cookie = `token=${encodeURIComponent(token)}`;

  let response;
  try {
    response = await fetch(String(url), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
      ...buildTlsOptions(config),
    });
  } catch (err) {
    const msg = err?.name === 'TimeoutError' || err?.code === 'ABORT_ERR'
      ? 'upstream request timed out'
      : (err?.cause?.message || err?.message || 'fetch failed');
    const status = msg.includes('timed out') ? grpcStatus.DEADLINE_EXCEEDED : grpcStatus.UNAVAILABLE;
    throw errorWithStatus(status, msg);
  }

  const text = await response.text();
  if (response.status >= 500) throw errorWithStatus(grpcStatus.UNAVAILABLE, `upstream HTTP ${response.status}: ${text}`);
  if (!text.trim()) throw errorWithStatus(grpcStatus.UNKNOWN, 'upstream response body is empty');
  const json = parseJson(text);
  const code = Number(json?.code ?? 0);
  if (code !== 0) throw afError(code, json?.message);
  return json;
};

const login = async (ctx) => {
  const config = resolveConfig(ctx);
  const { username, password } = resolveSecret(ctx);
  const json = await requestAf(ctx, 'POST', namespacePath(config.namespace, '/login'), {
    body: { name: username, password },
  });
  const token = toTrimmedString(json?.data?.loginResult?.token);
  if (!token) throw errorWithStatus(grpcStatus.UNKNOWN, 'login succeeded but token is empty');
  setSession(ctx, config.host, config.namespace, token);
  return token;
};

const withAuthRetry = async (ctx, fn) => {
  const config = resolveConfig(ctx);
  let token = getSession(ctx, config.host, config.namespace)?.token;
  if (!token) token = await login(ctx);
  try {
    return await fn(token);
  } catch (err) {
    if (!AUTH_EXPIRED_CODES.has(err.afCode)) throw err;
    clearSession(ctx, config.host, config.namespace);
    token = await login(ctx);
    return fn(token);
  }
};

const typeToUpstream = (value, { required = false } = {}) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '' || raw === 0 || raw === 'WHITE_BLACK_LIST_TYPE_UNSPECIFIED') {
    if (required) throw errorWithStatus(grpcStatus.INVALID_ARGUMENT, 'type is required');
    return undefined;
  }
  if (raw === 1 || String(raw).toUpperCase() === 'BLACK') return 'BLACK';
  if (raw === 2 || String(raw).toUpperCase() === 'WHITE') return 'WHITE';
  throw errorWithStatus(grpcStatus.INVALID_ARGUMENT, 'type must be BLACK or WHITE');
};

const upstreamToType = (value) => {
  const text = String(value || '').toUpperCase();
  if (text === 'BLACK') return 'BLACK';
  if (text === 'WHITE') return 'WHITE';
  return 'WHITE_BLACK_LIST_TYPE_UNSPECIFIED';
};

const mapEntry = (entry = {}) => ({
  url: toTrimmedString(entry.url),
  type: upstreamToType(entry.type),
  enable: Boolean(entry.enable),
  domain: toInteger(entry.domain, 0),
  is_default: Boolean(entry.isDefault ?? entry.is_default),
  description: toTrimmedString(entry.description),
  create_time: toTrimmedString(entry.createTime ?? entry.create_time),
});

const requireUrl = (value) => {
  const url = toTrimmedString(value);
  if (!url) throw errorWithStatus(grpcStatus.INVALID_ARGUMENT, 'url is required');
  return url;
};

const handleListWhiteBlackListEntries = async (ctx) => {
  const req = requestFromContext(ctx);
  const config = resolveConfig(ctx);
  const type = typeToUpstream(firstDefined(req.type));
  const length = Math.min(Math.max(toInteger(firstDefined(req.length), 100), 1), 200);
  const query = {
    type,
    _start: Math.max(toInteger(firstDefined(req.start), 0), 0),
    _length: length,
    _search: firstDefined(req.search),
    url: firstDefined(req.url),
    description: firstDefined(req.description),
    _sortby: firstDefined(req.sort_by, req.sortBy),
    _order: firstDefined(req.order),
  };
  const json = await withAuthRetry(ctx, (token) => requestAf(ctx, 'GET', namespacePath(config.namespace, '/whiteblacklist'), { query, token }));
  const data = json.data || {};
  return {
    total_items: toInteger(data.totalItems ?? data.total_items, 0),
    total_pages: toInteger(data.totalPages ?? data.total_pages, 0),
    page_number: toInteger(data.pageNumber ?? data.page_number, 0),
    page_size: toInteger(data.pageSize ?? data.page_size, 0),
    items_offset: toInteger(data.itemsOffset ?? data.items_offset, 0),
    item_length: toInteger(data.itemLength ?? data.item_length, 0),
    items: Array.isArray(data.items) ? data.items.map(mapEntry) : [],
  };
};

const handleGetWhiteBlackListEntry = async (ctx) => {
  const req = requestFromContext(ctx);
  const config = resolveConfig(ctx);
  const url = requireUrl(firstDefined(req.url));
  const type = typeToUpstream(firstDefined(req.type), { required: false });
  const json = await withAuthRetry(ctx, (token) => requestAf(ctx, 'GET', namespacePath(config.namespace, `/whiteblacklist/${encodeURIComponent(url)}`), { query: { type }, token }));
  return { entry: mapEntry(json.data || {}) };
};

const handleCreateWhiteBlackListEntry = async (ctx) => {
  const req = requestFromContext(ctx);
  const config = resolveConfig(ctx);
  const url = requireUrl(firstDefined(req.url));
  const type = typeToUpstream(firstDefined(req.type), { required: true });
  const enable = firstDefined(req.enable) === undefined ? true : toBoolean(req.enable, true);
  const body = { url, type, enable };
  const description = toTrimmedString(firstDefined(req.description));
  if (description) body.description = description;
  const json = await withAuthRetry(ctx, (token) => requestAf(ctx, 'POST', namespacePath(config.namespace, '/whiteblacklist'), { body, token }));
  return { entry: mapEntry(json.data || {}) };
};

const handleDeleteWhiteBlackListEntry = async (ctx) => {
  const req = requestFromContext(ctx);
  const config = resolveConfig(ctx);
  const url = requireUrl(firstDefined(req.url));
  const type = typeToUpstream(firstDefined(req.type), { required: true });
  const json = await withAuthRetry(ctx, (token) => requestAf(ctx, 'DELETE', namespacePath(config.namespace, `/whiteblacklist/${encodeURIComponent(url)}`), { query: { type }, token }));
  return { entry: mapEntry(json.data || {}) };
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [LIST_PATH]: async (req) => handleListWhiteBlackListEntries({ ...callCtx, request: req ?? callCtx.req }),
    [GET_PATH]: async (req) => handleGetWhiteBlackListEntry({ ...callCtx, request: req ?? callCtx.req }),
    [CREATE_PATH]: async (req) => handleCreateWhiteBlackListEntry({ ...callCtx, request: req ?? callCtx.req }),
    [DELETE_PATH]: async (req) => handleDeleteWhiteBlackListEntry({ ...callCtx, request: req ?? callCtx.req }),
  };
}

export const handlers = {
  [METHOD_LIST_FULL]: (ctx = {}) => handleListWhiteBlackListEntries(resolveCallContext(ctx)),
  [METHOD_GET_FULL]: (ctx = {}) => handleGetWhiteBlackListEntry(resolveCallContext(ctx)),
  [METHOD_CREATE_FULL]: (ctx = {}) => handleCreateWhiteBlackListEntry(resolveCallContext(ctx)),
  [METHOD_DELETE_FULL]: (ctx = {}) => handleDeleteWhiteBlackListEntry(resolveCallContext(ctx)),
};

export const _test = {
  afError,
  buildTlsOptions,
  clearSession,
  errorWithStatus,
  firstDefined,
  getSession,
  login,
  mapEntry,
  namespacePath,
  normalizeBaseUrl,
  parseJson,
  requestAf,
  resolveCallContext,
  resolveConfig,
  resolveSecret,
  sessionCache,
  setSession,
  toBoolean,
  toInteger,
  toTrimmedString,
  typeToUpstream,
  upstreamToType,
  withAuthRetry,
};
