import { createHash } from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const LOGIN_PATH = '/Nsfocus_NIPS_V56R11.Nsfocus_NIPS_V56R11/Login';
export const BLOCK_PATH = '/Nsfocus_NIPS_V56R11.Nsfocus_NIPS_V56R11/BlockIP';
export const LIST_PATH = '/Nsfocus_NIPS_V56R11.Nsfocus_NIPS_V56R11/ListBlacklist';
export const UNBLOCK_PATH = '/Nsfocus_NIPS_V56R11.Nsfocus_NIPS_V56R11/UnblockByIds';
export const APPLY_PATH = '/Nsfocus_NIPS_V56R11.Nsfocus_NIPS_V56R11/ApplyConfig';

export const METHOD_LOGIN_FULL = 'Nsfocus_NIPS_V56R11.Nsfocus_NIPS_V56R11/Login';
export const METHOD_BLOCK_FULL = 'Nsfocus_NIPS_V56R11.Nsfocus_NIPS_V56R11/BlockIP';
export const METHOD_LIST_FULL = 'Nsfocus_NIPS_V56R11.Nsfocus_NIPS_V56R11/ListBlacklist';
export const METHOD_UNBLOCK_FULL = 'Nsfocus_NIPS_V56R11.Nsfocus_NIPS_V56R11/UnblockByIds';
export const METHOD_APPLY_FULL = 'Nsfocus_NIPS_V56R11.Nsfocus_NIPS_V56R11/ApplyConfig';

export const DEFAULT_TIMEOUT_MS = 1500;
export const LOGIN_URI = '/api/system/account/login/login';
export const BLACKLIST_URI = '/api/policy/globalList/black/manual';
export const APPLYCONFIG_URI = '/api/index/applyconfig';

const sessionByInstanceId = new Map();
const loginInFlightByInstanceId = new Map();

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
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

const normalizeBaseUrl = (value) => {
  const raw = String(unwrapScalar(value) ?? '').trim();
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.replace(/\/+$/, '');
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.bindings ?? {}),
  ...(ctx?.config ?? {}),
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
  bindings?.host,
  bindings?.restBaseUrl,
  bindings?.rest_base_url,
  bindings?.baseUrl,
  bindings?.base_url,
));

const resolveTimeoutMs = (ctx) => {
  const bindings = mergedBindings(ctx);
  const raw = Number(firstDefined(ctx?.limits?.timeoutMs, bindings.timeoutMs, bindings.timeout_ms, DEFAULT_TIMEOUT_MS));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
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
  if (!toBoolean(bindings?.skipTlsVerify) && !toBoolean(bindings?.tlsInsecureSkipVerify) && !toBoolean(bindings?.insecureSkipVerify)) return {};
  return { dispatcher: getInsecureTlsDispatcher() };
};

const getInstanceId = (ctx) => String(ctx?.meta?.instance_id || ctx?.meta?.instanceId || 'unknown');

const requireHost = (ctx) => {
  const host = resolveBaseUrl(ctx?.bindings || {});
  if (!host) throw errorWithCode('INVALID_ARGUMENT', 'host is required in bindings');
  return host;
};

const isValidIPv4 = (value) => {
  const raw = String(unwrapScalar(value) ?? '').trim();
  const parts = raw.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
};

const requireIPv4 = (value, field = 'ip') => {
  const ip = String(unwrapScalar(value) ?? '').trim();
  if (!ip) throw errorWithCode('INVALID_ARGUMENT', `${field} is required`);
  if (!isValidIPv4(ip)) throw errorWithCode('INVALID_ARGUMENT', `${field} must be a valid IPv4 address`);
  return ip;
};

const toInteger = (value, fallback = 0) => {
  const num = Number(unwrapScalar(value));
  if (!Number.isFinite(num) || Number.isNaN(num)) return fallback;
  return Math.trunc(num);
};

const toValue = (val) => {
  const raw = unwrapScalar(val);
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string') return { stringValue: raw };
  if (typeof raw === 'number') return { numberValue: raw };
  if (typeof raw === 'boolean') return { boolValue: raw };
  if (Array.isArray(raw)) {
    return { listValue: { values: raw.map((item) => toValue(item)).filter((item) => item !== undefined) } };
  }
  if (typeof raw === 'object') {
    const fields = {};
    for (const [key, value] of Object.entries(raw)) {
      const normalized = toValue(value);
      fields[key] = normalized === undefined ? { nullValue: 'NULL_VALUE' } : normalized;
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(raw) };
};

const appendQuery = (url, params = {}) => {
  const pairs = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  if (pairs.length === 0) return url;
  return url.includes('?') ? `${url}&${pairs.join('&')}` : `${url}?${pairs.join('&')}`;
};

const nowMsString = () => String(Date.now());

const buildCtAbstract = () => {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `CT ${hh}:${mm}:${ss}`;
};

const parseJsonOrThrow = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', 'response is not valid JSON');
  }
};

