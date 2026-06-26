import test from 'node:test';
import assert from 'node:assert/strict';

const listSessionsPath = '/Tencent_BH.Tencent_BH/ListSessions';
const killSessionPath = '/Tencent_BH.Tencent_BH/KillSession';
const listDevicesPath = '/Tencent_BH.Tencent_BH/ListDevices';
const listUsersPath = '/Tencent_BH.Tencent_BH/ListUsers';
const lockUserPath = '/Tencent_BH.Tencent_BH/LockUser';
const unlockUserPath = '/Tencent_BH.Tencent_BH/UnlockUser';

const buildCtx = (req = {}, overrides = {}) => ({
  bindings: {
    secret_id: 'test-secret-id',
    secret_key: 'test-secret-key',
    region: 'ap-guangzhou',
    ...overrides.bindings,
  },
  limits: { timeoutMs: 10000, ...overrides.limits },
  meta: { instance_id: 'inst', request_id: 'req', ...overrides.meta },
  req,
});

const loadHandler = async (req, path, overrides = {}) => {
  const { rpcdef } = await import('../src/tencent-bh.js');
  const ctx = buildCtx(req, overrides);
  return rpcdef(ctx)[path];
};

const setFetch = (impl) => {
  global.fetch = impl;
};

const mockUpstream = (responseBody, status = 200) => {
  setFetch(async (url, init) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify(responseBody),
  }));
};

// ── Internal helpers ──────────────────────────────────────

test('internal helpers work correctly', async () => {
  const { _test } = await import('../src/tencent-bh.js');

  // mergedBindings
  const merged = _test.mergedBindings({
    config: { region: 'ap-beijing' },
    secret: { secret_id: 'from-secret' },
    bindings: { endpoint: 'custom.bh.com' },
  });
  assert.equal(merged.region, 'ap-beijing');
  assert.equal(merged.secret_id, 'from-secret');
  assert.equal(merged.endpoint, 'custom.bh.com');

  // toTrimmedString
  assert.equal(_test.toTrimmedString(undefined), '');
  assert.equal(_test.toTrimmedString(' hello '), 'hello');
  assert.equal(_test.toTrimmedString({ value: ' world ' }), 'world');

  // toInt64
  assert.equal(_test.toInt64(null), null);
  assert.equal(_test.toInt64({ value: 42 }), 42);
  assert.equal(_test.toInt64('abc'), null);

  // firstDefined
  assert.equal(_test.firstDefined(undefined, null, 'a'), 'a');
  assert.equal(_test.firstDefined('b'), 'b');

  // toBoolean - various types
  assert.equal(_test.toBoolean(true), true);
  assert.equal(_test.toBoolean(false), false);
  assert.equal(_test.toBoolean('true'), true);
  assert.equal(_test.toBoolean('false'), false);
  assert.equal(_test.toBoolean({ value: 'true' }), true);
  assert.equal(_test.toBoolean({}), true);
  assert.equal(_test.toBoolean(0), false);
  assert.equal(_test.toBoolean(1), true);

  // toValue - various types including edge cases
  assert.deepEqual(_test.toValue('hello'), { stringValue: 'hello' });
  assert.deepEqual(_test.toValue(42), { numberValue: 42 });
  assert.deepEqual(_test.toValue(true), { boolValue: true });
  const objVal = _test.toValue({ key: 'val' });
  assert.ok(objVal.structValue);
  assert.equal(objVal.structValue.fields.key.stringValue, 'val');
  const arrVal = _test.toValue(['a', 'b']);
  assert.equal(arrVal.listValue.values.length, 2);
  const symVal = _test.toValue(Symbol.for('test'));
  assert.equal(symVal.stringValue, 'Symbol(test)');
  assert.equal(_test.toValue(null), undefined);
  assert.equal(_test.toValue(undefined), undefined);
});

// ── TC3 Signing ───────────────────────────────────────────

test('TC3 signing produces valid authorization header', async () => {
  const { _test } = await import('../src/tencent-bh.js');

  const signed = _test.tc3Sign(
    { Limit: 20, Offset: 0 },
    'test-secret-id',
    'test-secret-key',
    'ap-guangzhou',
    'bh.tencentcloudapi.com',
    'SearchSession',
  );

  assert.ok(signed.url.startsWith('https://'));
  assert.ok(signed.headers['Authorization'].startsWith('TC3-HMAC-SHA256'));
  assert.equal(signed.headers['Content-Type'], 'application/json');
  assert.equal(signed.headers['X-TC-Action'], 'SearchSession');
  assert.equal(signed.headers['X-TC-Region'], 'ap-guangzhou');
  assert.equal(signed.headers['X-TC-Version'], '2023-04-18');
  assert.equal(String(signed.headers['X-TC-Timestamp']).length, 10);
  assert.equal(signed.body, JSON.stringify({ Limit: 20, Offset: 0 }));
});

