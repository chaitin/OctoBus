const test = require('node:test');
const assert = require('node:assert/strict');

const { createFetchMock } = require('./mock_upstream.js');
const { handlers, METHOD_LOGIN_FULL, METHOD_GET_LOGIN_STATUS_FULL, METHOD_LOGOUT_FULL, METHOD_LIST_WEBSITES_FULL, METHOD_CREATE_WEBSITE_FULL, METHOD_QUERY_WAF_POLICY_FULL, METHOD_QUERY_WAF_AC_POLICY_FULL, METHOD_LIST_BLOCKLIST_FULL, METHOD_GET_SYS_INFO_FULL, METHOD_LIST_VSYS_FULL, METHOD_GET_WEB_SECURITY_LOG_FULL } = require('../src/hillstone-waf-v5-5-r12.js');

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
