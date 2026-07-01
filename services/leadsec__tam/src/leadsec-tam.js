import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const METHOD_ADD_BLACKLIST_FULL = 'Leadsec_TAM.LeadsecTAMService/AddBlacklist';
export const METHOD_ADD_WHITELIST_FULL = 'Leadsec_TAM.LeadsecTAMService/AddWhitelist';

export const LOGIN_PATH = '/cnddos/v2.0/api/web_login/ddos';
export const ADD_PATH = '/cnddos/v2.0/api/ip_bwlist/info';
export const VERIFY_PATH = '/cnddos/v2.0/api/ip_bwlist/page_list';
export const LIST_TYPE_BLACK = 100;
export const LIST_TYPE_WHITE = 200;
export const IP_DIRECTION_ENABLED = 1;
export const RESULT_ALREADY_EXISTS = '-391201';
export const DEFAULT_TIMEOUT_MS = 8000;
export const DEFAULT_LANGUAGE = 'zh-cn';
export const DEFAULT_REMARK = 'OctoBus';

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message, details) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  if (details !== undefined) err.details = details;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object') {
    if (hasOwn(value, 'value')) return unwrapScalar(value.value);
    if (hasOwn(value, 'stringValue')) return unwrapScalar(value.stringValue);
    if (hasOwn(value, 'numberValue')) return unwrapScalar(value.numberValue);
    if (hasOwn(value, 'boolValue')) return unwrapScalar(value.boolValue);
  }
  return value;
};

const pickString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return undefined;
};

const pickFirstString = (values) => {
  for (const value of values) {
    const str = pickString(value);
    if (str !== undefined && str.trim()) return str.trim();
  }
  return undefined;
};

const pickBoolean = (value) => {
  const raw = unwrapScalar(value);
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) return false;
  }
  return undefined;
};

const optionalPositiveInt = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = Number(raw);
  return Number.isInteger(num) && num > 0 ? num : undefined;
};

const toArray = (value) => {
  const raw = unwrapScalar(value);
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(raw.values)) return raw.values;
  return undefined;
};

const safeJSONStringify = (value) => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const redactedBodySummary = (text = '') => String(text)
  .replace(/(authorization|token|cookie|password|userpwd)\s*[:=]\s*["']?[^"'\s;&<>]+/gi, '$1=<redacted>')
  .slice(0, 200);

const normalizeBaseUrl = (value) => {
  const baseUrl = pickFirstString([value]);
  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) return '';
  return baseUrl.replace(/\/+$/, '');
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
  req: ctx.req ?? ctx.request ?? {},
});

const buildEnv = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings || {};
  const baseUrl = normalizeBaseUrl(pickFirstString([bindings.baseUrl, bindings.restBaseUrl, bindings.host]));
  if (!baseUrl) throw errorWithCode('FAILED_PRECONDITION', 'bindings.baseUrl must be a valid http(s) URL');
  const username = pickFirstString([bindings.username, bindings.user]);
  const password = pickFirstString([bindings.password, bindings.pass]);
  if (!username || !password) throw errorWithCode('FAILED_PRECONDITION', 'bindings.username and bindings.password are required');
  return {
    baseUrl,
    username,
    password,
    language: pickFirstString([bindings.language]) || DEFAULT_LANGUAGE,
    remark: pickFirstString([bindings.remark]) || DEFAULT_REMARK,
    timeoutMs: optionalPositiveInt(bindings.timeoutMs) ?? optionalPositiveInt(callCtx.limits.timeoutMs) ?? DEFAULT_TIMEOUT_MS,
    skipTlsVerify: pickBoolean(bindings.skipTlsVerify) ?? pickBoolean(bindings.tlsInsecureSkipVerify) ?? false,
    meta: callCtx.meta,
  };
};

const isIPv4OrCidr = (value) => {
  const text = String(value ?? '').trim();
  const [ip, mask] = text.split('/');
  if (mask !== undefined) {
    if (!/^\d+$/.test(mask)) return false;
    const maskNum = Number(mask);
    if (maskNum < 0 || maskNum > 32) return false;
  }
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
};

const ensureIpList = (req = {}) => {
  const source = req.ip_list ?? req.ipList ?? req.ips ?? req.targets;
  const arr = toArray(source);
  if (!arr) throw errorWithCode('INVALID_ARGUMENT', 'ip_list is required and must be an array');
  const ips = arr.map((item) => pickString(item)?.trim() || '').filter(Boolean);
  if (ips.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'ip_list must contain at least one IP address');
  const invalid = ips.filter((ip) => !isIPv4OrCidr(ip));
  if (invalid.length) throw errorWithCode('INVALID_ARGUMENT', `invalid IPv4/CIDR values: ${invalid.join(', ')}`);
  return [...new Set(ips)];
};

const extractRequestId = (req = {}) => pickFirstString([req.request_id, req.requestId]) || '';

const makeFetchInit = (env, { method, token, body, headers = {} }) => {
  const init = {
    method,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    signal: AbortSignal.timeout(env.timeoutMs),
  };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  if (env.skipTlsVerify) {
    init.insecureSkipVerify = true;
    init.tlsInsecureSkipVerify = true;
  }
  return init;
};

