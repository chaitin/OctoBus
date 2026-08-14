// Automated tests for Chaitin Cosmos OctoBus service package
// Uses node:test + node:assert with mocked global fetch (no external deps)

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { rpcdef } from '../src/cosmos.js';
import { GrpcError } from '@chaitin-ai/octobus-sdk';

// ─── Helpers ───

const MOCK_ENDPOINT = 'https://cosmos.test.example.com';
const MOCK_TOKEN = 'jwt-mock-token-xxxxx';

/** Build a minimal ctx object that rpcdef() expects */
const makeCtx = (overrides = {}) => ({
  config: { endpoint: MOCK_ENDPOINT, ...overrides.config },
  secret: { api_token: MOCK_TOKEN, ...overrides.secret },
  bindings: { ...overrides.bindings },
  req: overrides.req ?? {},
  limits: overrides.limits ?? {},
  meta: overrides.meta ?? {},
  ...overrides,
});

/** Create a mock fetch that records calls and returns configurable responses */
const createMockFetch = (responseOverrides = {}) => {
  const calls = [];
  const mockFetch = async (url, options) => {
    calls.push({ url, options });
    const key = `${options?.method}:${url}`;
    const override = responseOverrides[key] ?? responseOverrides['*'];
    if (override) return override;
    // Default: successful JSON-RPC response
    return {
      ok: true,
      status: 200,
      json: async () => ({
        jsonrpc: '2.0',
        id: '0',
        result: { data: [] },
      }),
      text: async () => JSON.stringify({ jsonrpc: '2.0', id: '0', result: { data: [] } }),
    };
  };
  return { mockFetch, calls };
};

/** Create a mock fetch that returns a successful RPC response with given result */
const mockFetchSuccess = (result) => {
  const calls = [];
  const mockFetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: '0', result }),
      text: async () => JSON.stringify({ jsonrpc: '2.0', id: '0', result }),
    };
  };
  return { mockFetch, calls };
};

/** Create a mock fetch that returns an HTTP error */
const mockFetchHttpError = (status, body = '') => {
  const calls = [];
  const mockFetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: false,
      status,
      json: async () => ({ jsonrpc: '2.0', id: '0', result: null }),
      text: async () => body,
    };
  };
  return { mockFetch, calls };
};

/** Create a mock fetch that returns a JSON-RPC error */
const mockFetchRpcError = (code, message) => {
  const calls = [];
  const mockFetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        jsonrpc: '2.0',
        id: '0',
        error: { code, message },
      }),
      text: async () => JSON.stringify({ jsonrpc: '2.0', id: '0', error: { code, message } }),
    };
  };
  return { mockFetch, calls };
};

/** Create a mock fetch that throws a network error */
const mockFetchNetworkError = (message = 'ECONNREFUSED') => {
  const calls = [];
  const mockFetch = async (url, options) => {
    calls.push({ url, options });
    throw new TypeError(`fetch failed: ${message}`);
  };
  return { mockFetch, calls };
};

let originalFetch;

const installMock = (mockFetch) => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
};

const restoreFetch = () => {
  globalThis.fetch = originalFetch;
};

/** Parse the JSON body that was sent to fetch */
const parseSentBody = (call) => JSON.parse(call.options.body);

// ─── Test suites ───

describe('rpcdef — input validation', () => {
  it('throws INVALID_ARGUMENT when api_token is missing from secret', async () => {
    const ctx = makeCtx({ secret: {}, req: {} });
    const defs = rpcdef(ctx);
    await assert.rejects(
      () => defs['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo'](),
      (err) => err instanceof GrpcError && err.code === 3, // INVALID_ARGUMENT
    );
  });

  it('throws INVALID_ARGUMENT when endpoint is missing', async () => {
    const ctx = makeCtx({ config: { endpoint: '' }, secret: { api_token: MOCK_TOKEN }, req: {} });
    const defs = rpcdef(ctx);
    await assert.rejects(
      () => defs['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo'](),
      (err) => err instanceof GrpcError && err.code === 3,
    );
  });

  it('throws INVALID_ARGUMENT when endpoint is not http/https', async () => {
    const ctx = makeCtx({ config: { endpoint: 'ftp://bad' }, secret: { api_token: MOCK_TOKEN }, req: {} });
    const defs = rpcdef(ctx);
    await assert.rejects(
      () => defs['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo'](),
      (err) => err instanceof GrpcError && err.code === 3,
    );
  });
});

