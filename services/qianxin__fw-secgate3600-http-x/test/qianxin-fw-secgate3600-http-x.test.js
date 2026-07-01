import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  BLOCK_PATH,
  LOGIN_PATH,
  METHOD_BLOCK_FULL,
  METHOD_LOGIN_FULL,
  METHOD_UNBLOCK_FULL,
  UNBLOCK_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/qianxin-fw-secgate3600-http-x.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;

const buildCtx = (overrides = {}) => ({
  bindings: {
    host: 'https://secgate.local:8443',
    headers: { 'X-Extra': 'demo' },
    ...(overrides.bindings || {}),
  },
  config: overrides.config || {},
  secret: { user: 'admin', password: 'secret', ...(overrides.secret || {}) },
  limits: { timeoutMs: 10_000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const callHandler = (method, request = {}, ctx = {}) => {
  const handler = handlers[method];
  return handler({ ...ctx, request });
};

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
    /* node:coverage ignore next 3 */
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
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
    UNKNOWN: grpcStatus.UNKNOWN,
  })[legacyCode]);
  assert.match(caught.message, new RegExp(`^${legacyCode}:`));
  checker(caught);
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  _test.clearAllSessions();
});

test('service exports defineService result and handlers', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers[METHOD_LOGIN_FULL], 'function');
  assert.equal(typeof handlers[METHOD_BLOCK_FULL], 'function');
  assert.equal(typeof handlers[METHOD_UNBLOCK_FULL], 'function');
});

test('Login requires host, user, and password', async () => {
  await expectGrpcError(
    () => rpcdef(buildCtx({ bindings: { host: '' }, req: { user: 'admin', password: 'secret' } }))[LOGIN_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /host\/baseUrl is required/),
  );
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { password: 'secret' }, secret: { user: '' } }))[LOGIN_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /user is required/),
  );
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { user: 'admin' }, secret: { password: '' } }))[LOGIN_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /password is required/),
  );
});

test('Login builds GET query from secret and sanitizes response surface', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, JSON.stringify({ result: 'ok', uuid: 'mock-uuid' }), {
      'content-type': 'application/json',
      'set-cookie': ['a', 'b'],
    });
  });

  const res = await rpcdef(buildCtx({
    req: {
      host: 'https://secgate.local:8443/',
      user: 'ignored-user',
      password: 'ignored-password',
      txtLanguage: { value: 'zh-cn' },
      loginType: { value: 'normal' },
      client: { value: 'webui' },
      timeoutMs: { value: 2222 },
    },
    bindings: { skipTlsVerify: true },
    meta: { instance_id: 'inst-1', request_id: 'req-1' },
  }))[LOGIN_PATH]();

  assert.equal(captured.init.method, 'GET');
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal('timeoutMs' in captured.init, false);
  assert.ok(captured.init.dispatcher);
  assert.equal('skipTlsVerify' in captured.init, false);
  assert.equal(captured.init.headers['x-engine-instance'], 'inst-1');
  assert.equal(captured.init.headers['x-request-id'], 'req-1');
  assert.ok(!('content-type' in captured.init.headers));
  const parsedUrl = new URL(captured.url);
  assert.equal(`${parsedUrl.origin}${parsedUrl.pathname}`, 'https://secgate.local:8443/webui/login/auth');
  assert.equal(parsedUrl.searchParams.get('user'), 'admin');
  assert.equal(parsedUrl.searchParams.get('password'), 'secret');
  assert.equal(parsedUrl.searchParams.get('txt_language'), 'zh-cn');
  assert.equal(parsedUrl.searchParams.get('login_type'), 'normal');
  assert.equal(parsedUrl.searchParams.get('client'), 'webui');
  assert.equal(res.statusCode, 200);
  assert.equal(res.status_code, 200);
  assert.equal(res.effectiveUrl, '');
  assert.equal(res.effective_url, res.effectiveUrl);
  assert.deepEqual(res.bodyJson, {});
  assert.deepEqual(res.body_json, { fields: {} });
  assert.equal(res.rawBody, '');
  assert.deepEqual(res.headers.find((h) => h.key === 'set-cookie'), undefined);
});

