import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_GET_ALARM_TOTAL_FULL,
  METHOD_GET_ASSET_BY_ID_FULL,
  METHOD_GET_CURRENT_USER_FULL,
  METHOD_GET_DASHBOARD_OVERVIEW_FULL,
  METHOD_GET_PCAP_DETAIL_FULL,
  METHOD_HEALTH_CHECK_FULL,
  METHOD_LIST_ASSETS_FULL,
  METHOD_LIST_EVENT_LOGS_FULL,
  METHOD_LOGIN_FULL,
  METHOD_LOGOUT_FULL,
  METHOD_REQUEST_FULL,
  METHOD_TRACK_PCAP_FLOW_FULL,
  _test,
  handlers,
} from '../src/venus-tar.js';
import { service } from '../src/service.js';
import { COOKIE, PASSWORD, TOKEN, USERNAME, createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;

const baseBindings = {
  baseUrl: 'https://tar.example.com',
  username: USERNAME,
  password: PASSWORD,
  checkCode: '1234',
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

const responseOf = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(headers),
  text: async () => String(body),
});

const setFetch = (impl) => {
  globalThis.fetch = impl;
};

const invoke = (method, request = {}, ctx = {}) => handlers[method]({ ...ctx, request });

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
    RESOURCE_EXHAUSTED: grpcStatus.RESOURCE_EXHAUSTED,
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
  _test.clearSessionCache();
});

test('service exports handlers for every proto RPC', () => {
  assert.equal(typeof service, 'object');
  for (const method of [
    METHOD_HEALTH_CHECK_FULL,
    METHOD_LOGIN_FULL,
    METHOD_LOGOUT_FULL,
    METHOD_GET_CURRENT_USER_FULL,
    METHOD_REQUEST_FULL,
    METHOD_GET_DASHBOARD_OVERVIEW_FULL,
    METHOD_GET_ALARM_TOTAL_FULL,
    METHOD_LIST_EVENT_LOGS_FULL,
    METHOD_LIST_ASSETS_FULL,
    METHOD_GET_ASSET_BY_ID_FULL,
    METHOD_GET_PCAP_DETAIL_FULL,
    METHOD_TRACK_PCAP_FLOW_FULL,
  ]) {
    assert.equal(typeof handlers[method], 'function', `${method} handler missing`);
  }
});

test('mock upstream supports login, generic request, core methods, and logout', async () => {
  const mock = createMockServer();
  const host = await mock.start();
  try {
    const ctx = buildCtx({ bindings: { baseUrl: host, skipTlsVerify: true } });
    const login = await invoke(METHOD_LOGIN_FULL, {}, ctx);
    assert.equal(login.authenticated, true);
    assert.match(login.token, /^mock-token-/);

    const user = await invoke(METHOD_GET_CURRENT_USER_FULL, {}, ctx);
    assert.deepEqual(JSON.parse(user.json_body), { userName: USERNAME, role: 'admin' });

    const generic = await invoke(METHOD_REQUEST_FULL, {
      method: 'POST',
      path: '/echo',
      query: { q: 'ioc' },
      headers: { 'x-extra': 'yes' },
      json_body: '{"pageNum":1}',
      request_id: 'generic-1',
    }, ctx);
    assert.equal(generic.status_code, 200);
    assert.equal(generic.request_id, 'generic-1');
    assert.deepEqual(JSON.parse(generic.json_body), { query: { q: 'ioc' }, body: { pageNum: 1 }, header: 'yes' });

    const overview = await invoke(METHOD_GET_DASHBOARD_OVERVIEW_FULL, { json_body: '{"range":"today"}' }, ctx);
    assert.deepEqual(JSON.parse(overview.json_body), { posture: 'stable' });
    const total = await invoke(METHOD_GET_ALARM_TOTAL_FULL, { json_body: '{}' }, ctx);
    assert.equal(JSON.parse(total.json_body), 42);
    const events = await invoke(METHOD_LIST_EVENT_LOGS_FULL, { json_body: '{"pageNum":2}' }, ctx);
    assert.equal(JSON.parse(events.json_body).records[0].pageNum, 2);
    const assets = await invoke(METHOD_LIST_ASSETS_FULL, { json_body: '{}' }, ctx);
    assert.equal(JSON.parse(assets.json_body).records[0].assetName, 'web-01');
    const asset = await invoke(METHOD_GET_ASSET_BY_ID_FULL, { json_body: '{"id":"asset-1"}' }, ctx);
    assert.equal(JSON.parse(asset.json_body).id, 'asset-1');
    const pcap = await invoke(METHOD_GET_PCAP_DETAIL_FULL, { json_body: '{}' }, ctx);
    assert.equal(JSON.parse(pcap.json_body).pcapName, 'sample.pcap');
    const flow = await invoke(METHOD_TRACK_PCAP_FLOW_FULL, { json_body: '{}' }, ctx);
    assert.match(JSON.parse(flow.json_body).stream, /HTTP/);

    const logout = await invoke(METHOD_LOGOUT_FULL, {}, ctx);
    assert.equal(logout.ok, true);
  } finally {
    await mock.close();
  }
});

