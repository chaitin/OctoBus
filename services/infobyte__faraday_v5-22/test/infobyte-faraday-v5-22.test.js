import test from 'node:test';
import assert from 'node:assert/strict';

const listWorkspacesPath = '/InfobyteFaradayV522.Faraday/ListWorkspaces';
const createWorkspacePath = '/InfobyteFaradayV522.Faraday/CreateWorkspace';
const listHostsPath = '/InfobyteFaradayV522.Faraday/ListHosts';
const createHostPath = '/InfobyteFaradayV522.Faraday/CreateHost';
const listVulnsPath = '/InfobyteFaradayV522.Faraday/ListVulnerabilities';
const getVulnPath = '/InfobyteFaradayV522.Faraday/GetVulnerability';
const createVulnPath = '/InfobyteFaradayV522.Faraday/CreateVulnerability';

const buildCtx = (req = {}, overrides = {}) => ({
  bindings: {
    faraday_base_url: 'http://localhost:5985',
    faraday_username: 'faraday',
    faraday_password: 'secret',
    headers: { 'X-Test': 'yes' },
    ...overrides.bindings,
  },
  limits: { timeoutMs: 10_000, ...overrides.limits },
  meta: { instance_id: 'inst', request_id: 'req', ...overrides.meta },
  req,
});

const loadHandler = async (path, req, overrides = {}) => {
  const { rpcdef } = await import('../src/infobyte-faraday-v5-22.js');
  const ctx = buildCtx(req, overrides);
  return rpcdef(ctx)[path];
};

const setFetch = (impl) => {
  global.fetch = async (...args) => impl(...args);
};

test('helpers normalize bindings, protobuf values, query strings, and headers', async () => {
  const { _test } = await import('../src/infobyte-faraday-v5-22.js');

  assert.deepEqual(_test.mergedBindings({
    config: { faraday_base_url: 'http://config', keep: 'config' },
    secret: { faraday_username: 'user', faraday_password: 'pw' },
    bindings: { faraday_base_url: 'http://binding' },
  }), {
    faraday_base_url: 'http://binding',
    keep: 'config',
    faraday_username: 'user',
    faraday_password: 'pw',
  });
  assert.equal(_test.normalizeBaseUrl('http://localhost:5985/'), 'http://localhost:5985');
  assert.equal(_test.normalizeBaseUrl('ftp://bad'), '');
  assert.equal(_test.resolveBaseUrl({ baseUrl: 'http://base' }), 'http://base');
  assert.equal(_test.resolveUsername({ username: 'faraday' }), 'faraday');
  assert.equal(_test.resolvePassword({ password: ' pass with spaces ' }), ' pass with spaces ');
  assert.equal(_test.toOptionalInt({ value: '7' }, { min: 1 }), 7);
  assert.equal(_test.toOptionalBool({ value: 'false' }), false);
  assert.deepEqual(_test.parseHeaders('{"X-A":"1"}'), { 'X-A': '1' });
  assert.deepEqual(_test.parseHeaders('{'), {});
  assert.deepEqual(_test.protobufValueToPlain({
    structValue: {
      fields: {
        tags: { listValue: { values: [{ stringValue: 'octobus' }] } },
        score: { numberValue: 8.8 },
      },
    },
  }), { tags: ['octobus'], score: 8.8 });
  assert.equal(_test.protobufValueToPlain({ kind: { case: 'stringValue', value: 'octobus' } }), 'octobus');
  assert.deepEqual(_test.protobufValueToPlain({ 0: 'one', 1: 'two' }), ['one', 'two']);
  assert.equal(_test.encodeQueryPairs({ a: 'x y', empty: '', missing: undefined }), 'a=x%20y');
  assert.equal(_test.buildUrl('http://x/', '/_api/v3/ws', { histogram: true }), 'http://x/_api/v3/ws?histogram=true');
  assert.equal(_test.encodePathSegment('demo workspace'), 'demo%20workspace');
  assert.throws(() => _test.encodePathSegment('.'), /safe single path segment/);
  assert.throws(() => _test.encodePathSegment('..'), /safe single path segment/);
  assert.throws(() => _test.encodePathSegment('demo/hosts'), /safe single path segment/);
  assert.throws(() => _test.encodePathSegment('demo..hosts'), /safe single path segment/);
  assert.throws(
    () => _test.assertSupportedTlsConfig({ skipTlsVerify: true }),
    /skipTlsVerify is not supported/,
  );
  assert.deepEqual(_test.buildRequestHeaders(buildCtx()), {
    Accept: 'application/json',
    'X-Test': 'yes',
    Authorization: 'Basic ZmFyYWRheTpzZWNyZXQ=',
  });
});