test('BlockIP defaults mask and propagates upstream status', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(500, JSON.stringify({ result: 'failed', err: 1 }));
  });
  const ctx = buildCtx({ req: { host: 'http://device.local', ip: '1.2.3.4' } });
  _test.setSession(_test.resolveCallContext(ctx), 'http://device.local', { uuid: 'abc' });

  const res = await rpcdef(ctx)[BLOCK_PATH]();

  assert.ok(captured.url.includes('/webui/blacklist/set?uuid=abc'));
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['content-type'], 'application/json');
  const body = JSON.parse(captured.init.body);
  assert.equal(body.ip, '1.2.3.4');
  assert.equal(body.mask, '255.255.255.0');
  assert.ok(!('undo' in body));
  assert.equal(res.statusCode, 500);
  assert.equal(res.rawBody, '');
  assert.equal(res.effectiveUrl, '');
  assert.deepEqual(res.bodyJson, {});
});

test('UnblockIP sets undo flag and respects optional fields', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, JSON.stringify({ result: 'ok' }));
  });
  const ctx = buildCtx();
  _test.setSession(_test.resolveCallContext(ctx), 'http://device.local', { uuid: 'token-uuid' });

  await callHandler(METHOD_UNBLOCK_FULL, {
    host: 'http://device.local',
    ip: '5.6.7.8',
    mask: { value: '255.255.255.128' },
    description: { value: 'undo entry' },
  }, ctx);

  const parsed = JSON.parse(captured.init.body);
  assert.equal(parsed.mask, '255.255.255.128');
  assert.equal(parsed.desc, 'undo entry');
  assert.equal(parsed.undo, '1');
});

test('non-JSON body is preserved as raw text with empty parsed object', async () => {
  setFetch(async () => response(403, 'permission denied'));
  const ctx = buildCtx({ req: { host: 'http://device.local', ip: '9.9.9.9' } });
  _test.setSession(_test.resolveCallContext(ctx), 'http://device.local', { uuid: 'id' });

  const res = await rpcdef(ctx)[BLOCK_PATH]();

  assert.equal(res.statusCode, 403);
  assert.equal(res.rawBody, '');
  assert.deepEqual(res.bodyJson, {});
  assert.deepEqual(res.body_json, { fields: {} });
});

test('network failures map to UNAVAILABLE', async () => {
  setFetch(async () => {
    throw Object.assign(new Error('boom'), { cause: new Error('socket hang up') });
  });

  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { host: 'http://device.local', user: 'a', password: 'b' } }))[LOGIN_PATH](),
    'UNAVAILABLE',
    (err) => assert.match(err.message, /socket hang up/),
  );
});

test('host can come from bindings, config aliases, and request aliases', async () => {
  const urls = [];
  setFetch(async (url) => {
    urls.push(String(url));
    return response(200, JSON.stringify({ ok: true }));
  });

  await rpcdef(buildCtx({ bindings: { host: undefined, restBaseUrl: 'https://binding-host:4443/' }, req: { user: 'ignored', password: 'ignored' } }))[LOGIN_PATH]();
  await rpcdef({
    config: { base_url: 'https://config-host:4443/' },
    secret: { user: 'admin', password: 'secret' },
    req: { user: 'ignored', password: 'ignored' },
  })[LOGIN_PATH]();
  await rpcdef(buildCtx({ req: { base_url: 'https://request-host:4443/', user: 'ignored', password: 'ignored' } }))[LOGIN_PATH]();

  assert.ok(urls[0].startsWith('https://binding-host:4443/webui/login/auth'));
  assert.ok(urls[1].startsWith('https://config-host:4443/webui/login/auth'));
  assert.ok(urls[2].startsWith('https://request-host:4443/webui/login/auth'));
});

