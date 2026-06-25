import { describe, it, afterEach } from 'node:test';
import test from 'node:test';
import assert from 'node:assert/strict';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import { rpcdef, handlers, _test } from '../src/sangfor-sip.js';

const PKG = 'SANGFOR_SIP';
const P   = `/${PKG}.${PKG}/`;

const PATH_GET_SECURITY_EVENTS         = `${P}GetSecurityEvents`;
const PATH_GET_RISK_BUSINESS           = `${P}GetRiskBusiness`;
const PATH_GET_RISK_TERMINALS          = `${P}GetRiskTerminals`;
const PATH_GET_SERVERS                 = `${P}GetServers`;
const PATH_GET_TERMINALS               = `${P}GetTerminals`;
const PATH_GET_IP_GROUPS               = `${P}GetIPGroups`;
const PATH_GET_WEAK_PASSWORDS          = `${P}GetWeakPasswords`;
const PATH_GET_VULNERABILITIES         = `${P}GetVulnerabilities`;
const PATH_GET_PLAINTEXT_TRANSMISSIONS = `${P}GetPlaintextTransmissions`;

const KEY_GET_SECURITY_EVENTS         = `${PKG}.${PKG}/GetSecurityEvents`;
const KEY_GET_RISK_BUSINESS           = `${PKG}.${PKG}/GetRiskBusiness`;
const KEY_GET_RISK_TERMINALS          = `${PKG}.${PKG}/GetRiskTerminals`;
const KEY_GET_SERVERS                 = `${PKG}.${PKG}/GetServers`;
const KEY_GET_TERMINALS               = `${PKG}.${PKG}/GetTerminals`;
const KEY_GET_IP_GROUPS               = `${PKG}.${PKG}/GetIPGroups`;
const KEY_GET_WEAK_PASSWORDS          = `${PKG}.${PKG}/GetWeakPasswords`;
const KEY_GET_VULNERABILITIES         = `${PKG}.${PKG}/GetVulnerabilities`;
const KEY_GET_PLAINTEXT_TRANSMISSIONS = `${PKG}.${PKG}/GetPlaintextTransmissions`;

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const AUTH_TOKEN_BODY = JSON.stringify({
  code: 0,
  message: 'success',
  data: { token: 'test_sip_token' },
});

const makeHeaders = () => ({ get: () => null });

const makeSeqFetch = (apiBody, apiStatus = 200) => {
  let call = 0;
  return async (_url, _init) => {
    call++;
    if (call === 1) {
      return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders() };
    }
    const text = typeof apiBody === 'string' ? apiBody : JSON.stringify(apiBody);
    return { ok: apiStatus >= 200 && apiStatus < 300, status: apiStatus, text: async () => text, headers: makeHeaders() };
  };
};

const networkErrorFetch = async () => { throw new Error('ECONNREFUSED'); };

const buildCtx = (reqOverrides = {}, secretOverrides = {}) => ({
  bindings: {
    host: 'https://sip.example.com:7443',
    ...(secretOverrides),
  },
  config: {},
  secret: {
    userName: 'testuser',
    password: 'testpass',
    platformName: 'MyPlatform',
    ...secretOverrides,
  },
  limits: { timeoutMs: 5000 },
  meta: {},
  req: {
    from_time: 1700000000,
    to_time:   1700003600,
    ...reqOverrides,
  },
});

const expectGrpcError = async (fn, legacyCode) => {
  let caught;
  try { await fn(); } catch (e) { caught = e; }
  assert.ok(caught, 'expected function to throw');
  assert.ok(caught instanceof GrpcError, `expected GrpcError, got: ${caught}`);
  assert.equal(caught.legacyCode, legacyCode, `expected legacyCode ${legacyCode}, got ${caught.legacyCode}`);
  assert.match(caught.message, new RegExp(`^${legacyCode}:`));
};

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------
test('rpcdef exposes all 9 paths', () => {
  const def = rpcdef(buildCtx());
  assert.equal(typeof def[PATH_GET_SECURITY_EVENTS], 'function');
  assert.equal(typeof def[PATH_GET_RISK_BUSINESS], 'function');
  assert.equal(typeof def[PATH_GET_RISK_TERMINALS], 'function');
  assert.equal(typeof def[PATH_GET_SERVERS], 'function');
  assert.equal(typeof def[PATH_GET_TERMINALS], 'function');
  assert.equal(typeof def[PATH_GET_IP_GROUPS], 'function');
  assert.equal(typeof def[PATH_GET_WEAK_PASSWORDS], 'function');
  assert.equal(typeof def[PATH_GET_VULNERABILITIES], 'function');
  assert.equal(typeof def[PATH_GET_PLAINTEXT_TRANSMISSIONS], 'function');
});

