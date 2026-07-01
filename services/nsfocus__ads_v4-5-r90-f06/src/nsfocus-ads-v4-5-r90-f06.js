import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const BLOCK_IP_PATH = '/Nsfcous_ADS_V45R90F06.Nsfcous_ADS_V45R90F06/BlockIP';
export const UNBLOCK_IP_PATH = '/Nsfcous_ADS_V45R90F06.Nsfcous_ADS_V45R90F06/UnblockIP';
export const METHOD_BLOCK_IP_FULL = 'Nsfcous_ADS_V45R90F06.Nsfcous_ADS_V45R90F06/BlockIP';
export const METHOD_UNBLOCK_IP_FULL = 'Nsfcous_ADS_V45R90F06.Nsfcous_ADS_V45R90F06/UnblockIP';

export const DEFAULT_TIMEOUT_MS = 1500;
export const UPSTREAM_PATH = '/facade/unifiedInterface.php';
export const IDEMPOTENT_BLOCK_MESSAGE = '记录已在黑名单中';
export const SUCCESS_STATUS_CODES = new Set([200, 201, 204, 209, 210]);

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message, details) => {
  const finalMessage = details === undefined ? message : JSON.stringify(mergeObject({ message }, details));
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${finalMessage}`);
  err.legacyCode = code;
  if (details !== undefined) err.details = details;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const mergeObject = (...sources) => {
  const out = {};
  for (const src of sources) {
    if (!src || typeof src !== 'object') continue;
    for (const [key, value] of Object.entries(src)) {
      if (value !== undefined) out[key] = value;
    }
  }
  return out;
};

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const getNested = (obj, path) => {
  let cur = obj;
  for (const segment of path) {
    if (cur === undefined || cur === null) return undefined;
    cur = cur[segment];
  }
  return cur;
};

const normalizeBaseUrl = (value) => {
  const base = String(unwrapScalar(value) ?? '').trim();
  if (!/^https?:\/\//i.test(base)) return null;
  return base.replace(/\/$/, '');
};

const unwrapString = (value) => String(unwrapScalar(value) ?? '');

const isIPv4 = (value) => {
  const text = String(unwrapScalar(value));
  const parts = text.split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return false;
    if (part.length > 1 && part.charAt(0) === '0') return false;
    const num = Number(part);
    if (Number.isNaN(num) || num < 0 || num > 255) return false;
  }
  return true;
};

const isIPv6 = (value) => {
  const text = String(unwrapScalar(value));
  if (text.indexOf(':') < 0) return false;
  if ((text.match(/::/g) || []).length > 1) return false;
  if (/::ffff:\d{1,3}(?:\.\d{1,3}){3}$/i.test(text)) {
    return isIPv4(text.substring(text.lastIndexOf(':') + 1));
  }
  if (!/^[0-9a-fA-F:.]+$/.test(text)) return false;
  return true;
};

const getIp = (req) => {
  const value = unwrapString(firstDefined(req?.ip, req?.Ip)).trim();
  if (!value) throw errorWithCode('INVALID_ARGUMENT', 'ip is required');
  if (!isIPv4(value) && !isIPv6(value)) throw errorWithCode('INVALID_ARGUMENT', 'ip must be a valid IPv4 or IPv6 address');
  return value;
};

const isLikelyJSONObjectOrArray = (rawBody) => /^[\[{]/.test(String(rawBody || '').trim());

const parseResponseBody = (input) => {
  const text = String(input?.rawBody || '');
  if (!text.trim()) return { json: undefined, rawJSON: undefined };
  if (!isLikelyJSONObjectOrArray(text)) return { json: undefined, rawJSON: undefined };
  try {
    const parsed = JSON.parse(text);
    return {
      json: parsed,
      rawJSON: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined,
    };
  } catch {
    throw errorWithCode('UNKNOWN', 'response is not valid JSON', {
      status_code: input?.statusCode,
      raw_body: '',
      raw_body_length: text.length,
    });
  }
};

const containsErrorToken = (rawBody) => String(rawBody || '').toLowerCase().indexOf('error') >= 0;

const getActionErrorText = (json) => {
  const firstError = getNested(json, ['content', 'actionErrors', 0]);
  if (firstError === undefined || firstError === null) return '';
  if (typeof firstError === 'string') return firstError;
  try {
    return JSON.stringify(firstError);
  } catch {
    return String(firstError);
  }
};

const buildResponse = (input) => ({
  success: true,
  status_code: input.statusCode,
  message: input.message,
  raw_body: '',
  raw_json: undefined,
  idempotent_success: Boolean(input.idempotentSuccess),
});

const buildErrorDetails = (input) => ({
  success: false,
  status_code: input.statusCode,
  raw_body: '',
  raw_body_length: String(input.rawBody ?? '').length,
  raw_json: undefined,
  idempotent_success: Boolean(input.idempotentSuccess),
});

const encodeQuery = (params) => Object.entries(params)
  .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  .join('&');

const classifyBusinessResult = (input) => {
  const {
    actionType,
    statusCode,
    rawBody,
    json,
    rawJSON,
  } = input;

  if (statusCode === 401 || statusCode === 403) {
    throw errorWithCode('PERMISSION_DENIED', 'upstream permission denied', buildErrorDetails({
      statusCode,
      rawBody,
      rawJSON,
      idempotentSuccess: false,
    }));
  }

  const actionErrorText = getActionErrorText(json);
  const idempotentSuccess = actionType === 'add' && actionErrorText.indexOf(IDEMPOTENT_BLOCK_MESSAGE) >= 0;
  const statusAllowed = SUCCESS_STATUS_CODES.has(statusCode);
  const noErrorToken = !containsErrorToken(rawBody);

  if (idempotentSuccess) {
    return buildResponse({
      statusCode,
      rawBody,
      rawJSON,
      message: 'block ip succeeded idempotently',
      idempotentSuccess: true,
    });
  }

  if (statusAllowed && noErrorToken) {
    return buildResponse({
      statusCode,
      rawBody,
      rawJSON,
      message: actionType === 'add' ? 'block ip succeeded' : 'unblock ip succeeded',
      idempotentSuccess: false,
    });
  }

  throw errorWithCode('FAILED_PRECONDITION', actionType === 'add' ? 'block ip failed' : 'unblock ip failed', buildErrorDetails({
    statusCode,
    rawBody,
    rawJSON,
    idempotentSuccess: false,
  }));
};

const buildTransportErrorDetails = (baseUrl, ip, actionType, reason) => ({
  base_url: baseUrl,
  ip,
  action_type: actionType,
  reason,
});

let insecureTlsDispatcher;

const getInsecureTlsDispatcher = () => {
  insecureTlsDispatcher ??= new Agent({ connect: { rejectUnauthorized: false } });
  return insecureTlsDispatcher;
};

const buildFetchInit = (init, timeoutMs, skipTlsVerify) => ({
  ...init,
  signal: AbortSignal.timeout(timeoutMs),
  ...(skipTlsVerify ? { dispatcher: getInsecureTlsDispatcher() } : {}),
});

const fetchUpstream = async (baseUrl, key, headers, timeoutMs, skipTlsVerify, ip, actionType) => {
  const url = `${baseUrl}${UPSTREAM_PATH}?${encodeQuery({
    auth_key: key,
    target: 'blackList',
    action_type: actionType,
    ip,
  })}`;
  const init = buildFetchInit({
    method: 'GET',
    headers,
  }, timeoutMs, skipTlsVerify);

  try {
    const response = await fetch(url, init);
    const rawBody = await response.text();
    return {
      statusCode: Number(response.status) || 0,
      rawBody,
    };
  } catch (error) {
    const reason = error?.cause?.message || error?.message || 'fetch failed';
    throw errorWithCode('UNAVAILABLE', reason, buildTransportErrorDetails(baseUrl, ip, actionType, reason));
  }
};

const buildHeaders = (baseHeaders, meta) => mergeObject(baseHeaders || {}, {
  'x-engine-instance': (meta && (meta.instance_id || meta.instanceId)) || 'unknown',
  'x-request-id': (meta && (meta.request_id || meta.requestId)) || 'unknown',
});

const logFlow = (meta, action, details) => {
  const trace = [];
  const instanceId = meta && (meta.instance_id || meta.instanceId);
  const requestId = meta && (meta.request_id || meta.requestId);
  if (instanceId) trace.push(`inst=${instanceId}`);
  if (requestId) trace.push(`req=${requestId}`);
  const prefix = `[Nsfcous_ADS_V45R90F06][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
  try {
    console.log(prefix, JSON.stringify(details));
  } catch {
    console.log(prefix, details);
  }
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.bindings ?? {}),
  ...(ctx?.config ?? {}),
  ...(ctx?.secret ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.request ?? ctx.req ?? {},
});

