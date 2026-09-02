import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHODS,
  _test,
  handlers,
} from '../src/zhihu-open-api.js';
import { handlers as serviceHandlers, service } from '../src/service.js';

const originalFetch = globalThis.fetch;

const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const fetchQueue = (responses, calls = []) => async (url, options) => {
  calls.push({ url: String(url), options });
  const next = responses.shift();
  if (next instanceof Error) throw next;
  if (!next) throw new Error('unexpected request');
  return next;
};

const context = (responses, req = {}, calls = [], overrides = {}) => ({
  config: { baseUrl: 'https://developer.zhihu.com', ...(overrides.config || {}) },
  secret: { accessSecret: 'secret-123', ...(overrides.secret || {}) },
  fetchImpl: fetchQueue(responses, calls),
  req,
  ...overrides,
});

const okData = (data = {}) => ({ Code: 0, Message: 'success', Data: data });

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('registers every method on the SDK handlers map', () => {
  assert.ok(service);
  for (const method of Object.values(METHODS)) {
    assert.equal(typeof handlers[method], 'function');
    assert.equal(typeof serviceHandlers[method], 'function');
  }
});

test('requires an Access Secret before any request is issued', async () => {
  await assert.rejects(
    handlers[METHODS.GET_HOT_LIST]({ secret: {} }),
    (error) => error.code === grpcStatus.INVALID_ARGUMENT && /accessSecret is required/.test(error.message),
  );
  assert.throws(
    () => _test.resolveSettings({ config: { baseUrl: 'http://example' }, secret: { accessSecret: 'a' } }),
    /baseUrl must use https/,
  );
  assert.throws(
    () => _test.normalizeBaseUrl('not a url'),
    /baseUrl must be a valid URL/,
  );
});