const parseBody = (text) => {
  if (!String(text || '').trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const requestDevice = async (env, path, init, action) => {
  let response;
  try {
    response = await fetch(`${env.baseUrl}${path}`, init);
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', `${action} failed: ${err?.cause?.message || err?.message || 'fetch failed'}`);
  }
  const text = await response.text();
  const json = parseBody(text);
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403 ? 'PERMISSION_DENIED' : 'FAILED_PRECONDITION';
    throw errorWithCode(code, `${action} upstream http ${response.status}: ${redactedBodySummary(text)}`, { status: response.status, body: json });
  }
  return { status: response.status, text, json };
};

const businessOK = (json = {}) => {
  const result = json.result ?? json.code;
  return result === undefined || result === 0 || result === '0';
};

const extractBusinessMessage = (json = {}) => {
  const message = json.message;
  if (message === undefined || message === null) return '';
  if (typeof message === 'string') return message;
  return safeJSONStringify(message);
};

const login = async (env) => {
  const body = {
    language: env.language,
    username: Buffer.from(env.username).toString('base64'),
    userpwd: Buffer.from(env.password).toString('base64'),
    captchaId: '',
    vrifyValue: '',
    customize_time_out: '',
  };
  const result = await requestDevice(env, LOGIN_PATH, makeFetchInit(env, {
    method: 'POST',
    headers: { HTTP_SIGN: 'PAGE' },
    body,
  }), 'login');
  if (!businessOK(result.json)) throw errorWithCode('PERMISSION_DENIED', `login failed: ${extractBusinessMessage(result.json)}`, result.json);
  const token = pickFirstString([result.json?.message?.token, result.json?.data?.access_token, result.json?.token]);
  if (!token) throw errorWithCode('PERMISSION_DENIED', 'login response does not contain token', result.json);
  return token;
};

const addIpList = async (env, token, listType, ips, remark) => {
  const body = {
    ipadd: ips,
    ipdirection: IP_DIRECTION_ENABLED,
    ipstate: listType,
    remark,
  };
  const result = await requestDevice(env, ADD_PATH, makeFetchInit(env, {
    method: 'POST',
    token,
    body,
  }), 'add ip list');
  const businessResult = String(result.json?.result ?? result.json?.code ?? '');
  if (!businessOK(result.json) && businessResult !== RESULT_ALREADY_EXISTS) {
    throw errorWithCode('FAILED_PRECONDITION', `add ip list failed: ${extractBusinessMessage(result.json)}`, result.json);
  }
  return result;
};

const buildVerifyPath = (listType, ip) => `${VERIFY_PATH}?pagenum=1&pagesize=100&ordercolumn=ipadd&ordermode=asc&listtype=${listType}&condition=${encodeURIComponent(ip)}`;

const extractItems = (json = {}) => {
  const message = json.message;
  if (Array.isArray(message)) return message;
  if (Array.isArray(json.data)) return json.data;
  if (Array.isArray(json.data?.items)) return json.data.items;
  if (Array.isArray(json.items)) return json.items;
  return [];
};

const verifyIpList = async (env, token, listType, ips) => {
  const verified = new Set();
  let lastResult = null;
  for (const ip of ips) {
    const result = await requestDevice(env, buildVerifyPath(listType, ip), makeFetchInit(env, {
      method: 'GET',
      token,
    }), 'verify ip list');
    lastResult = result;
    for (const item of extractItems(result.json)) {
      const itemIp = pickFirstString([item.ipadd, item.ip, item.ipaddr]);
      if (itemIp === ip) verified.add(ip);
    }
  }
  return {
    verifiedIps: ips.filter((ip) => verified.has(ip)),
    raw: lastResult,
  };
};

const runAdd = async (ctx, listType) => {
  const callCtx = resolveCallContext(ctx);
  const env = buildEnv(callCtx);
  const ips = ensureIpList(callCtx.req);
  const remark = pickFirstString([callCtx.req?.remark]) || env.remark;
  const requestId = extractRequestId(callCtx.req);
  const token = await login(env);
  const addResult = await addIpList(env, token, listType, ips, remark);
  const verifyResult = await verifyIpList(env, token, listType, ips);
  const ok = verifyResult.verifiedIps.length === ips.length;
  if (!ok) {
    throw errorWithCode('FAILED_PRECONDITION', 'not all IP addresses were verified after add', {
      requested: ips,
      verified: verifyResult.verifiedIps,
      addResponse: addResult.json,
      verifyResponse: verifyResult.raw?.json,
    });
  }
  return {
    status: 'OPERATION_STATUS_SUCCESS',
    requested_ip_count: ips.length,
    requestedIpCount: ips.length,
    verified_ip_count: verifyResult.verifiedIps.length,
    verifiedIpCount: verifyResult.verifiedIps.length,
    upstream_result: String(addResult.json?.result ?? addResult.json?.code ?? ''),
    upstreamResult: String(addResult.json?.result ?? addResult.json?.code ?? ''),
    upstream_message: extractBusinessMessage(addResult.json),
    upstreamMessage: extractBusinessMessage(addResult.json),
    verified_ips: verifyResult.verifiedIps,
    verifiedIps: verifyResult.verifiedIps,
    request_id: requestId,
    requestId,
    raw_add_response: addResult.text,
    rawAddResponse: addResult.text,
    raw_verify_response: verifyResult.raw?.text || '',
    rawVerifyResponse: verifyResult.raw?.text || '',
  };
};

export const handlers = {
  [METHOD_ADD_BLACKLIST_FULL]: (ctx) => runAdd(ctx, LIST_TYPE_BLACK),
  [METHOD_ADD_WHITELIST_FULL]: (ctx) => runAdd(ctx, LIST_TYPE_WHITE),
  AddBlacklist: (ctx) => runAdd(ctx, LIST_TYPE_BLACK),
  AddWhitelist: (ctx) => runAdd(ctx, LIST_TYPE_WHITE),
};
