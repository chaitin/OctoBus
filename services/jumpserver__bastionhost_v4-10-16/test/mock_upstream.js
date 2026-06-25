import http from 'node:http';

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

export const createMockServer = async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const parsedBody = body ? JSON.parse(body) : null;
      requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body: parsedBody });

      if (url.pathname === '/api/v1/authentication/auth/' && req.method === 'POST') {
        if (parsedBody?.username !== 'admin' || parsedBody?.password !== 'demo-password') {
          json(res, 401, { error: 'password_failed' });
          return;
        }
        json(res, 201, { token: 'login-token', keyword: 'Bearer' });
        return;
      }

      if (!['Bearer test-token', 'Bearer login-token'].includes(String(req.headers.authorization || ''))) {
        json(res, 401, { detail: 'Authentication credentials were not provided.' });
        return;
      }

      if (url.pathname === '/api/v1/assets/assets') {
        json(res, 200, {
          count: 1,
          next: null,
          previous: null,
          results: [{
            id: 'asset-1',
            name: 'linux-test',
            address: '192.0.2.10',
            platform: { label: 'Linux' },
            category: { label: 'Host' },
            type: { label: 'Server' },
            comment: 'test asset',
          }],
        });
        return;
      }

      if (url.pathname === '/api/v1/assets/assets/asset-1/' && req.method === 'GET') {
        json(res, 200, {
          id: 'asset-1',
          name: 'linux-test',
          address: '192.0.2.10',
          platform: { label: 'Linux' },
          category: { label: 'Host' },
          type: { label: 'Server' },
        });
        return;
      }

      if (url.pathname === '/api/v1/users/users') {
        json(res, 200, {
          count: 1,
          results: [{
            id: 'user-1',
            username: 'admin',
            name: 'Administrator',
            email: 'admin@example.com',
            system_roles: [{ display_name: 'System Admin' }],
            is_active: true,
          }],
        });
        return;
      }

      if (url.pathname === '/api/v1/terminal/sessions/') {
        json(res, 200, [{
          id: 'session-1',
          user: 'admin',
          asset: 'linux-test',
          account: 'root',
          protocol: 'ssh',
          remote_addr: '198.51.100.10',
          login_from: 'web',
          date_start: '2026/06/25 14:00:00 +0800',
        }]);
        return;
      }

      json(res, 404, { detail: 'not found' });
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};
