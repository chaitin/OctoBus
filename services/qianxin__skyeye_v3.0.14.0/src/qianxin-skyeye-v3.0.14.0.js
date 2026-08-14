import { createHash } from 'crypto';
import http from 'node:http';
import https from 'node:https';
import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const METHOD_QUERY_ALARM_LIST_PATH = '/QianXin_SkyEye_V3_0_14_0.QianXin_SkyEye_V3_0_14_0/QueryAlarmList';
export const METHOD_QUERY_ALARM_LIST_FULL = 'QianXin_SkyEye_V3_0_14_0.QianXin_SkyEye_V3_0_14_0/QueryAlarmList';
export const METHOD_QUERY_ALARM_PACKET_PATH = '/QianXin_SkyEye_V3_0_14_0.QianXin_SkyEye_V3_0_14_0/QueryAlarmPacket';
export const METHOD_QUERY_ALARM_PACKET_FULL = 'QianXin_SkyEye_V3_0_14_0.QianXin_SkyEye_V3_0_14_0/QueryAlarmPacket';
export const METHOD_DOWNLOAD_ALARM_PCAP_PATH = '/QianXin_SkyEye_V3_0_14_0.QianXin_SkyEye_V3_0_14_0/DownloadAlarmPcap';
export const METHOD_DOWNLOAD_ALARM_PCAP_FULL = 'QianXin_SkyEye_V3_0_14_0.QianXin_SkyEye_V3_0_14_0/DownloadAlarmPcap';
export const METHOD_QUERY_NETWORK_LOG_PATH = '/QianXin_SkyEye_V3_0_14_0.QianXin_SkyEye_V3_0_14_0/QueryNetworkLog';
export const METHOD_QUERY_NETWORK_LOG_FULL = 'QianXin_SkyEye_V3_0_14_0.QianXin_SkyEye_V3_0_14_0/QueryNetworkLog';

export const DEFAULT_TIMEOUT_MS = 10000;

export const ALARM_LIST_HTTP_PATH = '/skyeye/v1/alarm/alarm/list';
export const ALARM_PACKET_HTTP_PATH = '/skyeye/v1/alarm/alarm/info/packet';
export const ALARM_PCAP_HTTP_PATH = '/skyeye/v1/alarm/alarm/info/pcap/download';
export const NETWORK_LOG_HTTP_PATH = '/skyeye/v1/analysis/log-search/list';
export const AUTH_HTTP_PATH = '/skyeye/v1/admin/auth';

export const AUTH_CACHE_TTL_MS = 0; // Cache disabled - re-auth every call to match Python script behavior

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  INTERNAL: grpcStatus.INTERNAL,
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
const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const toTrimmedString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

const normalizeBaseUrl = (value) => {
  const raw = toTrimmedString(value);
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    if (url.hash || url.search) return '';
    return raw.replace(/\/+$/, '');
  } catch {
    return '';
  }
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx.config ?? {}),
  ...(ctx.secret ?? {}),
  ...(ctx.bindings ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.req ?? ctx.request ?? {},
});

// ─── Binding resolvers ───

const resolveDomain = (bindings = {}) => normalizeBaseUrl(firstDefined(
  bindings.skyeye_domain,
  bindings.domain,
  bindings.restBaseUrl,
  bindings.baseUrl,
));

const resolveLoginKey = (bindings = {}) => toTrimmedString(firstDefined(
  bindings.skyeye_login_key,
  bindings.login_key,
));

const resolveCsrfToken = (bindings = {}) => toTrimmedString(firstDefined(
  bindings.skyeye_csrf_token,
  bindings.csrf_token,
));

const resolveUserName = (bindings = {}) => toTrimmedString(firstDefined(
  bindings.skyeye_user_name,
  bindings.user_name,
  bindings.skyeye_staff_name,
  bindings.staff_name,
));

const resolveStaffName = (bindings = {}) => toTrimmedString(firstDefined(
  bindings.skyeye_staff_name,
  bindings.staff_name,
));

