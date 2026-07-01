import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const PACKAGE = 'Ruijie_Behavior_Firewall_R232T0.RuijieBehaviorFirewallR232T0';
export const METHOD_PREFIX = PACKAGE + '/';
export const PATH_PREFIX = '/' + PACKAGE + '/';

export const DEFAULT_APP_ID = 'hybzapi';
export const DEFAULT_MANAGE_PATH = '/api.php/inter/Inter';
export const DEFAULT_REPORT_PATH = '/api_reporter.php/inter/Inter';
export const DEFAULT_TIMEOUT_MS = 8000;

export const OPTS = {
  ListSafePolicies: { scope: 'manage', opt: 'getlistsafepolicy', body: 'filter' },
  AddSafePolicy: { scope: 'manage', opt: 'addsafepolicy', body: 'payload' },
  GetSafePolicy: { scope: 'manage', opt: 'getdetailsafepolicy', body: 'safeKey' },
  EditSafePolicy: { scope: 'manage', opt: 'editsafepolicy', body: 'payload' },
  InsertSafePolicy: { scope: 'manage', opt: 'insertsafepolicy', body: 'payload' },
  MoveSafePolicy: { scope: 'manage', opt: 'movesafepolicy', body: 'moveSafe' },
  SetSafePolicyStatus: { scope: 'manage', opt: 'editstatussafepolicy', body: 'status' },
  DeleteSafePolicy: { scope: 'manage', opt: 'deletesafepolicy', body: 'safeKey' },
  DeleteAllSafePolicies: { scope: 'manage', opt: 'deleteallsafepolicy', body: 'payload' },
  ClearSafePolicyCounters: { scope: 'manage', opt: 'clearcountersafepolicy', body: 'payload' },

  ListSecurityProtectPolicies: { scope: 'manage', opt: 'getlistsecurityprotectpolicy', body: 'page' },
  UpsertSecurityProtectPolicy: { scope: 'manage', opt: 'addsecurityprotectpolicy', body: 'securityProtect' },
  GetSecurityProtectPolicy: { scope: 'manage', opt: 'getdetailsecurityprotectpolicy', body: 'name' },
  MoveSecurityProtectPolicy: { scope: 'manage', opt: 'movesecurityprotectpolicy', body: 'moveSecurityProtect' },
  SetSecurityProtectPolicyStatus: { scope: 'manage', opt: 'editstatussecurityprotectpolicy', body: 'status' },
  DeleteSecurityProtectPolicy: { scope: 'manage', opt: 'deletesecurityprotectpolicy', body: 'name' },
  DeleteAllSecurityProtectPolicies: { scope: 'manage', opt: 'deleteallsecurityprotectpolicy', body: 'payload' },
  ClearSecurityProtectPolicyCounters: { scope: 'manage', opt: 'clearcountersecurityprotectpolicy', body: 'payload' },

  ListIPWhitePolicies: { scope: 'manage', opt: 'getlistwhitepolicy', body: 'filter' },
  AddIPWhitePolicy: { scope: 'manage', opt: 'addwhitepolicy', body: 'payload' },
  GetIPWhitePolicy: { scope: 'manage', opt: 'getdetailwhitepolicy', body: 'name' },
  EditIPWhitePolicy: { scope: 'manage', opt: 'editwhitepolicy', body: 'payload' },
  DeleteIPWhitePolicy: { scope: 'manage', opt: 'deletewhitepolicy', body: 'name' },
  DeleteAllIPWhitePolicies: { scope: 'manage', opt: 'delallwhitepolicy', body: 'payload' },

  ListURLWhitePolicies: { scope: 'manage', opt: 'getlisturlwhitepolicy', body: 'filter' },
  AddURLWhitePolicy: { scope: 'manage', opt: 'addurlwhitepolicy', body: 'payload' },
  GetURLWhitePolicy: { scope: 'manage', opt: 'getdetailurlwhitepolicy', body: 'name' },
  EditURLWhitePolicy: { scope: 'manage', opt: 'editurlwhitepolicy', body: 'payload' },
  SetURLWhitePolicyStatus: { scope: 'manage', opt: 'editstatusurlwhitepolicy', body: 'status' },
  DeleteURLWhitePolicy: { scope: 'manage', opt: 'deleteurlwhitepolicy', body: 'name' },
  DeleteAllURLWhitePolicies: { scope: 'manage', opt: 'delallurlwhitepolicy', body: 'payload' },

  GetDdosLogs: { scope: 'report', opt: 'getlogddos', body: 'securityLog' },
  GetVirusLogs: { scope: 'report', opt: 'getlogvirus', body: 'securityLog' },
  GetIpsLogs: { scope: 'report', opt: 'getlogips', body: 'securityLog' },
  GetWafLogs: { scope: 'report', opt: 'getlogwaf', body: 'securityLog' },
  GetLockedIpLogs: { scope: 'report', opt: 'getloglockip', body: 'lockedIpLog' },
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
  const err = new GrpcError(grpcCodeFor(code), String(message ?? ''));
  err.legacyCode = code;
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

const fromValue = (value) => {
  if (value === undefined || value === null) return undefined;
  if (hasOwn(value, 'structValue')) return fromValue(value.structValue);
  if (hasOwn(value, 'fields')) {
    const out = {};
    for (const [key, inner] of Object.entries(value.fields || {})) out[key] = fromValue(inner);
    return out;
  }
  if (hasOwn(value, 'listValue')) return (value.listValue.values || []).map(fromValue);
  if (hasOwn(value, 'values')) return (value.values || []).map(fromValue);
  if (hasOwn(value, 'nullValue')) return null;
  if (hasOwn(value, 'stringValue')) return value.stringValue;
  if (hasOwn(value, 'numberValue')) return value.numberValue;
  if (hasOwn(value, 'boolValue')) return value.boolValue;
  if (hasOwn(value, 'value')) return fromValue(value.value);
  if (Array.isArray(value)) return value.map(fromValue);
  if (typeof value === 'object') {
    const out = {};
    for (const [key, inner] of Object.entries(value)) out[key] = fromValue(inner);
    return out;
  }
  return value;
};

const toValue = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number') return Number.isFinite(value) ? { numberValue: value } : { stringValue: String(value) };
  if (Array.isArray(value)) return { listValue: { values: value.map((item) => toValue(item) ?? { nullValue: 'NULL_VALUE' }) } };
  if (typeof value === 'object') {
    const fields = {};
    for (const [key, inner] of Object.entries(value)) fields[key] = toValue(inner) ?? { nullValue: 'NULL_VALUE' };
    return { structValue: { fields } };
  }
  return { stringValue: String(value) };
};

