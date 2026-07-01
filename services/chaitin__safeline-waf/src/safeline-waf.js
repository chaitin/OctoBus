// Chaitin_WAF_SAFELINE Safeline DetectLogAggregateView proxy
// Bindings: restBaseUrl/baseUrl (required), headers (optional), timeoutMs (optional)

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const DEFAULT_TIMEOUT_MS = 1500;
let insecureDispatcherPromise;
const MAX_TIME_INTERVAL = 86400;
const DEFAULT_TIME_INTERVAL = 86400;
const DEFAULT_LOG_SIZE = 100;
const MAX_LOG_SIZE = 1000;
const CONDITION_OPTIONS = ['attack_type', 'rule_id', 'src_ip_keyword', 'site_uuid,attack_type,src_ip_keyword'];
const DEFAULT_CONDITION = 'src_ip_keyword';
const CREATE_IP_GROUP_PATH = '/Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/CreateIPGroup';
const UPDATE_IP_GROUP_PATH = '/Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/UpdateIPGroup';
const LIST_IP_GROUPS_PATH = '/Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/ListIPGroups';
const DELETE_IP_GROUP_PATH = '/Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/DeleteIPGroup';
const DELETE_IP_GROUP_ITEMS_PATH = '/Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/DeleteIPGroupItems';
const ADD_IP_GROUP_ITEMS_PATH = '/Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/AddIPGroupItems';
const GET_DETECTOR_STATE_PATH = '/Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/GetDetectorState';
const UPDATE_DETECTOR_STATE_PATH = '/Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/UpdateDetectorState';
const BLOCK_IP_PATH = '/Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/BlockIP';
const UNBLOCK_IP_PATH = '/Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/UnblockIP';

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  DEADLINE_EXCEEDED: grpcStatus.DEADLINE_EXCEEDED,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

const toValue = (val) => {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'number') return { numberValue: val };
  if (typeof val === 'boolean') return { boolValue: val };
  if (Array.isArray(val)) {
    const values = val
      .map((item) => toValue(item))
      .filter((item) => item !== undefined);
    return { listValue: { values } };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      const normalized = toValue(v);
      fields[k] = normalized === undefined ? { nullValue: 'NULL_VALUE' } : normalized;
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(val) };
};

const toPositiveInt = (val) => {
  if (val === undefined || val === null) return null;
  if (typeof val === 'object') {
    if ('value' in val) return toPositiveInt(val.value);
    return null;
  }
  const n = Number(val);
  if (!Number.isInteger(n) || Number.isNaN(n)) return null;
  return n;
};

const normalizeList = (json) => {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.list)) return json.list;
  if (json && Array.isArray(json.data)) return json.data;
  if (json && json.data && Array.isArray(json.data.list)) return json.data.list;
  return null;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const unwrapString = (source) => {
  if (source === undefined || source === null) return '';
  if (typeof source === 'object' && source !== null && 'value' in source) {
    return String(source.value ?? '');
  }
  return String(source);
};

const pickStringField = (req, keys) => {
  for (const key of keys) {
    if (hasOwn(req, key)) {
      return unwrapString(req[key]);
    }
  }
  return undefined;
};

const extractOriginalValues = (candidate) => {
  if (candidate === undefined || candidate === null) return [];
  if (Array.isArray(candidate)) return candidate;
  if (typeof candidate === 'object') {
    if (Array.isArray(candidate.values)) {
      return candidate.values;
    }
    if (!('values' in candidate)) {
      return [];
    }
    if (candidate.values === undefined || candidate.values === null) {
      return [];
    }
  }
  return null;
};

const firstDefined = (...vals) => vals.find((v) => v !== undefined && v !== null);

const createTlsDispatcher = async (skipTlsVerify) => {
  if (!skipTlsVerify) return undefined;
  insecureDispatcherPromise ??= import('undici').then(({ Agent }) => new Agent({
    connect: { rejectUnauthorized: false },
  }));
  return insecureDispatcherPromise;
};

const fetchWithTimeout = async (url, init = {}, options = {}) => {
  const timeout = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS;
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

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.bindings ?? {}),
  ...(ctx?.secret ?? {}),
});

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

const extractIntList = (candidate) => {
  if (candidate === undefined || candidate === null) return [];
  const source = Array.isArray(candidate)
    ? candidate
    : typeof candidate === 'object' && candidate !== null && Array.isArray(candidate.values)
    ? candidate.values
    : (() => {
        if (typeof candidate === 'object' && candidate !== null && hasOwn(candidate, 'values')) {
          if (candidate.values === undefined || candidate.values === null) {
            return [];
          }
          if (Array.isArray(candidate.values)) {
            return candidate.values;
          }
          return null;
        }
        return null;
      })();

  if (source === null) {
    return null;
  }

  const normalized = [];
  for (const item of source) {
    if (item === undefined || item === null || item === '') {
      return null;
    }
    const num = Number(typeof item === 'object' && 'value' in item ? item.value : item);
    if (!Number.isInteger(num) || Number.isNaN(num)) {
      return null;
    }
    normalized.push(num);
  }
  return normalized;
};