const resolveClientIdRandom = (bindings = {}) => toTrimmedString(firstDefined(
  bindings.client_id_random,
  bindings.clientIdRandom,
)) || '';

const resolveClientSecretRandom = (bindings = {}) => toTrimmedString(firstDefined(
  bindings.client_secret_random,
  bindings.clientSecretRandom,
)) || '';

const resolveTimeoutMs = (ctx = {}) => {
  const raw = Number(firstDefined(ctx.limits?.timeoutMs, ctx.bindings?.timeoutMs, DEFAULT_TIMEOUT_MS));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

const buildTlsOptions = (bindings = {}) => {
  const enabled = Boolean(bindings.skipTlsVerify || bindings.tlsInsecureSkipVerify || bindings.insecureSkipVerify);
  if (!enabled) return {};
  return {
    skipTlsVerify: true,
    tlsInsecureSkipVerify: true,
    insecureSkipVerify: true,
  };
};

const shouldSkipTls = (bindings = {}) =>
  Boolean(bindings.skipTlsVerify || bindings.tlsInsecureSkipVerify || bindings.insecureSkipVerify);

// ---------- low-level HTTP using node:http/https ----------

const MAX_REDIRECTS = 5;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

const singleRequest = (url, options, body, extraCookies) => new Promise((resolve, reject) => {
  const parsed = new URL(url);
  const isHttps = parsed.protocol === 'https:';
  const lib = isHttps ? https : http;
  const headers = { ...options.headers };
  if (extraCookies) headers['Cookie'] = extraCookies;
  const reqOpts = {
    method: options.method || 'GET',
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.pathname + parsed.search,
    headers,
    timeout: options.timeout || 10000,
  };
  if (isHttps && options.rejectUnauthorized === false) {
    reqOpts.rejectUnauthorized = false;
  }
  const req = lib.request(reqOpts, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => {
      const responseBody = Buffer.concat(chunks).toString('utf-8');
      const setCookieHeaders = res.headers['set-cookie'] || [];
      resolve({
        status: res.statusCode || 0,
        headers: res.headers,
        body: responseBody,
        cookies: setCookieHeaders,
      });
    });
  });
  req.on('error', (err) => reject(err));
  req.on('timeout', () => { req.destroy(new Error(`request timeout after ${options.timeout}ms`)); });
  if (body) req.write(body, 'utf-8');
  req.end();
});

const parseCookiePart = (cookie) => {
  const part = String(cookie || '').split(';')[0].trim();
  const idx = part.indexOf('=');
  if (idx <= 0) return null;
  return { name: part.slice(0, idx), value: part.slice(idx + 1) };
};

const mergeCookieParts = (existingCookies = [], newCookies = []) => {
  const jar = new Map();
  for (const cookie of existingCookies) {
    const parsed = parseCookiePart(cookie);
    if (parsed) jar.set(parsed.name, parsed.value);
  }
  for (const cookie of newCookies) {
    const parsed = parseCookiePart(cookie);
    if (parsed) jar.set(parsed.name, parsed.value);
  }
  return Array.from(jar, ([name, value]) => `${name}=${value}`);
};

const collectCookieStr = (cookieParts, newCookies) => {
  cookieParts.splice(0, cookieParts.length, ...mergeCookieParts(cookieParts, newCookies));
  return cookieParts.join('; ');
};

