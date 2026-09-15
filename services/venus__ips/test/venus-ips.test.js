import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  QUERY_IPS_LOG_PATH,
  PROBE_CONNECTIVITY_PATH,
  METHOD_PROBE_CONNECTIVITY_FULL,
  METHOD_QUERY_IPS_LOG_FULL,
  IPS_LOG_URI,
  LOG_PAGE_MARKER,
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
const invoke = (request, ctx) => handlers[METHOD_QUERY_IPS_LOG_FULL]({ ...ctx, request });

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

test('connectivity probe uses the same hardened upstream request', async () => {
  const mock = await createMockServer();
  try {
    const ctx = buildCtx(mock);
    const out = await handlers[METHOD_PROBE_CONNECTIVITY_FULL](ctx);
    assert.deepEqual(out, { reachable: true, http_status: 200 });
    assert.equal(mock.state.requests[0].cookie, mock.cookie);
    const viaRpcdef = await rpcdef(ctx)[PROBE_CONNECTIVITY_PATH]();
    assert.equal(viaRpcdef.reachable, true);
  } finally {
    await mock.close();
  }
});

test('connectivity probe maps network and HTTP failures without leaking details', async () => {
  const ctx = buildCtx({ host: 'https://ips', cookie: 'c=1' });
  withFetch(async () => { throw new Error('secret network detail'); });
  await assert.rejects(
    () => handlers[METHOD_PROBE_CONNECTIVITY_FULL](ctx),
    (e) => e.legacyCode === 'UNAVAILABLE' && !e.message.includes('secret'),
  );
  withFetch(async () => fakeResponse(401, 'secret response', false));
  await assert.rejects(
    () => handlers[METHOD_PROBE_CONNECTIVITY_FULL](ctx),
    (e) => e.legacyCode === 'PERMISSION_DENIED' && !e.message.includes('secret'),
  );
});

test('limit caps the number of returned entries', async () => {
  const mock = await createMockServer();
  try {
    const out = await invoke({ limit: 1 }, buildCtx(mock));
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
      () => invoke({}, buildCtx(mock, { bindings: { cookie: 'PHPSESSID=wrong' } })),
      (e) => e.legacyCode === 'FAILED_PRECONDITION',
    );
  } finally {
    await mock.close();
  }
});

// ---------- validation ----------

test('binding validation', async () => {
  await assert.rejects(() => invoke({}, buildCtx({ host: '' })), (e) => e.legacyCode === 'INVALID_ARGUMENT');
  await assert.rejects(() => invoke({}, buildCtx({ host: 'https://h', cookie: '' })), (e) => e.legacyCode === 'INVALID_ARGUMENT');
  await assert.rejects(() => invoke({ limit: -1 }, buildCtx({ host: 'https://h', cookie: 'c' })), (e) => e.legacyCode === 'INVALID_ARGUMENT');
  await assert.rejects(() => invoke({ limit: 10_001 }, buildCtx({ host: 'https://h', cookie: 'c' })), (e) => e.legacyCode === 'INVALID_ARGUMENT');
  await assert.rejects(() => invoke({}, buildCtx({ host: 'https://h', cookie: 'bad\r\nx: y' })), (e) => e.legacyCode === 'INVALID_ARGUMENT');
});

// ---------- error mapping ----------

test('error mapping: network / http', async () => {
  const ctx = buildCtx({ host: 'https://ips', cookie: 'c=1' });
  withFetch(async () => { throw new Error('ECONNREFUSED'); });
  await assert.rejects(() => invoke({}, ctx), (e) => e.legacyCode === 'UNAVAILABLE' && !e.message.includes('ECONNREFUSED'));
  withFetch(async () => fakeResponse(401, 'no', false));
  await assert.rejects(() => invoke({}, ctx), (e) => e.legacyCode === 'PERMISSION_DENIED' && !e.message.includes('no'));
  withFetch(async () => fakeResponse(404, 'no', false));
  await assert.rejects(() => invoke({}, ctx), (e) => e.legacyCode === 'FAILED_PRECONDITION');
  withFetch(async () => fakeResponse(500, 'no', false));
  await assert.rejects(() => invoke({}, ctx), (e) => e.legacyCode === 'UNAVAILABLE');
  withFetch(async () => fakeResponse(302, 'location secret', false));
  await assert.rejects(() => invoke({}, ctx), (e) => e.legacyCode === 'FAILED_PRECONDITION' && !e.message.includes('secret'));
});

test('early HTTP and declared-size failures cancel the upstream body', async () => {
  const ctx = buildCtx({ host: 'https://ips', cookie: 'c=1' }, { bindings: { maxResponseBytes: 1024 } });
  let cancellations = 0;
  const body = () => ({ cancel: async () => { cancellations += 1; } });

  withFetch(async () => ({ status: 500, ok: false, headers: createHeaders(), body: body() }));
  await assert.rejects(() => invoke({}, ctx), (e) => e.legacyCode === 'UNAVAILABLE');

  withFetch(async () => ({ status: 403, ok: false, headers: createHeaders(), body: body() }));
  await assert.rejects(
    () => handlers[METHOD_PROBE_CONNECTIVITY_FULL](ctx),
    (e) => e.legacyCode === 'PERMISSION_DENIED',
  );

  withFetch(async () => ({
    status: 200,
    ok: true,
    headers: createHeaders({ 'content-length': '2048' }),
    body: body(),
  }));
  await assert.rejects(() => invoke({}, ctx), (e) => e.legacyCode === 'RESOURCE_EXHAUSTED');
  assert.equal(cancellations, 3);

  await _test.cancelResponseBody({ body: { cancel: async () => { throw new Error('cancel failed'); } } });
});

