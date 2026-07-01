import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const CHECK_ONLINE_PATH = '/Imperva_WAF_Gateway_v13_6_90.Imperva_WAF_Gateway_v13_6_90/CheckOnline';
export const BLOCK_IP_PATH = '/Imperva_WAF_Gateway_v13_6_90.Imperva_WAF_Gateway_v13_6_90/BlockIP';
export const LIST_BLOCKED_IPS_PATH = '/Imperva_WAF_Gateway_v13_6_90.Imperva_WAF_Gateway_v13_6_90/ListBlockedIPs';
export const UNBLOCK_IP_PATH = '/Imperva_WAF_Gateway_v13_6_90.Imperva_WAF_Gateway_v13_6_90/UnblockIP';

export const METHOD_CHECK_ONLINE_FULL = 'Imperva_WAF_Gateway_v13_6_90.Imperva_WAF_Gateway_v13_6_90/CheckOnline';
export const METHOD_BLOCK_IP_FULL = 'Imperva_WAF_Gateway_v13_6_90.Imperva_WAF_Gateway_v13_6_90/BlockIP';
export const METHOD_LIST_BLOCKED_IPS_FULL = 'Imperva_WAF_Gateway_v13_6_90.Imperva_WAF_Gateway_v13_6_90/ListBlockedIPs';
export const METHOD_UNBLOCK_IP_FULL = 'Imperva_WAF_Gateway_v13_6_90.Imperva_WAF_Gateway_v13_6_90/UnblockIP';

export const DEFAULT_API_VERSION = 'v1';
export const DEFAULT_PORT = 8083;
export const DEFAULT_TIMEOUT_MS = 300_000;
export const DEFAULT_IP_GROUP_NAME = 'OctoBus黑名单IP组';
export const DEFAULT_POLICY_NAME = 'OctoBus黑名单策略';
let insecureDispatcherPromise;

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message, details) => {
  const finalMessage = details === undefined ? String(message) : JSON.stringify({ code, message, ...details });
  const err = new GrpcError(grpcCodeFor(code), finalMessage);
  err.legacyCode = code;
  if (details !== undefined) err.details = details;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);
const hasSdkContextShape = (value) => {
  if (value === undefined || value === null || typeof value !== 'object') return false;
  return ['request', 'req', 'config', 'secret', 'bindings', 'meta', 'limits'].some((key) => hasOwn(value, key));
};

const resolveHandlerArgs = (reqOrCtx = {}, maybeCtx = {}) => {
  if (maybeCtx && Object.keys(maybeCtx).length > 0) {
    return { req: reqOrCtx ?? {}, ctx: maybeCtx };
  }
  if (hasSdkContextShape(reqOrCtx)) {
    return {
      req: reqOrCtx.request ?? reqOrCtx.req ?? {},
      ctx: reqOrCtx,
    };
  }
  return { req: reqOrCtx ?? {}, ctx: maybeCtx ?? {} };
};

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return String(value);
};

const trimString = (value) => unwrapScalar(value).trim();

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

const resolveTimeoutMs = (ctx = {}) => {
  const bindings = mergedBindings(ctx);
  const raw = Number(firstDefined(ctx.limits?.timeoutMs, bindings.timeoutMs, bindings.timeout_ms, DEFAULT_TIMEOUT_MS));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

const toBase64 = (value) => Buffer.from(String(value), 'utf8').toString('base64');

const normalizeHost = (value) => {
  const raw = trimString(value);
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, '');
  return `https://${raw.replace(/\/+$/, '')}`;
};

const splitHostAndPort = (host, port) => {
  const normalized = normalizeHost(host);
  if (!normalized) return '';
  const url = new URL(normalized);
  if (!url.port && port !== undefined && port !== null && port !== '') {
    url.port = String(port);
  } else if (!url.port && url.protocol === 'https:') {
    url.port = String(DEFAULT_PORT);
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/+$/, '');
};