const httpRequest = async (url, options, body) => {
  const followRedirect = options.followRedirect !== false;
  const allCookies = options.initialCookies ? [...options.initialCookies] : [];
  let currentUrl = url;
  let cookieHeader = allCookies.join('; ');

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const res = await singleRequest(currentUrl, options, i === 0 ? body : null, cookieHeader || undefined);
    const setCookieHeaders = res.cookies || [];
    cookieHeader = collectCookieStr(allCookies, setCookieHeaders);

    if (!REDIRECT_CODES.has(res.status) || !followRedirect) {
      return {
        status: res.status,
        ok: res.status >= 200 && res.status < 300,
        text: () => res.body,
        json: () => JSON.parse(res.body),
        headers: {
          get: (name) => res.headers[name.toLowerCase()] ?? null,
          getSetCookie: () => allCookies,
        },
      };
    }

    const location = res.headers['location'];
    if (!location) {
      return {
        status: res.status,
        ok: false,
        text: () => res.body,
        json: () => JSON.parse(res.body),
        headers: {
          get: (name) => res.headers[name.toLowerCase()] ?? null,
          getSetCookie: () => allCookies,
        },
      };
    }

    const nextUrl = new URL(location, currentUrl);
    if (nextUrl.origin !== new URL(currentUrl).origin) {
      throw errorWithCode('UNAVAILABLE', 'SkyEye refused a cross-origin redirect');
    }
    currentUrl = nextUrl.toString();
    // Redirects become GET
    options = { ...options, method: 'GET' };
  }

  throw new Error(`too many redirects (>${MAX_REDIRECTS})`);
};

const requireDomain = (ctx = {}) => {
  const domain = resolveDomain(ctx.bindings || {});
  if (!domain) throw errorWithCode('INVALID_ARGUMENT', 'skyeye_domain is required in bindings');
  return domain;
};

const requireStaffName = (ctx = {}) => {
  const name = resolveStaffName(ctx.bindings || {});
  if (!name) throw errorWithCode('INVALID_ARGUMENT', 'skyeye_staff_name is required in bindings');
  return name;
};

const requireField = (req = {}, fieldName) => {
  const camelName = fieldName.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  const value = toTrimmedString(firstDefined(req[camelName], req[fieldName]));
  if (!value) throw errorWithCode('INVALID_ARGUMENT', `${fieldName} is required`);
  return value;
};

const reqField = (req = {}, fieldName) => {
  const camelName = fieldName.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  const value = firstDefined(req[camelName], req[fieldName]);
  return value;
};

