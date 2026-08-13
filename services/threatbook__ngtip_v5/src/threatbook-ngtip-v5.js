import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const METHOD_QUERY_IP_REPUTATION_PATH = '/ThreatBook_NGTIP_V5.ThreatBook_NGTIP_V5/QueryIPReputation';
export const METHOD_QUERY_IP_REPUTATION_FULL = 'ThreatBook_NGTIP_V5.ThreatBook_NGTIP_V5/QueryIPReputation';
export const METHOD_QUERY_DNS_COMPROMISED_PATH = '/ThreatBook_NGTIP_V5.ThreatBook_NGTIP_V5/QueryDNSCompromised';
export const METHOD_QUERY_DNS_COMPROMISED_FULL = 'ThreatBook_NGTIP_V5.ThreatBook_NGTIP_V5/QueryDNSCompromised';
export const METHOD_QUERY_FILE_REPUTATION_PATH = '/ThreatBook_NGTIP_V5.ThreatBook_NGTIP_V5/QueryFileReputation';
export const METHOD_QUERY_FILE_REPUTATION_FULL = 'ThreatBook_NGTIP_V5.ThreatBook_NGTIP_V5/QueryFileReputation';
export const METHOD_QUERY_VULNERABILITY_PATH = '/ThreatBook_NGTIP_V5.ThreatBook_NGTIP_V5/QueryVulnerability';
export const METHOD_QUERY_VULNERABILITY_FULL = 'ThreatBook_NGTIP_V5.ThreatBook_NGTIP_V5/QueryVulnerability';
export const METHOD_QUERY_IP_LOCATION_PATH = '/ThreatBook_NGTIP_V5.ThreatBook_NGTIP_V5/QueryIPLocation';
export const METHOD_QUERY_IP_LOCATION_FULL = 'ThreatBook_NGTIP_V5.ThreatBook_NGTIP_V5/QueryIPLocation';

export const DEFAULT_TIMEOUT_MS = 5000;

export const QUERY_IP_HTTP_PATH = '/tip_api/v5/ip';
export const QUERY_DNS_HTTP_PATH = '/tip_api/v5/dns';
export const QUERY_HASH_HTTP_PATH = '/tip_api/v5/hash';
export const QUERY_VULN_HTTP_PATH = '/tip_api/v5/vuln';
export const QUERY_LOCATION_HTTP_PATH = '/tip_api/v5/location';

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

const redactSensitive = (value, sensitiveValues = []) => {
  let out = String(value ?? '');
  for (const sensitive of sensitiveValues || []) {
    const raw = toTrimmedString(sensitive);
    if (!raw) continue;
    out = out.split(raw).join('<redacted>');
  }
  return out;
};

const normalizeBaseUrl = (value) => {
  const raw = toTrimmedString(value);
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.replace(/\/+$/, '');
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
  req: ctx.req ?? ctx.request ?? {},
});

const resolveDomain = (bindings = {}) => normalizeBaseUrl(firstDefined(
  bindings.ngtip_domain,
  bindings.threatbook_domain,
  bindings.domain,
  bindings.restBaseUrl,
  bindings.baseUrl,
));

const resolveApiKey = (bindings = {}) => toTrimmedString(firstDefined(
  bindings.ngtip_apikey,
  bindings.threatbook_apikey,
  bindings.apikey,
  bindings.apiKey,
));

const resolveAuthMode = (bindings = {}) => {
  const mode = toTrimmedString(firstDefined(bindings.auth_mode, bindings.authMode));
  return mode === 'token' ? 'token' : 'apikey';
};

const resolveSalt = (bindings = {}) => toTrimmedString(firstDefined(bindings.salt));

const resolveTimeoutMs = (ctx = {}) => {
  const raw = Number(firstDefined(ctx.limits?.timeoutMs, ctx.bindings?.timeoutMs, DEFAULT_TIMEOUT_MS));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

const insecureTlsDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

const buildTlsOptions = (bindings = {}) => {
  const enabled = Boolean(bindings.skipTlsVerify || bindings.tlsInsecureSkipVerify || bindings.insecureSkipVerify);
  if (!enabled) return {};
  return { dispatcher: insecureTlsDispatcher };
};

const makeTimeoutSignal = (timeoutMs) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeoutId) };
};

const requireDomain = (ctx = {}) => {
  const domain = resolveDomain(ctx.bindings || {});
  if (!domain) throw errorWithCode('INVALID_ARGUMENT', 'ngtip_domain is required in bindings');
  return domain;
};

