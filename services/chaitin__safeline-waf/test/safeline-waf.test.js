import test from 'node:test';
import assert from 'node:assert/strict';

const deletePath = '/Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/DeleteIPGroup';
const aggregatePath = '/Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/AggregateDetectLogBySrcIP';
const createPath = '/Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/CreateIPGroup';
const updatePath = '/Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/UpdateIPGroup';
const listPath = '/Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/ListIPGroups';
const deleteItemsPath = '/Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/DeleteIPGroupItems';
const addItemsPath = '/Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/AddIPGroupItems';
const detectorStatePath = '/Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/GetDetectorState';
const updateDetectorStatePath = '/Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/UpdateDetectorState';
const blockIpPath = '/Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/BlockIP';
const unblockIpPath = '/Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/UnblockIP';

const buildCtx = (req = {}, overrides = {}) => {
  const legacyToken = req?.api_token ?? req?.apiToken;
  const secret = overrides.secret === undefined && legacyToken !== undefined
    ? { api_token: legacyToken }
    : (overrides.secret || {});
  return {
    bindings: { restBaseUrl: 'http://localhost:18080', headers: { 'X-Extra': 'demo' }, ...overrides.bindings },
    config: overrides.config || {},
    secret,
    limits: { timeoutMs: 10_000, ...overrides.limits },
    meta: { instance_id: 'inst', request_id: 'req', ...overrides.meta },
    req,
  };
};

const setFetch = (impl) => {
  global.fetch = impl;
};

const loadHandler = async (req, overrides = {}) => {
  const { rpcdef } = await import('../src/safeline-waf.js');
  const ctx = buildCtx(req, overrides);
  return rpcdef(ctx)[deletePath];
};

const loadAggregateHandler = async (req, overrides = {}) => {
  const { rpcdef } = await import('../src/safeline-waf.js');
  const ctx = buildCtx(req, overrides);
  return rpcdef(ctx)[aggregatePath];
};

const loadCreateHandler = async (req, overrides = {}) => {
  const { rpcdef } = await import('../src/safeline-waf.js');
  const ctx = buildCtx(req, overrides);
  return rpcdef(ctx)[createPath];
};

const loadUpdateHandler = async (req, overrides = {}) => {
  const { rpcdef } = await import('../src/safeline-waf.js');
  const ctx = buildCtx(req, overrides);
  return rpcdef(ctx)[updatePath];
};

const loadListHandler = async (req, overrides = {}) => {
  const { rpcdef } = await import('../src/safeline-waf.js');
  const ctx = buildCtx(req, overrides);
  return rpcdef(ctx)[listPath];
};

const loadDeleteItemsHandler = async (req, overrides = {}) => {
  const { rpcdef } = await import('../src/safeline-waf.js');
  const ctx = buildCtx(req, overrides);
  return rpcdef(ctx)[deleteItemsPath];
};


const loadAddItemsHandler = async (req, overrides = {}) => {
  const { rpcdef } = await import('../src/safeline-waf.js');
  const ctx = buildCtx(req, overrides);
  return rpcdef(ctx)[addItemsPath];
};

const loadDetectorStateHandler = async (req, overrides = {}) => {
  const { rpcdef } = await import('../src/safeline-waf.js');
  const ctx = buildCtx(req, overrides);
  return rpcdef(ctx)[detectorStatePath];
};

const loadUpdateDetectorStateHandler = async (req, overrides = {}) => {
  const { rpcdef } = await import('../src/safeline-waf.js');
  const ctx = buildCtx(req, overrides);
  return rpcdef(ctx)[updateDetectorStatePath];
};

const loadBlockIpHandler = async (req, overrides = {}) => {
  const { rpcdef } = await import('../src/safeline-waf.js');
  const ctx = buildCtx(req, overrides);
  return rpcdef(ctx)[blockIpPath];
};

const loadUnblockIpHandler = async (req, overrides = {}) => {
  const { rpcdef } = await import('../src/safeline-waf.js');
  const ctx = buildCtx(req, overrides);
  return rpcdef(ctx)[unblockIpPath];
};

const mockFetch = (impl) => {
  setFetch(async (...args) => impl(...args));
};

