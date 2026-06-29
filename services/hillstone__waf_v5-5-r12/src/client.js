const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');
const { invalidArgument, invalidJson, unavailable, fromUpstream } = require('./errors.js');
const { asBase64, getCredentialSource, normalizeSession, buildAuthHeaders, sessionFromInput, validateLoginSource } = require('./auth.js');

function resolveFetch(ctx) {
  if (ctx?.bindings?.fetch) return ctx.bindings.fetch;
  if (typeof fetch === 'function') return fetch;
  return null;
}

function baseUrl(ctx) {
  const host = ctx?.bindings?.host;
  if (!host) throw invalidArgument('host is required');
  const protocol = ctx?.bindings?.protocol || 'https';
  const port = ctx?.bindings?.port || 443;
  return `${protocol}://${host}:${port}`;
}

function timeoutMs(ctx) {
  return Number(ctx?.bindings?.timeoutMs || 5000);
}

function buildRequestHeaders(ctx, headers = {}) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...headers,
  };
}

function shouldSkipTlsVerify(ctx) {
  return Boolean(ctx?.bindings?.skipTlsVerify);
}

function mapPayload(input) {
  if (!input) return {};
  if (input.request && typeof input.request === 'object' && input.request.fields) return structToPlain(input.request);
  if (input.fields && typeof input.fields === 'object') return structToPlain(input);
  if (input.payload && typeof input.payload === 'object' && input.payload.fields) return structToPlain(input.payload);
  return input;
}

function normalizeInvocation(input, ctx = {}) {
  if (!input || typeof input !== 'object' || !input.request) return { request: mapPayload(input), ctx };
  return {
    request: mapPayload(input),
    ctx: {
      ...ctx,
      bindings: {
        ...(ctx.bindings || {}),
        ...(input.config || {}),
      },
      secrets: {
        ...(ctx.secrets || {}),
        ...(input.secret || {}),
      },
      meta: {
        ...(ctx.meta || {}),
        ...(input.metadata || {}),
        method: input.method,
        serviceId: input.serviceId,
        instanceId: input.instanceId,
      },
      workdir: input.workdir || ctx.workdir,
      packageDir: input.packageDir || ctx.packageDir,
    },
  };
}

function structToPlain(struct) {
  const fields = struct?.fields || {};
  const output = {};
  for (const [key, value] of Object.entries(fields)) output[key] = fromValue(value);
  return output;
}

function fromValue(value) {
  if (!value || typeof value !== 'object') return value;
  if (value.kind && typeof value.kind === 'object') {
    const kindCase = value.kind.case;
    const kindValue = value.kind.value;
    if (kindCase === 'stringValue') return kindValue;
    if (kindCase === 'numberValue') return kindValue;
    if (kindCase === 'boolValue') return kindValue;
    if (kindCase === 'nullValue') return null;
    if (kindCase === 'structValue') return structToPlain(kindValue);
    if (kindCase === 'listValue') return (kindValue.values || []).map(fromValue);
  }
  if ('stringValue' in value) return value.stringValue;
  if ('numberValue' in value) return value.numberValue;
  if ('boolValue' in value) return value.boolValue;
  if ('nullValue' in value) return null;
  if ('structValue' in value) return structToPlain(value.structValue);
  if ('listValue' in value) return (value.listValue.values || []).map(fromValue);
  return value;
}

async function parseJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw invalidJson('Invalid JSON response from upstream');
  }
}

function extractPhpSessionId(response) {
  const setCookie = response?.headers?.get?.('set-cookie');
  if (!setCookie || typeof setCookie !== 'string') return '';
  const match = setCookie.match(/PHPSESSID=([^;]+)/);
  return match ? match[1] : '';
}

function nativeRequest(ctx, method, path, { body, headers } = {}) {
  const url = new URL(`${baseUrl(ctx)}${path}`);
  const transport = url.protocol === 'http:' ? http : https;
  const bodyText = body === undefined ? undefined : JSON.stringify(body);
  const requestHeaders = buildRequestHeaders(ctx, headers);
  if (bodyText !== undefined) requestHeaders['Content-Length'] = Buffer.byteLength(bodyText);

  return new Promise((resolve, reject) => {
    const req = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers: requestHeaders,
      rejectUnauthorized: url.protocol === 'https:' ? !shouldSkipTlsVerify(ctx) : undefined,
      timeout: timeoutMs(ctx),
    }, (res) => {
      let data = '';
      res.setEncoding?.('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode || 0,
          ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
          headers: { get: (name) => res.headers[String(name).toLowerCase()] ?? null },
          text: async () => data,
        });
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('Request timed out'), { name: 'AbortError' })));
    req.on('error', reject);
    if (bodyText !== undefined) req.write(bodyText);
    req.end();
  });
}

async function send(ctx, method, path, { body, headers } = {}) {
  const fetchImpl = resolveFetch(ctx);
  try {
    const response = shouldSkipTlsVerify(ctx) && !ctx?.bindings?.fetch
      ? await nativeRequest(ctx, method, path, { body, headers })
      : fetchImpl
        ? await fetchImpl(`${baseUrl(ctx)}${path}`, {
            method,
            headers: buildRequestHeaders(ctx, headers),
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: typeof AbortController !== 'undefined' ? AbortSignal.timeout(timeoutMs(ctx)) : undefined,
          })
        : await nativeRequest(ctx, method, path, { body, headers });
    const payload = await parseJson(response);
    payload.__meta = { phpSessionId: extractPhpSessionId(response) };
    const upstreamError = fromUpstream(payload);
    if (upstreamError) throw upstreamError;
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') throw unavailable('Upstream request timed out');
    throw error;
  }
}

async function login(ctx, input = {}) {
  const source = getCredentialSource(ctx, input);
  validateLoginSource(source);
  if (source.apiToken) {
    const payload = await send(ctx, 'POST', '/rest/api/login', { body: { api_token: source.apiToken } });
    return normalizeSession(payload, source.username);
  }
  const payload = await send(ctx, 'POST', '/rest/api/login', {
    body: {
      lang: source.lang,
      username: asBase64(source.username),
      password: asBase64(source.password),
    },
  });
  return normalizeSession({ ...payload, phpSessionId: payload?.__meta?.phpSessionId || '' }, source.username);
}

async function ensureSession(ctx, input = {}) {
  const existing = sessionFromInput(input);
  if (existing) return existing;
  return login(ctx, input);
}

async function authenticatedRequest(ctx, method, path, input = {}, options = {}) {
  const session = await ensureSession(ctx, input);
  const payload = await send(ctx, method, path, {
    body: options.body,
    headers: buildAuthHeaders(session),
  });
  return { session, payload };
}

module.exports = { mapPayload, normalizeInvocation, send, login, ensureSession, authenticatedRequest, buildAuthHeaders };
