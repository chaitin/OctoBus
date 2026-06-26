import { describe, it, afterEach } from 'node:test';
import test from 'node:test';
import assert from 'node:assert/strict';

import { rpcdef, handlers, _test } from '../src/qianxin-tianyan-platform.js';

const PKG = 'QIANXIN_TianYan_Platform';
const PREFIX = `/${PKG}.${PKG}/`;

const PATH_LIST_ALARMS              = `${PREFIX}ListAlarms`;
const PATH_UPDATE_ALARM_STATUS      = `${PREFIX}UpdateAlarmStatus`;
const PATH_SEARCH_LOGS              = `${PREFIX}SearchLogs`;
const PATH_SPL_SEARCH               = `${PREFIX}SPLSearch`;
const PATH_LIST_ASSETS              = `${PREFIX}ListAssets`;
const PATH_LIST_VULNERABILITIES     = `${PREFIX}ListVulnerabilities`;
const PATH_THREAT_HUNT_SEARCH       = `${PREFIX}ThreatHuntSearch`;
const PATH_ADD_FLOW_WHITELIST       = `${PREFIX}AddFlowWhitelist`;
const PATH_GET_COMPROMISED_HOST     = `${PREFIX}GetCompromisedHostStatus`;

const KEY_LIST_ALARMS              = `${PKG}.${PKG}/ListAlarms`;
const KEY_UPDATE_ALARM_STATUS      = `${PKG}.${PKG}/UpdateAlarmStatus`;
const KEY_SEARCH_LOGS              = `${PKG}.${PKG}/SearchLogs`;
const KEY_SPL_SEARCH               = `${PKG}.${PKG}/SPLSearch`;
const KEY_LIST_ASSETS              = `${PKG}.${PKG}/ListAssets`;
const KEY_LIST_VULNERABILITIES     = `${PKG}.${PKG}/ListVulnerabilities`;
const KEY_THREAT_HUNT_SEARCH       = `${PKG}.${PKG}/ThreatHuntSearch`;
const KEY_ADD_FLOW_WHITELIST       = `${PKG}.${PKG}/AddFlowWhitelist`;
const KEY_GET_COMPROMISED_HOST     = `${PKG}.${PKG}/GetCompromisedHostStatus`;

// ---------------------------------------------------------------------------
// Shared mock helpers
// ---------------------------------------------------------------------------

const AUTH_TOKEN_BODY = JSON.stringify({ access_token: 'test_token', status: 200 });
const AUTH_HTML_BODY  = '<html><head><meta name="csrf-token" content="abc123def456"></head><body></body></html>';

const makeHeaders = (entries = {}) => ({
  get: (name) => entries[name.toLowerCase()] ?? null,
});

