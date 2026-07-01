import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  BLOCK_PATH,
  METHOD_BATCH_BLOCK_FULL,
  METHOD_BATCH_BLOCK_PATH,
  METHOD_REMOVE_IP_FULL,
  METHOD_REMOVE_IP_PATH,
  OPERATION_STATUS,
  _test,
  handlers,
  rpcdef,
} from '../src/venus-ads-v3-6.js';
import { service } from '../src/service.js';
import { PASSWORD, USERNAME, createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

const baseBindings = {
  baseUrl: 'https://venus.example.com/cnddos',
  username: USERNAME,
  password: PASSWORD,
  remark: 'block from test',
  headers: { 'x-env': 'test' },
};

const buildCtx = (overrides = {}) => ({
  bindings: { ...baseBindings, ...(overrides.bindings || {}) },
  config: overrides.config || {},
  secret: overrides.secret || {},
  limits: { timeoutMs: 8000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const callHandler = (method, request = {}, ctx = {}) => {
  const handler = handlers[method];
  return handler({ ...ctx, request });
};

const responseOf = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => String(body),
});

const setFetch = (impl) => {
  globalThis.fetch = impl;
};

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
  const codes = {
    FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
    INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
    PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
    UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
    UNKNOWN: grpcStatus.UNKNOWN,
  };
  assert.equal(caught.code, codes[legacyCode]);
  assert.match(caught.message, new RegExp(`^${legacyCode}:`));
  checker(caught);
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
});

test('service exports handlers and rpcdef path handlers', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers[METHOD_BATCH_BLOCK_FULL], 'function');
  assert.equal(typeof handlers[METHOD_REMOVE_IP_FULL], 'function');
  const defs = rpcdef(buildCtx());
  assert.equal(typeof defs[METHOD_BATCH_BLOCK_PATH], 'function');
  assert.equal(typeof defs[METHOD_REMOVE_IP_PATH], 'function');
});

test('mock upstream supports batch block, duplicate block, remove, and missing remove', async () => {
  const mock = createMockServer();
  const host = await mock.start();
  try {
    const ctx = buildCtx({ bindings: { baseUrl: host, skipTlsVerify: true, ipdirection: 2, ipstate: 101, listtype: '100' } });
    const block = await callHandler(METHOD_BATCH_BLOCK_FULL, { ip_list: ['198.51.100.1'], request_id: 'r1' }, ctx);
    assert.equal(block.status, OPERATION_STATUS.SUCCESS);
    assert.equal(block.success_count, 1);
    assert.equal(block.request_id, 'r1');
    const duplicate = await callHandler(METHOD_BATCH_BLOCK_FULL, { ipList: ['198.51.100.1'] }, ctx);
    assert.equal(duplicate.upstream_result_code, '-391201');
    assert.equal(duplicate.results[0].succeeded, true);
    const remove = await callHandler(METHOD_REMOVE_IP_FULL, { ip: '198.51.100.1', requestId: 'r2' }, ctx);
    assert.equal(remove.status, OPERATION_STATUS.SUCCESS);
    assert.equal(remove.request_id, 'r2');
    const removeAgain = await callHandler(METHOD_REMOVE_IP_FULL, { target: '198.51.100.1' }, ctx);
    assert.equal(removeAgain.upstream_result_code, '-391204');
    assert.equal(removeAgain.result.succeeded, true);
    assert.equal(mock.requests.length, 12);
  } finally {
    await mock.close();
  }
});