describe('SearchLogInfo', () => {
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('constructs correct upstream request with ids array', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({ req: { ids: ['log-001', 'log-002'] } });
    const defs = rpcdef(ctx);
    await defs['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo']();

    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.equal(call.url, `${MOCK_ENDPOINT}/pedestal/rpc`);
    assert.equal(call.options.method, 'POST');

    const body = parseSentBody(call);
    assert.equal(body.method, 'LogService.SearchLogInfo');
    assert.equal(body.jsonrpc, '2.0');
    assert.deepEqual(body.params.ids, ['log-001', 'log-002']);
  });

  it('sends correct headers: Authorization, Content-Type, x-menu-name, x-request-path', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({ req: { ids: ['id1'] } });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo']();

    const headers = calls[0].options.headers;
    assert.equal(headers['Authorization'], `bearer ${MOCK_TOKEN}`);
    assert.equal(headers['Content-Type'], 'application/json');
    assert.equal(headers['x-menu-name'], '31');
    assert.equal(headers['x-request-path'], 'pedestal');
  });

  it('merges custom headers from config', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({
      config: { endpoint: MOCK_ENDPOINT, headers: { 'X-Custom': 'yes' } },
      req: { ids: ['id1'] },
    });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo']();

    const headers = calls[0].options.headers;
    assert.equal(headers['X-Custom'], 'yes');
    assert.equal(headers['Authorization'], `bearer ${MOCK_TOKEN}`);
  });

  it('maps upstream response data array to records', async () => {
    const upstreamData = [
      { log_id: 'log-001', src_ip: '1.2.3.4', event: 'scan' },
      { log_id: 'log-002', src_ip: '5.6.7.8', event: 'exploit' },
    ];
    const { mockFetch } = mockFetchSuccess({ data: upstreamData });
    installMock(mockFetch);

    const ctx = makeCtx({ req: { ids: ['log-001', 'log-002'] } });
    const result = await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo']();

    assert.equal(result.data.records.length, 2);
    assert.deepEqual(result.data.records[0].raw, upstreamData[0]);
    assert.deepEqual(result.data.records[1].raw, upstreamData[1]);
  });

  it('handles empty data array from upstream', async () => {
    const { mockFetch } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({ req: { ids: ['nonexistent'] } });
    const result = await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo']();

    assert.equal(result.data.records.length, 0);
  });

  it('handles missing data field in upstream response', async () => {
    const { mockFetch } = mockFetchSuccess({});
    installMock(mockFetch);

    const ctx = makeCtx({ req: { ids: ['id1'] } });
    const result = await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo']();

    assert.equal(result.data.records.length, 0);
  });

  it('throws INVALID_ARGUMENT when ids is missing', async () => {
    const ctx = makeCtx({ req: {} });
    const defs = rpcdef(ctx);
    await assert.rejects(
      () => defs['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo'](),
      (err) => err instanceof GrpcError && err.code === 3 && err.message.includes('ids'),
    );
  });

  it('throws INVALID_ARGUMENT when ids is empty array', async () => {
    const ctx = makeCtx({ req: { ids: [] } });
    const defs = rpcdef(ctx);
    await assert.rejects(
      () => defs['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo'](),
      (err) => err instanceof GrpcError && err.code === 3,
    );
  });

  it('accepts ids as a single string (wrapped in array)', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({ req: { ids: 'single-id' } });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo']();

    const body = parseSentBody(calls[0]);
    assert.deepEqual(body.params.ids, ['single-id']);
  });

  it('uses api_token from ctx.secret (not from request)', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    // Token comes from secret only — request-level api_token is ignored
    const ctx = makeCtx({ req: { ids: ['id1'] } });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo']();

    const headers = calls[0].options.headers;
    assert.equal(headers['Authorization'], `bearer ${MOCK_TOKEN}`);
  });

  it('uses api_token from secret bindings', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({
      secret: { api_token: 'secret-token' },
      req: { ids: ['id1'] },
    });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo']();

    const headers = calls[0].options.headers;
    assert.equal(headers['Authorization'], 'bearer secret-token');
  });

  it('rejects when secret has no api_token', async () => {
    const ctx = makeCtx({ secret: {}, req: { ids: ['id1'] } });
    const defs = rpcdef(ctx);
    await assert.rejects(
      () => defs['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo'](),
      (err) => err instanceof GrpcError && err.code === 3 && err.message.includes('api_token'),
    );
  });
});

