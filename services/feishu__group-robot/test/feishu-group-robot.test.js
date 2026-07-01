import test from 'node:test';
import assert from 'node:assert/strict';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_SEND_TEXT_FULL,
  METHOD_SEND_TEXT_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/feishu-group-robot.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;

const buildCtx = (overrides = {}) => ({
  bindings: {
    headers: {},
    ...(overrides.bindings || {}),
  },
  config: overrides.config || {},
  secret: {
    webhook: 'http://localhost:18080/open-apis/bot/v2/hook/test-token',
    ...(overrides.secret || {}),
  },
  limits: { timeoutMs: 10_000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const mockResponse = (status, body) => ({
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalConsoleLog;
});

test('SendTextMessage requires webhook binding and message', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ secret: { webhook: '' }, req: { message: 'test' } }))[METHOD_SEND_TEXT_PATH](),
    (err) => {
      assert.ok(err instanceof GrpcError);
      assert.equal(err.code, grpcStatus.INVALID_ARGUMENT);
      assert.equal(err.legacyCode, 'INVALID_ARGUMENT');
      assert.match(err.message, /webhook is required/);
      return true;
    },
  );
  await assert.rejects(
    () => rpcdef(buildCtx({ secret: { webhook: 'invalid-url' }, req: { message: 'test' } }))[METHOD_SEND_TEXT_PATH](),
    /webhook is required/,
  );
  await assert.rejects(
    () => rpcdef(buildCtx({ secret: { webhook: '   ' }, req: { message: 'test' } }))[METHOD_SEND_TEXT_PATH](),
    /webhook is required/,
  );
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { message: '' } }))[METHOD_SEND_TEXT_PATH](),
    /message is required/,
  );
  await assert.rejects(
    () => rpcdef(buildCtx({ req: {} }))[METHOD_SEND_TEXT_PATH](),
    /message is required/,
  );
});

test('SendTextMessage sends correct payload and returns status 200 response', async () => {
  let captured;
  const logs = [];
  console.log = (...args) => logs.push(args.join(' '));
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return mockResponse(200, { StatusCode: 0, StatusMessage: 'success' });
  };

  const res = await rpcdef(buildCtx({ req: { message: 'test message' } }))[METHOD_SEND_TEXT_PATH]();

  assert.equal(captured.url, 'http://localhost:18080/open-apis/bot/v2/hook/test-token');
  assert.equal(captured.init.method, 'POST');
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.init.timeoutMs, undefined);
  assert.equal(captured.init.headers['Content-Type'], 'application/json');
  assert.equal(captured.init.headers['User-Agent'], 'chaitin-cosmos');
  assert.equal(captured.init.headers['x-engine-instance'], 'inst');
  assert.equal(captured.init.headers['x-request-id'], 'req');
  assert.deepEqual(JSON.parse(captured.init.body), {
    msg_type: 'text',
    content: { text: 'test message' },
  });
  assert.equal(res.http_status, 200);
  assert.equal(res.http_body, '');
  assert.match(logs.join('\n'), /\/hook\/\*\*\*/);
  assert.doesNotMatch(logs.join('\n'), /test-token/);
});

test('SendTextMessage accepts status 209 and 210 as success', async () => {
  globalThis.fetch = async () => mockResponse(209, { StatusCode: 0, StatusMessage: 'success with 209' });
  const res209 = await rpcdef(buildCtx({ req: { message: 'test' } }))[METHOD_SEND_TEXT_PATH]();
  assert.equal(res209.http_status, 209);
  assert.equal(res209.http_body, '');

  globalThis.fetch = async () => mockResponse(210, { StatusCode: 0, StatusMessage: 'success with 210' });
  const res210 = await rpcdef(buildCtx({ req: { message: 'test' } }))[METHOD_SEND_TEXT_PATH]();
  assert.equal(res210.http_status, 210);
  assert.equal(res210.http_body, '');
});

test('SendTextMessage rejects non-success HTTP statuses', async () => {
  for (const status of [400, 401, 500]) {
    globalThis.fetch = async () => mockResponse(status, { StatusCode: status, StatusMessage: 'error' });
    await assert.rejects(
      () => rpcdef(buildCtx({ req: { message: 'test' } }))[METHOD_SEND_TEXT_PATH](),
      (err) => {
        assert.equal(err.code, grpcStatus.UNAVAILABLE);
        assert.equal(err.legacyCode, 'UNAVAILABLE');
        assert.match(err.message, new RegExp(`upstream http ${status}`));
        return true;
      },
    );
  }
});

test('business error and non-JSON body are preserved on successful HTTP status', async () => {
  globalThis.fetch = async () => mockResponse(200, { StatusCode: 10003, StatusMessage: 'token is invalid' });
  const businessRes = await rpcdef(buildCtx({ req: { message: 'test' } }))[METHOD_SEND_TEXT_PATH]();
  assert.equal(businessRes.http_body, '');

  globalThis.fetch = async () => mockResponse(200, 'OK');
  const textRes = await rpcdef(buildCtx({ req: { message: 'test' } }))[METHOD_SEND_TEXT_PATH]();
  assert.equal(textRes.http_status, 200);
  assert.equal(textRes.http_body, '');
});

test('network failures map to UNAVAILABLE', async () => {
  globalThis.fetch = async () => {
    throw Object.assign(new Error('network error'), { cause: new Error('socket hangup') });
  };
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { message: 'test' } }))[METHOD_SEND_TEXT_PATH](),
    /socket hangup/,
  );

  globalThis.fetch = async () => {
    throw new Error('connection refused');
  };
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { message: 'test' } }))[METHOD_SEND_TEXT_PATH](),
    /connection refused/,
  );
});

