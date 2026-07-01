import test from 'node:test';
import assert from 'node:assert/strict';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  BLOCK_IP_PATH,
  DEFAULT_TIMEOUT_MS,
  METHOD_BLOCK_IP_FULL,
  METHOD_UNBLOCK_IP_FULL,
  UNBLOCK_IP_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/das-gateway-v3.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;

const buildCtx = (overrides = {}) => ({
  bindings: {
    host: 'http://localhost:18081/',
    user: 'user',
    password: 'password',
    ...(overrides.bindings || {}),
  },
  config: overrides.config || {},
  secret: overrides.secret || {},
  limits: { timeoutMs: 2000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const mockRes = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalConsoleLog;
});

test('BlockIP rejects missing config with failed precondition', async () => {
  const ctx = buildCtx({ bindings: { host: '' } });
  const handler = rpcdef(ctx)[BLOCK_IP_PATH];

  await assert.rejects(() => handler({ ips: ['1.1.1.1'] }), (err) => {
    assert.ok(err instanceof GrpcError);
    assert.equal(err.code, grpcStatus.FAILED_PRECONDITION);
    assert.equal(err.legacyCode, 'FAILED_PRECONDITION');
    assert.match(err.message, /host/);
    return true;
  });
});

test('BlockIP maps successful requests to DAS blacklist create API', async () => {
  let captured;
  const logs = [];
  console.log = (...args) => logs.push(args.join(' '));
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return mockRes(200, { code: 1, msg: 'success' });
  };

  const handler = rpcdef(buildCtx())[BLOCK_IP_PATH];
  const res = await handler({ ips: ['1.1.1.1', { value: '2.2.2.2' }, ''] });

  assert.equal(captured.url, 'http://localhost:18081/api/v3/Objects/Blacklist');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers.Authorization, 'Basic dXNlcjpwYXNzd29yZA==');
  assert.equal(Object.hasOwn(captured.init, 'timeoutMs'), false);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(Object.hasOwn(captured.init, 'skipTlsVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'tlsInsecureSkipVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'insecureSkipVerify'), false);
  assert.ok(captured.init.dispatcher);
  assert.deepEqual(JSON.parse(captured.init.body), {
    blist_entry: [
      { blist: '1.1.1.1', age: '-1', reason: 'API Block-IP', enable: '1' },
      { blist: '2.2.2.2', age: '-1', reason: 'API Block-IP', enable: '1' },
    ],
  });
  assert.equal(res.http_status_code, 200);
  assert.deepEqual(JSON.parse(res.http_response_body), { code: 1, msg: 'success' });
  assert.match(logs.join('\n'), /BlockIP/);
});

test('BlockIP treats already-exists responses as success even with non-2xx status', async () => {
  globalThis.fetch = async () => mockRes(409, { code: 0, msg: '该记录已存在' });

  const res = await rpcdef(buildCtx())[BLOCK_IP_PATH]({ ips: ['1.1.1.1'] });

  assert.equal(res.http_status_code, 409);
  assert.match(res.http_response_body, /已存在/);
});

test('BlockIP handles validation and downstream failures', async () => {
  const handler = rpcdef(buildCtx())[BLOCK_IP_PATH];
  await assert.rejects(() => handler({ ips: [] }), /INVALID_ARGUMENT: 待封禁 IP 列表不能为空/);
  await assert.rejects(() => handler({ ips: '1.1.1.1' }), /INVALID_ARGUMENT: 待封禁 IP 列表不能为空/);

  globalThis.fetch = async () => {
    throw new Error('connection refused');
  };
  await assert.rejects(() => handler({ ips: ['1.1.1.1'] }), (err) => {
    assert.equal(err.code, grpcStatus.UNAVAILABLE);
    assert.equal(err.legacyCode, 'UNAVAILABLE');
    assert.deepEqual(err.details, { ips: ['1.1.1.1'], operation: 'BlockIP' });
    return true;
  });

  globalThis.fetch = async () => mockRes(500, { code: 0, msg: 'Internal Error' });
  await assert.rejects(() => handler({ ips: ['1.1.1.1'] }), (err) => {
    assert.equal(err.code, grpcStatus.INTERNAL);
    assert.equal(err.legacyCode, 'INTERNAL');
    assert.equal(err.details.http_status_code, 500);
    return true;
  });
});

