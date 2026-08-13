import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_ADD_GLOBAL_BLACK_FULL,
  METHOD_ADD_GLOBAL_BLACK_PATH,
  METHOD_ADD_PRECISE_BLACK_FULL,
  METHOD_ADD_PRECISE_BLACK_PATH,
  METHOD_DELETE_GLOBAL_BLACK_FULL,
  METHOD_DELETE_GLOBAL_BLACK_PATH,
  METHOD_DELETE_PRECISE_BLACK_FULL,
  METHOD_DELETE_PRECISE_BLACK_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/tencent-tsec-v2-5-1.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const originalLog = console.log;

const fixedNow = () => {
  Date.now = () => 1705392000000;
};

const response = (status, body) => ({
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const setFetch = (impl) => {
  globalThis.fetch = impl;
};

const buildCtx = (overrides = {}) => ({
  config: {
    host: 'https://tsec.example/cgi-bin/device/external_block_api',
    uuid: 'uuid-1',
    ...(overrides.config || {}),
  },
  secret: {
    block_secret_id: 'block-id',
    block_secret_key: 'block-key',
    unblock_secret_id: 'unblock-id',
    unblock_secret_key: 'unblock-key',
    ...(overrides.secret || {}),
  },
  bindings: {
    headers: { 'X-Custom': 'trace' },
    ...(overrides.bindings || {}),
  },
  limits: { timeoutMs: 9000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst-1', request_id: 'req-1', ...(overrides.meta || {}) },
  req: overrides.req || {},
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
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
    UNKNOWN: grpcStatus.UNKNOWN,
  })[legacyCode]);
  checker(caught);
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  console.log = originalLog;
});

test('service exports handlers and rpcdef paths', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers[METHOD_ADD_PRECISE_BLACK_FULL], 'function');
  assert.equal(typeof handlers[METHOD_DELETE_PRECISE_BLACK_FULL], 'function');
  assert.equal(typeof handlers[METHOD_ADD_GLOBAL_BLACK_FULL], 'function');
  assert.equal(typeof handlers[METHOD_DELETE_GLOBAL_BLACK_FULL], 'function');

  const defs = rpcdef(buildCtx());
  assert.equal(typeof defs[METHOD_ADD_PRECISE_BLACK_PATH], 'function');
  assert.equal(typeof defs[METHOD_DELETE_PRECISE_BLACK_PATH], 'function');
  assert.equal(typeof defs[METHOD_ADD_GLOBAL_BLACK_PATH], 'function');
  assert.equal(typeof defs[METHOD_DELETE_GLOBAL_BLACK_PATH], 'function');
});

test('validates required bindings and aliases', async () => {
  await expectGrpcError(
    () => callHandler(METHOD_ADD_PRECISE_BLACK_FULL, { ip: '1.1.1.1', valid_duration: 60, ban_reason: 1 }, buildCtx({ config: { host: '' } })),
    'FAILED_PRECONDITION',
    (err) => assert.match(err.message, /host/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_ADD_PRECISE_BLACK_FULL, { ip: '1.1.1.1', valid_duration: 60, ban_reason: 1 }, buildCtx({ config: { uuid: '' } })),
    'FAILED_PRECONDITION',
    (err) => assert.match(err.message, /uuid/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_ADD_PRECISE_BLACK_FULL, { ip: '1.1.1.1', valid_duration: 60, ban_reason: 1 }, buildCtx({ secret: { block_secret_id: '' } })),
    'FAILED_PRECONDITION',
    (err) => assert.match(err.message, /block_secret_id/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_DELETE_PRECISE_BLACK_FULL, { ip: '1.1.1.1' }, buildCtx({ secret: { unblock_secret_key: '' } })),
    'FAILED_PRECONDITION',
    (err) => assert.match(err.message, /unblock_secret_key/),
  );

  assert.deepEqual(_test.validateBindings({
    baseUrl: ' http://api.local ',
    uuid: ' u ',
    blockSecretId: 'bid',
    blockSecretKey: 'bkey',
  }, 'block'), {
    host: 'http://api.local',
    uuid: 'u',
    blockSecretId: 'bid',
    blockSecretKey: 'bkey',
    unblockSecretId: '',
    unblockSecretKey: '',
  });
  assert.deepEqual(_test.validateBindings({
    host: 'http://api.local',
    uuid: 'u',
    unblockSecretId: 'uid',
    unblockSecretKey: 'ukey',
  }, 'unblock').unblockSecretId, 'uid');
});

