import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

// ---- Method paths ----

const METHOD_BLOCK_FULL = 'Tencent_CFW.Tencent_CFW/BlockIP';
const METHOD_UNBLOCK_FULL = 'Tencent_CFW.Tencent_CFW/UnblockIP';
const METHOD_LIST_FULL = 'Tencent_CFW.Tencent_CFW/ListRules';

// ---- Constants ----

const SERVICE = 'cfw';
const API_VERSION = '2019-09-04';
const ENDPOINT = `${SERVICE}.tencentcloudapi.com`;
const METHOD_POST = 'POST';
const DEFAULT_TIMEOUT_MS = 10000;

const SERVICE_NAME = 'Tencent_CFW';

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

const extractStringList = (value) => {
  if (value === undefined || value === null) return undefined;
  const list = Array.isArray(value) ? value : Array.isArray(value?.values) ? value.values : undefined;
  if (!list) return undefined;
  return list.map((item) => {
    if (item === undefined || item === null) throw errorWithCode('INVALID_ARGUMENT', 'list elements must be non-empty strings');
    return unwrapString(item).trim();
  });
};

const ensureIPs = (req = {}) => {
  const candidates = [req.ips, req.ip_list, req.ipList, req.addresses];
  const found = candidates.reduce((acc, item) => (acc !== undefined ? acc : extractStringList(item)), undefined);
  if (!found || found.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'ips must be a non-empty array');
  return found;
};

const validateIP = (ip) => {
  if (typeof ip !== 'string' || !ip.trim()) throw errorWithCode('INVALID_ARGUMENT', 'ip must be a non-empty string');
  const trimmed = ip.trim();
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(trimmed)) throw errorWithCode('INVALID_ARGUMENT', `${trimmed} is not a valid IPv4 address`);
  for (const part of trimmed.split('.')) {
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) throw errorWithCode('INVALID_ARGUMENT', `${trimmed} is not a valid IPv4 address`);
  }
  return trimmed;
};

// ---- Signature (TC3-HMAC-SHA256) ----

const sha256hex = (message) => crypto.createHash('sha256').update(Buffer.from(message, 'utf-8')).digest('hex');

const hmacSha256 = (key, message) => crypto.createHmac('sha256', key).update(Buffer.from(message, 'utf-8')).digest();

