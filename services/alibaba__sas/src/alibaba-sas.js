// Alibaba Cloud Security Center (SAS) Container Security API implementation
// Uses Alibaba Cloud RPC HMAC-SHA1 signing.
//
// API version: 2018-12-03
// Endpoint: sas.aliyuncs.com

import crypto from 'node:crypto';
import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

// ── Constants ──────────────────────────────────────────────

const SERVICE_NAME = 'Alibaba_SAS';
const API_VERSION = '2018-12-03';
const DEFAULT_REGION = 'cn-hangzhou';
const DEFAULT_ENDPOINT = 'sas.aliyuncs.com';
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 200;

// ── Method paths ───────────────────────────────────────────

export const LIST_CONTAINER_INSTANCES_PATH = '/Alibaba_SAS.Alibaba_SAS/ListContainerInstances';
export const LIST_IMAGE_INSTANCES_PATH = '/Alibaba_SAS.Alibaba_SAS/ListImageInstances';
export const LIST_IMAGE_VULNS_PATH = '/Alibaba_SAS.Alibaba_SAS/ListImageVulnerabilities';
export const GET_CLUSTER_SUSP_EVENT_STATS_PATH = '/Alibaba_SAS.Alibaba_SAS/GetClusterSuspEventStatistics';
export const LIST_CLUSTER_INTERCEPTION_CONFIG_PATH = '/Alibaba_SAS.Alibaba_SAS/ListClusterInterceptionConfig';

export const LIST_CONTAINER_INSTANCES_FULL = 'Alibaba_SAS.Alibaba_SAS/ListContainerInstances';
export const LIST_IMAGE_INSTANCES_FULL = 'Alibaba_SAS.Alibaba_SAS/ListImageInstances';
export const LIST_IMAGE_VULNS_FULL = 'Alibaba_SAS.Alibaba_SAS/ListImageVulnerabilities';
export const GET_CLUSTER_SUSP_EVENT_STATS_FULL = 'Alibaba_SAS.Alibaba_SAS/GetClusterSuspEventStatistics';
export const LIST_CLUSTER_INTERCEPTION_CONFIG_FULL = 'Alibaba_SAS.Alibaba_SAS/ListClusterInterceptionConfig';

// ── Error helpers ──────────────────────────────────────────

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

// ── Internal helpers ───────────────────────────────────────

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const firstDefined = (...values) => values.find((v) => v !== undefined && v !== null);

const toTrimmedString = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return toTrimmedString(value.value);
  return String(value).trim();
};

const toInt64 = (value) => {
  if (value === undefined || value === null) return null;
  const raw = typeof value === 'object' && value !== null && hasOwn(value, 'value') ? value.value : value;
  if (raw === undefined || raw === null || raw === '') return null;
  const num = Number(raw);
  if (!Number.isInteger(num) || Number.isNaN(num)) return null;
  return num;
};

const toBoolean = (value) => {
  if (value === undefined || value === null) return false;
  const raw = typeof value === 'object' && value !== null && hasOwn(value, 'value') ? value.value : value;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const text = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'n', 'off', ''].includes(text)) return false;
  }
  return Boolean(raw);
};

