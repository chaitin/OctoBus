import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const CHECK_ONLINE_PATH = '/Fortinet_WAF.Fortinet_WAF/CheckOnline';
export const BLOCK_IP_PATH = '/Fortinet_WAF.Fortinet_WAF/BlockIP';
export const LIST_MEMBERS_PATH = '/Fortinet_WAF.Fortinet_WAF/ListIPListMembers';
export const UNBLOCK_IP_PATH = '/Fortinet_WAF.Fortinet_WAF/UnblockIP';

export const METHOD_CHECK_ONLINE_FULL = 'Fortinet_WAF.Fortinet_WAF/CheckOnline';
export const METHOD_BLOCK_IP_FULL = 'Fortinet_WAF.Fortinet_WAF/BlockIP';
export const METHOD_LIST_MEMBERS_FULL = 'Fortinet_WAF.Fortinet_WAF/ListIPListMembers';
export const METHOD_UNBLOCK_IP_FULL = 'Fortinet_WAF.Fortinet_WAF/UnblockIP';

export const DEFAULT_TIMEOUT_MS = 1500;
export const DEFAULT_TYPE = 2;
export const DEFAULT_SEVERITY = 2;
export const DEFAULT_TRIGGER_POLICY = '';
let insecureDispatcherPromise;

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message, details) => {
  const finalMessage = details === undefined ? String(message) : JSON.stringify({ code, message, ...details });
  const err = new GrpcError(grpcCodeFor(code), finalMessage);
  err.legacyCode = code;
  if (details !== undefined) err.details = details;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const firstDefined = (...vals) => vals.find((val) => val !== undefined && val !== null);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return String(value);
};

const trimString = (value) => unwrapScalar(value).trim();

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

const resolveHost = (bindings) => {
  for (const key of ['host', 'restBaseUrl', 'rest_base_url', 'baseUrl', 'base_url', 'endpoint']) {
    const value = normalizeBaseUrl(bindings?.[key]);
    if (value) return value;
  }
  return '';
};

const resolveUsername = (bindings) => trimString(firstDefined(bindings?.username, bindings?.user));
const resolvePassword = (bindings) => trimString(bindings?.password);

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

const utf8Bytes = (value) => {
  if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(value));
  return Array.from(unescape(encodeURIComponent(value))).map((char) => char.charCodeAt(0));
};

const toBase64 = (value) => {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes = utf8Bytes(String(value));
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const triplet = (a << 16) | (b << 8) | c;
    output += table[(triplet >> 18) & 0x3f];
    output += table[(triplet >> 12) & 0x3f];
    output += i + 1 < bytes.length ? table[(triplet >> 6) & 0x3f] : '=';
    output += i + 2 < bytes.length ? table[triplet & 0x3f] : '=';
  }
  return output;
};

const buildHeaders = (bindings, meta, username, password, extra = {}) => ({
  ...(bindings?.headers || {}),
  ...extra,
  Accept: 'application/json',
  'Content-Type': 'application/json',
  Authorization: toBase64(`${username}:${password}`),
  'x-engine-instance': meta?.instance_id || meta?.instanceId || 'unknown',
  'x-request-id': meta?.request_id || meta?.requestId || 'unknown',
});

const stringifyJson = (value) => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const parseJsonSafe = (text) => {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
};

const toInt = (value, fallback = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num) || Number.isNaN(num)) return fallback;
  return Math.trunc(num);
};

const toValue = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return { nullValue: 'NULL_VALUE' };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return Number.isFinite(value) ? { numberValue: value } : { stringValue: String(value) };
  if (typeof value === 'boolean') return { boolValue: value };
  if (Array.isArray(value)) return { listValue: { values: value.map((item) => toValue(item)).filter((item) => item !== undefined) } };
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

const isIPv4 = (value) => {
  const raw = String(value || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255 && part.length <= 3);
};

const isIPv6 = (value) => {
  const raw = String(value || '').trim();
  if (!raw.includes(':')) return false;
  if (!/^[0-9a-fA-F:]+$/.test(raw)) return false;
  if ((raw.match(/::/g) || []).length > 1) return false;
  const parts = raw.split(':');
  if (parts.length > 8) return false;
  return parts.every((part) => part === '' || /^[0-9a-fA-F]{1,4}$/.test(part));
};

