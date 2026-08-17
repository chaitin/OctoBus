import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError } from '@chaitin-ai/octobus-sdk';
import { handlers, _test } from '../src/kubernetes-api.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const buildCtx = (overrides = {}) => ({
  config: { baseUrl: 'https://k8s-api.example.com:6443', timeoutMs: 4000, ...(overrides.config || {}) },
  secret: { token: 'fake-token', ...(overrides.secret || {}) },
  bindings: overrides.bindings || {},
  req: overrides.req || {},
  request: overrides.request || {},
});

const call = (method, request = {}, overrides = {}) => handlers[method](buildCtx({ ...overrides, request }));

test('service exports handlers', () => { assert.equal(typeof service, 'object'); assert.equal(typeof handlers['Kubernetes_API.Kubernetes_API/ListNamespaces'], 'function'); });

test('ListNamespaces', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await call('Kubernetes_API.Kubernetes_API/ListNamespaces', {}, { config: { baseUrl } });
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].metadata.name, 'default');
    assert.equal(result.continue_token, '');
  } finally { await mock.close(); }
});

test('ListPods', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await call('Kubernetes_API.Kubernetes_API/ListPods', { namespace: 'default' }, { config: { baseUrl } });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].metadata.name, 'nginx-pod');
    assert.equal(result.items[0].containers[0].name, 'nginx');
  } finally { await mock.close(); }
});

test('ListServices', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await call('Kubernetes_API.Kubernetes_API/ListServices', { namespace: 'default' }, { config: { baseUrl } });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].metadata.name, 'kubernetes');
    assert.equal(result.items[0].cluster_ip, '10.96.0.1');
  } finally { await mock.close(); }
});

test('ListDeployments', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await call('Kubernetes_API.Kubernetes_API/ListDeployments', { namespace: 'default' }, { config: { baseUrl } });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].metadata.name, 'nginx-deploy');
    assert.equal(result.items[0].status.replicas, 3);
  } finally { await mock.close(); }
});

test('ListNodes', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await call('Kubernetes_API.Kubernetes_API/ListNodes', {}, { config: { baseUrl } });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].metadata.name, 'node-1');
    assert.equal(result.items[0].status.kubelet_version, 'v1.29.0');
  } finally { await mock.close(); }
});

test('GetPod requires namespace and name', async () => {
  await assert.rejects(() => call('Kubernetes_API.Kubernetes_API/GetPod'), GrpcError);
  await assert.rejects(() => call('Kubernetes_API.Kubernetes_API/GetPod', { namespace: 'default' }), /name is required/);
});

test('GetPod', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await call('Kubernetes_API.Kubernetes_API/GetPod', { namespace: 'default', name: 'nginx-pod' }, { config: { baseUrl } });
    assert.equal(result.pod.metadata.name, 'nginx-pod');
    assert.equal(result.pod.node_name, 'node-1');
  } finally { await mock.close(); }
});

test('GetPodLogs requires namespace and name', async () => {
  await assert.rejects(() => call('Kubernetes_API.Kubernetes_API/GetPodLogs'), GrpcError);
  await assert.rejects(() => call('Kubernetes_API.Kubernetes_API/GetPodLogs', { namespace: 'default' }), /name is required/);
});

test('GetPodLogs', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await call('Kubernetes_API.Kubernetes_API/GetPodLogs', { namespace: 'default', name: 'nginx-pod', container: 'nginx', tail_lines: 10, since_seconds: 60, previous: true, timestamps: true }, { config: { baseUrl } });
    assert.ok(result.logs.includes('Server started'));
    assert.deepEqual(mock.requests.at(-1).query, { container: 'nginx', tailLines: '10', sinceSeconds: '60', previous: 'true', timestamps: 'true' });
    assert.equal(mock.requests.at(-1).headers.accept, '*/*');
  } finally { await mock.close(); }
});