describe('SearchLogList', () => {
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('validates token and endpoint before calling upstream', async () => {
    await assert.rejects(
      () => rpcdef(makeCtx({ secret: {} }))['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList'](),
      (err) => err instanceof GrpcError && err.code === 3 && err.message.includes('api_token'),
    );
    await assert.rejects(
      () => rpcdef(makeCtx({ config: { endpoint: '' } }))['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList'](),
      (err) => err instanceof GrpcError && err.code === 3 && err.message.includes('endpoint'),
    );
  });

  it('constructs minimal request with only required fields', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({ req: {} });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList']();

    const body = parseSentBody(calls[0]);
    assert.equal(body.method, 'LogService.SearchLogList');
    // Empty keyword array should not be sent (Cosmos treats [] as no-match)
    assert.equal(body.params.keyword, undefined);
  });

  it('maps keyword string to array', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({ req: { keyword: 'suspicious' } });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList']();

    const body = parseSentBody(calls[0]);
    assert.deepEqual(body.params.keyword, ['suspicious']);
  });

  it('passes keyword array directly', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({ req: { keyword: ['attack', 'scan'] } });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList']();

    const body = parseSentBody(calls[0]);
    assert.deepEqual(body.params.keyword, ['attack', 'scan']);
  });

  it('skips empty keyword array', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({ req: { keyword: [] } });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList']();

    const body = parseSentBody(calls[0]);
    assert.equal(body.params.keyword, undefined);
  });

  it('throws INVALID_ARGUMENT for invalid keyword type', async () => {
    const ctx = makeCtx({ req: { keyword: 12345 } });
    const defs = rpcdef(ctx);
    await assert.rejects(
      () => defs['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList'](),
      (err) => err instanceof GrpcError && err.code === 3 && err.message.includes('keyword'),
    );
  });

  it('maps time_range_start and time_range_end', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({ req: { time_range_start: '1700000000', time_range_end: '1700086400' } });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList']();

    const body = parseSentBody(calls[0]);
    assert.equal(body.params.time_range_start, 1700000000);
    assert.equal(body.params.time_range_end, 1700086400);
  });

  it('handles Int64Value wrapper for time_range_start', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({ req: { time_range_start: { value: 1700000000 } } });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList']();

    const body = parseSentBody(calls[0]);
    assert.equal(body.params.time_range_start, 1700000000);
  });

  it('maps advanced_query', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({ req: { advanced_query: 'src_ip:1.2.3.4 AND dest_port:80' } });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList']();

    const body = parseSentBody(calls[0]);
    assert.equal(body.params.advanced_query, 'src_ip:1.2.3.4 AND dest_port:80');
  });

  it('maps condition_query with expressions', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({
      req: {
        condition_query: {
          logical_op: 'OR',
          expressions: [
            { column: 'src_ip', op: 'equal', value: '1.2.3.4' },
            { column: 'dest_port', op: 'contains', value: '443' },
          ],
        },
      },
    });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList']();

    const body = parseSentBody(calls[0]);
    assert.equal(body.params.condition_query.logical_op, 'OR');
    assert.equal(body.params.condition_query.expressions.length, 2);
    assert.equal(body.params.condition_query.expressions[0].column, 'src_ip');
    assert.equal(body.params.condition_query.expressions[0].op, 'equal');
    assert.equal(body.params.condition_query.expressions[0].value, '1.2.3.4');
  });

  it('condition_query defaults logical_op to AND when omitted', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({
      req: { condition_query: { expressions: [{ column: 'src_ip', op: 'equal', value: '10.0.0.1' }] } },
    });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList']();

    const body = parseSentBody(calls[0]);
    assert.equal(body.params.condition_query.logical_op, 'AND');
  });

  it('condition_query defaults op to "equal" and value to "" when omitted', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({ req: { condition_query: { expressions: [{ column: 'src_ip' }] } } });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList']();

    const body = parseSentBody(calls[0]);
    assert.equal(body.params.condition_query.expressions[0].op, 'equal');
    assert.equal(body.params.condition_query.expressions[0].value, '');
  });

  it('maps filter with all array fields', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({
      req: {
        filter: {
          origin_event_name: ['WAF'],
          src_ip: ['1.2.3.4', '5.6.7.8'],
          dest_ip: ['9.10.11.12'],
          src_country: ['CN'],
          src_port: ['80'],
          dest_port: ['443'],
          attack_result: [1, 2],
        },
      },
    });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList']();

    const body = parseSentBody(calls[0]);
    const f = body.params.filter;
    assert.deepEqual(f.origin_event_name, ['WAF']);
    assert.deepEqual(f.src_ip, ['1.2.3.4', '5.6.7.8']);
    assert.deepEqual(f.dest_ip, ['9.10.11.12']);
    assert.deepEqual(f.src_country, ['CN']);
    assert.deepEqual(f.src_port, ['80']);
    assert.deepEqual(f.dest_port, ['443']);
    assert.deepEqual(f.attack_result, [1, 2]);
  });

  it('filter sets non-array values to null', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({
      req: { filter: { src_ip: 'not-an-array' } },
    });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList']();

    const body = parseSentBody(calls[0]);
    assert.equal(body.params.filter.src_ip, null);
  });

  it('maps pagination: count and offset', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({ req: { count: '50', offset: '100' } });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList']();

    const body = parseSentBody(calls[0]);
    assert.equal(body.params.count, 50);
    assert.equal(body.params.offset, 100);
  });

  it('maps attack_chain_phase', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({ req: { attack_chain_phase: 'recon' } });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList']();

    const body = parseSentBody(calls[0]);
    assert.equal(body.params.attack_chain_phase, 'recon');
  });

  it('maps fall (BoolValue)', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({ req: { fall: true } });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList']();

    const body = parseSentBody(calls[0]);
    assert.equal(body.params.fall, true);
  });

  it('maps fall as BoolValue wrapper { value: true }', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({ req: { fall: { value: true } } });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList']();

    const body = parseSentBody(calls[0]);
    assert.equal(body.params.fall, true);
  });

  it('maps organization with oper and target', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({
      req: { organization: [{ oper: '=', target: '42' }, { target: '99' }] },
    });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList']();

    const body = parseSentBody(calls[0]);
    assert.equal(body.params.organization.length, 2);
    assert.equal(body.params.organization[0].oper, '=');
    assert.equal(body.params.organization[0].target, 42);
    assert.equal(body.params.organization[1].oper, '=');
    assert.equal(body.params.organization[1].target, 99);
  });

  it('skips empty organization array', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({ req: { organization: [] } });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList']();

    const body = parseSentBody(calls[0]);
    assert.equal(body.params.organization, undefined);
  });

  it('maps response with flat array data', async () => {
    const upstreamData = [
      { log_id: 'l1', src_ip: '1.1.1.1' },
      { log_id: 'l2', src_ip: '2.2.2.2' },
    ];
    const { mockFetch } = mockFetchSuccess({ data: upstreamData, start_time: 1700000000, end_time: 1700086400 });
    installMock(mockFetch);

    const ctx = makeCtx({ req: {} });
    const result = await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList']();

    assert.equal(result.data.records.length, 2);
    assert.deepEqual(result.data.records[0].raw, upstreamData[0]);
    assert.equal(result.data.start_time, 1700000000);
    assert.equal(result.data.end_time, 1700086400);
  });

  it('maps response with nested object data (records key)', async () => {
    const upstreamResult = {
      data: {
        records: [{ log_id: 'l1' }, { log_id: 'l2' }],
        start_time: 1700000000,
        end_time: 1700086400,
      },
    };
    const { mockFetch } = mockFetchSuccess(upstreamResult);
    installMock(mockFetch);

    const ctx = makeCtx({ req: {} });
    const result = await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList']();

    assert.equal(result.data.records.length, 2);
    assert.equal(result.data.start_time, 1700000000);
    assert.equal(result.data.end_time, 1700086400);
  });

  it('maps response with nested object data (list key)', async () => {
    const upstreamResult = {
      data: {
        list: [{ log_id: 'l1' }],
        start_time: 1700000000,
        end_time: 1700086400,
      },
    };
    const { mockFetch } = mockFetchSuccess(upstreamResult);
    installMock(mockFetch);

    const ctx = makeCtx({ req: {} });
    const result = await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList']();

    assert.equal(result.data.records.length, 1);
  });

  it('handles a response without a data field', async () => {
    const { mockFetch } = mockFetchSuccess({});
    installMock(mockFetch);

    const result = await rpcdef(makeCtx())['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList']();

    assert.deepEqual(result.data, { records: [], start_time: 0, end_time: 0 });
  });

  it('handles all request parameters together (kitchen sink)', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({
      req: {
        keyword: ['attack'],
        time_range_start: 1700000000,
        time_range_end: 1700086400,
        advanced_query: 'src_ip:1.2.3.4',
        condition_query: {
          logical_op: 'AND',
          expressions: [{ column: 'src_ip', op: 'equal', value: '1.2.3.4' }],
        },
        filter: { src_ip: ['1.2.3.4'], attack_result: [1] },
        count: 50,
        offset: 0,
        attack_chain_phase: 'exploit',
        fall: false,
        organization: [{ oper: '=', target: 1 }],
      },
    });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList']();

    const body = parseSentBody(calls[0]);
    assert.deepEqual(body.params.keyword, ['attack']);
    assert.equal(body.params.time_range_start, 1700000000);
    assert.equal(body.params.time_range_end, 1700086400);
    assert.equal(body.params.advanced_query, 'src_ip:1.2.3.4');
    assert.ok(body.params.condition_query);
    assert.ok(body.params.filter);
    assert.equal(body.params.count, 50);
    assert.equal(body.params.offset, 0);
    assert.equal(body.params.attack_chain_phase, 'exploit');
    assert.equal(body.params.fall, false);
    assert.ok(body.params.organization);
  });
});

