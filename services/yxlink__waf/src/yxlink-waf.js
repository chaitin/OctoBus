import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const METHOD_LIST_TAMPER_SITES = 'YXLink_WAF.YXLinkWafService/ListTamperSites';
export const METHOD_CREATE_TAMPER_SITE = 'YXLink_WAF.YXLinkWafService/CreateTamperSite';
export const METHOD_UPDATE_TAMPER_SITE = 'YXLink_WAF.YXLinkWafService/UpdateTamperSite';
export const METHOD_DELETE_TAMPER_SITES = 'YXLink_WAF.YXLinkWafService/DeleteTamperSites';
export const METHOD_ENABLE_TAMPER_SITES = 'YXLink_WAF.YXLinkWafService/EnableTamperSites';
export const METHOD_DISABLE_TAMPER_SITES = 'YXLink_WAF.YXLinkWafService/DisableTamperSites';
export const METHOD_REBUILD_TAMPER_BACKUPS = 'YXLink_WAF.YXLinkWafService/RebuildTamperBackups';
export const METHOD_LIST_INTRUSION_LOGS = 'YXLink_WAF.YXLinkWafService/ListIntrusionLogs';
export const METHOD_DELETE_INTRUSION_LOGS = 'YXLink_WAF.YXLinkWafService/DeleteIntrusionLogs';
export const METHOD_COUNT_INTRUSION_LOGS = 'YXLink_WAF.YXLinkWafService/CountIntrusionLogs';

export const PATH_LIST_TAMPER_SITES = '/api/tamperresistance/tamperresistanceforweb/paginate';
export const PATH_CREATE_TAMPER_SITE = '/api/tamperresistance/tamperresistanceforweb/create';
export const PATH_UPDATE_TAMPER_SITE = '/api/tamperresistance/tamperresistanceforweb/update';
export const PATH_DELETE_TAMPER_SITES = '/api/tamperresistance/tamperresistanceforweb/remove';
export const PATH_ENABLE_TAMPER_SITES = '/api/tamperresistance/tamperresistanceforweb/enable';
export const PATH_DISABLE_TAMPER_SITES = '/api/tamperresistance/tamperresistanceforweb/disable';
export const PATH_REBUILD_TAMPER_BACKUPS = '/api/tamperresistance/tamperresistanceforweb/rebuildBackup';
export const PATH_LIST_INTRUSION_LOGS = '/api/intrusionprevention/intrusionlog/paginate';
export const PATH_DELETE_INTRUSION_LOGS = '/api/intrusionprevention/intrusionlog/remove';
export const PATH_COUNT_INTRUSION_LOGS = '/api/intrusionprevention/intrusionlog/count';

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_LIMIT = 30;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  DEADLINE_EXCEEDED: grpcStatus.DEADLINE_EXCEEDED,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const unwrap = (value) => {
  if (value && typeof value === 'object' && hasOwn(value, 'value')) return unwrap(value.value);
  return value;
};

