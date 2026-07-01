import test from 'node:test';
import assert from 'node:assert/strict';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  BLOCK_IP_PATH,
  METHOD_BLOCK_IP_FULL,
  METHOD_UNBLOCK_IP_FULL,
  UNBLOCK_IP_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/nsfocus-ads-v4-5-r90-f06.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;

const buildCtx = (overrides = {}) => ({
  bindings: { restBaseUrl: 'http://localhost:18081', key: 'demo-key', ...(overrides.bindings || {}) },
  config: overrides.config || {},
  secret: overrides.secret || {},
  limits: { timeoutMs: 10_000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const callHandler = (method, request = {}, ctx = {}) => {
  const handler = handlers[method];
  return handler({ ...ctx, request });
};

const setFetch = (impl) => {
  globalThis.fetch = impl;
};

const parseErrorJSON = (error) => {
  const text = String(error?.message || '');
  const idx = text.indexOf('{');
  return idx < 0 ? null : JSON.parse(text.slice(idx));
};

const expectGrpcError = async (fn, code, checker = () => {}) => {
  let caught;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, 'expected function to reject');
  assert.ok(caught instanceof GrpcError);
  assert.equal(caught.legacyCode, code);
  assert.equal(caught.code, ({
    FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
    INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
    PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
    UNKNOWN: grpcStatus.UNKNOWN,
  })[code]);
  assert.match(caught.message, new RegExp(`^${code}:`));
  checker(caught, parseErrorJSON(caught));
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('BlockIP validates ip, bindings key, and base URL', async () => {
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: {} }))[BLOCK_IP_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /ip is required/),
  );
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { ip: '1.1.1.999' } }))[BLOCK_IP_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /ip must be a valid IPv4 or IPv6 address/),
  );
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { ip: '1.1.1.1' }, bindings: { key: '' } }))[BLOCK_IP_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /bindings\.key is required/),
  );
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { ip: '1.1.1.1' }, bindings: { restBaseUrl: 'localhost:18081' } }))[BLOCK_IP_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /restBaseUrl\/baseUrl is required/),
  );
});

test('BlockIP sends expected query parameters and returns success payload', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      status: 200,
      text: async () => JSON.stringify({ code: 0, content: { affected: 1 } }),
    };
  });

  const result = await rpcdef(buildCtx({ req: { ip: '1.1.1.1' } }))[BLOCK_IP_PATH]();

  assert.equal(captured.url, 'http://localhost:18081/facade/unifiedInterface.php?auth_key=demo-key&target=blackList&action_type=add&ip=1.1.1.1');
  assert.equal(captured.init.method, 'GET');
  assert.equal(captured.init.headers['x-engine-instance'], 'inst');
  assert.equal(captured.init.headers['x-request-id'], 'req');
  assert.equal(result.success, true);
  assert.equal(result.status_code, 200);
  assert.equal(result.message, 'block ip succeeded');
  assert.equal(result.raw_json, undefined);
  assert.equal(result.idempotent_success, false);
});

test('BlockIP uses binding timeout, custom headers, TLS flags, IPv6 and alias fields', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      status: 201,
      text: async () => JSON.stringify({ code: 0 }),
    };
  });

  const result = await callHandler(METHOD_BLOCK_IP_FULL, { Ip: '2001:db8::1' }, buildCtx({
    bindings: {
      baseUrl: 'http://localhost:18081/',
      restBaseUrl: undefined,
      authKey: 'alias-key',
      key: undefined,
      timeoutMs: 3210,
      headers: { 'X-Extra': 'demo' },
      skipTlsVerify: true,
    },
    limits: {},
    meta: { instance_id: 'inst-2', request_id: 'req-2' },
  }));

  assert.match(captured.url, /auth_key=alias-key/);
  assert.match(captured.url, /ip=2001%3Adb8%3A%3A1$/);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal('timeoutMs' in captured.init, false);
  assert.equal(captured.init.headers['X-Extra'], 'demo');
  assert.equal(captured.init.headers['x-engine-instance'], 'inst-2');
  assert.ok(captured.init.dispatcher);
  assert.equal('insecureSkipVerify' in captured.init, false);
  assert.equal('tlsInsecureSkipVerify' in captured.init, false);
  assert.equal(result.success, true);
});

test('BlockIP accepts IPv4-mapped IPv6 and idempotent already-blacklisted response', async () => {
  let captured;
  setFetch(async (url) => {
    captured = url;
    return {
      status: 200,
      text: async () => JSON.stringify({ content: { actionErrors: ['记录已在黑名单中'] } }),
    };
  });

  const result = await rpcdef(buildCtx({ req: { ip: '::ffff:192.0.2.128' } }))[BLOCK_IP_PATH]();

  assert.match(captured, /ip=%3A%3Affff%3A192.0.2.128$/);
  assert.equal(result.success, true);
  assert.equal(result.idempotent_success, true);
  assert.equal(result.message, 'block ip succeeded idempotently');
});

