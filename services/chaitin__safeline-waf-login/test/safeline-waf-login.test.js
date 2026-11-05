import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { GrpcError } from '@chaitin-ai/octobus-sdk';
import { handlers, _test } from '../src/safeline-waf-login.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const method = (name) => `Chaitin_WAF_SAFELINE_LOGIN.Chaitin_WAF_SAFELINE_LOGIN/${name}`;
const originalFetch = globalThis.fetch;

const context = (url, request = {}, overrides = {}) => ({
  request,
  config: { endpoint: url, timeoutMs: 2000, ...(overrides.config ?? {}) },
  secret: { bindUser: 'admin', bindPassword: 'secret', ...(overrides.secret ?? {}) },
});

const invoke = (name, ctx) => handlers[method(name)](ctx);

const login = async (mock) => {
  const response = await invoke('Login', context(mock.url));
  assert.equal(response.code, 0);
  assert.equal(response.msg, 'ok');
  assert.equal(response.username, mock.username);
  assert.deepEqual(response.permissions, mock.permissions);
  assert.ok(response.session_token);
  return response.session_token;
};

test.beforeEach(() => _test.clearSessions());
test.afterEach(() => { globalThis.fetch = originalFetch; mock.restoreAll(); });

test('production service exports every proto RPC handler', () => {
  assert.deepEqual(Object.keys(service.handlers).sort(), Object.keys(handlers).sort());
  const names = ['Login', 'GetProfile', 'GetOverview', 'SearchDetectLog', 'GetESIndices'];
  assert.deepEqual(Object.keys(handlers).sort(), names.map(method).sort());
});

test('login obtains csrftoken then sessionid and read methods use the session cookie', async () => {
  const mock = await createMockServer();
  try {
    const token = await login(mock);

    const profile = await invoke('GetProfile', context(mock.url, { session_token: token }));
    assert.deepEqual(profile.err, { nullValue: 'NULL_VALUE' });
    assert.equal(profile.data.username, 'admin');
    assert.deepEqual(profile.data.permissions, mock.permissions);

    const overview = await invoke('GetOverview', context(mock.url, {
      session_token: token, duration: 'today', total: { value: true },
      location: 'world', src_ip: 'attack', attack_type: 'attack', risk_level: 'attack', host: 'attack',
    }));
    assert.equal(overview.data.total.attack, 3);
    const overviewReq = mock.requests.find((r) => r.method === 'GET /api/OverviewAPI');
    assert.equal(overviewReq.query.duration, 'today');
    assert.equal(overviewReq.query.total, 'true');
    assert.equal(overviewReq.query.location, 'world');

    const log = await invoke('SearchDetectLog', context(mock.url, {
      session_token: token, count: { value: 10 }, offset: { value: 0 },
      time_range_start: { value: 1700000000 }, time_range_end: { value: 1700100000 },
      filters: {
        fields: {
          attack_type__in: { kind: { case: 'listValue', value: { values: [
            { kind: { case: 'stringValue', value: 'sqli' } },
            { kind: { case: 'stringValue', value: 'xss' } },
          ] } } },
          src_ip__exact: { kind: { case: 'stringValue', value: '1.1.1.1' } },
        },
      },
    }));
    assert.equal(log.data.total, 1);
    assert.equal(log.data.items[0].event_id, 'evt-1');
    const logReq = mock.requests.find((r) => r.method === 'GET /api/FilterV2API');
    assert.equal(logReq.query.scope, 'log:detect_log');
    assert.equal(logReq.query.count, '10');
    assert.equal(logReq.query.req_start_time__gte, '1700000000');
    assert.equal(logReq.query['attack_type__in'], 'sqli,xss');

    const es = await invoke('GetESIndices', context(mock.url, { session_token: token, alias: 'detect_log' }));
    assert.equal(es.data.indices[0].health, 'green');
    assert.equal(es.data.alias, 'detect_log');
    const esReq = mock.requests.find((r) => r.method === 'GET /api/ESIndices');
    assert.equal(esReq.query.alias, 'detect_log');

    // 所有读请求都带上了 sessionid cookie（CSRFTokenAPI 是取 csrftoken，不带 sessionid）
    const readMethods = ['GET /api/ProfileAPI', 'GET /api/OverviewAPI', 'GET /api/FilterV2API', 'GET /api/ESIndices'];
    for (const r of mock.requests) {
      if (readMethods.includes(r.method)) {
        assert.ok(r.headers.cookie.includes(`sessionid=${mock.sessionid}`), r.method);
      }
    }
  } finally {
    await mock.close();
  }
});

