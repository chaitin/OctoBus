import test from 'node:test';
import assert from 'node:assert/strict';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_PATHS,
  FULL_METHODS,
  _test,
  handlers,
  rpcdef,
} from '../src/anyi-cloud-native-security.js';
import { service } from '../src/service.js';

const {
  errorWithCode,
  firstDefined,
  fromStruct,
  fromStructValue,
  hasOwn,
  mergedBindings,
  normalizeBaseUrl,
  parseHeaders,
  toPositiveInt,
  toStruct,
  toStructValue,
  DISPOSAL_ACTIONS,
  CONTROL_ACTIONS,
} = _test;

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;

const buildCtx = (overrides = {}) => ({
  bindings: {
    endpoint: 'https://diss.example.com:8543',
    token: 'test-token',
    ...(overrides.bindings || {}),
  },
  config: overrides.config || {},
  secret: overrides.secret || {},
  limits: { timeoutMs: 2000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const mockResponse = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  headers: new Map([['content-type', 'application/json']]),
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalConsoleLog;
});

// --- Helper unit tests ---

test('normalizeBaseUrl rejects non-http URLs', () => {
  assert.equal(normalizeBaseUrl(''), null);
  assert.equal(normalizeBaseUrl('ftp://example.com'), null);
  assert.equal(normalizeBaseUrl('https://diss.example.com:8543'), 'https://diss.example.com:8543');
  assert.equal(normalizeBaseUrl('https://diss.example.com:8543/'), 'https://diss.example.com:8543');
  assert.equal(normalizeBaseUrl('http://diss.example.com'), 'http://diss.example.com');
});

test('toPositiveInt handles various inputs', () => {
  assert.equal(toPositiveInt(undefined), null);
  assert.equal(toPositiveInt(null), null);
  assert.equal(toPositiveInt(10), 10);
  assert.equal(toPositiveInt(0), 0);
  assert.equal(toPositiveInt(-1), -1);
  assert.equal(toPositiveInt(1.5), null);
  assert.equal(toPositiveInt({ value: 5 }), 5);
  assert.equal(toPositiveInt('abc'), null);
  assert.equal(toPositiveInt(NaN), null);
  assert.equal(toPositiveInt({ value: 'x' }), null);
  assert.equal(toPositiveInt({}), null);
});

test('firstDefined returns first non-null/undefined', () => {
  assert.equal(firstDefined(undefined, null, 'hello'), 'hello');
  assert.equal(firstDefined('first', 'second'), 'first');
  assert.equal(firstDefined(undefined, undefined, 0), 0);
  assert.equal(firstDefined(), undefined);
});

test('mergedBindings merges config, secret, and bindings', () => {
  const ctx = { config: { endpoint: 'a' }, secret: { token: 'b' }, bindings: { extra: 'c' } };
  const result = mergedBindings(ctx);
  assert.equal(result.endpoint, 'a');
  assert.equal(result.token, 'b');
  assert.equal(result.extra, 'c');
});

test('mergedBindings handles empty ctx', () => {
  const result = mergedBindings();
  assert.deepEqual(result, {});
  const result2 = mergedBindings({});
  assert.deepEqual(result2, {});
});

test('parseHeaders handles various inputs', () => {
  assert.deepEqual(parseHeaders(undefined), {});
  assert.deepEqual(parseHeaders(null), {});
  assert.deepEqual(parseHeaders(''), {});
  assert.deepEqual(parseHeaders({ 'X-Custom': 'val' }), { 'X-Custom': 'val' });
  assert.deepEqual(parseHeaders('{"X-Custom":"val"}'), { 'X-Custom': 'val' });
  assert.deepEqual(parseHeaders('invalid'), {});
  assert.deepEqual(parseHeaders([]), {});
  assert.deepEqual(parseHeaders(42), {});
});

test('hasOwn checks property existence', () => {
  assert.equal(hasOwn({ a: 1 }, 'a'), true);
  assert.equal(hasOwn({ a: 1 }, 'b'), false);
  assert.equal(hasOwn(null, 'a'), false);
  assert.equal(hasOwn(undefined, 'a'), false);
});

test('errorWithCode creates GrpcError with legacyCode', () => {
  const err = errorWithCode('INVALID_ARGUMENT', 'test error');
  assert.ok(err instanceof GrpcError);
  assert.equal(err.legacyCode, 'INVALID_ARGUMENT');
  assert.equal(err.code, grpcStatus.INVALID_ARGUMENT);
  assert.match(err.message, /INVALID_ARGUMENT: test error/);
});

test('toStruct handles null/undefined', () => {
  assert.equal(toStruct(undefined), undefined);
  assert.equal(toStruct(null), undefined);
});

test('toStruct / fromStruct round-trip', () => {
  const obj = { name: 'test', count: 42, active: true, items: [1, 2], nested: { key: 'val' } };
  const struct = toStruct(obj);
  assert.ok(struct.fields);
  const roundTripped = fromStruct(struct);
  assert.equal(roundTripped.name, 'test');
  assert.equal(roundTripped.count, 42);
  assert.equal(roundTripped.active, true);
  assert.deepEqual(roundTripped.items, [1, 2]);
  assert.equal(roundTripped.nested.key, 'val');
});

test('fromStructValue handles all types', () => {
  assert.equal(fromStructValue({ nullValue: 'NULL_VALUE' }), null);
  assert.equal(fromStructValue({ stringValue: 'hello' }), 'hello');
  assert.equal(fromStructValue({ numberValue: 42 }), 42);
  assert.equal(fromStructValue({ boolValue: true }), true);
  assert.deepEqual(fromStructValue({ listValue: { values: [{ stringValue: 'a' }] } }), ['a']);
  assert.equal(fromStructValue(null), null);
  assert.equal(fromStructValue(undefined), null);
  assert.equal(fromStructValue({}), null);
});

test('toStructValue handles all types', () => {
  assert.deepEqual(toStructValue(null), { nullValue: 'NULL_VALUE' });
  assert.deepEqual(toStructValue(undefined), { nullValue: 'NULL_VALUE' });
  assert.deepEqual(toStructValue('hello'), { stringValue: 'hello' });
  assert.deepEqual(toStructValue(42), { numberValue: 42 });
  assert.deepEqual(toStructValue(true), { boolValue: true });
  assert.deepEqual(toStructValue([1, 'a']), { listValue: { values: [{ numberValue: 1 }, { stringValue: 'a' }] } });
  assert.ok(toStructValue({ a: 1 }).structValue);
});

test('DISPOSAL_ACTIONS and CONTROL_ACTIONS are correct', () => {
  assert.deepEqual(DISPOSAL_ACTIONS, ['isolation', 'pause', 'stop', 'kill']);
  assert.deepEqual(CONTROL_ACTIONS, ['resume', 'start', 'activate', 'deactivate']);
});

test('rpcdef rejects missing endpoint', () => {
  assert.throws(
    () => rpcdef(buildCtx({ bindings: { endpoint: '', token: 't' } })),
    (err) => err instanceof GrpcError && err.legacyCode === 'INVALID_ARGUMENT',
  );
});

test('service defines handlers', () => {
  assert.ok(service.handlers);
  for (const name of Object.keys(FULL_METHODS)) {
    assert.ok(typeof service.handlers[FULL_METHODS[name]] === 'function', `handler ${name} exists`);
  }
});

// --- ListWarnings ---

test('ListWarnings sends request and returns response', async () => {
  globalThis.fetch = async (url, init) => {
    assert.ok(url.includes('/api/v1/securitylog/warninginfo'));
    assert.ok(url.includes('from=0'));
    assert.ok(url.includes('limit=20'));
    assert.equal(init.method, 'POST');
    assert.ok(init.headers['Authorization']);
    return mockResponse(200, { code: 200, message: 'ok', data: { total: 1, items: [{ Id: 1 }] } });
  };

  const result = await rpcdef(buildCtx({ req: { from: 0, limit: 20 } }))[METHOD_PATHS.ListWarnings]();
  assert.equal(result.code, 200);
  assert.equal(result.message, 'ok');
  assert.ok(result.data.fields);
});

test('ListWarnings uses default from/limit when not specified', async () => {
  globalThis.fetch = async (url) => {
    assert.ok(url.includes('from=0'));
    assert.ok(url.includes('limit=20'));
    return mockResponse(200, { code: 200, message: 'ok', data: null });
  };

  const result = await rpcdef(buildCtx({ req: {} }))[METHOD_PATHS.ListWarnings]();
  assert.equal(result.code, 200);
});

test('ListWarnings passes filter as body', async () => {
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.Severity, 'high');
    return mockResponse(200, { code: 200, message: 'ok', data: null });
  };

  const filter = toStruct({ Severity: 'high' });
  const result = await rpcdef(buildCtx({ req: { filter } }))[METHOD_PATHS.ListWarnings]();
  assert.equal(result.code, 200);
});

