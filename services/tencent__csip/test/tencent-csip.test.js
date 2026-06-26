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
} from '../src/tencent-csip.js';
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
    endpoint: 'https://csip.tencentcloudapi.com',
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
  DEADLINE_EXCEEDED: grpcStatus.DEADLINE_EXCEEDED,
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

test('validates required Tencent Cloud credentials and endpoint aliases', () => {
  assert.equal(_test.validateBindings({
    baseUrl: 'https://csip.ap-guangzhou.tencentcloudapi.com',
    secret_id: 'id',
    secret_key: 'key',
    version: '2022-11-21',
  }).host, 'csip.ap-guangzhou.tencentcloudapi.com');

  assert.throws(
    () => _test.validateBindings({ endpoint: 'ftp://csip.tencentcloudapi.com', secretId: 'id', secretKey: 'key' }),
    /endpoint/,
  );
  assert.throws(
    () => _test.validateBindings({ endpoint: 'https://csip.tencentcloudapi.com', secretKey: 'key' }),
    /secretId/,
  );
  assert.throws(
    () => _test.validateBindings({ endpoint: 'https://csip.tencentcloudapi.com', secretId: 'id' }),
    /secretKey/,
  );
});

test('normalizes protobuf Struct payloads', () => {
  assert.deepEqual(_test.normalizeStruct({
    fields: {
      Filter: {
        structValue: {
          fields: {
            Limit: { numberValue: 10 },
            Values: { listValue: { values: [{ stringValue: 'high' }, { nullValue: 'NULL_VALUE' }] } },
          },
        },
      },
      Flag: { boolValue: true },
    },
  }), {
    Filter: { Limit: 10, Values: ['high', null] },
    Flag: true,
  });
});

test('signs and sends Tencent Cloud CSIP request', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return response(200, {
      Response: {
        TotalCount: 1,
        Data: [{ AssetId: 'ins-1' }],
        RequestId: 'req-1',
      },
    });
  });

  const result = await handlers[`${SERVICE_PACKAGE}/DescribeCVMAssets`]({
    payload: {
      fields: {
        Filter: {
          structValue: {
            fields: {
              Limit: { numberValue: 10 },
              Offset: { numberValue: 0 },
            },
          },
        },
      },
    },
  }, buildCtx({ bindings: { timeoutMs: 25 } }));

  assert.equal(captured.url, 'https://csip.tencentcloudapi.com/');
  assert.equal(captured.init.method, 'POST');
  assert.equal(Object.hasOwn(captured.init, 'timeoutMs'), false);
  assert.equal(typeof captured.init.signal?.aborted, 'boolean');
  assert.deepEqual(captured.body, { Filter: { Limit: 10, Offset: 0 } });
  assert.equal(captured.init.headers['X-Custom'], 'trace');
  assert.equal(captured.init.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(captured.init.headers.Host, 'csip.tencentcloudapi.com');
  assert.equal(captured.init.headers['X-TC-Action'], 'DescribeCVMAssets');
  assert.equal(captured.init.headers['X-TC-Version'], '2022-11-21');
  assert.equal(captured.init.headers['X-TC-Region'], 'ap-guangzhou');
  assert.equal(captured.init.headers['X-TC-Timestamp'], '1705392000');
  assert.match(
    captured.init.headers.Authorization,
    /^TC3-HMAC-SHA256 Credential=AKIDEXAMPLE\/2024-01-16\/csip\/tc3_request, SignedHeaders=content-type;host, Signature=[0-9a-f]{64}$/,
  );
  assert.equal(result.response.structValue.fields.TotalCount.numberValue, 1);
  assert.equal(result.response.structValue.fields.Data.listValue.values[0].structValue.fields.AssetId.stringValue, 'ins-1');
});

test('InvokeReadOnlyAction allows Describe actions and rejects mutations', async () => {
  let captured;
  setFetch(async (_url, init) => {
    captured = { headers: init.headers, body: JSON.parse(init.body) };
    return response(200, { Response: { RequestId: 'req-2', Items: [] } });
  });

  const result = await handlers[METHOD_INVOKE_READ_ONLY_ACTION_FULL]({
    action: 'DescribeSkillScanResult',
    payload: { fields: { TaskId: { stringValue: 'task-1' } } },
  }, buildCtx());

  assert.equal(captured.headers['X-TC-Action'], 'DescribeSkillScanResult');
  assert.deepEqual(captured.body, { TaskId: 'task-1' });
  assert.equal(result.response.structValue.fields.RequestId.stringValue, 'req-2');

  await expectGrpcError(
    () => handlers[METHOD_INVOKE_READ_ONLY_ACTION_FULL]({ action: 'CreateSkillScan' }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /Describe/),
  );
});

test('maps Tencent Cloud and transport errors', async () => {
  setFetch(async () => response(200, { Response: { Error: { Code: 'UnauthorizedOperation', Message: 'denied' }, RequestId: 'req-3' } }));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/DescribeAlertList`]({}, buildCtx()),
    'PERMISSION_DENIED',
    (err) => assert.match(err.message, /UnauthorizedOperation/),
  );

  setFetch(async () => response(503, { Response: { Error: { Code: 'InternalError', Message: 'busy' } } }));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/DescribeAlertList`]({}, buildCtx()),
    'UNAVAILABLE',
    (err) => assert.match(err.message, /HTTP 503/),
  );

  setFetch(async () => response(200, 'not json'));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/DescribeAlertList`]({}, buildCtx()),
    'UNKNOWN',
    (err) => assert.match(err.message, /non-JSON/),
  );

  setFetch(async () => {
    const err = new Error('timeout');
    err.name = 'AbortError';
    throw err;
  });
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/DescribeAlertList`]({}, buildCtx({ limits: { timeoutMs: 25 } })),
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
    () => handlers[`${SERVICE_PACKAGE}/DescribeAlertList`]({}, buildCtx({ limits: { timeoutMs: 5 } })),
    'DEADLINE_EXCEEDED',
    (err) => assert.match(err.message, /timed out after 5ms/),
  );
});

test('uses current timestamp when meta timestamp is absent', async () => {
  Date.now = () => 1705392000000;
  let captured;
  setFetch(async (_url, init) => {
    captured = init.headers;
    return response(200, { Response: { RequestId: 'req-4' } });
  });

  await handlers[`${SERVICE_PACKAGE}/DescribePublicIpAssets`]({}, buildCtx({ meta: { timestamp: undefined } }));

  assert.equal(captured['X-TC-Timestamp'], '1705392000');
});

test('handler accepts OctoBus SDK single-argument context', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return response(200, { Response: { RequestId: 'req-sdk', TotalCount: 0, Data: [] } });
  });

  await handlers[`${SERVICE_PACKAGE}/DescribeCVMAssets`]({
    request: {
      payload: { fields: { Filter: { structValue: { fields: { Limit: { numberValue: 5 } } } } } },
    },
    config: {
      endpoint: 'https://csip.tencentcloudapi.com',
      region: 'ap-shanghai',
    },
    secret: {
      secretId: 'SDKID',
      secretKey: 'SDKKEY',
    },
    limits: { timeoutMs: 10_000 },
    meta: { timestamp: 1705392000 },
  });

  assert.equal(captured.url, 'https://csip.tencentcloudapi.com/');
  assert.equal(captured.init.headers['X-TC-Region'], 'ap-shanghai');
  assert.match(captured.init.headers.Authorization, /^TC3-HMAC-SHA256 Credential=SDKID\//);
  assert.deepEqual(captured.body, { Filter: { Limit: 5 } });
});