const asString = (value) => {
  const raw = unwrap(value);
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

const asOptionalString = (value) => {
  const normalized = asString(value);
  return normalized === '' ? undefined : normalized;
};

const asInt = (value, field, { min, max, optional = false } = {}) => {
  const raw = unwrap(value);
  if (raw === undefined || raw === null || raw === '') {
    if (optional) return undefined;
    throw errorWithCode('INVALID_ARGUMENT', `${field} is required`);
  }
  const num = Number(raw);
  if (!Number.isInteger(num) || Number.isNaN(num)) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} must be an integer`);
  }
  if (min !== undefined && num < min) throw errorWithCode('INVALID_ARGUMENT', `${field} must be >= ${min}`);
  if (max !== undefined && num > max) throw errorWithCode('INVALID_ARGUMENT', `${field} must be <= ${max}`);
  return num;
};

const asBool = (value) => {
  const raw = unwrap(value);
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const lower = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(lower)) return true;
    if (['0', 'false', 'no', 'off', ''].includes(lower)) return false;
  }
  return Boolean(raw);
};

const pick = (source, keys) => {
  for (const key of keys) {
    if (hasOwn(source, key)) return source[key];
  }
  return undefined;
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx.config ?? {}),
  ...(ctx.secret ?? {}),
  ...(ctx.bindings ?? {}),
});

const normalizeBaseUrl = (value) => {
  const url = asString(value).replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) return '';
  return url;
};

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

const buildTlsOptions = (skipTlsVerify) => (skipTlsVerify
  ? { skipTlsVerify: true, tlsInsecureSkipVerify: true, insecureSkipVerify: true }
  : {});

const resolveTimeoutMs = (ctx = {}) => firstDefined(
  asInt(ctx.req?.timeoutMs, 'timeoutMs', { min: 1, optional: true }),
  asInt(ctx.req?.timeout_ms, 'timeout_ms', { min: 1, optional: true }),
  asInt(ctx.bindings?.timeoutMs, 'timeoutMs', { min: 1, optional: true }),
  asInt(ctx.bindings?.timeout_ms, 'timeout_ms', { min: 1, optional: true }),
  asInt(ctx.limits?.timeoutMs, 'limits.timeoutMs', { min: 1, optional: true }),
  DEFAULT_TIMEOUT_MS,
);

const toPlain = (value) => {
  if (value === undefined) return null;
  if (value === null) return null;
  if (Array.isArray(value)) return value.map((item) => toPlain(item));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = toPlain(item);
    return out;
  }
  return value;
};

const jsonStruct = (value) => toPlain(value);

const sign = (appId, appSecret, nonceStr, timestamp) => {
  const parts = {
    appId: String(appId),
    nonceStr: String(nonceStr),
    timestamp: String(timestamp),
    token: String(appSecret),
  };
  const canonical = Object.keys(parts)
    .sort()
    .map((key) => `${key}=${parts[key]}`)
    .join('&');
  return crypto.createHash('sha1').update(canonical).digest('hex');
};

const buildAuthorization = (appId, appSecret, nonceStr = crypto.randomBytes(8).toString('hex'), timestamp = Math.floor(Date.now() / 1000)) => {
  const payload = {
    appId: String(appId),
    nonceStr: String(nonceStr),
    timestamp: String(timestamp),
    signature: sign(appId, appSecret, nonceStr, timestamp),
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
};

const resolveCallContext = (ctx = {}, req = {}) => {
  const bindings = mergedBindings(ctx);
  const baseUrl = normalizeBaseUrl(firstDefined(bindings.host, bindings.baseUrl, bindings.restBaseUrl));
  if (!baseUrl) throw errorWithCode('INVALID_ARGUMENT', 'host/baseUrl is required and must include http/https');
  const appId = asOptionalString(firstDefined(bindings.appId, bindings.app_id));
  const appSecret = asOptionalString(firstDefined(bindings.appSecret, bindings.app_secret));
  if (!appId) throw errorWithCode('INVALID_ARGUMENT', 'appId is required in secret');
  if (!appSecret) throw errorWithCode('INVALID_ARGUMENT', 'appSecret is required in secret');
  return {
    req,
    baseUrl,
    appId,
    appSecret,
    timeoutMs: resolveTimeoutMs({ ...ctx, req }),
    headers: parseHeaders(bindings.headers),
    skipTlsVerify: asBool(firstDefined(bindings.skipTlsVerify, bindings.tlsInsecureSkipVerify, bindings.insecureSkipVerify)),
  };
};

const formBody = (fields) => {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    body.set(key, String(value));
  }
  return body;
};

const requestJSON = async (call, path, fields = {}, { query = {} } = {}) => {
  const url = new URL(`${call.baseUrl}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), call.timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...call.headers,
        Authorization: buildAuthorization(call.appId, call.appSecret),
      },
      body: formBody(fields),
      signal: controller.signal,
      ...buildTlsOptions(call.skipTlsVerify),
    });
    const text = await response.text();
    if (!response.ok) {
      if (response.status === 401) throw errorWithCode('UNAUTHENTICATED', `upstream http ${response.status}: ${text}`);
      if (response.status === 403) throw errorWithCode('PERMISSION_DENIED', `upstream http ${response.status}: ${text}`);
      throw errorWithCode('UNAVAILABLE', `upstream http ${response.status}: ${text}`);
    }
    if (text.trim() === '') return {};
    try {
      return JSON.parse(text);
    } catch {
      throw errorWithCode('UNKNOWN', 'response is not valid JSON');
    }
  } catch (error) {
    if (error.legacyCode) throw error;
    if (error.name === 'AbortError') throw errorWithCode('DEADLINE_EXCEEDED', `upstream timeout after ${call.timeoutMs}ms`);
    throw errorWithCode('UNAVAILABLE', error.message);
  } finally {
    clearTimeout(timeout);
  }
};