const makeSeqFetch = (apiBody, apiStatus = 200) => {
  let call = 0;
  return async (_url, _init) => {
    call++;
    if (call === 1) {
      return {
        ok: true, status: 200,
        text: async () => AUTH_TOKEN_BODY,
        headers: makeHeaders({}),
      };
    }
    if (call === 2) {
      return {
        ok: true, status: 200,
        text: async () => AUTH_HTML_BODY,
        headers: makeHeaders({ 'set-cookie': 'session=xyz; Path=/' }),
      };
    }
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
test('rpcdef exposes all 9 paths', () => {
  globalThis.fetch = makeSeqFetch({});
  const def = rpcdef(buildCtx());
  assert.equal(typeof def[PATH_LIST_ALARMS], 'function');
  assert.equal(typeof def[PATH_UPDATE_ALARM_STATUS], 'function');
  assert.equal(typeof def[PATH_SEARCH_LOGS], 'function');
  assert.equal(typeof def[PATH_SPL_SEARCH], 'function');
  assert.equal(typeof def[PATH_LIST_ASSETS], 'function');
  assert.equal(typeof def[PATH_LIST_VULNERABILITIES], 'function');
  assert.equal(typeof def[PATH_THREAT_HUNT_SEARCH], 'function');
  assert.equal(typeof def[PATH_ADD_FLOW_WHITELIST], 'function');
  assert.equal(typeof def[PATH_GET_COMPROMISED_HOST], 'function');
});

test('handlers exposes keys without leading slash', () => {
  assert.equal(typeof handlers[KEY_LIST_ALARMS], 'function');
  assert.equal(typeof handlers[KEY_UPDATE_ALARM_STATUS], 'function');
  assert.equal(typeof handlers[KEY_SEARCH_LOGS], 'function');
  assert.equal(typeof handlers[KEY_LIST_ASSETS], 'function');
  assert.equal(typeof handlers[KEY_GET_COMPROMISED_HOST], 'function');
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
        offset: 1, limit: 10,
        hazard_level: { value: 2 },
        start_time: { value: 1700000000000 },
        end_time: { value: 1700086400000 },
        threat_name: { value: 'Mimikatz' },
        attack_sip: { value: '10.0.0.1' },
        alarm_sip: { value: '192.168.1.5' },
        status: { value: '0' },
        threat_type: { value: 'lateral_movement' },
        host_state: { value: '1' },
        data_source: { value: '1' },
        serial_num: { value: 'SN-12345' },
        ioc: { value: 'malware.exe' },
        order_by: { value: 'access_time:desc' },
      },
    });
    const r = await rpcdef(ctx)[PATH_LIST_ALARMS]();
    assert.equal(r.total, 1);
  });

  it('attack_sip and alarm_sip are gzip+base64 encoded in the request URL', async () => {
    let capturedUrl = '';
    let call = 0;
    globalThis.fetch = async (url, init) => {
      call++;
      if (call === 1) return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders({}) };
      if (call === 2) return { ok: true, status: 200, text: async () => AUTH_HTML_BODY, headers: makeHeaders({ 'set-cookie': 'session=s' }) };
      capturedUrl = url;
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: { items: [], total: 0 } }), headers: makeHeaders({}) };
    };
    const ctx = buildCtx({ req: { offset: 1, limit: 10, attack_sip: { value: '10.0.0.1' } } });
    await rpcdef(ctx)[PATH_LIST_ALARMS]();
    const u = new URL(capturedUrl);
    const encoded = u.searchParams.get('attack_sip');
    // encoded should be base64 (not the raw IP)
    assert.ok(encoded !== '10.0.0.1', 'attack_sip must be encoded, not plain text');
    assert.ok(encoded.length > 10, 'encoded value should be longer than raw IP');
  });

  it('empty items array', async () => {
    globalThis.fetch = makeSeqFetch({ data: { items: [], total: 0, status: 1000 } });
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

  it('items wrapped as google.protobuf.Value structValues', async () => {
    globalThis.fetch = makeSeqFetch({ data: { items: [{ id: 99, name: 'alert' }], total: 1 } });
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    const r = await rpcdef(ctx)[PATH_LIST_ALARMS]();
    assert.ok(r.items[0].structValue);
    assert.deepEqual(r.items[0].structValue.fields.id, { numberValue: 99 });
  });

  it('handlers two-arg convention', async () => {
    globalThis.fetch = makeSeqFetch({ data: { items: [], total: 3 } });
    const r = await handlers[KEY_LIST_ALARMS]({ offset: 1, limit: 5 }, buildCtx());
    assert.equal(r.total, 3);
  });

  it('handlers single ctx-object convention', async () => {
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
      if (call === 1) { capturedBody = init?.body ?? ''; return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders({}) }; }
      if (call === 2) return { ok: true, status: 200, text: async () => AUTH_HTML_BODY, headers: makeHeaders({ 'set-cookie': 'session=abc' }) };
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: { items: [], total: 0 } }), headers: makeHeaders({}) };
    };
    const ctx = buildCtx({ secret: { login_key: 'key', username: 'customuser' }, req: { offset: 1, limit: 10 } });
    await rpcdef(ctx)[PATH_LIST_ALARMS]();
    assert.ok(capturedBody.includes('customuser'));
  });

  it('cookie forwarded from Set-Cookie', async () => {
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

  it('csrf_token forwarded in query string', async () => {
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
      if (call === 2) return { ok: true, status: 200, text: async () => AUTH_HTML_BODY, headers: makeHeaders({ 'set-cookie': 'session=abc; Path=/, token=xyz; HttpOnly' }) };
      capturedCookie = init?.headers?.Cookie ?? '';
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: { items: [], total: 0 } }), headers: makeHeaders({}) };
    };
    const ctx = buildCtx({ req: { offset: 1, limit: 5 } });
    await rpcdef(ctx)[PATH_LIST_ALARMS]();
    assert.ok(capturedCookie.includes('session=abc'));
    assert.ok(capturedCookie.includes('token=xyz'));
  });

  it('throws FAILED_PRECONDITION when API returns error envelope', async () => {
    globalThis.fetch = makeSeqFetch({ error: { message: 'no permission', code: 5000 } });
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_ALARMS](), /FAILED_PRECONDITION/);
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

  it('throws PERMISSION_DENIED on HTTP 401 from auth step1', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => 'Unauthorized', headers: makeHeaders({}) });
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_ALARMS](), /PERMISSION_DENIED/);
  });

  it('throws PERMISSION_DENIED on HTTP 403 from auth step1', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => 'Forbidden', headers: makeHeaders({}) });
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_ALARMS](), /PERMISSION_DENIED/);
  });

  it('throws PERMISSION_DENIED when access_token absent', async () => {
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

  it('csrf-token alternate regex pattern', async () => {
    let call = 0;
    globalThis.fetch = async () => {
      call++;
      if (call === 1) return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders({}) };
      if (call === 2) return { ok: true, status: 200, text: async () => '<meta id="csrf-token" content="deadbeef1234">', headers: makeHeaders({ 'set-cookie': 'session=s' }) };
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: { items: [], total: 0 } }), headers: makeHeaders({}) };
    };
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    const r = await rpcdef(ctx)[PATH_LIST_ALARMS]();
    assert.equal(r.total, 0);
  });
});