const logFlow = (ctx, action, details) => {
  const meta = ctx.meta || {};
  const trace = [];
  if (meta.instance_id || meta.instanceId) trace.push(`inst=${meta.instance_id || meta.instanceId}`);
  if (meta.request_id || meta.requestId) trace.push(`req=${meta.request_id || meta.requestId}`);
  const prefix = `[QianXin_SkyEye_V3_0_14_0][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
  try {
    console.log(prefix, JSON.stringify(details));
  } catch {
    console.log(prefix, details);
  }
};

// ─── Authentication ───

const authCache = new Map();

const collectCookiesFromResponse = (res, cookies) => {
  try {
    if (typeof res.headers.getSetCookie === 'function') {
      cookies.splice(0, cookies.length, ...mergeCookieParts(cookies, res.headers.getSetCookie()));
    } else {
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) {
        cookies.splice(0, cookies.length, ...mergeCookieParts(cookies, String(setCookie).split(',')));
      }
    }
  } catch {
    // Cookie extraction best-effort
  }
};

const authenticate = async (domain, loginKey, userName, clientIdRandom, clientSecretRandom, timeoutMs, skipTlsVerify) => {
  const cacheKey = `${domain}:${loginKey}`;
  const cached = authCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    logFlow({}, 'auth:cached', { expiresAt: cached.expiresAt });
    return cached;
  }

  const clientId = createHash('sha256').update(`${clientIdRandom}|${loginKey}`).digest('hex');
  const clientSecret = createHash('sha256').update(`${clientSecretRandom}|${loginKey}`).digest('hex');
  const xTimestamp = String(Math.floor(Date.now() / 1000));
  const rawString = `{"client_id":"${clientId}","username":"${userName}"}${xTimestamp}${clientSecret}`;
  const xAuthorization = createHash('sha256').update(rawString).digest('hex');

  const tlsRejectUnauthorized = skipTlsVerify ? false : undefined;
  const authUrl = `${domain}${AUTH_HTTP_PATH}`;

  // Step 1: POST to auth endpoint
  const cookies = [];
  let res1;
  try {
    res1 = await httpRequest(authUrl, {
      method: 'POST',
      headers: {
        'X-Authorization': xAuthorization,
        'X-Timestamp': xTimestamp,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: timeoutMs,
      rejectUnauthorized: tlsRejectUnauthorized,
      followRedirect: false,
    }, `client_id=${encodeURIComponent(clientId)}&username=${encodeURIComponent(userName)}`);
  } catch (err) {
    const errMsg = err?.message || 'request failed';
    logFlow({}, 'auth:post:error', { error: errMsg });
    throw errorWithCode('UNAVAILABLE', `SkyEye auth POST failed: ${errMsg}`);
  }

  collectCookiesFromResponse(res1, cookies);

  if (!res1.ok) {
    const text = await res1.text();
    if (res1.status === 401 || res1.status === 403) {
      throw errorWithCode('PERMISSION_DENIED', `SkyEye auth POST denied: ${res1.status} ${text}`);
    }
    throw errorWithCode('UNAVAILABLE', `SkyEye auth POST failed: ${res1.status} ${text}`);
  }

  let res1Body;
  try {
    res1Body = JSON.parse(await res1.text());
  } catch {
    throw errorWithCode('INTERNAL', 'SkyEye auth POST returned invalid JSON');
  }
  const accessToken = res1Body.access_token || '';
  if (!accessToken) {
    throw errorWithCode('PERMISSION_DENIED', `SkyEye auth POST returned no access_token: ${JSON.stringify(res1Body).substring(0, 300)}`);
  }

  // Step 2: GET auth endpoint with token to obtain csrf_token + session
  const verifyUrl = `${authUrl}?token=${encodeURIComponent(accessToken)}`;
  let res2;
  try {
    res2 = await httpRequest(verifyUrl, {
      method: 'GET',
      timeout: timeoutMs,
      rejectUnauthorized: tlsRejectUnauthorized,
      initialCookies: cookies,
    });
  } catch (err) {
    const errMsg = err?.message || 'request failed';
    logFlow({}, 'auth:get:error', { error: errMsg });
    throw errorWithCode('UNAVAILABLE', `SkyEye auth GET failed: ${errMsg}`);
  }

  collectCookiesFromResponse(res2, cookies);

  if (!res2.ok) {
    const text = await res2.text();
    throw errorWithCode('UNAVAILABLE', `SkyEye auth GET failed: ${res2.status} ${text}`);
  }

  const res2Body = await res2.text();

  // Parse csrf_token from HTML meta tag
  const csrfMatch = res2Body.match(/<meta\s+name="csrf-token"\s+content="([0-9a-fA-F]+)"/);
  const csrfToken = csrfMatch ? csrfMatch[1] : '';

  if (!csrfToken) {
    throw errorWithCode('PERMISSION_DENIED', 'Failed to obtain CSRF token from SkyEye auth response');
  }

  const cookieHeader = cookies.join('; ');

  const result = { csrfToken, cookieHeader, expiresAt: AUTH_CACHE_TTL_MS > 0 ? Date.now() + AUTH_CACHE_TTL_MS : 0 };
  if (AUTH_CACHE_TTL_MS > 0) authCache.set(cacheKey, result);
  return result;
};

const resolveAuth = async (ctx = {}) => {
  const bindings = ctx.bindings || {};
  const loginKey = resolveLoginKey(bindings);

  if (loginKey) {
    const domain = resolveDomain(bindings);
    if (!domain) throw errorWithCode('INVALID_ARGUMENT', 'skyeye_domain is required when using login_key');
    const userName = resolveUserName(bindings);
    const clientIdRandom = resolveClientIdRandom(bindings);
    const clientSecretRandom = resolveClientSecretRandom(bindings);
    const skipTlsVerify = Boolean(bindings.skipTlsVerify || bindings.tlsInsecureSkipVerify || bindings.insecureSkipVerify);
    const timeoutMs = resolveTimeoutMs(ctx);
    return authenticate(domain, loginKey, userName, clientIdRandom, clientSecretRandom, timeoutMs, skipTlsVerify);
  }

  // Legacy: static csrf_token without cookies
  const csrfToken = resolveCsrfToken(bindings);
  if (!csrfToken) {
    throw errorWithCode('INVALID_ARGUMENT', 'skyeye_login_key or skyeye_csrf_token is required in bindings');
  }
  return { csrfToken, cookieHeader: '', expiresAt: Infinity };
};

const withAuthRetry = async (callCtx, doFetch) => {
  let auth = await resolveAuth(callCtx);
  let result = await doFetch(auth);

  if ((result.httpStatus === 401 || result.httpStatus === 403) && resolveLoginKey(callCtx.bindings || {})) {
    const bindings = callCtx.bindings || {};
    const domain = resolveDomain(bindings);
    const loginKey = resolveLoginKey(bindings);
    if (domain && loginKey) authCache.delete(`${domain}:${loginKey}`);
    auth = await resolveAuth(callCtx);
    result = await doFetch(auth);
  }

  return result;
};

// ─── HTTP helpers ───

const encodeQueryPairs = (query = {}) => {
  const parts = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    const strVal = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(strVal)}`);
  }
  return parts.join('&');
};

