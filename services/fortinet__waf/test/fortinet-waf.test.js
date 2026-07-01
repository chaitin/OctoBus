import test from 'node:test';
import assert from 'node:assert/strict';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  BLOCK_IP_PATH,
  CHECK_ONLINE_PATH,
  LIST_MEMBERS_PATH,
  METHOD_BLOCK_IP_FULL,
  METHOD_CHECK_ONLINE_FULL,
  METHOD_LIST_MEMBERS_FULL,
  METHOD_UNBLOCK_IP_FULL,
  UNBLOCK_IP_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/fortinet-waf.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;

const buildCtx = (overrides = {}) => ({
  bindings: {
    host: 'https://device.example:90',
    username: 'api_user',
    password: 'SuperSecret',
    headers: {},
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
  text: async () => body,
});

const okResponse = (body) => responseWithStatus(200, body);

const parseErrorPayload = async (fn) => {
  let caught;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'expected function to reject');
  return { err: caught, payload: JSON.parse(caught.message) };
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalConsoleLog;
});

test('CheckOnline validates host and credentials', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ bindings: { host: '' } }))[CHECK_ONLINE_PATH](),
    (err) => {
      assert.ok(err instanceof GrpcError);
      assert.equal(err.code, grpcStatus.INVALID_ARGUMENT);
      assert.equal(err.legacyCode, 'INVALID_ARGUMENT');
      assert.match(err.message, /host is required/);
      return true;
    },
  );
  await assert.rejects(
    () => rpcdef(buildCtx({ bindings: { username: '' } }))[CHECK_ONLINE_PATH](),
    /username is required/,
  );
  await assert.rejects(
    () => rpcdef(buildCtx({ bindings: { password: '' } }))[CHECK_ONLINE_PATH](),
    /password is required/,
  );
});

test('CheckOnline builds authorization header without Basic prefix', async () => {
  let captured;
  const logs = [];
  console.log = (...args) => logs.push(args);
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(JSON.stringify({ status: 1, msg: 'Online', version: 'FWB 6.2.1' }));
  };

  const result = await rpcdef(buildCtx())[CHECK_ONLINE_PATH]();

  assert.equal(captured.url, 'https://device.example:90/api/v1.0/System/Status/Online');
  assert.equal(captured.init.method, 'GET');
  assert.equal(Object.hasOwn(captured.init, 'timeoutMs'), false);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.init.headers.Authorization, Buffer.from('api_user:SuperSecret').toString('base64'));
  assert.equal(captured.init.headers['Content-Type'], 'application/json');
  assert.equal(captured.init.headers['x-engine-instance'], 'inst');
  assert.equal(captured.init.headers['x-request-id'], 'req');
  assert.equal(result.success, true);
  assert.equal(result.status, 1);
  assert.equal(result.msg, 'Online');
  assert.equal(result.raw_json, undefined);
  assert.match(JSON.stringify(logs), /CheckOnline/);
});

test('CheckOnline maps business failure and response shape errors', async () => {
  globalThis.fetch = async () => okResponse(JSON.stringify({ status: 0, msg: 'Offline', version: 'FWB 6.2.1' }));
  const offline = await parseErrorPayload(() => rpcdef(buildCtx())[CHECK_ONLINE_PATH]());
  assert.equal(offline.err.code, grpcStatus.FAILED_PRECONDITION);
  assert.equal(offline.payload.code, 'FAILED_PRECONDITION');
  assert.equal(offline.payload.http_status, 200);
  assert.equal(offline.payload.reason, 'status_not_one');
  assert.equal(offline.payload.raw_json, undefined);
  assert.ok(offline.payload.raw_body_length > 0);

  globalThis.fetch = async () => okResponse(JSON.stringify([1]));
  const mismatch = await parseErrorPayload(() => rpcdef(buildCtx())[CHECK_ONLINE_PATH]());
  assert.equal(mismatch.payload.code, 'UNKNOWN');
  assert.equal(mismatch.payload.reason, 'response_type_mismatch');
});

test('BlockIP validates request before calling upstream', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return okResponse('{}');
  };
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { book_name: 'block-book', ip: 'not-an-ip' } }))[BLOCK_IP_PATH](),
    /ip must be a valid IPv4 or IPv6 address/,
  );
  assert.equal(called, false);

  await assert.rejects(
    () => rpcdef(buildCtx({ req: { book_name: '', ip: '203.0.113.45' } }))[BLOCK_IP_PATH](),
    /book_name is required/,
  );
});

