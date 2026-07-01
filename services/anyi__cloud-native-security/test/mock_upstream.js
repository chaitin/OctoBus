import http from 'node:http';
import { URL } from 'node:url';

const HTTP_PORT = Number(process.env.HTTP_PORT || 19092);
const FAIL_RATE = Number(process.env.FAIL_RATE || 0);
const VERBOSE = process.env.LOG_VERBOSE === '1';

const log = (...args) => console.log('[diss-mock]', ...args);

const sendJson = (res, status, payload) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 1_000_000) reject(new Error('payload too large')); });
    req.on('end', () => { if (!raw.trim()) { resolve({}); return; } try { resolve(JSON.parse(raw)); } catch (err) { reject(err); } });
    req.on('error', reject);
  });

const shouldInjectError = () => FAIL_RATE > 0 && Math.random() * 100 < FAIL_RATE;

const mockData = {
  warnings: {
    code: 200, message: 'ok',
    data: { total: 2, items: [
      { Id: 1, Description: 'Suspicious process', Severity: 'high', ContainerName: 'web-app', HostName: 'node-1', CreateTime: 1700000000 },
      { Id: 2, Description: 'Privilege escalation', Severity: 'critical', ContainerName: 'db-app', HostName: 'node-2', CreateTime: 1700000001 },
    ] },
  },
  warningGroups: {
    code: 200, message: 'ok',
    data: { total: 1, items: [
      { Id: 10, Description: 'Grouped alerts', Amount: 5, EvtType: 'process', Severity: 'high' },
    ] },
  },
  vulnerabilities: {
    code: 200, message: 'ok',
    data: { total: 1, items: [
      { Id: 1, ImageName: 'nginx:latest', Severity: 'high', Target: 'nginx', Vulnerabilities: [{ CVEId: 'CVE-2024-0001', Severity: 'high' }] },
    ] },
  },
  hosts: {
    code: 200, message: 'ok',
    data: { total: 1, items: [
      { Id: 'host-1', HostName: 'node-1', IPv4: '10.0.0.1', AgentStatus: true },
    ] },
  },
  containers: {
    code: 200, message: 'ok',
    data: { total: 1, items: [
      { Id: 'ctr-1', Name: 'web-app', ImageName: 'nginx:latest', HostName: 'node-1' },
    ] },
  },
  clusters: {
    code: 200, message: 'ok',
    data: { total: 1, items: [
      { Id: 'cluster-1', Name: 'prod-cluster', Version: 'v1.28.0' },
    ] },
  },
  disposal: { code: 200, message: 'ok', data: null },
  containerControl: { code: 200, message: 'ok', data: null },
  unblockNetwork: { code: 200, message: 'ok', data: null },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${HTTP_PORT}`);
  const path = url.pathname;

  if (shouldInjectError()) {
    sendJson(res, 500, { code: 500, message: 'simulated server error', data: null });
    return;
  }

  let body;
  try { body = await readBody(req); } catch { sendJson(res, 400, { code: 400, message: 'invalid json', data: null }); return; }

  const authHeader = (req.headers['authorization'] || '').trim();
  if (!authHeader) {
    sendJson(res, 401, { code: 401, message: 'unauthorized', data: null });
    return;
  }
  const token = authHeader;
  if (token === 'invalid-token') {
    sendJson(res, 403, { code: 403, message: 'forbidden', data: null });
    return;
  }

  if (VERBOSE) log('request', { method: req.method, path, body });

  if (path === '/api/v1/securitylog/warninginfo' && req.method === 'POST') {
    sendJson(res, 200, mockData.warnings);
  } else if (path === '/api/v1/securitylog/warninginfogroup' && req.method === 'POST') {
    sendJson(res, 200, mockData.warningGroups);
  } else if (path === '/api/v1/securitylog/warninginfo/disposal' && req.method === 'POST') {
    if (!body.Action || !['isolation', 'pause', 'stop', 'kill'].includes(body.Action)) {
      sendJson(res, 400, { code: 400, message: 'invalid action', data: null });
    } else {
      sendJson(res, 200, mockData.disposal);
    }
  } else if (path === '/api/v1/securitylog/warninginfogroup/disposal' && req.method === 'POST') {
    if (!body.Action) {
      sendJson(res, 400, { code: 400, message: 'action required', data: null });
    } else {
      sendJson(res, 200, mockData.disposal);
    }
  } else if (path === '/api/v1/securitylog/vulnerabilitiesscan' && req.method === 'POST') {
    sendJson(res, 200, mockData.vulnerabilities);
  } else if (path === '/api/v1/asset/hosts/' && req.method === 'POST') {
    sendJson(res, 200, mockData.hosts);
  } else if (path === '/api/v1/containers/' && req.method === 'POST') {
    sendJson(res, 200, mockData.containers);
  } else if (path === '/api/v1/k8s/clusters' && req.method === 'POST') {
    sendJson(res, 200, mockData.clusters);
  } else if (path === '/api/v1/system/respcenter/operation' && req.method === 'POST') {
    if (!body.Action || !['resume', 'start', 'activate', 'deactivate'].includes(body.Action)) {
      sendJson(res, 400, { code: 400, message: 'invalid action', data: null });
    } else if (!body.ContainerId) {
      sendJson(res, 400, { code: 400, message: 'container_id required', data: null });
    } else {
      sendJson(res, 200, mockData.containerControl);
    }
  } else if (path === '/api/v1/system/respcenter/unblock-network' && req.method === 'POST') {
    if (!body.ContainerId) {
      sendJson(res, 400, { code: 400, message: 'container_id required', data: null });
    } else {
      sendJson(res, 200, mockData.unblockNetwork);
    }
  } else {
    sendJson(res, 404, { code: 404, message: 'not found', data: null });
  }
});

server.listen(HTTP_PORT, () => {
  log(`listening on http://127.0.0.1:${HTTP_PORT}`);
  log('fail rate:', FAIL_RATE);
});
