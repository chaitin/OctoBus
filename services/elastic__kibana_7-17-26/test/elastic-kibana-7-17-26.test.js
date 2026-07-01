import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_CALL_KIBANA_API_PATH,
  METHOD_CALL_KIBANA_API_FULL,
  METHOD_CHECK_STATUS_FULL,
  METHOD_CHECK_STATUS_PATH,
  METHOD_FIND_RULES_FULL,
  METHOD_FIND_SAVED_OBJECTS_FULL,
  METHOD_LIST_DASHBOARDS_FULL,
  _test,
  handlers,
  rpcdef,
} from '../src/elastic-kibana-7-17-26.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;

const response = (status, body) => ({
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const setFetch = (impl) => {
  globalThis.fetch = impl;
};

const buildCtx = (overrides = {}) => ({
  config: {
    endpoint: 'http://kibana.local:8443',
    ...(overrides.config || {}),
  },
  secret: {
    username: 'elastic',
    password: 'secret',
    ...(overrides.secret || {}),
  },
  bindings: {
    ...(overrides.bindings || {}),
  },
  limits: { timeoutMs: 10_000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const expectGrpcError = async (fn, legacyCode, checker = () => {}) => {
  let caught;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'expected function to reject');
  assert.ok(caught instanceof GrpcError);
  assert.equal(caught.legacyCode, legacyCode);
  assert.equal(caught.code, ({
    FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
    INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
    PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
    UNKNOWN: grpcStatus.UNKNOWN,
  })[legacyCode]);
  checker(caught);
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('service exports handlers and rpcdef path', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers[METHOD_CHECK_STATUS_FULL], 'function');
  assert.equal(typeof rpcdef(buildCtx())[METHOD_CHECK_STATUS_PATH], 'function');
});

test('CheckStatus calls /api/status with basic auth', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, { version: { number: '7.17.26' }, status: { overall: { state: 'green' } } });
  });

  const result = await handlers[METHOD_CHECK_STATUS_FULL]({}, buildCtx({ bindings: { headers: { 'X-Test': '1' } } }));

  assert.equal(captured.url, 'http://kibana.local:8443/api/status');
  assert.equal(captured.init.method, 'GET');
  assert.equal(Object.hasOwn(captured.init, 'timeoutMs'), false);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.init.headers.Accept, 'application/json');
  assert.equal(captured.init.headers['kbn-xsrf'], 'octobus');
  assert.equal(captured.init.headers['kbn-version'], '7.17.26');
  assert.equal(captured.init.headers['X-Test'], '1');
  assert.equal(captured.init.headers.Authorization, `Basic ${Buffer.from('elastic:secret').toString('base64')}`);
  assert.equal(result.http_status, 200);
  assert.equal(result.http_body, '');
});

test('handlers accept SDK runtime context shape', async () => {
  setFetch(async () => response(200, { ok: true }));
  const result = await handlers[METHOD_CHECK_STATUS_FULL](buildCtx());
  assert.equal(result.http_status, 200);
  assert.equal(result.http_body, '');
});

test('CallKibanaAPI supports generic GET query and response headers', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, { ok: true });
  });

  const result = await handlers[METHOD_CALL_KIBANA_API_FULL](
    {
      method: 'get',
      path: '/api/saved_objects/_find',
      query: { type: 'index-pattern', per_page: '2' },
      headers: { 'X-Trace': 'octobus' },
    },
    buildCtx(),
  );

  const url = new URL(captured.url);
  assert.equal(`${url.origin}${url.pathname}`, 'http://kibana.local:8443/api/saved_objects/_find');
  assert.equal(url.searchParams.get('type'), 'index-pattern');
  assert.equal(url.searchParams.get('per_page'), '2');
  assert.equal(captured.init.method, 'GET');
  assert.equal(captured.init.headers['X-Trace'], 'octobus');
  assert.equal(captured.init.body, undefined);
  assert.equal(result.http_status, 200);
  assert.equal(result.http_body, '');
  assert.deepEqual(JSON.parse(result.response_headers_json), { 'content-type': 'application/json' });
});