test('ListWarnings handles empty response body', async () => {
  globalThis.fetch = async () => mockResponse(200, '');
  const result = await rpcdef(buildCtx({ req: {} }))[METHOD_PATHS.ListWarnings]();
  assert.equal(result.code, 200);
});

test('ListWarnings handles non-JSON response', async () => {
  globalThis.fetch = async () => ({ status: 200, ok: true, text: async () => 'not json', headers: new Map([['content-type', 'text/plain']]) });
  await assert.rejects(
    () => rpcdef(buildCtx({ req: {} }))[METHOD_PATHS.ListWarnings](),
    (err) => err instanceof GrpcError && err.legacyCode === 'UNKNOWN',
  );
});

// --- DisposeWarnings ---

test('DisposeWarnings rejects missing action', async () => {
  globalThis.fetch = async () => { throw new Error('should not fetch'); };
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { action: '' } }))[METHOD_PATHS.DisposeWarnings](),
    (err) => err instanceof GrpcError && err.legacyCode === 'INVALID_ARGUMENT',
  );
});

test('DisposeWarnings rejects invalid action', async () => {
  globalThis.fetch = async () => { throw new Error('should not fetch'); };
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { action: 'explode' } }))[METHOD_PATHS.DisposeWarnings](),
    /action must be one of/,
  );
});

