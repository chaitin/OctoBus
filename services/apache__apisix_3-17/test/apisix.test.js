import test from 'node:test';
import assert from 'node:assert/strict';

import {
  METHOD_DELETE_ROUTE_PATH,
  METHOD_GET_ROUTE_PATH,
  METHOD_LIST_ROUTES_PATH,
  METHOD_LIST_UPSTREAMS_PATH,
  METHOD_UPSERT_ROUTE_PATH,
  METHOD_UPSERT_UPSTREAM_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/apisix.js';
import { service } from '../src/service.js';

const buildCtx = (overrides = {}) => ({
  config: {
    baseUrl: 'http://localhost:9180',
    allowedIdPrefix: 'octobus-test-',
    timeoutMs: 10000,
    ...overrides.config,
  },
  secret: {
    adminApiKey: 'test-key',
    ...overrides.secret,
  },
  limits: {
    ...overrides.limits,
  },
  meta: {
    instance_id: 'inst',
    request_id: 'req',
    ...overrides.meta,
  },
});

const setFetch = (impl) => {
  global.fetch = impl;
};

test('service exports defineService result and handlers', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers['Apache_APISIX.Apache_APISIX/ListRoutes'], 'function');
});

test('helpers normalize config, secrets, and request values', () => {
  assert.deepEqual(_test.mergedBindings({
    config: { baseUrl: 'http://config', keep: 'yes' },
    secret: { adminApiKey: 'secret' },
    bindings: { baseUrl: 'http://binding' },
  }), {
    baseUrl: 'http://binding',
    keep: 'yes',
    adminApiKey: 'secret',
  });
  assert.equal(_test.normalizeBaseUrl('http://localhost:9180/'), 'http://localhost:9180');
  assert.equal(_test.normalizeBaseUrl('ftp://bad'), '');
  assert.equal(_test.toOptionalPositiveInt({ value: '2' }), 2);
  assert.equal(_test.toOptionalPositiveInt('0'), undefined);
  assert.equal(_test.toBool('false', true), false);
  assert.equal(_test.toBool(undefined, true), true);
  assert.equal(_test.resolveAdminApiKey({ admin_api_key: 'req-key' }, { adminApiKey: 'secret-key' }), 'req-key');
  assert.equal(_test.resolveAllowedIdPrefix({}), 'octobus-test-');
  assert.equal(_test.buildListPath('route', { page: 2, page_size: 10 }), '/apisix/admin/routes?page=2&page_size=10');
});

test('ListRoutes forwards APISIX Admin API request and maps list response', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({
        list: [
          {
            key: '/apisix/routes/octobus-test-route',
            value: { id: 'octobus-test-route', uri: '/octobus-test' },
          },
        ],
        total: 1,
      }),
    };
  });

  const result = await rpcdef(buildCtx())[METHOD_LIST_ROUTES_PATH]({ page: 1, page_size: 20 });

  assert.equal(captured.url, 'http://localhost:9180/apisix/admin/routes?page=1&page_size=20');
  assert.equal(captured.init.method, 'GET');
  assert.equal(captured.init.headers['X-API-KEY'], 'test-key');
  assert.equal(result.total, 1);
  assert.equal(result.items[0].id, 'octobus-test-route');
  assert.match(result.items[0].raw_json, /octobus-test-route/);
});

test('GetRoute maps one route response', async () => {
  setFetch(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify({
      key: '/apisix/routes/octobus-test-route',
      value: { id: 'octobus-test-route', uri: '/octobus-test' },
    }),
  }));

  const result = await rpcdef(buildCtx())[METHOD_GET_ROUTE_PATH]({ id: 'octobus-test-route' });

  assert.equal(result.id, 'octobus-test-route');
  assert.match(result.raw_json, /octobus-test/);
});

