import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_USER = 'admin';
const DEFAULT_FROM = 0;
const DEFAULT_LIMIT = 20;

const DISPOSAL_ACTIONS = ['isolation', 'pause', 'stop', 'kill'];
const CONTROL_ACTIONS = ['resume', 'start', 'activate', 'deactivate'];

const PKG = 'Anyi_CloudNativeSecurity';
const SVC = `${PKG}.${PKG}`;

const METHOD_PATHS = {
  ListWarnings: `/${SVC}/ListWarnings`,
  ListWarningGroups: `/${SVC}/ListWarningGroups`,
  DisposeWarnings: `/${SVC}/DisposeWarnings`,
  DisposeWarningGroups: `/${SVC}/DisposeWarningGroups`,
  ListVulnerabilities: `/${SVC}/ListVulnerabilities`,
  ListHosts: `/${SVC}/ListHosts`,
  ListContainers: `/${SVC}/ListContainers`,
  ListClusters: `/${SVC}/ListClusters`,
  ContainerControl: `/${SVC}/ContainerControl`,
  UnblockNetwork: `/${SVC}/UnblockNetwork`,
};

const FULL_METHODS = {};
for (const [name, path] of Object.entries(METHOD_PATHS)) {
  FULL_METHODS[name] = `${SVC}/${name}`;
}

export { METHOD_PATHS, FULL_METHODS };

// --- Helpers ---

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  DEADLINE_EXCEEDED: grpcStatus.DEADLINE_EXCEEDED,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const firstDefined = (...vals) => vals.find((v) => v !== undefined && v !== null);

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.secret ?? {}),
  ...(ctx?.bindings ?? {}),
});

const parseHeaders = (value) => {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch { return {}; }
  }
  return {};
};

const normalizeBaseUrl = (url) => {
  const base = String(url || '').trim();
  if (!/^https?:\/\//i.test(base)) return null;
  return base.replace(/\/$/, '');
};

const toPositiveInt = (val) => {
  if (val === undefined || val === null) return null;
  if (typeof val === 'object' && 'value' in val) return toPositiveInt(val.value);
  const n = Number(val);
  if (!Number.isInteger(n) || Number.isNaN(n)) return null;
  return n;
};

const toStructValue = (val) => {
  if (val === undefined || val === null) return { nullValue: 'NULL_VALUE' };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'number') return { numberValue: val };
  if (typeof val === 'boolean') return { boolValue: val };
  if (Array.isArray(val)) {
    return { listValue: { values: val.map(toStructValue) } };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      fields[k] = toStructValue(v);
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(val) };
};

const toStruct = (obj) => {
  if (obj === undefined || obj === null) return undefined;
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    fields[k] = toStructValue(v);
  }
  return { fields };
};

const fromStruct = (struct) => {
  if (!struct || !struct.fields) return {};
  const obj = {};
  for (const [k, v] of Object.entries(struct.fields)) {
    obj[k] = fromStructValue(v);
  }
  return obj;
};

const fromStructValue = (sv) => {
  if (!sv) return null;
  if (hasOwn(sv, 'nullValue')) return null;
  if (hasOwn(sv, 'stringValue')) return sv.stringValue;
  if (hasOwn(sv, 'numberValue')) return sv.numberValue;
  if (hasOwn(sv, 'boolValue')) return sv.boolValue;
  if (hasOwn(sv, 'structValue')) return fromStruct(sv.structValue);
  if (hasOwn(sv, 'listValue')) {
    return (sv.listValue?.values ?? []).map(fromStructValue);
  }
  return null;
};

const resolveCallContext = (baseCtx, reqOrCtx, maybeInnerCtx) => {
  if (maybeInnerCtx !== undefined) {
    return { req: reqOrCtx ?? {}, ctx: { ...baseCtx, ...maybeInnerCtx, bindings: mergedBindings({ ...baseCtx, ...maybeInnerCtx }) } };
  }
  const innerCtx = reqOrCtx ?? {};
  return {
    req: innerCtx.request ?? innerCtx.req ?? {},
    ctx: { ...baseCtx, ...innerCtx, bindings: mergedBindings({ ...baseCtx, ...innerCtx }) },
  };
};

