import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_GET_ASSET_FULL,
  METHOD_GET_ASSET_PATH,
  METHOD_LIST_ASSETS_FULL,
  METHOD_LIST_ASSETS_PATH,
  METHOD_LIST_ONLINE_SESSIONS_FULL,
  METHOD_LIST_ONLINE_SESSIONS_PATH,
  METHOD_LIST_USERS_FULL,
  METHOD_LIST_USERS_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/jumpserver-bastionhost-v4-10-16.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const ctx = (endpoint, overrides = {}) => ({
  config: { endpoint, apiPrefix: '/api/v1', ...(overrides.config || {}) },
  secret: { token: 'test-token', ...(overrides.secret || {}) },
  bindings: overrides.bindings || {},
  limits: { timeoutMs: 10000 },
  req: overrides.req || {},
});

test('service exports handlers and rpcdef paths', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers[METHOD_LIST_ASSETS_FULL], 'function');
  assert.equal(typeof handlers[METHOD_GET_ASSET_FULL], 'function');
  assert.equal(typeof handlers[METHOD_LIST_USERS_FULL], 'function');
  assert.equal(typeof handlers[METHOD_LIST_ONLINE_SESSIONS_FULL], 'function');
  assert.equal(typeof rpcdef({})[METHOD_LIST_ASSETS_PATH], 'function');
  assert.equal(typeof rpcdef({})[METHOD_GET_ASSET_PATH], 'function');
  assert.equal(typeof rpcdef({})[METHOD_LIST_USERS_PATH], 'function');
  assert.equal(typeof rpcdef({})[METHOD_LIST_ONLINE_SESSIONS_PATH], 'function');
});

test('ListAssets maps JumpServer paged asset response', async () => {
  const mock = await createMockServer();
  try {
    const result = await handlers[METHOD_LIST_ASSETS_FULL]({ limit: 5, search: 'linux' }, ctx(mock.endpoint));
    assert.equal(result.total, 1);
    assert.equal(result.items[0].id, 'asset-1');
    assert.equal(result.items[0].address, '192.0.2.10');
    assert.equal(mock.requests.at(-1).path, '/api/v1/assets/assets');
    assert.equal(mock.requests.at(-1).query.limit, '5');
    assert.equal(mock.requests.at(-1).query.search, 'linux');
    assert.equal(mock.requests.at(-1).headers.authorization, 'Bearer test-token');
  } finally {
    await mock.close();
  }
});

test('GetAsset maps one asset response', async () => {
  const mock = await createMockServer();
  try {
    const result = await rpcdef(ctx(mock.endpoint))[METHOD_GET_ASSET_PATH]({ id: 'asset-1' });
    assert.equal(result.asset.name, 'linux-test');
    assert.equal(mock.requests.at(-1).path, '/api/v1/assets/assets/asset-1/');
  } finally {
    await mock.close();
  }
});

test('ListUsers maps user roles and supports username/password login', async () => {
  const mock = await createMockServer();
  try {
    const result = await handlers[METHOD_LIST_USERS_FULL](
      { limit: 10 },
      ctx(mock.endpoint, { secret: { token: '', username: 'admin', password: 'demo-password' } }),
    );
    assert.equal(result.total, 1);
    assert.equal(result.items[0].username, 'admin');
    assert.equal(result.items[0].role, 'System Admin');
    assert.equal(mock.requests[0].path, '/api/v1/authentication/auth/');
    assert.equal(mock.requests[1].headers.authorization, 'Bearer login-token');
  } finally {
    await mock.close();
  }
});

test('authorization secret overrides token and is sent as full header value', async () => {
  const mock = await createMockServer();
  try {
    const result = await handlers[METHOD_LIST_ASSETS_FULL](
      { limit: 5 },
      ctx(mock.endpoint, { secret: { token: '', authorization: 'Token custom-auth' } }),
    );
    assert.equal(result.total, 1);
    assert.equal(mock.requests.length, 1);
    assert.equal(mock.requests.at(-1).path, '/api/v1/assets/assets');
    assert.equal(mock.requests.at(-1).headers.authorization, 'Token custom-auth');
  } finally {
    await mock.close();
  }
});

