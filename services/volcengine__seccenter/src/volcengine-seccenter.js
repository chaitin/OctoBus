import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const SERVICE_PACKAGE = 'Volcengine_Seccenter.Volcengine_Seccenter';
export const DEFAULT_REGION = 'cn-beijing';
export const DEFAULT_TIMEOUT_MS = 5000;
export const SIGNING_ALGORITHM = 'HMAC-SHA256';
export const SIGNING_TERMINATOR = 'request';

export const SERVICE_DEFINITIONS = {
  seccenter: {
    defaultVersion: '2024-05-08',
    endpoint: () => 'https://seccenter.volcengineapi.com',
  },
};

export const READ_ONLY_ACTIONS = [
  { methodName: 'ListAssetCenterHosts', action: 'ListAssetCenterHosts' },
  { methodName: 'ListHostsBasicInfos', action: 'ListHostsBasicInfos' },
  { methodName: 'ListHostsAgentIDs', action: 'ListHostsAgentIDs' },
  { methodName: 'GetHostBasicInfo', action: 'GetHostBasicInfo' },
  { methodName: 'GetHostAssetOverview', action: 'GetHostAssetOverview' },
  { methodName: 'ListAssetGroups', action: 'ListAssetGroups' },
  { methodName: 'ListHostRegion', action: 'ListHostRegion' },
  { methodName: 'ListHostPlatform', action: 'ListHostPlatform' },
  { methodName: 'ListTagsDetail', action: 'ListTagsDetail' },
  { methodName: 'ListVulns', action: 'ListVulns' },
  { methodName: 'ListVulnHosts', action: 'ListVulnHosts' },
  { methodName: 'GetVulnInfo', action: 'GetVulnInfo' },
  { methodName: 'GetHostVulnInfo', action: 'GetHostVulnInfo' },
  { methodName: 'GetVulnStatistics', action: 'GetVulnStatistics' },
  { methodName: 'GetVulnCheckStatus', action: 'GetVulnCheckStatus' },
  { methodName: 'GetVulnScanConfig', action: 'GetVulnScanConfig' },
  { methodName: 'ListHidsAlarms', action: 'ListHidsAlarms' },
  { methodName: 'GetHidsAlarmSummaryInfo', action: 'GetHidsAlarmSummaryInfo' },
  { methodName: 'GetHidsAlarmInfo', action: 'GetHidsAlarmInfo' },
  { methodName: 'GetHidsAlarmStatistics', action: 'GetHidsAlarmStatistics' },
  { methodName: 'ListAlarmNameList', action: 'ListAlarmNameList' },
  { methodName: 'ListAlarmTags', action: 'ListAlarmTags' },
  { methodName: 'ListEndpointHandleMethods', action: 'ListEndpointHandleMethods' },
  { methodName: 'GetIntrusionRealTimeUpdates', action: 'GetIntrusionRealTimeUpdates' },
  { methodName: 'GetIntrusionRiskTrends', action: 'GetIntrusionRiskTrends' },
  { methodName: 'ListBaselineCheckItems', action: 'ListBaselineCheckItems' },
  { methodName: 'ListBaselineCheckRes', action: 'ListBaselineCheckRes' },
  { methodName: 'ListBaselines', action: 'ListBaselines' },
  { methodName: 'ListBaselineGroups', action: 'ListBaselineGroups' },
  { methodName: 'ListVirusAlarms', action: 'ListVirusAlarms' },
  { methodName: 'GetVirusAlarmSummaryInfo', action: 'GetVirusAlarmSummaryInfo' },
  { methodName: 'ListIsolationFiles', action: 'ListIsolationFiles' },
  { methodName: 'ListScanTasks', action: 'ListScanTasks' },
  { methodName: 'ListAutoDefenseRules', action: 'ListAutoDefenseRules' },
  { methodName: 'ListCloudEnvs', action: 'ListCloudEnvs' },
  { methodName: 'ListCloudPlatforms', action: 'ListCloudPlatforms' },
  { methodName: 'MultiCloudAccessStatistics', action: 'MultiCloudAccessStatistics' },
  { methodName: 'MultiCloudAccessSyncStatus', action: 'MultiCloudAccessSyncStatus' },
  { methodName: 'ListRegistryImages', action: 'ListRegistryImages' },
  { methodName: 'ListRegistries', action: 'ListRegistries' },
  { methodName: 'GetRepoRegistrySummary', action: 'GetRepoRegistrySummary' },
  { methodName: 'GetK8sAssetStatistic', action: 'GetK8sAssetStatistic' },
  { methodName: 'ListAssetClusters', action: 'ListAssetClusters' },
  { methodName: 'GetSOCAssetVulnStats', action: 'GetSOCAssetVulnStats' },
  { methodName: 'GetSOCAssetAlarmStats', action: 'GetSOCAssetAlarmStats' },
  { methodName: 'GetSOCAssetInstanceProtectStatus', action: 'GetSOCAssetInstanceProtectStatus' },
  { methodName: 'ListFileMonitorAlarms', action: 'ListFileMonitorAlarms' },
  { methodName: 'GetHostVolume', action: 'GetHostVolume' },
  { methodName: 'ListTagRelatedAgent', action: 'ListTagRelatedAgent' },
  { methodName: 'ListLayeredGroupRelatedHost', action: 'ListLayeredGroupRelatedHost' },
  { methodName: 'GetLayeredGroups', action: 'GetLayeredGroups' },
  { methodName: 'ListLayeredGroupsDetail', action: 'ListLayeredGroupsDetail' },
  { methodName: 'ListHostVpc', action: 'ListHostVpc' },
  { methodName: 'ListAssetTags', action: 'ListAssetTags' },
  { methodName: 'GetHostImportantProtectState', action: 'GetHostImportantProtectState' },
  { methodName: 'ListGroupRelatedAgent', action: 'ListGroupRelatedAgent' },
  { methodName: 'ListVulHostByPod', action: 'ListVulHostByPod' },
  { methodName: 'ListVulByPod', action: 'ListVulByPod' },
  { methodName: 'ListVulDetail', action: 'ListVulDetail' },
  { methodName: 'ListAgentProxies', action: 'ListAgentProxies' },
  { methodName: 'ListAgentProxyServers', action: 'ListAgentProxyServers' },
  { methodName: 'ListCleanHistory', action: 'ListCleanHistory' },
  { methodName: 'GetRegularClean', action: 'GetRegularClean' },
  { methodName: 'ListOrderedHostsBasicInfos', action: 'ListOrderedHostsBasicInfos' },
  { methodName: 'GetAutoProtectConfig', action: 'GetAutoProtectConfig' },
  { methodName: 'GetDevFingerprintSoftware', action: 'GetDevFingerprintSoftware' },
  { methodName: 'GetDevFingerprintPort', action: 'GetDevFingerprintPort' },
  { methodName: 'GetDevFingerprintProcess', action: 'GetDevFingerprintProcess' },
  { methodName: 'GetDevDetail', action: 'GetDevDetail' },
  { methodName: 'ListDevBasicInfos', action: 'ListDevBasicInfos' },
  { methodName: 'GetDevFingerprintStatistics', action: 'GetDevFingerprintStatistics' },
  { methodName: 'ListDevPlatform', action: 'ListDevPlatform' },
  { methodName: 'ListDevRegion', action: 'ListDevRegion' },
  { methodName: 'ListAssetCenterDevs', action: 'ListAssetCenterDevs' },
  { methodName: 'GetMlpUpdateSoftwareTaskDetail', action: 'GetMlpUpdateSoftwareTaskDetail' },
  { methodName: 'ListDevAssetIDs', action: 'ListDevAssetIDs' },
  { methodName: 'GetMlpAlarmStatistics', action: 'GetMlpAlarmStatistics' },
  { methodName: 'GetMlpAlarmSummaryInfo', action: 'GetMlpAlarmSummaryInfo' },
  { methodName: 'ListMlpAlarmTags', action: 'ListMlpAlarmTags' },
  { methodName: 'GetDevAssetOverview', action: 'GetDevAssetOverview' },
  { methodName: 'ListMlpAlarms', action: 'ListMlpAlarms' },
  { methodName: 'GetMLPAssetSyncTaskStatus', action: 'GetMLPAssetSyncTaskStatus' },
  { methodName: 'GetMLPAssetSyncTaskDetail', action: 'GetMLPAssetSyncTaskDetail' },
  { methodName: 'ListMLPAssetTasks', action: 'ListMLPAssetTasks' },
  { methodName: 'ListWhiteLists', action: 'ListWhiteLists' },
  { methodName: 'GetWhiteListField', action: 'GetWhiteListField' },
  { methodName: 'ListBaselineCheckItemHosts', action: 'ListBaselineCheckItemHosts' },
  { methodName: 'ListAlarmArchiveRecords', action: 'ListAlarmArchiveRecords' },
  { methodName: 'GetNeighboringAlarm', action: 'GetNeighboringAlarm' },
  { methodName: 'GetAlarmBySmithKey', action: 'GetAlarmBySmithKey' },
  { methodName: 'GetSecurityOverview', action: 'GetSecurityOverview' },
  { methodName: 'ListRaspAlarms', action: 'ListRaspAlarms' },
  { methodName: 'GetSecurityOverviewScoreStats', action: 'GetSecurityOverviewScoreStats' },
  { methodName: 'GetBruteForceBanConfig', action: 'GetBruteForceBanConfig' },
  { methodName: 'GetBruteForceBanStatistics', action: 'GetBruteForceBanStatistics' },
  { methodName: 'ListBanIPList', action: 'ListBanIPList' },
  { methodName: 'GetVarmorAuthInfo', action: 'GetVarmorAuthInfo' },
  { methodName: 'GetAIAlarmJudgeConfig', action: 'GetAIAlarmJudgeConfig' },
  { methodName: 'DescribeLastWeekFileChangeTrends', action: 'DescribeLastWeekFileChangeTrends' },
  { methodName: 'ListBatchEndpointHandleMethods', action: 'ListBatchEndpointHandleMethods' },
  { methodName: 'DescribeFileMonitorOverview', action: 'DescribeFileMonitorOverview' },
  { methodName: 'ListMonitorPolicies', action: 'ListMonitorPolicies' },
  { methodName: 'GetMonitorPolicyDirectory', action: 'GetMonitorPolicyDirectory' },
  { methodName: 'DescribeFileChangeTrendTop5', action: 'DescribeFileChangeTrendTop5' },
  { methodName: 'GetAllMonitorSuffixList', action: 'GetAllMonitorSuffixList' },
  { methodName: 'GetVarmorConfigYAML', action: 'GetVarmorConfigYAML' },
  { methodName: 'GetPolicyStatistics', action: 'GetPolicyStatistics' },
  { methodName: 'GetArmorProfile', action: 'GetArmorProfile' },
  { methodName: 'ListClusterVarmorVersionHistory', action: 'ListClusterVarmorVersionHistory' },
  { methodName: 'GetClusterStatistics', action: 'GetClusterStatistics' },
  { methodName: 'ListClustersAndVarmorApps', action: 'ListClustersAndVarmorApps' },
  { methodName: 'ListVarmorPolicies', action: 'ListVarmorPolicies' },
  { methodName: 'GetVarmorTLSInfo', action: 'GetVarmorTLSInfo' },
  { methodName: 'GetVarmorPolicy', action: 'GetVarmorPolicy' },
  { methodName: 'GetGeoLocation', action: 'GetGeoLocation' },
  { methodName: 'GetOfflineNotificationList', action: 'GetOfflineNotificationList' },
  { methodName: 'GetOfflineNotificationConfig', action: 'GetOfflineNotificationConfig' },
  { methodName: 'GetAlarmRuleList', action: 'GetAlarmRuleList' },
  { methodName: 'GetBruteForceBanCapParams', action: 'GetBruteForceBanCapParams' },
  { methodName: 'GetFingerprintPort', action: 'GetFingerprintPort' },
  { methodName: 'GetFingerprintCron', action: 'GetFingerprintCron' },
  { methodName: 'GetFingerprintIntegrity', action: 'GetFingerprintIntegrity' },
  { methodName: 'GetFingerprintProcess', action: 'GetFingerprintProcess' },
  { methodName: 'GetFingerprintApp', action: 'GetFingerprintApp' },
  { methodName: 'GetFingerprintUser', action: 'GetFingerprintUser' },
  { methodName: 'GetFingerprintKmod', action: 'GetFingerprintKmod' },
  { methodName: 'GetFingerprintRefreshStatus', action: 'GetFingerprintRefreshStatus' },
  { methodName: 'GetFingerprintSoftware', action: 'GetFingerprintSoftware' },
  { methodName: 'GetFingerprintService', action: 'GetFingerprintService' },
  { methodName: 'GetFingerprintAppGroup', action: 'GetFingerprintAppGroup' },
  { methodName: 'GetFingerprintStatistics', action: 'GetFingerprintStatistics' },
  { methodName: 'GetFingerprintWeb', action: 'GetFingerprintWeb' },
  { methodName: 'GetFingerprintTop5', action: 'GetFingerprintTop5' },
  { methodName: 'GetFingerprintAIApp', action: 'GetFingerprintAIApp' },
  { methodName: 'ListFingerprintCollectConfig', action: 'ListFingerprintCollectConfig' },
  { methodName: 'ListBaselineHostItemHosts', action: 'ListBaselineHostItemHosts' },
  { methodName: 'ListWeakPasswordCheckDetail', action: 'ListWeakPasswordCheckDetail' },
  { methodName: 'ListBaselineCheckDetail', action: 'ListBaselineCheckDetail' },
  { methodName: 'GetGroupCheckStatus', action: 'GetGroupCheckStatus' },
  { methodName: 'GetBaselineGroupStatistics', action: 'GetBaselineGroupStatistics' },
  { methodName: 'GetBaselineDetectProgressDetail', action: 'GetBaselineDetectProgressDetail' },
  { methodName: 'ListBaselineCheckConfig', action: 'ListBaselineCheckConfig' },
  { methodName: 'GetFingerprintEnv', action: 'GetFingerprintEnv' },
  { methodName: 'ListBaselineForGroupPolicy', action: 'ListBaselineForGroupPolicy' },
  { methodName: 'GetCustomWeakPasswords', action: 'GetCustomWeakPasswords' },
  { methodName: 'ListCheckConfigRelatedBaseline', action: 'ListCheckConfigRelatedBaseline' },
  { methodName: 'ListBaselineBasicInfo', action: 'ListBaselineBasicInfo' },
  { methodName: 'GetVirusFile', action: 'GetVirusFile' },
  { methodName: 'GetMultiLevelAuthDetail', action: 'GetMultiLevelAuthDetail' },
  { methodName: 'ListMultiLevelAssetHosts', action: 'ListMultiLevelAssetHosts' },
  { methodName: 'GetMultiLevelInstitutionDetail', action: 'GetMultiLevelInstitutionDetail' },
  { methodName: 'GetMultiLevelHostAssetOverview', action: 'GetMultiLevelHostAssetOverview' },
  { methodName: 'ListMultiLevelInstitution', action: 'ListMultiLevelInstitution' },
  { methodName: 'GetAutoIsolateAgentList', action: 'GetAutoIsolateAgentList' },
  { methodName: 'ListScanSubTasks', action: 'ListScanSubTasks' },
  { methodName: 'ListScanTaskHosts', action: 'ListScanTaskHosts' },
  { methodName: 'GetRegularVirusScanConfig', action: 'GetRegularVirusScanConfig' },
  { methodName: 'GetRegularVirusTaskStatus', action: 'GetRegularVirusTaskStatus' },
  { methodName: 'GetVirusDatabaseUpdateTime', action: 'GetVirusDatabaseUpdateTime' },
  { methodName: 'GetAlarmVirusStatistics', action: 'GetAlarmVirusStatistics' },
  { methodName: 'GetVirusTaskStatistics', action: 'GetVirusTaskStatistics' },
  { methodName: 'GetVirusTaskInfo', action: 'GetVirusTaskInfo' },
  { methodName: 'ListAutoDefenseHosts', action: 'ListAutoDefenseHosts' },
  { methodName: 'GetAlarmTraceRawData', action: 'GetAlarmTraceRawData' },
  { methodName: 'GetAlarmTrace', action: 'GetAlarmTrace' },
  { methodName: 'GetTLSInfo', action: 'GetTLSInfo' },
  { methodName: 'ListLoginConfigs', action: 'ListLoginConfigs' },
  { methodName: 'GetStackTrace', action: 'GetStackTrace' },
  { methodName: 'GetRaspAlarmSummaryInfo', action: 'GetRaspAlarmSummaryInfo' },
  { methodName: 'GetRaspConfigStatistics', action: 'GetRaspConfigStatistics' },
  { methodName: 'ListRaspConfigs', action: 'ListRaspConfigs' },
  { methodName: 'GetRaspProtectStatistics', action: 'GetRaspProtectStatistics' },
  { methodName: 'GetRaspAlarmStatistics', action: 'GetRaspAlarmStatistics' },
  { methodName: 'GetOneRaspAlarm', action: 'GetOneRaspAlarm' },
  { methodName: 'GetRaspAuthorizationStatistics', action: 'GetRaspAuthorizationStatistics' },
  { methodName: 'ListRaspConfigAgentInfos', action: 'ListRaspConfigAgentInfos' },
  { methodName: 'ListRaspProcesses', action: 'ListRaspProcesses' },
  { methodName: 'GetRaspProcessDetail', action: 'GetRaspProcessDetail' },
  { methodName: 'GetRegistryImagesSyncStatus', action: 'GetRegistryImagesSyncStatus' },
  { methodName: 'GetRegistryImageDetail', action: 'GetRegistryImageDetail' },
  { methodName: 'ListRegistryNamespaceIDs', action: 'ListRegistryNamespaceIDs' },
  { methodName: 'GetRepoImageRiskCnt', action: 'GetRepoImageRiskCnt' },
  { methodName: 'ListAllCntrStaticDict', action: 'ListAllCntrStaticDict' },
  { methodName: 'GetRegistriesPermissionResult', action: 'GetRegistriesPermissionResult' },
  { methodName: 'ListRegistryNamespaces', action: 'ListRegistryNamespaces' },
  { methodName: 'GetRegistrySyncConfig', action: 'GetRegistrySyncConfig' },
  { methodName: 'ListAssetNamespaces', action: 'ListAssetNamespaces' },
  { methodName: 'GetAssetWorkloadStatistic', action: 'GetAssetWorkloadStatistic' },
  { methodName: 'ListAssetPodsLinkedWorkloadWithNoPage', action: 'ListAssetPodsLinkedWorkloadWithNoPage' },
  { methodName: 'ListAssetWorkloads', action: 'ListAssetWorkloads' },
  { methodName: 'ListAssetPodsLinkedWorkload', action: 'ListAssetPodsLinkedWorkload' },
  { methodName: 'GetCisDetail', action: 'GetCisDetail' },
  { methodName: 'GetVulnDetail', action: 'GetVulnDetail' },
  { methodName: 'GetUserBatchScanStatus', action: 'GetUserBatchScanStatus' },
  { methodName: 'GetRepoImageScanCron', action: 'GetRepoImageScanCron' },
  { methodName: 'GetRepoImageScanScope', action: 'GetRepoImageScanScope' },
  { methodName: 'ListRepoImageLayer', action: 'ListRepoImageLayer' },
  { methodName: 'ListRepoImageVirus', action: 'ListRepoImageVirus' },
  { methodName: 'ListRepoImageLayerVirus', action: 'ListRepoImageLayerVirus' },
  { methodName: 'ListRepoImageLayerSenfile', action: 'ListRepoImageLayerSenfile' },
  { methodName: 'ListRepoImageLayerVuln', action: 'ListRepoImageLayerVuln' },
  { methodName: 'ListRiskVulnAffectRepoImage', action: 'ListRiskVulnAffectRepoImage' },
  { methodName: 'ListRiskComplAffectRepoImage', action: 'ListRiskComplAffectRepoImage' },
  { methodName: 'ListRepoImageCompl', action: 'ListRepoImageCompl' },
  { methodName: 'ListRepoImagePackage', action: 'ListRepoImagePackage' },
  { methodName: 'ListRepoImageVuln', action: 'ListRepoImageVuln' },
  { methodName: 'ListRepoImageSenfile', action: 'ListRepoImageSenfile' },
  { methodName: 'GetAssetClustersSyncEnd', action: 'GetAssetClustersSyncEnd' },
  { methodName: 'GetClustersPermissionResult', action: 'GetClustersPermissionResult' },
  { methodName: 'GetAssetClusterStatistic', action: 'GetAssetClusterStatistic' },
  { methodName: 'GetSOCPrecautionBaselineStats', action: 'GetSOCPrecautionBaselineStats' },
  { methodName: 'GetSOCAssetSecurityScore', action: 'GetSOCAssetSecurityScore' },
  { methodName: 'ListVulnForAI', action: 'ListVulnForAI' },
  { methodName: 'ListVulnAffectAISession', action: 'ListVulnAffectAISession' },
  { methodName: 'GetAIVulnDetectProgressDetail', action: 'GetAIVulnDetectProgressDetail' },
  { methodName: 'GetVulnInfoForAI', action: 'GetVulnInfoForAI' },
  { methodName: 'GetManualSyncAIApplicationStatus', action: 'GetManualSyncAIApplicationStatus' },
  { methodName: 'GetAIFingerprintTop5', action: 'GetAIFingerprintTop5' },
  { methodName: 'GetAIFingerprintProcess', action: 'GetAIFingerprintProcess' },
  { methodName: 'GetVulnCheckStatusForAI', action: 'GetVulnCheckStatusForAI' },
  { methodName: 'GetAIApplicationSyncConfig', action: 'GetAIApplicationSyncConfig' },
  { methodName: 'GetAIFingerprintRefreshStatus', action: 'GetAIFingerprintRefreshStatus' },
  { methodName: 'GetAISessionVulnInfo', action: 'GetAISessionVulnInfo' },
  { methodName: 'ListAgentkitSessionIDs', action: 'ListAgentkitSessionIDs' },
  { methodName: 'GetAIFingerprintStatistics', action: 'GetAIFingerprintStatistics' },
  { methodName: 'GetVulnStatisticsForAI', action: 'GetVulnStatisticsForAI' },
  { methodName: 'GetAIFingerprintPort', action: 'GetAIFingerprintPort' },
  { methodName: 'GetAIFingerprintApp', action: 'GetAIFingerprintApp' },
  { methodName: 'GetAIFingerprintSoftware', action: 'GetAIFingerprintSoftware' },
  { methodName: 'ListAIApplicationBasicInfo', action: 'ListAIApplicationBasicInfo' },
  { methodName: 'ListMonitoring', action: 'ListMonitoring' },
];

