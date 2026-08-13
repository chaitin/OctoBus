import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const METHOD_BLOCK_PATH = '/Qiming_Tianqing_WAF.QimingTianqingWafService/BlockIP';
export const METHOD_UNBLOCK_PATH = '/Qiming_Tianqing_WAF.QimingTianqingWafService/UnblockIP';
export const METHOD_BLOCK_FULL = 'Qiming_Tianqing_WAF.QimingTianqingWafService/BlockIP';
export const METHOD_UNBLOCK_FULL = 'Qiming_Tianqing_WAF.QimingTianqingWafService/UnblockIP';

export const PATH_LOGIN = '/api/mgr/login';
export const PATH_ADDRESS_OBJECT = '/addressobject/addAddrObj';
export const PATH_BLOCK = '/blacklist/add_submit';
export const PATH_UNBLOCK = '/blacklist/delete';
export const PATH_LOGOUT = '/login/logout';

export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_BLACKLIST_NAME = 'default_blacklist';
export const DEFAULT_ADDRESS_OBJECT_PREFIX = 'ip-';
export const DEFAULT_OPERATION_REASON = 'engine automated action';
export const DEFAULT_LOGOUT_ON_FINISH = true;

export const DEFAULT_ADDRESS_OBJECT_TEMPLATE = {
  name: '{{address_object_name}}',
  addrObjName: '{{address_object_name}}',
  type: 'ip',
  addrObjType: 'ip',
  content: '{{ip}}',
  addrObjContent: '{{ip}}',
  description: '{{description}}',
  remark: '{{description}}',
};

export const DEFAULT_BLACKLIST_TEMPLATE = {
  action: 'block',
  ip: '{{ip}}',
  list: [
    {
      ip: '{{ip}}',
      description: '{{reason}}',
      remark: '{{reason}}',
    },
  ],
  name: '{{blacklist_name}}',
};

export const DEFAULT_UNBLOCK_TEMPLATE = {
  action: 'unblock',
  ip: '{{ip}}',
  list: [
    {
      ip: '{{ip}}',
    },
  ],
  name: '{{blacklist_name}}',
};

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
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

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const readPrimitive = (value) => unwrapScalar(value);

const normalizeString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

const pickStringField = (source, keys) => {
  if (!source || typeof source !== 'object') return undefined;
  for (const key of keys) {
    if (!hasOwn(source, key)) continue;
    const text = normalizeString(source[key]);
    if (text) return text;
  }
  return undefined;
};

const toBoolean = (candidate) => {
  const raw = unwrapScalar(candidate);
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return Number.isNaN(raw) ? false : raw !== 0;
  if (typeof raw === 'string') {
    const value = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(value)) return true;
    if (['0', 'false', 'no', 'n', 'off', ''].includes(value)) return false;
  }
  return false;
};

const normalizeBaseUrl = (base) => {
  const trimmed = normalizeString(base);
  if (!/^https?:\/\//i.test(trimmed)) return '';
  return trimmed.replace(/\/+$/, '');
};

const optionalUint32 = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num) || Number.isNaN(num) || num <= 0) return undefined;
  return Math.trunc(num);
};

const resolveTimeoutMs = (ctx = {}) => {
  const req = ctx.req || {};
  const bindings = ctx.bindings || {};
  return firstDefined(
    optionalUint32(req.timeoutMs),
    optionalUint32(req.timeout_ms),
    optionalUint32(bindings.timeoutMs),
    optionalUint32(bindings.timeout_ms),
    optionalUint32(ctx.limits?.timeoutMs),
    DEFAULT_TIMEOUT_MS,
  );
};

const cloneValue = (value) => {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item));
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = cloneValue(item);
    return result;
  }
  return value;
};

const mergeDeep = (base, ...overrides) => {
  const target = cloneValue(base);
  for (const override of overrides) {
    if (!override || typeof override !== 'object') continue;
    for (const [key, value] of Object.entries(override)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nextBase = target[key] && typeof target[key] === 'object' && !Array.isArray(target[key]) ? target[key] : {};
        target[key] = mergeDeep(nextBase, value);
      } else if (Array.isArray(value)) {
        target[key] = value.map((item) => cloneValue(item));
      } else {
        target[key] = value;
      }
    }
  }
  return target;
};

const normalizeStructValue = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') {
    if (hasOwn(value, 'stringValue')) return value.stringValue;
    if (hasOwn(value, 'numberValue')) return value.numberValue;
    if (hasOwn(value, 'boolValue')) return value.boolValue;
    if (hasOwn(value, 'listValue') && Array.isArray(value.listValue?.values)) {
      return value.listValue.values.map((item) => normalizeStructValue(item));
    }
    if (hasOwn(value, 'structValue') && value.structValue?.fields) return normalizeStruct(value.structValue);
    if (hasOwn(value, 'nullValue')) return null;
  }
  return value;
};

