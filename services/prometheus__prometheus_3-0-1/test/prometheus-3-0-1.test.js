import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError } from '@chaitin-ai/octobus-sdk';
import { handlers } from '../src/prometheus-3-0-1.js';
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