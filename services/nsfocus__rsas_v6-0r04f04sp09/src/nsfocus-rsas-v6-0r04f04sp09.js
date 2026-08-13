import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const SERVICE_FQN = 'Nsfocus_RSAS_V60R04F04SP09.Nsfocus_RSAS_V60R04F04SP09';
const method = (name) => `${SERVICE_FQN}/${name}`;

export const DEFAULT_TIMEOUT_MS = 30000;

// ---------------------------------------------------------------------------
// Context, bindings, credentials
// ---------------------------------------------------------------------------

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const firstDefined = (...vals) => vals.find((val) => val !== undefined && val !== null);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  RESOURCE_EXHAUSTED: grpcStatus.RESOURCE_EXHAUSTED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.bindings ?? {}),
  ...(ctx?.config ?? {}),
  ...(ctx?.secret ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  config: ctx.config ?? {},
  secret: ctx.secret ?? {},
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.request ?? ctx.req ?? {},
});

const snakeCaseKey = (key) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

// The SDK serializes request fields with protobuf jsonName (camelCase), so the
// runtime delivers e.g. task_id as taskId. Handlers read snake_case, so mirror
// every camelCase key to its snake_case form — recursively, to also cover
// nested messages such as jumparray entries (ip_range/user_name/user_pwd) —
// without clobbering any snake_case key that is already present.
const normalizeRequest = (value) => {
  if (Array.isArray(value)) return value.map((item) => normalizeRequest(item));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) out[key] = normalizeRequest(val);
    for (const key of Object.keys(value)) {
      if (!key.includes('_') && /[A-Z]/.test(key)) {
        const snakeKey = snakeCaseKey(key);
        if (!(snakeKey in out)) out[snakeKey] = out[key];
      }
    }
    return out;
  }
  return value;
};

const requestFromContext = (ctx = {}) => normalizeRequest(ctx?.request ?? ctx?.req ?? {});

const normalizeBaseUrl = (value) => {
  const raw = String(unwrapScalar(value) ?? '').trim();
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.replace(/\/+$/, '');
};

const resolveBaseUrl = (bindings) => normalizeBaseUrl(firstDefined(
  bindings?.host,
  bindings?.restBaseUrl,
  bindings?.rest_base_url,
  bindings?.baseUrl,
  bindings?.base_url,
));

const requireHost = (callCtx) => {
  const host = resolveBaseUrl(callCtx?.bindings || {});
  if (!host) throw errorWithCode('INVALID_ARGUMENT', 'host is required in bindings');
  return host;
};

const resolveTimeoutMs = (callCtx) => {
  const bindings = callCtx?.bindings ?? {};
  const raw = Number(firstDefined(callCtx?.limits?.timeoutMs, bindings.timeoutMs, bindings.timeout_ms, DEFAULT_TIMEOUT_MS));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

const resolveCurrLang = (callCtx) => {
  const bindings = callCtx?.bindings ?? {};
  const raw = String(unwrapScalar(firstDefined(bindings.currLang, bindings.curr_lang)) ?? '').trim().toLowerCase();
  return raw === 'en' ? 'en' : 'cn';
};

// scopeKeys selects which binding spaces to search. Password must stay
// secret-only: config permits arbitrary extra properties and is far more
// likely to be logged, version-controlled, or exported than secret.
const pickCredential = (callCtx, fieldNames, fieldLabel, scopeKeys = ['secret', 'config', 'bindings']) => {
  const sources = scopeKeys.map((key) => callCtx?.[key] || {});
  for (const field of fieldNames) {
    for (const source of sources) {
      const text = String(unwrapScalar(source[field]) ?? '').trim();
      if (text) return text;
    }
  }
  throw errorWithCode('INVALID_ARGUMENT', `${fieldLabel} is required`);
};

const authQuery = (callCtx) => ({
  username: pickCredential(callCtx, ['user', 'username'], 'username'),
  password: pickCredential(callCtx, ['password'], 'password', ['secret']),
  format: 'json',
  curr_lang: resolveCurrLang(callCtx),
});

// ---------------------------------------------------------------------------
// TLS, coercion helpers
// ---------------------------------------------------------------------------

const toBoolean = (value) => {
  const raw = unwrapScalar(value);
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) return false;
  }
  return false;
};

let insecureTlsDispatcher;
const getInsecureTlsDispatcher = () => {
  insecureTlsDispatcher ??= new Agent({ connect: { rejectUnauthorized: false } });
  return insecureTlsDispatcher;
};

