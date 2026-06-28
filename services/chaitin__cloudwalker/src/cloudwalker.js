import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const DEFAULT_TIMEOUT_MS = 15000;
const SERVICE_NAME = 'Chaitin_CloudWalker';
const dispatcherPromises = new Map();

export const METHOD_GET_CURRENT_TIME_FULL = `${SERVICE_NAME}.${SERVICE_NAME}/GetCurrentTime`;
export const METHOD_LIST_HOSTS_FULL = `${SERVICE_NAME}.${SERVICE_NAME}/ListHosts`;
export const METHOD_GET_HOST_DETAIL_FULL = `${SERVICE_NAME}.${SERVICE_NAME}/GetHostDetail`;
export const METHOD_LIST_MALWARE_EVENTS_FULL = `${SERVICE_NAME}.${SERVICE_NAME}/ListMalwareEvents`;
export const METHOD_LIST_BRUTE_FORCE_EVENTS_FULL = `${SERVICE_NAME}.${SERVICE_NAME}/ListBruteForceEvents`;
export const METHOD_LIST_WEBSHELL_EVENTS_FULL = `${SERVICE_NAME}.${SERVICE_NAME}/ListWebshellEvents`;
export const METHOD_LIST_REVSHELL_EVENTS_FULL = `${SERVICE_NAME}.${SERVICE_NAME}/ListRevshellEvents`;
export const METHOD_LIST_ABNORMAL_LOGIN_EVENTS_FULL = `${SERVICE_NAME}.${SERVICE_NAME}/ListAbnormalLoginEvents`;
export const METHOD_LIST_REAL_TIME_THREAT_EVENTS_FULL = `${SERVICE_NAME}.${SERVICE_NAME}/ListRealTimeThreatEvents`;

const RPC_METHODS = {
  [METHOD_GET_CURRENT_TIME_FULL]: {
    method: 'CloudwalkerSettingService.GetCurrentTime',
    buildParams: () => ({}),
  },
  [METHOD_LIST_HOSTS_FULL]: {
    method: 'HostAssetService.GetHostAssetList',
    buildParams: buildListParams,
  },
  [METHOD_GET_HOST_DETAIL_FULL]: {
    method: 'HostAssetService.GetHostInfoDetail',
    buildParams: buildHostDetailParams,
  },
  [METHOD_LIST_MALWARE_EVENTS_FULL]: {
    method: 'MalwareEventService.GetEventList',
    buildParams: buildListParams,
  },
  [METHOD_LIST_BRUTE_FORCE_EVENTS_FULL]: {
    method: 'BruteForceService.GetEventList',
    buildParams: buildListParams,
  },
  [METHOD_LIST_WEBSHELL_EVENTS_FULL]: {
    method: 'WebshellEventService.GetEventList',
    buildParams: buildListParams,
  },
  [METHOD_LIST_REVSHELL_EVENTS_FULL]: {
    method: 'RevshellEventService.GetEventList',
    buildParams: buildListParams,
  },
  [METHOD_LIST_ABNORMAL_LOGIN_EVENTS_FULL]: {
    method: 'AbnormalLoginEventService.GetEventList',
    buildParams: buildListParams,
  },
  [METHOD_LIST_REAL_TIME_THREAT_EVENTS_FULL]: {
    method: 'ThreatOverviewService.ListRealTimeEvents',
    buildParams: buildRealTimeThreatParams,
  },
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  DEADLINE_EXCEEDED: grpcStatus.DEADLINE_EXCEEDED,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const mergedBindings = (ctx = {}) => ({
  ...(ctx.config ?? {}),
  ...(ctx.secret ?? {}),
  ...(ctx.bindings ?? {}),
});

const unwrapValue = (source) => {
  if (source && typeof source === 'object' && hasOwn(source, 'value')) return source.value;
  return source;
};

const normalizeEndpoint = (value) => {
  const endpoint = String(value || '').trim();
  if (!/^https?:\/\//i.test(endpoint)) return null;
  return endpoint.replace(/\/+$/, '');
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

const toPositiveInteger = (value, field) => {
  const raw = unwrapValue(value);
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = Number(raw);
  if (!Number.isInteger(num) || num <= 0) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} must be a positive integer`);
  }
  return num;
};

const toNonNegativeInteger = (value, field) => {
  const raw = unwrapValue(value);
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = Number(raw);
  if (!Number.isInteger(num) || num < 0) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} must be a non-negative integer`);
  }
  return num;
};

