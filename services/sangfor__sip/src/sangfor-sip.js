import { createHash, randomInt } from 'node:crypto';
import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_COUNT = 10000;
let insecureTlsDispatcher;

const getInsecureTlsDispatcher = () => {
  insecureTlsDispatcher ??= new Agent({ connect: { rejectUnauthorized: false } });
  return insecureTlsDispatcher;
};

const PKG = 'SANGFOR_SIP';
const P = `/${PKG}.${PKG}/`;

const PATHS = {
  GET_SECURITY_EVENTS:        `${P}GetSecurityEvents`,
  GET_RISK_BUSINESS:          `${P}GetRiskBusiness`,
  GET_RISK_TERMINALS:         `${P}GetRiskTerminals`,
  GET_SERVERS:                `${P}GetServers`,
  GET_TERMINALS:              `${P}GetTerminals`,
  GET_IP_GROUPS:              `${P}GetIPGroups`,
  GET_WEAK_PASSWORDS:         `${P}GetWeakPasswords`,
  GET_VULNERABILITIES:        `${P}GetVulnerabilities`,
  GET_PLAINTEXT_TRANSMISSIONS: `${P}GetPlaintextTransmissions`,
};

const API_PATHS = {
  auth:                  '/sangforinter/v1/auth/party/login',
  securityEvents:        '/sangforinter/v1/data/riskevent',
  riskBusiness:          '/sangforinter/v1/data/riskbusiness',
  riskTerminals:         '/sangforinter/v1/data/riskterminal',
  servers:               '/sangforinter/v1/data/business',
  terminals:             '/sangforinter/v1/data/terminal',
  ipGroups:              '/sangforinter/v1/data/ipgroup',
  weakPasswords:         '/sangforinter/v1/data/weakpasswd',
  vulnerabilities:       '/sangforinter/v1/data/hole',
  plaintextTransmissions: '/sangforinter/v1/data/plaintexttransmission',
};

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const err = (code, msg) => {
  const e = new GrpcError(grpcCodeFor(code), `${code}: ${msg}`);
  e.legacyCode = code;
  return e;
};

const toValue = (val) => {
  if (val === undefined || val === null) return { nullValue: 'NULL_VALUE' };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'number') return { numberValue: val };
  if (typeof val === 'boolean') return { boolValue: val };
  if (Array.isArray(val)) return { listValue: { values: val.map(toValue) } };
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) fields[k] = toValue(v);
    return { structValue: { fields } };
  }
  return { stringValue: String(val) };
};

const toInt = (val) => {
  if (val === undefined || val === null) return null;
  if (typeof val === 'object' && 'value' in val) return toInt(val.value);
  const n = Number(val);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

const unwrap = (val) => {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'object' && 'value' in val) return val.value == null ? undefined : String(val.value);
  return String(val);
};

const firstDefined = (...vals) => vals.find((v) => v !== undefined && v !== null);

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.secret ?? {}),
  ...(ctx?.bindings ?? {}),
});

