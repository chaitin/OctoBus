import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const METHOD_LIST_PRODUCTS_PATH = '/DefectDojo.DefectDojo/ListProducts';
export const METHOD_LIST_ENGAGEMENTS_PATH = '/DefectDojo.DefectDojo/ListEngagements';
export const METHOD_LIST_FINDINGS_PATH = '/DefectDojo.DefectDojo/ListFindings';
export const METHOD_GET_FINDING_PATH = '/DefectDojo.DefectDojo/GetFinding';
export const METHOD_IMPORT_SCAN_PATH = '/DefectDojo.DefectDojo/ImportScan';
export const METHOD_REIMPORT_SCAN_PATH = '/DefectDojo.DefectDojo/ReimportScan';

export const METHOD_LIST_PRODUCTS_FULL = 'DefectDojo.DefectDojo/ListProducts';
export const METHOD_LIST_ENGAGEMENTS_FULL = 'DefectDojo.DefectDojo/ListEngagements';
export const METHOD_LIST_FINDINGS_FULL = 'DefectDojo.DefectDojo/ListFindings';
export const METHOD_GET_FINDING_FULL = 'DefectDojo.DefectDojo/GetFinding';
export const METHOD_IMPORT_SCAN_FULL = 'DefectDojo.DefectDojo/ImportScan';
export const METHOD_REIMPORT_SCAN_FULL = 'DefectDojo.DefectDojo/ReimportScan';

export const DEFAULT_TIMEOUT_MS = 1500;

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
  bindings.defectdojo_base_url,
  bindings.baseUrl,
  bindings.restBaseUrl,
));

const resolveApiKey = (bindings = {}) => toTrimmedString(firstDefined(
  bindings.defectdojo_api_key,
  bindings.apiKey,
  bindings.token,
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
    'skipTlsVerify is not supported by this service; use a trusted TLS certificate for the DefectDojo endpoint',
  );
};

const makeTimeoutSignal = (timeoutMs) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeoutId) };
};

const requireBaseUrl = (ctx = {}) => {
  const baseUrl = resolveBaseUrl(ctx.bindings || {});
  if (!baseUrl) throw errorWithCode('INVALID_ARGUMENT', 'defectdojo_base_url is required in bindings');
  return baseUrl;
};

const requireApiKey = (ctx = {}) => {
  const apiKey = resolveApiKey(ctx.bindings || {});
  if (!apiKey) throw errorWithCode('INVALID_ARGUMENT', 'defectdojo_api_key is required in bindings');
  return apiKey;
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

const escapeMultipartName = (value) => String(value ?? '').replaceAll('\\', '\\\\').replaceAll('"', '\\"');

const buildMultipartBody = (fields = {}, file = {}) => {
  const boundary = `----OctoBusDefectDojo${crypto.randomUUID().replaceAll('-', '')}`;
  const parts = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue;
    parts.push(`--${boundary}\r\n`);
    parts.push(`Content-Disposition: form-data; name="${escapeMultipartName(key)}"\r\n\r\n`);
    parts.push(`${String(value)}\r\n`);
  }
  parts.push(`--${boundary}\r\n`);
  parts.push(`Content-Disposition: form-data; name="file"; filename="${escapeMultipartName(file.name)}"\r\n`);
  parts.push(`Content-Type: ${file.contentType || 'application/octet-stream'}\r\n\r\n`);
  parts.push(String(file.content ?? ''));
  parts.push('\r\n');
  parts.push(`--${boundary}--\r\n`);
  return { body: parts.join(''), boundary };
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
  const payload = {
    code,
    message,
    http_status: Number(options.httpStatus ?? 0),
    raw_body: '',
    raw_body_length: rawBody.length,
  };
  if (options.reason) payload.reason = String(options.reason);
  throw errorWithCode(code, JSON.stringify(payload));
};

const mapHttpStatusToGrpcCode = (status) => {
  if (status === 401 || status === 403) return 'PERMISSION_DENIED';
  if (status >= 400 && status < 500) return 'FAILED_PRECONDITION';
  if (status >= 500) return 'UNAVAILABLE';
  return 'UNAVAILABLE';
};

const buildRequestHeaders = (ctx = {}) => ({
  Accept: 'application/json',
  ...parseHeaders(ctx.bindings?.headers),
  Authorization: `Token ${requireApiKey(ctx)}`,
});

const fetchUpstream = async (url, ctx = {}) => {
  const bindings = ctx.bindings || {};
  assertSupportedTlsConfig(bindings);
  const timeout = makeTimeoutSignal(resolveTimeoutMs(ctx));
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: buildRequestHeaders(ctx),
      signal: timeout.signal,
    });
  } catch (err) {
    if (err instanceof GrpcError) throw err;
    throwStructuredError('UNAVAILABLE', 'defectdojo upstream request failed', {
      httpStatus: 0,
      rawBody: '',
      reason: 'fetch failed',
    });
  } finally {
    timeout.clear();
  }

  const httpStatus = Number(res?.status || 0);
  let rawBody;
  try {
    rawBody = await res.text();
  } catch (err) {
    throwStructuredError('UNAVAILABLE', 'defectdojo upstream response read failed', {
      httpStatus,
      rawBody: '',
      reason: 'response read failed',
    });
  }
  return { httpStatus, rawBody: String(rawBody ?? '') };
};

