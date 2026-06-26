// M01_Intelligence — proxy for the m01 mail security gateway local threat-intelligence APIs.
// Methods: DetectIntelligence, ListIntelligence, AddIntelligence, UpdateIntelligence,
//          DeleteIntelligence, GetIntelligenceStats.
// Bindings (config): endpoint/baseUrl, headers, timeoutMs, skipTlsVerify.
// Bindings (secret): apiKey (x-api-key, primary) OR apiToken (Bearer, fallback).

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const DEFAULT_TIMEOUT_MS = 1500;

const PKG = 'M01_Intelligence.M01_Intelligence';
const DETECT_PATH = `/${PKG}/DetectIntelligence`;
const LIST_PATH = `/${PKG}/ListIntelligence`;
const ADD_PATH = `/${PKG}/AddIntelligence`;
const UPDATE_PATH = `/${PKG}/UpdateIntelligence`;
const DELETE_PATH = `/${PKG}/DeleteIntelligence`;
const STATS_PATH = `/${PKG}/GetIntelligenceStats`;

const API_DETECT = '/m01/intelligence/detection';
const API_LIST = '/m01/intelligence/list';
const API_ADD = '/m01/intelligence/add';
const API_UPDATE = '/m01/intelligence/update';
const API_DELETE = '/m01/intelligence/delete';
const API_STATS = '/m01/intelligence/stats';

// Upstream enum wire-string sets (validated handler-side).
const TYPE_DETECT = ['url', 'url-domain', 'email-domain', 'email-addr', 'ipv4', 'md5', 'sha256'];
const TYPE_DELETE = ['url', 'url-domain', 'email-domain', 'email-addr', 'md5', 'sha256', 'ipv4'];
const ATTRIBUTE_ADD = ['url-domain', 'email-domain', 'url', 'email-addr', 'ipv4', 'md5', 'sha256', 'sha1'];
const TLP_SET = ['RED', 'AMBER', 'GREEN', 'CLEAR', 'AMBER+STRICT'];
const URGENCY_SET = ['high', 'medium', 'low'];
const STATUS_ADD = ['active', 'revoked'];
const STATUS_UPDATE = ['active', 'expired', 'revoked'];

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

const unwrapValue = (source) => {
  if (source !== null && typeof source === 'object' && 'value' in source) return source.value;
  return source;
};

const toOptionalString = (val) => {
  const raw = unwrapValue(val);
  if (raw === undefined || raw === null) return undefined;
  const str = String(raw);
  return str === '' ? undefined : str;
};

const toInt = (val) => {
  const raw = unwrapValue(val);
  if (raw === undefined || raw === null || raw === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

// page / page_size: optional positive int; 0/absent -> omit (upstream default).
const toOptionalPositiveInt = (val, field) => {
  const raw = unwrapValue(val);
  if (raw === undefined || raw === null || raw === '' || raw === 0) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || Number.isNaN(n) || n < 1) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} must be a positive integer`);
  }
  return n;
};

const str = (v) => {
  const raw = unwrapValue(v);
  return raw === undefined || raw === null ? '' : String(raw);
};

const requireNonEmpty = (val, field) => {
  const s = toOptionalString(val);
  if (s === undefined) throw errorWithCode('INVALID_ARGUMENT', `${field} is required`);
  return s;
};

const validateEnum = (val, set, field) => {
  if (!set.includes(val)) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} must be one of ${set.join(', ')}`);
  }
  return val;
};