const buildTlsOptions = (bindings) => {
  if (!toBoolean(bindings?.skipTlsVerify) && !toBoolean(bindings?.tlsInsecureSkipVerify) && !toBoolean(bindings?.insecureSkipVerify)) return {};
  return { dispatcher: getInsecureTlsDispatcher() };
};

const toInteger = (value, fallback = 0) => {
  const num = Number(unwrapScalar(value));
  if (!Number.isFinite(num) || Number.isNaN(num)) return fallback;
  return Math.trunc(num);
};

// For optional int64 request fields: proto3 scalars decode unset values as 0,
// so `=== undefined` cannot distinguish "unset" from "0". These fields
// (template_id, port, type, page, page_size) have no valid 0 business value,
// so treat 0/unset alike and omit them rather than sending 0 downstream.
const toOptionalPositiveInt = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = toInteger(raw, 0);
  return num > 0 ? num : undefined;
};

const toTrimmed = (value) => String(unwrapScalar(value) ?? '').trim();

const requireField = (value, field) => {
  const text = toTrimmed(value);
  if (!text) throw errorWithCode('INVALID_ARGUMENT', `${field} is required`);
  return text;
};

const toValue = (val) => {
  const raw = unwrapScalar(val);
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string') return { stringValue: raw };
  if (typeof raw === 'number') return { numberValue: raw };
  if (typeof raw === 'boolean') return { boolValue: raw };
  if (Array.isArray(raw)) {
    return { listValue: { values: raw.map((item) => toValue(item)).filter((item) => item !== undefined) } };
  }
  if (typeof raw === 'object') {
    const fields = {};
    for (const [key, value] of Object.entries(raw)) {
      const normalized = toValue(value);
      fields[key] = normalized === undefined ? { nullValue: 'NULL_VALUE' } : normalized;
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(raw) };
};

const appendQuery = (url, params = {}) => {
  const pairs = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  if (pairs.length === 0) return url;
  return url.includes('?') ? `${url}&${pairs.join('&')}` : `${url}?${pairs.join('&')}`;
};

// ---------------------------------------------------------------------------
// HTTP transport
// ---------------------------------------------------------------------------

const parseJsonOrThrow = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', 'response is not valid JSON');
  }
};

// Map RSAS transport-level HTTP failures to gRPC legacy codes before body parsing.
const guardHttpStatus = (status) => {
  if (status === 401) throw errorWithCode('PERMISSION_DENIED', 'authentication failed (HTTP 401)');
  if (status === 403) throw errorWithCode('PERMISSION_DENIED', 'not authorized (HTTP 403)');
  if (status === 404) throw errorWithCode('INVALID_ARGUMENT', 'no such interface (HTTP 404)');
  if (status === 405) throw errorWithCode('INVALID_ARGUMENT', 'method not allowed (HTTP 405)');
  if (status === 429) throw errorWithCode('RESOURCE_EXHAUSTED', 'too many requests (HTTP 429)');
  if (status >= 500) throw errorWithCode('UNAVAILABLE', `upstream error (HTTP ${status})`);
};

const doFetch = async (callCtx, url, init = {}) => {
  let res;
  try {
    res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(resolveTimeoutMs(callCtx)),
      ...buildTlsOptions(callCtx.bindings),
      headers: {
        ...(callCtx.bindings?.headers || {}),
        ...(init.headers || {}),
      },
    });
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', err?.cause?.message || err?.message || 'fetch failed');
  }
  return res;
};

// Send a request whose response is expected to be the standard RSAS JSON envelope.
const requestJson = async (callCtx, { path, query = {}, method: httpMethod = 'GET', form, json }) => {
  const host = requireHost(callCtx);
  const url = appendQuery(`${host}${path}`, { ...authQuery(callCtx), ...query });
  const init = { method: httpMethod };
  if (form !== undefined) {
    init.body = form; // FormData sets its own multipart Content-Type + boundary.
  } else if (json !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(json);
  }
  const res = await doFetch(callCtx, url, init);
  const status = toInteger(res.status, 0);
  const text = await res.text();
  guardHttpStatus(status);
  if (!String(text || '').trim()) throw errorWithCode('UNKNOWN', 'response body is empty');
  return { status, json: parseJsonOrThrow(text) };
};

