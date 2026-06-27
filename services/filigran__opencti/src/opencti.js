// Filigran_OPENCTI OpenCTI Threat Intelligence Platform API implementation
// GraphQL API with Bearer Token authentication.
//
// Endpoint: configurable (http://opencti-instance.example.com:8080)

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

// ── Constants ──────────────────────────────────────────────

const SERVICE_NAME = 'Filigran_OPENCTI';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_FIRST = 20;

// ── Method paths ───────────────────────────────────────────

export const SEARCH_INDICATORS_PATH = '/Filigran_OPENCTI.Filigran_OPENCTI/SearchIndicators';
export const SEARCH_OBSERVABLES_PATH = '/Filigran_OPENCTI.Filigran_OPENCTI/SearchObservables';
export const SEARCH_REPORTS_PATH = '/Filigran_OPENCTI.Filigran_OPENCTI/SearchReports';
export const CREATE_INDICATOR_PATH = '/Filigran_OPENCTI.Filigran_OPENCTI/CreateIndicator';
export const CREATE_OBSERVABLE_PATH = '/Filigran_OPENCTI.Filigran_OPENCTI/CreateObservable';
export const CREATE_REPORT_PATH = '/Filigran_OPENCTI.Filigran_OPENCTI/CreateReport';

export const SEARCH_INDICATORS_FULL = 'Filigran_OPENCTI.Filigran_OPENCTI/SearchIndicators';
export const SEARCH_OBSERVABLES_FULL = 'Filigran_OPENCTI.Filigran_OPENCTI/SearchObservables';
export const SEARCH_REPORTS_FULL = 'Filigran_OPENCTI.Filigran_OPENCTI/SearchReports';
export const CREATE_INDICATOR_FULL = 'Filigran_OPENCTI.Filigran_OPENCTI/CreateIndicator';
export const CREATE_OBSERVABLE_FULL = 'Filigran_OPENCTI.Filigran_OPENCTI/CreateObservable';
export const CREATE_REPORT_FULL = 'Filigran_OPENCTI.Filigran_OPENCTI/CreateReport';

// ── Observable type → GraphQL field name mapping ───────────

const OBSERVABLE_TYPE_FIELDS = {
  'IPv4-Addr': 'IPv4Addr',
  'IPv6-Addr': 'IPv6Addr',
  'Domain-Name': 'DomainName',
  'Url': 'Url',
  'Hostname': 'Hostname',
  'Email-Addr': 'EmailAddress',
  'File': 'File',
  'Artifact': 'Artifact',
  'Mac-Addr': 'MacAddr',
  'Text': 'Text',
  'Cryptographic-Key': 'CryptographicKey',
  'User-Account': 'UserAccount',
  'Mutex': 'Mutex',
  'Process': 'Process',
  'Software': 'Software',
  'Network-Traffic': 'NetworkTraffic',
  'IPv4-Addr-Range': 'IPv4AddrRange',
  'IPv6-Addr-Range': 'IPv6AddrRange',
};

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

// Escape a string for use inside a GraphQL string literal.
// Must escape backslashes first (before quotes) to avoid creating
// unintended escape sequences, and then escape double quotes.
const gqlEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\\"');

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
  const apiToken = toTrimmedString(firstDefined(bindings.api_token, bindings.apiToken));
  if (!apiToken) throw errorWithCode('FAILED_PRECONDITION', 'binding "api_token" or "apiToken" is required but not configured');
  return { apiToken };
};

const resolveEndpoint = (bindings = {}) => {
  const endpoint = toTrimmedString(firstDefined(bindings.endpoint));
  if (!endpoint) throw errorWithCode('FAILED_PRECONDITION', 'binding "endpoint" is required but not configured');
  return endpoint.replace(/\/+$/, '');
};

// ── GraphQL API call ───────────────────────────────────────

