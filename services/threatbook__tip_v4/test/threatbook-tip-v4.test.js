import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_QUERY_IP_REPUTATION_FULL,
  METHOD_QUERY_IP_REPUTATION_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/threatbook-tip-v4.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;
const originalLog = console.log;

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

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalLog;
});

test('service exports handler and rpcdef path', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers[METHOD_QUERY_IP_REPUTATION_FULL], 'function');
  assert.equal(typeof rpcdef(buildCtx())[METHOD_QUERY_IP_REPUTATION_PATH], 'function');
});

test('validates required bindings and ip', async () => {
  await expectGrpcError(
    () => callHandler(METHOD_QUERY_IP_REPUTATION_FULL, { ip: '8.8.8.8' }, buildCtx({ config: { threatbook_domain: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /threatbook_domain/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_QUERY_IP_REPUTATION_FULL, { ip: '8.8.8.8' }, buildCtx({ secret: { threatbook_apikey: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /threatbook_apikey/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_QUERY_IP_REPUTATION_FULL, {}, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /ip is required/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_QUERY_IP_REPUTATION_FULL, { ip: { value: '   ' } }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /ip is required/),
  );
});

test('QueryIPReputation sends request and returns raw HTTP body on success', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, {
      response_code: 0,
      verbose_msg: 'Ok',
      data: [{ intelligence: [{ severity: 'malicious' }], resource: '8.8.8.8' }],
    });
  });

  const result = await callHandler(METHOD_QUERY_IP_REPUTATION_FULL,
    { ip: { value: ' 8.8.8.8 ' } },
    buildCtx({ bindings: { skipTlsVerify: true } }),
  );

  const url = new URL(captured.url);
  assert.equal(`${url.origin}${url.pathname}`, 'https://api.threatbook.cn/tip_api/v4/ip');
  assert.equal(url.searchParams.get('apikey'), 'test_api_key');
  assert.equal(url.searchParams.get('resource'), '8.8.8.8');
  assert.equal(url.searchParams.get('lang'), 'zh');
  assert.equal(captured.init.method, 'GET');
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.init.timeoutMs, undefined);
  assert.equal(captured.init.dispatcher, _test.insecureTlsDispatcher);
  assert.equal(captured.init.skipTlsVerify, undefined);
  assert.equal(captured.init.tlsInsecureSkipVerify, undefined);
  assert.equal(captured.init.insecureSkipVerify, undefined);
  assert.equal(result.http_status, 200);
  assert.equal(result.http_body, '');
});

test('HTTP 200 with business response_code failure stays gRPC OK', async () => {
  setFetch(async () => response(200, { response_code: 1001, verbose_msg: 'IP not found', data: [] }));
  const result = await callHandler(METHOD_QUERY_IP_REPUTATION_FULL, { resource: '1.1.1.1' }, buildCtx());
  assert.equal(result.http_status, 200);
  assert.equal(result.http_body, '');
});

test('supports aliases and IPv6 query encoding', async () => {
  let captured;
  setFetch(async (url) => {
    captured = String(url);
    return response(200, { response_code: 0, data: [] });
  });

  await callHandler(METHOD_QUERY_IP_REPUTATION_FULL,
    { ip: '2001:4860:4860::8888' },
    buildCtx({
      config: { threatbook_domain: undefined, baseUrl: ' http://mock.local/ ' },
      secret: { threatbook_apikey: undefined, apiKey: 'alias_key' },
      limits: { timeoutMs: 25 },
    }),
  );

  const url = new URL(captured);
  assert.equal(`${url.origin}${url.pathname}`, 'http://mock.local/tip_api/v4/ip');
  assert.equal(url.searchParams.get('apikey'), 'alias_key');
  assert.equal(url.searchParams.get('resource'), '2001:4860:4860::8888');
  assert.match(captured, /resource=2001%3A4860%3A4860%3A%3A8888/);
});

test('maps HTTP and network failures with response details', async () => {
  for (const [status, legacyCode] of [[401, 'PERMISSION_DENIED'], [403, 'PERMISSION_DENIED'], [400, 'FAILED_PRECONDITION'], [404, 'FAILED_PRECONDITION'], [429, 'FAILED_PRECONDITION'], [500, 'UNAVAILABLE'], [502, 'UNAVAILABLE']]) {
    setFetch(async () => response(status, { response_code: -1, verbose_msg: `status ${status}` }));
    await expectGrpcError(
      () => callHandler(METHOD_QUERY_IP_REPUTATION_FULL, { ip: '8.8.8.8' }, buildCtx()),
      legacyCode,
      (err) => {
        assert.equal(err.response.http_status, status);
        assert.equal(err.response.http_body, '');
        assert.ok(err.response.http_body_length > 0);
      },
    );
  }

  setFetch(async () => {
    throw Object.assign(new Error('network error'), { cause: new Error('connection refused') });
  });
  await expectGrpcError(
    () => callHandler(METHOD_QUERY_IP_REPUTATION_FULL, { ip: '8.8.8.8' }, buildCtx()),
    'UNAVAILABLE',
    (err) => {
      assert.equal(err.response.http_status, 0);
      assert.equal(err.response.http_body, '');
      assert.ok(err.response.http_body_length > 0);
    },
  );

  setFetch(async () => ({
    status: 200,
    text: async () => {
      throw new Error('read failed');
    },
  }));
  await expectGrpcError(
    () => callHandler(METHOD_QUERY_IP_REPUTATION_FULL, { ip: '8.8.8.8' }, buildCtx()),
    'UNAVAILABLE',
    (err) => {
      assert.equal(err.response.http_status, 0);
      assert.equal(err.response.http_body, '');
      assert.ok(err.response.http_body_length > 0);
    },
  );

  setFetch(abortingFetch('timeout waiting for test_api_key'));
  await expectGrpcError(
    () => callHandler(METHOD_QUERY_IP_REPUTATION_FULL, { ip: '8.8.8.8' }, buildCtx({ limits: { timeoutMs: 1 } })),
    'UNAVAILABLE',
    (err) => {
      assert.equal(err.response.http_status, 0);
      assert.equal(err.response.http_body, '');
      assert.ok(err.response.http_body_length > 0);
      assert.doesNotMatch(String(err.response.http_body_length), /test_api_key/);
    },
  );
});

test('rpcdef falls back to context request', async () => {
  setFetch(async () => response(200, { response_code: 0, data: [] }));
  const result = await rpcdef(buildCtx({ req: { ip: '9.9.9.9' } }))[METHOD_QUERY_IP_REPUTATION_PATH]();
  assert.equal(result.http_status, 200);
});

test('request cannot override API key and logs redact query secret', async () => {
  const logs = [];
  let capturedUrl;
  console.log = (...args) => logs.push(args.map((arg) => String(arg)).join(' '));
  setFetch(async (url) => {
    capturedUrl = String(url);
    return response(500, `apikey=test_api_key`);
  });

  await expectGrpcError(
    () => callHandler(METHOD_QUERY_IP_REPUTATION_FULL, {
      ip: '8.8.8.8',
      threatbook_apikey: 'request_key',
      apikey: 'request_key',
      apiKey: 'request_key',
    }, buildCtx()),
    'UNAVAILABLE',
    (err) => {
      assert.match(err.message, /upstream http 500/);
      assert.doesNotMatch(err.message, /test_api_key|request_key/);
    },
  );

  const url = new URL(capturedUrl);
  assert.equal(url.searchParams.get('apikey'), 'test_api_key');
  assert.doesNotMatch(logs.join('\n'), /test_api_key|request_key/);
  assert.match(logs.join('\n'), /apikey=\*\*\*/);
});

test('helper functions cover normalization, mapping, logging, and direct fetch branches', async () => {
  assert.equal(_test.grpcCodeFor('NOPE'), grpcStatus.UNKNOWN);
  assert.equal(_test.errorWithCode('NOPE', 'bad').code, grpcStatus.UNKNOWN);
  assert.equal(_test.hasOwn(null, 'x'), false);
  assert.equal(_test.firstDefined(undefined, null, 0, 'x'), 0);
  assert.equal(_test.unwrapScalar({ value: { value: 'nested' } }), 'nested');
  assert.equal(_test.unwrapScalar(undefined), undefined);
  assert.equal(_test.toTrimmedString(null), '');
  assert.equal(_test.normalizeBaseUrl('ftp://bad'), '');
  assert.equal(_test.normalizeBaseUrl(''), '');
  assert.equal(_test.normalizeBaseUrl(' https://api.local/// '), 'https://api.local');
  assert.equal(_test.resolveDomain({}), '');
  assert.equal(_test.resolveApiKey({}), '');
  assert.deepEqual(_test.mergedBindings({ config: { a: 1 }, secret: { b: 2 }, bindings: { a: 3 } }), { a: 3, b: 2 });
  assert.deepEqual(_test.resolveCallContext().req, {});
  assert.deepEqual(_test.resolveCallContext({ request: { ip: '1.1.1.1' } }).req, { ip: '1.1.1.1' });
  assert.equal(_test.resolveDomain({ restBaseUrl: 'https://rest.local/' }), 'https://rest.local');
  assert.equal(_test.resolveApiKey({ apikey: { value: ' key ' } }), 'key');
  assert.equal(_test.resolveTimeoutMs(), 1500);
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: 'bad' }, bindings: { timeoutMs: 15 } }), 1500);
  assert.equal(_test.resolveTimeoutMs({ limits: {}, bindings: { timeoutMs: 15 } }), 15);
  assert.deepEqual(_test.buildTlsOptions({}), {});
  assert.equal(_test.buildTlsOptions({ insecureSkipVerify: true }).dispatcher, _test.insecureTlsDispatcher);
  assert.equal(_test.requireIp({ resource: { value: '1.1.1.1' } }), '1.1.1.1');
  assert.equal(_test.encodeQueryPairs({ a: 'x y', b: '', c: null, d: 0 }), 'a=x%20y&d=0');
  assert.equal(_test.redactUrlSensitiveQuery('https://x.test/p?apikey=k&token=t&x=1'), 'https://x.test/p?apikey=***&token=***&x=1');
  assert.equal(_test.sanitizeSensitiveText('apikey=k&token=t body secret', ['secret']), 'apikey=***&token=*** body ***');
  assert.equal(_test.buildQueryUrl('https://api.local', { a: 'b' }), 'https://api.local/tip_api/v4/ip?a=b');
  assert.equal(_test.mapHttpStatusToCode(401), 'PERMISSION_DENIED');
  assert.equal(_test.mapHttpStatusToCode(400), 'FAILED_PRECONDITION');
  assert.equal(_test.mapHttpStatusToCode(500), 'UNAVAILABLE');
  const err = _test.attachResponse(_test.errorWithCode('UNAVAILABLE', 'x'), { http_status: 0, http_body: 'x' });
  assert.deepEqual(err.response, { http_status: 0, http_body: 'x' });

  const logs = [];
  console.log = (...args) => logs.push(args);
  const circular = {};
  circular.self = circular;
  _test.logFlow(buildCtx({ meta: { instance_id: 'i', request_id: 'r' } }), 'action', { ok: true });
  _test.logFlow({}, 'fallback', circular);
  assert.match(logs[0][0], /\[ThreatBook_TIP_V4\]\[action\]\[inst=i req=r\]/);
  assert.match(logs[1][0], /\[ThreatBook_TIP_V4\]\[fallback\]/);

  setFetch(async () => response(204, ''));
  const direct = await _test.fetchWithStatus('http://api.local', buildCtx());
  assert.deepEqual(direct, { httpStatus: 204, httpBody: '' });
});