const resolveHost = (bindings = {}) => {
  for (const key of ['host', 'restBaseUrl', 'rest_base_url', 'baseUrl', 'base_url', 'endpoint']) {
    const value = splitHostAndPort(bindings[key], bindings.port);
    if (value) return value;
  }
  return '';
};

const requireHost = (bindings) => {
  const host = resolveHost(bindings);
  if (!host) throw errorWithCode('INVALID_ARGUMENT', 'host is required in bindings');
  return host;
};

const requireUsername = (bindings) => {
  const username = trimString(firstDefined(bindings.username, bindings.user));
  if (!username) throw errorWithCode('INVALID_ARGUMENT', 'username is required in bindings');
  return username;
};

const requirePassword = (bindings) => {
  const password = trimString(bindings.password);
  if (!password) throw errorWithCode('INVALID_ARGUMENT', 'password is required in bindings');
  return password;
};

const requireIPGroupName = (bindings) => {
  return trimString(firstDefined(bindings.ipGroupName, bindings.ip_group_name, bindings.groupName, bindings.group_name, DEFAULT_IP_GROUP_NAME)) || DEFAULT_IP_GROUP_NAME;
};

const requirePolicyName = (bindings) => {
  return trimString(firstDefined(bindings.policyName, bindings.policy_name, bindings.blockPolicyName, bindings.block_policy_name, DEFAULT_POLICY_NAME)) || DEFAULT_POLICY_NAME;
};

const resolveApiVersion = (bindings = {}) => trimString(firstDefined(bindings.apiVersion, bindings.api_version, DEFAULT_API_VERSION)) || DEFAULT_API_VERSION;

const buildApiUrl = (ctx, path) => {
  const bindings = ctx.bindings || {};
  const host = requireHost(bindings);
  const apiVersion = resolveApiVersion(bindings);
  const cleanPath = String(path || '').startsWith('/') ? path : `/${path}`;
  return `${host}/SecureSphere/api/${apiVersion}${cleanPath}`;
};

const shouldSkipTlsVerify = (bindings = {}) => Boolean(bindings.skipTlsVerify || bindings.tlsInsecureSkipVerify || bindings.insecureSkipVerify);

const createTlsDispatcher = async (skipTlsVerify) => {
  if (!skipTlsVerify) return undefined;
  insecureDispatcherPromise ??= import('undici').then(({ Agent }) => new Agent({
    connect: { rejectUnauthorized: false },
  }));
  return insecureDispatcherPromise;
};

const buildTlsOptions = async (bindings = {}) => {
  const dispatcher = await createTlsDispatcher(shouldSkipTlsVerify(bindings));
  return dispatcher ? { dispatcher } : {};
};

const fetchWithTimeout = async (url, init = {}, options = {}) => {
  const rawTimeout = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const parentSignal = init.signal;
  const abortFromParent = () => controller.abort(parentSignal.reason);
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else if (typeof parentSignal.addEventListener === 'function') {
      parentSignal.addEventListener('abort', abortFromParent, { once: true });
    }
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const tlsOptions = await buildTlsOptions(options.bindings);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      ...tlsOptions,
    });
  } finally {
    clearTimeout(timer);
    if (parentSignal && typeof parentSignal.removeEventListener === 'function') {
      parentSignal.removeEventListener('abort', abortFromParent);
    }
  }
};

const buildHeaders = (bindings = {}, meta = {}, extra = {}) => ({
  ...(bindings.headers || {}),
  'Content-Type': 'application/json',
  'x-engine-instance': meta.instance_id || meta.instanceId || 'unknown',
  'x-request-id': meta.request_id || meta.requestId || 'unknown',
  ...extra,
});

const parseJsonSafe = (text) => {
  const raw = String(text ?? '').trim();
  if (!raw) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, value: null };
  }
};

