import crypto from 'node:crypto';
import net from 'node:net';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const METHOD_LOGIN_PATH = '/TopSec_FW_5U.TopSec_FW_5U/Login';
export const METHOD_REFRESH_PATH = '/TopSec_FW_5U.TopSec_FW_5U/Refresh';
export const METHOD_ADD_PATH = '/TopSec_FW_5U.TopSec_FW_5U/AddToBlacklist';
export const METHOD_REMOVE_PATH = '/TopSec_FW_5U.TopSec_FW_5U/RemoveFromBlacklist';
export const METHOD_LOGOUT_PATH = '/TopSec_FW_5U.TopSec_FW_5U/Logout';

export const METHOD_LOGIN_FULL = 'TopSec_FW_5U.TopSec_FW_5U/Login';
export const METHOD_REFRESH_FULL = 'TopSec_FW_5U.TopSec_FW_5U/Refresh';
export const METHOD_ADD_FULL = 'TopSec_FW_5U.TopSec_FW_5U/AddToBlacklist';
export const METHOD_REMOVE_FULL = 'TopSec_FW_5U.TopSec_FW_5U/RemoveFromBlacklist';
export const METHOD_LOGOUT_FULL = 'TopSec_FW_5U.TopSec_FW_5U/Logout';

export const LOGIN_HTTP_PATH = '/home/login/';
export const REFRESH_HTTP_PATH = '/home/index/';
export const ADD_HTTP_PATH = '/home/default/blackListSpread/addTuple/';
export const REMOVE_HTTP_PATH = '/home/default/blackListSpread/deleteLots/';
export const LOGOUT_HTTP_PATH = '/home/index/logout/';
export const DEFAULT_TIMEOUT_MS = 5000;
export const FIXED_AES_VALUE = '1111111111111111';
export const TOKEN_LENGTH = 16;
export const PREFIX_PADDING_LENGTH = 3;

const DUPLICATE_HINT = /黑名单条目已存在|already\s+exist|already\s+in\s+blacklist|exists/i;
const NOT_FOUND_HINT = /黑名单索引不存在|not\s+found|already\s+removed|不存在/i;

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message, details = {}) => {
  const payload = {
    code,
    message,
    http_status: Number(details.http_status || 0),
    reason: String(details.reason || message || ''),
  };
  const err = new GrpcError(grpcCodeFor(code), JSON.stringify(payload));
  err.legacyCode = code;
  err.details = payload;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const pickString = (...values) => {
  for (const value of values) {
    const raw = unwrapScalar(value);
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed) return trimmed;
    }
  }
  return '';
};

const pickBoolean = (...values) => {
  for (const value of values) {
    const raw = unwrapScalar(value);
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'string') {
      const normalized = raw.trim().toLowerCase();
      if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
      if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) return false;
    }
  }
  return undefined;
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const mergedBindings = (ctx = {}) => ({
  ...(ctx.bindings ?? {}),
  ...(ctx.config ?? {}),
  ...(ctx.secret ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  config: ctx.config ?? {},
  secret: ctx.secret ?? {},
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? ctx.metadata ?? {},
  req: ctx.req ?? ctx.request ?? {},
});

const tryParseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const base64Encode = (bytes) => Buffer.from(bytes).toString('base64');
const base64Decode = (text) => Buffer.from(String(text || '').replace(/[^A-Za-z0-9+/=]/g, ''), 'base64').toString('utf8');

const zeroPadBuffer = (buffer, blockSize) => {
  const remainder = buffer.length % blockSize;
  if (remainder === 0) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(blockSize - remainder)]);
};

const encryptPassword = (plaintext) => {
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(FIXED_AES_VALUE), Buffer.from(FIXED_AES_VALUE));
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([
    cipher.update(zeroPadBuffer(Buffer.from(String(plaintext || ''), 'utf8'), 16)),
    cipher.final(),
  ]);
  return `'${base64Encode(encrypted)}'`;
};

