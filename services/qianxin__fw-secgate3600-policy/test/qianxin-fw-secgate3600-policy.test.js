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

test('403 response clears session', async () => {
  const mod = await loadMod();
  mod._test.sessionCache.clear();
  const c = ctx({ instance_id: 'inst-403' });
  setFetch(() => loginOk);
  await mod.handlers[LOGIN]({}, c);
  assert.ok(mod._test.getSession(c, HOST));

  setFetch(() => makeRes(403, { head: { error_code: 1, error_string: 'forbidden' } }));
  const res = await mod.handlers[LIST]({ names: [] }, c);
  assert.equal(res.http_status, 403);
  assert.equal(mod._test.getSession(c, HOST), undefined);
});

test('mergedBindings merges config and secret into bindings', async () => {
  const mod = await loadMod();
  mod._test.sessionCache.clear();
  const c = {
    config: { host: HOST, timeoutMs: 2000 },
    secret: { user: 'cfgUser', password: 'cfgPass' },
    meta: { instance_id: 'inst-merge' },
  };
  setFetch(() => loginOk);
  const res = await mod.handlers[LOGIN]({}, c);
  assert.equal(res.success, true);
  assert.deepEqual(lastReq.body, { username: 'cfgUser', password: 'cfgPass' });
});

test('getInstanceKey falls back to instanceId (camelCase) and "default"', async () => {
  const { _test } = await loadMod();
  assert.equal(_test.getInstanceKey({ meta: { instanceId: 'camel-id' } }), 'camel-id');
  assert.equal(_test.getInstanceKey({ meta: {} }), 'default');
  assert.equal(_test.getInstanceKey({}), 'default');
});

test('resolveCallContext ctx.request fallback and extra binding paths', async () => {
  const mod = await loadMod();
  mod._test.sessionCache.clear();
  setFetch(() => loginOk);
  // rpcdef path uses ctx.req when req param is null
  const def = mod.rpcdef({ bindings: { host: HOST, user: 'u', password: 'p' }, meta: { instance_id: 'inst-rpcdef2' } });
  await def[`/${PKG}/Login`](null);
  assert.match(lastReq.url, /\/v1\.0\/login$/);

  // rest_base_url and base_url binding fallbacks
  mod._test.sessionCache.clear();
  setFetch(() => loginOk);
  await mod.handlers[LOGIN]({}, { bindings: { rest_base_url: HOST, user: 'u', password: 'p' }, meta: { instance_id: 'inst-rbu' } });
  assert.match(lastReq.url, /\/v1\.0\/login$/);

  mod._test.sessionCache.clear();
  setFetch(() => loginOk);
  await mod.handlers[LOGIN]({}, { bindings: { base_url: HOST, user: 'u', password: 'p' }, meta: { instance_id: 'inst-bu2' } });
  assert.match(lastReq.url, /\/v1\.0\/login$/);
});

test('resolveLoginUsername username binding and resolveTimeoutMs edge cases', async () => {
  const { _test } = await loadMod();

  // resolveLoginUsername uses ctx.bindings.username (vs .user)
  const mod = await loadMod();
  mod._test.sessionCache.clear();
  setFetch(() => loginOk);
  await mod.handlers[LOGIN]({}, { bindings: { host: HOST, username: 'usernameField', password: 'p' }, meta: { instance_id: 'inst-uname' } });
  assert.deepEqual(lastReq.body, { username: 'usernameField', password: 'p' });

  // buildHeaders with custom headers
  const headers = _test.buildHeaders({ bindings: { headers: { 'X-Custom': 'val' } } }, { 'Content-Type': 'application/json' });
  assert.equal(headers['X-Custom'], 'val');
  assert.equal(headers['Content-Type'], 'application/json');
});

test('toValue with null inside object and array', async () => {
  const { _test } = await loadMod();
  // null inside object
  const objResult = _test.toValue({ a: null });
  assert.deepEqual(objResult.structValue.fields.a, { nullValue: 'NULL_VALUE' });
  // undefined value in object (toValue(undefined) === null, so ?? nullValue)
  const obj2 = _test.toValue({ b: undefined });
  assert.deepEqual(obj2.structValue.fields.b, { nullValue: 'NULL_VALUE' });
  // unwrapScalar unwraps {value: 'hello'} -> 'hello' -> stringValue
  const wrapped = _test.toValue({ value: 'hello' });
  assert.deepEqual(wrapped, { stringValue: 'hello' });
});

test('getSetCookies edge cases and extractHeaders edge keys', async () => {
  const { _test } = await loadMod();

  // getSetCookies: getSetCookie returns non-array → []
  assert.deepEqual(_test.getSetCookies({ headers: { getSetCookie: () => 'not-array' } }), []);

  // getSetCookies: get returns null (combined is falsy) → []
  assert.deepEqual(_test.getSetCookies({ headers: { get: () => null } }), []);

  // extractHeaders: empty key skipped, duplicate key merged
  const res = {
    headers: {
      forEach: (cb) => {
        cb('val1', 'X-Multi');
        cb('val2', 'X-Multi');
        cb('ignored', '');  // empty key
      },
      getSetCookie: () => [],
    },
  };
  const hdrs = _test.extractHeaders(res);
  const multi = hdrs.find((h) => h.key === 'x-multi');
  assert.deepEqual(multi?.values, ['val1', 'val2']);
  assert.ok(!hdrs.find((h) => h.key === ''));

  // mergeCookieHeader: item that is empty string
  assert.equal(_test.mergeCookieHeader(['', 'k=v'], ''), 'k=v');
  // mergeCookieHeader: item with no '='
  assert.equal(_test.mergeCookieHeader(['noequals'], ''), '');
  // mergeCookieHeader: item with '=' at position 0
  assert.equal(_test.mergeCookieHeader(['=val'], ''), '');
});

