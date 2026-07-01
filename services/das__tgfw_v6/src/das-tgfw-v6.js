import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const SERVICE_NAME = 'DAS_TGFW_V6';
export const QUERY_BLACKLIST_PATH = '/DAS_TGFW_V6.DAS_TGFW_V6/query_blacklist';
export const ADD_BLACKLIST_PATH = '/DAS_TGFW_V6.DAS_TGFW_V6/add_blacklist';
export const DELETE_BLACKLIST_PATH = '/DAS_TGFW_V6.DAS_TGFW_V6/delete_blacklist';
export const METHOD_QUERY_BLACKLIST_FULL = 'DAS_TGFW_V6.DAS_TGFW_V6/query_blacklist';
export const METHOD_ADD_BLACKLIST_FULL = 'DAS_TGFW_V6.DAS_TGFW_V6/add_blacklist';
export const METHOD_DELETE_BLACKLIST_FULL = 'DAS_TGFW_V6.DAS_TGFW_V6/delete_blacklist';

export const DEFAULT_TIMEOUT_MS = 1500;
export const DEFAULT_PAGE = 1;
export const DEFAULT_SIZE = 10;
export const DEFAULT_LIFESPAN = 30 * 24 * 60 * 60;
let insecureDispatcherPromise;

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
  err.details = payload;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) {
    return unwrapScalar(value.value);
  }
  return value;
};

const unwrapString = (value) => {
  const unwrapped = unwrapScalar(value);
  if (unwrapped === undefined || unwrapped === null) return '';
  return String(unwrapped);
};

const normalizeBaseUrl = (value) => {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.replace(/\/+$/, '');
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

const requireHost = (ctx) => {
  const bindings = mergedBindings(ctx);
  const host = normalizeBaseUrl(firstDefined(bindings.host, bindings.restBaseUrl, bindings.rest_base_url, bindings.baseUrl, bindings.base_url, bindings.endpoint));
  if (!host) throw errorWithCode('INVALID_ARGUMENT', 'host/baseUrl is required in bindings');
  return host;
};

const requireApiToken = (ctx) => {
  const bindings = mergedBindings(ctx);
  const token = unwrapString(firstDefined(bindings.api_token, bindings.apiToken, bindings.token)).trim();
  if (!token) throw errorWithCode('INVALID_ARGUMENT', 'api_token is required in bindings');
  return token;
};

const toInteger = (value, fallback = 0) => {
  const num = Number(unwrapScalar(value));
  if (!Number.isFinite(num) || Number.isNaN(num)) return fallback;
  return Math.trunc(num);
};

const toBool = (value, fallback = false) => {
  const unwrapped = unwrapScalar(value);
  if (typeof unwrapped === 'boolean') return unwrapped;
  if (typeof unwrapped === 'number') return unwrapped !== 0;
  if (typeof unwrapped === 'string') {
    const normalized = unwrapped.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0' || normalized === '') return false;
  }
  return fallback;
};

const toValue = (val) => {
  if (val === undefined) return undefined;
  if (val === null) return { nullValue: 'NULL_VALUE' };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'number') return { numberValue: val };
  if (typeof val === 'boolean') return { boolValue: val };
  if (Array.isArray(val)) {
    const values = val.map((item) => toValue(item)).filter((item) => item !== undefined);
    return { listValue: { values } };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      const mapped = toValue(v);
      fields[k] = mapped === undefined ? { nullValue: 'NULL_VALUE' } : mapped;
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(val) };
};

const encodeQuery = (params = {}) => {
  const parts = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.join('&');
};

const appendQuery = (url, params = {}) => {
  const query = encodeQuery(params);
  if (!query) return url;
  return url.includes('?') ? `${url}&${query}` : `${url}?${query}`;
};

const isIPv4 = (value) => {
  const raw = String(value || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) return false;
    if (part.length > 1 && part.charAt(0) === '0') return false;
    const num = Number(part);
    return Number.isFinite(num) && num >= 0 && num <= 255;
  });
};

const isIPv6 = (value) => {
  const text = String(value || '').trim();
  if (text.indexOf(':') < 0) return false;
  if (text.includes(':::')) return false;
  if ((text.match(/::/g) || []).length > 1) return false;
  if (/::ffff:\d{1,3}(?:\.\d{1,3}){3}$/i.test(text)) {
    return isIPv4(text.substring(text.lastIndexOf(':') + 1));
  }
  if (!/^[0-9a-fA-F:.]+$/.test(text)) return false;
  return true;
};

const requireSAddr = (req) => {
  const ip = unwrapString(firstDefined(req?.s_addr, req?.sAddr, req?.ip)).trim();
  if (!ip) throw errorWithCode('INVALID_ARGUMENT', 's_addr is required');
  if (!isIPv4(ip) && !isIPv6(ip)) throw errorWithCode('INVALID_ARGUMENT', 's_addr must be a valid IPv4 or IPv6 address');
  return ip;
};

