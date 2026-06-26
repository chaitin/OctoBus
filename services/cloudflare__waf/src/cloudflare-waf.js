// Cloudflare_WAF — proxy for Cloudflare API v4 IP access rules and zone security level.
// Capabilities: BlockIP, UnblockIP, ListAccessRules, GetSecurityLevel, SetSecurityLevel.
// Bindings (config): endpoint/baseUrl, zoneId, accountId, headers, timeoutMs, skipTlsVerify.
// Bindings (secret): apiToken (Bearer) OR authEmail + authKey (legacy global key).

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const DEFAULT_ENDPOINT = 'https://api.cloudflare.com/client/v4';
const DEFAULT_TIMEOUT_MS = 1500;
const DEFAULT_MODE = 'block';
const ACCESS_RULE_MODES = ['block', 'challenge', 'whitelist', 'js_challenge', 'managed_challenge'];
const SECURITY_LEVELS = ['off', 'essentially_off', 'low', 'medium', 'high', 'under_attack'];
const MAX_PER_PAGE = 1000;

const PKG = 'Cloudflare_WAF.Cloudflare_WAF';
const BLOCK_IP_PATH = `/${PKG}/BlockIP`;
const UNBLOCK_IP_PATH = `/${PKG}/UnblockIP`;
const LIST_ACCESS_RULES_PATH = `/${PKG}/ListAccessRules`;
const GET_SECURITY_LEVEL_PATH = `/${PKG}/GetSecurityLevel`;
const SET_SECURITY_LEVEL_PATH = `/${PKG}/SetSecurityLevel`;

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  DEADLINE_EXCEEDED: grpcStatus.DEADLINE_EXCEEDED,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const firstDefined = (...vals) => vals.find((v) => v !== undefined && v !== null);

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.secret ?? {}),
  ...(ctx?.bindings ?? {}),
});

const parseHeaders = (value) => {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      return {};
    }
  }
  return {};
};

const normalizeBaseUrl = (url) => {
  const base = String(url || '').trim();
  if (!/^https?:\/\//i.test(base)) return null;
  return base.replace(/\/$/, '');
};

const unwrapValue = (source) => {
  if (source !== null && typeof source === 'object' && 'value' in source) return source.value;
  return source;
};

const toOptionalString = (val) => {
  const raw = unwrapValue(val);
  if (raw === undefined || raw === null) return undefined;
  const str = String(raw).trim();
  return str === '' ? undefined : str;
};

const toPositiveInt = (val) => {
  const raw = unwrapValue(val);
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || Number.isNaN(n)) return null;
  return n;
};

const requireTargets = (req, keys) => {
  for (const key of keys) {
    if (hasOwn(req, key)) {
      const val = req[key];
      if (!Array.isArray(val)) {
        throw errorWithCode('INVALID_ARGUMENT', `${key} must be an array`);
      }
      if (val.length === 0) {
        throw errorWithCode('INVALID_ARGUMENT', `${key} must be non-empty`);
      }
      return val.map((item) => {
        if (item === undefined || item === null || String(item).trim() === '') {
          throw errorWithCode('INVALID_ARGUMENT', `${key} elements must be non-empty strings`);
        }
        return String(item).trim();
      });
    }
  }
  throw errorWithCode('INVALID_ARGUMENT', `${keys[0]} is required`);
};

const normalizeMode = (req, { required } = {}) => {
  const raw = toOptionalString(firstDefined(req?.mode, req?.Mode));
  if (raw === undefined) {
    return required ? DEFAULT_MODE : undefined;
  }
  if (!ACCESS_RULE_MODES.includes(raw)) {
    throw errorWithCode('INVALID_ARGUMENT', `mode must be one of ${ACCESS_RULE_MODES.join(', ')}`);
  }
  return raw;
};

// Cloudflare access-rule "configuration.target" inferred from value shape.
const inferTarget = (value) => {
  const v = String(value).trim();
  if (v.includes('/')) return 'ip_range';
  return 'ip';
};

