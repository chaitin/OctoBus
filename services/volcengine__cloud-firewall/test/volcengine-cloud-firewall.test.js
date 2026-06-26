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
} from '../src/volcengine-cloud-firewall.js';
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
    region: 'cn-beijing',
    ...(overrides.config || {}),
  },
  secret: {
    accessKeyId: 'AKLTEXAMPLE',
    secretAccessKey: 'SECRETEXAMPLE',
    ...(overrides.secret || {}),
  },
  bindings: {
    headers: { 'X-Custom': 'trace' },
    ...(overrides.bindings || {}),
  },
  limits: { timeoutMs: 9000, ...(overrides.limits || {}) },
  meta: { date: new Date('2024-01-16T08:00:00Z'), ...(overrides.meta || {}) },
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
  for (const entry of READ_ONLY_ACTIONS) {
    assert.equal(typeof handlers[`${SERVICE_PACKAGE}/${entry.methodName}`], 'function');
    assert.equal(typeof rpcdef()[`/${SERVICE_PACKAGE}/${entry.methodName}`], 'function');
  }
  assert.equal(typeof handlers[METHOD_INVOKE_READ_ONLY_ACTION_FULL], 'function');
  assert.equal(typeof rpcdef()[METHOD_INVOKE_READ_ONLY_ACTION_PATH], 'function');
});

test('validates required credentials and supported actions', () => {
  assert.equal(_test.validateBindings({
    AccessKeyID: 'id',
    SecretAccessKey: 'key',
    region: 'cn-shanghai',
  }).region, 'cn-shanghai');

  assert.throws(() => _test.validateBindings({ secretAccessKey: 'key' }), /accessKeyId/);
  assert.throws(() => _test.validateBindings({ accessKeyId: 'id' }), /secretAccessKey/);
  assert.equal(_test.validateActionName('DescribeAddressBook'), 'DescribeAddressBook');
  assert.equal(_test.validateActionName('GetPolicyAnalyzeOverview'), 'GetPolicyAnalyzeOverview');
  assert.equal(_test.validateActionName('AssetList'), 'AssetList');
  assert.throws(() => _test.validateActionName('UpdateInstance'), /read-only/);
  assert.throws(() => _test.validateActionSpec({ action: 'DescribeAddressBook', serviceCode: 'ecs' }), /unsupported/);
});

test('escapes Volcengine query params and rejects nested GET query values', () => {
  assert.equal(_test.queryParamsToString({ Special: "!'()*", Text: 'hello world', CN: '中文' }), 'CN=%E4%B8%AD%E6%96%87&Special=%21%27%28%29%2A&Text=hello%20world');
  assert.throws(() => _test.queryParamsToString({ Filter: { Name: 'status' } }), /nested object/);
  assert.throws(() => _test.queryParamsToString({ Filter: ['ok', { Name: 'status' }] }), /nested object/);
});

test('normalizes protobuf Struct payloads', () => {
  assert.deepEqual(_test.normalizeStruct({
    fields: {
      BeginTime: { numberValue: 1712642400 },
      IpList: { listValue: { values: [{ stringValue: '192.0.2.1' }, { nullValue: 'NULL_VALUE' }] } },
      Exact: { boolValue: true },
    },
  }), {
    BeginTime: 1712642400,
    IpList: ['192.0.2.1', null],
    Exact: true,
  });
});

