import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_DOMAIN_QUERY_FULL,
  METHOD_DOMAIN_QUERY_PATH,
  METHOD_IP_REPUTATION_FULL,
  METHOD_IP_REPUTATION_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/threatbook-cloudapi-v3.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;

const response = (status, body) => ({
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const setFetch = (impl) => {
  globalThis.fetch = impl;
};

const buildCtx = (overrides = {}) => ({
  config: {
    threatbook_domain: 'https://api.threatbook.cn',
    ...(overrides.config || {}),
  },
  secret: {
    threatbook_apikey: 'test_api_key',
    ...(overrides.secret || {}),
  },
  bindings: {
    ...(overrides.bindings || {}),
  },
  limits: { timeoutMs: 10_000, ...(overrides.limits || {}) },
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

const parseStructuredError = (err) => JSON.parse(err.message);

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('service exports handlers and rpcdef paths', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers[METHOD_IP_REPUTATION_FULL], 'function');
  assert.equal(typeof handlers[METHOD_DOMAIN_QUERY_FULL], 'function');
  const defs = rpcdef(buildCtx());
  assert.equal(typeof defs[METHOD_IP_REPUTATION_PATH], 'function');
  assert.equal(typeof defs[METHOD_DOMAIN_QUERY_PATH], 'function');
});

test('validates required bindings and resource', async () => {
  await expectGrpcError(
    () => callHandler(METHOD_IP_REPUTATION_FULL, { resource: '8.8.8.8' }, buildCtx({ config: { threatbook_domain: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /threatbook_domain/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_IP_REPUTATION_FULL, { resource: '8.8.8.8' }, buildCtx({ secret: { threatbook_apikey: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /threatbook_apikey/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_IP_REPUTATION_FULL, {}, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /resource is required/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_DOMAIN_QUERY_FULL, { domain: { value: '   ' } }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /resource is required/),
  );
  assert.throws(
    () => _test.requireDomain({ bindings: { threatbook_domain: 'ftp://bad' } }),
    (err) => {
      assert.equal(err.legacyCode, 'INVALID_ARGUMENT');
      assert.match(err.message, /threatbook_domain/);
      return true;
    },
  );
  assert.throws(
    () => _test.requireApiKey({ bindings: { apiKey: ' ' } }),
    (err) => {
      assert.equal(err.legacyCode, 'INVALID_ARGUMENT');
      assert.match(err.message, /threatbook_apikey/);
      return true;
    },
  );
});

test('IpReputation sends default query and returns raw body and raw json', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, { response_code: 0, verbose_msg: 'OK', data: { risk: 'low' } });
  });

  const result = await callHandler(METHOD_IP_REPUTATION_FULL,
    { ip: { value: ' 8.8.8.8 ' } },
    buildCtx({ bindings: { skipTlsVerify: true }, limits: { timeoutMs: 25 } }),
  );

  const url = new URL(captured.url);
  assert.equal(`${url.origin}${url.pathname}`, 'https://api.threatbook.cn/1.1.1/scene/ip_reputation');
  assert.equal(url.searchParams.get('apikey'), 'test_api_key');
  assert.equal(url.searchParams.get('lang'), 'zh');
  assert.equal(url.searchParams.get('resource'), '8.8.8.8');
  assert.equal(captured.init.method, 'GET');
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.init.timeoutMs, undefined);
  assert.equal(captured.init.dispatcher, _test.insecureTlsDispatcher);
  assert.equal(captured.init.skipTlsVerify, undefined);
  assert.equal(captured.init.tlsInsecureSkipVerify, undefined);
  assert.equal(captured.init.insecureSkipVerify, undefined);
  assert.equal(result.http_status, 200);
  assert.equal(result.raw_body, '');
  assert.equal(result.raw_json, undefined);
});

test('DomainQuery sends default exclude and supports aliases', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, { responseCode: 0, verboseMsg: 'OK', data: { kind: 'domain_query' } });
  });

  const result = await callHandler(METHOD_DOMAIN_QUERY_FULL,
    { domain: 'example.com', lang: 'en' },
    buildCtx({
      config: { threatbook_domain: undefined, domain: ' http://mock.local/ ' },
      secret: { threatbook_apikey: undefined, apiKey: 'alias_key' },
      bindings: { timeoutMs: 30 },
      limits: { timeoutMs: 40 },
    }),
  );

  const url = new URL(captured.url);
  assert.equal(`${url.origin}${url.pathname}`, 'http://mock.local/1.1.1/domain/query');
  assert.equal(url.searchParams.get('apikey'), 'alias_key');
  assert.equal(url.searchParams.get('lang'), 'en');
  assert.equal(url.searchParams.get('resource'), 'example.com');
  assert.equal(url.searchParams.get('exclude'), 'cas');
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.init.timeoutMs, undefined);
  assert.equal(result.raw_json, undefined);
});