const toValue = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return { numberValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  if (Array.isArray(value)) {
    return { listValue: { values: value.map(toValue).filter((v) => v !== undefined) } };
  }
  if (typeof value === 'object') {
    const fields = {};
    for (const [key, v] of Object.entries(value)) {
      fields[key] = toValue(v) ?? { nullValue: 'NULL_VALUE' };
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(value) };
};

// ── Alibaba Cloud RPC Signing ──────────────────────────────

const percentEncode = (str) => {
  return encodeURIComponent(String(str))
    .replace(/[!*()']/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%7E/g, '~')
    .replace(/\+/g, '%20')
    .replace(/%20/g, '%20'); // already handled above
};

const signRpc = (params, accessKeySecret) => {
  const sortedKeys = Object.keys(params).sort();
  const canonicalizedQueryString = sortedKeys
    .map((key) => percentEncode(key) + '=' + percentEncode(params[key]))
    .join('&');

  const stringToSign = 'POST&' + percentEncode('/') + '&' + percentEncode(canonicalizedQueryString);

  const key = accessKeySecret + '&';
  const signature = crypto.createHmac('sha1', key).update(stringToSign, 'utf8').digest('base64');

  return percentEncode(signature);
};

const buildCommonParams = (accessKeyId, action) => {
  const timestamp = new Date().toISOString().replace(/\.\d{3}/, '');
  return {
    Format: 'JSON',
    Version: API_VERSION,
    AccessKeyId: accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    Timestamp: timestamp,
    SignatureVersion: '1.0',
    SignatureNonce: String(Date.now()) + Math.random().toString(36).substring(2, 8),
    Action: action,
  };
};

// ── Binding and context resolution ─────────────────────────

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

const resolveTimeoutMs = (bindings = {}, limits = {}) => {
  const fromBinding = toInt64(bindings.timeoutMs);
  if (fromBinding !== null) return fromBinding;
  const fromLimits = toInt64(limits.timeoutMs);
  if (fromLimits !== null) return fromLimits;
  return DEFAULT_TIMEOUT_MS;
};

const buildLogPrefix = (meta = {}, action) => {
  const parts = [];
  if (meta.instance_id || meta.instanceId) parts.push('inst=' + (meta.instance_id || meta.instanceId));
  if (meta.request_id || meta.requestId) parts.push('req=' + (meta.request_id || meta.requestId));
  return '[' + SERVICE_NAME + '][' + action + ']' + (parts.length ? '[' + parts.join(' ') + ']' : '');
};

const logFlow = (meta, action, details) => {
  const prefix = buildLogPrefix(meta, action);
  const safe = { ...details };
  try {
    console.log(prefix, JSON.stringify(safe));
  } catch {
    console.log(prefix, safe);
  }
};

// ── Credential extraction ──────────────────────────────────

const resolveCredentials = (bindings = {}) => {
  const accessKeyId = toTrimmedString(firstDefined(bindings.access_key_id, bindings.accessKeyId));
  const accessKeySecret = toTrimmedString(firstDefined(bindings.access_key_secret, bindings.accessKeySecret));
  if (!accessKeyId) throw errorWithCode('FAILED_PRECONDITION', 'binding "access_key_id" or "accessKeyId" is required but not configured');
  if (!accessKeySecret) throw errorWithCode('FAILED_PRECONDITION', 'binding "access_key_secret" or "accessKeySecret" is required but not configured');
  return { accessKeyId, accessKeySecret };
};

const resolveRegion = (bindings = {}) => toTrimmedString(bindings.region) || DEFAULT_REGION;

const resolveEndpoint = (bindings = {}) => toTrimmedString(bindings.endpoint) || DEFAULT_ENDPOINT;

// ── API call ────────────────────────────────────────────────

const callAction = async (ctx, action, apiParams) => {
  const bindings = mergedBindings(ctx);
  const credentials = resolveCredentials(bindings);
  const endpoint = resolveEndpoint(bindings);
  const timeoutMs = resolveTimeoutMs(bindings, ctx.limits);
  const meta = ctx.meta || {};

  const commonParams = buildCommonParams(credentials.accessKeyId, action);
  const allParams = { ...commonParams, ...apiParams };
  const signature = signRpc(allParams, credentials.accessKeySecret);
  allParams.Signature = signature;

  // Build POST body
  const body = Object.entries(allParams)
    .map(([k, v]) => k + '=' + v)
    .join('&');

  const url = 'https://' + endpoint + '/';

  logFlow(meta, action + ':start', { endpoint, action });

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-engine-instance': meta.instance_id || meta.instanceId || 'unknown',
        'x-request-id': meta.request_id || meta.requestId || 'unknown',
      },
      body,
      timeoutMs,
      ...(toBoolean(bindings.skipTlsVerify) || toBoolean(bindings.tlsInsecureSkipVerify)
        ? { insecureSkipVerify: true, tlsInsecureSkipVerify: true }
        : {}),
    });
  } catch (err) {
    const reason = err?.cause?.message || err?.message || 'fetch failed';
    logFlow(meta, action + ':error', { error: reason });
    throw errorWithCode('UNAVAILABLE', 'upstream error: ' + reason);
  }

  const text = await res.text();

  if (res.status === 401) {
    logFlow(meta, action + ':unauthenticated', { status: res.status });
    throw errorWithCode('UNAUTHENTICATED', 'upstream http ' + res.status + ': ' + text);
  }

  if (res.status === 403) {
    logFlow(meta, action + ':auth-error', { status: res.status });
    throw errorWithCode('PERMISSION_DENIED', 'upstream http ' + res.status + ': ' + text);
  }

  if (res.status >= 400 && res.status < 500) {
    logFlow(meta, action + ':client-error', { status: res.status, response: text });
    throw errorWithCode('FAILED_PRECONDITION', 'upstream http ' + res.status + ': ' + text);
  }

  if (res.status >= 500) {
    logFlow(meta, action + ':server-error', { status: res.status });
    throw errorWithCode('UNAVAILABLE', 'upstream http ' + res.status + ': ' + text);
  }

  if (!text.trim()) {
    throw errorWithCode('UNKNOWN', 'empty response from upstream');
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', 'response is not valid JSON');
  }

  // Alibaba Cloud API error
  if (json.Code && json.Code !== '200') {
    const code = String(json.Code);
    const msg = String(json.Message || json.message || '');
    logFlow(meta, action + ':api-error', { code, message: msg });

    if (code === 'InvalidAccessKeyId.NotFound' || code === 'SignatureDoesNotMatch' || code === 'InvalidAccessKeySecret') {
      throw errorWithCode('UNAUTHENTICATED', 'Alibaba API error: ' + code + ' - ' + msg);
    }
    throw errorWithCode('FAILED_PRECONDITION', 'Alibaba API error: ' + code + ' - ' + msg);
  }

  logFlow(meta, action + ':done', {});
  return json;
};

