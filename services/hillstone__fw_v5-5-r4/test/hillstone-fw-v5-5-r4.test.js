import test from 'node:test';
import assert from 'node:assert/strict';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  CREATE_ADDRESS_GROUP_PATH,
  LOGIN_PATH,
  METHOD_CREATE_ADDRESS_GROUP_FULL,
  METHOD_LOGIN_FULL,
  METHOD_QUERY_ADDRESS_GROUP_FULL,
  METHOD_UPDATE_ADDRESS_GROUP_FULL,
  QUERY_ADDRESS_GROUP_PATH,
  UPDATE_ADDRESS_GROUP_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/hillstone-fw-v5-5-r4.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;

const defaultConfig = {
  userName: 'api_user',
};

const defaultSecret = {
  password: 'U3VwZXJTZWNyZXQh',
};

const buildCtx = (overrides = {}) => ({
  bindings: {
    ...(overrides.bindings || {}),
  },
  config: overrides.config === undefined ? defaultConfig : overrides.config,
  secret: overrides.secret === undefined ? defaultSecret : overrides.secret,
  limits: { timeoutMs: 10_000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const okResponse = (body) => ({
  ok: true,
  status: 200,
  text: async () => body,
});

const responseWithStatus = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
});

const cookie = {
  fromrootvsys: 'true',
  role: 'admin',
  vsys_id: '0',
  token: 'token-123',
  username: 'hillstone',
  lang: 'zh_CN',
};

const seedSession = (ctx, host = 'https://203.0.113.10:8443', session = cookie) => {
  _test.setSession(ctx, host, {
    ...session,
    vsysId: session.vsysId ?? session.vsys_id,
  });
  return ctx;
};

const expectStructuredError = async (fn, code, checker) => {
  let caught;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'expected function to reject');
  assert.ok(caught instanceof GrpcError);
  assert.equal(caught.code, ({
    FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
    PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
  })[code]);
  assert.equal(caught.legacyCode, code);
  const payload = JSON.parse(caught.message);
  assert.equal(payload.code, code);
  checker(payload);
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  _test.clearAllSessions();
});

test('Login sends text/plain JSON body with defaults', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse('{"success":true,"result":[{"token":"abc"}]}');
  };

  const result = await rpcdef(buildCtx({
    req: {
      host: 'https://203.0.113.10:8443',
      user_name: 'request_user',
      password: 'request-password',
    },
  }))[LOGIN_PATH]();

  assert.equal(captured.url, 'https://203.0.113.10:8443/rest/doc/login');
  assert.equal(captured.init.method, 'POST');
  assert.equal(Object.hasOwn(captured.init, 'timeoutMs'), false);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.init.headers['content-type'], 'text/plain;charset=UTF-8');
  assert.equal(captured.init.headers.accept, 'text/plain;charset=UTF-8, application/json;q=0.9, */*;q=0.8');
  assert.deepEqual(JSON.parse(captured.init.body), {
    userName: 'api_user',
    password: 'U3VwZXJTZWNyZXQh',
    ifVsysId: '0',
    vrId: '1',
    lang: 'zh_CN',
  });
  assert.equal(result.http_status, 200);
  assert.equal(result.http_body, '');
});

test('CreateAddressGroup sends full cookie header and JSON array text body', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse('{"success":true}');
  };

  const result = await rpcdef(seedSession(buildCtx({
    req: {
      host: 'https://203.0.113.10:8443',
      address_books: [
        {
          name: 'BLOCK_GROUP_01',
          ip: [
            { ip_addr: '203.0.113.10', netmask: '32', flag: 0 },
            { ipAddr: '203.0.113.11', netmask: '32', flag: 0 },
          ],
        },
      ],
    },
  })))[CREATE_ADDRESS_GROUP_PATH]();

  assert.equal(captured.url, 'https://203.0.113.10:8443/rest/doc/addrbook');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers.Cookie, 'fromrootvsys=true; role=admin; vsysId=0; token=token-123; username=hillstone; lang=zh_CN');
  assert.deepEqual(JSON.parse(captured.init.body), [
    {
      name: 'BLOCK_GROUP_01',
      ip: [
        { ip_addr: '203.0.113.10', netmask: '32', flag: 0 },
        { ip_addr: '203.0.113.11', netmask: '32', flag: 0 },
      ],
    },
  ]);
  assert.equal(result.http_status, 200);
});

