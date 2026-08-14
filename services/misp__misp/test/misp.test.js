import test from 'node:test';
import assert from 'node:assert/strict';

const searchEventsPath = '/MISP.MISP/SearchEvents';
const getEventPath = '/MISP.MISP/GetEvent';
const createEventPath = '/MISP.MISP/CreateEvent';
const searchAttributesPath = '/MISP.MISP/SearchAttributes';
const addAttributePath = '/MISP.MISP/AddAttribute';
const searchTagsPath = '/MISP.MISP/SearchTags';

const buildCtx = (req = {}, overrides = {}) => ({
  bindings: {
    endpoint: 'https://misp.example.com',
    api_key: 'test-api-key',
    ...overrides.bindings,
  },
  limits: { timeoutMs: 10000, ...overrides.limits },
  meta: { instance_id: 'inst', request_id: 'req', ...overrides.meta },
  req,
});

const loadHandler = async (req, path, overrides = {}) => {
  const { rpcdef } = await import('../src/misp.js');
  const ctx = buildCtx(req, overrides);
  return rpcdef(ctx)[path];
};

const setFetch = (impl) => { global.fetch = impl; };
const mockUpstream = (responseBody, status = 200) => {
  setFetch(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify(responseBody),
  }));
};

// ── Internal helpers ──────────────────────────────────────

test('internal helpers work correctly', async () => {
  const { _test } = await import('../src/misp.js');

  assert.equal(_test.toTrimmedString(undefined), '');
  assert.equal(_test.toTrimmedString({ value: ' test ' }), 'test');
  assert.equal(_test.toInt64(null), null);
  assert.equal(_test.toInt64({ value: 42 }), 42);
  assert.equal(_test.toBoolean(true), true);
  assert.equal(_test.toBoolean('true'), true);
  assert.equal(_test.toValue('x').stringValue, 'x');
  assert.equal(_test.firstDefined(undefined, 'a'), 'a');
});

test('internal helpers cover scalar, structured, and merged bindings', async () => {
  const { _test } = await import('../src/misp.js');
  assert.equal(_test.toInt64(''), null);
  assert.equal(_test.toInt64('not-an-int'), null);
  assert.equal(_test.toInt64(3.5), null);
  assert.equal(_test.toInt64('42'), 42);
  assert.equal(_test.toBoolean(null), false);
  assert.equal(_test.toBoolean(0), false);
  assert.equal(_test.toBoolean(1), true);
  assert.equal(_test.toBoolean('yes'), true);
  assert.equal(_test.toBoolean('no'), false);
  assert.equal(_test.toBoolean('unexpected'), true);
  assert.deepEqual(_test.toValue([undefined, 'x']), { listValue: { values: [{ stringValue: 'x' }] } });
  assert.deepEqual(_test.toValue({ empty: null, flag: true }), {
    structValue: { fields: { empty: { nullValue: 'NULL_VALUE' }, flag: { boolValue: true } } },
  });
  assert.deepEqual(_test.mergedBindings({ config: { a: 1 }, secret: { a: 2, b: 2 }, bindings: { a: 3 } }), { a: 3, b: 2 });
  assert.equal(_test.resolveTimeoutMs({ timeoutMs: 20 }, { timeoutMs: 30 }), 20);
  assert.equal(_test.resolveTimeoutMs({}, { timeoutMs: 30 }), 30);
  assert.equal(_test.resolveTimeoutMs({}, {}), 10000);
  assert.equal(_test.isTimeoutError({ cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }), true);
  assert.equal(_test.isTimeoutError(new Error('not a timeout')), false);
});

// ── Credential resolution ─────────────────────────────────

test('resolveCredentials validates api_key', async () => {
  const { _test } = await import('../src/misp.js');
  const c1 = _test.resolveCredentials({ api_key: 'key1' });
  assert.equal(c1.apiKey, 'key1');
  const c2 = _test.resolveCredentials({ apiKey: 'key2' });
  assert.equal(c2.apiKey, 'key2');
  assert.throws(() => _test.resolveCredentials({}), /api_key/);
});

