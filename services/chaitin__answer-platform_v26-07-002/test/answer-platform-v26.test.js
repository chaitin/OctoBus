// Automated tests for Chaitin Answer-Platform V26 (OpenAPI / API-Token) service package.
// Uses node:test + node:assert with mocked global fetch (no external deps).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { handlers, _test } from '../src/answer-platform-v26.js';
import { GrpcError } from '@chaitin-ai/octobus-sdk';

const {
  unwrapStruct, unwrapValue, toPositiveInt, toOptionalBool, unwrapString,
  normalizeBaseUrl, parseHeaders, validateTimeoutMs,
} = _test;

const METHOD = {
  GET_ALARM: 'Answer_Platform_V26.Answer_Platform_V26/GetAlarm',
  GET_ALARM_DOCUMENT: 'Answer_Platform_V26.Answer_Platform_V26/GetAlarmDocument',
  SEARCH_ALARM_LIST: 'Answer_Platform_V26.Answer_Platform_V26/SearchAlarmList',
  GET_ASSET_INFO: 'Answer_Platform_V26.Answer_Platform_V26/GetAssetInfo',
  GET_ASSET_LIST: 'Answer_Platform_V26.Answer_Platform_V26/GetAssetList',
  SEARCH_GROUPS: 'Answer_Platform_V26.Answer_Platform_V26/SearchGroups',
  GET_PCAP_DETECT_TASK_LIST: 'Answer_Platform_V26.Answer_Platform_V26/GetPcapDetectTaskList',
  SEARCH_TCPDUMP_PROCESS: 'Answer_Platform_V26.Answer_Platform_V26/SearchTcpdumpProcess',
};

const BASE_URL = 'https://answer.test.example.com';
const TOKEN = 'api-token-xxxxx';

// ─── Mock fetch ───

let fetchCalls = [];
let fetchResult = null;

function installMockFetch(result) {
  fetchResult = result;
  fetchCalls = [];
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return fetchResult;
  };
}

function jsonResponse(result) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify({ jsonrpc: '2.0', id: '0', result }),
  };
}

function httpError(status) {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    text: async () => '',
  };
}

function jsonRpcError(code, message) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify({ jsonrpc: '2.0', id: '0', error: { code, message } }),
  };
}

const call = (method, request = {}, ctxOverrides = {}) => {
  const ctx = {
    request,
    config: { restBaseUrl: BASE_URL, ...(ctxOverrides.config ?? {}) },
    secret: { api_token: TOKEN, ...(ctxOverrides.secret ?? {}) },
    ...ctxOverrides,
  };
  return handlers[method](ctx);
};

beforeEach(() => { installMockFetch(jsonResponse({ data: [] })); });
afterEach(() => { delete globalThis.fetch; });

// ─── Helpers ───