const requireBindingsHost = (bindings) => {
  const host = resolveHost(bindings);
  if (!host) throw errorWithCode('INVALID_ARGUMENT', 'host is required in bindings');
  return host;
};

const requireBindingsUsername = (bindings) => {
  const username = resolveUsername(bindings);
  if (!username) throw errorWithCode('INVALID_ARGUMENT', 'username is required in bindings');
  return username;
};

const requireBindingsPassword = (bindings) => {
  const password = resolvePassword(bindings);
  if (!password) throw errorWithCode('INVALID_ARGUMENT', 'password is required in bindings');
  return password;
};

const requireBookName = (value) => {
  const bookName = trimString(value);
  if (!bookName) throw errorWithCode('INVALID_ARGUMENT', 'book_name is required');
  return bookName;
};

const requireIP = (value) => {
  const ip = trimString(value);
  if (!ip) throw errorWithCode('INVALID_ARGUMENT', 'ip is required');
  if (!isIPv4(ip) && !isIPv6(ip)) throw errorWithCode('INVALID_ARGUMENT', 'ip must be a valid IPv4 or IPv6 address');
  return ip;
};

const requireMemberId = (value) => {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) throw errorWithCode('INVALID_ARGUMENT', 'member_id must be a positive integer');
  return num;
};

