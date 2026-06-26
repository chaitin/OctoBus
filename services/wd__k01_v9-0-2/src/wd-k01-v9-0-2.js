// 网盾 K01 威胁情报联防阻断系统 V9.0.2 RESTful API 适配（V9 新增接口）。
// 覆盖：攻击监测日志查询、IP 黑白名单查询、私有情报(攻击类)增/删/查。
// 认证沿用 K01 既有方式：login 取 token.access_token → Bearer → logout，每次调用一会话。
import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const SVC = 'WD_K01_V9_0_2.WD_K01_V9_0_2';
export const QUERY_ATTACK_LOG_PATH = `/${SVC}/QueryAttackLog`;
export const QUERY_IPLIST_PATH = `/${SVC}/QueryIPList`;
export const QUERY_INTEL_PATH = `/${SVC}/QueryThreatIntel`;
export const ADD_INTEL_PATH = `/${SVC}/AddThreatIntel`;
export const DELETE_INTEL_PATH = `/${SVC}/DeleteThreatIntel`;

export const METHOD_QUERY_ATTACK_LOG_FULL = `${SVC}/QueryAttackLog`;
export const METHOD_QUERY_IPLIST_FULL = `${SVC}/QueryIPList`;
export const METHOD_QUERY_INTEL_FULL = `${SVC}/QueryThreatIntel`;
export const METHOD_ADD_INTEL_FULL = `${SVC}/AddThreatIntel`;
export const METHOD_DELETE_INTEL_FULL = `${SVC}/DeleteThreatIntel`;

export const LOGIN_PATH = '/api/cms/user/login';
export const LOGOUT_PATH = '/api/cms/user/logout';
export const ATKMNTLOG_QUERY_PATH = '/api/v1/logsystem/atkmntlog/query';
export const IPLIST_QUERY_PATH = '/api/v1/security/iplist/query';
export const INTEL_QUERY_PATH = '/api/v1/threatintelligence/attack/query';
export const INTEL_SAVE_PATH = '/api/v1/threatintelligence/attack/save';
export const INTEL_DELETE_PATH = '/api/v1/threatintelligence/attack/delete';
export const DEFAULT_TIMEOUT_MS = 1500;

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

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const pickStringFrom = (source = {}, keys = []) => {
  for (const key of keys) {
    if (!hasOwn(source, key)) continue;
    const raw = unwrapScalar(source[key]);
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (value) return value;
  }
  return '';
};

const pickFirstString = (values = []) => {
  for (const value of values) {
    const raw = unwrapScalar(value);
    if (raw === undefined || raw === null) continue;
    const str = String(raw).trim();
    if (str) return str;
  }
  return '';
};

const pickInt = (source = {}, keys = [], fallback = 0) => {
  for (const key of keys) {
    if (!hasOwn(source, key)) continue;
    const raw = unwrapScalar(source[key]);
    if (raw === undefined || raw === null || raw === '') continue;
    const num = Number(raw);
    if (Number.isFinite(num)) return Math.trunc(num);
  }
  return fallback;
};

const pickBoolean = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return Number.isNaN(raw) ? undefined : raw !== 0;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) return false;
  }
  return undefined;
};

const pickFirstBoolean = (values = []) => {
  for (const value of values) {
    const bool = pickBoolean(value);
    if (bool !== undefined) return bool;
  }
  return undefined;
};

// 仅保留请求里出现且为非负整数的列表项；用于 type_mask 等 list 参数。
const pickIntList = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return undefined;
  const arr = Array.isArray(raw) ? raw : hasOwn(raw, 'values') && Array.isArray(raw.values) ? raw.values : null;
  if (arr === null) return undefined;
  const out = [];
  for (const item of arr) {
    const num = Number(unwrapScalar(item));
    if (Number.isFinite(num)) out.push(Math.trunc(num));
  }
  return out.length ? out : undefined;
};

