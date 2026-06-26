import crypto from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';

// Generate an RSA key pair for mocking the WAF public-key endpoint
const { publicKey: TEST_RSA_PUBLIC_KEY } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
});

const setFetch = (impl) => { global.fetch = impl; };

const buildCtx = (overrides = {}) => ({
  config: { host: 'http://localhost:18081', verify_ssl: false, ...overrides.config },
  secret: { username: 'admin', password: 'Test@1234', ...overrides.secret },
  request: {},
  ...overrides,
});

// Reset module-level client cache before each test group
const resetClient = async () => {
  const { _test } = await import('../src/waf.js');
  _test.resetClient();
};

// Helpers to build mock fetch responses
const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
  json: async () => body,
});

const successResponse = (data) => jsonResponse({ code: 'SUCCESS', message: '', data });

// Sequence-based mock fetch: each call consumes the next response from the list
const sequenceFetch = (responses) => {
  let idx = 0;
  return async (_url, _init) => {
    if (idx >= responses.length) throw new Error(`unexpected fetch call #${idx + 1}`);
    return responses[idx++];
  };
};

// Full login flow: public key -> login -> actual request
const loginSequence = (actualResponses) => [
  successResponse(TEST_RSA_PUBLIC_KEY),
  successResponse({ token: 'test-jwt-token', expires_in: 3600 }),
  ...actualResponses,
];

// ---------------------------------------------------------------------------
// Helper / unit tests
// ---------------------------------------------------------------------------

test('errorWithCode maps known and unknown codes', async () => {
  const { _test } = await import('../src/waf.js');
  const err = _test.errorWithCode('INVALID_ARGUMENT', 'test message');
  assert.match(err.message, /INVALID_ARGUMENT: test message/);
  assert.equal(err.legacyCode, 'INVALID_ARGUMENT');

  const unknown = _test.errorWithCode('SOME_NEW_CODE', 'x');
  assert.equal(unknown.legacyCode, 'SOME_NEW_CODE');
});

test('wafRuleToProto maps WAF API rule to proto format', async () => {
  const { _test } = await import('../src/waf.js');
  const raw = {
    _pk: 'r-1',
    name: 'Block',
    description: 'desc',
    enable: false,
    effect_time_range: '2024-01-01 00:00:00,2024-12-31 23:59:59',
    cond_suites: [{ cond_terms: [{ field: 'sip', operand: ['1.1.1.1'], neg: true }] }],
    adapt_new_app: 'custom',
    apps: ['site-1'],
  };
  const proto = _test.wafRuleToProto(raw);
  assert.equal(proto.id, 'r-1');
  assert.equal(proto.name, 'Block');
  assert.equal(proto.enabled, false);
  assert.equal(proto.conditionGroups[0].conditions[0].negate, true);
  assert.deepEqual(proto.conditionGroups[0].conditions[0].ipList, ['1.1.1.1']);
  assert.equal(proto.applyTo, 'custom');
  assert.deepEqual(proto.siteIds, ['site-1']);
});

test('protoToWafBody maps proto request to WAF body', async () => {
  const { _test } = await import('../src/waf.js');
  const req = {
    name: 'Test Rule',
    description: 'desc',
    conditionGroups: [{ conditions: [{ field: 'sip', ipList: ['2.2.2.2'], negate: false }] }],
    applyTo: 'all_apps',
    siteIds: [],
    enabled: true,
  };
  const body = _test.protoToWafBody(req, 'deny');
  assert.equal(body.name, 'Test Rule');
  assert.equal(body.cond_suites[0].cond_terms[0].operand[0], '2.2.2.2');
  assert.deepEqual(body.action, { name: 'deny' });
  assert.equal(body.enable, true);
});

test('protoToWafBody throws INVALID_ARGUMENT for empty conditionGroups', async () => {
  const { _test } = await import('../src/waf.js');
  assert.throws(
    () => _test.protoToWafBody({ name: 'rule', conditionGroups: [] }, 'deny'),
    /INVALID_ARGUMENT/,
  );
});

// ---------------------------------------------------------------------------
// getClient validation
// ---------------------------------------------------------------------------

test('getClient throws when config.host missing', async () => {
  await resetClient();
  const { _test } = await import('../src/waf.js');
  const ctx = buildCtx({ config: { host: '', verify_ssl: false } });
  assert.throws(() => _test.getClient(ctx), /INVALID_ARGUMENT: config.host is required/);
});

