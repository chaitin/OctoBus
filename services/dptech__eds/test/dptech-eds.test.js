import test from 'node:test';
import assert from 'node:assert/strict';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  DEFAULT_TIMEOUT_MS,
  DPTECH_IPV4_PATH,
  DPTECH_IPV6_PATH,
  FAILURE_CATEGORY,
  IP_FAMILY,
  METHOD_BLOCK,
  METHOD_BLOCK_FULL,
  METHOD_UNBLOCK,
  METHOD_UNBLOCK_FULL,
  OPERATION_KIND,
  TASK_STATUS,
  _test,
  handlers,
  rpcdef,
} from '../src/dptech-eds.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;

const buildCtx = (overrides = {}) => ({
  bindings: {
    host: 'http://localhost:19090',
    user: 'u',
    password: 'p',
    ...(overrides.bindings || {}),
  },
  config: overrides.config || {},
  secret: overrides.secret || {},
  limits: { timeoutMs: 2000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const response = (status, body, headers = { 'content-type': 'application/json' }) => ({
  status,
  headers: {
    get: (key) => headers[key.toLowerCase()],
  },
  text: async () => body,
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalConsoleLog;
});

test('BatchBlockIPs rejects missing host/user/password/groups', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ bindings: { host: '' }, req: { groups: [{ addressGroup: 'g1', ipAddresses: ['1.1.1.1'] }] } }))[METHOD_BLOCK](),
    (err) => {
      assert.ok(err instanceof GrpcError);
      assert.equal(err.code, grpcStatus.INVALID_ARGUMENT);
      assert.equal(err.legacyCode, 'INVALID_ARGUMENT');
      assert.match(err.message, /host\/baseUrl\/restBaseUrl/);
      return true;
    },
  );
  await assert.rejects(
    () => rpcdef(buildCtx({ bindings: { user: '' }, req: { groups: [{ addressGroup: 'g1', ipAddresses: ['1.1.1.1'] }] } }))[METHOD_BLOCK](),
    /INVALID_ARGUMENT: bindings\.user\/username is required/,
  );
  await assert.rejects(
    () => rpcdef(buildCtx({ bindings: { password: '' }, req: { groups: [{ addressGroup: 'g1', ipAddresses: ['1.1.1.1'] }] } }))[METHOD_BLOCK](),
    /INVALID_ARGUMENT: bindings\.password\/pass is required/,
  );
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { groups: [] } }))[METHOD_BLOCK](),
    /INVALID_ARGUMENT: groups is required/,
  );
});

test('BatchBlockIPs validates group shape before network calls', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('should not fetch');
  };

  await assert.rejects(
    () => rpcdef(buildCtx({ req: { groups: [{ ipAddresses: ['1.1.1.1'] }] } }))[METHOD_BLOCK](),
    /groups\[0\]\.address_group is required/,
  );
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { groups: [{ addressGroup: 'g1', ipAddresses: [] }] } }))[METHOD_BLOCK](),
    /groups\[0\]\.ip_addresses must contain at least one IP/,
  );
  assert.equal(called, false);
});

test('BatchBlockIPs sends IPv4 then IPv6 payloads with expected bodies', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return response(200, JSON.stringify({ msg: 'ok', data: { echo: init.body } }));
  };

  const res = await rpcdef(buildCtx({
    bindings: {
      host: 'http://mock.local:18080/',
      user: 'user',
      password: 'pass',
      headers: { 'x-extra': 'demo' },
      skipTlsVerify: true,
    },
    req: {
      request_id: 'req-123',
      groups: [{ addressGroup: 'group-a', ipAddresses: ['1.1.1.1', '2001:db8::1'] }],
    },
  }))[METHOD_BLOCK]();

  assert.equal(res.operation, OPERATION_KIND.BLOCK);
  assert.equal(res.total_ip_count, 2);
  assert.equal(res.success_ip_count, 2);
  assert.equal(res.failure_ip_count, 0);
  assert.equal(res.request_id, 'req-123');
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.endsWith(DPTECH_IPV4_PATH));
  assert.ok(calls[1].url.endsWith(DPTECH_IPV6_PATH));
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Basic dXNlcjpwYXNz');
  assert.equal(calls[0].init.headers['x-extra'], 'demo');
  assert.equal(calls[0].init.headers['x-engine-instance'], 'inst');
  assert.equal(calls[0].init.headers['x-request-id'], 'req');
  assert.equal(Object.hasOwn(calls[0].init, 'skipTlsVerify'), false);
  assert.equal(Object.hasOwn(calls[0].init, 'tlsInsecureSkipVerify'), false);
  assert.equal(Object.hasOwn(calls[0].init, 'insecureSkipVerify'), false);
  assert.ok(calls[0].init.dispatcher);
  assert.equal(JSON.parse(calls[0].init.body).mafcustomv4wblist.GroupStr, 'group-a');
  assert.equal(JSON.parse(calls[0].init.body).mafcustomv4wblist.IPStart, '1.1.1.1');
  assert.equal(JSON.parse(calls[1].init.body).mafcustomv6wblist.IP, '2001:db8::1');
});

