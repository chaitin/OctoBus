import test from 'node:test';
import assert from 'node:assert/strict';

const method = (name) => `/API7_Enterprise_V3_10_2.API7_Enterprise_V3_10_2/${name}`;

const buildCtx = (req = {}, overrides = {}) => ({
  bindings: {
    api7_base_url: 'https://api7.example.test',
    api7_api_key: 'secret-key',
    gateway_group_id: 'gw-default',
    headers: { 'X-Test': 'yes' },
    ...overrides.bindings,
  },
  limits: { timeoutMs: 10_000, ...overrides.limits },
  meta: { instance_id: 'inst', request_id: 'req', ...overrides.meta },
  req,
});

const loadHandler = async (name, req, overrides = {}) => {
  const { rpcdef } = await import('../src/api7-enterprise-v3-10-2.js');
  const ctx = buildCtx(req, overrides);
  return rpcdef(ctx)[method(name)];
};

const setFetch = (impl) => {
  global.fetch = async (...args) => impl(...args);
};

const response = (status, body, headers = {}) => ({
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? headers[name] ?? null },
  text: async () => body,
});

test('helpers normalize bindings, auth, query strings, and TLS options', async () => {
  const { _test } = await import('../src/api7-enterprise-v3-10-2.js');

  assert.deepEqual(_test.mergedBindings({
    config: { api7_base_url: 'https://config', keep: 'config' },
    secret: { api7_api_key: 'secret' },
    bindings: { api7_base_url: 'https://binding' },
  }), {
    api7_base_url: 'https://binding',
    keep: 'config',
    api7_api_key: 'secret',
  });
  assert.equal(_test.normalizeBaseUrl('https://api7.example.test/'), 'https://api7.example.test');
  assert.equal(_test.resolveApiKey({ apiKey: 'abc' }), 'abc');
  assert.equal(_test.resolveDefaultGatewayGroupId({ gatewayGroupId: 'gw-1' }), 'gw-1');
  assert.deepEqual(_test.toStringArray(['a', ' b ']), ['a', 'b']);
  assert.deepEqual(_test.toStringMap({ env: 'prod', empty: '' }), { env: 'prod' });
  assert.equal(_test.encodeQueryPairs({ status: ['enabled', 'disabled'], labels: { env: 'prod' } }), 'status=enabled&status=disabled&labels%5Benv%5D=prod');
  assert.equal(_test.buildUrl('https://api7.example.test/', '/api/audit_logs', { page: 1 }), 'https://api7.example.test/api/audit_logs?page=1');
  assert.deepEqual(_test.buildRequestHeaders(buildCtx()), {
    Accept: 'application/json',
    'X-Test': 'yes',
    'X-API-KEY': 'secret-key',
  });
  assert.equal(_test.buildDispatcher({}), undefined);
  const dispatcher = _test.buildDispatcher({ skipTlsVerify: true });
  assert.ok(dispatcher);
  await dispatcher.close();
});

test('ListAuditLogs forwards filters and maps list results', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return response(200, JSON.stringify({ total: 1, list: [{ id: 'audit-1', event_type: 'route.update' }] }));
  });

  const handler = await loadHandler('ListAuditLogs', {
    event_type: 'route.update',
    operator_id: 'user-1',
    page_size: { value: 20 },
    page: { value: 2 },
  });
  const res = await handler();

  assert.equal(captured.url, 'https://api7.example.test/api/audit_logs?event_type=route.update&operator_id=user-1&page=2&page_size=20');
  assert.equal(captured.init.method, 'GET');
  assert.equal(captured.init.headers['X-API-KEY'], 'secret-key');
  assert.equal(res.count, 1);
  assert.equal(res.results[0].structValue.fields.id.stringValue, 'audit-1');
});

