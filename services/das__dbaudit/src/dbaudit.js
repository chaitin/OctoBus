import { errorWithCode, callDbauditOpenApi } from '../../scripts/dbaudit-openapi.js';

export const METHOD_LIST_IP_FILTERS_PATH = '/Chaitin_DBAUDIT.DBAuditService/ListIPFilters';
export const METHOD_CREATE_IP_FILTER_PATH = '/Chaitin_DBAUDIT.DBAuditService/CreateIPFilter';
export const METHOD_GET_SYSTEM_RESOURCE_PATH = '/Chaitin_DBAUDIT.DBAuditService/GetSystemResource';
export const METHOD_QUERY_SYSTEM_RESOURCE_HISTORY_PATH = '/Chaitin_DBAUDIT.DBAuditService/QuerySystemResourceHistory';
export const METHOD_LIST_IP_FILTERS_FULL = 'Chaitin_DBAUDIT.DBAuditService/ListIPFilters';
export const METHOD_CREATE_IP_FILTER_FULL = 'Chaitin_DBAUDIT.DBAuditService/CreateIPFilter';
export const METHOD_GET_SYSTEM_RESOURCE_FULL = 'Chaitin_DBAUDIT.DBAuditService/GetSystemResource';
export const METHOD_QUERY_SYSTEM_RESOURCE_HISTORY_FULL = 'Chaitin_DBAUDIT.DBAuditService/QuerySystemResourceHistory';

export const TIME_PRESETS = new Set([
  'realtime',
  'last_1h',
  'last_6h',
  'last_1d',
  'last_7d',
  'last_14d',
  'last_30d',
  'today',
  'this_week',
  'this_month',
  'custom',
]);

export const QUERY_SCOPES = new Set(['all', 'one']);

const DEFAULT_INTERVALS = {
  last_1h: '1m',
  last_6h: '5m',
  last_1d: '1h',
  last_7d: '1d',
  last_14d: '1d',
  last_30d: '1d',
  today: '1h',
  this_week: '1d',
  this_month: '1d',
  custom: '1h',
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) {
    return unwrapScalar(value.value);
  }
  return value;
};

