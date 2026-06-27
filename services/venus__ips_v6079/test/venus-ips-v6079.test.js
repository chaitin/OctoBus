import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_ADD_BLOCK_POLICY_FULL,
  METHOD_ADD_WHITE_POLICY_FULL,
  METHOD_BATCH_ADD_BLOCK_POLICY_FULL,
  METHOD_EXPORT_BACKUP_FULL,
  METHOD_GET_LICENSE_FULL,
  METHOD_GET_SOFTWARE_STATUS_FULL,
  METHOD_GET_SYSTEM_RESOURCE_INFO_FULL,
  METHOD_HEALTH_CHECK_FULL,
  METHOD_IMPORT_BACKUP_FULL,
  METHOD_IMPORT_LICENSE_FULL,
  METHOD_LIST_BLOCK_POLICY_FULL,
  METHOD_LIST_WHITE_POLICY_FULL,
  METHOD_LOGIN_FULL,
  METHOD_REQUEST_FULL,
  METHOD_SYSTEM_OPERATE_FULL,
  _test,
  handlers,
  rpcdef,
} from '../src/venus-ips-v6079.js';
import { service } from '../src/service.js';
import { DEVICE_TYPE, PASSWORD, PASSWORD_SHA256, TOKEN, USERNAME, createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;

const baseBindings = {
  baseUrl: 'https://ips.example.com',
  username: USERNAME,
  password: PASSWORD,
  deviceType: DEVICE_TYPE,
  headers: { 'x-env': 'test' },
};

const buildCtx = (overrides = {}) => ({
  bindings: { ...baseBindings, ...(overrides.bindings || {}) },
  config: overrides.config || {},
  secret: overrides.secret || {},
  limits: { timeoutMs: 8000, ...(overrides.limits || {}) },
  meta: { instance_id: 'ips-inst', request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const responseOf = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(headers),
  text: async () => String(body),
});

const setFetch = (impl) => {
  globalThis.fetch = impl;
};

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
  const codes = {
    FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
    INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
    PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
    UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
    UNKNOWN: grpcStatus.UNKNOWN,
  };
  assert.equal(caught.code, codes[legacyCode]);
  assert.match(caught.message, new RegExp(`^${legacyCode}:`));
  checker(caught);
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('service exports SDK handlers and rpcdef path handlers', () => {
  assert.equal(typeof service, 'object');
  for (const method of [
    METHOD_HEALTH_CHECK_FULL,
    METHOD_LOGIN_FULL,
    METHOD_REQUEST_FULL,
    METHOD_GET_LICENSE_FULL,
    METHOD_IMPORT_LICENSE_FULL,
    METHOD_GET_SYSTEM_RESOURCE_INFO_FULL,
    METHOD_GET_SOFTWARE_STATUS_FULL,
    METHOD_SYSTEM_OPERATE_FULL,
    METHOD_LIST_BLOCK_POLICY_FULL,
    METHOD_ADD_BLOCK_POLICY_FULL,
    METHOD_BATCH_ADD_BLOCK_POLICY_FULL,
    METHOD_LIST_WHITE_POLICY_FULL,
    METHOD_ADD_WHITE_POLICY_FULL,
    METHOD_EXPORT_BACKUP_FULL,
    METHOD_IMPORT_BACKUP_FULL,
  ]) {
    assert.equal(typeof handlers[method], 'function', `${method} handler missing`);
    assert.equal(typeof service.handlers[method], 'function', `${method} SDK handler missing`);
  }
  const defs = rpcdef(buildCtx());
  assert.equal(typeof defs['/Venus_IPSV6079.IPSV6079Service/Request'], 'function');
  assert.equal(typeof defs['/Venus_IPSV6079.IPSV6079Service/AddBlockPolicy'], 'function');
});

test('mock upstream supports login, named methods, generic requests, binary export, and multipart import', async () => {
  const mock = createMockServer();
  const host = await mock.start();
  try {
    const ctx = buildCtx({ bindings: { baseUrl: host } });

    const login = await handlers[METHOD_LOGIN_FULL]({}, ctx);
    assert.equal(login.authenticated, true);
    assert.match(login.authorization, /^mock-ips-token-/);

    const license = await handlers[METHOD_GET_LICENSE_FULL]({ request_id: 'lic-1' }, ctx);
    assert.equal(JSON.parse(license.json_body).data.license_list[0].name, 'feature');
    assert.equal(license.request_id, 'lic-1');

    const importedLicense = await handlers[METHOD_IMPORT_LICENSE_FULL]({ json_body: '{"license":"abc"}' }, ctx);
    assert.equal(JSON.parse(importedLicense.json_body).data.imported, 'abc');

    const resource = await handlers[METHOD_GET_SYSTEM_RESOURCE_INFO_FULL]({}, ctx);
    assert.equal(JSON.parse(resource.json_body).data[0].cpu_usage, '10');

    const status = await handlers[METHOD_GET_SOFTWARE_STATUS_FULL]({}, ctx);
    assert.equal(JSON.parse(status.json_body).data.version, 'V6079');

    const operation = await handlers[METHOD_SYSTEM_OPERATE_FULL]({ json_body: '{"operation":2}' }, ctx);
    assert.equal(JSON.parse(operation.json_body).data.operation, 2);

    const addBlock = await handlers[METHOD_ADD_BLOCK_POLICY_FULL]({ json_body: '{"type":2,"block_content":"evil.example","end_time":60}' }, ctx);
    assert.equal(JSON.parse(addBlock.json_body).data.id, 'block-1_2');
    const batchBlock = await handlers[METHOD_BATCH_ADD_BLOCK_POLICY_FULL]({ json_body: '[{"type":3,"block_content":"http://bad","end_time":0}]' }, ctx);
    assert.deepEqual(JSON.parse(batchBlock.json_body).data.ids, ['block-2_3']);
    const listBlock = await handlers[METHOD_LIST_BLOCK_POLICY_FULL]({ query: { type: '2', page_num: '1' } }, ctx);
    assert.equal(JSON.parse(listBlock.json_body).data.block_policy.length, 2);

    const addWhite = await handlers[METHOD_ADD_WHITE_POLICY_FULL]({ json_body: '{"type":4,"enable":1,"src_ip":"192.0.2.1"}' }, ctx);
    assert.equal(JSON.parse(addWhite.json_body).data.id, 'white-1_4');
    const listWhite = await handlers[METHOD_LIST_WHITE_POLICY_FULL]({}, ctx);
    assert.equal(JSON.parse(listWhite.json_body).data.white_policy.length, 1);

    const generic = await handlers[METHOD_REQUEST_FULL]({
      method: 'POST',
      path: '/api/v3/echo',
      query: { q: 'ioc' },
      content_type: 'application/json;charset=utf-8',
      json_body: '{"value":7}',
      request_id: 'generic-1',
    }, ctx);
    assert.equal(generic.status_code, 200);
    assert.equal(generic.request_id, 'generic-1');
    assert.deepEqual(JSON.parse(generic.json_body).data, { query: { q: 'ioc' }, body: { value: 7 } });
    assert.equal(mock.requests.find((item) => item.path === '/api/v3/echo').headers['content-type'], 'application/json;charset=utf-8');

    const backup = await handlers[METHOD_EXPORT_BACKUP_FULL]({ request_id: 'backup-1' }, ctx);
    assert.equal(backup.status_code, 200);
    assert.equal(backup.json_body, '');
    assert.equal(Buffer.from(backup.raw_body_base64, 'base64').toString('utf8'), 'backup-bytes');
    assert.equal(backup.request_id, 'backup-1');

    const importedBackup = await handlers[METHOD_IMPORT_BACKUP_FULL]({
      file_name: 'backup.tgz',
      file_base64: Buffer.from('backup-bytes').toString('base64'),
      request_id: 'import-backup-1',
    }, ctx);
    assert.equal(JSON.parse(importedBackup.json_body).data.bodyContainsFileName, true);
    assert.equal(importedBackup.request_id, 'import-backup-1');
  } finally {
    await mock.close();
  }
});

test('login hashes raw password and sends required device type header', async () => {
  const calls = [];
  setFetch(async (url, init = {}) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : null });
    if (String(url).endsWith('/api/v3/login')) {
      assert.deepEqual(calls.at(-1).body, { username: USERNAME, password: PASSWORD_SHA256 });
      return responseOf(200, JSON.stringify({ code: 0, msg: 'success', data: { authorization: TOKEN } }));
    }
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(init.headers['Device-Type'], DEVICE_TYPE);
    return responseOf(200, JSON.stringify({ code: 0, msg: 'success', data: { ok: true } }));
  });

  const result = await handlers[METHOD_REQUEST_FULL]({ method: 'GET', path: '/api/v3/license' }, buildCtx());
  assert.equal(result.status_code, 200);
  assert.equal(calls.length, 2);
});

