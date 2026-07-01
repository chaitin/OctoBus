import test from 'node:test';
import assert from 'node:assert/strict';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  ADD_ADDR_GROUP_MEMBER_PATH,
  ATTACH_SUB_GROUP_PATH,
  CREATE_ADDRESS_PATH,
  CREATE_ADDR_GROUP_PATH,
  DELETE_ADDRESS_PATH,
  DELETE_ADDR_GROUP_PATH,
  DETACH_SUB_GROUP_PATH,
  GET_ADDRESS_PATH,
  GET_ADDR_GROUP_PATH,
  METHOD_ADD_ADDR_GROUP_MEMBER_FULL,
  METHOD_ATTACH_SUB_GROUP_FULL,
  METHOD_CREATE_ADDRESS_FULL,
  METHOD_CREATE_ADDR_GROUP_FULL,
  METHOD_DELETE_ADDRESS_FULL,
  METHOD_DELETE_ADDR_GROUP_FULL,
  METHOD_DETACH_SUB_GROUP_FULL,
  METHOD_GET_ADDRESS_FULL,
  METHOD_GET_ADDR_GROUP_FULL,
  METHOD_REMOVE_ADDR_GROUP_MEMBER_FULL,
  REMOVE_ADDR_GROUP_MEMBER_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/fortinet-fw.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;

const buildCtx = (overrides = {}) => ({
  bindings: {
    restBaseUrl: 'https://device.example:8443',
    token: 'fortinet-token',
    is_vdom: true,
    vdom: 'root',
    headers: {},
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

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalConsoleLog;
});

test('CreateAddress validates bindings and request fields', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ bindings: { restBaseUrl: '' }, req: { ip: '203.0.113.10' } }))[CREATE_ADDRESS_PATH](),
    (err) => {
      assert.ok(err instanceof GrpcError);
      assert.equal(err.code, grpcStatus.INVALID_ARGUMENT);
      assert.equal(err.legacyCode, 'INVALID_ARGUMENT');
      assert.match(err.message, /host\/baseUrl is required/);
      return true;
    },
  );

  await assert.rejects(
    () => rpcdef(buildCtx({ bindings: { token: '' }, req: { ip: '203.0.113.10' } }))[CREATE_ADDRESS_PATH](),
    /token is required/,
  );
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { ip: '999.0.0.1' } }))[CREATE_ADDRESS_PATH](),
    /ip must be a valid IPv4 address/,
  );
});

test('CreateAddress appends vdom query and authorization header', async () => {
  let captured;
  const logs = [];
  console.log = (...args) => logs.push(args);
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(JSON.stringify({ status: 'success', http_status: 200, revision: '123', results: [{ name: '203.0.113.10' }] }));
  };

  const result = await rpcdef(buildCtx({ req: { ip: '203.0.113.10' } }))[CREATE_ADDRESS_PATH]();

  assert.equal(captured.url, 'https://device.example:8443/api/v2/cmdb/firewall/address?vdom=root');
  assert.equal(captured.init.method, 'POST');
  assert.equal(Object.hasOwn(captured.init, 'timeoutMs'), false);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.init.headers.Authorization, 'Bearer fortinet-token');
  assert.equal(captured.init.headers['Content-Type'], 'application/json');
  assert.equal(captured.init.headers['x-engine-instance'], 'inst');
  assert.equal(captured.init.headers['x-request-id'], 'req');
  assert.deepEqual(JSON.parse(captured.init.body), { name: '203.0.113.10', subnet: '203.0.113.10/32' });
  assert.equal(result.http_status, 200);
  assert.equal(result.revision, '123');
  assert.equal(result.results.listValue.values[0].structValue.fields.name.stringValue, '203.0.113.10');
  assert.match(JSON.stringify(logs), /CreateAddress/);
});

test('CreateAddress treats error -5 as idempotent success and rejects other business errors', async () => {
  globalThis.fetch = async () => okResponse(JSON.stringify({ status: 'error', http_status: 500, error: -5 }));
  const duplicated = await rpcdef(buildCtx({ req: { ip: '203.0.113.10' } }))[CREATE_ADDRESS_PATH]();
  assert.equal(duplicated.error, -5);

  globalThis.fetch = async () => okResponse(JSON.stringify({ status: 'error', http_status: 400, error: -1 }));
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { ip: '203.0.113.10' } }))[CREATE_ADDRESS_PATH](),
    /create address failed/,
  );
});