const fetchJsonEvenOnHttpError = async (ctx, url, init = {}) => {
  const callCtx = resolveCallContext(ctx);
  let res;
  try {
    res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(resolveTimeoutMs(callCtx)),
      ...buildTlsOptions(callCtx.bindings),
      headers: {
        ...(callCtx.bindings?.headers || {}),
        ...(init.headers || {}),
      },
    });
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', err?.cause?.message || err?.message || 'fetch failed');
  }

  const text = await res.text();
  if (!String(text || '').trim()) throw errorWithCode('UNKNOWN', 'response body is empty');
  const json = parseJsonOrThrow(text);
  return { status: toInteger(res.status, 0), text, json, res };
};

const pickCredential = (callCtx, fieldNames, fieldLabel) => {
  const secret = callCtx?.secret || {};
  const config = callCtx?.config || {};
  const bindings = callCtx?.bindings || {};
  for (const field of fieldNames) {
    const value = firstDefined(secret[field], config[field], bindings[field]);
    const text = String(unwrapScalar(value) ?? '').trim();
    if (text) return text;
  }
  throw errorWithCode('INVALID_ARGUMENT', `${fieldLabel} is required`);
};

const getSetCookies = (res) => {
  const headers = res?.headers;
  if (headers && typeof headers.getSetCookie === 'function') {
    const value = headers.getSetCookie();
    return Array.isArray(value) ? value : [];
  }
  if (headers && typeof headers.get === 'function') {
    const combined = headers.get('set-cookie');
    return combined ? [String(combined)] : [];
  }
  return [];
};

const joinCookieHeader = (setCookies) => {
  const parts = [];
  for (const item of setCookies || []) {
    const raw = String(item || '').trim();
    if (!raw) continue;
    const pair = raw.split(';')[0]?.trim();
    if (pair) parts.push(pair);
  }
  return parts.join('; ');
};

const requireSession = (ctx) => {
  const inst = getInstanceId(ctx);
  const session = sessionByInstanceId.get(inst);
  if (!session?.apiKey || !session?.securityKey || !session?.cookie) {
    throw errorWithCode('FAILED_PRECONDITION', 'call Login first');
  }
  return session;
};

const sha256Hex = (input) => createHash('sha256').update(String(input ?? ''), 'utf8').digest('hex');

const buildSignQuery = (session, restUriPath, extra = {}) => {
  const time = nowMsString();
  const message = `security-key:${session.securityKey};api-key:${session.apiKey};time:${time};rest-uri:${restUriPath}`;
  return {
    sign: sha256Hex(message),
    apikey: session.apiKey,
    time,
    ...extra,
  };
};

const toNipsResponse = ({ status, json }) => {
  const code = toInteger(json?.code, 0);
  const message = String(json?.message ?? '');
  return {
    code,
    message,
    data: toValue(json?.data),
    http_status: toInteger(status, 0),
    raw_body: '',
    raw_json: undefined,
  };
};

const handleLogin = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const host = requireHost(callCtx);
  const username = pickCredential(callCtx, ['user', 'username'], 'username');
  const password = pickCredential(callCtx, ['password'], 'password');
  const lang = String(firstDefined(req?.lang, 'zh_CN') || 'zh_CN').trim() || 'zh_CN';
  const inst = getInstanceId(callCtx);

  if (loginInFlightByInstanceId.has(inst)) return await loginInFlightByInstanceId.get(inst);

  const promise = (async () => {
    const url = `${host}${LOGIN_URI}`;
    const { status, text, json, res } = await fetchJsonEvenOnHttpError(callCtx, url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, lang }),
    });

    const code = toInteger(json?.code, 0);
    const message = String(json?.message ?? '');
    const data = json?.data;
    const apiKey = String(data?.api_key ?? '');
    const securityKey = String(data?.security_key ?? '');

    if (code === 2000 && apiKey && securityKey) {
      const cookie = joinCookieHeader(getSetCookies(res));
      if (cookie) {
        sessionByInstanceId.set(inst, {
          cookie,
          apiKey,
          securityKey,
          loginAtMs: Date.now(),
        });
      }
    }

    return {
      code,
      message,
      data: undefined,
      api_key: '',
      security_key: '',
      http_status: toInteger(status, 0),
      raw_body: '',
      raw_json: undefined,
    };
  })().finally(() => {
    loginInFlightByInstanceId.delete(inst);
  });

  loginInFlightByInstanceId.set(inst, promise);
  return await promise;
};

