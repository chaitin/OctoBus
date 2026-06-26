// Chaitin_COSMOS Cosmos Pedestal JSON-RPC proxy
// Bindings: endpoint (required), headers (optional), timeoutMs (optional), skipTlsVerify (optional)

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const DEFAULT_TIMEOUT_MS = 5000;
const RPC_PATH = '/pedestal/rpc';

const METHOD_SEARCH_LOG_INFO = '/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo';
const METHOD_SEARCH_LOG_LIST = '/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList';
const METHOD_SEARCH_AGGREGATION = '/Chaitin_COSMOS.Chaitin_COSMOS/SearchAggregationStatistics';

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
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
  if (!/^https?:\/\//i.test(base)) return null;
  return base.replace(/\/$/, '');
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

const callPedestalRpc = async (endpoint, rpcMethod, params, token, baseHeaders, timeoutMs, skipTlsVerify) => {
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
  };
  // Node.js fetch() does not support TLS options directly.
  // Set NODE_TLS_REJECT_UNAUTHORIZED=0 before the request to skip verification
  // for self-signed certs, then restore the original value afterward.
  const savedTlsEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  if (skipTlsVerify) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  try {
    const res = await fetch(url, fetchOptions);

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401 || res.status === 403) {
        throw errorWithCode('PERMISSION_DENIED', `upstream http ${res.status}: ${text}`);
      }
      throw errorWithCode('UNAVAILABLE', `upstream http ${res.status}: ${text}`);
    }

    const json = await res.json();

    if (json.error) {
      const rpcErr = json.error;
      const msg = rpcErr.message || String(rpcErr.code || 'unknown rpc error');
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
    const reason = e?.cause?.message || e?.message || 'rpc call failed';
    throw errorWithCode('UNAVAILABLE', reason);
  } finally {
    // Restore original TLS env var
    if (savedTlsEnv === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = savedTlsEnv;
    }
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
  const timeoutMs = ctx.limits?.timeoutMs || DEFAULT_TIMEOUT_MS;
  const baseHeaders = parseHeaders(bindings.headers);
  const meta = ctx.meta || {};
  const skipTlsVerify = Boolean(bindings.tlsInsecureSkipVerify || bindings.skipTlsVerify || bindings.skip_tls_verify || bindings.tls_insecure_skip_verify);

  const requestWithDefaults = (req = {}) => {
    // proto3 defaults string fields to "" — treat empty strings as "not set"
    // so bindings.api_token can fill in when the request doesn't specify it
    const token = firstNonEmpty(req?.api_token, req?.apiToken, bindings.api_token, bindings.apiToken);
    if (!token) return { ...(req ?? {}) };
    // Spread req FIRST so our resolved api_token takes priority over the
    // proto3 default empty string in req.api_token
    return {
      ...(req ?? {}),
      api_token: token,
    };
  };

  const getToken = (req) => {
    // proto3 defaults string fields to "" — treat empty strings as absent
    const token = firstNonEmpty(req?.api_token, req?.apiToken, bindings.api_token, bindings.apiToken);
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
    const token = getToken(req);
    if (!token) {
      throw errorWithCode('INVALID_ARGUMENT', 'api_token is required');
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

    logFlow('SearchLogInfo:start', { endpoint: normalizedEndpoint, ids_count: ids.length });

    const params = { ids };
    const result = await callPedestalRpc(normalizedEndpoint, 'LogService.SearchLogInfo', params, token, baseHeaders, timeoutMs, skipTlsVerify);

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
    const token = getToken(req);
    if (!token) {
      throw errorWithCode('INVALID_ARGUMENT', 'api_token is required');
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

    logFlow('SearchLogList:start', { endpoint: normalizedEndpoint, keyword: params.keyword, count: params.count });

    const result = await callPedestalRpc(normalizedEndpoint, 'LogService.SearchLogList', params, token, baseHeaders, timeoutMs, skipTlsVerify);

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
    const token = getToken(req);
    if (!token) {
      throw errorWithCode('INVALID_ARGUMENT', 'api_token is required');
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

    logFlow('SearchAggregation:start', { endpoint: normalizedEndpoint, key: params.key, count: params.count });

    const result = await callPedestalRpc(normalizedEndpoint, 'LogService.SearchAggregationStatistics', params, token, baseHeaders, timeoutMs, skipTlsVerify);

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
    [METHOD_SEARCH_LOG_INFO]: async () => callSearchLogInfo(requestWithDefaults(ctx.req)),
    [METHOD_SEARCH_LOG_LIST]: async () => callSearchLogList(requestWithDefaults(ctx.req)),
    [METHOD_SEARCH_AGGREGATION]: async () => callSearchAggregationStatistics(requestWithDefaults(ctx.req)),
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