const callOpenCTI = async (ctx, query, variables = {}) => {
  const bindings = mergedBindings(ctx);
  const credentials = resolveCredentials(bindings);
  const endpoint = resolveEndpoint(bindings);
  const timeoutMs = resolveTimeoutMs(bindings, ctx.limits);
  const meta = ctx.meta || {};

  const url = endpoint + '/graphql';

  const headers = {
    'Authorization': 'Bearer ' + credentials.apiToken,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'x-engine-instance': meta.instance_id || meta.instanceId || 'unknown',
    'x-request-id': meta.request_id || meta.requestId || 'unknown',
  };

  const skipVerify = toBoolean(bindings.skipTlsVerify);
  const tlsOptions = skipVerify ? { insecureSkipVerify: true, tlsInsecureSkipVerify: true } : {};

  logFlow(meta, 'graphql:start', { query: query.substring(0, 100) });

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
      ...tlsOptions,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    const reason = isTimeout ? 'timeout after ' + timeoutMs + 'ms' : (err?.cause?.message || err?.message || 'fetch failed');
    logFlow(meta, 'graphql:error', { error: reason });
    throw errorWithCode('UNAVAILABLE', 'upstream error: ' + reason);
  }

  const text = await res.text();

  if (res.status === 401) {
    logFlow(meta, 'graphql:unauthenticated', { status: res.status });
    throw errorWithCode('UNAUTHENTICATED', 'upstream http ' + res.status + ': ' + text);
  }

  if (res.status === 403) {
    logFlow(meta, 'graphql:auth-error', { status: res.status });
    throw errorWithCode('PERMISSION_DENIED', 'upstream http ' + res.status + ': ' + text);
  }

  if (res.status >= 400 && res.status < 500) {
    logFlow(meta, 'graphql:client-error', { status: res.status, response: text });
    throw errorWithCode('FAILED_PRECONDITION', 'upstream http ' + res.status + ': ' + text);
  }

  if (res.status >= 500) {
    logFlow(meta, 'graphql:server-error', { status: res.status });
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

  // OpenCTI GraphQL error handling
  if (json?.errors && json.errors.length > 0) {
    const firstError = json.errors[0];
    const message = firstError?.message || JSON.stringify(json.errors);
    const code = firstError?.extensions?.code || firstError?.name || '';

    // Map OpenCTI specific error codes
    if (code === 'GRAPHQL_VALIDATION_FAILED') {
      logFlow(meta, 'graphql:validation-error', { errors: json.errors });
      throw errorWithCode('INVALID_ARGUMENT', 'OpenCTI GraphQL validation: ' + message);
    }
    if (code === 'FUNCTIONAL_ERROR') {
      logFlow(meta, 'graphql:business-error', { errors: json.errors });
      throw errorWithCode('FAILED_PRECONDITION', 'OpenCTI functional error: ' + message);
    }
    if (code === 'RESOURCE_NOT_FOUND') {
      logFlow(meta, 'graphql:not-found', { errors: json.errors });
      throw errorWithCode('FAILED_PRECONDITION', 'OpenCTI resource not found: ' + message);
    }
    if (code === 'ACCESS_REQUIRED' || code === 'FORBIDDEN_ACCESS') {
      logFlow(meta, 'graphql:access-error', { errors: json.errors });
      throw errorWithCode('PERMISSION_DENIED', 'OpenCTI access denied: ' + message);
    }

    logFlow(meta, 'graphql:api-error', { errors: json.errors });
    throw errorWithCode('FAILED_PRECONDITION', 'OpenCTI API error: ' + message);
  }

  logFlow(meta, 'graphql:done', {});
  return json.data;
};

// ── Response mappers ───────────────────────────────────────

const mapIndicator = (node) => ({
  id: String(node?.id ?? ''),
  standard_id: String(node?.standard_id ?? ''),
  name: String(node?.name ?? ''),
  pattern_type: String(node?.pattern_type ?? ''),
  pattern: String(node?.pattern ?? ''),
  valid_from: String(node?.valid_from ?? ''),
  valid_until: String(node?.valid_until ?? ''),
  indicator_types: Array.isArray(node?.indicator_types) ? node.indicator_types : [],
  description: String(node?.description ?? ''),
  // Proto field is "score" (field #10), not "x_opencti_score".
  // Map from the OpenCTI GraphQL field x_opencti_score → proto score.
  score: String(node?.x_opencti_score ?? ''),
});

const mapObservable = (node) => ({
  id: String(node?.id ?? ''),
  standard_id: String(node?.standard_id ?? ''),
  entity_type: String(node?.entity_type ?? ''),
  observable_value: String(node?.observable_value ?? ''),
});

const mapReport = (node) => ({
  id: String(node?.id ?? ''),
  standard_id: String(node?.standard_id ?? ''),
  name: String(node?.name ?? ''),
  description: String(node?.description ?? ''),
  published: String(node?.published ?? ''),
  report_types: Array.isArray(node?.report_types) ? node.report_types : [],
});

