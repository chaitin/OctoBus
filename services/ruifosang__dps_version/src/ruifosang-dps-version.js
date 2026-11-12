// Ruifosang DPS (DPS 平台 API v1) — HTTP proxy for the vendor OpenAPI 3.1 surface.
//
// Every gRPC method maps to exactly one DPS HTTP endpoint. The request message carries the
// endpoint parameters (path/query/headers) plus an optional "body" Struct with the raw JSON
// body documented by the vendor schema.
//
// Configuration: baseUrl (required), headers, cookie, token, timeoutMs, skipTlsVerify.
// Secrets: token (Bearer), cookie (session cookie issued by /v1/auth/login).

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

import { ENDPOINTS } from './endpoints.js';

const SERVICE_NAME = 'Ruifosang_DPS_Version';
const DEFAULT_TIMEOUT_MS = 15000;
const JSON_CONTENT_TYPE = 'application/json';
// content-type travels in ApiResponse.content_type, so it is not repeated here.
const FORWARDED_HEADERS = [
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified',
  'location',
  'retry-after',
  'set-cookie',
];

let insecureDispatcher;

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object' && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return String(value);
};

const trimmedString = (value) => unwrapScalar(value).trim();

const grpcCodeForHttpStatus = (status) => {
  if (status === 400 || status === 415) return grpcStatus.INVALID_ARGUMENT;
  if (status === 401) return grpcStatus.UNAUTHENTICATED;
  if (status === 403) return grpcStatus.PERMISSION_DENIED;
  if (status === 404 || status === 410) return grpcStatus.NOT_FOUND;
  if (status === 409) return grpcStatus.ABORTED;
  if (status === 413 || status === 429) return grpcStatus.RESOURCE_EXHAUSTED;
  if (status === 416) return grpcStatus.OUT_OF_RANGE;
  if (status === 422) return grpcStatus.INVALID_ARGUMENT;
  if (status === 428) return grpcStatus.FAILED_PRECONDITION;
  if (status >= 500) return grpcStatus.UNAVAILABLE;
  return grpcStatus.UNKNOWN;
};

const grpcError = (code, message, extra = {}) => {
  const error = new GrpcError(code, message);
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) error[key] = value;
  }
  return error;
};

const invalidArgument = (message) => grpcError(grpcStatus.INVALID_ARGUMENT, message);

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.secret ?? {}),
});

const normalizeBaseUrl = (value) => {
  const raw = trimmedString(value);
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.replace(/\/+$/, '');
};

const resolveTimeoutMs = (bindings = {}) => {
  const raw = firstDefined(bindings.timeoutMs, bindings.timeout_ms);
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.floor(num);
};

const resolveHeaders = (value) => {
  if (value === undefined || value === null || value === '') return {};
  let source = value;
  if (typeof value === 'string') {
    try {
      source = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  const headers = {};
  for (const [name, headerValue] of Object.entries(source)) {
    const text = trimmedString(headerValue);
    if (text) headers[name] = text;
  }
  return headers;
};

const createTlsDispatcher = (skipTlsVerify) => {
  if (!skipTlsVerify) return undefined;
  insecureDispatcher ??= new Agent({ connect: { rejectUnauthorized: false } });
  return insecureDispatcher;
};

const requestWithTimeout = async (url, init, options = {}) => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const dispatcher = createTlsDispatcher(options.skipTlsVerify);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw grpcError(
        grpcStatus.DEADLINE_EXCEEDED,
        'request to DPS timed out after ' + timeoutMs + ' ms',
      );
    }
    throw grpcError(
      grpcStatus.UNAVAILABLE,
      'request to DPS failed: ' + (error instanceof Error ? error.message : String(error)),
    );
  } finally {
    clearTimeout(timer);
  }
};

const snakeCase = (field) => field.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

const fieldValue = (request, field) => {
  if (!request || typeof request !== 'object') return undefined;
  if (hasOwn(request, field)) return request[field];
  const snake = snakeCase(field);
  if (hasOwn(request, snake)) return request[snake];
  return undefined;
};

const isEmpty = (value) => value === undefined || value === null || trimmedString(value) === '';

const scalarText = (value) => {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalidArgument('number is not finite');
    return String(value);
  }
  return trimmedString(value);
};

const buildPath = (entry, request) => {
  return entry.path.replace(/\{([^}]+)\}/g, (_, wireName) => {
    const param = (entry.params ?? []).find((item) => item.name === wireName);
    const value = param ? fieldValue(request, param.field) : undefined;
    if (isEmpty(value)) {
      throw invalidArgument('missing required path parameter "' + wireName + '" for ' + entry.rpc);
    }
    return encodeURIComponent(scalarText(value));
  });
};

const buildQuery = (entry, request) => {
  const params = new URLSearchParams();
  for (const item of entry.query ?? []) {
    const value = fieldValue(request, item.field);
    if (value === undefined || value === null) {
      if (item.required) {
        throw invalidArgument('missing required query parameter "' + item.name + '" for ' + entry.rpc);
      }
      continue;
    }
    const values = Array.isArray(value) ? value : [value];
    for (const single of values) {
      if (single === undefined || single === null) continue;
      params.append(item.name, scalarText(single));
    }
  }
  return params;
};

