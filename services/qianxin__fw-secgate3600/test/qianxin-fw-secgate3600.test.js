import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  LOGOUT_PATH,
  LOGIN_PATH,
  METHOD_LOGIN_FULL,
  METHOD_LOGOUT_FULL,
  METHOD_UPDATE_FULL,
  UPDATE_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/qianxin-fw-secgate3600.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;
let instanceSeq = 0;

const nextInstanceId = () => `inst-${++instanceSeq}`;

const buildCtx = (overrides = {}) => ({
  bindings: {
    host: 'https://203.0.113.10:8443',
    ...(overrides.bindings || {}),
  },
  config: overrides.config || {},
  secret: { user: 'api_user', password: 'SuperSecret!', ...(overrides.secret || {}) },
  limits: { timeoutMs: 10_000, ...(overrides.limits || {}) },
  meta: { instance_id: overrides.instance_id || nextInstanceId(), request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const callHandler = (method, request = {}, ctx = {}) => {
  const handler = handlers[method];
  return handler({ ...ctx, request });
};

const createHeaders = (entries = {}) => {
  const map = new Map();
  for (const [key, value] of Object.entries(entries)) {
    const normalizedKey = String(key).toLowerCase();
    const values = Array.isArray(value) ? value.map(String) : [String(value)];
    map.set(normalizedKey, values);
  }
  return {
    get(name) {
      const values = map.get(String(name).toLowerCase());
      return values?.length ? values.join(', ') : null;
    },
    getSetCookie() {
      return map.get('set-cookie') || [];
    },
    forEach(callback) {
      for (const [key, values] of map.entries()) {
        for (const value of values) callback(value, key);
      }
    },
  };
};

const response = (status, body, headers = {}) => ({
  status,
  headers: createHeaders(headers),
  text: async () => body,
});

const loginSuccessPayload = {
  success: true,
  result: { error_code: 'success', token: 'token-123' },
};

const buildUpdateRequest = (overrides = {}) => ({
  host: 'https://203.0.113.10:8443',
  entries: [
    {
      head: {
        module: 'obj_address',
        function: 'set_obj_addr_conf',
        ...(overrides.head || {}),
      },
      body: {
        obj_addr: [
          {
            name: 'Block_IP_1',
            oldname: 'Block_IP_1',
            desc: 'ip block',
            include: [
              { ip: '203.0.113.10', addr_type: 'host' },
              { ip: '203.0.113.11', addr_type: 'host' },
            ],
            exclude: [],
            ...(overrides.group || {}),
          },
        ],
      },
    },
  ],
});

const setFetch = (impl) => {
  globalThis.fetch = impl;
};

const expectGrpcError = async (fn, legacyCode, checker = () => {}) => {
  let caught;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, 'expected function to reject');
  assert.ok(caught instanceof GrpcError);
  assert.equal(caught.legacyCode, legacyCode);
  assert.equal(caught.code, ({
    FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
    INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
    UNKNOWN: grpcStatus.UNKNOWN,
  })[legacyCode]);
  assert.match(caught.message, new RegExp(`^${legacyCode}:`));
  checker(caught);
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  _test.sessionCache.clear();
});

test('service exports defineService result and handlers', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers[METHOD_LOGIN_FULL], 'function');
  assert.equal(typeof handlers[METHOD_UPDATE_FULL], 'function');
  assert.equal(typeof handlers[METHOD_LOGOUT_FULL], 'function');
});

