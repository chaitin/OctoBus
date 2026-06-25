// QIANXIN_VS_SecVSS3600 - 网神 SecVSS 3600 漏洞扫描系统
// Auth: POST /async/login/token/ → token; pass token in HTTP header "token: <value>"

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const DEFAULT_TIMEOUT_MS = 10000;
const PKG = 'QIANXIN_VS_SecVSS3600';

const METHODS = {
  GET_TOKEN: `/${PKG}.${PKG}/GetToken`,
  SUBMIT_SCAN_TASK: `/${PKG}.${PKG}/SubmitScanTask`,
  CONTROL_TASK: `/${PKG}.${PKG}/ControlTask`,
  GET_TASK_PROGRESS: `/${PKG}.${PKG}/GetTaskProgress`,
  QUERY_SYS_SCAN_RESULT: `/${PKG}.${PKG}/QuerySysScanResult`,
  LIST_TASKS: `/${PKG}.${PKG}/ListTasks`,
  QUERY_WEB_SCAN_RESULT: `/${PKG}.${PKG}/QueryWebScanResult`,
  QUERY_WEAK_PASS_RESULT: `/${PKG}.${PKG}/QueryWeakPassResult`,
  GET_DEVICE_STATUS: `/${PKG}.${PKG}/GetDeviceStatus`,
  LIST_VUL_TEMPLATES: `/${PKG}.${PKG}/ListVulTemplates`,
};

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

// Inner helper: converts JS value to protobuf Value structure (null → nullValue sentinel)
const toValueInner = (val) => {
  if (val === undefined || val === null) return { nullValue: 'NULL_VALUE' };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'number') return { numberValue: val };
  if (typeof val === 'boolean') return { boolValue: val };
  if (Array.isArray(val)) {
    return { listValue: { values: val.map(toValueInner) } };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      fields[k] = toValueInner(v);
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(val) };
};

// Outer toValue: top-level null/undefined returns null (not the sentinel)
const toValue = (val) => {
  if (val === undefined || val === null) return null;
  return toValueInner(val);
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const firstDefined = (...vals) => vals.find((v) => v !== undefined && v !== null);

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.secret ?? {}),
  ...(ctx?.bindings ?? {}),
});