const logFlow = (ctx, action, details) => {
  const meta = ctx?.meta || {};
  const trace = [];
  if (meta.instance_id || meta.instanceId) trace.push(`inst=${meta.instance_id || meta.instanceId}`);
  if (meta.request_id || meta.requestId) trace.push(`req=${meta.request_id || meta.requestId}`);
  const prefix = `[Fortinet_WAF][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
  try {
    console.log(prefix, JSON.stringify(details));
  } catch {
    console.log(prefix, details);
  }
};

const joinUrl = (baseUrl, ...segments) => {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const path = segments
    .filter((segment) => segment !== undefined && segment !== null)
    .map((segment) => encodeURIComponent(String(segment)).replace(/%2F/g, '/'))
    .join('/');
  return `${base}/${path}`;
};

const classifyHttpStatus = (status) => {
  if (status === 401 || status === 403) return 'PERMISSION_DENIED';
  if (status >= 400 && status < 500) return 'FAILED_PRECONDITION';
  return 'UNAVAILABLE';
};

const failWithResponse = (code, message, status, rawBody, rawJSON, reason) => {
  const bodyText = String(rawBody ?? '');
  throw errorWithCode(code, message, {
    http_status: status,
    raw_body: '',
    raw_body_length: bodyText.length,
    raw_json: undefined,
    reason,
  });
};

const ensureJSONObject = (value, action, status, rawBody) => {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    failWithResponse('UNKNOWN', `${action} response is not a JSON object`, status, rawBody, value, 'response_type_mismatch');
  }
  return value;
};

const fetchJSON = async (ctx, url, init = {}) => {
  const callCtx = resolveCallContext(ctx);
  const username = requireBindingsUsername(callCtx.bindings);
  const password = requireBindingsPassword(callCtx.bindings);
  let response;
  try {
    response = await fetchWithTimeout(url, {
      ...init,
      headers: buildHeaders(callCtx.bindings, callCtx.meta, username, password, init.headers || {}),
    }, { timeoutMs: resolveTimeoutMs(callCtx), bindings: callCtx.bindings });
  } catch (err) {
    failWithResponse('UNAVAILABLE', 'fortinet waf upstream request failed', 0, '', null, err?.cause?.message || err?.message || 'fetch failed');
  }

  const rawBody = String((await response.text()) ?? '');
  const parsed = rawBody.trim() ? parseJsonSafe(rawBody) : { ok: false, value: null };
  const rawJSON = parsed.ok ? parsed.value : null;

  if (!response.ok) {
    failWithResponse(
      classifyHttpStatus(response.status),
      `fortinet waf upstream http ${response.status}`,
      response.status,
      rawBody,
      rawJSON,
      'http_status_not_ok',
    );
  }

  if (!parsed.ok) {
    failWithResponse('UNKNOWN', 'response is not valid JSON', response.status, rawBody, null, 'invalid_json');
  }

  return {
    status: response.status,
    rawBody,
    rawJSON,
  };
};

const toOnlineResponse = (statusCode, rawBody, rawJSON) => ({
  success: true,
  http_status: statusCode,
  status: toInt(rawJSON?.status, 0),
  msg: trimString(rawJSON?.msg),
  version: trimString(rawJSON?.version),
  raw_body: '',
  raw_json: undefined,
});

const toMutationResponse = (statusCode, rawBody, rawJSON) => ({
  success: true,
  http_status: statusCode,
  status: toInt(rawJSON?.status, 0),
  affected: toInt(rawJSON?.affected, 0),
  msg: trimString(rawJSON?.msg),
  raw_body: '',
  raw_json: undefined,
});

const mapMember = (item, statusCode, rawBody) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    failWithResponse('UNKNOWN', 'fortinet waf list member is not an object', statusCode, rawBody, item, 'member_shape_invalid');
  }
  const memberId = toInt(item?.id, 0);
  const ip = trimString(item?.iPv4IPv6);
  if (memberId <= 0 || !ip) {
    failWithResponse('UNKNOWN', 'fortinet waf list member missing id or ip', statusCode, rawBody, item, 'member_fields_missing');
  }
  return {
    member_id: memberId,
    type: toInt(item?.type, 0),
    ip,
    severity: toInt(item?.severity, 0),
    trigger_policy: trimString(item?.triggerPolicy),
    status: toInt(item?.status, 0),
  };
};

const requestBookName = (req) => req?.book_name ?? req?.bookName;
const requestMemberId = (req) => req?.member_id ?? req?.memberId;

const handleCheckOnline = async (ctx) => {
  const callCtx = resolveCallContext(ctx);
  const host = requireBindingsHost(callCtx.bindings);
  const started = Date.now();
  const url = joinUrl(host, 'api', 'v1.0', 'System', 'Status', 'Online');
  const result = await fetchJSON(callCtx, url, { method: 'GET' });
  const json = ensureJSONObject(result.rawJSON, 'check_online', result.status, result.rawBody);
  if (toInt(json?.status, 0) !== 1) {
    failWithResponse('FAILED_PRECONDITION', 'fortinet waf is not online', result.status, result.rawBody, json, 'status_not_one');
  }
  logFlow(callCtx, 'CheckOnline', { http_status: result.status, elapsed_ms: Date.now() - started, success: true });
  return toOnlineResponse(result.status, result.rawBody, json);
};

const handleBlockIP = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const host = requireBindingsHost(callCtx.bindings);
  const bookName = requireBookName(requestBookName(req));
  const ip = requireIP(req?.ip);
  const started = Date.now();
  const url = joinUrl(host, 'api', 'v1.0', 'WebProtection', 'Access', 'IPList', bookName, 'IPListCreateIPListPolicyMember');
  const payload = {
    type: DEFAULT_TYPE,
    iPv4IPv6: ip,
    severity: DEFAULT_SEVERITY,
    triggerPolicy: DEFAULT_TRIGGER_POLICY,
  };
  const result = await fetchJSON(callCtx, url, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const json = ensureJSONObject(result.rawJSON, 'block_ip', result.status, result.rawBody);
  logFlow(callCtx, 'BlockIP', { book_name: bookName, ip, http_status: result.status, elapsed_ms: Date.now() - started, success: true });
  return toMutationResponse(result.status, result.rawBody, json);
};

const handleListMembers = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const host = requireBindingsHost(callCtx.bindings);
  const bookName = requireBookName(requestBookName(req));
  const started = Date.now();
  const url = joinUrl(host, 'api', 'v1.0', 'WebProtection', 'Access', 'IPList', bookName, 'IPListCreateIPListPolicyMember');
  const result = await fetchJSON(callCtx, url, { method: 'GET' });
  if (!Array.isArray(result.rawJSON)) {
    failWithResponse('UNKNOWN', 'fortinet waf list response is not an array', result.status, result.rawBody, result.rawJSON, 'response_type_mismatch');
  }
  const members = result.rawJSON.map((item) => mapMember(item, result.status, result.rawBody));
  logFlow(callCtx, 'ListIPListMembers', { book_name: bookName, count: members.length, http_status: result.status, elapsed_ms: Date.now() - started, success: true });
  return {
    members,
    http_status: result.status,
    raw_body: '',
    raw_json: undefined,
  };
};

const handleUnblockIP = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const host = requireBindingsHost(callCtx.bindings);
  const bookName = requireBookName(requestBookName(req));
  const memberId = requireMemberId(requestMemberId(req));
  const started = Date.now();
  const url = joinUrl(host, 'api', 'v1.0', 'WebProtection', 'Access', 'IPList', bookName, 'IPListCreateIPListPolicyMember', memberId);
  const result = await fetchJSON(callCtx, url, { method: 'DELETE' });
  const json = ensureJSONObject(result.rawJSON, 'unblock_ip', result.status, result.rawBody);
  if (toInt(json?.affected, 0) !== 1) {
    failWithResponse('FAILED_PRECONDITION', 'fortinet waf unblock failed', result.status, result.rawBody, json, 'affected_not_one');
  }
  logFlow(callCtx, 'UnblockIP', { book_name: bookName, member_id: memberId, http_status: result.status, elapsed_ms: Date.now() - started, success: true });
  return toMutationResponse(result.status, result.rawBody, json);
};

const registerHandlers = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  return {
    [CHECK_ONLINE_PATH]: () => handleCheckOnline(callCtx),
    [BLOCK_IP_PATH]: (req = callCtx.req) => handleBlockIP(req ?? {}, callCtx),
    [LIST_MEMBERS_PATH]: (req = callCtx.req) => handleListMembers(req ?? {}, callCtx),
    [UNBLOCK_IP_PATH]: (req = callCtx.req) => handleUnblockIP(req ?? {}, callCtx),
  };
};

export function rpcdef(ctx = {}) {
  return registerHandlers(ctx);
}

const callSdkHandler = (ctx, path) => registerHandlers(ctx)[path](ctx?.req ?? ctx?.request ?? {});

export const handlers = {
  [METHOD_CHECK_ONLINE_FULL]: (ctx) => callSdkHandler(ctx, CHECK_ONLINE_PATH),
  [METHOD_BLOCK_IP_FULL]: (ctx) => callSdkHandler(ctx, BLOCK_IP_PATH),
  [METHOD_LIST_MEMBERS_FULL]: (ctx) => callSdkHandler(ctx, LIST_MEMBERS_PATH),
  [METHOD_UNBLOCK_IP_FULL]: (ctx) => callSdkHandler(ctx, UNBLOCK_IP_PATH),
};

rpcdef.__test__ = {
  buildHeaders,
  buildTlsOptions,
  CHECK_ONLINE_PATH,
  BLOCK_IP_PATH,
  classifyHttpStatus,
  createTlsDispatcher,
  DEFAULT_SEVERITY,
  DEFAULT_TRIGGER_POLICY,
  DEFAULT_TYPE,
  errorWithCode,
  failWithResponse,
  fetchWithTimeout,
  fetchJSON,
  firstDefined,
  handleBlockIP,
  handleCheckOnline,
  handleListMembers,
  handleUnblockIP,
  hasOwn,
  isIPv4,
  isIPv6,
  joinUrl,
  logFlow,
  mapMember,
  mergedBindings,
  normalizeBaseUrl,
  parseJsonSafe,
  registerHandlers,
  requireBindingsHost,
  requireBindingsPassword,
  requireBindingsUsername,
  requireBookName,
  requireIP,
  requireMemberId,
  resolveCallContext,
  resolveHost,
  resolvePassword,
  resolveTimeoutMs,
  resolveUsername,
  shouldSkipTlsVerify,
  stringifyJson,
  toBase64,
  toInt,
  toMutationResponse,
  toOnlineResponse,
  toValue,
  trimString,
  unwrapScalar,
  utf8Bytes,
};

export const _test = rpcdef.__test__;