test('response read failures map to UNAVAILABLE with sanitized details', async () => {
  globalThis.fetch = async () => ({
    status: 200,
    text: async () => {
      throw new Error('read failed');
    },
  });

  await assert.rejects(
    () => rpcdef(buildCtx({ req: { message: 'test' } }))[METHOD_SEND_TEXT_PATH](),
    (err) => {
      assert.equal(err.code, grpcStatus.UNAVAILABLE);
      assert.equal(err.legacyCode, 'UNAVAILABLE');
      assert.equal(err.httpStatus, 200);
      assert.equal(err.httpBody, '');
      assert.equal(err.httpBodyLength, 0);
      assert.match(err.message, /read failed/);
      return true;
    },
  );
});

test('message aliases, trimming, custom headers, and TLS flags map correctly', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return mockResponse(200, { StatusCode: 0, StatusMessage: 'success' });
  };

  await rpcdef(buildCtx({
    secret: {
      webhook: '',
      webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/token',
    },
    bindings: {
      webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/legacy-token',
      headers: { 'X-Custom': 'value' },
      skipTlsVerify: true,
    },
    limits: { timeoutMs: 0 },
    meta: { instance_id: '', request_id: '', instanceId: 'my-instance', requestId: 'my-request' },
    req: { send_msg: '  trimmed message  ' },
  }))[METHOD_SEND_TEXT_PATH]();

  assert.equal(captured.url, 'https://open.feishu.cn/open-apis/bot/v2/hook/token');
  assert.equal(captured.init.headers['X-Custom'], 'value');
  assert.equal(captured.init.headers['x-engine-instance'], 'my-instance');
  assert.equal(captured.init.headers['x-request-id'], 'my-request');
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.init.timeoutMs, undefined);
  assert.equal(captured.init.dispatcher, _test.insecureTlsDispatcher);
  assert.equal(captured.init.skipTlsVerify, undefined);
  assert.equal(captured.init.tlsInsecureSkipVerify, undefined);
  assert.equal(JSON.parse(captured.init.body).content.text, 'trimmed message');
});

test('SDK handler merges config and uses request alias', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return mockResponse(200, { StatusCode: 0, StatusMessage: 'success' });
  };

  const res = await handlers[METHOD_SEND_TEXT_FULL]({
    config: {
      timeout_ms: 3100,
    },
    secret: {
      webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/sdk-token',
    },
    request: {
      text: 'from sdk',
      webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/request-token',
    },
  });

  assert.equal(res.http_status, 200);
  assert.equal(captured.url, 'https://open.feishu.cn/open-apis/bot/v2/hook/sdk-token');
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.init.timeoutMs, undefined);
  assert.equal(JSON.parse(captured.init.body).content.text, 'from sdk');
  assert.ok(service);
});

test('helper defaults and logger fallback are stable', async () => {
  globalThis.fetch = async () => mockResponse(200, { StatusCode: 0, StatusMessage: 'success' });
  const res = await rpcdef(buildCtx({ req: { message: 'default request' } }))[METHOD_SEND_TEXT_PATH]();
  assert.equal(res.http_status, 200);

  assert.equal(_test.normalizeWebhook('http://example'), 'http://example');
  assert.equal(_test.normalizeWebhook('ftp://example'), '');
  assert.equal(_test.resolveBindingString({ webhook: '', url: { value: 'https://url' } }, ['webhook', 'url']), 'https://url');
  assert.equal(_test.coerceString({ value: { value: 'nested' } }), 'nested');
  assert.equal(_test.hasOwn(null, 'x'), false);
  assert.equal(_test.firstDefined(undefined, null, 'x'), 'x');
  assert.deepEqual(_test.mergedBindings({ config: { a: 1, webhook: 'config' }, secret: { b: 2, webhook: 'secret' }, bindings: { c: 3, webhook: 'binding' } }), { a: 1, b: 2, c: 3, webhook: 'secret' });
  assert.equal(_test.resolveWebhook({ request: { webhook: 'request' }, secret: { webhook: 'secret' }, config: { webhook: 'config' }, bindings: { webhook: 'binding' } }), 'secret');
  assert.equal(_test.resolveWebhook({ secret: {}, config: { webhook: 'config' }, bindings: { webhook: 'binding' } }), 'config');
  assert.equal(_test.resolveWebhook({ secret: {}, config: {}, bindings: { webhook: 'binding' } }), 'binding');
  assert.deepEqual(_test.resolveCallContext({ req: null, request: null }).req, {});
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeoutMs: -1 }, limits: { timeoutMs: 0 } }), 5000);
  assert.deepEqual(_test.buildTlsOptions({}), {});
  assert.equal(_test.buildTlsOptions({ skipTlsVerify: true }).dispatcher, _test.insecureTlsDispatcher);
  assert.equal(_test.redactWebhook('https://open.feishu.cn/open-apis/bot/v2/hook/token'), 'https://open.feishu.cn/open-apis/bot/v2/hook/***');
  assert.deepEqual(_test.buildPayload('x'), { msg_type: 'text', content: { text: 'x' } });
  assert.equal(_test.errorWithCode('NOT_REAL', 'unknown').code, grpcStatus.UNKNOWN);

  const circular = {};
  circular.self = circular;
  const logLines = [];
  console.log = (...args) => logLines.push(args);
  _test.createLogger({ instanceId: 'i', requestId: 'r' })('circular', circular);
  assert.equal(logLines.length, 1);
  assert.match(logLines[0][0], /Feishu_GroupRobot/);
});
