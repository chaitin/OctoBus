// ThreatBook_HFISH HFish Honeypot Proxy
// Bindings: endpoint (required), headers (optional), timeoutMs (optional)
// API key: secret.apiKey

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const DEFAULT_TIMEOUT_MS = 1500;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

const LIST_ATTACK_IPS_PATH = '/ThreatBook_HFISH.ThreatBook_HFISH/ListAttackIPs';
const LIST_ATTACK_DETAILS_PATH = '/ThreatBook_HFISH.ThreatBook_HFISH/ListAttackDetails';
const LIST_ATTACK_ACCOUNTS_PATH = '/ThreatBook_HFISH.ThreatBook_HFISH/ListAttackAccounts';
const GET_SYSTEM_INFO_PATH = '/ThreatBook_HFISH.ThreatBook_HFISH/GetSystemInfo';

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
  return n > 0 ? n : null;
};

const pickStringField = (req, keys) => {
  for (const key of keys) {
    if (hasOwn(req, key)) {
      return String(req[key]);
    }
  }
  return undefined;
};

const extractApiKey = (req, bindings) => {
  // Prefer bindings (secret/config) over request, because gRPC proto
  // string fields default to "" which firstDefined treats as defined,
  // shadowing the real secret value from bindings.
  const key = firstDefined(bindings?.apiKey, bindings?.api_key, req?.api_key, req?.apiKey);
  if (!key) return null;
  return String(key).trim();
};

