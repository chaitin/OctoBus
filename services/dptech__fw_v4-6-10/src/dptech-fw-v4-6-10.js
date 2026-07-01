import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const DEFAULT_TIMEOUT_MS = 3000;
export const FIXED_IP_VERSION = '4';
export const FIXED_VSYS_NAME = 'PublicSystem';
export const GET_PACKET_FILTER_STATUS_PATH = '/DPtech_FW_V4610.DPtech_FW_V4610/GetPacketFilterStatus';
export const ENABLE_PACKET_FILTER_IMMEDIATE_PATH = '/DPtech_FW_V4610.DPtech_FW_V4610/EnablePacketFilterImmediate';
export const LIST_ADDRESS_GROUPS_PATH = '/DPtech_FW_V4610.DPtech_FW_V4610/ListAddressGroups';
export const CREATE_ADDRESS_GROUP_PATH = '/DPtech_FW_V4610.DPtech_FW_V4610/CreateAddressGroup';
export const UPDATE_ADDRESS_GROUP_PATH = '/DPtech_FW_V4610.DPtech_FW_V4610/UpdateAddressGroup';
export const DELETE_ADDRESS_GROUP_PATH = '/DPtech_FW_V4610.DPtech_FW_V4610/DeleteAddressGroup';
export const GET_SECURITY_POLICY_PATH = '/DPtech_FW_V4610.DPtech_FW_V4610/GetSecurityPolicy';
export const CREATE_SECURITY_POLICY_PATH = '/DPtech_FW_V4610.DPtech_FW_V4610/CreateSecurityPolicy';
export const UPDATE_SECURITY_POLICY_PATH = '/DPtech_FW_V4610.DPtech_FW_V4610/UpdateSecurityPolicy';
export const DELETE_SECURITY_POLICY_PATH = '/DPtech_FW_V4610.DPtech_FW_V4610/DeleteSecurityPolicy';

export const METHOD_GET_PACKET_FILTER_STATUS_FULL = 'DPtech_FW_V4610.DPtech_FW_V4610/GetPacketFilterStatus';
export const METHOD_ENABLE_PACKET_FILTER_IMMEDIATE_FULL = 'DPtech_FW_V4610.DPtech_FW_V4610/EnablePacketFilterImmediate';
export const METHOD_LIST_ADDRESS_GROUPS_FULL = 'DPtech_FW_V4610.DPtech_FW_V4610/ListAddressGroups';
export const METHOD_CREATE_ADDRESS_GROUP_FULL = 'DPtech_FW_V4610.DPtech_FW_V4610/CreateAddressGroup';
export const METHOD_UPDATE_ADDRESS_GROUP_FULL = 'DPtech_FW_V4610.DPtech_FW_V4610/UpdateAddressGroup';
export const METHOD_DELETE_ADDRESS_GROUP_FULL = 'DPtech_FW_V4610.DPtech_FW_V4610/DeleteAddressGroup';
export const METHOD_GET_SECURITY_POLICY_FULL = 'DPtech_FW_V4610.DPtech_FW_V4610/GetSecurityPolicy';
export const METHOD_CREATE_SECURITY_POLICY_FULL = 'DPtech_FW_V4610.DPtech_FW_V4610/CreateSecurityPolicy';
export const METHOD_UPDATE_SECURITY_POLICY_FULL = 'DPtech_FW_V4610.DPtech_FW_V4610/UpdateSecurityPolicy';
export const METHOD_DELETE_SECURITY_POLICY_FULL = 'DPtech_FW_V4610.DPtech_FW_V4610/DeleteSecurityPolicy';
let insecureDispatcherPromise;

const JSON_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json',
};

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), message);
  err.legacyCode = code;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const firstDefined = (...vals) => vals.find((val) => val !== undefined && val !== null);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) {
    return unwrapScalar(value.value);
  }
  return String(value);
};

const pickString = (source, keys) => {
  for (const key of keys) {
    if (hasOwn(source, key)) {
      const value = unwrapScalar(source[key]).trim();
      if (value) return value;
    }
  }
  return '';
};