export const METHOD_INVOKE_READ_ONLY_ACTION_FULL = `${SERVICE_PACKAGE}/InvokeReadOnlyAction`;
export const METHOD_INVOKE_READ_ONLY_ACTION_PATH = `/${METHOD_INVOKE_READ_ONLY_ACTION_FULL}`;

const ACTION_BY_METHOD = new Map(READ_ONLY_ACTIONS.map((entry) => [entry.methodName, entry]));
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
  if (typeof value === 'number') return { numberValue: value };
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
  const accessKeyId = toTrimmedString(firstDefined(bindings.accessKeyId, bindings.access_key_id, bindings.AccessKeyID));
  const secretAccessKey = toTrimmedString(firstDefined(bindings.secretAccessKey, bindings.secret_access_key, bindings.SecretAccessKey));
  if (!accessKeyId) throw errorWithCode('FAILED_PRECONDITION', 'secret "accessKeyId" is required but not configured');
  if (!secretAccessKey) throw errorWithCode('FAILED_PRECONDITION', 'secret "secretAccessKey" is required but not configured');

  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: toTrimmedString(firstDefined(bindings.sessionToken, bindings.session_token)),
    region: toTrimmedString(bindings.region) || DEFAULT_REGION,
    endpoint: toTrimmedString(firstDefined(bindings.endpoint, bindings.host, bindings.baseUrl)),
  };
};

