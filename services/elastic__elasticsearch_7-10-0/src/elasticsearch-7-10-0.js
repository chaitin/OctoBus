import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const METHOD_CLUSTER_HEALTH_PATH = '/Elasticsearch_7_10_0.Elasticsearch_7_10_0/ClusterHealth';
export const METHOD_LIST_INDICES_PATH = '/Elasticsearch_7_10_0.Elasticsearch_7_10_0/ListIndices';
export const METHOD_GET_INDEX_PATH = '/Elasticsearch_7_10_0.Elasticsearch_7_10_0/GetIndex';
export const METHOD_SEARCH_DOCUMENTS_PATH = '/Elasticsearch_7_10_0.Elasticsearch_7_10_0/SearchDocuments';
export const METHOD_LIST_NODES_PATH = '/Elasticsearch_7_10_0.Elasticsearch_7_10_0/ListNodes';

export const METHOD_CLUSTER_HEALTH_FULL = 'Elasticsearch_7_10_0.Elasticsearch_7_10_0/ClusterHealth';
export const METHOD_LIST_INDICES_FULL = 'Elasticsearch_7_10_0.Elasticsearch_7_10_0/ListIndices';
export const METHOD_GET_INDEX_FULL = 'Elasticsearch_7_10_0.Elasticsearch_7_10_0/GetIndex';
export const METHOD_SEARCH_DOCUMENTS_FULL = 'Elasticsearch_7_10_0.Elasticsearch_7_10_0/SearchDocuments';
export const METHOD_LIST_NODES_FULL = 'Elasticsearch_7_10_0.Elasticsearch_7_10_0/ListNodes';

export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_CLUSTER_HEALTH_LEVEL = '';
export const DEFAULT_LIST_NODES_BYTES = '';
export const DEFAULT_SEARCH_QUERY = '{"match_all":{}}';
export const DEFAULT_SEARCH_SIZE = 10;
export const DEFAULT_SEARCH_FROM = 0;

const VALID_HEALTH_LEVELS = new Set(['cluster', 'indices', 'shards']);
const VALID_WAIT_FOR_STATUS = new Set(['green', 'yellow', 'red']);
const VALID_BYTES_UNITS = new Set(['b', 'k', 'kb', 'm', 'mb', 'g', 'gb']);

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const toTrimmedString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

const toJsonString = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return ''; }
};

const toFiniteInt = (value, fallback = 0) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return fallback;
  const num = Number(raw);
  return Number.isFinite(num) ? Math.trunc(num) : fallback;
};

const toFiniteNumber = (value, fallback = 0) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return fallback;
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallback;
};

const toBool = (value, fallback = false) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  }
  return fallback;
};

