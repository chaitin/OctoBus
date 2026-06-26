import assert from 'node:assert/strict';
import test from 'node:test';

import { handlers, _test } from '../src/threatbook-onesig-policy-api.js';
import { createMockUpstream } from './mock_upstream.js';

const PREFIX = 'threatbook.onesig.policy.v1.OneSigPolicyService';

const ctx = (baseUrl) => ({
  config: { baseUrl, allowInsecureHttp: true },
  secret: { apiKey: 'demo-key', secret: 'demo-secret' },
});

const rejectsWithMessage = async (fn, pattern) => {
  try {
    await fn();
  } catch (err) {
    assert.match(String(err?.message ?? err), pattern);
    return;
  }
  assert.fail(`expected rejection matching ${pattern}`);
};

test('exports expected handlers', () => {
  assert.equal(Object.keys(_test.operationMap).length, 7);
  for (const name of Object.keys(_test.operationMap)) {
    assert.equal(typeof handlers[`${PREFIX}/${name}`], 'function', name);
  }
  assert.equal(handlers[`${PREFIX}/GenericSignedRequest`], undefined);
});

test('signs and sends global blacklist requests to mock upstream', async () => {
  const upstream = createMockUpstream();
  const baseUrl = await upstream.start();
  try {
    const result = await handlers[`${PREFIX}/CreateGlobalBlacklist`]({
      ...ctx(baseUrl),
      request: { payloadJson: JSON.stringify({ blacklist: [{ object: '1.1.1.1', direction: 'in' }] }) },
    });
    assert.equal(result.status, 200);
    assert.match(result.body, /created/);
    assert.equal(upstream.requests.at(-1).method, 'POST');
    assert.equal(upstream.requests.at(-1).path, '/api/v3/globalBlacklist/create');
    assert.equal(upstream.requests.at(-1).query.apikey, 'demo-key');
    assert.ok(upstream.requests.at(-1).query.sign);
  } finally {
    await upstream.close();
  }
});

test('supports retained list requests', async () => {
  const upstream = createMockUpstream();
  const baseUrl = await upstream.start();
  try {
    const list = await handlers[`${PREFIX}/ListGlobalBlacklist`]({
      ...ctx(baseUrl),
      request: { query: { pageNo: '1', pageSize: '20' } },
    });
    assert.equal(list.status, 200);

    const whitelist = await handlers[`${PREFIX}/ListGlobalWhitelist`]({
      ...ctx(baseUrl),
      request: { query: { pageNo: '1', pageSize: '20' } },
    });
    assert.equal(whitelist.status, 200);
  } finally {
    await upstream.close();
  }
});

test('maps validation, permission, business, and network errors', async () => {
  await rejectsWithMessage(
    () => handlers[`${PREFIX}/CreateGlobalBlacklist`]({ ...ctx('http://127.0.0.1'), request: { payloadJson: '[' } }),
    /payloadJson/,
  );
  await rejectsWithMessage(
    () => handlers[`${PREFIX}/CreateGlobalBlacklist`]({ config: { baseUrl: 'http://127.0.0.1', allowInsecureHttp: true }, secret: { apiKey: '', secret: 's' }, request: { payloadJson: '{}' } }),
    /apiKey/,
  );

  const upstream = createMockUpstream();
    const baseUrl = await upstream.start();
  try {
    await rejectsWithMessage(
      () => handlers[`${PREFIX}/CreateHttpBlacklist`]({ ...ctx(baseUrl), request: { payloadJson: '{}' } }),
      /business failed/,
    );
  } finally {
    await upstream.close();
  }

  await rejectsWithMessage(
    () => handlers[`${PREFIX}/ListGlobalBlacklist`]({ ...ctx('http://127.0.0.1:1'), request: {} }),
    /fetch failed|bad port|ECONNREFUSED/,
  );
});

test('helper uses documented standard base64 signing', () => {
  const sign = _test.signOf({ apiKey: 'a', secret: 'b', timestamp: '1' });
  assert.equal(sign, 'U15juEjtjUHIG7+zabC8w5A6GNo=');
});
