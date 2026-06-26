import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const METHOD_DESCRIBE_MACHINES = 'Tencent_CWP.TencentCwpService/DescribeMachines';
export const METHOD_DESCRIBE_MACHINE_GENERAL = 'Tencent_CWP.TencentCwpService/DescribeMachineGeneral';
export const METHOD_DESCRIBE_MALWARE_LIST = 'Tencent_CWP.TencentCwpService/DescribeMalWareList';
export const METHOD_DESCRIBE_VUL_LIST = 'Tencent_CWP.TencentCwpService/DescribeVulList';
export const METHOD_DESCRIBE_BASELINE_DETECT_OVERVIEW = 'Tencent_CWP.TencentCwpService/DescribeBaselineDetectOverview';
export const METHOD_DESCRIBE_MACHINE_RISK_CNT = 'Tencent_CWP.TencentCwpService/DescribeMachineRiskCnt';
export const METHOD_INVOKE_READ_ONLY_ACTION = 'Tencent_CWP.TencentCwpService/InvokeReadOnlyAction';

export const DEFAULT_ENDPOINT = 'https://cwp.tencentcloudapi.com';
export const DEFAULT_REGION = 'ap-guangzhou';
export const DEFAULT_VERSION = '2018-02-28';
export const DEFAULT_TIMEOUT_MS = 5000;
export const SERVICE = 'cwp';
export const ALGORITHM = 'TC3-HMAC-SHA256';