const requireApiKey = (ctx = {}) => {
  const apiKey = resolveApiKey(ctx.bindings || {});
  if (!apiKey) throw errorWithCode('INVALID_ARGUMENT', 'ngtip_apikey is required in bindings');
  return apiKey;
};

const requireResource = (req = {}, fieldName = 'resource') => {
  const resource = toTrimmedString(firstDefined(req[fieldName], req.resource));
  if (!resource) throw errorWithCode('INVALID_ARGUMENT', `${fieldName} is required`);
  return resource;
};

const base64UrlEncodeBytes = (bytes) => {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const computeToken = async (apikey, timestamp, salt) => {
  const message = `${apikey}${timestamp}`;
  const keyBytes = new TextEncoder().encode(salt);
  const msgBytes = new TextEncoder().encode(message);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, msgBytes);
  return base64UrlEncodeBytes(new Uint8Array(sig));
};

const buildAuthQuery = async (apiKey, bindings = {}) => {
  const mode = resolveAuthMode(bindings);
  const base = { apikey: apiKey };
  if (mode === 'token') {
    const salt = resolveSalt(bindings);
    if (!salt) throw errorWithCode('INVALID_ARGUMENT', 'salt is required when auth_mode is token');
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const token = await computeToken(apiKey, timestamp, salt);
    base.timestamp = timestamp;
    base.token = token;
  }
  return base;
};

const buildLogPrefix = (ctx = {}, action) => {
  const meta = ctx.meta || {};
  const trace = [];
  if (meta.instance_id || meta.instanceId) trace.push(`inst=${meta.instance_id || meta.instanceId}`);
  if (meta.request_id || meta.requestId) trace.push(`req=${meta.request_id || meta.requestId}`);
  return `[ThreatBook_NGTIP_V5][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
};

const logFlow = (ctx, action, details) => {
  const prefix = buildLogPrefix(ctx, action);
  try {
    console.log(prefix, JSON.stringify(details));
  } catch {
    console.log(prefix, details);
  }
};

const encodeQueryPairs = (query = {}) => {
  const parts = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    const strVal = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(strVal)}`);
  }
  return parts.join('&');
};

const buildQueryUrl = (domain, path, query) => `${domain}${path}?${encodeQueryPairs(query)}`;

const redactUrlForLog = (url, bindings = {}) => {
  const sensitiveValues = [resolveApiKey(bindings), resolveSalt(bindings)];
  try {
    const parsed = new URL(String(url));
    for (const key of ['apikey', 'apiKey', 'token', 'salt']) {
      if (parsed.searchParams.has(key)) parsed.searchParams.set(key, '<redacted>');
    }
    return redactSensitive(parsed.toString(), sensitiveValues);
  } catch {
    return redactSensitive(url, sensitiveValues);
  }
};

const attachResponse = (err, response) => {
  err.response = response;
  return err;
};

const fetchWithStatus = async (url, ctx = {}) => {
  const bindings = ctx.bindings || {};
  const timeoutMs = resolveTimeoutMs(ctx);
  const timeout = makeTimeoutSignal(timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      signal: timeout.signal,
      ...buildTlsOptions(bindings),
    });
  } catch (err) {
    const errMsg = err?.cause?.message || err?.message || 'fetch failed';
    logFlow(ctx, 'fetch:error', { url: redactUrlForLog(url, bindings), error: redactSensitive(errMsg, [resolveApiKey(bindings), resolveSalt(bindings)]) });
    return { httpStatus: 0, httpBody: errMsg };
  } finally {
    timeout.clear();
  }
  let httpBody;
  try {
    httpBody = await res.text();
  } catch (err) {
    const errMsg = err?.message || 'response read failed';
    logFlow(ctx, 'fetch:read-error', { url: redactUrlForLog(url, bindings), httpStatus: res.status, error: redactSensitive(errMsg, [resolveApiKey(bindings), resolveSalt(bindings)]) });
    return { httpStatus: 0, httpBody: errMsg };
  }
  const httpStatus = Number(res.status || 0);
  logFlow(ctx, 'fetch:response', { url: redactUrlForLog(url, bindings), httpStatus, bodyLength: httpBody?.length || 0 });
  return { httpStatus, httpBody: String(httpBody ?? '') };
};

const mapHttpStatusToCode = (httpStatus) => {
  if (httpStatus === 401 || httpStatus === 403) return 'PERMISSION_DENIED';
  if (httpStatus >= 400 && httpStatus < 500) return 'FAILED_PRECONDITION';
  return 'UNAVAILABLE';
};

