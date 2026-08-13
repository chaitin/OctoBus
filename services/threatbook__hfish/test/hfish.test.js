import test from 'node:test';
import assert from 'node:assert/strict';
import { grpcStatus } from '@chaitin-ai/octobus-sdk';

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
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].ip, '1.2.3.4');
  assert.equal(result.data[0].attack_count, 10);
});

test('ListAttackIPs with subpath endpoint preserves path prefix', async () => {
  // Regression: buildApiKeyUrl must preserve subpaths in baseUrl
  // (e.g. http://host/hfish). new URL('/api/...', base) would discard
  // the /hfish prefix because absolute paths replace the entire pathname.
  mockFetch(async (url) => {
    assert.ok(url.startsWith('http://example.com/hfish/api/v1/attack/ip'), `URL missing subpath prefix: ${url}`);
    assert.ok(url.includes('api_key=test-api-key'));
    return {
      ok: true, status: 200, headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({
        response_code: 0,
        verbose_msg: '成功',
        data: { attack_ip: [{ ip: '1.2.3.4', attack_count: 1 }] },
      }),
    };
  });

  const handler = await loadListAttackIpsHandler(
    { page: 1, limit: 20 },
    { bindings: { endpoint: 'http://example.com/hfish' } }
  );
  const result = await handler();
  assert.equal(result.response_code, 0);
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].ip, '1.2.3.4');
});

test('ListAttackIPs empty', async () => {
  mockFetch(async () => ({
    ok: true, status: 200, headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({ response_code: 0, verbose_msg: '成功', data: { attack_ip: [] } }),
  }));

  const handler = await loadListAttackIpsHandler({});
  const result = await handler();
  assert.equal(result.response_code, 0);
  assert.equal(result.data.length, 0);
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

test('ListAttackIPs http error 503', async () => {
  mockFetch(async () => ({
    ok: false, status: 503,
    headers: { get: () => 'text/plain' },
    text: async () => 'Service Unavailable',
  }));

  const handler = await loadListAttackIpsHandler({});
  await assert.rejects(handler(), /UNAVAILABLE/);
});

test('ListAttackIPs http error 401 returns UNAUTHENTICATED', async () => {
  mockFetch(async () => ({
    ok: false, status: 401,
    headers: { get: () => 'text/plain' },
    text: async () => 'Unauthorized',
  }));

  const handler = await loadListAttackIpsHandler({});
  try {
    await handler();
    assert.fail('should have thrown');
  } catch (e) {
    assert.match(e.message, /UNAUTHENTICATED/);
    assert.equal(e.code, grpcStatus.UNAUTHENTICATED, `expected gRPC status UNAUTHENTICATED but got ${e.code}`);
  }
});

test('ListAttackIPs http error 403 returns PERMISSION_DENIED', async () => {
  mockFetch(async () => ({
    ok: false, status: 403,
    headers: { get: () => 'text/plain' },
    text: async () => 'Forbidden',
  }));

  const handler = await loadListAttackIpsHandler({});
  try {
    await handler();
    assert.fail('should have thrown');
  } catch (e) {
    assert.match(e.message, /PERMISSION_DENIED/);
    assert.equal(e.code, grpcStatus.PERMISSION_DENIED, `expected gRPC status PERMISSION_DENIED but got ${e.code}`);
  }
});

test('throwForHttpError does not leak upstream response body', async () => {
  const sensitiveBody = 'internal stack trace with secret=abc123';
  const errors = [];
  const origError = console.error;
  console.error = (...args) => errors.push(args.join(' '));

  mockFetch(async () => ({
    ok: false, status: 500,
    headers: { get: () => 'text/plain' },
    text: async () => sensitiveBody,
  }));

  const handler = await loadListAttackIpsHandler({});
  try {
    await handler();
    assert.fail('should have thrown');
  } catch (e) {
    // gRPC error message should NOT contain the sensitive body
    assert.ok(!e.message.includes(sensitiveBody), `error message leaked upstream body: ${e.message}`);
    // But it should have been logged server-side
    assert.ok(errors.some(msg => msg.includes(sensitiveBody)), 'upstream body not logged server-side');
  } finally {
    console.error = origError;
  }
});

test('ListAttackIPs network failure', async () => {
  mockFetch(async () => { throw new Error('connect ECONNREFUSED'); });

  const handler = await loadListAttackIpsHandler({});
  await assert.rejects(handler(), /UNAVAILABLE/);
});

test('timeout throws DEADLINE_EXCEEDED', async () => {
  mockFetch(async () => {
    const err = new Error('The operation was aborted');
    err.name = 'TimeoutError';
    throw err;
  });

  const handler = await loadListAttackIpsHandler({});
  await assert.rejects(handler(), /DEADLINE_EXCEEDED/);
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

test('helpers cover invalid scalars, header shapes, and unknown error codes', async () => {
  const { _test } = await import('../src/hfish.js');
  assert.equal(_test.toPositiveInt({ other: 1 }), null);
  assert.equal(_test.toPositiveInt(1.5), null);
  assert.deepEqual(_test.parseHeaders([]), {});
  assert.deepEqual(_test.parseHeaders('[]'), {});
  assert.deepEqual(_test.parseHeaders('{"A":"b"}'), { A: 'b' });
  assert.deepEqual(_test.parseHeaders(42), {});
  assert.equal(_test.errorWithCode('OTHER', 'x').code, grpcStatus.UNKNOWN);
});

test('ListAttackIPs validates endpoint, invalid JSON, empty body, and API errors', async () => {
  await assert.rejects((await loadListAttackIpsHandler({}, { bindings: { endpoint: 'ftp://bad' } }))(), /INVALID_ARGUMENT/);
  mockFetch(async () => ({ ok: true, status: 200, text: async () => 'bad-json' }));
  await assert.rejects((await loadListAttackIpsHandler({}))(), /UNKNOWN/);
  mockFetch(async () => ({ ok: true, status: 200, text: async () => '' }));
  assert.deepEqual((await (await loadListAttackIpsHandler({}))()).data, []);
  mockFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ response_code: 42 }) }));
  await assert.rejects((await loadListAttackIpsHandler({}))(), /FAILED_PRECONDITION/);
});