const normalizeBaseUrl = (value) => {
  const raw = String(unwrapScalar(value) || '').trim();
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.replace(/\/+$/, '');
};

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: {
    ...(ctx.config ?? {}),
    ...(ctx.secret ?? {}),
    ...(ctx.bindings ?? {}),
  },
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.req ?? ctx.request ?? {},
});

const resolveHost = (bindings = {}) => normalizeBaseUrl(pickFirstString([bindings.host, bindings.restBaseUrl, bindings.baseUrl]));
const resolveUser = (bindings = {}) => pickStringFrom(bindings, ['user', 'username']);
const resolvePassword = (bindings = {}) => pickStringFrom(bindings, ['password']);

const resolveTimeoutMs = (ctx = {}) => {
  const raw = Number(unwrapScalar(ctx.limits?.timeoutMs ?? ctx.bindings?.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

const buildTlsOptions = (bindings = {}) => {
  const enabled = pickFirstBoolean([bindings.skipTlsVerify, bindings.tlsInsecureSkipVerify, bindings.insecureSkipVerify]) || false;
  return enabled ? { skipTlsVerify: true, tlsInsecureSkipVerify: true, insecureSkipVerify: true } : {};
};

const sanitizeHeaders = (headers) => {
  const raw = unwrapScalar(headers);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([key]) => key).map(([key, value]) => [key, String(unwrapScalar(value) ?? '')]));
};

const buildHeaders = (bindings = {}, meta = {}, extra = {}) => ({
  ...sanitizeHeaders(bindings.headers),
  'x-engine-instance': pickFirstString([meta.instance_id, meta.instanceId, 'unknown']),
  'x-request-id': pickFirstString([meta.request_id, meta.requestId, 'unknown']),
  ...extra,
});

const parseJsonBody = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', 'response is not valid JSON');
  }
};

const throwForHttpStatus = (status, text) => {
  if (status === 401 || status === 403) throw errorWithCode('PERMISSION_DENIED', `upstream http ${status}: ${text}`);
  if (status >= 400 && status < 500) throw errorWithCode('FAILED_PRECONDITION', `upstream http ${status}: ${text}`);
  throw errorWithCode('UNAVAILABLE', `upstream http ${status}: ${text}`);
};

const fetchRaw = async (ctx, url, init = {}) => {
  const callCtx = resolveCallContext(ctx);
  let response;
  try {
    response = await fetch(url, {
      timeoutMs: resolveTimeoutMs(callCtx),
      ...buildTlsOptions(callCtx.bindings),
      ...init,
      headers: buildHeaders(callCtx.bindings, callCtx.meta, init.headers || {}),
    });
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', err?.cause?.message || err?.message || 'fetch failed');
  }
  const text = await response.text();
  if (!response.ok) throwForHttpStatus(response.status, text);
  return { text };
};

const fetchJson = async (ctx, url, init = {}) => {
  const { text } = await fetchRaw(ctx, url, init);
  if (!String(text || '').trim()) throw errorWithCode('UNKNOWN', 'response body is empty');
  return { json: parseJsonBody(text), text };
};

const requireBindings = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings || {};
  const host = resolveHost(bindings);
  if (!host) throw errorWithCode('INVALID_ARGUMENT', 'bindings.host is required');
  const user = resolveUser(bindings);
  if (!user) throw errorWithCode('INVALID_ARGUMENT', 'bindings.user/username is required');
  const password = resolvePassword(bindings);
  if (!password) throw errorWithCode('INVALID_ARGUMENT', 'bindings.password is required');
  return { ...callCtx, bindings, host, user, password };
};

const isIPv4 = (value) => {
  const raw = String(value || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255 && part.length <= 3);
};

const requireIpv4 = (value) => {
  const ip = String(unwrapScalar(value) || '').trim();
  if (!ip) throw errorWithCode('INVALID_ARGUMENT', 'ip is required');
  if (!isIPv4(ip)) throw errorWithCode('INVALID_ARGUMENT', 'ip must be a valid IPv4 address');
  return ip;
};

