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
  rpcdef,
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
});

test('service exports handlers and rpcdef path handlers', () => {
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
  const defs = rpcdef(buildCtx());
  assert.equal(typeof defs['/Venus_TAR.TARService/Request'], 'function');
  assert.equal(typeof defs['/Venus_TAR.TARService/ListAssets'], 'function');
});

test('mock upstream supports login, generic request, core methods, and logout', async () => {
  const mock = createMockServer();
  const host = await mock.start();
  try {
    const ctx = buildCtx({ bindings: { baseUrl: host, skipTlsVerify: true } });
    const login = await handlers[METHOD_LOGIN_FULL]({}, ctx);
    assert.equal(login.authenticated, true);
    assert.match(login.token, /^mock-token-/);

    const user = await handlers[METHOD_GET_CURRENT_USER_FULL]({}, ctx);
    assert.deepEqual(JSON.parse(user.json_body), { userName: USERNAME, role: 'admin' });

    const generic = await handlers[METHOD_REQUEST_FULL]({
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

    const overview = await handlers[METHOD_GET_DASHBOARD_OVERVIEW_FULL]({ json_body: '{"range":"today"}' }, ctx);
    assert.deepEqual(JSON.parse(overview.json_body), { posture: 'stable' });
    const total = await handlers[METHOD_GET_ALARM_TOTAL_FULL]({ json_body: '{}' }, ctx);
    assert.equal(JSON.parse(total.json_body), 42);
    const events = await handlers[METHOD_LIST_EVENT_LOGS_FULL]({ json_body: '{"pageNum":2}' }, ctx);
    assert.equal(JSON.parse(events.json_body).records[0].pageNum, 2);
    const assets = await handlers[METHOD_LIST_ASSETS_FULL]({ json_body: '{}' }, ctx);
    assert.equal(JSON.parse(assets.json_body).records[0].assetName, 'web-01');
    const asset = await handlers[METHOD_GET_ASSET_BY_ID_FULL]({ json_body: '{"id":"asset-1"}' }, ctx);
    assert.equal(JSON.parse(asset.json_body).id, 'asset-1');
    const pcap = await handlers[METHOD_GET_PCAP_DETAIL_FULL]({ json_body: '{}' }, ctx);
    assert.equal(JSON.parse(pcap.json_body).pcapName, 'sample.pcap');
    const flow = await handlers[METHOD_TRACK_PCAP_FLOW_FULL]({ json_body: '{}' }, ctx);
    assert.match(JSON.parse(flow.json_body).stream, /HTTP/);

    const logout = await handlers[METHOD_LOGOUT_FULL]({}, ctx);
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

  const res = await handlers[METHOD_REQUEST_FULL]({ method: 'GET', path: '/user/info' }, buildCtx({
    bindings: { username: '', password: '' },
    secret: { token: TOKEN, cookie: COOKIE },
  }));
  assert.equal(res.status_code, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://tar.example.com/user/info');
});

test('401 clears cached session, logs in again, and retries once', async () => {
  const mock = createMockServer();
  const host = await mock.start();
  try {
    const ctx = buildCtx({ bindings: { baseUrl: host } });
    const first = await handlers[METHOD_LIST_ASSETS_FULL]({ json_body: '{}' }, ctx);
    assert.equal(JSON.parse(first.json_body).total, 1);
    mock.expireNextRequest();
    const second = await handlers[METHOD_LIST_ASSETS_FULL]({ json_body: '{}' }, ctx);
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
    const res = await handlers[METHOD_REQUEST_FULL]({ method: 'GET', path: '/binary' }, buildCtx({ bindings: { baseUrl: host } }));
    assert.equal(res.status_code, 200);
    assert.equal(res.json_body, '');
    assert.equal(Buffer.from(res.raw_body_base64, 'base64').toString('utf8'), 'pcap-bytes');
    assert.equal(res.headers['content-type'], 'application/octet-stream');
  } finally {
    await mock.close();
  }
});

test('validation and upstream errors map to gRPC errors', async () => {
  await expectGrpcError(() => handlers[METHOD_REQUEST_FULL]({ method: 'GET', path: '/x' }, buildCtx({ bindings: { baseUrl: 'tar.example.com' } })), 'FAILED_PRECONDITION');
  await expectGrpcError(() => handlers[METHOD_REQUEST_FULL]({ method: 'GET', path: '/x' }, buildCtx({ bindings: { username: '' } })), 'FAILED_PRECONDITION');
  await expectGrpcError(() => handlers[METHOD_REQUEST_FULL]({ path: '/x' }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => handlers[METHOD_REQUEST_FULL]({ method: 'TRACE', path: '/x' }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => handlers[METHOD_REQUEST_FULL]({ method: 'GET', path: 'x' }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => handlers[METHOD_REQUEST_FULL]({ method: 'GET', path: 'https://evil.example/x' }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => handlers[METHOD_REQUEST_FULL]({ method: 'POST', path: '/x', json_body: '{' }, buildCtx()), 'INVALID_ARGUMENT');

  setFetch(async () => responseOf(200, JSON.stringify({ code: -1, msg: 'bad login' })));
  await expectGrpcError(() => handlers[METHOD_REQUEST_FULL]({ method: 'GET', path: '/x' }, buildCtx()), 'UNAUTHENTICATED');

  setFetch(async () => responseOf(403, 'forbidden'));
  await expectGrpcError(() => handlers[METHOD_REQUEST_FULL]({ method: 'GET', path: '/x' }, buildCtx({ secret: { token: TOKEN } })), 'PERMISSION_DENIED');

  setFetch(async () => responseOf(500, 'broken'));
  await expectGrpcError(() => handlers[METHOD_REQUEST_FULL]({ method: 'GET', path: '/x' }, buildCtx({ secret: { token: TOKEN } })), 'UNAVAILABLE');

  setFetch(async () => { throw Object.assign(new Error('outer'), { cause: new Error('timeout') }); });
  await expectGrpcError(() => handlers[METHOD_REQUEST_FULL]({ method: 'GET', path: '/x' }, buildCtx({ secret: { token: TOKEN } })), 'UNAVAILABLE', (err) => assert.match(err.message, /timeout/));
});

test('helper functions cover parsing and context behavior', () => {
  assert.equal(_test.normalizeBaseUrl(' https://tar.example.com/ '), 'https://tar.example.com');
  assert.equal(_test.normalizeBaseUrl('tar.example.com'), '');
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