test('internal helpers normalize bindings, headers, errors, and call context', async () => {
  const { _test } = await import('../src/safeline-waf.js');

  assert.deepEqual(_test.mergedBindings({
    config: { endpoint: 'http://config', keep: 'config', apiToken: 'config-token' },
    secret: { apiToken: 'secret' },
    bindings: { endpoint: 'http://binding', apiToken: 'binding-token' },
  }), {
    endpoint: 'http://binding',
    keep: 'config',
    apiToken: 'secret',
  });

  assert.deepEqual(_test.parseHeaders(undefined), {});
  assert.deepEqual(_test.parseHeaders(''), {});
  assert.deepEqual(_test.parseHeaders('{"X-Test":"yes"}'), { 'X-Test': 'yes' });
  assert.deepEqual(_test.parseHeaders('{'), {});
  assert.deepEqual(_test.parseHeaders('[]'), {});
  assert.deepEqual(_test.parseHeaders(['bad']), {});

  assert.deepEqual(_test.toValue(['x', null]), { listValue: { values: [{ stringValue: 'x' }] } });
  assert.deepEqual(_test.toValue({ a: undefined, b: null }), {
    structValue: {
      fields: {
        a: { nullValue: 'NULL_VALUE' },
        b: { nullValue: 'NULL_VALUE' },
      },
    },
  });
  assert.deepEqual(_test.toValue(Symbol.for('x')), { stringValue: 'Symbol(x)' });
  assert.equal(_test.toPositiveInt({}), null);
  assert.equal(_test.toPositiveInt({ value: '7' }), 7);
  assert.deepEqual(_test.normalizeList([{ id: 1 }]), [{ id: 1 }]);
  assert.deepEqual(_test.normalizeList({ list: [1] }), [1]);
  assert.deepEqual(_test.normalizeList({ data: [2] }), [2]);
  assert.equal(_test.unwrapString({ value: null }), '');
  assert.deepEqual(_test.extractOriginalValues(undefined), []);
  assert.deepEqual(_test.extractOriginalValues({}), []);
  assert.deepEqual(_test.extractOriginalValues({ values: null }), []);
  assert.equal(_test.extractOriginalValues({ values: 'bad' }), null);
  assert.deepEqual(_test.extractIntList({ values: null }), []);
  assert.deepEqual(_test.extractIntList({ values: [{ value: 9 }] }), [9]);
  assert.equal(_test.extractIntList({}), null);
  assert.equal(_test.extractIntList([null]), null);
  assert.equal(_test.extractIntList(['bad']), null);
  assert.equal(_test.toBooleanStrict(0), false);
  assert.equal(_test.toBooleanStrict(1), true);
  assert.equal(_test.toBooleanStrict(Number.NaN), false);
  assert.equal(_test.toBooleanStrict('true'), true);
  assert.equal(_test.toBooleanStrict('false'), false);
  assert.equal(_test.toBooleanStrict('1'), true);
  assert.equal(_test.toBooleanStrict('0'), false);
  assert.equal(_test.toBooleanStrict({}), true);
  assert.equal(_test.toBoolean({ value: 'false' }), false);
  assert.equal(_test.toBoolean(1), true);
  assert.equal(_test.toBoolean(2), null);
  assert.equal(_test.toBoolean({}), null);
  assert.equal(_test.toQueryNumber({ value: 3 }), 3);
  assert.equal(_test.toQueryNumber(-1), undefined);
  assert.equal(_test.toQueryNumber(-1, true), undefined);

  const unknown = _test.errorWithCode('SOMETHING_NEW', 'message');
  assert.equal(unknown.legacyCode, 'SOMETHING_NEW');
  assert.match(unknown.message, /SOMETHING_NEW: message/);

  assert.deepEqual(_test.resolveCallContext({ config: { a: 1 } }, { x: 1 }, { secret: { b: 2 } }), {
    req: { x: 1 },
    ctx: {
      config: { a: 1 },
      secret: { b: 2 },
      bindings: {},
      limits: {},
      meta: {},
      metadata: {},
      getMetadata: undefined,
    },
  });
});

test('AggregateDetectLogBySrcIP validates request fields before downstream call', async () => {
  const noToken = await loadAggregateHandler({});
  await assert.rejects(() => noToken(), /INVALID_ARGUMENT: api_token is required/);

  const badInterval = await loadAggregateHandler({ api_token: 'token', time_interval: 86401 });
  await assert.rejects(() => badInterval(), /time_interval must be integer/);

  const badLogSize = await loadAggregateHandler({ api_token: 'token', log_size: 0 });
  await assert.rejects(() => badLogSize(), /log_size must be integer/);

  const badCondition = await loadAggregateHandler({ api_token: 'token', condition: 'bad' });
  await assert.rejects(() => badCondition(), /condition must be one of/);

  const badBaseUrl = await loadAggregateHandler({ api_token: 'token' }, { bindings: { restBaseUrl: 'ftp://bad' } });
  await assert.rejects(() => badBaseUrl(), /restBaseUrl\/baseUrl is required/);
});

test('AggregateDetectLogBySrcIP forwards query, headers, TLS flag, and maps records', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ data: { list: [{ event_id: 'evt-1', src_ip: '1.1.1.1', count: 2 }] } }),
    };
  });

  const handler = await loadAggregateHandler({
    api_token: 'token',
    time_interval: { value: 60 },
    log_size: { value: 2 },
    condition: 'attack_type',
  }, {
    bindings: { restBaseUrl: 'http://localhost:18080/', skipTlsVerify: true },
  });
  const res = await handler();

  assert.equal(captured.url, 'http://localhost:18080/api/DetectLogAggregateView?time_interval=60&log_size=2&condition=attack_type');
  assert.equal(captured.init.method, 'GET');
  assert.equal(captured.init.headers['API-TOKEN'], 'token');
  assert.equal(Object.hasOwn(captured.init, 'skipTlsVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'tlsInsecureSkipVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'insecureSkipVerify'), false);
  assert.ok(captured.init.dispatcher);
  assert.equal(res.records[0].event_id, 'evt-1');
  assert.equal(res.records[0].src_ip, '1.1.1.1');
  assert.equal(res.records[0].count, 2);
});

test('AggregateDetectLogBySrcIP handles response variants and errors', async () => {
  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => '',
  }));
  const emptyHandler = await loadAggregateHandler({ api_token: 'token' });
  assert.deepEqual(await emptyHandler(), { records: [] });

  setFetch(async () => ({
    ok: false,
    status: 500,
    headers: new Map([['content-type', 'text/plain']]),
    text: async () => 'boom',
  }));
  const serverError = await loadAggregateHandler({ api_token: 'token' });
  await assert.rejects(() => serverError(), /UNAVAILABLE: upstream http 500: boom/);

  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'text/plain']]),
    text: async () => 'not json',
  }));
  const nonJson = await loadAggregateHandler({ api_token: 'token' });
  await assert.rejects(() => nonJson(), /UNKNOWN: response is not valid JSON/);

  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify({ ok: true }),
  }));
  const noList = await loadAggregateHandler({ api_token: 'token' });
  await assert.rejects(() => noList(), /UNKNOWN: response has no list to map/);
});

test('CreateIPGroup validates and posts payload', async () => {
  const noToken = await loadCreateHandler({});
  await assert.rejects(() => noToken(), /INVALID_ARGUMENT: api_token is required/);

  const noName = await loadCreateHandler({ api_token: 'token' });
  await assert.rejects(() => noName(), /INVALID_ARGUMENT: name is required/);

  const badOriginal = await loadCreateHandler({ api_token: 'token', name: 'group', original: 'bad' });
  await assert.rejects(() => badOriginal(), /INVALID_ARGUMENT: original must be an array/);

  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ id: 123, name: 'group', comment: 'c', original: ['1.1.1.1'], cidrs: ['1.1.1.1/32'] }),
    };
  });
  const handler = await loadCreateHandler({ api_token: 'token', name: ' group ', comment: 'c', original: ['1.1.1.1'] });
  const res = await handler();
  assert.equal(captured.url, 'http://localhost:18080/api/IPGroupAPI');
  assert.equal(captured.init.method, 'POST');
  assert.deepEqual(JSON.parse(captured.init.body), { name: 'group', comment: 'c', original: ['1.1.1.1'] });
  assert.equal(res.id, 123);
});