test('ListWorkspaces forwards histogram query and maps array response', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      status: 200,
      text: async () => JSON.stringify([{ id: 1, name: 'octobus-demo' }]),
    };
  });

  const handler = await loadHandler(listWorkspacesPath, {
    histogram: { value: true },
    histogram_days: { value: 7 },
  });
  const res = await handler();

  assert.equal(captured.url, 'http://localhost:5985/_api/v3/ws?histogram=true&histogram_days=7');
  assert.equal(captured.init.method, 'GET');
  assert.equal(captured.init.headers.Authorization, 'Basic ZmFyYWRheTpzZWNyZXQ=');
  assert.equal(captured.init.headers['X-Test'], 'yes');
  assert.equal(Object.hasOwn(captured.init, 'timeoutMs'), false);
  assert.equal(Object.hasOwn(captured.init, 'skipTlsVerify'), false);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(res.count, 1);
  assert.equal(res.results[0].structValue.fields.name.stringValue, 'octobus-demo');
});

test('sdk handlers accept single call context with request, config, and secret', async () => {
  const { handlers } = await import('../src/infobyte-faraday-v5-22.js');
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      status: 200,
      text: async () => JSON.stringify([{ id: 2, name: 'sdk-ws' }]),
    };
  });

  const res = await handlers['InfobyteFaradayV522.Faraday/ListWorkspaces']({
    request: { histogram: false },
    config: { faraday_base_url: 'http://localhost:5985' },
    secret: { faraday_username: 'sdk', faraday_password: 'token' },
  });

  assert.equal(captured.url, 'http://localhost:5985/_api/v3/ws?histogram=false');
  assert.equal(captured.init.headers.Authorization, 'Basic c2RrOnRva2Vu');
  assert.equal(res.results[0].structValue.fields.name.stringValue, 'sdk-ws');
});

test('sdk handlers accept lowerCamelCase request fields from JSON transcoding', async () => {
  const { handlers } = await import('../src/infobyte-faraday-v5-22.js');
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init, body: init.body ? JSON.parse(init.body) : undefined };
    return {
      status: 201,
      text: async () => JSON.stringify({ id: 12, name: 'camel vuln' }),
    };
  });

  const res = await handlers['InfobyteFaradayV522.Faraday/CreateVulnerability']({
    request: {
      workspaceName: 'camel ws',
      name: 'camel vuln',
      severity: 'medium',
      type: 'Vulnerability',
      objectId: 12,
      parentType: 'Host',
      externalId: 'camel-001',
      statusCode: 418,
      extraFields: { fields: { parent: { numberValue: 1 } } },
    },
    config: { faraday_base_url: 'http://localhost:5985' },
    secret: { faraday_username: 'sdk', faraday_password: 'token' },
  });

  assert.equal(captured.url, 'http://localhost:5985/_api/v3/ws/camel%20ws/vulns');
  assert.equal(captured.body.parent, 1);
  assert.equal(captured.body.parent_type, 'Host');
  assert.equal(captured.body.external_id, 'camel-001');
  assert.equal(captured.body.status_code, 418);
  assert.equal(res.raw_json.structValue.fields.name.stringValue, 'camel vuln');
});