test('UpdateAddressGroup preserves optional range/entry/host arrays', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse('{"success":true,"result":[]}');
  };

  await rpcdef(seedSession(buildCtx({
    req: {
      host: 'https://203.0.113.10:8443',
      addressBooks: [
        {
          name: 'BLOCK_GROUP_01',
          ip: [{ ip_addr: '203.0.113.10', netmask: '32', flag: 0 }],
          range: [{ min: '25.3.3.3', max: '25.3.3.9', flag: 0 }],
          entry: [{ name: 'testadd21', type: '0' }],
          host: [{ dnsName: 'example.com' }],
        },
      ],
    },
  })))[UPDATE_ADDRESS_GROUP_PATH]();

  const payload = JSON.parse(captured.init.body);
  assert.equal(captured.init.method, 'PUT');
  assert.deepEqual(payload[0].range, [{ min: '25.3.3.3', max: '25.3.3.9', flag: 0 }]);
  assert.deepEqual(payload[0].entry, [{ name: 'testadd21', type: '0' }]);
  assert.deepEqual(payload[0].host, [{ dns_name: 'example.com' }]);
});

test('QueryAddressGroup encodes name/start/limit/page into query parameter', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse('{"success":true,"result":[]}');
  };

  const result = await rpcdef(seedSession(buildCtx({
    req: {
      host: 'https://203.0.113.10:8443',
      name: 'BLOCK_GROUP_01',
      start: 0,
      limit: 100,
      page: 2,
    },
  })))[QUERY_ADDRESS_GROUP_PATH]();

  assert.equal(result.http_status, 200);
  assert.ok(captured.url.startsWith('https://203.0.113.10:8443/rest/doc/addrbook?query='));
  const encoded = captured.url.split('?query=')[1];
  const query = JSON.parse(decodeURIComponent(encoded));
  assert.deepEqual(query, {
    conditions: [{ field: 'name', value: 'BLOCK_GROUP_01' }],
    start: 0,
    limit: 100,
    page: 2,
  });
});

test('CreateAddressGroup validates cached session before request cookies', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({
      req: {
        host: 'https://203.0.113.10:8443',
        address_books: [{ name: 'BLOCK_GROUP_01', ip: [{ ip_addr: '203.0.113.10', netmask: '32', flag: 0 }] }],
      },
    }))[CREATE_ADDRESS_GROUP_PATH](),
    /call Login first/,
  );
});

test('HTTP errors map to structured gRPC errors', async () => {
  const cases = [
    [401, 'PERMISSION_DENIED'],
    [403, 'PERMISSION_DENIED'],
    [404, 'FAILED_PRECONDITION'],
    [500, 'UNAVAILABLE'],
  ];

  for (const [status, code] of cases) {
    globalThis.fetch = async () => responseWithStatus(status, '{"success":false,"msg":"error"}');
    await expectStructuredError(
      () => rpcdef(seedSession(buildCtx({
        req: { host: 'https://203.0.113.10:8443', name: 'BLOCK_GROUP_01' },
      })))[QUERY_ADDRESS_GROUP_PATH](),
      code,
      (payload) => {
        assert.equal(payload.http_status, status);
        assert.equal(payload.http_body, '');
        assert.ok(payload.http_body_length > 0);
        assert.equal(payload.reason, 'http status is not 2xx');
      },
    );
  }
});

