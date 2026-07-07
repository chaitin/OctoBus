import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const DEFAULT_TIMEOUT_MS = 5000;

const METHOD_SPECS = [
  ['ListAuditLogs', '/api/audit_logs', 'list'],
  ['ExportAuditLogs', '/api/audit_logs/export', 'blob'],
  ['ListAlertPolicies', '/api/alert/policies', 'list'],
  ['ListAlertHistories', '/api/alert/policies/histories', 'list'],
  ['ListUsers', '/api/users', 'list'],
  ['ListRoles', '/api/roles', 'list'],
  ['ListTokens', '/api/tokens', 'list'],
  ['ListConsumers', '/apisix/admin/consumers', 'list'],
  ['ListConsumerCredentials', '/apisix/admin/consumers/{username}/credentials', 'list'],
  ['ListCertificates', '/apisix/admin/certificates', 'list'],
  ['ListCACertificates', '/apisix/admin/ca_certificates', 'list'],
  ['ListSNIs', '/apisix/admin/snis', 'list'],
  ['GetCertificateUsage', '/api/gateway_groups/{gateway_group_id}/certificates/{certificate_id}/usage', 'list'],
  ['ListGatewayGroups', '/api/gateway_groups', 'list'],
  ['ListGatewayInstances', '/api/gateway_groups/{gateway_group_id}/instances', 'list'],
  ['ListRoutes', '/apisix/admin/routes', 'list'],
  ['ListServices', '/apisix/admin/services', 'list'],
  ['ListGlobalRules', '/apisix/admin/global_rules', 'list'],
  ['ListPlugins', '/apisix/admin/plugins', 'object'],
  ['GetPluginSchema', '/apisix/admin/schema/plugins/{plugin_name}', 'object'],
  ['ListApprovals', '/api/approvals', 'list'],
  ['ListSecretProviders', '/apisix/admin/secret_providers', 'list'],
  ['GetSecretProviderUsage', '/api/gateway_groups/{gateway_group_id}/secret_providers/{secret_provider}/{secret_provider_id}/usage', 'list'],
  ['ParseCertificate', '/api/parse_certificate', 'object', 'PUT'],
  ['ValidateCertificateKey', '/api/validate_cert_key', 'object', 'PUT'],
  ['ListDebugSessions', '/api/gateway_groups/{gateway_group_id}/debug_sessions', 'list'],
  ['ListDebugTraces', '/api/gateway_groups/{gateway_group_id}/debug_sessions/{debug_session_id}/traces', 'list'],
  ['GetServiceHealthcheck', '/api/gateway_groups/{gateway_group_id}/services/{apisix_service_id}/healthcheck', 'object'],
  ['CreateToken', '/api/tokens', 'object', 'POST'],
  ['CreateConsumer', '/apisix/admin/consumers', 'object', 'POST'],
  ['CreateConsumerCredential', '/apisix/admin/consumers/{username}/credentials', 'object', 'POST'],
  ['CreateCertificate', '/apisix/admin/certificates', 'object', 'POST'],
  ['CreateSNI', '/apisix/admin/snis', 'object', 'POST'],
  ['CreateService', '/apisix/admin/services', 'object', 'POST'],
  ['CreateRoute', '/apisix/admin/routes', 'object', 'POST'],
  ['CreateGlobalRule', '/apisix/admin/global_rules', 'object', 'POST'],
];

export const METHOD_PATHS = Object.fromEntries(METHOD_SPECS.map(([name]) => [name, `/API7_Enterprise_V3_10_2.API7_Enterprise_V3_10_2/${name}`]));
export const METHOD_FULLS = Object.fromEntries(METHOD_SPECS.map(([name]) => [name, `API7_Enterprise_V3_10_2.API7_Enterprise_V3_10_2/${name}`]));

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), String(message ?? ''));
  err.legacyCode = code;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);
const reqField = (req = {}, snakeName, camelName) => firstDefined(req[snakeName], camelName ? req[camelName] : undefined);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && !Array.isArray(value) && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const toTrimmedString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

const toOptionalInt = (value, options = {}) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = Number(raw);
  if (!Number.isInteger(num) || Number.isNaN(num)) return undefined;
  if (options.min !== undefined && num < options.min) return undefined;
  return num;
};

const toOptionalBool = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') {
    if (raw === 1) return true;
    if (raw === 0) return false;
    return undefined;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return undefined;
};

const toStringArray = (value) => {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.map((item) => toTrimmedString(item)).filter(Boolean);
  const raw = unwrapScalar(value);
  if (Array.isArray(raw)) return raw.map((item) => toTrimmedString(item)).filter(Boolean);
  return toTrimmedString(raw).split(',').map((item) => item.trim()).filter(Boolean);
};