test('getClient throws when secret.username missing', async () => {
  await resetClient();
  const { _test } = await import('../src/waf.js');
  const ctx = buildCtx({ secret: { username: '', password: 'pw' } });
  assert.throws(() => _test.getClient(ctx), /INVALID_ARGUMENT: secret.username is required/);
});

test('getClient throws when secret.password missing', async () => {
  await resetClient();
  const { _test } = await import('../src/waf.js');
  const ctx = buildCtx({ secret: { username: 'admin', password: '' } });
  assert.throws(() => _test.getClient(ctx), /INVALID_ARGUMENT: secret.password is required/);
});

// ---------------------------------------------------------------------------
// WafClient login flow
// ---------------------------------------------------------------------------

test('WafClient login: public key error throws UNAUTHENTICATED', async () => {
  await resetClient();
  const { _test } = await import('../src/waf.js');
  setFetch(async () => jsonResponse({ code: 'INTERNAL_ERROR', message: 'key unavailable', data: null }));
  const client = new _test.WafClient({ host: 'http://localhost', username: 'u', password: 'p' });
  await assert.rejects(() => client.login(), /UNAUTHENTICATED: public key fetch failed/);
});

test('WafClient login: bad credentials throws UNAUTHENTICATED', async () => {
  await resetClient();
  const { _test } = await import('../src/waf.js');
  setFetch(sequenceFetch([
    successResponse(TEST_RSA_PUBLIC_KEY),
    jsonResponse({ code: 'USERNAME_PASSWD_ERROR', message: 'invalid credentials', data: null }),
  ]));
  const client = new _test.WafClient({ host: 'http://localhost', username: 'bad', password: 'bad' });
  await assert.rejects(() => client.login(), /UNAUTHENTICATED: login failed/);
});

test('WafClient re-authenticates on GENERAL_TOKEN_INVALID', async () => {
  await resetClient();
  const { _test } = await import('../src/waf.js');
  let calls = 0;
  setFetch(async (url) => {
    calls++;
    if (url.includes('public_key')) return successResponse(TEST_RSA_PUBLIC_KEY);
    if (url.includes('login')) return successResponse({ token: `token-${calls}` });
    // First call: token expired; second call: success
    if (calls === 4) return jsonResponse({ code: 'GENERAL_TOKEN_INVALID', message: 'expired', data: null });
    return jsonResponse({ code: 'SUCCESS', message: '', data: { count: 0, page: 1, per_page: 20, result: [] } });
  });
  const client = new _test.WafClient({ host: 'http://localhost', username: 'u', password: 'p' });
  // Trigger a request that gets token-expired, should re-login and retry
  await client.fetch('GET', '/api/v1/security/basic_rules/?');
});

test('WafClient maps network error to UNAVAILABLE', async () => {
  await resetClient();
  const { _test } = await import('../src/waf.js');
  setFetch(async () => { throw Object.assign(new Error('boom'), { cause: new Error('ECONNREFUSED') }); });
  const client = new _test.WafClient({ host: 'http://localhost', username: 'u', password: 'p' });
  client.token = 'already-logged-in';
  await assert.rejects(() => client.fetch('GET', '/api/v1/security/basic_rules/'), /UNAVAILABLE: ECONNREFUSED/);
});

test('WafClient maps non-JSON response to UNKNOWN', async () => {
  await resetClient();
  const { _test } = await import('../src/waf.js');
  setFetch(async () => ({ ok: true, status: 200, text: async () => 'not json' }));
  const client = new _test.WafClient({ host: 'http://localhost', username: 'u', password: 'p' });
  client.token = 'already-logged-in';
  await assert.rejects(() => client.fetch('GET', '/any/'), /UNKNOWN: non-JSON response/);
});

test('WafClient maps HTTP 401 to PERMISSION_DENIED', async () => {
  await resetClient();
  const { _test } = await import('../src/waf.js');
  setFetch(async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ code: 'UNAUTH', message: 'denied', data: null }) }));
  const client = new _test.WafClient({ host: 'http://localhost', username: 'u', password: 'p' });
  client.token = 'already-logged-in';
  await assert.rejects(() => client.fetch('GET', '/any/'), /PERMISSION_DENIED: HTTP 401/);
});

// ---------------------------------------------------------------------------
// ListBlockRules handler
// ---------------------------------------------------------------------------

