import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const PKG = 'H3C_SECPATH';
const P = `/${PKG}.${PKG}/`;

const PATHS = {
  GET_DEVICE_BASE:              `${P}GetDeviceBase`,
  GET_SECURITY_ZONES:           `${P}GetSecurityZones`,
  GET_ZONE_PAIRS:               `${P}GetZonePairs`,
  GET_IPV4_SECURITY_POLICIES:   `${P}GetIPv4SecurityPolicies`,
  GET_IPV4_OBJECT_GROUPS:       `${P}GetIPv4ObjectGroups`,
  GET_SERVICE_GROUPS:           `${P}GetServiceGroups`,
  GET_SESSIONS:                 `${P}GetSessions`,
  GET_INTERFACES:               `${P}GetInterfaces`,
  GET_ACL_GROUPS:               `${P}GetACLGroups`,
  GET_NAT_STATIC_MAPPINGS:      `${P}GetNATStaticMappings`,
};

const API_PATHS = {
  deviceBase:             '/restconf/data/comware-device:Device/Base',
  securityZones:          '/restconf/data/comware-securityzone:SecurityZone/Zones',
  zonePairs:              '/restconf/data/comware-securityzone:SecurityZone/ZonePairs',
  ipv4SecurityPolicies:   '/restconf/data/comware-securitypolicies:SecurityPolicies/IPv4Rules',
  ipv4ObjectGroups:       '/restconf/data/comware-oms:OMS/IPv4Groups',
  serviceGroups:          '/restconf/data/comware-oms:OMS/ServGroups',
  sessions:               '/restconf/data/comware-session:SESSION/Sessions',
  interfaces:             '/restconf/data/comware-ifmgr:Ifmgr/Interfaces',
  aclGroups:              '/restconf/data/comware-acl:ACL/Groups',
  natStaticMappings:      '/restconf/data/comware-nat:NAT/Static/StaticMappings',
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

const firstDefined = (...vals) => vals.find((v) => v !== undefined && v !== null);

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.secret ?? {}),
  ...(ctx?.bindings ?? {}),
});

const normalizeBaseUrl = (url) => {
  const s = String(url ?? '').trim().replace(/\/+$/, '');
  if (!s || !/^https?:\/\//i.test(s)) return null;
  return s;
};

const extractList = (obj) => {
  if (Array.isArray(obj)) return obj;
  if (obj !== null && typeof obj === 'object') {
    for (const v of Object.values(obj)) {
      const found = extractList(v);
      if (found.length > 0 || Array.isArray(v)) return found;
    }
  }
  return [];
};

const extractFirstObject = (obj) => {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return null;
  for (const v of Object.values(obj)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) return v;
  }
  return obj;
};

