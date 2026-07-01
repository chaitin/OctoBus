import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const LOGIN_PATH = '/Panabit_TANG_R1.Panabit_TANG_R1/Login';
export const LIST_IPTABLE_PATH = '/Panabit_TANG_R1.Panabit_TANG_R1/ListIPTable';
export const ADD_IPTABLE_PATH = '/Panabit_TANG_R1.Panabit_TANG_R1/AddIPTable';
export const BLOCK_IP_PATH = '/Panabit_TANG_R1.Panabit_TANG_R1/BlockIP';
export const UNBLOCK_IP_PATH = '/Panabit_TANG_R1.Panabit_TANG_R1/UnblockIP';

export const METHOD_LOGIN_FULL = 'Panabit_TANG_R1.Panabit_TANG_R1/Login';
export const METHOD_LIST_IPTABLE_FULL = 'Panabit_TANG_R1.Panabit_TANG_R1/ListIPTable';
export const METHOD_ADD_IPTABLE_FULL = 'Panabit_TANG_R1.Panabit_TANG_R1/AddIPTable';
export const METHOD_BLOCK_IP_FULL = 'Panabit_TANG_R1.Panabit_TANG_R1/BlockIP';
export const METHOD_UNBLOCK_IP_FULL = 'Panabit_TANG_R1.Panabit_TANG_R1/UnblockIP';

export const DEFAULT_TIMEOUT_MS = 1500;
export const LOGIN_URI = '/api/panabit.cgi/API';
export const API_URI = '/api/panabit.cgi';
export const IPTABLE_ROUTE = 'object@iptable';

const sessionCache = new Map();

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

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const firstDefined = (...vals) => vals.find((val) => val !== undefined && val !== null);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const pickFirst = (source, keys) => {
  for (const key of keys) {
    if (hasOwn(source, key)) return unwrapScalar(source[key]);
  }
  return undefined;
};

const normalizeBaseUrl = (url) => {
  const base = String(unwrapScalar(url) ?? '').trim();
  if (!/^https?:\/\//i.test(base)) return '';
  return base.replace(/\/+$/, '');
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.bindings ?? {}),
  ...(ctx?.secret ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.request ?? ctx.req ?? {},
});

const requestFromContext = (ctx = {}) => ctx?.request ?? ctx?.req ?? {};

const resolveBaseUrl = (bindings) => normalizeBaseUrl(firstDefined(
  bindings?.restBaseUrl,
  bindings?.baseUrl,
  bindings?.rest_base_url,
  bindings?.base_url,
  bindings?.host,
));

const resolveTimeoutMs = (ctx) => {
  const bindings = mergedBindings(ctx);
  const timeout = Number(firstDefined(ctx?.limits?.timeoutMs, bindings.timeoutMs, bindings.timeout_ms, DEFAULT_TIMEOUT_MS));
  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS;
};

const toBoolean = (value) => {
  const raw = unwrapScalar(value);
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) return false;
  }
  return false;
};

let insecureTlsDispatcher;

const getInsecureTlsDispatcher = () => {
  insecureTlsDispatcher ??= new Agent({ connect: { rejectUnauthorized: false } });
  return insecureTlsDispatcher;
};

const buildTlsOptions = (bindings) => {
  if (!toBoolean(bindings?.tlsInsecureSkipVerify) && !toBoolean(bindings?.skipTlsVerify) && !toBoolean(bindings?.insecureSkipVerify)) return {};
  return { dispatcher: getInsecureTlsDispatcher() };
};

const getInstanceId = (ctx) => String(ctx?.meta?.instance_id || ctx?.meta?.instanceId || 'unknown');
const getRequestId = (ctx) => String(ctx?.meta?.request_id || ctx?.meta?.requestId || 'unknown');
const buildSessionKey = (ctx, baseUrl) => `${getInstanceId(ctx)}::${baseUrl}`;
const setSession = (ctx, baseUrl, session) => sessionCache.set(buildSessionKey(ctx, baseUrl), session);
const getSession = (ctx, baseUrl) => sessionCache.get(buildSessionKey(ctx, baseUrl));
const clearSession = (ctx, baseUrl) => sessionCache.delete(buildSessionKey(ctx, baseUrl));
const clearSessionCache = () => sessionCache.clear();

const buildHeaders = (ctx, extraHeaders = {}) => ({
  ...(ctx?.bindings?.headers || {}),
  'x-engine-instance': getInstanceId(ctx),
  'x-request-id': getRequestId(ctx),
  ...extraHeaders,
});

const requireBaseUrl = (ctx) => {
  const baseUrl = resolveBaseUrl(ctx?.bindings || {});
  if (!baseUrl) throw errorWithCode('INVALID_ARGUMENT', 'restBaseUrl/baseUrl is required (http/https)');
  return baseUrl;
};

const resolveLoginCredential = (bindings, keys, field) => {
  const value = firstDefined(pickFirst(bindings, keys), '');
  const text = String(value || '').trim();
  if (!text) throw errorWithCode('INVALID_ARGUMENT', `${field} is required in bindings`);
  return text;
};

