import test from 'node:test';
import assert from 'node:assert/strict';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  CREATE_ADDRESS_GROUP_PATH,
  CREATE_SECURITY_POLICY_PATH,
  DELETE_ADDRESS_GROUP_PATH,
  DELETE_SECURITY_POLICY_PATH,
  ENABLE_PACKET_FILTER_IMMEDIATE_PATH,
  GET_PACKET_FILTER_STATUS_PATH,
  GET_SECURITY_POLICY_PATH,
  LIST_ADDRESS_GROUPS_PATH,
  METHOD_CREATE_ADDRESS_GROUP_FULL,
  METHOD_CREATE_SECURITY_POLICY_FULL,
  METHOD_DELETE_ADDRESS_GROUP_FULL,
  METHOD_DELETE_SECURITY_POLICY_FULL,
  METHOD_ENABLE_PACKET_FILTER_IMMEDIATE_FULL,
  METHOD_GET_PACKET_FILTER_STATUS_FULL,
  METHOD_GET_SECURITY_POLICY_FULL,
  METHOD_LIST_ADDRESS_GROUPS_FULL,
  METHOD_UPDATE_ADDRESS_GROUP_FULL,
  METHOD_UPDATE_SECURITY_POLICY_FULL,
  UPDATE_ADDRESS_GROUP_PATH,
  UPDATE_SECURITY_POLICY_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/dptech-fw-v4-6-10.js';
import { service } from '../src/service.js';

const NativeBuffer = globalThis.Buffer;
const NativeTextEncoder = globalThis.TextEncoder;
const originalFetch = globalThis.fetch;

const buildCtx = (overrides = {}) => ({
  bindings: {
    host: 'http://device.example:9090/',
    user: 'dptech_user',
    password: 'dptech_password',
    ...(overrides.bindings || {}),
  },
  config: overrides.config || {},
  secret: overrides.secret || {},
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

const expectStructuredError = async (fn, legacyCode, checker = () => {}) => {
  await assert.rejects(fn, (err) => {
    assert.ok(err instanceof GrpcError);
    assert.equal(err.legacyCode, legacyCode);
    const payload = JSON.parse(err.message);
    assert.equal(payload.code, legacyCode);
    checker(payload, err);
    return true;
  });
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.Buffer = NativeBuffer;
  globalThis.TextEncoder = NativeTextEncoder;
});

test('GetPacketFilterStatus sends fixed query and basic auth', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(JSON.stringify({ ret: '0', pfInEfList: { enable: 'true', ipVersion: '4' } }));
  };

  const result = await rpcdef(buildCtx())[GET_PACKET_FILTER_STATUS_PATH]();

  assert.equal(captured.url, 'http://device.example:9090/func/web_main/api/system/sysinfolist/pfInEfList?ipVersion=4');
  assert.equal(captured.init.method, 'GET');
  assert.equal(Object.hasOwn(captured.init, 'timeoutMs'), false);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.init.headers.accept, 'application/json');
  assert.equal(captured.init.headers.authorization, `Basic ${NativeBuffer.from('dptech_user:dptech_password').toString('base64')}`);
  assert.equal(result.http_status, 200);
  assert.equal(result.ret, '0');
  assert.equal(result.enable, 'true');
  assert.equal(result.ip_version, '4');
});

test('EnablePacketFilterImmediate returns ret and raw json', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(JSON.stringify({ ret: '0' }));
  };

  const result = await rpcdef(buildCtx())[ENABLE_PACKET_FILTER_IMMEDIATE_PATH]();

  assert.equal(captured.init.method, 'PUT');
  assert.deepEqual(JSON.parse(captured.init.body), { pfInEfList: { ipVersion: '4', enable: 'true' } });
  assert.equal(result.ret, '0');
  assert.equal(result.raw_json, undefined);
});