test('BlockIP sends fixed Fortinet payload for IPv4 and IPv6', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return okResponse(JSON.stringify({ status: 0, affected: 1, msg: 'OK' }));
  };

  const ipv4 = await rpcdef(buildCtx({ req: { bookName: 'block/book', ip: '203.0.113.45' } }))[BLOCK_IP_PATH]();
  const ipv6 = await rpcdef(buildCtx({ req: { book_name: 'block-book', ip: '2001:db8::1' } }))[BLOCK_IP_PATH]();

  assert.equal(calls[0].url, 'https://device.example:90/api/v1.0/WebProtection/Access/IPList/block/book/IPListCreateIPListPolicyMember');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    type: 2,
    iPv4IPv6: '203.0.113.45',
    severity: 2,
    triggerPolicy: '',
  });
  assert.equal(ipv4.success, true);
  assert.equal(ipv4.affected, 1);
  assert.equal(ipv6.success, true);
});

test('ListIPListMembers parses array response into members', async () => {
  globalThis.fetch = async () => okResponse(JSON.stringify([
    { id: 1024, type: 2, iPv4IPv6: '203.0.113.45', severity: 2, triggerPolicy: '', status: 0 },
    { id: 1025, type: 2, iPv4IPv6: '2001:db8::1', severity: 2, triggerPolicy: 'policy-a', status: 0 },
  ]));

  const result = await rpcdef(buildCtx({ req: { book_name: 'block-book' } }))[LIST_MEMBERS_PATH]();

  assert.equal(result.http_status, 200);
  assert.equal(result.members.length, 2);
  assert.equal(result.members[0].member_id, 1024);
  assert.equal(result.members[0].ip, '203.0.113.45');
  assert.equal(result.members[1].trigger_policy, 'policy-a');
  assert.equal(result.raw_json, undefined);
});

test('ListIPListMembers rejects invalid member and non-array responses', async () => {
  globalThis.fetch = async () => okResponse(JSON.stringify({ id: 1 }));
  const nonArray = await parseErrorPayload(() => rpcdef(buildCtx({ req: { book_name: 'block-book' } }))[LIST_MEMBERS_PATH]());
  assert.equal(nonArray.payload.code, 'UNKNOWN');
  assert.equal(nonArray.payload.reason, 'response_type_mismatch');

  globalThis.fetch = async () => okResponse(JSON.stringify([null]));
  const badShape = await parseErrorPayload(() => rpcdef(buildCtx({ req: { book_name: 'block-book' } }))[LIST_MEMBERS_PATH]());
  assert.equal(badShape.payload.reason, 'member_shape_invalid');

  globalThis.fetch = async () => okResponse(JSON.stringify([{ id: 0, iPv4IPv6: '' }]));
  const missingFields = await parseErrorPayload(() => rpcdef(buildCtx({ req: { book_name: 'block-book' } }))[LIST_MEMBERS_PATH]());
  assert.equal(missingFields.payload.reason, 'member_fields_missing');
});

test('UnblockIP deletes by member_id path parameter', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(JSON.stringify({ status: 0, affected: 1, msg: 'Deleted' }));
  };

  const result = await rpcdef(buildCtx({ req: { book_name: 'block-book', memberId: 1024 } }))[UNBLOCK_IP_PATH]();

  assert.equal(captured.url, 'https://device.example:90/api/v1.0/WebProtection/Access/IPList/block-book/IPListCreateIPListPolicyMember/1024');
  assert.equal(captured.init.method, 'DELETE');
  assert.equal(result.success, true);
  assert.equal(result.affected, 1);
});

test('UnblockIP rejects invalid member_id and affected != 1', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { book_name: 'block-book', member_id: 0 } }))[UNBLOCK_IP_PATH](),
    /member_id must be a positive integer/,
  );

  globalThis.fetch = async () => okResponse(JSON.stringify({ status: 0, affected: 0, msg: 'Not found' }));
  const failed = await parseErrorPayload(() => rpcdef(buildCtx({ req: { book_name: 'block-book', member_id: 1024 } }))[UNBLOCK_IP_PATH]());
  assert.equal(failed.payload.code, 'FAILED_PRECONDITION');
  assert.equal(failed.payload.reason, 'affected_not_one');
  assert.equal(failed.payload.raw_json, undefined);
  assert.ok(failed.payload.raw_body_length > 0);
});