// ── Response mappers ───────────────────────────────────────

const mapContainerInstance = (item) => ({
  instance_id: String(item?.InstanceId ?? item?.instanceId ?? item?.ContainerId ?? ''),
  container_name: String(item?.ContainerName ?? item?.containerName ?? ''),
  status: String(item?.Status ?? item?.status ?? ''),
  image_name: String(item?.Image ?? item?.image ?? item?.ImageName ?? ''),
  cluster_name: String(item?.ClusterName ?? item?.clusterName ?? ''),
  cluster_id: String(item?.ClusterId ?? item?.clusterId ?? ''),
  pod_name: String(item?.Pod ?? item?.pod ?? item?.PodName ?? ''),
  namespace: String(item?.Namespace ?? item?.namespace ?? ''),
  node_ip: String(item?.NodeIp ?? item?.nodeIp ?? item?.NodeIP ?? ''),
  pod_ip: String(item?.PodIp ?? item?.podIp ?? item?.PodIP ?? ''),
  risk_level: String(item?.RiskLevel ?? item?.riskLevel ?? ''),
});

const mapImageInstance = (item) => ({
  image_uuid: String(item?.ImageUuid ?? item?.imageUuid ?? item?.Uuid ?? ''),
  image_tag: String(item?.ImageTag ?? item?.imageTag ?? item?.Tag ?? ''),
  digest: String(item?.Digest ?? item?.digest ?? ''),
  repo_name: String(item?.RepoName ?? item?.repoName ?? item?.Repository ?? ''),
  repo_namespace: String(item?.RepoNamespace ?? item?.repoNamespace ?? ''),
  region: String(item?.Region ?? item?.region ?? item?.RegionId ?? ''),
  image_size: toInt64(item?.ImageSize ?? item?.imageSize) ?? 0,
  vul_count: toInt64(item?.VulCount ?? item?.vulCount) ?? 0,
  alarm_count: toInt64(item?.AlarmCount ?? item?.alarmCount) ?? 0,
  risk_level: String(item?.RiskLevel ?? item?.riskLevel ?? ''),
});

