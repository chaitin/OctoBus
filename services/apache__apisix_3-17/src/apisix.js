import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const METHOD_LIST_ROUTES_PATH = '/Apache_APISIX.Apache_APISIX/ListRoutes';
export const METHOD_GET_ROUTE_PATH = '/Apache_APISIX.Apache_APISIX/GetRoute';
export const METHOD_UPSERT_ROUTE_PATH = '/Apache_APISIX.Apache_APISIX/UpsertRoute';
export const METHOD_DELETE_ROUTE_PATH = '/Apache_APISIX.Apache_APISIX/DeleteRoute';
export const METHOD_LIST_UPSTREAMS_PATH = '/Apache_APISIX.Apache_APISIX/ListUpstreams';
export const METHOD_GET_UPSTREAM_PATH = '/Apache_APISIX.Apache_APISIX/GetUpstream';
export const METHOD_UPSERT_UPSTREAM_PATH = '/Apache_APISIX.Apache_APISIX/UpsertUpstream';
export const METHOD_DELETE_UPSTREAM_PATH = '/Apache_APISIX.Apache_APISIX/DeleteUpstream';

export const METHOD_LIST_ROUTES_FULL = 'Apache_APISIX.Apache_APISIX/ListRoutes';
export const METHOD_GET_ROUTE_FULL = 'Apache_APISIX.Apache_APISIX/GetRoute';
export const METHOD_UPSERT_ROUTE_FULL = 'Apache_APISIX.Apache_APISIX/UpsertRoute';
export const METHOD_DELETE_ROUTE_FULL = 'Apache_APISIX.Apache_APISIX/DeleteRoute';
export const METHOD_LIST_UPSTREAMS_FULL = 'Apache_APISIX.Apache_APISIX/ListUpstreams';
export const METHOD_GET_UPSTREAM_FULL = 'Apache_APISIX.Apache_APISIX/GetUpstream';
export const METHOD_UPSERT_UPSTREAM_FULL = 'Apache_APISIX.Apache_APISIX/UpsertUpstream';
export const METHOD_DELETE_UPSTREAM_FULL = 'Apache_APISIX.Apache_APISIX/DeleteUpstream';

export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_ALLOWED_ID_PREFIX = 'octobus-test-';

const RESOURCE_PATHS = {
  route: '/apisix/admin/routes',
  upstream: '/apisix/admin/upstreams',
};

const grpcCodeFor = (code) => ({
  DEADLINE_EXCEEDED: grpcStatus.DEADLINE_EXCEEDED,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  NOT_FOUND: grpcStatus.NOT_FOUND,
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

const toOptionalPositiveInt = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = Number(raw);
  if (!Number.isInteger(num) || Number.isNaN(num) || num <= 0) return undefined;
  return num;
};

const toBool = (value, fallback) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') {
    if (raw === 1) return true;
    if (raw === 0) return false;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return fallback;
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

const isSdkCallContext = (value) => (
  value != null
  && typeof value === 'object'
  && (
    hasOwn(value, 'request')
    || hasOwn(value, 'config')
    || hasOwn(value, 'secret')
    || hasOwn(value, 'metadata')
    || hasOwn(value, 'method')
    || hasOwn(value, 'packageDir')
  )
);

const resolveHandlerArgs = (reqOrCtx = {}, maybeCtx) => {
  if (maybeCtx !== undefined) {
    return { req: reqOrCtx ?? {}, ctx: maybeCtx ?? {} };
  }
  if (isSdkCallContext(reqOrCtx)) {
    return { req: reqOrCtx.request ?? reqOrCtx.req ?? {}, ctx: reqOrCtx };
  }
  return { req: reqOrCtx ?? {}, ctx: {} };
};

const resolveBaseUrl = (bindings = {}) => normalizeBaseUrl(firstDefined(
  bindings.baseUrl,
  bindings.restBaseUrl,
  bindings.endpoint,
  bindings.adminApiBaseUrl,
));

const resolveAdminApiKey = (req = {}, bindings = {}) => toTrimmedString(firstDefined(
  req.admin_api_key,
  req.adminApiKey,
  bindings.adminApiKey,
  bindings.admin_api_key,
  bindings.apiKey,
));

const resolveAllowedIdPrefix = (bindings = {}) => {
  const prefix = toTrimmedString(firstDefined(bindings.allowedIdPrefix, bindings.allowed_id_prefix));
  return prefix || DEFAULT_ALLOWED_ID_PREFIX;
};

const resolveTimeoutMs = (ctx = {}) => {
  const fromBinding = toOptionalPositiveInt(ctx.bindings?.timeoutMs);
  const fromLimit = toOptionalPositiveInt(ctx.limits?.timeoutMs);
  return fromBinding ?? fromLimit ?? DEFAULT_TIMEOUT_MS;
};

const requireBaseUrl = (ctx = {}) => {
  const baseUrl = resolveBaseUrl(ctx.bindings ?? {});
  if (!baseUrl) {
    throw errorWithCode('FAILED_PRECONDITION', 'baseUrl is required and must start with http:// or https://');
  }
  return baseUrl;
};

const requireAdminApiKey = (req = {}, ctx = {}) => {
  const adminApiKey = resolveAdminApiKey(req, ctx.bindings ?? {});
  if (!adminApiKey) {
    throw errorWithCode('INVALID_ARGUMENT', 'adminApiKey is required');
  }
  return adminApiKey;
};

const requireId = (req = {}) => {
  const id = toTrimmedString(req.id);
  if (!id) {
    throw errorWithCode('INVALID_ARGUMENT', 'id is required');
  }
  if (id.includes('/')) {
    throw errorWithCode('INVALID_ARGUMENT', 'id must not contain "/"');
  }
  return id;
};

const requireSafeWriteId = (id, ctx = {}) => {
  const allowedIdPrefix = resolveAllowedIdPrefix(ctx.bindings ?? {});
  if (allowedIdPrefix && !id.startsWith(allowedIdPrefix)) {
    throw errorWithCode(
      'FAILED_PRECONDITION',
      `write/delete id must start with allowedIdPrefix "${allowedIdPrefix}"`,
    );
  }
};

const parseBodyJson = (value) => {
  const bodyJson = toTrimmedString(value);
  if (!bodyJson) {
    throw errorWithCode('INVALID_ARGUMENT', 'body_json is required');
  }
  try {
    const parsed = JSON.parse(bodyJson);
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('body must be a JSON object');
    }
    return parsed;
  } catch (error) {
    throw errorWithCode('INVALID_ARGUMENT', `body_json must be a JSON object: ${error.message}`);
  }
};

