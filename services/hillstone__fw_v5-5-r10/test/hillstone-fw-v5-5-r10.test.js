import test from 'node:test';
import assert from 'node:assert/strict';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  ADD_ADDRESS_GROUP_PATH,
  LOGIN_PATH,
  METHOD_ADD_ADDRESS_GROUP_FULL,
  METHOD_LOGIN_FULL,
  METHOD_OVERWRITE_ADDRESS_GROUP_FULL,
  METHOD_QUERY_ADDRESS_GROUP_FULL,
  OVERWRITE_ADDRESS_GROUP_PATH,
  QUERY_ADDRESS_GROUP_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/hillstone-fw-v5-5-r10.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;
let instanceSeq = 0;

const nextInstanceId = () => `inst-${++instanceSeq}`;

const defaultConfig = {
  username: 'api_user',
};

const defaultSecret = {
  password: 'SuperSecret!',
};

const buildCtx = (overrides = {}) => ({
  bindings: {
    ...(overrides.bindings || {}),
  },
  config: overrides.config === undefined ? defaultConfig : overrides.config,
  secret: overrides.secret === undefined ? defaultSecret : overrides.secret,
  limits: { timeoutMs: 10_000, ...(overrides.limits || {}) },
  meta: { instance_id: nextInstanceId(), request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const jsonResponse = (status, payload) => ({
  status,
  text: async () => JSON.stringify(payload),
});

const textResponse = (status, body) => ({
  status,
  text: async () => body,
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  _test.clearAllSessions();
});

const loginReq = (host = 'https://203.0.113.10:8443') => ({
  host,
  username: 'request_user',
  password: 'RequestSecret!',
});

const loginOnce = async (instanceId, host = 'https://203.0.113.10:8443') => {
  globalThis.fetch = async () => jsonResponse(200, {
    success: true,
    result: [{ token: 'token-123', role: 'admin', vsysId: '0', fromrootvsys: 'true' }],
  });
  await rpcdef(buildCtx({ req: loginReq(host), meta: { instance_id: instanceId } }))[LOGIN_PATH]();
};

test('Login sends fixed fields and caches session for later calls', async () => {
  const instanceId = nextInstanceId();
  let loginCaptured;
  let addCaptured;
  globalThis.fetch = async (url, init) => {
    if (url.endsWith('/rest/api/login')) {
      loginCaptured = { url, init };
      return jsonResponse(200, {
        success: true,
        result: [{ token: 'token-123', role: 'admin', vsysId: '0', fromrootvsys: 'true' }],
      });
    }
    addCaptured = { url, init };
    return jsonResponse(200, { success: true, result: [] });
  };

  const loginRes = await rpcdef(buildCtx({ req: loginReq(), meta: { instance_id: instanceId } }))[LOGIN_PATH]();

  assert.equal(loginCaptured.url, 'https://203.0.113.10:8443/rest/api/login');
  assert.equal(loginCaptured.init.method, 'POST');
  assert.equal(Object.hasOwn(loginCaptured.init, 'timeoutMs'), false);
  assert.ok(loginCaptured.init.signal instanceof AbortSignal);
  assert.equal(loginCaptured.init.headers['content-type'], 'text/plain;charset=UTF-8');
  assert.deepEqual(JSON.parse(loginCaptured.init.body), {
    userName: 'api_user',
    password: 'SuperSecret!',
    encodeUserName: '0',
    encodePassword: '0',
    lang: 'zh_CN',
  });
  assert.equal(loginRes.http_status, 200);
  assert.equal(loginRes.body.is_json, false);
  assert.equal(loginRes.body.raw_text, '');
  assert.equal(loginRes.body.json_value, null);

  await rpcdef(buildCtx({
    req: {
      host: 'https://203.0.113.10:8443',
      groupName: 'block_group',
      ips: [{ ipAddr: '203.0.113.10' }],
    },
    meta: { instance_id: instanceId },
  }))[ADD_ADDRESS_GROUP_PATH]();

  assert.equal(addCaptured.url, 'https://203.0.113.10:8443/rest/api/addrbook');
  assert.equal(addCaptured.init.method, 'POST');
  assert.equal(addCaptured.init.headers.Cookie, 'fromrootvsys=true; role=admin; vsysId=0; token=token-123; username=api_user; lang=zh_CN');
  assert.deepEqual(JSON.parse(addCaptured.init.body), [
    {
      name: 'block_group',
      ip: [{ ip_addr: '203.0.113.10', netmask: '32', flag: 0 }],
    },
  ]);
});

test('Address-group RPC rejects when session is missing', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({
      req: {
        host: 'https://203.0.113.10:8443',
        group_name: 'block_group',
        ips: [{ ip_addr: '203.0.113.10', netmask: '32' }],
      },
    }))[ADD_ADDRESS_GROUP_PATH](),
    (err) => {
      assert.ok(err instanceof GrpcError);
      assert.equal(err.code, grpcStatus.FAILED_PRECONDITION);
      assert.equal(err.legacyCode, 'FAILED_PRECONDITION');
      assert.match(err.message, /call Login first/);
      return true;
    },
  );
});

