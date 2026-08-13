// FOFA Network Space Mapper service implementation
// Official FOFA API v1 - only /search/all endpoint for queries
// Bindings: baseUrl (required), headers (optional), timeoutMs (optional)

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_PAGE = 1;
const DEFAULT_SIZE = 100;
const MAX_SIZE = 10000;
const DEFAULT_FIELDS = 'host,ip,port,protocol';

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
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

const toValue = (val) => {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'number') return { numberValue: val };
  if (typeof val === 'bigint') return { numberValue: Number(val) };
  if (typeof val === 'boolean') return { boolValue: val };
  if (Array.isArray(val)) {
    const values = val
      .map((item) => toValue(item))
      .filter((item) => item !== undefined);
    return { listValue: { values } };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      const normalized = toValue(v);
      fields[k] = normalized === undefined ? { nullValue: 'NULL_VALUE' } : normalized;
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(val) };
};

const unwrapString = (source) => {
  if (source === undefined || source === null) return '';
  if (typeof source === 'object' && source !== null && 'value' in source) {
    return String(source.value ?? '');
  }
  return String(source);
};

const unwrapInt = (source) => {
  if (source === undefined || source === null) return null;
  if (typeof source === 'object' && source !== null && 'value' in source) {
    const val = Number(source.value);
    if (!Number.isInteger(val) || Number.isNaN(val)) return null;
    return val;
  }
  const val = Number(source);
  if (!Number.isInteger(val) || Number.isNaN(val)) return null;
  return val;
};

const unwrapBoolean = (source) => {
  if (source === undefined || source === null) return false;
  if (typeof source === 'boolean') return source;
  if (typeof source === 'object' && source !== null && 'value' in source) {
    return Boolean(source.value);
  }
  return Boolean(source);
};

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

const buildSearchParams = (params) => {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.append(key, String(value));
    }
  }
  return searchParams.toString();
};

const makeRequest = async (ctx, endpoint, params) => {
  const bindings = mergedBindings(ctx);
  const baseUrl = normalizeBaseUrl(bindings.baseUrl || bindings.endpoint || bindings.restBaseUrl);
  if (!baseUrl) {
    throw errorWithCode('INVALID_ARGUMENT', 'baseUrl is required in config');
  }

  const email = bindings.email || bindings.fofa_email;
  const key = bindings.key || bindings.api_key || bindings.fofa_api_key;

  if (!email || !key) {
    throw errorWithCode('UNAUTHENTICATED', 'email and key are required in secret');
  }

  const headers = {
    'User-Agent': 'OctoBus-FOFA-Client/1.0',
    ...parseHeaders(bindings.headers),
  };

  const timeoutMs = Number(bindings.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const url = `${baseUrl}${endpoint}?${buildSearchParams({ ...params, email, key })}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
      cache: 'no-store',
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 401) {
        throw errorWithCode('UNAUTHENTICATED', 'Invalid API key or email');
      }
      if (response.status === 429) {
        throw errorWithCode('UNAVAILABLE', 'Rate limit exceeded');
      }
      if (response.status >= 500) {
        throw errorWithCode('UNAVAILABLE', 'FOFA server error');
      }
      throw errorWithCode('UNKNOWN', `HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw errorWithCode('DEADLINE_EXCEEDED', 'Request timeout');
    }
    if (error instanceof GrpcError) {
      throw error;
    }
    throw errorWithCode('UNAVAILABLE', `Network error: ${error.message}`);
  }
};