const toStructValue = (val) => {
  if (val === undefined || val === null) return undefined;
  if (typeof val !== 'object' || Array.isArray(val)) return undefined;
  const fields = {};
  for (const [k, v] of Object.entries(val)) {
    fields[k] = jsonToValue(v);
  }
  return { fields };
};

const jsonToValue = (val) => {
  if (val === undefined || val === null) return { nullValue: 'NULL_VALUE' };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'number') return { numberValue: val };
  if (typeof val === 'boolean') return { boolValue: val };
  if (Array.isArray(val)) {
    return { listValue: { values: val.map((item) => jsonToValue(item)) } };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      fields[k] = jsonToValue(v);
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(val) };
};

const mapAccessRule = (rule, scope) => {
  const config = rule?.configuration && typeof rule.configuration === 'object' ? rule.configuration : {};
  return {
    id: String(rule?.id ?? ''),
    mode: String(rule?.mode ?? ''),
    target: String(config?.target ?? ''),
    value: String(config?.value ?? ''),
    notes: String(rule?.notes ?? ''),
    scope: scope ?? '',
  };
};

export function rpcdef(ctx) {
  const bindings = mergedBindings(ctx);
  const endpoint = normalizeBaseUrl(bindings.endpoint || bindings.baseUrl || bindings.base_url || DEFAULT_ENDPOINT)
    || DEFAULT_ENDPOINT;
  const configZoneId = toOptionalString(bindings.zoneId || bindings.zone_id);
  const configAccountId = toOptionalString(bindings.accountId || bindings.account_id);
  const timeoutMs = ctx.limits?.timeoutMs || Number(bindings.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const baseHeaders = parseHeaders(bindings.headers);
  const meta = ctx.meta || {};
  const skipTlsVerify = Boolean(
    bindings.skipTlsVerify || bindings.skip_tls_verify || bindings.tlsInsecureSkipVerify || bindings.tls_insecure_skip_verify,
  );

  const apiToken = toOptionalString(bindings.apiToken || bindings.api_token);
  const authEmail = toOptionalString(bindings.authEmail || bindings.auth_email);
  const authKey = toOptionalString(bindings.authKey || bindings.auth_key);

  const buildAuthHeaders = () => {
    if (apiToken) {
      return { authorization: `Bearer ${apiToken}` };
    }
    if (authEmail && authKey) {
      return { 'x-auth-email': authEmail, 'x-auth-key': authKey };
    }
    throw errorWithCode('INVALID_ARGUMENT', 'apiToken (or authEmail + authKey) is required');
  };

  const buildHeaders = (extra = {}) => ({
    ...baseHeaders,
    ...buildAuthHeaders(),
    'x-engine-instance': meta.instance_id || meta.instanceId || 'unknown',
    'x-request-id': meta.request_id || meta.requestId || 'unknown',
    ...extra,
  });

  const tlsOptions = () => (skipTlsVerify
    ? { insecureSkipVerify: true, tlsInsecureSkipVerify: true }
    : {});

  const callCloudflare = async (url, init) => {
    let res;
    try {
      res = await fetch(url, { ...init, timeoutMs, ...tlsOptions() });
    } catch (e) {
      const reason = e?.cause?.message || e?.message || 'fetch failed';
      throw errorWithCode('UNAVAILABLE', reason);
    }

    const text = await res.text();
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw errorWithCode('PERMISSION_DENIED', `upstream http ${res.status}: ${text}`);
      }
      if (res.status >= 400 && res.status < 500) {
        throw errorWithCode('FAILED_PRECONDITION', `upstream http ${res.status}: ${text}`);
      }
      throw errorWithCode('UNAVAILABLE', `upstream http ${res.status}: ${text}`);
    }

    if (!text.trim()) return { success: true, result: null, result_info: {} };

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw errorWithCode('UNKNOWN', 'response is not valid JSON');
    }

    if (json && json.success === false) {
      const detail = Array.isArray(json.errors) ? JSON.stringify(json.errors) : 'cloudflare reported success=false';
      const authFailure = Array.isArray(json.errors)
        && json.errors.some((e) => Number(e?.code) === 9109 || Number(e?.code) === 10000);
      throw errorWithCode(authFailure ? 'PERMISSION_DENIED' : 'FAILED_PRECONDITION', detail);
    }
    return json;
  };

  // Resolve access-rule scope: account_id (request/config) wins, else zone_id.
  const resolveRuleScope = (req) => {
    const accountId = toOptionalString(firstDefined(req?.account_id, req?.accountId)) || configAccountId;
    if (accountId) {
      return { scope: 'account', base: `${endpoint}/accounts/${encodeURIComponent(accountId)}/firewall/access_rules/rules` };
    }
    const zoneId = toOptionalString(firstDefined(req?.zone_id, req?.zoneId)) || configZoneId;
    if (zoneId) {
      return { scope: 'zone', base: `${endpoint}/zones/${encodeURIComponent(zoneId)}/firewall/access_rules/rules` };
    }
    throw errorWithCode('INVALID_ARGUMENT', 'zone_id or account_id is required (set in request or config)');
  };

  const resolveZoneId = (req) => {
    const zoneId = toOptionalString(firstDefined(req?.zone_id, req?.zoneId)) || configZoneId;
    if (!zoneId) {
      throw errorWithCode('INVALID_ARGUMENT', 'zone_id is required (set in request or config)');
    }
    return zoneId;
  };

  const fetchRulesForValue = async (scopeInfo, value, mode) => {
    const query = [`configuration.value=${encodeURIComponent(value)}`, 'per_page=50'];
    if (mode) query.push(`mode=${encodeURIComponent(mode)}`);
    const url = `${scopeInfo.base}?${query.join('&')}`;
    const json = await callCloudflare(url, { method: 'GET', headers: buildHeaders() });
    const result = Array.isArray(json?.result) ? json.result : [];
    return result;
  };

  const callBlockIp = async (req) => {
    const targets = requireTargets(req, ['targets', 'Targets']);
    const mode = normalizeMode(req, { required: true });
    const notes = toOptionalString(firstDefined(req?.notes, req?.Notes));
    const scopeInfo = resolveRuleScope(req);

    const rules = [];
    let createdCount = 0;
    for (const value of targets) {
      const existing = await fetchRulesForValue(scopeInfo, value, mode);
      const match = existing.find((r) => String(r?.configuration?.value) === value && String(r?.mode) === mode);
      if (match) {
        rules.push(mapAccessRule(match, scopeInfo.scope));
        continue;
      }
      const payload = {
        mode,
        configuration: { target: inferTarget(value), value },
      };
      if (notes !== undefined) payload.notes = notes;
      const json = await callCloudflare(scopeInfo.base, {
        method: 'POST',
        headers: buildHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      rules.push(mapAccessRule(json?.result ?? {}, scopeInfo.scope));
      createdCount += 1;
    }

    return { rules, created_count: createdCount };
  };

  const callUnblockIp = async (req) => {
    const targets = requireTargets(req, ['targets', 'Targets']);
    const mode = normalizeMode(req, { required: false });
    const scopeInfo = resolveRuleScope(req);

    const deletedIds = [];
    for (const value of targets) {
      const existing = await fetchRulesForValue(scopeInfo, value, mode);
      const matches = existing.filter((r) => String(r?.configuration?.value) === value
        && (mode === undefined || String(r?.mode) === mode));
      for (const rule of matches) {
        const id = String(rule?.id ?? '');
        if (!id) continue;
        await callCloudflare(`${scopeInfo.base}/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: buildHeaders(),
        });
        deletedIds.push(id);
      }
    }

    return { deleted_ids: deletedIds, deleted_count: deletedIds.length };
  };

  const callListAccessRules = async (req) => {
    const scopeInfo = resolveRuleScope(req);
    const value = toOptionalString(firstDefined(req?.value, req?.Value));
    const mode = normalizeMode(req, { required: false });

    const page = toPositiveInt(firstDefined(req?.page, req?.Page));
    if (page === null || (page !== undefined && page < 1)) {
      throw errorWithCode('INVALID_ARGUMENT', 'page must be an integer >= 1');
    }
    const perPage = toPositiveInt(firstDefined(req?.per_page, req?.perPage));
    if (perPage === null || (perPage !== undefined && (perPage < 1 || perPage > MAX_PER_PAGE))) {
      throw errorWithCode('INVALID_ARGUMENT', `per_page must be an integer in [1, ${MAX_PER_PAGE}]`);
    }

    const query = [];
    if (value !== undefined) query.push(`configuration.value=${encodeURIComponent(value)}`);
    if (mode !== undefined) query.push(`mode=${encodeURIComponent(mode)}`);
    if (page !== undefined) query.push(`page=${page}`);
    if (perPage !== undefined) query.push(`per_page=${perPage}`);

    const url = `${scopeInfo.base}${query.length ? `?${query.join('&')}` : ''}`;
    const json = await callCloudflare(url, { method: 'GET', headers: buildHeaders() });
    const result = Array.isArray(json?.result) ? json.result : [];
    const totalCount = (() => {
      const n = Number(json?.result_info?.total_count);
      return Number.isInteger(n) && !Number.isNaN(n) ? n : result.length;
    })();

    return {
      rules: result.map((rule) => mapAccessRule(rule, scopeInfo.scope)),
      total_count: totalCount,
    };
  };

  const callGetSecurityLevel = async (req) => {
    const zoneId = resolveZoneId(req);
    const url = `${endpoint}/zones/${encodeURIComponent(zoneId)}/settings/security_level`;
    const json = await callCloudflare(url, { method: 'GET', headers: buildHeaders() });
    const result = json?.result && typeof json.result === 'object' ? json.result : {};
    return {
      value: String(result?.value ?? ''),
      raw: toStructValue(result),
    };
  };

  const callSetSecurityLevel = async (req) => {
    const zoneId = resolveZoneId(req);
    const value = toOptionalString(firstDefined(req?.value, req?.Value));
    if (value === undefined) {
      throw errorWithCode('INVALID_ARGUMENT', 'value is required');
    }
    if (!SECURITY_LEVELS.includes(value)) {
      throw errorWithCode('INVALID_ARGUMENT', `value must be one of ${SECURITY_LEVELS.join(', ')}`);
    }
    const url = `${endpoint}/zones/${encodeURIComponent(zoneId)}/settings/security_level`;
    const json = await callCloudflare(url, {
      method: 'PATCH',
      headers: buildHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ value }),
    });
    const result = json?.result && typeof json.result === 'object' ? json.result : {};
    return {
      value: String(result?.value ?? value),
      raw: toStructValue(result),
    };
  };

  return {
    [BLOCK_IP_PATH]: async () => callBlockIp(ctx.req ?? {}),
    [UNBLOCK_IP_PATH]: async () => callUnblockIp(ctx.req ?? {}),
    [LIST_ACCESS_RULES_PATH]: async () => callListAccessRules(ctx.req ?? {}),
    [GET_SECURITY_LEVEL_PATH]: async () => callGetSecurityLevel(ctx.req ?? {}),
    [SET_SECURITY_LEVEL_PATH]: async () => callSetSecurityLevel(ctx.req ?? {}),
  };
}

const mergeCtx = (baseCtx, innerCtx) => ({
  ...(baseCtx ?? {}),
  ...(innerCtx ?? {}),
  bindings: { ...(baseCtx?.bindings ?? {}), ...(innerCtx?.bindings ?? {}) },
  config: { ...(baseCtx?.config ?? {}), ...(innerCtx?.config ?? {}) },
  secret: { ...(baseCtx?.secret ?? {}), ...(innerCtx?.secret ?? {}) },
  limits: innerCtx?.limits ?? baseCtx?.limits ?? {},
  meta: innerCtx?.meta ?? baseCtx?.meta ?? {},
  metadata: innerCtx?.metadata ?? baseCtx?.metadata ?? {},
  getMetadata: innerCtx?.getMetadata ?? baseCtx?.getMetadata,
});

const resolveCallContext = (baseCtx, reqOrCtx, maybeInnerCtx) => {
  if (maybeInnerCtx !== undefined) {
    return { req: reqOrCtx ?? {}, ctx: mergeCtx(baseCtx, maybeInnerCtx) };
  }
  const innerCtx = reqOrCtx ?? {};
  return {
    req: innerCtx.request ?? innerCtx.req ?? {},
    ctx: mergeCtx(baseCtx, innerCtx),
  };
};

const wrapLegacyHandler = (baseCtx, methodPath) => async (reqOrCtx, maybeInnerCtx) => {
  const call = resolveCallContext(baseCtx, reqOrCtx, maybeInnerCtx);
  const legacyCtx = { ...call.ctx, req: call.req };
  return rpcdef(legacyCtx)[methodPath]();
};

const registerHandlers = (ctx = {}) => ({
  [BLOCK_IP_PATH]: wrapLegacyHandler(ctx, BLOCK_IP_PATH),
  [UNBLOCK_IP_PATH]: wrapLegacyHandler(ctx, UNBLOCK_IP_PATH),
  [LIST_ACCESS_RULES_PATH]: wrapLegacyHandler(ctx, LIST_ACCESS_RULES_PATH),
  [GET_SECURITY_LEVEL_PATH]: wrapLegacyHandler(ctx, GET_SECURITY_LEVEL_PATH),
  [SET_SECURITY_LEVEL_PATH]: wrapLegacyHandler(ctx, SET_SECURITY_LEVEL_PATH),
});

export const METHOD_BLOCK_IP_FULL = `${PKG}/BlockIP`;
export const METHOD_UNBLOCK_IP_FULL = `${PKG}/UnblockIP`;
export const METHOD_LIST_ACCESS_RULES_FULL = `${PKG}/ListAccessRules`;
export const METHOD_GET_SECURITY_LEVEL_FULL = `${PKG}/GetSecurityLevel`;
export const METHOD_SET_SECURITY_LEVEL_FULL = `${PKG}/SetSecurityLevel`;

const sdkHandlers = registerHandlers({});

export const handlers = {
  [METHOD_BLOCK_IP_FULL]: (ctx) => sdkHandlers[BLOCK_IP_PATH](ctx),
  [METHOD_UNBLOCK_IP_FULL]: (ctx) => sdkHandlers[UNBLOCK_IP_PATH](ctx),
  [METHOD_LIST_ACCESS_RULES_FULL]: (ctx) => sdkHandlers[LIST_ACCESS_RULES_PATH](ctx),
  [METHOD_GET_SECURITY_LEVEL_FULL]: (ctx) => sdkHandlers[GET_SECURITY_LEVEL_PATH](ctx),
  [METHOD_SET_SECURITY_LEVEL_FULL]: (ctx) => sdkHandlers[SET_SECURITY_LEVEL_PATH](ctx),
};

export const _test = {
  errorWithCode,
  firstDefined,
  inferTarget,
  mapAccessRule,
  mergedBindings,
  normalizeBaseUrl,
  normalizeMode,
  parseHeaders,
  registerHandlers,
  requireTargets,
  resolveCallContext,
  toOptionalString,
  toPositiveInt,
  toStructValue,
  ACCESS_RULE_MODES,
  SECURITY_LEVELS,
};
