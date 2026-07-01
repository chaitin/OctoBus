import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_BATCH_BLOCK_FULL,
  METHOD_BATCH_BLOCK_PATH,
  METHOD_BATCH_UNBLOCK_FULL,
  METHOD_BATCH_UNBLOCK_PATH,
  METHOD_LIST_ENTRIES_FULL,
  METHOD_LIST_ENTRIES_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/threatbook-onesig.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const originalLog = console.log;

const fixedNow = () => {
  Date.now = () => 1700000000000;
};

const response = (status, body) => ({
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const setFetch = (impl) => {
  globalThis.fetch = impl;
};

const abortingFetch = (message = 'request aborted') => (_url, init) => new Promise((resolve, reject) => {
  const abort = () => reject(new Error(message));
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener('abort', abort, { once: true });
});

const buildCtx = (overrides = {}) => ({
  config: {
    base_url: 'https://onesig.example.com',
    ...(overrides.config || {}),
  },
  secret: {
    api_key: 'demoKey',
    secret: 'demoSecret',
    ...(overrides.secret || {}),
  },
  bindings: {
    headers: { 'X-Product': 'miner' },
    ...(overrides.bindings || {}),
  },
  limits: { timeoutMs: 5000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const callHandler = (method, request = {}, ctx = {}) => {
  const handler = handlers[method];
  return handler({ ...ctx, request });
};

const expectGrpcError = async (fn, legacyCode, checker = () => {}) => {
  let caught;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'expected function to reject');
  assert.ok(caught instanceof GrpcError);
  assert.equal(caught.legacyCode, legacyCode);
  assert.equal(caught.code, ({
    FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
    INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
    UNKNOWN: grpcStatus.UNKNOWN,
  })[legacyCode]);
  checker(caught);
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  console.log = originalLog;
});

test('service exports handlers and rpcdef paths', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers[METHOD_BATCH_BLOCK_FULL], 'function');
  assert.equal(typeof handlers[METHOD_LIST_ENTRIES_FULL], 'function');
  assert.equal(typeof handlers[METHOD_BATCH_UNBLOCK_FULL], 'function');
  const defs = rpcdef(buildCtx());
  assert.equal(typeof defs[METHOD_BATCH_BLOCK_PATH], 'function');
  assert.equal(typeof defs[METHOD_LIST_ENTRIES_PATH], 'function');
  assert.equal(typeof defs[METHOD_BATCH_UNBLOCK_PATH], 'function');
});

test('BatchBlockIP success maps payload, headers, TLS, and signature', async () => {
  fixedNow();
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return response(200, {
      responseCode: 0,
      verboseMsg: 'ok',
      data: { list: [{ id: '100', object: '1.1.1.1', objectType: 'ip', lifeCycle: 0, state: 'enabled' }] },
    });
  });

  const result = await callHandler(METHOD_BATCH_BLOCK_FULL,
    { ip_addresses: ['1.1.1.1'], life_cycle_seconds: 0, comments: 'reason', threat_name: 'bot' },
    buildCtx({ bindings: { skipTlsVerify: true } }),
  );

  const url = new URL(captured.url);
  const timestamp = Math.floor(1700000000000 / 1000);
  const expectedSign = crypto.createHmac('sha1', 'demoSecret').update(`demoKey${timestamp}`).digest('base64');
  assert.equal(captured.init.method, 'POST');
  assert.equal(`${url.origin}${url.pathname}`, 'https://onesig.example.com/v3/blacklist/inbound');
  assert.equal(url.searchParams.get('apikey'), 'demoKey');
  assert.equal(url.searchParams.get('timestamp'), String(timestamp));
  assert.equal(url.searchParams.get('sign'), expectedSign);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.init.timeoutMs, undefined);
  assert.equal(captured.init.dispatcher, _test.insecureTlsDispatcher);
  assert.equal(captured.init.skipTlsVerify, undefined);
  assert.equal(captured.init.headers['X-Product'], 'miner');
  assert.equal(captured.init.headers['x-engine-instance'], 'inst');
  assert.deepEqual(captured.body, {
    object: ['1.1.1.1'],
    objectType: 'ip',
    lifeCycle: 0,
    comments: 'reason',
    threatName: 'bot',
  });
  assert.equal(result.status.response_code, 0);
  assert.equal(result.entries[0].object, '1.1.1.1');
  assert.equal(result.entries[0].life_cycle_seconds, 0);
});