test('Login sends secret credentials and caches cookie for later calls', async () => {
  const instanceId = nextInstanceId();
  let loginCaptured;
  let updateCaptured;
  setFetch(async (url, init) => {
    if (String(url).endsWith('/v1.0/login')) {
      loginCaptured = { url: String(url), init };
      return response(200, JSON.stringify(loginSuccessPayload), {
        'set-cookie': ['JSESSIONID=abc; Path=/', 'lang=zh-cn; Path=/'],
      });
    }
    updateCaptured = { url: String(url), init };
    return response(200, JSON.stringify({ head: { error_code: 0 }, body: { ok: true } }), {
      'content-type': 'application/json',
    });
  });

  const loginRes = await rpcdef(buildCtx({
    instance_id: instanceId,
    req: { username: 'ignored-user', password: 'ignored-password' },
    bindings: { headers: { 'X-Extra': 'demo' }, skipTlsVerify: true },
  }))[LOGIN_PATH]();

  assert.equal(loginCaptured.url, 'https://203.0.113.10:8443/v1.0/login');
  assert.equal(loginCaptured.init.method, 'POST');
  assert.ok(loginCaptured.init.signal instanceof AbortSignal);
  assert.equal('timeoutMs' in loginCaptured.init, false);
  assert.ok(loginCaptured.init.dispatcher);
  assert.equal('insecureSkipVerify' in loginCaptured.init, false);
  assert.equal(loginCaptured.init.headers['Content-Type'], 'application/json');
  assert.equal(loginCaptured.init.headers['X-Extra'], 'demo');
  assert.deepEqual(JSON.parse(loginCaptured.init.body), { username: 'api_user', password: 'SuperSecret!' });
  assert.equal(loginRes.success, true);
  assert.equal(loginRes.result.error_code, 'success');
  assert.equal(loginRes.result.token, '');
  assert.equal(loginRes.http_status, 200);
  assert.equal(loginRes.raw_body, '');
  assert.equal(loginRes.raw_json, undefined);
  assert.deepEqual(loginRes.headers, []);

  await rpcdef(buildCtx({ instance_id: instanceId, req: buildUpdateRequest() }))[UPDATE_PATH]();

  assert.equal(updateCaptured.url, 'https://203.0.113.10:8443/v1.0/rest/');
  assert.equal(updateCaptured.init.method, 'POST');
  assert.match(updateCaptured.init.headers.Cookie, /JSESSIONID=abc/);
  assert.match(updateCaptured.init.headers.Cookie, /lang=zh-cn/);
  assert.match(updateCaptured.init.headers.Cookie, /token=token-123/);
});

test('Login validates host, username, password, and malformed schema', async () => {
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { host: 'https://203.0.113.10' } }))[LOGIN_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /host is required/),
  );
  await expectGrpcError(
    () => rpcdef(buildCtx({ secret: { user: '', username: '', password: 'pw' } }))[LOGIN_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /username is required/),
  );
  await expectGrpcError(
    () => rpcdef(buildCtx({ secret: { password: '' } }))[LOGIN_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /password is required/),
  );

  setFetch(async () => response(200, JSON.stringify({ success: true, result: [] })));
  await expectGrpcError(() => rpcdef(buildCtx())[LOGIN_PATH](), 'UNKNOWN', (err) => assert.match(err.message, /login response schema is invalid/));
});

test('UpdateAddressGroup requires session and validates entries', async () => {
  await expectGrpcError(() => rpcdef(buildCtx({ req: buildUpdateRequest() }))[UPDATE_PATH](), 'FAILED_PRECONDITION');
  _test.setSession(buildCtx({ instance_id: 'manual' }), 'https://203.0.113.10:8443', { token: 't', cookie: 'token=t', username: 'u' });

  await expectGrpcError(
    () => rpcdef(buildCtx({ instance_id: 'manual', req: { host: 'https://203.0.113.10:8443' } }))[UPDATE_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /entries must be a non-empty array/),
  );
  await expectGrpcError(
    () => rpcdef(buildCtx({ instance_id: 'manual', req: buildUpdateRequest({ head: { module: 'bad' } }) }))[UPDATE_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /head\.module must be obj_address/),
  );
  await expectGrpcError(
    () => rpcdef(buildCtx({ instance_id: 'manual', req: buildUpdateRequest({ head: { function: 'bad' } }) }))[UPDATE_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /head\.function must be set_obj_addr_conf/),
  );
  await expectGrpcError(
    () => rpcdef(buildCtx({ instance_id: 'manual', req: buildUpdateRequest({ group: { include: [{ ip: '1.1.1.1', addr_type: 'range' }] } }) }))[UPDATE_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /addr_type must be host/),
  );
});

