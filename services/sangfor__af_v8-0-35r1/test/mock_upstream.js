/* node:coverage disable */
import http from 'node:http';

const DEFAULT_ENTRIES = [
  { url: '8.8.0.1', type: 'WHITE', enable: true, domain: 0, isDefault: false, description: 'csspIp', createTime: '2026-06-25 19:04:47' },
  { url: 'device.scloud.sangfor.com', type: 'WHITE', enable: true, domain: 1, isDefault: true, description: 'device.scloud.sangfor.com', createTime: '2011-07-01 08:30:00' },
];

export const createMockServer = async ({ username = 'api_user', password = 'SuperSecret!' } = {}) => {
  const state = {
    tokenSeq: 0,
    validTokens: new Set(),
    requests: [],
    entries: DEFAULT_ENTRIES.map((entry) => ({ ...entry })),
    expireNextBusinessRequest: false,
    nextErrorCode: null,
  };

  const sendJson = (res, payload, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  };

  const readJsonBody = (req) => new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      if (!raw.trim()) return resolve(null);
      try { resolve(JSON.parse(raw)); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });

  const cookieToken = (req) => {
    const cookie = String(req.headers.cookie || '');
    const match = cookie.match(/(?:^|;\s*)token=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  };

  const requireSession = (req, res) => {
    if (state.nextErrorCode != null) {
      const code = state.nextErrorCode;
      state.nextErrorCode = null;
      sendJson(res, { code, message: `forced ${code}`, data: '' });
      return false;
    }
    if (state.expireNextBusinessRequest) {
      state.expireNextBusinessRequest = false;
      sendJson(res, { code: 1003, message: '未登陆', data: '' });
      return false;
    }
    const token = cookieToken(req);
    if (!state.validTokens.has(token)) {
      sendJson(res, { code: 1003, message: '未登陆', data: '' });
      return false;
    }
    return true;
  };

  const normalizeType = (value) => String(value || '').toUpperCase();

  const server = http.createServer((req, res) => {
    (async () => {
      const parsed = new URL(req.url, 'http://127.0.0.1');
      const body = await readJsonBody(req);
      state.requests.push({ method: req.method, url: req.url, pathname: parsed.pathname, searchParams: Object.fromEntries(parsed.searchParams), body, headers: req.headers });

      if (req.method === 'POST' && parsed.pathname === '/api/v1/namespaces/public/login') {
        if (body?.name !== username || body?.password !== password) {
          sendJson(res, { code: 1, message: '密码或用户名错误', data: '' });
          return;
        }
        const token = `token-${++state.tokenSeq}`;
        state.validTokens.add(token);
        sendJson(res, { code: 0, message: '成功', data: { name: username, loginResult: { token }, role: 'COMMON' } });
        return;
      }

      if (parsed.pathname === '/api/v1/namespaces/public/whiteblacklist') {
        if (!requireSession(req, res)) return;
        if (req.method === 'GET') {
          const type = normalizeType(parsed.searchParams.get('type'));
          const start = Number(parsed.searchParams.get('_start') || 0);
          const length = Number(parsed.searchParams.get('_length') || 100);
          const items = state.entries.filter((entry) => !type || entry.type === type);
          const pageItems = items.slice(start, start + length);
          sendJson(res, { code: 0, message: '成功', data: { itemsOffset: start, items: pageItems, totalItems: items.length, pageNumber: 0, totalPages: Math.ceil(items.length / length), pageSize: length, itemLength: pageItems.length } });
          return;
        }
        if (req.method === 'POST') {
          const entry = { url: String(body?.url || ''), type: normalizeType(body?.type), enable: body?.enable !== false, domain: 0, isDefault: false, description: String(body?.description || ''), createTime: '2026-07-03 00:00:00' };
          state.entries = state.entries.filter((item) => !(item.url === entry.url && item.type === entry.type));
          state.entries.push(entry);
          sendJson(res, { code: 0, message: '成功', data: entry });
          return;
        }
      }

      const match = parsed.pathname.match(/^\/api\/v1\/namespaces\/public\/whiteblacklist\/(.+)$/);
      if (match) {
        if (!requireSession(req, res)) return;
        const url = decodeURIComponent(match[1]);
        const type = normalizeType(parsed.searchParams.get('type'));
        const index = state.entries.findIndex((entry) => entry.url === url && (!type || entry.type === type));
        if (req.method === 'GET') {
          if (index < 0) return sendJson(res, { code: 1004, message: '对象不存在', data: '' });
          sendJson(res, { code: 0, message: '成功', data: state.entries[index] });
          return;
        }
        if (req.method === 'DELETE') {
          if (index < 0) return sendJson(res, { code: 1004, message: '对象不存在', data: '' });
          const [removed] = state.entries.splice(index, 1);
          sendJson(res, { code: 0, message: '成功', data: removed });
          return;
        }
      }

      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
    })().catch((err) => sendJson(res, { code: 1007, message: err?.message || 'internal error', data: '' }, 500));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    state,
    requests: state.requests,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
};
