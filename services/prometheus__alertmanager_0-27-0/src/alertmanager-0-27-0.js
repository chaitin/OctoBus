import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const METHOD_LIST_ALERTS_FULL = 'Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/ListAlerts';
export const METHOD_GET_ALERT_GROUPS_FULL = 'Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/GetAlertGroups';
export const METHOD_LIST_SILENCES_FULL = 'Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/ListSilences';
export const METHOD_GET_SILENCE_FULL = 'Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/GetSilence';
export const METHOD_GET_STATUS_FULL = 'Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/GetStatus';
export const METHOD_LIST_RECEIVERS_FULL = 'Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/ListReceivers';

export const DEFAULT_TIMEOUT_MS = 10000;
export const MAX_TIMEOUT_MS = 120000;
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

let insecureDispatcher;

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  NOT_FOUND: grpcStatus.NOT_FOUND,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => { const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`); err.legacyCode = code; return err; };
const firstDefined = (...values) => values.find((v) => v !== undefined && v !== null);
const unwrapScalar = (v) => { if (v === undefined || v === null) return undefined; if (typeof v === 'object' && v !== null && Object.prototype.hasOwnProperty.call(v, 'value')) return unwrapScalar(v.value); return v; };
const toTrimmedString = (v) => { const r = unwrapScalar(v); return r === undefined || r === null ? '' : String(r).trim(); };
const toBool = (v, fallback = false) => { const r = unwrapScalar(v); if (r === undefined || r === null) return fallback; if (typeof r === 'boolean') return r; if (typeof r === 'number') return r !== 0; if (typeof r === 'string') { const n = r.trim().toLowerCase(); if (['true','1','yes','on'].includes(n)) return true; if (['false','0','no','off',''].includes(n)) return false; } return fallback; };
const toJsonString = (v) => { if (v === undefined || v === null) return ''; if (typeof v === 'string') return v; try { return JSON.stringify(v); } catch { return ''; } };
const normalizeBaseUrl = (v) => {
  const raw = toTrimmedString(v);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    return url.toString().replace(/\/+$/, '');
  } catch { return ''; }
};

const mergedBindings = (ctx = {}) => ({ ...(ctx.config ?? {}), ...(ctx.secret ?? {}), ...(ctx.bindings ?? {}) });
const resolveCallContext = (ctx = {}) => ({ ...ctx, bindings: mergedBindings(ctx), limits: ctx.limits ?? {}, meta: ctx.meta ?? {}, req: ctx.req ?? ctx.request ?? {} });
const resolveBaseUrl = (bindings = {}) => normalizeBaseUrl(firstDefined(bindings.baseUrl, bindings.domain, bindings.url));
const resolveTimeoutMs = (ctx = {}) => { const r = Number(firstDefined(ctx.limits?.timeoutMs, ctx.bindings?.timeoutMs, DEFAULT_TIMEOUT_MS)); return Number.isFinite(r) && r > 0 ? Math.min(Math.floor(r), MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS; };
const buildTlsOptions = (bindings = {}, url = '') => {
  const skip = toBool(firstDefined(bindings.skipTlsVerify, bindings.tlsInsecureSkipVerify, bindings.insecureSkipVerify));
  if (!skip || !String(url).startsWith('https:')) return {};
  insecureDispatcher ??= new Agent({ connect: { rejectUnauthorized: false } });
  return { dispatcher: insecureDispatcher };
};

const requireBaseUrl = (ctx = {}) => { const u = resolveBaseUrl(ctx.bindings || {}); if (!u) throw errorWithCode('INVALID_ARGUMENT', 'baseUrl is required'); return u; };

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
const mapHttpStatusToCode = (s) => { if (s === 401) return 'PERMISSION_DENIED'; if (s === 403) return 'PERMISSION_DENIED'; if (s === 404) return 'NOT_FOUND'; if (s >= 400 && s < 500) return 'FAILED_PRECONDITION'; return 'UNAVAILABLE'; };

const buildLogPrefix = (ctx = {}, action) => {
  const meta = ctx.meta || {}; const trace = [];
  if (meta.instance_id || meta.instanceId) trace.push(`inst=${meta.instance_id || meta.instanceId}`);
  return `[Prometheus_Alertmanager_0_27_0][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
};
const logFlow = (ctx, action, details) => { try { console.log(buildLogPrefix(ctx, action), JSON.stringify(details)); } catch { console.log(buildLogPrefix(ctx, action), details); } };

const executeRequest = async (url, ctx = {}, options = {}) => {
  const timeoutMs = resolveTimeoutMs(ctx);
  const headers = { Accept: 'application/json', ...(options.headers ?? {}) };

  const controller = new AbortController();

  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const init = { method: options.method || 'GET', headers, signal: controller.signal, redirect: 'error', ...buildTlsOptions(ctx.bindings || {}, url), ...(options.body !== undefined ? { body: options.body } : {}) };
  let res;
  try { res = await fetch(url, init); } catch (err) { const m = err?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : 'upstream unavailable'; throw attachResponse(errorWithCode('UNAVAILABLE', `${options.action || 'fetch'} failed: ${m}`), { http_status: 0, http_body: '' }); } finally { clearTimeout(timer); }
  const declaredLength = Number(res.headers?.get?.('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw attachResponse(errorWithCode('UNAVAILABLE', `${options.action || 'fetch'} response is too large`), { http_status: Number(res.status || 0), http_body: '' });
  let rawBody;
  try { rawBody = await res.text(); } catch (err) { throw attachResponse(errorWithCode('UNAVAILABLE', `response read failed: ${err.message}`), { http_status: Number(res.status || 0), http_body: '' }); }
  if (Buffer.byteLength(rawBody) > MAX_RESPONSE_BYTES) throw attachResponse(errorWithCode('UNAVAILABLE', `${options.action || 'fetch'} response is too large`), { http_status: Number(res.status || 0), http_body: '' });
  const httpStatus = Number(res.status || 0);
  const target = new URL(url);
  logFlow(ctx, 'fetch:response', { origin: target.origin, path: target.pathname, httpStatus, bodyLength: rawBody?.length || 0 });
  return { httpStatus, httpBody: String(rawBody ?? '') };
};

const ensureSuccess = (result, action) => { if (result.httpStatus >= 200 && result.httpStatus < 300) return; const c = mapHttpStatusToCode(result.httpStatus); throw attachResponse(errorWithCode(c, `${action} upstream HTTP ${result.httpStatus}`), { http_status: result.httpStatus, http_body: '' }); };
const parseJsonOrThrow = (result, action) => { const t = (result.httpBody || '').trim(); if (!t) throw attachResponse(errorWithCode('UNKNOWN', `${action} returned empty response`), { http_status: result.httpStatus, http_body: '' }); const p = tryParseJson(t); if (!p.ok) throw attachResponse(errorWithCode('UNKNOWN', `${action} response is not valid JSON`), { http_status: result.httpStatus, http_body: t }); return p.value; };

const mapAlertLabels = (labels = {}) => Object.entries(labels || {}).map(([name, value]) => ({ name: toTrimmedString(name), value: toTrimmedString(value) }));

const mapAlert = (a) => ({
  fingerprint: toTrimmedString(a?.fingerprint),
  starts_at: toTrimmedString(a?.startsAt),
  ends_at: toTrimmedString(a?.endsAt),
  updated_at: toTrimmedString(a?.updatedAt),
  generator_url: toTrimmedString(a?.generatorURL),
  labels: mapAlertLabels(a?.labels),
  annotations: mapAlertLabels(a?.annotations),
  status_state: Array.isArray(a?.status?.state) ? a.status.state.map(String) : [],
  raw_json: toJsonString(a),
});

const mapMatcher = (m) => ({ name: toTrimmedString(m?.name), value: toTrimmedString(m?.value), is_regex: toBool(m?.isRegex), is_equal: toBool(m?.isEqual !== false, true) });

const mapSilence = (s) => ({
  id: toTrimmedString(s?.id),
  created_by: toTrimmedString(s?.createdBy),
  comment: toTrimmedString(s?.comment),
  starts_at: toTrimmedString(s?.startsAt),
  ends_at: toTrimmedString(s?.endsAt),
  updated_at: toTrimmedString(s?.updatedAt),
  matchers: (Array.isArray(s?.matchers) ? s.matchers : []).map(mapMatcher),
  status_state: toTrimmedString(s?.status?.state),
  raw_json: toJsonString(s),
});

const buildQuery = (params = {}) => {
  const parts = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length ? '?' + parts.join('&') : '';
};

const handleListAlerts = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const params = {};
  if (req.silenced !== undefined) params.silenced = String(toBool(req.silenced));
  if (req.inhibited !== undefined) params.inhibited = String(toBool(req.inhibited));
  if (req.active !== undefined) params.active = String(toBool(req.active));
  if (req.filter) params.filter = toTrimmedString(req.filter);
  if (req.receiver) params.receiver = toTrimmedString(req.receiver);
  const url = `${baseUrl}/api/v2/alerts${buildQuery(params)}`;
  const headers = buildAuthHeaders(callCtx.bindings);
  const result = await executeRequest(url, callCtx, { headers, action: 'ListAlerts' });
  ensureSuccess(result, 'ListAlerts');
  const json = parseJsonOrThrow(result, 'ListAlerts');
  const alerts = (Array.isArray(json) ? json : []).map(mapAlert);
  return { status: 'success', alerts, raw_body: result.httpBody };
};

const handleGetAlertGroups = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const params = {};
  if (req.silenced !== undefined) params.silenced = String(toBool(req.silenced));
  if (req.inhibited !== undefined) params.inhibited = String(toBool(req.inhibited));
  if (req.active !== undefined) params.active = String(toBool(req.active));
  if (req.filter) params.filter = toTrimmedString(req.filter);
  if (req.receiver) params.receiver = toTrimmedString(req.receiver);
  const url = `${baseUrl}/api/v2/alerts/groups${buildQuery(params)}`;
  const headers = buildAuthHeaders(callCtx.bindings);
  const result = await executeRequest(url, callCtx, { headers, action: 'GetAlertGroups' });
  ensureSuccess(result, 'GetAlertGroups');
  const json = parseJsonOrThrow(result, 'GetAlertGroups');
  const groups = (Array.isArray(json) ? json : []).map((g) => ({
    labels: mapAlertLabels(g?.labels),
    receiver_name: toTrimmedString(g?.receiver?.name),
    alerts: (Array.isArray(g?.alerts) ? g.alerts : []).map(mapAlert),
    raw_json: toJsonString(g),
  }));
  return { status: 'success', groups, raw_body: result.httpBody };
};

const handleListSilences = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const params = {};
  if (req.filter) params.filter = toTrimmedString(req.filter);
  const url = `${baseUrl}/api/v2/silences${buildQuery(params)}`;
  const headers = buildAuthHeaders(callCtx.bindings);
  const result = await executeRequest(url, callCtx, { headers, action: 'ListSilences' });
  ensureSuccess(result, 'ListSilences');
  const json = parseJsonOrThrow(result, 'ListSilences');
  const silences = (Array.isArray(json) ? json : []).map(mapSilence);
  return { status: 'success', silences, raw_body: result.httpBody };
};

