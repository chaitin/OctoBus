import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_BLOCK_DOMAIN_FULL,
  METHOD_BLOCK_DOMAIN_PATH,
  METHOD_UNBLOCK_DOMAIN_FULL,
  METHOD_UNBLOCK_DOMAIN_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/threatbook-tdp.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const originalLog = console.log;

const fixedNow = () => {
  Date.now = () => 1700000000000;
};

const response = (status, body) => ({
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const setFetch = (impl) => {
  globalThis.fetch = impl;
};

const abortingFetch = (message = 'request aborted') => (_url, init) => new Promise((resolve, reject) => {
  const abort = () => reject(new Error(message));
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener('abort', abort, { once: true });
});

const buildCtx = (overrides = {}) => ({
  config: {
    restBaseUrl: 'https://tdp.example.com',
    ...(overrides.config || {}),
  },
  secret: {
    api_key: 'test_api_key',
    secret: 'test_secret',
    ...(overrides.secret || {}),
  },
  bindings: {
    headers: { 'X-Product': 'miner' },
    ...(overrides.bindings || {}),
  },
  limits: { timeoutMs: 3000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const callHandler = (method, request = {}, ctx = {}) => {
  const handler = handlers[method];
  return handler({ ...ctx, request });
};

const expectGrpcError = async (fn, legacyCode, checker = () => {}) => {
  let caught;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'expected function to reject');
  assert.ok(caught instanceof GrpcError);
  assert.equal(caught.legacyCode, legacyCode);
  assert.equal(caught.code, ({
    FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
    INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
    PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
    UNKNOWN: grpcStatus.UNKNOWN,
  })[legacyCode]);
  checker(caught);
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  console.log = originalLog;
});

test('service exports handlers and rpcdef paths', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers[METHOD_BLOCK_DOMAIN_FULL], 'function');
  assert.equal(typeof handlers[METHOD_UNBLOCK_DOMAIN_FULL], 'function');
  const defs = rpcdef(buildCtx());
  assert.equal(typeof defs[METHOD_BLOCK_DOMAIN_PATH], 'function');
  assert.equal(typeof defs[METHOD_UNBLOCK_DOMAIN_PATH], 'function');
});

test('BlockDomain signs URL and sends add payload with explicit remark', async () => {
  fixedNow();
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return response(200, {
      response_code: 0,
      response_message: 'Success',
      data: { operated_count: 2 },
    });
  });

  const result = await callHandler(METHOD_BLOCK_DOMAIN_FULL,
    { ioc_list: ['bad.example', { value: 'evil.example' }], remark: { value: 'manual' } },
    buildCtx({ bindings: { skipTlsVerify: true } }),
  );

  const url = new URL(captured.url);
  const expectedSign = crypto.createHmac('sha256', 'test_secret')
    .update('test_api_key1700000000')
    .digest('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/g, '');
  assert.equal(`${url.origin}${url.pathname}`, 'https://tdp.example.com/api/v1/linkage_block/deny_list/operate');
  assert.equal(url.searchParams.get('api_key'), 'test_api_key');
  assert.equal(url.searchParams.get('auth_timestamp'), '1700000000');
  assert.equal(url.searchParams.get('sign'), expectedSign);
  assert.equal(captured.init.method, 'POST');
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.init.timeoutMs, undefined);
  assert.equal(captured.init.dispatcher, _test.insecureTlsDispatcher);
  assert.equal(captured.init.insecureSkipVerify, undefined);
  assert.equal(captured.init.tlsInsecureSkipVerify, undefined);
  assert.equal(captured.init.skipTlsVerify, undefined);
  assert.equal(captured.init.headers['Content-Type'], 'application/json;charset=UTF-8');
  assert.equal(captured.init.headers['X-Product'], 'miner');
  assert.deepEqual(captured.body, {
    block_direction: 'out',
    operate: 'add',
    ioc_list: ['bad.example', 'evil.example'],
    remark: 'manual',
  });
  assert.deepEqual(result.data.structValue.fields.data.structValue.fields.operated_count, { numberValue: 2 });
});

