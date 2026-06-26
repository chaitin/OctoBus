import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const SERVICE_PACKAGE = 'Volcengine_DDoS.Volcengine_DDoS';
export const DEFAULT_REGION = 'cn-beijing';
export const DEFAULT_TIMEOUT_MS = 5000;
export const SIGNING_ALGORITHM = 'HMAC-SHA256';
export const SIGNING_TERMINATOR = 'request';

export const SERVICE_DEFINITIONS = {
  ddos: {
    defaultVersion: '2020-12-08',
    endpoint: (region) => `https://ddos.${region}.volcengineapi.com`,
  },
  AdvDefence: {
    defaultVersion: '2021-06-15',
    endpoint: () => 'https://advdefence.volcengineapi.com',
  },
  'origin-defence': {
    defaultVersion: '2022-01-01',
    endpoint: (region) => `https://origin-defence.${region}.volcengineapi.com`,
  },
};

export const READ_ONLY_ACTIONS = [
  { methodName: 'GetBasicAlarm', action: 'GetAlarm', serviceCode: 'ddos', version: '2020-12-08', httpMethod: 'POST' },
  { methodName: 'AdvDefenceDescInstanceList', action: 'DescInstanceList', serviceCode: 'AdvDefence', version: '2021-06-15', httpMethod: 'GET' },
  { methodName: 'AdvDefenceDescInstance', action: 'DescInstance', serviceCode: 'AdvDefence', version: '2021-06-15', httpMethod: 'GET' },
  { methodName: 'AdvDefenceDescFwdRule', action: 'DescFwdRule', serviceCode: 'AdvDefence', version: '2021-06-15', httpMethod: 'GET' },
  { methodName: 'AdvDefenceGetFwdRuleLipList', action: 'GetFwdRuleLipList', serviceCode: 'AdvDefence', version: '2021-06-15', httpMethod: 'GET' },
  { methodName: 'AdvDefenceDescHostRules', action: 'DescHostRules', serviceCode: 'AdvDefence', version: '2021-06-15', httpMethod: 'GET' },
  { methodName: 'AdvDefenceDescCertificate', action: 'DescCertificate', serviceCode: 'AdvDefence', version: '2021-06-15', httpMethod: 'GET' },
  { methodName: 'AdvDefenceDescAttackEvent', action: 'DescAttackEvent', serviceCode: 'AdvDefence', version: '2021-06-15', httpMethod: 'POST' },
  { methodName: 'AdvDefenceDescAttackFlow', action: 'DescAttackFlow', serviceCode: 'AdvDefence', version: '2021-06-15', httpMethod: 'POST' },
  { methodName: 'AdvDefenceDescAttackSrcIpTop100', action: 'DescAttackSrcIpTop100', serviceCode: 'AdvDefence', version: '2021-06-15', httpMethod: 'POST' },
  { methodName: 'AdvDefenceDescAttackSrcRegionTop100', action: 'DescAttackSrcRegionTop100', serviceCode: 'AdvDefence', version: '2021-06-15', httpMethod: 'POST' },
  { methodName: 'AdvDefenceDescAttackTypeTop100', action: 'DescAttackTypeTop100', serviceCode: 'AdvDefence', version: '2021-06-15', httpMethod: 'POST' },
  { methodName: 'AdvDefenceDescAttackDstPortTop100', action: 'DescAttackDstPortTop100', serviceCode: 'AdvDefence', version: '2021-06-15', httpMethod: 'POST' },
  { methodName: 'AdvDefenceDescAtkAlarmThreshold', action: 'DescAtkAlarmThreshold', serviceCode: 'AdvDefence', version: '2021-06-15', httpMethod: 'POST' },
  { methodName: 'AdvDefenceDescWebDefCcRule', action: 'DescWebDefCcRule', serviceCode: 'AdvDefence', version: '2021-06-15', httpMethod: 'POST' },
  { methodName: 'AdvDefenceGetHostDefStatus', action: 'GetHostDefStatus', serviceCode: 'AdvDefence', version: '2021-06-15', httpMethod: 'POST' },
  { methodName: 'AdvDefenceGetWebDefAttackLog', action: 'GetWebDefAttackLog', serviceCode: 'AdvDefence', version: '2021-06-15', httpMethod: 'POST' },
  { methodName: 'OriginDefenceDescInstanceList', action: 'DescInstanceList', serviceCode: 'origin-defence', version: '2022-01-01', httpMethod: 'GET' },
  { methodName: 'OriginDefenceDescInstance', action: 'DescInstance', serviceCode: 'origin-defence', version: '2022-01-01', httpMethod: 'GET' },
  { methodName: 'OriginDefenceDescFreeEipList', action: 'DescFreeEipList', serviceCode: 'origin-defence', version: '2022-01-01', httpMethod: 'GET' },
  { methodName: 'OriginDefenceDescResourceList', action: 'DescResourceList', serviceCode: 'origin-defence', version: '2022-01-01', httpMethod: 'GET' },
  { methodName: 'OriginDefenceDescAttackEvent', action: 'DescAttackEvent', serviceCode: 'origin-defence', version: '2022-01-01', httpMethod: 'POST' },
  { methodName: 'OriginDefenceDescAttackFlow', action: 'DescAttackFlow', serviceCode: 'origin-defence', version: '2022-01-01', httpMethod: 'GET' },
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
  if (!service) throw errorWithCode('INVALID_ARGUMENT', `unsupported Volcengine DDoS service_code "${serviceCode}"`);
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
  if (!/^(Get|Desc|Describe|List|Query)[A-Za-z0-9]+$/.test(value)) {
    throw errorWithCode('INVALID_ARGUMENT', 'only Volcengine DDoS read-only Get*, Desc*, Describe*, List*, and Query* actions are allowed');
  }
  return value;
};

const validateMethod = (method) => {
  const value = (toTrimmedString(method) || 'POST').toUpperCase();
  if (!['GET', 'POST'].includes(value)) throw errorWithCode('INVALID_ARGUMENT', 'method must be GET or POST');
  return value;
};

const validateActionSpec = (spec = {}) => {
  const serviceCode = toTrimmedString(firstDefined(spec.serviceCode, spec.service_code)) || 'ddos';
  const service = SERVICE_DEFINITIONS[serviceCode];
  if (!service) throw errorWithCode('INVALID_ARGUMENT', `unsupported Volcengine DDoS service_code "${serviceCode}"`);
  const action = validateActionName(spec.action);
  const version = toTrimmedString(spec.version) || service.defaultVersion;
  const method = validateMethod(firstDefined(spec.httpMethod, spec.method));
  return { action, serviceCode, version, httpMethod: method, endpoint: toTrimmedString(spec.endpoint) };
};

const buildHeaders = (ctx, signedHeaders) => ({
  ...(ctx.bindings?.headers && typeof ctx.bindings.headers === 'object' ? ctx.bindings.headers : {}),
  'Content-Type': 'application/json',
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
      throw errorWithCode('DEADLINE_EXCEEDED', `Volcengine DDoS API request timed out after ${timeoutMs}ms`);
    }
    throw errorWithCode('UNAVAILABLE', `failed to call Volcengine DDoS API: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }
  if (res.status < 200 || res.status >= 300) {
    throw errorWithCode('UNAVAILABLE', `Volcengine DDoS API HTTP ${res.status}: ${JSON.stringify(body).slice(0, 500)}`);
  }
  const volcError = errorFromVolcengineResponse(body);
  if (volcError) throw volcError;
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
