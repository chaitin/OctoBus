import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const DEFAULT_TIMEOUT_MS = 1500;
export const CREATE_ADDRESS_PATH = '/Fortinet_FW.Fortinet_FW/CreateAddress';
export const GET_ADDRESS_PATH = '/Fortinet_FW.Fortinet_FW/GetAddress';
export const DELETE_ADDRESS_PATH = '/Fortinet_FW.Fortinet_FW/DeleteAddress';
export const CREATE_ADDR_GROUP_PATH = '/Fortinet_FW.Fortinet_FW/CreateAddrGroup';
export const GET_ADDR_GROUP_PATH = '/Fortinet_FW.Fortinet_FW/GetAddrGroup';
export const ADD_ADDR_GROUP_MEMBER_PATH = '/Fortinet_FW.Fortinet_FW/AddAddrGroupMember';
export const REMOVE_ADDR_GROUP_MEMBER_PATH = '/Fortinet_FW.Fortinet_FW/RemoveAddrGroupMember';
export const DELETE_ADDR_GROUP_PATH = '/Fortinet_FW.Fortinet_FW/DeleteAddrGroup';
export const ATTACH_SUB_GROUP_PATH = '/Fortinet_FW.Fortinet_FW/AttachSubGroupToPolicyAddrGroup';
export const DETACH_SUB_GROUP_PATH = '/Fortinet_FW.Fortinet_FW/DetachSubGroupFromPolicyAddrGroup';

export const METHOD_CREATE_ADDRESS_FULL = 'Fortinet_FW.Fortinet_FW/CreateAddress';
export const METHOD_GET_ADDRESS_FULL = 'Fortinet_FW.Fortinet_FW/GetAddress';
export const METHOD_DELETE_ADDRESS_FULL = 'Fortinet_FW.Fortinet_FW/DeleteAddress';
export const METHOD_CREATE_ADDR_GROUP_FULL = 'Fortinet_FW.Fortinet_FW/CreateAddrGroup';
export const METHOD_GET_ADDR_GROUP_FULL = 'Fortinet_FW.Fortinet_FW/GetAddrGroup';
export const METHOD_ADD_ADDR_GROUP_MEMBER_FULL = 'Fortinet_FW.Fortinet_FW/AddAddrGroupMember';
export const METHOD_REMOVE_ADDR_GROUP_MEMBER_FULL = 'Fortinet_FW.Fortinet_FW/RemoveAddrGroupMember';
export const METHOD_DELETE_ADDR_GROUP_FULL = 'Fortinet_FW.Fortinet_FW/DeleteAddrGroup';
export const METHOD_ATTACH_SUB_GROUP_FULL = 'Fortinet_FW.Fortinet_FW/AttachSubGroupToPolicyAddrGroup';
export const METHOD_DETACH_SUB_GROUP_FULL = 'Fortinet_FW.Fortinet_FW/DetachSubGroupFromPolicyAddrGroup';
let insecureDispatcherPromise;

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

const stringifyJson = (value) => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const stringifyCell = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return stringifyJson(value);
};

const toInteger = (value, fallback = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num) || Number.isNaN(num)) return fallback;
  return Math.trunc(num);
};

const normalizeBaseUrl = (value) => {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.replace(/\/+$/, '');
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.bindings ?? {}),
  ...(ctx?.config ?? {}),
  ...(ctx?.secret ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.req ?? ctx.request ?? {},
});

const resolveBaseUrl = (bindings) => {
  for (const key of ['host', 'restBaseUrl', 'rest_base_url', 'baseUrl', 'base_url', 'endpoint']) {
    const value = normalizeBaseUrl(bindings?.[key]);
    if (value) return value;
  }
  return '';
};

const resolveToken = (bindings) => String(firstDefined(bindings?.token, bindings?.accessToken, bindings?.access_token, '') || '').trim();

