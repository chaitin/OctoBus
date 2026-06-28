import test from 'node:test';
import assert from 'node:assert/strict';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_GET_CURRENT_TIME_FULL,
  METHOD_LIST_HOSTS_FULL,
  METHOD_GET_HOST_DETAIL_FULL,
  METHOD_LIST_MALWARE_EVENTS_FULL,
  _test,
  handlers,
  rpcdef,
} from '../src/cloudwalker.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;

const okResponse = (body) => ({
  ok: true,
  status: 200,
  text: async () => body,
});

const responseWithStatus = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
});

const buildCtx = (overrides = {}) => ({
  bindings: {
    endpoint: 'https://cloudwalker.example.com/',
    apiToken: 'token-123',
    orgId: '42',
    ...(overrides.bindings || {}),
  },
  config: overrides.config || {},
  secret: overrides.secret || {},
  limits: { timeoutMs: 15_000, ...(overrides.limits || {}) },
  meta: { request_id: 'req-1', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('_test helpers: normalizeEndpoint accepts http(s) and trims trailing slashes', () => {
  assert.equal(_test.normalizeEndpoint('https://example.com/'), 'https://example.com');
  assert.equal(_test.normalizeEndpoint('http://example.com///'), 'http://example.com');
  assert.equal(_test.normalizeEndpoint('ftp://example.com'), null);
  assert.equal(_test.normalizeEndpoint(''), null);
});

test('_test helpers: unwrapValue supports protobuf wrapper objects', () => {
  assert.equal(_test.unwrapValue({ value: 5 }), 5);
  assert.equal(_test.unwrapValue('x'), 'x');
  assert.equal(_test.unwrapValue(undefined), undefined);
});

test('_test helpers: resolveProxyUrl supports config aliases', () => {
  assert.equal(_test.resolveProxyUrl({ proxyUrl: 'http://127.0.0.1:6152' }), 'http://127.0.0.1:6152');
  assert.equal(_test.resolveProxyUrl({ proxy_url: 'http://proxy.example' }), 'http://proxy.example');
  assert.equal(_test.resolveProxyUrl({}), '');
});

test('rpcdef sends CloudWalker JSON-RPC request with API token cookie and org header', async () => {
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return okResponse(JSON.stringify({
      jsonrpc: '2.0',
      id: 'req-1',
      result: { time: 1710000000 },
    }));
  };

  const result = await rpcdef(buildCtx({ req: {} }))[METHOD_GET_CURRENT_TIME_FULL]({});

  assert.equal(captured.url, 'https://cloudwalker.example.com/rpc');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.headers['Content-Type'], 'application/json');
  assert.equal(captured.options.headers.Cookie, 'API-Token=token-123');
  assert.equal(captured.options.headers['X-CW-OID'], '42');
  assert.deepEqual(JSON.parse(captured.options.body), {
    jsonrpc: '2.0',
    method: 'CloudwalkerSettingService.GetCurrentTime',
    params: {},
    id: 'req-1',
  });
  assert.deepEqual(result, {
    http_status: 200,
    raw_body: JSON.stringify({ jsonrpc: '2.0', id: 'req-1', result: { time: 1710000000 } }),
    result: { time: 1710000000 },
  });
});

test('handlers accept OctoBus runtime context shape', async () => {
  let body;
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return okResponse(JSON.stringify({
      jsonrpc: '2.0',
      id: 'runtime-ctx',
      result: { current_time: 1710000000 },
    }));
  };

  const result = await handlers[METHOD_GET_CURRENT_TIME_FULL]({
    request: {},
    config: { endpoint: 'https://cloudwalker.example.com' },
    secret: { apiToken: 'runtime-token' },
    metadata: { get: () => ['runtime-ctx'] },
  });

  assert.equal(body.method, 'CloudwalkerSettingService.GetCurrentTime');
  assert.deepEqual(result.result, { current_time: 1710000000 });
});


test('rpcdef maps list request wrappers and filters into JSON-RPC params', async () => {
  let body;
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return okResponse(JSON.stringify({
      jsonrpc: '2.0',
      id: 'req-1',
      result: { data: [{ id: 1 }], total: 1 },
    }));
  };

  const result = await rpcdef(buildCtx({
    req: {
      count: { value: 20 },
      offset: { value: 40 },
      filters: { ip: '10.0.0.1' },
    },
  }))[METHOD_LIST_HOSTS_FULL]({});

  assert.equal(body.method, 'HostAssetService.GetHostAssetList');
  assert.deepEqual(body.params, { count: 20, offset: 40, ip: '10.0.0.1' });
  assert.deepEqual(result.result, { data: [{ id: 1 }], total: 1 });
});

test('rpcdef requires host id for GetHostDetail', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: {} }))[METHOD_GET_HOST_DETAIL_FULL]({}),
    (err) => err instanceof GrpcError && err.code === grpcStatus.INVALID_ARGUMENT,
  );
});

test('rpcdef maps JSON-RPC error response to GrpcError', async () => {
  globalThis.fetch = async () => okResponse(JSON.stringify({
    jsonrpc: '2.0',
    id: 'req-1',
    error: { code: -32602, message: 'bad params' },
  }));

  await assert.rejects(
    () => rpcdef(buildCtx({ req: {} }))[METHOD_LIST_MALWARE_EVENTS_FULL]({}),
    (err) => err instanceof GrpcError && err.code === grpcStatus.UNKNOWN && /bad params/.test(err.message),
  );
});

test('rpcdef maps HTTP error response to UNAVAILABLE', async () => {
  globalThis.fetch = async () => responseWithStatus(503, 'unavailable');

  await assert.rejects(
    () => rpcdef(buildCtx({ req: {} }))[METHOD_LIST_HOSTS_FULL]({}),
    (err) => err instanceof GrpcError && err.code === grpcStatus.UNAVAILABLE && /503/.test(err.message),
  );
});

test('handlers and service expose CloudWalker RPCs', () => {
  assert.equal(typeof handlers[METHOD_LIST_HOSTS_FULL], 'function');
  assert.equal(typeof handlers[METHOD_GET_HOST_DETAIL_FULL], 'function');
  assert.ok(service);
});