test('GetAddress handles success, non-json, and empty responses', async () => {
  globalThis.fetch = async () => okResponse(JSON.stringify({ status: 'success', http_status: 200, results: [{ name: '203.0.113.10' }] }));
  const result = await rpcdef(buildCtx({ req: { ip: '203.0.113.10' } }))[GET_ADDRESS_PATH]();
  assert.equal(result.status, 'success');

  globalThis.fetch = async () => okResponse('not-json');
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { ip: '203.0.113.10' } }))[GET_ADDRESS_PATH](),
    /response is not valid JSON/,
  );

  globalThis.fetch = async () => okResponse('');
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { ip: '203.0.113.10' } }))[GET_ADDRESS_PATH](),
    /response body is empty/,
  );
});

test('DeleteAddress treats error -23 as continue-able response', async () => {
  globalThis.fetch = async () => okResponse(JSON.stringify({ status: 'error', http_status: 500, error: -23 }));
  const referenced = await rpcdef(buildCtx({ req: { ip: '203.0.113.10' } }))[DELETE_ADDRESS_PATH]();
  assert.equal(referenced.error, -23);

  globalThis.fetch = async () => okResponse(JSON.stringify({ status: 'success', http_status: 200 }));
  const deleted = await rpcdef(buildCtx({ req: { ip: '203.0.113.10' } }))[DELETE_ADDRESS_PATH]();
  assert.equal(deleted.http_status, 200);

  globalThis.fetch = async () => okResponse(JSON.stringify({ status: 'error', http_status: 500, error: -1 }));
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { ip: '203.0.113.10' } }))[DELETE_ADDRESS_PATH](),
    /delete address failed/,
  );
});

test('CreateAddrGroup ensures each address exists before creating group', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/firewall/address')) {
      return okResponse(JSON.stringify({ status: 'success', http_status: 200 }));
    }
    return okResponse(JSON.stringify({ status: 'success', http_status: 200, results: [{ name: 'Block_Group_A' }] }));
  };

  const result = await rpcdef(buildCtx({
    req: { groupName: 'Block_Group_A', ips: { values: [{ value: '203.0.113.10' }, '203.0.113.11'] } },
  }))[CREATE_ADDR_GROUP_PATH]();

  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, 'https://device.example:8443/api/v2/cmdb/firewall/address?vdom=root');
  assert.equal(calls[2].url, 'https://device.example:8443/api/v2/cmdb/firewall/addrgrp?vdom=root');
  assert.deepEqual(JSON.parse(calls[2].init.body), {
    name: 'Block_Group_A',
    member: [{ name: '203.0.113.10' }, { name: '203.0.113.11' }],
  });
  assert.equal(result.http_status, 200);
});

test('CreateAddrGroup validates group and ips and surfaces business errors', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { group_name: '', ips: ['203.0.113.10'] } }))[CREATE_ADDR_GROUP_PATH](),
    /group_name is required/,
  );
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { group_name: 'Block_Group_A', ips: [] } }))[CREATE_ADDR_GROUP_PATH](),
    /ips is required/,
  );

  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    return call === 1
      ? okResponse(JSON.stringify({ status: 'success', http_status: 200 }))
      : okResponse(JSON.stringify({ status: 'error', http_status: 500, error: -1 }));
  };
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { group_name: 'Block_Group_A', ips: ['203.0.113.10'] } }))[CREATE_ADDR_GROUP_PATH](),
    /create addr group failed/,
  );
});

test('AddAddrGroupMember ensures address exists first and treats error -5 as success', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) return okResponse(JSON.stringify({ status: 'success', http_status: 200 }));
    return okResponse(JSON.stringify({ status: 'error', http_status: 500, error: -5 }));
  };

  const result = await rpcdef(buildCtx({ req: { groupName: 'Block_Group_A', ip: '203.0.113.12' } }))[ADD_ADDR_GROUP_MEMBER_PATH]();

  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://device.example:8443/api/v2/cmdb/firewall/addrgrp/Block_Group_A/member?vdom=root');
  assert.deepEqual(JSON.parse(calls[1].init.body), { name: '203.0.113.12' });
  assert.equal(result.error, -5);
});

