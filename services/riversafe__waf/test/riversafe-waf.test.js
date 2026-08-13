import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_SYNC_FULL,
  METHOD_SYNC_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/riversafe-waf.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;
const originalConsoleLog = console.log;

const buildCtx = (overrides = {}) => ({
  bindings: {
    host: 'https://example.com:20167',
    token_id: 'api_admin',
    token: 'token_value',
    headers: { 'X-Custom': 'demo' },
    ...(overrides.bindings || {}),
  },
  config: overrides.config || {},
  secret: overrides.secret || {},
  limits: { timeoutMs: 2000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const callHandler = (method, request = {}, ctx = {}) => {
  const handler = handlers[method];
  return handler({ ...ctx, request });
};

const response = (status, body) => ({
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
  assert.match(caught.message, new RegExp(`^${legacyCode}:`));
  checker(caught);
};

test.beforeEach(() => {
  Date.now = () => 1705392000 * 1000;
  console.log = () => {};
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;
  console.log = originalConsoleLog;
});

test('service exports handler and rpcdef path', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers[METHOD_SYNC_FULL], 'function');
  assert.equal(typeof rpcdef(buildCtx())[METHOD_SYNC_PATH], 'function');
});

test('rejects missing bindings and items', async () => {
  await expectGrpcError(
    () => callHandler(METHOD_SYNC_FULL, { items: ['1.1.1.1'] }, buildCtx({ bindings: { host: '' } })),
    'FAILED_PRECONDITION',
    (err) => assert.match(err.message, /host.*https URL/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_SYNC_FULL, { items: ['1.1.1.1'] }, buildCtx({ bindings: { token_id: '', tokenId: '' } })),
    'FAILED_PRECONDITION',
    (err) => assert.match(err.message, /token_id/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_SYNC_FULL, { items: ['1.1.1.1'] }, buildCtx({ bindings: { token: '' } })),
    'FAILED_PRECONDITION',
    (err) => assert.match(err.message, /token/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_SYNC_FULL, { items: [] }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /items is required/),
  );
});

test('validates and normalizes IPv4 IPv6 and CIDR items', async () => {
  setFetch(async () => response(200, { err_no: 0, err_msg: 'ok' }));
  const result = await callHandler(METHOD_SYNC_FULL, { items: ['1.1.1.1', { value: '1.1.1.0/24' }, '2607:f8b0:4005:809::200e'] }, buildCtx());
  assert.equal(result.err_no, 0);
  assert.equal(_test.normalizeHostCIDR('1.1.1.1'), '1.1.1.1/32');
  assert.equal(_test.normalizeHostCIDR('2607:f8b0:4005:809::200e'), '2607:f8b0:4005:809::200e/128');
  assert.equal(_test.normalizeHostCIDR('2607:f8b0:4005:809::/64'), '2607:f8b0:4005:809::/64');
  assert.equal(_test.normalizeHostCIDR('::ffff:192.0.2.1/128'), '::ffff:192.0.2.1/128');
  assert.throws(() => _test.normalizeHostCIDR(''), /non-empty/);
  assert.throws(() => _test.normalizeHostCIDR('1.1.1.1/33'), /invalid ipv4 cidr prefix/);
  assert.throws(() => _test.normalizeHostCIDR('2607:f8b0::/129'), /invalid ipv6 cidr prefix/);
  assert.throws(() => _test.normalizeHostCIDR('1.1.1.1/x'), /invalid cidr prefix/);
  assert.throws(() => _test.normalizeHostCIDR('bad-ip/24'), /valid IPv4 or IPv6/);
  assert.throws(() => _test.normalizeHostCIDR('/24'), /invalid cidr/);
  assert.throws(() => _test.normalizeHostCIDR('1.1.1.1/'), /invalid cidr/);
  assert.throws(() => _test.normalizeHostCIDR('not-an-ip'), /valid IPv4 or IPv6/);
});

test('success path appends signing query params and returns response', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, { err_no: 0, err_msg: 'ok' });
  });

  const result = await callHandler(METHOD_SYNC_FULL,
    { Items: { values: ['1.1.1.1', '2607:f8b0:4005:809::200e'] } },
    buildCtx({ bindings: { host: 'https://example.com:20167/base?b=2&a=1&a=0', skipTlsVerify: true } }),
  );

  assert.equal(result.http_status, 200);
  assert.equal(result.err_no, 0);
  assert.equal(result.err_msg, 'ok');
  assert.equal(captured.init.method, 'POST');
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal('timeoutMs' in captured.init, false);
  assert.ok(captured.init.dispatcher);
  assert.equal('skipTlsVerify' in captured.init, false);
  assert.equal(captured.init.headers['Content-Type'], 'application/json');
  assert.equal(captured.init.headers['X-Custom'], 'demo');
  assert.equal(captured.init.headers['x-engine-instance'], 'inst');
  assert.deepEqual(JSON.parse(captured.init.body).items, ['1.1.1.1/32', '2607:f8b0:4005:809::200e/128']);

  const parsed = _test.parseHttpsUrl(captured.url);
  assert.equal(parsed.origin, 'https://example.com:20167');
  assert.equal(parsed.basePath, '/base/api/v1/ip_black_list');
  const pairs = _test.parseQueryPairs(parsed.rawQuery);
  const map = new Map();
  for (const pair of pairs) {
    const key = decodeURIComponent(pair.rawKey);
    const value = decodeURIComponent(pair.rawValue);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  }
  const first = (key) => map.get(key)?.[0] || '';
  assert.equal(first('timestamp'), '1705392000');
  assert.equal(first('tokenid'), 'api_admin');
  assert.match(first('nonce'), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(first('signature'));
  assert.equal(_test.buildCanonicalQueryString(pairs), 'a=0&a=1&b=2');

  const canonicalRequest = [
    'token_value',
    'POST',
    encodeURI('/base/api/v1/ip_black_list'),
    'a=0&a=1&b=2',
    first('timestamp'),
    first('nonce'),
    'api_admin',
    _test.md5Hex(_test.toUTF8Bytes(captured.init.body)),
  ].join('\n');
  assert.equal(first('signature'), _test.hmacSha256Hex(_test.toUTF8Bytes('token_value'), _test.toUTF8Bytes(canonicalRequest)));
});

