import { describe, it, afterEach } from 'node:test';
import test from 'node:test';
import assert from 'node:assert/strict';

import { rpcdef, handlers, _test } from '../src/qianxin-tianyan-platform.js';

const PKG = 'QIANXIN_TianYan_Platform';
const PREFIX = `/${PKG}.${PKG}/`;

const PATH_LIST_ALARMS = `${PREFIX}ListAlarms`;
const KEY_LIST_ALARMS  = `${PKG}.${PKG}/ListAlarms`;

// ---------------------------------------------------------------------------
// Shared mock helpers
// ---------------------------------------------------------------------------

const AUTH_TOKEN_BODY = JSON.stringify({ access_token: 'test_token', status: 200 });
const AUTH_HTML_BODY  = '<html><head><meta name="csrf-token" content="abc123def456"></head><body></body></html>';

const makeHeaders = (entries = {}) => ({
  get: (name) => entries[name.toLowerCase()] ?? null,
});

// Build a 3-call fetch sequence: POST auth → GET auth HTML → API call
const makeSeqFetch = (apiBody, apiStatus = 200) => {
  let call = 0;
  return async (_url, init) => {
    call++;
    if (call === 1) {
      // POST /skyeye/v1/admin/auth
      return {
        ok: true,
        status: 200,
        text: async () => AUTH_TOKEN_BODY,
        headers: makeHeaders({}),
      };
    }
    if (call === 2) {
      // GET /skyeye/v1/admin/auth?token=...
      return {
        ok: true,
        status: 200,
        text: async () => AUTH_HTML_BODY,
        headers: makeHeaders({ 'set-cookie': 'session=xyz; Path=/' }),
      };
    }
    // Actual API call
    return {
      ok: apiStatus >= 200 && apiStatus < 300,
      status: apiStatus,
      text: async () => (typeof apiBody === 'string' ? apiBody : JSON.stringify(apiBody)),
      headers: makeHeaders({}),
    };
  };
};

const networkErrorFetch = async () => { throw new Error('ECONNREFUSED'); };

const buildCtx = (overrides = {}) => ({
  bindings: { restBaseUrl: 'https://tianyan.example.com', ...(overrides.bindings ?? {}) },
  config: overrides.config ?? {},
  secret: overrides.secret !== undefined ? overrides.secret : { login_key: 'my-login-key' },
  limits: { timeoutMs: 5000, ...(overrides.limits ?? {}) },
  meta: overrides.meta ?? {},
  req: overrides.req ?? {},
});

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------
test('rpcdef exposes LIST_ALARMS path', () => {
  globalThis.fetch = makeSeqFetch({});
  const def = rpcdef(buildCtx());
  assert.equal(typeof def[PATH_LIST_ALARMS], 'function');
});

test('handlers exposes key without leading slash', () => {
  assert.equal(typeof handlers[KEY_LIST_ALARMS], 'function');
});