const buildQueryUrl = (domain, path, query) => `${domain}${path}?${encodeQueryPairs(query)}`;

const buildAuthQuery = (csrfToken) => ({
  csrf_token: csrfToken,
  r: Math.random().toString(),
});

const fetchWithStatus = async (url, ctx = {}, extraHeaders = {}) => {
  const bindings = ctx.bindings || {};
  const timeoutMs = resolveTimeoutMs(ctx);
  const headers = { ...extraHeaders };
  try {
    const res = await httpRequest(url, {
      method: 'GET',
      headers,
      timeout: timeoutMs,
      rejectUnauthorized: shouldSkipTls(bindings) ? false : undefined,
    });
    const httpBody = await res.text();
    const httpStatus = Number(res.status || 0);
    logFlow(ctx, 'fetch:response', { path: new URL(url).pathname, httpStatus, bodyLength: httpBody?.length || 0 });
    return { httpStatus, httpBody };
  } catch (err) {
    const errMsg = err?.message || 'request failed';
    logFlow(ctx, 'fetch:error', { path: new URL(url).pathname, error: errMsg });
    return { httpStatus: 0, httpBody: errMsg };
  }
};

const mapHttpStatusToCode = (httpStatus) => {
  if (httpStatus === 401 || httpStatus === 403) return 'PERMISSION_DENIED';
  if (httpStatus >= 400 && httpStatus < 500) return 'FAILED_PRECONDITION';
  return 'UNAVAILABLE';
};

const parseSkyEyeResponse = (httpBody) => {
  try {
    const parsed = JSON.parse(httpBody);
    const outerStatus = Number(parsed.status ?? 0);
    const outerMessage = String(parsed.message ?? '');
    const dataObj = typeof parsed.data === 'object' && parsed.data !== null ? parsed.data : null;

    const innerStatus = dataObj ? Number(dataObj.status ?? 0) : 0;
    const innerMessage = dataObj ? String(dataObj.message ?? '') : '';

    const responseCode = outerStatus || innerStatus;
    const verboseMsg = outerMessage || innerMessage;

    let data = '';
    if (responseCode === outerStatus && outerStatus !== 0) {
      data = parsed.data !== undefined ? JSON.stringify(parsed.data) : '';
    } else if (responseCode === innerStatus && innerStatus !== 0) {
      if (dataObj.data !== undefined) {
        data = JSON.stringify(dataObj.data);
      } else {
        data = JSON.stringify(dataObj);
      }
    } else if (parsed.data !== undefined) {
      data = JSON.stringify(parsed.data);
    }

    return { responseCode, verboseMsg, data };
  } catch {
    throw errorWithCode('INTERNAL', 'SkyEye returned invalid JSON');
  }
};