const toStringMap = (value) => {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    const stringVal = toTrimmedString(val);
    if (stringVal) out[key] = stringVal;
  }
  return out;
};

const normalizeBaseUrl = (value) => {
  const raw = toTrimmedString(value);
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.replace(/\/+$/, '');
};

const structToPlainObject = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  if (hasOwn(raw, 'fields') && typeof raw.fields === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(raw.fields)) out[key] = valueToPlain(item);
    return out;
  }
  return raw;
};

const listValueToPlainArray = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object' && raw && Array.isArray(raw.values)) return raw.values.map((item) => valueToPlain(item));
  return undefined;
};

const valueToPlain = (value) => {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'object' || Array.isArray(value)) return value;
  if (hasOwn(value, 'nullValue')) return null;
  if (hasOwn(value, 'stringValue')) return value.stringValue;
  if (hasOwn(value, 'numberValue')) return value.numberValue;
  if (hasOwn(value, 'boolValue')) return value.boolValue;
  if (hasOwn(value, 'listValue')) return (value.listValue?.values || []).map((item) => valueToPlain(item));
  if (hasOwn(value, 'structValue')) {
    const fields = value.structValue?.fields || {};
    const out = {};
    for (const [key, item] of Object.entries(fields)) out[key] = valueToPlain(item);
    return out;
  }
  if (hasOwn(value, 'value')) return valueToPlain(value.value);
  return value;
};

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

const isSdkCallContext = (value) => (
  value != null
  && typeof value === 'object'
  && (
    hasOwn(value, 'request')
    || hasOwn(value, 'config')
    || hasOwn(value, 'secret')
    || hasOwn(value, 'metadata')
    || hasOwn(value, 'method')
    || hasOwn(value, 'packageDir')
  )
);

const resolveHandlerArgs = (reqOrCtx = {}, maybeCtx) => {
  if (maybeCtx !== undefined) return { req: reqOrCtx ?? {}, ctx: maybeCtx ?? {} };
  if (isSdkCallContext(reqOrCtx)) return { req: reqOrCtx.request ?? reqOrCtx.req ?? {}, ctx: reqOrCtx };
  return { req: reqOrCtx ?? {}, ctx: {} };
};

const resolveBaseUrl = (bindings = {}) => normalizeBaseUrl(firstDefined(
  bindings.api7_base_url,
  bindings.baseUrl,
  bindings.restBaseUrl,
  bindings.domain,
));

const resolveApiKey = (bindings = {}) => toTrimmedString(firstDefined(
  bindings.api7_api_key,
  bindings.apiKey,
  bindings.xApiKey,
));

const resolveUsername = (bindings = {}) => toTrimmedString(bindings.username);
const resolvePassword = (bindings = {}) => toTrimmedString(bindings.password);
const resolveTimeoutMs = (ctx = {}) => {
  const raw = Number(firstDefined(ctx.limits?.timeoutMs, ctx.bindings?.timeoutMs, DEFAULT_TIMEOUT_MS));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

const resolveDefaultGatewayGroupId = (bindings = {}) => toTrimmedString(firstDefined(
  bindings.gateway_group_id,
  bindings.gatewayGroupId,
));

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

const tlsSkipRequested = (bindings = {}) => Boolean(bindings.skipTlsVerify || bindings.tlsInsecureSkipVerify || bindings.insecureSkipVerify);

const buildDispatcher = (bindings = {}) => {
  if (!tlsSkipRequested(bindings)) return undefined;
  return new Agent({
    connect: {
      rejectUnauthorized: false,
    },
  });
};

const makeTimeoutSignal = (timeoutMs) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeoutId) };
};

const requireBaseUrl = (ctx = {}) => {
  const baseUrl = resolveBaseUrl(ctx.bindings || {});
  if (!baseUrl) throw errorWithCode('INVALID_ARGUMENT', 'api7_base_url is required in bindings');
  return baseUrl;
};

const requireAuth = (ctx = {}) => {
  const apiKey = resolveApiKey(ctx.bindings || {});
  const username = resolveUsername(ctx.bindings || {});
  const password = resolvePassword(ctx.bindings || {});
  if (apiKey) return { type: 'apiKey', apiKey };
  if (username && password) return { type: 'basic', username, password };
  throw errorWithCode('INVALID_ARGUMENT', 'either api7_api_key or username/password is required in bindings');
};

const requireString = (value, fieldName) => {
  const text = toTrimmedString(value);
  if (!text) throw errorWithCode('INVALID_ARGUMENT', `${fieldName} is required`);
  return text;
};

