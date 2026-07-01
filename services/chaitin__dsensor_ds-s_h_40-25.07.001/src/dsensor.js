#!/usr/bin/env node
// Chaitin D-Sensor (谛听) unified service proxy
// 25 RPC methods covering agent, event, scanner, alarm, audit, stat, user, honeynet, honeypot APIs.

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import https from 'https';
import http from 'http';

const DEFAULT_TIMEOUT_MS = 30000;

// ─── Error helpers ───────────────────────────────────────────────────────────

const grpcCodeFor = (c) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT:  grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE:       grpcStatus.UNAVAILABLE,
  UNKNOWN:           grpcStatus.UNKNOWN,
}[c] ?? grpcStatus.UNKNOWN);

const errorWithCode = (c, m) => {
  const e = new GrpcError(grpcCodeFor(c), `${c}: ${m}`);
  e.legacyCode = c;
  return e;
};

// ─── Utility helpers ─────────────────────────────────────────────────────────

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o ?? {}, k);
const firstDefined = (...v) => v.find(x => x !== undefined && x !== null);

const unwrapScalar = (v) => {
  if (v == null) return undefined;
  if (typeof v === 'object' && v !== null && hasOwn(v, 'value')) return unwrapScalar(v.value);
  return v;
};

const unwrapString = (v) => {
  const u = unwrapScalar(v);
  return u == null ? '' : String(u);
};

const normalizeBaseUrl = (v) => {
  const r = String(v || '').trim();
  if (!/^https?:\/\//i.test(r)) return '';
  return r.replace(/\/+$/, '');
};

const mergedBindings = (ctx) => ({
  ...ctx?.config,
  ...ctx?.secret,
  ...ctx?.bindings,
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.req ?? ctx.request ?? {},
});

// ─── Protobuf Value helpers ──────────────────────────────────────────────────

const toValue = (v) => {
  if (v == null) return { nullValue: 'NULL_VALUE' };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'number') return { numberValue: v };
  if (typeof v === 'boolean') return { boolValue: v };
  if (Array.isArray(v)) return { listValue: { values: v.map(toValue) } };
  if (typeof v === 'object') return { structValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toValue(x)])) } };
  return { stringValue: String(v) };
};

// Proto3 JSON encoding converts snake_case → camelCase.
// The D-Sensor API expects snake_case, so convert back before forwarding.
const camelToSnake = (str) => str.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

// Proto3 JSON decoding adds $type_name which the D-Sensor API rejects.
// Strip only $type_name, preserve all other fields including empty strings.
const cleanProtoRequest = (obj) => {
  if (obj == null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(cleanProtoRequest);
  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    if (key === '$type_name') continue;
    result[camelToSnake(key)] = cleanProtoRequest(val);
  }
  return result;
};

// ─── HTTP request ────────────────────────────────────────────────────────────

const fetchJson = (ctx, url, init) => {
  return new Promise((resolve, reject) => {
    const ms = firstDefined(ctx?.limits?.timeoutMs, mergedBindings(ctx).timeoutMs, DEFAULT_TIMEOUT_MS);
    const skipTls = mergedBindings(ctx).skipTlsVerify ?? true;

    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const agent = isHttps && skipTls ? new https.Agent({ rejectUnauthorized: false }) : undefined;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: init.method || 'GET',
      headers: init.headers || {},
      agent,
      timeout: ms,
    };

    const proto = isHttps ? https : http;
    const req = proto.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, text: data }));
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(errorWithCode('UNAVAILABLE', 'request timeout')); });

    if (init.body) req.write(init.body);
    req.end();
  });
};

// ─── API registry: method full name → API path ──────────────────────────────

