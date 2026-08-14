import { createHash } from 'node:crypto';

import {
  GrpcError,
  createTlsDispatcher,
  fetchWithTimeout,
  grpcStatus,
} from '@chaitin-ai/octobus-sdk';

export const METHOD_HEALTH_CHECK_FULL = 'Venus_MAF.Venus_MAF/HealthCheck';
export const METHOD_CREATE_SITE_FULL = 'Venus_MAF.Venus_MAF/CreateSite';
export const METHOD_DELETE_SITE_FULL = 'Venus_MAF.Venus_MAF/DeleteSite';
export const METHOD_LIST_SITES_FULL = 'Venus_MAF.Venus_MAF/ListSites';
export const METHOD_UPLOAD_SENSITIVE_WORDS_FULL = 'Venus_MAF.Venus_MAF/UploadCustomSensitiveWords';

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 1024 * 1024;

const failure = (name, message, details) => {
  const error = new GrpcError(grpcStatus[name] ?? grpcStatus.UNKNOWN, `${name}: ${message}`);
  if (details !== undefined) error.details = details;
  return error;
};

const stringValue = (value) => typeof value === 'string' ? value.trim() : '';
const integerValue = (value, fallback) => Number.isInteger(Number(value)) ? Number(value) : fallback;
const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');

const normalizeOrigin = (value) => {
  const text = stringValue(value);
  if (!text) return '';
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return '';
    return url.origin;
  } catch {
    return '';
  }
};

const normalizePrefix = (value) => `/${(stringValue(value) || 'api/v3').replace(/^\/+|\/+$/g, '')}`;

const environment = (ctx = {}) => {
  const bindings = { ...(ctx.config ?? {}), ...(ctx.secret ?? {}), ...(ctx.bindings ?? {}) };
  const origin = normalizeOrigin(bindings.baseUrl);
  const username = stringValue(bindings.username);
  const password = stringValue(bindings.password);
  if (!origin) throw failure('INVALID_ARGUMENT', 'config.baseUrl must be a valid HTTP(S) URL without credentials, query, or fragment');
  if (!username || !password) throw failure('INVALID_ARGUMENT', 'secret.username and secret.password are required');
  const configuredTimeout = integerValue(bindings.timeoutMs, DEFAULT_TIMEOUT_MS);
  return {
    origin,
    apiPrefix: normalizePrefix(bindings.apiPrefix),
    username,
    password,
    authToken: stringValue(bindings.authToken) || 'CMCC_NFV',
    deviceType: stringValue(bindings.deviceType) || 'api',
    timeoutMs: configuredTimeout > 0 ? configuredTimeout : DEFAULT_TIMEOUT_MS,
    insecureSkipTlsVerify: bindings.insecureSkipTlsVerify === true,
  };
};

const readBody = async (response) => {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw failure('RESOURCE_EXHAUSTED', 'upstream response exceeds the 2 MiB limit');
  }
  const text = String(await response.text());
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
    throw failure('RESOURCE_EXHAUSTED', 'upstream response exceeds the 2 MiB limit');
  }
  return text;
};

const parseResponse = async (response, action) => {
  const text = await readBody(response);
  if (!response.ok) {
    const name = response.status === 401 ? 'UNAUTHENTICATED'
      : response.status === 403 ? 'PERMISSION_DENIED'
        : response.status >= 400 && response.status < 500 ? 'FAILED_PRECONDITION'
          : 'UNAVAILABLE';
    throw failure(name, `${action} upstream returned HTTP ${response.status}`, { status: response.status });
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text.trim();
  }
};

const statusCode = (payload) => payload && typeof payload === 'object' ? integerValue(payload.code, 0) : 0;
const statusMessage = (payload) => payload && typeof payload === 'object'
  ? String(payload.msg ?? payload.message ?? 'success')
  : String(payload || 'success');
const businessSuccess = (payload) => {
  if (typeof payload === 'string') return /^success$/i.test(payload);
  return !payload || typeof payload !== 'object' || !Object.hasOwn(payload, 'code') || Number(payload.code) === 0;
};

const assertBusinessSuccess = (payload, action) => {
  if (!businessSuccess(payload)) throw failure('FAILED_PRECONDITION', `${action} upstream business error: ${statusMessage(payload)}`);
};

