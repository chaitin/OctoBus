import {
  GrpcError,
  createTlsDispatcher,
  fetchWithTimeout,
  grpcStatus,
  readResponseJson,
} from '@chaitin-ai/octobus-sdk';

export const METHOD_ADD_BLACKLIST_FULL = 'Leadsec_TAM.LeadsecTAMService/AddBlacklist';
export const METHOD_ADD_WHITELIST_FULL = 'Leadsec_TAM.LeadsecTAMService/AddWhitelist';

export const LOGIN_PATH = '/cnddos/v2.0/api/web_login/ddos';
export const ADD_PATH = '/cnddos/v2.0/api/ip_bwlist/info';
export const VERIFY_PATH = '/cnddos/v2.0/api/ip_bwlist/page_list';
export const LIST_TYPE_BLACK = 100;
export const LIST_TYPE_WHITE = 200;
export const RESULT_ALREADY_EXISTS = '-391201';
export const DEFAULT_TIMEOUT_MS = 8000;

const codeFor = (name) => grpcStatus[name] ?? grpcStatus.UNKNOWN;

const failure = (name, message, details) => {
  const error = new GrpcError(codeFor(name), `${name}: ${message}`);
  if (details !== undefined) error.details = details;
  return error;
};

const nonEmptyString = (value) => typeof value === 'string' && value.trim() ? value.trim() : undefined;

const contextBindings = (ctx = {}) => ({
  ...(ctx.config ?? {}),
  ...(ctx.secret ?? {}),
  ...(ctx.bindings ?? {}),
});

const normalizeBaseUrl = (value) => {
  const text = nonEmptyString(value);
  if (!text) return '';
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
};

const buildEnvironment = (ctx) => {
  const bindings = contextBindings(ctx);
  const baseUrl = normalizeBaseUrl(bindings.baseUrl);
  const username = nonEmptyString(bindings.username);
  const password = nonEmptyString(bindings.password);
  if (!baseUrl) throw failure('FAILED_PRECONDITION', 'config.baseUrl must be a valid HTTP(S) URL without credentials, query, or fragment');
  if (!username || !password) throw failure('FAILED_PRECONDITION', 'secret.username and secret.password are required');
  const requestedTimeout = Number(bindings.timeoutMs);
  return {
    baseUrl,
    username,
    password,
    language: nonEmptyString(bindings.language) ?? 'zh-cn',
    remark: nonEmptyString(bindings.remark) ?? 'OctoBus',
    timeoutMs: Number.isInteger(requestedTimeout) && requestedTimeout > 0 ? requestedTimeout : DEFAULT_TIMEOUT_MS,
    skipTlsVerify: bindings.skipTlsVerify === true,
  };
};

const isIPv4OrCidr = (value) => {
  const [address, prefix, extra] = value.split('/');
  if (extra !== undefined) return false;
  if (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) > 32)) return false;
  const octets = address.split('.');
  return octets.length === 4 && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
};

const requestIps = (request) => {
  const candidate = request.ipList ?? request.ip_list;
  if (!Array.isArray(candidate) || candidate.length === 0) {
    throw failure('INVALID_ARGUMENT', 'ip_list must contain at least one IPv4 address or CIDR');
  }
  const ips = candidate.map(nonEmptyString);
  if (ips.some((ip) => ip === undefined) || ips.some((ip) => !isIPv4OrCidr(ip))) {
    throw failure('INVALID_ARGUMENT', 'ip_list contains an invalid IPv4 address or CIDR');
  }
  return [...new Set(ips)];
};

const businessResult = (json) => {
  const result = json?.result;
  if (typeof result === 'string' || typeof result === 'number') return String(result);
  return String(json?.code ?? '0');
};
const businessSuccess = (json) => ['0', RESULT_ALREADY_EXISTS].includes(businessResult(json));
const businessMessage = (json) => typeof json?.message === 'string' ? json.message : '';

