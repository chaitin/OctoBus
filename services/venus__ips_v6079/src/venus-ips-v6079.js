import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import {
  GrpcError,
  grpcStatus,
} from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const METHOD_HEALTH_CHECK_FULL = 'Venus_IPSV6079.IPSV6079Service/HealthCheck';
export const METHOD_LOGIN_FULL = 'Venus_IPSV6079.IPSV6079Service/Login';
export const METHOD_REQUEST_FULL = 'Venus_IPSV6079.IPSV6079Service/Request';
export const METHOD_GET_LICENSE_FULL = 'Venus_IPSV6079.IPSV6079Service/GetLicense';
export const METHOD_IMPORT_LICENSE_FULL = 'Venus_IPSV6079.IPSV6079Service/ImportLicense';
export const METHOD_GET_SYSTEM_RESOURCE_INFO_FULL = 'Venus_IPSV6079.IPSV6079Service/GetSystemResourceInfo';
export const METHOD_CONFIG_FEATURE_UPDATE_ONTIME_FULL = 'Venus_IPSV6079.IPSV6079Service/ConfigFeatureUpdateOntime';
export const METHOD_GET_FEATURE_UPDATE_CONFIG_FULL = 'Venus_IPSV6079.IPSV6079Service/GetFeatureUpdateConfig';
export const METHOD_CONFIG_FEATURE_UPDATE_CONFIG_FULL = 'Venus_IPSV6079.IPSV6079Service/ConfigFeatureUpdateConfig';
export const METHOD_START_FEATURE_UPDATE_FULL = 'Venus_IPSV6079.IPSV6079Service/StartFeatureUpdate';
export const METHOD_CONFIG_SOFTWARE_UPDATE_ONTIME_FULL = 'Venus_IPSV6079.IPSV6079Service/ConfigSoftwareUpdateOntime';
export const METHOD_GET_SOFTWARE_UPDATE_ONTIME_FULL = 'Venus_IPSV6079.IPSV6079Service/GetSoftwareUpdateOntime';
export const METHOD_GET_SOFTWARE_UPDATE_CONFIG_FULL = 'Venus_IPSV6079.IPSV6079Service/GetSoftwareUpdateConfig';
export const METHOD_CONFIG_SOFTWARE_UPDATE_CONFIG_FULL = 'Venus_IPSV6079.IPSV6079Service/ConfigSoftwareUpdateConfig';
export const METHOD_GET_SOFTWARE_STATUS_FULL = 'Venus_IPSV6079.IPSV6079Service/GetSoftwareStatus';
export const METHOD_START_SOFTWARE_UPDATE_FULL = 'Venus_IPSV6079.IPSV6079Service/StartSoftwareUpdate';
export const METHOD_GET_SYSLOG_SERVER_FULL = 'Venus_IPSV6079.IPSV6079Service/GetSyslogServer';
export const METHOD_CONFIG_SYSLOG_SERVER_FULL = 'Venus_IPSV6079.IPSV6079Service/ConfigSyslogServer';
export const METHOD_GET_KAFKA_SERVER_FULL = 'Venus_IPSV6079.IPSV6079Service/GetKafkaServer';
export const METHOD_CONFIG_KAFKA_SERVER_FULL = 'Venus_IPSV6079.IPSV6079Service/ConfigKafkaServer';
export const METHOD_GET_NTP_CONFIG_FULL = 'Venus_IPSV6079.IPSV6079Service/GetNtpConfig';
export const METHOD_CONFIG_NTP_CONFIG_FULL = 'Venus_IPSV6079.IPSV6079Service/ConfigNtpConfig';
export const METHOD_GET_DNS_CONFIG_FULL = 'Venus_IPSV6079.IPSV6079Service/GetDnsConfig';
export const METHOD_CONFIG_DNS_CONFIG_FULL = 'Venus_IPSV6079.IPSV6079Service/ConfigDnsConfig';
export const METHOD_EXPORT_BACKUP_FULL = 'Venus_IPSV6079.IPSV6079Service/ExportBackup';
export const METHOD_IMPORT_BACKUP_FULL = 'Venus_IPSV6079.IPSV6079Service/ImportBackup';
export const METHOD_GET_SNMP_CONFIG_FULL = 'Venus_IPSV6079.IPSV6079Service/GetSnmpConfig';
export const METHOD_GET_MANAGEMENT_ACCESS_CONFIG_FULL = 'Venus_IPSV6079.IPSV6079Service/GetManagementAccessConfig';
export const METHOD_CONFIG_TIMEOUT_FULL = 'Venus_IPSV6079.IPSV6079Service/ConfigTimeout';
export const METHOD_GET_PASSWORD_POLICY_FULL = 'Venus_IPSV6079.IPSV6079Service/GetPasswordPolicy';
export const METHOD_CONFIG_PASSWORD_POLICY_FULL = 'Venus_IPSV6079.IPSV6079Service/ConfigPasswordPolicy';
export const METHOD_GET_LOGIN_BLOCK_CONFIG_FULL = 'Venus_IPSV6079.IPSV6079Service/GetLoginBlockConfig';
export const METHOD_GET_RADIUS_CONFIG_FULL = 'Venus_IPSV6079.IPSV6079Service/GetRadiusConfig';
export const METHOD_GET_ALARM_CONFIG_FULL = 'Venus_IPSV6079.IPSV6079Service/GetAlarmConfig';
export const METHOD_CONFIG_ALARM_CONFIG_FULL = 'Venus_IPSV6079.IPSV6079Service/ConfigAlarmConfig';
export const METHOD_GET_HTTP_PROXY_FULL = 'Venus_IPSV6079.IPSV6079Service/GetHttpProxy';
export const METHOD_CONFIG_HTTP_PROXY_FULL = 'Venus_IPSV6079.IPSV6079Service/ConfigHttpProxy';
export const METHOD_SYSTEM_OPERATE_FULL = 'Venus_IPSV6079.IPSV6079Service/SystemOperate';
export const METHOD_LIST_BLOCK_POLICY_FULL = 'Venus_IPSV6079.IPSV6079Service/ListBlockPolicy';
export const METHOD_ADD_BLOCK_POLICY_FULL = 'Venus_IPSV6079.IPSV6079Service/AddBlockPolicy';
export const METHOD_DELETE_BLOCK_POLICY_FULL = 'Venus_IPSV6079.IPSV6079Service/DeleteBlockPolicy';
export const METHOD_BATCH_ADD_BLOCK_POLICY_FULL = 'Venus_IPSV6079.IPSV6079Service/BatchAddBlockPolicy';
export const METHOD_LIST_WHITE_POLICY_FULL = 'Venus_IPSV6079.IPSV6079Service/ListWhitePolicy';
export const METHOD_ADD_WHITE_POLICY_FULL = 'Venus_IPSV6079.IPSV6079Service/AddWhitePolicy';
export const METHOD_DELETE_WHITE_POLICY_FULL = 'Venus_IPSV6079.IPSV6079Service/DeleteWhitePolicy';

