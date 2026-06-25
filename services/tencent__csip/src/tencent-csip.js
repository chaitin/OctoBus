import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const SERVICE_PACKAGE = 'Tencent_CSIP.Tencent_CSIP';
export const DEFAULT_ENDPOINT = 'https://csip.tencentcloudapi.com';
export const DEFAULT_VERSION = '2022-11-21';
export const DEFAULT_TIMEOUT_MS = 5000;
export const TENCENT_SERVICE = 'csip';
export const SIGNING_ALGORITHM = 'TC3-HMAC-SHA256';

export const READ_ONLY_ACTIONS = [
  'DescribeAlertList',
  'DescribeCVMAssets',
  'DescribePublicIpAssets',
  'DescribeVpcAssets',
  'DescribeRiskCenterAssetViewVULRiskList',
  'DescribeRiskCenterAssetViewWeakPasswordRiskList',
  'DescribeRiskCenterAssetViewCFGRiskList',
  'DescribeRiskCenterAssetViewPortRiskList',
  'DescribeCSIPRiskStatistics',
  'DescribeAccessKeyRisk',
  'DescribeCosAlarmList',
  'DescribeSkillScanResult',
  'DescribeOrganizationUserInfo',
  'DescribeSubUserInfo',
];

export const METHOD_INVOKE_READ_ONLY_ACTION_FULL = `${SERVICE_PACKAGE}/InvokeReadOnlyAction`;
export const METHOD_INVOKE_READ_ONLY_ACTION_PATH = `/${METHOD_INVOKE_READ_ONLY_ACTION_FULL}`;

const ACTION_METHODS = new Map(READ_ONLY_ACTIONS.map((action) => [`${SERVICE_PACKAGE}/${action}`, action]));

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
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
  if (hasOwn(value, 'listValue') && Array.isArray(value.listValue?.values)) {
    return value.listValue.values.map((item) => normalizeStructValue(item));
  }
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

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
});

const resolveTimeoutMs = (ctx = {}) => optionalUint32(ctx.bindings?.timeoutMs) ?? optionalUint32(ctx.limits?.timeoutMs) ?? DEFAULT_TIMEOUT_MS;

const resolveEndpoint = (bindings = {}) => toTrimmedString(firstDefined(bindings.endpoint, bindings.host, bindings.baseUrl)) || DEFAULT_ENDPOINT;