test('handlers exposes all 9 keys without leading slash', () => {
  assert.equal(typeof handlers[KEY_GET_SECURITY_EVENTS], 'function');
  assert.equal(typeof handlers[KEY_GET_RISK_BUSINESS], 'function');
  assert.equal(typeof handlers[KEY_GET_RISK_TERMINALS], 'function');
  assert.equal(typeof handlers[KEY_GET_SERVERS], 'function');
  assert.equal(typeof handlers[KEY_GET_TERMINALS], 'function');
  assert.equal(typeof handlers[KEY_GET_IP_GROUPS], 'function');
  assert.equal(typeof handlers[KEY_GET_WEAK_PASSWORDS], 'function');
  assert.equal(typeof handlers[KEY_GET_VULNERABILITIES], 'function');
  assert.equal(typeof handlers[KEY_GET_PLAINTEXT_TRANSMISSIONS], 'function');
});

// ---------------------------------------------------------------------------
// _test helpers
// ---------------------------------------------------------------------------
describe('sipAuth3', () => {
  it('returns consistent hex string', () => {
    const { sipAuth3 } = _test;
    const h = sipAuth3('user1', 'pass1', 12345);
    assert.equal(typeof h, 'string');
    assert.match(h, /^[0-9a-f]{40}$/);
  });

  it('is deterministic for same inputs', () => {
    const { sipAuth3 } = _test;
    assert.equal(sipAuth3('u', 'p', 999), sipAuth3('u', 'p', 999));
  });

  it('differs on different password', () => {
    const { sipAuth3 } = _test;
    assert.notEqual(sipAuth3('u', 'pass1', 100), sipAuth3('u', 'pass2', 100));
  });
});

describe('normalizeBaseUrl', () => {
  it('removes trailing slash', () => {
    assert.equal(_test.normalizeBaseUrl('https://sip.local:7443/'), 'https://sip.local:7443');
  });

  it('returns null for empty', () => {
    assert.equal(_test.normalizeBaseUrl(''), null);
  });

  it('returns null for non-http', () => {
    assert.equal(_test.normalizeBaseUrl('ftp://host'), null);
  });

  it('accepts http', () => {
    assert.equal(_test.normalizeBaseUrl('http://10.0.0.1:7443'), 'http://10.0.0.1:7443');
  });
});

describe('toValue', () => {
  const { toValue } = _test;
  it('wraps string', () => { assert.deepEqual(toValue('abc'), { stringValue: 'abc' }); });
  it('wraps number', () => { assert.deepEqual(toValue(42), { numberValue: 42 }); });
  it('wraps boolean', () => { assert.deepEqual(toValue(true), { boolValue: true }); });
  it('wraps null', () => { assert.deepEqual(toValue(null), { nullValue: 'NULL_VALUE' }); });
  it('wraps array', () => {
    const r = toValue([1, 'x']);
    assert.ok(r.listValue);
    assert.equal(r.listValue.values.length, 2);
  });
  it('wraps object', () => {
    const r = toValue({ a: 1 });
    assert.ok(r.structValue);
    assert.deepEqual(r.structValue.fields.a, { numberValue: 1 });
  });
});

