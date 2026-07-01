import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const METHOD_IP_REPUTATION_PATH = '/ThreatBook_CloudAPI_V3.ThreatBook_CloudAPI_V3/IpReputation';
export const METHOD_DOMAIN_QUERY_PATH = '/ThreatBook_CloudAPI_V3.ThreatBook_CloudAPI_V3/DomainQuery';

export const METHOD_IP_REPUTATION_FULL = 'ThreatBook_CloudAPI_V3.ThreatBook_CloudAPI_V3/IpReputation';
export const METHOD_DOMAIN_QUERY_FULL = 'ThreatBook_CloudAPI_V3.ThreatBook_CloudAPI_V3/DomainQuery';

export const DEFAULT_TIMEOUT_MS = 1500;
export const DEFAULT_LANG = 'zh';
export const DEFAULT_EXCLUDE = 'cas';

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), String(message ?? ''));
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

const requireResource = (req = {}, fieldName) => {
  const resource = toTrimmedString(firstDefined(req.resource, req[fieldName]));
  if (!resource) throw errorWithCode('INVALID_ARGUMENT', 'resource is required');
  return resource;
};

const normalizeLang = (req = {}) => toTrimmedString(req.lang) || DEFAULT_LANG;

const normalizeExclude = (req = {}) => toTrimmedString(req.exclude) || DEFAULT_EXCLUDE;

const encodeQueryPairs = (query = {}) => {
  const parts = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.join('&');
};

const buildUrl = (baseUrl, path, query) => {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const normalizedPath = String(path || '').replace(/^\/+/, '');
  const qs = encodeQueryPairs(query);
  const joined = `${base}/${normalizedPath}`;
  return qs ? `${joined}?${qs}` : joined;
};

const tryParseJson = (text) => {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
};

const toValue = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number') return Number.isFinite(value) ? { numberValue: value } : { stringValue: String(value) };
  if (Array.isArray(value)) {
    return {
      listValue: {
        values: value.map((item) => toValue(item) ?? { nullValue: 'NULL_VALUE' }),
      },
    };
  }
  if (typeof value === 'object') {
    const fields = {};
    for (const [key, innerValue] of Object.entries(value)) {
      fields[key] = toValue(innerValue) ?? { nullValue: 'NULL_VALUE' };
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(value) };
};

const throwStructuredError = (code, message, options = {}) => {
  const rawBody = String(options.rawBody ?? '');
  const sensitiveValues = options.sensitiveValues || [];
  const payload = {
    code,
    message: redactSensitive(message, sensitiveValues),
    http_status: Number(options.httpStatus ?? 0),
    raw_body: '',
    raw_body_length: rawBody.length,
  };
  if (options.reason) payload.reason = redactSensitive(options.reason, sensitiveValues);
  if (options.responseCode !== undefined) payload.response_code = options.responseCode;
  if (options.verboseMsg !== undefined) payload.verbose_msg = redactSensitive(options.verboseMsg, sensitiveValues);
  throw errorWithCode(code, JSON.stringify(payload));
};

const mapHttpStatusToGrpcCode = (status) => {
  if (status === 401 || status === 403) return 'PERMISSION_DENIED';
  if (status >= 400 && status < 500) return 'FAILED_PRECONDITION';
  if (status >= 500) return 'UNAVAILABLE';
  return 'UNAVAILABLE';
};

const fetchUpstream = async (url, ctx = {}) => {
  const bindings = ctx.bindings || {};
  const sensitiveValues = [resolveApiKey(bindings)].filter(Boolean);
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
    throwStructuredError('UNAVAILABLE', 'threatbook upstream request failed', {
      httpStatus: 0,
      rawBody: '',
      reason: err?.cause?.message || err?.message || 'fetch failed',
      sensitiveValues,
    });
  } finally {
    timeout.clear();
  }

  const httpStatus = Number(res?.status || 0);
  let rawBody;
  try {
    rawBody = await res.text();
  } catch (err) {
    throwStructuredError('UNAVAILABLE', 'threatbook upstream response read failed', {
      httpStatus,
      rawBody: '',
      reason: err?.message || 'response read failed',
      sensitiveValues,
    });
  }
  const result = { httpStatus, rawBody: String(rawBody ?? '') };
  if (sensitiveValues.length) result.sensitiveValues = sensitiveValues;
  return result;
};