test('CreateIPGroup maps upstream failures and non-json success', async () => {
  setFetch(async () => ({
    ok: false,
    status: 422,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => 'invalid',
  }));
  const failed = await loadCreateHandler({ api_token: 'token', name: 'group' });
  await assert.rejects(() => failed(), /FAILED_PRECONDITION: upstream http 422: invalid/);

  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'text/plain']]),
    text: async () => 'not json',
  }));
  const nonJson = await loadCreateHandler({ api_token: 'token', name: 'group' });
  await assert.rejects(() => nonJson(), /UNKNOWN: response is not valid JSON/);
});

test('UpdateIPGroup validates partial update payloads', async () => {
  const noToken = await loadUpdateHandler({});
  await assert.rejects(() => noToken(), /INVALID_ARGUMENT: api_token is required/);

  const noId = await loadUpdateHandler({ api_token: 'token' });
  await assert.rejects(() => noId(), /INVALID_ARGUMENT: id is required/);

  const badId = await loadUpdateHandler({ api_token: 'token', id: 'bad', name: 'group' });
  await assert.rejects(() => badId(), /INVALID_ARGUMENT: id must be an integer/);

  const noFields = await loadUpdateHandler({ api_token: 'token', id: 1 });
  await assert.rejects(() => noFields(), /at least one field/);

  const badOriginal = await loadUpdateHandler({ api_token: 'token', id: 1, original: 'bad' });
  await assert.rejects(() => badOriginal(), /INVALID_ARGUMENT: original must be a list/);
});

test('UpdateIPGroup sends wrapper fields and maps response', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ id: '9', name: 'next', comment: '', original: [], cidrs: [] }),
    };
  });

  const handler = await loadUpdateHandler({
    api_token: 'token',
    id: '9',
    Name: { value: 'next' },
    Comment: { value: '' },
    Original: { values: [] },
  });
  const res = await handler();
  assert.equal(captured.init.method, 'PUT');
  assert.deepEqual(JSON.parse(captured.init.body), { id: 9, name: 'next', comment: '', original: [] });
  assert.equal(res.id, '9');
  assert.equal(res.name, 'next');
});

test('ListIPGroups validates filters and maps list variants', async () => {
  const noToken = await loadListHandler({});
  await assert.rejects(() => noToken(), /INVALID_ARGUMENT: api_token is required/);

  const badName = await loadListHandler({ api_token: 'token', name: 'bad' });
  await assert.rejects(() => badName(), /INVALID_ARGUMENT: name must be an array/);

  const badComment = await loadListHandler({ api_token: 'token', comment: 'bad' });
  await assert.rejects(() => badComment(), /INVALID_ARGUMENT: comment must be an array/);

  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ err: null, msg: 'ok', data: { items: [{ id: '7', name: 'group' }], total: '1' } }),
    };
  });
  const handler = await loadListHandler({
    api_token: 'token',
    Name: { values: ['group'] },
    Cidr: { value: '1.1.1.1/32' },
    Comment: { values: ['comment'] },
    Count: { value: 10 },
    Offset: { value: 0 },
  });
  const res = await handler();
  assert.match(captured.url, /name=group/);
  assert.match(captured.url, /cidr=1\.1\.1\.1%2F32/);
  assert.match(captured.url, /comment=comment/);
  assert.match(captured.url, /count=10/);
  assert.match(captured.url, /offset=0/);
  assert.equal(captured.init.method, 'GET');
  assert.deepEqual(res.data.items, [{ id: 7, name: 'group' }]);
  assert.equal(res.data.total, 1);
  assert.deepEqual(res.err, undefined);
  assert.deepEqual(res.msg, { stringValue: 'ok' });
});

test('ListIPGroups handles empty, root-level arrays, and upstream errors', async () => {
  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => '',
  }));
  const empty = await loadListHandler({ api_token: 'token' });
  assert.deepEqual(await empty(), { err: null, msg: null, data: { list: [] } });

  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'text/plain']]),
    text: async () => JSON.stringify([{ id: '2', name: 'root' }]),
  }));
  const rootList = await loadListHandler({ api_token: 'token' });
  assert.deepEqual((await rootList()).data.items, [{ id: 2, name: 'root' }]);

  setFetch(async () => ({
    ok: false,
    status: 401,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => 'unauthorized',
  }));
  const unauthorized = await loadListHandler({ api_token: 'token' });
  await assert.rejects(() => unauthorized(), /PERMISSION_DENIED: upstream http 401: unauthorized/);
});

test('ListIPGroups covers item response variants and network failures', async () => {
  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify({ list: [{ id: 'bad', name: null }], err: { code: 0 }, msg: true }),
  }));
  const rootList = await loadListHandler({ api_token: 'token' });
  const rootRes = await rootList();
  assert.deepEqual(rootRes.data.items, [{ id: 0, name: '' }]);
  assert.deepEqual(rootRes.err, { structValue: { fields: { code: { numberValue: 0 } } } });
  assert.deepEqual(rootRes.msg, { boolValue: true });

  setFetch(async () => ({
    ok: false,
    status: 503,
    headers: new Map([['content-type', 'text/plain']]),
    text: async () => 'down',
  }));
  const unavailable = await loadListHandler({ api_token: 'token' });
  await assert.rejects(() => unavailable(), /UNAVAILABLE: upstream http 503: down/);

  setFetch(async () => {
    throw new Error('network down');
  });
  const network = await loadListHandler({ api_token: 'token' });
  await assert.rejects(() => network(), /UNAVAILABLE: network down/);

  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'text/plain']]),
    text: async () => 'not json',
  }));
  const nonJson = await loadListHandler({ api_token: 'token' });
  await assert.rejects(() => nonJson(), /UNKNOWN: response is not valid JSON/);
});