const toBool = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'string') {
    const raw = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(raw)) return true;
    if (['0', 'false', 'no', 'n', 'off', ''].includes(raw)) return false;
  }
  return Boolean(value);
};

const resolveVdom = (bindings) => {
  const enabled = toBool(firstDefined(bindings?.is_vdom, bindings?.isVdom));
  if (!enabled) return '';
  return String(firstDefined(bindings?.vdom, 'root') || 'root').trim() || 'root';
};

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

const buildHeaders = (bindings, meta, extra = {}) => ({
  Accept: 'application/json',
  'Accept-Encoding': 'gzip, deflate, br',
  Authorization: `Bearer ${resolveToken(bindings)}`,
  ...(bindings?.headers || {}),
  'x-engine-instance': meta?.instance_id || meta?.instanceId || 'unknown',
  'x-request-id': meta?.request_id || meta?.requestId || 'unknown',
  ...extra,
});

const appendQuery = (url, params = {}) => {
  const pairs = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  if (pairs.length === 0) return url;
  return url.includes('?') ? `${url}&${pairs.join('&')}` : `${url}?${pairs.join('&')}`;
};

const requireHost = (ctx) => {
  const host = resolveBaseUrl(mergedBindings(ctx));
  if (!host) throw errorWithCode('INVALID_ARGUMENT', 'host/baseUrl is required in bindings');
  return host;
};

const requireToken = (ctx) => {
  const token = resolveToken(mergedBindings(ctx));
  if (!token) throw errorWithCode('INVALID_ARGUMENT', 'token is required in bindings');
  return token;
};

const withVdom = (ctx, path) => {
  const bindings = mergedBindings(ctx);
  const host = requireHost(ctx);
  const vdom = resolveVdom(bindings);
  const url = `${host}${path}`;
  return vdom ? appendQuery(url, { vdom }) : url;
};

const parseJsonBody = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithCode('UNKNOWN', 'response is not valid JSON');
  }
};

const throwForHttpStatus = (status, text) => {
  const summary = `upstream http ${status}; body_length=${String(text || '').length}`;
  if (status === 401 || status === 403) {
    throw errorWithCode('PERMISSION_DENIED', summary);
  }
  if (status >= 400 && status < 500) {
    throw errorWithCode('FAILED_PRECONDITION', summary);
  }
  throw errorWithCode('UNAVAILABLE', summary);
};

const fetchFortinetJson = async (ctx, url, init = {}) => {
  const callCtx = resolveCallContext(ctx);
  const allowedStatuses = Array.isArray(init.allowedStatuses) ? init.allowedStatuses : [];
  const { allowedStatuses: _, ...requestInit } = init;
  let res;
  try {
    res = await fetchWithTimeout(url, {
      ...requestInit,
      headers: buildHeaders(callCtx.bindings || {}, callCtx.meta || {}, requestInit.headers || {}),
    }, { timeoutMs: resolveTimeoutMs(callCtx), bindings: callCtx.bindings || {} });
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', err?.cause?.message || err?.message || 'fetch failed');
  }
  const text = String((await res.text()) ?? '');
  if (!res.ok && !allowedStatuses.includes(res.status)) {
    throwForHttpStatus(res.status, text);
  }
  if (!String(text || '').trim()) {
    throw errorWithCode('UNKNOWN', 'response body is empty');
  }
  return { json: parseJsonBody(text), text, status: res.status };
};

