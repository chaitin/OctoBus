import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError } from '@chaitin-ai/octobus-sdk';

import {
  handlers,
  _test,
} from '../src/tencent-cfw.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

const CFW_ACL_RESP = {
  Total: 2, AllTotal: 2,
  Data: [
    { Id: 101, SourceIp: '1.1.1.1', TargetIp: '0.0.0.0/0', RuleAction: 'drop', Description: 'blocked by OctoBus', Protocol: 'ANY', Port: '-1/-1' },
    { Id: 102, SourceIp: '2.2.2.2', TargetIp: '10.0.0.0/8', RuleAction: 'drop', Description: 'block by policy', Protocol: 'TCP', Port: '80' },
  ],
  Enable: 0, RequestId: 'req-acl-list',
};

const ctx = (overrides = {}) => ({
  config: { region: 'ap-shanghai', ...(overrides.config || {}) },
  secret: {
    secretId: 'test-secret-id',
    secretKey: 'test-secret-key',
    ...(overrides.secret || {}),
  },
  bindings: { ...(overrides.bindings || {}) },
  limits: { timeoutMs: 2000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
});

const response = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'application/json' : '') },
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
  assert.equal(typeof handlers['Tencent_CFW.Tencent_CFW/ListRules'], 'function');
  assert.equal(typeof handlers['Tencent_CFW.Tencent_CFW/BlockIP'], 'function');
  assert.equal(typeof handlers['Tencent_CFW.Tencent_CFW/UnblockIP'], 'function');
});

test('ListRules returns ACL rules', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), headers: init.headers, body: JSON.parse(init.body) };
    return response(200, { Response: CFW_ACL_RESP });
  });

  const result = await handlers['Tencent_CFW.Tencent_CFW/ListRules']({ ...ctx(), request: { limit: 20 } });
  assert.equal(result.code, 0);
  assert.equal(result.total, 2);
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].source_ip, '1.1.1.1');
  assert.equal(captured.headers['X-TC-Action'], 'DescribeAcLists');
});

test('ListRules sends pagination params', async () => {
  setFetch(async (url, init) => {
    const b = JSON.parse(init.body);
    assert.equal(b.Limit, 10);
    assert.equal(b.Offset, 0);
    return response(200, { Response: { Total: 0, AllTotal: 0, Data: [], Enable: 2, RequestId: 'r' } });
  });
  await handlers['Tencent_CFW.Tencent_CFW/ListRules']({ ...ctx(), request: { limit: 10, offset: 0 } });
});

test('BlockIP requires ips', async () => {
  await expectGrpcError(() => handlers['Tencent_CFW.Tencent_CFW/BlockIP']({ ...ctx(), request: {} }), 'INVALID_ARGUMENT');
  await expectGrpcError(() => handlers['Tencent_CFW.Tencent_CFW/BlockIP']({ ...ctx(), request: { ips: [] } }), 'INVALID_ARGUMENT');
  await expectGrpcError(() => handlers['Tencent_CFW.Tencent_CFW/BlockIP']({ ...ctx(), request: { ips: ['bad-ip'] } }), 'INVALID_ARGUMENT');
});

test('BlockIP sends correct API request', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { body: JSON.parse(init.body), headers: init.headers };
    return response(200, { Response: { RequestId: 'block-ok' } });
  });
  const result = await handlers['Tencent_CFW.Tencent_CFW/BlockIP']({ ...ctx(), request: { ips: ['1.1.1.1'] } });
  assert.equal(result.code, 0);
  assert.equal(captured.headers['X-TC-Action'], 'CreateAcRules');
  assert.equal(captured.body.Data[0].SourceIp, '1.1.1.1');
  assert.equal(captured.body.Data[0].Strategy, 'drop');
});

test('BlockIP validates IPs', async () => {
  await expectGrpcError(() => handlers['Tencent_CFW.Tencent_CFW/BlockIP']({ ...ctx(), request: { ips: ['1.1.1.256'] } }), 'INVALID_ARGUMENT');
  await expectGrpcError(() => handlers['Tencent_CFW.Tencent_CFW/BlockIP']({ ...ctx(), request: { ips: ['not-ip'] } }), 'INVALID_ARGUMENT');
});

test('UnblockIP deletes matching rules', async () => {
  let callCount = 0;
  setFetch(async (url, init) => {
    callCount++;
    const a = init.headers['X-TC-Action'];
    if (a === 'DescribeAcLists') return response(200, { Response: CFW_ACL_RESP });
    if (a === 'DeleteAcRule') return response(200, { Response: { RequestId: 'del-ok' } });
    return response(200, { Response: { Error: { Code: 'Unknown', Message: 'unexpected' } } });
  });
  const result = await handlers['Tencent_CFW.Tencent_CFW/UnblockIP']({ ...ctx(), request: { ips: ['1.1.1.1'] } });
  assert.equal(result.code, 0);
  assert.equal(callCount, 2);
});

