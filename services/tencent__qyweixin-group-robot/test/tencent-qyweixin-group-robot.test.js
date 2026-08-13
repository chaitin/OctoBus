import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_SEND_TEXT_FULL,
  METHOD_SEND_TEXT_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/tencent-qyweixin-group-robot.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;

const buildCtx = (overrides = {}) => ({
  bindings: {
    headers: { 'X-Trace': 'demo' },
    ...(overrides.bindings || {}),
  },
  config: overrides.config || {},
  secret: {
    webhook: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=token',
    ...(overrides.secret || {}),
  },
  limits: { timeoutMs: 10_000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const callHandler = (method, request = {}, ctx = {}) => {
  const handler = handlers[method];
  return handler({ ...ctx, request });
};

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const setFetch = (impl) => {
  globalThis.fetch = impl;
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

const parseStructuredError = (err) => JSON.parse(err.message);

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('service exports handler and rpcdef path', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers[METHOD_SEND_TEXT_FULL], 'function');
  assert.equal(typeof rpcdef(buildCtx())[METHOD_SEND_TEXT_PATH], 'function');
});

test('validates webhook and message', async () => {
  await expectGrpcError(
    () => callHandler(METHOD_SEND_TEXT_FULL, { message: 'hi' }, buildCtx({ secret: { webhook: 'http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=token' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /https URL/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_SEND_TEXT_FULL, { message: '' }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /message is required/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_SEND_TEXT_FULL, { message: 'hi' }, buildCtx({ secret: { webhook: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /webhook is required/),
  );
});

test('sends text payload with mentioned_list when mobiles are empty', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return response(200, { errcode: 0, errmsg: 'ok' });
  });

  const result = await callHandler(METHOD_SEND_TEXT_FULL,
    {
      webhook: { value: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=request-token' },
      message: { value: 'hello' },
      mentioned_mobiles: '',
    },
    buildCtx({ bindings: { skipTlsVerify: true } }),
  );

  assert.equal(captured.url, 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=token');
  assert.equal(captured.init.method, 'POST');
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.init.timeoutMs, undefined);
  assert.equal(captured.init.dispatcher, _test.insecureTlsDispatcher);
  assert.equal(captured.init.skipTlsVerify, undefined);
  assert.equal(captured.init.tlsInsecureSkipVerify, undefined);
  assert.equal(captured.init.insecureSkipVerify, undefined);
  assert.equal(captured.init.headers['content-type'], 'application/json');
  assert.equal(captured.init.headers.accept, 'application/json, */*;q=0.8');
  assert.equal(captured.init.headers['X-Trace'], 'demo');
  assert.deepEqual(captured.body, {
    msgtype: 'text',
    text: { content: 'hello', mentioned_list: [] },
  });
  assert.equal(result.http_status_code, 200);
  assert.equal(result.http_body, '');
  assert.equal(result.errcode, 0);
  assert.equal(result.errmsg, 'ok');
});

test('sends text payload with mentioned_mobile_list when mobiles are provided', async () => {
  let captured;
  setFetch(async (_url, init) => {
    captured = { body: JSON.parse(init.body) };
    return response(200, { errcode: 0, errmsg: 'ok' });
  });

  await rpcdef(buildCtx())[METHOD_SEND_TEXT_PATH]({
    message: 'hello',
    mentionedMobiles: ' 13800000001, ,13800000002 ',
  });

  assert.deepEqual(captured.body, {
    msgtype: 'text',
    text: {
      content: 'hello',
      mentioned_mobile_list: ['13800000001', '13800000002'],
    },
  });
});

test('maps http errors with parsed errcode and errmsg', async () => {
  for (const [status, legacyCode] of [[401, 'PERMISSION_DENIED'], [403, 'PERMISSION_DENIED'], [404, 'FAILED_PRECONDITION'], [500, 'UNAVAILABLE'], [302, 'UNKNOWN']]) {
    setFetch(async () => response(status, { errcode: 40014, errmsg: 'invalid key' }));
    await expectGrpcError(
      () => callHandler(METHOD_SEND_TEXT_FULL, { message: 'hello' }, buildCtx()),
      legacyCode,
      (err) => {
        const payload = parseStructuredError(err);
        assert.equal(payload.code, legacyCode);
        assert.equal(payload.http_status_code, status);
        assert.equal(payload.http_body, '');
        assert.ok(payload.http_body_length > 0);
        assert.equal(payload.errcode, 40014);
        assert.equal(payload.errmsg, 'invalid key');
        assert.equal(payload.reason, 'http status is not 2xx');
      },
    );
  }
});

test('maps transport and response read errors', async () => {
  setFetch(async () => {
    throw Object.assign(new Error('outer'), { cause: new Error('connect ECONNREFUSED') });
  });
  await expectGrpcError(
    () => callHandler(METHOD_SEND_TEXT_FULL, { message: 'hello' }, buildCtx()),
    'UNAVAILABLE',
    (err) => {
      const payload = parseStructuredError(err);
      assert.equal(payload.http_status_code, 0);
      assert.equal(payload.http_body, '');
      assert.equal(payload.http_body_length, 0);
      assert.match(payload.reason, /ECONNREFUSED/);
    },
  );

  setFetch(async () => ({
    ok: true,
    status: 200,
    text: async () => {
      throw new Error('read failed');
    },
  }));
  await expectGrpcError(
    () => callHandler(METHOD_SEND_TEXT_FULL, { message: 'hello' }, buildCtx()),
    'UNAVAILABLE',
    (err) => {
      const payload = parseStructuredError(err);
      assert.equal(payload.http_status_code, 200);
      assert.equal(payload.http_body, '');
      assert.equal(payload.reason, 'read failed');
    },
  );
});

test('maps invalid response body and business failure', async () => {
  for (const body of ['{"errmsg":"ok"}', 'not-json', '']) {
    setFetch(async () => response(200, body));
    await expectGrpcError(
      () => callHandler(METHOD_SEND_TEXT_FULL, { message: 'hello' }, buildCtx()),
      'UNKNOWN',
      (err) => {
        const payload = parseStructuredError(err);
        assert.equal(payload.http_status_code, 200);
        assert.equal(payload.http_body, '');
        assert.equal(payload.reason, 'missing errcode in json body');
      },
    );
  }

  setFetch(async () => response(200, { errcode: 40001, errmsg: 'invalid' }));
  await expectGrpcError(
    () => callHandler(METHOD_SEND_TEXT_FULL, { message: 'hello' }, buildCtx()),
    'FAILED_PRECONDITION',
    (err) => {
      const payload = parseStructuredError(err);
      assert.equal(payload.http_status_code, 200);
      assert.equal(payload.http_body, '');
      assert.equal(payload.errcode, 40001);
      assert.equal(payload.errmsg, 'invalid');
      assert.equal(payload.reason, 'errcode != 0');
    },
  );
});

test('helper functions cover normalization branches', async () => {
  assert.equal(_test.grpcCodeFor('NOT_A_CODE'), grpcStatus.UNKNOWN);
  assert.equal(_test.errorWithCode('NOT_A_CODE', 'bad').code, grpcStatus.UNKNOWN);
  const upstream = _test.upstreamError('NOT_A_CODE', 'msg', { httpStatusCode: 'bad', httpBody: 123, reason: null, errcode: 'x', errmsg: '' });
  assert.equal(upstream.code, grpcStatus.UNKNOWN);
  assert.equal(upstream.legacyCode, 'NOT_A_CODE');
  assert.deepEqual(parseStructuredError(upstream), {
    code: 'NOT_A_CODE',
    message: 'msg',
    http_status_code: 0,
    http_body: '',
    http_body_length: 0,
    reason: '',
  });
  assert.equal(_test.hasOwn(null, 'x'), false);
  assert.equal(_test.unwrapScalar({ value: { value: 'nested' } }), 'nested');
  assert.equal(_test.unwrapScalar(undefined), undefined);
  assert.equal(_test.pickFirst({ a: undefined, b: { value: 'two' } }, ['a', 'b']), undefined);
  assert.equal(_test.pickFirst({ b: { value: 'two' } }, ['a', 'b']), 'two');
  assert.equal(_test.toTrimmedString(null), '');
  assert.equal(_test.requireString(' value ', 'field'), 'value');
  assert.deepEqual(_test.mergedBindings({ config: { timeoutMs: 1, webhook: 'config' }, secret: { webhook: 'secret' }, bindings: { timeoutMs: 2, webhook: 'binding' } }), { timeoutMs: 2, webhook: 'secret' });
  assert.equal(_test.resolveWebhook({ request: { webhook: 'request' }, secret: { webhook: 'secret' }, config: { webhook: 'config' }, bindings: { webhook: 'binding' } }), 'secret');
  assert.deepEqual(_test.resolveCallContext({ request: { message: 'req' } }).req, { message: 'req' });
  assert.equal(_test.optionalUint32({ value: '10.9' }), 10);
  assert.equal(_test.optionalUint32('bad'), undefined);
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: -1 }, bindings: { timeoutMs: '25' } }), 25);
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: 11 }, bindings: { timeoutMs: '25' } }), 11);
  assert.equal(_test.toBoolean(true), true);
  assert.equal(_test.toBoolean(1), true);
  assert.equal(_test.toBoolean(0), false);
  assert.equal(_test.toBoolean('yes'), true);
  assert.equal(_test.toBoolean('off'), false);
  assert.equal(_test.toBoolean('maybe'), false);
  assert.deepEqual(_test.buildTlsOptions({}), {});
  assert.equal(_test.buildTlsOptions({ insecureSkipVerify: 'on' }).dispatcher, _test.insecureTlsDispatcher);
  assert.deepEqual(_test.buildHeaders({ bindings: { headers: null } }), { 'content-type': 'application/json', accept: 'application/json, */*;q=0.8' });
  assert.equal(_test.requireWebhook('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=token'), 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=token');
  assert.deepEqual(_test.splitMentionedMobiles(' 1, ,2 '), ['1', '2']);
  assert.deepEqual(_test.splitMentionedMobiles(''), []);
  assert.deepEqual(_test.tryParseWecomBody(null), { ok: false });
  assert.deepEqual(_test.tryParseWecomBody(''), { ok: false });
  assert.equal(_test.tryParseWecomBody('{"errcode":"0","errmsg":"ok"}').errcode, 0);
  assert.equal(_test.tryParseWecomBody('{"errcode":"bad","errmsg":123}').hasErrcode, false);
  assert.equal(_test.mapHttpStatusToCode(401), 'PERMISSION_DENIED');
  assert.equal(_test.mapHttpStatusToCode(400), 'FAILED_PRECONDITION');
  assert.equal(_test.mapHttpStatusToCode(500), 'UNAVAILABLE');
  assert.equal(_test.mapHttpStatusToCode(302), 'UNKNOWN');
  assert.deepEqual(_test.buildWecomPayload('hi', []), { msgtype: 'text', text: { content: 'hi', mentioned_list: [] } });

  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, { errcode: 0, errmsg: 'ok' });
  });
  const upstreamResponse = await _test.fetchWecom(buildCtx(), 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=token', { ok: true });
  assert.equal(upstreamResponse.status, 200);
  assert.equal(captured.init.body, '{"ok":true}');
});

