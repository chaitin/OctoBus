import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError } from '@chaitin-ai/octobus-sdk';

import {
  handlers,
  _test,
} from '../src/huawei-ccm.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

const CCM_LIST_RESP = {
  total: 2,
  certificates: [
    { id: 'cert-1', domain: 'example.com', status: 'ISSUED', create_time: '2026-01-15T08:00:00Z', expire_time: '2027-01-15T08:00:00Z' },
    { id: 'cert-2', domain: 'test.org', status: 'PENDING', create_time: '2026-06-01T10:00:00Z', expire_time: '2027-06-01T10:00:00Z' },
  ],
};

const CCM_DETAIL_RESP = {
  id: 'cert-1',
  domain: 'example.com',
  status: 'ISSUED',
  create_time: '2026-01-15T08:00:00Z',
  expire_time: '2027-01-15T08:00:00Z',
  subject: 'CN=example.com',
  subject_alternative_names: ['example.com', 'www.example.com'],
};

// Context factory: returns a flat context object with config/secret/bindings
const ctx = (overrides = {}) => ({
  config: { ...(overrides.config || {}) },
  secret: {
    accessKey: 'test-ak',
    secretKey: 'test-sk',
    ...(overrides.secret || {}),
  },
  bindings: { ...(overrides.bindings || {}) },
  limits: { timeoutMs: 2000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
});

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
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

test.beforeEach(() => {
  console.log = () => {};
  console.error = () => {};
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
});

test('service exports handlers', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers['Huawei_CCM.Huawei_CCM/ListCertificates'], 'function');
  assert.equal(typeof handlers['Huawei_CCM.Huawei_CCM/GetCertificate'], 'function');
});

test('ListCertificates returns certificate list', async () => {
  setFetch(async (url, init) => {
    assert.ok(url.startsWith('https://scm.cn-north-4.myhuaweicloud.com/v3/scm/certificates'));
    assert.equal(init.method, 'GET');
    assert.ok(init.headers['X-Sdk-Date']);
    assert.ok(init.headers['Authorization']);
    return response(200, CCM_LIST_RESP);
  });

  const result = await handlers['Huawei_CCM.Huawei_CCM/ListCertificates']({ ...ctx(), request: { limit: 50 } });
  assert.equal(result.code, 0);
  assert.equal(result.total, 2);
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].id, 'cert-1');
  assert.equal(result.data[0].domain, 'example.com');
  assert.equal(result.data[0].status, 'ISSUED');
});

test('GetCertificate returns certificate detail', async () => {
  setFetch(async (url, init) => {
    assert.ok(url.endsWith('/v3/scm/certificates/cert-1'));
    assert.equal(init.method, 'GET');
    return response(200, CCM_DETAIL_RESP);
  });

  const result = await handlers['Huawei_CCM.Huawei_CCM/GetCertificate']({ ...ctx(), request: { certificate_id: 'cert-1' } });
  assert.equal(result.code, 0);
  assert.equal(result.id, 'cert-1');
  assert.equal(result.domain, 'example.com');
  assert.equal(result.status, 'ISSUED');
  assert.ok(result.san.includes('example.com'));
});

test('validates required credentials and certificate_id', async () => {
  await expectGrpcError(
    () => handlers['Huawei_CCM.Huawei_CCM/ListCertificates']({ ...ctx({ secret: { accessKey: '' } }), request: {} }),
    'PERMISSION_DENIED',
  );
  await expectGrpcError(
    () => handlers['Huawei_CCM.Huawei_CCM/ListCertificates']({ ...ctx({ secret: { accessKey: 'ok', secretKey: '' } }), request: {} }),
    'PERMISSION_DENIED',
  );
  await expectGrpcError(
    () => handlers['Huawei_CCM.Huawei_CCM/GetCertificate']({ ...ctx(), request: {} }),
    'INVALID_ARGUMENT',
  );
});