// Send a request whose response is a binary file (report zip / agent installer).
const requestBinary = async (callCtx, { path, query = {}, method: httpMethod = 'GET' }) => {
  const host = requireHost(callCtx);
  const url = appendQuery(`${host}${path}`, { ...authQuery(callCtx), ...query });
  const res = await doFetch(callCtx, url, { method: httpMethod });
  const status = toInteger(res.status, 0);
  const contentType = String(res.headers?.get?.('content-type') ?? '');
  // A JSON body on a download endpoint signals an error envelope, not a file.
  if (/application\/json/i.test(contentType)) {
    const text = await res.text();
    guardHttpStatus(status);
    const parsed = parseJsonOrThrow(text || '{}');
    throw errorWithCode('UNKNOWN', String(parsed?.ret_msg ?? 'download failed'));
  }
  guardHttpStatus(status);
  const buffer = Buffer.from(await res.arrayBuffer());
  return {
    http_status: status,
    content_type: contentType,
    content_length: buffer.length,
    filename: filenameFromContentDisposition(res.headers?.get?.('content-disposition')),
    body_base64: buffer.toString('base64'),
  };
};

const filenameFromContentDisposition = (value) => {
  const raw = String(value ?? '');
  const star = raw.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      return star[1].trim().replace(/^"|"$/g, '');
    }
  }
  const plain = raw.match(/filename="?([^";]+)"?/i);
  return plain?.[1] ? plain[1].trim() : '';
};

// ---------------------------------------------------------------------------
// Response normalization
// ---------------------------------------------------------------------------

const toRsasResponse = ({ status, json }) => ({
  ret_code: toInteger(json?.ret_code, 0),
  ret_msg: String(json?.ret_msg ?? ''),
  data: toValue(json?.data),
  http_status: toInteger(status, 0),
});

const toTaskCreateResponse = ({ status, json }) => {
  const data = json?.data;
  const taskId = firstDefined(data?.task_id, data?.taskId);
  return {
    ...toRsasResponse({ status, json }),
    task_id: taskId === undefined || taskId === null ? '' : String(taskId),
  };
};

// ---------------------------------------------------------------------------
// Multipart form builders
// ---------------------------------------------------------------------------

const formFromFields = (fields) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue;
    form.append(key, String(value));
  }
  return form;
};

const appendFile = (form, field, base64, filename, contentType = 'application/octet-stream') => {
  const buffer = Buffer.from(String(base64 ?? ''), 'base64');
  form.append(field, new Blob([buffer], { type: contentType }), filename);
};

// ---------------------------------------------------------------------------
// Handlers: task lifecycle
// ---------------------------------------------------------------------------

const handleCreateTask = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const configXml = requireField(req?.config_xml, 'config_xml');
  const form = formFromFields({ type: toTrimmed(req?.type) || '1' });
  const filename = toTrimmed(req?.config_xml_filename) || 'config.xml';
  form.append('config_xml', new Blob([Buffer.from(configXml, 'utf8')], { type: 'text/xml' }), filename);
  return toTaskCreateResponse(await requestJson(callCtx, { path: '/api/task/create', method: 'POST', form }));
};

const handleCreateVulnTask = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const form = formFromFields({
    name: requireField(req?.name, 'name'),
    targets: requireField(req?.targets, 'targets'),
    template_id: toOptionalPositiveInt(req?.template_id),
  });
  return toTaskCreateResponse(await requestJson(callCtx, { path: '/api/task/vul/create', method: 'POST', form }));
};

const handleCreateBaselineTask = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const form = formFromFields({
    name: requireField(req?.name, 'name'),
    targets: requireField(req?.targets, 'targets'),
    login_type: requireField(req?.login_type, 'login_type'),
    login_port: requireField(req?.login_port, 'login_port'),
    login_name: requireField(req?.login_name, 'login_name'),
    login_password: requireField(req?.login_password, 'login_password'),
    template_uuid: requireField(req?.template_uuid, 'template_uuid'),
    template_param: toTrimmed(req?.template_param) || '{}',
    protect_level: toTrimmed(req?.protect_level),
  });
  return toTaskCreateResponse(await requestJson(callCtx, { path: '/api/task/baseline/create', method: 'POST', form }));
};

