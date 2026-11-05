// Chaitin Answer-Platform (全悉) V26.07.002 — OpenAPI / API-Token 形式
// JSON-RPC 2.0 proxy over HTTP POST /rpc，每个请求带 API-Token 头（无会话）。

import { randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { Agent } from 'undici';
import { SocksProxyAgent } from 'socks-proxy-agent';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

// Full gRPC method names.
const GET_ALARM = 'Answer_Platform_V26.Answer_Platform_V26/GetAlarm';
const GET_ALARM_DOCUMENT = 'Answer_Platform_V26.Answer_Platform_V26/GetAlarmDocument';
const SEARCH_ALARM_CUSTOM_INTELLIGENCE_LIST = 'Answer_Platform_V26.Answer_Platform_V26/SearchAlarmCustomIntelligenceList';
const SEARCH_ALARM_CUSTOM_RULE_LIST = 'Answer_Platform_V26.Answer_Platform_V26/SearchAlarmCustomRuleList';
const SEARCH_ALARM_LIST = 'Answer_Platform_V26.Answer_Platform_V26/SearchAlarmList';
const SEARCH_ASSET_IDENTIFY = 'Answer_Platform_V26.Answer_Platform_V26/SearchAssetIdentify';
const GET_ASSET_INFO = 'Answer_Platform_V26.Answer_Platform_V26/GetAssetInfo';
const GET_ASSET_LIST = 'Answer_Platform_V26.Answer_Platform_V26/GetAssetList';
const SEARCH_ASSET_TREE = 'Answer_Platform_V26.Answer_Platform_V26/SearchAssetTree';
const SEARCH_GROUPS = 'Answer_Platform_V26.Answer_Platform_V26/SearchGroups';
const SEARCH_TAGS = 'Answer_Platform_V26.Answer_Platform_V26/SearchTags';
const GET_PCAP_DETECT_ALARM = 'Answer_Platform_V26.Answer_Platform_V26/GetPcapDetectAlarm';
const GET_PCAP_DETECT_ALARM_DOCUMENT = 'Answer_Platform_V26.Answer_Platform_V26/GetPcapDetectAlarmDocument';
const GET_PCAP_DETECT_TASK_LIST = 'Answer_Platform_V26.Answer_Platform_V26/GetPcapDetectTaskList';
const SEARCH_PCAP_DETECT_ALARM_LIST = 'Answer_Platform_V26.Answer_Platform_V26/SearchPcapDetectAlarmList';
const SEARCH_TCPDUMP_PROCESS = 'Answer_Platform_V26.Answer_Platform_V26/SearchTcpdumpProcess';

// 上游 JSON-RPC 方法名（OpenAPI path 去首斜杠）。
const UPSTREAM_METHOD = {
  [GET_ALARM]: 'AlarmService.GetAlarm',
  [GET_ALARM_DOCUMENT]: 'AlarmService.GetAlarmDocument',
  [SEARCH_ALARM_CUSTOM_INTELLIGENCE_LIST]: 'AlarmService.SearchAlarmCustomIntelligenceList',
  [SEARCH_ALARM_CUSTOM_RULE_LIST]: 'AlarmService.SearchAlarmCustomRuleList',
  [SEARCH_ALARM_LIST]: 'AlarmService.SearchAlarmList',
  [SEARCH_ASSET_IDENTIFY]: 'AssetIdentifyApi.SearchAssetIdentify',
  [GET_ASSET_INFO]: 'AssetService.GetAssetInfo',
  [GET_ASSET_LIST]: 'AssetService.GetAssetList',
  [SEARCH_ASSET_TREE]: 'AssetService.SearchAssetTree',
  [SEARCH_GROUPS]: 'AssetService.SearchGroups',
  [SEARCH_TAGS]: 'AssetService.SearchTags',
  [GET_PCAP_DETECT_ALARM]: 'PcapDetectService.GetAlarm',
  [GET_PCAP_DETECT_ALARM_DOCUMENT]: 'PcapDetectService.GetAlarmDocument',
  [GET_PCAP_DETECT_TASK_LIST]: 'PcapDetectService.GetPcapDetectTaskList',
  [SEARCH_PCAP_DETECT_ALARM_LIST]: 'PcapDetectService.SearchPcapDetectAlarmList',
  [SEARCH_TCPDUMP_PROCESS]: 'TcpdumpService.SearchTcpdumpProcess',
};

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const RPC_PATH = '/rpc';

// ─── Helpers ───

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

const toOptionalBool = (val) => {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'object' && val !== null && 'value' in val) return toOptionalBool(val.value);
  if (typeof val === 'boolean') return val;
  const str = String(val).trim().toLowerCase();
  if (str === 'true') return true;
  if (str === 'false') return false;
  return undefined;
};

