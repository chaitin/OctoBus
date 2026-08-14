import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  LOGIN_PATH,
  METHOD_ADD_BLOCK_POLICY_FULL,
  METHOD_ADD_WHITE_POLICY_FULL,
  METHOD_BATCH_ADD_BLOCK_POLICY_FULL,
  METHOD_CONFIG_ALARM_CONFIG_FULL,
  METHOD_CONFIG_DNS_CONFIG_FULL,
  METHOD_CONFIG_FEATURE_UPDATE_CONFIG_FULL,
  METHOD_CONFIG_FEATURE_UPDATE_ONTIME_FULL,
  METHOD_CONFIG_HTTP_PROXY_FULL,
  METHOD_CONFIG_KAFKA_SERVER_FULL,
  METHOD_CONFIG_NTP_CONFIG_FULL,
  METHOD_CONFIG_PASSWORD_POLICY_FULL,
  METHOD_CONFIG_SOFTWARE_UPDATE_CONFIG_FULL,
  METHOD_CONFIG_SOFTWARE_UPDATE_ONTIME_FULL,
  METHOD_CONFIG_SYSLOG_SERVER_FULL,
  METHOD_CONFIG_TIMEOUT_FULL,
  METHOD_DELETE_BLOCK_POLICY_FULL,
  METHOD_DELETE_WHITE_POLICY_FULL,
  METHOD_EXPORT_BACKUP_FULL,
  METHOD_GET_ALARM_CONFIG_FULL,
  METHOD_GET_DNS_CONFIG_FULL,
  METHOD_GET_FEATURE_UPDATE_CONFIG_FULL,
  METHOD_GET_HTTP_PROXY_FULL,
  METHOD_GET_KAFKA_SERVER_FULL,
  METHOD_GET_LICENSE_FULL,
  METHOD_GET_LOGIN_BLOCK_CONFIG_FULL,
  METHOD_GET_MANAGEMENT_ACCESS_CONFIG_FULL,
  METHOD_GET_NTP_CONFIG_FULL,
  METHOD_GET_PASSWORD_POLICY_FULL,
  METHOD_GET_RADIUS_CONFIG_FULL,
  METHOD_GET_SNMP_CONFIG_FULL,
  METHOD_GET_SOFTWARE_UPDATE_CONFIG_FULL,
  METHOD_GET_SOFTWARE_UPDATE_ONTIME_FULL,
  METHOD_GET_SOFTWARE_STATUS_FULL,
  METHOD_GET_SYSLOG_SERVER_FULL,
  METHOD_GET_SYSTEM_RESOURCE_INFO_FULL,
  METHOD_HEALTH_CHECK_FULL,
  METHOD_IMPORT_BACKUP_FULL,
  METHOD_IMPORT_LICENSE_FULL,
  METHOD_LIST_BLOCK_POLICY_FULL,
  METHOD_LIST_WHITE_POLICY_FULL,
  METHOD_LOGIN_FULL,
  METHOD_REQUEST_FULL,
  METHOD_START_FEATURE_UPDATE_FULL,
  METHOD_START_SOFTWARE_UPDATE_FULL,
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