const toValue = (val) => {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'boolean') return { boolValue: val };
  if (typeof val === 'number') return Number.isFinite(val) ? { numberValue: val } : { stringValue: String(val) };
  if (Array.isArray(val)) {
    return {
      listValue: {
        values: val.map((item) => toValue(item) ?? { nullValue: 'NULL_VALUE' }),
      },
    };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [key, value] of Object.entries(val)) {
      fields[key] = toValue(value) ?? { nullValue: 'NULL_VALUE' };
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(val) };
};

const utf8Bytes = (value, options = {}) => {
  if (!options.forceFallback && typeof TextEncoder !== 'undefined') {
    return Array.from(new TextEncoder().encode(value));
  }
  const bytes = [];
  for (let i = 0; i < value.length; i += 1) {
    let codePoint = value.charCodeAt(i);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = ((codePoint - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
        i += 1;
      }
    }
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6));
      bytes.push(0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(0xe0 | (codePoint >> 12));
      bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
      bytes.push(0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(0xf0 | (codePoint >> 18));
      bytes.push(0x80 | ((codePoint >> 12) & 0x3f));
      bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
      bytes.push(0x80 | (codePoint & 0x3f));
    }
  }
  return bytes;
};

const encodeBase64 = (value, options = {}) => {
  if (!options.forceFallback && typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'utf8').toString('base64');
  }
  const bytes = utf8Bytes(value, options);
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triplet = (b0 << 16) | (b1 << 8) | b2;
    output += BASE64_ALPHABET[(triplet >> 18) & 0x3f];
    output += BASE64_ALPHABET[(triplet >> 12) & 0x3f];
    output += i + 1 < bytes.length ? BASE64_ALPHABET[(triplet >> 6) & 0x3f] : '=';
    output += i + 2 < bytes.length ? BASE64_ALPHABET[triplet & 0x3f] : '=';
  }
  return output;
};

const normalizeBaseUrl = (value) => {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.replace(/\/+$/, '');
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.secret ?? {}),
  ...(ctx?.bindings ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.req ?? ctx.request ?? {},
});

const resolveHost = (bindings) => {
  for (const key of ['host', 'restBaseUrl', 'rest_base_url', 'baseUrl', 'base_url', 'endpoint']) {
    const value = normalizeBaseUrl(bindings?.[key]);
    if (value) return value;
  }
  return '';
};
const resolveUser = (bindings) => pickString(bindings || {}, ['user', 'username']);
const resolvePassword = (bindings) => pickString(bindings || {}, ['password', 'pass', 'secret']);

const resolveTimeoutMs = (ctx) => {
  const bindings = mergedBindings(ctx);
  const raw = Number(firstDefined(ctx?.limits?.timeoutMs, bindings.timeoutMs, bindings.timeout_ms, DEFAULT_TIMEOUT_MS));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

const shouldSkipTlsVerify = (bindings) => Boolean(bindings?.skipTlsVerify || bindings?.tlsInsecureSkipVerify || bindings?.insecureSkipVerify);

const createTlsDispatcher = async (skipTlsVerify) => {
  if (!skipTlsVerify) return undefined;
  insecureDispatcherPromise ??= import('undici').then(({ Agent }) => new Agent({
    connect: { rejectUnauthorized: false },
  }));
  return insecureDispatcherPromise;
};

const buildTlsOptions = async (bindings) => {
  const dispatcher = await createTlsDispatcher(shouldSkipTlsVerify(bindings));
  return dispatcher ? { dispatcher } : {};
};

const fetchWithTimeout = async (url, init = {}, options = {}) => {
  const rawTimeout = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const parentSignal = init.signal;
  const abortFromParent = () => controller.abort(parentSignal.reason);
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else if (typeof parentSignal.addEventListener === 'function') {
      parentSignal.addEventListener('abort', abortFromParent, { once: true });
    }
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const tlsOptions = await buildTlsOptions(options.bindings);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      ...tlsOptions,
    });
  } finally {
    clearTimeout(timer);
    if (parentSignal && typeof parentSignal.removeEventListener === 'function') {
      parentSignal.removeEventListener('abort', abortFromParent);
    }
  }
};

