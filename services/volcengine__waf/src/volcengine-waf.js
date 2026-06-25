import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const SERVICE_PACKAGE = 'Volcengine_WAF.Volcengine_WAF';
export const DEFAULT_REGION = 'cn-beijing';
export const DEFAULT_TIMEOUT_MS = 5000;
export const SIGNING_ALGORITHM = 'HMAC-SHA256';
export const SIGNING_TERMINATOR = 'request';

export const SERVICE_DEFINITIONS = {
  waf: {
    defaultVersion: '2023-12-25',
    endpoint: () => 'https://waf.volcengineapi.com',
  },
};

export const READ_ONLY_ACTIONS = [
  { methodName: 'ListDomain', action: 'ListDomain' },
  { methodName: 'ListLoadBalancer', action: 'ListLoadBalancer' },
  { methodName: 'QueryAttackAnalysisTermsAggLb', action: 'QueryAttackAnalysisTermsAggLb' },
  { methodName: 'QueryAttackAnalysisWithRuleAggLb', action: 'QueryAttackAnalysisWithRuleAggLb' },
  { methodName: 'QueryAttackSecurityEvent', action: 'QueryAttackSecurityEvent' },
  { methodName: 'QueryFlowOverviewLb', action: 'QueryFlowOverviewLb' },
  { methodName: 'QueryProtectionOverviewLb', action: 'QueryProtectionOverviewLb' },
  { methodName: 'GetReqQPSAnalysis', action: 'GetReqQPSAnalysis' },
  { methodName: 'ListAclRule', action: 'ListAclRule' },
  { methodName: 'ListCustomPage', action: 'ListCustomPage' },
  { methodName: 'ListAreaBlockRule', action: 'ListAreaBlockRule' },
  { methodName: 'GetAreaBlockInfo', action: 'GetAreaBlockInfo' },
  { methodName: 'ListCCRule', action: 'ListCCRule' },
  { methodName: 'ListCCRulePriorityAvailable', action: 'ListCCRulePriorityAvailable' },
  { methodName: 'GetSmartCCConfig', action: 'GetSmartCCConfig' },
  { methodName: 'ListVulnerabilityRule', action: 'ListVulnerabilityRule' },
  { methodName: 'GetVulnerabilityConfig', action: 'GetVulnerabilityConfig' },
  { methodName: 'ListVulWhiteField', action: 'ListVulWhiteField' },
  { methodName: 'ListCustomBotConfig', action: 'ListCustomBotConfig' },
  { methodName: 'ListBotAnalyseProtectRule', action: 'ListBotAnalyseProtectRule' },
  { methodName: 'ListBotAnalyseProtectRulePriorityAvailable', action: 'ListBotAnalyseProtectRulePriorityAvailable' },
  { methodName: 'GetDynamicTokenConfig', action: 'GetDynamicTokenConfig' },
  { methodName: 'ListProhibition', action: 'ListProhibition' },
  { methodName: 'GetTLSConfig', action: 'GetTLSConfig' },
  { methodName: 'SearchLogs', action: 'SearchLogs' },
  { methodName: 'ListWafServiceCertificate', action: 'ListWafServiceCertificate' },
  { methodName: 'ListAllIpGroups', action: 'ListAllIpGroups' },
  { methodName: 'ListIpGroup', action: 'ListIpGroup' },
  { methodName: 'ListHostGroup', action: 'ListHostGroup' },
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
  .replace(/[^A-Za-z0-9_.~\-%]+/g, escape)
  .replace(/[*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);

const queryParamsToString = (params = {}) => Object.keys(params)
  .filter((key) => params[key] !== undefined && params[key] !== null)
  .sort()
  .flatMap((key) => {
    const escapedKey = uriEscape(key);
    const value = params[key];
    if (Array.isArray(value)) return value.map((item) => `${escapedKey}=${uriEscape(item)}`).sort();
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
    'Content-Type': 'application/json',
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
  if (!service) throw errorWithCode('INVALID_ARGUMENT', `unsupported Volcengine WAF service_code "${serviceCode}"`);
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
  if (!/^(Get|Desc|Describe|List|Query|Search)[A-Za-z0-9]+$/.test(value)) {
    throw errorWithCode('INVALID_ARGUMENT', 'only Volcengine WAF read-only Get*, Desc*, Describe*, List*, Query*, and Search* actions are allowed');
  }
  return value;
};

const validateMethod = (method) => {
  const value = (toTrimmedString(method) || 'POST').toUpperCase();
  if (!['GET', 'POST'].includes(value)) throw errorWithCode('INVALID_ARGUMENT', 'method must be GET or POST');
  return value;
};

const validateActionSpec = (spec = {}) => {
  const serviceCode = toTrimmedString(firstDefined(spec.serviceCode, spec.service_code)) || 'waf';
  const service = SERVICE_DEFINITIONS[serviceCode];
  if (!service) throw errorWithCode('INVALID_ARGUMENT', `unsupported Volcengine WAF service_code "${serviceCode}"`);
  const action = validateActionName(spec.action);
  const version = toTrimmedString(spec.version) || service.defaultVersion;
  const method = validateMethod(firstDefined(spec.httpMethod, spec.method));
  return { action, serviceCode, version, httpMethod: method, endpoint: toTrimmedString(spec.endpoint) };
};

const buildHeaders = (ctx, signedHeaders) => ({
  ...(ctx.bindings?.headers && typeof ctx.bindings.headers === 'object' ? ctx.bindings.headers : {}),
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
  let res;
  try {
    res = await fetch(endpoint.toString(), {
      method: actionSpec.httpMethod,
      headers,
      body: actionSpec.httpMethod === 'GET' ? undefined : bodyText,
      timeoutMs: resolveTimeoutMs(callCtx),
    });
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', `failed to call Volcengine WAF API: ${err.message}`);
  }

  const body = await parseVolcengineResponse(res);
  if (res.status < 200 || res.status >= 300) {
    throw errorWithCode('UNAVAILABLE', `Volcengine WAF API HTTP ${res.status}: ${JSON.stringify(body).slice(0, 500)}`);
  }
  const volcError = errorFromVolcengineResponse(body);
  if (volcError) throw volcError;
  return { response: toValue(body) };
};

const buildActionHandler = (spec) => async (req = {}, ctx = {}) => invokeVolcengine(spec, payloadFromRequest(req), ctx);

export const handlers = Object.fromEntries([
  ...READ_ONLY_ACTIONS.map((entry) => [`${SERVICE_PACKAGE}/${entry.methodName}`, buildActionHandler(entry)]),
  [METHOD_INVOKE_READ_ONLY_ACTION_FULL, async (req = {}, ctx = {}) => invokeVolcengine({
    action: req.action,
    serviceCode: req.service_code || req.serviceCode,
    version: req.version,
    method: req.method,
    endpoint: req.endpoint,
  }, normalizeStruct(req.payload ?? {}), ctx)],
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
