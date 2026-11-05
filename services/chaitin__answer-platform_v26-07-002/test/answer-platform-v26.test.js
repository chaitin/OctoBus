// Automated tests for Chaitin Answer-Platform V26 (OpenAPI / API-Token) service package.
// Uses node:test + node:assert with mocked global fetch (no external deps).

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

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

const rpcCtx = (overrides = {}) => ({
  config: { restBaseUrl: BASE_URL, ...(overrides.config ?? {}) },
  secret: { api_token: TOKEN, ...(overrides.secret ?? {}) },
  limits: overrides.limits ?? {},
  ...overrides,
});

const buildFakeRequest = (statusCode, headers, bodyText) => {
  const resListeners = {};
  const reqListeners = {};
  const res = {
    statusCode,
    headers,
    on: (ev, cb) => { resListeners[ev] = cb; return res; },
  };
  const req = {
    setTimeout: () => req,
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
  };
};

beforeEach(() => { installMockFetch(jsonResponse({ data: [] })); });
afterEach(() => { delete globalThis.fetch; mock.restoreAll(); });

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

  it('unwrapString handles wrappers and scalars', () => {
    assert.equal(unwrapString({ value: 'x' }), 'x');
    assert.equal(unwrapString({ value: 0 }), '0');
    assert.equal(unwrapString({ value: null }), '');
    assert.equal(unwrapString(null), '');
    assert.equal(unwrapString(123), '123');
  });

  it('toPositiveInt handles nested wrappers and non-integers', () => {
    assert.equal(toPositiveInt({ value: { value: 3 } }), 3);
    assert.equal(toPositiveInt({}), null);
    assert.equal(toPositiveInt(1.5), null);
  });

  it('toOptionalBool parses strings', () => {
    assert.equal(toOptionalBool('true'), true);
    assert.equal(toOptionalBool('false'), false);
    assert.equal(toOptionalBool('yes'), undefined);
  });

  it('normalizeBaseUrl rejects credentials, query and fragment', () => {
    assert.equal(normalizeBaseUrl(''), '');
    assert.equal(normalizeBaseUrl('not a url'), '');
    assert.equal(normalizeBaseUrl('https://u:p@a.b.c'), '');
    assert.equal(normalizeBaseUrl('https://a.b.c?x=1'), '');
    assert.equal(normalizeBaseUrl('https://a.b.c#frag'), '');
  });

  it('parseHeaders handles strings, arrays and non-string values', () => {
    assert.deepEqual(parseHeaders('{"X-Custom":"v"}'), { 'X-Custom': 'v' });
    assert.deepEqual(parseHeaders('bad json'), {});
    assert.deepEqual(parseHeaders(['a']), {});
    assert.deepEqual(parseHeaders('{"X-Custom":5}'), {});
    assert.deepEqual(parseHeaders(null), {});
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

// ─── Transport (proxied fetch + error mapping) ───

describe('transport', () => {
  it('routes through socks5 proxy when proxy_url is set', async () => {
    mock.method(http, 'request', (target, options, cb) => {
      const f = buildFakeRequest(200, { 'content-type': 'application/json' }, JSON.stringify({ jsonrpc: '2.0', id: '0', result: { data: [{ id: 1 }] } }));
      cb(f.res);
      f.deliver();
      return f.req;
    });
    const res = await _test.rpcCall(rpcCtx({ config: { restBaseUrl: 'http://127.0.0.1:8080', proxy_url: 'socks5://127.0.0.1:1080' } }), 'AlarmService.GetAlarm', {});
    assert.deepEqual(res, { data: [{ id: 1 }] });
  });

  it('maps proxied network error to UNAVAILABLE', async () => {
    mock.method(http, 'request', (target, options, cb) => {
      const f = buildFakeRequest(200, {}, '');
      cb(f.res);
      setTimeout(() => f.fail(new Error('ECONNREFUSED')), 5);
      return f.req;
    });
    await assert.rejects(() => _test.rpcCall(rpcCtx({ config: { restBaseUrl: 'http://127.0.0.1:8080', proxy_url: 'socks5://127.0.0.1:1080' } }), 'M', {}), (e) => e.legacyCode === 'UNAVAILABLE');
  });

  it('maps proxied timeout to DEADLINE_EXCEEDED', async () => {
    mock.method(http, 'request', (target, options, cb) => {
      const f = buildFakeRequest(200, {}, '');
      cb(f.res);
      setTimeout(() => f.fail(Object.assign(new Error('t'), { code: 'ETIMEDOUT' })), 5);
      return f.req;
    });
    await assert.rejects(() => _test.rpcCall(rpcCtx({ config: { restBaseUrl: 'http://127.0.0.1:8080', proxy_url: 'socks5://127.0.0.1:1080' } }), 'M', {}), (e) => e.legacyCode === 'DEADLINE_EXCEEDED');
  });

  it('maps fetch abort to DEADLINE_EXCEEDED', async () => {
    globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    await assert.rejects(() => _test.rpcCall(rpcCtx({ limits: { timeoutMs: 5 } }), 'AlarmService.GetAlarm', {}), (e) => e.legacyCode === 'DEADLINE_EXCEEDED');
  });

  it('maps fetch network error to UNAVAILABLE', async () => {
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    await assert.rejects(() => _test.rpcCall(rpcCtx(), 'AlarmService.GetAlarm', {}), (e) => e.legacyCode === 'UNAVAILABLE');
  });

  it('maps invalid JSON to INTERNAL', async () => {
    installMockFetch({ ok: true, status: 200, headers: { get: () => null }, text: async () => 'not json' });
    await assert.rejects(() => _test.rpcCall(rpcCtx(), 'AlarmService.GetAlarm', {}), (e) => e.legacyCode === 'INTERNAL');
  });

  it('maps oversized content-length to INTERNAL', async () => {
    installMockFetch({ ok: true, status: 200, headers: { get: (n) => (n === 'content-length' ? '9999999' : null) }, text: async () => '{}' });
    await assert.rejects(() => _test.rpcCall(rpcCtx(), 'AlarmService.GetAlarm', {}), (e) => e.legacyCode === 'INTERNAL');
  });

  it('maps oversized body to INTERNAL', async () => {
    installMockFetch({ ok: true, status: 200, headers: { get: () => null }, text: async () => 'x'.repeat(5 * 1024 * 1024) });
    await assert.rejects(() => _test.rpcCall(rpcCtx(), 'AlarmService.GetAlarm', {}), (e) => e.legacyCode === 'INTERNAL');
  });

  it('maps JSON-RPC -32601 to FAILED_PRECONDITION', async () => {
    installMockFetch(jsonRpcError(-32601, 'method not found'));
    await assert.rejects(() => _test.rpcCall(rpcCtx(), 'AlarmService.GetAlarm', {}), (e) => e.legacyCode === 'FAILED_PRECONDITION');
  });

  it('maps JSON-RPC -32602 to INVALID_ARGUMENT', async () => {
    installMockFetch(jsonRpcError(-32602, 'invalid params'));
    await assert.rejects(() => _test.rpcCall(rpcCtx(), 'AlarmService.GetAlarm', {}), (e) => e.legacyCode === 'INVALID_ARGUMENT');
  });

  it('maps JSON-RPC unknown error to INTERNAL', async () => {
    installMockFetch(jsonRpcError(999, 'server blew up'));
    await assert.rejects(() => _test.rpcCall(rpcCtx(), 'AlarmService.GetAlarm', {}), (e) => e.legacyCode === 'INTERNAL');
  });
});

// ─── Remaining handlers ───

describe('remaining handlers', () => {
  const M = (n) => `Answer_Platform_V26.Answer_Platform_V26/${n}`;

  it('GetAlarmDocument maps data', async () => {
    installMockFetch(jsonResponse({ data: { doc_id: 'd2', content: 'x' } }));
    const res = await call(M('GetAlarmDocument'), { doc_id: 'd2' });
    assert.equal(JSON.parse(fetchCalls[0].options.body).method, 'AlarmService.GetAlarmDocument');
    assert.deepEqual(res.data, { doc_id: 'd2', content: 'x' });
  });

  it('SearchAlarmCustomIntelligenceList maps list', async () => {
    installMockFetch(jsonResponse({ data: [{ id: 1 }], total: 1 }));
    const res = await call(M('SearchAlarmCustomIntelligenceList'), { count: { value: 10n } });
    assert.equal(JSON.parse(fetchCalls[0].options.body).method, 'AlarmService.SearchAlarmCustomIntelligenceList');
    assert.deepEqual(res, { items: [{ id: 1 }], total: 1 });
  });

  it('SearchAlarmCustomRuleList maps list', async () => {
    installMockFetch(jsonResponse({ data: [{ id: 2 }], total: 1 }));
    const res = await call(M('SearchAlarmCustomRuleList'), { offset: { value: 5n } });
    assert.equal(JSON.parse(fetchCalls[0].options.body).method, 'AlarmService.SearchAlarmCustomRuleList');
    assert.deepEqual(res, { items: [{ id: 2 }], total: 1 });
  });

  it('SearchAssetIdentify maps list with asset filters', async () => {
    installMockFetch(jsonResponse({ data: [{ id: 3 }], total: 1 }));
    const res = await call(M('SearchAssetIdentify'), { name: 'web', ip_addr: '1.2.3.4', asset_type: 'server', group_id: { value: 9n }, importance: { value: 1n } });
    const params = JSON.parse(fetchCalls[0].options.body).params;
    assert.equal(JSON.parse(fetchCalls[0].options.body).method, 'AssetIdentifyApi.SearchAssetIdentify');
    assert.deepEqual(params, { name: 'web', ip_addr: '1.2.3.4', asset_type: 'server', group_id: 9, importance: 1 });
    assert.deepEqual(res, { items: [{ id: 3 }], total: 1 });
  });

  it('GetAssetList maps list with asset filters', async () => {
    installMockFetch(jsonResponse({ data: [{ id: 4 }], total: 1 }));
    const res = await call(M('GetAssetList'), { name: 'n', ip: '2.2.2.2', group_id: { value: 1n }, asset_type: 'host', importance: { value: 2n } });
    assert.equal(JSON.parse(fetchCalls[0].options.body).method, 'AssetService.GetAssetList');
    assert.deepEqual(res, { items: [{ id: 4 }], total: 1 });
  });

  it('SearchAssetTree maps items', async () => {
    installMockFetch(jsonResponse({ data: [{ id: 5 }] }));
    const res = await call(M('SearchAssetTree'), { name: 'tree' });
    assert.equal(JSON.parse(fetchCalls[0].options.body).method, 'AssetService.SearchAssetTree');
    assert.deepEqual(res, { items: [{ id: 5 }] });
  });

  it('SearchTags maps items', async () => {
    installMockFetch(jsonResponse({ data: [{ id: 6 }] }));
    const res = await call(M('SearchTags'), { name: 'tag' });
    assert.equal(JSON.parse(fetchCalls[0].options.body).method, 'AssetService.SearchTags');
    assert.deepEqual(res, { items: [{ id: 6 }] });
  });

  it('GetPcapDetectAlarm maps data', async () => {
    installMockFetch(jsonResponse({ data: { doc_id: 'p1' } }));
    const res = await call(M('GetPcapDetectAlarm'), { doc_id: 'p1' });
    assert.equal(JSON.parse(fetchCalls[0].options.body).method, 'PcapDetectService.GetAlarm');
    assert.deepEqual(res.data, { doc_id: 'p1' });
  });

  it('GetPcapDetectAlarmDocument maps data', async () => {
    installMockFetch(jsonResponse({ data: { doc_id: 'p2' } }));
    const res = await call(M('GetPcapDetectAlarmDocument'), { doc_id: 'p2' });
    assert.equal(JSON.parse(fetchCalls[0].options.body).method, 'PcapDetectService.GetAlarmDocument');
    assert.deepEqual(res.data, { doc_id: 'p2' });
  });

  it('SearchPcapDetectAlarmList maps paged list', async () => {
    installMockFetch(jsonResponse({ data: [{ doc_id: 'p3' }], page_total: 1, total: 2 }));
    const res = await call(M('SearchPcapDetectAlarmList'), { count: { value: 20n }, time_range_start: { value: 1n }, time_range_end: { value: 2n } });
    assert.equal(JSON.parse(fetchCalls[0].options.body).method, 'PcapDetectService.SearchPcapDetectAlarmList');
    assert.deepEqual(res, { items: [{ doc_id: 'p3' }], page_total: 1, total: 2 });
  });
});
