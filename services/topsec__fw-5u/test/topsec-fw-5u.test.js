import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_ADD_FULL,
  METHOD_ADD_PATH,
  METHOD_LOGIN_FULL,
  METHOD_LOGIN_PATH,
  METHOD_LOGOUT_FULL,
  METHOD_LOGOUT_PATH,
  METHOD_REFRESH_FULL,
  METHOD_REFRESH_PATH,
  METHOD_REMOVE_FULL,
  METHOD_REMOVE_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/topsec-fw-5u.js';
import { service } from '../src/service.js';
import { PASSWORD, createMockServer, decryptQuotedCipher, encodeTokenPayload } from './mock_upstream.js';

const originalFetch = globalThis.fetch;

const buildCtx = (overrides = {}) => ({
  serviceId: 'topsec__fw-5u',
  instanceId: 'inst-1',
  config: {
    host: 'https://topsec5u.example.com:443',
    user: 'admin',
    timeoutMs: 5000,
    headers: { 'x-env': 'test' },
    ...(overrides.config || {}),
  },
  secret: {
    password: PASSWORD,
    ...(overrides.secret || {}),
  },
  metadata: { request_id: 'req-1', ...(overrides.metadata || {}) },
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
const parseErrorMessage = (err) => JSON.parse(err.message);

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
  checker(caught, parseErrorMessage(caught));
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  _test.sessionCache.clear();
});

test('service exports single-argument SDK handlers and rpcdef path handlers', () => {
  assert.equal(typeof service, 'object');
  for (const method of [METHOD_LOGIN_FULL, METHOD_REFRESH_FULL, METHOD_ADD_FULL, METHOD_REMOVE_FULL, METHOD_LOGOUT_FULL]) {
    assert.equal(typeof handlers[method], 'function');
    assert.equal(handlers[method].length, 0);
  }
  const defs = rpcdef(buildCtx());
  for (const path of [METHOD_LOGIN_PATH, METHOD_REFRESH_PATH, METHOD_ADD_PATH, METHOD_REMOVE_PATH, METHOD_LOGOUT_PATH]) {
    assert.equal(typeof defs[path], 'function');
  }
});

test('Login uses ctx.secret password, ignores request password, and sanitizes response', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init, form: parseForm(init.body) };
    return responseOf(200, encodeTokenPayload('8c7fd52e6dd44b89', {
      result: true,
      data: { authid: '6b3f5c7e98bb4c428d2ac2341775d2f1', message: 'login success' },
    }), { 'set-cookie': ['PHPSESSID=abc; Path=/', 'username=admin; Path=/'] });
  });

  const res = await callHandler(METHOD_LOGIN_FULL, { password: 'request-secret' }, buildCtx({ config: { skipTlsVerify: true } }));

  assert.equal(captured.url, 'https://topsec5u.example.com:443/home/login/');
  assert.equal(captured.form.name, 'admin');
  assert.equal(decryptQuotedCipher(captured.form.password), PASSWORD);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.init.dispatcher, _test.insecureTlsDispatcher);
  assert.equal(captured.init.tlsInsecureSkipVerify, undefined);
  assert.equal(captured.init.headers['x-env'], 'test');
  assert.deepEqual(res, { success: true, message: 'login success', http_status: 200 });
  assert.equal(Object.hasOwn(res, 'session'), false);
  assert.equal(Object.hasOwn(res, 'raw_body'), false);
  assert.equal(Object.hasOwn(res, 'raw_json'), false);
});

test('AddToBlacklist logs in internally, ignores request session, and returns no token or cookie', async () => {
  const seen = [];
  setFetch(async (url, init) => {
    seen.push({ url: String(url), init, form: parseForm(init.body) });
    if (String(url).endsWith('/home/login/')) {
      return responseOf(200, encodeTokenPayload('toktoktoktoktok1', {
        result: true,
        data: { authid: 'mark-1', message: 'login success' },
      }), { 'set-cookie': ['PHPSESSID=toktoktoktoktok1; Path=/'] });
    }
    return responseOf(200, encodeTokenPayload('1c2ad06f5e634bc7', { result: false, data: '黑名单条目已存在' }));
  });

  const res = await callHandler(METHOD_ADD_FULL, {
    session: { host: 'https://evil.example:443', token: 'request-token', user_mark: 'request-mark', cookie: 'request-cookie' },
    ip: '203.0.113.10',
  });

  assert.equal(seen.length, 2);
  assert.equal(seen[1].url, 'https://topsec5u.example.com:443/home/default/blackListSpread/addTuple/?userMark=mark-1');
  assert.equal(seen[1].form.token, 'toktoktoktoktok1');
  assert.equal(res.success, true);
  assert.equal(res.idempotent_success, true);
  assert.equal(JSON.stringify(res).includes('toktok'), false);
  assert.equal(JSON.stringify(res).includes('PHPSESSID'), false);
});

