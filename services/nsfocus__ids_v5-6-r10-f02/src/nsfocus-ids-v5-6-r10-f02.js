// 绿盟(NSFOCUS)IDS/IPS V5.6R10F02 告警事件查询适配。
// 认证:web 会话 Cookie。GET /ips/eventList/detail/false/dns/false 返回 HTML 事件表，解析为结构化事件。
import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const SVC = 'NSFOCUS_IDS_V5_6_R10_F02.NSFOCUS_IDS_V5_6_R10_F02';
export const QUERY_EVENT_LIST_PATH = `/${SVC}/QueryEventList`;
export const METHOD_QUERY_EVENT_LIST_FULL = `${SVC}/QueryEventList`;

export const EVENT_LIST_URI = '/ips/eventList/detail/false/dns/false';
export const EVENT_REFERER_PATH = '/ips/event';
export const EVENT_TABLE_MARKER = 'mytable';
export const DEFAULT_TIMEOUT_MS = 5000;

const DATETIME_RE = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/;
// 状态单元格里非「危险程度/动作」的 img title，需从动作判定中排除。
const NON_ACTION_TITLES = new Set(['反馈厂商', '下载pcap文件', '代理IP']);

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

const buildHeaders = (bindings = {}, meta = {}, { cookie, refererUrl } = {}) => ({
  ...sanitizeHeaders(bindings.headers),
  accept: 'text/javascript, text/html, application/xml, text/xml, */*',
  'x-requested-with': 'XMLHttpRequest',
  cookie,
  referer: refererUrl,
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

const stripTags = (s) => decodeEntities(String(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

const attrTitles = (cell) => {
  const out = [];
  const re = /title="([^"]*)"/g;
  let m;
  while ((m = re.exec(cell)) !== null) out.push(decodeEntities(m[1]));
  return out;
};

const splitIpPort = (cell) => {
  const text = stripTags(cell);
  const idx = text.lastIndexOf(':');
  if (idx <= 0) return { ip: text, port: '' };
  return { ip: text.slice(0, idx).trim(), port: text.slice(idx + 1).trim() };
};

// 解析事件表为结构化事件:数据行 class=even/odd，时间列须为有效时间戳。
const parseEventList = (html, limit = 0) => {
  const entries = [];
  const rowRe = /<tr class="(?:even|odd)"[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const cells = [...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => x[1]);
    if (cells.length < 5) continue;
    const time = stripTags(cells[1]);
    if (!DATETIME_RE.test(time)) continue;

    const titles = attrTitles(cells[0]);
    const severity = (titles.find((t) => t.endsWith('危险程度')) || '').replace('危险程度', '');
    const action = titles.find((t) => !t.endsWith('危险程度') && !NON_ACTION_TITLES.has(t)) || '';

    const anchor = (cells[2].match(/<a[^>]*>([\s\S]*?)<\/a>/i) || [])[1] || '';
    const eventText = stripTags(anchor);
    const em = eventText.match(/\[(\d+)\]\s*(.*)/);
    const event_id = em ? em[1] : '';
    const event_name = em ? em[2].trim() : eventText;

    const src = splitIpPort(cells[3]);
    const dst = splitIpPort(cells[4]);

    entries.push({
      severity,
      action,
      time,
      event_id,
      event_name,
      src_ip: src.ip,
      src_port: src.port,
      dst_ip: dst.ip,
      dst_port: dst.port,
      auth_user: stripTags(cells[5] ?? ''),
      linked_account: stripTags(cells[6] ?? ''),
    });
    if (limit > 0 && entries.length >= limit) break;
  }
  return entries;
};

const runQueryEventList = async (req = {}, ctx = {}) => {
  const bound = requireBindings(ctx);
  const request = bound.req ? { ...bound.req, ...req } : req;
  const limit = Math.max(0, pickInt(request, ['limit'], 0));
  let response;
  try {
    response = await fetch(`${bound.host}${EVENT_LIST_URI}`, {
      method: 'GET',
      timeoutMs: resolveTimeoutMs(bound),
      ...buildTlsOptions(bound.bindings),
      headers: buildHeaders(bound.bindings, bound.meta, {
        cookie: bound.cookie,
        refererUrl: `${bound.host}${EVENT_REFERER_PATH}`,
      }),
    });
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', err?.cause?.message || err?.message || 'fetch failed');
  }
  const text = await response.text();
  const status = Number(response.status);
  if (!response.ok) throwForHttpStatus(status, text);
  // 会话失效时设备返回登录页(同样 200),用事件表标记区分。
  if (!String(text || '').includes(EVENT_TABLE_MARKER)) {
    throw errorWithCode('FAILED_PRECONDITION', 'unexpected response (session may be expired or not the IDS event page)');
  }
  const entries = parseEventList(text, limit);
  return { http_status: status, total: entries.length, entries };
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [QUERY_EVENT_LIST_PATH]: async (req) => runQueryEventList(req ?? callCtx.req, callCtx),
  };
}

export const handlers = {
  [METHOD_QUERY_EVENT_LIST_FULL]: (req, ctx = {}) => runQueryEventList(req, ctx),
};

export const _test = {
  attrTitles,
  buildHeaders,
  buildTlsOptions,
  decodeEntities,
  errorWithCode,
  grpcCodeFor,
  hasOwn,
  normalizeBaseUrl,
  parseEventList,
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
  sanitizeHeaders,
  splitIpPort,
  stripTags,
  throwForHttpStatus,
  unwrapScalar,
};
