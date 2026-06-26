// Huoxian_IAST_DONGTAI DongTai IAST REST API proxy
// Bindings: endpoint/baseUrl (required), headers (optional), timeoutMs (optional)
// Auth: Token-based (Authorization: Token <token>)

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;

// gRPC method paths
const LIST_VULNS_PATH = '/Huoxian_IAST_DONGTAI.Huoxian_IAST_DONGTAI/ListVulnerabilities';
const GET_VULN_PATH = '/Huoxian_IAST_DONGTAI.Huoxian_IAST_DONGTAI/GetVulnerability';
const UPDATE_VULN_STATUS_PATH = '/Huoxian_IAST_DONGTAI.Huoxian_IAST_DONGTAI/UpdateVulnStatus';
const GET_VULN_SUMMARY_PATH = '/Huoxian_IAST_DONGTAI.Huoxian_IAST_DONGTAI/GetVulnSummary';
const LIST_PROJECTS_PATH = '/Huoxian_IAST_DONGTAI.Huoxian_IAST_DONGTAI/ListProjects';
const GET_PROJECT_PATH = '/Huoxian_IAST_DONGTAI.Huoxian_IAST_DONGTAI/GetProject';
const CREATE_PROJECT_PATH = '/Huoxian_IAST_DONGTAI.Huoxian_IAST_DONGTAI/CreateProject';
const DELETE_PROJECT_PATH = '/Huoxian_IAST_DONGTAI.Huoxian_IAST_DONGTAI/DeleteProject';
const LIST_AGENTS_PATH = '/Huoxian_IAST_DONGTAI.Huoxian_IAST_DONGTAI/ListAgents';
const GET_SYSTEM_INFO_PATH = '/Huoxian_IAST_DONGTAI.Huoxian_IAST_DONGTAI/GetSystemInfo';
const LIST_STRATEGIES_PATH = '/Huoxian_IAST_DONGTAI.Huoxian_IAST_DONGTAI/ListStrategies';
const GET_SCA_DETAIL_PATH = '/Huoxian_IAST_DONGTAI.Huoxian_IAST_DONGTAI/GetScaDetail';

// ============ Helpers ============

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

const toValue = (val) => {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'number') return { numberValue: val };
  if (typeof val === 'boolean') return { boolValue: val };
  if (Array.isArray(val)) {
    const values = val.map((item) => toValue(item)).filter((item) => item !== undefined);
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

const toStruct = (obj) => {
  if (obj === undefined || obj === null) return { fields: {} };
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    const normalized = toValue(v);
    fields[k] = normalized === undefined ? { nullValue: 'NULL_VALUE' } : normalized;
  }
  return { fields };
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const firstDefined = (...vals) => vals.find((v) => v !== undefined && v !== null);

const toPositiveInt = (val) => {
  if (val === undefined || val === null) return null;
  if (typeof val === 'object' && 'value' in val) return toPositiveInt(val.value);
  const n = Number(val);
  if (!Number.isInteger(n) || Number.isNaN(n)) return null;
  return n;
};

// Protobuf3 string fields default to "" — treat empty strings as absent
// so the handler falls through to secret bindings or defaults.
const unwrapString = (source) => {
  if (source === undefined || source === null) return '';
  if (typeof source === 'object' && source !== null && 'value' in source) {
    return String(source.value ?? '');
  }
  return String(source);
};

const unwrapNonEmpty = (source) => {
  const v = unwrapString(source);
  return v.trim() ? v : undefined;
};

const pickStringField = (req, keys) => {
  for (const key of keys) {
    if (hasOwn(req, key)) return unwrapNonEmpty(req[key]);
  }
  return undefined;
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
    } catch { return {}; }
  }
  return {};
};

