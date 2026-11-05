// Chaitin CloudWalker CWPP（牧云主机安全）JSON-RPC 2.0 proxy
// Bindings: baseUrl (required), token (secret), skipTlsVerify, proxy_url, timeoutMs
//
// 目标设备 API：POST https://<ip>/rpc，认证 Cookie: API-Token=<token>。
// 设备为客户端内网私有化部署，必须经 socks5 隧道访问（proxy_url），
// 自签证书用 skipTlsVerify 跳过校验。

import http from 'node:http';
import https from 'node:https';
import { Agent as UndiciAgent } from 'undici';
import { SocksProxyAgent } from 'socks-proxy-agent';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const RPC_PATH = '/rpc';

const METHOD_LIST_REALTIME_EVENTS = '/Chaitin_CloudWalker_CWPP.Chaitin_CloudWalker_CWPP/ListRealTimeEvents';
const METHOD_GET_HOST_ASSET_LIST = '/Chaitin_CloudWalker_CWPP.Chaitin_CloudWalker_CWPP/GetHostAssetList';
const METHOD_GET_AGENT_GROUP_TREE = '/Chaitin_CloudWalker_CWPP.Chaitin_CloudWalker_CWPP/GetAgentGroupTree';

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

const validateTimeoutMs = (val) => {
  if (val === undefined || val === null) return DEFAULT_TIMEOUT_MS;
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw errorWithCode('INVALID_ARGUMENT', `timeoutMs must be a positive integer`);
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
  'cookie', 'connection', 'content-length', 'content-type', 'host',
  'proxy-authorization', 'transfer-encoding',
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

// ─── Per-request TLS dispatchers (direct, non-proxy path) ───

const SECURE_DISPATCHER = new UndiciAgent({ connect: { rejectUnauthorized: true } });
const INSECURE_DISPATCHER = new UndiciAgent({ connect: { rejectUnauthorized: false } });

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

// Native http(s) fetch for proxied requests (socks5h) using socks-proxy-agent,
// returning a fetch-like response object compatible with readResponseText().
const proxiedFetch = (url, { method = 'POST', headers = {}, body } = {}, { proxyUrl, skipTlsVerify, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => new Promise((resolve, reject) => {
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

  req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error('timeout'), { name: 'TimeoutError', code: 'ETIMEDOUT' })));
  req.on('error', (err) => {
    if (err.name === 'TimeoutError' || err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') {
      reject(errorWithCode('DEADLINE_EXCEEDED', `request timed out after ${timeoutMs}ms`));
    } else {
      reject(errorWithCode('UNAVAILABLE', err.message || 'proxied request failed'));
    }
  });
  if (body !== undefined && body !== null) req.write(String(body));
  req.end();
});

// ─── JSON-RPC 调用 ───

const callCwppRpc = async (endpoint, rpcMethod, params, token, baseHeaders, timeoutMs, { proxyUrl = '', skipTlsVerify = false, dispatcher = SECURE_DISPATCHER } = {}) => {
  const url = `${endpoint}${RPC_PATH}`;
  const headers = {
    ...baseHeaders,
    'Content-Type': 'application/json',
  };
  if (token) headers['Cookie'] = `API-Token=${token}`;

  const body = {
    method: rpcMethod,
    params,
    jsonrpc: '2.0',
    id: '0',
  };
  const bodyText = JSON.stringify(body);

  let res;
  if (proxyUrl) {
    res = await proxiedFetch(url, { method: 'POST', headers, body: bodyText }, { proxyUrl, skipTlsVerify, timeoutMs });
  } else {
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: bodyText,
        signal: AbortSignal.timeout(timeoutMs),
        dispatcher,
        redirect: 'manual',
      });
    } catch (e) {
      if (e instanceof GrpcError) throw e;
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        throw errorWithCode('DEADLINE_EXCEEDED', `request timed out after ${timeoutMs}ms`);
      }
      throw errorWithCode('UNAVAILABLE', 'upstream request failed');
    }
  }

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
    if (rpcErr.code >= -32099 && rpcErr.code <= -32000) {
      throw errorWithCode('INTERNAL', msg);
    }
    // 牧云 code 1 = 鉴权失败（"API Token 已过期" / "需要登录"）
    if (rpcErr.code === 1) {
      throw errorWithCode('PERMISSION_DENIED', rpcErr.message || 'authentication failed');
    }
    throw errorWithCode('INTERNAL', msg);
  }

  return json.result;
};

