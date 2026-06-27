// Chaitin Answer-Platform (全悉) Advanced Threat Analysis & Warning System
// JSON-RPC 2.0 proxy over HTTP with cookie-based session management.

import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

// --- Method path constants ---

const LOGIN_PATH = '/Answer_Platform.Answer_Platform/Login';
const SEARCH_ALARMS_PATH = '/Answer_Platform.Answer_Platform/SearchAlarms';
const GET_ALARM_PATH = '/Answer_Platform.Answer_Platform/GetAlarm';
const SEARCH_BLOCK_RULES_PATH = '/Answer_Platform.Answer_Platform/SearchBlockRules';
const CREATE_BLOCK_RULE_PATH = '/Answer_Platform.Answer_Platform/CreateBlockRule';
const UPDATE_BLOCK_RULE_STATUS_PATH = '/Answer_Platform.Answer_Platform/UpdateBlockRuleStatus';
const DELETE_BLOCK_RULE_PATH = '/Answer_Platform.Answer_Platform/DeleteBlockRule';
const LIST_FIREWALLS_PATH = '/Answer_Platform.Answer_Platform/ListFirewalls';
const CREATE_BLACKLIST_PATH = '/Answer_Platform.Answer_Platform/CreateBlackList';
const DELETE_BLACKLIST_PATH = '/Answer_Platform.Answer_Platform/DeleteBlackList';
const SEARCH_BLACKLIST_PATH = '/Answer_Platform.Answer_Platform/SearchBlackList';
const GET_SYSTEM_STATUS_PATH = '/Answer_Platform.Answer_Platform/GetSystemStatus';
const SEARCH_ASSETS_PATH = '/Answer_Platform.Answer_Platform/SearchAssets';
const LOGOUT_PATH = '/Answer_Platform.Answer_Platform/Logout';
const GET_AGENT_GROUPS_PATH = '/Answer_Platform.Answer_Platform/GetAgentGroups';

// Full method name constants for handler map

const LOGIN = 'Answer_Platform.Answer_Platform/Login';
const SEARCH_ALARMS = 'Answer_Platform.Answer_Platform/SearchAlarms';
const GET_ALARM = 'Answer_Platform.Answer_Platform/GetAlarm';
const SEARCH_BLOCK_RULES = 'Answer_Platform.Answer_Platform/SearchBlockRules';
const CREATE_BLOCK_RULE = 'Answer_Platform.Answer_Platform/CreateBlockRule';
const UPDATE_BLOCK_RULE_STATUS = 'Answer_Platform.Answer_Platform/UpdateBlockRuleStatus';
const DELETE_BLOCK_RULE = 'Answer_Platform.Answer_Platform/DeleteBlockRule';
const LIST_FIREWALLS = 'Answer_Platform.Answer_Platform/ListFirewalls';
const CREATE_BLACKLIST = 'Answer_Platform.Answer_Platform/CreateBlackList';
const DELETE_BLACKLIST = 'Answer_Platform.Answer_Platform/DeleteBlackList';
const SEARCH_BLACKLIST = 'Answer_Platform.Answer_Platform/SearchBlackList';
const GET_SYSTEM_STATUS = 'Answer_Platform.Answer_Platform/GetSystemStatus';
const SEARCH_ASSETS = 'Answer_Platform.Answer_Platform/SearchAssets';
const LOGOUT = 'Answer_Platform.Answer_Platform/Logout';
const GET_AGENT_GROUPS = 'Answer_Platform.Answer_Platform/GetAgentGroups';

const DEFAULT_TIMEOUT_MS = 30000;
const RPC_PATH = '/rpc';

// --- Helpers ---

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const firstDefined = (...vals) => vals.find((v) => v !== undefined && v !== null);

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

// --- gRPC error helpers ---

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  DEADLINE_EXCEEDED: grpcStatus.DEADLINE_EXCEEDED,
  NOT_FOUND: grpcStatus.NOT_FOUND,
  UNKNOWN: grpcStatus.UNKNOWN,
  INTERNAL: grpcStatus.INTERNAL,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

// --- google.protobuf.Struct helpers ---

const toValue = (val) => {
  if (val === undefined || val === null) return { nullValue: 'NULL_VALUE' };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'number') return { numberValue: val };
  if (typeof val === 'boolean') return { boolValue: val };
  if (Array.isArray(val)) {
    return { listValue: { values: val.map((item) => toValue(item)) } };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      const normalized = toValue(v);
      fields[k] = normalized;
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(val) };
};