// ---------------------------------------------------------------------------
// ListAlarms — success cases
// ---------------------------------------------------------------------------
describe('ListAlarms success', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('required params only: offset + limit', async () => {
    const apiResp = { data: { items: [{ id: 1 }, { id: 2 }], total: 5, status: 1000 } };
    globalThis.fetch = makeSeqFetch(apiResp);
    const ctx = buildCtx({ req: { offset: 1, limit: 20 } });
    const r = await rpcdef(ctx)[PATH_LIST_ALARMS]();
    assert.equal(r.total, 5);
    assert.equal(r.items.length, 2);
  });

  it('all optional filters passed', async () => {
    const apiResp = { data: { items: [{ id: 3 }], total: 1, status: 1000 } };
    globalThis.fetch = makeSeqFetch(apiResp);
    const ctx = buildCtx({
      req: {
        offset: 1,
        limit: 10,
        hazard_level: { value: 2 },
        start_time: { value: 1700000000000 },
        end_time: { value: 1700086400000 },
        threat_name: { value: 'Mimikatz' },
        attack_sip: { value: '10.0.0.1' },
        alarm_sip: { value: '192.168.1.5' },
        status: { value: 'open' },
        threat_type: { value: 'lateral_movement' },
        host_state: { value: 'compromised' },
        data_source: { value: 'ids' },
        serial_num: { value: 'SN-12345' },
        ioc: { value: 'malware.exe' },
      },
    });
    const r = await rpcdef(ctx)[PATH_LIST_ALARMS]();
    assert.equal(r.total, 1);
    assert.equal(r.items.length, 1);
  });

  it('empty items array', async () => {
    const apiResp = { data: { items: [], total: 0, status: 1000 } };
    globalThis.fetch = makeSeqFetch(apiResp);
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    const r = await rpcdef(ctx)[PATH_LIST_ALARMS]();
    assert.equal(r.total, 0);
    assert.deepEqual(r.items, []);
  });

  it('missing data.items falls back to []', async () => {
    globalThis.fetch = makeSeqFetch({ data: { total: 0 } });
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    const r = await rpcdef(ctx)[PATH_LIST_ALARMS]();
    assert.deepEqual(r.items, []);
  });

  it('missing data.total falls back to 0', async () => {
    globalThis.fetch = makeSeqFetch({ data: { items: [] } });
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    const r = await rpcdef(ctx)[PATH_LIST_ALARMS]();
    assert.equal(r.total, 0);
  });

  it('items are wrapped as google.protobuf.Value structValues', async () => {
    globalThis.fetch = makeSeqFetch({ data: { items: [{ id: 99, name: 'alert' }], total: 1 } });
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    const r = await rpcdef(ctx)[PATH_LIST_ALARMS]();
    assert.ok(r.items[0].structValue);
    assert.deepEqual(r.items[0].structValue.fields.id, { numberValue: 99 });
  });

  it('handlers key works (two-arg convention)', async () => {
    globalThis.fetch = makeSeqFetch({ data: { items: [], total: 3 } });
    const r = await handlers[KEY_LIST_ALARMS]({ offset: 1, limit: 5 }, buildCtx());
    assert.equal(r.total, 3);
  });

  it('handlers key works (single ctx-object convention)', async () => {
    globalThis.fetch = makeSeqFetch({ data: { items: [], total: 7 } });
    const ctx = buildCtx({ req: { offset: 1, limit: 5 } });
    const r = await handlers[KEY_LIST_ALARMS](ctx);
    assert.equal(r.total, 7);
  });

  it('username from secret overrides default tapadmin', async () => {
    let capturedBody = '';
    let call = 0;
    globalThis.fetch = async (url, init) => {
      call++;
      if (call === 1) {
        capturedBody = init?.body ?? '';
        return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders({}) };
      }
      if (call === 2) {
        return { ok: true, status: 200, text: async () => AUTH_HTML_BODY, headers: makeHeaders({ 'set-cookie': 'session=abc' }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: { items: [], total: 0 } }), headers: makeHeaders({}) };
    };
    const ctx = buildCtx({ secret: { login_key: 'key', username: 'customuser' }, req: { offset: 1, limit: 10 } });
    await rpcdef(ctx)[PATH_LIST_ALARMS]();
    assert.ok(capturedBody.includes('customuser'));
  });

  it('cookie from Set-Cookie header is forwarded', async () => {
    let capturedCookie = '';
    let call = 0;
    globalThis.fetch = async (url, init) => {
      call++;
      if (call === 1) return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders({}) };
      if (call === 2) return { ok: true, status: 200, text: async () => AUTH_HTML_BODY, headers: makeHeaders({ 'set-cookie': 'session=xyz123; Path=/' }) };
      capturedCookie = init?.headers?.Cookie ?? '';
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: { items: [], total: 0 } }), headers: makeHeaders({}) };
    };
    const ctx = buildCtx({ req: { offset: 1, limit: 5 } });
    await rpcdef(ctx)[PATH_LIST_ALARMS]();
    assert.ok(capturedCookie.includes('session=xyz123'));
  });

  it('csrf_token from HTML is forwarded in query string', async () => {
    let capturedUrl = '';
    let call = 0;
    globalThis.fetch = async (url, init) => {
      call++;
      if (call === 1) return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders({}) };
      if (call === 2) return { ok: true, status: 200, text: async () => AUTH_HTML_BODY, headers: makeHeaders({ 'set-cookie': 'session=s' }) };
      capturedUrl = url;
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: { items: [], total: 0 } }), headers: makeHeaders({}) };
    };
    const ctx = buildCtx({ req: { offset: 1, limit: 5 } });
    await rpcdef(ctx)[PATH_LIST_ALARMS]();
    assert.ok(capturedUrl.includes('csrf_token=abc123def456'));
  });

  it('multiple cookies joined with "; "', async () => {
    let capturedCookie = '';
    let call = 0;
    globalThis.fetch = async (url, init) => {
      call++;
      if (call === 1) return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders({}) };
      if (call === 2) {
        return {
          ok: true, status: 200,
          text: async () => AUTH_HTML_BODY,
          headers: makeHeaders({ 'set-cookie': 'session=abc; Path=/, token=xyz; HttpOnly' }),
        };
      }
      capturedCookie = init?.headers?.Cookie ?? '';
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: { items: [], total: 0 } }), headers: makeHeaders({}) };
    };
    const ctx = buildCtx({ req: { offset: 1, limit: 5 } });
    await rpcdef(ctx)[PATH_LIST_ALARMS]();
    assert.ok(capturedCookie.includes('session=abc'));
    assert.ok(capturedCookie.includes('token=xyz'));
  });
});

