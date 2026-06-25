import test from 'node:test';
import assert from 'node:assert/strict';

import {
  METHOD_COUNT_INTRUSION_LOGS,
  METHOD_CREATE_TAMPER_SITE,
  METHOD_DELETE_INTRUSION_LOGS,
  METHOD_ENABLE_TAMPER_SITES,
  METHOD_LIST_INTRUSION_LOGS,
  METHOD_LIST_TAMPER_SITES,
  METHOD_UPDATE_TAMPER_SITE,
  PATH_COUNT_INTRUSION_LOGS,
  PATH_CREATE_TAMPER_SITE,
  PATH_DELETE_INTRUSION_LOGS,
  PATH_ENABLE_TAMPER_SITES,
  PATH_LIST_INTRUSION_LOGS,
  PATH_LIST_TAMPER_SITES,
  PATH_UPDATE_TAMPER_SITE,
  _test,
  handlers,
} from '../src/yxlink-waf.js';

const buildCtx = (overrides = {}) => ({
  config: { host: 'https://waf.example.com', ...overrides.config },
  secret: { appId: 'app-1', appSecret: 'secret-1', ...overrides.secret },
  bindings: overrides.bindings ?? {},
  limits: { timeoutMs: 10_000, ...overrides.limits },
  meta: { instance_id: 'inst-1', request_id: 'req-1', ...overrides.meta },
});

const decodeAuth = (headers) => JSON.parse(Buffer.from(headers.Authorization, 'base64').toString('utf8'));

const bodyEntries = (body) => Object.fromEntries([...body.entries()].map(([key, value]) => [key, String(value)]));

const mockJSON = (impl) => {
  global.fetch = async (url, init) => {
    const json = await impl(url, init);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(json),
    };
  };
};

test('sign builds deterministic SHA1 signature and Authorization payload', () => {
  assert.equal(
    _test.sign('app', 'secret', 'nonce', 1700000000),
    '73ebc31e4af02a9ae9936209f3e724e79e2629fb',
  );
  const auth = _test.buildAuthorization('app', 'secret', 'nonce', 1700000000);
  assert.deepEqual(JSON.parse(Buffer.from(auth, 'base64').toString('utf8')), {
    appId: 'app',
    nonceStr: 'nonce',
    timestamp: '1700000000',
    signature: '73ebc31e4af02a9ae9936209f3e724e79e2629fb',
  });
});

test('ListTamperSites posts signed form data and maps records', async () => {
  let captured;
  mockJSON((url, init) => {
    captured = { url, init, body: bodyEntries(init.body), auth: decodeAuth(init.headers) };
    return {
      success: true,
      totalAmount: 1,
      data: [{
        id: '7',
        website: 'portal',
        start: '1',
        address: '10.0.0.1',
        port: '21',
        connect: '1',
        quickdiff: '120',
        maxsize: '1024',
      }],
    };
  });

  const res = await handlers[METHOD_LIST_TAMPER_SITES]({ start: 5, limit: 10 }, buildCtx());

  assert.equal(new URL(captured.url).pathname, PATH_LIST_TAMPER_SITES);
  assert.deepEqual(captured.body, { start: '5', limit: '10' });
  assert.equal(captured.auth.appId, 'app-1');
  assert.equal(res.total_amount, 1);
  assert.equal(res.sites[0].id, '7');
  assert.equal(res.sites[0].start, true);
  assert.equal(res.sites[0].port, 21);
});

test('CreateTamperSite and UpdateTamperSite validate and map mutation fields', async () => {
  let createBody;
  mockJSON((url, init) => {
    createBody = bodyEntries(init.body);
    assert.equal(new URL(url).pathname, PATH_CREATE_TAMPER_SITE);
    return { success: true, insertedId: 34 };
  });

  const create = await handlers[METHOD_CREATE_TAMPER_SITE]({
    website: 'portal',
    description: 'main site',
    start: true,
    schedule: 1,
    address: '127.0.0.1',
    filecharset: 'gbk',
    username: 'anonymous',
    password: 'password',
    connect: 1,
    port: 21,
    folder: '/',
    parallel: 5,
    quickdiff: 120,
    maxsize: 10240000,
    exclude: '*.tmp',
  }, buildCtx());

  assert.equal(create.inserted_id, '34');
  assert.equal(createBody.website, 'portal');
  assert.equal(createBody.start, '1');
  assert.equal(createBody.port, '21');

  let updateBody;
  mockJSON((url, init) => {
    updateBody = bodyEntries(init.body);
    assert.equal(new URL(url).pathname, PATH_UPDATE_TAMPER_SITE);
    return { success: true, insertedId: 7 };
  });

  const update = await handlers[METHOD_UPDATE_TAMPER_SITE]({
    id: '7',
    site: {
      website: 'portal',
      start: false,
      address: '127.0.0.1',
      filecharset: 'utf8',
      username: 'admin',
      connect: 2,
      port: 22,
      quickdiff: 60,
      maxsize: 2048,
    },
  }, buildCtx());

  assert.equal(update.inserted_id, '7');
  assert.equal(updateBody.id, '7');
  assert.equal(updateBody.start, '0');
  assert.equal(updateBody.filecharset, 'utf8');

  await assert.rejects(
    () => handlers[METHOD_CREATE_TAMPER_SITE]({ website: 'bad' }, buildCtx()),
    /port is required/,
  );
});

