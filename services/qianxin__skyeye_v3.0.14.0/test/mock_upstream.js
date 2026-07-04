import { createServer } from 'node:http';

const createMockServer = () => {
  const requests = [];
  let server;

  const handler = (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const params = Object.fromEntries(url.searchParams);
    requests.push({ method: req.method, path: url.pathname, params });

    // Auth endpoint: POST → access_token, GET → HTML with csrf-token + cookies
    if (url.pathname === '/skyeye/v1/admin/auth') {
      if (req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'sessionid=mock-session-id; Path=/' });
        res.end(JSON.stringify({ access_token: 'mock-access-token' }));
        return;
      }
      // GET with token → HTML with csrf-token + session cookie
      const token = url.searchParams.get('token');
      if (token) {
        res.writeHead(200, {
          'Content-Type': 'text/html',
          'Set-Cookie': ['sessionid=mock-session-id; Path=/', 'skyeye_session=mock-skyeye-session; Path=/'],
        });
        res.end('<html><head><meta name="csrf-token" content="a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"/></head><body>OK</body></html>');
        return;
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 400, message: 'token required' }));
      return;
    }

    // Legacy: check csrf_token in query params (backward compat)
    const csrfToken = url.searchParams.get('csrf_token');
    if (!csrfToken) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 401, message: 'csrf_token required', data: null }));
      return;
    }

    // Verify staff_name is present for alarm list
    if (url.pathname === '/skyeye/v1/alarm/alarm/list' && !url.searchParams.get('staff_name')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: { status: 400, message: 'staff_name required' } }));
      return;
    }

    let body;
    switch (url.pathname) {
      // Alarm list: status/message nested inside data (per real API)
      case '/skyeye/v1/alarm/alarm/list':
        body = {
          data: {
            items: [{
              id: '20200716_491cfaf5ab369d49238d4afd332a2824',
              alarm_sip: '239.238.57.59',
              attack_sip: '214.221.191.197',
              threat_name: 'SQL注入攻击',
              hazard_level: '高危',
              attack_stage: '入侵',
              status: '已处置',
              earliest_time: 1594886124000,
              latest_time: 1594886124000,
              repeat_count: 1,
            }],
            status: 1000,
            message: 'success',
            token: 'mock-token',
          },
        };
        break;
      // Packet: status/message at top level (per real API)
      case '/skyeye/v1/alarm/alarm/info/packet':
        body = {
          data: {
            items: [{
              sip: '192.168.227.1',
              sport: 51448,
              dip: '192.168.227.135',
              dport: 80,
              req_header: 'GET /test HTTP/1.1',
              req_body: '',
              rsp_header: 'HTTP/1.1 200 OK',
              rsp_body: 'OK',
            }],
          },
          status: 200,
          message: 'ok',
          token: 'mock-token',
        };
        break;
      // Pcap: status/message at top level (consistent with packet)
      case '/skyeye/v1/alarm/alarm/info/pcap/download':
        body = {
          data: 'base64-encoded-pcap-content',
          status: 1000,
          message: 'success',
          token: 'mock-token',
        };
        break;
      // Network log: doubly-nested data (per real API)
      case '/skyeye/v1/analysis/log-search/list':
        body = {
          data: {
            status: 1000,
            message: 'success',
            token: 'mock-token',
            data: {
              field_mapping: {},
              fields: ['sip', 'dip', 'sport', 'dport'],
              search: {
                hits: [{
                  _id: 'AW7Gm1WuER7uHLKN7a-U',
                  _index: 'skyeye-alarm_collection-2019.12.02',
                  _source: { sip: '10.0.0.1', dip: '10.0.0.2', sport: 12345, dport: 80 },
                  _type: 'skyeye-alarm_collection',
                }],
                total: 1,
              },
            },
          },
        };
        break;
      default:
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 404, message: 'not found', data: null }));
        return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  return new Promise((resolve) => {
    server = createServer(handler);
    server.listen(0, () => {
      const { port } = server.address();
      resolve({
        requests,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
};

export { createMockServer };
