import test from 'node:test';
import assert from 'node:assert/strict';

const PKG = 'M01_Intelligence.M01_Intelligence';
const detectPath = `/${PKG}/DetectIntelligence`;
const listPath = `/${PKG}/ListIntelligence`;
const addPath = `/${PKG}/AddIntelligence`;
const updatePath = `/${PKG}/UpdateIntelligence`;
const deletePath = `/${PKG}/DeleteIntelligence`;
const statsPath = `/${PKG}/GetIntelligenceStats`;

const buildCtx = (req = {}, overrides = {}) => ({
  bindings: { endpoint: 'https://m01.example.com', apiKey: 'key-1', ...overrides.bindings },
  limits: { timeoutMs: 10_000, ...overrides.limits },
  meta: { instance_id: 'inst', request_id: 'req', ...overrides.meta },
  req,
});

const setFetch = (impl) => {
  global.fetch = async (url, init) => {
    const out = await impl(url, init);
    if (out && out.throwNetwork) throw new Error(out.throwNetwork);
    const status = out?.status ?? 200;
    const text = out?.raw !== undefined ? out.raw : JSON.stringify(out?.body ?? {});
    return { ok: status >= 200 && status < 300, status, async text() { return text; } };
  };
};

const loadRpc = async (req, overrides = {}) => {
  const { rpcdef } = await import('../src/m01-intelligence.js');
  return rpcdef(buildCtx(req, overrides));
};

const env = (data, code = 200, msg = 'ok') => ({ body: { code, msg, data } });

test('internal helpers: bindings, headers, url, conversions, struct, enums', async () => {
  const { _test } = await import('../src/m01-intelligence.js');

  assert.deepEqual(_test.mergedBindings({
    config: { endpoint: 'http://c', keep: 'c' }, secret: { apiKey: 's' }, bindings: { endpoint: 'http://b' },
  }), { endpoint: 'http://b', keep: 'c', apiKey: 's' });

  assert.deepEqual(_test.parseHeaders('{"X":"1"}'), { X: '1' });
  assert.deepEqual(_test.parseHeaders('{bad'), {});
  assert.deepEqual(_test.parseHeaders(['x']), {});

  assert.equal(_test.normalizeBaseUrl('https://h/'), 'https://h');
  assert.equal(_test.normalizeBaseUrl('ftp://x'), null);

  assert.equal(_test.toOptionalString({ value: 'x' }), 'x');
  assert.equal(_test.toOptionalString(''), undefined);
  assert.equal(_test.toInt({ value: '7' }), 7);
  assert.equal(_test.toInt('bad'), 0);
  assert.equal(_test.toInt(undefined), 0);

  assert.equal(_test.toOptionalPositiveInt(undefined, 'page'), undefined);
  assert.equal(_test.toOptionalPositiveInt(0, 'page'), undefined);
  assert.equal(_test.toOptionalPositiveInt(3, 'page'), 3);
  assert.throws(() => _test.toOptionalPositiveInt(-1, 'page'), /page must be a positive integer/);
  assert.throws(() => _test.toOptionalPositiveInt('x', 'page'), /positive integer/);

  assert.equal(_test.requireNonEmpty('a', 'f'), 'a');
  assert.throws(() => _test.requireNonEmpty('', 'f'), /f is required/);
  assert.throws(() => _test.requireNonEmpty(undefined, 'f'), /f is required/);

  assert.equal(_test.validateEnum('high', _test.URGENCY_SET, 'urgency'), 'high');
  assert.throws(() => _test.validateEnum('x', _test.URGENCY_SET, 'urgency'), /urgency must be one of/);

  assert.deepEqual(_test.normalizeStruct({ a: 1 }), { a: 1 });
  assert.deepEqual(_test.normalizeStruct('x'), {});
  assert.deepEqual(_test.normalizeStructArray([{ a: 1 }, 'y']), [{ a: 1 }, { value: 'y' }]);
  assert.deepEqual(_test.normalizeStructArray(null), []);

  assert.deepEqual(_test.requireItemArray({ items: [1] }, ['items']), [1]);
  assert.throws(() => _test.requireItemArray({ items: 'x' }, ['items']), /must be an array/);
  assert.throws(() => _test.requireItemArray({ items: [] }, ['items']), /non-empty/);
  assert.throws(() => _test.requireItemArray({}, ['items']), /required/);

  const rec = _test.mapRecord({ hit: true, id: 'i', source_industry: ['A'], info: { x: 1 }, phishing_script: null, pattern: 'p' });
  assert.equal(rec.hit, true);
  assert.deepEqual(rec.source_industry, ['A']);
  assert.deepEqual(rec.info, { x: 1 });
  assert.deepEqual(rec.phishing_script, []);

  const e = _test.errorWithCode('NEW', 'm');
  assert.equal(e.legacyCode, 'NEW');
});

