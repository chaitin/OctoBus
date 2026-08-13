import { Buffer } from 'node:buffer';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const METHOD_LIST_WORKSPACES_PATH = '/InfobyteFaradayV522.Faraday/ListWorkspaces';
export const METHOD_CREATE_WORKSPACE_PATH = '/InfobyteFaradayV522.Faraday/CreateWorkspace';
export const METHOD_LIST_HOSTS_PATH = '/InfobyteFaradayV522.Faraday/ListHosts';
export const METHOD_CREATE_HOST_PATH = '/InfobyteFaradayV522.Faraday/CreateHost';
export const METHOD_LIST_VULNERABILITIES_PATH = '/InfobyteFaradayV522.Faraday/ListVulnerabilities';
export const METHOD_GET_VULNERABILITY_PATH = '/InfobyteFaradayV522.Faraday/GetVulnerability';
export const METHOD_CREATE_VULNERABILITY_PATH = '/InfobyteFaradayV522.Faraday/CreateVulnerability';

export const METHOD_LIST_WORKSPACES_FULL = 'InfobyteFaradayV522.Faraday/ListWorkspaces';
export const METHOD_CREATE_WORKSPACE_FULL = 'InfobyteFaradayV522.Faraday/CreateWorkspace';
export const METHOD_LIST_HOSTS_FULL = 'InfobyteFaradayV522.Faraday/ListHosts';
export const METHOD_CREATE_HOST_FULL = 'InfobyteFaradayV522.Faraday/CreateHost';
export const METHOD_LIST_VULNERABILITIES_FULL = 'InfobyteFaradayV522.Faraday/ListVulnerabilities';
export const METHOD_GET_VULNERABILITY_FULL = 'InfobyteFaradayV522.Faraday/GetVulnerability';
export const METHOD_CREATE_VULNERABILITY_FULL = 'InfobyteFaradayV522.Faraday/CreateVulnerability';

export const DEFAULT_TIMEOUT_MS = 5000;

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

const field = (obj, snakeName, camelName = snakeName) => firstDefined(obj?.[snakeName], obj?.[camelName]);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const protobufValueToPlain = (value) => {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.map((item) => protobufValueToPlain(item));
  if (typeof value !== 'object') return value;

  if (value.kind && typeof value.kind === 'object' && hasOwn(value.kind, 'case')) {
    return protobufValueToPlain(value.kind.value);
  }
  if (hasOwn(value, 'stringValue')) return value.stringValue;
  if (hasOwn(value, 'numberValue')) return value.numberValue;
  if (hasOwn(value, 'boolValue')) return value.boolValue;
  if (hasOwn(value, 'nullValue')) return null;
  if (hasOwn(value, 'listValue')) return protobufValueToPlain(value.listValue?.values ?? []);
  if (hasOwn(value, 'structValue')) return protobufValueToPlain(value.structValue?.fields ?? {});
  if (hasOwn(value, 'fields')) {
    const out = {};
    for (const [key, innerValue] of Object.entries(value.fields ?? {})) {
      out[key] = protobufValueToPlain(innerValue);
    }
    return out;
  }
  if (hasOwn(value, 'values')) return protobufValueToPlain(value.values ?? []);
  const entries = Object.entries(value);
  if (entries.length > 0 && entries.every(([key]) => /^\d+$/.test(key))) {
    return entries
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([, innerValue]) => protobufValueToPlain(innerValue));
  }

  const out = {};
  for (const [key, innerValue] of entries) {
    out[key] = protobufValueToPlain(innerValue);
  }
  return out;
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
  bindings.faraday_base_url,
  bindings.baseUrl,
  bindings.restBaseUrl,
));

const resolveUsername = (bindings = {}) => toTrimmedString(firstDefined(
  bindings.faraday_username,
  bindings.username,
));

const resolvePassword = (bindings = {}) => {
  const value = firstDefined(bindings.faraday_password, bindings.password);
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return '';
  return String(raw);
};

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
    'skipTlsVerify is not supported by this service; use a trusted TLS certificate for the Faraday endpoint',
  );
};

const makeTimeoutSignal = (timeoutMs) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeoutId) };
};

const requireBaseUrl = (ctx = {}) => {
  const baseUrl = resolveBaseUrl(ctx.bindings || {});
  if (!baseUrl) throw errorWithCode('INVALID_ARGUMENT', 'faraday_base_url is required in bindings');
  return baseUrl;
};

const requireUsername = (ctx = {}) => {
  const username = resolveUsername(ctx.bindings || {});
  if (!username) throw errorWithCode('INVALID_ARGUMENT', 'faraday_username is required in bindings');
  return username;
};