test('CheckConnectivity reports reachable with valid credentials', async () => {
  const calls = [];
  const result = await handlers[METHODS.CHECK_CONNECTIVITY](context([
    response(okData({ Total: 1, Items: [] })),
  ], {}, calls));

  assert.deepEqual(result, { reachable: true, message: 'Zhihu credentials accepted' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://developer.zhihu.com/api/v1/content/hot_list?Limit=1');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret-123');
  assert.match(calls[0].options.headers['X-Request-Timestamp'], /^\d{10}$/);
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
});

test('CheckConnectivity reports unreachable on upstream failure without leaking token', async () => {
  const calls = [];
  const result = await handlers[METHODS.CHECK_CONNECTIVITY](context([
    response({ Code: 20001, Message: '鉴权失败', Data: {} }),
  ], {}, calls));
  assert.equal(result.reachable, false);
  assert.match(result.message, /鉴权失败/);
  assert.doesNotMatch(result.message, /secret-123/);
});

test('ZhihuSearch builds query and returns Data', async () => {
  const calls = [];
  const result = await handlers[METHODS.ZHIHU_SEARCH](context([
    response(okData({ HasMore: false, Items: [{ Title: 'RAG 综述' }] })),
  ], { query: '怎么理解 rave 文化', count: 5 }, calls));

  assert.deepEqual(result.data.Items, [{ Title: 'RAG 综述' }]);
  assert.equal(calls[0].url, 'https://developer.zhihu.com/api/v1/content/zhihu_search?Query=%E6%80%8E%E4%B9%88%E7%90%86%E8%A7%A3+rave+%E6%96%87%E5%8C%96&Count=5');
  assert.equal(calls[0].options.method, 'GET');
});

test('ZhihuSearch requires a non-empty Query and clamps Count', async () => {
  await assert.rejects(
    handlers[METHODS.ZHIHU_SEARCH](context([], { query: '  ' })),
    (error) => error.code === grpcStatus.INVALID_ARGUMENT && /Query is required/.test(error.message),
  );

  const calls = [];
  await handlers[METHODS.ZHIHU_SEARCH](context([response(okData({}))], { query: 'x', count: 100 }, calls));
  assert.match(calls[0].url, /Count=10/);

  const calls2 = [];
  await handlers[METHODS.ZHIHU_SEARCH](context([response(okData({}))], { query: 'x', count: 0 }, calls2));
  assert.match(calls2[0].url, /Count=1/);
});

test('GlobalSearch includes SearchDB default and optional Filter', async () => {
  const calls = [];
  const result = await handlers[METHODS.GLOBAL_SEARCH](context([
    response(okData({ Items: [{ Title: '全网' }] })),
  ], {
    query: 'chatgpt',
    filter: 'host=="example.com" AND publish_time>=1778494631',
    search_db: 'realtime',
  }, calls));

  assert.equal(result.data.Items[0].Title, '全网');
  const url = calls[0].url;
  assert.match(url, /Query=chatgpt/);
  assert.match(url, /SearchDB=realtime/);
  assert.match(url, /Filter=/);
  assert.match(url, /Count=10/);

  const calls2 = [];
  await handlers[METHODS.GLOBAL_SEARCH](context([response(okData({}))], { query: 'x', count: 25 }, calls2));
  assert.match(calls2[0].url, /Count=20/);

  await assert.rejects(
    handlers[METHODS.GLOBAL_SEARCH](context([], { query: 'x', search_db: 'bogus' })),
    /SearchDB must be one of/,
  );
});

test('GetHotList clamps Limit and returns Data', async () => {
  const calls = [];
  const result = await handlers[METHODS.GET_HOT_LIST](context([
    response(okData({ Total: 2, Items: [{ Title: '热榜' }] })),
  ], { limit: 5 }, calls));

  assert.equal(result.data.Total, 2);
  assert.equal(calls[0].url, 'https://developer.zhihu.com/api/v1/content/hot_list?Limit=5');

  const calls2 = [];
  await handlers[METHODS.GET_HOT_LIST](context([response(okData({}))], {}, calls2));
  assert.equal(calls2[0].url, 'https://developer.zhihu.com/api/v1/content/hot_list?Limit=30');
});

test('GetQuota builds the APIIDs query and returns the array Data', async () => {
  // Specific quota items (comma list, whitespace-tolerant, camelCase wire key).
  const calls = [];
  const result = await handlers[METHODS.GET_QUOTA](context([
    response(okData([
      { APIID: 'zhihu_search', APIName: '知乎搜索', TotalQuota: 500, TotalUsed: 12, RemainingQuota: 488 },
      { APIID: 'hot_list', APIName: '热榜', TotalQuota: 30, TotalUsed: 30, RemainingQuota: 0 },
    ])),
  ], { apiIds: 'zhihu_search, hot_list' }, calls));

  assert.equal(calls[0].url, 'https://developer.zhihu.com/api/v1/quota?APIIDs=zhihu_search%2Chot_list');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(result.data[0].APIID, 'zhihu_search');
  assert.equal(result.data[1].RemainingQuota, 0);

  // Snake_case alias and no APIIDs -> no query string (all quota items).
  const calls2 = [];
  await handlers[METHODS.GET_QUOTA](context([response(okData([]))], { api_ids: 'knowledge' }, calls2));
  assert.equal(calls2[0].url, 'https://developer.zhihu.com/api/v1/quota?APIIDs=knowledge');

  const calls3 = [];
  await handlers[METHODS.GET_QUOTA](context([response(okData([]))], {}, calls3));
  assert.equal(calls3[0].url, 'https://developer.zhihu.com/api/v1/quota');

  // Whitespace/empty normalization drops empty tokens and trailing commas.
  assert.deepEqual(_test.buildGetQuotaQuery({ apiIds: '  global_search, , hot_list, ' }), { APIIDs: 'global_search,hot_list' });
  assert.deepEqual(_test.buildGetQuotaQuery({}), {});
  assert.deepEqual(_test.buildGetQuotaQuery({ apiIds: '  ,  ' }), {});
});

test('ListKnowledgeBases validates Scope', async () => {
  const calls = [];
  const result = await handlers[METHODS.LIST_KNOWLEDGE_BASES](context([
    response(okData({ Items: [{ Name: '资料库' }] })),
  ], { scope: 'created' }, calls));
  assert.equal(result.data.Items[0].Name, '资料库');
  assert.equal(calls[0].url, 'https://developer.zhihu.com/api/v1/knowledge/bases?Scope=created');

  await assert.rejects(
    handlers[METHODS.LIST_KNOWLEDGE_BASES](context([], { scope: 'nope' })),
    /Scope must be one of/,
  );
});

test('ListKnowledgeBaseItems requires a knowledge base id and encodes the path', async () => {
  const calls = [];
  const result = await handlers[METHODS.LIST_KNOWLEDGE_BASE_ITEMS](context([
    response(okData({ Items: [{ Title: 'a.pdf' }], HasMore: false })),
  ], { knowledge_base_id: 'kb 1', cursor: 'next', limit: 15 }, calls));

  assert.equal(result.data.HasMore, false);
  assert.equal(calls[0].url, 'https://developer.zhihu.com/api/v1/knowledge/bases/kb%201/items?Cursor=next&Limit=15');

  await assert.rejects(
    handlers[METHODS.LIST_KNOWLEDGE_BASE_ITEMS](context([], {})),
    /knowledge_base_id is required/,
  );
});

test('UploadKnowledgeFile builds a multipart body and forwards metadata', async () => {
  const calls = [];
  const result = await handlers[METHODS.UPLOAD_KNOWLEDGE_FILE](context([
    response(okData({ KnowledgeBaseID: 'kb-1', RecallContentID: 'rc-1', FileName: 'a.pdf' })),
  ], {
    file_name: 'a.pdf',
    file_content: Buffer.from('hello world').toString('base64'),
    knowledge_base_id: 'kb-1',
  }, calls));

  assert.equal(result.data.FileName, 'a.pdf');
  assert.equal(calls[0].url, 'https://developer.zhihu.com/api/v1/knowledge/files');
  assert.equal(calls[0].options.method, 'POST');
  assert.ok(calls[0].options.body instanceof FormData);
  assert.equal(calls[0].options.headers['Content-Type'], undefined);
  assert.ok(!String(calls[0].options.body).includes('secret-123'));
});

test('UploadKnowledgeFile validates file name and content', async () => {
  await assert.rejects(
    handlers[METHODS.UPLOAD_KNOWLEDGE_FILE](context([], { file_content: Buffer.from('x').toString('base64') })),
    /file_name is required/,
  );
  await assert.rejects(
    handlers[METHODS.UPLOAD_KNOWLEDGE_FILE](context([], { file_name: 'a.pdf' })),
    /file_content is required/,
  );
  assert.throws(
    () => _test.buildUploadForm(123, 'a.pdf', ''),
    /file_content must be base64 bytes/,
  );
});

test('SearchKnowledge validates scopes and builds the JSON body', async () => {
  const calls = [];
  const result = await handlers[METHODS.SEARCH_KNOWLEDGE](context([
    response(okData({ Items: [{ DocName: '退款规则' }] })),
  ], {
    query: '退款规则是什么',
    knowledge_base_ids: ['kb-1'],
    recall_scopes: ['personal'],
    limit: 5,
  }, calls));

  assert.equal(result.data.Items[0].DocName, '退款规则');
  assert.equal(calls[0].url, 'https://developer.zhihu.com/api/v1/knowledge/search');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    Query: '退款规则是什么',
    KnowledgeBaseIDs: ['kb-1'],
    RecallScopes: ['personal'],
    Limit: 5,
  });

  await assert.rejects(
    handlers[METHODS.SEARCH_KNOWLEDGE](context([], { query: 'x' })),
    /at least one of knowledge_base_ids or recall_scopes is required/,
  );
  await assert.rejects(
    handlers[METHODS.SEARCH_KNOWLEDGE](context([], { query: '', knowledge_base_ids: ['kb-1'] })),
    /Query is required/,
  );
  await assert.rejects(
    handlers[METHODS.SEARCH_KNOWLEDGE](context([], { query: 'x', knowledge_base_ids: ['kb-1'], recall_scopes: ['public', 'bogus'] })),
    /must be one of personal, subscription, public/,
  );
});

