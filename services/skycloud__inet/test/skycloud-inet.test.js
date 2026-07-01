import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_BATCH_BLOCK_FULL,
  METHOD_BATCH_BLOCK_PATH,
  METHOD_BATCH_UNBLOCK_FULL,
  METHOD_BATCH_UNBLOCK_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/skycloud-inet.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;
const originalConsoleLog = console.log;

const buildCtx = (overrides = {}) => ({
  bindings: {
    host: 'https://inet.example.com',
    defaultDirection: 'BOTH',
    headers: { 'x-flow': 'skycloud' },
    ...(overrides.bindings || {}),
  },
  config: overrides.config || {},
  secret: {
    username: 'user',
    password: 'secret',
    ...(overrides.secret || {}),
  },
  limits: { timeoutMs: 5000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const callHandler = (method, request = {}, ctx = {}) => {
  const handler = handlers[method];
  return handler({ ...ctx, request });
};

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const setFetch = (impl) => {
  globalThis.fetch = impl;
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
    UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
    UNKNOWN: grpcStatus.UNKNOWN,
  })[legacyCode]);
  assert.match(caught.message, new RegExp(`^${legacyCode}:`));
  checker(caught);
};

test.beforeEach(() => {
  Date.now = () => 1705392000000;
  console.log = () => {};
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;
  console.log = originalConsoleLog;
});

test('service exports handlers and rpcdef paths', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers[METHOD_BATCH_BLOCK_FULL], 'function');
  assert.equal(typeof handlers[METHOD_BATCH_UNBLOCK_FULL], 'function');
  const defs = rpcdef(buildCtx({ req: { environment_name: 'prod', ip_directives: ['203.0.113.1'] } }));
  assert.equal(typeof defs[METHOD_BATCH_BLOCK_PATH], 'function');
  assert.equal(typeof defs[METHOD_BATCH_UNBLOCK_PATH], 'function');
});

