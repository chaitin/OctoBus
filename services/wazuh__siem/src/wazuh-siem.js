// Wazuh_SIEM dual-endpoint REST proxy implementation
// Manager API (endpoint) → ListAgents (JWT auth via POST /security/user/authenticate)
// Indexer API (indexerEndpoint) → ListAlerts/GetAlertSummary/ListVulnerabilities/GetVulnerabilitySummary (Basic Auth + OpenSearch DSL)
// TLS: when skipTlsVerify is enabled, uses undici Agent with rejectUnauthorized: false

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent as UndiciAgent } from 'undici';

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_LIMIT = 10;
const DEFAULT_OFFSET = 0;
const TOKEN_REFRESH_MARGIN_MS = 60_000; // refresh token 60s before expiry

const METHOD_LIST_ALERTS = '/Wazuh_SIEM.Wazuh_SIEM/ListAlerts';
const METHOD_GET_ALERT_SUMMARY = '/Wazuh_SIEM.Wazuh_SIEM/GetAlertSummary';
const METHOD_LIST_VULNERABILITIES = '/Wazuh_SIEM.Wazuh_SIEM/ListVulnerabilities';
const METHOD_GET_VULNERABILITY_SUMMARY = '/Wazuh_SIEM.Wazuh_SIEM/GetVulnerabilitySummary';
const METHOD_LIST_AGENTS = '/Wazuh_SIEM.Wazuh_SIEM/ListAgents';

// ─── Module-level JWT token cache ──────────────────────────────────
// Shared across all rpcdef() calls so that the cache persists between
// requests. Keyed by endpoint+username to avoid cross-instance leaks.
const jwtTokenCache = new Map();

const tokenCacheKey = (baseUrl, username) => `${baseUrl}|${username}`;

// ─── Error helpers ────────────────────────────────────────────────────

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  DEADLINE_EXCEEDED: grpcStatus.DEADLINE_EXCEEDED,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

// ─── Utility helpers ──────────────────────────────────────────────────

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
    } catch {
      return {};
    }
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
  if (typeof val === 'object') {
    if ('value' in val) return toPositiveInt(val.value);
    return null;
  }
  const n = Number(val);
  if (!Number.isInteger(n) || Number.isNaN(n)) return null;
  return n;
};

const toValue = (val) => {
  if (val === undefined || val === null) return { stringValue: '' };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'number') return { numberValue: val };
  if (typeof val === 'boolean') return { boolValue: val };
  if (Array.isArray(val)) {
    const values = val.map((item) => toValue(item)).filter((item) => item !== undefined);
    return { listValue: { values } };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      const normalized = toValue(v);
      fields[k] = normalized === undefined ? { nullValue: 'NULL_VALUE' } : normalized;
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(val) };
};

