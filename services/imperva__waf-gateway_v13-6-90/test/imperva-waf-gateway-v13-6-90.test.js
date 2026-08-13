import test from 'node:test';
import assert from 'node:assert/strict';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  BLOCK_IP_PATH,
  CHECK_ONLINE_PATH,
  LIST_BLOCKED_IPS_PATH,
  METHOD_BLOCK_IP_FULL,
  METHOD_CHECK_ONLINE_FULL,
  METHOD_LIST_BLOCKED_IPS_FULL,
  METHOD_UNBLOCK_IP_FULL,
  UNBLOCK_IP_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/imperva-waf-gateway-v13-6-90.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;

const buildCtx = (overrides = {}) => ({
  bindings: {
    host: 'mx.example',
    username: 'api_user',
    password: 'api_password',
    headers: { 'X-Custom': 'demo' },
    ...(overrides.bindings || {}),
  },
  config: overrides.config || {},
  secret: overrides.secret || {},
  limits: { timeoutMs: 5000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const responseWithStatus = (status, body) => ({
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const parseErrorPayload = async (fn) => {
  let caught;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'expected function to reject');
  assert.ok(caught instanceof GrpcError);
  return { err: caught, payload: JSON.parse(caught.message) };
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalConsoleLog;
});

test('service exports handlers and rpcdef paths', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers[METHOD_CHECK_ONLINE_FULL], 'function');
  assert.equal(typeof handlers[METHOD_BLOCK_IP_FULL], 'function');
  assert.equal(typeof handlers[METHOD_LIST_BLOCKED_IPS_FULL], 'function');
  assert.equal(typeof handlers[METHOD_UNBLOCK_IP_FULL], 'function');
  assert.equal(typeof rpcdef(buildCtx())[CHECK_ONLINE_PATH], 'function');
  assert.equal(typeof rpcdef(buildCtx())[BLOCK_IP_PATH], 'function');
  assert.equal(typeof rpcdef(buildCtx())[LIST_BLOCKED_IPS_PATH], 'function');
  assert.equal(typeof rpcdef(buildCtx())[UNBLOCK_IP_PATH], 'function');
});

test('CheckOnline authenticates then reads MX version', async () => {
  const calls = [];
  const logs = [];
  console.log = (...args) => logs.push(args);
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (String(url).endsWith('/auth/session')) {
      return responseWithStatus(200, { 'session-id': 'JSESSIONID=abc' });
    }
    return responseWithStatus(200, { serverVersion: '13.6.90' });
  };

  const result = await handlers[METHOD_CHECK_ONLINE_FULL]({}, buildCtx());

  assert.equal(calls[0].url, 'https://mx.example:8083/SecureSphere/api/v1/auth/session');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, `Basic ${Buffer.from('api_user:api_password').toString('base64')}`);
  assert.equal(calls[1].url, 'https://mx.example:8083/SecureSphere/api/v1/administration/version');
  assert.equal(calls[1].init.method, 'GET');
  assert.equal(calls[1].init.headers.Cookie, 'JSESSIONID=abc');
  assert.equal(calls[1].init.headers['X-Custom'], 'demo');
  assert.equal(Object.hasOwn(calls[1].init, 'timeoutMs'), false);
  assert.ok(calls[1].init.signal instanceof AbortSignal);
  assert.equal(result.success, true);
  assert.equal(result.message, '13.6.90');
  assert.equal(result.raw_json, undefined);
  assert.match(JSON.stringify(logs), /Imperva_WAF_Gateway_v13_6_90/);
});

test('validates required bindings before upstream calls', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return responseWithStatus(200, {});
  };

  await assert.rejects(
    () => handlers[METHOD_CHECK_ONLINE_FULL]({}, buildCtx({ bindings: { host: '' } })),
    /host is required/,
  );
  await assert.rejects(
    () => handlers[METHOD_CHECK_ONLINE_FULL]({}, buildCtx({ bindings: { username: '' } })),
    /username is required/,
  );
  await assert.rejects(
    () => handlers[METHOD_CHECK_ONLINE_FULL]({}, buildCtx({ bindings: { password: '' } })),
    /password is required/,
  );
  await assert.rejects(
    () => handlers[METHOD_BLOCK_IP_FULL]({ ip: 'bad-ip' }, buildCtx()),
    /ip must be a valid IPv4 or IPv6 address/,
  );
  assert.equal(called, false);
});

