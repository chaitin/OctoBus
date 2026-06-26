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
} from '../src/ctyun-cloud-firewall-c100.js';
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
    regionId: '100054c0416811e9a6690242ac110002',
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

test('validates credentials, region, and read-only API names', () => {
  assert.equal(_test.validateBindings({ ak: 'id', sk: 'key', regionId: 'region-1' }).accessKeyId, 'id');
  assert.equal(_test.validateBindings({ ak: 'id', sk: 'key', region_id: 'region-1' }).regionId, 'region-1');
  assert.throws(() => _test.validateBindings({ sk: 'key', regionId: 'region-1' }), /accessKeyId/);
  assert.throws(() => _test.validateBindings({ ak: 'id', regionId: 'region-1' }), /secretAccessKey/);
  assert.throws(() => _test.validateBindings({ ak: 'id', sk: 'key' }), /regionId/);
  assert.equal(_test.validateApiSpec('acPolicyOverviewC').path, '/vfw/v2_ac_policy_overview');
  assert.equal(_test.validateApiSpec('logQueryDeliverTimeC').httpMethod, 'POST');
  assert.throws(() => _test.validateApiSpec('addSecpolicy'), /unsupported/);
  assert.throws(() => _test.validateApiSpec('switchSystemVrfbindProtectStatus'), /unsupported/);
});

test('normalizes protobuf Struct payloads', () => {
  assert.deepEqual(_test.normalizeStruct({
    fields: {
      page: { numberValue: 1 },
      keyword: { stringValue: 'asset-a' },
      exact: { boolValue: true },
      tags: { listValue: { values: [{ stringValue: 'prod' }] } },
    },
  }), {
    page: 1,
    keyword: 'asset-a',
    exact: true,
    tags: ['prod'],
  });
});

test('builds CTYun EOP dates, query strings, and signatures', () => {
  assert.equal(_test.eopDateFromDate(new Date('2024-01-16T08:00:00Z')), '20240116T160000Z');
  assert.equal(_test.queryParamsToString({ b: 'x y', a: '2021-04-04T06:01:46Z' }), 'a=2021-04-04T06%3A01%3A46Z&b=x%20y');
  assert.throws(() => _test.queryParamsToString({ filter: { name: 'asset' } }), /nested object/);
  assert.throws(() => _test.queryParamsToString({ filter: ['ok', { name: 'asset' }] }), /nested object/);

  const signed = _test.signRequest({
    query: { firewallType: 'NorthSouth', page: 1 },
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
  assert.match(signed.canonicalRequest, /^ctyun-eop-request-id:27cfe4dc-e640-45f6-92ca-492ca73e8680\neop-date:20240116T160000Z\n\nfirewallType=NorthSouth&page=1\n[0-9a-f]{64}$/);
});

test('sends signed GET overview request with CFW headers', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, {
      statusCode: '800',
      error: 'CFW_0000',
      message: '成功!',
      returnObj: { inTotal: 2, outTotal: 3 },
    });
  });

  const result = await handlers[`${SERVICE_PACKAGE}/AcPolicyOverviewC`]({
    payload: {
      fields: {
        firewallId: { stringValue: 'fw-1' },
        firewallType: { stringValue: 'NorthSouth' },
      },
    },
  }, buildCtx({ bindings: { timeoutMs: 25 } }));

  const url = new URL(captured.url);
  assert.equal(url.origin, 'https://ctcfw-east-a.ctapi.ctyun.cn');
  assert.equal(url.pathname, '/vfw/v2_ac_policy_overview');
  assert.equal(url.searchParams.get('firewallId'), 'fw-1');
  assert.equal(url.searchParams.get('firewallType'), 'NorthSouth');
  assert.equal(captured.init.method, 'GET');
  assert.equal(captured.init.body, undefined);
  assert.equal(Object.hasOwn(captured.init, 'timeoutMs'), false);
  assert.equal(typeof captured.init.signal?.aborted, 'boolean');
  assert.equal(captured.init.headers['X-Custom'], 'trace');
  assert.equal(captured.init.headers['Content-Type'], 'application/json');
  assert.equal(captured.init.headers.urlType, 'CTAPI');
  assert.equal(captured.init.headers.regionid, '100054c0416811e9a6690242ac110002');
  assert.equal(captured.init.headers['Eop-date'], '20240116T160000Z');
  assert.match(captured.init.headers['Eop-Authorization'], /^AKEXAMPLE Headers=ctyun-eop-request-id;eop-date Signature=[A-Za-z0-9+/]+=*$/);
  assert.equal(result.response.structValue.fields.returnObj.structValue.fields.inTotal.numberValue, 2);
});