const invoke = (method, request = {}, ctx = {}) => handlers[method]({
  ...ctx,
  request,
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
  const codes = {
    FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
    INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
    PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
    RESOURCE_EXHAUSTED: grpcStatus.RESOURCE_EXHAUSTED,
    UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
    UNKNOWN: grpcStatus.UNKNOWN,
  };
  assert.equal(caught.code, codes[legacyCode]);
  assert.match(caught.message, new RegExp(`^${legacyCode}:`));
  checker(caught);
};

const jsonEndpointCases = [
  [METHOD_GET_LICENSE_FULL, 'GET', '/api/v3/license', {}],
  [METHOD_IMPORT_LICENSE_FULL, 'POST', '/api/v3/license', { json_body: '{"license":"abc"}' }],
  [METHOD_GET_SYSTEM_RESOURCE_INFO_FULL, 'GET', '/api/v3/sys_resource_info', {}],
  [METHOD_CONFIG_FEATURE_UPDATE_ONTIME_FULL, 'POST', '/api/v3/feature_update_ontime', { json_body: '{"enable":1}' }],
  [METHOD_GET_FEATURE_UPDATE_CONFIG_FULL, 'GET', '/api/v3/feature_update_config/ips', { feature_type: 'ips' }],
  [METHOD_CONFIG_FEATURE_UPDATE_CONFIG_FULL, 'POST', '/api/v3/feature_update_config', { json_body: '{"feature_type":"ips"}' }],
  [METHOD_START_FEATURE_UPDATE_FULL, 'POST', '/api/v3/feature_update_now', { json_body: '{"feature_type":"ips"}' }],
  [METHOD_CONFIG_SOFTWARE_UPDATE_ONTIME_FULL, 'POST', '/api/v3/software_update_ontime', { json_body: '{"enable":1}' }],
  [METHOD_GET_SOFTWARE_UPDATE_ONTIME_FULL, 'GET', '/api/v3/software_update_ontime', {}],
  [METHOD_GET_SOFTWARE_UPDATE_CONFIG_FULL, 'GET', '/api/v3/software_update_config', {}],
  [METHOD_CONFIG_SOFTWARE_UPDATE_CONFIG_FULL, 'POST', '/api/v3/software_update_config', { json_body: '{"server":"updates.example"}' }],
  [METHOD_GET_SOFTWARE_STATUS_FULL, 'GET', '/api/v3/software_status', {}],
  [METHOD_START_SOFTWARE_UPDATE_FULL, 'POST', '/api/v3/software_update_now', { json_body: '{"version":"latest"}' }],
  [METHOD_GET_SYSLOG_SERVER_FULL, 'GET', '/api/v3/syslog_server', {}],
  [METHOD_CONFIG_SYSLOG_SERVER_FULL, 'POST', '/api/v3/syslog_server', { json_body: '{"host":"192.0.2.1"}' }],
  [METHOD_GET_KAFKA_SERVER_FULL, 'GET', '/api/v3/kafka_server', {}],
  [METHOD_CONFIG_KAFKA_SERVER_FULL, 'POST', '/api/v3/kafka_server', { json_body: '{"host":"192.0.2.2"}' }],
  [METHOD_GET_NTP_CONFIG_FULL, 'GET', '/api/v3/ntp_config', {}],
  [METHOD_CONFIG_NTP_CONFIG_FULL, 'POST', '/api/v3/ntp_config', { json_body: '{"server":"pool.ntp.org"}' }],
  [METHOD_GET_DNS_CONFIG_FULL, 'GET', '/api/v3/dns_config', {}],
  [METHOD_CONFIG_DNS_CONFIG_FULL, 'POST', '/api/v3/dns_config', { json_body: '{"primary":"8.8.8.8"}' }],
  [METHOD_GET_SNMP_CONFIG_FULL, 'GET', '/api/v3/snmp_config', {}],
  [METHOD_GET_MANAGEMENT_ACCESS_CONFIG_FULL, 'GET', '/api/v3/mgmaccess_config', {}],
  [METHOD_CONFIG_TIMEOUT_FULL, 'POST', '/api/v3/timeout', { json_body: '{"timeout":30}' }],
  [METHOD_GET_PASSWORD_POLICY_FULL, 'GET', '/api/v3/password_policy', {}],
  [METHOD_CONFIG_PASSWORD_POLICY_FULL, 'POST', '/api/v3/password_policy', { json_body: '{"length":12}' }],
  [METHOD_GET_LOGIN_BLOCK_CONFIG_FULL, 'GET', '/api/v3/block_config', {}],
  [METHOD_GET_RADIUS_CONFIG_FULL, 'GET', '/api/v3/radius', {}],
  [METHOD_GET_ALARM_CONFIG_FULL, 'GET', '/api/v3/alarm_config', {}],
  [METHOD_CONFIG_ALARM_CONFIG_FULL, 'POST', '/api/v3/alarm_config', { json_body: '{"enable":1}' }],
  [METHOD_GET_HTTP_PROXY_FULL, 'GET', '/api/v3/http_proxy', {}],
  [METHOD_CONFIG_HTTP_PROXY_FULL, 'POST', '/api/v3/http_proxy', { json_body: '{"host":"proxy.example"}' }],
  [METHOD_SYSTEM_OPERATE_FULL, 'POST', '/api/v3/system_operate', { json_body: '{"operation":2}' }],
  [METHOD_LIST_BLOCK_POLICY_FULL, 'GET', '/api/v3/block_policy', { query: { page_num: '1' } }],
  [METHOD_ADD_BLOCK_POLICY_FULL, 'POST', '/api/v3/block_policy', { json_body: '{"type":2}' }],
  [METHOD_DELETE_BLOCK_POLICY_FULL, 'DELETE', '/api/v3/block_policy', { json_body: '{"id":"block-1"}' }],
  [METHOD_BATCH_ADD_BLOCK_POLICY_FULL, 'POST', '/api/v3/block_policy/batch', { json_body: '[{"type":3}]' }],
  [METHOD_LIST_WHITE_POLICY_FULL, 'GET', '/api/v3/white_policy', {}],
  [METHOD_ADD_WHITE_POLICY_FULL, 'POST', '/api/v3/white_policy', { json_body: '{"type":4}' }],
  [METHOD_DELETE_WHITE_POLICY_FULL, 'DELETE', '/api/v3/white_policy', { json_body: '{"id":"white-1"}' }],
];

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  _test.clearSessionCache?.();
});