const handleBlockIP = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const host = requireHost(callCtx);
  const session = requireSession(callCtx);
  const ip = requireIPv4(req?.ip, 'ip');
  const direction = String(firstDefined(req?.direction, '1') || '1');
  const threatType = String(firstDefined(req?.threat_type, req?.threatType, '9') || '9');
  const startTime = String(firstDefined(req?.start_time, req?.startTime, '') || '');
  const endTime = String(firstDefined(req?.end_time, req?.endTime, '') || '');
  const abstract = String(firstDefined(req?.abstract, buildCtAbstract()) || buildCtAbstract());
  const url = appendQuery(`${host}${BLACKLIST_URI}`, buildSignQuery(session, BLACKLIST_URI));
  const body = {
    action: 'insert',
    data: {
      name: ip,
      direction,
      start_time: startTime,
      end_time: endTime,
      abstract,
      threat_type: threatType,
    },
  };
  return toNipsResponse(await fetchJsonEvenOnHttpError(callCtx, url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: session.cookie,
    },
    body: JSON.stringify(body),
  }));
};

const handleListBlacklist = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const host = requireHost(callCtx);
  const session = requireSession(callCtx);
  const pageSize = toInteger(firstDefined(req?.page_size, req?.pageSize, 6000), 6000) || 6000;
  const pageNo = toInteger(firstDefined(req?.page_no, req?.pageNo, 1), 1) || 1;
  const url = appendQuery(`${host}${BLACKLIST_URI}`, buildSignQuery(session, BLACKLIST_URI, {
    pageSize: String(pageSize),
    pageNo: String(pageNo),
  }));
  const resp = await fetchJsonEvenOnHttpError(callCtx, url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Cookie: session.cookie,
    },
  });
  const entriesRaw = Array.isArray(resp.json?.data?.data) ? resp.json.data.data : [];
  const entries = entriesRaw
    .map((item) => ({
      id: toInteger(item?.id, 0),
      name: String(item?.name ?? ''),
      start_time: String(item?.start_time ?? ''),
      end_time: String(item?.end_time ?? ''),
      abstract: String(item?.abstract ?? ''),
      enabled: String(item?.enabled ?? ''),
      threat_type: String(item?.threat_type ?? ''),
      raw: toValue(item),
    }))
    .filter((item) => item.id || item.name);
  return {
    ...toNipsResponse(resp),
    entries,
  };
};

const handleUnblockByIds = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const host = requireHost(callCtx);
  const session = requireSession(callCtx);
  const ids = Array.isArray(req?.ids) ? req.ids : [];
  if (ids.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'ids is required');
  const normalizedIds = ids.map((id) => toInteger(id, 0)).filter((id) => id > 0);
  if (normalizedIds.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'ids must contain positive integers');
  const url = appendQuery(`${host}${BLACKLIST_URI}`, buildSignQuery(session, BLACKLIST_URI));
  return toNipsResponse(await fetchJsonEvenOnHttpError(callCtx, url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: session.cookie,
    },
    body: JSON.stringify({ action: 'delete', data: normalizedIds }),
  }));
};

const handleApplyConfig = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const host = requireHost(callCtx);
  const session = requireSession(callCtx);
  const url = appendQuery(`${host}${APPLYCONFIG_URI}`, buildSignQuery(session, APPLYCONFIG_URI));
  return toNipsResponse(await fetchJsonEvenOnHttpError(callCtx, url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: session.cookie,
    },
    body: JSON.stringify({}),
  }));
};

export function rpcdef(ctx) {
  const callCtx = resolveCallContext(ctx);
  return {
    [LOGIN_PATH]: async (req) => handleLogin(req ?? callCtx.req ?? {}, callCtx),
    [BLOCK_PATH]: async (req) => handleBlockIP(req ?? callCtx.req ?? {}, callCtx),
    [LIST_PATH]: async (req) => handleListBlacklist(req ?? callCtx.req ?? {}, callCtx),
    [UNBLOCK_PATH]: async (req) => handleUnblockByIds(req ?? callCtx.req ?? {}, callCtx),
    [APPLY_PATH]: async (req) => handleApplyConfig(req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_LOGIN_FULL]: (ctx = {}) => handleLogin(requestFromContext(ctx), ctx),
  [METHOD_BLOCK_FULL]: (ctx = {}) => handleBlockIP(requestFromContext(ctx), ctx),
  [METHOD_LIST_FULL]: (ctx = {}) => handleListBlacklist(requestFromContext(ctx), ctx),
  [METHOD_UNBLOCK_FULL]: (ctx = {}) => handleUnblockByIds(requestFromContext(ctx), ctx),
  [METHOD_APPLY_FULL]: (ctx = {}) => handleApplyConfig(requestFromContext(ctx), ctx),
};

export const _test = {
  appendQuery,
  buildCtAbstract,
  buildSignQuery,
  buildTlsOptions,
  errorWithCode,
  fetchJsonEvenOnHttpError,
  getInstanceId,
  getSetCookies,
  handleLogin,
  isValidIPv4,
  joinCookieHeader,
  normalizeBaseUrl,
  parseJsonOrThrow,
  requireIPv4,
  resolveBaseUrl,
  resolveTimeoutMs,
  sessionByInstanceId,
  sha256Hex,
  toBoolean,
  toInteger,
  toNipsResponse,
  toValue,
};