const handleCreatePwdTask = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const form = formFromFields({
    name: requireField(req?.name, 'name'),
    targets: requireField(req?.targets, 'targets'),
    template_id: requireField(req?.template_id, 'template_id'),
    service_type: requireField(req?.service_type, 'service_type'),
    pass_mode: toTrimmed(req?.pass_mode),
    port: toOptionalPositiveInt(req?.port),
  });
  return toTaskCreateResponse(await requestJson(callCtx, { path: '/api/task/pwd/create', method: 'POST', form }));
};

const handleCreateWebTask = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const form = formFromFields({
    name: requireField(req?.name, 'name'),
    targets: requireField(req?.targets, 'targets'),
    template_id: toTrimmed(req?.template_id),
    component_scan: toTrimmed(req?.component_scan),
  });
  return toTaskCreateResponse(await requestJson(callCtx, { path: '/api/task/web/create', method: 'POST', form }));
};

const handleCreateOfflineTask = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const base64 = requireField(req?.task_field_base64, 'task_field_base64');
  const form = new FormData();
  appendFile(form, 'taskField', base64, toTrimmed(req?.filename) || 'offline_result.dat');
  return toTaskCreateResponse(await requestJson(callCtx, { path: '/api/task/offline/create', method: 'POST', form }));
};

const handleCreateDockerTask = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const form = formFromFields({
    name: requireField(req?.name, 'name'),
    targets: requireField(req?.targets, 'targets'),
    registry_address: toTrimmed(req?.registry_address),
    registry_username: toTrimmed(req?.registry_username),
    registry_password: toTrimmed(req?.registry_password),
  });
  return toTaskCreateResponse(await requestJson(callCtx, { path: '/api/task/docker/create', method: 'POST', form }));
};

const handleCreateCodeauditTask = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const form = formFromFields({
    name: requireField(req?.name, 'name'),
    code_source: toInteger(requireField(req?.code_source, 'code_source'), 0),
    repo_path: requireField(req?.repo_path, 'repo_path'),
    repo_username: toTrimmed(req?.repo_username),
    repo_password: toTrimmed(req?.repo_password),
    template_id: toOptionalPositiveInt(req?.template_id),
    exclude_files: toTrimmed(req?.exclude_files),
    exclude_dirs: toTrimmed(req?.exclude_dirs),
    git_branch: toTrimmed(req?.git_branch),
  });
  return toTaskCreateResponse(await requestJson(callCtx, { path: '/api/task/codeaudit/create', method: 'POST', form }));
};

const handleCreateHostAssetsTask = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const form = formFromFields({
    name: requireField(req?.name, 'name'),
    targets: requireField(req?.targets, 'targets'),
    is_related: toTrimmed(req?.is_related),
    template_id: toTrimmed(req?.template_id),
    prohibitConfig: toTrimmed(req?.prohibit_config),
    prohibitPorts: toTrimmed(req?.prohibit_ports),
  });
  return toTaskCreateResponse(await requestJson(callCtx, { path: '/api/task/hostassets/create', method: 'POST', form }));
};

const handleCreateWebAssetsTask = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const form = formFromFields({
    name: requireField(req?.name, 'name'),
    targets: requireField(req?.targets, 'targets'),
    is_related: toTrimmed(req?.is_related),
    is_sitetree: toTrimmed(req?.is_sitetree),
  });
  return toTaskCreateResponse(await requestJson(callCtx, { path: '/api/task/webassets/create', method: 'POST', form }));
};

const requireTaskId = (req) => encodeURIComponent(requireField(req?.task_id, 'task_id'));

const handleGetTaskStatus = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  return toRsasResponse(await requestJson(callCtx, { path: `/api/task/status/${requireTaskId(req)}`, method: 'GET' }));
};

const handlePauseTask = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  return toRsasResponse(await requestJson(callCtx, { path: `/api/task/pause/${requireTaskId(req)}`, method: 'POST' }));
};

const handleResumeTask = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  return toRsasResponse(await requestJson(callCtx, { path: `/api/task/resume/${requireTaskId(req)}`, method: 'POST' }));
};

const handleStopTask = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  return toRsasResponse(await requestJson(callCtx, { path: `/api/task/stop/${requireTaskId(req)}`, method: 'POST' }));
};

const handleDeleteTask = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  return toRsasResponse(await requestJson(callCtx, { path: `/api/task/delete/${requireTaskId(req)}`, method: 'POST' }));
};

const handleBatchDeleteTasks = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const ids = (Array.isArray(req?.task_ids) ? req.task_ids : []).map((id) => toInteger(id, 0)).filter((id) => id > 0);
  if (ids.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'task_ids must contain positive integers');
  return toRsasResponse(await requestJson(callCtx, { path: '/api/task/batch_delete', method: 'POST', json: { task_ids: ids } }));
};

