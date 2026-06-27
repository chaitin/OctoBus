import assert from 'node:assert/strict';
import test from 'node:test';
import { GrpcError } from '@chaitin-ai/octobus-sdk';
import { handlers, _test } from '../src/alienvault-otx.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

const IP_GENERAL_RESP = {
  indicator: '8.8.8.8', reputation: 0, asn: 'AS15169 google llc',
  country_name: 'United States of America', country_code: 'US',
  latitude: 37.751, longitude: -97.822,
};
const IP_MALWARE_RESP = { count: 0, results: [] };
const DOMAIN_GENERAL_RESP = { indicator: 'example.com' };
const DOMAIN_MALWARE_RESP = { count: 2, results: [{ hash: 'abc123' }] };

const ctx = (overrides = {}) => ({
  config: {}, secret: {}, bindings: {},
  limits: { timeoutMs: 2000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
});

const response = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: () => 'application/json' },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
const setFetch = (impl) => { globalThis.fetch = impl; };

const expectGrpcError = async (fn, legacyCode) => {
  let caught;
  try { await fn(); } catch (err) { caught = err; }
  assert.ok(caught instanceof GrpcError);
  assert.equal(caught.legacyCode, legacyCode);
};

test.beforeEach(() => { console.log = () => {}; console.error = () => {}; });
test.afterEach(() => { globalThis.fetch = originalFetch; console.log = originalConsoleLog; console.error = originalConsoleError; });

test('service exports handlers', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers['AlienVault_OTX.AlienVault_OTX/CheckIP'], 'function');
  assert.equal(typeof handlers['AlienVault_OTX.AlienVault_OTX/CheckDomain'], 'function');
});

test('CheckIP returns IP intelligence', async () => {
  let callCount = 0;
  setFetch(async (url, init) => {
    callCount++;
    if (url.includes('/general')) return response(200, IP_GENERAL_RESP);
    if (url.includes('/malware')) return response(200, IP_MALWARE_RESP);
    return response(404, '');
  });
  const r = await handlers['AlienVault_OTX.AlienVault_OTX/CheckIP']({ ...ctx(), request: { ip: '8.8.8.8' } });
  assert.equal(r.code, 0); assert.equal(r.ip, '8.8.8.8');
  assert.equal(r.asn, 'AS15169 google llc');
  assert.equal(r.country_code, 'US');
  assert.equal(callCount, 2);
});

test('CheckIP validates ip', async () => {
  await expectGrpcError(() => handlers['AlienVault_OTX.AlienVault_OTX/CheckIP']({ ...ctx(), request: {} }), 'INVALID_ARGUMENT');
});

test('CheckDomain returns domain intelligence', async () => {
  let callCount = 0;
  setFetch(async (url) => {
    callCount++;
    if (url.includes('/general')) return response(200, DOMAIN_GENERAL_RESP);
    if (url.includes('/malware')) return response(200, DOMAIN_MALWARE_RESP);
    return response(404, '');
  });
  const r = await handlers['AlienVault_OTX.AlienVault_OTX/CheckDomain']({ ...ctx(), request: { domain: 'example.com' } });
  assert.equal(r.code, 0); assert.equal(r.domain, 'example.com');
  assert.equal(r.malware_sample_count, 2);
  assert.equal(callCount, 2);
});

test('CheckDomain validates domain', async () => {
  await expectGrpcError(() => handlers['AlienVault_OTX.AlienVault_OTX/CheckDomain']({ ...ctx(), request: {} }), 'INVALID_ARGUMENT');
});

test('maps HTTP errors', async () => {
  setFetch(async () => response(500, 'err'));
  await expectGrpcError(() => handlers['AlienVault_OTX.AlienVault_OTX/CheckIP']({ ...ctx(), request: { ip: '8.8.8.8' } }), 'UNAVAILABLE');
});

test('handles empty response', async () => {
  setFetch(async () => ({ ok: true, status: 200, headers: { get: () => 'text/plain' }, text: async () => '' }));
  const r = await handlers['AlienVault_OTX.AlienVault_OTX/CheckDomain']({ ...ctx(), request: { domain: 'test.com' } });
  assert.equal(r.code, 0);
});

test('helper utilities', () => {
  assert.equal(_test.firstDefined(undefined, null, 'x'), 'x');
  assert.equal(_test.unwrapString({ value: { value: 'nested' } }), 'nested');
});