test('ListOnlineSessions maps array response', async () => {
  const mock = await createMockServer();
  try {
    const result = await handlers[METHOD_LIST_ONLINE_SESSIONS_FULL]({}, ctx(mock.endpoint));
    assert.equal(result.total, 1);
    assert.equal(result.items[0].asset, 'linux-test');
    assert.equal(result.items[0].protocol, 'ssh');
    assert.equal(mock.requests.at(-1).query.is_finished, 'false');
  } finally {
    await mock.close();
  }
});

test('validates required endpoint and id, maps auth failure', async () => {
  await assert.rejects(
    () => handlers[METHOD_LIST_ASSETS_FULL]({}, ctx('', { config: { endpoint: '' } })),
    (err) => err instanceof GrpcError && err.legacyCode === 'INVALID_ARGUMENT',
  );

  await assert.rejects(
    () => handlers[METHOD_GET_ASSET_FULL]({}, ctx('http://example.test')),
    (err) => err instanceof GrpcError && err.legacyCode === 'INVALID_ARGUMENT',
  );

  const mock = await createMockServer();
  try {
    await assert.rejects(
      () => handlers[METHOD_LIST_ASSETS_FULL]({}, ctx(mock.endpoint, { secret: { token: 'bad-token' } })),
      (err) => err instanceof GrpcError && err.legacyCode === 'UNAUTHENTICATED',
    );
  } finally {
    await mock.close();
  }
});

test('normalizes booleans, integers, TLS settings, and JSON safely', () => {
  assert.equal(_test.boolOf({ value: 'yes' }), true);
  assert.equal(_test.boolOf('off'), false);
  assert.equal(_test.boolOf(2), true);
  assert.equal(_test.boolOf(Number.NaN), false);
  assert.equal(_test.boolOf('unknown'), false);
  assert.equal(_test.intOf({ value: '12.9' }), 12);
  assert.equal(_test.intOf('bad', 7), 7);
  assert.deepEqual(_test.buildTlsOptions({ bindings: { skipTlsVerify: true } }), {
    skipTlsVerify: true, tlsInsecureSkipVerify: true, insecureSkipVerify: true,
  });
  assert.deepEqual(_test.buildTlsOptions({ bindings: {} }), {});
  assert.deepEqual(_test.buildTlsOptions({ bindings: { rejectUnauthorized: false } }), {
    skipTlsVerify: true, tlsInsecureSkipVerify: true, insecureSkipVerify: true,
  });
  const circular = {};
  circular.self = circular;
  assert.equal(_test.jsonString(circular), 'null');
});

test('parses response bodies and maps HTTP status classes', () => {
  assert.equal(_test.parseBody('', 'request'), null);
  assert.deepEqual(_test.parseBody('{"ok":true}', 'request'), { ok: true });
  assert.throws(() => _test.parseBody('invalid', 'request'), /not valid JSON/);
  assert.equal(_test.mapHttpError('request', 403, '').legacyCode, 'PERMISSION_DENIED');
  assert.equal(_test.mapHttpError('request', 404, 'missing').legacyCode, 'FAILED_PRECONDITION');
  assert.equal(_test.mapHttpError('request', 503, 'busy').legacyCode, 'UNAVAILABLE');
});

test('maps alternative list and entity response shapes', () => {
  assert.deepEqual(_test.listFromResponse([{ id: 1 }]).total, 1);
  assert.deepEqual(_test.listFromResponse({ count: '2', data: [{}, {}] }).total, 2);
  assert.deepEqual(_test.listFromResponse({ unexpected: true }).items, []);
  assert.equal(_test.mapAsset({ ip: '192.0.2.2', description: 'desc' }).address, '192.0.2.2');
  assert.equal(_test.mapUser({ role: { name: 'Auditor' }, isActive: true }).role, 'Auditor');
  assert.equal(_test.mapSession({ user_display_name: 'alice', remoteAddr: '127.0.0.1' }).user, 'alice');
});

test('requires credentials and rejects unsupported endpoint schemes', async () => {
  await assert.rejects(
    () => handlers[METHOD_LIST_ASSETS_FULL]({}, ctx('ftp://example.test')),
    (err) => err instanceof GrpcError && err.legacyCode === 'INVALID_ARGUMENT',
  );
  await assert.rejects(
    () => handlers[METHOD_LIST_ASSETS_FULL]({}, ctx('http://example.test', { secret: { token: '' } })),
    (err) => err instanceof GrpcError && err.legacyCode === 'INVALID_ARGUMENT',
  );
});
