import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const METHOD_BLOCK_DOMAIN_PATH = '/ThreatBook_TDP.ThreatBook_TDP/BlockDomain';
export const METHOD_UNBLOCK_DOMAIN_PATH = '/ThreatBook_TDP.ThreatBook_TDP/UnblockDomain';

export const METHOD_BLOCK_DOMAIN_FULL = 'ThreatBook_TDP.ThreatBook_TDP/BlockDomain';
export const METHOD_UNBLOCK_DOMAIN_FULL = 'ThreatBook_TDP.ThreatBook_TDP/UnblockDomain';

export const DEFAULT_TIMEOUT_MS = 2000;
export const TDP_OPERATE_PATH = '/api/v1/linkage_block/deny_list/operate';
export const TRANSPORT_SUCCESS_CODES = new Set([200, 201, 204, 209, 210]);

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
const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const trimString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

const toValue = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return Number.isFinite(value) ? { numberValue: value } : { stringValue: String(value) };
  if (typeof value === 'boolean') return { boolValue: value };
  if (Array.isArray(value)) {
    return { listValue: { values: value.map(toValue).filter((item) => item !== undefined) } };
  }
  if (typeof value === 'object') {
    const fields = {};
    for (const [key, innerValue] of Object.entries(value)) {
      fields[key] = toValue(innerValue) ?? { nullValue: 'NULL_VALUE' };
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(value) };
};

const extractList = (rawList) => {
  const raw = unwrapScalar(rawList);
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object' && Array.isArray(raw.values)) return raw.values;
  return [];
};