const handleHttpResponse = (httpStatus, httpBody, ctx, action) => {
  if (httpStatus >= 200 && httpStatus < 300) {
    const parsed = parseSkyEyeResponse(httpBody);
    return { response_code: parsed.responseCode, verbose_msg: parsed.verboseMsg, data: parsed.data };
  }
  const code = mapHttpStatusToCode(httpStatus);
  throw errorWithCode(code, `SkyEye upstream returned HTTP ${httpStatus}`);
};

// ─── Method handlers ───

const handleQueryAlarmList = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const domain = requireDomain(callCtx);
  const staffName = requireStaffName(callCtx);
  const startTime = requireField(req, 'start_time');
  const endTime = requireField(req, 'end_time');
  const dataSource = toTrimmedString(reqField(req, 'data_source')) || '0';

  const { httpStatus, httpBody } = await withAuthRetry(callCtx, async (auth) => {
    const authQuery = buildAuthQuery(auth.csrfToken);
    const query = { ...authQuery, start_time: startTime, end_time: endTime, staff_name: staffName, data_source: dataSource };

  if (reqField(req, 'threat_type')) query.threat_type = toTrimmedString(reqField(req, 'threat_type'));
  if (reqField(req, 'threat_name')) query.threat_name = toTrimmedString(reqField(req, 'threat_name'));
  if (reqField(req, 'hazard_level') !== undefined && reqField(req, 'hazard_level') !== null) query.hazard_level = Number(reqField(req, 'hazard_level'));
  if (reqField(req, 'host_state')) query.host_state = toTrimmedString(reqField(req, 'host_state'));
  if (reqField(req, 'status')) query.status = toTrimmedString(reqField(req, 'status'));
  if (reqField(req, 'alarm_sip')) query.alarm_sip = toTrimmedString(reqField(req, 'alarm_sip'));
  if (reqField(req, 'attack_sip')) query.attack_sip = toTrimmedString(reqField(req, 'attack_sip'));
    if (reqField(req, 'attack_stage')) query.attack_stage = toTrimmedString(reqField(req, 'attack_stage'));
    if (reqField(req, 'asset_group')) query.asset_group = toTrimmedString(reqField(req, 'asset_group'));
    if (reqField(req, 'attack_dimension')) query.attack_dimension = toTrimmedString(reqField(req, 'attack_dimension'));
    if (reqField(req, 'alarm_id')) query.alarm_id = toTrimmedString(reqField(req, 'alarm_id'));
  if (reqField(req, 'focus_label')) query.focus_label = toTrimmedString(reqField(req, 'focus_label'));
  if (reqField(req, 'is_alarm_black_ip') !== undefined && reqField(req, 'is_alarm_black_ip') !== null) query.is_alarm_black_ip = Number(reqField(req, 'is_alarm_black_ip'));
  if (reqField(req, 'black_ip')) query.black_ip = toTrimmedString(reqField(req, 'black_ip'));
  if (reqField(req, 'is_white') !== undefined && reqField(req, 'is_white') !== null) query.is_white = Number(reqField(req, 'is_white'));
  if (reqField(req, 'is_accurate') !== undefined && reqField(req, 'is_accurate') !== null) query.is_accurate = Number(reqField(req, 'is_accurate'));
  if (reqField(req, 'offset') !== undefined && reqField(req, 'offset') !== null) query.offset = Number(reqField(req, 'offset'));
  if (reqField(req, 'limit') !== undefined && reqField(req, 'limit') !== null) query.limit = Number(reqField(req, 'limit'));
  if (reqField(req, 'order_by')) query.order_by = toTrimmedString(reqField(req, 'order_by'));

    const url = buildQueryUrl(domain, ALARM_LIST_HTTP_PATH, query);
    const extraHeaders = auth.cookieHeader ? { Cookie: auth.cookieHeader } : {};
    logFlow(callCtx, 'QueryAlarmList', { path: ALARM_LIST_HTTP_PATH });
    return fetchWithStatus(url, callCtx, extraHeaders);
  });
  return handleHttpResponse(httpStatus, httpBody, callCtx, 'QueryAlarmList');
};

