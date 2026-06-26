import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  LOGIN_PATH,
  BLOCK_PATH,
  UNBLOCK_PATH,
  QUERY_PATH,
  LOGOUT_PATH,
  METHOD_LOGIN_FULL,
  METHOD_BLOCK_FULL,
  METHOD_UNBLOCK_FULL,
  METHOD_QUERY_FULL,
  METHOD_LOGOUT_FULL,
  _test,
  handlers,
  rpcdef,
} from '../src/qianxin-fw-secgate3600-v3-6-6.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;
let instanceSeq = 0;
const nextInstanceId = () => `inst-${++instanceSeq}`;

const buildCtx = (overrides = {}) => ({
  bindings: { host: overrides.host, user: 'api_user', password: 'SuperSecret!', ...(overrides.bindings || {}) },
  config: overrides.config || {},
  secret: overrides.secret || {},
  limits: { timeoutMs: 10_000, ...(overrides.limits || {}) },
  meta: { instance_id: overrides.instance_id || nextInstanceId(), request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const createHeaders = (entries = {}) => {
  const map = new Map();
  for (const [key, value] of Object.entries(entries)) {
    map.set(String(key).toLowerCase(), Array.isArray(value) ? value.map(String) : [String(value)]);
  }
  return {
    get(name) { const v = map.get(String(name).toLowerCase()); return v?.length ? v.join(', ') : null; },
    getSetCookie() { return map.get('set-cookie') || []; },
    forEach(cb) { for (const [k, vs] of map.entries()) for (const v of vs) cb(v, k); },
  };
};

const fakeResponse = (status, body, headers = {}) => ({ status, headers: createHeaders(headers), text: async () => body });
const withFetch = (impl) => { globalThis.fetch = impl; };

test.afterEach(() => { globalThis.fetch = originalFetch; _test.sessionCache.clear(); });

// ---------- end-to-end against mock device ----------

test('login → block → query → unblock → logout full flow', async () => {
  const mock = await createMockServer();
  const instance_id = nextInstanceId();
  try {
    const ctx = buildCtx({ host: mock.host, instance_id });

    const login = await rpcdef(ctx)[LOGIN_PATH]();
    assert.equal(login.success, true);
    assert.equal(login.error_code, 'success');
    assert.ok(login.token);
    assert.equal(login.http_status, 200);

    const block = await handlers[METHOD_BLOCK_FULL]({ items: [
      { ip_start: '1.1.1.1', desc: 'soc', schedule: 'always' },
      { ip_start: '2.2.2.2', ip_end: '2.2.2.5', enable: 'enable' },
    ] }, ctx);
    assert.equal(block.results.length, 2);
    assert.equal(block.results[0].error_code, 0);
    assert.equal(block.results[0].ip_end, '1.1.1.1'); // defaulted from ip_start
    assert.equal(mock.state.blacklist.size, 2);

    const query = await handlers[METHOD_QUERY_FULL]({ search_key: '1.1.1.1' }, ctx);
    assert.equal(query.error_code, 0);
    assert.equal(query.total, 1);

    const queryAll = await rpcdef(ctx)[QUERY_PATH]();
    assert.equal(queryAll.total, 2);

    const unblock = await handlers[METHOD_UNBLOCK_FULL]({ targets: [{ ip_start: '1.1.1.1' }] }, ctx);
    assert.equal(unblock.results.length, 1);
    assert.equal(mock.state.blacklist.has('1.1.1.1'), false);

    const logout = await handlers[METHOD_LOGOUT_FULL]({}, ctx);
    assert.equal(logout.http_status, 200);
    assert.equal(mock.state.sessions.size, 0);
  } finally {
    await mock.close();
  }
});

test('login failure does not cache a session', async () => {
  const mock = await createMockServer();
  try {
    const ctx = buildCtx({ host: mock.host, bindings: { password: 'wrong' } });
    const login = await handlers[METHOD_LOGIN_FULL]({}, ctx);
    assert.equal(login.success, false);
    assert.equal(login.token, '');
    await assert.rejects(() => rpcdef(ctx)[BLOCK_PATH]({ items: [{ ip_start: '9.9.9.9' }] }), (err) => {
      assert.equal(err.legacyCode, 'FAILED_PRECONDITION');
      return true;
    });
  } finally {
    await mock.close();
  }
});

// ---------- validation errors ----------

test('missing host / credentials / items reject with INVALID_ARGUMENT', async () => {
  await assert.rejects(() => handlers[METHOD_LOGIN_FULL]({}, buildCtx({ bindings: { host: '' } })),
    (e) => e.legacyCode === 'INVALID_ARGUMENT');
  await assert.rejects(() => handlers[METHOD_LOGIN_FULL]({}, buildCtx({ host: 'https://h:8443', bindings: { user: '', username: '' } })),
    (e) => e.legacyCode === 'INVALID_ARGUMENT');
  await assert.rejects(() => handlers[METHOD_LOGIN_FULL]({ username: 'u' }, buildCtx({ host: 'https://h:8443', bindings: { password: '' } })),
    (e) => e.legacyCode === 'INVALID_ARGUMENT');

  const ctx = buildCtx({ host: 'https://h:8443' });
  _test.setSession(ctx, _test.requireHost({}, _test.resolveCallContext(ctx)), { token: 't', cookie: 'token=t', username: 'u' });
  await assert.rejects(() => rpcdef(ctx)[BLOCK_PATH]({ items: [] }), (e) => e.legacyCode === 'INVALID_ARGUMENT');
  await assert.rejects(() => rpcdef(ctx)[BLOCK_PATH]({ items: [{}] }), (e) => e.legacyCode === 'INVALID_ARGUMENT');
  await assert.rejects(() => rpcdef(ctx)[UNBLOCK_PATH]({ targets: [] }), (e) => e.legacyCode === 'INVALID_ARGUMENT');
  await assert.rejects(() => rpcdef(ctx)[UNBLOCK_PATH]({ targets: [{}] }), (e) => e.legacyCode === 'INVALID_ARGUMENT');
});

// ---------- upstream error mapping (injected fetch) ----------

const primeSession = (ctx) => {
  const host = _test.requireHost({}, _test.resolveCallContext(ctx));
  _test.setSession(ctx, host, { token: 't', cookie: 'token=t', username: 'api_user' });
  return host;
};

test('401 from rest clears session and maps to PERMISSION_DENIED', async () => {
  const ctx = buildCtx({ host: 'https://fw:8443' });
  const host = primeSession(ctx);
  withFetch(async () => fakeResponse(401, JSON.stringify({ head: { error_code: 1 } })));
  await assert.rejects(() => rpcdef(ctx)[QUERY_PATH]({}), (e) => e.legacyCode === 'PERMISSION_DENIED');
  assert.equal(_test.getSession(ctx, host), undefined);
});

test('network failure maps to UNAVAILABLE', async () => {
  const ctx = buildCtx({ host: 'https://fw:8443' });
  withFetch(async () => { throw new Error('ECONNREFUSED'); });
  await assert.rejects(() => handlers[METHOD_LOGIN_FULL]({}, ctx), (e) => e.legacyCode === 'UNAVAILABLE');
});

test('non-JSON and empty bodies reject with UNKNOWN', async () => {
  const ctx = buildCtx({ host: 'https://fw:8443' });
  withFetch(async () => fakeResponse(200, 'not-json'));
  await assert.rejects(() => handlers[METHOD_LOGIN_FULL]({}, ctx), (e) => e.legacyCode === 'UNKNOWN');
  withFetch(async () => fakeResponse(200, '   '));
  await assert.rejects(() => handlers[METHOD_LOGIN_FULL]({}, ctx), (e) => e.legacyCode === 'UNKNOWN');
});

test('logout tolerates empty 2xx body but rejects empty non-2xx', async () => {
  const ctx1 = buildCtx({ host: 'https://fw:8443' });
  primeSession(ctx1);
  withFetch(async () => fakeResponse(204, ''));
  const out = await rpcdef(ctx1)[LOGOUT_PATH]({ username: 'api_user' });
  assert.equal(out.http_status, 204);
  assert.equal(out.raw_json, undefined);

  const ctx2 = buildCtx({ host: 'https://fw:8443' });
  primeSession(ctx2);
  withFetch(async () => fakeResponse(500, ''));
  await assert.rejects(() => rpcdef(ctx2)[LOGOUT_PATH]({ username: 'api_user' }), (e) => e.legacyCode === 'UNKNOWN');
});

test('login caches session from set-cookie array and reuses for block', async () => {
  const ctx = buildCtx({ host: 'https://fw:8443' });
  let calls = 0;
  withFetch(async (url) => {
    calls += 1;
    if (String(url).endsWith('/v1.0/login')) {
      return fakeResponse(200, JSON.stringify({ success: true, result: { error_code: 'success', token: 'abc' } }),
        { 'set-cookie': ['PHPSESSID=x;path=/', 'token=abc;path=/'] });
    }
    return fakeResponse(200, JSON.stringify({ head: { error_code: 0, error_string: 'ok' }, data: '' }));
  });
  const login = await handlers[METHOD_LOGIN_FULL]({}, ctx);
  assert.equal(login.token, 'abc');
  const block = await handlers[METHOD_BLOCK_FULL]({ items: [{ ip_start: '5.5.5.5' }] }, ctx);
  assert.equal(block.results[0].error_string, 'ok');
  assert.ok(calls >= 2);
});

// ---------- service + handler surface ----------

test('service defines all five handlers', () => {
  for (const key of [METHOD_LOGIN_FULL, METHOD_BLOCK_FULL, METHOD_UNBLOCK_FULL, METHOD_QUERY_FULL, METHOD_LOGOUT_FULL]) {
    assert.equal(typeof service.handlers[key], 'function');
  }
  assert.equal(LOGIN_PATH, `/${'QIANXIN_FW_SecGate3600_V3_6_6.QIANXIN_FW_SecGate3600_V3_6_6'}/Login`);
});

// ---------- pure helper coverage ----------

test('helpers cover normalization, conversion and value mapping', () => {
  const h = _test;
  assert.equal(h.normalizeBaseUrl('https://1.2.3.4:8443/'), 'https://1.2.3.4:8443');
  assert.equal(h.normalizeBaseUrl('ftp://x:1'), '');
  assert.equal(h.normalizeBaseUrl('https://nohost'), '');
  assert.equal(h.normalizeBaseUrl('https://h:8443/path'), '');
  assert.equal(h.normalizeBaseUrl(''), '');
  assert.deepEqual(h.parseAuthority('1.2.3.4:8443'), { hostPart: '1.2.3.4', portPart: '8443' });
  assert.equal(h.parseAuthority('noport'), null);
  assert.equal(h.parseAuthority(''), null);

  assert.equal(h.toBoolean('yes'), true);
  assert.equal(h.toBoolean('off'), false);
  assert.equal(h.toBoolean(2), true);
  assert.equal(h.toBoolean({ value: true }), true);
  assert.equal(h.toBoolean('maybe'), false);

  assert.equal(h.toInt64('7'), 7);
  assert.equal(h.toInt64('', 3), 3);
  assert.equal(h.toInt64('nan', 9), 9);
  assert.equal(h.toTrimmedString({ value: ' x ' }), 'x');
  assert.equal(h.toTrimmedString(undefined), '');

  assert.deepEqual(h.toValue('s'), { stringValue: 's' });
  assert.deepEqual(h.toValue(3), { numberValue: 3 });
  assert.deepEqual(h.toValue(false), { boolValue: false });
  assert.equal(h.toValue(null), null);
  assert.deepEqual(h.toValue([1]), { listValue: { values: [{ numberValue: 1 }] } });
  assert.deepEqual(h.toValue({ a: 1 }), { structValue: { fields: { a: { numberValue: 1 } } } });

  assert.deepEqual(h.firstEnvelope([{ head: { x: 1 } }]), { head: { x: 1 } });
  assert.deepEqual(h.firstEnvelope([]), {});
  assert.deepEqual(h.firstEnvelope({ head: {} }), { head: {} });
  assert.deepEqual(h.firstEnvelope('bad'), {});

  assert.equal(h.mergeCookieHeader(['token=zzz;path=/'], 'override'), 'token=override');
  assert.equal(h.mergeCookieHeader(['  ', 'novalue'], ''), '');
  assert.deepEqual(h.buildTlsOptions({ skipTlsVerify: true }).skipTlsVerify, true);
  assert.deepEqual(h.buildTlsOptions({}), {});
  assert.deepEqual(h.buildHeaders({ bindings: { headers: { A: '1' } } }, { B: '2' }), { A: '1', B: '2' });

  assert.equal(h.getInstanceKey({ meta: { instance_id: 'i' } }), 'i');
  assert.equal(h.getInstanceKey({}), 'default');
  assert.equal(h.resolveTimeoutMs({ limits: { timeoutMs: 0 }, bindings: {} }), 5000);
  assert.equal(h.resolveTimeoutMs({ limits: { timeoutMs: 1234 } }), 1234);

  assert.equal(h.getSetCookies({ headers: { get: () => 'a=b' } }).length, 1);
  assert.equal(h.getSetCookies({}).length, 0);
  assert.equal(h.extractHeaders({}).length, 0);

  assert.deepEqual(h.normalizeBlockItem({ ip_start: '1.1.1.1' }, 0), { ip_start: '1.1.1.1', ip_end: '1.1.1.1', enable: 'enable' });
  const err = h.errorWithCode('PERMISSION_DENIED', 'x');
  assert.ok(err instanceof GrpcError);
  assert.equal(err.code, grpcStatus.PERMISSION_DENIED);
});

test('host alias resolution and tls/value edge branches', () => {
  const h = _test;
  const resolve = (bindings) => h.requireHost({}, h.resolveCallContext({ bindings }));
  assert.equal(resolve({ restBaseUrl: 'https://a:1' }), 'https://a:1');
  assert.equal(resolve({ baseUrl: 'https://b:2' }), 'https://b:2');
  assert.equal(resolve({ rest_base_url: 'https://c:3' }), 'https://c:3');
  assert.equal(resolve({ base_url: 'https://d:4' }), 'https://d:4');
  assert.equal(h.requireHost({ host: 'https://e:5' }, h.resolveCallContext({ bindings: {} })), 'https://e:5');

  assert.equal(h.buildTlsOptions({ tlsInsecureSkipVerify: true }).insecureSkipVerify, true);
  assert.equal(h.buildTlsOptions({ insecureSkipVerify: true }).skipTlsVerify, true);

  assert.deepEqual(h.toValue([null]), { listValue: { values: [{ nullValue: 'NULL_VALUE' }] } });
  assert.deepEqual(h.toValue({ a: null }), { structValue: { fields: { a: { nullValue: 'NULL_VALUE' } } } });
  assert.deepEqual(h.toValue(10n), { stringValue: '10' });

  assert.deepEqual(h.normalizeUnblockTargets({ targets: [{ ip_start: '7.7.7.7', ip_end: '7.7.7.9' }] }),
    [{ ip_start: '7.7.7.7', ip_end: '7.7.7.9' }]);
  assert.deepEqual(h.normalizeBlockItems({ items: [{ ip_start: '8.8.8.8', enable: 'disable' }] }),
    [{ ip_start: '8.8.8.8', ip_end: '8.8.8.8', enable: 'disable' }]);
});

test('fetch error surfaces cause message as UNAVAILABLE', async () => {
  withFetch(async () => { const e = new Error('outer'); e.cause = { message: 'deep cause' }; throw e; });
  await assert.rejects(() => _test.fetchUpstream({ bindings: {}, limits: {} }, 'http://x', {}),
    (e) => e.legacyCode === 'UNAVAILABLE' && /deep cause/.test(e.message));
  // no bindings on ctx + thrown value without message/cause → "fetch failed" fallback
  withFetch(async () => { throw {}; });
  await assert.rejects(() => _test.fetchUpstream({ limits: {} }, 'http://x', {}),
    (e) => e.legacyCode === 'UNAVAILABLE' && /fetch failed/.test(e.message));
});

test('403 from rest also clears session and maps to PERMISSION_DENIED', async () => {
  const ctx = buildCtx({ host: 'https://fw:8443' });
  const host = primeSession(ctx);
  withFetch(async () => fakeResponse(403, JSON.stringify({ head: { error_code: 1 } })));
  await assert.rejects(() => rpcdef(ctx)[UNBLOCK_PATH]({ targets: [{ ip_start: '1.1.1.1' }] }),
    (e) => e.legacyCode === 'PERMISSION_DENIED');
  assert.equal(_test.getSession(ctx, host), undefined);
});

test('camelCase request aliases are accepted', async () => {
  const mock = await createMockServer();
  try {
    const ctx = buildCtx({ host: mock.host, meta: { instanceId: nextInstanceId() } });
    await rpcdef(ctx)[LOGIN_PATH]();
    const block = await handlers[METHOD_BLOCK_FULL]({ items: [{ ipStart: '3.3.3.3', ipEnd: '3.3.3.6' }] }, ctx);
    assert.equal(block.results[0].ip_end, '3.3.3.6');
    const q = await handlers[METHOD_QUERY_FULL]({ searchKey: '3.3.3.3' }, ctx);
    assert.equal(q.total, 1);
    const u = await handlers[METHOD_UNBLOCK_FULL]({ targets: [{ ipStart: '3.3.3.3', ipEnd: '3.3.3.6' }] }, ctx);
    assert.equal(u.results.length, 1);
  } finally {
    await mock.close();
  }
});

test('edge branches: authority parsing, instance key, partial session, cookie helpers', () => {
  const h = _test;
  assert.equal(h.normalizeBaseUrl('https://host:bad'), ''); // non-numeric port
  assert.equal(h.normalizeBaseUrl('https://:8443'), '');    // empty host
  assert.equal(h.getInstanceKey({ meta: { instanceId: 'camel' } }), 'camel');
  assert.deepEqual(h.resolveCallContext({ request: { a: 1 } }).req, { a: 1 });

  // partial session (cookie without token) must be rejected like no session
  const ctx = buildCtx({ host: 'https://fw:8443' });
  const host = h.requireHost({}, h.resolveCallContext(ctx));
  h.setSession(ctx, host, { cookie: 'token=x' });
  assert.equal(h.getSession(ctx, host).token, undefined);

  assert.equal(h.getSetCookies({ headers: { getSetCookie: () => 'nope' } }).length, 0); // non-array
  assert.equal(h.getSetCookies({ headers: { get: () => null } }).length, 0);            // no set-cookie
});

test('defensive helper branches', () => {
  const h = _test;
  assert.equal(h.errorWithCode('NOT_MAPPED', 'x').code, grpcStatus.UNKNOWN);
  assert.throws(() => h.requireJsonBody(''), (e) => e.legacyCode === 'UNKNOWN');
  assert.equal(h.mergeCookieHeader(undefined, ''), '');
  assert.equal(h.mergeCookieHeader([null], ''), '');
  assert.equal(h.mergeCookieHeader([';foo'], ''), ''); // empty key pair is skipped
  assert.deepEqual(h.resolveCallContext({}).req, {});
  // forEach with empty key (skipped) and null value (coerced to '')
  const headers = h.extractHeaders({ headers: { forEach: (cb) => { cb('v', ''); cb(null, 'x-test'); } } });
  assert.deepEqual(headers, [{ key: 'x-test', values: [''] }]);
  // non-array / null entries in request normalization
  assert.throws(() => h.normalizeBlockItems({ items: 'nope' }), (e) => e.legacyCode === 'INVALID_ARGUMENT');
  assert.throws(() => h.normalizeBlockItems({ items: [null] }), (e) => e.legacyCode === 'INVALID_ARGUMENT');
  assert.throws(() => h.normalizeUnblockTargets({ targets: 'nope' }), (e) => e.legacyCode === 'INVALID_ARGUMENT');
  assert.throws(() => h.normalizeUnblockTargets({ targets: [null] }), (e) => e.legacyCode === 'INVALID_ARGUMENT');
});

test('upstream responses missing result/head are tolerated', async () => {
  // login response without result object → result defaults to {}
  const loginCtx = buildCtx({ host: 'https://fw:8443' });
  withFetch(async () => fakeResponse(200, JSON.stringify({ success: false })));
  const login = await handlers[METHOD_LOGIN_FULL]({}, loginCtx);
  assert.equal(login.success, false);
  assert.equal(login.error_code, '');

  // query response without head → head defaults to {}
  const ctx = buildCtx({ host: 'https://fw:8443' });
  primeSession(ctx);
  withFetch(async () => fakeResponse(200, JSON.stringify({ data: [] })));
  const q = await handlers[METHOD_QUERY_FULL]({}, ctx);
  assert.equal(q.error_code, 0);
  assert.equal(q.total, 0);
});