// ── GraphQL query builders ─────────────────────────────────

const buildSearchIndicatorsQuery = (req) => {
  const first = toInt64(req.first) ?? DEFAULT_FIRST;
  const search = toTrimmedString(req.search);
  const cursor = toTrimmedString(req.cursor);
  const indicatorTypes = req.indicator_types ?? [];

  const args = [`first: ${first}`];
  if (search) args.push(`search: "${gqlEscape(search)}"`);
  if (cursor) args.push(`after: "${gqlEscape(cursor)}"`);
  if (indicatorTypes.length > 0) {
    const filterStr = indicatorTypes.map(t => `"${gqlEscape(t)}"`).join(', ');
    args.push(`filters: [{key: "indicator_types", values: [${filterStr}]}]`);
  }

  return `query { indicators(${args.join(', ')}) { edges { node { id standard_id name pattern_type pattern valid_from valid_until indicator_types description x_opencti_score } } pageInfo { globalCount hasNextPage } } }`;
};

const buildSearchObservablesQuery = (req) => {
  const first = toInt64(req.first) ?? DEFAULT_FIRST;
  const search = toTrimmedString(req.search);
  const cursor = toTrimmedString(req.cursor);
  const entityTypes = req.entity_types ?? [];

  const args = [`first: ${first}`];
  if (search) args.push(`search: "${gqlEscape(search)}"`);
  if (cursor) args.push(`after: "${gqlEscape(cursor)}"`);
  if (entityTypes.length > 0) {
    const filterStr = entityTypes.map(t => `"${gqlEscape(t)}"`).join(', ');
    args.push(`filters: [{key: "entity_type", values: [${filterStr}]}]`);
  }

  return `query { stixCyberObservables(${args.join(', ')}) { edges { node { id standard_id entity_type observable_value } } pageInfo { globalCount hasNextPage } } }`;
};

const buildSearchReportsQuery = (req) => {
  const first = toInt64(req.first) ?? DEFAULT_FIRST;
  const search = toTrimmedString(req.search);
  const cursor = toTrimmedString(req.cursor);
  const reportTypes = req.report_types ?? [];

  const args = [`first: ${first}`];
  if (search) args.push(`search: "${gqlEscape(search)}"`);
  if (cursor) args.push(`after: "${gqlEscape(cursor)}"`);
  if (reportTypes.length > 0) {
    const filterStr = reportTypes.map(t => `"${gqlEscape(t)}"`).join(', ');
    args.push(`filters: [{key: "report_types", values: [${filterStr}]}]`);
  }

  return `query { reports(${args.join(', ')}) { edges { node { id standard_id name description published report_types } } pageInfo { globalCount hasNextPage } } }`;
};

// ── API method implementations ─────────────────────────────

const searchIndicators = async (req = {}, ctx = {}) => {
  const query = buildSearchIndicatorsQuery(req);
  const data = await callOpenCTI(ctx, query);

  const connection = data?.indicators ?? {};
  const edges = Array.isArray(connection?.edges) ? connection.edges : [];
  const pageInfo = connection?.pageInfo ?? {};

  return {
    items: edges.map(e => mapIndicator(e?.node)),
    total: toInt64(pageInfo.globalCount) ?? 0,
    has_next_page: toBoolean(pageInfo.hasNextPage),
  };
};

const searchObservables = async (req = {}, ctx = {}) => {
  const query = buildSearchObservablesQuery(req);
  const data = await callOpenCTI(ctx, query);

  const connection = data?.stixCyberObservables ?? {};
  const edges = Array.isArray(connection?.edges) ? connection.edges : [];
  const pageInfo = connection?.pageInfo ?? {};

  return {
    items: edges.map(e => mapObservable(e?.node)),
    total: toInt64(pageInfo.globalCount) ?? 0,
    has_next_page: toBoolean(pageInfo.hasNextPage),
  };
};

const searchReports = async (req = {}, ctx = {}) => {
  const query = buildSearchReportsQuery(req);
  const data = await callOpenCTI(ctx, query);

  const connection = data?.reports ?? {};
  const edges = Array.isArray(connection?.edges) ? connection.edges : [];
  const pageInfo = connection?.pageInfo ?? {};

  return {
    items: edges.map(e => mapReport(e?.node)),
    total: toInt64(pageInfo.globalCount) ?? 0,
    has_next_page: toBoolean(pageInfo.hasNextPage),
  };
};

