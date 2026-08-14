import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { handlers, MAX_QUERY_BYTES, MAX_RESPONSE_BYTES, rpcdef, _test } from '../src/openobserve-v0-15-1.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const names = {
  organizations: 'OpenObserve_v0_15_1.OpenObserve_v0_15_1/ListOrganizations',
  streams: 'OpenObserve_v0_15_1.OpenObserve_v0_15_1/ListStreams',
  schema: 'OpenObserve_v0_15_1.OpenObserve_v0_15_1/GetStreamSchema',
  search: 'OpenObserve_v0_15_1.OpenObserve_v0_15_1/SearchData',
  functions: 'OpenObserve_v0_15_1.OpenObserve_v0_15_1/ListFunctions',
};

const buildCtx = (overrides = {}) => ({
  config: { baseUrl: 'https://o2.example.com:5080', timeoutMs: 4000, ...(overrides.config || {}) },
  secret: { username: 'admin@openobserve.ai', password: 'changeme', ...(overrides.secret || {}) },
  bindings: overrides.bindings || {},
  req: overrides.req || {},
  request: overrides.request,
  limits: overrides.limits || {},
  meta: overrides.meta || {},
});

const invoke = (name, req, overrides = {}) => handlers[name](buildCtx({ ...overrides, req }));
const expectGrpcError = async (fn, legacyCode) => {
  try { await fn(); assert.fail('expected rejection'); }
  catch (err) { assert.ok(err instanceof GrpcError); assert.equal(err.legacyCode, legacyCode); return err; }
};

test('service exports the one-context SDK handler ABI', () => {
  assert.equal(typeof service, 'object');
  for (const handler of Object.values(handlers)) assert.equal(handler.length, 1);
});

test('all OpenObserve RPCs map deterministic mock responses and auth', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const overrides = { config: { baseUrl } };
    const organizations = await invoke(names.organizations, {}, overrides);
    const streams = await invoke(names.streams, { org_id: 'default', stream_type: 'logs', fetch_schema: true }, overrides);
    const schema = await invoke(names.schema, { org_id: 'default', stream: 'logs' }, overrides);
    const search = await invoke(names.search, { org_id: 'default', stream: 'logs', size: 2, from: 0, start_time: 0, end_time: 1 }, overrides);
    const functions = await invoke(names.functions, { org_id: 'default' }, overrides);
    assert.equal(organizations.organizations[0].name, 'default');
    assert.equal(streams.streams[0].name, 'logs');
    assert.equal(schema.schema.fields[0].name, '@timestamp');
    assert.equal(search.hits.length, 2);
    assert.equal(functions.functions.length, 2);
    assert.equal(mock.requests.length, 5);
    assert.equal(mock.requests[1].query.type, 'logs');
    assert.equal(mock.requests[1].query.fetchSchema, 'true');
    assert.match(mock.requests[0].headers.authorization, /^Basic /);
  } finally { await mock.close(); }
});

test('validation rejects missing fields and bounded search input', async () => {
  await expectGrpcError(() => invoke(names.streams, {}), 'INVALID_ARGUMENT');
  await expectGrpcError(() => invoke(names.schema, { org_id: 'default' }), 'INVALID_ARGUMENT');
  await expectGrpcError(() => invoke(names.search, { org_id: 'default' }), 'INVALID_ARGUMENT');
  await expectGrpcError(() => invoke(names.functions, {}), 'INVALID_ARGUMENT');
  await expectGrpcError(() => invoke(names.search, { org_id: 'default', stream: 'logs', size: 1001 }), 'INVALID_ARGUMENT');
  await expectGrpcError(() => invoke(names.search, { org_id: 'default', stream: 'logs', from: -1 }), 'INVALID_ARGUMENT');
  await expectGrpcError(() => invoke(names.search, { org_id: 'default', stream: 'logs', start_time: 2, end_time: 1 }), 'INVALID_ARGUMENT');
  await expectGrpcError(() => invoke(names.search, { org_id: 'default', stream: 'logs', query: 'x'.repeat(MAX_QUERY_BYTES + 1) }), 'INVALID_ARGUMENT');
});