const requireNumber = (value, fieldName) => {
  const raw = Number(unwrapScalar(value));
  if (!Number.isFinite(raw)) throw errorWithCode('INVALID_ARGUMENT', `${fieldName} must be a number`);
  return raw;
};

const buildRequestHeaders = (ctx = {}, extra = {}) => {
  const auth = requireAuth(ctx);
  const headers = {
    Accept: 'application/json',
    ...parseHeaders(ctx.bindings?.headers),
    ...extra,
  };
  if (auth.type === 'apiKey') {
    headers['X-API-KEY'] = auth.apiKey;
  } else {
    headers.Authorization = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;
  }
  return headers;
};

const encodeQueryPairs = (query = {}) => {
  const parts = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null || item === '') continue;
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
      }
      continue;
    }
    if (typeof value === 'object') {
      for (const [subKey, subValue] of Object.entries(value)) {
        if (subValue === undefined || subValue === null || subValue === '') continue;
        parts.push(`${encodeURIComponent(`${key}[${subKey}]`)}=${encodeURIComponent(String(subValue))}`);
      }
      continue;
    }
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.join('&');
};

const buildUrl = (baseUrl, path, query) => {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const normalizedPath = String(path || '').replace(/^\/+/, '');
  const qs = encodeQueryPairs(query);
  const joined = `${base}/${normalizedPath}`;
  return qs ? `${joined}?${qs}` : joined;
};

const fillPath = (template, params = {}) => template.replace(/\{([^}]+)\}/g, (_, key) => encodeURIComponent(requireString(params[key], key)));

const tryParseJson = (text) => {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
};

const toValue = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number') return Number.isFinite(value) ? { numberValue: value } : { stringValue: String(value) };
  if (Array.isArray(value)) {
    return { listValue: { values: value.map((item) => toValue(item) ?? { nullValue: 'NULL_VALUE' }) } };
  }
  if (typeof value === 'object') {
    const fields = {};
    for (const [key, item] of Object.entries(value)) {
      fields[key] = toValue(item) ?? { nullValue: 'NULL_VALUE' };
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(value) };
};

const inferResultsArray = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value.results)) return value.results;
  if (Array.isArray(value.list)) return value.list;
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.data)) return value.data;
  if (value.data && typeof value.data === 'object') {
    if (Array.isArray(value.data.items)) return value.data.items;
    if (Array.isArray(value.data.list)) return value.data.list;
  }
  return [];
};

const inferCount = (value, fallbackLength) => {
  if (value && typeof value === 'object') {
    for (const key of ['count', 'total', 'total_size', 'totalSize']) {
      const maybe = Number(value[key]);
      if (Number.isFinite(maybe)) return maybe;
    }
    if (value.pagination && typeof value.pagination === 'object') {
      for (const key of ['count', 'total', 'total_size', 'totalSize']) {
        const maybe = Number(value.pagination[key]);
        if (Number.isFinite(maybe)) return maybe;
      }
    }
    if (value.data && typeof value.data === 'object') {
      for (const key of ['count', 'total', 'total_size', 'totalSize']) {
        const maybe = Number(value.data[key]);
        if (Number.isFinite(maybe)) return maybe;
      }
    }
  }
  return fallbackLength;
};

const parseFilename = (contentDisposition = '') => {
  const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(String(contentDisposition));
  const raw = match?.[1] || match?.[2] || '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

const KEEP_EMPTY_OBJECT = Symbol('keepEmptyObject');
const preserveEmptyObjectTree = (value) => {
  if (Array.isArray(value)) return value.map((item) => preserveEmptyObjectTree(item));
  if (value && typeof value === 'object') {
    const out = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, preserveEmptyObjectTree(item)]));
    out[KEEP_EMPTY_OBJECT] = true;
    return out;
  }
  return value;
};

const sanitizeObject = (value) => {
  if (Array.isArray(value)) return value.map(sanitizeObject).filter((item) => item !== undefined);
  if (value && typeof value === 'object') {
    const preserveEmpty = value[KEEP_EMPTY_OBJECT] === true;
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const cleaned = sanitizeObject(item);
      if (cleaned === undefined) continue;
      if (Array.isArray(cleaned) && cleaned.length === 0) continue;
      if (typeof cleaned === 'object' && cleaned && !Array.isArray(cleaned) && Object.keys(cleaned).length === 0 && !preserveEmpty && cleaned[KEEP_EMPTY_OBJECT] !== true) continue;
      out[key] = cleaned;
    }
    if (preserveEmpty) out[KEEP_EMPTY_OBJECT] = true;
    return out;
  }
  if (value === undefined || value === null || value === '') return undefined;
  return value;
};

