import test from 'node:test';
import assert from 'node:assert/strict';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  ADD_BLACKLIST_PATH,
  DEFAULT_LIFESPAN,
  DEFAULT_PAGE,
  DEFAULT_SIZE,
  DEFAULT_TIMEOUT_MS,
  DELETE_BLACKLIST_PATH,
  METHOD_ADD_BLACKLIST_FULL,
  METHOD_DELETE_BLACKLIST_FULL,
  METHOD_QUERY_BLACKLIST_FULL,
  QUERY_BLACKLIST_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/das-tgfw-v6.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;

const buildCtx = (overrides = {}) => ({
  bindings: {
    host: 'https://device.example:8443/',
    api_token: 'Token',
    ...(overrides.bindings || {}),
  },
  config: overrides.config || {},
  secret: overrides.secret || {},
  limits: { timeoutMs: 10_000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const responseWithStatus = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => 'application/json' },
  text: async () => body,
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('QueryBlacklist rejects missing host and token in bindings', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ bindings: { host: '' }, req: { s_addr: '1.1.1.1', is_ip6: false } }))[QUERY_BLACKLIST_PATH](),
    /INVALID_ARGUMENT: host\/baseUrl is required in bindings/,
  );

  await assert.rejects(
    () => rpcdef(buildCtx({ bindings: { api_token: '' }, req: { s_addr: '1.1.1.1', is_ip6: false } }))[QUERY_BLACKLIST_PATH](),
    /INVALID_ARGUMENT: api_token is required in bindings/,
  );
});

test('QueryBlacklist validates IP address and version before fetch', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return responseWithStatus(200, JSON.stringify({ msg: 'success', vals: [] }));
  };

  await assert.rejects(
    () => rpcdef(buildCtx({ req: { s_addr: '1.1.1.1', is_ip6: true } }))[QUERY_BLACKLIST_PATH](),
    /INVALID_ARGUMENT: ip version mismatch/,
  );
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { s_addr: '999.1.1.1', is_ip6: false } }))[QUERY_BLACKLIST_PATH](),
    /INVALID_ARGUMENT: s_addr must be a valid IPv4 or IPv6 address/,
  );
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { s_addr: '2001:db8::10', is_ip6: false } }))[QUERY_BLACKLIST_PATH](),
    /INVALID_ARGUMENT: ip version mismatch/,
  );
  assert.equal(called, false);
});

test('QueryBlacklist returns parsed vals and builds query params', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return responseWithStatus(200, JSON.stringify({
      msg: 'success',
      vals: [
        { id: '321', s_addr: '1.1.1.1', enable: 1, lifespan: '60', extra: { a: 1 } },
      ],
    }));
  };

  const handler = rpcdef(buildCtx({
    bindings: { skipTlsVerify: true },
    req: { Page: { value: 2 }, Size: { value: 20 }, isIp6: false, ip: '1.1.1.1' },
  }))[QUERY_BLACKLIST_PATH];
  const res = await handler();

  assert.equal(res.http_status, 200);
  assert.equal(res.msg, 'success');
  assert.equal(res.vals.length, 1);
  assert.deepEqual(res.vals[0], {
    id: 321,
    s_addr: '1.1.1.1',
    enable: true,
    lifespan: 60,
    raw: {
      structValue: {
        fields: {
          id: { stringValue: '321' },
          s_addr: { stringValue: '1.1.1.1' },
          enable: { numberValue: 1 },
          lifespan: { stringValue: '60' },
          extra: { structValue: { fields: { a: { numberValue: 1 } } } },
        },
      },
    },
  });
  assert.ok(String(captured.url).includes('/api/v1/blacklist'));
  assert.ok(String(captured.url).includes('page=2'));
  assert.ok(String(captured.url).includes('size=20'));
  assert.ok(String(captured.url).includes('s_addr=1.1.1.1'));
  assert.equal(captured.init.method, 'GET');
  assert.equal(captured.init.headers.AuthorizationToken, 'Token');
  assert.equal(Object.hasOwn(captured.init, 'timeoutMs'), false);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(Object.hasOwn(captured.init, 'skipTlsVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'tlsInsecureSkipVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'insecureSkipVerify'), false);
  assert.ok(captured.init.dispatcher);
});