const buildAuthHeader = (bindings) => {
  const user = resolveUser(bindings);
  const password = resolvePassword(bindings);
  if (!user) throw errorWithCode('INVALID_ARGUMENT', 'bindings.user is required');
  if (!password) throw errorWithCode('INVALID_ARGUMENT', 'bindings.password is required');
  return `Basic ${encodeBase64(`${user}:${password}`)}`;
};

const buildHeaders = (bindings, extra = {}) => ({
  'content-type': 'application/json',
  accept: 'application/json',
  authorization: buildAuthHeader(bindings),
  ...(bindings?.headers || {}),
  ...extra,
});

const buildUrl = (baseUrl, path, query = {}) => {
  const normalizedBase = String(baseUrl || '').replace(/\/+$/, '');
  const normalizedPath = String(path || '').replace(/^\/+/, '');
  const pairs = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  const joined = `${normalizedBase}/${normalizedPath}`;
  return pairs.length === 0 ? joined : `${joined}?${pairs.join('&')}`;
};

const tryParseJson = (text) => {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
};

const throwStructuredError = (code, message, options = {}) => {
  const rawBody = String(options.rawBody ?? '');
  const payload = {
    code,
    message,
    http_status: Number(options.httpStatus ?? 0),
    raw_body: '',
    raw_body_length: rawBody.length,
  };
  if (options.reason) payload.reason = String(options.reason);
  if (options.ret !== undefined) payload.ret = String(options.ret);
  throw errorWithCode(code, JSON.stringify(payload));
};

const throwForHttpStatus = (status, rawBody) => {
  const parsed = String(rawBody || '').trim() ? tryParseJson(rawBody) : { ok: false };
  const options = {
    httpStatus: status,
    rawBody,
    rawJson: parsed.ok ? parsed.value : undefined,
    reason: 'http status is not 2xx',
  };
  if (status === 401 || status === 403) {
    throwStructuredError('PERMISSION_DENIED', 'dptech upstream permission denied', options);
  }
  if (status >= 400 && status < 500) {
    throwStructuredError('FAILED_PRECONDITION', 'dptech upstream client error', options);
  }
  throwStructuredError('UNAVAILABLE', 'dptech upstream unavailable', options);
};

const fetchUpstream = async (ctx, path, init = {}, query = {}) => {
  const bindings = mergedBindings(ctx);
  const host = resolveHost(bindings);
  if (!host) throw errorWithCode('INVALID_ARGUMENT', 'bindings.host is required');
  const url = buildUrl(host, path, query);
  const timeoutMs = resolveTimeoutMs(ctx);
  let res;
  try {
    res = await fetchWithTimeout(url, {
      ...init,
      headers: buildHeaders(bindings, init.headers || {}),
    }, { timeoutMs, bindings });
  } catch (err) {
    throwStructuredError('UNAVAILABLE', 'dptech upstream request failed', {
      httpStatus: 0,
      rawBody: '',
      reason: err?.cause?.message || err?.message || 'fetch failed',
    });
  }
  const rawBody = await res.text();
  if (!res.ok) {
    throwForHttpStatus(res.status, rawBody);
  }
  const trimmed = String(rawBody || '').trim();
  if (!trimmed) {
    return { httpStatus: res.status, rawBody: '', json: undefined };
  }
  const parsed = tryParseJson(trimmed);
  if (!parsed.ok) {
    if (init?.allowNonJsonOk) {
      return { httpStatus: res.status, rawBody: trimmed, json: undefined };
    }
    throwStructuredError('UNKNOWN', 'dptech response is not valid JSON', {
      httpStatus: res.status,
      rawBody: trimmed,
      reason: 'response is not valid JSON',
    });
  }
  return { httpStatus: res.status, rawBody: trimmed, json: parsed.value };
};

const successResponse = (httpStatus, rawBody, json, extra = {}) => ({
  http_status: Number(httpStatus),
  ret: json && hasOwn(json, 'ret') ? unwrapScalar(json.ret) : '',
  raw_body: '',
  raw_json: undefined,
  ...extra,
});