test('basic auth fallback handles utf8 without Buffer or TextEncoder', () => {
  globalThis.Buffer = undefined;
  globalThis.TextEncoder = undefined;

  assert.equal(_test.encodeBase64('dptech_user:dptech_password'), NativeBuffer.from('dptech_user:dptech_password').toString('base64'));
  assert.equal(_test.encodeBase64('a'), 'YQ==');
  assert.equal(_test.encodeBase64('ab'), 'YWI=');
  assert.equal(_test.encodeBase64('abc'), 'YWJj');
  assert.equal(_test.encodeBase64('用户:密码'), NativeBuffer.from('用户:密码').toString('base64'));
  assert.equal(_test.encodeBase64('😀', { forceFallback: true }), NativeBuffer.from('😀').toString('base64'));
  assert.deepEqual(_test.utf8Bytes('é', { forceFallback: true }), [0xc3, 0xa9]);
  assert.deepEqual(_test.utf8Bytes('a'), [0x61]);
});

test('host, user, password, timeout, TLS, and header resolution cover aliases', async () => {
  const ctx = buildCtx({
    bindings: {
      host: '',
      restBaseUrl: 'https://rest.example/',
      user: '',
      username: 'binding-user',
      password: '',
      pass: 'binding-pass',
      timeout_ms: 0,
      tlsInsecureSkipVerify: true,
      headers: { 'x-extra': '1' },
    },
    limits: { timeoutMs: 0 },
  });

  assert.equal(_test.resolveHost(ctx.bindings), 'https://rest.example');
  assert.equal(_test.resolveUser(ctx.bindings), 'binding-user');
  assert.equal(_test.resolvePassword(ctx.bindings), 'binding-pass');
  assert.equal(_test.pickString({ user: '', username: { value: 'second' } }, ['user', 'username']), 'second');
  assert.equal(_test.resolveTimeoutMs(ctx), 3000);
  const tlsOptions = await _test.buildTlsOptions(ctx.bindings);
  assert.ok(tlsOptions.dispatcher);
  assert.equal(Object.hasOwn(tlsOptions, 'skipTlsVerify'), false);
  assert.equal(_test.buildHeaders(ctx.bindings, { accept: 'text/plain' }).accept, 'text/plain');
  assert.equal(_test.buildHeaders(ctx.bindings)['x-extra'], '1');
  assert.equal(_test.buildUrl('https://fw.example/', '/path', { a: 'b c', empty: '', n: 1 }), 'https://fw.example/path?a=b%20c&n=1');
});

test('ListAddressGroups requires search_value and parses single or repeated items', async () => {
  await assert.rejects(() => rpcdef(buildCtx())[LIST_ADDRESS_GROUPS_PATH]({}), (err) => {
    assert.equal(err.code, grpcStatus.INVALID_ARGUMENT);
    assert.equal(err.legacyCode, 'INVALID_ARGUMENT');
    assert.match(err.message, /search_value is required/);
    return true;
  });

  globalThis.fetch = async () =>
    okResponse(
      JSON.stringify({
        ret: '0',
        netaddrobjlist: [
          { name: 'Block_IP_0001', ip: '203.0.113.10/32', desc: 'blocked' },
          { name: 'Block_IP_0002', ip: '203.0.113.11/32', description: 'desc alias' },
        ],
      }),
    );

  const result = await rpcdef(buildCtx())[LIST_ADDRESS_GROUPS_PATH]({ search_value: { value: 'Block_IP' } });
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].name, 'Block_IP_0001');
  assert.equal(result.items[1].description, 'desc alias');
  assert.deepEqual(_test.toAddressGroupItems({ netaddrobjlist: { name: 'one', ip: '1.1.1.1/32' } }), [
    { name: 'one', ip: '1.1.1.1/32', description: '' },
  ]);
});