// ---------------------------------------------------------------------------
// ListAlarms — network / HTTP errors
// ---------------------------------------------------------------------------
describe('ListAlarms network errors', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('throws UNAVAILABLE on network error', async () => {
    globalThis.fetch = networkErrorFetch;
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_ALARMS](), /UNAVAILABLE/);
  });

  it('throws UNAVAILABLE on HTTP 500', async () => {
    globalThis.fetch = makeSeqFetch('Internal Server Error', 500);
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_ALARMS](), /UNAVAILABLE/);
  });

  it('throws FAILED_PRECONDITION on HTTP 422', async () => {
    globalThis.fetch = makeSeqFetch('Unprocessable', 422);
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_ALARMS](), /FAILED_PRECONDITION/);
  });

  it('throws UNKNOWN on non-JSON response', async () => {
    globalThis.fetch = makeSeqFetch('<html>error</html>');
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_ALARMS](), /UNKNOWN/);
  });

  it('throws UNKNOWN on empty response', async () => {
    globalThis.fetch = makeSeqFetch('');
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_ALARMS](), /UNKNOWN/);
  });

  it('network error with cause.message in UNAVAILABLE', async () => {
    globalThis.fetch = async () => { const e = new Error('wrapper'); e.cause = new Error('connect ECONNREFUSED'); throw e; };
    const ctx = buildCtx({ req: { offset: 1, limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_ALARMS](), /UNAVAILABLE/);
  });
});

// ---------------------------------------------------------------------------
// UpdateAlarmStatus
// ---------------------------------------------------------------------------
describe('UpdateAlarmStatus success', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('marks single alarm as handled (status=1)', async () => {
    let capturedBody = '';
    let call = 0;
    globalThis.fetch = async (url, init) => {
      call++;
      if (call === 1) return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders({}) };
      if (call === 2) return { ok: true, status: 200, text: async () => AUTH_HTML_BODY, headers: makeHeaders({ 'set-cookie': 'session=s' }) };
      capturedBody = init?.body ?? '';
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: { status: 1000 } }), headers: makeHeaders({}) };
    };
    const ctx = buildCtx({ req: { ids: 'alarm-001', status: 1 } });
    const r = await rpcdef(ctx)[PATH_UPDATE_ALARM_STATUS]();
    assert.deepEqual(r, {});
    const parsed = JSON.parse(capturedBody);
    assert.deepEqual(parsed.ids, ['alarm-001']);
    assert.equal(parsed.status, 1);
  });

  it('marks multiple alarms as false-positive (status=7)', async () => {
    let capturedBody = '';
    let call = 0;
    globalThis.fetch = async (url, init) => {
      call++;
      if (call === 1) return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders({}) };
      if (call === 2) return { ok: true, status: 200, text: async () => AUTH_HTML_BODY, headers: makeHeaders({ 'set-cookie': 'session=s' }) };
      capturedBody = init?.body ?? '';
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: { status: 1000 } }), headers: makeHeaders({}) };
    };
    const ctx = buildCtx({ req: { ids: 'a1, a2, a3', status: 7 } });
    const r = await rpcdef(ctx)[PATH_UPDATE_ALARM_STATUS]();
    assert.deepEqual(r, {});
    const parsed = JSON.parse(capturedBody);
    assert.equal(parsed.ids.length, 3);
    assert.equal(parsed.status, 7);
  });

  it('uses PUT method to /alarm/alarm/list', async () => {
    let capturedMethod = '';
    let call = 0;
    globalThis.fetch = async (url, init) => {
      call++;
      if (call === 1) return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders({}) };
      if (call === 2) return { ok: true, status: 200, text: async () => AUTH_HTML_BODY, headers: makeHeaders({ 'set-cookie': 'session=s' }) };
      capturedMethod = init?.method ?? '';
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: {} }), headers: makeHeaders({}) };
    };
    const ctx = buildCtx({ req: { ids: 'x', status: 0 } });
    await rpcdef(ctx)[PATH_UPDATE_ALARM_STATUS]();
    assert.equal(capturedMethod, 'PUT');
  });

  it('handlers key works', async () => {
    globalThis.fetch = makeSeqFetch({ data: { status: 1000 } });
    const r = await handlers[KEY_UPDATE_ALARM_STATUS]({ ids: 'a1', status: 6 }, buildCtx());
    assert.deepEqual(r, {});
  });
});

describe('UpdateAlarmStatus validation errors', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('throws INVALID_ARGUMENT when ids missing', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx({ req: { status: 1 } });
    await assert.rejects(rpcdef(ctx)[PATH_UPDATE_ALARM_STATUS](), /INVALID_ARGUMENT/);
  });

  it('throws INVALID_ARGUMENT when status missing', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx({ req: { ids: 'a1' } });
    await assert.rejects(rpcdef(ctx)[PATH_UPDATE_ALARM_STATUS](), /INVALID_ARGUMENT/);
  });

  it('throws INVALID_ARGUMENT when status is invalid value', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx({ req: { ids: 'a1', status: 99 } });
    await assert.rejects(rpcdef(ctx)[PATH_UPDATE_ALARM_STATUS](), /INVALID_ARGUMENT/);
  });

  it('accepts all valid status values: 0, 1, 6, 7', async () => {
    for (const s of [0, 1, 6, 7]) {
      globalThis.fetch = makeSeqFetch({ data: { status: 1000 } });
      const ctx = buildCtx({ req: { ids: 'x', status: s } });
      const r = await rpcdef(ctx)[PATH_UPDATE_ALARM_STATUS]();
      assert.deepEqual(r, {});
    }
  });
});

