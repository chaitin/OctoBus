import assert from 'node:assert/strict';
import test from 'node:test';
import { GrpcError } from '@chaitin-ai/octobus-sdk';
import { handlers, _test } from '../src/reportedip.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch, originalCL = console.log, originalCE = console.error;
const CHECK_RESP = { data: { ip: '8.8.8.8', abuseConfidencePercentage: 67, countryCode: 'US', usageType: 'Data Center', isp: 'GOOGLE', domain: 'dns.google', hostnames: ['dns.google'] } };
const ctx = (o = {}) => ({
  config: o.config ?? {},
  secret: o.secret ?? {},
  bindings: o.bindings ?? {},
  limits: { timeoutMs: 2000, ...(o.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(o.meta || {}) },
  ...(o.req !== undefined ? { req: o.req } : {}),
  ...(o.request !== undefined ? { request: o.request } : {}),
});
const resp = (s, b) => ({ ok: s >= 200 && s < 300, status: s, headers: { get: () => 'application/json' }, text: async () => (typeof b === 'string' ? b : JSON.stringify(b)) });
const setFetch = (i) => { globalThis.fetch = i; };
const expectErr = async (fn, code) => { let c; try { await fn(); } catch (err) { c = err; } assert.ok(c instanceof GrpcError); assert.equal(c.legacyCode, code); };

test.beforeEach(() => { console.log = () => {}; console.error = () => {}; });
test.afterEach(() => { globalThis.fetch = originalFetch; console.log = originalCL; console.error = originalCE; });

// ---- 服务注册与 handler 出口 ----
test('service exports handlers', () => { assert.equal(typeof handlers['ReportedIP.ReportedIP/CheckIP'], 'function'); assert.ok(service); });

// ---- 成功路径 ----
test('CheckIP returns reputation data', async () => {
  setFetch(async (url) => { assert.ok(url.includes('/check-public')); return resp(200, CHECK_RESP); });
  const r = await handlers['ReportedIP.ReportedIP/CheckIP']({ ...ctx(), request: { ip: '8.8.8.8' } });
  assert.equal(r.code, 0); assert.equal(r.abuse_confidence_percentage, 67); assert.equal(r.isp, 'GOOGLE');
});
test('CheckIP uses the configured ReportedIP API base URL', async () => {
  setFetch(async (url) => { assert.equal(url, 'http://127.0.0.1:4321/check-public?ip=8.8.8.8'); return resp(200, CHECK_RESP); });
  const r = await handlers['ReportedIP.ReportedIP/CheckIP']({ ...ctx({ config: { baseUrl: 'http://127.0.0.1:4321/' } }), request: { ip: '8.8.8.8' } });
  assert.equal(r.code, 0);
});

// ---- 参数校验 ----
test('CheckIP validates missing ip', async () => { await expectErr(() => handlers['ReportedIP.ReportedIP/CheckIP']({ ...ctx(), request: {} }), 'INVALID_ARGUMENT'); });
test('CheckIP validates IP format', async () => { await expectErr(() => handlers['ReportedIP.ReportedIP/CheckIP']({ ...ctx(), request: { ip: 'not-an-ip' } }), 'INVALID_ARGUMENT'); });
test('CheckIP accepts IPv6', async () => {
  setFetch(async (url) => { assert.ok(url.includes(encodeURIComponent('2001:4860:4860::8888'))); return resp(200, CHECK_RESP); });
  const r = await handlers['ReportedIP.ReportedIP/CheckIP']({ ...ctx(), request: { ip: '2001:4860:4860::8888' } });
  assert.equal(r.code, 0);
});
test('handler missing request defaults to empty', async () => { await expectErr(() => handlers['ReportedIP.ReportedIP/CheckIP'](ctx()), 'INVALID_ARGUMENT'); });

// ---- HTTP 状态映射（mapHttpError 分支）----
test('handles ordinary 4xx as FAILED_PRECONDITION', async () => {
  setFetch(async () => resp(400, ''));
  await expectErr(() => handlers['ReportedIP.ReportedIP/CheckIP']({ ...ctx(), request: { ip: '8.8.8.8' } }), 'FAILED_PRECONDITION');
});
test('handles authentication failures as PERMISSION_DENIED', async () => {
  setFetch(async () => resp(403, ''));
  await expectErr(() => handlers['ReportedIP.ReportedIP/CheckIP']({ ...ctx(), request: { ip: '8.8.8.8' } }), 'PERMISSION_DENIED');
});
test('handles 499 as FAILED_PRECONDITION', async () => {
  setFetch(async () => resp(499, ''));
  await expectErr(() => handlers['ReportedIP.ReportedIP/CheckIP']({ ...ctx(), request: { ip: '8.8.8.8' } }), 'FAILED_PRECONDITION');
});
test('handles 5xx as UNAVAILABLE', async () => {
  setFetch(async () => resp(500, ''));
  await expectErr(() => handlers['ReportedIP.ReportedIP/CheckIP']({ ...ctx(), request: { ip: '8.8.8.8' } }), 'UNAVAILABLE');
});
test('handles rate limiting as UNAVAILABLE', async () => {
  setFetch(async () => resp(429, ''));
  await expectErr(() => handlers['ReportedIP.ReportedIP/CheckIP']({ ...ctx(), request: { ip: '8.8.8.8' } }), 'UNAVAILABLE');
});
test('handles non-JSON 200 response', async () => {
  setFetch(async () => resp(200, 'not-json{{'));
  await expectErr(() => handlers['ReportedIP.ReportedIP/CheckIP']({ ...ctx(), request: { ip: '8.8.8.8' } }), 'UNKNOWN');
});
test('handles empty 200 response body', async () => {
  setFetch(async () => resp(200, ''));
  const r = await handlers['ReportedIP.ReportedIP/CheckIP']({ ...ctx(), request: { ip: '8.8.8.8' } });
  assert.equal(r.code, 0); assert.equal(r.ip, '8.8.8.8'); assert.equal(r.abuse_confidence_percentage, 0);
});

// ---- fetch 网络失败 / 超时（fetchJson catch 分支）----
test('handles network failure (plain error)', async () => {
  setFetch(async () => { throw new Error('network down'); });
  await expectErr(() => handlers['ReportedIP.ReportedIP/CheckIP']({ ...ctx(), request: { ip: '8.8.8.8' } }), 'UNAVAILABLE');
});
test('handles network failure (error with cause)', async () => {
  setFetch(async () => { throw new Error('wrapper', { cause: new Error('cause-down') }); });
  await expectErr(() => handlers['ReportedIP.ReportedIP/CheckIP']({ ...ctx(), request: { ip: '8.8.8.8' } }), 'UNAVAILABLE');
});
test('handles network failure (no message)', async () => {
  setFetch(async () => { throw {}; });
  await expectErr(() => handlers['ReportedIP.ReportedIP/CheckIP']({ ...ctx(), request: { ip: '8.8.8.8' } }), 'UNAVAILABLE');
});
test('times out when fetch hangs', async () => {
  setFetch((url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  await expectErr(() => handlers['ReportedIP.ReportedIP/CheckIP']({ ...ctx({ limits: { timeoutMs: 20 } }), request: { ip: '8.8.8.8' } }), 'UNAVAILABLE');
});

// ---- 数据字段缺失（runCheck 数据映射分支）----
test('maps response with missing data fields', async () => {
  setFetch(async () => resp(200, { data: { ip: '1.2.3.4' } }));
  const r = await handlers['ReportedIP.ReportedIP/CheckIP']({ ...ctx(), request: { ip: '8.8.8.8' } });
  assert.equal(r.ip, '1.2.3.4'); assert.equal(r.abuse_confidence_percentage, 0); assert.equal(r.hostnames.length, 0);
});
test('maps response with no data object', async () => {
  setFetch(async () => resp(200, {}));
  const r = await handlers['ReportedIP.ReportedIP/CheckIP']({ ...ctx(), request: { ip: '8.8.8.8' } });
  assert.equal(r.ip, '8.8.8.8'); assert.equal(r.abuse_confidence_percentage, 0);
});
test('normalizes upstream values to protobuf-compatible types', async () => {
  setFetch(async () => resp(200, { data: {
    ip: 1234,
    abuseConfidencePercentage: '67',
    countryCode: 1,
    usageType: false,
    isp: 42,
    domain: null,
    hostnames: ['dns.google', 7, null],
  } }));
  const r = await handlers['ReportedIP.ReportedIP/CheckIP']({ ...ctx(), request: { ip: '8.8.8.8' } });
  assert.equal(r.ip, '1234');
  assert.equal(r.abuse_confidence_percentage, 67);
  assert.equal(r.country_code, '1');
  assert.equal(r.usage_type, 'false');
  assert.equal(r.isp, '42');
  assert.equal(r.domain, '');
  assert.deepEqual(r.hostnames, ['dns.google', '7', '']);
});
test('rejects non-integer confidence and non-array hostnames', async () => {
  setFetch(async () => resp(200, { data: { abuseConfidencePercentage: 67.5, hostnames: 'dns.google' } }));
  const r = await handlers['ReportedIP.ReportedIP/CheckIP']({ ...ctx(), request: { ip: '8.8.8.8' } });
  assert.equal(r.abuse_confidence_percentage, 0);
  assert.deepEqual(r.hostnames, []);
});
test('uses default timeout when timeoutMs is falsy', async () => {
  setFetch(async () => resp(200, CHECK_RESP));
  const r = await handlers['ReportedIP.ReportedIP/CheckIP']({ ...ctx({ limits: { timeoutMs: 0 } }), request: { ip: '8.8.8.8' } });
  assert.equal(r.code, 0);
});

// ---- 辅助函数直接单测 ----
test('unwrapString covers all shapes', () => {
  assert.equal(_test.unwrapString(undefined), '');
  assert.equal(_test.unwrapString(null), '');
  assert.equal(_test.unwrapString('abc'), 'abc');
  assert.equal(_test.unwrapString(123), '123');
  assert.equal(_test.unwrapString({ value: 'x' }), 'x');
  assert.equal(_test.unwrapString({ value: { value: 'y' } }), 'y');
  assert.equal(_test.unwrapString({}), '[object Object]');
});
test('hasOwn covers null and presence', () => {
  assert.equal(_test.hasOwn({ a: 1 }, 'a'), true);
  assert.equal(_test.hasOwn({ a: 1 }, 'b'), false);
  assert.equal(_test.hasOwn(null, 'x'), false);
  assert.equal(_test.hasOwn(undefined, 'x'), false);
});
test('firstDefined covers all positions', () => {
  assert.equal(_test.firstDefined(undefined, null, 'x'), 'x');
  assert.equal(_test.firstDefined('a', 'b'), 'a');
  assert.equal(_test.firstDefined(null, 'b'), 'b');
  assert.equal(_test.firstDefined(undefined, undefined), undefined);
  assert.equal(_test.firstDefined(null, null), undefined);
});
test('parseJson covers empty, valid and invalid', () => {
  assert.deepEqual(_test.parseJson('{"a":1}'), { a: 1 });
  assert.equal(_test.parseJson(''), null);
  assert.equal(_test.parseJson(null), null);
  assert.equal(_test.parseJson(undefined), null);
  assert.equal(_test.parseJson('   '), null);
  assert.throws(() => _test.parseJson('not-json'), GrpcError);
});
test('mapHttpError covers all status ranges', () => {
  assert.equal(_test.mapHttpError({ status: 200 }).legacyCode, 'UNAVAILABLE');
  assert.equal(_test.mapHttpError({ status: 400 }).legacyCode, 'FAILED_PRECONDITION');
  assert.equal(_test.mapHttpError({ status: 401 }).legacyCode, 'PERMISSION_DENIED');
  assert.equal(_test.mapHttpError({ status: 403 }).legacyCode, 'PERMISSION_DENIED');
  assert.equal(_test.mapHttpError({ status: 429 }).legacyCode, 'UNAVAILABLE');
  assert.equal(_test.mapHttpError({ status: 499 }).legacyCode, 'FAILED_PRECONDITION');
  assert.equal(_test.mapHttpError({ status: 500 }).legacyCode, 'UNAVAILABLE');
});
test('resolveBaseUrl accepts HTTP(S) URLs and rejects invalid schemes', () => {
  assert.equal(_test.resolveBaseUrl({ baseUrl: 'https://api.example.test/path/' }), 'https://api.example.test/path');
  assert.equal(_test.resolveBaseUrl({ baseUrl: 'http://127.0.0.1:1234' }), 'http://127.0.0.1:1234');
  assert.throws(() => _test.resolveBaseUrl({ baseUrl: 'not a URL' }), GrpcError);
  assert.throws(() => _test.resolveBaseUrl({ baseUrl: 'file:///tmp/reportedip' }), GrpcError);
});
test('responseString normalizes nullish and scalar values', () => {
  assert.equal(_test.responseString(undefined), '');
  assert.equal(_test.responseString(null), '');
  assert.equal(_test.responseString(0), '0');
  assert.equal(_test.responseString(false), 'false');
});
test('errorWithCode sets legacyCode and falls back for unknown code', () => {
  const a = _test.errorWithCode('INVALID_ARGUMENT', 'x');
  assert.equal(a.legacyCode, 'INVALID_ARGUMENT');
  const b = _test.errorWithCode('NONEXISTENT_CODE', 'x');
  assert.equal(b.legacyCode, 'NONEXISTENT_CODE');
  assert.ok(b instanceof GrpcError);
});
test('logInfo/logError handle normal and circular payloads', () => {
  _test.logInfo({}, 'a', { x: 1 });
  _test.logError({}, 'a', { x: 1 });
  const circ = {}; circ.self = circ;
  _test.logInfo({}, 'a', circ);
  _test.logError({}, 'a', circ);
});
test('resolveCallContext covers missing/partial ctx', () => {
  const d = _test.resolveCallContext();
  assert.deepEqual(d.bindings, {});
  assert.deepEqual(d.limits, {});
  assert.deepEqual(d.meta, {});
  assert.deepEqual(d.req, {});
  const r = _test.resolveCallContext({ req: { ip: '1.1.1.1' } });
  assert.equal(r.req.ip, '1.1.1.1');
  const q = _test.resolveCallContext({ request: { ip: '2.2.2.2' } });
  assert.equal(q.req.ip, '2.2.2.2');
  const m = _test.resolveCallContext({ config: null, secret: null, bindings: null, limits: { t: 1 }, meta: { m: 1 } });
  assert.deepEqual(m.bindings, {});
  assert.deepEqual(m.limits, { t: 1 });
});
test('resolveTimeoutMs covers limits/bindings/default', () => {
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: 500 } }, {}), 500);
  assert.equal(_test.resolveTimeoutMs({ limits: {} }, { timeoutMs: 300 }), 300);
  assert.equal(_test.resolveTimeoutMs({}, {}), 10000);
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: 0 } }, {}), 0);
});
test('makeRuntime exposes runCheck', () => {
  const rt = _test.makeRuntime({});
  assert.equal(typeof rt.runCheck, 'function');
});
