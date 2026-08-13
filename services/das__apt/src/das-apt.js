import https from 'node:https';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const LIST_ASSETS_PATH = '/DAS_APT.DASAPTService/ListAssets';
export const GET_ASSET_PATH = '/DAS_APT.DASAPTService/GetAsset';
export const METHOD_LIST_ASSETS_FULL = 'DAS_APT.DASAPTService/ListAssets';
export const METHOD_GET_ASSET_FULL = 'DAS_APT.DASAPTService/GetAsset';

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_OFFSET = 0;
const DEFAULT_LIMIT = 100;
const GET_ASSET_LIMIT = 10;

const grpcCodeFor = (code) => ({
  DEADLINE_EXCEEDED: grpcStatus.DEADLINE_EXCEEDED,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  NOT_FOUND: grpcStatus.NOT_FOUND,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message, details = {}) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  err.details = details;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) {
    return unwrapScalar(value.value);
  }
  return value;
};

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

const coerceString = (value) => {
  const unwrapped = unwrapScalar(value);
  if (unwrapped === undefined || unwrapped === null) return '';
  return String(unwrapped);
};

const trimString = (value) => coerceString(value).trim();

const requireString = (value, label) => {
  const text = trimString(value);
  if (!text) throw errorWithCode('INVALID_ARGUMENT', `${label} is required`);
  return text;
};

const toInt = (value, fallback) => {
  const number = Number(unwrapScalar(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.trunc(number);
};

const toNonNegativeInt = (value, fallback) => {
  const number = toInt(value, fallback);
  return number >= 0 ? number : fallback;
};

const toPositiveInt = (value, fallback) => {
  const number = toInt(value, fallback);
  return number > 0 ? number : fallback;
};

const toBoolean = (value) => {
  const unwrapped = unwrapScalar(value);
  if (typeof unwrapped === 'boolean') return unwrapped;
  if (typeof unwrapped === 'number') return unwrapped !== 0;
  const text = trimString(unwrapped).toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(text);
};

const stripTrailingSlash = (value) => trimString(value).replace(/\/+$/, '');

const normalizeHost = (value) => {
  const host = stripTrailingSlash(value);
  if (!host) throw errorWithCode('INVALID_ARGUMENT', 'host is required');

  let url;
  try {
    url = new URL(host);
  } catch {
    throw errorWithCode('INVALID_ARGUMENT', 'host must be a valid URL');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw errorWithCode('INVALID_ARGUMENT', 'host must use http or https');
  }

  return host;
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx.config ?? {}),
  ...(ctx.secret ?? {}),
  ...(ctx.bindings ?? {}),
});

const normalizeTimeoutMs = (bindings = {}, ctx = {}) => toPositiveInt(
  firstDefined(bindings.timeoutMs, bindings.timeout_ms, ctx.limits?.timeoutMs),
  DEFAULT_TIMEOUT_MS,
);

const getConfig = (ctx = {}) => {
  const bindings = mergedBindings(ctx);
  const host = normalizeHost(firstDefined(bindings.host, bindings.baseUrl, bindings.base_url, bindings.endpoint));
  const apikey = requireString(firstDefined(bindings.apikey, bindings.apiKey, bindings.api_key), 'apikey');
  const timeoutMs = normalizeTimeoutMs(bindings, ctx);
  const skipTlsVerify = toBoolean(firstDefined(
    bindings.skipTlsVerify,
    bindings.skip_tls_verify,
    bindings.tlsInsecureSkipVerify,
    bindings.tls_insecure_skip_verify,
    bindings.insecureSkipVerify,
  ));

  return {
    host,
    apikey,
    timeoutMs,
    skipTlsVerify,
  };
};

export const buildListAssetsBody = (req = {}) => {
  const body = {
    offset: toNonNegativeInt(firstDefined(req.offset, req.page_offset, req.pageOffset), DEFAULT_OFFSET),
    limit: toPositiveInt(firstDefined(req.limit, req.page_size, req.pageSize), DEFAULT_LIMIT),
  };

  const ip = trimString(firstDefined(req.ip, req.IP));
  const startTime = trimString(firstDefined(req.start_time, req.startTime));
  const endTime = trimString(firstDefined(req.end_time, req.endTime));

  if (ip) body.ip = ip;
  if (startTime) body.startTime = startTime;
  if (endTime) body.endTime = endTime;

  return body;
};

