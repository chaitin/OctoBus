// Mock upstream for the AiLPHA platform /openapi API.
// For manual/integration runs: HTTP_PORT=18110 node test/mock_upstream.js
import http from 'node:http';

const httpPort = Number(process.env.HTTP_PORT || 18110);
const log = (...args) => console.log('[mock-ailpha]', ...args);

// seed alarms + linkage strategies
const alarms = [
  { baasAlarmUuid: 'uuid-1', aggCondition: 'agg-1', windowId: 'w-1', alarmName: ['恶意文件攻击'], threatSeverity: 'Medium', alarmStatus: 'unprocessed', srcAddress: ['110.170.147.50'], destAddress: ['114.242.248.81'], canDisposalTheAlarm: true },
];
const strategies = new Map([
  ['s1', { id: 's1', blockIp: '110.170.147.50', status: 'inactive', linkDevice: 'fw-1', effectTime: 0 }],
]);

const sendJson = (res, status, obj) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
};
const readBody = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => { const raw = Buffer.concat(chunks).toString(); resolve(raw ? JSON.parse(raw) : {}); });
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  if (!req.headers['apikey']) return sendJson(res, 401, {});

  if (p === '/openapi/v2.0/merge-alarms' && req.method === 'GET') {
    const page = Number(url.searchParams.get('$page')) || 1;
    const size = Number(url.searchParams.get('$size')) || 10;
    return sendJson(res, 200, { $page: page, $size: size, total: alarms.length, data: alarms, $orderBy: url.searchParams.get('$orderBy') || 'endTime desc' });
  }

  if (p === '/openapi/v1.0/merge-alarm/detail' && req.method === 'GET') {
    const agg = url.searchParams.get('aggCondition');
    const found = alarms.find((a) => a.aggCondition === agg);
    if (!found) return sendJson(res, 404, {});
    return sendJson(res, 200, found);
  }

  if (p === '/openapi/v2.0/merge-alarms/status' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.alarmStatus) return sendJson(res, 400, {});
    alarms.forEach((a) => { a.alarmStatus = body.alarmStatus; });
    return sendJson(res, 200, { $page: 0, $size: 0, data: '归并告警批量处置中' });
  }

  if (p === '/openapi/v1.0/linkage-strategies' && req.method === 'GET') {
    const list = Array.from(strategies.values());
    return sendJson(res, 200, { $page: 1, $size: 10, total: list.length, data: list });
  }

  const m = p.match(/^\/openapi\/v1\.0\/linkage-strategies\/([^/]+)\/(accessIp|blockIp)$/);
  if (m) {
    const ids = decodeURIComponent(m[1]).split(',');
    const action = m[2];
    const known = ids.filter((id) => strategies.has(id));
    if (known.length === 0) return sendJson(res, 404, {});
    if (action === 'accessIp' && req.method === 'POST') {
      known.forEach((id) => { strategies.get(id).status = 'active'; });
      return sendJson(res, 200, { $page: 0, $size: 0, data: '联动策略成功' });
    }
    if (action === 'blockIp' && req.method === 'DELETE') {
      known.forEach((id) => { strategies.get(id).status = 'inactive'; });
      return sendJson(res, 200, { $page: 0, $size: 0, data: '解除联动策略成功' });
    }
  }

  return sendJson(res, 404, {});
});

server.listen(httpPort, () => log(`listening on :${httpPort}`));