// Search handler - FOFA API v1 /search/all
// Use for: asset discovery, host investigation, attack surface enumeration, vulnerability assessment
// Example queries: domain="example.com", ip="1.1.1.1", app="Nginx", title="login"
export const Search = async (ctx) => {
  const req = ctx.request;
  const query = unwrapString(req.query);
  if (!query || query.trim() === '') {
    throw errorWithCode('INVALID_ARGUMENT', 'query is required');
  }

  const page = unwrapInt(req.page) ?? DEFAULT_PAGE;
  const size = unwrapInt(req.size) ?? DEFAULT_SIZE;
  const fields = unwrapString(req.fields) || DEFAULT_FIELDS;
  const full = unwrapBoolean(req.full);

  if (size < 1 || size > MAX_SIZE) {
    throw errorWithCode('INVALID_ARGUMENT', `size must be between 1 and ${MAX_SIZE}`);
  }

  // FOFA API requires base64 encoded query string as qbase64
  const qbase64 = Buffer.from(query, 'utf-8').toString('base64');

  const params = {
    qbase64,
    page: String(page),
    size: String(size),
    fields,
  };

  // full=true searches all historical data (default: 1 year)
  if (full) {
    params.full = 'true';
  }

  const data = await makeRequest(ctx, '/search/all', params);

  const results = [];
  if (data.results && Array.isArray(data.results)) {
    for (const item of data.results) {
      if (Array.isArray(item)) {
        // FOFA returns arrays when default fields: [host, ip, port, protocol, ...]
        results.push({
          host: item[0] || '',
          ip: item[1] || '',
          port: String(item[2] || ''),
          protocol: item[3] || '',
          raw: toValue(item),
        });
      } else {
        // FOFA returns objects when custom fields specified
        results.push({
          host: item.host || '',
          ip: item.ip || '',
          port: String(item.port || ''),
          protocol: item.protocol || '',
          raw: toValue(item),
        });
      }
    }
  }

  return {
    error: Boolean(data.error),
    errmsg: data.errmsg || '',
    size: data.size || 0,
    page: data.page || page,
    results,
  };
};

// GetAccountInfo handler - FOFA API v1 /info/my
export const GetAccountInfo = async (ctx) => {
  const data = await makeRequest(ctx, '/info/my', {});

  return {
    error: Boolean(data.error),
    errmsg: data.errmsg || '',
    raw: toValue(data),
  };
};

// GetStats handler - FOFA API v1 /search/stats
export const GetStats = async (ctx) => {
  const req = ctx.request;
  const query = unwrapString(req.query);
  if (!query || query.trim() === '') {
    throw errorWithCode('INVALID_ARGUMENT', 'query is required');
  }

  const fields = unwrapString(req.fields) || 'protocol,port,country';

  const validFields = ['protocol', 'domain', 'port', 'title', 'os', 'server', 'country', 'region', 'city', 'asn', 'org', 'asset_type', 'fid', 'icp'];
  const requestedFields = fields.split(',').map(f => f.trim()).filter(f => f);

  for (const f of requestedFields) {
    if (!validFields.includes(f)) {
      throw errorWithCode('INVALID_ARGUMENT', `field "${f}" must be one of: ${validFields.join(', ')}`);
    }
  }

  // FOFA API requires base64 encoded query string as qbase64
  const qbase64 = Buffer.from(query, 'utf-8').toString('base64');

  const params = {
    qbase64,
    fields: requestedFields.join(','),
  };

  const data = await makeRequest(ctx, '/search/stats', params);

  return {
    error: Boolean(data.error),
    errmsg: data.errmsg || '',
    raw: toValue(data),
  };
};

export const METHOD_SEARCH_FULL = 'FOFA.FOFA/Search';
export const METHOD_GET_ACCOUNT_INFO_FULL = 'FOFA.FOFA/GetAccountInfo';
export const METHOD_GET_STATS_FULL = 'FOFA.FOFA/GetStats';

export const handlers = {
  [METHOD_SEARCH_FULL]: Search,
  [METHOD_GET_ACCOUNT_INFO_FULL]: GetAccountInfo,
  [METHOD_GET_STATS_FULL]: GetStats,
};

export const _test = {
  mergedBindings,
  parseHeaders,
  unwrapString,
  unwrapInt,
  unwrapBoolean,
  normalizeBaseUrl,
  errorWithCode,
};