test('canonical request structure', async () => {
  const { _test } = await import('../src/tencent-bh.js');

  const signed = _test.tc3Sign(
    { test: 'value' },
    'test-id',
    'test-key',
    'ap-guangzhou',
    'bh.tencentcloudapi.com',
    'TestAction',
  );

  const auth = signed.headers['Authorization'];
  assert.ok(auth.startsWith('TC3-HMAC-SHA256'));
  assert.ok(auth.includes('Credential='));
  assert.ok(auth.includes('SignedHeaders=content-type;host'));
  assert.ok(auth.includes('Signature='));
  assert.equal(signed.headers['Content-Type'], 'application/json');
});

// ── Credential resolution ─────────────────────────────────

test('resolveCredentials extracts and validates credentials', async () => {
  const { _test } = await import('../src/tencent-bh.js');

  const creds = _test.resolveCredentials({ secret_id: 'id1', secret_key: 'key1' });
  assert.equal(creds.secretId, 'id1');
  assert.equal(creds.secretKey, 'key1');

  const camelCase = _test.resolveCredentials({ secretId: 'id2', secretKey: 'key2' });
  assert.equal(camelCase.secretId, 'id2');
  assert.equal(camelCase.secretKey, 'key2');

  assert.throws(() => _test.resolveCredentials({}), /secret_id.*is required/);
  assert.throws(() => _test.resolveCredentials({ secret_id: 'id' }), /secret_key.*is required/);
});

test('resolveRegion and resolveEndpoint use defaults', async () => {
  const { _test } = await import('../src/tencent-bh.js');

  assert.equal(_test.resolveRegion({}), 'ap-guangzhou');
  assert.equal(_test.resolveRegion({ region: 'ap-beijing' }), 'ap-beijing');
  assert.equal(_test.resolveEndpoint({}), 'bh.tencentcloudapi.com');
  assert.equal(_test.resolveEndpoint({ endpoint: 'custom.bh.com' }), 'custom.bh.com');
});

// ── ListSessions ──────────────────────────────────────────

test('ListSessions builds correct request params', async () => {
  const { _test } = await import('../src/tencent-bh.js');

  const defaultParams = _test.buildListSessionsParams({});
  assert.equal(defaultParams.Limit, 20);
  assert.ok(!('Offset' in defaultParams));
  assert.ok(!('Filters' in defaultParams));

  const withFilters = _test.buildListSessionsParams({
    offset: 10,
    limit: 50,
    status: ['ACTIVE'],
    user_name: 'admin',
    device_name: 'web-01',
  });
  assert.equal(withFilters.Offset, 10);
  assert.equal(withFilters.Limit, 50);
  assert.ok(withFilters.Filters.length >= 3);
});

test('ListSessions sends signed request and maps response', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({
        Response: {
          SessionSet: [
            {
              Id: 'session-1',
              UserName: 'admin',
              DeviceName: 'server-01',
              Status: 'ACTIVE',
              StartTime: '2026-06-25T10:00:00Z',
              EndTime: '',
            },
          ],
          TotalCount: 1,
        },
      }),
    };
  });

  const handler = await loadHandler(
    { status: ['ACTIVE'], limit: 10 },
    listSessionsPath,
  );
  const res = await handler();

  assert.ok(captured.url.includes('bh.tencentcloudapi.com'));
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['Content-Type'], 'application/json');
  assert.equal(captured.init.headers['X-TC-Action'], 'SearchSession');
  // Verify x-tc-action also works (lowercase)
  const lowerHeaders = {};
  Object.keys(captured.init.headers).forEach(k => { lowerHeaders[k.toLowerCase()] = captured.init.headers[k]; });
  assert.equal(lowerHeaders['x-tc-action'], 'SearchSession');
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].id, 'session-1');
  assert.equal(res.items[0].user_name, 'admin');
  assert.equal(res.items[0].status, 'ACTIVE');
  assert.equal(res.total_count, 1);
});

test('ListSessions handles empty response', async () => {
  mockUpstream({ Response: { SessionSet: [], TotalCount: 0 } });
  const handler = await loadHandler({}, listSessionsPath);
  const res = await handler();
  assert.deepEqual(res.items, []);
  assert.equal(res.total_count, 0);
});