test('UnblockDomain sends delete payload and default remark', async () => {
  fixedNow();
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), body: JSON.parse(init.body) };
    return response(201, { response_code: 0, response_message: 'Success', data: { operated_count: 1 } });
  });

  const result = await callHandler(METHOD_UNBLOCK_DOMAIN_FULL,
    { iocList: { values: ['bad.example'] } },
    buildCtx({ config: { restBaseUrl: undefined, baseUrl: ' http://tdp.local/ ' }, secret: { api_key: undefined, apiKey: 'test_api_key' } }),
  );

  const url = new URL(captured.url);
  assert.equal(`${url.origin}${url.pathname}`, 'http://tdp.local/api/v1/linkage_block/deny_list/operate');
  assert.deepEqual(captured.body, {
    block_direction: 'out',
    operate: 'delete',
    ioc_list: ['bad.example'],
    remark: 'bad.example,万象联动封禁',
  });
  assert.deepEqual(result.data.structValue.fields.response_message, { stringValue: 'Success' });
});

test('default remark includes count for multiple domains', () => {
  assert.equal(_test.normalizeRemark({}, ['a.com']), 'a.com,万象联动封禁');
  assert.equal(_test.normalizeRemark({}, ['a.com', 'b.com']), 'a.com 等2个域名,万象联动封禁');
  assert.equal(_test.normalizeRemark({ Remark: { value: ' custom ' } }, ['a.com']), 'custom');
});