test('resolveEndpoint validates endpoint', async () => {
  const { _test } = await import('../src/misp.js');
  assert.equal(_test.resolveEndpoint({ endpoint: 'https://misp.local' }), 'https://misp.local');
  assert.equal(_test.resolveEndpoint({ endpoint: 'https://misp.local/' }), 'https://misp.local');
  assert.throws(() => _test.resolveEndpoint({}), /endpoint/);
  assert.throws(() => _test.resolveEndpoint({ endpoint: 'not-a-url' }), /HTTP\(S\)/);
  assert.throws(() => _test.resolveEndpoint({ endpoint: 'file:///tmp/misp' }), /HTTP\(S\)/);
  assert.throws(() => _test.resolveEndpoint({ endpoint: 'https://user:pass@misp.local' }), /without embedded credentials/);
});

// ── SearchEvents ──────────────────────────────────────────

test('SearchEvents sends correct request', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ response: [{ id: '1', info: 'test event', date: '2026-06-25' }] }),
    };
  });

  const handler = await loadHandler({ value: '1.2.3.4', type: ['ip-src', 'ip-dst'], limit: { value: 10 } }, searchEventsPath);
  const res = await handler();

  assert.ok(captured.url.includes('/events/restSearch'));
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['Authorization'], 'test-api-key');
  assert.equal(captured.body.value, '1.2.3.4');
  assert.deepEqual(captured.body.type.OR, ['ip-src', 'ip-dst']);
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].info, 'test event');
});

test('SearchEvents with tags and metadata', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = JSON.parse(init.body);
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ response: [] }),
    };
  });

  const handler = await loadHandler({ tags: ['tlp:amber'], not_tags: ['tlp:red'], metadata: true }, searchEventsPath);
  await handler();
  assert.deepEqual(captured.tags.OR, ['tlp:amber']);
  assert.deepEqual(captured.tags.NOT, ['tlp:red']);
  assert.equal(captured.metadata, '1');
});

test('SearchEvents sends every optional filter when provided', async () => {
  let captured;
  setFetch(async (_url, init) => {
    captured = JSON.parse(init.body);
    return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify({ response: [] }) };
  });
  const handler = await loadHandler({
    value: 'ioc', type: ['domain'], category: ['Network activity'], tags: ['tlp:amber'], not_tags: ['tlp:red'],
    org: 'ACME', from: '2026-01-01', to: '2026-01-02', last: '1d', limit: { value: 2 }, page: { value: 3 },
    metadata: true, with_attachments: true,
  }, searchEventsPath);
  await handler();
  assert.equal(captured.org, 'ACME');
  assert.equal(captured.withAttachments, '1');
  assert.equal(captured.page, '3');
});

test('SearchEvents handles empty response', async () => {
  mockUpstream({ response: [] });
  const handler = await loadHandler({}, searchEventsPath);
  assert.deepEqual((await handler()).items, []);
});

// ── GetEvent ─────────────────────────────────────────────

test('GetEvent requires event_id', async () => {
  const handler = await loadHandler({}, getEventPath);
  await assert.rejects(() => handler(), /INVALID_ARGUMENT/);
});

test('GetEvent fetches event details', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = url;
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({
        Event: {
          id: '42', info: 'suspicious activity', date: '2026-06-25',
          published: true, threat_level_id: 3, analysis: 1,
          Tag: [{ name: 'tlp:amber' }],
          Attribute: [{ id: '1', value: '5.6.7.8', type: 'ip-dst', category: 'Network activity' }],
        },
      }),
    };
  });

  const handler = await loadHandler({ event_id: '42' }, getEventPath);
  const res = await handler();

  assert.ok(captured.includes('/events/42'));
  assert.equal(res.event.id, '42');
  assert.equal(res.event.info, 'suspicious activity');
  assert.deepEqual(res.event.tags, ['tlp:amber']);
  assert.equal(res.attributes.length, 1);
  assert.equal(res.attributes[0].value, '5.6.7.8');
});

test('GetEvent URL-encodes event_id', async () => {
  let captured;
  setFetch(async (url) => {
    captured = url;
    return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify({ Event: {} }) };
  });
  const handler = await loadHandler({ event_id: '../other?x=1' }, getEventPath);
  await handler();
  assert.ok(captured.endsWith('/events/..%2Fother%3Fx%3D1'));
});

// ── CreateEvent ──────────────────────────────────────────

