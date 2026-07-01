import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_FORBID_FULL,
  METHOD_FORBID_PATH,
  METHOD_UNFORBID_FULL,
  METHOD_UNFORBID_PATH,
  OPERATION,
  OUTCOME,
  _test,
  handlers,
  rpcdef,
} from '../src/wangsu-label-ip.js';
import { service } from '../src/service.js';
import { API_KEY, DATE_HEADER, LABEL_CODE, USER, createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;

const baseBindings = {
  baseUrl: 'https://open.example.com/api/spider/label-ip-forbid/operate',
  user: USER,
  apiKey: API_KEY,
  labelCode: LABEL_CODE,
  defaultForbidMinutes: 60,
  overrideDateHeader: DATE_HEADER,
  headers: { 'X-Custom-Trace': 'test' },
};

const buildCtx = (overrides = {}) => ({
  bindings: { ...baseBindings, ...(overrides.bindings || {}) },
  config: overrides.config || {},
  secret: overrides.secret || {},
  limits: { timeoutMs: 4000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst-1', request_id: 'req-1', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const callHandler = (method, request = {}, ctx = {}) => {
  const handler = handlers[method];
  return handler({ ...ctx, request });
};

const responseOf = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => String(body),
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
  const codes = {
    FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
    INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
    PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
    UNKNOWN: grpcStatus.UNKNOWN,
  };
  assert.equal(caught.code, codes[legacyCode]);
  assert.match(caught.message, new RegExp(`^${legacyCode}:`));
  checker(caught);
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalConsoleLog;
});

test('service exports handlers and rpcdef path handlers', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers[METHOD_FORBID_FULL], 'function');
  assert.equal(typeof handlers[METHOD_UNFORBID_FULL], 'function');
  const defs = rpcdef(buildCtx());
  assert.equal(typeof defs[METHOD_FORBID_PATH], 'function');
  assert.equal(typeof defs[METHOD_UNFORBID_PATH], 'function');
});

test('computePassword matches legacy sample', () => {
  assert.equal(_test.computePassword('demo_api_key', 'Thu, 26 Feb 2026 08:07:15 GMT'), 'AJveAGak/FH65g+OBkITdtn7rBU=');
});

test('mock upstream supports forbid and unforbid flow with partial result', async () => {
  const mock = createMockServer();
  const host = await mock.start();
  try {
    const ctx = buildCtx({ bindings: { baseUrl: host, skipTlsVerify: true } });
    const forbid = await callHandler(METHOD_FORBID_FULL, { ip_list: ['1.1.1.1', 'fail.me'], forbid_time_minutes: { value: '120' }, request_id: 'rid' }, ctx);
    assert.equal(forbid.outcome, OUTCOME.PARTIAL);
    assert.equal(forbid.forbid_time_minutes.value, '120');
    assert.deepEqual(forbid.failed_ips, ['fail.me']);
    assert.equal(forbid.audit.operation_type, OPERATION.FORBID);
    const unforbid = await callHandler(METHOD_UNFORBID_FULL, { ip_list: ['1.1.1.1'], label_code: LABEL_CODE }, ctx);
    assert.equal(unforbid.outcome, OUTCOME.SUCCESS);
    assert.equal(unforbid.audit.operation_type, OPERATION.UNFORBID);
    assert.equal(mock.requests.length, 2);
  } finally {
    await mock.close();
  }
});

test('BatchForbidIP issues POST with expected signed headers and payload', async () => {
  const calls = [];
  setFetch(async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return responseOf(200, JSON.stringify({ code: '0', message: 'ok', data: [] }));
  });

  const res = await callHandler(METHOD_FORBID_FULL, { ip_list: ['1.1.1.1'], forbid_time_minutes: { value: '120' }, request_id: 'req-123' }, buildCtx({ bindings: { tlsInsecureSkipVerify: true } }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, baseBindings.baseUrl);
  assert.equal(calls[0].init.method, 'POST');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal(calls[0].init.timeoutMs, undefined);
  assert.equal(calls[0].init.dispatcher, _test.insecureTlsDispatcher);
  assert.equal(calls[0].init.tlsInsecureSkipVerify, undefined);
  assert.equal(calls[0].init.headers['X-Time-Zone'], 'GMT+08:00');
  assert.equal(calls[0].init.headers.Date, DATE_HEADER);
  assert.equal(calls[0].init.headers['X-Wangsu-User'], USER);
  assert.match(calls[0].init.headers.Authorization, /^Basic /);
  assert.equal(Buffer.from(calls[0].init.headers.Authorization.slice(6), 'base64').toString('utf8'), `${USER}:AJveAGak/FH65g+OBkITdtn7rBU=`);
  assert.equal(calls[0].body.operationType, 1);
  assert.equal(calls[0].body.operationObjectList[0].labelCode, LABEL_CODE);
  assert.deepEqual(calls[0].body.operationObjectList[0].ipList, ['1.1.1.1']);
  assert.equal(calls[0].body.forbidTime, 120);
  assert.equal(res.outcome, OUTCOME.SUCCESS);
  assert.equal(res.requested_ip_count, 1);
  assert.equal(res.audit.request_id, 'req-123');
});