test('mock upstream handles success, business failure, auth, and server errors', async () => {
  const server = await createMockServer();
  try {
    const ctx = buildCtx({ config: { threatbook_domain: server.url } });
    const ok = await callHandler(METHOD_QUERY_IP_REPUTATION_FULL, { ip: '8.8.8.8' }, ctx);
    const biz = await callHandler(METHOD_QUERY_IP_REPUTATION_FULL, { ip: '1.1.1.1' }, ctx);
    assert.equal(ok.http_status, 200);
    assert.equal(ok.http_body, '');
    assert.equal(biz.http_status, 200);
    assert.equal(biz.http_body, '');
    assert.equal(server.requests[0].path, '/tip_api/v4/ip');
    assert.equal(server.requests[0].query.lang, 'zh');

    await expectGrpcError(
      () => callHandler(METHOD_QUERY_IP_REPUTATION_FULL, { ip: '8.8.8.8' }, buildCtx({ config: { threatbook_domain: server.url }, secret: { threatbook_apikey: 'invalid_key' } })),
      'PERMISSION_DENIED',
    );
    await expectGrpcError(
      () => callHandler(METHOD_QUERY_IP_REPUTATION_FULL, { ip: '500.500.500.500' }, ctx),
      'UNAVAILABLE',
    );
  } finally {
    await server.close();
  }
});
