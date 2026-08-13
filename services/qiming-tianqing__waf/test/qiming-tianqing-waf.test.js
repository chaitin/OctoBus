import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_BLOCK_FULL,
  METHOD_BLOCK_PATH,
  METHOD_UNBLOCK_FULL,
  METHOD_UNBLOCK_PATH,
  PATH_ADDRESS_OBJECT,
  PATH_BLOCK,
  PATH_LOGIN,
  PATH_LOGOUT,
  PATH_UNBLOCK,
  _test,
  handlers,
  rpcdef,
} from '../src/qiming-tianqing-waf.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;

const createHeaders = (entries = {}) => {
  const map = new Map();
  for (const [key, value] of Object.entries(entries)) {
    map.set(String(key).toLowerCase(), Array.isArray(value) ? value.map(String) : [String(value)]);
  }
  return {
    get: (key) => map.get(String(key).toLowerCase())?.[0] ?? null,
    getSetCookie: () => map.get('set-cookie') ?? [],
    raw: () => Object.fromEntries(Array.from(map.entries())),
    forEach: (callback) => {
      for (const [key, values] of map.entries()) {
        for (const value of values) callback(value, key);
      }
    },
  };
};

const response = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: createHeaders(headers),
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const setFetch = (impl) => {
  globalThis.fetch = impl;
};

const buildCtx = (overrides = {}) => ({
  bindings: {
    baseUrl: 'http://qiming.local',
    username: 'demo',
    password: 'PlainPassword123',
    headers: { 'X-Binding': 'binding' },
    authHeaders: { 'X-Auth-Binding': 'auth-binding' },
    ...(overrides.bindings || {}),
  },
  config: overrides.config || {},
  secret: overrides.secret || {},
  limits: { timeoutMs: 2000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst-1', request_id: 'req-1', ...(overrides.meta || {}) },
  req: {
    ip_list: ['1.1.1.1'],
    blacklist: { name: 'demo-blacklist', reason: 'manual' },
    ...(overrides.req || {}),
  },
});

const callHandler = (method, request = {}, ctx = {}) => {
  const handler = handlers[method];
  return handler({ ...ctx, request });
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

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('service exports handlers and rpcdef paths', async () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers[METHOD_BLOCK_FULL], 'function');
  assert.equal(typeof handlers[METHOD_UNBLOCK_FULL], 'function');

  setFetch(async () => response(200, { code: 0, data: { authorization: 'Bearer token' } }, { 'set-cookie': 'SID=mock; Path=/' }));
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { ip_list: [] } }))[METHOD_BLOCK_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /ip_list is required/),
  );
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { ip_list: [] } }))[METHOD_UNBLOCK_PATH](),
    'INVALID_ARGUMENT',
  );
});

test('resolveIpList accepts supported shapes and rejects empty input', () => {
  assert.deepEqual(_test.resolveIpList({ ip_list: [' 1.1.1.1 ', { value: '2.2.2.2' }, ''] }), ['1.1.1.1', '2.2.2.2']);
  assert.deepEqual(_test.resolveIpList({ ipList: { values: [{ value: '3.3.3.3' }, null, ' '] } }), ['3.3.3.3']);
  assert.deepEqual(_test.resolveIpList({ ips: ' 4.4.4.4 ' }), ['4.4.4.4']);
  assert.throws(() => _test.resolveIpList(), /ip_list is required/);
  assert.throws(() => _test.resolveIpList({ ips: [' '] }), /ip_list is required/);
});

