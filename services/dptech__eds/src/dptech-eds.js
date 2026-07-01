import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const IPV4_REGEX = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6_REGEX = /^(([0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|([0-9A-Fa-f]{1,4}:){1,7}:|([0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}|([0-9A-Fa-f]{1,4}:){1,5}(:[0-9A-Fa-f]{1,4}){1,2}|([0-9A-Fa-f]{1,4}:){1,4}(:[0-9A-Fa-f]{1,4}){1,3}|([0-9A-Fa-f]{1,4}:){1,3}(:[0-9A-Fa-f]{1,4}){1,4}|([0-9A-Fa-f]{1,4}:){1,2}(:[0-9A-Fa-f]{1,4}){1,5}|[0-9A-Fa-f]{1,4}:((:[0-9A-Fa-f]{1,4}){1,6})|:((:[0-9A-Fa-f]{1,4}){1,7}|:)|fe80:(:[0-9A-Fa-f]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9])?[0-9])|([0-9A-Fa-f]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9])?[0-9]))$/;

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const textEncoder = typeof TextEncoder === 'function' ? new TextEncoder() : null;

export const METHOD_BLOCK = '/DPtech_EDS.DPtech_EDS/BatchBlockIPs';
export const METHOD_UNBLOCK = '/DPtech_EDS.DPtech_EDS/BatchUnblockIPs';
export const METHOD_BLOCK_FULL = 'DPtech_EDS.DPtech_EDS/BatchBlockIPs';
export const METHOD_UNBLOCK_FULL = 'DPtech_EDS.DPtech_EDS/BatchUnblockIPs';

export const DPTECH_IPV4_PATH = '/func/web_main/api/maf/maf_addrfilter/maf_addrfilter/mafcustomv4wblist';
export const DPTECH_IPV6_PATH = '/func/web_main/api/maf/maf_addrfilter/maf_addrfilter/mafcustomv6wblist';
export const DEFAULT_TIMEOUT_MS = 5000;
export const JSON_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json; charset=utf-8',
};

export const OPERATION_KIND = {
  BLOCK: 'OPERATION_KIND_BLOCK',
  UNBLOCK: 'OPERATION_KIND_UNBLOCK',
};

export const IP_FAMILY = {
  UNSPECIFIED: 'IP_FAMILY_UNSPECIFIED',
  IPV4: 'IP_FAMILY_IPV4',
  IPV6: 'IP_FAMILY_IPV6',
};

export const TASK_STATUS = {
  SUCCESS: 'IP_TASK_STATUS_SUCCESS',
  FAILED: 'IP_TASK_STATUS_FAILED',
};

export const FAILURE_CATEGORY = {
  NONE: 'FAILURE_CATEGORY_NONE',
  INVALID_IP: 'FAILURE_CATEGORY_INVALID_IP',
  DEVICE_REJECTED: 'FAILURE_CATEGORY_DEVICE_REJECTED',
  UNAUTHORIZED: 'FAILURE_CATEGORY_UNAUTHORIZED',
  UPSTREAM_UNAVAILABLE: 'FAILURE_CATEGORY_UPSTREAM_UNAVAILABLE',
  RESPONSE_REJECTED: 'FAILURE_CATEGORY_RESPONSE_REJECTED',
};
let insecureDispatcherPromise;

const NOT_FOUND_REGEX = /(not\s*(found|exist)|不存在)/i;

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const firstDefined = (...vals) => vals.find((val) => val !== undefined && val !== null);

const coerceString = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object' && hasOwn(value, 'value')) {
    return String(value.value ?? '');
  }
  return String(value);
};

const readRepeatedStrings = (candidate) => {
  if (candidate === undefined || candidate === null) return [];
  if (Array.isArray(candidate)) return candidate.map(coerceString);
  if (typeof candidate === 'object' && Array.isArray(candidate.values)) {
    return candidate.values.map(coerceString);
  }
  return [];
};