test('validates request fields with legacy messages', async () => {
  const addPrecise = (req) => callHandler(METHOD_ADD_PRECISE_BLACK_FULL, req, buildCtx());
  const addGlobal = (req) => callHandler(METHOD_ADD_GLOBAL_BLACK_FULL, req, buildCtx());

  await expectGrpcError(() => addPrecise({ ip: null, valid_duration: 60, ban_reason: 1 }), 'INVALID_ARGUMENT', (err) => assert.match(err.message, /non-empty string/));
  await expectGrpcError(() => addPrecise({ ip: '', valid_duration: 60, ban_reason: 1 }), 'INVALID_ARGUMENT', (err) => assert.match(err.message, /cannot be empty/));
  await expectGrpcError(() => addPrecise({ ip: '999.1.1.1', valid_duration: 60, ban_reason: 1 }), 'INVALID_ARGUMENT', (err) => assert.match(err.message, /valid IPv4/));
  await expectGrpcError(() => addPrecise({ ip: '1.1.1', valid_duration: 60, ban_reason: 1 }), 'INVALID_ARGUMENT', (err) => assert.match(err.message, /valid IPv4/));
  await expectGrpcError(() => addPrecise({ ip: '1.1.1.1', valid_duration: '', ban_reason: 1 }), 'INVALID_ARGUMENT', (err) => assert.match(err.message, /valid_duration/));
  await expectGrpcError(() => addPrecise({ ip: '1.1.1.1', valid_duration: 0, ban_reason: 1 }), 'INVALID_ARGUMENT', (err) => assert.match(err.message, /positive integer/));
  await expectGrpcError(() => addPrecise({ ip: '1.1.1.1', valid_duration: 60, ban_reason: 0 }), 'INVALID_ARGUMENT', (err) => assert.match(err.message, /ban_reason/));
  await expectGrpcError(() => addPrecise({ ip: '1.1.1.1', valid_duration: 60, ban_reason: 6 }), 'INVALID_ARGUMENT', (err) => assert.match(err.message, /range/));
  await expectGrpcError(() => addPrecise({ ip: '1.1.1.1', valid_duration: 60, ban_reason: 1, threshold: 'bad' }), 'INVALID_ARGUMENT', (err) => assert.match(err.message, /threshold/));
  await expectGrpcError(() => addPrecise({ ip: '1.1.1.1', valid_duration: 60, ban_reason: 1, threshold: 101 }), 'INVALID_ARGUMENT', (err) => assert.match(err.message, /range/));
  await expectGrpcError(() => addGlobal({ ip_src: '1.1.1.1', ip_dst: 123, valid_duration: 60, ban_reason: 1 }), 'INVALID_ARGUMENT', (err) => assert.match(err.message, /string if provided/));
  await expectGrpcError(() => addGlobal({ ip_src: '1.1.1.1', ip_dst: 'bad', valid_duration: 60, ban_reason: 1 }), 'INVALID_ARGUMENT', (err) => assert.match(err.message, /ip_dst/));
});