function buildListParams(req = {}) {
  const params = {};
  const count = toPositiveInteger(req.count ?? req.limit ?? req.page_size ?? req.pageSize, 'count');
  const offset = toNonNegativeInteger(req.offset, 'offset');

  if (count !== undefined) params.count = count;
  if (offset !== undefined) params.offset = offset;
  if (req.filters && typeof req.filters === 'object') Object.assign(params, req.filters);
  if (req.order_by && typeof req.order_by === 'object') params.order_by = req.order_by;
  if (req.orderBy && typeof req.orderBy === 'object') params.order_by = req.orderBy;

  return params;
}

function buildHostDetailParams(req = {}) {
  const id = toPositiveInteger(req.id ?? req.host_id ?? req.hostId, 'id');
  if (id === undefined) throw errorWithCode('INVALID_ARGUMENT', 'id is required');
  return { id };
}

function buildRealTimeThreatParams(req = {}) {
  const params = buildListParams(req);
  if (params.count === undefined) params.count = 100;
  return params;
}

const buildRequestId = (ctx = {}, method) =>
  firstDefined(ctx.meta?.request_id, ctx.meta?.requestId, ctx.req?.id, `${method}:${Date.now()}`);

const normalizeCallContext = (baseCtx = {}, input = {}) => {
  if (input && typeof input === 'object' && hasOwn(input, 'request')) {
    return {
      ...baseCtx,
      ...input,
      req: input.request ?? {},
      meta: {
        ...(baseCtx.meta ?? {}),
        request_id: input.metadata?.get?.('x-request-id')?.[0],
      },
      config: {
        ...(baseCtx.config ?? {}),
        ...(input.config ?? {}),
      },
      secret: {
        ...(baseCtx.secret ?? {}),
        ...(input.secret ?? {}),
      },
    };
  }

  return {
    ...baseCtx,
    req: {
      ...(baseCtx.req ?? {}),
      ...(input ?? {}),
    },
  };
};

const buildHeaders = (bindings) => {
  const token = firstDefined(bindings.apiToken, bindings.api_token, bindings.token, bindings.API_TOKEN);
  if (!token) throw errorWithCode('UNAUTHENTICATED', 'apiToken is required');

  const headers = {
    ...parseHeaders(bindings.headers),
    'Content-Type': 'application/json',
    Cookie: `API-Token=${token}`,
  };

  const orgId = firstDefined(bindings.orgId, bindings.org_id, bindings.oid, bindings.organizationId);
  if (orgId !== undefined && orgId !== null && orgId !== '') {
    headers['X-CW-OID'] = String(orgId);
  }

  return headers;
};

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithCode('FAILED_PRECONDITION', 'CloudWalker response is not valid JSON');
  }
};