test('DeleteIPGroup rejects missing api_token', async () => {
  const handler = await loadHandler({});
  await assert.rejects(() => handler(), /INVALID_ARGUMENT: api_token is required/);
});

test('DeleteIPGroup rejects invalid combination', async () => {
  const handler = await loadHandler({ api_token: 't', 'id__in': [1], delete_all_resources: true });
  await assert.rejects(() => handler(), /INVALID_ARGUMENT: id__in and delete_all_resources=true cannot be used together/);
});

test('DeleteIPGroup rejects invalid ID lists and invalid base URL', async () => {
  const badShape = await loadHandler({ api_token: 't', id__in: { values: 'bad' } });
  await assert.rejects(() => badShape(), /INVALID_ARGUMENT: id__in must be an int64 list/);

  const badElement = await loadHandler({ api_token: 't', id__in: [{ value: 'bad' }] });
  await assert.rejects(() => badElement(), /INVALID_ARGUMENT: id__in must be an int64 list/);

  const badBaseUrl = await loadHandler({ api_token: 't', id__in: [1] }, { bindings: { restBaseUrl: 'bad' } });
  await assert.rejects(() => badBaseUrl(), /restBaseUrl\/baseUrl is required/);
});

test('DeleteIPGroup sends id__in payload', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ err: null, msg: 'ok', data: { deleted: [1] } }),
    };
  });
  const handler = await loadHandler({ api_token: 'token', 'id__in': [1, 2] });
  const res = await handler();
  assert.equal(captured.url, 'http://localhost:18080/api/IPGroupAPI');
  assert.equal(captured.init.method, 'DELETE');
  assert.equal(captured.init.headers['API-TOKEN'], 'token');
  const body = JSON.parse(captured.init.body);
  assert.deepEqual(body['id__in'], [1, 2]);
  assert(!('delete_all_resources' in body));
  assert.deepEqual(res.data, { deleted: [1] });
});

test('DeleteIPGroup delete all path', async () => {
  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify({ err: null, msg: 'ok', data: { deleted_all: true } }),
  }));
  const handler = await loadHandler({ api_token: 'token', delete_all_resources: true });
  const res = await handler();
  assert.deepEqual(res.data, { deleted_all: true });
});

test('DeleteIPGroup maps empty body, server error, network failure, and non-json success', async () => {
  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => '',
  }));
  const empty = await loadHandler({ api_token: 'token', delete_all_resources: true });
  assert.deepEqual(await empty(), { err: null, msg: null, data: null });

  setFetch(async () => ({
    ok: false,
    status: 500,
    headers: new Map([['content-type', 'text/plain']]),
    text: async () => 'boom',
  }));
  const serverError = await loadHandler({ api_token: 'token', delete_all_resources: true });
  await assert.rejects(() => serverError(), /UNAVAILABLE: upstream http 500: boom/);

  setFetch(async () => {
    throw Object.assign(new Error('fail'), { cause: new Error('reset') });
  });
  const network = await loadHandler({ api_token: 'token', delete_all_resources: true });
  await assert.rejects(() => network(), /UNAVAILABLE: reset/);

  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'text/plain']]),
    text: async () => 'not json',
  }));
  const nonJson = await loadHandler({ api_token: 'token', delete_all_resources: true });
  await assert.rejects(() => nonJson(), /UNKNOWN: response is not valid JSON/);
});

test('DeleteIPGroupItems requires api_token and id', async () => {
  const handlerNoToken = await loadDeleteItemsHandler({});
  await assert.rejects(() => handlerNoToken(), /INVALID_ARGUMENT: api_token is required/);

  const handlerNoId = await loadDeleteItemsHandler({ api_token: 'token' });
  await assert.rejects(() => handlerNoId(), /INVALID_ARGUMENT: id is required/);
});

test('DeleteIPGroupItems validates id integer', async () => {
  const handler = await loadDeleteItemsHandler({ api_token: 'token', id: 'abc' });
  await assert.rejects(() => handler(), /INVALID_ARGUMENT: id must be an integer/);
});

test('DeleteIPGroupItems validates targets array when provided', async () => {
  const handler = await loadDeleteItemsHandler({ api_token: 'token', id: 1, targets: 'x' });
  await assert.rejects(() => handler(), /INVALID_ARGUMENT: targets must be an array when provided/);
});

test('DeleteIPGroupItems validates null target elements and base URL', async () => {
  const nullTarget = await loadDeleteItemsHandler({ api_token: 'token', id: 1, targets: [null] });
  await assert.rejects(() => nullTarget(), /INVALID_ARGUMENT: targets elements must be non-null strings/);

  const badBaseUrl = await loadDeleteItemsHandler({ api_token: 'token', id: 1 }, { bindings: { restBaseUrl: '' } });
  await assert.rejects(() => badBaseUrl(), /restBaseUrl\/baseUrl is required/);
});

test('DeleteIPGroupItems handles undefined targets and empty array', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ err: null, msg: 'ok', data: null }),
    };
  });

  const handlerNoTargets = await loadDeleteItemsHandler({ api_token: 'token', id: 10 });
  await handlerNoTargets();
  let body = JSON.parse(captured.init.body);
  assert.equal(body.id, 10);
  assert.ok(!('targets' in body));

  const handlerEmptyTargets = await loadDeleteItemsHandler({ api_token: 'token', id: 11, targets: [] });
  await handlerEmptyTargets();
  body = JSON.parse(captured.init.body);
  assert.deepEqual(body.targets, []);
});