test('AddPreciseBlack signs and sends default payload', async () => {
  fixedNow();
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return response(200, { err: null, msg: 'ok', data: { added: true } });
  });

  const result = await callHandler(METHOD_ADD_PRECISE_BLACK_FULL,
    { ip: ' 1.2.3.4 ', validDuration: { value: '60' }, banReason: { value: '5' } },
    buildCtx({ bindings: { timeoutMs: 25, skipTlsVerify: 'yes' } }),
  );

  const unsigned = { ...captured.body };
  delete unsigned.signature;
  const expectedSig = _test.signPayload(captured.url, unsigned, 'block-key');
  assert.equal(captured.url, 'https://tsec.example/cgi-bin/device/external_block_api');
  assert.equal(captured.init.method, 'POST');
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.init.timeoutMs, undefined);
  assert.equal(captured.init.dispatcher, _test.insecureTlsDispatcher);
  assert.equal(captured.init.skipTlsVerify, undefined);
  assert.equal(captured.init.headers['Content-Type'], 'application/json');
  assert.equal(captured.init.headers['X-Custom'], 'trace');
  assert.equal(captured.init.headers['x-engine-instance'], 'inst-1');
  assert.equal(captured.body.signature, expectedSig);
  assert.notEqual(captured.body.signature, '');
  assert.deepEqual(unsigned, {
    action: 'v1/add_precise_black',
    secret_id: 'block-id',
    sig_random: unsigned.sig_random,
    time: 1705392000,
    rules: [{ field: 'Http-X-Forworded-For', content: '1.2.3.4', operator: 'contain' }],
    threshold: 100,
    valid_duration: 60,
    match_operation: 'block',
    uuid: 'uuid-1',
    ban_reason: 5,
  });
  assert.match(unsigned.sig_random, /^[1-9]\d{3}$/);
  assert.deepEqual(result.msg, { stringValue: 'ok' });
  assert.deepEqual(result.data.structValue.fields.added, { boolValue: true });
});

test('DeletePreciseBlack sends custom rule and parses fallback responses', async () => {
  fixedNow();
  const payloads = [];
  setFetch(async (_url, init) => {
    payloads.push(JSON.parse(init.body));
    return response(200, payloads.length === 1 ? '' : 'plain text');
  });

  const empty = await callHandler(METHOD_DELETE_PRECISE_BLACK_FULL, { ip: '2.2.2.2', field: 'src', operator: 'equal' }, buildCtx());
  const text = await callHandler(METHOD_DELETE_PRECISE_BLACK_FULL, { ip: '3.3.3.3' }, buildCtx());

  assert.deepEqual(empty, { err: null, msg: '', data: null });
  assert.deepEqual(text, { err: null, msg: 'plain text', data: null });
  assert.equal(payloads[0].action, 'v1/del_precise_black');
  assert.equal(payloads[0].secret_id, 'unblock-id');
  assert.deepEqual(payloads[0].rules, [{ field: 'src', content: '2.2.2.2', operator: 'equal' }]);
  assert.deepEqual(payloads[1].rules, [{ field: 'Http-X-Forworded-For', content: '3.3.3.3', operator: 'contain' }]);
});

test('AddGlobalBlack accepts status 200 and 208, then rejects bad global responses', async () => {
  fixedNow();
  const bodies = [
    { status_code: 200, err: null, msg: 'ok', data: { added: true } },
    { status_code: 208, err: 'exists', msg: 'exists', data: null },
    { status_code: 500, msg: 'bad' },
    '',
    'not-json',
  ];
  const payloads = [];
  setFetch(async (_url, init) => {
    payloads.push(JSON.parse(init.body));
    return response(200, bodies.shift());
  });

  const ok = await callHandler(METHOD_ADD_GLOBAL_BLACK_FULL, { ipSrc: '4.4.4.4', ipDst: '5.5.5.5', validDuration: -1, banReason: 1, threshold: 0 }, buildCtx());
  const exists = await callHandler(METHOD_ADD_GLOBAL_BLACK_FULL, { ip_src: '4.4.4.4', ip_dst: '', valid_duration: 60, ban_reason: 2 }, buildCtx());

  assert.deepEqual(ok.data.structValue.fields.added, { boolValue: true });
  assert.deepEqual(exists.err, { stringValue: 'exists' });
  assert.equal(payloads[0].action, 'v1/add_global_black');
  assert.equal(payloads[0].ip_src, '4.4.4.4');
  assert.equal(payloads[0].ip_dst, '5.5.5.5');
  assert.equal(payloads[0].threshold, 0);
  assert.equal(payloads[1].threshold, 100);

  await expectGrpcError(() => callHandler(METHOD_ADD_GLOBAL_BLACK_FULL, { ip_src: '4.4.4.4', valid_duration: 60, ban_reason: 2 }, buildCtx()), 'FAILED_PRECONDITION', (err) => assert.match(err.message, /status_code/));
  await expectGrpcError(() => callHandler(METHOD_ADD_GLOBAL_BLACK_FULL, { ip_src: '4.4.4.4', valid_duration: 60, ban_reason: 2 }, buildCtx()), 'UNKNOWN', (err) => assert.match(err.message, /empty response/));
  await expectGrpcError(() => callHandler(METHOD_ADD_GLOBAL_BLACK_FULL, { ip_src: '4.4.4.4', valid_duration: 60, ban_reason: 2 }, buildCtx()), 'UNKNOWN', (err) => assert.match(err.message, /invalid JSON/));
});