export const LOGIN_PATH = '/api/v3/login';
export const DEFAULT_TIMEOUT_MS = 8000;
export const DEFAULT_AUTH_HEADER_PREFIX = 'Bearer';
export const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const MAX_BACKUP_UPLOAD_BYTES = 16 * 1024 * 1024;
export const MAX_SESSION_CACHE_ENTRIES = 128;

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const SESSION_CACHE = new Map();
let insecureDispatcher;

const JSON_ENDPOINTS = {
  [METHOD_GET_LICENSE_FULL]: { method: 'GET', path: '/api/v3/license' },
  [METHOD_IMPORT_LICENSE_FULL]: { method: 'POST', path: '/api/v3/license' },
  [METHOD_GET_SYSTEM_RESOURCE_INFO_FULL]: { method: 'GET', path: '/api/v3/sys_resource_info' },
  [METHOD_CONFIG_FEATURE_UPDATE_ONTIME_FULL]: { method: 'POST', path: '/api/v3/feature_update_ontime' },
  [METHOD_GET_FEATURE_UPDATE_CONFIG_FULL]: { method: 'GET', path: '/api/v3/feature_update_config/{feature_type}' },
  [METHOD_CONFIG_FEATURE_UPDATE_CONFIG_FULL]: { method: 'POST', path: '/api/v3/feature_update_config' },
  [METHOD_START_FEATURE_UPDATE_FULL]: { method: 'POST', path: '/api/v3/feature_update_now' },
  [METHOD_CONFIG_SOFTWARE_UPDATE_ONTIME_FULL]: { method: 'POST', path: '/api/v3/software_update_ontime' },
  [METHOD_GET_SOFTWARE_UPDATE_ONTIME_FULL]: { method: 'GET', path: '/api/v3/software_update_ontime' },
  [METHOD_GET_SOFTWARE_UPDATE_CONFIG_FULL]: { method: 'GET', path: '/api/v3/software_update_config' },
  [METHOD_CONFIG_SOFTWARE_UPDATE_CONFIG_FULL]: { method: 'POST', path: '/api/v3/software_update_config' },
  [METHOD_GET_SOFTWARE_STATUS_FULL]: { method: 'GET', path: '/api/v3/software_status' },
  [METHOD_START_SOFTWARE_UPDATE_FULL]: { method: 'POST', path: '/api/v3/software_update_now' },
  [METHOD_GET_SYSLOG_SERVER_FULL]: { method: 'GET', path: '/api/v3/syslog_server' },
  [METHOD_CONFIG_SYSLOG_SERVER_FULL]: { method: 'POST', path: '/api/v3/syslog_server' },
  [METHOD_GET_KAFKA_SERVER_FULL]: { method: 'GET', path: '/api/v3/kafka_server' },
  [METHOD_CONFIG_KAFKA_SERVER_FULL]: { method: 'POST', path: '/api/v3/kafka_server' },
  [METHOD_GET_NTP_CONFIG_FULL]: { method: 'GET', path: '/api/v3/ntp_config' },
  [METHOD_CONFIG_NTP_CONFIG_FULL]: { method: 'POST', path: '/api/v3/ntp_config' },
  [METHOD_GET_DNS_CONFIG_FULL]: { method: 'GET', path: '/api/v3/dns_config' },
  [METHOD_CONFIG_DNS_CONFIG_FULL]: { method: 'POST', path: '/api/v3/dns_config' },
  [METHOD_GET_SNMP_CONFIG_FULL]: { method: 'GET', path: '/api/v3/snmp_config' },
  [METHOD_GET_MANAGEMENT_ACCESS_CONFIG_FULL]: { method: 'GET', path: '/api/v3/mgmaccess_config' },
  [METHOD_CONFIG_TIMEOUT_FULL]: { method: 'POST', path: '/api/v3/timeout' },
  [METHOD_GET_PASSWORD_POLICY_FULL]: { method: 'GET', path: '/api/v3/password_policy' },
  [METHOD_CONFIG_PASSWORD_POLICY_FULL]: { method: 'POST', path: '/api/v3/password_policy' },
  [METHOD_GET_LOGIN_BLOCK_CONFIG_FULL]: { method: 'GET', path: '/api/v3/block_config' },
  [METHOD_GET_RADIUS_CONFIG_FULL]: { method: 'GET', path: '/api/v3/radius' },
  [METHOD_GET_ALARM_CONFIG_FULL]: { method: 'GET', path: '/api/v3/alarm_config' },
  [METHOD_CONFIG_ALARM_CONFIG_FULL]: { method: 'POST', path: '/api/v3/alarm_config' },
  [METHOD_GET_HTTP_PROXY_FULL]: { method: 'GET', path: '/api/v3/http_proxy' },
  [METHOD_CONFIG_HTTP_PROXY_FULL]: { method: 'POST', path: '/api/v3/http_proxy' },
  [METHOD_SYSTEM_OPERATE_FULL]: { method: 'POST', path: '/api/v3/system_operate' },
  [METHOD_LIST_BLOCK_POLICY_FULL]: { method: 'GET', path: '/api/v3/block_policy' },
  [METHOD_ADD_BLOCK_POLICY_FULL]: { method: 'POST', path: '/api/v3/block_policy' },
  [METHOD_DELETE_BLOCK_POLICY_FULL]: { method: 'DELETE', path: '/api/v3/block_policy' },
  [METHOD_BATCH_ADD_BLOCK_POLICY_FULL]: { method: 'POST', path: '/api/v3/block_policy/batch' },
  [METHOD_LIST_WHITE_POLICY_FULL]: { method: 'GET', path: '/api/v3/white_policy' },
  [METHOD_ADD_WHITE_POLICY_FULL]: { method: 'POST', path: '/api/v3/white_policy' },
  [METHOD_DELETE_WHITE_POLICY_FULL]: { method: 'DELETE', path: '/api/v3/white_policy' },
};

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  RESOURCE_EXHAUSTED: grpcStatus.RESOURCE_EXHAUSTED,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
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
  if (typeof value === 'object') {
    if (hasOwn(value, 'value')) return unwrapScalar(value.value);
    if (hasOwn(value, 'stringValue')) return unwrapScalar(value.stringValue);
    if (hasOwn(value, 'numberValue')) return unwrapScalar(value.numberValue);
    if (hasOwn(value, 'boolValue')) return unwrapScalar(value.boolValue);
  }
  return value;
};

