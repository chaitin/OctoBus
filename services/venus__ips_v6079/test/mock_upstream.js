import http from 'node:http';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';

export const USERNAME = 'admin';
export const PASSWORD = 'ips-password';
export const PASSWORD_SHA256 = createHash('sha256').update(PASSWORD, 'utf8').digest('hex');
export const TOKEN = 'mock-ips-token';
export const DEVICE_TYPE = 'SOC';

const collectBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

const parseJsonBody = async (req) => {
  const raw = await collectBody(req);
  if (raw.length === 0) return {};
  return JSON.parse(raw.toString('utf8'));
};

const jsonResponse = (res, status, payload, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(payload));
};

const binaryResponse = (res, status, payload, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/gzip', ...headers });
  res.end(payload);
};

export function createMockServer({ username = USERNAME, passwordSha256 = PASSWORD_SHA256 } = {}) {
  const activeTokens = new Set();
  const requests = [];
  const blockPolicies = new Map();
  const whitePolicies = new Map();
  let loginCount = 0;
  let forceUnauthorized = false;

  const isAuthenticated = (req) => {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : auth;
    return token && activeTokens.has(token) && req.headers['device-type'] === DEVICE_TYPE;
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
    const path = url.pathname;
    requests.push({ method: req.method, path, search: url.search, headers: req.headers });

    try {
      if (req.method === 'POST' && path === '/api/v3/login') {
        const body = await parseJsonBody(req);
        if (body.username !== username || body.password !== passwordSha256) {
          jsonResponse(res, 200, { code: 401, msg: 'bad credentials' });
          return;
        }
        loginCount += 1;
        const token = `${TOKEN}-${loginCount}`;
        activeTokens.add(token);
        jsonResponse(res, 200, { code: 0, msg: 'success', data: { authorization: token } });
        return;
      }

      if (!requireAuth(req, res)) return;

      if (req.method === 'GET' && path === '/api/v3/license') {
        jsonResponse(res, 200, { code: 0, msg: 'success', data: { license_list: [{ name: 'feature', enable: 2 }] } });
        return;
      }

      if (req.method === 'POST' && path === '/api/v3/license') {
        const body = await parseJsonBody(req);
        jsonResponse(res, 200, { code: 0, msg: 'success', data: { imported: body.license } });
        return;
      }

      if (req.method === 'GET' && path === '/api/v3/sys_resource_info') {
        jsonResponse(res, 200, { code: 0, msg: 'success', data: [{ device_type: 1, cpu_usage: '10' }] });
        return;
      }

      if (req.method === 'GET' && path === '/api/v3/software_status') {
        jsonResponse(res, 200, { code: 0, msg: 'success', data: { version: 'V6079', status: 1 } });
        return;
      }

      if (req.method === 'POST' && path === '/api/v3/system_operate') {
        const body = await parseJsonBody(req);
        jsonResponse(res, 200, { code: 0, msg: 'success', data: { operation: body.operation } });
        return;
      }

      if (req.method === 'GET' && path === '/api/v3/block_policy') {
        jsonResponse(res, 200, { code: 0, msg: 'success', data: { block_policy: Array.from(blockPolicies.values()) } });
        return;
      }

      if (req.method === 'POST' && path === '/api/v3/block_policy') {
        const body = await parseJsonBody(req);
        const id = `block-${blockPolicies.size + 1}_${body.type || 1}`;
        blockPolicies.set(id, { id, ...body });
        jsonResponse(res, 200, { code: 0, msg: 'success', data: { id } });
        return;
      }

      if (req.method === 'POST' && path === '/api/v3/block_policy/batch') {
        const body = await parseJsonBody(req);
        const items = Array.isArray(body) ? body : [];
        const ids = [];
        for (const item of items) {
          const id = `block-${blockPolicies.size + 1}_${item.type || 1}`;
          blockPolicies.set(id, { id, ...item });
          ids.push(id);
        }
        jsonResponse(res, 200, { code: 0, msg: 'success', data: { ids } });
        return;
      }

      if (req.method === 'DELETE' && path === '/api/v3/block_policy') {
        const body = await parseJsonBody(req);
        blockPolicies.delete(body.id);
        jsonResponse(res, 200, { code: 0, msg: 'success' });
        return;
      }

      if (req.method === 'GET' && path === '/api/v3/white_policy') {
        jsonResponse(res, 200, { code: 0, msg: 'success', data: { white_policy: Array.from(whitePolicies.values()) } });
        return;
      }

      if (req.method === 'POST' && path === '/api/v3/white_policy') {
        const body = await parseJsonBody(req);
        const id = `white-${whitePolicies.size + 1}_${body.type || 4}`;
        whitePolicies.set(id, { id, ...body });
        jsonResponse(res, 200, { code: 0, msg: 'success', data: { id } });
        return;
      }

      if (req.method === 'DELETE' && path === '/api/v3/white_policy') {
        const body = await parseJsonBody(req);
        whitePolicies.delete(body.id);
        jsonResponse(res, 200, { code: 0, msg: 'success' });
        return;
      }

      if (req.method === 'GET' && path === '/api/v3/backup_export') {
        binaryResponse(res, 200, Buffer.from('backup-bytes'));
        return;
      }

      if (req.method === 'POST' && path === '/api/v3/backup_import') {
        const raw = await collectBody(req);
        jsonResponse(res, 200, {
          code: 0,
          msg: 'success',
          data: {
            contentType: req.headers['content-type'],
            bodyContainsFileName: raw.toString('latin1').includes('backup.tgz'),
          },
        });
        return;
      }

      if (req.method === 'POST' && path === '/api/v3/echo') {
        const body = await parseJsonBody(req);
        jsonResponse(res, 200, { code: 0, msg: 'success', data: { query: Object.fromEntries(url.searchParams), body } });
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