test('CreateWorkspace sends required and optional JSON body', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return {
      status: 201,
      text: async () => JSON.stringify({ id: 3, name: 'octobus-ws', active: true }),
    };
  });

  const handler = await loadHandler(createWorkspacePath, {
    name: 'octobus-ws',
    description: 'Created by OctoBus',
    customer: 'security',
    active: { value: true },
    public: false,
    importance: { value: 2 },
    extra_fields: {
      fields: {
        name: { stringValue: 'overridden-name' },
        readonly: { boolValue: false },
      },
    },
  });
  const res = await handler();

  assert.equal(captured.url, 'http://localhost:5985/_api/v3/ws');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['content-type'], 'application/json');
  assert.deepEqual(captured.body, {
    name: 'octobus-ws',
    readonly: false,
    description: 'Created by OctoBus',
    customer: 'security',
    active: true,
    public: false,
    importance: 2,
  });
  assert.equal(res.raw_json.structValue.fields.name.stringValue, 'octobus-ws');
});

test('ListHosts and CreateHost map workspace path and host body', async () => {
  let capturedUrl;
  setFetch(async (url) => {
    capturedUrl = url;
    return {
      status: 200,
      text: async () => JSON.stringify({ count: 1, rows: [{ id: 5, ip: '10.0.0.8' }] }),
    };
  });

  const listHandler = await loadHandler(listHostsPath, {
    workspace_name: 'octobus demo',
    stats: { value: false },
  });
  const listRes = await listHandler();

  assert.equal(capturedUrl, 'http://localhost:5985/_api/v3/ws/octobus%20demo/hosts?stats=false');
  assert.equal(listRes.count, 1);
  assert.equal(listRes.results[0].structValue.fields.ip.stringValue, '10.0.0.8');

  let captured;
  setFetch(async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return {
      status: 201,
      text: async () => JSON.stringify({ id: 6, ip: '10.0.0.9' }),
    };
  });

  const createHandler = await loadHandler(createHostPath, {
    workspace_name: 'octobus demo',
    ip: '10.0.0.9',
    description: 'OctoBus validation host',
    os: 'Linux',
    owned: '0',
    hostnames: { values: [{ stringValue: 'demo.local' }] },
    metadata: { fields: { source: { stringValue: 'octobus' } } },
  });
  const createRes = await createHandler();

  assert.equal(captured.url, 'http://localhost:5985/_api/v3/ws/octobus%20demo/hosts');
  assert.deepEqual(captured.body, {
    description: 'OctoBus validation host',
    ip: '10.0.0.9',
    os: 'Linux',
    owned: false,
    hostnames: ['demo.local'],
    metadata: { source: 'octobus' },
  });
  assert.equal(createRes.raw_json.structValue.fields.ip.stringValue, '10.0.0.9');
});

test('ListVulnerabilities, GetVulnerability, and CreateVulnerability map API calls', async () => {
  let capturedUrl;
  setFetch(async (url) => {
    capturedUrl = url;
    return {
      status: 200,
      text: async () => JSON.stringify({ vulnerabilities: [{ id: 10, name: 'SQL Injection' }], count: 1 }),
    };
  });

  const listHandler = await loadHandler(listVulnsPath, { workspace_name: 'octobus-ws' });
  const listRes = await listHandler();

  assert.equal(capturedUrl, 'http://localhost:5985/_api/v3/ws/octobus-ws/vulns');
  assert.equal(listRes.count, 1);
  assert.equal(listRes.results[0].structValue.fields.name.stringValue, 'SQL Injection');

  setFetch(async (url) => {
    capturedUrl = url;
    return {
      status: 200,
      text: async () => JSON.stringify({ id: 10, name: 'SQL Injection' }),
    };
  });

  const getHandler = await loadHandler(getVulnPath, { workspace_name: 'octobus-ws', object_id: 10 });
  const getRes = await getHandler();

  assert.equal(capturedUrl, 'http://localhost:5985/_api/v3/ws/octobus-ws/vulns/10');
  assert.equal(getRes.raw_json.structValue.fields.name.stringValue, 'SQL Injection');

  let captured;
  setFetch(async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return {
      status: 201,
      text: async () => JSON.stringify({ id: 11, name: 'OctoBus validation vuln' }),
    };
  });

  const createHandler = await loadHandler(createVulnPath, {
    workspace_name: 'octobus-ws',
    name: 'OctoBus validation vuln',
    severity: 'high',
    type: 'Vulnerability',
    desc: 'Created by OctoBus test',
    confirmed: true,
    cve: { values: [{ stringValue: 'CVE-2026-0001' }] },
    metadata: { fields: { source: { stringValue: 'octobus' } } },
    extra_fields: {
      fields: {
        name: { stringValue: 'overridden-vuln' },
        severity: { stringValue: 'low' },
        custom_field: { stringValue: 'kept' },
      },
    },
  });
  const createRes = await createHandler();

  assert.equal(captured.url, 'http://localhost:5985/_api/v3/ws/octobus-ws/vulns');
  assert.equal(captured.init.method, 'POST');
  assert.deepEqual(captured.body, {
    name: 'OctoBus validation vuln',
    severity: 'high',
    type: 'Vulnerability',
    custom_field: 'kept',
    desc: 'Created by OctoBus test',
    confirmed: true,
    cve: ['CVE-2026-0001'],
    metadata: { source: 'octobus' },
  });
  assert.equal(createRes.raw_json.structValue.fields.id.numberValue, 11);
});

