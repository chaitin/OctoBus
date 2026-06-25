import { describe, it, afterEach } from 'node:test';
import test from 'node:test';
import assert from 'node:assert/strict';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import { rpcdef, handlers, _test } from '../src/h3c-secpath.js';

const PKG = 'H3C_SECPATH';
const P   = `/${PKG}.${PKG}/`;

const PATH_GET_DEVICE_BASE             = `${P}GetDeviceBase`;
const PATH_GET_SECURITY_ZONES          = `${P}GetSecurityZones`;
const PATH_GET_ZONE_PAIRS              = `${P}GetZonePairs`;
const PATH_GET_IPV4_SECURITY_POLICIES  = `${P}GetIPv4SecurityPolicies`;
const PATH_GET_IPV4_OBJECT_GROUPS      = `${P}GetIPv4ObjectGroups`;
const PATH_GET_SERVICE_GROUPS          = `${P}GetServiceGroups`;
const PATH_GET_SESSIONS                = `${P}GetSessions`;
const PATH_GET_INTERFACES              = `${P}GetInterfaces`;
const PATH_GET_ACL_GROUPS              = `${P}GetACLGroups`;
const PATH_GET_NAT_STATIC_MAPPINGS     = `${P}GetNATStaticMappings`;

const KEY_GET_DEVICE_BASE             = `${PKG}.${PKG}/GetDeviceBase`;
const KEY_GET_SECURITY_ZONES          = `${PKG}.${PKG}/GetSecurityZones`;
const KEY_GET_ZONE_PAIRS              = `${PKG}.${PKG}/GetZonePairs`;
const KEY_GET_IPV4_SECURITY_POLICIES  = `${PKG}.${PKG}/GetIPv4SecurityPolicies`;
const KEY_GET_IPV4_OBJECT_GROUPS      = `${PKG}.${PKG}/GetIPv4ObjectGroups`;
const KEY_GET_SERVICE_GROUPS          = `${PKG}.${PKG}/GetServiceGroups`;
const KEY_GET_SESSIONS                = `${PKG}.${PKG}/GetSessions`;
const KEY_GET_INTERFACES              = `${PKG}.${PKG}/GetInterfaces`;
const KEY_GET_ACL_GROUPS              = `${PKG}.${PKG}/GetACLGroups`;
const KEY_GET_NAT_STATIC_MAPPINGS     = `${PKG}.${PKG}/GetNATStaticMappings`;

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const makeBasicFetch = (body, status = 200) => {
  return async (_url, _init) => {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
};

const networkErrorFetch = async () => { throw new Error('ECONNREFUSED'); };

const buildCtx = (overrides = {}) => ({
  bindings: {
    host: 'https://h3c.example.com',
    username: 'admin',
    password: 'Admin123',
    ...(overrides.bindings ?? {}),
  },
  config: overrides.config ?? {},
  secret: {
    username: 'admin',
    password: 'Admin123',
    ...(overrides.secret ?? {}),
  },
  limits: { timeoutMs: 5000, ...(overrides.limits ?? {}) },
  meta: overrides.meta ?? {},
  req: overrides.req ?? {},
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
test('rpcdef exposes all 10 paths', () => {
  const def = rpcdef(buildCtx());
  assert.equal(typeof def[PATH_GET_DEVICE_BASE], 'function');
  assert.equal(typeof def[PATH_GET_SECURITY_ZONES], 'function');
  assert.equal(typeof def[PATH_GET_ZONE_PAIRS], 'function');
  assert.equal(typeof def[PATH_GET_IPV4_SECURITY_POLICIES], 'function');
  assert.equal(typeof def[PATH_GET_IPV4_OBJECT_GROUPS], 'function');
  assert.equal(typeof def[PATH_GET_SERVICE_GROUPS], 'function');
  assert.equal(typeof def[PATH_GET_SESSIONS], 'function');
  assert.equal(typeof def[PATH_GET_INTERFACES], 'function');
  assert.equal(typeof def[PATH_GET_ACL_GROUPS], 'function');
  assert.equal(typeof def[PATH_GET_NAT_STATIC_MAPPINGS], 'function');
});

test('handlers exposes all 10 keys without leading slash', () => {
  assert.equal(typeof handlers[KEY_GET_DEVICE_BASE], 'function');
  assert.equal(typeof handlers[KEY_GET_SECURITY_ZONES], 'function');
  assert.equal(typeof handlers[KEY_GET_ZONE_PAIRS], 'function');
  assert.equal(typeof handlers[KEY_GET_IPV4_SECURITY_POLICIES], 'function');
  assert.equal(typeof handlers[KEY_GET_IPV4_OBJECT_GROUPS], 'function');
  assert.equal(typeof handlers[KEY_GET_SERVICE_GROUPS], 'function');
  assert.equal(typeof handlers[KEY_GET_SESSIONS], 'function');
  assert.equal(typeof handlers[KEY_GET_INTERFACES], 'function');
  assert.equal(typeof handlers[KEY_GET_ACL_GROUPS], 'function');
  assert.equal(typeof handlers[KEY_GET_NAT_STATIC_MAPPINGS], 'function');
});

// ---------------------------------------------------------------------------
// _test helpers
// ---------------------------------------------------------------------------
describe('normalizeBaseUrl', () => {
  it('removes trailing slash', () => {
    assert.equal(_test.normalizeBaseUrl('https://h3c.local/'), 'https://h3c.local');
  });

  it('returns null for empty string', () => {
    assert.equal(_test.normalizeBaseUrl(''), null);
  });

  it('returns null for non-http scheme', () => {
    assert.equal(_test.normalizeBaseUrl('ftp://host'), null);
  });

  it('accepts http scheme', () => {
    assert.equal(_test.normalizeBaseUrl('http://10.0.0.1'), 'http://10.0.0.1');
  });
});

describe('toValue', () => {
  const { toValue } = _test;

  it('wraps string', () => {
    assert.deepEqual(toValue('hello'), { stringValue: 'hello' });
  });

  it('wraps number', () => {
    assert.deepEqual(toValue(99), { numberValue: 99 });
  });

  it('wraps boolean true', () => {
    assert.deepEqual(toValue(true), { boolValue: true });
  });

  it('wraps null', () => {
    assert.deepEqual(toValue(null), { nullValue: 'NULL_VALUE' });
  });

  it('wraps array', () => {
    const r = toValue([1, 'x']);
    assert.ok(r.listValue);
    assert.equal(r.listValue.values.length, 2);
  });

  it('wraps object', () => {
    const r = toValue({ Name: 'Trust' });
    assert.ok(r.structValue);
    assert.deepEqual(r.structValue.fields.Name, { stringValue: 'Trust' });
  });
});

describe('extractList', () => {
  const { extractList } = _test;

  it('finds array nested inside object', () => {
    const obj = { 'comware-securityzone:SecurityZone': { Zones: { Zone: [{ Name: 'Trust', ID: 1 }] } } };
    const result = extractList(obj);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 1);
    assert.equal(result[0].Name, 'Trust');
  });

  it('returns empty array when no array found', () => {
    const obj = { outer: { inner: { leaf: 'value' } } };
    const result = extractList(obj);
    assert.deepEqual(result, []);
  });

  it('works on direct array input', () => {
    const arr = [{ ID: 1 }, { ID: 2 }];
    const result = extractList(arr);
    assert.equal(result.length, 2);
    assert.equal(result[0].ID, 1);
  });
});

// ---------------------------------------------------------------------------
// GetDeviceBase
// ---------------------------------------------------------------------------
describe('GetDeviceBase success', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns info as google.protobuf.Value wrapping the device object', async () => {
    const apiResp = {
      'comware-device:Device': {
        Base: { HostName: 'H3C-FW', SoftwareVersion: '7.1.075' },
      },
    };
    globalThis.fetch = makeBasicFetch(apiResp);
    const r = await rpcdef(buildCtx())[PATH_GET_DEVICE_BASE]();
    assert.ok(r.info, 'expected info field in response');
    assert.ok(r.info.structValue, 'expected structValue on info');
    assert.deepEqual(r.info.structValue.fields.HostName, { stringValue: 'H3C-FW' });
    assert.deepEqual(r.info.structValue.fields.SoftwareVersion, { stringValue: '7.1.075' });
  });

  it('handles empty/minimal response without throwing', async () => {
    globalThis.fetch = makeBasicFetch({ 'comware-device:Device': {} });
    const r = await rpcdef(buildCtx())[PATH_GET_DEVICE_BASE]();
    assert.ok(r.info !== undefined, 'expected info to be present even for empty device');
  });
});