test('CallKibanaAPI supports generic POST body, content type, and space prefix', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, { created: true });
  });

  await handlers[METHOD_CALL_KIBANA_API_FULL](
    {
      method: 'POST',
      path: '/api/saved_objects/index-pattern',
      body: '{"attributes":{"title":"logs-*"}}',
      spaceId: 'default',
    },
    buildCtx(),
  );

  const url = new URL(captured.url);
  assert.equal(`${url.origin}${url.pathname}`, 'http://kibana.local:8443/s/default/api/saved_objects/index-pattern');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['Content-Type'], 'application/json');
  assert.equal(captured.init.body, '{"attributes":{"title":"logs-*"}}');
});

test('CallKibanaAPI write path accepts single SDK ctx and keeps credentials out of errors', async () => {
  const secret = 'kibana-secret-password';
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(500, {
      message: `upstream failed with ${secret}`,
      token: 'raw-upstream-token',
    });
  });

  await expectGrpcError(
    () => handlers[METHOD_CALL_KIBANA_API_FULL]({
      request: {
        method: 'POST',
        path: '/api/saved_objects/index-pattern',
        body: '{"attributes":{"title":"logs-*"}}',
      },
      config: {
        endpoint: 'http://kibana.local:8443',
        spaceId: 'default',
      },
      secret: {
        username: 'elastic',
        password: secret,
      },
    }),
    'UNAVAILABLE',
    (err) => {
      assert.equal(captured.url, 'http://kibana.local:8443/s/default/api/saved_objects/index-pattern');
      assert.equal(captured.init.method, 'POST');
      assert.equal(captured.init.body, '{"attributes":{"title":"logs-*"}}');
      assert.equal(captured.init.headers.Authorization, `Basic ${Buffer.from(`elastic:${secret}`).toString('base64')}`);
      assert.equal(err.response.http_body, '');
      assert.ok(err.response.http_body_length > 0);
      assert.doesNotMatch(JSON.stringify(err), /kibana-secret-password|raw-upstream-token/);
    },
  );
});

test('CallKibanaAPI supports rpcdef, HEAD, and content type override', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return {
      status: 204,
      headers: null,
      text: async () => {
        throw new Error('HEAD response body should not be read');
      },
    };
  });

  const result = await rpcdef(buildCtx())[METHOD_CALL_KIBANA_API_PATH]({
    method: 'HEAD',
    path: '/api/status?pretty=true',
    query: { human: 'true' },
    headers: { 'Content-Type': 'text/plain' },
    body: '{"ignored":true}',
  });

  assert.equal(captured.url, 'http://kibana.local:8443/api/status?pretty=true&human=true');
  assert.equal(captured.init.method, 'HEAD');
  assert.equal(captured.init.headers['Content-Type'], 'text/plain');
  assert.equal(captured.init.body, undefined);
  assert.equal(result.http_status, 204);
  assert.equal(result.http_body, '');
  assert.equal(result.response_headers_json, '{}');
});

test('CallKibanaAPI supports PUT, PATCH, DELETE, and kbn-version overrides', async () => {
  const calls = [];
  setFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    return response(200, { ok: true });
  });

  const ctx = buildCtx({
    config: { kbnVersion: '7.17.26' },
    bindings: { headers: { 'kbn-version': 'from-config-headers' } },
  });
  await handlers[METHOD_CALL_KIBANA_API_FULL]({ method: 'PUT', path: '/api/test/put', body: '{"a":1}' }, ctx);
  await handlers[METHOD_CALL_KIBANA_API_FULL]({ method: 'PATCH', path: '/api/test/patch', body: '{"b":2}', headers: { 'kbn-version': 'request-override' } }, ctx);
  await handlers[METHOD_CALL_KIBANA_API_FULL]({ method: 'DELETE', path: '/api/test/delete' }, ctx);

  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(calls[0].init.headers['kbn-version'], 'from-config-headers');
  assert.equal(calls[0].init.body, '{"a":1}');
  assert.equal(calls[1].init.method, 'PATCH');
  assert.equal(calls[1].init.headers['kbn-version'], 'request-override');
  assert.equal(calls[1].init.body, '{"b":2}');
  assert.equal(calls[2].init.method, 'DELETE');
  assert.equal(calls[2].init.body, undefined);
});