test('pre-issued token and cookie skip automatic login', async () => {
  const calls = [];
  setFetch(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(init.headers.Cookie, COOKIE);
    return responseOf(200, JSON.stringify({ ok: true }));
  });

  const res = await invoke(METHOD_REQUEST_FULL, { method: 'GET', path: '/user/info' }, buildCtx({
    bindings: { username: '', password: '' },
    secret: { token: TOKEN, cookie: COOKIE },
  }));
  assert.equal(res.status_code, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://tar.example.com/user/info');
});

test('apiPrefix applies to built-in endpoints but generic requests stay explicit', async () => {
  const calls = [];
  setFetch(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/user/checkCode')) {
      return responseOf(200, JSON.stringify({ codeKey: 'mock-code-key' }), { 'content-type': 'application/json' });
    }
    if (String(url).endsWith('/user/login')) {
      return responseOf(200, JSON.stringify({ code: 0, token: TOKEN }), { 'content-type': 'application/json' });
    }
    return responseOf(200, JSON.stringify({ ok: true }), { 'content-type': 'application/json' });
  });

  const ctx = buildCtx({ bindings: { baseUrl: 'https://tar.example.com', apiPrefix: '/tar' } });
  await invoke(METHOD_GET_CURRENT_USER_FULL, {}, ctx);
  await invoke(METHOD_LIST_ASSETS_FULL, { json_body: '{}' }, ctx);
  await invoke(METHOD_REQUEST_FULL, { method: 'GET', path: '/tar/messageTips/overview' }, ctx);

  assert.deepEqual(calls.map((call) => call.url), [
    'https://tar.example.com/tar/user/checkCode',
    'https://tar.example.com/tar/user/login',
    'https://tar.example.com/tar/user/info',
    'https://tar.example.com/tar/asset/page',
    'https://tar.example.com/tar/messageTips/overview',
  ]);
});

test('401 clears cached session, logs in again, and retries once', async () => {
  const mock = createMockServer();
  const host = await mock.start();
  try {
    const ctx = buildCtx({ bindings: { baseUrl: host } });
    const first = await invoke(METHOD_LIST_ASSETS_FULL, { json_body: '{}' }, ctx);
    assert.equal(JSON.parse(first.json_body).total, 1);
    mock.expireNextRequest();
    const second = await invoke(METHOD_LIST_ASSETS_FULL, { json_body: '{}' }, ctx);
    assert.equal(JSON.parse(second.json_body).total, 1);
    assert.equal(mock.loginCount, 2);
  } finally {
    await mock.close();
  }
});

test('generic request returns binary responses as base64', async () => {
  const mock = createMockServer();
  const host = await mock.start();
  try {
    const res = await invoke(METHOD_REQUEST_FULL, { method: 'GET', path: '/binary' }, buildCtx({ bindings: { baseUrl: host } }));
    assert.equal(res.status_code, 200);
    assert.equal(res.json_body, '');
    assert.equal(Buffer.from(res.raw_body_base64, 'base64').toString('utf8'), 'pcap-bytes');
    assert.equal(res.headers['content-type'], 'application/octet-stream');
  } finally {
    await mock.close();
  }
});

