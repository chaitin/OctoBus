// Tencent Cloud Bastion Host (BH / 堡垒机) API implementation
// Uses TC3-HMAC-SHA256 signing for Tencent Cloud API v3.
//
// API version: 2023-04-18
// Endpoint: bh.tencentcloudapi.com

import crypto from 'node:crypto';
import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

// ── Constants ──────────────────────────────────────────────

const SERVICE_NAME = 'Tencent_BH';
const API_VERSION = '2023-04-18';
const DEFAULT_REGION = 'ap-guangzhou';
const DEFAULT_ENDPOINT = 'bh.tencentcloudapi.com';
const DEFAULT_TIMEOUT_MS = 10000;
const ALGORITHM = 'TC3-HMAC-SHA256';
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 20;

// ── Method paths ───────────────────────────────────────────

export const LIST_SESSIONS_PATH = '/Tencent_BH.Tencent_BH/ListSessions';
export const KILL_SESSION_PATH = '/Tencent_BH.Tencent_BH/KillSession';
export const LIST_DEVICES_PATH = '/Tencent_BH.Tencent_BH/ListDevices';
export const LIST_USERS_PATH = '/Tencent_BH.Tencent_BH/ListUsers';
export const LOCK_USER_PATH = '/Tencent_BH.Tencent_BH/LockUser';
export const UNLOCK_USER_PATH = '/Tencent_BH.Tencent_BH/UnlockUser';

export const LIST_SESSIONS_FULL = 'Tencent_BH.Tencent_BH/ListSessions';
export const KILL_SESSION_FULL = 'Tencent_BH.Tencent_BH/KillSession';
export const LIST_DEVICES_FULL = 'Tencent_BH.Tencent_BH/ListDevices';
export const LIST_USERS_FULL = 'Tencent_BH.Tencent_BH/ListUsers';
export const LOCK_USER_FULL = 'Tencent_BH.Tencent_BH/LockUser';
export const UNLOCK_USER_FULL = 'Tencent_BH.Tencent_BH/UnlockUser';

// ── Error helpers ──────────────────────────────────────────

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

// ── Internal helpers ───────────────────────────────────────

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const firstDefined = (...values) => values.find((v) => v !== undefined && v !== null);

const toTrimmedString = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return toTrimmedString(value.value);
  return String(value).trim();
};

const toInt64 = (value) => {
  if (value === undefined || value === null) return null;
  const raw = typeof value === 'object' && value !== null && hasOwn(value, 'value') ? value.value : value;
  if (raw === undefined || raw === null || raw === '') return null;
  const num = Number(raw);
  if (!Number.isInteger(num) || Number.isNaN(num)) return null;
  return num;
};

const toBoolean = (value) => {
  if (value === undefined || value === null) return false;
  const raw = typeof value === 'object' && value !== null && hasOwn(value, 'value') ? value.value : value;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const text = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'n', 'off', ''].includes(text)) return false;
  }
  return Boolean(raw);
};

