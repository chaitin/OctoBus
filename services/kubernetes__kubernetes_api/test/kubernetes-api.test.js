import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError } from '@chaitin-ai/octobus-sdk';
import { handlers } from '../src/kubernetes-api.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const buildCtx = (overrides = {}) => ({
  config: { baseUrl: 'https://k8s-api.example.com:6443', timeoutMs: 4000, ...(overrides.config || {}) },
  secret: { token: 'fake-token', ...(overrides.secret || {}) },
  bindings: overrides.bindings || {},
  req: overrides.req || {},
});

test('service exports handlers', () => { assert.equal(typeof service, 'object'); assert.equal(typeof handlers['Kubernetes_API.Kubernetes_API/ListNamespaces'], 'function'); });

test('ListNamespaces', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['Kubernetes_API.Kubernetes_API/ListNamespaces']({}, buildCtx({ config: { baseUrl } }));
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].metadata.name, 'default');
    assert.equal(result.continue_token, '');
  } finally { await mock.close(); }
});

test('ListPods', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['Kubernetes_API.Kubernetes_API/ListPods']({ namespace: 'default' }, buildCtx({ config: { baseUrl } }));
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].metadata.name, 'nginx-pod');
    assert.equal(result.items[0].containers[0].name, 'nginx');
  } finally { await mock.close(); }
});

test('ListServices', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['Kubernetes_API.Kubernetes_API/ListServices']({ namespace: 'default' }, buildCtx({ config: { baseUrl } }));
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].metadata.name, 'kubernetes');
    assert.equal(result.items[0].cluster_ip, '10.96.0.1');
  } finally { await mock.close(); }
});

test('ListDeployments', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['Kubernetes_API.Kubernetes_API/ListDeployments']({ namespace: 'default' }, buildCtx({ config: { baseUrl } }));
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].metadata.name, 'nginx-deploy');
    assert.equal(result.items[0].status.replicas, 3);
  } finally { await mock.close(); }
});

test('ListNodes', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['Kubernetes_API.Kubernetes_API/ListNodes']({}, buildCtx({ config: { baseUrl } }));
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].metadata.name, 'node-1');
    assert.equal(result.items[0].status.kubelet_version, 'v1.29.0');
  } finally { await mock.close(); }
});

test('GetPod requires namespace and name', async () => {
  try { await handlers['Kubernetes_API.Kubernetes_API/GetPod']({}, buildCtx()); assert.fail('expected rejection'); } catch (err) { assert.ok(err instanceof GrpcError); }
});

test('GetPod', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['Kubernetes_API.Kubernetes_API/GetPod']({ namespace: 'default', name: 'nginx-pod' }, buildCtx({ config: { baseUrl } }));
    assert.equal(result.pod.metadata.name, 'nginx-pod');
    assert.equal(result.pod.node_name, 'node-1');
  } finally { await mock.close(); }
});

test('GetPodLogs requires namespace and name', async () => {
  try { await handlers['Kubernetes_API.Kubernetes_API/GetPodLogs']({}, buildCtx()); assert.fail('expected rejection'); } catch (err) { assert.ok(err instanceof GrpcError); }
  try { await handlers['Kubernetes_API.Kubernetes_API/GetPodLogs']({ namespace: 'default' }, buildCtx()); assert.fail('expected rejection'); } catch (err) { assert.ok(err instanceof GrpcError); }
});

test('GetPodLogs', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['Kubernetes_API.Kubernetes_API/GetPodLogs']({ namespace: 'default', name: 'nginx-pod', tail_lines: 10 }, buildCtx({ config: { baseUrl } }));
    assert.ok(result.logs.includes('Server started'));
  } finally { await mock.close(); }
});