test('user data methods pass OAuth token headers from request and secret', async () => {
  const calls = [];
  await handlers[METHODS.GET_USER_CONTENTS](context([
    response(okData({ Items: [], Paging: { IsEnd: true, Totals: 0 } })),
  ], { content_type: 'answer', oauth_token: 'req-oauth' }, calls));
  assert.equal(calls[0].url, 'https://developer.zhihu.com/api/v1/user/contents?ContentType=answer&Offset=0&Limit=20&SortField=ts&SortOrder=desc');
  assert.equal(calls[0].options.headers['X-OAuth-Token'], 'req-oauth');

  const calls2 = [];
  await handlers[METHODS.GET_USER_FOLLOWEES](context([
    response(okData({ Items: [], Paging: { IsEnd: true, Totals: 0 } })),
  ], { offset: 20, limit: 5 }, calls2, { secret: { accessSecret: 's', oauthToken: 'secret-oauth' } }));
  assert.match(calls2[0].url, /Offset=20&Limit=5/);
  assert.equal(calls2[0].options.headers['X-OAuth-Token'], 'secret-oauth');
});

test('GetUserContents requires a ContentType', async () => {
  await assert.rejects(
    handlers[METHODS.GET_USER_CONTENTS](context([], {})),
    /ContentType must be one of/,
  );
  await assert.rejects(
    handlers[METHODS.GET_USER_CONTENTS](context([], { content_type: 'bad' })),
    /ContentType must be one of/,
  );
});