// --- DISS HTTP Client ---

// DISS API uses apiKey auth: Authorization header with raw token value (no "Bearer " prefix).
// Verified against real DISS platform — "Bearer " prefix causes TokenInvalided.
const buildHeaders = (token, extraHeaders = {}) => ({
  ...extraHeaders,
  'Content-Type': 'application/json',
  ...(token ? { Authorization: token } : {}),
});

let insecureDispatcherPromise;

const fetchDiss = async (url, init, timeoutMs, skipTlsVerify) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const opts = { ...init, signal: controller.signal };
    if (skipTlsVerify) {
      const { Agent } = await import('undici');
      insecureDispatcherPromise ??= Promise.resolve(new Agent({
        connect: { rejectUnauthorized: false },
      }));
      opts.dispatcher = await insecureDispatcherPromise;
    }
    const res = await fetch(url, opts);
    clearTimeout(timeoutId);
    return res;
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') throw errorWithCode('DEADLINE_EXCEEDED', `request timeout after ${timeoutMs}ms`);
    const reason = e?.cause?.message || e?.message || 'fetch failed';
    throw errorWithCode('UNAVAILABLE', reason);
  }
};

const throwForHttpError = (status, text) => {
  if (status === 401) throw errorWithCode('UNAUTHENTICATED', `upstream http 401: ${text}`);
  if (status === 403) throw errorWithCode('PERMISSION_DENIED', `upstream http 403: ${text}`);
  if (status >= 400 && status < 500) throw errorWithCode('FAILED_PRECONDITION', `upstream http ${status}: ${text}`);
  throw errorWithCode('UNAVAILABLE', `upstream http ${status}: ${text}`);
};

const readJsonResponse = async (res) => {
  const text = await res.text();
  if (!res.ok) throwForHttpError(res.status, text);
  if (!text.trim()) return { code: res.status, message: '', data: null };
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', 'response is not valid JSON');
  }
};

const dissPost = async (baseUrl, path, token, body, query, timeoutMs, skipTlsVerify, extraHeaders) => {
  const qs = query ? '?' + query : '';
  const url = `${baseUrl}${path}${qs}`;
  const headers = buildHeaders(token, extraHeaders);
  const init = { method: 'POST', headers, body: body !== undefined && body !== null ? JSON.stringify(body) : undefined };
  const res = await fetchDiss(url, init, timeoutMs, skipTlsVerify);
  return readJsonResponse(res);
};

// --- Method Implementations ---

const callListWarnings = async (req, bindings, baseUrl, token, timeoutMs, skipTlsVerify, extraHeaders) => {
  const from = toPositiveInt(firstDefined(req?.from, req?.From)) ?? DEFAULT_FROM;
  const limit = toPositiveInt(firstDefined(req?.limit, req?.Limit)) ?? DEFAULT_LIMIT;
  const filter = req?.filter ? fromStruct(req.filter) : {};
  const query = `from=${from}&limit=${limit}`;
  const json = await dissPost(baseUrl, '/api/v1/securitylog/warninginfo', token, filter, query, timeoutMs, skipTlsVerify, extraHeaders);
  return { code: json?.code ?? 200, message: json?.message ?? '', data: toStruct(json?.data) };
};

const callListWarningGroups = async (req, bindings, baseUrl, token, timeoutMs, skipTlsVerify, extraHeaders) => {
  const from = toPositiveInt(firstDefined(req?.from, req?.From)) ?? DEFAULT_FROM;
  const limit = toPositiveInt(firstDefined(req?.limit, req?.Limit)) ?? DEFAULT_LIMIT;
  const filter = req?.filter ? fromStruct(req.filter) : {};
  const query = `from=${from}&limit=${limit}`;
  const json = await dissPost(baseUrl, '/api/v1/securitylog/warninginfogroup', token, filter, query, timeoutMs, skipTlsVerify, extraHeaders);
  return { code: json?.code ?? 200, message: json?.message ?? '', data: toStruct(json?.data) };
};