const buildGetAssetBody = (req = {}) => ({
  offset: 0,
  limit: GET_ASSET_LIMIT,
  ip: requireString(firstDefined(req.ip, req.IP), 'ip'),
});

const httpsPostJson = (url, init, timeoutMs) => new Promise((resolve, reject) => {
  const body = init.body ?? '';
  const req = https.request(url, {
    method: init.method,
    headers: {
      ...init.headers,
      'Content-Length': Buffer.byteLength(body),
    },
    rejectUnauthorized: false,
    timeout: timeoutMs,
  }, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        text: async () => text,
      });
    });
  });

  req.on('timeout', () => {
    const err = new Error('request timed out');
    err.name = 'AbortError';
    req.destroy(err);
  });
  req.on('error', reject);
  req.write(body);
  req.end();
});

const sendJsonRequest = async (url, init, config) => {
  if (config.skipTlsVerify && url.startsWith('https://')) {
    return httpsPostJson(url, init, config.timeoutMs);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const parseJsonResponse = async (res, context) => {
  const text = await res.text();
  try {
    return {
      text,
      json: text ? JSON.parse(text) : {},
    };
  } catch {
    throw errorWithCode('UNKNOWN', 'upstream returned a non-JSON response', {
      ...context,
      http_status_code: res.status,
    });
  }
};

const throwForHttpStatus = (res, context) => {
  if (res.ok) return;

  const details = {
    ...context,
    http_status_code: res.status,
  };

  if (res.status === 401) {
    throw errorWithCode('UNAUTHENTICATED', 'upstream authentication failed', details);
  }
  if (res.status === 403) {
    throw errorWithCode('PERMISSION_DENIED', 'upstream permission denied', details);
  }
  if (res.status === 404) {
    throw errorWithCode('NOT_FOUND', 'upstream resource not found', details);
  }
  if (res.status === 408 || res.status === 504) {
    throw errorWithCode('DEADLINE_EXCEEDED', 'upstream request timed out', details);
  }
  if (res.status >= 500) {
    throw errorWithCode('UNAVAILABLE', 'upstream service unavailable', details);
  }

  throw errorWithCode('FAILED_PRECONDITION', `upstream returned HTTP ${res.status}`, details);
};

const throwForBusinessStatus = (json, context) => {
  const code = firstDefined(json?.code, json?.error_code);
  if (code === undefined) return;

  const normalized = Number(code);
  const ok = normalized === 0 || normalized === 200;
  if (ok) return;

  const message = trimString(firstDefined(json?.message, json?.msg));
  const details = { ...context, upstream_code: coerceString(code) };

  if (/token|登录|认证|鉴权/i.test(message) || normalized === 400 || normalized === 401) {
    throw errorWithCode('UNAUTHENTICATED', 'upstream authentication failed', details);
  }
  if (normalized === 403) {
    throw errorWithCode('PERMISSION_DENIED', 'upstream permission denied', details);
  }
  if (normalized === 404) {
    throw errorWithCode('NOT_FOUND', 'upstream resource not found', details);
  }

  throw errorWithCode('FAILED_PRECONDITION', `upstream returned business error ${code}`, details);
};

const fetchOpenApiJson = async (ctx, path, body, operation) => {
  const config = getConfig(ctx);
  const url = `${config.host}${path}`;
  const init = {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      apikey: config.apikey,
    },
    body: JSON.stringify(body),
  };
  const context = { operation, path };

  let res;
  try {
    res = await sendJsonRequest(url, init, config);
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw errorWithCode('DEADLINE_EXCEEDED', 'upstream request timed out', context);
    }
    throw errorWithCode('UNAVAILABLE', 'failed to connect to upstream', context);
  }

  const { text, json } = await parseJsonResponse(res, context);
  throwForHttpStatus(res, context);
  throwForBusinessStatus(json, context);
  return json;
};

