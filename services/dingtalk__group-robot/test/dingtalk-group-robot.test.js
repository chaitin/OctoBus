import test from 'node:test';
import assert from 'node:assert/strict';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_SEND_TEXT_FULL,
  METHOD_SEND_TEXT_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/dingtalk-group-robot.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;

const buildCtx = (overrides = {}) => ({
  bindings: {
    ...(overrides.bindings || {}),
  },
  config: overrides.config || {},
  secret: {
    webhook_url: 'https://oapi.dingtalk.com/robot/send?access_token=test-token',
    secret: 'test-secret',
    ...(overrides.secret || {}),
  },
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

test('SendTextMessage rejects missing and invalid webhook_url', async () => {
  globalThis.fetch = async () => {
    throw new Error('should not fetch');
  };

  await assert.rejects(
    () => rpcdef(buildCtx({ secret: { webhook_url: '', secret: 'test-secret' }, req: { send_msg: 'test' } }))[METHOD_SEND_TEXT_PATH](),
    (err) => {
      assert.ok(err instanceof GrpcError);
      assert.equal(err.code, grpcStatus.INVALID_ARGUMENT);
      assert.equal(err.legacyCode, 'INVALID_ARGUMENT');
      assert.match(err.message, /webhook_url is required in instance secret/);
      return true;
    },
  );

  await assert.rejects(
    () => rpcdef(buildCtx({ secret: { webhook_url: 'invalid-url' }, req: { send_msg: 'test' } }))[METHOD_SEND_TEXT_PATH](),
    /webhook_url must be a valid HTTP\/HTTPS URL/,
  );
});

test('SendTextMessage rejects empty send_msg', async () => {
  globalThis.fetch = async () => {
    throw new Error('should not fetch');
  };

  await assert.rejects(
    () => rpcdef(buildCtx({ req: { send_msg: '' } }))[METHOD_SEND_TEXT_PATH](),
    /send_msg is required and must not be empty/,
  );
});

test('signing helpers generate URL-safe HMAC signatures', () => {
  const secret = 'SEC1234567890abcdef';
  const timestamp = '1700000000000';
  const sign = _test.generateSign(secret, timestamp);

  assert.equal(typeof sign, 'string');
  assert.ok(sign.length > 0);
  assert.ok(!sign.includes('+'));
  assert.ok(!sign.includes('/'));
  assert.deepEqual(Array.from(_test.encodeUtf8('abc')), [97, 98, 99]);
  assert.equal(_test.toBase64(Uint8Array.from([97])), 'YQ==');
  assert.equal(_test.urlEncode('a+b/c='), 'a%2Bb%2Fc%3D');
  assert.equal(_test.buildSignedWebhookUrl('https://example/robot', '', () => 1700000000000), 'https://example/robot');
  assert.match(
    _test.buildSignedWebhookUrl('https://example/robot?access_token=x', secret, () => 1700000000000),
    /^https:\/\/example\/robot\?access_token=x&timestamp=1700000000000&sign=/,
  );
});

test('buildDingDingPayload constructs text payloads', () => {
  assert.deepEqual(
    _test.buildDingDingPayload('CPU high', false, ['13800000000'], ['manager001']),
    {
      msgtype: 'text',
      text: { content: 'CPU high' },
      at: {
        atMobiles: ['13800000000'],
        atUserIds: ['manager001'],
        isAtAll: false,
      },
    },
  );

  const all = _test.buildDingDingPayload('all', true, undefined, undefined);
  assert.equal(all.at.isAtAll, true);
  assert.deepEqual(all.at.atMobiles, []);
  assert.deepEqual(all.at.atUserIds, []);
});

test('request coercion helpers cover legacy aliases', () => {
  assert.deepEqual(_test.readRepeatedStrings('13800000000, 13900000000,, '), ['13800000000', '13900000000']);
  assert.deepEqual(_test.readRepeatedStrings([' a ', { value: 'b' }, '']), ['a', 'b']);
  assert.deepEqual(_test.readRepeatedStrings({ values: ['x', { value: 'y' }] }), ['x', 'y']);
  assert.deepEqual(_test.readRepeatedStrings(123), []);

  assert.equal(_test.toBoolean(true), true);
  assert.equal(_test.toBoolean(false), false);
  assert.equal(_test.toBoolean('yes'), true);
  assert.equal(_test.toBoolean('off'), false);
  assert.equal(_test.toBoolean(1), true);
  assert.equal(_test.toBoolean(0), false);
  assert.equal(_test.toBoolean(Number.NaN), false);
  assert.equal(_test.toBoolean({ value: 'on' }), true);
  assert.equal(_test.toBoolean({ value: 'no' }), false);
  assert.equal(_test.toBoolean('maybe'), false);

  assert.equal(_test.coerceString({ value: { value: 'nested' } }), 'nested');
  assert.equal(_test.resolveBindingString({ webhook_url: '', webhookUrl: 'https://example' }, ['webhook_url', 'webhookUrl']), 'https://example');
});

test('SendTextMessage returns success on HTTP 200 and signs URL', async () => {
  let capturedUrl = '';
  let capturedInit;
  const logs = [];
  console.log = (...args) => logs.push(args.join(' '));

  globalThis.fetch = async (url, init) => {
    capturedUrl = url;
    capturedInit = init;
    return mockResponse(200, { errcode: 0, errmsg: 'ok' });
  };

  const res = await rpcdef(buildCtx({
    req: {
      send_msg: 'test message',
      is_groupsendall: false,
      send_PeoplePhone: ['13800000000'],
    },
  }))[METHOD_SEND_TEXT_PATH]();

  assert.equal(res.http_status, 200);
  assert.equal(res.http_body, '');
  assert.match(capturedUrl, /timestamp=/);
  assert.match(capturedUrl, /sign=/);
  assert.equal(capturedInit.method, 'POST');
  assert.ok(capturedInit.signal instanceof AbortSignal);
  assert.equal(capturedInit.timeoutMs, undefined);
  assert.equal(capturedInit.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(capturedInit.body), {
    msgtype: 'text',
    text: { content: 'test message' },
    at: {
      atMobiles: ['13800000000'],
      atUserIds: [],
      isAtAll: false,
    },
  });
  assert.match(logs.join('\n'), /access_token=\*\*\*/);
  assert.doesNotMatch(logs.join('\n'), /test-token/);
  assert.doesNotMatch(logs.join('\n'), /test-secret/);
  assert.doesNotMatch(logs.join('\n'), /sign=[^*]/);
});

test('SendTextMessage rejects unsupported TLS skip bindings', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({
      req: { send_msg: 'test message' },
      bindings: { skipTlsVerify: true },
    }))[METHOD_SEND_TEXT_PATH](),
    (err) => err instanceof GrpcError && err.code === grpcStatus.INVALID_ARGUMENT && /skipTlsVerify is not supported/.test(err.message),
  );

  assert.equal(_test.tlsSkipRequested({ tlsInsecureSkipVerify: 'on' }), true);
  assert.doesNotThrow(() => _test.assertSupportedTlsConfig({ skipTlsVerify: false }));
});