const isValidIPv4 = (ip) => {
  const parts = String(unwrapScalar(ip) ?? '').split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const num = Number(part);
    return Number.isInteger(num) && num >= 0 && num <= 255 && part === String(num);
  });
};

const isValidIPv6 = (ip) => {
  const str = String(unwrapScalar(ip) ?? '');
  if (str.includes('::')) {
    const parts = str.split('::');
    if (parts.length > 2) return false;
    const left = parts[0] ? parts[0].split(':') : [];
    const right = parts[1] ? parts[1].split(':') : [];
    if (left.length + right.length > 7) return false;
    const allParts = [...left, ...right];
    return allParts.every((part) => {
      if (part === '') return false;
      const num = parseInt(part, 16);
      return !Number.isNaN(num) && num >= 0 && num <= 0xffff;
    });
  }
  const parts = str.split(':');
  if (parts.length !== 8) return false;
  return parts.every((part) => {
    if (part === '') return false;
    const num = parseInt(part, 16);
    return !Number.isNaN(num) && num >= 0 && num <= 0xffff;
  });
};

const isValidIP = (ip) => isValidIPv4(ip) || isValidIPv6(ip);

const toValue = (val) => {
  const raw = unwrapScalar(val);
  if (raw === undefined || raw === null) return { nullValue: 'NULL_VALUE' };
  if (typeof raw === 'string') return { stringValue: raw };
  if (typeof raw === 'number') return { numberValue: raw };
  if (typeof raw === 'boolean') return { boolValue: raw };
  if (Array.isArray(raw)) return { listValue: { values: raw.map((item) => toValue(item)) } };
  if (typeof raw === 'object') return { structValue: toStruct(raw) };
  return { stringValue: String(raw) };
};

const toStruct = (obj) => {
  if (obj === undefined || obj === null) return undefined;
  const fields = {};
  for (const [key, value] of Object.entries(obj)) fields[key] = toValue(value);
  return { fields };
};

const buildMultipartBody = (fields) => {
  const boundary = `----FormBoundary${crypto.randomUUID().replaceAll('-', '')}`;
  const parts = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    parts.push(`--${boundary}\r\n`);
    parts.push(`Content-Disposition: form-data; name="${key}"\r\n\r\n`);
    parts.push(`${String(value)}\r\n`);
  }
  parts.push(`--${boundary}--\r\n`);
  return { body: parts.join(''), boundary };
};

const buildQueryString = (params) =>
  Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');

const handleHttpError = (status, text) => {
  const summary = `upstream http ${status}; body_length=${String(text || '').length}`;
  if (status === 401 || status === 403) {
    throw errorWithCode('PERMISSION_DENIED', summary);
  }
  if (status >= 400 && status < 500) {
    throw errorWithCode('FAILED_PRECONDITION', summary);
  }
  throw errorWithCode('UNAVAILABLE', summary);
};

const parseJsonResponse = (text) => {
  if (!String(text || '').trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', 'response is not valid JSON');
  }
};

const responseOk = (res) => {
  if (typeof res?.ok === 'boolean') return res.ok;
  const status = Number(res?.status);
  return Number.isFinite(status) && status >= 200 && status < 300;
};

const fetchText = async (ctx, url, init = {}) => {
  let res;
  try {
    res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(resolveTimeoutMs(ctx)),
      ...buildTlsOptions(ctx.bindings),
    });
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', err?.cause?.message || err?.message || 'fetch failed');
  }

  const text = await res.text();
  if (!responseOk(res)) handleHttpError(Number(res.status) || 0, text);
  return { status: Number(res.status) || 0, text, res };
};

const requireToken = (ctx) => {
  const baseUrl = requireBaseUrl(ctx);
  const token = String(getSession(ctx, baseUrl)?.apiToken || '').trim();
  if (!token) throw errorWithCode('FAILED_PRECONDITION', 'call Login first');
  return token;
};

const requireText = (req, keys, field) => {
  const text = String(firstDefined(pickFirst(req, keys), '') || '').trim();
  if (!text) throw errorWithCode('INVALID_ARGUMENT', `${field} is required`);
  return text;
};

const requireIP = (req) => {
  const ip = requireText(req, ['ip', 'Ip'], 'ip');
  if (!isValidIP(ip)) throw errorWithCode('INVALID_ARGUMENT', `ip format is invalid: ${ip}`);
  return ip;
};

const panabitPost = async (ctx, formFields) => {
  const baseUrl = requireBaseUrl(ctx);
  const { body, boundary } = buildMultipartBody(formFields);
  const { text } = await fetchText(ctx, `${baseUrl}${API_URI}`, {
    method: 'POST',
    headers: buildHeaders(ctx, { 'content-type': `multipart/form-data; boundary=${boundary}` }),
    body,
  });
  return parseJsonResponse(text);
};

const rawOrEmpty = (json) => toStruct(json ?? {});

const responseFromJson = (json) => ({
  code: typeof json?.code === 'number' ? json.code : -1,
  msg: typeof json?.msg === 'string' ? json.msg : '',
  raw: rawOrEmpty(json),
});

