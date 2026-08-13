import test from 'node:test';
import assert from 'node:assert/strict';

const buildCtx = (req = {}, overrides = {}) => ({
  config: overrides.config ?? { baseUrl: 'http://localhost:18081' },
  secret: overrides.secret ?? { email: 'test@example.com', key: 'test-key' },
  bindings: { ...overrides.bindings },
  limits: { timeoutMs: 10_000, ...overrides.limits },
  meta: { instance_id: 'inst', request_id: 'req', ...overrides.meta },
  request: req,
});

const setFetch = (impl) => {
  global.fetch = impl;
};

const loadHandler = async (handlerName, req, overrides = {}) => {
  const { handlers } = await import('../src/fofa.js');
  const handler = handlers[handlerName];
  const ctx = buildCtx(req, overrides);
  // Return a callable function that invokes the handler
  return () => handler(ctx);
};

test('internal helpers normalize bindings and errors', async () => {
  const { _test } = await import('../src/fofa.js');

  assert.deepEqual(_test.mergedBindings({
    config: { baseUrl: 'http://config' },
    secret: { email: 'secret@example.com', key: 'secret-key' },
    bindings: { baseUrl: 'http://binding' },
  }), {
    baseUrl: 'http://binding',
    email: 'secret@example.com',
    key: 'secret-key',
  });

  assert.deepEqual(_test.parseHeaders(undefined), {});
  assert.deepEqual(_test.parseHeaders(''), {});
  assert.deepEqual(_test.parseHeaders('{"X-Test":"yes"}'), { 'X-Test': 'yes' });
  assert.deepEqual(_test.parseHeaders('{'), {});
  assert.deepEqual(_test.parseHeaders('[]'), {});
  assert.deepEqual(_test.parseHeaders(['bad']), {});

  assert.equal(_test.unwrapString({ value: 'test' }), 'test');
  assert.equal(_test.unwrapString('test'), 'test');
  assert.equal(_test.unwrapString(null), '');
  assert.equal(_test.unwrapString(undefined), '');

  assert.equal(_test.unwrapInt({ value: 42 }), 42);
  assert.equal(_test.unwrapInt(42), 42);
  assert.equal(_test.unwrapInt(null), null);
  assert.equal(_test.unwrapInt(undefined), null);
  assert.equal(_test.unwrapInt('not-a-number'), null);

  assert.equal(_test.unwrapBoolean({ value: true }), true);
  assert.equal(_test.unwrapBoolean(true), true);
  assert.equal(_test.unwrapBoolean(false), false);
  assert.equal(_test.unwrapBoolean(null), false);
  assert.equal(_test.unwrapBoolean(undefined), false);

  assert.equal(_test.normalizeBaseUrl('https://example.com'), 'https://example.com');
  assert.equal(_test.normalizeBaseUrl('https://example.com/'), 'https://example.com');
  assert.equal(_test.normalizeBaseUrl('http://example.com/api/v1'), 'http://example.com/api/v1');
  assert.equal(_test.normalizeBaseUrl('ftp://example.com'), null);
  assert.equal(_test.normalizeBaseUrl(''), null);
  assert.equal(_test.normalizeBaseUrl(null), null);

  const unknown = _test.errorWithCode('SOMETHING_NEW', 'message');
  assert.equal(unknown.legacyCode, 'SOMETHING_NEW');
  assert.match(unknown.message, /SOMETHING_NEW: message/);
});

test('Search validates request fields before downstream call', async () => {
  const noQuery = await loadHandler('FOFA.FOFA/Search', {});
  await assert.rejects(() => noQuery(), /INVALID_ARGUMENT: query is required/);

  const emptyQuery = await loadHandler('FOFA.FOFA/Search', { query: '' });
  await assert.rejects(() => emptyQuery(), /INVALID_ARGUMENT: query is required/);

  const sizeTooLarge = await loadHandler('FOFA.FOFA/Search', { query: 'test', size: 10001 });
  await assert.rejects(() => sizeTooLarge(), /INVALID_ARGUMENT: size must be between 1 and 10000/);

  const sizeTooSmall = await loadHandler('FOFA.FOFA/Search', { query: 'test', size: 0 });
  await assert.rejects(() => sizeTooSmall(), /INVALID_ARGUMENT: size must be between 1 and 10000/);

  const noBaseUrl = await loadHandler('FOFA.FOFA/Search', { query: 'test' }, { config: {} });
  await assert.rejects(() => noBaseUrl(), /INVALID_ARGUMENT: baseUrl is required in config/);

  const noEmail = await loadHandler('FOFA.FOFA/Search', { query: 'test' }, { secret: { key: 'test-key' } });
  await assert.rejects(() => noEmail(), /UNAUTHENTICATED: email and key are required in secret/);

  const noKey = await loadHandler('FOFA.FOFA/Search', { query: 'test' }, { secret: { email: 'test@example.com' } });
  await assert.rejects(() => noKey(), /UNAUTHENTICATED: email and key are required in secret/);
});