const requestFactory = (env) => {
  let authorization = '';

  const fetchMaf = (path, init) => fetchWithTimeout(`${env.origin}${env.apiPrefix}${path}`, {
    redirect: 'manual',
    ...init,
  }, {
    timeoutMs: env.timeoutMs,
    dispatcher: createTlsDispatcher(env.insecureSkipTlsVerify),
  });

  const login = async () => {
    const response = await fetchMaf('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'device-type': env.deviceType },
      body: JSON.stringify({ username: env.username, password: sha256Hex(env.password) }),
    });
    const payload = await parseResponse(response, 'login');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw failure('INTERNAL', 'login upstream returned an invalid JSON object');
    }
    assertBusinessSuccess(payload, 'login');
    authorization = stringValue(payload.data?.authorization)
      || stringValue(payload.authorization)
      || stringValue(payload.token);
    if (!authorization) throw failure('UNAUTHENTICATED', 'login response is missing data.authorization');
    return authorization;
  };

  const request = async (path, init = {}, { checkBusiness = true } = {}) => {
    if (!authorization) await login();
    const response = await fetchMaf(path, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        authorization,
        'device-type': env.deviceType,
        'auth-token': env.authToken,
      },
    });
    const payload = await parseResponse(response, path);
    if (checkBusiness) assertBusinessSuccess(payload, path);
    return payload;
  };

  return { login, request };
};

const portNumber = (value, field) => {
  const port = integerValue(value, 0);
  if (port < 1 || port > 65535) throw failure('INVALID_ARGUMENT', `${field} must be between 1 and 65535`);
  return port;
};

const sitePayload = (request) => {
  const name = stringValue(request.name);
  const ip = stringValue(request.ip);
  const serverNames = Array.isArray(request.serverName ?? request.server_name) ? request.serverName ?? request.server_name : [];
  const upstream = request.upstream && typeof request.upstream === 'object' ? request.upstream : {};
  const upstreamServers = Array.isArray(upstream.serverAddr ?? upstream.server_addr) ? upstream.serverAddr ?? upstream.server_addr : [];
  if (!name || !ip) throw failure('INVALID_ARGUMENT', 'name and ip are required');
  if (serverNames.length === 0) throw failure('INVALID_ARGUMENT', 'server_name is required');
  if (upstreamServers.length === 0) throw failure('INVALID_ARGUMENT', 'upstream.server_addr is required');
  return {
    name,
    description: stringValue(request.description),
    enable: integerValue(request.enable, 1),
    http_type: stringValue(request.httpType ?? request.http_type) || 'http',
    ip,
    port: portNumber(request.port, 'port'),
    server_name: serverNames.map(String),
    net_mode: integerValue(request.netMode ?? request.net_mode, 2),
    safe_mode: integerValue(request.safeMode ?? request.safe_mode, 1),
    upstream: {
      http_type: stringValue(upstream.httpType ?? upstream.http_type) || 'http',
      load_balance_algo: stringValue(upstream.loadBalanceAlgo ?? upstream.load_balance_algo) || 'round_robin',
      server_addr: upstreamServers.map((server) => ({
        ip: stringValue(server?.ip),
        port: portNumber(server?.port, 'upstream server port'),
        weight: integerValue(server?.weight, 100),
      })),
    },
  };
};

const normalizeSite = (site = {}) => ({
  id: integerValue(site.id, 0),
  name: String(site.name ?? ''),
  ip: String(site.ip ?? ''),
  port: integerValue(site.port, 0),
  httpType: String(site.http_type ?? site.httpType ?? ''),
  enable: integerValue(site.enable, 0),
  serverName: Array.isArray(site.server_name ?? site.serverName) ? (site.server_name ?? site.serverName).map(String) : [],
});

const listSites = async (client, request = {}) => {
  const page = Math.max(1, integerValue(request.page, 1));
  const pageSize = Math.min(100, Math.max(1, integerValue(request.pageSize ?? request.page_size, 10)));
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  const name = stringValue(request.name);
  if (name) query.set('name', name);
  const payload = await client.request(`/protect/vs/find?${query}`);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw failure('INTERNAL', 'list sites upstream returned an invalid JSON object');
  }
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const sites = Array.isArray(data.list) ? data.list.map(normalizeSite) : [];
  return {
    sites,
    total: integerValue(data.total, sites.length),
    page: integerValue(data.page, page),
    pageSize: integerValue(data.pageSize, pageSize),
    code: statusCode(payload),
    message: statusMessage(payload),
  };
};

