// TheHive_CORTEX Cortex REST proxy implementation
// Bindings: endpoint/restBaseUrl/baseUrl (required), headers (optional), timeoutMs (optional)
// Auth: apiKey (preferred Bearer), username+password (Basic fallback)

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const DEFAULT_TIMEOUT_MS = 5000;

const METHOD_LIST_ANALYZERS = '/TheHive_CORTEX.TheHive_CORTEX/ListAnalyzers';
const METHOD_ANALYZE_OBSERVABLE = '/TheHive_CORTEX.TheHive_CORTEX/AnalyzeObservable';
const METHOD_GET_JOB_REPORT = '/TheHive_CORTEX.TheHive_CORTEX/GetJobReport';
const METHOD_LIST_JOBS = '/TheHive_CORTEX.TheHive_CORTEX/ListJobs';
const METHOD_GET_JOB_STATUS = '/TheHive_CORTEX.TheHive_CORTEX/GetJobStatus';

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

const firstDefined = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== '');

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

const toPositiveInt = (val) => {
  if (val === undefined || val === null) return null;
  if (typeof val === 'object') {
    if ('value' in val) return toPositiveInt(val.value);
    return null;
  }
  const n = Number(val);
  if (!Number.isInteger(n) || Number.isNaN(n)) return null;
  return n;
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

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const unwrapString = (source) => {
  if (source === undefined || source === null) return '';
  if (typeof source === 'object' && source !== null && 'value' in source) {
    return String(source.value ?? '');
  }
  return String(source);
};

const pickStringField = (req, keys) => {
  for (const key of keys) {
    if (hasOwn(req, key)) {
      return unwrapString(req[key]);
    }
  }
  return undefined;
};

export function rpcdef(ctx) {
  const bindings = mergedBindings(ctx);
  const restBaseUrl = bindings.restBaseUrl || bindings.rest_base_url || bindings.baseUrl || bindings.base_url || bindings.endpoint || '';
  const timeoutMs = ctx.limits?.timeoutMs || DEFAULT_TIMEOUT_MS;
  const baseHeaders = parseHeaders(bindings.headers);
  const meta = ctx.meta || {};
  const skipTlsVerify = Boolean(bindings.tlsInsecureSkipVerify || bindings.skipTlsVerify || bindings.skip_tls_verify || bindings.tls_insecure_skip_verify);

  const requestWithDefaults = (req = {}) => {
    const apiKey = firstDefined(req?.api_key, req?.apiKey, bindings.api_key, bindings.apiKey);
    const username = firstDefined(req?.username, bindings.username);
    const password = firstDefined(req?.password, bindings.password);
    return {
      ...(req ?? {}),
      ...(apiKey !== undefined ? { api_key: apiKey } : {}),
      ...(username !== undefined ? { username } : {}),
      ...(password !== undefined ? { password } : {}),
    };
  };

  const logFlow = (action, details) => {
    const inst = meta.instance_id || meta.instanceId;
    const reqId = meta.request_id || meta.requestId;
    const trace = [];
    if (inst) trace.push(`inst=${inst}`);
    if (reqId) trace.push(`req=${reqId}`);
    const prefix = `[TheHive_CORTEX][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
    try {
      console.log(prefix, JSON.stringify(details));
    } catch {
      console.log(prefix, details);
    }
  };

  const buildHeaders = (authInfo, withContentType = true) => {
    const headers = {
      ...baseHeaders,
      'Accept': 'application/json',
      'x-engine-instance': meta.instance_id || meta.instanceId || 'unknown',
      'x-request-id': meta.request_id || meta.requestId || 'unknown',
    };

    if (withContentType) {
      headers['Content-Type'] = 'application/json';
    }

    // Auth priority: apiKey (Bearer) > Basic Auth
    const apiKey = firstDefined(authInfo?.api_key, authInfo?.apiKey);
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else {
      const username = firstDefined(authInfo?.username);
      const password = firstDefined(authInfo?.password);
      if (username && password) {
        headers['Authorization'] = `Basic ${btoa(`${username}:${password}`)}`;
      }
    }
    return headers;
  };

  const tlsOptions = () => (skipTlsVerify
    ? {
        insecureSkipVerify: true,
        tlsInsecureSkipVerify: true,
      }
    : {});

  const fetchCortex = async (url, init) => {
    try {
      return await fetch(url, {
        ...init,
        timeoutMs,
        ...tlsOptions(),
      });
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
    if (contentType.includes('application/json')) {
      return JSON.parse(text);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw errorWithCode('UNKNOWN', 'response is not valid JSON');
    }
  };

  const mapAnalyzerData = (item) => ({
    id: String(item?.id ?? item?._id ?? ''),
    name: String(item?.name ?? ''),
    analyzer_definition_id: String(item?.analyzerDefinitionId ?? item?.analyzer_definition_id ?? item?.workerDefinitionId ?? ''),
    description: String(item?.description ?? ''),
    data_type_list: Array.isArray(item?.dataTypeList ?? item?.data_type_list) ? item.dataTypeList ?? item.data_type_list : [],
    version: String(item?.version ?? ''),
    tlp: Number(item?.tlp ?? 2),
    state: String(item?.state ?? ''),
    raw: item ?? {},
  });

  const mapJobData = (item) => ({
    id: String(item?.id ?? item?._id ?? ''),
    analyzer_id: String(item?.analyzerId ?? item?.analyzer_id ?? item?.workerId ?? ''),
    analyzer_name: String(item?.analyzerName ?? item?.analyzer_name ?? item?.workerName ?? ''),
    analyzer_definition_id: String(item?.analyzerDefinitionId ?? item?.analyzer_definition_id ?? item?.workerDefinitionId ?? ''),
    status: String(item?.status ?? ''),
    data_type: String(item?.dataType ?? item?.data_type ?? ''),
    data: String(item?.data ?? ''),
    message: String(item?.message ?? ''),
    tlp: Number(item?.tlp ?? 2),
    date: String(item?.date ?? item?.createdAt ?? ''),
    start_date: String(item?.startDate ?? item?.start_date ?? ''),
    end_date: String(item?.endDate ?? item?.end_date ?? ''),
    raw: item ?? {},
  });

  // ListAnalyzers - GET /api/analyzer or GET /api/analyzer/type/:dataType
  const callListAnalyzers = async (req) => {
    const baseUrl = normalizeBaseUrl(restBaseUrl);
    if (!baseUrl) {
      throw errorWithCode('INVALID_ARGUMENT', 'endpoint/restBaseUrl/baseUrl is required (http/https)');
    }

    const dataType = pickStringField(req, ['data_type', 'dataType', 'DataType']) || '';
    const headers = buildHeaders(req, false);

    const url = dataType
      ? `${baseUrl}/api/analyzer/type/${encodeURIComponent(dataType)}`
      : `${baseUrl}/api/analyzer`;

    logFlow('ListAnalyzers:start', { baseUrl, dataType: dataType || 'all' });
    const res = await fetchCortex(url, { method: 'GET', headers });
    const json = await readJsonResponse(res, []);

    const analyzerList = Array.isArray(json) ? json :
                         Array.isArray(json?.data) ? json.data :
                         json && typeof json === 'object' ? [json] : [];

    logFlow('ListAnalyzers:done', { count: analyzerList.length });
    return {
      err: toValue(null),
      msg: toValue(null),
      data: {
        analyzers: analyzerList.map(mapAnalyzerData),
      },
    };
  };

  // AnalyzeObservable - POST /api/analyzer/:analyzerId/run
  const callAnalyzeObservable = async (req) => {
    const analyzerId = pickStringField(req, ['analyzer_id', 'analyzerId', 'AnalyzerId']) || '';
    if (!analyzerId) {
      throw errorWithCode('INVALID_ARGUMENT', 'analyzer_id is required');
    }

    const data = pickStringField(req, ['data', 'Data']) || '';
    if (!data) {
      throw errorWithCode('INVALID_ARGUMENT', 'data (observable value) is required');
    }

    const dataType = pickStringField(req, ['data_type', 'dataType', 'DataType']) || '';
    if (!dataType) {
      throw errorWithCode('INVALID_ARGUMENT', 'data_type (observable type) is required');
    }

    const baseUrl = normalizeBaseUrl(restBaseUrl);
    if (!baseUrl) {
      throw errorWithCode('INVALID_ARGUMENT', 'endpoint/restBaseUrl/baseUrl is required (http/https)');
    }

    const rawTlp = firstDefined(req?.tlp, req?.Tlp);
    const tlp = toPositiveInt(rawTlp);
    const message = pickStringField(req, ['message', 'Message']) || '';
    const parameters = req?.parameters ?? req?.Parameters ?? {};

    const payload = {
      data,
      dataType,
    };
    if (tlp !== null) payload.tlp = tlp;
    if (message) payload.message = message;
    if (typeof parameters === 'object' && Object.keys(parameters).length > 0) payload.parameters = parameters;

    const url = `${baseUrl}/api/analyzer/${encodeURIComponent(analyzerId)}/run`;
    const headers = buildHeaders(req);

    logFlow('AnalyzeObservable:start', { analyzerId, dataType, data });
    const res = await fetchCortex(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const json = await readJsonResponse(res, {});

    logFlow('AnalyzeObservable:done', { jobId: json?.id ?? json?._id });
    return {
      err: toValue(null),
      msg: toValue(null),
      data: mapJobData(json),
    };
  };

  // GetJobReport - GET /api/job/:jobId/report
  const callGetJobReport = async (req) => {
    const jobId = pickStringField(req, ['job_id', 'jobId', 'JobId']) || '';
    if (!jobId) {
      throw errorWithCode('INVALID_ARGUMENT', 'job_id is required');
    }

    const baseUrl = normalizeBaseUrl(restBaseUrl);
    if (!baseUrl) {
      throw errorWithCode('INVALID_ARGUMENT', 'endpoint/restBaseUrl/baseUrl is required (http/https)');
    }

    const url = `${baseUrl}/api/job/${encodeURIComponent(jobId)}/report`;
    const headers = buildHeaders(req, false);

    logFlow('GetJobReport:start', { jobId });
    const res = await fetchCortex(url, { method: 'GET', headers });
    const json = await readJsonResponse(res, {});

    logFlow('GetJobReport:done', { jobId, success: json?.success ?? json?.report?.success ?? false });
    return {
      err: toValue(null),
      msg: toValue(null),
      data: mapJobReport(json),
    };
  };

  const mapJobReport = (json) => {
    const report = json?.report ?? json;
    const job = json;

    if (typeof report === 'string') {
      // Job still running: "Running" or "Waiting" etc.
      return {
        id: String(job?.id ?? job?._id ?? ''),
        status: String(report),
        success: false,
        summary: {},
        full: {},
        operations: toValue(null),
        artifacts: [],
        error_message: '',
        input: '',
        raw: job ?? {},
      };
    }

    if (typeof report === 'object' && report !== null) {
      const success = Boolean(report?.success ?? false);
      const summary = success ? (report?.summary ?? {}) : {};
      const full = success ? (report?.full ?? {}) : {};
      const operations = report?.operations ?? null;
      const artifacts = Array.isArray(report?.artifacts) ? report.artifacts.map(mapArtifact) : [];
      const errorMessage = report?.errorMessage ?? '';

      return {
        id: String(job?.id ?? job?._id ?? ''),
        status: success ? 'Success' : (errorMessage ? 'Failure' : String(job?.status ?? '')),
        success,
        summary: typeof summary === 'object' ? summary : {},
        full: typeof full === 'object' ? full : {},
        operations: toValue(operations),
        artifacts,
        error_message: String(errorMessage),
        input: String(report?.input ?? job?.input ?? ''),
        raw: job ?? {},
      };
    }

    return {
      id: String(job?.id ?? job?._id ?? ''),
      status: String(job?.status ?? 'Unknown'),
      success: false,
      summary: {},
      full: {},
      operations: toValue(null),
      artifacts: [],
      error_message: '',
      input: '',
      raw: job ?? {},
    };
  };

  const mapArtifact = (item) => ({
    data: String(item?.data ?? ''),
    data_type: String(item?.dataType ?? item?.data_type ?? ''),
    message: String(item?.message ?? ''),
    tags: Array.isArray(item?.tags) ? item.tags.map(String) : [],
    tlp: Number(item?.tlp ?? 2),
    raw: item ?? {},
  });

  // ListJobs - GET /api/job with query params
  const callListJobs = async (req) => {
    const baseUrl = normalizeBaseUrl(restBaseUrl);
    if (!baseUrl) {
      throw errorWithCode('INVALID_ARGUMENT', 'endpoint/restBaseUrl/baseUrl is required (http/https)');
    }

    const dataType = pickStringField(req, ['data_type', 'dataType', 'DataType']) || '';
    const data = pickStringField(req, ['data', 'Data']) || '';
    const analyzer = pickStringField(req, ['analyzer', 'Analyzer']) || '';
    const range = pickStringField(req, ['range', 'Range']) || 'all';

    const queryParts = [];
    if (dataType) queryParts.push(`dataTypeFilter=${encodeURIComponent(dataType)}`);
    if (data) queryParts.push(`dataFilter=${encodeURIComponent(data)}`);
    if (analyzer) queryParts.push(`analyzerFilter=${encodeURIComponent(analyzer)}`);
    queryParts.push(`range=${encodeURIComponent(range)}`);

    const url = `${baseUrl}/api/job${queryParts.length ? `?${queryParts.join('&')}` : ''}`;
    const headers = buildHeaders(req, false);

    logFlow('ListJobs:start', { dataType, data, analyzer, range });
    const res = await fetchCortex(url, { method: 'GET', headers });
    const json = await readJsonResponse(res, []);

    const jobList = Array.isArray(json) ? json :
                    Array.isArray(json?.data) ? json.data :
                    json && typeof json === 'object' ? [json] : [];

    logFlow('ListJobs:done', { count: jobList.length });
    return {
      err: toValue(null),
      msg: toValue(null),
      data: {
        jobs: jobList.map(mapJobData),
      },
    };
  };

  // GetJobStatus - GET /api/job/:jobId (single) or POST /api/job/status (batch)
  const callGetJobStatus = async (req) => {
    const baseUrl = normalizeBaseUrl(restBaseUrl);
    if (!baseUrl) {
      throw errorWithCode('INVALID_ARGUMENT', 'endpoint/restBaseUrl/baseUrl is required (http/https)');
    }

    const singleJobId = pickStringField(req, ['job_id', 'jobId', 'JobId']) || '';
    const batchJobIds = Array.isArray(req?.job_ids ?? req?.jobIds ?? req?.JobIds) ? req.job_ids ?? req.jobIds ?? req.JobIds : [];

    if (singleJobId && batchJobIds.length === 0) {
      // Single job status - GET, no Content-Type
      const headers = buildHeaders(req, false);
      const url = `${baseUrl}/api/job/${encodeURIComponent(singleJobId)}`;
      logFlow('GetJobStatus:start', { jobId: singleJobId });
      const res = await fetchCortex(url, { method: 'GET', headers });
      const json = await readJsonResponse(res, {});
      logFlow('GetJobStatus:done', { jobId: singleJobId, status: json?.status });

      return {
        err: toValue(null),
        msg: toValue(null),
        data: {
          statuses: [{
            job_id: String(json?.id ?? json?._id ?? singleJobId),
            status: String(json?.status ?? 'Unknown'),
          }],
        },
      };
    }

    if (batchJobIds.length > 0) {
      // Batch job status - POST with Content-Type
      const headers = buildHeaders(req);
      const url = `${baseUrl}/api/job/status`;
      const payload = { jobIds: batchJobIds };

      logFlow('GetJobStatus:start', { jobIds: batchJobIds });
      const res = await fetchCortex(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const json = await readJsonResponse(res, {});

      // Batch response is a map of jobId -> status string
      const statuses = [];
      if (typeof json === 'object' && json !== null) {
        for (const [jobId, status] of Object.entries(json)) {
          statuses.push({
            job_id: String(jobId),
            status: String(status),
          });
        }
      }

      logFlow('GetJobStatus:done', { count: statuses.length });
      return {
        err: toValue(null),
        msg: toValue(null),
        data: { statuses },
      };
    }

    throw errorWithCode('INVALID_ARGUMENT', 'job_id or job_ids is required');
  };

  return {
    [METHOD_LIST_ANALYZERS]: async () => callListAnalyzers(requestWithDefaults(ctx.req)),
    [METHOD_ANALYZE_OBSERVABLE]: async () => callAnalyzeObservable(requestWithDefaults(ctx.req)),
    [METHOD_GET_JOB_REPORT]: async () => callGetJobReport(requestWithDefaults(ctx.req)),
    [METHOD_LIST_JOBS]: async () => callListJobs(requestWithDefaults(ctx.req)),
    [METHOD_GET_JOB_STATUS]: async () => callGetJobStatus(requestWithDefaults(ctx.req)),
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
  const legacyCtx = {
    ...call.ctx,
    req: call.req,
  };
  return rpcdef(legacyCtx)[methodPath]();
};

const registerHandlers = (ctx = {}) => ({
  [METHOD_LIST_ANALYZERS]: wrapLegacyHandler(ctx, METHOD_LIST_ANALYZERS),
  [METHOD_ANALYZE_OBSERVABLE]: wrapLegacyHandler(ctx, METHOD_ANALYZE_OBSERVABLE),
  [METHOD_GET_JOB_REPORT]: wrapLegacyHandler(ctx, METHOD_GET_JOB_REPORT),
  [METHOD_LIST_JOBS]: wrapLegacyHandler(ctx, METHOD_LIST_JOBS),
  [METHOD_GET_JOB_STATUS]: wrapLegacyHandler(ctx, METHOD_GET_JOB_STATUS),
});

export const METHOD_LIST_ANALYZERS_FULL = 'TheHive_CORTEX.TheHive_CORTEX/ListAnalyzers';
export const METHOD_ANALYZE_OBSERVABLE_FULL = 'TheHive_CORTEX.TheHive_CORTEX/AnalyzeObservable';
export const METHOD_GET_JOB_REPORT_FULL = 'TheHive_CORTEX.TheHive_CORTEX/GetJobReport';
export const METHOD_LIST_JOBS_FULL = 'TheHive_CORTEX.TheHive_CORTEX/ListJobs';
export const METHOD_GET_JOB_STATUS_FULL = 'TheHive_CORTEX.TheHive_CORTEX/GetJobStatus';

const sdkHandlers = registerHandlers({});

export const handlers = {
  [METHOD_LIST_ANALYZERS_FULL]: (ctx) => sdkHandlers[METHOD_LIST_ANALYZERS](ctx),
  [METHOD_ANALYZE_OBSERVABLE_FULL]: (ctx) => sdkHandlers[METHOD_ANALYZE_OBSERVABLE](ctx),
  [METHOD_GET_JOB_REPORT_FULL]: (ctx) => sdkHandlers[METHOD_GET_JOB_REPORT](ctx),
  [METHOD_LIST_JOBS_FULL]: (ctx) => sdkHandlers[METHOD_LIST_JOBS](ctx),
  [METHOD_GET_JOB_STATUS_FULL]: (ctx) => sdkHandlers[METHOD_GET_JOB_STATUS](ctx),
};

export const _test = {
  errorWithCode,
  mergedBindings,
  normalizeBaseUrl,
  parseHeaders,
  registerHandlers,
  resolveCallContext,
  toPositiveInt,
  toValue,
  buildHeaders: (ctx) => {
    const bindings = mergedBindings(ctx);
    return rpcdef(ctx).buildHeaders ?? (() => {
      const baseHeaders = parseHeaders(bindings.headers);
      const apiKey = bindings.apiKey || bindings.api_key;
      if (apiKey) return { ...baseHeaders, 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json', 'Content-Type': 'application/json' };
      const username = bindings.username;
      const password = bindings.password;
      if (username && password) return { ...baseHeaders, 'Authorization': `Basic ${btoa(`${username}:${password}`)}`, 'Accept': 'application/json', 'Content-Type': 'application/json' };
      return { ...baseHeaders, 'Accept': 'application/json', 'Content-Type': 'application/json' };
    });
  },
};
