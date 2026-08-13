import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_BLOCK_IP_FULL,
  METHOD_BLOCK_IP_PATH,
  METHOD_UNBLOCK_IP_FULL,
  METHOD_UNBLOCK_IP_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/wd-k01.js';
import { service } from '../src/service.js';
import { PASSWORD, USERNAME, createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;

const buildCtx = (overrides = {}) => ({
  bindings: {
    host: 'https://device.example:8443',
    user: USERNAME,
    password: PASSWORD,
    headers: { 'x-env': 'test' },
    ...(overrides.bindings || {}),
  },
  config: overrides.config || {},
  secret: overrides.secret || {},
  limits: { timeoutMs: 10_000, ...(overrides.limits || {}) },
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
});

test('service exports handlers and rpcdef path handlers', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers[METHOD_BLOCK_IP_FULL], 'function');
  assert.equal(typeof handlers[METHOD_UNBLOCK_IP_FULL], 'function');
  const defs = rpcdef(buildCtx());
  assert.equal(typeof defs[METHOD_BLOCK_IP_PATH], 'function');
  assert.equal(typeof defs[METHOD_UNBLOCK_IP_PATH], 'function');
});

test('mock upstream supports block and unblock workflow', async () => {
  const mock = createMockServer();
  const host = await mock.start();
  try {
    const ctx = buildCtx({ bindings: { host, skipTlsVerify: true } });
    const block = await callHandler(METHOD_BLOCK_IP_FULL, { ip: '1.1.1.1', comment: 'c', type: 1, timeout: 60, time_type: 60, color: 0 }, ctx);
    assert.equal(block.success, true);
    assert.equal(block.msg_type, 'success');
    assert.equal(block.login_raw_json, '');
    assert.equal(block.logout_raw_text, '[redacted]');

    const unblock = await callHandler(METHOD_UNBLOCK_IP_FULL, { ip: '1.1.1.1', color: 0, type: 1 }, ctx);
    assert.equal(unblock.success, true);
    assert.equal(unblock.computed_ip, '1.1.1.1/32');
    assert.equal(unblock.computed_id, '1.1.1.1/32;0;1');
    assert.equal(mock.requests.length, 6);
  } finally {
    await mock.close();
  }
});

test('BlockIP sends expected payload, headers, and TLS options', async () => {
  const calls = [];
  setFetch(async (url, init) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : null });
    if (String(url).endsWith('/api/cms/user/login')) return responseOf(200, JSON.stringify({ token: { access_token: 'tok' } }));
    if (String(url).endsWith('/api/v1/security/iplist/save')) return responseOf(200, JSON.stringify({ msgType: 'success', msg: 'ok' }));
    return responseOf(200, JSON.stringify({ ok: true }));
  });

  const res = await callHandler(METHOD_BLOCK_IP_FULL, { IP: '2.2.2.2', type: '1', timeout: '30', timeType: '60', remark: 'r', color: '1' }, buildCtx({ bindings: { tlsInsecureSkipVerify: true } }));
  assert.equal(res.success, true);
  assert.equal(calls[0].init.headers['x-env'], 'test');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal(calls[0].init.dispatcher, _test.insecureTlsDispatcher);
  assert.equal(calls[0].init.tlsInsecureSkipVerify, undefined);
  assert.equal(calls[1].init.headers.authorization, 'Bearer tok');
  assert.deepEqual(calls[1].body, {
    color: 1,
    method: 'add',
    items: [{ type: 1, ip: '2.2.2.2', timeout: 30, time_type: 60, comment: 'r' }],
  });
});

test('UnblockIP computes masked ID and preserves request aliases', async () => {
  const calls = [];
  setFetch(async (url, init) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : null });
    if (String(url).endsWith('/api/cms/user/login')) return responseOf(200, JSON.stringify({ token: { accessToken: 'tok' } }));
    if (String(url).endsWith('/api/v1/security/iplist/save')) return responseOf(200, JSON.stringify({ msgType: 'error', msg: '对象不存在' }));
    return responseOf(200, '');
  });

  const res = await callHandler(METHOD_UNBLOCK_IP_FULL, { address: '3.3.3.3/24', type: 1, color: 1 }, buildCtx());
  assert.equal(res.success, true);
  assert.equal(res.computed_ip, '3.3.3.3/24');
  assert.equal(res.computed_id, '3.3.3.3/24;1;1');
  assert.deepEqual(calls[1].body, {
    color: 1,
    method: 'delete',
    items: [{ id: '3.3.3.3/24;1;1', type: 1, ip: '3.3.3.3/24' }],
  });
});

