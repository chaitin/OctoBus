import { Buffer } from 'node:buffer';
import { Agent } from 'undici';

// 启明星辰 IPS 攻击日志查询适配。
// 认证:web 会话 Cookie。GET /log/memorylog/ipslog.php 返回 HTML 日志页，解析表行为结构化条目。
import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const SVC = 'VENUS_IPS.VENUS_IPS';
export const QUERY_IPS_LOG_PATH = `/${SVC}/QueryIpsLog`;
export const METHOD_QUERY_IPS_LOG_FULL = `${SVC}/QueryIpsLog`;
export const PROBE_CONNECTIVITY_PATH = `/${SVC}/ProbeConnectivity`;
export const METHOD_PROBE_CONNECTIVITY_FULL = `${SVC}/ProbeConnectivity`;

export const IPS_LOG_URI = '/log/memorylog/ipslog.php';
export const LOG_PAGE_MARKER = 'ips_log_filter';
export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_LIMIT = 10_000;

const BLOCKED_HEADERS = new Set([
  'authorization', 'cookie', 'host', 'connection', 'content-length', 'proxy-authorization',
  'transfer-encoding', 'upgrade', 'x-engine-instance', 'x-request-id',
]);

// 日志表 14 个有 title 的数据单元格，按列顺序映射。
const ENTRY_FIELDS = [
  'name', 'src_ip', 'src_port', 'dst_ip', 'dst_port', 'protocol',
  'time', 'type', 'severity', 'priority', 'action', 'policy_id', 'count', 'content',
];
const DATETIME_RE = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/;
const insecureTlsDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

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
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)
      || url.username || url.password || url.search || url.hash
      || (url.pathname && url.pathname !== '/')) return '';
    return url.origin;
  } catch {
    return '';
  }
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

const resolveHost = (bindings = {}) => {
  for (const candidate of [bindings.host, bindings.restBaseUrl, bindings.baseUrl]) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized) return normalized;
  }
  return '';
};
const resolveCookie = (bindings = {}) => pickStringFrom(bindings, ['cookie', 'sessionCookie', 'session_cookie']);

const resolveTimeoutMs = (ctx = {}) => {
  const raw = Number(unwrapScalar(ctx.limits?.timeoutMs ?? ctx.bindings?.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

const resolveMaxResponseBytes = (ctx = {}) => {
  const raw = Number(unwrapScalar(ctx.bindings?.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES));
  return Number.isFinite(raw) && raw >= 1024 && raw <= 8 * 1024 * 1024
    ? Math.trunc(raw) : DEFAULT_MAX_RESPONSE_BYTES;
};

const buildTlsOptions = (bindings = {}) => {
  const enabled = pickFirstBoolean([bindings.skipTlsVerify, bindings.tlsInsecureSkipVerify, bindings.insecureSkipVerify]) || false;
  return enabled ? { dispatcher: insecureTlsDispatcher } : {};
};

const buildRequestOptions = (bound) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), resolveTimeoutMs(bound));
  return {
    options: {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      ...buildTlsOptions(bound.bindings),
      headers: buildHeaders(bound.bindings, bound.meta, bound.cookie),
    },
    cleanup: () => clearTimeout(timer),
  };
};

const sanitizeHeaders = (headers) => {
  const raw = unwrapScalar(headers);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result = {};
  for (const [key, value] of Object.entries(raw)) {
    const normalized = key.trim().toLowerCase();
    const text = String(unwrapScalar(value) ?? '');
    if (!normalized || BLOCKED_HEADERS.has(normalized) || /[\r\n]/.test(key) || /[\r\n]/.test(text)) continue;
    result[key] = text;
  }
  return result;
};

const buildHeaders = (bindings = {}, meta = {}, cookie = '') => ({
  ...sanitizeHeaders(bindings.headers),
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  cookie,
  'x-engine-instance': pickFirstString([meta.instance_id, meta.instanceId, 'unknown']),
  'x-request-id': pickFirstString([meta.request_id, meta.requestId, 'unknown']),
});

const throwForHttpStatus = (status) => {
  if (status === 401 || status === 403) throw errorWithCode('PERMISSION_DENIED', `upstream rejected authentication (HTTP ${status})`);
  if (status >= 300 && status < 400) throw errorWithCode('FAILED_PRECONDITION', 'upstream redirect refused (session may be expired)');
  if (status >= 400 && status < 500) throw errorWithCode('FAILED_PRECONDITION', `upstream rejected request (HTTP ${status})`);
  throw errorWithCode('UNAVAILABLE', `upstream unavailable (HTTP ${status})`);
};

const cancelResponseBody = async (response) => {
  try {
    await response?.body?.cancel?.();
  } catch {
    // Cancellation is best-effort and must not replace the mapped upstream error.
  }
};

const readBoundedText = async (response, maxBytes) => {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await cancelResponseBody(response);
    throw errorWithCode('RESOURCE_EXHAUSTED', 'upstream response exceeds configured limit');
  }
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel?.();
          throw errorWithCode('RESOURCE_EXHAUSTED', 'upstream response exceeds configured limit');
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock?.();
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  const text = await response.text();
  if (Buffer.byteLength(String(text), 'utf8') > maxBytes) {
    throw errorWithCode('RESOURCE_EXHAUSTED', 'upstream response exceeds configured limit');
  }
  return String(text);
};

const requireBindings = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings || {};
  const host = resolveHost(bindings);
  if (!host) throw errorWithCode('INVALID_ARGUMENT', 'bindings.host is required');
  const cookie = resolveCookie(bindings);
  if (!cookie) throw errorWithCode('INVALID_ARGUMENT', 'bindings.cookie (web session cookie) is required');
  if (cookie.length > 8192 || /[\r\n]/.test(cookie)) throw errorWithCode('INVALID_ARGUMENT', 'bindings.cookie is invalid');
  return { ...callCtx, bindings, host, cookie };
};

