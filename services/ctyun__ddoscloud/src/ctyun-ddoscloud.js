import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const SERVICE_PACKAGE = 'CTYun_DDoSCloud.CTYun_DDoSCloud';
export const DEFAULT_ENDPOINT = 'https://ddoscloud-global.ctapi.ctyun.cn';
export const DEFAULT_TIMEOUT_MS = 5000;

export const READ_ONLY_APIS = [
  { methodName: 'DomainQuery', api: 'domainQuery', httpMethod: 'GET', path: '/ctapi/v2/domain/query' },
  { methodName: 'TopDomain', api: 'topDomain', httpMethod: 'POST', path: '/ctapi/v1/sevice_detail' },
  { methodName: 'DomainConfig', api: 'domainConfig', httpMethod: 'POST', path: '/ctapi/v1/domain/config' },
  { methodName: 'DomainStatusQuery', api: 'domainStatusQuery', httpMethod: 'POST', path: '/ctapi/v1/domain/status/query' },
  { methodName: 'GetCcAttackAddr', api: 'getCcAttackAddr', httpMethod: 'POST', path: '/ctapi/v1/ccAttack/getCcAttackAddr' },
  { methodName: 'GetCcAttackEvent', api: 'getCcAttackEvent', httpMethod: 'POST', path: '/ctapi/v1/ccAttack/getEvent' },
  { methodName: 'GetCcAttackInfo', api: 'getCcAttackInfo', httpMethod: 'POST', path: '/ctapi/v1/ccAttack/getInfo' },
  { methodName: 'GetCcConfInfo', api: 'getCcConfInfo', httpMethod: 'POST', path: '/ctapi/v1/ccConf/getCcConfInfo' },
  { methodName: 'GetAccessControlInfo', api: 'getAccessControlInfo', httpMethod: 'POST', path: '/ctapi/v1/accessControlConf/getAccessControlInfo' },
  { methodName: 'GetFrequencyControlnfo', api: 'getFrequencyControlnfo', httpMethod: 'POST', path: '/ctapi/v1/frequencyControlConf/getFrequencyControlnfo' },
  { methodName: 'GetDdosAttackTrend', api: 'getDdosAttackTrend', httpMethod: 'POST', path: '/ctapi/v1/ddosAttack/getAttackTrend' },
  { methodName: 'GetDdosAttackEvent', api: 'getDdosAttackEvent', httpMethod: 'POST', path: '/ctapi/v1/ddosAttack/getEvent' },
  { methodName: 'GetDdosAttackInfo', api: 'getDdosAttackInfo', httpMethod: 'POST', path: '/ctapi/v1/ddosAttack/getInfo' },
  { methodName: 'GetPortCnameList', api: 'getPortCnameList', httpMethod: 'POST', path: '/ctapi/v1/portManage/getCnameList' },
  { methodName: 'GetPortList', api: 'getPortList', httpMethod: 'POST', path: '/ctapi/v1/portManage/getPortList' },
  { methodName: 'CertExpireCount', api: 'certExpireCount', httpMethod: 'GET', path: '/ctapi/v1/cert/expire_count' },
  { methodName: 'CertList', api: 'certList', httpMethod: 'GET', path: '/ctapi/v1/cert/list' },
  { methodName: 'CertQuery', api: 'certQuery', httpMethod: 'GET', path: '/ctapi/v1/cert/query' },
  { methodName: 'QueryOperationalLog', api: 'queryOperationalLog', httpMethod: 'POST', path: '/ctapi/v1/operationalLog/queryLog' },
  { methodName: 'LogBsstimeFiles', api: 'logBsstimeFiles', httpMethod: 'GET', path: '/ctapi/v1/log_bsstime_files' },
  { methodName: 'StatisticsanalysisQueryBandwidth', api: 'statisticsanalysisQueryBandwidth', httpMethod: 'POST', path: '/ctapi/v2/statisticsanalysis/query_bandwidth_data' },
  { methodName: 'StatisticsanalysisQueryHitFlowRateDataByDomain', api: 'statisticsanalysisQueryHitFlowRateDataByDomain', httpMethod: 'POST', path: '/ctapi/v2/statisticsanalysis/query_hit_flow_rate_data_by_domain' },
  { methodName: 'StatisticsanalysisQueryHttpStatusCodeData', api: 'statisticsanalysisQueryHttpStatusCodeData', httpMethod: 'POST', path: '/ctapi/v2/statisticsanalysis/query_http_status_code_data' },
  { methodName: 'StatisticsanalysisQueryPeakBandwidthData', api: 'statisticsanalysisQueryPeakBandwidthData', httpMethod: 'POST', path: '/ctapi/v2/statisticsanalysis/query_peak_bandwidth_data' },
  { methodName: 'StatisticsanalysisQueryQpsData', api: 'statisticsanalysisQueryQpsData', httpMethod: 'POST', path: '/ctapi/v2/statisticsanalysis/query_qps_data' },
  { methodName: 'StatisticsanalysisQueryRequestNumData', api: 'statisticsanalysisQueryRequestNumData', httpMethod: 'POST', path: '/ctapi/v2/statisticsanalysis/query_request_num_data' },
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
  if (!spec) throw errorWithCode('INVALID_ARGUMENT', `unsupported or non-read-only CTYun DDoS Cloud api "${apiName}"`);
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
    throw errorWithCode('UNKNOWN', `CTYun DDoS Cloud API returned non-JSON response: ${text.slice(0, 200)}`);
  }
};

const errorFromCtyunBody = (body) => {
  const statusCode = body?.statusCode ?? body?.code;
  const errorCode = body?.error || body?.errorCode || body?.code;
  const message = body?.errorMessage || body?.message || 'CTYun DDoS Cloud API returned an error';
  if (statusCode === undefined && !body?.error && !body?.errorCode) return null;
  if (String(statusCode) === '100000') return null;
  const text = `${errorCode || statusCode}: ${message}`;
  if (/Auth|Unauthorized|Forbidden|Denied|Signature|AK|SK|Token|Permission/i.test(text)) return errorWithCode('PERMISSION_DENIED', text);
  if (/Invalid|Missing|Parameter|Param|NotFound|Unsupported|CDN_200002|CDN_SEC_200001/i.test(text)) return errorWithCode('INVALID_ARGUMENT', text);
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
      headers: buildHeaders(callCtx, signed.headers),
      body: apiSpec.httpMethod === 'GET' ? undefined : bodyText,
      signal: controller.signal,
    });
    body = await parseJsonResponse(res);
  } catch (err) {
    if (err.legacyCode) throw err;
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      throw errorWithCode('DEADLINE_EXCEEDED', `CTYun DDoS Cloud API request timed out after ${timeoutMs}ms`);
    }
    throw errorWithCode('UNAVAILABLE', `failed to call CTYun DDoS Cloud API: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }
  if (res.status >= 500) {
    throw errorWithCode('UNAVAILABLE', `CTYun DDoS Cloud API HTTP ${res.status}: ${JSON.stringify(body).slice(0, 500)}`);
  }
  const ctyunError = errorFromCtyunBody(body);
  if (ctyunError) throw ctyunError;
  if (res.status < 200 || res.status >= 300) {
    const code = res.status === 401 || res.status === 403 ? 'PERMISSION_DENIED' : 'UNAVAILABLE';
    throw errorWithCode(code, `CTYun DDoS Cloud API HTTP ${res.status}: ${JSON.stringify(body).slice(0, 500)}`);
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