const API_REGISTRY = [
  // Agent management (1-8)
  { method: 'dsensor.dsensor_agent_list/query_dsensor_agent_list',       path: '/api/agent/list',       desc: 'Query agent list.' },
  { method: 'dsensor.dsensor_agent_detail/query_dsensor_agent_detail',   path: '/api/agent/detail',     desc: 'Query agent detail by SN.' },
  { method: 'dsensor.dsensor_agent_delete/query_dsensor_agent_delete',   path: '/api/agent/delete',     desc: 'Delete agent.' },
  { method: 'dsensor.dsensor_agent_upgrade/query_dsensor_agent_upgrade', path: '/api/agent/version_update',    desc: 'Upgrade agent.' },
  { method: 'dsensor.dsensor_agent_change_type/query_dsensor_agent_change_type', path: '/api/agent/change_type', desc: 'Change agent configuration.' },
  { method: 'dsensor.dsensor_agent_clear_service/query_dsensor_agent_clear_service', path: '/api/agent/clear_service',    desc: 'Clear agent service.' },
  { method: 'dsensor.dsensor_agent_portmap_update/query_dsensor_agent_portmap_update', path: '/api/agent/portmap/update', desc: 'Update agent port mapping.' },
  { method: 'dsensor.dsensor_agent_scan_update/query_dsensor_agent_scan_update', path: '/api/agent/portmap/scan/update', desc: 'Update agent scan ports.' },
  // Event & scanner (9-12)
  { method: 'dsensor.dsensor_event_list/query_dsensor_event_list',     path: '/api/event/list',           desc: 'Query event list.' },
  { method: 'dsensor.dsensor_event_detail/query_dsensor_event_detail', path: '/api/event/detail',         desc: 'Query event detail by connection_id.' },
  { method: 'dsensor.dsensor_scanner_list/query_dsensor_scanner_list', path: '/api/event/scanner/list',         desc: 'Query scanner list.' },
  { method: 'dsensor.dsensor_scanner_detail/query_dsensor_scanner_detail', path: '/api/event/scanner/detail',   desc: 'Query scanner detail by id.' },
  // Alarm & portrait & audit (13-15)
  { method: 'dsensor.dsensor_portrait_list/query_dsensor_portrait_list', path: '/api/event/v1/list_portrait',     desc: 'Query attacker portrait list.' },
  { method: 'dsensor.dsensor_alarm_list/query_dsensor_alarm_list',       path: '/api/event/event_alarm/list', desc: 'Query alarm list.' },
  { method: 'dsensor.dsensor_audit_list/query_dsensor_audit_list',       path: '/api/audit/list/',         desc: 'Query audit log list.' },
  // Statistics (16-17)
  { method: 'dsensor.dsensor_cpumem_stat/query_dsensor_cpumem_stat', path: '/api/meta/cpumem_stat', desc: 'Query CPU & memory statistics.' },
  { method: 'dsensor.dsensor_disk_stat/query_dsensor_disk_stat',     path: '/api/meta/disk_stat',    desc: 'Query disk statistics.' },
  // User (18)
  { method: 'dsensor.dsensor_user_list/query_dsensor_user_list', path: '/api/account/manage/user/list', desc: 'Query user list.' },
  // Honeynet (19-20)
  { method: 'dsensor.dsensor_honeynet_list/query_dsensor_honeynet_list',   path: '/api/honey/net/list',   httpMethod: 'GET',  desc: 'Query honeynet list.' },
  { method: 'dsensor.dsensor_honeynet_create/query_dsensor_honeynet_create', path: '/api/honey/net/create', desc: 'Create honeynet.' },
  // Honeypot (21-25)
  { method: 'dsensor.dsensor_honeypot_list/query_dsensor_honeypot_list',     path: '/api/honey/pot/list',     desc: 'Query honeypot list.' },
  { method: 'dsensor.dsensor_honeypot_create/query_dsensor_honeypot_create', path: '/api/honey/pot/create',   desc: 'Create honeypot.' },
  { method: 'dsensor.dsensor_honeypot_delete/query_dsensor_honeypot_delete', path: '/api/honey/pot/delete', httpMethod: 'DELETE', desc: 'Delete honeypot.' },
  { method: 'dsensor.dsensor_honeypot_reset/query_dsensor_honeypot_reset',   path: '/api/honey/pot/reset',    desc: 'Reset honeypot.' },
  { method: 'dsensor.dsensor_honeypot_upgrade/query_dsensor_honeypot_upgrade', path: '/api/honey/pot/upgrade', desc: 'Upgrade honeypot.' },
];

const API_PATHS = Object.fromEntries(API_REGISTRY.map(e => [e.method, e.path]));
const API_HTTP_METHODS = Object.fromEntries(
  API_REGISTRY.filter(e => e.httpMethod).map(e => [e.method, e.httpMethod])
);

// Methods whose backend rejects empty-string proto defaults (preset, node etc).
const STRIP_EMPTY_METHODS = new Set([
  'dsensor.dsensor_honeypot_create/query_dsensor_honeypot_create',
  'dsensor.dsensor_honeypot_reset/query_dsensor_honeypot_reset',
  'dsensor.dsensor_honeypot_upgrade/query_dsensor_honeypot_upgrade',
  'dsensor.dsensor_honeynet_create/query_dsensor_honeynet_create',
]);