test('DomainQuery sends explicit exclude from scalar wrapper', async () => {
  let captured;
  setFetch(async (url) => {
    captured = String(url);
    return response(200, { response_code: 0, verbose_msg: 'OK', data: null });
  });

  await rpcdef(buildCtx())[METHOD_DOMAIN_QUERY_PATH]({
    resource: 'example.org',
    lang: { value: 'zh' },
    exclude: { value: 'intel' },
  });

  const url = new URL(captured);
  assert.equal(url.searchParams.get('exclude'), 'intel');
});

test('request fields cannot override secret and structured errors redact api key', async () => {
  let captured;
  setFetch(async (url) => {
    captured = String(url);
    return response(200, {
      response_code: 1400,
      verbose_msg: 'upstream echoed test_api_key',
      data: {},
    });
  });

  await expectGrpcError(
    () => callHandler(METHOD_IP_REPUTATION_FULL, {
      resource: '8.8.8.8',
      apikey: 'request_supplied_key',
      apiKey: 'request_supplied_key',
    }, buildCtx()),
    'FAILED_PRECONDITION',
    (err) => {
      assert.equal(new URL(captured).searchParams.get('apikey'), 'test_api_key');
      assert.doesNotMatch(err.message, /test_api_key/);
      assert.doesNotMatch(err.message, /request_supplied_key/);
      assert.equal(parseStructuredError(err).verbose_msg, 'upstream echoed <redacted>');
    },
  );
});

test('maps HTTP, business, JSON, and response_code failures to structured errors', async () => {
  setFetch(async () => response(401, { response_code: 1101, verbose_msg: 'invalid apikey' }));
  await expectGrpcError(
    () => callHandler(METHOD_IP_REPUTATION_FULL, { resource: '8.8.8.8' }, buildCtx()),
    'PERMISSION_DENIED',
    (err) => {
      const payload = parseStructuredError(err);
      assert.equal(payload.http_status, 401);
      assert.equal(payload.reason, 'upstream http 401');
      assert.equal(payload.raw_json, undefined);
      assert.ok(payload.raw_body_length > 0);
    },
  );

  setFetch(async () => response(403, { response_code: 1103, verbose_msg: 'forbidden' }));
  await expectGrpcError(
    () => callHandler(METHOD_IP_REPUTATION_FULL, { resource: '8.8.8.8' }, buildCtx()),
    'PERMISSION_DENIED',
    (err) => assert.equal(parseStructuredError(err).http_status, 403),
  );

  setFetch(async () => response(404, { response_code: 1204, verbose_msg: 'not found' }));
  await expectGrpcError(
    () => callHandler(METHOD_IP_REPUTATION_FULL, { resource: '8.8.8.8' }, buildCtx()),
    'FAILED_PRECONDITION',
    (err) => assert.equal(parseStructuredError(err).http_status, 404),
  );

  setFetch(async () => response(429, { response_code: 1429, verbose_msg: 'rate limited' }));
  await expectGrpcError(
    () => callHandler(METHOD_IP_REPUTATION_FULL, { resource: '8.8.8.8' }, buildCtx()),
    'FAILED_PRECONDITION',
    (err) => assert.equal(parseStructuredError(err).reason, 'upstream http 429'),
  );

  setFetch(async () => response(503, { message: 'down' }));
  await expectGrpcError(
    () => callHandler(METHOD_IP_REPUTATION_FULL, { resource: '8.8.8.8' }, buildCtx()),
    'UNAVAILABLE',
    (err) => assert.equal(parseStructuredError(err).http_status, 503),
  );

  setFetch(async () => response(200, { response_code: 1400, verbose_msg: 'business failed', data: {} }));
  await expectGrpcError(
    () => callHandler(METHOD_IP_REPUTATION_FULL, { resource: '8.8.8.8' }, buildCtx()),
    'FAILED_PRECONDITION',
    (err) => {
      const payload = parseStructuredError(err);
      assert.equal(payload.response_code, 1400);
      assert.equal(payload.verbose_msg, 'business failed');
      assert.equal(payload.reason, 'response_code != 0');
    },
  );

  setFetch(async () => response(200, 'not-json'));
  await expectGrpcError(
    () => callHandler(METHOD_IP_REPUTATION_FULL, { resource: '8.8.8.8' }, buildCtx()),
    'UNKNOWN',
    (err) => assert.equal(parseStructuredError(err).reason, 'response is not valid JSON'),
  );

  setFetch(async () => response(200, { verbose_msg: 'missing code' }));
  await expectGrpcError(
    () => callHandler(METHOD_IP_REPUTATION_FULL, { resource: '8.8.8.8' }, buildCtx()),
    'UNKNOWN',
    (err) => assert.equal(parseStructuredError(err).reason, 'response_code missing'),
  );
});