const normalizeFingerprint = (item = {}) => ({
  id: toInt(firstDefined(item.id, item.ID), 0),
  product_code: trimString(firstDefined(item.productCode, item.product_code)),
  fingerprint_class_code: trimString(firstDefined(item.fingerprintClassCode, item.fingerprint_class_code)),
  descr: trimString(item.descr),
  offcial_website: trimString(firstDefined(item.offcialWebsite, item.offcial_website)),
  product_website: trimString(firstDefined(item.productWebsite, item.product_website)),
  product_name_cn: trimString(firstDefined(item.productNameCn, item.product_name_cn)),
  product_name_en: trimString(firstDefined(item.productNameEn, item.product_name_en)),
  product_status: trimString(firstDefined(item.productStatus, item.product_status)),
  vendor_name_cn: trimString(firstDefined(item.vendorNameCn, item.vendor_name_cn)),
  vendor_name_en: trimString(firstDefined(item.vendorNameEn, item.vendor_name_en)),
  tag_list: trimString(firstDefined(item.tagList, item.tag_list)),
  create_time: trimString(firstDefined(item.createTime, item.create_time)),
  update_time: trimString(firstDefined(item.updateTime, item.update_time)),
  fingerprint_ip: trimString(firstDefined(item.fingerprintIp, item.fingerprint_ip)),
  fingerprint_port: trimString(firstDefined(item.fingerprintPort, item.fingerprint_port)),
  fingerprint_name: trimString(firstDefined(item.fingerprintName, item.fingerprint_name)),
  fingerprint_class2: trimString(firstDefined(item.fingerprintClass2, item.fingerprint_class2)),
  fingerprint_version: trimString(firstDefined(item.fingerprintVersion, item.fingerprint_version)),
});

const normalizeAsset = (item = {}) => ({
  ip: trimString(firstDefined(item.ip, item.IP)),
  ports: trimString(item.ports),
  port_fingerprint_name: trimString(firstDefined(item.portFingerprintName, item.port_fingerprint_name)),
  last_found_time: trimString(firstDefined(item.lastFoundTime, item.last_found_time)),
  first_found_time: trimString(firstDefined(item.firstFoundTime, item.first_found_time)),
  last_active_time: trimString(firstDefined(item.lastActiveTime, item.last_active_time)),
  port_server_type: trimString(firstDefined(item.portServerType, item.port_server_type)),
  asset_type: trimString(firstDefined(item.assetType, item.asset_type)),
  found_source: trimString(firstDefined(item.foundSource, item.found_source)),
  mac: trimString(item.mac),
  tag: trimString(item.tag),
  content: trimString(item.content),
  product_fingerprint_list: Array.isArray(item.productFingerprintList)
    ? item.productFingerprintList.map(normalizeFingerprint)
    : [],
});

export const mapListAssetsResponse = (raw = {}) => {
  const items = Array.isArray(raw.data) ? raw.data.map(normalizeAsset) : [];
  return {
    total: toInt(firstDefined(raw.total, raw.totalCount, raw.total_count), items.length),
    items,
  };
};

export const handleListAssets = async (req = {}, ctx = {}) => {
  const raw = await fetchOpenApiJson(ctx, '/openapi/asset/list', buildListAssetsBody(req), 'ListAssets');
  return mapListAssetsResponse(raw);
};

export const handleGetAsset = async (req = {}, ctx = {}) => {
  const body = buildGetAssetBody(req);
  const raw = await fetchOpenApiJson(ctx, '/openapi/asset/list', body, 'GetAsset');
  const result = mapListAssetsResponse(raw);
  const asset = result.items.find((item) => item.ip === body.ip);
  if (!asset) {
    throw errorWithCode('NOT_FOUND', `asset not found: ${body.ip}`, {
      operation: 'GetAsset',
    });
  }
  return {
    asset,
  };
};

const requestFromCtx = (ctx = {}, request) => request ?? ctx.req ?? ctx.request ?? {};

export const handlers = {
  [METHOD_LIST_ASSETS_FULL]: async (ctx = {}) => handleListAssets(requestFromCtx(ctx), ctx),
  [METHOD_GET_ASSET_FULL]: async (ctx = {}) => handleGetAsset(requestFromCtx(ctx), ctx),
};

export const rpcdef = (ctx = {}) => ({
  [LIST_ASSETS_PATH]: async (request) => handleListAssets(requestFromCtx(ctx, request), ctx),
  [GET_ASSET_PATH]: async (request) => handleGetAsset(requestFromCtx(ctx, request), ctx),
});

export const _test = {
  buildListAssetsBody,
  errorWithCode,
  getConfig,
  mapListAssetsResponse,
  normalizeAsset,
  normalizeFingerprint,
};
