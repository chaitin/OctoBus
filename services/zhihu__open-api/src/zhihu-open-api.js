import { GrpcError, grpcCodeFor, normalizeTimeoutMs } from '@chaitin-ai/octobus-sdk';

// ---------------------------------------------------------------------------
// Method table
// ---------------------------------------------------------------------------
const PREFIX = 'Zhihu_Open_Api.Zhihu_Open_Api';
export const METHODS = {
  CHECK_CONNECTIVITY: `${PREFIX}/CheckConnectivity`,
  GET_QUOTA: `${PREFIX}/GetQuota`,
  ZHIHU_SEARCH: `${PREFIX}/ZhihuSearch`,
  GLOBAL_SEARCH: `${PREFIX}/GlobalSearch`,
  GET_HOT_LIST: `${PREFIX}/GetHotList`,
  LIST_KNOWLEDGE_BASES: `${PREFIX}/ListKnowledgeBases`,
  LIST_KNOWLEDGE_BASE_ITEMS: `${PREFIX}/ListKnowledgeBaseItems`,
  UPLOAD_KNOWLEDGE_FILE: `${PREFIX}/UploadKnowledgeFile`,
  SEARCH_KNOWLEDGE: `${PREFIX}/SearchKnowledge`,
  GET_USER_CONTENTS: `${PREFIX}/GetUserContents`,
  GET_USER_FOLLOWEES: `${PREFIX}/GetUserFollowees`,
  GET_USER_COLLECTIONS: `${PREFIX}/GetUserCollections`,
  GET_USER_FAVLISTS: `${PREFIX}/GetUserFavlists`,
  GET_FAVLIST_CONTENTS: `${PREFIX}/GetFavlistContents`,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DEFAULT_BASE_URL = 'https://developer.zhihu.com';
const DEFAULT_TIMEOUT_MS = 10_000;

const SEARCH_DB_VALUES = ['all', 'realtime', 'static'];
const SCOPE_VALUES = ['all', 'created', 'subscribed'];
const CONTENT_TYPE_VALUES = ['all', 'answer', 'article', 'zvideo', 'pin', 'question'];
const SORT_FIELD_VALUES = ['like_count', 'ts'];
const SORT_ORDER_VALUES = ['asc', 'desc'];
const RECALL_SCOPE_VALUES = ['personal', 'subscription', 'public'];

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------
const errorWithCode = (code, message) => {
  const error = new GrpcError(grpcCodeFor(code), message);
  error.legacyCode = code;
  return error;
};

// Map Zhihu business codes and HTTP statuses to gRPC error codes.
const mapErrorCode = (status, upstreamCode) => {
  const code = Number(upstreamCode);
  if (status === 401 || code === 20001) return 'UNAUTHENTICATED';
  if (status === 403) return 'PERMISSION_DENIED';
  if (status === 429 || [30001, 30002].includes(code)) return 'RESOURCE_EXHAUSTED';
  if (status === 404 || code === 40004) return 'NOT_FOUND';
  if ([40005, 40006].includes(code)) return 'FAILED_PRECONDITION';
  if (code === 50002) return 'UNAVAILABLE';
  if (code === 10001) return 'INVALID_ARGUMENT';
  if (status === 400) return 'INVALID_ARGUMENT';
  if (status >= 500 || code === 90001) return 'UNAVAILABLE';
  return 'UNKNOWN';
};

const isTimeoutError = (cause) => cause?.name === 'TimeoutError'
  || cause?.name === 'AbortError'
  || cause?.cause?.name === 'TimeoutError'
  || cause?.code === 'ABORT_ERR';

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);
const asString = (value) => String(value ?? '').trim();
const pick = (obj, ...keys) => {
  for (const key of keys) {
    if (hasOwn(obj, key)) return obj[key];
  }
  return undefined;
};
const sanitizeMessage = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);

const requiredString = (value, field, maxLength = 4096) => {
  const text = asString(value);
  if (!text) throw errorWithCode('INVALID_ARGUMENT', `${field} is required`);
  if (text.length > maxLength) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} exceeds ${maxLength} characters`);
  }
  return text;
};

const enumValue = (value, field, allowed, fallback) => {
  const text = asString(value) || fallback;
  if (!allowed.includes(text)) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} must be one of ${allowed.join(', ')}`);
  }
  return text;
};

