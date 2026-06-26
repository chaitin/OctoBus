import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const SERVICE_PACKAGE = 'CTYun_CloudFirewallC100.CTYun_CloudFirewallC100';
export const DEFAULT_ENDPOINT = 'https://ctcfw-east-a.ctapi.ctyun.cn';
export const DEFAULT_URL_TYPE = 'CTAPI';
export const DEFAULT_TIMEOUT_MS = 5000;

export const READ_ONLY_APIS = [
  { methodName: 'QueryBlackWhitePolicyInfo', api: 'queryBlackWhitePolicyInfo', httpMethod: 'GET', path: '/vfw/v2_black_white_policy_info' },
  { methodName: 'GetSystemVrfbindInfo', api: 'getSystemVrfbindInfo', httpMethod: 'GET', path: '/vfw/v2_system_vrf_bind_info' },
  { methodName: 'AcPolicyOverviewC', api: 'acPolicyOverviewC', httpMethod: 'GET', path: '/vfw/v2_ac_policy_overview' },
  { methodName: 'ProtectionStatisticsC', api: 'protectionStatisticsC', httpMethod: 'GET', path: '/vfw/v2_protection_statistics' },
  { methodName: 'AssetProtectionOverviewC', api: 'assetProtectionOverviewC', httpMethod: 'GET', path: '/vfw/v2_asset_protection_overview' },
  { methodName: 'FirewallOverviewC', api: 'firewallOverviewC', httpMethod: 'GET', path: '/vfw/v2_firewall_overview' },
  { methodName: 'QueryVfwFlowLog', api: 'queryVfwFlowLog', httpMethod: 'GET', path: '/vfw/v2_flow_log_query' },
  { methodName: 'QueryRegionMaximumsC', api: 'queryRegionMaximumsC', httpMethod: 'GET', path: '/vfw/v2_query_region_maximums' },
  { methodName: 'GetSystemVrfbindSyncStatus', api: 'getSystemVrfbindSyncStatus', httpMethod: 'GET', path: '/vfw/v2_system_vrf_bind_sync_status' },
  { methodName: 'GetSystemVrfbindSynctime', api: 'getSystemVrfbindSynctime', httpMethod: 'GET', path: '/vfw/v2_system_vrf_bind_sync_time' },
  { methodName: 'RandomFirewallName', api: 'randomFirewallName', httpMethod: 'GET', path: '/vfw/v2_firewall_random_firewall_name' },
  { methodName: 'QueryFirewallSimpleInfo', api: 'queryFirewallSimpleInfo', httpMethod: 'GET', path: '/vfw/v2_firewall_simple_query' },
  { methodName: 'GetVpcSubnetList', api: 'getVpcSubnetList', httpMethod: 'GET', path: '/vfw/v2_firewall_subnet_list' },
  { methodName: 'GetUserVpcList', api: 'getUserVpcList', httpMethod: 'GET', path: '/vfw/v2_firewall_vpc_list' },
  { methodName: 'QueryFirewallInfo', api: 'queryFirewallInfo', httpMethod: 'GET', path: '/vfw/v2_firewall_query' },
  { methodName: 'CheckCidrC', api: 'checkCidrC', httpMethod: 'GET', path: '/vfw/v2_check_cidr' },
  { methodName: 'AssertExpressConnectQueryC', api: 'assertExpressConnectQueryC', httpMethod: 'GET', path: '/vfw/v2_assert_expressConnect_query' },
  { methodName: 'AssertCdaQueryC', api: 'assertCdaQueryC', httpMethod: 'GET', path: '/vfw/v2_assert_cda_query' },
  { methodName: 'AssertVpcPeerQueryC', api: 'assertVpcPeerQueryC', httpMethod: 'GET', path: '/vfw/v2_assert_vpcPeer_query' },
  { methodName: 'AssertStatisticsCC', api: 'assertStatisticsCC', httpMethod: 'GET', path: '/vfw/v2_assert_statistics' },
  { methodName: 'AssetAllC', api: 'assetAllC', httpMethod: 'GET', path: '/vfw/v2_asset_all' },
  { methodName: 'AssertNatQueryC', api: 'assertNatQueryC', httpMethod: 'GET', path: '/vfw/v2_assert_nat_query' },
  { methodName: 'QuerySystemVrfbindStatistics', api: 'querySystemVrfbindStatistics', httpMethod: 'GET', path: '/vfw/v2_system_vrf_bind_statistics' },
  { methodName: 'QuerySystemVrfbind', api: 'querySystemVrfbind', httpMethod: 'GET', path: '/vfw/v2_system_vrf_bind_query' },
  { methodName: 'QueryBlackWhitePolicy', api: 'queryBlackWhitePolicy', httpMethod: 'GET', path: '/vfw/v2_black_white_policy_query' },
  { methodName: 'QuerySecPolicyRules', api: 'QuerySecPolicyRules', httpMethod: 'GET', path: '/vfw/v2_system_sec_policy_query' },
  { methodName: 'QuerySecPolicyRuleInfo', api: 'QuerySecPolicyRuleInfo', httpMethod: 'GET', path: '/vfw/v2_system_sec_policy_info' },
  { methodName: 'QuerySecpolicyStatistics', api: 'querySecpolicyStatistics', httpMethod: 'GET', path: '/vfw/v2_system_sec_policy_statistics' },
  { methodName: 'QueryAppWithParent', api: 'queryAppWithParent', httpMethod: 'GET', path: '/vfw/v2_app_queryAppWithParent' },
  { methodName: 'IpsRuleQueryAll', api: 'ipsRuleQueryAll', httpMethod: 'GET', path: '/vfw/v2_ips_rule_queryAll' },
  { methodName: 'QueryIpsRule', api: 'queryIpsRule', httpMethod: 'GET', path: '/vfw/v2_ips_rule_query' },
  { methodName: 'QueryIpsRuleTypeList', api: 'queryIpsRuleTypeList', httpMethod: 'GET', path: '/vfw/v2_ips_rule_type' },
  { methodName: 'QueryDpiInfo', api: 'queryDpiInfo', httpMethod: 'GET', path: '/vfw/v2_dpi_info' },
  { methodName: 'QueryAllApp', api: 'queryAllApp', httpMethod: 'GET', path: '/vfw/v2_app_queryAll' },
  { methodName: 'LogQueryDeliverInfoC', api: 'logQueryDeliverInfoC', httpMethod: 'GET', path: '/vfw/v2_log_query_deliver_info' },
  { methodName: 'LogQueryDeliverTimeC', api: 'logQueryDeliverTimeC', httpMethod: 'POST', path: '/vfw/v2_log_query_deliver_time' },
  { methodName: 'LogQueryDeliverListC', api: 'logQueryDeliverListC', httpMethod: 'GET', path: '/vfw/v2_log_query_deliver_list' },
  { methodName: 'GetRawLogAh', api: 'getRawLogAh', httpMethod: 'POST', path: '/vfw/200000004263/v2_get_raw_log' },
  { methodName: 'GetRawLogC', api: 'getRawLogC', httpMethod: 'POST', path: '/vfw/bb9fdb42056f11eda1610242ac110002/v2_get_raw_log' },
  { methodName: 'GetLogCountC', api: 'getLogCountC', httpMethod: 'POST', path: '/vfw/bb9fdb42056f11eda1610242ac110002/v2_get_log_count' },
  { methodName: 'LogSaveStatisticsLogC', api: 'logSaveStatisticsLogC', httpMethod: 'GET', path: '/vfw/v2_log_save_statistics' },
  { methodName: 'QueryOperationLog', api: 'queryOperationLog', httpMethod: 'GET', path: '/vfw/v2_operation_log_query' },
  { methodName: 'GetLogSettingInfo', api: 'getLogSettingInfo', httpMethod: 'GET', path: '/vfw/v2_log_setting_info' },
  { methodName: 'AlarmStatics', api: 'alarmStatics', httpMethod: 'GET', path: '/vfw/v2_alarm_statics' },
  { methodName: 'AlarmQuery', api: 'alarmQuery', httpMethod: 'GET', path: '/vfw/v2_alarm_query' },
  { methodName: 'AlarmLogList', api: 'alarmLogList', httpMethod: 'GET', path: '/vfw/v2_alarm_logList' },
  { methodName: 'AlarmDetail', api: 'alarmDetail', httpMethod: 'GET', path: '/vfw/v2_alarm_detail' },
  { methodName: 'ReportSubscribe', api: 'reportSubscribe', httpMethod: 'GET', path: '/vfw/v2_report_subscribe' },
  { methodName: 'ReportStatistics', api: 'reportStatistics', httpMethod: 'GET', path: '/vfw/v2_report_statistics' },
  { methodName: 'ReportList', api: 'reportList', httpMethod: 'GET', path: '/vfw/v2_report_list' },
  { methodName: 'StatisticAddressGroup', api: 'statisticAddressGroup', httpMethod: 'GET', path: '/vfw/v2_address_group_statistic' },
  { methodName: 'QueryAddressGroup', api: 'queryAddressGroup', httpMethod: 'GET', path: '/vfw/v2_address_group_query' },
  { methodName: 'ItemsAddressGroup', api: 'itemsAddressGroup', httpMethod: 'GET', path: '/vfw/v2_address_group_items' },
  { methodName: 'Notification', api: 'notification', httpMethod: 'GET', path: '/vfw/v2_notification' },
];

