// Mock upstream for Wazuh API (matching Wazuh 4.9.x API)
import http from 'node:http';

const httpPort = Number(process.env.HTTP_PORT || 19000);
const log = (...args) => console.log('[mock-wazuh]', ...args);

// Simulated JWT token store
const validCredentials = { wazuh: 'wazuh' };
const issuedTokens = new Map(); // token -> { username, expiresAt }

const generateMockToken = (username) => {
  const token = `mock-jwt-${username}-${Date.now()}`;
  issuedTokens.set(token, {
    username,
    expiresAt: Date.now() + 900_000, // 15 min
  });
  return token;
};

const isValidToken = (authHeader) => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  const info = issuedTokens.get(token);
  if (!info) return false;
  if (Date.now() > info.expiresAt) {
    issuedTokens.delete(token);
    return false;
  }
  return true;
};

const sampleAlerts = [
  {
    id: '1',
    timestamp: '2024-01-15T10:30:00Z',
    rule: { description: 'SSH brute force attack detected', level: 10, groups: ['authentication_failed', 'sshd'], mitre: { id: ['T1110', 'T1021.004'] } },
    agent: { id: '001', name: 'web-server', ip: '192.168.1.10' },
    full_log: 'Jan 15 10:30:00 web-server sshd[1234]: Failed password for root from 10.0.0.5 port 22',
  },
  {
    id: '2',
    timestamp: '2024-01-15T11:00:00Z',
    rule: { description: 'File modification detected', level: 7, groups: ['syscheck', 'rootcheck'], mitre: { id: ['T1565.001'] } },
    agent: { id: '002', name: 'db-server', ip: '192.168.1.20' },
    full_log: 'Jan 15 11:00:00 db-server ossec: File /etc/passwd modified',
  },
  {
    id: '3',
    timestamp: '2024-01-15T12:00:00Z',
    rule: { description: 'Critical vulnerability detected', level: 14, groups: ['vulnerability-detector'], mitre: { id: ['T1190'] } },
    agent: { id: '001', name: 'web-server', ip: '192.168.1.10' },
    full_log: 'CVE-2024-0001 detected on web-server',
  },
];

const sampleAgents = [
  { id: '001', name: 'web-server', ip: '192.168.1.10', status: 'active', os: { name: 'Ubuntu', version: '22.04' }, version: 'Wazuh v4.9.0', lastKeepAlive: '2024-01-15T12:00:00Z', group: ['default', 'web'] },
  { id: '002', name: 'db-server', ip: '192.168.1.20', status: 'active', os: { name: 'CentOS', version: '8' }, version: 'Wazuh v4.9.0', lastKeepAlive: '2024-01-15T12:00:00Z', group: ['default', 'database'] },
  { id: '003', name: 'old-server', ip: '192.168.1.30', status: 'disconnected', os: { name: 'Debian', version: '11' }, version: 'Wazuh v4.8.0', lastKeepAlive: '2024-01-10T08:00:00Z', group: ['default'] },
];

const sampleVulnerabilities = [
  { cve: 'CVE-2024-0001', severity: 'Critical', package: { name: 'openssl', version: '1.1.1f-1ubuntu2' }, title: 'OpenSSL Buffer Overflow', description: 'A buffer overflow vulnerability in OpenSSL', references: 'https://nvd.nist.gov/vuln/detail/CVE-2024-0001', type: 'Package' },
  { cve: 'CVE-2024-0002', severity: 'High', package: { name: 'libcurl', version: '7.68.0-1' }, title: 'libcurl Use-After-Free', description: 'A use-after-free vulnerability in libcurl', references: 'https://nvd.nist.gov/vuln/detail/CVE-2024-0002', type: 'Package' },
  { cve: 'CVE-2024-0003', severity: 'Medium', package: { name: 'nginx', version: '1.18.0-0ubuntu1' }, title: 'Nginx Information Disclosure', description: 'An information disclosure vulnerability in nginx', references: 'https://nvd.nist.gov/vuln/detail/CVE-2024-0003', type: 'Package' },
  { cve: 'CVE-2024-0004', severity: 'Low', package: { name: 'bash', version: '5.0-6ubuntu1' }, title: 'Bash Denial of Service', description: 'A denial of service vulnerability in bash', references: 'https://nvd.nist.gov/vuln/detail/CVE-2024-0004', type: 'Advisory' },
];

