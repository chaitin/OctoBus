import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const METHOD_BATCH_BLOCK_PATH = '/SKYCloud_INET.SKYCloud_INET/BatchBlockIP';
export const METHOD_BATCH_UNBLOCK_PATH = '/SKYCloud_INET.SKYCloud_INET/BatchUnblockIP';
export const METHOD_BATCH_BLOCK_FULL = 'SKYCloud_INET.SKYCloud_INET/BatchBlockIP';
export const METHOD_BATCH_UNBLOCK_FULL = 'SKYCloud_INET.SKYCloud_INET/BatchUnblockIP';

export const LOGIN_ENDPOINT = '/api/sky-platform/auth/user/login';
export const ENVIRONMENT_ENDPOINT = '/api/sky-policyinsight/blocker/v2/environment/getAll';
export const WORK_ORDER_ENDPOINT = '/api/sky-policyinsight/blocker/v2';
export const MAX_BATCH_SIZE = 300;
export const DEFAULT_TIMEOUT_MS = 1500;
export const DEFAULT_DIRECTION = 'BOTH';
export const DEFAULT_NAME_PREFIX = 'SKYCloud iNet';

const SERVICE_NAME = 'SKYCloud_INET';
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6_RE = /^(([0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|([0-9A-Fa-f]{1,4}:){1,7}:|([0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}|([0-9A-Fa-f]{1,4}:){1,5}(:[0-9A-Fa-f]{1,4}){1,2}|([0-9A-Fa-f]{1,4}:){1,4}(:[0-9A-Fa-f]{1,4}){1,3}|([0-9A-Fa-f]{1,4}:){1,3}(:[0-9A-Fa-f]{1,4}){1,4}|([0-9A-Fa-f]{1,4}:){1,2}(:[0-9A-Fa-f]{1,4}){1,5}|[0-9A-Fa-f]{1,4}:((:[0-9A-Fa-f]{1,4}){1,6})|:((:[0-9A-Fa-f]{1,4}){1,7}|:)|fe80:(:[0-9A-Fa-f]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9])?[0-9])|([0-9A-Fa-f]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9])?[0-9]))$/;

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
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

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

const unwrapString = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrapString(value.value);
  return String(value).trim();
};

const unwrapList = (value) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    if (Array.isArray(value.values)) return value.values;
    if (Array.isArray(value.list)) return value.list;
    if (Array.isArray(value.items)) return value.items;
  }
  return [];
};

const toBoolean = (value) => {
  const raw = value && typeof value === 'object' && hasOwn(value, 'value') ? value.value : value;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw !== 0;
  if (typeof raw === 'string') {
    const text = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'n', 'off', ''].includes(text)) return false;
  }
  return false;
};

