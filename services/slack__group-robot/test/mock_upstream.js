import http from 'node:http';
import { URL } from 'node:url';

const HTTP_PORT = Number(process.env.HTTP_PORT || 19093);
const FAIL_RATE = Number(process.env.FAIL_RATE || 0);
const VERBOSE = process.env.LOG_VERBOSE === '1';

const log = (...args) => console.log('[slack-mock]', ...args);

const sendText = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'text/plain' });
  res.end(body);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('payload too large'));
      }
    });
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });

const shouldInjectError = () => FAIL_RATE > 0 && Math.random() * 100 < FAIL_RATE;

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST') {
    sendText(res, 405, 'Method Not Allowed');
    return;
  }

  const url = new URL(req.url || '/', `http://localhost:${HTTP_PORT}`);

  // Slack webhook paths look like /services/T.../B.../xxxx
  if (!url.pathname.startsWith('/services/')) {
    sendText(res, 404, 'not found');
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    sendText(res, 400, 'invalid_payload');
    return;
  }

  if (VERBOSE) {
    log('request', { method: req.method, path: url.pathname, body });
  }

  // Simulate invalid token
  if (url.pathname.includes('invalid-token')) {
    sendText(res, 404, 'invalid_token');
    return;
  }

  // Simulate rate limit
  if (url.pathname.includes('rate-limited')) {
    sendText(res, 429, 'rate_limited');
    return;
  }

  if (shouldInjectError()) {
    sendText(res, 500, 'server_error');
    return;
  }

  if (!body.text) {
    sendText(res, 400, 'invalid_payload');
    return;
  }

  sendText(res, 200, 'ok');
});

server.listen(HTTP_PORT, () => {
  log(`listening on http://127.0.0.1:${HTTP_PORT}`);
  log('fail rate:', FAIL_RATE);
});