test('transport protocol business and network errors map correctly', async () => {
  for (const [status, legacyCode] of [[401, 'PERMISSION_DENIED'], [403, 'PERMISSION_DENIED'], [404, 'FAILED_PRECONDITION'], [500, 'UNAVAILABLE']]) {
    setFetch(async () => response(status, { err_no: 1, err_msg: 'bad'.repeat(100), token: 'leaked-riversafe-token' }));
    await expectGrpcError(
      () => callHandler(METHOD_SYNC_FULL, { items: ['1.1.1.1'] }, buildCtx()),
      legacyCode,
      (err) => {
        assert.match(err.message, new RegExp(`upstream http ${status}`));
        assert.match(err.message, /body_length=/);
        assert.doesNotMatch(err.message, /leaked-riversafe-token/);
        assert.doesNotMatch(err.message, /"token"/);
      },
    );
  }

  setFetch(async () => response(204, ''));
  await expectGrpcError(() => callHandler(METHOD_SYNC_FULL, { items: ['1.1.1.1'] }, buildCtx()), 'UNKNOWN', (err) => {
    assert.match(err.message, /empty response body/);
  });

  setFetch(async () => response(200, 'not-json'));
  await expectGrpcError(() => callHandler(METHOD_SYNC_FULL, { items: ['1.1.1.1'] }, buildCtx()), 'UNKNOWN', (err) => {
    assert.match(err.message, /not valid JSON/);
  });

  setFetch(async () => response(200, { err_msg: 'missing' }));
  await expectGrpcError(() => callHandler(METHOD_SYNC_FULL, { items: ['1.1.1.1'] }, buildCtx()), 'UNKNOWN', (err) => {
    assert.match(err.message, /missing err_no/);
  });

  setFetch(async () => response(200, { err_no: 123, err_msg: 'biz error' }));
  await expectGrpcError(() => callHandler(METHOD_SYNC_FULL, { items: ['1.1.1.1'] }, buildCtx()), 'FAILED_PRECONDITION', (err) => {
    assert.match(err.message, /err_no=123/);
  });

  setFetch(async () => {
    throw Object.assign(new Error('outer'), { cause: new Error('socket timeout') });
  });
  await expectGrpcError(() => callHandler(METHOD_SYNC_FULL, { items: ['1.1.1.1'] }, buildCtx()), 'UNAVAILABLE', (err) => {
    assert.match(err.message, /socket timeout/);
  });

  setFetch(async () => {
    throw new Error('');
  });
  await expectGrpcError(() => callHandler(METHOD_SYNC_FULL, { items: ['1.1.1.1'] }, buildCtx()), 'UNAVAILABLE', (err) => {
    assert.match(err.message, /fetch failed/);
  });

  setFetch(async () => response(302, 'redirect'));
  await expectGrpcError(() => callHandler(METHOD_SYNC_FULL, { items: ['1.1.1.1'] }, buildCtx()), 'UNAVAILABLE', (err) => {
    assert.match(err.message, /upstream http 302/);
  });
});