const deepStripEmptyStrings = (obj) => {
  if (obj == null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deepStripEmptyStrings);
  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    if (key === '$type_name') continue;
    const cleaned = deepStripEmptyStrings(val);
    if (cleaned !== '' && cleaned !== null && cleaned !== undefined) {
      result[camelToSnake(key)] = cleaned;
    }
  }
  return result;
};

// ─── Request builders ───────────────────────────────────────────────────────

const buildRequestPayload = (methodFull, req) => {
  if (methodFull === 'dsensor.dsensor_honeypot_delete/query_dsensor_honeypot_delete') {
    return '';
  }

  const cleaned = STRIP_EMPTY_METHODS.has(methodFull)
    ? deepStripEmptyStrings(req || {})
    : cleanProtoRequest(req || {});
  return JSON.stringify(cleaned);
};

const buildRequestUrl = (apiBase, methodFull, req) => {
  const apiPath = API_PATHS[methodFull];
  if (methodFull !== 'dsensor.dsensor_honeypot_delete/query_dsensor_honeypot_delete') {
    return `${apiBase}${apiPath}`;
  }

  const cid = unwrapString(req?.cid ?? req?.id).trim();
  if (!cid) return `${apiBase}${apiPath}`;

  const query = new URLSearchParams({ cid });
  return `${apiBase}${apiPath}?${query.toString()}`;
};

// ─── Core handler ────────────────────────────────────────────────────────────

const resolveApiBase = (ctx) => {
  const b = normalizeBaseUrl(firstDefined(
    mergedBindings(ctx).apiBase,
    mergedBindings(ctx).baseUrl,
    mergedBindings(ctx).endpoint,
  ));
  if (!b) throw errorWithCode('INVALID_ARGUMENT', 'apiBase/baseUrl/endpoint is required');
  return b;
};

const requireApiToken = (ctx) => {
  const t = unwrapString(firstDefined(
    mergedBindings(ctx).api_token,
    mergedBindings(ctx).apiToken,
    mergedBindings(ctx).token,
  )).trim();
  if (!t) throw errorWithCode('INVALID_ARGUMENT', 'api_token is required');
  return t;
};

const buildHeaders = (token) => ({
  'Content-Type': 'application/json',
  'API-Token': token,
});

const handleQuery = async (methodFull, req, ctx) => {
  const apiPath = API_PATHS[methodFull];
  if (!apiPath) throw errorWithCode('UNKNOWN', `unknown method: ${methodFull}`);

  const apiBase = resolveApiBase(ctx);
  const apiToken = requireApiToken(ctx);
  const url = buildRequestUrl(apiBase, methodFull, req);

  const httpMethod = API_HTTP_METHODS[methodFull] || 'POST';

  const body = buildRequestPayload(methodFull, req);

  const { status, text } = await fetchJson(ctx, url, {
    method: httpMethod,
    headers: buildHeaders(apiToken),
    body,
  });

  if (status < 200 || status >= 300) throw errorWithCode('PERMISSION_DENIED', `http ${status}`);

  let parsed;
  try { parsed = JSON.parse(text); } catch { throw errorWithCode('UNKNOWN', 'invalid JSON'); }

  return {
    http_status: status,
    raw_body: String(text || ''),
    raw_json: toValue(parsed),
    msg: parsed.msg || '',
    data: toValue(parsed.data),
  };
};

// ─── rpcdef: expose all 25 query paths ───────────────────────────────────────

export function rpcdef(ctx = {}) {
  const c = resolveCallContext(ctx);
  const result = {};
  for (const entry of API_REGISTRY) {
    const queryPath = `/${entry.method}`;
    result[queryPath] = async (r) => handleQuery(entry.method, r ?? {}, c);
  }
  return result;
}

// ─── SDK handlers: keyed by "Service.Method" ─────────────────────────────────

export const handlers = Object.fromEntries(
  API_REGISTRY.map(entry => [
    entry.method,
    (ctx) => {
      const c = resolveCallContext(ctx);
      const req = ctx?.req ?? ctx?.request ?? {};
      return handleQuery(entry.method, req, c);
    },
  ]),
);

// ─── Metadata for CLI command generation ─────────────────────────────────────

export const METHOD_REGISTRY = Object.fromEntries(
  API_REGISTRY.map(e => [e.method, { path: e.path, desc: e.desc }]),
);

// ─── Test exports ────────────────────────────────────────────────────────────

export const _test = {
  errorWithCode,
  unwrapScalar,
  unwrapString,
  normalizeBaseUrl,
  mergedBindings,
  toValue,
  firstDefined,
  API_REGISTRY,
  API_PATHS,
  handleQuery,
  buildRequestPayload,
  buildRequestUrl,
};