test('resolveCredential supports request, config, secret, aliases, extra, and SHA handling', () => {
  const expectedSha = crypto.createHash('sha256').update('PlainPassword123').digest('hex');
  const callCtx = _test.resolveCallContext({
    config: { restBaseUrl: 'https://qiming.example/' },
    secret: { password: 'PlainPassword123' },
    bindings: { user: 'binding-user', skipTlsVerify: 'yes' },
    req: {
      credential: {
        username: ' request-user ',
        extra: {
          fields: {
            tenant: { stringValue: 'default' },
            retries: { numberValue: 2 },
            enabled: { boolValue: true },
            tags: { listValue: { values: [{ stringValue: 'a' }] } },
            nested: { structValue: { fields: { key: { stringValue: 'value' } } } },
            nullable: { nullValue: 'NULL_VALUE' },
          },
        },
      },
    },
  });

  const credential = _test.resolveCredential(callCtx.req, callCtx.bindings);
  assert.equal(credential.baseUrl, 'https://qiming.example');
  assert.equal(credential.username, 'binding-user');
  assert.equal(credential.passwordSha, expectedSha);
  assert.equal(credential.skipTls, true);
  assert.deepEqual(credential.extra, {
    tenant: 'default',
    retries: 2,
    enabled: true,
    tags: ['a'],
    nested: { key: 'value' },
    nullable: null,
  });

  const supplied = _test.resolveCredential({
    credential: {
      base_url: 'http://qiming.example',
      username: 'demo',
      password_sha256: 'ABCDEF',
    },
  }, {
    baseUrl: 'http://binding.example',
    username: 'binding-demo',
    password_sha256: 'ABCDEF',
  });
  assert.equal(supplied.baseUrl, 'http://binding.example');
  assert.equal(supplied.username, 'binding-demo');
  assert.equal(supplied.passwordSha, 'abcdef');
  assert.equal(_test.ensurePasswordSha(supplied), 'abcdef');
});

test('credential validation, primitive helpers, and defaults cover edge cases', () => {
  assert.equal(_test.normalizeBaseUrl('ftp://nope'), '');
  assert.equal(_test.normalizeBaseUrl(''), '');
  assert.equal(_test.normalizeString({ value: ' text ' }), 'text');
  assert.equal(_test.normalizeString(null), '');
  assert.equal(_test.pickStringField({ a: { value: ' ok ' } }, ['a']), 'ok');
  assert.equal(_test.pickStringField({ a: '' }, ['a', 'b']), undefined);
  assert.equal(_test.toBoolean(true), true);
  assert.equal(_test.toBoolean(false), false);
  assert.equal(_test.toBoolean(1), true);
  assert.equal(_test.toBoolean(0), false);
  assert.equal(_test.toBoolean(Number.NaN), false);
  assert.equal(_test.toBoolean('YES'), true);
  assert.equal(_test.toBoolean('off'), false);
  assert.equal(_test.toBoolean('maybe'), false);
  assert.equal(_test.toBoolean({ arbitrary: true }), false);
  assert.equal(_test.toBoolean({ value: '0' }), false);
  assert.equal(_test.toBoolean({ value: 'on' }), true);
  assert.equal(_test.optionalUint32(), undefined);
  assert.equal(_test.optionalUint32('12.9'), 12);
  assert.equal(_test.optionalUint32(-1), undefined);
  assert.equal(_test.optionalUint32('not-number'), undefined);
  assert.equal(_test.resolveTimeoutMs({ req: { timeout_ms: { value: 123 } }, bindings: {}, limits: {} }), 123);
  assert.equal(_test.resolveTimeoutMs({ req: {}, bindings: { timeoutMs: 456 }, limits: { timeoutMs: 789 } }), 456);
  assert.equal(_test.resolveTimeoutMs({ req: {}, bindings: {}, limits: { timeoutMs: 789 } }), 789);
  assert.equal(_test.shouldCreateAddressObject({ address_object: { disabled: { value: true } } }), false);
  assert.equal(_test.shouldLogout({}), true);
  assert.equal(_test.shouldLogout({ logout: { value: false } }), false);
  assert.equal(_test.resolveAddressName({}, '2001:db8::1', 2), 'ip-2001_db8_1_3');
  assert.equal(_test.resolveAddressName({ address_object: { name: { value: 'fixed' } } }, '1.1.1.1', 0), 'fixed');
  assert.deepEqual(_test.resolveDescriptions({}), {
    addressDesc: 'engine automated action',
    blacklistName: 'default_blacklist',
    blacklistReason: 'engine automated action',
    unblockReason: 'engine automated action',
  });
  assert.deepEqual(_test.resolveDescriptions({ blacklist: { reason: 'r' }, unblock: { reason: 'u' } }), {
    addressDesc: 'r',
    blacklistName: 'default_blacklist',
    blacklistReason: 'r',
    unblockReason: 'u',
  });
  assert.throws(() => _test.resolveCredential({}, {}), /base_url\/restBaseUrl is required/);
  assert.throws(() => _test.resolveCredential({ credential: { base_url: 'http://x' } }, { baseUrl: 'http://x' }), /username is required/);
  assert.throws(() => _test.resolveCredential({ credential: { base_url: 'http://x', username: 'u' } }, { baseUrl: 'http://x', username: 'u' }), /password is required/);
  assert.deepEqual(_test.buildAuthHeaders({ A: 'b' }, { authorization: 'Bearer t', sid: 'sid' }), {
    A: 'b',
    Authorization: 'Bearer t',
    authorization: 'Bearer t',
    Cookie: 'SID=sid',
  });
  assert.equal(_test.responseCodeIsSuccess({ code: '0' }), true);
  assert.equal(_test.responseCodeIsSuccess({ code: 'ok' }), false);
  assert.doesNotThrow(() => _test.requireBusinessSuccess({ code: 0 }, 'ok', 'ok'));
  assert.throws(() => _test.requireBusinessSuccess({ code: 'bad', message: 'bad message' }, 'label', 'fallback'), /bad message/);
});

