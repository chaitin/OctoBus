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

    if ((req.method === 'GET' || req.method === 'POST') && path === '/api/v1/query') {
      const q = fullUrl.searchParams.get('query') || '';
      if (!q) {
        sendJson(res, 400, { status: 'error', errorType: 'bad_data', error: 'query parameter is missing' });
        return;
      }
      if (q.includes('up')) {
        sendJson(res, 200, { status: 'success', data: { resultType: 'vector', result: [{ metric: { __name__: 'up', job: 'prometheus' }, value: [1625097600, '1'] }] } });
      } else {
        sendJson(res, 200, { status: 'success', data: { resultType: 'scalar', result: [1625097600, '42'] } });
      }
      return;
    }

    if (path === '/api/v1/query_range') {
      sendJson(res, 200, { status: 'success', data: { resultType: 'matrix', result: [{ metric: { __name__: 'up', job: 'prometheus' }, values: [[1625097600, '1'], [1625098500, '1']] }] } });
      return;
    }

    if (path === '/api/v1/targets') {
      sendJson(res, 200, { status: 'success', data: { activeTargets: [{ scrapePool: 'prometheus', scrapeUrl: 'http://localhost:9090/metrics', globalUrl: 'http://localhost:9090/metrics', lastError: '', lastScrape: '2026-01-01T00:00:00Z', lastScrapeDuration: 0.005, health: 'up', labels: { job: 'prometheus' } }], droppedTargets: [] } });
      return;
    }

    if (path === '/api/v1/rules') {
      sendJson(res, 200, { status: 'success', data: { groups: [{ name: 'test-group', file: 'rules.yml', interval: '30', limit: '0', evaluationTime: '0.001', lastEvaluation: '2026-01-01T00:00:00Z', rules: [{ state: 'firing', name: 'HighErrorRate', query: 'rate(errors[5m]) > 0.1', duration: '300', labels: { severity: 'critical' }, annotations: { summary: 'High error rate' }, health: 1 }] }] } });
      return;
    }

    if (path === '/api/v1/alerts') {
      sendJson(res, 200, { status: 'success', data: { alerts: [{ state: 'firing', activeAt: '2026-01-01T00:00:00Z', value: '0.5e', labels: { alertname: 'HighErrorRate', severity: 'critical' }, annotations: { summary: 'High error rate detected' } }] } });
      return;
    }

    if (path === '/api/v1/series') {
      sendJson(res, 200, { status: 'success', data: [{ __name__: 'up', job: 'prometheus', instance: 'localhost:9090' }] });
      return;
    }

    if (path === '/api/v1/status/config') {
      sendJson(res, 200, { status: 'success', data: { yaml: 'global:\n  scrape_interval: 15s\n' } });
      return;
    }

    if (path === '/api/v1/labels') {
      sendJson(res, 200, { status: 'success', data: ['__name__', 'job', 'instance', 'severity'] });
      return;
    }

    if (path.match(/^\/api\/v1\/label\/[^/]+\/values$/)) {
      const labelName = path.split('/')[3];
      sendJson(res, 200, { status: 'success', data: ['prometheus', 'node-exporter', 'alertmanager'] });
      return;
    }

    if (path === '/api/v1/status/buildinfo') {
      sendJson(res, 200, { status: 'success', data: { version: '3.0.1', revision: 'abc123', branch: 'HEAD', buildUser: 'root@builder', buildDate: '20260101-00:00:00', goVersion: 'go1.23.0' } });
      return;
    }

    if (path === '/api/v1/status/flags') {
      sendJson(res, 200, { status: 'success', data: { 'web.listen-address': '0.0.0.0:9090', 'storage.tsdb.path': '/prometheus' } });
      return;
    }

    if (path === '/api/v1/alertmanagers') {
      sendJson(res, 200, { status: 'success', data: { activeAlertmanagers: [{ url: 'http://am-1:9093' }, { url: 'http://am-2:9093' }], droppedAlertmanagers: [] } });
      return;
    }

    if (path === '/api/v1/scrape_pools') {
      sendJson(res, 200, { status: 'success', data: ['prometheus', 'node-exporter', 'alertmanagers'] });
      return;
    }

    if (path === '/api/v1/targets/metadata') {
      sendJson(res, 200, { status: 'success', data: [{ target: { scrapeJob: 'prometheus' }, type: 'gauge', help: 'Up', unit: '' }] });
      return;
    }

    if (path === '/api/v1/metadata') {
      sendJson(res, 200, { status: 'success', data: { up: [{ type: 'gauge', help: 'Up status', unit: '' }], 'prometheus_target_scrape_pool_targets': [{ type: 'gauge', help: 'Target count', unit: '' }] } });
      return;
    }

    res.writeHead(404); res.end(JSON.stringify({ status: 'error', error: 'not found' }));
  });

  return {
    requests,
    async start() { await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const addr = server.address(); return `http://${addr.address}:${addr.port}`; },
    async close() { await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))); },
  };
}