const pickString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

const pickFirstString = (...values) => {
  for (const value of values) {
    const text = pickString(value);
    if (text) return text;
  }
  return '';
};

const optionalInt = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = Number(raw);
  return Number.isInteger(num) ? num : undefined;
};

const optionalBool = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return undefined;
};

const cleanObject = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([, value]) => value !== undefined && value !== null && value !== ''));

const mergePayload = (base, extra) => cleanObject({ ...(fromValue(base) || {}), ...(extra || {}) });

const normalizeBaseUrl = (value) => {
  const raw = pickString(value).replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw;
};

const normalizePath = (path, fallback) => {
  const raw = pickString(path) || fallback;
  return raw.startsWith('/') ? raw : '/' + raw;
};

const mergedBindings = (ctx = {}) => ({ ...(ctx.config || {}), ...(ctx.secret || {}), ...(ctx.bindings || {}) });

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits || {},
  meta: ctx.meta || {},
  req: ctx.req || ctx.request || {},
});

const resolveEnv = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const b = callCtx.bindings || {};
  const baseUrl = normalizeBaseUrl(pickFirstString(b.baseUrl, b.manageBaseUrl, b.reportBaseUrl));
  const manageBaseUrl = normalizeBaseUrl(pickFirstString(b.manageBaseUrl, b.baseUrl));
  const reportBaseUrl = normalizeBaseUrl(pickFirstString(b.reportBaseUrl, b.baseUrl));
  if (!manageBaseUrl && !baseUrl) throw errorWithCode('FAILED_PRECONDITION', 'manageBaseUrl or baseUrl must be a valid http(s) URL');
  return {
    manageBaseUrl: manageBaseUrl || baseUrl,
    reportBaseUrl: reportBaseUrl || baseUrl || manageBaseUrl,
    managePath: normalizePath(b.managePath, DEFAULT_MANAGE_PATH),
    reportPath: normalizePath(b.reportPath, DEFAULT_REPORT_PATH),
    appId: pickFirstString(b.appId) || DEFAULT_APP_ID,
    signingSecret: pickFirstString(b.signingSecret),
    timeoutMs: optionalInt(callCtx.limits?.timeoutMs) || optionalInt(b.timeoutMs) || DEFAULT_TIMEOUT_MS,
    strictResponseCode: optionalBool(b.strictResponseCode) ?? true,
    skipTlsVerify: optionalBool(b.skipTlsVerify) || optionalBool(b.tlsInsecureSkipVerify) || false,
    headers: fromValue(b.headers) || {},
  };
};

const stableJson = (body) => JSON.stringify(body ?? {});