describe('helpers', () => {
  it('unwrapStruct converts protobuf-es Struct shape to plain JSON', () => {
    const struct = {
      fields: {
        severity: { kind: { case: 'listValue', value: { values: [
          { kind: { case: 'structValue', value: { fields: {
            oper: { kind: { case: 'stringValue', value: '=' } },
            target: { kind: { case: 'numberValue', value: 1 } },
          } } } },
        ] } } },
        name: { kind: { case: 'stringValue', value: 'abc' } },
        flag: { kind: { case: 'boolValue', value: true } },
        empty: { kind: { case: 'nullValue' } },
      },
    };
    assert.deepEqual(unwrapStruct(struct), {
      severity: [{ oper: '=', target: 1 }],
      name: 'abc',
      flag: true,
      empty: null,
    });
  });

  it('unwrapStruct returns {} for undefined/null', () => {
    assert.deepEqual(unwrapStruct(undefined), {});
    assert.deepEqual(unwrapStruct(null), {});
  });

  it('unwrapValue handles scalar kinds', () => {
    assert.equal(unwrapValue({ kind: { case: 'numberValue', value: 42 } }), 42);
    assert.equal(unwrapValue({ kind: { case: 'stringValue', value: 'x' } }), 'x');
    assert.equal(unwrapValue({ kind: { case: 'boolValue', value: false } }), false);
    assert.equal(unwrapValue({ kind: { case: 'nullValue' } }), null);
  });

  it('toPositiveInt unwraps Int64Value and bigint', () => {
    assert.equal(toPositiveInt({ value: 10n }), 10);
    assert.equal(toPositiveInt(7), 7);
    assert.equal(toPositiveInt('5'), 5);
    assert.equal(toPositiveInt(undefined), null);
    assert.equal(toPositiveInt('abc'), null);
  });

  it('toOptionalBool unwraps BoolValue', () => {
    assert.equal(toOptionalBool({ value: true }), true);
    assert.equal(toOptionalBool(false), false);
    assert.equal(toOptionalBool(undefined), undefined);
  });

  it('normalizeBaseUrl rejects non-https and strips trailing slash', () => {
    assert.equal(normalizeBaseUrl('https://a.b.c/'), 'https://a.b.c');
    assert.equal(normalizeBaseUrl('http://127.0.0.1:9000'), 'http://127.0.0.1:9000');
    assert.equal(normalizeBaseUrl('http://a.b.c'), '');
    assert.equal(normalizeBaseUrl('ftp://a.b.c'), '');
  });

  it('parseHeaders blocks protocol/auth headers', () => {
    const h = parseHeaders({ 'X-Custom': 'v', 'API-Token': 'bad', 'Content-Type': 'bad', 'Host': 'bad' });
    assert.deepEqual(h, { 'X-Custom': 'v' });
  });

  it('validateTimeoutMs defaults and validates', () => {
    assert.equal(validateTimeoutMs(undefined), 30000);
    assert.equal(validateTimeoutMs(1000), 1000);
    assert.throws(() => validateTimeoutMs(-1), GrpcError);
  });
});

// ─── Handlers ───

describe('GetAlarm', () => {
  it('calls AlarmService.GetAlarm with doc_id and maps data', async () => {
    installMockFetch(jsonResponse({ data: { doc_id: 'd1', attacker: '1.2.3.4' } }));
    const res = await call(METHOD.GET_ALARM, { doc_id: 'd1' });

    assert.equal(fetchCalls.length, 1);
    const { url, options } = fetchCalls[0];
    assert.equal(url, `${BASE_URL}/rpc`);
    assert.equal(options.headers['API-Token'], TOKEN);
    const body = JSON.parse(options.body);
    assert.equal(body.jsonrpc, '2.0');
    assert.equal(body.method, 'AlarmService.GetAlarm');
    assert.deepEqual(body.params, { doc_id: 'd1' });
    assert.deepEqual(res.data, { doc_id: 'd1', attacker: '1.2.3.4' });
  });

  it('throws INVALID_ARGUMENT when doc_id missing', async () => {
    await assert.rejects(() => call(METHOD.GET_ALARM, {}), GrpcError);
  });
});

describe('SearchAlarmList', () => {
  it('builds params with time range, pagination, keyword, filters', async () => {
    installMockFetch(jsonResponse({ data: [{ doc_id: 'a' }], page_total: 3, total: 42 }));
    const filters = {
      fields: {
        severity: { kind: { case: 'listValue', value: { values: [
          { kind: { case: 'structValue', value: { fields: {
            oper: { kind: { case: 'stringValue', value: '=' } },
            target: { kind: { case: 'numberValue', value: 1 } },
          } } } },
        ] } } },
      },
    };
    const res = await call(METHOD.SEARCH_ALARM_LIST, {
      time_range_start: { value: 1700000000n },
      time_range_end: { value: 1700086400n },
      count: { value: 20n },
      offset: { value: 0n },
      keyword: ['port scan', ''],
      filters,
    });

    const body = JSON.parse(fetchCalls[0].options.body);
    assert.deepEqual(body.params, {
      count: 20,
      offset: 0,
      time_range_start: 1700000000,
      time_range_end: 1700086400,
      keyword: ['port scan'],
      severity: [{ oper: '=', target: 1 }],
    });
    assert.deepEqual(res, { items: [{ doc_id: 'a' }], page_total: 3, total: 42 });
  });
});