const decodeTopSecBody = (rawText) => {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) return { decoded: undefined, rotatedToken: '' };
  const directJson = tryParseJson(trimmed);
  if (directJson !== undefined) return { decoded: directJson, rotatedToken: '' };
  if (trimmed.startsWith('?') && trimmed.length > (1 + TOKEN_LENGTH + PREFIX_PADDING_LENGTH)) {
    const rotatedToken = trimmed.slice(1, 1 + TOKEN_LENGTH);
    const encoded = trimmed.slice(1 + TOKEN_LENGTH + PREFIX_PADDING_LENGTH);
    const decoded = tryParseJson(base64Decode(encoded));
    if (decoded !== undefined) return { decoded, rotatedToken };
  }
  const decoded = tryParseJson(base64Decode(trimmed));
  if (decoded !== undefined) return { decoded, rotatedToken: '' };
  return { decoded: undefined, rotatedToken: '' };
};

const extractTokenFromDecoded = (decoded) => {
  if (!isObject(decoded)) return '';
  return pickString(
    decoded.token,
    decoded?.data?.token,
    Array.isArray(decoded?.tokens) ? decoded.tokens[0] : '',
    Array.isArray(decoded?.data?.tokens) ? decoded.data.tokens[0] : '',
  );
};

const resolveDecodedMessage = (decoded) => {
  if (!isObject(decoded)) return '';
  if (typeof decoded.data === 'string') return pickString(decoded.data, decoded.message, decoded.msg);
  return pickString(decoded?.data?.message, decoded?.data?.msg, decoded.message, decoded.msg);
};

const normalizeBaseUrl = (rawHost, allowHttp) => {
  const host = pickString(rawHost);
  if (!host) throw errorWithCode('INVALID_ARGUMENT', 'host is required');
  const candidate = /^https?:\/\//i.test(host) ? host : `https://${host}`;
  const parsed = new URL(candidate);
  if (!allowHttp && parsed.protocol !== 'https:') {
    throw errorWithCode('FAILED_PRECONDITION', 'HTTPS is required unless allow_http is enabled');
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw errorWithCode('INVALID_ARGUMENT', 'host must not include path, query, or fragment');
  }
  const authority = candidate.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i)?.[1] || '';
  const hasExplicitPort = authority.startsWith('[')
    ? /\]:\d+$/.test(authority)
    : /:\d+$/.test(authority) && authority.indexOf(':') === authority.lastIndexOf(':');
  if (!hasExplicitPort) throw errorWithCode('INVALID_ARGUMENT', 'host must include explicit port');
  return candidate.replace(/\/$/, '');
};

const isValidIP = (value) => net.isIP(pickString(value)) !== 0;

const optionalUint32 = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return undefined;
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? Math.trunc(num) : undefined;
};

const resolveTimeoutMs = (ctx = {}) => optionalUint32(ctx.limits?.timeoutMs)
  ?? optionalUint32(ctx.bindings?.timeoutMs)
  ?? optionalUint32(ctx.bindings?.timeout_ms)
  ?? DEFAULT_TIMEOUT_MS;

const buildEngineHeaders = (bindings = {}, meta = {}, req = {}) => ({
  ...(bindings.headers || {}),
  'x-engine-instance': pickString(meta.instance_id, meta.instanceId) || 'unknown',
  'x-request-id': pickString(meta.request_id, meta.requestId, req.request_id, req.requestId) || 'unknown',
});

const gatherCookies = (headers) => {
  if (!headers) return '';
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie().map((item) => String(item).split(';')[0].trim()).filter(Boolean).join('; ');
  }
  if (typeof headers.raw === 'function') {
    const raw = headers.raw();
    if (Array.isArray(raw?.['set-cookie'])) {
      return raw['set-cookie'].map((item) => String(item).split(';')[0].trim()).filter(Boolean).join('; ');
    }
  }
  const single = typeof headers.get === 'function' ? headers.get('set-cookie') : headers['set-cookie'];
  if (!single) return '';
  return String(single).split(/,(?=[^;]+?=)/).map((item) => item.trim().split(';')[0]).filter(Boolean).join('; ');
};

