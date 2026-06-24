#!/usr/bin/env node
import https from 'node:https';
import crypto from 'node:crypto';
import { defineService, runServiceMain } from '@chaitin-ai/octobus-sdk';

// ---------------------------------------------------------------------------
// WAF HTTP Client
// ---------------------------------------------------------------------------

class WafClient {
  constructor({ host, username, password, verifySsl = false }) {
    this.baseUrl = host.replace(/\/$/, '');
    this.username = username;
    this.password = password;
    this.token = null;
    this.agent = new https.Agent({ rejectUnauthorized: verifySsl });
  }

  async fetch(method, path, body) {
    if (!this.token) await this.login();

    const result = await this._request(method, path, body, true);

    // Re-login if token expired
    if (result.code === 'GENERAL_TOKEN_INVALID') {
      this.token = null;
      await this.login();
      return this._request(method, path, body, true);
    }

    return result;
  }

  async login() {
    // Step 1: fetch RSA public key
    const pkResp = await this._request('GET', '/api/v2/system/auth/public_key/', null, false);
    if (pkResp.code !== 'SUCCESS') {
      throw new Error(`WAF public key fetch failed: ${pkResp.message}`);
    }

    // Step 2: encrypt password with RSA-PKCS1v15
    const encrypted = crypto.publicEncrypt(
      { key: pkResp.data, padding: crypto.constants.RSA_PKCS1_PADDING },
      Buffer.from(this.password),
    ).toString('base64');

    // Step 3: login and store JWT token
    const loginResp = await this._request('POST', '/api/v2/system/user/login/', {
      username: this.username,
      password: encrypted,
    }, false);

    if (loginResp.code !== 'SUCCESS') {
      throw new Error(`WAF login failed: ${loginResp.message}`);
    }

    this.token = loginResp.data.token;
  }

  _request(method, path, body, withAuth) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + path);
      const headers = { 'Content-Type': 'application/json' };
      if (withAuth && this.token) headers['Authorization'] = `Bearer ${this.token}`;

      const bodyStr = body ? JSON.stringify(body) : null;
      if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);

      const req = https.request({
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers,
        agent: this.agent,
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch {
            reject(new Error(
              `Non-JSON response from WAF (HTTP ${res.statusCode}): ${Buffer.concat(chunks).toString().slice(0, 200)}`
            ));
          }
        });
      });

      req.on('error', reject);
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }
}

// ---------------------------------------------------------------------------
// Format converters between proto and WAF API
// ---------------------------------------------------------------------------

function wafRuleToProto(r) {
  return {
    id: r._pk ?? '',
    name: r.name ?? '',
    description: r.description ?? '',
    enabled: r.enable ?? true,
    effectTimeRange: r.effect_time_range ?? '',
    conditionGroups: (r.cond_suites ?? []).map(suite => ({
      conditions: (suite.cond_terms ?? []).map(term => ({
        field: term.field ?? 'sip',
        ipList: term.operand ?? [],
        negate: term.neg ?? false,
      })),
    })),
    applyTo: r.adapt_new_app ?? 'all_apps',
    siteIds: r.apps ?? [],
  };
}