test('BlockIP returns plain text bodies for successful non-JSON responses and rejects non-JSON errors', async () => {
  const handler = rpcdef(buildCtx())[BLOCK_IP_PATH];

  globalThis.fetch = async () => mockRes(204, 'accepted');
  const res = await handler({ ips: ['1.1.1.1'] });
  assert.deepEqual(res, { http_status_code: 204, http_response_body: 'accepted' });

  globalThis.fetch = async () => mockRes(502, 'bad gateway');
  await assert.rejects(() => handler({ ips: ['1.1.1.1'] }), (err) => {
    assert.equal(err.code, grpcStatus.UNKNOWN);
    assert.equal(err.legacyCode, 'UNKNOWN');
    assert.equal(err.details.http_response_body, 'bad gateway');
    return true;
  });
});

test('UnblockIP maps successful requests and encodes IP path segments', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return mockRes(200, { code: 1, msg: 'success' });
  };

  const res = await rpcdef(buildCtx({ limits: { timeoutMs: 0 } }))[UNBLOCK_IP_PATH]({ ip: '1.1.1.1/32' });

  assert.equal(captured.url, 'http://localhost:18081/api/v3/Objects/Blacklist/blist/1.1.1.1%2F32');
  assert.equal(captured.init.method, 'DELETE');
  assert.equal(captured.init.body, '{}');
  assert.equal(Object.hasOwn(captured.init, 'timeoutMs'), false);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(res.http_status_code, 200);
});

test('UnblockIP treats code 404 and HTTP 404 as success', async () => {
  const handler = rpcdef(buildCtx())[UNBLOCK_IP_PATH];

  globalThis.fetch = async () => mockRes(200, { code: 404, msg: 'not found' });
  assert.equal((await handler({ ip: '1.1.1.1' })).http_status_code, 200);

  globalThis.fetch = async () => mockRes(404, { code: 0, msg: 'missing' });
  assert.equal((await handler({ ip: '1.1.1.1' })).http_status_code, 404);
});

test('UnblockIP handles validation and downstream failures', async () => {
  const handler = rpcdef(buildCtx())[UNBLOCK_IP_PATH];
  await assert.rejects(() => handler({ ip: ' ' }), /INVALID_ARGUMENT: 待解封 IP 不能为空/);

  globalThis.fetch = async () => {
    throw new Error('network down');
  };
  await assert.rejects(() => handler({ ip: '1.1.1.1' }), (err) => {
    assert.equal(err.code, grpcStatus.UNAVAILABLE);
    assert.equal(err.legacyCode, 'UNAVAILABLE');
    assert.deepEqual(err.details, { ip: '1.1.1.1', operation: 'UnblockIP' });
    return true;
  });

  globalThis.fetch = async () => mockRes(403, { code: 0, msg: 'Forbidden' });
  await assert.rejects(() => handler({ ip: '1.1.1.1' }), (err) => {
    assert.equal(err.code, grpcStatus.INTERNAL);
    assert.equal(err.legacyCode, 'INTERNAL');
    assert.equal(err.details.http_status_code, 403);
    return true;
  });
});

test('UnblockIP covers config errors and non-JSON response branches', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ bindings: { user: '' } }))[UNBLOCK_IP_PATH]({ ip: '1.1.1.1' }),
    /FAILED_PRECONDITION: 配置缺失: user/,
  );
  await assert.rejects(
    () => rpcdef(buildCtx({ bindings: { password: '' } }))[UNBLOCK_IP_PATH]({ ip: '1.1.1.1' }),
    /FAILED_PRECONDITION: 配置缺失: password/,
  );

  const handler = rpcdef(buildCtx())[UNBLOCK_IP_PATH];
  globalThis.fetch = async () => mockRes(204, 'deleted');
  assert.deepEqual(await handler({ ip: '1.1.1.1' }), { http_status_code: 204, http_response_body: 'deleted' });

  globalThis.fetch = async () => mockRes(502, 'bad gateway');
  await assert.rejects(() => handler({ ip: '1.1.1.1' }), (err) => {
    assert.equal(err.code, grpcStatus.UNKNOWN);
    assert.equal(err.legacyCode, 'UNKNOWN');
    assert.equal(err.details.operation, 'UnblockIP');
    return true;
  });
});

