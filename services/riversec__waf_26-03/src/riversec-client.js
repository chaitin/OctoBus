import crypto from 'node:crypto';
import { URL } from 'node:url';

export const EMPTY_MD5_HASH = 'd41d8cd98f00b204e9800998ecf8427e';

let insecureTlsRefCount = 0;
let previousTlsReject;

function enterInsecureTls() {
  if (insecureTlsRefCount === 0) {
    previousTlsReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }
  insecureTlsRefCount += 1;
}

function leaveInsecureTls() {
  insecureTlsRefCount = Math.max(0, insecureTlsRefCount - 1);
  if (insecureTlsRefCount === 0) {
    if (previousTlsReject === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsReject;
    }
    previousTlsReject = undefined;
  }
}

export function rfc3986Encode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
    .replace(/~/g, '%7E');
}

export function buildCanonicalQueryString(params = {}) {
  const sorted = Object.keys(params).sort();
  const parts = [];
  for (const key of sorted) {
    const value = params[key] != null ? String(params[key]) : '';
    parts.push(`${rfc3986Encode(key)}=${rfc3986Encode(value)}`);
  }
  return parts.join('&');
}

export function signRequest(method, baseUrl, path, queryParams, body, tokenId, tokenValue) {
  const url = new URL(path, baseUrl);
  const methodUpper = method.toUpperCase();
  const canonicalURI = encodeURI(url.pathname);
  const canonicalQueryString = buildCanonicalQueryString(queryParams);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomUUID();
  const bodyStr = body && methodUpper !== 'GET' && methodUpper !== 'DELETE' ? body : '';
  const bodyHash = bodyStr
    ? crypto.createHash('md5').update(bodyStr, 'utf8').digest('hex')
    : EMPTY_MD5_HASH;

  const canonicalRequest = [
    methodUpper,
    canonicalURI,
    canonicalQueryString,
    timestamp,
    nonce,
    tokenId,
    bodyHash,
  ].join('\n');

  const signature = crypto
    .createHmac('sha256', tokenValue)
    .update(canonicalRequest, 'utf8')
    .digest('hex');

  const signParams = {
    ...queryParams,
    timestamp,
    nonce,
    tokenid: tokenId,
    signature,
  };
  const finalQueryString = buildCanonicalQueryString(signParams);
  const fullUrl = `${url.origin}${url.pathname}?${finalQueryString}`;

  return { url: fullUrl, signature, timestamp, nonce, canonicalRequest };
}

const toBoolean = (value) => {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return undefined;
};

export function resolveVerifySSL(config = {}) {
  const skip = toBoolean(config.skipTlsVerify)
    ?? toBoolean(config.tlsInsecureSkipVerify)
    ?? toBoolean(config.insecureSkipVerify);
  if (skip === true) return false;
  const verify = toBoolean(config.verifySSL);
  if (verify === true) return true;
  if (verify === false) return false;
  return false;
}

function ensureNoProxyForHost(baseUrl) {
  let host;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    return;
  }
  for (const key of ['NO_PROXY', 'no_proxy']) {
    const current = process.env[key] || '';
    const entries = current.split(',').map((entry) => entry.trim()).filter(Boolean);
    if (entries.includes('*') || entries.includes(host)) continue;
    process.env[key] = current ? `${current},${host}` : host;
  }
}

function normalizeHeaders(headers = {}) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return {};
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value != null && value !== '') normalized[key] = String(value);
  }
  return normalized;
}

export class RiversecClient {
  constructor(config = {}, secret = {}) {
    const baseUrl = config.baseUrl || config.host || config.endpoint || '';
    this.baseUrl = String(baseUrl).replace(/\/$/, '');
    if (!/^https?:\/\//i.test(this.baseUrl)) {
      throw new Error('baseUrl must be an http(s) URL');
    }
    this.tokenId = secret.tokenId || secret.token_id || '';
    this.tokenValue = secret.tokenValue || secret.token_value || secret.token || '';
    this.timeout = config.timeout ?? config.timeoutMs ?? 30000;
    this.verifySSL = resolveVerifySSL(config);
    this.maxRetries = config.maxRetries ?? 0;
    this.defaultHeaders = normalizeHeaders(config.headers);
    ensureNoProxyForHost(this.baseUrl);
  }