test('HTTP and network failures preserve legacy JSON details', async () => {
  const cases = [
    [401, grpcStatus.PERMISSION_DENIED, 'PERMISSION_DENIED'],
    [403, grpcStatus.PERMISSION_DENIED, 'PERMISSION_DENIED'],
    [404, grpcStatus.FAILED_PRECONDITION, 'FAILED_PRECONDITION'],
    [500, grpcStatus.UNAVAILABLE, 'UNAVAILABLE'],
  ];

  for (const [status, grpcCode, legacyCode] of cases) {
    globalThis.fetch = async () => responseWithStatus(status, JSON.stringify({ status: 0, msg: 'error' }));
    const { err, payload } = await parseErrorPayload(() => rpcdef(buildCtx({ req: { book_name: 'block-book', ip: '203.0.113.45' } }))[BLOCK_IP_PATH]());
    assert.equal(err.code, grpcCode);
    assert.equal(err.legacyCode, legacyCode);
    assert.equal(payload.http_status, status);
    assert.equal(payload.reason, 'http_status_not_ok');
  }

  globalThis.fetch = async () => {
    throw Object.assign(new Error('network error'), { cause: new Error('socket hangup') });
  };
  const network = await parseErrorPayload(() => rpcdef(buildCtx({ req: { book_name: 'block-book' } }))[LIST_MEMBERS_PATH]());
  assert.equal(network.err.code, grpcStatus.UNAVAILABLE);
  assert.equal(network.payload.http_status, 0);
  assert.equal(network.payload.raw_body, '');
  assert.equal(network.payload.reason, 'socket hangup');
});

test('Non-JSON success response is UNKNOWN without raw_body leakage', async () => {
  globalThis.fetch = async () => okResponse('not-json');
  const { payload } = await parseErrorPayload(() => rpcdef(buildCtx())[CHECK_ONLINE_PATH]());
  assert.equal(payload.code, 'UNKNOWN');
  assert.equal(payload.reason, 'invalid_json');
  assert.equal(payload.raw_body, '');
  assert.equal(payload.raw_body_length, 'not-json'.length);
});

test('SDK handlers merge config and secret and expose all methods', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(JSON.stringify({ status: 1, msg: 'Online', version: 'FWB' }));
  };

  const result = await handlers[METHOD_CHECK_ONLINE_FULL]({
    config: {
      endpoint: 'https://config-device.example/',
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

  assert.equal(result.success, true);
  assert.equal(captured.url, 'https://config-device.example/api/v1.0/System/Status/Online');
  assert.equal(Object.hasOwn(captured.init, 'timeoutMs'), false);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.init.headers.Authorization, Buffer.from('config_user:Secret').toString('base64'));
  assert.equal(captured.init.headers['X-Custom'], 'value');
  assert.equal(Object.hasOwn(captured.init, 'skipTlsVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'tlsInsecureSkipVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'insecureSkipVerify'), false);
  assert.ok(captured.init.dispatcher);
  assert.equal(Object.hasOwn(captured.init, 'skipTlsVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'tlsInsecureSkipVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'insecureSkipVerify'), false);
  assert.ok(captured.init.dispatcher);
  assert.ok(service);
  assert.deepEqual(Object.keys(handlers).sort(), [
    METHOD_BLOCK_IP_FULL,
    METHOD_CHECK_ONLINE_FULL,
    METHOD_LIST_MEMBERS_FULL,
    METHOD_UNBLOCK_IP_FULL,
  ].sort());
});

test('direct SDK handlers cover block, list, and unblock paths', async () => {
  globalThis.fetch = async (url, init) => {
    if (init.method === 'GET') {
      return okResponse(JSON.stringify([{ id: 1, type: 2, iPv4IPv6: '203.0.113.45', severity: 2, triggerPolicy: '', status: 0 }]));
    }
    return okResponse(JSON.stringify({ status: 0, affected: 1, msg: 'OK' }));
  };

  assert.equal((await handlers[METHOD_BLOCK_IP_FULL](buildCtx({ req: { book_name: 'block-book', ip: '203.0.113.45' } }))).affected, 1);
  assert.equal((await handlers[METHOD_LIST_MEMBERS_FULL](buildCtx({ req: { book_name: 'block-book' } }))).members.length, 1);
  assert.equal((await handlers[METHOD_UNBLOCK_IP_FULL](buildCtx({ req: { book_name: 'block-book', member_id: 1 } }))).affected, 1);
});