const parseListResponse = (result) => {
  const parsed = tryParseJson(result.body);
  const rawJson = parsed.ok ? parsed.value : undefined;
  const results = inferResultsArray(rawJson);
  return {
    http_status: result.httpStatus,
    raw_body: result.body,
    count: inferCount(rawJson, results.length),
    results: results.map((item) => toValue(item)),
    raw_json: toValue(rawJson),
  };
};

const parseObjectResponse = (result) => {
  const parsed = tryParseJson(result.body);
  return {
    http_status: result.httpStatus,
    raw_body: result.body,
    raw_json: toValue(parsed.ok ? parsed.value : undefined),
  };
};

const parseBlobResponse = (result) => {
  const parsed = tryParseJson(result.body);
  return {
    http_status: result.httpStatus,
    raw_body: result.body,
    content_type: result.headers.get?.('content-type') || '',
    filename: parseFilename(result.headers.get?.('content-disposition') || ''),
    raw_json: toValue(parsed.ok ? parsed.value : undefined),
  };
};

const fetchUpstream = async (url, ctx = {}, options = {}) => {
  const dispatcher = buildDispatcher(ctx.bindings || {});
  const timeoutMs = resolveTimeoutMs(ctx);
  const timeout = makeTimeoutSignal(timeoutMs);
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: buildRequestHeaders(ctx, options.headers || {}),
      body: options.body,
      signal: timeout.signal,
      dispatcher,
    });
    const body = await response.text();
    if (response.status >= 400) {
      const code = response.status === 401 || response.status === 403
        ? 'PERMISSION_DENIED'
        : response.status >= 500
          ? 'UNAVAILABLE'
          : 'FAILED_PRECONDITION';
      throw errorWithCode(code, `API7 request failed with HTTP ${response.status}: ${body || '(empty body)'}`);
    }
    return {
      httpStatus: response.status,
      body,
      headers: response.headers,
    };
  } catch (error) {
    if (error instanceof GrpcError) throw error;
    if (error?.name === 'AbortError') throw errorWithCode('UNAVAILABLE', `API7 request timed out after ${timeoutMs}ms`);
    throw errorWithCode('UNAVAILABLE', `API7 request failed: ${error?.message || error}`);
  } finally {
    timeout.clear();
    await dispatcher?.close?.();
  }
};

const addPagingQuery = (req, query) => {
  const page = toOptionalInt(reqField(req, 'page', 'page'), { min: 1 });
  const pageSize = toOptionalInt(reqField(req, 'page_size', 'pageSize'), { min: 1 });
  const direction = toTrimmedString(reqField(req, 'direction', 'direction'));
  const orderBy = toTrimmedString(reqField(req, 'order_by', 'orderBy'));
  const search = toTrimmedString(reqField(req, 'search', 'search'));
  if (page !== undefined) query.page = page;
  if (pageSize !== undefined) query.page_size = pageSize;
  if (direction) query.direction = direction;
  if (orderBy) query.order_by = orderBy;
  if (search) query.search = search;
  return query;
};

const gatewayGroupQuery = (req, ctx) => {
  const value = toTrimmedString(reqField(req, 'gateway_group_id', 'gatewayGroupId')) || resolveDefaultGatewayGroupId(ctx.bindings || {});
  return value ? { gateway_group_id: value } : {};
};

const withLabels = (req, query) => {
  const labels = req.labels && typeof req.labels === 'object' ? toStringMap(req.labels) : {};
  if (Object.keys(labels).length > 0) query.labels = labels;
  return query;
};

const operation = (method, responseKind, buildRequest) => ({ method, responseKind, buildRequest });

