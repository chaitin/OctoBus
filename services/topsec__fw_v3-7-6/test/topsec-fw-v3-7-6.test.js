import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  ADD_HTTP_PATH,
  DELETE_HTTP_PATH,
  METHOD_ADD_FULL,
  METHOD_ADD_PATH,
  METHOD_DELETE_FULL,
  METHOD_DELETE_PATH,
  METHOD_LOGIN_FULL,
  METHOD_LOGIN_PATH,
  METHOD_LOGOUT_FULL,
  METHOD_LOGOUT_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/topsec-fw-v3-7-6.js';
import { service } from '../src/service.js';
import { AES_IV_HEX, AES_KEY_HEX, PASSWORD, createMockServer, decryptAesZeroPadHex } from './mock_upstream.js';

const originalFetch = globalThis.fetch;

const buildCtx = (overrides = {}) => ({
  serviceId: 'topsec__fw_v3-7-6',
  instanceId: 'inst',
  config: {
    host: 'https://topsec.example.com',
    user: 'admin',
    memo: 'Block IP',
    headers: { 'x-env': 'test' },
    ...(overrides.config || {}),
  },
  secret: {
    password: PASSWORD,
    aesKey: AES_KEY_HEX,
    aesIv: AES_IV_HEX,
    ...(overrides.secret || {}),
  },
  metadata: { request_id: 'req', ...(overrides.metadata || {}) },
  limits: { timeoutMs: 5000, ...(overrides.limits || {}) },
});

const callHandler = (method, request = {}, ctx = buildCtx()) => handlers[method]({ ...ctx, request });

const responseOf = (status, body, headers = {}) => ({
  status,
  headers: {
    get(name) {
      return headers[String(name).toLowerCase()] || null;
    },
    getSetCookie() {
      return Array.isArray(headers['set-cookie']) ? headers['set-cookie'] : [];
    },
  },
  text: async () => String(body),
});

const setFetch = (impl) => {
  globalThis.fetch = impl;
};

const parseForm = (body) => Object.fromEntries(new URLSearchParams(String(body || '')).entries());

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
  _test.sessionCache.clear();
});

test('service exports single-argument SDK handlers and rpcdef path handlers', () => {
  assert.equal(typeof service, 'object');
  for (const method of [METHOD_LOGIN_FULL, METHOD_ADD_FULL, METHOD_DELETE_FULL, METHOD_LOGOUT_FULL]) {
    assert.equal(typeof handlers[method], 'function');
    assert.equal(handlers[method].length, 0);
  }
  const defs = rpcdef(buildCtx());
  for (const path of [METHOD_LOGIN_PATH, METHOD_ADD_PATH, METHOD_DELETE_PATH, METHOD_LOGOUT_PATH]) {
    assert.equal(typeof defs[path], 'function');
  }
});

test('Login uses password and AES material from ctx.secret and sanitizes response', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init, form: parseForm(init.body) };
    return responseOf(200, JSON.stringify({
      result: true,
      msg: 'login success',
      secret: 'sec-token',
      tokens: ['token-1'],
      data: { authid: 'mark-1', tokens: ['token-1'], secret: 'sec-token' },
    }), { 'set-cookie': ['session=abc; Path=/; HttpOnly'] });
  });

  const res = await callHandler(METHOD_LOGIN_FULL, {
    password: 'request-password',
    aes_key: '00000000000000000000000000000000',
    aes_iv: '00000000000000000000000000000000',
  }, buildCtx({ config: { aesKey: 'bad-config-key', aesIv: 'bad-config-iv', skipTlsVerify: true } }));

  assert.equal(captured.url, 'https://topsec.example.com/home/restLogin/');
  assert.equal(captured.form.name, 'admin');
  assert.equal(decryptAesZeroPadHex(captured.form.password), PASSWORD);
  assert.equal(decryptAesZeroPadHex(captured.form.ngtosAuth), String(PASSWORD.length));
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.init.dispatcher, _test.insecureTlsDispatcher);
  assert.equal(captured.init.tlsInsecureSkipVerify, undefined);
  assert.deepEqual(res, { success: true, message: 'login success' });
  assert.equal(Object.hasOwn(res, 'session'), false);
  assert.equal(Object.hasOwn(res, 'raw'), false);
});

test('AddBlacklistIP logs in internally, ignores request session, signs command, and returns sanitized result', async () => {
  const seen = [];
  setFetch(async (url, init) => {
    seen.push({ url: String(url), init, form: parseForm(init.body) });
    if (String(url).endsWith('/home/restLogin/')) {
      return responseOf(200, JSON.stringify({
        result: true,
        msg: 'login success',
        secret: 'sec-value',
        tokens: ['tok-initial'],
        data: { authid: 'mark-xyz', secret: 'sec-value', tokens: ['tok-initial'] },
      }), { 'set-cookie': ['session=abc; Path=/; HttpOnly'] });
    }
    return responseOf(200, `?rotated-token${Buffer.from(JSON.stringify({
      result: true,
      msg: 'ok',
      data: { success_ips: ['1.1.1.1'], fail_ips: [{ ip: '2.2.2.2', reason: 'already exists', code: 'E_DUP' }] },
    })).toString('base64')}`);
  });

  const res = await callHandler(METHOD_ADD_FULL, {
    session: { token: 'request-token', secret: 'request-secret', user_mark: 'request-mark', cookie: 'request-cookie' },
    ip_addresses: ['1.1.1.1', '2.2.2.2'],
  });

  const addUrl = new URL(seen[1].url);
  const expectedCodeRun = crypto.createHash('md5').update(`sec-valuetok-initial${ADD_HTTP_PATH}${seen[1].form.commands}`).digest('hex');
  assert.equal(addUrl.pathname, ADD_HTTP_PATH);
  assert.equal(addUrl.searchParams.get('token'), 'tok-initial');
  assert.equal(addUrl.searchParams.get('codeRun'), expectedCodeRun);
  assert.equal(seen[1].init.headers.Cookie, 'session=abc');
  assert.deepEqual(res.succeeded_ips.sort(), ['1.1.1.1', '2.2.2.2']);
  assert.equal(res.failures.length, 0);
  assert.equal(JSON.stringify(res).includes('tok-initial'), false);
  assert.equal(JSON.stringify(res).includes('session=abc'), false);
});