const coerceString = (value) => {
  const unwrapped = unwrapScalar(value);
  if (unwrapped === undefined || unwrapped === null) return '';
  return String(unwrapped);
};

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const toInt = (value, fallback) => {
  const number = Number(unwrapScalar(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.trunc(number);
};

const toInt64 = (value, fallback = 0) => {
  const number = Number(unwrapScalar(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.trunc(number);
};

const toNumber = (value) => {
  const number = Number(unwrapScalar(value));
  return Number.isFinite(number) ? number : 0;
};

const requireString = (value, label) => {
  const text = coerceString(value).trim();
  if (!text) throw errorWithCode('INVALID_ARGUMENT', `${label} is required`);
  return text;
};

export const buildListIPFiltersData = (req = {}) => ({
  CurrentPage: toInt(firstDefined(req.current_page, req.currentPage), 1),
  PageSize: toInt(firstDefined(req.page_size, req.pageSize), 10),
  Name: coerceString(firstDefined(req.name, req.Name)).trim(),
  IpFilterList: coerceString(firstDefined(req.ip_filter_list, req.ipFilterList, req.IpFilterList)).trim(),
  InstanceId: coerceString(firstDefined(req.instance_id, req.instanceId, req.InstanceId)).trim(),
});

export const buildCreateIPFilterData = (req = {}) => ({
  Name: requireString(firstDefined(req.name, req.Name), 'name'),
  IpFilterList: requireString(firstDefined(req.ip_filter_list, req.ipFilterList, req.IpFilterList), 'ip_filter_list'),
  InstanceId: coerceString(firstDefined(req.instance_id, req.instanceId, req.InstanceId)).trim(),
});

const normalizeFilter = (item = {}) => ({
  id: toInt64(firstDefined(item.Id, item.ID, item.id, item.IpFilterId, item.ipFilterId, item.ip_filter_id)),
  name: coerceString(firstDefined(item.Name, item.name, item.IpFilterName, item.ipFilterName, item.ip_filter_name)),
  ip_filter_list: coerceString(firstDefined(item.IpFilterList, item.ipFilterList, item.ip_filter_list)),
  user_id: coerceString(firstDefined(item.UserId, item.userId, item.user_id)),
});

export const mapListIPFiltersResponse = (raw = {}) => {
  const data = raw.data && typeof raw.data === 'object' ? raw.data : {};
  const list = firstDefined(data.list, data.List, data.filters, data.Filters, raw.list, raw.List) ?? [];
  const total = firstDefined(data.totalCount, data.TotalCount, data.total_count, raw.totalCount, raw.TotalCount, raw.total_count);
  return {
    filters: Array.isArray(list) ? list.map(normalizeFilter) : [],
    total_count: toInt64(total),
    raw,
  };
};

export const mapCreateIPFilterResponse = (raw = {}) => {
  const data = raw.data && typeof raw.data === 'object' ? raw.data : {};
  return {
    ip_filter_id: toInt64(firstDefined(data.IpFilterId, data.ipFilterId, data.ip_filter_id)),
    ip_filter_name: coerceString(firstDefined(data.IpFilterName, data.ipFilterName, data.ip_filter_name, data.Name, data.name)),
    ip_filter_list: coerceString(firstDefined(data.IpFilterList, data.ipFilterList, data.ip_filter_list)),
    user_id: coerceString(firstDefined(data.UserId, data.userId, data.user_id)),
    raw,
  };
};

export const handleListIPFilters = async (req = {}, ctx = {}) => {
  const raw = await callDbauditOpenApi({
    ctx,
    action: 'DescribeSipFilter',
    method: 'GET',
    data: buildListIPFiltersData(req),
  });
  return mapListIPFiltersResponse(raw);
};

export const handleCreateIPFilter = async (req = {}, ctx = {}) => {
  const raw = await callDbauditOpenApi({
    ctx,
    action: 'CreateSipFilter',
    method: 'POST',
    data: buildCreateIPFilterData(req),
  });
  return mapCreateIPFilterResponse(raw);
};

const normalizePreset = (value) => {
  const preset = coerceString(value).trim() || 'custom';
  if (!TIME_PRESETS.has(preset)) {
    throw errorWithCode('INVALID_ARGUMENT', `unsupported time_preset: ${preset}`);
  }
  return preset;
};

const normalizeScope = (value) => {
  const scope = coerceString(value).trim() || 'all';
  if (!QUERY_SCOPES.has(scope)) {
    throw errorWithCode('INVALID_ARGUMENT', `unsupported query_scope: ${scope}`);
  }
  return scope;
};

const startOfLocalDay = (nowMs) => {
  const date = new Date(nowMs);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

const startOfLocalWeek = (nowMs) => {
  const start = new Date(startOfLocalDay(nowMs));
  const day = start.getDay() || 7;
  start.setDate(start.getDate() - day + 1);
  return start.getTime();
};

const startOfLocalMonth = (nowMs) => {
  const date = new Date(nowMs);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
};

export const resolveTimeRange = (req = {}, now = Date.now) => {
  const preset = normalizePreset(firstDefined(req.time_preset, req.timePreset));
  const end = toInt64(firstDefined(req.end_time, req.endTime), now());

  if (preset === 'realtime') {
    return {
      preset,
      startTime: 0,
      endTime: 0,
      interval: '',
    };
  }

  let startTime;
  if (preset === 'custom') {
    startTime = toInt64(firstDefined(req.start_time, req.startTime));
    if (startTime <= 0 || end <= 0) {
      throw errorWithCode('INVALID_ARGUMENT', 'start_time and end_time are required for custom time_preset');
    }
    if (startTime > end) {
      throw errorWithCode('INVALID_ARGUMENT', 'start_time must be less than or equal to end_time');
    }
  } else if (preset === 'last_1h') {
    startTime = end - 60 * 60 * 1000;
  } else if (preset === 'last_6h') {
    startTime = end - 6 * 60 * 60 * 1000;
  } else if (preset === 'last_1d') {
    startTime = end - 24 * 60 * 60 * 1000;
  } else if (preset === 'last_7d') {
    startTime = end - 7 * 24 * 60 * 60 * 1000;
  } else if (preset === 'last_14d') {
    startTime = end - 14 * 24 * 60 * 60 * 1000;
  } else if (preset === 'last_30d') {
    startTime = end - 30 * 24 * 60 * 60 * 1000;
  } else if (preset === 'today') {
    startTime = startOfLocalDay(end);
  } else if (preset === 'this_week') {
    startTime = startOfLocalWeek(end);
  } else if (preset === 'this_month') {
    startTime = startOfLocalMonth(end);
  }

  return {
    preset,
    startTime,
    endTime: end,
    interval: coerceString(firstDefined(req.interval, req.Interval)).trim() || DEFAULT_INTERVALS[preset],
  };
};

export const buildGetSystemResourceData = (req = {}) => ({
  InstanceId: coerceString(firstDefined(req.instance_id, req.instanceId, req.InstanceId)).trim(),
});

export const buildHistoryData = (req = {}, now = Date.now) => {
  const resourceType = requireString(firstDefined(req.resource_type, req.resourceType, req.ResourceType), 'resource_type');
  const scope = normalizeScope(firstDefined(req.query_scope, req.queryScope));
  const range = resolveTimeRange(req, now);

  if (range.preset === 'realtime') {
    return {
      action: 'getSystemResource',
      data: buildGetSystemResourceData(req),
      scope,
      realtime: true,
    };
  }

  return {
    action: scope === 'one' ? 'GetOneSystemResourceByTimeRange' : 'GetAllSystemResourceByTimeRange',
    data: {
      StartTime: range.startTime,
      EndTime: range.endTime,
      Interval: range.interval,
      ResourceType: resourceType,
      InstanceId: coerceString(firstDefined(req.instance_id, req.instanceId, req.InstanceId)).trim(),
    },
    scope,
    realtime: false,
  };
};

const normalizeTags = (value) => {
  const unwrapped = unwrapScalar(value);
  if (Array.isArray(unwrapped)) return unwrapped.map(coerceString).filter(Boolean);
  if (typeof unwrapped === 'string') return unwrapped.split(',').map((tag) => tag.trim()).filter(Boolean);
  return [];
};

const normalizeRecord = (item = {}) => ({
  time: toInt64(firstDefined(item.time, item.Time)),
  type: coerceString(firstDefined(item.type, item.Type)),
  avg: toNumber(firstDefined(item.avg, item.Avg)),
  max: toNumber(firstDefined(item.max, item.Max)),
  tags: normalizeTags(firstDefined(item.tags, item.Tags)),
});

export const mapHistoryResponse = (raw = {}) => {
  const data = raw.data && typeof raw.data === 'object' ? raw.data : raw.data;
  const records = Array.isArray(data)
    ? data
    : firstDefined(data?.list, data?.List, data?.records, data?.Records, raw.list, raw.List, raw.records, raw.Records) ?? [];
  return {
    records: Array.isArray(records) ? records.map(normalizeRecord) : [],
    raw,
  };
};

export const handleGetSystemResource = async (req = {}, ctx = {}) => {
  const raw = await callDbauditOpenApi({
    ctx,
    action: 'getSystemResource',
    method: 'GET',
    data: buildGetSystemResourceData(req),
  });
  return { raw };
};

export const handleQuerySystemResourceHistory = async (req = {}, ctx = {}) => {
  const built = buildHistoryData(req, ctx?.now ?? Date.now);
  const raw = await callDbauditOpenApi({
    ctx,
    action: built.action,
    method: 'GET',
    data: built.data,
    now: ctx?.now ?? Date.now,
  });
  if (built.realtime) return { records: [], raw };
  return mapHistoryResponse(raw);
};

const registerHandlers = (ctx = {}) => ({
  [METHOD_LIST_IP_FILTERS_PATH]: (req = ctx?.req ?? ctx?.request ?? {}) => handleListIPFilters(req ?? {}, ctx),
  [METHOD_CREATE_IP_FILTER_PATH]: (req = ctx?.req ?? ctx?.request ?? {}) => handleCreateIPFilter(req ?? {}, ctx),
  [METHOD_GET_SYSTEM_RESOURCE_PATH]: (req = ctx?.req ?? ctx?.request ?? {}) => handleGetSystemResource(req ?? {}, ctx),
  [METHOD_QUERY_SYSTEM_RESOURCE_HISTORY_PATH]: (req = ctx?.req ?? ctx?.request ?? {}) => handleQuerySystemResourceHistory(req ?? {}, ctx),
});

export function rpcdef(ctx = {}) {
  return registerHandlers(ctx);
}

const callSdkHandler = (ctx, path) => registerHandlers(ctx)[path](ctx?.req ?? ctx?.request ?? {});

export const handlers = {
  [METHOD_LIST_IP_FILTERS_FULL]: (ctx) => callSdkHandler(ctx, METHOD_LIST_IP_FILTERS_PATH),
  [METHOD_CREATE_IP_FILTER_FULL]: (ctx) => callSdkHandler(ctx, METHOD_CREATE_IP_FILTER_PATH),
  [METHOD_GET_SYSTEM_RESOURCE_FULL]: (ctx) => callSdkHandler(ctx, METHOD_GET_SYSTEM_RESOURCE_PATH),
  [METHOD_QUERY_SYSTEM_RESOURCE_HISTORY_FULL]: (ctx) => callSdkHandler(ctx, METHOD_QUERY_SYSTEM_RESOURCE_HISTORY_PATH),
};

rpcdef.__test__ = {
  buildCreateIPFilterData,
  buildGetSystemResourceData,
  buildHistoryData,
  buildListIPFiltersData,
  coerceString,
  firstDefined,
  handleCreateIPFilter,
  handleGetSystemResource,
  handleListIPFilters,
  handleQuerySystemResourceHistory,
  mapCreateIPFilterResponse,
  mapHistoryResponse,
  mapListIPFiltersResponse,
  normalizeFilter,
  normalizePreset,
  normalizeRecord,
  normalizeScope,
  normalizeTags,
  registerHandlers,
  requireString,
  resolveTimeRange,
  startOfLocalDay,
  startOfLocalMonth,
  startOfLocalWeek,
  toInt,
  toInt64,
  toNumber,
  unwrapScalar,
};

export const _test = rpcdef.__test__;
