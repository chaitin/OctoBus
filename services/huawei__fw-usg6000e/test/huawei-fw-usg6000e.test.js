import test from 'node:test';
import assert from 'node:assert/strict';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_UPDATE_ADDRESS_GROUP_FULL,
  UPDATE_ADDRESS_GROUP_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/huawei-fw-usg6000e.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;

const defaultConfig = {
  host: 'https://device.example:8447',
  user: 'sys_user',
  timeoutMs: 4000,
};

const defaultSecret = {
  password: 'Passw0rd!',
};

const buildCtx = (overrides = {}) => ({
  req: overrides.req || {},
  bindings: { timeoutMs: 4000, ...(overrides.bindings || {}) },
  config: overrides.config === undefined ? defaultConfig : overrides.config,
  secret: overrides.secret === undefined ? defaultSecret : overrides.secret,
  limits: { timeoutMs: 4000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst-1', request_id: 'req-1', ...(overrides.meta || {}) },
  metadata: { ...(overrides.metadata || {}) },
});

const callHandler = (method, request = {}, ctx = {}) => {
  const handler = handlers[method];
  return handler({ ...ctx, request });
};

const validRequest = () => ({
  device_name: 'public',
  book_name: 'Block_Group_1',
  ipv4_list: ['203.0.113.20', '203.0.113.21'],
  ipv6_list: ['2001:db8::1'],
});

const parseErrorJSON = (error) => {
  const text = String(error?.message || '');
  const start = text.indexOf('{');
  return start < 0 ? null : JSON.parse(text.slice(start));
};

const expectGrpcError = async (fn, legacyCode, checker = () => {}) => {
  let caught;
  try {
    await fn();
  } catch (error) {
    caught = error;
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
  assert.match(caught.message, new RegExp(`^${legacyCode}:`));
  checker(caught, parseErrorJSON(caught));
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('UpdateAddressGroup succeeds and sends a single PUT XML request', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      text: async () => '<ok>true</ok>',
    };
  };

  const result = await rpcdef(buildCtx({ req: validRequest() }))[UPDATE_ADDRESS_GROUP_PATH]();

  assert.equal(captured.url, 'https://device.example:8447/restconf/data/huawei-address-set:address-set/addr-group=public,Block_Group_1');
  assert.equal(captured.init.method, 'PUT');
  assert.equal(Object.hasOwn(captured.init, 'timeoutMs'), false);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.init.headers['Content-Type'], 'application/yang-data+xml');
  assert.equal(captured.init.headers.Accept, 'application/yang-data+xml');
  assert.match(captured.init.headers.Authorization, /^Basic\s+/);
  assert.match(captured.init.body, /<desc>API Block_IP<\/desc>/);
  assert.match(captured.init.body, /<address-ipv4>203\.0\.113\.20\/32<\/address-ipv4>/);
  assert.match(captured.init.body, /<address-ipv6>2001:db8::1\/64<\/address-ipv6>/);
  assert.equal(result.success, true);
  assert.equal(result.http_status, 200);
  assert.equal(result.raw_body, '');
  assert.equal(result.preview_only, false);
  assert.equal(result.request_method, 'PUT');
  assert.equal(result.request_url, captured.url);
  assert.deepEqual(result.request_headers, {});
  assert.equal(result.request_body, '');
  assert.equal(result.message, 'address group updated');
});

test('UpdateAddressGroup allows empty address lists to clear the address group', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 204,
      text: async () => '',
    };
  };

  const req = validRequest();
  req.ipv4_list = [];
  req.ipv6_list = [];
  const result = await rpcdef(buildCtx({ req }))[UPDATE_ADDRESS_GROUP_PATH]();

  assert.equal(captured.init.body, '<addr-group><desc>API Block_IP</desc></addr-group>');
  assert.equal(result.http_status, 204);
  assert.equal(result.raw_body, '');
  assert.equal(result.success, true);
});

test('UpdateAddressGroup supports preview mode through metadata and does not call fetch', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('should not be called');
  };

  const result = await rpcdef(buildCtx({
    req: validRequest(),
    metadata: { preview_only: 'true' },
  }))[UPDATE_ADDRESS_GROUP_PATH]();

  assert.equal(called, false);
  assert.equal(result.success, true);
  assert.equal(result.preview_only, true);
  assert.equal(result.http_status, 0);
  assert.equal(result.raw_body, '');
  assert.equal(result.message, 'preview only');
  assert.deepEqual(result.request_headers, {});
  assert.equal(result.request_body, '');
});