const parseNgTipResponse = (httpBody) => {
  try {
    const parsed = JSON.parse(httpBody);
    return {
      responseCode: Number(parsed.response_code ?? 0),
      verboseMsg: String(parsed.verbose_msg ?? ''),
      data: parsed.data !== undefined ? JSON.stringify(parsed.data) : '',
    };
  } catch {
    return { responseCode: 0, verboseMsg: '', data: '' };
  }
};

const handleHttpResponse = (httpStatus, httpBody, ctx, action) => {
  if (httpStatus >= 200 && httpStatus < 300) {
    const parsed = parseNgTipResponse(httpBody);
    return { response_code: parsed.responseCode, verbose_msg: parsed.verboseMsg, data: parsed.data };
  }
  const code = mapHttpStatusToCode(httpStatus);
  throw attachResponse(errorWithCode(code, `upstream http ${httpStatus}`), {
    response_code: 0,
    verbose_msg: `upstream http ${httpStatus}`,
    data: '',
    http_body_length: String(httpBody ?? '').length,
  });
};

const handleQueryIPReputation = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const domain = requireDomain(callCtx);
  const apiKey = requireApiKey(callCtx);
  const resource = requireResource(req);
  const lang = toTrimmedString(req.lang) || undefined;
  const host = toTrimmedString(req.host) || undefined;
  const location = req.location;

  const authQuery = await buildAuthQuery(apiKey, callCtx.bindings);
  const query = { ...authQuery, resource };
  if (lang) query.lang = lang;
  if (host) query.host = host;
  if (location !== undefined && location !== null) query.location = Boolean(location);

  const url = buildQueryUrl(domain, QUERY_IP_HTTP_PATH, query);
  logFlow(callCtx, 'QueryIPReputation', { path: QUERY_IP_HTTP_PATH, resource });
  const { httpStatus, httpBody } = await fetchWithStatus(url, callCtx);
  return handleHttpResponse(httpStatus, httpBody, callCtx, 'QueryIPReputation');
};

const handleQueryDNSCompromised = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const domain = requireDomain(callCtx);
  const apiKey = requireApiKey(callCtx);
  const resource = requireResource(req);
  const lang = toTrimmedString(req.lang) || undefined;
  const host = toTrimmedString(req.host) || undefined;

  const authQuery = await buildAuthQuery(apiKey, callCtx.bindings);
  const query = { ...authQuery, resource };
  if (lang) query.lang = lang;
  if (host) query.host = host;

  const url = buildQueryUrl(domain, QUERY_DNS_HTTP_PATH, query);
  logFlow(callCtx, 'QueryDNSCompromised', { path: QUERY_DNS_HTTP_PATH, resource });
  const { httpStatus, httpBody } = await fetchWithStatus(url, callCtx);
  return handleHttpResponse(httpStatus, httpBody, callCtx, 'QueryDNSCompromised');
};

const handleQueryFileReputation = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const domain = requireDomain(callCtx);
  const apiKey = requireApiKey(callCtx);
  const resource = requireResource(req);

  const authQuery = await buildAuthQuery(apiKey, callCtx.bindings);
  const query = { ...authQuery, resource };

  const url = buildQueryUrl(domain, QUERY_HASH_HTTP_PATH, query);
  logFlow(callCtx, 'QueryFileReputation', { path: QUERY_HASH_HTTP_PATH, resource });
  const { httpStatus, httpBody } = await fetchWithStatus(url, callCtx);
  return handleHttpResponse(httpStatus, httpBody, callCtx, 'QueryFileReputation');
};

const handleQueryVulnerability = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const domain = requireDomain(callCtx);
  const apiKey = requireApiKey(callCtx);

  const authQuery = await buildAuthQuery(apiKey, callCtx.bindings);
  const query = { ...authQuery };

  if (req.vuln_id) query.vuln_id = toTrimmedString(req.vuln_id);
  if (req.vendor) query.vendor = toTrimmedString(req.vendor);
  if (req.product) query.product = toTrimmedString(req.product);
  if (req.component_package_manager) query.component_package_manager = toTrimmedString(req.component_package_manager);
  if (req.component_name) query.component_name = toTrimmedString(req.component_name);
  if (req.version) query.version = toTrimmedString(req.version);
  if (req.update_time) query.update_time = toTrimmedString(req.update_time);
  if (req.threatbook_create_time) query.threatbook_create_time = toTrimmedString(req.threatbook_create_time);
  if (req.is_highrisk !== undefined && req.is_highrisk !== null) query.is_highrisk = Boolean(req.is_highrisk);
  if (req.limit !== undefined && req.limit !== null) query.limit = Number(req.limit);
  if (req.cursor) query.cursor = toTrimmedString(req.cursor);

  const url = buildQueryUrl(domain, QUERY_VULN_HTTP_PATH, query);
  logFlow(callCtx, 'QueryVulnerability', { path: QUERY_VULN_HTTP_PATH });
  const { httpStatus, httpBody } = await fetchWithStatus(url, callCtx);
  return handleHttpResponse(httpStatus, httpBody, callCtx, 'QueryVulnerability');
};

