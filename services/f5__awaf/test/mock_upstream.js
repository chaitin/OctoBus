/**
 * Mock F5 iControl REST upstream server for integration tests.
 *
 * Simulates the F5 AWAF endpoints used by f5__awaf service:
 *   POST   /mgmt/shared/authn/login
 *   DELETE /mgmt/shared/authz/tokens/:token
 *   GET    /mgmt/tm/asm/policies
 *   GET    /mgmt/tm/asm/policies/:id/whitelist-ips
 *   POST   /mgmt/tm/asm/policies/:id/whitelist-ips
 *   PATCH  /mgmt/tm/asm/policies/:id/whitelist-ips/:excId
 *   DELETE /mgmt/tm/asm/policies/:id/whitelist-ips/:excId
 *   POST   /mgmt/tm/asm/tasks/apply-policy
 *
 * Usage:
 *   const { start, stop, state, reset } = await import('./mock_upstream.js');
 *   const server = await start();      // returns { port }
 *   state.tokens.add('mytoken');       // pre-seed a valid token
 *   await stop();
 */

import { createServer } from 'node:http';

const DEFAULT_PORT = Number(process.env.MOCK_F5_PORT || 0); // 0 = random

// ── shared state (reset between tests) ────────────────────────────────────────

export const state = {
  // valid credentials
  validUsername: 'admin',
  validPassword: 'admin',
  // active tokens (Set of string)
  tokens: new Set(),
  // ASM policies: Map<id, { id, name, enforcementMode, active }>
  policies: new Map([['policy-001', { id: 'policy-001', name: 'test_policy', enforcementMode: 'blocking', active: true }]]),
  // IP exceptions per policy: Map<policyId, Map<excId, { id, ipAddress, blockRequests }>>
  exceptions: new Map([['policy-001', new Map()]]),
  // apply-policy call count
  applyCallCount: 0,
  // force error for testing: e.g. state.forceError = { path: '/mgmt/shared/authn/login', status: 500 }
  forceError: null,
};

export function reset() {
  state.tokens = new Set();
  state.policies = new Map([['policy-001', { id: 'policy-001', name: 'test_policy', enforcementMode: 'blocking', active: true }]]);
  state.exceptions = new Map([['policy-001', new Map()]]);
  state.applyCallCount = 0;
  state.forceError = null;
  state.validUsername = 'admin';
  state.validPassword = 'admin';
}

// ── helpers ───────────────────────────────────────────────────────────────────

let _excIdCounter = 1;
const nextExcId = () => `exc-${String(_excIdCounter++).padStart(4, '0')}`;

const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
};

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
      catch { resolve({}); }
    });
  });

const requireAuth = (req, res) => {
  const token = req.headers['x-f5-auth-token'];
  if (!token || !state.tokens.has(token)) {
    json(res, 401, { message: 'Unauthorized: missing or invalid token' });
    return false;
  }
  return true;
};

// ── request handler ───────────────────────────────────────────────────────────