const OPERATIONS = {
  ListAuditLogs: operation('GET', 'list', (req, ctx) => ({
    path: '/api/audit_logs',
    query: addPagingQuery(req, {
      event_type: toTrimmedString(reqField(req, 'event_type', 'eventType')),
      operator_id: toTrimmedString(reqField(req, 'operator_id', 'operatorId')),
      gateway_group_id: toTrimmedString(reqField(req, 'gateway_group_id', 'gatewayGroupId')),
      resource_id: toTrimmedString(reqField(req, 'resource_id', 'resourceId')),
      start_at: toOptionalInt(reqField(req, 'start_at', 'startAt')),
      end_at: toOptionalInt(reqField(req, 'end_at', 'endAt')),
    }),
  })),
  ExportAuditLogs: operation('GET', 'blob', (req) => ({
    path: '/api/audit_logs/export',
    query: {
      format: requireString(reqField(req, 'format', 'format'), 'format'),
      event_type: toTrimmedString(reqField(req, 'event_type', 'eventType')),
      operator_id: toTrimmedString(reqField(req, 'operator_id', 'operatorId')),
      gateway_group_id: toTrimmedString(reqField(req, 'gateway_group_id', 'gatewayGroupId')),
      resource_id: toTrimmedString(reqField(req, 'resource_id', 'resourceId')),
      start_at: toOptionalInt(reqField(req, 'start_at', 'startAt')),
      end_at: toOptionalInt(reqField(req, 'end_at', 'endAt')),
    },
  })),
  ListAlertPolicies: operation('GET', 'list', (req) => ({
    path: '/api/alert/policies',
    query: withLabels(req, addPagingQuery(req, {
      status: toStringArray(req.status),
      severity: toStringArray(req.severity),
    })),
  })),
  ListAlertHistories: operation('GET', 'list', (req) => ({
    path: '/api/alert/policies/histories',
    query: addPagingQuery(req, {
      alert_policy_id: toTrimmedString(reqField(req, 'alert_policy_id', 'alertPolicyId')),
      severity: toStringArray(req.severity),
      start_at: toOptionalInt(reqField(req, 'start_at', 'startAt')),
      end_at: toOptionalInt(reqField(req, 'end_at', 'endAt')),
      gateway_group_id: toTrimmedString(reqField(req, 'gateway_group_id', 'gatewayGroupId')),
    }),
  })),
  ListUsers: operation('GET', 'list', (req) => ({
    path: '/api/users',
    query: addPagingQuery(req, { roles: toStringArray(req.roles) }),
  })),
  ListRoles: operation('GET', 'list', (req) => ({
    path: '/api/roles',
    query: withLabels(req, addPagingQuery(req, {})),
  })),
  ListTokens: operation('GET', 'list', (req) => ({ path: '/api/tokens', query: addPagingQuery(req, {}) })),
  ListConsumers: operation('GET', 'list', (req, ctx) => ({
    path: '/apisix/admin/consumers',
    query: withLabels(req, addPagingQuery(req, gatewayGroupQuery(req, ctx))),
  })),
  ListConsumerCredentials: operation('GET', 'list', (req, ctx) => ({
    path: fillPath('/apisix/admin/consumers/{username}/credentials', {
      username: requireString(reqField(req, 'username', 'username'), 'username'),
    }),
    query: withLabels(req, addPagingQuery(req, {
      ...gatewayGroupQuery(req, ctx),
      plugin_name: toTrimmedString(reqField(req, 'plugin_name', 'pluginName')),
    })),
  })),
  ListCertificates: operation('GET', 'list', (req, ctx) => ({
    path: '/apisix/admin/certificates',
    query: withLabels(req, addPagingQuery(req, {
      ...gatewayGroupQuery(req, ctx),
      sni_id: toTrimmedString(reqField(req, 'sni_id', 'sniId')),
      sni_name: toTrimmedString(reqField(req, 'sni_name', 'sniName')),
      exptime: toOptionalInt(reqField(req, 'exptime', 'exptime')),
    })),
  })),
  ListCACertificates: operation('GET', 'list', (req, ctx) => ({
    path: '/apisix/admin/ca_certificates',
    query: withLabels(req, addPagingQuery(req, {
      ...gatewayGroupQuery(req, ctx),
      sni_id: toTrimmedString(reqField(req, 'sni_id', 'sniId')),
      sni_name: toTrimmedString(reqField(req, 'sni_name', 'sniName')),
      exptime: toOptionalInt(reqField(req, 'exptime', 'exptime')),
    })),
  })),
  ListSNIs: operation('GET', 'list', (req, ctx) => ({
    path: '/apisix/admin/snis',
    query: withLabels(req, addPagingQuery(req, {
      ...gatewayGroupQuery(req, ctx),
      domain: toTrimmedString(reqField(req, 'domain', 'domain')),
      mtls_enabled: toOptionalBool(reqField(req, 'mtls_enabled', 'mtlsEnabled')),
    })),
  })),
  GetCertificateUsage: operation('GET', 'list', (req) => ({
    path: fillPath('/api/gateway_groups/{gateway_group_id}/certificates/{certificate_id}/usage', {
      gateway_group_id: requireString(reqField(req, 'gateway_group_id', 'gatewayGroupId'), 'gateway_group_id'),
      certificate_id: requireString(reqField(req, 'certificate_id', 'certificateId'), 'certificate_id'),
    }),
    query: addPagingQuery(req, {
      resource_type: toTrimmedString(reqField(req, 'resource_type', 'resourceType')),
    }),
  })),
  ListGatewayGroups: operation('GET', 'list', (req) => ({
    path: '/api/gateway_groups',
    query: withLabels(req, addPagingQuery(req, { name: toTrimmedString(req.name) })),
  })),
  ListGatewayInstances: operation('GET', 'list', (req) => ({
    path: fillPath('/api/gateway_groups/{gateway_group_id}/instances', {
      gateway_group_id: requireString(reqField(req, 'gateway_group_id', 'gatewayGroupId'), 'gateway_group_id'),
    }),
    query: addPagingQuery(req, {
      status: toTrimmedString(req.status),
      compatibility: toTrimmedString(req.compatibility),
    }),
  })),
  ListRoutes: operation('GET', 'list', (req, ctx) => ({
    path: '/apisix/admin/routes',
    query: addPagingQuery(req, {
      ...gatewayGroupQuery(req, ctx),
      service_id: requireString(reqField(req, 'service_id', 'serviceId'), 'service_id'),
      with_publish_info: toOptionalBool(reqField(req, 'with_publish_info', 'withPublishInfo')),
    }),
  })),
  ListServices: operation('GET', 'list', (req, ctx) => ({
    path: '/apisix/admin/services',
    query: withLabels(req, addPagingQuery(req, {
      ...gatewayGroupQuery(req, ctx),
      unhealthy_nodes: toOptionalBool(reqField(req, 'unhealthy_nodes', 'unhealthyNodes')),
      hosts: toTrimmedString(req.hosts),
      type: toTrimmedString(req.type),
      with_publish_info: toOptionalBool(reqField(req, 'with_publish_info', 'withPublishInfo')),
    })),
  })),
  ListGlobalRules: operation('GET', 'list', (req, ctx) => ({
    path: '/apisix/admin/global_rules',
    query: addPagingQuery(req, gatewayGroupQuery(req, ctx)),
  })),
  ListPlugins: operation('GET', 'object', (req) => ({
    path: '/apisix/admin/plugins',
    query: { subsystem: toTrimmedString(req.subsystem) },
  })),
  GetPluginSchema: operation('GET', 'object', (req) => ({
    path: fillPath('/apisix/admin/schema/plugins/{plugin_name}', {
      plugin_name: requireString(reqField(req, 'plugin_name', 'pluginName'), 'plugin_name'),
    }),
    query: { subsystem: toTrimmedString(req.subsystem) },
  })),
  ListApprovals: operation('GET', 'list', (req) => ({
    path: '/api/approvals',
    query: addPagingQuery(req, {
      status: toTrimmedString(req.status),
      result: toTrimmedString(req.result),
      event: toTrimmedString(req.event),
      resource_type: toTrimmedString(reqField(req, 'resource_type', 'resourceType')),
      resource_name: toTrimmedString(reqField(req, 'resource_name', 'resourceName')),
      operator_name: toTrimmedString(reqField(req, 'operator_name', 'operatorName')),
      applicant_name: toTrimmedString(reqField(req, 'applicant_name', 'applicantName')),
    }),
  })),
  ListSecretProviders: operation('GET', 'list', (req, ctx) => ({
    path: '/apisix/admin/secret_providers',
    query: addPagingQuery(req, gatewayGroupQuery(req, ctx)),
  })),
  GetSecretProviderUsage: operation('GET', 'list', (req) => ({
    path: fillPath('/api/gateway_groups/{gateway_group_id}/secret_providers/{secret_provider}/{secret_provider_id}/usage', {
      gateway_group_id: requireString(reqField(req, 'gateway_group_id', 'gatewayGroupId'), 'gateway_group_id'),
      secret_provider: requireString(reqField(req, 'secret_provider', 'secretProvider'), 'secret_provider'),
      secret_provider_id: requireString(reqField(req, 'secret_provider_id', 'secretProviderId'), 'secret_provider_id'),
    }),
    query: addPagingQuery(req, {
      resource_type: toTrimmedString(reqField(req, 'resource_type', 'resourceType')),
    }),
  })),
  ParseCertificate: operation('PUT', 'object', (req) => ({
    path: '/api/parse_certificate',
    body: { cert: requireString(req.cert, 'cert') },
  })),
  ValidateCertificateKey: operation('PUT', 'object', (req) => ({
    path: '/api/validate_cert_key',
    body: {
      cert: requireString(req.cert, 'cert'),
      key: requireString(req.key, 'key'),
    },
  })),
  ListDebugSessions: operation('GET', 'list', (req) => ({
    path: fillPath('/api/gateway_groups/{gateway_group_id}/debug_sessions', {
      gateway_group_id: requireString(reqField(req, 'gateway_group_id', 'gatewayGroupId'), 'gateway_group_id'),
    }),
    query: addPagingQuery(req, {}),
  })),
  ListDebugTraces: operation('GET', 'list', (req) => ({
    path: fillPath('/api/gateway_groups/{gateway_group_id}/debug_sessions/{debug_session_id}/traces', {
      gateway_group_id: requireString(reqField(req, 'gateway_group_id', 'gatewayGroupId'), 'gateway_group_id'),
      debug_session_id: requireString(reqField(req, 'debug_session_id', 'debugSessionId'), 'debug_session_id'),
    }),
  })),
  GetServiceHealthcheck: operation('GET', 'object', (req) => ({
    path: fillPath('/api/gateway_groups/{gateway_group_id}/services/{apisix_service_id}/healthcheck', {
      gateway_group_id: requireString(reqField(req, 'gateway_group_id', 'gatewayGroupId'), 'gateway_group_id'),
      apisix_service_id: requireString(reqField(req, 'apisix_service_id', 'apisixServiceId'), 'apisix_service_id'),
    }),
    query: {
      upstream_id: toTrimmedString(reqField(req, 'upstream_id', 'upstreamId')),
    },
  })),

  CreateToken: operation('POST', 'object', (req) => ({
    path: '/api/tokens',
    body: {
      name: requireString(req.name, 'name'),
      expires_at: firstDefined(toOptionalInt(reqField(req, 'expires_at', 'expiresAt')), Number(unwrapScalar(reqField(req, 'expires_at', 'expiresAt')))),
    },
  })),
  CreateConsumer: operation('POST', 'object', (req, ctx) => ({
    path: '/apisix/admin/consumers',
    query: { gateway_group_id: requireString(reqField(req, 'gateway_group_id', 'gatewayGroupId') || resolveDefaultGatewayGroupId(ctx.bindings || {}), 'gateway_group_id') },
    body: {
      username: requireString(req.username, 'username'),
      desc: toTrimmedString(req.desc),
      labels: toStringMap(req.labels),
      plugins: preserveEmptyObjectTree(structToPlainObject(req.plugins)),
    },
  })),
  CreateConsumerCredential: operation('POST', 'object', (req, ctx) => ({
    path: fillPath('/apisix/admin/consumers/{username}/credentials', {
      username: requireString(req.username, 'username'),
    }),
    query: { gateway_group_id: requireString(reqField(req, 'gateway_group_id', 'gatewayGroupId') || resolveDefaultGatewayGroupId(ctx.bindings || {}), 'gateway_group_id') },
    body: {
      name: requireString(req.name, 'name'),
      desc: toTrimmedString(req.desc),
      labels: toStringMap(req.labels),
      plugins: preserveEmptyObjectTree(structToPlainObject(req.plugins) ?? {}),
    },
  })),
  CreateCertificate: operation('POST', 'object', (req, ctx) => ({
    path: '/apisix/admin/certificates',
    query: { gateway_group_id: requireString(reqField(req, 'gateway_group_id', 'gatewayGroupId') || resolveDefaultGatewayGroupId(ctx.bindings || {}), 'gateway_group_id') },
    body: {
      name: toTrimmedString(req.name),
      desc: toTrimmedString(req.desc),
      labels: toStringMap(req.labels),
      cert: requireString(req.cert, 'cert'),
      key: requireString(req.key, 'key'),
    },
  })),
  CreateSNI: operation('POST', 'object', (req, ctx) => ({
    path: '/apisix/admin/snis',
    query: { gateway_group_id: requireString(reqField(req, 'gateway_group_id', 'gatewayGroupId') || resolveDefaultGatewayGroupId(ctx.bindings || {}), 'gateway_group_id') },
    body: {
      name: toTrimmedString(req.name),
      desc: toTrimmedString(req.desc),
      domain: requireString(req.domain, 'domain'),
      certificates: toStringArray(req.certificates),
      mtls: structToPlainObject(req.mtls),
      plugins: preserveEmptyObjectTree(structToPlainObject(req.plugins)),
    },
  })),
  CreateService: operation('POST', 'object', (req, ctx) => {
    const upstreamNodes = firstDefined(req.upstream_nodes, req.upstreamNodes);
    const normalizedUpstreamNodes = (Array.isArray(upstreamNodes) ? upstreamNodes : []).map((node) => ({
      host: requireString(node.host, 'upstream_nodes.host'),
      port: requireNumber(node.port, 'upstream_nodes.port'),
      weight: requireNumber(node.weight, 'upstream_nodes.weight'),
      ...(toOptionalInt(node.priority) !== undefined ? { priority: toOptionalInt(node.priority) } : {}),
    }));
    if (normalizedUpstreamNodes.length === 0) {
      throw errorWithCode('INVALID_ARGUMENT', 'CreateService requires upstream_nodes/upstreamNodes with at least one node');
    }
    return ({
      path: '/apisix/admin/services',
      query: { gateway_group_id: requireString(reqField(req, 'gateway_group_id', 'gatewayGroupId') || resolveDefaultGatewayGroupId(ctx.bindings || {}), 'gateway_group_id') },
      body: {
        name: requireString(req.name, 'name'),
        desc: toTrimmedString(req.desc),
        labels: toStringMap(req.labels),
        type: requireString(req.type || 'http', 'type'),
        hosts: toStringArray(req.hosts),
        path_prefix: toTrimmedString(reqField(req, 'path_prefix', 'pathPrefix')),
        strip_path_prefix: toOptionalBool(reqField(req, 'strip_path_prefix', 'stripPathPrefix')),
        plugins: preserveEmptyObjectTree(structToPlainObject(req.plugins)),
        upstream: {
          scheme: toTrimmedString(reqField(req, 'upstream_scheme', 'upstreamScheme')) || 'http',
          pass_host: toTrimmedString(reqField(req, 'upstream_pass_host', 'upstreamPassHost')) || 'pass',
          upstream_host: toTrimmedString(reqField(req, 'upstream_host', 'upstreamHost')),
          nodes: normalizedUpstreamNodes,
        },
      },
    });
  }),
  CreateRoute: operation('POST', 'object', (req, ctx) => ({
    path: '/apisix/admin/routes',
    query: { gateway_group_id: requireString(reqField(req, 'gateway_group_id', 'gatewayGroupId') || resolveDefaultGatewayGroupId(ctx.bindings || {}), 'gateway_group_id') },
    body: {
      service_id: requireString(reqField(req, 'service_id', 'serviceId'), 'service_id'),
      name: requireString(req.name, 'name'),
      desc: toTrimmedString(req.desc),
      labels: toStringMap(req.labels),
      methods: toStringArray(req.methods),
      paths: toStringArray(req.paths),
      priority: toOptionalInt(req.priority) ?? 0,
      enable_websocket: toOptionalBool(reqField(req, 'enable_websocket', 'enableWebsocket')),
      plugins: preserveEmptyObjectTree(structToPlainObject(req.plugins)),
      timeout: structToPlainObject(req.timeout),
      vars: listValueToPlainArray(req.vars),
    },
  })),
  CreateGlobalRule: operation('POST', 'object', (req, ctx) => ({
    path: '/apisix/admin/global_rules',
    query: { gateway_group_id: requireString(reqField(req, 'gateway_group_id', 'gatewayGroupId') || resolveDefaultGatewayGroupId(ctx.bindings || {}), 'gateway_group_id') },
    body: {
      plugins: preserveEmptyObjectTree(structToPlainObject(req.plugins) ?? {}),
    },
  })),
};