// ---------------------------------------------------------------------------
// GetSecurityZones
// ---------------------------------------------------------------------------
describe('GetSecurityZones success', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns zone items array', async () => {
    const apiResp = {
      'comware-securityzone:SecurityZone': {
        Zones: { Zone: [{ Name: 'Trust', ID: 1 }, { Name: 'Untrust', ID: 2 }] },
      },
    };
    globalThis.fetch = makeBasicFetch(apiResp);
    const r = await rpcdef(buildCtx())[PATH_GET_SECURITY_ZONES]();
    assert.equal(r.items.length, 2);
    assert.equal(r.count, 2);
    assert.deepEqual(r.items[0].structValue.fields.Name, { stringValue: 'Trust' });
    assert.deepEqual(r.items[1].structValue.fields.Name, { stringValue: 'Untrust' });
  });

  it('handles empty zone list', async () => {
    const apiResp = {
      'comware-securityzone:SecurityZone': { Zones: { Zone: [] } },
    };
    globalThis.fetch = makeBasicFetch(apiResp);
    const r = await rpcdef(buildCtx())[PATH_GET_SECURITY_ZONES]();
    assert.equal(r.items.length, 0);
    assert.equal(r.count, 0);
  });
});

// ---------------------------------------------------------------------------
// GetZonePairs
// ---------------------------------------------------------------------------
describe('GetZonePairs success', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns zone pair items', async () => {
    const apiResp = {
      'comware-securityzone:SecurityZone': {
        ZonePairs: {
          ZonePair: [
            { SrcZoneName: 'Trust', DstZoneName: 'Untrust', PolicyName: 'allow-out' },
          ],
        },
      },
    };
    globalThis.fetch = makeBasicFetch(apiResp);
    const r = await rpcdef(buildCtx())[PATH_GET_ZONE_PAIRS]();
    assert.equal(r.items.length, 1);
    assert.deepEqual(r.items[0].structValue.fields.SrcZoneName, { stringValue: 'Trust' });
    assert.deepEqual(r.items[0].structValue.fields.DstZoneName, { stringValue: 'Untrust' });
  });
});