export function rpcdef(ctx) {
  const bindings = mergedBindings(ctx);

  const baseUrl = () => {
    const raw = firstDefined(bindings.host, bindings.baseUrl, bindings.restBaseUrl);
    let u = normalizeBaseUrl(raw);
    if (!u) {
      const h = String(raw ?? '').trim();
      if (h) u = `https://${h}`;
    }
    if (!u) throw err('INVALID_ARGUMENT', 'config.host is required (e.g. https://10.0.0.1)');
    return u;
  };

  const authHeader = () => {
    const username = String(firstDefined(bindings.username, bindings.user) ?? '').trim();
    const password = String(firstDefined(bindings.password) ?? '').trim();
    if (!username) throw err('INVALID_ARGUMENT', 'secret.username is required');
    if (!password) throw err('INVALID_ARGUMENT', 'secret.password is required');
    return 'Basic ' + Buffer.from(username + ':' + password).toString('base64');
  };

  const doFetch = async (url, init) => {
    try {
      return await fetch(url, init);
    } catch (e) {
      throw err('UNAVAILABLE', e?.cause?.message || e?.message || 'fetch failed');
    }
  };

  const pullList = async (apiPath, queryParams) => {
    const base = baseUrl();
    const auth = authHeader();
    const qs = queryParams ? `?${queryParams.toString()}` : '';
    const res = await doFetch(`${base}${apiPath}${qs}`, {
      headers: { Authorization: auth, Accept: 'application/json' },
    });

    let text;
    try { text = await res.text(); } catch { throw err('UNKNOWN', 'failed to read response body'); }

    if (res.status === 401) throw err('PERMISSION_DENIED', `http 401: ${text}`);
    if (res.status === 403) throw err('PERMISSION_DENIED', `http 403: ${text}`);
    if (res.status === 404) return { items: [], count: 0 };
    if (res.status >= 500) throw err('UNAVAILABLE', `http ${res.status}: ${text}`);

    if (!text.trim()) throw err('UNKNOWN', 'empty response body');
    let json;
    try { json = JSON.parse(text); } catch { throw err('UNKNOWN', 'response is not valid JSON'); }

    const items = extractList(json);
    return { items: items.map(toValue), count: items.length };
  };

  const pullDeviceBase = async (apiPath) => {
    const base = baseUrl();
    const auth = authHeader();
    const res = await doFetch(`${base}${apiPath}`, {
      headers: { Authorization: auth, Accept: 'application/json' },
    });

    let text;
    try { text = await res.text(); } catch { throw err('UNKNOWN', 'failed to read response body'); }

    if (res.status === 401) throw err('PERMISSION_DENIED', `http 401: ${text}`);
    if (res.status === 403) throw err('PERMISSION_DENIED', `http 403: ${text}`);
    if (res.status >= 500) throw err('UNAVAILABLE', `http ${res.status}: ${text}`);

    if (!text.trim()) throw err('UNKNOWN', 'empty response body');
    let json;
    try { json = JSON.parse(text); } catch { throw err('UNKNOWN', 'response is not valid JSON'); }

    const first = extractFirstObject(json) ?? json;
    const info = extractFirstObject(first) ?? first;
    return { info: toValue(info) };
  };

  const callGetDeviceBase            = () => pullDeviceBase(API_PATHS.deviceBase);
  const callGetSecurityZones         = () => pullList(API_PATHS.securityZones);
  const callGetZonePairs             = () => pullList(API_PATHS.zonePairs);
  const callGetIPv4SecurityPolicies  = (req) => {
    const pageSize = req?.page_size != null ? req.page_size : undefined;
    const params = pageSize != null ? new URLSearchParams({ page_size: String(pageSize) }) : undefined;
    return pullList(API_PATHS.ipv4SecurityPolicies, params);
  };
  const callGetIPv4ObjectGroups      = () => pullList(API_PATHS.ipv4ObjectGroups);
  const callGetServiceGroups         = () => pullList(API_PATHS.serviceGroups);
  const callGetSessions              = (req) => {
    const maxCount = req?.max_count != null ? req.max_count : undefined;
    const params = maxCount != null ? new URLSearchParams({ maxCount: String(maxCount) }) : undefined;
    return pullList(API_PATHS.sessions, params);
  };
  const callGetInterfaces            = () => pullList(API_PATHS.interfaces);
  const callGetACLGroups             = () => pullList(API_PATHS.aclGroups);
  const callGetNATStaticMappings     = () => pullList(API_PATHS.natStaticMappings);

  return {
    [PATHS.GET_DEVICE_BASE]:            async () => callGetDeviceBase(),
    [PATHS.GET_SECURITY_ZONES]:         async () => callGetSecurityZones(),
    [PATHS.GET_ZONE_PAIRS]:             async () => callGetZonePairs(),
    [PATHS.GET_IPV4_SECURITY_POLICIES]: async () => callGetIPv4SecurityPolicies(ctx.req),
    [PATHS.GET_IPV4_OBJECT_GROUPS]:     async () => callGetIPv4ObjectGroups(),
    [PATHS.GET_SERVICE_GROUPS]:         async () => callGetServiceGroups(),
    [PATHS.GET_SESSIONS]:               async () => callGetSessions(ctx.req),
    [PATHS.GET_INTERFACES]:             async () => callGetInterfaces(),
    [PATHS.GET_ACL_GROUPS]:             async () => callGetACLGroups(),
    [PATHS.GET_NAT_STATIC_MAPPINGS]:    async () => callGetNATStaticMappings(),
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

export const _test = { toValue, normalizeBaseUrl, extractList, PATHS, API_PATHS };
