import test from 'node:test';
import assert from 'node:assert/strict';

import { GrpcError } from '@chaitin-ai/octobus-sdk';
import { handlers, _test } from '../src/answer-platform.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const method = (name) => `Answer_Platform.Answer_Platform/${name}`;
const originalFetch = globalThis.fetch;

const context = (url, request = {}, overrides = {}) => ({
  request,
  config: { restBaseUrl: url, timeoutMs: 2000, ...(overrides.config ?? {}) },
  secret: { bindUser: 'admin', bindPassword: 'secret', ...(overrides.secret ?? {}) },
});

const invoke = (name, ctx) => handlers[method(name)](ctx);

const login = async (mock) => {
  const response = await invoke('Login', context(mock.url));
  assert.equal(response.code, 0);
  assert.ok(response.session_token);
  return response.session_token;
};

test.beforeEach(() => _test.clearSessions());
test.afterEach(() => { globalThis.fetch = originalFetch; });

test('production service exports every proto RPC handler', () => {
  assert.deepEqual(Object.keys(service.handlers).sort(), Object.keys(handlers).sort());
  const names = ['Login', 'SearchAlarms', 'GetAlarm', 'SearchBlockRules', 'CreateBlockRule',
    'UpdateBlockRuleStatus', 'DeleteBlockRule', 'ListFirewalls', 'CreateBlackList',
    'DeleteBlackList', 'SearchBlackList', 'GetSystemStatus', 'SearchAssets', 'Logout', 'GetAgentGroups'];
  assert.deepEqual(Object.keys(handlers).sort(), names.map(method).sort());
});

test('all proto RPCs execute production handlers against JSON-RPC upstream', async () => {
  const mock = await createMockServer();
  try {
    const token = await login(mock);
    const call = (name, request = {}) => invoke(name, context(mock.url, { session_token: token, ...request }));
    assert.equal((await call('SearchAlarms', {
      start_time: '2026-01-01T00:00:00Z', end_time: '2026-01-02T00:00:00Z', page: 2, page_size: 5000,
      threat_level: '1', attack_result: 'success', keyword: '192.0.2.1',
    })).total_count, 1);
    assert.ok((await call('GetAlarm', { alarm_id: 'alarm-1' })).alarm);
    assert.ok((await invoke('GetAlarm', context(mock.url, { sessionToken: token, alarmId: 'alarm-1' }))).alarm);
    assert.equal((await call('SearchBlockRules', { agent_id: 'agent-explicit', page: 2, page_size: 10, status: 'enabled' })).total_count, 201);
    assert.equal((await call('CreateBlockRule', { agent_id: 'agent-explicit', name: 'rule', src_ip: '192.0.2.1', duration: 'bad' })).rule_id, '8');
    assert.equal((await call('CreateBlockRule', {
      agent_id: 'agent-explicit', name: 'rule-2', src_ip: '192.0.2.2', dst_ip: '198.51.100.2',
      protocol: 'tcp', action: 'allow', duration: '60', description: 'test',
    })).rule_id, '8');
    assert.equal((await call('UpdateBlockRuleStatus', { agent_id: 'agent-explicit', rule_id: '7', enabled: true })).code, 0);
    assert.equal((await call('UpdateBlockRuleStatus', { agent_id: 'agent-explicit', rule_id: '7', enabled: false })).code, 0);
    assert.equal((await call('DeleteBlockRule', { agent_id: 'agent-explicit', rule_id: '7' })).code, 0);
    assert.equal((await call('DeleteBlockRule', { agent_id: 'agent-explicit', rule_id: '999' })).code, 0);
    assert.equal((await call('ListFirewalls')).items.length, 1);
    assert.equal((await call('CreateBlackList', { ips: ['192.0.2.2'], firewall_id: 'fw-1' })).code, 0);
    assert.equal((await call('CreateBlackList', { ips: ['192.0.2.3'] })).code, 0);
    assert.equal((await call('DeleteBlackList', { ids: ['black-1'] })).code, 0);
    assert.equal((await call('SearchBlackList', { page_size: 999999, ip_keyword: '192.0.2' })).total_count, 1);
    assert.equal((await call('SearchBlackList')).total_count, 1);
    assert.equal((await call('GetSystemStatus')).cpu_usage, '10%');
    assert.equal((await call('SearchAssets', { keyword: 'server' })).total_count, 1);
    assert.equal((await call('SearchAssets')).total_count, 1);
    assert.equal((await call('GetAgentGroups')).items.length, 1);
    assert.equal((await call('Logout')).code, 0);
    assert.ok(mock.requests.every((request) => request.method.includes('Service.') || request.method.startsWith('Hera')));
    assert.equal(mock.requests.find((request) => request.method === 'FirewallService.SearchBlackList').params.count, 1000);
  } finally {
    await mock.close();
  }
});