export const METHOD_INVOKE_READ_ONLY_API_FULL = `${SERVICE_PACKAGE}/InvokeReadOnlyApi`;
export const METHOD_INVOKE_READ_ONLY_API_PATH = `/${METHOD_INVOKE_READ_ONLY_API_FULL}`;

const API_BY_NAME = new Map(READ_ONLY_APIS.map((entry) => [entry.api, entry]));
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  DEADLINE_EXCEEDED: grpcStatus.DEADLINE_EXCEEDED,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

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

const optionalUint32 = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return Math.trunc(num);
};

const normalizeStructValue = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object') return value;
  if (hasOwn(value, 'stringValue')) return value.stringValue;
  if (hasOwn(value, 'numberValue')) return value.numberValue;
  if (hasOwn(value, 'boolValue')) return value.boolValue;
  if (hasOwn(value, 'nullValue')) return null;
  if (hasOwn(value, 'listValue') && Array.isArray(value.listValue?.values)) return value.listValue.values.map((item) => normalizeStructValue(item));
  if (hasOwn(value, 'structValue') && value.structValue?.fields) return normalizeStruct(value.structValue);
  if (hasOwn(value, 'fields')) return normalizeStruct(value);
  if (hasOwn(value, 'value')) return normalizeStructValue(value.value);
  if (Array.isArray(value)) return value.map((item) => normalizeStructValue(item));

  const result = {};
  for (const [key, innerValue] of Object.entries(value)) result[key] = normalizeStructValue(innerValue);
  return result;
};

