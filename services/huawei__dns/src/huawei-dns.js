import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

// ---- Method paths ----

const METHOD_LIST_ZONES_FULL = 'Huawei_DNS.Huawei_DNS/ListZones';
const METHOD_LIST_RECORDSETS_FULL = 'Huawei_DNS.Huawei_DNS/ListRecordSets';
const METHOD_CREATE_RECORDSET_FULL = 'Huawei_DNS.Huawei_DNS/CreateRecordSet';
const METHOD_DELETE_RECORDSET_FULL = 'Huawei_DNS.Huawei_DNS/DeleteRecordSet';

// ---- Constants ----

const SCHEME = 'https';
const ENDPOINT = 'dns.myhuaweicloud.com';
const DEFAULT_TIMEOUT_MS = 10000;
const SDK_REF = 'Huawei_DNS';

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

const optionalInt32 = (value) => {
  const raw = value && typeof value === 'object' && hasOwn(value, 'value') ? value.value : value;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num)) return undefined;
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

const ensureTrailingSlash = (p) => {
  if (!p || p === '/') return '/';
  return p.endsWith('/') ? p : `${p}/`;
};

const buildCanonicalQueryString = (params = {}) => {
  const keys = Object.keys(params).filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '');
  if (keys.length === 0) return '';
  keys.sort();
  return keys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`).join('&');
};

const signHuawei = (accessKey, secretKey, method, uri, queryString, body, sdkDate) => {
  const canonicalURI = uri || '/';
  const payloadHash = sha256hex(body || '');
  const contentType = body ? 'application/json;charset=utf-8' : 'application/json';
  const signedHeaders = ['content-type', 'host', 'x-sdk-date'];
  const canonicalHeaders = [
    `content-type:${contentType}\n`,
    `host:${ENDPOINT}\n`,
    `x-sdk-date:${sdkDate}\n`,
  ].join('');
  const canonicalRequest = [
    method,
    canonicalURI,
    queryString,
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n');
  const canonicalRequestHash = sha256hex(canonicalRequest);
  const stringToSign = `SDK-HMAC-SHA256\n${sdkDate}\n${canonicalRequestHash}`;
  const signature = hmacSha256(secretKey, stringToSign).toString('hex');
  const authorization = `SDK-HMAC-SHA256 Access=${accessKey}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`;
  return { authorization, sdkDate, contentType };
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

// ---- DNS API call ----

const callDNSAPI = async (method, uriPath, queryString, body, { meta, bindings, timeoutMs }) => {
  const accessKey = unwrapString(firstDefined(bindings.access_key, bindings.accessKey)).trim();
  const secretKey = unwrapString(firstDefined(bindings.secret_key, bindings.secretKey)).trim();
  if (!accessKey) throw errorWithCode('PERMISSION_DENIED', 'access_key is required in bindings');
  if (!secretKey) throw errorWithCode('PERMISSION_DENIED', 'secret_key is required in bindings');

  const sdkDate = iso8601Basic(Math.floor(Date.now() / 1000));
  const { authorization, contentType } = signHuawei(accessKey, secretKey, method, uriPath, queryString, body || '', sdkDate);

  const url = `${SCHEME}://${ENDPOINT}${uriPath}${queryString ? '?' + queryString : ''}`;
  const headers = {
    Host: ENDPOINT,
    'X-Sdk-Date': sdkDate,
    Authorization: authorization,
    'Content-Type': contentType,
  };

  logInfo(meta, `${method}:start`, { url });

  let result;
  try {
    result = await fetchJson(url, { method, headers, body: body || undefined }, { bindings, timeoutMs });
  } catch (err) {
    logError(meta, `${method}:http-error`, { url, error: err.message });
    throw err;
  }

  logInfo(meta, `${method}:success`, { url, raw_response: result.json });
  return result.json || {};
};

// ---- Handlers ----

