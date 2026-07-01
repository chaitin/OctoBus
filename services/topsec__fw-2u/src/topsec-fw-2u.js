import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const METHOD_LOGIN_PATH = '/TopSec_FW_2U.TopSec_FW_2U/Login';
export const METHOD_ACTIVATE_PATH = '/TopSec_FW_2U.TopSec_FW_2U/ActivatePermission';
export const METHOD_ADD_PATH = '/TopSec_FW_2U.TopSec_FW_2U/AddBlacklistIP';
export const METHOD_DELETE_PATH = '/TopSec_FW_2U.TopSec_FW_2U/DeleteBlacklistIP';
export const METHOD_LOGOUT_PATH = '/TopSec_FW_2U.TopSec_FW_2U/Logout';

export const METHOD_LOGIN_FULL = 'TopSec_FW_2U.TopSec_FW_2U/Login';
export const METHOD_ACTIVATE_FULL = 'TopSec_FW_2U.TopSec_FW_2U/ActivatePermission';
export const METHOD_ADD_FULL = 'TopSec_FW_2U.TopSec_FW_2U/AddBlacklistIP';
export const METHOD_DELETE_FULL = 'TopSec_FW_2U.TopSec_FW_2U/DeleteBlacklistIP';
export const METHOD_LOGOUT_FULL = 'TopSec_FW_2U.TopSec_FW_2U/Logout';

