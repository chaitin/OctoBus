// Chaitin_COSMOS Cosmos Pedestal JSON-RPC proxy
// Bindings: endpoint (required), headers (optional), timeoutMs (optional)

import { Agent as UndiciAgent } from 'undici';
import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const RPC_PATH = '/pedestal/rpc';

const METHOD_SEARCH_LOG_INFO = '/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo';
const METHOD_SEARCH_LOG_LIST = '/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList';
const METHOD_SEARCH_AGGREGATION = '/Chaitin_COSMOS.Chaitin_COSMOS/SearchAggregationStatistics';

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  RESOURCE_EXHAUSTED: grpcStatus.RESOURCE_EXHAUSTED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  DEADLINE_EXCEEDED: grpcStatus.DEADLINE_EXCEEDED,
  INTERNAL: grpcStatus.INTERNAL,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

const firstDefined = (...vals) => vals.find((v) => v !== undefined && v !== null);
const firstNonEmpty = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== '');

const unwrapString = (source) => {
  if (source === undefined || source === null) return '';
  if (typeof source === 'object' && source !== null && 'value' in source) {
    return String(source.value ?? '');
  }
  return String(source);
};

const toPositiveInt = (val) => {
  if (val === undefined || val === null) return null;
  if (typeof val === 'bigint') return Number(val);
  if (typeof val === 'object') {
    if ('value' in val) return toPositiveInt(val.value);
    return null;
  }
  const n = Number(val);
  if (!Number.isInteger(n) || Number.isNaN(n)) return null;
  return n;
};

/** Validate and normalize timeoutMs — must be a finite positive integer */
const validateTimeoutMs = (val) => {
  if (val === undefined || val === null) return DEFAULT_TIMEOUT_MS;
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    const display = Number.isNaN(val) ? 'NaN' : !Number.isFinite(val) ? String(val) : JSON.stringify(val);
    throw errorWithCode('INVALID_ARGUMENT', `timeoutMs must be a positive integer, got ${display}`);
  }
  return n;
};

const toBoolean = (val) => {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'object' && val !== null && 'value' in val) {
    return toBoolean(val.value);
  }
  if (val === undefined || val === null) return false;
  const str = String(val).trim().toLowerCase();
  if (str === 'true') return true;
  if (str === 'false') return false;
  return Boolean(val);
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.secret ?? {}),
  ...(ctx?.bindings ?? {}),
});

const normalizeBaseUrl = (url) => {
  const base = String(url || '').trim();
  if (!base) return null;
  try {
    const parsed = new URL(base);
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    parsed.pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
};

const parseHeaders = (value) => {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value === 'object' && !Array.isArray(value)) return sanitizeHeaders(value);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return sanitizeHeaders(parsed);
    } catch {
      return {};
    }
  }
  return {};
};

const BLOCKED_HEADER_NAMES = new Set([
  'authorization', 'connection', 'content-length', 'content-type', 'host',
  'proxy-authorization', 'transfer-encoding', 'x-menu-name', 'x-request-path',
]);

function sanitizeHeaders(headers) {
  const safe = {};
  for (const [name, value] of Object.entries(headers)) {
    if (BLOCKED_HEADER_NAMES.has(name.toLowerCase())) continue;
    if (typeof value === 'string') safe[name] = value;
  }
  return safe;
}