test('sends signed POST log query request with JSON body', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return response(200, {
      statusCode: '800',
      error: 'CFW_0000',
      message: '成功!',
      returnObj: { records: [] },
    });
  });

  await handlers[`${SERVICE_PACKAGE}/LogQueryDeliverTimeC`]({
    payload: {
      fields: {
        firewallId: { stringValue: 'fw-1' },
        logType: { stringValue: 'FLOW' },
      },
    },
  }, buildCtx());

  const url = new URL(captured.url);
  assert.equal(url.origin, 'https://ctcfw-east-a.ctapi.ctyun.cn');
  assert.equal(url.pathname, '/vfw/v2_log_query_deliver_time');
  assert.equal(url.search, '');
  assert.deepEqual(captured.body, { firewallId: 'fw-1', logType: 'FLOW' });
  assert.equal(captured.init.method, 'POST');
});

test('InvokeReadOnlyApi supports built-in read-only API names and rejects mutations', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, { statusCode: '800', error: 'CFW_0000', message: 'ok', returnObj: { result: [] } });
  });

  const result = await handlers[METHOD_INVOKE_READ_ONLY_API_FULL]({
    api: 'alarmQuery',
    payload: { fields: { page: { numberValue: 1 }, pageSize: { numberValue: 20 } } },
  }, buildCtx());

  const url = new URL(captured.url);
  assert.equal(url.pathname, '/vfw/v2_alarm_query');
  assert.equal(url.searchParams.get('pageSize'), '20');
  assert.equal(result.response.structValue.fields.returnObj.structValue.fields.result.listValue.values.length, 0);

  await expectGrpcError(
    () => handlers[METHOD_INVOKE_READ_ONLY_API_FULL]({ api: 'addSecpolicy' }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /unsupported/),
  );
});

test('maps CTYun business and transport errors', async () => {
  setFetch(async () => response(200, { error: 'AuthFailure', statusCode: '401', message: '鉴权错误' }));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/AcPolicyOverviewC`]({}, buildCtx()),
    'PERMISSION_DENIED',
    (err) => assert.match(err.message, /AuthFailure/),
  );

  setFetch(async () => response(200, { error: 'CFW_0001', statusCode: '800', message: '参数错误' }));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/AcPolicyOverviewC`]({}, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /CFW_0001/),
  );

  setFetch(async () => response(200, { error: 'CFW_0002', statusCode: '800', message: '业务错误' }));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/AcPolicyOverviewC`]({}, buildCtx()),
    'FAILED_PRECONDITION',
    (err) => assert.match(err.message, /CFW_0002/),
  );

  setFetch(async () => response(503, { statusCode: 500000, message: 'busy' }));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/AcPolicyOverviewC`]({}, buildCtx()),
    'UNAVAILABLE',
    (err) => assert.match(err.message, /HTTP 503/),
  );

  setFetch(async () => response(200, 'not json'));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/AcPolicyOverviewC`]({}, buildCtx()),
    'UNKNOWN',
    (err) => assert.match(err.message, /non-JSON/),
  );

  setFetch(async () => {
    const err = new Error('timeout');
    err.name = 'AbortError';
    throw err;
  });
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/AcPolicyOverviewC`]({}, buildCtx({ limits: { timeoutMs: 25 } })),
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
    () => handlers[`${SERVICE_PACKAGE}/AcPolicyOverviewC`]({}, buildCtx({ limits: { timeoutMs: 5 } })),
    'DEADLINE_EXCEEDED',
    (err) => assert.match(err.message, /timed out after 5ms/),
  );
});
