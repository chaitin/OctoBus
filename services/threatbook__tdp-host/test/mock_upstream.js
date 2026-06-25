/* node:coverage disable */
import http from 'node:http';

// 模拟 TDP web 控制台 /api/web/host/getFallHostSumList 接口。
export const createMockServer = async ({ token = 'test_tdp_token' } = {}) => {
  const requests = [];

  const sendJson = (res, payload, status = 200) => {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(body);
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

  const buildItem = (id, machine) => ({
    id,
    machine,
    external_ip: '198.51.100.31',
    direction: 'lateral',
    threat: { name: 'sample-threat', type: 'tunneling', severity: 3, severity_desc: '高危', status_desc: '未处理' },
    geo_data: { Country: '局域网' },
  });

  const server = http.createServer((req, res) => {
    (async () => {
      const body = (await readJsonBody(req)) || {};
      requests.push({ method: req.method, url: req.url, body, headers: req.headers });

      if (req.method !== 'POST' || req.url !== '/api/web/host/getFallHostSumList') {
        sendJson(res, { error: 'not found' }, 404);
        return;
      }
      if (String(req.headers['tdp-authentication'] || '').trim() !== token) {
        sendJson(res, { response_code: 1, response_message: 'unauthorized' }, 401);
        return;
      }

      const keyword = String(body?.condition?.fuzzy?.keyword || '').trim();
      // 触发分支：keyword 控制返回条目数与异常路径。
      if (keyword === 'biz_error') { sendJson(res, { response_code: 5, response_message: 'invalid condition' }); return; }
      if (keyword === 'bad_json') { sendJson(res, 'NOT_JSON!'); return; }
      if (keyword === 'empty_body') { sendJson(res, ''); return; }

      const pageSize = Number(body?.page?.page_size) || 20;
      const count = keyword === 'none' ? 0 : Math.min(2, pageSize);
      const items = Array.from({ length: count }, (_, i) => buildItem(`ID${i}`, `198.51.100.${68 + i}`));
      sendJson(res, {
        response_code: 0,
        data: {
          items,
          page: {
            cur_page: Number(body?.page?.cur_page) || 1,
            page_size: pageSize,
            page_items_num: items.length,
            sort_by: body?.page?.sort_by || 'severity',
            sort_flag: body?.page?.sort_flag || 'desc',
          },
        },
      });
    })().catch((err) => sendJson(res, { error: String(err?.message || err) }, 500));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    requests,
    url: `http://127.0.0.1:${port}`,
    token,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
};
