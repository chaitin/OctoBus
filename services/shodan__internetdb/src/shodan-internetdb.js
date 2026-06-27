import net from 'node:net';
import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

// ---- Method paths ----

const METHOD_LOOKUP_FULL = 'Shodan_InternetDB.Shodan_InternetDB/LookupIP';

// ---- Constants ----

const API_BASE = 'https://internetdb.shodan.io';
const SDK_REF = 'Shodan_InternetDB';
const DEFAULT_TIMEOUT_MS = 10000;

// ---- Error helpers ----

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

// ---- Value helpers ----

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const firstDefined = (...values) => values.find((v) => v !== undefined && v !== null);

const unwrapString = (source, depth = 0) => {
  if (depth > 10) return '';
  if (source === undefined || source === null) return '';
  if (typeof source === 'object' && source !== null && hasOwn(source, 'value')) return unwrapString(source.value, depth + 1);
  return String(source);
};

const logInfo = (meta, action, payload) => {
  const prefix = `[${SDK_REF}][${action}]`;
  try { console.log(prefix, JSON.stringify(payload)); } catch { console.log(prefix, payload); }
};

const logError = (meta, action, payload) => {
  const prefix = `[${SDK_REF}][${action}]`;
  try { console.error(prefix, JSON.stringify(payload)); } catch { console.error(prefix, payload); }
};

// ---- HTTP ----

const parseJson = (text) => {
  if (!String(text || '').trim()) return null;
  try { return JSON.parse(text); } catch { throw errorWithCode('UNKNOWN', 'response is not valid JSON'); }
};

const mapHttpError = (res, bodyText) => {
  if (res.status >= 400 && res.status < 500) throw errorWithCode('FAILED_PRECONDITION', `upstream http ${res.status}`);
  throw errorWithCode('UNAVAILABLE', `upstream http ${res.status}`);
};

const fetchJson = async (url, init, { bindings = {}, timeoutMs }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) mapHttpError(res, text);
    return { json: parseJson(text), text };
  } catch (err) {
    if (err instanceof GrpcError) throw err;
    const reason = err?.cause?.message || err?.message || 'fetch failed';
    throw errorWithCode('UNAVAILABLE', reason);
  } finally {
    clearTimeout(timer);
  }
};

// ---- Context resolution ----

const mergedBindings = (ctx = {}) => ({ ...(ctx.config ?? {}), ...(ctx.secret ?? {}), ...(ctx.bindings ?? {}) });

const resolveCallContext = (ctx = {}) => ({
  ...ctx, bindings: mergedBindings(ctx), limits: ctx.limits ?? {}, meta: ctx.meta ?? {}, req: ctx.req ?? ctx.request ?? {},
});

const resolveTimeoutMs = (ctx = {}, bindings = {}) =>
  firstDefined(ctx.limits?.timeoutMs, bindings.timeoutMs, DEFAULT_TIMEOUT_MS);

// ---- Handlers ----

const makeRuntime = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings || {};
  const meta = callCtx.meta || {};
  const timeoutMs = resolveTimeoutMs(callCtx, bindings);

  const runLookup = async (req = {}) => {
    const ip = unwrapString(firstDefined(req.ip)).trim();
    if (!ip) throw errorWithCode('INVALID_ARGUMENT', 'ip is required');
    if (!net.isIP(ip)) throw errorWithCode('INVALID_ARGUMENT', 'invalid IP address format');

    const url = `${API_BASE}/${encodeURIComponent(ip)}`;

    logInfo(meta, 'LookupIP:start', { ip });

    let result;
    try {
      result = await fetchJson(url, { method: 'GET' }, { bindings, timeoutMs });
    } catch (err) {
      logError(meta, 'LookupIP:http-error', { ip, error: err.message });
      throw err;
    }

    logInfo(meta, 'LookupIP:success', { ip });

    return {
      code: 0,
      message: 'ok',
      ip: result.json?.ip || ip,
      hostnames: result.json?.hostnames || [],
      ports: result.json?.ports || [],
      cpes: result.json?.cpes || [],
      tags: result.json?.tags || [],
      vulns: result.json?.vulns || [],
    };
  };

  return { runLookup };
};

// ---- Exports ----

export const handlers = {
  [METHOD_LOOKUP_FULL]: (ctx) => makeRuntime(ctx).runLookup(ctx.request ?? {}),
};

export const _test = {
  errorWithCode,
  firstDefined,
  hasOwn,
  logInfo,
  logError,
  makeRuntime,
  mapHttpError,
  parseJson,
  resolveCallContext,
  resolveTimeoutMs,
  unwrapString,
};
