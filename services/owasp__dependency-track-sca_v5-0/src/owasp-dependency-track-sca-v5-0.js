import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const METHOD_LIST_PROJECTS_PATH = '/OWASP_DependencyTrack_SCA_V5.OWASP_DependencyTrack_SCA_V5/ListProjects';
export const METHOD_CREATE_PROJECT_PATH = '/OWASP_DependencyTrack_SCA_V5.OWASP_DependencyTrack_SCA_V5/CreateProject';
export const METHOD_GET_PROJECT_METRICS_PATH = '/OWASP_DependencyTrack_SCA_V5.OWASP_DependencyTrack_SCA_V5/GetProjectMetrics';
export const METHOD_UPLOAD_BOM_PATH = '/OWASP_DependencyTrack_SCA_V5.OWASP_DependencyTrack_SCA_V5/UploadBom';
export const METHOD_LIST_FINDINGS_PATH = '/OWASP_DependencyTrack_SCA_V5.OWASP_DependencyTrack_SCA_V5/ListFindings';

export const METHOD_LIST_PROJECTS_FULL = 'OWASP_DependencyTrack_SCA_V5.OWASP_DependencyTrack_SCA_V5/ListProjects';
export const METHOD_CREATE_PROJECT_FULL = 'OWASP_DependencyTrack_SCA_V5.OWASP_DependencyTrack_SCA_V5/CreateProject';
export const METHOD_GET_PROJECT_METRICS_FULL = 'OWASP_DependencyTrack_SCA_V5.OWASP_DependencyTrack_SCA_V5/GetProjectMetrics';
export const METHOD_UPLOAD_BOM_FULL = 'OWASP_DependencyTrack_SCA_V5.OWASP_DependencyTrack_SCA_V5/UploadBom';
export const METHOD_LIST_FINDINGS_FULL = 'OWASP_DependencyTrack_SCA_V5.OWASP_DependencyTrack_SCA_V5/ListFindings';

export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_API_PREFIX = '/api/v1';

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

const reqField = (req = {}, snakeName, camelName) => firstDefined(req[snakeName], req[camelName]);

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

const toOptionalInt = (value, options = {}) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = Number(raw);
  if (!Number.isInteger(num) || Number.isNaN(num)) return undefined;
  if (options.min !== undefined && num < options.min) return undefined;
  return num;
};

const toOptionalBool = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') {
    if (raw === 1) return true;
    if (raw === 0) return false;
    return undefined;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return undefined;
};

const normalizeBaseUrl = (value) => {
  const raw = toTrimmedString(value);
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.replace(/\/+$/, '');
};

const normalizeApiPrefix = (value) => {
  const raw = toTrimmedString(value) || DEFAULT_API_PREFIX;
  return `/${raw.replace(/^\/+|\/+$/g, '')}`;
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
  bindings.dependency_track_base_url,
  bindings.baseUrl,
  bindings.restBaseUrl,
));

const resolveApiKey = (bindings = {}) => toTrimmedString(firstDefined(
  bindings.dependency_track_api_key,
  bindings.apiKey,
  bindings.xApiKey,
));

const resolveTimeoutMs = (ctx = {}) => {
  const raw = Number(firstDefined(ctx.limits?.timeoutMs, ctx.bindings?.timeoutMs, DEFAULT_TIMEOUT_MS));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

const parseHeaders = (value) => {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      return {};
    }
  }
  return {};
};

const tlsSkipRequested = (bindings = {}) => (
  Boolean(bindings.skipTlsVerify || bindings.tlsInsecureSkipVerify || bindings.insecureSkipVerify)
);

const assertSupportedTlsConfig = (bindings = {}) => {
  if (!tlsSkipRequested(bindings)) return;
  throw errorWithCode(
    'INVALID_ARGUMENT',
    'skipTlsVerify is not supported by this service; use a trusted TLS certificate for the Dependency-Track endpoint',
  );
};