test('CallKibanaAPI validates method and path', async () => {
  await expectGrpcError(
    () => handlers[METHOD_CALL_KIBANA_API_FULL]({ method: 'TRACE', path: '/api/status' }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /unsupported method/),
  );
  await expectGrpcError(
    () => handlers[METHOD_CALL_KIBANA_API_FULL]({ method: 'GET', path: 'https://evil.example/api/status' }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /relative path/),
  );
  await expectGrpcError(
    () => handlers[METHOD_CALL_KIBANA_API_FULL]({ method: 'GET', path: '//api/status' }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /relative path/),
  );
  await expectGrpcError(
    () => handlers[METHOD_CALL_KIBANA_API_FULL]({ method: 'GET', path: '' }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /path is required/),
  );
});

test('FindSavedObjects validates type and builds query with space', async () => {
  await expectGrpcError(
    () => handlers[METHOD_FIND_SAVED_OBJECTS_FULL]({}, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /type is required/),
  );

  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, { page: 2, per_page: 5, total: 0, saved_objects: [] });
  });

  const result = await handlers[METHOD_FIND_SAVED_OBJECTS_FULL](
    { type: { value: ' dashboard ' }, search: 'ops', page: 2, per_page: 5, space_id: 'engineering' },
    buildCtx(),
  );

  const url = new URL(captured.url);
  assert.equal(`${url.origin}${url.pathname}`, 'http://kibana.local:8443/s/engineering/api/saved_objects/_find');
  assert.equal(url.searchParams.get('type'), 'dashboard');
  assert.equal(url.searchParams.get('search'), 'ops');
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('per_page'), '5');
  assert.equal(result.http_status, 200);
  assert.equal(captured.init.headers.Authorization, `Basic ${Buffer.from('elastic:secret').toString('base64')}`);
});

test('ListDashboards and FindRules use expected endpoints and API key auth', async () => {
  const urls = [];
  setFetch(async (url, init) => {
    urls.push({ url: String(url), init });
    return response(200, { ok: true });
  });

  const ctx = buildCtx({
    config: { endpoint: undefined, baseUrl: ' https://kibana.example/ ', spaceId: 'default' },
    secret: { username: undefined, password: undefined, apiKey: 'api-key-value' },
  });
  await handlers[METHOD_LIST_DASHBOARDS_FULL]({ search: 'security', page: 0, per_page: 1000 }, ctx);
  await handlers[METHOD_FIND_RULES_FULL]({ search: 'cpu', perPage: 3, spaceId: 'custom' }, ctx);

  const dashboardUrl = new URL(urls[0].url);
  assert.equal(`${dashboardUrl.origin}${dashboardUrl.pathname}`, 'https://kibana.example/s/default/api/saved_objects/_find');
  assert.equal(dashboardUrl.searchParams.get('type'), 'dashboard');
  assert.equal(dashboardUrl.searchParams.get('page'), '1');
  assert.equal(dashboardUrl.searchParams.get('per_page'), '100');
  assert.equal(urls[0].init.headers.Authorization, 'ApiKey api-key-value');

  const rulesUrl = new URL(urls[1].url);
  assert.equal(`${rulesUrl.origin}${rulesUrl.pathname}`, 'https://kibana.example/s/custom/api/alerting/rules/_find');
  assert.equal(rulesUrl.searchParams.get('search'), 'cpu');
  assert.equal(rulesUrl.searchParams.get('per_page'), '3');
});

test('maps HTTP and network failures with response details', async () => {
  for (const [status, legacyCode] of [[401, 'PERMISSION_DENIED'], [403, 'PERMISSION_DENIED'], [400, 'FAILED_PRECONDITION'], [404, 'FAILED_PRECONDITION'], [500, 'UNAVAILABLE']]) {
    setFetch(async () => response(status, { statusCode: status, message: `status ${status}` }));
    await expectGrpcError(
      () => handlers[METHOD_CHECK_STATUS_FULL]({}, buildCtx()),
      legacyCode,
      (err) => {
        assert.equal(err.response.http_status, status);
        assert.equal(err.response.http_body, '');
        assert.ok(err.response.http_body_length > 0);
      },
    );
  }

  setFetch(async () => {
    throw Object.assign(new Error('network error'), { cause: new Error('connection refused') });
  });
  await expectGrpcError(
    () => handlers[METHOD_CHECK_STATUS_FULL]({}, buildCtx()),
    'UNAVAILABLE',
    (err) => {
      assert.equal(err.response.http_status, 0);
      assert.equal(err.response.http_body, '');
      assert.ok(err.response.http_body_length > 0);
    },
  );

  setFetch(async () => ({
    status: 200,
    text: async () => {
      throw new Error('read failed');
    },
  }));
  await expectGrpcError(
    () => handlers[METHOD_CHECK_STATUS_FULL]({}, buildCtx()),
    'UNAVAILABLE',
    (err) => {
      assert.equal(err.response.http_status, 0);
      assert.equal(err.response.http_body, '');
      assert.ok(err.response.http_body_length > 0);
    },
  );
});

