import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import net from 'node:net';

import { RiversecClient, EMPTY_MD5_HASH, signRequest, buildCanonicalQueryString } from './riversec-client.js';

export const PACKAGE = 'Riversec_Botgate_WAF';
export const methodPath = (service, rpc) => `${PACKAGE}.${service}/${rpc}`;

export const METHOD_PATHS = {
  getBlacklistStatus: methodPath('IPBlacklistService', 'GetBlacklistStatus'),
  setBlacklistStatus: methodPath('IPBlacklistService', 'SetBlacklistStatus'),
  getBlacklist: methodPath('IPBlacklistService', 'GetBlacklist'),
  setBlacklist: methodPath('IPBlacklistService', 'SetBlacklist'),
  addBlacklistItems: methodPath('IPBlacklistService', 'AddBlacklistItems'),
  clearBlacklist: methodPath('IPBlacklistService', 'ClearBlacklist'),
  blockIP: methodPath('IPBlacklistService', 'BlockIP'),
  unblockIP: methodPath('IPBlacklistService', 'UnblockIP'),
  listProtectedSites: methodPath('ProtectedSiteService', 'ListProtectedSites'),
  createProtectedSite: methodPath('ProtectedSiteService', 'CreateProtectedSite'),
  getProtectedSite: methodPath('ProtectedSiteService', 'GetProtectedSite'),
  updateProtectedSite: methodPath('ProtectedSiteService', 'UpdateProtectedSite'),
  deleteProtectedSite: methodPath('ProtectedSiteService', 'DeleteProtectedSite'),
  batchUpdateProtectedSites: methodPath('ProtectedSiteService', 'BatchUpdateProtectedSites'),
  getSSOToken: methodPath('ClusterService', 'GetSSOToken'),
  getClusterInfo: methodPath('ClusterService', 'GetClusterInfo'),
  upgradeCluster: methodPath('ClusterService', 'UpgradeCluster'),
  rollbackCluster: methodPath('ClusterService', 'RollbackCluster'),
  getEditorStatus: methodPath('ProgrammableRuleService', 'GetEditorStatus'),
  setEditorStatus: methodPath('ProgrammableRuleService', 'SetEditorStatus'),
  updateWebRule: methodPath('ProgrammableRuleService', 'UpdateWebRule'),
  updateAppRule: methodPath('ProgrammableRuleService', 'UpdateAppRule'),
  getRuleStatus: methodPath('ProgrammableRuleService', 'GetRuleStatus'),
  setRuleStatus: methodPath('ProgrammableRuleService', 'SetRuleStatus'),
  uploadResourceFile: methodPath('ProgrammableRuleService', 'UploadResourceFile'),
  listAPIs: methodPath('APIManagementService', 'ListAPIs'),
  addAPI: methodPath('APIManagementService', 'AddAPI'),
  deleteAPI: methodPath('APIManagementService', 'DeleteAPI'),
  ignoreAPI: methodPath('APIManagementService', 'IgnoreAPI'),
  setAPIOnlineStatus: methodPath('APIManagementService', 'SetAPIOnlineStatus'),
};

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const extractList = (rawList) => {
  if (!rawList) return [];
  if (Array.isArray(rawList)) return rawList;
  if (typeof rawList === 'object' && Array.isArray(rawList.values)) return rawList.values;
  return [];
};

const camelCaseField = (snakeKey) => snakeKey.replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());

const reqField = (obj, snakeKey) => {
  if (obj == null || typeof obj !== 'object') return undefined;
  const camelKey = camelCaseField(snakeKey);
  if (hasOwn(obj, snakeKey)) return obj[snakeKey];
  if (hasOwn(obj, camelKey)) return obj[camelKey];
  return undefined;
};

const normalizeUpstreamForAPI = (upstream) => {
  if (!upstream || typeof upstream !== 'object') return upstream;
  const normalized = {};
  const protocol = reqField(upstream, 'protocol');
  if (protocol != null && protocol !== '') normalized.protocol = protocol;
  const upstreamList = extractList(reqField(upstream, 'upstream_list'));
  if (upstreamList.length > 0) normalized.upstream_list = upstreamList;
  const loadBalance = reqField(upstream, 'load_balance');
  if (loadBalance != null && loadBalance !== '') normalized.load_balance = loadBalance;
  const healthCheck = reqField(upstream, 'health_check');
  if (healthCheck != null && healthCheck !== '') normalized.health_check = healthCheck;
  return normalized;
};

const SITE_OPTIONAL_FIELDS = [
  'name', 'invalid_action', 'invalid_action_redirect_path', 'ip_strategy',
  'web_essential_strategy', 'web_power_strategy', 'waf_strategy', 'ai_waf_strategy', 'static_resource_list',
];