const callDisposeWarnings = async (req, bindings, baseUrl, token, timeoutMs, skipTlsVerify, extraHeaders) => {
  const action = String(firstDefined(req?.action, req?.Action) || '').trim().toLowerCase();
  if (!action) throw errorWithCode('INVALID_ARGUMENT', 'action is required');
  if (!DISPOSAL_ACTIONS.includes(action)) {
    throw errorWithCode('INVALID_ARGUMENT', `action must be one of: ${DISPOSAL_ACTIONS.join(', ')}`);
  }
  const payload = { Action: action };
  if (req?.account) payload.Account = String(req.account);
  if (Array.isArray(req?.warnings)) payload.WarningInfo = req.warnings.map((w) => fromStructValue(w) ?? w);
  if (Array.isArray(req?.whitelist)) payload.WarningWhiteList = req.whitelist.map((w) => fromStructValue(w) ?? w);
  const json = await dissPost(baseUrl, '/api/v1/securitylog/warninginfo/disposal', token, payload, null, timeoutMs, skipTlsVerify, extraHeaders);
  return { code: json?.code ?? 200, message: json?.message ?? '', data: toStruct(json?.data) };
};

const callDisposeWarningGroups = async (req, bindings, baseUrl, token, timeoutMs, skipTlsVerify, extraHeaders) => {
  const action = String(firstDefined(req?.action, req?.Action) || '').trim().toLowerCase();
  if (!action) throw errorWithCode('INVALID_ARGUMENT', 'action is required');
  if (!DISPOSAL_ACTIONS.includes(action)) {
    throw errorWithCode('INVALID_ARGUMENT', `action must be one of: ${DISPOSAL_ACTIONS.join(', ')}`);
  }
  const payload = { Action: action };
  if (req?.account) payload.Account = String(req.account);
  if (Array.isArray(req?.warning_groups)) payload.WarningInfo = req.warning_groups.map((w) => fromStructValue(w) ?? w);
  if (Array.isArray(req?.whitelist)) payload.WarningWhiteList = req.whitelist.map((w) => fromStructValue(w) ?? w);
  if (hasOwn(req, 'ns_networkpolicy') || hasOwn(req, 'NsNetworkpolicy')) {
    payload.NsNetworkpolicy = Boolean(firstDefined(req?.ns_networkpolicy, req?.NsNetworkpolicy));
  }
  const json = await dissPost(baseUrl, '/api/v1/securitylog/warninginfogroup/disposal', token, payload, null, timeoutMs, skipTlsVerify, extraHeaders);
  return { code: json?.code ?? 200, message: json?.message ?? '', data: toStruct(json?.data) };
};

const callListVulnerabilities = async (req, bindings, baseUrl, token, timeoutMs, skipTlsVerify, extraHeaders) => {
  const from = toPositiveInt(firstDefined(req?.from, req?.From)) ?? DEFAULT_FROM;
  const limit = toPositiveInt(firstDefined(req?.limit, req?.Limit)) ?? DEFAULT_LIMIT;
  const filter = req?.filter ? fromStruct(req.filter) : {};
  const query = `from=${from}&limit=${limit}`;
  const json = await dissPost(baseUrl, '/api/v1/securitylog/vulnerabilitiesscan', token, filter, query, timeoutMs, skipTlsVerify, extraHeaders);
  return { code: json?.code ?? 200, message: json?.message ?? '', data: toStruct(json?.data) };
};

const callListHosts = async (req, bindings, baseUrl, token, timeoutMs, skipTlsVerify, extraHeaders) => {
  const from = toPositiveInt(firstDefined(req?.from, req?.From)) ?? DEFAULT_FROM;
  const limit = toPositiveInt(firstDefined(req?.limit, req?.Limit)) ?? DEFAULT_LIMIT;
  const user = String(firstDefined(req?.user, req?.User, bindings.defaultUser, bindings.DefaultUser, DEFAULT_USER));
  const filter = req?.filter ? fromStruct(req.filter) : {};
  const query = `user=${encodeURIComponent(user)}&from=${from}&limit=${limit}`;
  const json = await dissPost(baseUrl, '/api/v1/asset/hosts/', token, filter, query, timeoutMs, skipTlsVerify, extraHeaders);
  return { code: json?.code ?? 200, message: json?.message ?? '', data: toStruct(json?.data) };
};

