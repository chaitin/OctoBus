// Mock upstream server for 360 EPP local testing
// Simulates login and API responses

import http from 'http';
import crypto from 'crypto';

const PORT = process.env.MOCK_PORT || 0;
const RSA_KEY = crypto.generateKeyPairSync('rsa', {
  modulusLength: 1024,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
});

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        // URL encoded
        const params = new URLSearchParams(body);
        const obj = {};
        for (const [k, v] of params) obj[k] = v;
        resolve(obj);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  // GET /user/getPubKey
  if (url.pathname === '/user/getPubKey' && req.method === 'GET') {
    res.end(JSON.stringify({
      errno: 0,
      data: { pubkey: RSA_KEY.publicKey },
      errmsg: '成功',
      timestamp: Math.floor(Date.now() / 1000),
    }));
    return;
  }

  // POST /user/login
  if (url.pathname === '/user/login' && req.method === 'POST') {
    const body = await parseBody(req);
    const pwdHash = crypto.createHash('md5').update('Chaitin123..').digest('hex');

    if (body.username === 'eppadmin' && body.password === pwdHash) {
      res.setHeader('Set-Cookie', 'PN=mock_session_token_360_epp; Path=/; HttpOnly');
      res.end(JSON.stringify({
        errno: 0,
        data: null,
        errmsg: '成功',
        timestamp: Math.floor(Date.now() / 1000),
      }));
    } else {
      res.end(JSON.stringify({
        errno: 100,
        data: null,
        errmsg: '鉴权失败',
        timestamp: Math.floor(Date.now() / 1000),
      }));
    }
    return;
  }

  // GET /daping/general/info
  if (url.pathname === '/daping/general/info' && req.method === 'GET') {
    if (!req.headers.cookie?.includes('PN=')) {
      res.end(JSON.stringify({ errno: 10401, data: null, errmsg: '非法来源' }));
      return;
    }
    res.end(JSON.stringify({
      errno: 0,
      data: { terminal_count: 100, online_count: 85, virus_count: 5, leak_count: 12 },
      errmsg: '',
    }));
    return;
  }

  if (url.pathname === '/api/v2/terminal/list' && req.method === 'GET') {
    res.end(JSON.stringify({ errno: 0, data: { list: [{ id: 7, hostname: 'pc', ip: '10.0.0.7', groupName: 'g' }], total: 1 } }));
    return;
  }
  if (url.pathname === '/api/v2/terminal/detail' && req.method === 'GET') {
    res.end(JSON.stringify({ errno: 0, data: { id: 7, hostname: 'pc', osVersion: '11', groupName: 'g', lastOnlineTime: 'now' } }));
    return;
  }
  if (url.pathname === '/api/v2/terminal/hardware' && req.method === 'GET') {
    res.end(JSON.stringify({ errno: 0, data: { cpuModel: 'cpu', cpuCores: 8, memorySize: '16G', diskSize: '1T', gpuModel: 'gpu' } }));
    return;
  }

  // GET /alarmcenter/getloglist
  if (url.pathname === '/alarmcenter/getloglist' && req.method === 'GET') {
    if (!req.headers.cookie?.includes('PN=')) {
      res.end(JSON.stringify({ errno: 10401, data: null, errmsg: '非法来源' }));
      return;
    }
    res.end(JSON.stringify({
      errno: 0,
      data: {
        list: [
          { id: 1, type: 'virus', severity: 'high', title: '检测到恶意软件', terminal_name: 'PC-01', terminal_ip: '192.168.1.10', created_time: '2026-06-25 10:00:00', status: 'unhandled' },
        ],
        total: 1,
        statistics: { '0': 1, '1': 0, '2': 0, '-1': 0 },
      },
      errmsg: 'success',
    }));
    return;
  }

  // GET /daping/Virus/info
  if (url.pathname === '/daping/Virus/info' && req.method === 'GET') {
    if (!req.headers.cookie?.includes('PN=')) {
      res.end(JSON.stringify({ errno: 10401, data: null, errmsg: '非法来源' }));
      return;
    }
    res.end(JSON.stringify({
      errno: 0,
      data: { total_virus: 5, cleaned: 3, pending: 2 },
      errmsg: '',
    }));
    return;
  }

  // GET /daping/Leakfix/info
  if (url.pathname === '/daping/Leakfix/info' && req.method === 'GET') {
    if (!req.headers.cookie?.includes('PN=')) {
      res.end(JSON.stringify({ errno: 10401, data: null, errmsg: '非法来源' }));
      return;
    }
    res.end(JSON.stringify({
      errno: 0,
      data: { total_leaks: 12, fixed: 8, pending: 4 },
      errmsg: '',
    }));
    return;
  }

  // GET /user/isLogin
  if (url.pathname === '/user/isLogin' && req.method === 'GET') {
    const loggedIn = req.headers.cookie?.includes('PN=');
    res.end(JSON.stringify({
      errno: 0,
      data: { is_login: loggedIn, url: '', licalarm: [], auth_check: { alarm: false, alarmmsg: [] }, type: '' },
      errmsg: '成功',
    }));
    return;
  }

  // Default 404
  res.statusCode = 404;
  res.end(JSON.stringify({ errno: 404, errmsg: 'not found' }));
});

server.listen(PORT, () => {
  const addr = server.address();
  console.log(`Mock 360 EPP upstream listening on port ${addr.port}`);
  if (process.send) process.send({ port: addr.port });
});
