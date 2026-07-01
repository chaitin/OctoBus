import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const METHOD_ADD_PRECISE_BLACK_PATH = '/Tencent_TSec_V251.Tencent_TSec_V251/AddPreciseBlack';
export const METHOD_DELETE_PRECISE_BLACK_PATH = '/Tencent_TSec_V251.Tencent_TSec_V251/DeletePreciseBlack';
export const METHOD_ADD_GLOBAL_BLACK_PATH = '/Tencent_TSec_V251.Tencent_TSec_V251/AddGlobalBlack';
export const METHOD_DELETE_GLOBAL_BLACK_PATH = '/Tencent_TSec_V251.Tencent_TSec_V251/DeleteGlobalBlack';

export const METHOD_ADD_PRECISE_BLACK_FULL = 'Tencent_TSec_V251.Tencent_TSec_V251/AddPreciseBlack';
export const METHOD_DELETE_PRECISE_BLACK_FULL = 'Tencent_TSec_V251.Tencent_TSec_V251/DeletePreciseBlack';
export const METHOD_ADD_GLOBAL_BLACK_FULL = 'Tencent_TSec_V251.Tencent_TSec_V251/AddGlobalBlack';
export const METHOD_DELETE_GLOBAL_BLACK_FULL = 'Tencent_TSec_V251.Tencent_TSec_V251/DeleteGlobalBlack';

export const DEFAULT_TIMEOUT_MS = 5000;
export const TRANSPORT_SUCCESS_CODES = new Set([200, 201, 204, 209, 210]);
export const GLOBAL_BLACK_ADD_SUCCESS_CODES = new Set([200, 208]);
export const GLOBAL_BLACK_DEL_SUCCESS_CODES = new Set([200, 210]);

const SERVICE_NAME = 'Tencent_TSec_V251';
const DEFAULT_PRECISE_FIELD = 'Http-X-Forworded-For';
const DEFAULT_PRECISE_OPERATOR = 'contain';

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
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

const toTrimmedString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

const toInt64 = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return null;
  const num = Number(raw);
  if (!Number.isInteger(num) || Number.isNaN(num)) return null;
  return num;
};

const toValue = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return { numberValue: value };
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

const generateSigRandom = () => crypto.randomInt(1000, 10000).toString();
const getTimestamp = () => Math.floor(Date.now() / 1000);

const sortObjectKeys = (obj) => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortObjectKeys);
  const sorted = {};
  Object.keys(obj).sort().forEach((key) => {
    sorted[key] = sortObjectKeys(obj[key]);
  });
  return sorted;
};

const buildSignatureString = (host, data) => {
  const apiServer = String(host || '').replace(/^https?:\/\//i, '');
  return `POST${apiServer}?${JSON.stringify(sortObjectKeys(data))}`;
};

const computeSignature = (signatureString, secretKey) => {
  const digest = crypto.createHmac('sha1', String(secretKey)).update(String(signatureString)).digest('base64');
  return encodeURIComponent(digest);
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

const optionalUint32 = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return Math.trunc(num);
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

const resolveTimeoutMs = (ctx = {}) => optionalUint32(ctx.bindings?.timeoutMs) ?? optionalUint32(ctx.limits?.timeoutMs) ?? DEFAULT_TIMEOUT_MS;

const insecureTlsDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

const buildTlsOptions = (bindings = {}) => {
  if (!toBoolean(bindings.tlsInsecureSkipVerify) && !toBoolean(bindings.skipTlsVerify) && !toBoolean(bindings.insecureSkipVerify)) return {};
  return { dispatcher: insecureTlsDispatcher };
};

const makeTimeoutSignal = (timeoutMs) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeoutId) };
};

const buildHeaders = (ctx = {}) => {
  const bindings = ctx.bindings || {};
  const meta = ctx.meta || {};
  return {
    ...(bindings.headers && typeof bindings.headers === 'object' ? bindings.headers : {}),
    'Content-Type': 'application/json',
    'x-engine-instance': meta.instance_id || meta.instanceId || 'unknown',
    'x-request-id': meta.request_id || meta.requestId || 'unknown',
  };
};

const safeLogDetails = (details) => {
  const safe = { ...details };
  if (safe.body && safe.body.signature) safe.body = { ...safe.body, signature: '[REDACTED]' };
  return safe;
};

