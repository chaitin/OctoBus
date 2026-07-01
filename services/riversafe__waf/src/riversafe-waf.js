import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const METHOD_SYNC_PATH = '/RiverSafeplusd_WAF.RiverSafeplusd_WAF/SyncIPBlacklist';
export const METHOD_SYNC_FULL = 'RiverSafeplusd_WAF.RiverSafeplusd_WAF/SyncIPBlacklist';

export const DEFAULT_TIMEOUT_MS = 2000;
export const TRANSPORT_SUCCESS_CODES = new Set([200, 201, 204, 209, 210]);

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message, details) => {
  let finalMessage = message;
  if (details !== undefined) {
    try {
      finalMessage = JSON.stringify({ message, ...details });
    } catch {
      finalMessage = `${message}`;
    }
  }
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${finalMessage}`);
  err.legacyCode = code;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return String(value);
};

const normalizeBaseUrl = (value) => {
  const base = unwrapScalar(value).trim();
  if (!/^https:\/\//i.test(base)) return null;
  return base.replace(/\/+$/, '');
};

const extractList = (rawList) => {
  if (!rawList) return [];
  if (Array.isArray(rawList)) return rawList;
  if (typeof rawList === 'object' && Array.isArray(rawList.values)) return rawList.values;
  return [];
};

const toUTF8Bytes = (input) => Array.from(Buffer.from(String(input ?? ''), 'utf8'));

const bytesToHex = (bytes) => Buffer.from(bytes).toString('hex');

const md5Hex = (messageBytes) => crypto.createHash('md5').update(Buffer.from(messageBytes)).digest('hex');

const sha256Bytes = (messageBytes) => Array.from(crypto.createHash('sha256').update(Buffer.from(messageBytes)).digest());

const hmacSha256Hex = (keyBytes, messageBytes) =>
  crypto.createHmac('sha256', Buffer.from(keyBytes)).update(Buffer.from(messageBytes)).digest('hex');

const isIPv4 = (value) => {
  const text = String(value);
  const parts = text.split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return false;
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) return false;
  }
  return true;
};

const isIPv6 = (value) => {
  const text = String(value);
  if (!text.includes(':')) return false;
  if ((text.match(/::/g) || []).length > 1) return false;
  if (/^::ffff:\d{1,3}(?:\.\d{1,3}){3}$/i.test(text)) return isIPv4(text.substring(text.lastIndexOf(':') + 1));
  return /^[0-9a-fA-F:.]+$/.test(text);
};

const normalizeHostCIDR = (input) => {
  const raw = unwrapScalar(input).trim();
  if (!raw) throw errorWithCode('INVALID_ARGUMENT', 'item must be a non-empty string');

  const slashIndex = raw.indexOf('/');
  if (slashIndex >= 0) {
    const ipPart = raw.slice(0, slashIndex).trim();
    const prefixPart = raw.slice(slashIndex + 1).trim();
    if (!ipPart || !prefixPart) throw errorWithCode('INVALID_ARGUMENT', `invalid cidr: ${raw}`);
    const prefix = Number(prefixPart);
    if (!Number.isInteger(prefix)) throw errorWithCode('INVALID_ARGUMENT', `invalid cidr prefix: ${raw}`);
    if (isIPv4(ipPart)) {
      if (prefix < 0 || prefix > 32) throw errorWithCode('INVALID_ARGUMENT', `invalid ipv4 cidr prefix: ${raw}`);
      return `${ipPart}/${prefix}`;
    }
    if (isIPv6(ipPart)) {
      if (prefix < 0 || prefix > 128) throw errorWithCode('INVALID_ARGUMENT', `invalid ipv6 cidr prefix: ${raw}`);
      return `${ipPart}/${prefix}`;
    }
    throw errorWithCode('INVALID_ARGUMENT', `ip must be a valid IPv4 or IPv6 address: ${raw}`);
  }

  if (isIPv4(raw)) return `${raw}/32`;
  if (isIPv6(raw)) return `${raw}/128`;
  throw errorWithCode('INVALID_ARGUMENT', `ip must be a valid IPv4 or IPv6 address: ${raw}`);
};

const generateUUIDv4 = () => crypto.randomUUID();

const buildHeaders = (bindings = {}, meta = {}) => {
  const extra = bindings && typeof bindings.headers === 'object' && bindings.headers ? bindings.headers : {};
  return {
    ...extra,
    'Content-Type': 'application/json',
    'x-engine-instance': meta.instance_id || meta.instanceId || 'unknown',
    'x-request-id': meta.request_id || meta.requestId || 'unknown',
  };
};

const parseHttpsUrl = (rawUrl) => {
  const input = unwrapScalar(rawUrl).trim();
  if (!/^https:\/\//i.test(input)) return null;
  const withoutScheme = input.slice('https://'.length);
  if (!withoutScheme) return null;

  const slashIndex = withoutScheme.indexOf('/');
  const queryIndex = withoutScheme.indexOf('?');
  let authority;
  let pathAndQuery;
  if (slashIndex === -1) {
    authority = queryIndex === -1 ? withoutScheme : withoutScheme.slice(0, queryIndex);
    pathAndQuery = queryIndex === -1 ? '' : withoutScheme.slice(queryIndex);
  } else {
    authority = withoutScheme.slice(0, slashIndex);
    pathAndQuery = withoutScheme.slice(slashIndex);
  }
  authority = String(authority || '').trim();
  if (!authority) return null;

  let path = '';
  let rawQuery = '';
  if (pathAndQuery) {
    const qi = pathAndQuery.indexOf('?');
    if (qi === -1) path = pathAndQuery;
    else {
      path = pathAndQuery.slice(0, qi);
      rawQuery = pathAndQuery.slice(qi + 1);
    }
  }
  if (path === '/') path = '';
  return { origin: `https://${authority}`, basePath: path || '', rawQuery: rawQuery || '' };
};