test('BlockIP accepts empty, plain text, and JSON array success bodies', async () => {
  const cases = [
    [204, '', undefined],
    [210, 'operation accepted', undefined],
    [200, '[1,2]', undefined],
  ];

  for (const [status, body, rawJSON] of cases) {
    setFetch(async () => ({
      status,
      text: async () => body,
    }));
    const result = await rpcdef(buildCtx({ req: { ip: '1.1.1.1' } }))[BLOCK_IP_PATH]();
    assert.equal(result.success, true);
    assert.equal(result.status_code, status);
    assert.equal(result.raw_body, '');
    assert.equal(result.raw_json, undefined);
  }
});

test('UnblockIP succeeds for allowed status without error token', async () => {
  setFetch(async () => ({
    status: 209,
    text: async () => JSON.stringify({ code: 0, content: { affected: 1 } }),
  }));

  const result = await rpcdef(buildCtx({ req: { ip: '1.1.1.1' } }))[UNBLOCK_IP_PATH]();

  assert.equal(result.success, true);
  assert.equal(result.status_code, 209);
  assert.equal(result.message, 'unblock ip succeeded');
  assert.equal(result.idempotent_success, false);
});

test('business failures return FAILED_PRECONDITION with raw body envelope', async () => {
  const cases = [
    [BLOCK_IP_PATH, { ip: '1.1.1.1' }, 200, JSON.stringify({ error: 'device rejected request' }), 'block ip failed'],
    [UNBLOCK_IP_PATH, { ip: '1.1.1.1' }, 200, JSON.stringify({ error_code: 1001, msg: 'device failed' }), 'unblock ip failed'],
    [BLOCK_IP_PATH, { ip: '1.1.1.1' }, 500, '<html>oops</html>', 'block ip failed'],
  ];

  for (const [path, req, status, body, message] of cases) {
    setFetch(async () => ({
      status,
      text: async () => body,
    }));
    await expectGrpcError(
      () => rpcdef(buildCtx({ req }))[path](),
      'FAILED_PRECONDITION',
      (err, payload) => {
        assert.equal(payload.message, message);
        assert.equal(payload.status_code, status);
        assert.equal(payload.raw_body, '');
        assert.equal(payload.raw_body_length, body.length);
      },
    );
  }
});

test('401 and 403 responses map to PERMISSION_DENIED with raw body envelope', async () => {
  for (const [status, body] of [
    [401, JSON.stringify({ error: 'unauthorized' })],
    [403, '<html>forbidden</html>'],
  ]) {
    setFetch(async () => ({
      status,
      text: async () => body,
    }));
    await expectGrpcError(
      () => rpcdef(buildCtx({ req: { ip: '1.1.1.1' } }))[UNBLOCK_IP_PATH](),
      'PERMISSION_DENIED',
      (err, payload) => {
        assert.equal(payload.message, 'upstream permission denied');
        assert.equal(payload.status_code, status);
        assert.equal(payload.raw_body, '');
        assert.equal(payload.raw_body_length, body.length);
      },
    );
  }
});

test('invalid JSON object response maps to UNKNOWN', async () => {
  setFetch(async () => ({
    status: 200,
    text: async () => '{',
  }));

  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { ip: '1.1.1.1' } }))[BLOCK_IP_PATH](),
    'UNKNOWN',
    (err, payload) => {
      assert.equal(payload.status_code, 200);
      assert.equal(payload.raw_body, '');
      assert.equal(payload.raw_body_length, 1);
    },
  );
});

test('network failures map to UNAVAILABLE with transport details', async () => {
  setFetch(async () => {
    throw Object.assign(new Error('boom'), { cause: new Error('socket hangup') });
  });

  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { ip: '1.1.1.1' } }))[BLOCK_IP_PATH](),
    'UNAVAILABLE',
    (err, payload) => {
      assert.equal(payload.reason, 'socket hangup');
      assert.equal(payload.base_url, 'http://localhost:18081');
      assert.equal(payload.action_type, 'add');
    },
  );
});

