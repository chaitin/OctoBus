import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  ADD_IPTABLE_PATH,
  BLOCK_IP_PATH,
  LIST_IPTABLE_PATH,
  LOGIN_PATH,
  METHOD_ADD_IPTABLE_FULL,
  METHOD_BLOCK_IP_FULL,
  METHOD_LOGIN_FULL,
  METHOD_UNBLOCK_IP_FULL,
  UNBLOCK_IP_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/panabit-tang-r1.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;
let instSeq = 0;

const nextInst = () => `inst-${++instSeq}`;

const buildCtx = (overrides = {}) => ({
  bindings: {
    restBaseUrl: 'http://localhost:18080',
    headers: { 'X-Extra': 'demo' },
    ...(overrides.bindings || {}),
  },
  config: overrides.config || {},
  secret: {
    bindUser: 'api_user',
    bindPassword: 'SuperSecret!',
    ...(overrides.secret || {}),
  },
  limits: { timeoutMs: 10_000, ...(overrides.limits || {}) },
  meta: { instance_id: overrides.instance_id || nextInst(), request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const callHandler = (method, request = {}, ctx = {}) => {
  const handler = handlers[method];
  return handler({ ...ctx, request });
};

const makeResponse = ({ ok = true, status = 200, body = '{}', contentType = 'application/json' } = {}) => ({
  ok,
  status,
  headers: new Map([['content-type', contentType]]),
  text: async () => body,
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
    PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
    UNKNOWN: grpcStatus.UNKNOWN,
  })[legacyCode]);
  assert.match(caught.message, new RegExp(`^${legacyCode}:`));
  checker(caught);
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  _test.clearSessionCache();
});

test('service exports defineService result and handlers', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers[METHOD_LOGIN_FULL], 'function');
  assert.equal(typeof handlers[METHOD_BLOCK_IP_FULL], 'function');
});

test('Login validates required bindings and base URL', async () => {
  await expectGrpcError(
    () => rpcdef(buildCtx({ bindings: { restBaseUrl: 'localhost' }, secret: { user: 'u', password: 'p', bindUser: undefined, bindPassword: undefined } }))[LOGIN_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /restBaseUrl\/baseUrl is required/),
  );
  await expectGrpcError(
    () => rpcdef(buildCtx({ secret: { bindUser: '', bind_user: '', user: '', username: '', password: 'p' } }))[LOGIN_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /user is required in bindings/),
  );
  await expectGrpcError(
    () => rpcdef(buildCtx({ secret: { bindPassword: '', bind_password: '', password: '' } }))[LOGIN_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /password is required in bindings/),
  );
});

test('Login sends GET request, headers, timeout, TLS flags, and caches token', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return makeResponse({ body: JSON.stringify({ code: 0, data: 'test-token-123' }) });
  });

  const res = await rpcdef(buildCtx({
    bindings: { skipTlsVerify: true },
    secret: { bindUser: 'api_user', bindPassword: 'StrongPass!' },
    limits: { timeoutMs: undefined },
  }))[LOGIN_PATH]();

  const url = new URL(captured.url);
  assert.equal(url.pathname, '/api/panabit.cgi/API');
  assert.equal(url.searchParams.get('api_action'), 'api_login');
  assert.equal(url.searchParams.get('username'), 'api_user');
  assert.equal(url.searchParams.get('password'), 'StrongPass!');
  assert.equal(captured.init.method, 'GET');
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal('timeoutMs' in captured.init, false);
  assert.ok(captured.init.dispatcher);
  assert.equal('insecureSkipVerify' in captured.init, false);
  assert.equal(captured.init.headers['X-Extra'], 'demo');
  assert.ok(captured.init.headers['x-engine-instance'].startsWith('inst-'));
  assert.equal(captured.init.headers['x-request-id'], 'req');
  assert.equal(res.code, 0);
  assert.equal(res.api_token, '');
  assert.equal(res.raw, undefined);
});

test('Login returns business failure payload without throwing', async () => {
  setFetch(async () => makeResponse({ body: JSON.stringify({ code: 1, msg: 'authentication failed' }) }));

  const res = await rpcdef(buildCtx())[LOGIN_PATH]();

  assert.equal(res.code, 1);
  assert.equal(res.api_token, '');
  assert.equal(res.raw, undefined);
});

