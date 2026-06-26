import test from 'node:test';
import assert from 'node:assert/strict';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_SEND_TEXT_FULL,
  METHOD_SEND_TEXT_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/slack-group-robot.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;

const buildCtx = (overrides = {}) => ({
  bindings: {
    webhook: 'https://hooks.slack.com/services/T00/B00/xxxx',
    ...(overrides.bindings || {}),
  },
  config: overrides.config || {},
  secret: overrides.secret || {},
  limits: { timeoutMs: 2000, ...(overrides.limits || {}) },
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

test('SendTextMessage rejects missing and invalid webhook', async (t) => {
  globalThis.fetch = async () => {
    throw new Error('should not fetch');
  };

  await assert.rejects(
    () => rpcdef(buildCtx({ bindings: { webhook: '' }, req: { message: 'test' } }))[METHOD_SEND_TEXT_PATH](),
    (err) => {
      assert.ok(err instanceof GrpcError);
      assert.equal(err.code, grpcStatus.INVALID_ARGUMENT);
      assert.equal(err.legacyCode, 'INVALID_ARGUMENT');
      assert.match(err.message, /webhook is required/);
      return true;
    },
  );

  await assert.rejects(
    () => rpcdef(buildCtx({ bindings: { webhook: 'https://example.com/not-slack' }, req: { message: 'test' } }))[METHOD_SEND_TEXT_PATH](),
    /webhook is required/,
  );
});

test('SendTextMessage rejects empty message', async () => {
  globalThis.fetch = async () => {
    throw new Error('should not fetch');
  };

  await assert.rejects(
    () => rpcdef(buildCtx({ req: { message: '' } }))[METHOD_SEND_TEXT_PATH](),
    /message is required/,
  );
});

test('buildPayload constructs text payload', () => {
  assert.deepEqual(_test.buildPayload('CPU high'), { text: 'CPU high' });
  assert.deepEqual(_test.buildPayload(''), { text: '' });
});

test('redactWebhook hides tokens in URL', () => {
  assert.equal(
    _test.redactWebhook('https://hooks.slack.com/services/T123/B456/abcdef'),
    'https://hooks.slack.com/services/***/***/***',
  );
  assert.equal(
    _test.redactWebhook('https://hooks.slack.com/services/T00/B00/xyz?foo=bar'),
    'https://hooks.slack.com/services/***/***/***?foo=bar',
  );
});

test('normalizeWebhook validates Slack webhook URLs', () => {
  assert.equal(_test.normalizeWebhook('https://hooks.slack.com/services/T/B/x'), 'https://hooks.slack.com/services/T/B/x');
  assert.equal(_test.normalizeWebhook('https://hooks.slack.com/services/T/B/x '), 'https://hooks.slack.com/services/T/B/x');
  assert.equal(_test.normalizeWebhook(''), '');
  assert.equal(_test.normalizeWebhook('https://example.com/webhook'), '');
  assert.equal(_test.normalizeWebhook('http://hooks.slack.com/services/T/B/x'), ''); // only https
});

test('coercion helpers cover edge cases', () => {
  assert.equal(_test.coerceString({ value: { value: 'nested' } }), 'nested');
  assert.equal(_test.coerceString(undefined), '');
  assert.equal(_test.coerceString(null), '');
  assert.equal(_test.coerceString(123), '123');
  assert.equal(_test.firstDefined(undefined, null, 'x'), 'x');
  assert.equal(_test.firstDefined(), undefined);
  assert.equal(_test.hasOwn(null, 'x'), false);
  assert.equal(_test.hasOwn({ a: 1 }, 'a'), true);
  assert.deepEqual(_test.mergedBindings({ config: { a: 1 }, secret: { b: 2 }, bindings: { c: 3 } }), { a: 1, b: 2, c: 3 });
  assert.deepEqual(_test.resolveCallContext({ request: { message: 'x' } }).req, { message: 'x' });
  assert.deepEqual(_test.resolveCallContext({ req: null, request: null }).req, {});
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeoutMs: -1 }, limits: { timeoutMs: 0 } }), 5000);
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeoutMs: 8000 } }), 8000);
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: 3000 } }), 3000);
  assert.equal(_test.resolveBindingString({ webhook_url: '', webhook: 'https://x' }, ['webhook_url', 'webhook']), 'https://x');
  assert.equal(_test.errorWithCode('NOT_A_CODE', 'unknown').code, grpcStatus.UNKNOWN);
});