const handleQueryIPLocation = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const domain = requireDomain(callCtx);
  const apiKey = requireApiKey(callCtx);
  const resource = requireResource(req);

  const authQuery = await buildAuthQuery(apiKey, callCtx.bindings);
  const query = { ...authQuery, resource };

  const url = buildQueryUrl(domain, QUERY_LOCATION_HTTP_PATH, query);
  logFlow(callCtx, 'QueryIPLocation', { path: QUERY_LOCATION_HTTP_PATH, resource });
  const { httpStatus, httpBody } = await fetchWithStatus(url, callCtx);
  return handleHttpResponse(httpStatus, httpBody, callCtx, 'QueryIPLocation');
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_QUERY_IP_REPUTATION_PATH]: async (req) => handleQueryIPReputation(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_QUERY_DNS_COMPROMISED_PATH]: async (req) => handleQueryDNSCompromised(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_QUERY_FILE_REPUTATION_PATH]: async (req) => handleQueryFileReputation(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_QUERY_VULNERABILITY_PATH]: async (req) => handleQueryVulnerability(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_QUERY_IP_LOCATION_PATH]: async (req) => handleQueryIPLocation(req ?? callCtx.req ?? {}, callCtx),
  };
}

const adaptHandler = (fn) => (reqOrSdkArg, ctx) => {
  if (ctx !== undefined) return fn(reqOrSdkArg, ctx);
  if (reqOrSdkArg && typeof reqOrSdkArg === 'object' && 'request' in reqOrSdkArg) {
    const { request: req, ...rest } = reqOrSdkArg;
    return fn(req ?? {}, rest);
  }
  if (reqOrSdkArg && typeof reqOrSdkArg === 'object' && (
    'req' in reqOrSdkArg || 'config' in reqOrSdkArg || 'secret' in reqOrSdkArg || 'bindings' in reqOrSdkArg
  )) {
    return fn(reqOrSdkArg.req ?? {}, reqOrSdkArg);
  }
  return fn(reqOrSdkArg, {});
};

export const handlers = {
  [METHOD_QUERY_IP_REPUTATION_FULL]: adaptHandler(handleQueryIPReputation),
  [METHOD_QUERY_DNS_COMPROMISED_FULL]: adaptHandler(handleQueryDNSCompromised),
  [METHOD_QUERY_FILE_REPUTATION_FULL]: adaptHandler(handleQueryFileReputation),
  [METHOD_QUERY_VULNERABILITY_FULL]: adaptHandler(handleQueryVulnerability),
  [METHOD_QUERY_IP_LOCATION_FULL]: adaptHandler(handleQueryIPLocation),
};

export const _test = {
  attachResponse,
  base64UrlEncodeBytes,
  buildAuthQuery,
  buildLogPrefix,
  buildQueryUrl,
  buildTlsOptions,
  computeToken,
  encodeQueryPairs,
  errorWithCode,
  fetchWithStatus,
  firstDefined,
  grpcCodeFor,
  handleHttpResponse,
  handleQueryDNSCompromised,
  handleQueryFileReputation,
  handleQueryIPLocation,
  handleQueryIPReputation,
  handleQueryVulnerability,
  hasOwn,
  insecureTlsDispatcher,
  logFlow,
  makeTimeoutSignal,
  mapHttpStatusToCode,
  mergedBindings,
  normalizeBaseUrl,
  parseNgTipResponse,
  redactSensitive,
  redactUrlForLog,
  requireApiKey,
  requireDomain,
  requireResource,
  resolveApiKey,
  resolveAuthMode,
  resolveCallContext,
  resolveDomain,
  resolveSalt,
  resolveTimeoutMs,
  toTrimmedString,
  unwrapScalar,
};