const toStruct = (obj) => {
  if (obj === undefined || obj === null) return undefined;
  if (typeof obj !== 'object') return undefined;
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    const v = toValue(value);
    if (v !== undefined) fields[key] = v;
  }
  return { fields };
};

// --- Config resolution ---

const normalizeBaseUrl = (url) => {
  const base = String(unwrapScalar(url) ?? '').trim();
  if (!/^https?:\/\//i.test(base)) return '';
  return base.replace(/\/+$/, '');
};

const resolveBaseUrl = (bindings) => normalizeBaseUrl(firstDefined(
  bindings?.restBaseUrl,
  bindings?.baseUrl,
  bindings?.rest_base_url,
  bindings?.base_url,
  bindings?.host,
));

const resolveTimeoutMs = (ctx) => {
  const bindings = ctx?.bindings ?? {};
  const timeout = Number(firstDefined(
    bindings.timeoutMs,
    bindings.timeout_ms,
    DEFAULT_TIMEOUT_MS,
  ));
  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS;
};

const toBoolean = (value) => {
  const raw = unwrapScalar(value);
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    return ['true', '1', 'yes', 'y', 'on'].includes(normalized);
  }
  return false;
};

const buildTlsOptions = (bindings) => {
  if (!toBoolean(bindings?.tlsInsecureSkipVerify) && !toBoolean(bindings?.skipTlsVerify) && !toBoolean(bindings?.insecureSkipVerify)) return {};
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  return {
    insecureSkipVerify: true,
    tlsInsecureSkipVerify: true,
    skipTlsVerify: true,
  };
};

// --- Context resolution ---

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.secret ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  req: ctx.req ?? ctx.request ?? {},
});

// --- Session management ---

const sessions = new Map();

const sessionKey = () => crypto.randomUUID();

const getSession = (token) => {
  if (!token) return null;
  return sessions.get(String(token)) ?? null;
};

const setSession = (token, data) => {
  sessions.set(String(token), { ...data, createdAt: Date.now() });
};

const removeSession = (token) => {
  sessions.delete(String(token));
};

// --- JSON-RPC client ---

let rpcSeq = 0;

const rpcCall = async (ctx, method, params = {}) => {
  const baseUrl = resolveBaseUrl(ctx?.bindings ?? {});
  if (!baseUrl) throw errorWithCode('INVALID_ARGUMENT', 'restBaseUrl/baseUrl is required (https://...)');

  const timeoutMs = resolveTimeoutMs(ctx);

  const tlsOpts = buildTlsOptions(ctx?.bindings ?? {});

  const headers = {
    'content-type': 'application/json',
    ...(ctx?.bindings?.headers ?? {}),
  };

  // Attach session cookie if available
  if (ctx?.sessionCookie) {
    headers['cookie'] = ctx.sessionCookie;
  }

  const body = JSON.stringify({
    jsonrpc: '2.0',
    method,
    params: [params],
    id: String(++rpcSeq),
  });

  let res;
  try {
    res = await fetch(`${baseUrl}${RPC_PATH}`, {
      method: 'POST',
      headers,
      body,
      timeoutMs,
      ...tlsOpts,
    });
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', err?.cause?.message || err?.message || 'fetch failed');
  }

  // Capture set-cookie for session persistence
  const setCookie = res.headers.get('set-cookie');
  const responseCookies = setCookie ? [setCookie] : [];

  let json;
  try {
    json = await res.json();
  } catch {
    throw errorWithCode('UNKNOWN', `RPC response is not valid JSON (HTTP ${res.status})`);
  }

  if (!res.ok) {
    throw errorWithCode('UNAVAILABLE', `upstream HTTP ${res.status}`);
  }

  if (json.error) {
    const rpcErr = json.error;
    // "record not found" is a normal empty result, not an error
    if (rpcErr.message === 'record not found') {
      return { result: { data: [], total: 0 }, cookies: [] };
    }
    // Auth error codes 1 or 2 -> session expired
    if (rpcErr.code === 1 || rpcErr.code === 2) {
      throw errorWithCode('PERMISSION_DENIED', rpcErr.message || 'Session expired, re-login required');
    }
    // License error code 4
    if (rpcErr.code === 4) {
      throw errorWithCode('FAILED_PRECONDITION', rpcErr.message || 'License mismatch');
    }
    throw errorWithCode('UNKNOWN', rpcErr.message || `RPC error ${rpcErr.code}`);
  }

  return { result: json.result, cookies: responseCookies };
};