const normalizeBaseUrl = (url) => {
  const base = trimString(url);
  if (!/^https?:\/\//i.test(base)) return null;
  return base.replace(/\/+$/, '');
};

const toBoolean = (value) => {
  const raw = unwrapScalar(value);
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw !== 0;
  if (typeof raw === 'string') {
    const text = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'n', 'off', ''].includes(text)) return false;
  }
  return false;
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const sanitizeSensitiveText = (value, sensitiveValues = []) => {
  let text = String(value ?? '');
  text = text.replace(/((?:api_key|apikey|sign|auth_timestamp)=)[^&\s"'<>]+/gi, '$1***');
  for (const secretValue of sensitiveValues) {
    const secretText = String(secretValue ?? '');
    if (secretText.length < 3) continue;
    text = text.replace(new RegExp(escapeRegExp(secretText), 'g'), '***');
  }
  return text;
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

const normalizeBindings = (rawBindings = {}) => {
  const restBaseUrl = firstDefined(rawBindings.restBaseUrl, rawBindings.baseUrl);
  const baseUrl = normalizeBaseUrl(restBaseUrl);
  if (!baseUrl) throw errorWithCode('INVALID_ARGUMENT', 'restBaseUrl/baseUrl binding is required (http/https)');
  const apiKey = trimString(firstDefined(rawBindings.api_key, rawBindings.apiKey));
  if (!apiKey) throw errorWithCode('INVALID_ARGUMENT', 'api_key binding is required');
  const secret = trimString(firstDefined(rawBindings.secret, rawBindings.Secret));
  if (!secret) throw errorWithCode('INVALID_ARGUMENT', 'secret binding is required');
  const headers = rawBindings.headers && typeof rawBindings.headers === 'object' ? rawBindings.headers : {};
  const skipTlsVerify = toBoolean(firstDefined(rawBindings.tlsInsecureSkipVerify, rawBindings.skipTlsVerify));
  return { baseUrl, apiKey, secret, headers, skipTlsVerify };
};

const resolveTimeoutMs = (ctx = {}) => {
  const raw = Number(firstDefined(ctx.limits?.timeoutMs, ctx.bindings?.timeoutMs, DEFAULT_TIMEOUT_MS));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

const insecureTlsDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

const buildTlsOptions = (bindings = {}) => (bindings.skipTlsVerify ? { dispatcher: insecureTlsDispatcher } : {});

const makeTimeoutSignal = (timeoutMs) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeoutId) };
};

const computeTimestampSeconds = () => Math.floor(Date.now() / 1000);

const generateHmacSha256Signature = (apiKey, secret, timestamp) => crypto
  .createHmac('sha256', String(secret))
  .update(`${apiKey}${timestamp}`)
  .digest('base64')
  .replaceAll('+', '-')
  .replaceAll('/', '_')
  .replace(/=+$/g, '');

const buildOperateUrl = ({ baseUrl, apiKey, secret, timestampSec }) => {
  const sign = generateHmacSha256Signature(apiKey, secret, timestampSec);
  const query = `api_key=${encodeURIComponent(apiKey)}&auth_timestamp=${encodeURIComponent(timestampSec)}&sign=${encodeURIComponent(sign)}`;
  return { url: `${baseUrl}${TDP_OPERATE_PATH}?${query}`, sign };
};

const buildLogPrefix = (meta = {}, action) => {
  const trace = [];
  if (meta.instance_id || meta.instanceId) trace.push(`inst=${meta.instance_id || meta.instanceId}`);
  if (meta.request_id || meta.requestId) trace.push(`req=${meta.request_id || meta.requestId}`);
  return `[ThreatBook_TDP][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
};

const logFlow = (meta, action, details) => {
  const prefix = buildLogPrefix(meta, action);
  try {
    console.log(prefix, JSON.stringify(details));
  } catch {
    console.log(prefix, details);
  }
};

const normalizeIocList = (req = {}) => {
  const rawIocList = firstDefined(req.ioc_list, req.iocList);
  const iocList = extractList(rawIocList)
    .map((item) => trimString(item))
    .filter((item) => item);
  if (iocList.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'ioc_list is required and must not be empty');
  return iocList;
};

const normalizeRemark = (req = {}, iocList = []) => {
  const remark = trimString(firstDefined(req.remark, req.Remark));
  if (remark) return remark;
  return `${iocList[0]}${iocList.length > 1 ? ` 等${iocList.length}个域名` : ''},万象联动封禁`;
};

const mapHttpError = (statusCode, text, sensitiveValues = []) => {
  const sanitized = sanitizeSensitiveText(text, sensitiveValues);
  if (statusCode === 401 || statusCode === 403) throw errorWithCode('PERMISSION_DENIED', `upstream http ${statusCode}: ${sanitized}`);
  if (statusCode >= 400 && statusCode < 500) throw errorWithCode('FAILED_PRECONDITION', `upstream http ${statusCode}: ${sanitized}`);
  throw errorWithCode('UNAVAILABLE', `upstream http ${statusCode}: ${sanitized}`);
};

const parseSuccessBody = (text, meta, actionLabel, statusCode, sensitiveValues = []) => {
  if (!String(text || '').trim()) return { data: null };
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    const sanitizedText = sanitizeSensitiveText(text, sensitiveValues);
    const excerpt = sanitizedText.length > 100 ? `${sanitizedText.substring(0, 100)}...` : sanitizedText;
    logFlow(meta, `${actionLabel}_ParseError`, { http_status: statusCode, text: excerpt });
    throw errorWithCode('UNKNOWN', 'response is not valid JSON');
  }
  const responseCodeRaw = firstDefined(json.response_code, json.responseCode, json.code);
  if (responseCodeRaw !== undefined) {
    const responseCode = Number(responseCodeRaw);
    if (responseCode !== 0) {
      const responseMessage = sanitizeSensitiveText(trimString(firstDefined(json.response_message, json.verbose_msg, json.message)), sensitiveValues);
      throw errorWithCode('FAILED_PRECONDITION', `response_code=${responseCode}: ${responseMessage || 'TDP business failure'}`);
    }
  }
  return { data: toValue(json) };
};

const prepareRuntime = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  return {
    ...callCtx,
    bindings: normalizeBindings(callCtx.bindings),
    timeoutMs: resolveTimeoutMs(callCtx),
  };
};

const operateDomain = async (req = {}, ctx = {}, actionLabel, operationType) => {
  const runtime = prepareRuntime(ctx);
  const startTime = Date.now();
  const iocList = normalizeIocList(req);
  const remark = normalizeRemark(req, iocList);
  const timestampSec = computeTimestampSeconds();
  const { url, sign } = buildOperateUrl({
    baseUrl: runtime.bindings.baseUrl,
    apiKey: runtime.bindings.apiKey,
    secret: runtime.bindings.secret,
    timestampSec,
  });
  const sensitiveValues = [runtime.bindings.apiKey, runtime.bindings.secret, sign];
  const payload = {
    block_direction: 'out',
    operate: operationType,
    ioc_list: iocList,
    remark,
  };
  const headers = {
    'Content-Type': 'application/json;charset=UTF-8',
    ...runtime.bindings.headers,
  };
  const timeout = makeTimeoutSignal(runtime.timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: timeout.signal,
      ...buildTlsOptions(runtime.bindings),
    });
  } catch (err) {
    const reason = sanitizeSensitiveText(err?.cause?.message || err?.message || 'fetch failed', sensitiveValues);
    logFlow(runtime.meta, actionLabel, {
      ioc_list: iocList,
      attempt_url: runtime.bindings.baseUrl,
      status: 'fetch_error',
      latency: Date.now() - startTime,
      reason,
    });
    throw errorWithCode('UNAVAILABLE', reason);
  } finally {
    timeout.clear();
  }

  let text;
  try {
    text = await res.text();
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', sanitizeSensitiveText(err?.message || 'response read failed', sensitiveValues));
  }
  const statusCode = res.status;
  const isSuccess = TRANSPORT_SUCCESS_CODES.has(statusCode);
  logFlow(runtime.meta, actionLabel, {
    ioc_list: iocList,
    attempt_url: runtime.bindings.baseUrl,
    http_status: statusCode,
    success: isSuccess,
    latency: Date.now() - startTime,
    api_key_present: Boolean(runtime.bindings.apiKey),
    timestampSec,
    sign_len: sign.length,
  });

  if (!isSuccess) mapHttpError(statusCode, text, sensitiveValues);
  return parseSuccessBody(text, runtime.meta, actionLabel, statusCode, sensitiveValues);
};

const blockDomain = (req = {}, ctx = {}) => operateDomain(req, ctx, 'BlockDomain', 'add');
const unblockDomain = (req = {}, ctx = {}) => operateDomain(req, ctx, 'UnblockDomain', 'delete');

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_BLOCK_DOMAIN_PATH]: async (req) => blockDomain(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_UNBLOCK_DOMAIN_PATH]: async (req) => unblockDomain(req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_BLOCK_DOMAIN_FULL]: (ctx = {}) => blockDomain(requestFromContext(ctx), ctx),
  [METHOD_UNBLOCK_DOMAIN_FULL]: (ctx = {}) => unblockDomain(requestFromContext(ctx), ctx),
};

export const _test = {
  blockDomain,
  buildLogPrefix,
  buildOperateUrl,
  buildTlsOptions,
  computeTimestampSeconds,
  errorWithCode,
  escapeRegExp,
  extractList,
  firstDefined,
  generateHmacSha256Signature,
  grpcCodeFor,
  hasOwn,
  insecureTlsDispatcher,
  logFlow,
  makeTimeoutSignal,
  mapHttpError,
  mergedBindings,
  normalizeBaseUrl,
  normalizeBindings,
  normalizeIocList,
  normalizeRemark,
  operateDomain,
  parseSuccessBody,
  prepareRuntime,
  resolveCallContext,
  resolveTimeoutMs,
  sanitizeSensitiveText,
  toBoolean,
  toValue,
  trimString,
  unblockDomain,
  unwrapScalar,
};
