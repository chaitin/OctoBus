import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const METHOD_BATCH_BLOCK_PATH = '/Venus_ADS_V36.VenusADSBlacklistService/BatchBlockIP';
export const METHOD_REMOVE_IP_PATH = '/Venus_ADS_V36.VenusADSBlacklistService/RemoveBlockedIP';
export const METHOD_BATCH_BLOCK_FULL = 'Venus_ADS_V36.VenusADSBlacklistService/BatchBlockIP';
export const METHOD_REMOVE_IP_FULL = 'Venus_ADS_V36.VenusADSBlacklistService/RemoveBlockedIP';

export const LOGIN_PATH = '/v2.0/api/web_login/ddos';
export const BLOCK_PATH = '/v2.0/api/ip_bwlist/info';
export const DELETE_PATH = '/v2.0/api/ip_bwlist/info';
export const LOGOUT_PATH = '/v2.0/api/web_logout/ddos';
export const DEFAULT_TIMEOUT_MS = 8000;
export const DEFAULT_SESSION_TIMEOUT_SECONDS = 1800;
export const DEFAULT_REMARK = '万象IP封禁';
export const LIST_TYPE_BLACK = '100';
export const IP_DIRECTION_BLACK = 1;
export const IP_STATE_ENABLED = 100;
export const RESULT_SUCCESS = '0';
export const RESULT_ALREADY_EXISTS = '-391201';
export const RESULT_NOT_FOUND = '-391204';
export const OPERATION_STATUS = {
  SUCCESS: 'OPERATION_STATUS_SUCCESS',
  PARTIAL: 'OPERATION_STATUS_PARTIAL',
  FAILED: 'OPERATION_STATUS_FAILED',
};

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
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
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return Number.isNaN(raw) ? undefined : raw !== 0;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) return false;
  }
  return undefined;
};

const pickFirstBoolean = (values) => {
  for (const value of values) {
    const bool = pickBoolean(value);
    if (bool !== undefined) return bool;
  }
  return undefined;
};

const optionalInt = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = Number(raw);
  return Number.isInteger(num) ? num : undefined;
};

const optionalPositiveNumber = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? num : undefined;
};

const toArray = (value) => {
  const raw = unwrapScalar(value);
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(raw.values)) return raw.values;
  return undefined;
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

const stringifyMessage = (message) => {
  if (message === undefined || message === null) return '';
  if (typeof message === 'string') return message;
  try {
    return JSON.stringify(message);
  } catch {
    return String(message);
  }
};