const validateBindings = (bindings = {}) => {
  const endpoint = resolveEndpoint(bindings);
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw errorWithCode('FAILED_PRECONDITION', 'binding "endpoint" must be a valid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw errorWithCode('FAILED_PRECONDITION', 'binding "endpoint" must use http or https');

  const secretId = toTrimmedString(firstDefined(bindings.secretId, bindings.secret_id));
  const secretKey = toTrimmedString(firstDefined(bindings.secretKey, bindings.secret_key));
  if (!secretId) throw errorWithCode('FAILED_PRECONDITION', 'secret "secretId" is required but not configured');
  if (!secretKey) throw errorWithCode('FAILED_PRECONDITION', 'secret "secretKey" is required but not configured');

  return {
    endpoint: url.toString(),
    host: url.host,
    secretId,
    secretKey,
    token: toTrimmedString(bindings.token),
    region: toTrimmedString(bindings.region),
    version: toTrimmedString(bindings.version) || DEFAULT_VERSION,
  };
};

const hashSHA256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const hmacSHA256 = (key, value, encoding) => crypto.createHmac('sha256', key).update(value).digest(encoding);

const timestampToUTCDate = (timestamp) => {
  const date = new Date(timestamp * 1000);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const signRequest = ({ payloadText, host, action, version, region, secretId, secretKey, token, timestamp }) => {
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const hashedRequestPayload = hashSHA256(payloadText);
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    hashedRequestPayload,
  ].join('\n');

  const date = timestampToUTCDate(timestamp);
  const credentialScope = `${date}/${TENCENT_SERVICE}/tc3_request`;
  const stringToSign = [
    SIGNING_ALGORITHM,
    String(timestamp),
    credentialScope,
    hashSHA256(canonicalRequest),
  ].join('\n');

  const secretDate = hmacSHA256(`TC3${secretKey}`, date);
  const secretService = hmacSHA256(secretDate, TENCENT_SERVICE);
  const secretSigning = hmacSHA256(secretService, 'tc3_request');
  const signature = hmacSHA256(secretSigning, stringToSign, 'hex');
  const authorization = `${SIGNING_ALGORITHM} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    Host: host,
    Authorization: authorization,
    'X-TC-Action': action,
    'X-TC-Version': version,
    'X-TC-Timestamp': String(timestamp),
  };
  if (region) headers['X-TC-Region'] = region;
  if (token) headers['X-TC-Token'] = token;

  return {
    headers,
    canonicalRequest,
    stringToSign,
    signature,
  };
};

const buildHeaders = (ctx, signedHeaders) => ({
  ...(ctx.bindings?.headers && typeof ctx.bindings.headers === 'object' ? ctx.bindings.headers : {}),
  ...signedHeaders,
});

const safeErrorBody = (body) => {
  if (!body || typeof body !== 'object') return body;
  const cloned = { ...body };
  if (cloned.Authorization) cloned.Authorization = '[REDACTED]';
  return cloned;
};

const errorFromTencentResponse = (response) => {
  const err = response?.Error;
  if (!err) return null;
  const code = String(err.Code || '');
  if (/Unauthorized|AuthFailure|UnsupportedOperation/.test(code)) return errorWithCode('PERMISSION_DENIED', `${code}: ${err.Message || 'Tencent Cloud API denied the request'}`);
  if (/InvalidParameter|MissingParameter|InvalidAction/.test(code)) return errorWithCode('INVALID_ARGUMENT', `${code}: ${err.Message || 'Tencent Cloud API rejected the request'}`);
  return errorWithCode('UNKNOWN', `${code || 'TencentCloudError'}: ${err.Message || 'Tencent Cloud API returned an error'}`);
};

const parseTencentResponse = async (res) => {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', `Tencent Cloud API returned non-JSON response: ${text.slice(0, 200)}`);
  }
};

const validateReadOnlyAction = (action) => {
  const value = toTrimmedString(action);
  if (!value) throw errorWithCode('INVALID_ARGUMENT', 'action must be a non-empty string');
  if (!/^Describe[A-Za-z0-9]+$/.test(value)) {
    throw errorWithCode('INVALID_ARGUMENT', 'only Tencent Cloud CSIP Describe* actions are allowed');
  }
  return value;
};

const payloadFromRequest = (req = {}) => normalizeStruct(req.payload ?? {});

const invokeTencentCloud = async (action, payload, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const bindings = validateBindings(callCtx.bindings);
  const payloadText = JSON.stringify(payload ?? {});
  const timestamp = optionalUint32(callCtx.meta?.timestamp) ?? Math.floor(Date.now() / 1000);
  const signed = signRequest({ ...bindings, action, payloadText, timestamp });
  const headers = buildHeaders(callCtx, signed.headers);
  let res;
  try {
    res = await fetch(bindings.endpoint, {
      method: 'POST',
      headers,
      body: payloadText,
      timeoutMs: resolveTimeoutMs(callCtx),
    });
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', `failed to call Tencent Cloud CSIP API: ${err.message}`);
  }

  const body = await parseTencentResponse(res);
  if (res.status < 200 || res.status >= 300) {
    throw errorWithCode('UNAVAILABLE', `Tencent Cloud CSIP API HTTP ${res.status}: ${JSON.stringify(safeErrorBody(body)).slice(0, 500)}`);
  }
  const response = body.Response ?? body;
  const tencentError = errorFromTencentResponse(response);
  if (tencentError) throw tencentError;
  return { response: toValue(response) };
};

const buildActionHandler = (action) => async (req = {}, ctx = {}) => invokeTencentCloud(action, payloadFromRequest(req), ctx);

export const handlers = Object.fromEntries([
  ...READ_ONLY_ACTIONS.map((action) => [`${SERVICE_PACKAGE}/${action}`, buildActionHandler(action)]),
  [METHOD_INVOKE_READ_ONLY_ACTION_FULL, async (req = {}, ctx = {}) => invokeTencentCloud(validateReadOnlyAction(req.action), normalizeStruct(req.payload ?? {}), ctx)],
]);

export const rpcdef = () => Object.fromEntries([
  ...READ_ONLY_ACTIONS.map((action) => [`/${SERVICE_PACKAGE}/${action}`, handlers[`${SERVICE_PACKAGE}/${action}`]]),
  [METHOD_INVOKE_READ_ONLY_ACTION_PATH, handlers[METHOD_INVOKE_READ_ONLY_ACTION_FULL]],
]);

export const _test = {
  normalizeStruct,
  normalizeStructValue,
  toValue,
  validateBindings,
  validateReadOnlyAction,
  signRequest,
  invokeTencentCloud,
};