test('CreateAddressGroup normalizes CIDRs and validates fields', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(JSON.stringify({ ret: '0' }));
  };

  const result = await rpcdef(buildCtx())[CREATE_ADDRESS_GROUP_PATH]({
    groupName: 'Block_IP_0001',
    description: 'blocked',
    ipCidrs: { values: [{ value: '203.0.113.10' }, '203.0.113.11/32'] },
  });

  const payload = JSON.parse(captured.init.body);
  assert.equal(payload.netaddrobjlist.vsysName, 'PublicSystem');
  assert.equal(payload.netaddrobjlist.name, 'Block_IP_0001');
  assert.equal(payload.netaddrobjlist.ip, '203.0.113.10/32,203.0.113.11/32');
  assert.equal(result.ret, '0');

  assert.throws(() => _test.normalizeCidr('2001:db8::1'), /invalid ipv4\/cidr value/);
  assert.throws(() => _test.normalizeCidr('192.0.2.1/33'), /invalid ipv4\/cidr value/);
  assert.throws(() => _test.normalizeCidr(''), /ip_cidrs item is required/);
  assert.throws(() => _test.normalizeCidrs([]), /ip_cidrs is required/);
  assert.deepEqual(_test.readRepeatedStrings('not-a-list'), []);
});

test('UpdateAddressGroup handles empty, duplicate text, JSON success, and non-JSON failure', async () => {
  const handler = rpcdef(buildCtx())[UPDATE_ADDRESS_GROUP_PATH];
  const req = {
    old_group_name: 'Block_IP_0001',
    new_group_name: 'Block_IP_0001',
    description: '',
    ip_cidrs: ['203.0.113.10'],
  };

  globalThis.fetch = async () => okResponse('');
  assert.deepEqual(await handler(req), { http_status: 200, ret: '', raw_body: '', raw_json: undefined });

  globalThis.fetch = async () => okResponse('Duplicate IP address ranges.');
  assert.equal((await handler({ ...req, new_group_name: 'DUPLICATE' })).raw_body, '');

  globalThis.fetch = async () => okResponse(JSON.stringify({ ret: '0' }));
  assert.equal((await handler(req)).ret, '0');

  globalThis.fetch = async () => okResponse('unexpected text');
  await expectStructuredError(() => handler(req), 'UNKNOWN', (payload) => {
    assert.equal(payload.reason, 'missing json body');
  });
});

test('DeleteAddressGroup and DeleteSecurityPolicy send DELETE bodies', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return okResponse(JSON.stringify({ ret: '0' }));
  };

  await rpcdef(buildCtx())[DELETE_ADDRESS_GROUP_PATH]({ group_name: 'Block_IP_0001' });
  await rpcdef(buildCtx())[DELETE_SECURITY_POLICY_PATH]({ policy_name: 'MSS_Block_IP' });

  assert.equal(calls[0].init.method, 'DELETE');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    netaddrobjlist: { ipVersion: '4', vsysName: 'PublicSystem', name: 'Block_IP_0001' },
  });
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    securitypolicylist: { ipVersion: '4', vsysName: 'PublicSystem', name: 'MSS_Block_IP' },
  });
});

test('GetSecurityPolicy parses single and repeated policy items', async () => {
  globalThis.fetch = async () =>
    okResponse(
      JSON.stringify({
        ret: '0',
        securitypolicylist: {
          name: 'MSS_Block_IP',
          enabled: '1',
          action: '0',
          sourceIpGroups: 'Block_IP_0001',
        },
      }),
    );

  const result = await rpcdef(buildCtx())[GET_SECURITY_POLICY_PATH]({ policy_name: 'MSS_Block_IP' });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].source_ip_objects, 'Block_IP_0001');
  assert.deepEqual(_test.toSecurityPolicyItems({ securitypolicylist: [{ name: 'one', sourceIpObjects: 'obj' }] }), [
    { name: 'one', enabled: '', action: '', source_ip_objects: 'obj' },
  ]);
  assert.deepEqual(_test.toSecurityPolicyItems({}), []);
});