const normalizeBaseUrl = (value, allowHttp = false) => {
  const trimmed = unwrapString(value);
  if (!trimmed) return '';
  if (/^https:\/\//i.test(trimmed)) return trimmed.replace(/\/+$/, '');
  if (allowHttp && /^http:\/\//i.test(trimmed)) return trimmed.replace(/\/+$/, '');
  return '';
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx.config ?? {}),
  ...(ctx.bindings ?? {}),
  ...(ctx.secret ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.request ?? ctx.req ?? {},
});

const requestFromContext = (ctx = {}) => ctx.request ?? ctx.req ?? {};

const optionalUint32 = (value) => {
  const raw = value && typeof value === 'object' && hasOwn(value, 'value') ? value.value : value;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return Math.trunc(num);
};

const resolveTimeoutMs = (ctx = {}) => firstDefined(
  optionalUint32(ctx.limits?.timeoutMs),
  optionalUint32(ctx.bindings?.timeoutMs),
  DEFAULT_TIMEOUT_MS,
);

let insecureTlsDispatcher;

const getInsecureTlsDispatcher = () => {
  insecureTlsDispatcher ??= new Agent({ connect: { rejectUnauthorized: false } });
  return insecureTlsDispatcher;
};

const buildTlsOptions = (bindings = {}) => {
  if (!toBoolean(bindings.skipTlsVerify) && !toBoolean(bindings.tlsInsecureSkipVerify) && !toBoolean(bindings.insecureSkipVerify)) return {};
  return { dispatcher: getInsecureTlsDispatcher() };
};

const buildHeaders = (ctx = {}, extra = {}) => {
  const bindings = ctx.bindings || {};
  const meta = ctx.meta || {};
  const customHeaders = bindings.headers && typeof bindings.headers === 'object' ? bindings.headers : {};
  return {
    ...customHeaders,
    'x-engine-instance': meta.instance_id || meta.instanceId || 'unknown',
    'x-request-id': meta.request_id || meta.requestId || 'unknown',
    ...extra,
  };
};

const mapHttpError = (stage, status, text) => {
  const excerpt = String(text || '').length > 256 ? `${String(text).slice(0, 256)}...` : String(text || '');
  if (status === 401) return errorWithCode('UNAUTHENTICATED', `${stage} unauthorized (${status})`);
  if (status === 403) return errorWithCode('PERMISSION_DENIED', `${stage} forbidden (${status})`);
  if (status >= 400 && status < 500) return errorWithCode('FAILED_PRECONDITION', `${stage} upstream http ${status}: ${excerpt}`);
  return errorWithCode('UNAVAILABLE', `${stage} upstream http ${status}: ${excerpt}`);
};

const parseJsonOrThrow = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', 'response is not valid JSON');
  }
};

const httpPostJson = async (ctx, url, body, opts = {}) => {
  const timeoutMs = resolveTimeoutMs(ctx);
  const started = Date.now();
  const headers = buildHeaders(ctx, {
    'content-type': 'application/json',
    ...(opts.cookie ? { cookie: opts.cookie } : {}),
    ...(opts.headers || {}),
  });
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(timeoutMs),
      ...buildTlsOptions(ctx.bindings),
    });
  } catch (err) {
    if (typeof opts.logCall === 'function') opts.logCall({ stage: opts.stage || 'http-post', status: 'network_error', elapsedMs: Date.now() - started });
    throw errorWithCode('UNAVAILABLE', err?.message || 'fetch failed');
  }
  const elapsedMs = Date.now() - started;
  if (typeof opts.logCall === 'function') opts.logCall({ stage: opts.stage || 'http-post', status: res.status, elapsedMs });
  const text = await res.text();
  if (!res.ok) throw mapHttpError(opts.stage || 'http-post', res.status, text);
  if (!unwrapString(text)) throw errorWithCode('UNKNOWN', 'response body is empty');
  return { json: parseJsonOrThrow(text), text, status: res.status, elapsedMs };
};

const requireHost = (ctx = {}) => {
  const bindings = ctx.bindings || {};
  const rawHost = firstDefined(bindings.host, bindings.restBaseUrl, bindings.baseUrl);
  const allowHttp = toBoolean(bindings.allowHttpBaseUrl) || toBoolean(bindings.allowHttpHost) || toBoolean(bindings.allowHttpUrl);
  const host = normalizeBaseUrl(rawHost, allowHttp);
  if (!host) throw errorWithCode('INVALID_ARGUMENT', 'host/restBaseUrl must be an https URL');
  return host;
};

const requireUsername = (ctx = {}) => {
  const bindings = ctx.bindings || {};
  const username = unwrapString(firstDefined(bindings.username, bindings.user));
  if (!username) throw errorWithCode('INVALID_ARGUMENT', 'username is required');
  return username;
};

const requirePassword = (ctx = {}) => {
  const bindings = ctx.bindings || {};
  const password = unwrapString(firstDefined(bindings.password));
  if (!password) throw errorWithCode('INVALID_ARGUMENT', 'password is required');
  return password;
};

const requireEnvironmentName = (ctx = {}) => {
  const req = ctx.req || {};
  const environmentName = unwrapString(firstDefined(req.environment_name, req.environmentName));
  if (!environmentName) throw errorWithCode('INVALID_ARGUMENT', 'environment_name is required');
  return environmentName;
};

