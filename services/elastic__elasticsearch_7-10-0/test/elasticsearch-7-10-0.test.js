import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_CLUSTER_HEALTH_FULL,
  METHOD_CLUSTER_HEALTH_PATH,
  METHOD_GET_INDEX_FULL,
  METHOD_GET_INDEX_PATH,
  METHOD_LIST_INDICES_FULL,
  METHOD_LIST_INDICES_PATH,
  METHOD_LIST_NODES_FULL,
  METHOD_LIST_NODES_PATH,
  METHOD_SEARCH_DOCUMENTS_FULL,
  METHOD_SEARCH_DOCUMENTS_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/elasticsearch-7-10-0.js';
import { service } from '../src/service.js';
import { DEFAULT_PASSWORD, DEFAULT_USER, createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;

const baseBindings = {
  baseUrl: 'https://es.example.com:9200',
  username: DEFAULT_USER,
  password: DEFAULT_PASSWORD,
  timeoutMs: 4000,
};

const buildCtx = (overrides = {}) => ({
  config: { ...baseBindings, ...(overrides.config || {}) },
  secret: { username: DEFAULT_USER, password: DEFAULT_PASSWORD, ...(overrides.secret || {}) },
  bindings: overrides.bindings || {},
  limits: { timeoutMs: 4000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst-1', request_id: 'req-1', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const responseOf = (status, body) => ({
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const setFetch = (impl) => { globalThis.fetch = impl; };

const expectGrpcError = async (fn, legacyCode, checker = () => {}) => {
  let caught;
  try { await fn(); } catch (err) { caught = err; }
  assert.ok(caught, 'expected function to reject');
  assert.ok(caught instanceof GrpcError);
  assert.equal(caught.legacyCode, legacyCode);
  assert.equal(caught.code, ({
    FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
    INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
    PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
    UNKNOWN: grpcStatus.UNKNOWN,
  })[legacyCode]);
  checker(caught);
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalConsoleLog;
});

test('service exports handler and rpcdef paths', () => {
  assert.equal(typeof service, 'object');
  for (const full of [
    METHOD_CLUSTER_HEALTH_FULL, METHOD_LIST_INDICES_FULL, METHOD_GET_INDEX_FULL,
    METHOD_SEARCH_DOCUMENTS_FULL, METHOD_LIST_NODES_FULL,
  ]) assert.equal(typeof handlers[full], 'function');
  const defs = rpcdef(buildCtx());
  for (const path of [
    METHOD_CLUSTER_HEALTH_PATH, METHOD_LIST_INDICES_PATH, METHOD_GET_INDEX_PATH,
    METHOD_SEARCH_DOCUMENTS_PATH, METHOD_LIST_NODES_PATH,
  ]) assert.equal(typeof defs[path], 'function');
});

test('validates required bindings and request fields', async () => {
  await expectGrpcError(
    () => handlers[METHOD_CLUSTER_HEALTH_FULL]({}, buildCtx({ config: { baseUrl: '' } })),
    'INVALID_ARGUMENT', (err) => assert.match(err.message, /baseUrl/));
  await expectGrpcError(
    () => handlers[METHOD_CLUSTER_HEALTH_FULL]({}, buildCtx({ secret: { username: '', password: '' } })),
    'INVALID_ARGUMENT', (err) => assert.match(err.message, /username and password/));
  await expectGrpcError(
    () => handlers[METHOD_GET_INDEX_FULL]({}, buildCtx()),
    'INVALID_ARGUMENT', (err) => assert.match(err.message, /index is required/));
  await expectGrpcError(
    () => handlers[METHOD_SEARCH_DOCUMENTS_FULL]({}, buildCtx()),
    'INVALID_ARGUMENT', (err) => assert.match(err.message, /index is required for SearchDocuments/));
  await expectGrpcError(
    () => handlers[METHOD_CLUSTER_HEALTH_FULL]({ level: 'bogus' }, buildCtx()),
    'INVALID_ARGUMENT', (err) => assert.match(err.message, /level must be one of/));
  await expectGrpcError(
    () => handlers[METHOD_CLUSTER_HEALTH_FULL]({ wait_for_status: 'purple' }, buildCtx()),
    'INVALID_ARGUMENT', (err) => assert.match(err.message, /wait_for_status must be one of/));
  await expectGrpcError(
    () => handlers[METHOD_LIST_NODES_FULL]({ bytes: 'tb' }, buildCtx()),
    'INVALID_ARGUMENT', (err) => assert.match(err.message, /bytes must be one of/));
});

test('ClusterHealth sends GET with Basic Auth and maps all fields', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return responseOf(200, {
      cluster_name: 'demo', status: 'yellow', timed_out: true,
      number_of_nodes: 5, number_of_data_nodes: 3,
      active_primary_shards: 11, active_shards: 22,
      relocating_shards: 1, initializing_shards: 2,
      unassigned_shards: 3, delayed_unassigned_shards: 0,
      number_of_pending_tasks: 4, number_of_in_flight_fetch: 5,
      task_max_waiting_in_queue_millis: 6,
      active_shards_percent_as_number: 87.5,
    });
  });
  const result = await handlers[METHOD_CLUSTER_HEALTH_FULL](
    { level: 'cluster', timeout: '30s', wait_for_status: 'yellow' },
    buildCtx({ config: { skipTlsVerify: true } }),
  );
  const parsed = new URL(captured.url);
  assert.equal(`${parsed.origin}${parsed.pathname}`, 'https://es.example.com:9200/_cluster/health');
  assert.equal(parsed.searchParams.get('level'), 'cluster');
  assert.equal(parsed.searchParams.get('timeout'), '30s');
  assert.equal(parsed.searchParams.get('wait_for_status'), 'yellow');
  assert.equal(captured.init.method, 'GET');
  assert.equal(captured.init.timeoutMs, 4000);
  assert.equal(captured.init.skipTlsVerify, true);
  const auth = Buffer.from(captured.init.headers.Authorization.slice(6), 'base64').toString('utf8');
  assert.equal(auth, `${DEFAULT_USER}:${DEFAULT_PASSWORD}`);
  assert.equal(result.cluster_name, 'demo');
  assert.equal(result.status, 'yellow');
  assert.equal(result.timed_out, true);
  assert.equal(result.number_of_nodes, 5);
  // active_shards_percent_as_number is now a float (per ES docs)
  assert.equal(result.active_shards_percent_as_number, 87.5);
  assert.match(result.raw_body, /"cluster_name":"demo"/);
});