const assertBusinessRetZero = (result, message, allowEmpty = false) => {
  if (!result) {
    throwStructuredError('UNKNOWN', message, { httpStatus: 0, rawBody: '', reason: 'missing response' });
  }
  if (!result.rawBody && allowEmpty) return;
  if (!result.json) {
    if (allowEmpty && !result.rawBody) return;
    throwStructuredError('UNKNOWN', message, {
      httpStatus: result.httpStatus,
      rawBody: result.rawBody,
      reason: 'missing json body',
    });
  }
  const ret = unwrapScalar(result.json?.ret);
  if (ret === '0') return;
  throwStructuredError('FAILED_PRECONDITION', message, {
    httpStatus: result.httpStatus,
    rawBody: result.rawBody,
    rawJson: result.json,
    ret,
    reason: 'ret != 0',
  });
};

const requireString = (value, fieldName) => {
  const raw = String(unwrapScalar(value) || '').trim();
  if (!raw) throw errorWithCode('INVALID_ARGUMENT', `${fieldName} is required`);
  return raw;
};

const isIPv4 = (value) => {
  const parts = String(value || '').trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
};

const isIPv4Cidr = (value) => {
  const raw = String(value || '').trim();
  const [ip, prefix] = raw.split('/');
  if (!ip || prefix === undefined) return false;
  if (!isIPv4(ip)) return false;
  if (!/^\d+$/.test(prefix)) return false;
  const num = Number(prefix);
  return num >= 0 && num <= 32;
};

const normalizeCidr = (value) => {
  const raw = String(value || '').trim();
  if (!raw) throw errorWithCode('INVALID_ARGUMENT', 'ip_cidrs item is required');
  if (isIPv4(raw)) return `${raw}/32`;
  if (isIPv4Cidr(raw)) return raw;
  throw errorWithCode('INVALID_ARGUMENT', `invalid ipv4/cidr value: ${raw}`);
};

const readRepeatedStrings = (value) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray(value.values)) return value.values.map((item) => unwrapScalar(item));
  return [];
};

const normalizeCidrs = (values) => {
  const list = readRepeatedStrings(values);
  if (list.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'ip_cidrs is required');
  return list.map(normalizeCidr);
};

const normalizeEnabled = (value) => (Boolean(value) ? '1' : '0');

const joinNames = (values, fieldName) => {
  const list = readRepeatedStrings(values).map((item) => String(item || '').trim()).filter(Boolean);
  if (list.length === 0) throw errorWithCode('INVALID_ARGUMENT', `${fieldName} is required`);
  return list.join(',');
};

const toAddressGroupItems = (json) => {
  const value = json?.netaddrobjlist;
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((item) => ({
    name: unwrapScalar(item?.name),
    ip: unwrapScalar(item?.ip),
    description: unwrapScalar(firstDefined(item?.desc, item?.description)),
  }));
};

const toSecurityPolicyItems = (json) => {
  const value = json?.securitypolicylist;
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((item) => ({
    name: unwrapScalar(item?.name),
    enabled: unwrapScalar(item?.enabled),
    action: unwrapScalar(item?.action),
    source_ip_objects: unwrapScalar(firstDefined(item?.sourceIpObjects, item?.sourceIpGroups)),
  }));
};

const handleGetPacketFilterStatus = async (req, ctx) => {
  const result = await fetchUpstream(ctx, '/func/web_main/api/system/sysinfolist/pfInEfList', { method: 'GET' }, { ipVersion: FIXED_IP_VERSION });
  assertBusinessRetZero(result, 'dptech packet filter status query failed');
  return successResponse(result.httpStatus, result.rawBody, result.json, {
    enable: unwrapScalar(result.json?.pfInEfList?.enable),
    ip_version: unwrapScalar(result.json?.pfInEfList?.ipVersion),
  });
};

const handleEnablePacketFilterImmediate = async (req, ctx) => {
  const result = await fetchUpstream(ctx, '/func/web_main/api/system/sysinfolist/pfInEfList', {
    method: 'PUT',
    body: JSON.stringify({ pfInEfList: { ipVersion: FIXED_IP_VERSION, enable: 'true' } }),
  });
  assertBusinessRetZero(result, 'dptech enable packet filter immediate failed');
  return successResponse(result.httpStatus, result.rawBody, result.json);
};