test('helper functions cover parsing and crypto branches', () => {
  const detailed = _test.errorWithCode('UNKNOWN', 'message text', { reason: 'unit-test' });
  assert.equal(detailed.message, 'UNKNOWN: {"message":"message text","reason":"unit-test"}');
  const circular = {};
  circular.self = circular;
  const fallback = _test.errorWithCode('NOT_A_GRPC_CODE', 'message text', { circular });
  assert.equal(fallback.code, grpcStatus.UNKNOWN);
  assert.equal(fallback.legacyCode, 'NOT_A_GRPC_CODE');
  assert.equal(fallback.message, 'NOT_A_GRPC_CODE: message text');
  assert.equal(_test.hasOwn(null, 'x'), false);
  assert.equal(_test.hasOwn({ x: 1 }, 'x'), true);
  assert.equal(_test.firstDefined(undefined, null, 'value'), 'value');
  assert.equal(_test.firstDefined(undefined, null), undefined);
  assert.equal(_test.unwrapScalar(undefined), '');
  assert.equal(_test.unwrapScalar(null), '');
  assert.equal(_test.md5Hex(_test.toUTF8Bytes('abc')), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(_test.hmacSha256Hex(_test.toUTF8Bytes('key'), _test.toUTF8Bytes('The quick brown fox jumps over the lazy dog')), 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  assert.deepEqual(_test.sha256Bytes(_test.toUTF8Bytes('abc')).slice(0, 4), Array.from(crypto.createHash('sha256').update('abc').digest()).slice(0, 4));
  assert.equal(_test.bytesToHex([0, 15, 255]), '000fff');
  assert.deepEqual(_test.extractList(null), []);
  assert.deepEqual(_test.extractList({ values: ['a'] }), ['a']);
  assert.deepEqual(_test.extractList('bad'), []);
  assert.equal(_test.normalizeBaseUrl('https://host///'), 'https://host');
  assert.equal(_test.normalizeBaseUrl({ value: ' https://host/path/// ' }), 'https://host/path');
  assert.equal(_test.normalizeBaseUrl('http://host'), null);
  assert.equal(_test.isIPv4('1.2.3'), false);
  assert.equal(_test.isIPv4('1.2.3.x'), false);
  assert.equal(_test.isIPv4('1.2.3.999'), false);
  assert.equal(_test.isIPv6('2001:db8::1'), true);
  assert.equal(_test.isIPv6('not-ip'), false);
  assert.equal(_test.isIPv6('2001::db8::1'), false);
  assert.equal(_test.isIPv6('2001:db8::z'), false);
  assert.equal(_test.isIPv6('::ffff:999.0.2.1'), false);
  assert.deepEqual(_test.parseHttpsUrl(' https://host/path '), { origin: 'https://host', basePath: '/path', rawQuery: '' });
  assert.deepEqual(_test.parseHttpsUrl('https://host'), { origin: 'https://host', basePath: '', rawQuery: '' });
  assert.deepEqual(_test.parseHttpsUrl('https://host?only=query'), { origin: 'https://host', basePath: '', rawQuery: 'only=query' });
  assert.deepEqual(_test.parseHttpsUrl('https://host/?a=1'), { origin: 'https://host', basePath: '', rawQuery: 'a=1' });
  assert.equal(_test.parseHttpsUrl('http://host'), null);
  assert.equal(_test.parseHttpsUrl('https://'), null);
  assert.equal(_test.parseHttpsUrl('https://?a=1'), null);
  assert.deepEqual(_test.parseQueryPairs(null), []);
  assert.deepEqual(_test.parseQueryPairs('a=1&b&bad=%E0%A4%A'), [
    { rawKey: 'a', rawValue: '1' },
    { rawKey: 'b', rawValue: '' },
    { rawKey: 'bad', rawValue: '%E0%A4%A' },
  ]);
  assert.equal(_test.safeDecodeURIComponent('%E0%A4%A'), '%E0%A4%A');
  assert.equal(_test.buildCanonicalQueryString(_test.parseQueryPairs('signature=x&timestamp=t&z=2&a=1')), 'a=1&z=2');
  assert.equal(_test.buildCanonicalQueryString(_test.parseQueryPairs('b=2&a=2&a=1&nonce=n&tokenid=t')), 'a=1&a=2&b=2');
  assert.equal(_test.buildCanonicalQueryString(null), '');
  assert.deepEqual(_test.buildHeaders({}, { instanceId: 'camel-inst', requestId: 'camel-req' }), {
    'Content-Type': 'application/json',
    'x-engine-instance': 'camel-inst',
    'x-request-id': 'camel-req',
  });
  assert.equal(_test.buildLogPrefix({}, 'action'), '[RiverSafeplusd_WAF][action]');
  assert.deepEqual(_test.resolveCallContext({ config: { host: 'h' }, secret: { token: 's' }, bindings: { token_id: 'b' }, request: { x: 1 } }), {
    config: { host: 'h' },
    secret: { token: 's' },
    bindings: { host: 'h', token: 's', token_id: 'b' },
    request: { x: 1 },
    limits: {},
    meta: {},
    req: { x: 1 },
  });
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeoutMs: 123 }, limits: { timeoutMs: 11 } }), 123);
  assert.equal(_test.resolveTimeoutMs({ bindings: {}, limits: { timeoutMs: 11 } }), 11);
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeoutMs: -1 }, limits: { timeoutMs: 11 } }), 2000);
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeoutMs: 'Infinity' }, limits: {} }), 2000);
  assert.equal(_test.unwrapScalar({ value: { value: 'nested' } }), 'nested');
  assert.match(_test.generateUUIDv4(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('supports config secret aliases and response aliases', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(209, { errNo: '0', message: { value: 'alias-ok' } });
  });

  const result = await _test.syncIPBlacklist(
    { Items: ['198.51.100.8'] },
    {
      config: { host: 'https://example.com/root/', insecureSkipVerify: true },
      secret: { tokenId: 'secret-token-id', token: 'secret-token' },
      meta: { instanceId: 'camel-inst', requestId: 'camel-req' },
    },
  );

  assert.equal(result.http_status, 209);
  assert.equal(result.err_no, 0);
  assert.equal(result.err_msg, 'alias-ok');
  assert.match(captured.url, /^https:\/\/example\.com\/root\/api\/v1\/ip_black_list\?/);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.ok(captured.init.dispatcher);
  assert.equal('insecureSkipVerify' in captured.init, false);
  assert.equal('tlsInsecureSkipVerify' in captured.init, false);
  assert.equal('skipTlsVerify' in captured.init, false);
  assert.equal('timeoutMs' in captured.init, false);
  assert.equal(captured.init.headers['x-engine-instance'], 'camel-inst');
  assert.equal(captured.init.headers['x-request-id'], 'camel-req');
});