test('CreateSecurityPolicy and UpdateSecurityPolicy map payloads', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return okResponse(JSON.stringify({ ret: '0' }));
  };

  await rpcdef(buildCtx())[CREATE_SECURITY_POLICY_PATH]({
    policyName: 'MSS_Block_IP',
    enabled: true,
    action: '0',
    sourceIpNames: ['Block_IP_0001', 'Block_IP_0002'],
  });
  await rpcdef(buildCtx())[UPDATE_SECURITY_POLICY_PATH]({
    oldPolicyName: 'MSS_Block_IP',
    newPolicyName: 'MSS_Block_IP_NEW',
    enabled: false,
    action: '1',
    sourceIpNames: { values: ['Block_IP_0003'] },
  });

  assert.equal(JSON.parse(calls[0].init.body).securitypolicylist.enabled, '1');
  assert.equal(JSON.parse(calls[0].init.body).securitypolicylist.sourceIpGroups, 'Block_IP_0001,Block_IP_0002');
  assert.equal(JSON.parse(calls[1].init.body).securitypolicylist.enabled, '0');
  assert.equal(JSON.parse(calls[1].init.body).securitypolicylist.sourceIpObjects, 'Block_IP_0003');
});

test('UpdateSecurityPolicy treats empty 200 body as success and validates inputs', async () => {
  globalThis.fetch = async () => okResponse('');
  const result = await rpcdef(buildCtx())[UPDATE_SECURITY_POLICY_PATH]({
    old_policy_name: 'MSS_Block_IP',
    new_policy_name: 'MSS_Block_IP',
    enabled: true,
    action: '0',
    source_ip_names: ['Block_IP_0001'],
  });
  assert.equal(result.http_status, 200);
  assert.equal(result.raw_body, '');

  await assert.rejects(() => rpcdef(buildCtx())[UPDATE_SECURITY_POLICY_PATH]({
    old_policy_name: 'MSS_Block_IP',
    new_policy_name: 'MSS_Block_IP',
    enabled: true,
    action: '',
    source_ip_names: ['Block_IP_0001'],
  }), /action is required/);
  assert.throws(() => _test.joinNames([], 'source_ip_names'), /source_ip_names is required/);
});

test('HTTP statuses and business ret failures become structured errors', async () => {
  globalThis.fetch = async () => responseWithStatus(401, JSON.stringify({ ret: '-401', msg: 'unauthorized' }));
  await expectStructuredError(
    () => rpcdef(buildCtx())[DELETE_ADDRESS_GROUP_PATH]({ group_name: 'Block_IP_0001' }),
    'PERMISSION_DENIED',
    (payload) => {
      assert.equal(payload.http_status, 401);
      assert.equal(payload.raw_json, undefined);
      assert.ok(payload.raw_body_length > 0);
    },
  );

  globalThis.fetch = async () => responseWithStatus(404, 'missing');
  await expectStructuredError(
    () => rpcdef(buildCtx())[GET_SECURITY_POLICY_PATH]({ policy_name: 'missing' }),
    'FAILED_PRECONDITION',
    (payload) => {
      assert.equal(payload.http_status, 404);
      assert.equal(payload.reason, 'http status is not 2xx');
    },
  );

  globalThis.fetch = async () => responseWithStatus(503, JSON.stringify({ ret: '-503', msg: 'temporary unavailable' }));
  await expectStructuredError(
    () => rpcdef(buildCtx())[GET_SECURITY_POLICY_PATH]({ policy_name: 'SERVER_ERR' }),
    'UNAVAILABLE',
    (payload) => {
      assert.equal(payload.http_status, 503);
    },
  );

  globalThis.fetch = async () => okResponse(JSON.stringify({ ret: '-1', msg: 'device busy' }));
  await expectStructuredError(() => rpcdef(buildCtx())[GET_PACKET_FILTER_STATUS_PATH](), 'FAILED_PRECONDITION', (payload) => {
    assert.equal(payload.ret, '-1');
    assert.equal(payload.reason, 'ret != 0');
  });
});

test('non-JSON 200 and fetch failures become structured errors', async () => {
  globalThis.fetch = async () => okResponse('not-json');
  await expectStructuredError(() => rpcdef(buildCtx())[GET_PACKET_FILTER_STATUS_PATH](), 'UNKNOWN', (payload) => {
    assert.equal(payload.http_status, 200);
    assert.equal(payload.raw_body, '');
    assert.equal(payload.raw_body_length, 'not-json'.length);
    assert.equal(payload.reason, 'response is not valid JSON');
  });

  globalThis.fetch = async () => {
    const err = new Error('fetch failed');
    err.cause = new Error('network down');
    throw err;
  };
  await expectStructuredError(() => rpcdef(buildCtx())[GET_PACKET_FILTER_STATUS_PATH](), 'UNAVAILABLE', (payload) => {
    assert.equal(payload.http_status, 0);
    assert.equal(payload.reason, 'network down');
  });
});