test('AddAddrGroupMember rejects non-idempotent business errors', async () => {
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    return call === 1
      ? okResponse(JSON.stringify({ status: 'success', http_status: 200 }))
      : okResponse(JSON.stringify({ status: 'error', http_status: 500, error: -1 }));
  };

  await assert.rejects(
    () => rpcdef(buildCtx({ req: { group_name: 'Block_Group_A', ip: '203.0.113.12' } }))[ADD_ADDR_GROUP_MEMBER_PATH](),
    /add addr group member failed/,
  );
});

test('RemoveAddrGroupMember treats payload 404 as idempotent success', async () => {
  globalThis.fetch = async () => responseWithStatus(404, JSON.stringify({ status: 'error', http_status: 404 }));
  const missing = await rpcdef(buildCtx({ req: { group_name: 'Block_Group_A', ip: '203.0.113.10' } }))[REMOVE_ADDR_GROUP_MEMBER_PATH]();
  assert.equal(missing.http_status, 404);

  globalThis.fetch = async () => okResponse(JSON.stringify({ status: 'success', http_status: 200 }));
  const removed = await rpcdef(buildCtx({ req: { group_name: 'Block_Group_A', ip: '203.0.113.10' } }))[REMOVE_ADDR_GROUP_MEMBER_PATH]();
  assert.equal(removed.http_status, 200);

  globalThis.fetch = async () => okResponse(JSON.stringify({ status: 'error', http_status: 500, error: -1 }));
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { group_name: 'Block_Group_A', ip: '203.0.113.10' } }))[REMOVE_ADDR_GROUP_MEMBER_PATH](),
    /remove addr group member failed/,
  );
});

test('GetAddrGroup and DeleteAddrGroup preserve successful responses', async () => {
  globalThis.fetch = async (url, init) => {
    if (init.method === 'GET') {
      return okResponse(JSON.stringify({
        status: 'success',
        http_status: 200,
        results: [{ name: 'Block_Group_A', member: [{ name: '203.0.113.10' }] }],
      }));
    }
    return okResponse(JSON.stringify({ status: 'success', http_status: 200, results: [{ name: 'Block_Group_A' }] }));
  };

  const group = await rpcdef(buildCtx({ req: { group_name: 'Block_Group_A' } }))[GET_ADDR_GROUP_PATH]();
  assert.equal(group.results.listValue.values[0].structValue.fields.name.stringValue, 'Block_Group_A');
  const deleted = await rpcdef(buildCtx({ req: { group_name: 'Block_Group_A' } }))[DELETE_ADDR_GROUP_PATH]();
  assert.equal(deleted.http_status, 200);
});

test('AttachSubGroupToPolicyAddrGroup performs get then put with merged members', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'GET') {
      return okResponse(JSON.stringify({
        status: 'success',
        http_status: 200,
        results: [{ name: 'Policy_Block_Group', member: [{ name: 'Block_Group_A' }] }],
      }));
    }
    return okResponse(JSON.stringify({ status: 'success', http_status: 200 }));
  };

  await rpcdef(buildCtx({
    req: { policyBookName: 'Policy_Block_Group', subGroupName: 'Block_Group_B' },
  }))[ATTACH_SUB_GROUP_PATH]();

  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[1].init.method, 'PUT');
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    name: 'Policy_Block_Group',
    member: [{ name: 'Block_Group_A' }, { name: 'Block_Group_B' }],
  });
});

test('DetachSubGroupFromPolicyAddrGroup performs get then put with filtered members', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'GET') {
      return okResponse(JSON.stringify({
        status: 'success',
        http_status: 200,
        results: [{ name: 'Policy_Block_Group', member: [{ name: 'Block_Group_A' }, { name: 'Block_Group_B' }] }],
      }));
    }
    return okResponse(JSON.stringify({ status: 'success', http_status: 200 }));
  };

  await rpcdef(buildCtx({
    req: { policy_book_name: 'Policy_Block_Group', sub_group_name: 'Block_Group_A' },
  }))[DETACH_SUB_GROUP_PATH]();

  assert.deepEqual(JSON.parse(calls[1].init.body), {
    name: 'Policy_Block_Group',
    member: [{ name: 'Block_Group_B' }],
  });
});