test('fetch errors are redacted', async () => {
  const ctx = buildCtx({ host: 'https://ips', cookie: 'c=1' });
  withFetch(async () => { throw new Error('https://ips/?cookie=secret'); });
  await assert.rejects(() => invoke({}, ctx), (e) => e.legacyCode === 'UNAVAILABLE' && !e.message.includes('secret'));
});

test('timeout uses AbortSignal and insecure TLS uses an undici dispatcher', async () => {
  const ctx = buildCtx(
    { host: 'https://ips', cookie: 'c=1' },
    { bindings: { skipTlsVerify: true }, limits: { timeoutMs: 5 } },
  );
  withFetch(async (_url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    assert.ok(options.dispatcher);
    assert.equal('timeoutMs' in options, false);
    assert.equal('skipTlsVerify' in options, false);
    await new Promise((resolve) => options.signal.addEventListener('abort', resolve, { once: true }));
    throw new DOMException('aborted', 'AbortError');
  });
  await assert.rejects(() => invoke({}, ctx), (e) => e.legacyCode === 'UNAVAILABLE');
});

test('valid log page with zero data rows returns empty entries', async () => {
  const ctx = buildCtx({ host: 'https://ips', cookie: 'c=1' });
  withFetch(async () => fakeResponse(200, '<html><input name="module" value="ips_log_filter"><table><tr><th>名称</th></tr></table></html>'));
  const out = await invoke({}, ctx);
  assert.equal(out.total, 0);
  assert.deepEqual(out.entries, []);
});

test('malformed candidate log rows fail closed instead of returning incomplete data', async () => {
  const ctx = buildCtx({ host: 'https://ips', cookie: 'c=1' });
  const titledCells = (count, timeIndex) => '<tr>' + Array.from(
    { length: count },
    (_, i) => `<td title="${i === timeIndex ? '2026-01-02 03:04:05' : `x${i}`}">x</td>`,
  ).join('') + '</tr>';
  for (const row of [titledCells(15, 7), titledCells(13, 6), titledCells(14, 5)]) {
    withFetch(async () => fakeResponse(200, `<html>${LOG_PAGE_MARKER}<table><tr><th>header</th></tr>${row}</table></html>`));
    await assert.rejects(() => invoke({}, ctx), (e) => e.legacyCode === 'FAILED_PRECONDITION');
  }
});

test('response size and read failures are bounded and redacted', async () => {
  const ctx = buildCtx({ host: 'https://ips', cookie: 'c=1' }, { bindings: { maxResponseBytes: 1024 } });
  withFetch(async () => ({ status: 200, ok: true, headers: createHeaders({ 'content-length': '2048' }), text: async () => 'not read' }));
  await assert.rejects(() => invoke({}, ctx), (e) => e.legacyCode === 'RESOURCE_EXHAUSTED');

  withFetch(async (_url, options) => {
    assert.equal(options.redirect, 'manual');
    return fakeResponse(200, 'x'.repeat(1025));
  });
  await assert.rejects(() => invoke({}, ctx), (e) => e.legacyCode === 'RESOURCE_EXHAUSTED');

  withFetch(async () => ({
    status: 200, ok: true, headers: createHeaders(),
    text: async () => { throw new Error('secret response failure'); },
  }));
  await assert.rejects(() => invoke({}, ctx), (e) => e.legacyCode === 'UNAVAILABLE' && !e.message.includes('secret'));

  let cancelled = false;
  const values = [new Uint8Array(700), new Uint8Array(700)];
  withFetch(async () => ({
    status: 200, ok: true, headers: createHeaders(),
    body: { getReader: () => ({
      read: async () => (values.length ? { done: false, value: values.shift() } : { done: true }),
      cancel: async () => { cancelled = true; },
      releaseLock: () => {},
    }) },
  }));
  await assert.rejects(() => invoke({}, ctx), (e) => e.legacyCode === 'RESOURCE_EXHAUSTED');
  assert.equal(cancelled, true);
});

// ---------- service surface + helpers ----------

test('service exposes the QueryIpsLog handler', () => {
  assert.equal(typeof service.handlers[METHOD_QUERY_IPS_LOG_FULL], 'function');
  assert.equal(typeof service.handlers[METHOD_PROBE_CONNECTIVITY_FULL], 'function');
});

