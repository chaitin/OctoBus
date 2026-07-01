import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_QUERY_IP_REPUTATION_FULL,
  METHOD_QUERY_IP_REPUTATION_PATH,
  METHOD_QUERY_DNS_COMPROMISED_FULL,
  METHOD_QUERY_FILE_REPUTATION_FULL,
  METHOD_QUERY_VULNERABILITY_FULL,
  METHOD_QUERY_IP_LOCATION_FULL,
  _test,
  handlers,
  rpcdef,
} from '../src/threatbook-ngtip-v5.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;
const originalLog = console.log;

const response = (status, body) => ({
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const setFetch = (impl) => {
  globalThis.fetch = impl;
};

const buildCtx = (overrides = {}) => ({
  config: {
    ngtip_domain: 'http://10.0.0.1:8090',
    ...(overrides.config || {}),
  },
  secret: {
    ngtip_apikey: 'test_api_key',
    ...(overrides.secret || {}),
  },
  bindings: {
    ...(overrides.bindings || {}),
  },
  limits: { timeoutMs: 10_000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const expectGrpcError = async (fn, legacyCode, checker = () => {}) => {
  let caught;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'expected function to reject');
  assert.ok(caught instanceof GrpcError);
  assert.equal(caught.legacyCode, legacyCode);
  checker(caught);
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalLog;
});

test('service exports handlers and rpcdef paths', () => {
  assert.equal(typeof service, 'object');
  for (const key of [METHOD_QUERY_IP_REPUTATION_FULL, METHOD_QUERY_DNS_COMPROMISED_FULL, METHOD_QUERY_FILE_REPUTATION_FULL, METHOD_QUERY_VULNERABILITY_FULL, METHOD_QUERY_IP_LOCATION_FULL]) {
    assert.equal(typeof handlers[key], 'function');
  }
  assert.equal(typeof rpcdef(buildCtx())[METHOD_QUERY_IP_REPUTATION_PATH], 'function');
});

test('validates required bindings and resource', async () => {
  await expectGrpcError(
    () => handlers[METHOD_QUERY_IP_REPUTATION_FULL]({ resource: '8.8.8.8' }, buildCtx({ config: { ngtip_domain: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /ngtip_domain/),
  );
  await expectGrpcError(
    () => handlers[METHOD_QUERY_IP_REPUTATION_FULL]({ resource: '8.8.8.8' }, buildCtx({ secret: { ngtip_apikey: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /ngtip_apikey/),
  );
  await expectGrpcError(
    () => handlers[METHOD_QUERY_IP_REPUTATION_FULL]({}, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /resource is required/),
  );
});

test('QueryIPReputation parses structured response', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, {
      response_code: 0,
      verbose_msg: 'Ok',
      data: [{ ioc: '8.8.8.8', intelligence: [{ severity: 'malicious' }] }],
    });
  });

  const result = await handlers[METHOD_QUERY_IP_REPUTATION_FULL]({ resource: '8.8.8.8' }, buildCtx());
  const url = new URL(captured.url);
  assert.equal(`${url.origin}${url.pathname}`, 'http://10.0.0.1:8090/tip_api/v5/ip');
  assert.equal(url.searchParams.get('apikey'), 'test_api_key');
  assert.equal(url.searchParams.get('resource'), '8.8.8.8');
  assert.equal(url.searchParams.has('lang'), false);
  assert.equal(result.response_code, 0);
  assert.equal(result.verbose_msg, 'Ok');
  assert.ok(result.data.includes('malicious'));
});

test('lang is only sent when caller provides it', async () => {
  let captured;
  setFetch(async (url) => {
    captured = String(url);
    return response(200, { response_code: 0, verbose_msg: 'Ok', data: [] });
  });

  await handlers[METHOD_QUERY_IP_REPUTATION_FULL]({ resource: '8.8.8.8' }, buildCtx());
  assert.ok(!new URL(captured).searchParams.has('lang'), 'lang should not be present by default');

  await handlers[METHOD_QUERY_IP_REPUTATION_FULL]({ resource: '8.8.8.8', lang: 'en' }, buildCtx());
  assert.equal(new URL(captured).searchParams.get('lang'), 'en');
});

test('QueryIPReputation with optional params', async () => {
  let captured;
  setFetch(async (url) => {
    captured = String(url);
    return response(200, { response_code: 0, verbose_msg: 'Ok', data: [] });
  });

  await handlers[METHOD_QUERY_IP_REPUTATION_FULL]({ resource: '8.8.8.8', host: '10.0.0.1', location: true, lang: 'zh' }, buildCtx());
  const url = new URL(captured);
  assert.equal(url.searchParams.get('host'), '10.0.0.1');
  assert.equal(url.searchParams.get('location'), 'true');
  assert.equal(url.searchParams.get('lang'), 'zh');
});

test('single-argument SDK context uses ctx.req, keeps secret authoritative, and redacts logs', async () => {
  const logs = [];
  console.log = (...args) => logs.push(args.map((arg) => String(arg)).join(' '));
  let captured;
  setFetch(async (url) => {
    captured = String(url);
    return response(200, { response_code: 0, verbose_msg: 'Ok', data: [] });
  });

  const ctx = buildCtx({
    secret: {
      ngtip_apikey: 'test_api_key',
      salt: 'test_salt',
      auth_mode: 'token',
    },
    req: {
      resource: '8.8.8.8',
      ngtip_apikey: 'request_supplied_key',
      apiKey: 'request_supplied_key',
    },
  });

  const result = await handlers[METHOD_QUERY_IP_REPUTATION_FULL](ctx);
  const url = new URL(captured);
  const token = url.searchParams.get('token');
  assert.equal(result.response_code, 0);
  assert.equal(url.searchParams.get('apikey'), 'test_api_key');
  assert.equal(url.searchParams.get('resource'), '8.8.8.8');
  assert.ok(token);
  assert.ok(logs.length >= 2);
  const renderedLogs = logs.join('\n');
  assert.doesNotMatch(renderedLogs, /test_api_key/);
  assert.doesNotMatch(renderedLogs, /test_salt/);
  assert.doesNotMatch(renderedLogs, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(renderedLogs, /request_supplied_key/);
});

test('business failure (response_code != 0) still returns gRPC OK with structured fields', async () => {
  setFetch(async () => response(200, { response_code: 1001, verbose_msg: 'IP not found', data: [] }));
  const result = await handlers[METHOD_QUERY_IP_REPUTATION_FULL]({ resource: '1.1.1.1' }, buildCtx());
  assert.equal(result.response_code, 1001);
  assert.equal(result.verbose_msg, 'IP not found');
  assert.equal(result.data, '[]');
});

test('QueryDNSCompromised sends correct path and returns structured response', async () => {
  setFetch(async () => response(200, { response_code: 0, verbose_msg: 'Ok', data: [{ ioc: 'evil.com', intelligence: [{ severity: 'critical' }] }] }));
  const result = await handlers[METHOD_QUERY_DNS_COMPROMISED_FULL]({ resource: 'evil.com', lang: 'zh' }, buildCtx());
  assert.equal(result.response_code, 0);
  assert.ok(result.data.includes('critical'));
});

test('QueryFileReputation sends correct path', async () => {
  setFetch(async () => response(200, { response_code: 0, verbose_msg: 'Ok', data: [{ ioc: 'abc123', intelligence: [{ threat_level: 'malicious' }] }] }));
  const result = await handlers[METHOD_QUERY_FILE_REPUTATION_FULL]({ resource: 'abc123' }, buildCtx());
  assert.equal(result.response_code, 0);
});

test('QueryVulnerability sends optional params', async () => {
  let captured;
  setFetch(async (url) => {
    captured = String(url);
    return response(200, { response_code: 0, verbose_msg: 'Ok', data: { total_records: 0, items: [] } });
  });

  const result = await handlers[METHOD_QUERY_VULNERABILITY_FULL]({ vuln_id: 'CVE-2024-1234', limit: 10, is_highrisk: true }, buildCtx());
  const url = new URL(captured);
  assert.equal(url.pathname, '/tip_api/v5/vuln');
  assert.equal(url.searchParams.get('vuln_id'), 'CVE-2024-1234');
  assert.equal(url.searchParams.get('limit'), '10');
  assert.equal(url.searchParams.get('is_highrisk'), 'true');
  assert.equal(result.response_code, 0);
});

test('QueryIPLocation sends correct path', async () => {
  setFetch(async () => response(200, { response_code: 0, verbose_msg: 'Ok', data: [{ ip: '119.219.36.24', location: { country: 'CN' } }] }));
  const result = await handlers[METHOD_QUERY_IP_LOCATION_FULL]({ resource: '119.219.36.24' }, buildCtx());
  assert.equal(result.response_code, 0);
  assert.ok(result.data.includes('CN'));
});

test('maps HTTP failures to gRPC errors', async () => {
  for (const [status, legacyCode] of [[401, 'PERMISSION_DENIED'], [403, 'PERMISSION_DENIED'], [400, 'FAILED_PRECONDITION'], [404, 'FAILED_PRECONDITION'], [429, 'FAILED_PRECONDITION'], [500, 'UNAVAILABLE']]) {
    setFetch(async () => response(status, { response_code: -1, verbose_msg: `status ${status}` }));
    await expectGrpcError(
      () => handlers[METHOD_QUERY_IP_REPUTATION_FULL]({ resource: '8.8.8.8' }, buildCtx()),
      legacyCode,
    );
  }
});

test('network and read errors map to UNAVAILABLE', async () => {
  setFetch(async () => { throw Object.assign(new Error('network error'), { cause: new Error('connection refused') }); });
  await expectGrpcError(
    () => handlers[METHOD_QUERY_IP_REPUTATION_FULL]({ resource: '8.8.8.8' }, buildCtx()),
    'UNAVAILABLE',
  );

  setFetch(async () => ({ status: 200, text: async () => { throw new Error('read failed'); } }));
  await expectGrpcError(
    () => handlers[METHOD_QUERY_IP_REPUTATION_FULL]({ resource: '8.8.8.8' }, buildCtx()),
    'UNAVAILABLE',
  );
});

test('all non-IP RPCs expose upstream failure mapping', async () => {
  const cases = [
    [METHOD_QUERY_DNS_COMPROMISED_FULL, { resource: 'evil.com' }, 403, 'PERMISSION_DENIED'],
    [METHOD_QUERY_FILE_REPUTATION_FULL, { resource: 'abc123' }, 404, 'FAILED_PRECONDITION'],
    [METHOD_QUERY_VULNERABILITY_FULL, { vuln_id: 'CVE-2024-1234' }, 429, 'FAILED_PRECONDITION'],
    [METHOD_QUERY_IP_LOCATION_FULL, { resource: '119.219.36.24' }, 500, 'UNAVAILABLE'],
  ];

  for (const [method, request, status, legacyCode] of cases) {
    setFetch(async () => response(status, { response_code: -1, verbose_msg: `status ${status}` }));
    await expectGrpcError(
      () => handlers[method](request, buildCtx()),
      legacyCode,
      (err) => assert.match(err.message, new RegExp(`upstream http ${status}`)),
    );
  }
});

test('token auth computes correct HMAC-SHA1 signature', async () => {
  const token = await _test.computeToken('mykey', '1700000000', 'mysalt');
  const expected = crypto.createHmac('sha1', 'mysalt').update('mykey1700000000').digest('base64url');
  assert.equal(token, expected);
});

test('buildAuthQuery includes token when auth_mode is token', async () => {
  const query = await _test.buildAuthQuery('mykey', { auth_mode: 'token', salt: 'mysalt' });
  assert.equal(query.apikey, 'mykey');
  assert.ok(query.timestamp);
  assert.ok(query.token);
});

test('buildAuthQuery rejects token mode without salt', async () => {
  await assert.rejects(
    () => _test.buildAuthQuery('mykey', { auth_mode: 'token' }),
    { message: /salt is required/ },
  );
});

test('parseNgTipResponse extracts response_code, verbose_msg, data', () => {
  const parsed = _test.parseNgTipResponse('{"response_code":0,"verbose_msg":"Ok","data":[1,2]}');
  assert.equal(parsed.responseCode, 0);
  assert.equal(parsed.verboseMsg, 'Ok');
  assert.equal(parsed.data, '[1,2]');
});

test('parseNgTipResponse handles invalid JSON gracefully', () => {
  const parsed = _test.parseNgTipResponse('not json');
  assert.equal(parsed.responseCode, 0);
  assert.equal(parsed.verboseMsg, '');
  assert.equal(parsed.data, '');
});

test('rpcdef falls back to context request', async () => {
  setFetch(async () => response(200, { response_code: 0, verbose_msg: 'Ok', data: [] }));
  const result = await rpcdef(buildCtx({ req: { resource: '9.9.9.9' } }))[METHOD_QUERY_IP_REPUTATION_PATH]();
  assert.equal(result.response_code, 0);
});

test('mock upstream integration for all 5 endpoints', async () => {
  const server = await createMockServer();
  try {
    const ctx = buildCtx({ config: { ngtip_domain: server.url } });

    const ip = await handlers[METHOD_QUERY_IP_REPUTATION_FULL]({ resource: '8.8.8.8' }, ctx);
    assert.equal(ip.response_code, 0);
    assert.ok(ip.data.includes('malicious'));

    const dns = await handlers[METHOD_QUERY_DNS_COMPROMISED_FULL]({ resource: 'evil.com' }, ctx);
    assert.equal(dns.response_code, 0);

    const hash = await handlers[METHOD_QUERY_FILE_REPUTATION_FULL]({ resource: 'abc123' }, ctx);
    assert.equal(hash.response_code, 0);

    const vuln = await handlers[METHOD_QUERY_VULNERABILITY_FULL]({ vuln_id: 'CVE-9999-0000' }, ctx);
    assert.equal(vuln.response_code, 0);

    const loc = await handlers[METHOD_QUERY_IP_LOCATION_FULL]({ resource: '119.219.36.24' }, ctx);
    assert.equal(loc.response_code, 0);

    assert.equal(server.requests[0].path, '/tip_api/v5/ip');
    assert.equal(server.requests[1].path, '/tip_api/v5/dns');
    assert.equal(server.requests[2].path, '/tip_api/v5/hash');
    assert.equal(server.requests[3].path, '/tip_api/v5/vuln');
    assert.equal(server.requests[4].path, '/tip_api/v5/location');
  } finally {
    await server.close();
  }
});

test('helper functions', async () => {
  assert.equal(_test.grpcCodeFor('NOPE'), grpcStatus.UNKNOWN);
  assert.equal(_test.normalizeBaseUrl('ftp://bad'), '');
  assert.equal(_test.normalizeBaseUrl(' http://10.0.0.1:8090/ '), 'http://10.0.0.1:8090');
  assert.equal(_test.buildTlsOptions({ skipTlsVerify: true }).dispatcher, _test.insecureTlsDispatcher);
  assert.equal(_test.encodeQueryPairs({ a: 'x y', b: '', c: null }), 'a=x%20y');
  assert.equal(_test.mapHttpStatusToCode(401), 'PERMISSION_DENIED');
  assert.equal(_test.mapHttpStatusToCode(500), 'UNAVAILABLE');
  assert.equal(_test.resolveTimeoutMs({}), 5000);
});
