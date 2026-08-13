import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  APPLY_PATH,
  BLACKLIST_URI,
  BLOCK_PATH,
  LIST_PATH,
  LOGIN_PATH,
  METHOD_APPLY_FULL,
  METHOD_LOGIN_FULL,
  UNBLOCK_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/nsfocus-nips-v5-6-r11.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;
let instSeq = 0;

const nextInst = () => `inst-${++instSeq}`;

const buildCtx = (overrides = {}) => ({
  bindings: {
    host: 'http://device.example:8443',
    ...(overrides.bindings || {}),
  },
  config: overrides.config || {},
  secret: { user: 'api_user', password: 'SuperSecret!', ...(overrides.secret || {}) },
  limits: { timeoutMs: 10_000, ...(overrides.limits || {}) },
  meta: { instance_id: overrides.instance_id || nextInst(), request_id: 'req' },
  req: overrides.req || {},
});

const callHandler = (method, request = {}, ctx = {}) => {
  const handler = handlers[method];
  return handler({ ...ctx, request });
};

const makeResponse = ({ status = 200, body = '{}', setCookies, headers } = {}) => ({
  status,
  headers: headers || {
    getSetCookie: () => setCookies || [],
    get: (name) => (String(name).toLowerCase() === 'set-cookie' && setCookies?.length ? setCookies.join(', ') : null),
  },
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
    FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
    INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
    UNKNOWN: grpcStatus.UNKNOWN,
  })[legacyCode]);
  assert.match(caught.message, new RegExp(`^${legacyCode}:`));
  checker(caught);
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  _test.sessionByInstanceId.clear();
});

test('service exports defineService result and handlers', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers[METHOD_LOGIN_FULL], 'function');
  assert.equal(typeof handlers[METHOD_APPLY_FULL], 'function');
});

test('Login rejects missing host, username, and password', async () => {
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { username: 'api_user', password: 'pw' }, bindings: { host: 'device.local' } }))[LOGIN_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /host is required/),
  );
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { username: '', password: '' }, secret: { user: '', username: '', password: 'pw' } }))[LOGIN_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /username is required/),
  );
  await expectGrpcError(
    () => rpcdef(buildCtx({ req: { username: 'api_user', password: '' }, secret: { password: '' } }))[LOGIN_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /password is required/),
  );
});

test('non-login methods require Login first before input validation', async () => {
  for (const [path, req] of [
    [BLOCK_PATH, { ip: '203.0.113.10' }],
    [LIST_PATH, {}],
    [UNBLOCK_PATH, { ids: [1] }],
    [APPLY_PATH, {}],
  ]) {
    await expectGrpcError(
      () => rpcdef(buildCtx({ req }))[path](),
      'FAILED_PRECONDITION',
      (err) => assert.match(err.message, /call Login first/),
    );
  }
});

test('Login stores cookie and keys; BlockIP sends Cookie, sign query, headers, TLS flags, and body', async () => {
  const calls = [];
  const inst = nextInst();
  setFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/api/system/account/login/login')) {
      return makeResponse({
        setCookies: ['sid=abc; Path=/; HttpOnly'],
        body: JSON.stringify({ code: 2000, message: 'success', data: { api_key: 'ak', security_key: 'sk', nested: { ok: true } } }),
      });
    }
    return makeResponse({ body: JSON.stringify({ code: 2000, message: 'success', data: { inserted: true } }) });
  });

  const loginCtx = buildCtx({
    instance_id: inst,
    req: { username: 'ignored-user', password: 'ignored-password', lang: 'en_US' },
    bindings: { headers: { 'X-Device': 'demo' }, skipTlsVerify: true },
    limits: { timeoutMs: undefined },
  });
  const loginRes = await rpcdef(loginCtx)[LOGIN_PATH]();

  assert.equal(loginRes.code, 2000);
  assert.equal(loginRes.api_key, '');
  assert.equal(loginRes.security_key, '');
  assert.equal(loginRes.raw_body, '');
  assert.equal(loginRes.raw_json, undefined);
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal('timeoutMs' in calls[0].init, false);
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].init.headers['X-Device'], 'demo');
  assert.ok(calls[0].init.dispatcher);
  assert.equal('insecureSkipVerify' in calls[0].init, false);
  assert.deepEqual(JSON.parse(calls[0].init.body), { username: 'api_user', password: 'SuperSecret!', lang: 'en_US' });

  const blockCtx = buildCtx({
    instance_id: inst,
    req: {
      ip: '203.0.113.10',
      direction: 2,
      threatType: 8,
      startTime: '2026-01-01 00:00:00',
      end_time: '2026-01-02 00:00:00',
      abstract: 'manual',
    },
  });
  const blockRes = await rpcdef(blockCtx)[BLOCK_PATH]();

  assert.equal(blockRes.code, 2000);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(calls[1].init.headers.Cookie, 'sid=abc');
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    action: 'insert',
    data: {
      name: '203.0.113.10',
      direction: '2',
      start_time: '2026-01-01 00:00:00',
      end_time: '2026-01-02 00:00:00',
      abstract: 'manual',
      threat_type: '8',
    },
  });

  const url = new URL(calls[1].url);
  assert.equal(url.pathname, BLACKLIST_URI);
  assert.equal(url.searchParams.get('apikey'), 'ak');
  assert.ok(url.searchParams.get('time'));
  assert.match(url.searchParams.get('sign'), /^[0-9a-f]{64}$/);
});