test('SendTextMessage returns OK on HTTP 200', async () => {
  let capturedInit;
  const logs = [];
  console.log = (...args) => logs.push(args.join(' '));

  globalThis.fetch = async (url, init) => {
    capturedInit = init;
    return mockResponse(200, 'ok');
  };

  const res = await rpcdef(buildCtx({
    req: { message: 'test message' },
  }))[METHOD_SEND_TEXT_PATH]();

  assert.equal(res.http_status, 200);
  assert.equal(res.http_body, 'ok');
  assert.equal(capturedInit.method, 'POST');
  assert.equal(capturedInit.headers['Content-Type'], 'application/json');
  assert.equal(capturedInit.timeoutMs, 2000);
  assert.deepEqual(JSON.parse(capturedInit.body), { text: 'test message' });
  assert.match(logs.join('\n'), /\\*\\*\\*/); // webhook URL is redacted in logs
});

test('HTTP non-200 responses throw with HTTP details', async () => {
  globalThis.fetch = async () => mockResponse(400, 'invalid_payload');

  await assert.rejects(
    () => rpcdef(buildCtx({ req: { message: 'test' } }))[METHOD_SEND_TEXT_PATH](),
    (err) => {
      assert.equal(err.code, grpcStatus.UNAVAILABLE);
      assert.equal(err.legacyCode, 'UNAVAILABLE');
      assert.equal(err.httpStatus, 400);
      assert.equal(err.httpBody, 'invalid_payload');
      return true;
    },
  );

  globalThis.fetch = async () => mockResponse(500, 'server_error');
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { message: 'test' } }))[METHOD_SEND_TEXT_PATH](),
    (err) => {
      assert.equal(err.httpStatus, 500);
      assert.equal(err.httpBody, 'server_error');
      return true;
    },
  );
});

test('network errors map to UNAVAILABLE with status 0', async () => {
  globalThis.fetch = async () => {
    throw Object.assign(new Error('fetch failed'), { cause: new Error('network timeout') });
  };

  await assert.rejects(
    () => rpcdef(buildCtx({ req: { message: 'test' } }))[METHOD_SEND_TEXT_PATH](),
    (err) => {
      assert.equal(err.code, grpcStatus.UNAVAILABLE);
      assert.equal(err.legacyCode, 'UNAVAILABLE');
      assert.equal(err.httpStatus, 0);
      assert.equal(err.httpBody, '');
      assert.match(err.message, /network timeout/);
      return true;
    },
  );
});

test('SDK handler merges config and accepts legacy aliases', async () => {
  let capturedUrl = '';
  let capturedBody = '';

  globalThis.fetch = async (url, init) => {
    capturedUrl = url;
    capturedBody = init.body;
    return mockResponse(200, 'ok');
  };

  const res = await handlers[METHOD_SEND_TEXT_FULL]({
    config: {
      webhookUrl: 'https://hooks.slack.com/services/T99/B99/token',
      timeout_ms: 3100,
    },
    secret: {},
    request: {
      text: 'legacy field',
    },
  });

  assert.equal(res.http_status, 200);
  assert.match(capturedUrl, /hooks\.slack\.com\/services\/T99\/B99\/token/);
  assert.equal(JSON.parse(capturedBody).text, 'legacy field');
  assert.ok(service);
});

test('logger handles circular references', () => {
  const circular = {};
  circular.self = circular;
  const logLines = [];
  console.log = (...args) => logLines.push(args);
  _test.createLogger({ instanceId: 'i', requestId: 'r' })('test', circular);
  assert.equal(logLines.length, 1);
  assert.match(logLines[0][0], /Slack_GroupRobot.*test.*inst=i.*req=r/);
});
