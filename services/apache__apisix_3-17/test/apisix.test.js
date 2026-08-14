import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_RESPONSE_BYTES,
  METHOD_DELETE_UPSTREAM_PATH,
  METHOD_DELETE_ROUTE_PATH,
  METHOD_GET_UPSTREAM_PATH,
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
  assert.equal(_test.normalizeBaseUrl('https://example.test/admin/'), 'https://example.test/admin');
  assert.equal(_test.normalizeBaseUrl('http://user:password@example.test'), '');
  assert.equal(_test.normalizeBaseUrl('http://example.test/?page=1'), '');
  assert.equal(_test.normalizeBaseUrl('not a url'), '');
  assert.equal(_test.toOptionalPositiveInt(undefined), undefined);
  assert.equal(_test.toOptionalPositiveInt(-1), undefined);
  assert.equal(_test.toOptionalPositiveInt('not-a-number'), undefined);
  assert.equal(_test.toBool(true, false), true);
  assert.equal(_test.toBool(1, false), true);
  assert.equal(_test.toBool(0, true), false);
  assert.equal(_test.toBool('true', false), true);
  assert.equal(_test.toBool('nope', true), true);
  assert.equal(_test.responseContentLength({ headers: { get: () => 'bad' } }), undefined);
  assert.equal(_test.responseContentLength({ headers: { get: () => '42' } }), 42);
  assert.deepEqual(_test.normalizeListResponse({ data: { list: [{ key: '/apisix/routes/data-route' }] } }), {
    items: [{ id: 'data-route', raw_json: '{"key":"/apisix/routes/data-route"}' }],
    total: 1,
    raw_json: '{"data":{"list":[{"key":"/apisix/routes/data-route"}]}}',
  });
  assert.deepEqual(_test.normalizeListResponse([{ id: 'array-route' }]).items[0], {
    id: 'array-route', raw_json: '{"id":"array-route"}',
  });
  assert.equal(_test.normalizeResourceResponse({ node: { value: { id: 'node-route' } } }, 'fallback').id, 'node-route');
  assert.throws(() => _test.requireId({}), /id is required/);
  assert.throws(() => _test.parseBodyJson(''), /body_json is required/);
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

test('GetUpstream maps one upstream response', async () => {
  setFetch(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify({
      key: '/apisix/upstreams/octobus-test-upstream',
      value: { id: 'octobus-test-upstream', type: 'roundrobin' },
    }),
  }));

  const result = await rpcdef(buildCtx())[METHOD_GET_UPSTREAM_PATH]({ id: 'octobus-test-upstream' });

  assert.equal(result.id, 'octobus-test-upstream');
  assert.match(result.raw_json, /roundrobin/);
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
  await assert.rejects(() => denied, (error) => error.legacyCode === 'FAILED_PRECONDITION'
    && /write\/delete id must start with allowedIdPrefix/.test(error.message));

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

test('DeleteUpstream sends the APISIX upstream path', async () => {
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

  const result = await rpcdef(buildCtx())[METHOD_DELETE_UPSTREAM_PATH]({ id: 'octobus-test-upstream' });

  assert.equal(captured.url, 'http://localhost:9180/apisix/admin/upstreams/octobus-test-upstream');
  assert.equal(captured.init.method, 'DELETE');
  assert.equal(result.deleted, true);
});

test('ListUpstreams supports the SDK single context handler contract', async () => {
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
    (error) => error.legacyCode === 'FAILED_PRECONDITION' && /baseUrl is required/.test(error.message),
  );
  await assert.rejects(
    () => rpcdef(buildCtx({ secret: { adminApiKey: '' } }))[METHOD_LIST_ROUTES_PATH]({}),
    (error) => error.legacyCode === 'INVALID_ARGUMENT' && /adminApiKey is required/.test(error.message),
  );
  await assert.rejects(
    () => rpcdef(buildCtx())[METHOD_GET_ROUTE_PATH]({ id: 'bad/id' }),
    (error) => error.legacyCode === 'INVALID_ARGUMENT' && /single printable path segment/.test(error.message),
  );
  await assert.rejects(
    () => rpcdef(buildCtx())[METHOD_UPSERT_ROUTE_PATH]({
      id: 'octobus-test-route',
      body_json: '[]',
    }),
    (error) => error.legacyCode === 'INVALID_ARGUMENT' && /body_json must be a JSON object/.test(error.message),
  );
});