// ---------------------------------------------------------------------------
// ListAlarms — validation errors
// ---------------------------------------------------------------------------
describe('ListAlarms validation errors', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('throws INVALID_ARGUMENT when offset missing', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx({ req: { limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_ALARMS](), /INVALID_ARGUMENT/);
  });

  it('throws INVALID_ARGUMENT when limit missing', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx({ req: { offset: 1 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_ALARMS](), /INVALID_ARGUMENT/);
  });

  it('throws INVALID_ARGUMENT when login_key missing', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx({ secret: {}, req: { offset: 1, limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_ALARMS](), /INVALID_ARGUMENT/);
  });

  it('throws INVALID_ARGUMENT when restBaseUrl missing', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx({ bindings: { restBaseUrl: '' }, req: { offset: 1, limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_ALARMS](), /INVALID_ARGUMENT/);
  });
});

// ---------------------------------------------------------------------------
// ListAlarms — auth errors
// ---------------------------------------------------------------------------
describe('ListAlarms auth errors', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('throws PERMISSION_DENIED on auth step1 HTTP 401', async () => {
    globalThis.fetch = async () => ({
      ok: false, status: 401,
      text: async () => 'Unauthorized',
      headers: makeHeaders({}),
    });
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_ALARMS](), /PERMISSION_DENIED/);
  });

  it('throws PERMISSION_DENIED on auth step1 HTTP 403', async () => {
    globalThis.fetch = async () => ({
      ok: false, status: 403,
      text: async () => 'Forbidden',
      headers: makeHeaders({}),
    });
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_ALARMS](), /PERMISSION_DENIED/);
  });

  it('throws PERMISSION_DENIED when access_token absent in step1 response', async () => {
    let call = 0;
    globalThis.fetch = async () => {
      call++;
      if (call === 1) return { ok: true, status: 200, text: async () => JSON.stringify({ status: 200 }), headers: makeHeaders({}) };
      return { ok: true, status: 200, text: async () => AUTH_HTML_BODY, headers: makeHeaders({ 'set-cookie': 'session=s' }) };
    };
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_ALARMS](), /PERMISSION_DENIED/);
  });

  it('throws UNKNOWN when csrf_token not found in HTML', async () => {
    let call = 0;
    globalThis.fetch = async () => {
      call++;
      if (call === 1) return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders({}) };
      if (call === 2) return { ok: true, status: 200, text: async () => '<html>no csrf here</html>', headers: makeHeaders({ 'set-cookie': 'session=s' }) };
      return { ok: true, status: 200, text: async () => '{}', headers: makeHeaders({}) };
    };
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_ALARMS](), /UNKNOWN/);
  });

  it('throws UNKNOWN when csrf-token uses alternate match pattern', async () => {
    // Test the second regex branch: csrf-token.*?content="..."
    let call = 0;
    globalThis.fetch = async () => {
      call++;
      if (call === 1) return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders({}) };
      if (call === 2) {
        const html = '<meta id="csrf-token" content="deadbeef1234">';
        return { ok: true, status: 200, text: async () => html, headers: makeHeaders({ 'set-cookie': 'session=s' }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: { items: [], total: 0 } }), headers: makeHeaders({}) };
    };
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    const r = await rpcdef(ctx)[PATH_LIST_ALARMS]();
    assert.equal(r.total, 0);
  });
});