test('GetIndex returns structured aliases, mappings, settings', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return responseOf(200, {
      logs: {
        aliases: {
          'alias-write': { is_write_index: true },
          'alias-search': { is_write_index: false, search_routing: '1' },
        },
        mappings: {
          dynamic: 'true',
          dynamic_templates: [{ strings_match_keyword: { match_mapping_type: 'string' } }],
          properties: {
            message: { type: 'text', analyzer: 'standard' },
            timestamp: { type: 'date' },
            level: { type: 'keyword' },
          },
        },
        settings: {
          index: { number_of_shards: '2', number_of_replicas: '1', refresh_interval: '5s' },
        },
      },
    });
  });
  const result = await handlers[METHOD_GET_INDEX_FULL]({ index: 'logs' }, buildCtx());
  assert.equal(captured.url, 'https://es.example.com:9200/logs');
  assert.equal(captured.init.method, 'GET');

  // aliases
  const aliases = result.aliases.logs.aliases;
  assert.equal(aliases['alias-write'].is_write_index, true);
  assert.equal(aliases['alias-write'].is_hidden, false);
  assert.equal(aliases['alias-search'].search_routing, '1');

  // mappings
  const mappings = result.mappings.logs;
  assert.equal(mappings.dynamic, true);
  assert.deepEqual(JSON.parse(mappings.dynamic_templates_json), [{ strings_match_keyword: { match_mapping_type: 'string' } }]);
  assert.equal(mappings.properties.message.type, 'text');
  assert.equal(mappings.properties.timestamp.type, 'date');
  assert.equal(mappings.properties.level.type, 'keyword');

  // settings
  const settings = result.settings.logs;
  assert.equal(settings.number_of_shards, '2');
  assert.equal(settings.number_of_replicas, '1');
  assert.equal(settings.refresh_interval, '5s');

  assert.match(result.raw_body, /"logs"/);
});