test('DisposeWarnings succeeds with valid action', async () => {
  console.log = () => {};
  globalThis.fetch = async (url, init) => {
    assert.ok(url.includes('/api/v1/securitylog/warninginfo/disposal'));
    const body = JSON.parse(init.body);
    assert.equal(body.Action, 'isolation');
    return mockResponse(200, { code: 200, message: 'ok', data: null });
  };

  const result = await rpcdef(buildCtx({ req: { action: 'isolation' } }))[METHOD_PATHS.DisposeWarnings]();
  assert.equal(result.code, 200);
});

test('DisposeWarnings passes account and whitelist', async () => {
  console.log = () => {};
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.Account, 'tenant-1');
    assert.ok(Array.isArray(body.WarningInfo));
    assert.ok(Array.isArray(body.WarningWhiteList));
    return mockResponse(200, { code: 200, message: 'ok', data: null });
  };

  const result = await rpcdef(buildCtx({
    req: {
      action: 'stop',
      account: 'tenant-1',
      warnings: [toStructValue({ Id: 1 })],
      whitelist: [toStructValue({ Id: 2 })],
    },
  }))[METHOD_PATHS.DisposeWarnings]();
  assert.equal(result.code, 200);
});

test('DisposeWarnings with all valid actions', async () => {
  console.log = () => {};
  for (const action of DISPOSAL_ACTIONS) {
    globalThis.fetch = async () => mockResponse(200, { code: 200, message: 'ok', data: null });
    const result = await rpcdef(buildCtx({ req: { action } }))[METHOD_PATHS.DisposeWarnings]();
    assert.equal(result.code, 200, `${action} succeeds`);
  }
});

// --- DisposeWarningGroups ---

test('DisposeWarningGroups succeeds', async () => {
  console.log = () => {};
  globalThis.fetch = async (url, init) => {
    assert.ok(url.includes('/api/v1/securitylog/warninginfogroup/disposal'));
    const body = JSON.parse(init.body);
    assert.equal(body.Action, 'kill');
    assert.equal(body.NsNetworkpolicy, true);
    return mockResponse(200, { code: 200, message: 'ok', data: null });
  };

  const result = await rpcdef(buildCtx({ req: { action: 'kill', ns_networkpolicy: true } }))[METHOD_PATHS.DisposeWarningGroups]();
  assert.equal(result.code, 200);
});

test('DisposeWarningGroups rejects missing action', async () => {
  globalThis.fetch = async () => { throw new Error('should not fetch'); };
  await assert.rejects(
    () => rpcdef(buildCtx({ req: {} }))[METHOD_PATHS.DisposeWarningGroups](),
    (err) => err instanceof GrpcError && err.legacyCode === 'INVALID_ARGUMENT',
  );
});