// ---------------------------------------------------------------------------
// GetSecurityEvents
// ---------------------------------------------------------------------------
describe('GetSecurityEvents success', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns items and count', async () => {
    const apiResp = {
      code: 0, message: 'success',
      data: {
        items: [
          { ip: '1.1.1.1', eventDes: 'test event', priority: 3 },
          { ip: '2.2.2.2', eventDes: 'another', priority: 1 },
        ],
        count: 2,
        device_info: { source: 'SIP' },
      },
    };
    globalThis.fetch = makeSeqFetch(apiResp);
    const ctx = buildCtx();
    const r = await rpcdef(ctx)[PATH_GET_SECURITY_EVENTS]();
    assert.equal(r.count, 2);
    assert.equal(r.items.length, 2);
    assert.ok(r.items[0].structValue);
    assert.deepEqual(r.items[0].structValue.fields.ip, { stringValue: '1.1.1.1' });
  });

  it('handles empty items array', async () => {
    const apiResp = { code: 0, message: 'success', data: { items: [], count: 0 } };
    globalThis.fetch = makeSeqFetch(apiResp);
    const r = await rpcdef(buildCtx())[PATH_GET_SECURITY_EVENTS]();
    assert.equal(r.count, 0);
    assert.equal(r.items.length, 0);
  });

  it('uses custom maxCount', async () => {
    let capturedUrl;
    globalThis.fetch = async (url, init) => {
      capturedUrl = url;
      return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders() };
    };
    // First call is auth, second call is data
    let callNum = 0;
    globalThis.fetch = async (url, init) => {
      callNum++;
      if (callNum === 1) return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders() };
      capturedUrl = url;
      return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, message: 'success', data: { items: [], count: 0 } }), headers: makeHeaders() };
    };
    await rpcdef(buildCtx({ max_count: { value: 500 } }))[PATH_GET_SECURITY_EVENTS]();
    assert.ok(capturedUrl.includes('maxCount=500'), `expected maxCount=500 in ${capturedUrl}`);
  });

  it('sends token in query string', async () => {
    let dataUrl;
    let callNum = 0;
    globalThis.fetch = async (url) => {
      callNum++;
      if (callNum === 1) return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders() };
      dataUrl = url;
      return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, message: 'success', data: { items: [], count: 0 } }), headers: makeHeaders() };
    };
    await rpcdef(buildCtx())[PATH_GET_SECURITY_EVENTS]();
    assert.ok(dataUrl.includes('token=test_sip_token'), `expected token in URL: ${dataUrl}`);
  });
});

// ---------------------------------------------------------------------------
// GetSecurityEvents — validation errors
// ---------------------------------------------------------------------------
describe('GetSecurityEvents validation', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('throws INVALID_ARGUMENT when host missing', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx({}, { host: '', userName: 'u', password: 'p', platformName: 'plt' });
    ctx.secret = { userName: 'u', password: 'p', platformName: 'plt' };
    ctx.bindings = { host: '' };
    await expectGrpcError(() => rpcdef(ctx)[PATH_GET_SECURITY_EVENTS](), 'INVALID_ARGUMENT');
  });

  it('throws INVALID_ARGUMENT when userName missing', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx();
    ctx.secret = { password: 'p', platformName: 'plt' };
    ctx.bindings = { host: 'https://sip.example.com:7443' };
    await expectGrpcError(() => rpcdef(ctx)[PATH_GET_SECURITY_EVENTS](), 'INVALID_ARGUMENT');
  });

  it('throws INVALID_ARGUMENT when password missing', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx();
    ctx.secret = { userName: 'u', platformName: 'plt' };
    ctx.bindings = { host: 'https://sip.example.com:7443' };
    await expectGrpcError(() => rpcdef(ctx)[PATH_GET_SECURITY_EVENTS](), 'INVALID_ARGUMENT');
  });

  it('throws INVALID_ARGUMENT when platformName missing', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx();
    ctx.secret = { userName: 'u', password: 'p' };
    ctx.bindings = { host: 'https://sip.example.com:7443' };
    await expectGrpcError(() => rpcdef(ctx)[PATH_GET_SECURITY_EVENTS](), 'INVALID_ARGUMENT');
  });

  it('throws INVALID_ARGUMENT when from_time missing', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx({ from_time: null });
    await expectGrpcError(() => rpcdef(ctx)[PATH_GET_SECURITY_EVENTS](), 'INVALID_ARGUMENT');
  });

  it('throws INVALID_ARGUMENT when to_time missing', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx({ to_time: null });
    await expectGrpcError(() => rpcdef(ctx)[PATH_GET_SECURITY_EVENTS](), 'INVALID_ARGUMENT');
  });

  it('throws INVALID_ARGUMENT when from_time >= to_time', async () => {
    globalThis.fetch = makeSeqFetch({});
    const ctx = buildCtx({ from_time: 1700003600, to_time: 1700000000 });
    await expectGrpcError(() => rpcdef(ctx)[PATH_GET_SECURITY_EVENTS](), 'INVALID_ARGUMENT');
  });
});