const toValue = (val) => {
  if (val === undefined || val === null) return undefined;
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

// ─── RPC helpers ───

const buildAuthHeader = (token) => {
  if (!token) return {};
  return { Authorization: `bearer ${token}` };
};

// Required headers for Cosmos Pedestal RPC (from API docs):
// - x-menu-name: identifies the UI menu context (31 = log search)
// - x-request-path: identifies the RPC gateway path
const PEDESTAL_REQUIRED_HEADERS = {
  'x-menu-name': '31',
  'x-request-path': 'pedestal',
};

// Per-request undici dispatcher that enforces TLS certificate verification.
// This is a per-request configuration — it does NOT modify process.env or
// affect any other HTTP connections in the same Node.js process.
// If you need to connect to a Cosmos deployment with a self-signed cert,
// configure a custom CA via NODE_EXTRA_CA_CERTS or add the CA to the
// system trust store.
const SECURE_DISPATCHER = new UndiciAgent({ connect: { rejectUnauthorized: true } });

const readResponseText = async (response) => {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw errorWithCode('RESOURCE_EXHAUSTED', 'upstream response exceeds the 4 MiB limit');
  }

  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw errorWithCode('RESOURCE_EXHAUSTED', 'upstream response exceeds the 4 MiB limit');
      }
      chunks.push(value);
    }
    return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
  }

  const text = String(await response.text());
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
    throw errorWithCode('RESOURCE_EXHAUSTED', 'upstream response exceeds the 4 MiB limit');
  }
  return text;
};

const callPedestalRpc = async (endpoint, rpcMethod, params, token, baseHeaders, timeoutMs) => {
  const url = `${endpoint}${RPC_PATH}`;
  const headers = {
    ...baseHeaders,
    'Content-Type': 'application/json',
    ...PEDESTAL_REQUIRED_HEADERS,
    ...buildAuthHeader(token),
  };

  const body = {
    method: rpcMethod,
    params,
    jsonrpc: '2.0',
    id: '0',
  };

  const fetchOptions = {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    dispatcher: SECURE_DISPATCHER,
    redirect: 'manual',
  };

  try {
    const res = await fetch(url, fetchOptions);

    const text = await readResponseText(res);
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw errorWithCode('PERMISSION_DENIED', `upstream returned HTTP ${res.status}`);
      }
      throw errorWithCode('UNAVAILABLE', `upstream returned HTTP ${res.status}`);
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw errorWithCode('INTERNAL', 'upstream returned invalid JSON');
    }

    if (json.error) {
      const rpcErr = json.error;
      const msg = `upstream JSON-RPC error (${String(rpcErr.code ?? 'unknown')})`;
      if (rpcErr.code === -32600 || rpcErr.code === -32602) {
        throw errorWithCode('INVALID_ARGUMENT', msg);
      }
      if (rpcErr.code === -32601) {
        throw errorWithCode('FAILED_PRECONDITION', msg);
      }
      // -32xxx range: server-side errors (e.g. -32000 "获取当前页面数据失败")
      // These are upstream failures, not connectivity issues
      if (rpcErr.code >= -32099 && rpcErr.code <= -32000) {
        throw errorWithCode('INTERNAL', msg);
      }
      // Code 1: auth failure
      if (rpcErr.code === 1) {
        throw errorWithCode('PERMISSION_DENIED', msg || 'authentication failed');
      }
      throw errorWithCode('INTERNAL', msg);
    }

    return json.result;
  } catch (e) {
    if (e instanceof GrpcError) throw e;
    // AbortSignal.timeout() throws a TimeoutError on expiry
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      throw errorWithCode('DEADLINE_EXCEEDED', `request timed out after ${timeoutMs}ms`);
    }
    throw errorWithCode('UNAVAILABLE', 'upstream request failed');
  }
};

// ─── Map log record ───

const mapLogRecord = (item) => {
  if (!item || typeof item !== 'object') return {};
  // Cosmos API returns rich, version-variable fields.
  // We store the complete original record in `raw` (google.protobuf.Struct)
  // to avoid snake_case ↔ camelCase conversion issues with protobuf-es.
  return { raw: item };
};

// ─── Method handlers ───

