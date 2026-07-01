import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const LOGIN_PATH = '/HILLSTONE_FW_V55R4.HILLSTONE_FW_V55R4/Login';
export const CREATE_ADDRESS_GROUP_PATH = '/HILLSTONE_FW_V55R4.HILLSTONE_FW_V55R4/CreateAddressGroup';
export const UPDATE_ADDRESS_GROUP_PATH = '/HILLSTONE_FW_V55R4.HILLSTONE_FW_V55R4/UpdateAddressGroup';
export const QUERY_ADDRESS_GROUP_PATH = '/HILLSTONE_FW_V55R4.HILLSTONE_FW_V55R4/QueryAddressGroup';

export const METHOD_LOGIN_FULL = 'HILLSTONE_FW_V55R4.HILLSTONE_FW_V55R4/Login';
export const METHOD_CREATE_ADDRESS_GROUP_FULL = 'HILLSTONE_FW_V55R4.HILLSTONE_FW_V55R4/CreateAddressGroup';
export const METHOD_UPDATE_ADDRESS_GROUP_FULL = 'HILLSTONE_FW_V55R4.HILLSTONE_FW_V55R4/UpdateAddressGroup';
export const METHOD_QUERY_ADDRESS_GROUP_FULL = 'HILLSTONE_FW_V55R4.HILLSTONE_FW_V55R4/QueryAddressGroup';

export const CONTENT_TYPE = 'text/plain;charset=UTF-8';
export const DEFAULT_IF_VSYS_ID = '0';
export const DEFAULT_VR_ID = '1';
export const DEFAULT_LANG = 'zh_CN';
export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_LIMIT = 50;
export const DEFAULT_PAGE = 1;
let insecureDispatcherPromise;

const SESSION_CACHE = new Map();

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), message);
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

const pickFirst = (source, keys) => {
  for (const key of keys) {
    if (hasOwn(source, key)) return unwrapScalar(source[key]);
  }
  return undefined;
};

const pickRequestOrBinding = (req, ctx, requestKeys, bindingKeys = requestKeys) =>
  firstDefined(pickFirst(req, requestKeys), pickFirst(ctx?.bindings ?? {}, bindingKeys));

const pickBinding = (ctx, bindingKeys) => pickFirst(mergedBindings(ctx), bindingKeys);

const toTrimmedString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

const requireString = (value, fieldName) => {
  const raw = toTrimmedString(value);
  if (!raw) throw errorWithCode('INVALID_ARGUMENT', `${fieldName} is required`);
  return raw;
};

const readInteger = (value, defaultValue, fieldName) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  const num = Number(raw);
  if (!Number.isFinite(num)) throw errorWithCode('INVALID_ARGUMENT', `${fieldName} must be a valid integer`);
  return Math.trunc(num);
};

