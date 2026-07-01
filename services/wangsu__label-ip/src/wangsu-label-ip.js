import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const METHOD_FORBID_PATH = '/Wangsu_LabelIP.WangsuLabelIPService/BatchForbidIP';
export const METHOD_UNFORBID_PATH = '/Wangsu_LabelIP.WangsuLabelIPService/BatchUnforbidIP';
export const METHOD_FORBID_FULL = 'Wangsu_LabelIP.WangsuLabelIPService/BatchForbidIP';
export const METHOD_UNFORBID_FULL = 'Wangsu_LabelIP.WangsuLabelIPService/BatchUnforbidIP';

export const MAX_IP_PER_OP = 10000;
export const MAX_FORBID_MINUTES = 2628000;
export const MIN_FORBID_MINUTES = 1;
export const DEFAULT_TIMEOUT_MS = 5000;
export const WANGSU_TIMEZONE = 'GMT+08:00';
export const OPERATION = { FORBID: 'FORBID', UNFORBID: 'UNFORBID' };
export const OPERATION_TYPE = { FORBID: 1, UNFORBID: 2 };
export const OUTCOME = {
  SUCCESS: 'OPERATION_OUTCOME_SUCCESS',
  PARTIAL: 'OPERATION_OUTCOME_PARTIAL',
  FAILED: 'OPERATION_OUTCOME_FAILED',
};

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const engineError = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const pickString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

const pickFirstString = (values = []) => {
  for (const value of values) {
    const str = pickString(value);
    if (str) return str;
  }
  return '';
};

const toBoolean = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return Number.isNaN(raw) ? undefined : raw !== 0;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) return false;
  }
  return undefined;
};

const pickFirstBoolean = (values = []) => {
  for (const value of values) {
    const bool = toBoolean(value);
    if (bool !== undefined) return bool;
  }
  return undefined;
};

const wrapInt64 = (value) => {
  if (value === undefined || value === null) return undefined;
  return { value: String(value) };
};

const unwrapInt64 = (candidate) => {
  const raw = unwrapScalar(candidate);
  if (raw === undefined || raw === null || raw === '') return null;
  const num = Number(raw);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return null;
  return num;
};

const normalizeBaseUrl = (raw) => {
  const value = pickString(raw);
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) return null;
  return value;
};

const readIpList = (req = {}) => {
  const rawList = req.ip_list ?? req.ipList ?? req.ips;
  if (!Array.isArray(rawList)) throw engineError('INVALID_ARGUMENT', 'ip_list must be an array');
  if (rawList.length === 0) throw engineError('INVALID_ARGUMENT', 'ip_list cannot be empty');
  if (rawList.length > MAX_IP_PER_OP) throw engineError('INVALID_ARGUMENT', `ip_list exceeds limit ${MAX_IP_PER_OP}`);
  return rawList.map((item, idx) => {
    if (item === undefined || item === null) throw engineError('INVALID_ARGUMENT', `ip_list[${idx}] is empty`);
    const text = String(unwrapScalar(item) ?? '').trim();
    if (!text) throw engineError('INVALID_ARGUMENT', `ip_list[${idx}] is blank`);
    return text;
  });
};

const resolveLabelCode = (req = {}, bindings = {}) => {
  const fromReq = pickFirstString([req.label_code, req.labelCode]);
  if (fromReq) return fromReq;
  const resolved = pickFirstString([bindings.labelCode, bindings.label_code, bindings.wangsu_tag, bindings.wangsuTag]);
  if (!resolved) throw engineError('INVALID_ARGUMENT', 'label_code is required (request or bindings.labelCode)');
  return resolved;
};

