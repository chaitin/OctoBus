/* node:coverage disable */
import http from 'node:http';

export const createMockServer = async () => {
  const requests = [];

  const jsonResponse = (res, status, payload, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
    res.end(JSON.stringify(payload));
  };

  const textResponse = (res, status, body, headers = {}) => {
    res.writeHead(status, headers);
    res.end(body);
  };

  const parseBody = (req) =>
    new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          resolve({ raw: body });
        }
      });
    });

  const server = http.createServer((req, res) => {
    (async () => {
      const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      if (req.method === 'POST' && url.pathname === '/api.php/inter/Inter') {
        const body = await parseBody(req);
        const query = Object.fromEntries(url.searchParams);
        requests.push({ method: req.method, url: req.url, query, body, headers: req.headers });

        if (!req.headers['hy-bz-api-app-id'] || !req.headers['hy-bz-api-timestamp'] || !req.headers['hy-bz-api-signature']) {
          jsonResponse(res, 401, { code: 401, msg: 'missing signature headers' });
          return;
        }

        if (query.opt === 'addPatchblack2') {
          jsonResponse(res, 200, {
            code: 0,
            msg: 'ok',
            action: 'addPatchblack2',
            payload: body,
          });
          return;
        }

        if (query.opt === 'delblack2') {
          jsonResponse(res, 200, {
            code: 0,
            msg: 'ok',
            action: 'delblack2',
            payload: body,
          });
          return;
        }

        jsonResponse(res, 404, { code: 404, msg: 'unknown operation', opt: query.opt });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/plain-text') {
        requests.push({ method: req.method, url: req.url, headers: req.headers });
        textResponse(res, 200, 'plain-response');
        return;
      }

      jsonResponse(res, 404, { code: 404, msg: 'not found', path: url.pathname });
    })().catch((err) => {
      jsonResponse(res, 500, { code: 500, msg: err?.message || 'internal error' });
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    requests,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
};