const createSite = async (client, request) => {
  const body = sitePayload(request);
  const payload = await client.request('/protect/vs/add', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, { checkBusiness: false });
  const listed = await listSites(client, { name: body.name, page: 1, pageSize: 10 });
  if (!listed.sites.some((site) => site.name === body.name)) {
    if (!businessSuccess(payload)) assertBusinessSuccess(payload, 'create site');
    throw failure('FAILED_PRECONDITION', `site ${body.name} was not found after create`);
  }
  return { ok: true, code: statusCode(payload), message: businessSuccess(payload) ? statusMessage(payload) : `created and verified: ${statusMessage(payload)}` };
};

const deleteSite = async (client, request) => {
  let id = integerValue(request.id, 0);
  let name = stringValue(request.name);
  if (!id && !name) throw failure('INVALID_ARGUMENT', 'id or name is required');
  if (!id) {
    const listed = await listSites(client, { name, page: 1, pageSize: 20 });
    const found = listed.sites.find((site) => site.name === name);
    if (!found) throw failure('FAILED_PRECONDITION', `site ${name} was not found`);
    id = found.id;
  }
  const payload = await client.request('/protect/vs/delete', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([{ id, name }]),
  }, { checkBusiness: false });
  const listed = await listSites(client, { name, page: 1, pageSize: 20 });
  if (listed.sites.some((site) => site.id === id || (name && site.name === name))) {
    throw failure('FAILED_PRECONDITION', `site ${name || id} still exists after delete`);
  }
  return { ok: true, code: statusCode(payload), message: businessSuccess(payload) ? statusMessage(payload) : `deleted and verified: ${statusMessage(payload)}` };
};

const multipartBody = (filename, content) => {
  const safeFilename = filename.replace(/["\\\r\n]/g, '_');
  const boundary = `----octobus-maf-${createHash('sha256').update(`${safeFilename}\0${content}`).digest('hex').slice(0, 24)}`;
  return {
    filename: safeFilename,
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeFilename}"\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${content}\r\n--${boundary}--\r\n`),
  };
};

const uploadWords = async (client, request) => {
  const filename = stringValue(request.filename) || 'octobus-sensitive-words.txt';
  const content = typeof request.content === 'string' ? request.content : '';
  if (!content.trim()) throw failure('INVALID_ARGUMENT', 'content is required');
  if (Buffer.byteLength(content) > MAX_UPLOAD_BYTES) throw failure('RESOURCE_EXHAUSTED', 'content exceeds the 1 MiB limit');
  const multipart = multipartBody(filename, content);
  const payload = await client.request('/protect/tmpl/llm/customize/file', {
    method: 'POST', headers: { 'content-type': multipart.contentType }, body: multipart.body,
  }, { checkBusiness: false });
  if (typeof payload !== 'string') assertBusinessSuccess(payload, 'upload sensitive words');
  const returnedName = typeof payload === 'string' ? payload : String(payload?.data?.file_name ?? payload?.file_name ?? multipart.filename);
  return { ok: true, code: statusCode(payload), message: statusMessage(payload), fileName: returnedName, originFileName: multipart.filename };
};

const invoke = async (ctx, operation) => {
  const env = environment(ctx);
  const client = requestFactory(env);
  const request = ctx?.request ?? ctx?.req ?? {};
  return operation(client, request);
};

export const handlers = {
  [METHOD_HEALTH_CHECK_FULL]: (ctx) => invoke(ctx, async (client) => ({ ok: Boolean(await client.login()), code: 0, message: 'success' })),
  [METHOD_CREATE_SITE_FULL]: (ctx) => invoke(ctx, createSite),
  [METHOD_DELETE_SITE_FULL]: (ctx) => invoke(ctx, deleteSite),
  [METHOD_LIST_SITES_FULL]: (ctx) => invoke(ctx, listSites),
  [METHOD_UPLOAD_SENSITIVE_WORDS_FULL]: (ctx) => invoke(ctx, uploadWords),
};

export const _test = { multipartBody, normalizeOrigin, normalizePrefix, sha256Hex, sitePayload };