  async request(method, path, { query = {}, body = null, rawBody = false } = {}) {
    const bodyStr = body != null && !rawBody ? JSON.stringify(body) : (rawBody ? body : null);
    const { url } = signRequest(
      method,
      this.baseUrl,
      path,
      query,
      bodyStr,
      this.tokenId,
      this.tokenValue,
    );

    const headers = { ...this.defaultHeaders };
    if (bodyStr != null && method.toUpperCase() !== 'GET') {
      headers['Content-Type'] = rawBody ? 'application/octet-stream' : 'application/json';
    }

    let lastError = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);
      try {
        const fetchOptions = {
          method: method.toUpperCase(),
          headers,
          signal: controller.signal,
        };
        if (bodyStr != null && method.toUpperCase() !== 'GET') {
          fetchOptions.body = bodyStr;
        }

        if (!this.verifySSL) enterInsecureTls();
        let response;
        try {
          response = await fetch(url, fetchOptions);
        } finally {
          if (!this.verifySSL) leaveInsecureTls();
        }
        clearTimeout(timer);

        const contentType = response.headers.get('content-type') || '';
        let data;
        if (contentType.includes('application/json')) {
          data = await response.json();
        } else {
          const text = await response.text();
          try {
            data = JSON.parse(text);
          } catch {
            data = { _raw: text };
          }
        }

        return {
          statusCode: response.status,
          data,
          headers: Object.fromEntries(response.headers.entries()),
        };
      } catch (err) {
        clearTimeout(timer);
        lastError = err;
        if (attempt < this.maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, (2 ** attempt) * 1000));
        }
      }
    }

    const reason = lastError?.cause?.message || lastError?.message || 'fetch failed';
    const error = new Error(reason);
    error.code = lastError?.code || lastError?.cause?.code;
    error.name = lastError?.name;
    error.cause = lastError?.cause ?? lastError;
    throw error;
  }

  getBlacklistStatus() {
    return this.request('GET', '/api/v1/ip_black_list/switch');
  }

  setBlacklistStatus(status) {
    return this.request('POST', '/api/v1/ip_black_list/switch', { body: { value: status } });
  }

  getBlacklist() {
    return this.request('GET', '/api/v1/ip_black_list');
  }

  setBlacklist(items) {
    return this.request('POST', '/api/v1/ip_black_list', { body: { items } });
  }

  addBlacklistItems(items) {
    return this.request('PUT', '/api/v1/ip_black_list', { body: { items } });
  }

  clearBlacklist() {
    return this.request('DELETE', '/api/v1/ip_black_list');
  }

  listProtectedSites() {
    return this.request('GET', '/api/v1/protected_sites');
  }

  createProtectedSite(siteConfig) {
    return this.request('POST', '/api/v1/protected_sites', { body: siteConfig });
  }

  getProtectedSite(id) {
    return this.request('GET', `/api/v1/protected_sites/${encodeURIComponent(id)}`);
  }

  updateProtectedSite(id, siteConfig) {
    return this.request('PUT', `/api/v1/protected_sites/${encodeURIComponent(id)}`, { body: siteConfig });
  }

  deleteProtectedSite(id) {
    return this.request('DELETE', `/api/v1/protected_sites/${encodeURIComponent(id)}`);
  }

  batchUpdateProtectedSites(siteList, siteConfig) {
    return this.request('PUT', '/api/v1/batch_protected_sites', {
      body: { site_list: siteList, config: siteConfig },
    });
  }

  getSSOToken(username = 'admin') {
    return this.request('GET', '/api/v1/rcm/sso_token', { query: { username } });
  }

  getClusterInfo() {
    return this.request('GET', '/api/v1/rcm/cluster_info');
  }

  upgradeCluster(upgradePackage) {
    return this.request('POST', '/api/v1/rcm/upgrade', { body: upgradePackage, rawBody: true });
  }

  rollbackCluster() {
    return this.request('GET', '/api/v1/rcm/rollback');
  }

  getEditorStatus() {
    return this.request('GET', '/api/v1/ubbv2/manual_rule/switch');
  }

  setEditorStatus(status) {
    return this.request('POST', '/api/v1/ubbv2/manual_rule/switch', { body: { status } });
  }

  updateWebRule(manualRule) {
    return this.request('POST', '/api/v1/ubbv2/manual_rule/web', { body: { manual_rule: manualRule } });
  }

  updateAppRule(manualRule) {
    return this.request('POST', '/api/v1/ubbv2/manual_rule/app', { body: { manual_rule: manualRule } });
  }

  getRuleStatus(id) {
    return this.request('GET', '/api/v1/ubbv2/rule/switch', { query: { id } });
  }

  setRuleStatus(id, status) {
    return this.request('POST', '/api/v1/ubbv2/rule/switch', { body: { id, status } });
  }

  uploadResourceFile(fileName, type, fileContent) {
    return this.request('POST', '/api/v1/ubbv2/resource_file', {
      body: { file_name: fileName, type, file_content: fileContent },
    });
  }

  listAPIs() {
    return this.request('GET', '/api/v1/abd/api');
  }

  addAPI(apiConfig) {
    return this.request('POST', '/api/v1/abd/api', { body: apiConfig });
  }

  deleteAPI(apiId) {
    return this.request('DELETE', '/api/v1/abd/api', { query: { api_id: apiId } });
  }

  ignoreAPI(apiId) {
    return this.request('PUT', '/api/v1/abd/ignore_api', { body: { api_id: apiId } });
  }

  setAPIOnlineStatus(id, status) {
    return this.request('POST', '/api/v1/abd/api_online', { body: { id, status } });
  }
}