// ---------------------------------------------------------------------------
// GetSecurityEvents — auth errors
// ---------------------------------------------------------------------------
describe('GetSecurityEvents auth errors', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('throws PERMISSION_DENIED on auth code 13', async () => {
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({ code: 13, message: 'permission denied' }),
      headers: makeHeaders(),
    });
    await expectGrpcError(() => rpcdef(buildCtx())[PATH_GET_SECURITY_EVENTS](), 'PERMISSION_DENIED');
  });

  it('throws FAILED_PRECONDITION on non-zero auth code', async () => {
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({ code: 301, message: 'invalid argument' }),
      headers: makeHeaders(),
    });
    await expectGrpcError(() => rpcdef(buildCtx())[PATH_GET_SECURITY_EVENTS](), 'FAILED_PRECONDITION');
  });

  it('throws UNKNOWN when auth response missing token', async () => {
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({ code: 0, message: 'success', data: {} }),
      headers: makeHeaders(),
    });
    await expectGrpcError(() => rpcdef(buildCtx())[PATH_GET_SECURITY_EVENTS](), 'UNKNOWN');
  });
});

// ---------------------------------------------------------------------------
// GetSecurityEvents — API response errors
// ---------------------------------------------------------------------------
describe('GetSecurityEvents API response errors', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('throws PERMISSION_DENIED on HTTP 403 from data endpoint', async () => {
    let callNum = 0;
    globalThis.fetch = async () => {
      callNum++;
      if (callNum === 1) return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders() };
      return { ok: false, status: 403, text: async () => 'Forbidden', headers: makeHeaders() };
    };
    await expectGrpcError(() => rpcdef(buildCtx())[PATH_GET_SECURITY_EVENTS](), 'PERMISSION_DENIED');
  });

  it('throws UNAVAILABLE on HTTP 500', async () => {
    let callNum = 0;
    globalThis.fetch = async () => {
      callNum++;
      if (callNum === 1) return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders() };
      return { ok: false, status: 500, text: async () => 'Internal Error', headers: makeHeaders() };
    };
    await expectGrpcError(() => rpcdef(buildCtx())[PATH_GET_SECURITY_EVENTS](), 'UNAVAILABLE');
  });

  it('throws PERMISSION_DENIED on data code 13', async () => {
    const apiResp = { code: 13, message: 'Permission denied!' };
    globalThis.fetch = makeSeqFetch(apiResp);
    await expectGrpcError(() => rpcdef(buildCtx())[PATH_GET_SECURITY_EVENTS](), 'PERMISSION_DENIED');
  });

  it('throws FAILED_PRECONDITION on data code 301', async () => {
    const apiResp = { code: 301, message: 'Invalid argument' };
    globalThis.fetch = makeSeqFetch(apiResp);
    await expectGrpcError(() => rpcdef(buildCtx())[PATH_GET_SECURITY_EVENTS](), 'FAILED_PRECONDITION');
  });

  it('throws UNAVAILABLE on network error during data fetch', async () => {
    let callNum = 0;
    globalThis.fetch = async () => {
      callNum++;
      if (callNum === 1) return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders() };
      throw new Error('ECONNREFUSED');
    };
    await expectGrpcError(() => rpcdef(buildCtx())[PATH_GET_SECURITY_EVENTS](), 'UNAVAILABLE');
  });

  it('throws UNAVAILABLE on network error during auth', async () => {
    globalThis.fetch = networkErrorFetch;
    await expectGrpcError(() => rpcdef(buildCtx())[PATH_GET_SECURITY_EVENTS](), 'UNAVAILABLE');
  });

  it('throws UNKNOWN on non-JSON data response', async () => {
    globalThis.fetch = makeSeqFetch('not json at all', 200);
    await expectGrpcError(() => rpcdef(buildCtx())[PATH_GET_SECURITY_EVENTS](), 'UNKNOWN');
  });
});