const pickString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return undefined;
};

const pickFirstString = (values) => {
  for (const value of values) {
    const str = pickString(value);
    if (str !== undefined && str.trim()) return str.trim();
  }
  return undefined;
};

const pickBoolean = (value) => {
  const raw = unwrapScalar(value);
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return Number.isNaN(raw) ? undefined : raw !== 0;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) return false;
  }
  return undefined;
};

const optionalPositiveNumber = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? num : undefined;
};

const isPlainObject = (input) => Boolean(input) && typeof input === 'object' && Object.getPrototypeOf(input) === Object.prototype;

const sanitizeHeaders = (headers) => {
  const raw = unwrapScalar(headers);
  if (!isPlainObject(raw)) return {};
  const normalized = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!key) continue;
    normalized[key] = String(unwrapScalar(value) ?? '');
  }
  return normalized;
};

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

const normalizeBaseUrl = (rawUrl) => {
  const value = pickFirstString([rawUrl]);
  if (!value) return '';
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)
      || url.username || url.password || url.search || url.hash) return '';
    return url.origin;
  } catch {
    return '';
  }
};

const resolveTimeoutMs = (ctx = {}) => optionalPositiveNumber(ctx.bindings?.timeoutMs)
  ?? optionalPositiveNumber(ctx.bindings?.timeout_ms)
  ?? optionalPositiveNumber(ctx.limits?.timeoutMs)
  ?? DEFAULT_TIMEOUT_MS;

