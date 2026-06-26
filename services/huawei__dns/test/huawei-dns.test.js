import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError } from '@chaitin-ai/octobus-sdk';

import {
  handlers,
  _test,
} from '../src/huawei-dns.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

const DNS_ZONES_RESP = {
  zones: [
    { id: 'zone-1', name: 'example.com.', zone_type: 'public', status: 'ACTIVE', ttl: 300, created_at: '2026-01-01T00:00:00Z' },
    { id: 'zone-2', name: 'test.org.', zone_type: 'private', status: 'ACTIVE', ttl: 600, created_at: '2026-02-01T00:00:00Z' },
  ],
};

const DNS_RECORDSETS_RESP = {
  recordsets: [
    { id: 'rs-1', name: 'www.example.com.', type: 'A', records: ['1.2.3.4'], ttl: 300, status: 'ACTIVE', zone_id: 'zone-1', zone_name: 'example.com.', created_at: '2026-01-01T00:00:00Z' },
    { id: 'rs-2', name: 'mail.example.com.', type: 'MX', records: ['10 mail.example.com.'], ttl: 600, status: 'ACTIVE', zone_id: 'zone-1', zone_name: 'example.com.', created_at: '2026-01-02T00:00:00Z' },
  ],
};

const DNS_CREATE_RESP = {
  id: 'rs-3', name: 'sinkhole.example.com.', type: 'A', records: ['127.0.0.1'], ttl: 300,
};

const DNS_DELETE_RESP = {};

const ctx = (overrides = {}) => ({
  config: { ...(overrides.config || {}) },
  secret: {
    accessKey: 'test-ak', secretKey: 'test-sk',
    ...(overrides.secret || {}),
  },
  bindings: { ...(overrides.bindings || {}) },
  limits: { timeoutMs: 2000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
});

const response = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'application/json' : '') },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const setFetch = (impl) => { globalThis.fetch = impl; };

const expectGrpcError = async (fn, legacyCode) => {
  let caught;
  try { await fn(); } catch (err) { caught = err; }
  assert.ok(caught, 'expected function to reject');
  assert.ok(caught instanceof GrpcError);
  assert.equal(caught.legacyCode, legacyCode);
  assert.match(caught.message, new RegExp(`^${legacyCode}:`));
};

test.beforeEach(() => { console.log = () => {}; console.error = () => {}; });
test.afterEach(() => { globalThis.fetch = originalFetch; console.log = originalConsoleLog; console.error = originalConsoleError; });

// ---- Service Export ----

test('service exports handlers', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers['Huawei_DNS.Huawei_DNS/ListZones'], 'function');
  assert.equal(typeof handlers['Huawei_DNS.Huawei_DNS/ListRecordSets'], 'function');
  assert.equal(typeof handlers['Huawei_DNS.Huawei_DNS/CreateRecordSet'], 'function');
  assert.equal(typeof handlers['Huawei_DNS.Huawei_DNS/DeleteRecordSet'], 'function');
});

// ---- ListZones ----

test('ListZones returns zone list', async () => {
  setFetch(async (url, init) => {
    assert.ok(url.includes('dns.myhuaweicloud.com/v2/zones'));
    assert.equal(init.method, 'GET');
    return response(200, DNS_ZONES_RESP);
  });
  const result = await handlers['Huawei_DNS.Huawei_DNS/ListZones']({ ...ctx(), request: {} });
  assert.equal(result.code, 0);
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].name, 'example.com.');
  assert.equal(result.data[0].zone_type, 'public');
});

// ---- ListRecordSets ----

test('ListRecordSets returns recordsets', async () => {
  setFetch(async () => response(200, DNS_RECORDSETS_RESP));
  const result = await handlers['Huawei_DNS.Huawei_DNS/ListRecordSets']({ ...ctx(), request: { zone_id: 'zone-1' } });
  assert.equal(result.code, 0);
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].name, 'www.example.com.');
  assert.equal(result.data[0].type, 'A');
  assert.equal(result.data[0].value, '1.2.3.4');
});

test('ListRecordSets validates zone_id', async () => {
  await expectGrpcError(
    () => handlers['Huawei_DNS.Huawei_DNS/ListRecordSets']({ ...ctx(), request: {} }),
    'INVALID_ARGUMENT',
  );
});

