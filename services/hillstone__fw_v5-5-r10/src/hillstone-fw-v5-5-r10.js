import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const LOGIN_PATH = '/HILLSTONE_FW_V55R10.HILLSTONE_FW_V55R10/Login';
export const ADD_ADDRESS_GROUP_PATH = '/HILLSTONE_FW_V55R10.HILLSTONE_FW_V55R10/AddAddressGroup';
export const OVERWRITE_ADDRESS_GROUP_PATH = '/HILLSTONE_FW_V55R10.HILLSTONE_FW_V55R10/OverwriteAddressGroup';
export const QUERY_ADDRESS_GROUP_PATH = '/HILLSTONE_FW_V55R10.HILLSTONE_FW_V55R10/QueryAddressGroup';

export const METHOD_LOGIN_FULL = 'HILLSTONE_FW_V55R10.HILLSTONE_FW_V55R10/Login';
export const METHOD_ADD_ADDRESS_GROUP_FULL = 'HILLSTONE_FW_V55R10.HILLSTONE_FW_V55R10/AddAddressGroup';
export const METHOD_OVERWRITE_ADDRESS_GROUP_FULL = 'HILLSTONE_FW_V55R10.HILLSTONE_FW_V55R10/OverwriteAddressGroup';
export const METHOD_QUERY_ADDRESS_GROUP_FULL = 'HILLSTONE_FW_V55R10.HILLSTONE_FW_V55R10/QueryAddressGroup';

export const CONTENT_TYPE = 'text/plain;charset=UTF-8';
export const ACCEPT = 'text/plain;charset=UTF-8, application/json;q=0.9, */*;q=0.8';
export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_LIMIT = 50;
export const DEFAULT_PAGE = 1;
export const DEFAULT_START = 0;
export const DEFAULT_LANG = 'zh_CN';

const SESSION_CACHE = new Map();
let insecureDispatcherPromise;

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const firstDefined = (...vals) => vals.find((val) => val !== undefined && val !== null);

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

const requireString = (value, fieldName) => {
  const text = toTrimmedString(value);
  if (!text) throw errorWithCode('INVALID_ARGUMENT', `${fieldName} is required`);
  return text;
};

const readNonNegativeInt = (value, fieldName, fallback) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return fallback;
  const num = Number(raw);
  if (!Number.isInteger(num) || Number.isNaN(num)) throw errorWithCode('INVALID_ARGUMENT', `${fieldName} must be a valid integer`);
  if (num < 0) throw errorWithCode('INVALID_ARGUMENT', `${fieldName} must be non-negative`);
  return num;
};

const parseAuthority = (authority) => {
  if (!authority) return null;
  if (authority.startsWith('[')) {
    const closeIndex = authority.indexOf(']');
    if (closeIndex <= 0) return null;
    const hostPart = authority.slice(0, closeIndex + 1);
    const rest = authority.slice(closeIndex + 1);
    if (!rest.startsWith(':')) return null;
    const portPart = rest.slice(1);
    if (!/^\d+$/.test(portPart)) return null;
    return { hostPart, portPart };
  }
  const colonIndex = authority.lastIndexOf(':');
  if (colonIndex <= 0) return null;
  const hostPart = authority.slice(0, colonIndex);
  const portPart = authority.slice(colonIndex + 1);
  if (!hostPart || !/^\d+$/.test(portPart)) return null;
  return { hostPart, portPart };
};

