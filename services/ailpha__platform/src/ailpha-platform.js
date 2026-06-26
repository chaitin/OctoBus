// AiLPHA_Platform — proxy for the AiLPHA SIEM/SOC platform /openapi REST API.
// Methods: ListMergeAlarms, GetMergeAlarmDetail, UpdateMergeAlarmStatus,
//          ListLinkageStrategies, BlockIp, UnblockIp.
// Bindings (config): endpoint/baseUrl, headers, timeoutMs, skipTlsVerify.
// Bindings (secret): apiKey (sent as the `apiKey` HTTP header).

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const DEFAULT_TIMEOUT_MS = 1500;

const PKG = 'AiLPHA_Platform.AiLPHA_Platform';
const LIST_ALARMS_PATH = `/${PKG}/ListMergeAlarms`;
const ALARM_DETAIL_PATH = `/${PKG}/GetMergeAlarmDetail`;
const ALARM_STATUS_PATH = `/${PKG}/UpdateMergeAlarmStatus`;
const LIST_LINKAGE_PATH = `/${PKG}/ListLinkageStrategies`;
const BLOCK_IP_PATH = `/${PKG}/BlockIp`;
const UNBLOCK_IP_PATH = `/${PKG}/UnblockIp`;

const API_LIST_ALARMS = '/openapi/v2.0/merge-alarms';
const API_ALARM_DETAIL = '/openapi/v1.0/merge-alarm/detail';
const API_ALARM_STATUS = '/openapi/v2.0/merge-alarms/status';
const API_LIST_LINKAGE = '/openapi/v1.0/linkage-strategies';

const CONNECT_TYPES = ['ALL', 'DIRECT_CONNECT', 'ONLY_CURRENT'];
const LINKAGE_SORT_KEYS = ['blockIp', 'effectTime', 'status', 'linkDevice'];
const MAX_PAGE_SIZE = 1000;

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
  NOT_FOUND: grpcStatus.NOT_FOUND,
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

const toOptionalBool = (val) => {
  const raw = unwrapValue(val);
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'boolean') return raw;
  const s = String(raw).trim().toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return undefined;
};