const requireIsIp6Consistent = (sAddr, isIp6) => {
  const is6 = Boolean(isIp6);
  if (isIPv4(sAddr) && is6) {
    throw errorWithCode('INVALID_ARGUMENT', 'ip version mismatch: s_addr is IPv4 but is_ip6=true (expected false)');
  }
  if (isIPv6(sAddr) && !is6) {
    throw errorWithCode('INVALID_ARGUMENT', 'ip version mismatch: s_addr is IPv6 but is_ip6=false (expected true)');
  }
};

const requireBlacklistId = (req) => {
  const id = toInteger(firstDefined(req?.id, req?.Id), 0);
  if (!id || id <= 0) throw errorWithCode('INVALID_ARGUMENT', 'id must be a positive integer');
  return id;
};

const parseJsonIfPossible = (text) => {
  const raw = String(text || '');
  if (!raw.trim()) return { ok: true, json: undefined };
  const trimmed = raw.trim();
  if (!/^[\[{]/.test(trimmed)) return { ok: true, json: undefined };
  try {
    return { ok: true, json: JSON.parse(trimmed) };
  } catch {
    return { ok: false, json: undefined };
  }
};

const classifyHttpStatusToCode = (status) => {
  if (status === 401 || status === 403) return 'PERMISSION_DENIED';
  if (status >= 400 && status < 500) return 'FAILED_PRECONDITION';
  if (status >= 500) return 'UNAVAILABLE';
  return 'FAILED_PRECONDITION';
};

const buildHeaders = (apiToken) => ({
  'Content-Type': 'application/json;charset=UTF-8',
  AuthorizationToken: apiToken,
});

const fetchText = async (ctx, url, init = {}) => {
  const timeoutMs = resolveTimeoutMs(ctx);
  const bindings = mergedBindings(ctx);
  try {
    const res = await fetchWithTimeout(url, init, { timeoutMs, bindings });
    const text = await res.text();
    return { res, status: res.status, text };
  } catch (err) {
    const reason = err?.cause?.message || err?.message || 'fetch failed';
    throw upstreamError('UNAVAILABLE', 'upstream request failed', { httpStatus: 0, rawBody: '', reason });
  }
};

const handleQueryBlacklist = async (req, ctx) => {
  const host = requireHost(ctx);
  const apiToken = requireApiToken(ctx);

  const sAddr = requireSAddr(req);
  const isIp6 = toBool(firstDefined(req?.is_ip6, req?.isIp6), false);
  requireIsIp6Consistent(sAddr, isIp6);

  const page = toInteger(firstDefined(req?.page, req?.Page), DEFAULT_PAGE) || DEFAULT_PAGE;
  const size = toInteger(firstDefined(req?.size, req?.Size), DEFAULT_SIZE) || DEFAULT_SIZE;
  const url = appendQuery(`${host}/api/v1/blacklist`, {
    page,
    size,
    is_ip6: isIp6 ? 'true' : 'false',
    s_addr: sAddr,
  });

  const { status, text } = await fetchText(ctx, url, {
    method: 'GET',
    headers: buildHeaders(apiToken),
  });

  if (status < 200 || status >= 300) {
    throw upstreamError(classifyHttpStatusToCode(status), `upstream http ${status}`, {
      httpStatus: status,
      rawBody: text,
      reason: 'non-2xx',
    });
  }

  const parsed = parseJsonIfPossible(text);
  let msg = '';
  let vals = [];
  let rawJson;

  if (parsed.ok && parsed.json !== undefined) {
    msg = typeof parsed.json?.msg === 'string' ? parsed.json.msg : '';
    if (Array.isArray(parsed.json?.vals)) {
      vals = parsed.json.vals.map((item) => ({
        id: toInteger(item?.id, 0),
        s_addr: unwrapString(item?.s_addr).trim(),
        enable: Boolean(item?.enable),
        lifespan: toInteger(item?.lifespan, 0),
        raw: toValue(item),
      }));
    }
  }

  return {
    http_status: status,
    raw_body: '',
    raw_json: undefined,
    vals,
    msg,
  };
};

const buildAddBlacklistPayload = (req) => {
  const sAddr = requireSAddr(req);
  const isIp6 = toBool(firstDefined(req?.is_ip6, req?.isIp6), false);
  requireIsIp6Consistent(sAddr, isIp6);

  const lifespanRaw = toInteger(firstDefined(req?.lifespan, req?.LifeSpan), 0);
  const lifespan = lifespanRaw > 0 ? lifespanRaw : DEFAULT_LIFESPAN;
  const enable = toBool(firstDefined(req?.enable, req?.Enable), true);

  return {
    sAddr,
    isIp6,
    payload: {
      id: 1,
      val: {
        enable,
        lifespan,
        is_ip6: isIp6,
        s_addr: sAddr,
        d_addr: null,
        is_choose_service: false,
      },
    },
  };
};

const parseBusinessResponse = (status, text, expectedSuccessMsg = 'success') => {
  const rawBody = String(text ?? '');
  if (!rawBody.trim()) {
    return { http_status: status, raw_body: '', raw_json: undefined, msg: '' };
  }

  const parsed = parseJsonIfPossible(rawBody);
  if (!parsed.ok || parsed.json === undefined) {
    throw upstreamError('UNKNOWN', 'response is not valid JSON', {
      httpStatus: status,
      rawBody,
      reason: 'invalid-json',
    });
  }

  const msg = typeof parsed.json?.msg === 'string' ? parsed.json.msg : '';
  if (msg !== expectedSuccessMsg) {
    throw upstreamError('FAILED_PRECONDITION', 'upstream business failure', {
      httpStatus: status,
      rawBody,
      reason: `msg != success (${msg || 'empty'})`,
    });
  }

  return {
    http_status: status,
    raw_body: '',
    raw_json: undefined,
    msg,
  };
};

const handleAddBlacklist = async (req, ctx) => {
  const host = requireHost(ctx);
  const apiToken = requireApiToken(ctx);
  const { payload } = buildAddBlacklistPayload(req);
  const url = `${host}/api/v1/blacklist`;

  const { status, text } = await fetchText(ctx, url, {
    method: 'POST',
    headers: buildHeaders(apiToken),
    body: JSON.stringify(payload),
  });

  if (status < 200 || status >= 300) {
    throw upstreamError(classifyHttpStatusToCode(status), `upstream http ${status}`, {
      httpStatus: status,
      rawBody: text,
      reason: 'non-2xx',
    });
  }

  return parseBusinessResponse(status, text);
};

const handleDeleteBlacklist = async (req, ctx) => {
  const host = requireHost(ctx);
  const apiToken = requireApiToken(ctx);
  const id = requireBlacklistId(req);
  const isIp6 = toBool(firstDefined(req?.is_ip6, req?.isIp6), false);
  const url = appendQuery(`${host}/api/v1/blacklist`, {
    id,
    is_ip6: isIp6 ? 'true' : 'false',
  });

  const { status, text } = await fetchText(ctx, url, {
    method: 'DELETE',
    headers: buildHeaders(apiToken),
  });

  if (status < 200 || status >= 300) {
    throw upstreamError(classifyHttpStatusToCode(status), `upstream http ${status}`, {
      httpStatus: status,
      rawBody: text,
      reason: 'non-2xx',
    });
  }

  return parseBusinessResponse(status, text);
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [QUERY_BLACKLIST_PATH]: async (req = callCtx.req) => handleQueryBlacklist(req ?? {}, callCtx),
    [ADD_BLACKLIST_PATH]: async (req = callCtx.req) => handleAddBlacklist(req ?? {}, callCtx),
    [DELETE_BLACKLIST_PATH]: async (req = callCtx.req) => handleDeleteBlacklist(req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_QUERY_BLACKLIST_FULL]: (ctx) => rpcdef(ctx)[QUERY_BLACKLIST_PATH](ctx?.req ?? ctx?.request ?? {}),
  [METHOD_ADD_BLACKLIST_FULL]: (ctx) => rpcdef(ctx)[ADD_BLACKLIST_PATH](ctx?.req ?? ctx?.request ?? {}),
  [METHOD_DELETE_BLACKLIST_FULL]: (ctx) => rpcdef(ctx)[DELETE_BLACKLIST_PATH](ctx?.req ?? ctx?.request ?? {}),
};

export const _test = {
  appendQuery,
  buildAddBlacklistPayload,
  buildHeaders,
  buildTlsOptions,
  classifyHttpStatusToCode,
  createTlsDispatcher,
  encodeQuery,
  errorWithCode,
  fetchWithTimeout,
  fetchText,
  firstDefined,
  handleAddBlacklist,
  handleDeleteBlacklist,
  handleQueryBlacklist,
  isIPv4,
  isIPv6,
  mergedBindings,
  normalizeBaseUrl,
  parseBusinessResponse,
  parseJsonIfPossible,
  requireApiToken,
  requireBlacklistId,
  requireHost,
  requireIsIp6Consistent,
  requireSAddr,
  resolveCallContext,
  resolveTimeoutMs,
  shouldSkipTlsVerify,
  toBool,
  toInteger,
  toValue,
  unwrapScalar,
  unwrapString,
  upstreamError,
};