const resolveMaxResponseBytes = (ctx = {}) => optionalPositiveNumber(ctx.bindings?.maxResponseBytes)
  ?? optionalPositiveNumber(ctx.bindings?.max_response_bytes)
  ?? DEFAULT_MAX_RESPONSE_BYTES;

const buildSessionKey = (ctx, env) => [
  pickFirstString([
    ctx.instanceId,
    ctx.instance_id,
    ctx.meta?.instance_id,
    ctx.meta?.instanceId,
    ctx.bindings?.instance_id,
    ctx.bindings?.instanceId,
  ]) || 'default-instance',
  env.baseUrl,
  env.deviceType,
  env.username || '',
  env.passwordSha256 || '',
].join('\u001f');

const sha256Hex = (input) => createHash('sha256').update(String(input ?? ''), 'utf8').digest('hex');

const buildEnv = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings || {};
  const baseUrl = normalizeBaseUrl(pickFirstString([bindings.baseUrl, bindings.restBaseUrl, bindings.host, bindings.base_url]));
  if (!baseUrl) throw errorWithCode('FAILED_PRECONDITION', 'bindings.baseUrl/restBaseUrl must be a valid http(s) URL');
  const deviceType = pickFirstString([bindings.deviceType, bindings.device_type]) || 'api';
  const token = pickFirstString([bindings.token, bindings.authorization]);
  const username = pickFirstString([bindings.username, bindings.user]);
  const rawPassword = pickFirstString([bindings.password]);
  const passwordSha256 = pickFirstString([bindings.passwordSha256, bindings.password_sha256])
    || (rawPassword ? sha256Hex(rawPassword) : undefined);
  if (!token && (!username || !passwordSha256)) {
    throw errorWithCode('FAILED_PRECONDITION', 'token or username/password is required');
  }
  const env = {
    baseUrl,
    deviceType,
    username,
    passwordSha256,
    token,
    authHeaderPrefix: pickFirstString([bindings.authHeaderPrefix, bindings.auth_header_prefix]) || DEFAULT_AUTH_HEADER_PREFIX,
    timeoutMs: resolveTimeoutMs(callCtx),
    maxResponseBytes: resolveMaxResponseBytes(callCtx),
    headers: sanitizeHeaders(bindings.headers),
    skipTlsVerify: pickBoolean(bindings.skipTlsVerify) || pickBoolean(bindings.tlsInsecureSkipVerify) || false,
  };
  return {
    ...env,
    sessionKey: buildSessionKey(callCtx, env),
  };
};