const readRepeatedMessages = (candidate) => {
  if (candidate === undefined || candidate === null) return [];
  if (Array.isArray(candidate)) return candidate;
  if (typeof candidate === 'object' && Array.isArray(candidate.values)) {
    return candidate.values;
  }
  return [];
};

const pickStringField = (obj, keys) => {
  for (const key of keys) {
    if (obj && hasOwn(obj, key)) {
      const val = obj[key];
      if (val === undefined || val === null) return '';
      return coerceString(val).trim();
    }
  }
  return '';
};

const normalizeBaseUrl = (raw) => {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  if (!/^https?:\/\//i.test(trimmed)) return '';
  return trimmed.replace(/\/$/, '');
};

const resolveBindingString = (bindings, keys) => {
  for (const key of keys) {
    if (bindings && hasOwn(bindings, key)) {
      const val = bindings[key];
      if (val === undefined || val === null) continue;
      const asString = coerceString(val).trim();
      if (asString) return asString;
    }
  }
  return '';
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.secret ?? {}),
  ...(ctx?.bindings ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.req ?? ctx.request ?? {},
});

const createLogger = (meta) => (phase, details) => {
  const instanceId = meta?.instance_id || meta?.instanceId;
  const requestId = meta?.request_id || meta?.requestId;
  const prefixParts = ['DPtech_EDS', phase];
  if (instanceId) prefixParts.push(`inst=${instanceId}`);
  if (requestId) prefixParts.push(`req=${requestId}`);
  const prefix = `[${prefixParts.join(' ')}]`;
  try {
    console.log(prefix, JSON.stringify(details));
  } catch {
    console.log(prefix, details);
  }
};

const encodeUtf8 = (value, options = {}) => {
  const input = String(value ?? '');
  if (!options.forceFallback && textEncoder) return textEncoder.encode(input);
  const bytes = [];
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6));
      bytes.push(0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12));
      bytes.push(0x80 | ((code >> 6) & 0x3f));
      bytes.push(0x80 | (code & 0x3f));
    }
  }
  return Uint8Array.from(bytes);
};

const toBase64 = (bytes) => {
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const hasB2 = i + 1 < bytes.length;
    const b2 = hasB2 ? bytes[i + 1] : 0;
    const hasB3 = i + 2 < bytes.length;
    const b3 = hasB3 ? bytes[i + 2] : 0;
    const triple = ((b1 << 16) | (b2 << 8) | b3) >>> 0;
    output += BASE64_ALPHABET[(triple >> 18) & 63];
    output += BASE64_ALPHABET[(triple >> 12) & 63];
    output += hasB2 ? BASE64_ALPHABET[(triple >> 6) & 63] : '=';
    output += hasB3 ? BASE64_ALPHABET[triple & 63] : '=';
  }
  return output;
};

const detectIpVersion = (value) => {
  if (!value) return 0;
  if (IPV4_REGEX.test(value)) return 4;
  if (IPV6_REGEX.test(value)) return 6;
  return 0;
};

const classifyIpList = (ips) => {
  const buckets = { ipv4: [], ipv6: [], invalid: [] };
  ips.forEach((raw, index) => {
    const trimmed = coerceString(raw).trim();
    if (!trimmed) {
      buckets.invalid.push({ ip: '', order: index });
      return;
    }
    const version = detectIpVersion(trimmed);
    if (version === 4) {
      buckets.ipv4.push({ ip: trimmed, order: index });
      return;
    }
    if (version === 6) {
      buckets.ipv6.push({ ip: trimmed, order: index });
      return;
    }
    buckets.invalid.push({ ip: trimmed, order: index });
  });
  const sortByOrder = (a, b) => a.order - b.order;
  buckets.ipv4.sort(sortByOrder);
  buckets.ipv6.sort(sortByOrder);
  buckets.invalid.sort(sortByOrder);
  return buckets;
};