const HTML_ENTITIES = Object.freeze({
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#039;': "'",
  '&nbsp;': ' ',
});
const decodeEntities = (s) => String(s).replace(
  /&(amp|lt|gt|quot|#0?39|nbsp);/g,
  (entity) => HTML_ENTITIES[entity],
);

// 从单个 <tr> 中按顺序取出带 title 的 <td> 文本。
const rowTitles = (rowHtml) => {
  const titles = [];
  const tdRe = /<td\b[^>]*\btitle="([^"]*)"[^>]*>/gi;
  let c;
  while ((c = tdRe.exec(rowHtml)) !== null) titles.push(decodeEntities(c[1]));
  return titles;
};

// 解析 HTML 日志页为结构化条目：数据行必须包含恰好 14 个 title 单元格，时间位于第 7 列。
const parseIpsLog = (html, limit = 0) => {
  const entries = [];
  let structuralRows = 0;
  let skipped = 0;
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const titles = rowTitles(m[1]);
    // Header rows have no data cells. A row containing <td> but no title is a
    // malformed candidate and must fail closed rather than silently disappearing.
    if (titles.length === 0 && /<td\b/i.test(m[1])) {
      structuralRows += 1;
      skipped += 1;
      continue;
    }
    // Header rows have no titled data cells. Any titled row is a candidate log row and
    // must have exactly 14 columns with the timestamp at index 6; fail closed upstream
    // if a candidate is malformed so callers never receive a silently incomplete list.
    if (titles.length === 0) continue;
    structuralRows += 1;
    if (titles.length !== ENTRY_FIELDS.length || !DATETIME_RE.test(titles[6] ?? '')) {
      skipped += 1;
      continue;
    }
    const entry = {};
    ENTRY_FIELDS.forEach((key, i) => { entry[key] = titles[i] ?? ''; });
    // Once the requested limit is reached, stop collecting but continue scanning
    // remaining rows so malformed rows cannot be hidden by pagination.
    if (limit === 0 || entries.length < limit) entries.push(entry);
  }
  return { entries, skipped, structuralRows };
};

const runQueryIpsLog = async (req = {}, ctx = {}) => {
  const bound = requireBindings(ctx);
  const request = bound.req ? { ...bound.req, ...req } : req;
  const rawLimit = pickInt(request, ['limit'], 0);
  if (rawLimit < 0 || rawLimit > MAX_LIMIT) throw errorWithCode('INVALID_ARGUMENT', `limit must be between 0 and ${MAX_LIMIT}`);
  const limit = rawLimit;
  let response;
  const upstreamRequest = buildRequestOptions(bound);
  try {
    response = await fetch(`${bound.host}${IPS_LOG_URI}`, upstreamRequest.options);
  } catch (err) {
    upstreamRequest.cleanup();
    if (err instanceof GrpcError) throw err;
    throw errorWithCode('UNAVAILABLE', 'upstream request failed');
  }
  const status = Number(response.status);
  if (!response.ok) {
    upstreamRequest.cleanup();
    await cancelResponseBody(response);
    throwForHttpStatus(status);
  }
  let text;
  try {
    text = await readBoundedText(response, resolveMaxResponseBytes(bound));
  } catch (err) {
    if (err instanceof GrpcError) throw err;
    throw errorWithCode('UNAVAILABLE', 'failed to read upstream response');
  } finally {
    upstreamRequest.cleanup();
  }
  // 会话失效时设备会重定向到登录页(同样 200),用日志页标记区分。
  if (!String(text || '').includes(LOG_PAGE_MARKER)) {
    throw errorWithCode('FAILED_PRECONDITION', 'unexpected response (session may be expired or not the IPS log page)');
  }
  const parsed = parseIpsLog(text, limit);
  if (parsed.skipped > 0) {
    throw errorWithCode('FAILED_PRECONDITION', 'unexpected IPS log table structure');
  }
  const { entries } = parsed;
  return { http_status: status, total: entries.length, entries };
};

const runProbeConnectivity = async (ctx = {}) => {
  const bound = requireBindings(ctx);
  let response;
  const request = buildRequestOptions(bound);
  try {
    response = await fetch(`${bound.host}${IPS_LOG_URI}`, request.options);
  } catch {
    throw errorWithCode('UNAVAILABLE', 'upstream request failed');
  } finally {
    request.cleanup();
  }
  const status = Number(response.status);
  if (!response.ok) {
    await cancelResponseBody(response);
    throwForHttpStatus(status);
  }
  response.body?.cancel?.().catch?.(() => {});
  return { reachable: true, http_status: status };
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [PROBE_CONNECTIVITY_PATH]: async () => runProbeConnectivity(callCtx),
    [QUERY_IPS_LOG_PATH]: async (req) => runQueryIpsLog(req ?? callCtx.req, callCtx),
  };
}

export const handlers = {
  [METHOD_PROBE_CONNECTIVITY_FULL]: (ctx = {}) => runProbeConnectivity(ctx),
  [METHOD_QUERY_IPS_LOG_FULL]: (ctx = {}) => runQueryIpsLog(ctx.request ?? ctx.req ?? {}, ctx),
};

export const _test = {
  buildHeaders,
  buildRequestOptions,
  cancelResponseBody,
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
  resolveMaxResponseBytes,
  resolveTimeoutMs,
  rowTitles,
  readBoundedText,
  sanitizeHeaders,
  throwForHttpStatus,
  unwrapScalar,
};
