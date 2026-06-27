// Crowdsec_SECURITY_ENGINE — Crowdsec LAPI REST proxy implementation
// Bindings: endpoint (required), timeoutMs (optional), skipTlsVerify (optional)
// Secret: machineId + password (JWT auth), apiKey (Bouncer API Key auth)

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_BLOCK_DURATION = '4h';
const DEFAULT_DECISION_TYPE = 'ban';
const DEFAULT_SCOPE = 'ip';
const DEFAULT_REASON = 'manual block via OctoBus';

const METHOD_LIST_ALERTS = '/Crowdsec_SECURITY_ENGINE.Crowdsec_SECURITY_ENGINE/ListAlerts';
const METHOD_GET_ALERT = '/Crowdsec_SECURITY_ENGINE.Crowdsec_SECURITY_ENGINE/GetAlert';
const METHOD_LIST_DECISIONS = '/Crowdsec_SECURITY_ENGINE.Crowdsec_SECURITY_ENGINE/ListDecisions';
const METHOD_BLOCK_IP = '/Crowdsec_SECURITY_ENGINE.Crowdsec_SECURITY_ENGINE/BlockIP';
const METHOD_UNBLOCK_IP = '/Crowdsec_SECURITY_ENGINE.Crowdsec_SECURITY_ENGINE/UnblockIP';
const METHOD_DELETE_DECISION = '/Crowdsec_SECURITY_ENGINE.Crowdsec_SECURITY_ENGINE/DeleteDecision';

export const METHOD_LIST_ALERTS_FULL = 'Crowdsec_SECURITY_ENGINE.Crowdsec_SECURITY_ENGINE/ListAlerts';
export const METHOD_GET_ALERT_FULL = 'Crowdsec_SECURITY_ENGINE.Crowdsec_SECURITY_ENGINE/GetAlert';
export const METHOD_LIST_DECISIONS_FULL = 'Crowdsec_SECURITY_ENGINE.Crowdsec_SECURITY_ENGINE/ListDecisions';
export const METHOD_BLOCK_IP_FULL = 'Crowdsec_SECURITY_ENGINE.Crowdsec_SECURITY_ENGINE/BlockIP';
export const METHOD_UNBLOCK_IP_FULL = 'Crowdsec_SECURITY_ENGINE.Crowdsec_SECURITY_ENGINE/UnblockIP';
export const METHOD_DELETE_DECISION_FULL = 'Crowdsec_SECURITY_ENGINE.Crowdsec_SECURITY_ENGINE/DeleteDecision';

// ── Error mapping ──────────────────────────────────────────────────────────

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

const mapHttpStatus = (status, body) => {
  if (status === 401) return errorWithCode('UNAUTHENTICATED', body?.message || 'authentication failed');
  if (status === 403) return errorWithCode('PERMISSION_DENIED', body?.message || 'access denied');
  if (status === 404) return errorWithCode('FAILED_PRECONDITION', body?.message || 'resource not found');
  if (status === 400) return errorWithCode('INVALID_ARGUMENT', body?.message || 'bad request');
  if (status >= 400 && status < 500) return errorWithCode('FAILED_PRECONDITION', body?.message || `client error ${status}`);
  if (status >= 500) return errorWithCode('UNAVAILABLE', body?.message || `server error ${status}`);
  return null;
};

// ── Context helpers ────────────────────────────────────────────────────────

const getReqField = (req, snakeName, camelName) => {
  // proto3 SDK decodes field names as camelCase; support both conventions
  return req?.[snakeName] || req?.[camelName];
};

const firstDefined = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== '');

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.secret ?? {}),
  ...(ctx?.bindings ?? {}),
});

const resolveCallContext = (baseCtx, reqOrCtx, maybeInnerCtx) => {
  if (maybeInnerCtx !== undefined) {
    return { req: reqOrCtx ?? {}, ctx: mergeCtx(baseCtx, maybeInnerCtx) };
  }
  const innerCtx = reqOrCtx ?? {};
  return {
    req: innerCtx.request ?? innerCtx.req ?? {},
    ctx: mergeCtx(baseCtx, innerCtx),
  };
};