const requireItemArray = (req, keys) => {
  for (const key of keys) {
    if (hasOwn(req, key)) {
      const val = req[key];
      if (!Array.isArray(val)) throw errorWithCode('INVALID_ARGUMENT', `${key} must be an array`);
      if (val.length === 0) throw errorWithCode('INVALID_ARGUMENT', `${key} must be non-empty`);
      return val;
    }
  }
  throw errorWithCode('INVALID_ARGUMENT', `${keys[0]} is required`);
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const normalizeStruct = (v) => (isPlainObject(v) ? v : {});
const normalizeStructArray = (v) => (Array.isArray(v) ? v.map((x) => (isPlainObject(x) ? x : { value: x })) : []);

const mapRecord = (r = {}) => ({
  hit: Boolean(r.hit),
  request_id: str(r.request_id),
  id: str(r.id),
  description: str(r.description),
  source_industry: Array.isArray(r.source_industry) ? r.source_industry.map(String) : [],
  source: str(r.source),
  status: str(r.status),
  tlp: str(r.tlp),
  intelligence_type: str(r.intelligence_type),
  urgency: str(r.urgency),
  first_discovered_time: str(r.first_discovered_time),
  last_active_time: str(r.last_active_time),
  intelligence_update_time: str(r.intelligence_update_time),
  intelligence_expiration_time: str(r.intelligence_expiration_time),
  attribute: str(r.attribute),
  pattern: str(r.pattern),
  info: normalizeStruct(r.info),
  phishing_script: normalizeStructArray(r.phishing_script),
});

export function rpcdef(ctx) {
  const bindings = mergedBindings(ctx);
  const endpoint = bindings.endpoint || bindings.baseUrl || bindings.base_url || '';
  const timeoutMs = ctx.limits?.timeoutMs || Number(bindings.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const baseHeaders = parseHeaders(bindings.headers);
  const meta = ctx.meta || {};
  const skipTlsVerify = Boolean(
    bindings.skipTlsVerify || bindings.skip_tls_verify || bindings.tlsInsecureSkipVerify || bindings.tls_insecure_skip_verify,
  );

  const apiKey = toOptionalString(bindings.apiKey || bindings.api_key);
  const apiToken = toOptionalString(bindings.apiToken || bindings.api_token);

  const buildAuthHeaders = () => {
    if (apiKey) return { 'x-api-key': apiKey };
    if (apiToken) return { authorization: `Bearer ${apiToken}` };
    throw errorWithCode('INVALID_ARGUMENT', 'apiKey (x-api-key) or apiToken (Bearer) is required');
  };

  const buildHeaders = (extra = {}) => ({
    ...baseHeaders,
    ...buildAuthHeaders(),
    'x-engine-instance': meta.instance_id || meta.instanceId || 'unknown',
    'x-request-id': meta.request_id || meta.requestId || 'unknown',
    ...extra,
  });

  const tlsOptions = () => (skipTlsVerify ? { insecureSkipVerify: true, tlsInsecureSkipVerify: true } : {});

  // Calls the gateway and unwraps the { code, msg, data } envelope, returning `data`.
  const callM01 = async (path, { method, bodyObj } = {}) => {
    const baseUrl = normalizeBaseUrl(endpoint);
    if (!baseUrl) throw errorWithCode('INVALID_ARGUMENT', 'endpoint/baseUrl is required (http/https)');
    const hasBody = bodyObj !== undefined;
    const headers = buildHeaders(hasBody ? { 'content-type': 'application/json' } : {});

    let res;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: hasBody ? JSON.stringify(bodyObj) : undefined,
        timeoutMs,
        ...tlsOptions(),
      });
    } catch (e) {
      const reason = e?.cause?.message || e?.message || 'fetch failed';
      throw errorWithCode('UNAVAILABLE', reason);
    }

    const text = await res.text();
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw errorWithCode('PERMISSION_DENIED', `upstream http ${res.status}: ${text}`);
      }
      if (res.status >= 400 && res.status < 500) {
        throw errorWithCode('FAILED_PRECONDITION', `upstream http ${res.status}: ${text}`);
      }
      throw errorWithCode('UNAVAILABLE', `upstream http ${res.status}: ${text}`);
    }

    if (!text.trim()) return null;
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw errorWithCode('UNKNOWN', 'response is not valid JSON');
    }

    const code = json?.code;
    if (code !== undefined && code !== null && Number(code) !== 200) {
      const msg = json?.msg || `upstream code ${code}`;
      if (Number(code) === 400) throw errorWithCode('FAILED_PRECONDITION', `upstream code 400: ${msg}`);
      if (Number(code) === 401 || Number(code) === 403) throw errorWithCode('PERMISSION_DENIED', `upstream code ${code}: ${msg}`);
      throw errorWithCode('UNAVAILABLE', `upstream code ${code}: ${msg}`);
    }
    return json?.data ?? null;
  };

  const callDetect = async (req) => {
    const queries = requireItemArray(req, ['queries', 'Queries']);
    const body = queries.map((q, i) => ({
      pattern: requireNonEmpty(q?.pattern, `queries[${i}].pattern`),
      type: validateEnum(requireNonEmpty(q?.type, `queries[${i}].type`), TYPE_DETECT, `queries[${i}].type`),
      request_id: requireNonEmpty(q?.request_id ?? q?.requestId, `queries[${i}].request_id`),
    }));
    const data = await callM01(API_DETECT, { method: 'POST', bodyObj: body });
    const records = Array.isArray(data) ? data.map(mapRecord) : [];
    return { records };
  };

  const callList = async (req) => {
    const body = {};
    const page = toOptionalPositiveInt(firstDefined(req?.page, req?.Page), 'page');
    const pageSize = toOptionalPositiveInt(firstDefined(req?.page_size, req?.pageSize), 'page_size');
    if (page !== undefined) body.page = page;
    if (pageSize !== undefined) body.page_size = pageSize;

    const stringFilters = [
      ['id', ['id', 'Id']],
      ['description', ['description', 'Description']],
      ['pattern', ['pattern', 'Pattern']],
      ['status', ['status', 'Status']],
      ['attribute', ['attribute', 'Attribute']],
      ['first_discovered_time_start', ['first_discovered_time_start', 'firstDiscoveredTimeStart']],
      ['first_discovered_time_end', ['first_discovered_time_end', 'firstDiscoveredTimeEnd']],
      ['last_active_time_start', ['last_active_time_start', 'lastActiveTimeStart']],
      ['last_active_time_end', ['last_active_time_end', 'lastActiveTimeEnd']],
      ['expiration_time_start', ['expiration_time_start', 'expirationTimeStart']],
      ['expiration_time_end', ['expiration_time_end', 'expirationTimeEnd']],
      ['update_time_start', ['update_time_start', 'updateTimeStart']],
      ['update_time_end', ['update_time_end', 'updateTimeEnd']],
    ];
    for (const [wire, keys] of stringFilters) {
      const v = toOptionalString(firstDefined(...keys.map((k) => req?.[k])));
      if (v !== undefined) body[wire] = v;
    }

    const data = await callM01(API_LIST, { method: 'POST', bodyObj: body });
    const d = isPlainObject(data) ? data : {};
    return {
      total: toInt(d.total),
      page: toInt(d.page),
      page_size: toInt(d.page_size),
      total_pages: toInt(d.total_pages),
      records: Array.isArray(d.records) ? d.records.map(normalizeStruct) : [],
    };
  };

  const callAdd = async (req) => {
    const items = requireItemArray(req, ['items', 'Items']);
    const body = items.map((it, i) => {
      const out = {
        tlp: validateEnum(requireNonEmpty(it?.tlp, `items[${i}].tlp`), TLP_SET, `items[${i}].tlp`),
        urgency: validateEnum(requireNonEmpty(it?.urgency, `items[${i}].urgency`), URGENCY_SET, `items[${i}].urgency`),
        attribute: validateEnum(requireNonEmpty(it?.attribute, `items[${i}].attribute`), ATTRIBUTE_ADD, `items[${i}].attribute`),
        pattern: requireNonEmpty(it?.pattern, `items[${i}].pattern`),
      };
      const description = toOptionalString(it?.description);
      if (description !== undefined) out.description = description;
      const status = toOptionalString(it?.status);
      if (status !== undefined) out.status = validateEnum(status, STATUS_ADD, `items[${i}].status`);
      const exp = toOptionalString(firstDefined(it?.intelligence_expiration_time, it?.intelligenceExpirationTime));
      if (exp !== undefined) out.intelligence_expiration_time = exp;
      return out;
    });

    const data = await callM01(API_ADD, { method: 'POST', bodyObj: body });
    const d = isPlainObject(data) ? data : {};
    return {
      success_count: toInt(d.success_count),
      intelligence_ids: Array.isArray(d.intelligence_ids)
        ? d.intelligence_ids.map((x) => ({ intelligence_id: str(x?.intelligence_id), pattern: str(x?.pattern) }))
        : [],
      failed_count: toInt(d.failed_count),
      failures: Array.isArray(d.failures)
        ? d.failures.map((x) => ({ pattern: str(x?.pattern), reason: str(x?.reason) }))
        : [],
    };
  };

  const callUpdate = async (req) => {
    const items = requireItemArray(req, ['items', 'Items']);
    const body = items.map((it, i) => {
      const out = { id: requireNonEmpty(it?.id, `items[${i}].id`) };
      const description = toOptionalString(it?.description);
      if (description !== undefined) out.description = description;
      const status = toOptionalString(it?.status);
      if (status !== undefined) out.status = validateEnum(status, STATUS_UPDATE, `items[${i}].status`);
      const tlp = toOptionalString(it?.tlp);
      if (tlp !== undefined) out.tlp = validateEnum(tlp, TLP_SET, `items[${i}].tlp`);
      const urgency = toOptionalString(it?.urgency);
      if (urgency !== undefined) out.urgency = validateEnum(urgency, URGENCY_SET, `items[${i}].urgency`);
      const exp = toOptionalString(firstDefined(it?.intelligence_expiration_time, it?.intelligenceExpirationTime));
      if (exp !== undefined) out.intelligence_expiration_time = exp;
      return out;
    });

    const data = await callM01(API_UPDATE, { method: 'POST', bodyObj: body });
    return { id: str(data) };
  };

  const callDelete = async (req) => {
    const items = requireItemArray(req, ['items', 'Items']);
    const body = items.map((it, i) => ({
      intelligence_id: requireNonEmpty(firstDefined(it?.intelligence_id, it?.intelligenceId), `items[${i}].intelligence_id`),
      intelligence_type: validateEnum(
        requireNonEmpty(firstDefined(it?.intelligence_type, it?.intelligenceType), `items[${i}].intelligence_type`),
        TYPE_DELETE,
        `items[${i}].intelligence_type`,
      ),
      pattern: requireNonEmpty(it?.pattern, `items[${i}].pattern`),
      pattern_type: requireNonEmpty(firstDefined(it?.pattern_type, it?.patternType), `items[${i}].pattern_type`),
    }));

    const data = await callM01(API_DELETE, { method: 'POST', bodyObj: body });
    const d = isPlainObject(data) ? data : {};
    return { success_count: toInt(d.success_count) };
  };

  const callStats = async () => {
    const data = await callM01(API_STATS, { method: 'GET' });
    const d = isPlainObject(data) ? data : {};
    return {
      total: toInt(d.total),
      active_count: toInt(d.active_count),
      revoked_count: toInt(d.revoked_count),
    };
  };

  return {
    [DETECT_PATH]: async () => callDetect(ctx.req ?? {}),
    [LIST_PATH]: async () => callList(ctx.req ?? {}),
    [ADD_PATH]: async () => callAdd(ctx.req ?? {}),
    [UPDATE_PATH]: async () => callUpdate(ctx.req ?? {}),
    [DELETE_PATH]: async () => callDelete(ctx.req ?? {}),
    [STATS_PATH]: async () => callStats(ctx.req ?? {}),
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
  const legacyCtx = { ...call.ctx, req: call.req };
  return rpcdef(legacyCtx)[methodPath]();
};