const handleListAddressGroups = async (req, ctx) => {
  const searchValue = requireString(firstDefined(req?.search_value, req?.searchValue), 'search_value');
  const result = await fetchUpstream(ctx, '/func/web_main/api/netaddr/netaddr_obj/netaddrobjlist', { method: 'GET' }, {
    ipVersion: FIXED_IP_VERSION,
    vsysName: FIXED_VSYS_NAME,
    searchValue,
  });
  assertBusinessRetZero(result, 'dptech list address groups failed');
  return successResponse(result.httpStatus, result.rawBody, result.json, { items: toAddressGroupItems(result.json) });
};

const handleCreateAddressGroup = async (req, ctx) => {
  const groupName = requireString(firstDefined(req?.group_name, req?.groupName), 'group_name');
  const ipText = normalizeCidrs(firstDefined(req?.ip_cidrs, req?.ipCidrs)).join(',');
  const description = unwrapScalar(req?.description);
  const result = await fetchUpstream(ctx, '/func/web_main/api/netaddr/netaddr_obj/netaddrobjlist', {
    method: 'POST',
    body: JSON.stringify({
      netaddrobjlist: {
        ipVersion: FIXED_IP_VERSION,
        vsysName: FIXED_VSYS_NAME,
        name: groupName,
        desc: description,
        ip: ipText,
        expIp: '',
      },
    }),
  });
  assertBusinessRetZero(result, 'dptech create address group failed');
  return successResponse(result.httpStatus, result.rawBody, result.json);
};

const handleUpdateAddressGroup = async (req, ctx) => {
  const oldGroupName = requireString(firstDefined(req?.old_group_name, req?.oldGroupName), 'old_group_name');
  const newGroupName = requireString(firstDefined(req?.new_group_name, req?.newGroupName), 'new_group_name');
  const ipText = normalizeCidrs(firstDefined(req?.ip_cidrs, req?.ipCidrs)).join(',');
  const description = unwrapScalar(req?.description);
  const result = await fetchUpstream(ctx, '/func/web_main/api/netaddr/netaddr_obj/netaddrobjlist', {
    method: 'PUT',
    allowNonJsonOk: true,
    body: JSON.stringify({
      netaddrobjlist: {
        ipVersion: FIXED_IP_VERSION,
        vsysName: FIXED_VSYS_NAME,
        name: newGroupName,
        oldName: oldGroupName,
        desc: description,
        ip: ipText,
        expIp: '',
      },
    }),
  });
  if (!result.rawBody) return successResponse(result.httpStatus, result.rawBody, result.json);
  if (!result.json && /Duplicate IP address ranges\./i.test(result.rawBody)) {
    return successResponse(result.httpStatus, result.rawBody, undefined);
  }
  assertBusinessRetZero(result, 'dptech update address group failed');
  return successResponse(result.httpStatus, result.rawBody, result.json);
};

const handleDeleteAddressGroup = async (req, ctx) => {
  const groupName = requireString(firstDefined(req?.group_name, req?.groupName), 'group_name');
  const result = await fetchUpstream(ctx, '/func/web_main/api/netaddr/netaddr_obj/netaddrobjlist', {
    method: 'DELETE',
    body: JSON.stringify({ netaddrobjlist: { ipVersion: FIXED_IP_VERSION, vsysName: FIXED_VSYS_NAME, name: groupName } }),
  });
  assertBusinessRetZero(result, 'dptech delete address group failed');
  return successResponse(result.httpStatus, result.rawBody, result.json);
};

const handleGetSecurityPolicy = async (req, ctx) => {
  const policyName = requireString(firstDefined(req?.policy_name, req?.policyName), 'policy_name');
  const result = await fetchUpstream(ctx, '/func/web_main/api/pf_policy/pf_policy/pf_policy/securitypolicylist', { method: 'GET' }, {
    ipVersion: FIXED_IP_VERSION,
    vsysName: FIXED_VSYS_NAME,
    name: policyName,
  });
  assertBusinessRetZero(result, 'dptech get security policy failed');
  return successResponse(result.httpStatus, result.rawBody, result.json, { items: toSecurityPolicyItems(result.json) });
};