const handleQueryAlarmPacket = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const domain = requireDomain(callCtx);
  const alarmSip = requireField(req, 'alarm_sip');
  const attackSip = requireField(req, 'attack_sip');
  const startTime = requireField(req, 'start_time');
  const endTime = requireField(req, 'end_time');
  const alarmId = requireField(req, 'alarm_id');

  const { httpStatus, httpBody } = await withAuthRetry(callCtx, async (auth) => {
    const authQuery = buildAuthQuery(auth.csrfToken);
    const query = { ...authQuery, alarm_sip: alarmSip, attack_sip: attackSip, start_time: startTime, end_time: endTime, alarm_id: alarmId };

    if (reqField(req, 'skyeye_type')) query.skyeye_type = toTrimmedString(reqField(req, 'skyeye_type'));
    if (reqField(req, 'ioc')) query.ioc = toTrimmedString(reqField(req, 'ioc'));
    if (reqField(req, 'branch_id')) query.branch_id = toTrimmedString(reqField(req, 'branch_id'));
    if (reqField(req, 'host_state')) query.host_state = toTrimmedString(reqField(req, 'host_state'));

    const url = buildQueryUrl(domain, ALARM_PACKET_HTTP_PATH, query);
    const extraHeaders = auth.cookieHeader ? { Cookie: auth.cookieHeader } : {};
    logFlow(callCtx, 'QueryAlarmPacket', { path: ALARM_PACKET_HTTP_PATH });
    return fetchWithStatus(url, callCtx, extraHeaders);
  });
  return handleHttpResponse(httpStatus, httpBody, callCtx, 'QueryAlarmPacket');
};

const handleDownloadAlarmPcap = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const domain = requireDomain(callCtx);
  const alarmSip = requireField(req, 'alarm_sip');
  const attackSip = requireField(req, 'attack_sip');
  const startTime = requireField(req, 'start_time');
  const endTime = requireField(req, 'end_time');

  const { httpStatus, httpBody } = await withAuthRetry(callCtx, async (auth) => {
    const authQuery = buildAuthQuery(auth.csrfToken);
    const query = { ...authQuery, alarm_sip: alarmSip, attack_sip: attackSip, start_time: startTime, end_time: endTime };

    if (reqField(req, 'skyeye_type')) query.skyeye_type = toTrimmedString(reqField(req, 'skyeye_type'));
    if (reqField(req, 'ioc')) query.ioc = toTrimmedString(reqField(req, 'ioc'));
    if (reqField(req, 'type')) query.type = toTrimmedString(reqField(req, 'type'));
    if (reqField(req, 'branch_id')) query.branch_id = toTrimmedString(reqField(req, 'branch_id'));

    const url = buildQueryUrl(domain, ALARM_PCAP_HTTP_PATH, query);
    const extraHeaders = auth.cookieHeader ? { Cookie: auth.cookieHeader } : {};
    logFlow(callCtx, 'DownloadAlarmPcap', { path: ALARM_PCAP_HTTP_PATH });
    return fetchWithStatus(url, callCtx, extraHeaders);
  });
  return handleHttpResponse(httpStatus, httpBody, callCtx, 'DownloadAlarmPcap');
};