test('ListConsumers uses default gateway group binding when request omits it', async () => {
  let capturedUrl;
  setFetch(async (url) => {
    capturedUrl = url;
    return response(200, JSON.stringify({ total_size: 0, list: [] }));
  });

  const handler = await loadHandler('ListConsumers', { search: 'demo' });
  await handler();

  assert.equal(capturedUrl, 'https://api7.example.test/apisix/admin/consumers?gateway_group_id=gw-default&search=demo');
});

test('ListConsumerCredentials requires username and supports lowerCamelCase fields', async () => {
  const badHandler = await loadHandler('ListConsumerCredentials', {});
  await assert.rejects(() => badHandler(), /username is required/);

  let capturedUrl;
  setFetch(async (url) => {
    capturedUrl = url;
    return response(200, JSON.stringify({ count: 1, items: [{ id: 'cred-1' }] }));
  });

  const handler = await loadHandler('ListConsumerCredentials', {
    username: 'alice',
    pluginName: 'key-auth',
    gatewayGroupId: 'gw-1',
  });
  const res = await handler();

  assert.equal(capturedUrl, 'https://api7.example.test/apisix/admin/consumers/alice/credentials?gateway_group_id=gw-1&plugin_name=key-auth');
  assert.equal(res.results[0].structValue.fields.id.stringValue, 'cred-1');
});

test('ExportAuditLogs preserves content type and filename metadata', async () => {
  setFetch(async () => response(200, 'id,event\n1,route.update\n', {
    'content-type': 'text/csv',
    'content-disposition': 'attachment; filename="audit.csv"',
  }));

  const handler = await loadHandler('ExportAuditLogs', { format: 'csv' });
  const res = await handler();

  assert.equal(res.content_type, 'text/csv');
  assert.equal(res.filename, 'audit.csv');
  assert.match(res.raw_body, /route.update/);
});

test('GetPluginSchema builds path params and supports subsystem filter', async () => {
  let capturedUrl;
  setFetch(async (url) => {
    capturedUrl = url;
    return response(200, JSON.stringify({ properties: { key: { type: 'string' } } }));
  });

  const handler = await loadHandler('GetPluginSchema', { pluginName: 'key-auth', subsystem: 'http' });
  const res = await handler();

  assert.equal(capturedUrl, 'https://api7.example.test/apisix/admin/schema/plugins/key-auth?subsystem=http');
  assert.equal(res.raw_json.structValue.fields.properties.structValue.fields.key.structValue.fields.type.stringValue, 'string');
});

test('ParseCertificate and ValidateCertificateKey send JSON bodies', async () => {
  const captured = [];
  setFetch(async (url, init) => {
    captured.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    return response(200, JSON.stringify({ ok: true }));
  });

  const parseHandler = await loadHandler('ParseCertificate', { cert: '---CERT---' });
  await parseHandler();
  const validateHandler = await loadHandler('ValidateCertificateKey', { cert: '---CERT---', key: '---KEY---' });
  await validateHandler();

  assert.equal(captured[0].url, 'https://api7.example.test/api/parse_certificate');
  assert.equal(captured[0].init.method, 'PUT');
  assert.deepEqual(captured[0].body, { cert: '---CERT---' });
  assert.equal(captured[1].url, 'https://api7.example.test/api/validate_cert_key');
  assert.deepEqual(captured[1].body, { cert: '---CERT---', key: '---KEY---' });
});

test('service supports Basic Auth when API key is absent', async () => {
  let authHeader = '';
  setFetch(async (url, init) => {
    authHeader = init.headers.Authorization;
    return response(200, JSON.stringify([]));
  });

  const handler = await loadHandler('ListPlugins', {}, {
    bindings: {
      api7_base_url: 'https://api7.example.test',
      username: 'admin',
      password: 'pass',
      api7_api_key: '',
    },
  });
  await handler();

  assert.equal(authHeader, `Basic ${Buffer.from('admin:pass').toString('base64')}`);
});