const toValue = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return { numberValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  if (Array.isArray(value)) {
    return { listValue: { values: value.map(toValue).filter((v) => v !== undefined) } };
  }
  if (typeof value === 'object') {
    const fields = {};
    for (const [key, v] of Object.entries(value)) {
      fields[key] = toValue(v) ?? { nullValue: 'NULL_VALUE' };
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(value) };
};

// ── TC3-HMAC-SHA256 Signing ────────────────────────────────

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

const hmacSha256 = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

const tc3Sign = (params, secretId, secretKey, region, endpoint, action) => {
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000);
  const y = date.getUTCFullYear();
  const m = ('0' + (date.getUTCMonth() + 1)).slice(-2);
  const d = ('0' + date.getUTCDate()).slice(-2);
  const dateStr = y + '-' + m + '-' + d;
  const service = 'bh';
  const credentialScope = dateStr + '/' + service + '/tc3_request';

  const payload = JSON.stringify(params);
  const payloadHash = sha256(payload);

  // Canonical request: only content-type and host are signed
  const contentType = 'application/json';
  const canonicalHeaders = 'content-type:' + contentType + '\n' + 'host:' + endpoint + '\n';
  const signedHeaders = 'content-type;host';
  const canonicalRequest = 'POST\n/\n\n' + canonicalHeaders + '\n' + signedHeaders + '\n' + payloadHash;

  const stringToSign = 'TC3-HMAC-SHA256\n' + timestamp + '\n' + credentialScope + '\n' + sha256(canonicalRequest);

  const dateCompact = y + m + d;
  const kDate = hmacSha256('TC3' + secretKey, dateStr); // NOTE: SDK uses YYYY-MM-DD format, not YYYYMMDD
  const kService = hmacSha256(kDate, service);
  const kSigning = hmacSha256(kService, 'tc3_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization = 'TC3-HMAC-SHA256 Credential=' + secretId + '/' + credentialScope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;

  return {
    url: 'https://' + endpoint,
    headers: {
      'Content-Type': contentType,
      'Host': endpoint,
      'X-TC-Action': action,
      'X-TC-Region': region,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Version': API_VERSION,
      'Authorization': authorization,
    },
    body: payload,
    timestamp,
  };
};

// ── Binding and context resolution ─────────────────────────

const mergedBindings = (ctx = {}) => ({
  ...(ctx.config ?? {}),
  ...(ctx.secret ?? {}),
  ...(ctx.bindings ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.req ?? ctx.request ?? {},
});

const resolveTimeoutMs = (bindings = {}, limits = {}) => {
  const fromBinding = toInt64(bindings.timeoutMs);
  if (fromBinding !== null) return fromBinding;
  const fromLimits = toInt64(limits.timeoutMs);
  if (fromLimits !== null) return fromLimits;
  return DEFAULT_TIMEOUT_MS;
};

const buildHeaders = (bindings = {}, meta = {}) => ({
  ...(bindings.headers && typeof bindings.headers === 'object' ? bindings.headers : {}),
  'x-engine-instance': meta.instance_id || meta.instanceId || 'unknown',
  'x-request-id': meta.request_id || meta.requestId || 'unknown',
});

const buildLogPrefix = (meta = {}, action) => {
  const parts = [];
  if (meta.instance_id || meta.instanceId) parts.push(`inst=${meta.instance_id || meta.instanceId}`);
  if (meta.request_id || meta.requestId) parts.push(`req=${meta.request_id || meta.requestId}`);
  return `[${SERVICE_NAME}][${action}]${parts.length ? `[${parts.join(' ')}]` : ''}`;
};

const logFlow = (meta, action, details) => {
  const prefix = buildLogPrefix(meta, action);
  const safe = { ...details };
  if (safe.body) safe.body = '[REDACTED]';
  try {
    console.log(prefix, JSON.stringify(safe));
  } catch {
    console.log(prefix, safe);
  }
};

// ── Security credential extraction ─────────────────────────

const resolveCredentials = (bindings = {}) => {
  const secretId = toTrimmedString(firstDefined(bindings.secret_id, bindings.secretId));
  const secretKey = toTrimmedString(firstDefined(bindings.secret_key, bindings.secretKey));
  if (!secretId) throw errorWithCode('FAILED_PRECONDITION', 'binding "secret_id" or "secretId" is required but not configured');
  if (!secretKey) throw errorWithCode('FAILED_PRECONDITION', 'binding "secret_key" or "secretKey" is required but not configured');
  return { secretId, secretKey };
};

const resolveRegion = (bindings = {}) => {
  return toTrimmedString(bindings.region) || DEFAULT_REGION;
};

const resolveEndpoint = (bindings = {}) => {
  return toTrimmedString(bindings.endpoint) || DEFAULT_ENDPOINT;
};

// ── API call ────────────────────────────────────────────────

const callAction = async (ctx, action, params) => {
  const bindings = mergedBindings(ctx);
  const credentials = resolveCredentials(bindings);
  const region = resolveRegion(bindings);
  const endpoint = resolveEndpoint(bindings);
  const timeoutMs = resolveTimeoutMs(bindings, ctx.limits);
  const meta = ctx.meta || {};

  const signed = tc3Sign(params, credentials.secretId, credentials.secretKey, region, endpoint, action);

  const extraHeaders = buildHeaders(bindings, meta);
  const requestHeaders = {
    ...signed.headers,
    ...extraHeaders,
  };

  logFlow(meta, `${action}:start`, { region, endpoint });

  let res;
  try {
    res = await fetch(signed.url, {
      method: 'POST',
      headers: requestHeaders,
      body: signed.body,
      timeoutMs,
      ...(toBoolean(bindings.skipTlsVerify) || toBoolean(bindings.tlsInsecureSkipVerify)
        ? { insecureSkipVerify: true, tlsInsecureSkipVerify: true }
        : {}),
    });
  } catch (err) {
    const reason = err?.cause?.message || err?.message || 'fetch failed';
    logFlow(meta, `${action}:error`, { error: reason });
    throw errorWithCode('UNAVAILABLE', `upstream error: ${reason}`);
  }

  const text = await res.text();

  if (res.status === 401 || res.status === 403) {
    logFlow(meta, `${action}:auth-error`, { status: res.status });
    throw errorWithCode('PERMISSION_DENIED', `upstream http ${res.status}: ${text}`);
  }

  if (res.status >= 400 && res.status < 500) {
    logFlow(meta, `${action}:client-error`, { status: res.status, response: text });
    throw errorWithCode('FAILED_PRECONDITION', `upstream http ${res.status}: ${text}`);
  }

  if (res.status >= 500) {
    logFlow(meta, `${action}:server-error`, { status: res.status });
    throw errorWithCode('UNAVAILABLE', `upstream http ${res.status}: ${text}`);
  }

  if (!text.trim()) {
    throw errorWithCode('UNKNOWN', 'empty response from upstream');
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', 'response is not valid JSON');
  }

  // Tencent Cloud API error
  if (json.Response?.Error) {
    const { Code, Message } = json.Response.Error;
    const mappedCode = Code === 'AuthFailure' ? 'PERMISSION_DENIED' : 'FAILED_PRECONDITION';
    logFlow(meta, `${action}:api-error`, { code: Code, message: Message });
    throw errorWithCode(mappedCode, `Tencent API error: ${Code} - ${Message}`);
  }

  logFlow(meta, `${action}:done`, {});
  return json.Response || {};
};

// ── Request builders ───────────────────────────────────────

const buildListSessionsParams = (req = {}) => {
  const params = {};

  const offset = toInt64(firstDefined(req.offset, req.Offset));
  if (offset !== null && offset >= 0) {
    params.Offset = offset;
  }

  const limit = toInt64(firstDefined(req.limit, req.Limit));
  if (limit !== null && limit > 0 && limit <= MAX_LIMIT) {
    params.Limit = limit;
  } else {
    params.Limit = DEFAULT_LIMIT;
  }

  // Build filters
  const filters = [];

  const rawStatus = firstDefined(req.status, req.Status);
  if (rawStatus) {
    const statuses = Array.isArray(rawStatus) ? rawStatus : [rawStatus];
    if (statuses.length > 0) {
      filters.push({ Name: 'Status', Values: statuses.map(String) });
    }
  }

  const userName = toTrimmedString(firstDefined(req.user_name, req.userName));
  if (userName) {
    filters.push({ Name: 'UserName', Values: [userName] });
  }

  const deviceName = toTrimmedString(firstDefined(req.device_name, req.deviceName));
  if (deviceName) {
    filters.push({ Name: 'DeviceName', Values: [deviceName] });
  }

  if (filters.length > 0) {
    params.Filters = filters;
  }

  return params;
};

const buildListDevicesParams = (req = {}) => {
  const params = {};

  const offset = toInt64(firstDefined(req.offset, req.Offset));
  if (offset !== null && offset >= 0) {
    params.Offset = offset;
  }

  const limit = toInt64(firstDefined(req.limit, req.Limit));
  if (limit !== null && limit > 0 && limit <= MAX_LIMIT) {
    params.Limit = limit;
  } else {
    params.Limit = DEFAULT_LIMIT;
  }

  const filters = [];

  const name = toTrimmedString(firstDefined(req.name, req.Name));
  if (name) {
    filters.push({ Name: 'DeviceName', Values: [name] });
  }

  const ip = toTrimmedString(firstDefined(req.ip, req.Ip));
  if (ip) {
    filters.push({ Name: 'Ip', Values: [ip] });
  }

  if (filters.length > 0) {
    params.Filters = filters;
  }

  return params;
};

const buildListUsersParams = (req = {}) => {
  const params = {};

  const offset = toInt64(firstDefined(req.offset, req.Offset));
  if (offset !== null && offset >= 0) {
    params.Offset = offset;
  }

  const limit = toInt64(firstDefined(req.limit, req.Limit));
  if (limit !== null && limit > 0 && limit <= MAX_LIMIT) {
    params.Limit = limit;
  } else {
    params.Limit = DEFAULT_LIMIT;
  }

  const filters = [];

  const name = toTrimmedString(firstDefined(req.name, req.Name));
  if (name) {
    filters.push({ Name: 'UserName', Values: [name] });
  }

  const status = toTrimmedString(firstDefined(req.status, req.Status));
  if (status) {
    filters.push({ Name: 'Status', Values: [status] });
  }

  if (filters.length > 0) {
    params.Filters = filters;
  }

  return params;
};

// ── Response mappers ───────────────────────────────────────

const mapSessionRecord = (item) => ({
  id: String(item?.Id ?? item?.id ?? ''),
  user_name: String(item?.UserName ?? item?.user_name ?? ''),
  device_name: String(item?.DeviceName ?? item?.device_name ?? item?.Name ?? ''),
  status: String(item?.Status ?? item?.status ?? ''),
  start_time: String(item?.StartTime ?? item?.start_time ?? ''),
  end_time: String(item?.EndTime ?? item?.end_time ?? ''),
});

const mapDeviceRecord = (item) => ({
  id: String(item?.Id ?? item?.id ?? ''),
  name: String(item?.Name ?? item?.name ?? item?.DeviceName ?? ''),
  ip: String(item?.PrivateIp ?? item?.privateIp ?? item?.Ip ?? item?.ip ?? ''),
  type: String(item?.OsName ?? item?.osName ?? item?.DeviceType ?? item?.type ?? ''),
  state: String(item?.State ?? item?.state ?? ''),
  department: typeof item?.Department === 'object' && item?.Department !== null
    ? String(item.Department.Name ?? item.Department.name ?? '')
    : String(item?.Department ?? item?.department ?? ''),
});

const mapUserRecord = (item) => ({
  id: String(item?.Id ?? item?.id ?? ''),
  user_name: String(item?.UserName ?? item?.user_name ?? ''),
  real_name: String(item?.RealName ?? item?.real_name ?? ''),
  phone: String(item?.Phone ?? item?.phone ?? ''),
  email: String(item?.Email ?? item?.email ?? ''),
  status: String(item?.Status ?? item?.status ?? ''),
  department: typeof item?.Department === 'object' && item?.Department !== null
    ? String(item.Department.Name ?? item.Department.name ?? '')
    : String(item?.Department ?? item?.department ?? ''),
});

// ── API method implementations ─────────────────────────────

const listSessions = async (req = {}, ctx = {}) => {
  const params = buildListSessionsParams(req);
  const response = await callAction(ctx, 'DescribeSessions', params);
  return {
    items: (response?.SessionSet ?? response?.sessionSet ?? []).map(mapSessionRecord),
    total_count: toInt64(response?.TotalCount ?? response?.totalCount) ?? 0,
  };
};

const killSession = async (req = {}, ctx = {}) => {
  const sessionId = toTrimmedString(firstDefined(req.session_id, req.sessionId));
  if (!sessionId) {
    throw errorWithCode('INVALID_ARGUMENT', 'session_id is required');
  }
  const params = { SessionId: sessionId };
  const response = await callAction(ctx, 'KillSession', params);
  return {
    err: toValue(response?.err ?? null),
    msg: toValue(response?.msg ?? 'ok'),
  };
};

const listDevices = async (req = {}, ctx = {}) => {
  const params = buildListDevicesParams(req);
  const response = await callAction(ctx, 'DescribeDevices', params);
  return {
    items: (response?.DeviceSet ?? response?.deviceSet ?? []).map(mapDeviceRecord),
    total_count: toInt64(response?.TotalCount ?? response?.totalCount) ?? 0,
  };
};

const listUsers = async (req = {}, ctx = {}) => {
  const params = buildListUsersParams(req);
  const response = await callAction(ctx, 'DescribeUsers', params);
  return {
    items: (response?.UserSet ?? response?.userSet ?? []).map(mapUserRecord),
    total_count: toInt64(response?.TotalCount ?? response?.totalCount) ?? 0,
  };
};

const lockUser = async (req = {}, ctx = {}) => {
  const rawId = firstDefined(req.user_id, req.userId);
  const idNum = toInt64(rawId);
  if (idNum === null) {
    throw errorWithCode('INVALID_ARGUMENT', 'user_id is required and must be an integer');
  }
  const params = { IdSet: [idNum] };
  const response = await callAction(ctx, 'LockUser', params);
  return {
    err: toValue(response?.err ?? null),
    msg: toValue(response?.msg ?? 'ok'),
  };
};

const unlockUser = async (req = {}, ctx = {}) => {
  const rawId = firstDefined(req.user_id, req.userId);
  const idNum = toInt64(rawId);
  if (idNum === null) {
    throw errorWithCode('INVALID_ARGUMENT', 'user_id is required and must be an integer');
  }
  const params = { IdSet: [idNum] };
  const response = await callAction(ctx, 'UnlockUser', params);
  return {
    err: toValue(response?.err ?? null),
    msg: toValue(response?.msg ?? 'ok'),
  };
};

// ── rpcdef (filter-style handler) ──────────────────────────

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [LIST_SESSIONS_PATH]: async (req) => listSessions(req ?? callCtx.req, callCtx),
    [KILL_SESSION_PATH]: async (req) => killSession(req ?? callCtx.req, callCtx),
    [LIST_DEVICES_PATH]: async (req) => listDevices(req ?? callCtx.req, callCtx),
    [LIST_USERS_PATH]: async (req) => listUsers(req ?? callCtx.req, callCtx),
    [LOCK_USER_PATH]: async (req) => lockUser(req ?? callCtx.req, callCtx),
    [UNLOCK_USER_PATH]: async (req) => unlockUser(req ?? callCtx.req, callCtx),
  };
}

