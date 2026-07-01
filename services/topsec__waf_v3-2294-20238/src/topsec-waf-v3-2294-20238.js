import crypto from 'node:crypto';
import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

// ── constants ────────────────────────────────────────────────────

// IP 黑名单
const API_IP_ADD  = '/api/v1/ip_group_add';
const API_IP_DEL  = '/api/v1/ip_group_delete';
const API_IP_SHOW = '/api/v1/ip_group_show';

// URL 自定义策略
const API_URL_ADD  = '/api/v1/user_policy_add';
const API_URL_DEL  = '/api/v1/user_policy_delete';
const API_URL_MOD  = '/api/v1/user_policy_modify';
const API_URL_SHOW = '/api/v1/user_policy_show';

const M_ADD  = 'TopSec_WAF.TopSec_WAF/AddBlacklistIP';
const M_DEL  = 'TopSec_WAF.TopSec_WAF/DeleteBlacklistIP';
const M_LIST = 'TopSec_WAF.TopSec_WAF/ListBlacklistIPs';
const M_URL_ADD  = 'TopSec_WAF.TopSec_WAF/AddUrlBlock';
const M_URL_DEL  = 'TopSec_WAF.TopSec_WAF/DeleteUrlBlock';
const M_URL_MOD  = 'TopSec_WAF.TopSec_WAF/SetUrlBlockStatus';
const M_URL_LIST = 'TopSec_WAF.TopSec_WAF/ListUrlBlocks';
const DEFAULT_TIMEOUT_MS = 5000;

export const METHOD_ADD_PATH  = '/' + M_ADD;
export const METHOD_DELETE_PATH = '/' + M_DEL;
export const METHOD_LIST_PATH   = '/' + M_LIST;
export const METHOD_URL_ADD_PATH  = '/' + M_URL_ADD;
export const METHOD_URL_DEL_PATH  = '/' + M_URL_DEL;
export const METHOD_URL_MOD_PATH  = '/' + M_URL_MOD;
export const METHOD_URL_LIST_PATH = '/' + M_URL_LIST;
export const METHOD_ADD_FULL  = M_ADD;
export const METHOD_DELETE_FULL = M_DEL;
export const METHOD_LIST_FULL   = M_LIST;
export const METHOD_URL_ADD_FULL  = M_URL_ADD;
export const METHOD_URL_DEL_FULL  = M_URL_DEL;
export const METHOD_URL_MOD_FULL  = M_URL_MOD;
export const METHOD_URL_LIST_FULL = M_URL_LIST;

// ── helpers ──────────────────────────────────────────────────────

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  DEADLINE_EXCEEDED: grpcStatus.DEADLINE_EXCEEDED,
})[code] ?? grpcStatus.UNKNOWN;

