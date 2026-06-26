import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const METHOD_DESCRIBE_ASSET_OVERVIEW = 'Tencent_DSGC.TencentDsgcService/DescribeAssetOverview';
export const METHOD_LIST_DSPA_CLUSTERS = 'Tencent_DSGC.TencentDsgcService/ListDSPAClusters';
export const METHOD_DESCRIBE_DSPA_COS_DATA_ASSET_BUCKETS = 'Tencent_DSGC.TencentDsgcService/DescribeDSPACOSDataAssetBuckets';
export const METHOD_DESCRIBE_DSPA_RDB_DATA_ASSET_BY_COMPLIANCE_ID = 'Tencent_DSGC.TencentDsgcService/DescribeDSPARDBDataAssetByComplianceId';
export const METHOD_DESCRIBE_DSPA_ES_DATA_ASSET_BY_COMPLIANCE_ID = 'Tencent_DSGC.TencentDsgcService/DescribeDSPAESDataAssetByComplianceId';
export const METHOD_DESCRIBE_DSPA_ASSESSMENT_LATEST_RISK_LIST = 'Tencent_DSGC.TencentDsgcService/DescribeDSPAAssessmentLatestRiskList';
export const METHOD_DESCRIBE_DSPA_ASSESSMENT_TASKS = 'Tencent_DSGC.TencentDsgcService/DescribeDSPAAssessmentTasks';
export const METHOD_DESCRIBE_REPORT_TASKS = 'Tencent_DSGC.TencentDsgcService/DescribeReportTasks';
export const METHOD_INVOKE_READ_ONLY_ACTION = 'Tencent_DSGC.TencentDsgcService/InvokeReadOnlyAction';

export const DEFAULT_ENDPOINT = 'https://dsgc.tencentcloudapi.com';
export const DEFAULT_REGION = 'ap-guangzhou';
export const DEFAULT_VERSION = '2019-07-23';
export const DEFAULT_TIMEOUT_MS = 5000;
export const SERVICE = 'dsgc';
export const ALGORITHM = 'TC3-HMAC-SHA256';