const callListContainers = async (req, bindings, baseUrl, token, timeoutMs, skipTlsVerify, extraHeaders) => {
  const from = toPositiveInt(firstDefined(req?.from, req?.From)) ?? DEFAULT_FROM;
  const limit = toPositiveInt(firstDefined(req?.limit, req?.Limit)) ?? DEFAULT_LIMIT;
  const filter = req?.filter ? fromStruct(req.filter) : {};
  const query = `from=${from}&limit=${limit}`;
  const json = await dissPost(baseUrl, '/api/v1/containers/', token, filter, query, timeoutMs, skipTlsVerify, extraHeaders);
  return { code: json?.code ?? 200, message: json?.message ?? '', data: toStruct(json?.data) };
};

const callListClusters = async (req, bindings, baseUrl, token, timeoutMs, skipTlsVerify, extraHeaders) => {
  const from = toPositiveInt(firstDefined(req?.from, req?.From)) ?? DEFAULT_FROM;
  const limit = toPositiveInt(firstDefined(req?.limit, req?.Limit)) ?? DEFAULT_LIMIT;
  const filter = req?.filter ? fromStruct(req.filter) : {};
  const query = `from=${from}&limit=${limit}`;
  const json = await dissPost(baseUrl, '/api/v1/k8s/clusters', token, filter, query, timeoutMs, skipTlsVerify, extraHeaders);
  return { code: json?.code ?? 200, message: json?.message ?? '', data: toStruct(json?.data) };
};

const callContainerControl = async (req, bindings, baseUrl, token, timeoutMs, skipTlsVerify, extraHeaders) => {
  const action = String(firstDefined(req?.action, req?.Action) || '').trim().toLowerCase();
  if (!action) throw errorWithCode('INVALID_ARGUMENT', 'action is required');
  if (!CONTROL_ACTIONS.includes(action)) {
    throw errorWithCode('INVALID_ARGUMENT', `action must be one of: ${CONTROL_ACTIONS.join(', ')}`);
  }
  const containerId = String(firstDefined(req?.container_id, req?.containerId, req?.ContainerId) || '').trim();
  if (!containerId) throw errorWithCode('INVALID_ARGUMENT', 'container_id is required');

  const payload = { Action: action, ContainerId: containerId };
  if (req?.container_name) payload.ContainerName = String(req.container_name);
  if (req?.host_id) payload.HostId = String(req.host_id);
  if (req?.cluster_id) payload.ClusterId = String(req.cluster_id);
  if (req?.cluster_id) payload.Cluster = String(req.cluster_id);
  if (req?.analysis) payload.Analysis = String(req.analysis);
  if (req?.analysis) payload.ProcessNote = String(req.analysis);

  const json = await dissPost(baseUrl, '/api/v1/system/respcenter/operation', token, payload, null, timeoutMs, skipTlsVerify, extraHeaders);
  return { code: json?.code ?? 200, message: json?.message ?? '', data: toStruct(json?.data) };
};

const callUnblockNetwork = async (req, bindings, baseUrl, token, timeoutMs, skipTlsVerify, extraHeaders) => {
  const containerId = String(firstDefined(req?.container_id, req?.containerId, req?.ContainerId) || '').trim();
  if (!containerId) throw errorWithCode('INVALID_ARGUMENT', 'container_id is required');

  const payload = { ContainerId: containerId };
  if (req?.host_id) payload.HostId = String(req.host_id);
  if (req?.cluster_id) payload.ClusterId = String(req.cluster_id);

  const json = await dissPost(baseUrl, '/api/v1/system/respcenter/unblock-network', token, payload, null, timeoutMs, skipTlsVerify, extraHeaders);
  return { code: json?.code ?? 200, message: json?.message ?? '', data: toStruct(json?.data) };
};

// --- rpcdef & handlers ---