test('helper functions keep edge behavior stable', async () => {
  assert.equal(_test.normalizeBaseUrl('https://host///'), 'https://host');
  assert.equal(_test.normalizeBaseUrl('ftp://host'), '');
  assert.equal(_test.resolveHost({ rest_base_url: 'https://rest' }), 'https://rest');
  assert.equal(_test.resolveUsername({ user: { value: ' api_user ' } }), 'api_user');
  assert.equal(_test.resolvePassword({ password: { value: ' pass ' } }), 'pass');
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeoutMs: -1 }, limits: { timeoutMs: 0 } }), 1500);
  assert.deepEqual(_test.mergedBindings({ config: { a: 1 }, secret: { b: 2 }, bindings: { c: 3 } }), { a: 1, b: 2, c: 3 });
  assert.deepEqual(_test.resolveCallContext({ request: { book_name: 'x' } }).req, { book_name: 'x' });
  assert.equal(_test.hasOwn({ a: 1 }, 'a'), true);
  assert.equal(_test.firstDefined(undefined, null, 'x'), 'x');
  assert.equal(_test.unwrapScalar({ value: { value: 'x' } }), 'x');
  assert.equal(_test.trimString({ value: ' x ' }), 'x');
  assert.equal(_test.toBase64('api_user:SuperSecret'), Buffer.from('api_user:SuperSecret').toString('base64'));
  assert.equal(_test.utf8Bytes('A')[0], 65);
  const tlsOptions = await _test.buildTlsOptions({ insecureSkipVerify: true });
  assert.ok(tlsOptions.dispatcher);
  assert.equal(Object.hasOwn(tlsOptions, 'insecureSkipVerify'), false);
  assert.deepEqual(await _test.buildTlsOptions({}), {});
  assert.equal(_test.classifyHttpStatus(403), 'PERMISSION_DENIED');
  assert.equal(_test.classifyHttpStatus(404), 'FAILED_PRECONDITION');
  assert.equal(_test.classifyHttpStatus(502), 'UNAVAILABLE');
  assert.equal(_test.isIPv4('203.0.113.1'), true);
  assert.equal(_test.isIPv4('203.0.113.999'), false);
  assert.equal(_test.isIPv6('2001:db8::1'), true);
  assert.equal(_test.isIPv6('2001:::1'), true);
  assert.equal(_test.isIPv6('2001::gg'), false);
  assert.equal(_test.toInt('2.9'), 2);
  assert.equal(_test.toInt('bad', 7), 7);
  assert.deepEqual(_test.parseJsonSafe('{"a":1}'), { ok: true, value: { a: 1 } });
  assert.deepEqual(_test.parseJsonSafe('bad'), { ok: false, value: null });
  assert.equal(_test.stringifyJson(Symbol('x')), undefined);
  assert.equal(_test.stringifyJson({ a: 1 }), '{"a":1}');
  assert.equal(_test.joinUrl('https://h/', 'a b', 'c/d'), 'https://h/a%20b/c/d');
  assert.equal(_test.toBase64('x'), Buffer.from('x').toString('base64'));
  assert.equal(_test.toBase64('xy'), Buffer.from('xy').toString('base64'));
  assert.deepEqual(_test.toValue(undefined), undefined);
  assert.deepEqual(_test.toValue(null), { nullValue: 'NULL_VALUE' });
  assert.deepEqual(_test.toValue(Number.NaN), { stringValue: 'NaN' });
  assert.deepEqual(_test.toValue(Symbol('x')), { stringValue: 'Symbol(x)' });
  assert.deepEqual(_test.toValue({ a: true }).structValue.fields.a, { boolValue: true });
  assert.equal(_test.toOnlineResponse(200, '{}', { status: 1, msg: 'ok' }).raw_json, undefined);
  assert.equal(_test.toMutationResponse(200, '{}', { affected: 1 }).raw_json, undefined);
  assert.deepEqual(_test.mapMember({ id: '1', iPv4IPv6: '203.0.113.1' }, 200, '{}'), {
    member_id: 1,
    type: 0,
    ip: '203.0.113.1',
    severity: 0,
    trigger_policy: '',
    status: 0,
  });
  assert.throws(() => _test.failWithResponse('UNKNOWN', 'failed', 200, 'raw', null, 'reason'), /"reason":"reason"/);
  assert.throws(() => _test.requireBookName(''), /book_name is required/);
  assert.throws(() => _test.requireIP('bad'), /valid IPv4 or IPv6/);
  assert.throws(() => _test.requireMemberId('1.5'), /positive integer/);

  const circular = {};
  circular.self = circular;
  assert.equal(_test.stringifyJson(circular), '[object Object]');
  const originalJSON = JSON.stringify;
  JSON.stringify = () => {
    throw new Error('forced stringify failure');
  };
  try {
    assert.equal(_test.stringifyJson({ a: 1 }), '[object Object]');
  } finally {
    JSON.stringify = originalJSON;
  }
  const logs = [];
  console.log = (...args) => logs.push(args);
  _test.logFlow({ meta: { instanceId: 'i', requestId: 'r' } }, 'Circular', circular);
  assert.match(String(logs[0][0]), /Fortinet_WAF/);

  globalThis.fetch = async () => {
    throw new Error('controlled helper failure');
  };
  const helperFailure = await parseErrorPayload(() => _test.fetchJSON(buildCtx(), 'https://device.example/fail', { method: 'GET' }));
  assert.equal(helperFailure.payload.reason, 'controlled helper failure');
});