test('validation and authentication failures use gRPC errors', async () => {
  await assert.rejects(() => invoke('Login', context('http://example.test', {}, { secret: { bindPassword: '' } })), /password is required/);
  await assert.rejects(() => invoke('Login', context('http://example.test', {}, { config: { endpoint: '' } })), /endpoint is required/);
  await assert.rejects(() => invoke('GetProfile', context('http://example.test', {})), /session_token is required/);
  await assert.rejects(() => invoke('GetProfile', context('http://example.test', { session_token: 'missing' })), /invalid or expired/);
  await assert.rejects(() => invoke('GetOverview', context('http://example.test', { session_token: 'x' })), /duration is required/);
  const mock = await createMockServer();
  try {
    await login(mock);
    await assert.rejects(() => invoke('Login', context(mock.url, {}, { secret: { bindPassword: 'bad' } })), /password-error/);
  } finally {
    await mock.close();
  }
});

test('permission denied from upstream invalidates the session', async () => {
  const mock = await createMockServer();
  try {
    const token = await login(mock);
    // 用坏 sessionid 模拟上游 login-required：直接塞一个会触发 throwForBusinessError 的响应
    globalThis.fetch = async () => new Response(JSON.stringify({ err: 'login-required', msg: 'expired', data: null }), { status: 200, headers: { 'content-type': 'application/json' } });
    await assert.rejects(() => invoke('GetProfile', context(mock.url, { session_token: token })), /PERMISSION_DENIED/);
    assert.equal(_test.getSession(token), null);
  } finally {
    globalThis.fetch = originalFetch;
    await mock.close();
  }
});

test('transport maps timeout, network and HTTP errors', async () => {
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  await assert.rejects(() => invoke('Login', context('http://example.test', {}, { config: { timeoutMs: 5 } })), /DEADLINE_EXCEEDED/);
  globalThis.fetch = async () => { throw new Error('connection refused'); };
  await assert.rejects(() => invoke('Login', context('http://example.test')), /UNAVAILABLE/);
  globalThis.fetch = async () => new Response('not-json', { status: 200 });
  await assert.rejects(() => invoke('Login', context('http://example.test')), /not valid JSON/);
  globalThis.fetch = async () => new Response('forbidden', { status: 403 });
  await assert.rejects(() => invoke('Login', context('http://example.test')), /PERMISSION_DENIED/);
  globalThis.fetch = async () => new Response('boom', { status: 500 });
  await assert.rejects(() => invoke('Login', context('http://example.test')), /UNAVAILABLE/);
});

