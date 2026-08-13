import test from 'node:test';
import assert from 'node:assert/strict';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  ADD_BLACKLIST_PATH,
  DELETE_BLACKLIST_PATH,
  LOGIN_PATH,
  METHOD_ADD_BLACKLIST_FULL,
  METHOD_DELETE_BLACKLIST_FULL,
  METHOD_LOGIN_FULL,
  METHOD_QUERY_BLACKLIST_FULL,
  QUERY_BLACKLIST_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/dptech-umc-ads-v5-3-29.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;
let instanceSeq = 0;

const nextInstanceId = () => `inst-${++instanceSeq}`;

const buildCtx = (overrides = {}) => ({
  bindings: {
    host: 'https://203.0.113.10:8443/',
    ...(overrides.bindings || {}),
  },
  config: {
    user: 'api_user',
    ...(overrides.config || {}),
  },
  secret: {
    password: 'SuperSecret!',
    ...(overrides.secret || {}),
  },
  limits: { timeoutMs: 10_000, ...(overrides.limits || {}) },
  meta: { instance_id: overrides.instanceId || nextInstanceId(), request_id: 'req-1', ...(overrides.meta || {}) },
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
  _test.clearSessionCache();
});

test('Login uses bindings credentials and caches token for later query', async () => {
  const instanceId = nextInstanceId();
  let loginCaptured;
  let queryCaptured;

  globalThis.fetch = async (url, init) => {
    if (url.endsWith('/UMC/restful/token/getRestfulInterfaceToken')) {
      loginCaptured = { url, init };
      return jsonResponse(200, {
        code: 0,
        token: 'token-123',
        expireTime: '2026-06-30 23:59:59',
      });
    }
    queryCaptured = { url, init };
    return jsonResponse(200, { code: 0, details: [] });
  };

  const ctx = buildCtx({ instanceId });
  const loginRes = await rpcdef(ctx)[LOGIN_PATH]();

  assert.equal(loginCaptured.url, 'https://203.0.113.10:8443/UMC/restful/token/getRestfulInterfaceToken');
  assert.equal(loginCaptured.init.method, 'POST');
  assert.equal(Object.hasOwn(loginCaptured.init, 'timeoutMs'), false);
  assert.ok(loginCaptured.init.signal instanceof AbortSignal);
  assert.equal(loginCaptured.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(loginCaptured.init.body), {
    userName: 'api_user',
    secretKey: 'SuperSecret!',
  });
  assert.equal(loginRes.http_status, 200);
  assert.equal(loginRes.raw_body, '');
  assert.equal(loginRes.raw_json, undefined);
  assert.equal(_test.getSession(ctx, 'https://203.0.113.10:8443').token, 'token-123');

  const query = rpcdef(buildCtx({ instanceId, req: { page: 2, size: 10 } }))[QUERY_BLACKLIST_PATH];
  await query();

  assert.equal(queryCaptured.url, 'https://203.0.113.10:8443/UMC/restful/api/getBlackAndWhiteListStrategy');
  assert.equal(queryCaptured.init.method, 'POST');
  assert.equal(queryCaptured.init.headers.token, 'token-123');
  assert.deepEqual(JSON.parse(queryCaptured.init.body), { page: 2, size: 10 });
});

test('business RPC rejects when session is missing and ignores direct request token', async () => {
  await assert.rejects(() => rpcdef(buildCtx())[QUERY_BLACKLIST_PATH](), (err) => {
    assert.ok(err instanceof GrpcError);
    assert.equal(err.code, grpcStatus.FAILED_PRECONDITION);
    assert.equal(err.legacyCode, 'FAILED_PRECONDITION');
    assert.match(err.message, /call Login first/);
    return true;
  });

  globalThis.fetch = async (url, init) => {
    assert.fail(`request token should not trigger upstream call: ${url} ${JSON.stringify(init)}`);
    return jsonResponse(200, { code: 0, details: [] });
  };

  await assert.rejects(() => rpcdef(buildCtx({ req: { token: 'token-direct', page: 1, size: 10 } }))[QUERY_BLACKLIST_PATH](), /call Login first/);
});

