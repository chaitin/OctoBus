import crypto from 'node:crypto';
import {
  GrpcError,
  grpcStatus,
  grpcInvalidArgumentError,
  grpcUnauthenticatedError,
  grpcPermissionDeniedError,
  grpcUnavailableError,
} from '@chaitin-ai/octobus-sdk';

// --------------- Method constants ---------------
const PKG = 'Aliyun_DDoSCOO_20200101';
const SVC = 'DDoSCOOService';
const METHOD = (name) => `${PKG}.${SVC}/${name}`;

const METHOD_DESCRIBE_INSTANCES_PATH = `/${METHOD('DescribeInstances')}`;
const METHOD_DESCRIBE_DOMAIN_RESOURCE_PATH = `/${METHOD('DescribeDomainResource')}`;
const METHOD_DESCRIBE_NETWORK_RULES_PATH = `/${METHOD('DescribeNetworkRules')}`;
const METHOD_DESCRIBE_DDOS_ALL_EVENT_LIST_PATH = `/${METHOD('DescribeDDosAllEventList')}`;
const METHOD_ENABLE_WEB_CC_PATH = `/${METHOD('EnableWebCC')}`;
const METHOD_CONFIG_WEB_CC_TEMPLATE_PATH = `/${METHOD('ConfigWebCCTemplate')}`;

const METHOD_DESCRIBE_INSTANCES_FULL = METHOD('DescribeInstances');
const METHOD_DESCRIBE_DOMAIN_RESOURCE_FULL = METHOD('DescribeDomainResource');
const METHOD_DESCRIBE_NETWORK_RULES_FULL = METHOD('DescribeNetworkRules');
const METHOD_DESCRIBE_DDOS_ALL_EVENT_LIST_FULL = METHOD('DescribeDDosAllEventList');
const METHOD_ENABLE_WEB_CC_FULL = METHOD('EnableWebCC');
const METHOD_CONFIG_WEB_CC_TEMPLATE_FULL = METHOD('ConfigWebCCTemplate');

// --------------- Defaults ---------------
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_REGION = 'cn-hangzhou';

// --------------- Utilities ---------------
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function firstDefined(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

function toTrimmedString(value) {
  if (typeof value === 'string') return value.trim();
  return undefined;
}

// --------------- gRPC error helpers ---------------
const GRPC_CODE_MAP = {
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  NOT_FOUND: grpcStatus.NOT_FOUND,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  INTERNAL: grpcStatus.INTERNAL,
};

function grpcCodeFor(code) {
  return GRPC_CODE_MAP[code] || grpcStatus.INTERNAL;
}

function errorWithCode(code, message) {
  const e = new GrpcError(grpcCodeFor(code), message);
  e.legacyCode = code;
  return e;
}

function throwStructuredError(code, message, options = {}) {
  const payload = { code, message };
  if (hasOwn(options, 'httpStatus')) payload.http_status = options.httpStatus;
  if (hasOwn(options, 'rawBody')) payload.raw_body = options.rawBody;
  if (hasOwn(options, 'rawJson')) payload.raw_json = options.rawJson;
  if (hasOwn(options, 'reason')) payload.reason = options.reason;
  if (hasOwn(options, 'responseCode')) payload.response_code = options.responseCode;
  if (hasOwn(options, 'verboseMsg')) payload.verbose_msg = options.verboseMsg;
  throw errorWithCode(code, JSON.stringify(payload));
}

// --------------- Context resolution ---------------
function resolveRegionId(ctx) {
  const config = ctx.config ?? {};
  return toTrimmedString(config.regionId) || DEFAULT_REGION;
}

function resolveAccessKeyId(ctx) {
  const secret = ctx.secret ?? {};
  const val = toTrimmedString(secret.accessKeyId);
  if (!val) throwStructuredError('INVALID_ARGUMENT', 'accessKeyId is required in secret');
  return val;
}

function resolveAccessKeySecret(ctx) {
  const secret = ctx.secret ?? {};
  const val = toTrimmedString(secret.accessKeySecret);
  if (!val) throwStructuredError('INVALID_ARGUMENT', 'accessKeySecret is required in secret');
  return val;
}

function resolveTimeoutMs(ctx) {
  const config = ctx.config ?? {};
  const ms = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_TIMEOUT_MS;
}

// --------------- Alibaba Cloud OpenAPI signature V1 ---------------

/**
 * Alibaba Cloud percent-encoding.
 * Encodes: ~ (JS doesn't), but leaves * unencoded (JS does).
 */
function aliyunPercentEncode(str) {
  return encodeURIComponent(str)
    .replace(/%7E/g, '~')
    .replace(/\*/g, '%2A')
    .replace(/%20/g, '%20')
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\+/g, '%2B');
}

