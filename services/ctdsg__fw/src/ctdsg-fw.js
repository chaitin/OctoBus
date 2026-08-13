import { createHmac } from 'node:crypto';

import { Agent } from 'undici';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const BLOCK_IP_PATH = '/CTDSG_FW.CTDSG_FW/BlockIP';
export const UNBLOCK_IP_PATH = '/CTDSG_FW.CTDSG_FW/UnblockIP';
export const BLOCK_DOMAIN_PATH = '/CTDSG_FW.CTDSG_FW/BlockDomain';
export const UNBLOCK_DOMAIN_PATH = '/CTDSG_FW.CTDSG_FW/UnblockDomain';

export const METHOD_BLOCK_IP_FULL = 'CTDSG_FW.CTDSG_FW/BlockIP';
export const METHOD_UNBLOCK_IP_FULL = 'CTDSG_FW.CTDSG_FW/UnblockIP';
export const METHOD_BLOCK_DOMAIN_FULL = 'CTDSG_FW.CTDSG_FW/BlockDomain';
export const METHOD_UNBLOCK_DOMAIN_FULL = 'CTDSG_FW.CTDSG_FW/UnblockDomain';

export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_API_PATH = '/api.php/inter/Inter';
export const TIME_PERMANENT = 1;
export const TIME_TEMPORARY = 0;
export const TYPE_IP = 0;
export const TYPE_DOMAIN = 1;

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const firstDefined = (...vals) => vals.find((val) => val !== undefined && val !== null);

const normalizeString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

const optionalString = (value) => {
  const text = normalizeString(value);
  return text ? text : undefined;
};

const requireString = (value, fieldName) => {
  const text = normalizeString(value);
  if (!text) throw errorWithCode('INVALID_ARGUMENT', `${fieldName} is required`);
  return text;
};

const optionalUint32 = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num) || Number.isNaN(num) || num < 0) return undefined;
  return Math.trunc(num);
};

const optionalBoolean = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  }
  return undefined;
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.secret ?? {}),
  ...(ctx?.bindings ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.req ?? ctx.request ?? {},
});

const normalizeBaseUrl = (value) => {
  const text = optionalString(value);
  if (!text) return '';
  if (!/^https?:\/\//i.test(text)) return '';
  return text.replace(/\/+$/, '');
};

const resolveHost = (ctx = {}) => {
  const req = ctx.req || {};
  const bindings = ctx.bindings || {};
  for (const candidate of [
    req.host,
    req.baseUrl,
    req.base_url,
    bindings.host,
    bindings.restBaseUrl,
    bindings.baseUrl,
    bindings.rest_base_url,
    bindings.base_url,
  ]) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized) return normalized;
  }
  throw errorWithCode('INVALID_ARGUMENT', 'host/baseUrl is required and must include http/https');
};

const resolveAppId = (ctx = {}) => {
  const req = ctx.req || {};
  const bindings = ctx.bindings || {};
  return requireString(firstDefined(req.appId, req.app_id, bindings.appId, bindings.app_id), 'appId');
};

const resolveApiPath = (ctx = {}) => {
  const req = ctx.req || {};
  const bindings = ctx.bindings || {};
  const path = optionalString(firstDefined(req.apiPath, req.api_path, bindings.apiPath, bindings.api_path)) || DEFAULT_API_PATH;
  return path.startsWith('/') ? path : `/${path}`;
};

const resolveSecretKey = (ctx = {}) => {
  const req = ctx.req || {};
  const bindings = ctx.bindings || {};
  return requireString(firstDefined(req.secretKey, req.secret_key, bindings.secretKey, bindings.secret_key), 'secretKey');
};

