import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  CREATE_HOST_ISOLATION_PATH,
  DELETE_HOST_ISOLATION_PATH,
  LOGIN_PATH,
  METHOD_CREATE_HOST_ISOLATION_FULL,
  METHOD_DELETE_HOST_ISOLATION_FULL,
  METHOD_LOGIN_FULL,
  METHOD_QUERY_HOST_ASSETS_FULL,
  QUERY_HOST_ASSETS_PATH,
  UPSTREAM_CREATE_HOST_ISOLATION_PATH,
  UPSTREAM_DELETE_HOST_ISOLATION_PATH,
  UPSTREAM_LOGIN_PATH,
  UPSTREAM_QUERY_HOST_ASSETS_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/qingteng-hids-v3-4.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;
const originalConsoleLog = console.log;

const defaultBindings = {
  host: 'https://qt.example.com',
  username: 'qt-user',
  password: 'qt-pass',
  headers: { 'X-Custom': 'demo' },
};

const buildCtx = (overrides = {}) => ({
  bindings: { ...defaultBindings, ...(overrides.bindings || {}) },
  config: overrides.config || {},
  secret: overrides.secret || {},
  meta: { instance_id: 'inst-a', request_id: 'req-a', ...(overrides.meta || {}) },
  limits: { timeoutMs: 3000, ...(overrides.limits || {}) },
  req: overrides.req || {},
});

const callHandler = (method, request = {}, ctx = {}) => {
  const handler = handlers[method];
  return handler({ ...ctx, request });
};

const textResponse = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: () => 'application/json' },
  text: async () => body,
});

const jsonResponse = (status, body) => textResponse(status, JSON.stringify(body));

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
    FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
    INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
    PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
    UNKNOWN: grpcStatus.UNKNOWN,
  })[legacyCode]);
  checker(caught);
};

const expectRejectPayload = async (fn, code, httpStatus, reasonPattern) => {
  await expectGrpcError(fn, code, (err) => {
    const payload = JSON.parse(err.message);
    assert.equal(payload.code, code);
    assert.equal(payload.http_status, httpStatus);
    assert.equal(payload.raw_body, '');
    assert.ok(payload.raw_body_length >= 0);
    if (reasonPattern) assert.match(payload.reason, reasonPattern);
  });
};

test.beforeEach(() => {
  _test.clearSessionCache();
  Date.now = () => 1710000000000;
  console.log = () => {};
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;
  console.log = originalConsoleLog;
});

test('service exports handlers and rpcdef paths', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers[METHOD_LOGIN_FULL], 'function');
  assert.equal(typeof handlers[METHOD_QUERY_HOST_ASSETS_FULL], 'function');
  assert.equal(typeof handlers[METHOD_CREATE_HOST_ISOLATION_FULL], 'function');
  assert.equal(typeof handlers[METHOD_DELETE_HOST_ISOLATION_FULL], 'function');
  const routes = rpcdef(buildCtx());
  assert.equal(typeof routes[LOGIN_PATH], 'function');
  assert.equal(typeof routes[QUERY_HOST_ASSETS_PATH], 'function');
  assert.equal(typeof routes[CREATE_HOST_ISOLATION_PATH], 'function');
  assert.equal(typeof routes[DELETE_HOST_ISOLATION_PATH], 'function');
});

test('Login uses bindings credentials and returns http_status/raw_body', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return jsonResponse(200, { data: { comId: 'com-1', jwt: 'jwt-1', signKey: 'sign-1' } });
  });

  const res = await callHandler(METHOD_LOGIN_FULL, {}, buildCtx({ bindings: { skipTlsVerify: true } }));
  assert.equal(captured.url, 'https://qt.example.com/v1/api/auth');
  assert.deepEqual(JSON.parse(captured.init.body), { username: 'qt-user', password: 'qt-pass' });
  assert.equal(captured.init.method, 'POST');
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal('timeoutMs' in captured.init, false);
  assert.ok(captured.init.dispatcher);
  assert.equal('skipTlsVerify' in captured.init, false);
  assert.equal(captured.init.headers['Content-Type'], 'application/json');
  assert.equal(captured.init.headers['X-Custom'], 'demo');
  assert.equal(captured.init.headers['x-engine-instance'], 'inst-a');
  assert.equal(res.http_status, 200);
  assert.equal(res.raw_body, '');
});

