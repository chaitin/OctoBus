// Automated tests for Chaitin CloudWalker CWPP (牧云主机安全) OctoBus service
// Uses node:test + node:assert with mocked global fetch (no external deps)

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { rpcdef, _test } from '../src/cloudwalker-cwpp.js';
import { GrpcError } from '@chaitin-ai/octobus-sdk';

const MOCK_BASE_URL = 'https://cwpp.test.example.com';
const MOCK_TOKEN = 'mock-api-token-xxxxx';

const makeCtx = (overrides = {}) => ({
  config: { baseUrl: MOCK_BASE_URL, ...overrides.config },
  secret: { token: MOCK_TOKEN, ...overrides.secret },
  bindings: { ...overrides.bindings },
  req: overrides.req ?? {},
  limits: overrides.limits ?? {},
  meta: overrides.meta ?? {},
  ...overrides,
});

const mockFetchSuccess = (result) => {
  const calls = [];
  const mockFetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ jsonrpc: '2.0', id: '0', result }),
    };
  };
  return { mockFetch, calls };
};

const mockFetchRpcError = (code, message) => {
  const calls = [];
  const mockFetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ jsonrpc: '2.0', id: '0', error: { code, message } }),
    };
  };
  return { mockFetch, calls };
};

const mockFetchHttpError = (status, body = '') => {
  const calls = [];
  const mockFetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: false, status, text: async () => body };
  };
  return { mockFetch, calls };
};

let originalFetch;
const installMock = (mockFetch) => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
};
const restoreFetch = () => { globalThis.fetch = originalFetch; };
const parseSentBody = (call) => JSON.parse(call.options.body);

const LRE = '/Chaitin_CloudWalker_CWPP.Chaitin_CloudWalker_CWPP/ListRealTimeEvents';
const GHAL = '/Chaitin_CloudWalker_CWPP.Chaitin_CloudWalker_CWPP/GetHostAssetList';
const GAGT = '/Chaitin_CloudWalker_CWPP.Chaitin_CloudWalker_CWPP/GetAgentGroupTree';

describe('rpcdef — input validation', () => {
  it('throws INVALID_ARGUMENT when token is missing from secret', async () => {
    const ctx = makeCtx({ secret: {}, req: {} });
    await assert.rejects(
      () => rpcdef(ctx)[GHAL](),
      (err) => err instanceof GrpcError && err.code === 3,
    );
  });

  it('throws INVALID_ARGUMENT when baseUrl is missing', async () => {
    const ctx = makeCtx({ config: { baseUrl: '' }, req: {} });
    await assert.rejects(
      () => rpcdef(ctx)[GHAL](),
      (err) => err instanceof GrpcError && err.code === 3,
    );
  });

  it('throws INVALID_ARGUMENT when baseUrl is not http/https', async () => {
    const ctx = makeCtx({ config: { baseUrl: 'ftp://bad' }, req: {} });
    await assert.rejects(
      () => rpcdef(ctx)[GHAL](),
      (err) => err instanceof GrpcError && err.code === 3,
    );
  });
});

describe('GetHostAssetList', () => {
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('constructs correct upstream request: URL, Cookie auth, method, params', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ total: 41, result: [] });
    installMock(mockFetch);

    const ctx = makeCtx({ req: { count: 3, offset: 0 } });
    await rpcdef(ctx)[GHAL]();

    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.equal(call.url, `${MOCK_BASE_URL}/rpc`);
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.headers['Cookie'], `API-Token=${MOCK_TOKEN}`);
    assert.equal(call.options.headers['Authorization'], undefined);

    const body = parseSentBody(call);
    assert.equal(body.method, 'HostAssetService.GetHostAssetList');
    assert.equal(body.jsonrpc, '2.0');
    assert.deepEqual(body.params, { count: 3, offset: 0 });
  });

  it('omits count/offset from params when not provided', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ total: 41, result: [] });
    installMock(mockFetch);

    await rpcdef(makeCtx({ req: {} }))[GHAL]();

    const body = parseSentBody(calls[0]);
    assert.deepEqual(body.params, {});
  });

  it('maps upstream hosts and total', async () => {
    const hosts = [
      { id: 1, host_ip: '10.0.0.2', host_state: 'online' },
      { id: 2, host_ip: '192.168.0.1', host_state: 'offline' },
    ];
    const { mockFetch } = mockFetchSuccess({ total: 41, result: hosts });
    installMock(mockFetch);

    const result = await rpcdef(makeCtx({ req: {} }))[GHAL]();

    assert.equal(result.data.hosts.length, 2);
    assert.deepEqual(result.data.hosts[0], hosts[0]);
    assert.equal(result.data.total, 41);
  });

  it('derives total from hosts length when total missing', async () => {
    const { mockFetch } = mockFetchSuccess({ result: [{ id: 1 }] });
    installMock(mockFetch);

    const result = await rpcdef(makeCtx({ req: {} }))[GHAL]();
    assert.equal(result.data.total, 1);
  });
});