// ─── gRPC error helpers ───

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  DEADLINE_EXCEEDED: grpcStatus.DEADLINE_EXCEEDED,
  NOT_FOUND: grpcStatus.NOT_FOUND,
  INTERNAL: grpcStatus.INTERNAL,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

// ─── google.protobuf.Struct 输入还原 ───
// protobuf-es v2 里 Struct 的解码形态是 { fields: { key: { kind: { case, value } } } }，
// 这里把它还原成普通 JSON 对象，用于透传上游 {oper,target} 等过滤字段。

const unwrapValue = (v) => {
  if (v === undefined || v === null) return null;
  const kind = v?.kind;
  if (kind === undefined || typeof v !== 'object') return v;
  switch (kind.case) {
    case 'nullValue': return null;
    case 'numberValue': return kind.value;
    case 'stringValue': return kind.value;
    case 'boolValue': return kind.value;
    case 'structValue': return unwrapStruct(kind.value);
    case 'listValue': return (kind.value?.values ?? []).map(unwrapValue);
    default: return null;
  }
};

const unwrapStruct = (s) => {
  if (s === undefined || s === null) return {};
  const fields = s?.fields ?? {};
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = unwrapValue(v);
  return out;
};

// ─── Config / context ───

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.secret ?? {}),
  ...(ctx?.bindings ?? {}),
});

const normalizeBaseUrl = (url) => {
  const base = String(url || '').trim();
  if (!base) return '';
  try {
    const parsed = new URL(base);
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) return '';
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return '';
    parsed.pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
};

const BLOCKED_HEADER_NAMES = new Set([
  'api-token', 'authorization', 'connection', 'content-length', 'content-type',
  'cookie', 'host', 'proxy-authorization', 'transfer-encoding',
]);

const parseHeaders = (value) => {
  if (value === undefined || value === null || value === '') return {};
  let obj = value;
  if (typeof value === 'string') {
    try {
      obj = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const safe = {};
  for (const [name, val] of Object.entries(obj)) {
    if (BLOCKED_HEADER_NAMES.has(name.toLowerCase())) continue;
    if (typeof val === 'string') safe[name] = val;
  }
  return safe;
};

const validateTimeoutMs = (val) => {
  if (val === undefined || val === null) return DEFAULT_TIMEOUT_MS;
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw errorWithCode('INVALID_ARGUMENT', `timeoutMs must be a positive integer, got ${JSON.stringify(val)}`);
  }
  return n;
};

// Per-request undici dispatchers（跳过 TLS 校验只影响本请求，不改 process.env）。
const INSECURE_DISPATCHER = new Agent({ connect: { rejectUnauthorized: false } });

// ─── JSON-RPC 传输 ───

// socks5 等代理走原生 http(s).request + SocksProxyAgent（纯 Node，无 curl 依赖）。
const proxiedFetch = (url, { method = 'POST', headers = {}, body } = {}, { timeoutMs, proxyUrl, skipTlsVerify } = {}) => new Promise((resolve, reject) => {
  const target = new URL(url);
  const mod = target.protocol === 'https:' ? https : http;
  const agent = new SocksProxyAgent(proxyUrl);

  const req = mod.request(target, {
    method,
    headers,
    agent,
    rejectUnauthorized: !skipTlsVerify,
  }, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => {
      const bodyText = Buffer.concat(chunks).toString('utf8');
      const headerMap = {};
      for (const [name, value] of Object.entries(res.headers)) {
        const key = name.toLowerCase();
        if (!(key in headerMap)) headerMap[key] = Array.isArray(value) ? value.join(', ') : value;
      }
      resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        headers: { get: (name) => headerMap[String(name).toLowerCase()] ?? null },
        text: async () => bodyText,
      });
    });
  });

  req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
  req.on('error', (err) => {
    if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') {
      reject(errorWithCode('DEADLINE_EXCEEDED', `RPC timeout after ${timeoutMs}ms`));
    } else {
      reject(errorWithCode('UNAVAILABLE', err.message || 'proxied request failed'));
    }
  });
  if (body !== undefined && body !== null) req.write(String(body));
  req.end();
});