const handleGetSilence = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const silenceId = toTrimmedString(req.silence_id);
  if (!silenceId) throw errorWithCode('INVALID_ARGUMENT', 'silence_id is required');
  const url = `${baseUrl}/api/v2/silence/${encodeURIComponent(silenceId)}`;
  const headers = buildAuthHeaders(callCtx.bindings);
  const result = await executeRequest(url, callCtx, { headers, action: 'GetSilence' });
  ensureSuccess(result, 'GetSilence');
  const json = parseJsonOrThrow(result, 'GetSilence');
  return { status: 'success', silence: mapSilence(json), raw_body: result.httpBody };
};

const handleGetStatus = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const url = `${baseUrl}/api/v2/status`;
  const headers = buildAuthHeaders(callCtx.bindings);
  const result = await executeRequest(url, callCtx, { headers, action: 'GetStatus' });
  ensureSuccess(result, 'GetStatus');
  const json = parseJsonOrThrow(result, 'GetStatus');
  const cluster = json?.cluster || {};
  return {
    status: 'success',
    cluster: {
      name: toTrimmedString(cluster?.name),
      status: toTrimmedString(cluster?.status),
      peers: (Array.isArray(cluster?.peers) ? cluster.peers : []).map((p) => ({ name: toTrimmedString(p?.name), address: toTrimmedString(p?.address) })),
      raw_json: toJsonString(cluster),
    },
    version_info_json: toJsonString(json?.versionInfo || {}),
    raw_body: result.httpBody,
  };
};