test('GetUserCollections and GetUserFavlists pass through limits', async () => {
  const calls = [];
  await handlers[METHODS.GET_USER_COLLECTIONS](context([response(okData({ Items: [] }))], { limit: 30 }, calls));
  assert.equal(calls[0].url, 'https://developer.zhihu.com/api/v1/user/collections?Limit=30');

  const calls2 = [];
  await handlers[METHODS.GET_USER_FAVLISTS](context([response(okData({ Items: [] }))], { limit: 10 }, calls2));
  assert.equal(calls2[0].url, 'https://developer.zhihu.com/api/v1/user/favlists?Limit=10');
});

test('GetFavlistContents requires favlist_url_token', async () => {
  const calls = [];
  const result = await handlers[METHODS.GET_FAVLIST_CONTENTS](context([
    response(okData({ Items: [], Paging: { IsEnd: true, Totals: 0 } })),
  ], { favlist_url_token: '123456789', limit: 25 }, calls));
  assert.ok(result.data);
  assert.equal(calls[0].url, 'https://developer.zhihu.com/api/v1/user/favlist_contents?FavlistUrlToken=123456789&Offset=0&Limit=25');

  await assert.rejects(
    handlers[METHODS.GET_FAVLIST_CONTENTS](context([], {})),
    /favlist_url_token is required/,
  );
});

