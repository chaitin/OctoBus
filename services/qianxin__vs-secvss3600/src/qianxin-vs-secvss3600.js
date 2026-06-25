// QIANXIN SecVSS 3600 vulnerability scanner REST proxy
// Auth: POST /async/login/token/ (auto) or bindings.token (pre-obtained)

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const DEFAULT_TIMEOUT_MS = 15000;

const PKG = 'QIANXIN_VS_SecVSS3600';
const P = `/${PKG}.${PKG}/`;

const PATHS = {
  GET_DEVICE_STATUS: `${P}GetDeviceStatus`,
  LIST_TASKS: `${P}ListTasks`,
  GET_TASK_STATUS: `${P}GetTaskStatus`,
  SUBMIT_SCAN_TASK: `${P}SubmitScanTask`,
  CONTROL_TASK: `${P}ControlTask`,
  QUERY_SYS_SCAN_RESULT: `${P}QuerySysScanResult`,
  QUERY_WEB_SCAN_RESULT: `${P}QueryWebScanResult`,
  QUERY_WEAK_PASS_RESULT: `${P}QueryWeakPassResult`,
};

const VALID_ACTIONS = new Set(['start', 'stop', 'pause', 'continue', 'enable', 'disable', 'delete']);

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const err = (code, msg) => {
  const e = new GrpcError(grpcCodeFor(code), `${code}: ${msg}`);
  e.legacyCode = code;
  return e;
};

const toValue = (val) => {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'number') return { numberValue: val };
  if (typeof val === 'boolean') return { boolValue: val };
  if (Array.isArray(val)) {
    return { listValue: { values: val.map(toValue).filter((v) => v !== undefined) } };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      const nv = toValue(v);
      fields[k] = nv === undefined ? { nullValue: 'NULL_VALUE' } : nv;
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(val) };
};

const toInt = (val) => {
  if (val === undefined || val === null) return null;
  if (typeof val === 'object' && 'value' in val) return toInt(val.value);
  const n = Number(val);
  return Number.isInteger(n) && !Number.isNaN(n) ? n : null;
};

const unwrap = (val) => {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'object' && 'value' in val) return String(val.value ?? '');
  return String(val);
};

const firstDefined = (...vals) => vals.find((v) => v !== undefined && v !== null);

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.secret ?? {}),
  ...(ctx?.bindings ?? {}),
});

