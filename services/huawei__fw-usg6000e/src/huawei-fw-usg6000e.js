import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const UPDATE_ADDRESS_GROUP_PATH = '/HUAWEI_FW_USG6000E.HUAWEI_FW_USG6000E/UpdateAddressGroup';
export const METHOD_UPDATE_ADDRESS_GROUP_FULL = 'HUAWEI_FW_USG6000E.HUAWEI_FW_USG6000E/UpdateAddressGroup';

export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_DESC = 'API Block_IP';
export const MAX_TOTAL_ADDRESSES = 1000;
export const IPV4_SUFFIX = '/32';
export const IPV6_SUFFIX = '/64';
export const CONTENT_TYPE = 'application/yang-data+xml';
let insecureDispatcherPromise;

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message, details) => {
  const finalMessage = details ? JSON.stringify({ message, ...details }) : message;
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${finalMessage}`);
  err.legacyCode = code;
  if (details) err.details = details;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const firstDefined = (...vals) => vals.find((val) => val !== undefined && val !== null);

const pickFirst = (source, keys) => {
  for (const key of keys) {
    if (hasOwn(source, key)) return unwrapScalar(source[key]);
  }
  return undefined;
};

const toBoolean = (value) => {
  const raw = unwrapScalar(value);
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) return false;
  }
  return false;
};

const normalizeHttpsUrl = (raw) => {
  const value = String(unwrapScalar(raw) ?? '').trim();
  if (!/^https:\/\//i.test(value)) return '';
  return value.replace(/\/+$/, '');
};

const requireNonEmpty = (value, field) => {
  const text = String(unwrapScalar(value) ?? '').trim();
  if (!text) throw errorWithCode('INVALID_ARGUMENT', `${field} is required`);
  return text;
};

const validateKeyPart = (value, field) => {
  const text = requireNonEmpty(value, field);
  if (/[\u0000-\u001f\u007f]/.test(text) || /[\\/,]/.test(text)) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} contains invalid characters`);
  }
  return text;
};

const isIPv4 = (value) => {
  const text = String(unwrapScalar(value) ?? '').trim();
  if (!text || text.includes('/')) return false;
  const parts = text.split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return false;
    if (part.length > 1 && part.startsWith('0')) return false;
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) return false;
  }
  return true;
};

const isIPv6 = (value) => {
  const text = String(unwrapScalar(value) ?? '').trim();
  if (!text || text.includes('/')) return false;
  if (!text.includes(':')) return false;
  if ((text.match(/::/g) || []).length > 1) return false;
  if (/::ffff:\d{1,3}(?:\.\d{1,3}){3}$/i.test(text)) {
    return isIPv4(text.substring(text.lastIndexOf(':') + 1));
  }
  if (!/^[0-9a-fA-F:.]+$/.test(text)) return false;
  const parts = text.split('::');
  const left = parts[0] ? parts[0].split(':').filter(Boolean) : [];
  const right = parts[1] ? parts[1].split(':').filter(Boolean) : [];
  if (left.some((part) => part.length > 4) || right.some((part) => part.length > 4)) return false;
  if (parts.length === 1 && left.length !== 8) return false;
  if (parts.length === 2 && left.length + right.length >= 8) return false;
  return true;
};

const getStringList = (candidate, field) => {
  const raw = unwrapScalar(candidate);
  const value = raw ?? [];
  if (!Array.isArray(value)) throw errorWithCode('INVALID_ARGUMENT', `${field} must be an array`);
  return value.map((item, idx) => {
    const text = String(unwrapScalar(item) ?? '').trim();
    if (!text) throw errorWithCode('INVALID_ARGUMENT', `${field}[${idx}] is blank`);
    return text;
  });
};

const validateAddressLists = (req) => {
  const ipv4List = getStringList(firstDefined(req?.ipv4_list, req?.ipv4List), 'ipv4_list');
  const ipv6List = getStringList(firstDefined(req?.ipv6_list, req?.ipv6List), 'ipv6_list');
  for (let i = 0; i < ipv4List.length; i += 1) {
    if (!isIPv4(ipv4List[i])) throw errorWithCode('INVALID_ARGUMENT', `ipv4_list[${i}] must be a valid IPv4 address`);
  }
  for (let i = 0; i < ipv6List.length; i += 1) {
    if (!isIPv6(ipv6List[i])) throw errorWithCode('INVALID_ARGUMENT', `ipv6_list[${i}] must be a valid IPv6 address`);
  }
  if (ipv4List.length + ipv6List.length > MAX_TOTAL_ADDRESSES) {
    throw errorWithCode('INVALID_ARGUMENT', `total address count exceeds limit ${MAX_TOTAL_ADDRESSES}`);
  }
  return { ipv4List, ipv6List };
};