test('HTTP and network errors map to gRPC status codes', async () => {
  const cases = [
    [401, grpcStatus.PERMISSION_DENIED, /upstream http 401/],
    [403, grpcStatus.PERMISSION_DENIED, /upstream http 403/],
    [404, grpcStatus.FAILED_PRECONDITION, /upstream http 404/],
    [500, grpcStatus.UNAVAILABLE, /upstream http 500/],
  ];

  for (const [status, code, pattern] of cases) {
    const sensitiveBody = JSON.stringify({ message: 'error', token: 'leaked-fortinet-token' });
    globalThis.fetch = async () => responseWithStatus(status, sensitiveBody);
    await assert.rejects(
      () => rpcdef(buildCtx({ req: { ip: '203.0.113.10' } }))[GET_ADDRESS_PATH](),
      (err) => {
        assert.equal(err.code, code);
        assert.match(err.message, pattern);
        assert.match(err.message, /body_length=/);
        assert.doesNotMatch(err.message, /leaked-fortinet-token/);
        assert.doesNotMatch(err.message, /"token"/);
        return true;
      },
    );
  }

  globalThis.fetch = async () => {
    throw Object.assign(new Error('network error'), { cause: new Error('socket hangup') });
  };
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { ip: '203.0.113.10' } }))[GET_ADDRESS_PATH](),
    /socket hangup/,
  );

  globalThis.fetch = async () => {
    throw new Error('connection refused');
  };
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { ip: '203.0.113.10' } }))[GET_ADDRESS_PATH](),
    /connection refused/,
  );
});

test('SDK handlers merge config and secret and expose all methods', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(JSON.stringify({ status: 'success', http_status: 200 }));
  };

  const res = await handlers[METHOD_CREATE_ADDRESS_FULL]({
    config: {
      endpoint: 'https://config-device.example',
      isVdom: 'false',
      timeout_ms: 3100,
      headers: { 'X-Custom': 'value' },
      skipTlsVerify: true,
    },
    secret: {
      access_token: 'secret-token',
    },
    request: {
      ip: '203.0.113.20',
      subnet: '203.0.113.20/32',
    },
  });

  assert.equal(res.http_status, 200);
  assert.equal(captured.url, 'https://config-device.example/api/v2/cmdb/firewall/address');
  assert.equal(Object.hasOwn(captured.init, 'timeoutMs'), false);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.init.headers.Authorization, 'Bearer secret-token');
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
    METHOD_ADD_ADDR_GROUP_MEMBER_FULL,
    METHOD_ATTACH_SUB_GROUP_FULL,
    METHOD_CREATE_ADDRESS_FULL,
    METHOD_CREATE_ADDR_GROUP_FULL,
    METHOD_DELETE_ADDRESS_FULL,
    METHOD_DELETE_ADDR_GROUP_FULL,
    METHOD_DETACH_SUB_GROUP_FULL,
    METHOD_GET_ADDRESS_FULL,
    METHOD_GET_ADDR_GROUP_FULL,
    METHOD_REMOVE_ADDR_GROUP_MEMBER_FULL,
  ].sort());
});

test('SDK handlers prefer secret token over deprecated config and legacy bindings', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(JSON.stringify({ status: 'success', http_status: 200 }));
  };

  await handlers[METHOD_CREATE_ADDRESS_FULL]({
    bindings: {
      restBaseUrl: 'https://legacy-device.example',
      token: 'legacy-binding-token',
    },
    config: {
      restBaseUrl: 'https://config-device.example',
      token: 'deprecated-config-token',
    },
    secret: {
      token: 'secret-token',
    },
    request: {
      ip: '203.0.113.21',
    },
  });

  assert.equal(captured.url, 'https://config-device.example/api/v2/cmdb/firewall/address');
  assert.equal(captured.init.headers.Authorization, 'Bearer secret-token');
});

test('SDK handlers keep deprecated config token as lower-priority fallback', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(JSON.stringify({ status: 'success', http_status: 200 }));
  };

  await handlers[METHOD_CREATE_ADDRESS_FULL]({
    config: {
      restBaseUrl: 'https://config-device.example',
      token: 'deprecated-config-token',
    },
    request: {
      ip: '203.0.113.22',
    },
  });

  assert.equal(captured.init.headers.Authorization, 'Bearer deprecated-config-token');
});

