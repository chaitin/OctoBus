import http from 'node:http';

const routes = {
  '/async/login/token/': { success: true, token: 'mock-token-abc123' },
  '/async/newtask/add/': { success: true, taskall_id: 5, sys_task_id: 4, web_task_id: 9, alive_task_id: 8, ret_crack_task_id: 11 },
  '/async/control/': { success: true },
  '/async/status/': { success: true, status: 4, progress: 100, scheduletype: 0 },
  '/async/sysscan/query/': { success: true, status: 'completed', hostscount: 1, vulnscount: 5, vulhigh: 0, vulmedium: 1, vullow: 4, hosts: [] },
  '/async/tasklist/query/': { success: true, iTotalRecords: 2, aaData: [] },
  '/async/webscan/query/': { success: true, status: 'completed', hostscount: 1, total: 5, hosts: [] },
  '/async/crack/query/': { success: true, status: 'completed', hostscount: 1, total: 2, hosts: [] },
  '/async/device/status/': { success: true, 'CPU Load': '5%', 'Disk Usage': '10G/100G (10%)', 'Memory Usage': '4G/8G, 50%', System: '3.5.3-R1', engine: [] },
  '/async/ruletemplate/query/': { success: true, aaData: [{ id: 1, name: '全部漏洞扫描' }] },
};

export function startMockServer(port = 0) {
  const server = http.createServer((req, res) => {
    const body = routes[req.url] ?? { success: false, errorcode: 9999 };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}