const handler = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  const method = req.method;

  // force-error injection
  if (state.forceError && path === state.forceError.path) {
    json(res, state.forceError.status, { message: 'Injected error' });
    return;
  }

  // ── POST /mgmt/shared/authn/login ─────────────────────────────────────────
  if (method === 'POST' && path === '/mgmt/shared/authn/login') {
    const body = await readBody(req);
    if (body.username !== state.validUsername || body.password !== state.validPassword) {
      json(res, 401, { message: 'Authorization failed: invalid credentials' });
      return;
    }
    const token = `mock-token-${Date.now()}`;
    state.tokens.add(token);
    json(res, 200, {
      token: { token, name: token, timeout: 1200 },
      username: body.username,
    });
    return;
  }

  // ── DELETE /mgmt/shared/authz/tokens/:token ───────────────────────────────
  const logoutMatch = path.match(/^\/mgmt\/shared\/authz\/tokens\/(.+)$/);
  if (method === 'DELETE' && logoutMatch) {
    const token = logoutMatch[1];
    if (!state.tokens.has(token)) {
      json(res, 404, { message: 'Token not found' });
      return;
    }
    state.tokens.delete(token);
    json(res, 200, { message: 'Logged out' });
    return;
  }

  // ── GET /mgmt/tm/asm/policies ─────────────────────────────────────────────
  if (method === 'GET' && path === '/mgmt/tm/asm/policies') {
    if (!requireAuth(req, res)) return;
    const nameFilter = url.searchParams.get('$filter')?.match(/name eq (.+)/)?.[1];
    let items = [...state.policies.values()];
    if (nameFilter) items = items.filter((p) => p.name === decodeURIComponent(nameFilter));
    json(res, 200, { items });
    return;
  }

  // ── PATCH /mgmt/tm/asm/policies/:id  (SetEnforcementMode) ────────────────
  const policyItemMatch = path.match(/^\/mgmt\/tm\/asm\/policies\/([^/]+)$/);
  if (policyItemMatch && method === 'PATCH') {
    if (!requireAuth(req, res)) return;
    const policyId = policyItemMatch[1];
    if (!state.policies.has(policyId)) { json(res, 404, { message: 'Policy not found' }); return; }
    const body = await readBody(req);
    const policy = { ...state.policies.get(policyId), ...body };
    state.policies.set(policyId, policy);
    json(res, 200, policy);
    return;
  }

  // ── /mgmt/tm/asm/policies/:id/whitelist-ips[/:excId] ─────────────────────
  const excListMatch = path.match(/^\/mgmt\/tm\/asm\/policies\/([^/]+)\/whitelist-ips$/);
  const excItemMatch = path.match(/^\/mgmt\/tm\/asm\/policies\/([^/]+)\/whitelist-ips\/([^/]+)$/);

  if (excListMatch) {
    if (!requireAuth(req, res)) return;
    const policyId = excListMatch[1];
    if (!state.policies.has(policyId)) { json(res, 404, { message: 'Policy not found' }); return; }

    // GET list
    if (method === 'GET') {
      const items = [...(state.exceptions.get(policyId)?.values() ?? [])];
      json(res, 200, { items });
      return;
    }

    // POST create
    if (method === 'POST') {
      const body = await readBody(req);
      const id = nextExcId();
      const exc = { id, ipAddress: body.ipAddress, blockRequests: body.blockRequests ?? 'always' };
      if (!state.exceptions.has(policyId)) state.exceptions.set(policyId, new Map());
      state.exceptions.get(policyId).set(id, exc);
      json(res, 201, exc);
      return;
    }
  }

  if (excItemMatch) {
    if (!requireAuth(req, res)) return;
    const policyId = excItemMatch[1];
    const excId = excItemMatch[2];
    const excMap = state.exceptions.get(policyId);

    // PATCH update
    if (method === 'PATCH') {
      if (!excMap?.has(excId)) { json(res, 404, { message: 'Exception not found' }); return; }
      const body = await readBody(req);
      const exc = { ...excMap.get(excId), ...body };
      excMap.set(excId, exc);
      json(res, 200, exc);
      return;
    }

    // DELETE
    if (method === 'DELETE') {
      if (!excMap?.has(excId)) { json(res, 404, { message: 'Exception not found' }); return; }
      excMap.delete(excId);
      json(res, 200, { message: 'Deleted' });
      return;
    }
  }

  // ── POST /mgmt/tm/asm/tasks/apply-policy ─────────────────────────────────
  if (method === 'POST' && path === '/mgmt/tm/asm/tasks/apply-policy') {
    if (!requireAuth(req, res)) return;
    state.applyCallCount++;
    json(res, 200, { id: `task-${state.applyCallCount}`, status: 'started' });
    return;
  }

  // 404 fallback
  json(res, 404, { message: `Not found: ${method} ${path}` });
};

// ── lifecycle ─────────────────────────────────────────────────────────────────

let _server = null;

export const start = () =>
  new Promise((resolve, reject) => {
    if (_server) return resolve({ port: _server.address().port });
    _server = createServer(handler);
    _server.on('error', reject);
    _server.listen(DEFAULT_PORT, '127.0.0.1', () => {
      resolve({ port: _server.address().port });
    });
  });

export const stop = () =>
  new Promise((resolve, reject) => {
    if (!_server) return resolve();
    _server.close((err) => {
      _server = null;
      err ? reject(err) : resolve();
    });
  });
