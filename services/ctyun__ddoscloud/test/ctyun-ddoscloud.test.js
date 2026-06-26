import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_INVOKE_READ_ONLY_API_FULL,
  METHOD_INVOKE_READ_ONLY_API_PATH,
  READ_ONLY_APIS,
  SERVICE_PACKAGE,
  _test,
  handlers,
  rpcdef,
} from '../src/ctyun-ddoscloud.js';
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
  assert.equal(typeof handlers[METHOD_INVOKE_READ_ONLY_API_FULL], 'function');
  assert.equal(typeof rpcdef()[METHOD_INVOKE_READ_ONLY_API_PATH], 'function');
});

test('validates required credentials and supported read-only APIs', () => {
  assert.equal(_test.validateBindings({ ak: 'id', sk: 'key' }).accessKeyId, 'id');
  assert.throws(() => _test.validateBindings({ sk: 'key' }), /accessKeyId/);
  assert.throws(() => _test.validateBindings({ ak: 'id' }), /secretAccessKey/);
  assert.equal(_test.validateApiSpec('domainQuery').path, '/ctapi/v2/domain/query');
  assert.equal(_test.validateApiSpec('getDdosAttackTrend').httpMethod, 'POST');
  assert.equal(_test.validateApiSpec('verifyDomainOwnershipContent').path, '/ctapi/v1/verify_domain_ownership/verify_content');
  assert.throws(() => _test.validateApiSpec('domainAdd'), /unsupported/);
  assert.throws(() => _test.validateApiSpec('deletePort'), /unsupported/);
  assert.throws(() => _test.validateApiSpec('topDomain'), /unsupported/);
});

test('normalizes protobuf Struct payloads', () => {
  assert.deepEqual(_test.normalizeStruct({
    fields: {
      page: { numberValue: 1 },
      domain: { stringValue: 'www.ctyun.cn' },
      domainList: { listValue: { values: [{ stringValue: 'a.example' }, { stringValue: 'b.example' }] } },
      enabled: { boolValue: true },
    },
  }), {
    page: 1,
    domain: 'www.ctyun.cn',
    domainList: ['a.example', 'b.example'],
    enabled: true,
  });
});

test('builds CTYun EOP dates, query strings, and authorization signatures', () => {
  assert.equal(_test.eopDateFromDate(new Date('2024-01-16T08:00:00Z')), '20240116T160000Z');
  assert.equal(_test.queryParamsToString({ b: 'x y', a: '2021-04-04T06:01:46Z' }), 'a=2021-04-04T06%3A01%3A46Z&b=x%20y');
  assert.throws(() => _test.queryParamsToString({ filter: { name: 'asset' } }), /nested object/);
  assert.throws(() => _test.queryParamsToString({ filter: ['ok', { name: 'asset' }] }), /nested object/);

  const signed = _test.signRequest({
    query: { page: 1, page_size: 2 },
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
  assert.match(signed.canonicalRequest, /^ctyun-eop-request-id:27cfe4dc-e640-45f6-92ca-492ca73e8680\neop-date:20240116T160000Z\n\npage=1&page_size=2\n[0-9a-f]{64}$/);
});

test('sends signed GET domain query with query payload', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, {
      statusCode: 100000,
      message: '正确返回',
      returnObj: { total: 1, result: [{ domain: 'www.ctyun.cn', product_code: '011' }] },
    });
  });

  const result = await handlers[`${SERVICE_PACKAGE}/DomainQuery`]({
    payload: {
      fields: {
        page: { numberValue: 1 },
        page_size: { numberValue: 2 },
        product_code: { stringValue: '011' },
      },
    },
  }, buildCtx({ bindings: { timeoutMs: 25 } }));

  const url = new URL(captured.url);
  assert.equal(url.origin, 'https://ddoscloud-global.ctapi.ctyun.cn');
  assert.equal(url.pathname, '/ctapi/v2/domain/query');
  assert.equal(url.searchParams.get('page'), '1');
  assert.equal(url.searchParams.get('page_size'), '2');
  assert.equal(url.searchParams.get('product_code'), '011');
  assert.equal(captured.init.method, 'GET');
  assert.equal(captured.init.body, undefined);
  assert.equal(Object.hasOwn(captured.init, 'timeoutMs'), false);
  assert.equal(typeof captured.init.signal?.aborted, 'boolean');
  assert.equal(captured.init.headers['X-Custom'], 'trace');
  assert.equal(captured.init.headers['Content-Type'], 'application/json');
  assert.equal(captured.init.headers['Eop-date'], '20240116T160000Z');
  assert.match(captured.init.headers['Eop-Authorization'], /^AKEXAMPLE Headers=ctyun-eop-request-id;eop-date Signature=[A-Za-z0-9+/]+=*$/);
  assert.equal(result.response.structValue.fields.returnObj.structValue.fields.total.numberValue, 1);
});

