import http from 'node:http';

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

export const startMockUpstream = () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (!req.headers.authorization) {
        json(res, 401, { success: false, msg: 'auth_failed', code: 'e8000' });
        return;
      }
      if (req.url?.startsWith('/api/tamperresistance/tamperresistanceforweb/paginate')) {
        json(res, 200, { success: true, totalAmount: 0, data: [] });
        return;
      }
      if (req.url?.startsWith('/api/intrusionprevention/intrusionlog/count')) {
        json(res, 200, { success: true, msg: 'success', count: 0 });
        return;
      }
      json(res, 200, { success: true, msg: 'success' });
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        requests,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
};
