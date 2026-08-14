import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { _test, handlers, MAX_RESPONSE_BYTES, rpcdef } from '../src/alertmanager-0-27-0.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const buildCtx = (overrides = {}) => ({
  config: { baseUrl: 'https://am.example.com:9093', timeoutMs: 4000, ...(overrides.config || {}) },
  secret: { ...(overrides.secret || {}) },
  bindings: overrides.bindings || {},
  req: overrides.req || {},
});

const expectGrpcError = async (fn, legacyCode) => { try { await fn(); assert.fail('expected rejection'); } catch (err) { assert.ok(err instanceof GrpcError); assert.equal(err.legacyCode, legacyCode); } };
const invoke = (method, request = {}, ctx = buildCtx()) => handlers[method]({ ...ctx, request });

test('service exports handlers', () => { assert.equal(typeof service, 'object'); assert.equal(typeof handlers['Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/ListAlerts'], 'function'); });

test('ListAlerts', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await invoke('Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/ListAlerts', {}, buildCtx({ config: { baseUrl } }));
    assert.equal(result.status, 'success');
    assert.equal(result.alerts.length, 1);
    assert.equal(result.alerts[0].fingerprint, 'abc123');
  } finally { await mock.close(); }
});

test('ListAlerts with filters', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await invoke('Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/ListAlerts',
      { silenced: false, inhibited: false, active: true, filter: 'alertname=HighErrorRate' },
      buildCtx({ config: { baseUrl } }),
    );
    assert.equal(result.status, 'success');
    assert.equal(result.alerts.length, 1);
    assert.equal(mock.requests[0].query.silenced, 'false');
    assert.equal(mock.requests[0].query.active, 'true');
  } finally { await mock.close(); }
});

test('GetAlertGroups', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await invoke('Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/GetAlertGroups', {}, buildCtx({ config: { baseUrl } }));
    assert.equal(result.status, 'success');
    assert.equal(result.groups.length, 1);
    assert.equal(result.groups[0].receiver_name, 'default');
  } finally { await mock.close(); }
});

test('GetAlertGroups with receiver filter', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await invoke('Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/GetAlertGroups',
      { receiver: 'default' },
      buildCtx({ config: { baseUrl } }),
    );
    assert.equal(result.groups.length, 1);
    assert.equal(mock.requests[0].query.receiver, 'default');
  } finally { await mock.close(); }
});

test('ListSilences', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await invoke('Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/ListSilences', {}, buildCtx({ config: { baseUrl } }));
    assert.equal(result.status, 'success');
    assert.equal(result.silences.length, 1);
    assert.equal(result.silences[0].id, 'silence-1');
  } finally { await mock.close(); }
});

test('GetSilence requires silence_id', async () => {
  await expectGrpcError(() => invoke('Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/GetSilence'), 'INVALID_ARGUMENT');
});

test('GetSilence', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await invoke('Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/GetSilence', { silence_id: 'silence-1' }, buildCtx({ config: { baseUrl } }));
    assert.equal(result.status, 'success');
    assert.equal(result.silence.id, 'silence-1');
  } finally { await mock.close(); }
});

test('GetStatus', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await invoke('Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/GetStatus', {}, buildCtx({ config: { baseUrl } }));
    assert.equal(result.status, 'success');
    assert.equal(result.cluster.name, 'am-1');
    assert.equal(result.cluster.peers.length, 1);  } finally { await mock.close(); }
});

test('ListReceivers', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await invoke('Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/ListReceivers', {}, buildCtx({ config: { baseUrl } }));
    assert.equal(result.status, 'success');
    assert.equal(result.receivers.length, 2);
    assert.equal(result.receivers[0].name, 'team-a');
    assert.equal(result.receivers[0].integrations.length, 2);
    assert.equal(result.receivers[0].integrations[0].type, 'webhook');
    assert.equal(result.receivers[0].integrations[0].active, true);
  } finally { await mock.close(); }
});

test('configuration helpers normalize aliases and reject unsafe URLs', () => {
  assert.equal(_test.normalizeBaseUrl('https://example.test///'), 'https://example.test');
  assert.equal(_test.normalizeBaseUrl('file:///tmp/socket'), '');
  assert.equal(_test.normalizeBaseUrl('https://user:pass@example.test'), '');
  assert.equal(_test.normalizeBaseUrl('not a URL'), '');
  assert.equal(_test.resolveBaseUrl({ domain: 'http://example.test/' }), 'http://example.test');
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: 999999 } }), 120000);
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeoutMs: -1 } }), 10000);
  assert.equal(_test.toTrimmedString({ value: ' x ' }), 'x');
  assert.equal(_test.toBool('YES'), true);
  assert.equal(_test.toBool('off', true), false);
  assert.equal(_test.toBool('unknown', true), true);
  assert.equal(_test.toBool(0, true), false);
  assert.equal(_test.toBool(null, true), true);
  const circular = {}; circular.self = circular;
  assert.equal(_test.toJsonString(circular), '');
});