test('handles HTTP transport errors', async () => {
  setFetch(async () => response(403, 'forbidden'));
  await expectGrpcError(
    () => handlers['Huawei_CCM.Huawei_CCM/ListCertificates']({ ...ctx(), request: {} }),
    'PERMISSION_DENIED',
  );

  setFetch(async () => response(500, 'server error'));
  await expectGrpcError(
    () => handlers['Huawei_CCM.Huawei_CCM/ListCertificates']({ ...ctx(), request: {} }),
    'UNAVAILABLE',
  );

  setFetch(async () => { throw Object.assign(new Error('outer'), { cause: new Error('timeout') }); });
  await expectGrpcError(
    () => handlers['Huawei_CCM.Huawei_CCM/ListCertificates']({ ...ctx(), request: {} }),
    'UNAVAILABLE',
  );
});

test('handles empty response gracefully', async () => {
  setFetch(async () => ({ ok: true, status: 200, headers: { get: () => 'text/plain' }, text: async () => '' }));
  const result = await handlers['Huawei_CCM.Huawei_CCM/ListCertificates']({ ...ctx(), request: {} });
  assert.equal(result.code, 0);
  assert.equal(result.data.length, 0);
  assert.equal(result.total, 0);
});

test('helper functions cover value utilities', () => {
  assert.equal(_test.firstDefined(undefined, null, 'x'), 'x');
  assert.equal(_test.unwrapString({ value: { value: 'nested' } }), 'nested');
  assert.equal(_test.unwrapString(null), '');
  assert.equal(_test.toBoolean({ value: 'yes' }), true);
  assert.equal(_test.toBoolean('off'), false);
  assert.equal(_test.optionalUint32({ value: '10.9' }), 10);
  assert.equal(_test.optionalUint32('bad'), undefined);
});

test('resolveCallContext merges config secret and bindings', () => {
  const result = _test.resolveCallContext({
    config: { timeoutMs: 5000 },
    secret: { accessKey: 'ak-1', secretKey: 'sk-1' },
    bindings: { accessKey: 'override-ak' },
    request: { limit: 10 },
  });
  assert.equal(result.bindings.timeoutMs, 5000);
  assert.equal(result.bindings.accessKey, 'override-ak');
  assert.equal(result.bindings.secretKey, 'sk-1');
  assert.deepEqual(result.req, { limit: 10 });
});

test('signHuawei produces valid authorization header', () => {
  const { authorization, sdkDate } = _test.signHuawei(
    'test-ak', 'test-sk', 'GET', '/v3/scm/certificates', '', '', '20260626T120000Z',
  );
  assert.ok(authorization.startsWith('SDK-HMAC-SHA256 Access='));
  assert.ok(authorization.includes('Signature='));
  assert.equal(sdkDate, '20260626T120000Z');
});

test('buildCanonicalQueryString sorts keys', () => {
  const qs = _test.buildCanonicalQueryString({ offset: 0, limit: 50 });
  assert.equal(qs, 'limit=50&offset=0');
});

test('iso8601Basic produces correct format', () => {
  const ts = 1720000000; // a known timestamp
  const result = _test.iso8601Basic(ts);
  assert.equal(result.length, 16); // YYYYMMDDTHHMMSSZ
  assert.ok(result.endsWith('Z'));
});

test('logging falls back when JSON stringify fails', () => {
  const logCalls = [];
  const errorCalls = [];
  console.log = (...args) => logCalls.push(args);
  console.error = (...args) => errorCalls.push(args);
  const circular = {};
  circular.self = circular;
  _test.logInfo({ instanceId: 'inst', requestId: 'req' }, 'Test', circular);
  _test.logError({ instance_id: 'inst', request_id: 'req' }, 'Test', circular);
  assert.equal(logCalls[0][0], '[Huawei_CCM][Test][inst=inst req=req]');
  assert.equal(errorCalls[0][0], '[Huawei_CCM][Test][inst=inst req=req]');
});