const nonNegativeInteger = (value, field) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} must be a non-negative integer`);
  }
  return number;
};

// Zhihu servers clamp out-of-range counts/limits instead of rejecting them, so
// the service mirrors that behavior: values are clamped into [1, max].
const clampedPositiveInteger = (value, field, max, fallback) => {
  const number = Number(value === undefined || value === null || value === '' ? fallback : value);
  if (!Number.isFinite(number)) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} must be an integer`);
  }
  return String(Math.max(1, Math.min(max, Math.trunc(number))));
};

const offsetParam = (value) => String(nonNegativeInteger(
  value === undefined || value === null || value === '' ? 0 : value,
  'Offset',
));

const stringArray = (value, allowed) => {
  const items = Array.isArray(value) ? value : (value === undefined || value === null ? [] : [value]);
  const result = [];
  for (const item of items) {
    const text = asString(item);
    if (!text) continue;
    if (allowed && !allowed.includes(text)) {
      throw errorWithCode('INVALID_ARGUMENT', `value must be one of ${allowed.join(', ')}`);
    }
    result.push(text);
  }
  return result;
};

const toBytes = (value) => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === 'string') {
    if (!value) throw errorWithCode('INVALID_ARGUMENT', 'file_content is required');
    return Uint8Array.from(Buffer.from(value, 'base64'));
  }
  if (value === undefined || value === null) throw errorWithCode('INVALID_ARGUMENT', 'file_content is required');
  throw errorWithCode('INVALID_ARGUMENT', 'file_content must be base64 bytes');
};

// ---------------------------------------------------------------------------
// Request builders
// ---------------------------------------------------------------------------
export const buildZhihuSearchQuery = (request = {}) => ({
  Query: requiredString(request.query ?? request.Query, 'Query'),
  Count: clampedPositiveInteger(request.count ?? request.Count, 'Count', 10, 10),
});

export const buildGlobalSearchQuery = (request = {}) => ({
  Query: requiredString(request.query ?? request.Query, 'Query'),
  Count: clampedPositiveInteger(request.count ?? request.Count, 'Count', 20, 10),
  SearchDB: enumValue(request.search_db ?? request.searchDb ?? request.SearchDB, 'SearchDB', SEARCH_DB_VALUES, 'all'),
  Filter: asString(request.filter ?? request.Filter),
});

export const buildHotListQuery = (request = {}) => ({
  Limit: clampedPositiveInteger(request.limit ?? request.Limit, 'Limit', 30, 30),
});

// APIIDs is a comma-separated list of quota item ids. Normalize whitespace and
// drop empty tokens; pass through unknown ids so future Zhihu quota items work
// without a service change (the upstream validates the ids).
export const buildGetQuotaQuery = (request = {}) => {
  const raw = asString(request.api_ids ?? request.apiIds ?? request.APIIDs);
  if (!raw) return {};
  const ids = raw.split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(',');
  return ids ? { APIIDs: ids } : {};
};

export const buildKnowledgeBasesQuery = (request = {}) => ({
  Scope: enumValue(request.scope ?? request.Scope, 'Scope', SCOPE_VALUES, 'all'),
});

export const buildKnowledgeBaseItemsQuery = (request = {}) => ({
  Cursor: asString(request.cursor ?? request.Cursor),
  Limit: clampedPositiveInteger(request.limit ?? request.Limit, 'Limit', 20, 20),
});

export const buildKnowledgeSearchBody = (request = {}) => {
  const ids = stringArray(request.knowledge_base_ids ?? request.knowledgeBaseIds ?? request.KnowledgeBaseIDs);
  const scopes = stringArray(request.recall_scopes ?? request.recallScopes ?? request.RecallScopes, RECALL_SCOPE_VALUES);
  if (ids.length === 0 && scopes.length === 0) {
    throw errorWithCode('INVALID_ARGUMENT', 'at least one of knowledge_base_ids or recall_scopes is required');
  }
  return {
    Query: requiredString(request.query ?? request.Query, 'Query'),
    KnowledgeBaseIDs: ids,
    RecallScopes: scopes,
    Limit: Number(clampedPositiveInteger(request.limit ?? request.Limit, 'Limit', 10, 10)),
  };
};