const signBody = (bodyJson, timestamp, secret) => crypto.createHmac('md5', secret).update(bodyJson + timestamp).digest('hex');

const buildUrl = (env, scope, opt) => {
  const base = scope === 'report' ? env.reportBaseUrl : env.manageBaseUrl;
  const path = scope === 'report' ? env.reportPath : env.managePath;
  const url = new URL(path, base + '/');
  url.searchParams.set('opt', opt);
  return url.toString();
};

const parseJsonBody = (text) => {
  if (!String(text || '').trim()) return { ok: true, value: null };
  try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false }; }
};

const extractCode = (json) => {
  const raw = json?.code ?? json?.errcode ?? json?.errno ?? json?.status;
  if (raw === undefined || raw === null || raw === '') return 0;
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
};

const extractMessage = (json) => {
  const msg = json?.message ?? json?.msg ?? json?.error ?? json?.errMsg ?? '';
  return typeof msg === 'string' ? msg : JSON.stringify(msg);
};

const mapHttpStatus = (status) => {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'PERMISSION_DENIED';
  if (status >= 400 && status < 500) return 'FAILED_PRECONDITION';
  return 'UNAVAILABLE';
};

const throwStructured = (code, message, detail = {}) => {
  throw errorWithCode(code, JSON.stringify({ code, message, ...detail }));
};

let insecureDispatcher;

const createDispatcher = (env) => {
  if (!env.skipTlsVerify) return undefined;
  if (!insecureDispatcher) {
    insecureDispatcher = new Agent({ connect: { rejectUnauthorized: false } });
  }
  return insecureDispatcher;
};