test('missing bindings produce invalid argument errors', async () => {
  await assert.rejects(() => rpcdef(buildCtx({ bindings: { host: 'ftp://bad' } }))[GET_PACKET_FILTER_STATUS_PATH](), /bindings.host is required/);
  await assert.rejects(() => rpcdef(buildCtx({ bindings: { user: '' } }))[GET_PACKET_FILTER_STATUS_PATH](), /bindings.user is required/);
  await assert.rejects(() => rpcdef(buildCtx({ bindings: { password: '' } }))[GET_PACKET_FILTER_STATUS_PATH](), /bindings.password is required/);
});

test('SDK handlers merge config and secret fields', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(JSON.stringify({ ret: '0', pfInEfList: { enable: 'false', ipVersion: '4' } }));
  };

  const result = await handlers[METHOD_GET_PACKET_FILTER_STATUS_FULL]({
    config: {
      endpoint: 'https://fw.example.local/',
      timeout_ms: 3100,
      headers: { 'x-trace': 'abc' },
      skipTlsVerify: true,
    },
    secret: {
      username: 'secret_user',
      secret: 'secret_password',
    },
  });

  assert.equal(captured.url, 'https://fw.example.local/func/web_main/api/system/sysinfolist/pfInEfList?ipVersion=4');
  assert.equal(Object.hasOwn(captured.init, 'timeoutMs'), false);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.init.headers.authorization, `Basic ${NativeBuffer.from('secret_user:secret_password').toString('base64')}`);
  assert.equal(captured.init.headers['x-trace'], 'abc');
  assert.equal(Object.hasOwn(captured.init, 'skipTlsVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'tlsInsecureSkipVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'insecureSkipVerify'), false);
  assert.ok(captured.init.dispatcher);
  assert.equal(result.enable, 'false');
});

test('SDK handlers and service wrapper expose expected entries', async () => {
  globalThis.fetch = async () => okResponse('Duplicate IP address ranges.');

  const result = await handlers[METHOD_UPDATE_ADDRESS_GROUP_FULL]({
    bindings: {
      host: 'http://device.example:9090',
      user: 'dptech_user',
      password: 'dptech_password',
    },
    request: {
      old_group_name: 'Block_IP_0001',
      new_group_name: 'DUPLICATE',
      ip_cidrs: ['203.0.113.10'],
    },
  });

  assert.equal(result.raw_body, '');
  assert.ok(service);
});

test('SDK handler map covers all migrated RPC methods', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return okResponse(JSON.stringify({ ret: '0' }));
  };
  const ctx = {
    bindings: {
      host: 'http://device.example:9090',
      user: 'dptech_user',
      password: 'dptech_password',
    },
  };

  await handlers[METHOD_ENABLE_PACKET_FILTER_IMMEDIATE_FULL](ctx);
  await handlers[METHOD_LIST_ADDRESS_GROUPS_FULL]({ ...ctx, req: { search_value: 'Block_IP' } });
  await handlers[METHOD_CREATE_ADDRESS_GROUP_FULL]({
    ...ctx,
    req: { group_name: 'Block_IP_0001', ip_cidrs: ['203.0.113.10'] },
  });
  await handlers[METHOD_DELETE_ADDRESS_GROUP_FULL]({ ...ctx, req: { group_name: 'Block_IP_0001' } });
  await handlers[METHOD_GET_SECURITY_POLICY_FULL]({ ...ctx, req: { policy_name: 'MSS_Block_IP' } });
  await handlers[METHOD_CREATE_SECURITY_POLICY_FULL]({
    ...ctx,
    req: { policy_name: 'MSS_Block_IP', action: '0', source_ip_names: ['Block_IP_0001'] },
  });
  await handlers[METHOD_UPDATE_SECURITY_POLICY_FULL]({
    ...ctx,
    req: {
      old_policy_name: 'MSS_Block_IP',
      new_policy_name: 'MSS_Block_IP',
      action: '0',
      source_ip_names: ['Block_IP_0001'],
    },
  });
  await handlers[METHOD_DELETE_SECURITY_POLICY_FULL]({ ...ctx, req: { policy_name: 'MSS_Block_IP' } });

  assert.equal(calls.length, 8);
});