// ---- CreateRecordSet ----

test('CreateRecordSet creates A record', async () => {
  setFetch(async (url, init) => {
    assert.ok(url.includes('/v2/zones/zone-1/recordsets'));
    assert.equal(init.method, 'POST');
    const b = JSON.parse(init.body);
    assert.equal(b.name, 'sinkhole.example.com.');
    assert.equal(b.type, 'A');
    assert.deepEqual(b.records, ['127.0.0.1']);
    return response(200, DNS_CREATE_RESP);
  });
  const result = await handlers['Huawei_DNS.Huawei_DNS/CreateRecordSet']({
    ...ctx(), request: { zone_id: 'zone-1', name: 'sinkhole.example.com.', type: 'A', value: '127.0.0.1' },
  });
  assert.equal(result.code, 0);
  assert.equal(result.id, 'rs-3');
  assert.equal(result.type, 'A');
});

test('CreateRecordSet validates required fields', async () => {
  await expectGrpcError(
    () => handlers['Huawei_DNS.Huawei_DNS/CreateRecordSet']({ ...ctx(), request: { zone_id: 'z', name: 'n', type: 'A' } }),
    'INVALID_ARGUMENT',
  );
  await expectGrpcError(
    () => handlers['Huawei_DNS.Huawei_DNS/CreateRecordSet']({ ...ctx(), request: {} }),
    'INVALID_ARGUMENT',
  );
});

// ---- DeleteRecordSet ----

test('DeleteRecordSet deletes record', async () => {
  setFetch(async (url, init) => {
    assert.ok(url.includes('/v2/zones/zone-1/recordsets/rs-1'));
    assert.equal(init.method, 'DELETE');
    return response(200, DNS_DELETE_RESP);
  });
  const result = await handlers['Huawei_DNS.Huawei_DNS/DeleteRecordSet']({ ...ctx(), request: { zone_id: 'zone-1', recordset_id: 'rs-1' } });
  assert.equal(result.code, 0);
});

test('DeleteRecordSet validates fields', async () => {
  await expectGrpcError(
    () => handlers['Huawei_DNS.Huawei_DNS/DeleteRecordSet']({ ...ctx(), request: {} }),
    'INVALID_ARGUMENT',
  );
});

// ---- Credentials ----

test('validates required credentials', async () => {
  await expectGrpcError(
    () => handlers['Huawei_DNS.Huawei_DNS/ListZones']({ ...ctx({ secret: { accessKey: '' } }), request: {} }),
    'PERMISSION_DENIED',
  );
});

// ---- HTTP Errors ----

test('handles HTTP transport errors', async () => {
  setFetch(async () => response(403, 'forbidden'));
  await expectGrpcError(
    () => handlers['Huawei_DNS.Huawei_DNS/ListZones']({ ...ctx(), request: {} }),
    'PERMISSION_DENIED',
  );
});

// ---- Signing ----

test('signHuawei produces valid authorization header', () => {
  const { authorization } = _test.signHuawei('test-ak', 'test-sk', 'GET', '/v2/zones', '', '', '20260626T120000Z');
  assert.ok(authorization.startsWith('SDK-HMAC-SHA256 Access='));
  assert.ok(authorization.includes('Signature='));
});

// ---- Helpers ----

test('helper functions cover value utilities', () => {
  assert.equal(_test.firstDefined(undefined, null, 'x'), 'x');
  assert.equal(_test.unwrapString({ value: { value: 'nested' } }), 'nested');
  assert.equal(_test.toBoolean({ value: 'yes' }), true);
  assert.equal(_test.ensureTrailingSlash('/test'), '/test/');
  assert.equal(_test.ensureTrailingSlash('/test/'), '/test/');
  assert.equal(_test.ensureTrailingSlash('/'), '/');
});

test('resolveCallContext merges correctly', () => {
  const r = _test.resolveCallContext({
    config: {}, secret: { accessKey: 'ak-1', secretKey: 'sk-1' },
    bindings: { secretKey: 'override-sk' }, request: { zone_id: 'z1' },
  });
  assert.equal(r.bindings.secretKey, 'override-sk');
  assert.equal(r.bindings.accessKey, 'ak-1');
});