test('UnblockIP handles no matches', async () => {
  setFetch(async () => response(200, { Response: { Total: 0, AllTotal: 0, Data: [], Enable: 2, RequestId: 'r' } }));
  const result = await handlers['Tencent_CFW.Tencent_CFW/UnblockIP']({ ...ctx(), request: { ips: ['9.9.9.9'] } });
  assert.equal(result.code, 0);
  assert.equal(result.message, 'no matching rules found');
});

test('validates required credentials', async () => {
  await expectGrpcError(
    () => handlers['Tencent_CFW.Tencent_CFW/ListRules']({ ...ctx({ secret: { secretId: '' } }), request: {} }), 'PERMISSION_DENIED');
  await expectGrpcError(
    () => handlers['Tencent_CFW.Tencent_CFW/ListRules']({ ...ctx({ secret: { secretId: 'ok', secretKey: '' } }), request: {} }), 'PERMISSION_DENIED');
});

test('maps API errors', async () => {
  setFetch(async () => response(200, { Response: { Error: { Code: 'AuthFailure', Message: 'bad' } } }));
  await expectGrpcError(() => handlers['Tencent_CFW.Tencent_CFW/ListRules']({ ...ctx(), request: {} }), 'PERMISSION_DENIED');

  setFetch(async () => response(200, { Response: { Error: { Code: 'FailedOperation', Message: 'failed' } } }));
  await expectGrpcError(() => handlers['Tencent_CFW.Tencent_CFW/ListRules']({ ...ctx(), request: {} }), 'FAILED_PRECONDITION');
});

test('handles HTTP errors', async () => {
  setFetch(async () => response(403, 'x'));
  await expectGrpcError(() => handlers['Tencent_CFW.Tencent_CFW/ListRules']({ ...ctx(), request: {} }), 'PERMISSION_DENIED');
  setFetch(async () => response(500, 'x'));
  await expectGrpcError(() => handlers['Tencent_CFW.Tencent_CFW/ListRules']({ ...ctx(), request: {} }), 'UNAVAILABLE');
  setFetch(async () => { throw Object.assign(new Error('x'), { cause: new Error('t') }); });
  await expectGrpcError(() => handlers['Tencent_CFW.Tencent_CFW/ListRules']({ ...ctx(), request: {} }), 'UNAVAILABLE');
});

test('handles empty responses', async () => {
  setFetch(async () => ({ ok: true, status: 200, headers: { get: () => 'text/plain' }, text: async () => '' }));
  await expectGrpcError(() => handlers['Tencent_CFW.Tencent_CFW/ListRules']({ ...ctx(), request: {} }), 'UNKNOWN');
});

test('helper utilities', () => {
  assert.equal(_test.firstDefined(undefined, null, 'x'), 'x');
  assert.equal(_test.unwrapString({ value: { value: 'nested' } }), 'nested');
  assert.equal(_test.toBoolean({ value: 'yes' }), true);
  assert.equal(_test.optionalUint32({ value: '10.9' }), 10);
});

test('resolveCallContext merges fields', () => {
  const r = _test.resolveCallContext({
    config: { region: 'ap-shanghai' }, secret: { secretId: 'id', secretKey: 'key' },
    bindings: { region: 'ap-guangzhou' }, request: { limit: 10 },
  });
  assert.equal(r.bindings.region, 'ap-guangzhou');
  assert.equal(r.bindings.secretId, 'id');
});

test('signRequest produces valid auth header', () => {
  const r = _test.signRequest('test-id', 'test-key', { foo: 'bar' }, 1000000000);
  assert.ok(r.authorization.startsWith('TC3-HMAC-SHA256'));
  assert.ok(r.authorization.includes('test-id'));
  assert.equal(r.timestamp, 1000000000);
});

test('custom endpoint signs the actual host and path', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, headers: init.headers };
    return response(200, { Response: { Data: [], Total: 0, RequestId: 'r' } });
  });
  await handlers['Tencent_CFW.Tencent_CFW/ListRules']({
    ...ctx({ config: { endpoint: 'http://127.0.0.1:18080/tencent/cfw' } }), request: {},
  });
  assert.equal(captured.url, 'http://127.0.0.1:18080/tencent/cfw');
  assert.equal(captured.headers.Host, '127.0.0.1:18080');
  assert.match(captured.headers.Authorization, /SignedHeaders=content-type;host/);
  assert.notEqual(
    _test.signRequest('id', 'key', {}, 1000).authorization,
    _test.signRequest('id', 'key', {}, 1000, 'proxy.example', '/tenant/cfw').authorization,
  );
});