const createIndicator = async (req = {}, ctx = {}) => {
  const name = toTrimmedString(firstDefined(req.name));
  if (!name) throw errorWithCode('INVALID_ARGUMENT', 'name is required');
  const patternType = toTrimmedString(firstDefined(req.pattern_type, req.patternType));
  if (!patternType) throw errorWithCode('INVALID_ARGUMENT', 'pattern_type is required');
  const pattern = toTrimmedString(firstDefined(req.pattern));
  if (!pattern) throw errorWithCode('INVALID_ARGUMENT', 'pattern is required');
  const indicatorTypes = req.indicator_types ?? req.indicatorTypes ?? [];
  if (!Array.isArray(indicatorTypes) || indicatorTypes.length === 0) {
    throw errorWithCode('INVALID_ARGUMENT', 'indicator_types must be a non-empty array');
  }

  const inputFields = [];
  inputFields.push(`name: "${gqlEscape(name)}"`);
  inputFields.push(`pattern_type: "${gqlEscape(patternType)}"`);
  inputFields.push(`pattern: "${gqlEscape(pattern)}"`);

  const validFrom = toTrimmedString(firstDefined(req.valid_from, req.validFrom));
  if (validFrom) inputFields.push(`valid_from: "${gqlEscape(validFrom)}"`);

  const validUntil = toTrimmedString(firstDefined(req.valid_until, req.validUntil));
  if (validUntil) inputFields.push(`valid_until: "${gqlEscape(validUntil)}"`);

  const description = toTrimmedString(firstDefined(req.description));
  if (description) inputFields.push(`description: "${gqlEscape(description)}"`);

  const score = toInt64(req.score);
  if (score !== null) inputFields.push(`x_opencti_score: ${score}`);

  inputFields.push(`indicator_types: [${indicatorTypes.map(t => `"${gqlEscape(t)}"`).join(', ')}]`);

  const query = `mutation { indicatorAdd(input: {${inputFields.join(', ')}}) { id standard_id name pattern_type pattern valid_from valid_until indicator_types description x_opencti_score } }`;

  const data = await callOpenCTI(ctx, query);
  const indicator = data?.indicatorAdd;
  if (!indicator) throw errorWithCode('UNKNOWN', 'indicatorAdd returned null');

  return { indicator: mapIndicator(indicator) };
};

const createObservable = async (req = {}, ctx = {}) => {
  const type = toTrimmedString(firstDefined(req.type));
  if (!type) throw errorWithCode('INVALID_ARGUMENT', 'type is required');
  const value = toTrimmedString(firstDefined(req.value));
  if (!value) throw errorWithCode('INVALID_ARGUMENT', 'value is required');

  // Map observable type to GraphQL field name
  const fieldName = OBSERVABLE_TYPE_FIELDS[type];
  if (!fieldName) {
    throw errorWithCode('INVALID_ARGUMENT', `unsupported observable type "${type}"; supported: ${Object.keys(OBSERVABLE_TYPE_FIELDS).join(', ')}`);
  }

  // Build mutation with type-specific value field
  const escapedValue = gqlEscape(value);

  // File type: auto-detect hash algorithm from value length.
  // MD5 = 32 hex chars, SHA256 = 64 hex chars, SHA1 = 40 hex chars.
  // For non-hash values (e.g. filenames), use simple {value: "..."}.
  let fieldValueArg;
  if (type === 'File') {
    const hexOnly = value.replace(/[^0-9a-fA-F]/g, '');
    if (hexOnly.length === 32) {
      fieldValueArg = `{ hashes: { MD5: "${escapedValue}" } }`;
    } else if (hexOnly.length === 40) {
      fieldValueArg = `{ hashes: { SHA1: "${escapedValue}" } }`;
    } else if (hexOnly.length === 64) {
      fieldValueArg = `{ hashes: { SHA256: "${escapedValue}" } }`;
    } else {
      // Not a recognized hash format; treat as filename/identifier
      fieldValueArg = `{ value: "${escapedValue}" }`;
    }
  } else {
    fieldValueArg = `{ value: "${escapedValue}" }`;
  }

  const query = `mutation { stixCyberObservableAdd(type: "${type}", ${fieldName}: ${fieldValueArg}) { id standard_id entity_type observable_value } }`;

  const data = await callOpenCTI(ctx, query);
  const observable = data?.stixCyberObservableAdd;
  if (!observable) throw errorWithCode('UNKNOWN', 'stixCyberObservableAdd returned null');

  return { observable: mapObservable(observable) };
};