test('ListIPTable sends multipart form data with cached token and maps entries', async () => {
  let captured;
  let step = 0;
  setFetch(async (url, init) => {
    step += 1;
    captured = { url: String(url), init };
    if (step === 1) return makeResponse({ body: JSON.stringify({ code: 0, data: 'cached-token' }) });
    return makeResponse({
      body: JSON.stringify({
        code: 0,
        msg: 'success',
        data: [
          { id: 1024, name: 'Block_IP_Firewall-01', member: ['1.1.1.1', 2] },
          { id: null, name: null, member: 'bad' },
        ],
      }),
    });
  });

  const ctx = buildCtx();
  await rpcdef(ctx)[LOGIN_PATH]();
  const res = await rpcdef({ ...ctx, req: { apiToken: 'request-token', keyword: 'Firewall' } })[LIST_IPTABLE_PATH]();

  assert.equal(captured.url, 'http://localhost:18080/api/panabit.cgi');
  assert.equal(captured.init.method, 'POST');
  assert.match(captured.init.headers['content-type'], /^multipart\/form-data; boundary=/);
  assert.match(captured.init.body, /name="api_route"\r\n\r\nobject@iptable\r\n/);
  assert.match(captured.init.body, /name="api_action"\r\n\r\nlist_iptable\r\n/);
  assert.match(captured.init.body, /name="api_token"\r\n\r\ncached-token\r\n/);
  assert.match(captured.init.body, /name="keyword"\r\n\r\nFirewall\r\n/);
  assert.equal(res.code, 0);
  assert.equal(res.msg, 'success');
  assert.deepEqual(res.data, [
    { id: '1024', name: 'Block_IP_Firewall-01', member: ['1.1.1.1', '2'] },
    { id: '', name: '', member: [] },
  ]);
});

test('AddIPTable, BlockIP, and UnblockIP send expected multipart actions', async () => {
  const calls = [];
  const ctx = buildCtx();
  _test.setSession(ctx, 'http://localhost:18080', { apiToken: 'cached-token' });
  setFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    return makeResponse({ body: JSON.stringify({ code: 0, msg: 'success' }) });
  });

  const add = await callHandler(METHOD_ADD_IPTABLE_FULL, { api_token: 'request-token', Name: 'NewGroup' }, ctx);
  const block = await rpcdef({ ...ctx, req: { api_token: 'request-token', Name: 'BlockGroup', Id: '1024', Ip: '203.0.113.10' } })[BLOCK_IP_PATH]();
  const unblock = await callHandler(METHOD_UNBLOCK_IP_FULL, { apiToken: 'request-token', name: 'BlockGroup', id: '1024', ip: '::1' }, ctx);

  assert.equal(add.code, 0);
  assert.equal(block.code, 0);
  assert.equal(unblock.code, 0);
  assert.match(calls[0].init.body, /name="api_action"\r\n\r\nadd_iptable\r\n/);
  assert.match(calls[0].init.body, /name="name"\r\n\r\nNewGroup\r\n/);
  assert.match(calls[0].init.body, /name="api_token"\r\n\r\ncached-token\r\n/);
  assert.match(calls[1].init.body, /name="api_action"\r\n\r\nadd_tabip\r\n/);
  assert.match(calls[1].init.body, /name="ip"\r\n\r\n203.0.113.10\r\n/);
  assert.match(calls[2].init.body, /name="api_action"\r\n\r\nrmv_tabip\r\n/);
  assert.match(calls[2].init.body, /name="ip"\r\n\r\n::1\r\n/);
});

test('business RPCs require cached login token and validate name, id, and IP fields', async () => {
  await expectGrpcError(() => rpcdef(buildCtx({ req: { api_token: 'request-token' } }))[LIST_IPTABLE_PATH](), 'FAILED_PRECONDITION', (err) => assert.match(err.message, /call Login first/));
  const ctx = buildCtx();
  _test.setSession(ctx, 'http://localhost:18080', { apiToken: 'cached-token' });
  await expectGrpcError(() => rpcdef({ ...ctx, req: {} })[ADD_IPTABLE_PATH](), 'INVALID_ARGUMENT', (err) => assert.match(err.message, /name is required/));
  await expectGrpcError(() => rpcdef({ ...ctx, req: { name: 'group', id: '1' } })[BLOCK_IP_PATH](), 'INVALID_ARGUMENT', (err) => assert.match(err.message, /ip is required/));
  await expectGrpcError(() => rpcdef({ ...ctx, req: { name: 'group', ip: '1.1.1.1' } })[BLOCK_IP_PATH](), 'INVALID_ARGUMENT', (err) => assert.match(err.message, /id is required/));
  await expectGrpcError(() => rpcdef({ ...ctx, req: { id: '1', ip: '1.1.1.1' } })[BLOCK_IP_PATH](), 'INVALID_ARGUMENT', (err) => assert.match(err.message, /name is required/));
  await expectGrpcError(() => rpcdef({ ...ctx, req: { name: 'group', id: '1', ip: 'invalid-ip' } })[UNBLOCK_IP_PATH](), 'INVALID_ARGUMENT', (err) => assert.match(err.message, /ip format is invalid/));
});