test('Blacklist requests validate cached session and ip', async () => {
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { host: 'http://device.local', ip: '1.1.1.1' } }))[BLOCK_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /call Login first/),
  );
  const ctx = buildCtx({ req: { host: 'http://device.local' } });
  _test.setSession(_test.resolveCallContext(ctx), 'http://device.local', { uuid: 'id' });
  await expectGrpcError(
    () => rpcdef(ctx)[UNBLOCK_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /ip is required/),
  );
});

test('helpers cover scalar, URL, timeout, headers, body, response, and fallback branches', () => {
  assert.equal(_test.normalizeString({ value: ' x ' }), 'x');
  assert.deepEqual(_test.normalizeString({ nested: 'object' }), '[object Object]');
  assert.equal(_test.normalizeString(null), '');
  assert.equal(_test.optionalString('  '), undefined);
  assert.equal(_test.optionalString(' value '), 'value');
  assert.equal(_test.optionalUint32(undefined), undefined);
  assert.equal(_test.optionalUint32(null), undefined);
  assert.equal(_test.optionalUint32({ value: 321 }), 321);
  assert.equal(_test.optionalUint32('42.9'), 42);
  assert.equal(_test.optionalUint32(0), undefined);
  assert.equal(_test.optionalUint32(-1), undefined);
  assert.equal(_test.optionalUint32('bad'), undefined);
  assert.equal(_test.getField({ txt_language: 'zh' }, ['txtLanguage', 'txt_language']), 'zh');
  assert.equal(_test.getField({}, ['x']), undefined);
  assert.equal(_test.normalizeBaseUrl('https://example.test///'), 'https://example.test');
  assert.equal(_test.normalizeBaseUrl(''), '');
  assert.equal(_test.normalizeBaseUrl('example.test'), '');
  assert.equal(_test.resolveHost({ req: { baseUrl: 'https://req-base.test/' }, bindings: {} }), 'https://req-base.test');
  assert.equal(_test.resolveHost({ req: { base_url: 'https://req-snake.test/' }, bindings: {} }), 'https://req-snake.test');
  assert.equal(_test.resolveHost({ req: {}, bindings: { baseUrl: 'https://binding-base.test/' } }), 'https://binding-base.test');
  assert.equal(_test.resolveHost({ req: {}, bindings: { rest_base_url: 'https://binding-rest-snake.test/' } }), 'https://binding-rest-snake.test');
  assert.equal(_test.resolveHost({ req: {}, bindings: { base_url: 'https://binding-base-snake.test/' } }), 'https://binding-base-snake.test');
  assert.equal(_test.resolveTimeoutMs({ req: { timeout_ms: 111 }, bindings: { timeoutMs: 222 }, limits: { timeoutMs: 333 } }), 111);
  assert.equal(_test.resolveTimeoutMs({ req: { timeoutMs: 110 }, bindings: { timeoutMs: 222 }, limits: { timeoutMs: 333 } }), 110);
  assert.equal(_test.resolveTimeoutMs({ req: {}, bindings: { timeoutMs: 222 }, limits: { timeoutMs: 333 } }), 222);
  assert.equal(_test.resolveTimeoutMs({ req: {}, bindings: { timeout_ms: 223 }, limits: { timeoutMs: 333 } }), 223);
  assert.equal(_test.resolveTimeoutMs({ req: {}, bindings: {}, limits: { timeoutMs: 333 } }), 333);
  assert.equal(_test.resolveTimeoutMs({ req: {}, bindings: {}, limits: {} }), 5000);
  assert.deepEqual(_test.resolveCallContext({ config: { host: 'h' }, secret: { a: 1 }, bindings: { b: 2 }, request: { user: 'u' } }).bindings, {
    host: 'h',
    a: 1,
    b: 2,
  });
  assert.equal(_test.toBoolean('on'), true);
  assert.equal(_test.toBoolean('off'), false);
  assert.equal(_test.toBoolean(1), true);
  assert.equal(_test.toBoolean(0), false);
  assert.equal(_test.toBoolean(true), true);
  assert.equal(_test.toBoolean('maybe'), false);
  assert.equal(_test.toBoolean({ value: 0 }), false);
  assert.deepEqual(_test.buildTlsOptions({ bindings: {} }), {});
  assert.ok(_test.buildTlsOptions({ bindings: { skipTlsVerify: true } }).dispatcher);
  assert.ok(_test.buildTlsOptions({ bindings: { tlsInsecureSkipVerify: 1 } }).dispatcher);
  assert.ok(_test.buildTlsOptions({ bindings: { insecureSkipVerify: 'yes' } }).dispatcher);
  assert.deepEqual(_test.buildHeaders({ bindings: {}, meta: { instanceId: 'camel-inst', requestId: 'camel-req' } }), {
    'x-engine-instance': 'camel-inst',
    'x-request-id': 'camel-req',
  });
  assert.deepEqual(_test.buildHeaders({ bindings: { headers: { A: '1' } }, meta: {} }, { B: '2' }), {
    A: '1',
    'x-engine-instance': 'unknown',
    'x-request-id': 'unknown',
    B: '2',
  });
  assert.equal(_test.buildUrl('http://x.test/', '/p', { a: 'x y', b: ['1', '2'], c: '', d: null }), 'http://x.test/p?a=x%20y&b=1&b=2');
  assert.equal(_test.buildUrl('http://x.test/', '/p', { n: 0, f: false }), 'http://x.test/p?n=0&f=false');
  assert.equal(_test.buildUrl('http://x.test', '', {}), 'http://x.test/');
  assert.equal(_test.buildUrl('http://x.test', '/p', { z: undefined }), 'http://x.test/p');
  assert.deepEqual(_test.buildLoginQuery({ user: 'ignored', password: 'ignored', txtLanguage: 'zh', loginType: 'normal', client: 'webui' }, { secret: { user: 'u', password: 'p' } }), {
    user: 'u',
    password: 'p',
    txt_language: 'zh',
    login_type: 'normal',
    client: 'webui',
  });
  assert.deepEqual(_test.buildLoginQuery({ user: 'ignored', password: 'ignored', txt_language: 'zh', login_type: 'normal', client: '' }, { secret: { user: 'u', password: 'p' } }), {
    user: 'u',
    password: 'p',
    txt_language: 'zh',
    login_type: 'normal',
  });
  const queryCtx = _test.resolveCallContext(buildCtx({ req: { host: 'http://device.local' } }));
  _test.setSession(queryCtx, 'http://device.local', { uuid: 'id' });
  assert.deepEqual(_test.buildBlacklistQuery(queryCtx), { uuid: 'id' });
  assert.deepEqual(_test.buildBlacklistBody({ ip: '1.1.1.1', mask: '255.255.255.128', description: 'd' }, false), {
    ip: '1.1.1.1',
    mask: '255.255.255.128',
    desc: 'd',
  });
  assert.deepEqual(_test.buildBlacklistBody({ ip: '1.1.1.1', desc: 'd' }, true), {
    ip: '1.1.1.1',
    mask: '255.255.255.0',
    desc: 'd',
    undo: '1',
  });
  assert.deepEqual(_test.toStruct({ a: 1, b: null, c: [true] }), {
    fields: {
      a: { numberValue: 1 },
      b: { nullValue: 'NULL_VALUE' },
      c: { listValue: { values: [{ boolValue: true }] } },
    },
  });
  assert.deepEqual(_test.toValue('x'), { stringValue: 'x' });
  assert.deepEqual(_test.toValue(false), { boolValue: false });
  assert.deepEqual(_test.toValue(undefined), { nullValue: 'NULL_VALUE' });
  assert.equal(_test.toValue(Symbol.for('x')).stringValue, 'Symbol(x)');
  assert.equal(_test.toValue({ value: 'wrapped' }).stringValue, 'wrapped');
  assert.deepEqual(_test.parseJsonObject('{"ok":true}'), { ok: true });
  assert.deepEqual(_test.parseJsonObject('[1]'), {});
  assert.deepEqual(_test.parseJsonObject('"x"'), {});
  assert.deepEqual(_test.parseJsonObject('{'), {});
  assert.deepEqual(_test.parseJsonObject(''), {});
  assert.deepEqual(_test.extractHeaders({ headers: { forEach: (cb) => cb(['1', '2'], 'x-a') } }), [{ key: 'x-a', values: ['1', '2'] }]);
  assert.deepEqual(_test.extractHeaders({ headers: { forEach: (cb) => cb('1', '') } }), []);
  assert.deepEqual(_test.extractHeaders({ headers: { entries: () => [['x-a', '1']] } }), [{ key: 'x-a', values: ['1'] }]);
  assert.deepEqual(_test.extractHeaders({}), []);
  const normalized = _test.normalizeResponse(201, [{ key: 'x', values: ['y'] }], '{"ok":true}', 'http://x.test');
  assert.equal(normalized.statusCode, 201);
  assert.equal(normalized.bodyJson.ok, true);
  assert.equal(normalized.body_json.fields.ok.boolValue, true);
  const emptyStatus = _test.normalizeResponse('bad', [], null, 'http://x.test');
  assert.equal(emptyStatus.statusCode, 0);
  assert.equal(emptyStatus.rawBody, '');
  const sanitized = _test.normalizeResponse(200, [{ key: 'set-cookie', values: ['SID=abc'] }, { key: 'x', values: ['1'] }], '{"token":"secret"}', 'http://x.test/p?user=u&password=p', {
    omitRawBody: true,
    omitParsedBody: true,
    sanitizeUrl: true,
  });
  assert.deepEqual(sanitized.headers, [{ key: 'x', values: ['1'] }]);
  assert.equal(sanitized.rawBody, '');
  assert.deepEqual(sanitized.bodyJson, {});
  assert.equal(new URL(sanitized.effectiveUrl).searchParams.get('password'), 'REDACTED');
  assert.equal(_test.normalizeResponse(200, [], '{}', 'not a url', { sanitizeUrl: true }).effectiveUrl, '');
  assert.equal(_test.errorWithCode('NOT_REAL', 'fallback').code, grpcStatus.UNKNOWN);
});