const grpcErr = (code, msg) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${msg}`);
  err.legacyCode = code;
  return err;
};

const first = (...vs) => vs.find((v) => v !== undefined && v !== null);

const str = (v) => {
  if (v == null) return '';
  if (typeof v === 'object' && 'value' in v) return str(v.value);
  return String(v);
};

const toNum = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const toBool = (v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) && v !== 0;
  if (typeof v === 'string') {
    const value = v.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(value)) return true;
    if (['0', 'false', 'no', 'n', 'off', ''].includes(value)) return false;
  }
  if (v && typeof v === 'object' && 'value' in v) return toBool(v.value);
  return false;
};

const isTimeoutError = (e) => e?.name === 'TimeoutError' || e?.name === 'AbortError';

const aesEncrypt = (key, plain) => {
  const block = 16;
  const pad = (block - plain.length % block) % block;
  const padded = plain + '\0'.repeat(pad);
  const c = crypto.createCipheriv('aes-128-cbc', key, key);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(padded, 'utf8'), c.final()]).toString('base64');
};

const readConfig = (ctx = {}) => {
  const b = { ...ctx.config, ...ctx.secret, ...ctx.bindings };
  const host = str(first(b.host, b.baseUrl, b.base_url, b.endpoint)).replace(/\/+$/, '');
  if (!/^https?:\/\//.test(host)) throw grpcErr('INVALID_ARGUMENT', 'config.host required (http/https)');
  const username = str(first(b.username, b.user));
  if (!username) throw grpcErr('INVALID_ARGUMENT', 'secret.username required');
  const password = str(first(b.password, b.pass));
  if (!password) throw grpcErr('INVALID_ARGUMENT', 'secret.password required');
  const timeoutMs = toNum(first(b.timeoutMs, b.timeout_ms, b.requestTimeoutMs), DEFAULT_TIMEOUT_MS);
  const skipTlsVerify = toBool(first(b.skipTlsVerify, b.skip_tls_verify, b.insecureSkipVerify));
  return { host, username, password, timeoutMs, skipTlsVerify };
};

// ── session ───────────────────────────────────────────────────────

const sessionCache = new Map();
let insecureTlsDispatcher;

function clearSession(sessionKey) {
  if (sessionKey) {
    sessionCache.delete(sessionKey);
    return;
  }
  sessionCache.clear();
}

const sessionKeyFor = ({ host, username, skipTlsVerify }) => `${host}\n${username}\n${skipTlsVerify ? 'tls-skip' : 'tls-verify'}`;

const getTlsDispatcher = (skipTlsVerify) => {
  if (!skipTlsVerify) return undefined;
  insecureTlsDispatcher ??= new Agent({ connect: { rejectUnauthorized: false } });
  return insecureTlsDispatcher;
};

const withHttpOptions = (init, { timeoutMs, skipTlsVerify }) => ({
  ...init,
  ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  ...(skipTlsVerify ? { dispatcher: getTlsDispatcher(true) } : {}),
});

const readText = async (response, action) => {
  try {
    return await response.text();
  } catch {
    throw grpcErr('UNAVAILABLE', `${action} response body read failed`);
  }
};

async function login(config) {
  const { host, username, password, skipTlsVerify, timeoutMs } = config;

  const fetchOpts = withHttpOptions({
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: '',
  }, { timeoutMs, skipTlsVerify });

  let r1;
  try {
    r1 = await fetch(host + '/api/v1/get_miks', fetchOpts);
  } catch (e) {
    if (isTimeoutError(e)) throw grpcErr('DEADLINE_EXCEEDED', `get_miks timeout after ${timeoutMs}ms`);
    throw grpcErr('UNAVAILABLE', 'get_miks network error');
  }
  if (!r1.ok) throw grpcErr('UNAVAILABLE', `get_miks failed: HTTP ${r1.status}`);

  const keyText = await readText(r1, 'get_miks');
  let key;
  try { key = Buffer.from(keyText, 'base64'); } catch { throw grpcErr('UNAVAILABLE', 'get_miks returned invalid base64 key'); }
  if (key.length !== 16) throw grpcErr('UNAVAILABLE', `get_miks key length ${key.length}, expected 16`);
  const sc = r1.headers.getSetCookie?.()?.[0] ?? r1.headers.get('set-cookie') ?? '';
  const sid = sc.match(/PHPSESSID=([^;]+)/)?.[1] ?? '';
  if (!sid) throw grpcErr('UNAUTHENTICATED', 'login failed: no PHPSESSID in get_miks response');
  const cookie = `PHPSESSID=${sid}`;

  const encPw = aesEncrypt(key, password);
  const loginBody = `name=${encodeURIComponent(username)}&password=${encodeURIComponent(encPw)}`;

  const loginOpts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookie },
    body: loginBody,
  };

  let r2;
  try {
    r2 = await fetch(host + '/api/v1/login', withHttpOptions(loginOpts, { timeoutMs, skipTlsVerify }));
  } catch (e) {
    if (isTimeoutError(e)) throw grpcErr('DEADLINE_EXCEEDED', `login timeout after ${timeoutMs}ms`);
    throw grpcErr('UNAVAILABLE', 'login network error');
  }
  const text = await readText(r2, 'login');

  // 401: wrong credentials → UNAUTHENTICATED
  if (r2.status === 401) throw grpcErr('UNAUTHENTICATED', `login failed: incorrect username or password`);
  // 403: account locked / forbidden → PERMISSION_DENIED
  if (r2.status === 403) throw grpcErr('PERMISSION_DENIED', `login forbidden: HTTP ${r2.status}`);
  if (!r2.ok) throw grpcErr('UNAVAILABLE', `login failed: HTTP ${r2.status}`);

  // Token format variations:
  //   "ok?<token>"
  //   "?[<token>}?"
  //   "?[<token>}"
  const parts = text.split('?');
  if (parts.length < 2 || !parts[1]) throw grpcErr('UNAUTHENTICATED', 'login token missing from response');
  const token = parts[1].replace(/^\[/, '').replace(/[}?]+$/, '');

  return { cookie, token };
}

async function getSession(config) {
  const sessionKey = sessionKeyFor(config);
  let session = sessionCache.get(sessionKey);
  if (!session) {
    const s = await login(config);
    session = { host: config.host, username: config.username, skipTlsVerify: config.skipTlsVerify, ...s };
    sessionCache.set(sessionKey, session);
  }
  return session;
}

async function callWaf(config, path, body, sess, extra = {}) {
  const { host, timeoutMs, skipTlsVerify } = config;
  const payload = JSON.stringify({ token: sess.token, commands: [body], ...extra });

  const opts = {
    method: 'POST',
    headers: { 'Cookie': sess.cookie },
    body: payload,
  };

  let res;
  try {
    res = await fetch(host + path, withHttpOptions(opts, { timeoutMs, skipTlsVerify }));
  } catch (e) {
    if (isTimeoutError(e)) throw grpcErr('DEADLINE_EXCEEDED', `WAF request timeout after ${timeoutMs}ms`);
    throw grpcErr('UNAVAILABLE', 'WAF request failed');
  }

  const text = await readText(res, 'WAF');

  // Auth expired / invalid — clear cached session so next call re-logins
  if (res.status === 401 || res.status === 403) {
    clearSession(sessionKeyFor(config));
    throw grpcErr('PERMISSION_DENIED', 'WAF auth expired');
  }

  if (res.status >= 400 && res.status < 500) throw grpcErr('FAILED_PRECONDITION', `WAF HTTP ${res.status}`);
  if (!res.ok) throw grpcErr('UNAVAILABLE', `WAF HTTP ${res.status}`);

  let json;
  try { json = JSON.parse(text); } catch { throw grpcErr('UNKNOWN', 'WAF response not JSON'); }
  if (json.result === 'failed') throw grpcErr('FAILED_PRECONDITION', json.info || 'WAF command failed');
  return json;
}

// Call WAF with automatic session retry on 401/403 auth expiry.
// On first PERMISSION_DENIED: clears the cached session, re-logins, and retries once.
async function callWafWithRetry(config, path, body, extra = {}) {
  let sess = await getSession(config);
  try {
    return await callWaf(config, path, body, sess, extra);
  } catch (e) {
    if (e.legacyCode === 'PERMISSION_DENIED') {
      // Session may have expired — force re-login and retry exactly once
      const newSess = await login(config);
      const session = { host: config.host, username: config.username, skipTlsVerify: config.skipTlsVerify, ...newSess };
      sessionCache.set(sessionKeyFor(config), session);
      return await callWaf(config, path, body, session, extra);
    }
    throw e;
  }
}

// ── URL policy helpers ──────────────────────────────────────────

const buildCondition = (url, operator = 'contains') => {
  const cond = `(variables: "REQUEST_URL" expression: "${url}" operator: "${operator}" trfns: "none")`;
  return Buffer.from(cond).toString('base64');
};

// ── IP handlers ─────────────────────────────────────────────────

async function handleAdd(ctx) {
  const config = readConfig(ctx);
  const req = ctx.request ?? {};

  const name = str(first(req.name)).trim();
  if (!name) throw grpcErr('INVALID_ARGUMENT', 'name required');

  const ips = first(req.ip_addresses, req.ipAddresses);
  if (!Array.isArray(ips) || !ips.length) throw grpcErr('INVALID_ARGUMENT', 'ip_addresses required');

  const address = ips.map((s) => str(s).trim()).filter(Boolean).join('|');
  if (!address) throw grpcErr('INVALID_ARGUMENT', 'ip_addresses empty');

  const json = await callWafWithRetry(config, API_IP_ADD, { waf_ip_group_add: { name, address } });
  return { result: str(json.result), info: str(json.info) };
}

async function handleDelete(ctx) {
  const config = readConfig(ctx);
  const req = ctx.request ?? {};

  const name = str(first(req.name)).trim();
  if (!name) throw grpcErr('INVALID_ARGUMENT', 'name required');

  const json = await callWafWithRetry(config, API_IP_DEL, { waf_ip_group_delete: { name } });
  return { result: str(json.result), info: str(json.info) };
}

async function handleList(ctx) {
  const config = readConfig(ctx);
  const req = ctx.request ?? {};

  const name = str(first(req.name)).trim();
  const page = toNum(first(req.page), 1);
  const rows = toNum(first(req.rows, req.page_size, req.pageSize), 20);

  const command = name ? { waf_ip_group_show: { name } } : { waf_ip_group_show: {} };

  const json = await callWafWithRetry(config, API_IP_SHOW, command, { page, rows });

  const mappedRows = (json.rows || []).map((r) => ({
    name: str(r.name),
    group_value: str(r.group_value),
    ip_group_members: str(r.ip_group_members),
    m_type: str(r.m_type),
  }));
  return { rows: mappedRows, total: String(json.total ?? mappedRows.length) };
}

// ── URL handlers ─────────────────────────────────────────────────

async function handleUrlBlock(ctx) {
  const config = readConfig(ctx);
  const req = ctx.request ?? {};

  const policy = str(first(req.security_policy, req.securityPolicy)).trim();
  if (!policy) throw grpcErr('INVALID_ARGUMENT', 'security_policy required');
  const name = str(first(req.name)).trim();
  if (!name) throw grpcErr('INVALID_ARGUMENT', 'name required');
  const url = str(first(req.url)).trim();
  if (!url) throw grpcErr('INVALID_ARGUMENT', 'url required');

  const VALID_ACTIONS = ['deny', 'allow', 'alert', 'continue', 'deny-nlog', 'temp-redirect', 'perm-redirect'];
  const actionRaw = str(first(req.action, 'deny')).trim();
  const action = VALID_ACTIONS.includes(actionRaw) ? actionRaw : 'deny';
  const actionData = str(first(req.action_data, req.actionData)).trim();
  // temp-redirect and perm-redirect require action_data (the redirect target URL)
  if ((action === 'temp-redirect' || action === 'perm-redirect') && !actionData) {
    throw grpcErr('INVALID_ARGUMENT', 'action_data required for temp-redirect and perm-redirect (redirect target URL)');
  }
  const operator = str(first(req.operator, 'contains')).trim() || 'contains';
  const phase = str(first(req.phase, 'request_header')).trim() || 'request_header';
  const logMsg = str(first(req.log_message, req.logMessage, `block: ${url}`)).trim() || `block: ${url}`;

  const condition = buildCondition(url, operator);

  const cmd = { 'security-policy': policy, name, enable: 'on', phase, action, 'log-message': logMsg, condition };
  if (actionData) cmd['action-data'] = actionData;

  const json = await callWafWithRetry(config, API_URL_ADD, { 'waf_user_policy_ui_add': cmd });
  return { result: str(json.result), info: str(json.info) };
}

async function handleUrlUnblock(ctx) {
  const config = readConfig(ctx);
  const req = ctx.request ?? {};

  const policy = str(first(req.security_policy, req.securityPolicy)).trim();
  if (!policy) throw grpcErr('INVALID_ARGUMENT', 'security_policy required');
  const name = str(first(req.name)).trim();
  if (!name) throw grpcErr('INVALID_ARGUMENT', 'name required');

  const json = await callWafWithRetry(config, API_URL_DEL, {
    'waf_user_policy_delete': { 'security-policy': policy, name }
  });
  return { result: str(json.result), info: str(json.info) };
}

async function handleUrlList(ctx) {
  const config = readConfig(ctx);
  const req = ctx.request ?? {};

  const policy = str(first(req.security_policy, req.securityPolicy)).trim();
  if (!policy) throw grpcErr('INVALID_ARGUMENT', 'security_policy required');
  const name = str(first(req.name)).trim();
  const page = toNum(first(req.page), 1);
  const rows = toNum(first(req.rows, req.page_size, req.pageSize), 20);

  const cmd = { 'security-policy': policy };
  if (name) cmd.name = name;

  const json = await callWafWithRetry(config, API_URL_SHOW, { 'waf_url_rewrite_show_name': cmd }, { page, rows });

  const mappedRows = (json.rows || []).map((r) => ({
    id: str(r.id),
    name: str(r.name),
    action: str(r.action),
    enable: str(r.enable),
    phase: str(r.phase),
    log_message: str(r.log_message),
    conditions: str(r.conditions),
  }));
  return { rows: mappedRows, total: String(json.total ?? mappedRows.length) };
}

async function handleUrlStatus(ctx) {
  const config = readConfig(ctx);
  const req = ctx.request ?? {};

  const policy = str(first(req.security_policy, req.securityPolicy)).trim();
  if (!policy) throw grpcErr('INVALID_ARGUMENT', 'security_policy required');
  const name = str(first(req.name)).trim();
  if (!name) throw grpcErr('INVALID_ARGUMENT', 'name required');

  const enableRaw = str(first(req.enable, 'on')).trim().toLowerCase();
  const enable = ['on', 'off'].includes(enableRaw) ? enableRaw : 'on';

  const json = await callWafWithRetry(config, API_URL_MOD, {
    'waf_user_policy_modify_ui': { 'security-policy': policy, name, enable }
  });
  return { result: str(json.result), info: str(json.info) };
}

// ── exports ──────────────────────────────────────────────────────

export const handlers = {
  [M_ADD]:  (ctx) => handleAdd(ctx),
  [M_DEL]:  (ctx) => handleDelete(ctx),
  [M_LIST]: (ctx) => handleList(ctx),
  [M_URL_ADD]:  (ctx) => handleUrlBlock(ctx),
  [M_URL_DEL]:  (ctx) => handleUrlUnblock(ctx),
  [M_URL_MOD]:  (ctx) => handleUrlStatus(ctx),
  [M_URL_LIST]: (ctx) => handleUrlList(ctx),
};

export function rpcdef(ctx = {}) {
  const withCtx = (fn) => (rpcCtx = {}) => fn({ ...ctx, ...rpcCtx, request: rpcCtx.request ?? ctx.request ?? {} });
  return {
    [METHOD_ADD_PATH]:  withCtx(handleAdd),
    [METHOD_DELETE_PATH]: withCtx(handleDelete),
    [METHOD_LIST_PATH]:   withCtx(handleList),
    [METHOD_URL_ADD_PATH]:  withCtx(handleUrlBlock),
    [METHOD_URL_DEL_PATH]:  withCtx(handleUrlUnblock),
    [METHOD_URL_MOD_PATH]:  withCtx(handleUrlStatus),
    [METHOD_URL_LIST_PATH]: withCtx(handleUrlList),
  };
}

export const _test = {
  grpcCodeFor,
  grpcErr,
  first,
  str,
  toNum,
  readConfig,
  buildCondition,
  clearSession,
  getTlsDispatcher,
  sessionKeyFor,
  resetSession: () => { sessionCache.clear(); },
};