const mapImageVulnerability = (item) => ({
  name: String(item?.Name ?? item?.name ?? ''),
  alias_name: String(item?.AliasName ?? item?.aliasName ?? ''),
  cve_id: String(item?.CveId ?? item?.cveId ?? item?.CveID ?? ''),
  level: String(item?.Level ?? item?.level ?? item?.RiskLevel ?? ''),
  type: String(item?.Type ?? item?.type ?? ''),
  fix_version: String(item?.FixVersion ?? item?.fixVersion ?? item?.Fix ?? ''),
  is_fixed: toBoolean(item?.IsFixed ?? item?.isFixed ?? item?.IsFix ?? false),
  first_found_time: String(item?.FirstFoundTime ?? item?.firstFoundTime ?? item?.FirstFound ?? ''),
});

const mapClusterInterceptionConfig = (item) => ({
  cluster_name: String(item?.ClusterName ?? item?.clusterName ?? ''),
  cluster_id: String(item?.ClusterId ?? item?.clusterId ?? ''),
  intercept_type: String(item?.InterceptType ?? item?.interceptType ?? ''),
  rule_count: toInt64(item?.RuleCount ?? item?.ruleCount) ?? 0,
  state: toInt64(item?.State ?? item?.state) ?? 0,
});

// ── Pagination helpers ─────────────────────────────────────

const buildPagination = (req = {}) => {
  const pageSize = toInt64(firstDefined(req.page_size, req.pageSize, req.PageSize));
  const currentPage = toInt64(firstDefined(req.current_page, req.currentPage, req.CurrentPage));
  const result = {};
  if (currentPage !== null && currentPage > 0) result.CurrentPage = String(currentPage);
  if (pageSize !== null && pageSize > 0 && pageSize <= MAX_PAGE_SIZE) {
    result.PageSize = String(pageSize);
  } else {
    result.PageSize = String(DEFAULT_PAGE_SIZE);
  }
  return result;
};

const extractList = (json, key) => {
  const list = json?.[key];
  if (Array.isArray(list)) return list;
  return [];
};

const extractTotal = (json) => {
  const total = json?.TotalCount ?? json?.totalCount ?? json?.Count;
  return toInt64(total) ?? 0;
};

// ── API method implementations ─────────────────────────────

const listContainerInstances = async (req = {}, ctx = {}) => {
  const apiParams = {
    ...buildPagination(req),
  };
  const criteria = toTrimmedString(firstDefined(req.criteria, req.Criteria));
  if (criteria) apiParams.Criteria = criteria;
  const logicalExp = toTrimmedString(firstDefined(req.logical_exp, req.logicalExp, req.LogicalExp));
  if (logicalExp) apiParams.LogicalExp = logicalExp;

  const response = await callAction(ctx, 'DescribeContainerInstances', apiParams);
  return {
    items: extractList(response, 'ContainerInstanceList').map(mapContainerInstance),
    total_count: extractTotal(response),
  };
};

const listImageInstances = async (req = {}, ctx = {}) => {
  const apiParams = {
    ...buildPagination(req),
  };
  const criteria = toTrimmedString(firstDefined(req.criteria, req.Criteria));
  if (criteria) apiParams.Criteria = criteria;
  const logicalExp = toTrimmedString(firstDefined(req.logical_exp, req.logicalExp, req.LogicalExp));
  if (logicalExp) apiParams.LogicalExp = logicalExp;

  const response = await callAction(ctx, 'DescribeImageInstances', apiParams);
  return {
    items: extractList(response, 'ImageInstanceList').map(mapImageInstance),
    total_count: extractTotal(response),
  };
};

