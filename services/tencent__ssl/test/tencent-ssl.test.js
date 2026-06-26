import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError } from '@chaitin-ai/octobus-sdk';

import {
  handlers,
  _test,
} from '../src/tencent-ssl.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

const SSL_LIST_RESP = {
  TotalCount: 2,
  Certificates: [
    { CertificateId: 'cert-1', Domain: 'example.com', CertificateType: 'SVR', StatusName: '已签发', InsertTime: '2026-06-25 10:00:00', CertEndTime: '2026-09-25 10:00:00' },
    { CertificateId: 'cert-2', Domain: 'test.org', CertificateType: 'SVR', StatusName: '审核中', InsertTime: '2026-06-24 08:00:00', CertEndTime: '' },
  ],
  RequestId: 'req-list-1',
};

const SSL_DETAIL_RESP = {
  CertificateId: 'cert-1',
  Domain: 'example.com',
  CertificateType: 'SVR',
  StatusName: '已签发',
  Status: 1,
  InsertTime: '2026-06-25 10:00:00',
  CertEndTime: '2026-09-25 10:00:00',
  Subject: 'example.com',
  SubjectAltName: ['example.com', 'www.example.com'],
  RequestId: 'req-detail-1',
};

// Context factory: returns a flat context object with config/secret/bindings
const ctx = (overrides = {}) => ({
  config: { ...(overrides.config || {}) },
  secret: {
    secretId: 'test-secret-id',
    secretKey: 'test-secret-key',
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
  assert.equal(typeof handlers['Tencent_SSL.Tencent_SSL/ListCertificates'], 'function');
  assert.equal(typeof handlers['Tencent_SSL.Tencent_SSL/GetCertificate'], 'function');
});

test('ListCertificates returns certificate list', async () => {
  setFetch(async (url, init) => {
    assert.ok(url.startsWith('https://ssl.tencentcloudapi.com'));
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['X-TC-Action'], 'DescribeCertificates');
    return response(200, { Response: SSL_LIST_RESP });
  });

  const result = await handlers['Tencent_SSL.Tencent_SSL/ListCertificates']({ ...ctx(), request: { limit: 20 } });
  assert.equal(result.code, 0);
  assert.equal(result.total, 2);
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].id, 'cert-1');
  assert.equal(result.data[0].domain, 'example.com');
  assert.equal(result.data[0].status, '已签发');
});

test('GetCertificate returns certificate detail', async () => {
  setFetch(async () => response(200, { Response: SSL_DETAIL_RESP }));

  const result = await handlers['Tencent_SSL.Tencent_SSL/GetCertificate']({ ...ctx(), request: { certificate_id: 'cert-1' } });
  assert.equal(result.code, 0);
  assert.equal(result.id, 'cert-1');
  assert.equal(result.domain, 'example.com');
  assert.equal(result.status, '已签发');
  assert.ok(result.san.includes('example.com'));
});

test('validates required secret_id and certificate_id', async () => {
  await expectGrpcError(
    () => handlers['Tencent_SSL.Tencent_SSL/ListCertificates']({ ...ctx({ secret: { secretId: '' } }), request: {} }),
    'PERMISSION_DENIED',
  );
  await expectGrpcError(
    () => handlers['Tencent_SSL.Tencent_SSL/ListCertificates']({ ...ctx({ secret: { secretId: 'ok', secretKey: '' } }), request: {} }),
    'PERMISSION_DENIED',
  );
  await expectGrpcError(
    () => handlers['Tencent_SSL.Tencent_SSL/GetCertificate']({ ...ctx(), request: {} }),
    'INVALID_ARGUMENT',
  );
});

test('maps API errors correctly', async () => {
  setFetch(async () => response(200, { Response: { Error: { Code: 'UnauthorizedOperation', Message: 'no permission' } } }));
  await expectGrpcError(
    () => handlers['Tencent_SSL.Tencent_SSL/ListCertificates']({ ...ctx(), request: {} }),
    'PERMISSION_DENIED',
  );

  setFetch(async () => response(200, { Response: { Error: { Code: 'FailedOperation', Message: 'failed' } } }));
  await expectGrpcError(
    () => handlers['Tencent_SSL.Tencent_SSL/ListCertificates']({ ...ctx(), request: {} }),
    'FAILED_PRECONDITION',
  );
});

test('handles HTTP transport errors', async () => {
  setFetch(async () => response(403, 'forbidden'));
  await expectGrpcError(
    () => handlers['Tencent_SSL.Tencent_SSL/ListCertificates']({ ...ctx(), request: {} }),
    'PERMISSION_DENIED',
  );

  setFetch(async () => response(500, 'server error'));
  await expectGrpcError(
    () => handlers['Tencent_SSL.Tencent_SSL/ListCertificates']({ ...ctx(), request: {} }),
    'UNAVAILABLE',
  );

  setFetch(async () => { throw Object.assign(new Error('outer'), { cause: new Error('timeout') }); });
  await expectGrpcError(
    () => handlers['Tencent_SSL.Tencent_SSL/ListCertificates']({ ...ctx(), request: {} }),
    'UNAVAILABLE',
  );
});

test('handles empty response', async () => {
  setFetch(async () => ({ ok: true, status: 200, headers: { get: () => 'text/plain' }, text: async () => '' }));
  await expectGrpcError(
    () => handlers['Tencent_SSL.Tencent_SSL/ListCertificates']({ ...ctx(), request: {} }),
    'UNKNOWN',
  );
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
    config: { region: 'ap-shanghai' },
    secret: { secretId: 'sec-id', secretKey: 'sec-key' },
    bindings: { secretId: 'override-id' },
    request: { limit: 10 },
  });
  assert.equal(result.bindings.region, 'ap-shanghai');
  assert.equal(result.bindings.secretId, 'override-id');
  assert.equal(result.bindings.secretKey, 'sec-key');
  assert.deepEqual(result.req, { limit: 10 });
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
  assert.equal(logCalls[0][0], '[Tencent_SSL][Test][inst=inst req=req]');
  assert.equal(errorCalls[0][0], '[Tencent_SSL][Test][inst=inst req=req]');
});