const parseBody = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString();
    try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
  });
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const authHeader = req.headers['authorization'] || '';

  // ─── POST /security/user/authenticate ────────────────────────
  if (req.method === 'POST' && url.pathname === '/security/user/authenticate') {
    let username, password;

    // Basic Auth
    if (authHeader.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
      const colonIdx = decoded.indexOf(':');
      username = decoded.slice(0, colonIdx);
      password = decoded.slice(colonIdx + 1);
    } else {
      const body = await parseBody(req);
      username = body.username;
      password = body.password;
    }

    if (validCredentials[username] === password) {
      const token = generateMockToken(username);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        data: { token },
        error: 0,
        message: 'Authentication succeeded',
      }));
    } else {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        title: 'Unauthorized',
        detail: 'Invalid credentials',
        error: 401,
      }));
    }
    return;
  }

  // ─── All other endpoints require Bearer token ────────────────
  if (!isValidToken(authHeader)) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      title: 'Unauthorized',
      detail: 'No valid token provided',
      error: 401,
    }));
    return;
  }

  // ─── GET /alerts ────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/alerts') {
    const q = url.searchParams.get('q') || '';
    const limit = parseInt(url.searchParams.get('limit') || '10', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const search = url.searchParams.get('search') || '';

    let filtered = sampleAlerts;

    // Apply severity filter from q parameter
    const severityMatch = q.match(/rule\.level>=(\d+)/);
    if (severityMatch) {
      const minLevel = parseInt(severityMatch[1], 10);
      filtered = filtered.filter((a) => a.rule.level >= minLevel);
    }

    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter((a) =>
        a.rule.description.toLowerCase().includes(s) ||
        a.full_log.toLowerCase().includes(s)
      );
    }

    const paged = filtered.slice(offset, offset + limit);

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      data: {
        affected_items: paged,
        total_affected_items: filtered.length,
      },
      error: 0,
      message: 'All alerts returned',
    }));
    return;
  }

  // ─── GET /overview/alerts ────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/overview/alerts') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      data: {
        total_alerts: 3,
        level_12_plus: 1,
        level_8_11: 1,
        level_4_7: 1,
        level_0_3: 0,
      },
      error: 0,
      message: 'Summary returned',
    }));
    return;
  }

  // ─── GET /vulnerability/:agent_id/summary ────────────────────
  const vulnSummaryMatch = url.pathname.match(/^\/vulnerability\/([^/]+)\/summary$/);
  if (req.method === 'GET' && vulnSummaryMatch) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      data: {
        Critical: 1,
        High: 1,
        Medium: 1,
        Low: 1,
        total: 4,
      },
      error: 0,
      message: 'Summary returned',
    }));
    return;
  }

  // ─── GET /vulnerability/:agent_id ────────────────────────────
  const vulnMatch = url.pathname.match(/^\/vulnerability\/([^/]+)$/);
  if (req.method === 'GET' && vulnMatch) {
    const agentId = vulnMatch[1];
    if (agentId === '000') {
      // Manager has no vulnerabilities
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        data: { affected_items: [], total_affected_items: 0 },
        error: 0,
        message: 'No vulnerabilities found',
      }));
      return;
    }

    const limit = parseInt(url.searchParams.get('limit') || '10', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const paged = sampleVulnerabilities.slice(offset, offset + limit);

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      data: {
        affected_items: paged,
        total_affected_items: sampleVulnerabilities.length,
      },
      error: 0,
      message: 'Vulnerabilities returned',
    }));
    return;
  }

  // ─── GET /agents ─────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/agents') {
    const status = url.searchParams.get('status') || 'active';
    const limit = parseInt(url.searchParams.get('limit') || '10', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const search = url.searchParams.get('search') || '';

    let filtered = sampleAgents;
    if (status && status !== 'all') {
      filtered = filtered.filter((a) => a.status === status);
    }

    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter((a) =>
        a.name.toLowerCase().includes(s) ||
        a.ip.includes(s)
      );
    }

    const paged = filtered.slice(offset, offset + limit);

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      data: {
        affected_items: paged,
        total_affected_items: filtered.length,
      },
      error: 0,
      message: 'All agents returned',
    }));
    return;
  }

  // ─── 404 ─────────────────────────────────────────────────────
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

server.listen(httpPort, () =>
  log(
    `listening on :${httpPort}`,
    '\nEndpoints: POST /security/user/authenticate, GET /alerts, GET /overview/alerts, GET /vulnerability/{id}, GET /vulnerability/{id}/summary, GET /agents'
  )
);