test('SearchDocuments captures _shards, _scroll_id, hit version/seq_no/primary_term/sort/highlight', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return responseOf(200, {
      took: 7, timed_out: false,
      _shards: { total: 3, successful: 2, skipped: 0, failed: 1 },
      _scroll_id: 'scroll-abc',
      hits: {
        total: { value: 2, relation: 'eq' },
        max_score: 1.5,
        hits: [
          { _index: 'logs', _id: 'a', _score: 1.5, _type: '_doc', _version: 5, _seq_no: 10, _primary_term: 2,
            _source: { msg: 'hi' },
            sort: [{ ts: 'desc' }], highlight: { msg: ['<em>hi</em>'] } },
          { _index: 'logs', _id: 'b', _score: 0.9, _type: '_doc', _version: 3, _seq_no: 7, _primary_term: 2,
            _source: { msg: 'yo' }, _ignored: ['level.keyword'] },
        ],
      },
    });
  });
  const result = await handlers[METHOD_SEARCH_DOCUMENTS_FULL](
    { index: 'logs', query: '{"match_all":{}}', size: 5, from: 0 },
    buildCtx(),
  );
  assert.equal(captured.url, 'https://es.example.com:9200/logs/_search');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['Content-Type'], 'application/json');
  assert.match(captured.init.headers.Authorization, /^Basic /);
  const sent = JSON.parse(captured.init.body);
  assert.deepEqual(sent.query, { match_all: {} });
  assert.equal(sent.size, 5);
  assert.equal(sent.from, 0);

  // top-level new fields
  assert.equal(result.shards_total, 3);
  assert.equal(result.shards_successful, 2);
  assert.equal(result.shards_skipped, 0);
  assert.equal(result.shards_failed, 1);
  assert.equal(result.scroll_id, 'scroll-abc');
  assert.equal(result.total_hits_relation, 'eq');
  assert.equal(result.took, 7);
  assert.equal(result.timed_out, false);
  assert.equal(result.total_hits, 2);
  assert.equal(result.max_score, 1.5);

  // hit-level new fields
  assert.equal(result.hits[0].type, '_doc');
  assert.equal(result.hits[0].version, 5);
  assert.equal(result.hits[0].seq_no, 10);
  assert.equal(result.hits[0].primary_term, 2);
  assert.match(result.hits[0].sort_json, /desc/);
  assert.match(result.hits[0].highlight_json, /em/);
  assert.match(result.hits[1].ignored_json, /level.keyword/);
});

test('SearchDocuments rejects invalid query JSON', async () => {
  await expectGrpcError(
    () => handlers[METHOD_SEARCH_DOCUMENTS_FULL]({ index: 'logs', query: '{not json' }, buildCtx()),
    'INVALID_ARGUMENT', (err) => assert.match(err.message, /query must be valid JSON/));
});

test('ListNodes sends GET _cat/nodes and maps node fields', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return responseOf(200, [
      { ip: '1.2.3.4', name: 'n1', 'heap.percent': '22', 'ram.percent': '55', cpu: '3', load_1m: '0.1', load_5m: '0.2', load_15m: '0.3', 'node.role': 'mdi', master: '*' },
    ]);
  });
  const result = await handlers[METHOD_LIST_NODES_FULL]({ bytes: 'kb' }, buildCtx());
  const parsed = new URL(captured.url);
  assert.equal(`${parsed.origin}${parsed.pathname}`, 'https://es.example.com:9200/_cat/nodes');
  assert.equal(parsed.searchParams.get('format'), 'json');
  assert.equal(parsed.searchParams.get('bytes'), 'kb');
  assert.equal(captured.init.method, 'GET');
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].name, 'n1');
  assert.equal(result.nodes[0].heap_percent, '22');
  assert.equal(result.nodes[0].master, '*');
});