test('validation and authentication failures use gRPC errors', async () => {
  await assert.rejects(() => invoke('Login', context('http://example.test', {}, { secret: { bindPassword: '' } })), GrpcError);
  await assert.rejects(() => invoke('GetAlarm', context('http://example.test', {})), /session_token is required/);
  await assert.rejects(() => invoke('GetAlarm', context('http://example.test', { session_token: 'missing', alarm_id: 'a' })), /invalid or expired/);
  const mock = await createMockServer();
  try {
    const token = await login(mock);
    await assert.rejects(() => invoke('SearchAlarms', context(mock.url, { session_token: token, start_time: 'not-a-date' })), /start_time/);
    await assert.rejects(() => invoke('CreateBlackList', context(mock.url, { session_token: token, ips: [] })), /ips is required/);
    await assert.rejects(() => invoke('DeleteBlackList', context(mock.url, { session_token: token, ids: [] })), /ids is required/);
  } finally {
    await mock.close();
  }
});

test('transport maps timeout, network, HTTP and malformed responses', async () => {
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  await assert.rejects(() => invoke('Login', context('http://example.test', {}, { config: { timeoutMs: 5 } })), /DEADLINE_EXCEEDED/);
  globalThis.fetch = async () => { throw new Error('connection refused'); };
  await assert.rejects(() => invoke('Login', context('http://example.test')), /UNAVAILABLE/);
  globalThis.fetch = async () => new Response('not-json', { status: 200 });
  await assert.rejects(() => invoke('Login', context('http://example.test')), /invalid or too large/);
  globalThis.fetch = async () => new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: 4, message: 'license' } }), { status: 200 });
  await assert.rejects(() => invoke('Login', context('http://example.test')), /FAILED_PRECONDITION/);

  globalThis.fetch = async () => new Response(JSON.stringify({ jsonrpc: '2.0', result: {} }), { status: 503 });
  await assert.rejects(() => _test.rpcCall({ bindings: { restBaseUrl: 'http://example.test' } }, 'Test'), /upstream HTTP 503/);
  for (const error of [
    { code: 1, message: 'expired' },
    { code: 2 },
    { code: 99 },
    { message: 'record not found' },
  ]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ jsonrpc: '2.0', error }), { status: 200 });
    if (error.message === 'record not found') {
      assert.equal((await _test.rpcCall({ bindings: { restBaseUrl: 'http://example.test' } }, 'Test')).result, null);
    } else {
      await assert.rejects(() => _test.rpcCall({ bindings: { restBaseUrl: 'http://example.test' } }, 'Test'), GrpcError);
    }
  }

  globalThis.fetch = async () => ({
    ok: true, status: 200,
    headers: { get: (name) => name === 'set-cookie' ? 'sid=fallback' : null },
    text: async () => JSON.stringify({ jsonrpc: '2.0', result: { ok: true } }),
  });
  assert.deepEqual((await _test.rpcCall({ bindings: { restBaseUrl: 'http://example.test' } }, 'Test')).cookies, ['sid=fallback']);
  globalThis.fetch = async () => new Response(JSON.stringify({ jsonrpc: '2.0', result: { padding: 'xxxxxxxx' } }), { status: 200 });
  await assert.rejects(() => _test.rpcCall({ bindings: { restBaseUrl: 'http://example.test', maxResponseBytes: 4 } }, 'Test'), /too large/);
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    headers: { getSetCookie: () => [], get: (name) => name === 'content-length' ? '100' : null },
    text: async () => '{}',
  });
  await assert.rejects(() => _test.rpcCall({ bindings: { restBaseUrl: 'http://example.test', maxResponseBytes: 4 } }, 'Test'), /too large/);
});