test('DetectIntelligence maps queries to a JSON array and records back', async () => {
  let seen;
  setFetch((url, init) => {
    seen = { url, init };
    return env([{ hit: true, request_id: 'q1', id: 'uuid-1', pattern: 'evil.com', attribute: 'url-domain', status: 'active', tlp: 'RED', urgency: 'high', info: { kind: 'domain' }, source_industry: ['金融'] }]);
  });
  const handler = (await loadRpc({ queries: [{ pattern: 'evil.com', type: 'url-domain', request_id: 'q1' }] }))[detectPath];
  const out = await handler();
  assert.equal(out.records.length, 1);
  assert.equal(out.records[0].hit, true);
  assert.deepEqual(out.records[0].info, { kind: 'domain' });
  assert.match(seen.url, /\/m01\/intelligence\/detection$/);
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers['x-api-key'], 'key-1');
  assert.equal(seen.init.headers['x-request-id'], 'req');
  assert.deepEqual(JSON.parse(seen.init.body), [{ pattern: 'evil.com', type: 'url-domain', request_id: 'q1' }]);
});

test('DetectIntelligence validates queries: empty, missing fields, bad type', async () => {
  setFetch(() => env([]));
  await assert.rejects((await loadRpc({}))[detectPath](), /queries is required/);
  await assert.rejects((await loadRpc({ queries: [] }))[detectPath](), /non-empty/);
  await assert.rejects((await loadRpc({ queries: [{ type: 'url', request_id: 'r' }] }))[detectPath](), /pattern is required/);
  await assert.rejects((await loadRpc({ queries: [{ pattern: 'p', type: 'bogus', request_id: 'r' }] }))[detectPath](), /type must be one of/);
});

test('ListIntelligence builds filtered body and maps paginated data', async () => {
  let body;
  setFetch((url, init) => {
    body = JSON.parse(init.body);
    return env({ total: 2, page: 1, page_size: 10, total_pages: 1, records: [{ id: 'a' }, { id: 'b' }] });
  });
  const handler = (await loadRpc({ page: 1, page_size: 10, pattern: 'evil', status: 'active' }))[listPath];
  const out = await handler();
  assert.equal(out.total, 2);
  assert.equal(out.records.length, 2);
  assert.deepEqual(out.records[0], { id: 'a' });
  assert.deepEqual(body, { page: 1, page_size: 10, pattern: 'evil', status: 'active' });
});

test('ListIntelligence omits default/absent paging and validates paging', async () => {
  let body;
  setFetch((url, init) => { body = JSON.parse(init.body); return env({ total: 0, records: [] }); });
  await (await loadRpc({}))[listPath]();
  assert.deepEqual(body, {}); // nothing sent -> upstream defaults
  await assert.rejects((await loadRpc({ page: -1 }))[listPath](), /page must be a positive integer/);
});

test('AddIntelligence validates required enums and maps result', async () => {
  let body;
  setFetch((url, init) => {
    body = JSON.parse(init.body);
    return env({ success_count: 1, intelligence_ids: [{ intelligence_id: 'id1', pattern: 'evil.com' }], failed_count: 1, failures: [{ pattern: 'dup', reason: 'exists' }] });
  });
  const handler = (await loadRpc({ items: [{ pattern: 'evil.com', tlp: 'RED', urgency: 'high', attribute: 'url-domain', status: 'active', description: 'phish' }] }))[addPath];
  const out = await handler();
  assert.equal(out.success_count, 1);
  assert.equal(out.intelligence_ids[0].intelligence_id, 'id1');
  assert.equal(out.failed_count, 1);
  assert.equal(out.failures[0].reason, 'exists');
  assert.deepEqual(body[0], { tlp: 'RED', urgency: 'high', attribute: 'url-domain', pattern: 'evil.com', description: 'phish', status: 'active' });

  await assert.rejects((await loadRpc({ items: [{ pattern: 'p', urgency: 'high', attribute: 'url' }] }))[addPath](), /tlp is required/);
  await assert.rejects((await loadRpc({ items: [{ pattern: 'p', tlp: 'PURPLE', urgency: 'high', attribute: 'url' }] }))[addPath](), /tlp must be one of/);
  await assert.rejects((await loadRpc({ items: [{ pattern: 'p', tlp: 'RED', urgency: 'high', attribute: 'url', status: 'expired' }] }))[addPath](), /status must be one of/);
});