const requirePassword = (ctx = {}) => {
  const password = resolvePassword(ctx.bindings || {});
  if (!password) throw errorWithCode('INVALID_ARGUMENT', 'faraday_password is required in bindings');
  return password;
};

const requirePositiveId = (value, fieldName) => {
  const id = toOptionalInt(value, { min: 1 });
  if (id === undefined) throw errorWithCode('INVALID_ARGUMENT', `${fieldName} must be a positive integer`);
  return id;
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

const buildUrl = (baseUrl, path, query) => {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const normalizedPath = String(path || '').replace(/^\/+/, '');
  const qs = encodeQueryPairs(query);
  const joined = `${base}/${normalizedPath}`;
  return qs ? `${joined}?${qs}` : joined;
};

const encodePathSegment = (value) => {
  const segment = requireString(value, 'workspace_name');
  if (segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\')) {
    throw errorWithCode('INVALID_ARGUMENT', 'workspace_name must be a safe single path segment');
  }
  return encodeURIComponent(segment);
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

const basicAuthHeader = (ctx = {}) => {
  const username = requireUsername(ctx);
  const password = requirePassword(ctx);
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
};

const buildRequestHeaders = (ctx = {}, extra = {}) => ({
  Accept: 'application/json',
  ...parseHeaders(ctx.bindings?.headers),
  ...extra,
  Authorization: basicAuthHeader(ctx),
});

const requestUpstream = async (url, ctx = {}, options = {}) => {
  const bindings = ctx.bindings || {};
  assertSupportedTlsConfig(bindings);

  const method = options.method || 'GET';
  const headers = buildRequestHeaders(ctx, options.headers);
  const init = {
    method,
    headers,
    signal: undefined,
  };
  if (options.body !== undefined) init.body = options.body;

  const timeout = makeTimeoutSignal(resolveTimeoutMs(ctx));
  init.signal = timeout.signal;

  let res;
  let httpStatus = 0;
  try {
    res = await fetch(url, init);
    httpStatus = Number(res?.status || 0);
    const rawBody = String(await res.text() ?? '');
    return { httpStatus, rawBody };
  } catch (err) {
    throwStructuredError('UNAVAILABLE', 'faraday upstream request failed', {
      httpStatus,
      rawBody: '',
      reason: err?.cause?.message || err?.message || 'fetch failed',
    });
  } finally {
    timeout.clear();
  }
};

const fetchUpstream = (url, ctx = {}) => requestUpstream(url, ctx);

const sendJsonUpstream = (url, ctx = {}, method, body = {}) => requestUpstream(url, ctx, {
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const parseFaradayResponse = ({ httpStatus, rawBody }) => {
  const trimmed = String(rawBody ?? '').trim();
  const parsed = trimmed ? tryParseJson(trimmed) : { ok: false };
  if (httpStatus < 200 || httpStatus >= 300) {
    throwStructuredError(mapHttpStatusToGrpcCode(httpStatus), 'faraday upstream http failure', {
      httpStatus,
      rawBody,
      rawJson: parsed.ok ? parsed.value : undefined,
      reason: `upstream http ${httpStatus}`,
    });
  }
  if (!parsed.ok) {
    throwStructuredError('UNKNOWN', 'faraday response is not valid JSON', {
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

const extractResults = (json) => {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.results)) return json.results;
  if (Array.isArray(json?.rows)) return json.rows;
  if (Array.isArray(json?.items)) return json.items;
  if (Array.isArray(json?.vulnerabilities)) return json.vulnerabilities;
  return [];
};

const parseListResponse = (result) => {
  const parsed = parseFaradayResponse(result);
  const results = extractResults(parsed.json);
  return {
    http_status: parsed.http_status,
    raw_body: parsed.raw_body,
    count: toOptionalInt(parsed.json?.count, { min: 0 })
      ?? toOptionalInt(parsed.json?.total, { min: 0 })
      ?? results.length,
    results: results.map((item) => toValue(item) ?? { nullValue: 'NULL_VALUE' }),
    raw_json: parsed.raw_json,
  };
};

const parseObjectResponse = (result) => {
  const parsed = parseFaradayResponse(result);
  return {
    http_status: parsed.http_status,
    raw_body: parsed.raw_body,
    raw_json: parsed.raw_json,
  };
};

const maybeSet = (body, key, value) => {
  if (value === undefined || value === null || value === '') return;
  body[key] = value;
};

const maybeSetString = (body, key, value) => maybeSet(body, key, toTrimmedString(value));
const maybeSetInt = (body, key, value, options = {}) => maybeSet(body, key, toOptionalInt(value, options));
const maybeSetBool = (body, key, value) => maybeSet(body, key, toOptionalBool(value));

const applyExtraFields = (body, extraFields) => {
  const extra = protobufValueToPlain(extraFields);
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    for (const [key, value] of Object.entries(extra)) {
      if (!hasOwn(body, key)) body[key] = value;
    }
  }
  return body;
};

const commonWorkspaceQuery = (req = {}) => ({
  histogram: toOptionalBool(req.histogram),
  histogram_days: toOptionalInt(field(req, 'histogram_days', 'histogramDays'), { min: 1 }),
});

const handleListWorkspaces = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const url = buildUrl(requireBaseUrl(callCtx), '/_api/v3/ws', commonWorkspaceQuery(req));
  return parseListResponse(await fetchUpstream(url, callCtx));
};

const handleCreateWorkspace = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const body = applyExtraFields({
    name: requireString(req.name, 'name'),
  }, field(req, 'extra_fields', 'extraFields'));
  maybeSetString(body, 'description', req.description);
  maybeSetString(body, 'customer', req.customer);
  maybeSetBool(body, 'active', req.active);
  maybeSetBool(body, 'public', req.public);
  maybeSetInt(body, 'importance', req.importance);
  const url = buildUrl(requireBaseUrl(callCtx), '/_api/v3/ws');
  return parseObjectResponse(await sendJsonUpstream(url, callCtx, 'POST', body));
};

const handleListHosts = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const workspace = encodePathSegment(field(req, 'workspace_name', 'workspaceName'));
  const url = buildUrl(requireBaseUrl(callCtx), `/_api/v3/ws/${workspace}/hosts`, {
    stats: toOptionalBool(req.stats),
  });
  return parseListResponse(await fetchUpstream(url, callCtx));
};

const handleCreateHost = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const workspace = encodePathSegment(field(req, 'workspace_name', 'workspaceName'));
  const body = applyExtraFields({
    description: requireString(req.description, 'description'),
  }, field(req, 'extra_fields', 'extraFields'));
  maybeSetString(body, 'ip', req.ip);
  maybeSetString(body, 'os', req.os);
  maybeSetString(body, 'mac', req.mac);
  maybeSetBool(body, 'owned', req.owned);
  maybeSetInt(body, 'importance', req.importance);
  const hostnames = protobufValueToPlain(req.hostnames);
  if (hostnames !== undefined) body.hostnames = hostnames;
  const metadata = protobufValueToPlain(req.metadata);
  if (metadata !== undefined) body.metadata = metadata;
  const url = buildUrl(requireBaseUrl(callCtx), `/_api/v3/ws/${workspace}/hosts`);
  return parseObjectResponse(await sendJsonUpstream(url, callCtx, 'POST', body));
};

const handleListVulnerabilities = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const workspace = encodePathSegment(field(req, 'workspace_name', 'workspaceName'));
  const url = buildUrl(requireBaseUrl(callCtx), `/_api/v3/ws/${workspace}/vulns`);
  return parseListResponse(await fetchUpstream(url, callCtx));
};

