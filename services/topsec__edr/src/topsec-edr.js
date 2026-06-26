// TopSec EDR (天融信终端威胁防御系统) service implementation for OctoBus.
//
// EDR API authentication flow:
//   1. POST /auth/token with body { encryptStr: <AES-256-CBC-PKCS7 base64> }
//      The encryptStr contains AES-encrypted JSON { username, password }
//   2. Decrypt the response encryptStr using AES-256-CBC-PKCS7 to obtain JWT token + nonce/stime
//   3. Compute sign = MD5(token + stime + nonce + "dO(QK*EX@cTG")
//   4. Each API request includes nonce, stime, sign, token as query parameters
//
// AES encryption details (extracted from EDR frontend interceptor JS):
//   Key: 6ZlcPK5xfRrd7W1oyIqVgiHGbamhBAJ3 (32 bytes, AES-256-CBC)
//   IV:  6ZlcPK5xfRrd7W1o (first 16 bytes of key)
//   Padding: PKCS7 (standard)
//   Encrypt output: ciphertext → hex uppercase → convert hex to base64
//   Decrypt input:  base64 → parse → re-encode as base64 → AES decrypt → UTF8
//
// Signed request flow:
//   1. nonce = 8 random digits
//   2. stime = current Unix timestamp (10 digits)
//   3. sign = MD5(token + stime + nonce + "dO(QK*EX@cTG")

import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

// --- Constants ---
export const METHOD_LOGIN_PATH = '/TopSec_EDR.TopSec_EDR/Login';
export const METHOD_LIST_CLIENTS_PATH = '/TopSec_EDR.TopSec_EDR/ListClients';
export const METHOD_GET_CLIENT_PATH = '/TopSec_EDR.TopSec_EDR/GetClient';
export const METHOD_GET_ALERT_STATS_PATH = '/TopSec_EDR.TopSec_EDR/GetAlertStats';
export const METHOD_GET_SYSTEM_VIEW_PATH = '/TopSec_EDR.TopSec_EDR/GetSystemView';
export const METHOD_GET_SYSTEM_INFO_PATH = '/TopSec_EDR.TopSec_EDR/GetSystemInfo';

export const METHOD_LOGIN_FULL = 'TopSec_EDR.TopSec_EDR/Login';
export const METHOD_LIST_CLIENTS_FULL = 'TopSec_EDR.TopSec_EDR/ListClients';
export const METHOD_GET_CLIENT_FULL = 'TopSec_EDR.TopSec_EDR/GetClient';
export const METHOD_GET_ALERT_STATS_FULL = 'TopSec_EDR.TopSec_EDR/GetAlertStats';
export const METHOD_GET_SYSTEM_VIEW_FULL = 'TopSec_EDR.TopSec_EDR/GetSystemView';
export const METHOD_GET_SYSTEM_INFO_FULL = 'TopSec_EDR.TopSec_EDR/GetSystemInfo';

export const LOGIN_HTTP_PATH = '/auth/token';
// EDR uses /api/v1 as SERVER_URL base for all API endpoints (confirmed by live testing)
// The frontend interceptor adds /api/v1 prefix + nonce/stime/sign query params for GET requests
// Actual endpoints (verified against live EDR instance):
export const LIST_CLIENTS_HTTP_PATH = '/api/v1/getCustomList?collection=terminalManager';
export const GET_CLIENT_HTTP_PATH = '/api/v1/getCustomList?collection=terminalManager';
export const GET_ALERT_STATS_HTTP_PATH = '/api/v1/audit/stat';
export const GET_SYSTEM_VIEW_HTTP_PATH = '/api/v1/view/system_view';
export const GET_SYSTEM_INFO_HTTP_PATH = '/api/v1/view/system_view';