test('URL, authentication, timeout, TLS, and helper boundaries are safe', () => {
  assert.equal(_test.resolveBaseUrl({ baseUrl: 'https://cluster.example/api/' }), 'https://cluster.example/api');
  assert.equal(_test.resolveBaseUrl({ baseUrl: 'http://cluster.example' }), '');
  assert.equal(_test.resolveBaseUrl({ baseUrl: 'http://cluster.example', allowInsecureHttp: true }), 'http://cluster.example');
  for (const invalid of ['file:///etc/passwd', 'https://user:pass@cluster.example', 'https://cluster.example?token=x', 'broken']) {
    assert.equal(_test.resolveBaseUrl({ baseUrl: invalid }), '');
  }
  assert.deepEqual(_test.buildAuthHeaders({ token: ' secret ' }), { Authorization: 'Bearer secret' });
  assert.match(_test.buildAuthHeaders({ username: 'u', password: 'p' }).Authorization, /^Basic /);
  assert.equal(typeof _test.buildTlsOptions({ skipTlsVerify: 'true' }).dispatcher.dispatch, 'function');
  assert.deepEqual(_test.buildTlsOptions({ skipTlsVerify: false }), {});
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeoutMs: 999999 } }), 120000);
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeoutMs: -1 } }), 15000);
  assert.equal(_test.toFiniteInt({ value: '4.9' }), 4);
  assert.equal(_test.toBool('yes'), true);
  assert.equal(_test.toJsonString({ ok: true }), '{"ok":true}');
  assert.deepEqual(_test.strToMap({ a: 1 }), { a: '1' });
});

test('HTTP, protocol, network, redirect, and bounded-response failures map safely', async () => {
  const originalFetch = globalThis.fetch;
  const run = (fetchImpl) => {
    globalThis.fetch = fetchImpl;
    return call('Kubernetes_API.Kubernetes_API/ListNamespaces', {}, { config: { baseUrl: 'https://cluster.example', timeoutMs: 20 }, secret: { token: 'super-secret' } });
  };
  try {
    await assert.rejects(() => run(async () => new Response('{"error":"sensitive"}', { status: 401 })), (err) => err.code !== undefined && !err.message.includes('sensitive'));
    await assert.rejects(() => run(async () => new Response('', { status: 302, headers: { location: 'https://evil.example' } })), /upstream http 302/);
    await assert.rejects(() => run(async () => new Response('not-json', { status: 200 })), /not valid JSON/);
    await assert.rejects(() => run(async () => new Response('', { status: 200 })), /empty response/);
    await assert.rejects(() => run(async () => { throw new Error('network down'); }), /UNAVAILABLE/);
    await assert.rejects(() => run(async (_url, init) => new Response(new ReadableStream({
      start(controller) { init.signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError'))); },
    }))), /timed out/);
    await assert.rejects(() => run(async () => new Response('x', { status: 200, headers: { 'content-length': String(5 * 1024 * 1024) } })), /exceeds/);
    let redirect;
    await assert.rejects(() => run(async (_url, init) => { redirect = init.redirect; return new Response('', { status: 500 }); }), /upstream http 500/);
    assert.equal(redirect, 'manual');
  } finally { globalThis.fetch = originalFetch; }
});

test('all list query variants and scalar/mapping fallbacks are covered', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    await call('Kubernetes_API.Kubernetes_API/ListNamespaces', { label_selector: 'team=a', field_selector: 'status.phase=Active', limit: 2, continue_token: 'next' }, { bindings: { baseUrl, bearerToken: 'token' } });
    await call('Kubernetes_API.Kubernetes_API/ListPods', { label_selector: 'app=x', field_selector: 'status.phase=Running', limit: 1, continue_token: 'next' }, { config: { baseUrl }, secret: {} });
    await call('Kubernetes_API.Kubernetes_API/ListServices', { label_selector: 'app=x', limit: 1, continue_token: 'next' }, { config: { baseUrl } });
    await call('Kubernetes_API.Kubernetes_API/ListDeployments', { label_selector: 'app=x', limit: 1, continue_token: 'next' }, { config: { baseUrl } });
    await call('Kubernetes_API.Kubernetes_API/ListNodes', { label_selector: 'role=worker', limit: 1, continue_token: 'next' }, { config: { baseUrl } });
    assert.equal(mock.requests.some((request) => request.path === '/api/v1/pods'), true);
    assert.equal(mock.requests.some((request) => request.query.continue === 'next'), true);
  } finally { await mock.close(); }

  for (const [value, expected] of [[undefined, false], [null, false], [1, true], [0, false], ['off', false], ['unknown', false], [{ value: 'on' }, true]]) {
    assert.equal(_test.toBool(value), expected);
  }
  assert.equal(_test.toFiniteInt(undefined, 7), 7);
  assert.equal(_test.toFiniteInt('invalid', 8), 8);
  assert.equal(_test.toTrimmedString(null), '');
  assert.equal(_test.toTrimmedString({ value: ' x ' }), 'x');
  assert.equal(_test.toJsonString('x'), 'x');
  const circular = {}; circular.self = circular;
  assert.equal(_test.toJsonString(circular), '');
  assert.deepEqual(_test.strToMap(null), {});
  assert.deepEqual(_test.strToMap([]), {});
  assert.deepEqual(_test.mapListMeta({ metadata: { continue: { value: 'n' }, remainingItemCount: '3' } }), { continue_token: 'n', remaining_item_count: 3 });
  assert.equal(_test.tryParseJson('{}').ok, true);
  assert.equal(_test.tryParseJson('x').ok, false);
  assert.equal(_test.buildAuthHeaders({ username: 'u' }).Authorization, undefined);
});

