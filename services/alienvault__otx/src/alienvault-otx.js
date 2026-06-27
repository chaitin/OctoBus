import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const METHOD_IP_FULL = 'AlienVault_OTX.AlienVault_OTX/CheckIP';
const METHOD_DOMAIN_FULL = 'AlienVault_OTX.AlienVault_OTX/CheckDomain';

const API_BASE = 'https://otx.alienvault.com/api/v1';
const SDK_REF = 'AlienVault_OTX';
const DEFAULT_TIMEOUT_MS = 10000;

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
const firstDefined = (...values) => values.find((v) => v !== undefined && v !== null);

const unwrapString = (source) => {
  if (source === undefined || source === null) return '';
  if (typeof source === 'object' && source !== null && hasOwn(source, 'value')) return unwrapString(source.value);
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

const mergedBindings = (ctx = {}) => ({ ...(ctx.config ?? {}), ...(ctx.secret ?? {}), ...(ctx.bindings ?? {}) });

const resolveCallContext = (ctx = {}) => ({
  ...ctx, bindings: mergedBindings(ctx), limits: ctx.limits ?? {}, meta: ctx.meta ?? {}, req: ctx.req ?? ctx.request ?? {},
});

const resolveTimeoutMs = (ctx = {}, bindings = {}) =>
  firstDefined(ctx.limits?.timeoutMs, bindings.timeoutMs, DEFAULT_TIMEOUT_MS);

const callOTX = async (path, { meta, bindings, timeoutMs }) => {
  const url = `${API_BASE}${path}`;
  logInfo(meta, `GET:start`, { url });
  try {
    const result = await fetchJson(url, { method: 'GET' }, { bindings, timeoutMs });
    logInfo(meta, `GET:success`, { url });
    return result.json || {};
  } catch (err) {
    logError(meta, `GET:http-error`, { url, error: err.message });
    throw err;
  }
};

const makeRuntime = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings || {};
  const meta = callCtx.meta || {};
  const timeoutMs = resolveTimeoutMs(callCtx, bindings);

  const runCheckIP = async (req = {}) => {
    const ip = unwrapString(firstDefined(req.ip)).trim();
    if (!ip) throw errorWithCode('INVALID_ARGUMENT', 'ip is required');

    const general = await callOTX(`/indicators/IPv4/${encodeURIComponent(ip)}/general`, { meta, bindings, timeoutMs });
    const malware = await callOTX(`/indicators/IPv4/${encodeURIComponent(ip)}/malware`, { meta, bindings, timeoutMs });

    return {
      code: 0, message: 'ok',
      ip: general.indicator || ip,
      reputation: general.reputation ?? 0,
      asn: general.asn || '',
      country_name: general.country_name || '',
      country_code: general.country_code || '',
      latitude: general.latitude ?? 0,
      longitude: general.longitude ?? 0,
      malware_sample_count: malware.count ?? 0,
    };
  };

  const runCheckDomain = async (req = {}) => {
    const domain = unwrapString(firstDefined(req.domain)).trim();
    if (!domain) throw errorWithCode('INVALID_ARGUMENT', 'domain is required');

    const general = await callOTX(`/indicators/domain/${encodeURIComponent(domain)}/general`, { meta, bindings, timeoutMs });
    const malware = await callOTX(`/indicators/domain/${encodeURIComponent(domain)}/malware`, { meta, bindings, timeoutMs });

    return {
      code: 0, message: 'ok',
      domain: general.indicator || domain,
      malware_sample_count: malware.count ?? 0,
    };
  };

  return { runCheckIP, runCheckDomain };
};

export const handlers = {
  [METHOD_IP_FULL]: (ctx) => makeRuntime(ctx).runCheckIP(ctx.request ?? {}),
  [METHOD_DOMAIN_FULL]: (ctx) => makeRuntime(ctx).runCheckDomain(ctx.request ?? {}),
};

export const _test = {
  errorWithCode, firstDefined, hasOwn, logInfo, logError, makeRuntime,
  mapHttpError, parseJson, resolveCallContext, resolveTimeoutMs, unwrapString,
};
