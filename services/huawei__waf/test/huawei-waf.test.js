import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError } from '@chaitin-ai/octobus-sdk';

import {
  handlers,
  _test,
} from '../src/huawei-waf.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

const WAF_BLOCK_RESP = {
  id: 'rule-123',
  policyid: 'policy-1',
  name: 'octo-block-1-2-3-4',
  white: 0,
  addr: '1.2.3.4',
  description: 'blocked by OctoBus',
  timestamp: 1782461726000,
  status: 1,
};

const WAF_LIST_RESP = {
  total: 2,
  items: [
    { id: 'rule-1', addr: '1.2.3.4', name: 'block-test-1', white: 0, description: 'test', timestamp: 1782461726000 },
    { id: 'rule-2', addr: '5.6.7.8', name: 'allow-test-1', white: 1, description: 'whitelist', timestamp: 1782461726000 },
  ],
  size: 2,
};

const WAF_DELETE_RESP = { id: 'rule-123', policyid: 'policy-1' };

const WAF_INSTANCES_RESP = {
  total: 2,
  items: [
    { id: 'inst-1', hostname: 'www.example.com', policyid: 'policy-1', access_code: 'code-1', protect_status: 'OPEN', timestamp: 1782461726000 },
    { id: 'inst-2', hostname: 'api.example.com', policyid: 'policy-2', access_code: 'code-2', protect_status: 'CLOSED', timestamp: 1782461726000 },
  ],
};

const WAF_POLICIES_RESP = {
  total: 1,
  items: [
    { id: 'policy-1', name: 'test-policy', level: 2, action: { category: 'log' }, timestamp: 1782461726000 },
  ],
};

// Context factory
const ctx = (overrides = {}) => ({
  config: {
    project_id: 'proj-123',
    policy_id: 'policy-1',
    endpoint: 'https://waf.cn-north-4.myhuaweicloud.com',
    ...(overrides.config || {}),
  },
  secret: {
    accessKey: 'test-ak',
    secretKey: 'test-sk',
    ...(overrides.secret || {}),
  },
  bindings: { ...(overrides.bindings || {}) },
  limits: { timeoutMs: 2000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
});

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
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

test.beforeEach(() => {
  console.log = () => {};
  console.error = () => {};
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
});

// ---- Service Export ----

test('service exports handlers', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers['Huawei_WAF.Huawei_WAF/BlockIP'], 'function');
  assert.equal(typeof handlers['Huawei_WAF.Huawei_WAF/UnblockIP'], 'function');
  assert.equal(typeof handlers['Huawei_WAF.Huawei_WAF/ListRules'], 'function');
});

// ---- BlockIP ----

test('BlockIP creates blacklist rule', async () => {
  setFetch(async (url, init) => {
    assert.ok(url.includes('waf.cn-north-4.myhuaweicloud.com/v1/proj-123/waf/policy/policy-1/whiteblackip'));
    assert.equal(init.method, 'POST');
    const body = JSON.parse(init.body);
    assert.equal(body.addr, '1.2.3.4');
    assert.equal(body.white, 0);
    return response(200, WAF_BLOCK_RESP);
  });

  const result = await handlers['Huawei_WAF.Huawei_WAF/BlockIP']({ ...ctx(), request: { ip: '1.2.3.4' } });
  assert.equal(result.code, 0);
  assert.equal(result.rule_id, 'rule-123');
});

test('BlockIP supports aliases and custom description', async () => {
  setFetch(async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), { name: 'octo-block-2001:db8::1', white: 0, addr: '2001:db8::1', description: 'incident' });
    return response(201, {});
  });
  const result = await handlers['Huawei_WAF.Huawei_WAF/BlockIP']({ ...ctx(), request: { addr: '2001:db8::1', description: 'incident' } });
  assert.equal(result.rule_id, '');
});

test('BlockIP validates required ip', async () => {
  await expectGrpcError(
    () => handlers['Huawei_WAF.Huawei_WAF/BlockIP']({ ...ctx(), request: {} }),
    'INVALID_ARGUMENT',
  );
});

test('BlockIP validates policy_id', async () => {
  await expectGrpcError(
    () => handlers['Huawei_WAF.Huawei_WAF/BlockIP']({ ...ctx({ config: { project_id: 'proj-123', policy_id: '' } }), request: { ip: '1.2.3.4' } }),
    'FAILED_PRECONDITION',
  );
});

// ---- UnblockIP ----

test('UnblockIP deletes rule', async () => {
  setFetch(async (url, init) => {
    assert.equal(init.method, 'DELETE');
    return response(200, WAF_DELETE_RESP);
  });

  const result = await handlers['Huawei_WAF.Huawei_WAF/UnblockIP']({ ...ctx(), request: { rule_id: 'rule-123' } });
  assert.equal(result.code, 0);
});

test('UnblockIP validates rule_id', async () => {
  await expectGrpcError(
    () => handlers['Huawei_WAF.Huawei_WAF/UnblockIP']({ ...ctx(), request: {} }),
    'INVALID_ARGUMENT',
  );
});

