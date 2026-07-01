// Chaitin_CLOUDATLAS CloudAtlas proxy — 52 gRPC method handlers
// Bindings: baseUrl (required), token (required from secret), headers (optional), timeoutMs (optional), space (optional)

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const DEFAULT_TIMEOUT_MS = 15000;
let insecureDispatcherPromise;

// ── gRPC status code mapping ──────────────────────────────────────────

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  DEADLINE_EXCEEDED: grpcStatus.DEADLINE_EXCEEDED,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

// ── Method path constants ─────────────────────────────────────────────

// Seed (11)
const LIST_ENTERPRISE_SUBJECTS_PATH    = '/CloudAtlas.CloudAtlas/ListEnterpriseSubjects';
const BATCH_CREATE_ENTERPRISE_SUBJECTS_PATH = '/CloudAtlas.CloudAtlas/BatchCreateEnterpriseSubjects';
const BATCH_DELETE_ENTERPRISE_SUBJECTS_PATH = '/CloudAtlas.CloudAtlas/BatchDeleteEnterpriseSubjects';
const LIST_KEYWORDS_PATH               = '/CloudAtlas.CloudAtlas/ListKeywords';
const BATCH_CREATE_KEYWORDS_PATH       = '/CloudAtlas.CloudAtlas/BatchCreateKeywords';
const LIST_SEED_DOMAINS_PATH           = '/CloudAtlas.CloudAtlas/ListSeedDomains';
const BATCH_CREATE_SEED_DOMAINS_PATH   = '/CloudAtlas.CloudAtlas/BatchCreateSeedDomains';
const LIST_SEED_CERTS_PATH             = '/CloudAtlas.CloudAtlas/ListSeedCerts';
const LIST_SEED_ICONS_PATH             = '/CloudAtlas.CloudAtlas/ListSeedIcons';
const LIST_SEED_WEB_TITLES_PATH        = '/CloudAtlas.CloudAtlas/ListSeedWebTitles';
const BATCH_UPDATE_SEEDS_PATH          = '/CloudAtlas.CloudAtlas/BatchUpdateSeeds';

// Asset (9)
const LIST_ROOT_DOMAINS_PATH           = '/CloudAtlas.CloudAtlas/ListRootDomains';
const BATCH_CREATE_ROOT_DOMAINS_PATH   = '/CloudAtlas.CloudAtlas/BatchCreateRootDomains';
const LIST_SUBDOMAINS_PATH             = '/CloudAtlas.CloudAtlas/ListSubdomains';
const LIST_DNS_PATH                    = '/CloudAtlas.CloudAtlas/ListDNS';
const LIST_IPS_PATH                    = '/CloudAtlas.CloudAtlas/ListIPs';
const BATCH_CREATE_IPS_PATH            = '/CloudAtlas.CloudAtlas/BatchCreateIPs';
const LIST_ASSET_CERTS_PATH            = '/CloudAtlas.CloudAtlas/ListAssetCerts';
const BATCH_UPDATE_ASSET_STATUS_PATH   = '/CloudAtlas.CloudAtlas/BatchUpdateAssetStatus';
const BATCH_DELETE_ASSETS_PATH         = '/CloudAtlas.CloudAtlas/BatchDeleteAssets';

// Attack (6)
const LIST_PORTS_PATH                  = '/CloudAtlas.CloudAtlas/ListPorts';
const LIST_OPEN_PORTS_PATH             = '/CloudAtlas.CloudAtlas/ListOpenPorts';
const LIST_WEB_ENTITIES_PATH           = '/CloudAtlas.CloudAtlas/ListWebEntities';
const LIST_WEB_PATHS_PATH              = '/CloudAtlas.CloudAtlas/ListWebPaths';
const LIST_WEB_FINGERPRINTS_PATH       = '/CloudAtlas.CloudAtlas/ListWebFingerprints';
const LIST_CRAWLER_DATA_PATH           = '/CloudAtlas.CloudAtlas/ListCrawlerData';

// Risk (5)
const LIST_VULNERABILITIES_PATH        = '/CloudAtlas.CloudAtlas/ListVulnerabilities';
const BATCH_UPDATE_VULN_STATUS_PATH    = '/CloudAtlas.CloudAtlas/BatchUpdateVulnStatus';
const LIST_HIGH_RISK_APPS_PATH         = '/CloudAtlas.CloudAtlas/ListHighRiskApps';
const GET_HIGH_RISK_APP_FINGERS_PATH   = '/CloudAtlas.CloudAtlas/GetHighRiskAppFingers';
const LIST_HIGH_RISK_SERVICES_PATH     = '/CloudAtlas.CloudAtlas/ListHighRiskServices';

// KB (4)
const LIST_VENDORS_PATH                = '/CloudAtlas.CloudAtlas/ListVendors';
const LIST_PRODUCTS_PATH               = '/CloudAtlas.CloudAtlas/ListProducts';
const LIST_VULN_SUBJECTS_PATH          = '/CloudAtlas.CloudAtlas/ListVulnSubjects';
const LIST_KB_VULNS_PATH               = '/CloudAtlas.CloudAtlas/ListKBVulns';

// DRPS (10)
const LIST_MONITORING_RULES_PATH       = '/CloudAtlas.CloudAtlas/ListMonitoringRules';
const BATCH_CREATE_MONITORING_RULES_PATH = '/CloudAtlas.CloudAtlas/BatchCreateMonitoringRules';
const LIST_GITHUB_LEAKS_PATH           = '/CloudAtlas.CloudAtlas/ListGithubLeaks';
const LIST_DISK_LEAKS_PATH             = '/CloudAtlas.CloudAtlas/ListDiskLeaks';
const LIST_DOC_LEAKS_PATH              = '/CloudAtlas.CloudAtlas/ListDocLeaks';
const LIST_DARKNET_INTEL_PATH          = '/CloudAtlas.CloudAtlas/ListDarknetIntel';
const LIST_STOLEN_DATA_PATH            = '/CloudAtlas.CloudAtlas/ListStolenData';
const LIST_EMAIL_LEAKS_PATH            = '/CloudAtlas.CloudAtlas/ListEmailLeaks';
const LIST_MOBILE_APPS_PATH            = '/CloudAtlas.CloudAtlas/ListMobileApps';
const LIST_SOCIAL_MEDIA_PATH           = '/CloudAtlas.CloudAtlas/ListSocialMedia';

// Task (4)
const LIST_TASK_SCHEDULES_PATH         = '/CloudAtlas.CloudAtlas/ListTaskSchedules';
const CREATE_TASK_SCHEDULE_PATH        = '/CloudAtlas.CloudAtlas/CreateTaskSchedule';
const LIST_TASK_INSTANCES_PATH         = '/CloudAtlas.CloudAtlas/ListTaskInstances';
const CREATE_TASK_INSTANCE_PATH        = '/CloudAtlas.CloudAtlas/CreateTaskInstance';

// Space (3)
const LIST_SPACES_PATH                 = '/CloudAtlas.CloudAtlas/ListSpaces';
const LIST_TAGS_PATH                   = '/CloudAtlas.CloudAtlas/ListTags';
const LIST_BUSINESS_UNITS_PATH         = '/CloudAtlas.CloudAtlas/ListBusinessUnits';

// ── Generic helpers ───────────────────────────────────────────────────

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.bindings ?? {}),
  ...(ctx?.secret ?? {}),
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

const normalizeListResponse = (json) => {
  // CloudAtlas wraps in {code:200, data:{items:[], total:N}}
  const data = json?.data && typeof json.data === 'object' ? json.data : json;
  if (Array.isArray(data)) return data;
  if (data?.results && Array.isArray(data.results)) return data.results;
  if (data?.items && Array.isArray(data.items)) return data.items;
  if (Array.isArray(json?.results)) return json.results;
  if (Array.isArray(json?.items)) return json.items;
  return [];
};

const getTotal = (json) => {
  const data = json?.data && typeof json.data === 'object' ? json.data : json;
  return data?.count ?? data?.total ?? json?.count ?? json?.total ?? 0;
};

const isSuccessResponse = (json) => {
  if (json?.code === 200) return true;
  if (json?.code === 0) return true;
  return false;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const unwrapString = (source) => {
  if (source === undefined || source === null) return '';
  if (typeof source === 'object' && source !== null && 'value' in source) {
    return String(source.value ?? '');
  }
  return String(source);
};

const unwrapList = (source) => {
  if (source === undefined || source === null) return undefined;
  if (Array.isArray(source)) return source;
  if (typeof source === 'object' && source !== null && hasOwn(source, 'values')) {
    return source.values;
  }
  return source;
};

const firstDefined = (...vals) => vals.find((v) => v !== undefined && v !== null);

const createTlsDispatcher = async (skipTlsVerify) => {
  if (!skipTlsVerify) return undefined;
  insecureDispatcherPromise ??= import('undici').then(({ Agent }) => new Agent({
    connect: { rejectUnauthorized: false },
  }));
  return insecureDispatcherPromise;
};

const fetchWithTimeout = async (url, init = {}, options = {}) => {
  const timeout = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS;
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
  const dispatcher = await createTlsDispatcher(options.skipTlsVerify);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
    });
  } finally {
    clearTimeout(timer);
    if (parentSignal && typeof parentSignal.removeEventListener === 'function') {
      parentSignal.removeEventListener('abort', abortFromParent);
    }
  }
};