const normalizeStruct = (candidate) => {
  if (!candidate) return {};
  if (candidate.fields && typeof candidate.fields === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(candidate.fields)) result[key] = normalizeStructValue(value);
    return result;
  }
  if (typeof candidate !== 'object') return {};
  const result = {};
  for (const [key, value] of Object.entries(candidate)) result[key] = normalizeStructValue(value);
  return result;
};

const sha256Hex = (input) => crypto.createHash('sha256').update(String(input ?? ''), 'utf8').digest('hex');

const ensurePasswordSha = (credential) => {
  if (credential.passwordSha) {
    credential.passwordSha = credential.passwordSha.toLowerCase();
    return credential.passwordSha;
  }
  if (!credential.password) {
    throw errorWithCode('INVALID_ARGUMENT', 'password is required when password_sha256 is absent');
  }
  credential.passwordSha = sha256Hex(credential.password).toLowerCase();
  return credential.passwordSha;
};

const templateRegex = /\{\{\s*([\w.]+)\s*\}\}/g;

const lookupContext = (ctx, path) => {
  const parts = path.split('.');
  let current = ctx;
  for (const part of parts) {
    if (current === undefined || current === null) return '';
    current = current[part];
  }
  if (current === undefined || current === null) return '';
  if (Array.isArray(current)) return current.join(',');
  if (typeof current === 'object') return JSON.stringify(current);
  return String(current);
};

const applyTemplate = (value, context) => {
  if (typeof value === 'string') return value.replace(templateRegex, (_, key) => lookupContext(context, key));
  if (Array.isArray(value)) return value.map((item) => applyTemplate(item, context));
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = applyTemplate(item, context);
    return result;
  }
  return value;
};

const resolveIpList = (req = {}) => {
  const list = [];
  const raw = req.ip_list ?? req.ipList ?? req.ips;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const text = readPrimitive(item);
      if (text !== undefined && text !== null && String(text).trim()) list.push(String(text).trim());
    }
  } else if (raw && typeof raw === 'object' && Array.isArray(raw.values)) {
    for (const item of raw.values) {
      const text = readPrimitive(item);
      if (text !== undefined && text !== null && String(text).trim()) list.push(String(text).trim());
    }
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed) list.push(trimmed);
  }
  if (!list.length) throw errorWithCode('INVALID_ARGUMENT', 'ip_list is required and must contain at least one IP');
  return list;
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx.config ?? {}),
  ...(ctx.bindings ?? {}),
  ...(ctx.secret ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.request ?? ctx.req ?? {},
});

const requestFromContext = (ctx = {}) => ctx?.request ?? ctx?.req ?? {};

const resolveCredential = (req = {}, bindings = {}) => {
  const credential = req.credential || req.credentials || {};
  const username = pickStringField(bindings, ['username', 'user']);
  const passwordSha = pickStringField(bindings, ['password_sha256', 'passwordSha256']);
  const passwordClear = pickStringField(bindings, ['password', 'password_clear']);
  const baseUrl = normalizeBaseUrl(firstDefined(
    pickStringField(bindings, ['restBaseUrl', 'baseUrl', 'rest_base_url', 'base_url', 'url']),
  ));
  if (!baseUrl) throw errorWithCode('INVALID_ARGUMENT', 'base_url/restBaseUrl is required and must start with http:// or https://');
  if (!username) throw errorWithCode('INVALID_ARGUMENT', 'username is required in instance config or secret');

  const result = {
    baseUrl,
    username,
    passwordSha,
    password: passwordClear,
    extra: credential.extra ? normalizeStruct(credential.extra) : {},
    skipTls: toBoolean(firstDefined(
      credential.skip_tls_verify,
      credential.skipTlsVerify,
      bindings.skipTlsVerify,
      bindings.tlsInsecureSkipVerify,
      bindings.insecureSkipVerify,
    )),
  };
  ensurePasswordSha(result);
  return result;
};

const buildHeaders = (bindingsHeaders = {}, meta = {}) => ({
  ...(bindingsHeaders || {}),
  'x-engine-instance': meta.instance_id || meta.instanceId || 'unknown',
  'x-request-id': meta.request_id || meta.requestId || 'unknown',
});

const parseSid = (cookie) => {
  if (!cookie) return undefined;
  const match = String(cookie).match(/SID=([^;]+)/);
  return match ? match[1] : undefined;
};

