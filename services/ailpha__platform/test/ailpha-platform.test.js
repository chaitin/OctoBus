import test from 'node:test';
import assert from 'node:assert/strict';

const PKG = 'AiLPHA_Platform.AiLPHA_Platform';
const listAlarmsPath = `/${PKG}/ListMergeAlarms`;
const detailPath = `/${PKG}/GetMergeAlarmDetail`;
const statusPath = `/${PKG}/UpdateMergeAlarmStatus`;
const listLinkagePath = `/${PKG}/ListLinkageStrategies`;
const blockPath = `/${PKG}/BlockIp`;
const unblockPath = `/${PKG}/UnblockIp`;

const buildCtx = (req = {}, overrides = {}) => ({
  bindings: { endpoint: 'https://ailpha.example.com', apiKey: 'key-1', ...overrides.bindings },
  limits: { timeoutMs: 10_000, ...overrides.limits },
  meta: { instance_id: 'inst', request_id: 'req', ...overrides.meta },
  req,
});

const setFetch = (impl) => {
  global.fetch = async (url, init) => {
    const out = await impl(url, init);
    if (out && out.throwNetwork) throw new Error(out.throwNetwork);
    const status = out?.status ?? 200;
    const text = out?.raw !== undefined ? out.raw : JSON.stringify(out?.body ?? {});
    return { ok: status >= 200 && status < 300, status, async text() { return text; } };
  };
};

const loadRpc = async (req, overrides = {}) => {
  const { rpcdef } = await import('../src/ailpha-platform.js');
  return rpcdef(buildCtx(req, overrides));
};

const ok = (body) => ({ body });

test('internal helpers: bindings, headers, conversions, struct, ids', async () => {
  const { _test } = await import('../src/ailpha-platform.js');

  assert.deepEqual(_test.mergedBindings({
    config: { endpoint: 'http://c', keep: 'c' }, secret: { apiKey: 's' }, bindings: { endpoint: 'http://b' },
  }), { endpoint: 'http://b', keep: 'c', apiKey: 's' });

  assert.deepEqual(_test.parseHeaders('{"X":"1"}'), { X: '1' });
  assert.deepEqual(_test.parseHeaders('{bad'), {});
  assert.deepEqual(_test.parseHeaders('[1]'), {});
  assert.deepEqual(_test.parseHeaders(['x']), {});
  assert.equal(_test.normalizeBaseUrl('https://h/'), 'https://h');
  assert.equal(_test.normalizeBaseUrl('ftp://x'), null);

  assert.equal(_test.toOptionalString({ value: 'x' }), 'x');
  assert.equal(_test.toOptionalString(''), undefined);
  assert.equal(_test.toInt({ value: '7' }), 7);
  assert.equal(_test.toInt('bad'), 0);
  assert.equal(_test.toOptionalBool('true'), true);
  assert.equal(_test.toOptionalBool(0), false);
  assert.equal(_test.toOptionalBool(undefined), undefined);
  assert.equal(_test.toOptionalBool('1'), true);
  assert.equal(_test.toOptionalBool('0'), false);
  assert.equal(_test.toOptionalBool('maybe'), undefined);
  assert.equal(_test.toOptionalString(null), undefined);

  assert.equal(_test.toPageSize(undefined, 'page'), undefined);
  assert.equal(_test.toPageSize(0, 'page'), undefined);
  assert.equal(_test.toPageSize(2, 'page'), 2);
  assert.throws(() => _test.toPageSize(0.5, 'page'), /must be an integer/);
  assert.throws(() => _test.toPageSize(-1, 'page'), /page must be >= 1/);
  assert.throws(() => _test.toPageSize(5000, 'size'), /size must be in/);

  assert.deepEqual(_test.normalizeStruct({ a: 1 }), { a: 1 });
  assert.deepEqual(_test.normalizeStruct('x'), {});

  assert.deepEqual(_test.requireIds({ ids: [' a ', 'b'] }), ['a', 'b']);
  assert.throws(() => _test.requireIds({ ids: 'x' }), /must be a non-empty array/);
  assert.throws(() => _test.requireIds({ ids: [] }), /non-empty/);
  assert.throws(() => _test.requireIds({ ids: [''] }), /non-empty strings/);
  assert.throws(() => _test.requireIds({ ids: ['a/b'] }), /must not contain/);

  assert.deepEqual(_test.mapListResponse({ $page: 1, $size: 10, total: 3, data: [{ a: 1 }, 'x'], $orderBy: 'endTime desc' }),
    { page: 1, size: 10, total: 3, data: [{ a: 1 }, {}], order_by: 'endTime desc' });
  assert.deepEqual(_test.mapWriteResponse({ $page: 0, $size: 0, data: 'done' }), { page: 0, size: 0, data: 'done' });

  assert.equal(_test.requireNonEmpty('a', 'f'), 'a');
  assert.throws(() => _test.requireNonEmpty('', 'f'), /f is required/);
});

