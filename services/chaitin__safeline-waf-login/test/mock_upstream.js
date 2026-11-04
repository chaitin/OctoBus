// Mock upstream for SafeLine WAF 控制台账号密码版。
// 模拟 Django CSRF + sessionid 会话认证流程：GET / 下发 csrftoken，POST /api/LoginAPI 下发 sessionid，
// 后续读接口用 Cookie: sessionid=... 鉴权。
import { createServer } from 'node:http';

const reply = (res, status, body, headers = {}) => {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(payload);
};

const cookieHeader = (name, value, extra = '') => {
  const base = `${name}=${value}; Path=/; HttpOnly`;
  return extra ? `${base}; ${extra}` : base;
};

export const createMockServer = async () => {
  const requests = [];
  let csrftoken = 'csrf-token-1';
  const sessionid = 'sessionid-abc123';
  const username = 'admin';
  const permissions = ['Audit Log Management', 'Attack Log Management'];

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const cookie = req.headers.cookie || '';
    const hasSession = cookie.includes(`sessionid=${sessionid}`);

    // 鉴权守卫：读接口必须带正确 sessionid
    const requireSession = () => {
      if (!hasSession) {
        reply(res, 200, { err: 'login-required', msg: 'login required', data: null });
        return false;
      }
      return true;
    };

    if (req.method === 'GET' && path === '/api/CSRFTokenAPI') {
      requests.push({ method: 'GET /api/CSRFTokenAPI', headers: req.headers });
      reply(res, 200, {}, { 'set-cookie': cookieHeader('csrftoken', csrftoken) });
      return;
    }

    if (req.method === 'POST' && path === '/api/LoginAPI') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        requests.push({ method: 'POST /api/LoginAPI', headers: req.headers, body });
        // 校验 CSRF（实现里 GET / 拿 csrftoken 后带 cookie + x-csrftoken）
        const csrfOk = (req.headers['x-csrftoken'] === csrftoken) && cookie.includes(`csrftoken=${csrftoken}`);
        if (body.password === 'bad') {
          reply(res, 200, { err: 'password-error', msg: 'username or password error', data: null });
          return;
        }
        reply(res, 200, {
          err: null,
          data: { id: 1, username: body.username, permissions, csrf_ok: csrfOk },
          msg: null,
        }, {
          'set-cookie': [
            cookieHeader('sessionid', sessionid, 'Max-Age=1209600; SameSite=Lax'),
            cookieHeader('csrftoken', 'csrf-token-2'),
          ],
        });
      });
      return;
    }

    if (req.method === 'GET' && path === '/api/ProfileAPI') {
      if (!requireSession()) return;
      requests.push({ method: 'GET /api/ProfileAPI', headers: req.headers });
      reply(res, 200, { err: null, msg: '', data: { id: 1, username, permissions } });
      return;
    }

    if (req.method === 'GET' && path === '/api/OverviewAPI') {
      if (!requireSession()) return;
      requests.push({ method: `GET /api/OverviewAPI`, query: Object.fromEntries(url.searchParams), headers: req.headers });
      reply(res, 200, {
        err: null, msg: '',
        data: { total: { request: 100, deny: 5, attack: 3 }, location: [], request_number: [], src_ip: [], attack_type: [], risk_level: [], host: [] },
      });
      return;
    }

    if (req.method === 'GET' && path === '/api/FilterV2API') {
      if (!requireSession()) return;
      requests.push({ method: 'GET /api/FilterV2API', query: Object.fromEntries(url.searchParams), headers: req.headers });
      reply(res, 200, {
        err: null, msg: '',
        data: { items: [{ event_id: 'evt-1', src_ip: '1.1.1.1', attack_type: 'sqli', risk_level_num: 3, action: 'block', timestamp: '2024-01-01T00:00:00Z' }], total: 1 },
      });
      return;
    }

    if (req.method === 'GET' && path === '/api/ESIndices') {
      if (!requireSession()) return;
      requests.push({ method: 'GET /api/ESIndices', query: Object.fromEntries(url.searchParams), headers: req.headers });
      reply(res, 200, {
        err: null, msg: '',
        data: { alias: url.searchParams.get('alias') || 'detect_log', indices: [{ index: 'detect_log-2024.01.01', creation_date: '1704067200000', docs_count: 42, health: 'green', status: 'open', store_size: '1kb' }], searchable_days: 30, saved_days: 90 },
      });
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    sessionid,
    username,
    permissions,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
};