test('Tamper action methods send comma-joined ids and map business failure', async () => {
  let captured;
  mockJSON((url, init) => {
    captured = { url, body: bodyEntries(init.body) };
    return { success: true, msg: 'success' };
  });

  const res = await handlers[METHOD_ENABLE_TAMPER_SITES]({ ids: ['2', '3'] }, buildCtx());
  assert.equal(new URL(captured.url).pathname, PATH_ENABLE_TAMPER_SITES);
  assert.deepEqual(captured.body, { ids: '2,3' });
  assert.equal(res.success, true);

  mockJSON(() => ({ success: false, msg: 'auth_failed', code: 'e8000' }));
  await assert.rejects(
    () => handlers[METHOD_ENABLE_TAMPER_SITES]({ ids: ['2'] }, buildCtx()),
    /UNAUTHENTICATED: auth_failed/,
  );
});

test('ListIntrusionLogs maps filters and response records', async () => {
  let captured;
  mockJSON((url, init) => {
    captured = { url, body: bodyEntries(init.body) };
    return {
      success: true,
      totalAmount: 1,
      data: [{
        HackId: '18',
        HackTime: '2020-03-13 14:41:43',
        SrcIp: '192.168.88.200',
        DstIp: '192.168.98.51',
        DataLen: '497',
        SrcPort: '36885',
        DstPort: '80',
        BlockReason: 7000001,
        ActionType: 'D',
        HttpProtocol: 'GET',
        GETData: 'http%3A%2F%2Fexample.com',
      }],
    };
  });

  const res = await handlers[METHOD_LIST_INTRUSION_LOGS]({
    view_mode: 'normal',
    timestamp: '2020-03-13',
    src_ip: '192.168.88.200',
    action_type: 'D',
    start: 0,
    limit: 30,
  }, buildCtx());

  assert.equal(new URL(captured.url).pathname, PATH_LIST_INTRUSION_LOGS);
  assert.equal(captured.body.SrcIp, '192.168.88.200');
  assert.equal(captured.body.ActionType, 'D');
  assert.equal(res.total_amount, 1);
  assert.equal(res.logs[0].hack_id, '18');
  assert.equal(res.logs[0].data_len, 497);
});

test('DeleteIntrusionLogs and CountIntrusionLogs validate required fields', async () => {
  let deleteBody;
  mockJSON((url, init) => {
    deleteBody = bodyEntries(init.body);
    assert.equal(new URL(url).pathname, PATH_DELETE_INTRUSION_LOGS);
    return { success: true, msg: 'success' };
  });

  await handlers[METHOD_DELETE_INTRUSION_LOGS]({
    ids: ['16_2020-03-13', '13_2020-03-13'],
    view_mode: 'normal',
    timestamp: '2020-03-13',
  }, buildCtx());
  assert.equal(deleteBody.ids, '16_2020-03-13,13_2020-03-13');
  assert.equal(deleteBody.timestamp, '2020-03-13');

  let countUrl;
  mockJSON((url, init) => {
    countUrl = new URL(url);
    assert.equal(countUrl.pathname, PATH_COUNT_INTRUSION_LOGS);
    assert.equal(bodyEntries(init.body).date, '2024-08-29');
    return { success: true, msg: 'success', count: 21368 };
  });

  const count = await handlers[METHOD_COUNT_INTRUSION_LOGS]({ date: '2024-08-29' }, buildCtx());
  assert.equal(countUrl.searchParams.get('date'), '2024-08-29');
  assert.equal(count.count, 21368);

  await assert.rejects(
    () => handlers[METHOD_COUNT_INTRUSION_LOGS]({ date: '20240829' }, buildCtx()),
    /date must be yyyy-MM-dd/,
  );
  await assert.rejects(
    () => handlers[METHOD_DELETE_INTRUSION_LOGS]({ timestamp: '2020-03-13' }, buildCtx()),
    /ids or id_list is required/,
  );
});

test('HTTP failures and config validation map to gRPC style errors', async () => {
  await assert.rejects(
    () => handlers[METHOD_LIST_TAMPER_SITES]({}, buildCtx({ config: { host: 'ftp://bad' } })),
    /host\/baseUrl is required/,
  );

  global.fetch = async () => ({
    ok: false,
    status: 500,
    text: async () => 'boom',
  });
  await assert.rejects(
    () => handlers[METHOD_LIST_TAMPER_SITES]({}, buildCtx()),
    /UNAVAILABLE: upstream http 500: boom/,
  );

  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => 'not-json',
  });
  await assert.rejects(
    () => handlers[METHOD_LIST_TAMPER_SITES]({}, buildCtx()),
    /UNKNOWN: response is not valid JSON/,
  );
});

test('skipTlsVerify sets compatible fetch TLS flags', async () => {
  let captured;
  mockJSON((url, init) => {
    captured = init;
    return { success: true, totalAmount: 0, data: [] };
  });

  await handlers[METHOD_LIST_TAMPER_SITES]({}, buildCtx({ config: { skipTlsVerify: true } }));
  assert.equal(captured.skipTlsVerify, true);
  assert.equal(captured.tlsInsecureSkipVerify, true);
  assert.equal(captured.insecureSkipVerify, true);
  assert.deepEqual(_test.buildTlsOptions(false), {});
});