const FIXED_ACTIONS = new Set([
  'DescribeAssetOverview',
  'DescribeBindDBList',
  'DescribeCOSAssetSensitiveDistribution',
  'DescribeDSPAAssessmentHighRiskTop10Overview',
  'DescribeDSPAAssessmentLatestRiskDetailInfo',
  'DescribeDSPAAssessmentLatestRiskList',
  'DescribeDSPAAssessmentNewDiscoveredRiskOverview',
  'DescribeDSPAAssessmentPendingRiskOverview',
  'DescribeDSPAAssessmentProcessingRiskOverview',
  'DescribeDSPAAssessmentRiskAmountOverview',
  'DescribeDSPAAssessmentRiskDatasourceTop5',
  'DescribeDSPAAssessmentRiskDealedOverview',
  'DescribeDSPAAssessmentRiskDealedTrend',
  'DescribeDSPAAssessmentRiskDistributionOverview',
  'DescribeDSPAAssessmentRiskItemTop5',
  'DescribeDSPAAssessmentRiskLevelDetail',
  'DescribeDSPAAssessmentRiskLevelList',
  'DescribeDSPAAssessmentRiskLevelTrend',
  'DescribeDSPAAssessmentRiskOverview',
  'DescribeDSPAAssessmentRiskProcessHistory',
  'DescribeDSPAAssessmentRisks',
  'DescribeDSPAAssessmentRiskSideDistributed',
  'DescribeDSPAAssessmentRiskSideList',
  'DescribeDSPAAssessmentRiskTemplateDetail',
  'DescribeDSPAAssessmentRiskTemplateVulnerableList',
  'DescribeDSPAAssessmentTasks',
  'DescribeDSPAAssessmentTemplateControlItems',
  'DescribeDSPAAssessmentTemplates',
  'DescribeDSPACategories',
  'DescribeDSPACategoryRules',
  'DescribeDSPACategoryRuleStatistic',
  'DescribeDSPACategoryTree',
  'DescribeDSPACategoryTreeWithRules',
  'DescribeDSPAComplianceGroupDetail',
  'DescribeDSPAComplianceGroups',
  'DescribeDSPAComplianceUpdateNotification',
  'DescribeDSPACOSDataAssetBuckets',
  'DescribeDSPACOSDataAssetByComplianceId',
  'DescribeDSPACOSDataAssetDetail',
  'DescribeDSPACOSDiscoveryTaskDetail',
  'DescribeDSPACOSDiscoveryTaskFiles',
  'DescribeDSPACOSDiscoveryTaskResult',
  'DescribeDSPACOSDiscoveryTasks',
  'DescribeDSPACOSTaskResultDetail',
  'DescribeDSPADataSourceDbInfo',
  'DescribeDSPADiscoveryRules',
  'DescribeDSPADiscoveryServiceStatus',
  'DescribeDSPADiscoveryTaskDetail',
  'DescribeDSPADiscoveryTaskResult',
  'DescribeDSPADiscoveryTaskResultDetail',
  'DescribeDSPADiscoveryTasks',
  'DescribeDSPADiscoveryTaskTables',
  'DescribeDSPAESDataAssetByComplianceId',
  'DescribeDSPAESDataAssetDetail',
  'DescribeDSPAESDataSample',
  'DescribeDSPAESDiscoveryTaskResultDetail',
  'DescribeDSPALevelDetail',
  'DescribeDSPALevelGroups',
  'DescribeDSPARDBDataAssetByComplianceId',
  'DescribeDSPARDBDataAssetDetail',
  'DescribeDSPASupportedMetas',
  'DescribeDSPATaskResultDataSample',
  'DescribeESAssetSensitiveDistribution',
  'DescribeMongoAssetSensitiveDistribution',
  'DescribeRDBAssetSensitiveDistribution',
  'DescribeReportTasks',
  'DescribeSensitiveCOSDataDistribution',
  'DescribeSensitiveRDBDataDistribution',
  'GetResourceConnectionStatus',
  'ListDSPAClusters',
  'ListDSPACosMetaResources',
  'ListDSPAMetaResources',
]);
const READ_ONLY_PREFIXES = ['Describe', 'List', 'Get'];

const LIST_KEYS_BY_ACTION = {
  ListDSPAClusters: ['Items', 'InstanceList', 'List', 'Clusters', 'DSPAClusters'],
  DescribeDSPACOSDataAssetBuckets: ['Items', 'AssetList', 'BucketList', 'Buckets', 'List'],
  DescribeDSPARDBDataAssetByComplianceId: ['Items', 'AssetList', 'RDBList', 'DBList', 'List'],
  DescribeDSPAESDataAssetByComplianceId: ['Items', 'AssetList', 'ESList', 'List'],
  DescribeDSPAAssessmentLatestRiskList: ['Items', 'RiskList', 'LatestRiskList', 'List'],
  DescribeDSPAAssessmentTasks: ['Items', 'TaskList', 'Tasks', 'List'],
  DescribeReportTasks: ['Items', 'TaskList', 'Tasks', 'List'],
};

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

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const asString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

const asOptionalString = (value) => {
  const str = asString(value);
  return str === '' ? undefined : str;
};

const asBool = (value) => {
  const raw = unwrapScalar(value);
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw !== 0;
  if (typeof raw === 'string') {
    const text = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'n', 'off', ''].includes(text)) return false;
  }
  return false;
};

