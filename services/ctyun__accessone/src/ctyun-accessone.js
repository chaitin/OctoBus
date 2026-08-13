import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

// ── RPC paths ──
export const RPC_DOMAIN_LIST = 'Ctyun_AccessOne.Ctyun_AccessOne/QueryDomainList';
export const RPC_SERVICE_DETAIL = 'Ctyun_AccessOne.Ctyun_AccessOne/QueryServiceDetail';
export const RPC_DOMAIN_RULE_ACT = 'Ctyun_AccessOne.Ctyun_AccessOne/QueryDomainRuleAct';
export const RPC_DOMAIN_RULE_CONFIG = 'Ctyun_AccessOne.Ctyun_AccessOne/QueryDomainRuleConfig';
export const RPC_WAF_CONFIG = 'Ctyun_AccessOne.Ctyun_AccessOne/QueryWafConfig';
export const RPC_ACCESS_CONTROL_SWITCH = 'Ctyun_AccessOne.Ctyun_AccessOne/QueryAccessControlSwitch';
export const RPC_INSERT_ACCESS_CONTROL = 'Ctyun_AccessOne.Ctyun_AccessOne/InsertAccessControl';
export const RPC_UPDATE_ACCESS_CONTROL_SWITCH = 'Ctyun_AccessOne.Ctyun_AccessOne/UpdateAccessControlSwitch';
export const RPC_RESOURCE_PACKAGES = 'Ctyun_AccessOne.Ctyun_AccessOne/QueryResourcePackages';
export const RPC_IPV6_NO_SUP_LINK = 'Ctyun_AccessOne.Ctyun_AccessOne/QueryIPv6NoSupLink';

// ── HTTP endpoints ──
const HTTP_DOMAIN_LIST = '/ctapi/v2/domain/query';       // GET
const HTTP_SERVICE_DETAIL = '/ctapi/v1/sevice_detail';    // POST
const HTTP_DOMAIN_RULE_ACT = '/ctapi/v1/domainRule/getDomainRuleAct';    // POST
const HTTP_DOMAIN_RULE_CONFIG = '/ctapi/v1/domainRule/get';              // POST
const HTTP_WAF_CONFIG = '/ctapi/v1/scdn/domain/wafConfigQuery';          // POST
const HTTP_ACCESS_CONTROL_SWITCH = '/ctapi/v1/scdn/domain/queryAccessControlAct'; // POST
const HTTP_INSERT_ACCESS_CONTROL = '/ctapi/v1/scdn/domain/accessControlInsert';     // POST
const HTTP_UPDATE_ACCESS_CONTROL_SWITCH = '/ctapi/v1/scdn/domain/updateAccessControlAct'; // POST
const HTTP_RESOURCE_PACKAGES = '/ctapi/v1/accessone/purchase/queryResourcePackages'; // POST
const HTTP_IPV6_NO_SUP_LINK = '/ctapi/v1/ipv6/checkResult/getNoSupLink';              // POST

const DEFAULT_GATEWAY = 'accessone-global.ctapi.ctyun.cn';
const DEFAULT_TIMEOUT_MS = 10000;

// ── Errors ──
const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

// ── Helpers ──
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const firstDefined = (...values) => values.find((v) => v !== undefined && v !== null);

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

const mergedBindings = (ctx = {}) => ({
  ...(ctx.config ?? {}),
  ...(ctx.secret ?? {}),
  ...(ctx.bindings ?? {}),
});

// ── EOP HMAC-SHA256 签名 ──
const hmacSha256 = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex');

const compareCanonicalPart = (left, right) => (left === right ? 0 : left < right ? -1 : 1);

const makeCanonicalQueryString = (queryParams) => {
  if (!queryParams) return '';
  const pairs = [];
  for (const [key, rawValue] of Object.entries(queryParams)) {
    if (rawValue === undefined || rawValue === null) continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      const str = String(value);
      pairs.push([key, encodeURIComponent(str).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)]);
    }
  }
  pairs.sort((a, b) => {
    const keyCmp = compareCanonicalPart(a[0], b[0]);
    return keyCmp !== 0 ? keyCmp : compareCanonicalPart(a[1], b[1]);
  });
  return pairs.map(([key, val]) => `${key}=${val}`).join('&');
};

