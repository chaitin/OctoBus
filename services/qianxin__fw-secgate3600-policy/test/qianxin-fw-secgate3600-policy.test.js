import test from 'node:test';
import assert from 'node:assert/strict';

const PKG = 'QIANXIN_FW_SecGate3600_Policy.QIANXIN_FW_SecGate3600_Policy';
const LOGIN = `${PKG}/Login`;
const LIST = `${PKG}/ListSecPolicy`;
const SET = `${PKG}/SetSecPolicy`;
const MOVE = `${PKG}/MoveSecPolicyPriority`;
const LOGOUT = `${PKG}/Logout`;

const HOST = 'https://1.1.1.1:8080';

const makeRes = (status, bodyObj, setCookies = []) => ({
  status,
  async text() { return typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj); },
  headers: {
    getSetCookie: () => setCookies,
    get: (k) => (String(k).toLowerCase() === 'set-cookie' ? (setCookies[0] || null) : null),
    forEach: (cb) => { cb('application/json', 'content-type'); },
  },
});

let lastReq;
const setFetch = (impl) => {
  global.fetch = async (url, init) => {
    lastReq = { url, init, body: init?.body ? JSON.parse(init.body) : undefined };
    return impl(url, init);
  };
};

const ctx = (overrides = {}) => ({
  bindings: { host: HOST, user: 'admin', password: 'pw', ...overrides.bindings },
  meta: { instance_id: overrides.instance_id || 'inst-1' },
});

const loadMod = () => import('../src/qianxin-fw-secgate3600-policy.js');

const loginOk = makeRes(200, { success: true, result: { error_code: 'success', token: 'tok-1' } }, ['PHPSESSID=abc123; path=/']);
const restOk = (data, head = {}) => makeRes(200, { head: { error_code: 0, error_string: '执行成功', total: 1, ...head }, data });

async function doLogin(mod, c) {
  setFetch(() => loginOk);
  return mod.handlers[LOGIN]({}, c);
}

test('helpers: names, policies, moves, getSecPolicyEntry, toRestResponse', async () => {
  const { _test } = await loadMod();

  assert.deepEqual(_test.normalizeListNames({ names: ['a', '', null, ' b '] }), ['a', '', 'b']);
  assert.throws(() => _test.normalizeListNames({ names: ['x'.repeat(64)] }), /1-63 characters/);

  const entry = _test.buildGetSecPolicyEntry({ names: ['p1'], is_detail: true, page_index: 0, page_size: 0 });
  assert.equal(entry.head.module, 'sec_policy');
  assert.equal(entry.head.function, 'get_sec_policy');
  assert.equal(entry.head.page_index, 1);
  assert.equal(entry.head.page_size, 20);
  assert.deepEqual(entry.body.sec_policy, [{ name: 'p1', is_detail: true }]);
  const entryAll = _test.buildGetSecPolicyEntry({});
  assert.deepEqual(entryAll.body.sec_policy, [{ name: '', is_detail: false }]);

  assert.deepEqual(_test.normalizePolicies({ policies: [{ name: 'x', action: 'permit' }] }), [{ name: 'x', action: 'permit' }]);
  assert.throws(() => _test.normalizePolicies({ policies: [] }), /non-empty/);
  assert.throws(() => _test.normalizePolicies({ policies: ['s'] }), /must be an object/);
  assert.throws(() => _test.normalizePolicies({ policies: [{ desc: 'no name' }] }), /name is required/);

  assert.deepEqual(_test.normalizeMoves({ moves: [{ name: 'p', direct: 'top' }] }), [{ name: 'p', direct: 'top', dst_name: '' }]);
  assert.deepEqual(_test.normalizeMoves({ moves: [{ name: 'p', direct: 'before', dst_name: 'q' }] }), [{ name: 'p', direct: 'before', dst_name: 'q' }]);
  assert.throws(() => _test.normalizeMoves({ moves: [] }), /non-empty/);
  assert.throws(() => _test.normalizeMoves({ moves: [{ name: 'p', direct: 'sideways' }] }), /direct must be one of/);
  assert.throws(() => _test.normalizeMoves({ moves: [{ name: 'p', direct: 'after' }] }), /dst_name is required/);

  const mapped = _test.toRestResponse(200, '{}', { headers: { forEach() {}, getSetCookie: () => [] } }, { head: { error_code: 0, error_string: 'ok', total: 5 }, data: true });
  assert.equal(mapped.head.error_code, 0);
  assert.equal(mapped.head.message, 'ok');
  assert.equal(mapped.head.total, 5);
  assert.deepEqual(mapped.data, { boolValue: true });
});