const requireHost = (value) => {
  const raw = requireString(value, 'host');
  const normalized = raw.replace(/\/+$/, '');
  const schemeMatch = normalized.match(/^(https?):\/\//i);
  if (!schemeMatch) throw errorWithCode('INVALID_ARGUMENT', 'host must be a valid http(s) url');
  const rest = normalized.slice(schemeMatch[0].length);
  const pathIndex = rest.search(/[/?#]/);
  const authority = pathIndex >= 0 ? rest.slice(0, pathIndex) : rest;
  const suffix = pathIndex >= 0 ? rest.slice(pathIndex) : '';
  const parsedAuthority = parseAuthority(authority);
  if (!parsedAuthority) throw errorWithCode('INVALID_ARGUMENT', 'host must include explicit port');
  if (suffix && suffix !== '/') throw errorWithCode('INVALID_ARGUMENT', 'host must not include path, query, or fragment');
  return `${schemeMatch[1].toLowerCase()}://${authority}`;
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

const requestHost = (req, ctx) => firstDefined(req?.host, ctx?.bindings?.host);
const requestUsername = (_req, ctx) => firstDefined(ctx?.bindings?.username, ctx?.bindings?.user);
const requestPassword = (_req, ctx) => firstDefined(ctx?.bindings?.password);
const requestGroupName = (req) => firstDefined(req?.group_name, req?.groupName);

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

const buildHeaders = (ctx, extra = {}) => ({
  ...(ctx?.bindings?.headers || {}),
  'content-type': CONTENT_TYPE,
  accept: ACCEPT,
  ...extra,
});

const getInstanceKey = (ctx) => String(ctx?.meta?.instance_id || ctx?.meta?.instanceId || 'default');

const getInstanceSessionMap = (ctx) => {
  const key = getInstanceKey(ctx);
  let map = SESSION_CACHE.get(key);
  if (!map) {
    map = new Map();
    SESSION_CACHE.set(key, map);
  }
  return map;
};

const getSession = (ctx, host) => getInstanceSessionMap(ctx).get(host);
const setSession = (ctx, host, session) => getInstanceSessionMap(ctx).set(host, session);
const clearSession = (ctx, host) => getInstanceSessionMap(ctx).delete(host);
const clearAllSessions = () => SESSION_CACHE.clear();

const toValue = (val) => {
  if (val === undefined || val === null) return null;
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'number') return { numberValue: val };
  if (typeof val === 'boolean') return { boolValue: val };
  if (Array.isArray(val)) {
    return {
      listValue: {
        values: val.map((item) => {
          const encoded = toValue(item);
          return encoded === null ? { nullValue: 'NULL_VALUE' } : encoded;
        }),
      },
    };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [key, value] of Object.entries(val)) {
      const encoded = toValue(value);
      fields[key] = encoded === null ? { nullValue: 'NULL_VALUE' } : encoded;
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(val) };
};

const buildBodyWrapper = (text) => {
  const rawText = text == null ? '' : String(text);
  if (!rawText) {
    return {
      is_json: false,
      json_value: null,
      raw_text: '',
    };
  }
  try {
    const parsed = JSON.parse(rawText);
    return {
      is_json: true,
      json_value: toValue(parsed),
      raw_text: '',
    };
  } catch {
    return {
      is_json: false,
      json_value: null,
      raw_text: rawText,
    };
  }
};

const buildHttpResponse = (status, text) => ({
  http_status: Number(status),
  body: buildBodyWrapper(text),
});

const buildSanitizedHttpResponse = (status) => ({
  http_status: Number(status),
  body: buildBodyWrapper(''),
});

const fetchUpstream = async (ctx, url, init = {}) => {
  try {
    const response = await fetchWithTimeout(url, init, { timeoutMs: resolveTimeoutMs(ctx), bindings: ctx?.bindings });
    const text = await response.text();
    return {
      status: Number(response.status),
      text: String(text ?? ''),
    };
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', err?.cause?.message || err?.message || 'fetch failed');
  }
};

const buildCookieHeader = (session) => {
  const pairs = [
    ['fromrootvsys', session.fromrootvsys],
    ['role', session.role],
    ['vsysId', session.vsysId],
    ['token', session.token],
    ['username', session.username],
    ['lang', session.lang],
  ];
  return pairs.map(([key, value]) => `${key}=${value}`).join('; ');
};

const requireSession = (ctx, host) => {
  const session = getSession(ctx, host);
  if (!session) throw errorWithCode('FAILED_PRECONDITION', 'call Login first');
  return session;
};

const normalizeIpItem = (item) => {
  const source = item || {};
  return {
    ip_addr: requireString(source.ip_addr ?? source.ipAddr, 'ips[].ip_addr'),
    netmask: toTrimmedString(source.netmask) || '32',
    flag: 0,
  };
};

const readRepeatedIps = (value) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray(value.values)) {
    return value.values.map((item) => item?.value ?? item);
  }
  return value;
};

const normalizeIpList = (value) => {
  const ips = readRepeatedIps(value);
  if (!Array.isArray(ips) || ips.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'ips must be a non-empty array');
  return ips.map(normalizeIpItem);
};

const buildAddressBookPayload = (req) => ([
  {
    name: requireString(requestGroupName(req), 'group_name'),
    ip: normalizeIpList(req?.ips),
  },
]);

const buildQueryUrl = (host, req) => {
  const groupName = requireString(requestGroupName(req), 'group_name');
  const start = readNonNegativeInt(req?.start, 'start', DEFAULT_START);
  const limitRaw = readNonNegativeInt(req?.limit, 'limit', DEFAULT_LIMIT);
  const pageRaw = readNonNegativeInt(req?.page, 'page', DEFAULT_PAGE);
  const limit = limitRaw > 0 ? limitRaw : DEFAULT_LIMIT;
  const page = pageRaw > 0 ? pageRaw : DEFAULT_PAGE;
  const query = {
    conditions: [{ field: 'name', value: groupName }],
    start,
    limit,
    page,
  };
  return `${host}/rest/api/addrbook?query=${encodeURIComponent(JSON.stringify(query))}`;
};

const extractSessionFromLogin = (req, ctx, status, text) => {
  if (status < 200 || status >= 300) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (hasOwn(parsed, 'success') && parsed.success !== true) return null;
  const first = Array.isArray(parsed?.result) ? parsed.result[0] : null;
  if (!first || typeof first !== 'object') return null;
  const token = toTrimmedString(first.token);
  const role = toTrimmedString(first.role);
  const vsysId = toTrimmedString(first.vsysId);
  const fromrootvsys = toTrimmedString(first.fromrootvsys);
  if (!token || !role || !vsysId || !fromrootvsys) return null;
  return {
    fromrootvsys,
    role,
    vsysId,
    token,
    username: requireString(requestUsername(req, ctx), 'username'),
    lang: DEFAULT_LANG,
  };
};

const runLogin = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const host = requireHost(requestHost(req, callCtx));
  const body = JSON.stringify({
    userName: requireString(requestUsername(req, callCtx), 'username'),
    password: requireString(requestPassword(req, callCtx), 'password'),
    encodeUserName: '0',
    encodePassword: '0',
    lang: DEFAULT_LANG,
  });
  const upstream = await fetchUpstream(callCtx, `${host}/rest/api/login`, {
    method: 'POST',
    headers: buildHeaders(callCtx),
    body,
  });
  const session = extractSessionFromLogin(req, callCtx, upstream.status, upstream.text);
  if (session) setSession(callCtx, host, session);
  return buildSanitizedHttpResponse(upstream.status);
};