// ---------------------------------------------------------------------------
// SearchLogs
// ---------------------------------------------------------------------------
describe('SearchLogs success', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns total and items from search.hits', async () => {
    const apiResp = {
      data: {
        status: 1000,
        data: {
          search: { hits: [{ _source: { sip: '1.1.1.1', proto: 'http' } }], total: 42 },
          fields: ['sip', 'proto'],
        },
      },
    };
    globalThis.fetch = makeSeqFetch(apiResp);
    const ctx = buildCtx({ req: { start_time: 1700000000000, end_time: 1700086400000, offset: 0, limit: 20 } });
    const r = await rpcdef(ctx)[PATH_SEARCH_LOGS]();
    assert.equal(r.total, 42);
    assert.equal(r.items.length, 1);
    assert.ok(r.items[0].structValue);
    assert.deepEqual(r.fields, ['sip', 'proto']);
  });

  it('keyword passed as query param', async () => {
    let capturedUrl = '';
    let call = 0;
    globalThis.fetch = async (url, init) => {
      call++;
      if (call === 1) return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders({}) };
      if (call === 2) return { ok: true, status: 200, text: async () => AUTH_HTML_BODY, headers: makeHeaders({ 'set-cookie': 'session=s' }) };
      capturedUrl = url;
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: { data: { search: { hits: [], total: 0 }, fields: [] } } }), headers: makeHeaders({}) };
    };
    const ctx = buildCtx({ req: { start_time: 1700000000000, end_time: 1700086400000, offset: 0, limit: 10, keyword: { value: 'sip:10.0.0.1' } } });
    await rpcdef(ctx)[PATH_SEARCH_LOGS]();
    assert.ok(capturedUrl.includes('keyword=sip%3A10.0.0.1') || capturedUrl.includes('keyword=sip:10.0.0.1'));
  });

  it('empty result falls back gracefully', async () => {
    globalThis.fetch = makeSeqFetch({ data: { data: {} } });
    const ctx = buildCtx({ req: { start_time: 1700000000000, end_time: 1700086400000, offset: 0, limit: 10 } });
    const r = await rpcdef(ctx)[PATH_SEARCH_LOGS]();
    assert.equal(r.total, 0);
    assert.deepEqual(r.items, []);
    assert.deepEqual(r.fields, []);
  });

  it('handlers key works', async () => {
    globalThis.fetch = makeSeqFetch({ data: { data: { search: { hits: [], total: 5 }, fields: [] } } });
    const r = await handlers[KEY_SEARCH_LOGS]({ start_time: 1700000000000, end_time: 1700086400000, offset: 0, limit: 5 }, buildCtx());
    assert.equal(r.total, 5);
  });
});

describe('SearchLogs validation errors', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('throws INVALID_ARGUMENT when start_time missing', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx({ req: { end_time: 1700086400000, offset: 0, limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_SEARCH_LOGS](), /INVALID_ARGUMENT/);
  });

  it('throws INVALID_ARGUMENT when end_time missing', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx({ req: { start_time: 1700000000000, offset: 0, limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_SEARCH_LOGS](), /INVALID_ARGUMENT/);
  });

  it('throws INVALID_ARGUMENT when offset missing', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx({ req: { start_time: 1700000000000, end_time: 1700086400000, limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_SEARCH_LOGS](), /INVALID_ARGUMENT/);
  });
});

// ---------------------------------------------------------------------------
// SPLSearch
// ---------------------------------------------------------------------------
describe('SPLSearch success', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns fields and results', async () => {
    const apiResp = { data: { status: 1000, data: { fields: ['sip', 'dport'], results: [{ sip: '1.2.3.4', dport: 80 }] } } };
    globalThis.fetch = makeSeqFetch(apiResp);
    const ctx = buildCtx({ req: { start_time: 1700000000000, end_time: 1700086400000 } });
    const r = await rpcdef(ctx)[PATH_SPL_SEARCH]();
    assert.deepEqual(r.fields, ['sip', 'dport']);
    assert.equal(r.results.length, 1);
    assert.ok(r.results[0].structValue);
  });

  it('empty result', async () => {
    globalThis.fetch = makeSeqFetch({ data: { data: { fields: [], results: [] } } });
    const ctx = buildCtx({ req: { start_time: 1700000000000, end_time: 1700086400000 } });
    const r = await rpcdef(ctx)[PATH_SPL_SEARCH]();
    assert.deepEqual(r.fields, []);
    assert.deepEqual(r.results, []);
  });

  it('handlers key works', async () => {
    globalThis.fetch = makeSeqFetch({ data: { data: { fields: ['f1'], results: [] } } });
    const r = await handlers[KEY_SPL_SEARCH]({ start_time: 1700000000000, end_time: 1700086400000 }, buildCtx());
    assert.deepEqual(r.fields, ['f1']);
  });
});

