import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  DEFAULT_DIRECTIONS,
  DEFAULT_THREAT_TYPES,
  FALL_HOST_PATH,
  METHOD_QUERY_FALL_HOST_FULL,
  METHOD_QUERY_FALL_HOST_PATH,
  TDP_AUTH_HEADER,
  _test,
  handlers,
  rpcdef,
} from '../src/threatbook-tdp-host.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const originalLog = console.log;

const fixedNow = () => { Date.now = () => 1700000000000; };

const response = (status, body) => ({
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const setFetch = (impl) => { globalThis.fetch = impl; };

const buildCtx = (overrides = {}) => ({
  config: { restBaseUrl: 'https://tdp.example.com', ...(overrides.config || {}) },
  secret: { tdp_authentication: 'test_tdp_token', ...(overrides.secret || {}) },
  bindings: { headers: { Referer: 'https://tdp.example.com/hosts' }, ...(overrides.bindings || {}) },
  limits: { timeoutMs: 3000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const expectGrpcError = async (fn, legacyCode, checker = () => {}) => {
  let caught;
  try { await fn(); } catch (err) { caught = err; }
  assert.ok(caught, 'expected function to reject');
  assert.ok(caught instanceof GrpcError);
  assert.equal(caught.legacyCode, legacyCode);
  assert.equal(caught.code, ({
    FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
    INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
    PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
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
  assert.equal(typeof handlers[METHOD_QUERY_FALL_HOST_FULL], 'function');
  const defs = rpcdef(buildCtx());
  assert.equal(typeof defs[METHOD_QUERY_FALL_HOST_PATH], 'function');
});

test('QueryFallHostList builds payload, auth header and parses response', async () => {
  fixedNow();
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return response(200, {
      response_code: 0,
      data: { items: [{ id: 'a' }, { id: 'b' }], page: { cur_page: 1, page_size: 20 } },
    });
  });

  const result = await handlers[METHOD_QUERY_FALL_HOST_FULL](
    { keyword: { value: '198.51.100' }, cur_page: 2, page_size: 50, status: ['0'] },
    buildCtx({ bindings: { skipTlsVerify: true, headers: { Referer: 'https://tdp.example.com/hosts' } } }),
  );

  assert.equal(captured.url, `https://tdp.example.com${FALL_HOST_PATH}`);
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.timeoutMs, 3000);
  assert.equal(captured.init.skipTlsVerify, true);
  assert.equal(captured.init.headers[TDP_AUTH_HEADER], 'test_tdp_token');
  assert.equal(captured.init.headers.Referer, 'https://tdp.example.com/hosts');
  assert.equal(captured.init.headers['Content-Type'], 'application/json;charset=UTF-8');
  assert.deepEqual(captured.body.condition.direction, DEFAULT_DIRECTIONS);
  assert.deepEqual(captured.body.condition.threat_type, DEFAULT_THREAT_TYPES);
  assert.equal(captured.body.condition.fuzzy.keyword, '198.51.100');
  assert.deepEqual(captured.body.condition.status, ['0']);
  assert.equal(captured.body.page.cur_page, 2);
  assert.equal(captured.body.page.page_size, 50);
  assert.equal(captured.body.page.sort_by, 'severity');
  // 缺省时间窗 = 最近 7 天
  assert.equal(captured.body.condition.time_to, 1700000000);
  assert.equal(captured.body.condition.time_from, 1700000000 - 7 * 24 * 60 * 60);

  assert.equal(result.response_code, 0);
  assert.equal(result.item_count, 2);
  assert.deepEqual(result.data.structValue.fields.items.listValue.values.length, 2);
  assert.ok(result.raw_json.structValue.fields.data);
});

test('explicit time window, sort and extra_condition override defaults', async () => {
  let captured;
  setFetch(async (url, init) => { captured = JSON.parse(init.body); return response(200, { response_code: 0, data: { items: [] } }); });
  await handlers[METHOD_QUERY_FALL_HOST_FULL]({
    time_from: 1781798400,
    time_to: 1782403199,
    sort_by: 'time',
    sort_flag: 'asc',
    direction: ['out'],
    threat_type: ['c2'],
    disposal_status: ['1'],
    extra_condition: { fields: { asset_section: { listValue: { values: [{ stringValue: '服务器' }] } }, custom_flag: { boolValue: true } } },
  }, buildCtx());
  assert.equal(captured.condition.time_from, 1781798400);
  assert.equal(captured.condition.time_to, 1782403199);
  assert.deepEqual(captured.condition.direction, ['out']);
  assert.deepEqual(captured.condition.threat_type, ['c2']);
  assert.deepEqual(captured.condition.disposal_status, ['1']);
  assert.deepEqual(captured.condition.asset_section, ['服务器']);
  assert.equal(captured.condition.custom_flag, true);
  assert.equal(captured.page.sort_by, 'time');
  assert.equal(captured.page.sort_flag, 'asc');
});

test('validates bindings', async () => {
  await expectGrpcError(
    () => handlers[METHOD_QUERY_FALL_HOST_FULL]({}, buildCtx({ config: { restBaseUrl: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /restBaseUrl/),
  );
  await expectGrpcError(
    () => handlers[METHOD_QUERY_FALL_HOST_FULL]({}, buildCtx({ secret: { tdp_authentication: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /tdp_authentication/),
  );
});

test('maps transport, http, business and parse failures', async () => {
  setFetch(async () => { throw Object.assign(new Error('outer'), { cause: new Error('connection refused') }); });
  await expectGrpcError(() => handlers[METHOD_QUERY_FALL_HOST_FULL]({}, buildCtx()), 'UNAVAILABLE', (err) => assert.match(err.message, /connection refused/));

  for (const [status, legacyCode] of [[401, 'PERMISSION_DENIED'], [403, 'PERMISSION_DENIED'], [400, 'FAILED_PRECONDITION'], [500, 'UNAVAILABLE']]) {
    setFetch(async () => response(status, `status-${status}`));
    await expectGrpcError(() => handlers[METHOD_QUERY_FALL_HOST_FULL]({}, buildCtx()), legacyCode, (err) => assert.match(err.message, new RegExp(`upstream http ${status}`)));
  }

  setFetch(async () => response(200, { response_code: 7, response_message: 'bad filter' }));
  await expectGrpcError(() => handlers[METHOD_QUERY_FALL_HOST_FULL]({}, buildCtx()), 'FAILED_PRECONDITION', (err) => assert.match(err.message, /bad filter/));

  setFetch(async () => response(200, 'NOT_A_JSON!'));
  await expectGrpcError(() => handlers[METHOD_QUERY_FALL_HOST_FULL]({}, buildCtx()), 'UNKNOWN', (err) => assert.match(err.message, /valid JSON/));

  setFetch(async () => response(200, ''));
  await expectGrpcError(() => handlers[METHOD_QUERY_FALL_HOST_FULL]({}, buildCtx()), 'UNKNOWN', (err) => assert.match(err.message, /empty/));

  setFetch(async () => ({ status: 200, text: async () => { throw new Error('read failed'); } }));
  await expectGrpcError(() => handlers[METHOD_QUERY_FALL_HOST_FULL]({}, buildCtx()), 'UNAVAILABLE', (err) => assert.match(err.message, /read failed/));
});

test('rpcdef falls back to context request', async () => {
  setFetch(async () => response(200, { response_code: 0, data: { items: [{ id: 'ctx' }] } }));
  const result = await rpcdef(buildCtx({ req: { keyword: 'ctx' } }))[METHOD_QUERY_FALL_HOST_PATH]();
  assert.equal(result.item_count, 1);
});

test('helper functions cover branches', () => {
  fixedNow();
  assert.equal(_test.grpcCodeFor('NOPE'), grpcStatus.UNKNOWN);
  assert.equal(_test.hasOwn(null, 'x'), false);
  assert.equal(_test.firstDefined(undefined, null, 0, 'x'), 0);
  assert.equal(_test.unwrapScalar({ value: { value: 'nested' } }), 'nested');
  assert.equal(_test.trimString(null), '');
  assert.equal(_test.toInt('', 5), 5);
  assert.equal(_test.toInt('bad', 5), 5);
  assert.equal(_test.toInt('7'), 7);
  assert.deepEqual(_test.extractList({ values: ['a', { value: 'b' }] }), ['a', { value: 'b' }]);
  assert.deepEqual(_test.extractList('bad'), []);
  assert.deepEqual(_test.normalizeStringList(['', ' a '], ['fb']), ['a']);
  assert.deepEqual(_test.normalizeStringList([], ['fb']), ['fb']);
  assert.equal(_test.normalizeBaseUrl('ftp://bad'), null);
  assert.equal(_test.normalizeBaseUrl(' https://api.local/// '), 'https://api.local');
  assert.equal(_test.toBoolean('yes'), true);
  assert.equal(_test.toBoolean('off'), false);
  assert.equal(_test.toBoolean('maybe'), false);
  assert.equal(_test.toBoolean(2), true);
  assert.deepEqual(_test.mergedBindings({ config: { a: 1 }, secret: { b: 2 }, bindings: { a: 3 } }), { a: 3, b: 2 });
  assert.deepEqual(_test.resolveCallContext({ request: { keyword: 'a' } }).req, { keyword: 'a' });
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: 'bad' }, bindings: { timeoutMs: 10 } }), 5000);
  assert.equal(_test.resolveTimeoutMs({ limits: {}, bindings: { timeoutMs: 10 } }), 10);
  assert.deepEqual(_test.plainStruct({ fields: { k: { stringValue: 'v' } } }), { k: 'v' });
  assert.deepEqual(_test.plainStruct('bad'), {});
  assert.deepEqual(_test.plainStruct({ a: 1 }), { a: 1 });
  assert.equal(_test.decodeStructField({ numberValue: 3 }), 3);
  assert.equal(_test.decodeStructField({ boolValue: true }), true);
  assert.equal(_test.decodeStructField({ nullValue: 'NULL_VALUE' }), null);
  assert.deepEqual(_test.decodeStructField({ listValue: { values: [{ stringValue: 'x' }] } }), ['x']);
  assert.deepEqual(_test.decodeStructField({ structValue: { fields: { y: { numberValue: 1 } } } }), { y: 1 });
  assert.equal(_test.decodeStructField('raw'), 'raw');
  assert.deepEqual(_test.decodeStructField({ unknown: 1 }), { unknown: 1 });
  assert.equal(_test.normalizeBindings({ baseUrl: 'http://api.local', token: 't', skipTlsVerify: 'yes' }).skipTlsVerify, true);
  assert.equal(_test.prepareRuntime(buildCtx()).bindings.baseUrl, 'https://tdp.example.com');
  assert.deepEqual(_test.toValue(null), undefined);
  assert.deepEqual(_test.toValue(Number.NaN), { stringValue: 'NaN' });
  assert.deepEqual(_test.toValue([1, null, 'x']), { listValue: { values: [{ numberValue: 1 }, { stringValue: 'x' }] } });
  assert.deepEqual(_test.toValue({ a: null }).structValue.fields.a, { nullValue: 'NULL_VALUE' });
  assert.deepEqual(_test.toValue(Symbol.for('x')), { stringValue: 'Symbol(x)' });
  const payload = _test.buildQueryPayload({});
  assert.equal(payload.condition.time_to, 1700000000);
  assert.equal(payload.page.cur_page, 1);

  const logs = [];
  console.log = (...args) => logs.push(args);
  _test.logFlow({ instanceId: 'i', requestId: 'r' }, 'Action', { ok: true });
  const circular = {}; circular.self = circular;
  _test.logFlow({}, 'Fallback', circular);
  assert.match(logs[0][0], /\[ThreatBook_TDP_Host\]\[Action\]\[inst=i req=r\]/);
  assert.match(logs[1][0], /\[ThreatBook_TDP_Host\]\[Fallback\]/);
});

test('mock upstream handles query, auth, empty and failure cases', async () => {
  const server = await createMockServer();
  try {
    const ctx = buildCtx({ config: { restBaseUrl: server.url } });
    const ok = await handlers[METHOD_QUERY_FALL_HOST_FULL]({ keyword: '198.51.100' }, ctx);
    assert.equal(ok.response_code, 0);
    assert.equal(ok.item_count, 2);
    assert.equal(server.requests[0].headers['tdp-authentication'], 'test_tdp_token');

    const none = await handlers[METHOD_QUERY_FALL_HOST_FULL]({ keyword: 'none' }, ctx);
    assert.equal(none.item_count, 0);

    await expectGrpcError(() => handlers[METHOD_QUERY_FALL_HOST_FULL]({ keyword: 'biz_error' }, ctx), 'FAILED_PRECONDITION');
    await expectGrpcError(() => handlers[METHOD_QUERY_FALL_HOST_FULL]({ keyword: 'bad_json' }, ctx), 'UNKNOWN');
    await expectGrpcError(() => handlers[METHOD_QUERY_FALL_HOST_FULL]({ keyword: 'empty_body' }, ctx), 'UNKNOWN');
    await expectGrpcError(
      () => handlers[METHOD_QUERY_FALL_HOST_FULL]({}, buildCtx({ config: { restBaseUrl: server.url }, secret: { tdp_authentication: 'wrong' } })),
      'PERMISSION_DENIED',
    );
  } finally {
    await server.close();
  }
});