test('rejects missing required connection and request fields', async () => {
  await expectGrpcError(
    () => callHandler(METHOD_BATCH_BLOCK_FULL, { environment_name: '', ip_directives: ['203.0.113.1'] }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /environment_name/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_BATCH_BLOCK_FULL, { environment_name: 'prod', ip_directives: ['203.0.113.1'] }, buildCtx({ bindings: { host: '', restBaseUrl: '', baseUrl: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /https URL/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_BATCH_BLOCK_FULL, { environment_name: 'prod', ip_directives: ['203.0.113.1'] }, buildCtx({ secret: { username: '', user: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /username/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_BATCH_BLOCK_FULL, { environment_name: 'prod', ip_directives: ['203.0.113.1'] }, buildCtx({ secret: { password: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /password/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_BATCH_BLOCK_FULL, { environment_name: 'prod', ip_directives: [] }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /ip_directives/),
  );
});

test('invalid IPs short-circuit without network calls', async () => {
  setFetch(async () => {
    throw new Error('should not fetch');
  });
  const result = await callHandler(METHOD_BATCH_BLOCK_FULL,
    { environment_name: 'prod', ip_directives: ['bad-ip', { description: 'missing ip' }, { ip: '999.0.0.1' }, 42] },
    buildCtx(),
  );
  assert.equal(result.results.length, 4);
  assert.equal(result.work_orders.length, 0);
  assert.equal(result.results[0].success, false);
  assert.match(result.results[0].error_message, /IPv4 or IPv6/);
  assert.equal(result.results[1].error_message, 'ip is required');
  assert.equal(result.results[3].error_message, 'ip is required');
});

test('batches block requests and annotates work orders', async () => {
  const ips = Array.from({ length: 350 }, (_, idx) => ({ ip: `203.0.113.${idx % 255}`, description: `ip-${idx}` }));
  const calls = [];
  setFetch(async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    if (calls.length === 1) return response(200, { code: 200, data: { access_token: 'token-1' } });
    if (calls.length === 2) return response(200, { code: 200, data: { items: [{ id: 'env-1', name: 'prod' }] } });
    return response(200, { code: 200, data: { id: calls.length === 3 ? 'wo-1' : 'wo-2' } });
  });

  const result = await callHandler(METHOD_BATCH_BLOCK_FULL,
    {
      environmentName: 'prod',
      ipDirectives: { values: ips },
      ticketTemplate: { ipDescriptionPrefix: 'auto' },
      context: { workflowName: 'soc', operator: 'soar' },
    },
    buildCtx({ bindings: { skipTlsVerify: true } }),
  );

  assert.equal(calls.length, 4);
  assert.equal(calls[0].url, 'https://inet.example.com/api/sky-platform/auth/user/login');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal('timeoutMs' in calls[0].init, false);
  assert.ok(calls[0].init.dispatcher);
  assert.equal('skipTlsVerify' in calls[0].init, false);
  assert.equal(calls[0].init.headers['x-engine-instance'], 'inst');
  assert.equal(calls[0].init.headers['x-flow'], 'skycloud');
  assert.equal(calls[2].body.type, 'BLOCKER');
  assert.equal(calls[2].body.ipValues.length, 300);
  assert.equal(calls[2].body.ipValues[0].description, 'auto ip-0');
  assert.equal(calls[3].body.ipValues.length, 50);
  assert.equal(result.work_orders.length, 2);
  assert.equal(result.work_orders[0].work_order_id, 'wo-1');
  assert.equal(result.work_orders[0].ip_count, 300);
  assert.equal(result.results[0].work_order_ids[0], 'wo-1');
  assert.equal(result.results[349].work_order_ids[0], 'wo-2');
  assert.equal(result.results[349].batch_token, 'batch-1');
});

test('unblock RPC uses UN_BLOCKER type and ignores request connection credentials', async () => {
  const calls = [];
  setFetch(async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    if (calls.length === 1) return response(200, { code: 200, data: { token: 'token-1' } });
    if (calls.length === 2) return response(200, { code: 200, data: { list: [{ environmentId: 'env-1', name: 'prod' }] } });
    return response(200, { code: 200, data: 'wo-9' });
  });

  const result = await rpcdef(buildCtx({ bindings: { host: 'https://configured.example.com' }, secret: { username: 'secret-user', password: 'secret-password' } }))[METHOD_BATCH_UNBLOCK_PATH]({
    environment_name: 'prod',
    ip_directives: [{ ip: '2001:db8::1', remark: 'ipv6' }],
    connection: { host: 'https://override.example.com/', username: 'request-user', password: 'request-password' },
    ticket_template: { name: 'Manual unblock', description: 'restore', direction: 'EGRESS' },
  });

  assert.equal(calls[0].url, 'https://configured.example.com/api/sky-platform/auth/user/login');
  assert.deepEqual(calls[0].body, { username: 'secret-user', password: 'secret-password' });
  assert.equal(calls[2].body.type, 'UN_BLOCKER');
  assert.equal(calls[2].body.direction, 'EGRESS');
  assert.equal(calls[2].body.name, 'Manual unblock');
  assert.equal(result.work_orders[0].type, 'UN_BLOCKER');
  assert.equal(result.work_orders[0].work_order_id, 'wo-9');
});

test('transport protocol business and network errors map correctly', async () => {
  for (const [status, legacyCode] of [[401, 'UNAUTHENTICATED'], [403, 'PERMISSION_DENIED'], [404, 'FAILED_PRECONDITION'], [500, 'UNAVAILABLE']]) {
    setFetch(async () => response(status, { code: status, message: 'bad'.repeat(100) }));
    await expectGrpcError(
      () => callHandler(METHOD_BATCH_BLOCK_FULL, { environment_name: 'prod', ip_directives: ['203.0.113.1'] }, buildCtx()),
      legacyCode,
      (err) => assert.match(err.message, new RegExp(`login.*${status}`)),
    );
  }

  setFetch(async () => response(200, ''));
  await expectGrpcError(() => callHandler(METHOD_BATCH_BLOCK_FULL, { environment_name: 'prod', ip_directives: ['203.0.113.1'] }, buildCtx()), 'UNKNOWN', (err) => {
    assert.match(err.message, /empty/);
  });

  setFetch(async () => response(200, 'not-json'));
  await expectGrpcError(() => callHandler(METHOD_BATCH_BLOCK_FULL, { environment_name: 'prod', ip_directives: ['203.0.113.1'] }, buildCtx()), 'UNKNOWN', (err) => {
    assert.match(err.message, /not valid JSON/);
  });

  setFetch(async () => response(200, { code: 401, data: null, message: 'denied' }));
  await expectGrpcError(() => callHandler(METHOD_BATCH_BLOCK_FULL, { environment_name: 'prod', ip_directives: ['203.0.113.1'] }, buildCtx()), 'FAILED_PRECONDITION', (err) => {
    assert.match(err.message, /login failed: denied/);
  });

  setFetch(async () => response(200, { code: 200, data: { value: '' } }));
  await expectGrpcError(() => callHandler(METHOD_BATCH_BLOCK_FULL, { environment_name: 'prod', ip_directives: ['203.0.113.1'] }, buildCtx()), 'UNAUTHENTICATED', (err) => {
    assert.match(err.message, /access token missing/);
  });

  setFetch(async () => {
    throw new Error('');
  });
  await expectGrpcError(() => callHandler(METHOD_BATCH_BLOCK_FULL, { environment_name: 'prod', ip_directives: ['203.0.113.1'] }, buildCtx()), 'UNAVAILABLE', (err) => {
    assert.match(err.message, /fetch failed/);
  });
});

test('environment and work order protocol errors map correctly', async () => {
  setFetch(async (url) => {
    if (String(url).includes('/auth/')) return response(200, { code: 200, data: { accessTokenValue: 'token-1' } });
    return response(200, { code: 200, data: [] });
  });
  await expectGrpcError(() => callHandler(METHOD_BATCH_BLOCK_FULL, { environment_name: 'prod', ip_directives: ['203.0.113.1'] }, buildCtx()), 'FAILED_PRECONDITION', (err) => {
    assert.match(err.message, /environment prod not found/);
  });

  setFetch(async (url) => {
    if (String(url).includes('/auth/')) return response(200, { code: 200, data: { access_token: 'token-1' } });
    if (String(url).includes('/environment/')) return response(200, { code: 200, data: [{ name: 'prod' }] });
    return response(200, { code: 200, data: { id: 'wo-1' } });
  });
  await expectGrpcError(() => callHandler(METHOD_BATCH_BLOCK_FULL, { environment_name: 'prod', ip_directives: ['203.0.113.1'] }, buildCtx()), 'FAILED_PRECONDITION', (err) => {
    assert.match(err.message, /missing id/);
  });

  setFetch(async (url) => {
    if (String(url).includes('/auth/')) return response(200, { code: 200, data: { access_token: 'token-1' } });
    if (String(url).includes('/environment/')) return response(200, { code: 200, data: [{ id: 'env-1', name: 'prod' }] });
    return response(200, { code: 500, data: null, message: 'forced work order failure' });
  });
  await expectGrpcError(() => callHandler(METHOD_BATCH_BLOCK_FULL, { environment_name: 'prod', ip_directives: ['203.0.113.1'] }, buildCtx()), 'FAILED_PRECONDITION', (err) => {
    assert.match(err.message, /work order failed/);
  });

  setFetch(async (url) => {
    if (String(url).includes('/auth/')) return response(200, { code: 200, data: { access_token: 'token-1' } });
    if (String(url).includes('/environment/')) return response(200, { code: 200, data: [{ id: 'env-1', name: 'prod' }] });
    return response(200, { code: 200, data: {} });
  });
  await expectGrpcError(() => callHandler(METHOD_BATCH_BLOCK_FULL, { environment_name: 'prod', ip_directives: ['203.0.113.1'] }, buildCtx()), 'FAILED_PRECONDITION', (err) => {
    assert.match(err.message, /missing id/);
  });
});

test('helper functions cover parsing normalization and defaults', () => {
  assert.equal(_test.errorWithCode('NOT_A_CODE', 'bad').code, grpcStatus.UNKNOWN);
  assert.equal(_test.hasOwn(null, 'x'), false);
  assert.equal(_test.firstDefined(undefined, null, '', 'ok'), 'ok');
  assert.equal(_test.firstDefined(undefined, null, ''), undefined);
  assert.equal(_test.unwrapString({ value: { value: ' nested ' } }), 'nested');
  assert.equal(_test.unwrapString(undefined), '');
  assert.deepEqual(_test.unwrapList(['a']), ['a']);
  assert.deepEqual(_test.unwrapList({ list: ['a'] }), ['a']);
  assert.deepEqual(_test.unwrapList({ items: ['a'] }), ['a']);
  assert.deepEqual(_test.unwrapList('bad'), []);
  assert.equal(_test.toBoolean(true), true);
  assert.equal(_test.toBoolean(1), true);
  assert.equal(_test.toBoolean(0), false);
  assert.equal(_test.toBoolean('yes'), true);
  assert.equal(_test.toBoolean('off'), false);
  assert.equal(_test.toBoolean('maybe'), false);
  assert.equal(_test.normalizeBaseUrl('https://host///'), 'https://host');
  assert.equal(_test.normalizeBaseUrl('http://host', true), 'http://host');
  assert.equal(_test.normalizeBaseUrl('http://host'), '');
  assert.equal(_test.optionalUint32({ value: '10.9' }), 10);
  assert.equal(_test.optionalUint32('0'), undefined);
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: -1 }, bindings: { timeoutMs: '25' } }), 25);
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: '11' }, bindings: { timeoutMs: '25' } }), 11);
  assert.ok(_test.buildTlsOptions({ insecureSkipVerify: 'on' }).dispatcher);
  assert.deepEqual(_test.buildTlsOptions({}), {});
  assert.equal(_test.isIPv4('203.0.113.1'), true);
  assert.equal(_test.isIPv4('203.0.113.999'), false);
  assert.equal(_test.isIPv6('2001:db8::1'), true);
  assert.equal(_test.isIPv6('not-ip'), false);
  assert.equal(_test.isIpAddress('2001:db8::1'), true);
  assert.equal(_test.buildDefaultTicketName('BLOCKER', 'prod', 'soc', 1), 'SKYCloud iNet Block prod [soc]#2');
  assert.equal(_test.buildDefaultTicketName('UN_BLOCKER', 'prod', '', undefined), 'SKYCloud iNet Unblock prod');
  assert.equal(_test.buildDefaultTicketDescription('BLOCKER', 'prod', 2, { workflow_name: 'soc', operator: 'soar' }), 'Block 2 IPs under environment prod workflow=soc operator=soar');
  assert.equal(_test.resolveDirection({ req: {}, bindings: {} }), 'BOTH');
  assert.equal(_test.resolveDirection({ req: { ticket_template: { direction: 'INGRESS' } }, bindings: { defaultDirection: 'BOTH' } }), 'INGRESS');
  assert.deepEqual(_test.buildIpValues([{ ip: '1.1.1.1', description: '' }], {}), [{ ip: '1.1.1.1' }]);
  assert.deepEqual(_test.chunkEntries([1, 2, 3], 2), [[1, 2], [3]]);
  assert.equal(_test.extractWorkOrderId(0), '0');
  assert.equal(_test.extractWorkOrderId(false), '');
  assert.equal(_test.extractWorkOrderId({ ticketId: { value: 'ticket-1' } }), 'ticket-1');
  assert.equal(_test.extractWorkOrderId(null), '');
  assert.equal(_test.extractWorkOrderId(Symbol('bad')), '');
  assert.throws(() => _test.ensureBusinessSuccess('stage', { code: 200, data: '' }), /returned empty data/);
  assert.throws(() => _test.ensureBusinessSuccess('stage', { code: 'x', message: '' }), /unexpected response/);
  assert.equal(_test.mapHttpError('stage', 302, 'redirect').legacyCode, 'UNAVAILABLE');
  assert.equal(_test.mapHttpError('stage', 400, 'bad').legacyCode, 'FAILED_PRECONDITION');
  assert.equal(_test.parseJsonOrThrow('{"ok":true}').ok, true);
  assert.throws(() => _test.parseJsonOrThrow('bad'), /not valid JSON/);
});