describe('SPLSearch validation errors', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('throws INVALID_ARGUMENT when start_time missing', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx({ req: { end_time: 1700086400000 } });
    await assert.rejects(rpcdef(ctx)[PATH_SPL_SEARCH](), /INVALID_ARGUMENT/);
  });

  it('throws INVALID_ARGUMENT when end_time missing', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx({ req: { start_time: 1700000000000 } });
    await assert.rejects(rpcdef(ctx)[PATH_SPL_SEARCH](), /INVALID_ARGUMENT/);
  });
});

// ---------------------------------------------------------------------------
// ListAssets
// ---------------------------------------------------------------------------
describe('ListAssets success', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns total and data array', async () => {
    const apiResp = { data: { status: 1000, total: 3, data: [{ id: 1, asset_sip: '10.0.0.1' }, { id: 2, asset_sip: '10.0.0.2' }] } };
    globalThis.fetch = makeSeqFetch(apiResp);
    const ctx = buildCtx({ req: { offset: 0, limit: 10 } });
    const r = await rpcdef(ctx)[PATH_LIST_ASSETS]();
    assert.equal(r.total, 3);
    assert.equal(r.data.length, 2);
    assert.ok(r.data[0].structValue);
  });

  it('optional ip filter included in URL', async () => {
    let capturedUrl = '';
    let call = 0;
    globalThis.fetch = async (url, init) => {
      call++;
      if (call === 1) return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders({}) };
      if (call === 2) return { ok: true, status: 200, text: async () => AUTH_HTML_BODY, headers: makeHeaders({ 'set-cookie': 'session=s' }) };
      capturedUrl = url;
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: { total: 0, data: [] } }), headers: makeHeaders({}) };
    };
    const ctx = buildCtx({ req: { offset: 0, limit: 10, ipaddrs: { value: '10.0.0.1' } } });
    await rpcdef(ctx)[PATH_LIST_ASSETS]();
    assert.ok(capturedUrl.includes('ipaddrs=10.0.0.1'));
  });

  it('empty data array', async () => {
    globalThis.fetch = makeSeqFetch({ data: { total: 0, data: [] } });
    const ctx = buildCtx({ req: { offset: 0, limit: 10 } });
    const r = await rpcdef(ctx)[PATH_LIST_ASSETS]();
    assert.equal(r.total, 0);
    assert.deepEqual(r.data, []);
  });

  it('handlers key works', async () => {
    globalThis.fetch = makeSeqFetch({ data: { total: 1, data: [{ id: 5 }] } });
    const r = await handlers[KEY_LIST_ASSETS]({ offset: 0, limit: 5 }, buildCtx());
    assert.equal(r.total, 1);
  });
});

describe('ListAssets validation errors', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('throws INVALID_ARGUMENT when offset missing', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx({ req: { limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_ASSETS](), /INVALID_ARGUMENT/);
  });

  it('throws INVALID_ARGUMENT when limit missing', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx({ req: { offset: 0 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_ASSETS](), /INVALID_ARGUMENT/);
  });
});

// ---------------------------------------------------------------------------
// ListVulnerabilities
// ---------------------------------------------------------------------------
describe('ListVulnerabilities success', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns total and items', async () => {
    const apiResp = { data: { status: 1000, total: 10, items: [{ id: 'v1', cve: 'CVE-2023-0001' }] } };
    globalThis.fetch = makeSeqFetch(apiResp);
    const ctx = buildCtx({ req: { limit: 20, offset: 0 } });
    const r = await rpcdef(ctx)[PATH_LIST_VULNERABILITIES]();
    assert.equal(r.total, 10);
    assert.equal(r.items.length, 1);
    assert.ok(r.items[0].structValue);
  });

  it('ip filter passed to URL', async () => {
    let capturedUrl = '';
    let call = 0;
    globalThis.fetch = async (url, init) => {
      call++;
      if (call === 1) return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders({}) };
      if (call === 2) return { ok: true, status: 200, text: async () => AUTH_HTML_BODY, headers: makeHeaders({ 'set-cookie': 'session=s' }) };
      capturedUrl = url;
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: { total: 0, items: [] } }), headers: makeHeaders({}) };
    };
    const ctx = buildCtx({ req: { limit: 10, offset: 0, ip: { value: '192.168.1.100' } } });
    await rpcdef(ctx)[PATH_LIST_VULNERABILITIES]();
    assert.ok(capturedUrl.includes('ip=192.168.1.100'));
  });

  it('handlers key works', async () => {
    globalThis.fetch = makeSeqFetch({ data: { total: 2, items: [] } });
    const r = await handlers[KEY_LIST_VULNERABILITIES]({ limit: 10, offset: 0 }, buildCtx());
    assert.equal(r.total, 2);
  });
});