test('toRestResponse body fallback and login error_code not success', async () => {
  const { _test } = await loadMod();

  // toRestResponse: json.body fallback when json.data is undefined
  const r = _test.toRestResponse(200, '{}',
    { headers: { forEach() {}, getSetCookie: () => [] } },
    { head: { error_code: 0, error_string: 'ok', total: 0 }, body: 'fallback' }
  );
  assert.deepEqual(r.data, { stringValue: 'fallback' });

  // handleLogin: success=true but error_code !== 'success' → no caching
  const mod = await loadMod();
  mod._test.sessionCache.clear();
  setFetch(() => makeRes(200, { success: true, result: { error_code: 'warn', token: 'tok-warn' } }, ['PHPSESSID=x']));
  const res2 = await mod.handlers[LOGIN]({}, ctx({ instance_id: 'inst-ec2' }));
  assert.equal(res2.success, true);
  // error_code !== 'success' so session should NOT be cached
  assert.equal(mod._test.getSession({ meta: { instance_id: 'inst-ec2' } }, HOST), undefined);
});

test('resolveTimeoutMs with timeout_ms key and invalid value', async () => {
  const mod = await loadMod();
  mod._test.sessionCache.clear();
  // timeout_ms binding (underscore form)
  const c = { bindings: { host: HOST, user: 'u', password: 'p', timeout_ms: 4000 }, meta: { instance_id: 'inst-tms' } };
  setFetch((url, init) => { lastReq = { url, init }; return loginOk; });
  await mod.handlers[LOGIN]({}, c);
  assert.equal(lastReq.init.timeoutMs, 4000);

  // invalid timeout falls back to default
  const c2 = { bindings: { host: HOST, user: 'u', password: 'p', timeoutMs: -1 }, meta: { instance_id: 'inst-bad-tms' } };
  mod._test.sessionCache.clear();
  setFetch((url, init) => { lastReq = { url, init }; return loginOk; });
  await mod.handlers[LOGIN]({}, c2);
  assert.equal(lastReq.init.timeoutMs, 5000);
});

test('toBoolean: false/0/unknown-string branches and normalizeListNames wrapped null', async () => {
  const { _test } = await loadMod();

  // boolean false
  assert.equal(_test.toBoolean(false), false);
  // number 0
  assert.equal(_test.toBoolean(0), false);
  // string not in either list → false
  assert.equal(_test.toBoolean('maybe'), false);

  // normalizeListNames with wrapped-null item: {value: null} → unwraps to null → ''
  const names = _test.normalizeListNames({ names: [{ value: null }, 'ok'] });
  assert.deepEqual(names, ['', 'ok']);
});

test('fetchUpstream: error with cause.message and requireJsonBody when empty', async () => {
  const { _test } = await loadMod();

  // fetchUpstream: err.cause.message used when present
  global.fetch = async () => { const e = new Error('outer'); e.cause = new Error('inner cause'); throw e; };
  await assert.rejects(_test.fetchUpstream({ bindings: {}, limits: {}, meta: {} }, 'http://1.1.1.1:8080/test'),
    /UNAVAILABLE.*inner cause/);

  // requireJsonBody with empty string
  assert.throws(() => _test.requireJsonBody(''), /UNKNOWN.*response body is empty/);
  assert.throws(() => _test.requireJsonBody(undefined), /UNKNOWN.*response body is empty/);
});

test('extractHeaders without forEach and toLoginResponse with non-object result', async () => {
  const { _test } = await loadMod();

  // extractHeaders when headers.forEach is not a function
  const r1 = _test.extractHeaders({ headers: { foo: 'bar' } }); // no forEach, no get
  assert.deepEqual(r1, []);

  // toLoginResponse when json.result is not an object
  const lr = _test.toLoginResponse(200, '{}', { headers: { forEach() {}, getSetCookie: () => [] } }, { success: false, result: null });
  assert.equal(lr.success, false);
  assert.equal(lr.result.error_code, '');
});

test('buildTlsOptions: tlsInsecureSkipVerify and insecureSkipVerify also trigger', async () => {
  const { _test } = await loadMod();
  assert.equal(_test.buildTlsOptions({ tlsInsecureSkipVerify: true }).skipTlsVerify, true);
  assert.equal(_test.buildTlsOptions({ insecureSkipVerify: true }).skipTlsVerify, true);
});

test('requireHost: binding fallbacks restBaseUrl and baseUrl', async () => {
  const mod = await loadMod();
  mod._test.sessionCache.clear();

  setFetch(() => loginOk);
  await mod.handlers[LOGIN]({}, { bindings: { restBaseUrl: HOST, user: 'u', password: 'p' }, meta: { instance_id: 'inst-rb' } });
  assert.match(lastReq.url, /\/v1\.0\/login$/);

  setFetch(() => loginOk);
  await mod.handlers[LOGIN]({}, { bindings: { baseUrl: HOST, user: 'u', password: 'p' }, meta: { instance_id: 'inst-bu' } });
  assert.match(lastReq.url, /\/v1\.0\/login$/);
});

test('resolveCallContext: ctx.req fallback and limits.timeoutMs', async () => {
  const mod = await loadMod();
  mod._test.sessionCache.clear();
  const c = {
    bindings: { host: HOST, user: 'u', password: 'p' },
    limits: { timeoutMs: 3000 },
    meta: { instance_id: 'inst-limits' },
  };
  setFetch((url, init) => { lastReq = { url, init }; return loginOk; });
  await mod.handlers[LOGIN]({}, c);
  assert.equal(lastReq.init.timeoutMs, 3000);
});