const handleQueryNetworkLog = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const domain = requireDomain(callCtx);
  const startTime = requireField(req, 'start_time');
  const endTime = requireField(req, 'end_time');
  const index = requireField(req, 'index');
  const category = requireField(req, 'category');
  const mode = requireField(req, 'mode');
  const offset = requireField(req, 'offset');
  const limit = requireField(req, 'limit');

  const { httpStatus, httpBody } = await withAuthRetry(callCtx, async (auth) => {
    const authQuery = buildAuthQuery(auth.csrfToken);
    const query = { ...authQuery, start_time: startTime, end_time: endTime, index, category, mode, offset, limit };

    if (reqField(req, 'branch_id')) query.branch_id = toTrimmedString(reqField(req, 'branch_id'));
    if (reqField(req, 'keyword')) query.keyword = toTrimmedString(reqField(req, 'keyword'));
    if (reqField(req, 'asset_group_ids')) query.asset_group_ids = toTrimmedString(reqField(req, 'asset_group_ids'));
    if (reqField(req, 'stime')) query.stime = toTrimmedString(reqField(req, 'stime'));
    if (reqField(req, 'etime')) query.etime = toTrimmedString(reqField(req, 'etime'));
    if (reqField(req, 'interval')) query.interval = toTrimmedString(reqField(req, 'interval'));
    if (reqField(req, 'page')) query.page = toTrimmedString(reqField(req, 'page'));
    if (reqField(req, 'size')) query.size = toTrimmedString(reqField(req, 'size'));
    if (reqField(req, 'key_fields')) query.key_fields = toTrimmedString(reqField(req, 'key_fields'));
    if (reqField(req, 'graph_conf')) query.graph_conf = toTrimmedString(reqField(req, 'graph_conf'));
    if (reqField(req, 'curBranch')) query.curBranch = toTrimmedString(reqField(req, 'curBranch'));

    const url = buildQueryUrl(domain, NETWORK_LOG_HTTP_PATH, query);
    const extraHeaders = auth.cookieHeader ? { Cookie: auth.cookieHeader } : {};
    logFlow(callCtx, 'QueryNetworkLog', { path: NETWORK_LOG_HTTP_PATH });
    return fetchWithStatus(url, callCtx, extraHeaders);
  });
  return handleHttpResponse(httpStatus, httpBody, callCtx, 'QueryNetworkLog');
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_QUERY_ALARM_LIST_PATH]: async (req) => handleQueryAlarmList(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_QUERY_ALARM_PACKET_PATH]: async (req) => handleQueryAlarmPacket(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_DOWNLOAD_ALARM_PCAP_PATH]: async (req) => handleDownloadAlarmPcap(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_QUERY_NETWORK_LOG_PATH]: async (req) => handleQueryNetworkLog(req ?? callCtx.req ?? {}, callCtx),
  };
}

const adaptHandler = (fn) => (reqOrSdkArg, ctx) => {
  if (ctx !== undefined) return fn(reqOrSdkArg, ctx);
  if (reqOrSdkArg && typeof reqOrSdkArg === 'object' && 'request' in reqOrSdkArg) {
    const { request: req, ...rest } = reqOrSdkArg;
    return fn(req ?? {}, rest);
  }
  return fn(reqOrSdkArg, {});
};

export const handlers = {
  [METHOD_QUERY_ALARM_LIST_FULL]: adaptHandler(handleQueryAlarmList),
  [METHOD_QUERY_ALARM_PACKET_FULL]: adaptHandler(handleQueryAlarmPacket),
  [METHOD_DOWNLOAD_ALARM_PCAP_FULL]: adaptHandler(handleDownloadAlarmPcap),
  [METHOD_QUERY_NETWORK_LOG_FULL]: adaptHandler(handleQueryNetworkLog),
};

export const _test = {
  authenticate,
  authCache,
  buildAuthQuery,
  buildTlsOptions,
  collectCookiesFromResponse,
  encodeQueryPairs,
  buildQueryUrl,
  errorWithCode,
  fetchWithStatus,
  firstDefined,
  grpcCodeFor,
  handleHttpResponse,
  handleQueryAlarmList,
  handleQueryAlarmPacket,
  handleDownloadAlarmPcap,
  handleQueryNetworkLog,
  hasOwn,
  logFlow,
  mapHttpStatusToCode,
  mergedBindings,
  normalizeBaseUrl,
  parseSkyEyeResponse,
  requireDomain,
  requireField,
  resolveAuth,
  resolveCallContext,
  resolveCsrfToken,
  resolveDomain,
  resolveLoginKey,
  resolveStaffName,
  resolveUserName,
  resolveClientIdRandom,
  resolveClientSecretRandom,
  resolveTimeoutMs,
  reqField,
  toTrimmedString,
  unwrapScalar,
  withAuthRetry,
};