const mergeCtx = (base, inner) => {
  const merged = { ...base, ...inner };
  merged.config = { ...base?.config, ...inner?.config };
  merged.secret = { ...base?.secret, ...inner?.secret };
  merged.bindings = { ...base?.bindings, ...inner?.bindings };
  merged.meta = { ...base?.meta, ...inner?.meta };
  merged.limits = { ...base?.limits, ...inner?.limits };
  return merged;
};

// ── Config/secret helpers ──────────────────────────────────────────────────

const getEndpoint = (bindings) => {
  const ep = bindings.endpoint || bindings.restBaseUrl || bindings.baseUrl;
  if (!ep) throw errorWithCode('INVALID_ARGUMENT', 'endpoint is required in config');
  return ep.replace(/\/+$/, '');
};

const getTimeout = (ctx) => ctx?.limits?.timeoutMs || DEFAULT_TIMEOUT_MS;

const getSkipTlsVerify = (bindings) => Boolean(bindings.skipTlsVerify || bindings.tlsInsecureSkipVerify);

const requestWithDefaults = (bindings, req = {}) => {
  const machineId = firstDefined(req.machine_id, req.machineId, bindings.machineId);
  const password = firstDefined(req.password, bindings.password);
  const apiKey = firstDefined(req.api_key, req.apiKey, bindings.apiKey);
  return {
    ...(req ?? {}),
    ...(machineId !== undefined ? { machine_id: machineId } : {}),
    ...(password !== undefined ? { password } : {}),
    ...(apiKey !== undefined ? { api_key: apiKey } : {}),
  };
};

// ── JWT auth ───────────────────────────────────────────────────────────────

const jwtCacheMap = new Map();

const getJwtToken = async (endpoint, machineId, password, timeout, skipTls) => {
  const cacheKey = `${endpoint}:${machineId}`;
  const cached = jwtCacheMap.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now + 30_000) {
    return cached.token;
  }

  const url = `${endpoint}/v1/watchers/login`;
  const loginBody = JSON.stringify({ machine_id: machineId, password });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'crowdsec-octobus/v1.0' },
      body: loginBody,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const resBody = await res.text();

    if (!res.ok) {
      const body = JSON.parse(resBody).catch ? JSON.parse(resBody) : {};
      const mapped = mapHttpStatus(res.status, body);
      if (mapped) throw mapped;
      throw errorWithCode('UNAUTHENTICATED', `login failed: ${res.status}`);
    }

    const data = JSON.parse(resBody);
    const token = data.token;
    if (!token) throw errorWithCode('UNAUTHENTICATED', 'login response missing token');

    let expiresAt = now + 3600_000;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.exp) expiresAt = payload.exp * 1000;
    } catch { /* use default */ }

    jwtCacheMap.set(cacheKey, { token, expiresAt });
    return token;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof GrpcError) throw err;
    if (err.name === 'AbortError') throw errorWithCode('DEADLINE_EXCEEDED', 'login request timed out');
    throw errorWithCode('UNAVAILABLE', `login network error: ${err.message}`);
  }
};

// ── HTTP helpers ───────────────────────────────────────────────────────────