test('UpdateIntelligence requires id, sends partial fields, returns id', async () => {
  let body;
  setFetch((url, init) => { body = JSON.parse(init.body); return env('id-9'); });
  const handler = (await loadRpc({ items: [{ id: 'id-9', status: 'revoked', urgency: 'low' }] }))[updatePath];
  const out = await handler();
  assert.equal(out.id, 'id-9');
  assert.deepEqual(body[0], { id: 'id-9', status: 'revoked', urgency: 'low' });

  await assert.rejects((await loadRpc({ items: [{ status: 'active' }] }))[updatePath](), /id is required/);
  await assert.rejects((await loadRpc({ items: [{ id: 'x', status: 'nope' }] }))[updatePath](), /status must be one of/);
});

test('DeleteIntelligence validates all required item fields and maps success_count', async () => {
  let body;
  setFetch((url, init) => { body = JSON.parse(init.body); return env({ success_count: 1 }); });
  const handler = (await loadRpc({ items: [{ intelligence_id: 'id1', intelligence_type: 'ipv4', pattern: '1.2.3.4', pattern_type: 'exact' }] }))[deletePath];
  const out = await handler();
  assert.equal(out.success_count, 1);
  assert.deepEqual(body[0], { intelligence_id: 'id1', intelligence_type: 'ipv4', pattern: '1.2.3.4', pattern_type: 'exact' });

  await assert.rejects((await loadRpc({ items: [{ intelligence_type: 'ipv4', pattern: 'p', pattern_type: 't' }] }))[deletePath](), /intelligence_id is required/);
  await assert.rejects((await loadRpc({ items: [{ intelligence_id: 'i', intelligence_type: 'sha1', pattern: 'p', pattern_type: 't' }] }))[deletePath](), /intelligence_type must be one of/);
});

test('DeleteIntelligence is idempotent when data is null', async () => {
  setFetch(() => env(null));
  const out = await (await loadRpc({ items: [{ intelligence_id: 'i', intelligence_type: 'md5', pattern: 'p', pattern_type: 't' }] }))[deletePath]();
  assert.equal(out.success_count, 0);
});

test('GetIntelligenceStats maps counts', async () => {
  let seen;
  setFetch((url, init) => { seen = { url, method: init.method }; return env({ total: 10, active_count: 7, revoked_count: 3 }); });
  const out = await (await loadRpc({}))[statsPath]();
  assert.deepEqual(out, { total: 10, active_count: 7, revoked_count: 3 });
  assert.match(seen.url, /\/m01\/intelligence\/stats$/);
  assert.equal(seen.method, 'GET');
});

test('auth: x-api-key preferred; apiToken bearer fallback; missing both errors', async () => {
  let headers;
  setFetch((url, init) => { headers = init.headers; return env({ total: 0, active_count: 0, revoked_count: 0 }); });

  await (await loadRpc({}, { bindings: { endpoint: 'https://h', apiKey: '', apiToken: 'jwt-tok' } }))[statsPath]();
  assert.equal(headers.authorization, 'Bearer jwt-tok');
  assert.equal(headers['x-api-key'], undefined);

  await assert.rejects(
    (await loadRpc({}, { bindings: { endpoint: 'https://h', apiKey: '', apiToken: '' } }))[statsPath](),
    /apiKey \(x-api-key\) or apiToken \(Bearer\) is required/,
  );
});