test('DeleteIPGroupItems forwards targets array with duplicates', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ err: null, msg: 'ok', data: { removed: 2 } }),
    };
  });
  const handler = await loadDeleteItemsHandler({ api_token: 'token', id: 3, targets: ['1.1.1.1', '1.1.1.1'] });
  const res = await handler();
  const body = JSON.parse(captured.init.body);
  assert.deepEqual(body.targets, ['1.1.1.1', '1.1.1.1']);
  assert.deepEqual(res.data, { removed: 2 });
});

test('DeleteIPGroupItems maps upstream errors', async () => {
  setFetch(async () => ({
    ok: false,
    status: 401,
    headers: new Map([['content-type', 'text/plain']]),
    text: async () => 'unauthorized',
  }));
  const handler = await loadDeleteItemsHandler({ api_token: 'token', id: 1 });
  await assert.rejects(() => handler(), /PERMISSION_DENIED: upstream http 401: unauthorized/);
});

test('DeleteIPGroupItems handles non-json response', async () => {
  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'text/plain']]),
    text: async () => 'not json',
  }));
  const handler = await loadDeleteItemsHandler({ api_token: 'token', id: 1 });
  await assert.rejects(() => handler(), /UNKNOWN: response is not valid JSON/);
});


test('AddIPGroupItems requires api_token and id', async () => {
  const handlerNoToken = await loadAddItemsHandler({});
  await assert.rejects(() => handlerNoToken(), /INVALID_ARGUMENT: api_token is required/);

  const handlerNoId = await loadAddItemsHandler({ api_token: 'token' });
  await assert.rejects(() => handlerNoId(), /INVALID_ARGUMENT: id is required/);
});

test('AddIPGroupItems validates id integer', async () => {
  const handler = await loadAddItemsHandler({ api_token: 'token', id: 'abc' });
  await assert.rejects(() => handler(), /INVALID_ARGUMENT: id must be an integer/);
});

test('AddIPGroupItems validates targets array when provided', async () => {
  const handler = await loadAddItemsHandler({ api_token: 'token', id: 1, targets: 'x' });
  await assert.rejects(() => handler(), /INVALID_ARGUMENT: targets must be an array when provided/);
});

test('AddIPGroupItems validates null target elements, null targets, and base URL', async () => {
  const nullTarget = await loadAddItemsHandler({ api_token: 'token', id: 1, targets: [null] });
  await assert.rejects(() => nullTarget(), /INVALID_ARGUMENT: targets elements must be non-null strings/);

  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => '',
    };
  });
  const nullTargets = await loadAddItemsHandler({ api_token: 'token', id: 1, targets: null });
  assert.deepEqual(await nullTargets(), { err: null, msg: '', data: null });
  assert.deepEqual(JSON.parse(captured.init.body), { id: 1, targets: [] });

  const badBaseUrl = await loadAddItemsHandler({ api_token: 'token', id: 1 }, { bindings: { restBaseUrl: 'x' } });
  await assert.rejects(() => badBaseUrl(), /restBaseUrl\/baseUrl is required/);
});

test('AddIPGroupItems forwards optional targets', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({
        err: null,
        msg: 'ok',
        data: { id: 1, name: 'group', comment: 'c', original: ['1.1.1.1'], cidrs: ['1.1.1.0/24'] }
      }),
    };
  });

  const handlerNoTargets = await loadAddItemsHandler({ api_token: 'token', id: 10 });
  const resNoTargets = await handlerNoTargets();
  assert.equal(captured.url, 'http://localhost:18080/api/EditIPGroupItem');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['API-TOKEN'], 'token');
  let body = JSON.parse(captured.init.body);
  assert.equal(body.id, 10);
  assert.ok(!('targets' in body));
  assert.equal(resNoTargets.data.id, 1);

  const handlerEmptyTargets = await loadAddItemsHandler({ api_token: 'token', id: 11, targets: [] });
  await handlerEmptyTargets();
  body = JSON.parse(captured.init.body);
  assert.deepEqual(body.targets, []);

  const handlerDupTargets = await loadAddItemsHandler({ api_token: 'token', id: 12, targets: ['1.1.1.1', '1.1.1.1'] });
  await handlerDupTargets();
  body = JSON.parse(captured.init.body);
  assert.deepEqual(body.targets, ['1.1.1.1', '1.1.1.1']);
});

test('AddIPGroupItems maps upstream errors', async () => {
  setFetch(async () => ({
    ok: false,
    status: 401,
    headers: new Map([['content-type', 'text/plain']]),
    text: async () => 'unauthorized',
  }));
  const handler = await loadAddItemsHandler({ api_token: 'token', id: 1 });
  await assert.rejects(() => handler(), /PERMISSION_DENIED: upstream http 401: unauthorized/);
});

test('AddIPGroupItems handles non-json response', async () => {
  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'text/plain']]),
    text: async () => 'not json',
  }));
  const handler = await loadAddItemsHandler({ api_token: 'token', id: 1 });
  await assert.rejects(() => handler(), /UNKNOWN: response is not valid JSON/);
});

test('UpdateDetectorState requires api_token and is_enabled', async () => {
  const handlerNoToken = await loadUpdateDetectorStateHandler({});
  await assert.rejects(() => handlerNoToken(), /INVALID_ARGUMENT: api_token is required/);

  const handlerNoFlag = await loadUpdateDetectorStateHandler({ api_token: 'token' });
  await assert.rejects(() => handlerNoFlag(), /INVALID_ARGUMENT: is_enabled is required/);
});

test('UpdateDetectorState validates boolean inputs', async () => {
  const handler = await loadUpdateDetectorStateHandler({ api_token: 'token', is_enabled: 'maybe' });
  await assert.rejects(() => handler(), /INVALID_ARGUMENT: is_enabled must be a boolean/);

  const handlerCamel = await loadUpdateDetectorStateHandler({ api_token: 'token', isEnabled: 'true' });
  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify({ err: null, msg: 'ok', data: null }),
  }));
  const res = await handlerCamel();
  assert.deepEqual(res.msg, { stringValue: 'ok' });
});

