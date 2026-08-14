// Chaitin Answer-Platform (全悉) Advanced Threat Analysis & Warning System
// JSON-RPC 2.0 proxy over HTTP with cookie-based session management.

import crypto from 'node:crypto';
import { Agent } from 'undici';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

// Full proto method names for the production handler map.

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
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
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

const resultCode = (result) => Number.isFinite(result?.code) ? result.code : 0;
const resultMsg = (result) => String(result?.msg ?? '');
const resultItems = (result) => Array.isArray(result?.data)
  ? result.data
  : (Array.isArray(result?.list) ? result.list : []);
const resultTotal = (result, items) => Number(firstDefined(result?.total_count, result?.totalCount, items.length));

// --- Config resolution ---

const normalizeBaseUrl = (url) => {
  const base = String(unwrapScalar(url) ?? '').trim();
  if (!/^https?:\/\//i.test(base)) return '';
  return base.replace(/\/+$/, '');
};

const resolveBaseUrl = (bindings) => normalizeBaseUrl(bindings?.restBaseUrl);


const limitPageSize = (val) => {
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : 20;
};
const resolvePage = (value) => Number(value) > 0 ? Number(value) : 1;

const resolveTimeoutMs = (ctx) => {
  const bindings = ctx?.bindings ?? {};
  const timeout = Number(bindings.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS;
};

const resolveMaxResponseBytes = (ctx) => {
  const bindings = ctx?.bindings ?? {};
  const value = Number(bindings.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES);
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_MAX_RESPONSE_BYTES;
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

let insecureDispatcher;
const buildTlsOptions = (bindings) => {
  if (!toBoolean(bindings?.skipTlsVerify)) return {};
  insecureDispatcher ??= new Agent({ connect: { rejectUnauthorized: false } });
  return { dispatcher: insecureDispatcher };
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

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const SESSION_MAX = 1000;
const sessions = new Map();

const sessionKey = () => crypto.randomUUID();

const pruneSessions = () => {
  const now = Date.now();
  for (const [k, v] of sessions) {
    if (now - v.createdAt > SESSION_TTL_MS) sessions.delete(k);
  }
};

const getSession = (token) => {
  if (!token) return null;
  const session = sessions.get(String(token));
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(String(token));
    return null;
  }
  return session;
};

const setSession = (token, data) => {
  pruneSessions();
  if (sessions.size >= SESSION_MAX) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
    if (oldest) sessions.delete(oldest[0]);
  }
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
  const maxResponseBytes = resolveMaxResponseBytes(ctx);

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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    res = await fetch(`${baseUrl}${RPC_PATH}`, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
      ...tlsOpts,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw errorWithCode('DEADLINE_EXCEEDED', `RPC timeout after ${timeoutMs}ms`);
    throw errorWithCode('UNAVAILABLE', err?.cause?.message || err?.message || 'fetch failed');
  } finally {
    clearTimeout(timer);
  }

  // Capture set-cookie for session persistence
  const responseCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);

  let json;
  try {
    const contentLength = Number(res.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
      throw new Error(`RPC response exceeds ${maxResponseBytes} bytes`);
    }
    const text = await res.text();
    if (Buffer.byteLength(text) > maxResponseBytes) throw new Error(`RPC response exceeds ${maxResponseBytes} bytes`);
    json = JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', `RPC response is invalid or too large (HTTP ${res.status})`);
  }

  if (!res.ok) {
    throw errorWithCode('UNAVAILABLE', `upstream HTTP ${res.status}`);
  }

  if (json.error) {
    const rpcErr = json.error;
    // "record not found" is a normal empty result for search/list operations
    if (rpcErr.message === 'record not found') {
      return { result: null, cookies: [] };
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

const agentUuidCache = new Map();
const AGENT_UUID_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const pruneAgentUuidCache = () => {
  const now = Date.now();
  for (const [k, v] of agentUuidCache) {
    if (now - v.cachedAt > AGENT_UUID_CACHE_TTL_MS) agentUuidCache.delete(k);
  }
};

async function resolveAgentUuid(callCtx, token) {
  const baseUrl = resolveBaseUrl(callCtx?.bindings ?? {});
  const cacheKey = `${baseUrl}::${token}`;
  pruneAgentUuidCache();
  const cached = agentUuidCache.get(cacheKey);
  if (cached && (Date.now() - cached.cachedAt < AGENT_UUID_CACHE_TTL_MS)) return cached.uuid;
  agentUuidCache.delete(cacheKey);
  const result = await authenticatedRpc(callCtx, token, 'AssetService.GetAgentGroups', {});
  const agents = result?.data ?? [];
  const uuid = agents[0]?.agent_uuid ?? '';
  if (!uuid) throw errorWithCode('UNAVAILABLE', 'no agent/probe found');
  agentUuidCache.set(cacheKey, { uuid, cachedAt: Date.now() });
  return uuid;
}

const resolveAgentId = async (callCtx, token, request) => {
  const explicit = String(firstDefined(request?.agent_id, request?.agentId, '')).trim();
  return explicit || resolveAgentUuid(callCtx, token);
};

// --- Login / Logout ---

async function handleLogin(_req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings || {};

  const username = resolveCredential(bindings, ['bindUser'], 'username');
  const password = resolveCredential(bindings, ['bindPassword'], 'password');

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
    const { result, cookies } = await rpcCall(callCtx, method, params);
    // Refresh session cookies if upstream sent new ones
    if (cookies && cookies.length > 0) {
      session.cookies = cookies;
    }
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
  const page = resolvePage(req.page);
  const pageSize = limitPageSize(req.page_size);

  const params = {
    time_range_start: now - 7 * 86400,
    time_range_end: now,
    offset: (page - 1) * pageSize,
    count: pageSize,
  };
  if (req.start_time) {
    const ts = Date.parse(String(req.start_time));
    if (Number.isNaN(ts)) throw errorWithCode('INVALID_ARGUMENT', 'start_time must be a valid ISO 8601 timestamp');
    params.time_range_start = Math.floor(ts / 1000);
  }
  if (req.end_time) {
    const ts = Date.parse(String(req.end_time));
    if (Number.isNaN(ts)) throw errorWithCode('INVALID_ARGUMENT', 'end_time must be a valid ISO 8601 timestamp');
    params.time_range_end = Math.floor(ts / 1000);
  }
  if (req.threat_level) params.threat_level = String(req.threat_level);
  if (req.attack_result) params.attack_result = String(req.attack_result);
  if (req.keyword) params.keyword = String(req.keyword);

  const result = await authenticatedRpc(callCtx, token, 'AlarmService.SearchAlarmList', params);

  const items = resultItems(result);

  return {
    code: resultCode(result),
    msg: resultMsg(result),
    items: items.map(toStruct),
    total_count: resultTotal(result, items),
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
    code: resultCode(result),
    msg: resultMsg(result),
    alarm: toStruct(result?.data ?? result ?? {}),
    raw: toStruct(result ?? {}),
  };
}

// --- Block rule handlers ---

async function handleSearchBlockRules(req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const token = requireSessionToken(req);
  const agentId = await resolveAgentId(callCtx, token, req);
  const page = resolvePage(req.page);
  const pageSize = limitPageSize(req.page_size);

  const params = {
    agent_id: agentId,
    offset: (page - 1) * pageSize,
    count: pageSize,
  };
  if (req.status) params.status = String(req.status);

  const result = await authenticatedRpc(callCtx, token, 'RulesService.SearchBlockRules', params);

  const items = resultItems(result);

  return {
    code: resultCode(result),
    msg: resultMsg(result),
    items: items.map(toStruct),
    total_count: resultTotal(result, items),
  };
}

async function handleCreateBlockRule(req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const token = requireSessionToken(req);

  const name = requireField(req, ['name'], 'name');
  const ip = requireField(req, ['src_ip', 'srcIp', 'ip'], 'src_ip');
  const agentId = await resolveAgentId(callCtx, token, req);

  const params = {
    agent_ids: [agentId],
    Ips: [String(ip)],
    name,
    description: String(req.description || ''),
    dst_ip: String(req.dst_ip || req.dstIp || ''),
    protocol: String(req.protocol || ''),
    action: req.action ? String(req.action) : 'block',
    status: 2,
    block_time_type: 1,
    block_time_value: (() => { const d = Number(req.duration); return Number.isFinite(d) && d > 0 ? d : 86400; })(),
    block_time_duration: 3600,
  };

  const result = await authenticatedRpc(callCtx, token, 'RulesService.CreateBlockRules', params);

  return {
    code: resultCode(result),
    msg: resultMsg(result),
    rule_id: String(result?.data?.id ?? result?.id ?? ''),
    raw: toStruct(result ?? {}),
  };
}

async function handleUpdateBlockRuleStatus(req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const token = requireSessionToken(req);
  const ruleId = requireField(req, ['rule_id', 'ruleId'], 'rule_id');

  const result = await authenticatedRpc(callCtx, token, 'RulesService.UpdateBlockRulesStatus', {
    agent_id: await resolveAgentId(callCtx, token, req),
    id: Number(ruleId),
    status: req.enabled ? 2 : 3,
  });

  return {
    code: resultCode(result),
    msg: resultMsg(result),
    raw: toStruct(result ?? {}),
  };
}

async function handleDeleteBlockRule(req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const token = requireSessionToken(req);
  const ruleId = requireField(req, ['rule_id', 'ruleId'], 'rule_id');
  const agentId = await resolveAgentId(callCtx, token, req);

  // Fetch the existing rule to get original IPs and name (paginated search)
  let existing = null;
  let offset = 0;
  const pageSize = 200;
  while (offset < 5000) {
    const searchResult = await authenticatedRpc(callCtx, token, 'RulesService.SearchBlockRules', {
      agent_id: agentId, offset, count: pageSize,
    });
    const data = searchResult?.data ?? [];
    existing = data.find(r => r.id === Number(ruleId));
    if (existing) break;
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  if (!existing) throw errorWithCode('NOT_FOUND', `rule ${ruleId} not found`);
  const originalIps = [(existing.ips || '0.0.0.0').replace(/:0$/, '')];

  const result = await authenticatedRpc(callCtx, token, 'RulesService.UpdateBlockRules', {
    agent_id: agentId,
    id: Number(ruleId),
    agent_ids: [agentId],
    status: 3,
    Expire: Math.floor(Date.now() / 1000),
    action: 'block',
    block_time_type: 1,
    block_time_value: 0,
    block_time_duration: 3600,
    Ips: originalIps,
    name: existing.name || 'unblock',
  });

  return {
    code: resultCode(result),
    msg: String(result?.msg ?? 'ok'),
    raw: toStruct(result ?? {}),
  };
}

// --- Firewall / Blacklist handlers ---

async function handleListFirewalls(req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const token = requireSessionToken(req);
  const params = { agent_id: await resolveAgentId(callCtx, token, req) };

  const result = await authenticatedRpc(callCtx, token, 'FirewallService.SearchFirewall', params);

  const items = resultItems(result);

  return {
    code: resultCode(result),
    msg: resultMsg(result),
    items: items.map(toStruct),
  };
}

async function handleCreateBlackList(req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const token = requireSessionToken(req);
  const ips = Array.isArray(req?.ips) ? req.ips.map(String) : [];
  if (!ips.length) throw errorWithCode('INVALID_ARGUMENT', 'ips is required and must be a non-empty array');

  const params = { ips };
  params.agent_id = await resolveAgentId(callCtx, token, req);
  if (req.firewall_id) params.firewall_id = String(req.firewall_id);
  if (req.description) params.description = String(req.description);

  const result = await authenticatedRpc(callCtx, token, 'FirewallService.BatchCreateBlackList', params);

  return {
    code: resultCode(result),
    msg: resultMsg(result),
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
    agent_id: await resolveAgentId(callCtx, token, req),
  });

  return {
    code: resultCode(result),
    msg: resultMsg(result),
    raw: toStruct(result ?? {}),
  };
}

async function handleSearchBlackList(req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const token = requireSessionToken(req);
  const agentId = await resolveAgentId(callCtx, token, req);
  const page = resolvePage(req.page);
  const pageSize = limitPageSize(req.page_size);

  const params = {
    agent_id: agentId,
    offset: (page - 1) * pageSize,
    count: pageSize,
  };
  if (req.ip_keyword) params.ip = String(req.ip_keyword);

  const result = await authenticatedRpc(callCtx, token, 'FirewallService.SearchBlackList', params);

  const items = resultItems(result);

  return {
    code: resultCode(result),
    msg: resultMsg(result),
    items: items.map(toStruct),
    total_count: resultTotal(result, items),
  };
}

// --- Agent Groups ---

async function handleGetAgentGroups(req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const token = requireSessionToken(req);

  const result = await authenticatedRpc(callCtx, token, 'AssetService.GetAgentGroups', {});

  const items = resultItems(result);

  return {
    code: resultCode(result),
    msg: resultMsg(result),
    items: items.map(toStruct),
  };
}

// --- System status ---

async function handleGetSystemStatus(req, ctx) {
  const callCtx = resolveCallContext(ctx);
  const token = requireSessionToken(req);

  const result = await authenticatedRpc(callCtx, token, 'OpsService.GetBaseInfo', {});

  return {
    code: resultCode(result),
    msg: resultMsg(result),
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

  const page = resolvePage(req.page);
  const pageSize = limitPageSize(req.page_size);

  const params = { page_num: page, page_size: pageSize };
  if (req.keyword) params.keyword = String(req.keyword);

  const result = await authenticatedRpc(callCtx, token, 'AssetService.GetAssetList', params);

  const items = resultItems(result);

  return {
    code: resultCode(result),
    msg: resultMsg(result),
    items: items.map(toStruct),
    total_count: resultTotal(result, items),
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
  resolveMaxResponseBytes,
  buildTlsOptions,
  limitPageSize,
  resolvePage,
  rpcCall,
  resultCode,
  resultMsg,
  resultItems,
  resultTotal,
  toBoolean,
  toStruct,
  toValue,
  resolveCallContext,
  mergedBindings,
  querySessions: () => new Map(sessions),
  clearSessions: () => sessions.clear(),
  getSession,
  setSession,
  pruneSessions,
  firstDefined,
  pickFirst,
  unwrapScalar,
  errorWithCode,
};