test('CreateEvent requires info', async () => {
  const handler = await loadHandler({}, createEventPath);
  await assert.rejects(() => handler(), /INVALID_ARGUMENT/);
});

test('CreateEvent sends correct payload', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = JSON.parse(init.body);
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ id: '100', info: 'new event', date: '2026-06-25' }),
    };
  });

  const handler = await loadHandler({ info: 'IoC detected', threat_level_id: { value: 3 }, analysis: { value: 0 } }, createEventPath);
  const res = await handler();

  assert.equal(captured.Event.info, 'IoC detected');
  assert.equal(captured.Event.threat_level_id, 3);
  assert.equal(res.event.info, 'new event');
});

test('CreateEvent includes every optional field', async () => {
  let captured;
  setFetch(async (_url, init) => {
    captured = JSON.parse(init.body);
    return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify({ Event: {} }) };
  });
  const handler = await loadHandler({ info: 'event', date: '2026-01-01', threat_level_id: { value: 1 }, analysis: { value: 2 }, published: true, distribution: { value: 3 } }, createEventPath);
  await handler();
  assert.deepEqual(captured.Event, { info: 'event', date: '2026-01-01', threat_level_id: 1, analysis: 2, published: 1, distribution: 3 });
});

// ── SearchAttributes ──────────────────────────────────────

test('SearchAttributes sends correct request', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = JSON.parse(init.body);
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ response: [{ id: '1', value: '1.2.3.4', type: 'ip-src' }] }),
    };
  });

  const handler = await loadHandler({ value: '1.2.3.4', type: ['ip-src'], event_id: '42' }, searchAttributesPath);
  await handler();
  assert.equal(captured.eventid, '42');
  assert.equal(captured.value, '1.2.3.4');
});

test('SearchAttributes handles empty result', async () => {
  mockUpstream({ response: [] });
  const handler = await loadHandler({}, searchAttributesPath);
  assert.deepEqual((await handler()).items, []);
});

test('SearchAttributes sends every optional filter when provided', async () => {
  let captured;
  setFetch(async (_url, init) => {
    captured = JSON.parse(init.body);
    return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify({ response: [] }) };
  });
  const handler = await loadHandler({
    value: 'ioc', type: ['domain'], category: ['Network activity'], tags: ['tlp:amber'], not_tags: ['tlp:red'], event_id: '42',
    from: '2026-01-01', to: '2026-01-02', last: '1d', limit: { value: 2 }, page: { value: 3 }, include_event: true, to_ids: true,
  }, searchAttributesPath);
  await handler();
  assert.equal(captured.includeEventUuid, '1');
  assert.equal(captured.to_ids, '1');
  assert.equal(captured.page, '3');
});

// ── AddAttribute ─────────────────────────────────────────

test('AddAttribute requires event_id, value, type', async () => {
  const h1 = await loadHandler({}, addAttributePath);
  await assert.rejects(() => h1(), /event_id is required/);
  const h2 = await loadHandler({ event_id: '1' }, addAttributePath);
  await assert.rejects(() => h2(), /value is required/);
  const h3 = await loadHandler({ event_id: '1', value: '1.2.3.4' }, addAttributePath);
  await assert.rejects(() => h3(), /type is required/);
});

test('AddAttribute sends correct payload', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = JSON.parse(init.body);
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ Attribute: { id: '10', value: '1.2.3.4', type: 'ip-src', category: 'Network activity' } }),
    };
  });

  const handler = await loadHandler({ event_id: '42', value: '1.2.3.4', type: 'ip-src', category: 'Network activity' }, addAttributePath);
  const res = await handler();

  assert.equal(captured.Attribute.value, '1.2.3.4');
  assert.equal(captured.Attribute.type, 'ip-src');
  assert.equal(res.attribute.type, 'ip-src');
});

test('AddAttribute URL-encodes event_id', async () => {
  let captured;
  setFetch(async (url) => {
    captured = url;
    return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify({ Attribute: {} }) };
  });
  const handler = await loadHandler({ event_id: '../other?x=1', value: '1.2.3.4', type: 'ip-src' }, addAttributePath);
  await handler();
  assert.ok(captured.endsWith('/attributes/add/..%2Fother%3Fx%3D1'));
});