test('QueryBlacklist handles empty, non-JSON, and non-2xx responses', async () => {
  const handler = rpcdef(buildCtx({ req: { is_ip6: false, s_addr: '1.1.1.1' } }))[QUERY_BLACKLIST_PATH];

  globalThis.fetch = async () => responseWithStatus(200, '');
  assert.deepEqual(await handler(), {
    http_status: 200,
    raw_body: '',
    raw_json: undefined,
    vals: [],
    msg: '',
  });

  globalThis.fetch = async () => responseWithStatus(200, 'plain');
  assert.deepEqual(await handler(), {
    http_status: 200,
    raw_body: '',
    raw_json: undefined,
    vals: [],
    msg: '',
  });

  globalThis.fetch = async () => responseWithStatus(200, '{bad');
  assert.deepEqual(await handler(), {
    http_status: 200,
    raw_body: '',
    raw_json: undefined,
    vals: [],
    msg: '',
  });

  globalThis.fetch = async () => responseWithStatus(200, JSON.stringify({ msg: 1, vals: [{ id: 'bad' }] }));
  const oddJson = await handler();
  assert.equal(oddJson.msg, '');
  assert.equal(oddJson.vals[0].id, 0);
  assert.equal(oddJson.vals[0].s_addr, '');
  assert.equal(oddJson.vals[0].enable, false);
  assert.equal(oddJson.vals[0].lifespan, 0);

  globalThis.fetch = async () => responseWithStatus(200, JSON.stringify({ msg: 'success', vals: {} }));
  assert.deepEqual((await handler()).vals, []);

  globalThis.fetch = async () => responseWithStatus(401, 'unauthorized');
  await assert.rejects(() => handler(), (err) => {
    assert.ok(err instanceof GrpcError);
    assert.equal(err.code, grpcStatus.PERMISSION_DENIED);
    assert.equal(err.legacyCode, 'PERMISSION_DENIED');
    assert.equal(err.httpStatus, 401);
    assert.equal(err.reason, 'non-2xx');
    return true;
  });

  globalThis.fetch = async () => responseWithStatus(500, 'boom');
  await assert.rejects(() => handler(), /"http_status":500/);
});

test('AddBlacklist sends fixed payload and succeeds on msg success', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return responseWithStatus(200, JSON.stringify({ msg: 'success' }));
  };

  const res = await rpcdef(buildCtx({
    req: { is_ip6: true, s_addr: '2001:db8::10', lifespan: 60, enable: true },
  }))[ADD_BLACKLIST_PATH]();

  assert.equal(res.http_status, 200);
  assert.equal(res.msg, 'success');
  assert.equal(captured.url, 'https://device.example:8443/api/v1/blacklist');
  assert.equal(captured.init.method, 'POST');
  assert.deepEqual(JSON.parse(captured.init.body), {
    id: 1,
    val: {
      enable: true,
      lifespan: 60,
      is_ip6: true,
      s_addr: '2001:db8::10',
      d_addr: null,
      is_choose_service: false,
    },
  });
});

test('AddBlacklist validates inputs and maps business failures', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { is_ip6: false, s_addr: '' } }))[ADD_BLACKLIST_PATH](),
    /INVALID_ARGUMENT: s_addr is required/,
  );
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { is_ip6: false, s_addr: '2001:db8::10' } }))[ADD_BLACKLIST_PATH](),
    /INVALID_ARGUMENT: ip version mismatch/,
  );

  const handler = rpcdef(buildCtx({ req: { is_ip6: false, s_addr: '1.1.1.1' } }))[ADD_BLACKLIST_PATH];
  globalThis.fetch = async () => responseWithStatus(200, JSON.stringify({ msg: 'failed' }));
  await assert.rejects(() => handler(), (err) => {
    assert.equal(err.code, grpcStatus.FAILED_PRECONDITION);
    assert.equal(err.legacyCode, 'FAILED_PRECONDITION');
    assert.match(err.reason, /msg != success/);
    return true;
  });

  globalThis.fetch = async () => responseWithStatus(400, JSON.stringify({ msg: 'bad request' }));
  await assert.rejects(() => handler(), (err) => {
    assert.equal(err.code, grpcStatus.FAILED_PRECONDITION);
    assert.equal(err.httpStatus, 400);
    return true;
  });

  globalThis.fetch = async () => responseWithStatus(503, JSON.stringify({ msg: 'unavailable' }));
  await assert.rejects(() => handler(), (err) => {
    assert.equal(err.code, grpcStatus.UNAVAILABLE);
    assert.equal(err.httpStatus, 503);
    return true;
  });

  globalThis.fetch = async () => responseWithStatus(200, '{bad');
  await assert.rejects(() => handler(), (err) => {
    assert.equal(err.code, grpcStatus.UNKNOWN);
    assert.equal(err.reason, 'invalid-json');
    return true;
  });
});