describe('ListRealTimeEvents', () => {
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('constructs correct upstream request with empty params by default', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    await rpcdef(makeCtx({ req: {} }))[LRE]();

    const call = calls[0];
    assert.equal(call.url, `${MOCK_BASE_URL}/rpc`);
    assert.equal(call.options.headers['Cookie'], `API-Token=${MOCK_TOKEN}`);
    const body = parseSentBody(call);
    assert.equal(body.method, 'ThreatOverviewService.ListRealTimeEvents');
    assert.deepEqual(body.params, {});
  });

  it('passes count when provided', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    await rpcdef(makeCtx({ req: { count: 2 } }))[LRE]();

    const body = parseSentBody(calls[0]);
    assert.deepEqual(body.params, { count: 2 });
  });

  it('maps upstream events array', async () => {
    const events = [
      { id: 1440, type: 'brute_force', level: 2, read: false },
      { id: 1439, type: 'brute_force', level: 2, read: false },
    ];
    const { mockFetch } = mockFetchSuccess({ data: events });
    installMock(mockFetch);

    const result = await rpcdef(makeCtx({ req: {} }))[LRE]();
    assert.equal(result.data.events.length, 2);
    assert.deepEqual(result.data.events[0], events[0]);
  });
});

describe('GetAgentGroupTree', () => {
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('sends empty params for GetAgentGroupTree', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ nodes: [] });
    installMock(mockFetch);

    await rpcdef(makeCtx({ req: {} }))[GAGT]();

    const body = parseSentBody(calls[0]);
    assert.equal(body.method, 'AgentService.GetAgentGroupTree');
    assert.deepEqual(body.params, {});
  });

  it('maps upstream nodes array', async () => {
    const nodes = [{ id: 1, name: '根分组', total: 41, children: [] }];
    const { mockFetch } = mockFetchSuccess({ nodes });
    installMock(mockFetch);

    const result = await rpcdef(makeCtx({ req: {} }))[GAGT]();
    assert.equal(result.data.nodes.length, 1);
    assert.deepEqual(result.data.nodes[0], nodes[0]);
  });
});

describe('Error handling', () => {
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('HTTP 401 → PERMISSION_DENIED', async () => {
    const { mockFetch } = mockFetchHttpError(401, 'Unauthorized');
    installMock(mockFetch);
    await assert.rejects(
      () => rpcdef(makeCtx({ req: {} }))[GHAL](),
      (err) => err instanceof GrpcError && err.code === 7,
    );
  });

  it('JSON-RPC code 1 (auth) → PERMISSION_DENIED', async () => {
    const { mockFetch } = mockFetchRpcError(1, 'API Token 已过期');
    installMock(mockFetch);
    await assert.rejects(
      () => rpcdef(makeCtx({ req: {} }))[GHAL](),
      (err) => err instanceof GrpcError && err.code === 7 && err.message.includes('API Token'),
    );
  });

  it('JSON-RPC -32602 → INVALID_ARGUMENT', async () => {
    const { mockFetch } = mockFetchRpcError(-32602, 'Invalid params');
    installMock(mockFetch);
    await assert.rejects(
      () => rpcdef(makeCtx({ req: {} }))[GHAL](),
      (err) => err instanceof GrpcError && err.code === 3,
    );
  });
});

