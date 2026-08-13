import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const LOGIN_PATH = '/DPtech_UMC_ADS_v5329.DPtech_UMC_ADS_v5329/Login';
export const QUERY_BLACKLIST_PATH = '/DPtech_UMC_ADS_v5329.DPtech_UMC_ADS_v5329/QueryBlacklist';
export const ADD_BLACKLIST_PATH = '/DPtech_UMC_ADS_v5329.DPtech_UMC_ADS_v5329/AddBlacklist';
export const DELETE_BLACKLIST_PATH = '/DPtech_UMC_ADS_v5329.DPtech_UMC_ADS_v5329/DeleteBlacklist';

export const METHOD_LOGIN_FULL = 'DPtech_UMC_ADS_v5329.DPtech_UMC_ADS_v5329/Login';
export const METHOD_QUERY_BLACKLIST_FULL = 'DPtech_UMC_ADS_v5329.DPtech_UMC_ADS_v5329/QueryBlacklist';
export const METHOD_ADD_BLACKLIST_FULL = 'DPtech_UMC_ADS_v5329.DPtech_UMC_ADS_v5329/AddBlacklist';
export const METHOD_DELETE_BLACKLIST_FULL = 'DPtech_UMC_ADS_v5329.DPtech_UMC_ADS_v5329/DeleteBlacklist';

export const LOGIN_URI = '/UMC/restful/token/getRestfulInterfaceToken';
export const QUERY_URI = '/UMC/restful/api/getBlackAndWhiteListStrategy';
export const MUTATION_URI = '/UMC/restful/api/blackAndWhiteListStrategyConfig';

export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_PAGE = 1;
export const DEFAULT_SIZE = 50;
export const MAX_IPS_PER_MUTATION = 100;
export const ADD_OPERATION_TYPE = 1;
export const DELETE_OPERATION_TYPE = 3;

const sessionCache = new Map();
let insecureDispatcherPromise;

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), message);
  err.legacyCode = code;
  return err;
};

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const unwrapString = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) {
    return unwrapString(value.value);
  }
  return String(value);
};

const pickString = (source, keys) => {
  for (const key of keys) {
    const text = unwrapString(source?.[key]).trim();
    if (text) return text;
  }
  return '';
};

const normalizeBaseUrl = (value) => {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.replace(/\/+$/, '');
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
  req: ctx.req ?? ctx.request ?? {},
});

const resolveHost = (ctx) => {
  const bindings = mergedBindings(ctx);
  for (const key of ['host', 'baseUrl', 'base_url', 'restBaseUrl', 'rest_base_url', 'endpoint']) {
    const host = normalizeBaseUrl(bindings?.[key]);
    if (host) return host;
  }
  throw errorWithCode('INVALID_ARGUMENT', 'host is required in bindings');
};

const resolveUsername = (ctx) => {
  const value = pickString(mergedBindings(ctx), ['user', 'username']);
  if (!value) throw errorWithCode('INVALID_ARGUMENT', 'user/username is required in bindings');
  return value;
};

const resolvePassword = (ctx) => {
  const value = pickString(mergedBindings(ctx), ['password', 'pass', 'secret']);
  if (!value) throw errorWithCode('INVALID_ARGUMENT', 'password is required in bindings');
  return value;
};

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

const getInstanceId = (ctx) => String(ctx?.meta?.instance_id || ctx?.meta?.instanceId || 'default-instance');
const buildSessionKey = (ctx, host) => `${getInstanceId(ctx)}::${host}`;
const setSession = (ctx, host, session) => sessionCache.set(buildSessionKey(ctx, host), session);
const getSession = (ctx, host) => sessionCache.get(buildSessionKey(ctx, host));
const clearSession = (ctx, host) => sessionCache.delete(buildSessionKey(ctx, host));
const clearSessionCache = () => sessionCache.clear();

const requireSession = (ctx, host) => {
  const session = getSession(ctx, host);
  if (!session?.token) {
    throw errorWithCode('FAILED_PRECONDITION', 'call Login first');
  }
  return session;
};

const resolveUpstreamToken = (_req, ctx, host) => {
  const session = requireSession(ctx, host);
  return { token: session.token, fromCache: true };
};

const normalizePositiveInt = (value, fallback) => {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.trunc(raw);
};

const toInteger = (value, fallback = 0) => {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.trunc(raw);
};

const toValue = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return { nullValue: 'NULL_VALUE' };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return Number.isFinite(value) ? { numberValue: value } : { stringValue: String(value) };
  if (typeof value === 'boolean') return { boolValue: value };
  if (Array.isArray(value)) {
    return {
      listValue: {
        values: value.map((item) => toValue(item)).filter((item) => item !== undefined),
      },
    };
  }
  if (typeof value === 'object') {
    const fields = {};
    for (const [key, item] of Object.entries(value)) {
      const mapped = toValue(item);
      if (mapped !== undefined) fields[key] = mapped;
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(value) };
};