test('QueryBlacklist applies default pagination and optional filters', async () => {
  const instanceId = nextInstanceId();
  const bodies = [];
  let step = 0;

  globalThis.fetch = async (_url, init) => {
    step += 1;
    bodies.push(JSON.parse(init.body));
    if (step === 1) return jsonResponse(200, { code: 0, token: 'token-1' });
    return jsonResponse(200, { code: 0, details: [] });
  };

  await rpcdef(buildCtx({ instanceId }))[LOGIN_PATH]();
  const res = await rpcdef(buildCtx({
    instanceId,
    req: { strategy_name: 'ip_name_203_0_113_10', ipAddress: '203.0.113.10', page_no: 0, page_size: -1 },
  }))[QUERY_BLACKLIST_PATH]();

  assert.equal(res.http_status, 200);
  assert.deepEqual(bodies[1], {
    page: 1,
    size: 50,
    strategyName: 'ip_name_203_0_113_10',
    ip: '203.0.113.10',
  });
});

test('AddBlacklist builds configParam with IPv4 and IPv6 defaults', async () => {
  const instanceId = nextInstanceId();
  const capturedBodies = [];
  let callCount = 0;

  globalThis.fetch = async (_url, init) => {
    callCount += 1;
    capturedBodies.push(JSON.parse(init.body));
    if (callCount === 1) return jsonResponse(200, { code: 0, token: 'token-1' });
    return jsonResponse(200, { code: 0, message: 'success' });
  };

  await rpcdef(buildCtx({ instanceId }))[LOGIN_PATH]();
  const res = await rpcdef(buildCtx({
    instanceId,
    req: { ips: ['203.0.113.10', { value: '2001:db8::1' }] },
  }))[ADD_BLACKLIST_PATH]();

  assert.equal(res.http_status, 200);
  assert.deepEqual(capturedBodies[1], {
    operationType: 1,
    configParam: [
      {
        strategyName: 'ip_name_203_0_113_10',
        strategyScope: 2,
        cleaningDeviceScope: 1,
        ipSegments: ['203.0.113.10'],
        survivalTime: '永久',
        action: 2,
        isExpired: 0,
        protectionName: 'IPv4-All users',
      },
      {
        strategyName: 'ip_name_2001_db8_1',
        strategyScope: 2,
        cleaningDeviceScope: 1,
        ipSegments: ['2001:db8::1'],
        survivalTime: '永久',
        action: 2,
        isExpired: 0,
        protectionName: 'IPv6-All users',
      },
    ],
  });
});

test('DeleteBlacklist reuses strategyName rule and repeated values wrapper', async () => {
  const instanceId = nextInstanceId();
  const capturedBodies = [];
  let callCount = 0;

  globalThis.fetch = async (_url, init) => {
    callCount += 1;
    capturedBodies.push(JSON.parse(init.body));
    if (callCount === 1) return jsonResponse(200, { code: 0, token: 'token-1' });
    return jsonResponse(200, { code: 0, message: 'success' });
  };

  await rpcdef(buildCtx({ instanceId }))[LOGIN_PATH]();
  await rpcdef(buildCtx({
    instanceId,
    req: { ipList: { values: ['203.0.113.10'] } },
  }))[DELETE_BLACKLIST_PATH]();

  assert.deepEqual(capturedBodies[1], {
    operationType: 3,
    configParam: [
      {
        strategyName: 'ip_name_203_0_113_10',
        ipSegments: ['203.0.113.10'],
      },
    ],
  });
});