test('UpdateDetectorState accepts numeric booleans and maps non-json success', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'text/plain']]),
      text: async () => 'not json',
    };
  });
  const handlerNumber = await loadUpdateDetectorStateHandler({ api_token: 'token', is_enabled: 0 });
  await assert.rejects(() => handlerNumber(), /UNKNOWN: response is not valid JSON/);
  assert.deepEqual(JSON.parse(captured.init.body), { is_enabled: false });

  const badBaseUrl = await loadUpdateDetectorStateHandler({ api_token: 'token', is_enabled: true }, { bindings: { restBaseUrl: 'bad' } });
  await assert.rejects(() => badBaseUrl(), /restBaseUrl\/baseUrl is required/);
});

test('UpdateDetectorState sends PUT with boolean payload and headers', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ err: null, msg: 'updated', data: { status: 'enabled' } }),
    };
  });
  const handler = await loadUpdateDetectorStateHandler({ api_token: 'token', is_enabled: true });
  const res = await handler();
  assert.equal(captured.url, 'http://localhost:18080/api/EnableDisableDetectorAPI');
  assert.equal(captured.init.method, 'PUT');
  assert.equal(captured.init.headers['API-TOKEN'], 'token');
  assert.deepEqual(JSON.parse(captured.init.body), { is_enabled: true });
  assert.deepEqual(res.msg, { stringValue: 'updated' });
  assert.deepEqual(res.data, { status: 'enabled' });
});

test('UpdateDetectorState maps upstream errors and empty body', async () => {
  setFetch(async () => ({
    ok: false,
    status: 401,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => 'unauthorized',
  }));
  const handlerUnauthorized = await loadUpdateDetectorStateHandler({ api_token: 'token', is_enabled: true });
  await assert.rejects(() => handlerUnauthorized(), /PERMISSION_DENIED: upstream http 401: unauthorized/);

  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => '',
  }));
  const handlerEmpty = await loadUpdateDetectorStateHandler({ api_token: 'token', is_enabled: false });
  const resEmpty = await handlerEmpty();
  assert.equal(resEmpty.err, null);
  assert.equal(resEmpty.msg, null);
  assert.equal(resEmpty.data, null);
});

test('GetDetectorState requires api_token', async () => {
  const handler = await loadDetectorStateHandler({});
  await assert.rejects(() => handler(), /INVALID_ARGUMENT: api_token is required/);
});

test('GetDetectorState forwards headers and parses response', async () => {
  let captured;
  mockFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ err: null, msg: 'ok', data: { is_enabled: true, extra: 1 } }),
    };
  });
  const handler = await loadDetectorStateHandler({ api_token: 'token' });
  const res = await handler();
  assert.equal(captured.url, 'http://localhost:18080/api/EnableDisableDetectorAPI');
  assert.equal(captured.init.method, 'GET');
  assert.equal(captured.init.headers['API-TOKEN'], 'token');
  assert.equal(res.data.is_enabled, true);
  assert.equal(res.data.raw.extra, 1);
});

test('GetDetectorState handles empty body and boolean coercions', async () => {
  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => '',
  }));
  const empty = await loadDetectorStateHandler({ api_token: 'token' });
  assert.deepEqual(await empty(), { err: null, msg: '', data: { is_enabled: false, raw: {} } });

  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify({ err: null, msg: '', data: { isEnabled: '0' } }),
  }));
  const stringZero = await loadDetectorStateHandler({ api_token: 'token' });
  assert.equal((await stringZero()).data.is_enabled, false);

  const badBaseUrl = await loadDetectorStateHandler({ api_token: 'token' }, { bindings: { restBaseUrl: 'bad' } });
  await assert.rejects(() => badBaseUrl(), /restBaseUrl\/baseUrl is required/);
});

test('GetDetectorState maps upstream errors', async () => {
  mockFetch(async () => ({
    ok: false,
    status: 401,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify({ err: 'unauth', msg: '' }),
  }));
  const handler401 = await loadDetectorStateHandler({ api_token: 'token' });
  await assert.rejects(() => handler401(), /PERMISSION_DENIED: upstream http 401/);

  mockFetch(async () => ({
    ok: false,
    status: 422,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify({ err: 'invalid', msg: '' }),
  }));
  const handler422 = await loadDetectorStateHandler({ api_token: 'token' });
  await assert.rejects(() => handler422(), /FAILED_PRECONDITION: upstream http 422/);

  mockFetch(async () => ({
    ok: false,
    status: 500,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify({ err: 'oops', msg: '' }),
  }));
  const handler500 = await loadDetectorStateHandler({ api_token: 'token' });
  await assert.rejects(() => handler500(), /UNAVAILABLE: upstream http 500/);
});

test('GetDetectorState handles network failure and non-json body', async () => {
  mockFetch(async () => {
    throw Object.assign(new Error('boom'), { cause: new Error('socket hangup') });
  });
  const networkHandler = await loadDetectorStateHandler({ api_token: 'token' });
  await assert.rejects(() => networkHandler(), /UNAVAILABLE: socket hangup/);

  mockFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'text/plain']]),
    text: async () => 'not json',
  }));
  const handler = await loadDetectorStateHandler({ api_token: 'token' });
  await assert.rejects(() => handler(), /UNKNOWN: response is not valid JSON/);
});

test('BlockIP requires token and non-empty targets', async () => {
  const handlerNoToken = await loadBlockIpHandler({ targets: ['1.1.1.1'] });
  await assert.rejects(() => handlerNoToken(), /INVALID_ARGUMENT: api_token is required/);

  const handlerNoTargets = await loadBlockIpHandler({ api_token: 't' });
  await assert.rejects(() => handlerNoTargets(), /targets is required/);

  const handlerEmptyTargets = await loadBlockIpHandler({ api_token: 't', targets: [] });
  await assert.rejects(() => handlerEmptyTargets(), /targets must be non-empty/);

  const handlerBadTargets = await loadBlockIpHandler({ api_token: 't', targets: 'bad' });
  await assert.rejects(() => handlerBadTargets(), /targets must be an array/);

  const handlerNullTarget = await loadBlockIpHandler({ api_token: 't', targets: [null] });
  await assert.rejects(() => handlerNullTarget(), /targets elements must be non-null strings/);
});