test('ListSessions validates and maps upstream errors', async () => {
  setFetch(async () => ({
    ok: false,
    status: 401,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => 'Unauthorized',
  }));
  const handler = await loadHandler({}, listSessionsPath);
  await assert.rejects(() => handler(), /UNAUTHENTICATED/);

  setFetch(async () => ({
    ok: false,
    status: 500,
    headers: new Map([['content-type', 'text/plain']]),
    text: async () => 'Internal Server Error',
  }));
  const handler500 = await loadHandler({}, listSessionsPath);
  await assert.rejects(() => handler500(), /UNAVAILABLE/);

  setFetch(async () => {
    throw new Error('network timeout');
  });
  const handlerNet = await loadHandler({}, listSessionsPath);
  await assert.rejects(() => handlerNet(), /UNAVAILABLE/);
});

test('ListSessions handles Tencent API error response', async () => {
  mockUpstream({
    Response: {
      Error: {
        Code: 'AuthFailure',
        Message: 'SecretId not found',
      },
    },
  });
  const handler = await loadHandler({}, listSessionsPath);
  await assert.rejects(() => handler(), /UNAUTHENTICATED: Tencent API error: AuthFailure/);
});

test('ListSessions handles non-JSON and empty body', async () => {
  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'text/plain']]),
    text: async () => 'not json',
  }));
  const handler = await loadHandler({}, listSessionsPath);
  await assert.rejects(() => handler(), /UNKNOWN: response is not valid JSON/);

  setFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => '',
  }));
  const handlerEmpty = await loadHandler({}, listSessionsPath);
  await assert.rejects(() => handlerEmpty(), /UNKNOWN: empty response/);
});

test('ListSessions respects max limit', async () => {
  const { _test } = await import('../src/tencent-bh.js');
  const params = _test.buildListSessionsParams({ limit: 500 });
  assert.equal(params.Limit, 20);
});

// ── KillSession ───────────────────────────────────────────

test('KillSession requires session_id', async () => {
  const handler = await loadHandler({}, killSessionPath);
  await assert.rejects(() => handler(), /INVALID_ARGUMENT: session_id is required/);
});

test('KillSession sends correct API call', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ Response: { err: null, msg: 'ok' } }),
    };
  });

  const handler = await loadHandler({ session_id: 'sess-123' }, killSessionPath);
  const res = await handler();
  assert.equal(captured.init.headers['X-TC-Action'], 'KillSession');
  const body = JSON.parse(captured.init.body);
  assert.equal(body.SessionId, 'sess-123');
});

// ── ListDevices ───────────────────────────────────────────

test('ListDevices builds params and maps response', async () => {
  const { _test } = await import('../src/tencent-bh.js');

  // Test with offset and limit parameters
  const params = _test.buildListDevicesParams({ name: 'web', ip: '10.0.0.1', limit: 50, offset: 10 });
  assert.equal(params.Limit, 50);
  assert.equal(params.Offset, 10);
  assert.equal(params.Filters[0].Name, 'DeviceName');
  assert.equal(params.Filters[1].Name, 'Ip');

  // Test without filters
  const noFilters = _test.buildListDevicesParams({});
  assert.ok(!('Filters' in noFilters));

  // Test with negative offset
  const negOffset = _test.buildListDevicesParams({ offset: -1 });
  assert.ok(!('Offset' in negOffset));

  mockUpstream({
    Response: {
      DeviceSet: [
        { Id: 'dev-1', DeviceName: 'web-01', Ip: '10.0.0.1', DeviceType: 'Linux', State: 'online', Department: 'IT' },
      ],
      TotalCount: 1,
    },
  });
  const handler = await loadHandler({}, listDevicesPath);
  const res = await handler();
  assert.equal(res.items[0].name, 'web-01');
  assert.equal(res.items[0].ip, '10.0.0.1');
});

// ── ListUsers ─────────────────────────────────────────────

test('ListUsers builds params and maps response', async () => {
  const { _test } = await import('../src/tencent-bh.js');

  const params = _test.buildListUsersParams({ name: 'admin', status: 'NORMAL', offset: 20 });
  assert.equal(params.Offset, 20);
  assert.equal(params.Filters[0].Name, 'UserName');
  assert.equal(params.Filters[1].Name, 'Status');

  // No status filter
  const noStatus = _test.buildListUsersParams({});
  assert.ok(!('Filters' in noStatus));

  // Max limit exceeded, should cap to default
  const maxed = _test.buildListUsersParams({ limit: 500 });
  assert.equal(maxed.Limit, 20);

  mockUpstream({
    Response: {
      UserSet: [
        { UserId: 'u-1', UserName: 'admin', RealName: 'Admin User', Phone: '13800000000', Email: 'admin@test.com', Status: 'NORMAL', Department: 'IT' },
      ],
      TotalCount: 1,
    },
  });
  const handler = await loadHandler({}, listUsersPath);
  const res = await handler();
  assert.equal(res.items[0].user_name, 'admin');
  assert.equal(res.items[0].status, 'NORMAL');
});

