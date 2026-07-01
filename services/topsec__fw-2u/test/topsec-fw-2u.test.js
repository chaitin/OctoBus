import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_ACTIVATE_FULL,
  METHOD_ACTIVATE_PATH,
  METHOD_ADD_FULL,
  METHOD_ADD_PATH,
  METHOD_DELETE_FULL,
  METHOD_DELETE_PATH,
  METHOD_LOGIN_FULL,
  METHOD_LOGIN_PATH,
  METHOD_LOGOUT_FULL,
  METHOD_LOGOUT_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/topsec-fw-2u.js';
import { service } from '../src/service.js';
import { createMockServer, encodePayload } from './mock_upstream.js';

const originalFetch = globalThis.fetch;

const buildCtx = (overrides = {}) => ({
  serviceId: 'topsec__fw-2u',
  instanceId: 'inst-100',
  config: {
    host: 'https://fw.example.com:4443',
    timeoutMs: 3000,
    ...(overrides.config || {}),
  },
  secret: {
    username: 'api_user',
    password: 'TopSecret!',
    ...(overrides.secret || {}),
  },
  metadata: { request_id: 'req-100', ...(overrides.metadata || {}) },
  limits: { timeoutMs: 3000, ...(overrides.limits || {}) },
});

const callHandler = (method, request = {}, ctx = buildCtx()) => handlers[method]({ ...ctx, request });

const responseOf = (status, body, headers = {}) => ({
  status,
  headers: {
    get(name) {
      return headers[String(name).toLowerCase()] || null;
    },
    getSetCookie() {
      return Array.isArray(headers['set-cookie']) ? headers['set-cookie'] : [];
    },
  },
  arrayBuffer: async () => new TextEncoder().encode(String(body)).buffer,
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
  assert.equal(caught.code, ({
    INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
    PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
    UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
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

test('service exports single-argument SDK handlers and rpcdef path handlers', () => {
  assert.equal(typeof service, 'object');
  for (const method of [METHOD_LOGIN_FULL, METHOD_ACTIVATE_FULL, METHOD_ADD_FULL, METHOD_DELETE_FULL, METHOD_LOGOUT_FULL]) {
    assert.equal(typeof handlers[method], 'function');
    assert.equal(handlers[method].length, 0);
  }
  const defs = rpcdef(buildCtx());
  for (const path of [METHOD_LOGIN_PATH, METHOD_ACTIVATE_PATH, METHOD_ADD_PATH, METHOD_DELETE_PATH, METHOD_LOGOUT_PATH]) {
    assert.equal(typeof defs[path], 'function');
  }
});

test('Login uses ctx.secret credentials, ignores request credentials, and sanitizes response', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init, form: Object.fromEntries(new URLSearchParams(init.body).entries()) };
    return responseOf(
      200,
      encodePayload({ result: true, data: { authid: 'u-1' }, tokens: ['fallback-token'], secret: 'sec-1' }, '1234567890abcdef'),
      { 'set-cookie': ['PHPSESSID=sid-1; Path=/', 'changeVsid=0; Path=/'] },
    );
  });

  const res = await callHandler(METHOD_LOGIN_FULL, { username: 'request-user', password: 'request-pass' });
  const decipher = crypto.createDecipheriv('aes-128-cbc', Buffer.from('ngfwrestapilogin'), Buffer.from('ngfwrestapilogin'));
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(Buffer.from(captured.form.password, 'base64')), decipher.final()]).toString('utf8').replace(/\u0000+$/g, '');

  assert.equal(captured.url, 'https://fw.example.com:4443/home/login/addNoCode/');
  assert.equal(captured.form.name, 'api_user');
  assert.equal(decrypted, 'TopSecret!');
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.init.dispatcher, undefined);
  assert.equal(captured.init.timeoutMs, undefined);
  assert.deepEqual(res, { status_code: 200, success: true, message: 'success' });
  assert.equal(Object.hasOwn(res, 'raw_body'), false);
  assert.equal(Object.hasOwn(res, 'session'), false);
});

test('Login supports per-request TLS skip without invalid fetch options', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return responseOf(
      200,
      encodePayload({ result: true, data: { authid: 'u-1' }, tokens: ['tok-1'], secret: 'sec-1' }, '1234567890abcdef'),
      { 'set-cookie': ['PHPSESSID=sid-1; Path=/'] },
    );
  });

  const res = await callHandler(METHOD_LOGIN_FULL, {}, buildCtx({ config: { skipTlsVerify: true } }));

  assert.equal(captured.url, 'https://fw.example.com:4443/home/login/addNoCode/');
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.init.dispatcher, _test.insecureTlsDispatcher);
  assert.equal(captured.init.skipTlsVerify, undefined);
  assert.equal(captured.init.tlsInsecureSkipVerify, undefined);
  assert.equal(captured.init.timeoutMs, undefined);
  assert.deepEqual(res, { status_code: 200, success: true, message: 'success' });
});

