// Mock upstream for Cloudflare API v4 (IP access rules + zone security level).
// For manual/integration runs: HTTP_PORT=18090 node test/mock_upstream.js
import http from 'node:http';

const httpPort = Number(process.env.HTTP_PORT || 18090);
const log = (...args) => console.log('[mock-cloudflare]', ...args);

let nextId = 1000;
// rules keyed by id
const rules = new Map();
const seedId = String(nextId++);
rules.set(seedId, {
  id: seedId,
  mode: 'block',
  notes: 'seed',
  configuration: { target: 'ip', value: '203.0.113.9' },
});

let securityLevel = 'medium';

const ok = (res, result, resultInfo) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ success: true, errors: [], messages: [], result, result_info: resultInfo }));
};

const fail = (res, status, errors) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ success: false, errors, messages: [], result: null }));
};

const readBody = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString();
    resolve(raw ? JSON.parse(raw) : {});
  });
});

const authed = (req, res) => {
  const bearer = req.headers['authorization'];
  const email = req.headers['x-auth-email'];
  if (!bearer && !email) {
    fail(res, 403, [{ code: 9109, message: 'Unauthorized' }]);
    return false;
  }
  return true;
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  if (!authed(req, res)) return;

  // /zones/{zone}/firewall/access_rules/rules  or /accounts/{acct}/...
  const rulesMatch = path.match(/\/(zones|accounts)\/[^/]+\/firewall\/access_rules\/rules(?:\/([^/]+))?$/);
  if (rulesMatch) {
    const ruleId = rulesMatch[2];
    if (req.method === 'GET') {
      const value = url.searchParams.get('configuration.value');
      const mode = url.searchParams.get('mode');
      let list = Array.from(rules.values());
      if (value) list = list.filter((r) => r.configuration.value === value);
      if (mode) list = list.filter((r) => r.mode === mode);
      ok(res, list, { total_count: list.length, page: 1, per_page: 50 });
      return;
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      const id = String(nextId++);
      const rule = {
        id,
        mode: body.mode || 'block',
        notes: body.notes || '',
        configuration: body.configuration || {},
      };
      rules.set(id, rule);
      ok(res, rule, {});
      log('created rule', rule);
      return;
    }
    if (req.method === 'DELETE' && ruleId) {
      rules.delete(ruleId);
      ok(res, { id: ruleId }, {});
      log('deleted rule', ruleId);
      return;
    }
  }

  // /zones/{zone}/settings/security_level
  if (/\/zones\/[^/]+\/settings\/security_level$/.test(path)) {
    if (req.method === 'GET') {
      ok(res, { id: 'security_level', value: securityLevel, editable: true });
      return;
    }
    if (req.method === 'PATCH') {
      const body = await readBody(req);
      securityLevel = body.value || securityLevel;
      ok(res, { id: 'security_level', value: securityLevel, editable: true });
      log('set security_level', securityLevel);
      return;
    }
  }

  fail(res, 404, [{ code: 7003, message: 'not found' }]);
});

server.listen(httpPort, () => log(`listening on :${httpPort}`));