test('error mapping: endpoint, http 403/400/500, envelope code, network, bad json, empty', async () => {
  // missing endpoint
  await assert.rejects(
    (await loadRpc({}, { bindings: { endpoint: '', apiKey: 'k' } }))[statsPath](),
    /endpoint\/baseUrl is required/,
  );

  setFetch(() => ({ status: 403, raw: 'forbidden' }));
  await assert.rejects((await loadRpc({}))[statsPath](), /PERMISSION_DENIED.*http 403/);

  setFetch(() => ({ status: 400, raw: 'bad' }));
  await assert.rejects((await loadRpc({}))[statsPath](), /FAILED_PRECONDITION.*http 400/);

  setFetch(() => ({ status: 500, raw: 'boom' }));
  await assert.rejects((await loadRpc({}))[statsPath](), /UNAVAILABLE.*http 500/);

  setFetch(() => env(null, 400, '参数有误'));
  await assert.rejects((await loadRpc({}))[statsPath](), /FAILED_PRECONDITION.*code 400/);

  setFetch(() => env(null, 401, 'no auth'));
  await assert.rejects((await loadRpc({}))[statsPath](), /PERMISSION_DENIED.*code 401/);

  setFetch(() => env(null, 500, 'server'));
  await assert.rejects((await loadRpc({}))[statsPath](), /UNAVAILABLE.*code 500/);

  setFetch(() => ({ throwNetwork: 'ECONNREFUSED' }));
  await assert.rejects((await loadRpc({}))[statsPath](), /UNAVAILABLE.*ECONNREFUSED/);

  setFetch(() => ({ status: 200, raw: 'not-json{' }));
  await assert.rejects((await loadRpc({}))[statsPath](), /UNKNOWN.*not valid JSON/);

  setFetch(() => ({ status: 200, raw: '' }));
  const out = await (await loadRpc({}))[statsPath]();
  assert.deepEqual(out, { total: 0, active_count: 0, revoked_count: 0 });
});

test('binding fallbacks: timeoutMs, tls-skip, unknown meta audit headers', async () => {
  let seen;
  setFetch((url, init) => { seen = init; return env({ total: 0, active_count: 0, revoked_count: 0 }); });
  await (await loadRpc({}, {
    limits: { timeoutMs: 0 },
    meta: { instance_id: '', request_id: '' },
    bindings: { endpoint: 'https://h', apiKey: 'k', timeoutMs: 2222, skipTlsVerify: true },
  }))[statsPath]();
  assert.equal(seen.timeoutMs, 2222);
  assert.equal(seen.insecureSkipVerify, true);
  assert.equal(seen.headers['x-engine-instance'], 'unknown');
  assert.equal(seen.headers['x-request-id'], 'unknown');
});

test('optional fields: add/update expiration + tlp, camelCase keys, missing result arrays', async () => {
  let body;
  setFetch((url, init) => {
    body = JSON.parse(init.body);
    if (url.endsWith('/add')) return env({ success_count: 1 }); // no intelligence_ids / failures arrays
    return env('id-7');
  });

  const add = (await loadRpc({ items: [{ pattern: 'p', tlp: 'GREEN', urgency: 'low', attribute: 'md5', intelligence_expiration_time: '2030-01-01T00:00:00Z' }] }))[addPath];
  const aout = await add();
  assert.deepEqual(aout.intelligence_ids, []);
  assert.deepEqual(aout.failures, []);
  assert.equal(body[0].intelligence_expiration_time, '2030-01-01T00:00:00Z');

  const upd = (await loadRpc({ items: [{ id: 'id-7', tlp: 'AMBER+STRICT', intelligenceExpirationTime: '2031-02-02T00:00:00Z' }] }))[updatePath];
  const uout = await upd();
  assert.equal(uout.id, 'id-7');
  assert.equal(body[0].tlp, 'AMBER+STRICT');
  assert.equal(body[0].intelligence_expiration_time, '2031-02-02T00:00:00Z');

  // detect with camelCase requestId, delete with camelCase keys
  setFetch((u, init) => { body = JSON.parse(init.body); return u.endsWith('/detection') ? env([]) : env({ success_count: 1 }); });
  await (await loadRpc({ queries: [{ pattern: 'p', type: 'md5', requestId: 'rc' }] }))[detectPath]();
  assert.equal(body[0].request_id, 'rc');
  await (await loadRpc({ items: [{ intelligenceId: 'i', intelligenceType: 'md5', pattern: 'p', patternType: 't' }] }))[deletePath]();
  assert.equal(body[0].intelligence_id, 'i');
});

test('handlers / registerHandlers run through the legacy ctx wrapper', async () => {
  setFetch(() => env({ total: 5, active_count: 5, revoked_count: 0 }));
  const { handlers, _test } = await import('../src/m01-intelligence.js');
  const out = await handlers[`${PKG}/GetIntelligenceStats`]({ bindings: { endpoint: 'https://h', apiKey: 'k' }, req: {} });
  assert.equal(out.total, 5);

  const reg = _test.registerHandlers({ bindings: { endpoint: 'https://h', apiKey: 'k' } });
  const out2 = await reg[`/${PKG}/GetIntelligenceStats`]({}, { meta: { request_id: 'r2' } });
  assert.equal(out2.active_count, 5);
});
