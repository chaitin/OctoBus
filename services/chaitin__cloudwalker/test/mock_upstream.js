/**
 * Standalone mock upstream server for CloudWalker service integration tests.
 *
 * Covers:
 * - one success response per endpoint
 * - one 401 auth failure
 * - one 403 permission denied
 * - one 404 not found
 * - one 400 bad request
 * - one 429 rate limited
 * - one 500 upstream error
 * - one timeout simulation (delayed response)
 *
 * Usage:
 *   node test/mock_upstream.js [port]
 *
 * Defaults to port 18080.
 */

import http from 'node:http';

const PORT = parseInt(process.argv[2] || '18080', 10);

const sampleCluster = {
  id: '1',
  name: 'mock-cluster',
  status: 1,
  api_version: 'v1.21.4',
  master_ips: ['10.0.0.1'],
  module_status: [{ version: 'v1.0.0', module_type: 1, status: 1 }],
  cluster_type: 1,
  reachable: 2,
  integration_status: 1,
  updated_at: 1700000000,
};

const sampleVulnEvent = {
  id: '100',
  cluster_id: '1',
  name: 'mock vuln',
  cve: 'CVE-2024-0001',
  risk: 4,
  manage_status: 0,
  characteristic: ['EXP'],
  node_name: 'node-1',
  cluster_name: 'mock-cluster',
  service_uid: 'svc-1',
  service_name: 'mock-service',
  service_type: 'ClusterIP',
  cnvd: 'CNVD-2024-1',
  cnnvd: 'CNNVD-2024-1',
  description: 'A mock vulnerability',
  solution: 'Upgrade to latest version',
  discovery_time: '1700000000',
  first_discovery_time: '1699900000',
  last_discovery_time: '1700000000',
  package_version: '1.0.0',
  fixed_version: '2.0.0',
  original_risk: 4,
  custom_risk: 0,
};

const sampleMicroserviceVulnEvent = {
  ...sampleVulnEvent,
  id: '200',
  service_uid: 'svc-2',
  service_name: 'mock-ms-service',
  service_type: 'ClusterIP',
};

function jsonResponse(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function htmlResponse(res, statusCode) {
  const body = '<!doctype html><html><body>Login Required</body></html>';
  res.writeHead(statusCode, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  const params = url.searchParams;

  // --- Error simulation routes ---

  if (path === '/error/400') {
    return jsonResponse(res, 400, { message: 'bad request: invalid parameter' });
  }
  if (path === '/error/401') {
    return jsonResponse(res, 401, { message: 'unauthorized: invalid token' });
  }
  if (path === '/error/403') {
    return jsonResponse(res, 403, { message: 'forbidden: insufficient permissions' });
  }
  if (path === '/error/404') {
    return jsonResponse(res, 404, { message: 'not found' });
  }
  if (path === '/error/409') {
    return jsonResponse(res, 409, { message: 'conflict: already exists' });
  }
  if (path === '/error/412') {
    return jsonResponse(res, 412, { message: 'precondition failed' });
  }
  if (path === '/error/429') {
    return jsonResponse(res, 429, { message: 'too many requests: rate limit exceeded' });
  }
  if (path === '/error/500') {
    return jsonResponse(res, 500, { message: 'internal server error' });
  }
  if (path === '/error/504') {
    return jsonResponse(res, 504, { message: 'gateway timeout' });
  }
  if (path === '/error/html-login') {
    return htmlResponse(res, 200);
  }
  if (path === '/error/timeout') {
    // Simulate a 5s delay then respond
    setTimeout(() => {
      jsonResponse(res, 200, { data: { data: [] }, next_page_token: '' });
    }, 5000);
    return;
  }

  // --- Success routes ---

  if (path === '/cluster/cluster_list') {
    const name = params.get('name');
    const status = params.get('status');
    let clusters = [{ ...sampleCluster }];
    if (name && sampleCluster.name !== name) {
      clusters = [];
    }
    if (status && String(sampleCluster.status) !== status) {
      clusters = [];
    }
    return jsonResponse(res, 200, {
      data: { data: clusters },
      next_page_token: '',
    });
  }

  if (path === '/cluster/cluster_info') {
    const clusterId = params.get('cluster_id');
    if (!clusterId) {
      return jsonResponse(res, 400, { message: 'cluster_id is required' });
    }
    return jsonResponse(res, 200, {
      data: {
        data: {
          cluster_info: { ...sampleCluster, id: clusterId },
        },
      },
    });
  }

  if (path === '/cluster_vuln/vuln_event_list') {
    return jsonResponse(res, 200, {
      data: { data: [sampleVulnEvent] },
      next_page_token: '',
    });
  }

  if (path === '/cluster_vuln/vuln_event_info') {
    const eventId = params.get('id');
    if (!eventId) {
      return jsonResponse(res, 400, { message: 'id is required' });
    }
    return jsonResponse(res, 200, {
      data: { ...sampleVulnEvent, id: eventId },
    });
  }

  if (path === '/cluster_microservice/vuln_event_list') {
    return jsonResponse(res, 200, {
      data: { data: [sampleMicroserviceVulnEvent] },
      next_page_token: '',
    });
  }

  if (path === '/cluster_microservice/vuln_event_info') {
    const eventId = params.get('id');
    if (!eventId) {
      return jsonResponse(res, 400, { message: 'id is required' });
    }
    return jsonResponse(res, 200, {
      data: { ...sampleMicroserviceVulnEvent, id: eventId },
    });
  }

  // Default 404
  jsonResponse(res, 404, { message: `Unknown path: ${path}` });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`CloudWalker mock upstream listening on http://127.0.0.1:${PORT}`);
  console.log('Endpoints:');
  console.log('  Success:  /cluster/cluster_list, /cluster/cluster_info,');
  console.log('            /cluster_vuln/vuln_event_list, /cluster_vuln/vuln_event_info,');
  console.log('            /cluster_microservice/vuln_event_list, /cluster_microservice/vuln_event_info');
  console.log('  Errors:   /error/400, /error/401, /error/403, /error/404, /error/409,');
  console.log('            /error/412, /error/429, /error/500, /error/504, /error/html-login,');
  console.log('            /error/timeout');
});