test('signs and sends POST Cloud Firewall address book request with body payload', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return response(200, {
      ResponseMetadata: {
        RequestId: 'req-1',
        Action: 'DescribeAddressBook',
        Version: '2021-09-06',
        Service: 'fw_center',
        Region: 'cn-beijing',
      },
      Result: { Data: [{ GroupName: 'office' }], TotalCount: 1, PageNumber: 1, PageSize: 10 },
    });
  });

  const result = await handlers[`${SERVICE_PACKAGE}/DescribeAddressBook`]({
    payload: { fields: { GroupType: { stringValue: 'ip' }, PageNumber: { numberValue: 1 }, PageSize: { numberValue: 10 } } },
  }, buildCtx({ bindings: { timeoutMs: 25 } }));

  const url = new URL(captured.url);
  assert.equal(url.origin, 'https://fw-center.volcengineapi.com');
  assert.equal(url.searchParams.get('Action'), 'DescribeAddressBook');
  assert.equal(url.searchParams.get('Version'), '2021-09-06');
  assert.deepEqual(captured.body, { GroupType: 'ip', PageNumber: 1, PageSize: 10 });
  assert.equal(captured.init.method, 'POST');
  assert.equal(Object.hasOwn(captured.init, 'timeoutMs'), false);
  assert.equal(typeof captured.init.signal?.aborted, 'boolean');
  assert.equal(captured.init.headers['X-Custom'], 'trace');
  assert.equal(captured.init.headers['Content-Type'], 'application/json');
  assert.equal(captured.init.headers.Host, 'fw-center.volcengineapi.com');
  assert.equal(captured.init.headers['X-Date'], '20240116T080000Z');
  assert.match(captured.init.headers['X-Content-Sha256'], /^[0-9a-f]{64}$/);
  assert.match(
    captured.init.headers.Authorization,
    /^HMAC-SHA256 Credential=AKLTEXAMPLE\/20240116\/cn-beijing\/fw_center\/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=[0-9a-f]{64}$/,
  );
  assert.equal(result.response.structValue.fields.Result.structValue.fields.TotalCount.numberValue, 1);
});

test('supports Cloud Firewall control policy query action', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return response(200, {
      ResponseMetadata: {
        RequestID: 'req-2',
        Action: 'DescribeControlPolicy',
        Version: '2021-09-06',
        Service: 'fw_center',
        Region: 'cn-beijing',
      },
      Result: { Data: [], TotalCount: 0 },
    });
  });

  await handlers[`${SERVICE_PACKAGE}/DescribeControlPolicy`]({
    payload: { fields: { Direction: { stringValue: 'in' }, PageNumber: { numberValue: 1 }, PageSize: { numberValue: 10 } } },
  }, buildCtx());

  const url = new URL(captured.url);
  assert.equal(url.origin, 'https://fw-center.volcengineapi.com');
  assert.equal(url.searchParams.get('Action'), 'DescribeControlPolicy');
  assert.equal(url.searchParams.get('Version'), '2021-09-06');
  assert.deepEqual(captured.body, { Direction: 'in', PageNumber: 1, PageSize: 10 });
  assert.equal(captured.init.method, 'POST');
  assert.match(
    captured.init.headers.Authorization,
    /^HMAC-SHA256 Credential=AKLTEXAMPLE\/20240116\/cn-beijing\/fw_center\/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=[0-9a-f]{64}$/,
  );
});

test('InvokeReadOnlyAction supports read-only custom calls and rejects mutations', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return response(200, { ResponseMetadata: { RequestId: 'req-3' }, Result: { ok: true } });
  });

  const result = await handlers[METHOD_INVOKE_READ_ONLY_ACTION_FULL]({
    action: 'AssetList',
    method: 'POST',
    payload: { fields: { PageNumber: { numberValue: 1 }, PageSize: { numberValue: 10 } } },
  }, buildCtx());

  const url = new URL(captured.url);
  assert.equal(url.origin, 'https://fw-center.volcengineapi.com');
  assert.equal(url.searchParams.get('Action'), 'AssetList');
  assert.equal(url.searchParams.get('Version'), '2021-09-06');
  assert.deepEqual(captured.body, { PageNumber: 1, PageSize: 10 });
  assert.equal(result.response.structValue.fields.Result.structValue.fields.ok.boolValue, true);

  await expectGrpcError(
    () => handlers[METHOD_INVOKE_READ_ONLY_ACTION_FULL]({ action: 'ModifyControlPolicy' }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /read-only/),
  );
});