const normalizeStruct = (value) => {
  if (!value) return {};
  if (hasOwn(value, 'fields') && value.fields && typeof value.fields === 'object') {
    const result = {};
    for (const [key, innerValue] of Object.entries(value.fields)) result[key] = normalizeStructValue(innerValue);
    return result;
  }
  if (typeof value === 'object' && !Array.isArray(value)) return normalizeStructValue(value);
  return {};
};

const toValue = (value) => {
  if (value === undefined || value === null) return { nullValue: 'NULL_VALUE' };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return Number.isFinite(value) ? { numberValue: value } : { stringValue: String(value) };
  if (typeof value === 'boolean') return { boolValue: value };
  if (Array.isArray(value)) return { listValue: { values: value.map(toValue) } };
  if (typeof value === 'object') {
    const fields = {};
    for (const [key, innerValue] of Object.entries(value)) fields[key] = toValue(innerValue);
    return { structValue: { fields } };
  }
  return { stringValue: String(value) };
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx.config ?? {}),
  ...(ctx.secret ?? {}),
  ...(ctx.bindings ?? {}),
});

const isSdkHandlerContext = (value) => value && typeof value === 'object'
  && Object.prototype.hasOwnProperty.call(value, 'request')
  && (
    Object.prototype.hasOwnProperty.call(value, 'config')
    || Object.prototype.hasOwnProperty.call(value, 'secret')
    || Object.prototype.hasOwnProperty.call(value, 'bindings')
    || Object.prototype.hasOwnProperty.call(value, 'limits')
    || Object.prototype.hasOwnProperty.call(value, 'meta')
  );