function randomNonce() {
  return crypto.randomUUID().replace(/-/g, '');
}

function iso8601Timestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}T` +
    `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}Z`
  );
}

function buildSignedParams(action, businessParams, accessKeyId, accessKeySecret) {
  const params = new Map();

  // System params
  params.set('AccessKeyId', accessKeyId);
  params.set('Action', action);
  params.set('Format', 'JSON');
  params.set('SignatureMethod', 'HMAC-SHA1');
  params.set('SignatureNonce', randomNonce());
  params.set('SignatureVersion', '1.0');
  params.set('Timestamp', iso8601Timestamp());
  params.set('Version', '2020-01-01');

  // Business params
  for (const [key, value] of Object.entries(businessParams)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        params.set(`${key}.${i + 1}`, String(item));
      });
    } else {
      params.set(key, String(value));
    }
  }

  // Sort by key
  const sorted = [...params.entries()].sort(([a], [b]) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });

  // Build canonicalized query string for signing
  const canonicalQuery = sorted
    .map(([k, v]) => `${aliyunPercentEncode(k)}=${aliyunPercentEncode(v)}`)
    .join('&');

  const stringToSign = `POST&${aliyunPercentEncode('/')}&${aliyunPercentEncode(canonicalQuery)}`;
  const hmac = crypto.createHmac('sha1', `${accessKeySecret}&`);
  hmac.update(stringToSign);
  const signature = hmac.digest('base64');

  // Add signature to params
  params.set('Signature', signature);

  return params;
}

// --------------- HTTP ---------------

function buildUrl(regionId) {
  return `https://ddoscoo.${regionId}.aliyuncs.com/`;
}

async function callAliyunAPI(ctx, action, businessParams = {}) {
  const regionId = resolveRegionId(ctx);
  const accessKeyId = resolveAccessKeyId(ctx);
  const accessKeySecret = resolveAccessKeySecret(ctx);
  const timeoutMs = resolveTimeoutMs(ctx);

  const baseUrl = buildUrl(regionId);
  const params = buildSignedParams(action, businessParams, accessKeyId, accessKeySecret);
  const body = new URLSearchParams();
  for (const [k, v] of params) {
    body.append(k, v);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let resp;
  try {
    resp = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const cause = err.cause ? String(err.cause) : undefined;
    throwStructuredError('UNAVAILABLE', `Request to Alibaba Cloud failed: ${err.message}`, {
      reason: String(err),
      cause,
    });
  }
  clearTimeout(timer);

  const rawBody = await resp.text();

  if (!resp.ok) {
    mapHttpError(resp.status, rawBody);
  }

  let parsed;
  parsed = tryParseJson(rawBody);
  if (!parsed.ok) {
    throwStructuredError('UNAVAILABLE', 'Alibaba Cloud returned non-JSON response', {
      httpStatus: resp.status,
      rawBody,
    });
  }

  // Check for API-level error in response body
  assertAliyunSuccess(parsed.value, resp.status, rawBody);

  return {
    httpStatus: resp.status,
    rawBody,
    rawJson: toValue(parsed.value),
  };
}

function mapHttpError(statusCode, rawBody) {
  let parsed;
  try { parsed = JSON.parse(rawBody); } catch { parsed = null; }
  const errMsg = parsed?.Message || parsed?.message || `HTTP ${statusCode}`;

  if (statusCode === 401 || statusCode === 403) {
    throwStructuredError('PERMISSION_DENIED', errMsg, {
      httpStatus: statusCode, rawBody,
      rawJson: parsed ? toValue(parsed) : undefined,
    });
  }
  if (statusCode >= 400 && statusCode < 500) {
    throwStructuredError('FAILED_PRECONDITION', errMsg, {
      httpStatus: statusCode, rawBody,
      rawJson: parsed ? toValue(parsed) : undefined,
    });
  }
  throwStructuredError('UNAVAILABLE', errMsg, {
    httpStatus: statusCode, rawBody,
    rawJson: parsed ? toValue(parsed) : undefined,
  });
}

function assertAliyunSuccess(json, statusCode, rawBody) {
  // Some Alibaba Cloud APIs return errors with Code/Message fields
  if (json && (json.Code || json.code)) {
    const code = json.Code || json.code;
    const message = json.Message || json.message || 'Unknown error';
    if (code !== '200' && code !== 'Success' && code !== 'OK') {
      const gcode = mapAliyunErrorCode(code);
      throwStructuredError(gcode, message, {
        httpStatus: statusCode,
        rawBody,
        rawJson: toValue(json),
        responseCode: code,
      });
    }
  }
}

function mapAliyunErrorCode(aliCode) {
  const code = String(aliCode);
  if (code === 'InvalidAccessKeyId.NotFound' || code === 'InvalidAccessKeyId' ||
      code === 'SignatureDoesNotMatch' || code === 'Forbidden.AccessKeyDisabled') {
    return 'UNAUTHENTICATED';
  }
  if (code === 'Forbidden.NotAdminUser' || code === 'Forbidden.AccountInDebt' ||
      code === 'Forbidden.AccountDebtOverdue') {
    return 'PERMISSION_DENIED';
  }
  if (code.includes('InvalidParameter') || code.includes('Invalid') ||
      code.includes('Missing') || code.includes('missing')) {
    return 'INVALID_ARGUMENT';
  }
  if (code.includes('NotFound') || code.includes('notFound') || code.includes('NotExist')) {
    return 'NOT_FOUND';
  }
  if (code.includes('Throttling') || code.includes('LimitExceeded') ||
      code.includes('ServiceUnavailable')) {
    return 'UNAVAILABLE';
  }
  return 'FAILED_PRECONDITION';
}

// --------------- JSON helpers ---------------

function tryParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: undefined };
  }
}