test('HTTP 200 with non-zero errcode still returns OK payload', async () => {
  globalThis.fetch = async () => mockResponse(200, { errcode: 90030, errmsg: 'rate limited' });

  const res = await rpcdef(buildCtx({ req: { send_msg: 'test message' } }))[METHOD_SEND_TEXT_PATH]();

  assert.equal(res.http_status, 200);
  assert.equal(res.http_body, '');
});

test('HTTP non-2xx responses throw gRPC errors with HTTP details', async () => {
  globalThis.fetch = async () => mockResponse(400, { errcode: 400, errmsg: 'bad request' });

  await assert.rejects(
    () => rpcdef(buildCtx({ req: { send_msg: 'test message' } }))[METHOD_SEND_TEXT_PATH](),
    (err) => {
      assert.equal(err.code, grpcStatus.INTERNAL);
      assert.equal(err.legacyCode, 'INTERNAL');
      assert.equal(err.httpStatus, 400);
      assert.equal(err.httpBody, '');
      assert.ok(err.httpBodyLength > 0);
      return true;
    },
  );

  globalThis.fetch = async () => mockResponse(500, 'Internal Server Error');
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { send_msg: 'test message' } }))[METHOD_SEND_TEXT_PATH](),
    (err) => {
      assert.equal(err.httpStatus, 500);
      assert.equal(err.httpBody, '');
      assert.equal(err.httpBodyLength, 'Internal Server Error'.length);
      return true;
    },
  );
});