const makeEopSignature = (ak, sk, eopDate, requestId, bodyStr, canonicalQueryString = '') => {
  const headerStr = `ctyun-eop-request-id:${requestId}\neop-date:${eopDate}\n`;
  const bodyHash = sha256Hex(bodyStr);
  const signStr = `${headerStr}\n${canonicalQueryString}\n${bodyHash}`;

  const kTime = hmacSha256(sk, eopDate);
  const kAk = hmacSha256(kTime, ak);
  const kDate = hmacSha256(kAk, eopDate.substring(0, 8));
  const sigRaw = hmacSha256(kDate, signStr);
  const signature = sigRaw.toString('base64');

  return `${ak} Headers=ctyun-eop-request-id;eop-date Signature=${signature}`;
};

const eopDateNow = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
};

const uuid = () => crypto.randomUUID();

// ── Resolve from bindings ──
const resolveGateway = (bindings = {}) => {
  const g = toTrimmedString(firstDefined(bindings.ctyun_gateway, bindings.gateway)) || DEFAULT_GATEWAY;
  return g.replace(/\/+$/, '');
};

const gatewayUrl = (gateway, path) => {
  if (/^https?:\/\//.test(gateway)) return `${gateway}${path}`;
  const scheme = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(gateway) ? 'http' : 'https';
  return `${scheme}://${gateway}${path}`;
};

const resolveAk = (bindings = {}) => toTrimmedString(firstDefined(bindings.ctyun_ak, bindings.ak));
const resolveSk = (bindings = {}) => toTrimmedString(firstDefined(bindings.ctyun_sk, bindings.sk));

const resolveTimeoutMs = (ctx = {}) => {
  const raw = Number(firstDefined(
    ctx.limits?.timeoutMs,
    mergedBindings(ctx).timeoutMs,
    DEFAULT_TIMEOUT_MS,
  ));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

const buildTlsOptions = (bindings = {}) => {
  const enabled = Boolean(bindings.skipTlsVerify || bindings.tlsInsecureSkipVerify || bindings.insecureSkipVerify);
  if (!enabled) return {};
  return { skipTlsVerify: true, tlsInsecureSkipVerify: true, insecureSkipVerify: true };
};

const shouldSkipTlsVerify = (bindings = {}) => Boolean(
  bindings.skipTlsVerify || bindings.tlsInsecureSkipVerify || bindings.insecureSkipVerify,
);

const fetchWithTimeout = async (url, init, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
  try {
    return await globalThis.fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

const decodeResponseStream = (res) => {
  const encoding = String(res.headers?.['content-encoding'] ?? '').trim().toLowerCase();
  if (!encoding || encoding === 'identity') return res;
  if (encoding === 'gzip' || encoding === 'x-gzip') return res.pipe(zlib.createGunzip());
  if (encoding === 'deflate') return res.pipe(zlib.createInflate());
  if (encoding === 'br') return res.pipe(zlib.createBrotliDecompress());
  return res;
};

const requestWithNodeTransport = (urlString, init, options = {}) => {
  const url = new URL(urlString);
  const isHttps = url.protocol === 'https:';
  const transport = isHttps ? https : http;
  const timeoutMs = Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const body = init.body ?? '';

  return new Promise((resolve, reject) => {
    const req = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      ...(isHttps && options.skipTlsVerify ? { rejectUnauthorized: false } : {}),
    }, (res) => {
      const chunks = [];
      const stream = decodeResponseStream(res);
      const fail = (err) => reject(err);
      res.on('error', fail);
      if (stream !== res) stream.on('error', fail);
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const status = res.statusCode ?? 0;
        resolve({
          status,
          ok: status >= 200 && status < 300,
          text: async () => text,
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
    if (body) req.write(body);
    req.end();
  });
};

const mapHttpStatusToCode = (status) => {
  if (status === 401 || status === 403) return 'PERMISSION_DENIED';
  if (status >= 400 && status < 500) return 'FAILED_PRECONDITION';
  if (status >= 500) return 'UNAVAILABLE';
  return 'UNKNOWN';
};

const attachResponse = (err, httpStatus, httpBody) => {
  err.response = { http_status: httpStatus, http_body: httpBody };
  return err;
};

// ── Logging (summary only — no request/response body to avoid secrets leakage) ──
const logFlow = (ctx, action, payload) => {
  const inst = ctx?.meta?.instance_id ?? '?';
  const reqId = ctx?.meta?.request_id ?? '?';
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  console.log(`[Ctyun_AccessOne][${action}][inst=${inst} req=${reqId}] ${text}`);
};

// ── Signed HTTP call (POST) ──
const signedPost = async (gateway, path, bodyObj, ak, sk, ctx) => {
  const eopDate = eopDateNow();
  const requestId = uuid();
  const bodyStr = bodyObj ? JSON.stringify(bodyObj) : '{}';
  const auth = makeEopSignature(ak, sk, eopDate, requestId, bodyStr);
  const timeoutMs = resolveTimeoutMs(ctx);
  const skipTlsVerify = shouldSkipTlsVerify(mergedBindings(ctx));

  const url = gatewayUrl(gateway, path);
  const init = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ctyun-eop-request-id': requestId,
      'Eop-date': eopDate,
      'Eop-Authorization': auth,
    },
    body: bodyStr,
  };

  logFlow(ctx, 'request', `POST ${url}`);

  let resp;
  try {
    resp = skipTlsVerify
      ? await requestWithNodeTransport(url, init, { timeoutMs, skipTlsVerify: true })
      : await fetchWithTimeout(url, init, timeoutMs);
  } catch (err) {
    const cause = err?.cause?.message || err?.message || String(err);
    logFlow(ctx, 'error', { phase: 'fetch', error: cause });
    throw attachResponse(errorWithCode('UNAVAILABLE', `network error: ${cause}`), 0, cause);
  }

  let text;
  try {
    text = await resp.text();
  } catch (err) {
    logFlow(ctx, 'error', { phase: 'text', error: err.message });
    throw attachResponse(errorWithCode('UNAVAILABLE', `read body failed: ${err.message}`), resp.status, '');
  }

  logFlow(ctx, 'response', `HTTP ${resp.status} (${text.length}B)`);

  if (resp.status < 200 || resp.status >= 300) {
    const code = mapHttpStatusToCode(resp.status);
    throw attachResponse(errorWithCode(code, `CTAPI returned HTTP ${resp.status}`), resp.status, text);
  }

  return { http_status: resp.status, http_body: text };
};

// ── Signed HTTP call (GET) ──
const signedGet = async (gateway, path, queryParams, ak, sk, ctx) => {
  const eopDate = eopDateNow();
  const requestId = uuid();
  const canonicalQueryString = makeCanonicalQueryString(queryParams);
  const auth = makeEopSignature(ak, sk, eopDate, requestId, '', canonicalQueryString);
  const timeoutMs = resolveTimeoutMs(ctx);
  const skipTlsVerify = shouldSkipTlsVerify(mergedBindings(ctx));

  let url = gatewayUrl(gateway, path);
  if (canonicalQueryString) {
    url += `?${canonicalQueryString}`;
  }
  const init = {
    method: 'GET',
    headers: {
      'ctyun-eop-request-id': requestId,
      'Eop-date': eopDate,
      'Eop-Authorization': auth,
    },
  };

  logFlow(ctx, 'request', `GET ${url}`);

  let resp;
  try {
    resp = skipTlsVerify
      ? await requestWithNodeTransport(url, init, { timeoutMs, skipTlsVerify: true })
      : await fetchWithTimeout(url, init, timeoutMs);
  } catch (err) {
    const cause = err?.cause?.message || err?.message || String(err);
    logFlow(ctx, 'error', { phase: 'fetch', error: cause });
    throw attachResponse(errorWithCode('UNAVAILABLE', `network error: ${cause}`), 0, cause);
  }

  let text;
  try {
    text = await resp.text();
  } catch (err) {
    logFlow(ctx, 'error', { phase: 'text', error: err.message });
    throw attachResponse(errorWithCode('UNAVAILABLE', `read body failed: ${err.message}`), resp.status, '');
  }

  logFlow(ctx, 'response', `HTTP ${resp.status} (${text.length}B)`);

  if (resp.status < 200 || resp.status >= 300) {
    const code = mapHttpStatusToCode(resp.status);
    throw attachResponse(errorWithCode(code, `CTAPI returned HTTP ${resp.status}`), resp.status, text);
  }

  return { http_status: resp.status, http_body: text };
};

// ── Validation ──
const requireGateway = (bindings) => resolveGateway(bindings);

const requireAuth = (bindings) => {
  const ak = resolveAk(bindings);
  const sk = resolveSk(bindings);
  if (!ak) throw errorWithCode('INVALID_ARGUMENT', 'ctyun_ak is required');
  if (!sk) throw errorWithCode('INVALID_ARGUMENT', 'ctyun_sk is required');
  return { ak, sk };
};

const requireString = (value, name) => {
  const v = toTrimmedString(value);
  if (!v) throw errorWithCode('INVALID_ARGUMENT', `${name} is required`);
  return v;
};

const optionalString = (value) => {
  const v = toTrimmedString(value);
  return v || undefined;
};

const ACCESS_CONTROL_MODS = new Set(['ON', 'CLOSE']);
const ACCESS_CONTROL_ACTS = new Set(['LOG', 'ACCEPT', 'BLOCK', 'DROP', 'CHECK', 'JUMP', 'JCJS', 'PIC']);
const ACCESS_CONTROL_EQUALS = new Set(['TRUE', 'FALSE']);
const ACCESS_CONTROL_MATCH_MODES = new Set(['REGEX', 'STR']);

const normalizeEnum = (value, name, allowed, hints = {}) => {
  const normalized = requireString(value, name).toUpperCase();
  if (allowed.has(normalized)) return normalized;

  const hint = hints[normalized] ? `; ${hints[normalized]}` : '';
  throw errorWithCode(
    'INVALID_ARGUMENT',
    `${name} must be one of ${Array.from(allowed).join(', ')}, got "${value}"${hint}`,
  );
};

const normalizeOptionalMatchMode = (value, name) => {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  return normalizeEnum(value, name, ACCESS_CONTROL_MATCH_MODES);
};

const normalizeGeoZone = (geoZone, name) => {
  if (!Array.isArray(geoZone) || !geoZone.length) {
    throw errorWithCode('INVALID_ARGUMENT', `${name} must be a non-empty array`);
  }
  return geoZone.map((item, idx) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw errorWithCode('INVALID_ARGUMENT', `${name}[${idx}] must be an object`);
    }
    const subGeo = Array.isArray(item.sub_geo) ? item.sub_geo : item.subGeo;
    if (!Array.isArray(subGeo) || !subGeo.length) {
      throw errorWithCode('INVALID_ARGUMENT', `${name}[${idx}].sub_geo must be a non-empty array`);
    }
    return {
      subGeo: subGeo.map((entry, subIdx) => requireString(entry, `${name}[${idx}].sub_geo[${subIdx}]`)),
    };
  });
};

const normalizeAccessControlRangeItem = (item, index) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw errorWithCode('INVALID_ARGUMENT', `public_range[${index}] must be an object`);
  }

  const zone = requireString(item.zone, `public_range[${index}].zone`).toUpperCase();
  const equal = normalizeEnum(item.equal, `public_range[${index}].equal`, ACCESS_CONTROL_EQUALS);
  const publicContent = optionalString(item.public_content ?? item.publicContent);
  const operator = normalizeOptionalMatchMode(item.operator, `public_range[${index}].operator`);
  const keyName = normalizeOptionalMatchMode(item.key_name ?? item.keyName, `public_range[${index}].key_name`);
  const valueName = normalizeOptionalMatchMode(item.value_name ?? item.valueName, `public_range[${index}].value_name`);
  const keyContent = optionalString(item.key_content ?? item.keyContent);
  const valueContent = optionalString(item.value_content ?? item.valueContent);
  const datePeriod = optionalString(item.date_period ?? item.datePeriod);
  const geoZoneRaw = item.geo_zone ?? item.geoZone;

  if (!['GEO', 'ARGS', 'HEADER'].includes(zone) && !publicContent) {
    throw errorWithCode('INVALID_ARGUMENT', `public_range[${index}].public_content is required when zone=${zone}`);
  }
  if (zone === 'FMT_TIME') {
    if (!publicContent) {
      throw errorWithCode('INVALID_ARGUMENT', `public_range[${index}].public_content is required when zone=FMT_TIME`);
    }
    if (!datePeriod) {
      throw errorWithCode('INVALID_ARGUMENT', `public_range[${index}].date_period is required when zone=FMT_TIME`);
    }
  }

  const normalized = { zone, equal };
  if (publicContent) normalized.publicContent = publicContent;
  if (operator) normalized.operator = operator;
  if (keyName) normalized.keyName = keyName;
  if (keyContent) normalized.keyContent = keyContent;
  if (valueName) normalized.valueName = valueName;
  if (valueContent) normalized.valueContent = valueContent;
  if (datePeriod) normalized.datePeriod = datePeriod;

  if (zone === 'GEO') {
    normalized.geoZone = normalizeGeoZone(geoZoneRaw, `public_range[${index}].geo_zone`);
  }

  return normalized;
};