const makeTimeoutSignal = (timeoutMs) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeoutId) };
};

const requireBaseUrl = (ctx = {}) => {
  const baseUrl = resolveBaseUrl(ctx.bindings || {});
  if (!baseUrl) throw errorWithCode('INVALID_ARGUMENT', 'dependency_track_base_url is required in bindings');
  return baseUrl;
};

const requireApiKey = (ctx = {}) => {
  const apiKey = resolveApiKey(ctx.bindings || {});
  if (!apiKey) throw errorWithCode('INVALID_ARGUMENT', 'dependency_track_api_key is required in bindings');
  return apiKey;
};

const requireString = (value, fieldName) => {
  const text = toTrimmedString(value);
  if (!text) throw errorWithCode('INVALID_ARGUMENT', `${fieldName} is required`);
  return text;
};

const encodeQueryPairs = (query = {}) => {
  const parts = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.join('&');
};

const buildUrl = (baseUrl, apiPrefix, path, query) => {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const prefix = normalizeApiPrefix(apiPrefix);
  const normalizedPath = String(path || '').replace(/^\/+/, '');
  const qs = encodeQueryPairs(query);
  const joined = `${base}${prefix}/${normalizedPath}`;
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
  const payload = {
    code,
    message,
    http_status: Number(options.httpStatus ?? 0),
    raw_body: String(options.rawBody ?? ''),
  };
  if (options.reason) payload.reason = String(options.reason);
  if (options.rawJson !== undefined) payload.raw_json = options.rawJson;
  throw errorWithCode(code, JSON.stringify(payload));
};

const mapHttpStatusToGrpcCode = (status) => {
  if (status === 401 || status === 403) return 'PERMISSION_DENIED';
  if (status >= 400 && status < 500) return 'FAILED_PRECONDITION';
  if (status >= 500) return 'UNAVAILABLE';
  return 'UNAVAILABLE';
};

const buildRequestHeaders = (ctx = {}, contentType) => {
  const headers = {
    Accept: 'application/json',
    ...parseHeaders(ctx.bindings?.headers),
    'X-Api-Key': requireApiKey(ctx),
  };
  if (contentType) headers['Content-Type'] = contentType;
  return headers;
};

const fetchUpstream = async (url, ctx = {}, options = {}) => {
  const bindings = ctx.bindings || {};
  assertSupportedTlsConfig(bindings);
  const headers = buildRequestHeaders(ctx, options.contentType);
  const timeout = makeTimeoutSignal(resolveTimeoutMs(ctx));
  let res;
  let httpStatus = 0;
  let rawBody;
  try {
    res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body,
      signal: timeout.signal,
    });
    httpStatus = Number(res?.status || 0);
    rawBody = await res.text();
  } catch (err) {
    throwStructuredError('UNAVAILABLE', httpStatus
      ? 'dependency-track upstream response read failed'
      : 'dependency-track upstream request failed', {
      httpStatus,
      rawBody: '',
      reason: err?.cause?.message || err?.message || (httpStatus ? 'response read failed' : 'fetch failed'),
    });
  } finally {
    timeout.clear();
  }
  return {
    httpStatus,
    rawBody: String(rawBody ?? ''),
    totalCount: readHeader(res?.headers, 'X-Total-Count'),
  };
};

const readHeader = (headers, name) => {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) ?? headers.get(name.toLowerCase()) ?? '';
  return headers[name] ?? headers[name.toLowerCase()] ?? '';
};

