/* node:coverage disable */
import http from 'node:http';
import { randomUUID } from 'node:crypto';

// 模拟 SecGate3600 V3.6.6.0 的 /v1.0/login、/v1.0/rest/、/v1.0/out 接口。
export const createMockServer = async ({ user = 'api_user', password = 'SuperSecret!' } = {}) => {
  const state = {
    sessions: new Map(),     // token -> { username }
    blacklist: new Map(),    // ip_start -> record
    requests: [],
  };

  const sendJson = (res, payload, status = 200, extraHeaders = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...extraHeaders });
    res.end(JSON.stringify(payload));
  };

  const readJsonBody = (req) =>
    new Promise((resolve, reject) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        if (!raw.trim()) { resolve(null); return; }
        try { resolve(JSON.parse(raw)); } catch (err) { reject(err); }
      });
      req.on('error', reject);
    });

  const parseCookieHeader = (headerValue) => {
    const out = {};
    for (const part of String(headerValue || '').split(';')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex <= 0) continue;
      out[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
    }
    return out;
  };

  const sessionFor = (req) => {
    const token = String(parseCookieHeader(req.headers?.cookie).token || '').trim();
    return token ? state.sessions.get(token) : null;
  };

  const restHead = (envelope, errorCode = 0, errorString = '执行成功', extra = {}) => ({
    module: envelope?.head?.module,
    function: envelope?.head?.function,
    error_code: errorCode,
    error_string: errorString,
    page_index: -1,
    page_size: -1,
    total: -1,
    ...extra,
  });

  const server = http.createServer((req, res) => {
    (async () => {
      const body = (await readJsonBody(req)) || {};
      state.requests.push({ method: req.method, url: req.url, body, headers: req.headers });

      if (req.method === 'POST' && req.url === '/v1.0/login') {
        const username = String(body?.username || '').trim();
        const reqPassword = String(body?.password || '').trim();
        if (username !== user || reqPassword !== password) {
          sendJson(res, { success: false, result: { error_code: 'auth_failed' } });
          return;
        }
        const token = randomUUID();
        state.sessions.set(token, { username });
        sendJson(res, { success: true, result: { error_code: 'success', token } }, 200, {
          'set-cookie': [`PHPSESSID=${randomUUID()};path=/`, `token=${token};path=/`],
        });
        return;
      }

      if (req.method === 'POST' && req.url === '/v1.0/rest/') {
        const session = sessionFor(req);
        if (!session) { sendJson(res, { head: { error_code: 1, error_string: 'unauthorized' } }, 401); return; }
        const envelope = Array.isArray(body) ? body[0] : body;
        const fn = envelope?.head?.function;
        const cp = envelope?.body?.addr_blacklist_cp || {};
        const items = Array.isArray(cp.blacklist_cp) ? cp.blacklist_cp : [];

        if (fn === 'add_blacklist_ip') {
          for (const item of items) {
            const ipStart = String(item?.ip_start || '').trim();
            if (!ipStart) { sendJson(res, { head: restHead(envelope, 2, '参数错误') }); return; }
            state.blacklist.set(ipStart, { ...item });
          }
          sendJson(res, { head: restHead(envelope), data: '' });
          return;
        }
        if (fn === 'del_blacklist_by_id') {
          for (const item of items) state.blacklist.delete(String(item?.ip_start || '').trim());
          sendJson(res, { head: restHead(envelope), data: '' });
          return;
        }
        if (fn === 'get_blacklist_config') {
          const key = String(cp.search_key || '').trim();
          const records = Array.from(state.blacklist.values())
            .filter((r) => !key || String(r.ip_start || '').includes(key));
          sendJson(res, { head: restHead(envelope, 0, '执行成功', { total: records.length }), data: records });
          return;
        }
        sendJson(res, { head: restHead(envelope, 3, 'unknown function') });
        return;
      }

      if (req.method === 'POST' && req.url === '/v1.0/out') {
        const token = String(parseCookieHeader(req.headers?.cookie).token || '').trim();
        if (token) state.sessions.delete(token);
        sendJson(res, { success: true });
        return;
      }

      sendJson(res, { error: 'not found' }, 404);
    })().catch((err) => {
      sendJson(res, { error: String(err?.message || err) }, 500);
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    state,
    host: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
};