const handleLogin = async (_req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings || {};
  const baseUrl = requireBaseUrl(callCtx);
  const user = resolveLoginCredential(bindings, ['bindUser', 'bind_user', 'user', 'username'], 'user');
  const password = resolveLoginCredential(bindings, ['bindPassword', 'bind_password', 'password'], 'password');
  const query = buildQueryString({ api_action: 'api_login', username: user, password });
  const { text } = await fetchText(callCtx, `${baseUrl}${LOGIN_URI}?${query}`, {
    method: 'GET',
    headers: buildHeaders(callCtx),
  });
  const json = parseJsonResponse(text);
  if (!json) throw errorWithCode('UNKNOWN', 'empty response from device');
  if (json.code === 0 && typeof json.data === 'string' && json.data.trim()) {
    setSession(callCtx, baseUrl, { apiToken: json.data.trim() });
  } else {
    clearSession(callCtx, baseUrl);
  }
  return {
    code: typeof json.code === 'number' ? json.code : -1,
    api_token: '',
  };
};

const handleListIPTable = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const keyword = String(firstDefined(req?.keyword, '') || '').trim();
  const formFields = {
    api_route: IPTABLE_ROUTE,
    api_action: 'list_iptable',
    api_token: requireToken(callCtx),
  };
  if (keyword) formFields.keyword = keyword;
  const json = await panabitPost(callCtx, formFields);
  if (!json) return { code: 0, msg: '', data: [], raw: toStruct({}) };
  const data = (Array.isArray(json.data) ? json.data : []).map((item) => ({
    id: String(item?.id ?? ''),
    name: String(item?.name ?? ''),
    member: Array.isArray(item?.member) ? item.member.map(String) : [],
  }));
  return {
    ...responseFromJson(json),
    data,
  };
};

const handleAddIPTable = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const name = requireText(req, ['name', 'Name'], 'name');
  const json = await panabitPost(callCtx, {
    api_route: IPTABLE_ROUTE,
    api_action: 'add_iptable',
    name,
    api_token: requireToken(callCtx),
  });
  if (!json) return { code: 0, msg: '', raw: toStruct({}) };
  return responseFromJson(json);
};

const handleBlockIP = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const name = requireText(req, ['name', 'Name'], 'name');
  const id = requireText(req, ['id', 'Id'], 'id');
  const ip = requireIP(req);
  const json = await panabitPost(callCtx, {
    api_route: IPTABLE_ROUTE,
    api_action: 'add_tabip',
    name,
    id,
    ip,
    api_token: requireToken(callCtx),
  });
  if (!json) return { code: 0, msg: '', raw: toStruct({}) };
  return responseFromJson(json);
};

const handleUnblockIP = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const name = requireText(req, ['name', 'Name'], 'name');
  const id = requireText(req, ['id', 'Id'], 'id');
  const ip = requireIP(req);
  const json = await panabitPost(callCtx, {
    api_route: IPTABLE_ROUTE,
    api_action: 'rmv_tabip',
    name,
    id,
    ip,
    api_token: requireToken(callCtx),
  });
  if (!json) return { code: 0, msg: '', raw: toStruct({}) };
  return responseFromJson(json);
};

export function rpcdef(ctx) {
  const callCtx = resolveCallContext(ctx);
  return {
    [LOGIN_PATH]: async (req) => handleLogin(req ?? callCtx.req ?? {}, callCtx),
    [LIST_IPTABLE_PATH]: async (req) => handleListIPTable(req ?? callCtx.req ?? {}, callCtx),
    [ADD_IPTABLE_PATH]: async (req) => handleAddIPTable(req ?? callCtx.req ?? {}, callCtx),
    [BLOCK_IP_PATH]: async (req) => handleBlockIP(req ?? callCtx.req ?? {}, callCtx),
    [UNBLOCK_IP_PATH]: async (req) => handleUnblockIP(req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_LOGIN_FULL]: (ctx = {}) => handleLogin(requestFromContext(ctx), ctx),
  [METHOD_LIST_IPTABLE_FULL]: (ctx = {}) => handleListIPTable(requestFromContext(ctx), ctx),
  [METHOD_ADD_IPTABLE_FULL]: (ctx = {}) => handleAddIPTable(requestFromContext(ctx), ctx),
  [METHOD_BLOCK_IP_FULL]: (ctx = {}) => handleBlockIP(requestFromContext(ctx), ctx),
  [METHOD_UNBLOCK_IP_FULL]: (ctx = {}) => handleUnblockIP(requestFromContext(ctx), ctx),
};

export const _test = {
  buildHeaders,
  buildMultipartBody,
  buildQueryString,
  buildSessionKey,
  buildTlsOptions,
  clearSession,
  clearSessionCache,
  errorWithCode,
  fetchText,
  getInstanceId,
  getRequestId,
  getSession,
  handleHttpError,
  isValidIP,
  isValidIPv4,
  isValidIPv6,
  normalizeBaseUrl,
  parseJsonResponse,
  requireIP,
  resolveBaseUrl,
  resolveCallContext,
  resolveTimeoutMs,
  responseFromJson,
  setSession,
  toBoolean,
  toStruct,
  toValue,
};