test('BatchUnforbidIP honors request label_code and response aliases', async () => {
  setFetch(async () => responseOf(200, JSON.stringify({ code: '0', msg: 'done', data: { failed_ips: ['2.2.2.2'] } })));
  const res = await callHandler(METHOD_UNFORBID_FULL, { ipList: ['2.2.2.2'], labelCode: 'OVERRIDE_TAG' }, buildCtx());
  assert.equal(res.outcome, OUTCOME.PARTIAL);
  assert.equal(res.label_code, 'OVERRIDE_TAG');
  assert.equal(res.upstream_message, 'done');
  assert.deepEqual(res.failed_ips, ['2.2.2.2']);
  assert.equal(res.forbid_time_minutes, undefined);
});

test('rpcdef merges context request and incoming request', async () => {
  let body;
  setFetch(async (url, init) => {
    body = JSON.parse(init.body);
    return responseOf(200, JSON.stringify({ code: '0', message: 'ok', data: null }));
  });
  const defs = rpcdef(buildCtx({ req: { ip_list: ['3.3.3.3'], request_id: 'ctx-req' } }));
  const res = await defs[METHOD_FORBID_PATH]({ forbid_time_minutes: { value: '30' } });
  assert.equal(body.forbidTime, 30);
  assert.deepEqual(body.operationObjectList[0].ipList, ['3.3.3.3']);
  assert.equal(res.audit.request_id, 'ctx-req');
});

test('rpcdef falls back to context request when call request is nullish', async () => {
  let body;
  setFetch(async (url, init) => {
    body = JSON.parse(init.body);
    return responseOf(200, JSON.stringify({ code: '0', message: 'ok', data: null }));
  });
  const defs = rpcdef(buildCtx({ req: { ip_list: ['4.4.4.4'], request_id: 'ctx-only' } }));
  const res = await defs[METHOD_UNFORBID_PATH](null);
  assert.equal(body.operationType, 2);
  assert.deepEqual(body.operationObjectList[0].ipList, ['4.4.4.4']);
  assert.equal(res.audit.request_id, 'ctx-only');
});