test('authentication, query, mapping, and JSON helpers cover sparse inputs', () => {
  assert.deepEqual(_test.buildAuthHeaders({ token: ' token ' }), { Authorization: 'Bearer token' });
  assert.match(_test.buildAuthHeaders({ user: 'alice', passwd: 'secret' }).Authorization, /^Basic /);
  assert.deepEqual(_test.buildAuthHeaders({ username: 'alice' }), {});
  assert.equal(_test.buildQuery({ a: 'x y', empty: '', none: null }), '?a=x%20y');
  assert.deepEqual(_test.tryParseJson('{"ok":true}'), { ok: true, value: { ok: true } });
  assert.deepEqual(_test.tryParseJson('{'), { ok: false });
  assert.equal(_test.mapHttpStatusToCode(401), 'PERMISSION_DENIED');
  assert.equal(_test.mapHttpStatusToCode(404), 'NOT_FOUND');
  assert.equal(_test.mapHttpStatusToCode(422), 'FAILED_PRECONDITION');
  assert.equal(_test.mapHttpStatusToCode(503), 'UNAVAILABLE');
  assert.deepEqual(_test.mapAlertLabels(null), []);
  assert.deepEqual(_test.mapMatcher({ isRegex: 'true', isEqual: false }), { name: '', value: '', is_regex: true, is_equal: false });
  assert.equal(_test.mapAlert({ status: { state: 'active' } }).status_state.length, 0);
  assert.equal(_test.mapSilence({ matchers: null }).matchers.length, 0);
});

test('response parsing and HTTP status errors are deterministic and redacted', async () => {
  assert.deepEqual(_test.parseJsonOrThrow({ httpStatus: 200, httpBody: '{}' }, 'test'), {});
  await expectGrpcError(() => Promise.resolve(_test.parseJsonOrThrow({ httpStatus: 200, httpBody: '' }, 'test')), 'UNKNOWN');
  await expectGrpcError(() => Promise.resolve(_test.parseJsonOrThrow({ httpStatus: 200, httpBody: 'not-json' }, 'test')), 'UNKNOWN');
  _test.ensureSuccess({ httpStatus: 204, httpBody: '' }, 'test');
  try {
    _test.ensureSuccess({ httpStatus: 403, httpBody: 'token=super-secret' }, 'test');
    assert.fail('expected error');
  } catch (error) {
    assert.equal(error.code, grpcStatus.PERMISSION_DENIED);
    assert.doesNotMatch(error.message, /super-secret/);
    assert.equal(error.response.http_body, '');
  }
});

test('HTTP transport handles redirects, size limits, read failures, and timeouts', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal(init.redirect, 'error');
      return { status: 200, headers: { get: () => String(MAX_RESPONSE_BYTES + 1) }, text: async () => '' };
    };
    await expectGrpcError(() => _test.executeRequest('https://example.test/api', { bindings: {} }, { action: 'Size' }), 'UNAVAILABLE');

    globalThis.fetch = async () => ({ status: 200, headers: { get: () => '0' }, text: async () => 'x'.repeat(MAX_RESPONSE_BYTES + 1) });
    await expectGrpcError(() => _test.executeRequest('https://example.test/api', { bindings: {} }, { action: 'Size' }), 'UNAVAILABLE');

    globalThis.fetch = async () => ({ status: 200, headers: { get: () => '0' }, text: async () => { throw new Error('read failed'); } });
    await expectGrpcError(() => _test.executeRequest('https://example.test/api', { bindings: {} }, { action: 'Read' }), 'UNAVAILABLE');

    globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => {
      const error = new Error('secret transport detail'); error.name = 'AbortError'; reject(error);
    }, { once: true }));
    await expectGrpcError(() => _test.executeRequest('https://example.test/api', { bindings: { timeoutMs: 1 } }, { action: 'Timeout' }), 'UNAVAILABLE');

    globalThis.fetch = async () => { throw new Error('token=secret'); };
    try { await _test.executeRequest('https://example.test/api', { bindings: {} }, { action: 'Network' }); }
    catch (error) { assert.doesNotMatch(error.message, /secret/); }
  } finally { globalThis.fetch = originalFetch; }
});

test('TLS and legacy context aliases are supported without weakening HTTP', async () => {
  assert.deepEqual(_test.buildTlsOptions({ skipTlsVerify: true }, 'http://example.test'), {});
  assert.ok(_test.buildTlsOptions({ tlsInsecureSkipVerify: 'true' }, 'https://example.test').dispatcher);
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/ListAlerts']({ config: { baseUrl }, req: { receiver: 'ops' } });
    assert.equal(result.status, 'success');
    assert.equal(mock.requests[0].query.receiver, 'ops');
  } finally { await mock.close(); }
});

test('rpcdef exposes every public RPC through the current context', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const routes = rpcdef(buildCtx({ config: { baseUrl } }));
    assert.equal(Object.keys(routes).length, 6);
    await routes['/Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/ListAlerts']({ active: false });
    await routes['/Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/GetAlertGroups']({ silenced: true, inhibited: true, active: false, filter: 'severity=critical', receiver: 'ops' });
    await routes['/Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/ListSilences']({ filter: 'alertname=Test' });
    await routes['/Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/GetSilence']({ silence_id: 'a/b' });
    await routes['/Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/GetStatus']();
    await routes['/Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/ListReceivers']();
    assert.equal(mock.requests.length, 6);
    assert.equal(mock.requests[3].path, '/api/v2/silence/a%2Fb');
  } finally { await mock.close(); }
});