// ── LockUser / UnlockUser ─────────────────────────────────

test('LockUser requires user_id', async () => {
  const handler = await loadHandler({}, lockUserPath);
  await assert.rejects(() => handler(), /INVALID_ARGUMENT: user_id is required/);
});

test('LockUser sends API call with correct param', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ Response: {} }),
    };
  });

  const handler = await loadHandler({ user_id: 1 }, lockUserPath);
  await handler();
  const body = JSON.parse(captured.init.body);
  assert.deepEqual(body.IdSet, [1]);
  assert.equal(captured.init.headers['X-TC-Action'], 'LockUser');
});

test('UnlockUser requires user_id', async () => {
  const handler = await loadHandler({}, unlockUserPath);
  await assert.rejects(() => handler(), /INVALID_ARGUMENT: user_id is required/);
});

test('UnlockUser sends API call with correct param', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ Response: {} }),
    };
  });

  const handler = await loadHandler({ user_id: 1 }, unlockUserPath);
  await handler();
  const body = JSON.parse(captured.init.body);
  assert.deepEqual(body.IdSet, [1]);
  assert.equal(captured.init.headers['X-TC-Action'], 'UnlockUser');
});

// ── SDK handlers ──────────────────────────────────────────

test('SDK handlers accept two-arg (req, ctx) style', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({
        Response: { SessionSet: [{ Id: 's-1', UserName: 'admin', DeviceName: 'svr', Status: 'ACTIVE' }], TotalCount: 1 },
      }),
    };
  });

  const { handlers, LIST_SESSIONS_FULL } = await import('../src/tencent-bh.js');
  const res = await handlers[LIST_SESSIONS_FULL](
    { status: ['ACTIVE'] },
    {
      config: { region: 'ap-beijing' },
      secret: { secret_id: 'sdk-id', secret_key: 'sdk-key' },
      meta: { instance_id: 'sdk-inst' },
    },
  );

  assert.equal(res.items.length, 1);
  assert.equal(captured.init.headers['x-engine-instance'], 'sdk-inst');
});

// ── Multiple error status codes ───────────────────────────

test('HTTP error codes are mapped correctly', async () => {
  setFetch(async () => ({
    ok: false,
    status: 403,
    headers: new Map([['content-type', 'text/plain']]),
    text: async () => 'Forbidden',
  }));
  const h403 = await loadHandler({}, listSessionsPath);
  await assert.rejects(() => h403(), /PERMISSION_DENIED/);

  setFetch(async () => ({
    ok: false,
    status: 422,
    headers: new Map([['content-type', 'text/plain']]),
    text: async () => 'Invalid params',
  }));
  const h422 = await loadHandler({}, listSessionsPath);
  await assert.rejects(() => h422(), /FAILED_PRECONDITION/);

  setFetch(async () => ({
    ok: false,
    status: 503,
    headers: new Map([['content-type', 'text/plain']]),
    text: async () => 'Service unavailable',
  }));
  const h503 = await loadHandler({}, listSessionsPath);
  await assert.rejects(() => h503(), /UNAVAILABLE/);
});

// ── Response mapping variations ───────────────────────────

test('Response mappers handle missing fields gracefully', async () => {
  const { _test } = await import('../src/tencent-bh.js');

  const session = _test.mapSessionRecord({});
  assert.equal(session.id, '');
  assert.equal(session.user_name, '');

  const device = _test.mapDeviceRecord({});
  assert.equal(device.name, '');
  assert.equal(device.ip, '');

  const user = _test.mapUserRecord({});
  assert.equal(user.user_name, '');
  assert.equal(user.status, '');
});

test('Map empty upstream response sets', async () => {
  mockUpstream({ Response: {} });
  const handler = await loadHandler({}, listDevicesPath);
  const res = await handler();
  assert.deepEqual(res.items, []);
  assert.equal(res.total_count, 0);
});

// ── Edge cases for params builders ────────────────────────

test('Param builders handle limit over max', async () => {
  const { _test } = await import('../src/tencent-bh.js');

  const sessionsParams = _test.buildListSessionsParams({ limit: 999 });
  assert.equal(sessionsParams.Limit, 20);

  const devicesParams = _test.buildListDevicesParams({ limit: 999 });
  assert.equal(devicesParams.Limit, 20);

  const usersParams = _test.buildListUsersParams({ limit: 0 });
  assert.equal(usersParams.Limit, 20);
});