test('BlockIP posts add operation to configured IP group', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (String(url).endsWith('/auth/session')) return responseWithStatus(200, { sessionId: 'CookieValue' });
    if (String(url).includes('/conf/ipGroups/') && init.method === 'GET') return responseWithStatus(200, { entries: [] });
    if (String(url).endsWith('/conf/sites')) return responseWithStatus(200, { sites: ['业务站点'] });
    if (String(url).includes('/conf/serverGroups/')) return responseWithStatus(200, { 'server-groups': ['018'] });
    if (String(url).includes('/conf/webServices/')) return responseWithStatus(200, { 'web-services': ['test'] });
    if (String(url).includes('/conf/webServiceCustomPolicies/')) return responseWithStatus(200, { enabled: true, action: 'block' });
    return responseWithStatus(200, { status: 'ok' });
  };

  const result = await rpcdef(buildCtx({ req: { ip: '203.0.113.45' } }))[BLOCK_IP_PATH]();

  assert.equal(calls[1].url, 'https://mx.example:8083/SecureSphere/api/v1/conf/ipGroups/OctoBus%E9%BB%91%E5%90%8D%E5%8D%95IP%E7%BB%84');
  assert.equal(calls[1].init.method, 'GET');
  assert.equal(calls[5].url, 'https://mx.example:8083/SecureSphere/api/v1/conf/webServiceCustomPolicies/OctoBus%E9%BB%91%E5%90%8D%E5%8D%95%E7%AD%96%E7%95%A5');
  assert.equal(calls[5].init.method, 'GET');
  assert.equal(calls[6].url, 'https://mx.example:8083/SecureSphere/api/v1/conf/webServiceCustomPolicies/OctoBus%E9%BB%91%E5%90%8D%E5%8D%95%E7%AD%96%E7%95%A5');
  assert.equal(calls[6].init.method, 'PUT');
  assert.deepEqual(JSON.parse(calls[6].init.body), {
    applyTo: [{
      siteName: '业务站点',
      serverGroupName: '018',
      webServiceName: 'test',
      operation: 'add',
    }],
  });
  assert.equal(calls[7].url, 'https://mx.example:8083/SecureSphere/api/v1/conf/ipGroups/OctoBus%E9%BB%91%E5%90%8D%E5%8D%95IP%E7%BB%84');
  assert.equal(calls[7].init.method, 'PUT');
  assert.equal(calls[7].init.headers.Cookie, 'CookieValue');
  assert.deepEqual(JSON.parse(calls[7].init.body), {
    entries: [{
      type: 'single',
      ipAddressFrom: '203.0.113.45',
      ipAddressTo: '203.0.113.45',
      networkAddress: null,
      cidrMask: null,
      operation: 'add',
    }],
  });
  assert.equal(result.success, true);
  assert.equal(result.http_status, 200);
});

test('BlockIP creates block custom policy when it is missing', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (String(url).endsWith('/auth/session')) return responseWithStatus(200, { sessionId: 'CookieValue' });
    if (String(url).includes('/conf/ipGroups/') && init.method === 'GET') return responseWithStatus(404, { message: 'not found' });
    if (String(url).includes('/conf/ipGroups/') && init.method === 'POST') return responseWithStatus(200, { status: 'ok' });
    if (String(url).endsWith('/conf/sites')) return responseWithStatus(200, { sites: ['业务站点'] });
    if (String(url).includes('/conf/serverGroups/')) return responseWithStatus(200, { 'server-groups': ['018'] });
    if (String(url).includes('/conf/webServices/')) return responseWithStatus(200, { 'web-services': ['test'] });
    if (String(url).includes('/conf/webServiceCustomPolicies/') && init.method === 'GET') return responseWithStatus(404, { message: 'not found' });
    return responseWithStatus(200, { status: 'ok' });
  };

  await handlers[METHOD_BLOCK_IP_FULL]({ ip: '203.0.113.45' }, buildCtx());

  assert.equal(calls[1].init.method, 'GET');
  assert.equal(calls[2].url, 'https://mx.example:8083/SecureSphere/api/v1/conf/ipGroups/OctoBus%E9%BB%91%E5%90%8D%E5%8D%95IP%E7%BB%84');
  assert.equal(calls[2].init.method, 'POST');
  assert.equal(calls[6].url, 'https://mx.example:8083/SecureSphere/api/v1/conf/webServiceCustomPolicies/OctoBus%E9%BB%91%E5%90%8D%E5%8D%95%E7%AD%96%E7%95%A5');
  assert.equal(calls[6].init.method, 'GET');
  assert.equal(calls[7].url, 'https://mx.example:8083/SecureSphere/api/v1/conf/webServiceCustomPolicies/OctoBus%E9%BB%91%E5%90%8D%E5%8D%95%E7%AD%96%E7%95%A5');
  assert.equal(calls[7].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[7].init.body), {
    enabled: true,
    severity: 'high',
    action: 'block',
    displayResponsePage: true,
    oneAlertPerSession: false,
    applyTo: [{
      siteName: '业务站点',
      serverGroupName: '018',
      webServiceName: 'test',
    }],
    matchCriteria: [{
      type: 'sourceIpAddresses',
      operation: 'atLeastOne',
      ipGroups: ['OctoBus黑名单IP组'],
    }],
  });
  assert.equal(calls[8].url, 'https://mx.example:8083/SecureSphere/api/v1/conf/ipGroups/OctoBus%E9%BB%91%E5%90%8D%E5%8D%95IP%E7%BB%84');
  assert.equal(calls[8].init.method, 'PUT');
});