// --- Credential helpers ---

const resolveCredential = (bindings, keys, field) => {
  const value = firstDefined(pickFirst(bindings, keys), '');
  const text = String(value || '').trim();
  if (!text) throw errorWithCode('INVALID_ARGUMENT', `${field} is required in bindings`);
  return text;
};

const requireField = (req, keys, field) => {
  const text = String(firstDefined(pickFirst(req, keys), '') || '').trim();
  if (!text) throw errorWithCode('INVALID_ARGUMENT', `${field} is required`);
  return text;
};

const requireSessionToken = (req) => {
  const token = String(firstDefined(req?.session_token, req?.sessionToken) || '').trim();
  if (!token) throw errorWithCode('INVALID_ARGUMENT', 'session_token is required');
  return token;
};

// --- Agent UUID resolution ---

let cachedAgentUuid = null;

async function resolveAgentUuid(callCtx, token) {
  if (cachedAgentUuid) return cachedAgentUuid;
  const result = await authenticatedRpc(callCtx, token, 'AssetService.GetAgentGroups', {});
  const agents = result?.data ?? [];
  cachedAgentUuid = agents[0]?.agent_uuid ?? '';
  if (!cachedAgentUuid) throw errorWithCode('UNAVAILABLE', 'no agent/probe found');
  return cachedAgentUuid;
}

// --- Login / Logout ---

async function handleLogin(_req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings || {};

  const username = resolveCredential(bindings, ['bindUser', 'bind_user', 'user', 'username'], 'username');
  const password = resolveCredential(bindings, ['bindPassword', 'bind_password', 'password'], 'password');

  const { result, cookies } = await rpcCall(callCtx, 'HeraAccountNoAuthService.Login', {
    username,
    password,
  });

  // Create a session key and store the cookies
  const token = sessionKey();
  setSession(token, {
    cookies,
    username,
    userId: result?.id,
    permissions: result?.permissions ?? [],
  });

  return {
    code: 0,
    msg: 'ok',
    session_token: token,
    permissions: toStruct(result?.permissions ?? {}),
    product_version: String(result?.product_version ?? ''),
  };
}

async function handleLogout(req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const token = requireSessionToken(req);
  const session = getSession(token);
  if (!session) return { code: 0, msg: 'session not found' };

  try {
    // Use session cookies to call logout
    const ctxWithSession = { ...callCtx, sessionCookie: session.cookies.join('; ') };
    await rpcCall(ctxWithSession, 'HeraAccountNoAuthService.Logout', {});
  } catch {
    // Logout error is non-fatal
  }
  removeSession(token);
  return { code: 0, msg: 'ok' };
}

// --- Session-aware RPC wrapper ---

async function authenticatedRpc(ctx, token, method, params = {}) {
  const session = getSession(token);
  if (!session) throw errorWithCode('PERMISSION_DENIED', 'invalid or expired session_token, please Login again');

  const callCtx = {
    ...ctx,
    sessionCookie: session.cookies.join('; '),
  };

  try {
    const { result } = await rpcCall(callCtx, method, params);
    return result;
  } catch (err) {
    // If auth error, try to remove stale session
    if (err.legacyCode === 'PERMISSION_DENIED') {
      removeSession(token);
    }
    throw err;
  }
}

// --- Alarm handlers ---

async function handleSearchAlarms(req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const token = requireSessionToken(req);

  // Use Unix timestamps (seconds) for time_range
  const now = Math.floor(Date.now() / 1000);
  const page = Number(req.page) > 0 ? Number(req.page) : 1;
  const pageSize = Number(req.page_size) > 0 ? Number(req.page_size) : 20;

  const params = {
    time_range_start: req.start_time ? Math.floor(new Date(String(req.start_time)).getTime() / 1000) : now - 7 * 86400,
    time_range_end: req.end_time ? Math.floor(new Date(String(req.end_time)).getTime() / 1000) : now,
    offset: (page - 1) * pageSize,
    count: pageSize,
  };
  if (req.threat_level) params.threat_level = String(req.threat_level);
  if (req.attack_result) params.attack_result = String(req.attack_result);
  if (req.keyword) params.keyword = String(req.keyword);

  const result = await authenticatedRpc(callCtx, token, 'AlarmService.SearchAlarmList', params);

  const items = Array.isArray(result?.data) ? result.data : (Array.isArray(result?.list) ? result.list : []);

  return {
    code: typeof result?.code === 'number' ? result.code : 0,
    msg: String(result?.msg ?? ''),
    items: items.map(toStruct),
    total_count: Number(result?.total_count ?? result?.totalCount ?? items.length),
    raw: toStruct(result ?? {}),
  };
}