const handleCreateSecurityPolicy = async (req, ctx) => {
  const policyName = requireString(firstDefined(req?.policy_name, req?.policyName), 'policy_name');
  const action = requireString(req?.action, 'action');
  const sourceIpGroups = joinNames(firstDefined(req?.source_ip_names, req?.sourceIpNames), 'source_ip_names');
  const result = await fetchUpstream(ctx, '/func/web_main/api/pf_policy/pf_policy/pf_policy/securitypolicylist', {
    method: 'POST',
    body: JSON.stringify({
      securitypolicylist: {
        ipVersion: FIXED_IP_VERSION,
        vsysName: FIXED_VSYS_NAME,
        name: policyName,
        enabled: normalizeEnabled(req?.enabled),
        action,
        oldName: '',
        sourceIpGroups,
      },
    }),
  });
  assertBusinessRetZero(result, 'dptech create security policy failed');
  return successResponse(result.httpStatus, result.rawBody, result.json);
};

const handleUpdateSecurityPolicy = async (req, ctx) => {
  const oldPolicyName = requireString(firstDefined(req?.old_policy_name, req?.oldPolicyName), 'old_policy_name');
  const newPolicyName = requireString(firstDefined(req?.new_policy_name, req?.newPolicyName), 'new_policy_name');
  const action = requireString(req?.action, 'action');
  const sourceIpObjects = joinNames(firstDefined(req?.source_ip_names, req?.sourceIpNames), 'source_ip_names');
  const result = await fetchUpstream(ctx, '/func/web_main/api/pf_policy/pf_policy/pf_policy/securitypolicylist', {
    method: 'PUT',
    body: JSON.stringify({
      securitypolicylist: {
        ipVersion: FIXED_IP_VERSION,
        vsysName: FIXED_VSYS_NAME,
        name: newPolicyName,
        enabled: normalizeEnabled(req?.enabled),
        action,
        oldName: oldPolicyName,
        sourceIpObjects,
      },
    }),
  });
  if (!result.rawBody) return successResponse(result.httpStatus, result.rawBody, result.json);
  assertBusinessRetZero(result, 'dptech update security policy failed');
  return successResponse(result.httpStatus, result.rawBody, result.json);
};

const handleDeleteSecurityPolicy = async (req, ctx) => {
  const policyName = requireString(firstDefined(req?.policy_name, req?.policyName), 'policy_name');
  const result = await fetchUpstream(ctx, '/func/web_main/api/pf_policy/pf_policy/pf_policy/securitypolicylist', {
    method: 'DELETE',
    body: JSON.stringify({ securitypolicylist: { ipVersion: FIXED_IP_VERSION, vsysName: FIXED_VSYS_NAME, name: policyName } }),
  });
  assertBusinessRetZero(result, 'dptech delete security policy failed');
  return successResponse(result.httpStatus, result.rawBody, result.json);
};

const registerHandlers = (ctx) => {
  const callCtx = resolveCallContext(ctx);
  return {
    [GET_PACKET_FILTER_STATUS_PATH]: (req = callCtx.req) => handleGetPacketFilterStatus(req ?? {}, callCtx),
    [ENABLE_PACKET_FILTER_IMMEDIATE_PATH]: (req = callCtx.req) => handleEnablePacketFilterImmediate(req ?? {}, callCtx),
    [LIST_ADDRESS_GROUPS_PATH]: (req = callCtx.req) => handleListAddressGroups(req ?? {}, callCtx),
    [CREATE_ADDRESS_GROUP_PATH]: (req = callCtx.req) => handleCreateAddressGroup(req ?? {}, callCtx),
    [UPDATE_ADDRESS_GROUP_PATH]: (req = callCtx.req) => handleUpdateAddressGroup(req ?? {}, callCtx),
    [DELETE_ADDRESS_GROUP_PATH]: (req = callCtx.req) => handleDeleteAddressGroup(req ?? {}, callCtx),
    [GET_SECURITY_POLICY_PATH]: (req = callCtx.req) => handleGetSecurityPolicy(req ?? {}, callCtx),
    [CREATE_SECURITY_POLICY_PATH]: (req = callCtx.req) => handleCreateSecurityPolicy(req ?? {}, callCtx),
    [UPDATE_SECURITY_POLICY_PATH]: (req = callCtx.req) => handleUpdateSecurityPolicy(req ?? {}, callCtx),
    [DELETE_SECURITY_POLICY_PATH]: (req = callCtx.req) => handleDeleteSecurityPolicy(req ?? {}, callCtx),
  };
};

