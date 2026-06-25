import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const METHOD_LIST_ASSETS_PATH = '/JumpServer_Bastionhost_V41016.JumpServer_Bastionhost_V41016/ListAssets';
export const METHOD_GET_ASSET_PATH = '/JumpServer_Bastionhost_V41016.JumpServer_Bastionhost_V41016/GetAsset';
export const METHOD_LIST_USERS_PATH = '/JumpServer_Bastionhost_V41016.JumpServer_Bastionhost_V41016/ListUsers';
export const METHOD_LIST_ONLINE_SESSIONS_PATH = '/JumpServer_Bastionhost_V41016.JumpServer_Bastionhost_V41016/ListOnlineSessions';
export const METHOD_LIST_ASSETS_FULL = 'JumpServer_Bastionhost_V41016.JumpServer_Bastionhost_V41016/ListAssets';
export const METHOD_GET_ASSET_FULL = 'JumpServer_Bastionhost_V41016.JumpServer_Bastionhost_V41016/GetAsset';
export const METHOD_LIST_USERS_FULL = 'JumpServer_Bastionhost_V41016.JumpServer_Bastionhost_V41016/ListUsers';
export const METHOD_LIST_ONLINE_SESSIONS_FULL = 'JumpServer_Bastionhost_V41016.JumpServer_Bastionhost_V41016/ListOnlineSessions';

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_API_PREFIX = '/api/v1';
const DEFAULT_LIMIT = 20;

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message, details = {}) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  err.details = details;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

const unwrap = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrap(value.value);
  return String(value).trim();
};

const boolOf = (value) => {
  const raw = value && typeof value === 'object' && hasOwn(value, 'value') ? value.value : value;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw !== 0;
  if (typeof raw === 'string') {
    const lowered = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(lowered)) return true;
    if (['0', 'false', 'no', 'n', 'off', ''].includes(lowered)) return false;
  }
  return false;
};

const intOf = (value, fallback = 0) => {
  const raw = value && typeof value === 'object' && hasOwn(value, 'value') ? value.value : value;
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
};

const jsonString = (value) => {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return 'null';
  }
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx.config ?? {}),
  ...(ctx.secret ?? {}),
  ...(ctx.bindings ?? {}),
});

const resolveCtx = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.req ?? ctx.request ?? {},
});