export const buildUserContentsQuery = (request = {}) => ({
  ContentType: enumValue(
    request.content_type ?? request.contentType ?? request.ContentType,
    'ContentType',
    CONTENT_TYPE_VALUES,
  ),
  Offset: offsetParam(request.offset ?? request.Offset),
  Limit: clampedPositiveInteger(request.limit ?? request.Limit, 'Limit', 50, 20),
  SortField: enumValue(request.sort_field ?? request.sortField ?? request.SortField, 'SortField', SORT_FIELD_VALUES, 'ts'),
  SortOrder: enumValue(request.sort_order ?? request.sortOrder ?? request.SortOrder, 'SortOrder', SORT_ORDER_VALUES, 'desc'),
});

export const buildUserFolloweesQuery = (request = {}) => ({
  Offset: offsetParam(request.offset ?? request.Offset),
  Limit: clampedPositiveInteger(request.limit ?? request.Limit, 'Limit', 50, 20),
});

export const buildUserCollectionsQuery = (request = {}) => ({
  Limit: clampedPositiveInteger(request.limit ?? request.Limit, 'Limit', 50, 20),
});

export const buildUserFavlistsQuery = (request = {}) => ({
  Limit: clampedPositiveInteger(request.limit ?? request.Limit, 'Limit', 50, 20),
});

export const buildFavlistContentsQuery = (request = {}) => {
  const favlistUrlToken = requiredString(
    request.favlist_url_token ?? request.favlistUrlToken ?? request.FavlistUrlToken,
    'favlist_url_token',
  );
  return {
    FavlistUrlToken: favlistUrlToken,
    Offset: offsetParam(request.offset ?? request.Offset),
    Limit: clampedPositiveInteger(request.limit ?? request.Limit, 'Limit', 50, 20),
  };
};

export const buildQuery = (params) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
};

export const buildUploadForm = (fileContent, fileName, knowledgeBaseId) => {
  const form = new FormData();
  form.append('File', new Blob([toBytes(fileContent)]), fileName);
  if (knowledgeBaseId) form.append('KnowledgeBaseID', knowledgeBaseId);
  return form;
};

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------
const normalizeBaseUrl = (value) => {
  let url;
  try {
    url = new URL(asString(value) || DEFAULT_BASE_URL);
  } catch {
    throw errorWithCode('INVALID_ARGUMENT', 'baseUrl must be a valid URL');
  }
  if (url.protocol !== 'https:') {
    throw errorWithCode('INVALID_ARGUMENT', 'baseUrl must use https');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.bindings ?? {}),
  ...(ctx?.secret ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.req ?? ctx.request ?? {},
});

const resolveSettings = (ctx = {}) => {
  const tlsInsecure = [
    ctx.config?.skipTlsVerify,
    ctx.config?.tlsInsecureSkipVerify,
    ctx.config?.insecureSkipVerify,
    ctx.bindings?.skipTlsVerify,
    ctx.bindings?.tlsInsecureSkipVerify,
    ctx.bindings?.insecureSkipVerify,
  ].some((value) => value === true);
  if (tlsInsecure) {
    throw errorWithCode('INVALID_ARGUMENT', 'TLS certificate verification cannot be disabled');
  }
  return {
    baseUrl: normalizeBaseUrl(ctx.config?.baseUrl ?? ctx.bindings?.baseUrl),
    timeoutMs: normalizeTimeoutMs(
      firstDefined(ctx.config?.timeoutMs, ctx.config?.timeout_ms, ctx.bindings?.timeoutMs, ctx.limits?.timeoutMs),
      DEFAULT_TIMEOUT_MS,
    ),
    headers: (ctx.config?.headers ?? ctx.bindings?.headers) ?? {},
    dispatcher: undefined,
    accessSecret: requiredString(ctx.secret?.accessSecret ?? ctx.secret?.access_secret, 'accessSecret'),
    oauthToken: asString(ctx.secret?.oauthToken ?? ctx.secret?.oauth_token),
    fetchImpl: ctx.fetchImpl ?? globalThis.fetch,
    meta: ctx.meta ?? {},
  };
};

const resolveOauthToken = (settings, request = {}) => (
  asString(request.oauth_token ?? request.oauthToken) || settings.oauthToken
);

