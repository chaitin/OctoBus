import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError } from '@chaitin-ai/octobus-sdk';
import { handlers, _test } from '../src/prometheus-3-0-1.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const buildCtx = (overrides = {}) => ({
  config: { baseUrl: 'https://prom.example.com:9090', timeoutMs: 4000, ...(overrides.config || {}) },
  secret: { ...(overrides.secret || {}) },
  bindings: overrides.bindings || {},
  req: overrides.req || {},
});

const expectGrpcError = async (fn, legacyCode) => { try { await fn(); assert.fail('expected rejection'); } catch (err) { assert.ok(err instanceof GrpcError); assert.equal(err.legacyCode, legacyCode); } };

test('service exports handlers', () => { assert.equal(typeof service, 'object'); assert.equal(typeof handlers['CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/InstantQuery'], 'function'); });

test('InstantQuery requires query', async () => {
  await expectGrpcError(() => handlers['CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/InstantQuery']({}, buildCtx()), 'INVALID_ARGUMENT');
});

test('InstantQuery returns result', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/InstantQuery']({ query: 'up' }, buildCtx({ config: { baseUrl } }));
    assert.equal(result.status, 'success');
    assert.equal(result.result_type, 'vector');
    assert.equal(result.result.length, 1);
  } finally { await mock.close(); }
});

test('RangeQuery requires query/start/end/step', async () => {
  await expectGrpcError(() => handlers['CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/RangeQuery']({}, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => handlers['CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/RangeQuery']({ query: 'up' }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => handlers['CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/RangeQuery']({ query: 'up', start: '1' }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => handlers['CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/RangeQuery']({ query: 'up', start: '1', end: '2' }, buildCtx()), 'INVALID_ARGUMENT');
});

test('RangeQuery returns matrix', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/RangeQuery']({ query: 'up', start: '2026-01-01T00:00:00Z', end: '2026-01-01T01:00:00Z', step: '15s' }, buildCtx({ config: { baseUrl } }));
    assert.equal(result.status, 'success');
    assert.equal(result.result_type, 'matrix');
    assert.equal(result.result.length, 1);
    assert.equal(result.result[0].values.length, 2);
  } finally { await mock.close(); }
});

test('ListTargets', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/ListTargets']({}, buildCtx({ config: { baseUrl } }));
    assert.equal(result.status, 'success');
    assert.equal(result.active_targets.length, 1);
    assert.equal(result.active_targets[0].health, 'up');
  } finally { await mock.close(); }
});

test('ListRules', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/ListRules']({}, buildCtx({ config: { baseUrl } }));
    assert.equal(result.status, 'success');
    assert.equal(result.groups.length, 1);
    assert.equal(result.groups[0].name, 'test-group');
  } finally { await mock.close(); }
});

test('ListAlerts', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/ListAlerts']({}, buildCtx({ config: { baseUrl } }));
    assert.equal(result.status, 'success');
    assert.equal(result.alerts.length, 1);
    assert.equal(result.alerts[0].state, 'firing');
  } finally { await mock.close(); }
});

test('ListSeries requires match', async () => {
  await expectGrpcError(() => handlers['CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/ListSeries']({}, buildCtx()), 'INVALID_ARGUMENT');
});

test('ListSeries', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/ListSeries']({ match: ['up'] }, buildCtx({ config: { baseUrl } }));
    assert.equal(result.status, 'success');
    assert.equal(result.data.length, 1);
  } finally { await mock.close(); }
});

test('GetStatusConfig', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/GetStatusConfig']({}, buildCtx({ config: { baseUrl } }));
    assert.equal(result.status, 'success');
    assert.ok(result.config_yaml.includes('scrape_interval'));
  } finally { await mock.close(); }
});

test('ListLabels returns label names', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/ListLabels']({}, buildCtx({ config: { baseUrl } }));
    assert.equal(result.status, 'success');
    assert.ok(result.data.includes('__name__'));
    assert.ok(result.data.includes('job'));
  } finally { await mock.close(); }
});

test('GetLabelValues requires label', async () => {
  await expectGrpcError(() => handlers['CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/GetLabelValues']({}, buildCtx()), 'INVALID_ARGUMENT');
});