test('logout is idempotent and authentication errors invalidate sessions', async () => {
  const mock = await createMockServer();
  try {
    assert.equal((await invoke('Logout', context(mock.url, { session_token: 'missing' }))).msg, 'session not found');
    const token = await login(mock);
    globalThis.fetch = async () => { throw new Error('logout failed'); };
    assert.equal((await invoke('Logout', context(mock.url, { session_token: token }))).code, 0);
    globalThis.fetch = originalFetch;
    const secondToken = await login(mock);
    globalThis.fetch = async () => new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: 1, message: 'expired' } }), { status: 200 });
    await assert.rejects(() => invoke('GetAlarm', context(mock.url, { session_token: secondToken, alarm_id: 'a' })), /PERMISSION_DENIED/);
    await assert.rejects(() => invoke('GetAlarm', context(mock.url, { session_token: secondToken, alarm_id: 'a' })), /invalid or expired/);
  } finally {
    globalThis.fetch = originalFetch;
    await mock.close();
  }
});

test('helpers cover protobuf values, limits and TLS dispatcher', () => {
  assert.equal(_test.limitPageSize(2000), 1000);
  assert.equal(_test.limitPageSize('bad'), 20);
  assert.equal(_test.resolveMaxResponseBytes({ bindings: { maxResponseBytes: 8 } }), 8);
  assert.equal(_test.resolveMaxResponseBytes({ bindings: { maxResponseBytes: 0 } }), 4 * 1024 * 1024);
  assert.deepEqual(_test.buildTlsOptions({}), {});
  assert.ok(_test.buildTlsOptions({ skipTlsVerify: true }).dispatcher);
  assert.equal(_test.toBoolean(false), false);
  assert.equal(_test.toBoolean(0), false);
  assert.equal(_test.toBoolean('off'), false);
  assert.equal(_test.toBoolean({ value: 'true' }), true);
  assert.deepEqual(_test.toValue([1, true, null]).listValue.values, [{ numberValue: 1 }, { boolValue: true }, { nullValue: 'NULL_VALUE' }]);
  assert.deepEqual(_test.toValue({ a: 'x' }), { structValue: { fields: { a: { stringValue: 'x' } } } });
  assert.deepEqual(_test.toValue(Symbol.for('x')), { stringValue: 'Symbol(x)' });
  assert.equal(_test.toStruct(null), undefined);
  assert.equal(_test.toStruct('scalar'), undefined);
  assert.equal(_test.normalizeBaseUrl('ftp://bad'), '');
  assert.equal(_test.normalizeBaseUrl({ value: 'https://example.test///' }), 'https://example.test');
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeoutMs: 12 } }), 12);
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeoutMs: -1 } }), 30000);
  assert.equal(_test.resolvePage(0), 1);
  assert.equal(_test.resolvePage(3), 3);
  assert.deepEqual(_test.resolveCallContext({ req: { x: 1 } }).req, { x: 1 });
  assert.equal(_test.pickFirst({}, ['missing']), undefined);
  assert.equal(_test.pickFirst({ wrapped: { value: { value: 'x' } } }, ['wrapped']), 'x');
  assert.equal(_test.firstDefined(undefined, null, 'x'), 'x');
  assert.equal(_test.resultCode({}), 0);
  assert.equal(_test.resultMsg({}), '');
  assert.deepEqual(_test.resultItems({ list: [1] }), [1]);
  assert.deepEqual(_test.resultItems({}), []);
  assert.equal(_test.resultTotal({ totalCount: 4 }, []), 4);
  assert.equal(_test.resultTotal({}, [1, 2]), 2);
  for (const code of ['INVALID_ARGUMENT', 'FAILED_PRECONDITION', 'PERMISSION_DENIED', 'UNAVAILABLE', 'DEADLINE_EXCEEDED', 'NOT_FOUND', 'UNKNOWN', 'INTERNAL', 'OTHER']) {
    assert.ok(_test.errorWithCode(code, 'test') instanceof GrpcError);
  }
});

test('session cache expires entries and remains bounded', () => {
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    _test.setSession('expired', { cookies: [] });
    now += 31 * 60 * 1000;
    assert.equal(_test.getSession('expired'), null);
    assert.equal(_test.getSession('missing'), null);
    assert.equal(_test.getSession(''), null);
    for (let index = 0; index <= 1000; index += 1) {
      now += 1;
      _test.setSession(`token-${index}`, { cookies: [] });
    }
    assert.equal(_test.querySessions().size, 1000);
    assert.equal(_test.getSession('token-0'), null);
  } finally {
    Date.now = originalNow;
    _test.clearSessions();
  }
});
