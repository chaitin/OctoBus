import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const METHOD_LIST_NAMESPACES_FULL = 'Kubernetes_API.Kubernetes_API/ListNamespaces';
export const METHOD_LIST_PODS_FULL = 'Kubernetes_API.Kubernetes_API/ListPods';
export const METHOD_LIST_SERVICES_FULL = 'Kubernetes_API.Kubernetes_API/ListServices';
export const METHOD_LIST_DEPLOYMENTS_FULL = 'Kubernetes_API.Kubernetes_API/ListDeployments';
export const METHOD_LIST_NODES_FULL = 'Kubernetes_API.Kubernetes_API/ListNodes';
export const METHOD_GET_POD_FULL = 'Kubernetes_API.Kubernetes_API/GetPod';
export const METHOD_GET_POD_LOGS_FULL = 'Kubernetes_API.Kubernetes_API/GetPodLogs';

export const DEFAULT_TIMEOUT_MS = 15000;
export const MAX_TIMEOUT_MS = 120000;
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  NOT_FOUND: grpcStatus.NOT_FOUND,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => { const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`); err.legacyCode = code; return err; };
const firstDefined = (...values) => values.find((v) => v !== undefined && v !== null);
const unwrapScalar = (v) => { if (v === undefined || v === null) return undefined; if (typeof v === 'object' && v !== null && Object.prototype.hasOwnProperty.call(v, 'value')) return unwrapScalar(v.value); return v; };
const toTrimmedString = (v) => { const r = unwrapScalar(v); return r === undefined || r === null ? '' : String(r).trim(); };
const toFiniteInt = (v, fallback = 0) => { const r = unwrapScalar(v); if (r === undefined || r === null || r === '') return fallback; const n = Number(r); return Number.isFinite(n) ? Math.trunc(n) : fallback; };
const toBool = (v, fallback = false) => { const r = unwrapScalar(v); if (r === undefined || r === null) return fallback; if (typeof r === 'boolean') return r; if (typeof r === 'number') return r !== 0; if (typeof r === 'string') { const n = r.trim().toLowerCase(); if (['true','1','yes','on'].includes(n)) return true; if (['false','0','no','off',''].includes(n)) return false; } return fallback; };
const toJsonString = (v) => { if (v === undefined || v === null) return ''; if (typeof v === 'string') return v; try { return JSON.stringify(v); } catch { return ''; } };
const strToMap = (obj) => { const m = {}; if (obj && typeof obj === 'object' && !Array.isArray(obj)) { for (const [k, v] of Object.entries(obj)) m[String(k)] = String(v ?? ''); } return m; };
const normalizeBaseUrl = (v, bindings = {}) => {
  const raw = toTrimmedString(v);
  let url;
  try { url = new URL(raw); } catch { return ''; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return '';
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol === 'http:' && !loopback && !toBool(bindings.allowInsecureHttp)) return '';
  return url.toString().replace(/\/+$/, '');
};

const mergedBindings = (ctx = {}) => ({ ...(ctx.config ?? {}), ...(ctx.secret ?? {}), ...(ctx.bindings ?? {}) });
const resolveCallContext = (ctx = {}) => ({ ...ctx, bindings: mergedBindings(ctx), limits: ctx.limits ?? {}, meta: ctx.meta ?? {}, req: ctx.req ?? ctx.request ?? {} });
const resolveBaseUrl = (bindings = {}) => normalizeBaseUrl(firstDefined(bindings.baseUrl, bindings.domain, bindings.url), bindings);
const resolveTimeoutMs = (ctx = {}) => { const r = Number(firstDefined(ctx.limits?.timeoutMs, ctx.bindings?.timeoutMs, DEFAULT_TIMEOUT_MS)); return Number.isFinite(r) && r > 0 ? Math.min(Math.trunc(r), MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS; };
const insecureDispatcher = new Agent({ connect: { rejectUnauthorized: false } });
const buildTlsOptions = (bindings = {}) => toBool(firstDefined(bindings.skipTlsVerify, bindings.tlsInsecureSkipVerify, bindings.insecureSkipVerify))
  ? { dispatcher: insecureDispatcher }
  : {};

const requireBaseUrl = (ctx = {}) => { const u = resolveBaseUrl(ctx.bindings || {}); if (!u) throw errorWithCode('INVALID_ARGUMENT', 'baseUrl must be a valid http(s) URL without credentials, query, or fragment; non-loopback HTTP requires allowInsecureHttp'); return u; };

const buildAuthHeaders = (bindings = {}) => {
  const headers = {};
  const token = toTrimmedString(firstDefined(bindings.token, bindings.bearerToken));
  if (token) { headers.Authorization = `Bearer ${token}`; return headers; }
  const username = toTrimmedString(firstDefined(bindings.username, bindings.user));
  const password = toTrimmedString(firstDefined(bindings.password, bindings.passwd));
  if (username && password) headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
  return headers;
};

const attachResponse = (err, response) => { err.response = response; return err; };
const tryParseJson = (t) => { try { return { ok: true, value: JSON.parse(t) }; } catch { return { ok: false }; } };
const mapHttpStatusToCode = (s) => { if (s === 401) return 'PERMISSION_DENIED'; if (s === 403) return 'PERMISSION_DENIED'; if (s === 404) return 'NOT_FOUND'; if (s >= 400 && s < 500) return 'FAILED_PRECONDITION'; return 'UNAVAILABLE'; };

const buildLogPrefix = (ctx = {}, action) => { const meta = ctx.meta || {}; const trace = []; if (meta.instance_id || meta.instanceId) trace.push(`inst=${meta.instance_id || meta.instanceId}`); return `[Kubernetes_API][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`; };
const logFlow = (ctx, action, details) => { try { console.log(buildLogPrefix(ctx, action), JSON.stringify(details)); } catch { console.log(buildLogPrefix(ctx, action), details); } };

const readResponseBody = async (res, maxBytes = MAX_RESPONSE_BYTES) => {
  const declared = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw errorWithCode('UNAVAILABLE', `upstream response exceeds ${maxBytes} bytes`);
  if (!res.body?.getReader) {
    const text = await res.text();
    if (Buffer.byteLength(text) > maxBytes) throw errorWithCode('UNAVAILABLE', `upstream response exceeds ${maxBytes} bytes`);
    return text;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw errorWithCode('UNAVAILABLE', `upstream response exceeds ${maxBytes} bytes`); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size).toString('utf8');
};

const executeRequest = async (url, ctx = {}, options = {}) => {
  const timeoutMs = resolveTimeoutMs(ctx);
  const headers = { Accept: 'application/json', ...(options.headers ?? {}) };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const init = { method: options.method || 'GET', headers, signal: controller.signal, redirect: 'manual', ...buildTlsOptions(ctx.bindings || {}), ...(options.body !== undefined ? { body: options.body } : {}) };
  let res;
  let rawBody;
  try {
    res = await fetch(url, init);
    rawBody = await readResponseBody(res);
  } catch (err) {
    if (err instanceof GrpcError) throw err;
    const message = err?.name === 'AbortError' ? 'request timed out' : (err?.cause?.message || err?.message || 'fetch failed');
    throw attachResponse(errorWithCode('UNAVAILABLE', `${options.action || 'fetch'} failed: ${message}`), { http_status: Number(res?.status || 0), http_body: '' });
  } finally { clearTimeout(timer); }
  const httpStatus = Number(res.status || 0);
  logFlow(ctx, 'fetch:response', { httpStatus, bodyLength: Buffer.byteLength(rawBody || '') });
  return { httpStatus, httpBody: String(rawBody ?? '') };
};

const ensureSuccess = (result, action) => { if (result.httpStatus >= 200 && result.httpStatus < 300) return; const c = mapHttpStatusToCode(result.httpStatus); throw attachResponse(errorWithCode(c, `${action} upstream http ${result.httpStatus}`), { http_status: result.httpStatus, http_body: '' }); };
const parseJsonOrThrow = (result, action) => { const t = (result.httpBody || '').trim(); if (!t) throw attachResponse(errorWithCode('UNKNOWN', `${action} returned empty response`), { http_status: result.httpStatus, http_body: '' }); const p = tryParseJson(t); if (!p.ok) throw attachResponse(errorWithCode('UNKNOWN', `${action} response is not valid JSON`), { http_status: result.httpStatus, http_body: t }); return p.value; };

const mapObjectMeta = (meta = {}) => ({
  name: toTrimmedString(meta?.name),
  namespace: toTrimmedString(meta?.namespace),
  uid: toTrimmedString(meta?.uid),
  resource_version: toTrimmedString(meta?.resourceVersion),
  creation_timestamp: toTrimmedString(meta?.creationTimestamp),
  deletion_timestamp: toTrimmedString(meta?.deletionTimestamp),
  labels: strToMap(meta?.labels),
  annotations: strToMap(meta?.annotations),
  raw_json: toJsonString(meta),
});

const buildQuery = (params = {}) => { const parts = []; for (const [k, v] of Object.entries(params)) { if (v === undefined || v === null || v === '') continue; parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`); } return parts.length ? '?' + parts.join('&') : ''; };

