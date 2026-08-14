import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import net from 'node:net';

const METHOD_CHECK = 'ReportedIP.ReportedIP/CheckIP';
const API_BASE = 'https://reportedip.de/wp-json/reportedip/v2';
const DEFAULT_TIMEOUT_MS = 10000;
const SDK_REF = 'ReportedIP';

const grpcCodeFor = (c) => ({ FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION, INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT, PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED, UNAVAILABLE: grpcStatus.UNAVAILABLE, UNKNOWN: grpcStatus.UNKNOWN })[c] ?? grpcStatus.UNKNOWN;
const errorWithCode = (code, msg) => { const e = new GrpcError(grpcCodeFor(code), `${code}: ${msg}`); e.legacyCode = code; return e; };
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o ?? {}, k);
const firstDefined = (...v) => v.find(x => x !== undefined && x !== null);
const unwrapString = (s) => { if (s === undefined || s === null) return ''; if (typeof s === 'object' && hasOwn(s, 'value')) return unwrapString(s.value); return String(s); };
const logInfo = (m, a, p) => { try { console.log(`[${SDK_REF}][${a}]`, JSON.stringify(p)); } catch { console.log(`[${SDK_REF}][${a}]`, p); } };
const logError = (m, a, p) => { try { console.error(`[${SDK_REF}][${a}]`, JSON.stringify(p)); } catch { console.error(`[${SDK_REF}][${a}]`, p); } };
const parseJson = (t) => { if (!String(t || '').trim()) return null; try { return JSON.parse(t); } catch { throw errorWithCode('UNKNOWN', 'response is not valid JSON'); } };
const mapHttpError = (res) => {
  if (res.status === 401 || res.status === 403) return errorWithCode('PERMISSION_DENIED', `upstream http ${res.status}`);
  if (res.status === 429) return errorWithCode('UNAVAILABLE', `upstream http ${res.status}`);
  return res.status >= 400 && res.status < 500
    ? errorWithCode('FAILED_PRECONDITION', `upstream http ${res.status}`)
    : errorWithCode('UNAVAILABLE', `upstream http ${res.status}`);
};
const responseString = (value) => value === undefined || value === null ? '' : String(value);
const mergedBindings = (ctx = {}) => ({ ...(ctx.config ?? {}), ...(ctx.secret ?? {}), ...(ctx.bindings ?? {}) });
const resolveCallContext = (ctx = {}) => ({ ...ctx, bindings: mergedBindings(ctx), limits: ctx.limits ?? {}, meta: ctx.meta ?? {}, req: ctx.req ?? ctx.request ?? {} });
const resolveTimeoutMs = (ctx = {}, b = {}) => firstDefined(ctx.limits?.timeoutMs, b.timeoutMs, DEFAULT_TIMEOUT_MS);
const resolveBaseUrl = (bindings = {}) => {
  const raw = String(bindings.baseUrl || API_BASE).trim();
  let url;
  try { url = new URL(raw); } catch { throw errorWithCode('INVALID_ARGUMENT', 'baseUrl must be a valid URL'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw errorWithCode('INVALID_ARGUMENT', 'baseUrl must use http or https');
  return raw.replace(/\/+$/, '');
};

const fetchJson = async (url, init, { bindings = {}, timeoutMs }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw mapHttpError(res);
    return { json: parseJson(text), text };
  } catch (err) {
    if (err instanceof GrpcError) throw err;
    throw errorWithCode('UNAVAILABLE', err?.cause?.message || err?.message || 'fetch failed');
  } finally { clearTimeout(timer); }
};

const makeRuntime = (ctx = {}) => {
  const cc = resolveCallContext(ctx);
  const bindings = cc.bindings || {}; const meta = cc.meta || {}; const tm = resolveTimeoutMs(cc, bindings);

  const runCheck = async (req = {}) => {
    const ip = unwrapString(firstDefined(req.ip)).trim();
    if (!ip) throw errorWithCode('INVALID_ARGUMENT', 'ip is required');
    if (!net.isIP(ip)) throw errorWithCode('INVALID_ARGUMENT', 'invalid IP address format');

    const url = `${resolveBaseUrl(bindings)}/check-public?ip=${encodeURIComponent(ip)}`;
    logInfo(meta, 'CheckIP:start', { ip });

    let result;
    try { result = await fetchJson(url, { method: 'GET' }, { bindings, timeoutMs: tm }); }
    catch (err) { logError(meta, 'CheckIP:http-error', { ip, error: err.message }); throw err; }

    const data = result.json?.data || {};
    const confidence = Number(data.abuseConfidencePercentage);
    const hostnames = Array.isArray(data.hostnames) ? data.hostnames.map(responseString) : [];
    logInfo(meta, 'CheckIP:success', { ip });
    return { code: 0, message: 'ok', ip: responseString(data.ip) || ip, abuse_confidence_percentage: Number.isInteger(confidence) && confidence >= 0 ? confidence : 0, country_code: responseString(data.countryCode), usage_type: responseString(data.usageType), isp: responseString(data.isp), domain: responseString(data.domain), hostnames };
  };

  return { runCheck };
};

export const handlers = { [METHOD_CHECK]: (ctx) => makeRuntime(ctx).runCheck(ctx.request ?? {}) };
export const _test = { errorWithCode, firstDefined, hasOwn, logInfo, logError, makeRuntime, mapHttpError, parseJson, resolveBaseUrl, resolveCallContext, resolveTimeoutMs, responseString, unwrapString };