const normalizeBaseUrl = (url) => {
  const s = String(url && typeof url === 'object' && 'value' in url ? url.value : url ?? '').trim().replace(/\/+$/, '');
  if (!s || !/^https?:\/\//i.test(s)) return null;
  return s;
};

const isTimeoutError = (error) => {
  const seen = new Set();
  for (let current = error; current && !seen.has(current); current = current.cause) {
    seen.add(current);
    if (current.name === 'TimeoutError' || current.code === 'UND_ERR_CONNECT_TIMEOUT') return true;
  }
  return false;
};

export const sipAuth3 = (userName, password, rand) => {
  return createHash('sha1')
    .update(String(rand) + password + 'sangfor3party' + userName)
    .digest('hex');
};

export function rpcdef(ctx) {
  const bindings = mergedBindings(ctx);
  const configuredTimeout = Number(firstDefined(ctx?.limits?.timeoutMs, bindings.timeoutMs));
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? Math.trunc(configuredTimeout)
    : DEFAULT_TIMEOUT_MS;
  const skipTlsVerify = firstDefined(bindings.skipTlsVerify, bindings.skip_tls_verify) === true;

  const baseUrl = () => {
    const candidates = [bindings.host, bindings.baseUrl, bindings.restBaseUrl];
    const u = candidates.map(normalizeBaseUrl).find(Boolean);
    if (!u) throw err('INVALID_ARGUMENT', 'config.host is required (e.g. https://10.0.0.1:7443)');
    return u;
  };

  const doFetch = async (url, init) => {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
        ...(skipTlsVerify ? { dispatcher: getInsecureTlsDispatcher() } : {}),
      });
    } catch (e) {
      if (isTimeoutError(e)) throw err('UNAVAILABLE', `upstream request timed out after ${timeoutMs}ms`);
      throw err('UNAVAILABLE', 'upstream request failed');
    }
  };

  const readJson = async (res) => {
    let text;
    try { text = await res.text(); } catch { throw err('UNKNOWN', 'failed to read response body'); }
    if (res.status === 401 || res.status === 403) throw err('PERMISSION_DENIED', `upstream returned HTTP ${res.status}`);
    if (res.status >= 400 && res.status < 500) throw err('FAILED_PRECONDITION', `upstream returned HTTP ${res.status}`);
    if (res.status >= 500) throw err('UNAVAILABLE', `upstream returned HTTP ${res.status}`);
    if (!text.trim()) throw err('UNKNOWN', 'empty response body');
    try { return JSON.parse(text); } catch { throw err('UNKNOWN', 'response is not valid JSON'); }
  };

  const getToken = async (base) => {
    const userName = unwrap(firstDefined(bindings.userName, bindings.username))?.trim() ?? '';
    const password = unwrap(bindings.password)?.trim() ?? '';
    const platformName = unwrap(bindings.platformName)?.trim() ?? '';

    if (!userName) throw err('INVALID_ARGUMENT', 'secret.userName is required');
    if (!password) throw err('INVALID_ARGUMENT', 'secret.password is required');
    if (!platformName) throw err('INVALID_ARGUMENT', 'secret.platformName is required');

    const rand = randomInt(0, 2147483647);
    const auth = sipAuth3(userName, password, rand);

    const body = JSON.stringify({ rand, userName, clientProduct: '', clientVersion: '', clientId: 0, desc: '', auth, platformName });
    const res = await doFetch(base + API_PATHS.auth, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    const json = await readJson(res);
    if (json?.code === 13) throw err('PERMISSION_DENIED', 'SIP permission denied');
    if (json?.code !== 0) throw err('FAILED_PRECONDITION', `SIP authentication failed with code ${json?.code ?? 'unknown'}`);

    const token = json?.data?.token;
    if (!token) throw err('UNKNOWN', 'SIP auth response missing token');
    return token;
  };

  const pullData = async (apiPath, req) => {
    const base = baseUrl();

    const fromTime = toInt(firstDefined(req?.from_time, req?.fromTime));
    const toTime = toInt(firstDefined(req?.to_time, req?.toTime));

    if (fromTime === null) throw err('INVALID_ARGUMENT', 'from_time is required');
    if (toTime === null) throw err('INVALID_ARGUMENT', 'to_time is required');

    const maxCount = toInt(firstDefined(req?.max_count, req?.maxCount)) ?? 2000;
    if (maxCount < 1 || maxCount > MAX_COUNT) {
      throw err('INVALID_ARGUMENT', `max_count must be in [1, ${MAX_COUNT}]`);
    }
    if (fromTime >= toTime) throw err('INVALID_ARGUMENT', 'from_time must be less than to_time');

    const token = await getToken(base);

    const params = new URLSearchParams({ token, fromActionTime: String(fromTime), toActionTime: String(toTime), maxCount: String(maxCount) });
    const res = await doFetch(`${base}${apiPath}?${params.toString()}`);
    const json = await readJson(res);

    if (json?.code === 13) throw err('PERMISSION_DENIED', 'SIP permission denied');
    if (json?.code !== 0) throw err('FAILED_PRECONDITION', `SIP request failed with code ${json?.code ?? 'unknown'}`);

    const items = Array.isArray(json?.data?.items) ? json.data.items : [];
    const count = typeof json?.data?.count === 'number' ? json.data.count : items.length;
    return { items: items.map(toValue), count };
  };

  const callGetSecurityEvents = async (req) => pullData(API_PATHS.securityEvents, req);
  const callGetRiskBusiness   = async (req) => pullData(API_PATHS.riskBusiness, req);
  const callGetRiskTerminals  = async (req) => pullData(API_PATHS.riskTerminals, req);
  const callGetServers        = async (req) => pullData(API_PATHS.servers, req);
  const callGetTerminals      = async (req) => pullData(API_PATHS.terminals, req);
  const callGetIPGroups       = async (req) => pullData(API_PATHS.ipGroups, req);
  const callGetWeakPasswords  = async (req) => pullData(API_PATHS.weakPasswords, req);
  const callGetVulnerabilities      = async (req) => pullData(API_PATHS.vulnerabilities, req);
  const callGetPlaintextTransmissions = async (req) => pullData(API_PATHS.plaintextTransmissions, req);

  return {
    [PATHS.GET_SECURITY_EVENTS]:         async () => callGetSecurityEvents(ctx.req),
    [PATHS.GET_RISK_BUSINESS]:           async () => callGetRiskBusiness(ctx.req),
    [PATHS.GET_RISK_TERMINALS]:          async () => callGetRiskTerminals(ctx.req),
    [PATHS.GET_SERVERS]:                 async () => callGetServers(ctx.req),
    [PATHS.GET_TERMINALS]:               async () => callGetTerminals(ctx.req),
    [PATHS.GET_IP_GROUPS]:               async () => callGetIPGroups(ctx.req),
    [PATHS.GET_WEAK_PASSWORDS]:          async () => callGetWeakPasswords(ctx.req),
    [PATHS.GET_VULNERABILITIES]:         async () => callGetVulnerabilities(ctx.req),
    [PATHS.GET_PLAINTEXT_TRANSMISSIONS]: async () => callGetPlaintextTransmissions(ctx.req),
  };
}