test('UnblockIP posts remove operation to configured IP group', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (String(url).endsWith('/auth/session')) return responseWithStatus(200, { 'session-id': 'CookieValue' });
    return responseWithStatus(204, '');
  };

  const result = await handlers[METHOD_UNBLOCK_IP_FULL]({ ip: '2001:db8::1' }, buildCtx({ bindings: { skipTlsVerify: true } }));

  assert.equal(calls[1].url, 'https://mx.example:8083/SecureSphere/api/v1/conf/ipGroups/OctoBus%E9%BB%91%E5%90%8D%E5%8D%95IP%E7%BB%84');
  assert.equal(calls[1].init.method, 'PUT');
  assert.equal(Object.hasOwn(calls[1].init, 'skipTlsVerify'), false);
  assert.equal(Object.hasOwn(calls[1].init, 'tlsInsecureSkipVerify'), false);
  assert.equal(Object.hasOwn(calls[1].init, 'insecureSkipVerify'), false);
  assert.ok(calls[1].init.dispatcher);
  assert.deepEqual(JSON.parse(calls[1].init.body).entries[0], {
    type: 'single',
    ipAddressFrom: '2001:db8::1',
    ipAddressTo: '2001:db8::1',
    networkAddress: null,
    cidrMask: null,
    operation: 'remove',
  });
  assert.equal(result.success, true);
  assert.equal(result.http_status, 204);
});

test('ListBlockedIPs reads entries from configured IP group', async () => {
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/auth/session')) return responseWithStatus(200, { 'session-id': 'CookieValue' });
    return responseWithStatus(200, {
      entries: [
        { type: 'single', ipAddressFrom: '203.0.113.45', ipAddressTo: '203.0.113.45' },
        { type: 'single', networkAddress: '2001:db8::1', cidrMask: 128, comment: 'ipv6' },
        { type: 'single' },
      ],
    });
  };

  const result = await handlers[METHOD_LIST_BLOCKED_IPS_FULL]({}, buildCtx());

  assert.equal(result.http_status, 200);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].ip, '203.0.113.45');
  assert.equal(result.items[1].ip, '2001:db8::1');
  assert.equal(result.items[1].comment, 'ipv6');
  assert.equal(result.raw_json, undefined);
});

test('SDK handlers accept single context with config and secret', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (String(url).endsWith('/auth/session')) return responseWithStatus(200, { sessionId: 'CookieValue' });
    return responseWithStatus(204, '');
  };

  const result = await handlers[METHOD_UNBLOCK_IP_FULL]({
    request: {
      ip: '1.1.1.1',
    },
    config: {
      host: 'https://mx-sdk.example:9443',
      skipTlsVerify: true,
    },
    secret: {
      username: 'sdk-user',
      password: 'sdk-password',
    },
    meta: {
      instance_id: 'inst-sdk',
      request_id: 'req-sdk',
    },
  });

  assert.equal(calls[0].url, 'https://mx-sdk.example:9443/SecureSphere/api/v1/auth/session');
  assert.equal(calls[0].init.headers.Authorization, `Basic ${Buffer.from('sdk-user:sdk-password').toString('base64')}`);
  assert.equal(calls[1].url, 'https://mx-sdk.example:9443/SecureSphere/api/v1/conf/ipGroups/OctoBus%E9%BB%91%E5%90%8D%E5%8D%95IP%E7%BB%84');
  assert.equal(calls[1].init.method, 'PUT');
  assert.equal(calls[1].init.headers.Cookie, 'CookieValue');
  assert.equal(calls[1].init.headers['x-engine-instance'], 'inst-sdk');
  assert.equal(calls[1].init.headers['x-request-id'], 'req-sdk');
  assert.deepEqual(JSON.parse(calls[1].init.body).entries[0], {
    type: 'single',
    ipAddressFrom: '1.1.1.1',
    ipAddressTo: '1.1.1.1',
    networkAddress: null,
    cidrMask: null,
    operation: 'remove',
  });
  assert.equal(result.success, true);
  assert.equal(result.http_status, 204);
});