async function callJsonRpc(ctx, rpcMethod, params) {
  const bindings = mergedBindings(ctx);
  const endpoint = normalizeEndpoint(firstDefined(
    bindings.endpoint,
    bindings.baseUrl,
    bindings.base_url,
    bindings.host,
    bindings.restBaseUrl,
    bindings.rest_base_url,
  ));
  if (!endpoint) throw errorWithCode('FAILED_PRECONDITION', 'endpoint must be an http(s) URL');

  const timeoutMs = Number(ctx.limits?.timeoutMs || bindings.timeoutMs || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const body = {
    jsonrpc: '2.0',
    method: rpcMethod,
    params,
    id: buildRequestId(ctx, rpcMethod),
  };

  try {
    const response = await fetchUpstream(`${endpoint}/rpc`, {
      method: 'POST',
      headers: buildHeaders(bindings),
      body: JSON.stringify(body),
      signal: controller.signal,
    }, bindings);
    const rawBody = await response.text();

    if (!response.ok) {
      throw errorWithCode('UNAVAILABLE', `CloudWalker HTTP ${response.status}: ${rawBody}`);
    }

    const json = parseJson(rawBody);
    if (json?.error) {
      const message = json.error.message || JSON.stringify(json.error);
      throw errorWithCode('UNKNOWN', `CloudWalker JSON-RPC error ${json.error.code ?? ''}: ${message}`);
    }

    return {
      http_status: response.status,
      raw_body: rawBody,
      result: json?.result ?? {},
    };
  } catch (err) {
    if (err instanceof GrpcError) throw err;
    if (err?.name === 'AbortError') {
      throw errorWithCode('DEADLINE_EXCEEDED', `CloudWalker request timed out after ${timeoutMs}ms`);
    }
    const cause = err?.cause?.message || err?.message || 'CloudWalker request failed';
    throw errorWithCode('UNAVAILABLE', cause);
  } finally {
    clearTimeout(timer);
  }
}

const shouldSkipTlsVerify = (bindings = {}) => Boolean(
  bindings.skipTlsVerify ||
  bindings.skip_tls_verify ||
  bindings.tlsInsecureSkipVerify ||
  bindings.tls_insecure_skip_verify ||
  bindings.insecureSkipVerify,
);

const resolveProxyUrl = (bindings = {}) => {
  const proxyUrl = firstDefined(bindings.proxyUrl, bindings.proxy_url, bindings.httpsProxy, bindings.https_proxy);
  return typeof proxyUrl === 'string' && proxyUrl.trim() ? proxyUrl.trim() : '';
};

const getDispatcher = async (proxyUrl, skipTlsVerify) => {
  const key = `${proxyUrl || '-'}|${skipTlsVerify ? 'insecure' : 'secure'}`;
  if (!dispatcherPromises.has(key)) {
    dispatcherPromises.set(key, (async () => {
      const { Agent, ProxyAgent } = await import('undici');
      if (proxyUrl) {
        return new ProxyAgent({
          uri: proxyUrl,
          ...(skipTlsVerify ? { requestTls: { rejectUnauthorized: false } } : {}),
        });
      }
      return new Agent({
        connect: {
          rejectUnauthorized: !skipTlsVerify,
        },
      });
    })());
  }
  return dispatcherPromises.get(key);
};

const fetchUpstream = async (url, init, bindings) => {
  const skipTlsVerify = shouldSkipTlsVerify(bindings);
  const proxyUrl = resolveProxyUrl(bindings);
  if (!skipTlsVerify && !proxyUrl) return globalThis.fetch(url, init);

  const { fetch } = await import('undici');
  return fetch(url, {
    ...init,
    dispatcher: await getDispatcher(proxyUrl, skipTlsVerify),
  });
};

export function rpcdef(ctx) {
  return Object.fromEntries(Object.entries(RPC_METHODS).map(([fullName, def]) => [
    fullName,
    async (input = {}) => {
      const callCtx = normalizeCallContext(ctx, input);
      return callJsonRpc(callCtx, def.method, def.buildParams(callCtx.req));
    },
  ]));
}

export const handlers = rpcdef({});

export const _test = {
  buildHostDetailParams,
  buildListParams,
  buildRealTimeThreatParams,
  errorWithCode,
  grpcCodeFor,
  mergedBindings,
  normalizeEndpoint,
  parseHeaders,
  resolveProxyUrl,
  normalizeCallContext,
  shouldSkipTlsVerify,
  unwrapValue,
};