const normalizeBaseUrl = (url) => {
  const base = String(url || '').trim();
  if (!/^https?:\/\//i.test(base)) return null;
  return base.replace(/\/$/, '');
};

const toBooleanStrict = (val) => {
  if (typeof val === 'boolean') return val;
  if (val === undefined || val === null) return false;
  if (typeof val === 'number') {
    if (Number.isNaN(val)) return false;
    return val !== 0;
  }
  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
    if (lower === '1') return true;
    if (lower === '0') return false;
  }
  return Boolean(val);
};

const unwrapList = (source) => {
  if (source === undefined || source === null) return undefined;
  if (Array.isArray(source)) return source;
  if (typeof source === 'object' && source !== null && hasOwn(source, 'values')) {
    return source.values;
  }
  return source;
};

const toBoolean = (val) => {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'object' && val !== null && 'value' in val) {
    return toBoolean(val.value);
  }
  if (typeof val === 'string') {
    const normalized = val.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    return null;
  }
  if (typeof val === 'number') {
    if (val === 1) return true;
    if (val === 0) return false;
    return null;
  }
  return null;
};

const toQueryNumber = (val, allowZero = false) => {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'object' && 'value' in val) return toQueryNumber(val.value, allowZero);
  const num = Number(val);
  if (!Number.isInteger(num) || Number.isNaN(num)) return undefined;
  if (!allowZero && num <= 0) return undefined;
  if (allowZero && num < 0) return undefined;
  return num;
};

const toInt64 = (val) => {
  if (val === undefined || val === null) return null;
  const num = Number(val);
  if (!Number.isInteger(num) || Number.isNaN(num)) return null;
  return num;
};

const requireTargets = (req, keys) => {
  for (const key of keys) {
    if (hasOwn(req, key)) {
      const val = req[key];
      if (!Array.isArray(val)) {
        throw errorWithCode('INVALID_ARGUMENT', `${key} must be an array`);
      }
      if (val.length === 0) {
        throw errorWithCode('INVALID_ARGUMENT', `${key} must be non-empty`);
      }
      return val.map((item) => {
        if (item === undefined || item === null) {
          throw errorWithCode('INVALID_ARGUMENT', `${key} elements must be non-null strings`);
        }
        return String(item);
      });
    }
  }
  throw errorWithCode('INVALID_ARGUMENT', `${keys[0]} is required`);
};

const mapRecord = (item) => ({
  event_id: item?.event_id ?? '',
  country: item?.country ?? '',
  province: item?.province ?? '',
  src_ip: item?.src_ip ?? '',
  dst_port: item?.dst_port ?? '',
  attack_type: item?.attack_type ?? '',
  method: item?.method ?? '',
  website: item?.website ?? '',
  website_name: item?.website_name ?? '',
  module: item?.module ?? '',
  timestamp: item?.timestamp ?? '',
  scheme: item?.scheme ?? '',
  dst_ip: item?.dst_ip ?? '',
  url_path: item?.url_path ?? '',
  risk_level: item?.risk_level ?? '',
  status_code: item?.status_code ?? '',
  risk_level_num: item?.risk_level_num ?? '',
  action: item?.action ?? '',
  reason: item?.reason ?? '',
  payload: item?.payload ?? '',
  socket_ip: item?.socket_ip ?? '',
  threat_confidence: item?.threat_confidence ?? '',
  threat_risk_level: item?.threat_risk_level ?? '',
  threat_last_timestamp: item?.threat_last_timestamp ?? '',
  matched_threat_tag: item?.matched_threat_tag ?? '',
  flag: item?.flag ?? '',
  count: item?.count ?? '',
});

const METHOD_PATH = '/Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/AggregateDetectLogBySrcIP';
const buildIpGroupPayload = (req) => ({
  name: String(req?.name ?? '').trim(),
  comment: String(req?.comment ?? ''),
  original: Array.isArray(req?.original) ? req.original : [],
});

const buildUpdateIpGroupPayload = (req) => {
  const rawId = firstDefined(req?.id, req?.Id);
  if (rawId === undefined || rawId === null) {
    throw errorWithCode('INVALID_ARGUMENT', 'id is required');
  }
  const idNum = Number(rawId);
  if (!Number.isInteger(idNum) || Number.isNaN(idNum)) {
    throw errorWithCode('INVALID_ARGUMENT', 'id must be an integer');
  }

  const payload = { id: idNum };
  let hasUpdate = false;

  const name = pickStringField(req, ['name', 'Name']);
  if (name !== undefined) {
    payload.name = String(name);
    hasUpdate = true;
  }

  const comment = pickStringField(req, ['comment', 'Comment']);
  if (comment !== undefined) {
    payload.comment = String(comment);
    hasUpdate = true;
  }

  const rawOriginal = firstDefined(req?.original, req?.Original);
  if (rawOriginal !== undefined) {
    const values = extractOriginalValues(rawOriginal);
    if (values === null) {
      throw errorWithCode('INVALID_ARGUMENT', 'original must be a list');
    }
    if (!Array.isArray(values)) {
      throw errorWithCode('INVALID_ARGUMENT', 'original must be an array');
    }
    payload.original = values;
    hasUpdate = true;
  }

  if (!hasUpdate) {
    throw errorWithCode('INVALID_ARGUMENT', 'at least one field (name/comment/original) must be provided');
  }

  return payload;
};

