import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

// ---- Method paths ----

const METHOD_LIST_PATH = '/Huawei_CCM.Huawei_CCM/ListCertificates';
const METHOD_GET_PATH = '/Huawei_CCM.Huawei_CCM/GetCertificate';

const METHOD_LIST_FULL = 'Huawei_CCM.Huawei_CCM/ListCertificates';
const METHOD_GET_FULL = 'Huawei_CCM.Huawei_CCM/GetCertificate';

// ---- Constants ----

const API_VERSION = 'v3';
const ENDPOINT = 'scm.cn-north-4.myhuaweicloud.com';
const METHOD_GET = 'GET';
const SCHEME = 'https';
const DEFAULT_TIMEOUT_MS = 10000;
const ALGORITHM = 'SDK-HMAC-SHA256';

const SDK_REF = 'Huawei_CCM';

// ---- Error helpers ----

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

// ---- Value helpers ----

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const firstDefined = (...values) => values.find((v) => v !== undefined && v !== null);

const unwrapString = (source, depth = 0) => {
  if (depth > 10) return '';
  if (source === undefined || source === null) return '';
  if (typeof source === 'object' && source !== null && hasOwn(source, 'value')) return unwrapString(source.value, depth + 1);
  return String(source);
};

const optionalUint32 = (value) => {
  const raw = value && typeof value === 'object' && hasOwn(value, 'value') ? value.value : value;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return Math.trunc(num);
};

const toBoolean = (value) => {
  const raw = value && typeof value === 'object' && hasOwn(value, 'value') ? value.value : value;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw !== 0;
  if (typeof raw === 'string') {
    const text = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'n', 'off', ''].includes(text)) return false;
  }
  return false;
};

// ---- Huawei Cloud SDK-HMAC-SHA256 Signature ----

const sha256hex = (message) => crypto.createHash('sha256').update(Buffer.from(message, 'utf-8')).digest('hex');

const hmacSha256 = (key, message) => crypto.createHmac('sha256', key).update(Buffer.from(message, 'utf-8')).digest();

const iso8601Basic = (timestamp) => {
  const d = new Date(timestamp * 1000);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}${mo}${da}T${h}${mi}${s}Z`;
};

const buildCanonicalQueryString = (params = {}) => {
  const keys = Object.keys(params).filter((k) => params[k] !== undefined && params[k] !== null);
  if (keys.length === 0) return '';
  keys.sort();
  return keys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`).join('&');
};

const buildCanonicalHeaders = (headers, signedHeaders) => {
  const sorted = [...signedHeaders].sort();
  return sorted.map((key) => {
    const val = headers[key.toLowerCase()] || '';
    return `${key.toLowerCase()}:${val.trim()}\n`;
  }).join('');
};

const ensureTrailingSlash = (p) => {
  if (!p || p === '/') return '/';
  return p.endsWith('/') ? p : `${p}/`;
};

const signHuawei = (accessKey, secretKey, method, uri, queryString, body, sdkDate) => {
  // Canonical Request
  const canonicalURI = uri || '/';
  const payloadHash = sha256hex(body);
  const signedHeaders = ['host', 'x-sdk-date'];
  const canonicalHeaders = buildCanonicalHeaders(
    { host: ENDPOINT, 'x-sdk-date': sdkDate },
    signedHeaders,
  );
  const canonicalRequest = [
    method,
    canonicalURI,
    queryString,
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n');

  // String to Sign
  const hashedCanonical = sha256hex(canonicalRequest);
  const stringToSign = `${ALGORITHM}\n${sdkDate}\n${hashedCanonical}`;

  // Signature
  const signature = hmacSha256(secretKey, stringToSign).toString('hex');

  // Authorization
  const authorization = `${ALGORITHM} Access=${accessKey}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`;

  return { authorization, sdkDate };
};

// ---- Logging ----

const buildLogPrefix = (meta = {}, action) => {
  const labels = [];
  if (meta.instance_id || meta.instanceId) labels.push(`inst=${meta.instance_id || meta.instanceId}`);
  if (meta.request_id || meta.requestId) labels.push(`req=${meta.request_id || meta.requestId}`);
  return `[${SDK_REF}][${action}]${labels.length ? `[${labels.join(' ')}]` : ''}`;
};

const logInfo = (meta, action, payload) => {
  const prefix = buildLogPrefix(meta, action);
  try { console.log(prefix, JSON.stringify(payload)); } catch { console.log(prefix, payload); }
};

const logError = (meta, action, payload) => {
  const prefix = buildLogPrefix(meta, action);
  try { console.error(prefix, JSON.stringify(payload)); } catch { console.error(prefix, payload); }
};

// ---- HTTP ----

const parseJson = (text) => {
  if (!String(text || '').trim()) return null;
  try { return JSON.parse(text); } catch { throw errorWithCode('UNKNOWN', 'response is not valid JSON'); }
};

const mapHttpError = (res, bodyText) => {
  if (res.status === 401 || res.status === 403) throw errorWithCode('PERMISSION_DENIED', `upstream http ${res.status}`);
  if (res.status === 429) throw errorWithCode('UNAVAILABLE', `upstream http ${res.status}`);
  if (res.status >= 400 && res.status < 500) throw errorWithCode('FAILED_PRECONDITION', `upstream http ${res.status}`);
  throw errorWithCode('UNAVAILABLE', `upstream http ${res.status}`);
};

const buildTlsOptions = (bindings = {}) => {
  if (!toBoolean(bindings.skipTlsVerify) && !toBoolean(bindings.tlsInsecureSkipVerify) && !toBoolean(bindings.insecureSkipVerify)) return {};
  return { insecureSkipVerify: true, tlsInsecureSkipVerify: true, skipTlsVerify: true };
};

const fetchJson = async (url, init, { bindings = {}, timeoutMs }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, ...buildTlsOptions(bindings) });
    const text = await res.text();
    if (!res.ok) mapHttpError(res, text);
    return { json: parseJson(text), text };
  } catch (err) {
    if (err instanceof GrpcError) throw err;
    const reason = err?.cause?.message || err?.message || 'fetch failed';
    throw errorWithCode('UNAVAILABLE', reason);
  } finally {
    clearTimeout(timer);
  }
};