test('maps Volcengine and transport errors', async () => {
  setFetch(async () => response(200, { ResponseMetadata: { Error: { Code: 'InvalidAccessKey', Message: 'denied' } } }));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/DescribeAddressBook`]({}, buildCtx()),
    'PERMISSION_DENIED',
    (err) => assert.match(err.message, /InvalidAccessKey/),
  );

  setFetch(async () => response(200, { ResponseMetadata: { Error: { Code: 'MissingParameter', Message: 'missing' } } }));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/DescribeAddressBook`]({}, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /MissingParameter/),
  );

  setFetch(async () => response(400, { ResponseMetadata: { Error: { Code: 'Service.NotOpened', Message: 'not opened' } } }));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/DescribeAddressBook`]({}, buildCtx()),
    'PERMISSION_DENIED',
    (err) => assert.match(err.message, /Service\.NotOpened/),
  );

  setFetch(async () => response(503, { ResponseMetadata: { Error: { Code: 'InternalError', Message: 'busy' } } }));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/DescribeAddressBook`]({}, buildCtx()),
    'UNAVAILABLE',
    (err) => assert.match(err.message, /HTTP 503/),
  );

  setFetch(async () => response(200, 'not json'));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/DescribeAddressBook`]({}, buildCtx()),
    'UNKNOWN',
    (err) => assert.match(err.message, /non-JSON/),
  );

  setFetch(async () => {
    const err = new Error('timeout');
    err.name = 'TimeoutError';
    throw err;
  });
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/DescribeAddressBook`]({}, buildCtx({ limits: { timeoutMs: 25 } })),
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
    () => handlers[`${SERVICE_PACKAGE}/DescribeAddressBook`]({}, buildCtx({ limits: { timeoutMs: 5 } })),
    'DEADLINE_EXCEEDED',
    (err) => assert.match(err.message, /timed out after 5ms/),
  );
});

test('handler accepts OctoBus SDK single-argument context', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, { ResponseMetadata: { RequestId: 'req-sdk' }, Result: { Total: 0 } });
  });

  await handlers[`${SERVICE_PACKAGE}/DescribeAddressBook`]({
    request: {
      payload: { fields: { PageNumber: { numberValue: 1 }, PageSize: { numberValue: 5 } } },
    },
    config: { region: 'cn-shanghai' },
    secret: {
      accessKeyId: 'SDKID',
      secretAccessKey: 'SDKKEY',
    },
    limits: { timeoutMs: 10_000 },
    meta: { date: new Date('2024-01-16T08:00:00Z') },
  });

  const url = new URL(captured.url);
  assert.equal(url.searchParams.get('Action'), 'DescribeAddressBook');
  assert.match(captured.init.headers.Authorization, /^HMAC-SHA256 Credential=SDKID\//);
  assert.match(captured.init.headers.Authorization, /\/cn-shanghai\/fw_center\/request,/);
});

test('InvokeReadOnlyAction accepts OctoBus SDK single-argument context', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return response(200, { ResponseMetadata: { RequestId: 'req-sdk-invoke' }, Result: { ok: true } });
  });

  await handlers[METHOD_INVOKE_READ_ONLY_ACTION_FULL]({
    request: {
      action: 'AssetList',
      method: 'POST',
      payload: { fields: { PageNumber: { numberValue: 1 }, PageSize: { numberValue: 10 } } },
    },
    config: { region: 'cn-shanghai' },
    secret: {
      accessKeyId: 'SDKID',
      secretAccessKey: 'SDKKEY',
    },
    limits: { timeoutMs: 10_000 },
    meta: { date: new Date('2024-01-16T08:00:00Z') },
  });

  const url = new URL(captured.url);
  assert.equal(url.searchParams.get('Action'), 'AssetList');
  assert.deepEqual(captured.body, { PageNumber: 1, PageSize: 10 });
  assert.match(captured.init.headers.Authorization, /^HMAC-SHA256 Credential=SDKID\//);
  assert.match(captured.init.headers.Authorization, /\/cn-shanghai\/fw_center\/request,/);
});