test('ListInboundBlacklistEntries success returns pagination info and filters', async () => {
  let captured;
  setFetch(async (_url, init) => {
    captured = JSON.parse(init.body);
    return response(200, {
      responseCode: 0,
      verboseMsg: 'ok',
      data: {
        total: 10,
        pageNo: 2,
        pageSize: 5,
        list: [{
          id: '200',
          object: '1.1.1.1',
          object_type: 'ip',
          life_cycle: 3600,
          state: 'enabled',
          comments: 'demo',
          threatName: 'bot',
        }],
      },
    });
  });

  const result = await callHandler(METHOD_LIST_ENTRIES_FULL,
    { page_no: 2, page_size: 5, search: '1.1.1.1', state: 'enabled', input_type: 'manual' },
    buildCtx(),
  );

  assert.deepEqual(captured, {
    pageNo: 2,
    pageSize: 5,
    search: '1.1.1.1',
    objectType: 'ip',
    inputType: 'manual',
    state: 'enabled',
  });
  assert.equal(result.page_no, 2);
  assert.equal(result.page_size, 5);
  assert.equal(result.total, 10);
  assert.equal(result.entries[0].life_cycle_seconds, 3600);
  assert.equal(result.entries[0].threat_name, 'bot');
});

test('BatchUnblockByEntryIds success forwards ids and object type', async () => {
  let captured;
  setFetch(async (_url, init) => {
    captured = { method: init.method, body: JSON.parse(init.body) };
    return response(200, { responseCode: 0, verboseMsg: 'ok', data: { removed: 2 } });
  });

  const result = await callHandler(METHOD_BATCH_UNBLOCK_FULL,
    { entryIds: [{ value: '1' }, { value: '2' }], objectType: 'ip' },
    buildCtx(),
  );
  assert.equal(captured.method, 'DELETE');
  assert.deepEqual(captured.body, { ids: ['1', '2'], objectType: 'ip' });
  assert.equal(result.status.response_code, 0);
  assert.equal(result.raw.removed, 2);
});