const stableJson = (value) => JSON.stringify(value ?? null);

const resourceIdFromEntry = (entry) => {
  const value = entry?.value ?? entry;
  if (typeof value?.id === 'string') return value.id;
  if (typeof entry?.key === 'string') return entry.key.split('/').pop() ?? '';
  return '';
};

const normalizeListResponse = (json) => {
  const list = Array.isArray(json?.list)
    ? json.list
    : Array.isArray(json?.data?.list)
      ? json.data.list
      : Array.isArray(json)
        ? json
        : [];
  return {
    items: list.map((entry) => ({
      id: resourceIdFromEntry(entry),
      raw_json: stableJson(entry),
    })),
    total: Number.isInteger(json?.total) ? json.total : list.length,
    raw_json: stableJson(json),
  };
};

const normalizeResourceResponse = (json, fallbackId) => {
  const value = json?.value ?? json?.node?.value ?? json;
  return {
    id: resourceIdFromEntry(json) || toTrimmedString(value?.id) || fallbackId,
    raw_json: stableJson(json),
  };
};

const normalizeDeleteResponse = (json, id) => ({
  id,
  deleted: true,
  raw_json: stableJson(json),
});

const mapHttpStatusToCode = (status) => {
  if (status === 401 || status === 403) return 'PERMISSION_DENIED';
  if (status === 404) return 'NOT_FOUND';
  if (status >= 500) return 'UNAVAILABLE';
  return 'UNKNOWN';
};

const parseResponseText = (text) => {
  if (text === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', 'response is not valid JSON');
  }
};

const fetchAdminApi = async (ctx = {}, req = {}, method, path, body) => {
  const baseUrl = requireBaseUrl(ctx);
  const adminApiKey = requireAdminApiKey(req, ctx);
  const timeoutMs = resolveTimeoutMs(ctx);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const tlsRejectUnauthorized = toBool(ctx.bindings?.tlsRejectUnauthorized, true);
  const init = {
    method,
    headers: {
      'Accept': 'application/json',
      'X-API-KEY': adminApiKey,
    },
    signal: controller.signal,
  };

  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = stableJson(body);
  }
  if (!tlsRejectUnauthorized) {
    const { Agent } = await import('undici');
    init.dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
  }

  try {
    const response = await fetch(`${baseUrl}${path}`, init);
    const text = await response.text();
    const json = parseResponseText(text);
    if (!response.ok) {
      throw errorWithCode(mapHttpStatusToCode(response.status), `upstream http ${response.status}: ${text || response.statusText}`);
    }
    return json;
  } catch (error) {
    if (error?.legacyCode) throw error;
    if (error?.name === 'AbortError') {
      throw errorWithCode('DEADLINE_EXCEEDED', `request timed out after ${timeoutMs}ms`);
    }
    throw errorWithCode('UNAVAILABLE', error?.message ?? String(error));
  } finally {
    clearTimeout(timeout);
  }
};

const buildListPath = (kind, req = {}) => {
  const params = new URLSearchParams();
  const page = toOptionalPositiveInt(req.page);
  const pageSize = toOptionalPositiveInt(req.page_size ?? req.pageSize);
  if (page !== undefined) params.set('page', String(page));
  if (pageSize !== undefined) params.set('page_size', String(pageSize));
  const query = params.toString();
  return `${RESOURCE_PATHS[kind]}${query ? `?${query}` : ''}`;
};

