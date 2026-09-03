/* node:coverage disable */
import http from 'node:http';

// 合成的 IPS 日志 HTML 页(结构与真机一致:<td title> 数据单元格 + ips_log_filter 标记),
// 使用文档保留地址段(198.51.100.x / 203.0.113.x),不含任何真实数据。
const FIELDS_ROWS = [
  ['TCP_可疑行为_安全风险_MYSQL_查询系统变量', '198.51.100.10', '60782', '203.0.113.5', '3883', 'TCP', '2026-06-25 17:49:45', '可疑行为', '中', '警示', 'PASS', '1', '3', ''],
  ['UDP_扫描_端口扫描', '198.51.100.11', '53', '203.0.113.6', '161', 'UDP', '2026-06-25 17:10:44', '扫描', '高', '严重', 'DROP', '2', '1', '备注X'],
];

const dataRow = (cells) =>
  `<tr><td>#</td>${cells.map((v) => `<td title="${v}">${v}</td>`).join('')}<td><a>操作</a></td></tr>`;

const buildLogHtml = () => `<!DOCTYPE HTML><html><head><title></title></head><body>
<form name="filter_form" method="post"><input type="hidden" name="module" value="ips_log_filter"></form>
<table class="data">
  <tr><th>#</th><th>名称</th><th>源IP</th><th>源端口</th><th>目的IP</th><th>目的端口</th><th>协议类型</th><th>时间</th><th>类型</th><th>事件级别</th><th>优先级</th><th>动作</th><th>策略ID</th><th>次数</th><th>内容</th><th>操作</th></tr>
  ${FIELDS_ROWS.map(dataRow).join('\n  ')}
</table></body></html>`;

// 登录页(无 ips_log_filter 标记),用于模拟会话失效后的 200 重定向。
const LOGIN_HTML = '<!DOCTYPE HTML><html><body><form name="login"><input name="user"></form></body></html>';

export const createMockServer = async ({ cookie = 'PHPSESSID=abc123' } = {}) => {
  const state = { requests: [] };

  const server = http.createServer((req, res) => {
    state.requests.push({ url: req.url, method: req.method, cookie: req.headers.cookie });
    if (req.url !== '/log/memorylog/ipslog.php' || req.method !== 'GET') {
      res.writeHead(404, { 'content-type': 'text/html' }); res.end('<html>not found</html>'); return;
    }
    // 未带正确 cookie -> 返回登录页(会话失效)
    const body = req.headers.cookie === cookie ? buildLogHtml() : LOGIN_HTML;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    state,
    host: `http://127.0.0.1:${port}`,
    cookie,
    rowCount: FIELDS_ROWS.length,
    async close() { await new Promise((resolve) => server.close(resolve)); },
  };
};