describe('ListVulnerabilities validation errors', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('throws INVALID_ARGUMENT when limit missing', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx({ req: { offset: 0 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_VULNERABILITIES](), /INVALID_ARGUMENT/);
  });

  it('throws INVALID_ARGUMENT when offset missing', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx({ req: { limit: 10 } });
    await assert.rejects(rpcdef(ctx)[PATH_LIST_VULNERABILITIES](), /INVALID_ARGUMENT/);
  });
});

// ---------------------------------------------------------------------------
// ThreatHuntSearch
// ---------------------------------------------------------------------------
describe('ThreatHuntSearch success', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns nodes and links arrays', async () => {
    const apiResp = { data: { nodes: [{ id: 'n1', type: 'ip' }], links: [{ source: 'n1', target: 'n2' }] } };
    globalThis.fetch = makeSeqFetch(apiResp);
    const ctx = buildCtx({ req: { kwd: '10.0.0.1', start_time: 1700000000000, end_time: 1700086400000 } });
    const r = await rpcdef(ctx)[PATH_THREAT_HUNT_SEARCH]();
    assert.equal(r.nodes.length, 1);
    assert.equal(r.links.length, 1);
    assert.ok(r.nodes[0].structValue);
    assert.ok(r.links[0].structValue);
  });

  it('kwd passed in URL', async () => {
    let capturedUrl = '';
    let call = 0;
    globalThis.fetch = async (url, init) => {
      call++;
      if (call === 1) return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders({}) };
      if (call === 2) return { ok: true, status: 200, text: async () => AUTH_HTML_BODY, headers: makeHeaders({ 'set-cookie': 'session=s' }) };
      capturedUrl = url;
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: { nodes: [], links: [] } }), headers: makeHeaders({}) };
    };
    const ctx = buildCtx({ req: { kwd: 'evil.com', start_time: 1700000000000, end_time: 1700086400000 } });
    await rpcdef(ctx)[PATH_THREAT_HUNT_SEARCH]();
    assert.ok(capturedUrl.includes('kwd=evil.com'));
  });

  it('empty graph', async () => {
    globalThis.fetch = makeSeqFetch({ data: {} });
    const ctx = buildCtx({ req: { kwd: 'x', start_time: 1700000000000, end_time: 1700086400000 } });
    const r = await rpcdef(ctx)[PATH_THREAT_HUNT_SEARCH]();
    assert.deepEqual(r.nodes, []);
    assert.deepEqual(r.links, []);
  });

  it('handlers key works', async () => {
    globalThis.fetch = makeSeqFetch({ data: { nodes: [], links: [] } });
    const r = await handlers[KEY_THREAT_HUNT_SEARCH]({ kwd: '1.2.3.4', start_time: 1700000000000, end_time: 1700086400000 }, buildCtx());
    assert.deepEqual(r.nodes, []);
  });
});

describe('ThreatHuntSearch validation errors', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('throws INVALID_ARGUMENT when kwd missing', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx({ req: { start_time: 1700000000000, end_time: 1700086400000 } });
    await assert.rejects(rpcdef(ctx)[PATH_THREAT_HUNT_SEARCH](), /INVALID_ARGUMENT/);
  });

  it('throws INVALID_ARGUMENT when start_time missing', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx({ req: { kwd: 'x', end_time: 1700086400000 } });
    await assert.rejects(rpcdef(ctx)[PATH_THREAT_HUNT_SEARCH](), /INVALID_ARGUMENT/);
  });

  it('throws INVALID_ARGUMENT when end_time missing', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx({ req: { kwd: 'x', start_time: 1700000000000 } });
    await assert.rejects(rpcdef(ctx)[PATH_THREAT_HUNT_SEARCH](), /INVALID_ARGUMENT/);
  });
});

