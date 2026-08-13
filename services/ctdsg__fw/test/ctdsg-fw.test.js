import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  BLOCK_DOMAIN_PATH,
  BLOCK_IP_PATH,
  METHOD_BLOCK_DOMAIN_FULL,
  METHOD_BLOCK_IP_FULL,
  METHOD_UNBLOCK_DOMAIN_FULL,
  METHOD_UNBLOCK_IP_FULL,
  UNBLOCK_DOMAIN_PATH,
  UNBLOCK_IP_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/ctdsg-fw.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;

const buildCtx = (overrides = {}) => ({
  bindings: {
    host: 'http://127.0.0.1:19090',
    appId: 'mock-app-id',
    secretKey: 'demo-secret',
    headers: { 'X-Extra': 'demo' },
    ...(overrides.bindings || {}),
  },
  config: overrides.config || {},
  secret: overrides.secret || {},
  limits: { timeoutMs: 10_000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const createHeaders = (entries = {}) => {
  const map = new Map();
  for (const [key, value] of Object.entries(entries)) {
    map.set(key, Array.isArray(value) ? value.map(String) : [String(value)]);
  }
  return {
    forEach(callback) {
      for (const [key, values] of map.entries()) {
        for (const value of values) callback(value, key);
      }
    },
    entries() {
      return map.entries();
    },
  };
};

const response = (status, body, headers = {}) => ({
  status,
  headers: createHeaders(headers),
  text: async () => body,
});

const setFetch = (impl) => {
  globalThis.fetch = impl;
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
    INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
    FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
    UNKNOWN: grpcStatus.UNKNOWN,
  })[legacyCode]);
  assert.match(caught.message, new RegExp(`^${legacyCode}:`));
  checker(caught);
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('service exports defineService result and handlers', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers[METHOD_BLOCK_IP_FULL], 'function');
  assert.equal(typeof handlers[METHOD_UNBLOCK_IP_FULL], 'function');
  assert.equal(typeof handlers[METHOD_BLOCK_DOMAIN_FULL], 'function');
  assert.equal(typeof handlers[METHOD_UNBLOCK_DOMAIN_FULL], 'function');
});

test('BlockIP sends signed addblack2 request with newline-separated IPs', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, JSON.stringify({ code: 0, msg: 'ok' }), {
      'content-type': 'application/json',
      'set-cookie': ['sid=abc'],
    });
  });

  const res = await rpcdef(buildCtx({
    req: { ips: ['192.0.2.10', '2001:db8::1'] },
    bindings: { host: 'https://ctdsg.local:9090/', skipTlsVerify: true },
    meta: { instance_id: 'inst-1', request_id: 'req-1' },
  }))[BLOCK_IP_PATH]();

  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['x-engine-instance'], 'inst-1');
  assert.equal(captured.init.headers['x-request-id'], 'req-1');
  assert.equal(captured.init.headers['hy-bz-api-app-id'], 'mock-app-id');
  assert.ok(captured.init.headers['hy-bz-api-timestamp']);
  assert.ok(captured.init.headers['hy-bz-api-signature']);
  assert.equal(captured.init.headers['content-type'], 'application/json');
  assert.equal(captured.url, 'https://ctdsg.local:9090/api.php/inter/Inter?opt=addPatchblack2');

  const body = JSON.parse(captured.init.body);
  assert.deepEqual(body, [{
    action: 'save',
    type: '0',
    time: '1',
    ip_area: '192.0.2.10\n2001:db8::1',
  }]);

  const expectedSig = _test.createSignature(captured.init.body, captured.init.headers['hy-bz-api-timestamp'], 'demo-secret');
  assert.equal(captured.init.headers['hy-bz-api-signature'], expectedSig);
  assert.equal(res.statusCode, 200);
  assert.equal(res.bodyJson.code, 0);
  assert.equal(res.body_json.fields.msg.stringValue, 'ok');
  assert.deepEqual(res.headers.find((h) => h.key === 'set-cookie')?.values, ['sid=abc']);
});

test('BlockDomain sends temporary addblack2 request', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, JSON.stringify({ code: 0, msg: 'ok' }));
  });

  await rpcdef(buildCtx({
    req: {
      domains: ['a.example.com', '*.example.org'],
      permanent: false,
      punish_time: 30,
      time_unit: 1,
    },
  }))[BLOCK_DOMAIN_PATH]();

  assert.equal(captured.url, 'http://127.0.0.1:19090/api.php/inter/Inter?opt=addPatchblack2');
  assert.deepEqual(JSON.parse(captured.init.body), [{
    action: 'save',
    type: '1',
    time: '0',
    domainname: 'a.example.com\n*.example.org',
    punish_time: '30',
    time_unit: '1',
  }]);
});