const parseJsonMaybe = (text) => {
  const raw = String(text ?? '');
  if (!raw.trim()) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

const buildBaseHeaders = (ctx, extraHeaders = {}) => ({
  ...((mergedBindings(ctx)?.headers && typeof mergedBindings(ctx).headers === 'object') ? mergedBindings(ctx).headers : {}),
  'Content-Type': 'application/json',
  ...extraHeaders,
});

const fetchText = async (ctx, url, init = {}) => {
  const timeoutMs = resolveTimeoutMs(ctx);
  const bindings = mergedBindings(ctx);
  let res;
  try {
    res = await fetchWithTimeout(url, {
      ...init,
      headers: {
        ...(init.headers || {}),
      },
    }, { timeoutMs, bindings });
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', err?.cause?.message || err?.message || 'fetch failed');
  }

  const text = String((await res.text()) ?? '');
  return {
    status: toInteger(res.status, 0),
    text,
    json: parseJsonMaybe(text),
  };
};

const toResponse = (upstream) => {
  const response = {
    http_status: toInteger(upstream?.status, 0),
    raw_body: '',
  };
  if (upstream?.json !== undefined) {
    response.raw_json = undefined;
  }
  return response;
};

const isValidIPv4 = (value) => {
  const raw = String(value || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
};

const isHexSegment = (segment) => /^[0-9a-fA-F]{1,4}$/.test(segment);

const splitIpv6Part = (part) => {
  if (!part) return [];
  const segments = part.split(':');
  if (segments.some((segment) => !segment)) return null;
  return segments;
};

const isValidIPv6 = (value) => {
  let raw = String(value || '').trim();
  if (!raw) return false;
  const zoneIndex = raw.indexOf('%');
  if (zoneIndex >= 0) raw = raw.slice(0, zoneIndex);
  if (!raw || raw.includes(':::')) return false;
  const parts = raw.split('::');
  if (parts.length > 2) return false;
  if (parts.length === 1) {
    const segments = splitIpv6Part(parts[0]);
    return Boolean(segments) && segments.length === 8 && segments.every(isHexSegment);
  }
  const left = splitIpv6Part(parts[0]);
  const right = splitIpv6Part(parts[1]);
  if (!left || !right) return false;
  if (left.length + right.length >= 8) return false;
  return [...left, ...right].every(isHexSegment);
};

const requireIp = (value, field = 'ip') => {
  const ip = unwrapString(value).trim();
  if (!ip) throw errorWithCode('INVALID_ARGUMENT', `${field} is required`);
  if (!isValidIPv4(ip) && !isValidIPv6(ip)) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} must be a valid IPv4 or IPv6 address`);
  }
  return ip;
};

const normalizeIpList = (value) => {
  const source = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray(value.values)
      ? value.values
      : null;
  if (!source || source.length === 0) {
    throw errorWithCode('INVALID_ARGUMENT', 'ips must be a non-empty array');
  }
  if (source.length > MAX_IPS_PER_MUTATION) {
    throw errorWithCode('INVALID_ARGUMENT', `ips must contain at most ${MAX_IPS_PER_MUTATION} entries`);
  }
  return source.map((item, index) => requireIp(item, `ips[${index}]`));
};

const buildProtectionName = (ip) => (isValidIPv4(ip) ? 'IPv4-All users' : 'IPv6-All users');

const buildStrategyName = (ip) => {
  const suffix = String(ip)
    .trim()
    .replace(/[^0-9A-Za-z]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `ip_name_${suffix}`;
};

const buildAddConfigItem = (ip) => ({
  strategyName: buildStrategyName(ip),
  strategyScope: 2,
  cleaningDeviceScope: 1,
  ipSegments: [ip],
  survivalTime: '永久',
  action: 2,
  isExpired: 0,
  protectionName: buildProtectionName(ip),
});

const buildDeleteConfigItem = (ip) => ({
  strategyName: buildStrategyName(ip),
  ipSegments: [ip],
});

const runLogin = async (ctx) => {
  const callCtx = resolveCallContext(ctx);
  const host = resolveHost(callCtx);
  clearSession(callCtx, host);
  const upstream = await fetchText(callCtx, `${host}${LOGIN_URI}`, {
    method: 'POST',
    headers: buildBaseHeaders(callCtx),
    body: JSON.stringify({
      userName: resolveUsername(callCtx),
      secretKey: resolvePassword(callCtx),
    }),
  });

  const token = unwrapString(upstream?.json?.token).trim();
  if (toInteger(upstream?.json?.code, -1) === 0 && token) {
    setSession(callCtx, host, {
      token,
      expireTime: unwrapString(upstream?.json?.expireTime).trim(),
    });
  }

  return {
    http_status: toInteger(upstream?.status, 0),
    raw_body: '',
  };
};

const runQuery = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const host = resolveHost(callCtx);
  const tokenState = resolveUpstreamToken(req, callCtx, host);
  const strategyName = unwrapString(firstDefined(req?.strategy_name, req?.strategyName)).trim();
  const rawIp = firstDefined(req?.ip, req?.ip_address, req?.ipAddress);
  const ip = rawIp === undefined || rawIp === null || unwrapString(rawIp).trim() === '' ? '' : requireIp(rawIp);
  const body = {
    page: normalizePositiveInt(firstDefined(req?.page, req?.page_no, req?.pageNo), DEFAULT_PAGE),
    size: normalizePositiveInt(firstDefined(req?.size, req?.page_size, req?.pageSize), DEFAULT_SIZE),
  };
  if (strategyName) body.strategyName = strategyName;
  if (ip) body.ip = ip;

  const upstream = await fetchText(callCtx, `${host}${QUERY_URI}`, {
    method: 'POST',
    headers: buildBaseHeaders(callCtx, { token: tokenState.token }),
    body: JSON.stringify(body),
  });
  if (tokenState.fromCache && (upstream.status === 401 || upstream.status === 403)) clearSession(callCtx, host);
  return toResponse(upstream);
};

const runMutation = async (req, ctx, operationType) => {
  const callCtx = resolveCallContext(ctx);
  const host = resolveHost(callCtx);
  const tokenState = resolveUpstreamToken(req, callCtx, host);
  const ips = normalizeIpList(firstDefined(req?.ips, req?.ip_list, req?.ipList));
  const configParam = ips.map((ip) => (operationType === ADD_OPERATION_TYPE ? buildAddConfigItem(ip) : buildDeleteConfigItem(ip)));

  const upstream = await fetchText(callCtx, `${host}${MUTATION_URI}`, {
    method: 'POST',
    headers: buildBaseHeaders(callCtx, { token: tokenState.token }),
    body: JSON.stringify({ operationType, configParam }),
  });
  if (tokenState.fromCache && (upstream.status === 401 || upstream.status === 403)) clearSession(callCtx, host);
  return toResponse(upstream);
};

const registerHandlers = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  return {
    [LOGIN_PATH]: () => runLogin(callCtx),
    [QUERY_BLACKLIST_PATH]: (req = callCtx.req) => runQuery(req ?? {}, callCtx),
    [ADD_BLACKLIST_PATH]: (req = callCtx.req) => runMutation(req ?? {}, callCtx, ADD_OPERATION_TYPE),
    [DELETE_BLACKLIST_PATH]: (req = callCtx.req) => runMutation(req ?? {}, callCtx, DELETE_OPERATION_TYPE),
  };
};

export function rpcdef(ctx = {}) {
  return registerHandlers(ctx);
}

const callSdkHandler = (ctx, path) => registerHandlers(ctx)[path](ctx?.req ?? ctx?.request ?? {});

export const handlers = {
  [METHOD_LOGIN_FULL]: (ctx) => callSdkHandler(ctx, LOGIN_PATH),
  [METHOD_QUERY_BLACKLIST_FULL]: (ctx) => callSdkHandler(ctx, QUERY_BLACKLIST_PATH),
  [METHOD_ADD_BLACKLIST_FULL]: (ctx) => callSdkHandler(ctx, ADD_BLACKLIST_PATH),
  [METHOD_DELETE_BLACKLIST_FULL]: (ctx) => callSdkHandler(ctx, DELETE_BLACKLIST_PATH),
};

rpcdef.__test__ = {
  buildAddConfigItem,
  buildBaseHeaders,
  buildDeleteConfigItem,
  buildProtectionName,
  buildSessionKey,
  buildStrategyName,
  buildTlsOptions,
  clearSession,
  clearSessionCache,
  createTlsDispatcher,
  errorWithCode,
  fetchWithTimeout,
  fetchText,
  firstDefined,
  getInstanceId,
  getSession,
  hasOwn,
  isHexSegment,
  isValidIPv4,
  isValidIPv6,
  mergedBindings,
  normalizeBaseUrl,
  normalizeIpList,
  normalizePositiveInt,
  parseJsonMaybe,
  pickString,
  registerHandlers,
  requireIp,
  resolveCallContext,
  resolveHost,
  resolvePassword,
  resolveTimeoutMs,
  resolveUpstreamToken,
  resolveUsername,
  runLogin,
  runMutation,
  runQuery,
  setSession,
  shouldSkipTlsVerify,
  splitIpv6Part,
  toInteger,
  toResponse,
  toValue,
  unwrapString,
};

export const _test = rpcdef.__test__;