test('helper conversions cover object, list, scalar, and null values', () => {
  assert.deepEqual(_test.utf8Bytes('a'), [0x61]);
  assert.deepEqual(_test.toValue(null), undefined);
  assert.deepEqual(_test.toValue(false), { boolValue: false });
  assert.deepEqual(_test.toValue(3), { numberValue: 3 });
  assert.deepEqual(_test.toValue(Number.NaN), { stringValue: 'NaN' });
  assert.deepEqual(_test.toValue(['x', null]), {
    listValue: { values: [{ stringValue: 'x' }, { nullValue: 'NULL_VALUE' }] },
  });
  assert.deepEqual(_test.toValue({ a: 'b', none: undefined }), {
    structValue: { fields: { a: { stringValue: 'b' }, none: { nullValue: 'NULL_VALUE' } } },
  });
  assert.deepEqual(_test.toValue(12n), { stringValue: '12' });
  assert.equal(_test.firstDefined(null, undefined, 'x'), 'x');
  assert.equal(_test.unwrapScalar({ value: { value: 7 } }), '7');
  assert.equal(_test.tryParseJson('{bad').ok, false);
  assert.deepEqual(_test.successResponse(204, '', undefined), {
    http_status: 204,
    ret: '',
    raw_body: '',
    raw_json: undefined,
  });
  assert.throws(
    () => _test.assertBusinessRetZero(null, 'missing result'),
    (err) => {
      assert.equal(err.legacyCode, 'UNKNOWN');
      assert.equal(JSON.parse(err.message).reason, 'missing response');
      return true;
    },
  );
  assert.equal(_test.assertBusinessRetZero({ httpStatus: 200, rawBody: '', json: undefined }, 'empty allowed', true), undefined);
});

test('helper defaults and null request fallbacks are stable', async () => {
  assert.equal(_test.buildUrl('', '', {}), '/');
  assert.equal(_test.resolveUser(), '');
  assert.equal(_test.resolvePassword(), '');
  assert.equal(_test.isIPv4('1.1.1'), false);
  assert.equal(_test.isIPv4Cidr(''), false);
  assert.equal(_test.isIPv4Cidr('1.1.1.1/xx'), false);
  assert.deepEqual(_test.toAddressGroupItems({}), []);
  assert.deepEqual(_test.successResponse(200, null, { msg: 'ok' }), {
    http_status: 200,
    ret: '',
    raw_body: '',
    raw_json: undefined,
  });
  assert.throws(
    () => _test.throwStructuredError('NOT_A_GRPC_CODE', 'fallback status'),
    (err) => {
      assert.equal(err.code, grpcStatus.UNKNOWN);
      const payload = JSON.parse(err.message);
      assert.equal(payload.http_status, 0);
      assert.equal(payload.raw_body, '');
      return true;
    },
  );
  assert.throws(
    () => _test.assertBusinessRetZero({ httpStatus: 200, rawBody: '', json: undefined }, 'empty denied'),
    (err) => {
      assert.equal(JSON.parse(err.message).reason, 'missing json body');
      return true;
    },
  );

  const nullReqPaths = [
    [GET_PACKET_FILTER_STATUS_PATH, JSON.stringify({ ret: '0', pfInEfList: { enable: 'true', ipVersion: '4' } })],
    [ENABLE_PACKET_FILTER_IMMEDIATE_PATH, JSON.stringify({ ret: '0' })],
  ];
  for (const [path, body] of nullReqPaths) {
    globalThis.fetch = async () => okResponse(body);
    assert.equal((await rpcdef(buildCtx())[path](null)).ret, '0');
  }
});