const normalizeBaseUrl = (url) => {
  const s = String(url || '').trim();
  if (!/^https?:\/\//i.test(s)) return null;
  return s.replace(/\/+$/, '');
};

export function rpcdef(ctx) {
  const bindings = mergedBindings(ctx);
  const timeoutMs = ctx.limits?.timeoutMs || DEFAULT_TIMEOUT_MS;
  const skipTls = Boolean(
    bindings.tlsInsecureSkipVerify || bindings.skipTlsVerify ||
    bindings.skip_tls_verify || bindings.tls_insecure_skip_verify,
  );

  const tlsOpts = () => (skipTls ? { insecureSkipVerify: true, tlsInsecureSkipVerify: true } : {});

  const baseUrl = () => {
    const u = normalizeBaseUrl(firstDefined(
      bindings.restBaseUrl, bindings.rest_base_url,
      bindings.baseUrl, bindings.base_url, bindings.endpoint,
    ));
    if (!u) throw err('INVALID_ARGUMENT', 'restBaseUrl is required (http/https)');
    return u;
  };

  const doFetch = async (url, init) => {
    try {
      return await fetch(url, { ...init, timeoutMs, ...tlsOpts() });
    } catch (e) {
      throw err('UNAVAILABLE', e?.cause?.message || e?.message || 'fetch failed');
    }
  };

  const readJson = async (res) => {
    const text = await res.text();
    if (!res.ok) {
      const s = res.status;
      if (s === 401 || s === 403) throw err('PERMISSION_DENIED', `http ${s}: ${text}`);
      if (s >= 400 && s < 500) throw err('FAILED_PRECONDITION', `http ${s}: ${text}`);
      throw err('UNAVAILABLE', `http ${s}: ${text}`);
    }
    if (!text.trim()) throw err('UNKNOWN', 'empty response body');
    try { return JSON.parse(text); } catch { throw err('UNKNOWN', 'response is not valid JSON'); }
  };

  const postJson = async (url, headers, body) => {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return readJson(res);
  };

  const checkError = (json) => {
    if (json?.success === false && json?.errorcode != null) {
      const code = String(json.errorcode);
      if (code === '1001') throw err('INVALID_ARGUMENT', `upstream errorcode ${code}`);
      if (code === '1002' || code === '1013') throw err('PERMISSION_DENIED', `upstream errorcode ${code}`);
      throw err('FAILED_PRECONDITION', `upstream errorcode ${code}`);
    }
  };

  const getToken = async (req) => {
    const tok = String(firstDefined(req?.token, bindings.token) || '').trim();
    if (tok) return tok;
    const user = String(firstDefined(bindings.user, bindings.username) || '').trim();
    const pwd = String(firstDefined(bindings.pwd, bindings.password) || '').trim();
    if (!user || !pwd) throw err('INVALID_ARGUMENT', 'token or (user + pwd in secret) is required');
    const base = baseUrl();
    const json = await postJson(`${base}/async/login/token/`, {}, { user, pwd });
    checkError(json);
    const token = String(json?.token || '').trim();
    if (!token) throw err('UNKNOWN', 'login returned no token');
    return token;
  };

  const callGetDeviceStatus = async (_req) => {
    const base = baseUrl();
    const json = await postJson(`${base}/async/device/status/`, {}, {});
    checkError(json);
    return {
      cpu_load: String(json?.['CPU Load'] ?? json?.cpu_load ?? ''),
      disk_usage: String(json?.['Disk Usage'] ?? json?.disk_usage ?? ''),
      memory_usage: String(json?.['Memory Usage'] ?? json?.memory_usage ?? ''),
      system_version: String(json?.System ?? json?.system_version ?? ''),
      engines: Array.isArray(json?.engine) ? json.engine.map(toValue).filter(Boolean) : [],
    };
  };

  const callListTasks = async (req) => {
    const base = baseUrl();
    const token = await getToken(req);
    const body = {};
    const status = toInt(firstDefined(req?.status));
    if (status !== null) body.status = status;
    const st = unwrap(firstDefined(req?.starttime));
    if (st) body.starttime = st;
    const et = unwrap(firstDefined(req?.endtime));
    if (et) body.endtime = et;
    const page = toInt(firstDefined(req?.page));
    if (page !== null) body.page = page;
    const pageSize = toInt(firstDefined(req?.page_size, req?.iDisplayLength));
    if (pageSize !== null) body.iDisplayLength = pageSize;
    const json = await postJson(`${base}/async/tasklist/query/`, { token }, body);
    checkError(json);
    const aaData = Array.isArray(json?.aaData) ? json.aaData : [];
    return {
      total: toInt(json?.iTotalRecords) ?? 0,
      tasks: aaData.map(toValue).filter(Boolean),
    };
  };

  const callGetTaskStatus = async (req) => {
    const base = baseUrl();
    const token = await getToken(req);
    const taskId = toInt(firstDefined(req?.task_id, req?.taskId, req?.taskallid));
    if (taskId === null) throw err('INVALID_ARGUMENT', 'task_id is required');
    const json = await postJson(`${base}/async/status/`, { token }, { taskallid: taskId });
    checkError(json);
    return {
      status: toInt(json?.status) ?? 0,
      progress: toInt(json?.progress) ?? 0,
    };
  };

  const callSubmitScanTask = async (req) => {
    const base = baseUrl();
    const token = await getToken(req);
    const target = String(firstDefined(req?.target) || '').trim();
    if (!target) throw err('INVALID_ARGUMENT', 'target is required');
    const body = { target };
    const taskType = toInt(firstDefined(req?.task_type, req?.taskType));
    if (taskType !== null) body.task_type = taskType;
    const name = unwrap(firstDefined(req?.name));
    if (name) body.name = name;
    const vulPlugin = toInt(firstDefined(req?.vul_plugin, req?.vulPlugin));
    if (vulPlugin !== null) body.vul_plugin = vulPlugin;
    const json = await postJson(`${base}/async/newtask/add/`, { token }, body);
    checkError(json);
    return {
      task_id: toInt(json?.taskall_id) ?? 0,
      sys_task_id: toInt(json?.sys_task_id) ?? 0,
      web_task_id: toInt(json?.web_task_id) ?? 0,
      alive_task_id: toInt(json?.alive_task_id) ?? 0,
      crack_task_id: toInt(json?.ret_crack_task_id) ?? 0,
    };
  };

  const callControlTask = async (req) => {
    const base = baseUrl();
    const token = await getToken(req);
    const taskId = toInt(firstDefined(req?.task_id, req?.taskId, req?.taskallid));
    if (taskId === null) throw err('INVALID_ARGUMENT', 'task_id is required');
    const action = String(firstDefined(req?.action, req?.controltype) || '').trim().toLowerCase();
    if (!VALID_ACTIONS.has(action)) {
      throw err('INVALID_ARGUMENT', `action must be one of: ${[...VALID_ACTIONS].join(', ')}`);
    }
    const json = await postJson(`${base}/async/control/`, { token }, { controltype: action, taskallid: taskId });
    checkError(json);
    return {};
  };

  const callQuerySysScanResult = async (req) => {
    const base = baseUrl();
    const token = await getToken(req);
    const taskId = toInt(firstDefined(req?.task_id, req?.taskId, req?.taskid));
    if (taskId === null) throw err('INVALID_ARGUMENT', 'task_id is required');
    const body = { taskid: taskId };
    const target = unwrap(firstDefined(req?.target));
    if (target) body.target = target;
    const json = await postJson(`${base}/async/sysscan/query/`, { token }, body);
    checkError(json);
    const hosts = Array.isArray(json?.hosts) ? json.hosts : [];
    return {
      status: String(json?.status ?? ''),
      hosts_count: toInt(json?.hostscount) ?? 0,
      vul_high: toInt(json?.vulhigh) ?? 0,
      vul_medium: toInt(json?.vulmedium) ?? 0,
      vul_low: toInt(json?.vullow) ?? 0,
      hosts: hosts.map(toValue).filter(Boolean),
    };
  };

  const callQueryWebScanResult = async (req) => {
    const base = baseUrl();
    const token = await getToken(req);
    const taskId = toInt(firstDefined(req?.task_id, req?.taskId, req?.taskid));
    if (taskId === null) throw err('INVALID_ARGUMENT', 'task_id is required');
    const body = { taskid: taskId };
    const target = unwrap(firstDefined(req?.target));
    if (target) body.target = target;
    const json = await postJson(`${base}/async/webscan/query/`, { token }, body);
    checkError(json);
    const hosts = Array.isArray(json?.hosts) ? json.hosts : [];
    return {
      status: String(json?.status ?? ''),
      hosts_count: toInt(json?.hostscount) ?? 0,
      total_vulns: toInt(json?.total) ?? 0,
      hosts: hosts.map(toValue).filter(Boolean),
    };
  };

  const callQueryWeakPassResult = async (req) => {
    const base = baseUrl();
    const token = await getToken(req);
    const taskId = toInt(firstDefined(req?.task_id, req?.taskId, req?.taskid));
    if (taskId === null) throw err('INVALID_ARGUMENT', 'task_id is required');
    const body = { taskid: taskId };
    const target = unwrap(firstDefined(req?.target));
    if (target) body.target = target;
    const json = await postJson(`${base}/async/crack/query/`, { token }, body);
    checkError(json);
    const hosts = Array.isArray(json?.hosts) ? json.hosts : [];
    return {
      status: String(json?.status ?? ''),
      hosts_count: toInt(json?.hostscount) ?? 0,
      total: toInt(json?.total) ?? 0,
      hosts: hosts.map(toValue).filter(Boolean),
    };
  };

  return {
    [PATHS.GET_DEVICE_STATUS]: async () => callGetDeviceStatus(ctx.req),
    [PATHS.LIST_TASKS]: async () => callListTasks(ctx.req),
    [PATHS.GET_TASK_STATUS]: async () => callGetTaskStatus(ctx.req),
    [PATHS.SUBMIT_SCAN_TASK]: async () => callSubmitScanTask(ctx.req),
    [PATHS.CONTROL_TASK]: async () => callControlTask(ctx.req),
    [PATHS.QUERY_SYS_SCAN_RESULT]: async () => callQuerySysScanResult(ctx.req),
    [PATHS.QUERY_WEB_SCAN_RESULT]: async () => callQueryWebScanResult(ctx.req),
    [PATHS.QUERY_WEAK_PASS_RESULT]: async () => callQueryWeakPassResult(ctx.req),
  };
}

const mergeCtx = (base, inner) => ({
  ...(base ?? {}), ...(inner ?? {}),
  bindings: { ...(base?.bindings ?? {}), ...(inner?.bindings ?? {}) },
  config: { ...(base?.config ?? {}), ...(inner?.config ?? {}) },
  secret: { ...(base?.secret ?? {}), ...(inner?.secret ?? {}) },
  limits: inner?.limits ?? base?.limits ?? {},
  meta: inner?.meta ?? base?.meta ?? {},
});

const resolveCallContext = (baseCtx, reqOrCtx, maybeCtx) => {
  if (maybeCtx !== undefined) return { req: reqOrCtx ?? {}, ctx: mergeCtx(baseCtx, maybeCtx) };
  const inner = reqOrCtx ?? {};
  return { req: inner.request ?? inner.req ?? {}, ctx: mergeCtx(baseCtx, inner) };
};

const wrapHandler = (baseCtx, path) => async (reqOrCtx, maybeCtx) => {
  const { req, ctx } = resolveCallContext(baseCtx, reqOrCtx, maybeCtx);
  return rpcdef({ ...ctx, req })[path]();
};

const registerHandlers = (ctx = {}) => Object.fromEntries(
  Object.values(PATHS).map((p) => [p, wrapHandler(ctx, p)]),
);

const sdkHandlers = registerHandlers({});

export const handlers = Object.fromEntries(
  Object.values(PATHS).map((p) => [p.replace(/^\//, ''), sdkHandlers[p]]),
);

export const _test = { err, firstDefined, mergedBindings, normalizeBaseUrl, toInt, toValue, unwrap };