const deviceRequest = async (env, path, { method, token, body }, action) => {
  const response = await fetchWithTimeout(`${env.baseUrl}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(action === 'login' ? { HTTP_SIGN: 'PAGE' } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, {
    timeoutMs: env.timeoutMs,
    dispatcher: createTlsDispatcher(env.skipTlsVerify),
  });

  const { body: responseBody, json } = await readResponseJson(response);
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403 ? 'PERMISSION_DENIED' : 'FAILED_PRECONDITION';
    throw failure(code, `${action} upstream returned HTTP ${response.status}`, { status: response.status });
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw failure('INTERNAL', `${action} upstream returned an invalid JSON object`);
  }
  return { json, body: responseBody };
};

const login = async (env) => {
  const { json } = await deviceRequest(env, LOGIN_PATH, {
    method: 'POST',
    body: {
      language: env.language,
      username: Buffer.from(env.username).toString('base64'),
      userpwd: Buffer.from(env.password).toString('base64'),
      captchaId: '',
      vrifyValue: '',
      customize_time_out: '',
    },
  }, 'login');
  if (!businessSuccess(json)) throw failure('PERMISSION_DENIED', `login failed: ${businessMessage(json)}`);
  const token = nonEmptyString(json.message?.token) ?? nonEmptyString(json.data?.access_token) ?? nonEmptyString(json.token);
  if (!token) throw failure('PERMISSION_DENIED', 'login response does not contain a token');
  return token;
};

const addAddresses = async (env, token, listType, ips, remark) => {
  const result = await deviceRequest(env, ADD_PATH, {
    method: 'POST',
    token,
    body: { ipadd: ips, ipdirection: 1, ipstate: listType, remark },
  }, 'add ip list');
  if (!businessSuccess(result.json)) {
    throw failure('FAILED_PRECONDITION', `add ip list failed: ${businessMessage(result.json)}`);
  }
  return result;
};

const verificationItems = (json) => {
  if (Array.isArray(json.message)) return json.message;
  if (Array.isArray(json.data?.items)) return json.data.items;
  if (Array.isArray(json.data)) return json.data;
  if (Array.isArray(json.items)) return json.items;
  return [];
};

const verifyAddresses = async (env, token, listType, ips) => {
  const verified = [];
  let lastBody = '';
  for (const ip of ips) {
    const query = new URLSearchParams({
      pagenum: '1',
      pagesize: '100',
      ordercolumn: 'ipadd',
      ordermode: 'asc',
      listtype: String(listType),
      condition: ip,
    });
    const result = await deviceRequest(env, `${VERIFY_PATH}?${query}`, { method: 'GET', token }, 'verify ip list');
    lastBody = result.body;
    const found = verificationItems(result.json).some((item) => [item?.ipadd, item?.ip, item?.ipaddr].includes(ip));
    if (found) verified.push(ip);
  }
  return { verified, body: lastBody };
};

const runAdd = async (ctx, listType) => {
  const env = buildEnvironment(ctx);
  const request = ctx?.request ?? ctx?.req ?? {};
  const ips = requestIps(request);
  const remark = nonEmptyString(request.remark) ?? env.remark;
  const requestId = nonEmptyString(request.requestId ?? request.request_id) ?? '';
  const token = await login(env);
  const added = await addAddresses(env, token, listType, ips, remark);
  const verified = await verifyAddresses(env, token, listType, ips);
  if (verified.verified.length !== ips.length) {
    throw failure('FAILED_PRECONDITION', 'not all IP addresses were verified after add', {
      requested: ips.length,
      verified: verified.verified.length,
    });
  }
  const result = businessResult(added.json);
  const message = businessMessage(added.json);
  return {
    status: 'OPERATION_STATUS_SUCCESS',
    requestedIpCount: ips.length,
    verifiedIpCount: verified.verified.length,
    upstreamResult: result,
    upstreamMessage: message,
    verifiedIps: verified.verified,
    requestId,
    rawAddResponse: added.body,
    rawVerifyResponse: verified.body,
  };
};

export const handlers = {
  [METHOD_ADD_BLACKLIST_FULL]: (ctx) => runAdd(ctx, LIST_TYPE_BLACK),
  [METHOD_ADD_WHITELIST_FULL]: (ctx) => runAdd(ctx, LIST_TYPE_WHITE),
};
