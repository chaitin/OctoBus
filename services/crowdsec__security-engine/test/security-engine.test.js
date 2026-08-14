import test from 'node:test';
import assert from 'node:assert/strict';

const METHOD_LIST_ALERTS = '/Crowdsec_SECURITY_ENGINE.Crowdsec_SECURITY_ENGINE/ListAlerts';
const METHOD_GET_ALERT = '/Crowdsec_SECURITY_ENGINE.Crowdsec_SECURITY_ENGINE/GetAlert';
const METHOD_LIST_DECISIONS = '/Crowdsec_SECURITY_ENGINE.Crowdsec_SECURITY_ENGINE/ListDecisions';
const METHOD_BLOCK_IP = '/Crowdsec_SECURITY_ENGINE.Crowdsec_SECURITY_ENGINE/BlockIP';
const METHOD_UNBLOCK_IP = '/Crowdsec_SECURITY_ENGINE.Crowdsec_SECURITY_ENGINE/UnblockIP';
const METHOD_DELETE_DECISION = '/Crowdsec_SECURITY_ENGINE.Crowdsec_SECURITY_ENGINE/DeleteDecision';

const makeCtx = (req = {}, overrides = {}) => ({
  config: overrides.config ?? {},
  secret: overrides.secret ?? {},
  bindings: overrides.bindings ?? {},
  limits: { timeoutMs: 10_000, ...(overrides.limits ?? {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta ?? {}) },
  req,
});

const importModule = async () => {
  const mod = await import('../src/security-engine.js');
  return mod;
};

const invokeRpc = async (mod, methodPath, req, overrides) => {
  const ctx = makeCtx(req, overrides);
  const rpc = mod.rpcdef(ctx);
  return rpc[methodPath]();
};

const mockFetch = (impl) => {
  global.fetch = impl;
};

const restoreFetch = (saved) => {
  global.fetch = saved;
};

// ── ListAlerts ──────────────────────────────────────────────────

test('ListAlerts — basic call returns alerts', async () => {
  const mod = await importModule();
  const saved = global.fetch;
  let loginCalled = false;
  let alertsCalled = false;

  mockFetch(async (url, opts) => {
    if (url.includes('/v1/watchers/login')) {
      loginCalled = true;
      return new Response(JSON.stringify({ code: 200, token: 'test-jwt-token', expire: new Date(Date.now() + 3600000).toISOString() }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/v1/alerts')) {
      alertsCalled = true;
      return new Response(JSON.stringify([
        {
          id: 1, uuid: 'u1', machine_id: 'm1', created_at: '2026-06-27T12:00:00Z',
          scenario: 'ssh-bf', scenario_hash: 'h1', scenario_version: '0.1',
          message: 'ssh brute force', events_count: 10,
          start_at: '2026-06-27T11:00:00Z', stop_at: '2026-06-27T12:00:00Z',
          capacity: 5, leakspeed: '10', simulated: false,
          source: { scope: 'ip', value: '1.2.3.4', ip: '1.2.3.4', as_number: '13335', as_name: 'CF', cn: 'US', latitude: 37.7, longitude: -122.4 },
          events: [{ timestamp: '2026-06-27T11:30:00Z', meta: [{ key: 'log', value: 'attempt' }] }],
          decisions: [{ id: 2, uuid: 'd1', origin: 'crowdsec', type: 'ban', scope: 'ip', value: '1.2.3.4', duration: '3h59m59s', scenario: 'ssh-bf', simulated: false }],
          meta: [{ key: 'reason', value: 'bf' }],
          remediation: true, kind: '',
        },
      ]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  });

  const result = await invokeRpc(mod, METHOD_LIST_ALERTS, {}, { bindings: { endpoint: 'http://localhost:18080', machineId: 'test-machine', password: 'test-password' } });
  assert.ok(loginCalled);
  assert.ok(alertsCalled);
  assert.equal(result.alerts.length, 1);
  assert.equal(result.alerts[0].id, 1);
  assert.equal(result.alerts[0].scenario, 'ssh-bf');
  assert.equal(result.alerts[0].source.ip, '1.2.3.4');
  assert.equal(result.alerts[0].decisions[0].type, 'ban');

  restoreFetch(saved);
});

test('ListAlerts — with query filters', async () => {
  const mod = await importModule();
  const saved = global.fetch;
  let requestUrl = '';

  mockFetch(async (url, opts) => {
    if (url.includes('/v1/watchers/login')) {
      return new Response(JSON.stringify({ code: 200, token: 'jwt-ok', expire: new Date(Date.now() + 3600000).toISOString() }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    requestUrl = url;
    return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
  });

  const result = await invokeRpc(mod, METHOD_LIST_ALERTS, { scenario: 'ssh-bf', ip: '1.2.3.4', limit: 5 }, { bindings: { endpoint: 'http://localhost:18080', machineId: 'test-machine', password: 'test-password' } });
  assert.ok(requestUrl.includes('scenario=ssh-bf'));
  assert.ok(requestUrl.includes('ip=1.2.3.4'));
  assert.ok(requestUrl.includes('limit=5'));

  restoreFetch(saved);
});

test('ListAlerts — missing machineId/password throws INVALID_ARGUMENT', async () => {
  const mod = await importModule();
  mod._test.clearJwtCache();
  const saved = global.fetch;
  mockFetch(async () => new Response('ok', { status: 200 }));

  try {
    await invokeRpc(mod, METHOD_LIST_ALERTS, {}, { bindings: { endpoint: 'http://localhost:18080' } });
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.code, 3); // INVALID_ARGUMENT — missing credentials
  }

  restoreFetch(saved);
});

test('ListAlerts — auth failure maps to UNAUTHENTICATED', async () => {
  const mod = await importModule();
  mod._test.clearJwtCache();
  const saved = global.fetch;

  mockFetch(async (url, opts) => {
    if (url.includes('/v1/watchers/login')) {
      return new Response(JSON.stringify({ message: 'invalid credentials' }), { status: 401, headers: { 'content-type': 'application/json' } });
    }
    return new Response('ok', { status: 200 });
  });

  try {
    await invokeRpc(mod, METHOD_LIST_ALERTS, {}, { bindings: { endpoint: 'http://localhost:18080', machineId: 'test-machine', password: 'wrong-password' } });
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.code, 16); // UNAUTHENTICATED
  }

  restoreFetch(saved);
});

// ── GetAlert ────────────────────────────────────────────────────

test('GetAlert — basic call returns alert detail', async () => {
  const mod = await importModule();
  const saved = global.fetch;

  mockFetch(async (url, opts) => {
    if (url.includes('/v1/watchers/login')) {
      return new Response(JSON.stringify({ code: 200, token: 'jwt-ok', expire: new Date(Date.now() + 3600000).toISOString() }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/v1/alerts/1')) {
      return new Response(JSON.stringify({
        id: 1, uuid: 'u1', machine_id: 'm1', created_at: '2026-06-27T12:00:00Z',
        scenario: 'ssh-bf', message: 'ssh brute force',
        source: { scope: 'ip', value: '1.2.3.4', ip: '1.2.3.4' },
        events: [], decisions: [], meta: [],
        events_count: 10, start_at: '', stop_at: '', capacity: 0, leakspeed: '', simulated: false, remediation: true, kind: '', scenario_hash: '', scenario_version: '',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  });

  const result = await invokeRpc(mod, METHOD_GET_ALERT, { alert_id: 1 }, { bindings: { endpoint: 'http://localhost:18080', machineId: 'test-machine', password: 'test-password' } });
  assert.equal(result.alert.id, 1);
  assert.equal(result.alert.scenario, 'ssh-bf');

  restoreFetch(saved);
});

test('GetAlert — missing alert_id throws INVALID_ARGUMENT', async () => {
  const mod = await importModule();
  const saved = global.fetch;
  mockFetch(async () => new Response('ok', { status: 200 }));

  try {
    await invokeRpc(mod, METHOD_GET_ALERT, {}, { bindings: { endpoint: 'http://localhost:18080' } });
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.code, 3); // INVALID_ARGUMENT
  }

  restoreFetch(saved);
});

test('GetAlert — 404 maps to FAILED_PRECONDITION', async () => {
  const mod = await importModule();
  const saved = global.fetch;

  mockFetch(async (url, opts) => {
    if (url.includes('/v1/watchers/login')) {
      return new Response(JSON.stringify({ code: 200, token: 'jwt-ok', expire: new Date(Date.now() + 3600000).toISOString() }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ message: 'alert not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  });

  try {
    await invokeRpc(mod, METHOD_GET_ALERT, { alert_id: 999 }, { bindings: { endpoint: 'http://localhost:18080', machineId: 'test-machine', password: 'test-password' } });
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.code, 9); // FAILED_PRECONDITION
  }

  restoreFetch(saved);
});

// ── ListDecisions ───────────────────────────────────────────────

test('ListDecisions — basic call with apiKey returns decisions', async () => {
  const mod = await importModule();
  const saved = global.fetch;
  let usedAuth = '';

  mockFetch(async (url, opts) => {
    usedAuth = opts.headers['X-Api-Key'] || opts.headers['Authorization'] || '';
    return new Response(JSON.stringify([
      { id: 2, uuid: 'd1', origin: 'crowdsec', type: 'ban', scope: 'ip', value: '1.2.3.4', duration: '3h59m59s', scenario: 'ssh-bf', simulated: false },
      { id: 3, uuid: 'd2', origin: 'cscli', type: 'ban', scope: 'ip', value: '5.6.7.8', duration: '4h', scenario: 'manual', simulated: false },
    ]), { status: 200, headers: { 'content-type': 'application/json' } });
  });

  const result = await invokeRpc(mod, METHOD_LIST_DECISIONS, {}, { bindings: { endpoint: 'http://localhost:18080', apiKey: 'test-api-key' } });
  assert.equal(result.decisions.length, 2);
  assert.equal(result.decisions[0].type, 'ban');
  assert.equal(result.decisions[1].origin, 'cscli');
  assert.equal(usedAuth, 'test-api-key');

  restoreFetch(saved);
});

test('ListDecisions — falls back to JWT when no apiKey', async () => {
  const mod = await importModule();
  mod._test.clearJwtCache();
  const saved = global.fetch;
  let usedAuth = '';
  let loginCalled = false;

  mockFetch(async (url, opts) => {
    if (url.includes('/v1/watchers/login')) {
      loginCalled = true;
      return new Response(JSON.stringify({ code: 200, token: 'jwt-ok', expire: new Date(Date.now() + 3600000).toISOString() }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    usedAuth = opts.headers['Authorization'] || opts.headers['X-Api-Key'] || '';
    return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
  });

  const result = await invokeRpc(mod, METHOD_LIST_DECISIONS, {}, { bindings: { endpoint: 'http://localhost:18080', machineId: 'test-machine', password: 'test-password' } });
  assert.ok(loginCalled);
  assert.ok(usedAuth.startsWith('Bearer '));

  restoreFetch(saved);
});

test('ListDecisions — with query filters', async () => {
  const mod = await importModule();
  const saved = global.fetch;
  let requestUrl = '';

  mockFetch(async (url, opts) => {
    requestUrl = url;
    return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
  });

  const result = await invokeRpc(mod, METHOD_LIST_DECISIONS, { scope: 'ip', type: 'ban' }, { bindings: { endpoint: 'http://localhost:18080', apiKey: 'test-key' } });
  assert.ok(requestUrl.includes('scope=ip'));
  assert.ok(requestUrl.includes('type=ban'));

  restoreFetch(saved);
});

// ── BlockIP ─────────────────────────────────────────────────────

test('BlockIP — creates manual decision', async () => {
  const mod = await importModule();
  const saved = global.fetch;
  let postedBody = null;

  mockFetch(async (url, opts) => {
    if (url.includes('/v1/watchers/login')) {
      return new Response(JSON.stringify({ code: 200, token: 'jwt-ok', expire: new Date(Date.now() + 3600000).toISOString() }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/v1/alerts') && opts?.method === 'POST') {
      postedBody = JSON.parse(opts.body);
      // Crowdsec POST /v1/alerts returns array of alert IDs, not full objects
      return new Response(JSON.stringify(['10']), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/v1/alerts/10') && opts?.method === 'GET') {
      // Second call to fetch full alert details
      return new Response(JSON.stringify({
        id: 10, uuid: 'block-uuid',
        machine_id: 'test-machine',
        created_at: '2026-06-27T12:00:00Z',
        scenario: 'manual', message: 'manual block via OctoBus',
        source: { scope: 'ip', value: '9.9.9.9', ip: '9.9.9.9' },
        events: [],
        decisions: [
          { id: 20, uuid: 'dec-uuid', origin: 'cscli', type: 'ban', scope: 'ip', value: '9.9.9.9', duration: '4h', scenario: 'manual', simulated: false },
        ],
        meta: [],
        events_count: 1, start_at: '', stop_at: '', capacity: 0, leakspeed: '', simulated: false, remediation: true, kind: 'manual', scenario_hash: '', scenario_version: '',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  });

  const result = await invokeRpc(mod, METHOD_BLOCK_IP, { target_ip: '9.9.9.9' }, { bindings: { endpoint: 'http://localhost:18080', machineId: 'test-machine', password: 'test-password' } });
  assert.equal(result.alert_id, 10);
  assert.equal(result.decision.type, 'ban');
  assert.equal(result.decision.value, '9.9.9.9');
  assert.ok(postedBody);
  assert.equal(postedBody[0].decisions[0].value, '9.9.9.9');
  assert.equal(postedBody[0].decisions[0].type, 'ban');

  restoreFetch(saved);
});

test('BlockIP — custom duration and reason', async () => {
  const mod = await importModule();
  const saved = global.fetch;
  let postedBody = null;

  mockFetch(async (url, opts) => {
    if (url.includes('/v1/watchers/login')) {
      return new Response(JSON.stringify({ code: 200, token: 'jwt-ok', expire: new Date(Date.now() + 3600000).toISOString() }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/v1/alerts') && opts?.method === 'POST') {
      postedBody = JSON.parse(opts.body);
      // Crowdsec POST /v1/alerts returns array of alert IDs
      return new Response(JSON.stringify(['11']), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/v1/alerts/11') && opts?.method === 'GET') {
      return new Response(JSON.stringify({
        id: 11, uuid: 'u',
        decisions: [
          { id: 21, origin: 'cscli', type: 'captcha', scope: 'ip', value: '8.8.8.8', duration: '24h', scenario: 'manual', simulated: false },
        ],
        source: {}, events: [], meta: [],
        events_count: 1, start_at: '', stop_at: '', capacity: 0, leakspeed: '', simulated: false, remediation: true, kind: 'manual', scenario_hash: '', scenario_version: '', machine_id: 'm', created_at: '', scenario: 'manual', message: '',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  });

  const result = await invokeRpc(mod, METHOD_BLOCK_IP, { target_ip: '8.8.8.8', duration: '24h', decision_type: 'captcha', reason: 'test block' }, { bindings: { endpoint: 'http://localhost:18080', machineId: 'test-machine', password: 'test-password' } });
  assert.equal(result.decision.type, 'captcha');
  assert.equal(postedBody[0].decisions[0].duration, '24h');
  assert.equal(postedBody[0].message, 'test block');

  restoreFetch(saved);
});

test('BlockIP — missing target_ip throws INVALID_ARGUMENT', async () => {
  const mod = await importModule();
  const saved = global.fetch;
  mockFetch(async () => new Response('ok', { status: 200 }));

  try {
    await invokeRpc(mod, METHOD_BLOCK_IP, {}, { bindings: { endpoint: 'http://localhost:18080' } });
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.code, 3); // INVALID_ARGUMENT
  }

  restoreFetch(saved);
});

// ── UnblockIP ───────────────────────────────────────────────────

test('UnblockIP — deletes matching decisions', async () => {
  const mod = await importModule();
  const saved = global.fetch;
  let requestUrl = '';

  mockFetch(async (url, opts) => {
    if (url.includes('/v1/watchers/login')) {
      return new Response(JSON.stringify({ code: 200, token: 'jwt-ok', expire: new Date(Date.now() + 3600000).toISOString() }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    requestUrl = url;
    return new Response(JSON.stringify({ nbDeleted: '2' }), { status: 200, headers: { 'content-type': 'application/json' } });
  });

  const result = await invokeRpc(mod, METHOD_UNBLOCK_IP, { target_ip: '1.2.3.4' }, { bindings: { endpoint: 'http://localhost:18080', machineId: 'test-machine', password: 'test-password' } });
  assert.equal(result.deleted_count, 2);
  assert.ok(requestUrl.includes('/v1/decisions'));
  assert.ok(requestUrl.includes('ip=1.2.3.4'), 'should use ip= shortcut for scope=ip');

  restoreFetch(saved);
});

test('UnblockIP — custom scope', async () => {
  const mod = await importModule();
  const saved = global.fetch;
  let requestUrl = '';

  mockFetch(async (url, opts) => {
    if (url.includes('/v1/watchers/login')) {
      return new Response(JSON.stringify({ code: 200, token: 'jwt-ok', expire: new Date(Date.now() + 3600000).toISOString() }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    requestUrl = url;
    return new Response(JSON.stringify({ nbDeleted: '1' }), { status: 200, headers: { 'content-type': 'application/json' } });
  });

  const result = await invokeRpc(mod, METHOD_UNBLOCK_IP, { target_ip: '10.0.0.0/24', scope: 'range' }, { bindings: { endpoint: 'http://localhost:18080', machineId: 'test-machine', password: 'test-password' } });
  assert.ok(requestUrl.includes('range=10.0.0.0%2F24'), 'should use range= shortcut for scope=range');

  restoreFetch(saved);
});

test('UnblockIP — missing target_ip throws INVALID_ARGUMENT', async () => {
  const mod = await importModule();
  const saved = global.fetch;
  mockFetch(async () => new Response('ok', { status: 200 }));

  try {
    await invokeRpc(mod, METHOD_UNBLOCK_IP, {}, { bindings: { endpoint: 'http://localhost:18080' } });
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.code, 3); // INVALID_ARGUMENT
  }

  restoreFetch(saved);
});

// ── DeleteDecision ──────────────────────────────────────────────

test('DeleteDecision — deletes by ID', async () => {
  const mod = await importModule();
  const saved = global.fetch;
  let requestUrl = '';

  mockFetch(async (url, opts) => {
    if (url.includes('/v1/watchers/login')) {
      return new Response(JSON.stringify({ code: 200, token: 'jwt-ok', expire: new Date(Date.now() + 3600000).toISOString() }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    requestUrl = url;
    return new Response(JSON.stringify({ nbDeleted: '1' }), { status: 200, headers: { 'content-type': 'application/json' } });
  });

  const result = await invokeRpc(mod, METHOD_DELETE_DECISION, { decision_id: 42 }, { bindings: { endpoint: 'http://localhost:18080', machineId: 'test-machine', password: 'test-password' } });
  assert.equal(result.deleted_count, 1);
  assert.ok(requestUrl.includes('/v1/decisions/42'));

  restoreFetch(saved);
});

test('DeleteDecision — missing decision_id throws INVALID_ARGUMENT', async () => {
  const mod = await importModule();
  const saved = global.fetch;
  mockFetch(async () => new Response('ok', { status: 200 }));

  try {
    await invokeRpc(mod, METHOD_DELETE_DECISION, {}, { bindings: { endpoint: 'http://localhost:18080' } });
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.code, 3); // INVALID_ARGUMENT
  }

  restoreFetch(saved);
});

// ── Error mapping ───────────────────────────────────────────────

test('5xx maps to UNAVAILABLE', async () => {
  const mod = await importModule();
  const saved = global.fetch;

  mockFetch(async (url) => {
    if (url.includes('/v1/watchers/login')) {
      return new Response(JSON.stringify({ code: 200, token: 'jwt-ok', expire: new Date(Date.now() + 3600000).toISOString() }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ message: 'internal error' }), { status: 500, headers: { 'content-type': 'application/json' } });
  });

  try {
    await invokeRpc(mod, METHOD_LIST_ALERTS, {}, { bindings: { endpoint: 'http://localhost:18080', machineId: 'test-machine', password: 'test-password' } });
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.code, 14); // UNAVAILABLE
  }

  restoreFetch(saved);
});

test('400 maps to INVALID_ARGUMENT', async () => {
  const mod = await importModule();
  const saved = global.fetch;

  mockFetch(async (url) => {
    if (url.includes('/v1/watchers/login')) {
      return new Response(JSON.stringify({ code: 200, token: 'jwt-ok', expire: new Date(Date.now() + 3600000).toISOString() }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ message: 'bad parameter' }), { status: 400, headers: { 'content-type': 'application/json' } });
  });

  try {
    await invokeRpc(mod, METHOD_LIST_ALERTS, {}, { bindings: { endpoint: 'http://localhost:18080', machineId: 'test-machine', password: 'test-password' } });
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.code, 3); // INVALID_ARGUMENT
  }

  restoreFetch(saved);
});

// ── Config validation ────────────────────────────────────────────

test('missing endpoint throws INVALID_ARGUMENT', async () => {
  const mod = await importModule();
  const saved = global.fetch;
  mockFetch(async () => new Response('ok', { status: 200 }));

  try {
    await invokeRpc(mod, METHOD_LIST_ALERTS, {}, { bindings: {} });
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.code, 3); // INVALID_ARGUMENT
  }

  restoreFetch(saved);
});

test('endpoint trailing slash is trimmed', async () => {
  const mod = await importModule();
  const saved = global.fetch;
  let requestUrl = '';

  mockFetch(async (url, opts) => {
    if (url.includes('/v1/watchers/login')) {
      return new Response(JSON.stringify({ code: 200, token: 'jwt-ok', expire: new Date(Date.now() + 3600000).toISOString() }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    requestUrl = url;
    return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
  });

  await invokeRpc(mod, METHOD_LIST_ALERTS, {}, { bindings: { endpoint: 'http://localhost:18080/', machineId: 'test-machine', password: 'test-password' } });
  assert.ok(!requestUrl.includes('18080//'));

  restoreFetch(saved);
});

// ── wrapLegacyHandler / SDK handler pattern ──────────────────────

test('handlers export maps full RPC paths to functions', async () => {
  const mod = await importModule();
  assert.ok(mod.handlers[mod.METHOD_LIST_ALERTS_FULL]);
  assert.ok(mod.handlers[mod.METHOD_GET_ALERT_FULL]);
  assert.ok(mod.handlers[mod.METHOD_LIST_DECISIONS_FULL]);
  assert.ok(mod.handlers[mod.METHOD_BLOCK_IP_FULL]);
  assert.ok(mod.handlers[mod.METHOD_UNBLOCK_IP_FULL]);
  assert.ok(mod.handlers[mod.METHOD_DELETE_DECISION_FULL]);
});

test('resolveCallContext handles single-arg (SDK) and two-arg (legacy) patterns', async () => {
  const mod = await importModule();
  // Single arg pattern (SDK): ctx contains { request, config, secret, method, ... }
  const singleArgResult = mod._test.resolveCallContext({}, { request: { limit: 5 }, config: { endpoint: 'http://x' } });
  assert.equal(singleArgResult.req.limit, 5);

  // Two-arg pattern (legacy): (req, ctx)
  const twoArgResult = mod._test.resolveCallContext({}, { limit: 5 }, { config: { endpoint: 'http://y' } });
  assert.equal(twoArgResult.req.limit, 5);
});

test('requestWithDefaults merges bindings with request overrides', async () => {
  const mod = await importModule();
  const bindings = { machineId: 'default-machine', password: 'default-pass', apiKey: 'default-key' };

  // Request overrides binding defaults
  const merged = mod._test.requestWithDefaults(bindings, { machine_id: 'override-machine' });
  assert.equal(merged.machine_id, 'override-machine');
  assert.equal(merged.password, 'default-pass');

  // No request override — uses bindings
  const defaultsOnly = mod._test.requestWithDefaults(bindings, {});
  assert.equal(defaultsOnly.machine_id, 'default-machine');
});

test('camelCase filters and false values are preserved', async () => {
  const mod = await importModule();
  mod._test.clearJwtCache();
  const saved = global.fetch;
  let requestUrl = '';
  mockFetch(async (url) => {
    if (url.includes('/v1/watchers/login')) return new Response(JSON.stringify({ token: 'jwt' }), { status: 200 });
    requestUrl = url;
    return new Response('[]', { status: 200 });
  });
  await invokeRpc(mod, METHOD_LIST_ALERTS, { hasActiveDecision: false, decisionType: 'ban' }, { bindings: { endpoint: 'http://localhost:18080', machineId: 'm', password: 'p' } });
  assert.match(requestUrl, /has_active_decision=false/);
  assert.match(requestUrl, /decision_type=ban/);
  await invokeRpc(mod, METHOD_LIST_DECISIONS, { scenariosContaining: 'ssh', scenariosNotContaining: 'http' }, { bindings: { endpoint: 'http://localhost:18080', apiKey: 'key' } });
  assert.match(requestUrl, /scenarios_containing=ssh/);
  assert.match(requestUrl, /scenarios_not_containing=http/);
  restoreFetch(saved);
});

test('rejects unsafe endpoint forms and clamps timeout', async () => {
  const mod = await importModule();
  for (const endpoint of ['file:///tmp/socket', 'https://user:pass@example.test', 'not a url']) {
    assert.throws(() => mod._test.getEndpoint({ endpoint }), { code: 3 });
  }
  assert.equal(mod._test.getTimeout({ limits: { timeoutMs: 999999 } }), 120000);
  assert.equal(mod._test.getTimeout({ limits: { timeoutMs: -1 } }), 5000);
  assert.equal(mod._test.getTimeout({ bindings: { timeoutMs: 1234 } }), 1234);
});

test('TLS override only creates a dispatcher for HTTPS', async () => {
  const mod = await importModule();
  assert.deepEqual(mod._test.buildTlsOptions(false, 'https://example.test'), {});
  assert.deepEqual(mod._test.buildTlsOptions(true, 'http://example.test'), {});
  assert.ok(mod._test.buildTlsOptions(true, 'https://example.test').dispatcher);
});

test('response reader rejects oversized, invalid JSON and accepts empty bodies', async () => {
  const mod = await importModule();
  await assert.rejects(() => mod._test.readResponse(new Response('', { headers: { 'content-length': String(11 * 1024 * 1024) } })), { code: 8 });
  await assert.rejects(() => mod._test.readResponse(new Response('not-json')), { code: 14 });
  assert.equal(await mod._test.readResponse(new Response('  ')), null);
  assert.deepEqual(await mod._test.readResponse(new Response('{"ok":true}')), { ok: true });
});

test('network failures, timeouts and missing login tokens are sanitized', async () => {
  const mod = await importModule();
  const saved = global.fetch;
  mod._test.clearJwtCache();
  mockFetch(async () => { throw new Error('secret=https://user:pass@example.test'); });
  await assert.rejects(() => invokeRpc(mod, METHOD_LIST_ALERTS, {}, { bindings: { endpoint: 'http://localhost:18080', machineId: 'm1', password: 'p' } }), { code: 14 });

  mod._test.clearJwtCache();
  mockFetch(async () => new Response('{}', { status: 200 }));
  await assert.rejects(() => invokeRpc(mod, METHOD_LIST_ALERTS, {}, { bindings: { endpoint: 'http://localhost:18080', machineId: 'm2', password: 'p' } }), { code: 16 });

  mod._test.clearJwtCache();
  mockFetch((_url, opts) => new Promise((_resolve, reject) => opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))));
  await assert.rejects(() => invokeRpc(mod, METHOD_LIST_ALERTS, {}, { limits: { timeoutMs: 1 }, bindings: { endpoint: 'http://localhost:18080', machineId: 'm3', password: 'p' } }), { code: 4 });
  restoreFetch(saved);
});

test('BlockIP reports successful mutation even when follow-up read fails', async () => {
  const mod = await importModule();
  mod._test.clearJwtCache();
  const saved = global.fetch;
  mockFetch(async (url, opts) => {
    if (url.includes('/v1/watchers/login')) return new Response(JSON.stringify({ token: 'jwt' }), { status: 200 });
    if (opts.method === 'POST') return new Response('[42]', { status: 200 });
    return new Response('{"message":"temporary"}', { status: 503 });
  });
  const result = await invokeRpc(mod, METHOD_BLOCK_IP, { targetIp: '192.0.2.1' }, { bindings: { endpoint: 'http://localhost:18080', machineId: 'm', password: 'p' } });
  assert.deepEqual(result, { alert_id: 42, uuid: '', decision: {} });
  restoreFetch(saved);
});

test('BlockIP handles empty create response and UnblockIP range/other scopes', async () => {
  const mod = await importModule();
  mod._test.clearJwtCache();
  const saved = global.fetch;
  let urls = [];
  mockFetch(async (url, opts) => {
    if (url.includes('/v1/watchers/login')) return new Response(JSON.stringify({ token: 'jwt' }), { status: 200 });
    urls.push(url);
    if (opts.method === 'POST') return new Response('null', { status: 200 });
    return new Response('{"nbDeleted":"1"}', { status: 200 });
  });
  assert.equal((await invokeRpc(mod, METHOD_BLOCK_IP, { target_ip: '192.0.2.1' }, { bindings: { endpoint: 'http://localhost:18080', machineId: 'm', password: 'p' } })).alert_id, 0);
  await invokeRpc(mod, METHOD_UNBLOCK_IP, { target_ip: '192.0.2.0/24', scope: 'range' }, { bindings: { endpoint: 'http://localhost:18080', machineId: 'm', password: 'p' } });
  await invokeRpc(mod, METHOD_UNBLOCK_IP, { target_ip: 'example', scope: 'user' }, { bindings: { endpoint: 'http://localhost:18080', machineId: 'm', password: 'p' } });
  assert.ok(urls.some((url) => url.includes('range=192.0.2.0%2F24')));
  assert.ok(urls.some((url) => url.includes('scope=user') && url.includes('value=example')));
  restoreFetch(saved);
});

test('SDK handler uses the single-context ABI', async () => {
  const mod = await importModule();
  const saved = global.fetch;
  mockFetch(async () => new Response('[]', { status: 200 }));
  const result = await mod.handlers[mod.METHOD_LIST_DECISIONS_FULL]({ request: {}, bindings: { endpoint: 'http://localhost:18080', apiKey: 'key' } });
  assert.deepEqual(result, { decisions: [] });
  restoreFetch(saved);
});

test('HTTP status mapping covers authorization and generic client errors', async () => {
  const mod = await importModule();
  assert.equal(mod._test.mapHttpStatus(403, {}).code, 7);
  assert.equal(mod._test.mapHttpStatus(404, {}).code, 9);
  assert.equal(mod._test.mapHttpStatus(418, {}).code, 9);
  assert.equal(mod._test.mapHttpStatus(200, {}), null);
});

test('JWT cache reuses a valid token and refreshes an expired token', async () => {
  const mod = await importModule();
  const saved = global.fetch;
  mod._test.clearJwtCache();
  let calls = 0;
  const token = (exp) => `x.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.x`;
  mockFetch(async () => { calls++; return new Response(JSON.stringify({ token: token(Math.floor(Date.now() / 1000) + 3600) }), { status: 200 }); });
  const first = await mod._test.getJwtToken('http://localhost', 'cache-user', 'p', 1000, false);
  assert.equal(await mod._test.getJwtToken('http://localhost', 'cache-user', 'p', 1000, false), first);
  assert.equal(calls, 1);
  mod._test.clearJwtCache();
  mockFetch(async () => { calls++; return new Response(JSON.stringify({ token: token(1) }), { status: 200 }); });
  await mod._test.getJwtToken('http://localhost', 'expired-user', 'p', 1000, false);
  await mod._test.getJwtToken('http://localhost', 'expired-user', 'p', 1000, false);
  assert.equal(calls, 3);
  restoreFetch(saved);
});

test('direct request helper covers auth validation, redirects and API timeouts', async () => {
  const mod = await importModule();
  const args = { bindings: {}, timeout: 5, skipTls: false };
  await assert.rejects(() => mod._test.crowdsecFetch('http://localhost', '/x', { ...args, authType: 'apiKey', req: {} }), { code: 3 });
  const saved = global.fetch;
  mockFetch(async () => new Response('', { status: 302 }));
  await assert.rejects(() => mod._test.crowdsecFetch('http://localhost', '/x', { ...args, authType: 'apiKey', req: { api_key: 'k' } }), { code: 2 });
  mockFetch((_url, opts) => new Promise((_resolve, reject) => {
    opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));
  await assert.rejects(() => mod._test.crowdsecFetch('http://localhost', '/x', { ...args, authType: 'apiKey', req: { api_key: 'k' } }), { code: 4 });
  mockFetch(async () => { throw new Error('credential=hidden'); });
  const error = await mod._test.crowdsecFetch('http://localhost', '/x', { ...args, authType: 'apiKey', req: { api_key: 'k' } }).catch((err) => err);
  assert.equal(error.code, 14);
  assert.doesNotMatch(error.message, /credential=hidden/);
  restoreFetch(saved);
});

test('response mappers tolerate sparse upstream objects', async () => {
  const mod = await importModule();
  assert.deepEqual(mod._test.mapAlert(null), {});
  const alert = mod._test.mapAlert({ events: [null, {}], decisions: [null, {}], meta: [{}], source: {} });
  assert.equal(alert.id, 0);
  assert.equal(alert.events.length, 2);
  assert.equal(alert.decisions.length, 2);
  assert.equal(alert.source.latitude, 0);
  assert.equal(mod._test.mapDecision({ simulated: true }).simulated, true);
});

test('a rejected cached JWT is invalidated and retried once', async () => {
  const mod = await importModule();
  const saved = global.fetch;
  mod._test.clearJwtCache();
  let logins = 0;
  let calls = 0;
  mockFetch(async (url) => {
    if (url.includes('/v1/watchers/login')) {
      logins++;
      return new Response(JSON.stringify({ token: `token-${logins}` }), { status: 200 });
    }
    calls++;
    if (calls === 1) return new Response('{"message":"revoked"}', { status: 401 });
    return new Response('[]', { status: 200 });
  });
  const result = await invokeRpc(mod, METHOD_LIST_ALERTS, {}, { bindings: { endpoint: 'http://localhost:18080', machineId: 'rotate-user', password: 'p' } });
  assert.deepEqual(result, { alerts: [] });
  assert.equal(logins, 2);
  assert.equal(calls, 2);
  restoreFetch(saved);
});

test('timeout remains active while the response body is being read', async () => {
  const mod = await importModule();
  const saved = global.fetch;
  mockFetch(async (_url, opts) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{'));
      opts.signal.addEventListener('abort', () => controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    },
  }), { status: 200 }));
  await assert.rejects(() => mod._test.crowdsecFetch('http://localhost', '/slow', { authType: 'apiKey', req: { api_key: 'k' }, bindings: {}, timeout: 1, skipTls: false }), { code: 4 });
  restoreFetch(saved);
});