test('context aliases, token authentication, and rpcdef cover every RPC', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const tokenResult = await handlers[names.organizations]({ config: { baseUrl }, secret: { token: 'never-log-this' }, request: {} });
    assert.equal(tokenResult.organizations.length, 2);
    assert.equal(mock.requests[0].headers.authorization, 'Bearer never-log-this');
    const routes = rpcdef(buildCtx({ config: { baseUrl } }));
    assert.equal(Object.keys(routes).length, 5);
    await routes['/OpenObserve_v0_15_1.OpenObserve_v0_15_1/ListOrganizations']();
    await routes['/OpenObserve_v0_15_1.OpenObserve_v0_15_1/ListStreams']({ org_id: 'default' });
    await routes['/OpenObserve_v0_15_1.OpenObserve_v0_15_1/GetStreamSchema']({ org_id: 'default', stream: 'logs' });
    await routes['/OpenObserve_v0_15_1.OpenObserve_v0_15_1/SearchData']({ org_id: 'default', stream: 'logs' });
    await routes['/OpenObserve_v0_15_1.OpenObserve_v0_15_1/ListFunctions']({ org_id: 'default' });
    assert.equal(mock.requests.length, 6);
  } finally { await mock.close(); }
});

test('transport denies redirects, enforces response bounds, and redacts failures', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal(init.redirect, 'error');
      return { status: 200, headers: { get: () => String(MAX_RESPONSE_BYTES + 1) }, text: async () => '' };
    };
    await expectGrpcError(() => _test.executeRequest('https://example.test/api?token=hidden', { bindings: {} }, { action: 'Size' }), 'RESOURCE_EXHAUSTED');

    globalThis.fetch = async () => ({ status: 200, headers: { get: () => '0' }, text: async () => 'x'.repeat(3) });
    await expectGrpcError(() => _test.executeRequest('https://example.test/api', { bindings: { maxResponseBytes: 2 } }, { action: 'Body' }), 'RESOURCE_EXHAUSTED');

    globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => {
      const error = new Error('password=hidden'); error.name = 'AbortError'; reject(error);
    }, { once: true }));
    const timeout = await expectGrpcError(() => _test.executeRequest('https://example.test/api', { bindings: { timeoutMs: 1 } }, { action: 'Timeout' }), 'DEADLINE_EXCEEDED');
    assert.doesNotMatch(timeout.message, /hidden/);

    globalThis.fetch = async () => { throw new Error('token=hidden'); };
    const network = await expectGrpcError(() => _test.executeRequest('https://example.test/api', { bindings: {} }, { action: 'Network' }), 'UNAVAILABLE');
    assert.doesNotMatch(network.message, /hidden/);
  } finally { globalThis.fetch = originalFetch; }
});

test('TLS is opt-in for HTTPS only and URL/error helpers remain safe', async () => {
  assert.deepEqual(_test.buildTlsOptions({ skipTlsVerify: true }, 'http://example.test'), {});
  assert.ok(_test.buildTlsOptions({ tlsInsecureSkipVerify: 'true' }, 'https://example.test').dispatcher);
  assert.equal(_test.resolveBaseUrl({ baseUrl: 'https://user:password@example.test' }), '');
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeoutMs: 999999 } }), 120000);
  assert.equal(_test.resolveMaxResponseBytes({ bindings: { maxResponseBytes: MAX_RESPONSE_BYTES + 1 } }), MAX_RESPONSE_BYTES);
  try { _test.ensureSuccess({ httpStatus: 403, httpBody: 'token=hidden' }, 'Read'); assert.fail('expected error'); }
  catch (error) { assert.equal(error.code, grpcStatus.PERMISSION_DENIED); assert.doesNotMatch(error.message, /hidden/); assert.equal(error.response.http_body, ''); }
  await expectGrpcError(() => Promise.resolve(_test.parseJsonOrThrowUnknown({ httpStatus: 200, httpBody: 'password=hidden' }, 'Read')), 'UNKNOWN');
});