const requestIdOf = (req = {}) => pickFirstString([req.request_id, req.requestId]) || '';

const parseJsonBody = (jsonBody) => {
  const text = pickString(jsonBody);
  if (!text || !text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithCode('INVALID_ARGUMENT', 'json_body must be valid JSON');
  }
};

const isJsonContentType = (contentType) => String(contentType || '').toLowerCase().includes('json');

const headersToObject = (headers) => {
  const result = {};
  headers?.forEach?.((value, key) => {
    result[key] = value;
  });
  return result;
};

const responseHeaders = (headers = {}) => {
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[String(key).toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value ?? '');
  }
  return {
    get: (key) => normalized[String(key).toLowerCase()] || '',
    forEach: (fn) => {
      for (const [key, value] of Object.entries(normalized)) fn(value, key);
    },
  };
};

const mapHttpStatus = (status) => {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'PERMISSION_DENIED';
  if (status >= 400 && status < 500) return 'FAILED_PRECONDITION';
  return 'UNAVAILABLE';
};

const buildUrl = (env, path, query = {}) => {
  const rawPath = pickFirstString([path]);
  if (!rawPath || !rawPath.startsWith('/api/v3/') || /^https?:\/\//i.test(rawPath)) {
    throw errorWithCode('INVALID_ARGUMENT', 'path must be an IPS API path beginning with /api/v3/');
  }
  const url = new URL(`${env.baseUrl}${rawPath}`);
  const rawQuery = unwrapScalar(query);
  if (isPlainObject(rawQuery)) {
    for (const [key, value] of Object.entries(rawQuery)) {
      if (!key || value === undefined || value === null) continue;
      url.searchParams.set(key, String(unwrapScalar(value) ?? ''));
    }
  }
  return url;
};

const applyAuthHeaders = (headers, env, token) => {
  const prefix = env.authHeaderPrefix ? `${env.authHeaderPrefix} ` : '';
  headers.Authorization = `${prefix}${token}`;
  headers['Device-Type'] = env.deviceType;
};

const doFetch = async (env, options) => {
  const headers = {
    ...(options.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
    ...env.headers,
    ...(options.headers || {}),
  };
  if (options.authToken) applyAuthHeaders(headers, env, options.authToken);
  const fetchOptions = {
    method: options.method,
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(env.timeoutMs),
  };
  if (options.body !== undefined) fetchOptions.body = options.body;
  if (env.skipTlsVerify) {
    insecureDispatcher ??= new Agent({ connect: { rejectUnauthorized: false } });
    fetchOptions.dispatcher = insecureDispatcher;
  }
  try {
    return await fetch(options.url, fetchOptions);
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', `${options.action || 'request'} failed: ${err?.cause?.message || err?.message || 'fetch failed'}`);
  }
};

const readBoundedBuffer = async (response, env) => {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > env.maxResponseBytes) {
    throw errorWithCode('RESOURCE_EXHAUSTED', 'upstream response exceeds configured size limit');
  }
  const bytes = typeof response.arrayBuffer === 'function'
    ? Buffer.from(await response.arrayBuffer())
    : Buffer.from(await response.text(), 'utf8');
  if (bytes.length > env.maxResponseBytes) {
    throw errorWithCode('RESOURCE_EXHAUSTED', 'upstream response exceeds configured size limit');
  }
  return bytes;
};