// ---------------------------------------------------------------------------
// ListAlarms — network and HTTP errors
// ---------------------------------------------------------------------------
describe('ListAlarms network and HTTP errors', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('throws UNAVAILABLE on network error during auth step1', async () => {
    globalThis.fetch = networkErrorFetch;
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_ALARMS](), /UNAVAILABLE/);
  });

  it('throws UNAVAILABLE on network error during API call', async () => {
    let call = 0;
    globalThis.fetch = async () => {
      call++;
      if (call === 1) return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders({}) };
      if (call === 2) return { ok: true, status: 200, text: async () => AUTH_HTML_BODY, headers: makeHeaders({ 'set-cookie': 'session=s' }) };
      throw new Error('ECONNREFUSED');
    };
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_ALARMS](), /UNAVAILABLE/);
  });

  it('throws UNAVAILABLE on HTTP 500 from API', async () => {
    globalThis.fetch = makeSeqFetch('Internal Server Error', 500);
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_ALARMS](), /UNAVAILABLE/);
  });

  it('throws PERMISSION_DENIED on HTTP 401 from API', async () => {
    globalThis.fetch = makeSeqFetch('Unauthorized', 401);
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_ALARMS](), /PERMISSION_DENIED/);
  });

  it('throws PERMISSION_DENIED on HTTP 403 from API', async () => {
    globalThis.fetch = makeSeqFetch('Forbidden', 403);
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_ALARMS](), /PERMISSION_DENIED/);
  });

  it('throws FAILED_PRECONDITION on HTTP 422 from API', async () => {
    globalThis.fetch = makeSeqFetch('Unprocessable', 422);
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_ALARMS](), /FAILED_PRECONDITION/);
  });

  it('throws UNKNOWN on non-JSON API response', async () => {
    globalThis.fetch = makeSeqFetch('<html>error</html>');
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_ALARMS](), /UNKNOWN/);
  });

  it('throws UNKNOWN on empty API response body', async () => {
    globalThis.fetch = makeSeqFetch('');
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_ALARMS](), /UNKNOWN/);
  });

  it('network error with cause.message is used in UNAVAILABLE', async () => {
    globalThis.fetch = async () => {
      const e = new Error('wrapper');
      e.cause = new Error('connect ECONNREFUSED 10.0.0.1:443');
      throw e;
    };
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_ALARMS](), /UNAVAILABLE/);
  });
});