test('idempotent semantic success messages are preserved', async () => {
  setFetch(async (url) => {
    if (String(url).endsWith('/api/cms/user/login')) return responseOf(200, JSON.stringify({ token: { access_token: 'tok' } }));
    if (String(url).endsWith('/api/cms/user/logout')) return responseOf(200, '');
    return responseOf(200, JSON.stringify({ msgType: 'error', msg: '多播地址' }));
  });
  const block = await callHandler(METHOD_BLOCK_IP_FULL, { ip: '4.4.4.4' }, buildCtx());
  assert.equal(block.success, true);
  const unblock = await callHandler(METHOD_UNBLOCK_IP_FULL, { ip: '4.4.4.4' }, buildCtx());
  assert.equal(unblock.success, true);

  setFetch(async (url) => {
    if (String(url).endsWith('/api/cms/user/login')) return responseOf(200, JSON.stringify({ token: { access_token: 'tok' } }));
    if (String(url).endsWith('/api/cms/user/logout')) return responseOf(200, '');
    return responseOf(200, JSON.stringify({ msgType: 'error', msg: '已存在: 4.4.4.4' }));
  });
  const exists = await callHandler(METHOD_BLOCK_IP_FULL, { ip: '4.4.4.4' }, buildCtx());
  assert.equal(exists.success, true);
});

test('logout failure is recorded but does not override success', async () => {
  const logs = [];
  console.log = (...args) => logs.push(args.join(' '));
  setFetch(async (url) => {
    if (String(url).endsWith('/api/cms/user/login')) return responseOf(200, JSON.stringify({ token: { access_token: 'tok' } }));
    if (String(url).endsWith('/api/v1/security/iplist/save')) return responseOf(200, JSON.stringify({ msgType: 'success', msg: 'ok' }));
    return responseOf(500, 'server error');
  });

  const res = await callHandler(METHOD_BLOCK_IP_FULL, { ip: '1.1.1.1' }, buildCtx());
  assert.equal(res.success, true);
  assert.equal(res.logout_raw_text, '[redacted]');
  assert.ok(logs.some((line) => line.includes('success":false')));
});

test('rpcdef merges context request and handler request', async () => {
  let savePayload;
  setFetch(async (url, init) => {
    if (String(url).endsWith('/api/cms/user/login')) return responseOf(200, JSON.stringify({ token: { access_token: 'tok' } }));
    if (String(url).endsWith('/api/v1/security/iplist/save')) {
      savePayload = JSON.parse(init.body);
      return responseOf(200, JSON.stringify({ msgType: 'success', msg: 'ok' }));
    }
    return responseOf(200, '');
  });
  const defs = rpcdef(buildCtx({ req: { ip: '5.5.5.5', comment: 'ctx' } }));
  const res = await defs[METHOD_BLOCK_IP_PATH]({ comment: 'incoming' });
  assert.equal(res.success, true);
  assert.equal(savePayload.items[0].comment, 'incoming');
  assert.equal(savePayload.items[0].ip, '5.5.5.5');
});

