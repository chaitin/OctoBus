import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const METHOD_LIST_ORGANIZATIONS_FULL = 'OpenObserve_v0_15_1.OpenObserve_v0_15_1/ListOrganizations';
export const METHOD_LIST_STREAMS_FULL = 'OpenObserve_v0_15_1.OpenObserve_v0_15_1/ListStreams';
export const METHOD_GET_STREAM_SCHEMA_FULL = 'OpenObserve_v0_15_1.OpenObserve_v0_15_1/GetStreamSchema';
export const METHOD_SEARCH_DATA_FULL = 'OpenObserve_v0_15_1.OpenObserve_v0_15_1/SearchData';
export const METHOD_LIST_FUNCTIONS_FULL = 'OpenObserve_v0_15_1.OpenObserve_v0_15_1/ListFunctions';

export const DEFAULT_TIMEOUT_MS = 10000;
export const MAX_TIMEOUT_MS = 120000;
export const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_SEARCH_SIZE = 10;
export const MAX_SEARCH_SIZE = 1000;
export const MAX_QUERY_BYTES = 64 * 1024;

let insecureDispatcher;

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  NOT_FOUND: grpcStatus.NOT_FOUND,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  RESOURCE_EXHAUSTED: grpcStatus.RESOURCE_EXHAUSTED,
  DEADLINE_EXCEEDED: grpcStatus.DEADLINE_EXCEEDED,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);
const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, 'value')) return unwrapScalar(value.value);
  return value;
};
const toTrimmedString = (value) => { const raw = unwrapScalar(value); return raw === undefined || raw === null ? '' : String(raw).trim(); };
const toFiniteInt = (value, fallback = 0) => { const raw = unwrapScalar(value); if (raw === undefined || raw === null || raw === '') return fallback; const n = Number(raw); return Number.isFinite(n) ? Math.trunc(n) : fallback; };
const toBool = (value, fallback = false) => {
  const raw = unwrapScalar(value); if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'boolean') return raw; if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') { const n = raw.trim().toLowerCase(); if (['true','1','yes','on'].includes(n)) return true; if (['false','0','no','off',''].includes(n)) return false; }
  return fallback;
};
const toJsonString = (value) => { if (value === undefined || value === null) return ''; if (typeof value === 'string') return value; try { return JSON.stringify(value); } catch { return ''; } };
const normalizeBaseUrl = (value) => {
  const raw = toTrimmedString(value);
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    return url.toString().replace(/\/+$/, '');
  } catch { return ''; }
};

const mergedBindings = (ctx = {}) => ({ ...(ctx.config ?? {}), ...(ctx.secret ?? {}), ...(ctx.bindings ?? {}) });
const resolveCallContext = (ctx = {}) => ({ ...ctx, bindings: mergedBindings(ctx), limits: ctx.limits ?? {}, meta: ctx.meta ?? {}, req: ctx.req ?? ctx.request ?? {} });
const resolveBaseUrl = (bindings = {}) => normalizeBaseUrl(firstDefined(bindings.baseUrl, bindings.domain, bindings.url));
const resolveUsername = (bindings = {}) => toTrimmedString(firstDefined(bindings.username, bindings.user));
const resolvePassword = (bindings = {}) => toTrimmedString(firstDefined(bindings.password, bindings.passwd));
const resolveTimeoutMs = (ctx = {}) => { const r = Number(firstDefined(ctx.limits?.timeoutMs, ctx.bindings?.timeoutMs, DEFAULT_TIMEOUT_MS)); return Number.isFinite(r) && r > 0 ? Math.min(Math.floor(r), MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS; };
const resolveMaxResponseBytes = (ctx = {}) => {
  const raw = Number(firstDefined(ctx.limits?.maxResponseBytes, ctx.bindings?.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES));
  return Number.isSafeInteger(raw) && raw > 0 ? Math.min(raw, MAX_RESPONSE_BYTES) : DEFAULT_MAX_RESPONSE_BYTES;
};
const buildTlsOptions = (bindings = {}, url = '') => {
  const skip = toBool(firstDefined(bindings.skipTlsVerify, bindings.tlsInsecureSkipVerify, bindings.insecureSkipVerify));
  if (!skip || !String(url).startsWith('https:')) return {};
  insecureDispatcher ??= new Agent({ connect: { rejectUnauthorized: false } });
  return { dispatcher: insecureDispatcher };
};

const requireBaseUrl = (ctx = {}) => { const u = resolveBaseUrl(ctx.bindings || {}); if (!u) throw errorWithCode('INVALID_ARGUMENT', 'baseUrl is required'); return u; };
const requireOrgId = (req = {}) => { const id = toTrimmedString(firstDefined(req.org_id, req.orgId)); if (!id) throw errorWithCode('INVALID_ARGUMENT', 'org_id is required'); return id; };
const requireStream = (req = {}) => { const s = toTrimmedString(req.stream); if (!s) throw errorWithCode('INVALID_ARGUMENT', 'stream is required'); return s; };

const resolveAuth = (bindings = {}) => {
  const token = toTrimmedString(firstDefined(bindings.token, bindings.apiToken));
  if (token) return { type: 'bearer', value: `Bearer ${token}` };
  const username = resolveUsername(bindings);
  const password = resolvePassword(bindings);
  if (!username || !password) throw errorWithCode('INVALID_ARGUMENT', 'username and password or token is required');
  return { type: 'basic', username, password, value: `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}` };
};

const attachResponse = (err, response) => { err.response = response; return err; };
const tryParseJson = (text) => { try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false }; } };
const mapHttpStatusToCode = (s) => { if (s === 401) return 'PERMISSION_DENIED'; if (s === 403) return 'PERMISSION_DENIED'; if (s === 404) return 'NOT_FOUND'; if (s >= 400 && s < 500) return 'FAILED_PRECONDITION'; return 'UNAVAILABLE'; };