test('helpers cover protobuf values, config resolution and cookies', () => {
  assert.deepEqual(_test.toValue('x'), { stringValue: 'x' });
  assert.deepEqual(_test.toValue(1), { numberValue: 1 });
  assert.deepEqual(_test.toValue(true), { boolValue: true });
  assert.deepEqual(_test.toValue([1, null]).listValue.values, [{ numberValue: 1 }, { nullValue: 'NULL_VALUE' }]);
  assert.deepEqual(_test.toValue({ a: 'x' }), { structValue: { fields: { a: { stringValue: 'x' } } } });
  assert.deepEqual(_test.toValue(undefined), { nullValue: 'NULL_VALUE' });
  assert.deepEqual(_test.toValue(null), { nullValue: 'NULL_VALUE' });
  assert.equal(_test.toBoolean({ value: 'true' }), true);
  assert.equal(_test.toBoolean('false'), false);
  assert.equal(_test.toBoolean(1), true);
  assert.equal(_test.toBoolean(0), false);
  assert.equal(_test.toBoolean('yes'), null);
  assert.equal(_test.toQueryNumber(5), 5);
  assert.equal(_test.toQueryNumber(0), undefined);
  assert.equal(_test.toQueryNumber(0, true), 0);
  assert.equal(_test.toQueryNumber(-1), undefined);
  assert.equal(_test.toInt64({ value: '42' }), 42);
  assert.equal(_test.toInt64('bad'), null);
  assert.equal(_test.normalizeBaseUrl('https://example.test///'), 'https://example.test');
  assert.equal(_test.normalizeBaseUrl('ftp://bad'), '');
  assert.equal(_test.resolveBaseUrl({ endpoint: 'https://a.test' }), 'https://a.test');
  assert.equal(_test.resolveBaseUrl({ restBaseUrl: 'https://b.test' }), 'https://b.test');
  assert.equal(_test.resolveTimeoutMs({ timeoutMs: 12 }), 12);
  assert.equal(_test.resolveTimeoutMs({ timeoutMs: -1 }), 1500);
  assert.equal(_test.resolveProxyUrl({ proxy_url: 'socks5://127.0.0.1:1080' }), 'socks5://127.0.0.1:1080');
  assert.equal(_test.resolveSkipTlsVerify({ skipTlsVerify: true }), true);
  assert.equal(_test.cookiePair('sid=abc; Path=/; HttpOnly'), 'sid=abc');
  assert.equal(_test.findCookieValue(['csrf=xyz; Path=/', 'sid=abc; Path=/'], 'sid'), 'abc');
  assert.deepEqual(_test.readSetCookies({ headers: { getSetCookie: () => ['a=1', 'b=2'] } }), ['a=1', 'b=2']);
  assert.deepEqual(_test.readSetCookies({ headers: { get: (n) => n === 'set-cookie' ? 'c=3' : null } }), ['c=3']);
  assert.deepEqual(_test.unwrapValue({ kind: { case: 'stringValue', value: 'x' } }), 'x');
  assert.deepEqual(_test.unwrapValue(null), null);
  assert.deepEqual(_test.unwrapStruct({ fields: { a: { kind: { case: 'numberValue', value: 1 } } } }), { a: 1 });
  assert.deepEqual(_test.mergedBindings({ config: { a: 1 }, secret: { b: 2 } }), { a: 1, b: 2 });
  for (const code of ['INVALID_ARGUMENT', 'FAILED_PRECONDITION', 'PERMISSION_DENIED', 'UNAVAILABLE', 'DEADLINE_EXCEEDED', 'NOT_FOUND', 'INTERNAL', 'UNKNOWN']) {
    assert.ok(_test.errorWithCode(code, 'test') instanceof GrpcError);
  }
});

test('session cache expires entries and remains bounded', () => {
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    _test.setSession('expired', { sessionid: 's' });
    now += 31 * 60 * 1000;
    assert.equal(_test.getSession('expired'), null);
    assert.equal(_test.getSession('missing'), null);
    assert.equal(_test.getSession(''), null);
    for (let index = 0; index <= 1000; index += 1) {
      now += 1;
      _test.setSession(`token-${index}`, { sessionid: 's' });
    }
    assert.equal(_test.querySessions().size, 1000);
    assert.equal(_test.getSession('token-0'), null);
  } finally {
    Date.now = originalNow;
    _test.clearSessions();
  }
});

test('remaining value/error helpers are covered', () => {
  assert.deepEqual(_test.toValue(10n), { stringValue: '10' });
  assert.equal(_test.toBoolean(5), null);
  assert.equal(_test.toBoolean(null), null);
  assert.equal(_test.pickFirst({}, ['nope']), undefined);
  assert.equal(_test.pickFirst({ a: { value: 5 } }, ['a']), 5);

  assert.throws(() => _test.throwForHttpError(400, 'bad'), (e) => e.code === 9);
  assert.throws(() => _test.throwForHttpError(401, 'x'), (e) => e.code === 7);
  assert.throws(() => _test.throwForHttpError(500, 'x'), (e) => e.code === 14);

  assert.throws(() => _test.throwForBusinessError({ err: 'invalid-param', msg: 'm' }), (e) => e.code === 3);
  assert.throws(() => _test.throwForBusinessError({ err: 'not_found', msg: 'm' }), (e) => e.code === 5);
  assert.throws(() => _test.throwForBusinessError({ err: 'login-required' }), (e) => e.code === 7);
  assert.throws(() => _test.throwForBusinessError({ err: 'something-else' }), (e) => e.code === 13);
  assert.doesNotThrow(() => _test.throwForBusinessError({ err: null }));
  assert.doesNotThrow(() => _test.throwForBusinessError({}));
});