// ---------------------------------------------------------------------------
// GetIPv4SecurityPolicies
// ---------------------------------------------------------------------------
describe('GetIPv4SecurityPolicies success', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns policy items', async () => {
    const apiResp = {
      'comware-securitypolicies:SecurityPolicies': {
        IPv4Rules: {
          IPv4Rule: [
            { ID: 1, Name: 'allow-web', Action: 'permit' },
            { ID: 2, Name: 'deny-all', Action: 'deny' },
          ],
        },
      },
    };
    globalThis.fetch = makeBasicFetch(apiResp);
    const r = await rpcdef(buildCtx())[PATH_GET_IPV4_SECURITY_POLICIES]();
    assert.equal(r.items.length, 2);
    assert.deepEqual(r.items[0].structValue.fields.Name, { stringValue: 'allow-web' });
    assert.deepEqual(r.items[0].structValue.fields.Action, { stringValue: 'permit' });
  });

  it('handles empty policy list', async () => {
    const apiResp = {
      'comware-securitypolicies:SecurityPolicies': {
        IPv4Rules: { IPv4Rule: [] },
      },
    };
    globalThis.fetch = makeBasicFetch(apiResp);
    const r = await rpcdef(buildCtx())[PATH_GET_IPV4_SECURITY_POLICIES]();
    assert.equal(r.items.length, 0);
    assert.equal(r.count, 0);
  });
});