test('AddAttribute includes every optional field', async () => {
  let captured;
  setFetch(async (_url, init) => {
    captured = JSON.parse(init.body);
    return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify({ Attribute: {} }) };
  });
  const handler = await loadHandler({ event_id: '1', value: 'ioc', type: 'domain', category: 'Network activity', to_ids: true, distribution: { value: 2 }, comment: 'note' }, addAttributePath);
  await handler();
  assert.deepEqual(captured.Attribute, { value: 'ioc', type: 'domain', category: 'Network activity', to_ids: 1, distribution: 2, comment: 'note' });
});

// ── SearchTags ───────────────────────────────────────────

test('SearchTags requires name', async () => {
  const handler = await loadHandler({}, searchTagsPath);
  await assert.rejects(() => handler(), /INVALID_ARGUMENT/);
});

test('SearchTags fetches tags', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = url;
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify([{ id: '1', name: 'tlp:amber', colour: '#ff6600' }]),
    };
  });

  const handler = await loadHandler({ name: 'tlp' }, searchTagsPath);
  const res = await handler();
  assert.ok(captured.includes('/tags/search/tlp'));
  assert.equal(res.items[0].name, 'tlp:amber');
});

// ── Error mapping ─────────────────────────────────────────

test('HTTP error codes mapped correctly', async () => {
  setFetch(async () => ({ ok: false, status: 401, headers: new Map(), text: async () => 'Unauth' }));
  const h401 = await loadHandler({ event_id: '1' }, getEventPath);
  await assert.rejects(() => h401(), /UNAUTHENTICATED/);

  setFetch(async () => ({ ok: false, status: 403, headers: new Map(), text: async () => 'Forbidden' }));
  const h403 = await loadHandler({ event_id: '1' }, getEventPath);
  await assert.rejects(() => h403(), /PERMISSION_DENIED/);

  setFetch(async () => ({ ok: false, status: 404, headers: new Map(), text: async () => 'Not found' }));
  const h404 = await loadHandler({ event_id: '1' }, getEventPath);
  await assert.rejects(() => h404(), /NOT_FOUND/);

  setFetch(async () => ({ ok: false, status: 429, headers: new Map(), text: async () => 'Rate limited' }));
  const h429 = await loadHandler({ event_id: '1' }, getEventPath);
  await assert.rejects(() => h429(), /FAILED_PRECONDITION/);

  setFetch(async () => ({ ok: false, status: 500, headers: new Map(), text: async () => 'Error' }));
  const h500 = await loadHandler({ event_id: '1' }, getEventPath);
  await assert.rejects(() => h500(), /UNAVAILABLE/);

  // Timeout errors should map to DEADLINE_EXCEEDED, not UNAVAILABLE
  const timeoutErr = new Error('timeout');
  timeoutErr.name = 'TimeoutError';
  setFetch(async () => { throw timeoutErr; });
  const hTimeout = await loadHandler({ event_id: '1' }, getEventPath);
  await assert.rejects(() => hTimeout(), /DEADLINE_EXCEEDED/);

  // Network errors should map to UNAVAILABLE
  setFetch(async () => { throw new Error('connection refused'); });
  const hNet = await loadHandler({ event_id: '1' }, getEventPath);
  await assert.rejects(() => hNet(), /UNAVAILABLE/);
});