const isIPv4 = (value) => IPV4_RE.test(String(value || ''));
const isIPv6 = (value) => IPV6_RE.test(String(value || ''));
const isIpAddress = (value) => isIPv4(value) || isIPv6(value);

const normalizeIpDirectives = (ctx = {}) => {
  const req = ctx.req || {};
  const rawList = unwrapList(firstDefined(req.ip_directives, req.ipDirectives));
  const directives = rawList.map((entry, index) => {
    if (typeof entry === 'string') return { index, ip: unwrapString(entry), description: '' };
    if (entry && typeof entry === 'object') {
      return {
        index,
        ip: unwrapString(firstDefined(entry.ip, entry.value, entry.address)),
        description: unwrapString(firstDefined(entry.description, entry.remark, entry.note)),
      };
    }
    return { index, ip: '', description: '' };
  });
  const results = directives.map((item) => ({ ip: item.ip, success: false, error_message: '', work_order_ids: [], batch_token: '' }));
  const validEntries = [];
  for (let i = 0; i < directives.length; i += 1) {
    const directive = directives[i];
    const ip = unwrapString(directive.ip);
    results[i].ip = ip;
    if (!ip) {
      results[i].error_message = 'ip is required';
      continue;
    }
    if (!isIpAddress(ip)) {
      results[i].error_message = 'ip must be IPv4 or IPv6 address';
      continue;
    }
    validEntries.push({ ip, description: directive.description, resultRef: results[i] });
  }
  return { validEntries, results };
};

const buildDefaultTicketName = (type, environmentName, workflowName, batchIndex) => {
  const action = type === 'UN_BLOCKER' ? 'Unblock' : 'Block';
  const workflow = workflowName ? `[${workflowName}]` : '';
  const suffix = typeof batchIndex === 'number' ? `#${batchIndex + 1}` : '';
  return `${DEFAULT_NAME_PREFIX} ${action} ${environmentName}${workflow ? ` ${workflow}` : ''}${suffix}`.trim();
};

const buildDefaultTicketDescription = (type, environmentName, ipCount, context = {}) => {
  const action = type === 'UN_BLOCKER' ? 'Unblock' : 'Block';
  const workflow = context.workflow_name || context.workflowName || '';
  const operator = context.operator || '';
  const base = `${action} ${ipCount} IPs under environment ${environmentName}`;
  const extras = [workflow && `workflow=${workflow}`, operator && `operator=${operator}`].filter(Boolean).join(' ');
  return extras ? `${base} ${extras}` : base;
};

const resolveDirection = (ctx = {}) => {
  const req = ctx.req || {};
  const bindings = ctx.bindings || {};
  const template = req.ticket_template || req.ticketTemplate || {};
  return unwrapString(firstDefined(template.direction, req.direction, bindings.direction, bindings.defaultDirection, DEFAULT_DIRECTION)) || DEFAULT_DIRECTION;
};

const buildIpValues = (batchEntries, template = {}) => {
  const prefix = unwrapString(template.ip_description_prefix ?? template.ipDescriptionPrefix);
  return batchEntries.map((entry) => {
    const description = [prefix, entry.description].filter(Boolean).join(' ').trim();
    return description ? { ip: entry.ip, description } : { ip: entry.ip };
  });
};

const chunkEntries = (entries, size) => {
  const batches = [];
  for (let i = 0; i < entries.length; i += size) batches.push(entries.slice(i, i + size));
  return batches;
};

const extractWorkOrderId = (data) => {
  if (!data && data !== 0) return '';
  if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') return String(data);
  if (typeof data === 'object') return unwrapString(firstDefined(data.work_order_id, data.workOrderId, data.id, data.ticketId, data.orderId, data.uuid));
  return '';
};