// ---------------------------------------------------------------------------
// TLS options
// ---------------------------------------------------------------------------
describe('TLS skip verify', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('tlsInsecureSkipVerify: true still calls fetch', async () => {
    globalThis.fetch = makeSeqFetch({ data: { items: [], total: 0 } });
    const ctx = buildCtx({ bindings: { restBaseUrl: 'https://tianyan.example.com', tlsInsecureSkipVerify: true }, req: { offset: 1, limit: 5 } });
    const r = await rpcdef(ctx)[PATH_LIST_ALARMS]();
    assert.equal(r.total, 0);
  });

  it('skipTlsVerify alias works', async () => {
    globalThis.fetch = makeSeqFetch({ data: { items: [], total: 0 } });
    const ctx = buildCtx({ bindings: { restBaseUrl: 'https://tianyan.example.com', skipTlsVerify: true }, req: { offset: 1, limit: 5 } });
    const r = await rpcdef(ctx)[PATH_LIST_ALARMS]();
    assert.equal(r.total, 0);
  });

  it('skip_tls_verify alias works', async () => {
    globalThis.fetch = makeSeqFetch({ data: { items: [], total: 0 } });
    const ctx = buildCtx({ bindings: { restBaseUrl: 'https://tianyan.example.com', skip_tls_verify: true }, req: { offset: 1, limit: 5 } });
    const r = await rpcdef(ctx)[PATH_LIST_ALARMS]();
    assert.equal(r.total, 0);
  });

  it('tls_insecure_skip_verify alias works', async () => {
    globalThis.fetch = makeSeqFetch({ data: { items: [], total: 0 } });
    const ctx = buildCtx({ bindings: { restBaseUrl: 'https://tianyan.example.com', tls_insecure_skip_verify: true }, req: { offset: 1, limit: 5 } });
    const r = await rpcdef(ctx)[PATH_LIST_ALARMS]();
    assert.equal(r.total, 0);
  });
});

// ---------------------------------------------------------------------------
// URL aliases
// ---------------------------------------------------------------------------
describe('URL aliases', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('base_url alias accepted', async () => {
    globalThis.fetch = makeSeqFetch({ data: { items: [], total: 0 } });
    const ctx = { bindings: { base_url: 'https://tianyan.example.com' }, config: {}, secret: { login_key: 'k' }, limits: { timeoutMs: 5000 }, meta: {}, req: { offset: 1, limit: 5 } };
    const r = await rpcdef(ctx)[PATH_LIST_ALARMS]();
    assert.equal(r.total, 0);
  });

  it('endpoint alias accepted', async () => {
    globalThis.fetch = makeSeqFetch({ data: { items: [], total: 0 } });
    const ctx = { bindings: { endpoint: 'https://tianyan.example.com' }, config: {}, secret: { login_key: 'k' }, limits: { timeoutMs: 5000 }, meta: {}, req: { offset: 1, limit: 5 } };
    const r = await rpcdef(ctx)[PATH_LIST_ALARMS]();
    assert.equal(r.total, 0);
  });
});

// ---------------------------------------------------------------------------
// timeoutMs fallback
// ---------------------------------------------------------------------------
describe('timeoutMs', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('timeoutMs=0 falls back to default', async () => {
    globalThis.fetch = makeSeqFetch({ data: { items: [], total: 0 } });
    const ctx = buildCtx({ limits: { timeoutMs: 0 }, req: { offset: 1, limit: 5 } });
    const r = await rpcdef(ctx)[PATH_LIST_ALARMS]();
    assert.equal(r.total, 0);
  });
});

