/**
 * Mock 瑞数动态防护设备
 *
 * 用于单元测试，模拟设备的 REST API 行为。
 * 支持所有 API 端点，返回符合文档规范的响应格式。
 */

import http from 'node:http';

const DEFAULT_PORT = 20167;

export class MockRuishuDevice {
  constructor(port = DEFAULT_PORT) {
    this.port = port;
    this.server = null;

    // 内部状态
    this._blacklistEnabled = 'off';
    this._blacklist = [];
    this._protectedSites = [];
    this._nextSiteId = 0;
    this._editorEnabled = 'off';
    this._rules = {};
    this._apis = [];
    this._nextApiId = 0;

    // 配置的 token（用于验证）
    this.validTokenId = 'api_admin';
    this.validTokenValue = 'test-token-value';
  }

  /**
   * 启动 Mock 服务器
   */
  async start() {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        this._handleRequest(req, res);
      });
      this.server.listen(this.port, '127.0.0.1', () => {
        const address = this.server.address();
        this.port = typeof address === 'object' && address ? address.port : this.port;
        resolve(this.port);
      });
    });
  }

  /**
   * 停止 Mock 服务器
   */
  async stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  /**
   * 获取 base URL
   */
  get baseUrl() {
    return `http://127.0.0.1:${this.port}`;
  }

  // ============================================================
  // 请求处理
  // ============================================================

  _handleRequest(req, res) {
    const url = new URL(req.url, `http://127.0.0.1:${this.port}`);
    const path = url.pathname;
    const method = req.method.toUpperCase();

    // 收集 body
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let jsonBody = {};
      if (body) {
        try { jsonBody = JSON.parse(body); } catch {}
      }

      try {
        const result = this._route(method, path, jsonBody, Object.fromEntries(url.searchParams));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ err_no: 5, err_msg: err.message }));
      }
    });
  }

  _route(method, path, body, query) {
    const routes = {
      // IP 黑名单
      'GET:/api/v1/ip_black_list/switch': () => ({ err_no: 0, value: this._blacklistEnabled }),
      'POST:/api/v1/ip_black_list/switch': () => {
        this._blacklistEnabled = body.value;
        return { err_no: 0, err_msg: 'Success' };
      },
      'GET:/api/v1/ip_black_list': () => ({ err_no: 0, items: [...this._blacklist] }),
      'POST:/api/v1/ip_black_list': () => {
        this._blacklist = [...(body.items || [])].filter(Boolean);
        return { err_no: 0, err_msg: 'Success' };
      },
      'PUT:/api/v1/ip_black_list': () => {
        const before = this._blacklist.length;
        const valid = (body.items || []).filter(ip => /^[\d.:/]+$/.test(ip));
        const invalid = (body.items || []).filter(ip => !/^[\d.:/]+$/.test(ip));
        this._blacklist = [...this._blacklist, ...valid];
        return { err_no: 0, added_number: valid.length, total_number: this._blacklist.length, invalid_ip: invalid };
      },
      'DELETE:/api/v1/ip_black_list': () => {
        this._blacklist = [];
        return { err_no: 0, err_msg: 'Success' };
      },

      // 保护站点
      'GET:/api/v1/protected_sites': () => {
        if (path.includes('/api/v1/protected_sites/') && path.split('/').length > 4) {
          const id = decodeURIComponent(path.split('/api/v1/protected_sites/')[1]);
          const site = this._protectedSites.find(s => s.id === id);
          if (!site) return { err_no: 0, err_msg: 'Success', ...site };
          return { err_no: 0, ...site };
        }
        return {
          err_no: 0,
          sites: this._protectedSites.map(s => ({
            id: s.id, protocol: s.protocol, port: s.port, type: s.type,
            site: s.site, name: s.name || '', protection_mode: s.protection_mode,
            waf_strategy: s.waf_strategy || { enable: false, monitor_only: false, type: 'basic' }
          }))
        };
      },
      'POST:/api/v1/protected_sites': () => {
        const id = `${body.site}_${body.port}`;
        const site = { ...body, id, created_at: Date.now() };
        this._protectedSites.push(site);
        return { err_no: 0, id };
      },
      'PUT:/api/v1/protected_sites': () => {
        if (path.includes('/api/v1/batch_protected_sites')) {
          return { err_no: 0, err_msg: 'Success' };
        }
        const id = decodeURIComponent(path.split('/api/v1/protected_sites/')[1]);
        const idx = this._protectedSites.findIndex(s => s.id === id);
        if (idx >= 0) {
          this._protectedSites[idx] = { ...this._protectedSites[idx], ...body };
        }
        return { err_no: 0, err_msg: 'Success' };
      },
      'DELETE:/api/v1/protected_sites': () => {
        const id = decodeURIComponent(path.split('/api/v1/protected_sites/')[1]);
        this._protectedSites = this._protectedSites.filter(s => s.id !== id);
        return { err_no: 0, err_msg: 'Success' };
      },

      // 集群
      'GET:/api/v1/rcm/sso_token': () => ({
        err_no: 0, url: `https://webconsole/sso?token=mock-${Date.now()}`
      }),
      'GET:/api/v1/rcm/cluster_info': () => ({
        err_no: 0,
        pre_version: 'RAS_19.01',
        product_type: 'Botgate',
        cluster_name: 'mock-cluster',
        nodes: {
          '10.0.0.1': { status: 'online', version: 'RAS_20.01', role: ['api_gateway', 'master_server'] },
          '10.0.0.2': { status: 'online', version: 'RAS_20.01', role: ['proxy'] }
        }
      }),
      'POST:/api/v1/rcm/upgrade': () => ({ err_no: 0, err_msg: 'Success' }),
      'GET:/api/v1/rcm/rollback': () => ({ err_no: 0, err_msg: 'Success' }),

      // 可编程对抗
      'GET:/api/v1/ubbv2/manual_rule/switch': () => ({ err_no: 0, status: this._editorEnabled }),
      'POST:/api/v1/ubbv2/manual_rule/switch': () => {
        this._editorEnabled = body.status;
        return { err_no: 0, err_msg: 'Success' };
      },
      'POST:/api/v1/ubbv2/manual_rule/web': () => ({ err_no: 0, err_msg: 'Success' }),
      'POST:/api/v1/ubbv2/manual_rule/app': () => ({ err_no: 0, err_msg: 'Success' }),
      'GET:/api/v1/ubbv2/rule/switch': () => {
        const ruleId = query.id || body.id;
        return { err_no: 0, status: this._rules[ruleId] || 'off' };
      },
      'POST:/api/v1/ubbv2/rule/switch': () => {
        this._rules[body.id] = body.status;
        return { err_no: 0, err_msg: 'Success' };
      },
      'POST:/api/v1/ubbv2/resource_file': () => ({ err_no: 0, err_msg: 'Success' }),

      // API 资产
      'GET:/api/v1/abd/api': () => ({
        err_no: 0,
        api_list: this._apis.map(api => ({
          ...api,
          update_time: api.update_time || Math.floor(Date.now() / 1000)
        }))
      }),
      'POST:/api/v1/abd/api': () => {
        if (path.includes('api_online')) {
          return { err_no: 0, err_msg: 'Success' };
        }
        const api = { ...body, id: String(++this._nextApiId) };
        this._apis.push(api);
        return { err_no: 0, err_msg: 'Success' };
      },
      'DELETE:/api/v1/abd/api': () => {
        this._apis = this._apis.filter(a => a.id !== query.api_id && a.id !== body.api_id);
        return { err_no: 0, err_msg: 'Success' };
      },
      'PUT:/api/v1/abd/ignore_api': () => ({ err_no: 0, err_msg: 'Success' }),
      'POST:/api/v1/abd/api_online': () => {
        const api = this._apis.find(a => a.id === body.id);
        if (api) api.online_status = body.status === 'on';
        return { err_no: 0, err_msg: 'Success' };
      },
    };

    // 精确匹配
    const key = `${method}:${path}`;
    if (routes[key]) return routes[key]();

    // 路径前缀匹配（保护站点 CRUD 和 batch 操作）
    if (method === 'GET' && path.startsWith('/api/v1/protected_sites/'))
      return routes['GET:/api/v1/protected_sites']();
    if (method === 'PUT' && path.startsWith('/api/v1/protected_sites/') && !path.includes('batch'))
      return routes['PUT:/api/v1/protected_sites']();
    if (method === 'DELETE' && path.startsWith('/api/v1/protected_sites/'))
      return routes['DELETE:/api/v1/protected_sites']();
    if (method === 'PUT' && path === '/api/v1/batch_protected_sites')
      return routes['PUT:/api/v1/protected_sites']();

    return { err_no: 1, err_msg: `Route not found: ${method} ${path}` };
  }
}