const mapHttpStatusToCode = (status) => {
  if (status === 401 || status === 403) return 'PERMISSION_DENIED';
  if (status >= 400 && status < 500) return 'FAILED_PRECONDITION';
  return 'UNAVAILABLE';
};

const insecureTlsDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

const buildTlsOptions = (options = {}) => (options.skipTlsVerify ? { dispatcher: insecureTlsDispatcher } : {});

const makeTimeoutSignal = (timeoutMs) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeoutId) };
};

const fetchText = async (ctx, url, init = {}, options = {}) => {
  const timeout = makeTimeoutSignal(resolveTimeoutMs(ctx));
  let response;
  try {
    response = await fetch(url, { ...init, signal: timeout.signal, ...buildTlsOptions(options) });
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', 'topsec upstream request failed', {
      http_status: 0,
      reason: err?.cause?.message || err?.message || 'fetch failed',
    });
  } finally {
    timeout.clear();
  }
  let text = '';
  try {
    text = await response.text();
  } catch (err) {
    throw errorWithCode('UNKNOWN', 'topsec upstream response body read failed', {
      http_status: response?.status || 0,
      reason: err?.message || 'read body failed',
    });
  }
  if (response.status < 200 || response.status > 299) {
    throw errorWithCode(mapHttpStatusToCode(response.status), 'topsec upstream request failed', {
      http_status: response.status,
      reason: `upstream http ${response.status}`,
    });
  }
  return { status: response.status, text, headers: response.headers || {} };
};

const parseSuccessfulPayload = (status, text) => {
  const { decoded, rotatedToken } = decodeTopSecBody(text);
  if (!isObject(decoded)) {
    throw errorWithCode('UNKNOWN', 'topsec upstream response is not valid', {
      http_status: status,
      reason: 'response is neither expected token-prefixed payload nor valid JSON',
    });
  }
  return { decoded, rotatedToken };
};

const buildSessionContext = (base, overrides = {}) => ({
  host: base.host,
  token: overrides.token || base.token,
  user_mark: overrides.user_mark || base.user_mark,
  cookie: overrides.cookie || base.cookie,
  skip_tls_verify: Boolean(overrides.skip_tls_verify ?? base.skip_tls_verify),
  allow_http: Boolean(overrides.allow_http ?? base.allow_http),
  vendor_state: overrides.vendor_state || base.vendor_state || null,
});

const sessionCache = new Map();

const cacheIdentity = (ctx = {}, host = '', username = '') => {
  const serviceId = pickString(ctx.serviceId, ctx.service_id, ctx.meta?.service_id, ctx.meta?.serviceId) || 'topsec__fw-5u';
  const instanceId = pickString(ctx.instanceId, ctx.instance_id, ctx.meta?.instance_id, ctx.meta?.instanceId, ctx.workdir) || 'default';
  return JSON.stringify([serviceId, instanceId, host, username]);
};

const ensureSession = (session) => {
  if (!isObject(session)) throw errorWithCode('INVALID_ARGUMENT', 'session is required');
  const host = normalizeBaseUrl(session.host, Boolean(session.allow_http || session.allowHttp));
  const token = pickString(session.token);
  const userMark = pickString(session.user_mark, session.userMark);
  const cookie = pickString(session.cookie);
  if (!token || !userMark || !cookie) {
    throw errorWithCode('INVALID_ARGUMENT', 'session.host/token/user_mark/cookie must be provided');
  }
  return {
    host,
    token,
    user_mark: userMark,
    cookie,
    skip_tls_verify: Boolean(session.skip_tls_verify || session.skipTlsVerify),
    allow_http: Boolean(session.allow_http || session.allowHttp),
    vendor_state: isObject(session.vendor_state) ? session.vendor_state : null,
  };
};

