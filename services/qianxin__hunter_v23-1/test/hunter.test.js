import test from 'node:test';
import assert from 'node:assert/strict';

const SEARCH_PATH = '/qianxin.hunter.v1.HunterService/Search';
const METHOD_SEARCH_FULL = 'qianxin.hunter.v1.HunterService/Search';

const buildCtx = (req = {}, overrides = {}) => ({
  bindings: { baseUrl: 'http://localhost:18081', ...overrides.bindings },
  config: overrides.config || {},
  secret: overrides.secret === undefined ? { apiKey: 'test-key' } : overrides.secret,
  limits: { timeoutMs: 10_000, ...overrides.limits },
  meta: { instance_id: 'inst', request_id: 'req', ...overrides.meta },
  req,
});

const setFetch = (impl) => {
  global.fetch = impl;
};

const loadHandler = async (req, overrides = {}) => {
  const { rpcdef } = await import('../src/hunter.js');
  const ctx = buildCtx(req, overrides);
  return rpcdef(ctx)[SEARCH_PATH];
};

const mockFetch = (impl) => {
  setFetch(async (...args) => impl(...args));
};

// ---- internal helpers ----

test('internal helpers normalize inputs', async () => {
  const { _test } = await import('../src/hunter.js');

  assert.equal(_test.normalizeBaseUrl(''), null);
  assert.equal(_test.normalizeBaseUrl('bad'), null);
  assert.equal(_test.normalizeBaseUrl('ftp://bad'), null);
  assert.equal(_test.normalizeBaseUrl('http://example.com/'), 'http://example.com');
  assert.equal(_test.normalizeBaseUrl('https://example.com'), 'https://example.com');

  assert.equal(_test.unwrapInt32(undefined), null);
  assert.equal(_test.unwrapInt32(null), null);
  assert.equal(_test.unwrapInt32(5), 5);
  assert.equal(_test.unwrapInt32({ value: 7 }), 7);
  assert.equal(_test.unwrapInt32('bad'), null);
  assert.equal(_test.unwrapInt32({}), null);

  assert.equal(_test.unwrapString(undefined), '');
  assert.equal(_test.unwrapString(null), '');
  assert.equal(_test.unwrapString('hello'), 'hello');
  assert.equal(_test.unwrapString({ value: 'world' }), 'world');
  assert.equal(_test.unwrapString({ value: null }), '');

  const mapped = _test.mapSearchResult({
    ip: '1.1.1.1',
    port: 443,
    domain: 'example.com',
    web_title: 'Example',
    protocol: 'https',
  });
  assert.equal(mapped.ip, '1.1.1.1');
  assert.equal(mapped.port, 443);
  assert.equal(mapped.domain, 'example.com');
  assert.equal(mapped.web_title, 'Example');
  assert.equal(mapped.protocol, 'https');
  assert.equal(mapped.raw_json, '');

  const empty = _test.mapSearchResult(null);
  assert.equal(empty.ip, '');
  assert.equal(empty.port, 0);

  const unknown = _test.errorWithCode('SOMETHING_NEW', 'message');
  assert.equal(unknown.legacyCode, 'SOMETHING_NEW');
  assert.match(unknown.message, /SOMETHING_NEW: message/);
});

// ---- validation tests ----

test('Search requires query parameter', async () => {
  const handler = await loadHandler({});
  await assert.rejects(() => handler(), /INVALID_ARGUMENT: query is required/);

  const empty = await loadHandler({ query: '' });
  await assert.rejects(() => empty(), /INVALID_ARGUMENT: query is required/);
});

test('Search requires api_key', async () => {
  const handler = await loadHandler({ query: 'ip="1.1.1.1"' }, { secret: {} });
  await assert.rejects(() => handler(), /INVALID_ARGUMENT: apiKey is required in secret/);
});

test('Search validates page', async () => {
  const badPage = await loadHandler({
    query: 'ip="1.1.1.1"',
    page: 0,
  });
  await assert.rejects(() => badPage(), /INVALID_ARGUMENT: page must be an integer/);

  const badPageStr = await loadHandler({
    query: 'ip="1.1.1.1"',
    page: 'abc',
  });
  await assert.rejects(() => badPageStr(), /INVALID_ARGUMENT: page must be an integer/);
});