test('HTTP error status codes map to expected gRPC codes', async () => {
  for (const [status, legacyCode] of [[401, 'PERMISSION_DENIED'], [403, 'PERMISSION_DENIED'], [400, 'FAILED_PRECONDITION'], [404, 'FAILED_PRECONDITION'], [500, 'UNAVAILABLE'], [502, 'UNAVAILABLE']]) {
    setFetch(async () => responseOf(status, { error: `status ${status}` }));
    await expectGrpcError(
      () => handlers[METHOD_CLUSTER_HEALTH_FULL]({}, buildCtx()),
      legacyCode,
      (err) => { assert.equal(err.response.http_status, status); assert.match(err.response.http_body, new RegExp(`status ${status}`)); },
    );
  }
  setFetch(async () => { throw Object.assign(new Error('boom'), { cause: new Error('conn refused') }); });
  await expectGrpcError(() => handlers[METHOD_CLUSTER_HEALTH_FULL]({}, buildCtx()), 'UNAVAILABLE', (err) => assert.match(err.message, /conn refused/));
  setFetch(async () => ({ status: 200, text: async () => { throw new Error('read fail'); } }));
  await expectGrpcError(() => handlers[METHOD_CLUSTER_HEALTH_FULL]({}, buildCtx()), 'UNAVAILABLE', (err) => assert.match(err.message, /response read failed/));
});

test('invalid JSON or empty response maps to UNKNOWN', async () => {
  setFetch(async () => responseOf(200, ''));
  await expectGrpcError(() => handlers[METHOD_CLUSTER_HEALTH_FULL]({}, buildCtx()), 'UNKNOWN');
  setFetch(async () => responseOf(200, 'not-json'));
  await expectGrpcError(() => handlers[METHOD_CLUSTER_HEALTH_FULL]({}, buildCtx()), 'UNKNOWN');
});

test('rpcdef falls back to context request when call request is nullish', async () => {
  setFetch(async () => responseOf(200, { cluster_name: 'x', status: 'green', timed_out: false, number_of_nodes: 1, number_of_data_nodes: 1, active_primary_shards: 0, active_shards: 0 }));
  const defs = rpcdef(buildCtx({ req: {} }));
  const result = await defs[METHOD_CLUSTER_HEALTH_PATH]();
  assert.equal(result.cluster_name, 'x');
  assert.equal(result.timed_out, false);
});