const mapListMeta = (json) => ({
  continue_token: toTrimmedString(json?.metadata?.continue),
  remaining_item_count: toFiniteInt(json?.metadata?.remainingItemCount),
});

const handleListNamespaces = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const params = {};
  if (req.label_selector) params.labelSelector = toTrimmedString(req.label_selector);
  if (req.field_selector) params.fieldSelector = toTrimmedString(req.field_selector);
  if (req.limit) params.limit = String(toFiniteInt(req.limit));
  if (req.continue_token) params.continue = toTrimmedString(req.continue_token);
  const url = `${baseUrl}/api/v1/namespaces${buildQuery(params)}`;
  const headers = buildAuthHeaders(callCtx.bindings);
  const result = await executeRequest(url, callCtx, { headers, action: 'ListNamespaces' });
  ensureSuccess(result, 'ListNamespaces');
  const json = parseJsonOrThrow(result, 'ListNamespaces');
  const items = (Array.isArray(json?.items) ? json.items : []).map((ns) => ({
    metadata: mapObjectMeta(ns?.metadata),
    status: { phase: toTrimmedString(ns?.status?.phase), raw_json: toJsonString(ns?.status) },
    raw_json: toJsonString(ns),
  }));
  return { items, raw_body: result.httpBody, ...mapListMeta(json) };
};