test('endpoint, region and timeout validation reject unsafe configuration', async () => {
  for (const config of [
    { endpoint: 'not a URL' },
    { endpoint: 'https://user:pass@example.com' },
    { endpoint: 'file:///tmp/socket' },
    { region: '../invalid' },
  ]) {
    await expectGrpcError(() => handlers['Tencent_CFW.Tencent_CFW/ListRules']({ ...ctx({ config }), request: {} }), 'INVALID_ARGUMENT');
  }
  await expectGrpcError(() => handlers['Tencent_CFW.Tencent_CFW/ListRules']({ ...ctx({ limits: { timeoutMs: 120001 } }), request: {} }), 'INVALID_ARGUMENT');
});

test('BlockIP is idempotent and deduplicates requested rules', async () => {
  let creates = 0;
  setFetch(async (url, init) => {
    const action = init.headers['X-TC-Action'];
    if (action === 'DescribeAcLists') {
      return response(200, { Response: { Data: [{ Id: 1, SourceIp: '1.1.1.1' }], Total: 1 } });
    }
    creates += 1;
    const body = JSON.parse(init.body);
    assert.deepEqual(body.Data.map((rule) => rule.SourceIp), ['2.2.2.2']);
    return response(200, { Response: { RequestId: 'created' } });
  });
  const result = await handlers['Tencent_CFW.Tencent_CFW/BlockIP']({
    ...ctx(), request: { ips: ['1.1.1.1', '2.2.2.2', '2.2.2.2'], comment: { value: 'x'.repeat(150) } },
  });
  assert.equal(result.message, 'created');
  assert.equal(creates, 1);

  setFetch(async () => response(200, { Response: { Data: [{ Id: 1, SourceIp: '1.1.1.1' }], Total: 1 } }));
  const noOp = await handlers['Tencent_CFW.Tencent_CFW/BlockIP']({ ...ctx(), request: { ips: ['1.1.1.1'] } });
  assert.equal(noOp.message, 'all IPs are already blocked');
});

test('UnblockIP validates inputs and traverses every result page', async () => {
  await expectGrpcError(() => handlers['Tencent_CFW.Tencent_CFW/UnblockIP']({ ...ctx(), request: { ips: ['300.1.1.1'] } }), 'INVALID_ARGUMENT');
  const offsets = [];
  let deleted;
  setFetch(async (url, init) => {
    const action = init.headers['X-TC-Action'];
    const body = JSON.parse(init.body);
    if (action === 'DescribeAcLists') {
      offsets.push(body.Offset);
      const Data = body.Offset === 0
        ? Array.from({ length: 100 }, (_, index) => ({ Id: index + 1, SourceIp: '8.8.8.8' }))
        : [{ Id: 101, SourceIp: '9.9.9.9' }];
      return response(200, { Response: { Data } });
    }
    deleted = body.Id;
    return response(200, { Response: { RequestId: 'deleted' } });
  });
  const result = await handlers['Tencent_CFW.Tencent_CFW/UnblockIP']({ ...ctx(), request: { ips: ['9.9.9.9'] } });
  assert.deepEqual(offsets, [0, 100]);
  assert.equal(deleted, 101);
  assert.equal(result.message, 'deleted 1 rules');
});

test('TLS dispatcher is reused and upstream error bodies are bounded and redacted', async () => {
  const first = _test.buildTlsOptions({ skipTlsVerify: true });
  const second = _test.buildTlsOptions({ tlsInsecureSkipVerify: 'yes' });
  assert.ok(first.dispatcher);
  assert.equal(first.dispatcher, second.dispatcher);
  assert.deepEqual(_test.buildTlsOptions({}), {});

  setFetch(async () => response(502, `secretKey=do-not-leak ${'x'.repeat(500)}`));
  let caught;
  try { await handlers['Tencent_CFW.Tencent_CFW/ListRules']({ ...ctx(), request: {} }); } catch (error) { caught = error; }
  assert.ok(caught);
  assert.doesNotMatch(caught.message, /do-not-leak/);
  assert.ok(caught.message.length < 300);
});

test('malformed JSON and numeric helper edge cases are deterministic', async () => {
  setFetch(async () => response(200, 'not-json'));
  await expectGrpcError(() => handlers['Tencent_CFW.Tencent_CFW/ListRules']({ ...ctx(), request: {} }), 'UNKNOWN');
  assert.equal(_test.optionalUint32('bad'), undefined);
  assert.equal(_test.optionalUint32(0), undefined);
  assert.equal(_test.toBoolean(1), true);
  assert.equal(_test.toBoolean('off'), false);
  assert.equal(_test.toBoolean({}), false);
});