function toValue(value) {
  if (value === null) return { nullValue: 0 };
  if (value === undefined) return { nullValue: 0 };
  const t = typeof value;
  if (t === 'string') return { stringValue: value };
  if (t === 'number') return { numberValue: value };
  if (t === 'boolean') return { boolValue: value };
  if (Array.isArray(value)) {
    return { listValue: { values: value.map(toValue) } };
  }
  if (t === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(value)) {
      fields[k] = toValue(v);
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(value) };
}

export function unwrapScalar(value) {
  if (!value || typeof value !== 'object') return value;
  if (hasOwn(value, 'stringValue')) return value.stringValue;
  if (hasOwn(value, 'numberValue')) return value.numberValue;
  if (hasOwn(value, 'boolValue')) return value.boolValue;
  return value;
}

// --------------- Handlers ---------------

function buildCallHandler(action, reqMapper) {
  return async (req, ctx) => {
    const businessParams = reqMapper ? reqMapper(req) : Object.fromEntries(
      Object.entries(req).filter(([, v]) => v !== undefined && v !== null && v !== '' && (!Array.isArray(v) || v.length > 0))
    );
    return callAliyunAPI(ctx, action, businessParams);
  };
}

// DescribeInstances request mapper
function mapDescribeInstancesReq(req) {
  const params = {};
  if (req.pageNumber) params.PageNumber = req.pageNumber;
  if (req.pageSize) params.PageSize = req.pageSize;
  if (req.instanceIds?.length) params.InstanceIds = req.instanceIds;
  if (req.ip) params.Ip = req.ip;
  if (req.remark) params.Remark = req.remark;
  if (req.status?.length) params.Status = req.status;
  if (req.edition) params.Edition = req.edition;
  if (req.enabled) params.Enabled = req.enabled;
  if (req.expireStartTime) params.ExpireStartTime = req.expireStartTime;
  if (req.expireEndTime) params.ExpireEndTime = req.expireEndTime;
  if (req.resourceGroupId) params.ResourceGroupId = req.resourceGroupId;
  if (req.tagKey) {
    params.Tag = [{ Key: req.tagKey, Value: req.tagValue || '' }];
  }
  return params;
}

// DescribeDomainResource request mapper
function mapDescribeDomainResourceReq(req) {
  const params = {};
  if (req.pageNumber) params.PageNumber = req.pageNumber;
  if (req.pageSize) params.PageSize = req.pageSize;
  if (req.domain) params.Domain = req.domain;
  if (req.instanceIds?.length) params.InstanceIds = req.instanceIds;
  if (req.queryDomainPattern) params.QueryDomainPattern = req.queryDomainPattern;
  if (req.resourceGroupId) params.ResourceGroupId = req.resourceGroupId;
  return params;
}

// DescribeNetworkRules request mapper
function mapDescribeNetworkRulesReq(req) {
  const params = {};
  if (req.pageNumber) params.PageNumber = req.pageNumber;
  if (req.pageSize) params.PageSize = req.pageSize;
  if (req.instanceId) params.InstanceId = req.instanceId;
  if (req.forwardProtocol) params.ForwardProtocol = req.forwardProtocol;
  if (req.frontendPort) params.FrontendPort = req.frontendPort;
  return params;
}

// DescribeDDosAllEventList request mapper
function mapDescribeDDosAllEventListReq(req) {
  const params = {};
  if (req.pageNumber) params.PageNumber = req.pageNumber;
  if (req.pageSize) params.PageSize = req.pageSize;
  if (req.startTime) params.StartTime = req.startTime;
  if (req.endTime) params.EndTime = req.endTime;
  if (req.eventType) params.EventType = req.eventType;
  return params;
}