const createReport = async (req = {}, ctx = {}) => {
  const name = toTrimmedString(firstDefined(req.name));
  if (!name) throw errorWithCode('INVALID_ARGUMENT', 'name is required');
  const published = toTrimmedString(firstDefined(req.published));
  if (!published) throw errorWithCode('INVALID_ARGUMENT', 'published is required');

  const inputFields = [];
  inputFields.push(`name: "${gqlEscape(name)}"`);
  inputFields.push(`published: "${gqlEscape(published)}"`);

  const description = toTrimmedString(firstDefined(req.description));
  if (description) inputFields.push(`description: "${gqlEscape(description)}"`);

  const reportTypes = req.report_types ?? req.reportTypes ?? [];
  if (Array.isArray(reportTypes) && reportTypes.length > 0) {
    inputFields.push(`report_types: [${reportTypes.map(t => `"${gqlEscape(t)}"`).join(', ')}]`);
  }

  const query = `mutation { reportAdd(input: {${inputFields.join(', ')}}) { id standard_id name description published report_types } }`;

  const data = await callOpenCTI(ctx, query);
  const report = data?.reportAdd;
  if (!report) throw errorWithCode('UNKNOWN', 'reportAdd returned null');

  return { report: mapReport(report) };
};

// ── rpcdef (filter-style handler) ──────────────────────────

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [SEARCH_INDICATORS_PATH]: async (req) => searchIndicators(req ?? callCtx.req, callCtx),
    [SEARCH_OBSERVABLES_PATH]: async (req) => searchObservables(req ?? callCtx.req, callCtx),
    [SEARCH_REPORTS_PATH]: async (req) => searchReports(req ?? callCtx.req, callCtx),
    [CREATE_INDICATOR_PATH]: async (req) => createIndicator(req ?? callCtx.req, callCtx),
    [CREATE_OBSERVABLE_PATH]: async (req) => createObservable(req ?? callCtx.req, callCtx),
    [CREATE_REPORT_PATH]: async (req) => createReport(req ?? callCtx.req, callCtx),
  };
}

// ── SDK handlers (single-ctx style, compatible with OctoBus SDK) ──

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
sdkHandlers[SEARCH_INDICATORS_FULL] = wrapLegacyHandler({}, searchIndicators);
sdkHandlers[SEARCH_OBSERVABLES_FULL] = wrapLegacyHandler({}, searchObservables);
sdkHandlers[SEARCH_REPORTS_FULL] = wrapLegacyHandler({}, searchReports);
sdkHandlers[CREATE_INDICATOR_FULL] = wrapLegacyHandler({}, createIndicator);
sdkHandlers[CREATE_OBSERVABLE_FULL] = wrapLegacyHandler({}, createObservable);
sdkHandlers[CREATE_REPORT_FULL] = wrapLegacyHandler({}, createReport);

export const handlers = {
  [SEARCH_INDICATORS_FULL]: (ctx) => sdkHandlers[SEARCH_INDICATORS_FULL](ctx),
  [SEARCH_OBSERVABLES_FULL]: (ctx) => sdkHandlers[SEARCH_OBSERVABLES_FULL](ctx),
  [SEARCH_REPORTS_FULL]: (ctx) => sdkHandlers[SEARCH_REPORTS_FULL](ctx),
  [CREATE_INDICATOR_FULL]: (ctx) => sdkHandlers[CREATE_INDICATOR_FULL](ctx),
  [CREATE_OBSERVABLE_FULL]: (ctx) => sdkHandlers[CREATE_OBSERVABLE_FULL](ctx),
  [CREATE_REPORT_FULL]: (ctx) => sdkHandlers[CREATE_REPORT_FULL](ctx),
};

// ── Test exports ───────────────────────────────────────────

export const _test = {
  callOpenCTI,
  errorWithCode,
  firstDefined,
  gqlEscape,
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
  mapIndicator,
  mapObservable,
  mapReport,
  buildSearchIndicatorsQuery,
  buildSearchObservablesQuery,
  buildSearchReportsQuery,
  searchIndicators,
  searchObservables,
  searchReports,
  createIndicator,
  createObservable,
  createReport,
  OBSERVABLE_TYPE_FIELDS,
};
