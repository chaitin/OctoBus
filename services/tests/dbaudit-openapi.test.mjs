import test from 'node:test';
import assert from 'node:assert/strict';
import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  DEFAULT_API_VERSION,
  DEFAULT_TIMEOUT_MS,
  buildAccessSign,
  buildRequestId,
  buildOpenApiUrl,
  callDbauditOpenApi,
  createOpenApiContext,
  normalizeBaseUrl,
} from '../scripts/dbaudit-openapi.js';

const originalFetch = globalThis.fetch;

const authCtx = {
  config: { baseUrl: 'https://api.example.com' },
  secret: { accessKeyId: 'ak', accessKeySecret: 'secret' },
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

const makeJsonResponse = (body, init = {}) => ({
  ok: init.ok ?? true,
  status: init.status ?? 200,
  async json() {
    return body;
  },
  async text() {
    return typeof body === 'string' ? body : JSON.stringify(body);
  },
});

test('normalizeBaseUrl requires HTTP/HTTPS and removes trailing slashes', () => {
  assert.equal(normalizeBaseUrl('https://example.com///'), 'https://example.com');
  assert.equal(normalizeBaseUrl('http://example.com/api/'), 'http://example.com/api');
  assert.throws(
    () => normalizeBaseUrl(''),
    (err) => err instanceof GrpcError && err.code === grpcStatus.INVALID_ARGUMENT && /baseUrl is required/.test(err.message),
  );
  assert.throws(
    () => normalizeBaseUrl(),
    (err) => err instanceof GrpcError && err.code === grpcStatus.INVALID_ARGUMENT && /baseUrl is required/.test(err.message),
  );
  assert.throws(() => normalizeBaseUrl('ftp://example.com'), /baseUrl must start with http or https/);
  assert.throws(() => normalizeBaseUrl('example.com'), /baseUrl must start with http or https/);
});

test('buildOpenApiUrl joins OpenAPI base URL, version, action', () => {
  assert.equal(
    buildOpenApiUrl('https://example.com/', '2.0', 'DescribeSipFilter'),
    'https://example.com/openapi/dbaudit/2.0/DescribeSipFilter.json',
  );
});

test('buildRequestId returns millisecond string', () => {
  assert.equal(buildRequestId(() => 1710000000123), '1710000000123');
});

test('buildAccessSign uses md5(accessTime_accessKeySecret)', () => {
  assert.equal(
    buildAccessSign('1563878730591', '1ea79318cbbb9c63007844379cff85ca0a9967d0'),
    '093860f3262ae18dce10c402210154da',
  );
});

test('createOpenApiContext merges config, secret, bindings and prefers config/secret over bindings when explicit', () => {
  const context = createOpenApiContext({
    config: {
      base_url: 'https://config.example.com///',
      api_version: '2.1',
      timeout_ms: '7000',
    },
    secret: {
      access_key_id: 'secret-ak',
      access_key_secret: 'secret-sk',
    },
    bindings: {
      endpoint: 'https://binding.example.com',
      apiVersion: '3.0',
      accessKeyId: 'binding-ak',
      accessKeySecret: 'binding-sk',
      timeoutMs: 1000,
    },
  });

  assert.deepEqual(context, {
    baseUrl: 'https://config.example.com',
    apiVersion: '2.1',
    accessKeyId: 'secret-ak',
    accessKeySecret: 'secret-sk',
    timeoutMs: 7000,
  });
});

test('GET request encodes data/accessKeyId/accessTime/accessSign as query params', async () => {
  let seenUrl;
  let seenInit;
  globalThis.fetch = async (url, init) => {
    seenUrl = url;
    seenInit = init;
    return makeJsonResponse({ success: true, code: '200', payload: { ok: true } });
  };

  const result = await callDbauditOpenApi({
    ctx: authCtx,
    action: 'DescribeSipFilter',
    data: { keyword: 'a b', enabled: true },
    now: () => 1710000000123,
  });

  assert.deepEqual(result, { success: true, code: '200', payload: { ok: true } });
  const url = new URL(seenUrl);
  assert.equal(url.origin + url.pathname, 'https://api.example.com/openapi/dbaudit/2.0/DescribeSipFilter.json');
  assert.deepEqual(JSON.parse(url.searchParams.get('data')), { keyword: 'a b', enabled: true });
  assert.equal(url.searchParams.get('accessKeyId'), 'ak');
  assert.equal(url.searchParams.get('accessTime'), '1710000000123');
  assert.equal(url.searchParams.get('accessSign'), buildAccessSign('1710000000123', 'secret'));
  assert.equal(seenInit.method, 'GET');
  assert.equal(seenInit.body, undefined);
});

test('POST request encodes x-www-form-urlencoded OpenAPI auth body', async () => {
  let seenUrl;
  let seenInit;
  globalThis.fetch = async (url, init) => {
    seenUrl = url;
    seenInit = init;
    return makeJsonResponse({ success: true, code: '200' });
  };

  await callDbauditOpenApi({
    ctx: authCtx,
    action: 'CreateSipFilter',
    method: 'POST',
    data: { Name: 'rule 1' },
    now: () => 1710000000456,
  });

  assert.equal(seenUrl, 'https://api.example.com/openapi/dbaudit/2.0/CreateSipFilter.json');
  assert.equal(seenInit.method, 'POST');
  assert.equal(seenInit.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.ok(seenInit.body instanceof URLSearchParams);
  assert.deepEqual(JSON.parse(seenInit.body.get('data')), { Name: 'rule 1' });
  assert.equal(seenInit.body.get('accessKeyId'), 'ak');
  assert.equal(seenInit.body.get('accessTime'), '1710000000456');
  assert.equal(seenInit.body.get('accessSign'), buildAccessSign('1710000000456', 'secret'));
});

test('missing OpenAPI credentials throw INVALID_ARGUMENT', async () => {
  await assert.rejects(
    callDbauditOpenApi({ ctx: { config: { baseUrl: 'https://api.example.com' } }, action: 'Ping' }),
    (err) => err instanceof GrpcError && err.code === grpcStatus.INVALID_ARGUMENT && /accessKeyId is required/.test(err.message),
  );
  await assert.rejects(
    callDbauditOpenApi({ ctx: { config: { baseUrl: 'https://api.example.com' }, secret: { accessKeyId: 'ak' } }, action: 'Ping' }),
    (err) => err instanceof GrpcError && err.code === grpcStatus.INVALID_ARGUMENT && /accessKeySecret is required/.test(err.message),
  );
});

test('Network failure maps to UNAVAILABLE', async () => {
  globalThis.fetch = async () => {
    throw new Error('socket closed');
  };

  await assert.rejects(
    callDbauditOpenApi({ ctx: authCtx, action: 'Ping' }),
    (err) => err instanceof GrpcError && err.code === grpcStatus.UNAVAILABLE && /socket closed/.test(err.message),
  );
});

test('HTTP non-2xx maps to UNAVAILABLE with httpStatus/httpBody', async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 502,
    async text() {
      return 'bad gateway';
    },
  });

  await assert.rejects(
    callDbauditOpenApi({ ctx: authCtx, action: 'Ping' }),
    (err) => {
      assert.ok(err instanceof GrpcError);
      assert.equal(err.code, grpcStatus.UNAVAILABLE);
      assert.equal(err.httpStatus, 502);
      assert.equal(err.httpBody, 'bad gateway');
      return true;
    },
  );
});