test('UpdateAddressGroup defaults oldname and addr_type when omitted', async () => {
  const instanceId = nextInstanceId();
  let updateCaptured;
  let calls = 0;
  setFetch(async (url, init) => {
    calls += 1;
    if (calls === 1) {
      return response(200, JSON.stringify(loginSuccessPayload), { 'set-cookie': ['SID=abc; Path=/'] });
    }
    updateCaptured = { url: String(url), init };
    return response(200, JSON.stringify({ head: { error_code: 0 }, body: {} }));
  });

  await rpcdef(buildCtx({ instance_id: instanceId, req: { host: 'https://203.0.113.10:8443', username: 'api_user', password: 'SuperSecret!' } }))[LOGIN_PATH]();
  await rpcdef(buildCtx({
    instance_id: instanceId,
    req: {
      host: 'https://203.0.113.10:8443',
      entries: [
        {
          head: {},
          body: { obj_addr: [{ name: 'Block_IP_2', include: [{ ip: '203.0.113.99' }] }] },
        },
      ],
    },
  }))[UPDATE_PATH]();

  assert.deepEqual(JSON.parse(updateCaptured.init.body), [
    {
      head: { module: 'obj_address', function: 'set_obj_addr_conf' },
      body: {
        obj_addr: [
          {
            name: 'Block_IP_2',
            oldname: 'Block_IP_2',
            include: [{ ip: '203.0.113.99', addr_type: 'host' }],
            exclude: [],
          },
        ],
      },
    },
  ]);
});

test('UpdateAddressGroup keeps gRPC OK for upstream error JSON and clears session on 401', async () => {
  const instanceId = nextInstanceId();
  let calls = 0;
  setFetch(async () => {
    calls += 1;
    if (calls === 1) return response(200, JSON.stringify(loginSuccessPayload), { 'set-cookie': ['SID=abc; Path=/'] });
    return response(401, JSON.stringify({ head: { error_code: 4010, message: 'expired' }, body: {} }));
  });

  await rpcdef(buildCtx({ instance_id: instanceId }))[LOGIN_PATH]();
  const res = await rpcdef(buildCtx({ instance_id: instanceId, req: buildUpdateRequest() }))[UPDATE_PATH]();

  assert.equal(res.http_status, 401);
  assert.equal(res.head.error_code, 4010);
  assert.equal(res.head.message, 'expired');
  await expectGrpcError(() => rpcdef(buildCtx({ instance_id: instanceId, req: { host: 'https://203.0.113.10:8443' } }))[LOGOUT_PATH](), 'FAILED_PRECONDITION');

  let step = 0;
  setFetch(async () => {
    step += 1;
    if (step === 1) return response(200, JSON.stringify(loginSuccessPayload), { 'set-cookie': ['SID=abc; Path=/'] });
    return response(500, JSON.stringify({ head: { error_code: 5001, error_message: 'failed' }, body: { retry: false } }));
  });
  await rpcdef(buildCtx({ instance_id: 'http-500' }))[LOGIN_PATH]();
  const failure = await rpcdef(buildCtx({ instance_id: 'http-500', req: buildUpdateRequest() }))[UPDATE_PATH]();
  assert.equal(failure.http_status, 500);
  assert.equal(failure.head.error_code, 5001);
  assert.equal(failure.head.message, 'failed');
});

test('Login business failure does not cache session', async () => {
  const instanceId = nextInstanceId();
  setFetch(async () => response(200, JSON.stringify({ success: false, result: { error_code: 'bad_password', token: '' } }), {
    'set-cookie': ['SID=abc; Path=/'],
  }));

  const loginRes = await rpcdef(buildCtx({ instance_id: instanceId, secret: { password: 'bad' } }))[LOGIN_PATH]();
  assert.equal(loginRes.success, false);
  assert.equal(loginRes.result.error_code, 'bad_password');
  await expectGrpcError(() => rpcdef(buildCtx({ instance_id: instanceId, req: buildUpdateRequest() }))[UPDATE_PATH](), 'FAILED_PRECONDITION');
});