test('ListAttackDetails validates inputs, forwards filters, and maps errors/defaults', async () => {
  await assert.rejects((await loadListAttackDetailsHandler({}, { secret: { apiKey: null } }))(), /INVALID_ARGUMENT/);
  await assert.rejects((await loadListAttackDetailsHandler({}, { bindings: { endpoint: '' } }))(), /INVALID_ARGUMENT/);
  let requested;
  mockFetch(async (url) => { requested = url; return { ok: true, status: 200, text: async () => JSON.stringify({ data: {} }) }; });
  const result = await (await loadListAttackDetailsHandler({ Page: 2, Limit: 3, ip: '1.2.3.4', type: 'ssh' }))();
  assert.match(requested, /page=2/); assert.match(requested, /limit=3/); assert.match(requested, /ip=1.2.3.4/); assert.match(requested, /type=ssh/);
  assert.equal(result.data.page_no, 2); assert.equal(result.data.page_size, 3);
  mockFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ response_code: 1003 }) }));
  await assert.rejects((await loadListAttackDetailsHandler({}))(), /PERMISSION_DENIED/);
  mockFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ response_code: 9 }) }));
  await assert.rejects((await loadListAttackDetailsHandler({}))(), /FAILED_PRECONDITION/);
});

test('ListAttackAccounts validates inputs and maps business errors/default data', async () => {
  await assert.rejects((await loadListAttackAccountsHandler({}, { secret: { apiKey: null } }))(), /INVALID_ARGUMENT/);
  await assert.rejects((await loadListAttackAccountsHandler({}, { bindings: { endpoint: 'bad' } }))(), /INVALID_ARGUMENT/);
  mockFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ data: {} }) }));
  assert.deepEqual((await (await loadListAttackAccountsHandler({}))()).data, []);
  mockFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ response_code: 1003 }) }));
  await assert.rejects((await loadListAttackAccountsHandler({}))(), /PERMISSION_DENIED/);
  mockFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ response_code: 2 }) }));
  await assert.rejects((await loadListAttackAccountsHandler({}))(), /FAILED_PRECONDITION/);
});

test('GetSystemInfo validates endpoint and maps empty/error payloads', async () => {
  await assert.rejects((await loadGetSystemInfoHandler({}, { bindings: { endpoint: '' } }))(), /INVALID_ARGUMENT/);
  mockFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ data: { clients: {}, honeypot_self_cnt: [] } }) }));
  const empty = await (await loadGetSystemInfoHandler({}))();
  assert.deepEqual(empty.data.clients, []); assert.deepEqual(empty.data.honeypot_self_cnt, {});
  mockFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ response_code: 1003 }) }));
  await assert.rejects((await loadGetSystemInfoHandler({}))(), /PERMISSION_DENIED/);
  mockFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ response_code: 4 }) }));
  await assert.rejects((await loadGetSystemInfoHandler({}))(), /FAILED_PRECONDITION/);
});

test('network failures use cause and fallback messages and TLS flags are request-scoped', async () => {
  mockFetch(async (_url, init) => { assert.equal(init.insecureSkipVerify, true); throw { cause: { message: 'cause failure' } }; });
  await assert.rejects((await loadListAttackIpsHandler({}, { bindings: { skipTlsVerify: true } }))(), /cause failure/);
  mockFetch(async () => { throw {}; });
  await assert.rejects((await loadListAttackIpsHandler({}))(), /fetch failed/);
});

test('sdk handler accepts request context and merged bindings', async () => {
  const { handlers } = await import('../src/hfish.js');
  mockFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ data: { attack_ip: [] } }) }));
  const result = await handlers['ThreatBook_HFISH.ThreatBook_HFISH/ListAttackIPs']({
    request: { Page: 2 },
    config: { endpoint: 'http://localhost:18080' },
    secret: { apiKey: 'key' },
  });
  assert.deepEqual(result.data, []);
});

test('legacy handler accepts explicit request plus per-call context', async () => {
  const { _test } = await import('../src/hfish.js');
  mockFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ data: { attack_ip: [] } }) }));
  const defs = _test.registerHandlers?.({ config: { endpoint: 'http://localhost:18080' }, secret: { apiKey: 'key' } });
  if (defs) assert.deepEqual(await defs[listAttackIpsPath]({ page: 2 }, { meta: { request_id: 'inner' } }), { response_code: undefined, verbose_msg: '', data: [] });
});
