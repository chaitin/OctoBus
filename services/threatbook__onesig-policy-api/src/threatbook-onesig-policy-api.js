import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_TIMESTAMP_PRECISION = 'seconds';

const METHOD_PREFIX = 'threatbook.onesig.policy.v1.OneSigPolicyService';

const operationMap = {
  ListAssetGroups: ['GET', '/api/v3/asset/group'],
  ListAssets: ['POST', '/api/v3/asset/list'],
  ListGlobalWhitelist: ['POST', '/api/v3/globalWhitelist/list'],
  ListGlobalBlacklist: ['POST', '/api/v3/globalBlacklist/list'],
  CreateGlobalBlacklist: ['POST', '/api/v3/globalBlacklist/create'],
  ListHttpBlacklist: ['POST', '/api/v3/httpBlacklist/list'],
  CreateHttpBlacklist: ['POST', '/api/v3/httpBlacklist/create'],
};

const queryAsPayloadOperations = new Set([
  'ListGlobalWhitelist',
  'ListGlobalBlacklist',
  'ListHttpBlacklist',
]);

const signedQueryKeys = new Set(['apikey', 'timestamp', 'sign']);

const error = (status, message) => new GrpcError(status, message);
const invalid = (message) => error(grpcStatus.INVALID_ARGUMENT, message);
const denied = (message) => error(grpcStatus.PERMISSION_DENIED, message);
const unavailable = (message) => error(grpcStatus.UNAVAILABLE, message);
const failed = (message) => error(grpcStatus.FAILED_PRECONDITION, message);
const unknown = (message) => error(grpcStatus.UNKNOWN, message);

const first = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');
const text = (value) => value === undefined || value === null ? '' : String(value).trim();

const bindingsOf = (ctx = {}) => ({ ...(ctx.config ?? {}), ...(ctx.secret ?? {}), ...(ctx.bindings ?? {}) });
const requestOf = (ctx = {}) => ctx.request ?? ctx.req ?? {};

const normalizeBaseUrl = (bindings) => {
  const raw = text(first(bindings.baseUrl, bindings.base_url, bindings.host));
  if (!raw) throw invalid('baseUrl is required');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw invalid('baseUrl must be a valid URL');
  }
  const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(parsed.hostname);
  if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && (bindings.allowInsecureHttp === true || isLoopback))) {
    return raw.replace(/\/+$/, '');
  }
  throw invalid('baseUrl must be https:// unless allowInsecureHttp is true (loopback URLs are allowed for local testing)');
};

const credentialsOf = (bindings) => {
  const apiKey = text(first(bindings.apiKey, bindings.api_key, bindings.apikey));
  const secret = text(first(bindings.secret, bindings.Secret));
  if (!apiKey) throw invalid('apiKey is required');
  if (!secret) throw invalid('secret is required');
  return { apiKey, secret };
};

const timestampOf = (bindings) => {
  const precision = text(first(bindings.timestampPrecision, bindings.timestamp_precision, DEFAULT_TIMESTAMP_PRECISION));
  if (precision === 'milliseconds') return String(Date.now());
  if (precision === 'seconds') return String(Math.floor(Date.now() / 1000));
  throw invalid('timestampPrecision must be seconds or milliseconds');
};

const signOf = ({ apiKey, secret, timestamp }) => {
  return crypto.createHmac('sha1', secret).update(`${apiKey}${timestamp}`).digest('base64');
};

const parsePayload = (source) => {
  const raw = text(source);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    throw invalid('payloadJson must be a JSON object string');
  }
  throw invalid('payloadJson must be a JSON object string');
};

const validateQuery = (query) => {
  if (query === undefined || query === null) return {};
  if (typeof query !== 'object' || Array.isArray(query)) throw invalid('query must be an object');
  for (const key of Object.keys(query)) {
    if (signedQueryKeys.has(key.toLowerCase())) {
      throw invalid(`query must not override signed parameter ${key}`);
    }
  }
  return query;
};

const timeoutMsOf = (bindings) => {
  const value = Number(first(bindings.timeoutMs, DEFAULT_TIMEOUT_MS));
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : DEFAULT_TIMEOUT_MS;
};

const signedUrl = ({ bindings, path, query = {} }) => {
  const { apiKey, secret } = credentialsOf(bindings);
  const timestamp = timestampOf(bindings);
  const sign = signOf({ apiKey, secret, timestamp });
  const url = new URL(path, normalizeBaseUrl(bindings));
  url.searchParams.set('apikey', apiKey);
  url.searchParams.set('timestamp', timestamp);
  url.searchParams.set('sign', sign);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url;
};

const readResponse = async (res) => {
  let body;
  try {
    body = await res.text();
  } catch {
    throw unavailable('upstream response read failed');
  }
  if (!body.trim()) throw unknown('response body is empty');
  let json = null;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {
    throw unknown('response is not valid JSON');
  }
  return { body, json };
};

const callOneSig = async ({ bindings, method, path, query, payload }) => {
  const url = signedUrl({ bindings, path, query });
  const headers = {
    ...(bindings.headers && typeof bindings.headers === 'object' ? bindings.headers : {}),
  };
  const init = {
    method,
    headers,
    signal: AbortSignal.timeout(timeoutMsOf(bindings)),
    redirect: 'error',
  };
  if (!['GET', 'DELETE'].includes(method)) {
    init.body = JSON.stringify(payload ?? {});
    init.headers['content-type'] = 'application/json';
  }

  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      throw unavailable('upstream request timed out');
    }
    throw unavailable('upstream request failed');
  }

  const { body, json } = await readResponse(res);
  if (res.status === 401 || res.status === 403) throw denied(body || `upstream http ${res.status}`);
  if (res.status >= 500) throw unavailable(body || `upstream http ${res.status}`);
  if (res.status >= 400) throw failed(body || `upstream http ${res.status}`);

  const responseCode = Number(json?.responseCode ?? json?.code ?? 0);
  const message = text(first(json?.verboseMsg, json?.message, json?.msg, res.statusText));
  if (responseCode !== 0) throw failed(message || `responseCode ${responseCode}`);
  return { status: res.status, message, body };
};

const callMapped = (name, ctx) => {
  const [method, path] = operationMap[name];
  const request = requestOf(ctx);
  const query = validateQuery(request.query);
  const payload = parsePayload(first(request.payload_json, request.payloadJson));
  return callOneSig({
    bindings: bindingsOf(ctx),
    method,
    path,
    query,
    payload: queryAsPayloadOperations.has(name) && Object.keys(payload).length === 0 ? query : payload,
  });
};

export const handlers = Object.fromEntries([
  ...Object.keys(operationMap).map((name) => [`${METHOD_PREFIX}/${name}`, (ctx) => callMapped(name, ctx)]),
]);

export const _test = {
  signOf,
  signedUrl,
  parsePayload,
  validateQuery,
  operationMap,
};