test('mock upstream supports cached add remove logout without public sessions', async () => {
  const mock = createMockServer();
  const host = await mock.start();
  const ctx = buildCtx({ config: { host, allow_http: true } });
  try {
    const add = await callHandler(METHOD_ADD_FULL, { ip: '198.51.100.10' }, ctx);
    assert.equal(add.success, true);
    const addAgain = await callHandler(METHOD_ADD_FULL, { ip: '198.51.100.10' }, ctx);
    assert.equal(addAgain.idempotent_success, true);
    const remove = await callHandler(METHOD_REMOVE_FULL, { ip: '198.51.100.10' }, ctx);
    assert.equal(remove.success, true);
    const logout = await callHandler(METHOD_LOGOUT_FULL, {}, ctx);
    assert.equal(logout.success, true);
    assert.equal(mock.requests.length, 5);
  } finally {
    await mock.close();
  }
});

test('errors are sanitized and missing password is unauthenticated', async () => {
  setFetch(async () => responseOf(403, 'permission denied with token=secret-token'));
  await expectGrpcError(() => callHandler(METHOD_REFRESH_FULL), 'PERMISSION_DENIED', (_err, parsed) => {
    assert.equal(parsed.http_status, 403);
    assert.equal(Object.hasOwn(parsed, 'raw_body'), false);
    assert.equal(JSON.stringify(parsed).includes('secret-token'), false);
  });

  await expectGrpcError(() => callHandler(METHOD_LOGIN_FULL, {}, buildCtx({ secret: { password: '' } })), 'UNAUTHENTICATED');
});

test('helper functions cover parsing, cookies, cache, status, and crypto branches', () => {
  assert.equal(_test.pickString(undefined, { value: ' demo ' }), 'demo');
  assert.equal(_test.pickBoolean('yes'), true);
  assert.equal(_test.isObject({}), true);
  assert.equal(_test.base64Decode(_test.base64Encode(Buffer.from('abc'))), 'abc');
  assert.equal(_test.decodeTopSecBody(JSON.stringify({ result: true })).decoded.result, true);
  assert.equal(_test.extractTokenFromDecoded({ data: { tokens: ['tok'] } }), 'tok');
  assert.equal(_test.resolveDecodedMessage({ data: { msg: 'nested' } }), 'nested');
  assert.equal(_test.normalizeBaseUrl('fw.example.com:443', false), 'https://fw.example.com:443');
  assert.equal(_test.isValidIP('2001:db8::1'), true);
  assert.equal(_test.resolveTimeoutMs(buildCtx({ limits: { timeoutMs: '12' } })), 12);
  assert.equal(_test.gatherCookies({ raw: () => ({ 'set-cookie': ['a=1; Path=/', 'b=2; Path=/'] }) }), 'a=1; b=2');
  assert.equal(_test.mapHttpStatusToCode(401), 'PERMISSION_DENIED');
  assert.equal(_test.buildSessionContext({ host: 'h', token: 't', user_mark: 'u', cookie: 'c' }, { token: 't2' }).token, 't2');
  assert.throws(() => _test.requireIp('bad'), /INVALID_ARGUMENT/);
  assert.throws(() => _test.parseSuccessfulPayload(200, ''), /UNKNOWN/);
  assert.equal(_test.interpretLogin(200, '{}', { result: true, data: { authid: 'u' }, tokens: ['tok'] }, '', { host: 'h', token: '', user_mark: '', cookie: 'c' }).session.token, 'tok');
  const cipher = crypto.createDecipheriv('aes-128-cbc', Buffer.from('1111111111111111'), Buffer.from('1111111111111111'));
  cipher.setAutoPadding(false);
  const encrypted = _test.encryptPassword('secret').replace(/^'/, '').replace(/'$/, '');
  assert.equal(Buffer.concat([cipher.update(Buffer.from(encrypted, 'base64')), cipher.final()]).toString('utf8').replace(/\u0000+$/g, ''), 'secret');
  assert.equal(_test.cacheIdentity(buildCtx(), 'https://h:443', 'admin'), JSON.stringify(['topsec__fw-5u', 'inst-1', 'https://h:443', 'admin']));
});