test('ListBlockRules returns paginated results after login', async () => {
  await resetClient();
  const { handlers } = await import('../src/waf.js');
  setFetch(sequenceFetch([
    ...loginSequence([
      successResponse({
        count: 1, page: 1, per_page: 20,
        result: [{
          _pk: 'r-001', name: 'Block 1.2.3.4', description: '', enable: true,
          effect_time_range: '', cond_suites: [], adapt_new_app: 'all_apps', apps: [],
        }],
      }),
    ]),
  ]));

  const ctx = buildCtx({ request: { page: 1, perPage: 20, nameFilter: '' } });
  const res = await handlers['mingyu_waf.v1.WafService/ListBlockRules'](ctx);
  assert.equal(res.total, 1);
  assert.equal(res.rules[0].id, 'r-001');
  assert.equal(res.rules[0].name, 'Block 1.2.3.4');
});

test('ListBlockRules propagates WAF error code', async () => {
  await resetClient();
  const { handlers } = await import('../src/waf.js');
  setFetch(sequenceFetch([
    ...loginSequence([
      jsonResponse({ code: 'QUERY_ERROR', message: 'db error', data: null }),
    ]),
  ]));
  const ctx = buildCtx({ request: {} });
  await assert.rejects(
    () => handlers['mingyu_waf.v1.WafService/ListBlockRules'](ctx),
    /UNKNOWN: WAF error: db error/,
  );
});

// ---------------------------------------------------------------------------
// CreateBlockRule handler
// ---------------------------------------------------------------------------

test('CreateBlockRule posts body with action=deny', async () => {
  await resetClient();
  const { handlers } = await import('../src/waf.js');
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    if (url.includes('public_key')) return successResponse(TEST_RSA_PUBLIC_KEY);
    if (url.includes('login')) return successResponse({ token: 'tok' });
    return successResponse({ _pk: 'r-new', name: 'Block scanners', enable: true });
  });

  const ctx = buildCtx({
    request: {
      name: 'Block scanners',
      conditionGroups: [{ conditions: [{ field: 'sip', ipList: ['10.0.0.1'], negate: false }] }],
      applyTo: 'all_apps',
      enabled: true,
    },
  });
  const res = await handlers['mingyu_waf.v1.WafService/CreateBlockRule'](ctx);
  assert.equal(res.id, 'r-new');
  assert.equal(res.name, 'Block scanners');
  const body = JSON.parse(captured.init.body);
  assert.deepEqual(body.action, { name: 'deny' });
  assert.equal(body.cond_suites[0].cond_terms[0].operand[0], '10.0.0.1');
});

test('CreateBlockRule throws when conditionGroups is empty', async () => {
  await resetClient();
  const { handlers } = await import('../src/waf.js');
  setFetch(sequenceFetch(loginSequence([])));
  const ctx = buildCtx({ request: { name: 'test', conditionGroups: [] } });
  await assert.rejects(
    () => handlers['mingyu_waf.v1.WafService/CreateBlockRule'](ctx),
    /INVALID_ARGUMENT/,
  );
});

// ---------------------------------------------------------------------------
// UpdateBlockRule handler
// ---------------------------------------------------------------------------

test('UpdateBlockRule requires id', async () => {
  await resetClient();
  const { handlers } = await import('../src/waf.js');
  setFetch(sequenceFetch(loginSequence([])));
  const ctx = buildCtx({ request: { name: 'test', conditionGroups: [{ conditions: [{ field: 'sip', ipList: ['1.1.1.1'], negate: false }] }] } });
  await assert.rejects(
    () => handlers['mingyu_waf.v1.WafService/UpdateBlockRule'](ctx),
    /INVALID_ARGUMENT: id is required/,
  );
});

test('UpdateBlockRule sends PUT request', async () => {
  await resetClient();
  const { handlers } = await import('../src/waf.js');
  let capturedMethod;
  setFetch(async (url, init) => {
    capturedMethod = init.method;
    if (url.includes('public_key')) return successResponse(TEST_RSA_PUBLIC_KEY);
    if (url.includes('login')) return successResponse({ token: 'tok' });
    return successResponse({ _pk: 'r-001', name: 'updated', enable: true });
  });

  const ctx = buildCtx({
    request: {
      id: 'r-001',
      name: 'updated',
      conditionGroups: [{ conditions: [{ field: 'sip', ipList: ['1.1.1.1'], negate: false }] }],
      applyTo: 'all_apps',
      enabled: true,
    },
  });
  const res = await handlers['mingyu_waf.v1.WafService/UpdateBlockRule'](ctx);
  assert.equal(res.id, 'r-001');
  assert.equal(capturedMethod, 'PUT');
});