const formatDate = (timestamp) => {
  const d = new Date(timestamp * 1000);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const buildCanonicalRequest = (payloadJson) => {
  const canonicalUri = '/';
  const canonicalQueryString = '';
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${ENDPOINT}\n`;
  const signedHeaders = 'content-type;host';
  const hashedRequestBody = sha256hex(payloadJson);
  return {
    canonicalRequest: `${METHOD_POST}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${hashedRequestBody}`,
    signedHeaders,
  };
};

const buildStringToSign = (canonicalRequest, timestamp, date) => {
  const algorithm = 'TC3-HMAC-SHA256';
  const credentialScope = `${date}/${SERVICE}/tc3_request`;
  const hashedCanonicalRequest = sha256hex(canonicalRequest);
  return {
    stringToSign: `${algorithm}\n${timestamp}\n${credentialScope}\n${hashedCanonicalRequest}`,
    algorithm,
    credentialScope,
  };
};

const calcSignature = (secretKey, date, stringToSign) => {
  const secretDate = hmacSha256(`TC3${secretKey}`, date);
  const secretService = hmacSha256(secretDate, SERVICE);
  const secretSigning = hmacSha256(secretService, 'tc3_request');
  return hmacSha256(secretSigning, stringToSign).toString('hex');
};

const buildAuthHeader = (algorithm, secretId, credentialScope, signedHeaders, signature) =>
  `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

const signRequest = (secretId, secretKey, payload, timestamp) => {
  const payloadJson = JSON.stringify(payload);
  const date = formatDate(timestamp);
  const { canonicalRequest, signedHeaders } = buildCanonicalRequest(payloadJson);
  const { stringToSign, algorithm, credentialScope } = buildStringToSign(canonicalRequest, timestamp, date);
  const signature = calcSignature(secretKey, date, stringToSign);
  const authorization = buildAuthHeader(algorithm, secretId, credentialScope, signedHeaders, signature);
  return { authorization, timestamp, date };
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
  try {
    console.log(prefix, JSON.stringify(payload));
  } catch {
    console.log(prefix, payload);
  }
};

const logError = (meta, action, payload) => {
  const prefix = buildLogPrefix(meta, action);
  try {
    console.error(prefix, JSON.stringify(payload));
  } catch {
    console.error(prefix, payload);
  }
};

// ---- HTTP ----

const parseJson = (text) => {
  if (!String(text || '').trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', 'response is not valid JSON');
  }
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
  req: ctx.req ?? ctx.request ?? {},
});

const resolveTimeoutMs = (ctx = {}, bindings = {}) =>
  firstDefined(optionalUint32(ctx.limits?.timeoutMs), optionalUint32(bindings.timeoutMs), DEFAULT_TIMEOUT_MS);

// ---- CFW API call ----

const callCFWAPI = async (action, params, { meta, bindings, timeoutMs }) => {
  const secretId = unwrapString(firstDefined(bindings.secret_id, bindings.secretId)).trim();
  const secretKey = unwrapString(firstDefined(bindings.secret_key, bindings.secretKey)).trim();
  if (!secretId) throw errorWithCode('PERMISSION_DENIED', 'secret_id is required in bindings');
  if (!secretKey) throw errorWithCode('PERMISSION_DENIED', 'secret_key is required in bindings');

  const region = unwrapString(bindings.region).trim() || 'ap-guangzhou';

  // Only business params in body (Action/Version/Region go only in X-TC-* headers)
  const payload = { ...params };
  // Remove null/undefined params
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
    result = await fetchJson(url, {
      method: METHOD_POST,
      headers,
      body: JSON.stringify(payload),
    }, { bindings, timeoutMs });
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

// ---- Handler factory ----

const makeRuntime = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings || {};
  const meta = callCtx.meta || {};
  const timeoutMs = resolveTimeoutMs(callCtx, bindings);
  const request = callCtx.req || {};

  const runBlock = async (req = {}) => {
    const ips = ensureIPs(req);
    ips.forEach(validateIP);
    const comment = unwrapString(firstDefined(req.comment, req.Comment)).trim() || 'blocked by OctoBus';

    // Create access control rules (deny) for each IP
    const rules = ips.map((ip, idx) => ({
      OrderIndex: idx,
      SourceIp: ip,
      TargetIp: '0.0.0.0/0',
      SourceType: 1,     // 1=IP, 3=domain, 4=IP template, 5=domain template
      TargetType: 1,
      Direction: 1,      // 1=inbound (block incoming traffic)
      Protocol: 'ANY',
      Strategy: 'drop',  // drop traffic
      Port: '-1/-1',     // any port
      Detail: comment.slice(0, 100),
    }));

    const params = { Data: rules, Type: 0, Enable: 1 };
    const response = await callCFWAPI('CreateAcRules', params, { meta, bindings, timeoutMs });
    return { code: 0, message: response.RequestId || 'ok' };
  };

  const runUnblock = async (req = {}) => {
    const ips = ensureIPs(req);

    // List existing rules with pagination to find matching ones
    const ipSet = new Set(ips);
    const allRules = [];
    let offset = 0;
    const PAGE_LIMIT = 100;
    let hasMore = true;
    while (hasMore) {
      const listResp = await callCFWAPI('DescribeAcLists', { Limit: PAGE_LIMIT, Offset: offset }, { meta, bindings, timeoutMs });
      const rules = listResp.Data || [];
      allRules.push(...rules);
      if (rules.length < PAGE_LIMIT) hasMore = false;
      offset += PAGE_LIMIT;
    }

    // Find rule IDs to delete (match by source IP)
    const ruleIds = allRules
      .filter((rule) => ipSet.has(rule.SourceIp))
      .map((rule) => rule.Id)
      .filter(Boolean);

    if (ruleIds.length === 0) {
      return { code: 0, message: 'no matching rules found' };
    }

    // Delete rules
    for (const ruleId of ruleIds) {
      await callCFWAPI('DeleteAcRule', { Id: ruleId }, { meta, bindings, timeoutMs });
    }
    return { code: 0, message: `deleted ${ruleIds.length} rules` };
  };

  const runList = async (req = {}) => {
    const limit = optionalUint32(firstDefined(req.limit)) || 20;
    const offset = optionalUint32(firstDefined(req.offset)) || 0;

    const params = { Limit: limit, Offset: offset };
    const response = await callCFWAPI('DescribeAcLists', params, { meta, bindings, timeoutMs });

    const items = (response.Data || []).map((rule) => ({
      id: String(rule.Id || rule.IdStr || ''),
      source_ip: rule.SourceIp || '',
      target_ip: rule.TargetIp || '',
      rule_action: rule.RuleAction || '',
      description: rule.Description || '',
      create_time: '',
    }));

    return { code: 0, message: response.RequestId || 'ok', data: items, total: response.Total || response.AllTotal || items.length };
  };

  return { runBlock, runUnblock, runList };
};

// ---- Exports ----

export const handlers = {
  [METHOD_BLOCK_FULL]: (ctx) => {
    const runtime = makeRuntime(ctx);
    return runtime.runBlock(ctx.request ?? {});
  },
  [METHOD_UNBLOCK_FULL]: (ctx) => {
    const runtime = makeRuntime(ctx);
    return runtime.runUnblock(ctx.request ?? {});
  },
  [METHOD_LIST_FULL]: (ctx) => {
    const runtime = makeRuntime(ctx);
    return runtime.runList(ctx.request ?? {});
  },
};

export const _test = {
  sha256hex,
  hmacSha256,
  signRequest,
  callCFWAPI,
  errorWithCode,
  ensureIPs,
  fetchJson,
  firstDefined,
  hasOwn,
  logError,
  logInfo,
  makeRuntime,
  mapHttpError,
  mergedBindings,
  optionalUint32,
  parseJson,
  resolveCallContext,
  resolveTimeoutMs,
  toBoolean,
  unwrapString,
};