const resolveBaseConfig = (bindings = {}, limits = {}) => {
  const baseUrl = normalizeBaseUrl(bindings.baseUrl ?? bindings.restBaseUrl ?? bindings.url);
  if (!baseUrl) throw engineError('INVALID_ARGUMENT', 'bindings.baseUrl/restBaseUrl/url must be http/https URL');
  const user = pickFirstString([bindings.user]);
  if (!user) throw engineError('INVALID_ARGUMENT', 'bindings.user is required');
  const apiKey = pickFirstString([bindings.apiKey, bindings.api_key]);
  if (!apiKey) throw engineError('INVALID_ARGUMENT', 'bindings.apiKey is required');
  const timeoutMs = Number(unwrapScalar(bindings.timeoutMs ?? bindings.timeout_ms ?? bindings.timeout ?? limits.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  return { baseUrl, user, apiKey, timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS };
};

const resolveDateHeader = (bindings = {}) => pickFirstString([bindings.overrideDateHeader, bindings.dateHeader]) || new Date().toUTCString();

const resolveForbidMinutes = (req = {}, bindings = {}, options = {}) => {
  const { required = false, allowDefault = true } = options;
  const fromReq = unwrapInt64(req.forbid_time_minutes ?? req.forbidTimeMinutes);
  const fallback = allowDefault ? unwrapInt64(bindings.defaultForbidMinutes ?? bindings.default_forbid_minutes) : undefined;
  const value = fromReq ?? fallback;
  if ((value === null || value === undefined) && required) {
    throw engineError('INVALID_ARGUMENT', 'forbid_time_minutes is required (request or bindings.defaultForbidMinutes)');
  }
  if (value === null || value === undefined) return undefined;
  if (value < MIN_FORBID_MINUTES) throw engineError('INVALID_ARGUMENT', `forbid_time_minutes must be >= ${MIN_FORBID_MINUTES}`);
  if (value > MAX_FORBID_MINUTES) return MAX_FORBID_MINUTES;
  return value;
};

const computePassword = (apiKey, dateHeader) => {
  if (!apiKey) throw engineError('INVALID_ARGUMENT', 'apiKey is required');
  if (!dateHeader) throw engineError('INVALID_ARGUMENT', 'Date header is required');
  return crypto.createHmac('sha1', String(apiKey)).update(String(dateHeader)).digest('base64');
};

const buildBasicAuth = (user, password) => `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`;

const sanitizeHeaders = (headers) => {
  const raw = unwrapScalar(headers);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([key]) => key).map(([key, value]) => [key, String(unwrapScalar(value) ?? '')]));
};

const buildHeaders = (bindings = {}, extra = {}) => ({
  ...sanitizeHeaders(bindings.headers),
  'Content-Type': 'application/json',
  'X-Time-Zone': WANGSU_TIMEZONE,
  ...extra,
});

const shouldSkipTls = (bindings = {}) => pickFirstBoolean([bindings.tlsInsecureSkipVerify, bindings.skipTlsVerify, bindings.tls_skip_verify]) || false;

const insecureTlsDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

const buildTlsOptions = (bindings = {}) => (shouldSkipTls(bindings) ? { dispatcher: insecureTlsDispatcher } : {});

const makeTimeoutSignal = (timeoutMs) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeoutId) };
};

const mapHttpError = (status, body) => {
  const text = body ? String(body).slice(0, 256) : '';
  if (status === 401 || status === 403) return engineError('PERMISSION_DENIED', `upstream http ${status}: ${text}`);
  if (status >= 400 && status < 500) return engineError('FAILED_PRECONDITION', `upstream http ${status}: ${text}`);
  return engineError('UNAVAILABLE', `upstream http ${status}: ${text}`);
};

const logAudit = (meta = {}, phase, payload = {}) => {
  const instance = meta.instance_id || meta.instanceId || 'unknown';
  const reqId = meta.request_id || meta.requestId || payload.requestId || 'unknown';
  const base = `[Wangsu_LabelIP][${phase}][inst=${instance}][req=${reqId}]`;
  try {
    const cloned = { ...payload };
    if (cloned.ips) {
      cloned.ip_count = cloned.ips.length;
      delete cloned.ips;
    }
    console.log(base, JSON.stringify(cloned));
  } catch {
    console.log(base, payload);
  }
};

const extractFailedIps = (data) => {
  if (!data) return [];
  const list = data.failedIpList || data.failed_ips || data.failures;
  if (!Array.isArray(list)) return [];
  return list.map((item) => String(item ?? '')).filter(Boolean);
};

const buildPayload = (operation, labelCode, ipList, forbidMinutes) => {
  const payload = {
    operationObjectList: [{ labelCode, ipList }],
    operationType: operation === OPERATION.FORBID ? OPERATION_TYPE.FORBID : OPERATION_TYPE.UNFORBID,
  };
  if (forbidMinutes !== undefined) payload.forbidTime = forbidMinutes;
  return payload;
};

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: {
    ...(ctx.config ?? {}),
    ...(ctx.secret ?? {}),
    ...(ctx.bindings ?? {}),
  },
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.request ?? ctx.req ?? {},
});

const requestFromContext = (ctx = {}) => ctx.request ?? ctx.req ?? {};