test('SDK handlers use config and secret fields', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return mockRes(200, { code: 1, msg: 'success' });
  };

  const blockRes = await handlers[METHOD_BLOCK_IP_FULL]({
    config: {
      endpoint: 'https://das.example.local/',
      timeout_ms: 3100,
    },
    secret: {
      username: 'api-user',
      password: 'api-pass',
    },
    req: {
      ips: ['10.0.0.1'],
    },
  });

  assert.equal(blockRes.http_status_code, 200);
  assert.equal(captured.url, 'https://das.example.local/api/v3/Objects/Blacklist');
  assert.equal(captured.init.headers.Authorization, 'Basic YXBpLXVzZXI6YXBpLXBhc3M=');
  assert.equal(Object.hasOwn(captured.init, 'timeoutMs'), false);
  assert.ok(captured.init.signal instanceof AbortSignal);

  const unblockRes = await handlers[METHOD_UNBLOCK_IP_FULL]({
    config: {
      base_url: 'https://das.example.local',
      user: 'api-user',
    },
    secret: {
      password: 'api-pass',
    },
    request: {
      ip: '10.0.0.1',
    },
  });

  assert.equal(unblockRes.http_status_code, 200);
  assert.equal(captured.url, 'https://das.example.local/api/v3/Objects/Blacklist/blist/10.0.0.1');
});

test('service wrapper exposes the SDK handler map', () => {
  assert.deepEqual(Object.keys(service.handlers), [METHOD_BLOCK_IP_FULL, METHOD_UNBLOCK_IP_FULL]);
  assert.equal(service.handlers[METHOD_BLOCK_IP_FULL], handlers[METHOD_BLOCK_IP_FULL]);
  assert.equal(service.handlers[METHOD_UNBLOCK_IP_FULL], handlers[METHOD_UNBLOCK_IP_FULL]);
});

test('helper utilities cover aliases, metadata, and unsupported methods', async () => {
  const logs = [];
  console.log = (...args) => logs.push(args.join(' '));
  _test.logFlow({ meta: { instanceId: 'camel-inst', requestId: 'camel-req' } }, 'Test', { ok: true });
  const circular = {};
  circular.self = circular;
  _test.logFlow({ meta: {} }, 'TestRaw', circular);
  assert.match(logs.join('\n'), /camel-inst/);
  assert.match(logs.join('\n'), /\[object Object\]/);

  assert.equal(_test.base64Encode('user:password'), 'dXNlcjpwYXNzd29yZA==');
  assert.equal(_test.base64Encode('user:password', { forceFallback: true }), 'dXNlcjpwYXNzd29yZA==');
  assert.throws(() => _test.base64Encode('中文'), /Latin1 range|Invalid character/);
  assert.equal(_test.trimString({ value: ' text ' }), 'text');
  assert.equal(_test.stripTrailingSlash('https://example/'), 'https://example');
  assert.equal(_test.normalizeTimeoutMs('bad'), DEFAULT_TIMEOUT_MS);
  assert.deepEqual(_test.normalizeIpList([{ value: '1.1.1.1' }, '', '2.2.2.2']), ['1.1.1.1', '2.2.2.2']);
  assert.deepEqual(_test.mergedBindings({
    config: { host: 'config' },
    secret: { user: 'secret' },
    bindings: { user: 'binding' },
  }), {
    host: 'config',
    user: 'binding',
  });
  assert.deepEqual(_test.resolveCallContext({ request: { ip: '1.1.1.1' }, meta: null }), {
    bindings: {},
    limits: {},
    meta: {},
    req: { ip: '1.1.1.1' },
  });
  assert.throws(() => _test.wrapLegacyHandler({}, '/missing.Method/Call'), /UNKNOWN: unsupported method/);
  assert.equal(_test.errorWithCode('NOT_MAPPED', 'fallback').code, grpcStatus.UNKNOWN);
  assert.equal(_test.getAuthHeader({ user: 'u', password: 'p' }), 'Basic dTpw');
  assert.equal(_test.getConfig({
    bindings: {
      baseUrl: 'https://base.example/',
      username: 'name',
      pass: 'secret',
    },
  }).host, 'https://base.example');
});
