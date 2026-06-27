import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

// ---- Method paths ----

const METHOD_BLOCK_FULL = 'Huawei_WAF.Huawei_WAF/BlockIP';
const METHOD_UNBLOCK_FULL = 'Huawei_WAF.Huawei_WAF/UnblockIP';
const METHOD_LIST_FULL = 'Huawei_WAF.Huawei_WAF/ListRules';
const METHOD_LIST_INSTANCES_FULL = 'Huawei_WAF.Huawei_WAF/ListInstances';
const METHOD_LIST_POLICIES_FULL = 'Huawei_WAF.Huawei_WAF/ListPolicies';

// ---- Constants ----

const SCHEME = 'https';
const DEFAULT_TIMEOUT_MS = 10000;
const SDK_REF = 'Huawei_WAF';

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
  const keys = Object.keys(params).filter((k) => params[k] !== undefined && params[k] !== null);
  if (keys.length === 0) return '';
  keys.sort();
  return keys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`).join('&');
};

const signHuawei = (accessKey, secretKey, method, uri, queryString, body, sdkDate, region) => {
  const canonicalURI = uri || '/';
  const host = `waf.${region}.myhuaweicloud.com`;
  const payloadHash = sha256hex(body);
  const contentType = body ? 'application/json;charset=utf-8' : 'application/json';
  const signedHeaders = ['content-type', 'host', 'x-sdk-date'];
  const canonicalHeaders = [
    `content-type:${contentType}\n`,
    `host:${host}\n`,
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
  return { authorization, sdkDate, host, contentType };
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
  if (res.status >= 400 && res.status < 500) throw errorWithCode('FAILED_PRECONDITION', `upstream http ${res.status}`);
  throw errorWithCode('UNAVAILABLE', `upstream http ${res.status}`);
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

// ---- WAF API call ----

const callWAFAPI = async (method, uriPath, queryString, body, { meta, bindings, timeoutMs }) => {
  const accessKey = unwrapString(firstDefined(bindings.access_key, bindings.accessKey, bindings.ak)).trim();
  const secretKey = unwrapString(firstDefined(bindings.secret_key, bindings.secretKey, bindings.sk)).trim();
  if (!accessKey) throw errorWithCode('PERMISSION_DENIED', 'access_key is required in bindings');
  if (!secretKey) throw errorWithCode('PERMISSION_DENIED', 'secret_key is required in bindings');

  const region = unwrapString(bindings.region).trim() || 'cn-north-4';
  const sdkDate = iso8601Basic(Math.floor(Date.now() / 1000));
  const { authorization, host, contentType } = signHuawei(accessKey, secretKey, method, uriPath, queryString, body || '', sdkDate, region);

  const url = `${SCHEME}://${host}${uriPath}${queryString ? '?' + queryString : ''}`;
  const headers = {
    Host: host,
    'X-Sdk-Date': sdkDate,
    Authorization: authorization,
    'Content-Type': contentType,
  };

  const action = uriPath.replace(/\/v1\/[^/]+\/waf\//, '');
  logInfo(meta, `${method}:${action}:start`, { url });

  let result;
  try {
    result = await fetchJson(url, { method, headers, body: body || undefined }, { bindings, timeoutMs });
  } catch (err) {
    logError(meta, `${method}:${action}:http-error`, { url, error: err.message });
    throw err;
  }

  logInfo(meta, `${method}:${action}:success`, { url, raw_response: result.json });
  return result.json || {};
};

// ---- Handlers ----

