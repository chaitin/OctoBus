import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError } from '@chaitin-ai/octobus-sdk';

import {
  handlers,
  _test,
} from '../src/shodan-internetdb.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

const LOOKUP_RESP = {
  ip: '8.8.8.8',
  hostnames: ['dns.google'],
  ports: [53, 443],
  cpes: ['cpe:/a:google:dns'],
  tags: ['cdn'],
  vulns: ['CVE-2023-1234'],
};

const ctx = (overrides = {}) => ({
  config: { ...(overrides.config || {}) },
  secret: { ...(overrides.secret || {}) },
  bindings: { ...(overrides.bindings || {}) },
  limits: { timeoutMs: 2000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
});

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => 'application/json' },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const setFetch = (impl) => { globalThis.fetch = impl; };

const expectGrpcError = async (fn, legacyCode) => {
  let caught;
  try { await fn(); } catch (err) { caught = err; }
  assert.ok(caught, 'expected function to reject');
  assert.ok(caught instanceof GrpcError);
  assert.equal(caught.legacyCode, legacyCode);
  assert.match(caught.message, new RegExp(`^${legacyCode}:`));
};

test.beforeEach(() => { console.log = () => {}; console.error = () => {}; });
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
});

test('service exports handlers', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers['Shodan_InternetDB.Shodan_InternetDB/LookupIP'], 'function');
});

test('LookupIP returns IP intelligence data', async () => {
  setFetch(async (url, init) => {
    assert.ok(url.startsWith('https://internetdb.shodan.io/8.8.8.8'));
    assert.equal(init.method, 'GET');
    return response(200, LOOKUP_RESP);
  });

  const result = await handlers['Shodan_InternetDB.Shodan_InternetDB/LookupIP']({ ...ctx(), request: { ip: '8.8.8.8' } });
  assert.equal(result.code, 0);
  assert.equal(result.ip, '8.8.8.8');
  assert.ok(result.hostnames.includes('dns.google'));
  assert.ok(result.ports.includes(53));
  assert.ok(result.cpes.includes('cpe:/a:google:dns'));
  assert.ok(result.tags.includes('cdn'));
  assert.ok(result.vulns.includes('CVE-2023-1234'));
});

test('LookupIP validates ip', async () => {
  await expectGrpcError(
    () => handlers['Shodan_InternetDB.Shodan_InternetDB/LookupIP']({ ...ctx(), request: {} }),
    'INVALID_ARGUMENT',
  );
});

test('handles empty response', async () => {
  setFetch(async () => ({ ok: true, status: 200, headers: { get: () => 'text/plain' }, text: async () => '' }));
  const result = await handlers['Shodan_InternetDB.Shodan_InternetDB/LookupIP']({ ...ctx(), request: { ip: '1.1.1.1' } });
  assert.equal(result.code, 0);
  assert.equal(result.ip, '1.1.1.1');
});

test('maps HTTP errors', async () => {
  setFetch(async () => response(404, 'not found'));
  await expectGrpcError(
    () => handlers['Shodan_InternetDB.Shodan_InternetDB/LookupIP']({ ...ctx(), request: { ip: '0.0.0.0' } }),
    'FAILED_PRECONDITION',
  );
  setFetch(async () => response(500, 'error'));
  await expectGrpcError(
    () => handlers['Shodan_InternetDB.Shodan_InternetDB/LookupIP']({ ...ctx(), request: { ip: '0.0.0.0' } }),
    'UNAVAILABLE',
  );
});

test('helper utilities', () => {
  assert.equal(_test.firstDefined(undefined, null, 'x'), 'x');
  assert.equal(_test.unwrapString({ value: { value: 'nested' } }), 'nested');
});