const handleGetVulnerability = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const workspace = encodePathSegment(field(req, 'workspace_name', 'workspaceName'));
  const id = requirePositiveId(field(req, 'object_id', 'objectId'), 'object_id');
  const url = buildUrl(requireBaseUrl(callCtx), `/_api/v3/ws/${workspace}/vulns/${id}`);
  return parseObjectResponse(await fetchUpstream(url, callCtx));
};

const handleCreateVulnerability = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const workspace = encodePathSegment(field(req, 'workspace_name', 'workspaceName'));
  const body = applyExtraFields({
    name: requireString(req.name, 'name'),
    severity: requireString(req.severity, 'severity'),
    type: requireString(req.type, 'type'),
  }, field(req, 'extra_fields', 'extraFields'));
  maybeSetString(body, 'desc', req.desc);
  maybeSetString(body, 'data', req.data);
  maybeSetString(body, 'resolution', req.resolution);
  maybeSetString(body, 'status', req.status);
  maybeSetBool(body, 'confirmed', req.confirmed);
  maybeSetString(body, 'tool', req.tool);
  maybeSetString(body, 'external_id', field(req, 'external_id', 'externalId'));
  maybeSetString(body, 'parent_type', field(req, 'parent_type', 'parentType'));
  maybeSetString(body, 'website', req.website);
  maybeSetString(body, 'path', req.path);
  maybeSetString(body, 'method', req.method);
  maybeSetString(body, 'request', req.request);
  maybeSetString(body, 'response', req.response);
  maybeSetInt(body, 'status_code', field(req, 'status_code', 'statusCode'), { min: 100 });

  const parent = protobufValueToPlain(req.parent);
  if (parent !== undefined) body.parent = parent;
  const cve = protobufValueToPlain(req.cve);
  if (cve !== undefined) body.cve = cve;
  const cwe = protobufValueToPlain(req.cwe);
  if (cwe !== undefined) body.cwe = cwe;
  const refs = protobufValueToPlain(req.refs);
  if (refs !== undefined) body.refs = refs;
  const metadata = protobufValueToPlain(req.metadata);
  if (metadata !== undefined) body.metadata = metadata;

  const url = buildUrl(requireBaseUrl(callCtx), `/_api/v3/ws/${workspace}/vulns`);
  return parseObjectResponse(await sendJsonUpstream(url, callCtx, 'POST', body));
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_LIST_WORKSPACES_PATH]: async (req) => handleListWorkspaces(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_CREATE_WORKSPACE_PATH]: async (req) => handleCreateWorkspace(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_LIST_HOSTS_PATH]: async (req) => handleListHosts(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_CREATE_HOST_PATH]: async (req) => handleCreateHost(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_LIST_VULNERABILITIES_PATH]: async (req) => handleListVulnerabilities(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_GET_VULNERABILITY_PATH]: async (req) => handleGetVulnerability(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_CREATE_VULNERABILITY_PATH]: async (req) => handleCreateVulnerability(req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_LIST_WORKSPACES_FULL]: (reqOrCtx, maybeCtx) => {
    const call = resolveHandlerArgs(reqOrCtx, maybeCtx);
    return handleListWorkspaces(call.req, call.ctx);
  },
  [METHOD_CREATE_WORKSPACE_FULL]: (reqOrCtx, maybeCtx) => {
    const call = resolveHandlerArgs(reqOrCtx, maybeCtx);
    return handleCreateWorkspace(call.req, call.ctx);
  },
  [METHOD_LIST_HOSTS_FULL]: (reqOrCtx, maybeCtx) => {
    const call = resolveHandlerArgs(reqOrCtx, maybeCtx);
    return handleListHosts(call.req, call.ctx);
  },
  [METHOD_CREATE_HOST_FULL]: (reqOrCtx, maybeCtx) => {
    const call = resolveHandlerArgs(reqOrCtx, maybeCtx);
    return handleCreateHost(call.req, call.ctx);
  },
  [METHOD_LIST_VULNERABILITIES_FULL]: (reqOrCtx, maybeCtx) => {
    const call = resolveHandlerArgs(reqOrCtx, maybeCtx);
    return handleListVulnerabilities(call.req, call.ctx);
  },
  [METHOD_GET_VULNERABILITY_FULL]: (reqOrCtx, maybeCtx) => {
    const call = resolveHandlerArgs(reqOrCtx, maybeCtx);
    return handleGetVulnerability(call.req, call.ctx);
  },
  [METHOD_CREATE_VULNERABILITY_FULL]: (reqOrCtx, maybeCtx) => {
    const call = resolveHandlerArgs(reqOrCtx, maybeCtx);
    return handleCreateVulnerability(call.req, call.ctx);
  },
};