test('maps Zhihu business and HTTP errors to gRPC codes', async () => {
  const cases = [
    [{ Code: 20001, Message: '鉴权失败' }, grpcStatus.UNAUTHENTICATED, 'UNAUTHENTICATED'],
    [response({ Code: 30001, Message: '频率限制' }), grpcStatus.RESOURCE_EXHAUSTED, 'RESOURCE_EXHAUSTED'],
    [response(okData({}), 403), grpcStatus.PERMISSION_DENIED, 'PERMISSION_DENIED'],
    [response({ Code: 40004, Message: '知识库不存在' }), grpcStatus.NOT_FOUND, 'NOT_FOUND'],
    [response({ Code: 10001, Message: '参数错误' }), grpcStatus.INVALID_ARGUMENT, 'INVALID_ARGUMENT'],
    [response({ Code: 50002, Message: '检索失败' }), grpcStatus.UNAVAILABLE, 'UNAVAILABLE'],
    [response({ Code: 90001, Message: '内部错误' }, 500), grpcStatus.UNAVAILABLE, 'UNAVAILABLE'],
    [response({ Code: 40006, Message: '解析失败' }), grpcStatus.FAILED_PRECONDITION, 'FAILED_PRECONDITION'],
  ];
  for (const [item, code, legacyCode] of cases) {
    const responses = item instanceof Response ? [item] : [response(item)];
    await assert.rejects(
      handlers[METHODS.GET_HOT_LIST](context(responses, {})),
      (error) => error.code === code && error.legacyCode === legacyCode,
    );
  }

  assert.equal(_test.mapErrorCode(401), 'UNAUTHENTICATED');
  assert.equal(_test.mapErrorCode(429), 'RESOURCE_EXHAUSTED');
  assert.equal(_test.mapErrorCode(400), 'INVALID_ARGUMENT');
  assert.equal(_test.mapErrorCode(500), 'UNAVAILABLE');
  assert.equal(_test.mapErrorCode(200, 9999), 'UNKNOWN');
});

test('rejects malformed upstream responses without exposing the body', async () => {
  const nonJson = new Response('<html>oops</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  await assert.rejects(
    handlers[METHODS.GET_HOT_LIST](context([nonJson], {})),
    (error) => error.code === grpcStatus.UNKNOWN && /non-JSON/.test(error.message),
  );

  await assert.rejects(
    handlers[METHODS.GET_HOT_LIST](context([response({ Data: {} })], {})),
    (error) => error.code === grpcStatus.UNKNOWN && /missing a numeric Code/.test(error.message),
  );
});

test('falls back to a generic message when upstream omits an error message', async () => {
  await assert.rejects(
    handlers[METHODS.GET_HOT_LIST](context([new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })], {})),
    (error) => error.code === grpcStatus.NOT_FOUND && /Zhihu request failed with HTTP 404/.test(error.message),
  );
  await assert.rejects(
    handlers[METHODS.GET_HOT_LIST](context([new Response(JSON.stringify({ Code: 30001 }), { status: 200, headers: { 'Content-Type': 'application/json' } })], {})),
    (error) => error.code === grpcStatus.RESOURCE_EXHAUSTED && /HTTP 200/.test(error.message),
  );
});

test('requiredString and clampedPositiveInteger reject oversized or non-numeric values', async () => {
  await assert.rejects(
    handlers[METHODS.UPLOAD_KNOWLEDGE_FILE](context([], {
      file_name: 'x'.repeat(256),
      file_content: Buffer.from('x').toString('base64'),
    })),
    /file_name exceeds 255 characters/,
  );
  await assert.rejects(
    handlers[METHODS.GET_HOT_LIST](context([], { limit: 'abc' })),
    /Limit must be an integer/,
  );
  assert.throws(() => _test.requiredString('x'.repeat(5000), 'query'), /query exceeds/);
});

test('network failures and timeouts map to UNAVAILABLE and DEADLINE_EXCEEDED', async () => {
  await assert.rejects(
    handlers[METHODS.GET_HOT_LIST](context([new Error('socket hangup')], {})),
    (error) => error.code === grpcStatus.UNAVAILABLE,
  );
  await assert.rejects(
    handlers[METHODS.GET_HOT_LIST](context([Object.assign(new Error('timed out'), { name: 'TimeoutError' })], {})),
    (error) => error.code === grpcStatus.DEADLINE_EXCEEDED,
  );
});

test('mutations report ambiguous results on network failure', async () => {
  await assert.rejects(
    handlers[METHODS.UPLOAD_KNOWLEDGE_FILE](context([new Error('socket hangup')], {
      file_name: 'a.pdf',
      file_content: Buffer.from('x').toString('base64'),
    })),
    (error) => error.code === grpcStatus.UNAVAILABLE && error.ambiguous === true && /ambiguous/.test(error.message),
  );
});