test('validates bindings and local parameters', async () => {
  await expectGrpcError(
    () => callHandler(METHOD_BATCH_BLOCK_FULL, { ip_addresses: ['1.1.1.1'] }, buildCtx({ config: { base_url: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /base_url/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_BATCH_BLOCK_FULL, { ip_addresses: ['1.1.1.1'] }, buildCtx({ secret: { api_key: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /api_key/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_BATCH_BLOCK_FULL, { ip_addresses: ['1.1.1.1'] }, buildCtx({ secret: { secret: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /bindings.secret/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_BATCH_BLOCK_FULL, {}, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /ip_addresses is required/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_BATCH_BLOCK_FULL, { ip_addresses: [] }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /at least one IP/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_BATCH_BLOCK_FULL, { ip_addresses: [''] }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /non-empty string array/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_BATCH_BLOCK_FULL, { ip_addresses: ['1.1.1.1'], life_cycle_seconds: -1 }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /non-negative integer/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_BATCH_BLOCK_FULL, { ip_addresses: ['1.1.1.1'], comments: 'x'.repeat(21) }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /comments/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_BATCH_BLOCK_FULL, { ip_addresses: ['1.1.1.1'], threat_name: 'x'.repeat(21) }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /threat_name/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_LIST_ENTRIES_FULL, { page_no: 0 }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /page_no/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_LIST_ENTRIES_FULL, { page_size: 201 }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /page_size/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_BATCH_UNBLOCK_FULL, {}, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /entry_ids is required/),
  );
  await expectGrpcError(
    () => callHandler(METHOD_BATCH_UNBLOCK_FULL, { entry_ids: [] }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /entry_ids/),
  );
});

test('maps upstream transport and response failures', async () => {
  setFetch(async () => {
    throw new Error('network down');
  });
  await expectGrpcError(
    () => callHandler(METHOD_BATCH_BLOCK_FULL, { ip_addresses: ['1.1.1.1'] }, buildCtx()),
    'UNAVAILABLE',
    (err) => assert.match(err.message, /network down/),
  );

  for (const status of [401, 403, 404, 429, 500]) {
    setFetch(async () => response(status, `status-${status}`));
    await expectGrpcError(
      () => callHandler(METHOD_BATCH_BLOCK_FULL, { ip_addresses: ['1.1.1.1'] }, buildCtx()),
      'UNAVAILABLE',
      (err) => assert.match(err.message, new RegExp(`upstream http ${status}`)),
    );
  }

  setFetch(async () => response(200, ''));
  await expectGrpcError(
    () => callHandler(METHOD_BATCH_BLOCK_FULL, { ip_addresses: ['1.1.1.1'] }, buildCtx()),
    'UNKNOWN',
    (err) => assert.match(err.message, /empty/),
  );

  setFetch(async () => response(200, 'not-json'));
  await expectGrpcError(
    () => callHandler(METHOD_BATCH_BLOCK_FULL, { ip_addresses: ['1.1.1.1'] }, buildCtx()),
    'UNKNOWN',
    (err) => assert.match(err.message, /valid JSON/),
  );

  setFetch(async () => response(200, { responseCode: 1234, verboseMsg: 'bad request' }));
  await expectGrpcError(
    () => callHandler(METHOD_BATCH_BLOCK_FULL, { ip_addresses: ['1.1.1.1'] }, buildCtx()),
    'FAILED_PRECONDITION',
    (err) => assert.match(err.message, /responseCode=1234: bad request/),
  );

  setFetch(async () => ({
    status: 200,
    text: async () => {
      throw new Error('read failed');
    },
  }));
  await expectGrpcError(
    () => callHandler(METHOD_BATCH_BLOCK_FULL, { ip_addresses: ['1.1.1.1'] }, buildCtx()),
    'UNAVAILABLE',
    (err) => assert.match(err.message, /read failed/),
  );

  setFetch(abortingFetch('timeout waiting for demoKey'));
  await expectGrpcError(
    () => callHandler(METHOD_BATCH_BLOCK_FULL, { ip_addresses: ['1.1.1.1'] }, buildCtx({ limits: { timeoutMs: 1 } })),
    'UNAVAILABLE',
    (err) => {
      assert.match(err.message, /timeout/);
      assert.doesNotMatch(err.message, /demoKey/);
    },
  );
});

test('rpcdef falls back to context request', async () => {
  setFetch(async () => response(200, { responseCode: 0, verboseMsg: 'ok', data: { list: [] } }));
  const result = await rpcdef(buildCtx({ req: { ip_addresses: ['2.2.2.2'] } }))[METHOD_BATCH_BLOCK_PATH]();
  assert.equal(result.status.response_code, 0);
});

test('request cannot override secrets and logs/errors redact API key material', async () => {
  fixedNow();
  const logs = [];
  let capturedUrl;
  console.log = (...args) => logs.push(args.map((arg) => String(arg)).join(' '));
  setFetch(async (url) => {
    capturedUrl = String(url);
    const parsed = new URL(capturedUrl);
    return response(401, `bad apikey=demoKey&sign=${parsed.searchParams.get('sign')}&secret=demoSecret`);
  });

  await expectGrpcError(
    () => callHandler(METHOD_BATCH_BLOCK_FULL, {
      ip_addresses: ['1.1.1.1'],
      api_key: 'requestKey',
      apiKey: 'requestKey',
      secret: 'requestSecret',
    }, buildCtx()),
    'UNAVAILABLE',
    (err) => {
      assert.match(err.message, /upstream http 401/);
      assert.doesNotMatch(err.message, /demoKey|demoSecret|requestKey|requestSecret/);
    },
  );

  const url = new URL(capturedUrl);
  const expectedSign = crypto.createHmac('sha1', 'demoSecret').update('demoKey1700000000').digest('base64');
  assert.equal(url.searchParams.get('apikey'), 'demoKey');
  assert.equal(url.searchParams.get('sign'), expectedSign);
  assert.doesNotMatch(logs.join('\n'), /demoKey|demoSecret|requestKey|requestSecret/);
  assert.match(logs.join('\n'), /apikey=\*\*\*/);
});

test('helper functions cover signing, normalization, extraction, and logging branches', () => {
  fixedNow();
  assert.equal(_test.grpcCodeFor('NOPE'), grpcStatus.UNKNOWN);
  assert.equal(_test.errorWithCode('NOPE', 'bad').code, grpcStatus.UNKNOWN);
  assert.equal(_test.hasOwn(null, 'x'), false);
  assert.equal(_test.firstDefined(undefined, null, 0, 'x'), 0);
  assert.equal(_test.unwrapScalar({ value: { value: 'nested' } }), 'nested');
  assert.equal(_test.trimString(null), '');
  assert.equal(_test.toBoolean(true), true);
  assert.equal(_test.toBoolean(1), true);
  assert.equal(_test.toBoolean(0), false);
  assert.equal(_test.toBoolean('yes'), true);
  assert.equal(_test.toBoolean('off'), false);
  assert.equal(_test.toBoolean('maybe'), false);
  assert.equal(_test.normalizeBaseUrl('https://api.local///'), 'https://api.local');
  assert.equal(_test.normalizeBaseUrl('http://api.local', { allowInsecure: true }), 'http://api.local');
  assert.equal(_test.normalizeBaseUrl('http://api.local'), null);
  assert.equal(_test.matchSupportedValue(new Set(['abc']), 'ABC'), 'abc');
  assert.equal(_test.matchSupportedValue(new Set(['abc']), 'def'), null);
  assert.deepEqual(_test.mergedBindings({ config: { a: 1 }, secret: { b: 2 }, bindings: { a: 3 } }), { a: 3, b: 2 });
  assert.deepEqual(_test.resolveCallContext({ request: { x: 1 } }).req, { x: 1 });
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: 'bad' }, bindings: { timeoutMs: 10 } }), 1500);
  assert.equal(_test.normalizeInt({ value: '3' }, { min: 1, max: 5, defaultValue: 1 }), 3);
  assert.equal(_test.normalizeInt('bad', { min: 1, defaultValue: 1 }), null);
  assert.deepEqual(_test.normalizeStringList({ values: [{ value: ' a ' }, 'b'] }), ['a', 'b']);
  assert.equal(_test.normalizeStringList('bad'), null);
  assert.equal(_test.enforceMaxLength(' ok ', 3, 'field'), 'ok');
  assert.equal(_test.pickSignaturePayload('timestamp+apiKey', { apiKey: 'k', timestamp: 't' }), 'tk');
  assert.equal(_test.pickSignaturePayload('apiKey', { apiKey: 'k', timestamp: 't' }), 'k');
  assert.equal(_test.pickSignaturePayload('timestamp', { apiKey: 'k', timestamp: 't' }), 't');
  assert.equal(_test.pickSignaturePayload('unknown', { apiKey: 'k', timestamp: 't' }), 'kt');
  assert.equal(_test.computeTimestampValue('milliseconds'), '1700000000000');
  assert.equal(_test.computeTimestampValue('seconds'), '1700000000');
  assert.equal(_test.computeHmacSha1Base64('secret', 'data'), crypto.createHmac('sha1', 'secret').update('data').digest('base64'));
  assert.equal(_test.encodeQueryComponent('a b'), 'a%20b');
  assert.equal(_test.redactUrlSensitiveQuery('https://x.test/p?apikey=k&sign=s&x=1'), 'https://x.test/p?apikey=***&sign=***&x=1');
  assert.equal(_test.sanitizeSensitiveText('apikey=k&sign=s body secret', ['secret']), 'apikey=***&sign=*** body ***');
  const signed = _test.buildSignedUrl({
    baseUrl: 'https://api.local',
    path: '/x?existing=1',
    apiKey: 'k',
    secret: 's',
    signatureMode: 'apiKey+timestamp',
    timestampPrecision: 'seconds',
    encodeSign: false,
  });
  assert.match(signed.url, /existing=1&apikey=k&timestamp=1700000000&sign=/);
  assert.equal(_test.normalizeBindings({
    baseUrl: 'http://api.local/',
    allow_http: 'yes',
    apiKey: 'k',
    Secret: 's',
    encode_sign: 'false',
    signatureMode: 'TIMESTAMP+APIKEY',
    timestampPrecision: 'MILLISECONDS',
  }).signatureMode, 'timestamp+apiKey');
  assert.throws(() => _test.normalizeBindings({ base_url: 'https://api.local', api_key: 'k', secret: 's', signature_mode: 'bad' }), /unsupported signature_mode/);
  assert.throws(() => _test.normalizeBindings({ base_url: 'https://api.local', api_key: 'k', secret: 's', timestamp_precision: 'bad' }), /unsupported timestamp_precision/);
  assert.equal(_test.normalizeObjectType({}), 'ip');
  assert.equal(_test.normalizePaginationField(undefined, { label: 'page', defaultValue: 1, min: 1 }), 1);
  assert.deepEqual(_test.extractEntries({ items: [{ id: 1, Object: '1.1.1.1', life_cycle: 'bad' }] })[0], {
    id: '1',
    object: '1.1.1.1',
    objectType: 'ip',
    lifeCycleSeconds: 0,
    state: '',
    comments: '',
    threatName: '',
  });
  assert.deepEqual(_test.extractEntries([{ id: '2', object: '2.2.2.2', objectType: 'domain', lifeCycle: -5 }])[0].lifeCycleSeconds, 0);
  assert.deepEqual(_test.mapEntriesToProto([{ id: '1', object: '1.1.1.1', objectType: 'ip', lifeCycleSeconds: 0, state: '', comments: '', threatName: '' }])[0].object_type, 'ip');
  assert.equal(_test.prepareRuntime(buildCtx()).bindings.baseUrl, 'https://onesig.example.com');

  const circular = {};
  circular.self = circular;
  const logs = [];
  console.log = (...args) => logs.push(args);
  _test.logFlow({ instanceId: 'i', requestId: 'r' }, 'action', { ok: true });
  _test.logFlow({}, 'fallback', circular);
  assert.match(logs[0][0], /\[ThreatBook_OneSIG\]\[action\]\[inst=i req=r\]/);
  assert.match(logs[1][0], /\[ThreatBook_OneSIG\]\[fallback\]/);
});

test('callOneSig can be used directly', async () => {
  fixedNow();
  setFetch(async (_url, init) => {
    assert.equal(init.method, 'POST');
    assert.equal(init.body, '{}');
    return response(200, { code: 0, message: 'ok', data: [] });
  });
  const result = await _test.callOneSig({
    action: 'direct',
    meta: {},
    bindings: _test.normalizeBindings({ base_url: 'https://api.local', api_key: 'k', secret: 's' }),
    method: 'POST',
    path: '/path',
    timeoutMs: 1,
  });
  assert.equal(result.responseCode, 0);
  assert.equal(result.verboseMsg, 'ok');
});

test('mock upstream handles block, list, unblock lifecycle and business failure', async () => {
  fixedNow();
  const server = await createMockServer();
  try {
    const ctx = buildCtx({
      config: { base_url: server.url, allow_http: true },
      secret: { api_key: 'demoKey', secret: 'demoSecret' },
    });
    const block = await callHandler(METHOD_BATCH_BLOCK_FULL, { ip_addresses: ['10.0.0.1'], comments: 'demo' }, ctx);
    const list = await callHandler(METHOD_LIST_ENTRIES_FULL, { page_no: 1, page_size: 10 }, ctx);
    const unblock = await callHandler(METHOD_BATCH_UNBLOCK_FULL, { entry_ids: [block.entries[0].id] }, ctx);

    assert.equal(block.entries[0].object, '10.0.0.1');
    assert.equal(list.total, 1);
    assert.equal(unblock.raw.removed, 1);
    assert.equal(server.requests[0].method, 'POST');
    assert.equal(server.requests[1].path, '/v3/blacklist/inbound/list');
    assert.equal(server.requests[2].method, 'DELETE');

    await expectGrpcError(
      () => callHandler(METHOD_LIST_ENTRIES_FULL, { search: 'bizfail' }, ctx),
      'FAILED_PRECONDITION',
      (err) => assert.match(err.message, /business failed/),
    );
  } finally {
    await server.close();
  }
});