test('Search validates page_size', async () => {
  const badSize = await loadHandler({
    query: 'ip="1.1.1.1"',
    page_size: 5,
  });
  await assert.rejects(() => badSize(), /INVALID_ARGUMENT: page_size must be one of/);

  const badSizeNum = await loadHandler({
    query: 'ip="1.1.1.1"',
    page_size: 200,
  });
  await assert.rejects(() => badSizeNum(), /INVALID_ARGUMENT: page_size must be one of/);
});

test('Search validates is_web', async () => {
  const badIsWeb = await loadHandler({
    query: 'ip="1.1.1.1"',
    is_web: 5,
  });
  await assert.rejects(() => badIsWeb(), /INVALID_ARGUMENT: is_web must be 1/);
});

test('Search validates baseUrl', async () => {
  const handler = await loadHandler(
    { query: 'ip="1.1.1.1"' },
    { bindings: { baseUrl: 'bad-url' } }
  );
  await assert.rejects(() => handler(), /baseUrl must be a valid/);
});

// ---- success path tests ----

test('Search sends correct request and maps response', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({
        code: 200,
        message: 'ok',
        data: {
          list: [
            { ip: '1.1.1.1', port: 443, domain: 'example.com', country: 'CN' },
            { ip: '2.2.2.2', port: 80, domain: 'test.com', country: 'US' },
          ],
          total: 2,
          page: 1,
          page_size: 10,
        }
      }),
    };
  });

  const handler = await loadHandler({
    query: 'ip="1.1.1.1"',
    page: 1,
    page_size: 10,
  });

  const res = await handler();

  assert.ok(captured.url.includes('/openApi/search'));
  assert.ok(captured.url.includes('api-key=test-key'));
  assert.ok(captured.url.includes('search=aXA9IjEuMS4xLjEi'));
  assert.equal(captured.init.method, 'GET');
  assert.equal(res.results.length, 2);
  assert.equal(res.total, 2);
  assert.equal(res.page, 1);
  assert.equal(res.page_size, 10);
  assert.equal(res.error, '');
  assert.equal(res.results[0].ip, '1.1.1.1');
  assert.equal(res.results[0].port, 443);
  assert.equal(res.results[0].country, 'CN');
});

test('Search uses secret.apiKey when request has no api_key', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({
        code: 200,
        message: 'ok',
        data: { list: [], total: 0, page: 1 }
      }),
    };
  });

  const { rpcdef } = await import('../src/hunter.js');
  const ctx = {
    config: {},
    secret: { apiKey: 'secret-from-config' },
    bindings: { baseUrl: 'http://localhost:18081' },
    limits: { timeoutMs: 10_000 },
    meta: {},
    req: { query: 'domain="example.com"' },
  };
  const fn = rpcdef(ctx)[SEARCH_PATH];
  const res = await fn();

  assert.ok(captured.url.includes('api-key=secret-from-config'));
  assert.equal(res.results.length, 0);
});

test('Search ignores request api_key and prefers secret over deprecated config and bindings', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ code: 200, message: 'ok', data: { list: [], total: 0 } }),
    };
  });

  const handler = await loadHandler(
    { query: 'domain="example.com"', api_key: 'request-key' },
    {
      bindings: { baseUrl: 'http://legacy.local', apiKey: 'legacy-binding-key' },
      config: { baseUrl: 'http://config.local', apiKey: 'deprecated-config-key' },
      secret: { apiKey: 'secret-key' },
    }
  );

  await handler();
  assert.ok(captured.url.startsWith('http://config.local/openApi/search?'));
  assert.ok(captured.url.includes('api-key=secret-key'));
  assert.ok(!captured.url.includes('request-key'));
});

test('Search keeps deprecated config apiKey as lower-priority fallback', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ code: 200, message: 'ok', data: { list: [], total: 0 } }),
    };
  });

  const handler = await loadHandler(
    { query: 'domain="example.com"' },
    {
      config: { apiKey: 'deprecated-config-key' },
      secret: {},
    }
  );

  await handler();
  assert.ok(captured.url.includes('api-key=deprecated-config-key'));
});

