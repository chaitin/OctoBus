// MISP (Malware Information Sharing Platform) Threat Intelligence API implementation
// REST API with API-Key authentication.
//
// Endpoint: configurable (https://misp-instance.example.com)

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

// ── Constants ──────────────────────────────────────────────

const SERVICE_NAME = 'MISP';
const DEFAULT_TIMEOUT_MS = 10000;

// ── Method paths ───────────────────────────────────────────

export const SEARCH_EVENTS_PATH = '/MISP.MISP/SearchEvents';
export const GET_EVENT_PATH = '/MISP.MISP/GetEvent';
export const CREATE_EVENT_PATH = '/MISP.MISP/CreateEvent';
export const SEARCH_ATTRIBUTES_PATH = '/MISP.MISP/SearchAttributes';
export const ADD_ATTRIBUTE_PATH = '/MISP.MISP/AddAttribute';
export const SEARCH_TAGS_PATH = '/MISP.MISP/SearchTags';

export const SEARCH_EVENTS_FULL = 'MISP.MISP/SearchEvents';
export const GET_EVENT_FULL = 'MISP.MISP/GetEvent';
export const CREATE_EVENT_FULL = 'MISP.MISP/CreateEvent';
export const SEARCH_ATTRIBUTES_FULL = 'MISP.MISP/SearchAttributes';
export const ADD_ATTRIBUTE_FULL = 'MISP.MISP/AddAttribute';
export const SEARCH_TAGS_FULL = 'MISP.MISP/SearchTags';

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

const buildLogPrefix = (meta = {}, action) => {
  const parts = [];
  if (meta.instance_id || meta.instanceId) parts.push('inst=' + (meta.instance_id || meta.instanceId));
  if (meta.request_id || meta.requestId) parts.push('req=' + (meta.request_id || meta.requestId));
  return '[' + SERVICE_NAME + '][' + action + ']' + (parts.length ? '[' + parts.join(' ') + ']' : '');
};

const logFlow = (meta, action, details) => {
  const prefix = buildLogPrefix(meta, action);
  const safe = { ...details };
  try {
    console.log(prefix, JSON.stringify(safe));
  } catch {
    console.log(prefix, safe);
  }
};

// ── Credential extraction ──────────────────────────────────

const resolveCredentials = (bindings = {}) => {
  const apiKey = toTrimmedString(firstDefined(bindings.api_key, bindings.apiKey));
  if (!apiKey) throw errorWithCode('FAILED_PRECONDITION', 'binding "api_key" or "apiKey" is required but not configured');
  return { apiKey };
};

const resolveEndpoint = (bindings = {}) => {
  const endpoint = toTrimmedString(firstDefined(bindings.endpoint));
  if (!endpoint) throw errorWithCode('FAILED_PRECONDITION', 'binding "endpoint" is required but not configured');
  return endpoint.replace(/\/+$/, '');
};

// ── API call ────────────────────────────────────────────────

