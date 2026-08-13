// Mock upstream for TopSec WAF REST API
import http from 'node:http';

const httpPort = Number(process.env.HTTP_PORT || 28080);
const log = (...args) => console.log('[mock-topsec-waf]', ...args);

// test credentials
const TEST_USER = 'admin';
const TEST_PASS = 'test123';
const TEST_SESSION = 'abc123def456';
const TEST_TOKEN = 'tok-xyz789';

// in-memory store
const ipGroups = new Map();
const urlBlocks = new Map();

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { resolve(null); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${httpPort}`);

  // ── /api/v1/get_miks ──
  if (req.method === 'POST' && url.pathname === '/api/v1/get_miks') {
    const key = Buffer.from('0123456789abcdef'); // 16-byte AES key
    res.writeHead(200, {
      'content-type': 'text/plain',
      'set-cookie': `PHPSESSID=${TEST_SESSION}; Path=/; HttpOnly`,
    });
    res.end(key.toString('base64'));
    return;
  }

  // ── /api/v1/login ──
  if (req.method === 'POST' && url.pathname === '/api/v1/login') {
    const raw = await new Promise((resolve) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    });
    const params = new URLSearchParams(raw);
    const name = params.get('name');
    const password = params.get('password');

    if (!name || !password) {
      res.writeHead(401);
      res.end('auth required');
      return;
    }

    if (name !== TEST_USER) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }

    // Accept any password in mock (real validation would decrypt)
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`ok?${TEST_TOKEN}`);
    return;
  }

  // ── All other WAF API calls require JSON body with token ──
  const body = await readBody(req);
  if (!body) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ result: 'failed', info: 'invalid request' }));
    return;
  }

  const token = body.token || '';
  if (token !== TEST_TOKEN) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ result: 'failed', info: 'auth required' }));
    return;
  }

  const commands = body.commands || [];
  const command = commands[0] || {};

  // ── /api/v1/ip_group_add ──
  if (url.pathname === '/api/v1/ip_group_add') {
    const cmd = command.waf_ip_group_add || {};
    const name = cmd.name;
    if (!name) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ result: 'failed', info: 'name required' }));
      return;
    }
    ipGroups.set(name, { name, address: cmd.address || '' });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ result: 'ok', info: 'added' }));
    return;
  }

  // ── /api/v1/ip_group_delete ──
  if (url.pathname === '/api/v1/ip_group_delete') {
    const cmd = command.waf_ip_group_delete || {};
    const name = cmd.name;
    if (!name || !ipGroups.has(name)) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ result: 'failed', info: 'not found or name required' }));
      return;
    }
    ipGroups.delete(name);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ result: 'ok', info: 'deleted' }));
    return;
  }

  // ── /api/v1/ip_group_show ──
  if (url.pathname === '/api/v1/ip_group_show') {
    const cmd = command.waf_ip_group_show || {};
    const filterName = cmd.name;
    let rows = Array.from(ipGroups.values()).map((g) => ({
      name: g.name,
      group_value: g.address,
      ip_group_members: g.address,
      m_type: 'black',
    }));
    if (filterName) {
      rows = rows.filter((r) => r.name === filterName);
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ rows, total: String(rows.length) }));
    return;
  }

  // ── /api/v1/user_policy_add ──
  if (url.pathname === '/api/v1/user_policy_add') {
    const cmd = command.waf_user_policy_ui_add || {};
    const name = cmd.name;
    if (!name) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ result: 'failed', info: 'name required' }));
      return;
    }
    urlBlocks.set(name, {
      'security-policy': cmd['security-policy'] || '',
      name,
      url: cmd.url || '',
      enable: cmd.enable || 'on',
      phase: cmd.phase || 'request_header',
      action: cmd.action || 'deny',
      'log-message': cmd['log-message'] || '',
      condition: cmd.condition || '',
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ result: 'ok', info: 'added' }));
    return;
  }

  // ── /api/v1/user_policy_delete ──
  if (url.pathname === '/api/v1/user_policy_delete') {
    const cmd = command.waf_user_policy_delete || {};
    const name = cmd.name;
    if (!name || !urlBlocks.has(name)) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ result: 'failed', info: 'not found or name required' }));
      return;
    }
    urlBlocks.delete(name);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ result: 'ok', info: 'deleted' }));
    return;
  }

  // ── /api/v1/user_policy_modify ──
  if (url.pathname === '/api/v1/user_policy_modify') {
    const cmd = command.waf_user_policy_modify_ui || {};
    const name = cmd.name;
    if (!name || !urlBlocks.has(name)) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ result: 'failed', info: 'not found' }));
      return;
    }
    const entry = urlBlocks.get(name);
    if (cmd.enable) entry.enable = cmd.enable;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ result: 'ok', info: 'modified' }));
    return;
  }

  // ── /api/v1/user_policy_show ──
  if (url.pathname === '/api/v1/user_policy_show') {
    const cmd = command.waf_url_rewrite_show_name || {};
    const policyName = cmd['security-policy'];
    let rows = [];
    for (const [k, v] of urlBlocks) {
      if (policyName && v['security-policy'] !== policyName) continue;
      rows.push({
        id: k,
        name: v.name,
        action: v.action,
        enable: v.enable,
        phase: v.phase,
        log_message: v['log-message'],
        conditions: v.condition,
      });
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ rows, total: String(rows.length) }));
    return;
  }

  // ── 404 fallback ──
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ result: 'failed', info: 'unknown endpoint' }));
});

server.listen(httpPort, () => {
  log(`listening on :${httpPort}`);
  if (process.send) process.send('ready');
});

export default server;