// ---------------------------------------------------------------------------
// AddFlowWhitelist
// ---------------------------------------------------------------------------
describe('AddFlowWhitelist success', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('adds whitelist by alarm_sips', async () => {
    let capturedBody = '';
    let call = 0;
    globalThis.fetch = async (url, init) => {
      call++;
      if (call === 1) return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders({}) };
      if (call === 2) return { ok: true, status: 200, text: async () => AUTH_HTML_BODY, headers: makeHeaders({ 'set-cookie': 'session=s' }) };
      capturedBody = init?.body ?? '';
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: { id: 'wl-001', status: 1000 } }), headers: makeHeaders({}) };
    };
    const ctx = buildCtx({ req: { alarm_sips: { value: '192.168.1.100,192.168.1.101' } } });
    const r = await rpcdef(ctx)[PATH_ADD_FLOW_WHITELIST]();
    assert.ok(r.id?.value === 'wl-001');
    const parsed = JSON.parse(capturedBody);
    assert.equal(parsed.alarm_sips, '192.168.1.100,192.168.1.101');
  });

  it('adds whitelist by attack_sips', async () => {
    globalThis.fetch = makeSeqFetch({ data: { id: 'wl-002' } });
    const ctx = buildCtx({ req: { attack_sips: { value: '10.0.0.1' } } });
    const r = await rpcdef(ctx)[PATH_ADD_FLOW_WHITELIST]();
    assert.ok(r.id?.value === 'wl-002');
  });

  it('adds whitelist by ioc', async () => {
    globalThis.fetch = makeSeqFetch({ data: { data: { id: 'wl-003' } } });
    const ctx = buildCtx({ req: { ioc: { value: 'evil.exe' } } });
    const r = await rpcdef(ctx)[PATH_ADD_FLOW_WHITELIST]();
    assert.ok(r.id?.value === 'wl-003');
  });

  it('adds whitelist by threat_name', async () => {
    globalThis.fetch = makeSeqFetch({ data: {} });
    const ctx = buildCtx({ req: { threat_name: { value: 'Mimikatz' } } });
    const r = await rpcdef(ctx)[PATH_ADD_FLOW_WHITELIST]();
    assert.ok(r.id === undefined);
  });

  it('uses POST method', async () => {
    let capturedMethod = '';
    let call = 0;
    globalThis.fetch = async (url, init) => {
      call++;
      if (call === 1) return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders({}) };
      if (call === 2) return { ok: true, status: 200, text: async () => AUTH_HTML_BODY, headers: makeHeaders({ 'set-cookie': 'session=s' }) };
      capturedMethod = init?.method ?? '';
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: {} }), headers: makeHeaders({}) };
    };
    const ctx = buildCtx({ req: { alarm_sips: { value: '1.2.3.4' } } });
    await rpcdef(ctx)[PATH_ADD_FLOW_WHITELIST]();
    assert.equal(capturedMethod, 'POST');
  });

  it('handlers key works', async () => {
    globalThis.fetch = makeSeqFetch({ data: {} });
    const r = await handlers[KEY_ADD_FLOW_WHITELIST]({ ioc: { value: 'bad.dll' } }, buildCtx());
    assert.ok('id' in r || r.id === undefined);
  });
});

describe('AddFlowWhitelist validation errors', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('throws INVALID_ARGUMENT when none of the required target fields provided', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx({ req: {} });
    await assert.rejects(rpcdef(ctx)[PATH_ADD_FLOW_WHITELIST](), /INVALID_ARGUMENT/);
  });
});

// ---------------------------------------------------------------------------
// GetCompromisedHostStatus
// ---------------------------------------------------------------------------
describe('GetCompromisedHostStatus success', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns alarm_count, risk_value, ioc_count and detail', async () => {
    const apiResp = { data: { alarm_count: 5, risk_value: 85, ioc_count: 3, threat_name: 'Cobalt Strike' } };
    globalThis.fetch = makeSeqFetch(apiResp);
    const ctx = buildCtx({ req: { asset_ip: '10.0.0.50', start_time: 1700000000000, end_time: 1700086400000 } });
    const r = await rpcdef(ctx)[PATH_GET_COMPROMISED_HOST]();
    assert.equal(r.alarm_count, 5);
    assert.equal(r.risk_value, 85);
    assert.equal(r.ioc_count, 3);
    assert.ok(r.detail?.structValue);
  });

  it('missing counts fall back to 0', async () => {
    globalThis.fetch = makeSeqFetch({ data: {} });
    const ctx = buildCtx({ req: { asset_ip: '1.2.3.4', start_time: 1700000000000, end_time: 1700086400000 } });
    const r = await rpcdef(ctx)[PATH_GET_COMPROMISED_HOST]();
    assert.equal(r.alarm_count, 0);
    assert.equal(r.risk_value, 0);
    assert.equal(r.ioc_count, 0);
  });

  it('asset_ip in URL', async () => {
    let capturedUrl = '';
    let call = 0;
    globalThis.fetch = async (url, init) => {
      call++;
      if (call === 1) return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders({}) };
      if (call === 2) return { ok: true, status: 200, text: async () => AUTH_HTML_BODY, headers: makeHeaders({ 'set-cookie': 'session=s' }) };
      capturedUrl = url;
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: {} }), headers: makeHeaders({}) };
    };
    const ctx = buildCtx({ req: { asset_ip: '172.16.0.1', start_time: 1700000000000, end_time: 1700086400000 } });
    await rpcdef(ctx)[PATH_GET_COMPROMISED_HOST]();
    assert.ok(capturedUrl.includes('asset_ip=172.16.0.1'));
  });

  it('handlers key works', async () => {
    globalThis.fetch = makeSeqFetch({ data: { alarm_count: 2, risk_value: 40, ioc_count: 1 } });
    const r = await handlers[KEY_GET_COMPROMISED_HOST]({ asset_ip: '10.0.0.1', start_time: 1700000000000, end_time: 1700086400000 }, buildCtx());
    assert.equal(r.alarm_count, 2);
  });
});