const mapContainerState = (cs = {}) => ({
  state: toTrimmedString(firstDefined(cs?.state?.running ? 'running' : undefined, cs?.state?.waiting ? 'waiting' : undefined, cs?.state?.terminated ? 'terminated' : undefined)),
  reason: toTrimmedString(firstDefined(cs?.state?.waiting?.reason, cs?.state?.terminated?.reason, '')),
  message: toTrimmedString(firstDefined(cs?.state?.waiting?.message, cs?.state?.terminated?.message, '')),
  started_at: toTrimmedString(cs?.state?.running?.startedAt),
  finished_at: toTrimmedString(cs?.state?.terminated?.finishedAt),
  restart_count: toFiniteInt(cs?.restartCount),
  image: toTrimmedString(cs?.image),
  image_id: toTrimmedString(cs?.imageID),
  container_id: toTrimmedString(cs?.containerID),
  ready: toBool(cs?.ready),
  started: toBool(cs?.started),
  raw_json: toJsonString(cs),
});

const mapPodContainer = (c = {}) => ({
  name: toTrimmedString(c?.name),
  image: toTrimmedString(c?.image),
  ports: (Array.isArray(c?.ports) ? c.ports : []).map((p) => `${p?.containerPort || ''}/${p?.protocol || 'TCP'}`),
  raw_json: toJsonString(c),
});

