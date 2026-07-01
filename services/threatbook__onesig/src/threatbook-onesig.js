import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const METHOD_BATCH_BLOCK_PATH = '/ThreatBook_OneSIG.ThreatBook_OneSIG/BatchBlockIP';
export const METHOD_LIST_ENTRIES_PATH = '/ThreatBook_OneSIG.ThreatBook_OneSIG/ListInboundBlacklistEntries';
export const METHOD_BATCH_UNBLOCK_PATH = '/ThreatBook_OneSIG.ThreatBook_OneSIG/BatchUnblockByEntryIds';

export const METHOD_BATCH_BLOCK_FULL = 'ThreatBook_OneSIG.ThreatBook_OneSIG/BatchBlockIP';
export const METHOD_LIST_ENTRIES_FULL = 'ThreatBook_OneSIG.ThreatBook_OneSIG/ListInboundBlacklistEntries';
export const METHOD_BATCH_UNBLOCK_FULL = 'ThreatBook_OneSIG.ThreatBook_OneSIG/BatchUnblockByEntryIds';

export const API_BLACKLIST_PATH = '/v3/blacklist/inbound';
export const API_BLACKLIST_LIST_PATH = '/v3/blacklist/inbound/list';
export const MAX_COMMENT_LENGTH = 20;
export const MAX_THREAT_NAME_LENGTH = 20;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_OBJECT_TYPE = 'ip';
export const DEFAULT_TIMEOUT_MS = 1500;
export const DEFAULT_SIGNATURE_MODE = 'apiKey+timestamp';
export const DEFAULT_TIMESTAMP_PRECISION = 'seconds';

export const SUPPORTED_SIGNATURE_MODES = new Set(['apiKey+timestamp', 'timestamp+apiKey', 'apiKey', 'timestamp']);
export const SUPPORTED_TIMESTAMP_PRECISIONS = new Set(['seconds', 'milliseconds']);

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

const trimString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
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