export function rpcdef(ctx) {
  const bindings = mergedBindings(ctx);
  const baseUrl = normalizeBaseUrl(bindings.endpoint || bindings.restBaseUrl || bindings.baseUrl || bindings.base_url || '');
  if (!baseUrl) throw errorWithCode('INVALID_ARGUMENT', 'endpoint is required (http/https)');

  const token = String(bindings.token || '').trim();
  const timeoutMs = Number(firstDefined(bindings.timeoutMs, bindings.timeout_ms, ctx?.limits?.timeoutMs, DEFAULT_TIMEOUT_MS));
  const effectiveTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const skipTlsVerify = Boolean(bindings.skipTlsVerify || bindings.tlsInsecureSkipVerify || bindings.skip_tls_verify);
  const baseHeaders = parseHeaders(bindings.headers);
  const meta = ctx.meta || {};

  const logFlow = (action, details) => {
    const inst = meta.instance_id || meta.instanceId;
    const reqId = meta.request_id || meta.requestId;
    const prefix = `[Anyi_CloudNativeSecurity][${action}]${inst ? `[inst=${inst}]` : ''}${reqId ? `[req=${reqId}]` : ''}`;
    try { console.log(prefix, JSON.stringify(details)); } catch { console.log(prefix, details); }
  };

  const requestWithDefaults = (req = {}) => req;

  return {
    [METHOD_PATHS.ListWarnings]: async () => callListWarnings(requestWithDefaults(ctx.req), bindings, baseUrl, token, effectiveTimeout, skipTlsVerify, baseHeaders),
    [METHOD_PATHS.ListWarningGroups]: async () => callListWarningGroups(requestWithDefaults(ctx.req), bindings, baseUrl, token, effectiveTimeout, skipTlsVerify, baseHeaders),
    [METHOD_PATHS.DisposeWarnings]: async () => {
      logFlow('DisposeWarnings:start', { action: ctx.req?.action });
      const result = await callDisposeWarnings(requestWithDefaults(ctx.req), bindings, baseUrl, token, effectiveTimeout, skipTlsVerify, baseHeaders);
      logFlow('DisposeWarnings:done', { action: ctx.req?.action });
      return result;
    },
    [METHOD_PATHS.DisposeWarningGroups]: async () => {
      logFlow('DisposeWarningGroups:start', { action: ctx.req?.action });
      const result = await callDisposeWarningGroups(requestWithDefaults(ctx.req), bindings, baseUrl, token, effectiveTimeout, skipTlsVerify, baseHeaders);
      logFlow('DisposeWarningGroups:done', { action: ctx.req?.action });
      return result;
    },
    [METHOD_PATHS.ListVulnerabilities]: async () => callListVulnerabilities(requestWithDefaults(ctx.req), bindings, baseUrl, token, effectiveTimeout, skipTlsVerify, baseHeaders),
    [METHOD_PATHS.ListHosts]: async () => callListHosts(requestWithDefaults(ctx.req), bindings, baseUrl, token, effectiveTimeout, skipTlsVerify, baseHeaders),
    [METHOD_PATHS.ListContainers]: async () => callListContainers(requestWithDefaults(ctx.req), bindings, baseUrl, token, effectiveTimeout, skipTlsVerify, baseHeaders),
    [METHOD_PATHS.ListClusters]: async () => callListClusters(requestWithDefaults(ctx.req), bindings, baseUrl, token, effectiveTimeout, skipTlsVerify, baseHeaders),
    [METHOD_PATHS.ContainerControl]: async () => {
      logFlow('ContainerControl:start', { action: ctx.req?.action, container_id: ctx.req?.container_id });
      const result = await callContainerControl(requestWithDefaults(ctx.req), bindings, baseUrl, token, effectiveTimeout, skipTlsVerify, baseHeaders);
      logFlow('ContainerControl:done', { action: ctx.req?.action });
      return result;
    },
    [METHOD_PATHS.UnblockNetwork]: async () => {
      logFlow('UnblockNetwork:start', { container_id: ctx.req?.container_id });
      const result = await callUnblockNetwork(requestWithDefaults(ctx.req), bindings, baseUrl, token, effectiveTimeout, skipTlsVerify, baseHeaders);
      logFlow('UnblockNetwork:done', { container_id: ctx.req?.container_id });
      return result;
    },
  };
}