test('input and binding helpers validate required fields', async () => {
  await expectGrpcError(
    () => callHandler(METHOD_LOGIN_FULL, {}, buildCtx({ bindings: { host: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /host\/baseUrl is required/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_LOGIN_FULL, {}, buildCtx({ bindings: { username: '', user: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /username\/user is required/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_LOGIN_FULL, {}, buildCtx({ bindings: { password: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /password is required/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_QUERY_HOST_ASSETS_FULL, { ip: '', system_type: 'linux' }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /ip is required/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_QUERY_HOST_ASSETS_FULL, { ip: '10.0.0.1', system_type: 'mac' }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /system_type must be linux or win/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_CREATE_HOST_ISOLATION_FULL, { agent_ids: [] }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /agent_ids must be a non-empty array/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_CREATE_HOST_ISOLATION_FULL, { agent_ids: [' '] }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /non-empty value/),
  );
});

test('QueryHostAssets auto logins and signs sorted query payload', async () => {
  const calls = [];
  setFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith(UPSTREAM_LOGIN_PATH)) {
      return jsonResponse(200, { data: { comId: 'com-1', jwt: 'jwt-1', signKey: 'sign-1' } });
    }
    return jsonResponse(200, { total: 1, rows: [{ displayIp: '10.0.0.1', agentId: 'agent-1' }] });
  });

  const res = await rpcdef(buildCtx({ req: { ip: '10.0.0.1', system_type: 'linux' } }))[QUERY_HOST_ASSETS_PATH]();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://qt.example.com/external/api/assets/host/linux?ip=10.0.0.1');
  assert.equal(calls[1].init.method, 'GET');
  assert.equal(calls[1].init.headers.comId, 'com-1');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer jwt-1');
  assert.equal(calls[1].init.headers.timestamp, '1710000000');
  const expected = crypto.createHash('sha1').update('com-1ip10.0.0.11710000000sign-1').digest('hex');
  assert.equal(calls[1].init.headers.sign, expected);
  assert.equal(res.http_status, 200);
  assert.equal(res.raw_body, '');
});

test('CreateHostIsolation and DeleteHostIsolation send expected signed bodies', async () => {
  const calls = [];
  setFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith(UPSTREAM_LOGIN_PATH)) {
      return jsonResponse(200, { data: { comId: 'com-2', jwt: 'jwt-2', signKey: 'sign-2' } });
    }
    return jsonResponse(200, { code: 0, ok: true });
  });

  await callHandler(METHOD_CREATE_HOST_ISOLATION_FULL, { agent_ids: ['agent-a', { value: 'agent-b' }] }, buildCtx());
  await callHandler(METHOD_DELETE_HOST_ISOLATION_FULL, { agentIds: { values: ['agent-a'] } }, buildCtx());
  assert.equal(calls.filter((call) => call.url.endsWith(UPSTREAM_LOGIN_PATH)).length, 1);

  const create = calls.find((call) => call.url.endsWith(UPSTREAM_CREATE_HOST_ISOLATION_PATH));
  assert.equal(create.init.method, 'POST');
  assert.deepEqual(JSON.parse(create.init.body), {
    agentIds: ['agent-a', 'agent-b'],
    direction: 'all',
    remark: '自动化创建隔离任务',
  });
  assert.equal(create.init.headers.sign, _test.sha1Hex(`com-2${create.init.body}1710000000sign-2`));

  const del = calls.find((call) => call.url.endsWith(UPSTREAM_DELETE_HOST_ISOLATION_PATH));
  assert.equal(del.init.method, 'DELETE');
  assert.deepEqual(JSON.parse(del.init.body), { agentIds: ['agent-a'] });
});

test('DeleteHostIsolation retries once after 401 by re-login', async () => {
  const calls = [];
  let loginCount = 0;
  setFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith(UPSTREAM_LOGIN_PATH)) {
      loginCount += 1;
      return jsonResponse(200, { data: { comId: `com-${loginCount}`, jwt: `jwt-${loginCount}`, signKey: `sign-${loginCount}` } });
    }
    if (calls.filter((call) => call.url.endsWith(UPSTREAM_DELETE_HOST_ISOLATION_PATH)).length === 1) {
      return jsonResponse(401, { message: 'expired' });
    }
    return jsonResponse(200, { code: 0, removed: 1 });
  });

  const res = await callHandler(METHOD_DELETE_HOST_ISOLATION_FULL, { agent_ids: ['agent-a'] }, buildCtx());
  assert.equal(loginCount, 2);
  assert.equal(res.http_status, 200);
  assert.equal(res.raw_body, '');
  assert.equal(_test.getCachedSessionCount(), 1);
});