test('normalizers and error mappings accept supported scalar/context shapes', async () => {
  assert.equal(_test.resolveBaseUrl({ domain: { value: 'https://example.test/' } }), 'https://example.test');
  assert.equal(_test.resolveBaseUrl({ url: 'ftp://example.test' }), '');
  assert.equal(_test.resolveUsername({ user: { value: ' alice ' } }), 'alice');
  assert.equal(_test.resolvePassword({ passwd: ' secret ' }), 'secret');
  assert.equal(_test.toTrimmedString(null), '');
  assert.equal(_test.toFiniteInt('12.9'), 12);
  assert.equal(_test.toFiniteInt('bad', 7), 7);
  assert.equal(_test.toBool(true), true);
  assert.equal(_test.toBool('off', true), false);
  assert.equal(_test.toBool('unexpected', true), true);
  assert.equal(_test.toJsonString({ value: 1 }), '{"value":1}');
  assert.equal(_test.toJsonString(null), '');
  assert.equal(_test.boundedInt(undefined, 'n', 3, 1, 4), 3);
  await expectGrpcError(() => Promise.resolve(_test.boundedInt(5, 'n', 3, 1, 4)), 'INVALID_ARGUMENT');
  assert.equal(_test.optionalTimestamp(0, 't'), 0);
  await expectGrpcError(() => Promise.resolve(_test.optionalTimestamp(-1, 't')), 'INVALID_ARGUMENT');
  assert.deepEqual(_test.requestFrom({ request: { id: 1 } }), { id: 1 });
  assert.deepEqual(_test.requestFrom({ req: { id: 2 } }), { id: 2 });
  assert.match(_test.buildAuthHeaders({ bindings: { username: 'u', password: 'p' } }).Authorization, /^Basic /);
  assert.equal(_test.buildAuthHeaders({ bindings: { apiToken: 't' } }).Authorization, 'Bearer t');
  await expectGrpcError(() => Promise.resolve(_test.buildAuthHeaders({ bindings: {} })), 'INVALID_ARGUMENT');
  for (const [status, code] of [[401, 'PERMISSION_DENIED'], [403, 'PERMISSION_DENIED'], [404, 'NOT_FOUND'], [422, 'FAILED_PRECONDITION'], [500, 'UNAVAILABLE']]) {
    await expectGrpcError(() => Promise.resolve(_test.ensureSuccess({ httpStatus: status, httpBody: '' }, 'Status')), code);
  }
});

test('transport also maps response-read failures without upstream details', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ status: 200, headers: { get: () => '0' }, text: async () => { throw new Error('password=hidden'); } });
    const error = await expectGrpcError(() => _test.executeRequest('https://example.test/api', { bindings: {} }, { action: 'Read' }), 'UNAVAILABLE');
    assert.doesNotMatch(error.message, /hidden/);
  } finally { globalThis.fetch = originalFetch; }
});

test('response mappers handle documented alternate upstream payload shapes', async () => {
  const originalFetch = globalThis.fetch;
  const payloads = [
    [{ name: 'organization-name' }],
    { data: [{ name: 'stream-name', type: 'logs', createdAt: 'now' }] },
    { fields: [{ name: 'field-name', data_type: 'keyword' }] },
    { hits: [{ timestamp: 'now' }], took: 1, total: 1 },
    { functions: [{ name: 'function-name', createdAt: 'now', updatedAt: 'later' }] },
  ];
  try {
    globalThis.fetch = async () => ({ status: 200, headers: { get: () => '0' }, text: async () => JSON.stringify(payloads.shift()) });
    const overrides = { bindings: { baseUrl: 'https://example.test', token: 'token' }, meta: { instanceId: 'i', requestId: 'r' } };
    assert.equal((await invoke(names.organizations, {}, overrides)).organizations[0].id, 'organization-name');
    assert.equal((await invoke(names.streams, { org_id: 'o', stream_type: 'logs', fetch_schema: false }, overrides)).streams[0].stream_type, 'logs');
    assert.equal((await invoke(names.schema, { orgId: 'o', stream: 's' }, overrides)).schema.fields[0].type, 'keyword');
    assert.equal((await invoke(names.search, { org_id: 'o', stream: 's', sort_by: 'time', sort_desc: true }, overrides)).hits[0].timestamp, 'now');
    assert.equal((await invoke(names.functions, { org_id: 'o' }, overrides)).functions[0].updated_at, 'later');
  } finally { globalThis.fetch = originalFetch; }
});