test('GetLabelValues returns values', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/GetLabelValues']({ label: 'job' }, buildCtx({ config: { baseUrl } }));
    assert.equal(result.status, 'success');
    assert.ok(result.data.includes('prometheus'));
    assert.ok(result.data.length >= 3);
  } finally { await mock.close(); }
});

test('GetStatusBuildinfo returns build info', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/GetStatusBuildinfo']({}, buildCtx({ config: { baseUrl } }));
    assert.equal(result.status, 'success');
    assert.equal(result.build_info.version, '3.0.1');
    assert.equal(result.build_info.go_version, 'go1.23.0');
  } finally { await mock.close(); }
});

test('GetStatusFlags returns flags', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/GetStatusFlags']({}, buildCtx({ config: { baseUrl } }));
    assert.equal(result.status, 'success');
    assert.ok(result.flags_json.includes('web.listen-address'));
  } finally { await mock.close(); }
});

test('ListAlertmanagers returns AMs', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/ListAlertmanagers']({}, buildCtx({ config: { baseUrl } }));
    assert.equal(result.status, 'success');
    assert.equal(result.active_alertmanagers.length, 2);
    assert.equal(result.active_alertmanagers[0].url, 'http://am-1:9093');
  } finally { await mock.close(); }
});

test('ListScrapePools returns pools', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/ListScrapePools']({}, buildCtx({ config: { baseUrl } }));
    assert.equal(result.status, 'success');
    assert.ok(result.pools.find((p) => p.name === 'prometheus'));
    assert.ok(result.pools.find((p) => p.name === 'node-exporter'));
  } finally { await mock.close(); }
});

test('ListTargetsMetadata returns metadata', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/ListTargetsMetadata']({ metric: 'up' }, buildCtx({ config: { baseUrl } }));
    assert.equal(result.status, 'success');
    assert.equal(result.data.length, 1);
  } finally { await mock.close(); }
});

test('ListMetadata returns metric metadata', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/ListMetadata']({ metric: 'up' }, buildCtx({ config: { baseUrl } }));
    assert.equal(result.status, 'success');
    assert.ok(result.data.find((d) => d.metric === 'up'));
  } finally { await mock.close(); }
});

test('single-context SDK ABI and optional query parameters reach upstream', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  const invoke = (method, request) => handlers[`CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/${method}`]({ config: { baseUrl }, request });
  try {
    await invoke('InstantQuery', { query: 'up', time: '1', timeout: '2s', limit: 3, lookback_delta: '5m', stats: true });
    await invoke('RangeQuery', { query: 'up', start: '1', end: '2', step: '1', timeout: '2s', limit: 3, lookback_delta: '5m', stats: true });
    await invoke('ListTargets', { state: 'active', scrape_pool: 'prometheus' });
    await invoke('ListRules', { type: 'alert', rule_name: 'HighErrorRate', rule_group: ['test'], file: ['rules.yml'] });
    await invoke('ListAlerts', { state: 'firing' });
    await invoke('ListSeries', { match: ['up'], start: '1', end: '2', limit: 2 });
    await invoke('ListLabels', { match: ['up'], start: '1', end: '2', limit: 2 });
    await invoke('GetLabelValues', { label: 'job', match: ['up'], start: '1', end: '2', limit: 2 });
    await invoke('ListTargetsMetadata', { match_target: '{job="prometheus"}', metric: 'up', limit: 2 });
    await invoke('ListMetadata', { match_target: '{job="prometheus"}', metric: 'up', limit: 2 });
    assert.equal(mock.requests.length, 10);
    assert.equal(mock.requests[0].query.stats, 'all');
    assert.equal(mock.requests[2].query.scrape_pool, 'prometheus');
    assert.equal(mock.requests[9].query.limit_per_metric, '2');
    assert.equal(mock.requests[9].query.limit, undefined);
  } finally { await mock.close(); }
});