const extractSid = (headers) => {
  if (!headers) return undefined;
  if (typeof headers.getSetCookie === 'function') {
    const cookies = headers.getSetCookie();
    if (Array.isArray(cookies)) {
      for (const cookie of cookies) {
        const sid = parseSid(cookie);
        if (sid) return sid;
      }
    }
  }
  const header = typeof headers.get === 'function' ? headers.get('set-cookie') : undefined;
  if (header) {
    const sid = parseSid(header);
    if (sid) return sid;
  }
  if (typeof headers.raw === 'function') {
    const raw = headers.raw();
    if (Array.isArray(raw?.['set-cookie'])) {
      for (const cookie of raw['set-cookie']) {
        const sid = parseSid(cookie);
        if (sid) return sid;
      }
    }
  }
  if (typeof headers.forEach === 'function') {
    let found;
    headers.forEach((value, key) => {
      if (!found && String(key).toLowerCase() === 'set-cookie') found = parseSid(value);
    });
    if (found) return found;
  }
  return undefined;
};

const parseJsonResponse = async (res) => {
  const text = await res.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (err) {
    throw errorWithCode('UNKNOWN', `response is not valid JSON: ${err?.message || err}`);
  }
};

let insecureTlsDispatcher;

const getInsecureTlsDispatcher = () => {
  insecureTlsDispatcher ??= new Agent({ connect: { rejectUnauthorized: false } });
  return insecureTlsDispatcher;
};

const fetchJson = async (url, init = {}, skipTlsVerify = false) => {
  const timeoutSignal = init.timeoutMs === undefined ? {} : { signal: AbortSignal.timeout(init.timeoutMs) };
  const options = {
    method: init.method || 'POST',
    headers: {
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    ...timeoutSignal,
    ...(skipTlsVerify ? { dispatcher: getInsecureTlsDispatcher() } : {}),
  };

  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', err?.cause?.message || err?.message || 'fetch failed');
  }
  if (!res) throw errorWithCode('UNAVAILABLE', 'upstream returned empty response');

  const json = await parseJsonResponse(res);
  const ok = res.ok ?? (res.status >= 200 && res.status < 300);
  if (!ok) {
    const text = typeof json === 'object' ? JSON.stringify(json) : String(json);
    if (res.status === 401 || res.status === 403) {
      throw errorWithCode('PERMISSION_DENIED', `upstream http ${res.status}`);
    }
    if (res.status >= 400 && res.status < 500) {
      throw errorWithCode('FAILED_PRECONDITION', `upstream http ${res.status}`);
    }
    throw errorWithCode('UNAVAILABLE', `upstream http ${res.status}`);
  }
  return { json, headers: res.headers };
};

const responseCodeIsSuccess = (json) => {
  const code = json?.code ?? 0;
  const numeric = Number(code);
  return Number.isNaN(numeric) ? String(code) === '0' : numeric === 0;
};

const requireBusinessSuccess = (json, label, fallbackMessage) => {
  if (responseCodeIsSuccess(json)) return;
  const message = json?.msg || json?.message || fallbackMessage;
  throw errorWithCode('FAILED_PRECONDITION', `${label} failed: code=${json?.code ?? 'unknown'} message=${message}`);
};

const resolveTemplates = (req = {}) => ({
  loginTemplate: {},
  addressTemplate: mergeDeep(DEFAULT_ADDRESS_OBJECT_TEMPLATE, normalizeStruct(req.address_object?.template_override || {})),
  blacklistTemplate: mergeDeep(DEFAULT_BLACKLIST_TEMPLATE, normalizeStruct(req.blacklist?.template_override || {})),
  unblockTemplate: mergeDeep(DEFAULT_UNBLOCK_TEMPLATE, normalizeStruct(req.unblock?.template_override || {})),
});

const resolveDescriptions = (req = {}) => {
  const addressDesc = pickStringField(req.address_object, ['description'])
    || pickStringField(req.blacklist, ['reason'])
    || DEFAULT_OPERATION_REASON;
  const blacklistName = pickStringField(req.blacklist, ['name']) || DEFAULT_BLACKLIST_NAME;
  const blacklistReason = pickStringField(req.blacklist, ['reason']) || addressDesc || DEFAULT_OPERATION_REASON;
  const unblockReason = pickStringField(req.unblock, ['reason']) || blacklistReason;
  return { addressDesc, blacklistName, blacklistReason, unblockReason };
};

const resolveAddressName = (req, ip, index) => {
  const explicit = pickStringField(req?.address_object, ['name']);
  if (explicit) return explicit;
  return `${DEFAULT_ADDRESS_OBJECT_PREFIX}${String(ip).replace(/[^a-zA-Z0-9]+/g, '_')}_${index + 1}`;
};

