// Mock upstream for SecGate3600 sec_policy API.
// For manual/integration runs: HTTP_PORT=18120 node test/mock_upstream.js
import http from 'node:http';

const httpPort = Number(process.env.HTTP_PORT || 18120);
const log = (...args) => console.log('[mock-secgate]', ...args);

const policies = new Map([
  ['1', { name: '1', action: 'permit', state: 'enable', src_zone: 'any', dst_zone: 'any' }],
  ['2', { name: '2', action: 'deny', state: 'enable', src_zone: 'any', dst_zone: 'any' }],
]);
let order = ['1', '2'];

const send = (res, status, obj) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
};
const restOk = (res, fn, data, total = -1) => send(res, 200, {
  head: { module: 'sec_policy', function: fn, error_code: 0, error_string: '执行成功', page_index: 1, page_size: 20, total },
  data,
});
const readBody = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => { const raw = Buffer.concat(chunks).toString(); resolve(raw ? JSON.parse(raw) : undefined); });
});

const server = http.createServer(async (req, res) => {
  if (req.url === '/v1.0/login' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body?.username || !body?.password) return send(res, 200, { success: false, result: { error_code: 'auth_failed' } });
    res.setHeader('Set-Cookie', 'PHPSESSID=mockphpsess; path=/');
    return send(res, 200, { success: true, result: { error_code: 'success', username: body.username, token: 'mock-token-1' } });
  }

  if (req.url === '/v1.0/out' && req.method === 'POST') {
    return send(res, 200, { head: { error_code: 0, error_string: '执行成功' } });
  }

  if (req.url === '/v1.0/rest/' && req.method === 'POST') {
    if (!req.headers.cookie) return send(res, 401, { head: { error_code: 1, error_string: 'no session' } });
    const arr = await readBody(req);
    const entry = Array.isArray(arr) ? arr[0] : {};
    const fn = entry?.head?.function;
    const list = entry?.body?.sec_policy || [];

    if (fn === 'get_sec_policy') {
      const names = list.map((x) => x.name).filter((n) => n !== '');
      const data = order
        .filter((n) => names.length === 0 || names.includes(n))
        .map((n) => policies.get(n));
      return restOk(res, fn, data, data.length);
    }
    if (fn === 'set_sec_policy') {
      for (const p of list) {
        if (!policies.has(p.name)) order.push(p.name);
        policies.set(p.name, { ...policies.get(p.name), ...p });
      }
      return restOk(res, fn, true);
    }
    if (fn === 'set_move_sec_policy_pri') {
      for (const m of list) {
        order = order.filter((n) => n !== m.name);
        if (m.direct === 'top') order.unshift(m.name);
        else if (m.direct === 'end') order.push(m.name);
        else {
          const idx = order.indexOf(m.dst_name);
          const at = idx < 0 ? order.length : (m.direct === 'after' ? idx + 1 : idx);
          order.splice(at, 0, m.name);
        }
      }
      return restOk(res, fn, true);
    }
    return send(res, 200, { head: { error_code: 2, error_string: 'unknown function' }, data: null });
  }

  send(res, 404, { head: { error_code: 404, error_string: 'not found' } });
});

server.listen(httpPort, () => log(`listening on :${httpPort}`));