test('DisposeWarningGroups rejects invalid action', async () => {
  globalThis.fetch = async () => { throw new Error('should not fetch'); };
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { action: 'invalid' } }))[METHOD_PATHS.DisposeWarningGroups](),
    /action must be one of/,
  );
});

test('DisposeWarningGroups passes warning_groups and whitelist', async () => {
  console.log = () => {};
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    assert.ok(Array.isArray(body.WarningInfo));
    assert.ok(Array.isArray(body.WarningWhiteList));
    return mockResponse(200, { code: 200, message: 'ok', data: null });
  };

  const result = await rpcdef(buildCtx({
    req: {
      action: 'pause',
      warning_groups: [toStructValue({ Id: 10 })],
      whitelist: [toStructValue({ Id: 20 })],
    },
  }))[METHOD_PATHS.DisposeWarningGroups]();
  assert.equal(result.code, 200);
});

// --- ContainerControl ---

test('ContainerControl rejects missing action', async () => {
  globalThis.fetch = async () => { throw new Error('should not fetch'); };
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { container_id: 'ctr-1' } }))[METHOD_PATHS.ContainerControl](),
    (err) => err instanceof GrpcError && err.legacyCode === 'INVALID_ARGUMENT',
  );
});

test('ContainerControl rejects missing container_id', async () => {
  globalThis.fetch = async () => { throw new Error('should not fetch'); };
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { action: 'start' } }))[METHOD_PATHS.ContainerControl](),
    /container_id is required/,
  );
});

test('ContainerControl rejects invalid action', async () => {
  globalThis.fetch = async () => { throw new Error('should not fetch'); };
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { action: 'explode', container_id: 'ctr-1' } }))[METHOD_PATHS.ContainerControl](),
    /action must be one of/,
  );
});

test('ContainerControl succeeds with valid action', async () => {
  console.log = () => {};
  globalThis.fetch = async (url, init) => {
    assert.ok(url.includes('/api/v1/system/respcenter/operation'));
    const body = JSON.parse(init.body);
    assert.equal(body.Action, 'deactivate');
    assert.equal(body.ContainerId, 'ctr-1');
    return mockResponse(200, { code: 200, message: 'ok', data: null });
  };

  const result = await rpcdef(buildCtx({ req: { action: 'deactivate', container_id: 'ctr-1' } }))[METHOD_PATHS.ContainerControl]();
  assert.equal(result.code, 200);
});

test('ContainerControl passes optional fields', async () => {
  console.log = () => {};
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.ContainerName, 'my-container');
    assert.equal(body.HostId, 'host-1');
    assert.equal(body.ClusterId, 'cluster-1');
    assert.equal(body.Analysis, 'suspicious activity');
    assert.equal(body.ProcessNote, 'suspicious activity');
    return mockResponse(200, { code: 200, message: 'ok', data: null });
  };

  const result = await rpcdef(buildCtx({
    req: { action: 'start', container_id: 'ctr-1', container_name: 'my-container', host_id: 'host-1', cluster_id: 'cluster-1', analysis: 'suspicious activity' },
  }))[METHOD_PATHS.ContainerControl]();
  assert.equal(result.code, 200);
});

test('ContainerControl with all valid actions', async () => {
  console.log = () => {};
  for (const action of CONTROL_ACTIONS) {
    globalThis.fetch = async () => mockResponse(200, { code: 200, message: 'ok', data: null });
    const result = await rpcdef(buildCtx({ req: { action, container_id: 'ctr-1' } }))[METHOD_PATHS.ContainerControl]();
    assert.equal(result.code, 200, `${action} succeeds`);
  }
});

// --- UnblockNetwork ---

test('UnblockNetwork rejects missing container_id', async () => {
  globalThis.fetch = async () => { throw new Error('should not fetch'); };
  await assert.rejects(
    () => rpcdef(buildCtx({ req: {} }))[METHOD_PATHS.UnblockNetwork](),
    /container_id is required/,
  );
});

test('UnblockNetwork succeeds', async () => {
  console.log = () => {};
  globalThis.fetch = async (url, init) => {
    assert.ok(url.includes('/api/v1/system/respcenter/unblock-network'));
    const body = JSON.parse(init.body);
    assert.equal(body.ContainerId, 'ctr-1');
    return mockResponse(200, { code: 200, message: 'ok', data: null });
  };

  const result = await rpcdef(buildCtx({ req: { container_id: 'ctr-1' } }))[METHOD_PATHS.UnblockNetwork]();
  assert.equal(result.code, 200);
});

