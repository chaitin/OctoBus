const test = require('node:test');
const assert = require('node:assert/strict');

const { createFetchMock } = require('./mock_upstream.js');
const adapter = require('../src/hillstone-waf-v5-5-r12.js');
const { handlers, METHOD_LOGIN_FULL, METHOD_GET_LOGIN_STATUS_FULL, METHOD_LOGOUT_FULL, METHOD_LIST_WEBSITES_FULL, METHOD_CREATE_WEBSITE_FULL, METHOD_QUERY_WAF_POLICY_FULL, METHOD_QUERY_WAF_AC_POLICY_FULL, METHOD_LIST_BLOCKLIST_FULL, METHOD_GET_SYS_INFO_FULL, METHOD_LIST_VSYS_FULL, METHOD_GET_WEB_SECURITY_LOG_FULL } = adapter;
const { buildAuthHeaders, normalizeSession, validateLoginSource } = require('../src/auth.js');
const { send, mapPayload } = require('../src/client.js');
const { fromUpstream } = require('../src/errors.js');

function buildCtx(overrides = {}) {
  return {
    bindings: {
      host: '192.168.237.142',
      port: 443,
      protocol: 'https',
      timeoutMs: 5000,
      skipTlsVerify: true,
      lang: 'zh_CN',
      ...overrides.bindings,
    },
    secrets: {
      username: 'hillstone',
      password: 'Chaitin@123',
      ...overrides.secrets,
    },
    meta: {
      requestId: 'req-1',
      instanceId: 'inst-1',
      ...overrides.meta,
    },
  };
}

test('login sends base64 credentials to /rest/api/login', async () => {
  const fetch = createFetchMock();
  fetch.queueJson({ result: [{ token: 'token-1', fromrootvsys: 'true', vsysId: '0', role: 'admin', username: 'hillstone' }], success: true, total: 0 });

  const result = await handlers[METHOD_LOGIN_FULL]({}, buildCtx({ bindings: { fetch } }));

  fetch.assertCall(0, 'POST', '/rest/api/login');
  const body = JSON.parse(fetch.calls[0].init.body);
  assert.equal(body.username, 'aGlsbHN0b25l');
  assert.equal(body.password, 'Q2hhaXRpbkAxMjM=');
  assert.equal(result.success, true);
  assert.equal(result.result[0].token, 'token-1');
});

test('get login status probes /rest/api/login with auth headers', async () => {
  const fetch = createFetchMock();
  fetch.queueJson({ result: [{ token: 'token-1', fromrootvsys: 'true', vsysId: '0', role: 'admin', username: 'hillstone' }], success: true, total: 0 });
  fetch.queueJson({ success: true, result: [], exception: [] });

  const result = await handlers[METHOD_GET_LOGIN_STATUS_FULL]({}, buildCtx({ bindings: { fetch } }));

  fetch.assertCall(1, 'GET', '/rest/api/login');
  assert.equal(fetch.calls[1].init.headers['X-Auth-Token'], 'token-1');
  assert.equal(result.success, true);
});

test('logout sends delete to /rest/api/login', async () => {
  const fetch = createFetchMock();
  fetch.queueJson({ result: [{ token: 'token-1', fromrootvsys: 'true', vsysId: '0', role: 'admin', username: 'hillstone' }], success: true, total: 0 });
  fetch.queueJson({ success: true, result: [], exception: {} });

  const result = await handlers[METHOD_LOGOUT_FULL]({}, buildCtx({ bindings: { fetch } }));

  fetch.assertCall(1, 'DELETE', '/rest/api/login');
  assert.equal(result.success, true);
});

test('list websites auto logs in and queries /rest/api/website', async () => {
  const fetch = createFetchMock();
  fetch.queueJson({ result: [{ token: 'token-1', fromrootvsys: 'true', vsysId: '0', role: 'admin', username: 'hillstone' }], success: true, total: 0 });
  fetch.queueJson({ success: true, result: [{ name: 'site-a' }], total: 1 });

  const result = await handlers[METHOD_LIST_WEBSITES_FULL]({}, buildCtx({ bindings: { fetch } }));

  fetch.assertCall(1, 'GET', '/rest/api/website');
  assert.equal(fetch.calls[1].init.headers['X-Auth-Token'], 'token-1');
  assert.equal(result.result[0].name, 'site-a');
});

