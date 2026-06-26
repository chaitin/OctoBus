import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const DEFAULT_TIMEOUT_MS = 15000;

const PKG = 'QIANXIN_TianYan_Platform';
const P = `/${PKG}.${PKG}/`;

const PATHS = {
  LIST_ALARMS:               `${P}ListAlarms`,
  UPDATE_ALARM_STATUS:       `${P}UpdateAlarmStatus`,
  SEARCH_LOGS:               `${P}SearchLogs`,
  SPL_SEARCH:                `${P}SPLSearch`,
  LIST_ASSETS:               `${P}ListAssets`,
  LIST_VULNERABILITIES:      `${P}ListVulnerabilities`,
  THREAT_HUNT_SEARCH:        `${P}ThreatHuntSearch`,
  ADD_FLOW_WHITELIST:        `${P}AddFlowWhitelist`,
  GET_COMPROMISED_HOST_STATUS: `${P}GetCompromisedHostStatus`,
};

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// IP filter params for alarm queries must be gzip-compressed then base64-encoded
const encodeIp = (ip) => gzipSync(Buffer.from(String(ip), 'utf8')).toString('base64');

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

const checkApiError = (json) => {
  if (json?.error) {
    const msg = String(json.error?.message || json.error?.detail || 'API error');
    const code = json.error?.code;
    if (code === 1013 || code === 1002) throw err('PERMISSION_DENIED', msg);
    throw err('FAILED_PRECONDITION', `TianYan error ${code !== undefined ? code : ''}: ${msg}`);
  }
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

  // 3-step SSO: login_key → sha256 derivation → POST access_token → GET csrf_token + cookie
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

  // GET /skyeye/v1/alarm/alarm/list
  // IP filter params (attack_sip, alarm_sip) must be gzip+base64 encoded
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
    if (attackSip !== undefined) params.set('attack_sip', encodeIp(attackSip));

    const alarmSip = unwrap(firstDefined(req?.alarm_sip));
    if (alarmSip !== undefined) params.set('alarm_sip', encodeIp(alarmSip));

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

    const orderBy = unwrap(firstDefined(req?.order_by));
    if (orderBy !== undefined) params.set('order_by', orderBy);

    const res = await doFetch(`${base}/skyeye/v1/alarm/alarm/list?${params.toString()}`, {
      method: 'GET',
      headers: { Cookie: cookie },
    });
    const json = await readJson(res);
    checkApiError(json);

    const items = Array.isArray(json?.data?.items) ? json.data.items : [];
    return {
      total: toInt(json?.data?.total) ?? 0,
      items: items.map(toValue).filter(Boolean),
    };
  };

  // PUT /alarm/alarm/list — update alarm disposition status
  // status: 0=未处置 1=已处置 6=忽略 7=误报
  const callUpdateAlarmStatus = async (req) => {
    const base = baseUrl();
    const { csrfToken, cookie } = await getSession(base);

    const ids = String(req?.ids ?? '').trim();
    if (!ids) throw err('INVALID_ARGUMENT', 'ids is required (comma-separated alarm IDs)');
    const status = toInt(firstDefined(req?.status));
    if (status === null) throw err('INVALID_ARGUMENT', 'status is required (0=未处置 1=已处置 6=忽略 7=误报)');
    if (![0, 1, 6, 7].includes(status)) {
      throw err('INVALID_ARGUMENT', `invalid status ${status}: must be 0, 1, 6, or 7`);
    }

    const idList = ids.split(',').map((s) => s.trim()).filter(Boolean);
    const res = await doFetch(`${base}/alarm/alarm/list?csrf_token=${encodeURIComponent(csrfToken)}`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ ids: idList, status }),
    });
    const json = await readJson(res);
    checkApiError(json);
    return {};
  };

  // GET /analysis/log-search/list — raw log search
  const callSearchLogs = async (req) => {
    const base = baseUrl();
    const { csrfToken, cookie } = await getSession(base);

    const startTime = req?.start_time;
    const endTime = req?.end_time;
    if (startTime == null) throw err('INVALID_ARGUMENT', 'start_time is required (13-digit ms timestamp)');
    if (endTime == null) throw err('INVALID_ARGUMENT', 'end_time is required (13-digit ms timestamp)');

    const offset = toInt(firstDefined(req?.offset));
    if (offset === null) throw err('INVALID_ARGUMENT', 'offset is required');
    const limit = toInt(firstDefined(req?.limit));
    if (limit === null) throw err('INVALID_ARGUMENT', 'limit is required');

    const params = new URLSearchParams();
    params.set('start_time', String(startTime));
    params.set('end_time', String(endTime));
    params.set('offset', String(offset));
    params.set('limit', String(limit));
    params.set('csrf_token', csrfToken);

    const branchId = unwrap(firstDefined(req?.branch_id));
    if (branchId !== undefined) params.set('branch_id', branchId);

    const index = unwrap(firstDefined(req?.index));
    if (index !== undefined) params.set('index', index);

    const category = unwrap(firstDefined(req?.category));
    if (category !== undefined) params.set('category', category);

    const mode = unwrap(firstDefined(req?.mode));
    if (mode !== undefined) params.set('mode', mode);

    const keyword = unwrap(firstDefined(req?.keyword));
    if (keyword !== undefined) params.set('keyword', keyword);

    const res = await doFetch(`${base}/analysis/log-search/list?${params.toString()}`, {
      method: 'GET',
      headers: { Cookie: cookie },
    });
    const json = await readJson(res);
    checkApiError(json);

    const search = json?.data?.data?.search ?? {};
    const hits = Array.isArray(search?.hits) ? search.hits : [];
    const fields = Array.isArray(json?.data?.data?.fields) ? json.data.data.fields : [];

    return {
      total: toInt(search?.total ?? json?.data?.total) ?? 0,
      items: hits.map((h) => toValue(h?._source ?? h)).filter(Boolean),
      fields: fields.map(String),
    };
  };

  // GET /analysis/log-search/spl-search — SPL expert mode log search
  const callSPLSearch = async (req) => {
    const base = baseUrl();
    const { csrfToken, cookie } = await getSession(base);

    const startTime = req?.start_time;
    const endTime = req?.end_time;
    if (startTime == null) throw err('INVALID_ARGUMENT', 'start_time is required');
    if (endTime == null) throw err('INVALID_ARGUMENT', 'end_time is required');

    const params = new URLSearchParams();
    params.set('start_time', String(startTime));
    params.set('end_time', String(endTime));
    params.set('csrf_token', csrfToken);

    const category = unwrap(firstDefined(req?.category));
    if (category !== undefined) params.set('category', category);

    const index = unwrap(firstDefined(req?.index));
    if (index !== undefined) params.set('index', index);

    const branchId = unwrap(firstDefined(req?.branch_id));
    if (branchId !== undefined) params.set('branch_id', branchId);

    const keyword = unwrap(firstDefined(req?.keyword));
    if (keyword !== undefined) params.set('keyword', keyword);

    const res = await doFetch(`${base}/analysis/log-search/spl-search?${params.toString()}`, {
      method: 'GET',
      headers: { Cookie: cookie },
    });
    const json = await readJson(res);
    checkApiError(json);

    const d = json?.data?.data ?? {};
    return {
      fields: Array.isArray(d.fields) ? d.fields.map(String) : [],
      results: Array.isArray(d.results) ? d.results.map(toValue).filter(Boolean) : [],
    };
  };

  // GET /asset/asset/manage/info — asset list with filters
  const callListAssets = async (req) => {
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

    const ipaddrs = unwrap(firstDefined(req?.ipaddrs));
    if (ipaddrs !== undefined) params.set('ipaddrs', ipaddrs);

    const sname = unwrap(firstDefined(req?.sname));
    if (sname !== undefined) params.set('sname', sname);

    const groupIds = unwrap(firstDefined(req?.group_ids));
    if (groupIds !== undefined) params.set('group_ids', groupIds);

    const port = unwrap(firstDefined(req?.port));
    if (port !== undefined) params.set('port', port);

    const stypeIds = unwrap(firstDefined(req?.stype_ids));
    if (stypeIds !== undefined) params.set('stype_ids', stypeIds);

    const branchId = unwrap(firstDefined(req?.branch_id));
    if (branchId !== undefined) params.set('branch_id', branchId);

    const res = await doFetch(`${base}/asset/asset/manage/info?${params.toString()}`, {
      method: 'GET',
      headers: { Cookie: cookie },
    });
    const json = await readJson(res);
    checkApiError(json);

    const data = Array.isArray(json?.data?.data) ? json.data.data : [];
    return {
      total: toInt(json?.data?.total) ?? 0,
      data: data.map(toValue).filter(Boolean),
    };
  };

  // GET /asset/vul/leaks/list — vulnerability list
  const callListVulnerabilities = async (req) => {
    const base = baseUrl();
    const { csrfToken, cookie } = await getSession(base);

    const limit = toInt(firstDefined(req?.limit));
    if (limit === null) throw err('INVALID_ARGUMENT', 'limit is required');
    const offset = toInt(firstDefined(req?.offset));
    if (offset === null) throw err('INVALID_ARGUMENT', 'offset is required');

    const params = new URLSearchParams();
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    params.set('csrf_token', csrfToken);

    const ip = unwrap(firstDefined(req?.ip));
    if (ip !== undefined) params.set('ip', ip);

    const name = unwrap(firstDefined(req?.name));
    if (name !== undefined) params.set('name', name);

    const level = toInt(firstDefined(req?.level));
    if (level !== null) params.set('level', String(level));

    const branchId = unwrap(firstDefined(req?.branch_id));
    if (branchId !== undefined) params.set('branch_id', branchId);

    const res = await doFetch(`${base}/asset/vul/leaks/list?${params.toString()}`, {
      method: 'GET',
      headers: { Cookie: cookie },
    });
    const json = await readJson(res);
    checkApiError(json);

    const items = Array.isArray(json?.data?.items) ? json.data.items : [];
    return {
      total: toInt(json?.data?.total) ?? 0,
      items: items.map(toValue).filter(Boolean),
    };
  };

  // GET /analysis/hunt/search — build threat relationship graph for IP/domain/MD5/URI
  const callThreatHuntSearch = async (req) => {
    const base = baseUrl();
    const { csrfToken, cookie } = await getSession(base);

    const kwd = String(req?.kwd ?? '').trim();
    if (!kwd) throw err('INVALID_ARGUMENT', 'kwd is required (IP, domain, URL, MD5, or email)');
    const startTime = req?.start_time;
    const endTime = req?.end_time;
    if (startTime == null) throw err('INVALID_ARGUMENT', 'start_time is required');
    if (endTime == null) throw err('INVALID_ARGUMENT', 'end_time is required');

    const params = new URLSearchParams();
    params.set('kwd', kwd);
    params.set('start_time', String(startTime));
    params.set('end_time', String(endTime));
    params.set('csrf_token', csrfToken);

    const res = await doFetch(`${base}/analysis/hunt/search?${params.toString()}`, {
      method: 'GET',
      headers: { Cookie: cookie },
    });
    const json = await readJson(res);
    checkApiError(json);

    const d = json?.data ?? {};
    return {
      nodes: Array.isArray(d.nodes) ? d.nodes.map(toValue).filter(Boolean) : [],
      links: Array.isArray(d.links) ? d.links.map(toValue).filter(Boolean) : [],
    };
  };

  // POST /system/rule_cfg/white_list_flow — add IP/IOC to flow sensor whitelist
  const callAddFlowWhitelist = async (req) => {
    const base = baseUrl();
    const { csrfToken, cookie } = await getSession(base);

    const alarmSips  = unwrap(firstDefined(req?.alarm_sips));
    const attackSips = unwrap(firstDefined(req?.attack_sips));
    const ioc        = unwrap(firstDefined(req?.ioc));
    const threatName = unwrap(firstDefined(req?.threat_name));
    const typeChain  = unwrap(firstDefined(req?.type_chain));

    if (!alarmSips && !attackSips && !ioc && !threatName && !typeChain) {
      throw err('INVALID_ARGUMENT', 'at least one of alarm_sips, attack_sips, ioc, threat_name, type_chain is required');
    }

    const body = {};
    if (alarmSips)  body.alarm_sips = alarmSips;
    if (attackSips) body.attack_sips = attackSips;
    if (ioc)        body.ioc = ioc;
    if (threatName) body.threat_name = threatName;
    if (typeChain)  body.type_chain = typeChain;

    const endTime = req?.end_time;
    if (endTime != null) {
      body.end_time = typeof endTime === 'object' && 'value' in endTime ? endTime.value : endTime;
    }
    const startTime = req?.start_time;
    if (startTime != null) {
      body.start_time = typeof startTime === 'object' && 'value' in startTime ? startTime.value : startTime;
    }

    const res = await doFetch(`${base}/system/rule_cfg/white_list_flow?csrf_token=${encodeURIComponent(csrfToken)}`, {
      method: 'POST',
      headers: { Cookie: cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await readJson(res);
    checkApiError(json);

    const id = String(json?.data?.id ?? json?.data?.data?.id ?? '');
    return { id: id ? { value: id } : undefined };
  };

  // GET /analysis/hunting/stuck_host/status — check if a host is compromised
  const callGetCompromisedHostStatus = async (req) => {
    const base = baseUrl();
    const { csrfToken, cookie } = await getSession(base);

    const assetIp = String(req?.asset_ip ?? '').trim();
    if (!assetIp) throw err('INVALID_ARGUMENT', 'asset_ip is required');
    const startTime = req?.start_time;
    const endTime = req?.end_time;
    if (startTime == null) throw err('INVALID_ARGUMENT', 'start_time is required');
    if (endTime == null) throw err('INVALID_ARGUMENT', 'end_time is required');

    const params = new URLSearchParams();
    params.set('start_time', String(startTime));
    params.set('end_time', String(endTime));
    params.set('asset_ip', assetIp);
    params.set('csrf_token', csrfToken);

    const res = await doFetch(`${base}/analysis/hunting/stuck_host/status?${params.toString()}`, {
      method: 'GET',
      headers: { Cookie: cookie },
    });
    const json = await readJson(res);
    checkApiError(json);

    const d = json?.data ?? {};
    return {
      alarm_count: toInt(d.alarm_count) ?? 0,
      risk_value:  toInt(d.risk_value)  ?? 0,
      ioc_count:   toInt(d.ioc_count)   ?? 0,
      detail: toValue(d) ?? { nullValue: 'NULL_VALUE' },
    };
  };

  return {
    [PATHS.LIST_ALARMS]:                 async () => callListAlarms(ctx.req),
    [PATHS.UPDATE_ALARM_STATUS]:         async () => callUpdateAlarmStatus(ctx.req),
    [PATHS.SEARCH_LOGS]:                 async () => callSearchLogs(ctx.req),
    [PATHS.SPL_SEARCH]:                  async () => callSPLSearch(ctx.req),
    [PATHS.LIST_ASSETS]:                 async () => callListAssets(ctx.req),
    [PATHS.LIST_VULNERABILITIES]:        async () => callListVulnerabilities(ctx.req),
    [PATHS.THREAT_HUNT_SEARCH]:          async () => callThreatHuntSearch(ctx.req),
    [PATHS.ADD_FLOW_WHITELIST]:          async () => callAddFlowWhitelist(ctx.req),
    [PATHS.GET_COMPROMISED_HOST_STATUS]: async () => callGetCompromisedHostStatus(ctx.req),
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

export const _test = {
  err, firstDefined, mergedBindings, normalizeBaseUrl, toInt, toValue, unwrap, sha256, encodeIp, checkApiError,
};