const normalizeBaseUrl = (raw, { allowInsecure } = {}) => {
  const candidate = trimString(raw);
  if (!candidate) return null;
  if (/^https:\/\//i.test(candidate)) return candidate.replace(/\/+$/, '');
  if (allowInsecure && /^http:\/\//i.test(candidate)) return candidate.replace(/\/+$/, '');
  return null;
};

const matchSupportedValue = (items, raw) => Array.from(items).find((item) => item.toLowerCase() === raw.toLowerCase()) || null;

const normalizeBindings = (rawBindings = {}) => {
  const allowInsecureHttp = toBoolean(firstDefined(rawBindings.allow_http, rawBindings.allowInsecureHttp));
  const baseUrl = normalizeBaseUrl(firstDefined(rawBindings.base_url, rawBindings.baseUrl), { allowInsecure: allowInsecureHttp });
  if (!baseUrl) {
    const hint = allowInsecureHttp ? 'http://' : 'https://';
    throw errorWithCode('INVALID_ARGUMENT', `bindings.base_url/baseUrl must be ${hint}`);
  }
  const apiKey = trimString(firstDefined(rawBindings.api_key, rawBindings.apiKey));
  if (!apiKey) throw errorWithCode('INVALID_ARGUMENT', 'bindings.api_key/apiKey is required');
  const secret = trimString(firstDefined(rawBindings.secret, rawBindings.Secret));
  if (!secret) throw errorWithCode('INVALID_ARGUMENT', 'bindings.secret is required');
  const headers = rawBindings.headers && typeof rawBindings.headers === 'object' ? rawBindings.headers : {};
  const skipTlsVerify = toBoolean(firstDefined(rawBindings.skipTlsVerify, rawBindings.tlsInsecureSkipVerify));

  const encodeSignRaw = trimString(firstDefined(rawBindings.encode_sign, rawBindings.encodeSign));
  let encodeSign = true;
  if (encodeSignRaw) encodeSign = !['false', '0', 'no'].includes(encodeSignRaw.toLowerCase());

  const signatureModeRaw = trimString(firstDefined(rawBindings.signature_mode, rawBindings.signatureMode));
  let signatureMode = DEFAULT_SIGNATURE_MODE;
  if (signatureModeRaw) {
    const matched = matchSupportedValue(SUPPORTED_SIGNATURE_MODES, signatureModeRaw);
    if (!matched) throw errorWithCode('INVALID_ARGUMENT', `unsupported signature_mode: ${signatureModeRaw}`);
    signatureMode = matched;
  }

  const precisionRaw = trimString(firstDefined(rawBindings.timestamp_precision, rawBindings.timestampPrecision));
  let timestampPrecision = DEFAULT_TIMESTAMP_PRECISION;
  if (precisionRaw) {
    const matched = matchSupportedValue(SUPPORTED_TIMESTAMP_PRECISIONS, precisionRaw);
    if (!matched) throw errorWithCode('INVALID_ARGUMENT', `unsupported timestamp_precision: ${precisionRaw}`);
    timestampPrecision = matched;
  }

  return {
    baseUrl,
    apiKey,
    secret,
    headers,
    skipTlsVerify,
    signatureMode,
    timestampPrecision,
    encodeSign,
  };
};

const normalizeInt = (candidate, { min, max, defaultValue }) => {
  const source = unwrapScalar(candidate);
  if (source === undefined || source === null || source === '') return defaultValue;
  const num = Number(source);
  if (!Number.isInteger(num) || Number.isNaN(num)) return null;
  if (min !== undefined && num < min) return null;
  if (max !== undefined && num > max) return null;
  return num;
};

const normalizeStringList = (candidate) => {
  if (candidate === undefined || candidate === null) return undefined;
  const unwrapped = unwrapScalar(candidate);
  const source = Array.isArray(unwrapped)
    ? unwrapped
    : unwrapped && typeof unwrapped === 'object' && Array.isArray(unwrapped.values)
      ? unwrapped.values
      : null;
  if (source === null) return null;
  const result = [];
  for (const item of source) {
    const text = trimString(item);
    if (!text) return null;
    result.push(text);
  }
  return result;
};

const enforceMaxLength = (value, max, label) => {
  const trimmed = trimString(value);
  if (!trimmed) return '';
  if (trimmed.length > max) throw errorWithCode('INVALID_ARGUMENT', `${label} must be <= ${max} characters`);
  return trimmed;
};

const pickSignaturePayload = (mode, { apiKey, timestamp }) => {
  switch (mode) {
    case 'timestamp+apiKey':
      return `${timestamp}${apiKey}`;
    case 'apiKey':
      return apiKey;
    case 'timestamp':
      return timestamp;
    case 'apiKey+timestamp':
    default:
      return `${apiKey}${timestamp}`;
  }
};

const computeTimestampValue = (precision) => (precision === 'milliseconds' ? String(Date.now()) : String(Math.floor(Date.now() / 1000)));

const computeHmacSha1Base64 = (key, data) => crypto.createHmac('sha1', String(key || '')).update(String(data || '')).digest('base64');

const encodeQueryComponent = (value) => encodeURIComponent(String(value ?? ''));

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const redactUrlSensitiveQuery = (url) => {
  try {
    const parsed = new URL(String(url));
    for (const key of ['apikey', 'api_key', 'sign']) {
      if (parsed.searchParams.has(key)) parsed.searchParams.set(key, '***');
    }
    return parsed.toString();
  } catch {
    return String(url).replace(/((?:apikey|api_key|sign)=)[^&\s]+/gi, '$1***');
  }
};

const sanitizeSensitiveText = (value, sensitiveValues = []) => {
  let text = String(value ?? '');
  text = text.replace(/((?:apikey|api_key|sign)=)[^&\s"'<>]+/gi, '$1***');
  for (const secretValue of sensitiveValues) {
    const secretText = String(secretValue ?? '');
    if (secretText.length < 3) continue;
    text = text.replace(new RegExp(escapeRegExp(secretText), 'g'), '***');
  }
  return text;
};

const buildLogPrefix = (meta = {}, action) => {
  const traceParts = [];
  if (meta.instance_id || meta.instanceId) traceParts.push(`inst=${meta.instance_id || meta.instanceId}`);
  if (meta.request_id || meta.requestId) traceParts.push(`req=${meta.request_id || meta.requestId}`);
  return `[ThreatBook_OneSIG][${action}]${traceParts.length ? `[${traceParts.join(' ')}]` : ''}`;
};

const logFlow = (meta, action, details) => {
  const prefix = buildLogPrefix(meta, action);
  try {
    console.log(prefix, JSON.stringify(details));
  } catch (err) {
    console.log(prefix, details, err?.message);
  }
};

const buildSignedUrl = ({ baseUrl, path, apiKey, secret, signatureMode, timestampPrecision, encodeSign }) => {
  const timestamp = computeTimestampValue(timestampPrecision);
  const payload = pickSignaturePayload(signatureMode, { apiKey, timestamp });
  const sign = computeHmacSha1Base64(secret || '', payload);
  const signParam = encodeSign ? encodeQueryComponent(sign) : sign;
  const base = `${baseUrl}${path}`;
  const separator = base.includes('?') ? '&' : '?';
  const query = `apikey=${encodeQueryComponent(apiKey)}&timestamp=${encodeQueryComponent(timestamp)}&sign=${signParam}`;
  return { url: `${base}${separator}${query}`, timestamp, sign };
};

const extractEntries = (data) => {
  if (!data) return [];
  const list = Array.isArray(data.list)
    ? data.list
    : Array.isArray(data.items)
      ? data.items
      : Array.isArray(data)
        ? data
        : [];
  return list.map((item) => ({
    id: trimString(item?.id),
    object: trimString(firstDefined(item?.object, item?.Object)),
    objectType: trimString(firstDefined(item?.objectType, item?.object_type)) || DEFAULT_OBJECT_TYPE,
    lifeCycleSeconds: (() => {
      const num = Number(firstDefined(item?.lifeCycle, item?.life_cycle));
      if (!Number.isFinite(num)) return 0;
      return Math.max(0, Math.trunc(num));
    })(),
    state: trimString(item?.state),
    comments: trimString(item?.comments),
    threatName: trimString(item?.threatName),
  }));
};

const mapEntriesToProto = (entries) => entries.map((entry) => ({
  id: entry.id,
  object: entry.object,
  object_type: entry.objectType,
  life_cycle_seconds: entry.lifeCycleSeconds,
  state: entry.state,
  comments: entry.comments,
  threat_name: entry.threatName,
}));

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

const callOneSig = async ({
  action,
  meta,
  bindings,
  method,
  path,
  body,
  timeoutMs,
}) => {
  const { url, timestamp, sign } = buildSignedUrl({
    baseUrl: bindings.baseUrl,
    path,
    apiKey: bindings.apiKey,
    secret: bindings.secret,
    signatureMode: bindings.signatureMode,
    timestampPrecision: bindings.timestampPrecision,
    encodeSign: bindings.encodeSign,
  });
  const sensitiveValues = [bindings.apiKey, bindings.secret, sign];
  const headers = {
    'content-type': 'application/json',
    ...bindings.headers,
    'x-engine-instance': meta?.instance_id || meta?.instanceId || 'unknown',
    'x-request-id': meta?.request_id || meta?.requestId || 'unknown',
  };
  const payload = body === undefined ? {} : body;
  const timeout = makeTimeoutSignal(timeoutMs);
  logFlow(meta, `${action}:request`, {
    url: redactUrlSensitiveQuery(url),
    method,
    bodyKeys: Object.keys(payload),
    timeoutMs,
    timestamp,
    signatureMode: bindings.signatureMode,
    hasSign: Boolean(sign),
    encodeSign: bindings.encodeSign,
  });

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(payload),
      signal: timeout.signal,
      ...buildTlsOptions(bindings),
    });
  } catch (err) {
    const message = sanitizeSensitiveText(err?.message || 'fetch failed', sensitiveValues);
    logFlow(meta, `${action}:network-error`, { message });
    throw errorWithCode('UNAVAILABLE', message);
  } finally {
    timeout.clear();
  }

  let text;
  try {
    text = await res.text();
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', sanitizeSensitiveText(err?.message || 'response read failed', sensitiveValues));
  }
  logFlow(meta, `${action}:response`, { status: res.status, length: text.length });

  if (res.status !== 200) throw errorWithCode('UNAVAILABLE', `upstream http ${res.status}: ${sanitizeSensitiveText(text, sensitiveValues)}`);
  if (!text.trim()) throw errorWithCode('UNKNOWN', 'response body is empty');

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', 'response is not valid JSON');
  }

  const responseCodeRaw = firstDefined(json.responseCode, json.code, json.status);
  const responseCode = Number(responseCodeRaw);
  const verboseMsg = sanitizeSensitiveText(trimString(firstDefined(json.verboseMsg, json.message)), sensitiveValues);
  if (responseCode !== 0) {
    logFlow(meta, `${action}:business-error`, { responseCode, verboseMsg });
    throw errorWithCode('FAILED_PRECONDITION', `responseCode=${responseCode}: ${verboseMsg || 'OneSIG business failure'}`);
  }

  logFlow(meta, `${action}:success`, { responseCode, verboseMsg });
  return { json, responseCode, verboseMsg };
};