test('BatchUnblockIPs handles not-found success and HTTP 500 failure classification', async () => {
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount += 1;
    if (callCount === 1) return response(200, JSON.stringify({ msg: '条目不存在' }));
    return response(500, JSON.stringify({ msg: 'server error' }));
  };

  const res = await rpcdef(buildCtx({
    req: {
      groups: [{ addressGroup: 'group-b', ipAddresses: ['2.2.2.2', '2001:db8::2'] }],
    },
  }))[METHOD_UNBLOCK]();

  assert.equal(res.operation, OPERATION_KIND.UNBLOCK);
  assert.equal(res.total_ip_count, 2);
  assert.equal(res.success_ip_count, 1);
  assert.equal(res.failure_ip_count, 1);
  assert.equal(res.group_stats[0].address_group, 'group-b');
  assert.equal(res.group_stats[0].success_ip_count, 1);
  assert.equal(res.ip_results.find((item) => item.ip === '2.2.2.2').status, TASK_STATUS.SUCCESS);
  const ipv6Result = res.ip_results.find((item) => item.ip === '2001:db8::2');
  assert.equal(ipv6Result.status, TASK_STATUS.FAILED);
  assert.equal(ipv6Result.failure_category, FAILURE_CATEGORY.UPSTREAM_UNAVAILABLE);
  assert.equal(ipv6Result.http_status, 500);
});

test('Invalid IPs are reported without network calls', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('should not fetch');
  };

  const res = await rpcdef(buildCtx({
    req: {
      groups: [{ addressGroup: 'group-c', ipAddresses: ['not-an-ip', ''] }],
    },
  }))[METHOD_BLOCK]();

  assert.equal(res.total_ip_count, 2);
  assert.equal(res.success_ip_count, 0);
  assert.equal(res.failure_ip_count, 2);
  assert.equal(res.ip_results[0].ip_family, IP_FAMILY.UNSPECIFIED);
  assert.equal(res.ip_results[0].failure_category, FAILURE_CATEGORY.INVALID_IP);
  assert.equal(res.ip_results[1].ip, '');
  assert.equal(called, false);
});

test('Downstream response categories are reflected per IP', async () => {
  const bodies = [
    response(401, JSON.stringify({ error: 'unauthorized' })),
    response(400, JSON.stringify({ error: 'bad request' })),
    response(200, ''),
    response(200, 'plain', { 'content-type': 'text/plain' }),
    response(200, 'null'),
    response(200, JSON.stringify({ error: null })),
    response(200, JSON.stringify({ message: 'ok-message' })),
  ];
  globalThis.fetch = async () => bodies.shift();

  const res = await rpcdef(buildCtx({
    req: {
      groups: [{
        addressGroup: 'group-d',
        ipAddresses: ['1.1.1.1', '1.1.1.2', '1.1.1.3', '1.1.1.4', '1.1.1.5', '1.1.1.6', '1.1.1.7'],
      }],
    },
  }))[METHOD_BLOCK]();

  assert.equal(res.failure_ip_count, 6);
  assert.equal(res.success_ip_count, 1);
  assert.deepEqual(res.ip_results.map((item) => item.failure_category), [
    FAILURE_CATEGORY.UNAUTHORIZED,
    FAILURE_CATEGORY.DEVICE_REJECTED,
    FAILURE_CATEGORY.RESPONSE_REJECTED,
    FAILURE_CATEGORY.RESPONSE_REJECTED,
    FAILURE_CATEGORY.RESPONSE_REJECTED,
    FAILURE_CATEGORY.DEVICE_REJECTED,
    FAILURE_CATEGORY.NONE,
  ]);
  assert.equal(res.ip_results[5].failure_reason, 'device error');
  assert.equal(res.ip_results[6].failure_reason, '');
});

test('Network failures are categorized as upstream unavailable', async () => {
  globalThis.fetch = async () => {
    throw new Error('network down');
  };

  const res = await rpcdef(buildCtx({
    req: {
      groups: [{ addressGroup: 'group-e', ipAddresses: ['1.1.1.1'] }],
    },
  }))[METHOD_BLOCK]();

  assert.equal(res.ip_results[0].status, TASK_STATUS.FAILED);
  assert.equal(res.ip_results[0].failure_category, FAILURE_CATEGORY.UPSTREAM_UNAVAILABLE);
  assert.equal(res.ip_results[0].failure_reason, 'network down');
});