export const _test = {
  applyExtraFields,
  assertSupportedTlsConfig,
  basicAuthHeader,
  buildRequestHeaders,
  buildUrl,
  commonWorkspaceQuery,
  encodePathSegment,
  encodeQueryPairs,
  errorWithCode,
  extractResults,
  fetchUpstream,
  field,
  firstDefined,
  grpcCodeFor,
  handleCreateHost,
  handleCreateVulnerability,
  handleCreateWorkspace,
  handleGetVulnerability,
  handleListHosts,
  handleListVulnerabilities,
  handleListWorkspaces,
  hasOwn,
  mapHttpStatusToGrpcCode,
  mergedBindings,
  normalizeBaseUrl,
  parseFaradayResponse,
  parseHeaders,
  parseListResponse,
  parseObjectResponse,
  protobufValueToPlain,
  requireBaseUrl,
  requirePassword,
  requirePositiveId,
  requireString,
  requireUsername,
  resolveBaseUrl,
  resolveCallContext,
  resolveHandlerArgs,
  resolvePassword,
  resolveTimeoutMs,
  resolveUsername,
  sendJsonUpstream,
  throwStructuredError,
  toOptionalBool,
  toOptionalInt,
  toTrimmedString,
  toValue,
  tryParseJson,
  unwrapScalar,
};
