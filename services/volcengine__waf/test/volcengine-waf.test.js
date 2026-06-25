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
} from '../src/volcengine-waf.js';
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
  assert.equal(_test.validateActionName('ListDomain'), 'ListDomain');
  assert.equal(_test.validateActionName('QueryProtectionOverviewLb'), 'QueryProtectionOverviewLb');
  assert.equal(_test.validateActionName('SearchLogs'), 'SearchLogs');
  assert.throws(() => _test.validateActionName('UpdateInstance'), /read-only/);
  assert.throws(() => _test.validateActionSpec({ action: 'ListDomain', serviceCode: 'ecs' }), /unsupported/);
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

test('signs and sends POST WAF list-domain request with body payload', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return response(200, {
      ResponseMetadata: {
        RequestId: 'req-1',
        Action: 'ListDomain',
        Version: '2023-12-25',
        Service: 'waf',
        Region: 'cn-beijing',
      },
      Result: { List: [{ Host: 'example.com' }], Total: 1 },
    });
  });

  const result = await handlers[`${SERVICE_PACKAGE}/ListDomain`]({
    payload: { fields: { Page: { numberValue: 1 }, PageSize: { numberValue: 10 } } },
  }, buildCtx({ bindings: { timeoutMs: 25 } }));

  const url = new URL(captured.url);
  assert.equal(url.origin, 'https://waf.volcengineapi.com');
  assert.equal(url.searchParams.get('Action'), 'ListDomain');
  assert.equal(url.searchParams.get('Version'), '2023-12-25');
  assert.deepEqual(captured.body, { Page: 1, PageSize: 10 });
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.timeoutMs, 25);
  assert.equal(captured.init.headers['X-Custom'], 'trace');
  assert.equal(captured.init.headers['Content-Type'], 'application/json');
  assert.equal(captured.init.headers.Host, 'waf.volcengineapi.com');
  assert.equal(captured.init.headers['X-Date'], '20240116T080000Z');
  assert.match(captured.init.headers['X-Content-Sha256'], /^[0-9a-f]{64}$/);
  assert.match(
    captured.init.headers.Authorization,
    /^HMAC-SHA256 Credential=AKLTEXAMPLE\/20240116\/cn-beijing\/waf\/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=[0-9a-f]{64}$/,
  );
  assert.equal(result.response.structValue.fields.Result.structValue.fields.Total.numberValue, 1);
});

test('supports WAF overview query action', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return response(200, {
      ResponseMetadata: {
        RequestID: 'req-2',
        Action: 'QueryProtectionOverviewLb',
        Version: '2023-12-25',
        Service: 'waf',
        Region: 'cn-beijing',
      },
      Result: { AttackCount: 8 },
    });
  });

  await handlers[`${SERVICE_PACKAGE}/QueryProtectionOverviewLb`]({
    payload: { fields: { Host: { stringValue: 'example.com' }, StartTime: { numberValue: 1712642400 }, EndTime: { numberValue: 1712646000 } } },
  }, buildCtx());

  const url = new URL(captured.url);
  assert.equal(url.origin, 'https://waf.volcengineapi.com');
  assert.equal(url.searchParams.get('Action'), 'QueryProtectionOverviewLb');
  assert.equal(url.searchParams.get('Version'), '2023-12-25');
  assert.deepEqual(captured.body, { Host: 'example.com', StartTime: 1712642400, EndTime: 1712646000 });
  assert.equal(captured.init.method, 'POST');
  assert.match(
    captured.init.headers.Authorization,
    /^HMAC-SHA256 Credential=AKLTEXAMPLE\/20240116\/cn-beijing\/waf\/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=[0-9a-f]{64}$/,
  );
});

test('InvokeReadOnlyAction supports read-only custom calls and rejects mutations', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return response(200, { ResponseMetadata: { RequestId: 'req-3' }, Result: { ok: true } });
  });

  const result = await handlers[METHOD_INVOKE_READ_ONLY_ACTION_FULL]({
    action: 'SearchLogs',
    method: 'POST',
    payload: { fields: { StartTime: { numberValue: 1712642400 }, EndTime: { numberValue: 1712646000 } } },
  }, buildCtx());

  const url = new URL(captured.url);
  assert.equal(url.origin, 'https://waf.volcengineapi.com');
  assert.equal(url.searchParams.get('Action'), 'SearchLogs');
  assert.deepEqual(captured.body, { StartTime: 1712642400, EndTime: 1712646000 });
  assert.equal(result.response.structValue.fields.Result.structValue.fields.ok.boolValue, true);

  await expectGrpcError(
    () => handlers[METHOD_INVOKE_READ_ONLY_ACTION_FULL]({ action: 'UpdateDomain' }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /read-only/),
  );
});

test('maps Volcengine and transport errors', async () => {
  setFetch(async () => response(200, { ResponseMetadata: { Error: { Code: 'InvalidAccessKey', Message: 'denied' } } }));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/ListDomain`]({}, buildCtx()),
    'PERMISSION_DENIED',
    (err) => assert.match(err.message, /InvalidAccessKey/),
  );

  setFetch(async () => response(200, { ResponseMetadata: { Error: { Code: 'MissingParameter', Message: 'missing' } } }));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/ListDomain`]({}, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /MissingParameter/),
  );

  setFetch(async () => response(503, { ResponseMetadata: { Error: { Code: 'InternalError', Message: 'busy' } } }));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/ListDomain`]({}, buildCtx()),
    'UNAVAILABLE',
    (err) => assert.match(err.message, /HTTP 503/),
  );

  setFetch(async () => response(200, 'not json'));
  await expectGrpcError(
    () => handlers[`${SERVICE_PACKAGE}/ListDomain`]({}, buildCtx()),
    'UNKNOWN',
    (err) => assert.match(err.message, /non-JSON/),
  );
});
