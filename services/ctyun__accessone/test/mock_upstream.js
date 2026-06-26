/* node:coverage disable */
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { _test } from '../src/ctyun-accessone.js';

const { makeEopSignature } = _test;

// Verify EOP HMAC-SHA256 — regression guard for core signing algorithm
const verifyEopSignature = (authHeader, eopDate, requestId, bodyStr, ak, sk) => {
  const expected = makeEopSignature(ak, sk, eopDate, requestId, bodyStr);
  return authHeader === expected;
};

const TEST_AK = 'valid_ak';
const TEST_SK = 'valid_sk';

export const createMockServer = async (options = {}) => {
  const requests = [];
  const defaultPort = 0;
  const useHttps = options.https === true;
  const tlsKey = options.tls?.key;
  const tlsCert = options.tls?.cert;

  const sendJson = (res, status, payload) => {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    res.writeHead(status, { 'Content-Type': 'application/json', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  };

  const requestHandler = (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url || '/', 'http://localhost');
      const bodyStr = Buffer.concat(chunks).toString();
      let body;
      try { body = JSON.parse(bodyStr); } catch { body = {}; }

      requests.push({ method: req.method, path: url.pathname, body, query: Object.fromEntries(url.searchParams) });

      const auth = req.headers['eop-authorization'] || '';
      const eopDate = req.headers['eop-date'] || '';
      const requestId = req.headers['ctyun-eop-request-id'] || '';
      const isAuthed = auth.startsWith(`${TEST_AK} `) &&
        verifyEopSignature(auth, eopDate, requestId, bodyStr, TEST_AK, TEST_SK);
      const pathname = url.pathname;

      // ── 1. GET 域名列表 ──
      if (pathname === '/ctapi/v2/domain/query' && req.method === 'GET') {
        if (!isAuthed) { sendJson(res, 403, { code: 'AUTH_FAILED', message: 'auth failed' }); return; }
        sendJson(res, 200, { statusCode: 100000, message: 'ok', returnObj: { total: 2, total_count: 2, page: 1, page_count: 1, page_size: 50, result: [] } });
        return;
      }

      // POST-only from here
      if (req.method !== 'POST') {
        res.writeHead(405); res.end('method not allowed'); return;
      }

      // ── 2. 服务基本信息 ──
      if (pathname === '/ctapi/v1/sevice_detail') {
        if (!isAuthed) { sendJson(res, 403, { code: 'AUTH_FAILED', message: 'auth failed' }); return; }
        if (!body.product_code?.length) { sendJson(res, 400, { code: 'INVALID', message: 'product_code required' }); return; }
        sendJson(res, 200, { statusCode: 100000, message: 'ok', result: [{ product_code: body.product_code[0], status: 'active' }] });
        return;
      }

      // ── 3. 防护规则引擎总开关 ──
      if (pathname === '/ctapi/v1/domainRule/getDomainRuleAct') {
        if (!isAuthed) { sendJson(res, 403, { code: 'AUTH_FAILED', message: 'auth failed' }); return; }
        if (!body.domain) { sendJson(res, 400, { code: 'INVALID', message: 'domain required' }); return; }
        sendJson(res, 200, { statusCode: 100000, data: { domainRuleAct: 'ON', domain: body.domain } });
        return;
      }

      // ── 4. 防护规则引擎配置 ──
      if (pathname === '/ctapi/v1/domainRule/get') {
        if (!isAuthed) { sendJson(res, 403, { code: 'AUTH_FAILED', message: 'auth failed' }); return; }
        if (!body.domain) { sendJson(res, 400, { code: 'INVALID', message: 'domain required' }); return; }
        sendJson(res, 200, { statusCode: 100000, returnObj: { total: 918, results: [] } });
        return;
      }

      // ── 5. WAF 配置 ──
      if (pathname === '/ctapi/v1/scdn/domain/wafConfigQuery') {
        if (!isAuthed) { sendJson(res, 403, { code: 'AUTH_FAILED', message: 'auth failed' }); return; }
        if (!body.domain) { sendJson(res, 400, { code: 'INVALID', message: 'domain required' }); return; }
        sendJson(res, 200, { statusCode: 100000, data: { webProtectAct: 'ON', staticFile: ['.jpg', '.png'] } });
        return;
      }

      // ── 6. 访问控制总开关 ──
      if (pathname === '/ctapi/v1/scdn/domain/queryAccessControlAct') {
        if (!isAuthed) { sendJson(res, 403, { code: 'AUTH_FAILED', message: 'auth failed' }); return; }
        if (!body.domain) { sendJson(res, 400, { code: 'INVALID', message: 'domain required' }); return; }
        sendJson(res, 200, { code: '100000', data: { mod: 'ON' }, message: 'success' });
        return;
      }

      // ── 7. 新增访问控制规则 (写) ──
      if (pathname === '/ctapi/v1/scdn/domain/accessControlInsert') {
        if (!isAuthed) { sendJson(res, 403, { code: 'AUTH_FAILED', message: 'auth failed' }); return; }
        if (!body.domains?.length) { sendJson(res, 400, { code: 'INVALID', message: 'domains required' }); return; }
        if (!body.accessControlConfigs?.length) { sendJson(res, 400, { code: 'INVALID', message: 'accessControlConfigs required' }); return; }
        sendJson(res, 200, { code: '100000', data: [{ successIds: [99999], domain: body.domains[0] }], message: 'success' });
        return;
      }

      // ── 8. 更新访问控制域级开关 (写) ──
      if (pathname === '/ctapi/v1/scdn/domain/updateAccessControlAct') {
        if (!isAuthed) { sendJson(res, 403, { code: 'AUTH_FAILED', message: 'auth failed' }); return; }
        if (!body.domain) { sendJson(res, 400, { code: 'INVALID', message: 'domain required' }); return; }
        if (!body.mod || !['ON', 'CLOSE'].includes(body.mod)) { sendJson(res, 400, { code: 'INVALID', message: 'mod must be ON or CLOSE' }); return; }
        sendJson(res, 200, { code: '100000', data: { mod: body.mod }, message: 'success' });
        return;
      }

      // ── 9. 资源包列表 ──
      if (pathname === '/ctapi/v1/accessone/purchase/queryResourcePackages') {
        if (!isAuthed) { sendJson(res, 403, { code: 'AUTH_FAILED', message: 'auth failed' }); return; }
        sendJson(res, 200, { statusCode: 100000, message: 'ok', returnObj: {} });
        return;
      }

      // ── 10. IPv6检测不支持链接 ──
      if (pathname === '/ctapi/v1/ipv6/checkResult/getNoSupLink') {
        if (!isAuthed) { sendJson(res, 403, { code: 'AUTH_FAILED', message: 'auth failed' }); return; }
        if (!body.requestId) { sendJson(res, 400, { statusCode: 100001, error: 'CDN_SEC_200001', errorMessage: '请求参数校验失败', message: 'requestId is required' }); return; }
        sendJson(res, 200, {
          statusCode: 100000,
          message: 'success',
          returnObj: {
            noSupLinks: [
              { url: 'http://example.com/legacy', reason: '不支持IPv6协议' },
            ],
            total: 1,
          },
        });
        return;
      }

      res.writeHead(404); res.end('not found');
    });
  };

  const server = useHttps
    ? https.createServer({ key: tlsKey, cert: tlsCert }, requestHandler)
    : http.createServer(requestHandler);

  await new Promise((resolve) => server.listen(defaultPort, '127.0.0.1', resolve));
  const { port } = server.address();
  const scheme = useHttps ? 'https' : 'http';
  return {
    requests,
    url: `${scheme}://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
};