const buildHeaders = (entry, request, bindings, hasBody) => {
  const headers = {
    accept: entry.binary ? '*/*' : JSON_CONTENT_TYPE,
    ...resolveHeaders(bindings.headers),
  };
  const token = trimmedString(firstDefined(bindings.token, bindings.apiToken, bindings.api_token));
  if (token) headers.authorization = 'Bearer ' + token;
  const cookie = trimmedString(firstDefined(bindings.cookie, bindings.sessionCookie, bindings.session_cookie));
  if (cookie) headers.cookie = cookie;
  for (const item of entry.headers ?? []) {
    const value = fieldValue(request, item.field);
    if (isEmpty(value)) {
      if (item.required) {
        throw invalidArgument('missing required header "' + item.name + '" for ' + entry.rpc);
      }
      continue;
    }
    headers[item.name] = scalarText(value);
  }
  if (hasBody) headers['content-type'] = JSON_CONTENT_TYPE;
  return headers;
};

const resolveBody = (entry, request) => {
  if (!entry.hasBody) return undefined;
  const body = fieldValue(request, 'body');
  if (body === undefined || body === null) {
    throw invalidArgument('missing required request body for ' + entry.rpc);
  }
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw invalidArgument('request body for ' + entry.rpc + ' must be a JSON object');
  }
  return JSON.stringify(body);
};

const collectHeaders = (response) => {
  const headers = [];
  for (const name of FORWARDED_HEADERS) {
    let values;
    if (name === 'set-cookie' && typeof response.headers.getSetCookie === 'function') {
      values = response.headers.getSetCookie();
    } else {
      const single = response.headers.get(name);
      values = single === null || single === undefined ? [] : [single];
    }
    for (const value of values) headers.push({ name, value: String(value) });
  }
  return headers;
};

const describeFailure = (status, text, headers) => {
  let problem;
  if (text) {
    try {
      problem = JSON.parse(text);
    } catch {
      problem = undefined;
    }
  }
  const parts = ['HTTP ' + status];
  if (problem && typeof problem === 'object') {
    if (problem.title) parts.push(String(problem.title));
    if (problem.code) parts.push('code=' + String(problem.code));
    if (problem.detail) parts.push(String(problem.detail));
    if (problem.trace_id) parts.push('trace_id=' + String(problem.trace_id));
  } else if (text) {
    parts.push(text.replace(/\s+/g, ' ').trim().slice(0, 300));
  }
  const location = headers.find((header) => header.name === 'location');
  if (location) parts.push('location=' + location.value);
  return {
    message: parts.filter(Boolean).join(' | '),
    problem,
  };
};

const readPayload = async (entry, response) => {
  const contentType = response.headers.get('content-type') ?? '';
  if (entry.head) {
    return { contentType, data: undefined, binaryBody: undefined };
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const isJson = contentType.toLowerCase().includes('json') || (!entry.binary && bytes.length > 0 && !contentType);
  if (entry.binary) {
    return { contentType, data: undefined, binaryBody: bytes };
  }
  if (bytes.length === 0) {
    return { contentType, data: undefined, binaryBody: undefined };
  }
  const text = bytes.toString('utf8');
  if (!isJson) {
    return { contentType, data: text, binaryBody: undefined };
  }
  try {
    return { contentType, data: JSON.parse(text), binaryBody: undefined };
  } catch {
    return { contentType, data: text, binaryBody: undefined };
  }
};

const callEndpoint = async (ctx, entry) => {
  const bindings = mergedBindings(ctx);
  const baseUrl = normalizeBaseUrl(firstDefined(bindings.baseUrl, bindings.base_url, bindings.endpoint, bindings.url));
  if (!baseUrl) {
    throw invalidArgument('baseUrl is required and must be an http(s) URL');
  }
  const request = ctx?.request ?? {};
  const query = buildQuery(entry, request);
  const body = resolveBody(entry, request);
  const headers = buildHeaders(entry, request, bindings, body !== undefined);
  const url = baseUrl + buildPath(entry, request) + (query.toString() ? '?' + query.toString() : '');
  const init = { method: entry.http, headers };
  if (body !== undefined) init.body = body;
  const response = await requestWithTimeout(url, init, {
    timeoutMs: resolveTimeoutMs(bindings),
    skipTlsVerify: Boolean(firstDefined(bindings.skipTlsVerify, bindings.skip_tls_verify, bindings.tlsInsecureSkipVerify)),
  });
  // 304 Not Modified is a documented answer for the archive-entry endpoints when the
  // caller sends If-None-Match / If-Modified-Since, so it is returned rather than raised.
  if (!response.ok && response.status !== 304) {
    const text = await response.text().catch(() => '');
    const forwarded = collectHeaders(response);
    const { message, problem } = describeFailure(response.status, text, forwarded);
    throw grpcError(grpcCodeForHttpStatus(response.status), 'DPS ' + entry.rpc + ' failed: ' + message, {
      httpStatus: response.status,
      problemCode: problem?.code ? String(problem.code) : undefined,
      traceId: problem?.trace_id ? String(problem.trace_id) : undefined,
    });
  }
  const { contentType, data, binaryBody } = await readPayload(entry, response);
  const result = { httpStatus: response.status };
  if (contentType) result.contentType = contentType;
  if (data !== undefined) result.data = data;
  if (binaryBody !== undefined) result.binaryBody = binaryBody;
  const forwarded = collectHeaders(response);
  if (forwarded.length > 0) result.headers = forwarded;
  return result;
};

const methodFullName = (rpc) => SERVICE_NAME + '.' + SERVICE_NAME + '/' + rpc;

const handlers = {};
for (const entry of ENDPOINTS) {
  handlers[methodFullName(entry.rpc)] = (ctx) => callEndpoint(ctx, entry);
}

export { ENDPOINTS, handlers };

export const _test = {
  buildHeaders,
  buildPath,
  buildQuery,
  collectHeaders,
  describeFailure,
  fieldValue,
  grpcCodeForHttpStatus,
  methodFullName,
  normalizeBaseUrl,
  readPayload,
  resolveBody,
  resolveHeaders,
  resolveTimeoutMs,
  scalarText,
  snakeCase,
};