test('object and pod mappers cover optional Kubernetes representations', () => {
  const mapped = _test.mapPodInfo({
    metadata: { name: 1, namespace: null, labels: { a: 2 }, annotations: null, deletionTimestamp: 'now' },
    spec: { nodeName: 'node', containers: [{ name: 'c', image: 'i', ports: [{ containerPort: 80 }, { protocol: 'UDP' }] }] },
    status: { containerStatuses: [
      { state: { waiting: { reason: 'Pulling', message: 'wait' } }, restartCount: '2', ready: 1, started: 'false' },
      { state: { terminated: { reason: 'Done', message: 'ok', finishedAt: 'then' } } },
      {},
    ] },
  });
  assert.equal(mapped.metadata.name, '1');
  assert.deepEqual(mapped.containers[0].ports, ['80/TCP', '/UDP']);
  assert.equal(mapped.status.container_statuses[0].state, 'waiting');
  assert.equal(mapped.status.container_statuses[1].state, 'terminated');
  assert.equal(mapped.status.container_statuses[2].state, '');
  assert.equal(_test.mapObjectMeta().name, '');
  assert.equal(_test.mapPodContainer().ports.length, 0);
  assert.equal(_test.mapContainerState().ready, false);
});

test('bounded response reader covers non-streaming and streaming limits', async () => {
  assert.equal(await _test.readResponseBody({ headers: { get: () => null }, text: async () => 'ok' }, 2), 'ok');
  await assert.rejects(() => _test.readResponseBody({ headers: { get: () => null }, text: async () => 'too-long' }, 2), /exceeds/);
  await assert.rejects(() => _test.readResponseBody(new Response('abc'), 2), /exceeds/);
  assert.doesNotThrow(() => _test.ensureSuccess({ httpStatus: 204 }, 'test'));
  for (const status of [400, 403, 404, 429, 500]) {
    assert.throws(() => _test.ensureSuccess({ httpStatus: status, httpBody: 'secret' }, 'test'), GrpcError);
  }
  assert.throws(() => _test.parseJsonOrThrow({ httpStatus: 200, httpBody: ' ' }, 'test'), /empty/);
});

test('GetPodLogs validates and unwraps numeric query parameters', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    await call('Kubernetes_API.Kubernetes_API/GetPodLogs', { namespace: 'default', name: 'nginx-pod', tail_lines: { value: 5 }, since_seconds: { value: 60 } }, { config: { baseUrl } });
    assert.equal(mock.requests.at(-1).query.tailLines, '5');
    assert.equal(mock.requests.at(-1).query.sinceSeconds, '60');
    await assert.rejects(() => call('Kubernetes_API.Kubernetes_API/GetPodLogs', { namespace: 'default', name: 'nginx-pod', tail_lines: 'invalid' }, { config: { baseUrl } }), /tail_lines/);
    await assert.rejects(() => call('Kubernetes_API.Kubernetes_API/GetPodLogs', { namespace: 'default', name: 'nginx-pod', since_seconds: 'invalid' }, { config: { baseUrl } }), /since_seconds/);
  } finally { await mock.close(); }
});