// ---------------------------------------------------------------------------
// DeleteBlockRule handler
// ---------------------------------------------------------------------------

test('DeleteBlockRule requires id', async () => {
  await resetClient();
  const { handlers } = await import('../src/waf.js');
  setFetch(sequenceFetch(loginSequence([])));
  const ctx = buildCtx({ request: {} });
  await assert.rejects(
    () => handlers['mingyu_waf.v1.WafService/DeleteBlockRule'](ctx),
    /INVALID_ARGUMENT: id is required/,
  );
});

test('DeleteBlockRule sends DELETE request and returns success', async () => {
  await resetClient();
  const { handlers } = await import('../src/waf.js');
  let capturedMethod;
  setFetch(async (url, init) => {
    capturedMethod = init.method;
    if (url.includes('public_key')) return successResponse(TEST_RSA_PUBLIC_KEY);
    if (url.includes('login')) return successResponse({ token: 'tok' });
    return successResponse(null);
  });
  const ctx = buildCtx({ request: { id: 'r-001' } });
  const res = await handlers['mingyu_waf.v1.WafService/DeleteBlockRule'](ctx);
  assert.equal(res.success, true);
  assert.equal(capturedMethod, 'DELETE');
});

// ---------------------------------------------------------------------------
// CreateAllowRule handler (control rules)
// ---------------------------------------------------------------------------

test('CreateAllowRule posts body with action=allow', async () => {
  await resetClient();
  const { handlers } = await import('../src/waf.js');
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    if (url.includes('public_key')) return successResponse(TEST_RSA_PUBLIC_KEY);
    if (url.includes('login')) return successResponse({ token: 'tok' });
    return successResponse({ _pk: 'r-allow-1', name: 'Allow HQ', enable: true });
  });

  const ctx = buildCtx({
    request: {
      name: 'Allow HQ',
      conditionGroups: [{ conditions: [{ field: 'sip', ipList: ['192.168.1.0/24'], negate: false }] }],
      applyTo: 'all_apps',
      enabled: true,
    },
  });
  const res = await handlers['mingyu_waf.v1.WafService/CreateAllowRule'](ctx);
  assert.equal(res.id, 'r-allow-1');
  const body = JSON.parse(captured.init.body);
  assert.deepEqual(body.action, { name: 'allow' });
  assert.ok(captured.url.includes('control_rules'));
});

// ---------------------------------------------------------------------------
// ListSites handler
// ---------------------------------------------------------------------------

test('ListSites returns site list', async () => {
  await resetClient();
  const { handlers } = await import('../src/waf.js');
  setFetch(sequenceFetch([
    ...loginSequence([
      successResponse({
        count: 1, page: 1, per_page: 20,
        result: [{ _pk: 'site-001', name: 'main', type: 'reverse', enable: true }],
      }),
    ]),
  ]));
  const ctx = buildCtx({ request: {} });
  const res = await handlers['mingyu_waf.v1.WafService/ListSites'](ctx);
  assert.equal(res.total, 1);
  assert.equal(res.sites[0].id, 'site-001');
  assert.equal(res.sites[0].type, 'reverse');
  assert.equal(res.sites[0].enabled, true);
});

// ---------------------------------------------------------------------------
// SSL skip option is forwarded in fetch init
// ---------------------------------------------------------------------------

test('verify_ssl=false passes tlsInsecureSkipVerify to fetch', async () => {
  await resetClient();
  const { _test } = await import('../src/waf.js');
  let capturedInit;
  setFetch(async (_url, init) => {
    capturedInit = init;
    return successResponse(TEST_RSA_PUBLIC_KEY);
  });
  const client = new _test.WafClient({ host: 'http://localhost', username: 'u', password: 'p', verifySsl: false });
  try { await client.login(); } catch { /* expected: login response won't match */ }
  assert.equal(capturedInit?.tlsInsecureSkipVerify, true);
});

test('verify_ssl=true does not pass tlsInsecureSkipVerify', async () => {
  await resetClient();
  const { _test } = await import('../src/waf.js');
  let capturedInit;
  setFetch(async (_url, init) => {
    capturedInit = init;
    return successResponse(TEST_RSA_PUBLIC_KEY);
  });
  const client = new _test.WafClient({ host: 'https://waf', username: 'u', password: 'p', verifySsl: true });
  try { await client.login(); } catch { /* expected */ }
  assert.ok(!capturedInit?.tlsInsecureSkipVerify);
});