test('struct and scalar helpers cover protobuf and plain object variants', () => {
  assert.equal(_test.unwrapScalar({ value: { value: 'nested' } }), 'nested');
  assert.equal(_test.readPrimitive({ value: 42 }), 42);
  assert.deepEqual(_test.normalizeStruct(null), {});
  assert.deepEqual(_test.normalizeStructValue({ listValue: { values: [{ boolValue: false }, { numberValue: 2 }] } }), [false, 2]);
  assert.deepEqual(_test.normalizeStructValue({ structValue: { fields: { a: { stringValue: 'b' } } } }), { a: 'b' });
  assert.deepEqual(_test.normalizeStructValue({ nullValue: 'NULL_VALUE' }), null);
  assert.deepEqual(_test.normalizeStruct({ plain: { value: 'not-protobuf' } }), { plain: { value: 'not-protobuf' } });
  assert.deepEqual(_test.mergeDeep({ a: 1 }, null, 'bad', { b: 2 }), { a: 1, b: 2 });
  assert.equal(_test.lookupContext({ a: { b: 'c' } }, 'a.b'), 'c');
  assert.deepEqual(_test.normalizeStruct('bad'), {});
});

test('template and merge helpers preserve nested values', () => {
  const merged = _test.mergeDeep(
    { a: { b: 1, c: 2 }, list: [{ x: 1 }], keep: true },
    { a: { b: 3 }, list: [{ y: 2 }] },
  );
  assert.deepEqual(merged, { a: { b: 3, c: 2 }, list: [{ y: 2 }], keep: true });
  const clone = _test.cloneValue(merged);
  clone.a.b = 9;
  assert.equal(merged.a.b, 3);

  const payload = _test.applyTemplate({
    name: '{{address_object_name}}',
    detail: {
      ip: '{{ip}}',
      list: ['{{ip}}', '{{blacklist_name}}', '{{ip_list}}', '{{nested}}', '{{missing}}'],
    },
    enabled: true,
  }, {
    address_object_name: 'obj-1',
    ip: '1.1.1.1',
    blacklist_name: 'list',
    ip_list: ['1.1.1.1', '2.2.2.2'],
    nested: { a: 1 },
  });
  assert.deepEqual(payload.detail.list, ['1.1.1.1', 'list', '1.1.1.1,2.2.2.2', '{"a":1}', '']);
  assert.equal(payload.enabled, true);

  const templates = _test.resolveTemplates({
    address_object: { template_override: { fields: { content: { stringValue: 'addr {{ip}}' } } } },
    blacklist: { template_override: { name: 'override {{blacklist_name}}' } },
    unblock: { template_override: { list: [{ ip: '{{ip}}', reason: '{{reason}}' }] } },
  });
  assert.equal(templates.addressTemplate.content, 'addr {{ip}}');
  assert.equal(templates.blacklistTemplate.name, 'override {{blacklist_name}}');
  assert.deepEqual(templates.unblockTemplate.list, [{ ip: '{{ip}}', reason: '{{reason}}' }]);
});

