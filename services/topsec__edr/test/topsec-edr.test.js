import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import { handlers, RPC } from '../src/topsec-edr.js';
import { service } from '../src/service.js';

const client = {
  client_id: 'client-1', hostname: 'host-1', mac: '00:11:22:33:44:55', client_ip: '10.0.0.1',
  os_name: 'Windows', os_version: '11', os_arch: 'x64', client_version: '1.2.3', virus_db_version: 123,
  group_name: 'default', group_id: 'group-1', person: 'owner', terminal_type: 'desktop', location: 'office',
  login_time: 10, heartbeat_time: 11, status: 1, os_type: 'windows', tenancy_id: 'tenant',
  upgrade_dbver: 124, next_heart_time: 12, off_line: 0,
};

const dashboard = {
  scan: { threats_num: 1, terminal_num: 2 }, hi_leak: { threats_num: 3, terminal_num: 4 },
  week_pwd: { threats_num: 5, terminal_num: 6 }, intrusion: { threats_num: 7, terminal_num: 8 },
  aggregate_virus_value: 9, aggregate_ransom_value: 10, file_prot: 11, exec_prot: 12, reg_prot: 13,
  proc_prot: 14, risk_blocked: 15, virus_immune: 16, udev_illegal: 17, soft_illegal: 18, inner_illegal: 19,
  view: { terminal_all: 20, terminal_online: 18, terminal_banned: 1, total_use: 30, windows: 10, server: 4, linux: 5, domestic: 1 },
  server: { host_name: 'edr', server_time: 'now' }, license: { user: 'company', type: 'formal', license_platform: 'all' },
  disk_usage: 21, memory_usage: 22, cpu_usage: 23, network_tx: 24, network_rx: 25, server_time: 'now',
};

let server;
let baseUrl;
let calls;
let customResponse;