const requestFromContext = (ctx = {}) => ctx?.request ?? ctx?.req ?? {};

const toPositiveTimeout = (value) => {
  const timeout = Number(unwrapScalar(value));
  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS;
};

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

const callAction = async (ctx, req, actionType) => {
  const callCtx = resolveCallContext(ctx);
  const request = req || callCtx.req || {};
  const bindings = callCtx.bindings || {};
  const meta = callCtx.meta || {};
  const limits = callCtx.limits || {};
  const baseUrl = normalizeBaseUrl(firstDefined(bindings.restBaseUrl, bindings.baseUrl, bindings.rest_base_url, bindings.base_url));
  if (!baseUrl) throw errorWithCode('INVALID_ARGUMENT', 'restBaseUrl/baseUrl is required (http/https)');

  const key = unwrapString(firstDefined(bindings.key, bindings.auth_key, bindings.authKey)).trim();
  if (!key) throw errorWithCode('INVALID_ARGUMENT', 'bindings.key is required');

  const ip = getIp(request);
  const timeoutMs = toPositiveTimeout(firstDefined(bindings.timeoutMs, bindings.timeout_ms, limits.timeoutMs, DEFAULT_TIMEOUT_MS));
  const headers = buildHeaders(bindings.headers || {}, meta);
  const skipTlsVerify = toBoolean(bindings.skipTlsVerify) || toBoolean(bindings.tlsInsecureSkipVerify) || toBoolean(bindings.insecureSkipVerify);

  logFlow(meta, actionType === 'add' ? 'BlockIP:start' : 'UnblockIP:start', { baseUrl, ip });
  const upstream = await fetchUpstream(baseUrl, key, headers, timeoutMs, skipTlsVerify, ip, actionType);
  const parsed = parseResponseBody({
    statusCode: upstream.statusCode,
    rawBody: upstream.rawBody,
  });
  const result = classifyBusinessResult({
    actionType,
    statusCode: upstream.statusCode,
    rawBody: upstream.rawBody,
    json: parsed.json,
    rawJSON: parsed.rawJSON,
  });
  logFlow(meta, actionType === 'add' ? 'BlockIP:done' : 'UnblockIP:done', {
    ip,
    status_code: result.status_code,
    idempotent_success: result.idempotent_success,
  });
  return result;
};

export function rpcdef(ctx) {
  const callCtx = resolveCallContext(ctx);
  return {
    [BLOCK_IP_PATH]: async (req) => callAction(callCtx, req, 'add'),
    [UNBLOCK_IP_PATH]: async (req) => callAction(callCtx, req, 'delete'),
  };
}

export const handlers = {
  [METHOD_BLOCK_IP_FULL]: (ctx = {}) => callAction(ctx, requestFromContext(ctx), 'add'),
  [METHOD_UNBLOCK_IP_FULL]: (ctx = {}) => callAction(ctx, requestFromContext(ctx), 'delete'),
};

export const _test = {
  buildErrorDetails,
  buildHeaders,
  buildResponse,
  buildTransportErrorDetails,
  callAction,
  classifyBusinessResult,
  containsErrorToken,
  encodeQuery,
  errorWithCode,
  fetchUpstream,
  getActionErrorText,
  getIp,
  isIPv4,
  isIPv6,
  logFlow,
  mergeObject,
  normalizeBaseUrl,
  parseResponseBody,
  toBoolean,
  toPositiveTimeout,
  unwrapString,
};