const callRuijie = async (ctx, scope, opt, body = {}) => {
  const env = resolveEnv(ctx);
  if (!env.signingSecret) throw errorWithCode('FAILED_PRECONDITION', 'signingSecret is required in secret config');
  const bodyJson = stableJson(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers = {
    'content-type': 'application/json',
    ...env.headers,
    HY_BZ_API_APP_ID: env.appId,
    HY_BZ_API_TIMESTAMP: timestamp,
    HY_BZ_API_SIGNATURE: signBody(bodyJson, timestamp, env.signingSecret),
  };
  const init = { method: 'POST', headers, body: bodyJson };
  if (env.timeoutMs > 0) init.signal = AbortSignal.timeout(env.timeoutMs);
  const dispatcher = createDispatcher(env);
  if (dispatcher) init.dispatcher = dispatcher;

  let res;
  try {
    res = await fetch(buildUrl(env, scope, opt), init);
  } catch (err) {
    throwStructured('UNAVAILABLE', 'ruijie upstream request failed', { reason: err?.cause?.message || err?.message || 'fetch failed' });
  }

  const httpStatus = Number(res?.status || 0);
  let rawBody = '';
  try {
    rawBody = await res.text();
  } catch (err) {
    throwStructured('UNAVAILABLE', 'ruijie upstream response read failed', { http_status: httpStatus, reason: err?.message || 'response read failed' });
  }

  const parsed = parseJsonBody(rawBody);
  if (httpStatus < 200 || httpStatus >= 300) {
    throwStructured(mapHttpStatus(httpStatus), 'ruijie upstream http failure', { http_status: httpStatus, raw_body: rawBody });
  }
  if (!parsed.ok) {
    throwStructured('UNKNOWN', 'ruijie response is not valid JSON', { http_status: httpStatus, raw_body: rawBody });
  }
  const code = extractCode(parsed.value);
  const message = extractMessage(parsed.value);
  if (env.strictResponseCode && code !== 0) {
    throwStructured('FAILED_PRECONDITION', 'ruijie upstream business failure', { http_status: httpStatus, raw_body: rawBody, upstream_code: code, upstream_message: message });
  }
  return { http_status: httpStatus, raw_body: rawBody, raw_json: toValue(parsed.value), code, message };
};

const requireName = (req = {}) => {
  const name = pickFirstString(req.name, fromValue(req.payload)?.name);
  if (!name) throw errorWithCode('INVALID_ARGUMENT', 'name is required');
  return name;
};

const buildBody = (kind, req = {}) => {
  switch (kind) {
    case 'payload': return mergePayload(req.payload);
    case 'filter': return mergePayload(req.filter);
    case 'moveSafe': return mergePayload(req.payload, cleanObject({
      name: pickString(req.name),
      position: pickString(req.position),
      target: optionalInt(req.target),
      policy_from: pickString(req.policy_from),
      policy_to: pickString(req.policy_to),
    }));
    case 'moveSecurityProtect': return mergePayload(req.payload, cleanObject({
      name: pickString(req.name),
      position: pickString(req.position),
      target: optionalInt(req.target),
    }));
    case 'name': return mergePayload(req.payload, { name: requireName(req) });
    case 'status': {
      const names = pickFirstString(req.names, fromValue(req.payload)?.names);
      if (!names) throw errorWithCode('INVALID_ARGUMENT', 'names is required');
      return mergePayload(req.payload, { names });
    }
    case 'safeKey': {
      const body = mergePayload(req.payload, {
        rule_name: pickFirstString(req.rule_name, fromValue(req.payload)?.rule_name),
        policy_from: pickFirstString(req.policy_from, fromValue(req.payload)?.policy_from),
        policy_to: pickFirstString(req.policy_to, fromValue(req.payload)?.policy_to),
      });
      if (!body.rule_name && body.name) body.rule_name = body.name;
      if (!body.rule_name) throw errorWithCode('INVALID_ARGUMENT', 'rule_name is required');
      return body;
    }
    case 'page': return mergePayload(req.filter, cleanObject({ page: optionalInt(req.page), pagesize: optionalInt(req.pagesize) }));
    case 'securityProtect': return mergePayload(req.payload, cleanObject({ action: pickString(req.action), name: pickString(req.name), insert_name: pickString(req.insert_name) }));
    case 'securityLog': return mergePayload(req.filter, cleanObject({
      useobj: pickString(req.useobj), group_name: pickString(req.group_name), chlgroup: pickString(req.chlgroup), user_name: pickString(req.user_name),
      ip_from: pickString(req.ip_from), ip_to: pickString(req.ip_to), from_date: pickString(req.from_date), to_date: pickString(req.to_date),
      object_date: pickString(req.object_date), from_time: pickString(req.from_time), to_time: pickString(req.to_time), type: optionalInt(req.type),
      app: optionalInt(req.app), hole_id: optionalInt(req.hole_id), rule_id: pickString(req.rule_id), status_code: optionalInt(req.status_code),
      url: pickString(req.url), pagesize: optionalInt(req.pagesize), pagenum: optionalInt(req.pagenum),
    }));
    case 'lockedIpLog': return mergePayload(req.filter, cleanObject({ ip: pickString(req.ip), from: pickString(req.from), to: pickString(req.to), order: pickString(req.order), pagesize: optionalInt(req.pagesize), pagenum: optionalInt(req.pagenum) }));
    default: return {};
  }
};

const isSdkContext = (value) => Boolean(value && typeof value === 'object' && (hasOwn(value, 'request') || hasOwn(value, 'config') || hasOwn(value, 'secret') || hasOwn(value, 'method')));

const normalizeHandlerArgs = (first = {}, second = undefined) => {
  if (second === undefined && isSdkContext(first)) return { req: first.request || {}, ctx: first };
  return { req: first || {}, ctx: second || {} };
};

const makeHandler = (method) => async (first = {}, second = undefined) => {
  const { req, ctx } = normalizeHandlerArgs(first, second);
  const spec = OPTS[method];
  return callRuijie(ctx, spec.scope, spec.opt, buildBody(spec.body, req));
};

const methodEntries = Object.fromEntries(Object.keys(OPTS).map((method) => [METHOD_PREFIX + method, makeHandler(method)]));

export const handlers = {
  ...methodEntries,
  [METHOD_PREFIX + 'RawManage']: async (first = {}, second = undefined) => {
    const { req, ctx } = normalizeHandlerArgs(first, second);
    const opt = pickString(req.opt);
    if (!opt) throw errorWithCode('INVALID_ARGUMENT', 'opt is required');
    return callRuijie(ctx, 'manage', opt, mergePayload(req.payload));
  },
  [METHOD_PREFIX + 'RawReport']: async (first = {}, second = undefined) => {
    const { req, ctx } = normalizeHandlerArgs(first, second);
    const opt = pickString(req.opt);
    if (!opt) throw errorWithCode('INVALID_ARGUMENT', 'opt is required');
    return callRuijie(ctx, 'report', opt, mergePayload(req.payload));
  },
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return Object.fromEntries(Object.entries(handlers).map(([full, handler]) => ['/' + full, (req) => handler(req ?? callCtx.req ?? {}, callCtx)]));
}

export const _test = {
  buildBody,
  buildUrl,
  callRuijie,
  cleanObject,
  createDispatcher,
  errorWithCode,
  extractCode,
  extractMessage,
  fromValue,
  mergePayload,
  normalizeHandlerArgs,
  normalizeBaseUrl,
  parseJsonBody,
  resolveEnv,
  signBody,
  stableJson,
  toValue,
};