test('readJsonResponse handles empty body and content types', async () => {
  assert.equal(await _test.readJsonResponse({ ok: true, headers: { get: () => '' }, text: async () => '' }, 'EMPTY'), 'EMPTY');
  assert.deepEqual(await _test.readJsonResponse({ ok: true, headers: { get: () => 'application/json' }, text: async () => '{"a":1}' }, {}), { a: 1 });
  await assert.rejects(() => _test.readJsonResponse({ ok: true, headers: { get: () => 'text/plain' }, text: async () => 'oops' }, {}), /not valid JSON/);
  await assert.rejects(() => _test.readJsonResponse({ ok: false, status: 404, headers: { get: () => '' }, text: async () => 'gone' }, {}), (e) => e.code === 9);
});

test('doLogin rejects when login response lacks a sessionid cookie', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ err: null, msg: '', data: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  await assert.rejects(() => _test.doLogin({ endpoint: 'http://example.test', bindUser: 'admin', bindPassword: 'secret' }), /did not return a sessionid/);
});

test('read method rejects with missing endpoint even with a valid session', async () => {
  _test.setSession('tok', { sessionid: 's' });
  await assert.rejects(() => invoke('GetProfile', context('', { session_token: 'tok' })), /endpoint is required/);
});

const buildFakeRequest = (statusCode, headers, bodyText) => {
  const resListeners = {};
  const reqListeners = {};
  const res = {
    statusCode,
    headers,
    on: (ev, cb) => { resListeners[ev] = cb; return res; },
  };
  const req = {
    setTimeout: () => req,
    on: (ev, cb) => { reqListeners[ev] = cb; return req; },
    write: () => req,
    end: () => req,
    destroy: (err) => { reqListeners.error?.(err); },
  };
  return {
    req,
    res,
    deliver: () => { resListeners.data?.(Buffer.from(bodyText)); resListeners.end?.(); },
    fail: (err) => reqListeners.error?.(err),
  };
};

test('proxiedFetch and fetchSafeline use the socks5 transport', async () => {
  mock.method(http, 'request', (target, options, cb) => {
    const f = buildFakeRequest(200, { 'content-type': 'application/json', 'set-cookie': ['a=1', 'b=2'] }, '{"ok":true}');
    cb(f.res);
    f.deliver();
    return f.req;
  });

  const res = await _test.proxiedFetch('http://example.test/api', { method: 'GET', headers: {} }, { timeoutMs: 1000, proxyUrl: 'socks5://127.0.0.1:1080', skipTlsVerify: false });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.deepEqual(res.headers.getSetCookie(), ['a=1', 'b=2']);
  assert.equal(await res.text(), '{"ok":true}');

  const sf = await _test.fetchSafeline('http://example.test/api', { method: 'GET', headers: {} }, { proxy_url: 'socks5://127.0.0.1:1080' });
  assert.equal(sf.ok, true);
});

test('proxiedFetch maps network error to UNAVAILABLE', async () => {
  mock.method(http, 'request', (target, options, cb) => {
    const f = buildFakeRequest(200, {}, '');
    cb(f.res);
    setTimeout(() => f.fail(new Error('ECONNREFUSED')), 5);
    return f.req;
  });
  await assert.rejects(() => _test.proxiedFetch('http://example.test/api', {}, { timeoutMs: 1000, proxyUrl: 'socks5://127.0.0.1:1080' }), (e) => e.code === 14);
});

test('proxiedFetch maps timeout to DEADLINE_EXCEEDED', async () => {
  mock.method(http, 'request', (target, options, cb) => {
    const f = buildFakeRequest(200, {}, '');
    cb(f.res);
    setTimeout(() => f.fail(Object.assign(new Error('t'), { code: 'ETIMEDOUT' })), 5);
    return f.req;
  });
  await assert.rejects(() => _test.proxiedFetch('http://example.test/api', {}, { timeoutMs: 1000, proxyUrl: 'socks5://127.0.0.1:1080' }), (e) => e.code === 4);
});

test('fetchSafeline uses insecure dispatcher when skipTlsVerify is set', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ err: null, msg: '', data: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  const res = await _test.fetchSafeline('http://example.test/api', { method: 'GET', headers: {} }, { skipTlsVerify: true, timeoutMs: 1000 });
  assert.equal(res.ok, true);
});