test('Network, non-JSON, and empty responses map to legacy errors', async () => {
  setFetch(async () => {
    throw Object.assign(new Error('boom'), { cause: new Error('connect ECONNREFUSED') });
  });
  await expectGrpcError(() => rpcdef(buildCtx())[LOGIN_PATH](), 'UNAVAILABLE', (err) => assert.match(err.message, /connect ECONNREFUSED/));

  setFetch(async () => response(200, '<html>oops</html>'));
  await expectGrpcError(() => rpcdef(buildCtx())[LOGIN_PATH](), 'UNKNOWN', (err) => assert.match(err.message, /response is not valid JSON/));

  const instanceId = nextInstanceId();
  let calls = 0;
  setFetch(async () => {
    calls += 1;
    if (calls === 1) return response(200, JSON.stringify(loginSuccessPayload), { 'set-cookie': ['SID=abc; Path=/'] });
    return response(200, '');
  });
  await rpcdef(buildCtx({ instance_id: instanceId }))[LOGIN_PATH]();
  await expectGrpcError(() => rpcdef(buildCtx({ instance_id: instanceId, req: buildUpdateRequest() }))[UPDATE_PATH](), 'UNKNOWN', (err) => assert.match(err.message, /response body is empty/));
});

test('Logout accepts 2xx empty body and clears cached session', async () => {
  const instanceId = nextInstanceId();
  let calls = 0;
  let logoutCaptured;
  setFetch(async (url, init) => {
    calls += 1;
    if (calls === 1) return response(200, JSON.stringify(loginSuccessPayload), { 'set-cookie': ['SID=abc; Path=/'] });
    logoutCaptured = { url: String(url), init };
    return response(204, '', { 'x-trace-id': 'logout-ok' });
  });

  await rpcdef(buildCtx({ instance_id: instanceId, req: { username: 'api_user', password: 'SuperSecret!' } }))[LOGIN_PATH]();
  const res = await rpcdef(buildCtx({ instance_id: instanceId, req: { host: 'https://203.0.113.10:8443' } }))[LOGOUT_PATH]();

  assert.equal(logoutCaptured.url, 'https://203.0.113.10:8443/v1.0/out');
  assert.deepEqual(JSON.parse(logoutCaptured.init.body), { username: 'api_user' });
  assert.match(logoutCaptured.init.headers.Cookie, /token=token-123/);
  assert.equal(res.http_status, 204);
  assert.equal(res.raw_body, '');
  assert.equal(res.raw_json, undefined);
  assert.deepEqual(res.headers, []);
  await expectGrpcError(() => rpcdef(buildCtx({ instance_id: instanceId, req: { host: 'https://203.0.113.10:8443', username: 'api_user' } }))[LOGOUT_PATH](), 'FAILED_PRECONDITION');
});

test('Logout parses JSON body and rejects non-2xx empty body', async () => {
  const instanceId = nextInstanceId();
  let calls = 0;
  setFetch(async () => {
    calls += 1;
    if (calls === 1) return response(200, JSON.stringify(loginSuccessPayload), { 'set-cookie': ['SID=abc; Path=/'] });
    return response(200, JSON.stringify({ code: 0, message: 'logout success' }));
  });

  await rpcdef(buildCtx({ instance_id: instanceId }))[LOGIN_PATH]();
  const ok = await callHandler(METHOD_LOGOUT_FULL, {}, buildCtx({ instance_id: instanceId }));
  assert.equal(ok.http_status, 200);
  assert.equal(ok.raw_json, undefined);

  _test.setSession(buildCtx({ instance_id: 'logout-empty' }), 'https://203.0.113.10:8443', { token: 't', cookie: 'token=t', username: 'api_user' });
  setFetch(async () => response(500, ''));
  await expectGrpcError(() => rpcdef(buildCtx({ instance_id: 'logout-empty', req: { host: 'https://203.0.113.10:8443' } }))[LOGOUT_PATH](), 'UNKNOWN', (err) => assert.match(err.message, /response body is empty/));
});