async function handleGetAlarm(req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const token = requireSessionToken(req);
  const alarmId = requireField(req, ['alarm_id', 'alarmId'], 'alarm_id');

  const result = await authenticatedRpc(callCtx, token, 'AlarmService.GetAlarm', {
    id: alarmId,
  });

  return {
    code: typeof result?.code === 'number' ? result.code : 0,
    msg: String(result?.msg ?? ''),
    alarm: toStruct(result?.data ?? result ?? {}),
    raw: toStruct(result ?? {}),
  };
}

// --- Block rule handlers ---

async function handleSearchBlockRules(req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const token = requireSessionToken(req);

  const page = Number(req.page) > 0 ? Number(req.page) : 1;
  const pageSize = Number(req.page_size) > 0 ? Number(req.page_size) : 20;

  const params = {
    offset: (page - 1) * pageSize,
    count: pageSize,
  };
  if (req.agent_id) params.agent_id = String(req.agent_id);
  if (req.status) params.status = String(req.status);

  const result = await authenticatedRpc(callCtx, token, 'RulesService.SearchBlockRules', params);

  const items = Array.isArray(result?.data) ? result.data : (Array.isArray(result?.list) ? result.list : []);

  return {
    code: typeof result?.code === 'number' ? result.code : 0,
    msg: String(result?.msg ?? ''),
    items: items.map(toStruct),
    total_count: Number(result?.total_count ?? result?.totalCount ?? items.length),
  };
}

async function handleCreateBlockRule(req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const token = requireSessionToken(req);

  const name = requireField(req, ['name'], 'name');
  const au = await resolveAgentUuid(callCtx, token);
  const ip = requireField(req, ['src_ip', 'srcIp', 'ip'], 'src_ip');

  const params = {
    agent_ids: [au],
    Ips: [String(ip)],
    name,
    action: req.action ? String(req.action) : 'block',
    status: 2,
    block_time_type: 1,
    block_time_value: req.duration ? Number(req.duration) : 86400,
    block_time_duration: 3600,
  };

  const result = await authenticatedRpc(callCtx, token, 'RulesService.CreateBlockRules', params);

  return {
    code: typeof result?.code === 'number' ? result.code : 0,
    msg: String(result?.msg ?? ''),
    rule_id: String(result?.data?.id ?? result?.id ?? ''),
    raw: toStruct(result ?? {}),
  };
}

async function handleUpdateBlockRuleStatus(req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const token = requireSessionToken(req);
  const ruleId = requireField(req, ['rule_id', 'ruleId'], 'rule_id');

  const result = await authenticatedRpc(callCtx, token, 'RulesService.UpdateBlockRulesStatus', {
    id: ruleId,
    status: req.enabled ? 'enabled' : 'disabled',
    ...(req.agent_id ? { agent_id: String(req.agent_id) } : {}),
  });

  return {
    code: typeof result?.code === 'number' ? result.code : 0,
    msg: String(result?.msg ?? ''),
    raw: toStruct(result ?? {}),
  };
}

async function handleDeleteBlockRule(req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const token = requireSessionToken(req);
  const ruleId = requireField(req, ['rule_id', 'ruleId'], 'rule_id');
  const au = await resolveAgentUuid(callCtx, token);

  // First fetch the existing rule to get original IPs
  let originalIps = ['0.0.0.0'];
  try {
    const searchResult = await authenticatedRpc(callCtx, token, 'RulesService.SearchBlockRules', {
      agent_id: au, offset: 0, count: 100,
    });
    const existing = (searchResult?.data ?? []).find(r => r.id === Number(ruleId));
    if (existing?.ips) {
      originalIps = [existing.ips.replace(/:0$/, '')];
    }
  } catch {
    // Fall back to 0.0.0.0 if search fails
  }

  const result = await authenticatedRpc(callCtx, token, 'RulesService.UpdateBlockRules', {
    agent_id: au,
    id: Number(ruleId),
    agent_ids: [au],
    status: 3,
    Expire: Math.floor(Date.now() / 1000),
    action: 'block',
    block_time_type: 1,
    block_time_value: 0,
    block_time_duration: 3600,
    Ips: originalIps,
    name: 'unblock',
  });

  return {
    code: typeof result?.code === 'number' ? result.code : 0,
    msg: String(result?.msg ?? 'ok'),
    raw: toStruct(result ?? {}),
  };
}