const normalizeBaseUrl = (url) => {
  const base = String(url || '').trim();
  if (!/^https?:\/\//i.test(base)) return null;
  return base.replace(/\/$/, '');
};

// ============ Core HTTP Client ============

export function rpcdef(ctx) {
  const bindings = mergedBindings(ctx);
  const baseUrl = normalizeBaseUrl(
    bindings.endpoint || bindings.baseUrl || bindings.base_url || bindings.restBaseUrl || ''
  );
  const timeoutMs = ctx.limits?.timeoutMs || Number(bindings.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const baseHeaders = parseHeaders(bindings.headers);
  const meta = ctx.meta || {};
  const skipTlsVerify = Boolean(
    bindings.tlsInsecureSkipVerify || bindings.skipTlsVerify || bindings.skip_tls_verify
  );

  const requestWithDefaults = (req = {}) => {
    // Protobuf3 string fields default to "" rather than undefined,
    // so we treat empty strings as absent and fall through to secret bindings.
    const reqToken = [req?.token, req?.api_token, req?.apiToken].find((v) => v && String(v).trim()) || undefined;
    const bindingToken = [bindings.api_token, bindings.apiToken].find((v) => v && String(v).trim()) || undefined;
    const token = reqToken || bindingToken;
    if (token === undefined || token === null) return req ?? {};
    // Spread req first so token override takes precedence over protobuf3 empty-string defaults
    return { ...(req ?? {}), token };
  };

  const logFlow = (action, details) => {
    const inst = meta.instance_id || meta.instanceId;
    const reqId = meta.request_id || meta.requestId;
    const trace = [];
    if (inst) trace.push(`inst=${inst}`);
    if (reqId) trace.push(`req=${reqId}`);
    const prefix = `[Huoxian_IAST_DONGTAI][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
    try { console.log(prefix, JSON.stringify(details)); } catch { console.log(prefix, details); }
  };

  const buildHeaders = (apiToken) => ({
    ...baseHeaders,
    'Authorization': `Token ${apiToken}`,
    'Content-Type': 'application/json',
    'x-engine-instance': meta.instance_id || meta.instanceId || 'unknown',
    'x-request-id': meta.request_id || meta.requestId || 'unknown',
  });

  const tlsOptions = () => (skipTlsVerify
    ? { insecureSkipVerify: true, tlsInsecureSkipVerify: true }
    : {});

  const fetchDongtai = async (url, init) => {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      return await fetch(url, { ...init, signal, ...tlsOptions() });
    } catch (e) {
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        throw errorWithCode('DEADLINE_EXCEEDED', `request timed out after ${timeoutMs}ms`);
      }
      const reason = e?.cause?.message || e?.message || 'fetch failed';
      throw errorWithCode('UNAVAILABLE', reason);
    }
  };

  const throwForHttpError = (status, text) => {
    // Log upstream response body server-side only (may contain sensitive data)
    try { console.error(`[Huoxian_IAST_DONGTAI] upstream http ${status}: ${String(text).slice(0, 500)}`); } catch { /* ignore */ }
    if (status === 401) throw errorWithCode('UNAUTHENTICATED', `upstream returned ${status}`);
    if (status === 403) throw errorWithCode('PERMISSION_DENIED', `upstream returned ${status}`);
    if (status >= 400 && status < 500) throw errorWithCode('FAILED_PRECONDITION', `upstream returned ${status}`);
    throw errorWithCode('UNAVAILABLE', `upstream returned ${status}`);
  };

  const readJsonResponse = async (res, emptyValue) => {
    const text = await res.text();
    if (!res.ok) throwForHttpError(res.status, text);
    if (!text.trim()) return emptyValue;
    try { return JSON.parse(text); } catch {
      throw errorWithCode('UNKNOWN', 'response is not valid JSON');
    }
  };

  const requireToken = (req) => {
    // Treat empty strings (protobuf3 defaults) as absent
    const token = [req?.token, req?.api_token, req?.apiToken]
      .find((v) => v !== undefined && v !== null && String(v).trim()) || '';
    if (!token.trim()) throw errorWithCode('INVALID_ARGUMENT', 'token is required');
    return String(token).trim();
  };

  const requireBaseUrl = () => {
    if (!baseUrl) throw errorWithCode('INVALID_ARGUMENT', 'endpoint/baseUrl is required (http/https)');
    return baseUrl;
  };

  // ============ API Methods ============

  const callListVulnerabilities = async (req) => {
    const token = requireToken(req);
    const base = requireBaseUrl();

    const params = [];
    const projectId = toPositiveInt(firstDefined(req?.project_id, req?.projectId));
    if (projectId !== null) params.push(`project_id=${projectId}`);
    const levelId = toPositiveInt(firstDefined(req?.level_id, req?.levelId));
    if (levelId !== null) params.push(`level_id=${levelId}`);
    const vulType = pickStringField(req, ['vul_type', 'vulType']);
    if (vulType) params.push(`vul_type=${encodeURIComponent(vulType)}`);
    const state = pickStringField(req, ['state']);
    if (state) params.push(`state=${encodeURIComponent(state)}`);
    const page = toPositiveInt(firstDefined(req?.page)) || DEFAULT_PAGE;
    params.push(`page=${page}`);
    const pageSize = toPositiveInt(firstDefined(req?.page_size, req?.pageSize)) || DEFAULT_PAGE_SIZE;
    params.push(`page_size=${pageSize}`);

    const url = `${base}/api/v1/vulns${params.length ? `?${params.join('&')}` : ''}`;
    const headers = buildHeaders(token);

    logFlow('ListVulnerabilities', { url: '/api/v1/vulns', project_id: projectId, level_id: levelId });
    const res = await fetchDongtai(url, { method: 'GET', headers });
    const json = await readJsonResponse(res, { status: 201, data: [], page: {} });

    const vulns = Array.isArray(json?.data) ? json.data.map(mapVulnRecord) : [];
    return {
      vulns,
      total: Number(json?.page?.alltotal ?? 0),
      num_pages: Number(json?.page?.num_pages ?? 1),
      page_size: Number(json?.page?.page_size ?? pageSize),
    };
  };

  const callGetVulnerability = async (req) => {
    const token = requireToken(req);
    const base = requireBaseUrl();
    const rawId = firstDefined(req?.id, req?.Id);
    if (rawId === undefined || rawId === null) throw errorWithCode('INVALID_ARGUMENT', 'id is required');
    const id = Number(rawId);
    if (!Number.isInteger(id) || Number.isNaN(id)) throw errorWithCode('INVALID_ARGUMENT', 'id must be an integer');

    const url = `${base}/api/v1/vuln/${id}`;
    const headers = buildHeaders(token);

    logFlow('GetVulnerability', { id });
    const res = await fetchDongtai(url, { method: 'GET', headers });
    const json = await readJsonResponse(res, {});

    const vuln = mapVulnRecord(json?.data ?? json);
    return { vuln, raw: toStruct(json) };
  };

  const callUpdateVulnStatus = async (req) => {
    const token = requireToken(req);
    const base = requireBaseUrl();
    const rawId = firstDefined(req?.id, req?.Id);
    if (rawId === undefined || rawId === null) throw errorWithCode('INVALID_ARGUMENT', 'id is required');
    const id = Number(rawId);
    if (!Number.isInteger(id) || Number.isNaN(id)) throw errorWithCode('INVALID_ARGUMENT', 'id must be an integer');

    const status = String(firstDefined(req?.status) || '').trim();
    if (!status) throw errorWithCode('INVALID_ARGUMENT', 'status is required');
    const validStatuses = ['confirmed', 'ignored', 'recheck', 'fake'];
    if (!validStatuses.includes(status)) {
      throw errorWithCode('INVALID_ARGUMENT', `status must be one of: ${validStatuses.join(', ')}`);
    }

    const url = `${base}/api/v1/vuln/status`;
    const headers = buildHeaders(token);
    const payload = { id, status };

    logFlow('UpdateVulnStatus', { id, status });
    const res = await fetchDongtai(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const json = await readJsonResponse(res, {});
    return { raw: toStruct(json) };
  };

  const callGetVulnSummary = async (req) => {
    const token = requireToken(req);
    const base = requireBaseUrl();

    const params = [];
    const projectId = toPositiveInt(firstDefined(req?.project_id, req?.projectId));
    if (projectId !== null) params.push(`project_id=${projectId}`);

    const url = `${base}/api/v1/vuln/summary_type${params.length ? `?${params.join('&')}` : ''}`;
    const headers = buildHeaders(token);

    logFlow('GetVulnSummary', {});
    const res = await fetchDongtai(url, { method: 'GET', headers });
    const json = await readJsonResponse(res, {});

    const levels = Array.isArray(json?.data?.level)
      ? json.data.level.map((item) => ({
          level: String(item?.level ?? ''),
          level_id: Number(item?.level_id ?? 0),
          count: Number(item?.count ?? 0),
        }))
      : [];

    const types = Array.isArray(json?.data?.type)
      ? json.data.type.map((item) => ({
          vul_type: String(item?.vul_type ?? ''),
          count: Number(item?.count ?? 0),
        }))
      : [];

    return { levels, types };
  };

  const callListProjects = async (req) => {
    const token = requireToken(req);
    const base = requireBaseUrl();

    const params = [];
    const name = pickStringField(req, ['name', 'Name']);
    if (name) params.push(`name=${encodeURIComponent(name)}`);
    const page = toPositiveInt(firstDefined(req?.page)) || DEFAULT_PAGE;
    params.push(`page=${page}`);
    const pageSize = toPositiveInt(firstDefined(req?.page_size, req?.pageSize)) || DEFAULT_PAGE_SIZE;
    params.push(`page_size=${pageSize}`);

    const url = `${base}/api/v1/projects${params.length ? `?${params.join('&')}` : ''}`;
    const headers = buildHeaders(token);

    logFlow('ListProjects', {});
    const res = await fetchDongtai(url, { method: 'GET', headers });
    const json = await readJsonResponse(res, { status: 201, data: [], page: {} });

    const projects = Array.isArray(json?.data) ? json.data.map(mapProjectRecord) : [];
    return {
      projects,
      total: Number(json?.page?.alltotal ?? 0),
      num_pages: Number(json?.page?.num_pages ?? 1),
      page_size: Number(json?.page?.page_size ?? pageSize),
    };
  };

  const callGetProject = async (req) => {
    const token = requireToken(req);
    const base = requireBaseUrl();
    const rawId = firstDefined(req?.id, req?.Id);
    if (rawId === undefined || rawId === null) throw errorWithCode('INVALID_ARGUMENT', 'id is required');
    const id = Number(rawId);
    if (!Number.isInteger(id) || Number.isNaN(id)) throw errorWithCode('INVALID_ARGUMENT', 'id must be an integer');

    const url = `${base}/api/v1/project/${id}`;
    const headers = buildHeaders(token);

    logFlow('GetProject', { id });
    const res = await fetchDongtai(url, { method: 'GET', headers });
    const json = await readJsonResponse(res, {});

    const project = mapProjectRecord(json?.data ?? json);
    return { project, raw: toStruct(json) };
  };

  const callCreateProject = async (req) => {
    const token = requireToken(req);
    const base = requireBaseUrl();
    const name = String(firstDefined(req?.name, req?.Name) || '').trim();
    if (!name) throw errorWithCode('INVALID_ARGUMENT', 'name is required');

    const payload = { name };
    const mode = pickStringField(req, ['mode', 'Mode']);
    if (mode) payload.mode = mode;
    const versionName = pickStringField(req, ['version_name', 'versionName']);
    if (versionName) payload.version_name = versionName;
    const description = pickStringField(req, ['description', 'Description']);
    if (description) payload.description = description;

    const url = `${base}/api/v1/project/add`;
    const headers = buildHeaders(token);

    logFlow('CreateProject', { name });
    const res = await fetchDongtai(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const json = await readJsonResponse(res, {});

    return {
      id: Number(json?.data?.id ?? json?.id ?? 0),
      name: String(json?.data?.name ?? name),
    };
  };

  const callDeleteProject = async (req) => {
    const token = requireToken(req);
    const base = requireBaseUrl();
    const rawId = firstDefined(req?.id, req?.Id);
    if (rawId === undefined || rawId === null) throw errorWithCode('INVALID_ARGUMENT', 'id is required');
    const id = Number(rawId);
    if (!Number.isInteger(id) || Number.isNaN(id)) throw errorWithCode('INVALID_ARGUMENT', 'id must be an integer');

    const url = `${base}/api/v1/project/delete`;
    const headers = buildHeaders(token);
    const payload = { id };

    logFlow('DeleteProject', { id });
    const res = await fetchDongtai(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const json = await readJsonResponse(res, {});
    return { raw: toStruct(json) };
  };

  const callListAgents = async (req) => {
    const token = requireToken(req);
    const base = requireBaseUrl();

    const params = [];
    const projectId = toPositiveInt(firstDefined(req?.project_id, req?.projectId));
    if (projectId !== null) params.push(`project_id=${projectId}`);
    const state = pickStringField(req, ['state', 'State']);
    if (state) params.push(`state=${encodeURIComponent(state)}`);
    const page = toPositiveInt(firstDefined(req?.page)) || DEFAULT_PAGE;
    params.push(`page=${page}`);
    const pageSize = toPositiveInt(firstDefined(req?.page_size, req?.pageSize)) || DEFAULT_PAGE_SIZE;
    params.push(`page_size=${pageSize}`);

    const url = `${base}/api/v1/agents${params.length ? `?${params.join('&')}` : ''}`;
    const headers = buildHeaders(token);

    logFlow('ListAgents', {});
    const res = await fetchDongtai(url, { method: 'GET', headers });
    const json = await readJsonResponse(res, { status: 201, data: [], page: {} });

    const agents = Array.isArray(json?.data) ? json.data.map(mapAgentRecord) : [];
    return {
      agents,
      total: Number(json?.page?.alltotal ?? 0),
      num_pages: Number(json?.page?.num_pages ?? 1),
      page_size: Number(json?.page?.page_size ?? pageSize),
    };
  };

  const callGetSystemInfo = async (req) => {
    const token = requireToken(req);
    const base = requireBaseUrl();

    const url = `${base}/api/v1/system/info`;
    const headers = buildHeaders(token);

    logFlow('GetSystemInfo', {});
    const res = await fetchDongtai(url, { method: 'GET', headers });
    const json = await readJsonResponse(res, {});
    return { raw: toStruct(json) };
  };

  const callListStrategies = async (req) => {
    const token = requireToken(req);
    const base = requireBaseUrl();

    const url = `${base}/api/v1/strategys`;
    const headers = buildHeaders(token);

    logFlow('ListStrategies', {});
    const res = await fetchDongtai(url, { method: 'GET', headers });
    const json = await readJsonResponse(res, {});

    let strategies = Array.isArray(json?.data) ? json.data : [];
    const vulType = pickStringField(req, ['vul_type', 'vulType']);
    const levelId = toPositiveInt(firstDefined(req?.level_id, req?.levelId));
    const state = pickStringField(req, ['state', 'State']);

    if (vulType) strategies = strategies.filter((s) => s?.vul_type === vulType);
    if (levelId !== null) strategies = strategies.filter((s) => Number(s?.level_id) === levelId);
    if (state) strategies = strategies.filter((s) => s?.state === state);

    return {
      strategies: strategies.map(mapStrategyRecord),
    };
  };

  const callGetScaDetail = async (req) => {
    const token = requireToken(req);
    const base = requireBaseUrl();
    const rawId = firstDefined(req?.id, req?.Id);
    if (rawId === undefined || rawId === null) throw errorWithCode('INVALID_ARGUMENT', 'id is required');
    const id = Number(rawId);
    if (!Number.isInteger(id) || Number.isNaN(id)) throw errorWithCode('INVALID_ARGUMENT', 'id must be an integer');

    const url = `${base}/api/v1/sca/${id}`;
    const headers = buildHeaders(token);

    logFlow('GetScaDetail', { id });
    const res = await fetchDongtai(url, { method: 'GET', headers });
    const json = await readJsonResponse(res, {});
    return { raw: toStruct(json) };
  };

  // ============ Record Mappers ============

  const mapVulnRecord = (item) => ({
    id: Number(item?.id ?? 0),
    vul_name: String(item?.vul_name ?? ''),
    vul_type: String(item?.vul_type ?? ''),
    level_id: Number(item?.level_id ?? 0),
    level_name: String(item?.level_name ?? ''),
    state: String(item?.state ?? ''),
    url: String(item?.url ?? ''),
    req_header: String(item?.req_header ?? ''),
    req_data: String(item?.req_data ?? ''),
    res_header: String(item?.res_header ?? ''),
    res_data: String(item?.res_data ?? ''),
    full_stack: String(item?.full_stack ?? ''),
    top_stack: String(item?.top_stack ?? ''),
    bottom_stack: String(item?.bottom_stack ?? ''),
    project_id: Number(item?.project_id ?? 0),
    project_name: String(item?.project_name ?? ''),
    agent_id: Number(item?.agent_id ?? 0),
    language: String(item?.language ?? ''),
    first_time: String(item?.first_time ?? ''),
    latest_time: String(item?.latest_time ?? ''),
    count: Number(item?.count ?? 0),
  });

  const mapProjectRecord = (item) => ({
    id: Number(item?.id ?? 0),
    name: String(item?.name ?? ''),
    mode: String(item?.mode ?? ''),
    agent_count: Number(item?.agent_count ?? 0),
    owner: String(item?.owner ?? ''),
    latest_time: String(item?.latest_time ?? ''),
    agent_language: Array.isArray(item?.agent_language) ? item.agent_language : [],
    vul_count: Number(item?.vul_count ?? 0),
    status: Number(item?.status ?? 0),
    version_name: String(item?.versionData?.version_name ?? item?.version_name ?? ''),
  });

  const mapAgentRecord = (item) => ({
    id: Number(item?.id ?? 0),
    token_value: String(item?.token ?? item?.token_value ?? ''),
    alias: String(item?.alias ?? ''),
    language: String(item?.language ?? ''),
    state: String(item?.state ?? ''),
    project_id: Number(item?.project_id ?? item?.bind_project_id ?? 0),
    project_name: String(item?.project_name ?? ''),
    server: String(item?.server ?? item?.server_ip ?? ''),
    runtime: String(item?.runtime ?? ''),
    latest_time: String(item?.latest_time ?? ''),
  });

  const mapStrategyRecord = (item) => ({
    id: Number(item?.id ?? 0),
    vul_type: String(item?.vul_type ?? ''),
    vul_name: String(item?.vul_name ?? ''),
    vul_desc: String(item?.vul_desc ?? ''),
    level_id: Number(item?.level_id ?? 0),
    state: String(item?.state ?? ''),
  });

  // ============ Return RPC Definitions ============

  return {
    [LIST_VULNS_PATH]: async () => callListVulnerabilities(requestWithDefaults(ctx.req)),
    [GET_VULN_PATH]: async () => callGetVulnerability(requestWithDefaults(ctx.req)),
    [UPDATE_VULN_STATUS_PATH]: async () => callUpdateVulnStatus(requestWithDefaults(ctx.req)),
    [GET_VULN_SUMMARY_PATH]: async () => callGetVulnSummary(requestWithDefaults(ctx.req)),
    [LIST_PROJECTS_PATH]: async () => callListProjects(requestWithDefaults(ctx.req)),
    [GET_PROJECT_PATH]: async () => callGetProject(requestWithDefaults(ctx.req)),
    [CREATE_PROJECT_PATH]: async () => callCreateProject(requestWithDefaults(ctx.req)),
    [DELETE_PROJECT_PATH]: async () => callDeleteProject(requestWithDefaults(ctx.req)),
    [LIST_AGENTS_PATH]: async () => callListAgents(requestWithDefaults(ctx.req)),
    [GET_SYSTEM_INFO_PATH]: async () => callGetSystemInfo(requestWithDefaults(ctx.req)),
    [LIST_STRATEGIES_PATH]: async () => callListStrategies(requestWithDefaults(ctx.req)),
    [GET_SCA_DETAIL_PATH]: async () => callGetScaDetail(requestWithDefaults(ctx.req)),
  };
}

// ============ SDK Handler Registration ============

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
  [LIST_VULNS_PATH]: wrapLegacyHandler(ctx, LIST_VULNS_PATH),
  [GET_VULN_PATH]: wrapLegacyHandler(ctx, GET_VULN_PATH),
  [UPDATE_VULN_STATUS_PATH]: wrapLegacyHandler(ctx, UPDATE_VULN_STATUS_PATH),
  [GET_VULN_SUMMARY_PATH]: wrapLegacyHandler(ctx, GET_VULN_SUMMARY_PATH),
  [LIST_PROJECTS_PATH]: wrapLegacyHandler(ctx, LIST_PROJECTS_PATH),
  [GET_PROJECT_PATH]: wrapLegacyHandler(ctx, GET_PROJECT_PATH),
  [CREATE_PROJECT_PATH]: wrapLegacyHandler(ctx, CREATE_PROJECT_PATH),
  [DELETE_PROJECT_PATH]: wrapLegacyHandler(ctx, DELETE_PROJECT_PATH),
  [LIST_AGENTS_PATH]: wrapLegacyHandler(ctx, LIST_AGENTS_PATH),
  [GET_SYSTEM_INFO_PATH]: wrapLegacyHandler(ctx, GET_SYSTEM_INFO_PATH),
  [LIST_STRATEGIES_PATH]: wrapLegacyHandler(ctx, LIST_STRATEGIES_PATH),
  [GET_SCA_DETAIL_PATH]: wrapLegacyHandler(ctx, GET_SCA_DETAIL_PATH),
});

const sdkHandlers = registerHandlers({});

export const METHOD_LIST_VULNS_FULL = 'Huoxian_IAST_DONGTAI.Huoxian_IAST_DONGTAI/ListVulnerabilities';
export const METHOD_GET_VULN_FULL = 'Huoxian_IAST_DONGTAI.Huoxian_IAST_DONGTAI/GetVulnerability';
export const METHOD_UPDATE_VULN_STATUS_FULL = 'Huoxian_IAST_DONGTAI.Huoxian_IAST_DONGTAI/UpdateVulnStatus';
export const METHOD_GET_VULN_SUMMARY_FULL = 'Huoxian_IAST_DONGTAI.Huoxian_IAST_DONGTAI/GetVulnSummary';
export const METHOD_LIST_PROJECTS_FULL = 'Huoxian_IAST_DONGTAI.Huoxian_IAST_DONGTAI/ListProjects';
export const METHOD_GET_PROJECT_FULL = 'Huoxian_IAST_DONGTAI.Huoxian_IAST_DONGTAI/GetProject';
export const METHOD_CREATE_PROJECT_FULL = 'Huoxian_IAST_DONGTAI.Huoxian_IAST_DONGTAI/CreateProject';
export const METHOD_DELETE_PROJECT_FULL = 'Huoxian_IAST_DONGTAI.Huoxian_IAST_DONGTAI/DeleteProject';
export const METHOD_LIST_AGENTS_FULL = 'Huoxian_IAST_DONGTAI.Huoxian_IAST_DONGTAI/ListAgents';
export const METHOD_GET_SYSTEM_INFO_FULL = 'Huoxian_IAST_DONGTAI.Huoxian_IAST_DONGTAI/GetSystemInfo';
export const METHOD_LIST_STRATEGIES_FULL = 'Huoxian_IAST_DONGTAI.Huoxian_IAST_DONGTAI/ListStrategies';
export const METHOD_GET_SCA_DETAIL_FULL = 'Huoxian_IAST_DONGTAI.Huoxian_IAST_DONGTAI/GetScaDetail';

export const handlers = {
  [METHOD_LIST_VULNS_FULL]: (ctx) => sdkHandlers[LIST_VULNS_PATH](ctx),
  [METHOD_GET_VULN_FULL]: (ctx) => sdkHandlers[GET_VULN_PATH](ctx),
  [METHOD_UPDATE_VULN_STATUS_FULL]: (ctx) => sdkHandlers[UPDATE_VULN_STATUS_PATH](ctx),
  [METHOD_GET_VULN_SUMMARY_FULL]: (ctx) => sdkHandlers[GET_VULN_SUMMARY_PATH](ctx),
  [METHOD_LIST_PROJECTS_FULL]: (ctx) => sdkHandlers[LIST_PROJECTS_PATH](ctx),
  [METHOD_GET_PROJECT_FULL]: (ctx) => sdkHandlers[GET_PROJECT_PATH](ctx),
  [METHOD_CREATE_PROJECT_FULL]: (ctx) => sdkHandlers[CREATE_PROJECT_PATH](ctx),
  [METHOD_DELETE_PROJECT_FULL]: (ctx) => sdkHandlers[DELETE_PROJECT_PATH](ctx),
  [METHOD_LIST_AGENTS_FULL]: (ctx) => sdkHandlers[LIST_AGENTS_PATH](ctx),
  [METHOD_GET_SYSTEM_INFO_FULL]: (ctx) => sdkHandlers[GET_SYSTEM_INFO_PATH](ctx),
  [METHOD_LIST_STRATEGIES_FULL]: (ctx) => sdkHandlers[LIST_STRATEGIES_PATH](ctx),
  [METHOD_GET_SCA_DETAIL_FULL]: (ctx) => sdkHandlers[GET_SCA_DETAIL_PATH](ctx),
};

export const _test = {
  errorWithCode,
  firstDefined,
  mergedBindings,
  normalizeBaseUrl,
  parseHeaders,
  toPositiveInt,
  toStruct,
  toValue,
  unwrapString,
};