export function rpcdef(ctx) {
  const bindings = mergedBindings(ctx);
  const endpoint = bindings.endpoint || bindings.restBaseUrl || bindings.rest_base_url || bindings.baseUrl || bindings.base_url || '';
  const timeoutMs = validateTimeoutMs(firstDefined(ctx.limits?.timeoutMs, bindings.timeoutMs));
  const baseHeaders = parseHeaders(bindings.headers);
  const meta = ctx.meta || {};

  const getToken = () => {
    // Deliberately do not read credentials from config/bindings/request payloads.
    // This follows the OctoBus convention that credentials belong in secret config,
    // not in per-call request payloads.
    const token = firstNonEmpty(ctx.secret?.api_token, ctx.secret?.apiToken);
    return String(token || '').trim();
  };

  const logFlow = (action, details) => {
    const inst = meta.instance_id || meta.instanceId;
    const reqId = meta.request_id || meta.requestId;
    const trace = [];
    if (inst) trace.push(`inst=${inst}`);
    if (reqId) trace.push(`req=${reqId}`);
    const prefix = `[Chaitin_COSMOS][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
    try {
      console.log(prefix, JSON.stringify(details));
    } catch {
      console.log(prefix, details);
    }
  };

  const normalizedEndpoint = normalizeBaseUrl(endpoint);

  const callSearchLogInfo = async (req) => {
    const token = getToken();
    if (!token) {
      throw errorWithCode('INVALID_ARGUMENT', 'api_token is required (configure via secret)');
    }
    if (!normalizedEndpoint) {
      throw errorWithCode('INVALID_ARGUMENT', 'endpoint is required (http/https)');
    }

    const rawIds = firstDefined(req?.ids, req?.Ids);
    let ids;
    if (Array.isArray(rawIds)) {
      ids = rawIds.map((id) => String(id));
    } else if (typeof rawIds === 'string') {
      ids = [rawIds];
    } else {
      throw errorWithCode('INVALID_ARGUMENT', 'ids must be a non-empty array of strings');
    }
    if (ids.length === 0) {
      throw errorWithCode('INVALID_ARGUMENT', 'ids must be non-empty');
    }

    logFlow('SearchLogInfo:start', { ids_count: ids.length });

    const params = { ids };
    const result = await callPedestalRpc(normalizedEndpoint, 'LogService.SearchLogInfo', params, token, baseHeaders, timeoutMs);

    const dataArr = result?.data;
    const records = Array.isArray(dataArr) ? dataArr.map(mapLogRecord) : [];

    logFlow('SearchLogInfo:done', { count: records.length });

    return {
      err: toValue(null),
      msg: toValue(null),
      data: { records },
    };
  };

  const callSearchLogList = async (req) => {
    const token = getToken();
    if (!token) {
      throw errorWithCode('INVALID_ARGUMENT', 'api_token is required (configure via secret)');
    }
    if (!normalizedEndpoint) {
      throw errorWithCode('INVALID_ARGUMENT', 'endpoint is required (http/https)');
    }

    const params = {};

    // keyword — skip empty arrays, Cosmos treats [] as "no match"
    const rawKeyword = firstDefined(req?.keyword, req?.Keyword);
    if (rawKeyword !== undefined && rawKeyword !== null) {
      const kw = Array.isArray(rawKeyword) ? rawKeyword.map(String) : typeof rawKeyword === 'string' ? [rawKeyword] : null;
      if (kw === null) {
        throw errorWithCode('INVALID_ARGUMENT', 'keyword must be a string array');
      }
      if (kw.length > 0) params.keyword = kw;
    }

    // time range
    const rawStart = firstDefined(req?.time_range_start, req?.timeRangeStart);
    const rawEnd = firstDefined(req?.time_range_end, req?.timeRangeEnd);
    const start = toPositiveInt(rawStart);
    const end = toPositiveInt(rawEnd);
    if (start !== null) params.time_range_start = start;
    if (end !== null) params.time_range_end = end;

    // advanced_query
    const advQuery = unwrapString(firstDefined(req?.advanced_query, req?.advancedQuery, req?.AdvancedQuery));
    if (advQuery) params.advanced_query = advQuery;

    // condition_query
    const rawCq = firstDefined(req?.condition_query, req?.conditionQuery, req?.ConditionQuery);
    if (rawCq !== undefined && rawCq !== null) {
      if (typeof rawCq === 'object' && !Array.isArray(rawCq)) {
        params.condition_query = {
          logical_op: rawCq.logical_op || 'AND',
          expressions: Array.isArray(rawCq.expressions)
            ? rawCq.expressions.map((e) => ({
                column: e?.column ?? '',
                op: e?.op ?? 'equal',
                value: String(e?.value ?? ''),
              }))
            : [],
        };
      }
    }

    // filter
    const rawFilter = firstDefined(req?.filter, req?.Filter);
    if (rawFilter !== undefined && rawFilter !== null && typeof rawFilter === 'object' && !Array.isArray(rawFilter)) {
      const f = {};
      for (const key of ['origin_event_name', 'src_ip', 'dest_ip', 'src_country', 'src_port', 'dest_port']) {
        const val = rawFilter[key];
        if (val !== undefined && val !== null) f[key] = Array.isArray(val) ? val : null;
      }
      const attackResult = rawFilter.attack_result || rawFilter.attackResult;
      if (attackResult !== undefined && attackResult !== null) {
        f.attack_result = Array.isArray(attackResult) ? attackResult : null;
      }
      params.filter = f;
    }

    // pagination
    const count = toPositiveInt(firstDefined(req?.count, req?.Count));
    if (count !== null) params.count = count;
    const offset = toPositiveInt(firstDefined(req?.offset, req?.Offset));
    if (offset !== null) params.offset = offset;

    // attack_chain_phase
    const acp = unwrapString(firstDefined(req?.attack_chain_phase, req?.attackChainPhase));
    if (acp) params.attack_chain_phase = acp;

    // fall (compromise status)
    const rawFall = firstDefined(req?.fall, req?.Fall);
    if (rawFall !== undefined && rawFall !== null) {
      params.fall = toBoolean(rawFall);
    }

    // organization — skip if empty, Cosmos treats [] as "filter by nothing"
    const rawOrg = firstDefined(req?.organization, req?.Organization);
    if (rawOrg !== undefined && rawOrg !== null && Array.isArray(rawOrg) && rawOrg.length > 0) {
      const org = rawOrg.filter((o) => o && typeof o === 'object').map((o) => ({
        oper: o.oper || '=',
        target: toPositiveInt(o.target) ?? 0,
      }));
      if (org.length > 0) params.organization = org;
    }

    logFlow('SearchLogList:start', { keyword: params.keyword, count: params.count });

    const result = await callPedestalRpc(normalizedEndpoint, 'LogService.SearchLogList', params, token, baseHeaders, timeoutMs);

    // Cosmos SearchLogList response: result.data is an array of log records
    // start_time/end_time may appear at result.data level or at result level
    const dataField = result?.data;
    // Handle both formats: flat array (result.data = [...records]) and nested (result.data.records)
    let records;
    let startTime;
    let endTime;
    if (Array.isArray(dataField)) {
      records = dataField.map(mapLogRecord);
      startTime = result?.start_time ?? 0;
      endTime = result?.end_time ?? 0;
    } else if (dataField && typeof dataField === 'object') {
      const innerRecords = dataField.records ?? dataField.list ?? dataField.items ?? [];
      records = Array.isArray(innerRecords) ? innerRecords.map(mapLogRecord) : [];
      startTime = dataField.start_time ?? result?.start_time ?? 0;
      endTime = dataField.end_time ?? result?.end_time ?? 0;
    } else {
      records = [];
      startTime = 0;
      endTime = 0;
    }

    logFlow('SearchLogList:done', { count: records.length });

    return {
      err: toValue(null),
      msg: toValue(null),
      data: {
        records,
        start_time: startTime,
        end_time: endTime,
      },
    };
  };

  const callSearchAggregationStatistics = async (req) => {
    const token = getToken();
    if (!token) {
      throw errorWithCode('INVALID_ARGUMENT', 'api_token is required (configure via secret)');
    }
    if (!normalizedEndpoint) {
      throw errorWithCode('INVALID_ARGUMENT', 'endpoint is required (http/https)');
    }

    const params = {};

    // keyword — skip empty arrays, Cosmos treats [] as "no match"
    const rawKeyword = firstDefined(req?.keyword, req?.Keyword);
    if (rawKeyword !== undefined && rawKeyword !== null) {
      const kw = Array.isArray(rawKeyword) ? rawKeyword.map(String) : typeof rawKeyword === 'string' ? [rawKeyword] : null;
      if (kw === null) {
        throw errorWithCode('INVALID_ARGUMENT', 'keyword must be a string array');
      }
      if (kw.length > 0) params.keyword = kw;
    }

    // time range
    const start = toPositiveInt(firstDefined(req?.time_range_start, req?.timeRangeStart));
    if (start !== null) params.time_range_start = start;
    const end = toPositiveInt(firstDefined(req?.time_range_end, req?.timeRangeEnd));
    if (end !== null) params.time_range_end = end;

    // advanced_query
    const advQuery = unwrapString(firstDefined(req?.advanced_query, req?.advancedQuery, req?.AdvancedQuery));
    if (advQuery) params.advanced_query = advQuery;

    // condition_query
    const rawCq = firstDefined(req?.condition_query, req?.conditionQuery, req?.ConditionQuery);
    if (rawCq !== undefined && rawCq !== null) {
      if (typeof rawCq === 'object' && !Array.isArray(rawCq)) {
        params.condition_query = {
          logical_op: rawCq.logical_op || 'AND',
          expressions: Array.isArray(rawCq.expressions)
            ? rawCq.expressions.map((e) => ({
                column: e?.column ?? '',
                op: e?.op ?? 'equal',
                value: String(e?.value ?? ''),
              }))
            : [],
        };
      }
    }

    // filter
    const rawFilter = firstDefined(req?.filter, req?.Filter);
    if (rawFilter !== undefined && rawFilter !== null && typeof rawFilter === 'object' && !Array.isArray(rawFilter)) {
      const f = {};
      for (const key of ['origin_event_name', 'src_ip', 'dest_ip', 'src_country', 'src_port', 'dest_port']) {
        const val = rawFilter[key];
        if (val !== undefined && val !== null) f[key] = Array.isArray(val) ? val : null;
      }
      const attackResult = rawFilter.attack_result || rawFilter.attackResult;
      if (attackResult !== undefined && attackResult !== null) {
        f.attack_result = Array.isArray(attackResult) ? attackResult : null;
      }
      params.filter = f;
    }

    // aggregation keys
    const rawKey = firstDefined(req?.key, req?.Key);
    if (rawKey !== undefined && rawKey !== null) {
      if (Array.isArray(rawKey)) {
        params.key = rawKey.map(String);
      } else {
        throw errorWithCode('INVALID_ARGUMENT', 'key must be a string array');
      }
    }

    // count & asc
    const count = toPositiveInt(firstDefined(req?.count, req?.Count));
    if (count !== null) params.count = count;
    const rawAsc = firstDefined(req?.asc, req?.Asc);
    if (rawAsc !== undefined && rawAsc !== null) {
      params.asc = toBoolean(rawAsc);
    }

    // attack_chain_phase
    const acp = unwrapString(firstDefined(req?.attack_chain_phase, req?.attackChainPhase));
    if (acp) params.attack_chain_phase = acp;

    // fall (compromise status)
    const rawFall = firstDefined(req?.fall, req?.Fall);
    if (rawFall !== undefined && rawFall !== null) {
      params.fall = toBoolean(rawFall);
    }

    // organization — skip if empty, Cosmos treats [] as "filter by nothing"
    const rawOrg = firstDefined(req?.organization, req?.Organization);
    if (rawOrg !== undefined && rawOrg !== null && Array.isArray(rawOrg) && rawOrg.length > 0) {
      const org = rawOrg.filter((o) => o && typeof o === 'object').map((o) => ({
        oper: o.oper || '=',
        target: toPositiveInt(o.target) ?? 0,
      }));
      if (org.length > 0) params.organization = org;
    }

    logFlow('SearchAggregation:start', { key: params.key, count: params.count });

    const result = await callPedestalRpc(normalizedEndpoint, 'LogService.SearchAggregationStatistics', params, token, baseHeaders, timeoutMs);

    // Cosmos SearchAggregationStatistics response:
    // result.data is an array of aggregation groups, result.total is the total count
    // Handle both flat array and nested object formats
    const dataField = result?.data;
    const mapGroup = (g) => ({
      result: g?.result ?? {},
      data: Array.isArray(g?.data) ? g.data.map((p) => ({
        start_time: p?.start_time ?? 0,
        count: p?.count ?? 0,
      })) : [],
      count: g?.count ?? 0,
    });
    let groups;
    let total;
    if (Array.isArray(dataField)) {
      groups = dataField.map(mapGroup);
      total = result?.total ?? 0;
    } else if (dataField && typeof dataField === 'object') {
      const innerGroups = dataField.groups ?? dataField.list ?? dataField.items ?? [];
      groups = Array.isArray(innerGroups) ? innerGroups.map(mapGroup) : [];
      total = dataField.total ?? result?.total ?? 0;
    } else {
      groups = [];
      total = 0;
    }

    logFlow('SearchAggregation:done', { groups: groups.length, total });

    return {
      err: toValue(null),
      msg: toValue(null),
      data: {
        groups,
        total,
      },
    };
  };

  return {
    [METHOD_SEARCH_LOG_INFO]: async () => callSearchLogInfo(ctx.req),
    [METHOD_SEARCH_LOG_LIST]: async () => callSearchLogList(ctx.req),
    [METHOD_SEARCH_AGGREGATION]: async () => callSearchAggregationStatistics(ctx.req),
  };
}

// ─── OctoBus SDK registration ───

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
  [METHOD_SEARCH_LOG_INFO]: wrapLegacyHandler(ctx, METHOD_SEARCH_LOG_INFO),
  [METHOD_SEARCH_LOG_LIST]: wrapLegacyHandler(ctx, METHOD_SEARCH_LOG_LIST),
  [METHOD_SEARCH_AGGREGATION]: wrapLegacyHandler(ctx, METHOD_SEARCH_AGGREGATION),
});

const sdkHandlers = registerHandlers({});

export const METHOD_SEARCH_LOG_INFO_FULL = 'Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo';
export const METHOD_SEARCH_LOG_LIST_FULL = 'Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList';
export const METHOD_SEARCH_AGGREGATION_FULL = 'Chaitin_COSMOS.Chaitin_COSMOS/SearchAggregationStatistics';

export const handlers = {
  [METHOD_SEARCH_LOG_INFO_FULL]: (ctx) => sdkHandlers[METHOD_SEARCH_LOG_INFO](ctx),
  [METHOD_SEARCH_LOG_LIST_FULL]: (ctx) => sdkHandlers[METHOD_SEARCH_LOG_LIST](ctx),
  [METHOD_SEARCH_AGGREGATION_FULL]: (ctx) => sdkHandlers[METHOD_SEARCH_AGGREGATION](ctx),
};

export const _test = {
  errorWithCode,
  firstDefined,
  firstNonEmpty,
  mergedBindings,
  normalizeBaseUrl,
  parseHeaders,
  registerHandlers,
  resolveCallContext,
  toBoolean,
  toPositiveInt,
  toValue,
  unwrapString,
};