const resolveTimeoutMs = (ctx = {}) => {
  const req = ctx.req || {};
  const bindings = ctx.bindings || {};
  const limits = ctx.limits || {};
  const candidates = [
    optionalUint32(req.timeoutMs),
    optionalUint32(req.timeout_ms),
    optionalUint32(bindings.timeoutMs),
    optionalUint32(bindings.timeout_ms),
    optionalUint32(limits.timeoutMs),
    DEFAULT_TIMEOUT_MS,
  ];
  const selected = candidates.find((candidate) => Number.isFinite(candidate) && candidate > 0);
  return Math.trunc(selected);
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

const shouldSkipTlsVerify = (ctx = {}) => {
  const bindings = ctx.bindings || {};
  return toBoolean(bindings.skipTlsVerify) || toBoolean(bindings.tlsInsecureSkipVerify) || toBoolean(bindings.insecureSkipVerify);
};

const buildTlsOptions = (ctx = {}) => {
  const bindings = ctx.bindings || {};
  if (!shouldSkipTlsVerify(ctx)) return {};
  return {
    dispatcher: new Agent({
      connect: {
        rejectUnauthorized: false,
      },
    }),
  };
};

const buildHeaders = (ctx = {}, extra = {}) => {
  const bindings = ctx.bindings || {};
  const meta = ctx.meta || {};
  return {
    ...(bindings.headers || {}),
    'x-engine-instance': meta.instance_id || meta.instanceId || 'unknown',
    'x-request-id': meta.request_id || meta.requestId || 'unknown',
    ...extra,
  };
};

const buildUrl = (host, path, query = {}) => {
  const base = host.replace(/\/+$/, '');
  const normalizedPath = String(path || '').replace(/^\/+/, '');
  const prefix = `${base}/${normalizedPath}`;
  const pairs = [];
  for (const [key, raw] of Object.entries(query)) {
    if (raw === undefined || raw === null || raw === '') continue;
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return pairs.length ? `${prefix}?${pairs.join('&')}` : prefix;
};

const toBodyJson = (body) => JSON.stringify(body ?? {});

const createSignature = (bodyJson, timestamp, secretKey) =>
  createHmac('md5', secretKey).update(`${bodyJson}${timestamp}`).digest('hex');

const buildSignedHeaders = (ctx, bodyJson) => {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createSignature(bodyJson, timestamp, resolveSecretKey(ctx));
  return buildHeaders(ctx, {
    'content-type': 'application/json',
    'hy-bz-api-app-id': resolveAppId(ctx),
    'hy-bz-api-timestamp': timestamp,
    'hy-bz-api-signature': signature,
  });
};

const fetchHttp = async (ctx, operation, body) => {
  const host = resolveHost(ctx);
  const url = buildUrl(host, resolveApiPath(ctx), { opt: operation });
  const bodyJson = toBodyJson(body);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(resolveTimeoutMs(ctx)),
      ...buildTlsOptions(ctx),
      headers: buildSignedHeaders(ctx, bodyJson),
      body: bodyJson,
    });
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', err?.cause?.message || err?.message || 'fetch failed');
  }
  const text = await res.text();
  return normalizeResponse(res.status, extractHeaders(res), text, url);
};

const parseStringList = (value, fieldName) => {
  const raw = unwrapScalar(value);
  const source = raw ?? [];
  if (!Array.isArray(source)) throw errorWithCode('INVALID_ARGUMENT', `${fieldName} must be an array`);
  if (source.length === 0) throw errorWithCode('INVALID_ARGUMENT', `${fieldName} must be non-empty`);
  return source.map((item, index) => {
    const text = normalizeString(item);
    if (!text) throw errorWithCode('INVALID_ARGUMENT', `${fieldName}[${index}] is blank`);
    return text;
  });
};

const isIPv4 = (value) => {
  const text = String(value || '').trim();
  const parts = text.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
};

const isIPv6 = (value) => {
  const text = String(value || '').trim();
  if (!text || text.includes('/')) return false;
  if (!text.includes(':')) return false;
  if ((text.match(/::/g) || []).length > 1) return false;
  if (/::ffff:\d{1,3}(?:\.\d{1,3}){3}$/i.test(text)) {
    return isIPv4(text.substring(text.lastIndexOf(':') + 1));
  }
  if (!/^[0-9a-fA-F:.]+$/.test(text)) return false;
  const parts = text.split('::');
  const left = parts[0] ? parts[0].split(':').filter(Boolean) : [];
  const right = parts[1] ? parts[1].split(':').filter(Boolean) : [];
  if (left.some((part) => part.length > 4) || right.some((part) => part.length > 4)) return false;
  if (parts.length === 1 && left.length !== 8) return false;
  if (parts.length === 2 && left.length + right.length >= 8) return false;
  return true;
};