const makeRuntime = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings || {};
  const meta = callCtx.meta || {};
  const timeoutMs = resolveTimeoutMs(callCtx, bindings);

  const runListZones = async (req = {}) => {
    const limit = optionalUint32(firstDefined(req.limit)) || 20;
    const offset = optionalUint32(firstDefined(req.offset)) || 0;
    const qs = buildCanonicalQueryString({ limit, offset });

    const response = await callDNSAPI('GET', '/v2/zones', qs, '', { meta, bindings, timeoutMs });

    const items = (response.zones || []).map((zone) => ({
      id: zone.id || '',
      name: zone.name || '',
      zone_type: zone.zone_type || zone.type || '',
      status: zone.status || '',
      ttl: zone.ttl || 0,
      create_time: zone.created_at || zone.create_at || '',
    }));

    return { code: 0, message: 'ok', data: items, total: response.metadata?.total_count ?? items.length };
  };

  const runListRecordSets = async (req = {}) => {
    const zoneId = unwrapString(firstDefined(req.zone_id, req.zoneId)).trim();
    if (!zoneId) throw errorWithCode('INVALID_ARGUMENT', 'zone_id is required');

    const limit = optionalUint32(firstDefined(req.limit)) || 20;
    const offset = optionalUint32(firstDefined(req.offset)) || 0;
    const params = { limit, offset, zone_id: zoneId };
    const name = unwrapString(req.name).trim();
    const rtype = unwrapString(req.type).trim();
    if (name) params.name = name;
    if (rtype) params.type = rtype;

    const qs = buildCanonicalQueryString(params);
    const response = await callDNSAPI('GET', '/v2/recordsets', qs, '', { meta, bindings, timeoutMs });

    const items = (response.recordsets || []).map((rs) => ({
      id: rs.id || '',
      name: rs.name || '',
      type: rs.type || '',
      value: (rs.records || []).join(', ') || '',
      ttl: rs.ttl || 0,
      status: rs.status || '',
      zone_id: rs.zone_id || '',
      zone_name: rs.zone_name || '',
      create_time: rs.created_at || '',
    }));

    return { code: 0, message: 'ok', data: items, total: response.metadata?.total_count ?? items.length };
  };

  const runCreateRecordSet = async (req = {}) => {
    const zoneId = unwrapString(firstDefined(req.zone_id, req.zoneId)).trim();
    const name = unwrapString(req.name).trim();
    const rtype = unwrapString(req.type).trim().toUpperCase();
    const value = unwrapString(req.value).trim();

    if (!zoneId) throw errorWithCode('INVALID_ARGUMENT', 'zone_id is required');
    if (!name) throw errorWithCode('INVALID_ARGUMENT', 'name is required');
    if (!rtype) throw errorWithCode('INVALID_ARGUMENT', 'type is required');
    if (!value) throw errorWithCode('INVALID_ARGUMENT', 'value is required');

    const ttl = optionalInt32(firstDefined(req.ttl)) || 300;
    const description = unwrapString(req.description).trim();

    const body = { name, type: rtype, records: [value], ttl };
    if (description) body.description = description;

    const response = await callDNSAPI('POST', `/v2/zones/${encodeURIComponent(zoneId)}/recordsets`, '', JSON.stringify(body), { meta, bindings, timeoutMs });

    return {
      code: 0, message: 'ok',
      id: response.id || '',
      name: response.name || '',
      type: response.type || '',
      value: (response.records || []).join(', ') || '',
    };
  };

  const runDeleteRecordSet = async (req = {}) => {
    const zoneId = unwrapString(firstDefined(req.zone_id, req.zoneId)).trim();
    const recordsetId = unwrapString(firstDefined(req.recordset_id, req.recordsetId)).trim();

    if (!zoneId) throw errorWithCode('INVALID_ARGUMENT', 'zone_id is required');
    if (!recordsetId) throw errorWithCode('INVALID_ARGUMENT', 'recordset_id is required');

    await callDNSAPI('DELETE', `/v2/zones/${encodeURIComponent(zoneId)}/recordsets/${encodeURIComponent(recordsetId)}`, '', '', { meta, bindings, timeoutMs });

    return { code: 0, message: 'ok' };
  };

  return { runListZones, runListRecordSets, runCreateRecordSet, runDeleteRecordSet };
};

// ---- Exports ----

export const handlers = {
  [METHOD_LIST_ZONES_FULL]: (ctx) => makeRuntime(ctx).runListZones(ctx.request ?? {}),
  [METHOD_LIST_RECORDSETS_FULL]: (ctx) => makeRuntime(ctx).runListRecordSets(ctx.request ?? {}),
  [METHOD_CREATE_RECORDSET_FULL]: (ctx) => makeRuntime(ctx).runCreateRecordSet(ctx.request ?? {}),
  [METHOD_DELETE_RECORDSET_FULL]: (ctx) => makeRuntime(ctx).runDeleteRecordSet(ctx.request ?? {}),
};

export const _test = {
  sha256hex, hmacSha256, signHuawei, buildCanonicalQueryString, iso8601Basic,
  ensureTrailingSlash,
  errorWithCode, firstDefined, hasOwn, logInfo, logError, makeRuntime, mapHttpError,
  mergedBindings, optionalUint32, parseJson, resolveCallContext, resolveTimeoutMs, toBoolean, unwrapString,
};