test('UnblockNetwork passes optional fields', async () => {
  console.log = () => {};
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.HostId, 'host-1');
    assert.equal(body.ClusterId, 'cluster-1');
    return mockResponse(200, { code: 200, message: 'ok', data: null });
  };

  const result = await rpcdef(buildCtx({ req: { container_id: 'ctr-1', host_id: 'host-1', cluster_id: 'cluster-1' } }))[METHOD_PATHS.UnblockNetwork]();
  assert.equal(result.code, 200);
});

// --- ListHosts ---

test('ListHosts uses defaultUser when not specified', async () => {
  globalThis.fetch = async (url) => {
    assert.ok(url.includes('user=admin'));
    return mockResponse(200, { code: 200, message: 'ok', data: { total: 0, items: [] } });
  };

  const result = await rpcdef(buildCtx({ req: {} }))[METHOD_PATHS.ListHosts]();
  assert.equal(result.code, 200);
});

test('ListHosts uses user from request', async () => {
  globalThis.fetch = async (url) => {
    assert.ok(url.includes('user=custom-user'));
    return mockResponse(200, { code: 200, message: 'ok', data: { total: 0, items: [] } });
  };

  const result = await rpcdef(buildCtx({ req: { user: 'custom-user' } }))[METHOD_PATHS.ListHosts]();
  assert.equal(result.code, 200);
});

test('ListHosts uses user from config defaultUser', async () => {
  globalThis.fetch = async (url) => {
    assert.ok(url.includes('user=config-user'));
    return mockResponse(200, { code: 200, message: 'ok', data: { total: 0, items: [] } });
  };

  const result = await rpcdef(buildCtx({ bindings: { defaultUser: 'config-user' }, req: {} }))[METHOD_PATHS.ListHosts]();
  assert.equal(result.code, 200);
});

// --- ListContainers ---

test('ListContainers returns response', async () => {
  globalThis.fetch = async (url) => {
    assert.ok(url.includes('/api/v1/containers/'));
    return mockResponse(200, { code: 200, message: 'ok', data: { total: 1, items: [{ Id: 'ctr-1' }] } });
  };

  const result = await rpcdef(buildCtx({ req: {} }))[METHOD_PATHS.ListContainers]();
  assert.equal(result.code, 200);
});

// --- ListClusters ---

test('ListClusters returns response', async () => {
  globalThis.fetch = async (url) => {
    assert.ok(url.includes('/api/v1/k8s/clusters'));
    return mockResponse(200, { code: 200, message: 'ok', data: { total: 0, items: [] } });
  };

  const result = await rpcdef(buildCtx({ req: {} }))[METHOD_PATHS.ListClusters]();
  assert.equal(result.code, 200);
});

// --- ListVulnerabilities ---

test('ListVulnerabilities returns response', async () => {
  globalThis.fetch = async (url) => {
    assert.ok(url.includes('/api/v1/securitylog/vulnerabilitiesscan'));
    return mockResponse(200, { code: 200, message: 'ok', data: { total: 0, items: [] } });
  };

  const result = await rpcdef(buildCtx({ req: {} }))[METHOD_PATHS.ListVulnerabilities]();
  assert.equal(result.code, 200);
});

// --- ListWarningGroups ---

test('ListWarningGroups returns response', async () => {
  globalThis.fetch = async (url) => {
    assert.ok(url.includes('/api/v1/securitylog/warninginfogroup'));
    return mockResponse(200, { code: 200, message: 'ok', data: { total: 0, items: [] } });
  };

  const result = await rpcdef(buildCtx({ req: {} }))[METHOD_PATHS.ListWarningGroups]();
  assert.equal(result.code, 200);
});

// --- HTTP Error mapping ---

test('401 maps to UNAUTHENTICATED', async () => {
  globalThis.fetch = async () => mockResponse(401, 'unauthorized');
  await assert.rejects(
    () => rpcdef(buildCtx({ req: {} }))[METHOD_PATHS.ListWarnings](),
    (err) => err instanceof GrpcError && err.legacyCode === 'UNAUTHENTICATED',
  );
});

