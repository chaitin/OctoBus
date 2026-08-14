import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const METHOD_INSTANT_QUERY_FULL = 'CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/InstantQuery';
export const METHOD_RANGE_QUERY_FULL = 'CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/RangeQuery';
export const METHOD_LIST_TARGETS_FULL = 'CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/ListTargets';
export const METHOD_LIST_RULES_FULL = 'CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/ListRules';
export const METHOD_LIST_ALERTS_FULL = 'CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/ListAlerts';
export const METHOD_LIST_SERIES_FULL = 'CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/ListSeries';
export const METHOD_GET_STATUS_CONFIG_FULL = 'CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/GetStatusConfig';
export const METHOD_LIST_LABELS_FULL = 'CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/ListLabels';
export const METHOD_GET_LABEL_VALUES_FULL = 'CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/GetLabelValues';
export const METHOD_GET_STATUS_BUILDINFO_FULL = 'CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/GetStatusBuildinfo';
export const METHOD_GET_STATUS_FLAGS_FULL = 'CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/GetStatusFlags';
export const METHOD_LIST_ALERTMANAGERS_FULL = 'CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/ListAlertmanagers';
export const METHOD_LIST_SCRAPE_POOLS_FULL = 'CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/ListScrapePools';
export const METHOD_LIST_TARGETS_METADATA_FULL = 'CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/ListTargetsMetadata';
export const METHOD_LIST_METADATA_FULL = 'CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/ListMetadata';

export const DEFAULT_TIMEOUT_MS = 10000;

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  NOT_FOUND: grpcStatus.NOT_FOUND,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

const firstDefined = (...values) => values.find((v) => v !== undefined && v !== null);
const unwrapScalar = (v) => { if (v === undefined || v === null) return undefined; if (typeof v === 'object' && v !== null && Object.prototype.hasOwnProperty.call(v, 'value')) return unwrapScalar(v.value); return v; };
const toTrimmedString = (v) => { const r = unwrapScalar(v); return r === undefined || r === null ? '' : String(r).trim(); };
const toFiniteInt = (v, fallback = 0) => { const r = unwrapScalar(v); if (r === undefined || r === null || r === '') return fallback; const n = Number(r); return Number.isFinite(n) ? Math.trunc(n) : fallback; };
const toFiniteNumber = (v, fallback = 0) => { const r = unwrapScalar(v); if (r === undefined || r === null || r === '') return fallback; const n = Number(r); return Number.isFinite(n) ? n : fallback; };
const toJsonString = (v) => { if (v === undefined || v === null) return ''; if (typeof v === 'string') return v; try { return JSON.stringify(v); } catch { return ''; } };
const normalizeBaseUrl = (v) => {
  const raw = toTrimmedString(v);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    parsed.username = '';
    parsed.password = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch { return ''; }
};

const mergedBindings = (ctx = {}) => ({ ...(ctx.config ?? {}), ...(ctx.secret ?? {}), ...(ctx.bindings ?? {}) });
const resolveCallContext = (ctx = {}) => ({ ...ctx, bindings: mergedBindings(ctx), limits: ctx.limits ?? {}, meta: ctx.meta ?? {}, req: ctx.req ?? ctx.request ?? {} });
const resolveBaseUrl = (bindings = {}) => normalizeBaseUrl(firstDefined(bindings.baseUrl, bindings.domain, bindings.url));
const resolveTimeoutMs = (ctx = {}) => { const r = Number(firstDefined(ctx.limits?.timeoutMs, ctx.bindings?.timeoutMs, DEFAULT_TIMEOUT_MS)); return Number.isFinite(r) && r > 0 ? r : DEFAULT_TIMEOUT_MS; };
let insecureDispatcher;
const buildTlsOptions = (bindings = {}) => {
  const skip = bindings.skipTlsVerify || bindings.tlsInsecureSkipVerify || bindings.insecureSkipVerify;
  if (!skip) return {};
  insecureDispatcher ??= new Agent({ connect: { rejectUnauthorized: false } });
  return { dispatcher: insecureDispatcher };
};