test('ListMergeAlarms builds query (incl ALL->omit) and maps data', async () => {
  let url;
  setFetch((u, init) => {
    url = u; assert.equal(init.method, 'GET');
    assert.equal(init.headers.apiKey, 'key-1');
    assert.equal(init.headers['x-request-id'], 'req');
    return ok({ $page: 1, $size: 10, total: 2, data: [{ alarmName: ['x'] }, { alarmName: ['y'] }], $orderBy: 'endTime desc' });
  });
  const out = await (await loadRpc({ page: 1, size: 10, condition: 'srcAddress="1.1.1.1"', connect_type: 'ALL', order_by: 'endTime desc', field_mapping: true }))[listAlarmsPath]();
  assert.equal(out.total, 2);
  assert.equal(out.data.length, 2);
  assert.match(url, /\/openapi\/v2\.0\/merge-alarms\?/);
  assert.match(url, /%24page=1/);
  assert.match(url, /condition=srcAddress/);
  assert.match(url, /fieldMapping=true/);
  assert.ok(!/connectType/.test(url)); // ALL omitted
});

test('ListMergeAlarms passes DIRECT_CONNECT and rejects bad connect_type/paging', async () => {
  let url;
  setFetch((u) => { url = u; return ok({ $page: 1, $size: 10, total: 0, data: [] }); });
  await (await loadRpc({ connect_type: 'DIRECT_CONNECT' }))[listAlarmsPath]();
  assert.match(url, /connectType=DIRECT_CONNECT/);

  await assert.rejects((await loadRpc({ connect_type: 'BOGUS' }))[listAlarmsPath](), /connect_type must be one of/);
  await assert.rejects((await loadRpc({ page: -1 }))[listAlarmsPath](), /page must be >= 1/);
});

test('GetMergeAlarmDetail requires agg_condition + window_id, maps detail', async () => {
  let url;
  setFetch((u) => { url = u; return ok({ baasAlarmUuid: 'abc', alarmName: 'x' }); });
  const out = await (await loadRpc({ agg_condition: 'md5x', window_id: 'w1' }))[detailPath]();
  assert.deepEqual(out.detail, { baasAlarmUuid: 'abc', alarmName: 'x' });
  assert.match(url, /aggCondition=md5x/);
  assert.match(url, /windowId=w1/);

  await assert.rejects((await loadRpc({ window_id: 'w1' }))[detailPath](), /agg_condition is required/);
  await assert.rejects((await loadRpc({ agg_condition: 'm' }))[detailPath](), /window_id is required/);
});

test('UpdateMergeAlarmStatus requires alarm_status + selector, builds body', async () => {
  let body;
  setFetch((u, init) => {
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['content-type'], 'application/json');
    body = JSON.parse(init.body);
    return ok({ $page: 0, $size: 0, data: '归并告警批量处置中' });
  });
  const out = await (await loadRpc({ alarm_status: 'falsePositives', alarm_notes: 'fp', start_time: '2023-07-01 00:00:00', end_time: '2023-07-01 23:59:59' }))[statusPath]();
  assert.equal(out.data, '归并告警批量处置中');
  assert.deepEqual(body, { alarmStatus: 'falsePositives', alarmNotes: 'fp', startTime: '2023-07-01 00:00:00', endTime: '2023-07-01 23:59:59' });

  await assert.rejects((await loadRpc({ alarm_notes: 'x', condition: 'c' }))[statusPath](), /alarm_status is required/);
  await assert.rejects((await loadRpc({ alarm_status: 'processed' }))[statusPath](), /provide condition, or both start_time and end_time/);

  // condition-only selector works
  let body2;
  setFetch((u, init) => { body2 = JSON.parse(init.body); return ok({ $page: 0, $size: 0, data: 'ok' }); });
  await (await loadRpc({ alarm_status: 'processed', condition: 'alarmName="x"' }))[statusPath]();
  assert.deepEqual(body2, { alarmStatus: 'processed', condition: 'alarmName="x"' });
});

test('ListLinkageStrategies validates order_by allow-list and maps data', async () => {
  let url;
  setFetch((u) => { url = u; return ok({ $page: 1, $size: 5, total: 1, data: [{ id: 's1', blockIp: '1.1.1.1' }] }); });
  const out = await (await loadRpc({ order_by: 'blockIp desc', page: 1, size: 5 }))[listLinkagePath]();
  assert.equal(out.total, 1);
  assert.equal(out.data[0].id, 's1');
  assert.match(url, /%24orderBy=blockIp/);

  await assert.rejects((await loadRpc({ order_by: 'nope' }))[listLinkagePath](), /order_by key must be one of/);
});

test('BlockIp joins ids into path and maps result', async () => {
  let url;
  setFetch((u, init) => { url = u; assert.equal(init.method, 'POST'); return ok({ $page: 0, $size: 0, data: '联动成功' }); });
  const out = await (await loadRpc({ ids: ['s1', 's2'] }))[blockPath]();
  assert.equal(out.data, '联动成功');
  assert.match(url, /\/linkage-strategies\/s1,s2\/accessIp$/);

  await assert.rejects((await loadRpc({ ids: [] }))[blockPath](), /non-empty/);
});