const buildHeaders = (settings, { oauthToken, multipart = false } = {}) => {
  const meta = settings.meta ?? {};
  const headers = {
    ...(settings.headers && typeof settings.headers === 'object' ? settings.headers : {}),
    Authorization: `Bearer ${settings.accessSecret}`,
    'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
    'User-Agent': 'chaitin-cosmos',
    'x-engine-instance': meta.instance_id || meta.instanceId || 'unknown',
    'x-request-id': meta.request_id || meta.requestId || 'unknown',
  };
  if (oauthToken) headers['X-OAuth-Token'] = oauthToken;
  if (!multipart) headers['Content-Type'] = 'application/json';
  return headers;
};

const parseResponse = async (response) => {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw errorWithCode(mapErrorCode(response.status), `Zhihu returned a non-JSON response with HTTP ${response.status}`);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw errorWithCode(mapErrorCode(response.status), `Zhihu returned an invalid JSON response with HTTP ${response.status}`);
  }
  const code = Number(pick(payload, 'Code', 'code'));
  if (!response.ok || (Number.isFinite(code) && code !== 0)) {
    const message = sanitizeMessage(pick(payload, 'Message', 'message', 'msg'))
      || `Zhihu request failed with HTTP ${response.status}`;
    throw errorWithCode(mapErrorCode(response.status, code), message);
  }
  if (!Number.isFinite(code)) {
    throw errorWithCode('UNKNOWN', 'Zhihu response is missing a numeric Code');
  }
  return { data: pick(payload, 'Data', 'data') ?? {} };
};