test('Login maps transport failure to structured UNAVAILABLE with http_status 0', async () => {
  globalThis.fetch = async () => {
    throw Object.assign(new Error('network error'), { cause: new Error('connect ECONNREFUSED') });
  };

  await expectStructuredError(
    () => rpcdef(buildCtx({
      req: {
        host: 'https://203.0.113.10:8443',
      },
    }))[LOGIN_PATH](),
    'UNAVAILABLE',
    (payload) => {
      assert.equal(payload.http_status, 0);
      assert.equal(payload.http_body, '');
      assert.match(payload.reason, /ECONNREFUSED/);
    },
  );
});

test('SDK handlers merge config and secret bindings', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse('{"success":true}');
  };

  const result = await handlers[METHOD_LOGIN_FULL]({
    config: {
      host: 'https://198.51.100.10:9443',
      userName: 'config_user',
      timeout_ms: 3100,
      headers: { 'X-Custom': 'value' },
      skipTlsVerify: true,
    },
    secret: {
      password: 'Secret',
    },
    request: {},
  });

  assert.equal(result.http_status, 200);
  assert.equal(captured.url, 'https://198.51.100.10:9443/rest/doc/login');
  assert.equal(Object.hasOwn(captured.init, 'timeoutMs'), false);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(Object.hasOwn(captured.init, 'skipTlsVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'tlsInsecureSkipVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'insecureSkipVerify'), false);
  assert.ok(captured.init.dispatcher);
  assert.equal(captured.init.headers['X-Custom'], 'value');
  assert.deepEqual(JSON.parse(captured.init.body).userName, 'config_user');
  assert.ok(service);
  assert.deepEqual(Object.keys(handlers).sort(), [
    METHOD_CREATE_ADDRESS_GROUP_FULL,
    METHOD_LOGIN_FULL,
    METHOD_QUERY_ADDRESS_GROUP_FULL,
    METHOD_UPDATE_ADDRESS_GROUP_FULL,
  ].sort());
});

test('direct SDK handlers cover create, update, and query paths', async () => {
  globalThis.fetch = async () => okResponse('{"success":true}');
  const baseReq = { host: 'https://203.0.113.10:8443' };

  assert.equal((await handlers[METHOD_CREATE_ADDRESS_GROUP_FULL](seedSession(buildCtx({
    req: { ...baseReq, address_books: [{ name: 'g', ip: [{ ip_addr: '203.0.113.10', netmask: '32' }] }] },
  })))).http_status, 200);
  assert.equal((await handlers[METHOD_UPDATE_ADDRESS_GROUP_FULL](seedSession(buildCtx({
    req: { ...baseReq, address_books: [{ name: 'g', ip: [{ ip_addr: '203.0.113.11', netmask: '32' }] }] },
  })))).http_status, 200);
  assert.equal((await handlers[METHOD_QUERY_ADDRESS_GROUP_FULL](seedSession(buildCtx({
    req: { ...baseReq, name: 'g', limit: 0, page: 0 },
  })))).http_status, 200);
});