const buildLogPrefix = (ctx = {}, action) => {
  const meta = ctx.meta || {};
  const trace = [];
  if (meta.instance_id || meta.instanceId) trace.push(`inst=${meta.instance_id || meta.instanceId}`);
  if (meta.request_id || meta.requestId) trace.push(`req=${meta.request_id || meta.requestId}`);
  return `[OpenObserve_v0_15_1][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
};
const logFlow = (ctx, action, details) => { try { console.log(buildLogPrefix(ctx, action), JSON.stringify(details)); } catch { console.log(buildLogPrefix(ctx, action), details); } };

const logTarget = (url) => {
  try { const target = new URL(url); return { origin: target.origin, path: target.pathname }; }
  catch { return {}; }
};

const executeRequest = async (url, ctx = {}, options = {}) => {
  const timeoutMs = resolveTimeoutMs(ctx);
  const maxResponseBytes = resolveMaxResponseBytes(ctx);
  const headers = { Accept: 'application/json', ...(options.headers ?? {}) };

  const controller = new AbortController();

  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const init = { method: options.method || 'GET', headers, signal: controller.signal, redirect: 'error', ...buildTlsOptions(ctx.bindings || {}, url), ...(options.body !== undefined ? { body: options.body } : {}) };
  let res;
  try { res = await fetch(url, init); }
  catch (err) { const code = err?.name === 'AbortError' ? 'DEADLINE_EXCEEDED' : 'UNAVAILABLE'; logFlow(ctx, options.action || 'fetch:error', { ...logTarget(url), code }); throw attachResponse(errorWithCode(code, err?.name === 'AbortError' ? `${options.action || 'fetch'} timed out after ${timeoutMs}ms` : `${options.action || 'fetch'} upstream request failed`), { http_status: 0, http_body: '' }); }
  finally { clearTimeout(timer); }
  const declaredLength = Number(res.headers?.get?.('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) throw attachResponse(errorWithCode('RESOURCE_EXHAUSTED', `${options.action || 'fetch'} response is too large`), { http_status: Number(res.status || 0), http_body: '' });
  let rawBody;
  try { rawBody = await res.text(); } catch { throw attachResponse(errorWithCode('UNAVAILABLE', 'response read failed'), { http_status: Number(res.status || 0), http_body: '' }); }
  if (Buffer.byteLength(rawBody) > maxResponseBytes) throw attachResponse(errorWithCode('RESOURCE_EXHAUSTED', `${options.action || 'fetch'} response is too large`), { http_status: Number(res.status || 0), http_body: '' });
  const httpStatus = Number(res.status || 0);
  logFlow(ctx, 'fetch:response', { ...logTarget(url), httpStatus, bodyLength: Buffer.byteLength(rawBody) });
  return { httpStatus, httpBody: String(rawBody ?? '') };
};

const ensureSuccess = (result, action) => { if (result.httpStatus >= 200 && result.httpStatus < 300) return; const c = mapHttpStatusToCode(result.httpStatus); throw attachResponse(errorWithCode(c, `${action} upstream HTTP ${result.httpStatus}`), { http_status: result.httpStatus, http_body: '' }); };
const parseJsonOrThrowUnknown = (result, action) => {
  const t = (result.httpBody || '').trim(); if (!t) throw attachResponse(errorWithCode('UNKNOWN', `${action} returned empty response`), { http_status: result.httpStatus, http_body: '' });
  const p = tryParseJson(t); if (!p.ok) throw attachResponse(errorWithCode('UNKNOWN', `${action} response is not valid JSON`), { http_status: result.httpStatus, http_body: '' });
  return p.value;
};

const buildAuthHeaders = (ctx) => {
  const auth = resolveAuth(ctx.bindings || {});
  const headers = {};
  if (auth.type === 'basic' || auth.type === 'bearer') headers.Authorization = auth.value;
  return headers;
};

const buildUrl = (baseUrl, path, query = {}) => {
  const joined = `${baseUrl.replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
  const parts = [];
  for (const [k, v] of Object.entries(query)) { if (v !== undefined && v !== null && v !== '') parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`); }
  return parts.length ? `${joined}?${parts.join('&')}` : joined;
};

const boundedInt = (value, name, fallback, minimum, maximum) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return fallback;
  const number = Number(raw);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw errorWithCode('INVALID_ARGUMENT', `${name} must be an integer in [${minimum}, ${maximum}]`);
  return number;
};

const optionalTimestamp = (value, name) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return undefined;
  const number = Number(raw);
  if (!Number.isSafeInteger(number) || number < 0) throw errorWithCode('INVALID_ARGUMENT', `${name} must be a non-negative integer`);
  return number;
};

const handleListOrganizations = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const url = buildUrl(baseUrl, '/api/organizations');
  logFlow(callCtx, 'ListOrganizations', logTarget(url));
  const headers = buildAuthHeaders(callCtx);
  const result = await executeRequest(url, callCtx, { headers, action: 'ListOrganizations' });
  ensureSuccess(result, 'ListOrganizations');
  const json = parseJsonOrThrowUnknown(result, 'ListOrganizations');
  const items = Array.isArray(json?.data || json) ? (json?.data || json) : [];
  return { organizations: items.map((o) => ({ id: toTrimmedString(o?.id || o?.name), name: toTrimmedString(o?.name), identifier: toTrimmedString(o?.identifier || o?.id), raw_json: toJsonString(o) })), raw_body: result.httpBody };
};

const handleListStreams = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const orgId = requireOrgId(req);
  const streamType = firstDefined(req.stream_type, req.streamType);
  const fetchSchema = firstDefined(req.fetch_schema, req.fetchSchema);
  const params = { ...(streamType ? { type: toTrimmedString(streamType) } : {}), ...(fetchSchema ? { fetchSchema: 'true' } : {}) };
  const url = buildUrl(baseUrl, `/api/${encodeURIComponent(orgId)}/streams`, params);
  logFlow(callCtx, 'ListStreams', { orgId });
  const headers = buildAuthHeaders(callCtx);
  const result = await executeRequest(url, callCtx, { headers, action: 'ListStreams' });
  ensureSuccess(result, 'ListStreams');
  const json = parseJsonOrThrowUnknown(result, 'ListStreams');
  const items = Array.isArray(json?.streams || json?.data || json) ? (json?.streams || json?.data || json) : [];
  return { streams: items.map((s) => ({ name: toTrimmedString(s?.name || s), stream_type: toTrimmedString(s?.stream_type || s?.type), created_at: toTrimmedString(s?.created_at || s?.createdAt), raw_json: toJsonString(s) })), raw_body: result.httpBody };
};

const handleGetStreamSchema = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const orgId = requireOrgId(req);
  const stream = requireStream(req);
  const url = buildUrl(baseUrl, `/api/${encodeURIComponent(orgId)}/streams/${encodeURIComponent(stream)}/schema`);
  logFlow(callCtx, 'GetStreamSchema', { orgId, stream });
  const headers = buildAuthHeaders(callCtx);
  const result = await executeRequest(url, callCtx, { headers, action: 'GetStreamSchema' });
  ensureSuccess(result, 'GetStreamSchema');
  const json = parseJsonOrThrowUnknown(result, 'GetStreamSchema');
  const fields = (Array.isArray(json?.schema || json?.fields) ? (json?.schema || json?.fields) : []).map((f) => ({ name: toTrimmedString(f?.name), type: toTrimmedString(f?.type || f?.data_type), raw_json: toJsonString(f) }));
  return { stream, schema: { fields, raw_json: toJsonString(json?.schema || json) }, raw_body: result.httpBody };
};

const handleSearchData = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const orgId = requireOrgId(req);
  const stream = requireStream(req);
  const size = boundedInt(req.size, 'size', DEFAULT_SEARCH_SIZE, 1, MAX_SEARCH_SIZE);
  const from = boundedInt(req.from, 'from', 0, 0, MAX_SEARCH_SIZE);
  const query = toTrimmedString(req.query);
  if (Buffer.byteLength(query) > MAX_QUERY_BYTES) throw errorWithCode('INVALID_ARGUMENT', `query must not exceed ${MAX_QUERY_BYTES} bytes`);
  const startTime = optionalTimestamp(firstDefined(req.start_time, req.startTime), 'start_time');
  const endTime = optionalTimestamp(firstDefined(req.end_time, req.endTime), 'end_time');
  if ((startTime === undefined) !== (endTime === undefined)) throw errorWithCode('INVALID_ARGUMENT', 'start_time and end_time must be provided together');
  if (startTime !== undefined && startTime > endTime) throw errorWithCode('INVALID_ARGUMENT', 'start_time must not be after end_time');
  const body = {
    query: { sql: query || 'SELECT * FROM "' + stream + '"', sql_mode: 'full', ...(startTime !== undefined ? { start_time: startTime, end_time: endTime } : {}) },
    size, from,
    ...(firstDefined(req.sort_by, req.sortBy) ? { sort_by: toTrimmedString(firstDefined(req.sort_by, req.sortBy)), ...(firstDefined(req.sort_desc, req.sortDesc) ? { sort_desc: true } : {}) } : {}),
  };
  const url = buildUrl(baseUrl, `/api/${encodeURIComponent(orgId)}/${encodeURIComponent(stream)}/_search`);
  logFlow(callCtx, 'SearchData', { orgId, stream, size });
  const headers = { ...buildAuthHeaders(callCtx), 'Content-Type': 'application/json' };
  const result = await executeRequest(url, callCtx, { method: 'POST', headers, body: JSON.stringify(body), action: 'SearchData' });
  ensureSuccess(result, 'SearchData');
  const json = parseJsonOrThrowUnknown(result, 'SearchData');
  const hits = (Array.isArray(json?.hits) ? json.hits : []).map((h) => ({ timestamp: toTrimmedString(h?.['@timestamp'] || h?.timestamp || h?._timestamp), source_json: toJsonString(h) }));
  return { took: toFiniteInt(json?.took), total: toFiniteInt(json?.total || json?.hits?.length), size, from, hits, scan_size: toTrimmedString(json?.scan_size), raw_body: result.httpBody };
};

const handleListFunctions = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const orgId = requireOrgId(req);
  const url = buildUrl(baseUrl, `/api/${encodeURIComponent(orgId)}/functions`);
  logFlow(callCtx, 'ListFunctions', { orgId });
  const headers = buildAuthHeaders(callCtx);
  const result = await executeRequest(url, callCtx, { headers, action: 'ListFunctions' });
  ensureSuccess(result, 'ListFunctions');
  const json = parseJsonOrThrowUnknown(result, 'ListFunctions');
  const items = Array.isArray(json?.functions || json?.data || json) ? (json?.functions || json?.data || json) : [];
  return { functions: items.map((f) => ({ name: toTrimmedString(f?.name || f), created_at: toTrimmedString(f?.created_at || f?.createdAt), updated_at: toTrimmedString(f?.updated_at || f?.updatedAt), raw_json: toJsonString(f) })), raw_body: result.httpBody };
};

const requestFrom = (ctx = {}) => ctx.request ?? ctx.req ?? {};

export const handlers = {
  [METHOD_LIST_ORGANIZATIONS_FULL]: (ctx) => handleListOrganizations(requestFrom(ctx), ctx),
  [METHOD_LIST_STREAMS_FULL]: (ctx) => handleListStreams(requestFrom(ctx), ctx),
  [METHOD_GET_STREAM_SCHEMA_FULL]: (ctx) => handleGetStreamSchema(requestFrom(ctx), ctx),
  [METHOD_LIST_FUNCTIONS_FULL]: (ctx) => handleListFunctions(requestFrom(ctx), ctx),
  [METHOD_SEARCH_DATA_FULL]: (ctx) => handleSearchData(requestFrom(ctx), ctx),
};

export const rpcdef = (ctx) => ({
  '/OpenObserve_v0_15_1.OpenObserve_v0_15_1/ListOrganizations': () => handleListOrganizations({}, ctx),
  '/OpenObserve_v0_15_1.OpenObserve_v0_15_1/ListStreams': (req) => handleListStreams(req, ctx),
  '/OpenObserve_v0_15_1.OpenObserve_v0_15_1/GetStreamSchema': (req) => handleGetStreamSchema(req, ctx),
  '/OpenObserve_v0_15_1.OpenObserve_v0_15_1/SearchData': (req) => handleSearchData(req, ctx),
  '/OpenObserve_v0_15_1.OpenObserve_v0_15_1/ListFunctions': (req) => handleListFunctions(req, ctx),
});

export const _test = { resolveBaseUrl, resolveUsername, resolvePassword, resolveTimeoutMs, resolveMaxResponseBytes, toTrimmedString, toFiniteInt, toBool, toJsonString, errorWithCode, buildAuthHeaders, buildTlsOptions, boundedInt, optionalTimestamp, executeRequest, parseJsonOrThrowUnknown, ensureSuccess, tryParseJson, requestFrom };
