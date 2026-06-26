import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError } from '@chaitin-ai/octobus-sdk';
import { handlers } from '../src/alertmanager-0-27-0.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const buildCtx = (overrides = {}) => ({
  config: { baseUrl: 'https://am.example.com:9093', timeoutMs: 4000, ...(overrides.config || {}) },
  secret: { ...(overrides.secret || {}) },
  bindings: overrides.bindings || {},
  req: overrides.req || {},
});

const expectGrpcError = async (fn, legacyCode) => { try { await fn(); assert.fail('expected rejection'); } catch (err) { assert.ok(err instanceof GrpcError); assert.equal(err.legacyCode, legacyCode); } };

test('service exports handlers', () => { assert.equal(typeof service, 'object'); assert.equal(typeof handlers['Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/ListAlerts'], 'function'); });

test('ListAlerts', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/ListAlerts']({}, buildCtx({ config: { baseUrl } }));
    assert.equal(result.status, 'success');
    assert.equal(result.alerts.length, 1);
    assert.equal(result.alerts[0].fingerprint, 'abc123');
  } finally { await mock.close(); }
});

test('ListAlerts with filters', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/ListAlerts'](
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
    const result = await handlers['Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/GetAlertGroups']({}, buildCtx({ config: { baseUrl } }));
    assert.equal(result.status, 'success');
    assert.equal(result.groups.length, 1);
    assert.equal(result.groups[0].receiver_name, 'default');
  } finally { await mock.close(); }
});

test('GetAlertGroups with receiver filter', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/GetAlertGroups'](
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
    const result = await handlers['Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/ListSilences']({}, buildCtx({ config: { baseUrl } }));
    assert.equal(result.status, 'success');
    assert.equal(result.silences.length, 1);
    assert.equal(result.silences[0].id, 'silence-1');
  } finally { await mock.close(); }
});

test('GetSilence requires silence_id', async () => {
  await expectGrpcError(() => handlers['Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/GetSilence']({}, buildCtx()), 'INVALID_ARGUMENT');
});

test('GetSilence', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/GetSilence']({ silence_id: 'silence-1' }, buildCtx({ config: { baseUrl } }));
    assert.equal(result.status, 'success');
    assert.equal(result.silence.id, 'silence-1');
  } finally { await mock.close(); }
});

test('GetStatus', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['Prometheus_Alertmanager_0_27_0.Prometheus_Alertmanager_0_27_0/GetStatus']({}, buildCtx({ config: { baseUrl } }));
    assert.equal(result.status, 'success');
    assert.equal(result.cluster.name, 'am-1');
    assert.equal(result.cluster.peers.length, 1);
  } finally { await mock.close(); }
});