test('direct handlers cover get, delete, group, and member SDK paths', async () => {
  globalThis.fetch = async (url, init) => {
    if (url.includes('/firewall/address') && init.method === 'POST') {
      return okResponse(JSON.stringify({ status: 'success', http_status: 200 }));
    }
    if (url.includes('/member') && init.method === 'POST') {
      return okResponse(JSON.stringify({ status: 'success', http_status: 200 }));
    }
    if (url.includes('/member/') && init.method === 'DELETE') {
      return okResponse(JSON.stringify({ status: 'success', http_status: 200 }));
    }
    if (url.includes('/addrgrp') && init.method === 'GET') {
      return okResponse(JSON.stringify({
        status: 'success',
        http_status: 200,
        results: [{ name: 'Block_Group_A', member: [{ name: '203.0.113.10' }] }],
      }));
    }
    return okResponse(JSON.stringify({ status: 'success', http_status: 200 }));
  };

  assert.equal((await handlers[METHOD_GET_ADDRESS_FULL](buildCtx({ req: { ip: '203.0.113.10' } }))).http_status, 200);
  assert.equal((await handlers[METHOD_DELETE_ADDRESS_FULL](buildCtx({ req: { ip: '203.0.113.10' } }))).http_status, 200);
  assert.equal((await handlers[METHOD_CREATE_ADDR_GROUP_FULL](buildCtx({ req: { group_name: 'Block_Group_A', ips: ['203.0.113.10'] } }))).http_status, 200);
  assert.equal((await handlers[METHOD_GET_ADDR_GROUP_FULL](buildCtx({ req: { group_name: 'Block_Group_A' } }))).http_status, 200);
  assert.equal((await handlers[METHOD_ADD_ADDR_GROUP_MEMBER_FULL](buildCtx({ req: { group_name: 'Block_Group_A', ip: '203.0.113.10' } }))).http_status, 200);
  assert.equal((await handlers[METHOD_REMOVE_ADDR_GROUP_MEMBER_FULL](buildCtx({ req: { group_name: 'Block_Group_A', ip: '203.0.113.10' } }))).http_status, 200);
  assert.equal((await handlers[METHOD_DELETE_ADDR_GROUP_FULL](buildCtx({ req: { group_name: 'Block_Group_A' } }))).http_status, 200);
  assert.equal((await handlers[METHOD_ATTACH_SUB_GROUP_FULL](buildCtx({ req: { policy_book_name: 'Block_Group_A', sub_group_name: 'Sub_Group_A' } }))).http_status, 200);
  assert.equal((await handlers[METHOD_DETACH_SUB_GROUP_FULL](buildCtx({ req: { policy_book_name: 'Block_Group_A', sub_group_name: '203.0.113.10' } }))).http_status, 200);
});