const postMultipartUpstream = async (url, ctx = {}, fields = {}, file = {}) => {
  const bindings = ctx.bindings || {};
  assertSupportedTlsConfig(bindings);
  const timeout = makeTimeoutSignal(resolveTimeoutMs(ctx));
  const { body, boundary } = buildMultipartBody(fields, file);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        ...buildRequestHeaders(ctx),
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
      signal: timeout.signal,
    });
  } catch (err) {
    if (err instanceof GrpcError) throw err;
    throwStructuredError('UNAVAILABLE', 'defectdojo upstream request failed', {
      httpStatus: 0,
      rawBody: '',
      reason: 'fetch failed',
    });
  } finally {
    timeout.clear();
  }

  const httpStatus = Number(res?.status || 0);
  let rawBody;
  try {
    rawBody = await res.text();
  } catch (err) {
    throwStructuredError('UNAVAILABLE', 'defectdojo upstream response read failed', {
      httpStatus,
      rawBody: '',
      reason: 'response read failed',
    });
  }
  return { httpStatus, rawBody: String(rawBody ?? '') };
};

const parseDefectDojoResponse = ({ httpStatus, rawBody }) => {
  const trimmed = String(rawBody ?? '').trim();
  const parsed = trimmed ? tryParseJson(trimmed) : { ok: false };
  if (httpStatus < 200 || httpStatus >= 300) {
    throwStructuredError(mapHttpStatusToGrpcCode(httpStatus), 'defectdojo upstream http failure', {
      httpStatus,
      rawBody,
      rawJson: parsed.ok ? parsed.value : undefined,
      reason: `upstream http ${httpStatus}`,
    });
  }
  if (!parsed.ok) {
    throwStructuredError('UNKNOWN', 'defectdojo response is not valid JSON', {
      httpStatus,
      rawBody,
      reason: 'response is not valid JSON',
    });
  }
  return {
    http_status: httpStatus,
    raw_body: '',
    json: parsed.value,
    raw_json: undefined,
  };
};

const parseListResponse = (result) => {
  const parsed = parseDefectDojoResponse(result);
  const json = parsed.json;
  const results = Array.isArray(json)
    ? json
    : Array.isArray(json?.results)
      ? json.results
      : [];
  return {
    http_status: parsed.http_status,
    raw_body: parsed.raw_body,
    count: toOptionalInt(json?.count, { min: 0 }) ?? results.length,
    next: toTrimmedString(json?.next),
    previous: toTrimmedString(json?.previous),
    results: results.map((item) => toValue(item) ?? { nullValue: 'NULL_VALUE' }),
    raw_json: parsed.raw_json,
  };
};

const parseObjectResponse = (result) => {
  const parsed = parseDefectDojoResponse(result);
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

const handleListProducts = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const url = buildUrl(requireBaseUrl(callCtx), '/api/v2/products/', {
    ...commonPagingQuery(req),
    name: toTrimmedString(req.name),
    name__icontains: toTrimmedString(req.name_contains),
  });
  return parseListResponse(await fetchUpstream(url, callCtx));
};

const handleListEngagements = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const url = buildUrl(requireBaseUrl(callCtx), '/api/v2/engagements/', {
    ...commonPagingQuery(req),
    product: toOptionalInt(req.product, { min: 1 }),
    name: toTrimmedString(req.name),
    name__icontains: toTrimmedString(req.name_contains),
    status: toTrimmedString(req.status),
  });
  return parseListResponse(await fetchUpstream(url, callCtx));
};

const handleListFindings = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const url = buildUrl(requireBaseUrl(callCtx), '/api/v2/findings/', {
    ...commonPagingQuery(req),
    product: toOptionalInt(req.product, { min: 1 }),
    engagement: toOptionalInt(req.engagement, { min: 1 }),
    test: toOptionalInt(req.test, { min: 1 }),
    severity: toTrimmedString(req.severity),
    active: toOptionalBool(req.active),
    verified: toOptionalBool(req.verified),
    duplicate: toOptionalBool(req.duplicate),
    title: toTrimmedString(req.title),
    title__icontains: toTrimmedString(req.title_contains),
  });
  return parseListResponse(await fetchUpstream(url, callCtx));
};

const handleGetFinding = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const id = requirePositiveId(req.id, 'id');
  const url = buildUrl(requireBaseUrl(callCtx), `/api/v2/findings/${id}/`);
  return parseObjectResponse(await fetchUpstream(url, callCtx));
};