test('service exports SDK handlers and rpcdef path handlers', () => {
  assert.equal(typeof service, 'object');
  for (const method of [
    METHOD_HEALTH_CHECK_FULL,
    METHOD_LOGIN_FULL,
    METHOD_REQUEST_FULL,
    METHOD_EXPORT_BACKUP_FULL,
    METHOD_IMPORT_BACKUP_FULL,
    ...jsonEndpointCases.map(([method]) => method),
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

    const login = await invoke(METHOD_LOGIN_FULL, {}, ctx);
    assert.equal(login.authenticated, true);
    assert.match(login.authorization, /^mock-ips-token-/);

    const license = await invoke(METHOD_GET_LICENSE_FULL, { request_id: 'lic-1' }, ctx);
    assert.equal(JSON.parse(license.json_body).data.license_list[0].name, 'feature');
    assert.equal(license.request_id, 'lic-1');

    const importedLicense = await invoke(METHOD_IMPORT_LICENSE_FULL, { json_body: '{"license":"abc"}' }, ctx);
    assert.equal(JSON.parse(importedLicense.json_body).data.imported, 'abc');

    const resource = await invoke(METHOD_GET_SYSTEM_RESOURCE_INFO_FULL, {}, ctx);
    assert.equal(JSON.parse(resource.json_body).data[0].cpu_usage, '10');

    const status = await invoke(METHOD_GET_SOFTWARE_STATUS_FULL, {}, ctx);
    assert.equal(JSON.parse(status.json_body).data.version, 'V6079');

    const operation = await invoke(METHOD_SYSTEM_OPERATE_FULL, { json_body: '{"operation":2}' }, ctx);
    assert.equal(JSON.parse(operation.json_body).data.operation, 2);

    const addBlock = await invoke(METHOD_ADD_BLOCK_POLICY_FULL, { json_body: '{"type":2,"block_content":"evil.example","end_time":60}' }, ctx);
    assert.equal(JSON.parse(addBlock.json_body).data.id, 'block-1_2');
    const batchBlock = await invoke(METHOD_BATCH_ADD_BLOCK_POLICY_FULL, { json_body: '[{"type":3,"block_content":"http://bad","end_time":0}]' }, ctx);
    assert.deepEqual(JSON.parse(batchBlock.json_body).data.ids, ['block-2_3']);
    const listBlock = await invoke(METHOD_LIST_BLOCK_POLICY_FULL, { query: { type: '2', page_num: '1' } }, ctx);
    assert.equal(JSON.parse(listBlock.json_body).data.block_policy.length, 2);

    const addWhite = await invoke(METHOD_ADD_WHITE_POLICY_FULL, { json_body: '{"type":4,"enable":1,"src_ip":"192.0.2.1"}' }, ctx);
    assert.equal(JSON.parse(addWhite.json_body).data.id, 'white-1_4');
    const listWhite = await invoke(METHOD_LIST_WHITE_POLICY_FULL, {}, ctx);
    assert.equal(JSON.parse(listWhite.json_body).data.white_policy.length, 1);

    const generic = await invoke(METHOD_REQUEST_FULL, {
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

    const backup = await invoke(METHOD_EXPORT_BACKUP_FULL, { request_id: 'backup-1' }, ctx);
    assert.equal(backup.status_code, 200);
    assert.equal(backup.json_body, '');
    assert.equal(Buffer.from(backup.raw_body_base64, 'base64').toString('utf8'), 'backup-bytes');
    assert.equal(backup.request_id, 'backup-1');

    const importedBackup = await invoke(METHOD_IMPORT_BACKUP_FULL, {
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

  const result = await invoke(METHOD_REQUEST_FULL, { method: 'GET', path: '/api/v3/license' }, buildCtx());
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

  const result = await invoke(METHOD_REQUEST_FULL, { method: 'GET', path: '/api/v3/license' }, buildCtx({
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
    const first = await invoke(METHOD_GET_LICENSE_FULL, {}, ctx);
    assert.equal(JSON.parse(first.json_body).code, 0);
    mock.expireNextRequest();
    const second = await invoke(METHOD_GET_LICENSE_FULL, {}, ctx);
    assert.equal(JSON.parse(second.json_body).code, 0);
    assert.equal(mock.loginCount, 2);
  } finally {
    await mock.close();
  }
});

test('service SDK HandlerContext reuses token across repeated calls', async () => {
  const mock = createMockServer();
  const host = await mock.start();
  try {
    const ctx = {
      request: { requestId: 'sdk-cache-1' },
      config: { baseUrl: host, username: USERNAME, deviceType: DEVICE_TYPE },
      secret: { password: PASSWORD },
      method: METHOD_GET_LICENSE_FULL,
      serviceId: 'venus-ips-v6079',
      instanceId: 'ips-sdk-cache',
      workdir: '/tmp',
      packageDir: '/tmp',
      getMetadata: () => undefined,
      getMetadataAll: () => [],
    };

    const first = await service.handlers[METHOD_GET_LICENSE_FULL](ctx);
    ctx.request = { requestId: 'sdk-cache-2' };
    const second = await service.handlers[METHOD_GET_LICENSE_FULL](ctx);

    assert.equal(JSON.parse(first.json_body).code, 0);
    assert.equal(JSON.parse(second.json_body).code, 0);
    assert.equal(mock.loginCount, 1);
  } finally {
    await mock.close();
  }
});

test('concurrent requests share one login for the same instance', async () => {
  const mock = createMockServer();
  const host = await mock.start();
  try {
    const ctx = buildCtx({ bindings: { baseUrl: host }, meta: { instance_id: 'ips-concurrent-login' } });

    const results = await Promise.all(Array.from({ length: 5 }, () => invoke(METHOD_GET_LICENSE_FULL, {}, ctx)));

    for (const result of results) assert.equal(JSON.parse(result.json_body).code, 0);
    assert.equal(mock.loginCount, 1);
  } finally {
    await mock.close();
  }
});

test('concurrent expired-token retries share one refresh login', async () => {
  let loginCount = 0;
  let expireToken = false;
  setFetch(async (url, init = {}) => {
    if (String(url).endsWith('/api/v3/login')) {
      loginCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return responseOf(200, JSON.stringify({ code: 0, msg: 'success', data: { authorization: `token-${loginCount}` } }));
    }
    if (expireToken && init.headers.Authorization === 'Bearer token-1') {
      return responseOf(401, JSON.stringify({ code: 401, msg: 'expired' }), { 'content-type': 'application/json' });
    }
    return responseOf(200, JSON.stringify({ code: 0, msg: 'success' }), { 'content-type': 'application/json' });
  });

  const ctx = buildCtx({ meta: { instance_id: 'ips-concurrent-refresh' } });
  await invoke(METHOD_GET_LICENSE_FULL, {}, ctx);
  expireToken = true;

  const results = await Promise.all(Array.from({ length: 3 }, () => invoke(METHOD_GET_LICENSE_FULL, {}, ctx)));

  for (const result of results) assert.equal(JSON.parse(result.json_body).code, 0);
  assert.equal(loginCount, 2);
});

test('login failure errors do not include sensitive upstream fields', async () => {
  setFetch(async () => responseOf(200, JSON.stringify({
    code: 401,
    msg: 'bad credentials',
    password: 'clear-text-password',
    token: 'secret-token',
    internal: { secret: 'internal-secret' },
  })));

  await expectGrpcError(
    () => invoke(METHOD_LOGIN_FULL, {}, buildCtx({ meta: { instance_id: 'ips-login-sanitize' } })),
    'UNAUTHENTICATED',
    (err) => {
      assert.match(err.message, /bad credentials/);
      assert.doesNotMatch(err.message, /clear-text-password/);
      assert.doesNotMatch(err.message, /secret-token/);
      assert.doesNotMatch(err.message, /internal-secret/);
    },
  );
});

test('all named JSON endpoint handlers use the expected REST method and path', async () => {
  const calls = [];
  setFetch(async (url, init = {}) => {
    calls.push({ method: init.method, path: new URL(String(url)).pathname });
    return responseOf(200, JSON.stringify({ code: 0, msg: 'success' }), { 'content-type': 'application/json' });
  });

  for (const [method, expectedMethod, expectedPath, req] of jsonEndpointCases) {
    calls.length = 0;
    const result = await invoke(method, req, buildCtx({
      secret: { token: TOKEN },
      meta: { instance_id: `endpoint-${method.split('/').at(-1)}` },
    }));

    assert.equal(JSON.parse(result.json_body).code, 0);
    assert.deepEqual(calls, [{ method: expectedMethod, path: expectedPath }], method);
  }
});

test('validation and upstream errors map to gRPC errors', async () => {
  await expectGrpcError(() => invoke(METHOD_REQUEST_FULL, { method: 'GET', path: '/api/v3/license' }, buildCtx({ bindings: { baseUrl: 'ips.example.com' } })), 'FAILED_PRECONDITION');
  await expectGrpcError(() => invoke(METHOD_REQUEST_FULL, { method: 'GET', path: '/api/v3/license' }, buildCtx({
    bindings: { username: '', password: '' }, secret: {},
  })), 'FAILED_PRECONDITION');
  await expectGrpcError(() => invoke(METHOD_REQUEST_FULL, { path: '/api/v3/license' }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => invoke(METHOD_REQUEST_FULL, { method: 'TRACE', path: '/api/v3/license' }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => invoke(METHOD_REQUEST_FULL, { method: 'GET', path: '/v1/license' }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => invoke(METHOD_REQUEST_FULL, { method: 'POST', path: '/api/v3/license', json_body: '{' }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => invoke(METHOD_IMPORT_BACKUP_FULL, { file_name: '', file_base64: '' }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => invoke(METHOD_IMPORT_BACKUP_FULL, { file_name: 'backup.tgz', file_base64: '***' }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => invoke(METHOD_IMPORT_BACKUP_FULL, {
    file_name: 'backup.tgz',
    file_base64: Buffer.alloc((16 * 1024 * 1024) + 1).toString('base64'),
  }, buildCtx()), 'RESOURCE_EXHAUSTED');

  setFetch(async () => responseOf(200, JSON.stringify({ code: 401, msg: 'bad login' })));
  await expectGrpcError(() => invoke(METHOD_REQUEST_FULL, { method: 'GET', path: '/api/v3/license' }, buildCtx()), 'UNAUTHENTICATED');

  setFetch(async () => responseOf(403, 'forbidden'));
  await expectGrpcError(() => invoke(METHOD_REQUEST_FULL, { method: 'GET', path: '/api/v3/license' }, buildCtx({ secret: { token: TOKEN } })), 'PERMISSION_DENIED');

  setFetch(async () => responseOf(500, 'broken'));
  await expectGrpcError(() => invoke(METHOD_REQUEST_FULL, { method: 'GET', path: '/api/v3/license' }, buildCtx({ secret: { token: TOKEN } })), 'UNAVAILABLE');

  setFetch(async () => { throw Object.assign(new Error('outer'), { cause: new Error('timeout') }); });
  await expectGrpcError(() => invoke(METHOD_REQUEST_FULL, { method: 'GET', path: '/api/v3/license' }, buildCtx({ secret: { token: TOKEN } })), 'UNAVAILABLE', (err) => assert.match(err.message, /timeout/));
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
  assert.equal(_test.normalizeBaseUrl('https://user:password@ips.example.com'), '');
  assert.equal(_test.normalizeBaseUrl('https://ips.example.com?token=secret'), '');
  assert.equal(_test.normalizeBaseUrl('ftp://ips.example.com'), '');
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
  assert.equal(_test.buildEnv({
    config: { baseUrl: 'https://config.example' },
    secret: { token: TOKEN },
  }).deviceType, 'api');
});

test('HTTP transport enforces manual redirects, timeout, TLS policy, and response limits', async () => {
  const seen = [];
  setFetch(async (_url, init) => {
    seen.push(init);
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      arrayBuffer: async () => Buffer.from('{"ok":true}'),
    };
  });
  const result = await invoke(METHOD_REQUEST_FULL, {
    method: 'GET',
    path: '/api/v3/license',
  }, buildCtx({
    bindings: { skipTlsVerify: true, timeoutMs: 1234 },
    secret: { token: TOKEN },
  }));
  assert.equal(JSON.parse(result.json_body).ok, true);
  assert.equal(seen[0].redirect, 'manual');
  assert.ok(seen[0].signal instanceof AbortSignal);
  assert.ok(seen[0].dispatcher);

  setFetch(async () => responseOf(200, 'too large', { 'content-length': '11' }));
  await expectGrpcError(() => invoke(METHOD_REQUEST_FULL, {
    method: 'GET', path: '/api/v3/license',
  }, buildCtx({ bindings: { maxResponseBytes: 10 }, secret: { token: TOKEN } })), 'RESOURCE_EXHAUSTED');

  setFetch(async () => ({
    ...responseOf(200, ''),
    arrayBuffer: async () => Buffer.from('eleven bytes'),
  }));
  await expectGrpcError(() => invoke(METHOD_REQUEST_FULL, {
    method: 'GET', path: '/api/v3/license',
  }, buildCtx({ bindings: { maxResponseBytes: 10 }, secret: { token: TOKEN } })), 'RESOURCE_EXHAUSTED');
});

test('upstream HTTP errors are mapped without leaking response bodies', async () => {
  setFetch(async () => responseOf(400, 'password=secret-value'));
  await expectGrpcError(() => invoke(METHOD_REQUEST_FULL, {
    method: 'GET', path: '/api/v3/license',
  }, buildCtx({ secret: { token: TOKEN } })), 'FAILED_PRECONDITION', (err) => {
    assert.doesNotMatch(err.message, /secret-value/);
    assert.match(err.message, /HTTP 400/);
  });
});

test('session cache is bounded and evicts least recently used instances', async () => {
  let loginCount = 0;
  setFetch(async (url) => {
    if (String(url).endsWith(LOGIN_PATH)) {
      loginCount += 1;
      return responseOf(200, JSON.stringify({ code: 0, data: { authorization: `token-${loginCount}` } }));
    }
    return responseOf(200, '{}', { 'content-type': 'application/json' });
  });
  for (let index = 0; index < 130; index += 1) {
    await invoke(METHOD_HEALTH_CHECK_FULL, {}, buildCtx({ meta: { instance_id: `cache-${index}` } }));
  }
  assert.equal(_test.sessionCacheSize(), 128);
});

test('backup import retries once after an expired session and sanitizes failures', async () => {
  let loginCount = 0;
  let importCount = 0;
  setFetch(async (url) => {
    if (String(url).endsWith(LOGIN_PATH)) {
      loginCount += 1;
      return responseOf(200, JSON.stringify({ code: 0, data: { authorization: `token-${loginCount}` } }));
    }
    importCount += 1;
    if (importCount === 1) return responseOf(401, 'expired');
    return responseOf(500, 'internal-secret');
  });
  await expectGrpcError(() => invoke(METHOD_IMPORT_BACKUP_FULL, {
    file_name: 'backup.tgz',
    file_base64: Buffer.from('backup').toString('base64'),
  }, buildCtx({ meta: { instance_id: 'backup-retry' } })), 'UNAVAILABLE', (err) => {
    assert.doesNotMatch(err.message, /internal-secret/);
  });
  assert.equal(loginCount, 2);
  assert.equal(importCount, 2);
});