test('HTTP and transport failures map to legacy gRPC codes', async () => {
  for (const [status, code] of [
    [401, 'PERMISSION_DENIED'],
    [403, 'PERMISSION_DENIED'],
    [404, 'FAILED_PRECONDITION'],
    [500, 'UNAVAILABLE'],
  ]) {
    setFetch(async () => makeResponse({ ok: false, status, body: `http ${status} api_token=leaked-panabit-token`, contentType: 'text/plain' }));
    await expectGrpcError(
      () => {
        const ctx = buildCtx();
        _test.setSession(ctx, 'http://localhost:18080', { apiToken: 'cached-token' });
        return rpcdef(ctx)[LIST_IPTABLE_PATH]();
      },
      code,
      (err) => {
        assert.match(err.message, new RegExp(`upstream http ${status}`));
        assert.match(err.message, /body_length=/);
        assert.doesNotMatch(err.message, /leaked-panabit-token/);
        assert.doesNotMatch(err.message, /api_token/);
      },
    );
  }

  setFetch(async () => {
    throw Object.assign(new Error('boom'), { cause: new Error('socket hangup') });
  });
  await expectGrpcError(() => rpcdef(buildCtx())[LOGIN_PATH](), 'UNAVAILABLE', (err) => assert.match(err.message, /socket hangup/));
});

test('non-JSON and empty responses preserve legacy behavior', async () => {
  setFetch(async () => makeResponse({ body: 'not json', contentType: 'text/plain' }));
  const badJsonCtx = buildCtx();
  _test.setSession(badJsonCtx, 'http://localhost:18080', { apiToken: 'cached-token' });
  await expectGrpcError(() => rpcdef(badJsonCtx)[LIST_IPTABLE_PATH](), 'UNKNOWN', (err) => assert.match(err.message, /response is not valid JSON/));

  setFetch(async () => makeResponse({ body: '' }));
  const emptyCtx = buildCtx();
  _test.setSession(emptyCtx, 'http://localhost:18080', { apiToken: 'cached-token' });
  const list = await rpcdef(emptyCtx)[LIST_IPTABLE_PATH]();
  const add = await rpcdef({ ...emptyCtx, req: { name: 'group' } })[ADD_IPTABLE_PATH]();
  const block = await rpcdef({ ...emptyCtx, req: { name: 'group', id: '1', ip: '192.168.1.1' } })[BLOCK_IP_PATH]();
  const unblock = await rpcdef({ ...emptyCtx, req: { name: 'group', id: '1', ip: '192.168.1.1' } })[UNBLOCK_IP_PATH]();

  assert.deepEqual(list, { code: 0, msg: '', data: [], raw: { fields: {} } });
  assert.deepEqual(add, { code: 0, msg: '', raw: { fields: {} } });
  assert.deepEqual(block, { code: 0, msg: '', raw: { fields: {} } });
  assert.deepEqual(unblock, { code: 0, msg: '', raw: { fields: {} } });

  await expectGrpcError(() => rpcdef(buildCtx())[LOGIN_PATH](), 'UNKNOWN', (err) => assert.match(err.message, /empty response from device/));
});

test('config and secret aliases supply base URL, credentials, timeout, and headers', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return makeResponse({ body: JSON.stringify({ code: 0, data: 'token' }) });
  });

  const result = await callHandler(METHOD_LOGIN_FULL, {}, {
    config: {
      base_url: 'http://config.example/',
      timeout_ms: 2500,
      headers: { 'X-Config': 'yes' },
    },
    secret: { username: 'secret-user', bind_password: 'secret-pass' },
    limits: {},
    meta: { instanceId: 'camel-inst', requestId: 'camel-req' },
  });

  assert.equal(result.api_token, '');
  assert.equal(captured.url, 'http://config.example/api/panabit.cgi/API?api_action=api_login&username=secret-user&password=secret-pass');
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal('timeoutMs' in captured.init, false);
  assert.equal(captured.init.headers['X-Config'], 'yes');
  assert.equal(captured.init.headers['x-engine-instance'], 'camel-inst');
  assert.equal(captured.init.headers['x-request-id'], 'camel-req');
});

