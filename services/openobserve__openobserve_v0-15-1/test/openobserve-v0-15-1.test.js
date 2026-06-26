import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError } from '@chaitin-ai/octobus-sdk';
import { handlers } from '../src/openobserve-v0-15-1.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const buildCtx = (overrides = {}) => ({
  config: { baseUrl: 'https://o2.example.com:5080', timeoutMs: 4000, ...(overrides.config || {}) },
  secret: { username: 'admin@openobserve.ai', password: 'changeme', ...(overrides.secret || {}) },
  bindings: overrides.bindings || {},
  req: overrides.req || {},
});

const expectGrpcError = async (fn, legacyCode) => { try { await fn(); assert.fail('expected rejection'); } catch (err) { assert.ok(err instanceof GrpcError); assert.equal(err.legacyCode, legacyCode); } };

test('service exports handlers', () => { assert.equal(typeof service, 'object'); assert.equal(typeof handlers['OpenObserve_v0_15_1.OpenObserve_v0_15_1/ListOrganizations'], 'function'); });

test('ListOrganizations', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['OpenObserve_v0_15_1.OpenObserve_v0_15_1/ListOrganizations']({}, buildCtx({ config: { baseUrl } }));
    assert.equal(result.organizations.length, 2);
    assert.equal(result.organizations[0].name, 'default');
  } finally { await mock.close(); }
});

test('ListStreams requires org_id', async () => { await expectGrpcError(() => handlers['OpenObserve_v0_15_1.OpenObserve_v0_15_1/ListStreams']({}, buildCtx()), 'INVALID_ARGUMENT'); });

test('ListStreams', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['OpenObserve_v0_15_1.OpenObserve_v0_15_1/ListStreams']({ org_id: 'default' }, buildCtx({ config: { baseUrl } }));
    assert.equal(result.streams.length, 2);
    assert.equal(result.streams[0].name, 'logs');
  } finally { await mock.close(); }
});

test('GetStreamSchema requires stream', async () => { await expectGrpcError(() => handlers['OpenObserve_v0_15_1.OpenObserve_v0_15_1/GetStreamSchema']({ org_id: 'default' }, buildCtx()), 'INVALID_ARGUMENT'); });

test('GetStreamSchema', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['OpenObserve_v0_15_1.OpenObserve_v0_15_1/GetStreamSchema']({ org_id: 'default', stream: 'logs' }, buildCtx({ config: { baseUrl } }));
    assert.equal(result.stream, 'logs');
    assert.equal(result.schema.fields.length, 3);
    assert.equal(result.schema.fields[0].name, '@timestamp');
  } finally { await mock.close(); }
});

test('SearchData requires stream and org_id', async () => {
  await expectGrpcError(() => handlers['OpenObserve_v0_15_1.OpenObserve_v0_15_1/SearchData']({}, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => handlers['OpenObserve_v0_15_1.OpenObserve_v0_15_1/SearchData']({ org_id: 'default' }, buildCtx()), 'INVALID_ARGUMENT');
});

test('SearchData returns hits', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['OpenObserve_v0_15_1.OpenObserve_v0_15_1/SearchData']({ org_id: 'default', stream: 'logs', query: 'SELECT * FROM "logs"' }, buildCtx({ config: { baseUrl } }));
    assert.equal(result.total, 2);
    assert.equal(result.hits.length, 2);
    assert.ok(result.hits[0].source_json.includes('hello'));
  } finally { await mock.close(); }
});

test('ListFunctions requires org_id', async () => { await expectGrpcError(() => handlers['OpenObserve_v0_15_1.OpenObserve_v0_15_1/ListFunctions']({}, buildCtx()), 'INVALID_ARGUMENT'); });

test('ListFunctions', async () => {
  const mock = createMockServer(); const baseUrl = await mock.start();
  try {
    const result = await handlers['OpenObserve_v0_15_1.OpenObserve_v0_15_1/ListFunctions']({ org_id: 'default' }, buildCtx({ config: { baseUrl } }));
    assert.equal(result.functions.length, 2);
  } finally { await mock.close(); }
});