const parseDependencyTrackResponse = ({ httpStatus, rawBody }) => {
  const trimmed = String(rawBody ?? '').trim();
  const parsed = trimmed ? tryParseJson(trimmed) : { ok: true, value: null };
  if (httpStatus < 200 || httpStatus >= 300) {
    throwStructuredError(mapHttpStatusToGrpcCode(httpStatus), 'dependency-track upstream http failure', {
      httpStatus,
      rawBody,
      rawJson: parsed.ok ? parsed.value : undefined,
      reason: `upstream http ${httpStatus}`,
    });
  }
  if (!parsed.ok) {
    throwStructuredError('UNKNOWN', 'dependency-track response is not valid JSON', {
      httpStatus,
      rawBody,
      reason: 'response is not valid JSON',
    });
  }
  return {
    http_status: httpStatus,
    raw_body: rawBody,
    json: parsed.value,
    raw_json: toValue(parsed.value),
  };
};

const parseListResponse = (result) => {
  const parsed = parseDependencyTrackResponse(result);
  const json = parsed.json;
  const results = Array.isArray(json)
    ? json
    : Array.isArray(json?.results)
      ? json.results
      : [];
  const totalCount = toOptionalInt(result.totalCount, { min: 0 });
  return {
    http_status: parsed.http_status,
    raw_body: parsed.raw_body,
    count: totalCount ?? toOptionalInt(json?.count, { min: 0 }) ?? results.length,
    results: results.map((item) => toValue(item) ?? { nullValue: 'NULL_VALUE' }),
    raw_json: parsed.raw_json,
  };
};

const parseObjectResponse = (result) => {
  const parsed = parseDependencyTrackResponse(result);
  return {
    http_status: parsed.http_status,
    raw_body: parsed.raw_body,
    raw_json: parsed.raw_json,
  };
};

const commonPagingQuery = (req = {}) => ({
  limit: toOptionalInt(req.limit, { min: 1 }),
  offset: toOptionalInt(req.offset, { min: 0 }),
});

const apiPrefix = (ctx = {}) => ctx.bindings?.apiPrefix || DEFAULT_API_PREFIX;

const handleListProjects = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const tag = toTrimmedString(req.tag);
  const classifier = toTrimmedString(req.classifier);
  const path = tag
    ? `/project/tag/${encodeURIComponent(tag)}`
    : classifier
      ? `/project/classifier/${encodeURIComponent(classifier)}`
      : '/project';
  const url = buildUrl(requireBaseUrl(callCtx), apiPrefix(callCtx), path, {
    ...commonPagingQuery(req),
    name: toTrimmedString(req.name),
    excludeInactive: toOptionalBool(reqField(req, 'exclude_inactive', 'excludeInactive')),
    onlyRoot: toOptionalBool(reqField(req, 'only_root', 'onlyRoot')),
    notAssignedToTeamWithUuid: toTrimmedString(reqField(req, 'not_assigned_to_team_with_uuid', 'notAssignedToTeamWithUuid')),
  });
  return parseListResponse(await fetchUpstream(url, callCtx));
};

const normalizeStringArray = (values = []) => {
  if (!Array.isArray(values)) return [];
  return values.map((item) => toTrimmedString(item)).filter(Boolean);
};

const buildProjectBody = (req = {}) => {
  const body = {
    name: requireString(req.name, 'name'),
  };
  const version = toTrimmedString(req.version);
  const classifier = toTrimmedString(req.classifier);
  const parentUuid = toTrimmedString(reqField(req, 'parent_uuid', 'parentUuid'));
  const description = toTrimmedString(req.description);
  const tags = normalizeStringArray(req.tags);
  const active = toOptionalBool(req.active);
  if (version) body.version = version;
  if (classifier) body.classifier = classifier;
  if (parentUuid) body.parent = { uuid: parentUuid };
  if (description) body.description = description;
  if (tags.length) body.tags = tags.map((name) => ({ name }));
  if (active !== undefined) body.active = active;
  return body;
};

const handleCreateProject = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const url = buildUrl(requireBaseUrl(callCtx), apiPrefix(callCtx), '/project');
  return parseObjectResponse(await fetchUpstream(url, callCtx, {
    method: 'PUT',
    contentType: 'application/json',
    body: JSON.stringify(buildProjectBody(req)),
  }));
};