const safeDecodeURIComponent = (text) => {
  try {
    return decodeURIComponent(String(text ?? ''));
  } catch {
    return String(text ?? '');
  }
};

const parseQueryPairs = (rawQuery) => {
  const query = String(rawQuery ?? '');
  if (!query.trim()) return [];
  const out = [];
  for (const part of query.split('&')) {
    if (part === '') continue;
    const eqIndex = part.indexOf('=');
    if (eqIndex === -1) {
      out.push({ rawKey: part, rawValue: '' });
      continue;
    }
    out.push({ rawKey: part.slice(0, eqIndex), rawValue: part.slice(eqIndex + 1) });
  }
  return out;
};

const buildCanonicalQueryString = (rawPairs) => {
  const pairs = [];
  for (const pair of rawPairs || []) {
    const key = String(pair?.rawKey ?? '');
    if (key === 'timestamp' || key === 'nonce' || key === 'tokenid' || key === 'signature') continue;
    const value = String(pair?.rawValue ?? '');
    pairs.push([safeDecodeURIComponent(key), safeDecodeURIComponent(value)]);
  }
  pairs.sort((a, b) => {
    const keyCompare = a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    if (keyCompare !== 0) return keyCompare;
    return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
  });
  return pairs.map(([key, value]) => `${encodeURI(key)}=${encodeURI(value)}`).join('&');
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

const resolveTimeoutMs = (ctx = {}) => {
  const value = Number(firstDefined(ctx.bindings?.timeoutMs, ctx.limits?.timeoutMs, DEFAULT_TIMEOUT_MS));
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
};

let insecureTlsDispatcher;

const getInsecureTlsDispatcher = () => {
  insecureTlsDispatcher ??= new Agent({ connect: { rejectUnauthorized: false } });
  return insecureTlsDispatcher;
};

const buildLogPrefix = (meta = {}, action) => {
  const trace = [];
  if (meta.instance_id || meta.instanceId) trace.push(`inst=${meta.instance_id || meta.instanceId}`);
  if (meta.request_id || meta.requestId) trace.push(`req=${meta.request_id || meta.requestId}`);
  return `[RiverSafeplusd_WAF][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
};

const logFlow = (meta, action, details) => {
  const prefix = buildLogPrefix(meta, action);
  try {
    console.log(prefix, JSON.stringify(details));
  } catch {
    console.log(prefix, details);
  }
};

const syncIPBlacklist = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req, request: req });
  const bindings = callCtx.bindings || {};
  const meta = callCtx.meta || {};

  const hostRaw = unwrapScalar(firstDefined(bindings.host)).trim();
  const tokenId = unwrapScalar(firstDefined(bindings.token_id, bindings.tokenId)).trim();
  const token = unwrapScalar(firstDefined(bindings.token)).trim();
  const baseUrl = normalizeBaseUrl(hostRaw);
  if (!baseUrl) throw errorWithCode('FAILED_PRECONDITION', 'binding "host" must be a https URL');
  if (!tokenId) throw errorWithCode('FAILED_PRECONDITION', 'binding "token_id" is required but not configured');
  if (!token) throw errorWithCode('FAILED_PRECONDITION', 'binding "token" is required but not configured');

  const items = extractList(firstDefined(req.items, req.Items)).map((value) => unwrapScalar(value));
  if (items.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'items is required and must not be empty');
  const normalizedItems = items.map(normalizeHostCIDR);

  const parsedBase = parseHttpsUrl(baseUrl);
  if (!parsedBase) throw errorWithCode('FAILED_PRECONDITION', 'binding "host" must be a https URL');
  const basePath = String(parsedBase.basePath || '').replace(/\/$/, '');
  const requestPath = `${basePath}/api/v1/ip_black_list`;
  const canonicalURI = encodeURI(requestPath);
  const rawPairs = parseQueryPairs(parsedBase.rawQuery);
  const canonicalQueryString = buildCanonicalQueryString(rawPairs);

  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = generateUUIDv4();
  const body = JSON.stringify({ items: normalizedItems });
  const bodyMd5 = md5Hex(toUTF8Bytes(body));
  const canonicalRequest = `${token}\nPOST\n${canonicalURI}\n${canonicalQueryString}\n${timestamp}\n${nonce}\n${tokenId}\n${bodyMd5}`;
  const signature = hmacSha256Hex(toUTF8Bytes(token), toUTF8Bytes(canonicalRequest));
  const signingQuery = `timestamp=${timestamp}&nonce=${encodeURIComponent(nonce)}&tokenid=${encodeURIComponent(tokenId)}&signature=${signature}`;
  const finalQuery = parsedBase.rawQuery ? `${parsedBase.rawQuery}&${signingQuery}` : signingQuery;
  const requestUrl = `${parsedBase.origin}${requestPath}?${finalQuery}`;

  const skipTlsVerify = Boolean(bindings.tlsInsecureSkipVerify || bindings.skipTlsVerify || bindings.insecureSkipVerify);
  const init = {
    method: 'POST',
    headers: buildHeaders(bindings, meta),
    body,
    signal: AbortSignal.timeout(resolveTimeoutMs(callCtx)),
    ...(skipTlsVerify ? { dispatcher: getInsecureTlsDispatcher() } : {}),
  };

  logFlow(meta, 'SyncIPBlacklist:start', { host: baseUrl, item_count: normalizedItems.length });

  let res;
  try {
    res = await fetch(requestUrl, init);
  } catch (err) {
    const reason = err?.cause?.message || err?.message || 'fetch failed';
    logFlow(meta, 'SyncIPBlacklist:fetch_error', { reason });
    throw errorWithCode('UNAVAILABLE', `upstream error: ${reason}`);
  }

  const text = await res.text();
  if (!TRANSPORT_SUCCESS_CODES.has(res.status)) {
    const summary = `upstream http ${res.status}; body_length=${text.length}`;
    logFlow(meta, 'SyncIPBlacklist:transport_error', { http_status: res.status, body_length: text.length });
    if (res.status === 401 || res.status === 403) throw errorWithCode('PERMISSION_DENIED', summary);
    if (res.status >= 400 && res.status < 500) throw errorWithCode('FAILED_PRECONDITION', summary);
    throw errorWithCode('UNAVAILABLE', summary);
  }

  if (!String(text || '').trim()) {
    logFlow(meta, 'SyncIPBlacklist:protocol_error', { http_status: res.status, reason: 'empty response body' });
    throw errorWithCode('UNKNOWN', 'empty response body');
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    const excerpt = text.length > 256 ? `${text.slice(0, 256)}...` : text;
    logFlow(meta, 'SyncIPBlacklist:protocol_error', { http_status: res.status, reason: 'invalid json', response: excerpt });
    throw errorWithCode('UNKNOWN', 'response is not valid JSON');
  }

  const errNoRaw = firstDefined(json?.err_no, json?.errNo);
  const errNo = Number(errNoRaw);
  if (!Number.isFinite(errNo)) {
    logFlow(meta, 'SyncIPBlacklist:protocol_error', { http_status: res.status, reason: 'missing err_no', response: json });
    throw errorWithCode('UNKNOWN', 'missing err_no in response');
  }
  const errMsg = unwrapScalar(firstDefined(json?.err_msg, json?.errMsg, json?.message, ''));
  if (errNo !== 0) {
    logFlow(meta, 'SyncIPBlacklist:business_error', { http_status: res.status, err_no: errNo, err_msg: errMsg });
    throw errorWithCode('FAILED_PRECONDITION', `upstream err_no=${errNo} err_msg=${errMsg}`);
  }

  logFlow(meta, 'SyncIPBlacklist:done', { http_status: res.status, item_count: normalizedItems.length });
  return { http_status: res.status, err_no: errNo, err_msg: errMsg };
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_SYNC_PATH]: async (req) => syncIPBlacklist(req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_SYNC_FULL]: (ctx = {}) => syncIPBlacklist(requestFromContext(ctx), ctx),
};

export const _test = {
  buildCanonicalQueryString,
  buildHeaders,
  buildLogPrefix,
  bytesToHex,
  errorWithCode,
  extractList,
  firstDefined,
  generateUUIDv4,
  hasOwn,
  hmacSha256Hex,
  isIPv4,
  isIPv6,
  logFlow,
  md5Hex,
  normalizeBaseUrl,
  normalizeHostCIDR,
  parseHttpsUrl,
  parseQueryPairs,
  resolveCallContext,
  resolveTimeoutMs,
  safeDecodeURIComponent,
  sha256Bytes,
  syncIPBlacklist,
  toUTF8Bytes,
  unwrapScalar,
};