const registerHandlers = (ctx = {}) => ({
  [DETECT_PATH]: wrapLegacyHandler(ctx, DETECT_PATH),
  [LIST_PATH]: wrapLegacyHandler(ctx, LIST_PATH),
  [ADD_PATH]: wrapLegacyHandler(ctx, ADD_PATH),
  [UPDATE_PATH]: wrapLegacyHandler(ctx, UPDATE_PATH),
  [DELETE_PATH]: wrapLegacyHandler(ctx, DELETE_PATH),
  [STATS_PATH]: wrapLegacyHandler(ctx, STATS_PATH),
});

export const METHOD_DETECT_FULL = `${PKG}/DetectIntelligence`;
export const METHOD_LIST_FULL = `${PKG}/ListIntelligence`;
export const METHOD_ADD_FULL = `${PKG}/AddIntelligence`;
export const METHOD_UPDATE_FULL = `${PKG}/UpdateIntelligence`;
export const METHOD_DELETE_FULL = `${PKG}/DeleteIntelligence`;
export const METHOD_STATS_FULL = `${PKG}/GetIntelligenceStats`;

const sdkHandlers = registerHandlers({});

export const handlers = {
  [METHOD_DETECT_FULL]: (ctx) => sdkHandlers[DETECT_PATH](ctx),
  [METHOD_LIST_FULL]: (ctx) => sdkHandlers[LIST_PATH](ctx),
  [METHOD_ADD_FULL]: (ctx) => sdkHandlers[ADD_PATH](ctx),
  [METHOD_UPDATE_FULL]: (ctx) => sdkHandlers[UPDATE_PATH](ctx),
  [METHOD_DELETE_FULL]: (ctx) => sdkHandlers[DELETE_PATH](ctx),
  [METHOD_STATS_FULL]: (ctx) => sdkHandlers[STATS_PATH](ctx),
};

export const _test = {
  errorWithCode,
  firstDefined,
  mapRecord,
  mergedBindings,
  normalizeBaseUrl,
  normalizeStruct,
  normalizeStructArray,
  parseHeaders,
  registerHandlers,
  requireItemArray,
  requireNonEmpty,
  resolveCallContext,
  toInt,
  toOptionalPositiveInt,
  toOptionalString,
  validateEnum,
  TYPE_DETECT,
  TYPE_DELETE,
  ATTRIBUTE_ADD,
  TLP_SET,
  URGENCY_SET,
  STATUS_ADD,
  STATUS_UPDATE,
};