const handleListTasks = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const pageVal = toInteger(req?.page, 0);
  const pageSizeVal = toInteger(req?.page_size, 0);
  const query = {
    type: toOptionalPositiveInt(req?.type),
    end_time_start: toTrimmed(req?.end_time_start),
    end_time_end: toTrimmed(req?.end_time_end),
    isfinished: toTrimmed(req?.isfinished),
    // RSAS pagination is 1-based; send sane defaults rather than a proto3 0.
    page: pageVal > 0 ? pageVal : 1,
    page_size: pageSizeVal > 0 ? pageSizeVal : 10,
  };
  return toRsasResponse(await requestJson(callCtx, { path: '/api/task/list', method: 'GET', query }));
};

const handleListActiveTasks = async (_req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  return toRsasResponse(await requestJson(callCtx, { path: '/api/task/active_list', method: 'GET' }));
};

const handleGetTaskResult = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const pageVal = toInteger(req?.page, 0);
  const pageSizeVal = toInteger(req?.page_size, 0);
  const query = {
    targets: toTrimmed(req?.targets),
    page: pageVal > 0 ? pageVal : 1,
    page_size: pageSizeVal > 0 ? pageSizeVal : 20,
  };
  return toRsasResponse(await requestJson(callCtx, { path: `/api/report/task/${requireTaskId(req)}`, method: 'GET', query }));
};

const handleCreateAuthInfo = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const entries = Array.isArray(req?.authinfo) ? req.authinfo : [];
  if (entries.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'authinfo must contain at least one entry');
  const payload = entries.map((entry) => ({
    accountname: requireField(entry?.accountname, 'authinfo.accountname'),
    accountpwd: toTrimmed(entry?.accountpwd),
    port: requireField(entry?.port, 'authinfo.port'),
    protocol: requireField(entry?.protocol, 'authinfo.protocol'),
    ip: requireField(entry?.ip, 'authinfo.ip'),
  }));
  const form = formFromFields({ authinfo: JSON.stringify(payload) });
  return toRsasResponse(await requestJson(callCtx, { path: '/api/authinfo/create', method: 'POST', form }));
};

const handleLoginVerify = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const jumparray = (Array.isArray(req?.jumparray) ? req.jumparray : []).map((jh) => ({
    ip_range: toTrimmed(jh?.ip_range),
    protocol: toTrimmed(jh?.protocol),
    user_name: toTrimmed(jh?.user_name),
    user_pwd: toTrimmed(jh?.user_pwd),
    port: toInteger(jh?.port, 0),
  }));
  const form = formFromFields({
    ip: requireField(req?.ip, 'ip'),
    protocol: requireField(req?.protocol, 'protocol'),
    port: toInteger(requireField(req?.port, 'port'), 0),
    user_name: requireField(req?.user_name, 'user_name'),
    userpwd: requireField(req?.userpwd, 'userpwd'),
    jump_ifuse: toBoolean(req?.jump_ifuse) ? 'true' : 'false',
    jumparray: jumparray.length ? JSON.stringify(jumparray) : undefined,
    web_login_url: toTrimmed(req?.web_login_url),
    web_login_cookie: toTrimmed(req?.web_login_cookie),
    format: 'json',
  });
  return toRsasResponse(await requestJson(callCtx, { path: '/api/auth/login_verify', method: 'POST', form }));
};

// ---------------------------------------------------------------------------
// Handlers: templates and dictionaries
// ---------------------------------------------------------------------------

const handleListSysvulnTemplate = async (_req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  return toRsasResponse(await requestJson(callCtx, { path: '/api/template/sysvuln/list', method: 'GET' }));
};

const handleListWebvulnTemplate = async (_req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  return toRsasResponse(await requestJson(callCtx, { path: '/api/template/webvuln/list', method: 'GET' }));
};

const handleListBaselineTemplate = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const query = { industry: toTrimmed(req?.industry) };
  return toRsasResponse(await requestJson(callCtx, { path: '/api/template/baseline/list', method: 'GET', query }));
};

const handleGetBaselineParams = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const query = { uuid: requireField(req?.uuid, 'uuid') };
  return toRsasResponse(await requestJson(callCtx, { path: '/api/template/baseline/params', method: 'GET', query }));
};