test('Search passes all optional parameters', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({
        code: 200,
        message: 'ok',
        data: { list: [], total: 0 },
      }),
    };
  });

  const handler = await loadHandler({
    query: 'ip="1.1.1.1"',
    page: 2,
    page_size: 50,
    is_web: 1,
    status_code: '200,301',
    fields: 'ip,port,domain',
    start_time: '2026-01-01',
    end_time: '2026-06-24',
  });

  await handler();

  assert.ok(captured.url.includes('page=2'));
  assert.ok(captured.url.includes('page_size=50'));
  assert.ok(captured.url.includes('is_web=1'));
  assert.ok(captured.url.includes('status_code=200%2C301'));
  assert.ok(captured.url.includes('fields=ip%2Cport%2Cdomain'));
  assert.ok(captured.url.includes('start_time=2026-01-01'));
  assert.ok(captured.url.includes('end_time=2026-06-24'));
});

test('Search handles page_size wrapper object', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({
        code: 200, message: 'ok',
        data: { list: [], total: 0 }
      }),
    };
  });

  const handler = await loadHandler({
    query: 'ip="1.1.1.1"',
    page: { value: 3 },
    page_size: { value: 100 },
    is_web: { value: 2 },
  });

  await handler();
  assert.ok(captured.url.includes('page=3'));
  assert.ok(captured.url.includes('page_size=100'));
  assert.ok(captured.url.includes('is_web=2'));
});

// ---- upstream error tests ----

test('Search maps upstream 401 to UNAUTHENTICATED', async () => {
  setFetch(async () => ({
    ok: false,
    status: 401,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify({ code: 401, message: 'invalid api key' }),
  }));

  const handler = await loadHandler({ query: 'ip="1.1.1.1"' }, { secret: { apiKey: 'bad-key' } });
  await assert.rejects(() => handler(), /UNAUTHENTICATED: upstream http 401/);
});

test('Search maps upstream 403 to PERMISSION_DENIED', async () => {
  setFetch(async () => ({
    ok: false,
    status: 403,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify({ code: 403, message: 'forbidden' }),
  }));

  const handler = await loadHandler({ query: 'ip="1.1.1.1"' });
  await assert.rejects(() => handler(), /PERMISSION_DENIED: upstream http 403/);
});

test('Search maps upstream 500 to UNAVAILABLE', async () => {
  setFetch(async () => ({
    ok: false,
    status: 500,
    headers: new Map([['content-type', 'text/plain']]),
    text: async () => 'internal server error',
  }));

  const handler = await loadHandler({ query: 'ip="1.1.1.1"' });
  await assert.rejects(() => handler(), /UNAVAILABLE: upstream http 500/);
});

test('Search maps network failure to UNAVAILABLE', async () => {
  setFetch(async () => {
    throw new Error('network down');
  });

  const handler = await loadHandler({ query: 'ip="1.1.1.1"' });
  await assert.rejects(() => handler(), /UNAVAILABLE: network down/);
});

test('Search maps network failure with cause', async () => {
  setFetch(async () => {
    throw Object.assign(new Error('fetch error'), { cause: new Error('connection reset') });
  });

  const handler = await loadHandler({ query: 'ip="1.1.1.1"' });
  await assert.rejects(() => handler(), /UNAVAILABLE: connection reset/);
});

test('Search maps non-JSON response to UNKNOWN', async () => {
  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'text/plain']]),
    text: async () => 'not json',
  }));

  const handler = await loadHandler({ query: 'ip="1.1.1.1"' });
  await assert.rejects(() => handler(), /UNKNOWN: upstream response is not valid JSON/);
});

test('Search handles upstream business error (code != 200)', async () => {
  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify({ code: 429, message: 'rate limited' }),
  }));

  const handler = await loadHandler({ query: 'ip="1.1.1.1"' });
  const res = await handler();

  assert.equal(res.results.length, 0);
  assert.equal(res.total, 0);
  assert.ok(res.error.includes('rate limited'));
});

test('Search handles empty response body', async () => {
  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => '',
  }));

  const handler = await loadHandler({ query: 'ip="1.1.1.1"' });
  const res = await handler();

  assert.equal(res.results.length, 0);
  assert.equal(res.total, 0);
});