test('UpdateAddressGroup rejects invalid host, key parts, and missing credentials before sending request', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('unexpected');
  };

  await expectGrpcError(
    () => rpcdef(buildCtx({ req: validRequest(), config: { ...defaultConfig, host: 'http://device.example:8447' } }))[UPDATE_ADDRESS_GROUP_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /host must be a valid https URL/),
  );
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { ...validRequest(), device_name: 'bad/name' } }))[UPDATE_ADDRESS_GROUP_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /device_name contains invalid characters/),
  );
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: validRequest(), config: {}, secret: {} }))[UPDATE_ADDRESS_GROUP_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /host is required/),
  );
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: validRequest(), config: { ...defaultConfig, user: '' } }))[UPDATE_ADDRESS_GROUP_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /user is required/),
  );
  assert.equal(called, false);
});

test('UpdateAddressGroup rejects invalid address list shapes and address values', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('unexpected');
  };

  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { ...validRequest(), ipv4_list: ['999.1.1.1'] } }))[UPDATE_ADDRESS_GROUP_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /ipv4_list\[0\] must be a valid IPv4 address/),
  );
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { ...validRequest(), ipv6_list: ['not-an-ipv6'] } }))[UPDATE_ADDRESS_GROUP_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /ipv6_list\[0\] must be a valid IPv6 address/),
  );
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { ...validRequest(), ipv4_list: '203.0.113.1' } }))[UPDATE_ADDRESS_GROUP_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /ipv4_list must be an array/),
  );
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { ...validRequest(), ipv4_list: [''] } }))[UPDATE_ADDRESS_GROUP_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /ipv4_list\[0\] is blank/),
  );
  assert.equal(called, false);
});

test('UpdateAddressGroup enforces total address count limit', async () => {
  const req = validRequest();
  req.ipv4_list = Array.from({ length: 1001 }, (_, index) => `10.0.${Math.floor(index / 250)}.${index % 250}`);
  req.ipv6_list = [];

  await expectGrpcError(
    () => rpcdef(buildCtx({ req }))[UPDATE_ADDRESS_GROUP_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /total address count exceeds limit 1000/),
  );
});

test('UpdateAddressGroup maps HTTP failures without raw body details', async () => {
  const cases = [
    [401, 'PERMISSION_DENIED', '<error>unauthorized</error>'],
    [403, 'PERMISSION_DENIED', '<error>forbidden</error>'],
    [422, 'FAILED_PRECONDITION', '<error>bad input</error>'],
    [500, 'UNAVAILABLE', '<error>internal</error>'],
  ];

  for (const [status, code, body] of cases) {
    globalThis.fetch = async () => ({
      ok: false,
      status,
      text: async () => body,
    });

    await expectGrpcError(
      () => rpcdef(buildCtx({ req: validRequest() }))[UPDATE_ADDRESS_GROUP_PATH](),
      code,
      (err, payload) => {
        assert.equal(payload.http_status, status);
        assert.equal(payload.raw_body, '');
        assert.equal(payload.raw_body_length, body.length);
        assert.equal(payload.reason, `upstream http ${status}`);
        assert.equal(err.details.http_status, status);
      },
    );
  }
});

test('UpdateAddressGroup maps network and response body failures', async () => {
  globalThis.fetch = async () => {
    throw Object.assign(new Error('boom'), { cause: new Error('socket hang up') });
  };

  await expectGrpcError(
    () => rpcdef(buildCtx({ req: validRequest() }))[UPDATE_ADDRESS_GROUP_PATH](),
    'UNAVAILABLE',
    (err, payload) => {
      assert.equal(payload.http_status, 0);
      assert.equal(payload.raw_body, '');
      assert.equal(payload.reason, 'socket hang up');
    },
  );

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => {
      throw Object.assign(new Error('bad body'), { cause: new Error('read reset') });
    },
  });

  await expectGrpcError(
    () => rpcdef(buildCtx({ req: validRequest() }))[UPDATE_ADDRESS_GROUP_PATH](),
    'UNKNOWN',
    (err, payload) => {
      assert.equal(payload.http_status, 200);
      assert.equal(payload.reason, 'read reset');
    },
  );
});