// ---------------------------------------------------------------------------
// GetIPv4ObjectGroups
// ---------------------------------------------------------------------------
describe('GetIPv4ObjectGroups success', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns object group items', async () => {
    const apiResp = {
      'comware-oms:OMS': {
        IPv4Groups: {
          IPv4Group: [{ Name: 'internal-nets', ID: 10 }],
        },
      },
    };
    globalThis.fetch = makeBasicFetch(apiResp);
    const r = await rpcdef(buildCtx())[PATH_GET_IPV4_OBJECT_GROUPS]();
    assert.equal(r.items.length, 1);
    assert.deepEqual(r.items[0].structValue.fields.Name, { stringValue: 'internal-nets' });
  });
});

// ---------------------------------------------------------------------------
// GetServiceGroups
// ---------------------------------------------------------------------------
describe('GetServiceGroups success', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns service group items', async () => {
    const apiResp = {
      'comware-oms:OMS': {
        ServGroups: {
          ServGroup: [{ Name: 'http-https', Protocol: 'TCP' }],
        },
      },
    };
    globalThis.fetch = makeBasicFetch(apiResp);
    const r = await rpcdef(buildCtx())[PATH_GET_SERVICE_GROUPS]();
    assert.equal(r.items.length, 1);
    assert.deepEqual(r.items[0].structValue.fields.Name, { stringValue: 'http-https' });
  });
});

// ---------------------------------------------------------------------------
// GetSessions
// ---------------------------------------------------------------------------
describe('GetSessions success', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns session items', async () => {
    const apiResp = {
      'comware-session:SESSION': {
        Sessions: {
          Session: [
            { SrcIP: '192.168.1.10', DstIP: '8.8.8.8', Protocol: 'TCP', SrcPort: 54321, DstPort: 443 },
          ],
        },
      },
    };
    globalThis.fetch = makeBasicFetch(apiResp);
    const r = await rpcdef(buildCtx())[PATH_GET_SESSIONS]();
    assert.equal(r.items.length, 1);
    assert.deepEqual(r.items[0].structValue.fields.SrcIP, { stringValue: '192.168.1.10' });
    assert.deepEqual(r.items[0].structValue.fields.DstIP, { stringValue: '8.8.8.8' });
  });
});

// ---------------------------------------------------------------------------
// GetInterfaces
// ---------------------------------------------------------------------------
describe('GetInterfaces success', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns interface items', async () => {
    const apiResp = {
      'comware-ifmgr:Ifmgr': {
        Interfaces: {
          Interface: [
            { Name: 'GigabitEthernet0/0', AdminStatus: 'Up', IPAddr: '10.0.0.1' },
            { Name: 'GigabitEthernet0/1', AdminStatus: 'Down', IPAddr: '10.0.1.1' },
          ],
        },
      },
    };
    globalThis.fetch = makeBasicFetch(apiResp);
    const r = await rpcdef(buildCtx())[PATH_GET_INTERFACES]();
    assert.equal(r.items.length, 2);
    assert.deepEqual(r.items[0].structValue.fields.Name, { stringValue: 'GigabitEthernet0/0' });
    assert.deepEqual(r.items[1].structValue.fields.AdminStatus, { stringValue: 'Down' });
  });
});