test.before(async () => {
  server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    calls.push({ method: request.method, url: new URL(request.url, baseUrl), headers: request.headers, body });
    if (customResponse) return customResponse(request, response);
    response.setHeader('content-type', 'application/json');
    if (request.url.startsWith('/auth/token')) return response.end(JSON.stringify({ token: 'token-value' }));
    if (request.url.startsWith('/api/v1/getCustomList')) {
      return response.end(JSON.stringify({ data: body.includes('client_id') ? client : { list: [client], total: 1 } }));
    }
    return response.end(JSON.stringify({ data: dashboard }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => new Promise((resolve) => server.close(resolve)));
test.beforeEach(() => { calls = []; customResponse = undefined; });

const context = (method, request = {}, overrides = {}) => ({
  request: { host: baseUrl, ...request }, config: { timeoutMs: 1000, ...(overrides.config ?? {}) },
  secret: overrides.secret ?? {}, limits: overrides.limits ?? {}, meta: { instance_id: 'instance', request_id: 'request' },
});

const invoke = (method, request, overrides) => handlers[method](context(method, request, overrides));

const expectError = async (promise, code, pattern) => {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof GrpcError);
    assert.equal(error.code, code);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
};

test('service exports exactly every proto RPC handler', () => {
  assert.ok(service);
  assert.deepEqual(Object.keys(handlers).sort(), Object.values(RPC).sort());
});

test('Login hashes and encrypts credentials without sending plaintext', async () => {
  const result = await invoke(RPC.login, { username: 'admin', password: 'secret' });
  assert.equal(result.session.token, 'token-value');
  assert.equal(result.status_code, 200);
  assert.doesNotMatch(calls[0].body, /admin|secret/);
  assert.ok(JSON.parse(calls[0].body).encryptStr);
  assert.equal(calls[0].headers['x-request-id'], 'request');
});

test('Login accepts config endpoint and secret credentials', async () => {
  const result = await handlers[RPC.login]({ request: { host: '' }, config: { host: '', endpoint: baseUrl }, secret: { username: 'admin', password: 'secret' } });
  assert.equal(result.session.token, 'token-value');
  const hostResult = await handlers[RPC.login]({ request: { host: '' }, config: { host: baseUrl }, secret: { username: 'admin', password: 'secret' } });
  assert.equal(hostResult.session.token, 'token-value');
  const aliasResult = await handlers[RPC.login]({ request: {}, config: { restBaseUrl: baseUrl }, secret: { username: 'admin', password: 'secret' } });
  assert.equal(aliasResult.session.token, 'token-value');
});

test('ListClients sends pagination and maps every client field', async () => {
  const result = await invoke(RPC.listClients, { session: { token: 'token' }, page: { value: 2 }, page_size: { value: 999 }, first_load: false });
  assert.deepEqual(result.clients[0], client);
  assert.equal(result.total_count, 1);
  assert.equal(calls[0].headers.authorization, 'Bearer token');
  assert.match(calls[0].url.search, /nonce=\d{8}/);
  assert.match(calls[0].url.search, /sign=[a-f0-9]{32}/);
  assert.doesNotMatch(calls[0].url.search, /token/);
  assert.match(calls[0].body, /encryptStr/);
});

test('ListClients clamps invalid pagination and handles an empty list', async () => {
  customResponse = (_request, response) => response.end(JSON.stringify({ data: {} }));
  const result = await invoke(RPC.listClients, { session: { token: 'token' }, page: -2, page_size: 0 });
  assert.deepEqual(result.clients, []);
  assert.equal(result.total_count, 0);
});

test('GetClient validates id and maps a record', async () => {
  await expectError(invoke(RPC.getClient, { session: { token: 'token' } }), grpcStatus.INVALID_ARGUMENT, /client_id/);
  const result = await invoke(RPC.getClient, { session: { token: 'token' }, client_id: 'client-1' });
  assert.deepEqual(result.client, client);
});

test('GetClient accepts list-shaped upstream response', async () => {
  customResponse = (_request, response) => response.end(JSON.stringify({ data: { list: [client] } }));
  const result = await invoke(RPC.getClient, { session: { token: 'token' }, client_id: 'client-1' });
  assert.equal(result.client.client_id, 'client-1');
});

test('GetAlertStats maps all statistics', async () => {
  const result = await invoke(RPC.getAlertStats, { session: { token: 'token' } });
  assert.equal(result.scan.threats_num, 1);
  assert.equal(result.intrusion.terminal_num, 8);
  assert.equal(result.inner_illegal, 19);
});

test('GetSystemView maps overview, server and license', async () => {
  const result = await invoke(RPC.getSystemView, { session: { token: 'token' } });
  assert.equal(result.view.terminal_all, 20);
  assert.equal(result.server_info.host_name, 'edr');
  assert.equal(result.license_info.user, 'company');
});

test('GetSystemInfo maps resource usage', async () => {
  const result = await invoke(RPC.getSystemInfo, { session: { token: 'token' } });
  assert.deepEqual(result.system_info, { disk_usage: 21, memory_usage: 22, cpu_usage: 23, network_tx: 24, network_rx: 25, server_time: 'now' });
});

test('apiToken secret can supply a session', async () => {
  const result = await invoke(RPC.getSystemInfo, {}, { secret: { apiToken: 'configured-token' } });
  assert.equal(result.status_code, 200);
  assert.equal(calls[0].headers.authorization, 'Bearer configured-token');
});

test('invalid endpoint and embedded credentials are rejected', async () => {
  await expectError(handlers[RPC.login]({ request: { host: 'not-a-url', username: 'a', password: 'b' } }), grpcStatus.INVALID_ARGUMENT, /absolute/);
  await expectError(handlers[RPC.login]({ request: { host: 'http://user:pass@example.test', username: 'a', password: 'b' } }), grpcStatus.INVALID_ARGUMENT, /without credentials/);
});

test('missing credentials and session are rejected', async () => {
  await expectError(invoke(RPC.login, { password: 'password' }), grpcStatus.INVALID_ARGUMENT, /username/);
  await expectError(invoke(RPC.login, { username: 'admin' }), grpcStatus.INVALID_ARGUMENT, /password/);
  await expectError(invoke(RPC.getSystemInfo, {}), grpcStatus.INVALID_ARGUMENT, /session.token/);
});

test('HTTP authentication and server errors are mapped without leaking bodies', async () => {
  customResponse = (_request, response) => { response.statusCode = 401; response.end('secret upstream body'); };
  await expectError(invoke(RPC.getSystemInfo, { session: { token: 'token' } }), grpcStatus.PERMISSION_DENIED, /HTTP 401/);
  customResponse = (_request, response) => { response.statusCode = 503; response.end('secret upstream body'); };
  await expectError(invoke(RPC.getSystemInfo, { session: { token: 'token' } }), grpcStatus.UNAVAILABLE, /HTTP 503/);
});

test('other HTTP failures and malformed JSON are mapped', async () => {
  customResponse = (_request, response) => { response.statusCode = 400; response.end('bad request'); };
  await expectError(invoke(RPC.getSystemInfo, { session: { token: 'token' } }), grpcStatus.UNKNOWN, /HTTP 400/);
  customResponse = (_request, response) => response.end('{broken');
  await expectError(invoke(RPC.getSystemInfo, { session: { token: 'token' } }), grpcStatus.UNKNOWN, /valid JSON/);
});

test('network errors and timeouts are sanitized', async () => {
  await expectError(handlers[RPC.login]({ request: { host: 'http://127.0.0.1:1', username: 'a', password: 'b' }, config: { timeoutMs: 50 } }), grpcStatus.UNAVAILABLE, /unavailable/);
  customResponse = () => {};
  await expectError(invoke(RPC.getSystemInfo, { session: { token: 'token' } }, { config: { timeoutMs: 10 } }), grpcStatus.UNAVAILABLE, /timed out/);
});