test('maps network and response read errors', async () => {
  setFetch(async () => {
    throw Object.assign(new Error('outer'), { cause: new Error('connection refused') });
  });
  await expectGrpcError(
    () => callHandler(METHOD_IP_REPUTATION_FULL, { resource: '8.8.8.8' }, buildCtx()),
    'UNAVAILABLE',
    (err) => {
      const payload = parseStructuredError(err);
      assert.equal(payload.http_status, 0);
      assert.equal(payload.raw_body, '');
      assert.equal(payload.reason, 'connection refused');
    },
  );

  setFetch(async () => ({
    status: 200,
    text: async () => {
      throw new Error('read failed');
    },
  }));
  await expectGrpcError(
    () => callHandler(METHOD_IP_REPUTATION_FULL, { resource: '8.8.8.8' }, buildCtx()),
    'UNAVAILABLE',
    (err) => {
      const payload = parseStructuredError(err);
      assert.equal(payload.http_status, 200);
      assert.equal(payload.reason, 'read failed');
    },
  );
});

test('DomainQuery exposes upstream failure mapping', async () => {
  setFetch(async () => response(500, { message: 'domain query down' }));
  await expectGrpcError(
    () => callHandler(METHOD_DOMAIN_QUERY_FULL, { resource: 'example.com' }, buildCtx()),
    'UNAVAILABLE',
    (err) => assert.equal(parseStructuredError(err).http_status, 500),
  );
});

test('rpcdef falls back to context request when call request is omitted', async () => {
  setFetch(async () => response(200, { response_code: 0, verbose_msg: 'OK', data: { resource: '1.1.1.1' } }));
  const result = await rpcdef(buildCtx({ req: { resource: '1.1.1.1' } }))[METHOD_IP_REPUTATION_PATH]();
  assert.equal(result.raw_json, undefined);
});

test('helper functions cover normalization branches', () => {
  assert.equal(_test.grpcCodeFor('NOPE'), grpcStatus.UNKNOWN);
  assert.equal(_test.errorWithCode('NOPE', 'bad').code, grpcStatus.UNKNOWN);
  assert.equal(_test.hasOwn(null, 'x'), false);
  assert.equal(_test.firstDefined(undefined, null, 0, 'x'), 0);
  assert.equal(_test.unwrapScalar({ value: { value: 'nested' } }), 'nested');
  assert.equal(_test.unwrapScalar(undefined), undefined);
  assert.equal(_test.toTrimmedString(null), '');
  assert.equal(_test.normalizeBaseUrl('ftp://bad'), '');
  assert.equal(_test.normalizeBaseUrl(' https://example.com/// '), 'https://example.com');
  assert.equal(_test.resolveDomain({}), '');
  assert.equal(_test.resolveApiKey({}), '');
  assert.equal(_test.resolveDomain({ restBaseUrl: 'https://rest.local/' }), 'https://rest.local');
  assert.equal(_test.resolveApiKey({ apikey: { value: ' key ' } }), 'key');
  assert.equal(_test.resolveCallContext().req != null, true);
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: 'bad' }, bindings: { timeoutMs: -1 } }), 1500);
  assert.equal(_test.resolveTimeoutMs({ limits: {}, bindings: { timeoutMs: 10 } }), 10);
  assert.equal(_test.resolveTimeoutMs(), 1500);
  assert.deepEqual(_test.buildTlsOptions({}), {});
  assert.equal(_test.buildTlsOptions({ insecureSkipVerify: 1 }).dispatcher, _test.insecureTlsDispatcher);
  assert.deepEqual(_test.mergedBindings({ config: { a: 1 }, secret: { b: 2 }, bindings: { a: 3 } }), { a: 3, b: 2 });
  assert.deepEqual(_test.resolveCallContext({ request: { resource: 'r' } }).req, { resource: 'r' });
  assert.equal(_test.requireResource({ ip: '8.8.4.4' }, 'ip'), '8.8.4.4');
  assert.equal(_test.normalizeLang({}), 'zh');
  assert.equal(_test.normalizeLang({ lang: { value: ' en ' } }), 'en');
  assert.equal(_test.normalizeExclude({ exclude: ' ' }), 'cas');
  assert.equal(_test.encodeQueryPairs({ a: 'x y', b: '', c: null, d: 0 }), 'a=x%20y&d=0');
  assert.equal(_test.buildUrl('https://api.local/', '/path', { a: 'b' }), 'https://api.local/path?a=b');
  assert.deepEqual(_test.tryParseJson('{"ok":true}'), { ok: true, value: { ok: true } });
  assert.deepEqual(_test.tryParseJson('bad'), { ok: false });
  assert.deepEqual(_test.toValue(null), undefined);
  assert.deepEqual(_test.toValue(undefined), undefined);
  assert.deepEqual(_test.toValue('x'), { stringValue: 'x' });
  assert.deepEqual(_test.toValue(true), { boolValue: true });
  assert.deepEqual(_test.toValue(Number.NaN), { stringValue: 'NaN' });
  assert.deepEqual(_test.toValue([1, null]), {
    listValue: { values: [{ numberValue: 1 }, { nullValue: 'NULL_VALUE' }] },
  });
  assert.deepEqual(_test.toValue({ a: null }).structValue.fields.a, { nullValue: 'NULL_VALUE' });
  assert.deepEqual(_test.toValue(Symbol.for('x')), { stringValue: 'Symbol(x)' });
  assert.doesNotThrow(() => _test.assertThreatBookSuccess({
    httpStatus: 200,
    rawBody: '{"responseCode":0,"verboseMsg":"OK"}',
  }, { ok: true, value: { responseCode: 0, verboseMsg: 'OK' } }));
  assert.equal(_test.mapHttpStatusToGrpcCode(403), 'PERMISSION_DENIED');
  assert.equal(_test.mapHttpStatusToGrpcCode(400), 'FAILED_PRECONDITION');
  assert.equal(_test.mapHttpStatusToGrpcCode(500), 'UNAVAILABLE');
  assert.equal(_test.mapHttpStatusToGrpcCode(302), 'UNAVAILABLE');
  assert.deepEqual(_test.parseThreatBookResponse({
    httpStatus: 200,
    rawBody: '{"response_code":0,"data":[null]}',
  }).raw_json, undefined);
});