test('helpers cover aliases and tls options', async () => {
  assert.equal(_test.grpcCodeFor('NOPE'), grpcStatus.UNKNOWN);
  assert.equal(_test.errorWithCode('NOPE', 'bad').code, grpcStatus.UNKNOWN);
  assert.equal(_test.hasOwn(null, 'x'), false);
  assert.equal(_test.firstDefined(undefined, null, 0, 'x'), 0);
  assert.equal(_test.unwrapScalar({ value: { value: 'nested' } }), 'nested');
  assert.equal(_test.toTrimmedString(null), '');
  assert.equal(_test.normalizeBaseUrl('ftp://bad'), '');
  assert.equal(_test.normalizeBaseUrl(' http://kibana/// '), 'http://kibana');
  assert.equal(_test.resolveEndpoint({ restBaseUrl: 'http://rest.local/' }), 'http://rest.local');
  assert.equal(_test.resolveUsername({ user: { value: ' elastic ' } }), 'elastic');
  assert.equal(_test.resolvePassword({ password: { value: ' pass ' } }), 'pass');
  assert.equal(_test.resolveApiKey({ api_key: 'key' }), 'key');
  assert.equal(_test.resolveKbnVersion({}), '7.17.26');
  assert.equal(_test.resolveKbnVersion({ kbn_version: '7.17.25' }), '7.17.25');
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeoutMs: 15 } }), 15);
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeoutMs: -1 } }), 1500);
  assert.deepEqual(await _test.buildTlsOptions({}), {});
  const tlsOptions = await _test.buildTlsOptions({ skipTlsVerify: true });
  assert.ok(tlsOptions.dispatcher);
  assert.equal(Object.hasOwn(tlsOptions, 'skipTlsVerify'), false);
  assert.equal(_test.encodeQueryPairs({ a: 'x y', b: '', c: null, d: 0 }), 'a=x%20y&d=0');
  assert.equal(_test.appendQuery('http://kibana/api/status?x=1', { a: 'b' }), 'http://kibana/api/status?x=1&a=b');
  assert.equal(_test.buildApiUrl('http://kibana', '/api/status'), 'http://kibana/api/status');
  assert.equal(_test.buildApiUrl('http://kibana', '/api/status', { a: 'b' }, 'my space'), 'http://kibana/s/my%20space/api/status?a=b');
  assert.equal(_test.normalizeHttpMethod('post'), 'POST');
  assert.equal(_test.normalizeApiPath('/api/status'), '/api/status');
  assert.deepEqual(_test.normalizeStringMap({ a: ' b ', empty: '', nested: { value: 'x' } }), { a: 'b', nested: 'x' });
  assert.deepEqual(_test.normalizeStringMap(['bad']), {});
  assert.deepEqual(JSON.parse(_test.responseHeadersToJSON(new Headers({ a: 'b' }))), { a: 'b' });
  assert.equal(_test.responseHeadersToJSON(null), '{}');
  assert.equal(_test.normalizePositiveInt('bad', 7), 7);
  assert.equal(_test.normalizePositiveInt(101, 7), 100);
  assert.deepEqual(_test.resolveCallContext({ request: { x: 1 } }).req, { x: 1 });
  assert.deepEqual(_test.mergedBindings({ config: { a: 1 }, secret: { b: 2 }, bindings: { a: 3 } }), { a: 3, b: 2 });
  assert.equal(_test.mapHttpStatusToCode(401), 'PERMISSION_DENIED');
  assert.equal(_test.mapHttpStatusToCode(404), 'FAILED_PRECONDITION');
  assert.equal(_test.mapHttpStatusToCode(500), 'UNAVAILABLE');
  assert.equal(_test.isRuntimeContext({ config: {} }), true);
  assert.equal(_test.isRuntimeContext({}), false);
});