const maskToken = (token) => {
  const text = String(token ?? '');
  if (!text) return '';
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${text.slice(0, 2)}***${text.slice(-2)}`;
};

const buildLogger = (meta = {}) => {
  const instanceId = pickFirstString([meta.instance_id, meta.instanceId]) || '';
  const requestId = pickFirstString([meta.request_id, meta.requestId]) || '';
  return (level, action, details = {}) => {
    const traceParts = [];
    if (instanceId) traceParts.push(`inst=${instanceId}`);
    if (requestId) traceParts.push(`req=${requestId}`);
    const trace = traceParts.length ? `[${traceParts.join(' ')}]` : '';
    const payload = { ...details };
    if (payload.token) payload.token = maskToken(payload.token);
    if (payload.password) payload.password = '***';
    const line = `[Venus_ADS_V36][${action}]${trace} ${stringifyMessage(payload)}`;
    if (level === 'error') console.error(line);
    else console.log(line);
  };
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
  req: ctx.request ?? ctx.req ?? {},
});

const requestFromContext = (ctx = {}) => ctx.request ?? ctx.req ?? {};

const normalizeBaseUrl = (rawUrl) => {
  const value = pickFirstString([rawUrl]);
  if (!value) return '';
  const trimmed = value.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed)) return '';
  return trimmed;
};

const resolveTimeoutMs = (ctx = {}) => optionalPositiveNumber(ctx.bindings?.timeoutMs)
  ?? optionalPositiveNumber(ctx.limits?.timeoutMs)
  ?? DEFAULT_TIMEOUT_MS;

const resolveSessionTimeoutSeconds = (bindings = {}) => optionalInt(bindings.sessionTimeoutSeconds) ?? DEFAULT_SESSION_TIMEOUT_SECONDS;

const insecureTlsDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

const buildTlsOptions = (env = {}) => (env.skipTlsVerify ? { dispatcher: insecureTlsDispatcher } : {});

const makeTimeoutSignal = (timeoutMs) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeoutId) };
};

const buildEnv = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings || {};
  const baseUrl = normalizeBaseUrl(pickFirstString([bindings.baseUrl, bindings.restBaseUrl, bindings.host]));
  if (!baseUrl) throw errorWithCode('FAILED_PRECONDITION', 'bindings.baseUrl/restBaseUrl must be a valid http(s) URL');
  const username = pickFirstString([bindings.username, bindings.user]);
  const password = pickFirstString([bindings.password, bindings.pass]);
  if (!username || !password) throw errorWithCode('FAILED_PRECONDITION', 'bindings.username/user and bindings.password/pass are required');
  return {
    baseUrl,
    username,
    password,
    remark: pickFirstString([bindings.remark]) || DEFAULT_REMARK,
    ipdirection: optionalInt(bindings.ipdirection) ?? IP_DIRECTION_BLACK,
    ipstate: optionalInt(bindings.ipstate) ?? IP_STATE_ENABLED,
    listType: pickFirstString([bindings.listtype]) || LIST_TYPE_BLACK,
    timeoutMs: resolveTimeoutMs(callCtx),
    sessionTimeoutSeconds: resolveSessionTimeoutSeconds(bindings),
    headers: sanitizeHeaders(bindings.headers),
    skipTlsVerify: pickFirstBoolean([bindings.skipTlsVerify, bindings.tlsInsecureSkipVerify]) || false,
    log: buildLogger(callCtx.meta),
  };
};

const ensureIpList = (req = {}) => {
  for (const source of [req.ip_list, req.ipList, req.targets]) {
    if (source === undefined || source === null) continue;
    const arr = toArray(source);
    if (!arr) throw errorWithCode('INVALID_ARGUMENT', 'ip_list must be an array of strings');
    const normalized = arr.map((item) => pickString(item)?.trim() || '').filter(Boolean);
    if (normalized.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'ip_list must contain at least one non-empty IP');
    return normalized;
  }
  throw errorWithCode('INVALID_ARGUMENT', 'ip_list is required');
};

const extractRequestId = (req = {}) => pickFirstString([req.request_id, req.requestId]) || '';

const deriveStatus = (successCount, failureCount) => {
  if (successCount > 0 && failureCount > 0) return OPERATION_STATUS.PARTIAL;
  if (successCount > 0 && failureCount === 0) return OPERATION_STATUS.SUCCESS;
  return OPERATION_STATUS.FAILED;
};

const mapHttpStatus = (status) => {
  if (status === 401 || status === 403) return 'PERMISSION_DENIED';
  if (status >= 400 && status < 500) return 'FAILED_PRECONDITION';
  return 'UNAVAILABLE';
};

const requestDevice = async (env, options) => {
  const { path, method = 'GET', body, token, action = 'request' } = options;
  const headers = {
    'content-type': 'application/json',
    ...env.headers,
    ...(options.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const timeout = makeTimeoutSignal(env.timeoutMs);
  const fetchOptions = { method, headers, signal: timeout.signal, ...buildTlsOptions(env) };
  if (body !== undefined) fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
  let response;
  try {
    response = await fetch(`${env.baseUrl}${path}`, fetchOptions);
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', `${action} failed: ${err?.cause?.message || err?.message || 'fetch failed'}`);
  } finally {
    timeout.clear();
  }
  const text = await response.text();
  if (!response.ok) throw errorWithCode(mapHttpStatus(response.status), `${action} upstream http ${response.status}: ${text}`);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', `${action} response is not valid JSON`);
  }
};

const login = async (env) => {
  const payload = {
    language: 'zh-cn',
    username: env.username,
    userpwd: env.password,
    customize_time_out: env.sessionTimeoutSeconds,
    captchaId: '',
    verifyValue: '',
  };
  const json = await requestDevice(env, { path: LOGIN_PATH, method: 'POST', body: payload, action: 'login' });
  const resultCode = String(json?.result ?? '');
  const message = json?.message ?? '';
  const token = typeof message === 'object' && message !== null ? pickString(message.token) : pickString(json?.token);
  if (resultCode !== RESULT_SUCCESS || !token) {
    throw errorWithCode('UNAUTHENTICATED', `login failed: result=${resultCode || 'null'} message=${stringifyMessage(message)}`);
  }
  env.log('info', 'login_success', { code: resultCode });
  return token;
};

const logout = async (env, token) => {
  if (!token) return;
  try {
    await requestDevice(env, { path: LOGOUT_PATH, method: 'POST', token, body: {}, action: 'logout' });
    env.log('info', 'logout_success', { token });
  } catch (err) {
    env.log('error', 'logout_failed', { token, error: err?.message });
  }
};

const withSession = async (env, executor) => {
  let token;
  try {
    token = await login(env);
    return await executor(token);
  } finally {
    await logout(env, token);
  }
};

const isBlockSuccess = (code) => code === RESULT_SUCCESS || code === RESULT_ALREADY_EXISTS;
const isRemoveSuccess = (code) => code === RESULT_SUCCESS || code === RESULT_NOT_FOUND;

const executeBatchBlock = async (env, req = {}) => {
  const ipList = ensureIpList(req);
  const requestId = extractRequestId(req);
  return withSession(env, async (token) => {
    const payload = {
      listtype: env.listType,
      ipadd: ipList,
      ipdirection: env.ipdirection,
      ipstate: env.ipstate,
      remark: env.remark,
    };
    const json = await requestDevice(env, { path: BLOCK_PATH, method: 'POST', body: payload, token, action: 'batch_block' });
    const resultCode = String(json?.result ?? '');
    const message = stringifyMessage(json?.message);
    if (resultCode === RESULT_ALREADY_EXISTS) env.log('info', 'block_exists', { code: resultCode, message });
    else if (!isBlockSuccess(resultCode)) env.log('error', 'block_failed', { code: resultCode, message });
    const succeeded = isBlockSuccess(resultCode);
    const results = ipList.map((ip) => ({
      ip,
      succeeded,
      error_code: succeeded ? '' : resultCode,
      error_message: succeeded ? '' : message,
    }));
    const successCount = results.filter((item) => item.succeeded).length;
    const failureCount = results.length - successCount;
    return {
      status: deriveStatus(successCount, failureCount),
      requested_ip_count: ipList.length,
      success_count: successCount,
      failure_count: failureCount,
      upstream_result_code: resultCode,
      upstream_message: message,
      results,
      request_id: requestId,
    };
  });
};

const executeRemove = async (env, req = {}) => {
  const ip = pickFirstString([req.ip, req.target]);
  if (!ip) throw errorWithCode('INVALID_ARGUMENT', 'ip is required');
  const requestId = extractRequestId(req);
  return withSession(env, async (token) => {
    const query = `?listtype=${encodeURIComponent(env.listType)}&iplist=${encodeURIComponent(ip)}`;
    const json = await requestDevice(env, { path: `${DELETE_PATH}${query}`, method: 'DELETE', token, action: 'remove_block' });
    const resultCode = String(json?.result ?? '');
    const message = stringifyMessage(json?.message);
    if (resultCode === RESULT_NOT_FOUND) env.log('info', 'remove_not_found', { code: resultCode, message, ip });
    else if (!isRemoveSuccess(resultCode)) env.log('error', 'remove_failed', { code: resultCode, message, ip });
    const succeeded = isRemoveSuccess(resultCode);
    const result = {
      ip,
      succeeded,
      error_code: succeeded ? '' : resultCode,
      error_message: succeeded ? '' : message,
    };
    return {
      status: succeeded ? OPERATION_STATUS.SUCCESS : OPERATION_STATUS.FAILED,
      result,
      upstream_result_code: resultCode,
      upstream_message: message,
      request_id: requestId,
    };
  });
};

const runBatchBlock = (req = {}, ctx = {}) => executeBatchBlock(buildEnv(ctx), req);
const runRemove = (req = {}, ctx = {}) => executeRemove(buildEnv(ctx), req);

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  const resolveEnv = (() => {
    let cached;
    return () => {
      if (!cached) cached = buildEnv(callCtx);
      return cached;
    };
  })();
  const getReq = (incoming) => ({ ...(callCtx.req || {}), ...(incoming || {}) });
  return {
    [METHOD_BATCH_BLOCK_PATH]: async (req) => executeBatchBlock(resolveEnv(), getReq(req)),
    [METHOD_REMOVE_IP_PATH]: async (req) => executeRemove(resolveEnv(), getReq(req)),
  };
}

export const handlers = {
  [METHOD_BATCH_BLOCK_FULL]: (ctx = {}) => runBatchBlock(requestFromContext(ctx), ctx),
  [METHOD_REMOVE_IP_FULL]: (ctx = {}) => runRemove(requestFromContext(ctx), ctx),
};

export const _test = {
  buildEnv,
  buildLogger,
  buildTlsOptions,
  deriveStatus,
  errorWithCode,
  executeBatchBlock,
  executeRemove,
  extractRequestId,
  grpcCodeFor,
  hasOwn,
  insecureTlsDispatcher,
  isBlockSuccess,
  isPlainObject,
  isRemoveSuccess,
  login,
  logout,
  makeTimeoutSignal,
  mapHttpStatus,
  maskToken,
  normalizeBaseUrl,
  optionalInt,
  optionalPositiveNumber,
  pickBoolean,
  pickFirstBoolean,
  pickFirstString,
  pickString,
  requestDevice,
  resolveCallContext,
  resolveSessionTimeoutSeconds,
  resolveTimeoutMs,
  sanitizeHeaders,
  stringifyMessage,
  toArray,
  unwrapScalar,
  withSession,
};