describe('SearchAggregationStatistics', () => {
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('validates token and endpoint before calling upstream', async () => {
    await assert.rejects(
      () => rpcdef(makeCtx({ secret: {} }))['/Chaitin_COSMOS.Chaitin_COSMOS/SearchAggregationStatistics'](),
      (err) => err instanceof GrpcError && err.code === 3 && err.message.includes('api_token'),
    );
    await assert.rejects(
      () => rpcdef(makeCtx({ config: { endpoint: '' } }))['/Chaitin_COSMOS.Chaitin_COSMOS/SearchAggregationStatistics'](),
      (err) => err instanceof GrpcError && err.code === 3 && err.message.includes('endpoint'),
    );
  });
  it('constructs correct upstream request', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [], total: 0 });
    installMock(mockFetch);

    const ctx = makeCtx({ req: { key: ['src_ip', 'dest_ip'] } });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchAggregationStatistics']();

    const body = parseSentBody(calls[0]);
    assert.equal(body.method, 'LogService.SearchAggregationStatistics');
    assert.deepEqual(body.params.key, ['src_ip', 'dest_ip']);
  });

  it('maps key as string array', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [], total: 0 });
    installMock(mockFetch);

    const ctx = makeCtx({ req: { key: ['event_type'] } });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchAggregationStatistics']();

    const body = parseSentBody(calls[0]);
    assert.deepEqual(body.params.key, ['event_type']);
  });

  it('throws INVALID_ARGUMENT when key is not an array', async () => {
    const ctx = makeCtx({ req: { key: 'not-array' } });
    const defs = rpcdef(ctx);
    await assert.rejects(
      () => defs['/Chaitin_COSMOS.Chaitin_COSMOS/SearchAggregationStatistics'](),
      (err) => err instanceof GrpcError && err.code === 3 && err.message.includes('key'),
    );
  });

  it('maps count and asc', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [], total: 0 });
    installMock(mockFetch);

    const ctx = makeCtx({ req: { key: ['src_ip'], count: '20', asc: true } });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchAggregationStatistics']();

    const body = parseSentBody(calls[0]);
    assert.equal(body.params.count, 20);
    assert.equal(body.params.asc, true);
  });

  it('maps asc as BoolValue wrapper', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [], total: 0 });
    installMock(mockFetch);

    const ctx = makeCtx({ req: { key: ['src_ip'], asc: { value: true } } });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchAggregationStatistics']();

    const body = parseSentBody(calls[0]);
    assert.equal(body.params.asc, true);
  });

  it('maps flat array aggregation response', async () => {
    const upstreamData = [
      {
        result: { src_ip: '1.2.3.4', event_type: 52001 },
        data: [{ start_time: 1700000000, count: 42 }, { start_time: 1700003600, count: 15 }],
        count: 57,
      },
    ];
    const { mockFetch } = mockFetchSuccess({ data: upstreamData, total: 1 });
    installMock(mockFetch);

    const ctx = makeCtx({ req: { key: ['src_ip', 'event_type'] } });
    const result = await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchAggregationStatistics']();

    assert.equal(result.data.groups.length, 1);
    assert.deepEqual(result.data.groups[0].result, { src_ip: '1.2.3.4', event_type: 52001 });
    assert.equal(result.data.groups[0].data.length, 2);
    assert.equal(result.data.groups[0].data[0].start_time, 1700000000);
    assert.equal(result.data.groups[0].data[0].count, 42);
    assert.equal(result.data.groups[0].count, 57);
    assert.equal(result.data.total, 1);
  });

  it('maps nested object aggregation response (groups key)', async () => {
    const upstreamResult = {
      data: {
        groups: [{ result: { src_ip: '5.5.5.5' }, data: [], count: 0 }],
        total: 1,
      },
    };
    const { mockFetch } = mockFetchSuccess(upstreamResult);
    installMock(mockFetch);

    const ctx = makeCtx({ req: { key: ['src_ip'] } });
    const result = await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchAggregationStatistics']();

    assert.equal(result.data.groups.length, 1);
    assert.deepEqual(result.data.groups[0].result, { src_ip: '5.5.5.5' });
    assert.equal(result.data.total, 1);
  });

  it('handles empty aggregation response', async () => {
    const { mockFetch } = mockFetchSuccess({ data: [], total: 0 });
    installMock(mockFetch);

    const ctx = makeCtx({ req: { key: ['src_ip'] } });
    const result = await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchAggregationStatistics']();

    assert.equal(result.data.groups.length, 0);
    assert.equal(result.data.total, 0);
  });

  it('handles an aggregation response without a data field', async () => {
    const { mockFetch } = mockFetchSuccess({});
    installMock(mockFetch);

    const result = await rpcdef(makeCtx({ req: { key: ['src_ip'] } }))['/Chaitin_COSMOS.Chaitin_COSMOS/SearchAggregationStatistics']();

    assert.deepEqual(result.data, { groups: [], total: 0 });
  });

  it('shares same parameter mapping as SearchLogList (keyword, time, filter, etc.)', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [], total: 0 });
    installMock(mockFetch);

    const ctx = makeCtx({
      req: {
        keyword: ['attack'],
        time_range_start: 1700000000,
        time_range_end: 1700086400,
        advanced_query: 'severity:high',
        condition_query: {
          logical_op: 'AND',
          expressions: [{ column: 'src_ip', op: 'equal', value: '1.2.3.4' }],
        },
        filter: { src_ip: ['1.2.3.4'] },
        key: ['src_ip'],
        count: 10,
        asc: false,
        attack_chain_phase: 'recon',
        fall: true,
        organization: [{ oper: '=', target: 5 }],
      },
    });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchAggregationStatistics']();

    const body = parseSentBody(calls[0]);
    assert.deepEqual(body.params.keyword, ['attack']);
    assert.equal(body.params.time_range_start, 1700000000);
    assert.equal(body.params.time_range_end, 1700086400);
    assert.equal(body.params.advanced_query, 'severity:high');
    assert.ok(body.params.condition_query);
    assert.ok(body.params.filter);
    assert.deepEqual(body.params.key, ['src_ip']);
    assert.equal(body.params.count, 10);
    assert.equal(body.params.asc, false);
    assert.equal(body.params.attack_chain_phase, 'recon');
    assert.equal(body.params.fall, true);
    assert.ok(body.params.organization);
  });
});