test('Login caches session', async () => {
  const mod = await loadMod();
  mod._test.sessionCache.clear();
  const c = ctx();
  const res = await doLogin(mod, c);
  assert.equal(res.success, true);
  assert.equal(res.result.token, 'tok-1');
  assert.match(lastReq.url, /\/v1\.0\/login$/);
  assert.deepEqual(lastReq.body, { username: 'admin', password: 'pw' });
  const session = mod._test.getSession({ ...c, bindings: c.bindings }, HOST);
  assert.ok(session?.cookie?.includes('PHPSESSID=abc123'));
  assert.ok(session?.cookie?.includes('token=tok-1'));
});

test('ListSecPolicy builds get_sec_policy entry and maps response (needs session)', async () => {
  const mod = await loadMod();
  mod._test.sessionCache.clear();
  const c = ctx();
  await doLogin(mod, c);

  setFetch(() => restOk([{ name: '1', action: 'permit' }], { total: 1 }));
  const res = await mod.handlers[LIST]({ names: ['1'], is_detail: false }, c);
  assert.match(lastReq.url, /\/v1\.0\/rest\/$/);
  assert.equal(lastReq.init.headers.Cookie, 'PHPSESSID=abc123; token=tok-1');
  assert.deepEqual(lastReq.body, [{
    head: { module: 'sec_policy', function: 'get_sec_policy', page_index: 1, page_size: 20, language: 'CN' },
    body: { sec_policy: [{ name: '1', is_detail: false }] },
  }]);
  assert.equal(res.head.error_code, 0);
  assert.equal(res.head.total, 1);
  assert.equal(res.http_status, 200);
});

test('business method without session -> FAILED_PRECONDITION', async () => {
  const mod = await loadMod();
  mod._test.sessionCache.clear();
  setFetch(() => restOk(true));
  await assert.rejects(mod.handlers[LIST]({ names: [] }, ctx()), /FAILED_PRECONDITION.*call Login first/);
});

test('SetSecPolicy validates and builds set entry', async () => {
  const mod = await loadMod();
  mod._test.sessionCache.clear();
  const c = ctx();
  await doLogin(mod, c);

  setFetch(() => restOk(true));
  const policy = { name: '1', action: 'permit', state: 'enable', src_zone: 'any', dst_zone: 'any' };
  const res = await mod.handlers[SET]({ policies: [policy] }, c);
  assert.deepEqual(lastReq.body, [{ head: { module: 'sec_policy', function: 'set_sec_policy' }, body: { sec_policy: [policy] } }]);
  assert.deepEqual(res.data, { boolValue: true });

  await assert.rejects(mod.handlers[SET]({ policies: [{ desc: 'no name' }] }, c), /name is required/);
});

test('MoveSecPolicyPriority validates direct/dst_name and builds entry', async () => {
  const mod = await loadMod();
  mod._test.sessionCache.clear();
  const c = ctx();
  await doLogin(mod, c);

  setFetch(() => restOk(true));
  await mod.handlers[MOVE]({ moves: [{ name: '4', direct: 'before', dst_name: '2' }] }, c);
  assert.deepEqual(lastReq.body, [{ head: { module: 'sec_policy', function: 'set_move_sec_policy_pri' }, body: { sec_policy: [{ name: '4', direct: 'before', dst_name: '2' }] } }]);

  await assert.rejects(mod.handlers[MOVE]({ moves: [{ name: '4', direct: 'after' }] }, c), /dst_name is required/);
});

test('Logout clears session', async () => {
  const mod = await loadMod();
  mod._test.sessionCache.clear();
  const c = ctx();
  await doLogin(mod, c);
  assert.ok(mod._test.getSession(c, HOST));

  setFetch(() => makeRes(200, { head: { error_code: 0 } }));
  const res = await mod.handlers[LOGOUT]({}, c);
  assert.equal(res.http_status, 200);
  assert.equal(mod._test.getSession(c, HOST), undefined);
});

