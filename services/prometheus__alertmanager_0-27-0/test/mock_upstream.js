/* node:coverage disable */
import http from 'node:http';

const sendJson = (res, status, payload) => { const body = JSON.stringify(payload); res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }); res.end(body); };

export function createMockServer() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const fullUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const path = fullUrl.pathname;
    const entry = { method: req.method, path, query: Object.fromEntries(fullUrl.searchParams), headers: req.headers };
    requests.push(entry);

    if (path === '/api/v2/alerts') {
      sendJson(res, 200, [{ fingerprint: 'abc123', startsAt: '2026-01-01T00:00:00Z', endsAt: '0001-01-01T00:00:00Z', updatedAt: '2026-01-01T00:01:00Z', generatorURL: 'http://prom:9090/graph', labels: { alertname: 'HighErrorRate', severity: 'critical' }, annotations: { summary: 'High error rate' }, status: { state: ['active'], silencedBy: [], inhibitedBy: [] } }]);
      return;
    }

    if (path === '/api/v2/alerts/groups') {
      sendJson(res, 200, [{ labels: { alertname: 'HighErrorRate' }, receiver: { name: 'default' }, alerts: [{ fingerprint: 'abc123', startsAt: '2026-01-01T00:00:00Z', status: { state: ['active'] }, labels: { alertname: 'HighErrorRate' }, annotations: {} }] }]);
      return;
    }

    if (path === '/api/v2/silences') {
      sendJson(res, 200, [{ id: 'silence-1', createdBy: 'admin', comment: 'Mute test', startsAt: '2026-01-01T00:00:00Z', endsAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', matchers: [{ name: 'alertname', value: 'TestAlert', isRegex: false }], status: { state: 'active' } }]);
      return;
    }

    const silenceMatch = path.match(/^\/api\/v2\/silence\/(.+)$/);
    if (silenceMatch) {
      sendJson(res, 200, { id: silenceMatch[1], createdBy: 'admin', comment: 'Test silence', startsAt: '2026-01-01T00:00:00Z', endsAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', matchers: [], status: { state: 'active' } });
      return;
    }

    if (path === '/api/v2/receivers') { sendJson(res, 200, [{ name: 'team-a', integrations: [{ name: 'team-a-webhook', type: 'webhook', active: true }, { name: 'team-a-email', type: 'email', active: false }] }, { name: 'team-b', integrations: [{ name: 'team-b-slack', type: 'slack', active: true }] }]); return; }
    if (path === '/api/v2/status') {
      sendJson(res, 200, { cluster: { name: 'am-1', status: 'ready', peers: [{ name: 'am-2', address: 'am-2:9094' }] }, versionInfo: { version: '0.27.0', branch: 'HEAD' } });
      return;
    }

    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  });

  return {
    requests,
    async start() { await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const addr = server.address(); return `http://${addr.address}:${addr.port}`; },
    async close() { await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))); },
  };
}