const mergeCtx = (base, inner) => ({
  ...(base ?? {}), ...(inner ?? {}),
  bindings: { ...(base?.bindings ?? {}), ...(inner?.bindings ?? {}) },
  config:   { ...(base?.config ?? {}),   ...(inner?.config ?? {}) },
  secret:   { ...(base?.secret ?? {}),   ...(inner?.secret ?? {}) },
  limits:   inner?.limits ?? base?.limits ?? {},
  meta:     inner?.meta   ?? base?.meta   ?? {},
});

const resolveCallContext = (baseCtx, reqOrCtx, maybeCtx) => {
  if (maybeCtx !== undefined) return { req: reqOrCtx ?? {}, ctx: mergeCtx(baseCtx, maybeCtx) };
  const inner = reqOrCtx ?? {};
  return { req: inner.request ?? inner.req ?? {}, ctx: mergeCtx(baseCtx, inner) };
};

const wrapHandler = (baseCtx, path) => async (reqOrCtx, maybeCtx) => {
  const { req, ctx } = resolveCallContext(baseCtx, reqOrCtx, maybeCtx);
  return rpcdef({ ...ctx, req })[path]();
};

const registerHandlers = (ctx = {}) => Object.fromEntries(
  Object.values(PATHS).map((p) => [p, wrapHandler(ctx, p)]),
);

const sdkHandlers = registerHandlers({});

export const handlers = Object.fromEntries(
  Object.values(PATHS).map((p) => [p.replace(/^\//, ''), sdkHandlers[p]]),
);

export const _test = { sipAuth3, toValue, normalizeBaseUrl, PATHS, API_PATHS };