const shouldCreateAddressObject = (req = {}) => !toBoolean(firstDefined(req.address_object?.disabled));

const shouldLogout = (req = {}) => {
  const flag = firstDefined(req.logout);
  if (flag === undefined || flag === null) return DEFAULT_LOGOUT_ON_FINISH;
  return toBoolean(flag);
};

const buildCommonContext = (ipList, credential, descriptions, meta = {}) => ({
  ip_list: ipList,
  ip_list_json: JSON.stringify(ipList),
  username: credential.username,
  blacklist_name: descriptions.blacklistName || DEFAULT_BLACKLIST_NAME,
  timestamp: new Date().toISOString(),
  instance_id: meta.instance_id || meta.instanceId,
  request_id: meta.request_id || meta.requestId,
});

const login = async (config) => {
  const { baseUrl, timeoutMs, headers, templates, credential } = config;
  const loginPayload = mergeDeep(templates.loginTemplate, {
    name: credential.username,
    username: credential.username,
    password: credential.passwordSha,
    password_sha256: credential.passwordSha,
  }, credential.extra || {});

  const { json, headers: responseHeaders } = await fetchJson(
    `${baseUrl}${PATH_LOGIN}`,
    { method: 'POST', headers, timeoutMs, body: loginPayload },
    credential.skipTls,
  );

  if (!responseCodeIsSuccess(json)) {
    const message = json?.msg || json?.message || 'login failed';
    throw errorWithCode('UNAUTHENTICATED', `login failed: code=${json?.code ?? 'unknown'} message=${message}`);
  }
  const authorization = json?.data?.authorization || json?.data?.Authorization || json?.Authorization;
  if (!authorization) throw errorWithCode('FAILED_PRECONDITION', 'login success but missing data.authorization');
  const sid = extractSid(responseHeaders);
  if (!sid) throw errorWithCode('FAILED_PRECONDITION', 'login success but missing SID cookie');
  return { authorization, sid };
};

const callAddressObject = async (config, context, templates, authHeaders) => {
  const payload = applyTemplate(templates.addressTemplate, context);
  const { timeoutMs } = config;
  const { json } = await fetchJson(
    `${config.baseUrl}${PATH_ADDRESS_OBJECT}`,
    { method: 'POST', headers: authHeaders, timeoutMs, body: payload },
    config.credential.skipTls,
  );
  requireBusinessSuccess(json, 'addAddrObj', 'address object creation failed');
  return json;
};

const callBlock = async (config, context, templates, authHeaders) => {
  const payload = applyTemplate(templates.blacklistTemplate, context);
  const { timeoutMs } = config;
  const { json } = await fetchJson(
    `${config.baseUrl}${PATH_BLOCK}`,
    { method: 'POST', headers: authHeaders, timeoutMs, body: payload },
    config.credential.skipTls,
  );
  requireBusinessSuccess(json, 'add_submit', 'blacklist add failed');
  return json;
};

const callUnblock = async (config, context, templates, authHeaders) => {
  const payload = applyTemplate(templates.unblockTemplate, context);
  const { timeoutMs } = config;
  const { json } = await fetchJson(
    `${config.baseUrl}${PATH_UNBLOCK}`,
    { method: 'POST', headers: authHeaders, timeoutMs, body: payload },
    config.credential.skipTls,
  );
  requireBusinessSuccess(json, 'delete', 'blacklist delete failed');
  return json;
};

const tryLogout = async (config, authHeaders) => {
  const { timeoutMs } = config;
  try {
    await fetchJson(
      `${config.baseUrl}${PATH_LOGOUT}`,
      { method: 'POST', headers: authHeaders, timeoutMs, body: {} },
      config.credential.skipTls,
    );
  } catch (err) {
    console.warn('[Qiming_Tianqing_WAF][logout] failed', err?.message || err);
  }
};

const createRuntimeConfig = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const credential = resolveCredential(callCtx.req, callCtx.bindings);
  const authHeadersExtra = { ...(callCtx.bindings.headers || {}), ...(callCtx.bindings.authHeaders || {}) };
  const headers = buildHeaders(authHeadersExtra, callCtx.meta);
  const templates = resolveTemplates(callCtx.req);
  const timeoutMs = resolveTimeoutMs(callCtx);
  return {
    callCtx,
    credential,
    timeoutMs,
    headers,
    templates,
    config: {
      baseUrl: credential.baseUrl,
      timeoutMs,
      headers,
      templates,
      credential,
    },
  };
};