// ---------------------------------------------------------------------------
// GetACLGroups
// ---------------------------------------------------------------------------
describe('GetACLGroups success', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns ACL group items', async () => {
    const apiResp = {
      'comware-acl:ACL': {
        Groups: {
          Group: [{ GroupType: 'Basic', GroupCategory: 'IPv4', GroupIndex: 2000 }],
        },
      },
    };
    globalThis.fetch = makeBasicFetch(apiResp);
    const r = await rpcdef(buildCtx())[PATH_GET_ACL_GROUPS]();
    assert.equal(r.items.length, 1);
    assert.deepEqual(r.items[0].structValue.fields.GroupType, { stringValue: 'Basic' });
    assert.deepEqual(r.items[0].structValue.fields.GroupIndex, { numberValue: 2000 });
  });
});

// ---------------------------------------------------------------------------
// GetNATStaticMappings
// ---------------------------------------------------------------------------
describe('GetNATStaticMappings success', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns NAT mapping items', async () => {
    const apiResp = {
      'comware-nat:NAT': {
        Static: {
          StaticMappings: {
            StaticMapping: [
              { LocalIP: '10.0.0.100', GlobalIP: '203.0.113.50', Protocol: 'TCP', LocalPort: 80 },
            ],
          },
        },
      },
    };
    globalThis.fetch = makeBasicFetch(apiResp);
    const r = await rpcdef(buildCtx())[PATH_GET_NAT_STATIC_MAPPINGS]();
    assert.equal(r.items.length, 1);
    assert.deepEqual(r.items[0].structValue.fields.LocalIP, { stringValue: '10.0.0.100' });
    assert.deepEqual(r.items[0].structValue.fields.GlobalIP, { stringValue: '203.0.113.50' });
  });
});

// ---------------------------------------------------------------------------
// Error tests
// ---------------------------------------------------------------------------
describe('validation errors', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('throws INVALID_ARGUMENT when host missing', async () => {
    globalThis.fetch = makeBasicFetch({});
    const ctx = buildCtx({ bindings: { host: '', username: 'admin', password: 'Admin123' } });
    ctx.secret = { username: 'admin', password: 'Admin123' };
    await expectGrpcError(() => rpcdef(ctx)[PATH_GET_SECURITY_ZONES](), 'INVALID_ARGUMENT');
  });

  it('throws INVALID_ARGUMENT when username missing', async () => {
    globalThis.fetch = makeBasicFetch({});
    const ctx = buildCtx({
      bindings: { host: 'https://h3c.example.com', username: '', password: 'Admin123' },
      secret: { username: '', password: 'Admin123' },
    });
    await expectGrpcError(() => rpcdef(ctx)[PATH_GET_SECURITY_ZONES](), 'INVALID_ARGUMENT');
  });

  it('throws INVALID_ARGUMENT when password missing', async () => {
    globalThis.fetch = makeBasicFetch({});
    const ctx = buildCtx({
      bindings: { host: 'https://h3c.example.com', username: 'admin', password: '' },
      secret: { username: 'admin', password: '' },
    });
    await expectGrpcError(() => rpcdef(ctx)[PATH_GET_SECURITY_ZONES](), 'INVALID_ARGUMENT');
  });

  it('throws PERMISSION_DENIED on HTTP 401', async () => {
    globalThis.fetch = makeBasicFetch('Unauthorized', 401);
    await expectGrpcError(() => rpcdef(buildCtx())[PATH_GET_SECURITY_ZONES](), 'PERMISSION_DENIED');
  });

  it('throws PERMISSION_DENIED on HTTP 403', async () => {
    globalThis.fetch = makeBasicFetch('Forbidden', 403);
    await expectGrpcError(() => rpcdef(buildCtx())[PATH_GET_SECURITY_ZONES](), 'PERMISSION_DENIED');
  });

  it('throws UNAVAILABLE on HTTP 500', async () => {
    globalThis.fetch = makeBasicFetch('Internal Server Error', 500);
    await expectGrpcError(() => rpcdef(buildCtx())[PATH_GET_SECURITY_ZONES](), 'UNAVAILABLE');
  });

  it('throws UNAVAILABLE on network error', async () => {
    globalThis.fetch = networkErrorFetch;
    await expectGrpcError(() => rpcdef(buildCtx())[PATH_GET_SECURITY_ZONES](), 'UNAVAILABLE');
  });

  it('throws UNKNOWN on non-JSON response', async () => {
    globalThis.fetch = makeBasicFetch('not valid json at all', 200);
    await expectGrpcError(() => rpcdef(buildCtx())[PATH_GET_SECURITY_ZONES](), 'UNKNOWN');
  });

  it('HTTP 404 returns empty list rather than throwing', async () => {
    globalThis.fetch = makeBasicFetch('Not Found', 404);
    const r = await rpcdef(buildCtx())[PATH_GET_SECURITY_ZONES]();
    assert.equal(r.items.length, 0);
    assert.equal(r.count, 0);
  });
});