const requireIp = (value) => {
  const ip = pickString(value);
  if (!ip) throw errorWithCode('INVALID_ARGUMENT', 'ip is required');
  if (!isValidIP(ip)) throw errorWithCode('INVALID_ARGUMENT', `ip must be a valid IP address: ${ip}`);
  return ip;
};

const interpretLogin = (status, text, decoded, rotatedToken, sessionBase) => {
  if (!Boolean(decoded.result)) {
    throw errorWithCode('PERMISSION_DENIED', 'topsec login failed', {
      http_status: status,
      reason: resolveDecodedMessage(decoded) || 'login failed',
    });
  }
  const userMark = pickString(decoded?.data?.authid);
  const token = rotatedToken || extractTokenFromDecoded(decoded);
  if (!userMark || !token) {
    throw errorWithCode('UNKNOWN', 'topsec login response missing session fields', {
      http_status: status,
      reason: 'missing token or authid',
    });
  }
  return {
    success: true,
    message: resolveDecodedMessage(decoded) || 'login success',
    session: buildSessionContext(sessionBase, { token, user_mark: userMark, vendor_state: decoded }),
    http_status: status,
  };
};

const interpretRefresh = (status, text, decoded, rotatedToken, session) => {
  if (!Boolean(decoded.result)) {
    throw errorWithCode('FAILED_PRECONDITION', 'topsec refresh failed', {
      http_status: status,
      reason: resolveDecodedMessage(decoded) || 'refresh failed',
    });
  }
  return {
    success: true,
    message: resolveDecodedMessage(decoded) || 'refresh success',
    session: buildSessionContext(session, { token: rotatedToken || extractTokenFromDecoded(decoded) || session.token, vendor_state: decoded }),
    http_status: status,
  };
};

const interpretOperation = (status, text, decoded, rotatedToken, session, ip, action) => {
  const message = resolveDecodedMessage(decoded) || `${action} failed`;
  const success = Boolean(decoded.result);
  const duplicate = action === 'add' && DUPLICATE_HINT.test(message);
  const missing = action === 'remove' && NOT_FOUND_HINT.test(message);
  if (!success && !duplicate && !missing) {
    throw errorWithCode('FAILED_PRECONDITION', `topsec ${action} failed`, {
      http_status: status,
      reason: message,
    });
  }
  return {
    ip,
    success: true,
    idempotent_success: !success && (duplicate || missing),
    message: success ? (resolveDecodedMessage(decoded) || 'success') : message,
    session: buildSessionContext(session, { token: rotatedToken || extractTokenFromDecoded(decoded) || session.token, vendor_state: decoded }),
    http_status: status,
  };
};

const interpretLogout = (status, text, decoded) => {
  if (!Boolean(decoded.result)) {
    throw errorWithCode('FAILED_PRECONDITION', 'topsec logout failed', {
      http_status: status,
      reason: resolveDecodedMessage(decoded) || 'logout failed',
    });
  }
  return {
    success: true,
    message: resolveDecodedMessage(decoded) || 'logout success',
    http_status: status,
  };
};

const encodeForm = (pairs) => pairs.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&');

const sanitizeResponse = (result = {}) => ({
  success: Boolean(result.success),
  message: pickString(result.message) || (result.success ? 'success' : ''),
  http_status: Number(result.http_status || 0),
});