const mapPodInfo = (pod = {}) => ({
  metadata: mapObjectMeta(pod?.metadata),
  status: {
    phase: toTrimmedString(pod?.status?.phase),
    host_ip: toTrimmedString(pod?.status?.hostIP),
    pod_ip: toTrimmedString(pod?.status?.podIP),
    start_time: toTrimmedString(pod?.status?.startTime),
    qos_class: toTrimmedString(pod?.status?.qosClass),
    container_statuses: (Array.isArray(pod?.status?.containerStatuses) ? pod.status.containerStatuses : []).map(mapContainerState),
    raw_json: toJsonString(pod?.status),
  },
  containers: (Array.isArray(pod?.spec?.containers) ? pod.spec.containers : []).map(mapPodContainer),
  node_name: toTrimmedString(pod?.spec?.nodeName),
  raw_json: toJsonString(pod),
});

const handleListPods = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const ns = toTrimmedString(req.namespace);
  const params = {};
  if (req.label_selector) params.labelSelector = toTrimmedString(req.label_selector);
  if (req.field_selector) params.fieldSelector = toTrimmedString(req.field_selector);
  if (req.limit) params.limit = String(toFiniteInt(req.limit));
  if (req.continue_token) params.continue = toTrimmedString(req.continue_token);
  const path = ns ? `/api/v1/namespaces/${encodeURIComponent(ns)}/pods` : '/api/v1/pods';
  const url = `${baseUrl}${path}${buildQuery(params)}`;
  const headers = buildAuthHeaders(callCtx.bindings);
  const result = await executeRequest(url, callCtx, { headers, action: 'ListPods' });
  ensureSuccess(result, 'ListPods');
  const json = parseJsonOrThrow(result, 'ListPods');
  const items = (Array.isArray(json?.items) ? json.items : []).map(mapPodInfo);
  return { items, raw_body: result.httpBody, ...mapListMeta(json) };
};

const handleListServices = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const ns = toTrimmedString(req.namespace);
  const params = {};
  if (req.label_selector) params.labelSelector = toTrimmedString(req.label_selector);
  if (req.limit) params.limit = String(toFiniteInt(req.limit));
  if (req.continue_token) params.continue = toTrimmedString(req.continue_token);
  const path = ns ? `/api/v1/namespaces/${encodeURIComponent(ns)}/services` : '/api/v1/services';
  const url = `${baseUrl}${path}${buildQuery(params)}`;
  const headers = buildAuthHeaders(callCtx.bindings);
  const result = await executeRequest(url, callCtx, { headers, action: 'ListServices' });
  ensureSuccess(result, 'ListServices');
  const json = parseJsonOrThrow(result, 'ListServices');
  const items = (Array.isArray(json?.items) ? json.items : []).map((svc) => ({
    metadata: mapObjectMeta(svc?.metadata),
    cluster_ip: toTrimmedString(svc?.spec?.clusterIP),
    type: toTrimmedString(svc?.spec?.type),
    ports: (Array.isArray(svc?.spec?.ports) ? svc.spec.ports : []).map((p) => ({
      name: toTrimmedString(p?.name), protocol: toTrimmedString(p?.protocol), port: toFiniteInt(p?.port), target_port: toFiniteInt(p?.targetPort), node_port: toFiniteInt(p?.nodePort), raw_json: toJsonString(p),
    })),
    selector: strToMap(svc?.spec?.selector),
    raw_json: toJsonString(svc),
  }));
  return { items, raw_body: result.httpBody, ...mapListMeta(json) };
};