test('HTTP 500 JSON and non-JSON responses are preserved as OK payloads', async () => {
  const instanceId = nextInstanceId();
  let step = 0;

  globalThis.fetch = async () => {
    step += 1;
    if (step === 1) return jsonResponse(200, { code: 0, token: 'token-1' });
    if (step === 2) return jsonResponse(500, { code: 7, message: 'duplicate' });
    return textResponse(404, '<html>not found</html>');
  };

  await rpcdef(buildCtx({ instanceId }))[LOGIN_PATH]();
  const addRes = await rpcdef(buildCtx({ instanceId, req: { ips: ['203.0.113.10'] } }))[ADD_BLACKLIST_PATH]();
  const queryRes = await rpcdef(buildCtx({ instanceId }))[QUERY_BLACKLIST_PATH]();

  assert.equal(addRes.http_status, 500);
  assert.equal(addRes.raw_body, '');
  assert.equal(addRes.raw_json, undefined);
  assert.equal(queryRes.http_status, 404);
  assert.equal(queryRes.raw_body, '');
  assert.equal(queryRes.raw_json, undefined);
});

test('cached token is cleared on cached-token 401 but direct token is not cached', async () => {
  const instanceId = nextInstanceId();
  let step = 0;

  globalThis.fetch = async () => {
    step += 1;
    if (step === 1) return jsonResponse(200, { code: 0, token: 'token-1' });
    if (step === 2) return jsonResponse(401, { code: 401, message: 'invalid token' });
    return jsonResponse(401, { code: 401, message: 'direct invalid token' });
  };

  const ctx = buildCtx({ instanceId });
  await rpcdef(ctx)[LOGIN_PATH]();
  assert.equal(_test.getSession(ctx, 'https://203.0.113.10:8443').token, 'token-1');
  await rpcdef(buildCtx({ instanceId }))[QUERY_BLACKLIST_PATH]();
  assert.equal(_test.getSession(ctx, 'https://203.0.113.10:8443'), undefined);

  await assert.rejects(() => rpcdef(buildCtx({ req: { token: 'direct' } }))[QUERY_BLACKLIST_PATH](), /call Login first/);
});

test('network failures and missing config surface as gRPC errors', async () => {
  globalThis.fetch = async () => {
    throw Object.assign(new Error('boom'), { cause: new Error('socket hangup') });
  };

  await assert.rejects(() => rpcdef(buildCtx())[LOGIN_PATH](), (err) => {
    assert.equal(err.code, grpcStatus.UNAVAILABLE);
    assert.equal(err.legacyCode, 'UNAVAILABLE');
    assert.match(err.message, /socket hangup/);
    return true;
  });

  await assert.rejects(() => rpcdef(buildCtx({ bindings: { host: 'ftp://bad' } }))[LOGIN_PATH](), /host is required/);
  await assert.rejects(() => rpcdef(buildCtx({ config: { user: '', username: '' }, secret: { user: '', username: '' } }))[LOGIN_PATH](), /user\/username is required/);
  await assert.rejects(() => rpcdef(buildCtx({ secret: { password: '', pass: '', secret: '' } }))[LOGIN_PATH](), /password is required/);
});

test('invalid IPs and oversized batches are rejected locally', () => {
  assert.throws(() => _test.normalizeIpList(['999.0.0.1']), /ips\[0\] must be a valid IPv4 or IPv6 address/);
  assert.throws(() => _test.normalizeIpList(['2001:db8::1/64']), /ips\[0\] must be a valid IPv4 or IPv6 address/);
  assert.throws(() => _test.normalizeIpList([]), /ips must be a non-empty array/);
  assert.throws(() => _test.normalizeIpList('203.0.113.10'), /ips must be a non-empty array/);
  assert.throws(
    () => _test.normalizeIpList(Array.from({ length: 101 }, (_, i) => `203.0.113.${i % 255}`)),
    /ips must contain at most 100 entries/,
  );
});

test('SDK handlers merge config and secret fields', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return jsonResponse(200, { code: 0, token: 'token-secret', expireTime: 'later' });
  };

  const result = await handlers[METHOD_LOGIN_FULL]({
    config: {
      endpoint: 'https://umc.example.local/',
      timeout_ms: 3100,
      headers: { 'X-Trace': 'abc' },
      skipTlsVerify: true,
    },
    secret: {
      username: 'secret_user',
      secret: 'secret_password',
    },
  });

  assert.equal(captured.url, 'https://umc.example.local/UMC/restful/token/getRestfulInterfaceToken');
  assert.equal(Object.hasOwn(captured.init, 'timeoutMs'), false);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(Object.hasOwn(captured.init, 'skipTlsVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'tlsInsecureSkipVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'insecureSkipVerify'), false);
  assert.ok(captured.init.dispatcher);
  assert.equal(captured.init.headers['X-Trace'], 'abc');
  assert.deepEqual(JSON.parse(captured.init.body), { userName: 'secret_user', secretKey: 'secret_password' });
  assert.equal(result.raw_body, '');
  assert.equal(result.raw_json, undefined);
});