test('HTTP error messages do not leak upstream body', async () => {
  const messages = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => messages.push(args.join(' '));
  console.error = (...args) => messages.push(args.join(' '));
  setFetch(async () => ({ ok: false, status: 401, headers: new Map(), text: async () => 'secret-token-leaked' }));
  const h = await loadHandler({ event_id: '1' }, getEventPath);
  try {
    await h();
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(/UNAUTHENTICATED/.test(e.message));
    assert.ok(!e.message.includes('secret-token-leaked'), 'error message should not contain upstream body');
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  assert.ok(messages.every((message) => !message.includes('secret-token-leaked')), 'logs should not contain upstream body');
});

test('MISP API errors handled', async () => {
  mockUpstream({ errors: { name: ['Already exists'] } });
  const handler = await loadHandler({ info: 'test' }, createEventPath);
  await assert.rejects(() => handler(), /FAILED_PRECONDITION/);
});

test('Non-JSON and empty body handled', async () => {
  setFetch(async () => ({ ok: true, status: 200, headers: new Map(), text: async () => '' }));
  const h = await loadHandler({}, searchEventsPath);
  await assert.rejects(() => h(), /UNKNOWN: empty response/);
  setFetch(async () => ({ ok: true, status: 200, headers: new Map(), text: async () => 'not-json' }));
  const invalidJson = await loadHandler({}, searchEventsPath);
  await assert.rejects(() => invalidJson(), /response is not valid JSON/);
});

test('response body read failures map to timeout and unavailable errors', async () => {
  setFetch(async () => ({ ok: true, status: 200, headers: new Map(), text: async () => { const err = new Error('timeout'); err.name = 'AbortError'; throw err; } }));
  const timeout = await loadHandler({}, searchEventsPath);
  await assert.rejects(() => timeout(), /DEADLINE_EXCEEDED/);
  setFetch(async () => ({ ok: true, status: 200, headers: new Map(), text: async () => { throw new Error('read failed'); } }));
  const unavailable = await loadHandler({}, searchEventsPath);
  await assert.rejects(() => unavailable(), /UNAVAILABLE/);
});

test('callMisp encodes query parameters and honors alias TLS configuration', async () => {
  const { _test } = await import('../src/misp.js');
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify({}) };
  });
  await _test.callMisp(buildCtx({}, { bindings: { tlsInsecureSkipVerify: 'yes' } }), 'GET', '/events', undefined, { name: 'a b', omit: '', enabled: true });
  assert.ok(captured.url.endsWith('/events?name=a%20b&enabled=true'));
  assert.ok(captured.init.dispatcher);
});

// ── SDK handlers ──────────────────────────────────────────

test('SDK handlers accept single-arg (ctx) style from OctoBus SDK', async () => {
  setFetch(async () => ({
    ok: true, status: 200,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify({ response: [{ id: '1', info: 'from-sdk' }] }),
  }));

  const { handlers, SEARCH_EVENTS_FULL } = await import('../src/misp.js');
  // OctoBus SDK passes a single ctx object: {request, config, secret, ...}
  const res = await handlers[SEARCH_EVENTS_FULL]({
    request: { value: '8.8.8.8' },
    config: { endpoint: 'https://custom.misp.local' },
    secret: { api_key: 'sdk-key' },
  });
  assert.equal(res.items[0].info, 'from-sdk');
});

test('every exposed SDK handler accepts the single-context ABI', async () => {
  setFetch(async (url) => {
    let body = { response: [] };
    if (url.includes('/events/')) body = { Event: {} };
    else if (url.includes('/events/add')) body = { Event: {} };
    else if (url.includes('/attributes/add')) body = { Attribute: {} };
    else if (url.includes('/tags/search')) body = [];
    return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify(body) };
  });
  const { handlers } = await import('../src/misp.js');
  const ctx = (request) => ({ request, config: { endpoint: 'https://custom.misp.local' }, secret: { api_key: 'sdk-key' } });
  await handlers['MISP.MISP/SearchEvents'](ctx({}));
  await handlers['MISP.MISP/GetEvent'](ctx({ event_id: '1' }));
  await handlers['MISP.MISP/CreateEvent'](ctx({ info: 'event' }));
  await handlers['MISP.MISP/SearchAttributes'](ctx({}));
  await handlers['MISP.MISP/AddAttribute'](ctx({ event_id: '1', value: '1.2.3.4', type: 'ip-src' }));
  await handlers['MISP.MISP/SearchTags'](ctx({ name: 'tlp' }));
});

test('skipTlsVerify uses an undici dispatcher instead of unsupported fetch options', async () => {
  let captured;
  setFetch(async (_url, init) => {
    captured = init;
    return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify({ response: [] }) };
  });
  const handler = await loadHandler({}, searchEventsPath, { bindings: { skipTlsVerify: true } });
  await handler();
  assert.ok(captured.dispatcher, 'an isolated TLS dispatcher should be supplied');
  assert.equal(captured.insecureSkipVerify, undefined);
  assert.equal(captured.tlsInsecureSkipVerify, undefined);
});

test('Missing credentials fails gracefully', async () => {
  const handler = await loadHandler({}, searchEventsPath, { bindings: { endpoint: 'https://x', api_key: '' } });
  await assert.rejects(() => handler(), /FAILED_PRECONDITION/);
});