const boolField = (value) => {
  const normalized = toOptionalBool(value);
  return normalized === undefined ? undefined : String(normalized);
};

const scanContextFields = (req = {}) => ({
  scan_type: requireString(req.scan_type, 'scan_type'),
  minimum_severity: toTrimmedString(req.minimum_severity) || 'Info',
  active: boolField(req.active),
  verified: boolField(req.verified),
  engagement: toOptionalInt(req.engagement, { min: 1 }),
  test_title: toTrimmedString(req.test_title),
  product_type_name: toTrimmedString(req.product_type_name),
  product_name: toTrimmedString(req.product_name),
  engagement_name: toTrimmedString(req.engagement_name),
  auto_create_context: boolField(req.auto_create_context),
  background_import: boolField(req.background_import),
});

const scanFile = (req = {}) => ({
  name: requireString(req.file_name, 'file_name'),
  content: requireString(req.file_content, 'file_content'),
  contentType: toTrimmedString(req.file_content_type) || 'application/octet-stream',
});

const handleImportScan = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const url = buildUrl(requireBaseUrl(callCtx), '/api/v2/import-scan/');
  const fields = {
    ...scanContextFields(req),
    close_old_findings: boolField(req.close_old_findings),
  };
  return parseObjectResponse(await postMultipartUpstream(url, callCtx, fields, scanFile(req)));
};

const handleReimportScan = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const url = buildUrl(requireBaseUrl(callCtx), '/api/v2/reimport-scan/');
  const fields = {
    ...scanContextFields(req),
    test: toOptionalInt(req.test, { min: 1 }),
    do_not_reactivate: boolField(req.do_not_reactivate),
  };
  return parseObjectResponse(await postMultipartUpstream(url, callCtx, fields, scanFile(req)));
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_LIST_PRODUCTS_PATH]: async (req) => handleListProducts(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_LIST_ENGAGEMENTS_PATH]: async (req) => handleListEngagements(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_LIST_FINDINGS_PATH]: async (req) => handleListFindings(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_GET_FINDING_PATH]: async (req) => handleGetFinding(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_IMPORT_SCAN_PATH]: async (req) => handleImportScan(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_REIMPORT_SCAN_PATH]: async (req) => handleReimportScan(req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_LIST_PRODUCTS_FULL]: (reqOrCtx, maybeCtx) => {
    const call = resolveHandlerArgs(reqOrCtx, maybeCtx);
    return handleListProducts(call.req, call.ctx);
  },
  [METHOD_LIST_ENGAGEMENTS_FULL]: (reqOrCtx, maybeCtx) => {
    const call = resolveHandlerArgs(reqOrCtx, maybeCtx);
    return handleListEngagements(call.req, call.ctx);
  },
  [METHOD_LIST_FINDINGS_FULL]: (reqOrCtx, maybeCtx) => {
    const call = resolveHandlerArgs(reqOrCtx, maybeCtx);
    return handleListFindings(call.req, call.ctx);
  },
  [METHOD_GET_FINDING_FULL]: (reqOrCtx, maybeCtx) => {
    const call = resolveHandlerArgs(reqOrCtx, maybeCtx);
    return handleGetFinding(call.req, call.ctx);
  },
  [METHOD_IMPORT_SCAN_FULL]: (reqOrCtx, maybeCtx) => {
    const call = resolveHandlerArgs(reqOrCtx, maybeCtx);
    return handleImportScan(call.req, call.ctx);
  },
  [METHOD_REIMPORT_SCAN_FULL]: (reqOrCtx, maybeCtx) => {
    const call = resolveHandlerArgs(reqOrCtx, maybeCtx);
    return handleReimportScan(call.req, call.ctx);
  },
};

export const _test = {
  assertSupportedTlsConfig,
  buildRequestHeaders,
  buildMultipartBody,
  buildUrl,
  boolField,
  commonPagingQuery,
  encodeQueryPairs,
  errorWithCode,
  fetchUpstream,
  firstDefined,
  grpcCodeFor,
  handleGetFinding,
  handleImportScan,
  handleListEngagements,
  handleListFindings,
  handleListProducts,
  handleReimportScan,
  hasOwn,
  mapHttpStatusToGrpcCode,
  mergedBindings,
  normalizeBaseUrl,
  parseDefectDojoResponse,
  parseHeaders,
  parseListResponse,
  parseObjectResponse,
  requireApiKey,
  requireBaseUrl,
  requirePositiveId,
  requireString,
  resolveApiKey,
  resolveBaseUrl,
  resolveCallContext,
  resolveHandlerArgs,
  resolveTimeoutMs,
  scanContextFields,
  scanFile,
  throwStructuredError,
  toOptionalBool,
  toOptionalInt,
  toTrimmedString,
  toValue,
  tryParseJson,
  unwrapScalar,
};
