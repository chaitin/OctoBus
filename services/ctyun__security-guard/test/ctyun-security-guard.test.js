import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  READ_ONLY_APIS,
  SERVICE_PACKAGE,
  _test,
  handlers,
  rpcdef,
} from '../src/ctyun-security-guard.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;

const response = (status, body) => ({
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const setFetch = (impl) => {
  globalThis.fetch = impl;
};

const buildCtx = (overrides = {}) => ({
  config: {
    ...(overrides.config || {}),
  },
  secret: {
    accessKeyId: 'AKEXAMPLE',
    secretAccessKey: 'SKEXAMPLE',
    ...(overrides.secret || {}),
  },
  bindings: {
    headers: { 'X-Custom': 'trace' },
    ...(overrides.bindings || {}),
  },
  limits: { timeoutMs: 9000, ...(overrides.limits || {}) },
  meta: {
    date: new Date('2024-01-16T08:00:00Z'),
    request_id: '27cfe4dc-e640-45f6-92ca-492ca73e8680',
    ...(overrides.meta || {}),
  },
});

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
  DEADLINE_EXCEEDED: grpcStatus.DEADLINE_EXCEEDED,
    UNKNOWN: grpcStatus.UNKNOWN,
  })[legacyCode]);
  checker(caught);
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('service exports handlers and rpcdef paths', () => {
  assert.equal(typeof service, 'object');
  for (const entry of READ_ONLY_APIS) {
    assert.equal(typeof handlers[`${SERVICE_PACKAGE}/${entry.methodName}`], 'function');
    assert.equal(typeof rpcdef()[`/${SERVICE_PACKAGE}/${entry.methodName}`], 'function');
  }
});

test('validates credentials and read-only API names', () => {
  assert.equal(_test.validateBindings({ ak: 'id', sk: 'key' }).accessKeyId, 'id');
  assert.throws(() => _test.validateBindings({ sk: 'key' }), /accessKeyId/);
  assert.throws(() => _test.validateBindings({ ak: 'id' }), /secretAccessKey/);
  assert.equal(_test.validateApiSpec('assetClassify').path, '/v1/assert/statistics');
  assert.throws(() => _test.validateApiSpec('openStatus'), /unsupported/);
  assert.throws(() => _test.validateApiSpec('v1hostdelete'), /unsupported/);
  assert.throws(() => _test.validateApiSpec('quotaList'), /unsupported/);
  assert.throws(() => _test.validateApiSpec('v1indexisSign'), /unsupported/);
});

test('normalizes protobuf Struct payloads', () => {
  assert.deepEqual(_test.normalizeStruct({
    fields: {
      page: { numberValue: 1 },
      keywords: { stringValue: 'host-a' },
      pathParams: { listValue: { values: [{ stringValue: 'agent-1' }] } },
      exact: { boolValue: true },
    },
  }), {
    page: 1,
    keywords: 'host-a',
    pathParams: ['agent-1'],
    exact: true,
  });
});

test('builds CTYun EOP dates, query strings, and signatures', () => {
  assert.equal(_test.eopDateFromDate(new Date('2024-01-16T08:00:00Z')), '20240116T160000Z');
  assert.equal(_test.queryParamsToString({ b: 'x y', a: '2021-04-04T06:01:46Z' }), 'a=2021-04-04T06%3A01%3A46Z&b=x%20y');
  assert.throws(() => _test.queryParamsToString({ filter: { name: 'asset' } }), /nested object/);
  assert.throws(() => _test.queryParamsToString({ filter: ['ok', { name: 'asset' }] }), /nested object/);

  const signed = _test.signRequest({
    query: { page: 1, pageSize: 10 },
    bodyText: '',
    accessKeyId: 'AKEXAMPLE',
    secretAccessKey: 'SKEXAMPLE',
    requestId: '27cfe4dc-e640-45f6-92ca-492ca73e8680',
    date: new Date('2024-01-16T08:00:00Z'),
  });

  assert.equal(signed.headers['ctyun-eop-request-id'], '27cfe4dc-e640-45f6-92ca-492ca73e8680');
  assert.equal(signed.headers['Eop-date'], '20240116T160000Z');
  assert.match(
    signed.headers['Eop-Authorization'],
    /^AKEXAMPLE Headers=ctyun-eop-request-id;eop-date Signature=[A-Za-z0-9+/]+=*$/,
  );
  assert.match(signed.canonicalRequest, /^ctyun-eop-request-id:27cfe4dc-e640-45f6-92ca-492ca73e8680\neop-date:20240116T160000Z\n\npage=1&pageSize=10\n[0-9a-f]{64}$/);
});

test('maps CTYun business and transport errors', async () => {
  setFetch(async () => response(200, { error: 'CTCSSCN_000004', statusCode: '403', message: '鉴权错误' }));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/AssetClassify`]({}, buildCtx()),
    'PERMISSION_DENIED',
    (err) => assert.match(err.message, /CTCSSCN_000004/),
  );

  setFetch(async () => response(200, { error: 'CTCSSCN_000005', statusCode: '200', message: '用户没有付费版配额' }));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/AssetClassify`]({}, buildCtx()),
    'FAILED_PRECONDITION',
    (err) => assert.match(err.message, /CTCSSCN_000005/),
  );

  setFetch(async () => response(503, { statusCode: 500000, message: 'busy' }));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/AssetClassify`]({}, buildCtx()),
    'UNAVAILABLE',
    (err) => assert.match(err.message, /HTTP 503/),
  );

  setFetch(async () => response(200, 'not json'));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/AssetClassify`]({}, buildCtx()),
    'UNKNOWN',
    (err) => assert.match(err.message, /non-JSON/),
  );

  setFetch(async () => {
    const err = new Error('timeout');
    err.name = 'AbortError';
    throw err;
  });
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/AssetClassify`]({}, buildCtx({ limits: { timeoutMs: 25 } })),
    'DEADLINE_EXCEEDED',
    (err) => assert.match(err.message, /timed out after 25ms/),
  );

  setFetch(async (_url, init) => ({
    status: 200,
    text: () => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const err = new Error('body stream timeout');
        err.name = 'AbortError';
        reject(err);
      }, { once: true });
      setTimeout(() => reject(new Error('signal was not aborted')), 100);
    }),
  }));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/AssetClassify`]({}, buildCtx({ limits: { timeoutMs: 5 } })),
    'DEADLINE_EXCEEDED',
    (err) => assert.match(err.message, /timed out after 5ms/),
  );
});

test('handler accepts OctoBus SDK single-argument context', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, { statusCode: '200', returnObj: { vulRiskNum: 0 } });
  });

  await handlers[`${SERVICE_PACKAGE}/AssetClassify`]({
    request: {},
    config: {},
    secret: {
      accessKeyId: 'SDKAK',
      secretAccessKey: 'SDKSK',
    },
    limits: { timeoutMs: 10_000 },
    meta: {
      date: new Date('2024-01-16T08:00:00Z'),
      request_id: '27cfe4dc-e640-45f6-92ca-492ca73e8680',
    },
  });

  const url = new URL(captured.url);
  assert.equal(url.pathname, '/v1/assert/statistics');
  assert.match(captured.init.headers['Eop-Authorization'], /^SDKAK Headers=ctyun-eop-request-id;eop-date Signature=/);
});
