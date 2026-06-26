import test from 'node:test';
import assert from 'node:assert/strict';

const addPath = '/TopSec_WAF.TopSec_WAF/AddBlacklistIP';
const deletePath = '/TopSec_WAF.TopSec_WAF/DeleteBlacklistIP';
const listPath = '/TopSec_WAF.TopSec_WAF/ListBlacklistIPs';
const urlAddPath = '/TopSec_WAF.TopSec_WAF/AddUrlBlock';
const urlDeletePath = '/TopSec_WAF.TopSec_WAF/DeleteUrlBlock';
const urlListPath = '/TopSec_WAF.TopSec_WAF/ListUrlBlocks';
const urlStatusPath = '/TopSec_WAF.TopSec_WAF/SetUrlBlockStatus';

const buildCtx = (req = {}, overrides = {}) => ({
  config: { host: 'http://localhost:28080', skipTlsVerify: false, ...overrides.config },
  secret: { username: 'admin', password: 'test123', ...overrides.secret },
  bindings: { ...overrides.bindings },
  request: req,
});

let fetchImpl;
const setFetch = (impl) => { global.fetch = impl; };

const mockFetch = (impl) => {
  setFetch(async (...args) => impl(...args));
};

// shared mock helpers
function mockMiksResponse() {
  return new Response(Buffer.from('0123456789abcdef').toString('base64'), {
    status: 200,
    headers: { 'set-cookie': 'PHPSESSID=abc123def456; Path=/' },
  });
}

function mockLoginSuccess() {
  return new Response('ok?tok-xyz789', { status: 200 });
}