test('QueryAddressGroup encodes defaults into query and does not send GET body', async () => {
  const instanceId = nextInstanceId();
  let captured;
  globalThis.fetch = async (url, init) => {
    if (url.endsWith('/rest/api/login')) {
      return jsonResponse(200, {
        success: true,
        result: [{ token: 'token-123', role: 'admin', vsysId: '0', fromrootvsys: 'true' }],
      });
    }
    captured = { url, init };
    return jsonResponse(200, { success: true, result: [] });
  };

  await rpcdef(buildCtx({ req: { ...loginReq(), host: 'https://[2001:db8::1]:8443/' }, meta: { instance_id: instanceId } }))[LOGIN_PATH]();
  const result = await rpcdef(buildCtx({
    req: { host: 'https://[2001:db8::1]:8443/', group_name: 'block_group' },
    meta: { instance_id: instanceId },
  }))[QUERY_ADDRESS_GROUP_PATH]();

  assert.equal(result.http_status, 200);
  assert.ok(captured.url.startsWith('https://[2001:db8::1]:8443/rest/api/addrbook?query='));
  const encoded = captured.url.split('?query=')[1];
  const parsed = JSON.parse(decodeURIComponent(encoded));
  assert.deepEqual(parsed, {
    conditions: [{ field: 'name', value: 'block_group' }],
    start: 0,
    limit: 50,
    page: 1,
  });
  assert.equal(captured.init.method, 'GET');
  assert.equal(captured.init.body, undefined);
});

test('OverwriteAddressGroup returns gRPC OK for upstream 500 JSON response', async () => {
  const instanceId = nextInstanceId();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return jsonResponse(200, {
        success: true,
        result: [{ token: 'token-123', role: 'admin', vsysId: '0', fromrootvsys: 'true' }],
      });
    }
    return jsonResponse(500, { success: false, msg: 'upstream failed' });
  };

  await rpcdef(buildCtx({ req: loginReq(), meta: { instance_id: instanceId } }))[LOGIN_PATH]();
  const res = await rpcdef(buildCtx({
    req: {
      host: 'https://203.0.113.10:8443',
      group_name: 'block_group',
      ips: { values: [{ value: { ip_addr: { value: '203.0.113.10' }, netmask: { value: '32' } } }] },
    },
    meta: { instance_id: instanceId },
  }))[OVERWRITE_ADDRESS_GROUP_PATH]();

  assert.equal(res.http_status, 500);
  assert.equal(res.body.is_json, true);
  assert.deepEqual(res.body.json_value.structValue.fields.msg, { stringValue: 'upstream failed' });
  assert.equal(res.body.raw_text, '');
});

test('QueryAddressGroup preserves non-json response text', async () => {
  const instanceId = nextInstanceId();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return jsonResponse(200, {
        success: true,
        result: [{ token: 'token-123', role: 'admin', vsysId: '0', fromrootvsys: 'true' }],
      });
    }
    return textResponse(404, '<html>not found</html>');
  };

  await rpcdef(buildCtx({ req: loginReq(), meta: { instance_id: instanceId } }))[LOGIN_PATH]();
  const res = await rpcdef(buildCtx({
    req: { host: 'https://203.0.113.10:8443', group_name: 'missing' },
    meta: { instance_id: instanceId },
  }))[QUERY_ADDRESS_GROUP_PATH]();

  assert.equal(res.http_status, 404);
  assert.equal(res.body.is_json, false);
  assert.equal(res.body.raw_text, '<html>not found</html>');
  assert.equal(res.body.json_value, null);
});

test('401 clears cached session for subsequent calls', async () => {
  const instanceId = nextInstanceId();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return jsonResponse(200, {
        success: true,
        result: [{ token: 'token-123', role: 'admin', vsysId: '0', fromrootvsys: 'true' }],
      });
    }
    return jsonResponse(401, { success: false, msg: 'expired' });
  };

  await rpcdef(buildCtx({ req: loginReq(), meta: { instance_id: instanceId } }))[LOGIN_PATH]();
  const res = await rpcdef(buildCtx({
    req: {
      host: 'https://203.0.113.10:8443',
      group_name: 'block_group',
      ips: [{ ip_addr: '203.0.113.10', netmask: '32' }],
    },
    meta: { instance_id: instanceId },
  }))[ADD_ADDRESS_GROUP_PATH]();
  assert.equal(res.http_status, 401);

  await assert.rejects(
    () => rpcdef(buildCtx({
      req: { host: 'https://203.0.113.10:8443', group_name: 'block_group' },
      meta: { instance_id: instanceId },
    }))[QUERY_ADDRESS_GROUP_PATH](),
    /call Login first/,
  );
});

