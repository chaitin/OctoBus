import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import { handlers, _test } from '../src/threatbook-onesig-policy-api.js';
import { createMockUpstream } from './mock_upstream.js';

const PREFIX = 'threatbook.onesig.policy.v1.OneSigPolicyService';

const ctx = (baseUrl) => ({
  config: { baseUrl, allowInsecureHttp: true },
  secret: { apiKey: 'demo-key', secret: 'demo-secret' },
});

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
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

test('each retained RPC signs and sends its documented request to mock upstream', async () => {
  const upstream = createMockUpstream();
  const baseUrl = await upstream.start();
  try {
    const cases = [
      ['ListAssetGroups', { query: { pageNo: '1' } }, 'GET', '/api/v3/asset/group', ''],
      ['ListAssets', { payloadJson: JSON.stringify({ pageNo: 1, pageSize: 20 }) }, 'POST', '/api/v3/asset/list', '{"pageNo":1,"pageSize":20}'],
      ['ListGlobalWhitelist', { query: { pageNo: '1' } }, 'POST', '/api/v3/globalWhitelist/list', '{"pageNo":"1"}'],
      ['ListGlobalBlacklist', { query: { pageNo: '2' } }, 'POST', '/api/v3/globalBlacklist/list', '{"pageNo":"2"}'],
      ['CreateGlobalBlacklist', { payloadJson: JSON.stringify({ blacklist: [{ object: '1.1.1.1', direction: 'in' }] }) }, 'POST', '/api/v3/globalBlacklist/create', '{"blacklist":[{"object":"1.1.1.1","direction":"in"}]}'],
      ['ListHttpBlacklist', { query: { pageNo: '3' } }, 'POST', '/api/v3/httpBlacklist/list', '{"pageNo":"3"}'],
      ['CreateHttpBlacklist', { payloadJson: JSON.stringify({ blacklist: [{ object: '2.2.2.2' }] }) }, 'POST', '/api/v3/httpBlacklist/create', '{"blacklist":[{"object":"2.2.2.2"}]}'],
    ];
    for (const [name, request, method, path, body] of cases) {
      const result = await handlers[`${PREFIX}/${name}`]({ ...ctx(baseUrl), request });
      const actual = upstream.requests.at(-1);
      assert.equal(result.status, 200, name);
      assert.equal(actual.method, method, name);
      assert.equal(actual.path, path, name);
      assert.equal(actual.body, body, name);
      assert.equal(actual.query.apikey, 'demo-key', name);
      assert.ok(actual.query.timestamp, name);
      assert.ok(actual.query.sign, name);
    }
  } finally {
    await upstream.close();
  }
});

const rejectsWithStatus = async (fn, status, pattern) => {
  try {
    await fn();
  } catch (err) {
    assert.ok(err instanceof GrpcError);
    assert.equal(err.code, status);
    assert.match(err.message, pattern);
    return;
  }
  assert.fail(`expected rejection matching ${pattern}`);
};

test('rejects invalid input and protects signed query parameters', async () => {
  await rejectsWithMessage(
    () => handlers[`${PREFIX}/CreateGlobalBlacklist`]({ ...ctx('http://127.0.0.1'), request: { payloadJson: '[' } }),
    /payloadJson/,
  );
  await rejectsWithMessage(
    () => handlers[`${PREFIX}/CreateGlobalBlacklist`]({ config: { baseUrl: 'http://127.0.0.1', allowInsecureHttp: true }, secret: { apiKey: '', secret: 's' }, request: { payloadJson: '{}' } }),
    /apiKey/,
  );
  await rejectsWithStatus(
    () => handlers[`${PREFIX}/ListGlobalBlacklist`]({ ...ctx('https://onesig.example.test'), request: { query: { sign: 'attacker' } } }),
    grpcStatus.INVALID_ARGUMENT,
    /signed parameter sign/,
  );
  await rejectsWithStatus(
    () => handlers[`${PREFIX}/ListGlobalBlacklist`]({ config: { baseUrl: 'http://onesig.example.test' }, secret: { apiKey: 'a', secret: 'b' }, request: {} }),
    grpcStatus.INVALID_ARGUMENT,
    /https/,
  );
  await rejectsWithStatus(
    () => handlers[`${PREFIX}/ListGlobalBlacklist`]({ config: { baseUrl: 'not a url' }, secret: { apiKey: 'a', secret: 'b' }, request: {} }),
    grpcStatus.INVALID_ARGUMENT,
    /valid URL/,
  );
  assert.deepEqual(_test.parsePayload(''), {});
  assert.throws(() => _test.parsePayload('[]'), /payloadJson/);
  assert.throws(() => _test.validateQuery([]), /query/);
  assert.throws(
    () => _test.signedUrl({ bindings: { baseUrl: 'https://onesig.example.test', apiKey: 'a', secret: 'b', timestampPrecision: 'minutes' }, path: '/' }),
    /timestampPrecision/,
  );
  assert.equal(
    _test.signedUrl({ bindings: { baseUrl: 'http://127.0.0.1:8080', apiKey: 'a', secret: 'b' }, path: '/' }).protocol,
    'http:',
  );
});