test('UnblockIP and UnblockDomain map single and multiple targets correctly', async () => {
  const bodies = [];
  setFetch(async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return response(200, JSON.stringify({ code: 0 }));
  });

  await handlers[METHOD_UNBLOCK_IP_FULL]({ ips: ['192.0.2.10'] }, buildCtx());
  await handlers[METHOD_UNBLOCK_DOMAIN_FULL]({ domains: ['a.example.com', 'b.example.com'] }, buildCtx());

  assert.deepEqual(bodies[0], {
    name: '192.0.2.10',
    addr_type: '0',
  });
  assert.deepEqual(bodies[1], {
    name: 'a.example.com\nb.example.com',
    addr_type: '1',
  });
});

test('mock upstream receives signed requests for all CTDSG operations', async () => {
  const server = await createMockServer();
  try {
    const ctx = buildCtx({ bindings: { host: server.url } });
    await handlers[METHOD_BLOCK_IP_FULL]({ ips: ['192.0.2.10'] }, ctx);
    await handlers[METHOD_UNBLOCK_IP_FULL]({ ips: ['192.0.2.10'] }, ctx);
    await handlers[METHOD_BLOCK_DOMAIN_FULL]({ domains: ['demo.example.com'] }, ctx);
    await handlers[METHOD_UNBLOCK_DOMAIN_FULL]({ domains: ['demo.example.com'] }, ctx);

    assert.equal(server.requests.length, 4);
    assert.equal(server.requests[0].query.opt, 'addPatchblack2');
    assert.equal(server.requests[0].body[0].ip_area, '192.0.2.10');
    assert.equal(server.requests[1].query.opt, 'delblack2');
    assert.equal(server.requests[1].body.addr_type, '0');
    assert.equal(server.requests[2].body[0].domainname, 'demo.example.com');
    assert.equal(server.requests[3].body.addr_type, '1');
    for (const req of server.requests) {
      assert.ok(req.headers['hy-bz-api-app-id']);
      assert.ok(req.headers['hy-bz-api-timestamp']);
      assert.ok(req.headers['hy-bz-api-signature']);
    }
  } finally {
    await server.close();
  }
});

test('validation rejects missing config, invalid targets, and invalid temporary timing', async () => {
  await expectGrpcError(
    () => rpcdef(buildCtx({ bindings: { host: '', secretKey: 'x' }, req: { ips: ['192.0.2.1'] } }))[BLOCK_IP_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /host\/baseUrl is required/),
  );
  assert.throws(
    () => _test.resolveSecretKey({ req: { secretKey: '' }, bindings: {} }),
    /INVALID_ARGUMENT: secretKey is required/,
  );
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { ips: ['bad-ip'] } }))[BLOCK_IP_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /must be a valid IP address/),
  );
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { domains: ['bad domain'] } }))[BLOCK_DOMAIN_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /must be a valid domain/),
  );
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { domains: ['a.example.com'], permanent: false, time_unit: 2 } }))[BLOCK_DOMAIN_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /punish_time must be a positive integer/),
  );
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { ips: ['192.0.2.1'], permanent: false, punish_time: 1, time_unit: 9 } }))[BLOCK_IP_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /time_unit must be one of 1, 2, or 3/),
  );
});

test('non-JSON body is preserved as raw text with empty parsed object', async () => {
  setFetch(async () => response(403, 'permission denied'));

  const res = await rpcdef(buildCtx({ req: { ips: ['192.0.2.10'] } }))[BLOCK_IP_PATH]();

  assert.equal(res.statusCode, 403);
  assert.equal(res.rawBody, 'permission denied');
  assert.deepEqual(res.bodyJson, {});
  assert.deepEqual(res.body_json, { fields: {} });
});

test('network failures map to UNAVAILABLE', async () => {
  setFetch(async () => {
    throw Object.assign(new Error('boom'), { cause: new Error('socket hang up') });
  });

  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { ips: ['192.0.2.10'] } }))[BLOCK_IP_PATH](),
    'UNAVAILABLE',
    (err) => assert.match(err.message, /socket hang up/),
  );
});

