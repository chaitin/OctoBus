// Qihoo360_EPP 360 EPP Terminal Security Management System proxy
// Authenticates via RSA-encrypted password login, maintains PN session cookie
// API endpoints follow CodeIgniter convention: /controller/method

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import crypto from 'crypto';
import https from 'node:https';

const DEFAULT_TIMEOUT_MS = 30000;

const METHOD_PREFIX = 'Qihoo360_EPP.Qihoo360_EPP';

// ========== Helpers ==========

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  DEADLINE_EXCEEDED: grpcStatus.DEADLINE_EXCEEDED,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
  NOT_FOUND: grpcStatus.NOT_FOUND,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

const firstDefined = (...vals) => vals.find((v) => v !== undefined && v !== null);

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const normalizeBaseUrl = (url) => {
  const base = String(url || '').trim();
  if (!/^https?:\/\//i.test(base)) return null;
  return base.replace(/\/$/, '');
};

const toPositiveInt = (val) => {
  if (val === undefined || val === null) return null;
  if (typeof val === 'object') {
    if ('value' in val) return toPositiveInt(val.value);
    return null;
  }
  const n = Number(val);
  if (!Number.isInteger(n) || Number.isNaN(n)) return null;
  return n;
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.secret ?? {}),
  ...(ctx?.bindings ?? {}),
});

// ========== RSA Encryption for Login ==========

