// Mock upstream for HFish attack IP, detail, account, and sys_info APIs
import http from 'node:http';

const httpPort = Number(process.env.HTTP_PORT || 18080);
const log = (...args) => console.log('[mock-hfish]', ...args);

const sampleAttackIPs = {
  response_code: 0,
  verbose_msg: '成功',
  data: {
    attack_ip: [
      {
        ip: '1.2.3.4',
        attack_count: 15,
        first_attack_time: '2026-01-01 00:00:00',
        last_attack_time: '2026-06-01 12:00:00',
        attack_types: ['SSH暴力破解', 'WEB扫描'],
        country: 'CN',
        province: 'Beijing',
        city: 'Beijing',
        group: 'default',
        comment: '',
        attack_chain_count: 3,
        port_count: 5,
        related_info_count: 2,
      },
      {
        ip: '5.6.7.8',
        attack_count: 3,
        first_attack_time: '2026-05-15 08:30:00',
        last_attack_time: '2026-06-10 14:20:00',
        attack_types: ['Redis未授权'],
        country: 'US',
        province: 'California',
        city: 'Los Angeles',
        group: 'default',
        comment: 'suspicious',
        attack_chain_count: 1,
        port_count: 2,
        related_info_count: 0,
      },
    ],
  },
};

const sampleAttackDetails = {
  response_code: 0,
  verbose_msg: '成功',
  data: {
    total_num: 2,
    page_no: 1,
    page_size: 20,
    total_page: 1,
    detail_list: [
      {
        id: 1,
        src_ip: '1.2.3.4',
        src_port: '54321',
        dest_ip: '192.168.1.1',
        dest_port: '22',
        protocol: 'TCP',
        type: 'SSH',
        app_name: 'SSH蜜罐',
        client_name: '内置节点',
        raw_data: 'ssh login attempt: root/admin123',
        country: 'CN',
        province: 'Beijing',
        city: 'Beijing',
        create_time: '2026-06-01 12:00:00',
        attack_chain: '',
        crawl_info: '',
        user_info: '',
      },
    ],
  },
};

const sampleAttackAccounts = {
  response_code: 0,
  verbose_msg: '成功',
  data: [
    {
      id: 1,
      ip: '1.2.3.4',
      account: 'root',
      password: 'admin123',
      type: 'SSH',
      create_time: '2026-06-01 12:00:00',
    },
    {
      id: 2,
      ip: '5.6.7.8',
      account: 'admin',
      password: 'redis123',
      type: 'REDIS',
      create_time: '2026-06-10 14:20:00',
    },
  ],
};

const sampleSystemInfo = {
  response_code: 0,
  verbose_msg: '成功',
  data: {
    total_honeypots: 7,
    total_cardinal_honeypots: 7,
    total_online_honeypots: 7,
    total_offline_honeypots: 0,
    honeypot_self_cnt: {
      'SSH|SSH蜜罐': 2,
      'REDIS|Redis蜜罐': 1,
      'WEB|WEB蜜罐': 3,
      'TCP|TCP端口监听': 1,
    },
    clients: [
      {
        name: '内置节点',
        ip: '172.17.0.2',
        create_time: 1782388598,
        honeypots: [
          { type: 'SSH', name: 'SSH蜜罐', state: 2 },
          { type: 'REDIS', name: 'Redis蜜罐', state: 2 },
        ],
      },
    ],
  },
};

const extractApiKey = (url) => {
  const parsed = new URL(url, 'http://localhost');
  return parsed.searchParams.get('api_key') || '';
};

const server = http.createServer((req, res) => {
  const url = req.url || '';
  const method = req.method || 'GET';
  const apiKey = extractApiKey(url);

  const sendJson = (data, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  const sendUnauthorized = () => {
    sendJson({ response_code: 1003, verbose_msg: '认证失败, 详情: illegal apikey' });
  };

  if (url.includes('/api/v1/hfish/sys_info') && method === 'GET') {
    if (!apiKey) { sendUnauthorized(); return; }
    log('sys_info request');
    sendJson(sampleSystemInfo);
    return;
  }

  if (url.includes('/api/v1/attack/ip') && method === 'POST') {
    if (!apiKey) { sendUnauthorized(); return; }
    log('attack/ip request');
    sendJson(sampleAttackIPs);
    return;
  }

  if (url.includes('/api/v1/attack/detail') && method === 'POST') {
    if (!apiKey) { sendUnauthorized(); return; }
    log('attack/detail request');
    sendJson(sampleAttackDetails);
    return;
  }

  if (url.includes('/api/v1/attack/account') && method === 'POST') {
    if (!apiKey) { sendUnauthorized(); return; }
    log('attack/account request');
    sendJson(sampleAttackAccounts);
    return;
  }

  log('unknown route', method, url);
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

server.listen(httpPort, () =>
  log(`listening on :${httpPort} (GET /api/v1/hfish/sys_info, POST /api/v1/attack/{ip,detail,account})`)
);
