import test from 'node:test';
import assert from 'node:assert/strict';

const listAttackIpsPath = '/ThreatBook_HFISH.ThreatBook_HFISH/ListAttackIPs';
const listAttackDetailsPath = '/ThreatBook_HFISH.ThreatBook_HFISH/ListAttackDetails';
const listAttackAccountsPath = '/ThreatBook_HFISH.ThreatBook_HFISH/ListAttackAccounts';
const getSystemInfoPath = '/ThreatBook_HFISH.ThreatBook_HFISH/GetSystemInfo';

const buildCtx = (req = {}, overrides = {}) => ({
  bindings: { endpoint: 'http://localhost:18080', ...overrides.bindings },
  secret: { apiKey: 'test-api-key', ...overrides.secret },
  limits: { timeoutMs: 10_000, ...overrides.limits },
  meta: { instance_id: 'inst', request_id: 'req', ...overrides.meta },
  req,
});

const setFetch = (impl) => {
  global.fetch = impl;
};

const loadHandler = async (path, req, overrides = {}) => {
  const { rpcdef } = await import('../src/hfish.js');
  const ctx = buildCtx(req, overrides);
  return rpcdef(ctx)[path];
};

const loadListAttackIpsHandler = async (req, overrides = {}) =>
  loadHandler(listAttackIpsPath, req, overrides);

const loadListAttackDetailsHandler = async (req, overrides = {}) =>
  loadHandler(listAttackDetailsPath, req, overrides);

const loadListAttackAccountsHandler = async (req, overrides = {}) =>
  loadHandler(listAttackAccountsPath, req, overrides);

const loadGetSystemInfoHandler = async (req, overrides = {}) =>
  loadHandler(getSystemInfoPath, req, overrides);

const mockFetch = (impl) => {
  setFetch(async (...args) => impl(...args));
};

test('internal helpers', async () => {
  const { _test } = await import('../src/hfish.js');

  // normalizeBaseUrl
  assert.equal(_test.normalizeBaseUrl('http://example.com'), 'http://example.com');
  assert.equal(_test.normalizeBaseUrl('https://example.com/path/'), 'https://example.com/path');
  assert.equal(_test.normalizeBaseUrl(''), null);
  assert.equal(_test.normalizeBaseUrl('ftp://bad'), null);

  // toPositiveInt
  assert.equal(_test.toPositiveInt(5), 5);
  assert.equal(_test.toPositiveInt(0), null);
  assert.equal(_test.toPositiveInt(-1), null);
  assert.equal(_test.toPositiveInt({ value: 3 }), 3);

  // extractApiKey: bindings/secret first (authoritative), then req
  // Rationale: gRPC proto string fields default to "" which firstDefined
  // treats as defined, shadowing the real secret value from bindings.
  assert.equal(_test.extractApiKey({ api_key: 'req-key' }, { apiKey: 'secret' }), 'secret');
  assert.equal(_test.extractApiKey({ apiKey: 'req-key' }, { apiKey: 'secret' }), 'secret');
  assert.equal(_test.extractApiKey({}, { apiKey: 'secret-key' }), 'secret-key');
  assert.equal(_test.extractApiKey({}, { api_key: 'secret-key-old' }), 'secret-key-old');
  assert.equal(_test.extractApiKey({}, {}), null);
  // when bindings has no apiKey, fall back to req
  assert.equal(_test.extractApiKey({ apiKey: 'req-fallback' }, {}), 'req-fallback');
  assert.equal(_test.extractApiKey({ api_key: 'req-fallback' }, {}), 'req-fallback');

  // firstDefined
  assert.equal(_test.firstDefined(undefined, null, 1, 2), 1);
  assert.equal(_test.firstDefined(null, undefined), undefined);

  // errorWithCode
  const err = _test.errorWithCode('INVALID_ARGUMENT', 'bad input');
  assert.equal(err.legacyCode, 'INVALID_ARGUMENT');

  // mergedBindings
  const bindings = _test.mergedBindings({
    config: { endpoint: 'http://cfg' },
    secret: { apiKey: 'sec' },
    bindings: { extra: 'val' },
  });
  assert.equal(bindings.endpoint, 'http://cfg');
  assert.equal(bindings.apiKey, 'sec');
  assert.equal(bindings.extra, 'val');

  // parseHeaders
  assert.deepEqual(_test.parseHeaders({ 'X-Custom': 'val' }), { 'X-Custom': 'val' });
  assert.deepEqual(_test.parseHeaders('{"X-Json":"parsed"}'), { 'X-Json': 'parsed' });
  assert.deepEqual(_test.parseHeaders(undefined), {});
  assert.deepEqual(_test.parseHeaders('not-json'), {});
});

test('ListAttackIPs success', async () => {
  mockFetch(async (url, init) => {
    assert.ok(url.includes('/api/v1/attack/ip'));
    assert.ok(url.includes('api_key=test-api-key'));
    assert.equal(init.method, 'POST');
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({
        response_code: 0,
        verbose_msg: '成功',
        data: {
          attack_ip: [
            { ip: '1.2.3.4', attack_count: 10 },
            { ip: '5.6.7.8', attack_count: 3 },
          ],
        },
      }),
    };
  });

  const handler = await loadListAttackIpsHandler({ page: 1, limit: 20 });
  const result = await handler();
  assert.equal(result.response_code, 0);
  assert.equal(result.data.attack_ip.length, 2);
  assert.equal(result.data.attack_ip[0].ip, '1.2.3.4');
  assert.equal(result.data.attack_ip[0].attack_count, 10);
});