function rsaEncrypt(plaintext, pubkeyPem) {
  // PKCS#1 v1.5 encryption using the public key
  const encrypted = crypto.publicEncrypt(
    {
      key: pubkeyPem,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(plaintext, 'utf-8')
  );
  return encrypted.toString('base64');
}

function md5Hash(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

// ========== Session Management ==========

// Per-connection TLS skip agent; scoped to connections, not global.
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

class EppSession {
  constructor() {
    this.cookie = null;
    this.baseUrl = null;
    this.timeoutMs = DEFAULT_TIMEOUT_MS;
    this.skipTlsVerify = false;
    this.username = null;
    this.password = null;
    this.configuredUsername = '';
    this.configuredPassword = '';
  }

  configure(ctx) {
    const bindings = mergedBindings(ctx);
    this.baseUrl = normalizeBaseUrl(
      bindings.endpoint || bindings.baseUrl || bindings.restBaseUrl || ''
    );

    const newUsername = bindings.username || '';
    const newPassword = bindings.password || '';

    if (newUsername !== this.configuredUsername || newPassword !== this.configuredPassword) {
      this.cookie = null;
    }
    this.configuredUsername = newUsername;
    this.configuredPassword = newPassword;

    this.timeoutMs = ctx.limits?.timeoutMs || bindings.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.skipTlsVerify = Boolean(
      bindings.skipTlsVerify || bindings.tlsInsecureSkipVerify || bindings.skip_tls_verify
    );
  }

  async login(username, password) {
    if (!this.baseUrl) {
      throw errorWithCode('INVALID_ARGUMENT', 'endpoint/baseUrl is required (http/https)');
    }

    try {
      // Step 1: Get RSA public key
      const pubKeyUrl = `${this.baseUrl}/user/getPubKey?username=${encodeURIComponent(username)}`;
      const pubKeyRes = await this.fetchWithTimeout(pubKeyUrl, {
        method: 'GET',
        headers: {
          'Referer': `${this.baseUrl}/dist/`,
          'X-Requested-With': 'XMLHttpRequest',
        },
      });

      if (!pubKeyRes.ok) {
        throw errorWithCode('UNAVAILABLE', `getPubKey failed: HTTP ${pubKeyRes.status}`);
      }

      const pubKeyData = await pubKeyRes.json();
      if (pubKeyData.errno !== 0) {
        throw errorWithCode('UNAUTHENTICATED', `getPubKey error: ${pubKeyData.errmsg}`);
      }

      const pubkeyPem = pubKeyData.data?.pubkey;
      if (!pubkeyPem) {
        throw errorWithCode('UNAVAILABLE', 'getPubKey returned no public key');
      }

      // Step 2: Encrypt password
      const passwordMd5 = md5Hash(password);
      const rPassword = rsaEncrypt(password, pubkeyPem);

      // Step 3: Login
      const loginBody = new URLSearchParams({
        username,
        password: passwordMd5,
        rPassword,
      }).toString();

      const loginRes = await this.fetchWithTimeout(`${this.baseUrl}/user/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${this.baseUrl}/dist/`,
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: loginBody,
      });

      if (!loginRes.ok) {
        throw errorWithCode('UNAVAILABLE', `login failed: HTTP ${loginRes.status}`);
      }

      const setCookie = loginRes.headers.get('set-cookie');
      if (setCookie) {
        this.cookie = setCookie.split(';')[0]; // Extract "PN=value"
      }

      // Also parse from response headers
      if (!this.cookie) {
        const cookies = loginRes.headers.get('set-cookie') || '';
        const match = cookies.match(/PN=([^;]+)/);
        if (match) this.cookie = `PN=${match[1]}`;
      }

      if (!this.cookie) {
        // Try to read login response
        const loginData = await loginRes.json().catch(() => ({}));
        if (loginData.errno !== 0) {
          throw errorWithCode('UNAUTHENTICATED', `login failed: ${loginData.errmsg}`);
        }
        throw errorWithCode('UNAUTHENTICATED', 'login succeeded but no session cookie received');
      }

      this.username = username;
      this.password = password;
    } catch (e) {
      if (e instanceof GrpcError) throw e;
      throw errorWithCode('UNAVAILABLE', `login error: ${e.message}`);
    }
  }

  async apiGet(path, queryParams = {}, retried = false) {
    if (!this.cookie) {
      throw errorWithCode('UNAUTHENTICATED', 'not logged in');
    }

    const url = new URL(`${this.baseUrl}${path}`);
    Object.entries(queryParams).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.set(k, String(v));
      }
    });

    const res = await this.fetchWithTimeout(url.toString(), {
      method: 'GET',
      headers: {
        'Cookie': this.cookie,
        'Referer': `${this.baseUrl}/dist/`,
        'X-Requested-With': 'XMLHttpRequest',
      },
    });

    if (!res.ok) {
      throw errorWithCode('UNAVAILABLE', `API request failed: HTTP ${res.status}`);
    }

    const data = await res.json();
    if (data.errno === 10401) {
      this.cookie = null;
      if (this.username && this.password && !retried) {
        await this.login(this.username, this.password);
        return this.apiGet(path, queryParams, true);
      }
      throw errorWithCode('UNAUTHENTICATED', `session expired: ${data.errmsg}`);
    }
    if (data.errno !== 0 && data.errno !== undefined) {
      throw errorWithCode('FAILED_PRECONDITION', `API error: ${data.errmsg} (errno=${data.errno})`);
    }

    return data;
  }

  async apiPost(path, body = {}, retried = false) {
    if (!this.cookie) {
      throw errorWithCode('UNAUTHENTICATED', 'not logged in');
    }

    const res = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': this.cookie,
        'Referer': `${this.baseUrl}/dist/`,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: new URLSearchParams(body).toString(),
    });

    if (!res.ok) {
      throw errorWithCode('UNAVAILABLE', `API request failed: HTTP ${res.status}`);
    }

    const data = await res.json();
    if (data.errno === 10401) {
      this.cookie = null;
      if (this.username && this.password && !retried) {
        await this.login(this.username, this.password);
        return this.apiPost(path, body, true);
      }
      throw errorWithCode('UNAUTHENTICATED', `session expired: ${data.errmsg}`);
    }
    if (data.errno !== 0 && data.errno !== undefined) {
      throw errorWithCode('FAILED_PRECONDITION', `API error: ${data.errmsg} (errno=${data.errno})`);
    }

    return data;
  }

  // Wraps https.request with a custom agent to produce a fetch-like Response.
  // Used only when skipTlsVerify is true, so TLS skipping is scoped to these
  // connections and does not affect the global process.
  _requestHttps(url, options) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const req = https.request({
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: options.method || 'GET',
        headers: options.headers || {},
        agent: insecureAgent,
        signal: options.signal,
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('error', reject);
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          const headers = res.headers;
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            headers: {
              get: (name) => {
                const lc = name.toLowerCase();
                return headers[lc] ?? null;
              },
            },
            json: async () => JSON.parse(body.toString()),
            text: async () => body.toString(),
          });
        });
      });
      req.on('error', reject);
      if (options.body) req.write(options.body);
      req.end();
    });
  }

  async fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const opts = { ...options, signal: controller.signal };
      // Native fetch (undici) does not support a custom HTTPS agent.
      // When TLS verification must be skipped, use https.request with a
      // per-connection insecureAgent so the process-wide TLS setting is
      // never touched.
      const useInsecure = this.skipTlsVerify && url.startsWith('https:');
      const res = useInsecure
        ? await this._requestHttps(url, opts)
        : await fetch(url, opts);
      return res;
    } catch (e) {
      if (e.name === 'AbortError') {
        throw errorWithCode('DEADLINE_EXCEEDED', `request timeout after ${this.timeoutMs}ms`);
      }
      throw errorWithCode('UNAVAILABLE', `fetch failed: ${e.message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

// Global session cache keyed by instanceId
const sessions = new Map();

function getSession(ctx) {
  const bindings = mergedBindings(ctx);
  const instanceId = ctx.meta?.instance_id || ctx.meta?.instanceId || 'default';
  const key = `${instanceId}`;

  if (!sessions.has(key)) {
    sessions.set(key, new EppSession());
  }
  const session = sessions.get(key);
  session.configure(ctx);
  return session;
}

async function ensureLogin(ctx) {
  const session = getSession(ctx);
  const bindings = mergedBindings(ctx);
  const username = bindings.username;
  const password = bindings.password;

  if (!username || !password) {
    throw errorWithCode('INVALID_ARGUMENT', 'username and password are required (configure via secret)');
  }

  if (!session.cookie) {
    await session.login(username, password);
  }
  return session;
}

// ========== RPC Handlers ==========

async function handleGetDashboardInfo(ctx) {
  const session = await ensureLogin(ctx);
  const data = await session.apiGet('/daping/general/info');
  return { data: toStructValue(data.data ?? {}) };
}

async function handleListTerminals(ctx) {
  const session = await ensureLogin(ctx);
  const req = ctx.req || {};

  const page = toPositiveInt(firstDefined(req?.page, req?.Page)) || 1;
  const pageSize = toPositiveInt(firstDefined(req?.page_size, req?.pageSize, req?.PageSize)) || 20;
  const keyword = firstDefined(req?.keyword, req?.Keyword) || '';
  const groupId = firstDefined(req?.group_id, req?.groupId) || '';
  const status = firstDefined(req?.status, req?.Status) || '';

  const data = await session.apiGet('/api/v2/terminal/list', {
    page,
    rows: pageSize,
    keyword,
    group_id: groupId,
    status,
  });

  const list = Array.isArray(data.data?.list) ? data.data.list : Array.isArray(data.data) ? data.data : [];
  const terminals = list.map(mapTerminalInfo);
  const total = data.data?.total || data.data?.count || terminals.length;

  return { terminals, total };
}

async function handleGetTerminalDetail(ctx) {
  const session = await ensureLogin(ctx);
  const req = ctx.req || {};
  const terminalId = firstDefined(req?.terminal_id, req?.terminalId, req?.TerminalId);

  if (!terminalId) {
    throw errorWithCode('INVALID_ARGUMENT', 'terminal_id is required');
  }

  const data = await session.apiGet('/api/v2/terminal/detail', { id: terminalId });
  const detail = data.data || {};

  return {
    id: String(detail.id ?? terminalId),
    name: detail.name ?? detail.hostname ?? '',
    ip: detail.ip ?? '',
    mac: detail.mac ?? '',
    os: detail.os ?? '',
    os_version: detail.os_version ?? detail.osVersion ?? '',
    status: detail.status ?? '',
    group_name: detail.group_name ?? detail.groupName ?? '',
    last_online_time: detail.last_online_time ?? detail.lastOnlineTime ?? '',
    antivirus_version: detail.antivirus_version ?? '',
    antivirus_status: detail.antivirus_status ?? '',
    cpu: detail.cpu ?? '',
    memory: detail.memory ?? '',
    disk: detail.disk ?? '',
    raw: toStructValue(detail),
  };
}

async function handleListAlarms(ctx) {
  const session = await ensureLogin(ctx);
  const req = ctx.req || {};

  const page = toPositiveInt(firstDefined(req?.page, req?.Page)) || 1;
  const pageSize = toPositiveInt(firstDefined(req?.page_size, req?.pageSize, req?.PageSize)) || 20;
  const alarmType = firstDefined(req?.alarm_type, req?.alarmType) || '';
  const startTime = firstDefined(req?.start_time, req?.startTime) || '';
  const endTime = firstDefined(req?.end_time, req?.endTime) || '';
  const severity = firstDefined(req?.severity, req?.Severity) || '';

  const data = await session.apiGet('/alarmcenter/getloglist', {
    page,
    rows: pageSize,
    type: alarmType,
    start_time: startTime,
    end_time: endTime,
    severity,
  });

  const list = Array.isArray(data.data?.list) ? data.data.list : [];
  const alarms = list.map(mapAlarmInfo);
  const total = data.data?.total || alarms.length;
  const statistics = toStructValue(data.data?.statistics ?? {});

  return { alarms, total, statistics };
}

async function handleGetVirusStats(ctx) {
  const session = await ensureLogin(ctx);
  const data = await session.apiGet('/daping/Virus/info');
  return { data: toStructValue(data.data ?? {}) };
}

async function handleGetLeakFixStats(ctx) {
  const session = await ensureLogin(ctx);
  const data = await session.apiGet('/daping/Leakfix/info');
  return { data: toStructValue(data.data ?? {}) };
}

async function handleGetTerminalHardware(ctx) {
  const session = await ensureLogin(ctx);
  const req = ctx.req || {};
  const terminalId = firstDefined(req?.terminal_id, req?.terminalId, req?.TerminalId);

  if (!terminalId) {
    throw errorWithCode('INVALID_ARGUMENT', 'terminal_id is required');
  }

  const data = await session.apiGet('/api/v2/terminal/hardware', { id: terminalId });
  const hw = data.data || {};

  return {
    terminal_id: String(terminalId),
    cpu_model: hw.cpu_model ?? hw.cpuModel ?? '',
    cpu_cores: String(hw.cpu_cores ?? hw.cpuCores ?? ''),
    memory_size: hw.memory_size ?? hw.memorySize ?? '',
    disk_size: hw.disk_size ?? hw.diskSize ?? '',
    gpu_model: hw.gpu_model ?? hw.gpuModel ?? '',
    motherboard: hw.motherboard ?? '',
    network_adapters: Array.isArray(hw.network_adapters) ? hw.network_adapters : [],
    raw: toStructValue(hw),
  };
}

// ========== Value Mapping ==========

function toStructValue(val) {
  if (val === undefined || val === null) return null;
  if (typeof val !== 'object') return { stringValue: String(val) };
  if (Array.isArray(val)) {
    return {
      listValue: {
        values: val.map((v) => toStructValue(v)).filter(Boolean),
      },
    };
  }
  const fields = {};
  for (const [k, v] of Object.entries(val)) {
    const mapped = toStructValue(v);
    if (mapped !== null) {
      fields[k] = mapped;
    }
  }
  return { structValue: { fields } };
}

function mapTerminalInfo(item) {
  return {
    id: String(item.id ?? ''),
    name: item.name ?? item.hostname ?? '',
    ip: item.ip ?? '',
    mac: item.mac ?? '',
    os: item.os ?? '',
    status: item.status ?? '',
    group_name: item.group_name ?? item.groupName ?? '',
    last_online_time: item.last_online_time ?? item.lastOnlineTime ?? '',
    antivirus_status: item.antivirus_status ?? item.antivirusStatus ?? '',
  };
}

function mapAlarmInfo(item) {
  return {
    id: String(item.id ?? ''),
    type: item.type ?? item.alarm_type ?? '',
    severity: item.severity ?? item.level ?? '',
    title: item.title ?? item.name ?? '',
    description: item.description ?? item.desc ?? '',
    terminal_name: item.terminal_name ?? item.hostname ?? '',
    terminal_ip: item.terminal_ip ?? item.ip ?? '',
    created_time: item.created_time ?? item.time ?? '',
    status: item.status ?? '',
  };
}

// ========== Method Path Constants ==========

const GET_DASHBOARD_INFO = `${METHOD_PREFIX}/GetDashboardInfo`;
const LIST_TERMINALS = `${METHOD_PREFIX}/ListTerminals`;
const GET_TERMINAL_DETAIL = `${METHOD_PREFIX}/GetTerminalDetail`;
const LIST_ALARMS = `${METHOD_PREFIX}/ListAlarms`;
const GET_VIRUS_STATS = `${METHOD_PREFIX}/GetVirusStats`;
const GET_LEAKFIX_STATS = `${METHOD_PREFIX}/GetLeakFixStats`;
const GET_TERMINAL_HARDWARE = `${METHOD_PREFIX}/GetTerminalHardware`;

// ========== RPC Definition ==========

export function rpcdef(ctx) {
  return {
    [GET_DASHBOARD_INFO]: async () => handleGetDashboardInfo(ctx),
    [LIST_TERMINALS]: async () => handleListTerminals(ctx),
    [GET_TERMINAL_DETAIL]: async () => handleGetTerminalDetail(ctx),
    [LIST_ALARMS]: async () => handleListAlarms(ctx),
    [GET_VIRUS_STATS]: async () => handleGetVirusStats(ctx),
    [GET_LEAKFIX_STATS]: async () => handleGetLeakFixStats(ctx),
    [GET_TERMINAL_HARDWARE]: async () => handleGetTerminalHardware(ctx),
  };
}

// ========== Handler Registration ==========

function wrapHandler(methodPath) {
  return async (ctx) => {
    const methods = rpcdef(ctx);
    return methods[methodPath]();
  };
}

export const handlers = {
  [GET_DASHBOARD_INFO]: wrapHandler(GET_DASHBOARD_INFO),
  [LIST_TERMINALS]: wrapHandler(LIST_TERMINALS),
  [GET_TERMINAL_DETAIL]: wrapHandler(GET_TERMINAL_DETAIL),
  [LIST_ALARMS]: wrapHandler(LIST_ALARMS),
  [GET_VIRUS_STATS]: wrapHandler(GET_VIRUS_STATS),
  [GET_LEAKFIX_STATS]: wrapHandler(GET_LEAKFIX_STATS),
  [GET_TERMINAL_HARDWARE]: wrapHandler(GET_TERMINAL_HARDWARE),
};

export const METHOD_GET_DASHBOARD_INFO = GET_DASHBOARD_INFO;
export const METHOD_LIST_TERMINALS = LIST_TERMINALS;
export const METHOD_GET_TERMINAL_DETAIL = GET_TERMINAL_DETAIL;
export const METHOD_LIST_ALARMS = LIST_ALARMS;
export const METHOD_GET_VIRUS_STATS = GET_VIRUS_STATS;
export const METHOD_GET_LEAKFIX_STATS = GET_LEAKFIX_STATS;
export const METHOD_GET_TERMINAL_HARDWARE = GET_TERMINAL_HARDWARE;

export const _test = {
  grpcCodeFor,
  errorWithCode,
  firstDefined,
  hasOwn,
  normalizeBaseUrl,
  toPositiveInt,
  mergedBindings,
  toStructValue,
  mapTerminalInfo,
  mapAlarmInfo,
  EppSession,
};