describe('GetCompromisedHostStatus validation errors', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('throws INVALID_ARGUMENT when asset_ip missing', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx({ req: { start_time: 1700000000000, end_time: 1700086400000 } });
    await assert.rejects(rpcdef(ctx)[PATH_GET_COMPROMISED_HOST](), /INVALID_ARGUMENT/);
  });

  it('throws INVALID_ARGUMENT when start_time missing', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx({ req: { asset_ip: '1.2.3.4', end_time: 1700086400000 } });
    await assert.rejects(rpcdef(ctx)[PATH_GET_COMPROMISED_HOST](), /INVALID_ARGUMENT/);
  });

  it('throws INVALID_ARGUMENT when end_time missing', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx({ req: { asset_ip: '1.2.3.4', start_time: 1700000000000 } });
    await assert.rejects(rpcdef(ctx)[PATH_GET_COMPROMISED_HOST](), /INVALID_ARGUMENT/);
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

  it('skip_tls_verify alias works', async () => {
    globalThis.fetch = makeSeqFetch({ data: { items: [], total: 0 } });
    const ctx = buildCtx({ bindings: { restBaseUrl: 'https://tianyan.example.com', skip_tls_verify: true }, req: { offset: 1, limit: 5 } });
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
    assert.equal(_test.sha256('hello'), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });
  it('produces 64-char hex string', () => {
    assert.equal(_test.sha256('test').length, 64);
  });
});

describe('_test.encodeIp', () => {
  it('returns base64 string for an IP', () => {
    const encoded = _test.encodeIp('10.0.0.1');
    assert.equal(typeof encoded, 'string');
    assert.ok(encoded.length > 0);
    assert.ok(encoded !== '10.0.0.1');
  });
  it('different IPs produce different encodings', () => {
    assert.notEqual(_test.encodeIp('1.1.1.1'), _test.encodeIp('2.2.2.2'));
  });
});

describe('_test.checkApiError', () => {
  it('throws FAILED_PRECONDITION on error envelope', () => {
    assert.throws(() => _test.checkApiError({ error: { message: 'bad', code: 9999 } }), /FAILED_PRECONDITION/);
  });
  it('throws PERMISSION_DENIED on error code 1013', () => {
    assert.throws(() => _test.checkApiError({ error: { message: 'expired', code: 1013 } }), /PERMISSION_DENIED/);
  });
  it('does not throw when no error key', () => {
    assert.doesNotThrow(() => _test.checkApiError({ data: { status: 1000 } }));
  });
  it('does not throw on null/undefined', () => {
    assert.doesNotThrow(() => _test.checkApiError(null));
    assert.doesNotThrow(() => _test.checkApiError(undefined));
  });
});

describe('_test.toValue', () => {
  it('null -> undefined', () => assert.equal(_test.toValue(null), undefined));
  it('undefined -> undefined', () => assert.equal(_test.toValue(undefined), undefined));
  it('string -> stringValue', () => assert.deepEqual(_test.toValue('hi'), { stringValue: 'hi' }));
  it('number -> numberValue', () => assert.deepEqual(_test.toValue(42), { numberValue: 42 }));
  it('true -> boolValue', () => assert.deepEqual(_test.toValue(true), { boolValue: true }));
  it('array -> listValue', () => assert.ok(_test.toValue([1, 'x']).listValue));
  it('object -> structValue', () => assert.ok(_test.toValue({ a: 1 }).structValue));
});

describe('_test.normalizeBaseUrl', () => {
  it('valid https -> normalized', () => assert.equal(_test.normalizeBaseUrl('https://host:8443'), 'https://host:8443'));
  it('trailing slash stripped', () => assert.equal(_test.normalizeBaseUrl('https://host:8443/'), 'https://host:8443'));
  it('no scheme -> null', () => assert.equal(_test.normalizeBaseUrl('host:8443'), null));
  it('empty string -> null', () => assert.equal(_test.normalizeBaseUrl(''), null));
});

describe('_test.toInt', () => {
  it('integer -> same', () => assert.equal(_test.toInt(5), 5));
  it('0 is valid', () => assert.equal(_test.toInt(0), 0));
  it('float -> null', () => assert.equal(_test.toInt(1.5), null));
  it('null -> null', () => assert.equal(_test.toInt(null), null));
  it('wrapper {value} -> extracts', () => assert.equal(_test.toInt({ value: 7 }), 7));
});

describe('_test.unwrap', () => {
  it('null -> undefined', () => assert.equal(_test.unwrap(null), undefined));
  it('string -> same', () => assert.equal(_test.unwrap('hello'), 'hello'));
  it('{value: str} -> extracts', () => assert.equal(_test.unwrap({ value: 'abc' }), 'abc'));
  it('{value: null} -> empty string', () => assert.equal(_test.unwrap({ value: null }), ''));
});

describe('_test.mergedBindings', () => {
  it('bindings wins over config and secret', () => {
    const ctx = { config: { restBaseUrl: 'from-config' }, secret: { login_key: 'k' }, bindings: { restBaseUrl: 'from-bindings' } };
    const merged = _test.mergedBindings(ctx);
    assert.equal(merged.restBaseUrl, 'from-bindings');
  });
  it('empty ctx -> returns object', () => assert.equal(typeof _test.mergedBindings({}), 'object'));
});