const crowdsecFetch = async (endpoint, path, { method = 'GET', query, body, authType, req, bindings, timeout, skipTls }) => {
  let url = `${endpoint}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') {
        params.append(k, String(v));
      }
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers = {};
  if (authType === 'jwt') {
    const machineId = req.machine_id;
    const password = req.password;
    if (!machineId || !password) {
      throw errorWithCode('INVALID_ARGUMENT', 'machineId and password are required for JWT auth');
    }
    const token = await getJwtToken(endpoint, machineId, password, timeout, skipTls);
    headers['Authorization'] = `Bearer ${token}`;
  } else if (authType === 'apiKey') {
    if (!req.api_key) {
      throw errorWithCode('INVALID_ARGUMENT', 'apiKey is required for bouncer auth');
    }
    headers['X-Api-Key'] = req.api_key;
  }

  const fetchOpts = { method, headers, signal: undefined };
  headers['User-Agent'] = 'crowdsec-octobus/v1.0';
  if (body) {
    headers['Content-Type'] = 'application/json';
    fetchOpts.body = JSON.stringify(body);
  }

  const controller = new AbortController();
  fetchOpts.signal = controller.signal;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, fetchOpts);
    clearTimeout(timer);

    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const data = isJson ? await res.json() : null;

    if (!res.ok) {
      const mapped = mapHttpStatus(res.status, data);
      if (mapped) throw mapped;
      throw errorWithCode('UNKNOWN', `unexpected status ${res.status}`);
    }

    return data;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof GrpcError) throw err;
    if (err.name === 'AbortError') throw errorWithCode('DEADLINE_EXCEEDED', 'request timed out');
    throw errorWithCode('UNAVAILABLE', `network error: ${err.message}`);
  }
};

// ── Response mappers ───────────────────────────────────────────────────────

const mapAlertSource = (src) => {
  if (!src) return {};
  return {
    scope: src.scope || '',
    value: src.value || '',
    ip: src.ip || '',
    range: src.range || '',
    as_number: src.as_number || '',
    as_name: src.as_name || '',
    cn: src.cn || '',
    latitude: src.latitude || 0,
    longitude: src.longitude || 0,
  };
};

const mapAlertEvent = (evt) => {
  if (!evt) return {};
  return {
    timestamp: evt.timestamp || '',
    meta: (evt.meta || []).map((m) => ({ key: m.key || '', value: m.value || '' })),
  };
};

const mapAlertDecision = (d) => {
  if (!d) return {};
  return {
    id: d.id || 0,
    uuid: d.uuid || '',
    origin: d.origin || '',
    type: d.type || '',
    scope: d.scope || '',
    value: d.value || '',
    duration: d.duration || '',
    scenario: d.scenario || '',
    simulated: d.simulated || false,
  };
};

const mapDecision = (d) => mapAlertDecision(d);

const mapAlert = (a) => {
  if (!a) return {};
  return {
    id: a.id || 0,
    uuid: a.uuid || '',
    machine_id: a.machine_id || '',
    created_at: a.created_at || '',
    scenario: a.scenario || '',
    scenario_hash: a.scenario_hash || '',
    scenario_version: a.scenario_version || '',
    message: a.message || '',
    events_count: a.events_count || 0,
    start_at: a.start_at || '',
    stop_at: a.stop_at || '',
    capacity: a.capacity || 0,
    leakspeed: a.leakspeed || '',
    simulated: a.simulated || false,
    source: mapAlertSource(a.source),
    events: (a.events || []).map(mapAlertEvent),
    decisions: (a.decisions || []).map(mapAlertDecision),
    meta: (a.meta || []).map((m) => ({ key: m.key || '', value: m.value || '' })),
    remediation: a.remediation || false,
    kind: a.kind || '',
  };
};

// ── RPC method implementations (via rpcdef pattern) ────────────────────────

export function rpcdef(ctx) {
  const bindings = mergedBindings(ctx);
  const endpoint = getEndpoint(bindings);
  const timeout = getTimeout(ctx);
  const skipTls = getSkipTlsVerify(bindings);

  const doFetch = (path, opts) => crowdsecFetch(endpoint, path, { ...opts, timeout, skipTls });

  return {
    // ListAlerts
    [METHOD_LIST_ALERTS]: async () => {
      const req = requestWithDefaults(bindings, ctx.req);
      const query = {};
      if (ctx.req?.scope) query.scope = ctx.req.scope;
      if (ctx.req?.value) query.value = ctx.req.value;
      if (ctx.req?.scenario) query.scenario = ctx.req.scenario;
      if (ctx.req?.ip) query.ip = ctx.req.ip;
      if (ctx.req?.range) query.range = ctx.req.range;
      if (ctx.req?.since) query.since = ctx.req.since;
      if (ctx.req?.until) query.until = ctx.req.until;
      if (ctx.req?.simulated !== undefined && ctx.req?.simulated !== null) query.simulated = String(ctx.req.simulated);
      if (getReqField(ctx.req, "has_active_decision", "hasActiveDecision") !== undefined && getReqField(ctx.req, "has_active_decision", "hasActiveDecision") !== null) query.has_active_decision = String(ctx.req.has_active_decision);
      if (getReqField(ctx.req, "decision_type", "decisionType")) query.decision_type = ctx.req.decision_type;
      if (ctx.req?.limit) query.limit = String(ctx.req.limit);
      if (ctx.req?.origin) query.origin = ctx.req.origin;

      const data = await doFetch('/v1/alerts', { method: 'GET', query, authType: 'jwt', req, bindings });
      const alerts = Array.isArray(data) ? data : [];
      return { alerts: alerts.map(mapAlert) };
    },

    // GetAlert
    [METHOD_GET_ALERT]: async () => {
      const req = requestWithDefaults(bindings, ctx.req);
      if (!getReqField(ctx.req, "alert_id", "alertId")) {
        throw errorWithCode('INVALID_ARGUMENT', 'alert_id is required');
      }
      const data = await doFetch(`/v1/alerts/${getReqField(ctx.req, "alert_id", "alertId")}`, { method: 'GET', authType: 'jwt', req, bindings });
      return { alert: mapAlert(data) };
    },

    // ListDecisions
    [METHOD_LIST_DECISIONS]: async () => {
      const req = requestWithDefaults(bindings, ctx.req);
      const authType = req.api_key ? 'apiKey' : 'jwt';
      const query = {};
      if (ctx.req?.scope) query.scope = ctx.req.scope;
      if (ctx.req?.value) query.value = ctx.req.value;
      if (ctx.req?.type) query.type = ctx.req.type;
      if (ctx.req?.ip) query.ip = ctx.req.ip;
      if (ctx.req?.range) query.range = ctx.req.range;
      if (ctx.req?.contains !== undefined && ctx.req?.contains !== null) query.contains = String(ctx.req.contains);
      if (ctx.req?.origins) query.origins = ctx.req.origins;
      if (getReqField(ctx.req, "scenarios_containing", "scenariosContaining")) query.scenarios_containing = ctx.req.scenarios_containing;
      if (getReqField(ctx.req, "scenarios_not_containing", "scenariosNotContaining")) query.scenarios_not_containing = ctx.req.scenarios_not_containing;

      const data = await doFetch('/v1/decisions', { method: 'GET', query, authType, req, bindings });
      const decisions = Array.isArray(data) ? data : [];
      return { decisions: decisions.map(mapDecision) };
    },

    // BlockIP
    [METHOD_BLOCK_IP]: async () => {
      const req = requestWithDefaults(bindings, ctx.req);
      if (!getReqField(ctx.req, "target_ip", "targetIp")) {
        throw errorWithCode('INVALID_ARGUMENT', 'target_ip is required');
      }

      const duration = ctx.req?.duration || DEFAULT_BLOCK_DURATION;
      const decisionType = getReqField(ctx.req, "decision_type", "decisionType") || DEFAULT_DECISION_TYPE;
      const reason = ctx.req?.reason || DEFAULT_REASON;
      const now = new Date().toISOString();

      const alertBody = [{
        scenario: 'manual',
        scenario_hash: '',
        scenario_version: '',
        message: reason,
        events_count: 1,
        start_at: now,
        stop_at: now,
        capacity: 0,
        leakspeed: '0',
        simulated: false,
        source: {
          scope: DEFAULT_SCOPE,
          value: getReqField(ctx.req, "target_ip", "targetIp"),
          ip: getReqField(ctx.req, "target_ip", "targetIp"),
        },
        events: [{
          timestamp: now,
          meta: [{ key: 'reason', value: reason }],
        }],
        decisions: [{
          origin: 'cscli',
          type: decisionType,
          scope: DEFAULT_SCOPE,
          value: getReqField(ctx.req, "target_ip", "targetIp"),
          duration: duration,
          scenario: 'manual',
        }],
        meta: [{ key: 'reason', value: reason }],
        remediation: true,
        kind: 'manual',
      }];

      const data = await doFetch('/v1/alerts', { method: 'POST', body: alertBody, authType: 'jwt', req, bindings });
      // Crowdsec POST /v1/alerts returns array of alert IDs (e.g. ["7"]), not full alert objects.
      // Fetch the created alert to get its full details including decisions.
      const alertIdStr = Array.isArray(data) ? data[0] : (data?.id ?? data);
      if (!alertIdStr) {
        return { alert_id: 0, uuid: '', decision: {} };
      }
      const alertId = parseInt(alertIdStr, 10) || 0;

      // Fetch the full alert to get uuid and decision details
      const fullAlert = await doFetch(`/v1/alerts/${alertId}`, { method: 'GET', authType: 'jwt', req, bindings });
      const firstDecision = (fullAlert?.decisions && fullAlert.decisions[0]) ? mapDecision(fullAlert.decisions[0]) : {};
      return {
        alert_id: alertId,
        uuid: fullAlert?.uuid || '',
        decision: firstDecision,
      };
    },

    // UnblockIP
    [METHOD_UNBLOCK_IP]: async () => {
      const req = requestWithDefaults(bindings, ctx.req);
      if (!getReqField(ctx.req, "target_ip", "targetIp")) {
        throw errorWithCode('INVALID_ARGUMENT', 'target_ip is required');
      }

      const scope = getReqField(ctx.req, "scope", "scope") || DEFAULT_SCOPE;
      const targetIp = getReqField(ctx.req, "target_ip", "targetIp");
      // Crowdsec DELETE /v1/decisions uses shortcut params (ip=, range=) instead of scope+value
      const query = {};
      if (scope.toLowerCase() === 'ip') {
        query.ip = targetIp;
      } else if (scope.toLowerCase() === 'range') {
        query.range = targetIp;
      } else {
        query.scope = scope;
        query.value = targetIp;
      }
      const data = await doFetch('/v1/decisions', { method: 'DELETE', query, authType: 'jwt', req, bindings });
      const deletedCount = parseInt(data?.nbDeleted || '0', 10);
      return { deleted_count: deletedCount };
    },

    // DeleteDecision
    [METHOD_DELETE_DECISION]: async () => {
      const req = requestWithDefaults(bindings, ctx.req);
      if (!getReqField(ctx.req, "decision_id", "decisionId")) {
        throw errorWithCode('INVALID_ARGUMENT', 'decision_id is required');
      }

      const data = await doFetch(`/v1/decisions/${getReqField(ctx.req, "decision_id", "decisionId")}`, { method: 'DELETE', authType: 'jwt', req, bindings });
      const deletedCount = parseInt(data?.nbDeleted || '0', 10);
      return { deleted_count: deletedCount };
    },
  };
}

// ── Legacy handler wrapper ─────────────────────────────────────────────────

const wrapLegacyHandler = (baseCtx, methodPath) => async (reqOrCtx, maybeInnerCtx) => {
  const call = resolveCallContext(baseCtx, reqOrCtx, maybeInnerCtx);
  const legacyCtx = {
    ...call.ctx,
    req: call.req,
  };
  return rpcdef(legacyCtx)[methodPath]();
};

const registerHandlers = (ctx = {}) => ({
  [METHOD_LIST_ALERTS]: wrapLegacyHandler(ctx, METHOD_LIST_ALERTS),
  [METHOD_GET_ALERT]: wrapLegacyHandler(ctx, METHOD_GET_ALERT),
  [METHOD_LIST_DECISIONS]: wrapLegacyHandler(ctx, METHOD_LIST_DECISIONS),
  [METHOD_BLOCK_IP]: wrapLegacyHandler(ctx, METHOD_BLOCK_IP),
  [METHOD_UNBLOCK_IP]: wrapLegacyHandler(ctx, METHOD_UNBLOCK_IP),
  [METHOD_DELETE_DECISION]: wrapLegacyHandler(ctx, METHOD_DELETE_DECISION),
});

const sdkHandlers = registerHandlers({});

export const handlers = {
  [METHOD_LIST_ALERTS_FULL]: (ctx) => sdkHandlers[METHOD_LIST_ALERTS](ctx),
  [METHOD_GET_ALERT_FULL]: (ctx) => sdkHandlers[METHOD_GET_ALERT](ctx),
  [METHOD_LIST_DECISIONS_FULL]: (ctx) => sdkHandlers[METHOD_LIST_DECISIONS](ctx),
  [METHOD_BLOCK_IP_FULL]: (ctx) => sdkHandlers[METHOD_BLOCK_IP](ctx),
  [METHOD_UNBLOCK_IP_FULL]: (ctx) => sdkHandlers[METHOD_UNBLOCK_IP](ctx),
  [METHOD_DELETE_DECISION_FULL]: (ctx) => sdkHandlers[METHOD_DELETE_DECISION](ctx),
};

export const _test = {
  errorWithCode,
  mergedBindings,
  resolveCallContext,
  registerHandlers,
  rpcdef,
  mapAlert,
  mapDecision,
  requestWithDefaults,
  clearJwtCache: () => jwtCacheMap.clear(),
};