test('helper functions cover normalization, mapping, parsing, and logging', () => {
  assert.equal(_test.grpcCodeFor('NOPE'), grpcStatus.UNKNOWN);
  assert.equal(_test.errorWithCode('NOPE', 'bad').code, grpcStatus.UNKNOWN);
  assert.equal(_test.hasOwn(null, 'x'), false);
  assert.equal(_test.firstDefined(undefined, null, 0, 'x'), 0);
  assert.equal(_test.unwrapScalar({ value: { value: 'deep' } }), 'deep');
  assert.equal(_test.toTrimmedString(null), '');
  assert.equal(_test.toTrimmedString({ value: ' x ' }), 'x');
  assert.equal(_test.toFiniteInt('5', 1), 5);
  assert.equal(_test.toFiniteInt('bad', 7), 7);
  assert.equal(_test.toFiniteNumber('1.5', 0), 1.5);
  assert.equal(_test.toFiniteNumber(null, 9), 9);
  assert.equal(_test.toBool('true', false), true);
  assert.equal(_test.toBool('0', true), false);
  assert.equal(_test.toBool(undefined, true), true);
  assert.equal(_test.toJsonString({ a: 1 }), '{"a":1}');
  assert.equal(_test.toJsonString(null), '');
  assert.equal(_test.toJsonString('already'), 'already');
  assert.equal(_test.normalizeBaseUrl('ftp://bad'), '');
  assert.equal(_test.normalizeBaseUrl(''), '');
  assert.equal(_test.normalizeBaseUrl(' https://es.local/// '), 'https://es.local');
  assert.equal(_test.resolveBaseUrl({ elasticsearch_domain: 'https://alias' }), 'https://alias');
  assert.equal(_test.resolveUsername({ elasticsearch_username: 'u1' }), 'u1');
  assert.equal(_test.resolvePassword({ elasticsearch_password: 'p1' }), 'p1');
  assert.equal(_test.resolveUsername({ user: 'u2' }), 'u2');
  assert.equal(_test.resolvePassword({ passwd: 'p2' }), 'p2');
  assert.equal(_test.resolveTimeoutMs(), 5000);
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: 'bad' }, bindings: { timeoutMs: 12 } }), 5000);
  assert.equal(_test.resolveTimeoutMs({ limits: {}, bindings: { timeoutMs: 12 } }), 12);
  assert.deepEqual(_test.buildTlsOptions({}), {});
  assert.deepEqual(_test.buildTlsOptions({ insecureSkipVerify: true }), {
    skipTlsVerify: true, tlsInsecureSkipVerify: true, insecureSkipVerify: true,
  });
  assert.equal(_test.encodeQueryPairs({ a: 'x y', b: '', c: null, d: 0 }), 'a=x%20y&d=0');
  assert.equal(_test.joinPath('https://h/', '/foo/'), 'https://h/foo/');
  assert.equal(_test.buildUrl('https://h', '/foo', { a: 'b' }), 'https://h/foo?a=b');
  assert.equal(_test.mapHttpStatusToCode(401), 'PERMISSION_DENIED');
  assert.equal(_test.mapHttpStatusToCode(403), 'PERMISSION_DENIED');
  assert.equal(_test.mapHttpStatusToCode(400), 'FAILED_PRECONDITION');
  assert.equal(_test.mapHttpStatusToCode(500), 'UNAVAILABLE');
  assert.equal(_test.normalizeClusterHealthLevel({}), '');
  assert.throws(() => _test.normalizeClusterHealthLevel({ level: 'x' }), /INVALID_ARGUMENT/);
  assert.equal(_test.normalizeClusterHealthLevel({ level: 'cluster' }), 'cluster');
  assert.equal(_test.normalizeWaitForStatus({}), '');
  assert.throws(() => _test.normalizeWaitForStatus({ wait_for_status: 'orange' }), /INVALID_ARGUMENT/);
  assert.equal(_test.normalizeWaitForStatus({ wait_for_status: 'green' }), 'green');
  assert.equal(_test.normalizeBytes({}), '');
  assert.throws(() => _test.normalizeBytes({ bytes: 'tb' }), /INVALID_ARGUMENT/);
  assert.equal(_test.normalizeBytes({ bytes: 'kb' }), 'kb');
  assert.equal(_test.normalizeIndexFilter({}), '');
  assert.equal(_test.normalizeIndexFilter({ pattern: 'logs-*' }), 'logs-*');
  assert.throws(() => _test.requireBaseUrl({ bindings: {} }), /INVALID_ARGUMENT/);
  assert.throws(() => _test.requireCredentials({ bindings: {} }), /INVALID_ARGUMENT/);
  assert.throws(() => _test.requireIndex({}), /INVALID_ARGUMENT/);
  assert.throws(() => _test.requireSearchIndex({}), /INVALID_ARGUMENT/);
  assert.equal(_test.resolveSearchQuery({}), '{"match_all":{}}');
  assert.equal(_test.resolveSearchQuery({ query: '{"match_all":{}}' }), '{"match_all":{}}');
  assert.equal(_test.resolveSearchQuery({ query: { match: { msg: 'hi' } } }), '{"match":{"msg":"hi"}}');
  assert.equal(_test.buildBasicAuth('u', 'p'), `Basic ${Buffer.from('u:p').toString('base64')}`);
  assert.deepEqual(_test.mapIndexSummary({ index: 'i', 'docs.count': '7' }), {
    health: '', status: '', index: 'i', uuid: '', pri: '', rep: '', docs_count: '7', docs_deleted: '', store_size: '', pri_store_size: '',
  });
  assert.deepEqual(_test.mapNodeSummary({ name: 'n', 'heap.percent': '5' }), {
    ip: '', name: 'n', heap_percent: '5', ram_percent: '', cpu: '', load_1m: '', load_5m: '', load_15m: '', node_role: '', master: '',
  });
  assert.deepEqual(_test.mapSearchHit({ _index: 'i', _id: '1', _score: 0.5, _source: { a: 1 }, _type: '_doc', _version: 1, _seq_no: 0, _primary_term: 1 }), {
    index: 'i', id: '1', score: 0.5, source: '{"a":1}',
    type: '_doc', version: 1, seq_no: 0, primary_term: 1,
    sort_json: '', fields_json: '', highlight_json: '',
    explanation_json: '', matched_queries_json: '',
    inner_hits_json: '', ignored_json: '',
  });

  // New mappers
  const a = _test.mapIndexAlias({ is_write_index: true, is_hidden: false });
  assert.equal(a.is_write_index, true);
  assert.equal(a.is_hidden, false);
  const aDef = _test.mapIndexAlias({});
  assert.equal(aDef.is_write_index, false);

  const aliases = _test.mapIndexAliases({ a1: { is_write_index: true }, a2: { search_routing: 'r' } });
  assert.equal(aliases.aliases.a1.is_write_index, true);
  assert.equal(aliases.aliases.a2.search_routing, 'r');
  assert.match(aliases.raw_json, /a1/);

  // else branch: def is not a proper object (e.g. string alias name)
  const aliasSimp = _test.mapIndexAliases({ a1: 'simple_string' });
  assert.equal(aliasSimp.aliases.a1.is_write_index, false);
  assert.equal(aliasSimp.aliases.a1.raw_json, 'simple_string');
  // else branch: def is null
  const aliasNull = _test.mapIndexAliases({ n1: null });
  assert.equal(aliasNull.aliases.n1.is_write_index, false);
  assert.equal(aliasNull.aliases.n1.raw_json, '');

  // toBool fallback (unrecognized string returns false by default)
  assert.equal(_test.toBool('maybe'), false);

  const m = _test.mapIndexMapping({ dynamic: 'true', properties: { msg: { type: 'text' }, ts: { type: 'date' }, meta: { type: 'object' } } });
  assert.equal(m.dynamic, true);
  assert.equal(m.properties.msg.type, 'text');
  assert.equal(m.properties.ts.type, 'date');
  // 'meta' is type:'object' (not string) but still has 'type' key, should be included
  assert.equal(m.properties.meta.type, 'object');
  // Non-type entries (e.g. nested fields) are exposed with empty type
  const m2 = _test.mapIndexMapping({ properties: { nested: { properties: { x: { type: 'long' } } } } });
  assert.equal(m2.properties.nested.type, '');
  assert.match(m2.properties.nested.raw_json, /long/);

  const mf = _test.mapIndexMappingField({ type: 'text', analyzer: 'standard' });
  assert.equal(mf.type, 'text');
  assert.match(mf.raw_json, /text/);

  const s = _test.mapIndexSetting({ index: { number_of_shards: '1', number_of_replicas: '0' } });
  assert.equal(s.number_of_shards, '1');
  assert.equal(s.number_of_replicas, '0');

  const { ok: okEmpty } = _test.tryParseJson('');
  assert.equal(okEmpty, false);
  const { ok, value } = _test.tryParseJson('{"a":1}');
  assert.equal(ok, true);
  assert.deepEqual(value, { a: 1 });

  assert.deepEqual(_test.mergedBindings({ config: { a: 1 }, secret: { b: 2 }, bindings: { a: 3 } }), { a: 3, b: 2 });
  assert.deepEqual(_test.resolveCallContext().req, {});
  assert.deepEqual(_test.resolveCallContext({ request: { index: 'a' } }).req, { index: 'a' });

  const err = _test.attachResponse(_test.errorWithCode('UNAVAILABLE', 'x'), { http_status: 0, http_body: 'x' });
  assert.deepEqual(err.response, { http_status: 0, http_body: 'x' });

  const logs = [];
  console.log = (...args) => logs.push(args);
  _test.logFlow(buildCtx({ meta: { instance_id: 'i', request_id: 'r' } }), 'action', { ok: true });
  _test.logFlow({}, 'fallback', { ok: false });
  assert.match(logs[0][0], /\[Elasticsearch_7_10_0\]\[action\]\[inst=i req=r\]/);
  assert.match(logs[1][0], /\[Elasticsearch_7_10_0\]\[fallback\]/);
});