test('helper coverage', () => {
  const h = _test;
  assert.equal(h.normalizeBaseUrl('https://h/'), 'https://h');
  assert.equal(h.normalizeBaseUrl('ftp://x'), '');
  assert.equal(h.normalizeBaseUrl('https://user:pass@h'), '');
  assert.equal(h.normalizeBaseUrl('https://h/path'), '');
  assert.equal(h.resolveCookie({ session_cookie: 'c' }), 'c');
  assert.equal(h.resolveCookie({ sessionCookie: 'c2' }), 'c2');
  assert.equal(h.decodeEntities('a&amp;b&lt;c&gt;&quot;&#39;&nbsp;d'), 'a&b<c>"\' d');
  assert.equal(h.decodeEntities('&amp;lt; &amp;amp; &amp;quot;'), '&lt; &amp; &quot;');
  assert.equal(h.pickBoolean(true), true);
  assert.equal(h.pickBoolean(0), false);
  assert.equal(h.pickBoolean(undefined), undefined);

  // rowTitles + parseIpsLog
  const row = '<td>#</td><td title="名称X">名称X</td><td title="1.1.1.1">1.1.1.1</td>';
  assert.deepEqual(h.rowTitles(row), ['名称X', '1.1.1.1']);
  const html = '<tr><th>h</th></tr>'
    + '<tr><td>#</td>' + Array.from({ length: 14 }, (_, i) => `<td title="v${i}">v${i}</td>`).join('').replace('v6', '2026-01-02 03:04:05') + '</tr>';
  const parsed = h.parseIpsLog(html);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].name, 'v0');
  assert.equal(parsed.entries[0].time, '2026-01-02 03:04:05');
  assert.deepEqual({ skipped: parsed.skipped, structuralRows: parsed.structuralRows }, { skipped: 0, structuralRows: 1 });
  // a row without a datetime is skipped
  assert.equal(h.parseIpsLog('<tr>' + Array.from({ length: 14 }, (_, i) => `<td title="x${i}">x</td>`).join('') + '</tr>').skipped, 1);
  // Extra/missing titled cells and a datetime in the wrong column must not silently shift fields.
  const titledCells = (count, timeIndex) => '<tr>' + Array.from(
    { length: count },
    (_, i) => `<td title="${i === timeIndex ? '2026-01-02 03:04:05' : `x${i}`}">x</td>`,
  ).join('') + '</tr>';
  assert.equal(h.parseIpsLog(titledCells(15, 7)).skipped, 1);
  assert.equal(h.parseIpsLog(titledCells(13, 6)).skipped, 1);
  assert.equal(h.parseIpsLog(titledCells(14, 5)).skipped, 1);
  // A data row with no recognizable title cells is structural corruption.
  const untitled = '<tr><td>name</td><td>2026-01-02 03:04:05</td></tr>';
  assert.equal(h.parseIpsLog(untitled).skipped, 1);
  // limit
  const two = '<tr>' + Array.from({ length: 14 }, (_, i) => `<td title="${i === 6 ? '2026-01-02 03:04:05' : 'a'}">a</td>`).join('') + '</tr>';
  assert.equal(h.parseIpsLog(two + two, 1).entries.length, 1);
  assert.equal(h.parseIpsLog(two + titledCells(13, 6), 1).skipped, 1);

  assert.equal(h.pickInt({ a: '5' }, ['a'], 0), 5);
  assert.equal(h.pickInt({ a: '' }, ['a'], 9), 9);
  assert.equal(h.pickFirstString([null, '', 'y']), 'y');
  assert.equal(h.pickBoolean('off'), false);
  assert.equal(h.pickBoolean('maybe'), undefined);
  assert.equal(h.pickFirstBoolean(['x', 'true']), true);
  assert.equal(h.unwrapScalar({ value: { value: 2 } }), 2);
  assert.deepEqual(h.sanitizeHeaders({ A: 1, '': 2, Cookie: 'bad', 'X-B': 'bad\r\nx: y' }), { A: '1' });
  assert.deepEqual(h.sanitizeHeaders('x'), {});
  assert.ok(h.buildTlsOptions({ skipTlsVerify: true }).dispatcher);
  assert.deepEqual(h.buildTlsOptions({}), {});
  assert.equal(h.resolveTimeoutMs({ limits: { timeoutMs: 0 } }), 5000);
  assert.equal(h.resolveTimeoutMs({ limits: { timeoutMs: 321 } }), 321);
  assert.equal(h.resolveMaxResponseBytes({ bindings: { maxResponseBytes: 2048 } }), 2048);
  assert.equal(h.resolveMaxResponseBytes({ bindings: { maxResponseBytes: 1 } }), 2 * 1024 * 1024);
  assert.equal(h.grpcCodeFor('NOPE'), grpcStatus.UNKNOWN);
  assert.ok(h.errorWithCode('UNAVAILABLE', 'x') instanceof GrpcError);
  assert.throws(() => h.throwForHttpStatus(403), (e) => e.legacyCode === 'PERMISSION_DENIED');
  assert.throws(() => h.throwForHttpStatus(400), (e) => e.legacyCode === 'FAILED_PRECONDITION');
  assert.throws(() => h.throwForHttpStatus(500), (e) => e.legacyCode === 'UNAVAILABLE');
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