test('config and secret aliases supply bindings, timeout, TLS, and headers', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, JSON.stringify(loginSuccessPayload), { 'set-cookie': ['SID=abc; Path=/'] });
  });

  const result = await callHandler(METHOD_LOGIN_FULL, {}, {
    config: {
      base_url: 'https://198.51.100.1:8443/',
      timeout_ms: 2500,
      headers: { 'X-Config': 'yes' },
      tlsInsecureSkipVerify: 'yes',
    },
    secret: { username: 'secret-user', password: 'secret-pass' },
    limits: {},
    meta: { instanceId: 'camel-inst', requestId: 'camel-req' },
  });

  assert.equal(result.success, true);
  assert.equal(captured.url, 'https://198.51.100.1:8443/v1.0/login');
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal('timeoutMs' in captured.init, false);
  assert.ok(captured.init.dispatcher);
  assert.equal('skipTlsVerify' in captured.init, false);
  assert.equal(captured.init.headers['X-Config'], 'yes');
  assert.deepEqual(JSON.parse(captured.init.body), { username: 'secret-user', password: 'secret-pass' });
});

test('helpers cover parser, scalar, cookie, schema, and normalization branches', () => {
  assert.deepEqual(_test.parseAuthority('[2001:db8::1]:8443'), { hostPart: '[2001:db8::1]', portPart: '8443' });
  assert.equal(_test.parseAuthority('[2001:db8::1]'), null);
  assert.deepEqual(_test.parseAuthority('[]:8443'), { hostPart: '[]', portPart: '8443' });
  assert.equal(_test.parseAuthority('[2001:db8::1]:bad'), null);
  assert.deepEqual(_test.parseAuthority('host.example:8443'), { hostPart: 'host.example', portPart: '8443' });
  assert.equal(_test.parseAuthority('host.example'), null);
  assert.equal(_test.parseAuthority(':8443'), null);
  assert.equal(_test.parseAuthority('host.example:bad'), null);
  assert.equal(_test.normalizeBaseUrl('HTTPS://example.test:8443///'), 'https://example.test:8443');
  assert.equal(_test.normalizeBaseUrl('https://example.test:8443/'), 'https://example.test:8443');
  assert.equal(_test.normalizeBaseUrl('https://example.test:8443/path'), '');
  assert.equal(_test.normalizeBaseUrl('example.test:8443'), '');
  assert.equal(_test.normalizeBaseUrl(''), '');
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: -1 }, bindings: { timeoutMs: 'bad' } }), 5000);
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeout_ms: 321 } }), 321);
  assert.deepEqual(_test.resolveCallContext({ config: { host: 'h' }, secret: { password: 'p' }, bindings: { user: 'u' }, request: { host: 'r' } }).bindings, {
    host: 'h',
    password: 'p',
    user: 'u',
  });
  assert.equal(_test.toBoolean('on'), true);
  assert.equal(_test.toBoolean('off'), false);
  assert.equal(_test.toBoolean(true), true);
  assert.equal(_test.toBoolean(0), false);
  assert.equal(_test.toBoolean('maybe'), false);
  assert.equal(_test.toBoolean({ value: 1 }), true);
  assert.deepEqual(_test.buildTlsOptions({}), {});
  assert.ok(_test.buildTlsOptions({ skipTlsVerify: 'yes' }).dispatcher);
  assert.equal(_test.toInt64('42.9'), 42);
  assert.equal(_test.toInt64('bad', 7), 7);
  assert.equal(_test.toInt64('', 7), 7);
  assert.equal(_test.toTrimmedString({ value: ' x ' }), 'x');
  assert.equal(_test.toTrimmedString(null), '');
  assert.equal(_test.toValue(Symbol.for('qianxin')).stringValue, 'Symbol(qianxin)');
  assert.deepEqual(_test.toValue({ a: undefined, b: [1, null] }), {
    structValue: {
      fields: {
        a: { nullValue: 'NULL_VALUE' },
        b: { listValue: { values: [{ numberValue: 1 }, { nullValue: 'NULL_VALUE' }] } },
      },
    },
  });
  assert.equal(_test.mergeCookieHeader(['SID=abc; Path=/', 'SID=override; Path=/', 'bad', 'lang=zh; Path=/'], 'tok'), 'SID=override; lang=zh; token=tok');
  assert.equal(_test.mergeCookieHeader([null, ' =bad; Path=/'], ''), '');
  assert.deepEqual(_test.getSetCookies({ headers: { getSetCookie: () => 'bad' } }), []);
  assert.deepEqual(_test.getSetCookies({ headers: { get: () => 'SID=abc; Path=/' } }), ['SID=abc; Path=/']);
  assert.deepEqual(_test.getSetCookies({}), []);
  assert.deepEqual(_test.extractHeaders({}), []);
  assert.deepEqual(_test.extractHeaders({ headers: createHeaders({ 'x-a': ['1', '2'], 'set-cookie': ['SID=abc; Path=/'] }) }).find((item) => item.key === 'x-a').values, ['1', '2']);
  assert.equal(_test.getInstanceKey({ meta: {} }), 'default');
  assert.equal(_test.buildHeaders({ bindings: { headers: { A: '1' } } }, { B: '2' }).A, '1');
  assert.throws(() => _test.requireJsonBody(''), /UNKNOWN: response body is empty/);
  assert.throws(() => _test.validateLoginJson({ success: true, result: { error_code: 'success', token: '' } }), /login response schema is invalid/);
  assert.deepEqual(_test.normalizeAddressItem({ ip: '1.1.1.1', addrType: undefined }, 'field'), { ip: '1.1.1.1', addr_type: 'host' });
  assert.throws(() => _test.normalizeAddressItems({}, 'items'), /items must be an array/);
  assert.deepEqual(_test.normalizeAddressItems(null, 'items'), []);
  assert.throws(() => _test.normalizeGroupObject({}, 0), /obj_addr\[\]\.name is required/);
  assert.throws(() => _test.normalizeUpdateEntries({ entries: [{ head: {}, body: { obj_addr: [] } }] }), /obj_addr must be a non-empty array/);
  assert.deepEqual(_test.toUpdateResponse(200, '{"head":{}}', {}, { head: { errmsg: 'm' } }).head.message, 'm');
  assert.equal(_test.toLoginResponse(200, '{}', {}, { success: false, result: [] }).result.error_code, '');
  assert.deepEqual(_test.toLoginResponse(200, '{"token":"secret"}', { headers: createHeaders({ 'set-cookie': ['SID=abc'] }) }, { success: true, result: { error_code: 'success', token: 'secret' } }), {
    success: true,
    result: { error_code: 'success', token: '', raw: undefined },
    http_status: 200,
    raw_body: '',
    raw_json: undefined,
    headers: [],
  });
  assert.equal(_test.toLogoutResponse(200, '', {}, undefined).raw_json, undefined);
  assert.equal(_test.errorWithCode('NOT_REAL', 'fallback').code, grpcStatus.UNKNOWN);
});

test('mock upstream supports login, update, and logout lifecycle', async () => {
  const mock = await createMockServer();
  try {
    const ctx = buildCtx({ bindings: { host: mock.url }, instance_id: nextInstanceId() });
    const login = await rpcdef(ctx)[LOGIN_PATH]();
    assert.equal(login.success, true);
    const update = await rpcdef({ ...ctx, req: { entries: buildUpdateRequest().entries } })[UPDATE_PATH]();
    assert.equal(update.head.error_code, 0);
    const logout = await rpcdef(ctx)[LOGOUT_PATH]();
    assert.equal(logout.http_status, 204);
    assert.equal(mock.requests[0].url, '/v1.0/login');
    assert.equal(mock.requests[1].url, '/v1.0/rest/');
    assert.equal(mock.requests[2].url, '/v1.0/out');
  } finally {
    await mock.close();
  }
});