const parseJsonResponse = async (response, action, env) => {
  const text = (await readBoundedBuffer(response, env)).toString('utf8');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', `${action} response is not valid JSON`);
  }
};

const readRestResponse = async (response, env, requestId = '') => {
  const headers = headersToObject(response.headers);
  const contentType = headers['content-type'] || headers['Content-Type'] || '';
  const body = await readBoundedBuffer(response, env);
  if (isJsonContentType(contentType)) {
    return {
      status_code: response.status,
      headers,
      json_body: body.toString('utf8') || 'null',
      raw_body_base64: '',
      request_id: requestId,
    };
  }
  return {
    status_code: response.status,
    headers,
    json_body: '',
    raw_body_base64: body.toString('base64'),
    request_id: requestId,
  };
};

const extractAuthorization = (json = {}) => pickFirstString([
  json.authorization,
  json.token,
  json?.data?.authorization,
  json?.data?.token,
]);

const safeLoginFailureMessage = (json = {}) => {
  const message = pickFirstString([
    json.msg,
    json.message,
    json?.data?.msg,
    json?.data?.message,
  ]);
  const code = pickFirstString([
    json.code,
    json.status,
    json?.data?.code,
    json?.data?.status,
  ]);
  if (message && code) return `${message} (code ${code})`;
  return message || (code ? `code ${code}` : 'unknown error');
};

const getSession = (env) => {
  const session = SESSION_CACHE.get(env.sessionKey);
  if (session) {
    SESSION_CACHE.delete(env.sessionKey);
    SESSION_CACHE.set(env.sessionKey, session);
  }
  return session;
};

const setSession = (key, session) => {
  SESSION_CACHE.delete(key);
  SESSION_CACHE.set(key, session);
  while (SESSION_CACHE.size > MAX_SESSION_CACHE_ENTRIES) {
    SESSION_CACHE.delete(SESSION_CACHE.keys().next().value);
  }
};

const setSessionToken = (env, token) => {
  if (!env.sessionKey || !token) return;
  setSession(env.sessionKey, { token });
};

const login = async (env) => {
  if (env.token) return { authorization: env.token, message: 'using pre-issued token' };
  if (!env.username || !env.passwordSha256) throw errorWithCode('FAILED_PRECONDITION', 'username/password is required for login');
  const response = await doFetch(env, {
    url: new URL(`${env.baseUrl}${LOGIN_PATH}`),
    method: 'POST',
    action: 'login',
    body: JSON.stringify({ username: env.username, password: env.passwordSha256 }),
  });
  const json = await parseJsonResponse(response, 'login', env);
  if (!response.ok || (json.code !== undefined && Number(json.code) !== 0)) {
    throw errorWithCode('UNAUTHENTICATED', `login failed: ${safeLoginFailureMessage(json)}`);
  }
  const authorization = extractAuthorization(json);
  if (!authorization) throw errorWithCode('UNAUTHENTICATED', 'login did not return authorization token');
  setSessionToken(env, authorization);
  return { authorization, message: pickString(json.msg) || pickString(json.message) || 'login ok' };
};

const getAuthToken = async (env) => {
  if (env.token) return env.token;
  const session = getSession(env);
  if (session?.token) return session.token;
  if (session?.loginPromise) return session.loginPromise;

  const loginPromise = login(env).then((result) => result.authorization);
  setSession(env.sessionKey, { loginPromise });
  try {
    return await loginPromise;
  } finally {
    const current = getSession(env);
    if (current?.loginPromise === loginPromise) SESSION_CACHE.delete(env.sessionKey);
  }
};

const clearSession = (env, expectedToken = '') => {
  if (env.token || !env.sessionKey) return;
  const session = getSession(env);
  if (!session) return;
  if (session.loginPromise && !session.token) return;
  if (expectedToken && session.token && session.token !== expectedToken) return;
  SESSION_CACHE.delete(env.sessionKey);
};

const clearSessionCache = () => SESSION_CACHE.clear();