test('helper functions keep legacy edge behavior stable', async () => {
  assert.equal(_test.requireHost('https://203.0.113.10:8443///'), 'https://203.0.113.10:8443');
  assert.throws(() => _test.requireHost('203.0.113.10:8443'), /http\(s\) scheme/);
  assert.throws(() => _test.requireString('', 'field'), /field is required/);
  assert.equal(_test.unwrapScalar(null), undefined);
  assert.equal(_test.unwrapScalar({ value: { value: 'x' } }), 'x');
  assert.equal(_test.toTrimmedString({ value: ' x ' }), 'x');
  assert.equal(_test.toTrimmedString(null), '');
  assert.equal(_test.pickFirst({ a: { value: 1 } }, ['a']), 1);
  assert.equal(_test.pickFirst(null, ['a']), undefined);
  assert.equal(_test.pickRequestOrBinding({}, { bindings: { host: 'https://h:1' } }, ['host']), 'https://h:1');
  assert.equal(_test.readInteger('', 50, 'limit'), 50);
  assert.equal(_test.readInteger('1.9', 50, 'limit'), 1);
  assert.throws(() => _test.readInteger('bad', 50, 'limit'), /valid integer/);
  const tlsOptions = await _test.buildTlsOptions({ insecureSkipVerify: true });
  assert.ok(tlsOptions.dispatcher);
  assert.equal(Object.hasOwn(tlsOptions, 'insecureSkipVerify'), false);
  assert.deepEqual(await _test.buildTlsOptions({}), {});
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeoutMs: -1 }, limits: { timeoutMs: 0 } }), 5000);
  assert.deepEqual(_test.resolveCallContext({ config: { a: 1, password: 'config' }, secret: { b: 2, password: 'secret' }, bindings: { c: 3, password: 'binding' }, request: { x: 1 } }).bindings, { a: 1, b: 2, c: 3, password: 'secret' });
  assert.equal(_test.firstDefined(undefined, null, 'x'), 'x');
  assert.equal(_test.hasOwn({ a: 1 }, 'a'), true);
  assert.deepEqual(_test.asArray({ values: [{ value: 'a' }, 'b'] }), ['a', 'b']);
  assert.deepEqual(_test.asArray(['a']), ['a']);
  assert.deepEqual(_test.asArray('bad'), []);
  assert.deepEqual(_test.buildCookieContext({ ...cookie, vsysId: '1', lang: '' }).lang, 'zh_CN');
  assert.equal(_test.buildCookieHeader({ fromrootvsys: 't', role: 'r', vsysId: '0', token: 'tok', username: 'u', lang: 'zh_CN' }), 'fromrootvsys=t; role=r; vsysId=0; token=tok; username=u; lang=zh_CN');
  assert.throws(() => _test.mapAddressBookIP({ ip_addr: '', netmask: '32' }), /ip_addr is required/);
  assert.throws(() => _test.mapAddressBookRange({ min: '', max: '1.1.1.2' }), /min is required/);
  assert.throws(() => _test.mapAddressBookEntry({ name: 'n', type: '' }), /type is required/);
  assert.throws(() => _test.mapAddressBookHost({ dns_name: '' }), /dns_name is required/);
  assert.deepEqual(_test.mapAddressBook({ name: 'g', ip: [], range: [], entry: [], host: [] }), { name: 'g', ip: [] });
  assert.throws(() => _test.buildAddressBooks([]), /at least one/);
  assert.deepEqual(_test.buildLoginPayload({ userName: 'u', password: 'p', ifVsysId: '2', vrId: '3', lang: 'en_US' }, buildCtx()), {
    userName: 'api_user',
    password: 'U3VwZXJTZWNyZXQh',
    ifVsysId: '2',
    vrId: '3',
    lang: 'en_US',
  });
  const queryUrl = _test.buildQueryUrl('https://h:1', { name: 'g', start: 1, limit: 0, page: 0 });
  assert.match(decodeURIComponent(queryUrl), /"limit":50/);
  assert.match(decodeURIComponent(_test.buildQueryUrl('https://h:1', { name: 'g', limit: 5, page: 6 })), /"page":6/);
  assert.equal(_test.errorWithCode('UNKNOWN', 'msg').code, grpcStatus.UNKNOWN);
  assert.throws(() => _test.throwStructuredError('UNAVAILABLE', 'msg', { httpStatus: 0, reason: 'r' }), /"reason":"r"/);
  assert.throws(() => _test.throwStructuredError('UNAVAILABLE', 'msg'), /"http_status":0/);
  assert.throws(() => _test.throwForHttpStatus(418, 'body'), /hillstone upstream client error/);
  assert.throws(() => _test.throwForHttpStatus(503, 'body'), /hillstone upstream unavailable/);

  globalThis.fetch = async () => okResponse('');
  const empty = await _test.fetchText(buildCtx(), 'https://h:1', { method: 'GET' });
  assert.deepEqual(empty, { http_status: 200, http_body: '' });
});
