// Mock upstream for Crowdsec LAPI
import http from 'node:http';

const httpPort = Number(process.env.HTTP_PORT || 18080);
const log = (...args) => console.log('[mock-crowdsec]', ...args);

// In-memory store
const alerts = new Map();
const decisions = new Map();
let nextAlertId = 1;
let nextDecisionId = 1;

// Seed some data
const seedAlert1 = {
  id: nextAlertId++,
  uuid: 'uuid-alert-1',
  machine_id: 'test-machine',
  created_at: '2026-06-27T12:00:00Z',
  scenario: 'ssh-bf',
  scenario_hash: 'hash1',
  scenario_version: '0.1',
  message: 'ssh brute force detected',
  events_count: 10,
  start_at: '2026-06-27T11:00:00Z',
  stop_at: '2026-06-27T12:00:00Z',
  capacity: 5,
  leakspeed: '10',
  simulated: false,
  source: {
    scope: 'ip',
    value: '1.2.3.4',
    ip: '1.2.3.4',
    range: '',
    as_number: '13335',
    as_name: 'Cloudflare',
    cn: 'US',
    latitude: 37.7749,
    longitude: -122.4194,
  },
  events: [
    { timestamp: '2026-06-27T11:30:00Z', meta: [{ key: 'log', value: 'ssh attempt' }] },
  ],
  decisions: [
    { id: nextDecisionId++, uuid: 'uuid-dec-1', origin: 'crowdsec', type: 'ban', scope: 'ip', value: '1.2.3.4', duration: '3h59m59s', scenario: 'ssh-bf', simulated: false },
  ],
  meta: [],
  remediation: true,
  kind: '',
};
alerts.set(seedAlert1.id, seedAlert1);

const seedDecision2 = {
  id: nextDecisionId++,
  uuid: 'uuid-dec-2',
  origin: 'cscli',
  type: 'ban',
  scope: 'ip',
  value: '5.6.7.8',
  duration: '4h',
  scenario: 'manual',
  simulated: false,
};
decisions.set(seedDecision2.id, seedDecision2);

// JWT token store
const jwtTokens = new Map();
const JWT_SECRET = 'test-secret';

const createJwtToken = (machineId) => {
  // Minimal fake JWT
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    machine_id: machineId,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iss: 'crowdsec-test',
  })).toString('base64url');
  const signature = Buffer.from('fake-sig').toString('base64url');
  const token = `${header}.${payload}.${signature}`;
  jwtTokens.set(token, machineId);
  return token;
};

const verifyJwt = (authHeader) => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  return jwtTokens.get(token);
};

const verifyApiKey = (apiKeyHeader) => {
  if (!apiKeyHeader) return null;
  // Accept any non-empty api key for mock
  return apiKeyHeader.length > 0 ? 'bouncer-ok' : null;
};

const parseBody = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString();
    resolve(raw ? JSON.parse(raw) : {});
  });
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${httpPort}`);

  // ── Health ──
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // ── JWT Login ──
  if (req.method === 'POST' && url.pathname === '/v1/watchers/login') {
    const body = await parseBody(req);
    if (!body.machine_id || !body.password) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'machine_id and password required' }));
      return;
    }
    if (body.password === 'wrong-password') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'invalid credentials' }));
      return;
    }
    const token = createJwtToken(body.machine_id);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 200, token, expire: new Date(Date.now() + 3600000).toISOString() }));
    return;
  }

  // ── Alerts ──
  if (req.method === 'GET' && url.pathname === '/v1/alerts') {
    const machine = verifyJwt(req.headers['authorization']);
    if (!machine) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'authentication required' }));
      return;
    }
    const params = url.searchParams;
    let list = Array.from(alerts.values());

    if (params.get('scenario')) {
      list = list.filter((a) => a.scenario === params.get('scenario'));
    }
    if (params.get('ip')) {
      list = list.filter((a) => a.source?.ip === params.get('ip'));
    }
    if (params.get('scope')) {
      list = list.filter((a) => a.source?.scope === params.get('scope'));
    }
    if (params.get('origin')) {
      list = list.filter((a) => a.origin === params.get('origin'));
    }
    if (params.get('since')) {
      // simplified: just pass through, no actual time filtering in mock
    }
    const limit = parseInt(params.get('limit') || '0', 10);
    if (limit > 0) list = list.slice(0, limit);

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(list));
    return;
  }

  if (req.method === 'GET' && url.pathname.match(/^\/v1\/alerts\/(\d+)$/)) {
    const machine = verifyJwt(req.headers['authorization']);
    if (!machine) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'authentication required' }));
      return;
    }
    const id = parseInt(url.pathname.split('/').pop(), 10);
    const alert = alerts.get(id);
    if (!alert) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'alert not found' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(alert));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/alerts') {
    const machine = verifyJwt(req.headers['authorization']);
    if (!machine) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'authentication required' }));
      return;
    }
    const body = await parseBody(req);
    const created = (Array.isArray(body) ? body : [body]).map((item) => {
      const alert = {
        id: nextAlertId++,
        uuid: `uuid-${Date.now()}`,
        machine_id: machine,
        created_at: new Date().toISOString(),
        ...item,
        source: item.source || {},
        events: item.events || [],
        decisions: item.decisions ? item.decisions.map((d) => ({ ...d, id: nextDecisionId++, uuid: `uuid-dec-${Date.now()}` })) : [],
        meta: item.meta || [],
      };
      alerts.set(alert.id, alert);
      // Also store decisions
      if (alert.decisions) {
        alert.decisions.forEach((d) => decisions.set(d.id, d));
      }
      return alert;
    });
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end(JSON.stringify(created));
    return;
  }

  // ── Decisions ──
  if (req.method === 'GET' && url.pathname === '/v1/decisions') {
    // Accept both API Key and JWT
    const apiKey = verifyApiKey(req.headers['x-api-key']);
    const machine = verifyJwt(req.headers['authorization']);
    if (!apiKey && !machine) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'authentication required' }));
      return;
    }

    let list = Array.from(decisions.values());
    const params = url.searchParams;
    if (params.get('scope')) {
      list = list.filter((d) => d.scope === params.get('scope'));
    }
    if (params.get('value')) {
      list = list.filter((d) => d.value === params.get('value'));
    }
    if (params.get('type')) {
      list = list.filter((d) => d.type === params.get('type'));
    }
    if (params.get('ip')) {
      list = list.filter((d) => d.scope === 'ip' && d.value === params.get('ip'));
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(list));
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/v1/decisions') {
    const machine = verifyJwt(req.headers['authorization']);
    if (!machine) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'authentication required' }));
      return;
    }
    const params = url.searchParams;
    let deleted = 0;
    const scope = params.get('scope') || 'ip';
    const value = params.get('value');

    if (scope && value) {
      for (const [id, d] of decisions) {
        if (d.scope === scope && d.value === value) {
          decisions.delete(id);
          deleted++;
        }
      }
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ nbDeleted: String(deleted) }));
    return;
  }

  if (req.method === 'DELETE' && url.pathname.match(/^\/v1\/decisions\/(\d+)$/)) {
    const machine = verifyJwt(req.headers['authorization']);
    if (!machine) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'authentication required' }));
      return;
    }
    const id = parseInt(url.pathname.split('/').pop(), 10);
    const existed = decisions.has(id);
    decisions.delete(id);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ nbDeleted: String(existed ? 1 : 0) }));
    return;
  }

  // ── Fallback ──
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

server.listen(httpPort, () => log(`listening on :${httpPort}`));