describe('Error handling — upstream HTTP errors', () => {
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('401 → PERMISSION_DENIED (gRPC code 7)', async () => {
    const { mockFetch } = mockFetchHttpError(401, 'Unauthorized');
    installMock(mockFetch);

    const ctx = makeCtx({ req: { ids: ['id1'] } });
    await assert.rejects(
      () => rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo'](),
      (err) => err instanceof GrpcError && err.code === 7,
    );
  });

  it('403 → PERMISSION_DENIED (gRPC code 7)', async () => {
    const { mockFetch } = mockFetchHttpError(403, 'Forbidden');
    installMock(mockFetch);

    const ctx = makeCtx({ req: { ids: ['id1'] } });
    await assert.rejects(
      () => rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo'](),
      (err) => err instanceof GrpcError && err.code === 7,
    );
  });

  it('500 → UNAVAILABLE (gRPC code 14)', async () => {
    const { mockFetch } = mockFetchHttpError(500, 'Internal Server Error');
    installMock(mockFetch);

    const ctx = makeCtx({ req: { ids: ['id1'] } });
    await assert.rejects(
      () => rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo'](),
      (err) => err instanceof GrpcError && err.code === 14,
    );
  });

  it('502 → UNAVAILABLE (gRPC code 14)', async () => {
    const { mockFetch } = mockFetchHttpError(502, 'Bad Gateway');
    installMock(mockFetch);

    const ctx = makeCtx({ req: {} });
    await assert.rejects(
      () => rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList'](),
      (err) => err instanceof GrpcError && err.code === 14,
    );
  });
});