test('parseable HTTP errors return OK payloads with sanitized raw fields', async () => {
  const inst = nextInst();
  let step = 0;
  setFetch(async () => {
    step += 1;
    if (step === 1) {
      return makeResponse({
        setCookies: ['sid=abc; Path=/'],
        body: JSON.stringify({ code: 2000, message: 'success', data: { api_key: 'ak', security_key: 'sk' } }),
      });
    }
    return makeResponse({ status: 500, body: JSON.stringify({ code: 7000, message: 'duplicate', data: null }) });
  });

  await rpcdef(buildCtx({ instance_id: inst }))[LOGIN_PATH]();
  const result = await callHandler('Nsfocus_NIPS_V56R11.Nsfocus_NIPS_V56R11/BlockIP', { ip: '203.0.113.10' }, buildCtx({ instance_id: inst }));

  assert.equal(result.http_status, 500);
  assert.equal(result.code, 7000);
  assert.equal(result.message, 'duplicate');
  assert.equal(result.raw_body, '');
  assert.equal(result.raw_json, undefined);
});

test('network, empty, non-json, and text read failures map to legacy errors', async () => {
  setFetch(async () => {
    throw Object.assign(new Error('boom'), { cause: new Error('socket hangup') });
  });
  await expectGrpcError(
    () => rpcdef(buildCtx())[LOGIN_PATH](),
    'UNAVAILABLE',
    (err) => assert.match(err.message, /socket hangup/),
  );

  setFetch(async () => makeResponse({ body: '   ' }));
  await expectGrpcError(() => rpcdef(buildCtx())[LOGIN_PATH](), 'UNKNOWN', (err) => assert.match(err.message, /response body is empty/));

  setFetch(async () => makeResponse({ body: 'not-json' }));
  await expectGrpcError(() => rpcdef(buildCtx())[LOGIN_PATH](), 'UNKNOWN', (err) => assert.match(err.message, /response is not valid JSON/));

  setFetch(async () => ({
    status: 200,
    headers: { getSetCookie: () => [] },
    text: async () => {
      throw new Error('text failed');
    },
  }));
  await assert.rejects(() => rpcdef(buildCtx())[LOGIN_PATH](), /text failed/);
});

test('ListBlacklist sends GET query, no body, maps entries, and filters empty rows', async () => {
  const inst = nextInst();
  const calls = [];
  setFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) {
      return makeResponse({
        setCookies: ['sid=abc; Path=/'],
        body: JSON.stringify({ code: 2000, message: 'success', data: { api_key: 'ak', security_key: 'sk' } }),
      });
    }
    return makeResponse({
      body: JSON.stringify({
        code: 2000,
        message: 'success',
        data: {
          data: [
            { id: 10, name: '198.51.100.10', start_time: 's', end_time: 'e', abstract: 'a', enabled: true, threat_type: 9 },
            { id: 0, name: '', ignored: true },
            { id: '11', name: '', threat_type: '3' },
          ],
        },
      }),
    });
  });

  await rpcdef(buildCtx({ instance_id: inst }))[LOGIN_PATH]();
  const result = await rpcdef(buildCtx({ instance_id: inst, req: { pageSize: 2, pageNo: 3 } }))[LIST_PATH]();

  assert.equal(calls[1].init.method, 'GET');
  assert.ok(!('body' in calls[1].init));
  const url = new URL(calls[1].url);
  assert.equal(url.searchParams.get('pageSize'), '2');
  assert.equal(url.searchParams.get('pageNo'), '3');
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].id, 10);
  assert.equal(result.entries[0].name, '198.51.100.10');
  assert.equal(result.entries[0].enabled, 'true');
  assert.equal(result.entries[1].id, 11);
});