const escapeXml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const buildXmlBody = (desc, ipv4List, ipv6List) => {
  const parts = ['<addr-group>', `<desc>${escapeXml(desc || DEFAULT_DESC)}</desc>`];
  let elemId = 1;
  for (const ip of ipv4List) {
    parts.push(`<elements><elem-id>${elemId}</elem-id><address-ipv4>${escapeXml(ip + IPV4_SUFFIX)}</address-ipv4></elements>`);
    elemId += 1;
  }
  for (const ip of ipv6List) {
    parts.push(`<elements><elem-id>${elemId}</elem-id><address-ipv6>${escapeXml(ip + IPV6_SUFFIX)}</address-ipv6></elements>`);
    elemId += 1;
  }
  parts.push('</addr-group>');
  return parts.join('');
};

const encodeKeyPart = (value) => encodeURIComponent(String(value));

const buildRequestUrl = (host, deviceName, bookName) =>
  `${host}/restconf/data/huawei-address-set:address-set/addr-group=${encodeKeyPart(deviceName)},${encodeKeyPart(bookName)}`;

const buildAuthorization = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

const buildHeaders = (authorization, extraHeaders = {}) => ({
  ...extraHeaders,
  'Content-Type': CONTENT_TYPE,
  Accept: CONTENT_TYPE,
  Connection: 'Keep-Alive',
  'Cache-Control': 'no-cache,no-store',
  Authorization: authorization,
});

const sanitizeHeaders = (headers) => {
  const sanitized = {};
  for (const [key, value] of Object.entries(headers || {})) {
    sanitized[key] = String(key).toLowerCase() === 'authorization' ? 'Basic ***' : String(value);
  }
  return sanitized;
};

const shouldPreview = (metadata) => {
  const candidates = [
    metadata?.preview_only,
    metadata?.previewOnly,
    metadata?.['x-preview-only'],
    metadata?.dry_run_preview,
  ];
  return candidates.some((value) => toBoolean(value));
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.bindings ?? {}),
  ...(ctx?.secret ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  metadata: ctx.metadata ?? {},
  req: ctx.request ?? ctx.req ?? {},
});

const requestFromContext = (ctx = {}) => ctx?.request ?? ctx?.req ?? {};

const pickRequestOrBinding = (req, bindings, requestKeys, bindingKeys = requestKeys) =>
  firstDefined(pickFirst(req, requestKeys), pickFirst(bindings, bindingKeys));

const pickBinding = (bindings, bindingKeys) => pickFirst(bindings, bindingKeys);

const resolveTimeoutMs = (ctx) => {
  const bindings = mergedBindings(ctx);
  const timeout = Number(firstDefined(ctx?.limits?.timeoutMs, bindings.timeoutMs, bindings.timeout_ms, DEFAULT_TIMEOUT_MS));
  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS;
};

const shouldSkipTlsVerify = (ctx) => {
  const bindings = mergedBindings(ctx);
  return toBoolean(bindings.skipTlsVerify) ||
    toBoolean(bindings.tlsInsecureSkipVerify) ||
    toBoolean(bindings.insecureSkipVerify);
};

const createTlsDispatcher = async (skipTlsVerify) => {
  if (!skipTlsVerify) return undefined;
  insecureDispatcherPromise ??= import('undici').then(({ Agent }) => new Agent({
    connect: { rejectUnauthorized: false },
  }));
  return insecureDispatcherPromise;
};

