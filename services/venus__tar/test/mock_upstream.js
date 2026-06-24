import http from 'node:http';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';

export const USERNAME = 'admin';
export const PASSWORD = 'tar-password';
export const TOKEN = 'mock-token';
export const COOKIE = 'satoken=mock-cookie';

const collectBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) {
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

const jsonResponse = (res, status, payload, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(payload));
};

const textResponse = (res, status, body, headers = {}) => {
  res.writeHead(status, headers);
  res.end(body);
};

export function createMockServer({ username = USERNAME, password = PASSWORD } = {}) {
  const activeTokens = new Set();
  const activeCookies = new Set();
  const requests = [];
  let forceUnauthorized = false;
  let loginCount = 0;

  const isAuthenticated = (req) => {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const cookie = req.headers.cookie || '';
    return (token && activeTokens.has(token)) || (cookie && activeCookies.has(cookie));
  };

  const requireAuth = (req, res) => {
    if (forceUnauthorized) {
      forceUnauthorized = false;
      jsonResponse(res, 401, { code: 401, msg: 'expired' });
      return false;
    }
    if (!isAuthenticated(req)) {
      jsonResponse(res, 401, { code: 401, msg: 'missing auth' });
      return false;
    }
    return true;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    requests.push({ method: req.method, path: url.pathname, search: url.search, headers: req.headers });
    try {
      if (req.method === 'GET' && url.pathname === '/user/checkCode') {
        jsonResponse(res, 200, { codeKey: 'mock-code-key', codeValue: Buffer.from('1234').toString('base64') });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/user/login') {
        const body = await collectBody(req);
        loginCount += 1;
        if (body.logonName !== username || body.pwd !== password || body.checkCode !== '1234' || body.formState !== '1') {
          jsonResponse(res, 200, { code: -1, msg: 'invalid credentials' });
          return;
        }
        const token = `${TOKEN}-${loginCount}`;
        const cookie = `${COOKIE}-${loginCount}`;
        activeTokens.add(token);
        activeCookies.add(cookie);
        jsonResponse(res, 200, {
          tokenValue: token,
          tokenName: 'satoken',
          token,
          value: token,
          msg: 'login ok',
        }, { 'set-cookie': `${cookie}; Path=/` });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/user/logout') {
        requireAuth(req, res);
        jsonResponse(res, 200, { ok: true, msg: 'logout ok' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/user/info') {
        if (!requireAuth(req, res)) return;
        jsonResponse(res, 200, { userName: username, role: 'admin' });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/dashboard/overview') {
        if (!requireAuth(req, res)) return;
        jsonResponse(res, 200, { posture: 'stable' });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/dashboard/statistics/total') {
        if (!requireAuth(req, res)) return;
        jsonResponse(res, 200, 42);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/eventLog/detailPage') {
        if (!requireAuth(req, res)) return;
        const body = await collectBody(req);
        jsonResponse(res, 200, { records: [{ eventName: 'DGA', pageNum: body.pageNum }], total: 1 });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/asset/page') {
        if (!requireAuth(req, res)) return;
        jsonResponse(res, 200, { records: [{ assetName: 'web-01' }], total: 1 });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/asset/getAssetById') {
        if (!requireAuth(req, res)) return;
        const body = await collectBody(req);
        jsonResponse(res, 200, { id: body.id, assetName: 'web-01' });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/pcap/detail') {
        if (!requireAuth(req, res)) return;
        jsonResponse(res, 200, { pcapName: 'sample.pcap' });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/pcap/trackFlow') {
        if (!requireAuth(req, res)) return;
        jsonResponse(res, 200, { stream: 'GET / HTTP/1.1' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/binary') {
        if (!requireAuth(req, res)) return;
        textResponse(res, 200, 'pcap-bytes', { 'content-type': 'application/octet-stream' });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/echo') {
        if (!requireAuth(req, res)) return;
        const body = await collectBody(req);
        jsonResponse(res, 200, { query: Object.fromEntries(url.searchParams), body, header: req.headers['x-extra'] || '' });
        return;
      }

      jsonResponse(res, 404, { code: 404, msg: 'not found' });
    } catch (err) {
      jsonResponse(res, 500, { code: 500, msg: err.message });
    }
  });

  return {
    requests,
    get loginCount() {
      return loginCount;
    },
    expireNextRequest() {
      forceUnauthorized = true;
    },
    async start() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      return `http://${address.address}:${address.port}`;
    },
    async close() {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}