const normalizeRequestShape = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeRequestShape(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const out = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, normalizeRequestShape(item)]),
  );
  for (const [camelKey, snakeKey] of [
    ['productCode', 'product_code'],
    ['areaScope', 'area_scope'],
    ['pageSize', 'page_size'],
    ['requestId', 'request_id'],
    ['ruleName', 'rule_name'],
    ['ruleDesc', 'rule_desc'],
    ['jumpUrl', 'jump_url'],
    ['publicRange', 'public_range'],
    ['publicContent', 'public_content'],
    ['keyName', 'key_name'],
    ['keyContent', 'key_content'],
    ['valueName', 'value_name'],
    ['valueContent', 'value_content'],
    ['geoZone', 'geo_zone'],
    ['subGeo', 'sub_geo'],
    ['datePeriod', 'date_period'],
  ]) {
    if (out[snakeKey] === undefined && out[camelKey] !== undefined) {
      out[snakeKey] = out[camelKey];
    }
  }
  return out;
};

// ── Handlers ──

// 1. 域名列表 (GET)
const handleDomainList = async (req, ctx = {}) => {
  const bindings = mergedBindings(ctx);
  const gateway = requireGateway(bindings);
  const { ak, sk } = requireAuth(bindings);

  const params = {};
  for (const [key, val] of [
    ['domain', req.domain],
    ['product_code', req.product_code],
    ['status', req.status],
    ['area_scope', req.area_scope],
    ['page', req.page],
    ['page_size', req.page_size],
  ]) {
    const v = unwrapScalar(val);
    if (v !== undefined && v !== null) params[key] = String(v);
  }

  return signedGet(gateway, HTTP_DOMAIN_LIST, Object.keys(params).length ? params : null, ak, sk, ctx);
};