const listImageVulnerabilities = async (req = {}, ctx = {}) => {
  const imageUuid = toTrimmedString(firstDefined(req.image_uuid, req.imageUuid, req.ImageUuid));
  if (!imageUuid) {
    throw errorWithCode('INVALID_ARGUMENT', 'image_uuid is required');
  }
  const apiParams = {
    ImageUuid: imageUuid,
    ...buildPagination(req),
  };
  const name = toTrimmedString(firstDefined(req.name, req.Name));
  if (name) apiParams.Name = name;
  const level = toTrimmedString(firstDefined(req.level, req.Level));
  if (level) apiParams.Level = level;
  const vulType = toTrimmedString(firstDefined(req.vul_type, req.vulType, req.VulType));
  if (vulType) apiParams.VulType = vulType;

  const response = await callAction(ctx, 'DescribeImageVulList', apiParams);
  return {
    items: extractList(response, 'VulRecordList').map(mapImageVulnerability),
    total_count: extractTotal(response),
  };
};

const getClusterSuspEventStatistics = async (req = {}, ctx = {}) => {
  const response = await callAction(ctx, 'GetClusterSuspEventStatistics', {});
  return {
    statistics: toValue(response?.ClusterSuspEventStatistics ?? response?.data ?? response),
  };
};

const listClusterInterceptionConfig = async (req = {}, ctx = {}) => {
  const apiParams = {
    ...buildPagination(req),
  };
  const clusterId = toTrimmedString(firstDefined(req.cluster_id, req.clusterId, req.ClusterId));
  if (clusterId) apiParams.ClusterId = clusterId;

  const response = await callAction(ctx, 'ListClusterInterceptionConfig', apiParams);
  return {
    items: extractList(response, 'ClusterConfigList').map(mapClusterInterceptionConfig),
    total_count: extractTotal(response),
  };
};

// ── rpcdef (filter-style handler) ──────────────────────────

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [LIST_CONTAINER_INSTANCES_PATH]: async (req) => listContainerInstances(req ?? callCtx.req, callCtx),
    [LIST_IMAGE_INSTANCES_PATH]: async (req) => listImageInstances(req ?? callCtx.req, callCtx),
    [LIST_IMAGE_VULNS_PATH]: async (req) => listImageVulnerabilities(req ?? callCtx.req, callCtx),
    [GET_CLUSTER_SUSP_EVENT_STATS_PATH]: async (req) => getClusterSuspEventStatistics(req ?? callCtx.req, callCtx),
    [LIST_CLUSTER_INTERCEPTION_CONFIG_PATH]: async (req) => listClusterInterceptionConfig(req ?? callCtx.req, callCtx),
  };
}

// ── SDK handlers (two-arg style) ───────────────────────────

export const handlers = {
  [LIST_CONTAINER_INSTANCES_FULL]: (req, ctx = {}) => listContainerInstances(req, ctx),
  [LIST_IMAGE_INSTANCES_FULL]: (req, ctx = {}) => listImageInstances(req, ctx),
  [LIST_IMAGE_VULNS_FULL]: (req, ctx = {}) => listImageVulnerabilities(req, ctx),
  [GET_CLUSTER_SUSP_EVENT_STATS_FULL]: (req, ctx = {}) => getClusterSuspEventStatistics(req, ctx),
  [LIST_CLUSTER_INTERCEPTION_CONFIG_FULL]: (req, ctx = {}) => listClusterInterceptionConfig(req, ctx),
};

// ── Test exports ───────────────────────────────────────────

export const _test = {
  percentEncode,
  signRpc,
  buildCommonParams,
  callAction,
  errorWithCode,
  firstDefined,
  hasOwn,
  logFlow,
  mergedBindings,
  resolveCallContext,
  resolveCredentials,
  resolveRegion,
  resolveEndpoint,
  resolveTimeoutMs,
  toBoolean,
  toInt64,
  toTrimmedString,
  toValue,
  buildPagination,
  extractList,
  extractTotal,
  mapContainerInstance,
  mapImageInstance,
  mapImageVulnerability,
  mapClusterInterceptionConfig,
  listContainerInstances,
  listImageInstances,
  listImageVulnerabilities,
  getClusterSuspEventStatistics,
  listClusterInterceptionConfig,
};