test('mock upstream end-to-end coverage for all methods', async () => {
  const mock = createMockServer();
  const baseUrl = await mock.start();
  try {
    const ctx = buildCtx({ config: { baseUrl }, secret: { username: DEFAULT_USER, password: DEFAULT_PASSWORD } });
    const ctxNoCreds = buildCtx({ config: { baseUrl }, secret: { username: '', password: '' } });

    // ClusterHealth
    const health = await handlers[METHOD_CLUSTER_HEALTH_FULL]({}, ctx);
    assert.equal(health.cluster_name, 'mock-cluster');
    assert.equal(health.status, 'green');
    assert.equal(health.timed_out, false);
    assert.equal(health.number_of_nodes, 3);
    assert.equal(health.active_shards_percent_as_number, 100);

    // ListIndices
    const list = await handlers[METHOD_LIST_INDICES_FULL]({}, ctx);
    assert.equal(list.indices.length, 2);
    assert.equal(list.indices[0].index, 'logs-2026.01');

    const filtered = await handlers[METHOD_LIST_INDICES_FULL]({ index: 'logs-*' }, ctx);
    assert.equal(filtered.indices.length, 2);

    // GetIndex
    const idx = await handlers[METHOD_GET_INDEX_FULL]({ index: 'logs' }, ctx);
    assert.equal(idx.index, 'logs');
    assert.match(idx.raw_body, /logs/);
    // aliases/mappings/settings are wrapped in index-name key
    const aliasMap = idx.aliases.logs.aliases;
    assert.equal(aliasMap['alias-write'].is_write_index, true);
    assert.equal(idx.mappings.logs.properties.message.type, 'text');
    assert.equal(idx.settings.logs.number_of_shards, '1');
    assert.equal(idx.settings.logs.number_of_replicas, '1');
    assert.equal(idx.settings.logs.refresh_interval, '1s');

    // SearchDocuments
    const search = await handlers[METHOD_SEARCH_DOCUMENTS_FULL]({ index: 'logs' }, ctx);
    assert.equal(search.total_hits, 2);
    assert.equal(search.total_hits_relation, 'eq');
    assert.equal(search.hits.length, 2);
    assert.equal(search.hits[0].index, 'logs');
    assert.equal(search.shards_total, 1);
    assert.equal(search.shards_successful, 1);
    assert.equal(search.shards_failed, 0);
    assert.match(search.scroll_id, /DXF1/);
    assert.equal(search.hits[0].type, '_doc');
    assert.equal(search.hits[0].version, 1);
    assert.match(search.hits[0].highlight_json, /em/);
    assert.match(search.hits[1].ignored_json, /level/);

    // ListNodes
    const nodes = await handlers[METHOD_LIST_NODES_FULL]({}, ctx);
    assert.equal(nodes.nodes.length, 2);
    assert.equal(nodes.nodes[0].master, '*');

    // 404 from upstream
    setFetch(originalFetch);
    const fetched = await fetch(`${baseUrl}/missing`, { headers: { Authorization: `Basic ${Buffer.from(`${DEFAULT_USER}:${DEFAULT_PASSWORD}`).toString('base64')}` } });
    assert.equal(fetched.status, 404);

    const bad = await fetch(`${baseUrl}/_cluster/health`, { headers: { Authorization: `Basic ${Buffer.from('bad:pw').toString('base64')}` } });
    assert.equal(bad.status, 403);

    const noAuth = await fetch(`${baseUrl}/_cluster/health`);
    assert.equal(noAuth.status, 401);

    // Verify handler-side validation also rejects empty credentials
    await expectGrpcError(
      () => handlers[METHOD_CLUSTER_HEALTH_FULL]({}, ctxNoCreds),
      'INVALID_ARGUMENT', (err) => assert.match(err.message, /username and password/));
  } finally { await mock.close(); }
});

test('SearchDocuments accepts object query (stringified)', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return responseOf(200, { took: 1, timed_out: false, hits: { total: { value: 0, relation: 'eq' }, max_score: null, hits: [] } });
  });
  await handlers[METHOD_SEARCH_DOCUMENTS_FULL](
    { index: 'logs', query: { match: { msg: 'hi' } }, size: 5, from: 0 },
    buildCtx(),
  );
  const sent = JSON.parse(captured.init.body);
  assert.deepEqual(sent.query, { match: { msg: 'hi' } });
});

test('GetIndex returns default-shaped result when entry is missing', async () => {
  setFetch(async () => responseOf(200, { unknown_index: { aliases: {}, mappings: {}, settings: {} } }));
  const result = await handlers[METHOD_GET_INDEX_FULL]({ index: 'logs' }, buildCtx());
  // Picks the unknown_index fallback
  assert.equal(result.index, 'logs');
  assert.deepEqual(result.aliases.logs.aliases, {});
  assert.deepEqual(result.mappings.logs.properties, {});
  assert.equal(result.settings.logs.raw_json, '{}');
});