test('UnblockIP validates policy id', async () => {
  await expectGrpcError(() => handlers['Huawei_WAF.Huawei_WAF/UnblockIP']({ ...ctx({ config: { policy_id: '' } }), request: { ruleId: 'r' } }), 'FAILED_PRECONDITION');
});

// ---- ListRules ----

test('ListRules returns rule list', async () => {
  setFetch(async () => response(200, WAF_LIST_RESP));

  const result = await handlers['Huawei_WAF.Huawei_WAF/ListRules']({ ...ctx(), request: {} });
  assert.equal(result.code, 0);
  assert.equal(result.total, 2);
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].ip, '1.2.3.4');
  assert.equal(result.data[0].action, 0);
  assert.equal(result.data[1].action, 1);
});

test('ListRules applies pagination and maps unknown/sparse rules', async () => {
  setFetch(async (url) => {
    assert.match(url, /page=3&pagesize=7/);
    return response(200, { items: [{ white: 9 }] });
  });
  const result = await handlers['Huawei_WAF.Huawei_WAF/ListRules']({ ...ctx(), request: { page: 3, pagesize: 7 } });
  assert.equal(result.total, 1);
  assert.equal(result.data[0].action, 2);
  assert.equal(result.data[0].ip, '');
});

test('ListRules requires policy id', async () => {
  await expectGrpcError(() => handlers['Huawei_WAF.Huawei_WAF/ListRules']({ ...ctx({ config: { policy_id: '' } }), request: {} }), 'FAILED_PRECONDITION');
});

// ---- ListInstances ----

test('service exports ListInstances handler', () => {
  assert.equal(typeof handlers['Huawei_WAF.Huawei_WAF/ListInstances'], 'function');
});

test('ListInstances returns instance list', async () => {
  setFetch(async () => response(200, WAF_INSTANCES_RESP));

  const result = await handlers['Huawei_WAF.Huawei_WAF/ListInstances']({ ...ctx(), request: {} });
  assert.equal(result.code, 0);
  assert.equal(result.total, 2);
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].hostname, 'www.example.com');
  assert.equal(result.data[0].protect_status, 'OPEN');
  assert.equal(result.data[1].hostname, 'api.example.com');
});

test('ListInstances handles sparse response and aliases', async () => {
  setFetch(async (url) => { assert.match(url, /page=2&pagesize=5/); return response(200, { items: [{}] }); });
  const result = await handlers['Huawei_WAF.Huawei_WAF/ListInstances']({ ...ctx(), request: { offset: 2, limit: 5 } });
  assert.equal(result.total, 1);
  assert.equal(result.data[0].hostname, '');
});

// ---- ListPolicies ----

test('service exports ListPolicies handler', () => {
  assert.equal(typeof handlers['Huawei_WAF.Huawei_WAF/ListPolicies'], 'function');
});

test('ListPolicies returns policy list', async () => {
  setFetch(async () => response(200, WAF_POLICIES_RESP));

  const result = await handlers['Huawei_WAF.Huawei_WAF/ListPolicies']({ ...ctx(), request: {} });
  assert.equal(result.code, 0);
  assert.equal(result.total, 1);
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].name, 'test-policy');
  assert.equal(result.data[0].level, 2);
});

test('ListPolicies handles sparse response', async () => {
  setFetch(async () => response(200, { items: [{}] }));
  const result = await handlers['Huawei_WAF.Huawei_WAF/ListPolicies']({ ...ctx(), request: {} });
  assert.equal(result.total, 1);
  assert.equal(result.data[0].action_mode, '');
});

// ---- Credential Validation ----

test('validates required credentials', async () => {
  await expectGrpcError(
    () => handlers['Huawei_WAF.Huawei_WAF/ListRules']({ ...ctx({ secret: { accessKey: '' } }), request: {} }),
    'PERMISSION_DENIED',
  );
  await expectGrpcError(
    () => handlers['Huawei_WAF.Huawei_WAF/ListRules']({ ...ctx({ secret: { accessKey: 'ok', secretKey: '' } }), request: {} }),
    'PERMISSION_DENIED',
  );
});

// ---- HTTP Transport Errors ----