const uriEscape = (value) => encodeURIComponent(String(value))
  .replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);

const assertQueryParamValue = (key, value) => {
  if (value !== null && typeof value === 'object') {
    throw errorWithCode('INVALID_ARGUMENT', `nested object not supported in query params for key "${key}"`);
  }
};

const queryParamsToString = (params = {}) => Object.keys(params)
  .filter((key) => params[key] !== undefined && params[key] !== null)
  .sort()
  .flatMap((key) => {
    const escapedKey = uriEscape(key);
    const value = params[key];
    if (Array.isArray(value)) return value.map((item) => {
      assertQueryParamValue(key, item);
      return `${escapedKey}=${uriEscape(item)}`;
    }).sort();
    assertQueryParamValue(key, value);
    return [`${escapedKey}=${uriEscape(value)}`];
  })
  .join('&');

const hashSHA256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const hmacSHA256 = (key, value, encoding) => crypto.createHmac('sha256', key).update(value).digest(encoding);

const iso8601Basic = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[:\-]|\.\d{3}/g, '');

const getSigningKey = (secretAccessKey, date, region, serviceCode) => {
  const kDate = hmacSHA256(secretAccessKey, date);
  const kRegion = hmacSHA256(kDate, region);
  const kService = hmacSHA256(kRegion, serviceCode);
  return hmacSHA256(kService, SIGNING_TERMINATOR);
};