// 2. 服务基本信息 (POST)
const handleServiceDetail = async (req, ctx = {}) => {
  const bindings = mergedBindings(ctx);
  const gateway = requireGateway(bindings);
  const { ak, sk } = requireAuth(bindings);
  if (!req.product_code?.length) throw errorWithCode('INVALID_ARGUMENT', 'product_code is required');

  return signedPost(gateway, HTTP_SERVICE_DETAIL, { product_code: req.product_code }, ak, sk, ctx);
};

// 3. 防护规则引擎总开关 (POST)
const handleDomainRuleAct = async (req, ctx = {}) => {
  const bindings = mergedBindings(ctx);
  const gateway = requireGateway(bindings);
  const { ak, sk } = requireAuth(bindings);
  requireString(req.domain, 'domain');
  requireString(req.product_code, 'product_code');

  return signedPost(gateway, HTTP_DOMAIN_RULE_ACT, { domain: req.domain, productCode: req.product_code }, ak, sk, ctx);
};

// 4. 防护规则引擎配置 (POST)
const handleDomainRuleConfig = async (req, ctx = {}) => {
  const bindings = mergedBindings(ctx);
  const gateway = requireGateway(bindings);
  const { ak, sk } = requireAuth(bindings);
  requireString(req.domain, 'domain');
  requireString(req.product_code, 'product_code');

  return signedPost(gateway, HTTP_DOMAIN_RULE_CONFIG, { domain: req.domain, productCode: req.product_code }, ak, sk, ctx);
};