const executeOperation = async (name, req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const op = OPERATIONS[name];
  if (!op) throw errorWithCode('UNKNOWN', `unsupported API7 operation: ${name}`);
  const built = op.buildRequest(req, callCtx);
  const url = buildUrl(requireBaseUrl(callCtx), built.path, built.query);
  const result = await fetchUpstream(url, callCtx, {
    method: op.method,
    body: built.body ? JSON.stringify(sanitizeObject(built.body)) : undefined,
    headers: built.body ? { 'Content-Type': 'application/json' } : {},
  });
  if (op.responseKind === 'blob') return parseBlobResponse(result);
  if (op.responseKind === 'object') return parseObjectResponse(result);
  return parseListResponse(result);
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return Object.fromEntries(METHOD_SPECS.map(([name]) => [METHOD_PATHS[name], async (req) => executeOperation(name, req ?? callCtx.req ?? {}, callCtx)]));
}

const wrapHandler = (name) => async (reqOrCtx = {}, maybeCtx) => {
  const { req, ctx } = resolveHandlerArgs(reqOrCtx, maybeCtx);
  return executeOperation(name, req, ctx);
};

export const handlers = Object.fromEntries(METHOD_SPECS.map(([name]) => [METHOD_FULLS[name], wrapHandler(name)]));

export const _test = {
  addPagingQuery,
  buildDispatcher,
  buildRequestHeaders,
  buildUrl,
  encodeQueryPairs,
  fillPath,
  inferCount,
  inferResultsArray,
  mergedBindings,
  normalizeBaseUrl,
  parseHeaders,
  resolveApiKey,
  resolveBaseUrl,
  resolveDefaultGatewayGroupId,
  resolveUsername,
  resolvePassword,
  toOptionalBool,
  toOptionalInt,
  toStringArray,
  toStringMap,
  toTrimmedString,
  structToPlainObject,
  listValueToPlainArray,
  sanitizeObject,
};