test('validation and upstream errors map to gRPC errors', async () => {
  await expectGrpcError(() => callHandler(METHOD_BLOCK_IP_FULL, { ip: '1.1.1.1' }, buildCtx({ bindings: { host: '' } })), 'INVALID_ARGUMENT');
  await expectGrpcError(() => callHandler(METHOD_BLOCK_IP_FULL, { ip: '1.1.1.1' }, buildCtx({ bindings: { user: '', username: '' } })), 'INVALID_ARGUMENT');
  await expectGrpcError(() => callHandler(METHOD_BLOCK_IP_FULL, { ip: '1.1.1.1' }, buildCtx({ bindings: { password: '' } })), 'INVALID_ARGUMENT');
  await expectGrpcError(() => callHandler(METHOD_BLOCK_IP_FULL, { ip: '' }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => callHandler(METHOD_BLOCK_IP_FULL, { ip: '999.1.1.1' }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => callHandler(METHOD_UNBLOCK_IP_FULL, { ip: '1.1.1.1/33' }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => callHandler(METHOD_UNBLOCK_IP_FULL, { ip: '1.1.1.1/x' }, buildCtx()), 'INVALID_ARGUMENT');

  setFetch(async () => responseOf(200, JSON.stringify({ error: 'missing credentials' })));
  await expectGrpcError(() => callHandler(METHOD_BLOCK_IP_FULL, { ip: '1.1.1.1' }, buildCtx()), 'FAILED_PRECONDITION', (err) => assert.match(err.message, /用户登录失败/));

  setFetch(async (url) => {
    if (String(url).endsWith('/api/cms/user/login')) return responseOf(200, JSON.stringify({ token: {} }));
    return responseOf(200, '');
  });
  await expectGrpcError(() => callHandler(METHOD_BLOCK_IP_FULL, { ip: '1.1.1.1' }, buildCtx()), 'FAILED_PRECONDITION');

  setFetch(async () => responseOf(403, 'forbidden'));
  await expectGrpcError(() => callHandler(METHOD_BLOCK_IP_FULL, { ip: '1.1.1.1' }, buildCtx()), 'PERMISSION_DENIED');

  setFetch(async () => responseOf(404, 'not found'));
  await expectGrpcError(() => callHandler(METHOD_BLOCK_IP_FULL, { ip: '1.1.1.1' }, buildCtx()), 'FAILED_PRECONDITION');

  setFetch(async () => responseOf(500, 'broken'));
  await expectGrpcError(() => callHandler(METHOD_BLOCK_IP_FULL, { ip: '1.1.1.1' }, buildCtx()), 'UNAVAILABLE');

  setFetch(async () => responseOf(200, ''));
  await expectGrpcError(() => callHandler(METHOD_BLOCK_IP_FULL, { ip: '1.1.1.1' }, buildCtx()), 'UNKNOWN');

  setFetch(async () => responseOf(200, 'not-json'));
  await expectGrpcError(() => callHandler(METHOD_BLOCK_IP_FULL, { ip: '1.1.1.1' }, buildCtx()), 'UNKNOWN');

  setFetch(async () => { throw Object.assign(new Error('outer'), { cause: new Error('timeout') }); });
  await expectGrpcError(() => callHandler(METHOD_BLOCK_IP_FULL, { ip: '1.1.1.1' }, buildCtx()), 'UNAVAILABLE', (err) => assert.match(err.message, /timeout/));

  setFetch(async () => { throw 'boom'; });
  await expectGrpcError(() => callHandler(METHOD_BLOCK_IP_FULL, { ip: '1.1.1.1' }, buildCtx()), 'UNAVAILABLE', (err) => assert.match(err.message, /fetch failed/));

  setFetch(async (url) => {
    if (String(url).endsWith('/api/cms/user/login')) return responseOf(200, JSON.stringify({ token: { access_token: 'tok' } }));
    if (String(url).endsWith('/api/cms/user/logout')) return responseOf(200, '');
    return responseOf(200, JSON.stringify({ msgType: 'error', msg: 'bad request' }));
  });
  await expectGrpcError(() => callHandler(METHOD_BLOCK_IP_FULL, { ip: '1.1.1.1' }, buildCtx()), 'FAILED_PRECONDITION', (err) => assert.match(err.message, /bad request/));
  await expectGrpcError(() => callHandler(METHOD_UNBLOCK_IP_FULL, { ip: '1.1.1.1' }, buildCtx()), 'FAILED_PRECONDITION', (err) => assert.match(err.message, /bad request/));
});

test('action failure still attempts logout and logs logout failure', async () => {
  const logs = [];
  console.log = (...args) => logs.push(args.join(' '));
  let logoutCalled = false;
  setFetch(async (url) => {
    if (String(url).endsWith('/api/cms/user/login')) return responseOf(200, JSON.stringify({ token: { access_token: 'tok' } }));
    if (String(url).endsWith('/api/v1/security/iplist/save')) return responseOf(200, JSON.stringify({ msgType: 'error', msg: 'bad request' }));
    logoutCalled = true;
    return responseOf(500, 'logout failed');
  });

  await expectGrpcError(() => callHandler(METHOD_BLOCK_IP_FULL, { ip: '1.1.1.1' }, buildCtx()), 'FAILED_PRECONDITION');
  assert.equal(logoutCalled, true);
  assert.ok(logs.some((line) => line.includes('logout failed')));
});

test('mock upstream covers rejection paths', async () => {
  const mock = createMockServer();
  const host = await mock.start();
  try {
    const invalidLoginJson = await fetch(`${host}/api/cms/user/login`, { method: 'POST', body: '{' });
    assert.equal(invalidLoginJson.status, 400);

    const badCredentials = await fetch(`${host}/api/cms/user/login`, { method: 'POST', body: JSON.stringify({ username: USERNAME, password: 'bad' }) });
    assert.equal(badCredentials.status, 200);
    assert.match(await badCredentials.text(), /missing credentials/);

    const unauthorized = await fetch(`${host}/api/v1/security/iplist/save`, { method: 'POST', body: JSON.stringify({ method: 'add', items: [{}] }) });
    assert.equal(unauthorized.status, 401);

    const invalidSaveJson = await fetch(`${host}/api/v1/security/iplist/save`, { method: 'POST', headers: { authorization: 'Bearer token' }, body: '{' });
    assert.equal(invalidSaveJson.status, 400);

    const badRequest = await fetch(`${host}/api/v1/security/iplist/save`, { method: 'POST', headers: { authorization: 'Bearer token' }, body: JSON.stringify({ method: 'add' }) });
    assert.match(await badRequest.text(), /bad request/);

    const unknownMethod = await fetch(`${host}/api/v1/security/iplist/save`, { method: 'POST', headers: { authorization: 'Bearer token' }, body: JSON.stringify({ method: 'update', items: [{}] }) });
    assert.match(await unknownMethod.text(), /unknown method/);

    const missing = await fetch(`${host}/missing`);
    assert.equal(missing.status, 404);
  } finally {
    await mock.close();
  }
});

test('helper functions cover parsing, validation, and branch behavior', () => {
  assert.equal(_test.grpcCodeFor('missing'), grpcStatus.UNKNOWN);
  assert.equal(_test.hasOwn(null, 'value'), false);
  assert.equal(_test.hasOwn({ value: 1 }, 'value'), true);
  assert.equal(_test.unwrapScalar(null), undefined);
  assert.equal(_test.unwrapScalar({ value: { value: 'x' } }), 'x');
  assert.equal(_test.unwrapScalar(3), 3);
  assert.equal(_test.pickStringFrom({ a: { value: ' x ' } }, ['a']), 'x');
  assert.equal(_test.pickStringFrom({ a: '' }, ['a']), '');
  assert.equal(_test.pickStringFrom({ b: ' y ' }, ['a', 'b']), 'y');
  assert.equal(_test.pickFirstString([undefined, ' y ']), 'y');
  assert.equal(_test.pickFirstString([' ', undefined]), '');
  assert.equal(_test.pickFirstString([false]), 'false');
  assert.equal(_test.pickInt({ a: '3.8' }, ['a'], 0), 3);
  assert.equal(_test.pickInt({ a: '' }, ['a'], 7), 7);
  assert.equal(_test.pickInt({ b: 2 }, ['a', 'b'], 0), 2);
  assert.equal(_test.pickInt({ a: 'bad' }, ['a'], 7), 7);
  assert.equal(_test.pickBoolean(true), true);
  assert.equal(_test.pickBoolean(0), false);
  assert.equal(_test.pickBoolean('on'), true);
  assert.equal(_test.pickBoolean('off'), false);
  assert.equal(_test.pickBoolean(''), false);
  assert.equal(_test.pickBoolean(null), undefined);
  assert.equal(_test.pickBoolean(Number.NaN), undefined);
  assert.equal(_test.pickBoolean('maybe'), undefined);
  assert.equal(_test.pickFirstBoolean(['bad', 1]), true);
  assert.equal(_test.pickFirstBoolean(['bad']), undefined);
  assert.equal(_test.pickFirstBoolean([undefined, false]), false);
  assert.equal(_test.normalizeBaseUrl('https://device.example///'), 'https://device.example');
  assert.equal(_test.normalizeBaseUrl({ value: 'http://device.example/' }), 'http://device.example');
  assert.equal(_test.normalizeBaseUrl('device.example'), '');
  assert.equal(_test.resolveHost({ host: 'https://host.example' }), 'https://host.example');
  assert.equal(_test.resolveHost({ restBaseUrl: 'https://rest.example' }), 'https://rest.example');
  assert.equal(_test.resolveHost({ baseUrl: 'https://base.example' }), 'https://base.example');
  assert.equal(_test.resolveHost({}), '');
  assert.equal(_test.resolveUser({ user: 'u' }), 'u');
  assert.equal(_test.resolveUser({ username: 'u' }), 'u');
  assert.equal(_test.resolvePassword({ password: 'p' }), 'p');
  assert.equal(_test.resolveTimeoutMs(_test.resolveCallContext(buildCtx({ limits: { timeoutMs: 33 }, bindings: { timeoutMs: undefined } }))), 33);
  assert.equal(_test.resolveTimeoutMs(_test.resolveCallContext(buildCtx({ limits: { timeoutMs: undefined }, bindings: { timeoutMs: 25 } }))), 25);
  assert.equal(_test.resolveTimeoutMs(_test.resolveCallContext(buildCtx({ limits: { timeoutMs: -1 }, bindings: { timeoutMs: 25 } }))), 1500);
  assert.equal(_test.buildTlsOptions({ insecureSkipVerify: 'yes' }).dispatcher, _test.insecureTlsDispatcher);
  assert.equal(_test.buildTlsOptions({ tlsInsecureSkipVerify: true }).dispatcher, _test.insecureTlsDispatcher);
  assert.equal(_test.buildTlsOptions({ skipTlsVerify: 1 }).dispatcher, _test.insecureTlsDispatcher);
  assert.deepEqual(_test.buildTlsOptions({ skipTlsVerify: false }), {});
  assert.deepEqual(_test.sanitizeHeaders({ a: 1, b: { value: false }, '': 'skip' }), { a: '1', b: 'false' });
  assert.deepEqual(_test.sanitizeHeaders(null), {});
  assert.deepEqual(_test.sanitizeHeaders([]), {});
  assert.deepEqual(_test.buildHeaders({ headers: { z: '1' } }, { instanceId: 'inst2', requestId: 'req2' }, { a: 'b' }), { z: '1', 'x-engine-instance': 'inst2', 'x-request-id': 'req2', a: 'b' });
  assert.deepEqual(_test.buildHeaders({}, {}, { a: 'b' }), { 'x-engine-instance': 'unknown', 'x-request-id': 'unknown', a: 'b' });
  assert.deepEqual(_test.parseJsonBody('{"ok":true}'), { ok: true });
  assert.throws(() => _test.parseJsonBody('bad'), /UNKNOWN/);
  assert.throws(() => _test.throwForHttpStatus(401, 'no'), /PERMISSION_DENIED/);
  assert.throws(() => _test.throwForHttpStatus(403, 'no'), /PERMISSION_DENIED/);
  assert.throws(() => _test.throwForHttpStatus(404, 'no'), /FAILED_PRECONDITION/);
  assert.throws(() => _test.throwForHttpStatus(500, 'no'), /UNAVAILABLE/);
  assert.equal(_test.isIPv4('1.1.1.1'), true);
  assert.equal(_test.isIPv4('1.1.1'), false);
  assert.equal(_test.isIPv4('1.1.1.256'), false);
  assert.equal(_test.isIPv4('1.1.1.a'), false);
  assert.equal(_test.isIPv4('1.1.1.0000'), false);
  assert.equal(_test.requireIpv4(' 1.1.1.1 '), '1.1.1.1');
  assert.deepEqual(_test.normalizeIpMask('1.1.1.1'), { ip: '1.1.1.1', ipWithMask: '1.1.1.1/32' });
  assert.deepEqual(_test.normalizeIpMask('1.1.1.1/0'), { ip: '1.1.1.1', ipWithMask: '1.1.1.1/0' });
  assert.deepEqual(_test.normalizeIpMask({ value: '1.1.1.1/32' }), { ip: '1.1.1.1', ipWithMask: '1.1.1.1/32' });
  assert.throws(() => _test.normalizeIpMask('1.1.1.1/1/2'), /INVALID_ARGUMENT/);
  assert.throws(() => _test.normalizeIpMask(''), /INVALID_ARGUMENT/);
  assert.equal(_test.normalizeMsgType(' Success '), 'success');
  assert.equal(_test.msgContains('对象不存在', '不存在'), true);
  assert.equal(_test.msgContains(null, '不存在'), false);
  assert.equal(_test.isBlockSemanticSuccess('success', ''), true);
  assert.equal(_test.isBlockSemanticSuccess('error', '已存在'), true);
  assert.equal(_test.isBlockSemanticSuccess('error', '多播地址'), true);
  assert.equal(_test.isBlockSemanticSuccess('error', 'bad'), false);
  assert.equal(_test.isUnblockSemanticSuccess('success', ''), true);
  assert.equal(_test.isUnblockSemanticSuccess('error', '对象不存在'), true);
  assert.equal(_test.isUnblockSemanticSuccess('error', '多播地址'), true);
  assert.equal(_test.isUnblockSemanticSuccess('error', 'bad'), false);
  assert.equal(_test.validateBlockReq({ address: '1.1.1.1', comment: { value: 'c' } }).comment, 'c');
  assert.equal(_test.validateBlockReq({ ip: '1.1.1.1', remark: 'r' }).comment, 'r');
  assert.deepEqual(_test.validateUnblockReq({ IP: '1.1.1.1', color: 1, type: 2 }).computedId, '1.1.1.1/32;1;2');

  const logs = [];
  console.log = (...args) => logs.push(args);
  const circular = {};
  circular.self = circular;
  _test.logFlow({ meta: { instanceId: 'i', requestId: 'r' } }, 'circular', circular);
  assert.equal(logs[0][0], '[WD_K01][circular][inst=i req=r]');
  assert.equal(logs[0][1], circular);
});

test('direct session helpers cover success and cleanup branches', async () => {
  setFetch(async (url, init) => {
    if (String(url).endsWith('/api/cms/user/login')) {
      assert.equal(JSON.parse(init.body).username, USERNAME);
      return responseOf(200, JSON.stringify({ token: { access_token: 'tok' } }));
    }
    if (String(url).endsWith('/api/cms/user/logout')) return responseOf(200, 'logout text');
    return responseOf(200, JSON.stringify({ msgType: 'success', msg: 'ok' }));
  });
  const ctx = buildCtx();
  const login = await _test.handleLogin(ctx);
  assert.equal(login.token, 'tok');
  assert.equal(await _test.handleLogout(ctx, login.token), 'logout text');
  const block = await _test.handleBlock(ctx, login.token, _test.validateBlockReq({ ip: '6.6.6.6' }));
  assert.equal(block.success, true);
  const unblock = await _test.handleUnblock(ctx, login.token, _test.validateUnblockReq({ ip: '6.6.6.6' }));
  assert.equal(unblock.computed_id, '6.6.6.6/32;0;0');
  const session = await _test.withSession(ctx, async () => ({ ok: true }));
  assert.deepEqual(session.result, { ok: true });
  assert.equal(session.logoutText, 'logout text');

  await expectGrpcError(() => _test.requireBindings({ bindings: { host: 'https://h', user: 'u', password: '' } }), 'INVALID_ARGUMENT');
});