const logFlow = (ctx, action, details) => {
  const meta = ctx?.meta || {};
  const trace = [];
  if (meta.instance_id || meta.instanceId) trace.push(`inst=${meta.instance_id || meta.instanceId}`);
  if (meta.request_id || meta.requestId) trace.push(`req=${meta.request_id || meta.requestId}`);
  const prefix = `[Fortinet_FW][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
  try {
    console.log(prefix, JSON.stringify(details));
  } catch {
    console.log(prefix, details);
  }
};

const isIPv4 = (value) => {
  const raw = String(value || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
};

const requireIp = (value, field = 'ip') => {
  const ip = String(value || '').trim();
  if (!ip) throw errorWithCode('INVALID_ARGUMENT', `${field} is required`);
  if (!isIPv4(ip)) throw errorWithCode('INVALID_ARGUMENT', `${field} must be a valid IPv4 address`);
  return ip;
};

const requireString = (value, field) => {
  const text = String(value || '').trim();
  if (!text) throw errorWithCode('INVALID_ARGUMENT', `${field} is required`);
  return text;
};

const defaultSubnet = (ip) => `${ip}/32`;

const toValue = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return { nullValue: 'NULL_VALUE' };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return Number.isFinite(value) ? { numberValue: value } : { stringValue: String(value) };
  if (typeof value === 'boolean') return { boolValue: value };
  if (Array.isArray(value)) {
    return { listValue: { values: value.map((item) => toValue(item)).filter((item) => item !== undefined) } };
  }
  if (typeof value === 'object') {
    const fields = {};
    for (const [key, item] of Object.entries(value)) {
      const mapped = toValue(item);
      if (mapped !== undefined) fields[key] = mapped;
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(value) };
};

const toFortinetResponse = (json, text) => {
  const response = {
    status: stringifyCell(json?.status),
    http_status: toInteger(firstDefined(json?.http_status, json?.httpStatus), 0),
    error: toInteger(json?.error, 0),
    revision: stringifyCell(json?.revision),
    results: toValue(json?.results ?? null),
    raw_json: '',
  };
  Object.defineProperty(response, 'parsed_json', { value: json, enumerable: false });
  return response;
};

const assertSuccess = (json, fallbackMessage) => {
  const status = stringifyCell(json?.status).trim().toLowerCase();
  const httpStatus = toInteger(firstDefined(json?.http_status, json?.httpStatus), 0);
  if (status === 'success' && httpStatus === 200) return;
  throw errorWithCode('FAILED_PRECONDITION', fallbackMessage || `fortinet status=${status || 'unknown'} http_status=${httpStatus}`);
};

const isAlreadyExists = (json) => toInteger(json?.error, 0) === -5;
const isStillReferenced = (json) => toInteger(json?.error, 0) === -23;

const extractMembers = (json) => {
  const results = Array.isArray(json?.results) ? json.results : [];
  const first = results[0] || {};
  const members = Array.isArray(first?.member) ? first.member : [];
  return members
    .map((item) => ({ name: stringifyCell(item?.name).trim() }))
    .filter((item) => item.name);
};

const ensureAddress = async (ip, ctx) => {
  const subnet = defaultSubnet(ip);
  return handleCreateAddress({ ip, subnet }, ctx, { nested: true });
};

const handleCreateAddress = async (req, ctx, options = {}) => {
  requireToken(ctx);
  const ip = requireIp(req?.ip);
  const subnet = String(req?.subnet || '').trim() || defaultSubnet(ip);
  const url = withVdom(ctx, '/api/v2/cmdb/firewall/address');
  const { json, text } = await fetchFortinetJson(ctx, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: ip, subnet }),
  });
  if (!(stringifyCell(json?.status).trim().toLowerCase() === 'success' && toInteger(json?.http_status, 0) === 200)) {
    if (isAlreadyExists(json)) {
      logFlow(ctx, 'CreateAddress', { ip, subnet, duplicated: true, nested: Boolean(options.nested) });
      return toFortinetResponse(json, text);
    }
    throw errorWithCode('FAILED_PRECONDITION', `create address failed for ${ip}`);
  }
  logFlow(ctx, 'CreateAddress', { ip, subnet, nested: Boolean(options.nested), success: true });
  return toFortinetResponse(json, text);
};

const handleGetAddress = async (req, ctx) => {
  requireToken(ctx);
  const ip = requireIp(req?.ip);
  const url = withVdom(ctx, `/api/v2/cmdb/firewall/address/${encodeURIComponent(ip)}`);
  const { json, text } = await fetchFortinetJson(ctx, url, { method: 'GET' });
  assertSuccess(json, `get address failed for ${ip}`);
  return toFortinetResponse(json, text);
};

const handleDeleteAddress = async (req, ctx) => {
  requireToken(ctx);
  const ip = requireIp(req?.ip);
  const url = withVdom(ctx, `/api/v2/cmdb/firewall/address/${encodeURIComponent(ip)}`);
  const { json, text } = await fetchFortinetJson(ctx, url, { method: 'DELETE' });
  if (!(stringifyCell(json?.status).trim().toLowerCase() === 'success' && toInteger(json?.http_status, 0) === 200)) {
    if (isStillReferenced(json)) {
      logFlow(ctx, 'DeleteAddress', { ip, referenced: true });
      return toFortinetResponse(json, text);
    }
    throw errorWithCode('FAILED_PRECONDITION', `delete address failed for ${ip}`);
  }
  return toFortinetResponse(json, text);
};

const readRepeatedStrings = (value) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray(value.values)) return value.values.map((item) => String(item?.value ?? item));
  return [];
};

const normalizeIps = (ips) => {
  const values = readRepeatedStrings(ips);
  if (values.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'ips is required');
  return values.map((ip) => requireIp(ip, 'ips')).map((ip) => ({ name: ip }));
};

const handleCreateAddrGroup = async (req, ctx) => {
  requireToken(ctx);
  const groupName = requireString(req?.group_name ?? req?.groupName, 'group_name');
  const members = normalizeIps(req?.ips);
  for (const member of members) await ensureAddress(member.name, ctx);
  const url = withVdom(ctx, '/api/v2/cmdb/firewall/addrgrp');
  const { json, text } = await fetchFortinetJson(ctx, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: groupName, member: members }),
  });
  assertSuccess(json, `create addr group failed for ${groupName}`);
  return toFortinetResponse(json, text);
};

const handleGetAddrGroup = async (req, ctx) => {
  requireToken(ctx);
  const groupName = requireString(req?.group_name ?? req?.groupName, 'group_name');
  const url = withVdom(ctx, `/api/v2/cmdb/firewall/addrgrp/${encodeURIComponent(groupName)}`);
  const { json, text } = await fetchFortinetJson(ctx, url, { method: 'GET' });
  assertSuccess(json, `get addr group failed for ${groupName}`);
  return toFortinetResponse(json, text);
};

const handleAddAddrGroupMember = async (req, ctx) => {
  requireToken(ctx);
  const groupName = requireString(req?.group_name ?? req?.groupName, 'group_name');
  const ip = requireIp(req?.ip);
  await ensureAddress(ip, ctx);
  const url = withVdom(ctx, `/api/v2/cmdb/firewall/addrgrp/${encodeURIComponent(groupName)}/member`);
  const { json, text } = await fetchFortinetJson(ctx, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: ip }),
  });
  if (!(stringifyCell(json?.status).trim().toLowerCase() === 'success' && toInteger(json?.http_status, 0) === 200)) {
    if (isAlreadyExists(json)) {
      logFlow(ctx, 'AddAddrGroupMember', { group_name: groupName, ip, duplicated: true });
      return toFortinetResponse(json, text);
    }
    throw errorWithCode('FAILED_PRECONDITION', `add addr group member failed for ${groupName}/${ip}`);
  }
  return toFortinetResponse(json, text);
};

const handleRemoveAddrGroupMember = async (req, ctx) => {
  requireToken(ctx);
  const groupName = requireString(req?.group_name ?? req?.groupName, 'group_name');
  const ip = requireIp(req?.ip);
  const url = withVdom(ctx, `/api/v2/cmdb/firewall/addrgrp/${encodeURIComponent(groupName)}/member/${encodeURIComponent(ip)}`);
  const { json, text } = await fetchFortinetJson(ctx, url, { method: 'DELETE', allowedStatuses: [404] });
  const httpStatus = toInteger(firstDefined(json?.http_status, json?.httpStatus), 0);
  if (stringifyCell(json?.status).trim().toLowerCase() === 'success' && httpStatus === 200) return toFortinetResponse(json, text);
  if (httpStatus === 404) {
    logFlow(ctx, 'RemoveAddrGroupMember', { group_name: groupName, ip, missing_member: true });
    return toFortinetResponse(json, text);
  }
  throw errorWithCode('FAILED_PRECONDITION', `remove addr group member failed for ${groupName}/${ip}`);
};

const handleDeleteAddrGroup = async (req, ctx) => {
  requireToken(ctx);
  const groupName = requireString(req?.group_name ?? req?.groupName, 'group_name');
  const url = withVdom(ctx, `/api/v2/cmdb/firewall/addrgrp/${encodeURIComponent(groupName)}`);
  const { json, text } = await fetchFortinetJson(ctx, url, { method: 'DELETE' });
  assertSuccess(json, `delete addr group failed for ${groupName}`);
  return toFortinetResponse(json, text);
};

const updatePolicyGroupMembers = async (policyBookName, nextMembers, ctx, action) => {
  const url = withVdom(ctx, `/api/v2/cmdb/firewall/addrgrp/${encodeURIComponent(policyBookName)}`);
  const { json, text } = await fetchFortinetJson(ctx, url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: policyBookName, member: nextMembers }),
  });
  assertSuccess(json, `${action} failed for ${policyBookName}`);
  return toFortinetResponse(json, text);
};

const handleAttachSubGroupToPolicyAddrGroup = async (req, ctx) => {
  requireToken(ctx);
  const policyBookName = requireString(req?.policy_book_name ?? req?.policyBookName, 'policy_book_name');
  const subGroupName = requireString(req?.sub_group_name ?? req?.subGroupName, 'sub_group_name');
  const current = await handleGetAddrGroup({ group_name: policyBookName }, ctx);
  const members = extractMembers(current.parsed_json);
  if (!members.some((item) => item.name === subGroupName)) members.push({ name: subGroupName });
  return updatePolicyGroupMembers(policyBookName, members, ctx, 'attach subgroup to policy addr group');
};

const handleDetachSubGroupFromPolicyAddrGroup = async (req, ctx) => {
  requireToken(ctx);
  const policyBookName = requireString(req?.policy_book_name ?? req?.policyBookName, 'policy_book_name');
  const subGroupName = requireString(req?.sub_group_name ?? req?.subGroupName, 'sub_group_name');
  const current = await handleGetAddrGroup({ group_name: policyBookName }, ctx);
  const members = extractMembers(current.parsed_json).filter((item) => item.name !== subGroupName);
  return updatePolicyGroupMembers(policyBookName, members, ctx, 'detach subgroup from policy addr group');
};

const registerHandlers = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  return {
    [CREATE_ADDRESS_PATH]: (req = callCtx.req) => handleCreateAddress(req ?? {}, callCtx),
    [GET_ADDRESS_PATH]: (req = callCtx.req) => handleGetAddress(req ?? {}, callCtx),
    [DELETE_ADDRESS_PATH]: (req = callCtx.req) => handleDeleteAddress(req ?? {}, callCtx),
    [CREATE_ADDR_GROUP_PATH]: (req = callCtx.req) => handleCreateAddrGroup(req ?? {}, callCtx),
    [GET_ADDR_GROUP_PATH]: (req = callCtx.req) => handleGetAddrGroup(req ?? {}, callCtx),
    [ADD_ADDR_GROUP_MEMBER_PATH]: (req = callCtx.req) => handleAddAddrGroupMember(req ?? {}, callCtx),
    [REMOVE_ADDR_GROUP_MEMBER_PATH]: (req = callCtx.req) => handleRemoveAddrGroupMember(req ?? {}, callCtx),
    [DELETE_ADDR_GROUP_PATH]: (req = callCtx.req) => handleDeleteAddrGroup(req ?? {}, callCtx),
    [ATTACH_SUB_GROUP_PATH]: (req = callCtx.req) => handleAttachSubGroupToPolicyAddrGroup(req ?? {}, callCtx),
    [DETACH_SUB_GROUP_PATH]: (req = callCtx.req) => handleDetachSubGroupFromPolicyAddrGroup(req ?? {}, callCtx),
  };
};

export function rpcdef(ctx = {}) {
  return registerHandlers(ctx);
}

const callSdkHandler = (ctx, path) => registerHandlers(ctx)[path](ctx?.req ?? ctx?.request ?? {});

export const handlers = {
  [METHOD_CREATE_ADDRESS_FULL]: (ctx) => callSdkHandler(ctx, CREATE_ADDRESS_PATH),
  [METHOD_GET_ADDRESS_FULL]: (ctx) => callSdkHandler(ctx, GET_ADDRESS_PATH),
  [METHOD_DELETE_ADDRESS_FULL]: (ctx) => callSdkHandler(ctx, DELETE_ADDRESS_PATH),
  [METHOD_CREATE_ADDR_GROUP_FULL]: (ctx) => callSdkHandler(ctx, CREATE_ADDR_GROUP_PATH),
  [METHOD_GET_ADDR_GROUP_FULL]: (ctx) => callSdkHandler(ctx, GET_ADDR_GROUP_PATH),
  [METHOD_ADD_ADDR_GROUP_MEMBER_FULL]: (ctx) => callSdkHandler(ctx, ADD_ADDR_GROUP_MEMBER_PATH),
  [METHOD_REMOVE_ADDR_GROUP_MEMBER_FULL]: (ctx) => callSdkHandler(ctx, REMOVE_ADDR_GROUP_MEMBER_PATH),
  [METHOD_DELETE_ADDR_GROUP_FULL]: (ctx) => callSdkHandler(ctx, DELETE_ADDR_GROUP_PATH),
  [METHOD_ATTACH_SUB_GROUP_FULL]: (ctx) => callSdkHandler(ctx, ATTACH_SUB_GROUP_PATH),
  [METHOD_DETACH_SUB_GROUP_FULL]: (ctx) => callSdkHandler(ctx, DETACH_SUB_GROUP_PATH),
};

rpcdef.__test__ = {
  appendQuery,
  assertSuccess,
  buildHeaders,
  buildTlsOptions,
  createTlsDispatcher,
  defaultSubnet,
  errorWithCode,
  extractMembers,
  fetchWithTimeout,
  fetchFortinetJson,
  firstDefined,
  handleAddAddrGroupMember,
  handleAttachSubGroupToPolicyAddrGroup,
  handleCreateAddrGroup,
  handleCreateAddress,
  handleDeleteAddrGroup,
  handleDeleteAddress,
  handleDetachSubGroupFromPolicyAddrGroup,
  handleGetAddrGroup,
  handleGetAddress,
  handleRemoveAddrGroupMember,
  hasOwn,
  isAlreadyExists,
  isIPv4,
  isStillReferenced,
  logFlow,
  mergedBindings,
  normalizeBaseUrl,
  normalizeIps,
  parseJsonBody,
  readRepeatedStrings,
  registerHandlers,
  requireHost,
  requireIp,
  requireString,
  requireToken,
  resolveBaseUrl,
  resolveCallContext,
  resolveTimeoutMs,
  resolveToken,
  resolveVdom,
  shouldSkipTlsVerify,
  stringifyCell,
  stringifyJson,
  throwForHttpStatus,
  toBool,
  toFortinetResponse,
  toInteger,
  toValue,
  updatePolicyGroupMembers,
  withVdom,
};

export const _test = rpcdef.__test__;