// ---------------------------------------------------------------------------
// GetRiskBusiness
// ---------------------------------------------------------------------------
describe('GetRiskBusiness success', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns items with risk business fields', async () => {
    const apiResp = {
      code: 0, message: 'success',
      data: {
        items: [{ ip: '10.0.0.1', riskLevel: 3, dealStatus: 0, groupName: 'biz1' }],
        count: 1,
      },
    };
    globalThis.fetch = makeSeqFetch(apiResp);
    const r = await rpcdef(buildCtx())[PATH_GET_RISK_BUSINESS]();
    assert.equal(r.count, 1);
    assert.equal(r.items.length, 1);
    assert.deepEqual(r.items[0].structValue.fields.ip, { stringValue: '10.0.0.1' });
  });
});

// ---------------------------------------------------------------------------
// GetRiskTerminals
// ---------------------------------------------------------------------------
describe('GetRiskTerminals success', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns items with risk terminal fields', async () => {
    const apiResp = {
      code: 0, message: 'success',
      data: {
        items: [{ ip: '192.168.1.50', fallLevel: 2, hostName: 'desktop1' }],
        count: 1,
      },
    };
    globalThis.fetch = makeSeqFetch(apiResp);
    const r = await rpcdef(buildCtx())[PATH_GET_RISK_TERMINALS]();
    assert.equal(r.count, 1);
    assert.deepEqual(r.items[0].structValue.fields.hostName, { stringValue: 'desktop1' });
  });
});

// ---------------------------------------------------------------------------
// GetServers
// ---------------------------------------------------------------------------
describe('GetServers success', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns server asset records', async () => {
    const apiResp = {
      code: 0, message: 'success',
      data: {
        items: [{ assetIp: '10.1.0.5', system: 'linux', findType: 'auto', status: 0 }],
        count: 1,
      },
    };
    globalThis.fetch = makeSeqFetch(apiResp);
    const r = await rpcdef(buildCtx())[PATH_GET_SERVERS]();
    assert.equal(r.count, 1);
    assert.deepEqual(r.items[0].structValue.fields.system, { stringValue: 'linux' });
  });
});

// ---------------------------------------------------------------------------
// GetTerminals
// ---------------------------------------------------------------------------
describe('GetTerminals success', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns terminal asset records', async () => {
    const apiResp = {
      code: 0, message: 'success',
      data: {
        items: [{ ip: '192.168.0.10', hostName: 'PC001', findType: 'manual', type: 3 }],
        count: 1,
      },
    };
    globalThis.fetch = makeSeqFetch(apiResp);
    const r = await rpcdef(buildCtx())[PATH_GET_TERMINALS]();
    assert.equal(r.count, 1);
    assert.deepEqual(r.items[0].structValue.fields.hostName, { stringValue: 'PC001' });
  });
});

// ---------------------------------------------------------------------------
// GetIPGroups
// ---------------------------------------------------------------------------
describe('GetIPGroups success', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns IP group records', async () => {
    const apiResp = {
      code: 0, message: 'success',
      data: {
        items: [{ name: 'group1', type: 1, ipRange: ['10.0.0.0-10.255.255.255'] }],
        count: 1,
      },
    };
    globalThis.fetch = makeSeqFetch(apiResp);
    const r = await rpcdef(buildCtx())[PATH_GET_IP_GROUPS]();
    assert.equal(r.count, 1);
    assert.deepEqual(r.items[0].structValue.fields.name, { stringValue: 'group1' });
  });
});