test('AddBlacklistIP logs in internally, ignores request session, and returns no token or raw body', async () => {
  const seen = [];
  setFetch(async (url, init) => {
    seen.push({ url: String(url), init, form: Object.fromEntries(new URLSearchParams(init.body || '').entries()) });
    if (String(url).endsWith('/home/login/addNoCode/')) {
      return responseOf(200, encodePayload({ result: true, data: { authid: 'mark-1' }, secret: 'sec-1' }, 'tok-login-1234567'), {
        'set-cookie': ['PHPSESSID=sid-1; Path=/'],
      });
    }
    return responseOf(200, encodePayload({ result: true, data: 'success' }, 'tok-rotated-1234'));
  });

  const res = await callHandler(METHOD_ADD_FULL, {
    session: { token: 'request-token', user_mark: 'request-mark', cookie: 'request-cookie' },
    ips: ['198.51.100.10'],
  });

  assert.equal(seen.length, 2);
  assert.equal(seen[1].url, 'https://fw.example.com:4443/home/default/blackListSpread/addTuple/?userMark=mark-1');
  assert.equal(seen[1].form.token, 'tok-login-1234567');
  assert.equal(seen[1].form['commands[0][pf_blacklist_add_tuple][0][tuple]'], '198.51.100.10,,,,,;');
  assert.deepEqual(res, { status_code: 200, success: true, message: 'success' });
  assert.equal(JSON.stringify(res).includes('tok-'), false);
  assert.equal(JSON.stringify(res).includes('PHPSESSID'), false);
});

test('mock upstream supports internal login cache across add delete logout', async () => {
  const mock = createMockServer();
  const host = await mock.start();
  const ctx = buildCtx({ config: { host }, secret: { username: 'demo', password: 'secret' } });
  try {
    const add = await callHandler(METHOD_ADD_FULL, { ips: ['198.51.100.20'] }, ctx);
    assert.equal(add.success, true);
    const activate = await callHandler(METHOD_ACTIVATE_FULL, {}, ctx);
    assert.equal(activate.success, false);
    assert.equal(activate.status_code, 500);
    const del = await callHandler(METHOD_DELETE_FULL, { ips: ['198.51.100.20'] }, ctx);
    assert.equal(del.success, true);
    const logout = await callHandler(METHOD_LOGOUT_FULL, {}, ctx);
    assert.equal(logout.success, true);
    const missing = await fetch(`${host}/missing`);
    assert.equal(missing.status, 404);
    assert.equal(mock.requests.length, 6);
    assert.deepEqual(mock.requests.map((item) => item.path), [
      '/home/login/addNoCode/',
      '/home/default/blackListSpread/addTuple/',
      '/home/index/',
      '/home/default/blackListSpread/deleteLots/',
      '/home/index/logout/',
      '/missing',
    ]);
  } finally {
    await mock.close();
  }
});

test('validation and upstream failures do not leak raw response material', async () => {
  await expectGrpcError(() => callHandler(METHOD_ADD_FULL, { ips: [] }), 'INVALID_ARGUMENT', (err) => {
    assert.match(err.message, /ips is required/);
  });
  await expectGrpcError(() => callHandler(METHOD_LOGIN_FULL, {}, buildCtx({ secret: { password: '' } })), 'UNAUTHENTICATED');

  setFetch(async () => {
    throw Object.assign(new Error('boom'), { cause: new Error('timeout') });
  });
  await expectGrpcError(() => callHandler(METHOD_LOGIN_FULL), 'UNAVAILABLE', (err) => {
    assert.match(err.message, /timeout/);
    assert.equal(err.message.includes('TopSecret!'), false);
  });

  let requestCount = 0;
  setFetch(async () => {
    requestCount += 1;
    if (requestCount === 1) {
      return responseOf(
        200,
        encodePayload({ result: true, data: { authid: 'u-1' }, tokens: ['tok-1'], secret: 'sec-1' }, '1234567890abcdef'),
        { 'set-cookie': ['PHPSESSID=sid-1; Path=/'] },
      );
    }
    return responseOf(500, 'server error token=secret-token password=TopSecret!');
  });
  const failure = await callHandler(METHOD_ACTIVATE_FULL);
  assert.equal(failure.status_code, 500);
  assert.equal(failure.success, false);
  assert.equal(JSON.stringify(failure).includes('secret-token'), false);
  assert.equal(JSON.stringify(failure).includes('TopSecret!'), false);
});