test('error mapping: missing host, network, non-json', async () => {
  const mod = await loadMod();
  mod._test.sessionCache.clear();

  await assert.rejects(mod.handlers[LIST]({}, ctx({ bindings: { host: '' } })), /host is required/);

  const c = ctx();
  await doLogin(mod, c);
  setFetch(() => { throw new Error('ECONNREFUSED'); });
  await assert.rejects(mod.handlers[LIST]({ names: [] }, c), /UNAVAILABLE.*ECONNREFUSED/);

  setFetch(() => makeRes(200, 'not-json{'));
  await assert.rejects(mod.handlers[SET]({ policies: [{ name: 'x' }] }, c), /UNKNOWN.*not valid JSON/);
});

test('infrastructure helpers cover edge branches', async () => {
  const { _test } = await loadMod();

  // parseAuthority: IPv6, no-colon, bad-port
  assert.deepEqual(_test.parseAuthority('[::1]:8080'), { hostPart: '[::1]', portPart: '8080' });
  assert.equal(_test.parseAuthority('host'), null);
  assert.equal(_test.parseAuthority('host:abc'), null);
  assert.equal(_test.parseAuthority('[::1]8080'), null);

  // normalizeBaseUrl: ipv6 ok, no-scheme, path-suffix rejected, trailing slash ok
  assert.equal(_test.normalizeBaseUrl('https://[::1]:8080'), 'https://[::1]:8080');
  assert.equal(_test.normalizeBaseUrl('http://1.1.1.1:8080/'), 'http://1.1.1.1:8080');
  assert.equal(_test.normalizeBaseUrl('http://1.1.1.1:8080/path'), '');
  assert.equal(_test.normalizeBaseUrl('1.1.1.1:8080'), '');
  assert.equal(_test.normalizeBaseUrl(''), '');

  // toValue: all branches
  assert.deepEqual(_test.toValue('s'), { stringValue: 's' });
  assert.deepEqual(_test.toValue(3), { numberValue: 3 });
  assert.deepEqual(_test.toValue(true), { boolValue: true });
  assert.equal(_test.toValue(null), null);
  assert.deepEqual(_test.toValue([1, null]), { listValue: { values: [{ numberValue: 1 }, { nullValue: 'NULL_VALUE' }] } });
  assert.deepEqual(_test.toValue({ a: 'b' }), { structValue: { fields: { a: { stringValue: 'b' } } } });

  // toBoolean / toInt64
  assert.equal(_test.toBoolean('yes'), true);
  assert.equal(_test.toBoolean('off'), false);
  assert.equal(_test.toBoolean(2), true);
  assert.equal(_test.toInt64('7'), 7);
  assert.equal(_test.toInt64('x', 5), 5);

  // buildTlsOptions
  assert.deepEqual(_test.buildTlsOptions({}), {});
  assert.equal(_test.buildTlsOptions({ skipTlsVerify: true }).skipTlsVerify, true);

  // getSetCookies: getSetCookie path, get fallback, none
  assert.deepEqual(_test.getSetCookies({ headers: { getSetCookie: () => ['a=1'] } }), ['a=1']);
  assert.deepEqual(_test.getSetCookies({ headers: { get: (k) => (k === 'set-cookie' ? 'b=2' : null) } }), ['b=2']);
  assert.deepEqual(_test.getSetCookies({ headers: {} }), []);

  // mergeCookieHeader
  assert.equal(_test.mergeCookieHeader(['PHPSESSID=x; path=/'], 'tok'), 'PHPSESSID=x; token=tok');
  assert.equal(_test.mergeCookieHeader([], ''), '');

  // validateLoginJson: invalid shapes
  assert.throws(() => _test.validateLoginJson({}), /login response schema is invalid/);
  assert.throws(() => _test.validateLoginJson({ success: true, result: {} }), /schema is invalid/);
  assert.throws(() => _test.validateLoginJson({ success: true, result: { error_code: 'success' } }), /schema is invalid/);

  // toLogoutResponse with undefined json
  const lo = _test.toLogoutResponse(200, '', { headers: { forEach() {}, getSetCookie: () => [] } }, undefined);
  assert.equal(lo.http_status, 200);
});