const SITE_UPDATE_FIELDS = [
  'protection_mode', 'upstream', 'name', 'invalid_action', 'invalid_action_redirect_path',
  'ip_strategy', 'web_essential_strategy', 'web_power_strategy', 'waf_strategy', 'ai_waf_strategy', 'static_resource_list',
];

const BATCH_SITE_CONFIG_FIELDS = ['protection_mode', 'upstream', 'web_essential_strategy'];

const ON_OFF_STATUSES = new Set(['on', 'off']);
const SITE_TYPES = new Set(['domain', 'ipv4', 'ipv6', 'regex']);
const PROTOCOLS = new Set(['http', 'https']);
const PROTECTION_MODES = new Set(['intercept', 'monitor', 'passthrough']);
const RESOURCE_FILE_TYPES = new Set(['list', 'js', 'html']);
const MAX_BLACKLIST_ITEMS = 100_000;
const MAX_BATCH_SITE_LIST = 1000;
const MAX_UPGRADE_PACKAGE_BYTES = 512 * 1024 * 1024;
const MAX_RESOURCE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_RESOURCE_FILE_NAME_LENGTH = 255;
const MAX_SSO_USERNAME_LENGTH = 64;
const RESOURCE_FILE_NAME_PATTERN = /^[\w.-]+$/;
const SSO_USERNAME_PATTERN = /^[\w.-]+$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const requireString = (value, field) => {
  const text = String(unwrapScalar(value)).trim();
  if (!text) throw errorWithCode('INVALID_ARGUMENT', `${field} is required`);
  return text;
};

const requireOneOf = (value, allowed, field) => {
  const text = requireString(value, field);
  if (!allowed.has(text)) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} must be one of: ${[...allowed].join(', ')}`);
  }
  return text;
};

const requireOnOffStatus = (value, field = 'status') => requireOneOf(value, ON_OFF_STATUSES, field);

const requirePort = (value, field = 'port') => {
  const port = Number(unwrapScalar(value));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} must be an integer between 1 and 65535`);
  }
  return port;
};

const requireNonEmptyList = (list, field) => {
  if (list.length === 0) throw errorWithCode('INVALID_ARGUMENT', `${field} is required`);
  if (list.length > MAX_BLACKLIST_ITEMS) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} exceeds maximum of ${MAX_BLACKLIST_ITEMS} items`);
  }
  return list;
};

const rejectUnsupportedBlockIPFields = (req = {}) => {
  const remark = String(unwrapScalar(req.remark)).trim();
  const duration = Number(unwrapScalar(req.duration_seconds ?? req.durationSeconds));
  if (remark) {
    throw errorWithCode('INVALID_ARGUMENT', 'remark is not supported by the upstream IP blacklist API');
  }
  if (Number.isFinite(duration) && duration !== 0) {
    throw errorWithCode('INVALID_ARGUMENT', 'duration_seconds is not supported by the upstream IP blacklist API');
  }
};

const decodeBase64 = (text, field) => {
  const normalized = text.replace(/\s/g, '');
  if (!BASE64_PATTERN.test(normalized)) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} must be valid base64`);
  }
  const buf = Buffer.from(normalized, 'base64');
  if (buf.length === 0) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} must not be empty`);
  }
  return buf;
};

const resolveBytes = (value, field, maxBytes) => {
  let buf;
  if (Buffer.isBuffer(value)) {
    buf = value;
  } else if (value instanceof Uint8Array) {
    buf = Buffer.from(value);
  } else if (typeof value === 'string') {
    const text = value.trim();
    if (!text) throw errorWithCode('INVALID_ARGUMENT', `${field} is required`);
    buf = decodeBase64(text, field);
  } else {
    throw errorWithCode('INVALID_ARGUMENT', `${field} is required`);
  }
  if (buf.length === 0) throw errorWithCode('INVALID_ARGUMENT', `${field} must not be empty`);
  if (buf.length > maxBytes) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} exceeds maximum size of ${maxBytes} bytes`);
  }
  return buf;
};

