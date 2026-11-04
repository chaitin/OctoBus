// Automated tests for Chaitin CloudWalker CWPP (牧云主机安全) OctoBus service
// Uses node:test + node:assert with mocked global fetch (no external deps)

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { rpcdef } from '../src/cloudwalker-cwpp.js';
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
  it('contains all three method keys', async () => {
    const { handlers, METHOD_LIST_REALTIME_EVENTS_FULL, METHOD_GET_HOST_ASSET_LIST_FULL, METHOD_GET_AGENT_GROUP_TREE_FULL } = await import('../src/cloudwalker-cwpp.js');
    assert.equal(METHOD_LIST_REALTIME_EVENTS_FULL, 'Chaitin_CloudWalker_CWPP.Chaitin_CloudWalker_CWPP/ListRealTimeEvents');
    assert.equal(METHOD_GET_HOST_ASSET_LIST_FULL, 'Chaitin_CloudWalker_CWPP.Chaitin_CloudWalker_CWPP/GetHostAssetList');
    assert.equal(METHOD_GET_AGENT_GROUP_TREE_FULL, 'Chaitin_CloudWalker_CWPP.Chaitin_CloudWalker_CWPP/GetAgentGroupTree');
    assert.ok(typeof handlers[METHOD_LIST_REALTIME_EVENTS_FULL] === 'function');
    assert.ok(typeof handlers[METHOD_GET_HOST_ASSET_LIST_FULL] === 'function');
    assert.ok(typeof handlers[METHOD_GET_AGENT_GROUP_TREE_FULL] === 'function');
  });
});