test('UpdateAddressGroup passes TLS skip flags when configured', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      text: async () => '<ok/>',
    };
  };

  await callHandler(METHOD_UPDATE_ADDRESS_GROUP_FULL, validRequest(), buildCtx({
    bindings: { skipTlsVerify: true },
  }));

  assert.equal(Object.hasOwn(captured.init, 'skipTlsVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'tlsInsecureSkipVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'insecureSkipVerify'), false);
  assert.ok(captured.init.dispatcher);
  assert.equal(Object.hasOwn(captured.init, 'skipTlsVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'tlsInsecureSkipVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'insecureSkipVerify'), false);
  assert.ok(captured.init.dispatcher);
  assert.equal(Object.hasOwn(captured.init, 'skipTlsVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'tlsInsecureSkipVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'insecureSkipVerify'), false);
  assert.ok(captured.init.dispatcher);
});

test('config and secret aliases provide defaults while request business fields win', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      text: async () => '<ok/>',
    };
  };

  const result = await callHandler(METHOD_UPDATE_ADDRESS_GROUP_FULL, {
    bookName: 'Request_Book',
    user: 'request_user',
    password: 'request-pass',
    ipv4List: ['198.51.100.10'],
  }, {
    config: {
      host: 'https://device.example:8447/',
      deviceName: 'public',
      book_name: 'Config_Book',
      username: 'config_user',
      timeout_ms: 4500,
      desc: 'Config <Desc>',
      headers: { 'X-Trace': 'abc' },
    },
    secret: { username: 'secret_user', password: 'secret-pass' },
    meta: { instanceId: 'inst-2', requestId: 'req-2' },
  });

  assert.equal(captured.url, 'https://device.example:8447/restconf/data/huawei-address-set:address-set/addr-group=public,Request_Book');
  assert.equal(Object.hasOwn(captured.init, 'timeoutMs'), false);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.init.headers['X-Trace'], 'abc');
  assert.equal(Buffer.from(captured.init.headers.Authorization.replace(/^Basic\s+/, ''), 'base64').toString(), 'secret_user:secret-pass');
  assert.deepEqual(result.request_headers, {});
  assert.match(captured.init.body, /Config &lt;Desc&gt;/);
});

test('helpers cover parser and sanitizer edge cases', () => {
  assert.equal(typeof service, 'object');
  assert.equal(_test.toBoolean({ value: 'yes' }), true);
  assert.equal(_test.toBoolean('off'), false);
  assert.equal(_test.toBoolean({}), false);
  assert.equal(_test.toBoolean(true), true);
  assert.equal(_test.toBoolean(0), false);
  assert.equal(_test.toBoolean('maybe'), false);
  assert.equal(_test.normalizeHttpsUrl('https://device.example:8447///'), 'https://device.example:8447');
  assert.equal(_test.normalizeHttpsUrl('http://device.example'), '');
  assert.equal(_test.normalizeHttpsUrl({ value: 'https://wrapped.example/' }), 'https://wrapped.example');
  assert.equal(_test.isIPv4('192.0.2.1'), true);
  assert.equal(_test.isIPv4('01.0.0.1'), false);
  assert.equal(_test.isIPv4('192.0.2.1/32'), false);
  assert.equal(_test.isIPv4('192.0.2'), false);
  assert.equal(_test.isIPv4('abc.0.0.1'), false);
  assert.equal(_test.isIPv6('2001:db8::1'), true);
  assert.equal(_test.isIPv6('::ffff:192.0.2.1'), true);
  assert.equal(_test.isIPv6('2001:db8::1/64'), false);
  assert.equal(_test.isIPv6('2001::db8::1'), false);
  assert.equal(_test.isIPv6('2001:db8:00000::1'), false);
  assert.equal(_test.isIPv6('2001:db8:0:0:0:0:0:1'), true);
  assert.equal(_test.isIPv6('2001:db8:0:0:0:0:0'), false);
  assert.equal(_test.isIPv6('2001:db8:0:0:0:0:0:0:1'), false);
  assert.equal(_test.isIPv6('2001:db8::1::'), false);
  assert.equal(_test.isIPv6('2001:db8::zz'), false);
  assert.deepEqual(_test.sanitizeHeaders({ Authorization: 'Basic token', 'X-Test': 1 }), {
    Authorization: 'Basic ***',
    'X-Test': '1',
  });
  assert.deepEqual(_test.sanitizeHeaders(null), {});
  assert.equal(_test.buildAuthorization('u', 'p'), 'Basic dTpw');
  assert.match(_test.buildXmlBody('A&B', ['203.0.113.1'], ['2001:db8::1']), /A&amp;B/);
  assert.equal(_test.buildRequestUrl('https://h', 'pub/lic', 'Book,One'), 'https://h/restconf/data/huawei-address-set:address-set/addr-group=pub%2Flic,Book%2COne');
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeoutMs: 'bad' } }), 5000);
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: 3000 } }), 3000);
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeout_ms: 4500 } }), 4500);
  assert.equal(_test.shouldSkipTlsVerify({ bindings: { tlsInsecureSkipVerify: 'on' } }), true);
  assert.equal(_test.shouldSkipTlsVerify({ bindings: { insecureSkipVerify: 1 } }), true);
  assert.equal(_test.shouldSkipTlsVerify({ bindings: {} }), false);
  assert.equal(_test.shouldPreview({ previewOnly: 1 }), true);
  assert.equal(_test.shouldPreview({ 'x-preview-only': 'false', dry_run_preview: 'yes' }), true);
  assert.equal(_test.shouldPreview({ preview_only: false }), false);
  assert.deepEqual(_test.getStringList({ value: [' a '] }, 'list'), ['a']);
  assert.deepEqual(_test.validateAddressLists({ ipv4List: ['192.0.2.1'], ipv6List: ['2001:db8::2'] }), {
    ipv4List: ['192.0.2.1'],
    ipv6List: ['2001:db8::2'],
  });
  const prepared = _test.prepareRequest({
    config: { host: 'https://device.example:8447', device_name: 'public', book_name: 'Book', username: 'u' },
    secret: { password: 'p' },
    request: { ipv4_list: [], ipv6_list: [] },
  });
  assert.equal(prepared.requestModel.request_url, 'https://device.example:8447/restconf/data/huawei-address-set:address-set/addr-group=public,Book');
  assert.equal(_test.errorWithCode('NOT_REAL', 'fallback').code, grpcStatus.UNKNOWN);
  assert.throws(() => _test.validateKeyPart('bad,name', 'book_name'), /book_name contains invalid characters/);
  assert.throws(() => _test.mapHttpFailure(302, { request_method: 'PUT', request_url: 'u' }, ''), (err) => {
    assert.equal(err.legacyCode, 'UNAVAILABLE');
    return true;
  });
});