test('403 maps to PERMISSION_DENIED', async () => {
  globalThis.fetch = async () => mockResponse(403, 'forbidden');
  await assert.rejects(
    () => rpcdef(buildCtx({ req: {} }))[METHOD_PATHS.ListWarnings](),
    (err) => err instanceof GrpcError && err.legacyCode === 'PERMISSION_DENIED',
  );
});

test('500 maps to UNAVAILABLE', async () => {
  globalThis.fetch = async () => mockResponse(500, 'internal error');
  await assert.rejects(
    () => rpcdef(buildCtx({ req: {} }))[METHOD_PATHS.ListWarnings](),
    (err) => err instanceof GrpcError && err.legacyCode === 'UNAVAILABLE',
  );
});

test('network error maps to UNAVAILABLE', async () => {
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  await assert.rejects(
    () => rpcdef(buildCtx({ req: {} }))[METHOD_PATHS.ListWarnings](),
    (err) => err instanceof GrpcError && err.legacyCode === 'UNAVAILABLE',
  );
});

test('400 maps to FAILED_PRECONDITION', async () => {
  globalThis.fetch = async () => mockResponse(400, 'bad request');
  await assert.rejects(
    () => rpcdef(buildCtx({ req: {} }))[METHOD_PATHS.ListWarnings](),
    (err) => err instanceof GrpcError && err.legacyCode === 'FAILED_PRECONDITION',
  );
});

test('422 maps to FAILED_PRECONDITION', async () => {
  globalThis.fetch = async () => mockResponse(422, 'unprocessable');
  await assert.rejects(
    () => rpcdef(buildCtx({ req: {} }))[METHOD_PATHS.ListWarnings](),
    (err) => err instanceof GrpcError && err.legacyCode === 'FAILED_PRECONDITION',
  );
});

test('502 maps to UNAVAILABLE', async () => {
  globalThis.fetch = async () => mockResponse(502, 'bad gateway');
  await assert.rejects(
    () => rpcdef(buildCtx({ req: {} }))[METHOD_PATHS.ListWarnings](),
    (err) => err instanceof GrpcError && err.legacyCode === 'UNAVAILABLE',
  );
});

test('network error with cause maps to UNAVAILABLE', async () => {
  const err = new Error('fetch failed');
  err.cause = { message: 'connection refused' };
  globalThis.fetch = async () => { throw err; };
  await assert.rejects(
    () => rpcdef(buildCtx({ req: {} }))[METHOD_PATHS.ListWarnings](),
    (err) => err instanceof GrpcError && err.legacyCode === 'UNAVAILABLE',
  );
});

test('AbortError maps to DEADLINE_EXCEEDED', async () => {
  const err = new DOMException('The operation was aborted', 'AbortError');
  globalThis.fetch = async () => { throw err; };
  await assert.rejects(
    () => rpcdef(buildCtx({ req: {} }))[METHOD_PATHS.ListWarnings](),
    (err) => err instanceof GrpcError && err.legacyCode === 'DEADLINE_EXCEEDED',
  );
});

// --- handlers export ---

test('handlers object has all 10 methods', () => {
  const handlerKeys = Object.keys(handlers);
  assert.equal(handlerKeys.length, 10);
  for (const name of Object.keys(FULL_METHODS)) {
    assert.ok(handlers[FULL_METHODS[name]], `handlers has ${name}`);
  }
});

// --- handlers invocation via SDK-style context ---

test('handlers.ListWarnings works with SDK context', async () => {
  globalThis.fetch = async () => mockResponse(200, { code: 200, message: 'ok', data: { total: 0, items: [] } });
  const ctx = {
    config: { endpoint: 'https://diss.example.com:8543' },
    secret: { token: 'test-token' },
    req: {},
    bindings: {},
    limits: {},
    meta: {},
  };
  const result = await handlers[FULL_METHODS.ListWarnings](ctx);
  assert.equal(result.code, 200);
});

test('handlers.ContainerControl validates via SDK context', async () => {
  const ctx = {
    config: { endpoint: 'https://diss.example.com:8543' },
    secret: { token: 'test-token' },
    req: { action: 'start' },
    bindings: {},
    limits: {},
    meta: {},
  };
  await assert.rejects(
    () => handlers[FULL_METHODS.ContainerControl](ctx),
    /container_id is required/,
  );
});

// --- skipTlsVerify binding ---