test('Network failures map to UNAVAILABLE', async () => {
  globalThis.fetch = async () => {
    throw Object.assign(new Error('network error'), { cause: new Error('connect ECONNREFUSED') });
  };
  await assert.rejects(
    () => rpcdef(buildCtx({ req: loginReq() }))[LOGIN_PATH](),
    (err) => {
      assert.equal(err.code, grpcStatus.UNAVAILABLE);
      assert.equal(err.legacyCode, 'UNAVAILABLE');
      assert.match(err.message, /connect ECONNREFUSED/);
      return true;
    },
  );
});

test('Empty upstream body is represented as non-json empty text', async () => {
  const instanceId = nextInstanceId();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return jsonResponse(200, {
        success: true,
        result: [{ token: 'token-123', role: 'admin', vsysId: '0', fromrootvsys: 'true' }],
      });
    }
    return textResponse(200, '');
  };

  await rpcdef(buildCtx({ req: loginReq(), meta: { instance_id: instanceId } }))[LOGIN_PATH]();
  const res = await rpcdef(buildCtx({
    req: {
      host: 'https://203.0.113.10:8443',
      group_name: 'block_group',
      ips: [{ ip_addr: '203.0.113.10', netmask: '32' }],
    },
    meta: { instance_id: instanceId },
  }))[OVERWRITE_ADDRESS_GROUP_PATH]();
  assert.equal(res.http_status, 200);
  assert.equal(res.body.is_json, false);
  assert.equal(res.body.raw_text, '');
  assert.equal(res.body.json_value, null);
});

test('SDK handlers merge config and secret bindings', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return jsonResponse(200, {
      success: true,
      result: [{ token: 'token-456', role: 'auditor', vsysId: '1', fromrootvsys: 'false' }],
    });
  };

  const result = await handlers[METHOD_LOGIN_FULL]({
    config: {
      host: 'https://198.51.100.10:9443',
      username: 'config_user',
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
  assert.equal(captured.url, 'https://198.51.100.10:9443/rest/api/login');
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
    METHOD_ADD_ADDRESS_GROUP_FULL,
    METHOD_LOGIN_FULL,
    METHOD_OVERWRITE_ADDRESS_GROUP_FULL,
    METHOD_QUERY_ADDRESS_GROUP_FULL,
  ].sort());
});

test('direct SDK handlers cover add, overwrite, and query paths', async () => {
  const instanceId = nextInstanceId();
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls += 1;
    if (calls === 1) {
      return jsonResponse(200, {
        success: true,
        result: [{ token: 'token-123', role: 'admin', vsysId: '0', fromrootvsys: 'true' }],
      });
    }
    return jsonResponse(200, { success: true, url, method: init.method });
  };

  await handlers[METHOD_LOGIN_FULL](buildCtx({ req: loginReq(), meta: { instance_id: instanceId } }));
  assert.equal((await handlers[METHOD_ADD_ADDRESS_GROUP_FULL](buildCtx({
    req: { host: 'https://203.0.113.10:8443', group_name: 'block_group', ips: [{ ip_addr: '203.0.113.10' }] },
    meta: { instance_id: instanceId },
  }))).http_status, 200);
  assert.equal((await handlers[METHOD_OVERWRITE_ADDRESS_GROUP_FULL](buildCtx({
    req: { host: 'https://203.0.113.10:8443', group_name: 'block_group', ips: [{ ip_addr: '203.0.113.11' }] },
    meta: { instance_id: instanceId },
  }))).http_status, 200);
  assert.equal((await handlers[METHOD_QUERY_ADDRESS_GROUP_FULL](buildCtx({
    req: { host: 'https://203.0.113.10:8443', group_name: 'block_group', start: 1, limit: 2, page: 3 },
    meta: { instance_id: instanceId },
  }))).http_status, 200);
});