function mockWafSuccess(result = 'ok', info = 'done') {
  return new Response(JSON.stringify({ result, info }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function mockWafRows(rows = [], total = 0) {
  return new Response(JSON.stringify({ rows, total: String(total || rows.length) }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

// ── helper tests ──────────────────────────────────────────────────

test('internal helpers', async (t) => {
  const { _test } = await import('../src/topsec-waf-v3-2294-20238.js');

  await t.test('grpcCodeFor maps known codes', () => {
    assert.equal(_test.grpcCodeFor('INVALID_ARGUMENT'), 3);
    assert.equal(_test.grpcCodeFor('PERMISSION_DENIED'), 7);
    assert.equal(_test.grpcCodeFor('UNAVAILABLE'), 14);
    assert.equal(_test.grpcCodeFor('FAILED_PRECONDITION'), 9);
    assert.equal(_test.grpcCodeFor('DEADLINE_EXCEEDED'), 4);
    assert.equal(_test.grpcCodeFor('UNAUTHENTICATED'), 16);
    assert.equal(_test.grpcCodeFor('UNKNOWN_XYZ'), 2); // defaults to UNKNOWN
  });

  await t.test('grpcErr creates GrpcError with legacyCode', () => {
    const err = _test.grpcErr('INVALID_ARGUMENT', 'bad input');
    assert.equal(err.legacyCode, 'INVALID_ARGUMENT');
    assert.ok(err.message.includes('bad input'));
  });

  await t.test('first returns first defined value', () => {
    assert.equal(_test.first(undefined, null, 'a', 'b'), 'a');
    assert.equal(_test.first(undefined, null), undefined);
    assert.equal(_test.first(false, 0, ''), false);
  });

  await t.test('str converts values', () => {
    assert.equal(_test.str(null), '');
    assert.equal(_test.str(undefined), '');
    assert.equal(_test.str({ value: 'hello' }), 'hello');
    assert.equal(_test.str('hello'), 'hello');
    assert.equal(_test.str(42), '42');
  });

  await t.test('toNum returns fallback for invalid values', () => {
    assert.equal(_test.toNum(undefined, 10), 10);
    assert.equal(_test.toNum(null, 10), 10);
    assert.equal(_test.toNum(0, 20), 20);
    assert.equal(_test.toNum(-1, 20), 20);
    assert.equal(_test.toNum(5, 20), 5);
    assert.equal(_test.toNum('3', 20), 3);
  });

  await t.test('readConfig requires host, username, password', () => {
    assert.throws(() => _test.readConfig({}), /host required/);
    assert.throws(() => _test.readConfig({ config: { host: 'http://x' }, secret: {} }), /username required/);
    assert.throws(() => _test.readConfig({ config: { host: 'http://x' }, secret: { username: 'u' } }), /password required/);
  });

  await t.test('readConfig reads timeoutMs and skipTlsVerify', () => {
    const cfg = _test.readConfig({
      config: { host: 'http://x', timeoutMs: 3000 },
      secret: { username: 'u', password: 'p' },
      bindings: { skipTlsVerify: true },
    });
    assert.equal(cfg.timeoutMs, 3000);
    assert.equal(cfg.skipTlsVerify, true);
  });

  await t.test('buildCondition produces base64', () => {
    const b64 = _test.buildCondition('/admin/login.php', 'contains');
    assert.ok(typeof b64 === 'string');
    assert.ok(b64.length > 0);
  });
});

// ── IP Blacklist handler tests ────────────────────────────────────

test('AddBlacklistIP', async (t) => {
  await t.test('adds IP to blacklist group', async () => {
    let callCount = 0;
    mockFetch(async (url, init) => {
      callCount++;
      if (url.endsWith('/api/v1/get_miks')) return mockMiksResponse();
      if (url.endsWith('/api/v1/login')) return mockLoginSuccess();
      if (url.endsWith('/api/v1/ip_group_add')) return mockWafSuccess('ok', 'added');
      return new Response('{}', { status: 200 });
    });

    const { rpcdef } = await import('../src/topsec-waf-v3-2294-20238.js');
    const handler = rpcdef(buildCtx({ name: 'blacklist', ip_addresses: ['19.1.1.1'] }))[addPath];
    const result = await handler();

    assert.equal(result.result, 'ok');
    assert.equal(result.info, 'added');
    assert.ok(callCount >= 3); // get_miks + login + ip_group_add
  });

  await t.test('rejects missing name', async () => {
    const { rpcdef } = await import('../src/topsec-waf-v3-2294-20238.js');
    const handler = rpcdef(buildCtx({ ip_addresses: ['1.2.3.4'] }))[addPath];
    await assert.rejects(handler, /name required/);
  });

  await t.test('rejects empty ip_addresses', async () => {
    const { rpcdef } = await import('../src/topsec-waf-v3-2294-20238.js');
    const handler = rpcdef(buildCtx({ name: 'test', ip_addresses: [] }))[addPath];
    await assert.rejects(handler, /ip_addresses required/);
  });
});

test('DeleteBlacklistIP', async (t) => {
  await t.test('deletes blacklist group', async () => {
    mockFetch(async (url) => {
      if (url.endsWith('/api/v1/get_miks')) return mockMiksResponse();
      if (url.endsWith('/api/v1/login')) return mockLoginSuccess();
      if (url.endsWith('/api/v1/ip_group_delete')) return mockWafSuccess('ok', 'deleted');
      return new Response('{}', { status: 200 });
    });

    const { rpcdef } = await import('../src/topsec-waf-v3-2294-20238.js');
    const handler = rpcdef(buildCtx({ name: 'blacklist' }))[deletePath];
    const result = await handler();

    assert.equal(result.result, 'ok');
  });

  await t.test('rejects missing name', async () => {
    const { rpcdef } = await import('../src/topsec-waf-v3-2294-20238.js');
    const handler = rpcdef(buildCtx({}))[deletePath];
    await assert.rejects(handler, /name required/);
  });
});

test('ListBlacklistIPs', async (t) => {
  await t.test('lists all IP groups', async () => {
    mockFetch(async (url) => {
      if (url.endsWith('/api/v1/get_miks')) return mockMiksResponse();
      if (url.endsWith('/api/v1/login')) return mockLoginSuccess();
      if (url.endsWith('/api/v1/ip_group_show')) {
        return mockWafRows([
          { name: 'group1', group_value: '1.1.1.1,black', ip_group_members: '1.1.1.1,black', m_type: 'black' },
        ], 1);
      }
      return new Response('{}', { status: 200 });
    });

    const { rpcdef } = await import('../src/topsec-waf-v3-2294-20238.js');
    const handler = rpcdef(buildCtx({}))[listPath];
    const result = await handler();

    assert.equal(result.total, '1');
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].name, 'group1');
  });

  await t.test('passes pagination params', async () => {
    let lastBody = null;
    mockFetch(async (url, init) => {
      if (url.endsWith('/api/v1/get_miks')) return mockMiksResponse();
      if (url.endsWith('/api/v1/login')) return mockLoginSuccess();
      if (url.endsWith('/api/v1/ip_group_show')) {
        lastBody = init.body;
        return mockWafRows([], 0);
      }
      return new Response('{}', { status: 200 });
    });

    const { rpcdef } = await import('../src/topsec-waf-v3-2294-20238.js');
    const handler = rpcdef(buildCtx({ page: 2, rows: 10 }))[listPath];
    await handler();

    const parsed = JSON.parse(lastBody);
    assert.ok(parsed.commands[0].waf_ip_group_show, 'has ip show command');
    // page/rows are at top level alongside commands, not inside command
    assert.equal(parsed.page, 2);
    assert.equal(parsed.rows, 10);
  });
});

// ── URL Block handler tests ───────────────────────────────────────

test('AddUrlBlock', async (t) => {
  await t.test('adds URL block rule', async () => {
    mockFetch(async (url) => {
      if (url.endsWith('/api/v1/get_miks')) return mockMiksResponse();
      if (url.endsWith('/api/v1/login')) return mockLoginSuccess();
      if (url.endsWith('/api/v1/user_policy_add')) return mockWafSuccess('ok', 'rule added');
      return new Response('{}', { status: 200 });
    });

    const { rpcdef } = await import('../src/topsec-waf-v3-2294-20238.js');
    const handler = rpcdef(buildCtx({
      security_policy: 'test-acl-policy',
      name: 'block-admin',
      url: '/admin/login.php',
    }))[urlAddPath];
    const result = await handler();

    assert.equal(result.result, 'ok');
    assert.equal(result.info, 'rule added');
  });

  await t.test('rejects missing security_policy', async () => {
    const { rpcdef } = await import('../src/topsec-waf-v3-2294-20238.js');
    const handler = rpcdef(buildCtx({ name: 'x', url: '/path' }))[urlAddPath];
    await assert.rejects(handler, /security_policy required/);
  });

  await t.test('rejects missing url', async () => {
    const { rpcdef } = await import('../src/topsec-waf-v3-2294-20238.js');
    const handler = rpcdef(buildCtx({ security_policy: 'p', name: 'x' }))[urlAddPath];
    await assert.rejects(handler, /url required/);
  });

  await t.test('defaults action to deny when unrecognized', async () => {
    mockFetch(async (url) => {
      if (url.endsWith('/api/v1/get_miks')) return mockMiksResponse();
      if (url.endsWith('/api/v1/login')) return mockLoginSuccess();
      if (url.endsWith('/api/v1/user_policy_add')) return mockWafSuccess('ok', 'added');
      return new Response('{}', { status: 200 });
    });

    const { rpcdef } = await import('../src/topsec-waf-v3-2294-20238.js');
    const handler = rpcdef(buildCtx({
      security_policy: 'test-policy',
      name: 'block-x',
      url: '/test',
      action: 'invalid-action',
    }))[urlAddPath];
    const result = await handler();
    assert.equal(result.result, 'ok');
  });

  await t.test('rejects redirect without action_data', async () => {
    const { rpcdef } = await import('../src/topsec-waf-v3-2294-20238.js');
    const handler = rpcdef(buildCtx({
      security_policy: 'p',
      name: 'x',
      url: '/test',
      action: 'temp-redirect',
    }))[urlAddPath];
    await assert.rejects(handler, /action_data required/);
  });

  await t.test('rejects perm-redirect without action_data', async () => {
    const { rpcdef } = await import('../src/topsec-waf-v3-2294-20238.js');
    const handler = rpcdef(buildCtx({
      security_policy: 'p',
      name: 'x',
      url: '/test',
      action: 'perm-redirect',
    }))[urlAddPath];
    await assert.rejects(handler, /action_data required/);
  });
});

test('DeleteUrlBlock', async (t) => {
  await t.test('deletes URL block rule', async () => {
    mockFetch(async (url) => {
      if (url.endsWith('/api/v1/get_miks')) return mockMiksResponse();
      if (url.endsWith('/api/v1/login')) return mockLoginSuccess();
      if (url.endsWith('/api/v1/user_policy_delete')) return mockWafSuccess('ok', 'deleted');
      return new Response('{}', { status: 200 });
    });

    const { rpcdef } = await import('../src/topsec-waf-v3-2294-20238.js');
    const handler = rpcdef(buildCtx({
      security_policy: 'test-acl-policy',
      name: 'block-login',
    }))[urlDeletePath];
    const result = await handler();

    assert.equal(result.result, 'ok');
  });
});

test('ListUrlBlocks', async (t) => {
  await t.test('lists URL block rules', async () => {
    mockFetch(async (url) => {
      if (url.endsWith('/api/v1/get_miks')) return mockMiksResponse();
      if (url.endsWith('/api/v1/login')) return mockLoginSuccess();
      if (url.endsWith('/api/v1/user_policy_show')) {
        return mockWafRows([
          { id: '1', name: 'block-admin', action: 'deny', enable: 'on', phase: 'request_header', log_message: 'block: /admin', conditions: '...' },
        ], 1);
      }
      return new Response('{}', { status: 200 });
    });

    const { rpcdef } = await import('../src/topsec-waf-v3-2294-20238.js');
    const handler = rpcdef(buildCtx({
      security_policy: 'test-acl-policy',
    }))[urlListPath];
    const result = await handler();

    assert.equal(result.total, '1');
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].name, 'block-admin');
    assert.equal(result.rows[0].action, 'deny');
  });
});

test('SetUrlBlockStatus', async (t) => {
  await t.test('enables a URL block rule', async () => {
    mockFetch(async (url) => {
      if (url.endsWith('/api/v1/get_miks')) return mockMiksResponse();
      if (url.endsWith('/api/v1/login')) return mockLoginSuccess();
      if (url.endsWith('/api/v1/user_policy_modify')) return mockWafSuccess('ok', 'modified');
      return new Response('{}', { status: 200 });
    });

    const { rpcdef } = await import('../src/topsec-waf-v3-2294-20238.js');
    const handler = rpcdef(buildCtx({
      security_policy: 'test-acl-policy',
      name: 'block-admin',
      enable: 'off',
    }))[urlStatusPath];
    const result = await handler();

    assert.equal(result.result, 'ok');
  });

  await t.test('rejects missing security_policy', async () => {
    const { rpcdef } = await import('../src/topsec-waf-v3-2294-20238.js');
    const handler = rpcdef(buildCtx({ name: 'x' }))[urlStatusPath];
    await assert.rejects(handler, /security_policy required/);
  });
});

// ── session retry on 401 ──────────────────────────────────────────

test('session retry: WAF 401 triggers re-login and retry', async () => {
  const { _test } = await import('../src/topsec-waf-v3-2294-20238.js');
  _test.resetSession();

  let loginCount = 0;
  mockFetch(async (url) => {
    if (url.endsWith('/api/v1/get_miks')) return mockMiksResponse();
    if (url.endsWith('/api/v1/login')) {
      loginCount++;
      return mockLoginSuccess();
    }
    if (url.endsWith('/api/v1/ip_group_show')) {
      // First call: 401 (session expired)
      // Second call (after re-login): success
      if (loginCount < 2) {
        return new Response(JSON.stringify({ result: 'failed' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }
      return mockWafRows([{ name: 'ok', group_value: '', ip_group_members: '', m_type: '' }]);
    }
    return new Response('{}', { status: 200 });
  });

  const { rpcdef } = await import('../src/topsec-waf-v3-2294-20238.js');
  const handler = rpcdef(buildCtx({}))[listPath];
  const result = await handler();

  assert.equal(loginCount, 2, 'login called twice (initial + retry)');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].name, 'ok');
  _test.resetSession();
});

// ── error handling tests ──────────────────────────────────────────

test('error: WAF auth expired returns PERMISSION_DENIED', async () => {
  const { _test } = await import('../src/topsec-waf-v3-2294-20238.js');
  _test.resetSession();

  // Both calls return 401 → retry exhausted, throws PERMISSION_DENIED
  mockFetch(async (url) => {
    if (url.endsWith('/api/v1/get_miks')) return mockMiksResponse();
    if (url.endsWith('/api/v1/login')) return mockLoginSuccess();
    if (url.endsWith('/api/v1/ip_group_show')) {
      return new Response(JSON.stringify({ result: 'failed', info: 'auth required' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200 });
  });

  const { rpcdef } = await import('../src/topsec-waf-v3-2294-20238.js');
  const handler = rpcdef(buildCtx({}))[listPath];
  await assert.rejects(handler, /PERMISSION_DENIED/);
  _test.resetSession();
});

test('error: WAF 500 returns UNAVAILABLE', async () => {
  mockFetch(async (url) => {
    if (url.endsWith('/api/v1/get_miks')) return mockMiksResponse();
    if (url.endsWith('/api/v1/login')) return mockLoginSuccess();
    if (url.endsWith('/api/v1/ip_group_show')) {
      return new Response('Internal Server Error', { status: 500 });
    }
    return new Response('{}', { status: 200 });
  });

  const { rpcdef } = await import('../src/topsec-waf-v3-2294-20238.js');
  const handler = rpcdef(buildCtx({}))[listPath];
  await assert.rejects(handler, /UNAVAILABLE/);
});

test('error: non-JSON WAF response returns UNKNOWN', async () => {
  mockFetch(async (url) => {
    if (url.endsWith('/api/v1/get_miks')) return mockMiksResponse();
    if (url.endsWith('/api/v1/login')) return mockLoginSuccess();
    if (url.endsWith('/api/v1/ip_group_show')) {
      return new Response('<html>error</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    return new Response('{}', { status: 200 });
  });

  const { rpcdef } = await import('../src/topsec-waf-v3-2294-20238.js');
  const handler = rpcdef(buildCtx({}))[listPath];
  await assert.rejects(handler, /UNKNOWN/);
});

test('error: WAF command failed returns FAILED_PRECONDITION', async () => {
  mockFetch(async (url) => {
    if (url.endsWith('/api/v1/get_miks')) return mockMiksResponse();
    if (url.endsWith('/api/v1/login')) return mockLoginSuccess();
    if (url.endsWith('/api/v1/ip_group_delete')) {
      return new Response(JSON.stringify({ result: 'failed', info: 'group not found' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200 });
  });

  const { rpcdef } = await import('../src/topsec-waf-v3-2294-20238.js');
  const handler = rpcdef(buildCtx({ name: 'nonexistent' }))[deletePath];
  await assert.rejects(handler, /FAILED_PRECONDITION/);
});

test('error: login 401 returns UNAUTHENTICATED', async () => {
  const { _test } = await import('../src/topsec-waf-v3-2294-20238.js');
  _test.resetSession();

  mockFetch(async (url) => {
    if (url.endsWith('/api/v1/get_miks')) return mockMiksResponse();
    if (url.endsWith('/api/v1/login')) {
      return new Response('Incorrect username or password', { status: 401 });
    }
    return new Response('{}', { status: 200 });
  });

  const { rpcdef } = await import('../src/topsec-waf-v3-2294-20238.js');
  const ctx = {
    config: { host: 'http://localhost:28080' },
    secret: { username: 'baduser', password: 'wrong' },
  };
  const handler = rpcdef(ctx)[listPath];
  await assert.rejects(handler, /UNAUTHENTICATED/);
  _test.resetSession();
});

test('error: login 403 returns PERMISSION_DENIED', async () => {
  const { _test } = await import('../src/topsec-waf-v3-2294-20238.js');
  _test.resetSession();

  mockFetch(async (url) => {
    if (url.endsWith('/api/v1/get_miks')) return mockMiksResponse();
    if (url.endsWith('/api/v1/login')) {
      return new Response('forbidden', { status: 403 });
    }
    return new Response('{}', { status: 200 });
  });

  const { rpcdef } = await import('../src/topsec-waf-v3-2294-20238.js');
  const ctx = {
    config: { host: 'http://localhost:28080' },
    secret: { username: 'locked', password: 'test' },
  };
  const handler = rpcdef(ctx)[listPath];
  await assert.rejects(handler, /PERMISSION_DENIED/);
  _test.resetSession();
});

test('error: fetch timeout returns DEADLINE_EXCEEDED', async () => {
  const { _test } = await import('../src/topsec-waf-v3-2294-20238.js');
  _test.resetSession();

  mockFetch(async (url) => {
    if (url.endsWith('/api/v1/get_miks')) {
      // Simulate timeout
      const err = new Error('The operation was aborted');
      err.name = 'TimeoutError';
      throw err;
    }
    return new Response('{}', { status: 200 });
  });

  const { rpcdef } = await import('../src/topsec-waf-v3-2294-20238.js');
  const ctx = {
    config: { host: 'http://localhost:28080', timeoutMs: 100 },
    secret: { username: 'admin', password: 'test123' },
  };
  const handler = rpcdef(ctx)[listPath];
  await assert.rejects(handler, /DEADLINE_EXCEEDED/);
  _test.resetSession();
});

// ── config/secret tests ───────────────────────────────────────────

test('config: invalid host rejects early', async () => {
  const { rpcdef } = await import('../src/topsec-waf-v3-2294-20238.js');
  const ctx = {
    config: { host: 'not-a-url' },
    secret: { username: 'u', password: 'p' },
    request: {},
  };
  const handler = rpcdef(ctx)[addPath];
  await assert.rejects(handler, /host required/);
});

test('config: missing password rejects early', async () => {
  const { rpcdef } = await import('../src/topsec-waf-v3-2294-20238.js');
  const ctx = {
    config: { host: 'http://x' },
    secret: { username: 'u' },
    request: { name: 'test', ip_addresses: ['1.1.1.1'] },
  };
  const handler = rpcdef(ctx)[addPath];
  await assert.rejects(handler, /password required/);
});