test('helpers cover parsing, aliases, signatures, timing, and normalization branches', async () => {
  assert.equal(_test.normalizeString({ value: ' x ' }), 'x');
  assert.equal(_test.normalizeString(null), '');
  assert.equal(_test.optionalString('  '), undefined);
  assert.equal(_test.optionalString(' value '), 'value');
  assert.equal(_test.optionalUint32({ value: 321 }), 321);
  assert.equal(_test.optionalUint32('42.9'), 42);
  assert.equal(_test.optionalUint32(-1), undefined);
  assert.equal(_test.optionalBoolean(true), true);
  assert.equal(_test.optionalBoolean(0), false);
  assert.equal(_test.optionalBoolean(2), true);
  assert.equal(_test.optionalBoolean('0'), false);
  assert.equal(_test.optionalBoolean(undefined), undefined);
  assert.equal(_test.optionalBoolean('maybe'), undefined);
  assert.equal(_test.normalizeBaseUrl('https://example.test///'), 'https://example.test');
  assert.equal(_test.normalizeBaseUrl('example.test'), '');
  assert.throws(() => _test.resolveAppId({ req: {}, bindings: {} }), /INVALID_ARGUMENT: appId is required/);
  assert.equal(_test.resolveAppId({ req: { app_id: 'req-app' }, bindings: {} }), 'req-app');
  assert.equal(_test.resolveAppId({ req: {}, bindings: { app_id: 'binding-app' } }), 'binding-app');
  assert.equal(_test.resolveApiPath({ req: {}, bindings: {} }), '/api.php/inter/Inter');
  assert.equal(_test.resolveApiPath({ req: { api_path: 'api.php/inter/Inter' }, bindings: {} }), '/api.php/inter/Inter');
  assert.equal(_test.resolveApiPath({ req: {}, bindings: { apiPath: '/custom/path' } }), '/custom/path');
  assert.equal(_test.resolveHost({ req: { host: 'https://req-host.test/' }, bindings: {} }), 'https://req-host.test');
  assert.equal(_test.resolveHost({ req: { base_url: 'https://req.test/' }, bindings: {} }), 'https://req.test');
  assert.equal(_test.resolveHost({ req: {}, bindings: { restBaseUrl: 'https://binding.test/' } }), 'https://binding.test');
  assert.equal(_test.resolveSecretKey({ req: {}, bindings: { secret_key: 's' } }), 's');
  assert.equal(_test.resolveTimeoutMs({ req: { timeout_ms: 111 }, bindings: { timeoutMs: 222 }, limits: { timeoutMs: 333 } }), 111);
  assert.equal(_test.resolveTimeoutMs({ req: {}, bindings: { timeout_ms: 223 }, limits: { timeoutMs: 333 } }), 223);
  assert.equal(_test.resolveTimeoutMs({ req: {}, bindings: {}, limits: {} }), 5000);
  assert.deepEqual(_test.resolveCallContext({ config: { host: 'h' }, secret: { secretKey: 's' }, bindings: { headers: { a: '1' } }, request: { ips: ['1.1.1.1'] } }).bindings, {
    host: 'h',
    secretKey: 's',
    headers: { a: '1' },
  });
  assert.equal(_test.toBoolean('on'), true);
  assert.equal(_test.toBoolean('off'), false);
  assert.equal(_test.toBoolean(true), true);
  assert.equal(_test.toBoolean(0), false);
  assert.equal(_test.toBoolean('maybe'), false);
  assert.equal(_test.toBoolean(undefined), false);
  assert.equal(_test.shouldSkipTlsVerify({ bindings: {} }), false);
  assert.equal(_test.shouldSkipTlsVerify({ bindings: { skipTlsVerify: true } }), true);
  assert.equal(_test.shouldSkipTlsVerify({ bindings: { tlsInsecureSkipVerify: true } }), true);
  assert.equal(_test.shouldSkipTlsVerify({ bindings: { insecureSkipVerify: 'yes' } }), true);
  assert.deepEqual(_test.buildHeaders({ bindings: {}, meta: { instanceId: 'camel-inst', requestId: 'camel-req' } }), {
    'x-engine-instance': 'camel-inst',
    'x-request-id': 'camel-req',
  });
  assert.equal(_test.buildUrl('http://x.test/', '/p', { a: 'x y', b: ['1', '2'], c: '', d: null }), 'http://x.test/p?a=x%20y&b=1&b=2');
  assert.equal(_test.buildUrl('http://x.test', '', {}), 'http://x.test/');
  assert.equal(_test.toBodyJson({ a: 1 }), '{"a":1}');
  assert.equal(_test.createSignature('{"a":1}', '1700000000', 'secret'), '062632a8b32eae3c145fe84dd4ba4be4');
  assert.deepEqual(_test.validateBlockTiming({ permanent: true }), { permanent: true });
  assert.deepEqual(_test.validateBlockTiming({ permanent: false, punish_time: 10, time_unit: 2 }), {
    permanent: false,
    punishTime: 10,
    timeUnit: 2,
  });
  assert.equal(_test.isIPv4('192.0.2.1'), true);
  assert.equal(_test.isIPv4('999.0.2.1'), false);
  assert.equal(_test.isIPv6('2001:db8::1'), true);
  assert.equal(_test.isIPv6('gggg::1'), false);
  assert.equal(_test.isIPv6('::ffff:192.0.2.1'), true);
  assert.deepEqual(_test.validateIps(['::ffff:192.0.2.1']), ['::ffff:192.0.2.1']);
  assert.deepEqual(_test.validateIps(['192.0.2.1']), ['192.0.2.1']);
  assert.deepEqual(_test.validateDomains(['*.example.org']), ['*.example.org']);
  assert.deepEqual(_test.validateDomains(['a.example.com']), ['a.example.com']);
  assert.deepEqual(_test.buildBlockBody(['a.example.com'], 1, { permanent: false, punishTime: 5, timeUnit: 3 }), {
    action: 'save',
    type: '1',
    time: '0',
    domainname: 'a.example.com',
    punish_time: '5',
    time_unit: '3',
  });
  assert.deepEqual(_test.buildUnblockBody(['a.example.com', 'b.example.com'], 1), { name: 'a.example.com\nb.example.com', addr_type: '1' });
  const headers = _test.buildSignedHeaders(buildCtx(), '{"a":1}');
  assert.equal(headers['hy-bz-api-app-id'], 'mock-app-id');
  assert.ok(headers['hy-bz-api-timestamp']);
  assert.ok(headers['hy-bz-api-signature']);
  const tlsOptions = _test.buildTlsOptions({ bindings: { skipTlsVerify: true } });
  assert.ok(tlsOptions.dispatcher);
  assert.deepEqual(_test.buildTlsOptions({ bindings: {} }), {});
  assert.deepEqual(_test.toStruct({ a: 1, b: null, c: [true] }), {
    fields: {
      a: { numberValue: 1 },
      b: { nullValue: 'NULL_VALUE' },
      c: { listValue: { values: [{ boolValue: true }] } },
    },
  });
  assert.deepEqual(_test.toValue('x'), { stringValue: 'x' });
  assert.deepEqual(_test.toValue(Symbol.for('x')), { stringValue: 'Symbol(x)' });
  assert.deepEqual(_test.toValue(undefined), { nullValue: 'NULL_VALUE' });
  assert.deepEqual(_test.parseJsonObject(''), {});
  assert.deepEqual(_test.parseJsonObject('[]'), {});
  assert.deepEqual(_test.parseJsonObject('not-json'), {});
  assert.deepEqual(_test.parseJsonObject('{"ok":true}'), { ok: true });
  assert.deepEqual(_test.normalizeResponse(200, [{ key: 'x', values: ['1'] }], '{"ok":true}', 'http://x').bodyJson, { ok: true });
  assert.deepEqual(_test.extractHeaders({ headers: createHeaders({ A: ['1', '2'] }) }), [{ key: 'A', values: ['1', '2'] }]);
  assert.deepEqual(_test.extractHeaders({ headers: { entries: () => [['B', '2']][Symbol.iterator]() } }), [{ key: 'B', values: ['2'] }]);
  assert.equal(_test.isSdkContext({ request: {} }), true);
  assert.equal(_test.isSdkContext({ req: {} }), true);
  assert.equal(_test.isSdkContext({ bindings: {} }), true);
  assert.equal(_test.isSdkContext({ config: {} }), true);
  assert.equal(_test.isSdkContext({ secret: {} }), true);
  assert.equal(_test.isSdkContext({ meta: {} }), true);
  assert.equal(_test.isSdkContext({ limits: {} }), true);
  assert.equal(_test.isSdkContext({}), false);
  const sdkHandler = _test.makeHandler((req, ctx) => ({ req, ctx }));
  assert.deepEqual(sdkHandler({ req: { ips: ['0.0.0.0'] } }).req, { ips: ['0.0.0.0'] });
  assert.deepEqual(sdkHandler({ request: { ips: ['1.1.1.1'] }, config: {} }).req, { ips: ['1.1.1.1'] });
  assert.deepEqual(sdkHandler({ ips: ['2.2.2.2'] }).req, { ips: ['2.2.2.2'] });
  assert.deepEqual(sdkHandler(undefined, undefined).req, {});
  assert.deepEqual(_test.extractHeaders({}), []);
  assert.equal(_test.normalizeResponse(undefined, [], undefined, '').statusCode, 0);
  assert.equal(_test.errorWithCode('FAILED_PRECONDITION', 'bad').legacyCode, 'FAILED_PRECONDITION');
});