test('create website posts JSON body to /rest/api/website', async () => {
  const fetch = createFetchMock();
  fetch.queueJson({ result: [{ token: 'token-1', fromrootvsys: 'true', vsysId: '0', role: 'admin', username: 'hillstone' }], success: true, total: 0 }, 200, { 'set-cookie': 'PHPSESSID=sess-1; path=/; secure' });
  fetch.queueJson({ success: true, result: [{ id: '1', name: 'demo' }], total: 0 });

  await handlers[METHOD_CREATE_WEBSITE_FULL]({ website: { name: 'demo', domain: 'demo.local' } }, buildCtx({ bindings: { fetch } }));

  fetch.assertCall(1, 'POST', '/rest/api/website');
  const body = JSON.parse(fetch.calls[1].init.body);
  assert.equal(Array.isArray(body), true);
  assert.equal(body[0].name, 'demo');
  assert.equal(body[0].domain, 'demo.local');
  assert.match(fetch.calls[1].init.headers.Cookie, /PHPSESSID=sess-1/);
  assert.match(fetch.calls[1].init.headers.Cookie, /username=hillstone/);
  assert.match(fetch.calls[1].init.headers.Cookie, /token=token-1/);
});

test('query policy calls /rest/api/wafpolicy', async () => {
  const fetch = createFetchMock();
  fetch.queueJson({ result: [{ token: 'token-1', fromrootvsys: 'true', vsysId: '0', role: 'admin', username: 'hillstone' }], success: true, total: 0 });
  fetch.queueJson({ success: true, result: [{ policy: 'default' }], total: 1 });

  await handlers[METHOD_QUERY_WAF_POLICY_FULL]({}, buildCtx({ bindings: { fetch } }));
  fetch.assertCall(1, 'GET', '/rest/api/wafpolicy');
});

test('query access control policy calls /rest/api/wafacpolicy', async () => {
  const fetch = createFetchMock();
  fetch.queueJson({ result: [{ token: 'token-1', fromrootvsys: 'true', vsysId: '0', role: 'admin', username: 'hillstone' }], success: true, total: 0 });
  fetch.queueJson({ success: true, result: [{ policy: 'ac' }], total: 1 });

  await handlers[METHOD_QUERY_WAF_AC_POLICY_FULL]({}, buildCtx({ bindings: { fetch } }));
  fetch.assertCall(1, 'GET', '/rest/api/wafacpolicy');
});

test('list blocklist calls /rest/api/blocklist', async () => {
  const fetch = createFetchMock();
  fetch.queueJson({ result: [{ token: 'token-1', fromrootvsys: 'true', vsysId: '0', role: 'admin', username: 'hillstone' }], success: true, total: 0 });
  fetch.queueJson({ success: true, result: [{ ip: '1.1.1.1' }], total: 1 });

  await handlers[METHOD_LIST_BLOCKLIST_FULL]({}, buildCtx({ bindings: { fetch } }));
  fetch.assertCall(1, 'GET', '/rest/api/blocklist');
});

test('system info calls /rest/api/sysinfo', async () => {
  const fetch = createFetchMock();
  fetch.queueJson({ result: [{ token: 'token-1', fromrootvsys: 'true', vsysId: '0', role: 'admin', username: 'hillstone' }], success: true, total: 0 });
  fetch.queueJson({ success: true, result: [{ model: 'waf' }], total: 1 });

  await handlers[METHOD_GET_SYS_INFO_FULL]({}, buildCtx({ bindings: { fetch } }));
  fetch.assertCall(1, 'GET', '/rest/api/sysinfo');
});

test('list vsys calls /rest/api/vsys', async () => {
  const fetch = createFetchMock();
  fetch.queueJson({ result: [{ token: 'token-1', fromrootvsys: 'true', vsysId: '0', role: 'admin', username: 'hillstone' }], success: true, total: 0 });
  fetch.queueJson({ success: true, result: [{ id: '0', name: 'root' }], total: 1 });

  await handlers[METHOD_LIST_VSYS_FULL]({}, buildCtx({ bindings: { fetch } }));
  fetch.assertCall(1, 'GET', '/rest/api/vsys');
});