const requireBaseUrl = (ctx = {}) => { const u = resolveBaseUrl(ctx.bindings || {}); if (!u) throw errorWithCode('INVALID_ARGUMENT', 'baseUrl is required'); return u; };
const requireQuery = (req = {}) => { const q = toTrimmedString(req.query); if (!q) throw errorWithCode('INVALID_ARGUMENT', 'query is required'); return q; };

const buildAuthHeaders = (bindings = {}) => {
  const headers = {};
  const token = toTrimmedString(firstDefined(bindings.bearerToken, bindings.token));
  if (token) { headers.Authorization = `Bearer ${token}`; return headers; }
  const username = toTrimmedString(firstDefined(bindings.username, bindings.user));
  const password = toTrimmedString(firstDefined(bindings.password, bindings.passwd));
  if (username && password) headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
  return headers;
};

const attachResponse = (err, response) => { err.response = response; return err; };
const tryParseJson = (t) => { try { return { ok: true, value: JSON.parse(t) }; } catch { return { ok: false }; } };
const mapHttpStatusToCode = (s) => { if (s === 401 || s === 403) return 'PERMISSION_DENIED'; if (s === 404) return 'NOT_FOUND'; if (s === 400) return 'FAILED_PRECONDITION'; if (s === 422) return 'FAILED_PRECONDITION'; if (s === 503) return 'UNAVAILABLE'; if (s >= 500) return 'UNAVAILABLE'; if (s >= 400) return 'INVALID_ARGUMENT'; return 'UNAVAILABLE'; };