test('sends signed POST DDoS attack trend with JSON body', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return response(200, {
      statusCode: '100000',
      message: 'success',
      returnObj: [{ time: '2024-01-16 16:00:00', attackCount: 2 }],
    });
  });

  await handlers[`${SERVICE_PACKAGE}/GetDdosAttackTrend`]({
    payload: {
      fields: {
        productCode: { stringValue: '011' },
        startTime: { stringValue: '2024-01-01 00:00:00' },
        endTime: { stringValue: '2024-01-02 00:00:00' },
      },
    },
  }, buildCtx());

  const url = new URL(captured.url);
  assert.equal(url.origin, 'https://ddoscloud-global.ctapi.ctyun.cn');
  assert.equal(url.pathname, '/ctapi/v1/ddosAttack/getAttackTrend');
  assert.equal(url.search, '');
  assert.deepEqual(captured.body, {
    productCode: '011',
    startTime: '2024-01-01 00:00:00',
    endTime: '2024-01-02 00:00:00',
  });
  assert.equal(captured.init.method, 'POST');
});

test('InvokeReadOnlyApi supports built-in read-only API names and rejects mutations', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, { statusCode: 100000, message: 'ok', returnObj: { result: [] } });
  });

  const result = await handlers[METHOD_INVOKE_READ_ONLY_API_FULL]({
    api: 'certList',
    payload: { fields: { page: { numberValue: 1 }, per_page: { numberValue: 20 } } },
  }, buildCtx());

  const url = new URL(captured.url);
  assert.equal(url.pathname, '/ctapi/v1/cert/list');
  assert.equal(url.searchParams.get('per_page'), '20');
  assert.equal(result.response.structValue.fields.returnObj.structValue.fields.result.listValue.values.length, 0);

  await expectGrpcError(
    () => handlers[METHOD_INVOKE_READ_ONLY_API_FULL]({ api: 'domainAdd' }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /unsupported/),
  );
});

test('maps CTYun business and transport errors', async () => {
  setFetch(async () => response(200, { statusCode: 800001, error: 'InvalidAccessKey', errorMessage: 'denied' }));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/DomainQuery`]({}, buildCtx()),
    'PERMISSION_DENIED',
    (err) => assert.match(err.message, /InvalidAccessKey/),
  );

  setFetch(async () => response(200, { statusCode: 800002, error: 'CDN_200002', errorMessage: '请求参数校验失败' }));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/DomainQuery`]({}, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /CDN_200002/),
  );

  setFetch(async () => response(503, { statusCode: 500000, message: 'busy' }));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/DomainQuery`]({}, buildCtx()),
    'UNAVAILABLE',
    (err) => assert.match(err.message, /HTTP 503/),
  );

  setFetch(async () => response(200, 'not json'));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/DomainQuery`]({}, buildCtx()),
    'UNKNOWN',
    (err) => assert.match(err.message, /non-JSON/),
  );

  setFetch(async () => {
    const err = new Error('timeout');
    err.name = 'AbortError';
    throw err;
  });
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/DomainQuery`]({}, buildCtx({ limits: { timeoutMs: 25 } })),
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
    () => handlers[`${SERVICE_PACKAGE}/DomainQuery`]({}, buildCtx({ limits: { timeoutMs: 5 } })),
    'DEADLINE_EXCEEDED',
    (err) => assert.match(err.message, /timed out after 5ms/),
  );
});