describe('handlers export', () => {
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('contains all three method keys', async () => {
    const { handlers, METHOD_LIST_REALTIME_EVENTS_FULL, METHOD_GET_HOST_ASSET_LIST_FULL, METHOD_GET_AGENT_GROUP_TREE_FULL } = await import('../src/cloudwalker-cwpp.js');
    assert.equal(METHOD_LIST_REALTIME_EVENTS_FULL, 'Chaitin_CloudWalker_CWPP.Chaitin_CloudWalker_CWPP/ListRealTimeEvents');
    assert.equal(METHOD_GET_HOST_ASSET_LIST_FULL, 'Chaitin_CloudWalker_CWPP.Chaitin_CloudWalker_CWPP/GetHostAssetList');
    assert.equal(METHOD_GET_AGENT_GROUP_TREE_FULL, 'Chaitin_CloudWalker_CWPP.Chaitin_CloudWalker_CWPP/GetAgentGroupTree');
    assert.ok(typeof handlers[METHOD_LIST_REALTIME_EVENTS_FULL] === 'function');
    assert.ok(typeof handlers[METHOD_GET_HOST_ASSET_LIST_FULL] === 'function');
    assert.ok(typeof handlers[METHOD_GET_AGENT_GROUP_TREE_FULL] === 'function');
  });

  it('invokes a production handler end-to-end', async () => {
    const { handlers, METHOD_GET_HOST_ASSET_LIST_FULL } = await import('../src/cloudwalker-cwpp.js');
    const { mockFetch } = mockFetchSuccess({ total: 7, result: [{ id: 1 }] });
    installMock(mockFetch);

    const result = await handlers[METHOD_GET_HOST_ASSET_LIST_FULL]({
      config: { baseUrl: MOCK_BASE_URL },
      secret: { token: MOCK_TOKEN },
      request: {},
    });
    assert.equal(result.data.total, 7);
    assert.equal(result.data.hosts.length, 1);
  });
});