test('HTTP errors preserve status and redact sensitive upstream bodies', async () => {
  setFetch(async () => ({
    ok: false,
    status: 403,
    statusText: 'Forbidden',
    text: async () => '{"error":"denied","api_key":"must-not-leak"}',
  }));
  await assert.rejects(
    () => rpcdef(buildCtx())[METHOD_LIST_ROUTES_PATH]({}),
    (error) => error.legacyCode === 'PERMISSION_DENIED'
      && /upstream http 403 Forbidden/.test(error.message)
      && error.details.bodySnippet.includes('"api_key":"***"'),
  );
});

test('non-JSON successful responses and bounded responses return safe errors', async () => {
  setFetch(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => 'not json',
  }));
  await assert.rejects(
    () => rpcdef(buildCtx())[METHOD_LIST_ROUTES_PATH]({}),
    (error) => error.legacyCode === 'INTERNAL' && /upstream response is not valid JSON/.test(error.message),
  );

  setFetch(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => String(MAX_RESPONSE_BYTES + 1) },
    text: async () => '{"unreachable":true}',
  }));
  await assert.rejects(
    () => rpcdef(buildCtx())[METHOD_LIST_ROUTES_PATH]({}),
    (error) => error.legacyCode === 'RESOURCE_EXHAUSTED' && /upstream response exceeds/.test(error.message),
  );
});

test('fetch setup uses a timeout, rejects redirects, and honors explicit TLS policy', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '{"list":[],"total":0}',
    };
  });
  await rpcdef(buildCtx({ config: { timeoutMs: 25, tlsRejectUnauthorized: false } }))[METHOD_LIST_ROUTES_PATH]({});

  assert.equal(captured.init.redirect, 'error');
  assert.equal(captured.init.headers['X-API-KEY'], 'test-key');
});

test('invalid URLs, response streams, and transport failures are mapped safely', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ config: { baseUrl: 'http://key:secret@localhost:9180' } }))[METHOD_LIST_ROUTES_PATH]({}),
    (error) => error.legacyCode === 'FAILED_PRECONDITION' && /baseUrl is required/.test(error.message),
  );

  const chunks = [new TextEncoder().encode('{"list":[],'), new TextEncoder().encode('"total":0}')];
  setFetch(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    body: {
      getReader: () => ({
        read: async () => chunks.length ? { done: false, value: chunks.shift() } : { done: true },
        cancel: async () => {},
      }),
    },
  }));
  const result = await rpcdef(buildCtx())[METHOD_LIST_ROUTES_PATH]({});
  assert.equal(result.total, 0);

  await assert.rejects(
    () => _test.readBoundedResponseText({ body: { getReader: () => ({
      read: async () => ({ done: false, value: new Uint8Array(MAX_RESPONSE_BYTES + 1) }),
      cancel: async () => {},
    }) } }),
    (error) => error.legacyCode === 'RESOURCE_EXHAUSTED',
  );
  await assert.rejects(
    () => _test.readBoundedResponseText({ body: { getReader: () => ({ read: async () => { throw new Error('token=must-not-leak'); } }) } }),
    (error) => error.legacyCode === 'UNAVAILABLE' && !error.message.includes('must-not-leak'),
  );

  setFetch(async () => { throw new Error('request failed with api_key=must-not-leak'); });
  await assert.rejects(
    () => rpcdef(buildCtx())[METHOD_LIST_ROUTES_PATH]({}),
    (error) => error.legacyCode === 'UNAVAILABLE' && !error.message.includes('must-not-leak'),
  );
});