const readResponseText = async (res, maxResponseBytes) => {
  const declared = Number(res.headers.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxResponseBytes) {
    throw errorWithCode('INTERNAL', `upstream response exceeds ${maxResponseBytes} bytes`);
  }
  const text = await res.text();
  if (Buffer.byteLength(text) > maxResponseBytes) {
    throw errorWithCode('INTERNAL', `upstream response exceeds ${maxResponseBytes} bytes`);
  }
  return text;
};

const rpcCall = async (ctx, upstreamMethod, params) => {
  const bindings = mergedBindings(ctx);
  const baseUrl = normalizeBaseUrl(bindings.restBaseUrl || bindings.baseUrl || bindings.rest_base_url);
  if (!baseUrl) throw errorWithCode('INVALID_ARGUMENT', 'restBaseUrl is required (https://...)');

  const token = String(firstNonEmpty(ctx?.secret?.api_token, ctx?.secret?.apiToken) ?? '').trim();
  if (!token) throw errorWithCode('INVALID_ARGUMENT', 'api_token is required (configure via instance secret)');

  const timeoutMs = validateTimeoutMs(firstDefined(ctx?.limits?.timeoutMs, bindings.timeoutMs));
  const maxResponseBytes = Number(bindings.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES) || DEFAULT_MAX_RESPONSE_BYTES;
  const skipTlsVerify = Boolean(bindings.skipTlsVerify);
  const baseHeaders = parseHeaders(bindings.headers);

  const headers = {
    'Content-Type': 'application/json',
    ...baseHeaders,
    'API-Token': token,
  };

  const body = JSON.stringify({
    jsonrpc: '2.0',
    method: upstreamMethod,
    params,
    id: randomUUID(),
  });

  const rawProxyUrl = String(firstDefined(bindings.proxy_url, bindings.proxyUrl) ?? '').trim();
  // Only socks:// schemes are routable through SocksProxyAgent; a plain http(s)
  // URL (e.g. the smoke harness synthesizing the mock upstream) is not a proxy.
  const proxyUrl = /^socks(4a?|5h?)?:\/\//i.test(rawProxyUrl) ? rawProxyUrl : '';

  let res;
  if (proxyUrl) {
    res = await proxiedFetch(`${baseUrl}${RPC_PATH}`, { method: 'POST', headers, body }, {
      timeoutMs, proxyUrl, skipTlsVerify,
    });
  } else {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      res = await fetch(`${baseUrl}${RPC_PATH}`, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
        ...(skipTlsVerify ? { dispatcher: INSECURE_DISPATCHER } : {}),
      });
    } catch (err) {
      if (err.name === 'AbortError') throw errorWithCode('DEADLINE_EXCEEDED', `RPC timeout after ${timeoutMs}ms`);
      throw errorWithCode('UNAVAILABLE', err?.cause?.message || err?.message || 'fetch failed');
    } finally {
      clearTimeout(timer);
    }
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw errorWithCode('PERMISSION_DENIED', `upstream returned HTTP ${res.status}`);
    }
    throw errorWithCode('UNAVAILABLE', `upstream returned HTTP ${res.status}`);
  }

  let json;
  try {
    const text = await readResponseText(res, maxResponseBytes);
    json = JSON.parse(text);
  } catch {
    throw errorWithCode('INTERNAL', `upstream response is invalid or too large (HTTP ${res.status})`);
  }

  if (json.error) {
    const rpcErr = json.error;
    const msg = rpcErr.message || `RPC error ${rpcErr.code}`;
    if (rpcErr.code === 1 || rpcErr.code === 2) {
      throw errorWithCode('PERMISSION_DENIED', msg);
    }
    if (rpcErr.code === -32601) {
      throw errorWithCode('FAILED_PRECONDITION', msg);
    }
    if (rpcErr.code === -32602) {
      throw errorWithCode('INVALID_ARGUMENT', msg);
    }
    throw errorWithCode('INTERNAL', msg);
  }

  return json.result;
};