const handlerRequest = (req, ctx) => (ctx === undefined && isSdkHandlerContext(req) ? (req.request ?? {}) : (req ?? {}));
const handlerContext = (req, ctx) => (ctx === undefined && isSdkHandlerContext(req) ? req : (ctx ?? {}));

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
});

const resolveTimeoutMs = (ctx = {}) => optionalUint32(ctx.bindings?.timeoutMs) ?? optionalUint32(ctx.limits?.timeoutMs) ?? DEFAULT_TIMEOUT_MS;

const validateBindings = (bindings = {}) => {
  const accessKeyId = toTrimmedString(firstDefined(bindings.accessKeyId, bindings.access_key_id, bindings.ak, bindings.AccessKeyID));
  const secretAccessKey = toTrimmedString(firstDefined(bindings.secretAccessKey, bindings.secret_access_key, bindings.sk, bindings.SecretAccessKey));
  const regionId = toTrimmedString(firstDefined(bindings.regionId, bindings.region_id, bindings.regionid, bindings.RegionId));
  if (!accessKeyId) throw errorWithCode('FAILED_PRECONDITION', 'secret "accessKeyId" or "ak" is required but not configured');
  if (!secretAccessKey) throw errorWithCode('FAILED_PRECONDITION', 'secret "secretAccessKey" or "sk" is required but not configured');
  if (!regionId) throw errorWithCode('FAILED_PRECONDITION', 'config "regionId" is required but not configured');

  return {
    accessKeyId,
    secretAccessKey,
    regionId,
    urlType: toTrimmedString(firstDefined(bindings.urlType, bindings.url_type)) || DEFAULT_URL_TYPE,
    endpoint: toTrimmedString(firstDefined(bindings.endpoint, bindings.host, bindings.baseUrl)) || DEFAULT_ENDPOINT,
  };
};

const endpointFor = (endpoint) => {
  try {
    const url = new URL(endpoint);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('bad protocol');
    return url;
  } catch {
    throw errorWithCode('FAILED_PRECONDITION', 'endpoint must be a valid http or https URL');
  }
};

const uriEscape = (value) => encodeURIComponent(String(value))
  .replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);

const assertQueryParamValue = (key, value) => {
  if (value !== null && typeof value === 'object') {
    throw errorWithCode('INVALID_ARGUMENT', `nested object not supported in query params for key "${key}"`);
  }
};

const queryParamsToString = (params = {}) => Object.keys(params)
  .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
  .sort()
  .flatMap((key) => {
    const value = params[key];
    if (Array.isArray(value)) return value.map((item) => {
      assertQueryParamValue(key, item);
      return `${key}=${uriEscape(item)}`;
    }).sort();
    assertQueryParamValue(key, value);
    return [`${key}=${uriEscape(value)}`];
  })
  .join('&');

const hashSHA256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const hmacSHA256 = (key, value, encoding) => crypto.createHmac('sha256', key).update(value).digest(encoding);

const eopDateFromDate = (date) => {
  const beijing = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = (num) => String(num).padStart(2, '0');
  return [
    beijing.getUTCFullYear(),
    pad(beijing.getUTCMonth() + 1),
    pad(beijing.getUTCDate()),
    'T',
    pad(beijing.getUTCHours()),
    pad(beijing.getUTCMinutes()),
    pad(beijing.getUTCSeconds()),
    'Z',
  ].join('');
};