export function rpcdef(ctx = {}) {
  return registerHandlers(ctx);
}

const callSdkHandler = (ctx, path) => registerHandlers(ctx)[path](ctx?.req ?? ctx?.request ?? {});

export const handlers = {
  [METHOD_GET_PACKET_FILTER_STATUS_FULL]: (ctx) => callSdkHandler(ctx, GET_PACKET_FILTER_STATUS_PATH),
  [METHOD_ENABLE_PACKET_FILTER_IMMEDIATE_FULL]: (ctx) => callSdkHandler(ctx, ENABLE_PACKET_FILTER_IMMEDIATE_PATH),
  [METHOD_LIST_ADDRESS_GROUPS_FULL]: (ctx) => callSdkHandler(ctx, LIST_ADDRESS_GROUPS_PATH),
  [METHOD_CREATE_ADDRESS_GROUP_FULL]: (ctx) => callSdkHandler(ctx, CREATE_ADDRESS_GROUP_PATH),
  [METHOD_UPDATE_ADDRESS_GROUP_FULL]: (ctx) => callSdkHandler(ctx, UPDATE_ADDRESS_GROUP_PATH),
  [METHOD_DELETE_ADDRESS_GROUP_FULL]: (ctx) => callSdkHandler(ctx, DELETE_ADDRESS_GROUP_PATH),
  [METHOD_GET_SECURITY_POLICY_FULL]: (ctx) => callSdkHandler(ctx, GET_SECURITY_POLICY_PATH),
  [METHOD_CREATE_SECURITY_POLICY_FULL]: (ctx) => callSdkHandler(ctx, CREATE_SECURITY_POLICY_PATH),
  [METHOD_UPDATE_SECURITY_POLICY_FULL]: (ctx) => callSdkHandler(ctx, UPDATE_SECURITY_POLICY_PATH),
  [METHOD_DELETE_SECURITY_POLICY_FULL]: (ctx) => callSdkHandler(ctx, DELETE_SECURITY_POLICY_PATH),
};

export const _test = {
  assertBusinessRetZero,
  buildAuthHeader,
  buildHeaders,
  buildTlsOptions,
  buildUrl,
  createTlsDispatcher,
  encodeBase64,
  errorWithCode,
  fetchWithTimeout,
  fetchUpstream,
  firstDefined,
  handleCreateAddressGroup,
  handleCreateSecurityPolicy,
  handleDeleteAddressGroup,
  handleDeleteSecurityPolicy,
  handleEnablePacketFilterImmediate,
  handleGetPacketFilterStatus,
  handleGetSecurityPolicy,
  handleListAddressGroups,
  handleUpdateAddressGroup,
  handleUpdateSecurityPolicy,
  isIPv4,
  isIPv4Cidr,
  joinNames,
  normalizeBaseUrl,
  normalizeCidr,
  normalizeCidrs,
  normalizeEnabled,
  pickString,
  readRepeatedStrings,
  registerHandlers,
  requireString,
  resolveCallContext,
  resolveHost,
  resolvePassword,
  resolveTimeoutMs,
  resolveUser,
  shouldSkipTlsVerify,
  successResponse,
  throwStructuredError,
  toAddressGroupItems,
  toSecurityPolicyItems,
  toValue,
  tryParseJson,
  unwrapScalar,
  utf8Bytes,
};