test('validation and upstream errors map to gRPC errors', async () => {
  await expectGrpcError(() => callHandler(METHOD_FORBID_FULL, { ip_list: ['1.1.1.1'] }, buildCtx({ bindings: { baseUrl: 'bad' } })), 'INVALID_ARGUMENT');
  await expectGrpcError(() => callHandler(METHOD_FORBID_FULL, { ip_list: ['1.1.1.1'] }, buildCtx({ bindings: { user: '' } })), 'INVALID_ARGUMENT');
  await expectGrpcError(() => callHandler(METHOD_FORBID_FULL, { ip_list: ['1.1.1.1'] }, buildCtx({ bindings: { apiKey: '', api_key: '' } })), 'INVALID_ARGUMENT');
  await expectGrpcError(() => callHandler(METHOD_FORBID_FULL, { ip_list: ['1.1.1.1'] }, buildCtx({ bindings: { labelCode: '', wangsu_tag: '' } })), 'INVALID_ARGUMENT');
  await expectGrpcError(() => callHandler(METHOD_FORBID_FULL, { ip_list: [] }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => callHandler(METHOD_FORBID_FULL, { ip_list: [' '] }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => callHandler(METHOD_FORBID_FULL, { ip_list: [null] }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => callHandler(METHOD_FORBID_FULL, { ip_list: Array.from({ length: 10001 }, (_, idx) => `1.1.1.${idx}`) }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => callHandler(METHOD_FORBID_FULL, { ip_list: ['1.1.1.1'] }, buildCtx({ bindings: { defaultForbidMinutes: undefined } })), 'INVALID_ARGUMENT');
  await expectGrpcError(() => callHandler(METHOD_FORBID_FULL, { ip_list: ['1.1.1.1'], forbid_time_minutes: { value: '0' } }, buildCtx()), 'INVALID_ARGUMENT');

  setFetch(async () => responseOf(401, 'unauthorized'));
  await expectGrpcError(() => callHandler(METHOD_FORBID_FULL, { ip_list: ['1.1.1.1'], forbid_time_minutes: { value: '60' } }, buildCtx()), 'PERMISSION_DENIED');

  setFetch(async () => responseOf(404, 'missing'));
  await expectGrpcError(() => callHandler(METHOD_FORBID_FULL, { ip_list: ['1.1.1.1'], forbid_time_minutes: { value: '60' } }, buildCtx()), 'FAILED_PRECONDITION');

  setFetch(async () => responseOf(500, 'broken'));
  await expectGrpcError(() => callHandler(METHOD_FORBID_FULL, { ip_list: ['1.1.1.1'], forbid_time_minutes: { value: '60' } }, buildCtx()), 'UNAVAILABLE');

  setFetch(async () => responseOf(200, ''));
  await expectGrpcError(() => callHandler(METHOD_FORBID_FULL, { ip_list: ['1.1.1.1'], forbid_time_minutes: { value: '60' } }, buildCtx()), 'UNKNOWN');

  setFetch(async () => responseOf(200, 'not json'));
  await expectGrpcError(() => callHandler(METHOD_FORBID_FULL, { ip_list: ['1.1.1.1'], forbid_time_minutes: { value: '60' } }, buildCtx()), 'UNKNOWN');

  setFetch(async () => responseOf(200, JSON.stringify({ code: '8001', message: 'business error' })));
  await expectGrpcError(() => callHandler(METHOD_FORBID_FULL, { ip_list: ['1.1.1.1'], forbid_time_minutes: { value: '60' } }, buildCtx()), 'FAILED_PRECONDITION', (err) => assert.match(err.message, /8001/));

  setFetch(async () => { throw new Error('network down'); });
  await expectGrpcError(() => callHandler(METHOD_FORBID_FULL, { ip_list: ['1.1.1.1'], forbid_time_minutes: { value: '60' } }, buildCtx()), 'UNAVAILABLE', (err) => assert.match(err.message, /network down/));

  setFetch(async () => { throw 'boom'; });
  await expectGrpcError(() => callHandler(METHOD_FORBID_FULL, { ip_list: ['1.1.1.1'], forbid_time_minutes: { value: '60' } }, buildCtx()), 'UNAVAILABLE', (err) => assert.match(err.message, /fetch failed/));
});

test('mock upstream covers rejection paths', async () => {
  const mock = createMockServer({ expectedUser: USER });
  const host = await mock.start();
  try {
    const missing = await fetch(`${host}/missing`, { method: 'POST' });
    assert.equal(missing.status, 404);

    const unauthorized = await fetch(host, { method: 'POST', body: '{}' });
    assert.equal(unauthorized.status, 401);

    const unknownUser = await fetch(host, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from('bad:pw').toString('base64')}` },
      body: '{}',
    });
    assert.equal(unknownUser.status, 403);

    const noDate = await fetch(host, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${USER}:pw`).toString('base64')}` },
      body: '{}',
    });
    assert.equal(noDate.status, 400);

    const mismatch = await fetch(host, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${USER}:pw`).toString('base64')}`, Date: DATE_HEADER, 'X-Wangsu-User': 'other' },
      body: '{}',
    });
    assert.equal(mismatch.status, 400);

    const invalidJson = await fetch(host, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${USER}:pw`).toString('base64')}`, Date: DATE_HEADER, 'X-Wangsu-User': USER },
      body: '{',
    });
    assert.equal(invalidJson.status, 400);

    const missingObjects = await fetch(host, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${USER}:pw`).toString('base64')}`, Date: DATE_HEADER, 'X-Wangsu-User': USER },
      body: JSON.stringify({}),
    });
    assert.equal(missingObjects.status, 400);

    const missingIps = await fetch(host, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${USER}:pw`).toString('base64')}`, Date: DATE_HEADER, 'X-Wangsu-User': USER },
      body: JSON.stringify({ operationObjectList: [{ labelCode: LABEL_CODE, ipList: [] }], operationType: 1 }),
    });
    assert.equal(missingIps.status, 400);

    const badOperation = await fetch(host, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${USER}:pw`).toString('base64')}`, Date: DATE_HEADER, 'X-Wangsu-User': USER },
      body: JSON.stringify({ operationObjectList: [{ labelCode: LABEL_CODE, ipList: ['1.1.1.1'] }], operationType: 9 }),
    });
    assert.equal(badOperation.status, 400);

    const missingLabel = await fetch(host, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${USER}:pw`).toString('base64')}`, Date: DATE_HEADER, 'X-Wangsu-User': USER },
      body: JSON.stringify({ operationObjectList: [{ ipList: ['1.1.1.1'] }], operationType: 2 }),
    });
    assert.equal(missingLabel.status, 200);

    const missingForbidTime = await fetch(host, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${USER}:pw`).toString('base64')}`, Date: DATE_HEADER, 'X-Wangsu-User': USER },
      body: JSON.stringify({ operationObjectList: [{ labelCode: LABEL_CODE, ipList: ['1.1.1.1'] }], operationType: 1 }),
    });
    assert.equal(missingForbidTime.status, 400);

    const http500 = await fetch(host, {
      method: 'POST',
      headers: { 'X-Wangsu-Simulate': 'http-500' },
      body: '{}',
    });
    assert.equal(http500.status, 500);

    const bizError = await fetch(host, {
      method: 'POST',
      headers: { 'X-Wangsu-Simulate': 'biz-error' },
      body: '{}',
    });
    assert.equal(bizError.status, 200);
  } finally {
    await mock.close();
  }
});

test('mock upstream covers auth parser and empty body branches', async () => {
  const mock = createMockServer({ expectedUser: '' });
  const host = await mock.start();
  try {
    const emptyBody = await fetch(host, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(USER).toString('base64')}`, Date: DATE_HEADER, 'X-Wangsu-User': USER },
    });
    assert.equal(emptyBody.status, 400);

    const invalidBase64 = await fetch(host, {
      method: 'POST',
      headers: { Authorization: 'Basic !!!', Date: DATE_HEADER },
      body: '{}',
    });
    assert.equal(invalidBase64.status, 400);
  } finally {
    await mock.close();
  }
});