test('web security log calls /rest/api/websecuritylog', async () => {
  const fetch = createFetchMock();
  fetch.queueJson({ result: [{ token: 'token-1', fromrootvsys: 'true', vsysId: '0', role: 'admin', username: 'hillstone' }], success: true, total: 0 });
  fetch.queueJson({ success: true, result: [{ id: 'evt-1' }], total: 1 });

  await handlers[METHOD_GET_WEB_SECURITY_LOG_FULL]({}, buildCtx({ bindings: { fetch } }));
  fetch.assertCall(1, 'GET', '/rest/api/websecuritylog');
});


test('login disables TLS verification for native HTTPS requests when skipTlsVerify is enabled', async () => {
  const https = require('node:https');
  const { EventEmitter } = require('node:events');
  const originalRequest = https.request;
  const calls = [];

  https.request = (options, callback) => {
    calls.push(options);
    const response = new EventEmitter();
    response.statusCode = 200;
    response.headers = { 'content-type': 'application/json' };
    process.nextTick(() => {
      callback(response);
      response.emit('data', JSON.stringify({ result: [{ token: 'token-1', fromrootvsys: 'true', vsysId: '0', role: 'admin', username: 'hillstone' }], success: true, total: 0 }));
      response.emit('end');
    });

    return {
      write() {},
      end() {},
      on() { return this; },
      destroy() {},
    };
  };

  try {
    await handlers[METHOD_LOGIN_FULL]({}, buildCtx());
  } finally {
    https.request = originalRequest;
  }

  assert.equal(calls[0].rejectUnauthorized, false);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].path, '/rest/api/login');
});

test('invalid upstream JSON maps to grpc-like error', async () => {
  const fetch = createFetchMock();
  fetch.queueJson({ result: [{ token: 'token-1', fromrootvsys: 'true', vsysId: '0', role: 'admin', username: 'hillstone' }], success: true, total: 0 });
  fetch.queueHandler(() => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, text: async () => '{bad json' }));

  await assert.rejects(
    () => handlers[METHOD_GET_SYS_INFO_FULL]({}, buildCtx({ bindings: { fetch } })),
    /Invalid JSON response/,
  );
});

test('connect-style Struct input is unpacked into plain credentials', async () => {
  const fetch = createFetchMock();
  fetch.queueJson({ result: [{ token: 'token-1', fromrootvsys: 'true', vsysId: '0', role: 'admin', username: 'hillstone' }], success: true, total: 0 });

  const result = await handlers[METHOD_LOGIN_FULL]({
    fields: {
      username: { stringValue: 'hillstone' },
      password: { stringValue: 'Chaitin@123' },
    },
  }, buildCtx({ bindings: { fetch }, secrets: { username: '', password: '' } }));

  fetch.assertCall(0, 'POST', '/rest/api/login');
  const body = JSON.parse(fetch.calls[0].init.body);
  assert.equal(body.username, 'aGlsbHN0b25l');
  assert.equal(body.password, 'Q2hhaXRpbkAxMjM=');
  assert.equal(result.success, true);
});

test('protobuf-ts kind.case struct values are unpacked into plain credentials', async () => {
  const fetch = createFetchMock();
  fetch.queueJson({ result: [{ token: 'token-1', fromrootvsys: 'true', vsysId: '0', role: 'admin', username: 'hillstone' }], success: true, total: 0 });

  const result = await handlers[METHOD_LOGIN_FULL]({
    request: {
      fields: {
        username: { kind: { case: 'stringValue', value: 'hillstone' } },
        password: { kind: { case: 'stringValue', value: 'Chaitin@123' } },
      },
    },
    config: { fetch, host: '192.168.237.142', port: 443, protocol: 'https', timeoutMs: 5000, skipTlsVerify: true },
    secret: {},
  }, {});

  const body = JSON.parse(fetch.calls[0].init.body);
  assert.equal(body.username, 'aGlsbHN0b25l');
  assert.equal(body.password, 'Q2hhaXRpbkAxMjM=');
  assert.equal(result.success, true);
});