test('validates required fields before downstream calls', async () => {
  const noBaseUrl = await loadHandler(listWorkspacesPath, {}, { bindings: { faraday_base_url: '' } });
  await assert.rejects(() => noBaseUrl(), /faraday_base_url is required/);

  const noUsername = await loadHandler(listWorkspacesPath, {}, { bindings: { faraday_username: '' } });
  await assert.rejects(() => noUsername(), /faraday_username is required/);

  const noPassword = await loadHandler(listWorkspacesPath, {}, { bindings: { faraday_password: '' } });
  await assert.rejects(() => noPassword(), /faraday_password is required/);

  const noWorkspaceName = await loadHandler(listHostsPath, {});
  await assert.rejects(() => noWorkspaceName(), /workspace_name is required/);

  const unsafeWorkspaceName = await loadHandler(listHostsPath, { workspace_name: '../hosts' });
  await assert.rejects(() => unsafeWorkspaceName(), /safe single path segment/);

  const badVulnId = await loadHandler(getVulnPath, { workspace_name: 'octobus-ws', object_id: 0 });
  await assert.rejects(() => badVulnId(), /object_id must be a positive integer/);

  const noHostDesc = await loadHandler(createHostPath, { workspace_name: 'octobus-ws' });
  await assert.rejects(() => noHostDesc(), /description is required/);

  const noVulnName = await loadHandler(createVulnPath, {
    workspace_name: 'octobus-ws',
    severity: 'high',
    type: 'Vulnerability',
  });
  await assert.rejects(() => noVulnName(), /name is required/);
});

test('errors cover upstream failures, HTTP errors, invalid JSON, and TLS skip', async () => {
  setFetch(async () => {
    throw new Error('connect failed');
  });
  const unavailable = await loadHandler(listWorkspacesPath, {});
  await assert.rejects(() => unavailable(), /faraday upstream request failed/);

  setFetch(async () => ({
    status: 403,
    text: async () => JSON.stringify({ message: 'forbidden' }),
  }));
  const forbidden = await loadHandler(listWorkspacesPath, {});
  await assert.rejects(() => forbidden(), /PERMISSION_DENIED|faraday upstream http failure/);

  setFetch(async () => ({
    status: 200,
    text: async () => 'not-json',
  }));
  const invalidJson = await loadHandler(listWorkspacesPath, {});
  await assert.rejects(() => invalidJson(), /response is not valid JSON/);

  const invalidTls = await loadHandler(listWorkspacesPath, {}, { bindings: { skipTlsVerify: true } });
  await assert.rejects(() => invalidTls(), /skipTlsVerify is not supported/);
});

test('applies upstream timeout through AbortController across response body reads', async () => {
  setFetch(async (url, init) => ({
    status: 200,
    text: async () => new Promise((resolve, reject) => {
      assert.ok(init.signal instanceof AbortSignal);
      init.signal.addEventListener('abort', () => reject(new Error('aborted by response timeout')), { once: true });
    }),
  }));

  const handler = await loadHandler(listWorkspacesPath, {}, { limits: { timeoutMs: 1 } });
  await assert.rejects(() => handler(), /aborted by response timeout/);
});
