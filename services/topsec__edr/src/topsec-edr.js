import crypto from 'node:crypto';
import { Agent } from 'undici';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const RPC = Object.freeze({
  login: 'TopSec_EDR.TopSec_EDR/Login',
  listClients: 'TopSec_EDR.TopSec_EDR/ListClients',
  getClient: 'TopSec_EDR.TopSec_EDR/GetClient',
  getAlertStats: 'TopSec_EDR.TopSec_EDR/GetAlertStats',
  getSystemView: 'TopSec_EDR.TopSec_EDR/GetSystemView',
  getSystemInfo: 'TopSec_EDR.TopSec_EDR/GetSystemInfo',
});

const AES_KEY = Buffer.from('6ZlcPK5xfRrd7W1oyIqVgiHGbamhBAJ3');
const AES_IV = Buffer.from('6ZlcPK5xfRrd7W1o');
const SIGN_SALT = 'dO(QK*EX@cTG';
const DEFAULT_TIMEOUT_MS = 5000;

const fail = (code, message) => {
  const error = new GrpcError(code, message);
  error.legacyCode = Object.entries(grpcStatus).find(([, value]) => value === code)?.[0] ?? 'UNKNOWN';
  return error;
};

const required = (value, name) => {
  const text = String(value ?? '').trim();
  if (!text) throw fail(grpcStatus.INVALID_ARGUMENT, `${name} is required`);
  return text;
};

const scalar = (value) => value && typeof value === 'object' && 'value' in value ? value.value : value;
const int = (value, fallback = 0) => {
  const number = Number(scalar(value));
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
};
const text = (value) => value == null ? '' : String(value);
const pick = (object, ...names) => names.map((name) => object?.[name]).find((value) => value != null);

const endpoint = (request, ctx) => {
  const raw = [request?.host, ctx.config?.host, ctx.config?.endpoint, ctx.config?.restBaseUrl]
    .find((value) => String(value ?? '').trim() !== '');
  let url;
  try { url = new URL(required(raw, 'host')); } catch {
    throw fail(grpcStatus.INVALID_ARGUMENT, 'host must be an absolute http/https URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw fail(grpcStatus.INVALID_ARGUMENT, 'host must be an absolute http/https URL without credentials');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url;
};

const timeout = (ctx) => {
  const value = int(ctx.config?.timeoutMs ?? ctx.limits?.timeoutMs, DEFAULT_TIMEOUT_MS);
  return value > 0 && value <= 120000 ? value : DEFAULT_TIMEOUT_MS;
};

const encrypt = (value) => {
  const cipher = crypto.createCipheriv('aes-256-cbc', AES_KEY, AES_IV);
  return Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]).toString('base64');
};

const decrypt = (value) => {
  const decipher = crypto.createDecipheriv('aes-256-cbc', AES_KEY, AES_IV);
  return Buffer.concat([decipher.update(String(value), 'base64'), decipher.final()]).toString('utf8');
};

const parseJson = (body, label = 'upstream response') => {
  try { return JSON.parse(body); } catch {
    throw fail(grpcStatus.UNKNOWN, `${label} is not valid JSON`);
  }
};

const decodePayload = (body) => {
  const outer = parseJson(body);
  if (!outer?.encryptStr) return outer;
  try { return parseJson(decrypt(outer.encryptStr), 'decrypted upstream response'); } catch (error) {
    if (error instanceof GrpcError) throw error;
    throw fail(grpcStatus.UNKNOWN, 'upstream response encryption is invalid');
  }
};

const buildUrl = (base, path, query = {}) => {
  const url = new URL(`${base.pathname}${path}`.replace(/\/+/g, '/'), base);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  return url;
};

const request = async (ctx, url, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout(ctx));
  const skipTlsVerify = ctx.config?.skipTlsVerify === true || ctx.config?.tlsInsecureSkipVerify === true;
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      dispatcher: skipTlsVerify ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined,
    });
    const body = await response.text();
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403
        ? grpcStatus.PERMISSION_DENIED : response.status >= 500 ? grpcStatus.UNAVAILABLE : grpcStatus.UNKNOWN;
      throw fail(code, `TopSec EDR returned HTTP ${response.status}`);
    }
    return { status: response.status, body, headers: response.headers };
  } catch (error) {
    if (error instanceof GrpcError) throw error;
    const message = error?.name === 'AbortError' ? 'TopSec EDR request timed out' : 'TopSec EDR is unavailable';
    throw fail(grpcStatus.UNAVAILABLE, message);
  } finally {
    clearTimeout(timer);
  }
};

const traceHeaders = (ctx) => {
  const headers = { accept: 'application/json' };
  if (ctx.meta?.instance_id) headers['x-engine-instance'] = String(ctx.meta.instance_id);
  if (ctx.meta?.request_id) headers['x-request-id'] = String(ctx.meta.request_id);
  return headers;
};

const session = (requestBody, ctx) => ({
  token: required(requestBody.session?.token ?? ctx.secret?.apiToken, 'session.token'),
});

const signedQuery = ({ token }) => {
  const nonce = String(crypto.randomInt(100000000)).padStart(8, '0');
  const stime = String(Math.floor(Date.now() / 1000));
  const sign = crypto.createHash('md5').update(`${token}${stime}${nonce}${SIGN_SALT}`).digest('hex');
  return { nonce, stime, sign };
};

const authenticated = async (ctx, path, { method = 'GET', payload } = {}) => {
  const auth = session(ctx.request, ctx);
  const headers = { ...traceHeaders(ctx), authorization: `Bearer ${auth.token}` };
  let body;
  if (payload !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify({ encryptStr: encrypt(JSON.stringify(payload)) });
  }
  const response = await request(ctx, buildUrl(endpoint(ctx.request, ctx), path, signedQuery(auth)), { method, headers, body });
  return { ...response, data: decodePayload(response.body) };
};