// --- Firewall / Blacklist handlers ---

async function handleListFirewalls(req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const token = requireSessionToken(req);

  const params = {};
  if (req.agent_id) params.agent_id = String(req.agent_id);

  const result = await authenticatedRpc(callCtx, token, 'FirewallService.SearchFirewall', params);

  const items = Array.isArray(result?.data) ? result.data : (Array.isArray(result?.list) ? result.list : []);

  return {
    code: typeof result?.code === 'number' ? result.code : 0,
    msg: String(result?.msg ?? ''),
    items: items.map(toStruct),
  };
}

async function handleCreateBlackList(req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const token = requireSessionToken(req);

  const ips = Array.isArray(req?.ips) ? req.ips.map(String) : [];
  if (!ips.length) throw errorWithCode('INVALID_ARGUMENT', 'ips is required and must be a non-empty array');

  const params = { ips };
  if (req.agent_id) params.agent_id = String(req.agent_id);
  if (req.firewall_id) params.firewall_id = String(req.firewall_id);
  if (req.description) params.description = String(req.description);

  const result = await authenticatedRpc(callCtx, token, 'FirewallService.BatchCreateBlackList', params);

  return {
    code: typeof result?.code === 'number' ? result.code : 0,
    msg: String(result?.msg ?? ''),
    raw: toStruct(result ?? {}),
  };
}

async function handleDeleteBlackList(req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const token = requireSessionToken(req);

  const ids = Array.isArray(req?.ids) ? req.ids.map(String) : [];
  if (!ids.length) throw errorWithCode('INVALID_ARGUMENT', 'ids is required and must be a non-empty array');

  const result = await authenticatedRpc(callCtx, token, 'FirewallService.DeleteBlackList', {
    ids,
    ...(req.agent_id ? { agent_id: String(req.agent_id) } : {}),
  });

  return {
    code: typeof result?.code === 'number' ? result.code : 0,
    msg: String(result?.msg ?? ''),
    raw: toStruct(result ?? {}),
  };
}

async function handleSearchBlackList(req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const token = requireSessionToken(req);

  const page = Number(req.page) > 0 ? Number(req.page) : 1;
  const pageSize = Number(req.page_size) > 0 ? Number(req.page_size) : 20;

  const params = {
    offset: (page - 1) * pageSize,
    count: pageSize,
  };
  if (req.agent_id) params.agent_id = String(req.agent_id);
  if (req.ip_keyword) params.ip = String(req.ip_keyword);

  const result = await authenticatedRpc(callCtx, token, 'FirewallService.SearchBlackList', params);

  const items = Array.isArray(result?.data) ? result.data : (Array.isArray(result?.list) ? result.list : []);

  return {
    code: typeof result?.code === 'number' ? result.code : 0,
    msg: String(result?.msg ?? ''),
    items: items.map(toStruct),
    total_count: Number(result?.total_count ?? result?.totalCount ?? items.length),
  };
}

// --- Agent Groups ---

async function handleGetAgentGroups(req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const token = requireSessionToken(req);

  const result = await authenticatedRpc(callCtx, token, 'AssetService.GetAgentGroups', {});

  const items = Array.isArray(result?.data) ? result.data : [];

  return {
    code: typeof result?.code === 'number' ? result.code : 0,
    msg: String(result?.msg ?? ''),
    items: items.map(toStruct),
  };
}

// --- System status ---

async function handleGetSystemStatus(req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const token = requireSessionToken(req);

  const result = await authenticatedRpc(callCtx, token, 'OpsService.GetBaseInfo', {});

  return {
    code: typeof result?.code === 'number' ? result.code : 0,
    msg: String(result?.msg ?? ''),
    cpu_usage: String(result?.cpu_usage ?? result?.cpu ?? ''),
    memory_usage: String(result?.memory_usage ?? result?.memory ?? ''),
    disk_usage: String(result?.disk_usage ?? result?.disk ?? ''),
    uptime: String(result?.uptime ?? result?.system_uptime ?? ''),
    raw: toStruct(result ?? {}),
  };
}

// --- Assets ---