test('rpcdef falls back to context request when call request is omitted', async () => {
  setFetch(async () => response(200, { errcode: 0, errmsg: 'ok' }));
  const result = await rpcdef(buildCtx({
    req: {
      message: 'from context',
    },
  }))[METHOD_SEND_TEXT_PATH]();
  assert.equal(result.errcode, 0);
});

test('mock upstream handles success and simulated failures', async () => {
  const server = await createMockServer();
  try {
    const nativeFetch = originalFetch;
    setFetch(async (url, init) => nativeFetch(String(url).replace('https://', 'http://'), init));

    const ok = await callHandler(METHOD_SEND_TEXT_FULL,
      { message: 'hello' },
      buildCtx({ secret: { webhook: `${server.url.replace('http://', 'https://')}/cgi-bin/webhook/send?key=ok` } }),
    );
    assert.equal(ok.errcode, 0);
    assert.equal(server.requests.length, 1);
    assert.deepEqual(JSON.parse(server.requests[0].body), { msgtype: 'text', text: { content: 'hello', mentioned_list: [] } });

    await expectGrpcError(
      () => callHandler(METHOD_SEND_TEXT_FULL, { message: 'hello' }, buildCtx({ secret: { webhook: `${server.url.replace('http://', 'https://')}/cgi-bin/webhook/send?key=bizfail` } })),
      'FAILED_PRECONDITION',
    );
    await expectGrpcError(
      () => callHandler(METHOD_SEND_TEXT_FULL, { message: 'hello' }, buildCtx({ secret: { webhook: `${server.url.replace('http://', 'https://')}/cgi-bin/webhook/send?key=servererr` } })),
      'UNAVAILABLE',
    );
  } finally {
    await server.close();
  }
});