// ─── 方法 handlers ───

export function rpcdef(ctx) {
  const bindings = mergedBindings(ctx);
  const endpoint = bindings.baseUrl || bindings.base_url || bindings.endpoint || bindings.restBaseUrl || bindings.rest_base_url || '';
  const timeoutMs = validateTimeoutMs(firstDefined(ctx.limits?.timeoutMs, bindings.timeoutMs));
  const baseHeaders = parseHeaders(bindings.headers);
  const meta = ctx.meta || {};

  const skipTlsVerify = toBoolean(firstDefined(bindings.skipTlsVerify, bindings.skip_tls_verify));
  const dispatcher = skipTlsVerify ? INSECURE_DISPATCHER : SECURE_DISPATCHER;
  const rawProxyUrl = String(firstNonEmpty(bindings.proxy_url, bindings.proxyUrl) ?? '').trim();
  // Only socks:// schemes are routable through SocksProxyAgent; a plain http(s)
  // URL (e.g. the smoke harness synthesizing the mock upstream) is not a proxy.
  const proxyUrl = /^socks(4a?|5h?)?:\/\//i.test(rawProxyUrl) ? rawProxyUrl : '';

  const getToken = () => {
    // 凭据只从 secret 取，不从 config/bindings/请求体取（OctoBus 约定）
    const token = firstNonEmpty(ctx.secret?.token, ctx.secret?.api_token, ctx.secret?.apiToken);
    return String(token || '').trim();
  };

  const logFlow = (action, details) => {
    const inst = meta.instance_id || meta.instanceId;
    const reqId = meta.request_id || meta.requestId;
    const trace = [];
    if (inst) trace.push(`inst=${inst}`);
    if (reqId) trace.push(`req=${reqId}`);
    const prefix = `[Chaitin_CloudWalker_CWPP][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
    try {
      console.log(prefix, JSON.stringify(details));
    } catch {
      console.log(prefix, details);
    }
  };

  const normalizedEndpoint = normalizeBaseUrl(endpoint);

  const requireReady = () => {
    if (!getToken()) throw errorWithCode('INVALID_ARGUMENT', 'token is required (configure via secret)');
    if (!normalizedEndpoint) throw errorWithCode('INVALID_ARGUMENT', 'baseUrl is required (http/https)');
  };

  const callListRealTimeEvents = async (req) => {
    requireReady();

    const params = {};
    const count = toPositiveInt(firstDefined(req?.count, req?.Count));
    if (count !== null) params.count = count;

    logFlow('ListRealTimeEvents:start', { count: params.count });

    const result = await callCwppRpc(
      normalizedEndpoint, 'ThreatOverviewService.ListRealTimeEvents', params,
      getToken(), baseHeaders, timeoutMs, { proxyUrl, skipTlsVerify, dispatcher },
    );

    const dataField = result?.data;
    const events = Array.isArray(dataField)
      ? dataField.map((e) => (e && typeof e === 'object' ? e : {}))
      : [];

    logFlow('ListRealTimeEvents:done', { count: events.length });

    return { err: toValue(null), msg: toValue(null), data: { events } };
  };

  const callGetHostAssetList = async (req) => {
    requireReady();

    const params = {};
    const count = toPositiveInt(firstDefined(req?.count, req?.Count));
    if (count !== null) params.count = count;
    const offset = toPositiveInt(firstDefined(req?.offset, req?.Offset));
    if (offset !== null) params.offset = offset;

    logFlow('GetHostAssetList:start', { count: params.count, offset: params.offset });

    const result = await callCwppRpc(
      normalizedEndpoint, 'HostAssetService.GetHostAssetList', params,
      getToken(), baseHeaders, timeoutMs, { proxyUrl, skipTlsVerify, dispatcher },
    );

    const hosts = Array.isArray(result?.result)
      ? result.result.map((h) => (h && typeof h === 'object' ? h : {}))
      : [];
    const total = toPositiveInt(result?.total) ?? hosts.length;

    logFlow('GetHostAssetList:done', { count: hosts.length, total });

    return { err: toValue(null), msg: toValue(null), data: { hosts, total } };
  };

  const callGetAgentGroupTree = async (req) => {
    requireReady();

    // 牧云文档：GetAgentGroupTree 无请求参数（请求示例为 {}）
    const params = {};

    logFlow('GetAgentGroupTree:start', {});

    const result = await callCwppRpc(
      normalizedEndpoint, 'AgentService.GetAgentGroupTree', params,
      getToken(), baseHeaders, timeoutMs, { proxyUrl, skipTlsVerify, dispatcher },
    );

    const nodes = Array.isArray(result?.nodes)
      ? result.nodes.map((n) => (n && typeof n === 'object' ? n : {}))
      : [];

    logFlow('GetAgentGroupTree:done', { count: nodes.length });

    return { err: toValue(null), msg: toValue(null), data: { nodes } };
  };

  return {
    [METHOD_LIST_REALTIME_EVENTS]: async () => callListRealTimeEvents(ctx.req),
    [METHOD_GET_HOST_ASSET_LIST]: async () => callGetHostAssetList(ctx.req),
    [METHOD_GET_AGENT_GROUP_TREE]: async () => callGetAgentGroupTree(ctx.req),
  };
}

// ─── OctoBus SDK 注册 ───

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
  [METHOD_LIST_REALTIME_EVENTS]: wrapLegacyHandler(ctx, METHOD_LIST_REALTIME_EVENTS),
  [METHOD_GET_HOST_ASSET_LIST]: wrapLegacyHandler(ctx, METHOD_GET_HOST_ASSET_LIST),
  [METHOD_GET_AGENT_GROUP_TREE]: wrapLegacyHandler(ctx, METHOD_GET_AGENT_GROUP_TREE),
});

const sdkHandlers = registerHandlers({});

export const METHOD_LIST_REALTIME_EVENTS_FULL = 'Chaitin_CloudWalker_CWPP.Chaitin_CloudWalker_CWPP/ListRealTimeEvents';
export const METHOD_GET_HOST_ASSET_LIST_FULL = 'Chaitin_CloudWalker_CWPP.Chaitin_CloudWalker_CWPP/GetHostAssetList';
export const METHOD_GET_AGENT_GROUP_TREE_FULL = 'Chaitin_CloudWalker_CWPP.Chaitin_CloudWalker_CWPP/GetAgentGroupTree';

export const handlers = {
  [METHOD_LIST_REALTIME_EVENTS_FULL]: (ctx) => sdkHandlers[METHOD_LIST_REALTIME_EVENTS](ctx),
  [METHOD_GET_HOST_ASSET_LIST_FULL]: (ctx) => sdkHandlers[METHOD_GET_HOST_ASSET_LIST](ctx),
  [METHOD_GET_AGENT_GROUP_TREE_FULL]: (ctx) => sdkHandlers[METHOD_GET_AGENT_GROUP_TREE](ctx),
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
  sanitizeHeaders,
  toBoolean,
  toPositiveInt,
  toValue,
  validateTimeoutMs,
  readResponseText,
  mergeCtx,
  SECURE_DISPATCHER,
  INSECURE_DISPATCHER,
};
