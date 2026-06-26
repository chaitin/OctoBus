import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

// ---- Method paths ----

const METHOD_LIST_PATH = '/Tencent_SSL.Tencent_SSL/ListCertificates';
const METHOD_GET_PATH = '/Tencent_SSL.Tencent_SSL/GetCertificate';

const METHOD_LIST_FULL = 'Tencent_SSL.Tencent_SSL/ListCertificates';
const METHOD_GET_FULL = 'Tencent_SSL.Tencent_SSL/GetCertificate';

// ---- Constants ----

const SERVICE = 'ssl';
const API_VERSION = '2019-12-05';
const ENDPOINT = `${SERVICE}.tencentcloudapi.com`;
const METHOD_POST = 'POST';
const DEFAULT_TIMEOUT_MS = 10000;

const SERVICE_NAME = 'Tencent_SSL';

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

const unwrapString = (source) => {
  if (source === undefined || source === null) return '';
  if (typeof source === 'object' && source !== null && hasOwn(source, 'value')) return unwrapString(source.value);
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

// ---- Signature (TC3-HMAC-SHA256) ----

const sha256hex = (message) => crypto.createHash('sha256').update(Buffer.from(message, 'utf-8')).digest('hex');
const hmacSha256 = (key, message) => crypto.createHmac('sha256', key).update(Buffer.from(message, 'utf-8')).digest();

const formatDate = (timestamp) => {
  const d = new Date(timestamp * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

const signRequest = (secretId, secretKey, payload, timestamp) => {
  const payloadJson = JSON.stringify(payload);
  const date = formatDate(timestamp);
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${ENDPOINT}\n`;
  const canonicalRequest = `${METHOD_POST}\n/\n\n${canonicalHeaders}\ncontent-type;host\n${sha256hex(payloadJson)}`;
  const credentialScope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${sha256hex(canonicalRequest)}`;
  const secretDate = hmacSha256(`TC3${secretKey}`, date);
  const secretService = hmacSha256(secretDate, SERVICE);
  const secretSigning = hmacSha256(secretService, 'tc3_request');
  const signature = hmacSha256(secretSigning, stringToSign).toString('hex');
  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`;
  return { authorization, timestamp };
};

// ---- Logging ----

const buildLogPrefix = (meta = {}, action) => {
  const labels = [];
  if (meta.instance_id || meta.instanceId) labels.push(`inst=${meta.instance_id || meta.instanceId}`);
  if (meta.request_id || meta.requestId) labels.push(`req=${meta.request_id || meta.requestId}`);
  return `[${SERVICE_NAME}][${action}]${labels.length ? `[${labels.join(' ')}]` : ''}`;
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
  const text = String(bodyText || '');
  if (res.status === 401 || res.status === 403) throw errorWithCode('PERMISSION_DENIED', `upstream http ${res.status}: ${text}`);
  if (res.status >= 400 && res.status < 500) throw errorWithCode('FAILED_PRECONDITION', `upstream http ${res.status}: ${text}`);
  throw errorWithCode('UNAVAILABLE', `upstream http ${res.status}: ${text}`);
};

const buildTlsOptions = (bindings = {}) => {
  if (!toBoolean(bindings.skipTlsVerify) && !toBoolean(bindings.tlsInsecureSkipVerify) && !toBoolean(bindings.insecureSkipVerify)) return {};
  return { insecureSkipVerify: true, tlsInsecureSkipVerify: true, skipTlsVerify: true };
};

const fetchJson = async (url, init, { bindings = {}, timeoutMs }) => {
  let res;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    res = await fetch(url, { ...init, signal: controller.signal, ...buildTlsOptions(bindings) });
  } catch (err) {
    const reason = err?.cause?.message || err?.message || 'fetch failed';
    throw errorWithCode('UNAVAILABLE', reason);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (!res.ok) mapHttpError(res, text);
  return { json: parseJson(text), text };
};

// ---- Context resolution ----

const mergedBindings = (ctx = {}) => ({ ...(ctx.config ?? {}), ...(ctx.secret ?? {}), ...(ctx.bindings ?? {}) });

const resolveCallContext = (ctx = {}) => ({
  ...ctx, bindings: mergedBindings(ctx), limits: ctx.limits ?? {}, meta: ctx.meta ?? {}, req: ctx.req ?? ctx.request ?? {},
});

const resolveTimeoutMs = (ctx = {}, bindings = {}) =>
  firstDefined(optionalUint32(ctx.limits?.timeoutMs), optionalUint32(bindings.timeoutMs), DEFAULT_TIMEOUT_MS);

// ---- SSL API call ----

const callSSLAPI = async (action, params, { meta, bindings, timeoutMs }) => {
  const secretId = unwrapString(firstDefined(bindings.secret_id, bindings.secretId)).trim();
  const secretKey = unwrapString(firstDefined(bindings.secret_key, bindings.secretKey)).trim();
  if (!secretId) throw errorWithCode('PERMISSION_DENIED', 'secret_id is required in bindings');
  if (!secretKey) throw errorWithCode('PERMISSION_DENIED', 'secret_key is required in bindings');

  const region = unwrapString(bindings.region).trim() || 'ap-guangzhou';

  // Only business params in body
  const payload = { ...params };
  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined || payload[key] === null) delete payload[key];
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const { authorization } = signRequest(secretId, secretKey, payload, timestamp);

  const url = `https://${ENDPOINT}`;
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    Host: ENDPOINT,
    'X-TC-Action': action,
    'X-TC-Version': API_VERSION,
    'X-TC-Region': region,
    'X-TC-Timestamp': String(timestamp),
    Authorization: authorization,
  };

  logInfo(meta, `${action}:start`, { action, region });

  let result;
  try {
    result = await fetchJson(url, { method: METHOD_POST, headers, body: JSON.stringify(payload) }, { bindings, timeoutMs });
  } catch (err) {
    logError(meta, `${action}:http-error`, { action, error: err.message });
    throw err;
  }

  const response = result.json?.Response;
  if (!response) {
    logError(meta, `${action}:invalid-response`, { body: result.text });
    throw errorWithCode('UNKNOWN', 'empty or invalid API response');
  }

  if (response.Error) {
    logError(meta, `${action}:api-error`, { code: response.Error.Code, message: response.Error.Message });
    if (response.Error.Code === 'UnauthorizedOperation' || response.Error.Code === 'AuthFailure') {
      throw errorWithCode('PERMISSION_DENIED', `API error: ${response.Error.Code} - ${response.Error.Message}`);
    }
    throw errorWithCode('FAILED_PRECONDITION', `API error: ${response.Error.Code} - ${response.Error.Message}`);
  }

  logInfo(meta, `${action}:success`, { action });
  return response;
};

// ---- Handlers ----

const makeRuntime = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings || {};
  const meta = callCtx.meta || {};
  const timeoutMs = resolveTimeoutMs(callCtx, bindings);

  const runList = async (req = {}) => {
    const limit = optionalUint32(firstDefined(req.limit)) || 20;
    const offset = optionalUint32(firstDefined(req.offset)) || 0;

    const params = { Limit: limit, Offset: offset };
    const response = await callSSLAPI('DescribeCertificates', params, { meta, bindings, timeoutMs });

    const items = (response.Certificates || []).map((cert) => ({
      id: cert.CertificateId || '',
      domain: cert.Domain || '',
      cert_type: cert.CertificateType || '',
      status: cert.StatusName || String(cert.Status ?? ''),
      create_time: cert.InsertTime || '',
      expire_time: cert.CertEndTime || '',
    }));

    return { code: 0, message: response.RequestId || 'ok', data: items, total: response.TotalCount || items.length };
  };

  const runGet = async (req = {}) => {
    const certificateId = unwrapString(firstDefined(req.certificate_id, req.certificateId, req.CertificateId)).trim();
    if (!certificateId) throw errorWithCode('INVALID_ARGUMENT', 'certificate_id is required');

    const params = { CertificateId: certificateId };
    const response = await callSSLAPI('DescribeCertificateDetail', params, { meta, bindings, timeoutMs });

    return {
      code: 0,
      message: response.RequestId || 'ok',
      id: response.CertificateId || '',
      domain: response.Domain || '',
      cert_type: response.CertificateType || '',
      status: response.StatusName || String(response.Status ?? ''),
      create_time: response.InsertTime || '',
      expire_time: response.CertEndTime || '',
      subject: response.Subject || response.Domain || '',
      san: response.SubjectAltName || response.SAN || [],
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
  signRequest,
};