test('pre-issued token skips login and supports custom Authorization prefix', async () => {
  const calls = [];
  setFetch(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    assert.equal(init.headers.Authorization, `JWT ${TOKEN}`);
    return responseOf(200, JSON.stringify({ code: 0, msg: 'success' }));
  });

  const result = await handlers[METHOD_REQUEST_FULL]({ method: 'GET', path: '/api/v3/license' }, buildCtx({
    bindings: { username: '', password: '', authHeaderPrefix: 'JWT' },
    secret: { token: TOKEN },
  }));

  assert.equal(result.status_code, 200);
  assert.equal(calls.length, 1);
});

test('401 clears cached token, logs in again, and retries once', async () => {
  const mock = createMockServer();
  const host = await mock.start();
  try {
    const ctx = buildCtx({ bindings: { baseUrl: host } });
    const first = await handlers[METHOD_GET_LICENSE_FULL]({}, ctx);
    assert.equal(JSON.parse(first.json_body).code, 0);
    mock.expireNextRequest();
    const second = await handlers[METHOD_GET_LICENSE_FULL]({}, ctx);
    assert.equal(JSON.parse(second.json_body).code, 0);
    assert.equal(mock.loginCount, 2);
  } finally {
    await mock.close();
  }
});

test('validation and upstream errors map to gRPC errors', async () => {
  await expectGrpcError(() => handlers[METHOD_REQUEST_FULL]({ method: 'GET', path: '/api/v3/license' }, buildCtx({ bindings: { baseUrl: 'ips.example.com' } })), 'FAILED_PRECONDITION');
  await expectGrpcError(() => handlers[METHOD_REQUEST_FULL]({ method: 'GET', path: '/api/v3/license' }, buildCtx({ bindings: { deviceType: '' } })), 'FAILED_PRECONDITION');
  await expectGrpcError(() => handlers[METHOD_REQUEST_FULL]({ path: '/api/v3/license' }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => handlers[METHOD_REQUEST_FULL]({ method: 'TRACE', path: '/api/v3/license' }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => handlers[METHOD_REQUEST_FULL]({ method: 'GET', path: '/v1/license' }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => handlers[METHOD_REQUEST_FULL]({ method: 'POST', path: '/api/v3/license', json_body: '{' }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => handlers[METHOD_IMPORT_BACKUP_FULL]({ file_name: '', file_base64: '' }, buildCtx()), 'INVALID_ARGUMENT');

  setFetch(async () => responseOf(200, JSON.stringify({ code: 401, msg: 'bad login' })));
  await expectGrpcError(() => handlers[METHOD_REQUEST_FULL]({ method: 'GET', path: '/api/v3/license' }, buildCtx()), 'UNAUTHENTICATED');

  setFetch(async () => responseOf(403, 'forbidden'));
  await expectGrpcError(() => handlers[METHOD_REQUEST_FULL]({ method: 'GET', path: '/api/v3/license' }, buildCtx({ secret: { token: TOKEN } })), 'PERMISSION_DENIED');

  setFetch(async () => responseOf(500, 'broken'));
  await expectGrpcError(() => handlers[METHOD_REQUEST_FULL]({ method: 'GET', path: '/api/v3/license' }, buildCtx({ secret: { token: TOKEN } })), 'UNAVAILABLE');

  setFetch(async () => { throw Object.assign(new Error('outer'), { cause: new Error('timeout') }); });
  await expectGrpcError(() => handlers[METHOD_REQUEST_FULL]({ method: 'GET', path: '/api/v3/license' }, buildCtx({ secret: { token: TOKEN } })), 'UNAVAILABLE', (err) => assert.match(err.message, /timeout/));
});

test('service definition handlers accept SDK HandlerContext', async () => {
  const calls = [];
  setFetch(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
    return responseOf(200, JSON.stringify({ code: 0, msg: 'success' }));
  });

  const result = await service.handlers[METHOD_REQUEST_FULL]({
    request: { method: 'GET', path: '/api/v3/license', requestId: 'sdk-context' },
    config: { baseUrl: 'https://ips.example.com', deviceType: DEVICE_TYPE },
    secret: { token: TOKEN },
    method: METHOD_REQUEST_FULL,
    serviceId: 'venus-ips-v6079',
    instanceId: 'ips-test',
    workdir: '/tmp',
    packageDir: '/tmp',
    getMetadata: () => undefined,
    getMetadataAll: () => [],
  });

  assert.equal(result.status_code, 200);
  assert.equal(result.request_id, 'sdk-context');
  assert.equal(calls.length, 1);
});

test('helper functions cover request parsing and configuration behavior', () => {
  assert.equal(_test.sha256Hex(PASSWORD), PASSWORD_SHA256);
  assert.equal(_test.normalizeBaseUrl(' https://ips.example.com/ '), 'https://ips.example.com');
  assert.equal(_test.normalizeBaseUrl('ips.example.com'), '');
  assert.deepEqual(_test.parseJsonBody(''), {});
  assert.deepEqual(_test.parseJsonBody('{"a":1}'), { a: 1 });
  assert.equal(_test.requestIdOf({ requestId: 123 }), '123');
  assert.equal(_test.mapHttpStatus(401), 'UNAUTHENTICATED');
  assert.equal(_test.mapHttpStatus(403), 'PERMISSION_DENIED');
  assert.equal(_test.mapHttpStatus(404), 'FAILED_PRECONDITION');
  assert.equal(_test.mapHttpStatus(500), 'UNAVAILABLE');
  assert.equal(_test.buildEnv({
    config: { baseUrl: 'https://config.example', username: USERNAME, deviceType: DEVICE_TYPE },
    secret: { passwordSha256: PASSWORD_SHA256 },
    bindings: { username: 'binding-user' },
  }).passwordSha256, PASSWORD_SHA256);
});
