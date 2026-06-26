import http from 'node:http';

export const createMockUpstream = () => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body });

    if (!url.searchParams.get('apikey') || !url.searchParams.get('timestamp') || !url.searchParams.get('sign')) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ responseCode: 403, verboseMsg: 'missing signature' }));
      return;
    }
    if (url.pathname === '/api/v3/globalBlacklist/create') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ responseCode: 0, verboseMsg: 'created', data: { id: 1 } }));
      return;
    }
    if (url.pathname === '/api/v3/globalBlacklist/list') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ responseCode: 0, verboseMsg: 'ok', data: { list: [] } }));
      return;
    }
    if (url.pathname === '/api/v3/httpBlacklist/enable') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ responseCode: 1001, verboseMsg: 'business failed' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ responseCode: 0, verboseMsg: 'ok', data: {} }));
  });

  return {
    requests,
    async start() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      return `http://127.0.0.1:${address.port}`;
    },
    async close() {
      await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    },
  };
};