const mapIpGroupResponse = (json) => ({
  id: json?.id ?? '',
  name: json?.name ?? '',
  comment: json?.comment ?? '',
  original: Array.isArray(json?.original) ? json.original : [],
  cidrs: Array.isArray(json?.cidrs) ? json.cidrs : [],
});

export function rpcdef(ctx) {
  const bindings = mergedBindings(ctx);
  const restBaseUrl = bindings.restBaseUrl || bindings.rest_base_url || bindings.baseUrl || bindings.base_url || bindings.endpoint || '';
  const timeoutMs = ctx.limits?.timeoutMs || DEFAULT_TIMEOUT_MS;
  const baseHeaders = parseHeaders(bindings.headers);
  const meta = ctx.meta || {};
  const skipTlsVerify = Boolean(bindings.tlsInsecureSkipVerify || bindings.skipTlsVerify || bindings.skip_tls_verify || bindings.tls_insecure_skip_verify);
  const resolvedApiToken = String(firstDefined(bindings.api_token, bindings.apiToken) || '').trim();

  const requireApiToken = () => {
    if (!resolvedApiToken) {
      throw errorWithCode('INVALID_ARGUMENT', 'api_token is required');
    }
    return resolvedApiToken;
  };

  const requestWithDefaults = (req = {}) => {
    const { api_token: _apiTokenSnake, apiToken: _apiTokenCamel, ...rest } = req ?? {};
    return rest;
  };

  const logFlow = (action, details) => {
    const inst = meta.instance_id || meta.instanceId;
    const reqId = meta.request_id || meta.requestId;
    const trace = [];
    if (inst) trace.push(`inst=${inst}`);
    if (reqId) trace.push(`req=${reqId}`);
    const prefix = `[Chaitin_WAF_SAFELINE][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
    try {
      console.log(prefix, JSON.stringify(details));
    } catch {
      console.log(prefix, details);
    }
  };

  const buildHeaders = (apiToken) => ({
    ...baseHeaders,
    'API-TOKEN': apiToken,
    'x-engine-instance': meta.instance_id || meta.instanceId || 'unknown',
    'x-request-id': meta.request_id || meta.requestId || 'unknown',
  });

  const fetchSafeline = async (url, init) => {
    try {
      return await fetchWithTimeout(url, init, { timeoutMs, skipTlsVerify });
    } catch (e) {
      const reason = e?.cause?.message || e?.message || 'fetch failed';
      throw errorWithCode('UNAVAILABLE', reason);
    }
  };

  const throwForHttpError = (status, text) => {
    if (status === 401 || status === 403) {
      throw errorWithCode('PERMISSION_DENIED', `upstream http ${status}: ${text}`);
    }
    if (status >= 400 && status < 500) {
      throw errorWithCode('FAILED_PRECONDITION', `upstream http ${status}: ${text}`);
    }
    throw errorWithCode('UNAVAILABLE', `upstream http ${status}: ${text}`);
  };

  const readJsonResponse = async (res, emptyValue) => {
    const text = await res.text();
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok) {
      throwForHttpError(res.status, text);
    }
    if (!text.trim()) {
      return emptyValue;
    }
    if (contentType.includes('application/json')) {
      return JSON.parse(text);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw errorWithCode('UNKNOWN', 'response is not valid JSON');
    }
  };

  // req 已经在 JS 引擎中按 bindings.defaults/force 做了合并，这里保持读取 req 即可。
  const callAggregate = async (req) => {
    const token = requireApiToken();

    const rawInterval = firstDefined(req?.time_interval, req?.timeInterval);
    const intervalCandidate = rawInterval && typeof rawInterval === 'object' && !('value' in rawInterval) && Object.keys(rawInterval).length === 0 ? undefined : rawInterval;
    const intervalNum = intervalCandidate === undefined || intervalCandidate === null ? DEFAULT_TIME_INTERVAL : toPositiveInt(intervalCandidate);
    if (!intervalNum || intervalNum <= 0 || intervalNum > MAX_TIME_INTERVAL) {
      throw errorWithCode('INVALID_ARGUMENT', 'time_interval must be integer in (0, 86400]');
    }

    const rawLogSize = firstDefined(req?.log_size, req?.logSize);
    const logSizeCandidate = rawLogSize && typeof rawLogSize === 'object' && !('value' in rawLogSize) && Object.keys(rawLogSize).length === 0 ? undefined : rawLogSize;
    const logSizeNum = logSizeCandidate === undefined || logSizeCandidate === null ? DEFAULT_LOG_SIZE : toPositiveInt(logSizeCandidate);
    if (!logSizeNum || logSizeNum < 1 || logSizeNum > MAX_LOG_SIZE) {
      throw errorWithCode('INVALID_ARGUMENT', 'log_size must be integer in [1, 1000]');
    }

    const rawCondition = firstDefined(req?.condition, req?.Condition);
    const condition = String(rawCondition ?? DEFAULT_CONDITION).trim() || DEFAULT_CONDITION;
    if (!CONDITION_OPTIONS.includes(condition)) {
      throw errorWithCode('INVALID_ARGUMENT', 'condition must be one of attack_type, rule_id, src_ip_keyword, site_uuid,attack_type,src_ip_keyword');
    }

    const baseUrl = normalizeBaseUrl(restBaseUrl);
    if (!baseUrl) {
      throw errorWithCode('INVALID_ARGUMENT', 'restBaseUrl/baseUrl is required (http/https)');
    }

    const url = `${baseUrl}/api/DetectLogAggregateView?time_interval=${intervalNum}&log_size=${logSizeNum}&condition=${encodeURIComponent(condition)}`;
    const headers = buildHeaders(token);

    const res = await fetchSafeline(url, { method: 'GET', headers });
    const json = await readJsonResponse(res, []);

    const list = normalizeList(json);
    if (!list) {
      throw errorWithCode('UNKNOWN', 'response has no list to map');
    }

    const records = list.map(mapRecord);
    return { records };
  };

  // 其余方法同样读取 req 中字段即可，bindings.force/defaults 将在引擎层合并。
  const callCreateIpGroup = async (req) => {
    const token = requireApiToken();
    const name = String(firstDefined(req?.name, req?.Name) || '').trim();
    if (!name) {
      throw errorWithCode('INVALID_ARGUMENT', 'name is required');
    }
    const original = req?.original;
    if (original !== undefined && !Array.isArray(original)) {
      throw errorWithCode('INVALID_ARGUMENT', 'original must be an array');
    }

    const baseUrl = normalizeBaseUrl(restBaseUrl);
    if (!baseUrl) {
      throw errorWithCode('INVALID_ARGUMENT', 'restBaseUrl/baseUrl is required (http/https)');
    }

    const payload = buildIpGroupPayload({ ...req, name });
    const headers = buildHeaders(token);
    const url = `${baseUrl}/api/IPGroupAPI`;

    const res = await fetchSafeline(url, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await readJsonResponse(res, {});

    return mapIpGroupResponse(json);
  };

  const callUpdateIpGroup = async (req) => {
    const token = requireApiToken();
    const baseUrl = normalizeBaseUrl(restBaseUrl);
    if (!baseUrl) {
      throw errorWithCode('INVALID_ARGUMENT', 'restBaseUrl/baseUrl is required (http/https)');
    }
    const payload = buildUpdateIpGroupPayload(req);

    const headers = buildHeaders(token);
    const url = `${baseUrl}/api/IPGroupAPI`;

    const res = await fetchSafeline(url, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await readJsonResponse(res, {});

    return mapIpGroupResponse(json);
  };

  const callListIpGroups = async (req) => {
    const token = requireApiToken();
    const baseUrl = normalizeBaseUrl(restBaseUrl);
    if (!baseUrl) {
      throw errorWithCode('INVALID_ARGUMENT', 'restBaseUrl/baseUrl is required (http/https)');
    }

    const names = unwrapList(firstDefined(req?.name, req?.Name));
    if (names !== undefined && !Array.isArray(names)) {
      throw errorWithCode('INVALID_ARGUMENT', 'name must be an array');
    }
    const comments = unwrapList(firstDefined(req?.comment, req?.Comment));
    if (comments !== undefined && !Array.isArray(comments)) {
      throw errorWithCode('INVALID_ARGUMENT', 'comment must be an array');
    }
    const cidr = pickStringField(req, ['cidr', 'Cidr']);
    const count = toQueryNumber(firstDefined(req?.count, req?.Count));
    const offset = toQueryNumber(firstDefined(req?.offset, req?.Offset), true);

    if (count !== undefined && count <= 0) {
      throw errorWithCode('INVALID_ARGUMENT', 'count must be > 0 when provided');
    }
    if (offset !== undefined && offset < 0) {
      throw errorWithCode('INVALID_ARGUMENT', 'offset must be >= 0 when provided');
    }

    // URLSearchParams 在部分 JS 引擎内置缺失，手工构造 query 以保证兼容性
    const queryParts = [];
    (names || []).forEach((nameVal) => {
      if (nameVal !== undefined && nameVal !== null) {
        queryParts.push(`name=${encodeURIComponent(String(nameVal))}`);
      }
    });
    if (cidr !== undefined) {
      queryParts.push(`cidr=${encodeURIComponent(String(cidr))}`);
    }
    (comments || []).forEach((commentVal) => {
      if (commentVal !== undefined && commentVal !== null) {
        queryParts.push(`comment=${encodeURIComponent(String(commentVal))}`);
      }
    });
    if (count !== undefined) {
      queryParts.push(`count=${encodeURIComponent(String(count))}`);
    }
    if (offset !== undefined) {
      queryParts.push(`offset=${encodeURIComponent(String(offset))}`);
    }

    const url = `${baseUrl}/api/IPGroupAPI${queryParts.length ? `?${queryParts.join('&')}` : ''}`;
    const headers = buildHeaders(token);

    const res = await fetchSafeline(url, { method: 'GET', headers });
    const emptyListResponse = { err: null, msg: null, data: { list: [] } };
    const json = await readJsonResponse(res, emptyListResponse);
    if (json === emptyListResponse) return emptyListResponse;

    const data = json?.data && typeof json.data === 'object' ? json.data : {};
    // Safeline 可能返回 data.list 或 data.items 或根级 list/items，这里兼容多种结构
    const list = Array.isArray(data?.list)
      ? data.list
      : Array.isArray(data?.items)
      ? data.items
      : Array.isArray(json)
      ? json
      : Array.isArray(json?.list)
      ? json.list
      : Array.isArray(json?.items)
      ? json.items
      : Array.isArray(json?.data)
      ? json.data
      : [];

    const mapRecordSafe = (item) => ({
      id: (() => {
        const num = Number(item?.id);
        return Number.isInteger(num) && !Number.isNaN(num) ? num : 0;
      })(),
      name: item?.name ?? '',
    });

    const responseData = {
      items: list.map(mapRecordSafe),
    };

    const mapNumberField = (field) => {
      const val = data && typeof data === 'object' ? data[field] : undefined;
      if (val === undefined || val === null) return undefined;
      const num = Number(val);
      if (!Number.isInteger(num) || Number.isNaN(num)) return undefined;
      return num;
    };

    const totalVal = mapNumberField('total');
    if (totalVal !== undefined) responseData.total = totalVal;

    return {
      err: toValue(json?.err),
      msg: toValue(json?.msg),
      data: responseData,
    };
  };

  const callDeleteIpGroup = async (req) => {
    const token = requireApiToken();
    const baseUrl = normalizeBaseUrl(restBaseUrl);
    if (!baseUrl) {
      throw errorWithCode('INVALID_ARGUMENT', 'restBaseUrl/baseUrl is required (http/https)');
    }

    const rawIdList = firstDefined(req?.['id__in'], req?.id__in, req?.idIn, req?.Id__in, req?.IdIn);
    const idList = extractIntList(rawIdList);
    if (idList === null) {
      throw errorWithCode('INVALID_ARGUMENT', 'id__in must be an int64 list');
    }

    const deleteAll = Boolean(firstDefined(req?.delete_all_resources, req?.deleteAllResources, req?.DeleteAllResources));
    const hasIds = idList.length > 0;

    if (hasIds && deleteAll) {
      throw errorWithCode('INVALID_ARGUMENT', 'id__in and delete_all_resources=true cannot be used together');
    }
    if (!hasIds && !deleteAll) {
      throw errorWithCode('INVALID_ARGUMENT', 'id__in is required unless delete_all_resources=true');
    }

    const payload = {};
    if (hasIds) {
      payload['id__in'] = idList;
    }
    if (deleteAll) {
      payload.delete_all_resources = true;
    }

    const headers = { ...buildHeaders(token), 'content-type': 'application/json' };
    const url = `${baseUrl}/api/IPGroupAPI`;

    const res = await fetchSafeline(url, {
      method: 'DELETE',
      headers,
      body: JSON.stringify(payload),
    });
    const emptyDeleteResponse = { err: null, msg: null, data: null };
    const json = await readJsonResponse(res, emptyDeleteResponse);
    if (json === emptyDeleteResponse) return emptyDeleteResponse;

    return {
      err: toValue(json?.err),
      msg: toValue(json?.msg),
      data: json?.data ?? null,
    };
  };


  const callAddIpGroupItems = async (req) => {
    const token = requireApiToken();
    const baseUrl = normalizeBaseUrl(restBaseUrl);
    if (!baseUrl) {
      throw errorWithCode('INVALID_ARGUMENT', 'restBaseUrl/baseUrl is required (http/https)');
    }

    const rawId = firstDefined(req?.id, req?.Id);
    if (rawId === undefined || rawId === null) {
      throw errorWithCode('INVALID_ARGUMENT', 'id is required');
    }
    const idNum = Number(rawId);
    if (!Number.isInteger(idNum) || Number.isNaN(idNum)) {
      throw errorWithCode('INVALID_ARGUMENT', 'id must be an integer');
    }

    let targetsPayload;
    const hasTargets = hasOwn(req, 'targets') || hasOwn(req, 'Targets');
    if (hasTargets) {
      const rawTargets = firstDefined(req?.targets, req?.Targets);
      if (rawTargets === undefined || rawTargets === null) {
        targetsPayload = [];
      } else if (!Array.isArray(rawTargets)) {
        throw errorWithCode('INVALID_ARGUMENT', 'targets must be an array when provided');
      } else {
        targetsPayload = rawTargets.map((item) => {
          if (item === undefined || item === null) {
            throw errorWithCode('INVALID_ARGUMENT', 'targets elements must be non-null strings');
          }
          return String(item);
        });
      }
    }

    const payload = { id: idNum };
    if (targetsPayload !== undefined) {
      payload.targets = targetsPayload;
    }

    const headers = { ...buildHeaders(token), 'content-type': 'application/json' };
    const url = `${baseUrl}/api/EditIPGroupItem`;

    const res = await fetchSafeline(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const emptyAddResponse = { err: null, msg: '', data: null };
    const json = await readJsonResponse(res, emptyAddResponse);
    if (json === emptyAddResponse) return emptyAddResponse;

    const dataField = json?.data && typeof json.data === 'object' ? json.data : {};
    const normalizeArray = (val) => (Array.isArray(val) ? val : []);

    return {
      err: toValue(json?.err),
      msg: toValue(json?.msg),
      data: {
        id: (() => {
          const num = Number(dataField?.id ?? json?.data?.id ?? json?.id);
          return Number.isInteger(num) && !Number.isNaN(num) ? num : 0;
        })(),
        name: dataField?.name ?? '',
        comment: dataField?.comment ?? '',
        original: normalizeArray(dataField?.original),
        cidrs: normalizeArray(dataField?.cidrs),
      }
    };
  };

  const callUpdateDetectorState = async (req) => {
    const token = requireApiToken();
    const baseUrl = normalizeBaseUrl(restBaseUrl);
    if (!baseUrl) {
      throw errorWithCode('INVALID_ARGUMENT', 'restBaseUrl/baseUrl is required (http/https)');
    }

    const hasIsEnabled = hasOwn(req, 'is_enabled') || hasOwn(req, 'isEnabled');
    if (!hasIsEnabled) {
      throw errorWithCode('INVALID_ARGUMENT', 'is_enabled is required');
    }
    const rawIsEnabled = hasOwn(req, 'is_enabled') ? req.is_enabled : req?.isEnabled;
    const normalizedBool = toBoolean(rawIsEnabled);
    if (normalizedBool === null) {
      throw errorWithCode('INVALID_ARGUMENT', 'is_enabled must be a boolean');
    }

    const headers = { ...buildHeaders(token), 'content-type': 'application/json' };
    const url = `${baseUrl}/api/EnableDisableDetectorAPI`;
    const payload = { is_enabled: normalizedBool };

    const res = await fetchSafeline(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify(payload),
    });
    const emptyUpdateDetectorResponse = { err: null, msg: null, data: null };
    const json = await readJsonResponse(res, emptyUpdateDetectorResponse);
    if (json === emptyUpdateDetectorResponse) return emptyUpdateDetectorResponse;

    return {
      err: toValue(json?.err),
      msg: toValue(json?.msg),
      data: json?.data ?? null,
    };
  };

  const callDeleteIpGroupItems = async (req) => {
    const token = requireApiToken();
    const baseUrl = normalizeBaseUrl(restBaseUrl);
    if (!baseUrl) {
      throw errorWithCode('INVALID_ARGUMENT', 'restBaseUrl/baseUrl is required (http/https)');
    }

    const rawId = firstDefined(req?.id, req?.Id);
    if (rawId === undefined || rawId === null) {
      throw errorWithCode('INVALID_ARGUMENT', 'id is required');
    }
    const idNum = Number(rawId);
    if (!Number.isInteger(idNum) || Number.isNaN(idNum)) {
      throw errorWithCode('INVALID_ARGUMENT', 'id must be an integer');
    }

    let targetsPayload;
    const hasTargets = hasOwn(req, 'targets') || hasOwn(req, 'Targets');
    if (hasTargets) {
      const rawTargets = firstDefined(req?.targets, req?.Targets);
      if (rawTargets === undefined || rawTargets === null) {
        targetsPayload = [];
      } else if (!Array.isArray(rawTargets)) {
        throw errorWithCode('INVALID_ARGUMENT', 'targets must be an array when provided');
      } else {
        targetsPayload = rawTargets.map((item) => {
          if (item === undefined || item === null) {
            throw errorWithCode('INVALID_ARGUMENT', 'targets elements must be non-null strings');
          }
          return String(item);
        });
      }
    }

    const payload = { id: idNum };
    if (targetsPayload !== undefined) {
      payload.targets = targetsPayload;
    }

    const headers = { ...buildHeaders(token), 'content-type': 'application/json' };
    const url = `${baseUrl}/api/EditIPGroupItem`;

    const res = await fetchSafeline(url, {
      method: 'DELETE',
      headers,
      body: JSON.stringify(payload),
    });
    const json = await readJsonResponse(res, { err: null, msg: '', data: null });

    return {
      err: json?.err ?? null,
      msg: json?.msg ?? null,
      data: json?.data ?? null,
    };
  };

  const callGetDetectorState = async (req) => {
    const token = requireApiToken();
    const baseUrl = normalizeBaseUrl(restBaseUrl);
    if (!baseUrl) {
      throw errorWithCode('INVALID_ARGUMENT', 'restBaseUrl/baseUrl is required (http/https)');
    }

    const headers = buildHeaders(token);
    const url = `${baseUrl}/api/EnableDisableDetectorAPI`;

    const res = await fetchSafeline(url, { method: 'GET', headers });
    const json = await readJsonResponse(res, { err: null, msg: '', data: {} });

    const data = json && typeof json === 'object' && typeof json.data === 'object' && json.data !== null ? json.data : {};
    const isEnabledSource = firstDefined(
      hasOwn(data, 'is_enabled') ? data.is_enabled : undefined,
      hasOwn(data, 'isEnabled') ? data.isEnabled : undefined,
      data.is_enabled,
      data.isEnabled
    );
    const isEnabled = toBooleanStrict(isEnabledSource);

    return {
      err: json?.err ?? null,
      msg: json?.msg ?? '',
      data: {
        is_enabled: isEnabled,
        raw: data,
      }
    };
  };

  const findOrCreateGroupId = async (req) => {
    const rawGroupId = firstDefined(req?.group_id, req?.groupId);
    const idNum = toInt64(rawGroupId);
    if (idNum !== null && idNum !== 0) {
      return idNum;
    }

    const normalizedGroupName = () => {
      const val = firstDefined(req?.group_name, req?.groupName);
      if (val === undefined || val === null) return '';
      const trimmed = String(val).trim();
      return trimmed;
    };

    const groupName = normalizedGroupName() || 'block_ip';

    // 按名称查找现有组
    try {
      const listRes = await callListIpGroups({
        name: [groupName]
      });
      // listRes.data 结构与 callListIpGroups 返回一致（data.items）
      const items = listRes?.data?.items || listRes?.data?.list || [];
      const found = items.find((item) => String(item?.name) === groupName);
      if (found && found.id !== undefined && found.id !== null) {
        const idCandidate = toInt64(found.id);
        if (idCandidate !== null) {
          return idCandidate;
        }
      }
    } catch (e) {
      // list 出错则继续尝试创建，以防 404/空
    }

    // 未找到则创建
    const createPayload = {
      name: groupName,
      comment: String(firstDefined(req?.comment, req?.Comment) || ''),
      original: []
    };
    const created = await callCreateIpGroup(createPayload);
    const createdId = toInt64(created?.id);
    if (createdId === null) {
      throw errorWithCode('UNKNOWN', 'created group has no id');
    }
    return createdId;
  };

  const callBlockIp = async (req) => {
    const token = requireApiToken();
    const targets = requireTargets(req, ['targets', 'Targets']);
    const baseUrl = normalizeBaseUrl(restBaseUrl);
    if (!baseUrl) {
      throw errorWithCode('INVALID_ARGUMENT', 'restBaseUrl/baseUrl is required (http/https)');
    }

    logFlow('BlockIP:start', { baseUrl, targets: targets.length, group_id: req?.group_id ?? req?.groupId, group_name: req?.group_name ?? req?.groupName });
    const groupId = await findOrCreateGroupId({ ...req, baseUrl });
    logFlow('BlockIP:resolved-group', { groupId });

    const result = await callAddIpGroupItems({
      api_token: token,
      id: groupId,
      targets
    });
    logFlow('BlockIP:done', { groupId, added: targets.length });
    return result;
  };

  const callUnblockIp = async (req) => {
    const token = requireApiToken();
    const targets = requireTargets(req, ['targets', 'Targets']);
    const baseUrl = normalizeBaseUrl(restBaseUrl);
    if (!baseUrl) {
      throw errorWithCode('INVALID_ARGUMENT', 'restBaseUrl/baseUrl is required (http/https)');
    }

    logFlow('UnblockIP:start', { baseUrl, targets: targets.length, group_id: req?.group_id ?? req?.groupId, group_name: req?.group_name ?? req?.groupName });
    const groupId = await findOrCreateGroupId({ ...req, baseUrl });
    logFlow('UnblockIP:resolved-group', { groupId });

    const result = await callDeleteIpGroupItems({
      api_token: token,
      id: groupId,
      targets
    });
    logFlow('UnblockIP:done', { groupId, removed: targets.length });
    return result;
  };

  return {
    [METHOD_PATH]: async () => callAggregate(requestWithDefaults(ctx.req)),
    [CREATE_IP_GROUP_PATH]: async () => callCreateIpGroup(requestWithDefaults(ctx.req)),
    [UPDATE_IP_GROUP_PATH]: async () => callUpdateIpGroup(requestWithDefaults(ctx.req)),
    [LIST_IP_GROUPS_PATH]: async () => callListIpGroups(requestWithDefaults(ctx.req)),
    [DELETE_IP_GROUP_PATH]: async () => callDeleteIpGroup(requestWithDefaults(ctx.req)),
    [DELETE_IP_GROUP_ITEMS_PATH]: async () => callDeleteIpGroupItems(requestWithDefaults(ctx.req)),
    [ADD_IP_GROUP_ITEMS_PATH]: async () => callAddIpGroupItems(requestWithDefaults(ctx.req)),
    [GET_DETECTOR_STATE_PATH]: async () => callGetDetectorState(requestWithDefaults(ctx.req)),
    [UPDATE_DETECTOR_STATE_PATH]: async () => callUpdateDetectorState(requestWithDefaults(ctx.req)),
    [BLOCK_IP_PATH]: async () => callBlockIp(requestWithDefaults(ctx.req)),
    [UNBLOCK_IP_PATH]: async () => callUnblockIp(requestWithDefaults(ctx.req))
  };
}

const mergeCtx = (baseCtx, innerCtx) => ({
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

const resolveCallContext = (baseCtx, reqOrCtx, maybeInnerCtx) => {
  if (maybeInnerCtx !== undefined) {
    return { req: reqOrCtx ?? {}, ctx: mergeCtx(baseCtx, maybeInnerCtx) };
  }
  const innerCtx = reqOrCtx ?? {};
  return {
    req: innerCtx.request ?? innerCtx.req ?? {},
    ctx: mergeCtx(baseCtx, innerCtx),
  };
};

const wrapLegacyHandler = (baseCtx, methodPath) => async (reqOrCtx, maybeInnerCtx) => {
  const call = resolveCallContext(baseCtx, reqOrCtx, maybeInnerCtx);
  const legacyCtx = {
    ...call.ctx,
    req: call.req,
  };
  return rpcdef(legacyCtx)[methodPath]();
};

const registerHandlers = (ctx = {}) => ({
  [METHOD_PATH]: wrapLegacyHandler(ctx, METHOD_PATH),
  [CREATE_IP_GROUP_PATH]: wrapLegacyHandler(ctx, CREATE_IP_GROUP_PATH),
  [UPDATE_IP_GROUP_PATH]: wrapLegacyHandler(ctx, UPDATE_IP_GROUP_PATH),
  [LIST_IP_GROUPS_PATH]: wrapLegacyHandler(ctx, LIST_IP_GROUPS_PATH),
  [DELETE_IP_GROUP_PATH]: wrapLegacyHandler(ctx, DELETE_IP_GROUP_PATH),
  [DELETE_IP_GROUP_ITEMS_PATH]: wrapLegacyHandler(ctx, DELETE_IP_GROUP_ITEMS_PATH),
  [ADD_IP_GROUP_ITEMS_PATH]: wrapLegacyHandler(ctx, ADD_IP_GROUP_ITEMS_PATH),
  [GET_DETECTOR_STATE_PATH]: wrapLegacyHandler(ctx, GET_DETECTOR_STATE_PATH),
  [UPDATE_DETECTOR_STATE_PATH]: wrapLegacyHandler(ctx, UPDATE_DETECTOR_STATE_PATH),
  [BLOCK_IP_PATH]: wrapLegacyHandler(ctx, BLOCK_IP_PATH),
  [UNBLOCK_IP_PATH]: wrapLegacyHandler(ctx, UNBLOCK_IP_PATH),
});

export const METHOD_AGGREGATE_DETECT_LOG_BY_SRC_IP_FULL = 'Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/AggregateDetectLogBySrcIP';
export const METHOD_CREATE_IP_GROUP_FULL = 'Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/CreateIPGroup';
export const METHOD_UPDATE_IP_GROUP_FULL = 'Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/UpdateIPGroup';
export const METHOD_LIST_IP_GROUPS_FULL = 'Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/ListIPGroups';
export const METHOD_DELETE_IP_GROUP_FULL = 'Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/DeleteIPGroup';
export const METHOD_DELETE_IP_GROUP_ITEMS_FULL = 'Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/DeleteIPGroupItems';
export const METHOD_ADD_IP_GROUP_ITEMS_FULL = 'Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/AddIPGroupItems';
export const METHOD_BLOCK_IP_FULL = 'Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/BlockIP';
export const METHOD_UNBLOCK_IP_FULL = 'Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/UnblockIP';
export const METHOD_GET_DETECTOR_STATE_FULL = 'Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/GetDetectorState';
export const METHOD_UPDATE_DETECTOR_STATE_FULL = 'Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/UpdateDetectorState';

const sdkHandlers = registerHandlers({});

export const handlers = {
  [METHOD_AGGREGATE_DETECT_LOG_BY_SRC_IP_FULL]: (ctx) => sdkHandlers[METHOD_PATH](ctx),
  [METHOD_CREATE_IP_GROUP_FULL]: (ctx) => sdkHandlers[CREATE_IP_GROUP_PATH](ctx),
  [METHOD_UPDATE_IP_GROUP_FULL]: (ctx) => sdkHandlers[UPDATE_IP_GROUP_PATH](ctx),
  [METHOD_LIST_IP_GROUPS_FULL]: (ctx) => sdkHandlers[LIST_IP_GROUPS_PATH](ctx),
  [METHOD_DELETE_IP_GROUP_FULL]: (ctx) => sdkHandlers[DELETE_IP_GROUP_PATH](ctx),
  [METHOD_DELETE_IP_GROUP_ITEMS_FULL]: (ctx) => sdkHandlers[DELETE_IP_GROUP_ITEMS_PATH](ctx),
  [METHOD_ADD_IP_GROUP_ITEMS_FULL]: (ctx) => sdkHandlers[ADD_IP_GROUP_ITEMS_PATH](ctx),
  [METHOD_BLOCK_IP_FULL]: (ctx) => sdkHandlers[BLOCK_IP_PATH](ctx),
  [METHOD_UNBLOCK_IP_FULL]: (ctx) => sdkHandlers[UNBLOCK_IP_PATH](ctx),
  [METHOD_GET_DETECTOR_STATE_FULL]: (ctx) => sdkHandlers[GET_DETECTOR_STATE_PATH](ctx),
  [METHOD_UPDATE_DETECTOR_STATE_FULL]: (ctx) => sdkHandlers[UPDATE_DETECTOR_STATE_PATH](ctx),
};

export const _test = {
  createTlsDispatcher,
  errorWithCode,
  extractIntList,
  extractOriginalValues,
  fetchWithTimeout,
  mergedBindings,
  normalizeList,
  parseHeaders,
  registerHandlers,
  resolveCallContext,
  toBoolean,
  toBooleanStrict,
  toPositiveInt,
  toQueryNumber,
  toValue,
  unwrapString,
};
