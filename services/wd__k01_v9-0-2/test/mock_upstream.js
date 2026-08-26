/* node:coverage disable */
import http from 'node:http';
import { randomUUID } from 'node:crypto';

// 模拟网盾 K01 V9.0.2:登录/登出 + 攻击日志/IP名单/私有情报 查询与增删。
export const createMockServer = async ({ user = 'apiuser', password = 'ApiUser!2025' } = {}) => {
  const state = { tokens: new Set(), intel: new Map(), requests: [] };

  const sendJson = (res, payload, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  };

  const readJsonBody = (req) =>
    new Promise((resolve) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => { try { resolve(raw.trim() ? JSON.parse(raw) : {}); } catch { resolve({}); } });
    });

  const bearer = (req) => {
    const h = String(req.headers?.authorization || '');
    return h.startsWith('Bearer ') ? h.slice(7) : '';
  };

  const queryOk = (list) => ({
    data: { count: 10, page: 1, total: list.length, list },
    msg: '', msgType: 'success', showMsg: true, success: true,
  });

  const server = http.createServer((req, res) => {
    (async () => {
      const body = await readJsonBody(req);
      state.requests.push({ url: req.url, body, auth: bearer(req) });

      if (req.url === '/api/cms/user/login') {
        if (body.username !== user || body.password !== password) { sendJson(res, { error: 'bad creds', success: false }); return; }
        const token = randomUUID();
        state.tokens.add(token);
        sendJson(res, { success: true, status: true, msg: 'ok', token: { access_token: token, refresh_token: randomUUID() } });
        return;
      }
      if (req.url === '/api/cms/user/logout') { state.tokens.delete(bearer(req)); res.writeHead(200); res.end('logout ok'); return; }

      // 业务接口需带有效 token
      if (!state.tokens.has(bearer(req))) { sendJson(res, { msg: 'unauthorized' }, 401); return; }

      if (req.url === '/api/v1/logsystem/atkmntlog/query') {
        sendJson(res, queryOk([{ id: 1, r_sip: '8.8.8.8', r_dip: '10.0.0.1', info_type: 256 }]));
        return;
      }
      if (req.url === '/api/v1/security/iplist/query') {
        sendJson(res, queryOk([{ id: 7, ip: '1.1.11.9/32', comment: '', type: body.dir ?? 0 }]));
        return;
      }
      if (req.url === '/api/v1/threatintelligence/attack/query') {
        sendJson(res, queryOk(Array.from(state.intel.values())));
        return;
      }
      if (req.url === '/api/v1/threatintelligence/attack/save') {
        const id = state.intel.size + 1;
        state.intel.set(id, { id, ip: body.ip, info_type: body.type, score: body.severity });
        sendJson(res, { error_code: 0, id, msg: '添加成功', msgType: 'success', showMsg: true, success: true });
        return;
      }
      if (req.url === '/api/v1/threatintelligence/attack/delete') {
        state.intel.delete(Number(body.id));
        sendJson(res, { error_code: 0, id: Number(body.id), msg: '删除成功', msgType: 'success', showMsg: true, success: true });
        return;
      }
      sendJson(res, { msg: 'not found', success: false }, 404);
    })().catch((err) => sendJson(res, { msg: String(err?.message || err) }, 500));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    state,
    host: `http://127.0.0.1:${port}`,
    user,
    password,
    async close() { await new Promise((resolve) => server.close(resolve)); },
  };
};