const buildIpv4BlockBody = (groupName, ip) => ({
  mafcustomv4wblist: {
    GroupStr: groupName,
    IPStart: ip,
    IPEnd: ip,
    LeftAge: '-1',
    Action: '2',
    CheckLib: '0',
  },
});

const buildIpv6BlockBody = (groupName, ip) => ({
  mafcustomv6wblist: {
    GroupStr: groupName,
    IP: ip,
    LeftAge: '-1',
    Action: '2',
    CheckLib: '0',
  },
});

const buildIpv4DeleteBody = (ip) => ({
  mafcustomv4wblist: {
    IPaddr: ip,
  },
});

const buildIpv6DeleteBody = (ip) => ({
  mafcustomv6wblist: {
    IP: ip,
  },
});

const isNotFoundMessage = (msg) => {
  if (!msg) return false;
  return NOT_FOUND_REGEX.test(String(msg));
};

const summarizeGroups = (results) => {
  const stats = new Map();
  results.forEach((res) => {
    const key = res.address_group || '<unknown>';
    const entry = stats.get(key) || {
      address_group: key,
      total_ip_count: 0,
      success_ip_count: 0,
      failure_ip_count: 0,
    };
    entry.total_ip_count += 1;
    if (res.status === TASK_STATUS.SUCCESS) {
      entry.success_ip_count += 1;
    } else {
      entry.failure_ip_count += 1;
    }
    stats.set(key, entry);
  });
  return Array.from(stats.values());
};

const buildHeaders = ({ authHeader, extraHeaders, meta, requestId }) => ({
  ...(extraHeaders || {}),
  ...JSON_HEADERS,
  Authorization: authHeader,
  'x-engine-instance': meta?.instance_id || meta?.instanceId || 'unknown',
  'x-request-id': meta?.request_id || meta?.requestId || requestId || 'unknown',
});

const normalizeTimeoutMs = (raw) => {
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? num : DEFAULT_TIMEOUT_MS;
};

const createTlsDispatcher = async (skipTlsVerify) => {
  if (!skipTlsVerify) return undefined;
  insecureDispatcherPromise ??= import('undici').then(({ Agent }) => new Agent({
    connect: { rejectUnauthorized: false },
  }));
  return insecureDispatcherPromise;
};

const fetchWithTimeout = async (url, init = {}, options = {}) => {
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  const controller = new AbortController();
  const parentSignal = init.signal;
  const abortFromParent = () => controller.abort(parentSignal.reason);
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else if (typeof parentSignal.addEventListener === 'function') {
      parentSignal.addEventListener('abort', abortFromParent, { once: true });
    }
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const dispatcher = await createTlsDispatcher(options.skipTlsVerify);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
    });
  } finally {
    clearTimeout(timer);
    if (parentSignal && typeof parentSignal.removeEventListener === 'function') {
      parentSignal.removeEventListener('abort', abortFromParent);
    }
  }
};