export function rpcdef(ctx) {
  const bindings = mergedBindings(ctx);
  const restBaseUrl = bindings.endpoint || bindings.restBaseUrl || bindings.baseUrl || '';
  const timeoutMs = ctx.limits?.timeoutMs || DEFAULT_TIMEOUT_MS;
  const baseHeaders = parseHeaders(bindings.headers);
  const meta = ctx.meta || {};
  const skipTlsVerify = Boolean(bindings.tlsInsecureSkipVerify || bindings.skipTlsVerify || bindings.skip_tls_verify || bindings.tls_insecure_skip_verify);

  // TLS skip must be configured at the process level (e.g. OctoBus daemon sets
  // NODE_TLS_REJECT_UNAUTHORIZED=0 before spawning the subprocess), NOT by
  // mutating process.env inside rpcdef. Mutating process.env is a global,
  // irreversible side effect that disables TLS verification for the entire
  // Node.js process — affecting all services, handlers, and even third-party
  // library HTTPS calls. If different instances have different skipTlsVerify
  // configs, one instance's skip would break another's security.
  // The insecureSkipVerify/tlsInsecureSkipVerify fetch options below are kept
  // as OctoBus runtime conventions; the daemon may intercept them or set the
  // env var externally before process start.
  if (skipTlsVerify && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0') {
    const inst = meta.instance_id || meta.instanceId || 'unknown';
    console.warn(
      `[ThreatBook_HFISH][TLS] skipTlsVerify=true but NODE_TLS_REJECT_UNAUTHORIZED is not set. ` +
      `TLS certificate verification will NOT be skipped. ` +
      `Set NODE_TLS_REJECT_UNAUTHORIZED=0 at process startup (e.g. via OctoBus daemon config) or export it before running. ` +
      `[inst=${inst}]`,
    );
  }

  const logFlow = (action, details) => {
    const inst = meta.instance_id || meta.instanceId;
    const reqId = meta.request_id || meta.requestId;
    const trace = [];
    if (inst) trace.push(`inst=${inst}`);
    if (reqId) trace.push(`req=${reqId}`);
    const prefix = `[ThreatBook_HFISH][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
    try {
      console.log(prefix, JSON.stringify(details));
    } catch {
      console.log(prefix, details);
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

  const readJsonResponse = async (res, emptyValue) => {
    const text = await res.text();
    if (!res.ok) {
      throwForHttpError(res.status, text);
    }
    if (!text.trim()) {
      return emptyValue;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw errorWithCode('UNKNOWN', 'response is not valid JSON');
    }
  };

  const tlsOptions = () => (skipTlsVerify
    ? {
        insecureSkipVerify: true,
        tlsInsecureSkipVerify: true,
      }
    : {});

  const fetchHfish = async (url, init) => {
    try {
      return await fetch(url, {
        ...init,
        ...tlsOptions(),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
      const reason = isTimeout ? 'timeout after ' + timeoutMs + 'ms' : (e?.cause?.message || e?.message || 'fetch failed');
      throw errorWithCode('UNAVAILABLE', reason);
    }
  };

  const buildApiKeyUrl = (baseUrl, path, apiKey, extraParams = {}) => {
    const url = new URL(path, baseUrl);
    url.searchParams.set('api_key', apiKey);
    for (const [k, v] of Object.entries(extraParams)) {
      if (v !== undefined && v !== null) {
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  };

  const callListAttackIPs = async (req) => {
    const apiKey = extractApiKey(req, bindings);
    if (!apiKey) {
      throw errorWithCode('INVALID_ARGUMENT', 'api_key is required');
    }
    const baseUrl = normalizeBaseUrl(restBaseUrl);
    if (!baseUrl) {
      throw errorWithCode('INVALID_ARGUMENT', 'endpoint is required (http/https)');
    }

    const page = toPositiveInt(firstDefined(req?.page, req?.Page)) || DEFAULT_PAGE;
    const limit = toPositiveInt(firstDefined(req?.limit, req?.Limit)) || DEFAULT_LIMIT;

    const url = buildApiKeyUrl(baseUrl, '/api/v1/attack/ip', apiKey, { page, limit });
    logFlow('ListAttackIPs:start', { baseUrl, page, limit });

    const res = await fetchHfish(url, { method: 'POST', headers: { ...baseHeaders, 'content-type': 'application/json' }, body: '{}' });
    const json = await readJsonResponse(res, {});

    if (json.response_code !== undefined && json.response_code !== 0) {
      const msg = json.verbose_msg || `HFish API error: code ${json.response_code}`;
      if (json.response_code === 1003) {
        throw errorWithCode('PERMISSION_DENIED', msg);
      }
      throw errorWithCode('FAILED_PRECONDITION', msg);
    }

    const data = json.data || {};
    const attackIpList = Array.isArray(data.attack_ip) ? data.attack_ip : [];

    const records = attackIpList.map((item) => ({
      ip: item?.ip ?? '',
      attack_count: item?.attack_count ?? 0,
      first_attack_time: item?.first_attack_time ?? '',
      last_attack_time: item?.last_attack_time ?? '',
      attack_types: Array.isArray(item?.attack_types) ? item.attack_types : [],
      country: item?.country ?? '',
      province: item?.province ?? '',
      city: item?.city ?? '',
      group: item?.group ?? item?.group_name ?? '',
      comment: item?.comment ?? '',
      attack_chain_count: item?.attack_chain_count ?? 0,
      port_count: item?.port_count ?? 0,
      related_info_count: item?.related_info_count ?? 0,
    }));

    logFlow('ListAttackIPs:done', { count: records.length });
    return { response_code: json.response_code, verbose_msg: json.verbose_msg || '', data: { attack_ip: records } };
  };

  const callListAttackDetails = async (req) => {
    const apiKey = extractApiKey(req, bindings);
    if (!apiKey) {
      throw errorWithCode('INVALID_ARGUMENT', 'api_key is required');
    }
    const baseUrl = normalizeBaseUrl(restBaseUrl);
    if (!baseUrl) {
      throw errorWithCode('INVALID_ARGUMENT', 'endpoint is required (http/https)');
    }

    const page = toPositiveInt(firstDefined(req?.page, req?.Page)) || DEFAULT_PAGE;
    const limit = toPositiveInt(firstDefined(req?.limit, req?.Limit)) || DEFAULT_LIMIT;

    const url = buildApiKeyUrl(baseUrl, '/api/v1/attack/detail', apiKey, { page, limit });
    logFlow('ListAttackDetails:start', { baseUrl, page, limit });

    const res = await fetchHfish(url, { method: 'POST', headers: { ...baseHeaders, 'content-type': 'application/json' }, body: '{}' });
    const json = await readJsonResponse(res, {});

    if (json.response_code !== undefined && json.response_code !== 0) {
      const msg = json.verbose_msg || `HFish API error: code ${json.response_code}`;
      if (json.response_code === 1003) {
        throw errorWithCode('PERMISSION_DENIED', msg);
      }
      throw errorWithCode('FAILED_PRECONDITION', msg);
    }

    const data = json.data || {};
    const detailList = Array.isArray(data.detail_list) ? data.detail_list : [];

    const records = detailList.map((item) => ({
      id: item?.id ?? 0,
      src_ip: item?.src_ip ?? item?.source_ip ?? '',
      src_port: item?.src_port ?? '',
      dest_ip: item?.dest_ip ?? item?.dst_ip ?? '',
      dest_port: item?.dest_port ?? item?.dst_port ?? '',
      protocol: item?.protocol ?? '',
      type: item?.type ?? '',
      app_name: item?.app_name ?? item?.name ?? '',
      client_name: item?.client_name ?? '',
      raw_data: item?.raw_data ?? item?.info ?? '',
      country: item?.country ?? '',
      province: item?.province ?? '',
      city: item?.city ?? '',
      create_time: item?.create_time ?? item?.time ?? '',
      attack_chain: item?.attack_chain ?? '',
      crawl_info: item?.crawl_info ?? '',
      user_info: item?.user_info ?? '',
    }));

    logFlow('ListAttackDetails:done', { total: data.total_num || 0, count: records.length });
    return {
      response_code: json.response_code,
      verbose_msg: json.verbose_msg || '',
      data: {
        total_num: data.total_num || 0,
        page_no: data.page_no || page,
        page_size: data.page_size || limit,
        total_page: data.total_page || 0,
        detail_list: records,
      },
    };
  };

  const callListAttackAccounts = async (req) => {
    const apiKey = extractApiKey(req, bindings);
    if (!apiKey) {
      throw errorWithCode('INVALID_ARGUMENT', 'api_key is required');
    }
    const baseUrl = normalizeBaseUrl(restBaseUrl);
    if (!baseUrl) {
      throw errorWithCode('INVALID_ARGUMENT', 'endpoint is required (http/https)');
    }

    const page = toPositiveInt(firstDefined(req?.page, req?.Page)) || DEFAULT_PAGE;
    const limit = toPositiveInt(firstDefined(req?.limit, req?.Limit)) || DEFAULT_LIMIT;

    const url = buildApiKeyUrl(baseUrl, '/api/v1/attack/account', apiKey, { page, limit });
    logFlow('ListAttackAccounts:start', { baseUrl, page, limit });

    const res = await fetchHfish(url, { method: 'POST', headers: { ...baseHeaders, 'content-type': 'application/json' }, body: '{}' });
    const json = await readJsonResponse(res, {});

    if (json.response_code !== undefined && json.response_code !== 0) {
      const msg = json.verbose_msg || `HFish API error: code ${json.response_code}`;
      if (json.response_code === 1003) {
        throw errorWithCode('PERMISSION_DENIED', msg);
      }
      throw errorWithCode('FAILED_PRECONDITION', msg);
    }

    const data = Array.isArray(json.data) ? json.data : [];

    const records = data.map((item) => ({
      id: item?.id ?? 0,
      ip: item?.ip ?? '',
      account: item?.account ?? item?.username ?? '',
      password: item?.password ?? item?.passwd ?? '',
      type: item?.type ?? '',
      create_time: item?.create_time ?? '',
    }));

    logFlow('ListAttackAccounts:done', { count: records.length });
    return { response_code: json.response_code, verbose_msg: json.verbose_msg || '', data: records };
  };

  const callGetSystemInfo = async (req) => {
    const apiKey = extractApiKey(req, bindings);
    if (!apiKey) {
      throw errorWithCode('INVALID_ARGUMENT', 'api_key is required');
    }
    const baseUrl = normalizeBaseUrl(restBaseUrl);
    if (!baseUrl) {
      throw errorWithCode('INVALID_ARGUMENT', 'endpoint is required (http/https)');
    }

    const url = buildApiKeyUrl(baseUrl, '/api/v1/hfish/sys_info', apiKey);
    logFlow('GetSystemInfo:start', { baseUrl });

    const res = await fetchHfish(url, { method: 'GET', headers: baseHeaders });
    const json = await readJsonResponse(res, {});

    if (json.response_code !== undefined && json.response_code !== 0) {
      const msg = json.verbose_msg || `HFish API error: code ${json.response_code}`;
      if (json.response_code === 1003) {
        throw errorWithCode('PERMISSION_DENIED', msg);
      }
      throw errorWithCode('FAILED_PRECONDITION', msg);
    }

    const data = json.data || {};
    const honeypotSelfCnt = data.honeypot_self_cnt && typeof data.honeypot_self_cnt === 'object'
      ? Object.fromEntries(
          Object.entries(data.honeypot_self_cnt).map(([k, v]) => [k, Number(v) || 0])
        )
      : {};
    const clients = Array.isArray(data.clients) ? data.clients.map((c) => ({
      name: c?.name ?? '',
      ip: c?.ip ?? '',
      create_time: c?.create_time ?? 0,
      honeypots: Array.isArray(c?.honeypots) ? c.honeypots.map((h) => ({
        type: h?.type ?? '',
        name: h?.name ?? '',
        state: h?.state ?? 0,
      })) : [],
    })) : [];

    logFlow('GetSystemInfo:done', { total_honeypots: data.total_honeypots || 0 });
    return {
      response_code: json.response_code,
      verbose_msg: json.verbose_msg || '',
      data: {
        total_honeypots: data.total_honeypots || 0,
        total_cardinal_honeypots: data.total_cardinal_honeypots || 0,
        total_online_honeypots: data.total_online_honeypots || 0,
        total_offline_honeypots: data.total_offline_honeypots || 0,
        honeypot_self_cnt: honeypotSelfCnt,
        clients,
      },
    };
  };

  return {
    [LIST_ATTACK_IPS_PATH]: async () => callListAttackIPs({ ...(ctx.req || {}) }),
    [LIST_ATTACK_DETAILS_PATH]: async () => callListAttackDetails({ ...(ctx.req || {}) }),
    [LIST_ATTACK_ACCOUNTS_PATH]: async () => callListAttackAccounts({ ...(ctx.req || {}) }),
    [GET_SYSTEM_INFO_PATH]: async () => callGetSystemInfo({ ...(ctx.req || {}) }),
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
  [LIST_ATTACK_IPS_PATH]: wrapLegacyHandler(ctx, LIST_ATTACK_IPS_PATH),
  [LIST_ATTACK_DETAILS_PATH]: wrapLegacyHandler(ctx, LIST_ATTACK_DETAILS_PATH),
  [LIST_ATTACK_ACCOUNTS_PATH]: wrapLegacyHandler(ctx, LIST_ATTACK_ACCOUNTS_PATH),
  [GET_SYSTEM_INFO_PATH]: wrapLegacyHandler(ctx, GET_SYSTEM_INFO_PATH),
});

export const METHOD_LIST_ATTACK_IPS_FULL = 'ThreatBook_HFISH.ThreatBook_HFISH/ListAttackIPs';
export const METHOD_LIST_ATTACK_DETAILS_FULL = 'ThreatBook_HFISH.ThreatBook_HFISH/ListAttackDetails';
export const METHOD_LIST_ATTACK_ACCOUNTS_FULL = 'ThreatBook_HFISH.ThreatBook_HFISH/ListAttackAccounts';
export const METHOD_GET_SYSTEM_INFO_FULL = 'ThreatBook_HFISH.ThreatBook_HFISH/GetSystemInfo';

const sdkHandlers = registerHandlers({});

export const handlers = {
  [METHOD_LIST_ATTACK_IPS_FULL]: (ctx) => sdkHandlers[LIST_ATTACK_IPS_PATH](ctx),
  [METHOD_LIST_ATTACK_DETAILS_FULL]: (ctx) => sdkHandlers[LIST_ATTACK_DETAILS_PATH](ctx),
  [METHOD_LIST_ATTACK_ACCOUNTS_FULL]: (ctx) => sdkHandlers[LIST_ATTACK_ACCOUNTS_PATH](ctx),
  [METHOD_GET_SYSTEM_INFO_FULL]: (ctx) => sdkHandlers[GET_SYSTEM_INFO_PATH](ctx),
};

export const _test = {
  errorWithCode,
  extractApiKey,
  firstDefined,
  hasOwn,
  mergedBindings,
  normalizeBaseUrl,
  parseHeaders,
  registerHandlers,
  resolveCallContext,
  toPositiveInt,
};
