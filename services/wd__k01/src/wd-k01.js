import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const METHOD_BLOCK_IP_PATH = '/WD_K01.WD_K01/BlockIP';
export const METHOD_UNBLOCK_IP_PATH = '/WD_K01.WD_K01/UnblockIP';
export const METHOD_BLOCK_IP_FULL = 'WD_K01.WD_K01/BlockIP';
export const METHOD_UNBLOCK_IP_FULL = 'WD_K01.WD_K01/UnblockIP';

export const LOGIN_PATH = '/api/cms/user/login';
export const LOGOUT_PATH = '/api/cms/user/logout';
export const IPLIST_SAVE_PATH = '/api/v1/security/iplist/save';
export const DEFAULT_TIMEOUT_MS = 1500;

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

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const pickStringFrom = (source = {}, keys = []) => {
  for (const key of keys) {
    if (!hasOwn(source, key)) continue;
    const raw = unwrapScalar(source[key]);
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (value) return value;
  }
  return '';
};

const pickFirstString = (values = []) => {
  for (const value of values) {
    const raw = unwrapScalar(value);
    if (raw === undefined || raw === null) continue;
    const str = String(raw).trim();
    if (str) return str;
  }
  return '';
};

const pickInt = (source = {}, keys = [], fallback = 0) => {
  for (const key of keys) {
    if (!hasOwn(source, key)) continue;
    const raw = unwrapScalar(source[key]);
    if (raw === undefined || raw === null || raw === '') continue;
    const num = Number(raw);
    if (Number.isFinite(num)) return Math.trunc(num);
  }
  return fallback;
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

const pickFirstBoolean = (values = []) => {
  for (const value of values) {
    const bool = pickBoolean(value);
    if (bool !== undefined) return bool;
  }
  return undefined;
};

const normalizeBaseUrl = (value) => {
  const raw = String(unwrapScalar(value) || '').trim();
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.replace(/\/+$/, '');
};

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: {
    ...(ctx.config ?? {}),
    ...(ctx.secret ?? {}),
    ...(ctx.bindings ?? {}),
  },
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.request ?? ctx.req ?? {},
});

const requestFromContext = (ctx = {}) => ctx.request ?? ctx.req ?? {};

const resolveHost = (bindings = {}) => normalizeBaseUrl(pickFirstString([bindings.host, bindings.restBaseUrl, bindings.baseUrl]));
const resolveUser = (bindings = {}) => pickStringFrom(bindings, ['user', 'username']);
const resolvePassword = (bindings = {}) => pickStringFrom(bindings, ['password']);

const resolveTimeoutMs = (ctx = {}) => {
  const raw = Number(unwrapScalar(ctx.limits?.timeoutMs ?? ctx.bindings?.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

const insecureTlsDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

const buildTlsOptions = (bindings = {}) => {
  const enabled = pickFirstBoolean([bindings.skipTlsVerify, bindings.tlsInsecureSkipVerify, bindings.insecureSkipVerify]) || false;
  return enabled ? { dispatcher: insecureTlsDispatcher } : {};
};

const makeTimeoutSignal = (timeoutMs) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeoutId) };
};

const sanitizeHeaders = (headers) => {
  const raw = unwrapScalar(headers);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([key]) => key).map(([key, value]) => [key, String(unwrapScalar(value) ?? '')]));
};

const buildHeaders = (bindings = {}, meta = {}, extra = {}) => ({
  ...sanitizeHeaders(bindings.headers),
  'x-engine-instance': pickFirstString([meta.instance_id, meta.instanceId, 'unknown']),
  'x-request-id': pickFirstString([meta.request_id, meta.requestId, 'unknown']),
  ...extra,
});

const parseJsonBody = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', 'response is not valid JSON');
  }
};

const throwForHttpStatus = (status, text) => {
  if (status === 401 || status === 403) throw errorWithCode('PERMISSION_DENIED', `upstream http ${status}: ${text}`);
  if (status >= 400 && status < 500) throw errorWithCode('FAILED_PRECONDITION', `upstream http ${status}: ${text}`);
  throw errorWithCode('UNAVAILABLE', `upstream http ${status}: ${text}`);
};

const fetchRaw = async (ctx, url, init = {}) => {
  const callCtx = resolveCallContext(ctx);
  const timeout = makeTimeoutSignal(resolveTimeoutMs(callCtx));
  let response;
  try {
    response = await fetch(url, {
      signal: timeout.signal,
      ...buildTlsOptions(callCtx.bindings),
      ...init,
      headers: buildHeaders(callCtx.bindings, callCtx.meta, init.headers || {}),
    });
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', err?.cause?.message || err?.message || 'fetch failed');
  } finally {
    timeout.clear();
  }
  const text = await response.text();
  if (!response.ok) throwForHttpStatus(response.status, text);
  return { text };
};

const fetchJson = async (ctx, url, init = {}) => {
  const { text } = await fetchRaw(ctx, url, init);
  if (!String(text || '').trim()) throw errorWithCode('UNKNOWN', 'response body is empty');
  return { json: parseJsonBody(text), text };
};