describe('Error handling — JSON-RPC error codes', () => {
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('-32600 (Invalid Request) → INVALID_ARGUMENT (gRPC code 3)', async () => {
    const { mockFetch } = mockFetchRpcError(-32600, 'Invalid Request');
    installMock(mockFetch);

    const ctx = makeCtx({ req: { ids: ['id1'] } });
    await assert.rejects(
      () => rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo'](),
      (err) => err instanceof GrpcError && err.code === 3,
    );
  });

  it('-32602 (Invalid Params) → INVALID_ARGUMENT (gRPC code 3)', async () => {
    const { mockFetch } = mockFetchRpcError(-32602, 'Invalid params');
    installMock(mockFetch);

    const ctx = makeCtx({ req: { ids: ['id1'] } });
    await assert.rejects(
      () => rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo'](),
      (err) => err instanceof GrpcError && err.code === 3,
    );
  });

  it('-32601 (Method not found) → FAILED_PRECONDITION (gRPC code 9)', async () => {
    const { mockFetch } = mockFetchRpcError(-32601, 'Method not found');
    installMock(mockFetch);

    const ctx = makeCtx({ req: { ids: ['id1'] } });
    await assert.rejects(
      () => rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo'](),
      (err) => err instanceof GrpcError && err.code === 9,
    );
  });

  it('-32000 (Server error) → INTERNAL (gRPC code 13)', async () => {
    const { mockFetch } = mockFetchRpcError(-32000, '获取当前页面数据失败');
    installMock(mockFetch);

    const ctx = makeCtx({ req: { ids: ['id1'] } });
    await assert.rejects(
      () => rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo'](),
      (err) => err instanceof GrpcError && err.code === 13,
    );
  });

  it('-32050 (Server error range) → INTERNAL (gRPC code 13)', async () => {
    const { mockFetch } = mockFetchRpcError(-32050, 'internal timeout');
    installMock(mockFetch);

    const ctx = makeCtx({ req: { ids: ['id1'] } });
    await assert.rejects(
      () => rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo'](),
      (err) => err instanceof GrpcError && err.code === 13,
    );
  });

  it('code 1 (Cosmos auth failure) → PERMISSION_DENIED (gRPC code 7)', async () => {
    const { mockFetch } = mockFetchRpcError(1, 'token expired');
    installMock(mockFetch);

    const ctx = makeCtx({ req: { ids: ['id1'] } });
    await assert.rejects(
      () => rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo'](),
      (err) => err instanceof GrpcError && err.code === 7,
    );
  });

  it('unknown RPC error code → INTERNAL (gRPC code 13)', async () => {
    const { mockFetch } = mockFetchRpcError(-99999, 'something weird');
    installMock(mockFetch);

    const ctx = makeCtx({ req: { ids: ['id1'] } });
    await assert.rejects(
      () => rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo'](),
      (err) => err instanceof GrpcError && err.code === 13,
    );
  });
});

describe('Error handling — network errors', () => {
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('network error → UNAVAILABLE (gRPC code 14)', async () => {
    const { mockFetch } = mockFetchNetworkError('ECONNREFUSED');
    installMock(mockFetch);

    const ctx = makeCtx({ req: { ids: ['id1'] } });
    await assert.rejects(
      () => rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo'](),
      (err) => err instanceof GrpcError && err.code === 14,
    );
  });

  it('DNS error → UNAVAILABLE', async () => {
    const { mockFetch } = mockFetchNetworkError('getaddrinfo ENOTFOUND cosmos.invalid');
    installMock(mockFetch);

    const ctx = makeCtx({ req: { ids: ['id1'] } });
    await assert.rejects(
      () => rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo'](),
      (err) => err instanceof GrpcError && err.code === 14,
    );
  });
});

describe('TLS — per-request undici dispatcher (no process.env side effects)', () => {
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('uses undici Agent dispatcher for per-request TLS — never touches process.env', async () => {
    const savedEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;

    let capturedDispatcher = null;
    const { mockFetch } = mockFetchSuccess({ data: [] });
    installMock(async (url, options) => {
      capturedDispatcher = options?.dispatcher;
      return mockFetch(url, options);
    });

    const ctx = makeCtx({ req: { ids: ['id1'] } });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo']();

    // Verify that NODE_TLS_REJECT_UNAUTHORIZED was never touched
    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, undefined);

    // Verify the dispatcher is set (per-request TLS config, not process-wide)
    assert.ok(capturedDispatcher, 'fetch should receive a dispatcher option');
    assert.equal(typeof capturedDispatcher, 'object');

    if (savedEnv !== undefined) process.env.NODE_TLS_REJECT_UNAUTHORIZED = savedEnv;
  });

  it('process.env stays untouched even when upstream throws', async () => {
    const savedEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;

    const { mockFetch } = mockFetchHttpError(500, 'error');
    installMock(mockFetch);

    const ctx = makeCtx({ req: { ids: ['id1'] } });
    try { await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo'](); } catch {}

    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, undefined);

    if (savedEnv !== undefined) process.env.NODE_TLS_REJECT_UNAUTHORIZED = savedEnv;
  });

  it('no skipTlsVerify config is honored — TLS is always enforced via dispatcher', async () => {
    const savedEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;

    // Even if someone tries to pass skipTlsVerify in config, it should have no effect
    const { mockFetch } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({
      config: { endpoint: MOCK_ENDPOINT, skipTlsVerify: true },
      req: { ids: ['id1'] },
    });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo']();

    // process.env should NOT be touched regardless
    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, undefined);

    if (savedEnv !== undefined) process.env.NODE_TLS_REJECT_UNAUTHORIZED = savedEnv;
  });
});