const getSigningKey = (secretAccessKey, accessKeyId, eopDate) => {
  const kTime = hmacSHA256(secretAccessKey, eopDate);
  const kAk = hmacSHA256(kTime, accessKeyId);
  return hmacSHA256(kAk, eopDate.slice(0, 8));
};

const canonicalHeaderValues = (value) => String(value).replace(/\s+/g, ' ').trim();

const signRequest = ({ query, bodyText, accessKeyId, secretAccessKey, requestId = crypto.randomUUID(), date = new Date() }) => {
  const eopDate = eopDateFromDate(date);
  const signedHeaders = {
    'ctyun-eop-request-id': requestId,
    'eop-date': eopDate,
  };
  const signedHeaderKeys = Object.keys(signedHeaders).sort();
  const canonicalHeaders = signedHeaderKeys.map((key) => `${key}:${canonicalHeaderValues(signedHeaders[key])}`).join('\n');
  const signedHeaderNames = signedHeaderKeys.join(';');
  const canonicalRequest = [
    `${canonicalHeaders}\n`,
    queryParamsToString(query),
    hashSHA256(bodyText || ''),
  ].join('\n');
  const signingKey = getSigningKey(secretAccessKey, accessKeyId, eopDate);
  const signature = hmacSHA256(signingKey, canonicalRequest, 'base64');
  return {
    headers: {
      'ctyun-eop-request-id': requestId,
      'Eop-date': eopDate,
      'Eop-Authorization': `${accessKeyId} Headers=${signedHeaderNames} Signature=${signature}`,
    },
    canonicalRequest,
    signature,
  };
};

const validateApiSpec = (api) => {
  const apiName = toTrimmedString(api);
  if (!apiName) throw errorWithCode('INVALID_ARGUMENT', 'api must be a non-empty string');
  const spec = API_BY_NAME.get(apiName);
  if (!spec) throw errorWithCode('INVALID_ARGUMENT', `unsupported or non-read-only CTYun Cloud Firewall C100 api "${apiName}"`);
  return spec;
};

const payloadFromRequest = (req = {}) => normalizeStruct(req.payload ?? {});

const splitPayloadForMethod = (spec, payload = {}) => {
  if (spec.httpMethod === 'GET') return { query: payload, bodyText: '' };
  return { query: {}, bodyText: JSON.stringify(payload ?? {}) };
};

const buildUrl = (endpoint, path, query) => {
  const url = endpointFor(endpoint);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/');
  url.search = queryParamsToString(query);
  return url;
};

const buildHeaders = (ctx, signedHeaders, bindings) => ({
  ...(ctx.bindings?.headers && typeof ctx.bindings.headers === 'object' ? ctx.bindings.headers : {}),
  'Content-Type': 'application/json',
  urlType: bindings.urlType,
  regionid: bindings.regionId,
  ...signedHeaders,
});

const parseJsonResponse = async (res) => {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', `CTYun Cloud Firewall C100 API returned non-JSON response: ${text.slice(0, 200)}`);
  }
};

const errorFromCtyunBody = (body) => {
  const statusCode = body?.statusCode ?? body?.code;
  const errorCode = body?.error || body?.errorCode || body?.code;
  const message = body?.errorMessage || body?.message || 'CTYun Cloud Firewall C100 API returned an error';
  const successError = errorCode === undefined || String(errorCode) === 'CFW_0000';
  const successStatus = statusCode === undefined || ['800', '200', '100000'].includes(String(statusCode));
  if (successError && successStatus) return null;
  const text = `${errorCode || statusCode}: ${message}`;
  if (/Auth|Unauthorized|Forbidden|Denied|Signature|AK|SK|Token|Permission|鉴权|权限/i.test(text)) return errorWithCode('PERMISSION_DENIED', text);
  if (/CFW_0001|Invalid|Missing|Parameter|Param|NotFound|Unsupported|参数/i.test(text)) return errorWithCode('INVALID_ARGUMENT', text);
  if (/CFW_0002|quota|协议|配额|未签署|未购买|订购|业务/i.test(text)) return errorWithCode('FAILED_PRECONDITION', text);
  return errorWithCode('UNKNOWN', text);
};