test('mock upstream supports cached add delete logout without public sessions', async () => {
  const mock = createMockServer();
  const host = await mock.start();
  const ctx = buildCtx({ config: { host, allow_http: true } });
  try {
    const add = await callHandler(METHOD_ADD_FULL, { ip_addresses: ['198.51.100.10'] }, ctx);
    assert.deepEqual(add.succeeded_ips, ['198.51.100.10']);
    const del = await callHandler(METHOD_DELETE_FULL, { ip_addresses: ['198.51.100.10'] }, ctx);
    assert.deepEqual(del.succeeded_ips, ['198.51.100.10']);
    const logout = await callHandler(METHOD_LOGOUT_FULL, {}, ctx);
    assert.equal(logout.success, true);
    assert.equal(mock.requests.length, 4);
  } finally {
    await mock.close();
  }
});

test('errors are sanitized and missing AES material is unauthenticated', async () => {
  setFetch(async () => responseOf(403, 'forbidden token=secret-token'));
  await expectGrpcError(() => callHandler(METHOD_ADD_FULL, { ip_addresses: ['1.1.1.1'] }), 'PERMISSION_DENIED', (err) => {
    assert.equal(err.message.includes('secret-token'), false);
  });

  await expectGrpcError(() => callHandler(METHOD_LOGIN_FULL, {}, buildCtx({ secret: { aesKey: '', aesIv: AES_IV_HEX } })), 'UNAUTHENTICATED');
});

test('helper functions cover parsing, crypto, cache, status, and outcome branches', () => {
  assert.equal(_test.grpcCodeFor('missing'), grpcStatus.UNKNOWN);
  assert.equal(_test.unwrapScalar({ value: { value: 7 } }), 7);
  assert.equal(_test.pickString({ value: 'x' }), 'x');
  assert.equal(_test.pickFirstString([undefined, ' y ']), 'y');
  assert.equal(_test.pickBoolean('on'), true);
  assert.deepEqual(_test.toArray({ values: ['a'] }), ['a']);
  assert.equal(_test.normalizeBaseUrl('topsec.example.com/', false), 'https://topsec.example.com');
  assert.equal(_test.resolveBaseUrl({ allowHttp: true }, { restBaseUrl: 'http://rest.example' }), 'http://rest.example');
  assert.equal(_test.resolveTimeoutMs(_test.resolveCallContext(buildCtx({ config: { timeoutMs: '7.9' }, limits: { timeoutMs: -1 } }))), 7);
  assert.equal(_test.resolveSkipTlsVerify({ skip_tls_verify: true }, {}), true);
  assert.deepEqual(_test.buildEngineHeaders({}, { instanceId: 'inst2', requestId: 'req2' }), { 'x-engine-instance': 'inst2', 'x-request-id': 'req2' });
  assert.equal(_test.parseKeyString(Buffer.from(AES_KEY_HEX, 'hex').toString('base64')).length, 16);
  assert.equal(_test.ensureAesKey({}, { aesKey: AES_KEY_HEX }).length, 16);
  assert.equal(_test.ensureAesIv({}, { aesIv: AES_IV_HEX }).length, 16);
  assert.throws(() => _test.ensureAesKey({ aes_key: AES_KEY_HEX }, {}), /UNAUTHENTICATED/);
  assert.match(_test.encryptAesCbcZeroPad('abc', Buffer.from(AES_KEY_HEX, 'hex'), Buffer.from(AES_IV_HEX, 'hex'), 'base64'), /^[A-Za-z0-9+/=]+$/);
  assert.equal(_test.md5Hex('abc'), crypto.createHash('md5').update('abc').digest('hex'));
  assert.equal(_test.buildUrlWithQuery('https://h/p', [['a', 'b'], ['c', null]]), 'https://h/p?a=b');
  assert.equal(_test.decodeBase64Json(Buffer.from(JSON.stringify({ ok: true })).toString('base64')).json.ok, true);
  assert.throws(() => _test.parseTopSecPayload('bad'), /UNKNOWN/);
  assert.throws(() => _test.ensureLoginSuccess({ result: false, msg: 'no' }), /PERMISSION_DENIED/);
  assert.equal(_test.buildSession({ token: 't', secret: 's', userMark: 'u', raw: null }, 'cookie').cookie, 'cookie');
  assert.equal(_test.stringifyCommands([{ a: 1 }]), '[{\"a\":1}]');
  assert.deepEqual(_test.ensureIpList({ addresses: { values: ['1.1.1.1'] } }), ['1.1.1.1']);
  assert.deepEqual(_test.interpretOperationPayload({ result: false, msg: 'already exists' }, ['1.1.1.1'], 'AddBlacklistIP').succeeded_ips, ['1.1.1.1']);
  assert.deepEqual(_test.interpretOperationPayload({ result: false, message: 'not found' }, ['1.1.1.1'], 'DeleteBlacklistIP').succeeded_ips, ['1.1.1.1']);
  assert.equal(_test.cacheIdentity(buildCtx(), 'https://h', 'admin'), JSON.stringify(['topsec__fw_v3-7-6', 'inst', 'https://h', 'admin']));
  assert.equal(DELETE_HTTP_PATH, '/home/default/blackListSpread/deleteLots/');
});