const handleListDeployments = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const ns = toTrimmedString(req.namespace);
  const params = {};
  if (req.label_selector) params.labelSelector = toTrimmedString(req.label_selector);
  if (req.limit) params.limit = String(toFiniteInt(req.limit));
  if (req.continue_token) params.continue = toTrimmedString(req.continue_token);
  const path = ns ? `/apis/apps/v1/namespaces/${encodeURIComponent(ns)}/deployments` : '/apis/apps/v1/deployments';
  const url = `${baseUrl}${path}${buildQuery(params)}`;
  const headers = buildAuthHeaders(callCtx.bindings);
  const result = await executeRequest(url, callCtx, { headers, action: 'ListDeployments' });
  ensureSuccess(result, 'ListDeployments');
  const json = parseJsonOrThrow(result, 'ListDeployments');
  const items = (Array.isArray(json?.items) ? json.items : []).map((d) => ({
    metadata: mapObjectMeta(d?.metadata),
    status: {
      replicas: toFiniteInt(d?.status?.replicas),
      ready_replicas: toFiniteInt(d?.status?.readyReplicas),
      available_replicas: toFiniteInt(d?.status?.availableReplicas),
      unavailable_replicas: toFiniteInt(d?.status?.unavailableReplicas),
      updated_replicas: toFiniteInt(d?.status?.updatedReplicas),
      conditions: (Array.isArray(d?.status?.conditions) ? d.status.conditions : []).map((c) => ({ type: toTrimmedString(c?.type), status: toTrimmedString(c?.status), reason: toTrimmedString(c?.reason), message: toTrimmedString(c?.message), raw_json: toJsonString(c) })),
      raw_json: toJsonString(d?.status),
    },
    raw_json: toJsonString(d),
  }));
  return { items, raw_body: result.httpBody, ...mapListMeta(json) };
};

const handleListNodes = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const params = {};
  if (req.label_selector) params.labelSelector = toTrimmedString(req.label_selector);
  if (req.limit) params.limit = String(toFiniteInt(req.limit));
  if (req.continue_token) params.continue = toTrimmedString(req.continue_token);
  const url = `${baseUrl}/api/v1/nodes${buildQuery(params)}`;
  const headers = buildAuthHeaders(callCtx.bindings);
  const result = await executeRequest(url, callCtx, { headers, action: 'ListNodes' });
  ensureSuccess(result, 'ListNodes');
  const json = parseJsonOrThrow(result, 'ListNodes');
  const items = (Array.isArray(json?.items) ? json.items : []).map((n) => ({
    metadata: mapObjectMeta(n?.metadata),
    status: {
      phase: toTrimmedString(n?.status?.phase),
      addresses: (Array.isArray(n?.status?.addresses) ? n.status.addresses : []).map((a) => ({ type: toTrimmedString(a?.type), address: toTrimmedString(a?.address) })),
      conditions: (Array.isArray(n?.status?.conditions) ? n.status.conditions : []).map((c) => ({ type: toTrimmedString(c?.type), status: toTrimmedString(c?.status), reason: toTrimmedString(c?.reason), message: toTrimmedString(c?.message), last_heartbeat: toTrimmedString(c?.lastHeartbeatTime), last_transition: toTrimmedString(c?.lastTransitionTime), raw_json: toJsonString(c) })),
      capacity: { cpu: toTrimmedString(n?.status?.capacity?.cpu), memory: toTrimmedString(n?.status?.capacity?.memory), pods: toTrimmedString(n?.status?.capacity?.pods), raw_json: toJsonString(n?.status?.capacity) },
      allocatable: { cpu: toTrimmedString(n?.status?.allocatable?.cpu), memory: toTrimmedString(n?.status?.allocatable?.memory), pods: toTrimmedString(n?.status?.allocatable?.pods), raw_json: toJsonString(n?.status?.allocatable) },
      kubelet_version: toTrimmedString(n?.status?.nodeInfo?.kubeletVersion),
      os_image: toTrimmedString(n?.status?.nodeInfo?.osImage),
      kernel_version: toTrimmedString(n?.status?.nodeInfo?.kernelVersion),
      container_runtime: toTrimmedString(n?.status?.nodeInfo?.containerRuntimeVersion),
      architecture: toTrimmedString(n?.status?.nodeInfo?.architecture),
      raw_json: toJsonString(n?.status),
    },
    raw_json: toJsonString(n),
  }));
  return { items, raw_body: result.httpBody, ...mapListMeta(json) };
};