const requirePositiveInt = (value, field) => {
  const num = Number(unwrapScalar(value));
  if (!Number.isInteger(num) || num <= 0) throw errorWithCode('INVALID_ARGUMENT', `${field} must be a positive integer`);
  return num;
};

const logFlow = (ctx = {}, action, details = {}) => {
  const meta = ctx.meta || {};
  const trace = [];
  if (meta.instance_id || meta.instanceId) trace.push(`inst=${meta.instance_id || meta.instanceId}`);
  if (meta.request_id || meta.requestId) trace.push(`req=${meta.request_id || meta.requestId}`);
  const prefix = `[WD_K01_V9_0_2][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
  try {
    console.log(prefix, JSON.stringify(details));
  } catch {
    console.log(prefix, details);
  }
};

const isSemanticSuccess = (json) => json?.success === true || String(json?.msgType || '').trim().toLowerCase() === 'success';

// ---- session ----

const handleLogin = async (ctx = {}) => {
  const callCtx = requireBindings(ctx);
  const started = Date.now();
  const { json, text } = await fetchJson(callCtx, `${callCtx.host}${LOGIN_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ username: callCtx.user, password: callCtx.password }),
  });
  const token = pickStringFrom(json?.token || {}, ['access_token', 'accessToken']);
  if (hasOwn(json, 'error') || !token) {
    logFlow(callCtx, 'Login', { host: callCtx.host, user: callCtx.user, elapsed_ms: Date.now() - started, success: false });
    throw errorWithCode('FAILED_PRECONDITION', '用户登录失败');
  }
  logFlow(callCtx, 'Login', { host: callCtx.host, user: callCtx.user, elapsed_ms: Date.now() - started, success: true });
  return { token, raw: text };
};

const handleLogout = async (ctx = {}, token) => {
  const callCtx = requireBindings(ctx);
  const { text } = await fetchRaw(callCtx, `${callCtx.host}${LOGOUT_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${token}` },
  });
  logFlow(callCtx, 'Logout', { host: callCtx.host, user: callCtx.user, success: true });
  return text;
};

const withSession = async (ctx = {}, actionFn) => {
  const login = await handleLogin(ctx);
  let logoutText = '';
  try {
    const result = await actionFn(login);
    try {
      logoutText = await handleLogout(ctx, login.token);
    } catch (err) {
      logoutText = err?.message || String(err);
      logFlow(resolveCallContext(ctx), 'Logout', { success: false, error: logoutText });
    }
    return { result, loginRaw: login.raw, logoutText };
  } catch (err) {
    try {
      await handleLogout(ctx, login.token);
    } catch (logoutErr) {
      logFlow(resolveCallContext(ctx), 'Logout', { success: false, error: logoutErr?.message || String(logoutErr) });
    }
    throw err;
  }
};

// ---- upstream callers ----