const runAddressGroupMutation = async (req, ctx, method) => {
  const callCtx = resolveCallContext(ctx);
  const host = requireHost(requestHost(req, callCtx));
  const session = requireSession(callCtx, host);
  const upstream = await fetchUpstream(callCtx, `${host}/rest/api/addrbook`, {
    method,
    headers: buildHeaders(callCtx, { Cookie: buildCookieHeader(session) }),
    body: JSON.stringify(buildAddressBookPayload(req)),
  });
  if (upstream.status === 401 || upstream.status === 403) clearSession(callCtx, host);
  return buildHttpResponse(upstream.status, upstream.text);
};

const runQueryAddressGroup = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const host = requireHost(requestHost(req, callCtx));
  const session = requireSession(callCtx, host);
  const upstream = await fetchUpstream(callCtx, buildQueryUrl(host, req), {
    method: 'GET',
    headers: buildHeaders(callCtx, { Cookie: buildCookieHeader(session) }),
  });
  if (upstream.status === 401 || upstream.status === 403) clearSession(callCtx, host);
  return buildHttpResponse(upstream.status, upstream.text);
};

const registerHandlers = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  return {
    [LOGIN_PATH]: (req = callCtx.req) => runLogin(req ?? {}, callCtx),
    [ADD_ADDRESS_GROUP_PATH]: (req = callCtx.req) => runAddressGroupMutation(req ?? {}, callCtx, 'POST'),
    [OVERWRITE_ADDRESS_GROUP_PATH]: (req = callCtx.req) => runAddressGroupMutation(req ?? {}, callCtx, 'PUT'),
    [QUERY_ADDRESS_GROUP_PATH]: (req = callCtx.req) => runQueryAddressGroup(req ?? {}, callCtx),
  };
};

export function rpcdef(ctx = {}) {
  return registerHandlers(ctx);
}

const callSdkHandler = (ctx, path) => registerHandlers(ctx)[path](ctx?.req ?? ctx?.request ?? {});

export const handlers = {
  [METHOD_LOGIN_FULL]: (ctx) => callSdkHandler(ctx, LOGIN_PATH),
  [METHOD_ADD_ADDRESS_GROUP_FULL]: (ctx) => callSdkHandler(ctx, ADD_ADDRESS_GROUP_PATH),
  [METHOD_OVERWRITE_ADDRESS_GROUP_FULL]: (ctx) => callSdkHandler(ctx, OVERWRITE_ADDRESS_GROUP_PATH),
  [METHOD_QUERY_ADDRESS_GROUP_FULL]: (ctx) => callSdkHandler(ctx, QUERY_ADDRESS_GROUP_PATH),
};

rpcdef.__test__ = {
  ACCEPT,
  ADD_ADDRESS_GROUP_PATH,
  buildAddressBookPayload,
  buildBodyWrapper,
  buildCookieHeader,
  buildHeaders,
  buildHttpResponse,
  buildSanitizedHttpResponse,
  buildQueryUrl,
  buildTlsOptions,
  clearAllSessions,
  clearSession,
  CONTENT_TYPE,
  createTlsDispatcher,
  DEFAULT_LANG,
  errorWithCode,
  extractSessionFromLogin,
  fetchWithTimeout,
  fetchUpstream,
  firstDefined,
  getInstanceKey,
  getInstanceSessionMap,
  getSession,
  hasOwn,
  LOGIN_PATH,
  normalizeIpItem,
  normalizeIpList,
  parseAuthority,
  QUERY_ADDRESS_GROUP_PATH,
  readNonNegativeInt,
  readRepeatedIps,
  registerHandlers,
  requireHost,
  requireSession,
  requireString,
  resolveCallContext,
  resolveTimeoutMs,
  runAddressGroupMutation,
  runLogin,
  runQueryAddressGroup,
  setSession,
  shouldSkipTlsVerify,
  toTrimmedString,
  toValue,
  unwrapScalar,
};

export const _test = rpcdef.__test__;
