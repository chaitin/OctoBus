import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const SERVICE_PACKAGE = 'CTYun_SecurityGuard.CTYun_SecurityGuard';
export const DEFAULT_ENDPOINT = 'https://ctcsscn-global.ctapi.ctyun.cn';
export const DEFAULT_TIMEOUT_MS = 5000;

export const READ_ONLY_APIS = [
  { methodName: 'UntreatedRisk', api: 'untreatedRisk', httpMethod: 'GET', path: '/v1/index/untreated' },
  { methodName: 'GetHostStatus', api: 'getHostStatus', httpMethod: 'GET', path: '/v1/index/status' },
  { methodName: 'GetRiskTrend', api: 'getRiskTrend', httpMethod: 'POST', path: '/v1/index/trend' },
  { methodName: 'GetRealTimeDynamics', api: 'getRealTimeDynamics', httpMethod: 'GET', path: '/v1/index/dynamics' },
  { methodName: 'OverviewAssets', api: 'overviewAssets', httpMethod: 'GET', path: '/v1/index/overview-assets' },
  { methodName: 'AssetsTop', api: 'assetsTop', httpMethod: 'GET', path: '/v1/index/assets-top' },
  { methodName: 'V1indexagentStatus', api: 'v1indexagentStatus', httpMethod: 'GET', path: '/v1/index/agentStatus' },
  { methodName: 'IndexOsType', api: 'IndexOsType', httpMethod: 'GET', path: '/v1/index/osType' },
  { methodName: 'V1indexprotectVersion', api: 'v1indexprotectVersion', httpMethod: 'GET', path: '/v1/index/protectVersion' },
  { methodName: 'V1indexassertDistribution', api: 'v1indexassertDistribution', httpMethod: 'GET', path: '/v1/index/assertDistribution' },
  { methodName: 'StatHostsByRegion', api: 'statHostsByRegion', httpMethod: 'GET', path: '/v1/index/region' },
  { methodName: 'StatHostsTrend', api: 'statHostsTrend', httpMethod: 'POST', path: '/v1/index/hostTrend' },
  { methodName: 'AssetClassify', api: 'assetClassify', httpMethod: 'GET', path: '/v1/assert/statistics' },
  { methodName: 'AssertList', api: 'assertList', httpMethod: 'POST', path: '/v1/assert/list' },
  { methodName: 'AssertAssertChangeHistory', api: 'assertAssertChangeHistory', httpMethod: 'POST', path: '/v1/assert/assertChangeHistory' },
  { methodName: 'V1hosttotalCount', api: 'v1hosttotalCount', httpMethod: 'GET', path: '/v1/host/totalCount' },
  { methodName: 'HostList', api: 'hostList', httpMethod: 'POST', path: '/v1/host/all' },
  { methodName: 'HostCSCAllNoRisk', api: 'HostCSCAllNoRisk', httpMethod: 'POST', path: '/v1/host/CSC/all' },
  { methodName: 'HostRegion', api: 'hostRegion', httpMethod: 'GET', path: '/v1/host/region' },
  { methodName: 'GetHostsDetail', api: 'getHostsDetail', httpMethod: 'GET', path: '/v1/host/detail/*' },
  { methodName: 'HostCloudGuardStatusQueryQuery', api: 'hostCloudGuardStatusQueryQuery', httpMethod: 'POST', path: '/v1/host/cloud/guard/statusQuery/query' },
  { methodName: 'GetHostsVulList', api: 'getHostsVulList', httpMethod: 'POST', path: '/v1/host/vulList' },
  { methodName: 'ScaRuleQueryScaRuleListOfPage', api: 'scaRuleQueryScaRuleListOfPage', httpMethod: 'POST', path: '/v1/sca/rule/query/scaruleListOfPage/*/*' },
  { methodName: 'ScaRuleQueryScaruleList', api: 'scaRuleQueryScaruleList', httpMethod: 'GET', path: '/v1/sca/rule/query/scaruleList' },
  { methodName: 'ScaRuleQueryScaList', api: 'scaRuleQueryScaList', httpMethod: 'GET', path: '/v1/sca/rule/query/scaList' },
  { methodName: 'ScaRuleQueryDetail', api: 'scaRuleQueryDetail', httpMethod: 'GET', path: '/v1/sca/rule/query/detail/*' },
  { methodName: 'ScaEventBaseLevel', api: 'scaEventBaseLevel', httpMethod: 'POST', path: '/v1/sca/event/baseLevel/*/*' },
  { methodName: 'ScaEventSecondLevel', api: 'scaEventSecondLevel', httpMethod: 'POST', path: '/v1/sca/event/secondLevel/*/*' },
  { methodName: 'ScaEventThirdLevel', api: 'scaEventThirdLevel', httpMethod: 'POST', path: '/v1/sca/event/thirdLevel/*/*' },
  { methodName: 'ScaEventHost', api: 'scaEventHost', httpMethod: 'POST', path: '/v1/sca/event/host/*/*' },
  { methodName: 'ScaEventCheckDetail', api: 'scaEventCheckDetail', httpMethod: 'GET', path: '/v1/sca/event/checkDetail/*' },
  { methodName: 'GetVulnerabilityList', api: 'getVulnerabilityList', httpMethod: 'POST', path: '/v1/announcement/list' },
  { methodName: 'VulnerabilityInfo', api: 'vulnerabilityInfo', httpMethod: 'GET', path: '/v1/vulnerability/info' },
  { methodName: 'VulnerabilityDetails', api: 'vulnerabilityDetails', httpMethod: 'POST', path: '/v1/announcement/detail' },
  { methodName: 'AnnouncementVulTypeCount', api: 'announcementVulTypeCount', httpMethod: 'GET', path: '/v1/announcement/vulTypeCount' },
  { methodName: 'GetVulStatistics', api: 'getVulStatistics', httpMethod: 'POST', path: '/v1/vulnerability/statics' },
  { methodName: 'VulnerabilityAffectedServers', api: 'vulnerabilityAffectedServers', httpMethod: 'POST', path: '/v1/vulnerability/affectedServers' },
  { methodName: 'GetVulScanResult', api: 'getVulScanResult', httpMethod: 'POST', path: '/v1/vulnerability/show' },
  { methodName: 'GetLastScanStatics', api: 'getLastScanStatics', httpMethod: 'GET', path: '/v1/vulnerability/lastScan' },
  { methodName: 'GetLastScanDetail', api: 'getLastScanDetail', httpMethod: 'POST', path: '/v1/vulnerability/lastDetail' },
  { methodName: 'GetLastScanDetailList', api: 'getLastScanDetailList', httpMethod: 'POST', path: '/v1/vulnerability/lastDetail/list' },
  { methodName: 'GetWeakPwByPage', api: 'getWeakPwByPage', httpMethod: 'POST', path: '/v1/weakpw/list' },
  { methodName: 'WeakPwCheck', api: 'weakPwCheck', httpMethod: 'GET', path: '/v1/weakpw/statics' },
  { methodName: 'GetWeakPwList', api: 'getWeakPwList', httpMethod: 'POST', path: '/v1/weakpw/group' },
  { methodName: 'GetWeakScanConf', api: 'getWeakScanConf', httpMethod: 'GET', path: '/v1/weakpw/conf' },
  { methodName: 'GetWeakPwScanResult', api: 'getWeakPwScanResult', httpMethod: 'POST', path: '/v1/weakpw/show' },
  { methodName: 'V1instrusioneventlist', api: 'v1instrusioneventlist', httpMethod: 'POST', path: '/v1/instrusion/event/list' },
  { methodName: 'InstrusionEventDetail', api: 'instrusionEventDetail', httpMethod: 'POST', path: '/v1/instrusion/event/detail' },
  { methodName: 'V1instrusioneventstatistics', api: 'v1instrusioneventstatistics', httpMethod: 'POST', path: '/v1/instrusion/event/statistics' },
  { methodName: 'V1instrusioneventTypestatistics', api: 'v1instrusioneventTypestatistics', httpMethod: 'POST', path: '/v1/instrusion/eventType/statistics' },
  { methodName: 'InstrusionAttckStatistics', api: 'InstrusionAttckStatistics', httpMethod: 'POST', path: '/v1/instrusion/attck/statistics' },
  { methodName: 'InstrusionWhitelistAllList', api: 'instrusionWhitelistAllList', httpMethod: 'POST', path: '/v1/instrusion/whitelist/allList' },
  { methodName: 'FileQuarantineList', api: 'fileQuarantineList', httpMethod: 'POST', path: '/v1/fileQuarantine/list' },
  { methodName: 'IpBlockQueryList', api: 'IpBlockQueryList', httpMethod: 'POST', path: '/v1/ipBlock/queryList' },
  { methodName: 'TamperproofConfigQuery', api: 'tamperproofConfigQuery', httpMethod: 'POST', path: '/v1/tamperProof/config/*/*' },
  { methodName: 'TamperProofAlarmLogAlarmList', api: 'tamperProofAlarmLogAlarmList', httpMethod: 'POST', path: '/v1/tamperProof/alarmLog/alarmList' },
  { methodName: 'TamperproofStatistics', api: 'tamperproofStatistics', httpMethod: 'GET', path: '/v1/tamperProof/statistics' },
  { methodName: 'TamperproofFileDistribution', api: 'tamperproofFileDistribution', httpMethod: 'GET', path: '/v1/tamperProof/fileDistribution' },
  { methodName: 'TamperproofFileChange', api: 'tamperproofFileChange', httpMethod: 'GET', path: '/v1/tamperProof/fileChange' },
  { methodName: 'TamperproofProtectionDynamic', api: 'tamperproofProtectionDynamic', httpMethod: 'GET', path: '/v1/tamperProof/protectionDynamic' },
  { methodName: 'GetVirusStatics', api: 'getVirusStatics', httpMethod: 'POST', path: '/v1/virus/statics' },
  { methodName: 'GetVirusByPage', api: 'getVirusByPage', httpMethod: 'POST', path: '/v1/virus/list' },
  { methodName: 'VirusDetail', api: 'virusDetail', httpMethod: 'POST', path: '/v1/virus/detail' },
  { methodName: 'VirusQueryVirusAndRealTimeConf', api: 'virusQueryVirusAndRealTimeConf', httpMethod: 'GET', path: '/v1/virus/query/virusAndRealTimeConf' },
  { methodName: 'GetVirusResult', api: 'getVirusResult', httpMethod: 'POST', path: '/v1/virus/show' },
  { methodName: 'VirusLastScan', api: 'virusLastScan', httpMethod: 'GET', path: '/v1/virus/lastScan' },
  { methodName: 'VirusLastScanDetail', api: 'virusLastScanDetail', httpMethod: 'GET', path: '/v1/virus/lastDetail' },
  { methodName: 'VirusLastScanDetailList', api: 'virusLastScanDetailList', httpMethod: 'POST', path: '/v1/virus/lastDetail/list' },
  { methodName: 'IntegrityProtectionConfigList', api: 'integrityProtectionConfigList', httpMethod: 'GET', path: '/v1/integrityProtection/config/list' },
  { methodName: 'ApiIntegrityProtectionStatistics', api: 'apiIntegrityProtectionStatistics', httpMethod: 'GET', path: '/v1/integrityProtection/statistics' },
  { methodName: 'ApiIntegrityProtectionFileChangeList', api: 'apiIntegrityProtectionFileChangeList', httpMethod: 'POST', path: '/v1/integrityProtection/fileChange/list' },
  { methodName: 'ApiIntegrityProtectionChangeStatistics', api: 'apiIntegrityProtectionChangeStatistics', httpMethod: 'POST', path: '/v1/integrityProtection/changeStatistics' },
  { methodName: 'SafetyReportEventList', api: 'safetyReportEventList', httpMethod: 'POST', path: '/v1/safetyReport/event/list' },
  { methodName: 'SafetyReportConfigUserConfList', api: 'safetyReportConfigUserConfList', httpMethod: 'GET', path: '/v1/safetyReport/config/userConfList' },
  { methodName: 'ApiSafetyReportEventStatistics', api: 'apiSafetyReportEventStatistics', httpMethod: 'POST', path: '/v1/safetyReport/event/statistics' },
  { methodName: 'GetSyncUser', api: 'getSyncUser', httpMethod: 'GET', path: '/v1/sync/my' },
  { methodName: 'SecurityDataQueryTask', api: 'securityDataQueryTask', httpMethod: 'POST', path: '/v1/security/data/queryTask' },
  { methodName: 'SelectCountry', api: 'selectCountry', httpMethod: 'POST', path: '/v1/area/country' },
  { methodName: 'SelectProvince', api: 'selectProvince', httpMethod: 'POST', path: '/v1/area/province/*' },
  { methodName: 'SelectCity', api: 'selectCity', httpMethod: 'POST', path: '/v1/area/city/*' },
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
  if (!accessKeyId) throw errorWithCode('FAILED_PRECONDITION', 'secret "accessKeyId" or "ak" is required but not configured');
  if (!secretAccessKey) throw errorWithCode('FAILED_PRECONDITION', 'secret "secretAccessKey" or "sk" is required but not configured');

  return {
    accessKeyId,
    secretAccessKey,
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
  if (!spec) throw errorWithCode('INVALID_ARGUMENT', `unsupported or non-read-only CTYun Server Security Guard api "${apiName}"`);
  return spec;
};

const payloadFromRequest = (req = {}) => normalizeStruct(req.payload ?? {});

const pathParamsFromPayload = (payload = {}) => {
  const raw = firstDefined(payload.pathParams, payload.path_params);
  if (raw === undefined) return [];
  if (Array.isArray(raw)) return raw;
  return [raw];
};

const fillPathParams = (path, payload = {}) => {
  const params = pathParamsFromPayload(payload);
  let index = 0;
  const filledPath = path.replace(/\*/g, () => {
    if (index >= params.length) throw errorWithCode('INVALID_ARGUMENT', `api path "${path}" requires ${index + 1} pathParams value(s)`);
    const value = params[index];
    index += 1;
    const text = toTrimmedString(value);
    if (!text) throw errorWithCode('INVALID_ARGUMENT', `pathParams[${index - 1}] must be non-empty`);
    return uriEscape(text);
  });
  const rest = { ...payload };
  delete rest.pathParams;
  delete rest.path_params;
  return { path: filledPath, payload: rest };
};

const splitPayloadForMethod = (spec, payload = {}) => {
  const { path, payload: requestPayload } = fillPathParams(spec.path, payload);
  if (spec.httpMethod === 'GET') return { path, query: requestPayload, bodyText: '' };
  return { path, query: {}, bodyText: JSON.stringify(requestPayload ?? {}) };
};

const buildUrl = (endpoint, path, query) => {
  const url = endpointFor(endpoint);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/');
  url.search = queryParamsToString(query);
  return url;
};

const buildHeaders = (ctx, signedHeaders) => ({
  ...(ctx.bindings?.headers && typeof ctx.bindings.headers === 'object' ? ctx.bindings.headers : {}),
  'Content-Type': 'application/json',
  ...signedHeaders,
});

const parseJsonResponse = async (res) => {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', `CTYun Server Security Guard API returned non-JSON response: ${text.slice(0, 200)}`);
  }
};