const handleGetPod = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const ns = toTrimmedString(req.namespace);
  const name = toTrimmedString(req.name);
  if (!ns) throw errorWithCode('INVALID_ARGUMENT', 'namespace is required');
  if (!name) throw errorWithCode('INVALID_ARGUMENT', 'name is required');
  const url = `${baseUrl}/api/v1/namespaces/${encodeURIComponent(ns)}/pods/${encodeURIComponent(name)}`;
  const headers = buildAuthHeaders(callCtx.bindings);
  const result = await executeRequest(url, callCtx, { headers, action: 'GetPod' });
  ensureSuccess(result, 'GetPod');
  const json = parseJsonOrThrow(result, 'GetPod');
  return { pod: mapPodInfo(json), raw_body: result.httpBody };
};

const handleGetPodLogs = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const ns = toTrimmedString(req.namespace);
  const name = toTrimmedString(req.name);
  if (!ns) throw errorWithCode('INVALID_ARGUMENT', 'namespace is required');
  if (!name) throw errorWithCode('INVALID_ARGUMENT', 'name is required');
  const params = {};
  if (req.container) params.container = toTrimmedString(req.container);
  if (req.tail_lines !== undefined && req.tail_lines !== null) {
    const tailLines = toFiniteInt(req.tail_lines, -1);
    if (tailLines < 0) throw errorWithCode('INVALID_ARGUMENT', 'tail_lines must be a non-negative integer');
    params.tailLines = String(tailLines);
  }
  if (req.since_seconds !== undefined && req.since_seconds !== null) {
    const sinceSeconds = toFiniteInt(req.since_seconds, -1);
    if (sinceSeconds < 0) throw errorWithCode('INVALID_ARGUMENT', 'since_seconds must be a non-negative integer');
    params.sinceSeconds = String(sinceSeconds);
  }
  if (toBool(req.previous)) params.previous = 'true';
  if (toBool(req.timestamps)) params.timestamps = 'true';
  const url = `${baseUrl}/api/v1/namespaces/${encodeURIComponent(ns)}/pods/${encodeURIComponent(name)}/log${buildQuery(params)}`;
  // The pod log subresource returns text, but kube-apiserver content negotiation
  // rejects `Accept: text/plain`; use the wildcard accepted by the official API.
  const headers = { ...buildAuthHeaders(callCtx.bindings), Accept: '*/*' };
  const result = await executeRequest(url, callCtx, { headers, action: 'GetPodLogs' });
  ensureSuccess(result, 'GetPodLogs');
  return { logs: result.httpBody || '', raw_body: result.httpBody };
};

export const handlers = {
  [METHOD_LIST_NAMESPACES_FULL]: (ctx) => handleListNamespaces(ctx.request ?? {}, ctx),
  [METHOD_LIST_PODS_FULL]: (ctx) => handleListPods(ctx.request ?? {}, ctx),
  [METHOD_LIST_SERVICES_FULL]: (ctx) => handleListServices(ctx.request ?? {}, ctx),
  [METHOD_LIST_DEPLOYMENTS_FULL]: (ctx) => handleListDeployments(ctx.request ?? {}, ctx),
  [METHOD_LIST_NODES_FULL]: (ctx) => handleListNodes(ctx.request ?? {}, ctx),
  [METHOD_GET_POD_FULL]: (ctx) => handleGetPod(ctx.request ?? {}, ctx),
  [METHOD_GET_POD_LOGS_FULL]: (ctx) => handleGetPodLogs(ctx.request ?? {}, ctx),
};

export const _test = { resolveBaseUrl, resolveTimeoutMs, buildTlsOptions, readResponseBody, toTrimmedString, toFiniteInt, toBool, toJsonString, errorWithCode, buildAuthHeaders, parseJsonOrThrow, ensureSuccess, tryParseJson, mapObjectMeta, mapPodInfo, mapContainerState, mapPodContainer, mapListMeta, buildQuery, strToMap };
