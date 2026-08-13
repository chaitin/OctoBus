import { Buffer } from 'node:buffer';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const METHOD_CHECK_STATUS_PATH = '/Elastic_Kibana_7_17_26.Elastic_Kibana_7_17_26/CheckStatus';
export const METHOD_CALL_KIBANA_API_PATH = '/Elastic_Kibana_7_17_26.Elastic_Kibana_7_17_26/CallKibanaAPI';
export const METHOD_FIND_SAVED_OBJECTS_PATH = '/Elastic_Kibana_7_17_26.Elastic_Kibana_7_17_26/FindSavedObjects';
export const METHOD_LIST_DASHBOARDS_PATH = '/Elastic_Kibana_7_17_26.Elastic_Kibana_7_17_26/ListDashboards';
export const METHOD_FIND_RULES_PATH = '/Elastic_Kibana_7_17_26.Elastic_Kibana_7_17_26/FindRules';

export const METHOD_CHECK_STATUS_FULL = 'Elastic_Kibana_7_17_26.Elastic_Kibana_7_17_26/CheckStatus';
export const METHOD_CALL_KIBANA_API_FULL = 'Elastic_Kibana_7_17_26.Elastic_Kibana_7_17_26/CallKibanaAPI';
export const METHOD_FIND_SAVED_OBJECTS_FULL = 'Elastic_Kibana_7_17_26.Elastic_Kibana_7_17_26/FindSavedObjects';
export const METHOD_LIST_DASHBOARDS_FULL = 'Elastic_Kibana_7_17_26.Elastic_Kibana_7_17_26/ListDashboards';
export const METHOD_FIND_RULES_FULL = 'Elastic_Kibana_7_17_26.Elastic_Kibana_7_17_26/FindRules';

export const DEFAULT_TIMEOUT_MS = 1500;
export const DEFAULT_PER_PAGE = 20;
export const MAX_PER_PAGE = 100;
export const DEFAULT_KBN_VERSION = '7.17.26';
export const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
let insecureDispatcherPromise;

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
  req: ctx.req ?? ctx.request ?? {},
});

const resolveEndpoint = (bindings = {}) => normalizeBaseUrl(firstDefined(
  bindings.endpoint,
  bindings.baseUrl,
  bindings.restBaseUrl,
  bindings.host,
));

const resolveUsername = (bindings = {}) => toTrimmedString(firstDefined(bindings.username, bindings.user));
const resolvePassword = (bindings = {}) => toTrimmedString(bindings.password);
const resolveApiKey = (bindings = {}) => toTrimmedString(firstDefined(bindings.apiKey, bindings.api_key));
const resolveKbnVersion = (bindings = {}) => toTrimmedString(firstDefined(bindings.kbnVersion, bindings.kbn_version, DEFAULT_KBN_VERSION));

const resolveTimeoutMs = (ctx = {}) => {
  const raw = Number(firstDefined(ctx.limits?.timeoutMs, ctx.bindings?.timeoutMs, DEFAULT_TIMEOUT_MS));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

const shouldSkipTlsVerify = (bindings = {}) => Boolean(bindings.skipTlsVerify || bindings.tlsInsecureSkipVerify || bindings.insecureSkipVerify);

const createTlsDispatcher = async (skipTlsVerify) => {
  if (!skipTlsVerify) return undefined;
  insecureDispatcherPromise ??= import('undici').then(({ Agent }) => new Agent({
    connect: { rejectUnauthorized: false },
  }));
  return insecureDispatcherPromise;
};

const buildTlsOptions = async (bindings = {}) => {
  const dispatcher = await createTlsDispatcher(shouldSkipTlsVerify(bindings));
  return dispatcher ? { dispatcher } : {};
};

const fetchWithTimeout = async (url, init = {}, options = {}) => {
  const rawTimeout = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const parentSignal = init.signal;
  const abortFromParent = () => controller.abort(parentSignal.reason);
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else if (typeof parentSignal.addEventListener === 'function') {
      parentSignal.addEventListener('abort', abortFromParent, { once: true });
    }
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const tlsOptions = await buildTlsOptions(options.bindings);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      ...tlsOptions,
    });
  } finally {
    clearTimeout(timer);
    if (parentSignal && typeof parentSignal.removeEventListener === 'function') {
      parentSignal.removeEventListener('abort', abortFromParent);
    }
  }
};

const requireEndpoint = (ctx = {}) => {
  const endpoint = resolveEndpoint(ctx.bindings || {});
  if (!endpoint) throw errorWithCode('INVALID_ARGUMENT', 'endpoint is required in bindings');
  return endpoint;
};