const invokeCtyun = async (spec, payload, ctx = {}) => {
  const apiSpec = validateApiSpec(spec.api);
  const callCtx = resolveCallContext(ctx);
  const bindings = validateBindings(callCtx.bindings);
  const { query, bodyText } = splitPayloadForMethod(apiSpec, payload);
  const url = buildUrl(bindings.endpoint, apiSpec.path, query);
  const date = callCtx.meta?.date instanceof Date
    ? callCtx.meta.date
    : (toTrimmedString(callCtx.meta?.date) ? new Date(toTrimmedString(callCtx.meta.date)) : new Date());
  const requestId = toTrimmedString(firstDefined(callCtx.meta?.request_id, callCtx.meta?.requestId));
  const signed = signRequest({
    query,
    bodyText,
    accessKeyId: bindings.accessKeyId,
    secretAccessKey: bindings.secretAccessKey,
    requestId: requestId || undefined,
    date,
  });
  const timeoutMs = resolveTimeoutMs(callCtx);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  let body;
  try {
    res = await fetch(url.toString(), {
      method: apiSpec.httpMethod,
      headers: buildHeaders(callCtx, signed.headers, bindings),
      body: apiSpec.httpMethod === 'GET' ? undefined : bodyText,
      signal: controller.signal,
    });
    body = await parseJsonResponse(res);
  } catch (err) {
    if (err.legacyCode) throw err;
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      throw errorWithCode('DEADLINE_EXCEEDED', `CTYun Cloud Firewall C100 API request timed out after ${timeoutMs}ms`);
    }
    throw errorWithCode('UNAVAILABLE', `failed to call CTYun Cloud Firewall C100 API: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }
  if (res.status >= 500) {
    throw errorWithCode('UNAVAILABLE', `CTYun Cloud Firewall C100 API HTTP ${res.status}: ${JSON.stringify(body).slice(0, 500)}`);
  }
  const ctyunError = errorFromCtyunBody(body);
  if (ctyunError) throw ctyunError;
  if (res.status < 200 || res.status >= 300) {
    const code = res.status === 401 || res.status === 403 ? 'PERMISSION_DENIED' : 'UNAVAILABLE';
    throw errorWithCode(code, `CTYun Cloud Firewall C100 API HTTP ${res.status}: ${JSON.stringify(body).slice(0, 500)}`);
  }
  return { response: toValue(body) };
};

const buildApiHandler = (spec) => async (req, ctx) => invokeCtyun(
  spec,
  payloadFromRequest(handlerRequest(req, ctx)),
  handlerContext(req, ctx),
);

export const handlers = Object.fromEntries([
  ...READ_ONLY_APIS.map((entry) => [`${SERVICE_PACKAGE}/${entry.methodName}`, buildApiHandler(entry)]),
  [METHOD_INVOKE_READ_ONLY_API_FULL, async (req, ctx) => {
    const request = handlerRequest(req, ctx);
    return invokeCtyun(
      validateApiSpec(request.api),
      normalizeStruct(request.payload ?? {}),
      handlerContext(req, ctx),
    );
  }],
]);

export const rpcdef = () => Object.fromEntries([
  ...READ_ONLY_APIS.map((entry) => [`/${SERVICE_PACKAGE}/${entry.methodName}`, handlers[`${SERVICE_PACKAGE}/${entry.methodName}`]]),
  [METHOD_INVOKE_READ_ONLY_API_PATH, handlers[METHOD_INVOKE_READ_ONLY_API_FULL]],
]);

export const _test = {
  API_BY_NAME,
  eopDateFromDate,
  getSigningKey,
  normalizeStruct,
  normalizeStructValue,
  toValue,
  validateBindings,
  validateApiSpec,
  queryParamsToString,
  signRequest,
  splitPayloadForMethod,
  invokeCtyun,
};