// ─── 响应映射 ───

const asItems = (data) => (Array.isArray(data) ? data.map((d) => (d && typeof d === 'object' ? d : {})) : []);

const mapList = (result, listField = 'data') => {
  const data = result?.[listField] ?? [];
  return {
    items: asItems(data),
    total: Number(result?.total ?? 0),
  };
};

const mapPagedList = (result) => ({
  items: asItems(result?.data),
  page_total: Number(result?.page_total ?? 0),
  total: Number(result?.total ?? 0),
});

const mapData = (result) => {
  const data = result?.data ?? result ?? {};
  return { data: data && typeof data === 'object' ? data : {} };
};

// ─── 参数组装 ───

const setInt = (params, key, val) => {
  const n = toPositiveInt(val);
  if (n !== null) params[key] = n;
};
const setStr = (params, key, val) => {
  const s = unwrapString(val);
  if (s) params[key] = s;
};
const setKeyword = (params, req) => {
  const kw = firstDefined(req?.keyword, req?.Keyword);
  if (Array.isArray(kw)) {
    const list = kw.map(String).filter((s) => s !== '');
    if (list.length > 0) params.keyword = list;
  }
};
const mergeFilters = (params, req) => {
  Object.assign(params, unwrapStruct(req?.filters ?? req?.Filters));
};

const buildBase = (req) => {
  const params = {};
  setInt(params, 'count', firstDefined(req?.count, req?.Count));
  setInt(params, 'offset', firstDefined(req?.offset, req?.Offset));
  return params;
};

// ─── 各方法 handler ───

async function handleGetAlarm(req, ctx) {
  const docId = unwrapString(firstDefined(req?.doc_id, req?.docId));
  if (!docId) throw errorWithCode('INVALID_ARGUMENT', 'doc_id is required');
  const result = await rpcCall(ctx, UPSTREAM_METHOD[GET_ALARM], { doc_id: docId });
  return mapData(result);
}

async function handleGetAlarmDocument(req, ctx) {
  const docId = unwrapString(firstDefined(req?.doc_id, req?.docId));
  if (!docId) throw errorWithCode('INVALID_ARGUMENT', 'doc_id is required');
  const result = await rpcCall(ctx, UPSTREAM_METHOD[GET_ALARM_DOCUMENT], { doc_id: docId });
  return mapData(result);
}

async function handleSearchAlarmCustomIntelligenceList(req, ctx) {
  const params = buildBase(req);
  mergeFilters(params, req);
  const result = await rpcCall(ctx, UPSTREAM_METHOD[SEARCH_ALARM_CUSTOM_INTELLIGENCE_LIST], params);
  return mapList(result);
}

async function handleSearchAlarmCustomRuleList(req, ctx) {
  const params = buildBase(req);
  mergeFilters(params, req);
  const result = await rpcCall(ctx, UPSTREAM_METHOD[SEARCH_ALARM_CUSTOM_RULE_LIST], params);
  return mapList(result);
}