const normalizePositiveInt = (value, fallback, max = MAX_PER_PAGE) => {
  const raw = Number(unwrapScalar(value));
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(Math.trunc(raw), max);
};

const encodeQueryPairs = (query = {}) => {
  const parts = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.join('&');
};

const appendQuery = (url, query = {}) => {
  const qs = encodeQueryPairs(query);
  if (!qs) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${qs}`;
};

const resolveSpaceId = (req = {}, bindings = {}) => toTrimmedString(firstDefined(
  req.space_id,
  req.spaceId,
  bindings.space_id,
  bindings.spaceId,
));

const apiPrefixFor = (spaceId) => (spaceId ? `/s/${encodeURIComponent(spaceId)}` : '');

const buildApiUrl = (endpoint, apiPath, query = {}, spaceId = '') => {
  return appendQuery(`${endpoint}${apiPrefixFor(spaceId)}${apiPath}`, query);
};

const buildHeaders = (bindings = {}, requestHeaders = {}, hasBody = false) => {
  const headers = {
    Accept: 'application/json',
    'kbn-xsrf': 'octobus',
    'kbn-version': resolveKbnVersion(bindings),
    ...(bindings.headers && typeof bindings.headers === 'object' ? bindings.headers : {}),
    ...(requestHeaders && typeof requestHeaders === 'object' ? requestHeaders : {}),
  };
  if (hasBody && !Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json';
  }
  const username = resolveUsername(bindings);
  const password = resolvePassword(bindings);
  const apiKey = resolveApiKey(bindings);
  if (username || password) {
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  } else if (apiKey) {
    headers.Authorization = `ApiKey ${apiKey}`;
  }
  return headers;
};

const responseHeadersToJSON = (headers) => {
  if (!headers || typeof headers.forEach !== 'function') return '{}';
  const out = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return JSON.stringify(out);
};

const normalizeHttpMethod = (value) => {
  const method = toTrimmedString(value || 'GET').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    throw errorWithCode('INVALID_ARGUMENT', `unsupported method: ${method || '<empty>'}`);
  }
  return method;
};

const normalizeApiPath = (value) => {
  const path = toTrimmedString(value);
  if (!path) throw errorWithCode('INVALID_ARGUMENT', 'path is required');
  if (!path.startsWith('/') || path.startsWith('//') || /^https?:\/\//i.test(path)) {
    throw errorWithCode('INVALID_ARGUMENT', 'path must be a Kibana relative path starting with /');
  }
  return path;
};

const normalizeStringMap = (value = {}) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    const name = toTrimmedString(key);
    if (!name) continue;
    const text = toTrimmedString(raw);
    if (text === '') continue;
    out[name] = text;
  }
  return out;
};

const attachResponse = (err, response) => {
  err.response = response;
  return err;
};

const mapHttpStatusToCode = (httpStatus) => {
  if (httpStatus === 401 || httpStatus === 403) return 'PERMISSION_DENIED';
  if (httpStatus >= 400 && httpStatus < 500) return 'FAILED_PRECONDITION';
  return 'UNAVAILABLE';
};

const fetchKibana = async (url, ctx = {}, options = {}) => {
  const bindings = ctx.bindings || {};
  const timeoutMs = resolveTimeoutMs(ctx);
  const method = normalizeHttpMethod(options.method);
  const body = method === 'GET' || method === 'HEAD' ? undefined : toTrimmedString(options.body);
  let res;
  try {
    res = await fetchWithTimeout(url, {
      method,
      headers: buildHeaders(bindings, options.headers, body !== undefined && body !== ''),
      ...(body !== undefined && body !== '' ? { body } : {}),
    }, { timeoutMs, bindings });
  } catch (err) {
    return { httpStatus: 0, httpBody: err?.cause?.message || err?.message || 'fetch failed' };
  }
  try {
    return {
      httpStatus: Number(res.status || 0),
      httpBody: method === 'HEAD' ? '' : String(await res.text()),
      responseHeadersJSON: responseHeadersToJSON(res.headers),
    };
  } catch (err) {
    return { httpStatus: 0, httpBody: err?.message || 'response read failed' };
  }
};

const returnOrThrow = async (url, ctx, options = {}) => {
  const { httpStatus, httpBody, responseHeadersJSON = '{}' } = await fetchKibana(url, ctx, options);
  if (httpStatus >= 200 && httpStatus < 300) {
    return { http_status: httpStatus, http_body: '', response_headers_json: responseHeadersJSON };
  }
  const code = mapHttpStatusToCode(httpStatus);
  throw attachResponse(errorWithCode(code, `upstream http ${httpStatus}`), {
    http_status: httpStatus,
    http_body: '',
    http_body_length: String(httpBody ?? '').length,
    response_headers_json: responseHeadersJSON,
  });
};

const handleCheckStatus = async (_req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  return returnOrThrow(buildApiUrl(requireEndpoint(callCtx), '/api/status'), callCtx);
};

const handleCallKibanaAPI = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const endpoint = requireEndpoint(callCtx);
  const method = normalizeHttpMethod(req.method);
  const path = normalizeApiPath(req.path);
  return returnOrThrow(
    buildApiUrl(endpoint, path, normalizeStringMap(req.query), resolveSpaceId(req, callCtx.bindings)),
    callCtx,
    {
      method,
      body: req.body,
      headers: normalizeStringMap(req.headers),
    },
  );
};

const handleFindSavedObjects = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const type = toTrimmedString(firstDefined(req.type, ''));
  if (!type) throw errorWithCode('INVALID_ARGUMENT', 'type is required');
  const query = {
    type,
    search: toTrimmedString(req.search),
    page: normalizePositiveInt(req.page, 1),
    per_page: normalizePositiveInt(req.per_page ?? req.perPage, DEFAULT_PER_PAGE),
  };
  return returnOrThrow(buildApiUrl(
    requireEndpoint(callCtx),
    '/api/saved_objects/_find',
    query,
    resolveSpaceId(req, callCtx.bindings),
  ), callCtx);
};

const handleListDashboards = async (req = {}, ctx = {}) => handleFindSavedObjects({
  ...req,
  type: 'dashboard',
}, ctx);

const handleFindRules = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const query = {
    search: toTrimmedString(req.search),
    page: normalizePositiveInt(req.page, 1),
    per_page: normalizePositiveInt(req.per_page ?? req.perPage, DEFAULT_PER_PAGE),
  };
  return returnOrThrow(buildApiUrl(
    requireEndpoint(callCtx),
    '/api/alerting/rules/_find',
    query,
    resolveSpaceId(req, callCtx.bindings),
  ), callCtx);
};

const isRuntimeContext = (value) => (
  value
  && typeof value === 'object'
  && (hasOwn(value, 'config') || hasOwn(value, 'secret') || hasOwn(value, 'request') || hasOwn(value, 'metadata'))
);

const adaptHandler = (handler) => (arg1 = {}, arg2 = undefined) => {
  if (arg2 === undefined && isRuntimeContext(arg1)) {
    return handler(arg1.request ?? arg1.req ?? {}, arg1);
  }
  return handler(arg1, arg2 ?? {});
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_CHECK_STATUS_PATH]: async (req) => handleCheckStatus(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_CALL_KIBANA_API_PATH]: async (req) => handleCallKibanaAPI(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_FIND_SAVED_OBJECTS_PATH]: async (req) => handleFindSavedObjects(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_LIST_DASHBOARDS_PATH]: async (req) => handleListDashboards(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_FIND_RULES_PATH]: async (req) => handleFindRules(req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_CHECK_STATUS_FULL]: adaptHandler(handleCheckStatus),
  [METHOD_CALL_KIBANA_API_FULL]: adaptHandler(handleCallKibanaAPI),
  [METHOD_FIND_SAVED_OBJECTS_FULL]: adaptHandler(handleFindSavedObjects),
  [METHOD_LIST_DASHBOARDS_FULL]: adaptHandler(handleListDashboards),
  [METHOD_FIND_RULES_FULL]: adaptHandler(handleFindRules),
};

export const _test = {
  attachResponse,
  adaptHandler,
  appendQuery,
  buildApiUrl,
  buildHeaders,
  buildTlsOptions,
  createTlsDispatcher,
  encodeQueryPairs,
  errorWithCode,
  fetchWithTimeout,
  fetchKibana,
  firstDefined,
  grpcCodeFor,
  handleCallKibanaAPI,
  handleCheckStatus,
  handleFindRules,
  handleFindSavedObjects,
  handleListDashboards,
  hasOwn,
  isRuntimeContext,
  mapHttpStatusToCode,
  mergedBindings,
  normalizeApiPath,
  normalizeBaseUrl,
  normalizeHttpMethod,
  normalizePositiveInt,
  normalizeStringMap,
  requireEndpoint,
  responseHeadersToJSON,
  resolveApiKey,
  resolveCallContext,
  resolveEndpoint,
  resolveKbnVersion,
  resolvePassword,
  resolveSpaceId,
  resolveTimeoutMs,
  resolveUsername,
  returnOrThrow,
  shouldSkipTlsVerify,
  toTrimmedString,
  unwrapScalar,
};
