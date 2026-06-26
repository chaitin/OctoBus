import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const DEFAULT_TIMEOUT_MS = 10000;

const errorWithCode = (status, message) => new GrpcError(status, message);
const invalid = (message) => errorWithCode(grpcStatus.INVALID_ARGUMENT, message);
const unavailable = (message) => errorWithCode(grpcStatus.UNAVAILABLE, message);
const failed = (message) => errorWithCode(grpcStatus.FAILED_PRECONDITION, message);
const denied = (message) => errorWithCode(grpcStatus.PERMISSION_DENIED, message);

const first = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');
const text = (value) => value === undefined || value === null ? '' : String(value).trim();
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const merged = (ctx = {}) => ({ ...(ctx.config ?? {}), ...(ctx.secret ?? {}), ...(ctx.bindings ?? {}) });
const reqOf = (ctx = {}) => ctx.request ?? ctx.req ?? {};

const normalizeBaseUrl = (bindings) => {
  const raw = text(first(bindings.baseUrl, bindings.base_url, bindings.host));
  if (!raw) throw invalid('baseUrl is required');
  if (/^https:\/\//i.test(raw) || (bindings.allowInsecureHttp === true && /^http:\/\//i.test(raw))) {
    return raw.replace(/\/+$/, '');
  }
  throw invalid('baseUrl must be https:// unless allowInsecureHttp is true');
};

const timeoutMs = (bindings) => {
  const raw = Number(first(bindings.timeoutMs, DEFAULT_TIMEOUT_MS));
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : DEFAULT_TIMEOUT_MS;
};

const parseJson = (source, label) => {
  if (!text(source)) return {};
  try {
    const parsed = JSON.parse(source);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    throw new Error('not object');
  } catch {
    throw invalid(`${label} must be a JSON object string`);
  }
};

const responseBody = async (res) => {
  const body = await res.text();
  let parsed = null;
  try { parsed = body ? JSON.parse(body) : null; } catch {}
  return { body, parsed };
};

const callHttp = async ({ bindings, method, path, query, headers, body }) => {
  const url = new URL(path, normalizeBaseUrl(bindings));
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const init = {
    method,
    headers: {
      ...(bindings.headers && typeof bindings.headers === 'object' ? bindings.headers : {}),
      ...(headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs(bindings)),
  };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    if (!hasOwn(init.headers, 'content-type') && !hasOwn(init.headers, 'Content-Type')) {
      init.headers['content-type'] = 'application/json';
    }
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw unavailable(err?.message || 'upstream request failed');
  }
  const { body: bodyText, parsed } = await responseBody(res);
  if (res.status === 401 || res.status === 403) throw denied(bodyText || `upstream http ${res.status}`);
  if (res.status >= 400 && res.status < 500) throw failed(bodyText || `upstream http ${res.status}`);
  if (res.status >= 500) throw unavailable(bodyText || `upstream http ${res.status}`);
  return {
    status: Number(parsed?.status ?? parsed?.code ?? res.status ?? 0) || 0,
    message: text(first(parsed?.msg, parsed?.message, parsed?.errmsg, res.statusText)),
    body: bodyText,
  };
};

const requireToken = (request, bindings) => {
  const token = text(first(request.token, bindings.token));
  if (!token) throw invalid('token is required');
  return token;
};

const namespaceOf = (request) => text(first(request.namespace, 'public')) || 'public';
const expandPath = (path, request = {}) => path.replace('{namespace}', encodeURIComponent(namespaceOf(request)));
const authHeaders = (request, bindings) => {
  const token = requireToken(request, bindings);
  return "Cookie" === 'Cookie' ? { Cookie: `token=${encodeURIComponent(token)}` } : { token };
};
const requestBody = (request) => parseJson(first(request.payload_json, request.payloadJson, '{}'), 'payloadJson');
const loginBody = (request, bindings) => ({
  name: text(first(request.username, bindings.username)),
  password: text(first(request.password, bindings.password)),
});
const ensureLoginBody = (body) => {
  if (!body.name || !body.password) throw invalid('username and password are required');
  return body;
};

export const handlers = {
  'sangfor.af.v8_0_106.SangforAfService/Login': async (ctx) => {
    const bindings = merged(ctx);
    const request = reqOf(ctx);
    return callHttp({ bindings, method: 'POST', path: expandPath('/api/v1/namespaces/{namespace}/login', request), body: ensureLoginBody(loginBody(request, bindings)) });
  },
  'sangfor.af.v8_0_106.SangforAfService/KeepAlive': async (ctx) => {
    const bindings = merged(ctx);
    const request = reqOf(ctx);
    return callHttp({ bindings, method: 'GET', path: expandPath('/api/v1/namespaces/{namespace}/keepalive', request), headers: authHeaders(request, bindings) });
  },
  'sangfor.af.v8_0_106.SangforAfService/Logout': async (ctx) => {
    const bindings = merged(ctx);
    const request = reqOf(ctx);
    const token = requireToken(request, bindings);
    return callHttp({ bindings, method: 'POST', path: expandPath('/api/v1/namespaces/{namespace}/logout', request), headers: authHeaders(request, bindings), body: { loginResult: { token } } });
  },
  'sangfor.af.v8_0_106.SangforAfService/GetPasswordPolicy': async (ctx) => {
    const bindings = merged(ctx);
    const request = reqOf(ctx);
    return callHttp({ bindings, method: 'GET', path: expandPath('/api/v1/namespaces/{namespace}/password_policy', request), headers: authHeaders(request, bindings) });
  },
  
  
  
  
  
  
  'sangfor.af.v8_0_106.SangforAfService/AddIpGroup': async (ctx) => {
    const bindings = merged(ctx);
    const request = reqOf(ctx);
    const payload = requestBody(request);
    if (request.groupName) payload.name = request.groupName;
    return callHttp({ bindings, method: 'POST', path: '/api/batch/v1/namespaces/{namespace}/ipgroups'.replace('{namespace}', namespaceOf(request)), headers: authHeaders(request, bindings), body: payload });
  },
  'sangfor.af.v8_0_106.SangforAfService/DeleteIpGroup': async (ctx) => {
    const bindings = merged(ctx);
    const request = reqOf(ctx);
    const payload = requestBody(request);
    if (request.groupName) payload.name = request.groupName;
    return callHttp({ bindings, method: 'POST', path: '/api/batch/v1/namespaces/{namespace}/ipgroups?_method=delete'.replace('{namespace}', namespaceOf(request)), headers: authHeaders(request, bindings), body: payload });
  },
  
  
  'sangfor.af.v8_0_106.SangforAfService/GenericRequest': async (ctx) => {
    const bindings = merged(ctx);
    const request = reqOf(ctx);
    const method = text(request.method || 'GET').toUpperCase();
    const path = text(request.path);
    if (!path) throw invalid('path is required');
    return callHttp({ bindings, method, path, query: request.query, headers: request.token || bindings.token ? authHeaders(request, bindings) : {}, body: ['GET', 'DELETE'].includes(method) ? undefined : requestBody(request) });
  },
};