const unwrapString = (source) => {
  if (source === undefined || source === null) return '';
  if (typeof source === 'object' && source !== null && 'value' in source) {
    return String(source.value ?? '');
  }
  return String(source);
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const pickStringField = (req, keys) => {
  for (const key of keys) {
    if (hasOwn(req, key)) {
      return unwrapString(req[key]);
    }
  }
  return undefined;
};

// ─── OpenSearch query builder ──────────────────────────────────────

const buildAlertsOpenSearchQuery = (req) => {
  const must = [];

  const startTime = toPositiveInt(firstDefined(req?.start_time, req?.startTime));
  if (startTime !== null) {
    must.push({ range: { timestamp: { gte: new Date(startTime * 1000).toISOString() } } });
  }

  const endTime = toPositiveInt(firstDefined(req?.end_time, req?.endTime));
  if (endTime !== null) {
    must.push({ range: { timestamp: { lte: new Date(endTime * 1000).toISOString() } } });
  }

  const severityMin = toPositiveInt(firstDefined(req?.severity_min, req?.severityMin));
  if (severityMin !== null) {
    must.push({ range: { 'rule.level': { gte: severityMin } } });
  }

  // If user also passed a raw query string, use query_string
  const rawQuery = pickStringField(req, ['query', 'Query']);
  if (rawQuery) {
    must.push({ query_string: { query: rawQuery } });
  }

  if (must.length === 0) return { match_all: {} };
  return { bool: { must } };
};

// ─── Wazuh API response mapper ────────────────────────────────────────

// Wazuh Manager API 4.x standard response: { data: { affected_items: [...], total_affected_items: N, ... }, ... }
const extractAffectedItems = (json) => {
  const data = json?.data;
  if (data && typeof data === 'object') {
    if (Array.isArray(data.affected_items)) {
      return {
        items: data.affected_items,
        total: data.total_affected_items ?? data.affected_items.length,
      };
    }
    // Some endpoints return data directly as array
    if (Array.isArray(data)) {
      return { items: data, total: data.length };
    }
    // Overview/stats endpoints return data as object
    return { items: [], total: 0, stats: data };
  }
  return { items: [], total: 0 };
};

// OpenSearch response format: { hits: { hits: [{ _source: {...} }], total: { value: N } } }
const extractOpenSearchHits = (json) => ({
  items: json?.hits?.hits?.map((h) => ({ ...h._source, _id: h._id })) ?? [],
  total: json?.hits?.total?.value ?? 0,
});

const mapAlertRecord = (item) => ({
  id: String(item?.id ?? item?._id ?? ''),
  timestamp: String(item?.timestamp ?? ''),
  rule_description: String(item?.rule?.description ?? item?.rule_description ?? ''),
  rule_level: Number(item?.rule?.level ?? item?.rule_level ?? 0),
  rule_groups: Array.isArray(item?.rule?.groups) ? item.rule.groups.join(',') : String(item?.rule?.groups ?? item?.rule_groups ?? ''),
  rule_mitre_id: Array.isArray(item?.rule?.mitre?.id)
    ? item.rule.mitre.id.join(',')
    : String(item?.rule?.mitre?.id ?? item?.rule_mitre_id ?? ''),
  agent_id: String(item?.agent?.id ?? item?.agent_id ?? ''),
  agent_name: String(item?.agent?.name ?? item?.agent_name ?? ''),
  agent_ip: String(item?.agent?.ip ?? item?.agent_ip ?? ''),
  full_log: String(item?.full_log ?? ''),
  raw: item ?? {},
});

const mapAgentRecord = (item) => ({
  id: String(item?.id ?? ''),
  name: String(item?.name ?? ''),
  ip: String(item?.ip ?? ''),
  status: String(item?.status ?? ''),
  os_name: String(item?.os?.name ?? item?.os_name ?? ''),
  os_version: String(item?.os?.version ?? item?.os_version ?? ''),
  wazuh_version: String(item?.version ?? item?.wazuh_version ?? ''),
  last_keep_alive: String(item?.lastKeepAlive ?? item?.last_keep_alive ?? ''),
  group: Array.isArray(item?.group) ? item.group.join(',') : String(item?.group ?? ''),
});

const mapVulnerabilityRecord = (item) => ({
  cve: String(item?.vulnerability?.cve ?? item?.cve ?? ''),
  severity: String(item?.vulnerability?.severity ?? item?.severity ?? ''),
  package_name: String(item?.vulnerability?.package?.name ?? item?.package?.name ?? item?.package_name ?? ''),
  package_version: String(item?.vulnerability?.package?.version ?? item?.package?.version ?? item?.package_version ?? ''),
  title: String(item?.vulnerability?.title ?? item?.title ?? ''),
  description: String(item?.vulnerability?.description ?? item?.description ?? ''),
  reference: String(item?.vulnerability?.reference ?? item?.references ?? item?.reference ?? ''),
  type: String(item?.vulnerability?.type ?? item?.type ?? ''),
  raw: item ?? {},
});

// ─── rpcdef ───────────────────────────────────────────────────────────

export function rpcdef(ctx) {
  const bindings = mergedBindings(ctx);
  // Manager API endpoint (JWT auth) — for ListAgents
  const restBaseUrl = bindings.restBaseUrl || bindings.rest_base_url || bindings.baseUrl || bindings.base_url || bindings.endpoint || '';

  // Indexer endpoint (Basic Auth) — for alerts/vulnerability
  const indexerBaseUrl = bindings.indexerEndpoint || bindings.indexer_endpoint || '';
  const indexerUsername = firstDefined(bindings.indexerUsername, bindings.indexer_username) || 'admin';
  const indexerPassword = firstDefined(bindings.indexerPassword, bindings.indexer_password) || '';

  const timeoutMs = bindings.timeoutMs || ctx.limits?.timeoutMs || DEFAULT_TIMEOUT_MS;
  const baseHeaders = parseHeaders(bindings.headers);
  const meta = ctx.meta || {};
  const skipTlsVerify = Boolean(bindings.tlsInsecureSkipVerify || bindings.skipTlsVerify || bindings.skip_tls_verify || bindings.tls_insecure_skip_verify);

  const requestWithDefaults = (req = {}) => {
    const username = firstDefined(req?.username, bindings.username);
    const password = firstDefined(req?.password, bindings.password);
    const result = { ...req };
    if (username !== undefined && username !== null) result.username = username;
    if (password !== undefined && password !== null) result.password = password;
    return result;
  };

  const logFlow = (action, details) => {
    const inst = meta.instance_id || meta.instanceId;
    const reqId = meta.request_id || meta.requestId;
    const trace = [];
    if (inst) trace.push(`inst=${inst}`);
    if (reqId) trace.push(`req=${reqId}`);
    const prefix = `[Wazuh_SIEM][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
    try {
      console.log(prefix, JSON.stringify(details));
    } catch {
      console.log(prefix, details);
    }
  };

  const getManagerBaseUrl = () => {
    const baseUrl = normalizeBaseUrl(restBaseUrl);
    if (!baseUrl) {
      throw errorWithCode('INVALID_ARGUMENT', 'restBaseUrl/baseUrl/endpoint is required for Manager API (http/https)');
    }
    return baseUrl;
  };

  const getIndexerBaseUrl = () => {
    const baseUrl = normalizeBaseUrl(indexerBaseUrl);
    if (!baseUrl) {
      throw errorWithCode('INVALID_ARGUMENT', 'indexerEndpoint is required for alert/vulnerability queries (http/https)');
    }
    return baseUrl;
  };

  // ─── TLS dispatcher (undici for skipTlsVerify, native fetch otherwise) ───

  let insecureDispatcher = null;
  const getDispatcher = () => {
    if (!skipTlsVerify) return undefined;
    if (!insecureDispatcher) {
      insecureDispatcher = new UndiciAgent({ connect: { rejectUnauthorized: false } });
    }
    return insecureDispatcher;
  };

  // ─── JWT Authentication (Manager API) ────────────────────────────

  const authenticate = async (reqOverride = {}) => {
    const username = firstDefined(reqOverride.username, bindings.username);
    const password = firstDefined(reqOverride.password, bindings.password);

    if (!username || !password) {
      throw errorWithCode('INVALID_ARGUMENT', 'username and password are required for Wazuh JWT authentication');
    }

    const baseUrl = getManagerBaseUrl();
    const url = `${baseUrl}/security/user/authenticate`;
    const cacheKey = tokenCacheKey(baseUrl, username);

    logFlow('authenticate:start', { url: `${baseUrl}/security/user/authenticate` });

    const headers = {
      ...baseHeaders,
      'Content-Type': 'application/json',
      'Authorization': `Basic ${btoa(`${username}:${password}`)}`,
      'x-engine-instance': meta.instance_id || meta.instanceId || 'unknown',
      'x-request-id': meta.request_id || meta.requestId || 'unknown',
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(timeoutMs),
        ...(skipTlsVerify ? { dispatcher: getDispatcher() } : {}),
      });

      const text = await res.text();
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw errorWithCode('PERMISSION_DENIED', `Wazuh authentication failed (http ${res.status}): ${text}`);
        }
        throw errorWithCode('UNAVAILABLE', `Wazuh authentication failed (http ${res.status}): ${text}`);
      }

      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw errorWithCode('UNKNOWN', 'Wazuh authentication response is not valid JSON');
      }

      const token = json?.data?.token;
      if (!token) {
        throw errorWithCode('FAILED_PRECONDITION', 'Wazuh authentication succeeded but no token returned');
      }

      // Wazuh JWT token default TTL is 900s; parse expiry or assume 900s
      let expiresIn = 900;
      try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
        if (payload?.exp) {
          expiresIn = Math.max(payload.exp - Math.floor(Date.now() / 1000), 60);
        }
      } catch {
        // If we can't parse the JWT, use default 900s
      }

      jwtTokenCache.set(cacheKey, { token, expiresAt: Date.now() + expiresIn * 1000 });

      logFlow('authenticate:done', { expiresIn });

      return token;
    } catch (e) {
      if (e instanceof GrpcError) throw e;
      const reason = e?.cause?.message || e?.message || 'fetch failed';
      throw errorWithCode('UNAVAILABLE', `Wazuh authentication request failed: ${reason}`);
    }
  };

  const ensureToken = async (reqOverride = {}) => {
    const username = firstDefined(reqOverride.username, bindings.username);
    const baseUrl = getManagerBaseUrl();
    const cacheKey = tokenCacheKey(baseUrl, username);
    const cached = jwtTokenCache.get(cacheKey);
    if (cached && cached.token && Date.now() < cached.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
      return cached.token;
    }
    return authenticate(reqOverride);
  };

  // ─── Manager API request (JWT Bearer) ────────────────────────────

  const fetchWithRetry = async (url, init) => {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
        ...(skipTlsVerify ? { dispatcher: getDispatcher() } : {}),
      });
    } catch (e) {
      const reason = e?.cause?.message || e?.message || 'fetch failed';
      throw errorWithCode('UNAVAILABLE', reason);
    }
  };

  const throwForHttpError = (status, text) => {
    if (status === 401 || status === 403) {
      throw errorWithCode('PERMISSION_DENIED', `upstream http ${status}: ${text}`);
    }
    if (status >= 400 && status < 500) {
      throw errorWithCode('FAILED_PRECONDITION', `upstream http ${status}: ${text}`);
    }
    throw errorWithCode('UNAVAILABLE', `upstream http ${status}: ${text}`);
  };

  const readJsonResponse = async (res) => {
    const text = await res.text();
    if (!res.ok) {
      throwForHttpError(res.status, text);
    }
    if (!text.trim()) {
      return {};
    }
    try {
      return JSON.parse(text);
    } catch {
      throw errorWithCode('UNKNOWN', 'response is not valid JSON');
    }
  };

  const wazuhGet = async (path, params = {}, retryOn401 = true, reqOverride = {}) => {
    const token = await ensureToken(reqOverride);
    const baseUrl = getManagerBaseUrl();

    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    const headers = {
      ...baseHeaders,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-engine-instance': meta.instance_id || meta.instanceId || 'unknown',
      'x-request-id': meta.request_id || meta.requestId || 'unknown',
    };

    logFlow('wazuhGet', { path, params: Object.keys(params) });

    const res = await fetchWithRetry(url.toString(), { method: 'GET', headers });

    // Retry once on 401 (token expired)
    if (res.status === 401 && retryOn401) {
      logFlow('wazuhGet:tokenExpired', { path });
      const username = firstDefined(reqOverride.username, bindings.username);
      const baseUrl2 = getManagerBaseUrl();
      const cacheKey = tokenCacheKey(baseUrl2, username);
      const cached = jwtTokenCache.get(cacheKey);
      if (cached) {
        cached.token = null;
        cached.expiresAt = 0;
      }
      return wazuhGet(path, params, false, reqOverride);
    }

    return readJsonResponse(res);
  };

  // ─── Indexer API request (Basic Auth) ────────────────────────────

  const indexerPost = async (path, body) => {
    const baseUrl = getIndexerBaseUrl();
    const url = `${baseUrl}${path}`;

    const authHeader = `Basic ${btoa(`${indexerUsername}:${indexerPassword}`)}`;

    const headers = {
      ...baseHeaders,
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'x-engine-instance': meta.instance_id || meta.instanceId || 'unknown',
      'x-request-id': meta.request_id || meta.requestId || 'unknown',
    };

    logFlow('indexerPost', { path });

    const res = await fetchWithRetry(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    return readJsonResponse(res);
  };

  const indexerGet = async (path, params = {}) => {
    const baseUrl = getIndexerBaseUrl();
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    const authHeader = `Basic ${btoa(`${indexerUsername}:${indexerPassword}`)}`;

    const headers = {
      ...baseHeaders,
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'x-engine-instance': meta.instance_id || meta.instanceId || 'unknown',
      'x-request-id': meta.request_id || meta.requestId || 'unknown',
    };

    logFlow('indexerGet', { path });

    const res = await fetchWithRetry(url.toString(), { method: 'GET', headers });

    return readJsonResponse(res);
  };

  // ─── RPC: ListAlerts (Indexer) ───────────────────────────────────

  const callListAlerts = async (req) => {
    const limit = toPositiveInt(firstDefined(req?.limit, req?.Limit)) ?? DEFAULT_LIMIT;
    const offset = toPositiveInt(firstDefined(req?.offset, req?.Offset)) ?? DEFAULT_OFFSET;
    const sort = pickStringField(req, ['sort', 'Sort']) || '-timestamp';

    // Convert sort from Wazuh syntax to OpenSearch syntax
    // "-timestamp" → { timestamp: "desc" }, "timestamp" → { timestamp: "asc" }
    const sortField = sort.startsWith('-') ? sort.slice(1) : sort;
    const sortOrder = sort.startsWith('-') ? 'desc' : 'asc';

    const query = buildAlertsOpenSearchQuery(req);

    logFlow('ListAlerts:start', { limit, offset });
    const json = await indexerPost('/wazuh-alerts-*/_search', {
      query,
      from: offset,
      size: limit,
      sort: [{ [sortField]: { order: sortOrder } }],
    });
    logFlow('ListAlerts:done', {});

    const extracted = extractOpenSearchHits(json);
    const alertList = extracted.items;

    return {
      err: toValue(null),
      msg: toValue('success'),
      data: {
        alerts: alertList.map(mapAlertRecord),
        total: extracted.total || alertList.length,
        limit,
        offset,
      },
    };
  };

  // ─── RPC: GetAlertSummary (Indexer) ──────────────────────────────

  const callGetAlertSummary = async (req) => {
    logFlow('GetAlertSummary:start', {});
    const json = await indexerPost('/wazuh-alerts-*/_search', {
      size: 0,
      aggs: {
        by_level: {
          range: {
            field: 'rule.level',
            ranges: [
              { key: 'level_12_plus', from: 12 },
              { key: 'level_8_11', from: 8, to: 12 },
              { key: 'level_4_7', from: 4, to: 8 },
              { key: 'level_0_3', to: 4 },
            ],
          },
        },
      },
    });
    logFlow('GetAlertSummary:done', {});

    // Extract aggregation buckets
    const buckets = json?.aggregations?.by_level?.buckets ?? [];
    let level12Plus = 0;
    let level8_11 = 0;
    let level4_7 = 0;
    let level0_3 = 0;
    let totalAlerts = 0;

    for (const bucket of buckets) {
      const count = Number(bucket.doc_count ?? 0);
      totalAlerts += count;
      switch (bucket.key) {
        case 'level_12_plus': level12Plus = count; break;
        case 'level_8_11': level8_11 = count; break;
        case 'level_4_7': level4_7 = count; break;
        case 'level_0_3': level0_3 = count; break;
      }
    }

    // Also try total from hits.total if aggregation is missing
    if (totalAlerts === 0 && json?.hits?.total?.value) {
      totalAlerts = json.hits.total.value;
    }

    return {
      err: toValue(null),
      msg: toValue('success'),
      data: {
        total_alerts: totalAlerts,
        level_12_plus: level12Plus,
        level_8_11: level8_11,
        level_4_7: level4_7,
        level_0_3: level0_3,
        raw: json?.aggregations ?? {},
      },
    };
  };

  // ─── RPC: ListVulnerabilities (Indexer) ──────────────────────────

  const callListVulnerabilities = async (req) => {
    const agentId = pickStringField(req, ['agent_id', 'agentId']);
    if (!agentId) {
      throw errorWithCode('INVALID_ARGUMENT', 'agent_id is required');
    }

    const limit = toPositiveInt(firstDefined(req?.limit, req?.Limit)) ?? DEFAULT_LIMIT;
    const offset = toPositiveInt(firstDefined(req?.offset, req?.Offset)) ?? DEFAULT_OFFSET;

    const mustClauses = [{ term: { 'agent.id': agentId } }];
    const rawQuery = pickStringField(req, ['query', 'Query']);
    if (rawQuery) {
      mustClauses.push({ query_string: { query: rawQuery } });
    }

    logFlow('ListVulnerabilities:start', { agentId, limit, offset });
    const json = await indexerPost('/wazuh-vulnerabilities-*/_search', {
      query: { bool: { must: mustClauses } },
      from: offset,
      size: limit,
      sort: [{ 'vulnerability.severity': { order: 'desc' } }],
    });
    logFlow('ListVulnerabilities:done', {});

    const extracted = extractOpenSearchHits(json);
    const vulnList = extracted.items;

    return {
      err: toValue(null),
      msg: toValue('success'),
      data: {
        vulnerabilities: vulnList.map(mapVulnerabilityRecord),
        total: extracted.total || vulnList.length,
        limit,
        offset,
      },
    };
  };

  // ─── RPC: GetVulnerabilitySummary (Indexer) ──────────────────────

  const callGetVulnerabilitySummary = async (req) => {
    const agentId = pickStringField(req, ['agent_id', 'agentId']);
    if (!agentId) {
      throw errorWithCode('INVALID_ARGUMENT', 'agent_id is required');
    }

    logFlow('GetVulnerabilitySummary:start', { agentId });
    const json = await indexerPost('/wazuh-vulnerabilities-*/_search', {
      size: 0,
      query: { term: { 'agent.id': agentId } },
      aggs: {
        by_severity: {
          terms: { field: 'vulnerability.severity', size: 10 },
        },
      },
    });
    logFlow('GetVulnerabilitySummary:done', {});

    const buckets = json?.aggregations?.by_severity?.buckets ?? [];
    let criticalCount = 0;
    let highCount = 0;
    let mediumCount = 0;
    let lowCount = 0;
    let total = 0;

    for (const bucket of buckets) {
      const count = Number(bucket.doc_count ?? 0);
      total += count;
      const severity = String(bucket.key ?? '').toLowerCase();
      if (severity === 'critical') criticalCount = count;
      else if (severity === 'high') highCount = count;
      else if (severity === 'medium') mediumCount = count;
      else if (severity === 'low') lowCount = count;
      else if (severity === 'info' || severity === 'unknown') lowCount += count;
    }

    // Fallback: try total from hits.total
    if (total === 0 && json?.hits?.total?.value) {
      total = json.hits.total.value;
    }

    return {
      err: toValue(null),
      msg: toValue('success'),
      data: {
        critical_count: criticalCount,
        high_count: highCount,
        medium_count: mediumCount,
        low_count: lowCount,
        total,
        raw: json?.aggregations ?? {},
      },
    };
  };

  // ─── RPC: ListAgents (Manager API) ──────────────────────────────

  const callListAgents = async (req) => {
    const baseUrl = normalizeBaseUrl(restBaseUrl);
    if (!baseUrl) {
      throw errorWithCode('INVALID_ARGUMENT', 'restBaseUrl/baseUrl/endpoint is required for Manager API (ListAgents)');
    }

    const status = pickStringField(req, ['status', 'Status']) || 'active';
    const limit = toPositiveInt(firstDefined(req?.limit, req?.Limit)) ?? DEFAULT_LIMIT;
    const offset = toPositiveInt(firstDefined(req?.offset, req?.Offset)) ?? DEFAULT_OFFSET;
    const search = pickStringField(req, ['search', 'Search']) || undefined;
    const q = pickStringField(req, ['query', 'Query']) || undefined;

    const params = { limit, offset };
    if (status && status !== 'all') params.status = status;
    if (search) params.search = search;
    if (q) params.q = q;

    logFlow('ListAgents:start', { status, limit, offset });
    const json = await wazuhGet('/agents', params, true, req);
    logFlow('ListAgents:done', {});

    const extracted = extractAffectedItems(json);
    const agentList = extracted.items;

    return {
      err: toValue(null),
      msg: toValue('success'),
      data: {
        agents: agentList.map(mapAgentRecord),
        total: extracted.total || agentList.length,
      },
    };
  };

  // ─── Return method map ───────────────────────────────────────────

  return {
    [METHOD_LIST_ALERTS]: async () => callListAlerts(requestWithDefaults(ctx.req)),
    [METHOD_GET_ALERT_SUMMARY]: async () => callGetAlertSummary(requestWithDefaults(ctx.req)),
    [METHOD_LIST_VULNERABILITIES]: async () => callListVulnerabilities(requestWithDefaults(ctx.req)),
    [METHOD_GET_VULNERABILITY_SUMMARY]: async () => callGetVulnerabilitySummary(requestWithDefaults(ctx.req)),
    [METHOD_LIST_AGENTS]: async () => callListAgents(requestWithDefaults(ctx.req)),
  };
}

// ─── resolveInvocation adapter ─────────────────────────────────────────

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
  [METHOD_GET_ALERT_SUMMARY]: wrapLegacyHandler(ctx, METHOD_GET_ALERT_SUMMARY),
  [METHOD_LIST_VULNERABILITIES]: wrapLegacyHandler(ctx, METHOD_LIST_VULNERABILITIES),
  [METHOD_GET_VULNERABILITY_SUMMARY]: wrapLegacyHandler(ctx, METHOD_GET_VULNERABILITY_SUMMARY),
  [METHOD_LIST_AGENTS]: wrapLegacyHandler(ctx, METHOD_LIST_AGENTS),
});

export const METHOD_LIST_ALERTS_FULL = 'Wazuh_SIEM.Wazuh_SIEM/ListAlerts';
export const METHOD_GET_ALERT_SUMMARY_FULL = 'Wazuh_SIEM.Wazuh_SIEM/GetAlertSummary';
export const METHOD_LIST_VULNERABILITIES_FULL = 'Wazuh_SIEM.Wazuh_SIEM/ListVulnerabilities';
export const METHOD_GET_VULNERABILITY_SUMMARY_FULL = 'Wazuh_SIEM.Wazuh_SIEM/GetVulnerabilitySummary';
export const METHOD_LIST_AGENTS_FULL = 'Wazuh_SIEM.Wazuh_SIEM/ListAgents';

const sdkHandlers = registerHandlers({});

export const handlers = {
  [METHOD_LIST_ALERTS_FULL]: (ctx) => sdkHandlers[METHOD_LIST_ALERTS](ctx),
  [METHOD_GET_ALERT_SUMMARY_FULL]: (ctx) => sdkHandlers[METHOD_GET_ALERT_SUMMARY](ctx),
  [METHOD_LIST_VULNERABILITIES_FULL]: (ctx) => sdkHandlers[METHOD_LIST_VULNERABILITIES](ctx),
  [METHOD_GET_VULNERABILITY_SUMMARY_FULL]: (ctx) => sdkHandlers[METHOD_GET_VULNERABILITY_SUMMARY](ctx),
  [METHOD_LIST_AGENTS_FULL]: (ctx) => sdkHandlers[METHOD_LIST_AGENTS](ctx),
};

export const _test = {
  buildAlertsOpenSearchQuery,
  clearJwtCache: () => jwtTokenCache.clear(),
  errorWithCode,
  extractAffectedItems,
  extractOpenSearchHits,
  mapAlertRecord,
  mapAgentRecord,
  mapVulnerabilityRecord,
  mergedBindings,
  normalizeBaseUrl,
  parseHeaders,
  registerHandlers,
  resolveCallContext,
  toPositiveInt,
  toValue,
};