const fetchDptech = async (config, request, log) => {
  const url = `${config.baseUrl}${request.path}`;
  const bodyString = request.body ? JSON.stringify(request.body) : undefined;
  const headers = buildHeaders({
    authHeader: config.authHeader,
    extraHeaders: config.extraHeaders,
    meta: config.meta,
    requestId: config.requestId,
  });
  const options = {
    method: request.method,
    headers,
    body: bodyString,
  };

  log('request', {
    operation: request.operation,
    path: request.path,
    ip: request.ip,
    addressGroup: request.addressGroup,
    method: request.method,
    url,
    host: config.baseUrl,
  });

  let res;
  try {
    res = await fetchWithTimeout(url, options, {
      timeoutMs: config.timeoutMs,
      skipTlsVerify: config.skipTlsVerify,
    });
  } catch (err) {
    const reason = err?.message || 'fetch failed';
    log('failure', {
      operation: request.operation,
      ip: request.ip,
      addressGroup: request.addressGroup,
      url,
      host: config.baseUrl,
      reason,
      stage: 'network',
      requestBody: bodyString,
    });
    return {
      success: false,
      httpStatus: 0,
      category: FAILURE_CATEGORY.UPSTREAM_UNAVAILABLE,
      message: reason,
      raw: null,
      requestBody: bodyString,
    };
  }

  const httpStatus = res.status || 0;
  const text = await res.text();
  const contentType = typeof res.headers?.get === 'function'
    ? res.headers.get('content-type') || ''
    : res.headers?.['content-type'] || '';

  if (httpStatus !== 200) {
    const category = httpStatus === 401 || httpStatus === 403
      ? FAILURE_CATEGORY.UNAUTHORIZED
      : httpStatus >= 500
        ? FAILURE_CATEGORY.UPSTREAM_UNAVAILABLE
        : FAILURE_CATEGORY.DEVICE_REJECTED;
    const snippet = text?.slice(0, 512) || '';
    log('failure', {
      operation: request.operation,
      ip: request.ip,
      addressGroup: request.addressGroup,
      url,
      host: config.baseUrl,
      httpStatus,
      requestBody: bodyString,
      response: snippet,
    });
    return {
      success: false,
      httpStatus,
      category,
      message: snippet || `http ${httpStatus}`,
      raw: null,
      requestBody: bodyString,
    };
  }

  if (!text || !text.trim()) {
    log('failure', {
      operation: request.operation,
      ip: request.ip,
      addressGroup: request.addressGroup,
      url,
      host: config.baseUrl,
      httpStatus,
      reason: 'empty response',
      requestBody: bodyString,
      response: '',
    });
    return {
      success: false,
      httpStatus,
      category: FAILURE_CATEGORY.RESPONSE_REJECTED,
      message: 'response body is empty',
      raw: null,
      requestBody: bodyString,
    };
  }

  if (contentType && !contentType.toLowerCase().includes('application/json')) {
    // Some devices omit or mis-set content-type while still returning JSON.
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    log('failure', {
      operation: request.operation,
      ip: request.ip,
      addressGroup: request.addressGroup,
      url,
      host: config.baseUrl,
      httpStatus,
      reason: 'invalid json',
      requestBody: bodyString,
      response: text?.slice(0, 512) || '',
    });
    return {
      success: false,
      httpStatus,
      category: FAILURE_CATEGORY.RESPONSE_REJECTED,
      message: 'response is not valid JSON',
      raw: null,
      requestBody: bodyString,
    };
  }

  if (!json || typeof json !== 'object') {
    log('failure', {
      operation: request.operation,
      ip: request.ip,
      addressGroup: request.addressGroup,
      url,
      host: config.baseUrl,
      httpStatus,
      reason: 'response is not object',
      requestBody: bodyString,
      response: text?.slice(0, 512) || '',
    });
    return {
      success: false,
      httpStatus,
      category: FAILURE_CATEGORY.RESPONSE_REJECTED,
      message: 'response is not an object',
      raw: null,
      requestBody: bodyString,
    };
  }

  if (hasOwn(json, 'error')) {
    const errVal = json.error;
    const msg = errVal === undefined || errVal === null ? 'device error' : String(errVal);
    log('failure', {
      operation: request.operation,
      ip: request.ip,
      addressGroup: request.addressGroup,
      url,
      host: config.baseUrl,
      httpStatus,
      reason: `error field: ${msg}`,
      requestBody: bodyString,
      response: JSON.stringify(json).slice(0, 512),
    });
    return {
      success: false,
      httpStatus,
      category: FAILURE_CATEGORY.DEVICE_REJECTED,
      message: msg,
      raw: json,
      requestBody: bodyString,
    };
  }

  const message = firstDefined(json?.msg, json?.message, json?.Message, '');
  if (request.operation === OPERATION_KIND.UNBLOCK && isNotFoundMessage(message)) {
    log('success', {
      operation: request.operation,
      ip: request.ip,
      addressGroup: request.addressGroup,
      httpStatus,
      note: 'entry not found treated as success',
      url,
      host: config.baseUrl,
    });
    return {
      success: true,
      httpStatus,
      category: FAILURE_CATEGORY.NONE,
      message,
      raw: json,
      requestBody: bodyString,
    };
  }

  log('success', {
    operation: request.operation,
    ip: request.ip,
    addressGroup: request.addressGroup,
    httpStatus,
    url,
    host: config.baseUrl,
  });
  return {
    success: true,
    httpStatus,
    category: FAILURE_CATEGORY.NONE,
    message,
    raw: json,
    requestBody: bodyString,
  };
};