test('all public RPC handlers reach their documented upstream endpoint', async () => {
  const cases = [
    [adapter.METHOD_GET_WEBSITE_FULL, 'GET', '/rest/api/website', {}],
    [adapter.METHOD_UPDATE_WEBSITE_FULL, 'PUT', '/rest/api/website', { website: { id: '1' } }],
    [adapter.METHOD_DELETE_WEBSITE_FULL, 'DELETE', '/rest/api/website', { website: { id: '1' } }],
    [adapter.METHOD_UPDATE_WAF_POLICY_FULL, 'PUT', '/rest/api/wafpolicy', { policy: { id: '1' } }],
    [adapter.METHOD_UPDATE_WAF_AC_POLICY_FULL, 'PUT', '/rest/api/wafacpolicy', { policy: { id: '1' } }],
    [adapter.METHOD_LIST_ALLOWLIST_FULL, 'GET', '/rest/api/allowlist', {}],
    [adapter.METHOD_LIST_EXCEPTION_LIST_FULL, 'GET', '/rest/api/exceptionlist', {}],
  ];
  for (const [method, verb, path, request] of cases) {
    const fetch = createFetchMock();
    fetch.queueJson({ result: [{ token: 'token-1', username: 'hillstone' }], success: true });
    fetch.queueJson({ result: [], success: true });
    await handlers[method](request, buildCtx({ bindings: { fetch } }));
    fetch.assertCall(1, verb, path);
  }
});

test('handlers support the SDK 0.6 single-context ABI', async () => {
  const fetch = createFetchMock();
  fetch.queueJson({ result: [{ token: 'token-1', username: 'hillstone' }], success: true });
  fetch.queueJson({ result: [], success: true });
  const result = await handlers[METHOD_LIST_WEBSITES_FULL]({
    request: {},
    config: { host: 'waf.local', protocol: 'https', port: 443, fetch },
    secret: { username: 'hillstone', password: 'secret' },
  });
  assert.equal(result.success, true);
  fetch.assertCall(1, 'GET', '/rest/api/website');
});

test('cookie values are encoded and multiple Set-Cookie values preserve PHP session', async () => {
  const headers = buildAuthHeaders({ token: 'a;b=c', username: 'user;role=admin', phpSessionId: 's=x;y' });
  assert.match(headers.Cookie, /username=user%3Brole%3Dadmin/);
  assert.match(headers.Cookie, /token=a%3Bb%3Dc/);
  assert.match(headers.Cookie, /PHPSESSID=s%3Dx%3By/);

  const fetch = createFetchMock();
  fetch.queueHandler(() => ({
    status: 200, ok: true,
    headers: { get: () => ['theme=dark; Path=/', 'PHPSESSID=session-2; Secure'] },
    text: async () => JSON.stringify({ result: [{ token: 'token-2', username: 'hillstone' }], success: true }),
  }));
  const result = await handlers[METHOD_LOGIN_FULL]({}, buildCtx({ bindings: { fetch } }));
  assert.equal(result.result[0].phpSessionId, 'session-2');
});

test('validation rejects missing credentials and invalid endpoint configuration', async () => {
  assert.throws(() => validateLoginSource({}), /username is required/);
  assert.throws(() => validateLoginSource({ username: 'u' }), /password is required/);
  assert.doesNotThrow(() => validateLoginSource({ apiToken: 't' }));
  assert.throws(() => normalizeSession({ result: [] }), /valid token/);
  await assert.rejects(() => send({ bindings: {} }, 'GET', '/'), /host is required/);
  await assert.rejects(() => send({ bindings: { host: 'evil/path' } }, 'GET', '/'), /hostname or IP/);
  await assert.rejects(() => send({ bindings: { host: 'waf', protocol: 'ftp' } }, 'GET', '/'), /protocol/);
  await assert.rejects(() => send({ bindings: { host: 'waf', port: 70000 } }, 'GET', '/'), /port/);
  await assert.rejects(() => send({ bindings: { host: 'waf', timeoutMs: 0 } }, 'GET', '/'), /fetch failed|reach upstream|timed out/);
  await assert.rejects(() => send({ bindings: { host: 'waf', timeoutMs: 999999 } }, 'GET', '/'), /timeoutMs/);
});

