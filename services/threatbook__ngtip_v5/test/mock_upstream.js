/* node:coverage disable */
import http from 'node:http';
import crypto from 'node:crypto';

export const createMockServer = async () => {
  const requests = [];

  const sendJson = (res, status, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(status, { 'Content-Type': 'application/json', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  };

  const verifyToken = (query) => {
    const apikey = query.get('apikey');
    const timestamp = query.get('timestamp');
    const token = query.get('token');
    if (!timestamp || !token) return false;
    const expected = crypto.createHmac('sha1', 'test_salt').update(apikey + timestamp).digest('base64url');
    return token === expected;
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams) });

    const apikey = url.searchParams.get('apikey');
    const resource = url.searchParams.get('resource');

    if (!apikey) {
      sendJson(res, 401, { response_code: -1, verbose_msg: 'Missing apikey' });
      return;
    }
    if (apikey === 'invalid_key') {
      sendJson(res, 403, { response_code: -1, verbose_msg: 'Invalid apikey' });
      return;
    }

    if (url.pathname === '/tip_api/v5/ip') {
      if (!resource) { sendJson(res, 400, { response_code: -1, verbose_msg: 'Missing resource' }); return; }
      if (resource === '500.500.500.500') { sendJson(res, 500, { response_code: -1, verbose_msg: 'Internal server error' }); return; }
      if (resource === '1.1.1.1') { sendJson(res, 200, { response_code: 1001, verbose_msg: 'IP not found', data: [] }); return; }
      sendJson(res, 200, { response_code: 0, verbose_msg: 'Ok', data: [{ ioc: resource, intelligence: [{ severity: 'malicious', judgments: ['Botnet'] }] }] });
    } else if (url.pathname === '/tip_api/v5/dns') {
      if (!resource) { sendJson(res, 400, { response_code: -1, verbose_msg: 'Missing resource' }); return; }
      sendJson(res, 200, { response_code: 0, verbose_msg: 'Ok', data: [{ ioc: resource, intelligence: [{ severity: 'critical', judgments: ['C2'] }] }] });
    } else if (url.pathname === '/tip_api/v5/hash') {
      if (!resource) { sendJson(res, 400, { response_code: -1, verbose_msg: 'Missing resource' }); return; }
      sendJson(res, 200, { response_code: 0, verbose_msg: 'Ok', data: [{ ioc: resource, intelligence: [{ threat_level: 'malicious' }] }] });
    } else if (url.pathname === '/tip_api/v5/vuln') {
      const vuln_id = url.searchParams.get('vuln_id');
      if (vuln_id === 'CVE-9999-0000') { sendJson(res, 200, { response_code: 0, verbose_msg: 'Ok', data: { total_records: 1, items: [{ basic_info: { vuln_id } }] } }); return; }
      sendJson(res, 200, { response_code: 0, verbose_msg: 'Ok', data: { total_records: 0, items: [] } });
    } else if (url.pathname === '/tip_api/v5/location') {
      if (!resource) { sendJson(res, 400, { response_code: -1, verbose_msg: 'Missing resource' }); return; }
      sendJson(res, 200, { response_code: 0, verbose_msg: 'Ok', data: [{ ip: resource, location: { country: 'CN', province: 'Beijing' } }] });
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    requests,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    verifyToken,
  };
};