test('helper functions cover parsing and branch behavior', () => {
  assert.equal(_test.grpcCodeFor('missing'), grpcStatus.UNKNOWN);
  assert.equal(_test.hasOwn({ value: 1 }, 'value'), true);
  assert.equal(_test.unwrapScalar({ value: { value: 'x' } }), 'x');
  assert.equal(_test.pickString({ value: 12 }), '12');
  assert.equal(_test.pickString(null), '');
  assert.equal(_test.pickFirstString([undefined, ' x ']), 'x');
  assert.equal(_test.pickFirstString([' ', undefined]), '');
  assert.equal(_test.toBoolean(true), true);
  assert.equal(_test.toBoolean(Number.NaN), undefined);
  assert.equal(_test.toBoolean(0), false);
  assert.equal(_test.toBoolean('yes'), true);
  assert.equal(_test.toBoolean('n'), false);
  assert.equal(_test.toBoolean('off'), false);
  assert.equal(_test.toBoolean('maybe'), undefined);
  assert.equal(_test.pickFirstBoolean(['bad', 'true']), true);
  assert.equal(_test.pickFirstBoolean(['bad']), undefined);
  assert.deepEqual(_test.wrapInt64(7), { value: '7' });
  assert.equal(_test.wrapInt64(null), undefined);
  assert.equal(_test.unwrapInt64({ value: '8' }), 8);
  assert.equal(_test.unwrapInt64(''), null);
  assert.equal(_test.unwrapInt64('1.5'), null);
  assert.equal(_test.unwrapInt64('bad'), null);
  assert.equal(_test.normalizeBaseUrl('https://open.example/path'), 'https://open.example/path');
  assert.equal(_test.normalizeBaseUrl(''), null);
  assert.equal(_test.normalizeBaseUrl('ftp://open.example/path'), null);
  assert.deepEqual(_test.readIpList({ ips: [' 1.1.1.1 '] }), ['1.1.1.1']);
  assert.throws(() => _test.readIpList({ ip_list: 'bad' }), /INVALID_ARGUMENT/);
  assert.equal(_test.resolveLabelCode({ labelCode: 'REQ' }, {}), 'REQ');
  assert.equal(_test.resolveLabelCode({}, { labelCode: 'CAMEL' }), 'CAMEL');
  assert.equal(_test.resolveLabelCode({}, { label_code: 'BIND' }), 'BIND');
  assert.equal(_test.resolveLabelCode({}, { wangsu_tag: 'TAG_SNAKE' }), 'TAG_SNAKE');
  assert.equal(_test.resolveLabelCode({}, { wangsuTag: 'TAG' }), 'TAG');
  assert.throws(() => _test.resolveLabelCode({}, {}), /INVALID_ARGUMENT/);
  assert.equal(_test.resolveBaseConfig({ restBaseUrl: 'https://rest', user: 'u', api_key: 'k', timeoutMs: -1 }).timeoutMs, 5000);
  assert.equal(_test.resolveBaseConfig({ url: 'https://url', user: 'u', apiKey: 'k', timeout_ms: 10 }).timeoutMs, 10);
  assert.equal(_test.resolveBaseConfig({ url: 'https://url', user: 'u', apiKey: 'k' }, { timeoutMs: 12 }).timeoutMs, 12);
  assert.equal(_test.resolveBaseConfig({ url: 'https://url', user: 'u', apiKey: 'k', timeout: '13' }).timeoutMs, 13);
  assert.throws(() => _test.resolveBaseConfig({ url: '', user: 'u', apiKey: 'k' }), /INVALID_ARGUMENT/);
  assert.throws(() => _test.resolveBaseConfig({ url: 'https://url', user: '', apiKey: 'k' }), /INVALID_ARGUMENT/);
  assert.throws(() => _test.resolveBaseConfig({ url: 'https://url', user: 'u', apiKey: '' }), /INVALID_ARGUMENT/);
  assert.equal(typeof _test.resolveDateHeader({}), 'string');
  assert.equal(_test.resolveDateHeader({ overrideDateHeader: 'override', dateHeader: 'fixed' }), 'override');
  assert.equal(_test.resolveDateHeader({ dateHeader: 'fixed' }), 'fixed');
  assert.equal(_test.resolveForbidMinutes({ forbidTimeMinutes: '5' }, {}, { required: true }), 5);
  assert.equal(_test.resolveForbidMinutes({}, { default_forbid_minutes: '6' }, { required: true }), 6);
  assert.equal(_test.resolveForbidMinutes({ forbid_time_minutes: '7' }, { defaultForbidMinutes: '6' }, { required: true }), 7);
  assert.equal(_test.resolveForbidMinutes({}, {}, { required: false }), undefined);
  assert.equal(_test.resolveForbidMinutes({ forbid_time_minutes: { value: String(9999999) } }, {}, { required: true }), 2628000);
  assert.throws(() => _test.resolveForbidMinutes({ forbid_time_minutes: '0' }, {}, { required: true }), /INVALID_ARGUMENT/);
  assert.throws(() => _test.computePassword('', DATE_HEADER), /INVALID_ARGUMENT/);
  assert.throws(() => _test.computePassword(API_KEY, ''), /INVALID_ARGUMENT/);
  assert.equal(_test.buildBasicAuth('u', 'p'), 'Basic dTpw');
  assert.deepEqual(_test.sanitizeHeaders({ a: 1, b: { value: false }, '': 'skip' }), { a: '1', b: 'false' });
  assert.deepEqual(_test.sanitizeHeaders(null), {});
  assert.deepEqual(_test.sanitizeHeaders(['skip']), {});
  assert.equal(_test.buildHeaders({ headers: { 'Content-Type': 'custom', Extra: '1' } }, {}).Extra, '1');
  assert.equal(_test.shouldSkipTls({ tlsInsecureSkipVerify: 'on' }), true);
  assert.equal(_test.shouldSkipTls({ skipTlsVerify: '1' }), true);
  assert.equal(_test.shouldSkipTls({ tls_skip_verify: 'yes' }), true);
  assert.equal(_test.shouldSkipTls({}), false);
  assert.equal(_test.mapHttpError(401, 'no').legacyCode, 'PERMISSION_DENIED');
  assert.equal(_test.mapHttpError(403, '').legacyCode, 'PERMISSION_DENIED');
  assert.equal(_test.mapHttpError(404, 'no').legacyCode, 'FAILED_PRECONDITION');
  assert.equal(_test.mapHttpError(500, 'no').legacyCode, 'UNAVAILABLE');
  assert.deepEqual(_test.extractFailedIps({ failures: [1, '', null] }), ['1']);
  assert.deepEqual(_test.extractFailedIps({ failedIpList: 'bad' }), []);
  assert.deepEqual(_test.extractFailedIps(null), []);
  assert.deepEqual(_test.buildPayload(OPERATION.UNFORBID, 'L', ['1.1.1.1'], undefined), { operationObjectList: [{ labelCode: 'L', ipList: ['1.1.1.1'] }], operationType: 2 });
  assert.equal(_test.resolveCallContext({ request: { ip_list: ['1.1.1.1'] } }).req.ip_list[0], '1.1.1.1');

  const logs = [];
  console.log = (...args) => logs.push(args);
  _test.logAudit({ instance_id: 'i', request_id: 'r' }, 'phase', { ips: ['1.1.1.1'] });
  assert.equal(logs[0][1], '{"ip_count":1}');
  const circular = {};
  circular.self = circular;
  _test.logAudit({ instanceId: 'i', requestId: 'r' }, 'phase', circular);
  assert.equal(logs[1][0], '[Wangsu_LabelIP][phase][inst=i][req=r]');
  assert.equal(logs[1][1], circular);
});