// AES-256-CBC key and IV (extracted from EDR frontend interceptor JavaScript)
// Key: full 32-byte string used as AES-256-CBC key
// IV:  first 16 bytes of the key (CryptoJS uses first 4 words as IV when key and iv params are same WordArray)
export const AES_KEY_TEXT = '6ZlcPK5xfRrd7W1oyIqVgiHGbamhBAJ3';
export const AES_IV_TEXT = '6ZlcPK5xfRrd7W1o';

export const DEFAULT_TIMEOUT_MS = 5000;

// --- Error handling ---
const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message, details) => {
  const finalMessage = details === undefined
    ? String(message || '')
    : JSON.stringify({ message, ...(details || {}) });
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${finalMessage}`);
  err.legacyCode = code;
  if (details !== undefined) err.details = details;
  return err;
};

// --- Utility helpers ---
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

const readInt64 = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return 0;
  const num = Number(raw);
  return Number.isFinite(num) ? Math.trunc(num) : 0;
};

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const mergedBindings = (ctx = {}) => ({
  ...(ctx.config ?? {}),
  ...(ctx.secret ?? {}),
  ...(ctx.bindings ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
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
    ctx.bindings?.endpoint,
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

const resolveLoginUsername = (req = {}, ctx = {}) => requireNonEmpty(firstDefined(
  req.username,
  req.user,
  req.name,
  ctx.bindings?.username,
  ctx.bindings?.user,
  ctx.bindings?.name,
), 'username');

const resolveLoginPassword = (req = {}, ctx = {}) => requireNonEmpty(firstDefined(
  req.password,
  ctx.bindings?.password,
), 'password');

const optionalUint32 = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return Math.trunc(num);
};

const optionalInt64 = (value, defaultVal) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return defaultVal;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return defaultVal;
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

const buildTlsOptions = (ctx = {}) => {
  const bindings = ctx.bindings || {};
  // EDR typically uses self-signed certs, default to skip verification
  if (toBoolean(bindings.skipTlsVerify) || toBoolean(bindings.tlsInsecureSkipVerify) || toBoolean(bindings.insecureSkipVerify)) {
    return {
      skipTlsVerify: true,
      tlsInsecureSkipVerify: true,
      insecureSkipVerify: true,
    };
  }
  return {};
};

// --- Crypto helpers ---
const utf8Encode = (input) => Buffer.from(String(input || ''), 'utf8');
const utf8DecodeStrict = (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

/**
 * AES-256-CBC encryption matching EDR frontend interceptor behavior.
 * Key: full 32-byte string (AES-256-CBC)
 * IV:  first 16 bytes of key
 * Padding: PKCS7 (Node.js default)
 * Output:  ciphertext → hex uppercase → hex bytes → base64
 *
 * Matches frontend: aes().Encrypt = plaintext → CryptoJS.AES.encrypt →
 *   .ciphertext.toString().toUpperCase() → CryptoJS.enc.Base64.stringify(CryptoJS.enc.Hex.parse(hex))
 */
export const encryptAes256Cbc = (plaintext) => {
  const key = Buffer.from(AES_KEY_TEXT, 'utf8');
  const iv = Buffer.from(AES_IV_TEXT, 'utf8');
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  // PKCS7 padding is the default in Node.js crypto (setAutoPadding(true))
  const encrypted = Buffer.concat([cipher.update(String(plaintext || ''), 'utf8'), cipher.final()]);
  // EDR frontend: ciphertext.toString().toUpperCase() → hex uppercase
  const hex = encrypted.toString('hex').toUpperCase();
  // EDR frontend: CryptoJS.enc.Base64.stringify(CryptoJS.enc.Hex.parse(hex)) → base64
  return Buffer.from(hex, 'hex').toString('base64');
};

/**
 * AES-256-CBC decryption matching EDR frontend interceptor behavior.
 * Input:  base64 string (the encryptStr field from API response)
 * Decrypt: base64 → parse as raw bytes → re-encode as base64 for CryptoJS compat → AES decrypt
 */
export const decryptAes256Cbc = (ciphertextB64) => {
  const key = Buffer.from(AES_KEY_TEXT, 'utf8');
  const iv = Buffer.from(AES_IV_TEXT, 'utf8');
  // EDR frontend: CryptoJS.enc.Base64.parse(input) → then CryptoJS.enc.Base64.stringify(parsed)
  // This is effectively a no-op for the base64 content, but we replicate it faithfully
  const parsed = Buffer.from(String(ciphertextB64 || '').replace(/\s+/g, ''), 'base64');
  const reB64 = parsed.toString('base64');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const decrypted = Buffer.concat([decipher.update(reB64, 'base64'), decipher.final()]);
  return decrypted.toString('utf8');
};

/**
 * MD5 signature for signed API requests.
 * EDR frontend: sign = MD5(token + stime + nonce + spctxt)
 * Default spctxt (salt): "dO(QK*EX@cTG"
 */
export const SIGN_SALT = 'dO(QK*EX@cTG';
export const computeSign = (nonce, stime, token, salt = SIGN_SALT) => {
  const raw = String(token || '') + String(stime || '') + String(nonce || '') + String(salt || '');
  return crypto.createHash('md5').update(raw, 'utf8').digest('hex');
};

// --- HTTP helpers ---
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

const buildUrl = (baseUrl, path, query = {}) => {
  const pairs = [];
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue;
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  const separator = path.includes('?') ? '&' : '?';
  return `${baseUrl}${path}${pairs.length ? `${separator}${pairs.join('&')}` : ''}`;
};

const addTraceHeaders = (headers, meta) => {
  const result = { ...(headers || {}) };
  const instanceId = readString(firstDefined(meta?.instance_id, meta?.instanceId)).trim();
  const requestId = readString(firstDefined(meta?.request_id, meta?.requestId)).trim();
  if (instanceId) result['x-engine-instance'] = instanceId;
  if (requestId) result['x-request-id'] = requestId;
  return result;
};

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
  let response;
  try {
    response = await fetch(url, {
      ...init,
      timeoutMs: readTimeoutMs(ctx),
      ...buildTlsOptions(ctx),
    });
  } catch (error) {
    const reason = error?.cause?.message || error?.message || 'fetch failed';
    throw errorWithCode('UNAVAILABLE', reason);
  }
  return {
    statusCode: Number(response?.status) || 0,
    rawBody: await readResponseBodyText(response),
    headers: response?.headers || {},
  };
};

// --- Session handling ---
const readSession = (req = {}) => {
  const session = req.session;
  if (!session || typeof session !== 'object') {
    throw errorWithCode('INVALID_ARGUMENT', 'session is required');
  }
  const token = requireNonEmpty(session.token, 'session.token');
  // nonce/stime/sign are generated fresh per request, not stored in session
  return { token };
};

const tryParseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/**
 * Decrypt EDR API response.
 * ALL EDR API responses (not just login) are encrypted with encryptStr.
 * The interceptor handles this: if response.body has encryptStr, decrypt it.
 * For /auth/token and /auth/login_captcha, the same key is used as for requests.
 * For other endpoints, the same key is also used (the interceptor's aes method
 * always uses getSecretKey() which returns the 32-byte key).
 */
const decryptResponseBody = (rawBody) => {
  const parsed = tryParseJson(rawBody);
  if (!parsed || typeof parsed !== 'object') return parsed;
  const encryptStr = readString(parsed.encryptStr).trim();
  if (!encryptStr) return parsed;
  try {
    const decrypted = decryptAes256Cbc(encryptStr);
    const decryptedParsed = tryParseJson(decrypted);
    return decryptedParsed || parsed;
  } catch {
    return parsed;
  }
};

/**
 * Parse the login response.
 * The EDR login endpoint returns:
 *   { "encryptStr": "<base64 AES-encrypted payload>" }
 * The encrypted payload, when decrypted, contains a JSON object with:
 *   { "token": "<jwt>", "nonce": "<nonce>", "stime": "<timestamp>" }
 */
const parseLoginResponse = (rawBody, responseHeaders) => {
  const parsed = tryParseJson(rawBody);
  if (!parsed || typeof parsed !== 'object') {
    // If the response is not JSON, try to decrypt it directly
    const decrypted = decryptAes256Cbc(rawBody);
    const decryptedParsed = tryParseJson(decrypted);
    if (!decryptedParsed) {
      throw errorWithCode('UNKNOWN', 'login response could not be parsed', { rawBody });
    }
    return buildSessionFromDecrypted(decryptedParsed, responseHeaders);
  }

  // Standard case: response has encryptStr field
  const encryptStr = readString(parsed.encryptStr).trim();
  if (encryptStr) {
    const decrypted = decryptAes256Cbc(encryptStr);
    const decryptedParsed = tryParseJson(decrypted);
    if (!decryptedParsed) {
      throw errorWithCode('UNKNOWN', 'login encryptStr could not be decrypted', { encryptStr });
    }
    return buildSessionFromDecrypted(decryptedParsed, responseHeaders);
  }

  // Fallback: token might be directly in the response
  const token = readString(parsed.token).trim();
  if (token) {
    const nonce = readString(parsed.nonce).trim();
    const stime = readString(parsed.stime).trim();
    const sign = computeSign(nonce, stime, token);
    const cookie = gatherCookies(responseHeaders);
    return { token, nonce, stime, sign, cookie };
  }

  throw errorWithCode('UNKNOWN', 'login response missing encryptStr or token', parsed);
};

const buildSessionFromDecrypted = (decrypted, responseHeaders) => {
  const token = readString(decrypted.token).trim();
  const nonce = readString(decrypted.nonce).trim();
  const stime = readString(decrypted.stime).trim();
  const sign = computeSign(nonce, stime, token);
  const cookie = gatherCookies(responseHeaders);
  if (!token) {
    throw errorWithCode('UNKNOWN', 'decrypted login response missing token', decrypted);
  }
  return { token, nonce, stime, sign, cookie };
};

// --- Build signed request query params ---
// EDR frontend: nonce = 8 random digits, stime = current Unix timestamp (10 digits)
// sign = MD5(token + stime + nonce + "dO(QK*EX@cTG")
// Each request generates fresh nonce/stime (not reused from login)
const buildSignedQuery = (session) => {
  const nonce = String(Math.random()).slice(2, 10); // 8 random digits
  const stime = Math.floor(Date.now() / 1000).toString().slice(0, 10); // Unix timestamp
  const sign = computeSign(nonce, stime, session.token);
  return { nonce, stime, sign };
};

// --- Build request headers with session token ---
// EDR frontend uses Angular's tokenService which adds token via HTTP interceptor.
// We replicate this by sending the token as both a cookie and a header.
const buildAuthHeaders = (session, extraHeaders = {}, meta = {}) => {
  const headers = {
    ...extraHeaders,
  };
  if (session.cookie) {
    headers['Cookie'] = session.cookie;
  }
  // EDR Angular tokenService adds token to requests
  headers['Authorization'] = session.token;
  return addTraceHeaders(headers, meta);
};

// --- Password hashing ---
// EDR frontend: setPassword = 3x MD5 + 3x SHA256, then toUpperCase
// Used for login and password change/verify operations
export const hashPassword = (plainPassword) => {
  let t;
  const trimmed = plainPassword.trim();
  for (let n = 0; n < 6; n++) {
    t = n < 3
      ? crypto.createHash('md5').update(t || trimmed, 'utf8').digest('hex')
      : crypto.createHash('sha256').update(t, 'utf8').digest('hex');
  }
  return t.toUpperCase();
};

// --- Login ---
const buildLoginBody = (username, password) => {
  const payload = {
    'ng-cloud': true,
    username,
    password: hashPassword(password),
    captcha: '',
    tenant_id: '',
    captcha_id: '',
  };
  const encrypted = encryptAes256Cbc(JSON.stringify(payload));
  return JSON.stringify({ encryptStr: encrypted });
};

const callLogin = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const host = resolveHost(req, callCtx);
  const username = resolveLoginUsername(req, callCtx);
  const password = resolveLoginPassword(req, callCtx);
  const response = await fetchText(callCtx, buildUrl(host, LOGIN_HTTP_PATH), {
    method: 'POST',
    headers: addTraceHeaders({
      'content-type': 'application/json',
      'Accept': 'application/json',
    }, callCtx.meta),
    body: buildLoginBody(username, password),
  });
  const session = parseLoginResponse(response.rawBody, response.headers);
  return {
    status_code: response.statusCode,
    raw_body: response.rawBody,
    session: {
      token: session.token,
      nonce: session.nonce,
      stime: session.stime,
      sign: session.sign,
    },
  };
};

// --- ListClients ---
// EDR uses POST to /api/v1/getCustomList?collection=terminalManager with encrypted body
const callListClients = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const host = resolveHost(req, callCtx);
  const session = readSession(req);
  const query = buildSignedQuery(session);

  // Build encrypted request body for getCustomList
  const bodyPayload = {};
  const encrypted = encryptAes256Cbc(JSON.stringify(bodyPayload));

  const response = await fetchText(callCtx, buildUrl(host, LIST_CLIENTS_HTTP_PATH, query), {
    method: 'POST',
    headers: buildAuthHeaders(session, {
      'content-type': 'application/json',
      'Accept': 'application/json',
    }, callCtx.meta),
    body: JSON.stringify({ encryptStr: encrypted }),
  });

  // Decrypt EDR response (all API responses use encryptStr)
  const parsed = decryptResponseBody(response.rawBody);
  const clients = [];
  let totalCount = 0;

  if (parsed && typeof parsed === 'object') {
    // EDR response format: { "data": { "list": [...], "total": N } }
    const data = parsed.data || parsed;
    const list = Array.isArray(data?.list) ? data.list : Array.isArray(data?.rows) ? data.rows : [];
    totalCount = readInt64(data?.total ?? data?.totalCount ?? parsed?.total ?? 0);

    for (const item of list) {
      clients.push({
        client_id: readString(item?.client_id ?? item?.clientId ?? item?.id),
        hostname: readString(item?.hostname ?? item?.computer_name ?? item?.computerName),
        mac: readString(item?.mac ?? item?.macAddr),
        client_ip: readString(item?.client_ip ?? item?.clientIp ?? item?.ip),
        os_name: readString(item?.os_name ?? item?.osName ?? item?.os),
        os_version: readString(item?.os_version ?? item?.osVersion),
        os_arch: readString(item?.os_arch ?? item?.osArch ?? item?.arch),
        client_version: readString(item?.client_version ?? item?.clientVersion ?? item?.version),
        virus_db_version: readInt64(item?.virus_db_version ?? item?.virusDbVersion ?? item?.dbver),
        group_name: readString(item?.group_name ?? item?.groupName ?? item?.dept_name),
        group_id: readString(item?.group_id ?? item?.groupId ?? item?.dept_id),
        person: readString(item?.person ?? item?.responsible),
        terminal_type: readString(item?.terminal_type ?? item?.terminalType ?? item?.type),
        location: readString(item?.location ?? item?.addr),
        login_time: readInt64(item?.login_time ?? item?.loginTime ?? item?.online_time),
        heartbeat_time: readInt64(item?.heartbeat_time ?? item?.heartbeatTime ?? item?.heart_time),
        status: readInt64(item?.status ?? item?.service_status),
        os_type: readString(item?.os_type ?? item?.osType),
        tenancy_id: readString(item?.tenancy_id ?? item?.tenancyId),
        upgrade_dbver: readInt64(item?.upgrade_dbver ?? item?.upgradeDbver),
        next_heart_time: readInt64(item?.next_heart_time ?? item?.nextHeartTime),
        off_line: readInt64(item?.off_line ?? item?.offLine ?? item?.offline_time),
      });
    }
  }

  return {
    clients,
    total_count: totalCount,
    status_code: response.statusCode,
    raw_body: response.rawBody,
  };
};

// --- GetClient ---
const callGetClient = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const host = resolveHost(req, callCtx);
  const session = readSession(req);
  const clientId = requireNonEmpty(firstDefined(
    req.client_id,
    req.clientId,
    req.id,
  ), 'client_id');

  const query = buildSignedQuery(session);

  const bodyPayload = { client_id: clientId };
  const encrypted = encryptAes256Cbc(JSON.stringify(bodyPayload));

  const response = await fetchText(callCtx, buildUrl(host, GET_CLIENT_HTTP_PATH, query), {
    method: 'POST',
    headers: buildAuthHeaders(session, {
      'content-type': 'application/json',
      'Accept': 'application/json',
    }, callCtx.meta),
    body: JSON.stringify({ encryptStr: encrypted }),
  });

  const parsed = decryptResponseBody(response.rawBody);
  let client = null;

  if (parsed && typeof parsed === 'object') {
    const item = parsed.data || parsed;
    client = {
      client_id: readString(item?.client_id ?? item?.clientId ?? item?.id),
      hostname: readString(item?.hostname ?? item?.computer_name ?? item?.computerName),
      mac: readString(item?.mac ?? item?.macAddr),
      client_ip: readString(item?.client_ip ?? item?.clientIp ?? item?.ip),
      os_name: readString(item?.os_name ?? item?.osName ?? item?.os),
      os_version: readString(item?.os_version ?? item?.osVersion),
      os_arch: readString(item?.os_arch ?? item?.osArch ?? item?.arch),
      client_version: readString(item?.client_version ?? item?.clientVersion ?? item?.version),
      virus_db_version: readInt64(item?.virus_db_version ?? item?.virusDbVersion ?? item?.dbver),
      group_name: readString(item?.group_name ?? item?.groupName ?? item?.dept_name),
      group_id: readString(item?.group_id ?? item?.groupId ?? item?.dept_id),
      person: readString(item?.person ?? item?.responsible),
      terminal_type: readString(item?.terminal_type ?? item?.terminalType ?? item?.type),
      location: readString(item?.location ?? item?.addr),
      login_time: readInt64(item?.login_time ?? item?.loginTime ?? item?.online_time),
      heartbeat_time: readInt64(item?.heartbeat_time ?? item?.heartbeatTime ?? item?.heart_time),
      status: readInt64(item?.status ?? item?.service_status),
      os_type: readString(item?.os_type ?? item?.osType),
      tenancy_id: readString(item?.tenancy_id ?? item?.tenancyId),
      upgrade_dbver: readInt64(item?.upgrade_dbver ?? item?.upgradeDbver),
      next_heart_time: readInt64(item?.next_heart_time ?? item?.nextHeartTime),
      off_line: readInt64(item?.off_line ?? item?.offLine ?? item?.offline_time),
    };
  }

  return {
    client,
    status_code: response.statusCode,
    raw_body: response.rawBody,
  };
};

// --- GetAlertStats ---
const callGetAlertStats = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const host = resolveHost(req, callCtx);
  const session = readSession(req);

  const query = buildSignedQuery(session);

  const response = await fetchText(callCtx, buildUrl(host, GET_ALERT_STATS_HTTP_PATH, query), {
    method: 'GET',
    headers: buildAuthHeaders(session, {
      'Accept': 'application/json',
    }, callCtx.meta),
  });

  const parsed = decryptResponseBody(response.rawBody);
  // EDR dashboard response contains threat statistics
  const data = parsed?.data || parsed || {};

  const readThreatStat = (obj) => ({
    threats_num: readInt64(obj?.threats_num ?? obj?.threatNum ?? obj?.num),
    terminal_num: readInt64(obj?.terminal_num ?? obj?.terminalNum ?? obj?.terminalCount),
  });

  return {
    scan: readThreatStat(data?.scan ?? data?.scanInfo),
    hi_leak: readThreatStat(data?.hi_leak ?? data?.hiLeak ?? data?.vuln),
    week_pwd: readThreatStat(data?.week_pwd ?? data?.weekPwd ?? data?.weakPwd),
    intrusion: readThreatStat(data?.intrusion ?? data?.intrusionInfo),
    aggregate_virus_value: readInt64(data?.aggregate_virus_value ?? data?.aggregateVirusValue ?? data?.virusTotal),
    aggregate_ransom_value: readInt64(data?.aggregate_ransom_value ?? data?.aggregateRansomValue ?? data?.ransomTotal),
    file_prot: readInt64(data?.file_prot ?? data?.fileProt ?? data?.fileProtection),
    exec_prot: readInt64(data?.exec_prot ?? data?.execProt ?? data?.execProtection),
    reg_prot: readInt64(data?.reg_prot ?? data?.regProt ?? data?.regProtection),
    proc_prot: readInt64(data?.proc_prot ?? data?.procProt ?? data?.procProtection),
    risk_blocked: readInt64(data?.risk_blocked ?? data?.riskBlocked ?? data?.riskAction),
    virus_immune: readInt64(data?.virus_immune ?? data?.virusImmune),
    udev_illegal: readInt64(data?.udev_illegal ?? data?.udevIllegal ?? data?.usbViolation),
    soft_illegal: readInt64(data?.soft_illegal ?? data?.softIllegal ?? data?.softwareViolation),
    inner_illegal: readInt64(data?.inner_illegal ?? data?.innerIllegal ?? data?.outboundViolation),
    status_code: response.statusCode,
    raw_body: response.rawBody,
  };
};

// --- GetSystemView ---
const callGetSystemView = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const host = resolveHost(req, callCtx);
  const session = readSession(req);

  const query = buildSignedQuery(session);

  const response = await fetchText(callCtx, buildUrl(host, GET_SYSTEM_VIEW_HTTP_PATH, query), {
    method: 'GET',
    headers: buildAuthHeaders(session, {
      'Accept': 'application/json',
    }, callCtx.meta),
  });

  const parsed = decryptResponseBody(response.rawBody);
  const data = parsed?.data || parsed || {};

  // EDR dashboard response includes terminal view, server info, and license info
  const viewData = data?.view ?? data?.terminalView ?? data?.terminal ?? {};
  const serverData = data?.server ?? data?.serverInfo ?? {};
  const licenseData = data?.license ?? data?.licenseInfo ?? {};

  const view = {
    terminal_all: readInt64(viewData?.terminal_all ?? viewData?.terminalAll ?? viewData?.all),
    terminal_online: readInt64(viewData?.terminal_online ?? viewData?.terminalOnline ?? viewData?.online),
    terminal_banned: readInt64(viewData?.terminal_banned ?? viewData?.terminalBanned ?? viewData?.banned),
    total_use: readInt64(viewData?.total_use ?? viewData?.totalUse ?? viewData?.totalDuration),
    windows: readInt64(viewData?.windows ?? viewData?.windowsCount),
    server: readInt64(viewData?.server ?? viewData?.serverCount),
    linux: readInt64(viewData?.linux ?? viewData?.linuxCount),
    domestic: readInt64(viewData?.domestic ?? viewData?.domesticCount),
  };

  const serverInfo = {
    host_name: readString(serverData?.host_name ?? serverData?.hostName ?? serverData?.hostname),
    server_time: readString(serverData?.server_time ?? serverData?.serverTime ?? serverData?.time),
  };

  const licenseInfo = {
    user: readString(licenseData?.user ?? licenseData?.licenseUser),
    type: readString(licenseData?.type ?? licenseData?.licenseType),
    license_platform: readString(licenseData?.license_platform ?? licenseData?.licensePlatform ?? licenseData?.platform),
  };

  return {
    view,
    server_info: serverInfo,
    license_info: licenseInfo,
    status_code: response.statusCode,
    raw_body: response.rawBody,
  };
};

// --- GetSystemInfo ---
const callGetSystemInfo = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const host = resolveHost(req, callCtx);
  const session = readSession(req);

  const query = buildSignedQuery(session);

  const response = await fetchText(callCtx, buildUrl(host, GET_SYSTEM_INFO_HTTP_PATH, query), {
    method: 'GET',
    headers: buildAuthHeaders(session, {
      'Accept': 'application/json',
    }, callCtx.meta),
  });

  const parsed = decryptResponseBody(response.rawBody);
  const data = parsed?.data || parsed || {};

  const systemInfo = {
    disk_usage: readInt64(data?.disk_usage ?? data?.diskUsage ?? data?.disk_percent),
    memory_usage: readInt64(data?.memory_usage ?? data?.memoryUsage ?? data?.memory_percent),
    cpu_usage: readInt64(data?.cpu_usage ?? data?.cpuUsage ?? data?.cpu_percent),
    network_tx: readInt64(data?.network_tx ?? data?.networkTx ?? data?.net_in),
    network_rx: readInt64(data?.network_rx ?? data?.networkRx ?? data?.net_out),
    server_time: readString(data?.server_time ?? data?.serverTime ?? data?.time),
  };

  return {
    system_info: systemInfo,
    status_code: response.statusCode,
    raw_body: response.rawBody,
  };
};

// --- RPC definitions ---
export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_LOGIN_PATH]: async (req) => callLogin(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_LIST_CLIENTS_PATH]: async (req) => callListClients(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_GET_CLIENT_PATH]: async (req) => callGetClient(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_GET_ALERT_STATS_PATH]: async (req) => callGetAlertStats(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_GET_SYSTEM_VIEW_PATH]: async (req) => callGetSystemView(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_GET_SYSTEM_INFO_PATH]: async (req) => callGetSystemInfo(req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_LOGIN_FULL]: (req, ctx = {}) => callLogin(req, ctx),
  [METHOD_LIST_CLIENTS_FULL]: (req, ctx = {}) => callListClients(req, ctx),
  [METHOD_GET_CLIENT_FULL]: (req, ctx = {}) => callGetClient(req, ctx),
  [METHOD_GET_ALERT_STATS_FULL]: (req, ctx = {}) => callGetAlertStats(req, ctx),
  [METHOD_GET_SYSTEM_VIEW_FULL]: (req, ctx = {}) => callGetSystemView(req, ctx),
  [METHOD_GET_SYSTEM_INFO_FULL]: (req, ctx = {}) => callGetSystemInfo(req, ctx),
};

// --- Test exports ---
export const _test = {
  addTraceHeaders,
  buildAuthHeaders,
  buildLoginBody,
  buildSignedQuery,
  buildTlsOptions,
  buildUrl,
  computeSign,
  decryptAes256Cbc,
  encryptAes256Cbc,
  errorWithCode,
  fetchText,
  firstDefined,
  gatherCookies,
  grpcCodeFor,
  hasOwn,
  normalizeHost,
  parseLoginResponse,
  readInt64,
  readResponseBodyText,
  readSession,
  readString,
  readTimeoutMs,
  resolveCallContext,
  resolveHost,
  resolveLoginPassword,
  resolveLoginUsername,
  toBoolean,
  tryParseJson,
  unwrapScalar,
};