const baseUrlOf = (ctx) => {
  const raw = unwrap(firstDefined(ctx.bindings.endpoint, ctx.bindings.baseUrl, ctx.bindings.host));
  if (!raw) throw errorWithCode('INVALID_ARGUMENT', 'endpoint is required');
  if (!/^https?:\/\//i.test(raw)) throw errorWithCode('INVALID_ARGUMENT', 'endpoint must be an HTTP/HTTPS URL');
  return raw.replace(/\/+$/, '');
};

const apiPrefixOf = (ctx) => {
  const raw = unwrap(firstDefined(ctx.bindings.apiPrefix, ctx.bindings.api_prefix, DEFAULT_API_PREFIX));
  const prefixed = raw.startsWith('/') ? raw : `/${raw}`;
  return prefixed.replace(/\/+$/, '');
};

const timeoutOf = (ctx) => {
  const timeoutMs = intOf(firstDefined(ctx.bindings.timeoutMs, ctx.bindings.timeout_ms, ctx.limits.timeoutMs), DEFAULT_TIMEOUT_MS);
  return timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
};

const buildTlsOptions = (ctx) => {
  const rejectUnauthorized = firstDefined(ctx.bindings.rejectUnauthorized, ctx.bindings.reject_unauthorized);
  const skip = boolOf(ctx.bindings.skipTlsVerify) || boolOf(ctx.bindings.tlsInsecureSkipVerify) || rejectUnauthorized === false;
  return skip ? { skipTlsVerify: true, tlsInsecureSkipVerify: true, insecureSkipVerify: true } : {};
};

const parseBody = (text, stage) => {
  if (!String(text || '').trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', `${stage} response is not valid JSON`);
  }
};

const mapHttpError = (stage, status, text) => {
  const excerpt = String(text || '').slice(0, 256);
  if (status === 401) return errorWithCode('UNAUTHENTICATED', `${stage} unauthorized`, { status });
  if (status === 403) return errorWithCode('PERMISSION_DENIED', `${stage} forbidden`, { status });
  if (status >= 400 && status < 500) return errorWithCode('FAILED_PRECONDITION', `${stage} upstream http ${status}: ${excerpt}`, { status });
  return errorWithCode('UNAVAILABLE', `${stage} upstream http ${status}: ${excerpt}`, { status });
};

const headersOf = async (ctx) => {
  const customHeaders = ctx.bindings.headers && typeof ctx.bindings.headers === 'object' ? ctx.bindings.headers : {};
  const authorization = unwrap(ctx.bindings.authorization);
  if (authorization) return { ...customHeaders, authorization, accept: 'application/json' };

  const token = unwrap(firstDefined(ctx.bindings.token, ctx.bindings.accessToken, ctx.bindings.access_token));
  if (token) return { ...customHeaders, authorization: /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`, accept: 'application/json' };

  const username = unwrap(ctx.bindings.username);
  const password = unwrap(ctx.bindings.password);
  if (!username || !password) {
    throw errorWithCode('INVALID_ARGUMENT', 'token or username/password is required');
  }

  const loginUrl = `${baseUrlOf(ctx)}${apiPrefixOf(ctx)}/authentication/auth/`;
  const result = await fetchJson(ctx, loginUrl, {
    method: 'POST',
    body: { username, password },
    auth: false,
    stage: 'login',
  });
  const loginToken = unwrap(result?.token);
  const keyword = unwrap(result?.keyword) || 'Bearer';
  if (!loginToken) throw errorWithCode('UNAUTHENTICATED', 'JumpServer login response did not contain token');
  return { ...customHeaders, authorization: `${keyword} ${loginToken}`, accept: 'application/json' };
};

const fetchJson = async (ctx, url, opts = {}) => {
  const headers = {
    accept: 'application/json',
    ...(opts.body ? { 'content-type': 'application/json' } : {}),
    ...(opts.auth === false ? {} : await headersOf(ctx)),
    ...(opts.headers || {}),
  };
  let res;
  try {
    res = await fetch(url, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      timeoutMs: timeoutOf(ctx),
      ...buildTlsOptions(ctx),
    });
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', err?.message || 'fetch failed');
  }
  const text = await res.text();
  if (!res.ok) throw mapHttpError(opts.stage || 'request', res.status, text);
  return parseBody(text, opts.stage || 'request');
};

const addPagingParams = (url, req = {}) => {
  const limit = intOf(req.limit, DEFAULT_LIMIT);
  const offset = intOf(req.offset, 0);
  if (limit > 0) url.searchParams.set('limit', String(limit));
  if (offset > 0) url.searchParams.set('offset', String(offset));
  const search = unwrap(req.search);
  if (search) url.searchParams.set('search', search);
};

const listFromResponse = (json) => {
  if (Array.isArray(json)) return { total: json.length, items: json, raw: json };
  if (Array.isArray(json?.results)) return { total: intOf(json.count, json.results.length), items: json.results, raw: json };
  if (Array.isArray(json?.data)) return { total: intOf(json.count, json.data.length), items: json.data, raw: json };
  return { total: 0, items: [], raw: json };
};

const labelOf = (value) => {
  if (value && typeof value === 'object') return unwrap(firstDefined(value.label, value.name, value.value, value.display_name, value.displayName));
  return unwrap(value);
};

const mapAsset = (item = {}) => ({
  id: unwrap(item.id),
  name: unwrap(item.name),
  address: unwrap(firstDefined(item.address, item.ip, item.hostname)),
  platform: labelOf(firstDefined(item.platform, item.platforms)),
  category: labelOf(item.category),
  type: labelOf(item.type),
  comment: unwrap(firstDefined(item.comment, item.description)),
  raw_json: jsonString(item),
});

const mapUser = (item = {}) => ({
  id: unwrap(item.id),
  username: unwrap(item.username),
  name: unwrap(item.name),
  email: unwrap(item.email),
  role: Array.isArray(item.system_roles) ? item.system_roles.map((role) => labelOf(role)).filter(Boolean).join(',') : labelOf(item.role),
  is_active: Boolean(firstDefined(item.is_active, item.isActive, item.is_valid)),
  raw_json: jsonString(item),
});

const mapSession = (item = {}) => ({
  id: unwrap(item.id),
  user: labelOf(firstDefined(item.user, item.user_display, item.user_display_name, item.username)),
  asset: labelOf(firstDefined(item.asset, item.asset_display, item.asset_display_name, item.asset_name)),
  account: labelOf(firstDefined(item.account, item.account_display, item.account_name)),
  protocol: unwrap(firstDefined(item.protocol, item.type)),
  remote_addr: unwrap(firstDefined(item.remote_addr, item.remoteAddr, item.remote_address)),
  login_from: unwrap(firstDefined(item.login_from, item.loginFrom)),
  date_start: unwrap(firstDefined(item.date_start, item.dateStart, item.date_created)),
  raw_json: jsonString(item),
});

const apiUrl = (ctx, path) => new URL(`${baseUrlOf(ctx)}${apiPrefixOf(ctx)}${path}`);

const handleListAssets = async (req = {}, rawCtx = {}) => {
  const ctx = resolveCtx(rawCtx);
  const url = apiUrl(ctx, '/assets/assets');
  addPagingParams(url, req);
  const platform = unwrap(req.platform);
  if (platform) url.searchParams.set('platform', platform);
  const json = await fetchJson(ctx, url.toString(), { stage: 'list-assets' });
  const listed = listFromResponse(json);
  return { total: listed.total, items: listed.items.map(mapAsset), raw_json: jsonString(listed.raw) };
};

const handleGetAsset = async (req = {}, rawCtx = {}) => {
  const ctx = resolveCtx(rawCtx);
  const id = unwrap(req.id);
  if (!id) throw errorWithCode('INVALID_ARGUMENT', 'id is required');
  const json = await fetchJson(ctx, apiUrl(ctx, `/assets/assets/${encodeURIComponent(id)}/`).toString(), { stage: 'get-asset' });
  return { asset: mapAsset(json), raw_json: jsonString(json) };
};

const handleListUsers = async (req = {}, rawCtx = {}) => {
  const ctx = resolveCtx(rawCtx);
  const url = apiUrl(ctx, '/users/users');
  addPagingParams(url, req);
  const json = await fetchJson(ctx, url.toString(), { stage: 'list-users' });
  const listed = listFromResponse(json);
  return { total: listed.total, items: listed.items.map(mapUser), raw_json: jsonString(listed.raw) };
};

const handleListOnlineSessions = async (req = {}, rawCtx = {}) => {
  const ctx = resolveCtx(rawCtx);
  const url = apiUrl(ctx, '/terminal/sessions/');
  addPagingParams(url, req);
  url.searchParams.set('is_finished', 'false');
  const json = await fetchJson(ctx, url.toString(), { stage: 'list-online-sessions' });
  const listed = listFromResponse(json);
  return { total: listed.total, items: listed.items.map(mapSession), raw_json: jsonString(listed.raw) };
};

const normalizeCall = (first, second) => {
  if (second !== undefined) return { req: first ?? {}, ctx: second ?? {} };
  const ctx = first ?? {};
  return { req: ctx.req ?? ctx.request ?? {}, ctx };
};

export const handlers = {
  [METHOD_LIST_ASSETS_FULL]: (first, second) => {
    const { req, ctx } = normalizeCall(first, second);
    return handleListAssets(req, ctx);
  },
  [METHOD_GET_ASSET_FULL]: (first, second) => {
    const { req, ctx } = normalizeCall(first, second);
    return handleGetAsset(req, ctx);
  },
  [METHOD_LIST_USERS_FULL]: (first, second) => {
    const { req, ctx } = normalizeCall(first, second);
    return handleListUsers(req, ctx);
  },
  [METHOD_LIST_ONLINE_SESSIONS_FULL]: (first, second) => {
    const { req, ctx } = normalizeCall(first, second);
    return handleListOnlineSessions(req, ctx);
  },
};

export const rpcdef = (ctx = {}) => ({
  [METHOD_LIST_ASSETS_PATH]: (req = ctx.req ?? ctx.request ?? {}) => handleListAssets(req, ctx),
  [METHOD_GET_ASSET_PATH]: (req = ctx.req ?? ctx.request ?? {}) => handleGetAsset(req, ctx),
  [METHOD_LIST_USERS_PATH]: (req = ctx.req ?? ctx.request ?? {}) => handleListUsers(req, ctx),
  [METHOD_LIST_ONLINE_SESSIONS_PATH]: (req = ctx.req ?? ctx.request ?? {}) => handleListOnlineSessions(req, ctx),
});

export const _test = {
  apiUrl,
  listFromResponse,
  mapAsset,
  mapSession,
  mapUser,
};