const handleListCodeauditTemplate = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const query = { type: req?.type === undefined ? undefined : toInteger(req.type, 0) };
  return toRsasResponse(await requestJson(callCtx, { path: '/api/template/codeaudit/list', method: 'GET', query }));
};

const handleListAssetTemplate = async (_req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  return toRsasResponse(await requestJson(callCtx, { path: '/api/template/asset/list', method: 'GET' }));
};

const handleCreateBaselineTemplate = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const base64 = requireField(req?.template_base64, 'template_base64');
  const form = new FormData();
  appendFile(form, 'template', base64, toTrimmed(req?.filename) || 'template.dat');
  return toRsasResponse(await requestJson(callCtx, { path: '/api/template/baseline/create', method: 'POST', form }));
};

const handleListUserpwd = async (_req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  return toRsasResponse(await requestJson(callCtx, { path: '/api/userpwd/list', method: 'GET' }));
};

const handleCreateUserpwd = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const form = formFromFields({ userpwd: requireField(req?.userpwd, 'userpwd') });
  return toRsasResponse(await requestJson(callCtx, { path: '/api/userpwd/create', method: 'POST', form }));
};

// ---------------------------------------------------------------------------
// Handlers: system, logs, reports
// ---------------------------------------------------------------------------

const handleGetSystemStatus = async (_req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  return toRsasResponse(await requestJson(callCtx, { path: '/api/system/status', method: 'GET' }));
};

const handleGetLogInfo = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const query = {
    account: toTrimmed(req?.account),
    type: toTrimmed(req?.type),
    starttime: toTrimmed(req?.starttime),
    endtime: toTrimmed(req?.endtime),
    ip: toTrimmed(req?.ip),
  };
  return toRsasResponse(await requestJson(callCtx, { path: '/api/log/getlogInfo', method: 'GET', query }));
};

const handleListReportTemplate = async (_req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  return toRsasResponse(await requestJson(callCtx, { path: '/api/report/template/list', method: 'GET' }));
};

const handleGenerateReport = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const form = formFromFields({
    task_id: requireField(req?.task_id, 'task_id'),
    summary_template_id: toTrimmed(req?.summary_template_id),
    host_template_id: toTrimmed(req?.host_template_id),
    report_type: requireField(req?.report_type, 'report_type'),
  });
  return toRsasResponse(await requestJson(callCtx, { path: '/api/generate_report/', method: 'POST', form }));
};

const handleGetReportProgress = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const reportId = encodeURIComponent(requireField(req?.report_id, 'report_id'));
  return toRsasResponse(await requestJson(callCtx, { path: `/api/get_report_progress/report_id/${reportId}`, method: 'GET' }));
};

const handleDownloadReport = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const reportId = encodeURIComponent(requireField(req?.report_id, 'report_id'));
  const reportType = encodeURIComponent(requireField(req?.report_type, 'report_type'));
  return requestBinary(callCtx, { path: `/api/download_report/report_id/${reportId}/report_type/${reportType}`, method: 'GET' });
};

const handleDeleteReports = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  let payload;
  if (toBoolean(req?.all)) {
    payload = { report_ids: 'all' };
  } else {
    const ids = (Array.isArray(req?.report_ids) ? req.report_ids : []).map((id) => toInteger(id, 0)).filter((id) => id > 0);
    if (ids.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'report_ids must contain positive integers or set all=true');
    payload = { report_ids: ids };
  }
  return toRsasResponse(await requestJson(callCtx, { path: '/api/delete_reports', method: 'POST', json: payload }));
};

// ---------------------------------------------------------------------------
// Handlers: agent
// ---------------------------------------------------------------------------

const handleGetAgentMethodConfig = async (_req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  return toRsasResponse(await requestJson(callCtx, { path: '/api/agent/agent_method_config', method: 'GET' }));
};

const handleSetAgentMethodConfig = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const agentMethod = toInteger(req?.agent_method, 0);
  return toRsasResponse(await requestJson(callCtx, { path: '/api/agent/agent_method_config', method: 'POST', json: { agent_method: agentMethod } }));
};

const handleGetAgentAuth = async (_req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  return toRsasResponse(await requestJson(callCtx, { path: '/api/agent/get_agent_auth', method: 'GET' }));
};

const handleGetAgentPackageUrl = async (_req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  return toRsasResponse(await requestJson(callCtx, { path: '/api/agent/get_agentpackage_url', method: 'GET' }));
};