const clientRecord = (item = {}) => ({
  client_id: text(item.client_id), hostname: text(item.hostname), mac: text(item.mac),
  client_ip: text(item.client_ip), os_name: text(item.os_name), os_version: text(item.os_version),
  os_arch: text(item.os_arch), client_version: text(item.client_version), virus_db_version: int(item.virus_db_version),
  group_name: text(item.group_name), group_id: text(item.group_id), person: text(item.person),
  terminal_type: text(item.terminal_type), location: text(item.location), login_time: int(item.login_time),
  heartbeat_time: int(item.heartbeat_time), status: int(item.status), os_type: text(item.os_type),
  tenancy_id: text(item.tenancy_id), upgrade_dbver: int(item.upgrade_dbver),
  next_heart_time: int(item.next_heart_time), off_line: int(item.off_line),
});

const login = async (ctx) => {
  const username = required(ctx.request.username ?? ctx.secret?.username, 'username');
  const password = required(ctx.request.password ?? ctx.secret?.password, 'password');
  let hashed = password.trim();
  for (let index = 0; index < 6; index++) {
    hashed = crypto.createHash(index < 3 ? 'md5' : 'sha256').update(hashed).digest('hex');
  }
  const encrypted = encrypt(JSON.stringify({ 'ng-cloud': true, username, password: hashed.toUpperCase(), captcha: '', tenant_id: '', captcha_id: '' }));
  const response = await request(ctx, buildUrl(endpoint(ctx.request, ctx), '/auth/token'), {
    method: 'POST', headers: { ...traceHeaders(ctx), 'content-type': 'application/json' }, body: JSON.stringify({ encryptStr: encrypted }),
  });
  const data = decodePayload(response.body);
  return { session: { token: required(data.token, 'upstream token') }, status_code: response.status, raw_body: response.body };
};

const listClients = async (ctx) => {
  const page = Math.max(1, int(ctx.request.page, 1));
  const pageSize = Math.min(200, Math.max(1, int(ctx.request.page_size, 25)));
  const response = await authenticated(ctx, '/api/v1/getCustomList?collection=terminalManager', {
    method: 'POST', payload: { page, page_size: pageSize, first_load: ctx.request.first_load !== false },
  });
  const data = response.data?.data ?? response.data ?? {};
  const rows = Array.isArray(data.list) ? data.list : [];
  return { clients: rows.map(clientRecord), total_count: int(data.total, rows.length), status_code: response.status, raw_body: response.body };
};

const getClient = async (ctx) => {
  const clientId = required(ctx.request.client_id, 'client_id');
  const response = await authenticated(ctx, '/api/v1/getCustomList?collection=terminalManager', { method: 'POST', payload: { client_id: clientId } });
  let item = response.data?.data ?? response.data ?? {};
  if (Array.isArray(item.list)) item = item.list[0] ?? {};
  return { client: clientRecord(item), status_code: response.status, raw_body: response.body };
};

const threat = (item = {}) => ({ threats_num: int(item.threats_num), terminal_num: int(item.terminal_num) });
const alertStats = async (ctx) => {
  const response = await authenticated(ctx, '/api/v1/audit/stat');
  const data = response.data?.data ?? response.data ?? {};
  return {
    scan: threat(data.scan), hi_leak: threat(data.hi_leak), week_pwd: threat(data.week_pwd), intrusion: threat(data.intrusion),
    aggregate_virus_value: int(data.aggregate_virus_value), aggregate_ransom_value: int(data.aggregate_ransom_value),
    file_prot: int(data.file_prot), exec_prot: int(data.exec_prot), reg_prot: int(data.reg_prot), proc_prot: int(data.proc_prot),
    risk_blocked: int(data.risk_blocked), virus_immune: int(data.virus_immune), udev_illegal: int(data.udev_illegal),
    soft_illegal: int(data.soft_illegal), inner_illegal: int(data.inner_illegal), status_code: response.status, raw_body: response.body,
  };
};

const systemView = async (ctx) => {
  const response = await authenticated(ctx, '/api/v1/view/system_view');
  const data = response.data?.data ?? response.data ?? {};
  const view = data.view ?? {};
  const server = data.server ?? {};
  const license = data.license ?? {};
  return {
    view: { terminal_all: int(view.terminal_all), terminal_online: int(view.terminal_online), terminal_banned: int(view.terminal_banned), total_use: int(view.total_use), windows: int(view.windows), server: int(view.server), linux: int(view.linux), domestic: int(view.domestic) },
    server_info: { host_name: text(server.host_name), server_time: text(server.server_time) },
    license_info: { user: text(license.user), type: text(license.type), license_platform: text(license.license_platform) },
    status_code: response.status, raw_body: response.body,
  };
};

const systemInfo = async (ctx) => {
  const response = await authenticated(ctx, '/api/v1/view/system_view');
  const data = response.data?.data ?? response.data ?? {};
  return { system_info: { disk_usage: int(data.disk_usage), memory_usage: int(data.memory_usage), cpu_usage: int(data.cpu_usage), network_tx: int(data.network_tx), network_rx: int(data.network_rx), server_time: text(data.server_time) }, status_code: response.status, raw_body: response.body };
};

export const handlers = {
  [RPC.login]: login,
  [RPC.listClients]: listClients,
  [RPC.getClient]: getClient,
  [RPC.getAlertStats]: alertStats,
  [RPC.getSystemView]: systemView,
  [RPC.getSystemInfo]: systemInfo,
};