const requireResourceFileName = (value, field = 'file_name') => {
  const text = requireString(value, field);
  if (text.length > MAX_RESOURCE_FILE_NAME_LENGTH) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} exceeds maximum length of ${MAX_RESOURCE_FILE_NAME_LENGTH}`);
  }
  if (text.includes('..') || text.includes('/') || text.includes('\\') || text.includes('\0')) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} must not contain path separators or parent directory segments`);
  }
  if (!RESOURCE_FILE_NAME_PATTERN.test(text)) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} contains invalid characters`);
  }
  return text;
};

const requireSSOUsername = (value) => {
  const text = requireString(value ?? 'admin', 'username');
  if (text.length > MAX_SSO_USERNAME_LENGTH) {
    throw errorWithCode('INVALID_ARGUMENT', `username exceeds maximum length of ${MAX_SSO_USERNAME_LENGTH}`);
  }
  if (!SSO_USERNAME_PATTERN.test(text)) {
    throw errorWithCode('INVALID_ARGUMENT', 'username contains invalid characters');
  }
  return text;
};

const validateCreateProtectedSiteRequest = (req = {}) => {
  requireOneOf(reqField(req, 'type'), SITE_TYPES, 'type');
  requireString(reqField(req, 'site'), 'site');
  requireOneOf(reqField(req, 'protocol'), PROTOCOLS, 'protocol');
  requirePort(reqField(req, 'port'), 'port');
  requireOneOf(reqField(req, 'protection_mode'), PROTECTION_MODES, 'protection_mode');
  const upstream = reqField(req, 'upstream');
  if (!upstream || typeof upstream !== 'object') {
    throw errorWithCode('INVALID_ARGUMENT', 'upstream is required');
  }
  requireOneOf(reqField(upstream, 'protocol'), PROTOCOLS, 'upstream.protocol');
  const upstreamList = extractList(reqField(upstream, 'upstream_list'));
  if (upstreamList.length === 0) {
    throw errorWithCode('INVALID_ARGUMENT', 'upstream.upstream_list is required');
  }
  const name = reqField(req, 'name');
  if (name != null && String(unwrapScalar(name)).length > 26) {
    throw errorWithCode('INVALID_ARGUMENT', 'name must be at most 26 characters');
  }
};

const validateProtectedSiteUpdateRequest = (req = {}) => {
  requireString(reqField(req, 'id'), 'id');
  const protectionMode = reqField(req, 'protection_mode');
  if (protectionMode != null && protectionMode !== '') {
    requireOneOf(protectionMode, PROTECTION_MODES, 'protection_mode');
  }
};

const validateBatchUpdateProtectedSitesRequest = (req = {}) => {
  const siteList = extractList(reqField(req, 'site_list'))
    .map((item) => String(unwrapScalar(item)).trim())
    .filter(Boolean);
  requireNonEmptyList(siteList, 'site_list');
  if (siteList.length > MAX_BATCH_SITE_LIST) {
    throw errorWithCode('INVALID_ARGUMENT', `site_list exceeds maximum of ${MAX_BATCH_SITE_LIST} items`);
  }
  const config = reqField(req, 'config') ?? {};
  const hasConfig = BATCH_SITE_CONFIG_FIELDS
    .some((key) => {
      const value = reqField(config, key);
      return value != null && value !== '';
    });
  if (!hasConfig) {
    throw errorWithCode('INVALID_ARGUMENT', 'config must include at least one updatable field');
  }
  const configProtectionMode = reqField(config, 'protection_mode');
  if (configProtectionMode != null && configProtectionMode !== '') {
    requireOneOf(configProtectionMode, PROTECTION_MODES, 'config.protection_mode');
  }
  return siteList;
};

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: {
    ...(ctx.config ?? {}),
    ...(ctx.secret ?? {}),
    ...(ctx.bindings ?? {}),
  },
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.req ?? ctx.request ?? {},
});

const buildClient = (ctx) => {
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings;
  const baseUrl = String(unwrapScalar(bindings.baseUrl || bindings.host || bindings.endpoint || '')).trim();
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw errorWithCode('INVALID_ARGUMENT', 'baseUrl/host must be an http(s) URL');
  }
  const tokenId = String(unwrapScalar(bindings.tokenId || bindings.token_id || '')).trim();
  const tokenValue = String(unwrapScalar(bindings.tokenValue || bindings.token_value || bindings.token || '')).trim();
  if (!tokenId) throw errorWithCode('FAILED_PRECONDITION', 'tokenId/token_id is required');
  if (!tokenValue) throw errorWithCode('FAILED_PRECONDITION', 'tokenValue/token is required');
  return new RiversecClient({ ...bindings, baseUrl }, { tokenId, tokenValue });
};

export const mapAPIError = (errNo) => {
  switch (Number(errNo)) {
    case 2:
    case 3:
      return 'UNAUTHENTICATED';
    case 4:
      return 'INVALID_ARGUMENT';
    case 10:
      return 'PERMISSION_DENIED';
    default:
      return 'FAILED_PRECONDITION';
  }
};

export const checkAPIResponse = (response, statusCode) => {
  const data = response?.data;
  if (data?.err_no != null && Number(data.err_no) !== 0) {
    const legacy = mapAPIError(data.err_no);
    throw errorWithCode(legacy, `${data.err_msg || 'upstream error'} (err_no=${data.err_no})`);
  }
  if (statusCode >= 400) {
    if (statusCode === 401) throw errorWithCode('UNAUTHENTICATED', `HTTP ${statusCode}`);
    if (statusCode === 403) throw errorWithCode('PERMISSION_DENIED', `HTTP ${statusCode}`);
    if (statusCode >= 500) throw errorWithCode('UNAVAILABLE', `HTTP ${statusCode}`);
    throw errorWithCode('FAILED_PRECONDITION', `HTTP ${statusCode}`);
  }
  return data;
};

const isUpstreamUnavailable = (err) => {
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError') return true;
  const code = String(err.code || '');
  if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)) {
    return true;
  }
  const message = `${err.cause?.message || ''} ${err.message || ''}`.toLowerCase();
  return message.includes('fetch failed')
    || message.includes('network')
    || message.includes('timeout')
    || message.includes('certificate')
    || message.includes('econnrefused')
    || message.includes('econnreset');
};

const isIPv4 = (value) => {
  const text = String(value);
  const parts = text.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) return false;
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) return false;
    return part === String(num);
  });
};

const isIPv6 = (value) => {
  const text = String(value).trim();
  if (/^::ffff:/i.test(text)) {
    return isIPv4(text.substring(text.lastIndexOf(':') + 1));
  }
  return net.isIPv6(text);
};

export const normalizeHostCIDR = (input) => {
  const raw = unwrapScalar(input).trim();
  if (!raw) throw errorWithCode('INVALID_ARGUMENT', 'item must be a non-empty string');
  const slashIndex = raw.indexOf('/');
  if (slashIndex >= 0) {
    const ipPart = raw.slice(0, slashIndex).trim();
    const prefixPart = raw.slice(slashIndex + 1).trim();
    if (!ipPart || !prefixPart) throw errorWithCode('INVALID_ARGUMENT', `invalid cidr: ${raw}`);
    const prefix = Number(prefixPart);
    if (!Number.isInteger(prefix)) throw errorWithCode('INVALID_ARGUMENT', `invalid cidr prefix: ${raw}`);
    if (isIPv4(ipPart)) {
      if (prefix < 0 || prefix > 32) throw errorWithCode('INVALID_ARGUMENT', `invalid ipv4 cidr prefix: ${raw}`);
      return `${ipPart}/${prefix}`;
    }
    if (isIPv6(ipPart)) {
      if (prefix < 0 || prefix > 128) throw errorWithCode('INVALID_ARGUMENT', `invalid ipv6 cidr prefix: ${raw}`);
      return `${ipPart}/${prefix}`;
    }
    throw errorWithCode('INVALID_ARGUMENT', `ip must be a valid IPv4 or IPv6 address: ${raw}`);
  }
  if (isIPv4(raw)) return `${raw}/32`;
  if (isIPv6(raw)) return `${raw}/128`;
  throw errorWithCode('INVALID_ARGUMENT', `ip must be a valid IPv4 or IPv6 address: ${raw}`);
};

const normalizeBlacklistItems = (rawItems, field = 'items') => {
  const items = requireNonEmptyList(
    extractList(rawItems).map((item) => String(unwrapScalar(item)).trim()).filter(Boolean),
    field,
  );
  return items.map(normalizeHostCIDR);
};

const resolveIpList = (req = {}) => {
  const candidates = extractList(req.ip_list).length
    ? extractList(req.ip_list)
    : extractList(req.ipList).length
      ? extractList(req.ipList)
      : extractList(req.items).length
        ? extractList(req.items)
        : extractList(req.ips);
  const ips = candidates.map((item) => String(unwrapScalar(item)).trim()).filter(Boolean);
  if (ips.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'ip_list/items is required');
  return ips;
};

const buildBlacklistRemoveSet = (ips) => {
  const removeSet = new Set();
  for (const ip of ips) {
    const trimmed = String(ip).trim();
    removeSet.add(trimmed);
    try {
      removeSet.add(normalizeHostCIDR(trimmed));
    } catch {
      // keep literal forms only; invalid entries were already validated upstream of this helper
    }
  }
  return removeSet;
};

const shouldRemoveBlacklistItem = (item, removeSet) => {
  const trimmed = String(item).trim();
  if (removeSet.has(trimmed)) return true;
  try {
    return removeSet.has(normalizeHostCIDR(trimmed));
  } catch {
    return false;
  }
};

export const mapSiteSummary = (site) => ({
  id: site.id || '',
  protocol: site.protocol || '',
  port: site.port || 0,
  type: site.type || '',
  site: site.site || '',
  name: site.name || '',
  protection_mode: site.protection_mode || '',
  waf_strategy: {
    enable: site.waf_strategy?.enable ?? false,
    monitor_only: site.waf_strategy?.monitor_only ?? false,
    type: site.waf_strategy?.type || '',
  },
});

const parseIPStrategy = (ipStrategy) => {
  if (!ipStrategy) return {};
  return {
    type: ipStrategy.type || 'all_ip',
    ip_white_list: (ipStrategy.ip_white_list || []).map((entry) => ({
      ip: entry[0] || entry.ip || '',
      mask: entry[1] || entry.mask || '',
      comments: entry[2] || entry.comments || '',
      format: entry[3] || entry.format || 'mask',
    })),
    ip_protection_list: (ipStrategy.ip_protection_list || []).map((entry) => ({
      ip: entry[0] || entry.ip || '',
      mask: entry[1] || entry.mask || '',
      comments: entry[2] || entry.comments || '',
      format: entry[3] || entry.format || 'mask',
    })),
  };
};

const buildCreateSitePayload = (req) => {
  const payload = {
    type: reqField(req, 'type'),
    site: reqField(req, 'site'),
    protocol: reqField(req, 'protocol'),
    port: reqField(req, 'port'),
    protection_mode: reqField(req, 'protection_mode'),
  };
  const upstream = reqField(req, 'upstream');
  if (upstream != null && upstream !== '') payload.upstream = normalizeUpstreamForAPI(upstream);
  for (const key of SITE_OPTIONAL_FIELDS) {
    const value = reqField(req, key);
    if (value != null && value !== '') payload[key] = value;
  }
  return payload;
};

const buildProtectedSiteUpdateConfig = (req) => {
  const config = {};
  for (const key of SITE_UPDATE_FIELDS) {
    const value = reqField(req, key);
    if (value == null || value === '') continue;
    config[key] = key === 'upstream' ? normalizeUpstreamForAPI(value) : value;
  }
  return config;
};

const buildBatchProtectedSiteConfig = (req) => {
  const source = reqField(req, 'config') ?? {};
  const config = {};
  for (const key of BATCH_SITE_CONFIG_FIELDS) {
    const value = reqField(source, key);
    if (value == null || value === '') continue;
    config[key] = key === 'upstream' ? normalizeUpstreamForAPI(value) : value;
  }
  return config;
};

const wrap = (fn) => async (ctx) => {
  try {
    return await fn(resolveCallContext(ctx), buildClient(ctx));
  } catch (err) {
    if (err instanceof GrpcError) throw err;
    if (isUpstreamUnavailable(err)) {
      const reason = err?.cause?.message || err?.message || 'upstream unavailable';
      throw errorWithCode('UNAVAILABLE', reason);
    }
    const reason = err?.cause?.message || err?.message || 'unexpected handler error';
    throw errorWithCode('UNKNOWN', reason);
  }
};

const getBlacklistStatus = wrap(async (_ctx, client) => {
  const response = await client.getBlacklistStatus();
  const data = checkAPIResponse(response, response.statusCode);
  return { status: data.value || data.status || 'off' };
});

const setBlacklistStatus = wrap(async (ctx, client) => {
  const status = requireOnOffStatus(ctx.req.status);
  const response = await client.setBlacklistStatus(status);
  checkAPIResponse(response, response.statusCode);
  return {};
});

const getBlacklist = wrap(async (_ctx, client) => {
  const response = await client.getBlacklist();
  const data = checkAPIResponse(response, response.statusCode);
  return { items: data.items || [] };
});

const setBlacklist = wrap(async (ctx, client) => {
  const items = normalizeBlacklistItems(ctx.req.items, 'items');
  const response = await client.setBlacklist(items);
  checkAPIResponse(response, response.statusCode);
  return {};
});

const addBlacklistItems = wrap(async (ctx, client) => {
  const items = normalizeBlacklistItems(ctx.req.items, 'items');
  const response = await client.addBlacklistItems(items);
  const data = checkAPIResponse(response, response.statusCode);
  return {
    added_number: data.added_number || 0,
    total_number: data.total_number || 0,
    invalid_ip: data.invalid_ip || [],
  };
});

const clearBlacklist = wrap(async (_ctx, client) => {
  const response = await client.clearBlacklist();
  checkAPIResponse(response, response.statusCode);
  return {};
});

const blockIP = wrap(async (ctx, client) => {
  rejectUnsupportedBlockIPFields(ctx.req);
  const ips = resolveIpList(ctx.req);
  const items = ips.map(normalizeHostCIDR);
  const response = await client.addBlacklistItems(items);
  const data = checkAPIResponse(response, response.statusCode);
  const addedNumber = Number(data.added_number);
  const invalidIp = extractList(data.invalid_ip).map((item) => String(unwrapScalar(item)).trim()).filter(Boolean);
  const normalizedAdded = Number.isFinite(addedNumber) ? addedNumber : 0;

  let effectiveAdded = normalizedAdded;
  if (effectiveAdded <= 0) {
    if (invalidIp.length > 0) {
      throw errorWithCode('FAILED_PRECONDITION', `block IP failed: invalid_ip=${invalidIp.join(', ')}`);
    }
    const verify = await client.getBlacklist();
    const verifyData = checkAPIResponse(verify, verify.statusCode);
    const currentItems = extractList(verifyData.items).map((item) => String(unwrapScalar(item)).trim()).filter(Boolean);
    const matched = items.filter((item) => currentItems.some((cur) => shouldRemoveBlacklistItem(cur, buildBlacklistRemoveSet([item]))));
    if (matched.length === 0) {
      throw errorWithCode('FAILED_PRECONDITION', 'block IP failed: upstream did not add any blacklist items');
    }
    effectiveAdded = matched.length;
  }

  return {
    success: true,
    message: data.err_msg || 'ok',
    blocked_ips: ips,
    added_number: effectiveAdded,
    total_number: data.total_number || 0,
    invalid_ip: invalidIp,
    raw_json: JSON.stringify(data),
  };
});

const unblockIP = wrap(async (ctx, client) => {
  const ips = resolveIpList(ctx.req);
  const removeSet = buildBlacklistRemoveSet(ips);
  const current = await client.getBlacklist();
  const currentData = checkAPIResponse(current, current.statusCode);
  const currentItems = extractList(currentData.items).map((item) => String(unwrapScalar(item)).trim()).filter(Boolean);
  const remaining = currentItems.filter((item) => !shouldRemoveBlacklistItem(item, removeSet));
  const removedCount = currentItems.length - remaining.length;
  if (removedCount === 0) {
    throw errorWithCode('FAILED_PRECONDITION', 'requested ip_list not found in current blacklist');
  }
  const response = remaining.length === 0
    ? await client.clearBlacklist()
    : await client.setBlacklist(remaining);
  const data = checkAPIResponse(response, response.statusCode);
  return {
    success: true,
    message: data.err_msg || 'ok',
    unblocked_ips: ips,
    raw_json: JSON.stringify(data),
  };
});

const listProtectedSites = wrap(async (_ctx, client) => {
  const response = await client.listProtectedSites();
  const data = checkAPIResponse(response, response.statusCode);
  return { sites: (data.sites || []).map(mapSiteSummary) };
});

const createProtectedSite = wrap(async (ctx, client) => {
  validateCreateProtectedSiteRequest(ctx.req);
  const payload = buildCreateSitePayload(ctx.req);
  const response = await client.createProtectedSite(payload);
  const data = checkAPIResponse(response, response.statusCode);
  return { id: data.id || '' };
});

const getProtectedSite = wrap(async (ctx, client) => {
  const id = requireString(ctx.req.id, 'id');
  const response = await client.getProtectedSite(id);
  const data = checkAPIResponse(response, response.statusCode);
  return {
    id: data.id || '',
    type: data.type || '',
    site: data.site || '',
    protocol: data.protocol || '',
    port: data.port || 0,
    protection_mode: data.protection_mode || '',
    upstream: data.upstream || {},
    name: data.name || '',
    invalid_action: data.invalid_action || '',
    invalid_action_redirect_path: data.invalid_action_redirect_path || '',
    ip_strategy: parseIPStrategy(data.ip_strategy),
    web_essential_strategy: data.web_essential_strategy || {},
    web_power_strategy: data.web_power_strategy || {},
    waf_strategy: data.waf_strategy || {},
    ai_waf_strategy: data.ai_waf_strategy || {},
    static_resource_list: data.static_resource_list || '',
  };
});

const updateProtectedSite = wrap(async (ctx, client) => {
  validateProtectedSiteUpdateRequest(ctx.req);
  const config = buildProtectedSiteUpdateConfig(ctx.req);
  if (Object.keys(config).length === 0) {
    throw errorWithCode('INVALID_ARGUMENT', 'at least one updatable field is required');
  }
  const response = await client.updateProtectedSite(requireString(reqField(ctx.req, 'id'), 'id'), config);
  checkAPIResponse(response, response.statusCode);
  return {};
});

const deleteProtectedSite = wrap(async (ctx, client) => {
  const id = requireString(ctx.req.id, 'id');
  const response = await client.deleteProtectedSite(id);
  checkAPIResponse(response, response.statusCode);
  return {};
});

const batchUpdateProtectedSites = wrap(async (ctx, client) => {
  const siteList = validateBatchUpdateProtectedSitesRequest(ctx.req);
  const config = buildBatchProtectedSiteConfig(ctx.req);
  const response = await client.batchUpdateProtectedSites(siteList, config);
  checkAPIResponse(response, response.statusCode);
  return {};
});

const getSSOToken = wrap(async (ctx, client) => {
  const username = requireSSOUsername(reqField(ctx.req, 'username') ?? 'admin');
  const response = await client.getSSOToken(username);
  const data = checkAPIResponse(response, response.statusCode);
  return { url: data.url || '' };
});

const getClusterInfo = wrap(async (_ctx, client) => {
  const response = await client.getClusterInfo();
  const data = checkAPIResponse(response, response.statusCode);
  const nodes = [];
  if (data.nodes && typeof data.nodes === 'object') {
    for (const [ip, nodeInfo] of Object.entries(data.nodes)) {
      nodes.push({
        ip,
        status: nodeInfo.status || 'unknown',
        version: nodeInfo.version || '',
        role: nodeInfo.role || [],
      });
    }
  }
  return {
    pre_version: data.pre_version || '',
    product_type: data.product_type || '',
    cluster_name: data.cluster_name || '',
    nodes,
  };
});

const upgradeCluster = wrap(async (ctx, client) => {
  const upgradePackage = resolveBytes(reqField(ctx.req, 'upgrade_package'), 'upgrade_package', MAX_UPGRADE_PACKAGE_BYTES);
  const response = await client.upgradeCluster(upgradePackage);
  checkAPIResponse(response, response.statusCode);
  return {};
});

const rollbackCluster = wrap(async (_ctx, client) => {
  const response = await client.rollbackCluster();
  checkAPIResponse(response, response.statusCode);
  return {};
});

const getEditorStatus = wrap(async (_ctx, client) => {
  const response = await client.getEditorStatus();
  const data = checkAPIResponse(response, response.statusCode);
  return { status: data.status || 'off' };
});

const setEditorStatus = wrap(async (ctx, client) => {
  const status = requireOnOffStatus(ctx.req.status);
  const response = await client.setEditorStatus(status);
  checkAPIResponse(response, response.statusCode);
  return {};
});

const updateWebRule = wrap(async (ctx, client) => {
  const manualRule = requireString(reqField(ctx.req, 'manual_rule'), 'manual_rule');
  const response = await client.updateWebRule(manualRule);
  checkAPIResponse(response, response.statusCode);
  return {};
});

const updateAppRule = wrap(async (ctx, client) => {
  const manualRule = requireString(reqField(ctx.req, 'manual_rule'), 'manual_rule');
  const response = await client.updateAppRule(manualRule);
  checkAPIResponse(response, response.statusCode);
  return {};
});

const getRuleStatus = wrap(async (ctx, client) => {
  const id = requireString(ctx.req.id, 'id');
  const response = await client.getRuleStatus(id);
  const data = checkAPIResponse(response, response.statusCode);
  return { status: data.status || 'off' };
});

const setRuleStatus = wrap(async (ctx, client) => {
  const id = requireString(ctx.req.id, 'id');
  const status = requireOnOffStatus(ctx.req.status);
  const response = await client.setRuleStatus(id, status);
  checkAPIResponse(response, response.statusCode);
  return {};
});

const uploadResourceFile = wrap(async (ctx, client) => {
  const fileName = requireResourceFileName(reqField(ctx.req, 'file_name'), 'file_name');
  const type = requireOneOf(reqField(ctx.req, 'type'), RESOURCE_FILE_TYPES, 'type');
  const fileContent = requireString(reqField(ctx.req, 'file_content'), 'file_content');
  if (Buffer.byteLength(fileContent, 'utf8') > MAX_RESOURCE_FILE_BYTES) {
    throw errorWithCode('INVALID_ARGUMENT', `file_content exceeds maximum size of ${MAX_RESOURCE_FILE_BYTES} bytes`);
  }
  const response = await client.uploadResourceFile(fileName, type, fileContent);
  checkAPIResponse(response, response.statusCode);
  return {};
});

const listAPIs = wrap(async (_ctx, client) => {
  const response = await client.listAPIs();
  const data = checkAPIResponse(response, response.statusCode);
  return {
    api_list: (data.api_list || []).map((api) => ({
      id: api.id || '',
      api_name: api.api_name || '',
      host: api.host || '',
      port: api.port || 0,
      path: api.path || '',
      method: api.method || '',
      protocol: api.protocol || '',
      online_status: api.online_status ?? true,
      group_id: api.group_id || '',
      group_name: api.group_name || '',
      api_manager: api.api_manager || '',
      auto_tag: api.auto_tag || '',
      manual_tags: api.manual_tags || [],
      update_time: Number(api.update_time || 0),
      match_sub_path: api.match_sub_path ?? false,
      enable_args: api.enable_args ?? false,
      api_max_body_size: api.api_max_body_size ?? -1,
      api_max_body_args_cnt: api.api_max_body_args_cnt ?? -1,
      api_max_query_args_cnt: api.api_max_query_args_cnt ?? -1,
      pii_type: api.pii_type || [],
    })),
  };
});

const addAPI = wrap(async (ctx, client) => {
  const payload = {
    api_name: requireString(reqField(ctx.req, 'api_name'), 'api_name'),
    group_name: requireString(reqField(ctx.req, 'group_name'), 'group_name'),
    method: requireString(reqField(ctx.req, 'method'), 'method'),
    port: requirePort(reqField(ctx.req, 'port'), 'port'),
    host: requireString(reqField(ctx.req, 'host'), 'host'),
    api_endpoint: requireString(reqField(ctx.req, 'api_endpoint'), 'api_endpoint'),
    match_sub_path: requireString(reqField(ctx.req, 'match_sub_path'), 'match_sub_path'),
  };
  for (const key of [
    'enable_args', 'api_max_body_args_cnt', 'api_max_query_args_cnt', 'api_max_body_size',
    'missing_header', 'forbidden_header', 'manual_tags',
  ]) {
    const value = reqField(ctx.req, key);
    if (value != null && value !== '' && value !== -1) payload[key] = value;
  }
  const response = await client.addAPI(payload);
  checkAPIResponse(response, response.statusCode);
  return {};
});

const deleteAPI = wrap(async (ctx, client) => {
  const apiId = requireString(reqField(ctx.req, 'api_id'), 'api_id');
  const response = await client.deleteAPI(apiId);
  checkAPIResponse(response, response.statusCode);
  return {};
});

const ignoreAPI = wrap(async (ctx, client) => {
  const apiId = requireString(reqField(ctx.req, 'api_id'), 'api_id');
  const response = await client.ignoreAPI(apiId);
  checkAPIResponse(response, response.statusCode);
  return {};
});

const setAPIOnlineStatus = wrap(async (ctx, client) => {
  const id = requireString(ctx.req.id, 'id');
  const status = requireOnOffStatus(ctx.req.status);
  const response = await client.setAPIOnlineStatus(id, status);
  checkAPIResponse(response, response.statusCode);
  return {};
});

export const handlers = {
  [METHOD_PATHS.getBlacklistStatus]: getBlacklistStatus,
  [METHOD_PATHS.setBlacklistStatus]: setBlacklistStatus,
  [METHOD_PATHS.getBlacklist]: getBlacklist,
  [METHOD_PATHS.setBlacklist]: setBlacklist,
  [METHOD_PATHS.addBlacklistItems]: addBlacklistItems,
  [METHOD_PATHS.clearBlacklist]: clearBlacklist,
  [METHOD_PATHS.blockIP]: blockIP,
  [METHOD_PATHS.unblockIP]: unblockIP,
  [METHOD_PATHS.listProtectedSites]: listProtectedSites,
  [METHOD_PATHS.createProtectedSite]: createProtectedSite,
  [METHOD_PATHS.getProtectedSite]: getProtectedSite,
  [METHOD_PATHS.updateProtectedSite]: updateProtectedSite,
  [METHOD_PATHS.deleteProtectedSite]: deleteProtectedSite,
  [METHOD_PATHS.batchUpdateProtectedSites]: batchUpdateProtectedSites,
  [METHOD_PATHS.getSSOToken]: getSSOToken,
  [METHOD_PATHS.getClusterInfo]: getClusterInfo,
  [METHOD_PATHS.upgradeCluster]: upgradeCluster,
  [METHOD_PATHS.rollbackCluster]: rollbackCluster,
  [METHOD_PATHS.getEditorStatus]: getEditorStatus,
  [METHOD_PATHS.setEditorStatus]: setEditorStatus,
  [METHOD_PATHS.updateWebRule]: updateWebRule,
  [METHOD_PATHS.updateAppRule]: updateAppRule,
  [METHOD_PATHS.getRuleStatus]: getRuleStatus,
  [METHOD_PATHS.setRuleStatus]: setRuleStatus,
  [METHOD_PATHS.uploadResourceFile]: uploadResourceFile,
  [METHOD_PATHS.listAPIs]: listAPIs,
  [METHOD_PATHS.addAPI]: addAPI,
  [METHOD_PATHS.deleteAPI]: deleteAPI,
  [METHOD_PATHS.ignoreAPI]: ignoreAPI,
  [METHOD_PATHS.setAPIOnlineStatus]: setAPIOnlineStatus,
};

export const rpcdef = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const defs = {};
  for (const [path, handler] of Object.entries(handlers)) {
    defs[`/${path}`] = async (req) => handler({ ...callCtx, req, request: req });
  }
  return defs;
};

export const _test = {
  EMPTY_MD5_HASH,
  buildCanonicalQueryString,
  buildBlacklistRemoveSet,
  buildCreateSitePayload,
  checkAPIResponse,
  mapAPIError,
  mapSiteSummary,
  decodeBase64,
  normalizeBlacklistItems,
  normalizeHostCIDR,
  normalizeUpstreamForAPI,
  requireOnOffStatus,
  requireResourceFileName,
  requireSSOUsername,
  reqField,
  resolveCallContext,
  resolveIpList,
  shouldRemoveBlacklistItem,
  signRequest,
  validateCreateProtectedSiteRequest,
};