const executeRestRequest = async (env, req = {}, { retry = true } = {}) => {
  const method = pickFirstString([req.method])?.toUpperCase();
  if (!method) throw errorWithCode('INVALID_ARGUMENT', 'method is required');
  if (!ALLOWED_METHODS.has(method)) throw errorWithCode('INVALID_ARGUMENT', `unsupported method: ${method}`);
  const url = buildUrl(env, req.path, req.query);
  let body;
  if (req.raw_body_base64) {
    body = Buffer.from(pickString(req.raw_body_base64) || '', 'base64');
  } else if (req.json_body !== undefined && req.json_body !== '') {
    body = JSON.stringify(parseJsonBody(req.json_body));
  }
  const headers = sanitizeHeaders(req.headers);
  const contentType = pickFirstString([req.content_type, req.contentType]);
  if (contentType) headers['content-type'] = contentType;
  const token = await getAuthToken(env);
  const response = await doFetch(env, {
    url,
    method,
    body,
    authToken: token,
    headers,
    action: 'request',
  });
  if ((response.status === 401 || response.status === 403) && retry && !env.token) {
    clearSession(env, token);
    await readBoundedBuffer(response, env);
    return executeRestRequest(env, req, { retry: false });
  }
  if (!response.ok) {
    await readBoundedBuffer(response, env);
    throw errorWithCode(mapHttpStatus(response.status), `request upstream returned HTTP ${response.status}`);
  }
  return readRestResponse(response, env, requestIdOf(req));
};

const endpointPath = (endpoint, req = {}) => {
  if (!endpoint.path.includes('{feature_type}')) return endpoint.path;
  const featureType = pickFirstString([
    req.feature_type,
    req.featureType,
    req.query?.feature_type,
    req.query?.featureType,
    parseJsonBody(req.json_body).feature_type,
  ]);
  if (!featureType) throw errorWithCode('INVALID_ARGUMENT', 'feature_type is required');
  return endpoint.path.replace('{feature_type}', encodeURIComponent(featureType));
};

const executeJsonEndpoint = async (env, req = {}, endpoint) => {
  const restReq = {
    method: endpoint.method,
    path: endpointPath(endpoint, req),
    query: req.query,
    request_id: requestIdOf(req),
  };
  if (endpoint.method !== 'GET') restReq.json_body = req.json_body || '{}';
  const response = await executeRestRequest(env, restReq);
  return {
    json_body: response.json_body,
    request_id: response.request_id,
  };
};

const executeHealthCheck = async (env) => {
  await getAuthToken(env);
  return { ok: true, message: 'authenticated' };
};

const executeLogin = async (env) => {
  const result = await login(env);
  return {
    authenticated: Boolean(result.authorization),
    authorization: result.authorization,
    message: result.message,
  };
};

const executeBackupExport = async (env, req = {}) => executeRestRequest(env, {
  method: 'GET',
  path: '/api/v3/backup_export',
  request_id: requestIdOf(req),
});

const executeBackupImport = async (env, req = {}, { retry = true } = {}) => {
  const fileName = pickFirstString([req.file_name, req.fileName]);
  const fileBase64 = pickFirstString([req.file_base64, req.fileBase64]);
  if (!fileName) throw errorWithCode('INVALID_ARGUMENT', 'file_name is required');
  if (!fileBase64) throw errorWithCode('INVALID_ARGUMENT', 'file_base64 is required');
  const compactBase64 = fileBase64.replace(/\s+/g, '');
  if (compactBase64.length > Math.ceil(MAX_BACKUP_UPLOAD_BYTES / 3) * 4) {
    throw errorWithCode('RESOURCE_EXHAUSTED', 'backup file exceeds the 16 MiB upload limit');
  }
  const bytes = Buffer.from(compactBase64, 'base64');
  const canonical = (value) => value.replace(/=+$/, '');
  if (canonical(bytes.toString('base64')) !== canonical(compactBase64)) {
    throw errorWithCode('INVALID_ARGUMENT', 'file_base64 must be valid base64');
  }
  if (bytes.length > MAX_BACKUP_UPLOAD_BYTES) {
    throw errorWithCode('RESOURCE_EXHAUSTED', 'backup file exceeds the 16 MiB upload limit');
  }
  const form = new FormData();
  form.append('filename', new Blob([bytes]), fileName);
  const token = await getAuthToken(env);
  const response = await doFetch(env, {
    url: buildUrl(env, '/api/v3/backup_import'),
    method: 'POST',
    body: form,
    authToken: token,
    action: 'backup import',
  });
  if ((response.status === 401 || response.status === 403) && retry && !env.token) {
    clearSession(env, token);
    await readBoundedBuffer(response, env);
    return executeBackupImport(env, req, { retry: false });
  }
  if (!response.ok) {
    await readBoundedBuffer(response, env);
    throw errorWithCode(mapHttpStatus(response.status), `backup import upstream returned HTTP ${response.status}`);
  }
  const rest = await readRestResponse(response, env, requestIdOf(req));
  return {
    json_body: rest.json_body,
    request_id: rest.request_id,
  };
};