describe('error handling for GetDeviceBase', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('throws PERMISSION_DENIED on HTTP 401 for device base', async () => {
    globalThis.fetch = makeBasicFetch('Unauthorized', 401);
    await expectGrpcError(() => rpcdef(buildCtx())[PATH_GET_DEVICE_BASE](), 'PERMISSION_DENIED');
  });

  it('throws UNAVAILABLE on HTTP 503 for device base', async () => {
    globalThis.fetch = makeBasicFetch('Service Unavailable', 503);
    await expectGrpcError(() => rpcdef(buildCtx())[PATH_GET_DEVICE_BASE](), 'UNAVAILABLE');
  });

  it('throws UNKNOWN on non-JSON body for device base', async () => {
    globalThis.fetch = makeBasicFetch('<html>error</html>', 200);
    await expectGrpcError(() => rpcdef(buildCtx())[PATH_GET_DEVICE_BASE](), 'UNKNOWN');
  });

  it('throws UNAVAILABLE on network error for device base', async () => {
    globalThis.fetch = networkErrorFetch;
    await expectGrpcError(() => rpcdef(buildCtx())[PATH_GET_DEVICE_BASE](), 'UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// Authorization header
// ---------------------------------------------------------------------------
describe('Authorization header', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('sends Basic auth header with correct credentials', async () => {
    let capturedInit;
    globalThis.fetch = async (_url, init) => {
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          'comware-securityzone:SecurityZone': { Zones: { Zone: [] } },
        }),
      };
    };
    await rpcdef(buildCtx())[PATH_GET_SECURITY_ZONES]();
    assert.ok(capturedInit.headers.Authorization, 'expected Authorization header');
    assert.match(capturedInit.headers.Authorization, /^Basic\s+/);
    const encoded = capturedInit.headers.Authorization.replace(/^Basic\s+/, '');
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    assert.equal(decoded, 'admin:Admin123');
  });

  it('sends Accept: application/json header', async () => {
    let capturedInit;
    globalThis.fetch = async (_url, init) => {
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ 'comware-securityzone:SecurityZone': { Zones: { Zone: [] } } }),
      };
    };
    await rpcdef(buildCtx())[PATH_GET_SECURITY_ZONES]();
    assert.equal(capturedInit.headers.Accept, 'application/json');
  });

  it('makes only a single fetch call (no token exchange)', async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ 'comware-securityzone:SecurityZone': { Zones: { Zone: [] } } }),
      };
    };
    await rpcdef(buildCtx())[PATH_GET_SECURITY_ZONES]();
    assert.equal(callCount, 1, 'Basic auth should make exactly one fetch call per RPC');
  });
});