const asPositiveInt = (value, field, optional = true) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') {
    if (optional) return undefined;
    throw errorWithCode('INVALID_ARGUMENT', `${field} is required`);
  }
  const num = Number(raw);
  if (!Number.isInteger(num) || Number.isNaN(num) || num < 0) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} must be a non-negative integer`);
  }
  return num;
};

const fromProtoValue = (value) => {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'object') return value;
  if (hasOwn(value, 'stringValue')) return value.stringValue;
  if (hasOwn(value, 'numberValue')) return value.numberValue;
  if (hasOwn(value, 'boolValue')) return value.boolValue;
  if (hasOwn(value, 'nullValue')) return null;
  if (hasOwn(value, 'listValue')) return (value.listValue?.values ?? []).map(fromProtoValue);
  if (hasOwn(value, 'structValue')) return fromProtoStruct(value.structValue);
  if (hasOwn(value, 'fields')) return fromProtoStruct(value);
  if (hasOwn(value, 'value')) return fromProtoValue(value.value);
  if (Array.isArray(value)) return value.map(fromProtoValue);
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, fromProtoValue(inner)]));
};

const fromProtoStruct = (value) => {
  if (!value || typeof value !== 'object') return {};
  if (!hasOwn(value, 'fields')) return fromProtoValue(value) ?? {};
  return Object.fromEntries(Object.entries(value.fields ?? {}).map(([key, inner]) => [key, fromProtoValue(inner)]));
};

const toPlain = (value) => {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.map((item) => toPlain(item));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toPlain(item)]));
  }
  return value;
};

const jsonStruct = (value) => toPlain(value);

const normalizeEndpoint = (value) => {
  const endpoint = asString(value || DEFAULT_ENDPOINT).replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(endpoint)) return '';
  return endpoint;
};

const parseHeaders = (value) => {
  if (value === undefined || value === null || value === '') return {};
  const raw = unwrapScalar(value);
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return Object.fromEntries(Object.entries(raw).map(([key, inner]) => [key, String(unwrapScalar(inner) ?? '')]));
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parseHeaders(parsed);
    } catch {
      return {};
    }
  }
  return {};
};

const parseStringList = (value) => {
  const raw = unwrapScalar(value);
  if (Array.isArray(raw)) return raw.map(asString).filter(Boolean);
  if (typeof raw === 'string') return raw.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
};

const assertSupportedTlsConfig = (bindings = {}) => {
  if (asBool(bindings.skipTlsVerify) || asBool(bindings.tlsInsecureSkipVerify) || asBool(bindings.insecureSkipVerify)) {
    throw errorWithCode('INVALID_ARGUMENT', 'TLS certificate verification bypass is not supported by this Node.js fetch adapter');
  }
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx.config ?? {}),
  ...(ctx.secret ?? {}),
  ...(ctx.bindings ?? {}),
});

const resolveRuntime = (ctx = {}) => {
  const bindings = mergedBindings(ctx);
  assertSupportedTlsConfig(bindings);
  const endpoint = normalizeEndpoint(firstDefined(bindings.endpoint, bindings.host, bindings.baseUrl, DEFAULT_ENDPOINT));
  if (!endpoint) throw errorWithCode('INVALID_ARGUMENT', 'endpoint/host must include http or https');
  const secretId = asOptionalString(firstDefined(bindings.secretId, bindings.secret_id));
  const secretKey = asOptionalString(firstDefined(bindings.secretKey, bindings.secret_key));
  if (!secretId) throw errorWithCode('INVALID_ARGUMENT', 'secretId is required in secret');
  if (!secretKey) throw errorWithCode('INVALID_ARGUMENT', 'secretKey is required in secret');
  return {
    endpoint,
    secretId,
    secretKey,
    token: asOptionalString(bindings.token),
    region: asOptionalString(bindings.region) ?? DEFAULT_REGION,
    version: asOptionalString(bindings.version) ?? DEFAULT_VERSION,
    language: asOptionalString(bindings.language),
    timeoutMs: asPositiveInt(firstDefined(bindings.timeoutMs, ctx.limits?.timeoutMs, DEFAULT_TIMEOUT_MS), 'timeoutMs', false),
    headers: parseHeaders(bindings.headers),
    allowActions: parseStringList(bindings.allowActions),
    allowAllReadOnlyActions: asBool(firstDefined(bindings.allowAllReadOnlyActions, bindings.allowAllDescribeActions)),
  };
};

const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const hmac = (key, text, encoding) => crypto.createHmac('sha256', key).update(text, 'utf8').digest(encoding);

const utcDate = (timestamp) => new Date(timestamp * 1000).toISOString().slice(0, 10);

const buildCanonicalRequest = (host, payload) => [
  'POST',
  '/',
  '',
  'content-type:application/json; charset=utf-8',
  `host:${host}`,
  '',
  'content-type;host',
  sha256Hex(payload),
].join('\n');

const buildAuthorization = ({ secretId, secretKey, host, payload, timestamp }) => {
  const date = utcDate(timestamp);
  const credentialScope = `${date}/${SERVICE}/tc3_request`;
  const canonicalRequest = buildCanonicalRequest(host, payload);
  const stringToSign = [
    ALGORITHM,
    String(timestamp),
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const secretDate = hmac(`TC3${secretKey}`, date);
  const secretService = hmac(secretDate, SERVICE);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = hmac(secretSigning, stringToSign, 'hex');
  return {
    authorization: `${ALGORITHM} Credential=${secretId}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`,
    canonicalRequest,
    stringToSign,
    signature,
  };
};


const mergeRequestParams = (req = {}) => {
  const params = fromProtoStruct(req.params ?? {});
  const offset = asPositiveInt(req.offset, 'offset');
  const limit = asPositiveInt(req.limit, 'limit');
  if (offset !== undefined && !hasOwn(params, 'Offset')) params.Offset = offset;
  if (limit !== undefined && !hasOwn(params, 'Limit')) params.Limit = limit;
  return params;
};

const mapTencentError = (error = {}) => {
  const code = asString(error.Code);
  const message = asString(error.Message || code || 'Tencent Cloud API error');
  if (code.startsWith('AuthFailure') || code === 'UnauthorizedOperation') {
    throw errorWithCode('UNAUTHENTICATED', `${code}: ${message}`);
  }
  if (code === 'UnsupportedOperation' || code.startsWith('ResourceUnavailable')) {
    throw errorWithCode('FAILED_PRECONDITION', `${code}: ${message}`);
  }
  if (code.startsWith('InvalidParameter') || code === 'MissingParameter') {
    throw errorWithCode('INVALID_ARGUMENT', `${code}: ${message}`);
  }
  if (code.startsWith('LimitExceeded') || code === 'RequestLimitExceeded') {
    throw errorWithCode('UNAVAILABLE', `${code}: ${message}`);
  }
  throw errorWithCode('UNKNOWN', `${code}: ${message}`);
};

const requestTencentCloud = async (runtime, action, params, { timestamp = Math.floor(Date.now() / 1000) } = {}) => {
  const endpoint = new URL(runtime.endpoint);
  const payload = JSON.stringify(params ?? {});
  const signed = buildAuthorization({
    secretId: runtime.secretId,
    secretKey: runtime.secretKey,
    host: endpoint.host,
    payload,
    timestamp,
  });
  const headers = {
    ...runtime.headers,
    Authorization: signed.authorization,
    'Content-Type': 'application/json; charset=utf-8',
    Host: endpoint.host,
    'X-TC-Action': action,
    'X-TC-Version': runtime.version,
    'X-TC-Timestamp': String(timestamp),
  };
  if (runtime.region) headers['X-TC-Region'] = runtime.region;
  if (runtime.token) headers['X-TC-Token'] = runtime.token;
  if (runtime.language) headers['X-TC-Language'] = runtime.language;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), runtime.timeoutMs);
  try {
    const response = await fetch(runtime.endpoint, {
      method: 'POST',
      headers,
      body: payload,
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw errorWithCode('UNAUTHENTICATED', `upstream http ${response.status}: ${text}`);
      }
      throw errorWithCode('UNAVAILABLE', `upstream http ${response.status}: ${text}`);
    }
    let json;
    try {
      json = text.trim() ? JSON.parse(text) : {};
    } catch {
      throw errorWithCode('UNKNOWN', 'response is not valid JSON');
    }
    if (json?.Response?.Error) mapTencentError(json.Response.Error);
    return json;
  } catch (error) {
    if (error.legacyCode) throw error;
    if (error.name === 'AbortError') throw errorWithCode('DEADLINE_EXCEEDED', `upstream timeout after ${runtime.timeoutMs}ms`);
    throw errorWithCode('UNAVAILABLE', error.message);
  } finally {
    clearTimeout(timeout);
  }
};

const normalizeAction = (value) => {
  const action = asString(value);
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(action)) {
    throw errorWithCode('INVALID_ARGUMENT', 'action must be an API action name');
  }
  return action;
};

const ensureReadOnlyActionAllowed = (runtime, action) => {
  if (!READ_ONLY_PREFIXES.some((prefix) => action.startsWith(prefix))) {
    throw errorWithCode('INVALID_ARGUMENT', 'InvokeReadOnlyAction only allows Describe*, List*, or Get* actions');
  }
  if (FIXED_ACTIONS.has(action) || runtime.allowActions.includes(action) || runtime.allowAllReadOnlyActions) return;
  throw errorWithCode('PERMISSION_DENIED', `${action} is not allowed; add it to allowActions or use a dedicated method`);
};

const extractItems = (action, response = {}) => {
  const keys = LIST_KEYS_BY_ACTION[action] ?? [];
  for (const key of keys) {
    if (Array.isArray(response[key])) return response[key];
  }
  for (const [key, value] of Object.entries(response)) {
    if (!['RequestId', 'Error'].includes(key) && Array.isArray(value)) return value;
  }
  return [];
};

const extractTotalCount = (response = {}, items = []) => {
  const raw = firstDefined(response.TotalCount, response.Total, response.Count, response.TotalNum);
  const num = Number(raw);
  return Number.isFinite(num) ? Math.trunc(num) : items.length;
};

const actionResponse = (action, json) => {
  const response = json.Response ?? {};
  return {
    action,
    request_id: asString(response.RequestId),
    response: jsonStruct(response),
    raw: jsonStruct(json),
  };
};

const listResponse = (action, json) => {
  const response = json.Response ?? {};
  const items = extractItems(action, response);
  return {
    action,
    request_id: asString(response.RequestId),
    total_count: extractTotalCount(response, items),
    items: items.map(jsonStruct),
    response: jsonStruct(response),
    raw: jsonStruct(json),
  };
};

const callAction = (action, { list = false } = {}) => async (req, ctx) => {
  const runtime = resolveRuntime(ctx);
  const params = mergeRequestParams(req);
  const json = await requestTencentCloud(runtime, action, params);
  return list ? listResponse(action, json) : actionResponse(action, json);
};

const invokeReadOnlyAction = async (req, ctx) => {
  const runtime = resolveRuntime(ctx);
  const action = normalizeAction(req.action);
  ensureReadOnlyActionAllowed(runtime, action);
  const params = fromProtoStruct(req.params ?? {});
  const json = await requestTencentCloud(runtime, action, params);
  return actionResponse(action, json);
};

export const handlers = {
  [METHOD_DESCRIBE_ASSET_OVERVIEW]: callAction('DescribeAssetOverview'),
  [METHOD_LIST_DSPA_CLUSTERS]: callAction('ListDSPAClusters', { list: true }),
  [METHOD_DESCRIBE_DSPA_COS_DATA_ASSET_BUCKETS]: callAction('DescribeDSPACOSDataAssetBuckets', { list: true }),
  [METHOD_DESCRIBE_DSPA_RDB_DATA_ASSET_BY_COMPLIANCE_ID]: callAction('DescribeDSPARDBDataAssetByComplianceId', { list: true }),
  [METHOD_DESCRIBE_DSPA_ES_DATA_ASSET_BY_COMPLIANCE_ID]: callAction('DescribeDSPAESDataAssetByComplianceId', { list: true }),
  [METHOD_DESCRIBE_DSPA_ASSESSMENT_LATEST_RISK_LIST]: callAction('DescribeDSPAAssessmentLatestRiskList', { list: true }),
  [METHOD_DESCRIBE_DSPA_ASSESSMENT_TASKS]: callAction('DescribeDSPAAssessmentTasks', { list: true }),
  [METHOD_DESCRIBE_REPORT_TASKS]: callAction('DescribeReportTasks', { list: true }),
  [METHOD_INVOKE_READ_ONLY_ACTION]: invokeReadOnlyAction,
};

export const _test = {
  buildAuthorization,
  buildCanonicalRequest,
  assertSupportedTlsConfig,
  ensureReadOnlyActionAllowed,
  extractItems,
  fromProtoStruct,
  handlers,
  jsonStruct,
  mergeRequestParams,
  normalizeEndpoint,
  requestTencentCloud,
  resolveRuntime,
  sha256Hex,
  utcDate,
};