const requireBindings = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings || {};
  const host = resolveHost(bindings);
  if (!host) throw errorWithCode('INVALID_ARGUMENT', 'bindings.host is required');
  const user = resolveUser(bindings);
  if (!user) throw errorWithCode('INVALID_ARGUMENT', 'bindings.user/username is required');
  const password = resolvePassword(bindings);
  if (!password) throw errorWithCode('INVALID_ARGUMENT', 'bindings.password is required');
  return { ...callCtx, bindings, host, user, password };
};

const isIPv4 = (value) => {
  const raw = String(value || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255 && part.length <= 3);
};

const requireIpv4 = (value) => {
  const ip = String(unwrapScalar(value) || '').trim();
  if (!ip) throw errorWithCode('INVALID_ARGUMENT', 'ip is required');
  if (!isIPv4(ip)) throw errorWithCode('INVALID_ARGUMENT', 'ip must be a valid IPv4 address');
  return ip;
};

const normalizeIpMask = (raw) => {
  const input = String(unwrapScalar(raw) || '').trim();
  if (!input) throw errorWithCode('INVALID_ARGUMENT', 'ip is required');
  const segments = input.split('/');
  if (segments.length > 2) throw errorWithCode('INVALID_ARGUMENT', 'ip mask must be an integer in range [0, 32]');
  const ip = requireIpv4(segments[0]);
  const mask = segments[1] ? String(segments[1]).trim() : '32';
  const maskNum = Number(mask);
  if (!Number.isInteger(maskNum) || maskNum < 0 || maskNum > 32) throw errorWithCode('INVALID_ARGUMENT', 'ip mask must be an integer in range [0, 32]');
  return { ip, ipWithMask: `${ip}/${maskNum}` };
};

const logFlow = (ctx = {}, action, details = {}) => {
  const meta = ctx.meta || {};
  const trace = [];
  if (meta.instance_id || meta.instanceId) trace.push(`inst=${meta.instance_id || meta.instanceId}`);
  if (meta.request_id || meta.requestId) trace.push(`req=${meta.request_id || meta.requestId}`);
  const prefix = `[WD_K01][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
  try {
    console.log(prefix, JSON.stringify(details));
  } catch {
    console.log(prefix, details);
  }
};

const normalizeMsgType = (value) => String(value || '').trim().toLowerCase();
const msgContains = (msg, needle) => String(msg || '').includes(needle);
const isBlockSemanticSuccess = (msgType, msg) => normalizeMsgType(msgType) === 'success' || msgContains(msg, '已存在') || msgContains(msg, '多播地址');
const isUnblockSemanticSuccess = (msgType, msg) => normalizeMsgType(msgType) === 'success' || msgContains(msg, '对象不存在') || msgContains(msg, '多播地址');

const handleLogin = async (ctx = {}) => {
  const callCtx = requireBindings(ctx);
  const started = Date.now();
  const { json, text } = await fetchJson(callCtx, `${callCtx.host}${LOGIN_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ username: callCtx.user, password: callCtx.password }),
  });
  const token = pickStringFrom(json?.token || {}, ['access_token', 'accessToken']);
  if (hasOwn(json, 'error') || !token) {
    logFlow(callCtx, 'Login', { host: callCtx.host, user: callCtx.user, elapsed_ms: Date.now() - started, success: false });
    throw errorWithCode('FAILED_PRECONDITION', '用户登录失败');
  }
  logFlow(callCtx, 'Login', { host: callCtx.host, user: callCtx.user, elapsed_ms: Date.now() - started, success: true });
  return { token, raw: text };
};

const handleLogout = async (ctx = {}, token) => {
  const callCtx = requireBindings(ctx);
  const started = Date.now();
  const { text } = await fetchRaw(callCtx, `${callCtx.host}${LOGOUT_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${token}` },
  });
  logFlow(callCtx, 'Logout', { host: callCtx.host, user: callCtx.user, elapsed_ms: Date.now() - started, success: true });
  return text;
};

const validateBlockReq = (req = {}) => {
  const ip = requireIpv4(req.ip ?? req.IP ?? req.address);
  return {
    ip,
    type: pickInt(req, ['type'], 0),
    timeout: pickInt(req, ['timeout'], 0),
    timeType: pickInt(req, ['time_type', 'timeType'], 0),
    comment: String(unwrapScalar(req.comment ?? req.remark ?? '') ?? '').trim(),
    color: pickInt(req, ['color'], 0),
  };
};

const validateUnblockReq = (req = {}) => {
  const { ipWithMask } = normalizeIpMask(req.ip ?? req.IP ?? req.address);
  const type = pickInt(req, ['type'], 0);
  const color = pickInt(req, ['color'], 0);
  return { ipWithMask, type, color, computedId: `${ipWithMask};${color};${type}` };
};