const handleListReceivers = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const url = `${baseUrl}/api/v2/receivers`;
  const headers = buildAuthHeaders(callCtx.bindings);
  const result = await executeRequest(url, callCtx, { headers, action: 'ListReceivers' });
  ensureSuccess(result, 'ListReceivers');
  const json = parseJsonOrThrow(result, 'ListReceivers');
  const receivers = (Array.isArray(json) ? json : []).map((r) => ({
    name: toTrimmedString(r?.name),
    integrations: (Array.isArray(r?.integrations) ? r.integrations : []).map((i) => ({
      name: toTrimmedString(i?.name),
      type: toTrimmedString(i?.type),
      active: toBool(i?.active),
      raw_json: toJsonString(i),
    })),
    raw_json: toJsonString(r),
  }));
  return { status: 'success', receivers, raw_body: result.httpBody };
};

const requestFrom = (ctx = {}) => ctx.request ?? ctx.req ?? {};

export const handlers = {
  [METHOD_LIST_ALERTS_FULL]: (ctx) => handleListAlerts(requestFrom(ctx), ctx),
  [METHOD_GET_ALERT_GROUPS_FULL]: (ctx) => handleGetAlertGroups(requestFrom(ctx), ctx),
  [METHOD_LIST_SILENCES_FULL]: (ctx) => handleListSilences(requestFrom(ctx), ctx),
  [METHOD_GET_SILENCE_FULL]: (ctx) => handleGetSilence(requestFrom(ctx), ctx),
  [METHOD_GET_STATUS_FULL]: (ctx) => handleGetStatus(requestFrom(ctx), ctx),
  [METHOD_LIST_RECEIVERS_FULL]: (ctx) => handleListReceivers(requestFrom(ctx), ctx),
};

export const rpcdef = (ctx) => ({
  '/Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/ListAlerts': (req) => handleListAlerts(req, ctx),
  '/Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/GetAlertGroups': (req) => handleGetAlertGroups(req, ctx),
  '/Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/ListSilences': (req) => handleListSilences(req, ctx),
  '/Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/GetSilence': (req) => handleGetSilence(req, ctx),
  '/Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/GetStatus': () => handleGetStatus({}, ctx),
  '/Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/ListReceivers': () => handleListReceivers({}, ctx),
});

export const _test = { resolveBaseUrl, resolveTimeoutMs, normalizeBaseUrl, buildTlsOptions, executeRequest, toTrimmedString, toBool, toJsonString, errorWithCode, buildAuthHeaders, parseJsonOrThrow, ensureSuccess, tryParseJson, mapHttpStatusToCode, mapAlert, mapSilence, mapMatcher, mapAlertLabels, buildQuery };