const normalizeBaseUrl = (url) => {
  const base = String(url || '').trim();
  if (!/^https?:\/\//i.test(base)) return '';
  return base.replace(/\/+$/, '');
};

const unwrapString = (source) => {
  if (source === undefined || source === null) return '';
  if (typeof source === 'object' && source !== null && 'value' in source) {
    return String(source.value ?? '');
  }
  return String(source);
};

const mapErrorCode = (errorcode) => {
  const code = String(errorcode ?? '');
  if (code === '1001') return 'INVALID_ARGUMENT';
  if (code === '1002' || code === '1013') return 'PERMISSION_DENIED';
  return 'FAILED_PRECONDITION';
};

const VALID_CONTROL_TYPES = new Set(['start', 'stop', 'pause', 'continue', 'enable', 'disable', 'delete']);

export function rpcdef(ctx) {
  const bindings = mergedBindings(ctx);
  const rawBaseUrl = firstDefined(
    bindings.restBaseUrl, bindings.rest_base_url,
    bindings.baseUrl, bindings.base_url,
    bindings.endpoint
  );
  const timeoutMs = ctx.limits?.timeoutMs || DEFAULT_TIMEOUT_MS;
  const skipTlsVerify = Boolean(
    bindings.tlsInsecureSkipVerify || bindings.skipTlsVerify ||
    bindings.skip_tls_verify || bindings.tls_insecure_skip_verify
  );

  const tlsOptions = () => (skipTlsVerify ? { insecureSkipVerify: true, tlsInsecureSkipVerify: true } : {});

  const requireBaseUrl = () => {
    const base = normalizeBaseUrl(rawBaseUrl);
    if (!base) throw errorWithCode('INVALID_ARGUMENT', 'restBaseUrl/baseUrl/endpoint is required (http/https)');
    return base;
  };

  const fetchSecVSS = async (url, init) => {
    try {
      return await fetch(url, { ...init, timeoutMs, ...tlsOptions() });
    } catch (e) {
      const reason = e?.cause?.message || e?.message || 'fetch failed';
      throw errorWithCode('UNAVAILABLE', reason);
    }
  };

  const readJsonResponse = async (res) => {
    const text = await res.text();
    if (!res.ok) {
      const status = res.status;
      if (status === 401 || status === 403) throw errorWithCode('PERMISSION_DENIED', `upstream http ${status}: ${text}`);
      if (status >= 400 && status < 500) throw errorWithCode('FAILED_PRECONDITION', `upstream http ${status}: ${text}`);
      throw errorWithCode('UNAVAILABLE', `upstream http ${status}: ${text}`);
    }
    if (!text.trim()) throw errorWithCode('UNKNOWN', 'empty response body');
    const ct = res.headers?.get?.('content-type') ?? '';
    if (ct.includes('application/json')) return JSON.parse(text);
    try {
      return JSON.parse(text);
    } catch {
      throw errorWithCode('UNKNOWN', 'response is not valid JSON');
    }
  };

  const requireToken = (req) => {
    const tok = unwrapString(firstDefined(req?.token, req?.Token));
    if (!tok) throw errorWithCode('INVALID_ARGUMENT', 'token is required');
    return tok;
  };

  const requireField = (req, key, fallback) => {
    const val = unwrapString(firstDefined(
      hasOwn(req, key) ? req[key] : undefined,
      fallback
    ));
    if (!val) throw errorWithCode('INVALID_ARGUMENT', `${key} is required`);
    return val;
  };

  const optionalField = (req, key) => {
    if (!hasOwn(req, key)) return undefined;
    const raw = req[key];
    if (raw === undefined || raw === null) return undefined;
    return unwrapString(raw);
  };

  const postJson = async (url, headers, body) => {
    const res = await fetchSecVSS(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return readJsonResponse(res);
  };

  const checkUpstreamError = (json) => {
    if (json?.success === false && json?.errorcode != null) {
      const grpcCode = mapErrorCode(json.errorcode);
      throw errorWithCode(grpcCode, `upstream errorcode ${json.errorcode}`);
    }
  };

  const callGetToken = async (req) => {
    const base = requireBaseUrl();
    const user = requireField(req, 'user', bindings.user);
    const pwd = requireField(req, 'pwd', bindings.pwd);

    const json = await postJson(`${base}/async/login/token/`, {}, { user, pwd });
    checkUpstreamError(json);

    return {
      success: Boolean(json?.success),
      token: String(json?.token ?? ''),
      errorcode: String(json?.errorcode ?? ''),
    };
  };

  const callSubmitScanTask = async (req) => {
    const base = requireBaseUrl();
    const token = requireToken(req);
    const target = requireField(req, 'target');

    const body = { target };
    const task_type = optionalField(req, 'task_type');
    if (task_type !== undefined) body.task_type = Number(task_type);
    const name = optionalField(req, 'name');
    if (name !== undefined) body.name = name;
    const schedule = optionalField(req, 'schedule');
    if (schedule !== undefined) body.schedule = Number(schedule);
    const vul_plugin = optionalField(req, 'vul_plugin');
    if (vul_plugin !== undefined) body.vul_plugin = Number(vul_plugin);
    const scan_plugin = optionalField(req, 'scan_plugin');
    if (scan_plugin !== undefined) body.scan_plugin = Number(scan_plugin);

    const json = await postJson(`${base}/async/newtask/add/`, { token }, body);
    checkUpstreamError(json);

    return {
      success: Boolean(json?.success),
      taskall_id: json?.taskall_id != null ? String(json.taskall_id) : undefined,
      sys_task_id: json?.sys_task_id != null ? String(json.sys_task_id) : undefined,
      web_task_id: json?.web_task_id != null ? String(json.web_task_id) : undefined,
      alive_task_id: json?.alive_task_id != null ? String(json.alive_task_id) : undefined,
      ret_crack_task_id: json?.ret_crack_task_id != null ? String(json.ret_crack_task_id) : undefined,
      errorcode: json?.errorcode != null ? String(json.errorcode) : undefined,
    };
  };

  const callControlTask = async (req) => {
    const base = requireBaseUrl();
    const token = requireToken(req);
    const controltype = requireField(req, 'controltype');
    if (!VALID_CONTROL_TYPES.has(controltype)) {
      throw errorWithCode('INVALID_ARGUMENT', `controltype must be one of: ${[...VALID_CONTROL_TYPES].join(', ')}`);
    }
    const taskallid = requireField(req, 'taskallid');

    const json = await postJson(`${base}/async/control/`, { token }, {
      controltype,
      taskallid: Number(taskallid),
    });
    checkUpstreamError(json);

    return {
      success: Boolean(json?.success),
      errorcode: json?.errorcode != null ? String(json.errorcode) : undefined,
    };
  };

  const callGetTaskProgress = async (req) => {
    const base = requireBaseUrl();
    const token = requireToken(req);
    const taskallid = requireField(req, 'taskallid');

    const json = await postJson(`${base}/async/status/`, { token }, {
      taskallid: Number(taskallid),
    });
    checkUpstreamError(json);

    return {
      success: Boolean(json?.success),
      status: json?.status != null ? String(json.status) : undefined,
      progress: json?.progress != null ? Number(json.progress) : undefined,
      scheduletype: json?.scheduletype != null ? Number(json.scheduletype) : undefined,
      errorcode: json?.errorcode != null ? String(json.errorcode) : undefined,
    };
  };

  const callQuerySysScanResult = async (req) => {
    const base = requireBaseUrl();
    const token = requireToken(req);
    const taskid = requireField(req, 'taskid');

    const body = { taskid: Number(taskid) };
    const jobid = optionalField(req, 'jobid');
    if (jobid !== undefined) body.jobid = Number(jobid);
    const target = optionalField(req, 'target');
    if (target !== undefined) body.target = target;

    const json = await postJson(`${base}/async/sysscan/query/`, { token }, body);
    checkUpstreamError(json);

    const hostsArr = Array.isArray(json?.hosts) ? json.hosts : [];
    return {
      success: Boolean(json?.success),
      status: json?.status != null ? String(json.status) : undefined,
      hostscount: json?.hostscount != null ? Number(json.hostscount) : undefined,
      vulnscount: json?.vulnscount != null ? Number(json.vulnscount) : undefined,
      vulhigh: json?.vulhigh != null ? Number(json.vulhigh) : undefined,
      vulmedium: json?.vulmedium != null ? Number(json.vulmedium) : undefined,
      vullow: json?.vullow != null ? Number(json.vullow) : undefined,
      hosts: hostsArr.map(toValue),
      errorcode: json?.errorcode != null ? String(json.errorcode) : undefined,
    };
  };

  const callListTasks = async (req) => {
    const base = requireBaseUrl();
    const token = requireToken(req);

    const body = {};
    const page = optionalField(req, 'page');
    if (page !== undefined) body.page = Number(page);
    const iDisplayLength = optionalField(req, 'iDisplayLength');
    if (iDisplayLength !== undefined) body.iDisplayLength = Number(iDisplayLength);
    const status = optionalField(req, 'status');
    if (status !== undefined) body.status = Number(status);
    const starttime = optionalField(req, 'starttime');
    if (starttime !== undefined) body.starttime = starttime;
    const endtime = optionalField(req, 'endtime');
    if (endtime !== undefined) body.endtime = endtime;

    const json = await postJson(`${base}/async/tasklist/query/`, { token }, body);
    checkUpstreamError(json);

    const aaDataArr = Array.isArray(json?.aaData) ? json.aaData : [];
    return {
      success: Boolean(json?.success),
      iTotalRecords: json?.iTotalRecords != null ? Number(json.iTotalRecords) : undefined,
      aaData: aaDataArr.map(toValue),
      errorcode: json?.errorcode != null ? String(json.errorcode) : undefined,
    };
  };

  const callQueryWebScanResult = async (req) => {
    const base = requireBaseUrl();
    const token = requireToken(req);
    const taskid = requireField(req, 'taskid');
    const body = { taskid: Number(taskid) };
    const jobid = optionalField(req, 'jobid');
    if (jobid !== undefined) body.jobid = Number(jobid);
    const target = optionalField(req, 'target');
    if (target !== undefined) body.target = target;
    const json = await postJson(`${base}/async/webscan/query/`, { token }, body);
    checkUpstreamError(json);
    const hostsArr = Array.isArray(json?.hosts) ? json.hosts : [];
    return {
      success: Boolean(json?.success),
      status: json?.status != null ? String(json.status) : undefined,
      hostscount: json?.hostscount != null ? Number(json.hostscount) : undefined,
      total: json?.total != null ? Number(json.total) : undefined,
      hosts: hostsArr.map(toValue),
      errorcode: json?.errorcode != null ? String(json.errorcode) : undefined,
    };
  };

  const callQueryWeakPassResult = async (req) => {
    const base = requireBaseUrl();
    const token = requireToken(req);
    const taskid = requireField(req, 'taskid');
    const body = { taskid: Number(taskid) };
    const jobid = optionalField(req, 'jobid');
    if (jobid !== undefined) body.jobid = Number(jobid);
    const target = optionalField(req, 'target');
    if (target !== undefined) body.target = target;
    const json = await postJson(`${base}/async/crack/query/`, { token }, body);
    checkUpstreamError(json);
    const hostsArr = Array.isArray(json?.hosts) ? json.hosts : [];
    return {
      success: Boolean(json?.success),
      status: json?.status != null ? String(json.status) : undefined,
      hostscount: json?.hostscount != null ? Number(json.hostscount) : undefined,
      total: json?.total != null ? Number(json.total) : undefined,
      hosts: hostsArr.map(toValue),
      errorcode: json?.errorcode != null ? String(json.errorcode) : undefined,
    };
  };

  const callGetDeviceStatus = async (_req) => {
    const base = requireBaseUrl();
    const json = await postJson(`${base}/async/device/status/`, {}, {});
    checkUpstreamError(json);
    return {
      success: Boolean(json?.success),
      device_info: toValue(json),
    };
  };

  const callListVulTemplates = async (req) => {
    const base = requireBaseUrl();
    const token = requireToken(req);
    const type = requireField(req, 'type');
    if (type !== 'sysscan' && type !== 'webscan') {
      throw errorWithCode('INVALID_ARGUMENT', 'type must be sysscan or webscan');
    }
    const json = await postJson(`${base}/async/ruletemplate/query/`, { token }, { type });
    checkUpstreamError(json);
    const aaDataArr = Array.isArray(json?.aaData) ? json.aaData : [];
    return {
      success: Boolean(json?.success),
      aaData: aaDataArr.map(toValue),
      errorcode: json?.errorcode != null ? String(json.errorcode) : undefined,
    };
  };

  return {
    [METHODS.GET_TOKEN]: async () => callGetToken(ctx.req),
    [METHODS.SUBMIT_SCAN_TASK]: async () => callSubmitScanTask(ctx.req),
    [METHODS.CONTROL_TASK]: async () => callControlTask(ctx.req),
    [METHODS.GET_TASK_PROGRESS]: async () => callGetTaskProgress(ctx.req),
    [METHODS.QUERY_SYS_SCAN_RESULT]: async () => callQuerySysScanResult(ctx.req),
    [METHODS.LIST_TASKS]: async () => callListTasks(ctx.req),
    [METHODS.QUERY_WEB_SCAN_RESULT]: async () => callQueryWebScanResult(ctx.req),
    [METHODS.QUERY_WEAK_PASS_RESULT]: async () => callQueryWeakPassResult(ctx.req),
    [METHODS.GET_DEVICE_STATUS]: async () => callGetDeviceStatus(ctx.req),
    [METHODS.LIST_VUL_TEMPLATES]: async () => callListVulTemplates(ctx.req),
  };
}

const mergeCtx = (baseCtx, innerCtx) => ({
  ...(baseCtx ?? {}),
  ...(innerCtx ?? {}),
  bindings: { ...(baseCtx?.bindings ?? {}), ...(innerCtx?.bindings ?? {}) },
  config: { ...(baseCtx?.config ?? {}), ...(innerCtx?.config ?? {}) },
  secret: { ...(baseCtx?.secret ?? {}), ...(innerCtx?.secret ?? {}) },
  limits: innerCtx?.limits ?? baseCtx?.limits ?? {},
  meta: innerCtx?.meta ?? baseCtx?.meta ?? {},
});

const resolveCallContext = (baseCtx, reqOrCtx, maybeInnerCtx) => {
  if (maybeInnerCtx !== undefined) {
    return { req: reqOrCtx ?? {}, ctx: mergeCtx(baseCtx, maybeInnerCtx) };
  }
  const innerCtx = reqOrCtx ?? {};
  return {
    req: innerCtx.request ?? innerCtx.req ?? {},
    ctx: mergeCtx(baseCtx, innerCtx),
  };
};

const wrapLegacyHandler = (baseCtx, methodPath) => async (reqOrCtx, maybeInnerCtx) => {
  const call = resolveCallContext(baseCtx, reqOrCtx, maybeInnerCtx);
  return rpcdef({ ...call.ctx, req: call.req })[methodPath]();
};

const registerHandlers = (ctx = {}) => Object.fromEntries(
  Object.values(METHODS).map((path) => [path, wrapLegacyHandler(ctx, path)])
);

const sdkHandlers = registerHandlers({});

// handlers keys omit the leading '/' (SDK convention)
export const handlers = Object.fromEntries(
  Object.values(METHODS).map((path) => [path.replace(/^\//, ''), sdkHandlers[path]])
);

export const _test = {
  errorWithCode,
  firstDefined,
  hasOwn,
  mapErrorCode,
  mergedBindings,
  normalizeBaseUrl,
  resolveCallContext,
  toValue,
  unwrapString,
  METHODS,
};