const executeOperation = async (ctx = {}, operation) => {
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings || {};
  const meta = callCtx.meta || {};
  const req = callCtx.req || {};
  const ips = readIpList(req);
  const labelCode = resolveLabelCode(req, bindings);
  const forbidMinutes = resolveForbidMinutes(req, bindings, {
    required: operation === OPERATION.FORBID,
    allowDefault: operation === OPERATION.FORBID,
  });
  const config = resolveBaseConfig(bindings, callCtx.limits);
  const dateHeader = resolveDateHeader(bindings);
  const password = computePassword(config.apiKey, dateHeader);
  const headers = buildHeaders(bindings, {
    Authorization: buildBasicAuth(config.user, password),
    Date: dateHeader,
    'X-Wangsu-User': config.user,
  });
  const payload = buildPayload(operation, labelCode, ips, forbidMinutes);
  logAudit(meta, 'request', { operation, labelCode, forbidMinutes, ipCount: ips.length, requestId: req.request_id || req.requestId || '' });

  const timeout = makeTimeoutSignal(config.timeoutMs);
  const options = {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: timeout.signal,
    ...buildTlsOptions(bindings),
  };

  let response;
  try {
    response = await fetch(config.baseUrl, options);
  } catch (err) {
    logAudit(meta, 'error', { operation, reason: err?.message || 'fetch failed' });
    throw engineError('UNAVAILABLE', err?.message || 'fetch failed');
  } finally {
    timeout.clear();
  }
  const text = await response.text();
  if (!response.ok) {
    const mapped = mapHttpError(response.status, text);
    logAudit(meta, 'error', { operation, httpStatus: response.status, message: text.slice(0, 256) });
    throw mapped;
  }
  if (!text.trim()) {
    logAudit(meta, 'error', { operation, reason: 'empty response' });
    throw engineError('UNKNOWN', 'response body is empty');
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    logAudit(meta, 'error', { operation, reason: 'invalid json' });
    throw engineError('UNKNOWN', 'response is not valid JSON');
  }

  const upstreamCode = String(json?.code ?? '');
  const upstreamMessage = String(json?.message ?? json?.msg ?? '');
  if (upstreamCode !== '0') {
    logAudit(meta, 'error', { operation, upstreamCode, upstreamMessage });
    throw engineError('FAILED_PRECONDITION', `wangsu error code=${upstreamCode || 'unknown'} message=${upstreamMessage || 'unknown'}`);
  }

  const failedIps = extractFailedIps(json?.data);
  const responseBody = {
    outcome: failedIps.length > 0 ? OUTCOME.PARTIAL : OUTCOME.SUCCESS,
    upstream_code: upstreamCode,
    upstream_message: upstreamMessage,
    requested_ip_count: ips.length,
    failed_ips: failedIps,
    label_code: labelCode,
    forbid_time_minutes: wrapInt64(forbidMinutes),
    audit: {
      engine_instance_id: meta.instance_id || meta.instanceId || '',
      request_id: req.request_id || req.requestId || '',
      operation_type: operation,
      ip_count: ips.length,
    },
  };
  logAudit(meta, 'success', { operation, ipCount: ips.length, failed: failedIps.length, upstreamCode });
  return responseBody;
};

const runOperation = (req = {}, ctx = {}, operation) => {
  const request = { ...requestFromContext(ctx), ...(req || {}) };
  return executeOperation({ ...ctx, req: request, request }, operation);
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_FORBID_PATH]: async (req) => runOperation(req ?? callCtx.req ?? {}, callCtx, OPERATION.FORBID),
    [METHOD_UNFORBID_PATH]: async (req) => runOperation(req ?? callCtx.req ?? {}, callCtx, OPERATION.UNFORBID),
  };
}

export const handlers = {
  [METHOD_FORBID_FULL]: (ctx = {}) => runOperation(requestFromContext(ctx), ctx, OPERATION.FORBID),
  [METHOD_UNFORBID_FULL]: (ctx = {}) => runOperation(requestFromContext(ctx), ctx, OPERATION.UNFORBID),
};

export const _test = {
  buildBasicAuth,
  buildHeaders,
  buildPayload,
  buildTlsOptions,
  computePassword,
  engineError,
  executeOperation,
  extractFailedIps,
  grpcCodeFor,
  hasOwn,
  insecureTlsDispatcher,
  logAudit,
  makeTimeoutSignal,
  mapHttpError,
  normalizeBaseUrl,
  pickFirstBoolean,
  pickFirstString,
  pickString,
  readIpList,
  resolveBaseConfig,
  resolveCallContext,
  resolveDateHeader,
  resolveForbidMinutes,
  resolveLabelCode,
  sanitizeHeaders,
  shouldSkipTls,
  toBoolean,
  unwrapInt64,
  unwrapScalar,
  wrapInt64,
};
