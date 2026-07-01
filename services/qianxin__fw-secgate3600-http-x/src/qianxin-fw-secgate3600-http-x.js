import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const LOGIN_PATH = '/QIANXIN_FW_SecGate3600_HTTP_X.QIANXIN_FW_SecGate3600_HTTP_X/Login';
export const BLOCK_PATH = '/QIANXIN_FW_SecGate3600_HTTP_X.QIANXIN_FW_SecGate3600_HTTP_X/BlockIP';
export const UNBLOCK_PATH = '/QIANXIN_FW_SecGate3600_HTTP_X.QIANXIN_FW_SecGate3600_HTTP_X/UnblockIP';

export const METHOD_LOGIN_FULL = 'QIANXIN_FW_SecGate3600_HTTP_X.QIANXIN_FW_SecGate3600_HTTP_X/Login';
export const METHOD_BLOCK_FULL = 'QIANXIN_FW_SecGate3600_HTTP_X.QIANXIN_FW_SecGate3600_HTTP_X/BlockIP';
export const METHOD_UNBLOCK_FULL = 'QIANXIN_FW_SecGate3600_HTTP_X.QIANXIN_FW_SecGate3600_HTTP_X/UnblockIP';

export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_MASK = '255.255.255.0';
export const LOGIN_URI = '/webui/login/auth';
export const BLACKLIST_URI = '/webui/blacklist/set';

const SESSION_CACHE = new Map();

const grpcCodeFor = (code) => ({
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

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const normalizeString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

const optionalString = (value) => {
  const normalized = normalizeString(value);
  return normalized ? normalized : undefined;
};

const requireString = (value, fieldName) => {
  const normalized = normalizeString(value);
  if (!normalized) throw errorWithCode('INVALID_ARGUMENT', `${fieldName} is required`);
  return normalized;
};

const optionalUint32 = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num) || Number.isNaN(num) || num <= 0) return undefined;
  return Math.trunc(num);
};