// ── hasOwn and resolveCallContext ─────────────────────────

test('hasOwn and resolveCallContext utilities work', async () => {
  const { _test } = await import('../src/tencent-bh.js');

  assert.ok(_test.hasOwn({ a: 1 }, 'a'));
  assert.ok(!_test.hasOwn({ a: 1 }, 'b'));
  assert.ok(!_test.hasOwn(null, 'a'));
  assert.ok(!_test.hasOwn(undefined, 'a'));

  const resolved = _test.resolveCallContext({
    config: { region: 'test' },
    secret: { secret_id: 'id' },
    meta: { instance_id: 'inst' },
    req: { limit: 10 },
  });
  assert.equal(resolved.req.limit, 10);
  assert.equal(resolved.bindings.region, 'test');
  assert.equal(resolved.bindings.secret_id, 'id');

  // resolveTimeoutMs
  assert.equal(_test.resolveTimeoutMs({ timeoutMs: 5000 }, {}), 5000);
  assert.equal(_test.resolveTimeoutMs({}, { timeoutMs: 3000 }), 3000);
  assert.equal(_test.resolveTimeoutMs({}, {}), 10000); // default
});

test('logFlow handles stringify failure gracefully', async () => {
  const { _test } = await import('../src/tencent-bh.js');
  // Should not throw - circular reference would cause JSON.stringify to throw
  const circular = { self: null };
  circular.self = circular;
  _test.logFlow({}, 'test', circular);
});

// ── Error branch: missing credentials at handler call ─────

test('Handler fails with clear error when credentials are not configured', async () => {
  // Override the default bindings to remove credentials
  const handler = await loadHandler(
    {},
    listSessionsPath,
    { bindings: { secret_id: '', secret_key: '', region: 'ap-guangzhou' } },
  );
  await assert.rejects(() => handler(), /FAILED_PRECONDITION/);
});

// ── SearchSession graceful degradation ───────────────────

test('ListSessions returns empty list when BH instance does not support SearchSession (InvalidParameterValue)', async () => {
  // Simulate a BH instance that doesn't support SearchSession and returns
  // InvalidParameterValue regardless of parameters
  mockUpstream({
    Response: {
      Error: {
        Code: 'InvalidParameterValue',
        Message: 'The instance does not support session search',
      },
    },
  });
  const handler = await loadHandler({}, listSessionsPath);
  const result = await handler();
  assert.deepEqual(result, { items: [], total_count: 0 });
});

test('ListSessions propagates other InvalidParameterValue errors (not SearchSession-specific)', async () => {
  // Simulate a genuine InvalidParameterValue error (e.g. wrong parameter value)
  // that should NOT be silently swallowed
  mockUpstream({
    Response: {
      Error: {
        Code: 'InvalidParameterValue.Offset',
        Message: 'Offset must be a positive integer',
      },
    },
  });
  const handler = await loadHandler({}, listSessionsPath);
  await assert.rejects(() => handler(), /FAILED_PRECONDITION/);
});

test('ListSessions propagates non-InvalidParameterValue errors unchanged', async () => {
  // Simulate an AuthFailure error - should not be caught by SearchSession degradation
  mockUpstream({
    Response: {
      Error: {
        Code: 'AuthFailure',
        Message: 'Invalid secret_id or secret_key',
      },
    },
  });
  const handler = await loadHandler({}, listSessionsPath);
  await assert.rejects(() => handler(), /UNAUTHENTICATED/);
});

test('callAction attaches tencentCode to error for precise matching', async () => {
  const { _test } = await import('../src/tencent-bh.js');
  // Verify errorWithCode doesn't have tencentCode (only set by callAction)
  const plainErr = _test.errorWithCode('FAILED_PRECONDITION', 'test error');
  assert.equal(plainErr.tencentCode, undefined);

  // Simulate upstream error to verify tencentCode is set on a non-degraded path
  // Use killSession with a valid session_id so it reaches the API call
  mockUpstream({
    Response: {
      Error: {
        Code: 'ResourceNotFound',
        Message: 'Session not found',
      },
    },
  });
  const handler = await loadHandler({ session_id: 'sess-123' }, killSessionPath);
  try {
    await handler();
    assert.fail('Expected error to be thrown');
  } catch (e) {
    assert.equal(e.tencentCode, 'ResourceNotFound');
    assert.equal(e.legacyCode, 'FAILED_PRECONDITION');
  }
});
