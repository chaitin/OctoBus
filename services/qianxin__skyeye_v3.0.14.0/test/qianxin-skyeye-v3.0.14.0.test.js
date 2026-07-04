import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  _test,
  METHOD_QUERY_ALARM_LIST_FULL,
  METHOD_QUERY_ALARM_PACKET_FULL,
  METHOD_DOWNLOAD_ALARM_PCAP_FULL,
  METHOD_QUERY_NETWORK_LOG_FULL,
  handlers,
  rpcdef,
} from '../src/qianxin-skyeye-v3.0.14.0.js';

import { createMockServer } from './mock_upstream.js';

const {
  requireDomain, requireField,
  resolveDomain, resolveCsrfToken, resolveLoginKey, resolveStaffName, resolveUserName,
  buildAuthQuery, buildQueryUrl, encodeQueryPairs,
  parseSkyEyeResponse, handleHttpResponse,
  normalizeBaseUrl, toTrimmedString, firstDefined,
  mergedBindings, resolveCallContext, errorWithCode,
  authenticate, resolveAuth, authCache,
  withAuthRetry,
} = _test;

const buildCtx = (overrides = {}) => ({
  config: { skyeye_domain: 'https://skyeye.example.com', skyeye_staff_name: 'admin' },
  secret: { skyeye_csrf_token: 'test-csrf-token' },
  ...overrides,
});

const buildLoginKeyCtx = (domain, overrides = {}) => ({
  config: { skyeye_domain: domain, skyeye_user_name: 'admin', skyeye_staff_name: 'admin' },
  secret: { skyeye_login_key: 'test-login-key' },
  ...overrides,
});

let mockServer;

before(async () => {
  mockServer = await createMockServer();
  authCache.clear();
});

after(async () => {
  if (mockServer) await mockServer.close();
});

// ─── Binding resolvers ───

describe('resolveDomain', () => {
  it('resolves skyeye_domain', () => {
    assert.equal(resolveDomain({ skyeye_domain: 'https://10.0.0.1:443' }), 'https://10.0.0.1:443');
  });

  it('resolves domain alias', () => {
    assert.equal(resolveDomain({ domain: 'https://10.0.0.1:443' }), 'https://10.0.0.1:443');
  });

  it('returns empty for missing', () => {
    assert.equal(resolveDomain({}), '');
  });
});

describe('resolveLoginKey', () => {
  it('resolves skyeye_login_key', () => {
    assert.equal(resolveLoginKey({ skyeye_login_key: 'abc' }), 'abc');
  });

  it('resolves login_key alias', () => {
    assert.equal(resolveLoginKey({ login_key: 'abc' }), 'abc');
  });

  it('returns empty for missing', () => {
    assert.equal(resolveLoginKey({}), '');
  });
});

describe('resolveCsrfToken', () => {
  it('resolves skyeye_csrf_token', () => {
    assert.equal(resolveCsrfToken({ skyeye_csrf_token: 'abc123' }), 'abc123');
  });

  it('resolves csrf_token alias', () => {
    assert.equal(resolveCsrfToken({ csrf_token: 'abc123' }), 'abc123');
  });
});

describe('resolveUserName', () => {
  it('resolves skyeye_user_name', () => {
    assert.equal(resolveUserName({ skyeye_user_name: 'admin' }), 'admin');
  });

  it('returns empty string when not set', () => {
    assert.equal(resolveUserName({ skyeye_staff_name: 'admin' }), '');
  });
});

describe('resolveStaffName', () => {
  it('resolves skyeye_staff_name', () => {
    assert.equal(resolveStaffName({ skyeye_staff_name: 'admin' }), 'admin');
  });

  it('returns empty string when not set', () => {
    assert.equal(resolveStaffName({ skyeye_user_name: 'admin' }), '');
  });
});

describe('requireDomain', () => {
  it('throws when missing', () => {
    assert.throws(() => requireDomain({ bindings: {} }), /skyeye_domain is required/);
  });

  it('returns domain when present', () => {
    assert.equal(requireDomain({ bindings: { skyeye_domain: 'https://10.0.0.1:443' } }), 'https://10.0.0.1:443');
  });
});

describe('requireField', () => {
  it('throws when missing', () => {
    assert.throws(() => requireField({}, 'start_time'), /start_time is required/);
  });

  it('returns value when present', () => {
    assert.equal(requireField({ start_time: '1571385615000' }, 'start_time'), '1571385615000');
  });

  it('reads camelCase variant', () => {
    assert.equal(requireField({ startTime: '1571385615000' }, 'start_time'), '1571385615000');
  });
});

