/**
 * f5__awaf service package tests
 *
 * Two styles:
 *   1. Unit tests — mock globalThis.fetch directly, no network
 *   2. Integration tests — start mock_upstream.js HTTP server, use real fetch
 *
 * Run:  node --test test/
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { rpcdef, handlers, _test } from '../src/f5-awaf.js';
import { start, stop, state, reset } from './mock_upstream.js';

// ── test context builder ───────────────────────────────────────────────────────

const buildCtx = (req = {}, overrides = {}) => ({
  config: {
    host: '127.0.0.1',
    port: 18443,
    verify_ssl: false,
    default_policy_name: 'test_policy',
    ...overrides.config,
  },
  secret: { username: 'admin', password: 'admin', ...overrides.secret },
  bindings: { ...overrides.bindings },
  limits: { timeoutMs: 5000 },
  meta: { instance_id: 'test', request_id: 'req-1' },
  req,
});

// ── mock fetch helper ─────────────────────────────────────────────────────────

// Save original fetch once so restoreFetch always brings back the real one
const _nativeFetch = globalThis.fetch;
const mockFetch = (impl) => { globalThis.fetch = impl; };
const restoreFetch = () => { globalThis.fetch = _nativeFetch; };

const fakeFetchOk = (body, status = 200) =>
  async () => ({
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
    json: async () => body,
  });

const fakeFetchErr = (status, message = 'error') =>
  async () => ({
    status,
    ok: false,
    text: async () => JSON.stringify({ message }),
    json: async () => ({ message }),
  });

// ── _test.mergedBindings ───────────────────────────────────────────────────────

describe('mergedBindings', () => {
  it('merges config + secret + bindings in priority order', () => {
    const ctx = {
      config: { host: 'base.host', port: 443 },
      secret: { username: 'admin', password: 'pass' },
      bindings: { host: 'override.host' },
    };
    const b = _test.mergedBindings(ctx);
    assert.equal(b.host, 'override.host');   // bindings wins
    assert.equal(b.port, 443);               // config
    assert.equal(b.username, 'admin');       // secret
  });

  it('handles missing fields gracefully', () => {
    const b = _test.mergedBindings({});
    assert.equal(typeof b, 'object');
  });
});

// ── rpcdef validation ─────────────────────────────────────────────────────────

describe('rpcdef — config validation', () => {
  it('throws INVALID_ARGUMENT when host is missing', () => {
    assert.throws(
      () => rpcdef({ config: {}, secret: {}, bindings: {} }),
      (err) => err.code === 3, // INVALID_ARGUMENT = 3
    );
  });

  it('returns all four paths when config is valid', () => {
    const sdkHandlers = rpcdef(buildCtx());
    assert.ok(typeof sdkHandlers['/f5.awaf.v1.F5AWAF/Login'] === 'function');
    assert.ok(typeof sdkHandlers['/f5.awaf.v1.F5AWAF/BlockIP'] === 'function');
    assert.ok(typeof sdkHandlers['/f5.awaf.v1.F5AWAF/UnblockIP'] === 'function');
    assert.ok(typeof sdkHandlers['/f5.awaf.v1.F5AWAF/Logout'] === 'function');
  });
});

// ── handlers export ───────────────────────────────────────────────────────────

describe('handlers export', () => {
  it('exports all four method keys', () => {
    const keys = [
      'f5.awaf.v1.F5AWAF/Login',
      'f5.awaf.v1.F5AWAF/BlockIP',
      'f5.awaf.v1.F5AWAF/UnblockIP',
      'f5.awaf.v1.F5AWAF/Logout',
    ];
    for (const k of keys) {
      assert.equal(typeof handlers[k], 'function', `Missing handler: ${k}`);
    }
  });
});

// ── Login (unit, mock fetch) ───────────────────────────────────────────────────

describe('Login — unit (mock fetch)', () => {
  beforeEach(() => restoreFetch());
  after(() => restoreFetch());

  it('returns token on 200 response', async () => {
    mockFetch(fakeFetchOk({
      token: { token: 'TOK123', name: 'TOK123', timeout: 1200 },
    }));
    const ctx = buildCtx({});
    const res = await rpcdef(ctx)['/f5.awaf.v1.F5AWAF/Login']();
    assert.equal(res.token, 'TOK123');
    assert.equal(res.code, 0);
  });

  it('throws INVALID_ARGUMENT when username missing', async () => {
    await assert.rejects(
      () => rpcdef(buildCtx({}, { secret: { password: 'p' } }))['/f5.awaf.v1.F5AWAF/Login'](),
      (err) => err.code === 3,
    );
  });

  it('throws INVALID_ARGUMENT when password missing', async () => {
    await assert.rejects(
      () => rpcdef(buildCtx({}, { secret: { username: 'u' } }))['/f5.awaf.v1.F5AWAF/Login'](),
      (err) => err.code === 3,
    );
  });

  it('throws PERMISSION_DENIED on 401', async () => {
    mockFetch(fakeFetchErr(401, 'bad creds'));
    await assert.rejects(
      () => rpcdef(buildCtx())['/f5.awaf.v1.F5AWAF/Login'](),
      (err) => err.code === 7, // PERMISSION_DENIED
    );
  });

  it('throws UNAVAILABLE on 503', async () => {
    mockFetch(fakeFetchErr(503, 'service unavailable'));
    await assert.rejects(
      () => rpcdef(buildCtx())['/f5.awaf.v1.F5AWAF/Login'](),
      (err) => err.code === 14, // UNAVAILABLE
    );
  });

  it('throws UNAVAILABLE on network error', async () => {
    mockFetch(async () => { throw new Error('ECONNREFUSED'); });
    await assert.rejects(
      () => rpcdef(buildCtx())['/f5.awaf.v1.F5AWAF/Login'](),
      (err) => err.code === 14,
    );
  });
});

// ── BlockIP (unit, mock fetch) ────────────────────────────────────────────────

describe('BlockIP — unit (mock fetch)', () => {
  afterEach(() => restoreFetch());

  it('throws INVALID_ARGUMENT when token missing', async () => {
    await assert.rejects(
      () => rpcdef(buildCtx({ addresses: ['1.2.3.4'] }))['/f5.awaf.v1.F5AWAF/BlockIP'](),
      (err) => err.code === 3,
    );
  });

  it('throws INVALID_ARGUMENT when addresses empty', async () => {
    await assert.rejects(
      () => rpcdef(buildCtx({ token: 'tok', addresses: [] }))['/f5.awaf.v1.F5AWAF/BlockIP'](),
      (err) => err.code === 3,
    );
  });

  it('throws INVALID_ARGUMENT when no policy_name and no default', async () => {
    await assert.rejects(
      () => rpcdef(buildCtx({ token: 'tok', addresses: ['1.2.3.4'] }, {
        config: { host: '1.1.1.1' }, // no default_policy_name
      }))['/f5.awaf.v1.F5AWAF/BlockIP'](),
      (err) => err.code === 3,
    );
  });

  it('succeeds — new IP created', async () => {
    const calls = [];
    mockFetch(async (url, opts) => {
      calls.push({ url, method: opts?.method });
      if (url.includes('/mgmt/tm/asm/policies?')) {
        return { status: 200, text: async () => JSON.stringify({ items: [{ id: 'p1', name: 'test_policy' }] }) };
      }
      if (url.includes('/ip-exceptions') && opts?.method === 'GET') {
        return { status: 200, text: async () => JSON.stringify({ items: [] }) };
      }
      if (url.includes('/ip-exceptions') && opts?.method === 'POST') {
        return { status: 201, text: async () => JSON.stringify({ id: 'exc-1', ipAddress: '10.0.0.1', blockRequests: 'always' }) };
      }
      if (url.includes('/apply-policy')) {
        return { status: 200, text: async () => JSON.stringify({ id: 'task-1' }) };
      }
      return { status: 404, text: async () => '{}' };
    });

    const res = await rpcdef(buildCtx({
      token: 'tok', addresses: ['10.0.0.1'], policy_name: 'test_policy',
    }))['/f5.awaf.v1.F5AWAF/BlockIP']();

    assert.equal(res.code, 0);
    assert.deepEqual(res.blocked, ['10.0.0.1']);
    assert.deepEqual(res.failed, []);
  });

  it('succeeds — idempotent PATCH when IP already exists', async () => {
    mockFetch(async (url, opts) => {
      if (url.includes('/mgmt/tm/asm/policies?')) {
        return { status: 200, text: async () => JSON.stringify({ items: [{ id: 'p1', name: 'test_policy' }] }) };
      }
      if (url.includes('/ip-exceptions') && opts?.method === 'GET') {
        return { status: 200, text: async () => JSON.stringify({
          items: [{ id: 'exc-1', ipAddress: '10.0.0.1', blockRequests: 'always' }],
        }) };
      }
      if (url.includes('/ip-exceptions/exc-1') && opts?.method === 'PATCH') {
        return { status: 200, text: async () => JSON.stringify({ id: 'exc-1', blockRequests: 'always' }) };
      }
      if (url.includes('/apply-policy')) {
        return { status: 200, text: async () => JSON.stringify({ id: 'task-1' }) };
      }
      return { status: 404, text: async () => '{}' };
    });

    const res = await rpcdef(buildCtx({
      token: 'tok', addresses: ['10.0.0.1'], policy_name: 'test_policy',
    }))['/f5.awaf.v1.F5AWAF/BlockIP']();

    assert.equal(res.code, 0);
    assert.deepEqual(res.blocked, ['10.0.0.1']);
  });
});

// ── UnblockIP (unit) ──────────────────────────────────────────────────────────

describe('UnblockIP — unit (mock fetch)', () => {
  afterEach(() => restoreFetch());

  it('throws INVALID_ARGUMENT when token missing', async () => {
    await assert.rejects(
      () => rpcdef(buildCtx({ addresses: ['1.2.3.4'] }))['/f5.awaf.v1.F5AWAF/UnblockIP'](),
      (err) => err.code === 3,
    );
  });

  it('treats missing IP as already-unblocked (idempotent)', async () => {
    mockFetch(async (url, opts) => {
      if (url.includes('/mgmt/tm/asm/policies?')) {
        return { status: 200, text: async () => JSON.stringify({ items: [{ id: 'p1', name: 'test_policy' }] }) };
      }
      if (url.includes('/ip-exceptions') && opts?.method === 'GET') {
        return { status: 200, text: async () => JSON.stringify({ items: [] }) }; // empty — IP not blocked
      }
      if (url.includes('/apply-policy')) {
        return { status: 200, text: async () => '{}' };
      }
      return { status: 404, text: async () => '{}' };
    });

    const res = await rpcdef(buildCtx({
      token: 'tok', addresses: ['10.0.0.1'], policy_name: 'test_policy',
    }))['/f5.awaf.v1.F5AWAF/UnblockIP']();

    assert.equal(res.code, 0);
    assert.deepEqual(res.unblocked, ['10.0.0.1']); // idempotent success
  });
});

// ── Logout (unit) ─────────────────────────────────────────────────────────────

describe('Logout — unit (mock fetch)', () => {
  afterEach(() => restoreFetch());

  it('throws INVALID_ARGUMENT when token missing', async () => {
    await assert.rejects(
      () => rpcdef(buildCtx({}))['/f5.awaf.v1.F5AWAF/Logout'](),
      (err) => err.code === 3,
    );
  });

  it('succeeds on 200', async () => {
    mockFetch(fakeFetchOk({ message: 'Logged out' }));
    const res = await rpcdef(buildCtx({ token: 'tok' }))['/f5.awaf.v1.F5AWAF/Logout']();
    assert.equal(res.code, 0);
  });

  it('treats 404 (already expired) as success', async () => {
    mockFetch(fakeFetchErr(404, 'not found'));
    const res = await rpcdef(buildCtx({ token: 'tok' }))['/f5.awaf.v1.F5AWAF/Logout']();
    assert.equal(res.code, 0);
  });

  it('throws PERMISSION_DENIED on 403', async () => {
    mockFetch(fakeFetchErr(403, 'forbidden'));
    await assert.rejects(
      () => rpcdef(buildCtx({ token: 'tok' }))['/f5.awaf.v1.F5AWAF/Logout'](),
      (err) => err.code === 7,
    );
  });
});

// ── Integration tests (mock_upstream HTTP server) ─────────────────────────────

describe('Integration — full flow via mock_upstream', () => {
  let port;

  before(async () => {
    restoreFetch(); // ensure real fetch is used
    const srv = await start();
    port = srv.port;
  });

  after(() => stop());
  beforeEach(() => reset());

  /** Build ctx pointing at mock server (HTTP, not HTTPS) */
  const mkCtx = (req, overrides = {}) => ({
    config: {
      host: '127.0.0.1',
      port,
      verify_ssl: true,          // mock uses http://
      default_policy_name: 'test_policy',
      ...overrides.config,
    },
    secret: { username: 'admin', password: 'admin', ...overrides.secret },
    bindings: { ...overrides.bindings },
    limits: { timeoutMs: 5000 },
    meta: { instance_id: 'integration', request_id: 'req-int' },
    req,
  });

  /**
   * Override globalThis.fetch to strip https→http so the mock HTTP server is reachable.
   * Capture _nativeFetch BEFORE assignment to avoid circular reference.
   */
  const httpFetch = (url, opts) => _nativeFetch(url.replace('https://', 'http://'), opts);

  // Install httpFetch once for the whole integration describe block
  before(() => { globalThis.fetch = httpFetch; });
  after(() => restoreFetch());

  // Wrap rpcdef with integration context
  const testRpc = (req, overrides = {}) => rpcdef(mkCtx(req, overrides));

  it('Login — valid credentials returns token', async () => {
    const res = await testRpc({})['/f5.awaf.v1.F5AWAF/Login']();
    assert.equal(res.code, 0);
    assert.ok(res.token, 'token should be set');
    assert.equal(state.tokens.has(res.token), true, 'token should be active in mock');
  });

  it('Login — wrong password throws PERMISSION_DENIED', async () => {
    await assert.rejects(
      () => testRpc({}, { secret: { username: 'admin', password: 'wrong' } })['/f5.awaf.v1.F5AWAF/Login'](),
      (err) => err.code === 7,
    );
  });

  it('Login → BlockIP → Logout — full happy path', async () => {
    // 1. login
    const loginRes = await testRpc({})['/f5.awaf.v1.F5AWAF/Login']();
    const token = loginRes.token;

    // 2. block
    const blockRes = await testRpc({
      token, addresses: ['192.168.1.10', '192.168.1.11'], policy_name: 'test_policy',
    })['/f5.awaf.v1.F5AWAF/BlockIP']();
    assert.equal(blockRes.code, 0);
    assert.deepEqual(blockRes.blocked.sort(), ['192.168.1.10', '192.168.1.11'].sort());
    assert.equal(state.applyCallCount, 1);

    // 3. block again (idempotent)
    const blockRes2 = await testRpc({
      token, addresses: ['192.168.1.10'], policy_name: 'test_policy',
    })['/f5.awaf.v1.F5AWAF/BlockIP']();
    assert.equal(blockRes2.code, 0);
    assert.deepEqual(blockRes2.blocked, ['192.168.1.10']);

    // 4. unblock
    const unblockRes = await testRpc({
      token, addresses: ['192.168.1.10'], policy_name: 'test_policy',
    })['/f5.awaf.v1.F5AWAF/UnblockIP']();
    assert.equal(unblockRes.code, 0);
    assert.deepEqual(unblockRes.unblocked, ['192.168.1.10']);

    // 5. logout
    const logoutRes = await testRpc({ token })['/f5.awaf.v1.F5AWAF/Logout']();
    assert.equal(logoutRes.code, 0);
    assert.equal(state.tokens.has(token), false, 'token should be removed');
  });

  it('BlockIP — unknown policy returns NOT_FOUND', async () => {
    const loginRes = await testRpc({})['/f5.awaf.v1.F5AWAF/Login']();
    await assert.rejects(
      () => testRpc({
        token: loginRes.token, addresses: ['1.2.3.4'], policy_name: 'nonexistent_policy',
      })['/f5.awaf.v1.F5AWAF/BlockIP'](),
      (err) => err.code === 5, // NOT_FOUND
    );
  });

  it('UnblockIP — already unblocked is idempotent', async () => {
    const loginRes = await testRpc({})['/f5.awaf.v1.F5AWAF/Login']();
    const res = await testRpc({
      token: loginRes.token, addresses: ['10.99.99.99'], policy_name: 'test_policy',
    })['/f5.awaf.v1.F5AWAF/UnblockIP']();
    assert.equal(res.code, 0); // not blocked → unblock is no-op
  });

  it('Logout — already-expired token (404) returns success', async () => {
    const res = await testRpc({ token: 'expired-or-nonexistent' })['/f5.awaf.v1.F5AWAF/Logout']();
    assert.equal(res.code, 0);
  });
});