// ---------------------------------------------------------------------------
// URL construction
// ---------------------------------------------------------------------------
describe('URL construction', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('calls the correct API path for security zones', async () => {
    let capturedUrl;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ 'comware-securityzone:SecurityZone': { Zones: { Zone: [] } } }),
      };
    };
    await rpcdef(buildCtx())[PATH_GET_SECURITY_ZONES]();
    assert.ok(capturedUrl.includes('/restconf/data/comware-securityzone:SecurityZone/Zones'), `unexpected URL: ${capturedUrl}`);
  });

  it('calls the correct API path for device base', async () => {
    let capturedUrl;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ 'comware-device:Device': { Base: {} } }),
      };
    };
    await rpcdef(buildCtx())[PATH_GET_DEVICE_BASE]();
    assert.ok(capturedUrl.includes('/restconf/data/comware-device:Device/Base'), `unexpected URL: ${capturedUrl}`);
  });

  it('calls the correct API path for IPv4 security policies', async () => {
    let capturedUrl;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ 'comware-securitypolicies:SecurityPolicies': { IPv4Rules: { IPv4Rule: [] } } }),
      };
    };
    await rpcdef(buildCtx())[PATH_GET_IPV4_SECURITY_POLICIES]();
    assert.ok(capturedUrl.includes('/restconf/data/comware-securitypolicies:SecurityPolicies/IPv4Rules'), `unexpected URL: ${capturedUrl}`);
  });

  it('calls the correct API path for sessions', async () => {
    let capturedUrl;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ 'comware-session:SESSION': { Sessions: { Session: [] } } }),
      };
    };
    await rpcdef(buildCtx())[PATH_GET_SESSIONS]();
    assert.ok(capturedUrl.includes('/restconf/data/comware-session:SESSION/Sessions'), `unexpected URL: ${capturedUrl}`);
  });

  it('calls the correct API path for NAT static mappings', async () => {
    let capturedUrl;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ 'comware-nat:NAT': { Static: { StaticMappings: { StaticMapping: [] } } } }),
      };
    };
    await rpcdef(buildCtx())[PATH_GET_NAT_STATIC_MAPPINGS]();
    assert.ok(capturedUrl.includes('/restconf/data/comware-nat:NAT/Static/StaticMappings'), `unexpected URL: ${capturedUrl}`);
  });

  it('uses host from bindings as base URL prefix', async () => {
    let capturedUrl;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ 'comware-securityzone:SecurityZone': { Zones: { Zone: [] } } }),
      };
    };
    await rpcdef(buildCtx({ bindings: { host: 'https://192.168.100.1', username: 'admin', password: 'Admin123' } }))[PATH_GET_SECURITY_ZONES]();
    assert.ok(capturedUrl.startsWith('https://192.168.100.1'), `expected URL to start with host: ${capturedUrl}`);
  });
});

// ---------------------------------------------------------------------------
// handlers SDK-style call tests
// ---------------------------------------------------------------------------
describe('handlers SDK-style call', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('GetSecurityZones handler works via req+ctx style', async () => {
    const apiResp = {
      'comware-securityzone:SecurityZone': {
        Zones: { Zone: [{ Name: 'DMZ', ID: 3 }] },
      },
    };
    globalThis.fetch = makeBasicFetch(apiResp);
    const req = {};
    const ctx = {
      bindings: { host: 'https://h3c.example.com', username: 'admin', password: 'Admin123' },
      secret: { username: 'admin', password: 'Admin123' },
    };
    const r = await handlers[KEY_GET_SECURITY_ZONES](req, ctx);
    assert.equal(r.items.length, 1);
    assert.deepEqual(r.items[0].structValue.fields.Name, { stringValue: 'DMZ' });
  });

  it('GetDeviceBase handler works via req+ctx style', async () => {
    const apiResp = {
      'comware-device:Device': {
        Base: { HostName: 'SecPath-F1000', SoftwareVersion: '7.2.001' },
      },
    };
    globalThis.fetch = makeBasicFetch(apiResp);
    const ctx = {
      bindings: { host: 'https://h3c.example.com', username: 'admin', password: 'Admin123' },
      secret: { username: 'admin', password: 'Admin123' },
    };
    const r = await handlers[KEY_GET_DEVICE_BASE]({}, ctx);
    assert.ok(r.info.structValue, 'expected structValue on info');
    assert.deepEqual(r.info.structValue.fields.HostName, { stringValue: 'SecPath-F1000' });
  });
});