test('BlockIP reuses existing group by name', async () => {
  let calls = [];
  mockFetch(async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/api/IPGroupAPI') && init.method === 'GET') {
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({ err: null, msg: 'ok', data: { list: [{ id: 9, name: 'block_ip' }] } })
      };
    }
    if (url.includes('/api/EditIPGroupItem') && init.method === 'POST') {
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({ err: null, msg: 'ok', data: { id: 9, name: 'block_ip', cidrs: [], original: ['1.1.1.1'] } })
      };
    }
    throw new Error('unexpected call');
  });

  const handler = await loadBlockIpHandler({ api_token: 'token', group_name: 'block_ip', targets: ['1.1.1.1'] });
  const res = await handler();
  assert.equal(calls[0].init.headers['API-TOKEN'], 'token');
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(JSON.parse(calls[1].init.body).id, 9);
  assert.equal(res.data.id, 9);
});

test('BlockIP creates group when not found', async () => {
  let step = 0;
  mockFetch(async (url, init) => {
    if (url.includes('/api/IPGroupAPI') && init.method === 'GET') {
      step += 1;
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({ err: null, msg: 'ok', data: { list: [] } })
      };
    }
    if (url.includes('/api/IPGroupAPI') && init.method === 'POST') {
      step += 1;
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({ id: 7, name: 'block_ip', comment: '', original: [], cidrs: [] })
      };
    }
    if (url.includes('/api/EditIPGroupItem') && init.method === 'POST') {
      step += 1;
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({ err: null, msg: 'ok', data: { id: 7, name: 'block_ip', original: ['1.1.1.1'] } })
      };
    }
    throw new Error('unexpected call');
  });

  const handler = await loadBlockIpHandler({ api_token: 'token', group_name: 'block_ip', comment: 'c', targets: ['1.1.1.1'] });
  const res = await handler();
  assert.equal(step, 3);
  assert.equal(res.data.id, 7);
});

test('BlockIP reports created group without usable id', async () => {
  mockFetch(async (url, init) => {
    if (url.includes('/api/IPGroupAPI') && init.method === 'GET') {
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({ err: null, msg: 'ok', data: { list: [] } })
      };
    }
    if (url.includes('/api/IPGroupAPI') && init.method === 'POST') {
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({ id: 'bad', name: 'block_ip', comment: '', original: [], cidrs: [] })
      };
    }
    throw new Error('unexpected call');
  });

  const handler = await loadBlockIpHandler({ api_token: 'token', group_name: 'block_ip', targets: ['1.1.1.1'] });
  await assert.rejects(() => handler(), /UNKNOWN: created group has no id/);
});

test('UnblockIP requires token and non-empty targets', async () => {
  const handlerNoToken = await loadUnblockIpHandler({ targets: ['1.1.1.1'] });
  await assert.rejects(() => handlerNoToken(), /INVALID_ARGUMENT: api_token is required/);

  const handlerNoTargets = await loadUnblockIpHandler({ api_token: 't' });
  await assert.rejects(() => handlerNoTargets(), /targets is required/);

  const handlerEmptyTargets = await loadUnblockIpHandler({ api_token: 't', targets: [] });
  await assert.rejects(() => handlerEmptyTargets(), /targets must be non-empty/);
});

test('UnblockIP uses existing group id directly', async () => {
  mockFetch(async (url, init) => {
    if (url.includes('/api/EditIPGroupItem') && init.method === 'DELETE') {
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({ err: null, msg: null, data: null })
      };
    }
    throw new Error('unexpected');
  });

  const handler = await loadUnblockIpHandler({ api_token: 't', group_id: 5, targets: ['1.1.1.1'] });
  const res = await handler();
  assert.equal(res.msg, null);
});

test('UnblockIP creates group if missing then deletes', async () => {
  let order = [];
  mockFetch(async (url, init) => {
    if (url.includes('/api/IPGroupAPI') && init.method === 'GET') {
      order.push('list');
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({ err: null, msg: 'ok', data: { list: [] } })
      };
    }
    if (url.includes('/api/IPGroupAPI') && init.method === 'POST') {
      order.push('create');
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({ id: 11, name: 'block_ip', comment: '', original: [], cidrs: [] })
      };
    }
    if (url.includes('/api/EditIPGroupItem') && init.method === 'DELETE') {
      order.push('delete');
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({ err: null, msg: null, data: null })
      };
    }
    throw new Error('unexpected');
  });

  const handler = await loadUnblockIpHandler({ api_token: 't', group_name: 'block_ip', targets: ['1.1.1.1'] });
  await handler();
  assert.deepEqual(order, ['list', 'create', 'delete']);
});

test('SDK handlers accept single context with config and secret', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ err: null, msg: 'ok', data: { deleted: [42] } }),
    };
  });

  const { handlers, METHOD_DELETE_IP_GROUP_FULL } = await import('../src/safeline-waf.js');
  const res = await handlers[METHOD_DELETE_IP_GROUP_FULL]({
    config: {
      endpoint: 'http://localhost:18080',
      headers: { 'X-Extra': 'sdk' },
      apiToken: 'config-token',
    },
    secret: {
      apiToken: 'secret-token',
    },
    request: {
      api_token: 'request-token',
      id__in: [42],
    },
    meta: {
      instance_id: 'inst-sdk',
      request_id: 'req-sdk',
    },
  });

  assert.equal(captured.url, 'http://localhost:18080/api/IPGroupAPI');
  assert.equal(captured.init.headers['API-TOKEN'], 'secret-token');
  assert.equal(captured.init.headers['X-Extra'], 'sdk');
  assert.deepEqual(JSON.parse(captured.init.body), { id__in: [42] });
  assert.deepEqual(res.data, { deleted: [42] });
});