// ---------------------------------------------------------------------------
// _test helpers
// ---------------------------------------------------------------------------
describe('_test.sha256', () => {
  it('produces expected hex digest', () => {
    const h = _test.sha256('hello');
    assert.equal(h, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('produces 64-char hex string', () => {
    assert.equal(_test.sha256('test').length, 64);
  });
});

describe('_test.toValue', () => {
  it('null -> undefined', () => assert.equal(_test.toValue(null), undefined));
  it('undefined -> undefined', () => assert.equal(_test.toValue(undefined), undefined));
  it('string -> stringValue', () => assert.deepEqual(_test.toValue('hi'), { stringValue: 'hi' }));
  it('number -> numberValue', () => assert.deepEqual(_test.toValue(42), { numberValue: 42 }));
  it('true -> boolValue', () => assert.deepEqual(_test.toValue(true), { boolValue: true }));
  it('false -> boolValue', () => assert.deepEqual(_test.toValue(false), { boolValue: false }));
  it('array -> listValue', () => {
    const r = _test.toValue([1, 'x']);
    assert.ok(r.listValue);
    assert.equal(r.listValue.values.length, 2);
  });
  it('null in array -> filtered out', () => {
    const r = _test.toValue([null, 'a']);
    assert.equal(r.listValue.values.length, 1);
  });
  it('object -> structValue', () => {
    const r = _test.toValue({ a: 'x', b: 2 });
    assert.ok(r.structValue);
    assert.deepEqual(r.structValue.fields.a, { stringValue: 'x' });
  });
  it('null in object field -> nullValue sentinel', () => {
    const r = _test.toValue({ key: null });
    assert.deepEqual(r.structValue.fields.key, { nullValue: 'NULL_VALUE' });
  });
  it('function -> stringValue fallback', () => {
    const r = _test.toValue(function myFn() {});
    assert.ok(typeof r.stringValue === 'string');
  });
});

describe('_test.normalizeBaseUrl', () => {
  it('valid https -> normalized', () => assert.equal(_test.normalizeBaseUrl('https://host:8443'), 'https://host:8443'));
  it('trailing slash stripped', () => assert.equal(_test.normalizeBaseUrl('https://host:8443/'), 'https://host:8443'));
  it('multiple trailing slashes stripped', () => assert.equal(_test.normalizeBaseUrl('HTTPS://host///'), 'HTTPS://host'));
  it('http scheme valid', () => assert.equal(_test.normalizeBaseUrl('http://192.168.1.1:8080'), 'http://192.168.1.1:8080'));
  it('no scheme -> null', () => assert.equal(_test.normalizeBaseUrl('host:8443'), null));
  it('empty string -> null', () => assert.equal(_test.normalizeBaseUrl(''), null));
});

describe('_test.toInt', () => {
  it('integer -> same', () => assert.equal(_test.toInt(5), 5));
  it('0 is valid', () => assert.equal(_test.toInt(0), 0));
  it('string integer -> number', () => assert.equal(_test.toInt('42'), 42));
  it('float -> null', () => assert.equal(_test.toInt(1.5), null));
  it('null -> null', () => assert.equal(_test.toInt(null), null));
  it('undefined -> null', () => assert.equal(_test.toInt(undefined), null));
  it('NaN string -> null', () => assert.equal(_test.toInt('abc'), null));
  it('wrapper {value} -> extracts', () => assert.equal(_test.toInt({ value: 7 }), 7));
});

describe('_test.unwrap', () => {
  it('null -> undefined', () => assert.equal(_test.unwrap(null), undefined));
  it('undefined -> undefined', () => assert.equal(_test.unwrap(undefined), undefined));
  it('string -> same', () => assert.equal(_test.unwrap('hello'), 'hello'));
  it('{value: str} -> extracts', () => assert.equal(_test.unwrap({ value: 'abc' }), 'abc'));
  it('{value: null} -> empty string', () => assert.equal(_test.unwrap({ value: null }), ''));
  it('number -> string', () => assert.equal(_test.unwrap(42), '42'));
});

describe('_test.mergedBindings', () => {
  it('bindings wins over config and secret', () => {
    const ctx = { config: { restBaseUrl: 'from-config' }, secret: { login_key: 'k' }, bindings: { restBaseUrl: 'from-bindings' } };
    const merged = _test.mergedBindings(ctx);
    assert.equal(merged.restBaseUrl, 'from-bindings');
    assert.equal(merged.login_key, 'k');
  });

  it('empty ctx -> returns object', () => assert.equal(typeof _test.mergedBindings({}), 'object'));

  it('config values available when not overridden', () => {
    const ctx = { config: { timeoutMs: 3000 }, secret: {}, bindings: {} };
    assert.equal(_test.mergedBindings(ctx).timeoutMs, 3000);
  });
});