test('fallback branches handle null inputs and minimal failures', async () => {
  assert.equal(_test.normalizeHttpsUrl(null), '');
  assert.throws(() => _test.validateKeyPart(null, 'device_name'), /device_name is required/);
  assert.equal(_test.isIPv4(null), false);
  assert.equal(_test.isIPv6(null), false);
  assert.equal(_test.isIPv6('::1'), true);
  assert.equal(_test.isIPv6('2001:db8:0:0:0:0:0:0:0'), false);
  assert.throws(() => _test.getStringList([null], 'list'), /list\[0\] is blank/);
  assert.equal(_test.escapeXml(null), '');
  assert.equal(_test.buildXmlBody('', [], []), '<addr-group><desc>API Block_IP</desc></addr-group>');
  assert.equal(_test.prepareRequest({
    config: {
      host: 'https://device.example:8447',
      device_name: 'public',
      book_name: 'Book',
      user: 'u',
    },
    secret: { password: 'p' },
  }).requestModel.request_body, '<addr-group><desc>API Block_IP</desc></addr-group>');

  let captured;
  globalThis.fetch = async () => {
    throw {};
  };
  await expectGrpcError(
    () => callHandler(METHOD_UPDATE_ADDRESS_GROUP_FULL, validRequest(), buildCtx({ metadata: null })),
    'UNAVAILABLE',
    (err, payload) => assert.equal(payload.reason, 'fetch failed'),
  );

  globalThis.fetch = async () => ({
    ok: true,
    text: async () => {
      throw {};
    },
  });
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: validRequest() }))[UPDATE_ADDRESS_GROUP_PATH](),
    'UNKNOWN',
    (err, payload) => {
      assert.equal(payload.http_status, 0);
      assert.equal(payload.reason, 'read response body failed');
    },
  );

  globalThis.fetch = async () => ({
    ok: true,
    text: async () => '',
  });
  const result = await rpcdef(buildCtx({
    req: validRequest(),
    meta: {},
  }))[UPDATE_ADDRESS_GROUP_PATH]();
  assert.equal(result.http_status, 0);

  const originalLog = console.log;
  const originalStringify = JSON.stringify;
  try {
    console.log = (...args) => {
      captured = args;
    };
    JSON.stringify = () => {
      throw new Error('circular');
    };
    _test.logFlow(null, 'manual', { ok: true });
    assert.equal(captured[0], '[HUAWEI_FW_USG6000E][manual]');
    assert.deepEqual(captured[1], { ok: true });
  } finally {
    console.log = originalLog;
    JSON.stringify = originalStringify;
  }
});