const errorFromCtyunBody = (body) => {
  const statusCode = body?.statusCode ?? body?.code;
  const errorCode = body?.error || body?.errorCode || body?.code;
  const message = body?.errorMessage || body?.message || 'CTYun Server Security Guard API returned an error';
  const successError = errorCode === undefined || String(errorCode) === 'CTCSSCN_000000';
  const successStatus = statusCode === undefined || ['200', '100000'].includes(String(statusCode));
  if (successError && successStatus) return null;
  const text = `${errorCode || statusCode}: ${message}`;
  if (/CTCSSCN_000004|Auth|Unauthorized|Forbidden|Denied|Signature|AK|SK|Token|Permission/i.test(text)) return errorWithCode('PERMISSION_DENIED', text);
  if (/CTCSSCN_000003|CTCSSCN_000005|quota|协议|配额|未签署|未购买/i.test(text)) return errorWithCode('FAILED_PRECONDITION', text);
  if (/Invalid|Missing|Parameter|Param|NotFound|Unsupported/i.test(text)) return errorWithCode('INVALID_ARGUMENT', text);
  return errorWithCode('UNKNOWN', text);
};

const invokeCtyun = async (spec, payload, ctx = {}) => {
  const apiSpec = validateApiSpec(spec.api);
  const callCtx = resolveCallContext(ctx);
  const bindings = validateBindings(callCtx.bindings);
  const { path, query, bodyText } = splitPayloadForMethod(apiSpec, payload);
  const url = buildUrl(bindings.endpoint, path, query);
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
      headers: buildHeaders(callCtx, signed.headers),
      body: apiSpec.httpMethod === 'GET' ? undefined : bodyText,
      signal: controller.signal,
    });
    body = await parseJsonResponse(res);
  } catch (err) {
    if (err.legacyCode) throw err;
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      throw errorWithCode('DEADLINE_EXCEEDED', `CTYun Server Security Guard API request timed out after ${timeoutMs}ms`);
    }
    throw errorWithCode('UNAVAILABLE', `failed to call CTYun Server Security Guard API: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }
  if (res.status >= 500) {
    throw errorWithCode('UNAVAILABLE', `CTYun Server Security Guard API HTTP ${res.status}: ${JSON.stringify(body).slice(0, 500)}`);
  }
  const ctyunError = errorFromCtyunBody(body);
  if (ctyunError) throw ctyunError;
  if (res.status < 200 || res.status >= 300) {
    const code = res.status === 401 || res.status === 403 ? 'PERMISSION_DENIED' : 'UNAVAILABLE';
    throw errorWithCode(code, `CTYun Server Security Guard API HTTP ${res.status}: ${JSON.stringify(body).slice(0, 500)}`);
  }
  return { response: toValue(body) };
};

const buildApiHandler = (spec) => async (req = {}, ctx = {}) => invokeCtyun(spec, payloadFromRequest(req), ctx);

export const handlers = Object.fromEntries([
  ...READ_ONLY_APIS.map((entry) => [`${SERVICE_PACKAGE}/${entry.methodName}`, buildApiHandler(entry)]),
  [METHOD_INVOKE_READ_ONLY_API_FULL, async (req = {}, ctx = {}) => invokeCtyun(validateApiSpec(req.api), normalizeStruct(req.payload ?? {}), ctx)],
]);

export const rpcdef = () => Object.fromEntries([
  ...READ_ONLY_APIS.map((entry) => [`/${SERVICE_PACKAGE}/${entry.methodName}`, handlers[`${SERVICE_PACKAGE}/${entry.methodName}`]]),
  [METHOD_INVOKE_READ_ONLY_API_PATH, handlers[METHOD_INVOKE_READ_ONLY_API_FULL]],
]);

export const _test = {
  API_BY_NAME,
  eopDateFromDate,
  fillPathParams,
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