test('context resolution merges config, secret, and bindings', () => {
  assert.deepEqual(
    _test.mergedBindings({ config: { a: 1 }, secret: { b: 2 }, bindings: { c: 3 } }),
    { a: 1, b: 2, c: 3 },
  );
  const callCtx = _test.resolveCallContext({ request: { query: 'x' } });
  assert.deepEqual(callCtx.req, { query: 'x' });
  assert.deepEqual(_test.resolveCallContext({}).req, {});
  assert.equal(_test.resolveOauthToken({ oauthToken: 's' }, {}), 's');
  assert.equal(_test.resolveOauthToken({ oauthToken: 's' }, { oauth_token: 'r' }), 'r');
  assert.equal(_test.firstDefined(undefined, null, 'x'), 'x');
  assert.equal(_test.hasOwn(null, 'x'), false);
  assert.equal(_test.pick({ Data: 1 }, 'Data', 'data'), 1);
  assert.equal(_test.pick({ data: 2 }, 'Data', 'data'), 2);
  assert.equal(_test.pick({}, 'Data', 'data'), undefined);
  assert.equal(_test.errorWithCode('NOT_REAL', 'x').code, grpcStatus.UNKNOWN);
  assert.throws(() => _test.requiredString('', 'field'), /field is required/);
  assert.equal(_test.sanitizeMessage('  a   b  c  '), 'a b c');
  assert.equal(_test.offsetParam('7'), '7');
  assert.equal(_test.offsetParam(0), '0');
  assert.equal(_test.toBytes(Buffer.from('hi').toString('base64')).length, 2);
  assert.ok(_test.toBytes(new Uint8Array([1, 2])));
  assert.equal(_test.isTimeoutError({ code: 'ABORT_ERR' }), true);
  assert.equal(_test.isTimeoutError(new Error('x')), false);
});

test('nonNegativeInteger rejects negative and fractional values', () => {
  assert.throws(() => _test.nonNegativeInteger(-1, 'Offset'), /non-negative integer/);
  assert.throws(() => _test.nonNegativeInteger(1.5, 'Offset'), /non-negative integer/);
  assert.equal(_test.nonNegativeInteger('3', 'Offset'), 3);
});

test('logInfo falls back to the raw payload for circular structures', () => {
  const original = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args);
  try {
    const circular = {};
    circular.self = circular;
    _test.logInfo({}, 'CircularAction', circular);
    assert.equal(logs.length, 1);
    assert.match(logs[0][0], /Zhihu_Open_Api/);
  } finally {
    console.log = original;
  }
});

test('handlers return an empty Data object when upstream omits it', async () => {
  const calls = [];
  const result = await handlers[METHODS.GET_HOT_LIST](context([response({ Code: 0, Message: 'success' })], {}, calls));
  assert.deepEqual(result, { data: {} });
});

test('parseResponse rejects null, array, and string payloads', async () => {
  for (const body of ['null', '[]', '"just a string"', '123']) {
    await assert.rejects(
      _test.parseResponse(new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } })),
      (error) => error.code === grpcStatus.UNKNOWN && /invalid JSON response/.test(error.message),
    );
  }
});