const buildLogPrefix = (meta = {}, action) => {
  const trace = [];
  if (meta.instance_id || meta.instanceId) trace.push(`inst=${meta.instance_id || meta.instanceId}`);
  if (meta.request_id || meta.requestId) trace.push(`req=${meta.request_id || meta.requestId}`);
  return `[${SERVICE_NAME}][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
};

const logFlow = (meta, action, details) => {
  const prefix = buildLogPrefix(meta, action);
  try {
    console.log(prefix, JSON.stringify(safeLogDetails(details)));
  } catch {
    console.log(prefix, details);
  }
};

const resolveHost = (bindings = {}) => toTrimmedString(firstDefined(bindings.host, bindings.baseUrl));

const validateBindings = (bindings = {}, type = 'block') => {
  const host = resolveHost(bindings);
  const uuid = toTrimmedString(bindings.uuid);
  if (!host) throw errorWithCode('FAILED_PRECONDITION', 'binding "host" is required but not configured');
  if (!uuid) throw errorWithCode('FAILED_PRECONDITION', 'binding "uuid" is required but not configured');
  const blockSecretId = toTrimmedString(firstDefined(bindings.block_secret_id, bindings.blockSecretId));
  const blockSecretKey = toTrimmedString(firstDefined(bindings.block_secret_key, bindings.blockSecretKey));
  const unblockSecretId = toTrimmedString(firstDefined(bindings.unblock_secret_id, bindings.unblockSecretId));
  const unblockSecretKey = toTrimmedString(firstDefined(bindings.unblock_secret_key, bindings.unblockSecretKey));
  if (type === 'block') {
    if (!blockSecretId) throw errorWithCode('FAILED_PRECONDITION', 'binding "block_secret_id" is required but not configured');
    if (!blockSecretKey) throw errorWithCode('FAILED_PRECONDITION', 'binding "block_secret_key" is required but not configured');
  } else {
    if (!unblockSecretId) throw errorWithCode('FAILED_PRECONDITION', 'binding "unblock_secret_id" is required but not configured');
    if (!unblockSecretKey) throw errorWithCode('FAILED_PRECONDITION', 'binding "unblock_secret_key" is required but not configured');
  }
  return { host, uuid, blockSecretId, blockSecretKey, unblockSecretId, unblockSecretKey };
};

const validateIP = (ip) => {
  if (typeof ip !== 'string') throw errorWithCode('INVALID_ARGUMENT', 'ip must be a non-empty string');
  const trimmed = ip.trim();
  if (!trimmed) throw errorWithCode('INVALID_ARGUMENT', 'ip cannot be empty');
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(trimmed)) throw errorWithCode('INVALID_ARGUMENT', 'ip must be a valid IPv4 address');
  for (const part of trimmed.split('.')) {
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) throw errorWithCode('INVALID_ARGUMENT', 'ip must be a valid IPv4 address');
  }
  return trimmed;
};

const validateOptionalIP = (ip) => {
  const raw = unwrapScalar(ip);
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') throw errorWithCode('INVALID_ARGUMENT', 'ip must be a string if provided');
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(trimmed)) throw errorWithCode('INVALID_ARGUMENT', 'ip_dst must be a valid IPv4 address');
  for (const part of trimmed.split('.')) {
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) throw errorWithCode('INVALID_ARGUMENT', 'ip_dst must be a valid IPv4 address');
  }
  return trimmed;
};

const validateBanReason = (banReason) => {
  const num = toInt64(banReason);
  if (num === null) throw errorWithCode('INVALID_ARGUMENT', 'ban_reason must be an integer');
  if (num < 1 || num > 5) throw errorWithCode('INVALID_ARGUMENT', 'ban_reason must be in range [1, 5] (1=攻击来源, 2=涉黄暴恐政, 3=失陷主机, 4=僵尸网络, 5=其他)');
  return num;
};

const validateThreshold = (threshold) => {
  const num = toInt64(threshold);
  if (num === null) throw errorWithCode('INVALID_ARGUMENT', 'threshold must be an integer');
  if (num < 0 || num > 100) throw errorWithCode('INVALID_ARGUMENT', 'threshold must be in range [0, 100]');
  return num;
};

const validateValidDuration = (validDuration) => {
  const num = toInt64(validDuration);
  if (num === null) throw errorWithCode('INVALID_ARGUMENT', 'valid_duration must be an integer');
  if (num !== -1 && num < 1) throw errorWithCode('INVALID_ARGUMENT', 'valid_duration must be -1 (permanent) or a positive integer');
  return num;
};

const parseDefaultTencentResponse = (text) => {
  if (!String(text || '').trim()) return { err: null, msg: '', data: null };
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { err: null, msg: text, data: null };
  }
  return { err: toValue(json?.err), msg: toValue(json?.msg), data: toValue(json?.data) };
};

const parseGlobalResponse = (text, allowedSet, action, expected) => {
  if (!String(text || '').trim()) throw errorWithCode('UNKNOWN', `empty response from global blacklist ${action}`);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', 'invalid JSON response');
  }
  const statusCode = Number(json?.status_code);
  if (!allowedSet.has(statusCode)) throw errorWithCode('FAILED_PRECONDITION', `upstream status_code: ${json?.status_code}, expected ${expected}`);
  return { err: toValue(json?.err), msg: toValue(json?.msg), data: toValue(json?.data) };
};

const callTencentAPI = async (ctx, payload, successChecker) => {
  const timeout = makeTimeoutSignal(resolveTimeoutMs(ctx));
  let res;
  try {
    res = await fetch(ctx.host, {
      method: 'POST',
      headers: buildHeaders(ctx),
      body: JSON.stringify(payload),
      signal: timeout.signal,
      ...buildTlsOptions(ctx.bindings),
    });
  } catch (err) {
    const reason = err?.cause?.message || err?.message || 'fetch failed';
    logFlow(ctx.meta, 'error', { action: payload.action, error: reason });
    throw errorWithCode('UNAVAILABLE', `upstream error: ${reason}`);
  } finally {
    timeout.clear();
  }
  const text = await res.text();
  if (!TRANSPORT_SUCCESS_CODES.has(res.status)) {
    logFlow(ctx.meta, 'transport-error', { action: payload.action, status: res.status, body: payload, response: text });
    throw errorWithCode('UNAVAILABLE', `upstream http ${res.status}: ${text}`);
  }
  return successChecker ? successChecker(text) : parseDefaultTencentResponse(text);
};

const signPayload = (host, payload, secretKey) => {
  const signatureString = buildSignatureString(host, payload);
  return computeSignature(signatureString, secretKey);
};

const prepareRuntime = (ctx = {}, type = 'block') => {
  const callCtx = resolveCallContext(ctx);
  const bindingInfo = validateBindings(callCtx.bindings, type);
  return { ...callCtx, ...bindingInfo };
};

const addPreciseBlack = async (req = {}, ctx = {}) => {
  const runtime = prepareRuntime(ctx, 'block');
  const ip = validateIP(firstDefined(req.ip));
  const validDuration = validateValidDuration(firstDefined(req.valid_duration, req.validDuration));
  const banReason = validateBanReason(firstDefined(req.ban_reason, req.banReason));
  const field = toTrimmedString(firstDefined(req.field, DEFAULT_PRECISE_FIELD)) || DEFAULT_PRECISE_FIELD;
  const operator = toTrimmedString(firstDefined(req.operator, DEFAULT_PRECISE_OPERATOR)) || DEFAULT_PRECISE_OPERATOR;
  const threshold = validateThreshold(firstDefined(req.threshold, 100));
  const payload = {
    action: 'v1/add_precise_black',
    secret_id: runtime.blockSecretId,
    sig_random: generateSigRandom(),
    time: getTimestamp(),
    rules: [{ field, content: ip, operator }],
    threshold,
    valid_duration: validDuration,
    match_operation: 'block',
    uuid: runtime.uuid,
    ban_reason: banReason,
  };
  payload.signature = signPayload(runtime.host, payload, runtime.blockSecretKey);
  logFlow(runtime.meta, 'AddPreciseBlack:start', { ip, valid_duration: validDuration, ban_reason: banReason });
  const result = await callTencentAPI(runtime, payload);
  logFlow(runtime.meta, 'AddPreciseBlack:done', { ip });
  return result;
};

const deletePreciseBlack = async (req = {}, ctx = {}) => {
  const runtime = prepareRuntime(ctx, 'unblock');
  const ip = validateIP(firstDefined(req.ip));
  const field = toTrimmedString(firstDefined(req.field, DEFAULT_PRECISE_FIELD)) || DEFAULT_PRECISE_FIELD;
  const operator = toTrimmedString(firstDefined(req.operator, DEFAULT_PRECISE_OPERATOR)) || DEFAULT_PRECISE_OPERATOR;
  const payload = {
    action: 'v1/del_precise_black',
    secret_id: runtime.unblockSecretId,
    sig_random: generateSigRandom(),
    time: getTimestamp(),
    rules: [{ field, content: ip, operator }],
  };
  payload.signature = signPayload(runtime.host, payload, runtime.unblockSecretKey);
  logFlow(runtime.meta, 'DeletePreciseBlack:start', { ip });
  const result = await callTencentAPI(runtime, payload);
  logFlow(runtime.meta, 'DeletePreciseBlack:done', { ip });
  return result;
};

const addGlobalBlack = async (req = {}, ctx = {}) => {
  const runtime = prepareRuntime(ctx, 'block');
  const ipSrc = validateIP(firstDefined(req.ip_src, req.ipSrc));
  const ipDst = validateOptionalIP(firstDefined(req.ip_dst, req.ipDst));
  const validDuration = validateValidDuration(firstDefined(req.valid_duration, req.validDuration));
  const banReason = validateBanReason(firstDefined(req.ban_reason, req.banReason));
  const threshold = validateThreshold(firstDefined(req.threshold, 100));
  const payload = {
    action: 'v1/add_global_black',
    secret_id: runtime.blockSecretId,
    sig_random: generateSigRandom(),
    time: getTimestamp(),
    ip_src: ipSrc,
    ip_dst: ipDst,
    threshold,
    valid_duration: validDuration,
    match_operation: 'block',
    uuid: runtime.uuid,
    ban_reason: banReason,
  };
  payload.signature = signPayload(runtime.host, payload, runtime.blockSecretKey);
  logFlow(runtime.meta, 'AddGlobalBlack:start', { ip_src: ipSrc, ip_dst: ipDst || '', valid_duration: validDuration, ban_reason: banReason });
  const result = await callTencentAPI(runtime, payload, (text) => {
    try {
      return parseGlobalResponse(text, GLOBAL_BLACK_ADD_SUCCESS_CODES, 'add', '200 or 208');
    } catch (err) {
      if (err.legacyCode === 'FAILED_PRECONDITION') logFlow(runtime.meta, 'business-error', { action: payload.action, body: payload, response: text });
      throw err;
    }
  });
  logFlow(runtime.meta, 'AddGlobalBlack:done', { ip_src: ipSrc });
  return result;
};

const deleteGlobalBlack = async (req = {}, ctx = {}) => {
  const runtime = prepareRuntime(ctx, 'unblock');
  const ipSrc = validateIP(firstDefined(req.ip_src, req.ipSrc));
  const ipDst = validateOptionalIP(firstDefined(req.ip_dst, req.ipDst));
  const payload = {
    action: 'v1/del_global_black',
    secret_id: runtime.unblockSecretId,
    sig_random: generateSigRandom(),
    time: getTimestamp(),
    ip_src: ipSrc,
    ip_dst: ipDst,
  };
  payload.signature = signPayload(runtime.host, payload, runtime.unblockSecretKey);
  logFlow(runtime.meta, 'DeleteGlobalBlack:start', { ip_src: ipSrc, ip_dst: ipDst || '' });
  const result = await callTencentAPI(runtime, payload, (text) => {
    let statusCode = NaN;
    try {
      statusCode = Number(JSON.parse(text)?.status_code);
    } catch {
      statusCode = NaN;
    }
    try {
      const normalized = parseGlobalResponse(text, GLOBAL_BLACK_DEL_SUCCESS_CODES, 'delete', '200 or 210');
      if (statusCode === 210) logFlow(runtime.meta, 'DeleteGlobalBlack:manual-unblock', { ip_src: ipSrc });
      return normalized;
    } catch (err) {
      if (err.legacyCode === 'FAILED_PRECONDITION') logFlow(runtime.meta, 'business-error', { action: payload.action, body: payload, response: text });
      throw err;
    }
  });
  logFlow(runtime.meta, 'DeleteGlobalBlack:done', { ip_src: ipSrc });
  return result;
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_ADD_PRECISE_BLACK_PATH]: async (req) => addPreciseBlack(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_DELETE_PRECISE_BLACK_PATH]: async (req) => deletePreciseBlack(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_ADD_GLOBAL_BLACK_PATH]: async (req) => addGlobalBlack(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_DELETE_GLOBAL_BLACK_PATH]: async (req) => deleteGlobalBlack(req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_ADD_PRECISE_BLACK_FULL]: (ctx = {}) => addPreciseBlack(requestFromContext(ctx), ctx),
  [METHOD_DELETE_PRECISE_BLACK_FULL]: (ctx = {}) => deletePreciseBlack(requestFromContext(ctx), ctx),
  [METHOD_ADD_GLOBAL_BLACK_FULL]: (ctx = {}) => addGlobalBlack(requestFromContext(ctx), ctx),
  [METHOD_DELETE_GLOBAL_BLACK_FULL]: (ctx = {}) => deleteGlobalBlack(requestFromContext(ctx), ctx),
};

export const _test = {
  addGlobalBlack,
  addPreciseBlack,
  buildHeaders,
  buildLogPrefix,
  buildSignatureString,
  buildTlsOptions,
  callTencentAPI,
  computeSignature,
  deleteGlobalBlack,
  deletePreciseBlack,
  errorWithCode,
  firstDefined,
  generateSigRandom,
  getTimestamp,
  hasOwn,
  insecureTlsDispatcher,
  logFlow,
  makeTimeoutSignal,
  mergedBindings,
  optionalUint32,
  parseDefaultTencentResponse,
  parseGlobalResponse,
  prepareRuntime,
  resolveCallContext,
  resolveHost,
  resolveTimeoutMs,
  safeLogDetails,
  signPayload,
  sortObjectKeys,
  toBoolean,
  toInt64,
  toTrimmedString,
  toValue,
  unwrapScalar,
  validateBanReason,
  validateBindings,
  validateIP,
  validateOptionalIP,
  validateThreshold,
  validateValidDuration,
};