export const LOGIN_HTTP_PATH = '/home/login/addNoCode/';
export const ACTIVATE_HTTP_PATH = '/home/index/';
export const ADD_HTTP_PATH = '/home/default/blackListSpread/addTuple/';
export const DELETE_HTTP_PATH = '/home/default/blackListSpread/deleteLots/';
export const LOGOUT_HTTP_PATH = '/home/index/logout/';
export const AES_KEY_TEXT = 'ngfwrestapilogin';
export const THINK_LANGUAGE_COOKIE = 'think_language=zh-cn';
export const DEFAULT_TIMEOUT_MS = 5000;

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message, details) => {
  const finalMessage = details === undefined ? String(message || '') : JSON.stringify({ message, ...(details || {}) });
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${finalMessage}`);
  err.legacyCode = code;
  if (details !== undefined) err.details = details;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const readString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return '';
  return String(raw);
};

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

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

const normalizeHost = (value) => {
  const host = readString(value).trim();
  if (!/^https?:\/\//i.test(host)) {
    throw errorWithCode('INVALID_ARGUMENT', 'host must be an absolute http/https URL');
  }
  return host.replace(/\/+$/, '');
};

const resolveHost = (req = {}, ctx = {}) => {
  const candidates = [
    req.host,
    req.baseUrl,
    req.base_url,
    ctx.bindings?.host,
    ctx.bindings?.restBaseUrl,
    ctx.bindings?.baseUrl,
  ];
  for (const candidate of candidates) {
    const text = readString(candidate).trim();
    if (!text) continue;
    return normalizeHost(text);
  }
  throw errorWithCode('INVALID_ARGUMENT', 'host must be an absolute http/https URL');
};

const requireNonEmpty = (value, name) => {
  const text = readString(value).trim();
  if (!text) throw errorWithCode('INVALID_ARGUMENT', `${name} is required`);
  return text;
};

const requireSecretNonEmpty = (value, name) => {
  const text = readString(value).trim();
  if (!text) throw errorWithCode('UNAUTHENTICATED', `${name} is required`);
  return text;
};

const resolveLoginUsername = (req = {}, ctx = {}) => requireNonEmpty(firstDefined(
  ctx.secret?.username,
  ctx.bindings?.username,
  ctx.bindings?.user,
  ctx.bindings?.name,
), 'username');

const resolveLoginPassword = (req = {}, ctx = {}) => requireSecretNonEmpty(firstDefined(
  ctx.secret?.password,
  ctx.bindings?.password,
), 'password');

const isIPv4 = (value) => {
  const parts = String(value).split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return false;
    if (part.length > 1 && part.charAt(0) === '0') return false;
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) return false;
  }
  return true;
};

const isIPv6 = (value) => {
  const text = String(value);
  if (!text.includes(':')) return false;
  if ((text.match(/::/g) || []).length > 1) return false;
  if (/::ffff:\d{1,3}(?:\.\d{1,3}){3}$/i.test(text)) {
    return isIPv4(text.substring(text.lastIndexOf(':') + 1));
  }
  if (!/^[0-9a-fA-F:.]+$/.test(text)) return false;
  return true;
};

const unwrapList = (value) => {
  const raw = unwrapScalar(value);
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(raw.values)) return raw.values;
  return raw;
};

const readIpList = (req = {}) => {
  const raw = unwrapList(firstDefined(req.ips, req.ip_addresses, req.ipAddresses, req.ip_list, req.ipList));
  if (!Array.isArray(raw) || raw.length === 0) {
    throw errorWithCode('INVALID_ARGUMENT', 'ips is required');
  }
  return raw.map((item, index) => {
    const ip = readString(item).trim();
    if (!ip) throw errorWithCode('INVALID_ARGUMENT', `ips[${index}] is blank`);
    if (!isIPv4(ip) && !isIPv6(ip)) {
      throw errorWithCode('INVALID_ARGUMENT', `ips[${index}] must be a valid IPv4 or IPv6 address`);
    }
    return ip;
  });
};

const optionalUint32 = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return Math.trunc(num);
};

const readTimeoutMs = (ctx = {}) => optionalUint32(firstDefined(
  ctx.req?.timeoutMs,
  ctx.req?.timeout_ms,
  ctx.bindings?.timeoutMs,
  ctx.bindings?.timeout_ms,
  ctx.limits?.timeoutMs,
)) ?? DEFAULT_TIMEOUT_MS;

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

const insecureTlsDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

const buildTlsOptions = (ctx = {}) => {
  const bindings = ctx.bindings || {};
  if (toBoolean(bindings.skipTlsVerify) || toBoolean(bindings.tlsInsecureSkipVerify) || toBoolean(bindings.insecureSkipVerify)) {
    return { dispatcher: insecureTlsDispatcher };
  }
  return {};
};

const makeTimeoutSignal = (timeoutMs) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeoutId) };
};

const utf8Encode = (input) => Buffer.from(String(input || ''), 'utf8');
const utf8DecodeStrict = (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

const base64EncodeBytes = (bytes) => Buffer.from(bytes).toString('base64');
const base64DecodeToBytes = (text) => new Uint8Array(Buffer.from(String(text || '').replace(/\s+/g, ''), 'base64'));

const tryParseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const tryDecodeBase64Json = (payload) => {
  try {
    const decoded = utf8DecodeStrict(base64DecodeToBytes(payload));
    const parsed = tryParseJson(decoded);
    if (parsed === undefined) return null;
    return { decoded, parsed };
  } catch {
    return null;
  }
};

const gatherCookies = (headers) => {
  if (!headers) return '';
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie().map((item) => String(item).split(';')[0].trim()).filter(Boolean).join('; ');
  }
  if (typeof headers.raw === 'function') {
    const raw = headers.raw();
    if (raw && Array.isArray(raw['set-cookie'])) {
      return raw['set-cookie'].map((item) => String(item).split(';')[0].trim()).filter(Boolean).join('; ');
    }
  }
  const direct = typeof headers.get === 'function' ? headers.get('set-cookie') : headers['set-cookie'];
  if (!direct) return '';
  return String(direct)
    .split(/,(?=[^;=]+?=)/)
    .map((item) => String(item).split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
};

const normalizeCookie = (cookie) => {
  const parts = String(cookie || '').split(';').map((item) => item.trim()).filter(Boolean);
  const seen = new Set();
  const result = [];
  for (const part of parts) {
    const key = part.split('=')[0].trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(part);
  }
  if (!seen.has('think_language')) result.push(THINK_LANGUAGE_COOKIE);
  return result.join('; ');
};

const decodeTopSecPayload = (rawBody) => {
  const trimmed = String(rawBody || '').trim();
  if (!trimmed) return { parsed: undefined, rotatedToken: '', decodedBody: '' };
  const directJson = tryParseJson(trimmed);
  if (directJson !== undefined) return { parsed: directJson, rotatedToken: '', decodedBody: trimmed };
  if (trimmed.startsWith('?')) {
    const fixedToken = trimmed.slice(1, 17);
    const fixedPayload = trimmed.slice(17);
    if (fixedToken && fixedPayload) {
      const decodedFixed = tryDecodeBase64Json(fixedPayload);
      if (decodedFixed) return { parsed: decodedFixed.parsed, rotatedToken: fixedToken, decodedBody: decodedFixed.decoded };
    }
    const remainder = trimmed.slice(1);
    for (let index = 1; index <= remainder.length; index += 1) {
      const candidateToken = remainder.slice(0, index);
      const decoded = tryDecodeBase64Json(remainder.slice(index));
      if (decoded) return { parsed: decoded.parsed, rotatedToken: candidateToken, decodedBody: decoded.decoded };
    }
  }
  const decoded = tryDecodeBase64Json(trimmed);
  if (decoded) return { parsed: decoded.parsed, rotatedToken: '', decodedBody: decoded.decoded };
  return { parsed: undefined, rotatedToken: '', decodedBody: '' };
};

const pickFirstToken = (payload) => {
  if (Array.isArray(payload?.tokens) && payload.tokens.length > 0) return readString(payload.tokens[0]).trim();
  if (Array.isArray(payload?.data?.tokens) && payload.data.tokens.length > 0) return readString(payload.data.tokens[0]).trim();
  return '';
};

const buildSessionFromLogin = (payload, headers, rotatedToken) => {
  if (!payload || typeof payload !== 'object') return null;
  const token = rotatedToken || pickFirstToken(payload);
  const userMark = readString(firstDefined(payload?.data?.authid, payload?.data?.user_mark, payload?.data?.userMark)).trim();
  const secret = readString(firstDefined(payload?.secret, payload?.data?.secret)).trim();
  const cookie = normalizeCookie(gatherCookies(headers));
  if (!token || !userMark || !cookie) return null;
  return { token, user_mark: userMark, cookie, secret };
};

const buildRefreshedSession = (session, payload, rotatedToken) => {
  const token = rotatedToken || readString(firstDefined(payload?.token, payload?.data?.token)).trim() || session.token;
  const userMark = readString(firstDefined(payload?.data?.authid, payload?.data?.user_mark, payload?.data?.userMark)).trim() || session.user_mark || session.userMark;
  const secret = readString(firstDefined(payload?.secret, payload?.data?.secret)).trim() || session.secret;
  return { token, user_mark: userMark, cookie: session.cookie, secret };
};

const sessionUserMark = (session = {}) => readString(firstDefined(session.user_mark, session.userMark)).trim();

const encodeForm = (pairs) => pairs.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&');

const buildUrl = (baseUrl, path, query = {}) => {
  const pairs = [];
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue;
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return `${baseUrl}${path}${pairs.length ? `?${pairs.join('&')}` : ''}`;
};

const addTraceHeaders = (headers, meta) => {
  const result = { ...(headers || {}) };
  const instanceId = readString(firstDefined(meta?.instance_id, meta?.instanceId)).trim();
  const requestId = readString(firstDefined(meta?.request_id, meta?.requestId)).trim();
  if (instanceId) result['x-engine-instance'] = instanceId;
  if (requestId) result['x-request-id'] = requestId;
  return result;
};

const refererForUserMark = (baseUrl, userMark) => `${baseUrl}${ACTIVATE_HTTP_PATH}?userMark=${encodeURIComponent(userMark)}`;

const readResponseBodyText = async (response) => {
  if (response && typeof response.arrayBuffer === 'function') {
    try {
      const bytes = new Uint8Array(await response.arrayBuffer());
      return utf8DecodeStrict(bytes);
    } catch {
      throw errorWithCode('UNKNOWN', 'response body is not valid UTF-8');
    }
  }
  if (response && typeof response.text === 'function') {
    try {
      return String(await response.text());
    } catch {
      throw errorWithCode('UNKNOWN', 'response body is not valid UTF-8');
    }
  }
  return '';
};

const fetchText = async (ctx, url, init = {}) => {
  const timeout = makeTimeoutSignal(readTimeoutMs(ctx));
  let response;
  try {
    response = await fetch(url, {
      ...init,
      signal: timeout.signal,
      ...buildTlsOptions(ctx),
    });
  } catch (error) {
    const reason = error?.cause?.message || error?.message || 'fetch failed';
    throw errorWithCode('UNAVAILABLE', reason);
  } finally {
    timeout.clear();
  }
  return {
    statusCode: Number(response?.status) || 0,
    rawBody: await readResponseBodyText(response),
    headers: response?.headers || {},
  };
};

const encryptPassword = (plaintext) => {
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(AES_KEY_TEXT, 'utf8'), Buffer.from(AES_KEY_TEXT, 'utf8'));
  cipher.setAutoPadding(false);
  const input = Buffer.from(String(plaintext || ''), 'utf8');
  const padLength = (16 - (input.length % 16)) % 16;
  const padded = padLength === 0 ? input : Buffer.concat([input, Buffer.alloc(padLength)]);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64');
};

const buildLoginForm = (username, password) => encodeForm([
  ['name', username],
  ['password', encryptPassword(password)],
  ['pwdlen', String(password.length)],
]);

const buildActivateBody = () => '';

const buildAddBody = (ips, token) => encodeForm([
  ['commands[0][pf_blacklist_add_tuple][0][tuple]', ips.map((ip) => `${ip},,,,,;`).join('')],
  ['token', token],
]);

const buildDeleteBody = (ips, token) => {
  const pairs = ips.map((ip, index) => [`commands[${index}][pf_blacklist_delete][0][sip]`, ip]);
  pairs.push(['token', token]);
  return encodeForm(pairs);
};

const buildBaseResponse = (statusCode, rawBody) => ({
  status_code: statusCode,
  success: statusCode >= 200 && statusCode <= 299,
  message: statusCode >= 200 && statusCode <= 299 ? 'success' : `upstream http ${statusCode}`,
});

const sessionCache = new Map();

const cacheIdentity = (ctx = {}, host = '', username = '') => {
  const serviceId = readString(firstDefined(ctx.serviceId, ctx.service_id, ctx.meta?.service_id, ctx.meta?.serviceId)).trim() || 'topsec__fw-2u';
  const instanceId = readString(firstDefined(ctx.instanceId, ctx.instance_id, ctx.meta?.instance_id, ctx.meta?.instanceId, ctx.workdir)).trim() || 'default';
  return JSON.stringify([serviceId, instanceId, host, username]);
};

const performLogin = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const host = resolveHost(req, callCtx);
  const username = resolveLoginUsername(req, callCtx);
  const password = resolveLoginPassword(req, callCtx);
  const response = await fetchText(callCtx, buildUrl(host, LOGIN_HTTP_PATH), {
    method: 'POST',
    headers: addTraceHeaders({ 'content-type': 'application/x-www-form-urlencoded' }, callCtx.meta),
    body: buildLoginForm(username, password),
  });
  const decoded = decodeTopSecPayload(response.rawBody);
  const session = buildSessionFromLogin(decoded.parsed, response.headers, decoded.rotatedToken);
  if (!session) throw errorWithCode('UNAUTHENTICATED', 'login response did not contain a usable session');
  const key = cacheIdentity(callCtx, host, username);
  sessionCache.set(key, session);
  return { host, username, key, session, statusCode: response.statusCode };
};

const getSession = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const host = resolveHost(req, callCtx);
  const username = resolveLoginUsername(req, callCtx);
  const key = cacheIdentity(callCtx, host, username);
  const cached = sessionCache.get(key);
  if (cached) return { host, username, key, session: cached };
  return performLogin(req, callCtx);
};

const updateCachedSession = (key, session) => {
  if (key && session) sessionCache.set(key, session);
  return session;
};

const callLogin = async (req = {}, ctx = {}) => {
  const login = await performLogin(req, ctx);
  return buildBaseResponse(login.statusCode);
};

const callActivate = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const { host, session } = await getSession(req, callCtx);
  const userMark = sessionUserMark(session);
  const response = await fetchText(callCtx, buildUrl(host, ACTIVATE_HTTP_PATH, { userMark }), {
    method: 'POST',
    headers: addTraceHeaders({
      'content-type': 'application/x-www-form-urlencoded',
      Cookie: session.cookie,
      Referer: refererForUserMark(host, userMark),
    }, callCtx.meta),
    body: buildActivateBody(),
  });
  return buildBaseResponse(response.statusCode);
};

const callAdd = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const ips = readIpList(req);
  const { host, session, key } = await getSession(req, callCtx);
  const userMark = sessionUserMark(session);
  const response = await fetchText(callCtx, buildUrl(host, ADD_HTTP_PATH, { userMark }), {
    method: 'POST',
    headers: addTraceHeaders({
      'content-type': 'application/x-www-form-urlencoded',
      Cookie: session.cookie,
      Referer: refererForUserMark(host, userMark),
    }, callCtx.meta),
    body: buildAddBody(ips, session.token),
  });
  const decoded = decodeTopSecPayload(response.rawBody);
  updateCachedSession(key, buildRefreshedSession(session, decoded.parsed, decoded.rotatedToken));
  return buildBaseResponse(response.statusCode);
};

const callDelete = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const ips = readIpList(req);
  const { host, session, key } = await getSession(req, callCtx);
  const userMark = sessionUserMark(session);
  const response = await fetchText(callCtx, buildUrl(host, DELETE_HTTP_PATH, { userMark }), {
    method: 'POST',
    headers: addTraceHeaders({
      'content-type': 'application/x-www-form-urlencoded',
      Cookie: session.cookie,
      Referer: refererForUserMark(host, userMark),
    }, callCtx.meta),
    body: buildDeleteBody(ips, session.token),
  });
  const decoded = decodeTopSecPayload(response.rawBody);
  updateCachedSession(key, buildRefreshedSession(session, decoded.parsed, decoded.rotatedToken));
  return buildBaseResponse(response.statusCode);
};

const callLogout = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const { host, session, key } = await getSession(req, callCtx);
  const userMark = sessionUserMark(session);
  const response = await fetchText(callCtx, buildUrl(host, LOGOUT_HTTP_PATH, { userMark, token: session.token }), {
    method: 'GET',
    headers: addTraceHeaders({
      Cookie: session.cookie,
      Referer: refererForUserMark(host, userMark),
    }, callCtx.meta),
  });
  sessionCache.delete(key);
  return buildBaseResponse(response.statusCode);
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_LOGIN_PATH]: async (req) => callLogin(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_ACTIVATE_PATH]: async (req) => callActivate(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_ADD_PATH]: async (req) => callAdd(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_DELETE_PATH]: async (req) => callDelete(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_LOGOUT_PATH]: async (req) => callLogout(req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_LOGIN_FULL]: (ctx = {}) => callLogin(ctx.request ?? ctx.req ?? {}, ctx),
  [METHOD_ACTIVATE_FULL]: (ctx = {}) => callActivate(ctx.request ?? ctx.req ?? {}, ctx),
  [METHOD_ADD_FULL]: (ctx = {}) => callAdd(ctx.request ?? ctx.req ?? {}, ctx),
  [METHOD_DELETE_FULL]: (ctx = {}) => callDelete(ctx.request ?? ctx.req ?? {}, ctx),
  [METHOD_LOGOUT_FULL]: (ctx = {}) => callLogout(ctx.request ?? ctx.req ?? {}, ctx),
};

export const _test = {
  addTraceHeaders,
  base64DecodeToBytes,
  base64EncodeBytes,
  buildActivateBody,
  buildAddBody,
  buildBaseResponse,
  buildDeleteBody,
  buildLoginForm,
  buildRefreshedSession,
  buildSessionFromLogin,
  buildTlsOptions,
  buildUrl,
  cacheIdentity,
  decodeTopSecPayload,
  encryptPassword,
  errorWithCode,
  fetchText,
  firstDefined,
  gatherCookies,
  grpcCodeFor,
  hasOwn,
  insecureTlsDispatcher,
  isIPv4,
  isIPv6,
  makeTimeoutSignal,
  normalizeCookie,
  normalizeHost,
  pickFirstToken,
  readIpList,
  readResponseBodyText,
  readString,
  readTimeoutMs,
  refererForUserMark,
  sessionCache,
  sessionUserMark,
  resolveCallContext,
  resolveHost,
  resolveLoginPassword,
  resolveLoginUsername,
  toBoolean,
  tryDecodeBase64Json,
  tryParseJson,
  unwrapList,
  unwrapScalar,
};