test('resolve context merges config secret and bindings with request alias', () => {
  const ctx = _test.resolveCallContext({
    config: { host: 'https://config.example.com', defaultDirection: 'INGRESS' },
    secret: { username: 'secret-user', password: 'secret-password' },
    bindings: { username: 'binding-user' },
    request: { environment_name: 'prod' },
  });
  assert.deepEqual(ctx.bindings, {
    host: 'https://config.example.com',
    defaultDirection: 'INGRESS',
    username: 'secret-user',
    password: 'secret-password',
  });
  assert.deepEqual(ctx.req, { environment_name: 'prod' });
});

test('helper functions cover alias branches and direct upstream helpers', async () => {
  assert.equal(_test.normalizeBaseUrl(''), '');
  assert.equal(_test.toBoolean({ value: 'true' }), true);
  assert.equal(_test.toBoolean(Number.NaN), false);
  assert.equal(_test.optionalUint32('bad'), undefined);
  assert.deepEqual(_test.buildHeaders({ bindings: null, meta: { instanceId: 'inst2', requestId: 'req2' } }, { accept: 'application/json' }), {
    'x-engine-instance': 'inst2',
    'x-request-id': 'req2',
    accept: 'application/json',
  });
  assert.throws(() => _test.requireHost({ req: { base_url: 'https://req.example.com/' }, bindings: {} }), /host\/restBaseUrl/);
  assert.throws(() => _test.requireHost({ req: { baseUrl: 'http://req.example.com' }, bindings: { allowHttpHost: true } }), /host\/restBaseUrl/);
  assert.equal(_test.requireHost({ req: {}, bindings: { baseUrl: 'http://binding.example.com', allowHttpUrl: true } }), 'http://binding.example.com');
  assert.throws(() => _test.requireUsername({ req: { user: 'request-user' }, bindings: {} }), /username/);
  assert.equal(_test.requireUsername({ req: {}, bindings: { user: 'binding-user' } }), 'binding-user');
  assert.equal(_test.requirePassword({ req: { connection: { password: 'request-password' } }, bindings: { password: 'binding-password' } }), 'binding-password');
  assert.equal(_test.requireEnvironmentName({ req: { environmentName: 'camel-prod' } }), 'camel-prod');

  const normalized = _test.normalizeIpDirectives({
    req: {
      ipDirectives: {
        items: [
          { value: '203.0.113.9', note: 'note-alias' },
          { address: '2001:db8::9', remark: 'remark-alias' },
        ],
      },
    },
  });
  assert.equal(normalized.validEntries.length, 2);
  assert.equal(normalized.validEntries[0].description, 'note-alias');
  assert.equal(normalized.validEntries[1].description, 'remark-alias');

  const directCalls = [];
  setFetch(async (url, init) => {
    directCalls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return response(200, { code: 200, data: { ok: true } });
  });
  const post = await _test.httpPostJson(
    { bindings: { headers: { 'x-extra': '1' } }, meta: {} },
    'https://inet.example.com/custom',
    undefined,
    { headers: { accept: 'application/json' } },
  );
  assert.equal(post.json.data.ok, true);
  assert.deepEqual(directCalls[0].body, {});
  assert.equal(directCalls[0].init.headers['x-extra'], '1');
  assert.equal(directCalls[0].init.headers.accept, 'application/json');

  let loginAlias = 0;
  setFetch(async () => {
    loginAlias += 1;
    return response(200, { code: 200, data: loginAlias === 1 ? { accessToken: 'token-a' } : { value: 'token-b' } });
  });
  assert.equal(await _test.loginSkyCloud(buildCtx(), 'https://inet.example.com', 'u', 'p'), 'token-a');
  assert.equal(await _test.loginSkyCloud(buildCtx(), 'https://inet.example.com', 'u', 'p'), 'token-b');

  setFetch(async () => response(200, { code: 200, data: { items: [{ uuid: 'env-uuid', name: 'prod' }] } }));
  assert.equal((await _test.resolveEnvironmentId(buildCtx(), 'https://inet.example.com', 'token', 'prod')).id, 'env-uuid');
  setFetch(async () => response(200, { code: 200, data: { list: [{ id: 'env-list', name: 'prod' }] } }));
  assert.equal((await _test.resolveEnvironmentId(buildCtx(), 'https://inet.example.com', 'token', 'prod')).id, 'env-list');

  setFetch(async () => response(200, { code: 200, data: { workOrderId: 'wo-alias' } }));
  const order = await _test.createWorkOrder(
    { ...buildCtx(), req: { environmentName: 'prod', context: { workflowName: 'wf' }, ticketTemplate: {} } },
    'https://inet.example.com',
    'token',
    'env-1',
    [{ ip: '203.0.113.9', description: '' }],
    0,
    'BLOCKER',
  );
  assert.equal(order.workOrderId, 'wo-alias');
  assert.match(order.payload.description, /workflow=wf/);
});