test('Search forwards query with qbase64 and maps results', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({
        error: false,
        errmsg: '',
        size: 2,
        page: 1,
        results: [
          { host: 'example.com', ip: '1.1.1.1', port: 443, protocol: 'https' },
          { host: 'test.com', ip: '2.2.2.2', port: 80, protocol: 'http' }
        ]
      }),
    };
  });

  const handler = await loadHandler('FOFA.FOFA/Search', {
    query: 'app="Nginx"',
    page: { value: 1 },
    size: { value: 100 },
    fields: 'host,ip,port,protocol',
    full: { value: false }
  }, {
    config: { baseUrl: 'http://localhost:18081', headers: { 'X-Extra': 'demo' } },
    secret: { email: 'test@example.com', key: 'test-key' }
  });

  const res = await handler();

  assert.match(captured.url, /http:\/\/localhost:18081\/search\/all/);
  // Search uses qbase64 (base64 encoded query) per FOFA API v1 spec
  assert.match(captured.url, /qbase64=/);
  assert.match(captured.url, /page=1/);
  assert.match(captured.url, /size=100/);
  assert.match(captured.url, /fields=host%2Cip%2Cport%2Cprotocol/);

  assert.equal(captured.init.method, 'GET');
  assert.equal(captured.init.headers['User-Agent'], 'OctoBus-FOFA-Client/1.0');
  assert.equal(captured.init.headers['X-Extra'], 'demo');

  assert.equal(res.error, false);
  assert.equal(res.errmsg, '');
  assert.equal(res.size, 2);
  assert.equal(res.results.length, 2);
  assert.equal(res.results[0].host, 'example.com');
  assert.equal(res.results[0].ip, '1.1.1.1');
  assert.equal(res.results[0].port, '443');
  assert.equal(res.results[0].protocol, 'https');
});

test('Search handles response errors', async () => {
  setFetch(async () => ({
    ok: false,
    status: 401,
    headers: new Map([['content-type', 'application/json']]),
    json: async () => ({ error: true, errmsg: 'Invalid API key' }),
  }));
  const authError = await loadHandler('FOFA.FOFA/Search', { query: 'test' });
  await assert.rejects(() => authError(), /UNAUTHENTICATED: Invalid API key or email/);

  setFetch(async () => ({
    ok: false,
    status: 429,
    headers: new Map([['content-type', 'application/json']]),
    json: async () => ({ error: true, errmsg: 'Rate limit exceeded' }),
  }));
  const rateLimitError = await loadHandler('FOFA.FOFA/Search', { query: 'test' });
  await assert.rejects(() => rateLimitError(), /UNAVAILABLE: Rate limit exceeded/);

  setFetch(async () => ({
    ok: false,
    status: 500,
    headers: new Map([['content-type', 'application/json']]),
    json: async () => ({ error: true, errmsg: 'Server error' }),
  }));
  const serverError = await loadHandler('FOFA.FOFA/Search', { query: 'test' });
  await assert.rejects(() => serverError(), /UNAVAILABLE: FOFA server error/);
});

test('GetAccountInfo handles request', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({
        error: false,
        errmsg: '',
        username: 'test@example.com',
        fcoin: 1000,
        vip_level: 1
      }),
    };
  });

  const handler = await loadHandler('FOFA.FOFA/GetAccountInfo', {});
  const res = await handler();

  assert.match(captured.url, /\/info\/my/);
  assert.equal(res.error, false);
  assert.equal(res.errmsg, '');
  assert.ok(res.raw);
});

test('GetStats validates request fields', async () => {
  const noQuery = await loadHandler('FOFA.FOFA/GetStats', {});
  await assert.rejects(() => noQuery(), /INVALID_ARGUMENT: query is required/);

  const invalidField = await loadHandler('FOFA.FOFA/GetStats', { query: 'test', fields: 'invalid' });
  await assert.rejects(() => invalidField(), /INVALID_ARGUMENT: field "invalid" must be one of/);
});

test('GetStats forwards request with qbase64 and fields', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({
        error: false,
        errmsg: '',
        aggs: {
          protocol: { http: 5000, https: 3000 }
        }
      }),
    };
  });

  const handler = await loadHandler('FOFA.FOFA/GetStats', {
    query: 'app="Nginx"',
    fields: 'protocol,port'
  });

  const res = await handler();

  assert.match(captured.url, /\/search\/stats/);
  // GetStats uses qbase64 (base64 encoded query)
  assert.match(captured.url, /qbase64=/);
  assert.match(captured.url, /fields=protocol%2Cport/);

  assert.equal(res.error, false);
  assert.equal(res.errmsg, '');
  assert.ok(res.raw);
});