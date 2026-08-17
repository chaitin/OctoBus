#!/usr/bin/env node

import assert from 'node:assert/strict';

import { GrpcError } from '@chaitin-ai/octobus-sdk';
import { handlers } from '../src/kubernetes-api.js';

const baseUrl = process.env.KUBERNETES_API_URL;
const token = process.env.KUBERNETES_TOKEN;
const namespace = process.env.KUBERNETES_TEST_NAMESPACE || 'kube-system';
const podName = process.env.KUBERNETES_TEST_POD;

if (!baseUrl || !token || !podName) {
  throw new Error('KUBERNETES_API_URL, KUBERNETES_TOKEN, and KUBERNETES_TEST_POD are required');
}

const invoke = (method, request = {}, secret = { token }) => handlers[`Kubernetes_API.Kubernetes_API/${method}`]({
  config: { baseUrl, skipTlsVerify: true, timeoutMs: 30000 },
  secret,
  request,
});

const namespaces = await invoke('ListNamespaces', { limit: 20 });
const pods = await invoke('ListPods', { namespace, limit: 20 });
const services = await invoke('ListServices', { namespace, limit: 20 });
const deployments = await invoke('ListDeployments', { namespace, limit: 20 });
const nodes = await invoke('ListNodes', { limit: 20 });
const pod = await invoke('GetPod', { namespace, name: podName });
const logs = await invoke('GetPodLogs', { namespace, name: podName, tail_lines: 1 });

assert.ok(namespaces.items.length > 0);
assert.ok(pods.items.some((item) => item.metadata.name === podName));
assert.ok(services.items.length > 0);
assert.ok(deployments.items.length > 0);
assert.ok(nodes.items.length > 0);
assert.equal(pod.pod.metadata.name, podName);
assert.equal(typeof logs.logs, 'string');

await assert.rejects(
  () => invoke('ListNamespaces', {}, { token: 'invalid-token' }),
  (error) => error instanceof GrpcError && /PERMISSION_DENIED/.test(error.message),
);
await assert.rejects(
  () => invoke('GetPod', { namespace, name: 'octobus-definitely-missing' }),
  (error) => error instanceof GrpcError && /NOT_FOUND/.test(error.message),
);

console.log(JSON.stringify({
  transport: 'HTTPS with a self-signed kind kube-apiserver certificate',
  authentication: 'Bearer ServiceAccount token accepted; invalid token rejected',
  namespaces: namespaces.items.length,
  pods: pods.items.length,
  services: services.items.length,
  deployments: deployments.items.length,
  nodes: nodes.items.length,
  getPod: 'success',
  getPodLogs: 'success',
  missingPod: 'NOT_FOUND',
}));