const handleDownloadAgent = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const platform = requireField(req?.platform, 'platform').toLowerCase();
  if (platform !== 'linux' && platform !== 'windows') {
    throw errorWithCode('INVALID_ARGUMENT', 'platform must be "linux" or "windows"');
  }
  return requestBinary(callCtx, { path: `/api/agent/download/${platform}`, method: 'GET' });
};

// ---------------------------------------------------------------------------
// Handler registry
// ---------------------------------------------------------------------------

const HANDLERS = {
  CreateTask: handleCreateTask,
  CreateVulnTask: handleCreateVulnTask,
  CreateBaselineTask: handleCreateBaselineTask,
  CreatePwdTask: handleCreatePwdTask,
  CreateWebTask: handleCreateWebTask,
  CreateOfflineTask: handleCreateOfflineTask,
  CreateDockerTask: handleCreateDockerTask,
  CreateCodeauditTask: handleCreateCodeauditTask,
  CreateHostAssetsTask: handleCreateHostAssetsTask,
  CreateWebAssetsTask: handleCreateWebAssetsTask,
  GetTaskStatus: handleGetTaskStatus,
  PauseTask: handlePauseTask,
  ResumeTask: handleResumeTask,
  StopTask: handleStopTask,
  DeleteTask: handleDeleteTask,
  BatchDeleteTasks: handleBatchDeleteTasks,
  ListTasks: handleListTasks,
  ListActiveTasks: handleListActiveTasks,
  GetTaskResult: handleGetTaskResult,
  CreateAuthInfo: handleCreateAuthInfo,
  LoginVerify: handleLoginVerify,
  ListSysvulnTemplate: handleListSysvulnTemplate,
  ListWebvulnTemplate: handleListWebvulnTemplate,
  ListBaselineTemplate: handleListBaselineTemplate,
  GetBaselineParams: handleGetBaselineParams,
  ListCodeauditTemplate: handleListCodeauditTemplate,
  ListAssetTemplate: handleListAssetTemplate,
  CreateBaselineTemplate: handleCreateBaselineTemplate,
  ListUserpwd: handleListUserpwd,
  CreateUserpwd: handleCreateUserpwd,
  GetSystemStatus: handleGetSystemStatus,
  GetLogInfo: handleGetLogInfo,
  ListReportTemplate: handleListReportTemplate,
  GenerateReport: handleGenerateReport,
  GetReportProgress: handleGetReportProgress,
  DownloadReport: handleDownloadReport,
  DeleteReports: handleDeleteReports,
  GetAgentMethodConfig: handleGetAgentMethodConfig,
  SetAgentMethodConfig: handleSetAgentMethodConfig,
  GetAgentAuth: handleGetAgentAuth,
  GetAgentPackageUrl: handleGetAgentPackageUrl,
  DownloadAgent: handleDownloadAgent,
};

// Exported as { [fullMethodName]: (ctx) => Promise } — single-arg ctx signature
// is required by the package validator.
// The SDK invokes service handlers as (request, context), while older direct
// callers used a single context argument. Support both shapes so runtime
// configuration is never mistaken for the protobuf request.
const handlerArgs = (requestOrContext = {}, maybeContext) => (
  maybeContext === undefined
    ? { request: requestFromContext(requestOrContext), context: requestOrContext }
    : { request: normalizeRequest(requestOrContext), context: maybeContext ?? {} }
);

export const handlers = Object.fromEntries(
  Object.entries(HANDLERS).map(([name, fn]) => [method(name), async (requestOrContext = {}, maybeContext) => {
    const { request, context } = handlerArgs(requestOrContext, maybeContext);
    return fn(request, context);
  }]),
);

export const METHODS = Object.fromEntries(Object.keys(HANDLERS).map((name) => [name, method(name)]));

export const _test = {
  appendQuery,
  authQuery,
  buildTlsOptions,
  errorWithCode,
  filenameFromContentDisposition,
  formFromFields,
  guardHttpStatus,
  normalizeBaseUrl,
  normalizeRequest,
  pickCredential,
  requestBinary,
  requestJson,
  requireField,
  resolveBaseUrl,
  resolveCallContext,
  resolveCurrLang,
  resolveTimeoutMs,
  toBoolean,
  toInteger,
  toOptionalPositiveInt,
  toRsasResponse,
  toTaskCreateResponse,
  toValue,
};