// ---- Context resolution ----

const mergedBindings = (ctx = {}) => ({ ...(ctx.config ?? {}), ...(ctx.secret ?? {}), ...(ctx.bindings ?? {}) });

const resolveCallContext = (ctx = {}) => ({
  ...ctx, bindings: mergedBindings(ctx), limits: ctx.limits ?? {}, meta: ctx.meta ?? {}, req: ctx.req ?? ctx.request ?? {},
});

const resolveTimeoutMs = (ctx = {}, bindings = {}) =>
  firstDefined(optionalUint32(ctx.limits?.timeoutMs), optionalUint32(bindings.timeoutMs), DEFAULT_TIMEOUT_MS);

// ---- CCM API call ----

const callCCMAPI = async (method, uri, queryParams, { meta, bindings, timeoutMs }) => {
  const accessKey = unwrapString(firstDefined(bindings.access_key, bindings.accessKey, bindings.ak)).trim();
  const secretKey = unwrapString(firstDefined(bindings.secret_key, bindings.secretKey, bindings.sk)).trim();
  if (!accessKey) throw errorWithCode('PERMISSION_DENIED', 'access_key (AK) is required in bindings');
  if (!secretKey) throw errorWithCode('PERMISSION_DENIED', 'secret_key (SK) is required in bindings');

  const queryString = buildCanonicalQueryString(queryParams);
  const body = '';
  const sdkDate = iso8601Basic(Math.floor(Date.now() / 1000));

  const { authorization } = signHuawei(accessKey, secretKey, method, uri, queryString, body, sdkDate);

  const url = `${SCHEME}://${ENDPOINT}${uri}${queryString ? '?' + queryString : ''}`;
  const headers = {
    Host: ENDPOINT,
    'X-Sdk-Date': sdkDate,
    Authorization: authorization,
  };

  logInfo(meta, `${method}:start`, { url });

  let result;
  try {
    result = await fetchJson(url, { method, headers }, { bindings, timeoutMs });
  } catch (err) {
    logError(meta, `${method}:http-error`, { url, error: err.message });
    throw err;
  }

  logInfo(meta, `${method}:success`, { url });
  return result.json || {};
};

// ---- Handlers ----

const makeRuntime = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings || {};
  const meta = callCtx.meta || {};
  const timeoutMs = resolveTimeoutMs(callCtx, bindings);

  const runList = async (req = {}) => {
    const limit = optionalUint32(firstDefined(req.limit)) || 50;
    const offset = optionalUint32(firstDefined(req.offset)) || 0;

    const params = {};
    if (limit !== undefined) params.limit = limit;
    if (offset !== undefined) params.offset = offset;

    const response = await callCCMAPI(METHOD_GET, '/v3/scm/certificates', params, { meta, bindings, timeoutMs });

    const items = (response.certificates || []).map((cert) => ({
      id: cert.id || '',
      domain: cert.domain || cert.common_name || '',
      cert_type: cert.type || cert.certificate_type || '',
      status: cert.status || '',
      create_time: cert.create_time || cert.create_time_stamp || '',
      expire_time: cert.expire_time || cert.not_after || '',
    }));

    return { code: 0, message: 'ok', data: items, total: response.total || items.length };
  };

  const runGet = async (req = {}) => {
    const certificateId = unwrapString(firstDefined(req.certificate_id, req.certificateId)).trim();
    if (!certificateId) throw errorWithCode('INVALID_ARGUMENT', 'certificate_id is required');

    const response = await callCCMAPI(METHOD_GET, `/v3/scm/certificates/${encodeURIComponent(certificateId)}`, {}, { meta, bindings, timeoutMs });

    return {
      code: 0,
      message: 'ok',
      id: response.id || '',
      domain: response.domain || response.common_name || '',
      cert_type: response.type || response.certificate_type || '',
      status: response.status || '',
      create_time: response.create_time || response.create_time_stamp || '',
      expire_time: response.expire_time || response.not_after || '',
      subject: response.subject || response.common_name || '',
      san: response.subject_alternative_names || response.san || [],
    };
  };

  return { runList, runGet };
};

// ---- Exports ----

export const handlers = {
  [METHOD_LIST_FULL]: (ctx) => makeRuntime(ctx).runList(ctx.request ?? {}),
  [METHOD_GET_FULL]: (ctx) => makeRuntime(ctx).runGet(ctx.request ?? {}),
};

export const _test = {
  errorWithCode,
  firstDefined,
  hasOwn,
  logInfo,
  logError,
  makeRuntime,
  mapHttpError,
  mergedBindings,
  optionalUint32,
  parseJson,
  resolveCallContext,
  resolveTimeoutMs,
  toBoolean,
  unwrapString,
  sha256hex,
  hmacSha256,
  signHuawei,
  buildCanonicalQueryString,
  iso8601Basic,
  ensureTrailingSlash,
};