// 5. WAF 配置 (POST)
const handleWafConfig = async (req, ctx = {}) => {
  const bindings = mergedBindings(ctx);
  const gateway = requireGateway(bindings);
  const { ak, sk } = requireAuth(bindings);
  requireString(req.domain, 'domain');
  requireString(req.product_code, 'product_code');

  return signedPost(gateway, HTTP_WAF_CONFIG, { domain: req.domain, productCode: req.product_code }, ak, sk, ctx);
};

// 6. 访问控制总开关 (POST)
const handleAccessControlSwitch = async (req, ctx = {}) => {
  const bindings = mergedBindings(ctx);
  const gateway = requireGateway(bindings);
  const { ak, sk } = requireAuth(bindings);
  requireString(req.domain, 'domain');
  requireString(req.product_code, 'product_code');

  return signedPost(gateway, HTTP_ACCESS_CONTROL_SWITCH, { domain: req.domain, productCode: req.product_code }, ak, sk, ctx);
};

// 7. 新增访问控制规则 (POST, 写)
const handleInsertAccessControl = async (req, ctx = {}) => {
  const bindings = mergedBindings(ctx);
  const gateway = requireGateway(bindings);
  const { ak, sk } = requireAuth(bindings);

  if (!req.domains?.length) throw errorWithCode('INVALID_ARGUMENT', 'domains is required (at least one domain)');
  if (req.domains.length > 50) throw errorWithCode('INVALID_ARGUMENT', `domains limit exceeded: max 50, got ${req.domains.length}`);
  requireString(req.product_code, 'product_code');
  if (!req.configs?.length) throw errorWithCode('INVALID_ARGUMENT', 'configs is required (at least one rule config)');
  if (req.configs.length > 20) throw errorWithCode('INVALID_ARGUMENT', `configs limit exceeded: max 20, got ${req.configs.length}`);

  const accessControlConfigs = req.configs.map((c) => {
    const mod = normalizeEnum(c.mod, 'config.mod', ACCESS_CONTROL_MODS, { OFF: 'official API uses CLOSE instead of OFF' });
    const act = normalizeEnum(c.act, 'config.act', ACCESS_CONTROL_ACTS, { DENY: 'official API uses BLOCK instead of DENY' });
    const ruleName = requireString(c.rule_name, 'config.rule_name');
    const ruleDesc = optionalString(c.rule_desc ?? c.ruleDesc);
    const jumpUrl = optionalString(c.jump_url ?? c.jumpUrl);

    if (act === 'JUMP' && !jumpUrl) {
      throw errorWithCode('INVALID_ARGUMENT', 'config.jump_url is required when config.act=JUMP');
    }
    const rawPublicRange = Array.isArray(c.public_range) ? c.public_range : null;
    if (!rawPublicRange || !rawPublicRange.length) {
      throw errorWithCode('INVALID_ARGUMENT', 'config.public_range is required (at least one public range item)');
    }

    const flattenedPublicRange = rawPublicRange.flatMap((item, groupIndex) => {
      if (item && typeof item === 'object' && !Array.isArray(item) && Array.isArray(item.items)) {
        if (!item.items.length) {
          throw errorWithCode('INVALID_ARGUMENT', `config.public_range[${groupIndex}].items must contain at least one item`);
        }
        return item.items;
      }
      return [item];
    });

    const normalizedItems = flattenedPublicRange.map((item, index) => normalizeAccessControlRangeItem(item, index));
    const cfg = {
      mod,
      act,
      ruleName,
      publicRange: normalizedItems.map((item) => {
        const out = {
          zone: item.zone,
          equal: String(item.equal).toLowerCase(),
        };
        if (item.publicContent) out.publicContent = item.publicContent;
        if (item.operator) out.operator = item.operator;
        if (item.keyName) out.keyName = item.keyName;
        if (item.keyContent) out.keyContent = item.keyContent;
        if (item.valueName) out.valueName = item.valueName;
        if (item.valueContent) out.valueContent = item.valueContent;
        if (item.datePeriod) out.datePeriod = item.datePeriod;
        if (item.geoZone) out.geoZone = item.geoZone;
        return out;
      }),
    };
    if (ruleDesc) cfg.ruleDesc = ruleDesc;
    if (jumpUrl) cfg.jumpUrl = jumpUrl;
    return cfg;
  });

  return signedPost(gateway, HTTP_INSERT_ACCESS_CONTROL, {
    domains: req.domains,
    productCode: req.product_code,
    accessControlConfigs,
  }, ak, sk, ctx);
};