async function handleSearchAlarmList(req, ctx) {
  const params = buildBase(req);
  setInt(params, 'time_range_start', firstDefined(req?.time_range_start, req?.timeRangeStart));
  setInt(params, 'time_range_end', firstDefined(req?.time_range_end, req?.timeRangeEnd));
  setKeyword(params, req);
  mergeFilters(params, req);
  const result = await rpcCall(ctx, UPSTREAM_METHOD[SEARCH_ALARM_LIST], params);
  return mapPagedList(result);
}

async function handleSearchAssetIdentify(req, ctx) {
  const params = buildBase(req);
  setStr(params, 'name', firstDefined(req?.name, req?.Name));
  setStr(params, 'ip_addr', firstDefined(req?.ip_addr, req?.ipAddr));
  setStr(params, 'asset_type', firstDefined(req?.asset_type, req?.assetType));
  setInt(params, 'group_id', firstDefined(req?.group_id, req?.groupId));
  setInt(params, 'importance', firstDefined(req?.importance, req?.Importance));
  mergeFilters(params, req);
  const result = await rpcCall(ctx, UPSTREAM_METHOD[SEARCH_ASSET_IDENTIFY], params);
  return mapList(result);
}

async function handleGetAssetInfo(req, ctx) {
  const id = toPositiveInt(firstDefined(req?.id, req?.Id));
  if (id === null) throw errorWithCode('INVALID_ARGUMENT', 'id is required');
  const result = await rpcCall(ctx, UPSTREAM_METHOD[GET_ASSET_INFO], { id });
  return mapData(result);
}

async function handleGetAssetList(req, ctx) {
  const params = buildBase(req);
  setStr(params, 'name', firstDefined(req?.name, req?.Name));
  setStr(params, 'ip', firstDefined(req?.ip, req?.Ip));
  setInt(params, 'group_id', firstDefined(req?.group_id, req?.groupId));
  setStr(params, 'asset_type', firstDefined(req?.asset_type, req?.assetType));
  setInt(params, 'importance', firstDefined(req?.importance, req?.Importance));
  mergeFilters(params, req);
  const result = await rpcCall(ctx, UPSTREAM_METHOD[GET_ASSET_LIST], params);
  return mapList(result);
}

async function handleSearchAssetTree(req, ctx) {
  const params = {};
  setStr(params, 'name', firstDefined(req?.name, req?.Name));
  const result = await rpcCall(ctx, UPSTREAM_METHOD[SEARCH_ASSET_TREE], params);
  return { items: asItems(result?.data) };
}

async function handleSearchGroups(req, ctx) {
  const params = {};
  setInt(params, 'depth', firstDefined(req?.depth, req?.Depth));
  setInt(params, 'id', firstDefined(req?.id, req?.Id));
  const withAsset = toOptionalBool(firstDefined(req?.with_asset, req?.withAsset));
  if (withAsset !== undefined) params.with_asset = withAsset;
  const result = await rpcCall(ctx, UPSTREAM_METHOD[SEARCH_GROUPS], params);
  return { items: asItems(result?.data) };
}

async function handleSearchTags(req, ctx) {
  const params = {};
  setStr(params, 'name', firstDefined(req?.name, req?.Name));
  const result = await rpcCall(ctx, UPSTREAM_METHOD[SEARCH_TAGS], params);
  return { items: asItems(result?.data) };
}

async function handleGetPcapDetectAlarm(req, ctx) {
  const docId = unwrapString(firstDefined(req?.doc_id, req?.docId));
  if (!docId) throw errorWithCode('INVALID_ARGUMENT', 'doc_id is required');
  const result = await rpcCall(ctx, UPSTREAM_METHOD[GET_PCAP_DETECT_ALARM], { doc_id: docId });
  return mapData(result);
}