const requireHost = (value) => {
  const raw = requireString(value, 'host');
  if (!/^https?:\/\//i.test(raw)) throw errorWithCode('INVALID_ARGUMENT', 'host must include http(s) scheme and port');
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

const resolveTimeoutMs = (ctx) => {
  const bindings = mergedBindings(ctx);
  const timeout = Number(firstDefined(ctx?.limits?.timeoutMs, bindings.timeoutMs, bindings.timeout_ms, DEFAULT_TIMEOUT_MS));
  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS;
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
  accept: `${CONTENT_TYPE}, application/json;q=0.9, */*;q=0.8`,
  ...extra,
});

const throwStructuredError = (code, message, options = {}) => {
  const bodyText = String(options.httpBody ?? '');
  const payload = {
    code,
    message,
    http_status: Number(options.httpStatus ?? 0),
    http_body: '',
    http_body_length: bodyText.length,
  };
  if (options.reason) payload.reason = String(options.reason);
  throw errorWithCode(code, JSON.stringify(payload));
};

const throwForHttpStatus = (status, bodyText) => {
  const options = {
    httpStatus: status,
    httpBody: bodyText,
    reason: 'http status is not 2xx',
  };
  if (status === 401 || status === 403) throwStructuredError('PERMISSION_DENIED', 'hillstone upstream permission denied', options);
  if (status >= 400 && status < 500) throwStructuredError('FAILED_PRECONDITION', 'hillstone upstream client error', options);
  throwStructuredError('UNAVAILABLE', 'hillstone upstream unavailable', options);
};

const fetchText = async (ctx, url, init = {}) => {
  const callCtx = resolveCallContext(ctx);
  let response;
  try {
    response = await fetchWithTimeout(url, init, { timeoutMs: resolveTimeoutMs(callCtx), bindings: callCtx.bindings });
  } catch (err) {
    throwStructuredError('UNAVAILABLE', 'hillstone upstream request failed', {
      httpStatus: 0,
      httpBody: '',
      reason: err?.cause?.message || err?.message || 'fetch failed',
    });
  }
  const bodyText = String((await response.text()) ?? '');
  if (!response.ok) throwForHttpStatus(response.status, bodyText);
  const result = {
    http_status: Number(response.status),
    http_body: '',
  };
  Object.defineProperty(result, 'body_text', { value: bodyText, enumerable: false });
  return result;
};

const asArray = (value) => {
  const raw = unwrapScalar(value);
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.values)) return raw.values.map((item) => unwrapScalar(item));
  return [];
};

const buildCookieContext = (value) => {
  const cookie = value || {};
  const fromrootvsys = requireString(pickFirst(cookie, ['fromrootvsys']), 'cookie.fromrootvsys');
  const role = requireString(pickFirst(cookie, ['role']), 'cookie.role');
  const vsysId = requireString(pickFirst(cookie, ['vsys_id', 'vsysId']), 'cookie.vsys_id');
  const token = requireString(pickFirst(cookie, ['token']), 'cookie.token');
  const username = requireString(pickFirst(cookie, ['username']), 'cookie.username');
  const lang = toTrimmedString(pickFirst(cookie, ['lang'])) || DEFAULT_LANG;
  return { fromrootvsys, role, vsysId, token, username, lang };
};

const buildCookieHeader = (cookie) => {
  const pairs = [
    ['fromrootvsys', cookie.fromrootvsys],
    ['role', cookie.role],
    ['vsysId', cookie.vsysId],
    ['token', cookie.token],
    ['username', cookie.username],
    ['lang', cookie.lang],
  ];
  return pairs.map(([key, value]) => `${key}=${value}`).join('; ');
};

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

const requireSession = (ctx, host) => {
  const session = getSession(ctx, host);
  if (!session) throw errorWithCode('FAILED_PRECONDITION', 'call Login first');
  return session;
};

const mapAddressBookIP = (item) => ({
  ip_addr: requireString(pickFirst(item, ['ip_addr', 'ipAddr']), 'address_books[].ip[].ip_addr'),
  netmask: requireString(pickFirst(item, ['netmask']), 'address_books[].ip[].netmask'),
  flag: readInteger(pickFirst(item, ['flag']), 0, 'address_books[].ip[].flag'),
});

const mapAddressBookRange = (item) => ({
  min: requireString(pickFirst(item, ['min']), 'address_books[].range[].min'),
  max: requireString(pickFirst(item, ['max']), 'address_books[].range[].max'),
  flag: readInteger(pickFirst(item, ['flag']), 0, 'address_books[].range[].flag'),
});

const mapAddressBookEntry = (item) => ({
  name: requireString(pickFirst(item, ['name']), 'address_books[].entry[].name'),
  type: requireString(pickFirst(item, ['type']), 'address_books[].entry[].type'),
});

const mapAddressBookHost = (item) => ({
  dns_name: requireString(pickFirst(item, ['dns_name', 'dnsName']), 'address_books[].host[].dns_name'),
});