test('fetchHttp maps thrown errors without message to UNAVAILABLE fallback', async () => {
  setFetch(async () => {
    throw {};
  });

  await expectGrpcError(
    () => _test.fetchHttp(buildCtx(), 'http://device.local/ping', { method: 'GET' }),
    'UNAVAILABLE',
    (err) => assert.match(err.message, /fetch failed/),
  );
});

test('mock upstream supports login, block, and unblock lifecycle', async () => {
  const mock = await createMockServer();
  try {
    const ctx = buildCtx({ bindings: { host: mock.url }, req: { user: 'ignored', password: 'ignored' } });
    const login = await rpcdef(ctx)[LOGIN_PATH]();
    assert.equal(login.statusCode, 200);
    assert.deepEqual(login.bodyJson, {});

    const block = await rpcdef({ ...ctx, req: { ip: '198.51.100.10' } })[BLOCK_PATH]();
    assert.deepEqual(block.bodyJson, {});
    const unblock = await rpcdef({ ...ctx, req: { ip: '198.51.100.10' } })[UNBLOCK_PATH]();
    assert.deepEqual(unblock.bodyJson, {});

    assert.equal(mock.requests[0].query.user, 'admin');
    assert.equal(mock.requests[1].body.mask, '255.255.255.0');
    assert.equal(mock.requests[2].body.undo, '1');
  } finally {
    await mock.close();
  }
});