const FIXED_ACTIONS = new Set([
  'DescribeABTestConfig',
  'DescribeAccountStatistics',
  'DescribeAlarmIncidentNodes',
  'DescribeAlarmVertexId',
  'DescribeAssetAppCount',
  'DescribeAssetAppList',
  'DescribeAssetAppProcessList',
  'DescribeAssetCoreModuleInfo',
  'DescribeAssetCoreModuleList',
  'DescribeAssetDatabaseCount',
  'DescribeAssetDatabaseInfo',
  'DescribeAssetDatabaseList',
  'DescribeAssetDiskList',
  'DescribeAssetEnvList',
  'DescribeAssetHostTotalCount',
  'DescribeAssetInfo',
  'DescribeAssetInitServiceList',
  'DescribeAssetJarInfo',
  'DescribeAssetJarList',
  'DescribeAssetLoadInfo',
  'DescribeAssetMachineDetail',
  'DescribeAssetMachineList',
  'DescribeAssetMachineTagTop',
  'DescribeAssetPlanTaskList',
  'DescribeAssetPortCount',
  'DescribeAssetPortInfoList',
  'DescribeAssetProcessCount',
  'DescribeAssetProcessInfoList',
  'DescribeAssetRecentMachineInfo',
  'DescribeAssetSystemPackageList',
  'DescribeAssetTotalCount',
  'DescribeAssetTypes',
  'DescribeAssetTypeTop',
  'DescribeAssetUserCount',
  'DescribeAssetUserInfo',
  'DescribeAssetUserKeyList',
  'DescribeAssetUserList',
  'DescribeAssetWebAppCount',
  'DescribeAssetWebAppList',
  'DescribeAssetWebAppPluginList',
  'DescribeAssetWebFrameCount',
  'DescribeAssetWebFrameList',
  'DescribeAssetWebLocationCount',
  'DescribeAssetWebLocationInfo',
  'DescribeAssetWebLocationList',
  'DescribeAssetWebLocationPathList',
  'DescribeAssetWebServiceCount',
  'DescribeAssetWebServiceInfoList',
  'DescribeAssetWebServiceProcessList',
  'DescribeAttackEventInfo',
  'DescribeAttackEvents',
  'DescribeAttackStatistics',
  'DescribeAttackTop',
  'DescribeAttackTrends',
  'DescribeAttackType',
  'DescribeAttackVulTypeList',
  'DescribeBanMode',
  'DescribeBanRegions',
  'DescribeBanStatus',
  'DescribeBanWhiteList',
  'DescribeBaselineAnalysisData',
  'DescribeBaselineBasicInfo',
  'DescribeBaselineDefaultStrategyList',
  'DescribeBaselineDetail',
  'DescribeBaselineDetectList',
  'DescribeBaselineDetectOverview',
  'DescribeBaselineEffectHostList',
  'DescribeBaselineFixList',
  'DescribeBaselineHostDetectList',
  'DescribeBaselineHostIgnoreList',
  'DescribeBaselineHostRiskTop',
  'DescribeBaselineHostTop',
  'DescribeBaselineItemDetectList',
  'DescribeBaselineItemIgnoreList',
  'DescribeBaselineItemInfo',
  'DescribeBaselineItemList',
  'DescribeBaselineItemRiskTop',
  'DescribeBaselineList',
  'DescribeBaselinePolicyList',
  'DescribeBaselineRule',
  'DescribeBaselineRuleCategoryList',
  'DescribeBaselineRuleDetectList',
  'DescribeBaselineRuleIgnoreList',
  'DescribeBaselineRuleList',
  'DescribeBaselineScanSchedule',
  'DescribeBaselineStrategyDetail',
  'DescribeBaselineStrategyList',
  'DescribeBaselineTop',
  'DescribeBaselineWeakPasswordList',
  'DescribeBashEvents',
  'DescribeBashEventsInfo',
  'DescribeBashEventsInfoNew',
  'DescribeBashEventsNew',
  'DescribeBashPolicies',
  'DescribeBashRules',
  'DescribeBruteAttackList',
  'DescribeBruteAttackRules',
  'DescribeCanFixVulMachine',
  'DescribeCanNotSeparateMachine',
  'DescribeClientException',
  'DescribeDefenceEventDetail',
  'DescribeEmergencyVulList',
  'DescribeESAggregations',
  'DescribeEventByTable',
  'DescribeFastAnalysis',
  'DescribeFileTamperEventRuleInfo',
  'DescribeFileTamperEvents',
  'DescribeFileTamperRuleCount',
  'DescribeFileTamperRuleInfo',
  'DescribeFileTamperRules',
  'DescribeGeneralStat',
  'DescribeHistoryAccounts',
  'DescribeHistoryService',
  'DescribeHostInfo',
  'DescribeHostLoginList',
  'DescribeHotVulTop',
  'DescribeIgnoreBaselineRule',
  'DescribeIgnoreHostAndItemConfig',
  'DescribeIgnoreRuleEffectHostList',
  'DescribeImportMachineInfo',
  'DescribeInjectRiskyServiceSwitch',
  'DescribeJavaMemShellInfo',
  'DescribeJavaMemShellList',
  'DescribeJavaMemShellPluginInfo',
  'DescribeJavaMemShellPluginList',
  'DescribeLogDeliveryKafkaOptions',
  'DescribeLogHistogram',
  'DescribeLogIndex',
  'DescribeLoginTypeGlobalConf',
  'DescribeLoginTypeHost',
  'DescribeLoginWhiteCombinedList',
  'DescribeLoginWhiteHostList',
  'DescribeLoginWhiteList',
  'DescribeLogKafkaDeliverInfo',
  'DescribeLogStorageConfig',
  'DescribeLogStorageRecord',
  'DescribeLogStorageStatistic',
  'DescribeLogType',
  'DescribeMachineClearHistory',
  'DescribeMachineDefenseCnt',
  'DescribeMachineFileTamperRules',
  'DescribeMachineGeneral',
  'DescribeMachineInfo',
  'DescribeMachineList',
  'DescribeMachineOsList',
  'DescribeMachineRegionList',
  'DescribeMachineRegions',
  'DescribeMachineRiskCnt',
  'DescribeMachines',
  'DescribeMachineSnapshot',
  'DescribeMachinesSimple',
  'DescribeMaliciousRequestWhiteList',
  'DescribeMalwareFile',
  'DescribeMalwareInfo',
  'DescribeMalWareList',
  'DescribeMalwareRiskOverview',
  'DescribeMalwareRiskWarning',
  'DescribeMalwareTimingScanSetting',
  'DescribeMalwareWhiteList',
  'DescribeMalwareWhiteListAffectList',
  'DescribeMemShellRules',
  'DescribeNetAttackSetting',
  'DescribeNetAttackWhiteList',
  'DescribeOpenPortStatistics',
  'DescribeOverviewStatistics',
  'DescribePatchEffectHostList',
  'DescribePatchInfo',
  'DescribePrivilegeEventInfo',
  'DescribePrivilegeEvents',
  'DescribePrivilegeRules',
  'DescribeProcessStatistics',
  'DescribeProtectDirList',
  'DescribeProtectDirRelatedServer',
  'DescribeRansomDefenseBackupList',
  'DescribeRansomDefenseEventsList',
  'DescribeRansomDefenseMachineList',
  'DescribeRansomDefenseMachineStrategyInfo',
  'DescribeRansomDefenseRollBackTaskList',
  'DescribeRansomDefenseState',
  'DescribeRansomDefenseStrategyDetail',
  'DescribeRansomDefenseStrategyList',
  'DescribeRansomDefenseStrategyMachines',
  'DescribeRansomDefenseTrend',
  'DescribeRaspEventCWP',
  'DescribeRaspEventDetailCWP',
  'DescribeRaspEventDetailTCSS',
  'DescribeRaspEventTCSS',
  'DescribeRaspMaxCpu',
  'DescribeRaspMemShellDetailTCSS',
  'DescribeRaspMemShellListTCSS',
  'DescribeRaspPluginList',
  'DescribeRaspRules',
  'DescribeRaspRuleVuls',
  'DescribeReverseShellEventInfo',
  'DescribeReverseShellEvents',
  'DescribeReverseShellRules',
  'DescribeReverseShellRulesAggregation',
  'DescribeReverseShellSystemPolicyConfig',
  'DescribeRiskBatchStatus',
  'DescribeRiskDnsEventInfo',
  'DescribeRiskDnsEventList',
  'DescribeRiskDnsInfo',
  'DescribeRiskDnsList',
  'DescribeRiskDnsPolicyList',
  'DescribeRiskProcessEvents',
  'DescribeSafeInfo',
  'DescribeScanMalwareSchedule',
  'DescribeScanSchedule',
  'DescribeScanState',
  'DescribeScanTaskDetails',
  'DescribeScanTaskStatus',
  'DescribeScanVulSetting',
  'DescribeScreenAttackHotspot',
  'DescribeScreenBroadcasts',
  'DescribeScreenDefenseTrends',
  'DescribeScreenEmergentMsg',
  'DescribeScreenEventsCnt',
  'DescribeScreenGeneralStat',
  'DescribeScreenHostInvasion',
  'DescribeScreenMachineRegions',
  'DescribeScreenMachines',
  'DescribeScreenProtectionCnt',
  'DescribeScreenProtectionStat',
  'DescribeScreenRiskAssetsTop',
  'DescribeSearchLogs',
  'DescribeSearchTemplates',
  'DescribeSecurityBroadcastInfo',
  'DescribeSecurityBroadcasts',
  'DescribeSecurityDynamics',
  'DescribeSecurityEventsCnt',
  'DescribeSecurityEventStat',
  'DescribeSecurityTrends',
  'DescribeServerRelatedDirInfo',
  'DescribeServersAndRiskAndFirstInfo',
  'DescribeShellPolicyList',
  'DescribeSkillInfo',
  'DescribeStrategyExist',
  'DescribeTagMachines',
  'DescribeTags',
  'DescribeUndoVulCounts',
  'DescribeUsersConfig',
  'DescribeUsualLoginPlaces',
  'DescribeVdbAndPocInfo',
  'DescribeVertexDetail',
  'DescribeVulCountByDates',
  'DescribeVulCveIdInfo',
  'DescribeVulDefenceEvent',
  'DescribeVulDefenceList',
  'DescribeVulDefenceOverview',
  'DescribeVulDefenceOverviewCount',
  'DescribeVulDefencePluginDetail',
  'DescribeVulDefencePluginExceptionCount',
  'DescribeVulDefencePluginStatus',
  'DescribeVulDefenceSetting',
  'DescribeVulDefenceSettingList',
  'DescribeVulEffectHostList',
  'DescribeVulEffectModules',
  'DescribeVulEmergentMsg',
  'DescribeVulFixStatus',
  'DescribeVulHostCountScanTime',
  'DescribeVulHostTop',
  'DescribeVulInfoCvss',
  'DescribeVulLabels',
  'DescribeVulLevelCount',
  'DescribeVulList',
  'DescribeVulOverview',
  'DescribeVulStoreList',
  'DescribeVulTop',
  'DescribeVulTrend',
  'DescribeWarningHostConfig',
  'DescribeWarningList',
  'DescribeWebHookPolicy',
  'DescribeWebHookReceiver',
  'DescribeWebHookReceiverUsage',
  'DescribeWebHookRule',
  'DescribeWebHookRules',
  'DescribeWebPageEventList',
  'DescribeWebPageGeneralize',
  'DescribeWebPageProtectStat',
  'DescribeWebPageServiceInfo',
  'DescribeWindowsPatchList',
  'DescribeYDRaspBlackWhite',
  'SearchLog',
]);
const LIST_KEYS_BY_ACTION = {
  DescribeMachines: ['Machines'],
  DescribeMalWareList: ['MalWareList', 'MalwareList', 'List'],
  DescribeVulList: ['VulList', 'VulInfoList', 'List'],
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
    timeoutMs: asPositiveInt(firstDefined(bindings.timeoutMs, ctx.limits?.timeoutMs, DEFAULT_TIMEOUT_MS), 'timeoutMs', false),
    headers: parseHeaders(bindings.headers),
    allowActions: parseStringList(bindings.allowActions),
    allowAllDescribeActions: asBool(bindings.allowAllDescribeActions),
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
  if (!action.startsWith('Describe') && !FIXED_ACTIONS.has(action)) {
    throw errorWithCode('INVALID_ARGUMENT', 'InvokeReadOnlyAction only allows read-only actions');
  }
  if (FIXED_ACTIONS.has(action) || runtime.allowActions.includes(action) || runtime.allowAllDescribeActions) return;
  throw errorWithCode('PERMISSION_DENIED', `${action} is not allowed; add it to allowActions or use a dedicated method`);
};

const extractItems = (action, response = {}) => {
  const keys = LIST_KEYS_BY_ACTION[action] ?? [];
  for (const key of keys) {
    if (Array.isArray(response[key])) return response[key];
  }
  for (const [key, value] of Object.entries(response)) {
    if (key !== 'RequestId' && key !== 'Error' && Array.isArray(value)) return value;
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
  [METHOD_DESCRIBE_MACHINES]: callAction('DescribeMachines', { list: true }),
  [METHOD_DESCRIBE_MACHINE_GENERAL]: callAction('DescribeMachineGeneral'),
  [METHOD_DESCRIBE_MALWARE_LIST]: callAction('DescribeMalWareList', { list: true }),
  [METHOD_DESCRIBE_VUL_LIST]: callAction('DescribeVulList', { list: true }),
  [METHOD_DESCRIBE_BASELINE_DETECT_OVERVIEW]: callAction('DescribeBaselineDetectOverview'),
  [METHOD_DESCRIBE_MACHINE_RISK_CNT]: callAction('DescribeMachineRiskCnt'),
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