const validateIps = (value) => {
  const ips = parseStringList(value, 'ips');
  for (let i = 0; i < ips.length; i += 1) {
    if (!isIPv4(ips[i]) && !isIPv6(ips[i])) throw errorWithCode('INVALID_ARGUMENT', `ips[${i}] must be a valid IP address`);
  }
  return ips;
};

const DOMAIN_RE = /^(?:\*\.)?[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

const validateDomains = (value) => {
  const domains = parseStringList(value, 'domains');
  for (let i = 0; i < domains.length; i += 1) {
    if (!DOMAIN_RE.test(domains[i])) throw errorWithCode('INVALID_ARGUMENT', `domains[${i}] must be a valid domain`);
  }
  return domains;
};

const validateBlockTiming = (req = {}) => {
  const permanent = optionalBoolean(req.permanent) ?? true;
  if (permanent) return { permanent: true };
  const punishTime = optionalUint32(req.punish_time ?? req.punishTime);
  const timeUnit = optionalUint32(req.time_unit ?? req.timeUnit);
  if (!punishTime || punishTime <= 0) throw errorWithCode('INVALID_ARGUMENT', 'punish_time must be a positive integer when permanent is false');
  if (![1, 2, 3].includes(timeUnit)) throw errorWithCode('INVALID_ARGUMENT', 'time_unit must be one of 1, 2, or 3 when permanent is false');
  return { permanent: false, punishTime, timeUnit };
};

const buildBlockBody = (targets, addrType, timing) => {
  const body = {
    action: 'save',
    type: String(addrType),
    time: String(timing.permanent ? TIME_PERMANENT : TIME_TEMPORARY),
  };
  if (addrType === TYPE_IP) body.ip_area = targets.join('\n');
  if (addrType === TYPE_DOMAIN) body.domainname = targets.join('\n');
  if (!timing.permanent) {
    body.punish_time = String(timing.punishTime);
    body.time_unit = String(timing.timeUnit);
  }
  return body;
};

const buildUnblockBody = (targets, addrType) => ({
  name: targets.join('\n'),
  addr_type: String(addrType),
});

const toStruct = (obj) => {
  const fields = {};
  for (const [key, value] of Object.entries(obj || {})) fields[key] = toValue(value);
  return { fields };
};

const toValue = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return { nullValue: 'NULL_VALUE' };
  if (typeof raw === 'string') return { stringValue: raw };
  if (typeof raw === 'number') return { numberValue: raw };
  if (typeof raw === 'boolean') return { boolValue: raw };
  if (Array.isArray(raw)) return { listValue: { values: raw.map((item) => toValue(item)) } };
  if (typeof raw === 'object') return { structValue: toStruct(raw) };
  return { stringValue: String(raw) };
};

const parseJsonObject = (text) => {
  if (!String(text || '').trim()) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const extractHeaders = (res) => {
  const map = new Map();
  const headers = res?.headers;
  if (headers && typeof headers.forEach === 'function') {
    headers.forEach((value, key) => {
      const k = String(key || '');
      if (!k) return;
      const existing = map.get(k) || [];
      if (Array.isArray(value)) existing.push(...value.map(String));
      else existing.push(String(value ?? ''));
      map.set(k, existing);
    });
  } else if (headers && typeof headers.entries === 'function') {
    for (const [key, value] of headers.entries()) map.set(String(key), [String(value ?? '')]);
  }
  return Array.from(map.entries()).map(([key, values]) => ({ key, values }));
};

const normalizeResponse = (status, headers, rawBody, effectiveUrl) => ({
  status_code: Number(status) || 0,
  statusCode: Number(status) || 0,
  headers,
  raw_body: String(rawBody ?? ''),
  rawBody: String(rawBody ?? ''),
  body_json: toStruct(parseJsonObject(rawBody)),
  bodyJson: parseJsonObject(rawBody),
  effective_url: effectiveUrl,
  effectiveUrl,
});

const handleBlockIp = (req, ctx) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const ips = validateIps(callCtx.req?.ips);
  const timing = validateBlockTiming(callCtx.req || {});
  return fetchHttp(callCtx, 'addPatchblack2', [buildBlockBody(ips, TYPE_IP, timing)]);
};