const handleBlock = async (ctx = {}, token, params) => {
  const callCtx = requireBindings(ctx);
  const payload = {
    color: params.color,
    method: 'add',
    items: [{ type: params.type, ip: params.ip, timeout: params.timeout, time_type: params.timeType, comment: params.comment }],
  };
  const started = Date.now();
  const { json, text } = await fetchJson(callCtx, `${callCtx.host}${IPLIST_SAVE_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const msgType = json?.msgType;
  const msg = json?.msg;
  const success = isBlockSemanticSuccess(msgType, msg);
  logFlow(callCtx, 'BlockIP', { host: callCtx.host, user: callCtx.user, ip: params.ip, elapsed_ms: Date.now() - started, success, msgType });
  if (!success) throw errorWithCode('FAILED_PRECONDITION', String(msg || '封禁IP失败'));
  return { success: true, msg_type: String(msgType || ''), msg: String(msg || ''), raw_json: '' };
};

const handleUnblock = async (ctx = {}, token, params) => {
  const callCtx = requireBindings(ctx);
  const payload = {
    color: params.color,
    method: 'delete',
    items: [{ id: params.computedId, type: params.type, ip: params.ipWithMask }],
  };
  const started = Date.now();
  const { json, text } = await fetchJson(callCtx, `${callCtx.host}${IPLIST_SAVE_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const msgType = json?.msgType;
  const msg = json?.msg;
  const success = isUnblockSemanticSuccess(msgType, msg);
  logFlow(callCtx, 'UnblockIP', { host: callCtx.host, user: callCtx.user, ip: params.ipWithMask, elapsed_ms: Date.now() - started, success, msgType });
  if (!success) throw errorWithCode('FAILED_PRECONDITION', String(msg || '解封IP失败'));
  return {
    success: true,
    msg_type: String(msgType || ''),
    msg: String(msg || ''),
    raw_json: '',
    computed_id: params.computedId,
    computed_ip: params.ipWithMask,
  };
};

const withSession = async (ctx = {}, actionFn) => {
  const login = await handleLogin(ctx);
  let logoutText = '';
  try {
    const result = await actionFn(login);
    try {
      logoutText = await handleLogout(ctx, login.token);
    } catch (err) {
      logoutText = err?.message || String(err);
      logFlow(resolveCallContext(ctx), 'Logout', { success: false, error: logoutText });
    }
    return { result, loginRaw: login.raw, logoutText };
  } catch (err) {
    try {
      logoutText = await handleLogout(ctx, login.token);
    } catch (logoutErr) {
      logoutText = logoutErr?.message || String(logoutErr);
      logFlow(resolveCallContext(ctx), 'Logout', { success: false, error: logoutText });
    }
    throw err;
  }
};

const runBlockIP = async (req = {}, ctx = {}) => {
  const request = { ...requestFromContext(ctx), ...(req || {}) };
  const callCtx = resolveCallContext({ ...ctx, req: request, request });
  const params = validateBlockReq(callCtx.req || {});
  const { result, loginRaw, logoutText } = await withSession(callCtx, (login) => handleBlock(callCtx, login.token, params));
  return { ...result, login_raw_json: '', logout_raw_text: logoutText ? '[redacted]' : '' };
};

const runUnblockIP = async (req = {}, ctx = {}) => {
  const request = { ...requestFromContext(ctx), ...(req || {}) };
  const callCtx = resolveCallContext({ ...ctx, req: request, request });
  const params = validateUnblockReq(callCtx.req || {});
  const { result, loginRaw, logoutText } = await withSession(callCtx, (login) => handleUnblock(callCtx, login.token, params));
  return { ...result, login_raw_json: '', logout_raw_text: logoutText ? '[redacted]' : '' };
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_BLOCK_IP_PATH]: async (req) => runBlockIP(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_UNBLOCK_IP_PATH]: async (req) => runUnblockIP(req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_BLOCK_IP_FULL]: (ctx = {}) => runBlockIP(requestFromContext(ctx), ctx),
  [METHOD_UNBLOCK_IP_FULL]: (ctx = {}) => runUnblockIP(requestFromContext(ctx), ctx),
};

export const _test = {
  buildHeaders,
  buildTlsOptions,
  errorWithCode,
  fetchJson,
  fetchRaw,
  grpcCodeFor,
  handleBlock,
  handleLogin,
  handleLogout,
  handleUnblock,
  hasOwn,
  insecureTlsDispatcher,
  isBlockSemanticSuccess,
  isIPv4,
  isUnblockSemanticSuccess,
  logFlow,
  makeTimeoutSignal,
  msgContains,
  normalizeBaseUrl,
  normalizeIpMask,
  normalizeMsgType,
  parseJsonBody,
  pickBoolean,
  pickFirstBoolean,
  pickFirstString,
  pickInt,
  pickStringFrom,
  requireBindings,
  requireIpv4,
  resolveCallContext,
  resolveHost,
  resolvePassword,
  resolveTimeoutMs,
  resolveUser,
  sanitizeHeaders,
  throwForHttpStatus,
  unwrapScalar,
  validateBlockReq,
  validateUnblockReq,
  withSession,
};