test('validates bindings and ioc list', async () => {
  await expectGrpcError(
    () => callHandler(METHOD_BLOCK_DOMAIN_FULL, { ioc_list: ['a.com'] }, buildCtx({ config: { restBaseUrl: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /restBaseUrl/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_BLOCK_DOMAIN_FULL, { ioc_list: ['a.com'] }, buildCtx({ secret: { api_key: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /api_key/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_BLOCK_DOMAIN_FULL, { ioc_list: ['a.com'] }, buildCtx({ secret: { secret: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /secret/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_BLOCK_DOMAIN_FULL, {}, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /ioc_list/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_BLOCK_DOMAIN_FULL, { ioc_list: ['', ' '] }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /ioc_list/),
  );
});

test('maps upstream transport and response failures', async () => {
  setFetch(async () => {
    throw Object.assign(new Error('outer'), { cause: new Error('connection refused') });
  });
  await expectGrpcError(
    () => callHandler(METHOD_BLOCK_DOMAIN_FULL, { ioc_list: ['a.com'] }, buildCtx()),
    'UNAVAILABLE',
    (err) => assert.match(err.message, /connection refused/),
  );

  for (const [status, legacyCode] of [[401, 'PERMISSION_DENIED'], [403, 'PERMISSION_DENIED'], [400, 'FAILED_PRECONDITION'], [404, 'FAILED_PRECONDITION'], [429, 'FAILED_PRECONDITION'], [500, 'UNAVAILABLE'], [302, 'UNAVAILABLE']]) {
    setFetch(async () => response(status, `status-${status}`));
    await expectGrpcError(
      () => callHandler(METHOD_BLOCK_DOMAIN_FULL, { ioc_list: ['a.com'] }, buildCtx()),
      legacyCode,
      (err) => assert.match(err.message, new RegExp(`upstream http ${status}`)),
    );
  }

  setFetch(async () => response(200, 'NOT_A_JSON!'));
  await expectGrpcError(
    () => callHandler(METHOD_BLOCK_DOMAIN_FULL, { ioc_list: ['a.com'] }, buildCtx()),
    'UNKNOWN',
    (err) => assert.match(err.message, /valid JSON/),
  );

  setFetch(async () => ({
    status: 200,
    text: async () => {
      throw new Error('read failed');
    },
  }));
  await expectGrpcError(
    () => callHandler(METHOD_BLOCK_DOMAIN_FULL, { ioc_list: ['a.com'] }, buildCtx()),
    'UNAVAILABLE',
    (err) => assert.match(err.message, /read failed/),
  );

  setFetch(abortingFetch('timeout waiting for test_api_key'));
  await expectGrpcError(
    () => callHandler(METHOD_BLOCK_DOMAIN_FULL, { ioc_list: ['a.com'] }, buildCtx({ limits: { timeoutMs: 1 } })),
    'UNAVAILABLE',
    (err) => {
      assert.match(err.message, /timeout/);
      assert.doesNotMatch(err.message, /test_api_key/);
    },
  );
});

test('maps successful HTTP business errors', async () => {
  setFetch(async () => response(200, { response_code: -1, response_message: 'bad test_api_key' }));
  await expectGrpcError(
    () => callHandler(METHOD_BLOCK_DOMAIN_FULL, { ioc_list: ['a.com'] }, buildCtx()),
    'FAILED_PRECONDITION',
    (err) => {
      assert.match(err.message, /response_code=-1/);
      assert.doesNotMatch(err.message, /test_api_key/);
    },
  );
});

test('request cannot override secrets and logs/errors redact API key material', async () => {
  fixedNow();
  const logs = [];
  let capturedUrl;
  console.log = (...args) => logs.push(args.map((arg) => String(arg)).join(' '));
  setFetch(async (url) => {
    capturedUrl = String(url);
    const parsed = new URL(capturedUrl);
    return response(403, `api_key=test_api_key&sign=${parsed.searchParams.get('sign')}&secret=test_secret`);
  });

  await expectGrpcError(
    () => callHandler(METHOD_BLOCK_DOMAIN_FULL, {
      ioc_list: ['a.com'],
      api_key: 'request_key',
      apiKey: 'request_key',
      secret: 'request_secret',
    }, buildCtx()),
    'PERMISSION_DENIED',
    (err) => {
      assert.match(err.message, /upstream http 403/);
      assert.doesNotMatch(err.message, /test_api_key|test_secret|request_key|request_secret/);
    },
  );

  const url = new URL(capturedUrl);
  assert.equal(url.searchParams.get('api_key'), 'test_api_key');
  assert.ok(url.searchParams.get('sign'));
  assert.doesNotMatch(logs.join('\n'), /test_api_key|test_secret|request_key|request_secret/);
});

test('success with empty body returns null data', async () => {
  setFetch(async () => response(204, ''));
  const result = await callHandler(METHOD_BLOCK_DOMAIN_FULL, { ioc_list: ['a.com'] }, buildCtx());
  assert.deepEqual(result, { data: null });
});

test('rpcdef falls back to context request', async () => {
  setFetch(async () => response(200, { response_code: 0, data: { operated_count: 1 } }));
  const result = await rpcdef(buildCtx({ req: { ioc_list: ['ctx.example'] } }))[METHOD_BLOCK_DOMAIN_PATH]();
  assert.deepEqual(result.data.structValue.fields.data.structValue.fields.operated_count, { numberValue: 1 });
});

test('helper functions cover normalization, signing, values, and logging branches', () => {
  fixedNow();
  assert.equal(_test.grpcCodeFor('NOPE'), grpcStatus.UNKNOWN);
  assert.equal(_test.errorWithCode('NOPE', 'bad').code, grpcStatus.UNKNOWN);
  assert.equal(_test.hasOwn(null, 'x'), false);
  assert.equal(_test.firstDefined(undefined, null, 0, 'x'), 0);
  assert.equal(_test.unwrapScalar({ value: { value: 'nested' } }), 'nested');
  assert.equal(_test.trimString(null), '');
  assert.equal(_test.extractList(['a']).length, 1);
  assert.deepEqual(_test.extractList({ values: ['a', { value: 'b' }] }), ['a', { value: 'b' }]);
  assert.deepEqual(_test.extractList('bad'), []);
  assert.equal(_test.normalizeBaseUrl('ftp://bad'), null);
  assert.equal(_test.normalizeBaseUrl(' https://api.local/// '), 'https://api.local');
  assert.equal(_test.toBoolean(true), true);
  assert.equal(_test.toBoolean(1), true);
  assert.equal(_test.toBoolean(0), false);
  assert.equal(_test.toBoolean('yes'), true);
  assert.equal(_test.toBoolean('off'), false);
  assert.equal(_test.toBoolean('maybe'), false);
  assert.equal(_test.sanitizeSensitiveText('api_key=key&sign=s body secret', ['secret']), 'api_key=***&sign=*** body ***');
  assert.deepEqual(_test.mergedBindings({ config: { a: 1 }, secret: { b: 2 }, bindings: { a: 3 } }), { a: 3, b: 2 });
  assert.deepEqual(_test.resolveCallContext({ request: { ioc_list: ['a'] } }).req, { ioc_list: ['a'] });
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: 'bad' }, bindings: { timeoutMs: 10 } }), 2000);
  assert.equal(_test.resolveTimeoutMs({ limits: {}, bindings: { timeoutMs: 10 } }), 10);
  assert.equal(_test.computeTimestampSeconds(), 1700000000);
  assert.equal(_test.generateHmacSha256Signature('key', 'secret', 1), crypto.createHmac('sha256', 'secret').update('key1').digest('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, ''));
  const built = _test.buildOperateUrl({ baseUrl: 'https://api.local', apiKey: 'key', secret: 'secret', timestampSec: 1 });
  assert.match(built.url, /^https:\/\/api\.local\/api\/v1\/linkage_block\/deny_list\/operate\?api_key=key&auth_timestamp=1&sign=/);
  assert.equal(_test.normalizeBindings({ baseUrl: 'http://api.local', apiKey: 'key', Secret: 'secret', skipTlsVerify: 'yes' }).skipTlsVerify, true);
  assert.deepEqual(_test.normalizeIocList({ iocList: { values: [{ value: ' a.com ' }, 'b.com'] } }), ['a.com', 'b.com']);
  assert.deepEqual(_test.prepareRuntime(buildCtx()).bindings.baseUrl, 'https://tdp.example.com');
  assert.deepEqual(_test.toValue(null), undefined);
  assert.deepEqual(_test.toValue(Number.NaN), { stringValue: 'NaN' });
  assert.deepEqual(_test.toValue([1, null, 'x']), {
    listValue: { values: [{ numberValue: 1 }, { stringValue: 'x' }] },
  });
  assert.deepEqual(_test.toValue({ a: null }).structValue.fields.a, { nullValue: 'NULL_VALUE' });
  assert.deepEqual(_test.toValue(Symbol.for('x')), { stringValue: 'Symbol(x)' });
  assert.deepEqual(_test.parseSuccessBody('{"ok":true}', {}, 'Action', 200).data, { structValue: { fields: { ok: { boolValue: true } } } });

  const circular = {};
  circular.self = circular;
  const logs = [];
  console.log = (...args) => logs.push(args);
  _test.logFlow({ instanceId: 'i', requestId: 'r' }, 'Action', { ok: true });
  _test.logFlow({}, 'Fallback', circular);
  assert.match(logs[0][0], /\[ThreatBook_TDP\]\[Action\]\[inst=i req=r\]/);
  assert.match(logs[1][0], /\[ThreatBook_TDP\]\[Fallback\]/);
});

test('mock upstream handles block, unblock, and failure cases', async () => {
  fixedNow();
  const server = await createMockServer();
  try {
    const ctx = buildCtx({ config: { restBaseUrl: server.url } });
    const block = await callHandler(METHOD_BLOCK_DOMAIN_FULL, { ioc_list: ['test.com', 'test2.com'], remark: 'Test Block' }, ctx);
    const unblock = await callHandler(METHOD_UNBLOCK_DOMAIN_FULL, { ioc_list: ['test.com'] }, ctx);
    assert.deepEqual(block.data.structValue.fields.data.structValue.fields.operated_count, { numberValue: 2 });
    assert.deepEqual(unblock.data.structValue.fields.data.structValue.fields.operate, { stringValue: 'delete' });
    assert.equal(server.requests[0].body.operate, 'add');
    assert.equal(server.requests[1].body.operate, 'delete');

    await expectGrpcError(() => callHandler(METHOD_BLOCK_DOMAIN_FULL, { ioc_list: ['400.com'] }, ctx), 'FAILED_PRECONDITION');
    await expectGrpcError(() => callHandler(METHOD_BLOCK_DOMAIN_FULL, { ioc_list: ['500.com'] }, ctx), 'UNAVAILABLE');
    await expectGrpcError(() => callHandler(METHOD_BLOCK_DOMAIN_FULL, { ioc_list: ['badjson.com'] }, ctx), 'UNKNOWN');
    await expectGrpcError(
      () => callHandler(METHOD_BLOCK_DOMAIN_FULL, { ioc_list: ['test.com'] }, buildCtx({ config: { restBaseUrl: server.url }, secret: { api_key: 'wrong_key' } })),
      'PERMISSION_DENIED',
    );
    const empty = await callHandler(METHOD_BLOCK_DOMAIN_FULL, { ioc_list: ['empty.com'] }, ctx);
    assert.deepEqual(empty, { data: null });
  } finally {
    await server.close();
  }
});