test('SDK handler map covers all migrated RPC methods', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse(200, { code: 0, message: 'ok' });
  };

  const ctx = {
    bindings: {
      host: 'https://203.0.113.10:8443',
      user: 'api_user',
      password: 'SuperSecret!',
    },
  };

  _test.setSession({ meta: { instance_id: 'default-instance' } }, 'https://203.0.113.10:8443', { token: 'cached' });
  await handlers[METHOD_QUERY_BLACKLIST_FULL]({ ...ctx, req: { token: 'direct', page: 2 } });
  await handlers[METHOD_ADD_BLACKLIST_FULL]({ ...ctx, req: { token: 'direct', ips: ['203.0.113.10'] } });
  await handlers[METHOD_DELETE_BLACKLIST_FULL]({ ...ctx, request: { token: 'direct', ips: ['203.0.113.10'] } });

  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((call) => call.init.headers.token), ['cached', 'cached', 'cached']);
  assert.ok(service);
});

test('helper conversions and validators cover edge branches', () => {
  assert.equal(_test.normalizeBaseUrl('http://host///'), 'http://host');
  assert.equal(_test.normalizeBaseUrl('host'), '');
  assert.equal(_test.pickString({ user: '', username: { value: 'name' } }, ['user', 'username']), 'name');
  assert.equal(_test.normalizePositiveInt('2.9', 1), 2);
  assert.equal(_test.normalizePositiveInt('bad', 1), 1);
  assert.equal(_test.toInteger('bad', 7), 7);
  assert.equal(_test.unwrapString({ value: { value: 3 } }), '3');
  assert.equal(_test.parseJsonMaybe(''), undefined);
  assert.equal(_test.parseJsonMaybe('not-json'), undefined);
  assert.equal(_test.isHexSegment('abcd'), true);
  assert.deepEqual(_test.splitIpv6Part('2001:db8'), ['2001', 'db8']);
  assert.equal(_test.splitIpv6Part('2001::db8'), null);
  assert.equal(_test.isValidIPv4('1.2.3'), false);
  assert.equal(_test.isValidIPv4('1.2.3.999'), false);
  assert.equal(_test.isValidIPv6('2001:db8:0:0:0:0:0:1'), true);
  assert.equal(_test.isValidIPv6('2001:db8::1%eth0'), true);
  assert.equal(_test.isValidIPv6('2001:::1'), false);
  assert.equal(_test.isValidIPv6('1:2:3:4:5:6:7:8:9'), false);
  assert.equal(_test.isValidIPv6('1::2::3'), false);
  assert.throws(() => _test.requireIp('', 'ip'), /ip is required/);
  assert.equal(_test.buildProtectionName('2001:db8::1'), 'IPv6-All users');
  assert.deepEqual(_test.buildDeleteConfigItem('2001:db8::1'), {
    strategyName: 'ip_name_2001_db8_1',
    ipSegments: ['2001:db8::1'],
  });
  assert.deepEqual(_test.toValue([undefined, 'x']), { listValue: { values: [{ stringValue: 'x' }] } });
  assert.deepEqual(_test.toValue({ a: undefined, b: null, c: Number.NaN }), {
    structValue: {
      fields: {
        b: { nullValue: 'NULL_VALUE' },
        c: { stringValue: 'NaN' },
      },
    },
  });
  assert.deepEqual(_test.toValue(12n), { stringValue: '12' });
  assert.deepEqual(_test.toResponse({ status: 'bad', text: null, json: undefined }), { http_status: 0, raw_body: '' });
});