test('validation and upstream errors map to gRPC errors', async () => {
  await expectGrpcError(() => invoke(METHOD_REQUEST_FULL, { method: 'GET', path: '/x' }, buildCtx({ bindings: { baseUrl: 'tar.example.com' } })), 'FAILED_PRECONDITION');
  await expectGrpcError(() => invoke(METHOD_REQUEST_FULL, { method: 'GET', path: '/x' }, buildCtx({ bindings: { username: '' } })), 'FAILED_PRECONDITION');
  await expectGrpcError(() => invoke(METHOD_REQUEST_FULL, { path: '/x' }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => invoke(METHOD_REQUEST_FULL, { method: 'TRACE', path: '/x' }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => invoke(METHOD_REQUEST_FULL, { method: 'GET', path: 'x' }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => invoke(METHOD_REQUEST_FULL, { method: 'GET', path: 'https://evil.example/x' }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => invoke(METHOD_REQUEST_FULL, { method: 'POST', path: '/x', json_body: '{' }, buildCtx()), 'INVALID_ARGUMENT');

  setFetch(async () => responseOf(200, JSON.stringify({ code: -1, msg: 'bad login' })));
  await expectGrpcError(() => invoke(METHOD_REQUEST_FULL, { method: 'GET', path: '/x' }, buildCtx()), 'UNAUTHENTICATED');

  setFetch(async () => responseOf(403, 'forbidden'));
  await expectGrpcError(() => invoke(METHOD_REQUEST_FULL, { method: 'GET', path: '/x' }, buildCtx({ secret: { token: TOKEN } })), 'PERMISSION_DENIED');

  setFetch(async () => responseOf(500, 'broken'));
  await expectGrpcError(() => invoke(METHOD_REQUEST_FULL, { method: 'GET', path: '/x' }, buildCtx({ secret: { token: TOKEN } })), 'UNAVAILABLE');

  setFetch(async () => { throw Object.assign(new Error('outer'), { cause: new Error('timeout') }); });
  await expectGrpcError(() => invoke(METHOD_REQUEST_FULL, { method: 'GET', path: '/x' }, buildCtx({ secret: { token: TOKEN } })), 'UNAVAILABLE', (err) => assert.match(err.message, /timeout/));
});

test('service definition handlers accept SDK HandlerContext', async () => {
  const calls = [];
  setFetch(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
    return responseOf(200, JSON.stringify({ ok: true }));
  });

  const res = await service.handlers[METHOD_REQUEST_FULL]({
    request: { method: 'GET', path: '/user/info', requestId: 'sdk-context' },
    metadata: { get: () => [], getMap: () => ({}) },
    config: { baseUrl: 'https://tar.example.com' },
    secret: { token: TOKEN },
    method: METHOD_REQUEST_FULL,
    serviceId: 'venus-tar',
    instanceId: 'venus-tar-test',
    workdir: '/tmp',
    packageDir: '/tmp',
    getMetadata: () => undefined,
    getMetadataAll: () => [],
  });

  assert.equal(res.status_code, 200);
  assert.equal(res.request_id, 'sdk-context');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://tar.example.com/user/info');
});

test('doFetch applies manual redirects, timeout, and insecure TLS dispatcher', async () => {
  let seen;
  setFetch(async (_url, init) => {
    seen = init;
    return responseOf(200, '{"ok":true}');
  });
  const res = await _test.doFetch(
    { skipTlsVerify: true, timeoutMs: 1000, headers: {} },
    { url: new URL('https://tar.example.com/user/info'), method: 'GET', action: 'request' },
  );
  assert.equal(res.status, 200);
  assert.equal(seen.redirect, 'manual');
  assert.ok(seen.signal instanceof AbortSignal);
  assert.ok(seen.dispatcher);
});

test('helper functions cover parsing and context behavior', () => {
  assert.equal(_test.normalizeBaseUrl(' https://tar.example.com/ '), 'https://tar.example.com');
  assert.equal(_test.normalizeBaseUrl('tar.example.com'), '');
  assert.equal(_test.normalizeBaseUrl('https://user:password@tar.example.com'), '');
  assert.equal(_test.normalizeBaseUrl('https://tar.example.com?token=secret'), '');
  assert.equal(_test.normalizeApiPrefix(undefined), '/tar');
  assert.equal(_test.normalizeApiPrefix('tar/'), '/tar');
  assert.equal(_test.normalizeApiPrefix(''), '');
  assert.throws(() => _test.normalizeApiPrefix('https://tar.example.com'), /apiPrefix must be a path prefix/);
  assert.equal(_test.pickFirstString([' ', 7]), '7');
  assert.equal(_test.pickBoolean('yes'), true);
  assert.equal(_test.pickBoolean('off'), false);
  assert.deepEqual(_test.parseJsonBody(''), {});
  assert.deepEqual(_test.parseJsonBody('{"a":1}'), { a: 1 });
  assert.equal(_test.stringifyJson({ a: 1 }), '{"a":1}');
  assert.equal(_test.extractToken({ tokenValue: 'a' }), 'a');
  assert.equal(_test.extractToken({ data: { token: 'b' } }), 'b');
  assert.equal(_test.extractToken({ value: 'c' }), 'c');
  assert.equal(_test.extractCookie(new Headers({ 'set-cookie': 'satoken=x; Path=/' })), 'satoken=x');
  assert.equal(_test.requestIdOf({ requestId: 123 }), '123');
  assert.equal(_test.isJsonContentType('application/json;charset=utf-8'), true);
  assert.equal(_test.isJsonContentType('application/octet-stream'), false);
  assert.equal(_test.mapHttpStatus(401), 'UNAUTHENTICATED');
  assert.equal(_test.mapHttpStatus(403), 'PERMISSION_DENIED');
  assert.equal(_test.mapHttpStatus(404), 'FAILED_PRECONDITION');
  assert.equal(_test.mapHttpStatus(500), 'UNAVAILABLE');
  assert.equal(_test.buildEnv({
    config: { baseUrl: 'https://config.example', username: 'config-user' },
    secret: { password: 'secret-pass' },
    bindings: { user: 'binding-user' },
  }).password, 'secret-pass');
});

test('concurrent calls share one login and session cache remains bounded', async () => {
  let captchaCount = 0;
  let loginCount = 0;
  setFetch(async (url) => {
    if (String(url).endsWith('/user/checkCode')) {
      captchaCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 2));
      return responseOf(200, JSON.stringify({ codeKey: 'key' }), { 'content-type': 'application/json' });
    }
    if (String(url).endsWith('/user/login')) {
      loginCount += 1;
      return responseOf(200, JSON.stringify({ code: 0, token: `token-${loginCount}` }), { 'content-type': 'application/json' });
    }
    return responseOf(200, '{}', { 'content-type': 'application/json' });
  });
  const shared = buildCtx({ meta: { instance_id: 'shared' } });
  await Promise.all(Array.from({ length: 5 }, () => invoke(METHOD_HEALTH_CHECK_FULL, {}, shared)));
  assert.equal(captchaCount, 1);
  assert.equal(loginCount, 1);

  for (let index = 0; index < 130; index += 1) {
    await invoke(METHOD_HEALTH_CHECK_FULL, {}, buildCtx({ meta: { instance_id: `cache-${index}` } }));
  }
  assert.equal(_test.sessionCacheSize(), 128);
});

test('response limits and error sanitization protect caller boundaries', async () => {
  setFetch(async () => responseOf(200, 'too large', { 'content-length': '11' }));
  await expectGrpcError(() => invoke(METHOD_REQUEST_FULL, { method: 'GET', path: '/x' }, buildCtx({
    bindings: { maxResponseBytes: 10 }, secret: { token: TOKEN },
  })), 'RESOURCE_EXHAUSTED');

  setFetch(async () => ({
    ...responseOf(200, ''),
    arrayBuffer: async () => Buffer.from('eleven bytes'),
  }));
  await expectGrpcError(() => invoke(METHOD_REQUEST_FULL, { method: 'GET', path: '/x' }, buildCtx({
    bindings: { maxResponseBytes: 10 }, secret: { token: TOKEN },
  })), 'RESOURCE_EXHAUSTED');

  setFetch(async () => responseOf(400, 'password=secret-value'));
  await expectGrpcError(() => invoke(METHOD_REQUEST_FULL, { method: 'GET', path: '/x' }, buildCtx({
    secret: { token: TOKEN },
  })), 'FAILED_PRECONDITION', (err) => assert.doesNotMatch(err.message, /secret-value/));

  setFetch(async (url) => {
    if (String(url).endsWith('/user/checkCode')) return responseOf(200, '{"codeKey":"key"}', { 'content-type': 'application/json' });
    return responseOf(200, JSON.stringify({ code: -1, msg: 'bad credentials', password: 'secret-value' }));
  });
  await expectGrpcError(() => invoke(METHOD_LOGIN_FULL, {}, buildCtx()), 'UNAUTHENTICATED', (err) => {
    assert.match(err.message, /bad credentials/);
    assert.doesNotMatch(err.message, /secret-value/);
  });
});

test('malformed JSON and pre-issued Login behavior are explicit', async () => {
  setFetch(async (url) => String(url).endsWith('/user/checkCode')
    ? responseOf(200, '{"codeKey":"key"}', { 'content-type': 'application/json' })
    : responseOf(200, 'not-json'));
  await expectGrpcError(() => invoke(METHOD_LOGIN_FULL, {}, buildCtx()), 'UNKNOWN');
  const login = await invoke(METHOD_LOGIN_FULL, {}, buildCtx({
    bindings: { username: '', password: '' },
    secret: { token: TOKEN, cookie: COOKIE },
  }));
  assert.equal(login.authenticated, true);
  assert.equal(login.token, TOKEN);
});