const callMisp = async (ctx, method, path, body, queryParams) => {
  const bindings = mergedBindings(ctx);
  const credentials = resolveCredentials(bindings);
  const endpoint = resolveEndpoint(bindings);
  const timeoutMs = resolveTimeoutMs(bindings, ctx.limits);
  const meta = ctx.meta || {};

  let url = endpoint + path;
  if (queryParams) {
    url += '?' + Object.entries(queryParams)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
      .join('&');
  }

  const headers = {
    'Authorization': credentials.apiKey,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'x-engine-instance': meta.instance_id || meta.instanceId || 'unknown',
    'x-request-id': meta.request_id || meta.requestId || 'unknown',
  };

  // OctoBus runtime wraps globalThis.fetch and recognizes these TLS skip options.
  // In bare Node.js (undici), these options are silently ignored, so TLS skip
  // relies on the OctoBus daemon setting NODE_TLS_REJECT_UNAUTHORIZED=0 before
  // process startup.
  const skipVerify = toBoolean(bindings.skipTlsVerify) || toBoolean(bindings.tlsInsecureSkipVerify);
  const tlsOptions = skipVerify ? { insecureSkipVerify: true, tlsInsecureSkipVerify: true } : {};

  logFlow(meta, method + ':start', { path, body: body ? '(body)' : undefined });

  let res;
  try {
    res = await fetch(url, {
      method: method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      ...tlsOptions,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    const reason = isTimeout ? 'timeout after ' + timeoutMs + 'ms' : (err?.cause?.message || err?.message || 'fetch failed');
    logFlow(meta, method + ':error', { error: reason });
    throw errorWithCode('UNAVAILABLE', 'upstream error: ' + reason);
  }

  const text = await res.text();

  if (res.status === 401) {
    logFlow(meta, method + ':unauthenticated', { status: res.status });
    throw errorWithCode('UNAUTHENTICATED', 'upstream http ' + res.status + ': ' + text);
  }

  if (res.status === 403) {
    logFlow(meta, method + ':auth-error', { status: res.status });
    throw errorWithCode('PERMISSION_DENIED', 'upstream http ' + res.status + ': ' + text);
  }

  if (res.status >= 400 && res.status < 500) {
    logFlow(meta, method + ':client-error', { status: res.status, response: text });
    throw errorWithCode('FAILED_PRECONDITION', 'upstream http ' + res.status + ': ' + text);
  }

  if (res.status >= 500) {
    logFlow(meta, method + ':server-error', { status: res.status });
    throw errorWithCode('UNAVAILABLE', 'upstream http ' + res.status + ': ' + text);
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

  // MISP API error
  if (json?.errors && Object.keys(json.errors).length > 0) {
    const msg = JSON.stringify(json.errors);
    logFlow(meta, method + ':api-error', { errors: json.errors });
    throw errorWithCode('FAILED_PRECONDITION', 'MISP API error: ' + msg);
  }

  logFlow(meta, method + ':done', {});
  return json;
};

// ── Response mappers ───────────────────────────────────────

const mapEvent = (item) => ({
  id: String(item?.id ?? item?.Event?.id ?? ''),
  info: String(item?.info ?? item?.Event?.info ?? ''),
  date: String(item?.date ?? item?.Event?.date ?? ''),
  published: toBoolean(item?.published ?? item?.Event?.published ?? false),
  threat_level_id: toInt64(item?.threat_level_id ?? item?.Event?.threat_level_id) ?? 0,
  analysis: toInt64(item?.analysis ?? item?.Event?.analysis) ?? 0,
  org: String(item?.orgc_id ?? item?.Orgc?.id ?? item?.Event?.orgc_id ?? ''),
  org_name: String(item?.Orgc?.name ?? item?.Event?.Orgc?.name ?? ''),
  tags: (item?.Tag ?? item?.Event?.Tag ?? []).map((t) => String(t?.name ?? t ?? '')),
  attribute_count: toInt64(item?.attribute_count ?? item?.Event?.attribute_count) ?? 0,
  uuid: String(item?.uuid ?? item?.Event?.uuid ?? ''),
  timestamp: String(item?.timestamp ?? item?.Event?.timestamp ?? ''),
});

const mapAttribute = (item) => ({
  id: String(item?.id ?? item?.Attribute?.id ?? ''),
  value: String(item?.value ?? item?.Attribute?.value ?? ''),
  type: String(item?.type ?? item?.Attribute?.type ?? ''),
  category: String(item?.category ?? item?.Attribute?.category ?? ''),
  event_id: String(item?.event_id ?? item?.Attribute?.event_id ?? ''),
  to_ids: toBoolean(item?.to_ids ?? item?.Attribute?.to_ids ?? false),
  tags: (item?.Tag ?? item?.Attribute?.Tag ?? []).map((t) => String(t?.name ?? t ?? '')),
  comment: String(item?.comment ?? item?.Attribute?.comment ?? ''),
  uuid: String(item?.uuid ?? item?.Attribute?.uuid ?? ''),
  event_info: String(item?.event_info ?? ''),
});

const mapTag = (item) => ({
  id: String(item?.id ?? ''),
  name: String(item?.name ?? ''),
  colour: String(item?.colour ?? item?.color ?? ''),
  count: toInt64(item?.count ?? item?.attribute_count) ?? 0,
});

// ── API method implementations ─────────────────────────────

const searchEvents = async (req = {}, ctx = {}) => {
  const body = { returnFormat: 'json' };
  if (req.value) body.value = req.value;
  if (req.type && req.type.length > 0) body.type = { OR: req.type };
  if (req.category && req.category.length > 0) body.category = { OR: req.category };
  if (req.tags && req.tags.length > 0) body.tags = { OR: req.tags };
  if (req.not_tags && req.not_tags.length > 0) body.tags = { ...body.tags, NOT: req.not_tags };
  if (req.org) body.org = req.org;
  if (req.from) body.from = req.from;
  if (req.to) body.to = req.to;
  if (req.last) body.last = req.last;
  if (toInt64(req.limit) !== null) body.limit = String(toInt64(req.limit));
  if (toInt64(req.page) !== null) body.page = String(toInt64(req.page));
  if (toBoolean(req.metadata)) body.metadata = '1';
  if (toBoolean(req.with_attachments)) body.withAttachments = '1';

  const response = await callMisp(ctx, 'POST', '/events/restSearch', body);
  const list = response?.response ?? [];
  return { items: Array.isArray(list) ? list.map(mapEvent) : [] };
};

const getEvent = async (req = {}, ctx = {}) => {
  const eventId = toTrimmedString(firstDefined(req.event_id, req.eventId));
  if (!eventId) {
    throw errorWithCode('INVALID_ARGUMENT', 'event_id is required');
  }
  const response = await callMisp(ctx, 'GET', '/events/' + encodeURIComponent(eventId));
  const eventData = response?.Event ?? {};
  const attributes = eventData?.Attribute ?? [];
  return {
    event: mapEvent(eventData),
    attributes: Array.isArray(attributes) ? attributes.map(mapAttribute) : [],
  };
};

const createEvent = async (req = {}, ctx = {}) => {
  const info = toTrimmedString(firstDefined(req.info));
  if (!info) {
    throw errorWithCode('INVALID_ARGUMENT', 'info is required');
  }
  const eventBody = { info };
  if (req.date) eventBody.date = toTrimmedString(req.date);
  if (toInt64(req.threat_level_id) !== null) eventBody.threat_level_id = toInt64(req.threat_level_id);
  if (toInt64(req.analysis) !== null) eventBody.analysis = toInt64(req.analysis);
  if (toBoolean(req.published)) eventBody.published = 1;
  if (toInt64(req.distribution) !== null) eventBody.distribution = toInt64(req.distribution);

  const response = await callMisp(ctx, 'POST', '/events/add', { Event: eventBody });
  return { event: mapEvent(response) };
};

const searchAttributes = async (req = {}, ctx = {}) => {
  const body = { returnFormat: 'json' };
  if (req.value) body.value = req.value;
  if (req.type && req.type.length > 0) body.type = { OR: req.type };
  if (req.category && req.category.length > 0) body.category = { OR: req.category };
  if (req.tags && req.tags.length > 0) body.tags = { OR: req.tags };
  if (req.not_tags && req.not_tags.length > 0) body.tags = { ...body.tags, NOT: req.not_tags };
  if (req.event_id) body.eventid = req.event_id;
  if (req.from) body.from = req.from;
  if (req.to) body.to = req.to;
  if (req.last) body.last = req.last;
  if (toInt64(req.limit) !== null) body.limit = String(toInt64(req.limit));
  if (toInt64(req.page) !== null) body.page = String(toInt64(req.page));
  if (toBoolean(req.include_event)) body.includeEventUuid = '1';
  if (toBoolean(req.to_ids)) body.to_ids = '1';

  const response = await callMisp(ctx, 'POST', '/attributes/restSearch', body);
  const list = response?.response ?? [];
  return { items: Array.isArray(list) ? list.map(mapAttribute) : [] };
};

const addAttribute = async (req = {}, ctx = {}) => {
  const eventId = toTrimmedString(firstDefined(req.event_id, req.eventId));
  if (!eventId) throw errorWithCode('INVALID_ARGUMENT', 'event_id is required');
  const value = toTrimmedString(firstDefined(req.value));
  if (!value) throw errorWithCode('INVALID_ARGUMENT', 'value is required');
  const type = toTrimmedString(firstDefined(req.type));
  if (!type) throw errorWithCode('INVALID_ARGUMENT', 'type is required');

  const attrBody = { value, type };
  if (req.category) attrBody.category = toTrimmedString(req.category);
  if (toBoolean(req.to_ids)) attrBody.to_ids = 1;
  if (toInt64(req.distribution) !== null) attrBody.distribution = toInt64(req.distribution);
  if (req.comment) attrBody.comment = toTrimmedString(req.comment);

  const response = await callMisp(ctx, 'POST', '/attributes/add/' + encodeURIComponent(eventId), { Attribute: attrBody });
  return { attribute: mapAttribute(response?.Attribute ?? response) };
};

const searchTags = async (req = {}, ctx = {}) => {
  const name = toTrimmedString(firstDefined(req.name));
  if (!name) {
    throw errorWithCode('INVALID_ARGUMENT', 'name is required');
  }
  const response = await callMisp(ctx, 'GET', '/tags/search/' + encodeURIComponent(name));
  const list = response ?? [];
  return { items: Array.isArray(list) ? list.map(mapTag) : [] };
};

// ── rpcdef (filter-style handler) ──────────────────────────

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [SEARCH_EVENTS_PATH]: async (req) => searchEvents(req ?? callCtx.req, callCtx),
    [GET_EVENT_PATH]: async (req) => getEvent(req ?? callCtx.req, callCtx),
    [CREATE_EVENT_PATH]: async (req) => createEvent(req ?? callCtx.req, callCtx),
    [SEARCH_ATTRIBUTES_PATH]: async (req) => searchAttributes(req ?? callCtx.req, callCtx),
    [ADD_ATTRIBUTE_PATH]: async (req) => addAttribute(req ?? callCtx.req, callCtx),
    [SEARCH_TAGS_PATH]: async (req) => searchTags(req ?? callCtx.req, callCtx),
  };
}

// ── SDK handlers (single-ctx style, compatible with OctoBus SDK) ─

const mergeSdkCtx = (baseCtx, innerCtx) => ({
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

const resolveSdkCallContext = (baseCtx, reqOrCtx, maybeInnerCtx) => {
  if (maybeInnerCtx !== undefined) {
    return { req: reqOrCtx ?? {}, ctx: mergeSdkCtx(baseCtx, maybeInnerCtx) };
  }
  const innerCtx = reqOrCtx ?? {};
  return {
    req: innerCtx.request ?? innerCtx.req ?? {},
    ctx: mergeSdkCtx(baseCtx, innerCtx),
  };
};

const wrapLegacyHandler = (baseCtx, methodFn) => async (reqOrCtx, maybeInnerCtx) => {
  const call = resolveSdkCallContext(baseCtx, reqOrCtx, maybeInnerCtx);
  const legacyCtx = { ...call.ctx, req: call.req };
  return methodFn(call.req, legacyCtx);
};

const sdkHandlers = {};
sdkHandlers[SEARCH_EVENTS_FULL] = wrapLegacyHandler({}, searchEvents);
sdkHandlers[GET_EVENT_FULL] = wrapLegacyHandler({}, getEvent);
sdkHandlers[CREATE_EVENT_FULL] = wrapLegacyHandler({}, createEvent);
sdkHandlers[SEARCH_ATTRIBUTES_FULL] = wrapLegacyHandler({}, searchAttributes);
sdkHandlers[ADD_ATTRIBUTE_FULL] = wrapLegacyHandler({}, addAttribute);
sdkHandlers[SEARCH_TAGS_FULL] = wrapLegacyHandler({}, searchTags);

export const handlers = {
  [SEARCH_EVENTS_FULL]: (ctx) => sdkHandlers[SEARCH_EVENTS_FULL](ctx),
  [GET_EVENT_FULL]: (ctx) => sdkHandlers[GET_EVENT_FULL](ctx),
  [CREATE_EVENT_FULL]: (ctx) => sdkHandlers[CREATE_EVENT_FULL](ctx),
  [SEARCH_ATTRIBUTES_FULL]: (ctx) => sdkHandlers[SEARCH_ATTRIBUTES_FULL](ctx),
  [ADD_ATTRIBUTE_FULL]: (ctx) => sdkHandlers[ADD_ATTRIBUTE_FULL](ctx),
  [SEARCH_TAGS_FULL]: (ctx) => sdkHandlers[SEARCH_TAGS_FULL](ctx),
};

// ── Test exports ───────────────────────────────────────────

export const _test = {
  callMisp,
  errorWithCode,
  firstDefined,
  hasOwn,
  logFlow,
  mergedBindings,
  resolveCallContext,
  resolveCredentials,
  resolveEndpoint,
  resolveTimeoutMs,
  toBoolean,
  toInt64,
  toTrimmedString,
  toValue,
  mapEvent,
  mapAttribute,
  mapTag,
  searchEvents,
  getEvent,
  createEvent,
  searchAttributes,
  addAttribute,
  searchTags,
};
