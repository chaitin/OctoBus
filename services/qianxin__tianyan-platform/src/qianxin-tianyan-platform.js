// QIANXIN TianYan Platform threat alarm query REST proxy
// Auth: login_key → sha256 → POST /skyeye/v1/admin/auth → GET /skyeye/v1/admin/auth (csrf+cookie)

import { createHash } from 'node:crypto';
import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const DEFAULT_TIMEOUT_MS = 15000;

const PKG = 'QIANXIN_TianYan_Platform';
const P = `/${PKG}.${PKG}/`;

const PATHS = {
  LIST_ALARMS: `${P}ListAlarms`,
};

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

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
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'number') return { numberValue: val };
  if (typeof val === 'boolean') return { boolValue: val };
  if (Array.isArray(val)) {
    return { listValue: { values: val.map(toValue).filter((v) => v !== undefined) } };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      const nv = toValue(v);
      fields[k] = nv === undefined ? { nullValue: 'NULL_VALUE' } : nv;
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(val) };
};

const toInt = (val) => {
  if (val === undefined || val === null) return null;
  if (typeof val === 'object' && 'value' in val) return toInt(val.value);
  const n = Number(val);
  return Number.isInteger(n) && !Number.isNaN(n) ? n : null;
};

const unwrap = (val) => {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'object' && 'value' in val) return String(val.value ?? '');
  return String(val);
};

const firstDefined = (...vals) => vals.find((v) => v !== undefined && v !== null);

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.secret ?? {}),
  ...(ctx?.bindings ?? {}),
});