test('UpsertRoute sends native APISIX JSON body', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({
        key: '/apisix/routes/octobus-test-route',
        value: { id: 'octobus-test-route', uri: '/octobus-test' },
      }),
    };
  });

  const result = await rpcdef(buildCtx())[METHOD_UPSERT_ROUTE_PATH]({
    id: 'octobus-test-route',
    body_json: '{"uri":"/octobus-test","upstream_id":"octobus-test-upstream"}',
  });

  assert.equal(captured.url, 'http://localhost:9180/apisix/admin/routes/octobus-test-route');
  assert.equal(captured.init.method, 'PUT');
  assert.equal(captured.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(captured.init.body), {
    uri: '/octobus-test',
    upstream_id: 'octobus-test-upstream',
  });
  assert.equal(result.id, 'octobus-test-route');
});

test('UpsertUpstream maps upstream path and accepts request-level api key alias', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({
        key: '/apisix/upstreams/octobus-test-upstream',
        value: { id: 'octobus-test-upstream', nodes: { '127.0.0.1:18080': 1 } },
      }),
    };
  });

  const result = await rpcdef(buildCtx())[METHOD_UPSERT_UPSTREAM_PATH]({
    id: 'octobus-test-upstream',
    admin_api_key: 'request-key',
    body_json: '{"type":"roundrobin","nodes":{"127.0.0.1:18080":1}}',
  });

  assert.equal(captured.url, 'http://localhost:9180/apisix/admin/upstreams/octobus-test-upstream');
  assert.equal(captured.init.headers['X-API-KEY'], 'request-key');
  assert.equal(result.id, 'octobus-test-upstream');
});

test('DeleteRoute enforces allowedIdPrefix and maps delete response', async () => {
  const denied = rpcdef(buildCtx())[METHOD_DELETE_ROUTE_PATH]({ id: 'prod-route' });
  await assert.rejects(() => denied, /FAILED_PRECONDITION: write\/delete id must start with allowedIdPrefix/);

  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ deleted: '1' }),
    };
  });

  const result = await rpcdef(buildCtx())[METHOD_DELETE_ROUTE_PATH]({ id: 'octobus-test-route' });

  assert.equal(captured.url, 'http://localhost:9180/apisix/admin/routes/octobus-test-route');
  assert.equal(captured.init.method, 'DELETE');
  assert.equal(result.id, 'octobus-test-route');
  assert.equal(result.deleted, true);
});

test('ListUpstreams supports SDK handler call context', async () => {
  setFetch(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify({
      list: [
        {
          key: '/apisix/upstreams/octobus-test-upstream',
          value: { id: 'octobus-test-upstream' },
        },
      ],
      total: 1,
    }),
  }));

  const result = await handlers['Apache_APISIX.Apache_APISIX/ListUpstreams']({
    request: { page: 1 },
    ...buildCtx(),
  });

  assert.equal(result.items[0].id, 'octobus-test-upstream');
});

test('validation errors are raised before upstream calls', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ config: { baseUrl: 'ftp://bad' } }))[METHOD_LIST_ROUTES_PATH]({}),
    /FAILED_PRECONDITION: baseUrl is required/,
  );
  await assert.rejects(
    () => rpcdef(buildCtx({ secret: { adminApiKey: '' } }))[METHOD_LIST_ROUTES_PATH]({}),
    /INVALID_ARGUMENT: adminApiKey is required/,
  );
  await assert.rejects(
    () => rpcdef(buildCtx())[METHOD_GET_ROUTE_PATH]({ id: 'bad/id' }),
    /INVALID_ARGUMENT: id must not contain/,
  );
  await assert.rejects(
    () => rpcdef(buildCtx())[METHOD_UPSERT_ROUTE_PATH]({
      id: 'octobus-test-route',
      body_json: '[]',
    }),
    /INVALID_ARGUMENT: body_json must be a JSON object/,
  );
});

test('HTTP and JSON errors are mapped', async () => {
  setFetch(async () => ({
    ok: false,
    status: 403,
    statusText: 'Forbidden',
    text: async () => '{"error":"denied"}',
  }));
  await assert.rejects(
    () => rpcdef(buildCtx())[METHOD_LIST_ROUTES_PATH]({}),
    /PERMISSION_DENIED: upstream http 403/,
  );

  setFetch(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => 'not json',
  }));
  await assert.rejects(
    () => rpcdef(buildCtx())[METHOD_LIST_ROUTES_PATH]({}),
    /UNKNOWN: response is not valid JSON/,
  );
});