async function handleGetPcapDetectAlarmDocument(req, ctx) {
  const docId = unwrapString(firstDefined(req?.doc_id, req?.docId));
  if (!docId) throw errorWithCode('INVALID_ARGUMENT', 'doc_id is required');
  const result = await rpcCall(ctx, UPSTREAM_METHOD[GET_PCAP_DETECT_ALARM_DOCUMENT], { doc_id: docId });
  return mapData(result);
}

async function handleGetPcapDetectTaskList(req, ctx) {
  const params = {};
  setInt(params, 'limit', firstDefined(req?.limit, req?.Limit));
  setInt(params, 'offset', firstDefined(req?.offset, req?.Offset));
  const result = await rpcCall(ctx, UPSTREAM_METHOD[GET_PCAP_DETECT_TASK_LIST], params);
  return mapList(result, 'pcap_detect_task_list');
}

async function handleSearchPcapDetectAlarmList(req, ctx) {
  const params = buildBase(req);
  setInt(params, 'time_range_start', firstDefined(req?.time_range_start, req?.timeRangeStart));
  setInt(params, 'time_range_end', firstDefined(req?.time_range_end, req?.timeRangeEnd));
  setKeyword(params, req);
  mergeFilters(params, req);
  const result = await rpcCall(ctx, UPSTREAM_METHOD[SEARCH_PCAP_DETECT_ALARM_LIST], params);
  return mapPagedList(result);
}

async function handleSearchTcpdumpProcess(req, ctx) {
  const params = buildBase(req);
  setStr(params, 'device', firstDefined(req?.device, req?.Device));
  setInt(params, 'id', firstDefined(req?.id, req?.Id));
  const result = await rpcCall(ctx, UPSTREAM_METHOD[SEARCH_TCPDUMP_PROCESS], params);
  return mapList(result);
}

// ─── handler map ───

const adapt = (fn) => (sdkCtx) => fn(sdkCtx.request ?? {}, sdkCtx);

export const handlers = {
  [GET_ALARM]: adapt(handleGetAlarm),
  [GET_ALARM_DOCUMENT]: adapt(handleGetAlarmDocument),
  [SEARCH_ALARM_CUSTOM_INTELLIGENCE_LIST]: adapt(handleSearchAlarmCustomIntelligenceList),
  [SEARCH_ALARM_CUSTOM_RULE_LIST]: adapt(handleSearchAlarmCustomRuleList),
  [SEARCH_ALARM_LIST]: adapt(handleSearchAlarmList),
  [SEARCH_ASSET_IDENTIFY]: adapt(handleSearchAssetIdentify),
  [GET_ASSET_INFO]: adapt(handleGetAssetInfo),
  [GET_ASSET_LIST]: adapt(handleGetAssetList),
  [SEARCH_ASSET_TREE]: adapt(handleSearchAssetTree),
  [SEARCH_GROUPS]: adapt(handleSearchGroups),
  [SEARCH_TAGS]: adapt(handleSearchTags),
  [GET_PCAP_DETECT_ALARM]: adapt(handleGetPcapDetectAlarm),
  [GET_PCAP_DETECT_ALARM_DOCUMENT]: adapt(handleGetPcapDetectAlarmDocument),
  [GET_PCAP_DETECT_TASK_LIST]: adapt(handleGetPcapDetectTaskList),
  [SEARCH_PCAP_DETECT_ALARM_LIST]: adapt(handleSearchPcapDetectAlarmList),
  [SEARCH_TCPDUMP_PROCESS]: adapt(handleSearchTcpdumpProcess),
};

// ─── Test exports ───

export const _test = {
  errorWithCode,
  firstDefined,
  firstNonEmpty,
  mergedBindings,
  normalizeBaseUrl,
  parseHeaders,
  toOptionalBool,
  toPositiveInt,
  unwrapString,
  unwrapValue,
  unwrapStruct,
  validateTimeoutMs,
  rpcCall,
  asItems,
  mapList,
  mapPagedList,
  mapData,
  buildBase,
  INSECURE_DISPATCHER,
};