test('helpers cover URL, scalar, multipart, IP, response, and fallback branches', () => {
  assert.equal(_test.normalizeBaseUrl('https://example.test///'), 'https://example.test');
  assert.equal(_test.normalizeBaseUrl('example.test'), '');
  assert.equal(_test.resolveBaseUrl({ baseUrl: 'http://base.example/' }), 'http://base.example');
  assert.equal(_test.resolveBaseUrl({ rest_base_url: 'http://rest-snake.example/' }), 'http://rest-snake.example');
  assert.equal(_test.resolveBaseUrl({ base_url: 'http://base-snake.example/' }), 'http://base-snake.example');
  assert.equal(_test.resolveBaseUrl({ host: 'http://host.example/' }), 'http://host.example');
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: -1 }, bindings: { timeoutMs: 'bad' } }), 1500);
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeout_ms: 321 } }), 321);
  assert.equal(_test.toBoolean(true), true);
  assert.equal(_test.toBoolean(1), true);
  assert.equal(_test.toBoolean('on'), true);
  assert.equal(_test.toBoolean('off'), false);
  assert.equal(_test.toBoolean('maybe'), false);
  assert.deepEqual(_test.buildTlsOptions({}), {});
  assert.ok(_test.buildTlsOptions({ insecureSkipVerify: 'yes' }).dispatcher);
  assert.deepEqual(_test.buildHeaders({ bindings: {}, meta: {} }), {
    'x-engine-instance': 'unknown',
    'x-request-id': 'unknown',
  });
  assert.equal(_test.buildQueryString({ a: 'x y', b: '1' }), 'a=x%20y&b=1');
  const multipart = _test.buildMultipartBody({ a: 'x', b: null, c: 3 });
  assert.match(multipart.boundary, /^----FormBoundary/);
  assert.match(multipart.body, /name="a"\r\n\r\nx\r\n/);
  assert.doesNotMatch(multipart.body, /name="b"/);
  assert.match(multipart.body, /name="c"\r\n\r\n3\r\n/);
  assert.equal(_test.isValidIPv4('192.168.1.1'), true);
  assert.equal(_test.isValidIPv4('01.1.1.1'), false);
  assert.equal(_test.isValidIPv4('1.1.1.999'), false);
  assert.equal(_test.isValidIPv6('::1'), true);
  assert.equal(_test.isValidIPv6('2001:db8::1'), true);
  assert.equal(_test.isValidIPv6('2001:db8:0:0:0:0:2:1'), true);
  assert.equal(_test.isValidIPv6('2001:db8:0:0:0:0:2:zz'), false);
  assert.equal(_test.isValidIPv6('2001:db8:0:0:0:0:2'), false);
  assert.equal(_test.isValidIPv6('2001::db8::1'), false);
  assert.equal(_test.isValidIP('not-ip'), false);
  assert.throws(() => _test.requireIP({ ip: 'not-ip' }), /ip format is invalid/);
  assert.equal(_test.toValue(Symbol.for('panabit')).stringValue, 'Symbol(panabit)');
  assert.deepEqual(_test.toValue({ value: ['x', null] }), { listValue: { values: [{ stringValue: 'x' }, { nullValue: 'NULL_VALUE' }] } });
  assert.deepEqual(_test.toStruct({ a: undefined, b: true }), { fields: { a: { nullValue: 'NULL_VALUE' }, b: { boolValue: true } } });
  assert.deepEqual(_test.responseFromJson({ code: 'bad', msg: 1, data: [1] }), {
    code: -1,
    msg: '',
    raw: {
      fields: {
        code: { stringValue: 'bad' },
        msg: { numberValue: 1 },
        data: { listValue: { values: [{ numberValue: 1 }] } },
      },
    },
  });
  assert.equal(_test.errorWithCode('NOT_REAL', 'fallback').code, grpcStatus.UNKNOWN);
  assert.equal(_test.parseJsonResponse(''), null);
});

test('mock upstream supports login, table lifecycle, block, and unblock', async () => {
  const mock = await createMockServer();
  try {
    const ctx = buildCtx({ bindings: { restBaseUrl: mock.url }, instance_id: nextInst() });
    const login = await rpcdef(ctx)[LOGIN_PATH]();
    assert.equal(login.code, 0);
    assert.equal(login.api_token, '');

    const list = await rpcdef({ ...ctx, req: { api_token: 'request-token', keyword: 'Firewall' } })[LIST_IPTABLE_PATH]();
    assert.equal(list.data.length, 1);

    const add = await rpcdef({ ...ctx, req: { name: 'NewGroup' } })[ADD_IPTABLE_PATH]();
    assert.equal(add.msg, 'add success');

    const block = await rpcdef({ ...ctx, req: { name: 'Block_IP_Firewall-01', id: '1024', ip: '198.51.100.10' } })[BLOCK_IP_PATH]();
    assert.equal(block.code, 0);

    const unblock = await rpcdef({ ...ctx, req: { name: 'Block_IP_Firewall-01', id: '1024', ip: '198.51.100.10' } })[UNBLOCK_IP_PATH]();
    assert.equal(unblock.code, 0);

    assert.equal(mock.requests[0].query.username, 'api_user');
    assert.equal(mock.requests.at(-1).fields.api_action, 'rmv_tabip');
  } finally {
    await mock.close();
  }
});