test('auth, http, protocol and network errors map correctly', async () => {
  globalThis.fetch = async () => responseWithStatus(200, { ok: true });
  const authShape = await parseErrorPayload(() => handlers[METHOD_CHECK_ONLINE_FULL]({}, buildCtx()));
  assert.equal(authShape.err.code, grpcStatus.PERMISSION_DENIED);
  assert.equal(authShape.payload.code, 'PERMISSION_DENIED');

  for (const [status, grpcCode, legacyCode] of [
    [401, grpcStatus.PERMISSION_DENIED, 'PERMISSION_DENIED'],
    [403, grpcStatus.PERMISSION_DENIED, 'PERMISSION_DENIED'],
    [404, grpcStatus.FAILED_PRECONDITION, 'FAILED_PRECONDITION'],
    [500, grpcStatus.UNAVAILABLE, 'UNAVAILABLE'],
  ]) {
    globalThis.fetch = async () => responseWithStatus(status, { message: 'bad' });
    const { err, payload } = await parseErrorPayload(() => handlers[METHOD_CHECK_ONLINE_FULL]({}, buildCtx()));
    assert.equal(err.code, grpcCode);
    assert.equal(err.legacyCode, legacyCode);
    assert.equal(payload.http_status, status);
  }

  globalThis.fetch = async () => responseWithStatus(200, '{bad-json');
  const invalidJson = await parseErrorPayload(() => handlers[METHOD_CHECK_ONLINE_FULL]({}, buildCtx()));
  assert.equal(invalidJson.err.code, grpcStatus.UNKNOWN);

  globalThis.fetch = async () => {
    throw Object.assign(new Error('outer'), { cause: new Error('socket timeout') });
  };
  await assert.rejects(
    () => handlers[METHOD_CHECK_ONLINE_FULL]({}, buildCtx()),
    (err) => {
      assert.equal(err.code, grpcStatus.UNAVAILABLE);
      assert.equal(err.legacyCode, 'UNAVAILABLE');
      assert.match(err.message, /socket timeout/);
      return true;
    },
  );
});

test('mock upstream receives SDK-compatible URLs', async () => {
  const seen = [];
  const server = await createMockServer(async (req, res) => {
    seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization, cookie: req.headers.cookie });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/SecureSphere/api/v1/auth/session') {
      res.end(JSON.stringify({ sessionId: 'CookieValue' }));
      return;
    }
    res.end(JSON.stringify({ serverVersion: '13.6.90' }));
  });
  try {
    const result = await handlers[METHOD_CHECK_ONLINE_FULL]({}, buildCtx({ bindings: { host: server.url } }));
    assert.equal(result.success, true);
    assert.equal(seen[0].authorization, `Basic ${Buffer.from('api_user:api_password').toString('base64')}`);
    assert.equal(seen[1].url, '/SecureSphere/api/v1/administration/version');
    assert.equal(seen[1].cookie, 'CookieValue');
  } finally {
    await server.close();
  }
});

test('helper functions cover normalization branches', () => {
  assert.equal(_test.normalizeHost('mx.example///'), 'https://mx.example');
  assert.equal(_test.splitHostAndPort('mx.example', 9443), 'https://mx.example:9443');
  assert.equal(_test.splitHostAndPort('https://mx.example:8443', 9443), 'https://mx.example:8443');
  assert.equal(_test.resolveHost({ host: 'mx.example', port: 9443 }), 'https://mx.example:9443');
  assert.equal(_test.buildIPEntry('1.1.1.1', 'add').operation, 'add');
  assert.equal(_test.ipGroupPath('A B'), '/conf/ipGroups/A%20B');
  assert.equal(_test.webServiceCustomPolicyPath('Policy A'), '/conf/webServiceCustomPolicies/Policy%20A');
  assert.deepEqual(_test.buildWebServiceBlockPolicy(buildCtx().bindings, [{ siteName: '业务站点', serverGroupName: '018', webServiceName: 'test' }]).body.matchCriteria, [{
    type: 'sourceIpAddresses',
    operation: 'atLeastOne',
    ipGroups: ['OctoBus黑名单IP组'],
  }]);
  assert.deepEqual(_test.buildApplyToChange([], [{ siteName: '业务站点', serverGroupName: '018', webServiceName: 'test' }]), [{
    siteName: '业务站点',
    serverGroupName: '018',
    webServiceName: 'test',
    operation: 'add',
  }]);
  assert.equal(_test.parseJsonSafe('').ok, true);
  assert.equal(_test.parseJsonSafe('bad').ok, false);
  assert.equal(_test.normalizeIPEntry('1.1.1.1').ip, '1.1.1.1');
  assert.equal(_test.normalizeIPEntry({ address: '2.2.2.2', createdAt: 'now' }).created_at, 'now');
  assert.equal(_test.normalizeIPEntry({ bad: true }), null);
  assert.equal(_test.isIPv4('1.2.3'), false);
  assert.equal(_test.isIPv4('1.2.3.999'), false);
  assert.equal(_test.isIPv6('2001:db8::1'), true);
  assert.equal(_test.isIPv6('2001::db8::1'), false);
  assert.equal(_test.trimString({ value: ' x ' }), 'x');
});