const assertBusinessSuccess = (json) => {
  if (json?.success === false) {
    const msg = asString(json.msg || json.message || json.code || 'request failed');
    if (msg === 'auth_failed' || json.code === 'auth_failed') throw errorWithCode('UNAUTHENTICATED', msg);
    throw errorWithCode('FAILED_PRECONDITION', msg);
  }
};

const idsToCSV = (ids, field = 'ids') => {
  if (!Array.isArray(ids) || ids.length === 0) throw errorWithCode('INVALID_ARGUMENT', `${field} must be a non-empty array`);
  return ids.map((id) => asString(id)).filter(Boolean).join(',');
};

const listPagination = (req = {}) => ({
  start: asInt(firstDefined(req.start, 0), 'start', { min: 0 }),
  limit: asInt(firstDefined(req.limit, DEFAULT_LIMIT), 'limit', { min: 1 }),
});

const siteMutationFields = (site = {}, { includeId = false, id } = {}) => {
  const source = site || {};
  const fields = {
    website: asString(source.website),
    description: asString(source.description),
    start: asBool(source.start) ? 1 : 0,
    schedule: asInt(firstDefined(source.schedule, 1), 'schedule', { min: 1, max: 3 }),
    address: asString(source.address),
    filecharset: asString(firstDefined(source.filecharset, 'gbk')),
    username: asString(source.username),
    password: asString(source.password),
    connect: asInt(firstDefined(source.connect, 1), 'connect', { min: 1, max: 2 }),
    port: asInt(source.port, 'port', { min: 1, max: 65535 }),
    folder: asString(firstDefined(source.folder, '/')),
    parallel: asInt(firstDefined(source.parallel, 5), 'parallel', { min: 1 }),
    quickdiff: asInt(source.quickdiff, 'quickdiff', { min: 1 }),
    maxsize: asInt(source.maxsize, 'maxsize', { min: 1 }),
    exclude: asString(source.exclude),
  };
  for (const required of ['website', 'address', 'username']) {
    if (!fields[required]) throw errorWithCode('INVALID_ARGUMENT', `${required} is required`);
  }
  if (!['gbk', 'utf8', 'gb18030'].includes(fields.filecharset.toLowerCase())) {
    throw errorWithCode('INVALID_ARGUMENT', 'filecharset must be one of gbk, utf8, gb18030');
  }
  if (includeId) fields.id = asString(id);
  if (includeId && !fields.id) throw errorWithCode('INVALID_ARGUMENT', 'id is required');
  return fields;
};

const toInt64 = (value) => {
  const raw = unwrap(value);
  if (raw === undefined || raw === null || raw === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) && !Number.isNaN(n) ? Math.trunc(n) : 0;
};

const mapTamperSite = (item = {}) => ({
  id: asString(item.id),
  website: asString(item.website),
  description: asString(item.description),
  start: asBool(item.start),
  address: asString(item.address),
  port: toInt64(item.port),
  connect: toInt64(item.connect),
  folder: asString(item.folder),
  username: asString(item.username),
  quickdiff: toInt64(item.quickdiff),
  maxsize: toInt64(item.maxsize),
  exclude: asString(item.exclude),
  filecharset: asString(item.filecharset),
  parallel: toInt64(item.parallel),
  schedule: toInt64(item.schedule),
  status: asString(item.status),
  raw: jsonStruct(item),
});