const toPageSize = (val, field) => {
  const raw = unwrapValue(val);
  if (raw === undefined || raw === null || raw === '' || raw === 0) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || Number.isNaN(n)) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} must be an integer`);
  }
  if (field === 'page' && n < 1) throw errorWithCode('INVALID_ARGUMENT', 'page must be >= 1');
  if (field === 'size' && (n < 1 || n > MAX_PAGE_SIZE)) {
    throw errorWithCode('INVALID_ARGUMENT', `size must be in [1, ${MAX_PAGE_SIZE}]`);
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

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const normalizeStruct = (v) => (isPlainObject(v) ? v : {});

const requireIds = (req) => {
  const raw = firstDefined(req?.ids, req?.Ids);
  if (!Array.isArray(raw)) throw errorWithCode('INVALID_ARGUMENT', 'ids must be a non-empty array');
  if (raw.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'ids must be non-empty');
  return raw.map((item) => {
    if (item === undefined || item === null || String(item).trim() === '') {
      throw errorWithCode('INVALID_ARGUMENT', 'ids elements must be non-empty strings');
    }
    const s = String(item).trim();
    if (s.includes('/')) throw errorWithCode('INVALID_ARGUMENT', 'ids elements must not contain "/"');
    return s;
  });
};

// Maps a {$page,$size,total,data[]} list envelope.
const mapListResponse = (json) => {
  const j = isPlainObject(json) ? json : {};
  return {
    page: toInt(j.$page),
    size: toInt(j.$size),
    total: toInt(j.total),
    data: Array.isArray(j.data) ? j.data.map(normalizeStruct) : [],
    order_by: str(j.$orderBy),
  };
};

// Maps a {$page,$size,data:"..."} write envelope.
const mapWriteResponse = (json) => {
  const j = isPlainObject(json) ? json : {};
  return { page: toInt(j.$page), size: toInt(j.$size), data: str(j.data) };
};

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

  const buildHeaders = (extra = {}) => {
    if (!apiKey) throw errorWithCode('INVALID_ARGUMENT', 'apiKey is required');
    return {
      ...baseHeaders,
      apiKey,
      'x-engine-instance': meta.instance_id || meta.instanceId || 'octobus-ailpha',
      'x-request-id': meta.request_id || meta.requestId || 'unknown',
      ...extra,
    };
  };

  const tlsOptions = () => (skipTlsVerify ? { insecureSkipVerify: true, tlsInsecureSkipVerify: true } : {});

  const buildQuery = (pairs) => {
    const parts = [];
    for (const [k, v] of pairs) {
      if (v === undefined) continue;
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
    return parts.length ? `?${parts.join('&')}` : '';
  };

  // Calls AiLPHA; on non-2xx throws a gRPC error carrying .httpStatus. Returns parsed JSON (or null).
  const callAiLPHA = async (path, { method, bodyObj } = {}) => {
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
      let code;
      if (res.status === 401) code = 'UNAUTHENTICATED';
      else if (res.status === 403) code = 'PERMISSION_DENIED';
      else if (res.status === 404) code = 'NOT_FOUND';
      else if (res.status >= 400 && res.status < 500) code = 'FAILED_PRECONDITION';
      else code = 'UNAVAILABLE';
      const err = errorWithCode(code, `upstream http ${res.status}: ${text}`);
      err.httpStatus = res.status;
      throw err;
    }

    if (!text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw errorWithCode('UNKNOWN', 'response is not valid JSON');
    }
  };

  const callListMergeAlarms = async (req) => {
    const orderBy = toOptionalString(firstDefined(req?.order_by, req?.orderBy));
    const page = toPageSize(firstDefined(req?.page, req?.Page), 'page');
    const size = toPageSize(firstDefined(req?.size, req?.Size), 'size');
    const cascadeOrgId = toOptionalString(firstDefined(req?.cascade_org_id, req?.cascadeOrgId));
    const condition = toOptionalString(req?.condition);
    const endTime = toOptionalString(firstDefined(req?.end_time, req?.endTime));
    const startTime = toOptionalString(firstDefined(req?.start_time, req?.startTime));
    const params = toOptionalString(req?.params);
    const fieldMapping = toOptionalBool(firstDefined(req?.field_mapping, req?.fieldMapping));

    let connectType = toOptionalString(firstDefined(req?.connect_type, req?.connectType));
    if (connectType !== undefined) {
      if (!CONNECT_TYPES.includes(connectType)) {
        throw errorWithCode('INVALID_ARGUMENT', `connect_type must be one of ${CONNECT_TYPES.join(', ')}`);
      }
      if (connectType === 'ALL') connectType = undefined; // ALL = omit
    }

    const query = buildQuery([
      ['$orderBy', orderBy],
      ['$page', page],
      ['$size', size],
      ['cascadeOrgId', cascadeOrgId],
      ['condition', condition],
      ['connectType', connectType],
      ['endTime', endTime],
      ['fieldMapping', fieldMapping === undefined ? undefined : String(fieldMapping)],
      ['params', params],
      ['startTime', startTime],
    ]);

    const json = await callAiLPHA(`${API_LIST_ALARMS}${query}`, { method: 'GET' });
    return mapListResponse(json);
  };

  const callGetMergeAlarmDetail = async (req) => {
    const aggCondition = requireNonEmpty(firstDefined(req?.agg_condition, req?.aggCondition), 'agg_condition');
    const windowId = requireNonEmpty(firstDefined(req?.window_id, req?.windowId), 'window_id');
    const query = buildQuery([['aggCondition', aggCondition], ['windowId', windowId]]);
    const json = await callAiLPHA(`${API_ALARM_DETAIL}${query}`, { method: 'GET' });
    return { detail: normalizeStruct(json) };
  };

  const callUpdateMergeAlarmStatus = async (req) => {
    const alarmStatus = requireNonEmpty(firstDefined(req?.alarm_status, req?.alarmStatus), 'alarm_status');
    const condition = toOptionalString(req?.condition);
    const startTime = toOptionalString(firstDefined(req?.start_time, req?.startTime));
    const endTime = toOptionalString(firstDefined(req?.end_time, req?.endTime));
    if (condition === undefined && !(startTime !== undefined && endTime !== undefined)) {
      throw errorWithCode('INVALID_ARGUMENT', 'provide condition, or both start_time and end_time, as the selector');
    }

    const body = { alarmStatus };
    const alarmNotes = toOptionalString(firstDefined(req?.alarm_notes, req?.alarmNotes));
    if (alarmNotes !== undefined) body.alarmNotes = alarmNotes;
    const alarmSource = toOptionalString(firstDefined(req?.alarm_source, req?.alarmSource));
    if (alarmSource !== undefined) body.alarmSource = alarmSource;
    if (condition !== undefined) body.condition = condition;
    if (startTime !== undefined) body.startTime = startTime;
    if (endTime !== undefined) body.endTime = endTime;
    const url = toOptionalString(req?.url);
    if (url !== undefined) body.url = url;

    const json = await callAiLPHA(API_ALARM_STATUS, { method: 'POST', bodyObj: body });
    return mapWriteResponse(json);
  };

  const callListLinkageStrategies = async (req) => {
    const page = toPageSize(firstDefined(req?.page, req?.Page), 'page');
    const size = toPageSize(firstDefined(req?.size, req?.Size), 'size');
    const age = toOptionalString(req?.age);

    const orderBy = toOptionalString(firstDefined(req?.order_by, req?.orderBy));
    if (orderBy !== undefined) {
      const key = orderBy.replace(/^-/, '').replace(/\s+(asc|desc)$/i, '').trim();
      if (!LINKAGE_SORT_KEYS.includes(key)) {
        throw errorWithCode('INVALID_ARGUMENT', `order_by key must be one of ${LINKAGE_SORT_KEYS.join(', ')}`);
      }
    }

    const query = buildQuery([
      ['$orderBy', orderBy],
      ['$page', page],
      ['$size', size],
      ['age', age],
    ]);
    const json = await callAiLPHA(`${API_LIST_LINKAGE}${query}`, { method: 'GET' });
    return mapListResponse(json);
  };

  const callBlockIp = async (req) => {
    const ids = requireIds(req);
    const path = `${API_LIST_LINKAGE}/${ids.map(encodeURIComponent).join(',')}/accessIp`;
    const json = await callAiLPHA(path, { method: 'POST' });
    return mapWriteResponse(json);
  };

  const callUnblockIp = async (req) => {
    const ids = requireIds(req);
    const path = `${API_LIST_LINKAGE}/${ids.map(encodeURIComponent).join(',')}/blockIp`;
    try {
      const json = await callAiLPHA(path, { method: 'DELETE' });
      return mapWriteResponse(json);
    } catch (e) {
      if (e?.httpStatus === 404) return { page: 0, size: 0, data: '' }; // idempotent on absence
      throw e;
    }
  };

  return {
    [LIST_ALARMS_PATH]: async () => callListMergeAlarms(ctx.req ?? {}),
    [ALARM_DETAIL_PATH]: async () => callGetMergeAlarmDetail(ctx.req ?? {}),
    [ALARM_STATUS_PATH]: async () => callUpdateMergeAlarmStatus(ctx.req ?? {}),
    [LIST_LINKAGE_PATH]: async () => callListLinkageStrategies(ctx.req ?? {}),
    [BLOCK_IP_PATH]: async () => callBlockIp(ctx.req ?? {}),
    [UNBLOCK_IP_PATH]: async () => callUnblockIp(ctx.req ?? {}),
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
  [LIST_ALARMS_PATH]: wrapLegacyHandler(ctx, LIST_ALARMS_PATH),
  [ALARM_DETAIL_PATH]: wrapLegacyHandler(ctx, ALARM_DETAIL_PATH),
  [ALARM_STATUS_PATH]: wrapLegacyHandler(ctx, ALARM_STATUS_PATH),
  [LIST_LINKAGE_PATH]: wrapLegacyHandler(ctx, LIST_LINKAGE_PATH),
  [BLOCK_IP_PATH]: wrapLegacyHandler(ctx, BLOCK_IP_PATH),
  [UNBLOCK_IP_PATH]: wrapLegacyHandler(ctx, UNBLOCK_IP_PATH),
});

export const METHOD_LIST_ALARMS_FULL = `${PKG}/ListMergeAlarms`;
export const METHOD_ALARM_DETAIL_FULL = `${PKG}/GetMergeAlarmDetail`;
export const METHOD_ALARM_STATUS_FULL = `${PKG}/UpdateMergeAlarmStatus`;
export const METHOD_LIST_LINKAGE_FULL = `${PKG}/ListLinkageStrategies`;
export const METHOD_BLOCK_IP_FULL = `${PKG}/BlockIp`;
export const METHOD_UNBLOCK_IP_FULL = `${PKG}/UnblockIp`;

const sdkHandlers = registerHandlers({});

export const handlers = {
  [METHOD_LIST_ALARMS_FULL]: (ctx) => sdkHandlers[LIST_ALARMS_PATH](ctx),
  [METHOD_ALARM_DETAIL_FULL]: (ctx) => sdkHandlers[ALARM_DETAIL_PATH](ctx),
  [METHOD_ALARM_STATUS_FULL]: (ctx) => sdkHandlers[ALARM_STATUS_PATH](ctx),
  [METHOD_LIST_LINKAGE_FULL]: (ctx) => sdkHandlers[LIST_LINKAGE_PATH](ctx),
  [METHOD_BLOCK_IP_FULL]: (ctx) => sdkHandlers[BLOCK_IP_PATH](ctx),
  [METHOD_UNBLOCK_IP_FULL]: (ctx) => sdkHandlers[UNBLOCK_IP_PATH](ctx),
};

export const _test = {
  errorWithCode,
  firstDefined,
  mapListResponse,
  mapWriteResponse,
  mergedBindings,
  normalizeBaseUrl,
  normalizeStruct,
  parseHeaders,
  registerHandlers,
  requireIds,
  requireNonEmpty,
  resolveCallContext,
  toInt,
  toOptionalBool,
  toOptionalString,
  toPageSize,
  CONNECT_TYPES,
  LINKAGE_SORT_KEYS,
};