test('executeBlock performs login, address object creation, blacklist add, and logout', async () => {
  const calls = [];
  const responses = [
    response(200, { code: 0, data: { authorization: 'Bearer token' } }, { 'set-cookie': 'SID=mock; Path=/; HttpOnly' }),
    response(200, { code: 0, data: { id: 'addr-1' } }),
    response(200, { code: 0, data: { blocked: ['1.1.1.1'] } }),
    response(200, { code: 0 }),
  ];

  setFetch(async (url, init) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : undefined });
    const next = responses.shift();
    assert.ok(next, `unexpected fetch call for ${url}`);
    return next;
  });

  const result = await _test.executeBlock(buildCtx({
    config: { baseUrl: 'http://example.com/', username: 'demo' },
    secret: { password: 'PlainPassword123' },
    req: {
      ip_list: ['1.1.1.1'],
      credential: {
        base_url: 'http://example.com/',
        username: 'request-demo',
        password: 'RequestPassword123',
        skip_tls_verify: { value: true },
        extra: { loginDomain: 'default' },
      },
      blacklist: { name: 'demo-blacklist', reason: 'manual' },
    },
  }));

  const expectedSha = crypto.createHash('sha256').update('PlainPassword123').digest('hex');
  assert.deepEqual(result, {
    status: 'OPERATION_STATUS_SUCCESS',
    blocked_ips: ['1.1.1.1'],
    authorization: '',
    sid: '',
  });
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [PATH_LOGIN, PATH_ADDRESS_OBJECT, PATH_BLOCK, PATH_LOGOUT]);
  assert.equal(calls[0].body.password, expectedSha);
  assert.equal(calls[0].body.password_sha256, expectedSha);
  assert.equal(calls[0].body.loginDomain, 'default');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal('timeoutMs' in calls[0].init, false);
  assert.ok(calls[0].init.dispatcher);
  assert.equal('skipTlsVerify' in calls[0].init, false);
  assert.equal(calls[0].init.headers['X-Binding'], 'binding');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer token');
  assert.equal(calls[1].init.headers.authorization, 'Bearer token');
  assert.equal(calls[1].init.headers.Cookie, 'SID=mock');
  assert.equal(calls[1].init.headers['X-Auth-Binding'], 'auth-binding');
  assert.equal(calls[1].body.name, 'ip-1_1_1_1_1');
  assert.equal(calls[2].body.name, 'demo-blacklist');
  assert.equal(calls[2].body.list[0].description, 'manual');
});

test('executeBlock supports disabled address objects and template overrides through handlers', async () => {
  const calls = [];
  const responses = [
    response(200, { code: '0', data: { Authorization: 'Bearer override' } }, { 'set-cookie': ['lang=x; Path=/', 'SID=sid-2; Path=/'] }),
    response(200, { code: 0 }),
  ];
  setFetch(async (url, init) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : undefined });
    return responses.shift();
  });

  const result = await callHandler(METHOD_BLOCK_FULL, {
    ipList: { values: ['2.2.2.2'] },
    address_object: { disabled: true },
    blacklist: {
      name: 'custom-list',
      reason: 'custom reason',
      template_override: {
        action: 'deny',
        list: [{ ip: '{{ip}}', reason: '{{reason}}', all: '{{ip_list_json}}' }],
        name: 'prefix-{{blacklist_name}}',
      },
    },
    logout: false,
  }, buildCtx());

  assert.equal(result.sid, '');
  assert.deepEqual(result.blocked_ips, ['2.2.2.2']);
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [PATH_LOGIN, PATH_BLOCK]);
  assert.equal(calls[1].body.action, 'deny');
  assert.equal(calls[1].body.name, 'prefix-custom-list');
  assert.equal(calls[1].body.list[0].all, '["2.2.2.2"]');
});

test('executeUnblock performs login, delete, and skips logout when requested', async () => {
  const suppliedSha = crypto.createHash('sha256').update('ExistingHash').digest('hex').toUpperCase();
  const calls = [];
  const responses = [
    response(200, { code: 0, data: { authorization: 'Bearer token' } }, { 'set-cookie': 'SID=mock; Path=/;' }),
    response(200, { code: 0, data: { blocked: [] } }),
  ];
  setFetch(async (url, init) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : undefined });
    return responses.shift();
  });

  const result = await _test.executeUnblock(buildCtx({
    config: { baseUrl: 'http://example.com', username: 'demo' },
    secret: { passwordSha256: suppliedSha },
    req: {
      ips: '3.3.3.3',
      ip_list: undefined,
      credential: {
        restBaseUrl: 'http://example.com',
        username: 'demo',
        passwordSha256: suppliedSha,
      },
      blacklist: { name: 'demo-blacklist', reason: 'manual unblock' },
      unblock: {
        reason: 'override unblock',
        template_override: { action: 'remove', ip: '{{ip}}', name: '{{blacklist_name}}', reason: '{{reason}}' },
      },
      logout: { value: false },
    },
  }));

  assert.deepEqual(result.unblocked_ips, ['3.3.3.3']);
  assert.equal(result.authorization, '');
  assert.equal(result.sid, '');
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [PATH_LOGIN, PATH_UNBLOCK]);
  assert.equal(calls[0].body.password, suppliedSha.toLowerCase());
  assert.equal(calls[0].body.password_sha256, suppliedSha.toLowerCase());
  assert.equal(calls[1].body.action, 'remove');
  assert.equal(calls[1].body.reason, 'override unblock');
});