describe('helper functions', () => {
  it('toPositiveInt handles numbers, bigint, wrappers, and invalid values', () => {
    assert.equal(_test.toPositiveInt(5), 5);
    assert.equal(_test.toPositiveInt(0), 0);
    assert.equal(_test.toPositiveInt(10n), 10);
    assert.equal(_test.toPositiveInt({ value: 5 }), 5);
    assert.equal(_test.toPositiveInt({ value: { value: 7 } }), 7);
    assert.equal(_test.toPositiveInt(undefined), null);
    assert.equal(_test.toPositiveInt(null), null);
    assert.equal(_test.toPositiveInt('abc'), null);
    assert.equal(_test.toPositiveInt(3.5), null);
    assert.equal(_test.toPositiveInt({}), null);
  });

  it('validateTimeoutMs returns default or positive integer, rejects otherwise', () => {
    assert.equal(_test.validateTimeoutMs(undefined), 30000);
    assert.equal(_test.validateTimeoutMs(5000), 5000);
    assert.throws(() => _test.validateTimeoutMs('abc'), (err) => err.code === 3);
    assert.throws(() => _test.validateTimeoutMs(0), (err) => err.code === 3);
    assert.throws(() => _test.validateTimeoutMs(-5), (err) => err.code === 3);
    assert.throws(() => _test.validateTimeoutMs(1.5), (err) => err.code === 3);
  });

  it('toBoolean coerces booleans, wrappers, and strings', () => {
    assert.equal(_test.toBoolean(true), true);
    assert.equal(_test.toBoolean({ value: false }), false);
    assert.equal(_test.toBoolean('true'), true);
    assert.equal(_test.toBoolean('false'), false);
    assert.equal(_test.toBoolean('yes'), true);
    assert.equal(_test.toBoolean(undefined), false);
    assert.equal(_test.toBoolean(null), false);
  });

  it('normalizeBaseUrl accepts https and loopback http, rejects others', () => {
    assert.equal(_test.normalizeBaseUrl('https://example.com'), 'https://example.com');
    assert.equal(_test.normalizeBaseUrl('https://example.com/'), 'https://example.com');
    assert.equal(_test.normalizeBaseUrl('https://example.com/api/'), 'https://example.com/api');
    assert.equal(_test.normalizeBaseUrl('http://localhost:8080'), 'http://localhost:8080');
    assert.equal(_test.normalizeBaseUrl('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
    assert.equal(_test.normalizeBaseUrl('ftp://bad'), null);
    assert.equal(_test.normalizeBaseUrl('http://example.com'), null);
    assert.equal(_test.normalizeBaseUrl('https://user:pass@example.com'), null);
    assert.equal(_test.normalizeBaseUrl('https://example.com?x=1'), null);
    assert.equal(_test.normalizeBaseUrl('https://example.com#frag'), null);
    assert.equal(_test.normalizeBaseUrl(''), null);
    assert.equal(_test.normalizeBaseUrl('not a url'), null);
  });

  it('parseHeaders handles objects, JSON strings, and junk', () => {
    assert.deepEqual(_test.parseHeaders(undefined), {});
    assert.deepEqual(_test.parseHeaders({ 'X-Foo': 'bar' }), { 'X-Foo': 'bar' });
    assert.deepEqual(_test.parseHeaders('{"X-Foo":"bar"}'), { 'X-Foo': 'bar' });
    assert.deepEqual(_test.parseHeaders('not json'), {});
    assert.deepEqual(_test.parseHeaders('["array"]'), {});
    assert.deepEqual(_test.parseHeaders(42), {});
  });

  it('sanitizeHeaders drops blocked header names', () => {
    assert.deepEqual(_test.sanitizeHeaders({ 'Cookie': 'a', 'X-Foo': 'b' }), { 'X-Foo': 'b' });
    assert.deepEqual(_test.sanitizeHeaders({ 'Content-Type': 'x', 'Host': 'y' }), {});
    assert.deepEqual(_test.sanitizeHeaders({ 'X-A': '1', 'X-B': 2 }), { 'X-A': '1' });
  });

  it('toValue maps JS values to protobuf Value shapes', () => {
    assert.equal(_test.toValue(undefined), undefined);
    assert.equal(_test.toValue(null), undefined);
    assert.deepEqual(_test.toValue('s'), { stringValue: 's' });
    assert.deepEqual(_test.toValue(5), { numberValue: 5 });
    assert.deepEqual(_test.toValue(true), { boolValue: true });
    assert.deepEqual(_test.toValue([1, 'a']), { listValue: { values: [{ numberValue: 1 }, { stringValue: 'a' }] } });
    assert.deepEqual(_test.toValue({ a: 1, b: null }), { structValue: { fields: { a: { numberValue: 1 }, b: { nullValue: 'NULL_VALUE' } } } });
    assert.deepEqual(_test.toValue(10n), { stringValue: '10' });
  });

  it('firstDefined / firstNonEmpty / mergedBindings', () => {
    assert.equal(_test.firstDefined(undefined, null, 5), 5);
    assert.equal(_test.firstNonEmpty(undefined, '', 'x'), 'x');
    assert.deepEqual(_test.mergedBindings({ config: { a: 1 }, secret: { b: 2 }, bindings: { c: 3 } }), { a: 1, b: 2, c: 3 });
  });

  it('resolveCallContext handles ctx/req shapes and inner ctx', () => {
    const { req, ctx } = _test.resolveCallContext({}, { request: { x: 1 } });
    assert.deepEqual(req, { x: 1 });
    assert.ok(ctx);

    const two = _test.resolveCallContext({}, { x: 1 }, { y: 2 });
    assert.deepEqual(two.req, { x: 1 });
    assert.equal(two.ctx.y, 2);

    const viaReq = _test.resolveCallContext({}, { req: { z: 3 } });
    assert.deepEqual(viaReq.req, { z: 3 });
  });

  it('mergeCtx merges bindings/config/secret and picks inner limits/meta', () => {
    const merged = _test.mergeCtx(
      { config: { a: 1, shared: 'base' }, secret: { s: 1 }, bindings: { b: 1 }, limits: { l: 1 }, meta: { m: 1 } },
      { config: { shared: 'inner' }, secret: { s2: 2 }, bindings: { b2: 2 }, limits: { l2: 2 }, meta: { m2: 2 } },
    );
    assert.equal(merged.config.shared, 'inner');
    assert.equal(merged.config.a, 1);
    assert.equal(merged.secret.s2, 2);
    assert.equal(merged.bindings.b2, 2);
    assert.deepEqual(merged.limits, { l2: 2 });
    assert.deepEqual(merged.meta, { m2: 2 });
  });

  it('registerHandlers exposes all three methods', () => {
    const registered = _test.registerHandlers({});
    assert.equal(typeof registered[LRE], 'function');
    assert.equal(typeof registered[GHAL], 'function');
    assert.equal(typeof registered[GAGT], 'function');
  });

  it('errorWithCode produces a GrpcError with legacyCode', () => {
    const err = _test.errorWithCode('UNAVAILABLE', 'boom');
    assert.ok(err instanceof GrpcError);
    assert.equal(err.code, 14);
    assert.equal(err.legacyCode, 'UNAVAILABLE');
    assert.match(err.message, /^UNAVAILABLE: /);
  });

  it('readResponseText rejects oversized content-length', async () => {
    await assert.rejects(
      () => _test.readResponseText({ headers: { get: () => '5000000' } }),
      (err) => err instanceof GrpcError && err.code === 8,
    );
  });

  it('readResponseText decodes a streaming body', async () => {
    const chunks = ['abc', 'def'];
    let i = 0;
    const reader = {
      read: async () => (i < chunks.length ? { done: false, value: new TextEncoder().encode(chunks[i++]) } : { done: true, value: undefined }),
      cancel: async () => {},
    };
    const text = await _test.readResponseText({ headers: { get: () => null }, body: { getReader: () => reader } });
    assert.equal(text, 'abcdef');
  });

  it('readResponseText enforces limit on streaming body', async () => {
    const reader = {
      read: async () => ({ done: false, value: new Uint8Array(5 * 1024 * 1024) }),
      cancel: async () => {},
    };
    await assert.rejects(
      () => _test.readResponseText({ headers: { get: () => null }, body: { getReader: () => reader } }),
      (err) => err instanceof GrpcError && err.code === 8,
    );
  });

  it('readResponseText falls back to text() and enforces limit', async () => {
    assert.equal(await _test.readResponseText({ text: async () => 'hello' }), 'hello');
    await assert.rejects(
      () => _test.readResponseText({ text: async () => 'x'.repeat(5 * 1024 * 1024) }),
      (err) => err instanceof GrpcError && err.code === 8,
    );
  });
});

describe('proxy transport', () => {
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { mock.restoreAll(); globalThis.fetch = originalFetch; });

  const buildFakeRequest = (statusCode, headers, bodyText) => {
    const resListeners = {};
    const reqListeners = {};
    const res = {
      statusCode,
      headers,
      on: (ev, cb) => { resListeners[ev] = cb; return res; },
    };
    const req = {
      setTimeout: (ms, cb) => { reqListeners.timeout = cb; return req; },
      on: (ev, cb) => { reqListeners[ev] = cb; return req; },
      write: () => req,
      end: () => req,
      destroy: (err) => { reqListeners.error?.(err); },
    };
    return {
      req,
      res,
      deliver: () => { resListeners.data?.(Buffer.from(bodyText)); resListeners.end?.(); },
      fail: (err) => reqListeners.error?.(err),
      timeout: () => reqListeners.timeout?.(),
    };
  };

  it('proxiedFetch succeeds over http.request', async () => {
    let captured;
    mock.method(http, 'request', (target, options, cb) => {
      captured = { target, options };
      const f = buildFakeRequest(200, { 'content-type': 'application/json' }, JSON.stringify({ jsonrpc: '2.0', id: '0', result: { total: 3, result: [] } }));
      cb(f.res);
      f.deliver();
      return f.req;
    });

    const ctx = makeCtx({
      config: { baseUrl: 'http://127.0.0.1:8080' },
      bindings: { proxy_url: 'socks5://127.0.0.1:7893' },
      req: {},
    });
    const result = await rpcdef(ctx)[GHAL]();
    assert.equal(result.data.total, 3);
    assert.equal(captured.target.href, 'http://127.0.0.1:8080/rpc');
    assert.equal(captured.options.method, 'POST');
    assert.ok(captured.options.agent);
  });

  it('proxiedFetch maps timeout error to DEADLINE_EXCEEDED', async () => {
    mock.method(http, 'request', (target, options, cb) => {
      const f = buildFakeRequest(200, {}, '');
      cb(f.res);
      setTimeout(() => f.fail(Object.assign(new Error('timeout'), { name: 'TimeoutError', code: 'ETIMEDOUT' })), 5);
      return f.req;
    });

    const ctx = makeCtx({ config: { baseUrl: 'http://127.0.0.1:8080' }, bindings: { proxy_url: 'socks5://127.0.0.1:7893' }, req: {} });
    await assert.rejects(() => rpcdef(ctx)[GHAL](), (err) => err instanceof GrpcError && err.code === 4);
  });

  it('proxiedFetch maps network error to UNAVAILABLE', async () => {
    mock.method(http, 'request', (target, options, cb) => {
      const f = buildFakeRequest(200, {}, '');
      cb(f.res);
      setTimeout(() => f.fail(new Error('ECONNREFUSED')), 5);
      return f.req;
    });

    const ctx = makeCtx({ config: { baseUrl: 'http://127.0.0.1:8080' }, bindings: { proxy_url: 'socks5://127.0.0.1:7893' }, req: {} });
    await assert.rejects(() => rpcdef(ctx)[GHAL](), (err) => err instanceof GrpcError && err.code === 14);
  });
});

describe('transport errors', () => {
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('fetch timeout → DEADLINE_EXCEEDED', async () => {
    const { mockFetch } = { mockFetch: async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); } };
    installMock(mockFetch);
    await assert.rejects(() => rpcdef(makeCtx({ req: {} }))[GHAL](), (err) => err instanceof GrpcError && err.code === 4);
  });

  it('fetch abort → DEADLINE_EXCEEDED', async () => {
    const { mockFetch } = { mockFetch: async () => { throw Object.assign(new Error('a'), { name: 'AbortError' }); } };
    installMock(mockFetch);
    await assert.rejects(() => rpcdef(makeCtx({ req: {} }))[GHAL](), (err) => err instanceof GrpcError && err.code === 4);
  });

  it('fetch network failure → UNAVAILABLE', async () => {
    const { mockFetch } = { mockFetch: async () => { throw new TypeError('fetch failed'); } };
    installMock(mockFetch);
    await assert.rejects(() => rpcdef(makeCtx({ req: {} }))[GHAL](), (err) => err instanceof GrpcError && err.code === 14);
  });

  it('fetch rethrows an existing GrpcError', async () => {
    const { mockFetch } = { mockFetch: async () => { throw _test.errorWithCode('INTERNAL', 'upstream'); } };
    installMock(mockFetch);
    await assert.rejects(() => rpcdef(makeCtx({ req: {} }))[GHAL](), (err) => err instanceof GrpcError && err.code === 13);
  });

  it('HTTP 500 → UNAVAILABLE', async () => {
    const { mockFetch } = mockFetchHttpError(500, 'boom');
    installMock(mockFetch);
    await assert.rejects(() => rpcdef(makeCtx({ req: {} }))[GHAL](), (err) => err instanceof GrpcError && err.code === 14);
  });

  it('HTTP 403 → PERMISSION_DENIED', async () => {
    const { mockFetch } = mockFetchHttpError(403, 'denied');
    installMock(mockFetch);
    await assert.rejects(() => rpcdef(makeCtx({ req: {} }))[GHAL](), (err) => err instanceof GrpcError && err.code === 7);
  });

  it('invalid JSON body → INTERNAL', async () => {
    const { mockFetch } = { mockFetch: async () => ({ ok: true, status: 200, text: async () => 'not json' }) };
    installMock(mockFetch);
    await assert.rejects(() => rpcdef(makeCtx({ req: {} }))[GHAL](), (err) => err instanceof GrpcError && err.code === 13);
  });

  it('JSON-RPC -32600 → INVALID_ARGUMENT', async () => {
    const { mockFetch } = mockFetchRpcError(-32600, 'Invalid Request');
    installMock(mockFetch);
    await assert.rejects(() => rpcdef(makeCtx({ req: {} }))[GHAL](), (err) => err instanceof GrpcError && err.code === 3);
  });

  it('JSON-RPC -32601 → FAILED_PRECONDITION', async () => {
    const { mockFetch } = mockFetchRpcError(-32601, 'Method not found');
    installMock(mockFetch);
    await assert.rejects(() => rpcdef(makeCtx({ req: {} }))[GHAL](), (err) => err instanceof GrpcError && err.code === 9);
  });

  it('JSON-RPC -32000 → INTERNAL', async () => {
    const { mockFetch } = mockFetchRpcError(-32000, 'Server error');
    installMock(mockFetch);
    await assert.rejects(() => rpcdef(makeCtx({ req: {} }))[GHAL](), (err) => err instanceof GrpcError && err.code === 13);
  });

  it('JSON-RPC unknown code → INTERNAL', async () => {
    const { mockFetch } = mockFetchRpcError(999, 'weird');
    installMock(mockFetch);
    await assert.rejects(() => rpcdef(makeCtx({ req: {} }))[GHAL](), (err) => err instanceof GrpcError && err.code === 13);
  });

  it('invalid timeoutMs via limits → INVALID_ARGUMENT', () => {
    assert.throws(() => rpcdef(makeCtx({ limits: { timeoutMs: 'abc' }, req: {} })), (err) => err instanceof GrpcError && err.code === 3);
  });

  it('forwards custom base headers and skipTlsVerify dispatcher', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ total: 1, result: [] });
    installMock(mockFetch);
    const ctx = makeCtx({ config: { baseUrl: MOCK_BASE_URL, headers: { 'X-Custom': 'v1' }, skipTlsVerify: true }, req: {} });
    await rpcdef(ctx)[GHAL]();
    assert.equal(calls[0].options.headers['X-Custom'], 'v1');
    assert.ok(calls[0].options.dispatcher);
  });
});