const canonicalHeaderValues = (value) => String(value).replace(/\s+/g, ' ').trim();

const signRequest = ({ method, url, query, bodyText, accessKeyId, secretAccessKey, sessionToken, region, serviceCode, date = new Date() }) => {
  const datetime = iso8601Basic(date);
  const dateStamp = datetime.slice(0, 8);
  const bodyHash = hashSHA256(bodyText || '');
  const headers = {
    Host: url.host,
    'X-Date': datetime,
    'X-Content-Sha256': bodyHash,
  };
  if (sessionToken) headers['X-Security-Token'] = sessionToken;

  const signedHeaderKeys = Object.keys(headers).map((key) => key.toLowerCase()).sort();
  const canonicalHeaders = signedHeaderKeys.map((key) => {
    const originalKey = Object.keys(headers).find((headerKey) => headerKey.toLowerCase() === key);
    return `${key}:${canonicalHeaderValues(headers[originalKey])}`;
  }).join('\n');
  const signedHeaders = signedHeaderKeys.join(';');
  const canonicalRequest = [
    method.toUpperCase(),
    url.pathname || '/',
    queryParamsToString(query),
    `${canonicalHeaders}\n`,
    signedHeaders,
    bodyHash,
  ].join('\n');
  const credentialScope = `${dateStamp}/${region}/${serviceCode}/${SIGNING_TERMINATOR}`;
  const stringToSign = [
    SIGNING_ALGORITHM,
    datetime,
    credentialScope,
    hashSHA256(canonicalRequest),
  ].join('\n');
  const signingKey = getSigningKey(secretAccessKey, dateStamp, region, serviceCode);
  const signature = hmacSHA256(signingKey, stringToSign, 'hex');
  const authorization = `${SIGNING_ALGORITHM} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    headers: {
      ...headers,
      Authorization: authorization,
    },
    canonicalRequest,
    stringToSign,
    signature,
  };
};

const endpointFor = ({ serviceCode, region, endpoint }) => {
  const service = SERVICE_DEFINITIONS[serviceCode];
  if (!service) throw errorWithCode('INVALID_ARGUMENT', `unsupported Volcengine Cloud Security Center service_code "${serviceCode}"`);
  const raw = endpoint || service.endpoint(region);
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('bad protocol');
    return url;
  } catch {
    throw errorWithCode('FAILED_PRECONDITION', 'endpoint must be a valid http or https URL');
  }
};

const validateActionName = (action) => {
  const value = toTrimmedString(action);
  if (!value) throw errorWithCode('INVALID_ARGUMENT', 'action must be a non-empty string');
  const allowedSpecialActions = new Set(['MultiCloudAccessStatistics', 'MultiCloudAccessSyncStatus']);
  if (!/^(Get|Desc|Describe|List|Query|Search)[A-Za-z0-9]+$/.test(value) && !allowedSpecialActions.has(value)) {
    throw errorWithCode('INVALID_ARGUMENT', 'only Volcengine Cloud Security Center read-only Get*, Desc*, Describe*, List*, Query*, Search*, and approved statistics actions are allowed');
  }
  return value;
};

const validateMethod = (method) => {
  const value = (toTrimmedString(method) || 'POST').toUpperCase();
  if (!['GET', 'POST'].includes(value)) throw errorWithCode('INVALID_ARGUMENT', 'method must be GET or POST');
  return value;
};

const validateActionSpec = (spec = {}) => {
  const serviceCode = toTrimmedString(firstDefined(spec.serviceCode, spec.service_code)) || 'seccenter';
  const service = SERVICE_DEFINITIONS[serviceCode];
  if (!service) throw errorWithCode('INVALID_ARGUMENT', `unsupported Volcengine Cloud Security Center service_code "${serviceCode}"`);
  const action = validateActionName(spec.action);
  const version = toTrimmedString(spec.version) || service.defaultVersion;
  const method = validateMethod(firstDefined(spec.httpMethod, spec.method));
  return { action, serviceCode, version, httpMethod: method, endpoint: toTrimmedString(spec.endpoint) };
};

const buildHeaders = (ctx, signedHeaders) => ({
  ...(ctx.bindings?.headers && typeof ctx.bindings.headers === 'object' ? ctx.bindings.headers : {}),
  'Content-Type': 'application/json; charset=UTF-8',
  ...signedHeaders,
});

const errorFromVolcengineResponse = (body) => {
  const err = body?.ResponseMetadata?.Error || body?.Error;
  if (!err) return null;
  const code = String(err.Code || err.CodeN || '');
  const message = err.Message || 'Volcengine API returned an error';
  if (/Auth|Unauthorized|Forbidden|Denied|InvalidAccessKey|Signature/i.test(code)) return errorWithCode('PERMISSION_DENIED', `${code}: ${message}`);
  if (/InvalidParameter|Missing|Parameter|NotFound|Unsupported/i.test(code)) return errorWithCode('INVALID_ARGUMENT', `${code}: ${message}`);
  return errorWithCode('UNKNOWN', `${code || 'VolcengineError'}: ${message}`);
};

const parseVolcengineResponse = async (res) => {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', `Volcengine API returned non-JSON response: ${text.slice(0, 200)}`);
  }
};

const payloadFromRequest = (req = {}) => normalizeStruct(req.payload ?? {});

const invokeVolcengine = async (spec, payload, ctx = {}) => {
  const actionSpec = validateActionSpec(spec);
  const callCtx = resolveCallContext(ctx);
  const bindings = validateBindings(callCtx.bindings);
  const endpoint = endpointFor({ serviceCode: actionSpec.serviceCode, region: bindings.region, endpoint: actionSpec.endpoint || bindings.endpoint });
  const query = { Action: actionSpec.action, Version: actionSpec.version };
  let bodyText = '';
  if (actionSpec.httpMethod === 'GET') {
    Object.assign(query, payload ?? {});
  } else {
    bodyText = JSON.stringify(payload ?? {});
  }
  endpoint.search = queryParamsToString(query);

  const date = callCtx.meta?.date instanceof Date
    ? callCtx.meta.date
    : (toTrimmedString(callCtx.meta?.date) ? new Date(toTrimmedString(callCtx.meta.date)) : new Date());
  const signed = signRequest({
    method: actionSpec.httpMethod,
    url: endpoint,
    query,
    bodyText,
    accessKeyId: bindings.accessKeyId,
    secretAccessKey: bindings.secretAccessKey,
    sessionToken: bindings.sessionToken,
    region: bindings.region,
    serviceCode: actionSpec.serviceCode,
    date,
  });
  const headers = buildHeaders(callCtx, signed.headers);
  const timeoutMs = resolveTimeoutMs(callCtx);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  let body;
  try {
    res = await fetch(endpoint.toString(), {
      method: actionSpec.httpMethod,
      headers,
      body: actionSpec.httpMethod === 'GET' ? undefined : bodyText,
      signal: controller.signal,
    });
    body = await parseVolcengineResponse(res);
  } catch (err) {
    if (err.legacyCode) throw err;
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      throw errorWithCode('DEADLINE_EXCEEDED', `Volcengine Security Center API request timed out after ${timeoutMs}ms`);
    }
    throw errorWithCode('UNAVAILABLE', `failed to call Volcengine Security Center API: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }
  if (res.status >= 500) {
    throw errorWithCode('UNAVAILABLE', `Volcengine Cloud Security Center API HTTP ${res.status}: ${JSON.stringify(body).slice(0, 500)}`);
  }
  const volcError = errorFromVolcengineResponse(body);
  if (volcError) throw volcError;
  if (res.status < 200 || res.status >= 300) {
    throw errorWithCode('UNAVAILABLE', `Volcengine Cloud Security Center API HTTP ${res.status}: ${JSON.stringify(body).slice(0, 500)}`);
  }
  return { response: toValue(body) };
};