test('ListAttackIPs empty', async () => {
  mockFetch(async () => ({
    ok: true, status: 200, headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({ response_code: 0, verbose_msg: '成功', data: { attack_ip: [] } }),
  }));

  const handler = await loadListAttackIpsHandler({});
  const result = await handler();
  assert.equal(result.response_code, 0);
  assert.equal(result.data.attack_ip.length, 0);
});

test('ListAttackIPs auth failure', async () => {
  mockFetch(async () => ({
    ok: true, status: 200, headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({ response_code: 1003, verbose_msg: '认证失败, 详情: illegal apikey' }),
  }));

  const handler = await loadListAttackIpsHandler({});
  await assert.rejects(handler(), /PERMISSION_DENIED/);
});

test('ListAttackIPs missing apiKey', async () => {
  const handler = await loadListAttackIpsHandler({}, { secret: { apiKey: null } });
  await assert.rejects(handler(), /INVALID_ARGUMENT/);
});

test('ListAttackIPs http error', async () => {
  mockFetch(async () => ({
    ok: false, status: 503,
    headers: { get: () => 'text/plain' },
    text: async () => 'Service Unavailable',
  }));

  const handler = await loadListAttackIpsHandler({});
  await assert.rejects(handler(), /UNAVAILABLE/);
});

test('ListAttackIPs network failure', async () => {
  mockFetch(async () => { throw new Error('connect ECONNREFUSED'); });

  const handler = await loadListAttackIpsHandler({});
  await assert.rejects(handler(), /UNAVAILABLE/);
});

test('ListAttackDetails success', async () => {
  mockFetch(async (url, init) => {
    assert.ok(url.includes('/api/v1/attack/detail'));
    assert.equal(init.method, 'POST');
    return {
      ok: true, status: 200, headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({
        response_code: 0,
        verbose_msg: '成功',
        data: {
          total_num: 1,
          page_no: 1,
          page_size: 20,
          detail_list: [
            { id: 1, src_ip: '1.2.3.4', dest_port: '22', type: 'SSH', create_time: '2026-06-01 12:00:00' },
          ],
        },
      }),
    };
  });

  const handler = await loadListAttackDetailsHandler({ page: 1, limit: 20 });
  const result = await handler();
  assert.equal(result.response_code, 0);
  assert.equal(result.data.total_num, 1);
  assert.equal(result.data.detail_list[0].src_ip, '1.2.3.4');
  assert.equal(result.data.detail_list[0].type, 'SSH');
});

test('ListAttackAccounts success', async () => {
  mockFetch(async () => ({
    ok: true, status: 200, headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({
      response_code: 0,
      verbose_msg: '成功',
      data: [
        { id: 1, ip: '1.2.3.4', account: 'root', password: 'admin123', type: 'SSH' },
      ],
    }),
  }));

  const handler = await loadListAttackAccountsHandler({});
  const result = await handler();
  assert.equal(result.response_code, 0);
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].account, 'root');
});

test('GetSystemInfo success', async () => {
  mockFetch(async (url, init) => {
    assert.ok(url.includes('/api/v1/hfish/sys_info'));
    assert.equal(init.method, 'GET');
    return {
      ok: true, status: 200, headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({
        response_code: 0,
        verbose_msg: '成功',
        data: {
          total_honeypots: 7,
          total_online_honeypots: 5,
          total_offline_honeypots: 2,
          honeypot_self_cnt: { 'SSH|SSH蜜罐': 2, 'WEB|WEB蜜罐': 3 },
          clients: [
            { name: 'node1', ip: '10.0.0.1', create_time: 1782388598, honeypots: [{ type: 'SSH', name: 'SSH蜜罐', state: 2 }] },
          ],
        },
      }),
    };
  });

  const handler = await loadGetSystemInfoHandler({});
  const result = await handler();
  assert.equal(result.response_code, 0);
  assert.equal(result.data.total_honeypots, 7);
  assert.equal(result.data.total_online_honeypots, 5);
  assert.equal(Object.keys(result.data.honeypot_self_cnt).length, 2);
  assert.equal(result.data.clients.length, 1);
  assert.equal(result.data.clients[0].honeypots[0].type, 'SSH');
});

test('GetSystemInfo missing apiKey', async () => {
  const handler = await loadGetSystemInfoHandler({}, { secret: { apiKey: null } });
  await assert.rejects(handler(), /INVALID_ARGUMENT/);
});

test('handler exports correct paths', async () => {
  const { handlers } = await import('../src/hfish.js');

  assert.ok(handlers['ThreatBook_HFISH.ThreatBook_HFISH/ListAttackIPs']);
  assert.ok(handlers['ThreatBook_HFISH.ThreatBook_HFISH/ListAttackDetails']);
  assert.ok(handlers['ThreatBook_HFISH.ThreatBook_HFISH/ListAttackAccounts']);
  assert.ok(handlers['ThreatBook_HFISH.ThreatBook_HFISH/GetSystemInfo']);
});

test('rpcdef returns correct handler map structure', async () => {
  const { rpcdef } = await import('../src/hfish.js');

  const ctx = buildCtx({}, { secret: { apiKey: 'key' } });
  const defs = rpcdef(ctx);

  assert.equal(typeof defs[listAttackIpsPath], 'function');
  assert.equal(typeof defs[listAttackDetailsPath], 'function');
  assert.equal(typeof defs[listAttackAccountsPath], 'function');
  assert.equal(typeof defs[getSystemInfoPath], 'function');
});