const fetchWithTimeout = async (url, init = {}, options = {}) => {
  const rawTimeout = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_TIMEOUT_MS;
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

const logFlow = (ctx, action, details) => {
  const meta = ctx?.meta || {};
  const tags = [];
  if (meta.instance_id || meta.instanceId) tags.push(`inst=${meta.instance_id || meta.instanceId}`);
  if (meta.request_id || meta.requestId) tags.push(`req=${meta.request_id || meta.requestId}`);
  const prefix = `[HUAWEI_FW_USG6000E][${action}]${tags.length ? `[${tags.join(' ')}]` : ''}`;
  try {
    console.log(prefix, JSON.stringify(details));
  } catch {
    console.log(prefix, details);
  }
};

const buildErrorDetails = (requestModel, httpStatus, rawBody, reason) => ({
  http_status: httpStatus,
  raw_body: '',
  raw_body_length: String(rawBody ?? '').length,
  reason,
  request_method: requestModel.request_method,
  request_url: requestModel.request_url,
});

const buildResponse = (input) => ({
  success: true,
  http_status: input.httpStatus,
  raw_body: '',
  message: input.message,
  preview_only: input.previewOnly,
  request_method: input.requestModel.request_method,
  request_url: input.requestModel.request_url,
  request_headers: {},
  request_body: '',
});

const prepareRequest = (ctx) => {
  const callCtx = resolveCallContext(ctx);
  const req = callCtx.req || {};
  const bindings = callCtx.bindings || {};
  const host = normalizeHttpsUrl(requireNonEmpty(pickBinding(bindings, ['host']), 'host'));
  if (!host) throw errorWithCode('INVALID_ARGUMENT', 'host must be a valid https URL');
  const deviceName = validateKeyPart(pickRequestOrBinding(req, bindings, ['device_name', 'deviceName']), 'device_name');
  const bookName = validateKeyPart(pickRequestOrBinding(req, bindings, ['book_name', 'bookName']), 'book_name');
  const user = requireNonEmpty(pickBinding(bindings, ['user', 'username']), 'user');
  const password = requireNonEmpty(pickBinding(bindings, ['password']), 'password');
  const desc = String(unwrapScalar(firstDefined(req?.desc, bindings.desc)) ?? '').trim() || DEFAULT_DESC;
  const { ipv4List, ipv6List } = validateAddressLists(req);
  const headers = buildHeaders(buildAuthorization(user, password), bindings.headers || {});
  const url = buildRequestUrl(host, deviceName, bookName);
  const body = buildXmlBody(desc, ipv4List, ipv6List);
  return {
    requestModel: {
      request_method: 'PUT',
      request_url: url,
      request_headers: sanitizeHeaders(headers),
      request_body: body,
    },
    fetchHeaders: headers,
    fetchBody: body,
  };
};

const mapHttpFailure = (status, requestModel, rawBody) => {
  const reason = `upstream http ${status}`;
  if (status === 401 || status === 403) {
    throw errorWithCode('PERMISSION_DENIED', reason, buildErrorDetails(requestModel, status, rawBody, reason));
  }
  if (status >= 400 && status < 500) {
    throw errorWithCode('FAILED_PRECONDITION', reason, buildErrorDetails(requestModel, status, rawBody, reason));
  }
  throw errorWithCode('UNAVAILABLE', reason, buildErrorDetails(requestModel, status, rawBody, reason));
};

const handleUpdateAddressGroup = async (req, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const previewOnly = shouldPreview(callCtx.metadata || {});
  const timeoutMs = resolveTimeoutMs(callCtx);
  const skipTlsVerify = shouldSkipTlsVerify(callCtx);
  const { requestModel, fetchHeaders, fetchBody } = prepareRequest(callCtx);

  if (previewOnly) {
    logFlow(callCtx, 'UpdateAddressGroup:preview', { url: requestModel.request_url });
    return buildResponse({
      httpStatus: 0,
      rawBody: '',
      message: 'preview only',
      previewOnly: true,
      requestModel,
    });
  }

  const fetchOptions = {
    method: 'PUT',
    headers: fetchHeaders,
    body: fetchBody,
  };

  logFlow(callCtx, 'UpdateAddressGroup:start', { url: requestModel.request_url });

  let response;
  try {
    response = await fetchWithTimeout(requestModel.request_url, fetchOptions, { timeoutMs, skipTlsVerify });
  } catch (error) {
    const reason = error?.cause?.message || error?.message || 'fetch failed';
    throw errorWithCode('UNAVAILABLE', 'upstream request failed', buildErrorDetails(requestModel, 0, '', reason));
  }

  let rawBody = '';
  try {
    rawBody = await response.text();
  } catch (error) {
    const reason = error?.cause?.message || error?.message || 'read response body failed';
    throw errorWithCode('UNKNOWN', 'failed to read upstream response body', buildErrorDetails(requestModel, Number(response?.status) || 0, '', reason));
  }

  const status = Number(response?.status) || 0;
  if (!response?.ok) mapHttpFailure(status, requestModel, rawBody);

  logFlow(callCtx, 'UpdateAddressGroup:done', { url: requestModel.request_url, http_status: status });
  return buildResponse({
    httpStatus: status,
    rawBody,
    message: 'address group updated',
    previewOnly: false,
    requestModel,
  });
};

export function rpcdef(ctx) {
  const callCtx = resolveCallContext(ctx);
  return {
    [UPDATE_ADDRESS_GROUP_PATH]: async () => handleUpdateAddressGroup(callCtx.req || {}, callCtx),
  };
}

export const handlers = {
  [METHOD_UPDATE_ADDRESS_GROUP_FULL]: (ctx = {}) => handleUpdateAddressGroup(requestFromContext(ctx), ctx),
};

export const _test = {
  buildAuthorization,
  buildErrorDetails,
  buildHeaders,
  buildRequestUrl,
  buildResponse,
  buildXmlBody,
  createTlsDispatcher,
  errorWithCode,
  escapeXml,
  fetchWithTimeout,
  getStringList,
  isIPv4,
  isIPv6,
  logFlow,
  mapHttpFailure,
  normalizeHttpsUrl,
  prepareRequest,
  resolveTimeoutMs,
  sanitizeHeaders,
  shouldPreview,
  shouldSkipTlsVerify,
  toBoolean,
  validateAddressLists,
  validateKeyPart,
};
