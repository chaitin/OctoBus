import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_CREATE_FULL,
  METHOD_DELETE_FULL,
  METHOD_GET_FULL,
  METHOD_LIST_FULL,
  _test,
  handlers,
  rpcdef,
} from '../src/sangfor-af-v8-0-35r1.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

let seq = 0;

const buildCtx = (host, overrides = {}) => ({
  config: { host, namespace: 'public', timeoutMs: 10000, skipTlsVerify: false, ...(overrides.config || {}) },
  secret: { username: 'api_user', password: 'SuperSecret!', ...(overrides.secret || {}) },
  meta: { instance_id: overrides.instance_id || `inst-${++seq}`, request_id: 'req' },
  request: overrides.request || {},
});

const callHandler = (method, host, request = {}, overrides = {}) => handlers[method](buildCtx(host, { ...overrides, request }));

const expectGrpc = async (fn, code) => {
  let caught;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'expected GrpcError');
  assert.ok(caught instanceof GrpcError);
  assert.equal(caught.code, code);
  return caught;
};

test.afterEach(() => {
  _test.sessionCache.clear();
});

test('service exports defineService result and handlers', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers[METHOD_LIST_FULL], 'function');
  assert.equal(typeof handlers[METHOD_GET_FULL], 'function');
  assert.equal(typeof handlers[METHOD_CREATE_FULL], 'function');
  assert.equal(typeof handlers[METHOD_DELETE_FULL], 'function');
});

test('ListWhiteBlackListEntries logs in and sends token cookie', async () => {
  const mock = await createMockServer();
  try {
    const res = await callHandler(METHOD_LIST_FULL, mock.url, { type: 'WHITE', start: 0, length: 5 });
    assert.equal(res.total_items, 2);
    assert.equal(mock.requests[0].method, 'POST');
    assert.equal(mock.requests[0].pathname, '/api/v1/namespaces/public/login');
    assert.deepEqual(mock.requests[0].body, { name: 'api_user', password: 'SuperSecret!' });
    assert.equal(mock.requests[1].method, 'GET');
    assert.equal(mock.requests[1].pathname, '/api/v1/namespaces/public/whiteblacklist');
    assert.equal(mock.requests[1].searchParams.type, 'WHITE');
    assert.match(mock.requests[1].headers.cookie, /token=token-1/);
  } finally {
    await mock.close();
  }
});

test('ListWhiteBlackListEntries maps pagination and entries', async () => {
  const mock = await createMockServer();
  try {
    const res = await rpcdef(buildCtx(mock.url, { request: { type: 2, start: 0, length: 1, sort_by: 'url', order: 'asc' } }))[
      '/Sangfor_AF_V8035R1.Sangfor_AF_V8035R1/ListWhiteBlackListEntries'
    ]();
    assert.equal(res.total_items, 2);
    assert.equal(res.page_size, 1);
    assert.equal(res.item_length, 1);
    assert.equal(res.items[0].url, '8.8.0.1');
    assert.equal(res.items[0].type, 'WHITE');
    assert.equal(res.items[0].is_default, false);
    assert.equal(mock.requests[1].searchParams._sortby, 'url');
  } finally {
    await mock.close();
  }
});

test('GetWhiteBlackListEntry URL-encodes url path segment', async () => {
  const mock = await createMockServer();
  try {
    const res = await callHandler(METHOD_GET_FULL, mock.url, { url: 'device.scloud.sangfor.com', type: 'WHITE' });
    assert.equal(res.entry.url, 'device.scloud.sangfor.com');
    assert.equal(mock.requests[1].pathname, '/api/v1/namespaces/public/whiteblacklist/device.scloud.sangfor.com');
  } finally {
    await mock.close();
  }
});

test('CreateWhiteBlackListEntry sends expected body and defaults enable true', async () => {
  const mock = await createMockServer();
  try {
    const res = await callHandler(METHOD_CREATE_FULL, mock.url, { url: '198.51.100.203', type: 'BLACK', description: 'octobus-test' });
    assert.equal(res.entry.url, '198.51.100.203');
    assert.equal(res.entry.type, 'BLACK');
    assert.equal(mock.requests[1].method, 'POST');
    assert.deepEqual(mock.requests[1].body, { url: '198.51.100.203', type: 'BLACK', enable: true, description: 'octobus-test' });
  } finally {
    await mock.close();
  }
});

test('DeleteWhiteBlackListEntry sends DELETE with encoded url and type query', async () => {
  const mock = await createMockServer();
  try {
    await callHandler(METHOD_CREATE_FULL, mock.url, { url: '198.51.100.203', type: 'BLACK' });
    const res = await callHandler(METHOD_DELETE_FULL, mock.url, { url: '198.51.100.203', type: 1 });
    assert.equal(res.entry.url, '198.51.100.203');
    const req = mock.requests.at(-1);
    assert.equal(req.method, 'DELETE');
    assert.equal(req.pathname, '/api/v1/namespaces/public/whiteblacklist/198.51.100.203');
    assert.equal(req.searchParams.type, 'BLACK');
  } finally {
    await mock.close();
  }
});

test('expired token code triggers one relogin and retry', async () => {
  const mock = await createMockServer();
  try {
    mock.state.expireNextBusinessRequest = true;
    const res = await callHandler(METHOD_LIST_FULL, mock.url, { type: 'WHITE' });
    assert.equal(res.total_items, 2);
    assert.equal(mock.requests.filter((req) => req.pathname.endsWith('/login')).length, 2);
    assert.match(mock.requests.at(-1).headers.cookie, /token=token-2/);
  } finally {
    await mock.close();
  }
});