test('UnblockByIds validates ids after login and posts normalized positive integers', async () => {
  const inst = nextInst();
  const calls = [];
  setFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) {
      return makeResponse({
        setCookies: ['sid=abc; Path=/'],
        body: JSON.stringify({ code: 2000, message: 'success', data: { api_key: 'ak', security_key: 'sk' } }),
      });
    }
    return makeResponse({ body: JSON.stringify({ code: 2000, message: 'success', data: { removed: [1, 2] } }) });
  });

  await rpcdef(buildCtx({ instance_id: inst }))[LOGIN_PATH]();
  await expectGrpcError(
    () => rpcdef(buildCtx({ instance_id: inst, req: { ids: [] } }))[UNBLOCK_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /ids is required/),
  );
  await expectGrpcError(
    () => rpcdef(buildCtx({ instance_id: inst, req: { ids: [0, -1, 'bad'] } }))[UNBLOCK_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /positive integers/),
  );

  const result = await rpcdef(buildCtx({ instance_id: inst, req: { ids: [1, '2', 0, -3, 'bad'] } }))[UNBLOCK_PATH]();

  assert.equal(result.code, 2000);
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { action: 'delete', data: [1, 2] });
});

test('ApplyConfig posts signed empty JSON body', async () => {
  const inst = nextInst();
  const calls = [];
  setFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) {
      return makeResponse({
        setCookies: ['sid=abc; Path=/'],
        body: JSON.stringify({ code: 2000, message: 'success', data: { api_key: 'ak', security_key: 'sk' } }),
      });
    }
    return makeResponse({ body: JSON.stringify({ code: 2000, message: 'apply config success', data: null }) });
  });

  await rpcdef(buildCtx({ instance_id: inst }))[LOGIN_PATH]();
  const result = await rpcdef(buildCtx({ instance_id: inst }))[APPLY_PATH]();

  assert.equal(result.message, 'apply config success');
  assert.deepEqual(JSON.parse(calls[1].init.body), {});
  assert.equal(new URL(calls[1].url).pathname, '/api/index/applyconfig');
});

test('config and secret aliases supply bindings, timeout, and headers', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return makeResponse({
      setCookies: ['sid=abc; Path=/'],
      body: JSON.stringify({ code: 2000, message: 'success', data: { api_key: 'ak', security_key: 'sk' } }),
    });
  });

  const result = await callHandler(METHOD_LOGIN_FULL, {}, {
    config: {
      base_url: 'http://config.example/',
      timeout_ms: 2500,
      headers: { 'X-Config': 'yes' },
    },
    secret: { username: 'secret-user', password: 'secret-pass' },
    limits: {},
    meta: { instanceId: 'camel-inst' },
  });

  assert.equal(result.code, 2000);
  assert.equal(captured.url, 'http://config.example/api/system/account/login/login');
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal('timeoutMs' in captured.init, false);
  assert.equal(captured.init.headers['X-Config'], 'yes');
  assert.deepEqual(JSON.parse(captured.init.body), { username: 'secret-user', password: 'secret-pass', lang: 'zh_CN' });
});

test('concurrent Login calls for an instance share one in-flight request', async () => {
  let resolveText;
  let fetchCalls = 0;
  setFetch(async () => {
    fetchCalls += 1;
    return {
      status: 200,
      headers: { getSetCookie: () => ['sid=abc; Path=/'] },
      text: () => new Promise((resolve) => {
        resolveText = () => resolve(JSON.stringify({ code: 2000, message: 'success', data: { api_key: 'ak', security_key: 'sk' } }));
      }),
    };
  });

  const inst = nextInst();
  const ctx = buildCtx({ instance_id: inst });
  const first = rpcdef(ctx)[LOGIN_PATH]();
  await Promise.resolve();
  const second = rpcdef(buildCtx({ instance_id: inst }))[LOGIN_PATH]();
  resolveText();
  const [a, b] = await Promise.all([first, second]);

  assert.equal(fetchCalls, 1);
  assert.deepEqual(a, b);
});