// ── SDK handlers (two-arg style) ───────────────────────────

export const handlers = {
  [LIST_SESSIONS_FULL]: (req, ctx = {}) => listSessions(req, ctx),
  [KILL_SESSION_FULL]: (req, ctx = {}) => killSession(req, ctx),
  [LIST_DEVICES_FULL]: (req, ctx = {}) => listDevices(req, ctx),
  [LIST_USERS_FULL]: (req, ctx = {}) => listUsers(req, ctx),
  [LOCK_USER_FULL]: (req, ctx = {}) => lockUser(req, ctx),
  [UNLOCK_USER_FULL]: (req, ctx = {}) => unlockUser(req, ctx),
};

// ── Test exports ───────────────────────────────────────────

export const _test = {
  tc3Sign,
  callAction,
  errorWithCode,
  firstDefined,
  hasOwn,
  logFlow,
  mergedBindings,
  resolveCallContext,
  resolveCredentials,
  resolveRegion,
  resolveEndpoint,
  resolveTimeoutMs,
  toBoolean,
  toInt64,
  toTrimmedString,
  toValue,
  buildListSessionsParams,
  buildListDevicesParams,
  buildListUsersParams,
  mapSessionRecord,
  mapDeviceRecord,
  mapUserRecord,
  listSessions,
  killSession,
  listDevices,
  listUsers,
  lockUser,
  unlockUser,
};
