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

    if (req.method === 'GET' && path === '/api/organizations') {
      sendJson(res, 200, { data: [{ id: 'org1', name: 'default', identifier: 'default' }, { id: 'org2', name: 'staging', identifier: 'staging' }] });
      return;
    }

    if (req.method === 'GET' && path === '/api/default/streams') {
      sendJson(res, 200, { streams: [{ name: 'logs', stream_type: 'logs', created_at: '2026-01-01T00:00:00Z' }, { name: 'metrics', stream_type: 'metrics', created_at: '2026-01-02T00:00:00Z' }] });
      return;
    }

    if (req.method === 'GET' && path === '/api/default/streams/logs/schema') {
      sendJson(res, 200, { schema: [{ name: '@timestamp', type: 'timestamp' }, { name: 'message', type: 'text' }, { name: 'level', type: 'keyword' }] });
      return;
    }

    if (req.method === 'POST' && path === '/api/default/logs/_search') {
      sendJson(res, 200, { took: 5, total: 2, hits: [{ '@timestamp': '2026-01-01T00:00:00Z', message: 'hello', level: 'info' }, { '@timestamp': '2026-01-01T00:01:00Z', message: 'world', level: 'error' }], scan_size: '1KB' });
      return;
    }

    if (req.method === 'GET' && path === '/api/default/functions') {
      sendJson(res, 200, { data: [{ name: 'parse_logs', created_at: '2026-01-01T00:00:00Z' }, { name: 'enrich', created_at: '2026-01-02T00:00:00Z' }] });
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