test('config and secret aliases supply bindings', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      status: 200,
      text: async () => JSON.stringify({ code: 0 }),
    };
  });

  const result = await callHandler(METHOD_UNBLOCK_IP_FULL, { ip: '1.1.1.1' }, {
    config: {
      rest_base_url: 'http://localhost:18081',
      timeout_ms: 2500,
      headers: { 'X-Config': 'yes' },
    },
    secret: { auth_key: 'secret-key' },
    limits: {},
  });

  assert.match(captured.url, /auth_key=secret-key/);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal('timeoutMs' in captured.init, false);
  assert.equal(captured.init.headers['X-Config'], 'yes');
  assert.equal(result.message, 'unblock ip succeeded');
});

test('secret key overrides deprecated config and legacy binding credentials', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      status: 200,
      text: async () => JSON.stringify({ code: 0 }),
    };
  });

  const result = await callHandler(METHOD_BLOCK_IP_FULL, { ip: '1.1.1.1' }, {
    bindings: {
      restBaseUrl: 'http://legacy.local',
      key: 'legacy-binding-key',
    },
    config: {
      restBaseUrl: 'http://config.local',
      key: 'deprecated-config-key',
    },
    secret: {
      key: 'secret-key',
    },
    limits: {},
  });

  assert.match(captured.url, /^http:\/\/config\.local\/facade\/unifiedInterface\.php/);
  assert.match(captured.url, /auth_key=secret-key/);
  assert.equal(result.message, 'block ip succeeded');
});

test('deprecated config key remains a lower-priority fallback', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      status: 200,
      text: async () => JSON.stringify({ code: 0 }),
    };
  });

  await callHandler(METHOD_BLOCK_IP_FULL, { ip: '1.1.1.1' }, {
    config: {
      restBaseUrl: 'http://config.local',
      key: 'deprecated-config-key',
    },
    limits: {},
  });

  assert.match(captured.url, /auth_key=deprecated-config-key/);
});

test('helpers cover parser, classifier, logging, and fallback branches', async () => {
  assert.equal(typeof service, 'object');
  assert.deepEqual(_test.mergeObject(null, { a: 1, b: undefined }, { b: 2 }), { a: 1, b: 2 });
  assert.equal(_test.normalizeBaseUrl('https://example.test///'), 'https://example.test//');
  assert.equal(_test.normalizeBaseUrl('example.test'), null);
  assert.equal(_test.unwrapString({ value: 'wrapped' }), 'wrapped');
  assert.equal(_test.isIPv4('01.1.1.1'), false);
  assert.equal(_test.isIPv4('1.1.1'), false);
  assert.equal(_test.isIPv6('2001:db8::1'), true);
  assert.equal(_test.isIPv6('2001::db8::1'), false);
  assert.equal(_test.isIPv6('2001:db8::zz'), false);
  assert.equal(_test.containsErrorToken('no ERROR here'), true);
  assert.equal(_test.getActionErrorText({ content: { actionErrors: [{ code: 1 }] } }), '{"code":1}');
  assert.equal(_test.getActionErrorText({ content: {} }), '');
  assert.deepEqual(_test.parseResponseBody({ statusCode: 200, rawBody: '' }), { json: undefined, rawJSON: undefined });
  assert.deepEqual(_test.parseResponseBody({ statusCode: 200, rawBody: 'ok' }), { json: undefined, rawJSON: undefined });
  assert.equal(_test.encodeQuery({ a: 'x y', b: '1' }), 'a=x%20y&b=1');
  assert.equal(_test.toBoolean('on'), true);
  assert.equal(_test.toBoolean('off'), false);
  assert.equal(_test.toBoolean({ value: 1 }), true);
  assert.equal(_test.toPositiveTimeout('bad'), 1500);
  assert.equal(_test.errorWithCode('NOT_REAL', 'fallback').code, grpcStatus.UNKNOWN);
  assert.throws(() => _test.classifyBusinessResult({
    actionType: 'delete',
    statusCode: 302,
    rawBody: 'redirect',
    json: undefined,
    rawJSON: undefined,
  }), /FAILED_PRECONDITION:/);

  const originalLog = console.log;
  const originalStringify = JSON.stringify;
  let capturedLog;
  try {
    console.log = (...args) => {
      capturedLog = args;
    };
    JSON.stringify = () => {
      throw new Error('bad');
    };
    _test.logFlow({}, 'manual', { ok: true });
    assert.equal(capturedLog[0], '[Nsfcous_ADS_V45R90F06][manual]');
    assert.deepEqual(capturedLog[1], { ok: true });
  } finally {
    console.log = originalLog;
    JSON.stringify = originalStringify;
  }

  setFetch(async () => {
    throw {};
  });
  await expectGrpcError(
    () => _test.fetchUpstream('http://localhost:18081', 'k', {}, 1, false, '1.1.1.1', 'delete'),
    'UNAVAILABLE',
    (err, payload) => assert.equal(payload.reason, 'fetch failed'),
  );
});
