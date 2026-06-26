// 启明星辰 IPS 攻击日志查询适配。
// 认证:web 会话 Cookie。GET /log/memorylog/ipslog.php 返回 HTML 日志页，解析表行为结构化条目。
import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const SVC = 'VENUS_IPS.VENUS_IPS';
export const QUERY_IPS_LOG_PATH = `/${SVC}/QueryIpsLog`;
export const METHOD_QUERY_IPS_LOG_FULL = `${SVC}/QueryIpsLog`;

export const IPS_LOG_URI = '/log/memorylog/ipslog.php';
export const LOG_PAGE_MARKER = 'ips_log_filter';
export const DEFAULT_TIMEOUT_MS = 5000;

// 日志表 14 个有 title 的数据单元格，按列顺序映射。
const ENTRY_FIELDS = [
  'name', 'src_ip', 'src_port', 'dst_ip', 'dst_port', 'protocol',
  'time', 'type', 'severity', 'priority', 'action', 'policy_id', 'count', 'content',
];
const DATETIME_RE = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/;

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
const resolveCookie = (bindings = {}) => pickStringFrom(bindings, ['cookie', 'sessionCookie', 'session_cookie']);

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

const buildHeaders = (bindings = {}, meta = {}, cookie = '') => ({
  ...sanitizeHeaders(bindings.headers),
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  cookie,
  'x-engine-instance': pickFirstString([meta.instance_id, meta.instanceId, 'unknown']),
  'x-request-id': pickFirstString([meta.request_id, meta.requestId, 'unknown']),
});

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
  const cookie = resolveCookie(bindings);
  if (!cookie) throw errorWithCode('INVALID_ARGUMENT', 'bindings.cookie (web session cookie) is required');
  return { ...callCtx, bindings, host, cookie };
};

const decodeEntities = (s) => String(s)
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#0?39;/g, "'")
  .replace(/&nbsp;/g, ' ');

// 从单个 <tr> 中按顺序取出带 title 的 <td> 文本。
const rowTitles = (rowHtml) => {
  const titles = [];
  const tdRe = /<td\b[^>]*\btitle="([^"]*)"[^>]*>/gi;
  let c;
  while ((c = tdRe.exec(rowHtml)) !== null) titles.push(decodeEntities(c[1]));
  return titles;
};

// 解析 HTML 日志页为结构化条目:数据行需含时间且至少 13 个 title 单元格。
const parseIpsLog = (html, limit = 0) => {
  const entries = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const titles = rowTitles(m[1]);
    if (titles.length < 13) continue;
    if (!titles.some((v) => DATETIME_RE.test(v))) continue;
    const entry = {};
    ENTRY_FIELDS.forEach((key, i) => { entry[key] = titles[i] ?? ''; });
    entries.push(entry);
    if (limit > 0 && entries.length >= limit) break;
  }
  return entries;
};

const runQueryIpsLog = async (req = {}, ctx = {}) => {
  const bound = requireBindings(ctx);
  const request = bound.req ? { ...bound.req, ...req } : req;
  const limit = Math.max(0, pickInt(request, ['limit'], 0));
  let response;
  try {
    response = await fetch(`${bound.host}${IPS_LOG_URI}`, {
      method: 'GET',
      timeoutMs: resolveTimeoutMs(bound),
      ...buildTlsOptions(bound.bindings),
      headers: buildHeaders(bound.bindings, bound.meta, bound.cookie),
    });
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', err?.cause?.message || err?.message || 'fetch failed');
  }
  const text = await response.text();
  const status = Number(response.status);
  if (!response.ok) throwForHttpStatus(status, text);
  // 会话失效时设备会重定向到登录页(同样 200),用日志页标记区分。
  if (!String(text || '').includes(LOG_PAGE_MARKER)) {
    throw errorWithCode('FAILED_PRECONDITION', 'unexpected response (session may be expired or not the IPS log page)');
  }
  const entries = parseIpsLog(text, limit);
  return { http_status: status, total: entries.length, entries };
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [QUERY_IPS_LOG_PATH]: async (req) => runQueryIpsLog(req ?? callCtx.req, callCtx),
  };
}

export const handlers = {
  [METHOD_QUERY_IPS_LOG_FULL]: (req, ctx = {}) => runQueryIpsLog(req, ctx),
};

export const _test = {
  buildHeaders,
  buildTlsOptions,
  decodeEntities,
  errorWithCode,
  grpcCodeFor,
  hasOwn,
  normalizeBaseUrl,
  parseIpsLog,
  pickBoolean,
  pickFirstBoolean,
  pickFirstString,
  pickInt,
  pickStringFrom,
  requireBindings,
  resolveCallContext,
  resolveCookie,
  resolveHost,
  resolveTimeoutMs,
  rowTitles,
  sanitizeHeaders,
  throwForHttpStatus,
  unwrapScalar,
};