test('fetchDptech covers response header and default fallback branches', async () => {
  const logs = [];
  const config = {
    baseUrl: 'https://eds.example',
    authHeader: 'Basic token',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    skipTlsVerify: false,
    extraHeaders: null,
    meta: { instanceId: 'inst-camel', requestId: 'req-camel' },
    requestId: '',
  };
  const request = {
    operation: OPERATION_KIND.BLOCK,
    path: DPTECH_IPV4_PATH,
    method: 'POST',
    body: null,
    ip: '1.1.1.1',
    addressGroup: 'g',
  };

  globalThis.fetch = async (url, init) => {
    assert.equal(url, `https://eds.example${DPTECH_IPV4_PATH}`);
    assert.equal(init.body, undefined);
    assert.equal(init.headers['x-engine-instance'], 'inst-camel');
    assert.equal(init.headers['x-request-id'], 'req-camel');
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      text: async () => JSON.stringify({ Message: 'capital-message' }),
    };
  };

  const outcome = await _test.fetchDptech(config, request, (phase, details) => logs.push({ phase, details }));
  assert.equal(outcome.success, true);
  assert.equal(outcome.message, 'capital-message');
  assert.equal(outcome.requestBody, undefined);
  assert.equal(logs[0].phase, 'request');
});

test('SDK handlers use config and secret fields', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return response(200, JSON.stringify({ msg: 'ok' }));
  };

  const res = await handlers[METHOD_BLOCK_FULL]({
    config: {
      endpoint: 'https://eds.example/',
      username: 'api-user',
      timeout_ms: 0,
      tlsInsecureSkipVerify: true,
    },
    secret: {
      password: 'api-pass',
    },
    request: {
      requestId: 'sdk-req',
      Groups: {
        values: [{
          groupName: { value: 'sdk-group' },
          ipAddresses: { values: [{ value: '1.1.1.1' }] },
        }],
      },
    },
  });

  assert.equal(res.success_ip_count, 1);
  assert.equal(captured.url, `https://eds.example${DPTECH_IPV4_PATH}`);
  assert.equal(captured.init.headers.Authorization, 'Basic YXBpLXVzZXI6YXBpLXBhc3M=');
  assert.equal(Object.hasOwn(captured.init, 'timeoutMs'), false);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(Object.hasOwn(captured.init, 'skipTlsVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'tlsInsecureSkipVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'insecureSkipVerify'), false);
  assert.ok(captured.init.dispatcher);

  globalThis.fetch = async () => response(200, JSON.stringify({ msg: 'not exist' }));
  const unblock = await handlers[METHOD_UNBLOCK_FULL]({
    config: { base_url: 'https://eds.example', account: 'api-user' },
    secret: { pass: 'api-pass' },
    req: {
      groups: [{ address_group: 'sdk-group', ip_addresses: ['1.1.1.1'] }],
    },
  });
  assert.equal(unblock.success_ip_count, 1);

  await assert.rejects(() => handlers[METHOD_BLOCK_FULL](), /host\/baseUrl\/restBaseUrl is required/);
});

test('service wrapper exposes SDK handlers', () => {
  assert.deepEqual(Object.keys(service.handlers), [METHOD_BLOCK_FULL, METHOD_UNBLOCK_FULL]);
  assert.equal(service.handlers[METHOD_BLOCK_FULL], handlers[METHOD_BLOCK_FULL]);
});