// ─── Auth flow ───

describe('authenticate', () => {
  it('obtains csrf_token and cookies via 2-step auth', async () => {
    authCache.clear();
    const result = await authenticate(mockServer.url, 'test-login-key', 'admin', '', '', 10000, false);
    assert.equal(result.csrfToken, 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6');
    assert.ok(result.cookieHeader.includes('sessionid=mock-session-id'));
    assert.equal(result.expiresAt, 0, 'expiresAt is 0 when cache is disabled');
  });

  it('does not cache when AUTH_CACHE_TTL_MS is 0', async () => {
    authCache.clear();
    mockServer.requests.length = 0;
    const first = await authenticate(mockServer.url, 'test-key-cache', 'admin', '', '', 10000, false);
    const firstAuthReqs = mockServer.requests.filter((r) => r.path === '/skyeye/v1/admin/auth');
    assert.equal(firstAuthReqs.length, 2);
    mockServer.requests.length = 0;
    const second = await authenticate(mockServer.url, 'test-key-cache', 'admin', '', '', 10000, false);
    const secondAuthReqs = mockServer.requests.filter((r) => r.path === '/skyeye/v1/admin/auth');
    assert.equal(secondAuthReqs.length, 2, 'should re-authenticate every call when cache is disabled');
    assert.equal(first.csrfToken, second.csrfToken);
  });
});

describe('resolveAuth', () => {
  it('uses auth flow when login_key is configured', async () => {
    authCache.clear();
    const ctx = resolveCallContext(buildLoginKeyCtx(mockServer.url));
    const result = await resolveAuth(ctx);
    assert.equal(result.csrfToken, 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6');
    assert.ok(result.cookieHeader);
  });

  it('uses static csrf_token when login_key is not configured', async () => {
    const ctx = resolveCallContext(buildCtx());
    const result = await resolveAuth(ctx);
    assert.equal(result.csrfToken, 'test-csrf-token');
    assert.equal(result.cookieHeader, '');
  });

  it('throws when neither login_key nor csrf_token is configured', async () => {
    const ctx = resolveCallContext({ config: { skyeye_domain: mockServer.url } });
    await assert.rejects(() => resolveAuth(ctx), /skyeye_login_key or skyeye_csrf_token is required/);
  });
});

// ─── withAuthRetry ───

describe('withAuthRetry', () => {
  it('retries on 401 with fresh auth', async () => {
    authCache.clear();
    let callCount = 0;
    const doFetch = async (auth) => {
      callCount++;
      if (callCount === 1) return { httpStatus: 401, httpBody: '{"error":"unauthorized"}' };
      return { httpStatus: 200, httpBody: '{"status":1000,"message":"success","data":{}}' };
    };
    const ctx = resolveCallContext(buildLoginKeyCtx(mockServer.url));
    const result = await withAuthRetry(ctx, doFetch);
    assert.equal(result.httpStatus, 200);
    assert.equal(callCount, 2);
  });

  it('does not retry on 200', async () => {
    authCache.clear();
    let callCount = 0;
    const doFetch = async () => {
      callCount++;
      return { httpStatus: 200, httpBody: '{"status":1000,"message":"success","data":{}}' };
    };
    const ctx = resolveCallContext(buildLoginKeyCtx(mockServer.url));
    const result = await withAuthRetry(ctx, doFetch);
    assert.equal(result.httpStatus, 200);
    assert.equal(callCount, 1);
  });

  it('does not retry on 500', async () => {
    authCache.clear();
    let callCount = 0;
    const doFetch = async () => {
      callCount++;
      return { httpStatus: 500, httpBody: 'internal error' };
    };
    const ctx = resolveCallContext(buildLoginKeyCtx(mockServer.url));
    const result = await withAuthRetry(ctx, doFetch);
    assert.equal(result.httpStatus, 500);
    assert.equal(callCount, 1);
  });
});

// ─── buildAuthQuery ───

describe('buildAuthQuery', () => {
  it('includes csrf_token and r', () => {
    const result = buildAuthQuery('test-token');
    assert.equal(result.csrf_token, 'test-token');
    assert.ok(result.r);
    assert.ok(typeof result.r === 'string');
  });
});

// ─── parseSkyEyeResponse ───

describe('parseSkyEyeResponse', () => {
  it('parses top-level status/message (packet/pcap style)', () => {
    const result = parseSkyEyeResponse('{"status":200,"message":"ok","data":{"items":[]}}');
    assert.equal(result.responseCode, 200);
    assert.equal(result.verboseMsg, 'ok');
    assert.ok(result.data);
  });

  it('parses nested status/message inside data (alarm list style)', () => {
    const result = parseSkyEyeResponse('{"data":{"items":[],"status":1000,"message":"success"}}');
    assert.equal(result.responseCode, 1000);
    assert.equal(result.verboseMsg, 'success');
    assert.ok(result.data);
  });

  it('parses doubly-nested data (network log style)', () => {
    const result = parseSkyEyeResponse('{"data":{"status":1000,"message":"success","data":{"field_mapping":{},"search":{"total":1}}}}');
    assert.equal(result.responseCode, 1000);
    assert.equal(result.verboseMsg, 'success');
    const parsed = JSON.parse(result.data);
    assert.ok(parsed.search);
    assert.equal(parsed.search.total, 1);
  });

  it('handles empty data', () => {
    const result = parseSkyEyeResponse('{"status":200,"message":"ok"}');
    assert.equal(result.responseCode, 200);
    assert.equal(result.verboseMsg, 'ok');
    assert.equal(result.data, '');
  });

  it('handles invalid JSON', () => {
    const result = parseSkyEyeResponse('not json');
    assert.equal(result.responseCode, 0);
  });
});

// ─── Handlers with static csrf_token (legacy) ───

describe('handlers (legacy csrf_token) - QueryAlarmList', () => {
  it('calls upstream and returns mapped response', async () => {
    const handler = handlers[METHOD_QUERY_ALARM_LIST_FULL];
    const result = await handler(
      { start_time: '1571385615000', end_time: '1571385617000' },
      { config: { skyeye_domain: mockServer.url, skyeye_staff_name: 'admin' }, secret: { skyeye_csrf_token: 'test-token' } },
    );
    assert.equal(result.response_code, 1000);
    assert.equal(result.verbose_msg, 'success');
    assert.ok(result.data);
  });

  it('throws on missing domain', async () => {
    const handler = handlers[METHOD_QUERY_ALARM_LIST_FULL];
    await assert.rejects(
      () => handler({ start_time: '1571385615000', end_time: '1571385617000' }, {}),
      /skyeye_domain is required/,
    );
  });

  it('throws on missing staff_name', async () => {
    const handler = handlers[METHOD_QUERY_ALARM_LIST_FULL];
    await assert.rejects(
      () => handler(
        { start_time: '1571385615000', end_time: '1571385617000' },
        { config: { skyeye_domain: mockServer.url }, secret: { skyeye_csrf_token: 'test-token' } },
      ),
      /skyeye_staff_name is required/,
    );
  });

  it('defaults data_source to 0 when not provided', async () => {
    const handler = handlers[METHOD_QUERY_ALARM_LIST_FULL];
    await handler(
      { start_time: '1571385615000', end_time: '1571385617000' },
      { config: { skyeye_domain: mockServer.url, skyeye_staff_name: 'admin' }, secret: { skyeye_csrf_token: 'test-token' } },
    );
    const lastReq = mockServer.requests[mockServer.requests.length - 1];
    assert.equal(lastReq.params.data_source, '0');
  });
});

describe('handlers (legacy csrf_token) - QueryAlarmPacket', () => {
  it('calls upstream and returns mapped response', async () => {
    const handler = handlers[METHOD_QUERY_ALARM_PACKET_FULL];
    const result = await handler(
      { alarm_sip: '10.0.0.1', attack_sip: '10.0.0.2', start_time: '1571385615000', end_time: '1571385617000', alarm_id: 'test-id' },
      { config: { skyeye_domain: mockServer.url }, secret: { skyeye_csrf_token: 'test-token' } },
    );
    assert.equal(result.response_code, 200);
    assert.equal(result.verbose_msg, 'ok');
  });
});

describe('handlers (legacy csrf_token) - DownloadAlarmPcap', () => {
  it('calls upstream and returns mapped response', async () => {
    const handler = handlers[METHOD_DOWNLOAD_ALARM_PCAP_FULL];
    const result = await handler(
      { alarm_sip: '10.0.0.1', attack_sip: '10.0.0.2', start_time: '1571385615000', end_time: '1571385617000' },
      { config: { skyeye_domain: mockServer.url }, secret: { skyeye_csrf_token: 'test-token' } },
    );
    assert.equal(result.response_code, 1000);
  });
});

describe('handlers (legacy csrf_token) - QueryNetworkLog', () => {
  it('calls upstream and returns mapped response', async () => {
    const handler = handlers[METHOD_QUERY_NETWORK_LOG_FULL];
    const result = await handler(
      { start_time: '1571385615000', end_time: '1571385617000', index: 'alarm_collection', category: 'event', mode: 'advance_model', offset: '1', limit: '50' },
      { config: { skyeye_domain: mockServer.url }, secret: { skyeye_csrf_token: 'test-token' } },
    );
    assert.equal(result.response_code, 1000);
    assert.equal(result.verbose_msg, 'success');
    const parsed = JSON.parse(result.data);
    assert.ok(parsed.search);
  });
});

// ─── Handlers with login_key auth flow ───

describe('handlers (login_key auth) - QueryAlarmList', () => {
  it('authenticates and calls upstream', async () => {
    authCache.clear();
    const handler = handlers[METHOD_QUERY_ALARM_LIST_FULL];
    const result = await handler(
      { start_time: '1571385615000', end_time: '1571385617000' },
      buildLoginKeyCtx(mockServer.url),
    );
    assert.equal(result.response_code, 1000);
    assert.equal(result.verbose_msg, 'success');
  });

  it('sends Cookie header after auth', async () => {
    authCache.clear();
    mockServer.requests.length = 0;
    const handler = handlers[METHOD_QUERY_ALARM_LIST_FULL];
    await handler(
      { start_time: '1571385615000', end_time: '1571385617000' },
      buildLoginKeyCtx(mockServer.url),
    );
    // Should have: POST auth, GET auth, GET alarm list
    const authPost = mockServer.requests.find((r) => r.method === 'POST' && r.path === '/skyeye/v1/admin/auth');
    assert.ok(authPost, 'POST auth request should exist');
    const alarmReq = mockServer.requests.find((r) => r.path === '/skyeye/v1/alarm/alarm/list');
    assert.ok(alarmReq, 'alarm list request should exist');
    // The csrf_token should come from auth, not static
    assert.equal(alarmReq.params.csrf_token, 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6');
  });
});

describe('handlers (login_key auth) - QueryAlarmPacket', () => {
  it('authenticates and calls upstream', async () => {
    authCache.clear();
    const handler = handlers[METHOD_QUERY_ALARM_PACKET_FULL];
    const result = await handler(
      { alarm_sip: '10.0.0.1', attack_sip: '10.0.0.2', start_time: '1571385615000', end_time: '1571385617000', alarm_id: 'test-id' },
      buildLoginKeyCtx(mockServer.url),
    );
    assert.equal(result.response_code, 200);
  });
});

describe('handlers (login_key auth) - QueryNetworkLog', () => {
  it('authenticates and calls upstream', async () => {
    authCache.clear();
    const handler = handlers[METHOD_QUERY_NETWORK_LOG_FULL];
    const result = await handler(
      { start_time: '1571385615000', end_time: '1571385617000', index: 'alarm_collection', category: 'event', mode: 'advance_model', offset: '1', limit: '50' },
      buildLoginKeyCtx(mockServer.url),
    );
    assert.equal(result.response_code, 1000);
  });
});

// ─── rpcdef & adaptHandler ───

describe('rpcdef', () => {
  it('returns method map with all 4 handlers', () => {
    const def = rpcdef(buildCtx());
    assert.ok(def['/QianXin_SkyEye_V3_0_14_0.QianXin_SkyEye_V3_0_14_0/QueryAlarmList']);
    assert.ok(def['/QianXin_SkyEye_V3_0_14_0.QianXin_SkyEye_V3_0_14_0/QueryAlarmPacket']);
    assert.ok(def['/QianXin_SkyEye_V3_0_14_0.QianXin_SkyEye_V3_0_14_0/DownloadAlarmPcap']);
    assert.ok(def['/QianXin_SkyEye_V3_0_14_0.QianXin_SkyEye_V3_0_14_0/QueryNetworkLog']);
  });
});

describe('adaptHandler', () => {
  it('handles (req, ctx) two-arg call', async () => {
    const handler = handlers[METHOD_QUERY_ALARM_LIST_FULL];
    const result = await handler(
      { start_time: '1571385615000', end_time: '1571385617000' },
      { config: { skyeye_domain: mockServer.url, skyeye_staff_name: 'admin' }, secret: { skyeye_csrf_token: 'test-token' } },
    );
    assert.equal(result.response_code, 1000);
  });

  it('handles SDK-style single-arg call', async () => {
    const handler = handlers[METHOD_QUERY_ALARM_LIST_FULL];
    const result = await handler({
      request: { start_time: '1571385615000', end_time: '1571385617000' },
      config: { skyeye_domain: mockServer.url, skyeye_staff_name: 'admin' },
      secret: { skyeye_csrf_token: 'test-token' },
    });
    assert.equal(result.response_code, 1000);
  });
});
