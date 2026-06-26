/* node:coverage disable */
import http from 'node:http';

const readBody = (req) => new Promise((resolve, reject) => {
  let data = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    data += chunk;
  });
  req.on('end', () => resolve(data));
  req.on('error', reject);
});

export const createMockServer = async ({ expectedAppKey = 'test_app_key' } = {}) => {
  const requests = [];

  const sendJson = (res, status, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
    });
    res.end(body);
  };

  const server = http.createServer(async (req, res) => {
    const path = (req.url || '').split('?', 1)[0] || '';
    const rawBody = await readBody(req);
    let body = {};
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      sendJson(res, 400, { return_code: 1001, return_msg: 'invalid json', ver: '3.0' });
      return;
    }
    requests.push({ method: req.method, path, body, headers: req.headers });

    if (req.method !== 'POST' || path !== '/api/v3/ti') {
      res.writeHead(404);
      res.end('not found');
      return;
    }

    if (!body.c_appkey) {
      sendJson(res, 200, { return_code: 1001, return_msg: 'Nonce or Signature error.', ver: '3.0' });
      return;
    }
    if (body.c_appkey !== expectedAppKey) {
      sendJson(res, 200, { return_code: 1003, return_msg: 'Get appid of appkey error.', ver: '3.0' });
      return;
    }
    if (body.key === 'no-data') {
      sendJson(res, 200, { return_code: 1, return_msg: 'success, no data', ver: '3.0' });
      return;
    }
    if (body.key === 'quota') {
      sendJson(res, 200, { return_code: 1004, return_msg: 'quota exhausted', ver: '3.0' });
      return;
    }
    if (body.key === 'daily-limit') {
      sendJson(res, 200, { return_code: 1005, return_msg: 'daily limit exceeded', ver: '3.0' });
      return;
    }
    if (body.key === 'server-error') {
      sendJson(res, 200, { return_code: 1006, return_msg: 'internal error', ver: '3.0' });
      return;
    }
    if (body.key === 'http500') {
      sendJson(res, 500, { return_code: 1006, return_msg: 'http failure', ver: '3.0' });
      return;
    }
    if (body.key === 'invalid-json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('not-json');
      return;
    }

    sendJson(res, 200, {
      return_code: 0,
      return_msg: 'success',
      ver: body.c_version || '3.0',
      result: 'black',
      echo: {
        action: body.c_action,
        key: body.key || '',
        type: body.type || '',
        lang: body.c_lang || '',
        option: body.option ?? null,
      },
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    requests,
    url: `http://127.0.0.1:${port}/api/v3/ti`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
};