test('helper utilities cover parsing and formatting branches', () => {
  const logs = [];
  console.log = (...args) => logs.push(args);
  const circular = {};
  circular.self = circular;
  _test.createLogger({ instanceId: 'inst-camel', requestId: 'req-camel' })('phase', circular);
  assert.equal(logs[0][0], '[DPtech_EDS phase inst=inst-camel req=req-camel]');
  assert.equal(logs[0][1], circular);

  assert.equal(_test.detectIpVersion('1.1.1.1'), 4);
  assert.equal(_test.detectIpVersion('2001:db8::1'), 6);
  assert.equal(_test.detectIpVersion(''), 0);
  assert.equal(_test.detectIpVersion('bad'), 0);
  assert.equal(_test.normalizeBaseUrl('ftp://bad'), '');
  assert.equal(_test.normalizeBaseUrl(''), '');
  assert.equal(_test.normalizeBaseUrl('https://example/'), 'https://example');
  assert.equal(_test.normalizeTimeoutMs(1200), 1200);
  assert.equal(_test.normalizeTimeoutMs('bad'), DEFAULT_TIMEOUT_MS);
  assert.deepEqual(_test.readRepeatedStrings(null), []);
  assert.deepEqual(_test.readRepeatedStrings(['a', { value: 'b' }]), ['a', 'b']);
  assert.deepEqual(_test.readRepeatedStrings({ values: [{ value: 'a' }, 'b'] }), ['a', 'b']);
  assert.deepEqual(_test.readRepeatedStrings('bad'), []);
  assert.deepEqual(_test.readRepeatedMessages(null), []);
  assert.deepEqual(_test.readRepeatedMessages([{ a: 1 }]), [{ a: 1 }]);
  assert.deepEqual(_test.readRepeatedMessages({ values: [{ a: 1 }] }), [{ a: 1 }]);
  assert.deepEqual(_test.readRepeatedMessages('bad'), []);
  assert.equal(_test.pickStringField({ a: { value: ' x ' } }, ['a']), 'x');
  assert.equal(_test.pickStringField({ a: null }, ['a']), '');
  assert.equal(_test.pickStringField({}, ['missing']), '');
  assert.equal(_test.resolveBindingString({ a: { value: ' x ' } }, ['a']), 'x');
  assert.equal(_test.resolveBindingString({ a: null, b: '' }, ['a', 'b']), '');
  assert.equal(_test.coerceString(null), '');
  assert.equal(_test.coerceString({ value: null }), '');
  assert.deepEqual(_test.classifyIpList(['2.2.2.2', 'bad', '1.1.1.1']).ipv4.map((item) => item.ip), ['2.2.2.2', '1.1.1.1']);
  assert.deepEqual(_test.buildIpv4BlockBody('g', '1.1.1.1').mafcustomv4wblist.GroupStr, 'g');
  assert.deepEqual(_test.buildIpv6BlockBody('g', '2001:db8::1').mafcustomv6wblist.IP, '2001:db8::1');
  assert.deepEqual(_test.buildIpv4DeleteBody('1.1.1.1'), { mafcustomv4wblist: { IPaddr: '1.1.1.1' } });
  assert.deepEqual(_test.buildIpv6DeleteBody('2001:db8::1'), { mafcustomv6wblist: { IP: '2001:db8::1' } });
  assert.equal(_test.isNotFoundMessage('条目不存在'), true);
  assert.equal(_test.isNotFoundMessage('not found'), true);
  assert.equal(_test.isNotFoundMessage(''), false);
  assert.equal(_test.isNotFoundMessage('exists'), false);
  assert.equal(_test.toBase64(_test.encodeUtf8('u:p')), 'dTpw');
  assert.equal(_test.toBase64(_test.encodeUtf8('a')), 'YQ==');
  assert.equal(_test.toBase64(_test.encodeUtf8('ab')), 'YWI=');
  assert.deepEqual(Array.from(_test.encodeUtf8('A', { forceFallback: true })), [65]);
  assert.deepEqual(Array.from(_test.encodeUtf8('é', { forceFallback: true })), [195, 169]);
  assert.deepEqual(Array.from(_test.encodeUtf8('中', { forceFallback: true })), [228, 184, 173]);
  assert.deepEqual(Array.from(_test.encodeUtf8(null, { forceFallback: true })), []);
  assert.deepEqual(_test.summarizeGroups([
    { address_group: '', status: TASK_STATUS.SUCCESS },
    { address_group: '', status: TASK_STATUS.FAILED },
  ])[0], {
    address_group: '<unknown>',
    total_ip_count: 2,
    success_ip_count: 1,
    failure_ip_count: 1,
  });
  assert.equal(_test.errorWithCode('OTHER', 'fallback').code, grpcStatus.UNKNOWN);
  assert.throws(() => _test.parseGroups({ groups: [{ address_group: 'g' }] }), /ip_addresses/);
  assert.deepEqual(_test.parseGroups({
    Groups: {
      values: [{
        group_name: { value: 'g' },
        ip_addresses: { values: [{ value: '1.1.1.1' }] },
      }],
    },
  }), [{ name: 'g', ips: ['1.1.1.1'] }]);
  assert.equal(_test.buildConfig({
    config: {
      rest_base_url: 'https://config.example/',
      account: 'account-user',
      timeoutMs: 2500,
    },
    secret: {
      secret: 'account-pass',
    },
    meta: {},
    limits: {},
  }, { request_id: 'r' }, OPERATION_KIND.BLOCK).baseUrl, 'https://config.example');
  const config = _test.buildConfig({
    config: {
      url: 'https://url.example/',
      user: 'user',
    },
    secret: {
      password: 'pass',
    },
    limits: { timeoutMs: 2300 },
  }, { requestId: 'camel-r' }, OPERATION_KIND.UNBLOCK);
  assert.equal(config.baseUrl, 'https://url.example');
  assert.equal(config.timeoutMs, 2300);
  assert.equal(config.requestId, 'camel-r');
  assert.equal(_test.buildResult({
    addressGroup: 'g',
    ip: '1.1.1.1',
    family: IP_FAMILY.IPV4,
    outcome: { success: false, message: '', httpStatus: 0 },
  }).failure_category, FAILURE_CATEGORY.DEVICE_REJECTED);
});