async function handleSearchAssets(req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const token = requireSessionToken(req);

  const page = Number(req.page) > 0 ? Number(req.page) : 1;
  const pageSize = Number(req.page_size) > 0 ? Number(req.page_size) : 20;

  const params = { page_num: page, page_size: pageSize };
  if (req.keyword) params.keyword = String(req.keyword);

  const result = await authenticatedRpc(callCtx, token, 'AssetService.GetAssetList', params);

  const items = Array.isArray(result?.data) ? result.data : (Array.isArray(result?.list) ? result.list : []);

  return {
    code: typeof result?.code === 'number' ? result.code : 0,
    msg: String(result?.msg ?? ''),
    items: items.map(toStruct),
    total_count: Number(result?.total_count ?? result?.totalCount ?? items.length),
  };
}

// --- rpcdef (for SDK runtime) ---

export function rpcdef(ctx) {
  const callCtx = resolveCallContext(ctx);
  const req = ctx?.request ?? ctx?.req ?? {};
  return {
    [LOGIN_PATH]: async (r) => handleLogin(r ?? req, callCtx),
    [SEARCH_ALARMS_PATH]: async (r) => handleSearchAlarms(r ?? req, callCtx),
    [GET_ALARM_PATH]: async (r) => handleGetAlarm(r ?? req, callCtx),
    [SEARCH_BLOCK_RULES_PATH]: async (r) => handleSearchBlockRules(r ?? req, callCtx),
    [CREATE_BLOCK_RULE_PATH]: async (r) => handleCreateBlockRule(r ?? req, callCtx),
    [UPDATE_BLOCK_RULE_STATUS_PATH]: async (r) => handleUpdateBlockRuleStatus(r ?? req, callCtx),
    [DELETE_BLOCK_RULE_PATH]: async (r) => handleDeleteBlockRule(r ?? req, callCtx),
    [LIST_FIREWALLS_PATH]: async (r) => handleListFirewalls(r ?? req, callCtx),
    [CREATE_BLACKLIST_PATH]: async (r) => handleCreateBlackList(r ?? req, callCtx),
    [DELETE_BLACKLIST_PATH]: async (r) => handleDeleteBlackList(r ?? req, callCtx),
    [SEARCH_BLACKLIST_PATH]: async (r) => handleSearchBlackList(r ?? req, callCtx),
    [GET_SYSTEM_STATUS_PATH]: async (r) => handleGetSystemStatus(r ?? req, callCtx),
    [SEARCH_ASSETS_PATH]: async (r) => handleSearchAssets(r ?? req, callCtx),
    [LOGOUT_PATH]: async (r) => handleLogout(r ?? req, callCtx),
    [GET_AGENT_GROUPS_PATH]: async (r) => handleGetAgentGroups(r ?? req, callCtx),
  };
}

// --- handler map (for gRPC server) ---
// SDK passes a single context object: { request, config, secret, metadata, ... }
// Map to our (req, ctx) two-arg convention

const adapt = (fn) => (sdkCtx) => fn(sdkCtx.request ?? {}, sdkCtx);

export const handlers = {
  [LOGIN]: adapt(handleLogin),
  [SEARCH_ALARMS]: adapt(handleSearchAlarms),
  [GET_ALARM]: adapt(handleGetAlarm),
  [SEARCH_BLOCK_RULES]: adapt(handleSearchBlockRules),
  [CREATE_BLOCK_RULE]: adapt(handleCreateBlockRule),
  [UPDATE_BLOCK_RULE_STATUS]: adapt(handleUpdateBlockRuleStatus),
  [DELETE_BLOCK_RULE]: adapt(handleDeleteBlockRule),
  [LIST_FIREWALLS]: adapt(handleListFirewalls),
  [CREATE_BLACKLIST]: adapt(handleCreateBlackList),
  [DELETE_BLACKLIST]: adapt(handleDeleteBlackList),
  [SEARCH_BLACKLIST]: adapt(handleSearchBlackList),
  [GET_SYSTEM_STATUS]: adapt(handleGetSystemStatus),
  [SEARCH_ASSETS]: adapt(handleSearchAssets),
  [LOGOUT]: adapt(handleLogout),
  [GET_AGENT_GROUPS]: adapt(handleGetAgentGroups),
};

// --- Test exports ---

export const _test = {
  errorWithCode,
  grpcCodeFor,
  normalizeBaseUrl,
  resolveBaseUrl,
  resolveTimeoutMs,
  toBoolean,
  toStruct,
  toValue,
  resolveCallContext,
  mergedBindings,
  querySessions: () => new Map(sessions),
  clearSessions: () => sessions.clear(),
};