const toValue = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return { nullValue: 'NULL_VALUE' };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return Number.isFinite(value) ? { numberValue: value } : { stringValue: String(value) };
  if (typeof value === 'boolean') return { boolValue: value };
  if (Array.isArray(value)) return { listValue: { values: value.map((item) => toValue(item)).filter((item) => item !== undefined) } };
  if (typeof value === 'object') {
    const fields = {};
    for (const [key, item] of Object.entries(value)) {
      const mapped = toValue(item);
      if (mapped !== undefined) fields[key] = mapped;
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(value) };
};

const mapHTTPErrorCode = (status) => {
  if (status === 401 || status === 403) return 'PERMISSION_DENIED';
  if (status >= 400 && status < 500) return 'FAILED_PRECONDITION';
  return 'UNAVAILABLE';
};

const isMXNotFoundError = (err) => {
  if (!(err instanceof GrpcError)) return false;
  const status = err.details?.http_status;
  if (status === 404) return true;
  if (status !== 406) return false;
  const errors = Array.isArray(err.details?.raw_json?.errors) ? err.details.raw_json.errors : [];
  return errors.some((item) => item?.['error-code'] === 'IMP-10601' || /not found|未找到/i.test(String(item?.description || '')));
};

const logFlow = (ctx, action, details) => {
  const meta = ctx.meta || {};
  const trace = [];
  if (meta.instance_id || meta.instanceId) trace.push(`inst=${meta.instance_id || meta.instanceId}`);
  if (meta.request_id || meta.requestId) trace.push(`req=${meta.request_id || meta.requestId}`);
  const prefix = `[Imperva_WAF_Gateway_v13_6_90][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
  try {
    console.log(prefix, JSON.stringify(details));
  } catch {
    console.log(prefix, details);
  }
};

const requestJson = async (ctx, method, path, headers, body) => {
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings || {};
  const url = buildApiUrl(callCtx, path);
  const init = {
    method,
    headers: buildHeaders(bindings, callCtx.meta, headers),
  };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);

  logFlow(callCtx, `${method}:start`, { url });
  let res;
  try {
    res = await fetchWithTimeout(url, init, { timeoutMs: resolveTimeoutMs(callCtx), bindings });
  } catch (err) {
    const reason = err?.cause?.message || err?.message || 'fetch failed';
    logFlow(callCtx, `${method}:fetch_error`, { url, reason });
    throw errorWithCode('UNAVAILABLE', `upstream error: ${reason}`);
  }

  const text = await res.text();
  const parsed = parseJsonSafe(text);
  if (!parsed.ok) {
    logFlow(callCtx, `${method}:protocol_error`, { http_status: res.status, reason: 'invalid_json' });
    throw errorWithCode('UNKNOWN', 'response is not valid JSON', { http_status: res.status, raw_body: '', raw_body_length: text.length });
  }
  if (res.status < 200 || res.status >= 300) {
    const code = mapHTTPErrorCode(res.status);
    logFlow(callCtx, `${method}:http_error`, { http_status: res.status });
    throw errorWithCode(code, `upstream http ${res.status}`, { http_status: res.status, raw_body: '', raw_body_length: text.length });
  }
  return { httpStatus: res.status, rawBody: text, rawJson: parsed.value };
};

const authenticate = async (ctx) => {
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings || {};
  const username = requireUsername(bindings);
  const password = requirePassword(bindings);
  const result = await requestJson(callCtx, 'POST', '/auth/session', {
    Authorization: `Basic ${toBase64(`${username}:${password}`)}`,
  });
  const sessionId = trimString(firstDefined(result.rawJson?.['session-id'], result.rawJson?.sessionId));
  if (!sessionId) {
    throw errorWithCode('PERMISSION_DENIED', 'failed authenticating to MX', {
      http_status: result.httpStatus,
      raw_json: undefined,
    });
  }
  return { cookie: sessionId, login: result };
};

const mxApi = async (ctx, method, path, body) => {
  const callCtx = resolveCallContext(ctx);
  const session = await authenticate(callCtx);
  return requestJson(callCtx, method, path, { Cookie: session.cookie }, body);
};

const mxApiWithSession = async (ctx, session, method, path, body) => {
  const callCtx = resolveCallContext(ctx);
  return requestJson(callCtx, method, path, { Cookie: session.cookie }, body);
};

const arrayFromField = (obj, ...keys) => {
  for (const key of keys) {
    const value = obj?.[key];
    if (Array.isArray(value)) return value;
  }
  return [];
};

const isIPv4 = (value) => {
  const raw = trimString(value);
  const parts = raw.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255 && part.length <= 3);
};

const isIPv6 = (value) => {
  const raw = trimString(value);
  if (!raw.includes(':')) return false;
  if (!/^[0-9a-fA-F:]+$/.test(raw)) return false;
  if ((raw.match(/::/g) || []).length > 1) return false;
  const parts = raw.split(':');
  if (parts.length > 8) return false;
  return parts.every((part) => part === '' || /^[0-9a-fA-F]{1,4}$/.test(part));
};

const requireIP = (value) => {
  const ip = trimString(value);
  if (!ip) throw errorWithCode('INVALID_ARGUMENT', 'ip is required');
  if (!isIPv4(ip) && !isIPv6(ip)) throw errorWithCode('INVALID_ARGUMENT', 'ip must be a valid IPv4 or IPv6 address');
  return ip;
};

const ipGroupPath = (name) => `/conf/ipGroups/${encodeURIComponent(name)}`;
const webServiceCustomPolicyPath = (name) => `/conf/webServiceCustomPolicies/${encodeURIComponent(name)}`;

const buildIPEntry = (ip, operation) => ({
  type: 'single',
  ipAddressFrom: ip,
  ipAddressTo: ip,
  networkAddress: null,
  cidrMask: null,
  operation,
});

const normalizeIPEntry = (entry) => {
  if (typeof entry === 'string') return { ip: entry, comment: '', created_at: '', raw_json: undefined };
  const ip = trimString(firstDefined(entry?.ipAddressFrom, entry?.ipAddressTo, entry?.networkAddress, entry?.ip, entry?.address));
  if (!ip) return null;
  return {
    ip,
    comment: trimString(firstDefined(entry?.comment, entry?.description, '')),
    created_at: trimString(firstDefined(entry?.created_at, entry?.createdAt, entry?.created, '')),
    raw_json: undefined,
  };
};

const ensureIPGroup = async (ctx, session) => {
  const callCtx = resolveCallContext(ctx);
  const groupName = requireIPGroupName(callCtx.bindings || {});
  const path = ipGroupPath(groupName);
  try {
    return { created: false, group: await mxApiWithSession(callCtx, session, 'GET', path) };
  } catch (err) {
    if (!isMXNotFoundError(err)) {
      throw err;
    }
  }
  const created = await mxApiWithSession(callCtx, session, 'POST', path, { entries: [] });
  return { created: true, group: created };
};

const discoverWebServiceTargets = async (ctx, session) => {
  const callCtx = resolveCallContext(ctx);
  const sitesResult = await mxApiWithSession(callCtx, session, 'GET', '/conf/sites');
  const sites = arrayFromField(sitesResult.rawJson, 'sites');
  const targets = [];

  for (const siteName of sites) {
    const serverGroupsResult = await mxApiWithSession(callCtx, session, 'GET', `/conf/serverGroups/${encodeURIComponent(siteName)}`);
    const serverGroups = arrayFromField(serverGroupsResult.rawJson, 'server-groups', 'serverGroups', 'names');
    for (const serverGroupName of serverGroups) {
      const webServicesResult = await mxApiWithSession(
        callCtx,
        session,
        'GET',
        `/conf/webServices/${encodeURIComponent(siteName)}/${encodeURIComponent(serverGroupName)}`,
      );
      const webServices = arrayFromField(webServicesResult.rawJson, 'web-services', 'webServices', 'names');
      for (const webServiceName of webServices) {
        targets.push({ siteName, serverGroupName, webServiceName });
      }
    }
  }

  return targets;
};

const buildWebServiceBlockPolicy = (bindings, applyTo) => {
  const groupName = requireIPGroupName(bindings);
  const policyName = requirePolicyName(bindings);
  if (!Array.isArray(applyTo) || applyTo.length === 0) {
    throw errorWithCode('FAILED_PRECONDITION', 'no web services found for policy applyTo');
  }
  const severity = trimString(firstDefined(bindings.policySeverity, bindings.policy_severity, 'high')) || 'high';
  const followedAction = trimString(firstDefined(bindings.followedAction, bindings.followed_action, ''));
  const displayResponsePage = firstDefined(bindings.displayResponsePage, bindings.display_response_page, true) !== false;
  const oneAlertPerSession = firstDefined(bindings.oneAlertPerSession, bindings.one_alert_per_session, false) === true;

  const body = {
    enabled: true,
    severity,
    action: 'block',
    displayResponsePage,
    oneAlertPerSession,
    applyTo,
    matchCriteria: [{
      type: 'sourceIpAddresses',
      operation: 'atLeastOne',
      ipGroups: [groupName],
    }],
  };
  if (followedAction) body.followedAction = followedAction;
  return { name: policyName, body };
};

const keyForApplyTo = (item) => `${item?.siteName}\u0000${item?.serverGroupName}\u0000${item?.webServiceName}`;

const buildApplyToChange = (current = [], desired = []) => {
  const currentMap = new Map(current.map((item) => [keyForApplyTo(item), item]));
  const desiredMap = new Map(desired.map((item) => [keyForApplyTo(item), item]));
  const changes = [];
  for (const [key, item] of desiredMap) {
    if (!currentMap.has(key)) changes.push({ ...item, operation: 'add' });
  }
  for (const [key, item] of currentMap) {
    if (!desiredMap.has(key)) changes.push({
      siteName: item.siteName,
      serverGroupName: item.serverGroupName,
      webServiceName: item.webServiceName,
      operation: 'remove',
    });
  }
  return changes;
};

const ensureWebServiceBlockPolicy = async (ctx, session) => {
  const callCtx = resolveCallContext(ctx);
  const applyTo = await discoverWebServiceTargets(callCtx, session);
  const { name, body } = buildWebServiceBlockPolicy(callCtx.bindings || {}, applyTo);
  const path = webServiceCustomPolicyPath(name);
  try {
    const current = await mxApiWithSession(callCtx, session, 'GET', path);
    if (current.rawJson?.enabled !== true) {
      await mxApiWithSession(callCtx, session, 'PUT', path, { enabled: true });
    }
    if (current.rawJson?.action !== 'block') {
      await mxApiWithSession(callCtx, session, 'PUT', path, { action: 'block' });
    }
    const currentApplyTo = arrayFromField(current.rawJson, 'applyTo');
    const applyToChange = buildApplyToChange(currentApplyTo, applyTo);
    if (applyToChange.length > 0) {
      await mxApiWithSession(callCtx, session, 'PUT', path, { applyTo: applyToChange });
    }
    return { created: false, policy: current };
  } catch (err) {
    if (!isMXNotFoundError(err)) {
      throw err;
    }
  }
  const created = await mxApiWithSession(callCtx, session, 'POST', path, body);
  return { created: true, policy: created };
};

const checkOnline = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const result = await mxApi(callCtx, 'GET', '/administration/version');
  return {
    success: true,
    http_status: result.httpStatus,
    message: trimString(firstDefined(result.rawJson?.serverVersion, result.rawJson?.version, '')),
    raw_body: '',
    raw_json: undefined,
  };
};

const blockIP = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const ip = requireIP(firstDefined(req.ip, req.IP));
  const groupName = requireIPGroupName(callCtx.bindings);
  const session = await authenticate(callCtx);
  await ensureIPGroup(callCtx, session);
  await ensureWebServiceBlockPolicy(callCtx, session);
  const entry = buildIPEntry(ip, 'add');
  const result = await mxApiWithSession(callCtx, session, 'PUT', ipGroupPath(groupName), { entries: [entry] });
  return {
    success: true,
    http_status: result.httpStatus,
    message: trimString(firstDefined(result.rawJson?.message, result.rawJson?.msg, '')),
    raw_body: '',
    raw_json: undefined,
  };
};

const listBlockedIPs = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const groupName = requireIPGroupName(callCtx.bindings);
  const result = await mxApi(callCtx, 'GET', ipGroupPath(groupName));
  const entries = Array.isArray(result.rawJson?.entries) ? result.rawJson.entries : [];
  return {
    items: entries.map(normalizeIPEntry).filter(Boolean),
    http_status: result.httpStatus,
    raw_body: '',
    raw_json: undefined,
  };
};

const unblockIP = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const ip = requireIP(firstDefined(req.ip, req.IP));
  const groupName = requireIPGroupName(callCtx.bindings);
  const entry = buildIPEntry(ip, 'remove');
  const result = await mxApi(callCtx, 'PUT', ipGroupPath(groupName), { entries: [entry] });
  return {
    success: true,
    http_status: result.httpStatus,
    message: trimString(firstDefined(result.rawJson?.message, result.rawJson?.msg, '')),
    raw_body: '',
    raw_json: undefined,
  };
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [CHECK_ONLINE_PATH]: async (req) => checkOnline(req ?? callCtx.req ?? {}, callCtx),
    [BLOCK_IP_PATH]: async (req) => blockIP(req ?? callCtx.req ?? {}, callCtx),
    [LIST_BLOCKED_IPS_PATH]: async (req) => listBlockedIPs(req ?? callCtx.req ?? {}, callCtx),
    [UNBLOCK_IP_PATH]: async (req) => unblockIP(req ?? callCtx.req ?? {}, callCtx),
  };
}

const adaptSdkHandler = (method) => async (reqOrCtx = {}, maybeCtx = {}) => {
  const { req, ctx } = resolveHandlerArgs(reqOrCtx, maybeCtx);
  return method(req, ctx);
};

export const handlers = {
  [METHOD_CHECK_ONLINE_FULL]: adaptSdkHandler(checkOnline),
  [METHOD_BLOCK_IP_FULL]: adaptSdkHandler(blockIP),
  [METHOD_LIST_BLOCKED_IPS_FULL]: adaptSdkHandler(listBlockedIPs),
  [METHOD_UNBLOCK_IP_FULL]: adaptSdkHandler(unblockIP),
};

export const _test = {
  authenticate,
  arrayFromField,
  blockIP,
  buildApplyToChange,
  buildApiUrl,
  buildHeaders,
  buildIPEntry,
  buildTlsOptions,
  buildWebServiceBlockPolicy,
  checkOnline,
  createTlsDispatcher,
  discoverWebServiceTargets,
  ensureIPGroup,
  ensureWebServiceBlockPolicy,
  errorWithCode,
  fetchWithTimeout,
  firstDefined,
  hasOwn,
  hasSdkContextShape,
  ipGroupPath,
  isIPv4,
  isIPv6,
  isMXNotFoundError,
  listBlockedIPs,
  mxApi,
  normalizeHost,
  normalizeIPEntry,
  parseJsonSafe,
  requestJson,
  resolveHandlerArgs,
  requireIP,
  requireIPGroupName,
  requirePolicyName,
  resolveCallContext,
  resolveHost,
  resolveTimeoutMs,
  shouldSkipTlsVerify,
  splitHostAndPort,
  toBase64,
  toValue,
  trimString,
  unblockIP,
  webServiceCustomPolicyPath,
  unwrapScalar,
};
