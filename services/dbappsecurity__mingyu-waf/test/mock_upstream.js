// Mock upstream for DBAPPSecurity Mingyu WAF API
import crypto from 'node:crypto';
import http from 'node:http';

const PORT = Number(process.env.HTTP_PORT || 18081);
const log = (...args) => console.log('[mock-mingyu-waf]', ...args);

// Generate a self-contained RSA key pair for the mock login flow
const { publicKey: RSA_PUBLIC_KEY } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
});

const MOCK_TOKEN = 'mock-jwt-token';
const VALID_USERNAME = 'admin';

// In-memory rule stores
let blockRules = [
  {
    _pk: 'rule-001',
    name: 'Block known scanner',
    description: 'Block common scanning IPs',
    enable: true,
    effect_time_range: '',
    cond_suites: [{ cond_terms: [{ field: 'sip', operator: 'exact match', operand: ['1.2.3.4'], neg: false }] }],
    adapt_new_app: 'all_apps',
    apps: [],
  },
];

let allowRules = [];
let ruleCounter = 100;

const parseBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString();
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });

const sendJSON = (res, statusCode, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
};

const success = (res, data) => sendJSON(res, 200, { code: 'SUCCESS', message: '', data });
const failJSON = (res, code, message) => sendJSON(res, 200, { code, message, data: null });

const getToken = (req) => {
  const auth = req.headers['authorization'] ?? '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
};

const requireAuth = (req, res) => {
  if (getToken(req) !== MOCK_TOKEN) {
    sendJSON(res, 401, { code: 'GENERAL_TOKEN_INVALID', message: 'Invalid or missing token' });
    return false;
  }
  return true;
};

const paginateRules = (rules, query) => {
  const page = Math.max(1, Number(query.get('page') || 1));
  const perPage = Math.max(1, Number(query.get('per_page') || 20));
  const nameFilter = query.get('name') || '';
  let filtered = rules;
  if (nameFilter) {
    filtered = filtered.filter((r) => r.name.includes(nameFilter));
  }
  const total = filtered.length;
  const start = (page - 1) * perPage;
  const result = filtered.slice(start, start + perPage);
  return { count: total, page, per_page: perPage, result };
};

const makeRule = (body) => {
  const id = `rule-${String(++ruleCounter).padStart(3, '0')}`;
  return {
    _pk: id,
    name: body.name ?? '',
    description: body.description ?? '',
    enable: body.enable !== undefined ? body.enable : true,
    effect_time_range: body.effect_time_range ?? '',
    cond_suites: body.cond_suites ?? [],
    action: body.action ?? { name: 'deny' },
    adapt_new_app: body.adapt_new_app ?? 'all_apps',
    apps: body.apps ?? [],
  };
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const query = url.searchParams;

  // Auth: public key
  if (req.method === 'GET' && pathname === '/api/v2/system/auth/public_key/') {
    success(res, RSA_PUBLIC_KEY);
    return;
  }

  // Auth: login
  if (req.method === 'POST' && pathname === '/api/v2/system/user/login/') {
    let body;
    try {
      body = await parseBody(req);
    } catch {
      sendJSON(res, 400, { code: 'ERROR', message: 'invalid body' });
      return;
    }
    if (body.username !== VALID_USERNAME) {
      failJSON(res, 'USERNAME_PASSWD_ERROR', 'invalid credentials');
      return;
    }
    success(res, { token: MOCK_TOKEN, expires_in: 3600 });
    return;
  }

  // Basic rules (blocking)
  if (pathname === '/api/v1/security/basic_rules/' || pathname === '/api/v1/security/basic_rules') {
    if (!requireAuth(req, res)) return;
    if (req.method === 'GET') {
      success(res, paginateRules(blockRules, query));
      return;
    }
    if (req.method === 'POST') {
      let body;
      try { body = await parseBody(req); } catch { sendJSON(res, 400, {}); return; }
      if (!body.name) { failJSON(res, 'PARAM_ERROR', 'name required'); return; }
      const rule = makeRule(body);
      blockRules.push(rule);
      success(res, rule);
      log('created block rule', rule._pk);
      return;
    }
  }

  // Basic rules by id (update/delete)
  const blockMatch = pathname.match(/^\/api\/v1\/security\/basic_rules\/([^/]+)\/?$/);
  if (blockMatch) {
    if (!requireAuth(req, res)) return;
    const id = blockMatch[1];
    const idx = blockRules.findIndex((r) => r._pk === id);
    if (req.method === 'PUT') {
      let body;
      try { body = await parseBody(req); } catch { sendJSON(res, 400, {}); return; }
      if (idx < 0) { failJSON(res, 'NOT_FOUND', 'rule not found'); return; }
      const updated = { ...blockRules[idx], ...body, _pk: id };
      blockRules[idx] = updated;
      success(res, updated);
      log('updated block rule', id);
      return;
    }
    if (req.method === 'DELETE') {
      if (idx < 0) { failJSON(res, 'NOT_FOUND', 'rule not found'); return; }
      blockRules.splice(idx, 1);
      success(res, null);
      log('deleted block rule', id);
      return;
    }
  }

  // Control rules (allowlist)
  if (pathname === '/api/v1/security/control_rules/' || pathname === '/api/v1/security/control_rules') {
    if (!requireAuth(req, res)) return;
    if (req.method === 'GET') {
      success(res, paginateRules(allowRules, query));
      return;
    }
    if (req.method === 'POST') {
      let body;
      try { body = await parseBody(req); } catch { sendJSON(res, 400, {}); return; }
      if (!body.name) { failJSON(res, 'PARAM_ERROR', 'name required'); return; }
      const rule = makeRule(body);
      allowRules.push(rule);
      success(res, rule);
      log('created allow rule', rule._pk);
      return;
    }
  }

  // Control rules by id (update/delete)
  const controlMatch = pathname.match(/^\/api\/v1\/security\/control_rules\/([^/]+)\/?$/);
  if (controlMatch) {
    if (!requireAuth(req, res)) return;
    const id = controlMatch[1];
    const idx = allowRules.findIndex((r) => r._pk === id);
    if (req.method === 'PUT') {
      let body;
      try { body = await parseBody(req); } catch { sendJSON(res, 400, {}); return; }
      if (idx < 0) { failJSON(res, 'NOT_FOUND', 'rule not found'); return; }
      const updated = { ...allowRules[idx], ...body, _pk: id };
      allowRules[idx] = updated;
      success(res, updated);
      log('updated allow rule', id);
      return;
    }
    if (req.method === 'DELETE') {
      if (idx < 0) { failJSON(res, 'NOT_FOUND', 'rule not found'); return; }
      allowRules.splice(idx, 1);
      success(res, null);
      log('deleted allow rule', id);
      return;
    }
  }

  // Sites
  if (req.method === 'GET' && (pathname === '/api/v1/website/site/' || pathname === '/api/v1/website/site')) {
    if (!requireAuth(req, res)) return;
    const page = Math.max(1, Number(query.get('page') || 1));
    const perPage = Math.max(1, Number(query.get('per_page') || 20));
    const nameFilter = query.get('name') || '';
    const allSites = [
      { _pk: 'site-001', name: 'default-site', type: 'reverse', enable: true },
    ].filter((s) => !nameFilter || s.name.includes(nameFilter));
    success(res, {
      count: allSites.length,
      page,
      per_page: perPage,
      result: allSites.slice((page - 1) * perPage, page * perPage),
    });
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, () => log(`listening on :${PORT}`));
