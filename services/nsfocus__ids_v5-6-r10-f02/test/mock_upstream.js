/* node:coverage disable */
import http from 'node:http';

// 合成的 NSFOCUS IDS 事件表 HTML(结构与真机一致:id=mytable + tr.even/odd 行)。
// 使用文档保留地址段(198.51.100.x / 203.0.113.x / 192.0.2.x)，不含任何真实数据。
const ROWS = [
  { sev: '低危险程度', act: '允许', time: '2026-06-25 16:11:27', id: '40432', name: 'HTTP服务基本登录认证', sip: '198.51.100.10', sport: '54511', dip: '203.0.113.5', dport: '80', proxy: false },
  { sev: '中危险程度', act: '允许', time: '2026-06-25 15:42:25', id: '60249', name: 'HTTP OPTIONS方法', sip: '192.0.2.9', sport: '30879', dip: '203.0.113.8', dport: '80', proxy: true },
];

const proxyImg = '<img src="/stylesheet/nsfocus_2012/images/icon/dot_host.gif" title="代理IP">&nbsp;&nbsp;';

const row = (r, cls) => `<tr class="${cls}">`
  + `<td><img src="/x/d.gif" title="${r.sev}"><img src="/x/s.gif" title="${r.act}"><img src="/x/f.gif" title="反馈厂商" onclick='postFeedBackData("BASE64DATA","ipsAlert")'/></td>`
  + `<td>${r.time}</td>`
  + `<td><a href="javascript:void(0);" onclick="window.open('/help/event/id/${r.id}')">[${r.id}]&nbsp;${r.name}</a>`
  + `<a href='javascript:void(0);' onclick="add_except(${r.id},'${r.sip}','${r.dip}');return false;">添加例外</a></td>`
  + `<td>${r.proxy ? proxyImg : ''}${r.sip}:${r.sport}</td>`
  + `<td>${r.proxy ? proxyImg : ''}${r.dip}:${r.dport}</td>`
  + '<td></td><td></td></tr>';

const buildEventTable = () => `<table class="cmn_table" id="mytable">
<thead><tr class="first_title"><th>状态</th><th>时间</th><th>事件</th><th>源</th><th>目的</th><th>认证用户</th><th>关联账号</th></tr></thead>
${ROWS.map((r, i) => row(r, i % 2 === 0 ? 'even' : 'odd')).join('\n')}
</table>`;

const LOGIN_HTML = '<!DOCTYPE HTML><html><body><form name="login"></form></body></html>';

export const createMockServer = async ({ cookie = 'PHPSESSID=abc123' } = {}) => {
  const state = { requests: [] };
  const server = http.createServer((req, res) => {
    state.requests.push({ url: req.url, method: req.method, headers: req.headers });
    if (req.url !== '/ips/eventList/detail/false/dns/false' || req.method !== 'GET') {
      res.writeHead(404, { 'content-type': 'text/html' }); res.end('<html>not found</html>'); return;
    }
    const body = req.headers.cookie === cookie ? buildEventTable() : LOGIN_HTML;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    state,
    host: `http://127.0.0.1:${port}`,
    cookie,
    rowCount: ROWS.length,
    async close() { await new Promise((resolve) => server.close(resolve)); },
  };
};