test('helpers cover scalar, URL, cookie, signing, response, and validation branches', async () => {
  assert.equal(_test.normalizeBaseUrl('https://example.test///'), 'https://example.test');
  assert.equal(_test.normalizeBaseUrl('example.test'), '');
  assert.equal(_test.normalizeBaseUrl(null), '');
  assert.equal(_test.resolveBaseUrl({ restBaseUrl: 'http://rest.example/' }), 'http://rest.example');
  assert.equal(_test.resolveBaseUrl({ baseUrl: 'http://base.example/' }), 'http://base.example');
  assert.equal(_test.resolveBaseUrl({ rest_base_url: 'http://rest-snake.example/' }), 'http://rest-snake.example');
  assert.equal(_test.resolveBaseUrl({ base_url: 'http://base-snake.example/' }), 'http://base-snake.example');
  assert.equal(_test.resolveBaseUrl({ host: { value: 'http://wrapped.example/' } }), 'http://wrapped.example');
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: -1 }, bindings: { timeoutMs: 'bad' } }), 1500);
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeout_ms: 321 } }), 321);
  assert.equal(_test.resolveTimeoutMs({ limits: {}, config: { timeoutMs: 222 } }), 222);
  assert.equal(_test.resolveTimeoutMs({ limits: {}, config: { timeout_ms: 223 } }), 223);
  assert.equal(_test.toBoolean('on'), true);
  assert.equal(_test.toBoolean('off'), false);
  assert.equal(_test.toBoolean(''), false);
  assert.equal(_test.toBoolean('1'), true);
  assert.equal(_test.toBoolean('0'), false);
  assert.equal(_test.toBoolean(true), true);
  assert.equal(_test.toBoolean(0), false);
  assert.equal(_test.toBoolean(2), true);
  assert.equal(_test.toBoolean('maybe'), false);
  assert.equal(_test.toBoolean({ value: 1 }), true);
  assert.deepEqual(_test.buildTlsOptions({}), {});
  assert.ok(_test.buildTlsOptions({ skipTlsVerify: true }).dispatcher);
  assert.ok(_test.buildTlsOptions({ tlsInsecureSkipVerify: 'yes' }).dispatcher);
  assert.ok(_test.buildTlsOptions({ insecureSkipVerify: 1 }).dispatcher);
  assert.equal(_test.isValidIPv4('01.1.1.1'), true);
  assert.equal(_test.isValidIPv4('1.1.1'), false);
  assert.equal(_test.isValidIPv4('1.1.1.999'), false);
  assert.throws(() => _test.requireIPv4('', 'ip'), /INVALID_ARGUMENT: ip is required/);
  assert.throws(() => _test.requireIPv4('999.1.1.1', 'ip'), /valid IPv4/);
  assert.equal(_test.toInteger('42.9'), 42);
  assert.equal(_test.toInteger('bad', 7), 7);
  assert.equal(_test.toValue(Symbol.for('x')).stringValue, 'Symbol(x)');
  assert.deepEqual(_test.toValue({ a: undefined, b: [1, true, null] }), {
    structValue: {
      fields: {
        a: { nullValue: 'NULL_VALUE' },
        b: { listValue: { values: [{ numberValue: 1 }, { boolValue: true }] } },
      },
    },
  });
  assert.equal(_test.appendQuery('http://x.test/a?b=1', { c: 'x y', d: '', e: null }), 'http://x.test/a?b=1&c=x%20y');
  assert.equal(_test.appendQuery('http://x.test/a', { d: '', e: null }), 'http://x.test/a');
  assert.equal(_test.appendQuery('http://x.test/a', { ok: false, zero: 0 }), 'http://x.test/a?ok=false&zero=0');
  assert.match(_test.buildCtAbstract(), /^CT \d{2}:\d{2}:\d{2}$/);
  assert.equal(_test.joinCookieHeader(), '');
  assert.equal(_test.joinCookieHeader(['sid=abc; Path=/', '', ' token=def ; Secure']), 'sid=abc; token=def');
  assert.equal(_test.joinCookieHeader(['; no-pair', 'sid=abc; Path=/']), 'sid=abc');
  assert.deepEqual(_test.getSetCookies({ headers: { getSetCookie: () => 'bad' } }), []);
  assert.deepEqual(_test.getSetCookies({ headers: { getSetCookie: () => ['sid=abc'] } }), ['sid=abc']);
  assert.deepEqual(_test.getSetCookies({ headers: { get: () => 'sid=abc; Path=/' } }), ['sid=abc; Path=/']);
  assert.deepEqual(_test.getSetCookies({ headers: { get: () => null } }), []);
  assert.deepEqual(_test.getSetCookies({}), []);
  assert.equal(_test.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.match(_test.buildSignQuery({ apiKey: 'ak', securityKey: 'sk' }, '/r').sign, /^[0-9a-f]{64}$/);
  assert.deepEqual(_test.toNipsResponse({ status: 201, text: '{"code":1}', json: { code: '1', message: 'm', data: ['x'] } }), {
    code: 1,
    message: 'm',
    data: { listValue: { values: [{ stringValue: 'x' }] } },
    http_status: 201,
    raw_body: '',
    raw_json: undefined,
  });
  assert.equal(_test.errorWithCode('NOT_REAL', 'fallback').code, grpcStatus.UNKNOWN);
});

