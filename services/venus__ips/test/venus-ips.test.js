import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  QUERY_IPS_LOG_PATH,
  METHOD_QUERY_IPS_LOG_FULL,
  IPS_LOG_URI,
  _test,
  handlers,
  rpcdef,
} from '../src/venus-ips.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;
let seq = 0;
const nextId = () => `inst-${++seq}`;

const buildCtx = (mock, overrides = {}) => ({
  bindings: { host: mock?.host, cookie: mock?.cookie, ...(overrides.bindings || {}) },
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

test('parses IPS log HTML into structured entries', async () => {
  const mock = await createMockServer();
  try {
    const out = await rpcdef(buildCtx(mock))[QUERY_IPS_LOG_PATH]({});
    assert.equal(out.http_status, 200);
    assert.equal(out.total, mock.rowCount);
    const first = out.entries[0];
    assert.equal(first.name, 'TCP_可疑行为_安全风险_MYSQL_查询系统变量');
    assert.equal(first.src_ip, '198.51.100.10');
    assert.equal(first.src_port, '60782');
    assert.equal(first.dst_ip, '203.0.113.5');
    assert.equal(first.protocol, 'TCP');
    assert.equal(first.time, '2026-06-25 17:49:45');
    assert.equal(first.severity, '中');
    assert.equal(first.action, 'PASS');
    assert.equal(first.count, '3');
    assert.equal(out.entries[1].content, '备注X');
    // request shape
    const r = mock.state.requests[0];
    assert.equal(r.method, 'GET');
    assert.equal(r.url, IPS_LOG_URI);
    assert.equal(r.cookie, mock.cookie);
  } finally {
    await mock.close();
  }
});

test('limit caps the number of returned entries', async () => {
  const mock = await createMockServer();
  try {
    const out = await handlers[METHOD_QUERY_IPS_LOG_FULL]({ limit: 1 }, buildCtx(mock));
    assert.equal(out.total, 1);
    assert.equal(out.entries.length, 1);
  } finally {
    await mock.close();
  }
});

test('expired session (login page, no marker) -> FAILED_PRECONDITION', async () => {
  const mock = await createMockServer();
  try {
    await assert.rejects(
      () => handlers[METHOD_QUERY_IPS_LOG_FULL]({}, buildCtx(mock, { bindings: { cookie: 'PHPSESSID=wrong' } })),
      (e) => e.legacyCode === 'FAILED_PRECONDITION',
    );
  } finally {
    await mock.close();
  }
});

// ---------- validation ----------

test('binding validation', async () => {
  await assert.rejects(() => handlers[METHOD_QUERY_IPS_LOG_FULL]({}, buildCtx({ host: '' })), (e) => e.legacyCode === 'INVALID_ARGUMENT');
  await assert.rejects(() => handlers[METHOD_QUERY_IPS_LOG_FULL]({}, buildCtx({ host: 'https://h', cookie: '' })), (e) => e.legacyCode === 'INVALID_ARGUMENT');
});

// ---------- error mapping ----------

test('error mapping: network / http', async () => {
  const ctx = buildCtx({ host: 'https://ips', cookie: 'c=1' });
  withFetch(async () => { throw new Error('ECONNREFUSED'); });
  await assert.rejects(() => handlers[METHOD_QUERY_IPS_LOG_FULL]({}, ctx), (e) => e.legacyCode === 'UNAVAILABLE');
  withFetch(async () => fakeResponse(401, 'no', false));
  await assert.rejects(() => handlers[METHOD_QUERY_IPS_LOG_FULL]({}, ctx), (e) => e.legacyCode === 'PERMISSION_DENIED');
  withFetch(async () => fakeResponse(404, 'no', false));
  await assert.rejects(() => handlers[METHOD_QUERY_IPS_LOG_FULL]({}, ctx), (e) => e.legacyCode === 'FAILED_PRECONDITION');
  withFetch(async () => fakeResponse(500, 'no', false));
  await assert.rejects(() => handlers[METHOD_QUERY_IPS_LOG_FULL]({}, ctx), (e) => e.legacyCode === 'UNAVAILABLE');
});

test('fetch error fallback message', async () => {
  const ctx = buildCtx({ host: 'https://ips', cookie: 'c=1' });
  withFetch(async () => { throw {}; });
  await assert.rejects(() => handlers[METHOD_QUERY_IPS_LOG_FULL]({}, ctx), (e) => /fetch failed/.test(e.message));
  withFetch(async () => { const e = new Error('m'); e.cause = { message: 'deep' }; throw e; });
  await assert.rejects(() => handlers[METHOD_QUERY_IPS_LOG_FULL]({}, ctx), (e) => /deep/.test(e.message));
});

test('valid log page with zero data rows returns empty entries', async () => {
  const ctx = buildCtx({ host: 'https://ips', cookie: 'c=1' });
  withFetch(async () => fakeResponse(200, '<html><input name="module" value="ips_log_filter"><table><tr><th>名称</th></tr></table></html>'));
  const out = await handlers[METHOD_QUERY_IPS_LOG_FULL]({}, ctx);
  assert.equal(out.total, 0);
  assert.deepEqual(out.entries, []);
});

// ---------- service surface + helpers ----------

test('service exposes the QueryIpsLog handler', () => {
  assert.equal(typeof service.handlers[METHOD_QUERY_IPS_LOG_FULL], 'function');
});

test('helper coverage', () => {
  const h = _test;
  assert.equal(h.normalizeBaseUrl('https://h/'), 'https://h');
  assert.equal(h.normalizeBaseUrl('ftp://x'), '');
  assert.equal(h.resolveCookie({ session_cookie: 'c' }), 'c');
  assert.equal(h.resolveCookie({ sessionCookie: 'c2' }), 'c2');
  assert.equal(h.decodeEntities('a&amp;b&lt;c&gt;&quot;&#39;&nbsp;d'), 'a&b<c>"\' d');
  assert.equal(h.pickBoolean(true), true);
  assert.equal(h.pickBoolean(0), false);
  assert.equal(h.pickBoolean(undefined), undefined);

  // rowTitles + parseIpsLog
  const row = '<td>#</td><td title="名称X">名称X</td><td title="1.1.1.1">1.1.1.1</td>';
  assert.deepEqual(h.rowTitles(row), ['名称X', '1.1.1.1']);
  const html = '<tr><th>h</th></tr>'
    + '<tr><td>#</td>' + Array.from({ length: 14 }, (_, i) => `<td title="v${i}">v${i}</td>`).join('').replace('v6', '2026-01-02 03:04:05') + '</tr>';
  const parsed = h.parseIpsLog(html);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, 'v0');
  assert.equal(parsed[0].time, '2026-01-02 03:04:05');
  // a row without a datetime is skipped
  assert.equal(h.parseIpsLog('<tr>' + Array.from({ length: 14 }, (_, i) => `<td title="x${i}">x</td>`).join('') + '</tr>').length, 0);
  // limit
  const two = '<tr>' + Array.from({ length: 14 }, (_, i) => `<td title="${i === 6 ? '2026-01-02 03:04:05' : 'a'}">a</td>`).join('') + '</tr>';
  assert.equal(h.parseIpsLog(two + two, 1).length, 1);

  assert.equal(h.pickInt({ a: '5' }, ['a'], 0), 5);
  assert.equal(h.pickInt({ a: '' }, ['a'], 9), 9);
  assert.equal(h.pickFirstString([null, '', 'y']), 'y');
  assert.equal(h.pickBoolean('off'), false);
  assert.equal(h.pickBoolean('maybe'), undefined);
  assert.equal(h.pickFirstBoolean(['x', 'true']), true);
  assert.equal(h.unwrapScalar({ value: { value: 2 } }), 2);
  assert.deepEqual(h.sanitizeHeaders({ A: 1, '': 2 }), { A: '1' });
  assert.deepEqual(h.sanitizeHeaders('x'), {});
  assert.equal(h.buildTlsOptions({ skipTlsVerify: true }).skipTlsVerify, true);
  assert.deepEqual(h.buildTlsOptions({}), {});
  assert.equal(h.resolveTimeoutMs({ limits: { timeoutMs: 0 } }), 5000);
  assert.equal(h.resolveTimeoutMs({ limits: { timeoutMs: 321 } }), 321);
  assert.equal(h.grpcCodeFor('NOPE'), grpcStatus.UNKNOWN);
  assert.ok(h.errorWithCode('UNAVAILABLE', 'x') instanceof GrpcError);
  assert.throws(() => h.throwForHttpStatus(403, 'x'), (e) => e.legacyCode === 'PERMISSION_DENIED');
  assert.throws(() => h.throwForHttpStatus(400, 'x'), (e) => e.legacyCode === 'FAILED_PRECONDITION');
  assert.throws(() => h.throwForHttpStatus(500, 'x'), (e) => e.legacyCode === 'UNAVAILABLE');
  const hdr = h.buildHeaders({ headers: { 'X-A': '1' } }, { instance_id: 'i', request_id: 'r' }, 'c=1');
  assert.equal(hdr.cookie, 'c=1');
  assert.equal(hdr['X-A'], '1');
  assert.deepEqual(h.resolveCallContext({ request: { a: 1 } }).req, { a: 1 });
  assert.deepEqual(h.resolveCallContext({}).req, {});
});

test('rpcdef falls back to ctx.req when called without an argument', async () => {
  const mock = await createMockServer();
  try {
    const out = await rpcdef(buildCtx(mock, { req: { limit: 1 } }))[QUERY_IPS_LOG_PATH]();
    assert.equal(out.total, 1);
  } finally {
    await mock.close();
  }
});