const mapAddressBook = (item) => {
  const payload = {
    name: requireString(pickFirst(item, ['name']), 'address_books[].name'),
    ip: asArray(pickFirst(item, ['ip'])).map(mapAddressBookIP),
  };
  const ranges = asArray(pickFirst(item, ['range'])).map(mapAddressBookRange);
  const entries = asArray(pickFirst(item, ['entry'])).map(mapAddressBookEntry);
  const hosts = asArray(pickFirst(item, ['host'])).map(mapAddressBookHost);
  if (ranges.length > 0) payload.range = ranges;
  if (entries.length > 0) payload.entry = entries;
  if (hosts.length > 0) payload.host = hosts;
  return payload;
};

const buildAddressBooks = (value) => {
  const list = asArray(value);
  if (list.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'address_books must contain at least one address book');
  return list.map(mapAddressBook);
};

const buildLoginPayload = (req, ctx) => ({
  userName: requireString(pickBinding(ctx, ['user_name', 'userName', 'username', 'user']), 'user_name'),
  password: requireString(pickBinding(ctx, ['password']), 'password'),
  ifVsysId: toTrimmedString(pickFirst(req, ['if_vsys_id', 'ifVsysId'])) || DEFAULT_IF_VSYS_ID,
  vrId: toTrimmedString(pickFirst(req, ['vr_id', 'vrId'])) || DEFAULT_VR_ID,
  lang: toTrimmedString(pickFirst(req, ['lang'])) || DEFAULT_LANG,
});

const buildQueryUrl = (host, req) => {
  const name = requireString(pickFirst(req, ['name']), 'name');
  const start = readInteger(pickFirst(req, ['start']), 0, 'start');
  const limit = readInteger(pickFirst(req, ['limit']), DEFAULT_LIMIT, 'limit');
  const page = readInteger(pickFirst(req, ['page']), DEFAULT_PAGE, 'page');
  const query = {
    conditions: [{ field: 'name', value: name }],
    start,
    limit: limit > 0 ? limit : DEFAULT_LIMIT,
    page: page > 0 ? page : DEFAULT_PAGE,
  };
  return `${host}/rest/doc/addrbook?query=${encodeURIComponent(JSON.stringify(query))}`;
};

const normalizeLoginResult = (parsed) => {
  if (Array.isArray(parsed?.result)) return parsed.result[0];
  if (parsed?.result && typeof parsed.result === 'object') return parsed.result;
  return null;
};

const extractSessionFromLogin = (ctx, httpStatus, httpBody, lang) => {
  if (httpStatus < 200 || httpStatus >= 300) return null;
  let parsed;
  try {
    parsed = JSON.parse(String(httpBody ?? ''));
  } catch {
    return null;
  }
  if (parsed?.success === false) return null;
  const result = normalizeLoginResult(parsed);
  if (!result || typeof result !== 'object') return null;
  const token = toTrimmedString(pickFirst(result, ['token']));
  if (!token) return null;
  return {
    fromrootvsys: toTrimmedString(pickFirst(result, ['fromrootvsys'])),
    role: toTrimmedString(pickFirst(result, ['role'])),
    vsysId: toTrimmedString(pickFirst(result, ['vsys_id', 'vsysId'])),
    token,
    username: requireString(pickBinding(ctx, ['user_name', 'userName', 'username', 'user']), 'user_name'),
    lang: lang || DEFAULT_LANG,
  };
};

const runLogin = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const host = requireHost(pickRequestOrBinding(req, callCtx, ['host']));
  const lang = toTrimmedString(pickFirst(req, ['lang'])) || DEFAULT_LANG;
  const response = await fetchText(callCtx, `${host}/rest/doc/login`, {
    method: 'POST',
    headers: buildHeaders(callCtx),
    body: JSON.stringify(buildLoginPayload(req, callCtx)),
  });
  const session = extractSessionFromLogin(callCtx, response.http_status, response.body_text, lang);
  if (session) setSession(callCtx, host, session);
  return { http_status: response.http_status, http_body: '' };
};