const requireIpList = (req = {}) => {
  const candidate = normalizeStringList(firstDefined(req.ip_addresses, req.ipAddresses, req.objects));
  if (candidate === undefined) throw errorWithCode('INVALID_ARGUMENT', 'ip_addresses is required');
  if (candidate === null) throw errorWithCode('INVALID_ARGUMENT', 'ip_addresses must be a non-empty string array');
  if (!candidate.length) throw errorWithCode('INVALID_ARGUMENT', 'ip_addresses must contain at least one IP');
  return candidate;
};

const requireEntryIds = (req = {}) => {
  const candidate = normalizeStringList(firstDefined(req.entry_ids, req.entryIds, req.ids));
  if (candidate === undefined) throw errorWithCode('INVALID_ARGUMENT', 'entry_ids is required');
  if (candidate === null || !candidate.length) throw errorWithCode('INVALID_ARGUMENT', 'entry_ids must be a non-empty string array');
  return candidate;
};

const normalizeObjectType = (req = {}) => trimString(firstDefined(req.object_type, req.objectType)) || DEFAULT_OBJECT_TYPE;

const normalizePaginationField = (value, { label, defaultValue, min, max }) => {
  const num = normalizeInt(value, { min, max, defaultValue });
  if (num === null) throw errorWithCode('INVALID_ARGUMENT', `${label} must be an integer between ${min} and ${max ?? 'INF'}`);
  return num;
};