test('helper functions cover payload, cookie, cache, and scalar branches', () => {
  assert.equal(_test.grpcCodeFor('BOGUS'), grpcStatus.UNKNOWN);
  const detailed = _test.errorWithCode('UNKNOWN', 'msg', { reason: 'r' });
  assert.equal(detailed.details.reason, 'r');
  assert.equal(_test.hasOwn(null, 'x'), false);
  assert.equal(_test.unwrapScalar(undefined), undefined);
  assert.deepEqual(_test.unwrapScalar({ other: true }), { other: true });
  assert.equal(_test.readString(null), '');
  assert.equal(_test.readString({ value: { value: 'deep' } }), 'deep');
  assert.equal(_test.firstDefined(undefined, null, 'x'), 'x');
  assert.equal(_test.firstDefined(undefined, null), undefined);
  assert.equal(_test.resolveCallContext({ metadata: { request_id: 'm' }, request: { host: 'h' }, config: { a: 1 }, secret: { a: 2 } }).bindings.a, 2);
  assert.throws(() => _test.normalizeHost('fw.example.com'), /INVALID_ARGUMENT/);
  assert.throws(() => _test.resolveHost({}, { bindings: {} }), /INVALID_ARGUMENT/);
  assert.equal(_test.resolveHost({ baseUrl: 'https://base.example/' }, { bindings: {} }), 'https://base.example');
  assert.equal(_test.resolveHost({ base_url: 'https://base-url.example/' }, { bindings: {} }), 'https://base-url.example');
  assert.equal(_test.resolveHost({}, { bindings: { restBaseUrl: 'https://rest.example/' } }), 'https://rest.example');
  assert.throws(() => _test.resolveLoginUsername({}, { secret: { username: '' }, bindings: { name: 'fallback-name' } }), /INVALID_ARGUMENT/);
  assert.equal(_test.resolveLoginUsername({}, { secret: {}, bindings: { name: 'fallback-name' } }), 'fallback-name');
  assert.equal(_test.resolveLoginPassword({}, { secret: {}, bindings: { password: 'binding-pass' } }), 'binding-pass');
  assert.throws(() => _test.resolveLoginUsername({}, { secret: {}, bindings: {} }), /INVALID_ARGUMENT/);
  assert.throws(() => _test.resolveLoginPassword({}, { secret: {}, bindings: {} }), /UNAUTHENTICATED/);
  assert.equal(_test.isIPv4('192.0.2.1'), true);
  assert.equal(_test.isIPv4('01.0.2.1'), false);
  assert.equal(_test.isIPv4('a.0.2.1'), false);
  assert.equal(_test.isIPv4('192.0.2'), false);
  assert.equal(_test.isIPv4('192.0.2.999'), false);
  assert.equal(_test.isIPv6('2001:db8::1'), true);
  assert.equal(_test.isIPv6('::ffff:192.0.2.1'), true);
  assert.equal(_test.isIPv6('2001::db8::1'), false);
  assert.equal(_test.isIPv6('not-ipv6'), false);
  assert.deepEqual(_test.readIpList({ ipList: { values: ['198.51.100.30'] } }), ['198.51.100.30']);
  assert.throws(() => _test.readIpList({ ips: [''] }), /INVALID_ARGUMENT/);
  assert.throws(() => _test.readIpList({ ips: ['not-ip'] }), /INVALID_ARGUMENT/);
  assert.deepEqual(_test.unwrapList({ value: { values: ['a'] } }), ['a']);
  assert.equal(_test.unwrapList('scalar'), 'scalar');
  assert.equal(_test.readTimeoutMs(_test.resolveCallContext({ request: { timeoutMs: 12 } })), 12);
  assert.equal(_test.readTimeoutMs(_test.resolveCallContext({ request: { timeout_ms: 13 } })), 13);
  assert.equal(_test.readTimeoutMs(_test.resolveCallContext({ config: { timeout_ms: 14 } })), 14);
  assert.equal(_test.readTimeoutMs(_test.resolveCallContext({ config: { timeoutMs: -1 }, limits: { timeoutMs: -1 } })), 5000);
  assert.equal(_test.toBoolean(true), true);
  assert.equal(_test.toBoolean(0), false);
  assert.equal(_test.toBoolean('yes'), true);
  assert.equal(_test.toBoolean('off'), false);
  assert.equal(_test.toBoolean('maybe'), false);
  assert.equal(_test.buildTlsOptions({ bindings: { tlsInsecureSkipVerify: true } }).dispatcher, _test.insecureTlsDispatcher);
  assert.equal(_test.buildTlsOptions({ bindings: { insecureSkipVerify: true } }).dispatcher, _test.insecureTlsDispatcher);
  assert.equal(_test.normalizeCookie('a=1; a=2; think_language=en'), 'a=1; think_language=en');
  assert.equal(_test.normalizeCookie(''), 'think_language=zh-cn');
  assert.equal(_test.gatherCookies(null), '');
  assert.equal(_test.gatherCookies({ getSetCookie: () => ['a=1; Path=/'] }), 'a=1');
  assert.equal(_test.gatherCookies({ raw: () => ({}) }), '');
  assert.equal(_test.gatherCookies({ get: () => 'a=1; Path=/,b=2; Path=/' }), 'a=1; b=2');
  assert.equal(_test.gatherCookies({ 'set-cookie': 'c=3; Path=/' }), 'c=3');
  assert.equal(_test.gatherCookies({ raw: () => ({ 'set-cookie': ['a=1; Path=/', 'b=2; Path=/'] }) }), 'a=1; b=2');
  assert.deepEqual(_test.tryParseJson('bad'), undefined);
  assert.equal(_test.tryDecodeBase64Json(Buffer.from('bad').toString('base64')), null);
  assert.equal(_test.tryDecodeBase64Json('not-base64'), null);
  assert.equal(_test.base64EncodeBytes(_test.base64DecodeToBytes(' YWJj ')), 'YWJj');
  assert.equal(_test.decodeTopSecPayload(Buffer.from(JSON.stringify({ ok: true })).toString('base64')).parsed.ok, true);
  assert.equal(_test.decodeTopSecPayload('').parsed, undefined);
  assert.equal(_test.decodeTopSecPayload(JSON.stringify({ ok: true })).parsed.ok, true);
  assert.equal(_test.decodeTopSecPayload('?tok' + Buffer.from(JSON.stringify({ ok: true })).toString('base64')).rotatedToken, 'tok');
  assert.equal(_test.decodeTopSecPayload('not-base64').parsed, undefined);
  assert.equal(_test.pickFirstToken({ data: { tokens: ['nested-token'] } }), 'nested-token');
  assert.equal(_test.pickFirstToken({}), '');
  assert.equal(_test.buildSessionFromLogin(null, null, null), null);
  assert.equal(_test.buildSessionFromLogin({ result: true }, null, null), null);
  assert.equal(_test.buildSessionFromLogin({ data: { tokens: ['tok'], user_mark: 'mark' } }, { get: () => 'sid=1' }, null).token, 'tok');
  assert.deepEqual(_test.buildRefreshedSession({ token: 'old', userMark: 'mark', cookie: 'c', secret: 's' }, { data: { token: 'new', user_mark: 'mark2' }, secret: 's2' }, '').token, 'new');
  assert.deepEqual(_test.buildRefreshedSession({ token: 'old', user_mark: 'mark', cookie: 'c', secret: 's' }, {}, 'rotated').token, 'rotated');
  assert.equal(_test.sessionUserMark({ userMark: 'camel' }), 'camel');
  assert.deepEqual(_test.addTraceHeaders({}, {}), {});
  assert.deepEqual(_test.addTraceHeaders({}, { instanceId: 'i', requestId: 'r' }), { 'x-engine-instance': 'i', 'x-request-id': 'r' });
  assert.equal(_test.buildUrl('https://h', '/p/', { a: '1', b: '', c: null }), 'https://h/p/?a=1');
  assert.equal(_test.buildUrl('https://h', '/p/'), 'https://h/p/');
  assert.equal(_test.refererForUserMark('https://h', 'u 1'), 'https://h/home/index/?userMark=u%201');
  assert.equal(_test.buildActivateBody(), '');
  assert.match(_test.buildDeleteBody(['1.1.1.1'], 'tok'), /token=tok/);
  assert.equal(_test.buildBaseResponse(500, '').message, 'upstream http 500');
  assert.deepEqual(_test.buildBaseResponse(204, ''), { status_code: 204, success: true, message: 'success' });
  assert.equal(_test.cacheIdentity(buildCtx(), 'https://fw', 'u'), JSON.stringify(['topsec__fw-2u', 'inst-100', 'https://fw', 'u']));
  assert.equal(_test.cacheIdentity({ meta: { serviceId: 'svc', instanceId: 'inst' } }, 'h', 'u'), JSON.stringify(['svc', 'inst', 'h', 'u']));
});

test('response body helper covers text and failure branches', async () => {
  await expectGrpcError(() => _test.readResponseBodyText({ arrayBuffer: async () => { throw new Error('bad buffer'); } }), 'UNKNOWN');
  await expectGrpcError(() => _test.readResponseBodyText({ text: async () => { throw new Error('bad text'); } }), 'UNKNOWN');
  assert.equal(await _test.readResponseBodyText({ text: async () => 'plain text' }), 'plain text');
  assert.equal(await _test.readResponseBodyText({}), '');

  setFetch(async () => ({ text: async () => 'no status' }));
  const fetched = await _test.fetchText(buildCtx(), 'https://fw.example.com/p', { method: 'GET' });
  assert.equal(fetched.statusCode, 0);
  assert.equal(fetched.rawBody, 'no status');
});
