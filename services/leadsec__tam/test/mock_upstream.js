import http from 'node:http';

export const createMockUpstream = () => {
  const calls = [];
  const stored = {
    100: new Set(),
    200: new Set(),
  };

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url, 'http://127.0.0.1');
    calls.push({
      method: req.method,
      path: url.pathname,
      search: url.search,
      headers: req.headers,
      bodyText,
    });

    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'POST' && url.pathname === '/cnddos/v2.0/api/web_login/ddos') {
      send(200, {
        result: '0',
        message: {
          id: '1',
          username: 'admin',
          timeout_time: 30,
          token: 'mock-token',
        },
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/cnddos/v2.0/api/ip_bwlist/info') {
      const body = JSON.parse(bodyText);
      for (const ip of body.ipadd || []) stored[body.ipstate].add(ip);
      send(200, { result: '0', message: null });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/cnddos/v2.0/api/ip_bwlist/page_list') {
      const listType = Number(url.searchParams.get('listtype'));
      const condition = url.searchParams.get('condition') || '';
      const items = [...(stored[listType] || [])]
        .filter((ip) => !condition || ip.includes(condition))
        .map((ip) => ({
          ipadd: ip,
          ipstate: listType,
          ipdirection: 1,
          remark: 'OctoBus',
        }));
      send(200, { result: '0', count: items.length, message: items });
      return;
    }

    send(404, { result: '-1', message: 'not found' });
  });

  return {
    calls,
    start: () => new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        resolve(`http://127.0.0.1:${port}`);
      });
    }),
    stop: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
};