const buildActionHandler = (spec) => async (req, ctx) => invokeVolcengine(
  spec,
  payloadFromRequest(handlerRequest(req, ctx)),
  handlerContext(req, ctx),
);

export const handlers = Object.fromEntries([
  ...READ_ONLY_ACTIONS.map((entry) => [`${SERVICE_PACKAGE}/${entry.methodName}`, buildActionHandler(entry)]),
  [METHOD_INVOKE_READ_ONLY_ACTION_FULL, async (req, ctx) => {
    const request = handlerRequest(req, ctx);
    return invokeVolcengine({
      action: request.action,
      serviceCode: request.service_code || request.serviceCode,
      version: request.version,
      method: request.method,
      endpoint: request.endpoint,
    }, normalizeStruct(request.payload ?? {}), handlerContext(req, ctx));
  }],
]);

export const rpcdef = () => Object.fromEntries([
  ...READ_ONLY_ACTIONS.map((entry) => [`/${SERVICE_PACKAGE}/${entry.methodName}`, handlers[`${SERVICE_PACKAGE}/${entry.methodName}`]]),
  [METHOD_INVOKE_READ_ONLY_ACTION_PATH, handlers[METHOD_INVOKE_READ_ONLY_ACTION_FULL]],
]);

export const _test = {
  ACTION_BY_METHOD,
  normalizeStruct,
  normalizeStructValue,
  toValue,
  validateBindings,
  validateActionName,
  validateActionSpec,
  queryParamsToString,
  signRequest,
  invokeVolcengine,
};
