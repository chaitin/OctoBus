import fs from 'node:fs/promises';
import path from 'node:path';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const METHOD_UPLOAD_FILE_PATH = '/ThreatBook_ClaudSandbox_V3.ThreatBook_ClaudSandbox_V3/UploadFile';
export const METHOD_UPLOAD_FILE_FULL = 'ThreatBook_ClaudSandbox_V3.ThreatBook_ClaudSandbox_V3/UploadFile';
export const METHOD_GET_FILE_REPORT_PATH = '/ThreatBook_ClaudSandbox_V3.ThreatBook_ClaudSandbox_V3/GetFileReport';
export const METHOD_GET_FILE_REPORT_FULL = 'ThreatBook_ClaudSandbox_V3.ThreatBook_ClaudSandbox_V3/GetFileReport';
export const METHOD_GET_MULTI_ENGINES_REPORT_PATH = '/ThreatBook_ClaudSandbox_V3.ThreatBook_ClaudSandbox_V3/GetMultiEnginesReport';
export const METHOD_GET_MULTI_ENGINES_REPORT_FULL = 'ThreatBook_ClaudSandbox_V3.ThreatBook_ClaudSandbox_V3/GetMultiEnginesReport';

export const DEFAULT_TIMEOUT_MS = 1500;
export const FILE_UPLOAD_HTTP_PATH = '/v3/file/upload';
export const FILE_REPORT_HTTP_PATH = '/v3/file/report';
export const FILE_MULTI_ENGINES_REPORT_HTTP_PATH = '/v3/file/report/multiengines';

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), String(message ?? ''));
  err.legacyCode = code;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

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

const redactSensitive = (value, sensitiveValues = []) => {
  let out = String(value ?? '');
  for (const sensitive of sensitiveValues || []) {
    const raw = toTrimmedString(sensitive);
    if (!raw) continue;
    out = out.split(raw).join('<redacted>');
  }
  return out;
};

const normalizeBaseUrl = (value) => {
  const raw = toTrimmedString(value);
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.replace(/\/+$/, '');
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx.config ?? {}),
  ...(ctx.secret ?? {}),
  ...(ctx.bindings ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.req ?? ctx.request ?? {},
});

const resolveDomain = (bindings = {}) => normalizeBaseUrl(firstDefined(
  bindings.threatbook_domain,
  bindings.domain,
  bindings.restBaseUrl,
  bindings.baseUrl,
  'https://api.threatbook.cn',
));

const resolveApiKey = (bindings = {}) => toTrimmedString(firstDefined(
  bindings.threatbook_apikey,
  bindings.apikey,
  bindings.apiKey,
));

const resolveTimeoutMs = (ctx = {}) => {
  const raw = Number(firstDefined(ctx.limits?.timeoutMs, ctx.bindings?.timeoutMs, DEFAULT_TIMEOUT_MS));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

const insecureTlsDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

const buildTlsOptions = (bindings = {}) => {
  const enabled = Boolean(bindings.skipTlsVerify || bindings.tlsInsecureSkipVerify || bindings.insecureSkipVerify);
  if (!enabled) return {};
  return { dispatcher: insecureTlsDispatcher };
};

const makeTimeoutSignal = (timeoutMs) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeoutId) };
};

const requireDomain = (ctx = {}) => {
  const domain = resolveDomain(ctx.bindings || {});
  if (!domain) throw errorWithCode('INVALID_ARGUMENT', 'threatbook_domain must be an http(s) URL');
  return domain;
};

const requireApiKey = (ctx = {}) => {
  const apiKey = resolveApiKey(ctx.bindings || {});
  if (!apiKey) throw errorWithCode('UNAUTHENTICATED', 'threatbook_apikey is required in secret');
  return apiKey;
};