test('Search handles response without data wrapper', async () => {
  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify([
      { ip: '1.1.1.1', port: 80 },
      { ip: '2.2.2.2', port: 443 },
    ]),
  }));

  const handler = await loadHandler({ query: 'ip="1.1.1.1"' });
  const res = await handler();

  assert.equal(res.results.length, 2);
  assert.equal(res.results[0].ip, '1.1.1.1');
  assert.equal(res.total, 2);
});

test('Search handles data.arr format', async () => {
  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify({
      code: 200,
      message: 'ok',
      data: { arr: [{ ip: '5.5.5.5', port: 8080 }], total: 1 }
    }),
  }));

  const handler = await loadHandler({ query: 'ip="5.5.5.5"' });
  const res = await handler();
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].ip, '5.5.5.5');
});

// ---- read response failure ----

test('Search handles response read failure', async () => {
  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => { throw new Error('stream error'); },
  }));

  const handler = await loadHandler({ query: 'ip="1.1.1.1"' });
  await assert.rejects(() => handler(), /UNAVAILABLE: failed to read response/);
});

// ---- upstream 4xx (non-401/403) ----

test('Search maps upstream 400 to INVALID_ARGUMENT', async () => {
  setFetch(async () => ({
    ok: false,
    status: 400,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify({ code: 400, message: 'bad request' }),
  }));

  const handler = await loadHandler({ query: 'ip="1.1.1.1"' });
  await assert.rejects(() => handler(), /INVALID_ARGUMENT: upstream http 400/);
});

// ---- TLS skip verify ----

test('Search passes skipTlsVerify', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ code: 200, message: 'ok', data: { list: [], total: 0 } }),
    };
  });

  const handler = await loadHandler(
    { query: 'ip="1.1.1.1"' },
    { bindings: { baseUrl: 'http://localhost:18081', skipTlsVerify: true } }
  );

  await handler();
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal('timeoutMs' in captured.init, false);
  assert.ok(captured.init.dispatcher);
  assert.equal('insecureSkipVerify' in captured.init, false);
});

// ---- SDK handler ----

test('SDK handler accepts single context with config and secret', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({
        code: 200, message: 'ok',
        data: { list: [{ ip: '1.1.1.1', port: 443 }], total: 1 }
      }),
    };
  });

  const { handlers, METHOD_SEARCH_FULL } = await import('../src/hunter.js');
  const res = await handlers[METHOD_SEARCH_FULL]({
    config: { baseUrl: 'http://localhost:18081' },
    secret: { apiKey: 'sdk-secret' },
    request: { query: 'ip="1.1.1.1"' },
    meta: { instance_id: 'inst-sdk', request_id: 'req-sdk' },
  });

  assert.ok(captured.url.includes('api-key=sdk-secret'));
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].ip, '1.1.1.1');
});

test('SDK handler accepts request plus inner context arguments', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({
        code: 200, message: 'ok',
        data: { list: [], total: 0 }
      }),
    };
  });

  const { _test } = await import('../src/hunter.js');
  const registered = _test.registerHandlers({
    bindings: { baseUrl: 'http://base' },
  });
  const res = await registered[SEARCH_PATH](
    { query: 'domain="example.com"' },
    {
      bindings: { baseUrl: 'http://localhost:18081' },
      secret: { apiKey: 'inner-token' },
      meta: { instanceId: 'inst-camel', requestId: 'req-camel' },
    }
  );

  assert.ok(captured.url.includes('api-key=inner-token'));
  assert.ok(captured.url.includes('http://localhost:18081'));
  assert.deepEqual(res.results, []);
});

// ---- mapSearchResult covers null fields ----

test('mapSearchResult handles null fields gracefully', async () => {
  const { _test } = await import('../src/hunter.js');
  const result = _test.mapSearchResult({
    ip: null,
    port: null,
    domain: undefined,
    url: null,
    web_title: null,
  });
  assert.equal(result.ip, '');
  assert.equal(result.port, 0);
  assert.equal(result.domain, '');
  assert.equal(result.url, '');
  assert.equal(result.web_title, '');
});

test('mapSearchResult handles JSON.stringify failure', async () => {
  const { _test } = await import('../src/hunter.js');
  // Create circular reference to test JSON.stringify catch
  const obj = { a: 1 };
  obj.self = obj;
  const result = _test.mapSearchResult(obj);
  assert.equal(result.raw_json, '');
});