const callBusiness = async (ctx, token, path, payload) => {
  const { json, text } = await fetchJson(ctx, `${ctx.host}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  return { json, text };
};

const toQueryResult = (json, text) => {
  const data = json?.data && typeof json.data === 'object' ? json.data : {};
  return {
    success: isSemanticSuccess(json),
    msg_type: String(json?.msgType || ''),
    msg: String(json?.msg || ''),
    total: pickInt(data, ['total'], 0),
    page: pickInt(data, ['page'], 0),
    count: pickInt(data, ['count'], 0),
    raw_json: text,
  };
};

const toMutationResult = (json, text) => ({
  success: isSemanticSuccess(json),
  msg_type: String(json?.msgType || ''),
  msg: String(json?.msg || ''),
  id: pickInt(json, ['id'], 0),
  raw_json: text,
});

// ---- request builders ----

const buildAttackLogPayload = (req = {}) => {
  const payload = {
    method: 'query',
    page: pickInt(req, ['page'], 1),
    count: pickInt(req, ['count'], 10),
  };
  const typeMask = pickIntList(req.type_mask ?? req.typeMask);
  if (typeMask) payload.type_mask = typeMask;
  const severityMask = pickIntList(req.severity_mask ?? req.severityMask);
  if (severityMask) payload.severity_mask = severityMask;
  const partyMask = pickIntList(req.party_3rd_mask ?? req.party3rdMask);
  if (partyMask) payload.party_3rd_mask = partyMask;
  const actionMask = pickIntList(req.action_mask ?? req.actionMask);
  if (actionMask) payload.action_mask = actionMask;
  const rSip = pickStringFrom(req, ['r_sip', 'rSip']);
  if (rSip) payload.r_sip = rSip;
  const rDip = pickStringFrom(req, ['r_dip', 'rDip']);
  if (rDip) payload.r_dip = rDip;
  const country = pickInt(req, ['country'], 0);
  if (country) payload.country = country;
  const province = pickInt(req, ['province'], 0);
  if (province) payload.province = province;
  const sTime = pickStringFrom(req, ['r_s_time', 'rSTime']);
  if (sTime) payload.r_s_time = sTime;
  const eTime = pickStringFrom(req, ['r_e_time', 'rETime']);
  if (eTime) payload.r_e_time = eTime;
  return payload;
};

const buildIPListPayload = (req = {}) => {
  const color = pickInt(req, ['color'], 0);
  if (color !== 0 && color !== 1) throw errorWithCode('INVALID_ARGUMENT', 'color must be 0 (black) or 1 (white)');
  const dir = pickInt(req, ['dir'], 2);
  if (![0, 1, 2].includes(dir)) throw errorWithCode('INVALID_ARGUMENT', 'dir must be 0, 1, or 2');
  const payload = {
    page: pickInt(req, ['page'], 1),
    count: pickInt(req, ['count'], 10),
    color,
    dir,
  };
  const ipSearch = pickStringFrom(req, ['ip_search', 'ipSearch', 'Ip_Search']);
  if (ipSearch) payload.Ip_Search = ipSearch;
  const commentSearch = pickStringFrom(req, ['comment_search', 'commentSearch', 'Comment_Search']);
  if (commentSearch) payload.Comment_Search = commentSearch;
  const sTime = pickStringFrom(req, ['r_s_time', 'rSTime']);
  if (sTime) payload.r_s_time = sTime;
  const eTime = pickStringFrom(req, ['r_e_time', 'rETime']);
  if (eTime) payload.r_e_time = eTime;
  return payload;
};

const buildIntelQueryPayload = (req = {}) => {
  const payload = {
    page: pickInt(req, ['page'], 1),
    count: pickInt(req, ['count'], 10),
  };
  const sourceId = pickInt(req, ['source_id', 'sourceId'], 0);
  if (sourceId) payload.source_id = sourceId;
  return payload;
};

const buildIntelAddPayload = (req = {}) => ({
  ip: requireIpv4(req.ip ?? req.IP),
  type: requirePositiveInt(req.type, 'type'),
  severity: requirePositiveInt(req.severity, 'severity'),
  method: 'add',
});

const buildIntelDeletePayload = (req = {}) => ({
  id: requirePositiveInt(req.id, 'id'),
  method: 'delete',
});

// ---- runners ----

const runQuery = async (req, ctx, action, path, buildPayload) => {
  const callCtx = resolveCallContext({ ...ctx, req: { ...(ctx.req || {}), ...(req || {}) } });
  const bound = requireBindings(callCtx);
  const payload = buildPayload(bound.req || {});
  const { result, loginRaw, logoutText } = await withSession(bound, (login) =>
    callBusiness(bound, login.token, path, payload).then(({ json, text }) => {
      const out = toQueryResult(json, text);
      logFlow(bound, action, { host: bound.host, success: out.success, total: out.total });
      if (!out.success) throw errorWithCode('FAILED_PRECONDITION', String(out.msg || `${action} failed`));
      return out;
    }));
  return { ...result, login_raw_json: loginRaw, logout_raw_text: logoutText };
};

const runMutation = async (req, ctx, action, path, buildPayload) => {
  const callCtx = resolveCallContext({ ...ctx, req: { ...(ctx.req || {}), ...(req || {}) } });
  const bound = requireBindings(callCtx);
  const payload = buildPayload(bound.req || {});
  const { result, loginRaw, logoutText } = await withSession(bound, (login) =>
    callBusiness(bound, login.token, path, payload).then(({ json, text }) => {
      const out = toMutationResult(json, text);
      logFlow(bound, action, { host: bound.host, success: out.success, id: out.id });
      if (!out.success) throw errorWithCode('FAILED_PRECONDITION', String(out.msg || `${action} failed`));
      return out;
    }));
  return { ...result, login_raw_json: loginRaw, logout_raw_text: logoutText };
};

const runQueryAttackLog = (req = {}, ctx = {}) => runQuery(req, ctx, 'QueryAttackLog', ATKMNTLOG_QUERY_PATH, buildAttackLogPayload);
const runQueryIPList = (req = {}, ctx = {}) => runQuery(req, ctx, 'QueryIPList', IPLIST_QUERY_PATH, buildIPListPayload);
const runQueryThreatIntel = (req = {}, ctx = {}) => runQuery(req, ctx, 'QueryThreatIntel', INTEL_QUERY_PATH, buildIntelQueryPayload);
const runAddThreatIntel = (req = {}, ctx = {}) => runMutation(req, ctx, 'AddThreatIntel', INTEL_SAVE_PATH, buildIntelAddPayload);
const runDeleteThreatIntel = (req = {}, ctx = {}) => runMutation(req, ctx, 'DeleteThreatIntel', INTEL_DELETE_PATH, buildIntelDeletePayload);

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  const pick = (req) => req ?? callCtx.req;
  return {
    [QUERY_ATTACK_LOG_PATH]: async (req) => runQueryAttackLog(pick(req), callCtx),
    [QUERY_IPLIST_PATH]: async (req) => runQueryIPList(pick(req), callCtx),
    [QUERY_INTEL_PATH]: async (req) => runQueryThreatIntel(pick(req), callCtx),
    [ADD_INTEL_PATH]: async (req) => runAddThreatIntel(pick(req), callCtx),
    [DELETE_INTEL_PATH]: async (req) => runDeleteThreatIntel(pick(req), callCtx),
  };
}

export const handlers = {
  [METHOD_QUERY_ATTACK_LOG_FULL]: (req, ctx = {}) => runQueryAttackLog(req, ctx),
  [METHOD_QUERY_IPLIST_FULL]: (req, ctx = {}) => runQueryIPList(req, ctx),
  [METHOD_QUERY_INTEL_FULL]: (req, ctx = {}) => runQueryThreatIntel(req, ctx),
  [METHOD_ADD_INTEL_FULL]: (req, ctx = {}) => runAddThreatIntel(req, ctx),
  [METHOD_DELETE_INTEL_FULL]: (req, ctx = {}) => runDeleteThreatIntel(req, ctx),
};

export const _test = {
  buildAttackLogPayload,
  buildHeaders,
  buildIPListPayload,
  buildIntelAddPayload,
  buildIntelDeletePayload,
  buildIntelQueryPayload,
  buildTlsOptions,
  callBusiness,
  errorWithCode,
  fetchJson,
  fetchRaw,
  grpcCodeFor,
  handleLogin,
  handleLogout,
  hasOwn,
  isIPv4,
  isSemanticSuccess,
  normalizeBaseUrl,
  parseJsonBody,
  pickBoolean,
  pickFirstBoolean,
  pickFirstString,
  pickInt,
  pickIntList,
  pickStringFrom,
  requireBindings,
  requireIpv4,
  requirePositiveInt,
  resolveCallContext,
  resolveHost,
  resolvePassword,
  resolveTimeoutMs,
  resolveUser,
  sanitizeHeaders,
  throwForHttpStatus,
  toMutationResult,
  toQueryResult,
  unwrapScalar,
  withSession,
};