describe('Endpoint normalization', () => {
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('trims trailing slash from endpoint', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({ config: { endpoint: 'https://cosmos.test.example.com/' }, req: { ids: ['id1'] } });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo']();

    assert.equal(calls[0].url, 'https://cosmos.test.example.com/pedestal/rpc');
  });

  it('rejects non-loopback http:// endpoint', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({ config: { endpoint: 'http://cosmos.local:8080' }, req: { ids: ['id1'] } });
    await assert.rejects(
      () => rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo'](),
      (err) => err instanceof GrpcError && err.code === 3,
    );

    assert.equal(calls.length, 0);
  });

  it('accepts loopback http:// endpoint for smoke and local development', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({ config: { endpoint: 'http://127.0.0.1:8080' }, req: { ids: ['id1'] } });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo']();

    assert.equal(calls[0].url, 'http://127.0.0.1:8080/pedestal/rpc');
  });

  it('uses restBaseUrl alias for endpoint', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({ config: { restBaseUrl: 'https://alias.example.com' }, req: { ids: ['id1'] } });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo']();

    assert.equal(calls[0].url, 'https://alias.example.com/pedestal/rpc');
  });

  it('uses baseUrl alias for endpoint', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({ config: { baseUrl: 'https://base.example.com' }, req: { ids: ['id1'] } });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo']();

    assert.equal(calls[0].url, 'https://base.example.com/pedestal/rpc');
  });
});

describe('Headers parsing from config', () => {
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('parses headers from JSON string', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({
      config: { endpoint: MOCK_ENDPOINT, headers: '{"X-Trace-Id":"abc123"}' },
      req: { ids: ['id1'] },
    });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo']();

    assert.equal(calls[0].options.headers['X-Trace-Id'], 'abc123');
  });

  it('ignores invalid JSON headers gracefully', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({
      config: { endpoint: MOCK_ENDPOINT, headers: 'not-json' },
      req: { ids: ['id1'] },
    });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo']();

    // Should not crash; headers just won't include custom ones
    assert.ok(calls[0].options.headers['Authorization']);
  });
});

describe('Timeout — AbortSignal.timeout prevents indefinite hangs', () => {
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('passes AbortSignal.timeout to fetch with configured timeoutMs', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({
      limits: { timeoutMs: 10000 },
      req: { ids: ['id1'] },
    });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo']();

    const signal = calls[0].options.signal;
    assert.ok(signal instanceof AbortSignal, 'fetch should receive an AbortSignal');
    // AbortSignal.timeout() creates a signal that is not yet aborted
    assert.equal(signal.aborted, false);
  });

  it('uses DEFAULT_TIMEOUT_MS (5000) when limits.timeoutMs is not set', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);

    const ctx = makeCtx({ req: { ids: ['id1'] } });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo']();

    assert.ok(calls[0].options.signal instanceof AbortSignal);
  });

  it('timeout expiry throws DEADLINE_EXCEEDED (gRPC code 4)', async () => {
    // Simulate a TimeoutError from AbortSignal.timeout
    const timeoutErr = new Error('The operation was aborted due to timeout');
    timeoutErr.name = 'TimeoutError';
    installMock(async () => { throw timeoutErr; });

    const ctx = makeCtx({ limits: { timeoutMs: 1 }, req: { ids: ['id1'] } });
    await assert.rejects(
      () => rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo'](),
      (err) => err instanceof GrpcError && err.code === 4 && err.message.includes('timed out'),
    );
  });

  it('AbortError (user-initiated abort) also throws DEADLINE_EXCEEDED', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    installMock(async () => { throw abortErr; });

    const ctx = makeCtx({ req: { ids: ['id1'] } });
    await assert.rejects(
      () => rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo'](),
      (err) => err instanceof GrpcError && err.code === 4,
    );
  });

  it('rejects negative timeoutMs with INVALID_ARGUMENT', () => {
    const ctx = makeCtx({ limits: { timeoutMs: -1 }, req: { ids: ['id1'] } });
    assert.throws(
      () => rpcdef(ctx),
      (err) => err instanceof GrpcError && err.code === 3 && err.message.includes('timeoutMs'),
    );
  });

  it('rejects Infinity timeoutMs with INVALID_ARGUMENT', () => {
    const ctx = makeCtx({ limits: { timeoutMs: Infinity }, req: { ids: ['id1'] } });
    assert.throws(
      () => rpcdef(ctx),
      (err) => err instanceof GrpcError && err.code === 3 && err.message.includes('timeoutMs'),
    );
  });

  it('rejects non-numeric timeoutMs with INVALID_ARGUMENT', () => {
    const ctx = makeCtx({ limits: { timeoutMs: 'fast' }, req: { ids: ['id1'] } });
    assert.throws(
      () => rpcdef(ctx),
      (err) => err instanceof GrpcError && err.code === 3 && err.message.includes('timeoutMs'),
    );
  });

  it('rejects zero timeoutMs with INVALID_ARGUMENT', () => {
    const ctx = makeCtx({ limits: { timeoutMs: 0 }, req: { ids: ['id1'] } });
    assert.throws(
      () => rpcdef(ctx),
      (err) => err instanceof GrpcError && err.code === 3 && err.message.includes('timeoutMs'),
    );
  });

  it('rejects NaN timeoutMs with INVALID_ARGUMENT', () => {
    const ctx = makeCtx({ limits: { timeoutMs: NaN }, req: { ids: ['id1'] } });
    assert.throws(
      () => rpcdef(ctx),
      (err) => err instanceof GrpcError && err.code === 3 && err.message.includes('timeoutMs'),
    );
  });
});