const prepareRuntime = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  return {
    ...callCtx,
    bindings: normalizeBindings(callCtx.bindings),
    timeoutMs: resolveTimeoutMs(callCtx),
  };
};

const handleBatchBlock = async (req = {}, ctx = {}) => {
  const runtime = prepareRuntime(ctx);
  const objects = requireIpList(req);
  const lifeCycle = normalizeInt(firstDefined(req.life_cycle_seconds, req.lifeCycleSeconds, req.lifeCycle), {
    min: 0,
    defaultValue: 0,
  });
  if (lifeCycle === null) throw errorWithCode('INVALID_ARGUMENT', 'life_cycle_seconds must be a non-negative integer');
  const comments = enforceMaxLength(firstDefined(req.comments, req.comment), MAX_COMMENT_LENGTH, 'comments');
  const threatName = enforceMaxLength(firstDefined(req.threat_name, req.threatName), MAX_THREAT_NAME_LENGTH, 'threat_name');
  const objectType = normalizeObjectType(req);
  const payload = {
    object: objects,
    objectType,
    lifeCycle,
    ...(comments ? { comments } : {}),
    ...(threatName ? { threatName } : {}),
  };
  const { json, responseCode, verboseMsg } = await callOneSig({
    action: 'batch-block',
    meta: runtime.meta,
    bindings: runtime.bindings,
    method: 'POST',
    path: API_BLACKLIST_PATH,
    body: payload,
    timeoutMs: runtime.timeoutMs,
  });
  return {
    status: { response_code: responseCode, verbose_msg: verboseMsg },
    entries: mapEntriesToProto(extractEntries(json?.data)),
    raw: json?.data ?? {},
  };
};