const handleUnblockIp = (req, ctx) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const ips = validateIps(callCtx.req?.ips);
  return fetchHttp(callCtx, 'delblack2', buildUnblockBody(ips, TYPE_IP));
};

const handleBlockDomain = (req, ctx) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const domains = validateDomains(callCtx.req?.domains);
  const timing = validateBlockTiming(callCtx.req || {});
  return fetchHttp(callCtx, 'addPatchblack2', [buildBlockBody(domains, TYPE_DOMAIN, timing)]);
};

const handleUnblockDomain = (req, ctx) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const domains = validateDomains(callCtx.req?.domains);
  return fetchHttp(callCtx, 'delblack2', buildUnblockBody(domains, TYPE_DOMAIN));
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [BLOCK_IP_PATH]: async (req) => handleBlockIp(req ?? callCtx.req ?? {}, callCtx),
    [UNBLOCK_IP_PATH]: async (req) => handleUnblockIp(req ?? callCtx.req ?? {}, callCtx),
    [BLOCK_DOMAIN_PATH]: async (req) => handleBlockDomain(req ?? callCtx.req ?? {}, callCtx),
    [UNBLOCK_DOMAIN_PATH]: async (req) => handleUnblockDomain(req ?? callCtx.req ?? {}, callCtx),
  };
}

const isSdkContext = (value) => Boolean(
  value &&
  typeof value === 'object' &&
  (
    hasOwn(value, 'req') ||
    hasOwn(value, 'request') ||
    hasOwn(value, 'bindings') ||
    hasOwn(value, 'config') ||
    hasOwn(value, 'secret') ||
    hasOwn(value, 'meta') ||
    hasOwn(value, 'limits')
  )
);

const makeHandler = (fn) => (reqOrCtx, maybeCtx) => {
  if (maybeCtx === undefined && isSdkContext(reqOrCtx)) {
    return fn(reqOrCtx.req ?? reqOrCtx.request ?? {}, reqOrCtx);
  }
  return fn(reqOrCtx ?? {}, maybeCtx ?? {});
};

export const handlers = {
  [METHOD_BLOCK_IP_FULL]: makeHandler(handleBlockIp),
  [METHOD_UNBLOCK_IP_FULL]: makeHandler(handleUnblockIp),
  [METHOD_BLOCK_DOMAIN_FULL]: makeHandler(handleBlockDomain),
  [METHOD_UNBLOCK_DOMAIN_FULL]: makeHandler(handleUnblockDomain),
};

export const _test = {
  buildBlockBody,
  buildHeaders,
  buildSignedHeaders,
  shouldSkipTlsVerify,
  buildUnblockBody,
  buildUrl,
  createSignature,
  errorWithCode,
  extractHeaders,
  fetchHttp,
  isIPv4,
  isIPv6,
  normalizeBaseUrl,
  normalizeResponse,
  normalizeString,
  optionalBoolean,
  optionalString,
  optionalUint32,
  parseJsonObject,
  parseStringList,
  requireString,
  resolveApiPath,
  resolveAppId,
  resolveCallContext,
  resolveHost,
  resolveSecretKey,
  resolveTimeoutMs,
  toBoolean,
  toBodyJson,
  toStruct,
  toValue,
  validateBlockTiming,
  validateDomains,
  validateIps,
  buildTlsOptions,
  shouldSkipTlsVerify,
  isSdkContext,
  makeHandler,
};