const callApi = async (settings, method, path, {
  query,
  body,
  oauthToken,
  multipart = false,
  mutation = false,
} = {}) => {
  const requestPath = query ? `${path}${query}` : path;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
  try {
    const response = await settings.fetchImpl(`${settings.baseUrl}${requestPath}`, {
      method,
      headers: buildHeaders(settings, { oauthToken, multipart }),
      body,
      dispatcher: settings.dispatcher,
      signal: controller.signal,
    });
    return await parseResponse(response);
  } catch (cause) {
    if (cause instanceof GrpcError) throw cause;
    const timedOut = isTimeoutError(cause);
    const reason = timedOut ? 'request timed out' : 'network request failed';
    const error = errorWithCode(timedOut ? 'DEADLINE_EXCEEDED' : 'UNAVAILABLE', mutation ? `${reason}; mutation result may be ambiguous` : reason);
    error.ambiguous = mutation;
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const logInfo = (meta, action, payload) => {
  const prefix = `[${PREFIX}][${action}]`;
  try {
    console.log(prefix, JSON.stringify(payload));
  } catch {
    console.log(prefix, payload);
  }
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
const data = (value) => ({ data: value ?? {} });
const wrap = (handler) => async (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const settings = resolveSettings(callCtx);
  return handler(settings, callCtx.req, callCtx.meta);
};

export const handlers = {
  [METHODS.CHECK_CONNECTIVITY]: wrap(async (settings) => {
    try {
      await callApi(settings, 'GET', '/api/v1/content/hot_list', { query: '?Limit=1' });
      return { reachable: true, message: 'Zhihu credentials accepted' };
    } catch (error) {
      return { reachable: false, message: String(error?.message ?? 'request failed').slice(0, 240) };
    }
  }),
  [METHODS.ZHIHU_SEARCH]: wrap(async (settings, req, meta) => {
    const query = buildZhihuSearchQuery(req);
    logInfo(meta, 'ZhihuSearch:start', { query: query.Query });
    const result = await callApi(settings, 'GET', '/api/v1/content/zhihu_search', { query: buildQuery(query) });
    logInfo(meta, 'ZhihuSearch:success', { query: query.Query });
    return data(result.data);
  }),
  [METHODS.GLOBAL_SEARCH]: wrap(async (settings, req, meta) => {
    const query = buildGlobalSearchQuery(req);
    logInfo(meta, 'GlobalSearch:start', { query: query.Query, searchDB: query.SearchDB });
    const result = await callApi(settings, 'GET', '/api/v1/content/global_search', { query: buildQuery(query) });
    logInfo(meta, 'GlobalSearch:success', { query: query.Query });
    return data(result.data);
  }),
  [METHODS.GET_HOT_LIST]: wrap(async (settings, req) => {
    const result = await callApi(settings, 'GET', '/api/v1/content/hot_list', { query: buildQuery(buildHotListQuery(req)) });
    return data(result.data);
  }),
  [METHODS.GET_QUOTA]: wrap(async (settings, req) => {
    const result = await callApi(settings, 'GET', '/api/v1/quota', { query: buildQuery(buildGetQuotaQuery(req)) });
    return data(result.data);
  }),
  [METHODS.LIST_KNOWLEDGE_BASES]: wrap(async (settings, req) => {
    const result = await callApi(settings, 'GET', '/api/v1/knowledge/bases', { query: buildQuery(buildKnowledgeBasesQuery(req)) });
    return data(result.data);
  }),
  [METHODS.LIST_KNOWLEDGE_BASE_ITEMS]: wrap(async (settings, req) => {
    const baseId = requiredString(req.knowledge_base_id ?? req.knowledgeBaseId, 'knowledge_base_id');
    const result = await callApi(settings, 'GET', `/api/v1/knowledge/bases/${encodeURIComponent(baseId)}/items`, {
      query: buildQuery(buildKnowledgeBaseItemsQuery(req)),
    });
    return data(result.data);
  }),
  [METHODS.UPLOAD_KNOWLEDGE_FILE]: wrap(async (settings, req) => {
    const fileName = requiredString(req.file_name ?? req.fileName, 'file_name', 255);
    const knowledgeBaseId = asString(req.knowledge_base_id ?? req.knowledgeBaseId);
    const form = buildUploadForm(req.file_content ?? req.fileContent, fileName, knowledgeBaseId);
    const result = await callApi(settings, 'POST', '/api/v1/knowledge/files', {
      body: form,
      multipart: true,
      mutation: true,
    });
    return data(result.data);
  }),
  [METHODS.SEARCH_KNOWLEDGE]: wrap(async (settings, req) => {
    const result = await callApi(settings, 'POST', '/api/v1/knowledge/search', {
      body: JSON.stringify(buildKnowledgeSearchBody(req)),
    });
    return data(result.data);
  }),
  [METHODS.GET_USER_CONTENTS]: wrap(async (settings, req) => {
    const result = await callApi(settings, 'GET', '/api/v1/user/contents', {
      query: buildQuery(buildUserContentsQuery(req)),
      oauthToken: resolveOauthToken(settings, req),
    });
    return data(result.data);
  }),
  [METHODS.GET_USER_FOLLOWEES]: wrap(async (settings, req) => {
    const result = await callApi(settings, 'GET', '/api/v1/user/followees', {
      query: buildQuery(buildUserFolloweesQuery(req)),
      oauthToken: resolveOauthToken(settings, req),
    });
    return data(result.data);
  }),
  [METHODS.GET_USER_COLLECTIONS]: wrap(async (settings, req) => {
    const result = await callApi(settings, 'GET', '/api/v1/user/collections', {
      query: buildQuery(buildUserCollectionsQuery(req)),
      oauthToken: resolveOauthToken(settings, req),
    });
    return data(result.data);
  }),
  [METHODS.GET_USER_FAVLISTS]: wrap(async (settings, req) => {
    const result = await callApi(settings, 'GET', '/api/v1/user/favlists', {
      query: buildQuery(buildUserFavlistsQuery(req)),
      oauthToken: resolveOauthToken(settings, req),
    });
    return data(result.data);
  }),
  [METHODS.GET_FAVLIST_CONTENTS]: wrap(async (settings, req) => {
    const result = await callApi(settings, 'GET', '/api/v1/user/favlist_contents', {
      query: buildQuery(buildFavlistContentsQuery(req)),
      oauthToken: resolveOauthToken(settings, req),
    });
    return data(result.data);
  }),
};

export const _test = {
  buildFavlistContentsQuery,
  buildGlobalSearchQuery,
  buildGetQuotaQuery,
  buildHotListQuery,
  buildHeaders,
  buildKnowledgeBasesQuery,
  buildKnowledgeBaseItemsQuery,
  buildKnowledgeSearchBody,
  buildQuery,
  buildUploadForm,
  buildUserCollectionsQuery,
  buildUserContentsQuery,
  buildUserFavlistsQuery,
  buildUserFolloweesQuery,
  buildZhihuSearchQuery,
  callApi,
  enumValue,
  errorWithCode,
  firstDefined,
  hasOwn,
  isTimeoutError,
  logInfo,
  mapErrorCode,
  mergedBindings,
  nonNegativeInteger,
  normalizeBaseUrl,
  offsetParam,
  parseResponse,
  pick,
  resolveCallContext,
  resolveOauthToken,
  resolveSettings,
  requiredString,
  sanitizeMessage,
  stringArray,
  toBytes,
};