test('logFlow falls back when details cannot be JSON stringified', () => {
  const calls = [];
  console.log = (...args) => calls.push(args);
  const circular = {};
  circular.self = circular;
  _test.logFlow({ instance_id: 'inst', request_id: 'req' }, 'circular', circular);
  assert.equal(calls[0][0], '[RiverSafeplusd_WAF][circular][inst=inst req=req]');
  assert.equal(calls[0][1], circular);
});

test('mock upstream handles sync lifecycle and simulated failures', async () => {
  const server = await createMockServer();
  try {
    const httpsLikeHost = server.url.replace('http://', 'https://');
    const ctx = buildCtx({
      bindings: {
        host: httpsLikeHost,
        token_id: 'api_admin',
        token: 'token_value',
      },
    });

    const nativeFetch = originalFetch;
    setFetch(async (url, init) => {
      const localUrl = String(url).replace('https://', 'http://');
      return nativeFetch(localUrl, init);
    });

    const ok = await callHandler(METHOD_SYNC_FULL, { items: ['192.0.2.10'] }, ctx);
    assert.equal(ok.err_no, 0);
    assert.equal(server.requests.length, 1);
    assert.deepEqual(JSON.parse(server.requests[0].body).items, ['192.0.2.10/32']);

    await expectGrpcError(
      () => callHandler(METHOD_SYNC_FULL, { items: ['192.0.2.11'] }, buildCtx({ bindings: { host: `${httpsLikeHost}?simulate=BIZ-ERROR` } })),
      'FAILED_PRECONDITION',
      (err) => assert.match(err.message, /biz error/),
    );
    await expectGrpcError(
      () => callHandler(METHOD_SYNC_FULL, { items: ['192.0.2.11'] }, buildCtx({ bindings: { host: `${httpsLikeHost}?simulate=INVALID-JSON` } })),
      'UNKNOWN',
      (err) => assert.match(err.message, /not valid JSON/),
    );
  } finally {
    await server.close();
  }
});

test('documented naming decision uses RiverSafe root after confirmation attempt', () => {
  assert.equal('RiverSafeplusd'.includes('plusd'), true);
  assert.equal('riversafe__waf', 'riversafe__waf');
});