const buildUrl = (baseUrl, httpPath, query = {}, multiValueQuery = {}) => {
  const url = new URL(`${String(baseUrl || '').replace(/\/+$/, '')}/${String(httpPath || '').replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  for (const [key, values] of Object.entries(multiValueQuery)) {
    for (const value of values || []) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.append(key, String(value));
    }
  }
  return url.toString();
};

const tryParseJson = (text) => {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
};

const toValue = (value) => {
  if (value === undefined || value === null) return { nullValue: 'NULL_VALUE' };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number') return Number.isFinite(value) ? { numberValue: value } : { stringValue: String(value) };
  if (Array.isArray(value)) {
    return { listValue: { values: value.map((item) => toValue(item)) } };
  }
  if (typeof value === 'object') {
    const fields = {};
    for (const [key, innerValue] of Object.entries(value)) {
      fields[key] = toValue(innerValue);
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(value) };
};

const throwStructuredError = (code, message, options = {}) => {
  const rawBody = String(options.rawBody ?? '');
  const sensitiveValues = options.sensitiveValues || [];
  const payload = {
    code,
    message: redactSensitive(message, sensitiveValues),
    http_status: Number(options.httpStatus ?? 0),
    raw_body: '',
    raw_body_length: rawBody.length,
  };
  if (options.reason) payload.reason = redactSensitive(options.reason, sensitiveValues);
  if (options.responseCode !== undefined) payload.response_code = options.responseCode;
  if (options.verboseMsg !== undefined) payload.verbose_msg = redactSensitive(options.verboseMsg, sensitiveValues);
  throw errorWithCode(code, JSON.stringify(payload));
};

const mapHttpStatusToGrpcCode = (status) => {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'PERMISSION_DENIED';
  if (status >= 400 && status < 500) return 'FAILED_PRECONDITION';
  if (status >= 500) return 'UNAVAILABLE';
  return 'UNAVAILABLE';
};

const fetchUpstream = async (url, init, ctx = {}) => {
  const bindings = ctx.bindings || {};
  const sensitiveValues = [resolveApiKey(bindings)].filter(Boolean);
  const timeoutMs = resolveTimeoutMs(ctx);
  const timeout = makeTimeoutSignal(timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      ...init,
      signal: timeout.signal,
      ...buildTlsOptions(bindings),
    });
  } catch (err) {
    throwStructuredError('UNAVAILABLE', 'threatbook upstream request failed', {
      httpStatus: 0,
      rawBody: '',
      reason: err?.cause?.message || err?.message || 'fetch failed',
      sensitiveValues,
    });
  } finally {
    timeout.clear();
  }

  const httpStatus = Number(res?.status || 0);
  let rawBody;
  try {
    rawBody = await res.text();
  } catch (err) {
    throwStructuredError('UNAVAILABLE', 'threatbook upstream response read failed', {
      httpStatus,
      rawBody: '',
      reason: err?.message || 'response read failed',
      sensitiveValues,
    });
  }
  const result = { httpStatus, rawBody: String(rawBody ?? '') };
  if (sensitiveValues.length) result.sensitiveValues = sensitiveValues;
  return result;
};

const assertThreatBookSuccess = ({ httpStatus, rawBody }, parsed) => {
  if (httpStatus !== 200) {
    throwStructuredError(mapHttpStatusToGrpcCode(httpStatus), 'threatbook upstream http failure', {
      httpStatus,
      rawBody,
      rawJson: parsed.ok ? parsed.value : undefined,
      reason: `upstream http ${httpStatus}`,
      sensitiveValues: parsed.sensitiveValues,
    });
  }

  if (!parsed.ok) {
    throwStructuredError('UNKNOWN', 'threatbook response is not valid JSON', {
      httpStatus,
      rawBody,
      reason: 'response is not valid JSON',
      sensitiveValues: parsed.sensitiveValues,
    });
  }

  const responseCode = Number(firstDefined(parsed.value?.response_code, parsed.value?.responseCode));
  const verboseMsg = toTrimmedString(firstDefined(parsed.value?.verbose_msg, parsed.value?.verboseMsg));

  if (!Number.isFinite(responseCode)) {
    throwStructuredError('UNKNOWN', 'threatbook response_code missing', {
      httpStatus,
      rawBody,
      rawJson: parsed.value,
      reason: 'response_code missing',
      sensitiveValues: parsed.sensitiveValues,
    });
  }

  if (responseCode !== 0) {
    const grpcCode = responseCode === 401 || responseCode === 1101 ? 'UNAUTHENTICATED' : 'FAILED_PRECONDITION';
    throwStructuredError(grpcCode, 'threatbook upstream business failure', {
      httpStatus,
      rawBody,
      rawJson: parsed.value,
      responseCode,
      verboseMsg,
      reason: 'response_code != 0',
      sensitiveValues: parsed.sensitiveValues,
    });
  }

  return parsed.value;
};

const parseThreatBookJSON = (result) => {
  const trimmed = result.rawBody.trim();
  const parsed = trimmed ? tryParseJson(trimmed) : { ok: false };
  parsed.sensitiveValues = result.sensitiveValues || [];
  return assertThreatBookSuccess(result, parsed);
};

const toInt = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const toStringArray = (value) => Array.isArray(value) ? value.map((item) => String(item)) : [];

const isValidBase64 = (value) => {
  const raw = toTrimmedString(value);
  if (!raw) return false;
  try {
    return Buffer.from(raw, 'base64').toString('base64').replace(/=+$/, '') === raw.replace(/=+$/, '');
  } catch {
    return false;
  }
};

const readFileFromRequest = async (req = {}) => {
  const filePath = toTrimmedString(req.file_path ?? req.filePath);
  const fileName = toTrimmedString(req.file_name ?? req.fileName);
  const fileBytesBase64 = toTrimmedString(req.file_bytes_base64 ?? req.fileBytesBase64);
  const fileBytes = unwrapScalar(req.file_bytes ?? req.fileBytes);

  if (filePath) {
    try {
      const bytes = await fs.readFile(filePath);
      return { bytes, fileName: fileName || path.basename(filePath) || 'sample.bin' };
    } catch (err) {
      throw errorWithCode('INVALID_ARGUMENT', `failed to read file_path: ${err?.message || 'read failed'}`);
    }
  }

  if (fileBytesBase64) {
    if (!isValidBase64(fileBytesBase64)) throw errorWithCode('INVALID_ARGUMENT', 'file_bytes_base64 must be valid base64');
    return { bytes: Buffer.from(fileBytesBase64, 'base64'), fileName: fileName || 'sample.bin' };
  }

  if (fileBytes !== undefined && fileBytes !== null) {
    if (fileBytes instanceof Uint8Array) return { bytes: Buffer.from(fileBytes), fileName: fileName || 'sample.bin' };
    if (Array.isArray(fileBytes)) return { bytes: Buffer.from(fileBytes), fileName: fileName || 'sample.bin' };
    if (typeof fileBytes === 'string') return { bytes: Buffer.from(fileBytes, 'base64'), fileName: fileName || 'sample.bin' };
  }

  throw errorWithCode('INVALID_ARGUMENT', 'file_path or file_bytes_base64 or file_bytes is required');
};

const normalizeRunTime = (req = {}) => {
  const raw = unwrapScalar(req.run_time ?? req.runTime);
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw errorWithCode('INVALID_ARGUMENT', 'run_time must be a positive integer');
  return value;
};

const requireResource = (req = {}) => {
  const resource = toTrimmedString(firstDefined(req.resource, req.sha256));
  if (!resource) throw errorWithCode('INVALID_ARGUMENT', 'resource is required');
  return resource;
};

const requireSandboxType = (req = {}) => {
  const sandboxType = toTrimmedString(req.sandbox_type ?? req.sandboxType);
  if (!sandboxType) throw errorWithCode('INVALID_ARGUMENT', 'sandbox_type is required');
  return sandboxType;
};

const normalizeQueryFields = (req = {}) => {
  const raw = req.query_fields ?? req.queryFields;
  if (raw === undefined || raw === null) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  return values.map((item) => toTrimmedString(item)).filter(Boolean);
};

const mapUploadResponse = (result) => {
  const json = parseThreatBookJSON(result);
  return {
    http_status: result.httpStatus,
    raw_body: '',
    raw_json: undefined,
    sha256: toTrimmedString(json.data?.sha256),
    permalink: toTrimmedString(json.data?.permalink),
  };
};

const mapSummary = (raw = {}) => ({
  threat_level: toTrimmedString(raw.threat_level),
  malware_type: toTrimmedString(raw.malware_type),
  malware_family: toTrimmedString(raw.malware_family),
  is_whitelist: Boolean(raw.is_whitelist),
  submit_time: toTrimmedString(raw.submit_time),
  file_name: toTrimmedString(raw.file_name),
  file_type: toTrimmedString(raw.file_type),
  sample_sha256: toTrimmedString(raw.sample_sha256),
  md5: toTrimmedString(raw.md5),
  sha1: toTrimmedString(raw.sha1),
  scenes: toStringArray(raw.scenes),
  threat_score: toInt(raw.threat_score),
  sandbox_type: toTrimmedString(raw.sandbox_type),
  sandbox_type_list: toStringArray(raw.sandbox_type_list),
  multi_engines: toTrimmedString(raw.multi_engines),
});

const mapFileReportResponse = (result) => {
  const json = parseThreatBookJSON(result);
  return {
    http_status: result.httpStatus,
    raw_body: '',
    raw_json: undefined,
    summary: mapSummary(json.data?.summary ?? {}),
    permalink: toTrimmedString(json.data?.permalink),
    data: toValue(json.data ?? {}),
  };
};

const mapMultiEngines = (raw = {}) => ({
  threat_level: toTrimmedString(raw.threat_level),
  total: toInt(raw.total),
  scans: toValue(raw.scans ?? {}),
  is_white: Boolean(raw.is_white),
  total2: toInt(raw.total2),
  positives: toInt(raw.positives),
  scan_date: toTrimmedString(raw.scan_date),
  malware_type: toTrimmedString(raw.malware_type),
  malware_family: toTrimmedString(raw.malware_family),
});

const mapMultiEnginesReportResponse = (result) => {
  const json = parseThreatBookJSON(result);
  return {
    http_status: result.httpStatus,
    raw_body: '',
    raw_json: undefined,
    multiengines: mapMultiEngines(json.data?.multiengines ?? {}),
    data: toValue(json.data ?? {}),
  };
};

const handleUploadFile = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const domain = requireDomain(callCtx);
  const apiKey = requireApiKey(callCtx);
  const { bytes, fileName } = await readFileFromRequest(req);
  const sandboxType = toTrimmedString(req.sandbox_type ?? req.sandboxType);
  const runTime = normalizeRunTime(req);
  const form = new FormData();
  form.set('apikey', apiKey);
  if (sandboxType) form.set('sandbox_type', sandboxType);
  if (runTime !== undefined) form.set('run_time', String(runTime));
  form.set('file', new Blob([bytes]), fileName);
  const endpoint = buildUrl(domain, FILE_UPLOAD_HTTP_PATH);
  return mapUploadResponse(await fetchUpstream(endpoint, { method: 'POST', body: form }, callCtx));
};

const handleGetFileReport = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const domain = requireDomain(callCtx);
  const apiKey = requireApiKey(callCtx);
  const resource = requireResource(req);
  const sandboxType = requireSandboxType(req);
  const queryFields = normalizeQueryFields(req);
  const endpoint = buildUrl(domain, FILE_REPORT_HTTP_PATH, {
    apikey: apiKey,
    resource,
    sandbox_type: sandboxType,
  }, {
    query_fields: queryFields,
  });
  return mapFileReportResponse(await fetchUpstream(endpoint, { method: 'GET' }, callCtx));
};

const handleGetMultiEnginesReport = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const domain = requireDomain(callCtx);
  const apiKey = requireApiKey(callCtx);
  const resource = requireResource(req);
  const endpoint = buildUrl(domain, FILE_MULTI_ENGINES_REPORT_HTTP_PATH, {
    apikey: apiKey,
    resource,
  });
  return mapMultiEnginesReportResponse(await fetchUpstream(endpoint, { method: 'GET' }, callCtx));
};

const splitHandlerArgs = (first = {}, second) => {
  if (second !== undefined) return { req: first ?? {}, ctx: second ?? {} };
  if (first && typeof first === 'object' && (hasOwn(first, 'request') || hasOwn(first, 'config') || hasOwn(first, 'secret'))) {
    return { req: first.request ?? first.req ?? {}, ctx: first };
  }
  return { req: first ?? {}, ctx: {} };
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_UPLOAD_FILE_PATH]: async (req) => handleUploadFile(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_GET_FILE_REPORT_PATH]: async (req) => handleGetFileReport(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_GET_MULTI_ENGINES_REPORT_PATH]: async (req) => handleGetMultiEnginesReport(req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_UPLOAD_FILE_FULL]: (first, second) => {
    const { req, ctx } = splitHandlerArgs(first, second);
    return handleUploadFile(req, ctx);
  },
  [METHOD_GET_FILE_REPORT_FULL]: (first, second) => {
    const { req, ctx } = splitHandlerArgs(first, second);
    return handleGetFileReport(req, ctx);
  },
  [METHOD_GET_MULTI_ENGINES_REPORT_FULL]: (first, second) => {
    const { req, ctx } = splitHandlerArgs(first, second);
    return handleGetMultiEnginesReport(req, ctx);
  },
};

export const _test = {
  assertThreatBookSuccess,
  buildTlsOptions,
  buildUrl,
  errorWithCode,
  fetchUpstream,
  firstDefined,
  grpcCodeFor,
  handleGetFileReport,
  handleGetMultiEnginesReport,
  handleUploadFile,
  hasOwn,
  insecureTlsDispatcher,
  isValidBase64,
  makeTimeoutSignal,
  mapFileReportResponse,
  mapHttpStatusToGrpcCode,
  mapMultiEngines,
  mapMultiEnginesReportResponse,
  mapSummary,
  mapUploadResponse,
  mergedBindings,
  normalizeBaseUrl,
  normalizeQueryFields,
  normalizeRunTime,
  parseThreatBookJSON,
  readFileFromRequest,
  redactSensitive,
  requireApiKey,
  requireDomain,
  requireResource,
  requireSandboxType,
  resolveApiKey,
  resolveCallContext,
  resolveDomain,
  resolveTimeoutMs,
  splitHandlerArgs,
  throwStructuredError,
  toInt,
  toStringArray,
  toTrimmedString,
  toValue,
  tryParseJson,
  unwrapScalar,
};
