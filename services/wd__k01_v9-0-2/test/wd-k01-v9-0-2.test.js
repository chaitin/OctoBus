import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  QUERY_ATTACK_LOG_PATH,
  QUERY_IPLIST_PATH,
  QUERY_INTEL_PATH,
  ADD_INTEL_PATH,
  DELETE_INTEL_PATH,
  METHOD_QUERY_ATTACK_LOG_FULL,
  METHOD_QUERY_IPLIST_FULL,
  METHOD_QUERY_INTEL_FULL,
  METHOD_ADD_INTEL_FULL,
  METHOD_DELETE_INTEL_FULL,
  _test,
  handlers,
  rpcdef,
} from '../src/wd-k01-v9-0-2.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;
let seq = 0;
const nextId = () => `inst-${++seq}`;

const buildCtx = (mock, overrides = {}) => ({
  bindings: { host: mock?.host, user: mock?.user, password: mock?.password, ...(overrides.bindings || {}) },
  config: overrides.config || {},
  secret: overrides.secret || {},
  limits: { timeoutMs: 10_000, ...(overrides.limits || {}) },
  meta: { instance_id: nextId(), request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const createHeaders = (entries = {}) => {
  const map = new Map();
  for (const [k, v] of Object.entries(entries)) map.set(String(k).toLowerCase(), Array.isArray(v) ? v.map(String) : [String(v)]);
  return { get(n) { const x = map.get(String(n).toLowerCase()); return x?.length ? x.join(', ') : null; } };
};
const fakeResponse = (status, body, ok = status >= 200 && status < 300) => ({ status, ok, headers: createHeaders(), text: async () => body });
const withFetch = (impl) => { globalThis.fetch = impl; };

test.afterEach(() => { globalThis.fetch = originalFetch; });

// ---------- end-to-end against mock ----------

test('query attack log / ip list / threat intel against mock', async () => {
  const mock = await createMockServer();
  try {
    const ctx = buildCtx(mock);
    const atk = await rpcdef(ctx)[QUERY_ATTACK_LOG_PATH]({ page: 1, count: 10, type_mask: [256, 257], severity_mask: [2], r_sip: '8.8.8.8', r_s_time: '2025-07-01 00:00:00' });
    assert.equal(atk.success, true);
    assert.equal(atk.total, 1);
    assert.ok(atk.login_raw_json.includes('access_token'));
    assert.equal(mock.state.tokens.size, 0); // logged out

    const ipl = await handlers[METHOD_QUERY_IPLIST_FULL]({ color: 0, dir: 2, ip_search: '1.1.11.0/24' }, ctx);
    assert.equal(ipl.success, true);
    assert.equal(ipl.total, 1);

    const empty = await rpcdef(ctx)[QUERY_INTEL_PATH]();
    assert.equal(empty.total, 0);
  } finally {
    await mock.close();
  }
});

test('add then query then delete threat intel', async () => {
  const mock = await createMockServer();
  try {
    const ctx = buildCtx(mock);
    const add = await handlers[METHOD_ADD_INTEL_FULL]({ ip: '192.168.68.69', type: 214, severity: 1 }, ctx);
    assert.equal(add.success, true);
    assert.equal(add.id, 1);
    assert.equal(mock.state.intel.size, 1);

    const q = await handlers[METHOD_QUERY_INTEL_FULL]({ source_id: 63 }, ctx);
    assert.equal(q.total, 1);

    const del = await handlers[METHOD_DELETE_INTEL_FULL]({ id: 1 }, ctx);
    assert.equal(del.success, true);
    assert.equal(mock.state.intel.size, 0);
  } finally {
    await mock.close();
  }
});

// ---------- validation ----------

test('binding and argument validation', async () => {
  const mock = await createMockServer();
  try {
    await assert.rejects(() => handlers[METHOD_QUERY_ATTACK_LOG_FULL]({}, buildCtx(mock, { bindings: { host: '' } })),
      (e) => e.legacyCode === 'INVALID_ARGUMENT');
    await assert.rejects(() => handlers[METHOD_QUERY_ATTACK_LOG_FULL]({}, buildCtx(mock, { bindings: { user: '', username: '' } })),
      (e) => e.legacyCode === 'INVALID_ARGUMENT');
    await assert.rejects(() => handlers[METHOD_QUERY_ATTACK_LOG_FULL]({}, buildCtx(mock, { bindings: { password: '' } })),
      (e) => e.legacyCode === 'INVALID_ARGUMENT');

    const ctx = buildCtx(mock);
    await assert.rejects(() => handlers[METHOD_ADD_INTEL_FULL]({ ip: 'not-ip', type: 1, severity: 1 }, ctx), (e) => e.legacyCode === 'INVALID_ARGUMENT');
    await assert.rejects(() => handlers[METHOD_ADD_INTEL_FULL]({ ip: '1.2.3.4', type: 0, severity: 1 }, ctx), (e) => e.legacyCode === 'INVALID_ARGUMENT');
    await assert.rejects(() => handlers[METHOD_DELETE_INTEL_FULL]({ id: 0 }, ctx), (e) => e.legacyCode === 'INVALID_ARGUMENT');
  } finally {
    await mock.close();
  }
});

test('iplist color/dir validation', () => {
  assert.throws(() => _test.buildIPListPayload({ color: 2 }), (e) => e.legacyCode === 'INVALID_ARGUMENT');
  assert.throws(() => _test.buildIPListPayload({ color: 0, dir: 5 }), (e) => e.legacyCode === 'INVALID_ARGUMENT');
  assert.deepEqual(_test.buildIPListPayload({}), { page: 1, count: 10, color: 0, dir: 2 });
});

// ---------- error mapping (injected fetch) ----------

test('login failure → FAILED_PRECONDITION', async () => {
  withFetch(async (url) => {
    if (String(url).endsWith('/api/cms/user/login')) return fakeResponse(200, JSON.stringify({ success: false, error: 'bad' }));
    return fakeResponse(200, 'ok');
  });
  await assert.rejects(() => handlers[METHOD_QUERY_INTEL_FULL]({}, buildCtx({ host: 'https://k01:443', user: 'u', password: 'p' })),
    (e) => e.legacyCode === 'FAILED_PRECONDITION');
});

test('business 401 → PERMISSION_DENIED, and logout still attempted', async () => {
  let logoutCalled = false;
  withFetch(async (url) => {
    const u = String(url);
    if (u.endsWith('/login')) return fakeResponse(200, JSON.stringify({ success: true, token: { access_token: 't' } }));
    if (u.endsWith('/logout')) { logoutCalled = true; return fakeResponse(200, 'bye'); }
    return fakeResponse(401, 'nope', false);
  });
  await assert.rejects(() => handlers[METHOD_QUERY_ATTACK_LOG_FULL]({}, buildCtx({ host: 'https://k01:443', user: 'u', password: 'p' })),
    (e) => e.legacyCode === 'PERMISSION_DENIED');
  assert.equal(logoutCalled, true);
});

test('business semantic failure → FAILED_PRECONDITION', async () => {
  withFetch(async (url) => {
    const u = String(url);
    if (u.endsWith('/login')) return fakeResponse(200, JSON.stringify({ success: true, token: { access_token: 't' } }));
    if (u.endsWith('/logout')) return fakeResponse(200, 'bye');
    return fakeResponse(200, JSON.stringify({ success: false, msgType: 'error', msg: '参数错误' }));
  });
  await assert.rejects(() => handlers[METHOD_ADD_INTEL_FULL]({ ip: '1.2.3.4', type: 1, severity: 1 }, buildCtx({ host: 'https://k01:443', user: 'u', password: 'p' })),
    (e) => e.legacyCode === 'FAILED_PRECONDITION' && /参数错误/.test(e.message));
});

test('network error → UNAVAILABLE; empty/invalid body → UNKNOWN', async () => {
  const ctx = buildCtx({ host: 'https://k01:443', user: 'u', password: 'p' });
  withFetch(async () => { throw new Error('ECONNREFUSED'); });
  await assert.rejects(() => handlers[METHOD_QUERY_INTEL_FULL]({}, ctx), (e) => e.legacyCode === 'UNAVAILABLE');
  withFetch(async () => fakeResponse(200, '   '));
  await assert.rejects(() => handlers[METHOD_QUERY_INTEL_FULL]({}, ctx), (e) => e.legacyCode === 'UNKNOWN');
  withFetch(async () => fakeResponse(200, 'not-json'));
  await assert.rejects(() => handlers[METHOD_QUERY_INTEL_FULL]({}, ctx), (e) => e.legacyCode === 'UNKNOWN');
});

test('logout failure is swallowed (success path still returns)', async () => {
  withFetch(async (url) => {
    const u = String(url);
    if (u.endsWith('/login')) return fakeResponse(200, JSON.stringify({ success: true, token: { access_token: 't' } }));
    if (u.endsWith('/logout')) return fakeResponse(500, 'boom', false);
    return fakeResponse(200, JSON.stringify({ success: true, msgType: 'success', data: { total: 0, page: 1, count: 10, list: [] } }));
  });
  const out = await handlers[METHOD_QUERY_IPLIST_FULL]({ color: 1, dir: 0 }, buildCtx({ host: 'https://k01:443', user: 'u', password: 'p' }));
  assert.equal(out.success, true);
  assert.match(out.logout_raw_text, /upstream http 500/);
});

// ---------- service surface + helpers ----------

test('service exposes all five handlers', () => {
  for (const k of [METHOD_QUERY_ATTACK_LOG_FULL, METHOD_QUERY_IPLIST_FULL, METHOD_QUERY_INTEL_FULL, METHOD_ADD_INTEL_FULL, METHOD_DELETE_INTEL_FULL]) {
    assert.equal(typeof service.handlers[k], 'function');
  }
});

test('helper coverage', () => {
  const h = _test;
  assert.equal(h.normalizeBaseUrl('https://k01:443/'), 'https://k01:443');
  assert.equal(h.normalizeBaseUrl('ftp://x'), '');
  assert.equal(h.isIPv4('1.2.3.4'), true);
  assert.equal(h.isIPv4('999.1.1.1'), false);
  assert.equal(h.isIPv4('1.2.3'), false);
  assert.equal(h.requireIpv4('  10.0.0.1 '), '10.0.0.1');
  assert.throws(() => h.requireIpv4(''), (e) => e.legacyCode === 'INVALID_ARGUMENT');
  assert.equal(h.requirePositiveInt(5, 'x'), 5);
  assert.throws(() => h.requirePositiveInt(-1, 'x'), (e) => e.legacyCode === 'INVALID_ARGUMENT');

  assert.deepEqual(h.pickIntList([1, 2, 'bad', 3]), [1, 2, 3]);
  assert.deepEqual(h.pickIntList({ values: [4, 5] }), [4, 5]);
  assert.equal(h.pickIntList([]), undefined);
  assert.equal(h.pickIntList('x'), undefined);
  assert.equal(h.pickIntList(undefined), undefined);

  assert.equal(h.pickInt({ a: '7' }, ['a'], 0), 7);
  assert.equal(h.pickInt({}, ['a'], 9), 9);
  assert.equal(h.pickStringFrom({ a: ' x ' }, ['a']), 'x');
  assert.equal(h.pickFirstString([null, '', 'y']), 'y');
  assert.equal(h.pickBoolean('yes'), true);
  assert.equal(h.pickBoolean('off'), false);
  assert.equal(h.pickBoolean('maybe'), undefined);
  assert.equal(h.pickFirstBoolean(['x', 'true']), true);
  assert.equal(h.unwrapScalar({ value: { value: 3 } }), 3);
  assert.deepEqual(h.sanitizeHeaders({ A: 1, '': 2 }), { A: '1' });
  assert.deepEqual(h.sanitizeHeaders('x'), {});
  assert.deepEqual(h.buildTlsOptions({ skipTlsVerify: true }).skipTlsVerify, true);
  assert.deepEqual(h.buildTlsOptions({}), {});
  assert.equal(h.resolveTimeoutMs({ limits: { timeoutMs: 0 } }), 1500);
  assert.equal(h.resolveTimeoutMs({ limits: { timeoutMs: 222 } }), 222);
  assert.equal(h.grpcCodeFor('NOPE'), grpcStatus.UNKNOWN);
  assert.ok(h.errorWithCode('UNAVAILABLE', 'x') instanceof GrpcError);
  assert.equal(h.isSemanticSuccess({ msgType: 'SUCCESS' }), true);
  assert.equal(h.isSemanticSuccess({ success: false, msgType: 'err' }), false);
  assert.equal(h.throwForHttpStatus ? true : false, true);
  assert.throws(() => h.throwForHttpStatus(404, 'x'), (e) => e.legacyCode === 'FAILED_PRECONDITION');
  assert.throws(() => h.throwForHttpStatus(503, 'x'), (e) => e.legacyCode === 'UNAVAILABLE');

  assert.equal(h.buildAttackLogPayload({}).method, 'query');
  const full = h.buildAttackLogPayload({ party_3rd_mask: [1], action_mask: [2], r_dip: '9.9.9.9', country: 1, province: 2, r_e_time: 't' });
  assert.deepEqual(full.party_3rd_mask, [1]);
  assert.equal(full.country, 1);
  assert.deepEqual(h.buildIntelQueryPayload({ page: 2, count: 50, source_id: 63 }), { page: 2, count: 50, source_id: 63 });
  assert.deepEqual(h.buildIntelDeletePayload({ id: 4 }), { id: 4, method: 'delete' });
  assert.deepEqual(h.toQueryResult({ msgType: 'success', data: { total: 3 } }, '{}').total, 3);
  assert.equal(h.toMutationResult({ success: true, id: 8 }, '{}').id, 8);
  assert.deepEqual(h.resolveCallContext({ request: { a: 1 } }).req, { a: 1 });
  assert.deepEqual(h.resolveCallContext({}).req, {});
});

test('fetch error fallback message', async () => {
  withFetch(async () => { throw {}; });
  await assert.rejects(() => _test.fetchRaw({ bindings: {}, limits: {} }, 'http://x', {}),
    (e) => e.legacyCode === 'UNAVAILABLE' && /fetch failed/.test(e.message));
  withFetch(async () => { const e = new Error('m'); e.cause = { message: 'deep' }; throw e; });
  await assert.rejects(() => _test.fetchRaw({ bindings: {}, limits: {} }, 'http://x', {}),
    (e) => /deep/.test(e.message));
});

test('defensive helper edge branches', () => {
  const h = _test;
  assert.equal(h.pickStringFrom(null, ['a']), '');
  assert.equal(h.pickStringFrom({ a: null, b: 'y' }, ['a', 'b']), 'y');
  assert.equal(h.pickInt({ a: '', b: '5' }, ['a', 'b'], 0), 5);
  assert.equal(h.pickBoolean(NaN), undefined);
  assert.deepEqual(h.sanitizeHeaders({ A: null }), { A: '' });
  assert.equal(h.isIPv4(undefined), false);
  assert.equal(h.isSemanticSuccess(null), false);
  assert.deepEqual(h.toQueryResult({}, '{}'), { success: false, msg_type: '', msg: '', total: 0, page: 0, count: 0, raw_json: '{}' });
  assert.equal(h.buildIntelAddPayload({ IP: '1.2.3.4', type: 2, severity: 3 }).ip, '1.2.3.4');
  const ipl = h.buildIPListPayload({ color: 1, dir: 1, comment_search: 'note', r_s_time: 's', r_e_time: 'e' });
  assert.equal(ipl.Comment_Search, 'note');
  assert.equal(ipl.r_s_time, 's');
  assert.equal(ipl.r_e_time, 'e');
});

test('camelCase meta is logged without error', async () => {
  const mock = await createMockServer();
  try {
    const ctx = buildCtx(mock, { meta: { instanceId: 'camelInst', requestId: 'camelReq' } });
    delete ctx.meta.instance_id;
    const out = await handlers[METHOD_QUERY_INTEL_FULL]({}, ctx);
    assert.equal(out.success, true);
  } finally {
    await mock.close();
  }
});

test('business failure with logout also failing still rejects with business error', async () => {
  withFetch(async (url) => {
    const u = String(url);
    if (u.endsWith('/login')) return fakeResponse(200, JSON.stringify({ success: true, token: { access_token: 't' } }));
    if (u.endsWith('/logout')) return fakeResponse(500, 'logout boom', false);
    return fakeResponse(200, JSON.stringify({ success: false, msgType: 'error', msg: '业务失败' }));
  });
  await assert.rejects(() => handlers[METHOD_DELETE_INTEL_FULL]({ id: 9 }, buildCtx({ host: 'https://k01:443', user: 'u', password: 'p' })),
    (e) => e.legacyCode === 'FAILED_PRECONDITION' && /业务失败/.test(e.message));
});