const normalizeBaseUrl = (url) => {
  const s = String(url || '').trim();
  if (!/^https?:\/\//i.test(s)) return null;
  return s.replace(/\/+$/, '');
};

export function rpcdef(ctx) {
  const bindings = mergedBindings(ctx);
  const timeoutMs = ctx.limits?.timeoutMs || DEFAULT_TIMEOUT_MS;
  const skipTls = Boolean(
    bindings.tlsInsecureSkipVerify || bindings.skipTlsVerify ||
    bindings.skip_tls_verify || bindings.tls_insecure_skip_verify,
  );

  const tlsOpts = () => (skipTls ? { insecureSkipVerify: true, tlsInsecureSkipVerify: true } : {});

  const baseUrl = () => {
    const u = normalizeBaseUrl(firstDefined(
      bindings.restBaseUrl, bindings.rest_base_url,
      bindings.baseUrl, bindings.base_url, bindings.endpoint,
    ));
    if (!u) throw err('INVALID_ARGUMENT', 'restBaseUrl is required (http/https)');
    return u;
  };

  const doFetch = async (url, init) => {
    try {
      return await fetch(url, { ...init, timeoutMs, ...tlsOpts() });
    } catch (e) {
      throw err('UNAVAILABLE', e?.cause?.message || e?.message || 'fetch failed');
    }
  };

  const readJson = async (res) => {
    const text = await res.text();
    if (!res.ok) {
      const s = res.status;
      if (s === 401 || s === 403) throw err('PERMISSION_DENIED', `http ${s}: ${text}`);
      if (s >= 400 && s < 500) throw err('FAILED_PRECONDITION', `http ${s}: ${text}`);
      throw err('UNAVAILABLE', `http ${s}: ${text}`);
    }
    if (!text.trim()) throw err('UNKNOWN', 'empty response body');
    try { return JSON.parse(text); } catch { throw err('UNKNOWN', 'response is not valid JSON'); }
  };

  const getSession = async (base) => {
    const loginKey = String(firstDefined(bindings.login_key, bindings.loginKey) || '').trim();
    if (!loginKey) throw err('INVALID_ARGUMENT', 'login_key is required');
    const username = String(firstDefined(bindings.username, bindings.user) || 'tapadmin').trim();

    const clientId = sha256('mNSLP9UJCtBHtegjDPJnK3v|' + loginKey);
    const clientSecret = sha256('3460681205014671737|' + loginKey);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const xAuthorization = sha256(JSON.stringify({ client_id: clientId, username }) + timestamp + clientSecret);

    const res1 = await doFetch(`${base}/skyeye/v1/admin/auth`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'X-Authorization': xAuthorization,
        'X-Timestamp': timestamp,
      },
      body: new URLSearchParams({ client_id: clientId, username }).toString(),
    });

    let authJson;
    try {
      authJson = await readJson(res1);
    } catch (e) {
      if (e?.legacyCode === 'PERMISSION_DENIED' || e?.legacyCode === 'FAILED_PRECONDITION') {
        throw err('PERMISSION_DENIED', 'auth step1 failed: ' + (e.message || ''));
      }
      throw e;
    }

    const accessToken = String(authJson?.access_token || '').trim();
    if (!accessToken) throw err('PERMISSION_DENIED', 'auth step1 returned no access_token');

    const res2 = await doFetch(`${base}/skyeye/v1/admin/auth?token=${encodeURIComponent(accessToken)}`, {
      method: 'GET',
    });

    const html = await res2.text();

    const cookieHeader = res2.headers.get('set-cookie') || '';
    const cookie = cookieHeader
      .split(',')
      .map((part) => part.split(';')[0].trim())
      .filter(Boolean)
      .join('; ');

    const csrfMatch = html.match(/name="csrf-token"\s+content="([0-9a-fA-F]+)"/) ||
                      html.match(/csrf-token.*?content="([0-9a-fA-F]+)"/);
    if (!csrfMatch) throw err('UNKNOWN', 'csrf-token not found in auth response HTML');
    const csrfToken = csrfMatch[1];

    return { csrfToken, cookie };
  };

  const callListAlarms = async (req) => {
    const base = baseUrl();
    const { csrfToken, cookie } = await getSession(base);

    const offset = toInt(firstDefined(req?.offset));
    if (offset === null) throw err('INVALID_ARGUMENT', 'offset is required');
    const limit = toInt(firstDefined(req?.limit));
    if (limit === null) throw err('INVALID_ARGUMENT', 'limit is required');

    const params = new URLSearchParams();
    params.set('offset', String(offset));
    params.set('limit', String(limit));
    params.set('csrf_token', csrfToken);

    const hazardLevel = toInt(firstDefined(req?.hazard_level));
    if (hazardLevel !== null) params.set('hazard_level', String(hazardLevel));

    const startTime = toInt(firstDefined(req?.start_time));
    if (startTime !== null) params.set('start_time', String(startTime));

    const endTime = toInt(firstDefined(req?.end_time));
    if (endTime !== null) params.set('end_time', String(endTime));

    const threatName = unwrap(firstDefined(req?.threat_name));
    if (threatName !== undefined) params.set('threat_name', threatName);

    const attackSip = unwrap(firstDefined(req?.attack_sip));
    if (attackSip !== undefined) params.set('attack_sip', attackSip);

    const alarmSip = unwrap(firstDefined(req?.alarm_sip));
    if (alarmSip !== undefined) params.set('alarm_sip', alarmSip);

    const status = unwrap(firstDefined(req?.status));
    if (status !== undefined) params.set('status', status);

    const threatType = unwrap(firstDefined(req?.threat_type));
    if (threatType !== undefined) params.set('threat_type', threatType);

    const hostState = unwrap(firstDefined(req?.host_state));
    if (hostState !== undefined) params.set('host_state', hostState);

    const dataSource = unwrap(firstDefined(req?.data_source));
    if (dataSource !== undefined) params.set('data_source', dataSource);

    const serialNum = unwrap(firstDefined(req?.serial_num));
    if (serialNum !== undefined) params.set('serial_num', serialNum);

    const ioc = unwrap(firstDefined(req?.ioc));
    if (ioc !== undefined) params.set('ioc', ioc);

    const res = await doFetch(`${base}/alarm/alarm/list?${params.toString()}`, {
      method: 'GET',
      headers: { Cookie: cookie },
    });
    const json = await readJson(res);

    const items = Array.isArray(json?.data?.items) ? json.data.items : [];
    return {
      total: toInt(json?.data?.total) ?? 0,
      items: items.map(toValue).filter(Boolean),
    };
  };

  return {
    [PATHS.LIST_ALARMS]: async () => callListAlarms(ctx.req),
  };
}

const mergeCtx = (base, inner) => ({
  ...(base ?? {}), ...(inner ?? {}),
  bindings: { ...(base?.bindings ?? {}), ...(inner?.bindings ?? {}) },
  config: { ...(base?.config ?? {}), ...(inner?.config ?? {}) },
  secret: { ...(base?.secret ?? {}), ...(inner?.secret ?? {}) },
  limits: inner?.limits ?? base?.limits ?? {},
  meta: inner?.meta ?? base?.meta ?? {},
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

export const _test = { err, firstDefined, mergedBindings, normalizeBaseUrl, toInt, toValue, unwrap, sha256 };