const buildAuthHeaders = (headers, loginResult) => ({
  ...headers,
  Authorization: loginResult.authorization,
  authorization: loginResult.authorization,
  Cookie: `SID=${loginResult.sid}`,
});

const executeBlock = async (ctx = {}) => {
  const runtime = createRuntimeConfig(ctx);
  const req = runtime.callCtx.req;
  const ipList = resolveIpList(req);
  const descriptions = resolveDescriptions(req);
  const commonCtx = buildCommonContext(ipList, runtime.credential, descriptions, runtime.callCtx.meta);
  const loginResult = await login(runtime.config);
  const authHeaders = buildAuthHeaders(runtime.headers, loginResult);
  const blocked = [];

  for (let index = 0; index < ipList.length; index += 1) {
    const ip = ipList[index];
    const description = descriptions.addressDesc || descriptions.blacklistReason || `block ${ip}`;
    const context = {
      ...commonCtx,
      ip,
      ip_index: index,
      address_object_name: resolveAddressName(req, ip, index),
      description,
      reason: descriptions.blacklistReason || description,
      blacklist_name: descriptions.blacklistName || DEFAULT_BLACKLIST_NAME,
    };
    if (shouldCreateAddressObject(req)) await callAddressObject(runtime.config, context, runtime.templates, authHeaders);
    await callBlock(runtime.config, context, runtime.templates, authHeaders);
    blocked.push(ip);
  }

  if (shouldLogout(req)) await tryLogout(runtime.config, authHeaders);
  return {
    status: 'OPERATION_STATUS_SUCCESS',
    blocked_ips: blocked,
    authorization: '',
    sid: '',
  };
};

const executeUnblock = async (ctx = {}) => {
  const runtime = createRuntimeConfig(ctx);
  const req = runtime.callCtx.req;
  const ipList = resolveIpList(req);
  const descriptions = resolveDescriptions(req);
  const commonCtx = buildCommonContext(ipList, runtime.credential, descriptions, runtime.callCtx.meta);
  const loginResult = await login(runtime.config);
  const authHeaders = buildAuthHeaders(runtime.headers, loginResult);
  const unblocked = [];

  for (let index = 0; index < ipList.length; index += 1) {
    const ip = ipList[index];
    const description = descriptions.unblockReason || `unblock ${ip}`;
    const context = {
      ...commonCtx,
      ip,
      ip_index: index,
      description,
      reason: descriptions.unblockReason || description,
      blacklist_name: descriptions.blacklistName || DEFAULT_BLACKLIST_NAME,
    };
    await callUnblock(runtime.config, context, runtime.templates, authHeaders);
    unblocked.push(ip);
  }

  if (shouldLogout(req)) await tryLogout(runtime.config, authHeaders);
  return {
    status: 'OPERATION_STATUS_SUCCESS',
    unblocked_ips: unblocked,
    authorization: '',
    sid: '',
  };
};

const handleBlock = (req, ctx = {}) => executeBlock(resolveCallContext({ ...ctx, req: req ?? ctx.req ?? {} }));

const handleUnblock = (req, ctx = {}) => executeUnblock(resolveCallContext({ ...ctx, req: req ?? ctx.req ?? {} }));

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_BLOCK_PATH]: async (req) => handleBlock(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_UNBLOCK_PATH]: async (req) => handleUnblock(req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_BLOCK_FULL]: (ctx = {}) => handleBlock(requestFromContext(ctx), ctx),
  [METHOD_UNBLOCK_FULL]: (ctx = {}) => handleUnblock(requestFromContext(ctx), ctx),
};

export const _test = {
  applyTemplate,
  buildAuthHeaders,
  buildCommonContext,
  buildHeaders,
  callAddressObject,
  callBlock,
  callUnblock,
  cloneValue,
  createRuntimeConfig,
  ensurePasswordSha,
  errorWithCode,
  executeBlock,
  executeUnblock,
  extractSid,
  fetchJson,
  firstDefined,
  login,
  lookupContext,
  mergeDeep,
  normalizeBaseUrl,
  normalizeString,
  normalizeStruct,
  normalizeStructValue,
  optionalUint32,
  parseJsonResponse,
  parseSid,
  pickStringField,
  readPrimitive,
  requireBusinessSuccess,
  resolveAddressName,
  resolveCallContext,
  resolveCredential,
  resolveDescriptions,
  resolveIpList,
  resolveTemplates,
  resolveTimeoutMs,
  responseCodeIsSuccess,
  sha256Hex,
  shouldCreateAddressObject,
  shouldLogout,
  toBoolean,
  unwrapScalar,
};