test('handles HTTP transport errors', async () => {
  setFetch(async () => response(403, 'forbidden'));
  await expectGrpcError(
    () => handlers['Huawei_WAF.Huawei_WAF/ListRules']({ ...ctx(), request: {} }),
    'PERMISSION_DENIED',
  );

  setFetch(async () => response(429, 'too many'));
  await expectGrpcError(
    () => handlers['Huawei_WAF.Huawei_WAF/ListRules']({ ...ctx(), request: {} }),
    'UNAVAILABLE',
  );

  setFetch(async () => response(401, 'unauthorized'));
  await expectGrpcError(
    () => handlers['Huawei_WAF.Huawei_WAF/ListRules']({ ...ctx(), request: {} }),
    'PERMISSION_DENIED',
  );

  setFetch(async () => response(400, 'bad request'));
  await expectGrpcError(
    () => handlers['Huawei_WAF.Huawei_WAF/ListRules']({ ...ctx(), request: {} }),
    'FAILED_PRECONDITION',
  );

  setFetch(async () => response(500, 'server error'));
  await expectGrpcError(
    () => handlers['Huawei_WAF.Huawei_WAF/ListRules']({ ...ctx(), request: {} }),
    'UNAVAILABLE',
  );

  setFetch(async () => { throw Object.assign(new Error('outer'), { cause: new Error('timeout') }); });
  await expectGrpcError(
    () => handlers['Huawei_WAF.Huawei_WAF/ListRules']({ ...ctx(), request: {} }),
    'UNAVAILABLE',
  );
});

test('rejects invalid JSON response', async () => {
  setFetch(async () => response(200, '{bad'));
  await expectGrpcError(() => handlers['Huawei_WAF.Huawei_WAF/ListRules']({ ...ctx(), request: {} }), 'UNKNOWN');
});

// ---- Signing ----

test('signHuawei produces valid authorization header', () => {
  const { authorization } = _test.signHuawei('test-ak', 'test-sk', 'POST', '/v1/proj/waf/policy/policy-1/whiteblackip', '', '{"ip":"1.2.3.4"}', '20260626T120000Z', 'waf.cn-north-4.myhuaweicloud.com');
  assert.ok(authorization.startsWith('SDK-HMAC-SHA256 Access='));
  assert.ok(authorization.includes('Signature='));
  assert.ok(authorization.includes('content-type'));
});

test('configured endpoint path and host participate in request signing', async () => {
  setFetch(async (url, init) => {
    assert.match(url, /^http:\/\/127\.0\.0\.1:9876\/proxy\/v1\/proj-123\/waf\/policy/);
    assert.equal(init.headers.Host, '127.0.0.1:9876');
    return response(200, WAF_LIST_RESP);
  });
  await handlers['Huawei_WAF.Huawei_WAF/ListRules']({ ...ctx({ config: { endpoint: 'http://127.0.0.1:9876/proxy/' } }), request: {} });
});

test('rejects malformed endpoint and region configuration', async () => {
  for (const config of [
    { endpoint: 'bad' }, { endpoint: 'http://example.com' }, { endpoint: 'https://u:p@example.com' },
    { endpoint: undefined, region: 'cn/north' },
  ]) await expectGrpcError(() => handlers['Huawei_WAF.Huawei_WAF/ListRules']({ ...ctx({ config }), request: {} }), 'INVALID_ARGUMENT');
});

// ---- Helpers ----

test('helper functions cover value utilities', () => {
  assert.equal(_test.firstDefined(undefined, null, 'x'), 'x');
  assert.equal(_test.unwrapString({ value: { value: 'nested' } }), 'nested');
  assert.equal(_test.unwrapString({ value: { value: { value: { value: { value: { value: { value: { value: { value: { value: { value: 'deep' } } } } } } } } } } }, 0), '');
  assert.equal(_test.unwrapString(null), '');
  assert.equal(_test.unwrapString(undefined), '');
  assert.equal(_test.unwrapString(123), '123');
  assert.equal(_test.toBoolean({ value: 'yes' }), true);
  assert.equal(_test.optionalUint32({ value: '10.9' }), 10);
  assert.equal(_test.optionalUint32(-1), undefined);
  assert.equal(_test.optionalUint32('bad'), undefined);
  assert.equal(_test.toBoolean('no'), false);
  assert.equal(_test.toBoolean(1), true);
  assert.equal(_test.buildCanonicalQueryString({ z: 'a b', a: 1 }), 'a=1&z=a%20b');
  assert.equal(_test.parseJson(''), null);
  assert.equal(_test.ensureTrailingSlash(''), '/');
});

test('resolveCallContext merges config secret and bindings', () => {
  const result = _test.resolveCallContext({
    config: { policy_id: 'p1', project_id: 'proj-1' },
    secret: { accessKey: 'ak-1', secretKey: 'sk-1' },
    bindings: { policy_id: 'override-p' },
    request: { ip: '1.2.3.4' },
  });
  assert.equal(result.bindings.policy_id, 'override-p');
  assert.equal(result.bindings.accessKey, 'ak-1');
  assert.equal(result.bindings.project_id, 'proj-1');
});

test('context and timeout helpers provide safe defaults', () => {
  assert.deepEqual(_test.resolveCallContext(), { bindings: {}, limits: {}, meta: {}, req: {} });
  assert.equal(_test.resolveTimeoutMs({}, { timeoutMs: 50 }), 50);
  assert.equal(_test.resolveTimeoutMs({}, {}), 10000);
  const circular = {}; circular.self = circular;
  _test.logInfo({}, 'test', circular);
  _test.logError({}, 'test', circular);
});