test('AF error codes map to expected GrpcError status', async () => {
  const mock = await createMockServer();
  try {
    await expectGrpc(() => callHandler(METHOD_LIST_FULL, mock.url, {}, { secret: { password: 'wrong' } }), grpcStatus.UNAUTHENTICATED);
    const cases = [
      [13, grpcStatus.PERMISSION_DENIED],
      [22, grpcStatus.INVALID_ARGUMENT],
      [1004, grpcStatus.NOT_FOUND],
      [110, grpcStatus.DEADLINE_EXCEEDED],
      [1008, grpcStatus.FAILED_PRECONDITION],
    ];
    for (const [afCode, status] of cases) {
      mock.state.nextErrorCode = afCode;
      await expectGrpc(() => callHandler(METHOD_LIST_FULL, mock.url, { type: 'WHITE' }, { instance_id: `err-${afCode}` }), status);
    }
  } finally {
    await mock.close();
  }
});

test('helpers validate inputs and aliases', async () => {
  assert.equal(_test.typeToUpstream('black'), 'BLACK');
  assert.equal(_test.typeToUpstream(2), 'WHITE');
  assert.throws(() => _test.typeToUpstream('bad'), /type must be BLACK or WHITE/);
  assert.equal(_test.normalizeBaseUrl('https://example.test///'), 'https://example.test');
  assert.equal(_test.normalizeBaseUrl('example.test'), '');
  await expectGrpc(() => handlers[METHOD_GET_FULL](buildCtx('https://example.test', { request: {} })), grpcStatus.INVALID_ARGUMENT);
});

test('helper branches and failures remain deterministic', async () => {
  assert.equal(_test.toBoolean('yes'), true);
  assert.equal(_test.toBoolean(true), true);
  assert.equal(_test.toBoolean(0), false);
  assert.equal(_test.toBoolean(undefined, true), true);
  assert.equal(_test.toBoolean('1'), true);
  assert.equal(_test.toBoolean('0'), false);
  assert.equal(_test.toBoolean('off'), false);
  assert.equal(_test.toBoolean('bad', true), true);
  assert.equal(_test.toInteger('4.8', 0), 4);
  assert.equal(_test.toInteger('bad', 7), 7);
  assert.equal(_test.toInteger(undefined, 8), 8);
  assert.equal(_test.toInteger({ value: 9 }, 0), 9);
  assert.equal(_test.typeToUpstream(0), undefined);
  assert.throws(() => _test.typeToUpstream(0, { required: true }), /type is required/);
  assert.equal(_test.upstreamToType('unknown'), 'WHITE_BLACK_LIST_TYPE_UNSPECIFIED');
  assert.equal(_test.upstreamToType('black'), 'BLACK');
  assert.equal(_test.upstreamToType('white'), 'WHITE');
  assert.equal(_test.firstDefined('', null, 'x'), 'x');
  assert.deepEqual(_test.buildTlsOptions({ skipTlsVerify: false }), {});
  assert.ok(_test.buildTlsOptions({ skipTlsVerify: true }).dispatcher);
  assert.ok(_test.buildTlsOptions({ skipTlsVerify: true }).dispatcher);
  assert.throws(() => _test.parseJson('bad'), /valid JSON/);
  await expectGrpc(() => handlers[METHOD_LIST_FULL](buildCtx('', {})), grpcStatus.INVALID_ARGUMENT);
  await expectGrpc(() => handlers[METHOD_LIST_FULL](buildCtx('https://example.test', { secret: { username: '', user: '', password: '' } })), grpcStatus.INVALID_ARGUMENT);
});

test('session cache is bounded for long-running dynamic instances', async () => {
  for (let index = 0; index < 140; index += 1) {
    _test.setSession({ meta: { instance_id: `dynamic-${index}` } }, 'https://af.test', 'public', `token-${index}`);
  }
  assert.equal(_test.sessionCache.size, 128);
  assert.equal(_test.sessionCache.has('dynamic-0::https://af.test::public'), false);
  assert.equal(_test.sessionCache.has('dynamic-139::https://af.test::public'), true);
});

test('network and HTTP failures map to stable gRPC errors', async () => {
  const ctx = buildCtx('https://af.test');
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw Object.assign(new Error('late'), { name: 'TimeoutError' }); };
    await expectGrpc(() => _test.requestAf(_test.resolveCallContext(ctx), 'GET', '/x'), grpcStatus.DEADLINE_EXCEEDED);
    globalThis.fetch = async () => { throw new Error('socket'); };
    await expectGrpc(() => _test.requestAf(_test.resolveCallContext(ctx), 'GET', '/x'), grpcStatus.UNAVAILABLE);
    globalThis.fetch = async () => ({ status: 503, text: async () => 'down' });
    await expectGrpc(() => _test.requestAf(_test.resolveCallContext(ctx), 'GET', '/x'), grpcStatus.UNAVAILABLE);
    globalThis.fetch = async () => ({ status: 200, text: async () => '' });
    await expectGrpc(() => _test.requestAf(_test.resolveCallContext(ctx), 'GET', '/x'), grpcStatus.UNKNOWN);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