const mergeCtx = (baseCtx, innerCtx) => ({
  ...(baseCtx ?? {}),
  ...(innerCtx ?? {}),
  bindings: { ...(baseCtx?.bindings ?? {}), ...(innerCtx?.bindings ?? {}) },
  config: { ...(baseCtx?.config ?? {}), ...(innerCtx?.config ?? {}) },
  secret: { ...(baseCtx?.secret ?? {}), ...(innerCtx?.secret ?? {}) },
  limits: innerCtx?.limits ?? baseCtx?.limits ?? {},
  meta: innerCtx?.meta ?? baseCtx?.meta ?? {},
  metadata: innerCtx?.metadata ?? baseCtx?.metadata ?? {},
  getMetadata: innerCtx?.getMetadata ?? baseCtx?.getMetadata,
});

const wrapLegacyHandler = (baseCtx, methodPath) => async (reqOrCtx, maybeInnerCtx) => {
  const call = resolveCallContext(baseCtx, reqOrCtx, maybeInnerCtx);
  const legacyCtx = { ...call.ctx, req: call.req };
  return rpcdef(legacyCtx)[methodPath]();
};

const registerHandlers = (ctx = {}) => ({
  [METHOD_PATHS.ListWarnings]: wrapLegacyHandler(ctx, METHOD_PATHS.ListWarnings),
  [METHOD_PATHS.ListWarningGroups]: wrapLegacyHandler(ctx, METHOD_PATHS.ListWarningGroups),
  [METHOD_PATHS.DisposeWarnings]: wrapLegacyHandler(ctx, METHOD_PATHS.DisposeWarnings),
  [METHOD_PATHS.DisposeWarningGroups]: wrapLegacyHandler(ctx, METHOD_PATHS.DisposeWarningGroups),
  [METHOD_PATHS.ListVulnerabilities]: wrapLegacyHandler(ctx, METHOD_PATHS.ListVulnerabilities),
  [METHOD_PATHS.ListHosts]: wrapLegacyHandler(ctx, METHOD_PATHS.ListHosts),
  [METHOD_PATHS.ListContainers]: wrapLegacyHandler(ctx, METHOD_PATHS.ListContainers),
  [METHOD_PATHS.ListClusters]: wrapLegacyHandler(ctx, METHOD_PATHS.ListClusters),
  [METHOD_PATHS.ContainerControl]: wrapLegacyHandler(ctx, METHOD_PATHS.ContainerControl),
  [METHOD_PATHS.UnblockNetwork]: wrapLegacyHandler(ctx, METHOD_PATHS.UnblockNetwork),
});

const callSdkHandler = (ctx, path) => {
  const handler = registerHandlers({})(path);
  return handler(ctx);
};

const sdkHandlers = registerHandlers({});

export const handlers = {
  [FULL_METHODS.ListWarnings]: (ctx) => sdkHandlers[METHOD_PATHS.ListWarnings](ctx),
  [FULL_METHODS.ListWarningGroups]: (ctx) => sdkHandlers[METHOD_PATHS.ListWarningGroups](ctx),
  [FULL_METHODS.DisposeWarnings]: (ctx) => sdkHandlers[METHOD_PATHS.DisposeWarnings](ctx),
  [FULL_METHODS.DisposeWarningGroups]: (ctx) => sdkHandlers[METHOD_PATHS.DisposeWarningGroups](ctx),
  [FULL_METHODS.ListVulnerabilities]: (ctx) => sdkHandlers[METHOD_PATHS.ListVulnerabilities](ctx),
  [FULL_METHODS.ListHosts]: (ctx) => sdkHandlers[METHOD_PATHS.ListHosts](ctx),
  [FULL_METHODS.ListContainers]: (ctx) => sdkHandlers[METHOD_PATHS.ListContainers](ctx),
  [FULL_METHODS.ListClusters]: (ctx) => sdkHandlers[METHOD_PATHS.ListClusters](ctx),
  [FULL_METHODS.ContainerControl]: (ctx) => sdkHandlers[METHOD_PATHS.ContainerControl](ctx),
  [FULL_METHODS.UnblockNetwork]: (ctx) => sdkHandlers[METHOD_PATHS.UnblockNetwork](ctx),
};

export const _test = {
  CONTROL_ACTIONS,
  DISPOSAL_ACTIONS,
  errorWithCode,
  firstDefined,
  fromStruct,
  fromStructValue,
  hasOwn,
  mergedBindings,
  normalizeBaseUrl,
  parseHeaders,
  toPositiveInt,
  toStruct,
  toStructValue,
};