const normalizeBaseUrl = (value) => {
  const raw = toTrimmedString(value);
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.replace(/\/+$/, '');
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

const resolveBaseUrl = (bindings = {}) => normalizeBaseUrl(firstDefined(
  bindings.baseUrl,
  bindings.elasticsearch_domain,
  bindings.restBaseUrl,
  bindings.domain,
  bindings.url,
));

const resolveUsername = (bindings = {}) => toTrimmedString(firstDefined(
  bindings.username,
  bindings.elasticsearch_username,
  bindings.user,
));

const resolvePassword = (bindings = {}) => toTrimmedString(firstDefined(
  bindings.password,
  bindings.elasticsearch_password,
  bindings.passwd,
));

const resolveTimeoutMs = (ctx = {}) => {
  const raw = Number(firstDefined(ctx.limits?.timeoutMs, ctx.bindings?.timeoutMs, DEFAULT_TIMEOUT_MS));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

const buildTlsOptions = (bindings = {}) => {
  const enabled = Boolean(bindings.skipTlsVerify || bindings.tlsInsecureSkipVerify || bindings.insecureSkipVerify);
  if (!enabled) return {};
  return { skipTlsVerify: true, tlsInsecureSkipVerify: true, insecureSkipVerify: true };
};

const requireBaseUrl = (ctx = {}) => {
  const baseUrl = resolveBaseUrl(ctx.bindings || {});
  if (!baseUrl) throw errorWithCode('INVALID_ARGUMENT', 'baseUrl is required in bindings');
  return baseUrl;
};

const requireCredentials = (ctx = {}) => {
  const username = resolveUsername(ctx.bindings || {});
  const password = resolvePassword(ctx.bindings || {});
  if (!username || !password) throw errorWithCode('INVALID_ARGUMENT', 'username and password are required in secret bindings');
  return { username, password };
};

const requireIndex = (req = {}) => {
  const index = toTrimmedString(firstDefined(req.index, req.index_name));
  if (!index) throw errorWithCode('INVALID_ARGUMENT', 'index is required');
  return index;
};

const requireSearchIndex = (req = {}) => {
  const index = toTrimmedString(firstDefined(req.index, req.index_name));
  if (!index) throw errorWithCode('INVALID_ARGUMENT', 'index is required for SearchDocuments');
  return index;
};

const buildBasicAuth = (username, password) => {
  const raw = `${String(username ?? '')}:${String(password ?? '')}`;
  return `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`;
};

const encodeQueryPairs = (query = {}) => {
  const parts = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.join('&');
};

const joinPath = (baseUrl, path) => {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const normalizedPath = String(path || '').replace(/^\/+/, '');
  return `${base}/${normalizedPath}`;
};

const buildUrl = (baseUrl, path, query = {}) => {
  const joined = joinPath(baseUrl, path);
  const qs = encodeQueryPairs(query);
  return qs ? `${joined}?${qs}` : joined;
};

const buildLogPrefix = (ctx = {}, action) => {
  const meta = ctx.meta || {};
  const trace = [];
  if (meta.instance_id || meta.instanceId) trace.push(`inst=${meta.instance_id || meta.instanceId}`);
  if (meta.request_id || meta.requestId) trace.push(`req=${meta.request_id || meta.requestId}`);
  return `[Elasticsearch_7_10_0][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
};

const logFlow = (ctx, action, details) => {
  const prefix = buildLogPrefix(ctx, action);
  try { console.log(prefix, JSON.stringify(details)); } catch { console.log(prefix, details); }
};

const attachResponse = (err, response) => { err.response = response; return err; };

const tryParseJson = (text) => {
  try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false }; }
};

const mapHttpStatusToCode = (httpStatus) => {
  if (httpStatus === 401 || httpStatus === 403) return 'PERMISSION_DENIED';
  if (httpStatus >= 400 && httpStatus < 500) return 'FAILED_PRECONDITION';
  return 'UNAVAILABLE';
};

const executeRequest = async (url, ctx = {}, options = {}) => {
  const bindings = ctx.bindings || {};
  const timeoutMs = resolveTimeoutMs(ctx);
  const headers = { Accept: 'application/json', ...(options.headers ?? {}) };
  const init = {
    method: options.method || 'GET',
    headers,
    timeoutMs,
    ...buildTlsOptions(bindings),
    ...(options.body !== undefined ? { body: options.body } : {}),
  };
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    const errMsg = err?.cause?.message || err?.message || 'fetch failed';
    logFlow(ctx, options.action || 'fetch:error', { url, error: errMsg });
    throw attachResponse(errorWithCode('UNAVAILABLE', `${options.action || 'fetch'} failed: ${errMsg}`), { http_status: 0, http_body: errMsg });
  }
  let rawBody;
  try { rawBody = await res.text(); }
  catch (err) {
    const errMsg = err?.message || 'response read failed';
    logFlow(ctx, 'fetch:read-error', { url, httpStatus: res.status, error: errMsg });
    throw attachResponse(errorWithCode('UNAVAILABLE', `response read failed: ${errMsg}`), { http_status: Number(res.status || 0), http_body: errMsg });
  }
  const httpStatus = Number(res.status || 0);
  logFlow(ctx, 'fetch:response', { url, httpStatus, bodyLength: rawBody?.length || 0 });
  return { httpStatus, httpBody: String(rawBody ?? '') };
};

const ensureSuccess = (result, action) => {
  const { httpStatus, httpBody } = result;
  if (httpStatus >= 200 && httpStatus < 300) return;
  const code = mapHttpStatusToCode(httpStatus);
  throw attachResponse(errorWithCode(code, `${action} upstream http ${httpStatus}: ${httpBody}`), { http_status: httpStatus, http_body: httpBody });
};

const parseJsonOrThrowUnknown = (result, action) => {
  const trimmed = (result.httpBody || '').trim();
  if (!trimmed) {
    throw attachResponse(errorWithCode('UNKNOWN', `${action} returned empty response`), { http_status: result.httpStatus, http_body: result.httpBody });
  }
  const parsed = tryParseJson(trimmed);
  if (!parsed.ok) {
    throw attachResponse(errorWithCode('UNKNOWN', `${action} response is not valid JSON`), { http_status: result.httpStatus, http_body: result.httpBody });
  }
  return parsed.value;
};

const normalizeClusterHealthLevel = (req = {}) => {
  const level = toTrimmedString(req.level).toLowerCase();
  if (!level) return DEFAULT_CLUSTER_HEALTH_LEVEL;
  if (!VALID_HEALTH_LEVELS.has(level)) {
    throw errorWithCode('INVALID_ARGUMENT', `level must be one of cluster|indices|shards, got "${level}"`);
  }
  return level;
};

const normalizeWaitForStatus = (req = {}) => {
  const status = toTrimmedString(req.wait_for_status).toLowerCase();
  if (!status) return '';
  if (!VALID_WAIT_FOR_STATUS.has(status)) {
    throw errorWithCode('INVALID_ARGUMENT', `wait_for_status must be one of green|yellow|red, got "${status}"`);
  }
  return status;
};

const normalizeBytes = (req = {}) => {
  const bytes = toTrimmedString(req.bytes).toLowerCase();
  if (!bytes) return DEFAULT_LIST_NODES_BYTES;
  if (!VALID_BYTES_UNITS.has(bytes)) {
    throw errorWithCode('INVALID_ARGUMENT', `bytes must be one of b|kb|mb|gb, got "${bytes}"`);
  }
  return bytes;
};

const normalizeIndexFilter = (req = {}) => toTrimmedString(firstDefined(req.index, req.pattern));

const handleClusterHealth = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const { username, password } = requireCredentials(callCtx);
  const level = normalizeClusterHealthLevel(req);
  const timeout = toTrimmedString(req.timeout);
  const waitForStatus = normalizeWaitForStatus(req);

  const path = '/_cluster/health';
  const url = buildUrl(baseUrl, path, {
    ...(level ? { level } : {}),
    ...(timeout ? { timeout } : {}),
    ...(waitForStatus ? { wait_for_status: waitForStatus } : {}),
  });
  logFlow(callCtx, 'ClusterHealth', { url: joinPath(baseUrl, path) });
  const headers = { Authorization: buildBasicAuth(username, password) };
  const result = await executeRequest(url, callCtx, { headers, action: 'ClusterHealth' });
  ensureSuccess(result, 'ClusterHealth');
  const json = parseJsonOrThrowUnknown(result, 'ClusterHealth');

  return {
    cluster_name: toTrimmedString(json?.cluster_name),
    status: toTrimmedString(json?.status),
    number_of_nodes: toFiniteInt(json?.number_of_nodes),
    number_of_data_nodes: toFiniteInt(json?.number_of_data_nodes),
    active_primary_shards: toFiniteInt(json?.active_primary_shards),
    active_shards: toFiniteInt(json?.active_shards),
    relocating_shards: toFiniteInt(json?.relocating_shards),
    initializing_shards: toFiniteInt(json?.initializing_shards),
    unassigned_shards: toFiniteInt(json?.unassigned_shards),
    delayed_unassigned_shards: toFiniteInt(json?.delayed_unassigned_shards),
    number_of_pending_tasks: toFiniteInt(json?.number_of_pending_tasks),
    number_of_in_flight_fetch: toFiniteInt(json?.number_of_in_flight_fetch),
    task_max_waiting_in_queue_millis: toFiniteInt(json?.task_max_waiting_in_queue_millis),
    active_shards_percent_as_number: toFiniteNumber(json?.active_shards_percent_as_number),
    raw_body: result.httpBody,
    timed_out: toBool(json?.timed_out, false),
  };
};

const mapIndexSummary = (entry = {}) => ({
  health: toTrimmedString(entry?.health),
  status: toTrimmedString(entry?.status),
  index: toTrimmedString(entry?.index),
  uuid: toTrimmedString(entry?.uuid),
  pri: toTrimmedString(entry?.pri),
  rep: toTrimmedString(entry?.rep),
  docs_count: toTrimmedString(entry?.['docs.count']),
  docs_deleted: toTrimmedString(entry?.['docs.deleted']),
  store_size: toTrimmedString(entry?.['store.size']),
  pri_store_size: toTrimmedString(entry?.['pri.store.size']),
});

const handleListIndices = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const { username, password } = requireCredentials(callCtx);
  const indexFilter = normalizeIndexFilter(req);

  const path = indexFilter ? `/_cat/${encodeURIComponent(indexFilter).replace(/%2F/g, '/')}` : '/_cat/indices';
  const url = buildUrl(baseUrl, path, { format: 'json', h: 'health,status,index,uuid,pri,rep,docs.count,docs.deleted,store.size,pri.store.size' });
  logFlow(callCtx, 'ListIndices', { url: joinPath(baseUrl, path), indexFilter });
  const headers = { Authorization: buildBasicAuth(username, password) };
  const result = await executeRequest(url, callCtx, { headers, action: 'ListIndices' });
  ensureSuccess(result, 'ListIndices');
  const json = parseJsonOrThrowUnknown(result, 'ListIndices');
  const entries = Array.isArray(json) ? json : [];
  return { indices: entries.map(mapIndexSummary), raw_body: result.httpBody };
};

const mapIndexAlias = (entry) => {
  const raw = entry && typeof entry === 'object' ? entry : {};
  return {
    is_write_index: toBool(raw.is_write_index, false),
    is_hidden: toBool(raw.is_hidden, false),
    filter: toTrimmedString(raw.filter),
    index_routing: toTrimmedString(raw.index_routing),
    search_routing: toTrimmedString(raw.search_routing),
    raw_json: toJsonString(raw),
  };
};

const mapIndexAliases = (raw) => {
  const obj = raw && typeof raw === 'object' ? raw : {};
  const aliases = {};
  for (const [name, def] of Object.entries(obj)) {
    if (def && typeof def === 'object' && !Array.isArray(def)) {
      aliases[String(name)] = mapIndexAlias(def);
    } else {
      aliases[String(name)] = { is_write_index: false, is_hidden: false, filter: '', index_routing: '', search_routing: '', raw_json: toJsonString(def) };
    }
  }
  return { aliases, raw_json: toJsonString(obj) };
};

const mapIndexMappingField = (raw) => {
  if (!raw || typeof raw !== 'object') return { type: '', raw_json: toJsonString(raw) };
  return { type: toTrimmedString(raw.type), raw_json: toJsonString(raw) };
};

const mapIndexMapping = (raw) => {
  if (!raw || typeof raw !== 'object') return { properties: {}, dynamic: false, dynamic_templates_json: '[]', raw_json: toJsonString(raw) };
  const propsContainer = raw.properties && typeof raw.properties === 'object' && !Array.isArray(raw.properties) ? raw.properties : {};
  const properties = {};
  for (const [name, def] of Object.entries(propsContainer)) {
    if (def && typeof def === 'object' && !Array.isArray(def) && 'type' in def) {
      properties[String(name)] = mapIndexMappingField(def);
    } else if (def !== undefined) {
      // Non-type field (e.g. {fields: {...}}) — still expose as raw JSON entry
      properties[String(name)] = { type: '', raw_json: toJsonString(def) };
    }
  }
  return {
    properties,
    dynamic: toBool(raw.dynamic, false),
    dynamic_templates_json: toJsonString(raw.dynamic_templates ?? []),
    raw_json: toJsonString(raw),
  };
};

const mapIndexSetting = (raw) => {
  if (!raw || typeof raw !== 'object') return { number_of_shards: '', number_of_replicas: '', refresh_interval: '', raw_json: toJsonString(raw) };
  const index = raw.index && typeof raw.index === 'object' ? raw.index : raw;
  return {
    number_of_shards: toTrimmedString(index.number_of_shards),
    number_of_replicas: toTrimmedString(index.number_of_replicas),
    refresh_interval: toTrimmedString(index.refresh_interval),
    raw_json: toJsonString(raw),
  };
};

const handleGetIndex = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const { username, password } = requireCredentials(callCtx);
  const index = requireIndex(req);

  const path = `/${encodeURIComponent(index).replace(/%2F/g, '/')}`;
  const url = joinPath(baseUrl, path);
  logFlow(callCtx, 'GetIndex', { url, index });
  const headers = { Authorization: buildBasicAuth(username, password) };
  const result = await executeRequest(url, callCtx, { headers, action: 'GetIndex' });
  ensureSuccess(result, 'GetIndex');
  const json = parseJsonOrThrowUnknown(result, 'GetIndex');
  const entry = json && typeof json === 'object' ? json[index] || json[Object.keys(json)[0]] || {} : {};
  return {
    index,
    aliases: { [index]: mapIndexAliases(entry.aliases) },
    mappings: { [index]: mapIndexMapping(entry.mappings) },
    settings: { [index]: mapIndexSetting(entry.settings) },
    raw_body: result.httpBody,
  };
};

const resolveSearchQuery = (req = {}) => {
  const raw = unwrapScalar(req.query);
  if (raw === undefined || raw === null || raw === '') return DEFAULT_SEARCH_QUERY;
  if (typeof raw === 'string') return raw;
  return JSON.stringify(raw);
};

const mapSearchHit = (hit = {}) => ({
  index: toTrimmedString(hit?._index),
  id: toTrimmedString(hit?._id),
  score: toFiniteNumber(hit?._score, 0),
  source: JSON.stringify(hit?._source ?? {}),
  type: toTrimmedString(hit?._type),
  version: toFiniteInt(hit?._version, 0),
  seq_no: toFiniteInt(hit?._seq_no, 0),
  primary_term: toFiniteInt(hit?._primary_term, 0),
  sort_json: toJsonString(hit?.sort),
  fields_json: toJsonString(hit?.fields),
  highlight_json: toJsonString(hit?.highlight),
  explanation_json: toJsonString(hit?._explanation),
  matched_queries_json: toJsonString(hit?.matched_queries),
  inner_hits_json: toJsonString(hit?.inner_hits),
  ignored_json: toJsonString(hit?._ignored),
});

const handleSearchDocuments = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const { username, password } = requireCredentials(callCtx);
  const index = requireSearchIndex(req);
  const queryRaw = resolveSearchQuery(req);
  const size = toFiniteInt(req.size, DEFAULT_SEARCH_SIZE);
  const from = toFiniteInt(req.from, DEFAULT_SEARCH_FROM);

  let queryBody;
  try { queryBody = JSON.parse(queryRaw); }
  catch (err) { throw errorWithCode('INVALID_ARGUMENT', `query must be valid JSON: ${err?.message || 'parse failed'}`); }
  const requestBody = JSON.stringify({ from, size, query: queryBody });

  const path = `/${encodeURIComponent(index).replace(/%2F/g, '/')}/_search`;
  const url = joinPath(baseUrl, path);
  logFlow(callCtx, 'SearchDocuments', { url, index, size, from });
  const headers = {
    Authorization: buildBasicAuth(username, password),
    'Content-Type': 'application/json',
  };
  const result = await executeRequest(url, callCtx, { method: 'POST', headers, body: requestBody, action: 'SearchDocuments' });
  ensureSuccess(result, 'SearchDocuments');
  const json = parseJsonOrThrowUnknown(result, 'SearchDocuments');
  const hitsNode = json?.hits ?? {};
  const hitsList = Array.isArray(hitsNode?.hits) ? hitsNode.hits : [];
  const totalNode = hitsNode?.total;
  const totalHits = typeof totalNode === 'object' && totalNode !== null ? toFiniteInt(totalNode.value) : toFiniteInt(totalNode);
  const totalHitsRelation = typeof totalNode === 'object' && totalNode !== null ? toTrimmedString(totalNode.relation) : '';
  const shards = json?._shards && typeof json._shards === 'object' ? json._shards : {};
  return {
    took: toFiniteInt(json?.took),
    timed_out: toBool(json?.timed_out),
    total_hits: totalHits,
    max_score: toFiniteNumber(hitsNode?.max_score, 0),
    hits: hitsList.map(mapSearchHit),
    raw_body: result.httpBody,
    shards_total: toFiniteInt(shards.total, 0),
    shards_successful: toFiniteInt(shards.successful, 0),
    shards_skipped: toFiniteInt(shards.skipped, 0),
    shards_failed: toFiniteInt(shards.failed, 0),
    total_hits_relation: totalHitsRelation,
    scroll_id: toTrimmedString(json?._scroll_id),
  };
};

const mapNodeSummary = (entry = {}) => ({
  ip: toTrimmedString(entry?.ip),
  name: toTrimmedString(entry?.name),
  heap_percent: toTrimmedString(entry?.['heap.percent']),
  ram_percent: toTrimmedString(entry?.['ram.percent']),
  cpu: toTrimmedString(entry?.cpu),
  load_1m: toTrimmedString(entry?.load_1m),
  load_5m: toTrimmedString(entry?.load_5m),
  load_15m: toTrimmedString(entry?.load_15m),
  node_role: toTrimmedString(entry?.['node.role']),
  master: toTrimmedString(entry?.master),
});

const handleListNodes = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = requireBaseUrl(callCtx);
  const { username, password } = requireCredentials(callCtx);
  const bytes = normalizeBytes(req);

  const path = '/_cat/nodes';
  const url = buildUrl(baseUrl, path, {
    format: 'json',
    h: 'ip,name,heap.percent,ram.percent,cpu,load_1m,load_5m,load_15m,node.role,master',
    ...(bytes ? { bytes } : {}),
  });
  logFlow(callCtx, 'ListNodes', { url: joinPath(baseUrl, path), bytes });
  const headers = { Authorization: buildBasicAuth(username, password) };
  const result = await executeRequest(url, callCtx, { headers, action: 'ListNodes' });
  ensureSuccess(result, 'ListNodes');
  const json = parseJsonOrThrowUnknown(result, 'ListNodes');
  const entries = Array.isArray(json) ? json : [];
  return { nodes: entries.map(mapNodeSummary), raw_body: result.httpBody };
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_CLUSTER_HEALTH_PATH]: async (req) => handleClusterHealth(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_LIST_INDICES_PATH]: async (req) => handleListIndices(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_GET_INDEX_PATH]: async (req) => handleGetIndex(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_SEARCH_DOCUMENTS_PATH]: async (req) => handleSearchDocuments(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_LIST_NODES_PATH]: async (req) => handleListNodes(req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_CLUSTER_HEALTH_FULL]: (req, ctx = {}) => handleClusterHealth(req, ctx),
  [METHOD_LIST_INDICES_FULL]: (req, ctx = {}) => handleListIndices(req, ctx),
  [METHOD_GET_INDEX_FULL]: (req, ctx = {}) => handleGetIndex(req, ctx),
  [METHOD_SEARCH_DOCUMENTS_FULL]: (req, ctx = {}) => handleSearchDocuments(req, ctx),
  [METHOD_LIST_NODES_FULL]: (req, ctx = {}) => handleListNodes(req, ctx),
};

export const _test = {
  attachResponse, buildBasicAuth, buildLogPrefix, buildTlsOptions, buildUrl,
  encodeQueryPairs, ensureSuccess, errorWithCode, executeRequest, firstDefined,
  grpcCodeFor, handleClusterHealth, handleGetIndex, handleListIndices,
  handleListNodes, handleSearchDocuments, hasOwn, joinPath, logFlow,
  mapHttpStatusToCode, mapIndexAlias, mapIndexAliases, mapIndexMapping,
  mapIndexMappingField, mapIndexSetting, mapIndexSummary, mapNodeSummary,
  mapSearchHit, mergedBindings, normalizeBaseUrl, normalizeBytes,
  normalizeClusterHealthLevel, normalizeIndexFilter, normalizeWaitForStatus,
  parseJsonOrThrowUnknown, requireBaseUrl, requireCredentials, requireIndex,
  requireSearchIndex, resolveBaseUrl, resolveCallContext, resolvePassword,
  resolveSearchQuery, resolveTimeoutMs, resolveUsername, toBool, toFiniteInt,
  toFiniteNumber, toJsonString, toTrimmedString, tryParseJson, unwrapScalar,
};