test('GetServiceHealthcheck requires path parameters and forwards upstream_id', async () => {
  let capturedUrl;
  setFetch(async (url) => {
    capturedUrl = url;
    return response(200, JSON.stringify({ status: 'healthy' }));
  });

  const handler = await loadHandler('GetServiceHealthcheck', {
    gatewayGroupId: 'gw-1',
    apisixServiceId: 'svc-1',
    upstreamId: 'upstream-1',
  });
  const res = await handler();

  assert.equal(capturedUrl, 'https://api7.example.test/api/gateway_groups/gw-1/services/svc-1/healthcheck?upstream_id=upstream-1');
  assert.equal(res.raw_json.structValue.fields.status.stringValue, 'healthy');
});

test('ListRoutes now requires service_id', async () => {
  const handler = await loadHandler('ListRoutes', { gatewayGroupId: 'default' });
  await assert.rejects(() => handler(), /service_id is required/);
});

test('CreateToken sends POST body', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return response(200, JSON.stringify({ id: 'token-1', name: 'octobus-test-token' }));
  });

  const handler = await loadHandler('CreateToken', { name: 'octobus-test-token', expiresAt: 0 });
  const res = await handler();

  assert.equal(captured.url, 'https://api7.example.test/api/tokens');
  assert.equal(captured.init.method, 'POST');
  assert.deepEqual(captured.body, { name: 'octobus-test-token', expires_at: 0 });
  assert.equal(res.raw_json.structValue.fields.name.stringValue, 'octobus-test-token');
});

test('CreateConsumer uses default gateway group and sends labels/plugins', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return response(200, JSON.stringify({ id: 'consumer-1', username: 'octobus-user' }));
  });

  const handler = await loadHandler('CreateConsumer', {
    username: 'octobus-user',
    desc: 'test consumer',
    labels: { env: 'test' },
    plugins: { 'key-auth': {} },
  });
  await handler();

  assert.equal(captured.url, 'https://api7.example.test/apisix/admin/consumers?gateway_group_id=gw-default');
  assert.equal(captured.init.method, 'POST');
  assert.deepEqual(captured.body, {
    username: 'octobus-user',
    desc: 'test consumer',
    labels: { env: 'test' },
    plugins: { 'key-auth': {} },
  });
});


test('CreateService accepts camelCase upstreamNodes and sends upstream.nodes', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return response(200, JSON.stringify({ id: 'svc-1', name: 'octobus-svc' }));
  });

  const handler = await loadHandler('CreateService', {
    gatewayGroupId: 'default',
    name: 'octobus-svc',
    type: 'http',
    hosts: ['svc.example.test'],
    upstreamScheme: 'http',
    upstreamPassHost: 'pass',
    upstreamNodes: [{ host: '127.0.0.1', port: 8080, weight: 100 }],
  });
  await handler();

  assert.equal(captured.url, 'https://api7.example.test/apisix/admin/services?gateway_group_id=default');
  assert.equal(captured.init.method, 'POST');
  assert.deepEqual(captured.body, {
    name: 'octobus-svc',
    type: 'http',
    hosts: ['svc.example.test'],
    upstream: {
      scheme: 'http',
      pass_host: 'pass',
      nodes: [{ host: '127.0.0.1', port: 8080, weight: 100 }],
    },
  });
});

test('CreateRoute sends required service_id, name, and paths', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return response(200, JSON.stringify({ id: 'route-1', name: 'octobus-route' }));
  });

  const handler = await loadHandler('CreateRoute', {
    gatewayGroupId: 'default',
    serviceId: 'svc-1',
    name: 'octobus-route',
    paths: ['/octobus'],
    methods: ['GET'],
    priority: 10,
  });
  await handler();

  assert.equal(captured.url, 'https://api7.example.test/apisix/admin/routes?gateway_group_id=default');
  assert.equal(captured.init.method, 'POST');
  assert.deepEqual(captured.body, {
    service_id: 'svc-1',
    name: 'octobus-route',
    methods: ['GET'],
    paths: ['/octobus'],
    priority: 10,
  });
});