// EnableWebCC request mapper
function mapEnableWebCCReq(req) {
  const params = { Domain: req.domain };
  if (req.resourceGroupId) params.ResourceGroupId = req.resourceGroupId;
  return params;
}

// ConfigWebCCTemplate request mapper
function mapConfigWebCCTemplateReq(req) {
  const params = { Domain: req.domain, Template: req.template };
  if (req.resourceGroupId) params.ResourceGroupId = req.resourceGroupId;
  return params;
}

// --------------- Handler definitions ---------------

const handleDescribeInstances = buildCallHandler('DescribeInstances', mapDescribeInstancesReq);
const handleDescribeDomainResource = buildCallHandler('DescribeDomainResource', mapDescribeDomainResourceReq);
const handleDescribeNetworkRules = buildCallHandler('DescribeNetworkRules', mapDescribeNetworkRulesReq);
const handleDescribeDDosAllEventList = buildCallHandler('DescribeDDosAllEventList', mapDescribeDDosAllEventListReq);
const handleEnableWebCC = buildCallHandler('EnableWebCC', mapEnableWebCCReq);
const handleConfigWebCCTemplate = buildCallHandler('ConfigWebCCTemplate', mapConfigWebCCTemplateReq);

// --------------- rpcdef (path-based routing for SDK) ---------------

export function rpcdef(ctx) {
  return {
    [METHOD_DESCRIBE_INSTANCES_PATH]: (req) => handleDescribeInstances(req, ctx),
    [METHOD_DESCRIBE_DOMAIN_RESOURCE_PATH]: (req) => handleDescribeDomainResource(req, ctx),
    [METHOD_DESCRIBE_NETWORK_RULES_PATH]: (req) => handleDescribeNetworkRules(req, ctx),
    [METHOD_DESCRIBE_DDOS_ALL_EVENT_LIST_PATH]: (req) => handleDescribeDDosAllEventList(req, ctx),
    [METHOD_ENABLE_WEB_CC_PATH]: (req) => handleEnableWebCC(req, ctx),
    [METHOD_CONFIG_WEB_CC_TEMPLATE_PATH]: (req) => handleConfigWebCCTemplate(req, ctx),
  };
}

// --------------- handlers (for defineService) ---------------

export const handlers = {
  [METHOD_DESCRIBE_INSTANCES_FULL]: handleDescribeInstances,
  [METHOD_DESCRIBE_DOMAIN_RESOURCE_FULL]: handleDescribeDomainResource,
  [METHOD_DESCRIBE_NETWORK_RULES_FULL]: handleDescribeNetworkRules,
  [METHOD_DESCRIBE_DDOS_ALL_EVENT_LIST_FULL]: handleDescribeDDosAllEventList,
  [METHOD_ENABLE_WEB_CC_FULL]: handleEnableWebCC,
  [METHOD_CONFIG_WEB_CC_TEMPLATE_FULL]: handleConfigWebCCTemplate,
};

// --------------- _test export (for unit testing) ---------------

export const _test = {
  // Constants
  METHOD_DESCRIBE_INSTANCES_PATH,
  METHOD_DESCRIBE_DOMAIN_RESOURCE_PATH,
  METHOD_DESCRIBE_NETWORK_RULES_PATH,
  METHOD_DESCRIBE_DDOS_ALL_EVENT_LIST_PATH,
  METHOD_ENABLE_WEB_CC_PATH,
  METHOD_CONFIG_WEB_CC_TEMPLATE_PATH,
  METHOD_DESCRIBE_INSTANCES_FULL,
  METHOD_DESCRIBE_DOMAIN_RESOURCE_FULL,
  METHOD_DESCRIBE_NETWORK_RULES_FULL,
  METHOD_DESCRIBE_DDOS_ALL_EVENT_LIST_FULL,
  METHOD_ENABLE_WEB_CC_FULL,
  METHOD_CONFIG_WEB_CC_TEMPLATE_FULL,

  // Utilities
  hasOwn,
  firstDefined,
  toTrimmedString,
  grpcCodeFor,
  errorWithCode,
  throwStructuredError,
  resolveRegionId,
  resolveAccessKeyId,
  resolveAccessKeySecret,
  resolveTimeoutMs,
  aliyunPercentEncode,
  randomNonce,
  buildSignedParams,
  buildUrl,
  callAliyunAPI,
  mapHttpError,
  assertAliyunSuccess,
  mapAliyunErrorCode,
  tryParseJson,
  toValue,
  unwrapScalar,

  // Mappers
  mapDescribeInstancesReq,
  mapDescribeDomainResourceReq,
  mapDescribeNetworkRulesReq,
  mapDescribeDDosAllEventListReq,
  mapEnableWebCCReq,
  mapConfigWebCCTemplateReq,
};