const mapIntrusionLog = (item = {}) => ({
  hack_id: asString(firstDefined(item.HackId, item.hack_id, item.hackId)),
  hack_time: asString(firstDefined(item.HackTime, item.hack_time, item.hackTime)),
  src_ip: asString(firstDefined(item.SrcIp, item.src_ip, item.srcIp)),
  src_ip_addr: asString(firstDefined(item.SrcIpAddr, item.src_ip_addr, item.srcIpAddr)),
  dst_ip: asString(firstDefined(item.DstIp, item.dst_ip, item.dstIp)),
  src_mac: asString(firstDefined(item.SrcMac, item.src_mac, item.srcMac)),
  dst_mac: asString(firstDefined(item.DstMac, item.dst_mac, item.dstMac)),
  data_len: toInt64(firstDefined(item.DataLen, item.data_len, item.dataLen)),
  src_port: toInt64(firstDefined(item.SrcPort, item.src_port, item.srcPort)),
  dst_port: toInt64(firstDefined(item.DstPort, item.dst_port, item.dstPort)),
  block_reason: toInt64(firstDefined(item.BlockReason, item.block_reason, item.blockReason)),
  action_type: asString(firstDefined(item.ActionType, item.action_type, item.actionType)),
  http_protocol: asString(firstDefined(item.HttpProtocol, item.http_protocol, item.httpProtocol)),
  get_data: asString(firstDefined(item.GETData, item.get_data, item.getData)),
  raw_data: asString(firstDefined(item.RawData, item.raw_data, item.rawData)),
  rule_name: asString(firstDefined(item.RuleName, item.rule_name, item.ruleName)),
  rule_type: asString(firstDefined(item.rule_type, item.RuleType, item.ruleType)),
  ranking: toInt64(firstDefined(item.Ranking, item.ranking)),
  description: asString(firstDefined(item.Description, item.description)),
  solution: asString(firstDefined(item.Solution, item.solution)),
  raw: jsonStruct(item),
});

const actionResponse = (json) => {
  assertBusinessSuccess(json);
  return {
    success: json.success !== false,
    msg: asString(json.msg),
    code: asString(json.code),
    raw: jsonStruct(json),
  };
};

const listTamperSites = async (req, ctx) => {
  const call = resolveCallContext(ctx, req);
  const json = await requestJSON(call, PATH_LIST_TAMPER_SITES, listPagination(req));
  assertBusinessSuccess(json);
  const data = Array.isArray(json.data) ? json.data : [];
  return {
    success: json.success !== false,
    msg: asString(json.msg),
    code: asString(json.code),
    total_amount: toInt64(json.totalAmount),
    sites: data.map(mapTamperSite),
    raw: jsonStruct(json),
  };
};

const createTamperSite = async (req, ctx) => {
  const call = resolveCallContext(ctx, req);
  const json = await requestJSON(call, PATH_CREATE_TAMPER_SITE, siteMutationFields(req));
  assertBusinessSuccess(json);
  return {
    success: json.success !== false,
    msg: asString(json.msg),
    code: asString(json.code),
    inserted_id: asString(firstDefined(json.insertedId, json.id)),
    raw: jsonStruct(json),
  };
};

const updateTamperSite = async (req, ctx) => {
  const call = resolveCallContext(ctx, req);
  const site = req.site || {};
  const json = await requestJSON(call, PATH_UPDATE_TAMPER_SITE, siteMutationFields(site, { includeId: true, id: req.id }));
  assertBusinessSuccess(json);
  return {
    success: json.success !== false,
    msg: asString(json.msg),
    code: asString(json.code),
    id: asString(json.id),
    inserted_id: asString(json.insertedId),
    raw: jsonStruct(json),
  };
};

const tamperAction = (path) => async (req, ctx) => {
  const call = resolveCallContext(ctx, req);
  const json = await requestJSON(call, path, { ids: idsToCSV(req.ids) });
  return actionResponse(json);
};