test("success false or code != '200' maps to FAILED_PRECONDITION", async () => {
  const upstream = { success: false, code: '403', message: '签名校验失败' };
  globalThis.fetch = async () => makeJsonResponse(upstream);

  await assert.rejects(
    callDbauditOpenApi({ ctx: authCtx, action: 'Ping' }),
    (err) => {
      assert.ok(err instanceof GrpcError);
      assert.equal(err.code, grpcStatus.FAILED_PRECONDITION);
      assert.deepEqual(err.upstream, upstream);
      return true;
    },
  );
});

test('Non-JSON response maps to INTERNAL', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async text() {
      return '<html>not json</html>';
    },
  });

  await assert.rejects(
    callDbauditOpenApi({ ctx: authCtx, action: 'Ping' }),
    (err) => err instanceof GrpcError && err.code === grpcStatus.INTERNAL && /non-JSON/.test(err.message),
  );
});

test('response mock with status and text only succeeds', async () => {
  globalThis.fetch = async () => ({
    status: 204,
    async text() {
      return JSON.stringify({ success: true, code: '200', value: 1 });
    },
  });

  const result = await callDbauditOpenApi({
    ctx: authCtx,
    action: 'Ping',
  });

  assert.deepEqual(result, { success: true, code: '200', value: 1 });
});

test('2xx status succeeds even when ok is false', async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 201,
    async text() {
      return JSON.stringify({ success: true, code: '200', created: true });
    },
  });

  const result = await callDbauditOpenApi({
    ctx: authCtx,
    action: 'Ping',
  });

  assert.deepEqual(result, { success: true, code: '200', created: true });
});

test('missing success or code maps to FAILED_PRECONDITION', async () => {
  const upstream = { value: 1 };
  globalThis.fetch = async () => makeJsonResponse(upstream);

  await assert.rejects(
    callDbauditOpenApi({ ctx: authCtx, action: 'Ping' }),
    (err) => {
      assert.ok(err instanceof GrpcError);
      assert.equal(err.code, grpcStatus.FAILED_PRECONDITION);
      assert.deepEqual(err.upstream, upstream);
      return true;
    },
  );
});

test('response text failure maps to UNAVAILABLE', async () => {
  globalThis.fetch = async () => ({
    status: 200,
    async text() {
      throw new Error('body stalled');
    },
  });

  await assert.rejects(
    callDbauditOpenApi({ ctx: authCtx, action: 'Ping' }),
    (err) => err instanceof GrpcError && err.code === grpcStatus.UNAVAILABLE && /body stalled/.test(err.message),
  );
});

test('unsupported method throws INVALID_ARGUMENT', async () => {
  await assert.rejects(
    callDbauditOpenApi({ ctx: authCtx, action: 'Ping', method: 'PUT' }),
    (err) => err instanceof GrpcError && err.code === grpcStatus.INVALID_ARGUMENT,
  );
});

test('exports defaults', () => {
  assert.equal(DEFAULT_API_VERSION, '2.0');
  assert.equal(DEFAULT_TIMEOUT_MS, 5000);
});
