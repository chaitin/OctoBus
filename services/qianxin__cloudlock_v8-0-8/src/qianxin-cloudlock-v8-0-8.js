// 奇安信网神云锁服务器安全管理系统(椒图) V8.0.8 Hotfix1 适配。
// 认证:web 会话 token(`token` 头)+ 按页面的 menuCode + Origin/Referer。
// 当前实现服务器列表查询(QueryMachineList),请求/响应已按真机抓包对齐。
import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const SVC = 'QIANXIN_CloudLock_V8_0_8.QIANXIN_CloudLock_V8_0_8';
export const QUERY_MACHINE_PATH = `/${SVC}/QueryMachineList`;
export const METHOD_QUERY_MACHINE_FULL = `${SVC}/QueryMachineList`;

export const MACHINE_URI = '/api/assetSrv/machineController/searchMachineList';
export const MACHINE_MENU_CODE = '5101';
export const MACHINE_REFERER_PATH = '/assets-management/host-management?tabtype=0';
export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_MAX_RESULTS = 20;

// 真机请求体里出现的字符串过滤项(proto snake_case -> 设备 camelCase),未设置一律下发空串。
const STRING_FILTER_FIELDS = [
  ['machine_group', 'machineGroup'],
  ['machine_tags', 'machineTags'],
  ['online_status', 'onlineStatus'],
  ['run_status', 'runStatus'],
  ['os_type', 'osType'],
  ['operation_system', 'operationSystem'],
  ['department', 'department'],
  ['direct_person', 'directPerson'],
  ['asset_level', 'assetLevel'],
  ['os_category', 'osCategory'],
  ['arch', 'arch'],
  ['system_language', 'systemLanguage'],
  ['memory_size', 'memorySize'],
  ['disk_size', 'diskSize'],
  ['disk_usage', 'diskUsage'],
  ['kernel_version', 'kernelVersion'],
];

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const pickFirstString = (values = []) => {
  for (const value of values) {
    const raw = unwrapScalar(value);
    if (raw === undefined || raw === null) continue;
    const str = String(raw).trim();
    if (str) return str;
  }
  return '';
};

const pickStringFrom = (source = {}, keys = []) => {
  for (const key of keys) {
    if (!hasOwn(source, key)) continue;
    const raw = unwrapScalar(source[key]);
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (value) return value;
  }
  return '';
};

const pickInt = (source = {}, keys = [], fallback = 0) => {
  for (const key of keys) {
    if (!hasOwn(source, key)) continue;
    const raw = unwrapScalar(source[key]);
    if (raw === undefined || raw === null || raw === '') continue;
    const num = Number(raw);
    if (Number.isFinite(num)) return Math.trunc(num);
  }
  return fallback;
};

const pickString = (source = {}, keys = []) => {
  for (const key of keys) {
    if (!hasOwn(source, key)) continue;
    const raw = unwrapScalar(source[key]);
    if (raw === undefined || raw === null) continue;
    return String(raw);
  }
  return '';
};

const pickBoolean = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return Number.isNaN(raw) ? undefined : raw !== 0;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) return false;
  }
  return undefined;
};

const pickFirstBoolean = (values = []) => {
  for (const value of values) {
    const bool = pickBoolean(value);
    if (bool !== undefined) return bool;
  }
  return undefined;
};

const normalizeBaseUrl = (value) => {
  const raw = String(unwrapScalar(value) || '').trim();
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.replace(/\/+$/, '');
};

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: {
    ...(ctx.config ?? {}),
    ...(ctx.secret ?? {}),
    ...(ctx.bindings ?? {}),
  },
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.req ?? ctx.request ?? {},
});

const resolveHost = (bindings = {}) => normalizeBaseUrl(pickFirstString([bindings.host, bindings.restBaseUrl, bindings.baseUrl]));
const resolveToken = (bindings = {}) => pickStringFrom(bindings, ['token', 'sessionToken', 'session_token']);

const resolveTimeoutMs = (ctx = {}) => {
  const raw = Number(unwrapScalar(ctx.limits?.timeoutMs ?? ctx.bindings?.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

const buildTlsOptions = (bindings = {}) => {
  const enabled = pickFirstBoolean([bindings.skipTlsVerify, bindings.tlsInsecureSkipVerify, bindings.insecureSkipVerify]) || false;
  return enabled ? { skipTlsVerify: true, tlsInsecureSkipVerify: true, insecureSkipVerify: true } : {};
};

const sanitizeHeaders = (headers) => {
  const raw = unwrapScalar(headers);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([key]) => key).map(([key, value]) => [key, String(unwrapScalar(value) ?? '')]));
};

// 真机请求头:token + menuCode + Accept/Content-Type + Origin/Referer。
const buildHeaders = (bindings = {}, meta = {}, { host, token, menuCode, refererPath } = {}) => ({
  ...sanitizeHeaders(bindings.headers),
  accept: 'application/json, text/plain, */*',
  'content-type': 'application/json',
  token,
  menuCode,
  origin: host,
  referer: `${host}${refererPath}`,
  'x-engine-instance': pickFirstString([meta.instance_id, meta.instanceId, 'unknown']),
  'x-request-id': pickFirstString([meta.request_id, meta.requestId, 'unknown']),
});

const parseJsonBody = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', 'response is not valid JSON');
  }
};