// 8. 更新访问控制域级开关 (POST, 写)
const handleUpdateAccessControlSwitch = async (req, ctx = {}) => {
  const bindings = mergedBindings(ctx);
  const gateway = requireGateway(bindings);
  const { ak, sk } = requireAuth(bindings);
  requireString(req.domain, 'domain');
  requireString(req.product_code, 'product_code');
  const mod = normalizeEnum(req.mod, 'mod', ACCESS_CONTROL_MODS, { OFF: 'official API uses CLOSE instead of OFF' });

  return signedPost(gateway, HTTP_UPDATE_ACCESS_CONTROL_SWITCH, {
    domain: req.domain,
    productCode: req.product_code,
    mod,
  }, ak, sk, ctx);
};

// 9. 资源包列表 (POST, no body params)
const handleResourcePackages = async (req, ctx = {}) => {
  const bindings = mergedBindings(ctx);
  const gateway = requireGateway(bindings);
  const { ak, sk } = requireAuth(bindings);

  return signedPost(gateway, HTTP_RESOURCE_PACKAGES, {}, ak, sk, ctx);
};

// 10. IPv6检测不支持链接 (POST)
const handleIPv6NoSupLink = async (req, ctx = {}) => {
  const bindings = mergedBindings(ctx);
  const gateway = requireGateway(bindings);
  const { ak, sk } = requireAuth(bindings);

  const requestId = req.request_id ?? req.requestId;
  if (requestId === undefined || requestId === null) {
    throw errorWithCode('INVALID_ARGUMENT', 'request_id is required (IPv6 check task ID)');
  }
  if (!Number.isInteger(requestId) || requestId <= 0) {
    throw errorWithCode('INVALID_ARGUMENT', `request_id must be a positive integer, got ${requestId}`);
  }

  return signedPost(gateway, HTTP_IPV6_NO_SUP_LINK, { requestId }, ak, sk, ctx);
};