const intrusionFilterFields = (req = {}) => {
  const fields = {};
  const mapping = {
    view_mode: 'view_mode',
    timestamp: 'timestamp',
    src_ip: 'SrcIp',
    src_port: 'SrcPort',
    dst_ip: 'DstIp',
    dst_port: 'DstPort',
    sid_start: 'sid_start',
    sid_end: 'sid_end',
    action_type: 'ActionType',
    length_type: 'length_type',
    data_len: 'DataLen',
    http_protocol: 'HttpProtocol',
    get_data: 'GETData',
  };
  for (const [from, to] of Object.entries(mapping)) {
    const value = pick(req, [from, to]);
    if (value === undefined || value === null || value === '') continue;
    fields[to] = unwrap(value);
  }
  fields.start = asInt(firstDefined(req.start, 0), 'start', { min: 0 });
  fields.limit = asInt(firstDefined(req.limit, DEFAULT_LIMIT), 'limit', { min: 1 });
  return fields;
};

const listIntrusionLogs = async (req, ctx) => {
  const call = resolveCallContext(ctx, req);
  const json = await requestJSON(call, PATH_LIST_INTRUSION_LOGS, intrusionFilterFields(req));
  assertBusinessSuccess(json);
  const data = Array.isArray(json.data) ? json.data : [];
  return {
    success: json.success !== false,
    msg: asString(json.msg),
    code: asString(json.code),
    total_amount: toInt64(json.totalAmount),
    logs: data.map(mapIntrusionLog),
    raw: jsonStruct(json),
  };
};

const deleteIntrusionLogs = async (req, ctx) => {
  const call = resolveCallContext(ctx, req);
  const timestamp = asString(req.timestamp);
  if (!timestamp) throw errorWithCode('INVALID_ARGUMENT', 'timestamp is required');
  const fields = {
    view_mode: asString(req.view_mode),
    timestamp,
  };
  const ids = Array.isArray(req.ids) && req.ids.length > 0 ? idsToCSV(req.ids) : '';
  const idList = asString(req.id_list);
  if (!ids && !idList) throw errorWithCode('INVALID_ARGUMENT', 'ids or id_list is required');
  if (ids) fields.ids = ids;
  if (idList) fields.id_list = idList;
  const json = await requestJSON(call, PATH_DELETE_INTRUSION_LOGS, fields);
  return actionResponse(json);
};

const countIntrusionLogs = async (req, ctx) => {
  const call = resolveCallContext(ctx, req);
  const date = asString(req.date);
  if (!DATE_RE.test(date)) throw errorWithCode('INVALID_ARGUMENT', 'date must be yyyy-MM-dd');
  const json = await requestJSON(call, PATH_COUNT_INTRUSION_LOGS, { date }, { query: { date } });
  assertBusinessSuccess(json);
  return {
    success: json.success !== false,
    msg: asString(json.msg),
    code: asString(json.code),
    count: toInt64(json.count),
    raw: jsonStruct(json),
  };
};

export const handlers = {
  [METHOD_LIST_TAMPER_SITES]: listTamperSites,
  [METHOD_CREATE_TAMPER_SITE]: createTamperSite,
  [METHOD_UPDATE_TAMPER_SITE]: updateTamperSite,
  [METHOD_DELETE_TAMPER_SITES]: tamperAction(PATH_DELETE_TAMPER_SITES),
  [METHOD_ENABLE_TAMPER_SITES]: tamperAction(PATH_ENABLE_TAMPER_SITES),
  [METHOD_DISABLE_TAMPER_SITES]: tamperAction(PATH_DISABLE_TAMPER_SITES),
  [METHOD_REBUILD_TAMPER_BACKUPS]: tamperAction(PATH_REBUILD_TAMPER_BACKUPS),
  [METHOD_LIST_INTRUSION_LOGS]: listIntrusionLogs,
  [METHOD_DELETE_INTRUSION_LOGS]: deleteIntrusionLogs,
  [METHOD_COUNT_INTRUSION_LOGS]: countIntrusionLogs,
};

export const _test = {
  actionResponse,
  asInt,
  buildTlsOptions,
  buildAuthorization,
  formBody,
  handlers,
  intrusionFilterFields,
  listPagination,
  mapIntrusionLog,
  mapTamperSite,
  mergedBindings,
  normalizeBaseUrl,
  parseHeaders,
  resolveCallContext,
  sign,
  siteMutationFields,
};
