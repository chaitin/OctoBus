import { createServer } from 'node:http';

const reply = (res, status, body, headers = {}) => {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(payload);
};

export const createMockServer = async () => {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      let rpc;
      try {
        rpc = JSON.parse(body);
      } catch {
        reply(res, 400, { error: 'invalid json' });
        return;
      }
      requests.push({ method: rpc.method, params: rpc.params?.[0] ?? {}, headers: req.headers });
      const params = rpc.params?.[0] ?? {};
      const resultFor = () => {
        switch (rpc.method) {
          case 'HeraAccountNoAuthService.Login':
            return { id: 'user-1', permissions: { alarm: true }, product_version: '25.05.001' };
          case 'HeraAccountNoAuthService.Logout': return { code: 0, msg: 'ok' };
          case 'AssetService.GetAgentGroups': return { code: 0, data: [{ agent_uuid: 'agent-1', name: 'probe' }] };
          case 'AlarmService.SearchAlarmList': return { code: 0, data: [{ id: 'alarm-1' }], total_count: 1 };
          case 'AlarmService.GetAlarm': return { code: 0, data: { id: params.id, level: 'high' } };
          case 'RulesService.SearchBlockRules': {
            if ((params.offset ?? 0) >= 200) return { code: 0, data: [{ id: 999, ips: '192.0.2.99:0', name: 'rule-999' }], total_count: 201 };
            const data = [{ id: 7, ips: '192.0.2.7:0', name: 'rule-7' }];
            while (data.length < 200) data.push({ id: 1000 + data.length, ips: '192.0.2.1:0', name: 'filler' });
            return { code: 0, data, total_count: 201 };
          }
          case 'RulesService.CreateBlockRules': return { code: 0, data: { id: 8 } };
          case 'RulesService.UpdateBlockRulesStatus':
          case 'RulesService.UpdateBlockRules': return { code: 0, msg: 'ok', data: {} };
          case 'FirewallService.SearchFirewall': return { code: 0, data: [{ id: 'fw-1' }] };
          case 'FirewallService.BatchCreateBlackList':
          case 'FirewallService.DeleteBlackList': return { code: 0, msg: 'ok', data: {} };
          case 'FirewallService.SearchBlackList': return { code: 0, data: [{ id: 'black-1' }], total_count: 1 };
          case 'OpsService.GetBaseInfo': return { code: 0, cpu: '10%', memory: '20%', disk: '30%', system_uptime: '1d' };
          case 'AssetService.GetAssetList': return { code: 0, data: [{ id: 'asset-1' }], total_count: 1 };
          default: return { code: 0, data: [] };
        }
      };
      reply(res, 200, { jsonrpc: '2.0', id: rpc.id, result: resultFor() },
        rpc.method === 'HeraAccountNoAuthService.Login' || rpc.method === 'AlarmService.GetAlarm'
          ? { 'set-cookie': ['sid=abc; Path=/; HttpOnly', 'csrf=xyz; Path=/'] }
          : {});
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
};