const runLoginSession = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const bindings = callCtx.bindings || {};
  const allowHttp = pickBoolean(req.allow_http, req.allowHttp, bindings.allow_http, bindings.allowHttp) || false;
  const host = normalizeBaseUrl(pickString(req.host, bindings.host, bindings.baseUrl, bindings.restBaseUrl), allowHttp);
  const username = pickString(callCtx.secret?.username, bindings.user, bindings.username);
  const password = pickString(callCtx.secret?.password, bindings.password);
  const skipTlsVerify = pickBoolean(req.skip_tls_verify, req.skipTlsVerify, bindings.skipTlsVerify, bindings.tlsInsecureSkipVerify) || false;
  if (!username) throw errorWithCode('INVALID_ARGUMENT', 'username is required');
  if (!password) throw errorWithCode('UNAUTHENTICATED', 'password is required');
  const upstream = await fetchText(callCtx, `${host}${LOGIN_HTTP_PATH}`, {
    method: 'POST',
    headers: {
      ...buildEngineHeaders(bindings, callCtx.meta, req),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: encodeForm([
      ['name', username],
      ['password', encryptPassword(password)],
      ['pwdlen', String(password.length)],
    ]),
  }, { skipTlsVerify });
  const { decoded, rotatedToken } = parseSuccessfulPayload(upstream.status, upstream.text);
  const interpreted = interpretLogin(upstream.status, upstream.text, decoded, rotatedToken, {
    host,
    token: '',
    user_mark: '',
    cookie: gatherCookies(upstream.headers),
    skip_tls_verify: skipTlsVerify,
    allow_http: allowHttp,
    vendor_state: decoded,
  });
  const key = cacheIdentity(callCtx, host, username);
  sessionCache.set(key, interpreted.session);
  return { ...interpreted, key, host, username };
};

const getSession = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const bindings = callCtx.bindings || {};
  const allowHttp = pickBoolean(req.allow_http, req.allowHttp, bindings.allow_http, bindings.allowHttp) || false;
  const host = normalizeBaseUrl(pickString(req.host, bindings.host, bindings.baseUrl, bindings.restBaseUrl), allowHttp);
  const username = pickString(callCtx.secret?.username, bindings.user, bindings.username);
  if (!username) throw errorWithCode('INVALID_ARGUMENT', 'username is required');
  const key = cacheIdentity(callCtx, host, username);
  const cached = sessionCache.get(key);
  if (cached) return { key, session: cached };
  return runLoginSession(req, callCtx);
};

const updateCachedSession = (key, session) => {
  if (key && session) sessionCache.set(key, session);
  return session;
};

const runLogin = async (req = {}, ctx = {}) => {
  const result = await runLoginSession(req, ctx);
  return sanitizeResponse(result);
};

const runRefresh = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const { key, session } = await getSession(req, callCtx);
  const upstream = await fetchText(callCtx, `${session.host}${REFRESH_HTTP_PATH}?userMark=${encodeURIComponent(session.user_mark)}`, {
    method: 'POST',
    headers: {
      ...buildEngineHeaders(callCtx.bindings, callCtx.meta, req),
      'content-type': 'application/x-www-form-urlencoded',
      Cookie: session.cookie,
    },
    body: '',
  }, { skipTlsVerify: session.skip_tls_verify });
  const { decoded, rotatedToken } = parseSuccessfulPayload(upstream.status, upstream.text);
  const result = interpretRefresh(upstream.status, upstream.text, decoded, rotatedToken, session);
  updateCachedSession(key, result.session);
  return sanitizeResponse(result);
};

const runAdd = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const { key, session } = await getSession(req, callCtx);
  const ip = requireIp(req.ip);
  const upstream = await fetchText(callCtx, `${session.host}${ADD_HTTP_PATH}?userMark=${encodeURIComponent(session.user_mark)}`, {
    method: 'POST',
    headers: {
      ...buildEngineHeaders(callCtx.bindings, callCtx.meta, req),
      'content-type': 'application/x-www-form-urlencoded',
      Cookie: session.cookie,
    },
    body: encodeForm([
      ['commands[0][pf_blacklist_add_tuple][0][tuple]', `${ip},,,,,;`],
      ['token', session.token],
    ]),
  }, { skipTlsVerify: session.skip_tls_verify });
  const { decoded, rotatedToken } = parseSuccessfulPayload(upstream.status, upstream.text);
  const result = interpretOperation(upstream.status, upstream.text, decoded, rotatedToken, session, ip, 'add');
  updateCachedSession(key, result.session);
  const sanitized = sanitizeResponse(result);
  return { ip: result.ip, success: result.success, idempotent_success: result.idempotent_success, message: result.message, http_status: sanitized.http_status };
};