test('BatchBlockIP sends expected payload, headers, token, and TLS options', async () => {
  const calls = [];
  setFetch(async (url, init) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : null });
    if (String(url).endsWith('/web_login/ddos')) return responseOf(200, JSON.stringify({ result: '0', message: { token: 'tok' } }));
    if (String(url).endsWith('/ip_bwlist/info')) return responseOf(200, JSON.stringify({ result: '0', message: 'added' }));
    return responseOf(200, JSON.stringify({ result: '0', message: 'logout ok' }));
  });

  const res = await callHandler(METHOD_BATCH_BLOCK_FULL, { targets: { values: ['1.1.1.1', '2.2.2.2'] } }, buildCtx({
    bindings: {
      skipTlsVerify: true,
      ipdirection: '3',
      ipstate: '101',
      listtype: 200,
      sessionTimeoutSeconds: '90',
    },
  }));
  assert.equal(res.requested_ip_count, 2);
  assert.equal(calls[0].body.customize_time_out, 90);
  assert.equal(calls[0].init.headers['x-env'], 'test');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal(calls[0].init.dispatcher, _test.insecureTlsDispatcher);
  assert.equal(calls[0].init.tlsInsecureSkipVerify, undefined);
  assert.equal(calls[1].init.headers.Authorization, 'Bearer tok');
  assert.equal(calls[1].body.listtype, '200');
  assert.deepEqual(calls[1].body.ipadd, ['1.1.1.1', '2.2.2.2']);
  assert.equal(calls[1].body.ipdirection, 3);
  assert.equal(calls[1].body.ipstate, 101);
  assert.equal(calls[1].body.remark, 'block from test');
  assert.equal(calls[2].init.headers.Authorization, 'Bearer tok');
});

test('RemoveBlockedIP uses encoded query and failure result shape', async () => {
  const calls = [];
  setFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/web_login/ddos')) return responseOf(200, JSON.stringify({ result: '0', token: 'tok' }));
    if (String(url).includes('/ip_bwlist/info?')) return responseOf(200, JSON.stringify({ result: '-900', message: { reason: 'denied' } }));
    return responseOf(200, JSON.stringify({ result: '0', message: 'logout ok' }));
  });

  const res = await callHandler(METHOD_REMOVE_IP_FULL, { target: '2001:db8::1', request_id: 'rm' }, buildCtx({ bindings: { listtype: 'black list' } }));
  assert.equal(res.status, OPERATION_STATUS.FAILED);
  assert.equal(res.result.error_code, '-900');
  assert.equal(res.result.error_message, '{"reason":"denied"}');
  assert.match(calls[1].url, /listtype=black%20list/);
  assert.match(calls[1].url, /iplist=2001%3Adb8%3A%3A1/);
});

test('rpcdef merges default request and caches environment', async () => {
  let loginCount = 0;
  setFetch(async (url, init) => {
    if (String(url).endsWith('/web_login/ddos')) {
      loginCount += 1;
      return responseOf(200, JSON.stringify({ result: '0', message: { token: `tok-${loginCount}` } }));
    }
    if (String(url).includes('/ip_bwlist/info?')) return responseOf(200, JSON.stringify({ result: '0', message: 'removed' }));
    if (String(url).endsWith('/ip_bwlist/info')) return responseOf(200, JSON.stringify({ result: '0', message: 'added' }));
    return responseOf(200, JSON.stringify({ result: '0', message: 'logout ok' }));
  });

  const defs = rpcdef(buildCtx({ req: { ip_list: ['1.1.1.1'], request_id: 'ctx-req' } }));
  const block = await defs[METHOD_BATCH_BLOCK_PATH]();
  assert.equal(block.request_id, 'ctx-req');
  const remove = await defs[METHOD_REMOVE_IP_PATH]({ ip: '1.1.1.1' });
  assert.equal(remove.status, OPERATION_STATUS.SUCCESS);
  assert.equal(loginCount, 2);
});