test('helpers cover validation, encoding, auth, TLS and response mapping', () => {
  assert.equal(_test.resolveBaseUrl({ baseUrl: ' ftp://bad ' }), '');
  assert.equal(_test.resolveBaseUrl({ baseUrl: 'not a url' }), '');
  assert.equal(_test.resolveBaseUrl({ domain: 'http://example.com/' }), 'http://example.com');
  assert.equal(_test.resolveBaseUrl({ baseUrl: 'https://user:pass@example.com///' }), 'https://example.com');
  assert.deepEqual(_test.buildAuthHeaders({}), {});
  assert.deepEqual(_test.buildAuthHeaders({ username: 'u' }), {});
  assert.equal(_test.buildAuthHeaders({ token: 'secret' }).Authorization, 'Bearer secret');
  assert.equal(_test.buildAuthHeaders({ username: 'u', password: 'p' }).Authorization, 'Basic dTpw');
  assert.deepEqual(_test.buildTlsOptions({}), {});
  assert.ok(_test.buildTlsOptions({ skipTlsVerify: true }).dispatcher);
  assert.equal(_test.toTrimmedString({ value: ' x ' }), 'x');
  assert.equal(_test.toTrimmedString(undefined), '');
  assert.equal(_test.toFiniteInt('2.9'), 2);
  assert.equal(_test.toFiniteInt('', 4), 4);
  assert.equal(_test.toFiniteInt('bad', 7), 7);
  assert.equal(_test.toFiniteNumber('2.5'), 2.5);
  assert.equal(_test.toFiniteNumber(undefined, 8), 8);
  assert.equal(_test.toJsonString({ a: 1 }), '{"a":1}');
  const circular = {}; circular.self = circular;
  assert.equal(_test.toJsonString(circular), '');
  assert.equal(_test.toJsonString(null), '');
  assert.equal(_test.encodeQueryParams({ a: ['x', 'y'], b: '', c: 2 }), 'a=x&a=y&c=2');
  assert.equal(_test.mapQueryResult([1, '2'], 'scalar')[0].values[0].value, '2');
  assert.deepEqual(_test.mapQueryResult(null, 'vector'), []);
  assert.deepEqual(_test.mapQueryResult([{ metric: {}, value: null }], 'vector')[0].values, []);
  assert.deepEqual(_test.mapQueryResult([{ metric: {}, values: null }], 'matrix')[0].values, []);
  assert.deepEqual(_test.mapQueryResult([], 'unknown'), []);
  assert.deepEqual(_test.mapMetricLabels(), []);
  assert.equal(_test.tryParseJson('{}').ok, true);
  assert.equal(_test.tryParseJson('x').ok, false);
  assert.equal(_test.safeUrlForLog('https://u:p@example.com/x?token=s'), 'https://example.com/x?token=%5BREDACTED%5D');
  assert.equal(_test.safeUrlForLog('bad'), '[invalid-url]');
});

test('response helpers map invalid and HTTP error responses without leaking body', () => {
  assert.deepEqual(_test.parseJsonOrThrow({ httpStatus: 200, httpBody: '{"ok":true}' }, 'x'), { ok: true });
  for (const body of ['', 'not-json']) assert.throws(() => _test.parseJsonOrThrow({ httpStatus: 200, httpBody: body }, 'x'), GrpcError);
  for (const status of [400, 401, 403, 404, 418, 422, 500, 503]) {
    assert.throws(() => _test.ensureSuccess({ httpStatus: status, httpBody: 'token=secret' }, 'x'), (err) => err instanceof GrpcError && !err.message.includes('secret'));
  }
  assert.doesNotThrow(() => _test.ensureSuccess({ httpStatus: 204, httpBody: '' }, 'x'));
});

test('fetch failures and malformed upstream responses become gRPC errors', async () => {
  const originalFetch = globalThis.fetch;
  const call = (request = { query: 'up' }) => handlers['CNCF_Prometheus_3_0_1.CNCF_Prometheus_3_0_1/InstantQuery']({ config: { baseUrl: 'https://example.com' }, request });
  try {
    globalThis.fetch = async () => { throw new Error('network down'); };
    await expectGrpcError(call, 'UNAVAILABLE');
    globalThis.fetch = async () => ({ status: 200, text: async () => { throw new Error('read failed'); } });
    await expectGrpcError(call, 'UNAVAILABLE');
    globalThis.fetch = async () => ({ status: 200, text: async () => '' });
    await expectGrpcError(call, 'UNKNOWN');
    globalThis.fetch = async () => ({ status: 200, text: async () => 'not-json' });
    await expectGrpcError(call, 'UNKNOWN');
    globalThis.fetch = async () => ({ status: 401, text: async () => '{"token":"secret"}' });
    await expectGrpcError(call, 'PERMISSION_DENIED');
  } finally { globalThis.fetch = originalFetch; }
});