test('HTTP, network, timeout, response size, and upstream errors are sanitized', async () => {
  const contextFor = (fetch) => buildCtx({ bindings: { fetch } });
  for (const [status, message] of [[401, /authentication failed/], [403, /authentication failed/], [400, /HTTP 400/], [503, /unavailable/]]) {
    const fetch = createFetchMock();
    fetch.queueJson({}, status);
    await assert.rejects(() => send(contextFor(fetch), 'GET', '/rest/api/sysinfo'), message);
  }
  for (const error of [Object.assign(new Error('secret endpoint'), { code: 'ECONNREFUSED' }), Object.assign(new Error('timeout'), { name: 'TimeoutError' })]) {
    const fetch = createFetchMock();
    fetch.queueError(error);
    await assert.rejects(() => send(contextFor(fetch), 'GET', '/rest/api/sysinfo'), (caught) => !caught.message.includes('secret endpoint'));
  }
  const hugeFetch = createFetchMock();
  hugeFetch.queueHandler(() => ({ status: 200, ok: true, headers: { get: () => null }, text: async () => 'x'.repeat(1024 * 1024 + 1) }));
  await assert.rejects(() => send(contextFor(hugeFetch), 'GET', '/rest/api/sysinfo'), /size limit/);

  const authFetch = createFetchMock();
  authFetch.queueJson({ exception: { code: 'token invalid', message: 'authentication failed' } });
  await assert.rejects(() => send(contextFor(authFetch), 'GET', '/rest/api/sysinfo'), /authentication failed/);
});

test('API token login sends only the configured token', async () => {
  const fetch = createFetchMock();
  fetch.queueJson({ token: 'session-token', username: 'api', success: true });
  const result = await handlers[METHOD_LOGIN_FULL]({}, buildCtx({ bindings: { fetch }, secrets: { username: '', password: '', apiToken: 'api-secret' } }));
  assert.deepEqual(JSON.parse(fetch.calls[0].init.body), { api_token: 'api-secret' });
  assert.equal(result.result[0].token, 'session-token');
});

test('payload conversion and session normalization cover protobuf shapes', () => {
  assert.deepEqual(mapPayload(null), {});
  assert.deepEqual(mapPayload({ payload: { fields: { x: { stringValue: 'y' } } } }), { x: 'y' });
  assert.deepEqual(mapPayload({ fields: {
    number: { numberValue: 2 }, bool: { boolValue: true }, nil: { nullValue: 0 },
    list: { listValue: { values: [{ stringValue: 'a' }] } },
    nested: { structValue: { fields: { x: { stringValue: 'y' } } } },
  } }), { number: 2, bool: true, nil: null, list: ['a'], nested: { x: 'y' } });
  assert.deepEqual(mapPayload({ fields: {
    number: { kind: { case: 'numberValue', value: 3 } },
    bool: { kind: { case: 'boolValue', value: false } },
    nil: { kind: { case: 'nullValue', value: null } },
    list: { kind: { case: 'listValue', value: { values: [{ kind: { case: 'stringValue', value: 'b' } }] } } },
    nested: { kind: { case: 'structValue', value: { fields: { x: { kind: { case: 'stringValue', value: 'z' } } } } } },
  } }), { number: 3, bool: false, nil: null, list: ['b'], nested: { x: 'z' } });
});

test('existing session skips login and upstream exception shapes map safely', async () => {
  const fetch = createFetchMock();
  fetch.queueJson({ success: true, result: [] });
  await handlers[METHOD_LIST_WEBSITES_FULL]({ token: 'existing', username: 'user' }, buildCtx({ bindings: { fetch } }));
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].init.headers['X-Auth-Token'], 'existing');
  assert.equal(fromUpstream({ exception: [] }), null);
  assert.equal(fromUpstream({ exception: {} }), null);
  assert.equal(fromUpstream({}), null);
  assert.match(fromUpstream({ exception: { code: 'unexpected' } }).message, /unexpected/);
});