const envFor = (ctx = {}) => buildEnv(ctx);
const requestFor = (ctx = {}) => ctx.request ?? ctx.req ?? {};
const runWithEnv = (ctx = {}, executor) => {
  const req = requestFor(ctx);
  return executor(envFor(ctx), req);
};
const makeHandler = (executor) => (ctx = {}) => runWithEnv(ctx, executor);
const makeJsonHandler = (methodFull) => makeHandler(
  (env, req) => executeJsonEndpoint(env, req, JSON_ENDPOINTS[methodFull]),
);

const fullToPath = (methodFull) => `/${methodFull}`;

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  let cachedEnv;
  const resolveEnv = () => {
    if (!cachedEnv) cachedEnv = buildEnv(callCtx);
    return cachedEnv;
  };
  const getReq = (incoming) => ({ ...(callCtx.req || {}), ...(incoming || {}) });
  const entries = {
    [METHOD_HEALTH_CHECK_FULL]: async (req) => executeHealthCheck(resolveEnv(), getReq(req)),
    [METHOD_LOGIN_FULL]: async (req) => executeLogin(resolveEnv(), getReq(req)),
    [METHOD_REQUEST_FULL]: async (req) => executeRestRequest(resolveEnv(), getReq(req)),
    [METHOD_EXPORT_BACKUP_FULL]: async (req) => executeBackupExport(resolveEnv(), getReq(req)),
    [METHOD_IMPORT_BACKUP_FULL]: async (req) => executeBackupImport(resolveEnv(), getReq(req)),
  };
  for (const method of Object.keys(JSON_ENDPOINTS)) {
    entries[method] = async (req) => executeJsonEndpoint(resolveEnv(), getReq(req), JSON_ENDPOINTS[method]);
  }
  return Object.fromEntries(Object.entries(entries).map(([method, handler]) => [fullToPath(method), handler]));
}

export const handlers = {
  [METHOD_HEALTH_CHECK_FULL]: makeHandler((env) => executeHealthCheck(env)),
  [METHOD_LOGIN_FULL]: makeHandler((env) => executeLogin(env)),
  [METHOD_REQUEST_FULL]: makeHandler((env, req) => executeRestRequest(env, req)),
  [METHOD_EXPORT_BACKUP_FULL]: makeHandler((env, req) => executeBackupExport(env, req)),
  [METHOD_IMPORT_BACKUP_FULL]: makeHandler((env, req) => executeBackupImport(env, req)),
  ...Object.fromEntries(Object.keys(JSON_ENDPOINTS).map((method) => [method, makeJsonHandler(method)])),
};

export const _test = {
  buildEnv,
  buildSessionKey,
  buildUrl,
  clearSession,
  clearSessionCache,
  doFetch,
  envFor,
  errorWithCode,
  executeBackupExport,
  executeBackupImport,
  executeHealthCheck,
  executeJsonEndpoint,
  executeLogin,
  executeRestRequest,
  getAuthToken,
  grpcCodeFor,
  isJsonContentType,
  login,
  mapHttpStatus,
  normalizeBaseUrl,
  parseJsonBody,
  requestIdOf,
  sanitizeHeaders,
  sessionCacheSize: () => SESSION_CACHE.size,
  sha256Hex,
};