test('DeleteGlobalBlack accepts manual-unblock status and maps response errors', async () => {
  fixedNow();
  const logs = [];
  console.log = (...args) => logs.push(args);
  const bodies = [
    { status_code: 200, msg: 'ok', data: { removed: true } },
    { status_code: 210, msg: 'already unblocked', data: { removed: false } },
    { status_code: 409, msg: 'bad' },
    'not-json',
    '',
  ];
  setFetch(async () => response(200, bodies.shift()));

  const ok = await callHandler(METHOD_DELETE_GLOBAL_BLACK_FULL, { ipSrc: '6.6.6.6', ipDst: '7.7.7.7' }, buildCtx());
  const manual = await callHandler(METHOD_DELETE_GLOBAL_BLACK_FULL, { ip_src: '6.6.6.6' }, buildCtx());

  assert.deepEqual(ok.data.structValue.fields.removed, { boolValue: true });
  assert.deepEqual(manual.data.structValue.fields.removed, { boolValue: false });
  assert.ok(logs.some((entry) => String(entry[0]).includes('DeleteGlobalBlack:manual-unblock')));
  await expectGrpcError(() => callHandler(METHOD_DELETE_GLOBAL_BLACK_FULL, { ip_src: '6.6.6.6' }, buildCtx()), 'FAILED_PRECONDITION', (err) => assert.match(err.message, /status_code/));
  await expectGrpcError(() => callHandler(METHOD_DELETE_GLOBAL_BLACK_FULL, { ip_src: '6.6.6.6' }, buildCtx()), 'UNKNOWN', (err) => assert.match(err.message, /invalid JSON/));
  await expectGrpcError(() => callHandler(METHOD_DELETE_GLOBAL_BLACK_FULL, { ip_src: '6.6.6.6' }, buildCtx()), 'UNKNOWN', (err) => assert.match(err.message, /empty response/));
});

test('maps transport and HTTP status failures', async () => {
  setFetch(async () => {
    throw Object.assign(new Error('outer'), { cause: new Error('connect ECONNREFUSED') });
  });
  await expectGrpcError(
    () => callHandler(METHOD_DELETE_PRECISE_BLACK_FULL, { ip: '8.8.8.8' }, buildCtx()),
    'UNAVAILABLE',
    (err) => assert.match(err.message, /ECONNREFUSED/),
  );

  setFetch(async () => response(500, 'server failed'));
  await expectGrpcError(
    () => callHandler(METHOD_ADD_PRECISE_BLACK_FULL, { ip: '8.8.4.4', valid_duration: 60, ban_reason: 1 }, buildCtx()),
    'UNAVAILABLE',
    (err) => assert.match(err.message, /http 500/),
  );
});

test('rpcdef falls back to context request', async () => {
  setFetch(async () => response(200, { err: null, msg: 'ok', data: null }));
  const result = await rpcdef(buildCtx({
    req: { ip: '9.9.9.9', valid_duration: 60, ban_reason: 1 },
  }))[METHOD_ADD_PRECISE_BLACK_PATH]();
  assert.deepEqual(result.msg, { stringValue: 'ok' });
});