const buildResult = ({ addressGroup, ip, family, outcome }) => ({
  address_group: addressGroup,
  ip,
  ip_family: family,
  status: outcome.success ? TASK_STATUS.SUCCESS : TASK_STATUS.FAILED,
  failure_reason: outcome.success ? '' : outcome.message || 'unknown error',
  failure_category: outcome.category || (outcome.success ? FAILURE_CATEGORY.NONE : FAILURE_CATEGORY.DEVICE_REJECTED),
  http_status: outcome.httpStatus || 0,
});

const executeIpTask = async (config, params) => {
  const request = {
    operation: params.operation,
    path: params.family === IP_FAMILY.IPV4 ? DPTECH_IPV4_PATH : DPTECH_IPV6_PATH,
    method: params.operation === OPERATION_KIND.BLOCK ? 'POST' : 'DELETE',
    body: params.operation === OPERATION_KIND.BLOCK
      ? params.family === IP_FAMILY.IPV4
        ? buildIpv4BlockBody(params.addressGroup, params.ip)
        : buildIpv6BlockBody(params.addressGroup, params.ip)
      : params.family === IP_FAMILY.IPV4
        ? buildIpv4DeleteBody(params.ip)
        : buildIpv6DeleteBody(params.ip),
    ip: params.ip,
    addressGroup: params.addressGroup,
  };
  const outcome = await fetchDptech(config, request, config.log);
  return buildResult({
    addressGroup: params.addressGroup,
    ip: params.ip,
    family: params.family,
    outcome,
  });
};

const buildConfig = (ctx, req, operation) => {
  const bindings = mergedBindings(ctx);
  const limits = ctx.limits || {};
  const meta = ctx.meta || {};
  const log = createLogger(meta);
  const baseUrl = normalizeBaseUrl(firstDefined(bindings.host, bindings.baseUrl, bindings.base_url, bindings.restBaseUrl, bindings.rest_base_url, bindings.url, bindings.endpoint));
  if (!baseUrl) {
    throw errorWithCode('INVALID_ARGUMENT', 'host/baseUrl/restBaseUrl is required (http/https)');
  }
  const user = resolveBindingString(bindings, ['user', 'username', 'account']);
  if (!user) {
    throw errorWithCode('INVALID_ARGUMENT', 'bindings.user/username is required');
  }
  const password = resolveBindingString(bindings, ['password', 'pass', 'secret']);
  if (!password) {
    throw errorWithCode('INVALID_ARGUMENT', 'bindings.password/pass is required');
  }
  const timeoutMs = normalizeTimeoutMs(firstDefined(bindings.timeoutMs, bindings.timeout_ms, limits.timeoutMs));
  const skipTlsVerify = Boolean(bindings.skipTlsVerify || bindings.tlsInsecureSkipVerify);
  const requestId = coerceString(firstDefined(req.request_id, req.requestId)).trim();
  const credentials = `${user}:${password}`;
  return {
    operation,
    baseUrl,
    authHeader: `Basic ${toBase64(encodeUtf8(credentials))}`,
    timeoutMs,
    skipTlsVerify,
    extraHeaders: bindings.headers || {},
    meta,
    requestId,
    log,
  };
};

