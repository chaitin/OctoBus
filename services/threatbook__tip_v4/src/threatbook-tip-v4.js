import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const METHOD_QUERY_IP_REPUTATION_PATH = '/ThreatBook_TIP_V4.ThreatBook_TIP_V4/QueryIPReputation';
export const METHOD_QUERY_IP_REPUTATION_FULL = 'ThreatBook_TIP_V4.ThreatBook_TIP_V4/QueryIPReputation';

export const DEFAULT_TIMEOUT_MS = 1500;
export const DEFAULT_LANG = 'zh';
export const QUERY_IP_HTTP_PATH = '/tip_api/v4/ip';

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
  req: ctx.request ?? ctx.req ?? {},
});

const requestFromContext = (ctx = {}) => ctx.request ?? ctx.req ?? {};

const resolveDomain = (bindings = {}) => normalizeBaseUrl(firstDefined(
  bindings.threatbook_domain,
  bindings.domain,
  bindings.restBaseUrl,
  bindings.baseUrl,
));

const resolveApiKey = (bindings = {}) => toTrimmedString(firstDefined(
  bindings.threatbook_apikey,
  bindings.apikey,
  bindings.apiKey,
));

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
  if (!domain) throw errorWithCode('INVALID_ARGUMENT', 'threatbook_domain is required in bindings');
  return domain;
};

const requireApiKey = (ctx = {}) => {
  const apiKey = resolveApiKey(ctx.bindings || {});
  if (!apiKey) throw errorWithCode('INVALID_ARGUMENT', 'threatbook_apikey is required in bindings');
  return apiKey;
};

const requireIp = (req = {}) => {
  const ip = toTrimmedString(firstDefined(req.ip, req.resource));
  if (!ip) throw errorWithCode('INVALID_ARGUMENT', 'ip is required');
  return ip;
};

const buildLogPrefix = (ctx = {}, action) => {
  const meta = ctx.meta || {};
  const trace = [];
  if (meta.instance_id || meta.instanceId) trace.push(`inst=${meta.instance_id || meta.instanceId}`);
  if (meta.request_id || meta.requestId) trace.push(`req=${meta.request_id || meta.requestId}`);
  return `[ThreatBook_TIP_V4][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
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
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.join('&');
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const redactUrlSensitiveQuery = (url) => {
  try {
    const parsed = new URL(String(url));
    for (const key of ['apikey', 'api_key', 'sign', 'token']) {
      if (parsed.searchParams.has(key)) parsed.searchParams.set(key, '***');
    }
    return parsed.toString();
  } catch {
    return String(url).replace(/((?:apikey|api_key|sign|token)=)[^&\s]+/gi, '$1***');
  }
};

const sanitizeSensitiveText = (value, sensitiveValues = []) => {
  let text = String(value ?? '');
  text = text.replace(/((?:apikey|api_key|sign|token)=)[^&\s"'<>]+/gi, '$1***');
  for (const secretValue of sensitiveValues) {
    const secretText = String(secretValue ?? '');
    if (secretText.length < 3) continue;
    text = text.replace(new RegExp(escapeRegExp(secretText), 'g'), '***');
  }
  return text;
};

const buildQueryUrl = (domain, query) => `${domain}${QUERY_IP_HTTP_PATH}?${encodeQueryPairs(query)}`;

const attachResponse = (err, response) => {
  err.response = response;
  return err;
};

const fetchWithStatus = async (url, ctx = {}) => {
  const bindings = ctx.bindings || {};
  const sensitiveValues = [resolveApiKey(bindings)];
  const logUrl = redactUrlSensitiveQuery(url);
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
    const errMsg = sanitizeSensitiveText(err?.cause?.message || err?.message || 'fetch failed', sensitiveValues);
    logFlow(ctx, 'fetch:error', { url: logUrl, error: errMsg });
    return { httpStatus: 0, httpBody: errMsg };
  } finally {
    timeout.clear();
  }
  let httpBody;
  try {
    httpBody = await res.text();
  } catch (err) {
    const errMsg = sanitizeSensitiveText(err?.message || 'response read failed', sensitiveValues);
    logFlow(ctx, 'fetch:read-error', { url: logUrl, httpStatus: res.status, error: errMsg });
    return { httpStatus: 0, httpBody: errMsg };
  }
  const httpStatus = Number(res.status || 0);
  logFlow(ctx, 'fetch:response', { url: logUrl, httpStatus, bodyLength: httpBody?.length || 0 });
  return { httpStatus, httpBody: String(httpBody ?? '') };
};

const mapHttpStatusToCode = (httpStatus) => {
  if (httpStatus === 401 || httpStatus === 403) return 'PERMISSION_DENIED';
  if (httpStatus >= 400 && httpStatus < 500) return 'FAILED_PRECONDITION';
  return 'UNAVAILABLE';
};

const handleQueryIPReputation = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const domain = requireDomain(callCtx);
  const apiKey = requireApiKey(callCtx);
  const ip = requireIp(req);
  const url = buildQueryUrl(domain, {
    apikey: apiKey,
    lang: DEFAULT_LANG,
    resource: ip,
  });
  logFlow(callCtx, 'QueryIPReputation', { url: `${domain}${QUERY_IP_HTTP_PATH}`, ip, lang: DEFAULT_LANG });
  const { httpStatus, httpBody } = await fetchWithStatus(url, callCtx);
  if (httpStatus >= 200 && httpStatus < 300) {
    return { http_status: httpStatus, http_body: '' };
  }
  const code = mapHttpStatusToCode(httpStatus);
  throw attachResponse(errorWithCode(code, `upstream http ${httpStatus}`), {
    http_status: httpStatus,
    http_body: '',
    http_body_length: String(httpBody ?? '').length,
  });
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_QUERY_IP_REPUTATION_PATH]: async (req) => handleQueryIPReputation(req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_QUERY_IP_REPUTATION_FULL]: (ctx = {}) => handleQueryIPReputation(requestFromContext(ctx), ctx),
};

export const _test = {
  attachResponse,
  buildLogPrefix,
  buildQueryUrl,
  buildTlsOptions,
  encodeQueryPairs,
  errorWithCode,
  escapeRegExp,
  fetchWithStatus,
  firstDefined,
  grpcCodeFor,
  handleQueryIPReputation,
  hasOwn,
  insecureTlsDispatcher,
  makeTimeoutSignal,
  logFlow,
  mapHttpStatusToCode,
  mergedBindings,
  normalizeBaseUrl,
  requireApiKey,
  requireDomain,
  requireIp,
  resolveApiKey,
  resolveCallContext,
  resolveDomain,
  resolveTimeoutMs,
  redactUrlSensitiveQuery,
  toTrimmedString,
  sanitizeSensitiveText,
  unwrapScalar,
};