const ensureBusinessSuccess = (stage, payload) => {
  const code = Number(payload?.code);
  if (!Number.isFinite(code) || code !== 200) {
    const message = unwrapString(payload?.message || payload?.msg || payload?.error || payload?.err);
    throw errorWithCode('FAILED_PRECONDITION', `${stage} failed: ${message || 'unexpected response'}`);
  }
  if (payload.data === undefined || payload.data === null || payload.data === '') throw errorWithCode('FAILED_PRECONDITION', `${stage} returned empty data`);
};

const loginSkyCloud = async (ctx, host, username, password, logCall) => {
  const { json } = await httpPostJson(ctx, `${host}${LOGIN_ENDPOINT}`, { username, password }, { stage: 'login', logCall });
  ensureBusinessSuccess('login', json);
  const token = unwrapString(firstDefined(json.data?.access_token, json.data?.accessToken, json.data?.token, json.data?.accessTokenValue, json.data?.value));
  if (!token) throw errorWithCode('UNAUTHENTICATED', 'login succeeded but access token missing');
  return token;
};

const resolveEnvironmentId = async (ctx, host, token, environmentName, logCall) => {
  const { json } = await httpPostJson(ctx, `${host}${ENVIRONMENT_ENDPOINT}`, { name: environmentName }, { stage: 'environment', cookie: `access_token=${token}`, logCall });
  ensureBusinessSuccess('environment query', json);
  const pool = Array.isArray(json.data) ? json.data : Array.isArray(json.data?.items) ? json.data.items : Array.isArray(json.data?.list) ? json.data.list : [];
  const match = pool.find((item) => unwrapString(item?.name) === environmentName);
  if (!match) throw errorWithCode('FAILED_PRECONDITION', `environment ${environmentName} not found`);
  const id = unwrapString(firstDefined(match.id, match.environmentId, match.uuid));
  if (!id) throw errorWithCode('FAILED_PRECONDITION', `environment ${environmentName} missing id`);
  return { id, raw: match };
};

const createWorkOrder = async (ctx, host, token, environmentId, batchEntries, batchIndex, type, logCall) => {
  const req = ctx.req || {};
  const template = req.ticket_template || req.ticketTemplate || {};
  const context = req.context || {};
  const direction = resolveDirection(ctx);
  const environmentName = req.environment_name || req.environmentName || '';
  const name = unwrapString(template.name) || buildDefaultTicketName(type, environmentName, context.workflow_name || context.workflowName, batchIndex);
  const description = unwrapString(template.description) || buildDefaultTicketDescription(type, environmentName, batchEntries.length, context);
  const payload = { name, description, direction, environmentId, ipValues: buildIpValues(batchEntries, template), type };
  const { json } = await httpPostJson(ctx, `${host}${WORK_ORDER_ENDPOINT}`, payload, { stage: type === 'UN_BLOCKER' ? 'unblock' : 'block', cookie: `access_token=${token}`, logCall });
  ensureBusinessSuccess('work order', json);
  const workOrderId = extractWorkOrderId(json.data);
  if (!workOrderId) throw errorWithCode('FAILED_PRECONDITION', 'work order response missing id');
  return { workOrderId, payload };
};

const createLogCollector = (ctx = {}, operation, environmentName) => {
  const httpCalls = [];
  const logCall = (entry) => {
    httpCalls.push({ stage: entry.stage, status: entry.status, elapsed_ms: entry.elapsedMs });
  };
  const emit = (summary) => {
    const meta = ctx.meta || {};
    const logEntry = {
      service: SERVICE_NAME,
      operation,
      environment: environmentName,
      total_ip_count: summary.totalIps,
      valid_ip_count: summary.validIps,
      invalid_ip_count: summary.invalidIps,
      work_order_count: summary.workOrders.length,
      work_orders: summary.workOrders,
      http_calls: httpCalls,
      duration_ms: summary.durationMs,
      success: !summary.error,
      error: summary.error || undefined,
      instance: meta.instance_id || meta.instanceId,
      request_id: meta.request_id || meta.requestId,
    };
    try {
      console.log('[SKYCloud_INET]', JSON.stringify(logEntry));
    } catch {
      console.log('[SKYCloud_INET]', logEntry);
    }
  };
  return { logCall, emit };
};