const handleList = async (kind, req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const json = await fetchAdminApi(callCtx, req, 'GET', buildListPath(kind, req));
  return normalizeListResponse(json);
};

const handleGet = async (kind, req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const id = requireId(req);
  const json = await fetchAdminApi(callCtx, req, 'GET', `${RESOURCE_PATHS[kind]}/${encodeURIComponent(id)}`);
  return normalizeResourceResponse(json, id);
};

const handleUpsert = async (kind, req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const id = requireId(req);
  requireSafeWriteId(id, callCtx);
  const body = parseBodyJson(req.body_json ?? req.bodyJson);
  const json = await fetchAdminApi(callCtx, req, 'PUT', `${RESOURCE_PATHS[kind]}/${encodeURIComponent(id)}`, body);
  return normalizeResourceResponse(json, id);
};

const handleDelete = async (kind, req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const id = requireId(req);
  requireSafeWriteId(id, callCtx);
  const json = await fetchAdminApi(callCtx, req, 'DELETE', `${RESOURCE_PATHS[kind]}/${encodeURIComponent(id)}`);
  return normalizeDeleteResponse(json, id);
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_LIST_ROUTES_PATH]: async (req) => handleList('route', req ?? callCtx.req ?? {}, callCtx),
    [METHOD_GET_ROUTE_PATH]: async (req) => handleGet('route', req ?? callCtx.req ?? {}, callCtx),
    [METHOD_UPSERT_ROUTE_PATH]: async (req) => handleUpsert('route', req ?? callCtx.req ?? {}, callCtx),
    [METHOD_DELETE_ROUTE_PATH]: async (req) => handleDelete('route', req ?? callCtx.req ?? {}, callCtx),
    [METHOD_LIST_UPSTREAMS_PATH]: async (req) => handleList('upstream', req ?? callCtx.req ?? {}, callCtx),
    [METHOD_GET_UPSTREAM_PATH]: async (req) => handleGet('upstream', req ?? callCtx.req ?? {}, callCtx),
    [METHOD_UPSERT_UPSTREAM_PATH]: async (req) => handleUpsert('upstream', req ?? callCtx.req ?? {}, callCtx),
    [METHOD_DELETE_UPSTREAM_PATH]: async (req) => handleDelete('upstream', req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_LIST_ROUTES_FULL]: (reqOrCtx, maybeCtx) => {
    const call = resolveHandlerArgs(reqOrCtx, maybeCtx);
    return handleList('route', call.req, call.ctx);
  },
  [METHOD_GET_ROUTE_FULL]: (reqOrCtx, maybeCtx) => {
    const call = resolveHandlerArgs(reqOrCtx, maybeCtx);
    return handleGet('route', call.req, call.ctx);
  },
  [METHOD_UPSERT_ROUTE_FULL]: (reqOrCtx, maybeCtx) => {
    const call = resolveHandlerArgs(reqOrCtx, maybeCtx);
    return handleUpsert('route', call.req, call.ctx);
  },
  [METHOD_DELETE_ROUTE_FULL]: (reqOrCtx, maybeCtx) => {
    const call = resolveHandlerArgs(reqOrCtx, maybeCtx);
    return handleDelete('route', call.req, call.ctx);
  },
  [METHOD_LIST_UPSTREAMS_FULL]: (reqOrCtx, maybeCtx) => {
    const call = resolveHandlerArgs(reqOrCtx, maybeCtx);
    return handleList('upstream', call.req, call.ctx);
  },
  [METHOD_GET_UPSTREAM_FULL]: (reqOrCtx, maybeCtx) => {
    const call = resolveHandlerArgs(reqOrCtx, maybeCtx);
    return handleGet('upstream', call.req, call.ctx);
  },
  [METHOD_UPSERT_UPSTREAM_FULL]: (reqOrCtx, maybeCtx) => {
    const call = resolveHandlerArgs(reqOrCtx, maybeCtx);
    return handleUpsert('upstream', call.req, call.ctx);
  },
  [METHOD_DELETE_UPSTREAM_FULL]: (reqOrCtx, maybeCtx) => {
    const call = resolveHandlerArgs(reqOrCtx, maybeCtx);
    return handleDelete('upstream', call.req, call.ctx);
  },
};

export const _test = {
  DEFAULT_ALLOWED_ID_PREFIX,
  buildListPath,
  errorWithCode,
  fetchAdminApi,
  firstDefined,
  handleDelete,
  handleGet,
  handleList,
  handleUpsert,
  mergedBindings,
  normalizeBaseUrl,
  normalizeDeleteResponse,
  normalizeListResponse,
  normalizeResourceResponse,
  parseBodyJson,
  requireAdminApiKey,
  requireBaseUrl,
  requireId,
  requireSafeWriteId,
  resolveAdminApiKey,
  resolveAllowedIdPrefix,
  resolveBaseUrl,
  resolveCallContext,
  resolveHandlerArgs,
  resolveTimeoutMs,
  toBool,
  toOptionalPositiveInt,
  toTrimmedString,
  unwrapScalar,
};