test('AddBlacklist defaults lifespan and enable, and maps transport failures', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return responseWithStatus(200, '');
  };
  const res = await rpcdef(buildCtx({
    limits: { timeoutMs: -1 },
    req: { is_ip6: false, s_addr: '1.1.1.1', lifespan: 0, enable: undefined },
  }))[ADD_BLACKLIST_PATH]();

  assert.equal(res.http_status, 200);
  const sent = JSON.parse(captured.init.body);
  assert.equal(sent.val.lifespan, DEFAULT_LIFESPAN);
  assert.equal(sent.val.enable, true);
  assert.equal(Object.hasOwn(captured.init, 'timeoutMs'), false);
  assert.ok(captured.init.signal instanceof AbortSignal);

  globalThis.fetch = async () => {
    throw new Error('network down');
  };
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { is_ip6: false, s_addr: '1.1.1.1' } }))[ADD_BLACKLIST_PATH](),
    /"reason":"network down"/,
  );
});

test('DeleteBlacklist builds query params and handles success and failures', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return responseWithStatus(200, JSON.stringify({ msg: 'success' }));
  };

  const res = await rpcdef(buildCtx({ req: { Id: { value: 321 }, isIp6: false } }))[DELETE_BLACKLIST_PATH]();

  assert.equal(res.http_status, 200);
  assert.equal(res.msg, 'success');
  assert.equal(captured.init.method, 'DELETE');
  assert.ok(String(captured.url).includes('id=321'));
  assert.ok(String(captured.url).includes('is_ip6=false'));

  await assert.rejects(
    () => rpcdef(buildCtx({ req: { id: 0, is_ip6: false } }))[DELETE_BLACKLIST_PATH](),
    /INVALID_ARGUMENT: id must be a positive integer/,
  );

  globalThis.fetch = async () => responseWithStatus(400, JSON.stringify({ msg: 'bad request' }));
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { id: 1, is_ip6: false } }))[DELETE_BLACKLIST_PATH](),
    (err) => {
      assert.equal(err.code, grpcStatus.FAILED_PRECONDITION);
      assert.equal(err.httpStatus, 400);
      return true;
    },
  );

  globalThis.fetch = async () => responseWithStatus(500, JSON.stringify({ msg: 'server error' }));
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { id: 1, is_ip6: false } }))[DELETE_BLACKLIST_PATH](),
    (err) => {
      assert.equal(err.code, grpcStatus.UNAVAILABLE);
      assert.equal(err.httpStatus, 500);
      return true;
    },
  );

  globalThis.fetch = async () => responseWithStatus(200, JSON.stringify({ msg: 'failed' }));
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { id: 1, is_ip6: false } }))[DELETE_BLACKLIST_PATH](),
    /msg != success/,
  );
});

test('SDK handlers use config and secret without request credential overrides', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return responseWithStatus(200, JSON.stringify({ msg: 'success', vals: [] }));
  };

  const queryRes = await handlers[METHOD_QUERY_BLACKLIST_FULL]({
    config: {
      endpoint: 'https://sdk.example/',
      timeout_ms: 2500,
      insecureSkipVerify: true,
    },
    secret: {
      apiToken: 'SecretToken',
    },
    req: {
      host: 'https://request-ignored.example',
      api_token: 'Ignored',
      sAddr: '1.1.1.1',
      isIp6: false,
    },
  });

  assert.equal(queryRes.http_status, 200);
  assert.equal(captured.url, 'https://sdk.example/api/v1/blacklist?page=1&size=10&is_ip6=false&s_addr=1.1.1.1');
  assert.equal(captured.init.headers.AuthorizationToken, 'SecretToken');
  assert.equal(Object.hasOwn(captured.init, 'timeoutMs'), false);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(Object.hasOwn(captured.init, 'skipTlsVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'tlsInsecureSkipVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'insecureSkipVerify'), false);
  assert.ok(captured.init.dispatcher);

  globalThis.fetch = async () => responseWithStatus(200, JSON.stringify({ msg: 'success' }));
  assert.equal((await handlers[METHOD_ADD_BLACKLIST_FULL]({
    config: { base_url: 'https://sdk.example' },
    secret: { token: 'SecretToken' },
    request: { s_addr: '1.1.1.1', is_ip6: false },
  })).msg, 'success');
  assert.equal((await handlers[METHOD_DELETE_BLACKLIST_FULL]({
    config: { rest_base_url: 'https://sdk.example' },
    secret: { api_token: 'SecretToken' },
    request: { id: 1, is_ip6: false },
  })).msg, 'success');

  await assert.rejects(() => handlers[METHOD_QUERY_BLACKLIST_FULL](), /host\/baseUrl is required/);
});