const handleGetProjectMetrics = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const projectUuid = requireString(reqField(req, 'project_uuid', 'projectUuid'), 'project_uuid');
  const url = buildUrl(requireBaseUrl(callCtx), apiPrefix(callCtx), `/metrics/project/${encodeURIComponent(projectUuid)}/current`);
  return parseObjectResponse(await fetchUpstream(url, callCtx));
};

const buildBomBody = (req = {}) => {
  const bom = requireString(req.bom, 'bom');
  const projectUuid = toTrimmedString(reqField(req, 'project_uuid', 'projectUuid'));
  const projectName = toTrimmedString(reqField(req, 'project_name', 'projectName'));
  const projectVersion = toTrimmedString(reqField(req, 'project_version', 'projectVersion'));
  if (!projectUuid && (!projectName || !projectVersion)) {
    throw errorWithCode('INVALID_ARGUMENT', 'project_uuid or both project_name and project_version are required');
  }
  const body = {
    bom,
    autoCreate: toOptionalBool(reqField(req, 'auto_create', 'autoCreate')) ?? Boolean(!projectUuid),
  };
  if (projectUuid) body.project = projectUuid;
  if (projectName) body.projectName = projectName;
  if (projectVersion) body.projectVersion = projectVersion;
  return body;
};

const handleUploadBom = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const url = buildUrl(requireBaseUrl(callCtx), apiPrefix(callCtx), '/bom');
  return parseObjectResponse(await fetchUpstream(url, callCtx, {
    method: 'PUT',
    contentType: 'application/json',
    body: JSON.stringify(buildBomBody(req)),
  }));
};

const handleListFindings = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const projectUuid = requireString(reqField(req, 'project_uuid', 'projectUuid'), 'project_uuid');
  const url = buildUrl(requireBaseUrl(callCtx), apiPrefix(callCtx), `/finding/project/${encodeURIComponent(projectUuid)}`, {
    ...commonPagingQuery(req),
    suppressed: toOptionalBool(req.suppressed),
    source: toTrimmedString(req.source),
  });
  return parseListResponse(await fetchUpstream(url, callCtx));
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_LIST_PROJECTS_PATH]: async (req) => handleListProjects(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_CREATE_PROJECT_PATH]: async (req) => handleCreateProject(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_GET_PROJECT_METRICS_PATH]: async (req) => handleGetProjectMetrics(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_UPLOAD_BOM_PATH]: async (req) => handleUploadBom(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_LIST_FINDINGS_PATH]: async (req) => handleListFindings(req ?? callCtx.req ?? {}, callCtx),
  };
}

const wrapHandler = (handler) => async (reqOrCtx = {}, maybeCtx) => {
  const { req, ctx } = resolveHandlerArgs(reqOrCtx, maybeCtx);
  return handler(req, ctx);
};

export const handlers = {
  [METHOD_LIST_PROJECTS_FULL]: wrapHandler(handleListProjects),
  [METHOD_CREATE_PROJECT_FULL]: wrapHandler(handleCreateProject),
  [METHOD_GET_PROJECT_METRICS_FULL]: wrapHandler(handleGetProjectMetrics),
  [METHOD_UPLOAD_BOM_FULL]: wrapHandler(handleUploadBom),
  [METHOD_LIST_FINDINGS_FULL]: wrapHandler(handleListFindings),
};

export const _test = {
  apiPrefix,
  assertSupportedTlsConfig,
  buildBomBody,
  buildProjectBody,
  buildRequestHeaders,
  buildUrl,
  commonPagingQuery,
  encodeQueryPairs,
  makeTimeoutSignal,
  mergedBindings,
  normalizeApiPrefix,
  normalizeBaseUrl,
  parseHeaders,
  resolveApiKey,
  resolveBaseUrl,
  toOptionalBool,
  toOptionalInt,
  toTrimmedString,
};
