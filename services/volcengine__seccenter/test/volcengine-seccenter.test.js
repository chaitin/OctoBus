import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  READ_ONLY_ACTIONS,
  SERVICE_PACKAGE,
  _test,
  handlers,
  rpcdef,
} from '../src/volcengine-seccenter.js';
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
});

test('validates required credentials and supported actions', () => {
  assert.equal(_test.validateBindings({
    AccessKeyID: 'id',
    SecretAccessKey: 'key',
    region: 'cn-shanghai',
  }).region, 'cn-shanghai');

  assert.throws(() => _test.validateBindings({ secretAccessKey: 'key' }), /accessKeyId/);
  assert.throws(() => _test.validateBindings({ accessKeyId: 'id' }), /secretAccessKey/);
  assert.equal(_test.validateActionName('ListAssetGroups'), 'ListAssetGroups');
  assert.throws(() => _test.validateActionName('UpdateInstance'), /read-only/);
  assert.throws(() => _test.validateActionSpec({ action: 'ListAssetGroups', serviceCode: 'ecs' }), /unsupported/);
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

test('signs and sends POST Cloud Security Center asset groups request with body payload', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return response(200, {
      ResponseMetadata: {
        RequestId: 'req-1',
        Action: 'ListAssetGroups',
        Version: '2024-05-08',
        Service: 'seccenter',
        Region: 'cn-beijing',
      },
      Result: { Data: [{ GroupName: 'default' }], TotalCount: 1, PageNumber: 1, PageSize: 10 },
    });
  });

  const result = await handlers[`${SERVICE_PACKAGE}/ListAssetGroups`]({
    request: { payload: { fields: { Page: { numberValue: 1 }, PageSize: { numberValue: 5 } } } },
    config: { region: 'cn-shanghai' },
    secret: {
      accessKeyId: 'SDKID',
      secretAccessKey: 'SDKKEY',
    },
    limits: { timeoutMs: 10_000 },
    meta: { date: new Date('2024-01-16T08:00:00Z') },
  });

  const url = new URL(captured.url);
  assert.equal(url.searchParams.get('Action'), 'ListAssetGroups');
  assert.match(captured.init.headers.Authorization, /^HMAC-SHA256 Credential=SDKID\//);
  assert.match(captured.init.headers.Authorization, /\/cn-shanghai\/seccenter\/request,/);
});