const makeRuntime = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings || {};
  const meta = callCtx.meta || {};
  const timeoutMs = resolveTimeoutMs(callCtx, bindings);
  const projectId = unwrapString(firstDefined(bindings.project_id, bindings.projectId)).trim();
  const policyId = unwrapString(firstDefined(bindings.policy_id, bindings.policyId)).trim();

  const baseUri = (extra) => `/v1/${projectId}/waf${extra}`;

  const runBlock = async (req = {}) => {
    const ip = unwrapString(firstDefined(req.ip, req.addr)).trim();
    if (!ip) throw errorWithCode('INVALID_ARGUMENT', 'ip is required');
    if (!policyId) throw errorWithCode('FAILED_PRECONDITION', 'policy_id is required in config');

    const comment = unwrapString(firstDefined(req.comment, req.description)).trim() || 'blocked by OctoBus';
    const name = `octo-block-${ip.replace(/\./g, '-')}`;

    const response = await callWAFAPI('POST', baseUri(`/policy/${policyId}/whiteblackip`), '', JSON.stringify({
      name, white: 0, addr: ip, description: comment,
    }), { meta, bindings, timeoutMs });

    return { code: 0, message: 'ok', rule_id: response.id || '' };
  };

  const runUnblock = async (req = {}) => {
    const ruleId = unwrapString(firstDefined(req.rule_id, req.ruleId)).trim();
    if (!ruleId) throw errorWithCode('INVALID_ARGUMENT', 'rule_id is required');
    if (!policyId) throw errorWithCode('FAILED_PRECONDITION', 'policy_id is required in config');

    await callWAFAPI('DELETE', baseUri(`/policy/${policyId}/whiteblackip/${ruleId}`), '', '', { meta, bindings, timeoutMs });

    return { code: 0, message: 'ok' };
  };

  const runList = async (req = {}) => {
    if (!policyId) throw errorWithCode('FAILED_PRECONDITION', 'policy_id is required in config');
    const page = optionalUint32(firstDefined(req.page, req.offset)) || 1;
    const pageSize = optionalUint32(firstDefined(req.pagesize, req.limit)) || 20;
    const qs = buildCanonicalQueryString({ page, pagesize: pageSize });

    const response = await callWAFAPI('GET', baseUri(`/policy/${policyId}/whiteblackip`), qs, '', { meta, bindings, timeoutMs });

    const items = (response.items || []).map((rule) => ({
      id: rule.id || '',
      ip: rule.addr || '',
      name: rule.name || '',
      action: rule.white === 0 ? 0 : rule.white === 1 ? 1 : 2,
      description: rule.description || '',
      create_time: String(rule.timestamp || ''),
    }));

    return { code: 0, message: 'ok', data: items, total: response.total || items.length };
  };

  const runListInstances = async (req = {}) => {
    const page = optionalUint32(firstDefined(req.page, req.offset)) || 1;
    const pageSize = optionalUint32(firstDefined(req.pagesize, req.limit)) || 20;
    const qs = buildCanonicalQueryString({ page, pagesize: pageSize });

    const response = await callWAFAPI('GET', baseUri('/instance'), qs, '', { meta, bindings, timeoutMs });

    const items = (response.items || []).map((inst) => ({
      id: inst.id || '',
      hostname: inst.hostname || '',
      policy_id: inst.policyid || '',
      access_code: inst.access_code || '',
      protect_status: inst.protect_status || '',
      create_time: String(inst.timestamp || ''),
    }));

    return { code: 0, message: 'ok', data: items, total: response.total || items.length };
  };

  const runListPolicies = async (req = {}) => {
    const page = optionalUint32(firstDefined(req.page, req.offset)) || 1;
    const pageSize = optionalUint32(firstDefined(req.pagesize, req.limit)) || 20;
    const qs = buildCanonicalQueryString({ page, pagesize: pageSize });

    const response = await callWAFAPI('GET', baseUri('/policy'), qs, '', { meta, bindings, timeoutMs });

    const items = (response.items || []).map((p) => ({
      id: p.id || '',
      name: p.name || '',
      level: p.level || 0,
      action_mode: (p.action || {}).category || '',
      create_time: String(p.timestamp || ''),
    }));

    return { code: 0, message: 'ok', data: items, total: response.total || items.length };
  };

  return { runBlock, runUnblock, runList, runListInstances, runListPolicies };
};

// ---- Exports ----

export const handlers = {
  [METHOD_BLOCK_FULL]: (ctx) => makeRuntime(ctx).runBlock(ctx.request ?? {}),
  [METHOD_UNBLOCK_FULL]: (ctx) => makeRuntime(ctx).runUnblock(ctx.request ?? {}),
  [METHOD_LIST_FULL]: (ctx) => makeRuntime(ctx).runList(ctx.request ?? {}),
  [METHOD_LIST_INSTANCES_FULL]: (ctx) => makeRuntime(ctx).runListInstances(ctx.request ?? {}),
  [METHOD_LIST_POLICIES_FULL]: (ctx) => makeRuntime(ctx).runListPolicies(ctx.request ?? {}),
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
