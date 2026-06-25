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

test('validates credentials and read-only API names', () => {
  assert.equal(_test.validateBindings({ ak: 'id', sk: 'key' }).accessKeyId, 'id');
  assert.throws(() => _test.validateBindings({ sk: 'key' }), /accessKeyId/);
  assert.throws(() => _test.validateBindings({ ak: 'id' }), /secretAccessKey/);
  assert.equal(_test.validateApiSpec('untreatedRisk').path, '/v1/index/untreated');
  assert.equal(_test.validateApiSpec('hostList').httpMethod, 'POST');
  assert.throws(() => _test.validateApiSpec('openStatus'), /unsupported/);
  assert.throws(() => _test.validateApiSpec('v1hostdelete'), /unsupported/);
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

test('sends signed GET untreated risk request', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, {
      error: 'CTCSSCN_000000',
      statusCode: '200',
      message: 'success',
      returnObj: { vulRiskNum: 1 },
    });
  });

  const result = await handlers[`${SERVICE_PACKAGE}/UntreatedRisk`]({}, buildCtx({ bindings: { timeoutMs: 25 } }));

  const url = new URL(captured.url);
  assert.equal(url.origin, 'https://ctcsscn-global.ctapi.ctyun.cn');
  assert.equal(url.pathname, '/v1/index/untreated');
  assert.equal(captured.init.method, 'GET');
  assert.equal(captured.init.body, undefined);
  assert.equal(captured.init.timeoutMs, 25);
  assert.equal(captured.init.headers['X-Custom'], 'trace');
  assert.equal(captured.init.headers['Content-Type'], 'application/json');
  assert.equal(captured.init.headers['Eop-date'], '20240116T160000Z');
  assert.match(captured.init.headers['Eop-Authorization'], /^AKEXAMPLE Headers=ctyun-eop-request-id;eop-date Signature=[A-Za-z0-9+/]+=*$/);
  assert.equal(result.response.structValue.fields.returnObj.structValue.fields.vulRiskNum.numberValue, 1);
});

test('sends signed POST host list with JSON body', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return response(200, {
      error: 'CTCSSCN_000000',
      statusCode: '200',
      message: 'success',
      returnObj: { list: [{ agentGuid: 'agent-1' }] },
    });
  });

  await handlers[`${SERVICE_PACKAGE}/HostList`]({
    payload: {
      fields: {
        pageNo: { numberValue: 1 },
        pageSize: { numberValue: 20 },
      },
    },
  }, buildCtx());

  const url = new URL(captured.url);
  assert.equal(url.origin, 'https://ctcsscn-global.ctapi.ctyun.cn');
  assert.equal(url.pathname, '/v1/host/all');
  assert.equal(url.search, '');
  assert.deepEqual(captured.body, { pageNo: 1, pageSize: 20 });
  assert.equal(captured.init.method, 'POST');
});

test('fills documented star path parameters and removes them from request params', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, { error: 'CTCSSCN_000000', statusCode: '200', returnObj: { agentGuid: 'agent-1' } });
  });

  await handlers[`${SERVICE_PACKAGE}/GetHostsDetail`]({
    payload: { fields: { pathParams: { listValue: { values: [{ stringValue: 'agent-1' }] } }, detail: { stringValue: 'basic' } } },
  }, buildCtx());

  const url = new URL(captured.url);
  assert.equal(url.pathname, '/v1/host/detail/agent-1');
  assert.equal(url.searchParams.get('detail'), 'basic');
  assert.equal(url.searchParams.has('pathParams'), false);

  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/GetHostsDetail`]({}, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /pathParams/),
  );
});

test('InvokeReadOnlyApi supports built-in read-only API names and rejects mutations', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, { error: 'CTCSSCN_000000', statusCode: '200', message: 'ok', returnObj: { result: [] } });
  });

  const result = await handlers[METHOD_INVOKE_READ_ONLY_API_FULL]({
    api: 'getWeakScanConf',
    payload: { fields: { hostId: { stringValue: 'host-1' } } },
  }, buildCtx());

  const url = new URL(captured.url);
  assert.equal(url.pathname, '/v1/weakpw/conf');
  assert.equal(url.searchParams.get('hostId'), 'host-1');
  assert.equal(result.response.structValue.fields.returnObj.structValue.fields.result.listValue.values.length, 0);

  await expectGrpcError(
    () => handlers[METHOD_INVOKE_READ_ONLY_API_FULL]({ api: 'openStatus' }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /unsupported/),
  );
});

test('maps CTYun business and transport errors', async () => {
  setFetch(async () => response(200, { error: 'CTCSSCN_000004', statusCode: '403', message: '鉴权错误' }));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/UntreatedRisk`]({}, buildCtx()),
    'PERMISSION_DENIED',
    (err) => assert.match(err.message, /CTCSSCN_000004/),
  );

  setFetch(async () => response(200, { error: 'CTCSSCN_000005', statusCode: '200', message: '用户没有付费版配额' }));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/UntreatedRisk`]({}, buildCtx()),
    'FAILED_PRECONDITION',
    (err) => assert.match(err.message, /CTCSSCN_000005/),
  );

  setFetch(async () => response(503, { statusCode: 500000, message: 'busy' }));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/UntreatedRisk`]({}, buildCtx()),
    'UNAVAILABLE',
    (err) => assert.match(err.message, /HTTP 503/),
  );

  setFetch(async () => response(200, 'not json'));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/UntreatedRisk`]({}, buildCtx()),
    'UNKNOWN',
    (err) => assert.match(err.message, /non-JSON/),
  );
});