test('validation and upstream errors map to gRPC errors', async () => {
  await expectGrpcError(() => callHandler(METHOD_BATCH_BLOCK_FULL, { ip_list: ['1.1.1.1'] }, buildCtx({ bindings: { baseUrl: 'venus.example.com' } })), 'FAILED_PRECONDITION');
  await expectGrpcError(() => callHandler(METHOD_BATCH_BLOCK_FULL, { ip_list: ['1.1.1.1'] }, buildCtx({ bindings: { username: '' } })), 'FAILED_PRECONDITION');
  await expectGrpcError(() => callHandler(METHOD_BATCH_BLOCK_FULL, {}, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => callHandler(METHOD_BATCH_BLOCK_FULL, { ip_list: 'bad' }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => callHandler(METHOD_BATCH_BLOCK_FULL, { ip_list: [''] }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => callHandler(METHOD_REMOVE_IP_FULL, {}, buildCtx()), 'INVALID_ARGUMENT');
  setFetch(async () => { throw new Error('deterministic alias failure'); });
  assert.deepEqual(await _test.executeBatchBlock({
    log: () => {},
    baseUrl: 'https://venus.example.com/cnddos',
    username: USERNAME,
    password: PASSWORD,
    timeoutMs: 1,
    sessionTimeoutSeconds: 1,
    headers: {},
    listType: '100',
    ipdirection: 1,
    ipstate: 100,
    remark: 'r',
  }, { ipList: null, targets: ['1.1.1.1'] }).catch((err) => err.legacyCode), 'UNAVAILABLE');

  setFetch(async () => responseOf(200, JSON.stringify({ result: '-1', message: 'invalid credentials' })));
  await expectGrpcError(() => callHandler(METHOD_BATCH_BLOCK_FULL, { ip_list: ['1.1.1.1'] }, buildCtx()), 'UNAUTHENTICATED');

  setFetch(async () => responseOf(403, 'forbidden'));
  await expectGrpcError(() => callHandler(METHOD_BATCH_BLOCK_FULL, { ip_list: ['1.1.1.1'] }, buildCtx()), 'PERMISSION_DENIED');

  setFetch(async () => responseOf(404, 'not found'));
  await expectGrpcError(() => callHandler(METHOD_BATCH_BLOCK_FULL, { ip_list: ['1.1.1.1'] }, buildCtx()), 'FAILED_PRECONDITION');

  setFetch(async () => responseOf(500, 'broken'));
  await expectGrpcError(() => callHandler(METHOD_BATCH_BLOCK_FULL, { ip_list: ['1.1.1.1'] }, buildCtx()), 'UNAVAILABLE');

  setFetch(async () => responseOf(200, 'not-json'));
  await expectGrpcError(() => callHandler(METHOD_BATCH_BLOCK_FULL, { ip_list: ['1.1.1.1'] }, buildCtx()), 'UNKNOWN');

  setFetch(async () => { throw Object.assign(new Error('outer'), { cause: new Error('timeout') }); });
  await expectGrpcError(() => callHandler(METHOD_BATCH_BLOCK_FULL, { ip_list: ['1.1.1.1'] }, buildCtx()), 'UNAVAILABLE', (err) => assert.match(err.message, /timeout/));

  setFetch(async () => { throw 'boom'; });
  await expectGrpcError(() => callHandler(METHOD_BATCH_BLOCK_FULL, { ip_list: ['1.1.1.1'] }, buildCtx()), 'UNAVAILABLE', (err) => assert.match(err.message, /fetch failed/));
});

test('mock upstream covers invalid credentials, missing auth, bad delete, bad JSON, and not found', async () => {
  const mock = createMockServer();
  const host = await mock.start();
  try {
    const badLogin = await fetch(`${host}/v2.0/api/web_login/ddos`, {
      method: 'POST',
      body: JSON.stringify({ username: USERNAME, userpwd: 'wrong' }),
    });
    assert.equal(badLogin.status, 200);
    assert.match(await badLogin.text(), /invalid credentials/);

    const noAuth = await fetch(`${host}/v2.0/api/ip_bwlist/info`, {
      method: 'POST',
      body: JSON.stringify({ ipadd: ['1.1.1.1'] }),
    });
    assert.equal(noAuth.status, 401);

    const login = await fetch(`${host}/v2.0/api/web_login/ddos`, {
      method: 'POST',
      body: JSON.stringify({ username: USERNAME, userpwd: PASSWORD }),
    });
    const token = (await login.json()).message.token;

    const badDelete = await fetch(`${host}/v2.0/api/ip_bwlist/info`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(badDelete.status, 400);

    const unknown = await fetch(`${host}/missing`);
    assert.equal(unknown.status, 404);

    const badJson = await fetch(`${host}/v2.0/api/ip_bwlist/info`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: '{',
    });
    assert.equal(badJson.status, 500);
  } finally {
    await mock.close();
  }
});

test('logout errors are logged but do not mask action result', async () => {
  const errors = [];
  console.error = (line) => errors.push(line);
  setFetch(async (url) => {
    if (String(url).endsWith('/web_login/ddos')) return responseOf(200, JSON.stringify({ result: '0', message: { token: 'tok' } }));
    if (String(url).endsWith('/ip_bwlist/info')) return responseOf(200, JSON.stringify({ result: '0', message: 'added' }));
    return responseOf(500, 'logout failed');
  });

  const res = await callHandler(METHOD_BATCH_BLOCK_FULL, { ip_list: ['1.1.1.1'] }, buildCtx());
  assert.equal(res.status, OPERATION_STATUS.SUCCESS);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /logout_failed/);
  assert.doesNotMatch(errors[0], /tok$/);
});

test('helper functions cover parsing and branch behavior', async () => {
  assert.equal(_test.grpcCodeFor('missing'), grpcStatus.UNKNOWN);
  assert.equal(_test.hasOwn({ value: 1 }, 'value'), true);
  assert.equal(_test.unwrapScalar({ value: { stringValue: 'x' } }), 'x');
  assert.equal(_test.unwrapScalar({ numberValue: 3 }), 3);
  assert.equal(_test.unwrapScalar({ boolValue: false }), false);
  assert.equal(_test.pickString(7), '7');
  assert.equal(_test.pickString({ nope: true }), undefined);
  assert.equal(_test.pickFirstString([' ', undefined, ' x ']), 'x');
  assert.equal(_test.pickFirstString([' ', undefined]), undefined);
  assert.equal(_test.pickBoolean('yes'), true);
  assert.equal(_test.pickBoolean(true), true);
  assert.equal(_test.pickBoolean(0), false);
  assert.equal(_test.pickBoolean(null), undefined);
  assert.equal(_test.pickBoolean('off'), false);
  assert.equal(_test.pickBoolean(''), false);
  assert.equal(_test.pickBoolean(Number.NaN), undefined);
  assert.equal(_test.pickBoolean('maybe'), undefined);
  assert.equal(_test.pickFirstBoolean(['bad', 1]), true);
  assert.equal(_test.pickFirstBoolean(['bad']), undefined);
  assert.equal(_test.optionalInt('4'), 4);
  assert.equal(_test.optionalInt(''), undefined);
  assert.equal(_test.optionalInt('4.2'), undefined);
  assert.equal(_test.optionalPositiveNumber('4.2'), 4.2);
  assert.equal(_test.optionalPositiveNumber(''), undefined);
  assert.equal(_test.optionalPositiveNumber(0), undefined);
  assert.deepEqual(_test.toArray(['a']), ['a']);
  assert.deepEqual(_test.toArray({ values: ['a'] }), ['a']);
  assert.equal(_test.toArray('a'), undefined);
  assert.equal(_test.isPlainObject({}), true);
  assert.equal(_test.isPlainObject([]), false);
  assert.deepEqual(_test.sanitizeHeaders({ a: 1, b: { value: true }, '': 'skip' }), { a: '1', b: 'true' });
  assert.deepEqual(_test.sanitizeHeaders(null), {});
  assert.equal(_test.stringifyMessage({ a: 1 }), '{"a":1}');
  const circular = {};
  circular.self = circular;
  assert.equal(_test.stringifyMessage(circular), '[object Object]');
  assert.equal(_test.maskToken(''), '');
  assert.equal(_test.maskToken('abc'), '***');
  assert.equal(_test.maskToken('abcdef'), 'ab***ef');
  assert.equal(_test.normalizeBaseUrl(' https://venus.example.com/cnddos/ '), 'https://venus.example.com/cnddos');
  assert.equal(_test.normalizeBaseUrl('venus.example.com'), '');
  assert.equal(_test.resolveTimeoutMs(_test.resolveCallContext(buildCtx({ bindings: { timeoutMs: 15 }, limits: { timeoutMs: 9 } }))), 15);
  assert.equal(_test.resolveTimeoutMs(_test.resolveCallContext(buildCtx({ bindings: { timeoutMs: -1 }, limits: { timeoutMs: 9 } }))), 9);
  assert.equal(_test.resolveTimeoutMs(_test.resolveCallContext(buildCtx({ bindings: { timeoutMs: -1 }, limits: { timeoutMs: -1 } }))), 8000);
  assert.equal(_test.resolveSessionTimeoutSeconds({ sessionTimeoutSeconds: '120' }), 120);
  assert.equal(_test.resolveSessionTimeoutSeconds({ sessionTimeoutSeconds: 'bad' }), 1800);
  assert.equal(_test.buildEnv({
    config: { baseUrl: 'https://config.example/cnddos', username: 'config-user' },
    secret: { password: 'secret-pass' },
    bindings: { user: 'binding-user' },
  }).password, 'secret-pass');
  assert.equal(_test.buildEnv(buildCtx({ bindings: { baseUrl: undefined, restBaseUrl: 'https://rest.example/cnddos' } })).baseUrl, 'https://rest.example/cnddos');
  assert.equal(_test.buildEnv(buildCtx({ bindings: { baseUrl: undefined, restBaseUrl: undefined, host: 'https://host.example/cnddos', remark: '', ipdirection: 'bad', ipstate: 'bad', listtype: '' } })).remark, '万象IP封禁');
  assert.equal(_test.resolveCallContext({ request: { ip: '1.1.1.1' } }).req.ip, '1.1.1.1');
  assert.equal(_test.extractRequestId({ requestId: 123 }), '123');
  assert.equal(_test.extractRequestId({}), '');
  assert.equal(_test.deriveStatus(1, 0), OPERATION_STATUS.SUCCESS);
  assert.equal(_test.deriveStatus(1, 1), OPERATION_STATUS.PARTIAL);
  assert.equal(_test.deriveStatus(0, 1), OPERATION_STATUS.FAILED);
  assert.equal(_test.mapHttpStatus(401), 'PERMISSION_DENIED');
  assert.equal(_test.mapHttpStatus(418), 'FAILED_PRECONDITION');
  assert.equal(_test.mapHttpStatus(503), 'UNAVAILABLE');
  assert.equal(_test.isBlockSuccess('-391201'), true);
  assert.equal(_test.isBlockSuccess('-1'), false);
  assert.equal(_test.isRemoveSuccess('-391204'), true);
  assert.equal(_test.isRemoveSuccess('-1'), false);

  let logged = '';
  console.log = (line) => { logged = line; };
  _test.buildLogger({ instanceId: 'inst2', requestId: 'req2' })('info', 'action', { token: 'abcdef', password: 'secret' });
  assert.match(logged, /inst=inst2 req=req2/);
  assert.match(logged, /ab\*\*\*ef/);
  assert.doesNotMatch(logged, /secret/);

  await _test.logout({ log: () => {}, baseUrl: 'https://venus.example.com/cnddos', headers: {}, timeoutMs: 1 }, '');

  setFetch(async () => responseOf(200, ''));
  assert.deepEqual(await _test.requestDevice({ baseUrl: 'https://venus.example.com/cnddos', headers: {}, timeoutMs: 1 }, { path: '/empty' }), {});

  setFetch(async (url, init) => {
    assert.equal(init.body, 'raw-body');
    assert.equal(init.headers.Authorization, 'Bearer tok');
    assert.equal(init.headers.extra, 'yes');
    return responseOf(200, JSON.stringify({ ok: true }));
  });
  assert.deepEqual(await _test.requestDevice(
    { baseUrl: 'https://venus.example.com/cnddos', headers: {}, timeoutMs: 1 },
    { path: '/raw', method: 'POST', body: 'raw-body', token: 'tok', headers: { extra: 'yes' } },
  ), { ok: true });
});
