import http from 'node:http';
import { URL } from 'node:url';

/**
 * Creates a mock Alibaba Cloud OpenAPI endpoint on a random port.
 *
 * Trigger behavior (via action or parameter values):
 *   - action "FailAuth"        → 401 with InvalidAccessKeyId error
 *   - action "FailForbidden"   → 403 with Forbidden error
 *   - action "FailServer"      → 500 Internal Server Error
 *   - action "FailInvalidJson" → 200 with non-JSON body "not-json"
 *   - action "FailBizError"    → 200 with Code: "MissingParameter.NotFound"
 *   - param InstanceId "http500" → 500 for DescribeNetworkRules
 *   - param Domain "http400"   → 400 for EnableWebCC
 */
export function createMockServer() {
  const requests = [];

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ Code: 'MethodNotAllowed', Message: 'Only POST allowed' }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const action = params.get('Action') || '';
      const accessKeyId = params.get('AccessKeyId') || '';
      const signature = params.get('Signature') || '';
      const timestamp = params.get('Timestamp') || '';
      const instanceId = params.get('InstanceId') || '';
      const domain = params.get('Domain') || '';

      requests.push({ action, params: Object.fromEntries(params), timestamp });

      // Missing auth
      if (!accessKeyId || !signature) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          Code: 'InvalidAccessKeyId.NotFound',
          Message: 'Specified access key is not found.',
          RequestId: 'MOCK-REQ-001',
        }));
        return;
      }

      // Trigger: FailAuth action
      if (action === 'FailAuth') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          Code: 'InvalidAccessKeyId.NotFound',
          Message: 'Specified access key is not found.',
          RequestId: 'MOCK-REQ-002',
        }));
        return;
      }

      // Trigger: FailForbidden action
      if (action === 'FailForbidden') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          Code: 'Forbidden.NotAdminUser',
          Message: 'This operation is forbidden for your account.',
          RequestId: 'MOCK-REQ-003',
        }));
        return;
      }

      // Trigger: FailServer action
      if (action === 'FailServer') {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
        return;
      }

      // Trigger: FailInvalidJson action
      if (action === 'FailInvalidJson') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('not-json');
        return;
      }

      // Trigger: FailBizError action
      if (action === 'FailBizError') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          Code: 'MissingParameter.NotFound',
          Message: 'The required parameter is missing.',
          RequestId: 'MOCK-REQ-004',
        }));
        return;
      }

      // Trigger: http500 via InstanceId parameter
      if (instanceId === 'http500') {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
        return;
      }

      // Trigger: http400 via Domain parameter
      if (domain === 'http400') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          Code: 'InvalidParameter',
          Message: 'The parameter Domain is invalid.',
          RequestId: 'MOCK-REQ-005',
        }));
        return;
      }

      // Success responses per action
      switch (action) {
        case 'DescribeInstances':
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            Instances: [
              {
                InstanceId: instanceId || 'ddoscoo-cn-abc123',
                Ip: '1.2.3.4',
                IpMode: 'fnat',
                IpVersion: 'v4',
                Status: 1,
                Edition: 1,
                Enabled: 1,
                ExpireTime: 1735689600,
                CreateTime: 1609459200,
                Remark: 'test-instance',
                DebtStatus: 0,
              },
            ],
            TotalCount: 1,
            RequestId: 'MOCK-REQ-100',
          }));
          break;

        case 'DescribeDomainResource':
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            WebRules: [
              {
                Domain: domain || 'example.com',
                Cname: 'example.com.alikunlun.com',
                ProxyTypes: [{ ProxyType: 'http', ProxyPorts: [80] }],
                RealServers: ['10.0.0.1'],
                RsType: 0,
                InstanceIds: ['ddoscoo-cn-abc123'],
                PolicyMode: 'ip_hash',
                CcEnabled: true,
                CcTemplate: 'default',
                CcRuleEnabled: false,
                SslProtocols: 'TLSv1.2',
                Ssl13Enabled: false,
                Http2Enable: false,
                Http2HttpsEnable: false,
                Https2HttpEnable: false,
                OcspEnabled: false,
                WhiteList: [],
                BlackList: [],
                PunishStatus: false,
                ProxyEnabled: true,
              },
            ],
            TotalCount: 1,
            RequestId: 'MOCK-REQ-101',
          }));
          break;

        case 'DescribeNetworkRules':
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            NetworkRules: [
              {
                InstanceId: instanceId || 'ddoscoo-cn-abc123',
                Protocol: 'tcp',
                FrontendPort: 8080,
                BackendPort: 80,
                RealServers: ['10.0.0.1', '10.0.0.2'],
              },
            ],
            TotalCount: 1,
            RequestId: 'MOCK-REQ-102',
          }));
          break;

        case 'DescribeDDosAllEventList':
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            AttackEvents: [
              {
                EventType: 'defense',
                Ip: '1.2.3.4',
                Area: 'cn-hangzhou',
                StartTime: 1700000000,
                EndTime: 1700003600,
                Port: '80',
                Mbps: 50000,
                Pps: 10000000,
              },
            ],
            TotalCount: 1,
            RequestId: 'MOCK-REQ-103',
          }));
          break;

        case 'EnableWebCC':
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ RequestId: 'MOCK-REQ-104' }));
          break;

        case 'ConfigWebCCTemplate':
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ RequestId: 'MOCK-REQ-105' }));
          break;

        default:
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            Code: 'InvalidAction.NotFound',
            Message: `The specified action ${action} is not found.`,
            RequestId: 'MOCK-REQ-999',
          }));
      }
    });
  });

  server.listen(0);

  return {
    get url() {
      return `http://localhost:${server.address().port}`;
    },
    get requests() {
      return requests;
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
