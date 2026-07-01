import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const DEFAULT_API_VERSION = '2.0';
export const DEFAULT_TIMEOUT_MS = 5000;

export const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INTERNAL: grpcStatus.INTERNAL,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

export const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) {
    return unwrapScalar(value.value);
  }
  return value;
};

const coerceString = (value) => {
  const unwrapped = unwrapScalar(value);
  if (unwrapped === undefined || unwrapped === null) return '';
  return String(unwrapped);
};

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const toPositiveInt = (value, fallback) => {
  const number = Number(unwrapScalar(value));
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.trunc(number);
};

export const normalizeBaseUrl = (baseUrl) => {
  const normalized = coerceString(baseUrl).trim().replace(/\/+$/, '');
  if (!normalized) {
    throw errorWithCode('INVALID_ARGUMENT', 'baseUrl is required');
  }
  if (!/^https?:\/\//i.test(normalized)) {
    throw errorWithCode('INVALID_ARGUMENT', 'baseUrl must start with http or https');
  }
  return normalized;
};

export const buildOpenApiUrl = (baseUrl, apiVersion, action) => {
  const cleanBaseUrl = normalizeBaseUrl(baseUrl);
  const cleanVersion = encodeURIComponent(coerceString(apiVersion || DEFAULT_API_VERSION).trim());
  const cleanAction = encodeURIComponent(coerceString(action).trim());
  if (!cleanAction) throw errorWithCode('INVALID_ARGUMENT', 'action is required');
  return `${cleanBaseUrl}/openapi/dbaudit/${cleanVersion}/${cleanAction}.json`;
};

export const buildRequestId = (now = Date.now) => String(now());

const pick = (ctx, ...keys) => {
  for (const source of [ctx?.config, ctx?.secret, ctx?.bindings]) {
    for (const key of keys) {
      if (hasOwn(source, key) && source[key] !== undefined && source[key] !== null) return source[key];
    }
  }
  return undefined;
};

export const buildAccessSign = (accessTime, accessKeySecret) => (
  crypto.createHash('md5').update(`${accessTime}_${accessKeySecret}`).digest('hex')
);

export const createOpenApiContext = (ctx = {}) => {
  const baseUrlValue = pick(ctx, 'baseUrl', 'base_url', 'endpoint');
  const baseUrl = baseUrlValue === undefined ? '' : normalizeBaseUrl(baseUrlValue);

  return {
    baseUrl,
    apiVersion: coerceString(firstDefined(pick(ctx, 'apiVersion', 'api_version'), DEFAULT_API_VERSION)).trim() || DEFAULT_API_VERSION,
    accessKeyId: coerceString(pick(ctx, 'accessKeyId', 'access_key_id', 'accessKey', 'access_key')).trim(),
    accessKeySecret: coerceString(pick(ctx, 'accessKeySecret', 'access_key_secret', 'accessSecret', 'access_secret')).trim(),
    timeoutMs: toPositiveInt(pick(ctx, 'timeoutMs', 'timeout_ms'), DEFAULT_TIMEOUT_MS),
  };
};

const encodeOpenApiParams = ({ data, accessKeyId, accessKeySecret, accessTime }) => {
  if (!accessKeyId) throw errorWithCode('INVALID_ARGUMENT', 'accessKeyId is required');
  if (!accessKeySecret) throw errorWithCode('INVALID_ARGUMENT', 'accessKeySecret is required');

  const params = new URLSearchParams();
  params.set('data', JSON.stringify(data ?? {}));
  params.set('accessKeyId', accessKeyId);
  params.set('accessTime', accessTime);
  params.set('accessSign', buildAccessSign(accessTime, accessKeySecret));
  return params;
};

const isBusinessFailure = (parsed) => {
  if (!parsed || typeof parsed !== 'object') return true;
  return parsed.success !== true || String(parsed.code) !== '200';
};

export const callDbauditOpenApi = async ({ ctx, action, method = 'GET', data = {}, now = Date.now }) => {
  const upperMethod = coerceString(method).trim().toUpperCase();
  if (upperMethod !== 'GET' && upperMethod !== 'POST') {
    throw errorWithCode('INVALID_ARGUMENT', `unsupported method: ${method}`);
  }

  const openApiContext = createOpenApiContext(ctx);
  if (!openApiContext.baseUrl) throw errorWithCode('INVALID_ARGUMENT', 'baseUrl is required');

  const accessTime = buildRequestId(now);
  const params = encodeOpenApiParams({
    data,
    accessKeyId: openApiContext.accessKeyId,
    accessKeySecret: openApiContext.accessKeySecret,
    accessTime,
  });

  let url = buildOpenApiUrl(openApiContext.baseUrl, openApiContext.apiVersion, action);
  const headers = {};
  const init = { method: upperMethod, headers };
  if (upperMethod === 'GET') {
    url = `${url}?${params.toString()}`;
  } else {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = params;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), openApiContext.timeoutMs);
  init.signal = controller.signal;

  let response;
  let responseText;
  try {
    response = await globalThis.fetch(url, init);
    responseText = await response.text();
  } catch (cause) {
    const err = errorWithCode('UNAVAILABLE', cause?.message || 'network failure');
    err.cause = cause;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const status = Number(response.status || 0);
  const httpOk = status >= 200 && status < 300;

  if (!httpOk) {
    const err = errorWithCode('UNAVAILABLE', `upstream http ${response.status}`);
    err.httpStatus = response.status;
    err.httpBody = responseText;
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(responseText);
  } catch (cause) {
    const err = errorWithCode('INTERNAL', 'upstream returned non-JSON response');
    err.cause = cause;
    throw err;
  }

  if (isBusinessFailure(parsed)) {
    const err = errorWithCode('FAILED_PRECONDITION', parsed.message || parsed.msg || 'upstream business failure');
    err.upstream = parsed;
    throw err;
  }

  return parsed;
};

export const _test = {
  coerceString,
  firstDefined,
  toPositiveInt,
};