const buildLogPrefix = (ctx = {}, action) => {
  const meta = ctx.meta || {}; const trace = [];
  if (meta.instance_id || meta.instanceId) trace.push(`inst=${meta.instance_id || meta.instanceId}`);
  if (meta.request_id || meta.requestId) trace.push(`req=${meta.request_id || meta.requestId}`);
  return `[CNCF_Prometheus_3_0_1][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
};
const safeUrlForLog = (value) => { try { const url = new URL(value); url.username = ''; url.password = ''; for (const key of ['token', 'api_key', 'apikey', 'password']) if (url.searchParams.has(key)) url.searchParams.set(key, '[REDACTED]'); return url.toString(); } catch { return '[invalid-url]'; } };
const logFlow = (ctx, action, details) => { const safe = { ...details, ...(details?.url ? { url: safeUrlForLog(details.url) } : {}) }; try { console.log(buildLogPrefix(ctx, action), JSON.stringify(safe)); } catch { console.log(buildLogPrefix(ctx, action), safe); } };

const executeRequest = async (url, ctx = {}, options = {}) => {
  const timeoutMs = resolveTimeoutMs(ctx);
  const headers = { Accept: 'application/json', ...(options.headers ?? {}) };

  const controller = new AbortController();

  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const init = { method: options.method || 'GET', headers, signal: controller.signal, redirect: 'error', ...buildTlsOptions(ctx.bindings || {}), ...(options.body !== undefined ? { body: options.body } : {}) };
  let res;
  try { res = await fetch(url, init); } catch (err) { const m = err?.cause?.message || err?.message || 'fetch failed'; throw attachResponse(errorWithCode('UNAVAILABLE', `${options.action || 'fetch'} failed: ${m}`), { http_status: 0, http_body: m }); } finally { clearTimeout(timer); }
  let rawBody;
  try { rawBody = await res.text(); } catch (err) { const m = err?.message || 'response read failed'; throw attachResponse(errorWithCode('UNAVAILABLE', `response read failed: ${m}`), { http_status: Number(res.status || 0), http_body: m }); }
  const httpStatus = Number(res.status || 0);
  logFlow(ctx, 'fetch:response', { url, httpStatus, bodyLength: rawBody?.length || 0 });
  return { httpStatus, httpBody: String(rawBody ?? '') };
};

const ensureSuccess = (result, action) => { if (result.httpStatus >= 200 && result.httpStatus < 300) return; const c = mapHttpStatusToCode(result.httpStatus); throw attachResponse(errorWithCode(c, `${action} upstream http ${result.httpStatus}`), { http_status: result.httpStatus, http_body: '' }); };
const parseJsonOrThrow = (result, action) => { const t = (result.httpBody || '').trim(); if (!t) throw attachResponse(errorWithCode('UNKNOWN', `${action} returned empty response`), { http_status: result.httpStatus, http_body: '' }); const p = tryParseJson(t); if (!p.ok) throw attachResponse(errorWithCode('UNKNOWN', `${action} response is not valid JSON`), { http_status: result.httpStatus, http_body: t }); return p.value; };

const toPromResponse = (json, rawBody) => ({
  status: toTrimmedString(json?.status),
  result_type: toTrimmedString(json?.data?.resultType),
  result: mapQueryResult(json?.data?.result, json?.data?.resultType),
  raw_body: rawBody,
  error_type: toTrimmedString(json?.errorType),
  error: toTrimmedString(json?.error),
  warnings: Array.isArray(json?.warnings) ? json.warnings.map(String) : [],
  infos: Array.isArray(json?.infos) ? json.infos.map(String) : [],
});

const mapMetricLabels = (metric = {}) => Object.entries(metric || {}).map(([name, value]) => ({ name: toTrimmedString(name), value: toTrimmedString(value) }));

const mapSample = ([ts, val]) => ({ timestamp: toFiniteNumber(ts), value: toTrimmedString(val) });

const mapQueryResult = (result, resultType) => {
  if (!Array.isArray(result)) return [];
  if (resultType === 'matrix') {
    return result.map((r) => ({ metric: mapMetricLabels(r?.metric), values: (Array.isArray(r?.values) ? r.values : []).map(mapSample) }));
  }
  if (resultType === 'vector') {
    return result.map((r) => ({ metric: mapMetricLabels(r?.metric), values: r?.value ? [mapSample(r.value)] : [] }));
  }
  if (resultType === 'scalar' && result.length >= 2) {
    return [{ metric: [], values: [mapSample(result)] }];
  }
  return [];
};

const encodeQueryParams = (params = {}) => {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) { for (const v of value) searchParams.append(key, String(v)); }
    else searchParams.append(key, String(value));
  }
  return searchParams.toString();
};

const handleInstantQuery = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const query = requireQuery(req);
  const params = { query, ...(req.time ? { time: toTrimmedString(req.time) } : {}), ...(req.timeout ? { timeout: toTrimmedString(req.timeout) } : {}), ...(req.limit ? { limit: String(toFiniteInt(req.limit)) } : {}), ...(req.lookback_delta ? { lookback_delta: toTrimmedString(req.lookback_delta) } : {}), ...(req.stats ? { stats: 'all' } : {}) };
  const qs = encodeQueryParams(params);
  const url = `${baseUrl}/api/v1/query${qs ? '?' + qs : ''}`;
  const headers = buildAuthHeaders(callCtx.bindings);
  const result = await executeRequest(url, callCtx, { headers, action: 'InstantQuery' });
  ensureSuccess(result, 'InstantQuery');
  const json = parseJsonOrThrow(result, 'InstantQuery');
  return toPromResponse(json, result.httpBody);
};

const handleRangeQuery = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const query = requireQuery(req);
  const start = toTrimmedString(req.start);
  const end = toTrimmedString(req.end);
  const step = toTrimmedString(req.step);
  if (!start) throw errorWithCode('INVALID_ARGUMENT', 'start is required');
  if (!end) throw errorWithCode('INVALID_ARGUMENT', 'end is required');
  if (!step) throw errorWithCode('INVALID_ARGUMENT', 'step is required');
  const params = { query, start, end, step, ...(req.timeout ? { timeout: toTrimmedString(req.timeout) } : {}), ...(req.limit ? { limit: String(toFiniteInt(req.limit)) } : {}), ...(req.lookback_delta ? { lookback_delta: toTrimmedString(req.lookback_delta) } : {}), ...(req.stats ? { stats: 'all' } : {}) };
  const qs = encodeQueryParams(params);
  const url = `${baseUrl}/api/v1/query_range${qs ? '?' + qs : ''}`;
  const headers = buildAuthHeaders(callCtx.bindings);
  const result = await executeRequest(url, callCtx, { headers, action: 'RangeQuery' });
  ensureSuccess(result, 'RangeQuery');
  const json = parseJsonOrThrow(result, 'RangeQuery');
  return toPromResponse(json, result.httpBody);
};

const handleListTargets = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const params = {};
  if (req.state) params.state = toTrimmedString(req.state);
  const scrapePool = toTrimmedString(req.scrape_pool);
  if (scrapePool) params.scrape_pool = scrapePool;
  const qs = encodeQueryParams(params);
  const url = `${baseUrl}/api/v1/targets${qs ? '?' + qs : ''}`;
  const headers = buildAuthHeaders(callCtx.bindings);
  const result = await executeRequest(url, callCtx, { headers, action: 'ListTargets' });
  ensureSuccess(result, 'ListTargets');
  const json = parseJsonOrThrow(result, 'ListTargets');
  const mapTarget = (t) => ({
    scrape_pool: toTrimmedString(t?.scrapePool),
    scrape_url: toTrimmedString(t?.scrapeUrl),
    global_url: toTrimmedString(t?.globalUrl),
    last_error: toTrimmedString(t?.lastError),
    last_scrape: toTrimmedString(t?.lastScrape),
    last_scrape_duration: toFiniteNumber(t?.lastScrapeDuration),
    health: toTrimmedString(t?.health),
    labels: mapMetricLabels(t?.labels || t?.discoveredLabels),
    raw_json: toJsonString(t),
  });
  return {
    status: toTrimmedString(json?.status),
    active_targets: (Array.isArray(json?.data?.activeTargets) ? json.data.activeTargets : []).map(mapTarget),
    dropped_targets: (Array.isArray(json?.data?.droppedTargets) ? json.data.droppedTargets : []).map(mapTarget),
    raw_body: result.httpBody,
  };
};

const handleListRules = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const params = {};
  if (req.type) {
    const t = toTrimmedString(req.type);
    if (t === 'alert' || t === 'record') params.type = t;
  }
  if (req.rule_name) params.rule_name = toTrimmedString(req.rule_name);
  if (Array.isArray(req.rule_group)) params.rule_group = req.rule_group.map(String);
  if (Array.isArray(req.file)) params.file = req.file.map(String);
  const qs = encodeQueryParams(params);
  const url = `${baseUrl}/api/v1/rules${qs ? '?' + qs : ''}`;
  const headers = buildAuthHeaders(callCtx.bindings);
  const result = await executeRequest(url, callCtx, { headers, action: 'ListRules' });
  ensureSuccess(result, 'ListRules');
  const json = parseJsonOrThrow(result, 'ListRules');
  const groups = (Array.isArray(json?.data?.groups) ? json.data.groups : []).map((g) => {
    const rules = (Array.isArray(g?.rules) ? g.rules : []).map((r) => ({
      state: toTrimmedString(r?.state),
      name: toTrimmedString(r?.name),
      query: toTrimmedString(r?.query),
      duration: toTrimmedString(r?.duration),
      keep_firing_for: toTrimmedString(r?.keepFiringFor),
      severity: toTrimmedString(r?.labels?.severity),
      labels: mapMetricLabels(r?.labels),
      annotations: mapMetricLabels(r?.annotations),
      active_at: toTrimmedString(r?.activeAt),
      value: toTrimmedString(r?.value),
      health: toFiniteNumber(r?.health),
      raw_json: toJsonString(r),
    }));
    return {
      name: toTrimmedString(g?.name),
      file: toTrimmedString(g?.file),
      interval: toTrimmedString(g?.interval),
      limit: toTrimmedString(g?.limit),
      evaluation_time: toTrimmedString(g?.evaluationTime),
      last_evaluation: toTrimmedString(g?.lastEvaluation),
      rules,
      raw_json: toJsonString(g),
    };
  });
  return { status: toTrimmedString(json?.status), groups, raw_body: result.httpBody };
};

const handleListAlerts = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const params = {};
  if (req.state) params.state = toTrimmedString(req.state);
  const qs = encodeQueryParams(params);
  const url = `${baseUrl}/api/v1/alerts${qs ? '?' + qs : ''}`;
  const headers = buildAuthHeaders(callCtx.bindings);
  const result = await executeRequest(url, callCtx, { headers, action: 'ListAlerts' });
  ensureSuccess(result, 'ListAlerts');
  const json = parseJsonOrThrow(result, 'ListAlerts');
  const alerts = (Array.isArray(json?.data?.alerts) ? json.data.alerts : []).map((a) => ({
    state: toTrimmedString(a?.state),
    active_at: toTrimmedString(a?.activeAt),
    value: toTrimmedString(a?.value),
    labels: mapMetricLabels(a?.labels),
    annotations: mapMetricLabels(a?.annotations),
    raw_json: toJsonString(a),
  }));
  return { status: toTrimmedString(json?.status), alerts, raw_body: result.httpBody };
};

const handleListSeries = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const matches = Array.isArray(req.match) ? req.match.map(String).filter(Boolean) : [];
  if (matches.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'at least one match[] selector is required');
  const params = { 'match[]': matches, ...(req.start ? { start: toTrimmedString(req.start) } : {}), ...(req.end ? { end: toTrimmedString(req.end) } : {}), ...(req.limit ? { limit: String(toFiniteInt(req.limit)) } : {}) };
  const qs = encodeQueryParams(params);
  const url = `${baseUrl}/api/v1/series${qs ? '?' + qs : ''}`;
  const headers = buildAuthHeaders(callCtx.bindings);
  const result = await executeRequest(url, callCtx, { headers, action: 'ListSeries' });
  ensureSuccess(result, 'ListSeries');
  const json = parseJsonOrThrow(result, 'ListSeries');
  const data = (Array.isArray(json?.data) ? json.data : []).map((item) => ({ labels: mapMetricLabels(item) }));
  return { status: toTrimmedString(json?.status), data, raw_body: result.httpBody };
};

const handleListLabels = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const params = {};
  if (Array.isArray(req.match) && req.match.length > 0) { params['match[]'] = req.match.map(String); }
  if (req.start) params.start = toTrimmedString(req.start);
  if (req.end) params.end = toTrimmedString(req.end);
  if (req.limit) params.limit = String(toFiniteInt(req.limit));
  const qs = encodeQueryParams(params);
  const url = `${baseUrl}/api/v1/labels${qs ? '?' + qs : ''}`;
  const headers = buildAuthHeaders(callCtx.bindings);
  const result = await executeRequest(url, callCtx, { headers, action: 'ListLabels' });
  ensureSuccess(result, 'ListLabels');
  const json = parseJsonOrThrow(result, 'ListLabels');
  return { status: toTrimmedString(json?.status), data: Array.isArray(json?.data) ? json.data.map(String) : [], raw_body: result.httpBody };
};

const handleGetLabelValues = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const label = toTrimmedString(req.label);
  if (!label) throw errorWithCode('INVALID_ARGUMENT', 'label is required');
  const params = {};
  if (Array.isArray(req.match) && req.match.length > 0) { params['match[]'] = req.match.map(String); }
  if (req.start) params.start = toTrimmedString(req.start);
  if (req.end) params.end = toTrimmedString(req.end);
  if (req.limit) params.limit = String(toFiniteInt(req.limit));
  const qs = encodeQueryParams(params);
  const url = `${baseUrl}/api/v1/label/${encodeURIComponent(label)}/values${qs ? '?' + qs : ''}`;
  const headers = buildAuthHeaders(callCtx.bindings);
  const result = await executeRequest(url, callCtx, { headers, action: 'GetLabelValues' });
  ensureSuccess(result, 'GetLabelValues');
  const json = parseJsonOrThrow(result, 'GetLabelValues');
  return { status: toTrimmedString(json?.status), data: Array.isArray(json?.data) ? json.data.map(String) : [], raw_body: result.httpBody };
};

const handleGetStatusConfig = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const url = `${baseUrl}/api/v1/status/config`;
  const headers = buildAuthHeaders(callCtx.bindings);
  const result = await executeRequest(url, callCtx, { headers, action: 'GetStatusConfig' });
  ensureSuccess(result, 'GetStatusConfig');
  const json = parseJsonOrThrow(result, 'GetStatusConfig');
  return {
    status: toTrimmedString(json?.status),
    config_yaml: toTrimmedString(json?.data?.yaml || ''),
    raw_body: result.httpBody,
  };
};

const handleGetStatusBuildinfo = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const url = `${baseUrl}/api/v1/status/buildinfo`;
  const headers = buildAuthHeaders(callCtx.bindings);
  const result = await executeRequest(url, callCtx, { headers, action: 'GetStatusBuildinfo' });
  ensureSuccess(result, 'GetStatusBuildinfo');
  const json = parseJsonOrThrow(result, 'GetStatusBuildinfo');
  const buildInfo = json?.data || {};
  return {
    status: toTrimmedString(json?.status),
    build_info: {
      version: toTrimmedString(buildInfo?.version),
      revision: toTrimmedString(buildInfo?.revision),
      branch: toTrimmedString(buildInfo?.branch),
      build_user: toTrimmedString(buildInfo?.buildUser),
      build_date: toTrimmedString(buildInfo?.buildDate),
      go_version: toTrimmedString(buildInfo?.goVersion),
      raw_json: toJsonString(buildInfo),
    },
    raw_body: result.httpBody,
  };
};

const handleGetStatusFlags = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const url = `${baseUrl}/api/v1/status/flags`;
  const headers = buildAuthHeaders(callCtx.bindings);
  const result = await executeRequest(url, callCtx, { headers, action: 'GetStatusFlags' });
  ensureSuccess(result, 'GetStatusFlags');
  const json = parseJsonOrThrow(result, 'GetStatusFlags');
  return {
    status: toTrimmedString(json?.status),
    flags_json: toJsonString(json?.data || {}),
    raw_body: result.httpBody,
  };
};

const handleListAlertmanagers = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const url = `${baseUrl}/api/v1/alertmanagers`;
  const headers = buildAuthHeaders(callCtx.bindings);
  const result = await executeRequest(url, callCtx, { headers, action: 'ListAlertmanagers' });
  ensureSuccess(result, 'ListAlertmanagers');
  const json = parseJsonOrThrow(result, 'ListAlertmanagers');
  const map = (am) => ({ url: toTrimmedString(am?.url), raw_json: toJsonString(am) });
  return {
    status: toTrimmedString(json?.status),
    active_alertmanagers: (Array.isArray(json?.data?.activeAlertmanagers) ? json.data.activeAlertmanagers : []).map(map),
    dropped_alertmanagers: (Array.isArray(json?.data?.droppedAlertmanagers) ? json.data.droppedAlertmanagers : []).map(map),
    raw_body: result.httpBody,
  };
};

const handleListScrapePools = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const url = `${baseUrl}/api/v1/scrape_pools`;
  const headers = buildAuthHeaders(callCtx.bindings);
  const result = await executeRequest(url, callCtx, { headers, action: 'ListScrapePools' });
  ensureSuccess(result, 'ListScrapePools');
  const json = parseJsonOrThrow(result, 'ListScrapePools');
  const pools = (Array.isArray(json?.data) ? json.data : []).map((p) => ({ name: toTrimmedString(p), target_count: undefined, raw_json: toJsonString({ name: p }) }));
  return { status: toTrimmedString(json?.status), pools, raw_body: result.httpBody };
};

const handleListTargetsMetadata = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const params = {};
  if (req.match_target) params['match_target'] = toTrimmedString(req.match_target);
  if (req.metric) params.metric = toTrimmedString(req.metric);
  if (req.limit) params.limit = String(toFiniteInt(req.limit));
  const qs = encodeQueryParams(params);
  const url = `${baseUrl}/api/v1/targets/metadata${qs ? '?' + qs : ''}`;
  const headers = buildAuthHeaders(callCtx.bindings);
  const result = await executeRequest(url, callCtx, { headers, action: 'ListTargetsMetadata' });
  ensureSuccess(result, 'ListTargetsMetadata');
  const json = parseJsonOrThrow(result, 'ListTargetsMetadata');
  const data = (Array.isArray(json?.data) ? json.data : []).map((t) => ({
    target: toTrimmedString(t?.target?.scrapeJob || JSON.stringify(t?.target || {})),
    type: toTrimmedString(t?.type),
    help: toTrimmedString(t?.help),
    unit: toTrimmedString(t?.unit),
    raw_json: toJsonString(t),
  }));
  return { status: toTrimmedString(json?.status), data, raw_body: result.httpBody };
};

const handleListMetadata = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const params = {};
  if (req.match_target) params['match_target'] = toTrimmedString(req.match_target);
  if (req.metric) params.metric = toTrimmedString(req.metric);
  if (req.limit) params.limit_per_metric = String(toFiniteInt(req.limit));
  const qs = encodeQueryParams(params);
  const url = `${baseUrl}/api/v1/metadata${qs ? '?' + qs : ''}`;
  const headers = buildAuthHeaders(callCtx.bindings);
  const result = await executeRequest(url, callCtx, { headers, action: 'ListMetadata' });
  ensureSuccess(result, 'ListMetadata');
  const json = parseJsonOrThrow(result, 'ListMetadata');
  const data = [];
  for (const [metric, infos] of Object.entries(json?.data || {})) {
    if (Array.isArray(infos)) {
      for (const info of infos) {
        data.push({
          metric: toTrimmedString(metric),
          type: toTrimmedString(info?.type),
          help: toTrimmedString(info?.help),
          unit: toTrimmedString(info?.unit),
          raw_json: toJsonString(info),
        });
      }
    }
  }
  return { status: toTrimmedString(json?.status), data, raw_body: result.httpBody };
};

const sdkHandler = (handler) => function sdkCall(ctx) {
  const legacyCtx = arguments[1];
  return legacyCtx ? handler(ctx ?? {}, legacyCtx) : handler(ctx?.request ?? {}, ctx ?? {});
};

export const handlers = {
  [METHOD_INSTANT_QUERY_FULL]: sdkHandler(handleInstantQuery),
  [METHOD_RANGE_QUERY_FULL]: sdkHandler(handleRangeQuery),
  [METHOD_LIST_TARGETS_FULL]: sdkHandler(handleListTargets),
  [METHOD_LIST_RULES_FULL]: sdkHandler(handleListRules),
  [METHOD_LIST_ALERTS_FULL]: sdkHandler(handleListAlerts),
  [METHOD_LIST_SERIES_FULL]: sdkHandler(handleListSeries),
  [METHOD_GET_STATUS_CONFIG_FULL]: sdkHandler(handleGetStatusConfig),
  [METHOD_LIST_LABELS_FULL]: sdkHandler(handleListLabels),
  [METHOD_GET_LABEL_VALUES_FULL]: sdkHandler(handleGetLabelValues),
  [METHOD_GET_STATUS_BUILDINFO_FULL]: sdkHandler(handleGetStatusBuildinfo),
  [METHOD_GET_STATUS_FLAGS_FULL]: sdkHandler(handleGetStatusFlags),
  [METHOD_LIST_ALERTMANAGERS_FULL]: sdkHandler(handleListAlertmanagers),
  [METHOD_LIST_SCRAPE_POOLS_FULL]: sdkHandler(handleListScrapePools),
  [METHOD_LIST_TARGETS_METADATA_FULL]: sdkHandler(handleListTargetsMetadata),
  [METHOD_LIST_METADATA_FULL]: sdkHandler(handleListMetadata),
};

export const _test = { resolveBaseUrl, toTrimmedString, toFiniteInt, toFiniteNumber, toJsonString, errorWithCode, buildAuthHeaders, buildTlsOptions, parseJsonOrThrow, ensureSuccess, tryParseJson, encodeQueryParams, mapQueryResult, mapMetricLabels, safeUrlForLog };