test('rpcdef falls back to context request when call request is omitted', async () => {
  const server = await createMockServer();
  try {
    const handler = rpcdef(buildCtx({
      bindings: {
        host: server.url,
        allowHttpBaseUrl: true,
      },
      secret: { username: 'user', password: 'secret' },
      req: { environment_name: 'prod', ip_directives: [{ ip: '192.0.2.11' }] },
    }))[METHOD_BATCH_BLOCK_PATH];

    const result = await handler();
    assert.equal(result.results[0].success, true);
    assert.equal(server.requests[2].body.ipValues[0].ip, '192.0.2.11');
  } finally {
    await server.close();
  }
});

test('log collector falls back when JSON stringify fails', () => {
  const calls = [];
  console.log = (...args) => calls.push(args);
  const collector = _test.createLogCollector({ meta: { instanceId: 'inst', requestId: 'req' } }, 'BLOCKER', 'prod');
  const circularWorkOrder = {};
  circularWorkOrder.self = circularWorkOrder;
  collector.emit({
    totalIps: 1,
    validIps: 1,
    invalidIps: 0,
    workOrders: [circularWorkOrder],
    durationMs: 1,
    error: null,
  });
  assert.equal(calls[0][0], '[SKYCloud_INET]');
  assert.equal(calls[0][1].service, 'SKYCloud_INET');
});

test('mock upstream handles full lifecycle', async () => {
  const server = await createMockServer();
  try {
    const ctx = buildCtx({
      bindings: {
        host: server.url,
        allowHttpBaseUrl: true,
      },
      secret: { username: 'user', password: 'secret' },
    });

    const result = await callHandler(METHOD_BATCH_BLOCK_FULL,
      { environment_name: 'prod', ip_directives: [{ ip: '192.0.2.10' }] },
      ctx,
    );

    assert.equal(result.results[0].success, true);
    assert.equal(result.work_orders[0].work_order_id, 'WO-1');
    assert.equal(server.requests.length, 3);
    assert.equal(server.requests[2].body.environmentId, 'env-prod');
  } finally {
    await server.close();
  }
});