const runRemove = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const { key, session } = await getSession(req, callCtx);
  const ip = requireIp(req.ip);
  const upstream = await fetchText(callCtx, `${session.host}${REMOVE_HTTP_PATH}?userMark=${encodeURIComponent(session.user_mark)}`, {
    method: 'POST',
    headers: {
      ...buildEngineHeaders(callCtx.bindings, callCtx.meta, req),
      'content-type': 'application/x-www-form-urlencoded',
      Cookie: session.cookie,
    },
    body: encodeForm([
      ['commands[0][pf_blacklist_delete][0][sip]', ip],
      ['token', session.token],
    ]),
  }, { skipTlsVerify: session.skip_tls_verify });
  const { decoded, rotatedToken } = parseSuccessfulPayload(upstream.status, upstream.text);
  const result = interpretOperation(upstream.status, upstream.text, decoded, rotatedToken, session, ip, 'remove');
  updateCachedSession(key, result.session);
  const sanitized = sanitizeResponse(result);
  return { ip: result.ip, success: result.success, idempotent_success: result.idempotent_success, message: result.message, http_status: sanitized.http_status };
};

const runLogout = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const { key, session } = await getSession(req, callCtx);
  const upstream = await fetchText(callCtx, `${session.host}${LOGOUT_HTTP_PATH}?userMark=${encodeURIComponent(session.user_mark)}&token=${encodeURIComponent(session.token)}`, {
    method: 'GET',
    headers: {
      ...buildEngineHeaders(callCtx.bindings, callCtx.meta, req),
      Cookie: session.cookie,
    },
  }, { skipTlsVerify: session.skip_tls_verify });
  const { decoded } = parseSuccessfulPayload(upstream.status, upstream.text);
  const result = interpretLogout(upstream.status, upstream.text, decoded);
  sessionCache.delete(key);
  return sanitizeResponse(result);
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_LOGIN_PATH]: async (req) => runLogin(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_REFRESH_PATH]: async (req) => runRefresh(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_ADD_PATH]: async (req) => runAdd(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_REMOVE_PATH]: async (req) => runRemove(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_LOGOUT_PATH]: async (req) => runLogout(req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_LOGIN_FULL]: (ctx = {}) => runLogin(ctx.request ?? ctx.req ?? {}, ctx),
  [METHOD_REFRESH_FULL]: (ctx = {}) => runRefresh(ctx.request ?? ctx.req ?? {}, ctx),
  [METHOD_ADD_FULL]: (ctx = {}) => runAdd(ctx.request ?? ctx.req ?? {}, ctx),
  [METHOD_REMOVE_FULL]: (ctx = {}) => runRemove(ctx.request ?? ctx.req ?? {}, ctx),
  [METHOD_LOGOUT_FULL]: (ctx = {}) => runLogout(ctx.request ?? ctx.req ?? {}, ctx),
};

export const _test = {
  base64Decode,
  base64Encode,
  buildEngineHeaders,
  buildSessionContext,
  buildTlsOptions,
  cacheIdentity,
  decodeTopSecBody,
  encodeForm,
  encryptPassword,
  ensureSession,
  errorWithCode,
  extractTokenFromDecoded,
  fetchText,
  gatherCookies,
  grpcCodeFor,
  hasOwn,
  interpretLogin,
  interpretLogout,
  interpretOperation,
  interpretRefresh,
  insecureTlsDispatcher,
  isObject,
  isValidIP,
  makeTimeoutSignal,
  mapHttpStatusToCode,
  normalizeBaseUrl,
  parseSuccessfulPayload,
  pickBoolean,
  pickString,
  requireIp,
  resolveCallContext,
  resolveDecodedMessage,
  resolveTimeoutMs,
  sessionCache,
  tryParseJson,
  unwrapScalar,
  zeroPadBuffer,
};