test('helper functions keep legacy-compatible edge behavior', async () => {
  assert.equal(_test.appendQuery('http://x/path', { a: 1, b: '', c: null }), 'http://x/path?a=1');
  assert.equal(_test.appendQuery('http://x/path?x=1', { a: 'two words' }), 'http://x/path?x=1&a=two%20words');
  const tlsOptions = await _test.buildTlsOptions({ tlsInsecureSkipVerify: true });
  assert.ok(tlsOptions.dispatcher);
  assert.equal(Object.hasOwn(tlsOptions, 'tlsInsecureSkipVerify'), false);
  assert.deepEqual(await _test.buildTlsOptions({}), {});
  const parent = new AbortController();
  let parentSignalSeen = false;
  globalThis.fetch = async (_url, init) => {
    parentSignalSeen = init.signal instanceof AbortSignal;
    return okResponse(JSON.stringify({ status: 'success', http_status: 200 }));
  };
  await _test.fetchWithTimeout('https://device.example/api', { signal: parent.signal }, { timeoutMs: 100 });
  assert.equal(parentSignalSeen, true);
  const aborted = new AbortController();
  aborted.abort('already-aborted');
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.signal.aborted, true);
    return okResponse(JSON.stringify({ status: 'success', http_status: 200 }));
  };
  await _test.fetchWithTimeout('https://device.example/api', { signal: aborted.signal }, { timeoutMs: 100 });
  assert.equal(_test.toBool('yes'), true);
  assert.equal(_test.toBool('off'), false);
  assert.equal(_test.toBool({}), true);
  assert.equal(_test.resolveVdom({ is_vdom: true, vdom: '' }), 'root');
  assert.equal(_test.resolveVdom({ is_vdom: false, vdom: 'root' }), '');
  assert.equal(_test.resolveBaseUrl({ host: 'ftp://bad', base_url: 'https://ok/' }), 'https://ok');
  assert.equal(_test.resolveToken({ accessToken: ' abc ' }), 'abc');
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeoutMs: -1 }, limits: { timeoutMs: 0 } }), 1500);
  assert.equal(_test.hasOwn({ a: 1 }, 'a'), true);
  assert.equal(_test.hasOwn(null, 'a'), false);
  assert.equal(_test.firstDefined(undefined, null, 'x'), 'x');
  assert.deepEqual(_test.mergedBindings({ config: { a: 1 }, secret: { b: 2 }, bindings: { c: 3 } }), { c: 3, a: 1, b: 2 });
  assert.deepEqual(_test.resolveCallContext({ request: { ip: '1.1.1.1' } }).req, { ip: '1.1.1.1' });
  assert.deepEqual(_test.readRepeatedStrings({ values: [{ value: 'a' }, 'b'] }), ['a', 'b']);
  assert.deepEqual(_test.readRepeatedStrings('bad'), []);
  assert.deepEqual(_test.normalizeIps(['203.0.113.1']), [{ name: '203.0.113.1' }]);
  assert.equal(_test.isAlreadyExists({ error: '-5' }), true);
  assert.equal(_test.isStillReferenced({ error: '-23' }), true);
  assert.equal(_test.isIPv4('203.0.113.1'), true);
  assert.equal(_test.isIPv4('203.0.113.999'), false);
  assert.equal(_test.defaultSubnet('203.0.113.1'), '203.0.113.1/32');
  assert.equal(_test.stringifyCell({ a: 1 }), '{"a":1}');
  assert.equal(_test.stringifyJson(Symbol('x')), undefined);
  assert.equal(_test.toInteger('2.9'), 2);
  assert.equal(_test.toInteger('bad', 7), 7);
  assert.deepEqual(_test.toValue(undefined), undefined);
  assert.deepEqual(_test.toValue(null), { nullValue: 'NULL_VALUE' });
  assert.deepEqual(_test.toValue(Number.NaN), { stringValue: 'NaN' });
  assert.deepEqual(_test.toValue(Symbol('x')), { stringValue: 'Symbol(x)' });
  assert.deepEqual(_test.toValue({ a: true }).structValue.fields.a, { boolValue: true });
  assert.deepEqual(_test.extractMembers({ results: [{ member: [{ name: 'a' }, { name: '' }, {}] }] }), [{ name: 'a' }]);
  assert.throws(() => _test.parseJsonBody('bad'), /response is not valid JSON/);
  assert.throws(() => _test.assertSuccess({ status: 'error', http_status: 500 }, 'failed'), /failed/);
  assert.throws(() => _test.throwForHttpStatus(418, 'teapot'), /upstream http 418/);
  assert.throws(() => _test.throwForHttpStatus(503, 'down'), /upstream http 503/);
  globalThis.fetch = async () => {
    throw new Error('controlled helper failure');
  };
  await assert.rejects(
    () => _test.fetchFortinetJson(buildCtx(), 'https://device.example/fail', { method: 'GET' }),
    /controlled helper failure/,
  );
  globalThis.fetch = originalFetch;

  const circular = {};
  circular.self = circular;
  assert.equal(_test.stringifyJson(circular), '[object Object]');

  const logs = [];
  console.log = (...args) => logs.push(args);
  _test.logFlow({ meta: { instanceId: 'i', requestId: 'r' } }, 'Circular', circular);
  assert.match(String(logs[0][0]), /Fortinet_FW/);

  await assert.rejects(
    () => rpcdef(buildCtx({ req: { ip: '' } }))[CREATE_ADDRESS_PATH](),
    /ip is required/,
  );
});