test('UnblockIp deletes and is idempotent on 404', async () => {
  let url;
  setFetch((u, init) => { url = u; assert.equal(init.method, 'DELETE'); return ok({ $page: 0, $size: 0, data: '解除成功' }); });
  const out = await (await loadRpc({ ids: ['s1'] }))[unblockPath]();
  assert.equal(out.data, '解除成功');
  assert.match(url, /\/linkage-strategies\/s1\/blockIp$/);

  setFetch(() => ({ status: 404, raw: 'not found' }));
  const out2 = await (await loadRpc({ ids: ['gone'] }))[unblockPath]();
  assert.deepEqual(out2, { page: 0, size: 0, data: '' });

  // non-404 errors are re-thrown
  setFetch(() => ({ status: 500, raw: 'boom' }));
  await assert.rejects((await loadRpc({ ids: ['s1'] }))[unblockPath](), /UNAVAILABLE.*http 500/);
});

test('auth: missing apiKey errors', async () => {
  setFetch(() => ok({ $page: 1, $size: 10, total: 0, data: [] }));
  await assert.rejects(
    (await loadRpc({}, { bindings: { endpoint: 'https://h', apiKey: '' } }))[listAlarmsPath](),
    /apiKey is required/,
  );
});

test('error mapping: endpoint, 401/403/404/500, network, bad json, empty body', async () => {
  await assert.rejects(
    (await loadRpc({}, { bindings: { endpoint: '', apiKey: 'k' } }))[listAlarmsPath](),
    /endpoint\/baseUrl is required/,
  );

  setFetch(() => ({ status: 401, raw: 'no auth' }));
  await assert.rejects((await loadRpc({}))[listAlarmsPath](), /UNAUTHENTICATED.*http 401/);

  setFetch(() => ({ status: 403, raw: 'forbidden' }));
  await assert.rejects((await loadRpc({}))[listAlarmsPath](), /PERMISSION_DENIED.*http 403/);

  setFetch(() => ({ status: 404, raw: 'nf' }));
  await assert.rejects((await loadRpc({ agg_condition: 'a', window_id: 'w' }))[detailPath](), /NOT_FOUND.*http 404/);

  setFetch(() => ({ status: 500, raw: 'boom' }));
  await assert.rejects((await loadRpc({}))[listAlarmsPath](), /UNAVAILABLE.*http 500/);

  setFetch(() => ({ throwNetwork: 'ECONNREFUSED' }));
  await assert.rejects((await loadRpc({}))[listAlarmsPath](), /UNAVAILABLE.*ECONNREFUSED/);

  setFetch(() => ({ status: 200, raw: 'not-json{' }));
  await assert.rejects((await loadRpc({}))[listAlarmsPath](), /UNKNOWN.*not valid JSON/);

  setFetch(() => ({ status: 200, raw: '' }));
  const out = await (await loadRpc({}))[listAlarmsPath]();
  assert.deepEqual(out, { page: 0, size: 0, total: 0, data: [], order_by: '' });
});

test('handlers / registerHandlers run through the legacy ctx wrapper', async () => {
  setFetch(() => ok({ $page: 1, $size: 10, total: 1, data: [{ id: 'a' }] }));
  const { handlers, _test } = await import('../src/ailpha-platform.js');
  const out = await handlers[`${PKG}/ListMergeAlarms`]({ bindings: { endpoint: 'https://h', apiKey: 'k' }, req: {} });
  assert.equal(out.total, 1);

  const reg = _test.registerHandlers({ bindings: { endpoint: 'https://h', apiKey: 'k' } });
  const out2 = await reg[`/${PKG}/ListMergeAlarms`]({}, { meta: { request_id: 'r2' } });
  assert.equal(out2.data[0].id, 'a');
});

test('all six handler entry points are reachable', async () => {
  setFetch(() => ok({ $page: 0, $size: 0, total: 0, data: [], $orderBy: '' }));
  const { handlers } = await import('../src/ailpha-platform.js');
  const ctx = (req) => ({ bindings: { endpoint: 'https://h', apiKey: 'k' }, req });
  const reqs = {
    ListMergeAlarms: {},
    GetMergeAlarmDetail: { agg_condition: 'a', window_id: 'w' },
    UpdateMergeAlarmStatus: { alarm_status: 'processed', condition: 'c' },
    ListLinkageStrategies: {},
    BlockIp: { ids: ['s1'] },
    UnblockIp: { ids: ['s1'] },
  };
  for (const [m, req] of Object.entries(reqs)) {
    const out = await handlers[`${PKG}/${m}`](ctx(req));
    assert.ok(out && typeof out === 'object', `${m} returned an object`);
  }
});