const assertThreatBookSuccess = ({ httpStatus, rawBody }, parsed) => {
  if (httpStatus !== 200) {
    const code = mapHttpStatusToGrpcCode(httpStatus);
    throwStructuredError(code, 'threatbook upstream http failure', {
      httpStatus,
      rawBody,
      rawJson: parsed.ok ? parsed.value : undefined,
      reason: `upstream http ${httpStatus}`,
      sensitiveValues: parsed.sensitiveValues,
    });
  }

  if (!parsed.ok) {
    throwStructuredError('UNKNOWN', 'threatbook response is not valid JSON', {
      httpStatus,
      rawBody,
      reason: 'response is not valid JSON',
      sensitiveValues: parsed.sensitiveValues,
    });
  }

  const responseCode = Number(firstDefined(parsed.value?.response_code, parsed.value?.responseCode));
  const verboseMsg = toTrimmedString(firstDefined(parsed.value?.verbose_msg, parsed.value?.verboseMsg));

  if (!Number.isFinite(responseCode)) {
    throwStructuredError('UNKNOWN', 'threatbook response_code missing', {
      httpStatus,
      rawBody,
      rawJson: parsed.value,
      reason: 'response_code missing',
      sensitiveValues: parsed.sensitiveValues,
    });
  }

  if (responseCode !== 0) {
    throwStructuredError('FAILED_PRECONDITION', 'threatbook upstream business failure', {
      httpStatus,
      rawBody,
      rawJson: parsed.value,
      responseCode,
      verboseMsg,
      reason: 'response_code != 0',
      sensitiveValues: parsed.sensitiveValues,
    });
  }

  return { json: parsed.value };
};

const parseThreatBookResponse = (result) => {
  const trimmed = result.rawBody.trim();
  const parsed = trimmed ? tryParseJson(trimmed) : { ok: false };
  parsed.sensitiveValues = result.sensitiveValues || [];
  const ok = assertThreatBookSuccess(result, parsed);
  return {
    http_status: result.httpStatus,
    raw_body: '',
    raw_json: undefined,
  };
};

const handleIpReputation = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const domain = requireDomain(callCtx);
  const apiKey = requireApiKey(callCtx);
  const resource = requireResource(req, 'ip');
  const lang = normalizeLang(req);
  const url = buildUrl(domain, '/1.1.1/scene/ip_reputation', {
    apikey: apiKey,
    lang,
    resource,
  });
  return parseThreatBookResponse(await fetchUpstream(url, callCtx));
};

const handleDomainQuery = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const domain = requireDomain(callCtx);
  const apiKey = requireApiKey(callCtx);
  const resource = requireResource(req, 'domain');
  const lang = normalizeLang(req);
  const exclude = normalizeExclude(req);
  const url = buildUrl(domain, '/1.1.1/domain/query', {
    apikey: apiKey,
    lang,
    resource,
    exclude,
  });
  return parseThreatBookResponse(await fetchUpstream(url, callCtx));
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_IP_REPUTATION_PATH]: async (req) => handleIpReputation(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_DOMAIN_QUERY_PATH]: async (req) => handleDomainQuery(req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_IP_REPUTATION_FULL]: (ctx = {}) => handleIpReputation(requestFromContext(ctx), ctx),
  [METHOD_DOMAIN_QUERY_FULL]: (ctx = {}) => handleDomainQuery(requestFromContext(ctx), ctx),
};

export const _test = {
  assertThreatBookSuccess,
  buildTlsOptions,
  buildUrl,
  encodeQueryPairs,
  errorWithCode,
  fetchUpstream,
  firstDefined,
  grpcCodeFor,
  handleDomainQuery,
  handleIpReputation,
  hasOwn,
  insecureTlsDispatcher,
  makeTimeoutSignal,
  mapHttpStatusToGrpcCode,
  mergedBindings,
  normalizeBaseUrl,
  normalizeExclude,
  normalizeLang,
  parseThreatBookResponse,
  redactSensitive,
  requireApiKey,
  requireDomain,
  requireResource,
  resolveApiKey,
  resolveCallContext,
  resolveDomain,
  resolveTimeoutMs,
  throwStructuredError,
  toTrimmedString,
  toValue,
  tryParseJson,
  unwrapScalar,
};