// ---------------------------------------------------------------------------
// GetWeakPasswords
// ---------------------------------------------------------------------------
describe('GetWeakPasswords success', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns weak password records', async () => {
    const apiResp = {
      code: 0, message: 'success',
      data: {
        items: [{ ip: '10.0.0.2', weakType: 'FTP登录弱密码', user: 'admin', dstPort: 21 }],
        count: 1,
      },
    };
    globalThis.fetch = makeSeqFetch(apiResp);
    const r = await rpcdef(buildCtx())[PATH_GET_WEAK_PASSWORDS]();
    assert.equal(r.count, 1);
    assert.deepEqual(r.items[0].structValue.fields.weakType, { stringValue: 'FTP登录弱密码' });
  });
});

// ---------------------------------------------------------------------------
// GetVulnerabilities
// ---------------------------------------------------------------------------
describe('GetVulnerabilities success', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns vulnerability records', async () => {
    const apiResp = {
      code: 0, message: 'success',
      data: {
        items: [{ ip: '10.0.0.3', holeName: 'CVE-2021-1234', level: 3, holeId: 10010236 }],
        count: 1,
      },
    };
    globalThis.fetch = makeSeqFetch(apiResp);
    const r = await rpcdef(buildCtx())[PATH_GET_VULNERABILITIES]();
    assert.equal(r.count, 1);
    assert.deepEqual(r.items[0].structValue.fields.holeName, { stringValue: 'CVE-2021-1234' });
  });
});

// ---------------------------------------------------------------------------
// GetPlaintextTransmissions
// ---------------------------------------------------------------------------
describe('GetPlaintextTransmissions success', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns plaintext transmission records', async () => {
    const apiResp = {
      code: 0, message: 'success',
      data: {
        items: [{ ip: '10.0.0.4', url: 'http://internal.corp/login', level: 2, ruleId: '502001' }],
        count: 1,
      },
    };
    globalThis.fetch = makeSeqFetch(apiResp);
    const r = await rpcdef(buildCtx())[PATH_GET_PLAINTEXT_TRANSMISSIONS]();
    assert.equal(r.count, 1);
    assert.deepEqual(r.items[0].structValue.fields.url, { stringValue: 'http://internal.corp/login' });
  });
});

// ---------------------------------------------------------------------------
// handlers — invocation via SDK-style call
// ---------------------------------------------------------------------------
describe('handlers SDK-style call', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('GetSecurityEvents handler resolves via req+ctx args', async () => {
    const apiResp = {
      code: 0, message: 'success',
      data: { items: [{ ip: '5.5.5.5' }], count: 1 },
    };
    globalThis.fetch = makeSeqFetch(apiResp);
    const req = { from_time: 1700000000, to_time: 1700003600 };
    const ctx = {
      bindings: { host: 'https://sip.example.com:7443' },
      secret: { userName: 'testuser', password: 'testpass', platformName: 'MyPlatform' },
    };
    const r = await handlers[KEY_GET_SECURITY_EVENTS](req, ctx);
    assert.equal(r.count, 1);
  });

  it('GetRiskBusiness handler works via SDK-style call', async () => {
    globalThis.fetch = makeSeqFetch({ code: 0, message: 'success', data: { items: [], count: 0 } });
    const r = await handlers[KEY_GET_RISK_BUSINESS](
      { from_time: 1700000000, to_time: 1700003600 },
      { bindings: { host: 'https://sip.example.com:7443' }, secret: { userName: 'u', password: 'p', platformName: 'plt' } },
    );
    assert.equal(r.count, 0);
  });
});

