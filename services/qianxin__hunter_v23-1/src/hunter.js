// QiAnXin Hunter network space search engine proxy
// API: GET https://hunter.qianxin.com/openApi/search
// Auth: api-key query parameter

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

const DEFAULT_BASE_URL = 'https://hunter.qianxin.com';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_PAGE_SIZE = 10;
const VALID_PAGE_SIZES = [10, 50, 100];
const SEARCH_PATH = '/qianxin.hunter.v1.HunterService/Search';

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
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

// ---- helpers ----

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const firstDefined = (...vals) => vals.find((v) => v !== undefined && v !== null);

const unwrapInt32 = (val) => {
  if (val === undefined || val === null) return null;
  if (typeof val === 'object' && hasOwn(val, 'value')) return unwrapInt32(val.value);
  const n = Number(val);
  if (!Number.isInteger(n) || Number.isNaN(n)) return null;
  return n;
};

const unwrapString = (val) => {
  if (val === undefined || val === null) return '';
  if (typeof val === 'object' && hasOwn(val, 'value')) return String(val.value ?? '');
  return String(val);
};

const normalizeBaseUrl = (url) => {
  const base = String(url || '').trim();
  if (!/^https?:\/\//i.test(base)) return null;
  return base.replace(/\/$/, '');
};

const normalizeTimeout = (value) => {
  const raw = value && typeof value === 'object' && hasOwn(value, 'value') ? value.value : value;
  const timeout = Number(raw);
  return Number.isFinite(timeout) && timeout > 0 ? Math.trunc(timeout) : DEFAULT_TIMEOUT_MS;
};

let insecureTlsDispatcher;

const getInsecureTlsDispatcher = () => {
  insecureTlsDispatcher ??= new Agent({ connect: { rejectUnauthorized: false } });
  return insecureTlsDispatcher;
};

// ---- result mapping ----

const mapSearchResult = (item) => ({
  ip: String(item?.ip ?? ''),
  port: Number(item?.port ?? 0) || 0,
  domain: String(item?.domain ?? ''),
  url: String(item?.url ?? ''),
  web_title: String(item?.web_title ?? ''),
  protocol: String(item?.protocol ?? ''),
  status_code: Number(item?.status_code ?? 0) || 0,
  os: String(item?.os ?? ''),
  company: String(item?.company ?? ''),
  country: String(item?.country ?? ''),
  province: String(item?.province ?? ''),
  city: String(item?.city ?? ''),
  isp: String(item?.isp ?? ''),
  as_org: String(item?.as_org ?? ''),
  cert_sha256: String(item?.cert_sha256 ?? ''),
  component: String(item?.component ?? ''),
  header: String(item?.header ?? ''),
  banner: String(item?.banner ?? ''),
  updated_at: String(item?.updated_at ?? ''),
  raw_json: '',
});

// ---- RPC definition ----

export function rpcdef(ctx) {
  const bindings = { ...(ctx?.bindings ?? {}), ...(ctx?.config ?? {}), ...(ctx?.secret ?? {}) };
  const baseUrl = bindings.baseUrl || bindings.base_url || DEFAULT_BASE_URL;
  const timeoutMs = normalizeTimeout(firstDefined(bindings.timeoutMs, bindings.timeout_ms, ctx?.limits?.timeoutMs, DEFAULT_TIMEOUT_MS));
  const defaultPageSize = bindings.defaultPageSize || DEFAULT_PAGE_SIZE;
  const skipTlsVerify = Boolean(
    bindings.skipTlsVerify
      || bindings.skip_tls_verify
      || bindings.tlsInsecureSkipVerify
      || bindings.tls_insecure_skip_verify
      || bindings.insecureSkipVerify,
  );
  const meta = ctx?.meta || {};

  const tlsOptions = skipTlsVerify ? { dispatcher: getInsecureTlsDispatcher() } : {};

  const logFlow = (action, details) => {
    const inst = meta.instance_id || meta.instanceId;
    const reqId = meta.request_id || meta.requestId;
    const trace = [];
    if (inst) trace.push(`inst=${inst}`);
    if (reqId) trace.push(`req=${reqId}`);
    const prefix = `[qianxin.hunter][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
    try {
      console.log(prefix, JSON.stringify(details));
    } catch {
      console.log(prefix, details);
    }
  };

  const callSearch = async (req) => {
    // --- validate query ---
    const query = unwrapString(firstDefined(req?.query, req?.Query));
    if (!query.trim()) {
      throw errorWithCode('INVALID_ARGUMENT', 'query is required');
    }

    // --- api key ---
    const apiKey = firstDefined(bindings.apiKey, bindings.api_key);
    if (!apiKey || !String(apiKey).trim()) {
      throw errorWithCode('INVALID_ARGUMENT', 'apiKey is required in secret');
    }

    // --- page ---
    const rawPage = firstDefined(req?.page, req?.Page);
    const pageNum = rawPage === undefined || rawPage === null ? 1 : unwrapInt32(rawPage);
    if (pageNum === null || pageNum < 1) {
      throw errorWithCode('INVALID_ARGUMENT', 'page must be an integer >= 1');
    }

    // --- page_size ---
    const rawPageSize = firstDefined(req?.page_size, req?.pageSize, req?.PageSize);
    const pageSizeNum = rawPageSize === undefined || rawPageSize === null
      ? defaultPageSize
      : unwrapInt32(rawPageSize);
    if (pageSizeNum === null || !VALID_PAGE_SIZES.includes(pageSizeNum)) {
      throw errorWithCode('INVALID_ARGUMENT', `page_size must be one of: ${VALID_PAGE_SIZES.join(', ')}`);
    }

    // --- is_web ---
    const rawIsWeb = firstDefined(req?.is_web, req?.isWeb, req?.IsWeb);
    const isWebNum = rawIsWeb === undefined || rawIsWeb === null ? null : unwrapInt32(rawIsWeb);
    if (isWebNum !== null && ![1, 2, 3].includes(isWebNum)) {
      throw errorWithCode('INVALID_ARGUMENT', 'is_web must be 1 (web), 2 (non-web), or 3 (all)');
    }

    // --- status_code ---
    const statusCode = unwrapString(firstDefined(req?.status_code, req?.statusCode, req?.StatusCode));

    // --- fields ---
    const fields = unwrapString(firstDefined(req?.fields, req?.Fields));

    // --- start_time / end_time ---
    const startTime = unwrapString(firstDefined(req?.start_time, req?.startTime, req?.StartTime));
    const endTime = unwrapString(firstDefined(req?.end_time, req?.endTime, req?.EndTime));

    // --- build URL ---
    const normalizedBase = normalizeBaseUrl(baseUrl);
    if (!normalizedBase) {
      throw errorWithCode('INVALID_ARGUMENT', 'baseUrl must be a valid http/https URL');
    }

    const params = new URLSearchParams();
    params.set('api-key', String(apiKey));
    params.set('search', Buffer.from(query.trim()).toString('base64url'));
    params.set('page', String(pageNum));
    params.set('page_size', String(pageSizeNum));
    if (isWebNum !== null) params.set('is_web', String(isWebNum));
    if (statusCode) params.set('status_code', statusCode);
    if (fields) params.set('fields', fields);
    if (startTime) params.set('start_time', startTime);
    if (endTime) params.set('end_time', endTime);

    const url = `${normalizedBase}/openApi/search?${params.toString()}`;

    logFlow('Search:request', { query: query.trim(), page: pageNum, page_size: pageSizeNum });

    // --- HTTP request ---
    let res;
    try {
      res = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(timeoutMs),
        ...tlsOptions,
      });
    } catch (e) {
      const reason = e?.cause?.message || e?.message || 'fetch failed';
      throw errorWithCode('UNAVAILABLE', reason);
    }

    // --- read response ---
    let text;
    try {
      text = await res.text();
    } catch (e) {
      throw errorWithCode('UNAVAILABLE', `failed to read response: ${e?.message || e}`);
    }

    // --- HTTP error mapping ---
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw errorWithCode(res.status === 401 ? 'UNAUTHENTICATED' : 'PERMISSION_DENIED', `upstream http ${res.status}: ${text}`);
      }
      if (res.status >= 500) {
        throw errorWithCode('UNAVAILABLE', `upstream http ${res.status}: ${text}`);
      }
      throw errorWithCode('INVALID_ARGUMENT', `upstream http ${res.status}: ${text}`);
    }

    // --- parse JSON ---
    let json;
    try {
      json = text.trim() ? JSON.parse(text) : {};
    } catch {
      throw errorWithCode('UNKNOWN', 'upstream response is not valid JSON');
    }

    // Hunter API response format:
    // { code: 200, message: "ok", data: { list: [...], total: N, page: P, page_size: S, total_pages: TP } }
    if (json.code && json.code !== 200) {
      return {
        results: [],
        total: 0,
        page: pageNum,
        page_size: pageSizeNum,
        total_pages: 0,
        extra_credits_consumed: false,
        error: String(json.message || `upstream error code: ${json.code}`),
      };
    }

    const data = json?.data && typeof json.data === 'object' ? json.data : {};
    const rawList = Array.isArray(data?.list) ? data.list
      : Array.isArray(data?.arr) ? data.arr
      : Array.isArray(json?.list) ? json.list
      : Array.isArray(json) ? json
      : [];

    const results = rawList.map(mapSearchResult);
    const total = Number(data?.total ?? results.length) || results.length;

    logFlow('Search:done', { total, returned: results.length, query: query.trim() });

    return {
      results,
      total,
      page: Number(data?.page ?? pageNum) || pageNum,
      page_size: Number(data?.page_size ?? pageSizeNum) || pageSizeNum,
      total_pages: Number(data?.total_pages ?? Math.ceil(total / pageSizeNum)) || 0,
      extra_credits_consumed: Boolean(data?.extra_credits_consumed || false),
      error: '',
    };
  };

  return {
    [SEARCH_PATH]: async () => callSearch(ctx.req ?? {}),
  };
}

// ---- SDK handler registration ----

const METHOD_SEARCH_FULL = 'qianxin.hunter.v1.HunterService/Search';

const wrapHandler = (ctx, methodPath) => async (reqOrCtx, maybeInnerCtx) => {
  let req, innerCtx;
  if (maybeInnerCtx !== undefined) {
    req = reqOrCtx ?? {};
    innerCtx = maybeInnerCtx ?? {};
  } else {
    const c = reqOrCtx ?? {};
    req = c.request ?? c.req ?? {};
    innerCtx = c;
  }
  const mergedCtx = {
    ...(ctx ?? {}),
    ...innerCtx,
    bindings: { ...(ctx?.bindings ?? {}), ...(innerCtx?.bindings ?? {}) },
    config: { ...(ctx?.config ?? {}), ...(innerCtx?.config ?? {}) },
    secret: { ...(ctx?.secret ?? {}), ...(innerCtx?.secret ?? {}) },
    limits: innerCtx?.limits ?? ctx?.limits ?? {},
    meta: innerCtx?.meta ?? ctx?.meta ?? {},
  };
  const legacyCtx = { ...mergedCtx, req };
  return rpcdef(legacyCtx)[methodPath]();
};

const registerHandlers = (ctx = {}) => ({
  [SEARCH_PATH]: wrapHandler(ctx, SEARCH_PATH),
});

const sdkHandlers = registerHandlers({});

export const handlers = {
  [METHOD_SEARCH_FULL]: (ctx) => sdkHandlers[SEARCH_PATH](ctx),
};

export { METHOD_SEARCH_FULL };

export const _test = {
  errorWithCode,
  normalizeBaseUrl,
  unwrapInt32,
  unwrapString,
  normalizeTimeout,
  mapSearchResult,
  registerHandlers,
};