const parseGroups = (req) => {
  const groupsSource = readRepeatedMessages(firstDefined(req.groups, req.Groups));
  if (!groupsSource.length) {
    throw errorWithCode('INVALID_ARGUMENT', 'groups is required and must be a non-empty array');
  }
  return groupsSource.map((group, index) => {
    const rawGroup = group && typeof group === 'object' ? group : {};
    const name = pickStringField(rawGroup, ['address_group', 'addressGroup', 'group_name', 'groupName']);
    if (!name) {
      throw errorWithCode('INVALID_ARGUMENT', `groups[${index}].address_group is required`);
    }
    const ipList = readRepeatedStrings(firstDefined(rawGroup.ip_addresses, rawGroup.ipAddresses));
    if (!ipList.length) {
      throw errorWithCode('INVALID_ARGUMENT', `groups[${index}].ip_addresses must contain at least one IP`);
    }
    return { name, ips: ipList };
  });
};

const handleOperation = async (ctx, operation) => {
  const callCtx = resolveCallContext(ctx);
  const req = callCtx.req || {};
  const config = buildConfig(callCtx, req, operation);
  const parsedGroups = parseGroups(req);
  const results = [];

  for (const group of parsedGroups) {
    const buckets = classifyIpList(group.ips);
    buckets.invalid.forEach((invalid) => {
      results.push({
        address_group: group.name,
        ip: invalid.ip,
        ip_family: IP_FAMILY.UNSPECIFIED,
        status: TASK_STATUS.FAILED,
        failure_reason: 'invalid IP address',
        failure_category: FAILURE_CATEGORY.INVALID_IP,
        http_status: 0,
      });
    });

    for (const target of buckets.ipv4) {
      results.push(await executeIpTask(config, {
        operation,
        family: IP_FAMILY.IPV4,
        ip: target.ip,
        addressGroup: group.name,
      }));
    }
    for (const target of buckets.ipv6) {
      results.push(await executeIpTask(config, {
        operation,
        family: IP_FAMILY.IPV6,
        ip: target.ip,
        addressGroup: group.name,
      }));
    }
  }

  const successCount = results.filter((item) => item.status === TASK_STATUS.SUCCESS).length;
  const response = {
    operation,
    ip_results: results,
    total_ip_count: results.length,
    success_ip_count: successCount,
    failure_ip_count: results.length - successCount,
    group_stats: summarizeGroups(results),
    request_id: config.requestId || '',
  };
  config.log('summary', {
    operation,
    total: response.total_ip_count,
    success: response.success_ip_count,
    failure: response.failure_ip_count,
    host: config.baseUrl,
  });
  return response;
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_BLOCK]: (req = callCtx.req) => handleOperation({ ...callCtx, req: req ?? {} }, OPERATION_KIND.BLOCK),
    [METHOD_UNBLOCK]: (req = callCtx.req) => handleOperation({ ...callCtx, req: req ?? {} }, OPERATION_KIND.UNBLOCK),
  };
}

export const handlers = {
  [METHOD_BLOCK_FULL]: (ctx) => rpcdef(ctx)[METHOD_BLOCK](ctx?.req ?? ctx?.request ?? {}),
  [METHOD_UNBLOCK_FULL]: (ctx) => rpcdef(ctx)[METHOD_UNBLOCK](ctx?.req ?? ctx?.request ?? {}),
};

export const _test = {
  buildConfig,
  buildHeaders,
  buildIpv4BlockBody,
  buildIpv4DeleteBody,
  buildIpv6BlockBody,
  buildIpv6DeleteBody,
  buildResult,
  classifyIpList,
  coerceString,
  createTlsDispatcher,
  createLogger,
  detectIpVersion,
  encodeUtf8,
  errorWithCode,
  executeIpTask,
  fetchWithTimeout,
  fetchDptech,
  firstDefined,
  handleOperation,
  isNotFoundMessage,
  mergedBindings,
  normalizeBaseUrl,
  normalizeTimeoutMs,
  parseGroups,
  pickStringField,
  readRepeatedMessages,
  readRepeatedStrings,
  resolveBindingString,
  resolveCallContext,
  summarizeGroups,
  toBase64,
};