// ---------------------------------------------------------------------------
// Auth POST body validation
// ---------------------------------------------------------------------------
describe('Auth POST body', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('sends correct Content-Type and body fields', async () => {
    let authBody;
    let callNum = 0;
    globalThis.fetch = async (url, init) => {
      callNum++;
      if (callNum === 1) {
        authBody = JSON.parse(init.body);
        return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders() };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, message: 'success', data: { items: [], count: 0 } }), headers: makeHeaders() };
    };
    await rpcdef(buildCtx())[PATH_GET_SECURITY_EVENTS]();

    assert.equal(authBody.userName, 'testuser');
    assert.equal(authBody.platformName, 'MyPlatform');
    assert.equal(typeof authBody.rand, 'number');
    assert.equal(typeof authBody.auth, 'string');
    assert.match(authBody.auth, /^[0-9a-f]{40}$/);
    assert.equal(authBody.clientProduct, '');
    assert.equal(authBody.clientId, 0);
  });

  it('auth value matches sipAuth3 formula', async () => {
    const { sipAuth3 } = _test;
    let capturedRand, capturedAuth;
    let callNum = 0;
    globalThis.fetch = async (url, init) => {
      callNum++;
      if (callNum === 1) {
        const body = JSON.parse(init.body);
        capturedRand = body.rand;
        capturedAuth = body.auth;
        return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders() };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, message: 'success', data: { items: [], count: 0 } }), headers: makeHeaders() };
    };
    await rpcdef(buildCtx())[PATH_GET_SECURITY_EVENTS]();
    assert.equal(capturedAuth, sipAuth3('testuser', 'testpass', capturedRand));
  });
});

// ---------------------------------------------------------------------------
// URL and query string
// ---------------------------------------------------------------------------
describe('Data URL construction', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('includes correct API path for security events', async () => {
    let dataUrl;
    let callNum = 0;
    globalThis.fetch = async (url) => {
      callNum++;
      if (callNum === 1) return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders() };
      dataUrl = url;
      return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, message: 'success', data: { items: [], count: 0 } }), headers: makeHeaders() };
    };
    await rpcdef(buildCtx())[PATH_GET_SECURITY_EVENTS]();
    assert.ok(dataUrl.includes('/sangforinter/v1/data/riskevent'), `unexpected URL: ${dataUrl}`);
  });

  it('includes fromActionTime and toActionTime in query', async () => {
    let dataUrl;
    let callNum = 0;
    globalThis.fetch = async (url) => {
      callNum++;
      if (callNum === 1) return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders() };
      dataUrl = url;
      return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, message: 'success', data: { items: [], count: 0 } }), headers: makeHeaders() };
    };
    await rpcdef(buildCtx({ from_time: 1700000000, to_time: 1700003600 }))[PATH_GET_SECURITY_EVENTS]();
    assert.ok(dataUrl.includes('fromActionTime=1700000000'), `expected fromActionTime in URL: ${dataUrl}`);
    assert.ok(dataUrl.includes('toActionTime=1700003600'), `expected toActionTime in URL: ${dataUrl}`);
  });

  it('uses correct API path for vulnerabilities', async () => {
    let dataUrl;
    let callNum = 0;
    globalThis.fetch = async (url) => {
      callNum++;
      if (callNum === 1) return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders() };
      dataUrl = url;
      return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, message: 'success', data: { items: [], count: 0 } }), headers: makeHeaders() };
    };
    await rpcdef(buildCtx())[PATH_GET_VULNERABILITIES]();
    assert.ok(dataUrl.includes('/sangforinter/v1/data/hole'), `unexpected URL: ${dataUrl}`);
  });

  it('uses correct API path for weak passwords', async () => {
    let dataUrl;
    let callNum = 0;
    globalThis.fetch = async (url) => {
      callNum++;
      if (callNum === 1) return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders() };
      dataUrl = url;
      return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, message: 'success', data: { items: [], count: 0 } }), headers: makeHeaders() };
    };
    await rpcdef(buildCtx())[PATH_GET_WEAK_PASSWORDS]();
    assert.ok(dataUrl.includes('/sangforinter/v1/data/weakpasswd'), `unexpected URL: ${dataUrl}`);
  });

  it('uses correct API path for plaintext transmissions', async () => {
    let dataUrl;
    let callNum = 0;
    globalThis.fetch = async (url) => {
      callNum++;
      if (callNum === 1) return { ok: true, status: 200, text: async () => AUTH_TOKEN_BODY, headers: makeHeaders() };
      dataUrl = url;
      return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, message: 'success', data: { items: [], count: 0 } }), headers: makeHeaders() };
    };
    await rpcdef(buildCtx())[PATH_GET_PLAINTEXT_TRANSMISSIONS]();
    assert.ok(dataUrl.includes('/sangforinter/v1/data/plaintexttransmission'), `unexpected URL: ${dataUrl}`);
  });
});