test('service wrapper exposes SDK handlers', () => {
  assert.deepEqual(Object.keys(service.handlers), [
    METHOD_QUERY_BLACKLIST_FULL,
    METHOD_ADD_BLACKLIST_FULL,
    METHOD_DELETE_BLACKLIST_FULL,
  ]);
  assert.equal(service.handlers[METHOD_QUERY_BLACKLIST_FULL], handlers[METHOD_QUERY_BLACKLIST_FULL]);
});

test('helper utilities cover aliases and edge cases', async () => {
  assert.equal(_test.normalizeBaseUrl('ftp://bad'), '');
  assert.equal(_test.normalizeBaseUrl('https://example///'), 'https://example');
  assert.equal(_test.requireHost({ bindings: { baseUrl: 'https://base.example/' } }), 'https://base.example');
  assert.equal(_test.requireHost({ config: { restBaseUrl: 'https://rest.example/' } }), 'https://rest.example');
  assert.equal(_test.requireHost({ config: { endpoint: 'https://endpoint.example/' } }), 'https://endpoint.example');
  assert.throws(() => _test.requireHost({ bindings: { endpoint: 'not-a-url' } }), /host\/baseUrl is required/);
  assert.equal(_test.requireApiToken({ bindings: { api_token: 'SnakeToken' } }), 'SnakeToken');
  assert.equal(_test.requireApiToken({ bindings: { apiToken: 'BindingToken' } }), 'BindingToken');
  assert.equal(_test.requireApiToken({ secret: { token: 'SecretToken' } }), 'SecretToken');
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeoutMs: 3000 } }), 3000);
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: 1200 }, bindings: { timeoutMs: 3000 } }), 1200);
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeout_ms: 'bad' } }), DEFAULT_TIMEOUT_MS);
  const skipTlsOptions = await _test.buildTlsOptions({ skipTlsVerify: true });
  assert.ok(skipTlsOptions.dispatcher);
  assert.equal(Object.hasOwn(skipTlsOptions, 'skipTlsVerify'), false);
  assert.ok((await _test.buildTlsOptions({ tlsInsecureSkipVerify: true })).dispatcher);
  assert.deepEqual(await _test.buildTlsOptions({}), {});
  assert.equal(_test.toInteger('3.9'), 3);
  assert.equal(_test.toInteger('bad', 7), 7);
  assert.equal(_test.unwrapScalar(undefined), undefined);
  assert.equal(_test.unwrapScalar(null), undefined);
  assert.equal(_test.unwrapScalar({ other: 'value' }).other, 'value');
  assert.equal(_test.toBool(true), true);
  assert.equal(_test.toBool(1), true);
  assert.equal(_test.toBool(0, true), false);
  assert.equal(_test.toBool('true'), true);
  assert.equal(_test.toBool('1'), true);
  assert.equal(_test.toBool('false', true), false);
  assert.equal(_test.toBool('0', true), false);
  assert.equal(_test.toBool('', true), false);
  assert.equal(_test.toBool('maybe', true), true);
  assert.deepEqual(_test.toValue([undefined, null, 'x']), { listValue: { values: [{ nullValue: 'NULL_VALUE' }, { stringValue: 'x' }] } });
  assert.deepEqual(_test.toValue(Symbol('s')), { stringValue: 'Symbol(s)' });
  assert.equal(_test.encodeQuery({ a: 'x y', b: '', c: null, d: 1 }), 'a=x%20y&d=1');
  assert.equal(_test.appendQuery('https://example/path', {}), 'https://example/path');
  assert.equal(_test.appendQuery('https://example/path?x=1', { y: 2 }), 'https://example/path?x=1&y=2');
  assert.equal(_test.isIPv4('1.1.1'), false);
  assert.equal(_test.isIPv4('a.b.c.d'), false);
  assert.equal(_test.isIPv4('01.1.1.1'), false);
  assert.equal(_test.isIPv4('256.1.1.1'), false);
  assert.equal(_test.isIPv4('255.255.255.255'), true);
  assert.equal(_test.isIPv6('plain'), false);
  assert.equal(_test.isIPv6('::ffff:192.0.2.1'), true);
  assert.equal(_test.isIPv6('::ffff:999.0.2.1'), false);
  assert.equal(_test.isIPv6('2001::1::2'), false);
  assert.equal(_test.isIPv6('2001:::1'), false);
  assert.equal(_test.isIPv6('2001::g'), false);
  assert.deepEqual(_test.parseJsonIfPossible(''), { ok: true, json: undefined });
  assert.deepEqual(_test.parseJsonIfPossible('plain'), { ok: true, json: undefined });
  assert.deepEqual(_test.parseJsonIfPossible('{bad'), { ok: false, json: undefined });
  assert.equal(_test.classifyHttpStatusToCode(403), 'PERMISSION_DENIED');
  assert.equal(_test.classifyHttpStatusToCode(401), 'PERMISSION_DENIED');
  assert.equal(_test.classifyHttpStatusToCode(404), 'FAILED_PRECONDITION');
  assert.equal(_test.classifyHttpStatusToCode(503), 'UNAVAILABLE');
  assert.equal(_test.classifyHttpStatusToCode(302), 'FAILED_PRECONDITION');
  assert.deepEqual(_test.buildHeaders('T'), { 'Content-Type': 'application/json;charset=UTF-8', AuthorizationToken: 'T' });
  assert.deepEqual(_test.parseBusinessResponse(200, JSON.stringify({ msg: 'success' })), {
    http_status: 200,
    raw_body: '',
    raw_json: undefined,
    msg: 'success',
  });
  assert.deepEqual(_test.parseBusinessResponse(204, ''), {
    http_status: 204,
    raw_body: '',
    raw_json: undefined,
    msg: '',
  });
  assert.throws(() => _test.requireSAddr({}), /s_addr is required/);
  assert.throws(() => _test.requireBlacklistId({ id: -1 }), /id must be a positive integer/);
  assert.equal(_test.errorWithCode('UNMAPPED', 'fallback').code, grpcStatus.UNKNOWN);
  const err = _test.upstreamError('UNAVAILABLE', 'message', { httpStatus: 0, rawBody: '', reason: 'r' });
  assert.equal(err.code, grpcStatus.UNAVAILABLE);
  assert.equal(err.details.reason, 'r');
  assert.deepEqual(_test.resolveCallContext({ request: { id: 1 }, config: { host: 'h' }, secret: { token: 't' } }).req, { id: 1 });
  assert.deepEqual(_test.resolveCallContext({ req: { id: 2 }, bindings: { host: 'h' } }).req, { id: 2 });
  assert.equal(_test.firstDefined(undefined, null, 'x'), 'x');
  assert.equal(_test.unwrapString({ value: { value: 'nested' } }), 'nested');
});

test('fetchText reports nested cause messages', async () => {
  globalThis.fetch = async () => {
    throw new Error('outer', { cause: new Error('inner cause') });
  };

  await assert.rejects(
    () => _test.fetchText(buildCtx(), 'https://device.example/api/v1/blacklist', { method: 'GET' }),
    /"reason":"inner cause"/,
  );
});

test('direct handlers cover minimal context fallback branches', async () => {
  await assert.rejects(
    () => _test.handleQueryBlacklist({ s_addr: '1.1.1.1', is_ip6: false }, {}),
    /host\/baseUrl is required/,
  );
  await assert.rejects(
    () => _test.handleAddBlacklist({ s_addr: '1.1.1.1', is_ip6: false }, {}),
    /host\/baseUrl is required/,
  );
  await assert.rejects(
    () => _test.handleDeleteBlacklist({ id: 1, is_ip6: false }, {}),
    /host\/baseUrl is required/,
  );
  globalThis.fetch = async () => {
    throw {};
  };
  await assert.rejects(
    () => _test.fetchText({}, 'https://device.example/api/v1/blacklist', { method: 'GET' }),
    /"reason":"fetch failed"/,
  );
});