describe('GetAssetInfo', () => {
  it('requires integer id', async () => {
    installMockFetch(jsonResponse({ data: { id: 5 } }));
    const res = await call(METHOD.GET_ASSET_INFO, { id: { value: 5n } });
    assert.deepEqual(JSON.parse(fetchCalls[0].options.body).params, { id: 5 });
    assert.deepEqual(res.data, { id: 5 });
  });
});

describe('SearchGroups', () => {
  it('passes with_asset boolean', async () => {
    installMockFetch(jsonResponse({ data: [{ id: 1 }] }));
    const res = await call(METHOD.SEARCH_GROUPS, { depth: { value: 2n }, id: { value: 1n }, with_asset: { value: true } });
    assert.deepEqual(JSON.parse(fetchCalls[0].options.body).params, { depth: 2, id: 1, with_asset: true });
    assert.deepEqual(res.items, [{ id: 1 }]);
  });
});

describe('GetPcapDetectTaskList', () => {
  it('maps pcap_detect_task_list field to items', async () => {
    installMockFetch(jsonResponse({ pcap_detect_task_list: [{ id: 9 }], total: 1 }));
    const res = await call(METHOD.GET_PCAP_DETECT_TASK_LIST, { limit: { value: 10n }, offset: { value: 0n } });
    assert.deepEqual(JSON.parse(fetchCalls[0].options.body).params, { limit: 10, offset: 0 });
    assert.deepEqual(res, { items: [{ id: 9 }], total: 1 });
  });
});

describe('SearchTcpdumpProcess', () => {
  it('passes device and id', async () => {
    installMockFetch(jsonResponse({ data: [{ id: 1 }], total: 1 }));
    const res = await call(METHOD.SEARCH_TCPDUMP_PROCESS, { device: 'dev-1', id: { value: 1n } });
    assert.deepEqual(JSON.parse(fetchCalls[0].options.body).params, { device: 'dev-1', id: 1 });
    assert.equal(res.total, 1);
  });
});

describe('auth and errors', () => {
  it('throws when api_token missing', async () => {
    await assert.rejects(
      () => call(METHOD.GET_ALARM, { doc_id: 'd' }, { secret: {} }),
      (err) => err instanceof GrpcError && err.legacyCode === 'INVALID_ARGUMENT',
    );
  });

  it('throws when restBaseUrl missing', async () => {
    await assert.rejects(
      () => call(METHOD.GET_ALARM, { doc_id: 'd' }, { config: {} }),
      (err) => err instanceof GrpcError && err.legacyCode === 'INVALID_ARGUMENT',
    );
  });

  it('maps HTTP 401 to PERMISSION_DENIED', async () => {
    installMockFetch(httpError(401));
    await assert.rejects(
      () => call(METHOD.GET_ALARM, { doc_id: 'd' }),
      (err) => err instanceof GrpcError && err.legacyCode === 'PERMISSION_DENIED',
    );
  });

  it('maps JSON-RPC auth error to PERMISSION_DENIED', async () => {
    installMockFetch(jsonRpcError(1, 'token invalid'));
    await assert.rejects(
      () => call(METHOD.GET_ALARM, { doc_id: 'd' }),
      (err) => err instanceof GrpcError && err.legacyCode === 'PERMISSION_DENIED',
    );
  });

  it('maps HTTP 500 to UNAVAILABLE', async () => {
    installMockFetch(httpError(500));
    await assert.rejects(
      () => call(METHOD.GET_ALARM, { doc_id: 'd' }),
      (err) => err instanceof GrpcError && err.legacyCode === 'UNAVAILABLE',
    );
  });
});