test('parseResponse maps non-OK HTTP with and without a Message field', async () => {
  await assert.rejects(
    _test.parseResponse(new Response(JSON.stringify({ Code: 0, Message: 'boom' }), { status: 502, headers: { 'Content-Type': 'application/json' } })),
    (error) => error.code === grpcStatus.UNAVAILABLE && /boom/.test(error.message),
  );
  await assert.rejects(
    _test.parseResponse(new Response(JSON.stringify({ Code: 0 }), { status: 502, headers: { 'Content-Type': 'application/json' } })),
    (error) => error.code === grpcStatus.UNAVAILABLE && /HTTP 502/.test(error.message),
  );
  const ok = await _test.parseResponse(new Response(JSON.stringify({ code: 0, data: { a: 1 } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  assert.deepEqual(ok, { data: { a: 1 } });
});

test('respects config timeouts, custom headers, and legacy aliases', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return response(okData({}));
  };
  const result = await handlers[METHODS.GET_HOT_LIST]({
    config: {
      baseUrl: 'https://localhost:18082',
      timeout_ms: 3100,
      headers: { 'X-Custom': 'value' },
    },
    secret: { access_secret: 'legacy-secret' },
    meta: { instance_id: 'inst', request_id: 'req' },
    request: { limit: 2 },
  });
  assert.deepEqual(result.data, {});
  assert.equal(captured.url, 'https://localhost:18082/api/v1/content/hot_list?Limit=2');
  assert.equal(captured.init.headers['X-Custom'], 'value');
  assert.equal(captured.init.headers['x-engine-instance'], 'inst');
  assert.equal(captured.init.headers['x-request-id'], 'req');
  assert.equal(captured.init.headers.Authorization, 'Bearer legacy-secret');
  assert.equal(captured.init.dispatcher, undefined);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.throws(
    () => _test.resolveSettings({ config: { baseUrl: 'https://example', skipTlsVerify: true }, secret: { accessSecret: 'a' } }),
    /TLS certificate verification cannot be disabled/,
  );
  for (const alias of ['tlsInsecureSkipVerify', 'insecureSkipVerify']) {
    assert.throws(
      () => _test.resolveSettings({ config: { baseUrl: 'https://example', [alias]: true }, secret: { accessSecret: 'a' } }),
      /TLS certificate verification cannot be disabled/,
    );
  }
  const settings = _test.resolveSettings({
    config: { baseUrl: 'https://x', timeoutMs: 2000, headers: { a: 'b' } },
    secret: { accessSecret: 's' },
    limits: { timeoutMs: 4000 },
  });
  assert.equal(settings.timeoutMs, 2000);
  assert.equal(settings.headers.a, 'b');
  assert.equal(settings.accessSecret, 's');
});

test('accepts the camelCase field names the SDK delivers on the wire', async () => {
  // The Node SDK decodes gRPC/CLI requests through @bufbuild/protobuf
  // fromJson/fromBinary, which keys message fields by their JSON (camelCase)
  // names. Verify the handlers read those keys for multi-word fields.
  const calls = [];
  await handlers[METHODS.GET_USER_CONTENTS](context([
    response(okData({ Items: [], Paging: { IsEnd: true, Totals: 0 } })),
  ], { contentType: 'all', offset: 20, limit: 5, sortField: 'like_count', sortOrder: 'asc', oauthToken: 'camel-token' }, calls));
  assert.equal(
    calls[0].url,
    'https://developer.zhihu.com/api/v1/user/contents?ContentType=all&Offset=20&Limit=5&SortField=like_count&SortOrder=asc',
  );
  assert.equal(calls[0].options.headers['X-OAuth-Token'], 'camel-token');

  const calls2 = [];
  await handlers[METHODS.GLOBAL_SEARCH](context([response(okData({}))], { query: 'x', searchDb: 'realtime' }, calls2));
  assert.match(calls2[0].url, /SearchDB=realtime/);

  const calls3 = [];
  await handlers[METHODS.LIST_KNOWLEDGE_BASE_ITEMS](context([response(okData({}))], { knowledgeBaseId: 'kb-9' }, calls3));
  assert.match(calls3[0].url, /knowledge\/bases\/kb-9\/items/);

  const calls4 = [];
  await handlers[METHODS.SEARCH_KNOWLEDGE](context([response(okData({}))], {
    query: 'q',
    knowledgeBaseIds: ['kb-1'],
    recallScopes: ['personal'],
  }, calls4));
  assert.deepEqual(JSON.parse(calls4[0].options.body).KnowledgeBaseIDs, ['kb-1']);
});
