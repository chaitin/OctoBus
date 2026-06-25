import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  QUERY_MACHINE_PATH,
  METHOD_QUERY_MACHINE_FULL,
  MACHINE_MENU_CODE,
  _test,
  handlers,
  rpcdef,
} from '../src/qianxin-cloudlock-v8-0-8.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;
let seq = 0;
const nextId = () => `inst-${++seq}`;

const buildCtx = (mock, overrides = {}) => ({
  bindings: { host: mock?.host, token: mock?.token, ...(overrides.bindings || {}) },
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

test('machine list query succeeds and sends the real-device request shape', async () => {
  const mock = await createMockServer();
  try {
    const out = await rpcdef(buildCtx(mock))[QUERY_MACHINE_PATH]({ current_page: 1, max_results: 20, group_uuid: 'g-1', online_status: '1' });
    assert.equal(out.code, '1');
    assert.equal(out.msg, '成功');
    assert.equal(out.total, 1);
    assert.equal(out.http_status, 200);

    const r = mock.state.requests[0];
    // headers
    assert.equal(r.headers.token, mock.token);
    assert.equal(r.headers.menucode, MACHINE_MENU_CODE);
    assert.equal(r.headers.origin, mock.host);
    assert.equal(r.headers.referer, `${mock.host}/assets-management/host-management?tabtype=0`);
    // body: camelCase fields, defaults present, filters mapped
    assert.deepEqual(r.body.searchInfoList, []);
    assert.equal(r.body.currentPage, 1);
    assert.equal(r.body.maxResults, 20);
    assert.equal(r.body.ifShowCurrentGroupInfo, 0);
    assert.equal(r.body.groupUuid, 'g-1');
    assert.equal(r.body.onlineStatus, '1');
    assert.equal(r.body.kernelVersion, '');
    assert.equal(r.body.machineGroup, '');
  } finally {
    await mock.close();
  }
});

test('camelCase / page aliases also accepted; defaults applied', async () => {
  const mock = await createMockServer();
  try {
    await handlers[METHOD_QUERY_MACHINE_FULL]({ page: 3, pageSize: 50, groupUuid: 'g-2' }, buildCtx(mock));
    const b = mock.state.requests[0].body;
    assert.equal(b.currentPage, 3);
    assert.equal(b.maxResults, 50);
    assert.equal(b.groupUuid, 'g-2');
  } finally {
    await mock.close();
  }
});

// ---------- validation ----------

test('binding validation', async () => {
  await assert.rejects(() => handlers[METHOD_QUERY_MACHINE_FULL]({}, buildCtx({ host: '' })), (e) => e.legacyCode === 'INVALID_ARGUMENT');
  await assert.rejects(() => handlers[METHOD_QUERY_MACHINE_FULL]({}, buildCtx({ host: 'https://h:443', token: '' })), (e) => e.legacyCode === 'INVALID_ARGUMENT');
});

// ---------- error mapping ----------

test('error mapping: auth / network / http / empty / non-json / semantic', async () => {
  const ctx = buildCtx({ host: 'https://cl:443', token: 't' });
  withFetch(async () => fakeResponse(401, 'no', false));
  await assert.rejects(() => handlers[METHOD_QUERY_MACHINE_FULL]({}, ctx), (e) => e.legacyCode === 'PERMISSION_DENIED');
  withFetch(async () => fakeResponse(404, 'no', false));
  await assert.rejects(() => handlers[METHOD_QUERY_MACHINE_FULL]({}, ctx), (e) => e.legacyCode === 'FAILED_PRECONDITION');
  withFetch(async () => fakeResponse(502, 'no', false));
  await assert.rejects(() => handlers[METHOD_QUERY_MACHINE_FULL]({}, ctx), (e) => e.legacyCode === 'UNAVAILABLE');
  withFetch(async () => { throw new Error('ECONNREFUSED'); });
  await assert.rejects(() => handlers[METHOD_QUERY_MACHINE_FULL]({}, ctx), (e) => e.legacyCode === 'UNAVAILABLE');
  withFetch(async () => fakeResponse(200, '   '));
  await assert.rejects(() => handlers[METHOD_QUERY_MACHINE_FULL]({}, ctx), (e) => e.legacyCode === 'UNKNOWN');
  withFetch(async () => fakeResponse(200, 'not-json'));
  await assert.rejects(() => handlers[METHOD_QUERY_MACHINE_FULL]({}, ctx), (e) => e.legacyCode === 'UNKNOWN');
  // code != "1" → FAILED_PRECONDITION with device msg
  withFetch(async () => fakeResponse(200, JSON.stringify({ code: '0', msg: '会话失效' })));
  await assert.rejects(() => handlers[METHOD_QUERY_MACHINE_FULL]({}, ctx), (e) => e.legacyCode === 'FAILED_PRECONDITION' && /会话失效/.test(e.message));
});

test('fetch error fallback message', async () => {
  const ctx = buildCtx({ host: 'https://cl:443', token: 't' });
  withFetch(async () => { throw {}; });
  await assert.rejects(() => handlers[METHOD_QUERY_MACHINE_FULL]({}, ctx), (e) => /fetch failed/.test(e.message));
  withFetch(async () => { const e = new Error('m'); e.cause = { message: 'deep' }; throw e; });
  await assert.rejects(() => handlers[METHOD_QUERY_MACHINE_FULL]({}, ctx), (e) => /deep/.test(e.message));
});

// ---------- service surface + helpers ----------

test('service exposes the QueryMachineList handler', () => {
  assert.equal(typeof service.handlers[METHOD_QUERY_MACHINE_FULL], 'function');
});

test('helper coverage', () => {
  const h = _test;
  assert.equal(h.normalizeBaseUrl('https://h:443/'), 'https://h:443');
  assert.equal(h.normalizeBaseUrl('ftp://x'), '');
  assert.equal(h.resolveToken({ session_token: 't' }), 't');
  assert.equal(h.resolveToken({ sessionToken: 't2' }), 't2');

  const body = h.buildMachineListBody({ current_page: 2, max_results: 10, group_uuid: 'g', if_show_current_group_info: 1, os_type: 'linux', search_info_list: ['x'] });
  assert.equal(body.currentPage, 2);
  assert.equal(body.maxResults, 10);
  assert.equal(body.ifShowCurrentGroupInfo, 1);
  assert.equal(body.osType, 'linux');
  assert.deepEqual(body.searchInfoList, ['x']);
  assert.equal(body.diskUsage, '');
  // defaults when empty
  const d = h.buildMachineListBody({});
  assert.equal(d.currentPage, 1);
  assert.equal(d.maxResults, 20);
  assert.deepEqual(d.searchInfoList, []);

  assert.equal(h.isSuccess({ code: '1' }), true);
  assert.equal(h.isSuccess({ code: 1 }), true);
  assert.equal(h.isSuccess({ code: '0' }), false);
  assert.equal(h.isSuccess({}), false);
  assert.equal(h.extractTotal({ data: { total: 9 } }), 9);
  assert.equal(h.extractTotal({}), 0);

  assert.equal(h.pickInt({ a: '5' }, ['a'], 0), 5);
  assert.equal(h.pickInt({ a: '' }, ['a'], 9), 9);
  assert.equal(h.pickString({ a: 0 }, ['a']), '0');
  assert.equal(h.pickString({}, ['a']), '');
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
  const hdr = h.buildHeaders({ headers: { 'X-A': '1' } }, { instance_id: 'i', request_id: 'r' }, { host: 'https://h', token: 'tok', menuCode: '5101', refererPath: '/p' });
  assert.equal(hdr.token, 'tok');
  assert.equal(hdr.menuCode, '5101');
  assert.equal(hdr.referer, 'https://h/p');
  assert.equal(hdr['X-A'], '1');
  assert.deepEqual(h.resolveCallContext({ request: { a: 1 } }).req, { a: 1 });
  assert.deepEqual(h.resolveCallContext({}).req, {});
});

test('rpcdef falls back to ctx.req when called without an argument', async () => {
  const mock = await createMockServer();
  try {
    await rpcdef(buildCtx(mock, { req: { current_page: 4, group_uuid: 'ctx-g' } }))[QUERY_MACHINE_PATH]();
    const b = mock.state.requests[0].body;
    assert.equal(b.currentPage, 4);
    assert.equal(b.groupUuid, 'ctx-g');
  } finally {
    await mock.close();
  }
});