const toQueryNumber = (val, allowZero = false) => {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'object' && 'value' in val) return toQueryNumber(val.value, allowZero);
  const num = Number(val);
  if (!Number.isInteger(num) || Number.isNaN(num)) return undefined;
  if (!allowZero && num <= 0) return undefined;
  if (allowZero && num < 0) return undefined;
  return num;
};

const toBooleanStrict = (val) => {
  if (typeof val === 'boolean') return val;
  if (val === undefined || val === null) return false;
  if (typeof val === 'number') {
    if (Number.isNaN(val)) return false;
    return val !== 0;
  }
  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
    if (lower === '1') return true;
    if (lower === '0') return false;
  }
  return Boolean(val);
};

const toBooleanOrNull = (val) => {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'object' && val !== null && 'value' in val) return toBooleanOrNull(val.value);
  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
  }
  if (typeof val === 'number') {
    if (val === 1) return true;
    if (val === 0) return false;
  }
  return null;
};

const buildQuery = (params) => {
  const parts = [];
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null && val !== '') {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`);
    }
  }
  return parts.length ? `?${parts.join('&')}` : '';
};

const VALID_SEED_RESOURCE_TYPES = ['enterprise', 'keyword', 'domain', 'email-domain', 'cert', 'icon', 'web-title'];
const VALID_ASSET_RESOURCE_TYPES_STATUS = ['root-domain', 'subdomain', 'dns', 'ip', 'cert'];
const VALID_ASSET_RESOURCE_TYPES_DELETE = ['root-domain', 'subdomain', 'dns', 'ip'];

// ── rpcdef ────────────────────────────────────────────────────────────

export function rpcdef(ctx) {
  const bindings = mergedBindings(ctx);
  const restBaseUrl = bindings.baseUrl || bindings.restBaseUrl || bindings.rest_base_url || bindings.base_url || bindings.endpoint || '';
  const defaultSpace = bindings.space ?? bindings.defaultSpace ?? bindings.default_space;
  const timeoutMs = ctx.limits?.timeoutMs || bindings.timeoutMs || DEFAULT_TIMEOUT_MS;
  const baseHeaders = parseHeaders(bindings.headers);
  const meta = ctx.meta || {};
  const skipTlsVerify = Boolean(bindings.tlsInsecureSkipVerify || bindings.skipTlsVerify || bindings.skip_tls_verify || bindings.tls_insecure_skip_verify);
  const resolvedToken = String(firstDefined(bindings.token, bindings.Token) || '').trim();

  const requestWithDefaults = (req = {}) => {
    const space = firstDefined(req?.space, req?.Space, defaultSpace);
    const { token: _requestToken, Token: _requestTokenUpper, ...rest } = req ?? {};
    if (space === undefined && space === null) return rest;
    return {
      ...(space !== undefined && space !== null ? { space } : {}),
      ...rest,
    };
  };

  const logFlow = (action, details) => {
    const inst = meta.instance_id || meta.instanceId;
    const reqId = meta.request_id || meta.requestId;
    const trace = [];
    if (inst) trace.push(`inst=${inst}`);
    if (reqId) trace.push(`req=${reqId}`);
    const prefix = `[CloudAtlas][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
    try {
      console.log(prefix, JSON.stringify(details));
    } catch {
      console.log(prefix, details);
    }
  };

  const buildHeaders = (token) => ({
    ...baseHeaders,
    'TOKEN': token,
    'x-engine-instance': meta.instance_id || meta.instanceId || 'unknown',
    'x-request-id': meta.request_id || meta.requestId || 'unknown',
  });

  const fetchCloudAtlas = async (url, init) => {
    try {
      return await fetchWithTimeout(url, init, { timeoutMs, skipTlsVerify });
    } catch (e) {
      const reason = e?.cause?.message || e?.message || 'fetch failed';
      throw errorWithCode('UNAVAILABLE', reason);
    }
  };

  const throwForHttpError = (status, text) => {
    if (status === 401 || status === 403) {
      throw errorWithCode('PERMISSION_DENIED', `upstream http ${status}: ${text}`);
    }
    if (status >= 400 && status < 500) {
      throw errorWithCode('FAILED_PRECONDITION', `upstream http ${status}: ${text}`);
    }
    throw errorWithCode('UNAVAILABLE', `upstream http ${status}: ${text}`);
  };

  const readJsonResponse = async (res, emptyValue) => {
    const text = await res.text();
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok) {
      throwForHttpError(res.status, text);
    }
    if (!text.trim()) {
      return emptyValue;
    }
    let json;
    if (contentType.includes('application/json')) {
      json = JSON.parse(text);
    } else {
      try { json = JSON.parse(text); } catch { throw errorWithCode('UNKNOWN', 'response is not valid JSON'); }
    }
    // CloudAtlas returns {code: N, message: "...", data: ...}; non-200 code means business error
    if (json && typeof json === 'object' && 'code' in json && json.code !== 200 && json.code !== 0) {
      throw errorWithCode('FAILED_PRECONDITION', `CloudAtlas code ${json.code}: ${json.message || 'unknown error'}`);
    }
    return json;
  };

  // ── Common request helpers ──────────────────────────────────────────

  const ensureTokenAndBaseUrl = (req) => {
    if (!resolvedToken) {
      throw errorWithCode('INVALID_ARGUMENT', 'token is required');
    }
    const baseUrl = normalizeBaseUrl(restBaseUrl);
    if (!baseUrl) {
      throw errorWithCode('INVALID_ARGUMENT', 'baseUrl is required (http/https)');
    }
    return { token: resolvedToken, baseUrl };
  };

  const callGet = async (token, url) => {
    const headers = buildHeaders(token);
    const res = await fetchCloudAtlas(url, { method: 'GET', headers });
    return readJsonResponse(res, {});
  };

  const callPost = async (token, url, body) => {
    const headers = { ...buildHeaders(token), 'content-type': 'application/json' };
    const res = await fetchCloudAtlas(url, { method: 'POST', headers, body: JSON.stringify(body) });
    return readJsonResponse(res, {});
  };

  const callDeleteWithBody = async (token, url, body) => {
    const headers = { ...buildHeaders(token), 'content-type': 'application/json' };
    const res = await fetchCloudAtlas(url, { method: 'DELETE', headers, body: JSON.stringify(body) });
    return readJsonResponse(res, {});
  };

  // ── Seed handlers ───────────────────────────────────────────────────

  const callListEnterpriseSubjects = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const enable = toBooleanOrNull(req?.enable);
    if (enable !== null && enable !== undefined) params.enable = enable;
    const confidence = unwrapString(req?.confidence);
    if (confidence) params.confidence = confidence;
    const status = unwrapString(req?.status);
    if (status) params.status = status;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/seed/enterprise${qs}`;
    logFlow('ListEnterpriseSubjects', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callBatchCreateEnterpriseSubjects = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const entries = unwrapList(req?.entries);
    if (!Array.isArray(entries) || entries.length === 0) {
      throw errorWithCode('INVALID_ARGUMENT', 'entries must be a non-empty array');
    }
    const body = { entries };
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) body.space = toQueryNumber(space, true) ?? space;

    const url = `${baseUrl}/openapi/v1/seed/enterprise/batch-create`;
    logFlow('BatchCreateEnterpriseSubjects', { url, count: entries.length });

    const json = await callPost(token, url, body);
    return {
      affected_count: json?.affected_count ?? json?.count ?? 0,
      message: json?.message ?? '',
    };
  };

  const callBatchDeleteEnterpriseSubjects = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const ids = unwrapList(req?.ids);
    if (!Array.isArray(ids) || ids.length === 0) {
      throw errorWithCode('INVALID_ARGUMENT', 'ids must be a non-empty array');
    }
    const body = { ids };
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) body.space = toQueryNumber(space, true) ?? space;

    const url = `${baseUrl}/openapi/v1/seed/enterprise/batch-delete`;
    logFlow('BatchDeleteEnterpriseSubjects', { url, count: ids.length });

    const json = await callDeleteWithBody(token, url, body);
    return {
      affected_count: json?.affected_count ?? json?.count ?? 0,
      message: json?.message ?? '',
    };
  };

  const callListKeywords = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const enable = toBooleanOrNull(req?.enable);
    if (enable !== null && enable !== undefined) params.enable = enable;
    const confidence = unwrapString(req?.confidence);
    if (confidence) params.confidence = confidence;
    const type = unwrapString(req?.type);
    if (type) params.type = type;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/seed/keyword${qs}`;
    logFlow('ListKeywords', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callBatchCreateKeywords = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const entries = unwrapList(req?.entries);
    if (!Array.isArray(entries) || entries.length === 0) {
      throw errorWithCode('INVALID_ARGUMENT', 'entries must be a non-empty array');
    }
    const body = { entries };
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) body.space = toQueryNumber(space, true) ?? space;

    const url = `${baseUrl}/openapi/v1/seed/keyword/batch-create`;
    logFlow('BatchCreateKeywords', { url, count: entries.length });

    const json = await callPost(token, url, body);
    return {
      affected_count: json?.affected_count ?? json?.count ?? 0,
      message: json?.message ?? '',
    };
  };

  const callListSeedDomains = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const enable = toBooleanOrNull(req?.enable);
    if (enable !== null && enable !== undefined) params.enable = enable;
    const confidence = unwrapString(req?.confidence);
    if (confidence) params.confidence = confidence;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/seed/domain${qs}`;
    logFlow('ListSeedDomains', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callBatchCreateSeedDomains = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const entries = unwrapList(req?.entries);
    if (!Array.isArray(entries) || entries.length === 0) {
      throw errorWithCode('INVALID_ARGUMENT', 'entries must be a non-empty array');
    }
    const body = { entries };
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) body.space = toQueryNumber(space, true) ?? space;

    const url = `${baseUrl}/openapi/v1/seed/domain/batch-create`;
    logFlow('BatchCreateSeedDomains', { url, count: entries.length });

    const json = await callPost(token, url, body);
    return {
      affected_count: json?.affected_count ?? json?.count ?? 0,
      message: json?.message ?? '',
    };
  };

  const callListSeedCerts = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/seed/cert${qs}`;
    logFlow('ListSeedCerts', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callListSeedIcons = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/seed/icon${qs}`;
    logFlow('ListSeedIcons', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callListSeedWebTitles = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/seed/web-title${qs}`;
    logFlow('ListSeedWebTitles', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callBatchUpdateSeeds = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const resourceType = unwrapString(req?.resource_type);
    if (!resourceType) {
      throw errorWithCode('INVALID_ARGUMENT', 'resource_type is required');
    }
    // Normalize: proto uses underscores, API uses hyphens
    const apiResourceType = resourceType === 'email_domain' ? 'email-domain'
      : resourceType === 'web_title' ? 'web-title'
      : resourceType;
    if (!VALID_SEED_RESOURCE_TYPES.includes(apiResourceType)) {
      throw errorWithCode('INVALID_ARGUMENT', `resource_type must be one of: ${VALID_SEED_RESOURCE_TYPES.join(', ')}`);
    }

    const ids = unwrapList(req?.ids);
    if (!Array.isArray(ids) || ids.length === 0) {
      throw errorWithCode('INVALID_ARGUMENT', 'ids must be a non-empty array');
    }

    const updateType = unwrapString(req?.update_type);
    if (!updateType) {
      throw errorWithCode('INVALID_ARGUMENT', 'update_type is required (switch or confidence)');
    }

    const body = { ids };

    if (updateType === 'switch') {
      const enable = toBooleanOrNull(req?.enable);
      if (enable === null || enable === undefined) {
        throw errorWithCode('INVALID_ARGUMENT', 'enable is required for switch operation');
      }
      body.enable = enable;
      const url = `${baseUrl}/openapi/v1/seed/${apiResourceType}/switch`;
      const space = firstDefined(req?.space, defaultSpace);
      if (space !== undefined && space !== null) body.space = toQueryNumber(space, true) ?? space;
      logFlow('BatchUpdateSeeds:switch', { resourceType: apiResourceType, url, count: ids.length });

      const json = await callPost(token, url, body);
      return {
        affected_count: json?.affected_count ?? json?.count ?? 0,
        message: json?.message ?? '',
      };
    }

    if (updateType === 'confidence' || updateType === 'update-confidence') {
      const confidence = unwrapString(req?.confidence);
      if (!confidence) {
        throw errorWithCode('INVALID_ARGUMENT', 'confidence is required for confidence operation');
      }
      body.confidence = confidence;
      const url = `${baseUrl}/openapi/v1/seed/${apiResourceType}/update-confidence`;
      const space = firstDefined(req?.space, defaultSpace);
      if (space !== undefined && space !== null) body.space = toQueryNumber(space, true) ?? space;
      logFlow('BatchUpdateSeeds:confidence', { resourceType: apiResourceType, url, count: ids.length });

      const json = await callPost(token, url, body);
      return {
        affected_count: json?.affected_count ?? json?.count ?? 0,
        message: json?.message ?? '',
      };
    }

    throw errorWithCode('INVALID_ARGUMENT', `update_type must be "switch" or "confidence", got "${updateType}"`);
  };

  // ── Asset handlers ──────────────────────────────────────────────────

  const callListRootDomains = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/asset/root-domain${qs}`;
    logFlow('ListRootDomains', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callBatchCreateRootDomains = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const entries = unwrapList(req?.entries);
    if (!Array.isArray(entries) || entries.length === 0) {
      throw errorWithCode('INVALID_ARGUMENT', 'entries must be a non-empty array');
    }
    const body = { entries };
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) body.space = toQueryNumber(space, true) ?? space;

    const url = `${baseUrl}/openapi/v1/asset/root-domain/batch-create`;
    logFlow('BatchCreateRootDomains', { url, count: entries.length });

    const json = await callPost(token, url, body);
    return {
      affected_count: json?.affected_count ?? json?.count ?? 0,
      message: json?.message ?? '',
    };
  };

  const callListSubdomains = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const hostname = unwrapString(req?.hostname);
    if (hostname) params.hostname = hostname;
    const enable = toBooleanOrNull(req?.enable);
    if (enable !== null && enable !== undefined) params.enable = enable;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/asset/subdomain${qs}`;
    logFlow('ListSubdomains', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callListDNS = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const hostname = unwrapString(req?.hostname);
    if (hostname) params.hostname = hostname;
    const viewMode = unwrapString(req?.view_mode);
    if (viewMode) params.view_mode = viewMode;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/asset/dns${qs}`;
    logFlow('ListDNS', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callListIPs = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const ip = unwrapString(req?.ip);
    if (ip) params.ip = ip;
    const hostname = unwrapString(req?.hostname);
    if (hostname) params.hostname = hostname;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/asset/ip${qs}`;
    logFlow('ListIPs', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callBatchCreateIPs = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const entries = unwrapList(req?.entries);
    if (!Array.isArray(entries) || entries.length === 0) {
      throw errorWithCode('INVALID_ARGUMENT', 'entries must be a non-empty array');
    }
    const body = { entries };
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) body.space = toQueryNumber(space, true) ?? space;

    const url = `${baseUrl}/openapi/v1/asset/ip/batch-create`;
    logFlow('BatchCreateIPs', { url, count: entries.length });

    const json = await callPost(token, url, body);
    return {
      affected_count: json?.affected_count ?? json?.count ?? 0,
      message: json?.message ?? '',
    };
  };

  const callListAssetCerts = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/asset/cert${qs}`;
    logFlow('ListAssetCerts', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callBatchUpdateAssetStatus = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const resourceType = unwrapString(req?.resource_type);
    if (!resourceType) {
      throw errorWithCode('INVALID_ARGUMENT', 'resource_type is required');
    }
    // Normalize: proto uses underscores, API uses hyphens
    const apiResourceType = resourceType === 'root_domain' ? 'root-domain'
      : resourceType;
    if (!VALID_ASSET_RESOURCE_TYPES_STATUS.includes(apiResourceType)) {
      throw errorWithCode('INVALID_ARGUMENT', `resource_type must be one of: ${VALID_ASSET_RESOURCE_TYPES_STATUS.join(', ')}`);
    }

    const ids = unwrapList(req?.ids);
    if (!Array.isArray(ids) || ids.length === 0) {
      throw errorWithCode('INVALID_ARGUMENT', 'ids must be a non-empty array');
    }

    const status = unwrapString(req?.status);
    if (!status) {
      throw errorWithCode('INVALID_ARGUMENT', 'status is required');
    }

    const body = { ids, status };
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) body.space = toQueryNumber(space, true) ?? space;

    const url = `${baseUrl}/openapi/v1/asset/${apiResourceType}/status`;
    logFlow('BatchUpdateAssetStatus', { resourceType: apiResourceType, url, count: ids.length });

    const json = await callPost(token, url, body);
    return {
      affected_count: json?.affected_count ?? json?.count ?? 0,
      message: json?.message ?? '',
    };
  };

  const callBatchDeleteAssets = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const resourceType = unwrapString(req?.resource_type);
    if (!resourceType) {
      throw errorWithCode('INVALID_ARGUMENT', 'resource_type is required');
    }
    // Normalize: proto uses underscores, API uses hyphens
    const apiResourceType = resourceType === 'root_domain' ? 'root-domain'
      : resourceType;
    if (!VALID_ASSET_RESOURCE_TYPES_DELETE.includes(apiResourceType)) {
      throw errorWithCode('INVALID_ARGUMENT', `resource_type must be one of: ${VALID_ASSET_RESOURCE_TYPES_DELETE.join(', ')}`);
    }

    const ids = unwrapList(req?.ids);
    if (!Array.isArray(ids) || ids.length === 0) {
      throw errorWithCode('INVALID_ARGUMENT', 'ids must be a non-empty array');
    }

    const body = { ids };
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) body.space = toQueryNumber(space, true) ?? space;

    const url = `${baseUrl}/openapi/v1/asset/${apiResourceType}/batch-delete`;
    logFlow('BatchDeleteAssets', { resourceType: apiResourceType, url, count: ids.length });

    const json = await callDeleteWithBody(token, url, body);
    return {
      affected_count: json?.affected_count ?? json?.count ?? 0,
      message: json?.message ?? '',
    };
  };

  // ── Attack handlers ─────────────────────────────────────────────────

  const callListPorts = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const ip = unwrapString(req?.ip);
    if (ip) params.ip = ip;
    const port = toQueryNumber(req?.port, true);
    if (port !== undefined) params.port = port;
    const hostname = unwrapString(req?.hostname);
    if (hostname) params.hostname = hostname;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/attack/port${qs}`;
    logFlow('ListPorts', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callListOpenPorts = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const ip = unwrapString(req?.ip);
    if (ip) params.ip = ip;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/attack/openport${qs}`;
    logFlow('ListOpenPorts', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callListWebEntities = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const hostname = unwrapString(req?.hostname);
    if (hostname) params.hostname = hostname;
    const urlParam = unwrapString(req?.url);
    if (urlParam) params.url = urlParam;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/attack/web${qs}`;
    logFlow('ListWebEntities', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callListWebPaths = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const urlParam = unwrapString(req?.url);
    if (urlParam) params.url = urlParam;
    const viewMode = unwrapString(req?.view_mode);
    if (viewMode) params.view_mode = viewMode;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/attack/dir${qs}`;
    logFlow('ListWebPaths', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callListWebFingerprints = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/attack/appfinger${qs}`;
    logFlow('ListWebFingerprints', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callListCrawlerData = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const urlParam = unwrapString(req?.url);
    if (urlParam) params.url = urlParam;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/attack/crawler${qs}`;
    logFlow('ListCrawlerData', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  // ── Risk handlers ───────────────────────────────────────────────────

  const callListVulnerabilities = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const hostname = unwrapString(req?.hostname);
    if (hostname) params.hostname = hostname;
    const status = unwrapString(req?.status);
    if (status) params.status = status;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/risk/high-risk${qs}`;
    logFlow('ListVulnerabilities', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callBatchUpdateVulnStatus = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const ids = unwrapList(req?.ids);
    if (!Array.isArray(ids) || ids.length === 0) {
      throw errorWithCode('INVALID_ARGUMENT', 'ids must be a non-empty array');
    }

    const updateType = unwrapString(req?.update_type);
    if (!updateType) {
      throw errorWithCode('INVALID_ARGUMENT', 'update_type is required (status or recheck)');
    }

    const body = { ids };
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) body.space = toQueryNumber(space, true) ?? space;

    if (updateType === 'status') {
      const status = unwrapString(req?.status);
      if (!status) {
        throw errorWithCode('INVALID_ARGUMENT', 'status is required for status update');
      }
      body.status = status;
      const url = `${baseUrl}/openapi/v1/risk/high-risk/status`;
      logFlow('BatchUpdateVulnStatus:status', { url, count: ids.length });

      const json = await callPost(token, url, body);
      return {
        affected_count: json?.affected_count ?? json?.count ?? 0,
        message: json?.message ?? '',
      };
    }

    if (updateType === 'recheck') {
      const url = `${baseUrl}/openapi/v1/risk/high-risk/recheck`;
      logFlow('BatchUpdateVulnStatus:recheck', { url, count: ids.length });

      const json = await callPost(token, url, body);
      return {
        affected_count: json?.affected_count ?? json?.count ?? 0,
        message: json?.message ?? '',
      };
    }

    throw errorWithCode('INVALID_ARGUMENT', `update_type must be "status" or "recheck", got "${updateType}"`);
  };

  const callListHighRiskApps = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/risk/product${qs}`;
    logFlow('ListHighRiskApps', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callGetHighRiskAppFingers = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const rawPk = firstDefined(req?.pk, req?.Pk, req?.id, req?.Id);
    if (rawPk === undefined || rawPk === null) {
      throw errorWithCode('INVALID_ARGUMENT', 'pk is required');
    }
    const pk = Number(rawPk);
    if (!Number.isInteger(pk) || Number.isNaN(pk)) {
      throw errorWithCode('INVALID_ARGUMENT', 'pk must be an integer');
    }

    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/risk/product/${pk}/finger${qs}`;
    logFlow('GetHighRiskAppFingers', { url, pk });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callListHighRiskServices = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/risk/service${qs}`;
    logFlow('ListHighRiskServices', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  // ── KB handlers ─────────────────────────────────────────────────────

  const callListVendors = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/kb/vendor${qs}`;
    logFlow('ListVendors', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callListProducts = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const rawPk = firstDefined(req?.pk, req?.Pk, req?.id, req?.Id);

    // If pk is provided, fetch single product detail
    if (rawPk !== undefined && rawPk !== null) {
      const pk = Number(rawPk);
      if (!Number.isInteger(pk) || Number.isNaN(pk)) {
        throw errorWithCode('INVALID_ARGUMENT', 'pk must be an integer');
      }
      const url = `${baseUrl}/openapi/v1/kb/product/${pk}`;
      logFlow('ListProducts:detail', { url, pk });

      const json = await callGet(token, url);
      // Single item response — wrap into list format
      const items = Array.isArray(json) ? json : [json];
      return { items, total: items.length };
    }

    // Otherwise list products
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/kb/product${qs}`;
    logFlow('ListProducts', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callListVulnSubjects = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/kb/subject${qs}`;
    logFlow('ListVulnSubjects', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callListKBVulns = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const rawPk = firstDefined(req?.pk, req?.Pk, req?.id, req?.Id);

    // If pk is provided, fetch affected products for this vuln
    if (rawPk !== undefined && rawPk !== null) {
      const pk = Number(rawPk);
      if (!Number.isInteger(pk) || Number.isNaN(pk)) {
        throw errorWithCode('INVALID_ARGUMENT', 'pk must be an integer');
      }

      const params = {};
      const space = firstDefined(req?.space, defaultSpace);
      if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;

      const qs = buildQuery(params);
      const url = `${baseUrl}/openapi/v1/kb/vuln/${pk}/product${qs}`;
      logFlow('ListKBVulns:products', { url, pk });

      const json = await callGet(token, url);
      const items = normalizeListResponse(json);
      const total = getTotal(json);
      return { items, total };
    }

    // Otherwise list vulns
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/kb/vuln${qs}`;
    logFlow('ListKBVulns', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  // ── DRPS handlers ───────────────────────────────────────────────────

  const callListMonitoringRules = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const rawPk = firstDefined(req?.pk, req?.Pk, req?.id, req?.Id);

    // If pk is provided, fetch single rule detail
    if (rawPk !== undefined && rawPk !== null) {
      const pk = Number(rawPk);
      if (!Number.isInteger(pk) || Number.isNaN(pk)) {
        throw errorWithCode('INVALID_ARGUMENT', 'pk must be an integer');
      }
      const url = `${baseUrl}/openapi/v1/drps/rule/${pk}`;
      logFlow('ListMonitoringRules:detail', { url, pk });

      const json = await callGet(token, url);
      const items = Array.isArray(json) ? json : [json];
      return { items, total: items.length };
    }

    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/drps/rule${qs}`;
    logFlow('ListMonitoringRules', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callBatchCreateMonitoringRules = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const entries = unwrapList(req?.entries);
    if (!Array.isArray(entries) || entries.length === 0) {
      throw errorWithCode('INVALID_ARGUMENT', 'entries must be a non-empty array');
    }
    const body = { entries };
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) body.space = toQueryNumber(space, true) ?? space;

    const url = `${baseUrl}/openapi/v1/drps/rule/batch-create`;
    logFlow('BatchCreateMonitoringRules', { url, count: entries.length });

    const json = await callPost(token, url, body);
    return {
      affected_count: json?.affected_count ?? json?.count ?? 0,
      message: json?.message ?? '',
    };
  };

  const callListGithubLeaks = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/drps/github${qs}`;
    logFlow('ListGithubLeaks', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callListDiskLeaks = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/drps/disk${qs}`;
    logFlow('ListDiskLeaks', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callListDocLeaks = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/drps/doc${qs}`;
    logFlow('ListDocLeaks', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callListDarknetIntel = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/drps/darknet${qs}`;
    logFlow('ListDarknetIntel', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callListStolenData = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/drps/stealer-log${qs}`;
    logFlow('ListStolenData', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callListEmailLeaks = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/drps/email${qs}`;
    logFlow('ListEmailLeaks', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callListMobileApps = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/drps/app${qs}`;
    logFlow('ListMobileApps', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callListSocialMedia = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/drps/media${qs}`;
    logFlow('ListSocialMedia', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  // ── Task handlers ───────────────────────────────────────────────────

  const callListTaskSchedules = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const rawPk = firstDefined(req?.pk, req?.Pk, req?.id, req?.Id);

    // If pk is provided, fetch single schedule detail
    if (rawPk !== undefined && rawPk !== null) {
      const pk = Number(rawPk);
      if (!Number.isInteger(pk) || Number.isNaN(pk)) {
        throw errorWithCode('INVALID_ARGUMENT', 'pk must be an integer');
      }
      const url = `${baseUrl}/openapi/v1/task/schedule/${pk}`;
      logFlow('ListTaskSchedules:detail', { url, pk });

      const json = await callGet(token, url);
      const items = Array.isArray(json) ? json : [json];
      return { items, total: items.length };
    }

    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const taskType = unwrapString(req?.task_type);
    if (taskType) params.task_type = taskType;
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/task/schedule${qs}`;
    logFlow('ListTaskSchedules', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callCreateTaskSchedule = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const name = unwrapString(req?.name);
    const taskType = unwrapString(req?.task_type);
    const schedule = req?.schedule ?? req?.config ?? {};
    const extra = req?.extra ?? {};

    const body = {
      ...(name ? { name } : {}),
      ...(taskType ? { task_type: taskType } : {}),
      ...(typeof schedule === 'object' && schedule !== null ? schedule : {}),
      ...(typeof extra === 'object' && extra !== null ? extra : {}),
    };
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) body.space = toQueryNumber(space, true) ?? space;

    const url = `${baseUrl}/openapi/v1/task/schedule`;
    logFlow('CreateTaskSchedule', { url, name, taskType });

    const json = await callPost(token, url, body);

    const result = {
      id: (() => {
        const num = Number(json?.id);
        return Number.isInteger(num) && !Number.isNaN(num) ? num : 0;
      })(),
      message: json?.message ?? '',
    };

    // If run_immediately is set, also trigger run-immediately
    const runImmediately = toBooleanStrict(req?.run_immediately);
    if (runImmediately && result.id) {
      const runUrl = `${baseUrl}/openapi/v1/task/schedule/${result.id}/run-immediately`;
      logFlow('CreateTaskSchedule:run-immediately', { runUrl, id: result.id });
      try {
        await callPost(token, runUrl, {});
      } catch (e) {
        // Non-critical: schedule was created, run-immediately is optional
        logFlow('CreateTaskSchedule:run-immediately-failed', { error: e?.message });
      }
    }

    return result;
  };

  const callListTaskInstances = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const rawPk = firstDefined(req?.pk, req?.Pk, req?.id, req?.Id);

    // If pk is provided, fetch single instance detail
    if (rawPk !== undefined && rawPk !== null) {
      const pk = Number(rawPk);
      if (!Number.isInteger(pk) || Number.isNaN(pk)) {
        throw errorWithCode('INVALID_ARGUMENT', 'pk must be an integer');
      }
      const url = `${baseUrl}/openapi/v1/task/session/${pk}`;
      logFlow('ListTaskInstances:detail', { url, pk });

      const json = await callGet(token, url);
      const items = Array.isArray(json) ? json : [json];
      return { items, total: items.length };
    }

    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const taskType = unwrapString(req?.task_type);
    if (taskType) params.task_type = taskType;
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/task/session${qs}`;
    logFlow('ListTaskInstances', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callCreateTaskInstance = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const taskType = unwrapString(req?.task_type);
    const name = unwrapString(req?.name);
    const extra = req?.extra ?? {};

    const body = {
      ...(taskType ? { task_type: taskType } : {}),
      ...(name ? { name } : {}),
      ...(typeof extra === 'object' && extra !== null ? extra : {}),
    };
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) body.space = toQueryNumber(space, true) ?? space;

    const url = `${baseUrl}/openapi/v1/task/session`;
    logFlow('CreateTaskInstance', { url, name, taskType });

    const json = await callPost(token, url, body);
    return {
      id: (() => {
        const num = Number(json?.id);
        return Number.isInteger(num) && !Number.isNaN(num) ? num : 0;
      })(),
      message: json?.message ?? '',
    };
  };

  // ── Space handlers ──────────────────────────────────────────────────

  const callListSpaces = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);
    const rawPk = firstDefined(req?.pk, req?.Pk, req?.id, req?.Id);

    // If pk is provided, fetch single space detail
    if (rawPk !== undefined && rawPk !== null) {
      const pk = Number(rawPk);
      if (!Number.isInteger(pk) || Number.isNaN(pk)) {
        throw errorWithCode('INVALID_ARGUMENT', 'pk must be an integer');
      }
      const url = `${baseUrl}/openapi/v1/space/space/${pk}`;
      logFlow('ListSpaces:detail', { url, pk });

      const json = await callGet(token, url);
      const items = Array.isArray(json) ? json : [json];
      return { items, total: items.length };
    }

    // Space module does NOT use space query param — the space IS the resource
    const params = {};
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/space/space${qs}`;
    logFlow('ListSpaces', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callListTags = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);

    // If request has options=true or fetch_options, return tag options
    const fetchOptions = toBooleanStrict(firstDefined(req?.options, req?.fetch_options, req?.fetchOptions));
    if (fetchOptions) {
      const params = {};
      const space = firstDefined(req?.space, defaultSpace);
      if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;

      const qs = buildQuery(params);
      const url = `${baseUrl}/openapi/v1/space/tag/options${qs}`;
      logFlow('ListTags:options', { url });

      const json = await callGet(token, url);
      const items = normalizeListResponse(json);
      const total = getTotal(json);
      return { items, total };
    }

    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/space/tag${qs}`;
    logFlow('ListTags', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  const callListBusinessUnits = async (req) => {
    const { token, baseUrl } = ensureTokenAndBaseUrl(req);

    // If request has options=true or fetch_options, return BU options
    const fetchOptions = toBooleanStrict(firstDefined(req?.options, req?.fetch_options, req?.fetchOptions));
    if (fetchOptions) {
      const params = {};
      const space = firstDefined(req?.space, defaultSpace);
      if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;

      const qs = buildQuery(params);
      const url = `${baseUrl}/openapi/v1/space/bu/options${qs}`;
      logFlow('ListBusinessUnits:options', { url });

      const json = await callGet(token, url);
      const items = normalizeListResponse(json);
      const total = getTotal(json);
      return { items, total };
    }

    const params = {};
    const space = firstDefined(req?.space, defaultSpace);
    if (space !== undefined && space !== null) params.space = toQueryNumber(space, true) ?? space;
    const name = unwrapString(req?.name);
    if (name) params.name = name;
    const sort = unwrapString(req?.sort);
    if (sort) params.sort = sort;
    const page = toQueryNumber(req?.page, true);
    if (page !== undefined) params.page = page;
    const size = toQueryNumber(req?.size);
    if (size !== undefined) params.size = size;

    const qs = buildQuery(params);
    const url = `${baseUrl}/openapi/v1/space/bu${qs}`;
    logFlow('ListBusinessUnits', { url });

    const json = await callGet(token, url);
    const items = normalizeListResponse(json);
    const total = getTotal(json);
    return { items, total };
  };

  // ── rpcdef return ───────────────────────────────────────────────────

  return {
    [LIST_ENTERPRISE_SUBJECTS_PATH]:           async () => callListEnterpriseSubjects(requestWithDefaults(ctx.req)),
    [BATCH_CREATE_ENTERPRISE_SUBJECTS_PATH]:   async () => callBatchCreateEnterpriseSubjects(requestWithDefaults(ctx.req)),
    [BATCH_DELETE_ENTERPRISE_SUBJECTS_PATH]:   async () => callBatchDeleteEnterpriseSubjects(requestWithDefaults(ctx.req)),
    [LIST_KEYWORDS_PATH]:                      async () => callListKeywords(requestWithDefaults(ctx.req)),
    [BATCH_CREATE_KEYWORDS_PATH]:              async () => callBatchCreateKeywords(requestWithDefaults(ctx.req)),
    [LIST_SEED_DOMAINS_PATH]:                  async () => callListSeedDomains(requestWithDefaults(ctx.req)),
    [BATCH_CREATE_SEED_DOMAINS_PATH]:          async () => callBatchCreateSeedDomains(requestWithDefaults(ctx.req)),
    [LIST_SEED_CERTS_PATH]:                    async () => callListSeedCerts(requestWithDefaults(ctx.req)),
    [LIST_SEED_ICONS_PATH]:                    async () => callListSeedIcons(requestWithDefaults(ctx.req)),
    [LIST_SEED_WEB_TITLES_PATH]:               async () => callListSeedWebTitles(requestWithDefaults(ctx.req)),
    [BATCH_UPDATE_SEEDS_PATH]:                 async () => callBatchUpdateSeeds(requestWithDefaults(ctx.req)),
    [LIST_ROOT_DOMAINS_PATH]:                  async () => callListRootDomains(requestWithDefaults(ctx.req)),
    [BATCH_CREATE_ROOT_DOMAINS_PATH]:          async () => callBatchCreateRootDomains(requestWithDefaults(ctx.req)),
    [LIST_SUBDOMAINS_PATH]:                    async () => callListSubdomains(requestWithDefaults(ctx.req)),
    [LIST_DNS_PATH]:                           async () => callListDNS(requestWithDefaults(ctx.req)),
    [LIST_IPS_PATH]:                           async () => callListIPs(requestWithDefaults(ctx.req)),
    [BATCH_CREATE_IPS_PATH]:                   async () => callBatchCreateIPs(requestWithDefaults(ctx.req)),
    [LIST_ASSET_CERTS_PATH]:                   async () => callListAssetCerts(requestWithDefaults(ctx.req)),
    [BATCH_UPDATE_ASSET_STATUS_PATH]:          async () => callBatchUpdateAssetStatus(requestWithDefaults(ctx.req)),
    [BATCH_DELETE_ASSETS_PATH]:                async () => callBatchDeleteAssets(requestWithDefaults(ctx.req)),
    [LIST_PORTS_PATH]:                         async () => callListPorts(requestWithDefaults(ctx.req)),
    [LIST_OPEN_PORTS_PATH]:                    async () => callListOpenPorts(requestWithDefaults(ctx.req)),
    [LIST_WEB_ENTITIES_PATH]:                  async () => callListWebEntities(requestWithDefaults(ctx.req)),
    [LIST_WEB_PATHS_PATH]:                     async () => callListWebPaths(requestWithDefaults(ctx.req)),
    [LIST_WEB_FINGERPRINTS_PATH]:              async () => callListWebFingerprints(requestWithDefaults(ctx.req)),
    [LIST_CRAWLER_DATA_PATH]:                  async () => callListCrawlerData(requestWithDefaults(ctx.req)),
    [LIST_VULNERABILITIES_PATH]:               async () => callListVulnerabilities(requestWithDefaults(ctx.req)),
    [BATCH_UPDATE_VULN_STATUS_PATH]:           async () => callBatchUpdateVulnStatus(requestWithDefaults(ctx.req)),
    [LIST_HIGH_RISK_APPS_PATH]:                async () => callListHighRiskApps(requestWithDefaults(ctx.req)),
    [GET_HIGH_RISK_APP_FINGERS_PATH]:          async () => callGetHighRiskAppFingers(requestWithDefaults(ctx.req)),
    [LIST_HIGH_RISK_SERVICES_PATH]:            async () => callListHighRiskServices(requestWithDefaults(ctx.req)),
    [LIST_VENDORS_PATH]:                       async () => callListVendors(requestWithDefaults(ctx.req)),
    [LIST_PRODUCTS_PATH]:                      async () => callListProducts(requestWithDefaults(ctx.req)),
    [LIST_VULN_SUBJECTS_PATH]:                 async () => callListVulnSubjects(requestWithDefaults(ctx.req)),
    [LIST_KB_VULNS_PATH]:                      async () => callListKBVulns(requestWithDefaults(ctx.req)),
    [LIST_MONITORING_RULES_PATH]:              async () => callListMonitoringRules(requestWithDefaults(ctx.req)),
    [BATCH_CREATE_MONITORING_RULES_PATH]:      async () => callBatchCreateMonitoringRules(requestWithDefaults(ctx.req)),
    [LIST_GITHUB_LEAKS_PATH]:                  async () => callListGithubLeaks(requestWithDefaults(ctx.req)),
    [LIST_DISK_LEAKS_PATH]:                    async () => callListDiskLeaks(requestWithDefaults(ctx.req)),
    [LIST_DOC_LEAKS_PATH]:                     async () => callListDocLeaks(requestWithDefaults(ctx.req)),
    [LIST_DARKNET_INTEL_PATH]:                 async () => callListDarknetIntel(requestWithDefaults(ctx.req)),
    [LIST_STOLEN_DATA_PATH]:                   async () => callListStolenData(requestWithDefaults(ctx.req)),
    [LIST_EMAIL_LEAKS_PATH]:                   async () => callListEmailLeaks(requestWithDefaults(ctx.req)),
    [LIST_MOBILE_APPS_PATH]:                   async () => callListMobileApps(requestWithDefaults(ctx.req)),
    [LIST_SOCIAL_MEDIA_PATH]:                  async () => callListSocialMedia(requestWithDefaults(ctx.req)),
    [LIST_TASK_SCHEDULES_PATH]:                async () => callListTaskSchedules(requestWithDefaults(ctx.req)),
    [CREATE_TASK_SCHEDULE_PATH]:               async () => callCreateTaskSchedule(requestWithDefaults(ctx.req)),
    [LIST_TASK_INSTANCES_PATH]:                async () => callListTaskInstances(requestWithDefaults(ctx.req)),
    [CREATE_TASK_INSTANCE_PATH]:               async () => callCreateTaskInstance(requestWithDefaults(ctx.req)),
    [LIST_SPACES_PATH]:                        async () => callListSpaces(requestWithDefaults(ctx.req)),
    [LIST_TAGS_PATH]:                          async () => callListTags(requestWithDefaults(ctx.req)),
    [LIST_BUSINESS_UNITS_PATH]:                async () => callListBusinessUnits(requestWithDefaults(ctx.req)),
  };
}

// ── Context resolution helpers ────────────────────────────────────────

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
  const legacyCtx = {
    ...call.ctx,
    req: call.req,
  };
  return rpcdef(legacyCtx)[methodPath]();
};

// ── registerHandlers ──────────────────────────────────────────────────

const registerHandlers = (ctx = {}) => ({
  [LIST_ENTERPRISE_SUBJECTS_PATH]:           wrapLegacyHandler(ctx, LIST_ENTERPRISE_SUBJECTS_PATH),
  [BATCH_CREATE_ENTERPRISE_SUBJECTS_PATH]:   wrapLegacyHandler(ctx, BATCH_CREATE_ENTERPRISE_SUBJECTS_PATH),
  [BATCH_DELETE_ENTERPRISE_SUBJECTS_PATH]:   wrapLegacyHandler(ctx, BATCH_DELETE_ENTERPRISE_SUBJECTS_PATH),
  [LIST_KEYWORDS_PATH]:                      wrapLegacyHandler(ctx, LIST_KEYWORDS_PATH),
  [BATCH_CREATE_KEYWORDS_PATH]:              wrapLegacyHandler(ctx, BATCH_CREATE_KEYWORDS_PATH),
  [LIST_SEED_DOMAINS_PATH]:                  wrapLegacyHandler(ctx, LIST_SEED_DOMAINS_PATH),
  [BATCH_CREATE_SEED_DOMAINS_PATH]:          wrapLegacyHandler(ctx, BATCH_CREATE_SEED_DOMAINS_PATH),
  [LIST_SEED_CERTS_PATH]:                    wrapLegacyHandler(ctx, LIST_SEED_CERTS_PATH),
  [LIST_SEED_ICONS_PATH]:                    wrapLegacyHandler(ctx, LIST_SEED_ICONS_PATH),
  [LIST_SEED_WEB_TITLES_PATH]:               wrapLegacyHandler(ctx, LIST_SEED_WEB_TITLES_PATH),
  [BATCH_UPDATE_SEEDS_PATH]:                 wrapLegacyHandler(ctx, BATCH_UPDATE_SEEDS_PATH),
  [LIST_ROOT_DOMAINS_PATH]:                  wrapLegacyHandler(ctx, LIST_ROOT_DOMAINS_PATH),
  [BATCH_CREATE_ROOT_DOMAINS_PATH]:          wrapLegacyHandler(ctx, BATCH_CREATE_ROOT_DOMAINS_PATH),
  [LIST_SUBDOMAINS_PATH]:                    wrapLegacyHandler(ctx, LIST_SUBDOMAINS_PATH),
  [LIST_DNS_PATH]:                           wrapLegacyHandler(ctx, LIST_DNS_PATH),
  [LIST_IPS_PATH]:                           wrapLegacyHandler(ctx, LIST_IPS_PATH),
  [BATCH_CREATE_IPS_PATH]:                   wrapLegacyHandler(ctx, BATCH_CREATE_IPS_PATH),
  [LIST_ASSET_CERTS_PATH]:                   wrapLegacyHandler(ctx, LIST_ASSET_CERTS_PATH),
  [BATCH_UPDATE_ASSET_STATUS_PATH]:          wrapLegacyHandler(ctx, BATCH_UPDATE_ASSET_STATUS_PATH),
  [BATCH_DELETE_ASSETS_PATH]:                wrapLegacyHandler(ctx, BATCH_DELETE_ASSETS_PATH),
  [LIST_PORTS_PATH]:                         wrapLegacyHandler(ctx, LIST_PORTS_PATH),
  [LIST_OPEN_PORTS_PATH]:                    wrapLegacyHandler(ctx, LIST_OPEN_PORTS_PATH),
  [LIST_WEB_ENTITIES_PATH]:                  wrapLegacyHandler(ctx, LIST_WEB_ENTITIES_PATH),
  [LIST_WEB_PATHS_PATH]:                     wrapLegacyHandler(ctx, LIST_WEB_PATHS_PATH),
  [LIST_WEB_FINGERPRINTS_PATH]:              wrapLegacyHandler(ctx, LIST_WEB_FINGERPRINTS_PATH),
  [LIST_CRAWLER_DATA_PATH]:                  wrapLegacyHandler(ctx, LIST_CRAWLER_DATA_PATH),
  [LIST_VULNERABILITIES_PATH]:               wrapLegacyHandler(ctx, LIST_VULNERABILITIES_PATH),
  [BATCH_UPDATE_VULN_STATUS_PATH]:           wrapLegacyHandler(ctx, BATCH_UPDATE_VULN_STATUS_PATH),
  [LIST_HIGH_RISK_APPS_PATH]:                wrapLegacyHandler(ctx, LIST_HIGH_RISK_APPS_PATH),
  [GET_HIGH_RISK_APP_FINGERS_PATH]:          wrapLegacyHandler(ctx, GET_HIGH_RISK_APP_FINGERS_PATH),
  [LIST_HIGH_RISK_SERVICES_PATH]:            wrapLegacyHandler(ctx, LIST_HIGH_RISK_SERVICES_PATH),
  [LIST_VENDORS_PATH]:                       wrapLegacyHandler(ctx, LIST_VENDORS_PATH),
  [LIST_PRODUCTS_PATH]:                      wrapLegacyHandler(ctx, LIST_PRODUCTS_PATH),
  [LIST_VULN_SUBJECTS_PATH]:                 wrapLegacyHandler(ctx, LIST_VULN_SUBJECTS_PATH),
  [LIST_KB_VULNS_PATH]:                      wrapLegacyHandler(ctx, LIST_KB_VULNS_PATH),
  [LIST_MONITORING_RULES_PATH]:              wrapLegacyHandler(ctx, LIST_MONITORING_RULES_PATH),
  [BATCH_CREATE_MONITORING_RULES_PATH]:      wrapLegacyHandler(ctx, BATCH_CREATE_MONITORING_RULES_PATH),
  [LIST_GITHUB_LEAKS_PATH]:                  wrapLegacyHandler(ctx, LIST_GITHUB_LEAKS_PATH),
  [LIST_DISK_LEAKS_PATH]:                    wrapLegacyHandler(ctx, LIST_DISK_LEAKS_PATH),
  [LIST_DOC_LEAKS_PATH]:                     wrapLegacyHandler(ctx, LIST_DOC_LEAKS_PATH),
  [LIST_DARKNET_INTEL_PATH]:                 wrapLegacyHandler(ctx, LIST_DARKNET_INTEL_PATH),
  [LIST_STOLEN_DATA_PATH]:                   wrapLegacyHandler(ctx, LIST_STOLEN_DATA_PATH),
  [LIST_EMAIL_LEAKS_PATH]:                   wrapLegacyHandler(ctx, LIST_EMAIL_LEAKS_PATH),
  [LIST_MOBILE_APPS_PATH]:                   wrapLegacyHandler(ctx, LIST_MOBILE_APPS_PATH),
  [LIST_SOCIAL_MEDIA_PATH]:                  wrapLegacyHandler(ctx, LIST_SOCIAL_MEDIA_PATH),
  [LIST_TASK_SCHEDULES_PATH]:                wrapLegacyHandler(ctx, LIST_TASK_SCHEDULES_PATH),
  [CREATE_TASK_SCHEDULE_PATH]:               wrapLegacyHandler(ctx, CREATE_TASK_SCHEDULE_PATH),
  [LIST_TASK_INSTANCES_PATH]:                wrapLegacyHandler(ctx, LIST_TASK_INSTANCES_PATH),
  [CREATE_TASK_INSTANCE_PATH]:               wrapLegacyHandler(ctx, CREATE_TASK_INSTANCE_PATH),
  [LIST_SPACES_PATH]:                        wrapLegacyHandler(ctx, LIST_SPACES_PATH),
  [LIST_TAGS_PATH]:                          wrapLegacyHandler(ctx, LIST_TAGS_PATH),
  [LIST_BUSINESS_UNITS_PATH]:                wrapLegacyHandler(ctx, LIST_BUSINESS_UNITS_PATH),
});

// ── Full method name constants ────────────────────────────────────────

export const METHOD_LIST_ENTERPRISE_SUBJECTS_FULL           = 'CloudAtlas.CloudAtlas/ListEnterpriseSubjects';
export const METHOD_BATCH_CREATE_ENTERPRISE_SUBJECTS_FULL   = 'CloudAtlas.CloudAtlas/BatchCreateEnterpriseSubjects';
export const METHOD_BATCH_DELETE_ENTERPRISE_SUBJECTS_FULL   = 'CloudAtlas.CloudAtlas/BatchDeleteEnterpriseSubjects';
export const METHOD_LIST_KEYWORDS_FULL                      = 'CloudAtlas.CloudAtlas/ListKeywords';
export const METHOD_BATCH_CREATE_KEYWORDS_FULL              = 'CloudAtlas.CloudAtlas/BatchCreateKeywords';
export const METHOD_LIST_SEED_DOMAINS_FULL                  = 'CloudAtlas.CloudAtlas/ListSeedDomains';
export const METHOD_BATCH_CREATE_SEED_DOMAINS_FULL          = 'CloudAtlas.CloudAtlas/BatchCreateSeedDomains';
export const METHOD_LIST_SEED_CERTS_FULL                    = 'CloudAtlas.CloudAtlas/ListSeedCerts';
export const METHOD_LIST_SEED_ICONS_FULL                    = 'CloudAtlas.CloudAtlas/ListSeedIcons';
export const METHOD_LIST_SEED_WEB_TITLES_FULL               = 'CloudAtlas.CloudAtlas/ListSeedWebTitles';
export const METHOD_BATCH_UPDATE_SEEDS_FULL                 = 'CloudAtlas.CloudAtlas/BatchUpdateSeeds';
export const METHOD_LIST_ROOT_DOMAINS_FULL                  = 'CloudAtlas.CloudAtlas/ListRootDomains';
export const METHOD_BATCH_CREATE_ROOT_DOMAINS_FULL          = 'CloudAtlas.CloudAtlas/BatchCreateRootDomains';
export const METHOD_LIST_SUBDOMAINS_FULL                    = 'CloudAtlas.CloudAtlas/ListSubdomains';
export const METHOD_LIST_DNS_FULL                           = 'CloudAtlas.CloudAtlas/ListDNS';
export const METHOD_LIST_IPS_FULL                           = 'CloudAtlas.CloudAtlas/ListIPs';
export const METHOD_BATCH_CREATE_IPS_FULL                   = 'CloudAtlas.CloudAtlas/BatchCreateIPs';
export const METHOD_LIST_ASSET_CERTS_FULL                   = 'CloudAtlas.CloudAtlas/ListAssetCerts';
export const METHOD_BATCH_UPDATE_ASSET_STATUS_FULL          = 'CloudAtlas.CloudAtlas/BatchUpdateAssetStatus';
export const METHOD_BATCH_DELETE_ASSETS_FULL                = 'CloudAtlas.CloudAtlas/BatchDeleteAssets';
export const METHOD_LIST_PORTS_FULL                         = 'CloudAtlas.CloudAtlas/ListPorts';
export const METHOD_LIST_OPEN_PORTS_FULL                    = 'CloudAtlas.CloudAtlas/ListOpenPorts';
export const METHOD_LIST_WEB_ENTITIES_FULL                  = 'CloudAtlas.CloudAtlas/ListWebEntities';
export const METHOD_LIST_WEB_PATHS_FULL                     = 'CloudAtlas.CloudAtlas/ListWebPaths';
export const METHOD_LIST_WEB_FINGERPRINTS_FULL              = 'CloudAtlas.CloudAtlas/ListWebFingerprints';
export const METHOD_LIST_CRAWLER_DATA_FULL                  = 'CloudAtlas.CloudAtlas/ListCrawlerData';
export const METHOD_LIST_VULNERABILITIES_FULL               = 'CloudAtlas.CloudAtlas/ListVulnerabilities';
export const METHOD_BATCH_UPDATE_VULN_STATUS_FULL           = 'CloudAtlas.CloudAtlas/BatchUpdateVulnStatus';
export const METHOD_LIST_HIGH_RISK_APPS_FULL                = 'CloudAtlas.CloudAtlas/ListHighRiskApps';
export const METHOD_GET_HIGH_RISK_APP_FINGERS_FULL          = 'CloudAtlas.CloudAtlas/GetHighRiskAppFingers';
export const METHOD_LIST_HIGH_RISK_SERVICES_FULL            = 'CloudAtlas.CloudAtlas/ListHighRiskServices';
export const METHOD_LIST_VENDORS_FULL                       = 'CloudAtlas.CloudAtlas/ListVendors';
export const METHOD_LIST_PRODUCTS_FULL                      = 'CloudAtlas.CloudAtlas/ListProducts';
export const METHOD_LIST_VULN_SUBJECTS_FULL                 = 'CloudAtlas.CloudAtlas/ListVulnSubjects';
export const METHOD_LIST_KB_VULNS_FULL                      = 'CloudAtlas.CloudAtlas/ListKBVulns';
export const METHOD_LIST_MONITORING_RULES_FULL              = 'CloudAtlas.CloudAtlas/ListMonitoringRules';
export const METHOD_BATCH_CREATE_MONITORING_RULES_FULL      = 'CloudAtlas.CloudAtlas/BatchCreateMonitoringRules';
export const METHOD_LIST_GITHUB_LEAKS_FULL                  = 'CloudAtlas.CloudAtlas/ListGithubLeaks';
export const METHOD_LIST_DISK_LEAKS_FULL                    = 'CloudAtlas.CloudAtlas/ListDiskLeaks';
export const METHOD_LIST_DOC_LEAKS_FULL                     = 'CloudAtlas.CloudAtlas/ListDocLeaks';
export const METHOD_LIST_DARKNET_INTEL_FULL                 = 'CloudAtlas.CloudAtlas/ListDarknetIntel';
export const METHOD_LIST_STOLEN_DATA_FULL                   = 'CloudAtlas.CloudAtlas/ListStolenData';
export const METHOD_LIST_EMAIL_LEAKS_FULL                   = 'CloudAtlas.CloudAtlas/ListEmailLeaks';
export const METHOD_LIST_MOBILE_APPS_FULL                   = 'CloudAtlas.CloudAtlas/ListMobileApps';
export const METHOD_LIST_SOCIAL_MEDIA_FULL                  = 'CloudAtlas.CloudAtlas/ListSocialMedia';
export const METHOD_LIST_TASK_SCHEDULES_FULL                = 'CloudAtlas.CloudAtlas/ListTaskSchedules';
export const METHOD_CREATE_TASK_SCHEDULE_FULL               = 'CloudAtlas.CloudAtlas/CreateTaskSchedule';
export const METHOD_LIST_TASK_INSTANCES_FULL                = 'CloudAtlas.CloudAtlas/ListTaskInstances';
export const METHOD_CREATE_TASK_INSTANCE_FULL               = 'CloudAtlas.CloudAtlas/CreateTaskInstance';
export const METHOD_LIST_SPACES_FULL                        = 'CloudAtlas.CloudAtlas/ListSpaces';
export const METHOD_LIST_TAGS_FULL                          = 'CloudAtlas.CloudAtlas/ListTags';
export const METHOD_LIST_BUSINESS_UNITS_FULL                = 'CloudAtlas.CloudAtlas/ListBusinessUnits';

// ── handlers export ───────────────────────────────────────────────────

const sdkHandlers = registerHandlers({});

export const handlers = {
  [METHOD_LIST_ENTERPRISE_SUBJECTS_FULL]:           (ctx) => sdkHandlers[LIST_ENTERPRISE_SUBJECTS_PATH](ctx),
  [METHOD_BATCH_CREATE_ENTERPRISE_SUBJECTS_FULL]:   (ctx) => sdkHandlers[BATCH_CREATE_ENTERPRISE_SUBJECTS_PATH](ctx),
  [METHOD_BATCH_DELETE_ENTERPRISE_SUBJECTS_FULL]:   (ctx) => sdkHandlers[BATCH_DELETE_ENTERPRISE_SUBJECTS_PATH](ctx),
  [METHOD_LIST_KEYWORDS_FULL]:                      (ctx) => sdkHandlers[LIST_KEYWORDS_PATH](ctx),
  [METHOD_BATCH_CREATE_KEYWORDS_FULL]:              (ctx) => sdkHandlers[BATCH_CREATE_KEYWORDS_PATH](ctx),
  [METHOD_LIST_SEED_DOMAINS_FULL]:                  (ctx) => sdkHandlers[LIST_SEED_DOMAINS_PATH](ctx),
  [METHOD_BATCH_CREATE_SEED_DOMAINS_FULL]:          (ctx) => sdkHandlers[BATCH_CREATE_SEED_DOMAINS_PATH](ctx),
  [METHOD_LIST_SEED_CERTS_FULL]:                    (ctx) => sdkHandlers[LIST_SEED_CERTS_PATH](ctx),
  [METHOD_LIST_SEED_ICONS_FULL]:                    (ctx) => sdkHandlers[LIST_SEED_ICONS_PATH](ctx),
  [METHOD_LIST_SEED_WEB_TITLES_FULL]:               (ctx) => sdkHandlers[LIST_SEED_WEB_TITLES_PATH](ctx),
  [METHOD_BATCH_UPDATE_SEEDS_FULL]:                 (ctx) => sdkHandlers[BATCH_UPDATE_SEEDS_PATH](ctx),
  [METHOD_LIST_ROOT_DOMAINS_FULL]:                  (ctx) => sdkHandlers[LIST_ROOT_DOMAINS_PATH](ctx),
  [METHOD_BATCH_CREATE_ROOT_DOMAINS_FULL]:          (ctx) => sdkHandlers[BATCH_CREATE_ROOT_DOMAINS_PATH](ctx),
  [METHOD_LIST_SUBDOMAINS_FULL]:                    (ctx) => sdkHandlers[LIST_SUBDOMAINS_PATH](ctx),
  [METHOD_LIST_DNS_FULL]:                           (ctx) => sdkHandlers[LIST_DNS_PATH](ctx),
  [METHOD_LIST_IPS_FULL]:                           (ctx) => sdkHandlers[LIST_IPS_PATH](ctx),
  [METHOD_BATCH_CREATE_IPS_FULL]:                   (ctx) => sdkHandlers[BATCH_CREATE_IPS_PATH](ctx),
  [METHOD_LIST_ASSET_CERTS_FULL]:                   (ctx) => sdkHandlers[LIST_ASSET_CERTS_PATH](ctx),
  [METHOD_BATCH_UPDATE_ASSET_STATUS_FULL]:          (ctx) => sdkHandlers[BATCH_UPDATE_ASSET_STATUS_PATH](ctx),
  [METHOD_BATCH_DELETE_ASSETS_FULL]:                (ctx) => sdkHandlers[BATCH_DELETE_ASSETS_PATH](ctx),
  [METHOD_LIST_PORTS_FULL]:                         (ctx) => sdkHandlers[LIST_PORTS_PATH](ctx),
  [METHOD_LIST_OPEN_PORTS_FULL]:                    (ctx) => sdkHandlers[LIST_OPEN_PORTS_PATH](ctx),
  [METHOD_LIST_WEB_ENTITIES_FULL]:                  (ctx) => sdkHandlers[LIST_WEB_ENTITIES_PATH](ctx),
  [METHOD_LIST_WEB_PATHS_FULL]:                     (ctx) => sdkHandlers[LIST_WEB_PATHS_PATH](ctx),
  [METHOD_LIST_WEB_FINGERPRINTS_FULL]:              (ctx) => sdkHandlers[LIST_WEB_FINGERPRINTS_PATH](ctx),
  [METHOD_LIST_CRAWLER_DATA_FULL]:                  (ctx) => sdkHandlers[LIST_CRAWLER_DATA_PATH](ctx),
  [METHOD_LIST_VULNERABILITIES_FULL]:               (ctx) => sdkHandlers[LIST_VULNERABILITIES_PATH](ctx),
  [METHOD_BATCH_UPDATE_VULN_STATUS_FULL]:           (ctx) => sdkHandlers[BATCH_UPDATE_VULN_STATUS_PATH](ctx),
  [METHOD_LIST_HIGH_RISK_APPS_FULL]:                (ctx) => sdkHandlers[LIST_HIGH_RISK_APPS_PATH](ctx),
  [METHOD_GET_HIGH_RISK_APP_FINGERS_FULL]:          (ctx) => sdkHandlers[GET_HIGH_RISK_APP_FINGERS_PATH](ctx),
  [METHOD_LIST_HIGH_RISK_SERVICES_FULL]:            (ctx) => sdkHandlers[LIST_HIGH_RISK_SERVICES_PATH](ctx),
  [METHOD_LIST_VENDORS_FULL]:                       (ctx) => sdkHandlers[LIST_VENDORS_PATH](ctx),
  [METHOD_LIST_PRODUCTS_FULL]:                      (ctx) => sdkHandlers[LIST_PRODUCTS_PATH](ctx),
  [METHOD_LIST_VULN_SUBJECTS_FULL]:                 (ctx) => sdkHandlers[LIST_VULN_SUBJECTS_PATH](ctx),
  [METHOD_LIST_KB_VULNS_FULL]:                      (ctx) => sdkHandlers[LIST_KB_VULNS_PATH](ctx),
  [METHOD_LIST_MONITORING_RULES_FULL]:              (ctx) => sdkHandlers[LIST_MONITORING_RULES_PATH](ctx),
  [METHOD_BATCH_CREATE_MONITORING_RULES_FULL]:      (ctx) => sdkHandlers[BATCH_CREATE_MONITORING_RULES_PATH](ctx),
  [METHOD_LIST_GITHUB_LEAKS_FULL]:                  (ctx) => sdkHandlers[LIST_GITHUB_LEAKS_PATH](ctx),
  [METHOD_LIST_DISK_LEAKS_FULL]:                    (ctx) => sdkHandlers[LIST_DISK_LEAKS_PATH](ctx),
  [METHOD_LIST_DOC_LEAKS_FULL]:                     (ctx) => sdkHandlers[LIST_DOC_LEAKS_PATH](ctx),
  [METHOD_LIST_DARKNET_INTEL_FULL]:                 (ctx) => sdkHandlers[LIST_DARKNET_INTEL_PATH](ctx),
  [METHOD_LIST_STOLEN_DATA_FULL]:                   (ctx) => sdkHandlers[LIST_STOLEN_DATA_PATH](ctx),
  [METHOD_LIST_EMAIL_LEAKS_FULL]:                   (ctx) => sdkHandlers[LIST_EMAIL_LEAKS_PATH](ctx),
  [METHOD_LIST_MOBILE_APPS_FULL]:                   (ctx) => sdkHandlers[LIST_MOBILE_APPS_PATH](ctx),
  [METHOD_LIST_SOCIAL_MEDIA_FULL]:                  (ctx) => sdkHandlers[LIST_SOCIAL_MEDIA_PATH](ctx),
  [METHOD_LIST_TASK_SCHEDULES_FULL]:                (ctx) => sdkHandlers[LIST_TASK_SCHEDULES_PATH](ctx),
  [METHOD_CREATE_TASK_SCHEDULE_FULL]:               (ctx) => sdkHandlers[CREATE_TASK_SCHEDULE_PATH](ctx),
  [METHOD_LIST_TASK_INSTANCES_FULL]:                (ctx) => sdkHandlers[LIST_TASK_INSTANCES_PATH](ctx),
  [METHOD_CREATE_TASK_INSTANCE_FULL]:               (ctx) => sdkHandlers[CREATE_TASK_INSTANCE_PATH](ctx),
  [METHOD_LIST_SPACES_FULL]:                        (ctx) => sdkHandlers[LIST_SPACES_PATH](ctx),
  [METHOD_LIST_TAGS_FULL]:                          (ctx) => sdkHandlers[LIST_TAGS_PATH](ctx),
  [METHOD_LIST_BUSINESS_UNITS_FULL]:                (ctx) => sdkHandlers[LIST_BUSINESS_UNITS_PATH](ctx),
};

// ── Test helpers ──────────────────────────────────────────────────────

export const _test = {
  buildQuery,
  createTlsDispatcher,
  errorWithCode,
  fetchWithTimeout,
  grpcCodeFor,
  mergedBindings,
  normalizeBaseUrl,
  normalizeListResponse,
  getTotal,
  parseHeaders,
  registerHandlers,
  resolveCallContext,
  toBooleanOrNull,
  toBooleanStrict,
  toQueryNumber,
  unwrapString,
  unwrapList,
};