test('service caches session per instance and host', async () => {
  const calls = [];
  setFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith(UPSTREAM_LOGIN_PATH)) {
      return jsonResponse(200, { data: { comId: 'com-cache', jwt: 'jwt-cache', signKey: 'sign-cache' } });
    }
    return jsonResponse(200, { total: 0, rows: [] });
  });

  await callHandler(METHOD_QUERY_HOST_ASSETS_FULL, { ip: '10.0.0.1', system_type: 'linux' }, buildCtx());
  await callHandler(METHOD_QUERY_HOST_ASSETS_FULL, { ip: '10.0.0.2', systemType: 'win' }, buildCtx());
  await callHandler(METHOD_QUERY_HOST_ASSETS_FULL, { ip: '10.0.0.3', system_type: 'linux' }, buildCtx({ meta: { instance_id: 'inst-b' } }));
  assert.equal(calls.filter((call) => call.url.endsWith(UPSTREAM_LOGIN_PATH)).length, 2);
  assert.equal(_test.getCachedSessionCount(), 2);
});

test('upstream failures are encoded with legacy JSON payloads', async () => {
  setFetch(async () => jsonResponse(401, { message: 'bad credentials' }));
  await expectRejectPayload(() => callHandler(METHOD_LOGIN_FULL, {}, buildCtx()), 'PERMISSION_DENIED', 401, /upstream http 401/);

  setFetch(async () => jsonResponse(404, { message: 'missing' }));
  await expectRejectPayload(() => _test.runSignedRequest(buildCtx(), ({ host, session }) => ({
    method: 'GET',
    url: `${host}/missing`,
    headers: _test.buildSignedHeaders(buildCtx(), session, '', 1710000000),
  })), 'FAILED_PRECONDITION', 404, /upstream http 404/);

  setFetch(async (url) => {
    if (String(url).endsWith(UPSTREAM_LOGIN_PATH)) return jsonResponse(200, { data: { comId: 'com', jwt: 'jwt', signKey: 'key' } });
    return jsonResponse(500, { message: 'internal error' });
  });
  await expectRejectPayload(() => callHandler(METHOD_CREATE_HOST_ISOLATION_FULL, { agent_ids: ['agent-a'] }, buildCtx()), 'UNAVAILABLE', 500, /upstream http 500/);

  setFetch(async () => {
    throw Object.assign(new Error('boom'), { cause: new Error('timeout') });
  });
  await expectRejectPayload(() => callHandler(METHOD_LOGIN_FULL, {}, buildCtx()), 'UNAVAILABLE', 0, /timeout/);
});

test('protocol failures map to UNKNOWN payloads', async () => {
  setFetch(async () => textResponse(200, 'not-json'));
  await expectRejectPayload(() => callHandler(METHOD_LOGIN_FULL, {}, buildCtx()), 'UNKNOWN', 200, /not valid JSON/);

  setFetch(async () => jsonResponse(200, { data: { comId: 'com-only' } }));
  await expectRejectPayload(() => callHandler(METHOD_LOGIN_FULL, {}, buildCtx()), 'UNKNOWN', 200, /missing comId\/jwt\/signKey/);

  setFetch(async () => ({
    status: 200,
    headers: { get: () => 'application/json' },
    text: async () => {
      throw new Error('body stream broken');
    },
  }));
  await expectRejectPayload(() => callHandler(METHOD_LOGIN_FULL, {}, buildCtx()), 'UNKNOWN', 200, /body stream broken/);
});