test('helper functions cover normalization, signing, TLS, and logging branches', () => {
  assert.equal(_test.errorWithCode('NOT_REAL', 'x').code, grpcStatus.UNKNOWN);
  assert.equal(_test.hasOwn(null, 'x'), false);
  assert.equal(_test.firstDefined(undefined, null, 0, 'x'), 0);
  assert.equal(_test.unwrapScalar({ value: { value: 'nested' } }), 'nested');
  assert.equal(_test.toTrimmedString(null), '');
  assert.equal(_test.toInt64('bad'), null);
  assert.equal(_test.toInt64('10.1'), null);
  assert.equal(_test.optionalUint32('10.9'), 10);
  assert.equal(_test.optionalUint32(0), undefined);
  assert.equal(_test.optionalUint32('bad'), undefined);
  assert.equal(_test.toBoolean(true), true);
  assert.equal(_test.toBoolean(1), true);
  assert.equal(_test.toBoolean(0), false);
  assert.equal(_test.toBoolean('ON'), true);
  assert.equal(_test.toBoolean('off'), false);
  assert.equal(_test.toBoolean('maybe'), false);
  assert.equal(_test.resolveHost({ baseUrl: ' http://api.local ' }), 'http://api.local');
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeoutMs: '15' }, limits: { timeoutMs: 20 } }), 15);
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeoutMs: '-1' }, limits: { timeoutMs: 20 } }), 20);
  assert.equal(_test.resolveTimeoutMs({ bindings: {}, limits: { timeoutMs: 0 } }), 5000);
  assert.deepEqual(_test.buildTlsOptions({}), {});
  assert.equal(_test.buildTlsOptions({ tlsInsecureSkipVerify: true }).dispatcher, _test.insecureTlsDispatcher);
  assert.deepEqual(_test.buildHeaders({ bindings: { headers: null }, meta: {} }), {
    'Content-Type': 'application/json',
    'x-engine-instance': 'unknown',
    'x-request-id': 'unknown',
  });
  assert.deepEqual(_test.mergedBindings({ config: { a: 1 }, secret: { b: 2 }, bindings: { a: 3 } }), { a: 3, b: 2 });
  assert.deepEqual(_test.resolveCallContext({ request: { ip: '1.1.1.1' } }).req, { ip: '1.1.1.1' });
  assert.equal(_test.prepareRuntime(buildCtx(), 'block').blockSecretId, 'block-id');
  assert.equal(_test.validateIP(' 1.1.1.1 '), '1.1.1.1');
  assert.equal(_test.validateOptionalIP(null), '');
  assert.equal(_test.validateOptionalIP(''), '');
  assert.equal(_test.validateBanReason({ value: '3' }), 3);
  assert.equal(_test.validateThreshold({ value: '99' }), 99);
  assert.equal(_test.validateValidDuration({ value: '-1' }), -1);
  assert.deepEqual(_test.toValue([1, null, 'x']), {
    listValue: { values: [{ numberValue: 1 }, { stringValue: 'x' }] },
  });
  assert.deepEqual(_test.toValue({ a: null }).structValue.fields.a, { nullValue: 'NULL_VALUE' });
  assert.deepEqual(_test.toValue(Symbol.for('x')), { stringValue: 'Symbol(x)' });
  assert.deepEqual(_test.parseDefaultTencentResponse('{"err":1,"msg":true,"data":[1]}'), {
    err: { numberValue: 1 },
    msg: { boolValue: true },
    data: { listValue: { values: [{ numberValue: 1 }] } },
  });
  assert.deepEqual(_test.parseGlobalResponse('{"status_code":208,"msg":"exists"}', new Set([208]), 'add', '208').msg, { stringValue: 'exists' });

  const sorted = _test.sortObjectKeys({ b: 2, a: { d: 4, c: [{ y: 2, x: 1 }] } });
  assert.deepEqual(Object.keys(sorted), ['a', 'b']);
  assert.deepEqual(Object.keys(sorted.a), ['c', 'd']);
  const data = { z: 1, a: { b: 2 } };
  const signatureString = _test.buildSignatureString('https://example.com/api', data);
  const expectedDigest = encodeURIComponent(crypto.createHmac('sha1', 'secret').update(signatureString).digest('base64'));
  assert.equal(signatureString, 'POSTexample.com/api?{"a":{"b":2},"z":1}');
  assert.equal(_test.computeSignature(signatureString, 'secret'), expectedDigest);
  assert.equal(_test.signPayload('https://example.com/api', data, 'secret'), expectedDigest);
  fixedNow();
  assert.match(_test.generateSigRandom(), /^[1-9]\d{3}$/);
  assert.equal(_test.getTimestamp(), 1705392000);

  const circular = {};
  circular.self = circular;
  const logs = [];
  console.log = (...args) => logs.push(args);
  _test.logFlow({ instanceId: 'i', requestId: 'r' }, 'action', { body: { signature: 'secret' } });
  _test.logFlow({}, 'fallback', circular);
  assert.match(logs[0][0], /\[Tencent_TSec_V251\]\[action\]\[inst=i req=r\]/);
  assert.match(logs[0][1], /\[REDACTED\]/);
  assert.match(logs[1][0], /\[Tencent_TSec_V251\]\[fallback\]/);
  assert.equal(_test.safeLogDetails({ body: { signature: 'secret', ok: true } }).body.signature, '[REDACTED]');
  assert.equal(_test.buildLogPrefix({}, 'empty'), '[Tencent_TSec_V251][empty]');
});

