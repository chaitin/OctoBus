import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

// ---------------------------------------------------------------------------
// gRPC error helpers
// ---------------------------------------------------------------------------

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

export const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

// ---------------------------------------------------------------------------
// WAF HTTP client
// ---------------------------------------------------------------------------

export class WafClient {
  constructor({ host, username, password, verifySsl = false }) {
    this.baseUrl = String(host ?? '').replace(/\/$/, '');
    this.username = username;
    this.password = password;
    this.verifySsl = verifySsl;
    this.token = null;
  }

  async _request(method, path, body, withAuth) {
    const url = this.baseUrl + path;
    const headers = { 'Content-Type': 'application/json' };
    if (withAuth && this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const init = { method, headers };
    if (!this.verifySsl) {
      init.tlsInsecureSkipVerify = true;
      init.insecureSkipVerify = true;
    }
    if (body != null) init.body = JSON.stringify(body);

    let res;
    try {
      res = await fetch(url, init);
    } catch (e) {
      throw errorWithCode('UNAVAILABLE', e?.cause?.message ?? e?.message ?? 'network error');
    }

    let json;
    try {
      const text = await res.text();
      json = JSON.parse(text);
    } catch {
      throw errorWithCode('UNKNOWN', `non-JSON response from WAF (HTTP ${res.status})`);
    }

    if (res.status === 401 || res.status === 403) {
      throw errorWithCode('PERMISSION_DENIED', `HTTP ${res.status}`);
    }
    if (res.status >= 500) {
      throw errorWithCode('UNAVAILABLE', `HTTP ${res.status}`);
    }

    return json;
  }

  async login() {
    const pkResp = await this._request('GET', '/api/v2/system/auth/public_key/', null, false);
    if (pkResp.code !== 'SUCCESS') {
      throw errorWithCode('UNAUTHENTICATED', `public key fetch failed: ${pkResp.message}`);
    }

    const encrypted = crypto.publicEncrypt(
      { key: pkResp.data, padding: crypto.constants.RSA_PKCS1_PADDING },
      Buffer.from(this.password),
    ).toString('base64');

    const loginResp = await this._request('POST', '/api/v2/system/user/login/', {
      username: this.username,
      password: encrypted,
    }, false);

    if (loginResp.code !== 'SUCCESS') {
      throw errorWithCode('UNAUTHENTICATED', `login failed: ${loginResp.message}`);
    }

    this.token = loginResp.data.token;
  }

  async fetch(method, path, body) {
    if (!this.token) await this.login();

    const result = await this._request(method, path, body, true);

    if (result.code === 'GENERAL_TOKEN_INVALID') {
      this.token = null;
      await this.login();
      return this._request(method, path, body, true);
    }

    return result;
  }
}

// ---------------------------------------------------------------------------
// Format converters between proto and WAF API
// ---------------------------------------------------------------------------

export const wafRuleToProto = (r) => ({
  id: r._pk ?? '',
  name: r.name ?? '',
  description: r.description ?? '',
  enabled: r.enable ?? true,
  effectTimeRange: r.effect_time_range ?? '',
  conditionGroups: (r.cond_suites ?? []).map((suite) => ({
    conditions: (suite.cond_terms ?? []).map((term) => ({
      field: term.field ?? 'sip',
      ipList: term.operand ?? [],
      negate: term.neg ?? false,
    })),
  })),
  applyTo: r.adapt_new_app ?? 'all_apps',
  siteIds: r.apps ?? [],
});

export const protoToWafBody = (req, action) => {
  const condSuites = (req.conditionGroups ?? []).map((group) => ({
    cond_terms: (group.conditions ?? []).map((cond) => ({
      field: cond.field ?? 'sip',
      operator: 'exact match',
      operand: cond.ipList ?? [],
      neg: cond.negate ?? false,
    })),
  }));

  if (condSuites.length === 0) {
    throw errorWithCode(
      'INVALID_ARGUMENT',
      'conditionGroups cannot be empty; provide at least one group with one IpCondition',
    );
  }

  return {
    name: req.name,
    description: req.description ?? '',
    effect_time_range: req.effectTimeRange ?? '',
    cond_suites: condSuites,
    action: { name: action },
    adapt_new_app: req.applyTo || 'all_apps',
    apps: req.siteIds ?? [],
    enable: req.enabled !== undefined ? req.enabled : true,
  };
};

// ---------------------------------------------------------------------------
// Per-config client cache (module-level singleton for long-running service)
// ---------------------------------------------------------------------------

let _cachedClient = null;
let _cachedKey = null;

export const getClient = (ctx) => {
  const config = ctx.config ?? {};
  const secret = ctx.secret ?? {};

  if (!config.host) throw errorWithCode('INVALID_ARGUMENT', 'config.host is required (e.g. "https://10.20.187.204")');
  if (!secret.username) throw errorWithCode('INVALID_ARGUMENT', 'secret.username is required');
  if (!secret.password) throw errorWithCode('INVALID_ARGUMENT', 'secret.password is required');

  const key = JSON.stringify({ host: config.host, username: secret.username, verify_ssl: config.verify_ssl });
  if (_cachedClient && _cachedKey === key) return _cachedClient;

  _cachedClient = new WafClient({
    host: config.host,
    username: secret.username,
    password: secret.password,
    verifySsl: config.verify_ssl ?? false,
  });
  _cachedKey = key;
  return _cachedClient;
};

// ---------------------------------------------------------------------------
// Shared API path constants
// ---------------------------------------------------------------------------

const BASIC_PATH = '/api/v1/security/basic_rules/';
const CONTROL_PATH = '/api/v1/security/control_rules/';
const SITES_PATH = '/api/v1/website/site/';

// ---------------------------------------------------------------------------
// Shared handler helpers
// ---------------------------------------------------------------------------

const listRules = async (ctx, path) => {
  const req = ctx.request ?? {};
  const p = new URLSearchParams();
  if (req.page > 0) p.set('page', String(req.page));
  if (req.perPage > 0) p.set('per_page', String(req.perPage));
  if (req.nameFilter) p.set('name', req.nameFilter);
  if (req.siteId) p.set('apps', req.siteId);

  const resp = await getClient(ctx).fetch('GET', `${path}?${p}`);
  if (resp.code !== 'SUCCESS') throw errorWithCode('UNKNOWN', `WAF error: ${resp.message}`);

  return {
    total: resp.data.count,
    page: resp.data.page,
    perPage: resp.data.per_page,
    rules: (resp.data.result ?? []).map(wafRuleToProto),
  };
};

const createRule = async (ctx, path, action) => {
  const body = protoToWafBody(ctx.request ?? {}, action);
  const resp = await getClient(ctx).fetch('POST', path, body);
  if (resp.code !== 'SUCCESS') throw errorWithCode('UNKNOWN', `WAF error: ${resp.message}`);
  return { id: resp.data._pk, name: resp.data.name, enabled: resp.data.enable };
};

const updateRule = async (ctx, path, action) => {
  const req = ctx.request ?? {};
  if (!req.id) throw errorWithCode('INVALID_ARGUMENT', 'id is required for update');
  const body = protoToWafBody(req, action);
  const resp = await getClient(ctx).fetch('PUT', `${path}${req.id}/`, body);
  if (resp.code !== 'SUCCESS') throw errorWithCode('UNKNOWN', `WAF error: ${resp.message}`);
  return { id: resp.data._pk, name: resp.data.name, enabled: resp.data.enable };
};

const deleteRule = async (ctx, path) => {
  const req = ctx.request ?? {};
  if (!req.id) throw errorWithCode('INVALID_ARGUMENT', 'id is required for delete');
  const resp = await getClient(ctx).fetch('DELETE', `${path}${req.id}/`);
  if (resp.code !== 'SUCCESS') throw errorWithCode('UNKNOWN', `WAF error: ${resp.message}`);
  return { success: true };
};

// ---------------------------------------------------------------------------
// Exported gRPC handlers
// ---------------------------------------------------------------------------

export const handlers = {
  // 基础规则 - IP 阻断 (action=deny)
  'mingyu_waf.v1.WafService/ListBlockRules': (ctx) => listRules(ctx, BASIC_PATH),
  'mingyu_waf.v1.WafService/CreateBlockRule': (ctx) => createRule(ctx, BASIC_PATH, 'deny'),
  'mingyu_waf.v1.WafService/UpdateBlockRule': (ctx) => updateRule(ctx, BASIC_PATH, 'deny'),
  'mingyu_waf.v1.WafService/DeleteBlockRule': (ctx) => deleteRule(ctx, BASIC_PATH),

  // 防护控制规则 - IP 白名单 (action=allow)
  'mingyu_waf.v1.WafService/ListAllowRules': (ctx) => listRules(ctx, CONTROL_PATH),
  'mingyu_waf.v1.WafService/CreateAllowRule': (ctx) => createRule(ctx, CONTROL_PATH, 'allow'),
  'mingyu_waf.v1.WafService/UpdateAllowRule': (ctx) => updateRule(ctx, CONTROL_PATH, 'allow'),
  'mingyu_waf.v1.WafService/DeleteAllowRule': (ctx) => deleteRule(ctx, CONTROL_PATH),

  // 站点查询
  'mingyu_waf.v1.WafService/ListSites': async (ctx) => {
    const req = ctx.request ?? {};
    const p = new URLSearchParams();
    if (req.page > 0) p.set('page', String(req.page));
    if (req.perPage > 0) p.set('per_page', String(req.perPage));
    if (req.nameFilter) p.set('name', req.nameFilter);

    const resp = await getClient(ctx).fetch('GET', `${SITES_PATH}?${p}`);
    if (resp.code !== 'SUCCESS') throw errorWithCode('UNKNOWN', `WAF error: ${resp.message}`);

    return {
      total: resp.data.count,
      sites: (resp.data.result ?? []).map((s) => ({
        id: s._pk,
        name: s.name,
        type: s.type,
        enabled: s.enable,
      })),
    };
  },
};

// ---------------------------------------------------------------------------
// Test-only exports
// ---------------------------------------------------------------------------

export const _test = {
  resetClient: () => {
    _cachedClient = null;
    _cachedKey = null;
  },
  errorWithCode,
  WafClient,
  wafRuleToProto,
  protoToWafBody,
  getClient,
};