test('throwStructuredError includes optional fields', () => {
  assert.throws(
    () => _test.throwStructuredError('FAILED_PRECONDITION', 'msg', {
      httpStatus: 200,
      rawBody: 'body',
      rawJson: { response_code: 1 },
      responseCode: 1,
      verboseMsg: 'bad',
      reason: 'why',
    }),
    (err) => {
      assert.ok(err instanceof GrpcError);
      const payload = parseStructuredError(err);
      assert.equal(payload.raw_json, undefined);
      assert.ok(payload.raw_body_length > 0);
      assert.equal(payload.response_code, 1);
      assert.equal(payload.verbose_msg, 'bad');
      assert.equal(payload.reason, 'why');
      return true;
    },
  );
});

test('fetchUpstream can be used directly', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, 'ok');
  });
  const result = await _test.fetchUpstream('http://api.local/path', buildCtx({ bindings: { timeoutMs: 15 } }));
  assert.equal(captured.url, 'http://api.local/path');
  assert.equal(captured.init.method, 'GET');
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.init.timeoutMs, undefined);
  assert.deepEqual(result, { httpStatus: 200, rawBody: 'ok' });
});

test('mock upstream handles success and simulated failures', async () => {
  const server = await createMockServer();
  try {
    const ctx = buildCtx({ config: { threatbook_domain: server.url } });
    const ip = await callHandler(METHOD_IP_REPUTATION_FULL, { resource: '8.8.8.8' }, ctx);
    const domain = await callHandler(METHOD_DOMAIN_QUERY_FULL, { resource: 'example.com' }, ctx);
    assert.equal(ip.raw_json, undefined);
    assert.equal(domain.raw_json, undefined);

    await expectGrpcError(() => callHandler(METHOD_IP_REPUTATION_FULL, { resource: 'bizfail.example' }, ctx), 'FAILED_PRECONDITION');
    await expectGrpcError(() => callHandler(METHOD_IP_REPUTATION_FULL, { resource: 'http401.example' }, ctx), 'PERMISSION_DENIED');
    await expectGrpcError(() => callHandler(METHOD_IP_REPUTATION_FULL, { resource: 'http500.example' }, ctx), 'UNAVAILABLE');
    await expectGrpcError(() => callHandler(METHOD_IP_REPUTATION_FULL, { resource: 'invalid-json.example' }, ctx), 'UNKNOWN');

    assert.equal(server.requests[0].path, '/1.1.1/scene/ip_reputation');
    assert.equal(server.requests[1].path, '/1.1.1/domain/query');
    assert.equal(server.requests[1].query.exclude, 'cas');
  } finally {
    await server.close();
  }
});