const handleBatchOperation = async (ctx, type) => {
  const callCtx = resolveCallContext(ctx);
  const started = Date.now();
  const environmentName = requireEnvironmentName(callCtx);
  const host = requireHost(callCtx);
  const username = requireUsername(callCtx);
  const password = requirePassword(callCtx);
  const { validEntries, results } = normalizeIpDirectives(callCtx);
  const collector = createLogCollector(callCtx, type, environmentName);
  if (results.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'ip_directives is required');
  const summary = {
    totalIps: results.length,
    validIps: validEntries.length,
    invalidIps: results.filter((result) => !result.success && result.error_message).length,
    workOrders: [],
    durationMs: 0,
    error: null,
  };
  if (validEntries.length === 0) {
    summary.durationMs = Date.now() - started;
    collector.emit(summary);
    return { results, work_orders: [] };
  }
  try {
    const token = await loginSkyCloud(callCtx, host, username, password, collector.logCall);
    const { id: environmentId } = await resolveEnvironmentId(callCtx, host, token, environmentName, collector.logCall);
    const workOrders = [];
    const batches = chunkEntries(validEntries, MAX_BATCH_SIZE);
    for (let i = 0; i < batches.length; i += 1) {
      const batchEntries = batches[i];
      const { workOrderId, payload } = await createWorkOrder(callCtx, host, token, environmentId, batchEntries, i, type, collector.logCall);
      workOrders.push({ work_order_id: workOrderId, type, environment_id: environmentId, ip_count: batchEntries.length, name: payload.name, batch_index: i, attributes: { direction: payload.direction } });
      batchEntries.forEach((entry) => {
        entry.resultRef.success = true;
        entry.resultRef.error_message = '';
        entry.resultRef.work_order_ids = [workOrderId];
        entry.resultRef.batch_token = `batch-${i}`;
      });
    }
    summary.workOrders = workOrders;
    summary.durationMs = Date.now() - started;
    collector.emit(summary);
    return { results, work_orders: workOrders };
  } catch (err) {
    summary.error = err?.message || String(err);
    summary.durationMs = Date.now() - started;
    collector.emit(summary);
    throw err;
  }
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_BATCH_BLOCK_PATH]: async (req) => handleBatchOperation({ ...callCtx, req: req ?? callCtx.req ?? {}, request: req ?? callCtx.req ?? {} }, 'BLOCKER'),
    [METHOD_BATCH_UNBLOCK_PATH]: async (req) => handleBatchOperation({ ...callCtx, req: req ?? callCtx.req ?? {}, request: req ?? callCtx.req ?? {} }, 'UN_BLOCKER'),
  };
}

export const handlers = {
  [METHOD_BATCH_BLOCK_FULL]: (ctx = {}) => handleBatchOperation({ ...ctx, request: requestFromContext(ctx) }, 'BLOCKER'),
  [METHOD_BATCH_UNBLOCK_FULL]: (ctx = {}) => handleBatchOperation({ ...ctx, request: requestFromContext(ctx) }, 'UN_BLOCKER'),
};

export const _test = {
  buildDefaultTicketDescription,
  buildDefaultTicketName,
  buildHeaders,
  buildIpValues,
  buildTlsOptions,
  chunkEntries,
  createLogCollector,
  createWorkOrder,
  ensureBusinessSuccess,
  errorWithCode,
  extractWorkOrderId,
  firstDefined,
  handleBatchOperation,
  hasOwn,
  httpPostJson,
  isIPv4,
  isIPv6,
  isIpAddress,
  loginSkyCloud,
  mapHttpError,
  normalizeBaseUrl,
  normalizeIpDirectives,
  optionalUint32,
  parseJsonOrThrow,
  requireEnvironmentName,
  requireHost,
  requirePassword,
  requireUsername,
  resolveCallContext,
  resolveDirection,
  resolveEnvironmentId,
  resolveTimeoutMs,
  toBoolean,
  unwrapList,
  unwrapString,
};
