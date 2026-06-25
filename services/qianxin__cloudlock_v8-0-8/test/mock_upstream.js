/* node:coverage disable */
import http from 'node:http';

// 模拟云锁/椒图控制台:校验 token 头 + menuCode，返回 {"code":"1","msg":"成功","data":{list,total}}。
export const createMockServer = async ({ token = 'session-token-xyz' } = {}) => {
  const state = { requests: [] };

  const sendJson = (res, payload, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json;charset=UTF-8' });
    res.end(JSON.stringify(payload));
  };

  const readJsonBody = (req) =>
    new Promise((resolve) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => { try { resolve(raw.trim() ? JSON.parse(raw) : {}); } catch { resolve({}); } });
    });

  const server = http.createServer((req, res) => {
    (async () => {
      const body = await readJsonBody(req);
      state.requests.push({ url: req.url, body, headers: req.headers });
      if (req.url !== '/api/assetSrv/machineController/searchMachineList' || req.method !== 'POST') {
        sendJson(res, { code: '0', msg: 'not found' }, 404); return;
      }
      if (req.headers.token !== token) { sendJson(res, { code: '0', msg: '未登录' }, 401); return; }
      const list = [
        { id: 327, machineName: 'localhost.localdomain', ipv4: '198.51.100.20', operationSystem: 'Kylin Linux Advanced Server V10', onlineStatus: 1 },
      ];
      sendJson(res, { code: '1', msg: '成功', data: { list, total: list.length } });
    })().catch((err) => sendJson(res, { code: '0', msg: String(err?.message || err) }, 500));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    state,
    host: `http://127.0.0.1:${port}`,
    token,
    async close() { await new Promise((resolve) => server.close(resolve)); },
  };
};