const throwForHttpStatus = (status, text) => {
  if (status === 401 || status === 403) throw errorWithCode('PERMISSION_DENIED', `upstream http ${status}: ${text}`);
  if (status >= 400 && status < 500) throw errorWithCode('FAILED_PRECONDITION', `upstream http ${status}: ${text}`);
  throw errorWithCode('UNAVAILABLE', `upstream http ${status}: ${text}`);
};

const requireBindings = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings || {};
  const host = resolveHost(bindings);
  if (!host) throw errorWithCode('INVALID_ARGUMENT', 'bindings.host is required');
  const token = resolveToken(bindings);
  if (!token) throw errorWithCode('INVALID_ARGUMENT', 'bindings.token (web session token) is required');
  return { ...callCtx, bindings, host, token };
};

// 组装与真机一致的请求体:分页 + groupUuid + 全部字符串过滤项(默认空串)。
const buildMachineListBody = (req = {}) => {
  const searchInfoList = Array.isArray(unwrapScalar(req.search_info_list ?? req.searchInfoList))
    ? unwrapScalar(req.search_info_list ?? req.searchInfoList)
    : [];
  const body = {
    searchInfoList,
    groupUuid: pickString(req, ['group_uuid', 'groupUuid']),
    currentPage: pickInt(req, ['current_page', 'currentPage', 'page'], 1),
    maxResults: pickInt(req, ['max_results', 'maxResults', 'page_size', 'pageSize'], DEFAULT_MAX_RESULTS),
    ifShowCurrentGroupInfo: pickInt(req, ['if_show_current_group_info', 'ifShowCurrentGroupInfo'], 0),
  };
  for (const [snake, camel] of STRING_FILTER_FIELDS) {
    body[camel] = pickString(req, [snake, camel]);
  }
  return body;
};

const extractTotal = (json) => {
  const data = json && typeof json.data === 'object' && json.data !== null ? json.data : {};
  return pickInt(data, ['total', 'totalCount', 'count'], 0);
};

// 设备成功判定:code 字段为 "1"（真机返回 {"code":"1","msg":"成功",...}）。
const isSuccess = (json) => String(unwrapScalar(json?.code) ?? '') === '1';

const runQueryMachineList = async (req = {}, ctx = {}) => {
  const bound = requireBindings(ctx);
  const body = buildMachineListBody(bound.req ? { ...bound.req, ...req } : req);
  let response;
  try {
    response = await fetch(`${bound.host}${MACHINE_URI}`, {
      method: 'POST',
      timeoutMs: resolveTimeoutMs(bound),
      ...buildTlsOptions(bound.bindings),
      headers: buildHeaders(bound.bindings, bound.meta, {
        host: bound.host,
        token: bound.token,
        menuCode: MACHINE_MENU_CODE,
        refererPath: MACHINE_REFERER_PATH,
      }),
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', err?.cause?.message || err?.message || 'fetch failed');
  }
  const text = await response.text();
  const status = Number(response.status);
  if (!response.ok) throwForHttpStatus(status, text);
  if (!String(text || '').trim()) throw errorWithCode('UNKNOWN', 'response body is empty');
  const json = parseJsonBody(text);
  const success = isSuccess(json);
  const result = {
    code: String(unwrapScalar(json?.code) ?? ''),
    msg: String(unwrapScalar(json?.msg) ?? ''),
    total: extractTotal(json),
    http_status: status,
    raw_json: text,
  };
  if (!success) throw errorWithCode('FAILED_PRECONDITION', result.msg || `query failed (code=${result.code})`);
  return result;
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [QUERY_MACHINE_PATH]: async (req) => runQueryMachineList(req ?? callCtx.req, callCtx),
  };
}

export const handlers = {
  [METHOD_QUERY_MACHINE_FULL]: (req, ctx = {}) => runQueryMachineList(req, ctx),
};

export const _test = {
  buildHeaders,
  buildMachineListBody,
  buildTlsOptions,
  errorWithCode,
  extractTotal,
  grpcCodeFor,
  hasOwn,
  isSuccess,
  normalizeBaseUrl,
  parseJsonBody,
  pickBoolean,
  pickFirstBoolean,
  pickFirstString,
  pickInt,
  pickString,
  pickStringFrom,
  requireBindings,
  resolveCallContext,
  resolveHost,
  resolveToken,
  resolveTimeoutMs,
  sanitizeHeaders,
  throwForHttpStatus,
  unwrapScalar,
};