test('callTencentAPI can be used directly with custom success checker', async () => {
  setFetch(async (_url, init) => response(204, { body: JSON.parse(init.body).action }));
  const result = await _test.callTencentAPI(
    {
      host: 'http://api.local',
      bindings: {},
      meta: {},
      limits: {},
    },
    { action: 'direct' },
    (text) => JSON.parse(text),
  );
  assert.deepEqual(result, { body: 'direct' });
});

test('mock upstream handles precise and global blacklist lifecycle', async () => {
  fixedNow();
  const server = await createMockServer();
  try {
    const ctx = buildCtx({ config: { host: server.url } });
    const preciseAdd = await callHandler(METHOD_ADD_PRECISE_BLACK_FULL, { ip: '10.0.0.1', valid_duration: 60, ban_reason: 1 }, ctx);
    const preciseDelete = await callHandler(METHOD_DELETE_PRECISE_BLACK_FULL, { ip: '10.0.0.1' }, ctx);
    const globalAdd = await callHandler(METHOD_ADD_GLOBAL_BLACK_FULL, { ip_src: '10.0.0.2', valid_duration: 60, ban_reason: 2 }, ctx);
    const globalDelete = await callHandler(METHOD_DELETE_GLOBAL_BLACK_FULL, { ip_src: '10.0.0.2' }, ctx);
    const globalDeleteAgain = await callHandler(METHOD_DELETE_GLOBAL_BLACK_FULL, { ip_src: '10.0.0.2' }, ctx);

    assert.deepEqual(preciseAdd.data.structValue.fields.added, { boolValue: true });
    assert.deepEqual(preciseDelete.data.structValue.fields.removed, { boolValue: true });
    assert.deepEqual(globalAdd.data.structValue.fields.added, { boolValue: true });
    assert.deepEqual(globalDelete.data.structValue.fields.removed, { boolValue: true });
    assert.deepEqual(globalDeleteAgain.data.structValue.fields.removed, { boolValue: false });
    assert.equal(server.requests.length, 5);
    assert.equal(server.requests[0].method, 'POST');
    assert.equal(server.requests[0].body.action, 'v1/add_precise_black');
    assert.equal(server.requests[4].body.action, 'v1/del_global_black');
  } finally {
    await server.close();
  }
});