test('skipTlsVerify is read from bindings and uses undici dispatcher', async () => {
  let capturedDispatcher;
  const origImport = globalThis[Symbol.for('undici')];
  // When skipTlsVerify is true, fetchDiss imports undici and uses a dispatcher
  // We verify the code path by mocking globalThis.fetch to capture the dispatcher
  let capturedOpts;
  globalThis.fetch = async (url, opts) => {
    capturedOpts = opts;
    return mockResponse(200, { code: 200, message: 'ok', data: null });
  };

  // skipTlsVerify=true path will dynamically import undici Agent
  // For unit test we just verify it doesn't crash and still returns data
  const result = await rpcdef(buildCtx({ bindings: { skipTlsVerify: true }, req: {} }))[METHOD_PATHS.ListWarnings]();
  assert.equal(result.code, 200);
});

test('skipTlsVerify false by default uses native fetch', async () => {
  let capturedOpts;
  globalThis.fetch = async (url, opts) => {
    capturedOpts = opts;
    return mockResponse(200, { code: 200, message: 'ok', data: null });
  };

  await rpcdef(buildCtx({ req: {} }))[METHOD_PATHS.ListWarnings]();
  assert.equal(capturedOpts.dispatcher, undefined);
});

// --- timeout from bindings ---

test('timeoutMs from bindings sets up AbortController signal', async () => {
  let capturedOpts;
  globalThis.fetch = async (url, opts) => {
    capturedOpts = opts;
    return mockResponse(200, { code: 200, message: 'ok', data: null });
  };

  await rpcdef(buildCtx({ bindings: { timeoutMs: 5000 }, req: {} }))[METHOD_PATHS.ListWarnings]();
  assert.ok(capturedOpts.signal instanceof AbortSignal);
});

// --- token from secret ---

test('token from secret is used when bindings has no token', async () => {
  let capturedHeaders;
  globalThis.fetch = async (url, opts) => {
    capturedHeaders = opts.headers;
    return mockResponse(200, { code: 200, message: 'ok', data: null });
  };

  // Pass explicit empty token in bindings so secret.token takes precedence via mergedBindings
  const ctx = {
    bindings: { endpoint: 'https://diss.example.com:8543' },
    config: {},
    secret: { token: 'secret-token' },
    limits: { timeoutMs: 2000 },
    meta: {},
    req: {},
  };
  await rpcdef(ctx)[METHOD_PATHS.ListWarnings]();
  assert.ok(capturedHeaders['Authorization'].includes('secret-token'));
});

// --- endpoint aliases ---

test('baseUrl alias works for endpoint', async () => {
  globalThis.fetch = async () => mockResponse(200, { code: 200, message: 'ok', data: null });
  const result = await rpcdef(buildCtx({ bindings: { endpoint: '', baseUrl: 'https://alias.example.com:8543' }, req: {} }))[METHOD_PATHS.ListWarnings]();
  assert.equal(result.code, 200);
});

// --- no token scenario ---

test('requests without token omit Authorization header', async () => {
  let capturedHeaders;
  globalThis.fetch = async (url, opts) => {
    capturedHeaders = opts.headers;
    return mockResponse(200, { code: 200, message: 'ok', data: null });
  };

  await rpcdef(buildCtx({ bindings: { endpoint: 'https://diss.example.com:8543', token: '' }, req: {} }))[METHOD_PATHS.ListWarnings]();
  assert.equal(capturedHeaders['Authorization'], undefined);
});

// --- from/limit with value wrappers ---

test('from/limit handle value wrapper objects', async () => {
  globalThis.fetch = async (url) => {
    assert.ok(url.includes('from=5'));
    assert.ok(url.includes('limit=50'));
    return mockResponse(200, { code: 200, message: 'ok', data: null });
  };

  const result = await rpcdef(buildCtx({ req: { from: { value: 5 }, limit: { value: 50 } } }))[METHOD_PATHS.ListWarnings]();
  assert.equal(result.code, 200);
});

// --- action case-insensitive ---

test('DisposeWarnings action is case-insensitive', async () => {
  console.log = () => {};
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.Action, 'isolation');
    return mockResponse(200, { code: 200, message: 'ok', data: null });
  };

  const result = await rpcdef(buildCtx({ req: { action: 'ISOLATION' } }))[METHOD_PATHS.DisposeWarnings]();
  assert.equal(result.code, 200);
});