const runCreateAddressGroup = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const host = requireHost(pickRequestOrBinding(req, callCtx, ['host']));
  const session = requireSession(callCtx, host);
  const response = await fetchText(callCtx, `${host}/rest/doc/addrbook`, {
    method: 'POST',
    headers: buildHeaders(callCtx, { Cookie: buildCookieHeader(session) }),
    body: JSON.stringify(buildAddressBooks(pickFirst(req, ['address_books', 'addressBooks']))),
  });
  return response;
};

const runUpdateAddressGroup = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const host = requireHost(pickRequestOrBinding(req, callCtx, ['host']));
  const session = requireSession(callCtx, host);
  return fetchText(callCtx, `${host}/rest/doc/addrbook`, {
    method: 'PUT',
    headers: buildHeaders(callCtx, { Cookie: buildCookieHeader(session) }),
    body: JSON.stringify(buildAddressBooks(pickFirst(req, ['address_books', 'addressBooks']))),
  });
};

const runQueryAddressGroup = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const host = requireHost(pickRequestOrBinding(req, callCtx, ['host']));
  const session = requireSession(callCtx, host);
  return fetchText(callCtx, buildQueryUrl(host, req), {
    method: 'GET',
    headers: buildHeaders(callCtx, { Cookie: buildCookieHeader(session) }),
  });
};

const registerHandlers = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  return {
    [LOGIN_PATH]: (req = callCtx.req) => runLogin(req ?? {}, callCtx),
    [CREATE_ADDRESS_GROUP_PATH]: (req = callCtx.req) => runCreateAddressGroup(req ?? {}, callCtx),
    [UPDATE_ADDRESS_GROUP_PATH]: (req = callCtx.req) => runUpdateAddressGroup(req ?? {}, callCtx),
    [QUERY_ADDRESS_GROUP_PATH]: (req = callCtx.req) => runQueryAddressGroup(req ?? {}, callCtx),
  };
};

export function rpcdef(ctx = {}) {
  return registerHandlers(ctx);
}

const callSdkHandler = (ctx, path) => registerHandlers(ctx)[path](ctx?.req ?? ctx?.request ?? {});

export const handlers = {
  [METHOD_LOGIN_FULL]: (ctx) => callSdkHandler(ctx, LOGIN_PATH),
  [METHOD_CREATE_ADDRESS_GROUP_FULL]: (ctx) => callSdkHandler(ctx, CREATE_ADDRESS_GROUP_PATH),
  [METHOD_UPDATE_ADDRESS_GROUP_FULL]: (ctx) => callSdkHandler(ctx, UPDATE_ADDRESS_GROUP_PATH),
  [METHOD_QUERY_ADDRESS_GROUP_FULL]: (ctx) => callSdkHandler(ctx, QUERY_ADDRESS_GROUP_PATH),
};

rpcdef.__test__ = {
  asArray,
  buildAddressBooks,
  buildCookieContext,
  buildCookieHeader,
  buildHeaders,
  buildLoginPayload,
  buildQueryUrl,
  buildTlsOptions,
  clearAllSessions,
  clearSession,
  CONTENT_TYPE,
  createTlsDispatcher,
  errorWithCode,
  extractSessionFromLogin,
  fetchWithTimeout,
  fetchText,
  firstDefined,
  getInstanceKey,
  getSession,
  hasOwn,
  mapAddressBook,
  mapAddressBookEntry,
  mapAddressBookHost,
  mapAddressBookIP,
  mapAddressBookRange,
  pickFirst,
  pickBinding,
  pickRequestOrBinding,
  readInteger,
  registerHandlers,
  requireHost,
  requireSession,
  requireString,
  resolveCallContext,
  resolveTimeoutMs,
  runCreateAddressGroup,
  runLogin,
  runQueryAddressGroup,
  runUpdateAddressGroup,
  setSession,
  shouldSkipTlsVerify,
  throwForHttpStatus,
  throwStructuredError,
  toTrimmedString,
  unwrapScalar,
};

export const _test = rpcdef.__test__;