test('default request branches preserve legacy session and validation behavior', async () => {
  const inst = nextInst();
  setFetch(async () => makeResponse({
    setCookies: [],
    body: JSON.stringify({ code: 2000, message: 'success', data: { api_key: 'ak', security_key: 'sk' } }),
  }));

  const login = await rpcdef(buildCtx({ instance_id: inst, req: { password: 'from-req' } }))[LOGIN_PATH]();
  assert.equal(login.code, 2000);
  await expectGrpcError(
    () => rpcdef(buildCtx({ instance_id: inst, req: { ip: '198.51.100.10' } }))[BLOCK_PATH](),
    'FAILED_PRECONDITION',
  );

  _test.sessionByInstanceId.set(inst, { cookie: 'sid=abc', apiKey: 'ak', securityKey: 'sk' });
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return makeResponse({ body: JSON.stringify({ code: 2000, message: 'success', data: null }) });
  });

  await expectGrpcError(
    () => rpcdef(buildCtx({ instance_id: inst, req: { ip: '999.1.1.1' } }))[BLOCK_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /valid IPv4/),
  );

  const result = await rpcdef({
    bindings: buildCtx().bindings,
    limits: buildCtx().limits,
    meta: { instance_id: inst },
    request: { ip: '198.51.100.20' },
  })[BLOCK_PATH]();
  assert.equal(result.code, 2000);
  const body = JSON.parse(captured.init.body);
  assert.equal(body.data.direction, '1');
  assert.equal(body.data.threat_type, '9');
  assert.equal(body.data.start_time, '');
  assert.equal(body.data.end_time, '');
  assert.match(body.data.abstract, /^CT \d{2}:\d{2}:\d{2}$/);
  assert.equal(_test.getInstanceId({ meta: {} }), 'unknown');
});

test('mock upstream supports login, blacklist lifecycle, and apply-config', async () => {
  const mock = await createMockServer();
  try {
    const ctx = buildCtx({ bindings: { host: mock.url }, instance_id: nextInst() });
    await rpcdef(ctx)[LOGIN_PATH]();
    await rpcdef({ ...ctx, req: { ip: '198.51.100.10', abstract: 'fixture' } })[BLOCK_PATH]();
    const list = await rpcdef({ ...ctx, req: { page_size: 10, page_no: 1 } })[LIST_PATH]();
    assert.equal(list.entries.length, 1);
    assert.equal(list.entries[0].name, '198.51.100.10');
    const unblock = await rpcdef({ ...ctx, req: { ids: [list.entries[0].id] } })[UNBLOCK_PATH]();
    assert.equal(unblock.code, 2000);
    const apply = await rpcdef(ctx)[APPLY_PATH]();
    assert.equal(apply.message, 'apply config success');
  } finally {
    await mock.close();
  }
});