function protoToWafBody(req, action) {
  const condSuites = (req.conditionGroups ?? []).map(group => ({
    cond_terms: (group.conditions ?? []).map(cond => ({
      field: cond.field ?? 'sip',
      operator: 'exact match',
      operand: cond.ipList ?? [],
      neg: cond.negate ?? false,
    })),
  }));

  if (condSuites.length === 0) {
    throw new Error(
      'conditionGroups cannot be empty. Provide at least one group with one IpCondition.'
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
}

// ---------------------------------------------------------------------------
// Singleton WAF client (initialized from first request context)
// ---------------------------------------------------------------------------

let wafClient = null;

function getClient(ctx) {
  if (!wafClient) {
    const config = ctx.config ?? {};
    const secret = ctx.secret ?? {};
    if (!config.host) throw new Error('config.host is required (e.g. "https://10.20.187.204")');
    if (!secret.username) throw new Error('secret.username is required');
    if (!secret.password) throw new Error('secret.password is required');

    wafClient = new WafClient({
      host: config.host,
      username: secret.username,
      password: secret.password,
      verifySsl: config.verify_ssl ?? false,
    });
  }
  return wafClient;
}

// ---------------------------------------------------------------------------
// Shared handler helpers
// ---------------------------------------------------------------------------

const BASIC_PATH   = '/api/v1/security/basic_rules/';
const CONTROL_PATH = '/api/v1/security/control_rules/';
const SITES_PATH   = '/api/v1/website/site/';

async function listRules(ctx, path) {
  const req = ctx.request;
  const p = new URLSearchParams();
  if (req.page > 0) p.set('page', String(req.page));
  if (req.perPage > 0) p.set('per_page', String(req.perPage));
  if (req.nameFilter) p.set('name', req.nameFilter);
  if (req.siteId) p.set('apps', req.siteId);

  const resp = await getClient(ctx).fetch('GET', `${path}?${p}`);
  if (resp.code !== 'SUCCESS') throw new Error(`WAF error: ${resp.message}`);

  return {
    total: resp.data.count,
    page: resp.data.page,
    perPage: resp.data.per_page,
    rules: (resp.data.result ?? []).map(wafRuleToProto),
  };
}

async function createRule(ctx, path, action) {
  const body = protoToWafBody(ctx.request, action);
  const resp = await getClient(ctx).fetch('POST', path, body);
  if (resp.code !== 'SUCCESS') throw new Error(`WAF error: ${resp.message}`);
  return { id: resp.data._pk, name: resp.data.name, enabled: resp.data.enable };
}

async function updateRule(ctx, path, action) {
  const req = ctx.request;
  if (!req.id) throw new Error('id is required for update');
  const body = protoToWafBody(req, action);
  const resp = await getClient(ctx).fetch('PUT', `${path}${req.id}/`, body);
  if (resp.code !== 'SUCCESS') throw new Error(`WAF error: ${resp.message}`);
  return { id: resp.data._pk, name: resp.data.name, enabled: resp.data.enable };
}

async function deleteRule(ctx, path) {
  const req = ctx.request;
  if (!req.id) throw new Error('id is required for delete');
  const resp = await getClient(ctx).fetch('DELETE', `${path}${req.id}/`);
  if (resp.code !== 'SUCCESS') throw new Error(`WAF error: ${resp.message}`);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Service definition
// ---------------------------------------------------------------------------

const service = defineService({
  handlers: {
    // 基础规则 - IP阻断 (action=deny)
    'mingyu_waf.v1.WafService/ListBlockRules':  ctx => listRules(ctx, BASIC_PATH),
    'mingyu_waf.v1.WafService/CreateBlockRule': ctx => createRule(ctx, BASIC_PATH, 'deny'),
    'mingyu_waf.v1.WafService/UpdateBlockRule': ctx => updateRule(ctx, BASIC_PATH, 'deny'),
    'mingyu_waf.v1.WafService/DeleteBlockRule': ctx => deleteRule(ctx, BASIC_PATH),

    // 防护控制规则 - IP白名单 (action=allow)
    'mingyu_waf.v1.WafService/ListAllowRules':  ctx => listRules(ctx, CONTROL_PATH),
    'mingyu_waf.v1.WafService/CreateAllowRule': ctx => createRule(ctx, CONTROL_PATH, 'allow'),
    'mingyu_waf.v1.WafService/UpdateAllowRule': ctx => updateRule(ctx, CONTROL_PATH, 'allow'),
    'mingyu_waf.v1.WafService/DeleteAllowRule': ctx => deleteRule(ctx, CONTROL_PATH),

    // 站点查询
    'mingyu_waf.v1.WafService/ListSites': async ctx => {
      const req = ctx.request;
      const p = new URLSearchParams();
      if (req.page > 0) p.set('page', String(req.page));
      if (req.perPage > 0) p.set('per_page', String(req.perPage));
      if (req.nameFilter) p.set('name', req.nameFilter);

      const resp = await getClient(ctx).fetch('GET', `${SITES_PATH}?${p}`);
      if (resp.code !== 'SUCCESS') throw new Error(`WAF error: ${resp.message}`);

      return {
        total: resp.data.count,
        sites: (resp.data.result ?? []).map(s => ({
          id: s._pk,
          name: s.name,
          type: s.type,
          enabled: s.enable,
        })),
      };
    },
  },
});

runServiceMain(service);