const makeHandler = (fn) => async (callOrCtx, maybeCtx) => {
  if (maybeCtx !== undefined) {
    return fn(normalizeRequestShape(callOrCtx?.request ?? callOrCtx), maybeCtx ?? callOrCtx?.context ?? {});
  }
  return fn(normalizeRequestShape(callOrCtx?.request ?? callOrCtx), callOrCtx ?? {});
};

export const handlers = {
  [RPC_DOMAIN_LIST]: makeHandler(handleDomainList),
  [RPC_SERVICE_DETAIL]: makeHandler(handleServiceDetail),
  [RPC_DOMAIN_RULE_ACT]: makeHandler(handleDomainRuleAct),
  [RPC_DOMAIN_RULE_CONFIG]: makeHandler(handleDomainRuleConfig),
  [RPC_WAF_CONFIG]: makeHandler(handleWafConfig),
  [RPC_ACCESS_CONTROL_SWITCH]: makeHandler(handleAccessControlSwitch),
  [RPC_INSERT_ACCESS_CONTROL]: makeHandler(handleInsertAccessControl),
  [RPC_UPDATE_ACCESS_CONTROL_SWITCH]: makeHandler(handleUpdateAccessControlSwitch),
  [RPC_RESOURCE_PACKAGES]: makeHandler(handleResourcePackages),
  [RPC_IPV6_NO_SUP_LINK]: makeHandler(handleIPv6NoSupLink),
};

// ── Exports for testing ──
export const _test = {
  eopDateNow,
  makeEopSignature,
  uuid,
  sha256Hex,
  makeCanonicalQueryString,
  resolveGateway,
  resolveAk,
  resolveSk,
  resolveTimeoutMs,
  buildTlsOptions,
  shouldSkipTlsVerify,
  fetchWithTimeout,
  requestWithNodeTransport,
  mapHttpStatusToCode,
  attachResponse,
  signedPost,
  signedGet,
  grpcCodeFor,
  errorWithCode,
  hasOwn,
  firstDefined,
  unwrapScalar,
  toTrimmedString,
  mergedBindings,
  logFlow,
  normalizeGeoZone,
  normalizeRequestShape,
};
