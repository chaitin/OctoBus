import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_INVOKE_READ_ONLY_ACTION_FULL,
  METHOD_INVOKE_READ_ONLY_ACTION_PATH,
  READ_ONLY_ACTIONS,
  SERVICE_PACKAGE,
  _test,
  handlers,
  rpcdef,
} from '../src/tencent-dasb.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;
const originalNow = Date.now;

const response = (status, body) => ({
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const setFetch = (impl) => {
  globalThis.fetch = impl;
};

const buildCtx = (overrides = {}) => ({
  config: {
    endpoint: 'https://dasb.tencentcloudapi.com',
    region: 'ap-guangzhou',
    ...(overrides.config || {}),
  },
  secret: {
    secretId: 'AKIDEXAMPLE',
    secretKey: 'SECRETEXAMPLE',
    ...(overrides.secret || {}),
  },
  bindings: {
    headers: { 'X-Custom': 'trace' },
    ...(overrides.bindings || {}),
  },
  limits: { timeoutMs: 9000, ...(overrides.limits || {}) },
  meta: { timestamp: 1705392000, ...(overrides.meta || {}) },
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
  Date.now = originalNow;
});

test('service exports handlers and rpcdef paths', () => {
  assert.equal(typeof service, 'object');
  for (const action of READ_ONLY_ACTIONS) {
    assert.equal(typeof handlers[`${SERVICE_PACKAGE}/${action}`], 'function');
    assert.equal(typeof rpcdef()[`/${SERVICE_PACKAGE}/${action}`], 'function');
  }
  assert.equal(typeof handlers[METHOD_INVOKE_READ_ONLY_ACTION_FULL], 'function');
  assert.equal(typeof rpcdef()[METHOD_INVOKE_READ_ONLY_ACTION_PATH], 'function');
});

test('validates Tencent Cloud credentials and endpoint aliases', () => {
  assert.equal(_test.validateBindings({
    baseUrl: 'https://dasb.ap-guangzhou.tencentcloudapi.com',
    secret_id: 'id',
    secret_key: 'key',
  }).host, 'dasb.ap-guangzhou.tencentcloudapi.com');

  assert.throws(
    () => _test.validateBindings({ endpoint: 'ftp://dasb.tencentcloudapi.com', secretId: 'id', secretKey: 'key' }),
    /endpoint/,
  );
  assert.throws(
    () => _test.validateBindings({ endpoint: 'https://dasb.tencentcloudapi.com', secretKey: 'key' }),
    /secretId/,
  );
  assert.throws(
    () => _test.validateBindings({ endpoint: 'https://dasb.tencentcloudapi.com', secretId: 'id' }),
    /secretKey/,
  );
});

test('normalizes protobuf Struct payloads', () => {
  assert.deepEqual(_test.normalizeStruct({
    fields: {
      Limit: { numberValue: 10 },
      Conditions: {
        listValue: {
          values: [
            {
              structValue: {
                fields: {
                  Name: { stringValue: 'UserName' },
                  Values: { listValue: { values: [{ stringValue: 'admin' }] } },
                },
              },
            },
          ],
        },
      },
      Exact: { boolValue: true },
    },
  }), {
    Limit: 10,
    Conditions: [{ Name: 'UserName', Values: ['admin'] }],
    Exact: true,
  });
});

test('signs and sends Tencent Cloud DASB Describe request', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return response(200, {
      Response: {
        TotalCount: 1,
        DeviceSet: [{ Id: 1, Name: 'host-1' }],
        RequestId: 'req-1',
      },
    });
  });

  const result = await handlers[`${SERVICE_PACKAGE}/DescribeDevices`]({
    payload: {
      fields: {
        Limit: { numberValue: 10 },
        Offset: { numberValue: 0 },
      },
    },
  }, buildCtx({ bindings: { timeoutMs: 25 } }));

  assert.equal(captured.url, 'https://dasb.tencentcloudapi.com/');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.timeoutMs, 25);
  assert.deepEqual(captured.body, { Limit: 10, Offset: 0 });
  assert.equal(captured.init.headers['X-Custom'], 'trace');
  assert.equal(captured.init.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(captured.init.headers.Host, 'dasb.tencentcloudapi.com');
  assert.equal(captured.init.headers['X-TC-Action'], 'DescribeDevices');
  assert.equal(captured.init.headers['X-TC-Version'], '2019-10-18');
  assert.equal(captured.init.headers['X-TC-Region'], 'ap-guangzhou');
  assert.equal(captured.init.headers['X-TC-Timestamp'], '1705392000');
  assert.match(
    captured.init.headers.Authorization,
    /^TC3-HMAC-SHA256 Credential=AKIDEXAMPLE\/2024-01-16\/dasb\/tc3_request, SignedHeaders=content-type;host, Signature=[0-9a-f]{64}$/,
  );
  assert.equal(result.response.structValue.fields.TotalCount.numberValue, 1);
  assert.equal(result.response.structValue.fields.DeviceSet.listValue.values[0].structValue.fields.Name.stringValue, 'host-1');
});

test('InvokeReadOnlyAction allows Search actions and rejects mutations', async () => {
  let captured;
  setFetch(async (_url, init) => {
    captured = { headers: init.headers, body: JSON.parse(init.body) };
    return response(200, { Response: { RequestId: 'req-2', Results: [] } });
  });

  const result = await handlers[METHOD_INVOKE_READ_ONLY_ACTION_FULL]({
    action: 'SearchAuditLog',
    payload: { fields: { Limit: { numberValue: 20 } } },
  }, buildCtx());

  assert.equal(captured.headers['X-TC-Action'], 'SearchAuditLog');
  assert.deepEqual(captured.body, { Limit: 20 });
  assert.equal(result.response.structValue.fields.RequestId.stringValue, 'req-2');

  await expectGrpcError(
    () => handlers[METHOD_INVOKE_READ_ONLY_ACTION_FULL]({ action: 'CreateUser' }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /Describe\* and Search\*/),
  );
});

test('maps Tencent Cloud and transport errors', async () => {
  setFetch(async () => response(200, { Response: { Error: { Code: 'AuthFailure.SecretIdNotFound', Message: 'denied' }, RequestId: 'req-3' } }));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/SearchSession`]({}, buildCtx()),
    'PERMISSION_DENIED',
    (err) => assert.match(err.message, /AuthFailure/),
  );

  setFetch(async () => response(503, { Response: { Error: { Code: 'InternalError', Message: 'busy' } } }));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/SearchSession`]({}, buildCtx()),
    'UNAVAILABLE',
    (err) => assert.match(err.message, /HTTP 503/),
  );

  setFetch(async () => response(200, 'not json'));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/SearchSession`]({}, buildCtx()),
    'UNKNOWN',
    (err) => assert.match(err.message, /non-JSON/),
  );
});

test('uses current timestamp when meta timestamp is absent', async () => {
  Date.now = () => 1705392000000;
  let captured;
  setFetch(async (_url, init) => {
    captured = init.headers;
    return response(200, { Response: { RequestId: 'req-4' } });
  });

  await handlers[`${SERVICE_PACKAGE}/SearchCommand`]({}, buildCtx({ meta: { timestamp: undefined } }));

  assert.equal(captured['X-TC-Timestamp'], '1705392000');
});