test('SDK handlers accept request plus inner context arguments', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ err: null, msg: null, data: null }),
    };
  });

  const { _test } = await import('../src/safeline-waf.js');
  const registered = _test.registerHandlers({
    bindings: {
      restBaseUrl: 'http://base',
      headers: '{"X-Base":"base"}',
    },
  });
  const res = await registered[deletePath]({ id__in: { values: [{ value: 5 }] } }, {
    bindings: {
      restBaseUrl: 'http://inner',
    },
    secret: {
      api_token: 'inner-token',
    },
    meta: {
      instanceId: 'inst-camel',
      requestId: 'req-camel',
    },
  });

  assert.equal(captured.url, 'http://inner/api/IPGroupAPI');
  assert.equal(captured.init.headers['API-TOKEN'], 'inner-token');
  assert.equal(captured.init.headers['x-engine-instance'], 'inst-camel');
  assert.equal(captured.init.headers['x-request-id'], 'req-camel');
  assert.deepEqual(JSON.parse(captured.init.body), { id__in: [5] });
  assert.deepEqual(res, { err: undefined, msg: undefined, data: null });
});

test('remaining validation and response branches stay compatible', async () => {
  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify({ err: null, msg: 'deleted all', data: { deleted_all: true } }),
  }));
  const deleteNullValues = await loadHandler({ api_token: 'token', id__in: { values: null }, delete_all_resources: true });
  assert.deepEqual((await deleteNullValues()).data, { deleted_all: true });

  const updateOriginalObject = await loadUpdateHandler({ api_token: 'token', id: 1, original: {} });
  setFetch(async (url, init) => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify({ id: JSON.parse(init.body).id, name: '', comment: '', original: JSON.parse(init.body).original, cidrs: [] }),
  }));
  assert.deepEqual((await updateOriginalObject()).original, []);

  const updateOriginalBadValues = await loadUpdateHandler({ api_token: 'token', id: 1, original: { values: 'bad' } });
  await assert.rejects(() => updateOriginalBadValues(), /INVALID_ARGUMENT: original must be a list/);

  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify({ data: [{ id: 3, name: 'data-array' }] }),
  }));
  const dataArray = await loadListHandler({ api_token: 'token' });
  assert.deepEqual((await dataArray()).data.items, [{ id: 3, name: 'data-array' }]);

  setFetch(async () => ({
    ok: false,
    status: 422,
    headers: new Map([['content-type', 'text/plain']]),
    text: async () => 'bad list',
  }));
  const listFailedPrecondition = await loadListHandler({ api_token: 'token' });
  await assert.rejects(() => listFailedPrecondition(), /FAILED_PRECONDITION: upstream http 422: bad list/);

  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify({ err: 'e', msg: ['m'], data: { deleted: true } }),
  }));
  const deleteValues = await loadHandler({ api_token: 'token', id__in: [1] });
  const deleteValuesRes = await deleteValues();
  assert.deepEqual(deleteValuesRes.err, { stringValue: 'e' });
  assert.deepEqual(deleteValuesRes.msg, { listValue: { values: [{ stringValue: 'm' }] } });

  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify({ err: 'e', msg: 'm', data: null }),
  }));
  const deleteItemsValues = await loadDeleteItemsHandler({ api_token: 'token', id: 1, targets: null });
  assert.deepEqual(await deleteItemsValues(), { err: 'e', msg: 'm', data: null });

  const unblockBadTargets = await loadUnblockIpHandler({ api_token: 'token', targets: 'bad' });
  await assert.rejects(() => unblockBadTargets(), /targets must be an array/);

  const unblockNullTarget = await loadUnblockIpHandler({ api_token: 'token', targets: [null] });
  await assert.rejects(() => unblockNullTarget(), /targets elements must be non-null strings/);
});

test('remaining HTTP error branches are mapped consistently', async () => {
  setFetch(async () => {
    throw new Error('create network');
  });
  const createNetwork = await loadCreateHandler({ api_token: 'token', name: 'group' });
  await assert.rejects(() => createNetwork(), /UNAVAILABLE: create network/);

  setFetch(async () => ({
    ok: false,
    status: 503,
    headers: new Map([['content-type', 'text/plain']]),
    text: async () => 'create down',
  }));
  const createUnavailable = await loadCreateHandler({ api_token: 'token', name: 'group' });
  await assert.rejects(() => createUnavailable(), /UNAVAILABLE: upstream http 503: create down/);

  setFetch(async () => ({
    ok: false,
    status: 401,
    headers: new Map([['content-type', 'text/plain']]),
    text: async () => 'update denied',
  }));
  const updateDenied = await loadUpdateHandler({ api_token: 'token', id: 1, name: 'group' });
  await assert.rejects(() => updateDenied(), /PERMISSION_DENIED: upstream http 401: update denied/);

  setFetch(async () => {
    throw new Error('update network');
  });
  const updateNetwork = await loadUpdateHandler({ api_token: 'token', id: 1, name: 'group' });
  await assert.rejects(() => updateNetwork(), /UNAVAILABLE: update network/);

  setFetch(async () => ({
    ok: false,
    status: 503,
    headers: new Map([['content-type', 'text/plain']]),
    text: async () => 'add down',
  }));
  const addUnavailable = await loadAddItemsHandler({ api_token: 'token', id: 1 });
  await assert.rejects(() => addUnavailable(), /UNAVAILABLE: upstream http 503: add down/);

  setFetch(async () => {
    throw new Error('delete item network');
  });
  const deleteItemsNetwork = await loadDeleteItemsHandler({ api_token: 'token', id: 1 });
  await assert.rejects(() => deleteItemsNetwork(), /UNAVAILABLE: delete item network/);

  setFetch(async () => ({
    ok: false,
    status: 503,
    headers: new Map([['content-type', 'text/plain']]),
    text: async () => 'update detector down',
  }));
  const detectorUnavailable = await loadUpdateDetectorStateHandler({ api_token: 'token', is_enabled: true });
  await assert.rejects(() => detectorUnavailable(), /UNAVAILABLE: upstream http 503: update detector down/);
});