const handleListEntries = async (req = {}, ctx = {}) => {
  const runtime = prepareRuntime(ctx);
  const pageNo = normalizePaginationField(firstDefined(req.page_no, req.pageNo), {
    label: 'page_no',
    defaultValue: 1,
    min: 1,
  });
  const pageSize = normalizePaginationField(firstDefined(req.page_size, req.pageSize), {
    label: 'page_size',
    defaultValue: DEFAULT_PAGE_SIZE,
    min: 1,
    max: MAX_PAGE_SIZE,
  });
  const payload = { pageNo, pageSize };
  const search = trimString(firstDefined(req.search, req.Search));
  if (search) payload.search = search;
  const objectType = normalizeObjectType(req);
  if (objectType) payload.objectType = objectType;
  const inputType = trimString(firstDefined(req.input_type, req.inputType));
  if (inputType) payload.inputType = inputType;
  const state = trimString(firstDefined(req.state, req.State));
  if (state) payload.state = state;

  const { json, responseCode, verboseMsg } = await callOneSig({
    action: 'list-blacklist',
    meta: runtime.meta,
    bindings: runtime.bindings,
    method: 'POST',
    path: API_BLACKLIST_LIST_PATH,
    body: payload,
    timeoutMs: runtime.timeoutMs,
  });
  const data = json?.data || {};
  const entries = mapEntriesToProto(extractEntries(data));
  const total = normalizeInt(data.total, { min: 0, defaultValue: 0 }) ?? 0;
  const actualPageNo = normalizeInt(firstDefined(data.pageNo, data.page_no), { min: 1, defaultValue: pageNo }) ?? pageNo;
  const actualPageSize = normalizeInt(firstDefined(data.pageSize, data.page_size), { min: 1, defaultValue: pageSize }) ?? pageSize;
  return {
    status: { response_code: responseCode, verbose_msg: verboseMsg },
    entries,
    page_no: actualPageNo,
    page_size: actualPageSize,
    total,
    raw: data,
  };
};

const handleBatchUnblock = async (req = {}, ctx = {}) => {
  const runtime = prepareRuntime(ctx);
  const ids = requireEntryIds(req);
  const payload = {
    ids,
    objectType: normalizeObjectType(req),
  };
  const { json, responseCode, verboseMsg } = await callOneSig({
    action: 'batch-unblock',
    meta: runtime.meta,
    bindings: runtime.bindings,
    method: 'DELETE',
    path: API_BLACKLIST_PATH,
    body: payload,
    timeoutMs: runtime.timeoutMs,
  });
  return {
    status: { response_code: responseCode, verbose_msg: verboseMsg },
    raw: json?.data ?? {},
  };
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_BATCH_BLOCK_PATH]: async (req) => handleBatchBlock(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_LIST_ENTRIES_PATH]: async (req) => handleListEntries(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_BATCH_UNBLOCK_PATH]: async (req) => handleBatchUnblock(req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_BATCH_BLOCK_FULL]: (ctx = {}) => handleBatchBlock(requestFromContext(ctx), ctx),
  [METHOD_LIST_ENTRIES_FULL]: (ctx = {}) => handleListEntries(requestFromContext(ctx), ctx),
  [METHOD_BATCH_UNBLOCK_FULL]: (ctx = {}) => handleBatchUnblock(requestFromContext(ctx), ctx),
};

export const _test = {
  buildLogPrefix,
  buildSignedUrl,
  buildTlsOptions,
  callOneSig,
  computeHmacSha1Base64,
  computeTimestampValue,
  encodeQueryComponent,
  enforceMaxLength,
  errorWithCode,
  escapeRegExp,
  extractEntries,
  firstDefined,
  grpcCodeFor,
  handleBatchBlock,
  handleBatchUnblock,
  handleListEntries,
  hasOwn,
  insecureTlsDispatcher,
  logFlow,
  makeTimeoutSignal,
  mapEntriesToProto,
  matchSupportedValue,
  mergedBindings,
  normalizeBaseUrl,
  normalizeBindings,
  normalizeInt,
  normalizeObjectType,
  normalizePaginationField,
  normalizeStringList,
  pickSignaturePayload,
  prepareRuntime,
  redactUrlSensitiveQuery,
  requireEntryIds,
  requireIpList,
  resolveCallContext,
  resolveTimeoutMs,
  sanitizeSensitiveText,
  toBoolean,
  trimString,
  unwrapScalar,
};