test('business failures map to expected gRPC status codes', async () => {
  setFetch(async () => response(200, { code: 401, msg: 'bad login' }, { 'set-cookie': 'SID=bad; Path=/' }));
  await expectGrpcError(
    () => _test.executeBlock(buildCtx()),
    'UNAUTHENTICATED',
    (err) => assert.match(err.message, /bad login/),
  );

  for (const [path, code, message] of [
    [PATH_ADDRESS_OBJECT, 4001, 'add failed'],
    [PATH_BLOCK, 4002, 'block failed'],
    [PATH_UNBLOCK, 4003, 'delete failed'],
  ]) {
    const responses = [
      response(200, { code: 0, data: { authorization: 'Bearer token' } }, { 'set-cookie': 'SID=mock; Path=/' }),
      response(200, { code, msg: message }),
    ];
    setFetch(async () => responses.shift());
    const run = path === PATH_UNBLOCK ? () => _test.executeUnblock(buildCtx()) : () => _test.executeBlock(buildCtx({
      req: path === PATH_BLOCK ? { address_object: { disabled: true } } : {},
    }));
    await expectGrpcError(run, 'FAILED_PRECONDITION', (err) => assert.match(err.message, new RegExp(message)));
  }
});

test('HTTP, JSON, network, and login precondition failures map correctly', async () => {
  for (const [status, legacyCode] of [[401, 'PERMISSION_DENIED'], [403, 'PERMISSION_DENIED'], [404, 'FAILED_PRECONDITION'], [500, 'UNAVAILABLE']]) {
    setFetch(async () => response(status, { code: status, msg: 'http failure' }));
    await expectGrpcError(() => _test.fetchJson('http://example.test', { body: {} }), legacyCode);
  }

  setFetch(async () => response(200, 'not-json'));
  await expectGrpcError(() => _test.fetchJson('http://example.test', { body: {} }), 'UNKNOWN', (err) => {
    assert.match(err.message, /response is not valid JSON/);
  });

  setFetch(async () => response(200, ''));
  const empty = await _test.fetchJson('http://example.test', { body: {} });
  assert.deepEqual(empty.json, {});

  setFetch(async () => {
    throw Object.assign(new Error('outer'), { cause: new Error('socket hang up') });
  });
  await expectGrpcError(() => _test.fetchJson('http://example.test', { body: {} }), 'UNAVAILABLE', (err) => {
    assert.match(err.message, /socket hang up/);
  });

  setFetch(async () => undefined);
  await expectGrpcError(() => _test.fetchJson('http://example.test', { body: {} }), 'UNAVAILABLE', (err) => {
    assert.match(err.message, /empty response/);
  });

  setFetch(async () => response(200, { code: 0, data: {} }, { 'set-cookie': 'SID=mock; Path=/' }));
  await expectGrpcError(() => _test.login({
    baseUrl: 'http://example.test',
    timeoutMs: 1,
    headers: {},
    templates: { loginTemplate: {} },
    credential: { username: 'u', passwordSha: 'p', extra: {}, skipTls: false },
  }), 'FAILED_PRECONDITION', (err) => assert.match(err.message, /missing data.authorization/));

  setFetch(async () => response(200, { code: 0, data: { authorization: 'Bearer token' } }));
  await expectGrpcError(() => _test.login({
    baseUrl: 'http://example.test',
    timeoutMs: 1,
    headers: {},
    templates: { loginTemplate: {} },
    credential: { username: 'u', passwordSha: 'p', extra: {}, skipTls: false },
  }), 'FAILED_PRECONDITION', (err) => assert.match(err.message, /missing SID cookie/));
});