test('helper validation and body wrappers keep legacy edge behavior', async () => {
  assert.equal(_test.requireHost('HTTPS://203.0.113.10:8443/'), 'https://203.0.113.10:8443');
  assert.equal(_test.requireHost('https://[2001:db8::1]:8443'), 'https://[2001:db8::1]:8443');
  assert.throws(() => _test.requireHost('https://203.0.113.10'), /explicit port/);
  assert.throws(() => _test.requireHost('https://203.0.113.10:8443/path'), /must not include path/);
  assert.throws(() => _test.requireHost('ftp://203.0.113.10:21'), /valid http/);
  assert.deepEqual(_test.parseAuthority('[2001:db8::1]:8443'), { hostPart: '[2001:db8::1]', portPart: '8443' });
  assert.equal(_test.parseAuthority('[bad'), null);
  assert.equal(_test.parseAuthority('host:'), null);
  assert.equal(_test.readNonNegativeInt(undefined, 'start', 0), 0);
  assert.equal(_test.readNonNegativeInt({ value: '2' }, 'start', 0), 2);
  assert.throws(() => _test.readNonNegativeInt('bad', 'start', 0), /valid integer/);
  assert.throws(() => _test.readNonNegativeInt(-1, 'start', 0), /non-negative/);
  assert.equal(_test.toTrimmedString({ value: ' x ' }), 'x');
  assert.equal(_test.unwrapScalar({ value: { value: 'x' } }), 'x');
  assert.deepEqual(_test.buildBodyWrapper(''), { is_json: false, json_value: null, raw_text: '' });
  assert.equal(_test.buildBodyWrapper('{"a":1}').json_value.structValue.fields.a.numberValue, 1);
  assert.equal(_test.buildBodyWrapper('text').raw_text, 'text');
  assert.deepEqual(_test.toValue(null), null);
  assert.deepEqual(_test.toValue([null]).listValue.values[0], { nullValue: 'NULL_VALUE' });
  assert.deepEqual(_test.toValue({ a: null }).structValue.fields.a, { nullValue: 'NULL_VALUE' });
  assert.deepEqual(_test.toValue(Symbol('x')), { stringValue: 'Symbol(x)' });
  assert.deepEqual(_test.buildHttpResponse(201, 'text'), {
    http_status: 201,
    body: { is_json: false, json_value: null, raw_text: 'text' },
  });
  assert.deepEqual(_test.normalizeIpItem({ ip_addr: { value: '203.0.113.10' }, netmask: '' }), {
    ip_addr: '203.0.113.10',
    netmask: '32',
    flag: 0,
  });
  assert.deepEqual(_test.readRepeatedIps({ values: [{ value: { ip_addr: '203.0.113.10' } }] }), [{ ip_addr: '203.0.113.10' }]);
  assert.throws(() => _test.normalizeIpList([]), /non-empty array/);
  assert.throws(() => _test.buildAddressBookPayload({ group_name: '', ips: [{ ip_addr: '1.1.1.1' }] }), /group_name is required/);
  assert.equal(_test.buildQueryUrl('https://h:1', { group_name: 'g', start: 0, limit: 0, page: 0 }).includes('%22limit%22%3A50'), true);
  assert.equal(_test.getInstanceKey({ meta: { instanceId: 'i' } }), 'i');
  assert.equal(_test.getInstanceKey({}), 'default');
  const tlsOptions = await _test.buildTlsOptions({ tlsInsecureSkipVerify: true });
  assert.ok(tlsOptions.dispatcher);
  assert.equal(Object.hasOwn(tlsOptions, 'tlsInsecureSkipVerify'), false);
  assert.deepEqual(await _test.buildTlsOptions({}), {});
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeoutMs: -1 }, limits: { timeoutMs: 0 } }), 5000);
  assert.deepEqual(_test.resolveCallContext({ config: { a: 1, password: 'config' }, secret: { b: 2, password: 'secret' }, bindings: { c: 3, password: 'binding' }, request: { x: 1 } }).bindings, { a: 1, b: 2, c: 3, password: 'secret' });
  assert.equal(_test.firstDefined(undefined, null, 'x'), 'x');
  assert.equal(_test.hasOwn({ a: 1 }, 'a'), true);

  assert.equal(_test.extractSessionFromLogin(loginReq(), buildCtx(), 500, '{}'), null);
  assert.equal(_test.extractSessionFromLogin(loginReq(), buildCtx(), 200, 'not-json'), null);
  assert.equal(_test.extractSessionFromLogin(loginReq(), buildCtx(), 200, '{"success":false}'), null);
  assert.equal(_test.extractSessionFromLogin(loginReq(), buildCtx(), 200, '{"success":true,"result":[]}'), null);
  assert.equal(_test.extractSessionFromLogin(loginReq(), buildCtx(), 200, '{"success":true,"result":[{}]}'), null);

  const ctx = buildCtx({ meta: { instance_id: 'session-test' } });
  _test.setSession(ctx, 'https://h:1', { token: 't' });
  assert.deepEqual(_test.getSession(ctx, 'https://h:1'), { token: 't' });
  _test.clearSession(ctx, 'https://h:1');
  assert.equal(_test.getSession(ctx, 'https://h:1'), undefined);

  await loginOnce('unused-instance');
});