test('helper functions cover edge cases and aliases', () => {
  assert.equal(_test.sha1Hex('abc'), 'a9993e364706816aba3e25717850c26c9cd0d89d');
  assert.equal(_test.normalizeBaseUrl('https://qt.example.com///'), 'https://qt.example.com');
  assert.equal(_test.normalizeBaseUrl('ftp://qt.example.com'), '');
  assert.equal(_test.unwrapString({ value: { value: ' nested ' } }), ' nested ');
  assert.equal(_test.pickString({ user: { value: ' qt ' } }, ['username', 'user']), 'qt');
  assert.equal(_test.toBoolean('yes'), true);
  assert.equal(_test.toBoolean('off'), false);
  assert.equal(_test.toBoolean(1), true);
  assert.equal(_test.toBoolean(0), false);
  assert.equal(_test.toBoolean(Number.NaN), false);
  assert.equal(_test.toBoolean({ value: 'on' }), true);
  assert.equal(_test.toBoolean({ other: true }), false);
  assert.equal(_test.optionalUint32('12.9'), 12);
  assert.equal(_test.optionalUint32(-1), undefined);
  assert.equal(_test.optionalUint32(), undefined);
  assert.equal(_test.resolveTimeoutMs({ bindings: {}, limits: { timeoutMs: -1 } }), 5000);
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeoutMs: 222 }, limits: { timeoutMs: 111 } }), 111);
  assert.ok(_test.buildTlsOptions({ insecureSkipVerify: true }).dispatcher);
  assert.deepEqual(_test.buildTlsOptions({}), {});
  assert.equal(_test.buildSortedQuery({ z: 'last', a: 'first', empty: '' }), 'a=first&z=last');
  assert.equal(_test.buildSortedQuery({ q: 'a b' }), 'q=a+b');
  assert.equal(_test.buildGetPayloadInfo({ z: 'last', a: 'first', empty: '' }), 'afirstzlast');
  assert.equal(_test.mapHttpStatusToCode(403), 'PERMISSION_DENIED');
  assert.equal(_test.mapHttpStatusToCode(409), 'FAILED_PRECONDITION');
  assert.equal(_test.mapHttpStatusToCode(500), 'UNAVAILABLE');
  assert.equal(_test.buildLogPrefix({ meta: { instanceId: 'i', requestId: 'r' } }, 'A'), '[QingTeng_HIDS_V34][A][inst=i req=r]');
  assert.equal(_test.buildLogPrefix({}, 'A'), '[QingTeng_HIDS_V34][A]');
  assert.equal(_test.buildSessionKey({ meta: { instance_id: '' } }, 'http://host'), 'default-instance::http://host');
  assert.throws(() => _test.parseJsonBody('bad', 200, 'test'), /not valid JSON/);
});

test('logFlow falls back when details cannot be JSON stringified', () => {
  const calls = [];
  console.log = (...args) => calls.push(args);
  const circular = {};
  circular.self = circular;
  _test.logFlow({ meta: { instance_id: 'inst' } }, 'circular', circular);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '[QingTeng_HIDS_V34][circular][inst=inst]');
  assert.equal(calls[0][1], circular);
});

test('mock upstream handles signed query and isolation lifecycle', async () => {
  const server = await createMockServer();
  try {
    const ctx = buildCtx({
      bindings: {
        host: server.url,
        username: 'demo-user',
        password: 'demo-pass',
      },
      meta: { instance_id: 'mock-inst' },
    });

    const login = await callHandler(METHOD_LOGIN_FULL, {}, ctx);
    assert.equal(login.http_status, 200);

    const query = await callHandler(METHOD_QUERY_HOST_ASSETS_FULL, { ip: '192.0.2.10', system_type: 'linux' }, ctx);
    assert.equal(query.http_status, 200);
    assert.equal(query.raw_body, '');

    const create = await callHandler(METHOD_CREATE_HOST_ISOLATION_FULL, { agent_ids: ['agent-1'], remark: 'manual' }, ctx);
    assert.equal(create.http_status, 200);
    assert.equal(create.raw_body, '');

    const del = await callHandler(METHOD_DELETE_HOST_ISOLATION_FULL, { agent_ids: ['agent-1'] }, ctx);
    assert.equal(del.http_status, 200);
    assert.equal(del.raw_body, '');

    const bad = await fetch(`${server.url}${UPSTREAM_QUERY_HOST_ASSETS_PATH}/linux?ip=1.1.1.1`).then((res) => res.json());
    assert.equal(bad.message, 'missing bearer token');
    assert.ok(server.requests.some((req) => req.url === UPSTREAM_LOGIN_PATH));
  } finally {
    await server.close();
  }
});