test('maps upstream HTTP, business, response, network, and timeout failures to gRPC statuses', async () => {
  for (const [httpStatus, grpcCode] of [[401, grpcStatus.PERMISSION_DENIED], [400, grpcStatus.FAILED_PRECONDITION], [500, grpcStatus.UNAVAILABLE]]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ message: 'upstream failed' }), { status: httpStatus });
    await rejectsWithStatus(
      () => handlers[`${PREFIX}/ListAssets`]({ ...ctx('https://onesig.example.test'), request: {} }),
      grpcCode,
      /upstream failed/,
    );
  }

  globalThis.fetch = originalFetch;
  const upstream = createMockUpstream();
  const baseUrl = await upstream.start();
  try {
    await rejectsWithStatus(
      () => handlers[`${PREFIX}/CreateHttpBlacklist`]({ ...ctx(baseUrl), request: { payloadJson: '{}' } }),
      grpcStatus.FAILED_PRECONDITION,
      /business failed/,
    );
  } finally {
    await upstream.close();
  }

  globalThis.fetch = async () => new Response('not json', { status: 200 });
  await rejectsWithStatus(
    () => handlers[`${PREFIX}/ListAssets`]({ ...ctx('https://onesig.example.test'), request: {} }),
    grpcStatus.UNKNOWN,
    /valid JSON/,
  );

  globalThis.fetch = async () => ({ status: 200, text: async () => { throw new Error('read failed'); } });
  await rejectsWithStatus(
    () => handlers[`${PREFIX}/ListAssets`]({ ...ctx('https://onesig.example.test'), request: {} }),
    grpcStatus.UNAVAILABLE,
    /response read failed/,
  );

  globalThis.fetch = async () => { throw new Error('demo-secret must not leak'); };
  await rejectsWithStatus(
    () => handlers[`${PREFIX}/ListAssets`]({ ...ctx('https://onesig.example.test'), request: {} }),
    grpcStatus.UNAVAILABLE,
    /upstream request failed/,
  );

  globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })), { once: true });
  });
  await rejectsWithStatus(
    () => handlers[`${PREFIX}/ListAssets`]({ ...ctx('https://onesig.example.test'), config: { baseUrl: 'https://onesig.example.test', timeoutMs: 1 }, request: {} }),
    grpcStatus.UNAVAILABLE,
    /timed out/,
  );
});

test('uses redirect blocking and documented standard base64 signing', async () => {
  let captured;
  globalThis.fetch = async (_url, init) => {
    captured = init;
    return new Response(JSON.stringify({ responseCode: 0, message: 'ok' }), { status: 200 });
  };
  await handlers[`${PREFIX}/ListAssets`]({ ...ctx('https://onesig.example.test'), request: {} });
  assert.equal(captured.redirect, 'error');
  const url = _test.signedUrl({
    bindings: { baseUrl: 'https://onesig.example.test/', apiKey: 'a', secret: 'b', timestampPrecision: 'milliseconds' },
    path: '/api/v3/test',
    query: { empty: '', included: 'yes' },
  });
  assert.equal(url.searchParams.get('included'), 'yes');
  assert.equal(url.searchParams.has('empty'), false);
  assert.ok(url.searchParams.get('timestamp').length >= 13);
  const sign = _test.signOf({ apiKey: 'a', secret: 'b', timestamp: '1' });
  assert.equal(sign, 'U15juEjtjUHIG7+zabC8w5A6GNo=');
});