test('rpc handlers accept request fields from stored call context', async () => {
  const calls = [];
  const responses = [
    response(200, { code: 0, data: { authorization: 'Bearer token' } }, { 'set-cookie': 'SID=ctx; Path=/' }),
    response(200, { code: 0 }),
  ];
  setFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    return responses.shift();
  });

  const result = await rpcdef(buildCtx({
    req: {
      ip_list: ['9.9.9.9'],
      address_object: { disabled: true },
      logout: false,
    },
  }))[METHOD_BLOCK_PATH]();

  assert.deepEqual(result.blocked_ips, ['9.9.9.9']);
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [PATH_LOGIN, PATH_BLOCK]);
});

test('SID extraction supports common header implementations', () => {
  assert.equal(_test.parseSid('SID=abc; Path=/'), 'abc');
  assert.equal(_test.parseSid('OTHER=abc'), undefined);
  assert.equal(_test.extractSid(createHeaders({ 'set-cookie': ['foo=bar; Path=/', 'SID=from-array; Path=/'] })), 'from-array');
  assert.equal(_test.extractSid({ getSetCookie: undefined, get: () => 'SID=from-get; Path=/' }), 'from-get');
  assert.equal(_test.extractSid({ raw: () => ({ 'set-cookie': ['SID=from-raw; Path=/'] }) }), 'from-raw');
  assert.equal(_test.extractSid({ raw: () => ({}) }), undefined);
  assert.equal(_test.extractSid({ forEach: (cb) => cb('SID=from-foreach; Path=/', 'set-cookie') }), 'from-foreach');
  assert.equal(_test.extractSid(null), undefined);
});

test('logout failures are logged and do not fail the main operation', async () => {
  const calls = [];
  const responses = [
    response(200, { code: 0, data: { authorization: 'Bearer token' } }, { 'set-cookie': 'SID=mock; Path=/' }),
    response(200, { code: 0 }),
    response(200, { code: 0 }),
  ];
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  setFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith(PATH_LOGOUT)) throw new Error('logout down');
    return responses.shift();
  });

  try {
    const result = await _test.executeBlock(buildCtx());
    assert.deepEqual(result.blocked_ips, ['1.1.1.1']);
    assert.ok(calls.some((call) => call.url.endsWith(PATH_LOGOUT)));
    assert.match(String(warnings[0]?.[1]), /logout down/);
  } finally {
    console.warn = originalWarn;
  }
});

test('mock upstream handles block and unblock lifecycle', async () => {
  const server = await createMockServer();
  try {
    const blockResult = await callHandler(METHOD_BLOCK_FULL, {
      ip_list: ['192.0.2.10'],
      blacklist: { name: 'mock-list', reason: 'integration' },
    }, { config: { baseUrl: server.url, username: 'demo' }, secret: { password: 'secret' }, meta: { instanceId: 'inst', requestId: 'req' } });
    assert.equal(blockResult.status, 'OPERATION_STATUS_SUCCESS');
    assert.equal(blockResult.sid, '');

    const statusAfterBlock = await fetch(`${server.url}/__status`).then((res) => res.json());
    assert.deepEqual(statusAfterBlock.blocked, ['192.0.2.10']);
    assert.deepEqual(statusAfterBlock.objects, ['addr-192.0.2.10']);

    const unblockResult = await callHandler(METHOD_UNBLOCK_FULL, {
      ip_list: ['192.0.2.10'],
      blacklist: { name: 'mock-list' },
    }, { config: { baseUrl: server.url, username: 'demo' }, secret: { password: 'secret' } });
    assert.equal(unblockResult.status, 'OPERATION_STATUS_SUCCESS');
    assert.deepEqual(unblockResult.unblocked_ips, ['192.0.2.10']);

    const statusAfterUnblock = await fetch(`${server.url}/__status`).then((res) => res.json());
    assert.deepEqual(statusAfterUnblock.blocked, []);
    assert.ok(server.requests.some((req) => req.url === '/login/logout'));

    const missingAuth = await fetch(`${server.url}/blacklist/add_submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ip: '198.51.100.1' }),
    }).then((res) => res.json());
    assert.equal(missingAuth.code, 401);

    const missingIp = await fetch(`${server.url}/addressobject/addAddrObj`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer token',
        cookie: 'SID=mock-session',
      },
      body: JSON.stringify({ name: 'bad' }),
    }).then((res) => res.json());
    assert.equal(missingIp.code, 4001);

    const notFound = await fetch(`${server.url}/not-found`).then((res) => res.json());
    assert.equal(notFound.code, 404);
  } finally {
    await server.close();
  }
});
