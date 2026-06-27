import assert from 'node:assert/strict';
import test from 'node:test';
import { GrpcError } from '@chaitin-ai/octobus-sdk';
import { handlers, _test } from '../src/reportedip.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch, originalCL = console.log, originalCE = console.error;
const CHECK_RESP = { data: { ip: '8.8.8.8', abuseConfidencePercentage: 67, countryCode: 'US', usageType: 'Data Center', isp: 'GOOGLE', domain: 'dns.google', hostnames: ['dns.google'] } };
const ctx = (o = {}) => ({ config: {}, secret: {}, bindings: {}, limits: { timeoutMs: 2000, ...(o.limits || {}) }, meta: { instance_id: 'inst', request_id: 'req', ...(o.meta || {}) } });
const resp = (s, b) => ({ ok: s >= 200 && s < 300, status: s, headers: { get: () => 'application/json' }, text: async () => (typeof b === 'string' ? b : JSON.stringify(b)) });
const setFetch = (i) => { globalThis.fetch = i; };
const expectErr = async (fn, code) => { let c; try { await fn(); } catch (err) { c = err; } assert.ok(c instanceof GrpcError); assert.equal(c.legacyCode, code); };

test.beforeEach(() => { console.log = () => {}; console.error = () => {}; });
test.afterEach(() => { globalThis.fetch = originalFetch; console.log = originalCL; console.error = originalCE; });

test('service exports handlers', () => { assert.equal(typeof handlers['ReportedIP.ReportedIP/CheckIP'], 'function'); });
test('CheckIP returns reputation data', async () => {
  setFetch(async (url) => { assert.ok(url.includes('/check-public')); return resp(200, CHECK_RESP); });
  const r = await handlers['ReportedIP.ReportedIP/CheckIP']({ ...ctx(), request: { ip: '8.8.8.8' } });
  assert.equal(r.code, 0); assert.equal(r.abuse_confidence_percentage, 67); assert.equal(r.isp, 'GOOGLE');
});
test('CheckIP validates ip', async () => { await expectErr(() => handlers['ReportedIP.ReportedIP/CheckIP']({ ...ctx(), request: {} }), 'INVALID_ARGUMENT'); });
test('CheckIP validates IP format', async () => { await expectErr(() => handlers['ReportedIP.ReportedIP/CheckIP']({ ...ctx(), request: { ip: 'not-an-ip' } }), 'INVALID_ARGUMENT'); });
test('handles HTTP errors', async () => {
  setFetch(async () => resp(500, '')); await expectErr(() => handlers['ReportedIP.ReportedIP/CheckIP']({ ...ctx(), request: { ip: '8.8.8.8' } }), 'UNAVAILABLE');
});
test('helper utilities', () => { assert.equal(_test.firstDefined(undefined, null, 'x'), 'x'); });