describe('Security boundaries', () => {
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('does not accept an api token from config or generic bindings', async () => {
    const ctx = makeCtx({
      config: { endpoint: MOCK_ENDPOINT, api_token: 'config-token' },
      bindings: { api_token: 'binding-token' },
      secret: {},
      req: { ids: ['id1'] },
    });
    await assert.rejects(
      () => rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo'](),
      (err) => err instanceof GrpcError && err.code === 3 && err.message.includes('api_token'),
    );
  });

  it('rejects endpoints containing credentials, query, or fragment', async () => {
    for (const endpoint of [
      'https://user:password@cosmos.example.com',
      'https://cosmos.example.com?token=secret',
      'https://cosmos.example.com/#fragment',
    ]) {
      const ctx = makeCtx({ config: { endpoint }, req: { ids: ['id1'] } });
      await assert.rejects(
        () => rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo'](),
        (err) => err instanceof GrpcError && err.code === 3,
      );
    }
  });

  it('uses manual redirects and prevents custom headers overriding protocol and auth headers', async () => {
    const { mockFetch, calls } = mockFetchSuccess({ data: [] });
    installMock(mockFetch);
    const ctx = makeCtx({
      config: {
        endpoint: MOCK_ENDPOINT,
        headers: {
          Authorization: 'bearer attacker',
          Host: 'attacker.example',
          'Content-Length': '1',
          'X-Correlation-Id': 'safe',
        },
      },
      req: { ids: ['id1'] },
    });
    await rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo']();
    assert.equal(calls[0].options.redirect, 'manual');
    assert.equal(calls[0].options.headers.Authorization, `bearer ${MOCK_TOKEN}`);
    assert.equal(calls[0].options.headers.Host, undefined);
    assert.equal(calls[0].options.headers['Content-Length'], undefined);
    assert.equal(calls[0].options.headers['X-Correlation-Id'], 'safe');
  });

  it('rejects oversized upstream responses before reading the body', async () => {
    installMock(async () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => name === 'content-length' ? String(4 * 1024 * 1024 + 1) : null },
      text: async () => { throw new Error('body must not be read'); },
    }));
    const ctx = makeCtx({ req: { ids: ['id1'] } });
    await assert.rejects(
      () => rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo'](),
      (err) => err instanceof GrpcError && err.code === 8,
    );
  });

  it('maps malformed success bodies without exposing their contents', async () => {
    installMock(async () => ({ ok: true, status: 200, text: async () => 'token=super-secret' }));
    const ctx = makeCtx({ req: { ids: ['id1'] } });
    await assert.rejects(
      () => rpcdef(ctx)['/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo'](),
      (err) => err instanceof GrpcError && err.code === 13 && !err.message.includes('super-secret'),
    );
  });
});

describe('Legacy handler wrapping — handlers export', () => {
  it('handlers object contains all three method keys', async () => {
    const { handlers, METHOD_SEARCH_LOG_INFO_FULL, METHOD_SEARCH_LOG_LIST_FULL, METHOD_SEARCH_AGGREGATION_FULL } = await import('../src/cosmos.js');

    assert.ok(typeof handlers[METHOD_SEARCH_LOG_INFO_FULL] === 'function');
    assert.ok(typeof handlers[METHOD_SEARCH_LOG_LIST_FULL] === 'function');
    assert.ok(typeof handlers[METHOD_SEARCH_AGGREGATION_FULL] === 'function');
  });

  it('exported method names match expected gRPC paths', async () => {
    const { METHOD_SEARCH_LOG_INFO_FULL, METHOD_SEARCH_LOG_LIST_FULL, METHOD_SEARCH_AGGREGATION_FULL } = await import('../src/cosmos.js');

    assert.equal(METHOD_SEARCH_LOG_INFO_FULL, 'Chaitin_COSMOS.Chaitin_COSMOS/SearchLogInfo');
    assert.equal(METHOD_SEARCH_LOG_LIST_FULL, 'Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList');
    assert.equal(METHOD_SEARCH_AGGREGATION_FULL, 'Chaitin_COSMOS.Chaitin_COSMOS/SearchAggregationStatistics');
  });
});