test('Login failure does not cache a session', async () => {
  const mod = await loadMod();
  mod._test.sessionCache.clear();
  const c = ctx();
  setFetch(() => makeRes(200, { success: false, result: { error_code: 'auth_failed' } }));
  const res = await mod.handlers[LOGIN]({}, c);
  assert.equal(res.success, false);
  assert.equal(mod._test.getSession(c, HOST), undefined);
});

test('skipTlsVerify + IPv6 host flow through to fetch init', async () => {
  const mod = await loadMod();
  mod._test.sessionCache.clear();
  const c = { bindings: { host: 'https://[::1]:8443', user: 'u', password: 'p', skipTlsVerify: true }, meta: { instance_id: 'inst-tls' } };
  setFetch(() => loginOk);
  await mod.handlers[LOGIN]({}, c);
  assert.equal(lastReq.init.skipTlsVerify, true);
  assert.match(lastReq.url, /^https:\/\/\[::1\]:8443\/v1\.0\/login$/);
});

test('paging > 0, credential sources, and 401 clears session', async () => {
  const mod = await loadMod();
  mod._test.sessionCache.clear();

  // login username/password from request override bindings
  const c = { bindings: { host: HOST }, meta: { instance_id: 'inst-cred' } };
  setFetch(() => loginOk);
  await mod.handlers[LOGIN]({ username: 'reqU', password: 'reqP' }, c);
  assert.deepEqual(lastReq.body, { username: 'reqU', password: 'reqP' });
  const sess = mod._test.getSession(c, HOST);
  assert.equal(sess.username, 'reqU');

  // ListSecPolicy with explicit paging > 0
  setFetch(() => restOk([], { total: 0 }));
  await mod.handlers[LIST]({ page_index: 3, page_size: 50 }, c);
  assert.equal(lastReq.body[0].head.page_index, 3);
  assert.equal(lastReq.body[0].head.page_size, 50);

  // rest 401 clears the session
  setFetch(() => makeRes(401, { head: { error_code: 1, error_string: 'expired' } }));
  const res = await mod.handlers[SET]({ policies: [{ name: 'x' }] }, c);
  assert.equal(res.http_status, 401);
  assert.equal(mod._test.getSession(c, HOST), undefined);

  // logout username resolved from session (re-login first)
  setFetch(() => loginOk);
  await mod.handlers[LOGIN]({}, { bindings: { host: HOST, user: 'sessU', password: 'p' }, meta: { instance_id: 'inst-cred' } });
  setFetch(() => makeRes(200, { head: { error_code: 0 } }));
  await mod.handlers[LOGOUT]({}, { bindings: { host: HOST }, meta: { instance_id: 'inst-cred' } });
  assert.equal(lastReq.body.username, 'sessU');
});

test('logout empty-body branches and toValue fallback', async () => {
  const mod = await loadMod();
  const { _test } = mod;

  // toValue fallback for non-JSON primitive (symbol)
  assert.deepEqual(_test.toValue(Symbol.for('s')), { stringValue: 'Symbol(s)' });

  // logout with empty 2xx body -> ok response
  mod._test.sessionCache.clear();
  const c = ctx({ instance_id: 'inst-lo' });
  setFetch(() => loginOk);
  await mod.handlers[LOGIN]({}, c);
  setFetch(() => makeRes(204, ''));
  const ok = await mod.handlers[LOGOUT]({}, c);
  assert.equal(ok.http_status, 204);

  // logout with empty non-2xx body -> UNKNOWN
  setFetch(() => loginOk);
  await mod.handlers[LOGIN]({}, c);
  setFetch(() => makeRes(500, ''));
  await assert.rejects(mod.handlers[LOGOUT]({}, c), /UNKNOWN.*response body is empty/);
});

test('rpcdef exposes all five method paths', async () => {
  const mod = await loadMod();
  const def = mod.rpcdef(ctx());
  for (const p of ['Login', 'ListSecPolicy', 'SetSecPolicy', 'MoveSecPolicyPriority', 'Logout']) {
    assert.equal(typeof def[`/${PKG}/${p}`], 'function', `${p} present`);
  }
});