const getField = (source, candidates) => {
  for (const key of candidates) {
    if (hasOwn(source, key)) return source[key];
  }
  return undefined;
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

const normalizeBaseUrl = (value) => {
  const text = optionalString(value);
  if (!text) return '';
  if (!/^https?:\/\//i.test(text)) return '';
  return text.replace(/\/+$/, '');
};

const resolveHost = (ctx = {}) => {
  const req = ctx.req || {};
  const bindings = ctx.bindings || {};
  const candidates = [
    req.host,
    req.baseUrl,
    req.base_url,
    bindings.host,
    bindings.restBaseUrl,
    bindings.baseUrl,
    bindings.rest_base_url,
    bindings.base_url,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized) return normalized;
  }
  throw errorWithCode('INVALID_ARGUMENT', 'host/baseUrl is required and must include http/https');
};

const resolveTimeoutMs = (ctx = {}) => {
  const req = ctx.req || {};
  const bindings = ctx.bindings || {};
  const limits = ctx.limits || {};
  const candidates = [
    optionalUint32(req.timeoutMs),
    optionalUint32(req.timeout_ms),
    optionalUint32(bindings.timeoutMs),
    optionalUint32(bindings.timeout_ms),
    optionalUint32(limits.timeoutMs),
    DEFAULT_TIMEOUT_MS,
  ];
  for (const candidate of candidates) {
    if (Number.isFinite(candidate) && candidate > 0) return Math.trunc(candidate);
  }
  /* node:coverage ignore next */
  return DEFAULT_TIMEOUT_MS;
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

const buildHeaders = (ctx = {}, extra = {}) => {
  const bindings = ctx.bindings || {};
  const meta = ctx.meta || {};
  return {
    ...(bindings.headers || {}),
    'x-engine-instance': meta.instance_id || meta.instanceId || 'unknown',
    'x-request-id': meta.request_id || meta.requestId || 'unknown',
    ...extra,
  };
};

const buildTlsOptions = (ctx = {}) => {
  const bindings = ctx.bindings || {};
  if (toBoolean(bindings.skipTlsVerify) || toBoolean(bindings.tlsInsecureSkipVerify) || toBoolean(bindings.insecureSkipVerify)) {
    return { dispatcher: getInsecureTlsDispatcher() };
  }
  return {};
};

const buildUrl = (host, path, query = {}) => {
  const base = host.replace(/\/+$/, '');
  const normalizedPath = String(path || '').replace(/^\/+/, '');
  const prefix = `${base}/${normalizedPath}`;
  const pairs = [];
  for (const [key, raw] of Object.entries(query)) {
    if (raw === undefined || raw === null || raw === '') continue;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return pairs.length ? `${prefix}?${pairs.join('&')}` : prefix;
};

const pickCredential = (ctx, fieldNames, fieldLabel) => {
  const secret = ctx?.secret || {};
  const config = ctx?.config || {};
  const bindings = ctx?.bindings || {};
  for (const field of fieldNames) {
    const text = normalizeString(secret[field] ?? config[field] ?? bindings[field]);
    if (text) return text;
  }
  throw errorWithCode('INVALID_ARGUMENT', `${fieldLabel} is required`);
};

const buildLoginQuery = (req = {}, ctx = {}) => {
  const user = pickCredential(ctx, ['user', 'username'], 'user');
  const password = pickCredential(ctx, ['password'], 'password');
  const query = { user, password };
  const language = optionalString(getField(req, ['txtLanguage', 'txt_language']));
  if (language) query.txt_language = language;
  const loginType = optionalString(getField(req, ['loginType', 'login_type']));
  if (loginType) query.login_type = loginType;
  const client = optionalString(req.client);
  if (client) query.client = client;
  return query;
};

const getSessionKey = (ctx, host) => {
  const user = pickCredential(ctx, ['user', 'username'], 'user');
  const instance = ctx?.meta?.instance_id || ctx?.meta?.instanceId || 'default';
  const service = ctx?.serviceId || ctx?.service_id || 'qianxin-fw-secgate3600-http-x';
  return `${service}:${instance}:${host}:${user}`;
};

const getSession = (ctx, host) => SESSION_CACHE.get(getSessionKey(ctx, host));

const setSession = (ctx, host, session) => SESSION_CACHE.set(getSessionKey(ctx, host), session);

const clearAllSessions = () => SESSION_CACHE.clear();

const extractLoginSession = (rawBody) => {
  const json = parseJsonObject(rawBody);
  const uuid = optionalString(json.uuid ?? json.UUID ?? json.data?.uuid ?? json.data?.UUID);
  return uuid ? { uuid } : null;
};

const requireSession = (ctx, host) => {
  const session = getSession(ctx, host);
  if (!session?.uuid) throw errorWithCode('INVALID_ARGUMENT', 'call Login first');
  return session;
};

const buildBlacklistQuery = (ctx = {}) => ({ uuid: requireSession(ctx, resolveHost(ctx)).uuid });

const buildBlacklistBody = (req = {}, undoFlag) => {
  const ip = requireString(req.ip, 'ip');
  const mask = optionalString(req.mask) || DEFAULT_MASK;
  const body = { ip, mask };
  const description = optionalString(getField(req, ['description', 'desc']));
  if (description) body.desc = description;
  if (undoFlag) body.undo = '1';
  return body;
};

const toStruct = (obj) => {
  const fields = {};
  for (const [key, value] of Object.entries(obj || {})) fields[key] = toValue(value);
  return { fields };
};

const toValue = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return { nullValue: 'NULL_VALUE' };
  if (typeof raw === 'string') return { stringValue: raw };
  if (typeof raw === 'number') return { numberValue: raw };
  if (typeof raw === 'boolean') return { boolValue: raw };
  if (Array.isArray(raw)) return { listValue: { values: raw.map((item) => toValue(item)) } };
  if (typeof raw === 'object') return { structValue: toStruct(raw) };
  return { stringValue: String(raw) };
};

const parseJsonObject = (text) => {
  if (!String(text || '').trim()) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const extractHeaders = (res) => {
  const map = new Map();
  const headers = res?.headers;
  if (headers && typeof headers.forEach === 'function') {
    headers.forEach((value, key) => {
      const k = String(key || '');
      if (!k) return;
      const existing = map.get(k) || [];
      if (Array.isArray(value)) existing.push(...value.map(String));
      else existing.push(String(value ?? ''));
      map.set(k, existing);
    });
  } else if (headers && typeof headers.entries === 'function') {
    for (const [key, value] of headers.entries()) map.set(String(key), [String(value ?? '')]);
  }
  return Array.from(map.entries()).map(([key, values]) => ({ key, values }));
};

const sanitizeHeaders = (headers = []) => headers.filter((header) => {
  const key = String(header?.key || '').toLowerCase();
  return key !== 'set-cookie' && key !== 'cookie' && key !== 'authorization';
});

const sanitizeEffectiveUrl = (url) => {
  try {
    const parsed = new URL(String(url));
    for (const key of ['user', 'username', 'password', 'token', 'authorization']) {
      if (parsed.searchParams.has(key)) parsed.searchParams.set(key, 'REDACTED');
    }
    return parsed.toString();
  } catch {
    return '';
  }
};

const normalizeResponse = (status, headers, rawBody, effectiveUrl, options = {}) => ({
  status_code: Number(status) || 0,
  statusCode: Number(status) || 0,
  headers: sanitizeHeaders(headers),
  raw_body: options.omitRawBody ? '' : String(rawBody ?? ''),
  rawBody: options.omitRawBody ? '' : String(rawBody ?? ''),
  body_json: options.omitParsedBody ? { fields: {} } : toStruct(parseJsonObject(rawBody)),
  bodyJson: options.omitParsedBody ? {} : parseJsonObject(rawBody),
  effective_url: options.omitEffectiveUrl ? '' : (options.sanitizeUrl ? sanitizeEffectiveUrl(effectiveUrl) : effectiveUrl),
  effectiveUrl: options.omitEffectiveUrl ? '' : (options.sanitizeUrl ? sanitizeEffectiveUrl(effectiveUrl) : effectiveUrl),
});

const fetchHttp = async (ctx, url, init = {}, options = {}) => {
  let res;
  try {
    res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(resolveTimeoutMs(ctx)),
      ...buildTlsOptions(ctx),
    });
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', err?.cause?.message || err?.message || 'fetch failed');
  }
  const text = await res.text();
  if (typeof options.onResponse === 'function') options.onResponse({ status: res.status, headers: res.headers, text, url });
  return normalizeResponse(res.status, extractHeaders(res), text, url, options);
};

const handleLogin = (req, ctx) => {
  const callCtx = resolveCallContext({ ...ctx, req, request: req });
  const host = resolveHost(callCtx);
  const query = buildLoginQuery(callCtx.req || {}, callCtx);
  return fetchHttp(callCtx, buildUrl(host, LOGIN_URI, query), {
    method: 'GET',
    headers: buildHeaders(callCtx),
  }, {
    omitRawBody: true,
    omitParsedBody: true,
    omitEffectiveUrl: true,
    sanitizeUrl: true,
    onResponse: ({ text }) => {
      const session = extractLoginSession(text);
      if (session) setSession(callCtx, host, session);
    },
  });
};

const handleBlock = (req, ctx) => {
  const callCtx = resolveCallContext({ ...ctx, req, request: req });
  const host = resolveHost(callCtx);
  return fetchHttp(callCtx, buildUrl(host, BLACKLIST_URI, buildBlacklistQuery(callCtx)), {
    method: 'POST',
    headers: buildHeaders(callCtx, { 'content-type': 'application/json' }),
    body: JSON.stringify(buildBlacklistBody(callCtx.req || {}, false)),
  }, { omitRawBody: true, omitParsedBody: true, omitEffectiveUrl: true });
};

const handleUnblock = (req, ctx) => {
  const callCtx = resolveCallContext({ ...ctx, req, request: req });
  const host = resolveHost(callCtx);
  return fetchHttp(callCtx, buildUrl(host, BLACKLIST_URI, buildBlacklistQuery(callCtx)), {
    method: 'POST',
    headers: buildHeaders(callCtx, { 'content-type': 'application/json' }),
    body: JSON.stringify(buildBlacklistBody(callCtx.req || {}, true)),
  }, { omitRawBody: true, omitParsedBody: true, omitEffectiveUrl: true });
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [LOGIN_PATH]: async (req) => handleLogin(req ?? callCtx.req ?? {}, callCtx),
    [BLOCK_PATH]: async (req) => handleBlock(req ?? callCtx.req ?? {}, callCtx),
    [UNBLOCK_PATH]: async (req) => handleUnblock(req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_LOGIN_FULL]: (ctx = {}) => handleLogin(requestFromContext(ctx), ctx),
  [METHOD_BLOCK_FULL]: (ctx = {}) => handleBlock(requestFromContext(ctx), ctx),
  [METHOD_UNBLOCK_FULL]: (ctx = {}) => handleUnblock(requestFromContext(ctx), ctx),
};

export const _test = {
  buildBlacklistBody,
  buildBlacklistQuery,
  buildHeaders,
  buildLoginQuery,
  buildTlsOptions,
  buildUrl,
  clearAllSessions,
  errorWithCode,
  extractLoginSession,
  extractHeaders,
  fetchHttp,
  getField,
  getSession,
  normalizeBaseUrl,
  normalizeResponse,
  normalizeString,
  optionalString,
  optionalUint32,
  parseJsonObject,
  requireString,
  requireSession,
  resolveCallContext,
  resolveHost,
  resolveTimeoutMs,
  setSession,
  toBoolean,
  toStruct,
  toValue,
};