test('network errors map to UNAVAILABLE with status 0', async () => {
  globalThis.fetch = async () => {
    throw Object.assign(new Error('fetch failed'), { cause: new Error('network timeout') });
  };

  await assert.rejects(
    () => rpcdef(buildCtx({ req: { send_msg: 'test message' } }))[METHOD_SEND_TEXT_PATH](),
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

test('response read errors map to UNAVAILABLE without leaking body', async () => {
  globalThis.fetch = async () => ({
    status: 200,
    text: async () => {
      throw new Error('read failed');
    },
  });

  await assert.rejects(
    () => rpcdef(buildCtx({ req: { send_msg: 'test message' } }))[METHOD_SEND_TEXT_PATH](),
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

test('SendTextMessage works without secret and maps all mention fields', async () => {
  let capturedUrl = '';
  let capturedBody = '';

  globalThis.fetch = async (url, init) => {
    capturedUrl = url;
    capturedBody = init.body;
    return mockResponse(200, { errcode: 0, errmsg: 'ok' });
  };

  const res = await rpcdef(buildCtx({
    secret: {
      webhook_url: 'https://oapi.dingtalk.com/robot/send?access_token=test-token',
      secret: '',
    },
    limits: { timeoutMs: 0 },
    req: {
      sendMessage: 'all hands',
      isAtAll: 'true',
      at_mobiles: '13800000000,13900000000',
      atUserIds: { values: ['user001', 'user002'] },
    },
  }))[METHOD_SEND_TEXT_PATH]();

  assert.equal(res.http_status, 200);
  assert.ok(!capturedUrl.includes('timestamp='));
  assert.ok(!capturedUrl.includes('sign='));
  const body = JSON.parse(capturedBody);
  assert.equal(body.text.content, 'all hands');
  assert.equal(body.at.isAtAll, true);
  assert.deepEqual(body.at.atMobiles, ['13800000000', '13900000000']);
  assert.deepEqual(body.at.atUserIds, ['user001', 'user002']);
});

test('SDK handler uses deprecated config webhook fallback when secret is absent', async () => {
  let capturedUrl = '';
  let capturedBody = '';

  globalThis.fetch = async (url, init) => {
    capturedUrl = url;
    capturedBody = init.body;
    return mockResponse(200, { errcode: 0, errmsg: 'ok' });
  };

  const res = await handlers[METHOD_SEND_TEXT_FULL]({
    config: {
      webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=config-token',
      timeout_ms: 3100,
      secret: 'config-signing-secret',
    },
    secret: {},
    request: {
      send_msg: 'from sdk',
      is_groupsendall: { value: false },
      send_DingDingID: ['user001'],
    },
  });

  assert.equal(res.http_status, 200);
  assert.match(capturedUrl, /access_token=config-token/);
  assert.match(capturedUrl, /timestamp=/);
  assert.equal(JSON.parse(capturedBody).text.content, 'from sdk');
  assert.ok(service);
});

test('ctx.secret webhook and signing secret override deprecated config and bindings fallbacks', async () => {
  let capturedUrl = '';

  globalThis.fetch = async (url) => {
    capturedUrl = url;
    return mockResponse(200, { errcode: 0, errmsg: 'ok' });
  };

  const res = await handlers[METHOD_SEND_TEXT_FULL]({
    bindings: {
      webhook_url: 'https://oapi.dingtalk.com/robot/send?access_token=binding-token',
      secret: 'binding-signing-secret',
    },
    config: {
      webhook_url: 'https://oapi.dingtalk.com/robot/send?access_token=config-token',
      secret: 'config-signing-secret',
    },
    secret: {
      webhook_url: 'https://oapi.dingtalk.com/robot/send?access_token=secret-token',
      secret: 'secret-signing-secret',
    },
    request: {
      send_msg: 'from secret',
    },
  });

  assert.equal(res.http_status, 200);
  assert.match(capturedUrl, /access_token=secret-token/);
  assert.doesNotMatch(capturedUrl, /access_token=config-token/);
  assert.doesNotMatch(capturedUrl, /access_token=binding-token/);
  assert.equal(_test.resolveWebhookUrl({
    secret: { webhook_url: 'secret' },
    config: { webhook_url: 'config' },
    bindings: { webhook_url: 'binding' },
  }), 'secret');
  assert.equal(_test.resolveSigningSecret({
    secret: { secret: 'secret' },
    config: { secret: 'config' },
    bindings: { secret: 'binding' },
  }), 'secret');
  assert.equal(_test.resolveWebhookUrl({
    secret: {},
    config: { webhook_url: 'config' },
    bindings: { webhook_url: 'binding' },
  }), 'config');
});

test('null request fallback and helper defaults are stable', async () => {
  globalThis.fetch = async () => mockResponse(200, { errcode: 0, errmsg: 'ok' });

  const res = await rpcdef(buildCtx({ req: { send_msg: 'default request' } }))[METHOD_SEND_TEXT_PATH]();
  assert.equal(res.http_status, 200);

  assert.equal(_test.firstDefined(undefined, null, 'x'), 'x');
  assert.deepEqual(_test.mergedBindings({ config: { a: 1, webhook_url: 'config' }, secret: { b: 2, webhook_url: 'secret' }, bindings: { c: 3, webhook_url: 'binding' } }), { a: 1, b: 2, c: 3, webhook_url: 'secret' });
  assert.deepEqual(_test.resolveCallContext({ request: { send_msg: 'x' } }).req, { send_msg: 'x' });
  assert.deepEqual(_test.resolveCallContext({ req: null, request: null }).req, {});
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeoutMs: -1 }, limits: { timeoutMs: 0 } }), 5000);
  assert.equal(_test.redactWebhookUrl('https://x?access_token=abc&sign=sig&v=1'), 'https://x?access_token=***&sign=***&v=1');
  assert.equal(_test.coerceString(), '');
  assert.equal(_test.hasOwn(null, 'x'), false);
  assert.equal(_test.buildSignedWebhookUrl('https://example/robot', 's', () => null).includes('timestamp=0'), true);
  assert.equal(_test.errorWithCode('NOT_A_REAL_CODE', 'unknown').code, grpcStatus.UNKNOWN);

  const circular = {};
  circular.self = circular;
  const logLines = [];
  console.log = (...args) => logLines.push(args);
  _test.createLogger({ instanceId: 'i', requestId: 'r' })('circular', circular);
  assert.equal(logLines.length, 1);
  assert.match(logLines[0][0], /DingDing_GroupRobot circular inst=i req=r/);
});
