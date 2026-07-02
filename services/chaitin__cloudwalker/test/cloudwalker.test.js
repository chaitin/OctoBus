import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import http from 'node:http';
import { URL } from 'node:url';

import { createClient, handlers } from '../src/cloudwalker.js';

const requests = [];

function createMockServer() {
  return http.createServer((req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
    });

    if (req.url === '/cluster/cluster_list?page_size=20&offset=cursor-1') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        items: [
          {
            id: 'cluster-1',
            name: 'prod-cluster',
            risk_level: 'high'
          }
        ],
        next_page_token: 'cursor-2'
      }));
      return;
    }

    if (req.url === '/cluster/cluster_info?cluster_id=cluster-1') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        data: {
          data: {
            cluster_info: {
              id: 'cluster-1',
              name: 'prod-cluster',
              created_at: '2024-01-01T00:00:00Z'
            }
          }
        }
      }));
      return;
    }

    if (req.url?.startsWith('/cluster_vuln/vuln_event_list?')) {
      const params = new URL(`http://127.0.0.1${req.url}`).searchParams;
      if (
        params.get('page_size') === '10' &&
        params.get('offset') === 'cursor-a' &&
        params.get('cluster_id') === 'cluster-1'
      ) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          vuln_events: [
            {
              id: 'event-1',
              cluster_id: 'cluster-1',
              name: 'openssl',
              service_uid: '',
              service_name: ''
            }
          ],
          next_page_token: 'cursor-b'
        }));
        return;
      }
    }

    if (req.url === '/cluster_vuln/vuln_event_info?id=event-1') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        data: {
          id: 'event-1',
          cluster_id: 'cluster-1',
          fixed_version: '3.0.0'
        }
      }));
      return;
    }

    if (req.url === '/cluster_microservice/vuln_event_list?page_size=5&offset=cursor-m') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        items: [
          {
            id: 'ms-event-1',
            service_uid: 'service-1',
            service_name: 'checkout'
          }
        ],
        next_page_token: 'cursor-n'
      }));
      return;
    }

    if (req.url === '/cluster_microservice/vuln_event_info?id=ms-event-1') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        data: {
          id: 'ms-event-1',
          service_uid: 'service-1',
          service_name: 'checkout',
          package_version: '1.0.0'
        }
      }));
      return;
    }

    if (req.url === '/bad-request') {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'invalid parameter' }));
      return;
    }

    if (req.url === '/forbidden') {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'access denied' }));
      return;
    }

    if (req.url === '/unauthorized') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'invalid token' }));
      return;
    }

    if (req.url === '/conflict') {
      res.writeHead(409, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'already exists' }));
      return;
    }

    if (req.url === '/rate-limited') {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'too many requests' }));
      return;
    }

    if (req.url === '/precondition') {
      res.writeHead(412, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'precondition failed' }));
      return;
    }

    if (req.url === '/missing') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'not found' }));
      return;
    }

    if (req.url === '/broken') {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'upstream exploded' }));
      return;
    }

    if (req.url === '/gateway-timeout') {
      res.writeHead(504, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'gateway timeout' }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: `Unhandled path: ${req.url}` }));
  });
}

let server;
let baseUrl;

before(async () => {
  server = createMockServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe('cloudwalker client', () => {
  it('lists clusters and maps pagination plus auth', async () => {
    const client = createClient({ baseUrl, token: 'test-token' });

    const response = await client.listClusters({ pageSize: 20, pageToken: 'cursor-1' });

    assert.deepEqual(response.clusters[0], {
      clusterId: 'cluster-1',
      clusterName: 'prod-cluster',
      status: '',
      riskLevel: '',
      createdAt: '',
      updatedAt: '',
      apiVersion: '',
      masterIps: [],
      moduleStatus: [],
      clusterType: 0,
      reachable: 0,
      integrationStatus: 0,
    });
    assert.equal(response.nextPageToken, 'cursor-2');
    assert.equal(requests.at(-1).headers.authorization, 'Bearer test-token');
    assert.equal(requests.at(-1).url, '/cluster/cluster_list?page_size=20&offset=cursor-1');
  });

  it('returns cluster and event details with camelCase mapping', async () => {
    const client = createClient({ baseUrl, token: 'test-token' });

    const cluster = await client.getClusterInfo({ clusterId: 'cluster-1' });
    assert.equal(cluster.clusterName, 'prod-cluster');
    assert.equal(cluster.createdAt, '2024-01-01T00:00:00Z');

    const clusterEvent = await client.getClusterVulnEvent({ eventId: 'event-1' });
    assert.equal(clusterEvent.fixedVersion, '3.0.0');

    const microserviceEvent = await client.getMicroserviceVulnEvent({ eventId: 'ms-event-1' });
    assert.equal(microserviceEvent.microserviceName, 'checkout');
  });

  it('lists vulnerability events for cluster and microservice scopes', async () => {
    const client = createClient({ baseUrl, token: 'test-token' });

    const clusterEvents = await client.listClusterVulnEvents({
      clusterId: 'cluster-1',
      pageSize: 10,
      pageToken: 'cursor-a'
    });
    assert.equal(clusterEvents.vulnEvents[0].title, 'openssl');
    assert.equal(clusterEvents.nextPageToken, 'cursor-b');

    const microserviceEvents = await client.listMicroserviceVulnEvents({
      pageSize: 5,
      pageToken: 'cursor-m'
    });
    assert.equal(microserviceEvents.vulnEvents[0].microserviceName, 'checkout');
    assert.equal(microserviceEvents.nextPageToken, 'cursor-n');
  });

  it('wraps upstream HTTP errors to gRPC status codes', async () => {
    const client = createClient({ baseUrl, token: 'test-token' });

    // 400 -> INVALID_ARGUMENT (3)
    await assert.rejects(() => client.get('/bad-request'), { code: 3, details: 'invalid parameter' });
    // 401 -> UNAUTHENTICATED (16)
    await assert.rejects(() => client.get('/unauthorized'), { code: 16, details: 'invalid token' });
    // 403 -> PERMISSION_DENIED (7)
    await assert.rejects(() => client.get('/forbidden'), { code: 7, details: 'access denied' });
    // 404 -> NOT_FOUND (5)
    await assert.rejects(() => client.get('/missing'), { code: 5, details: 'not found' });
    // 409 -> ALREADY_EXISTS (6)
    await assert.rejects(() => client.get('/conflict'), { code: 6, details: 'already exists' });
    // 412 -> FAILED_PRECONDITION (9)
    await assert.rejects(() => client.get('/precondition'), { code: 9, details: 'precondition failed' });
    // 429 -> RESOURCE_EXHAUSTED (8)
    await assert.rejects(() => client.get('/rate-limited'), { code: 8, details: 'too many requests' });
    // 500 -> UNAVAILABLE (14)
    await assert.rejects(() => client.get('/broken'), { code: 14, details: 'upstream exploded' });
    // 504 -> DEADLINE_EXCEEDED (4)
    await assert.rejects(() => client.get('/gateway-timeout'), { code: 4, details: 'gateway timeout' });
  });
});

describe('cloudwalker handlers', () => {
  it('builds the client from context config, secrets and bindings', async () => {
    const response = await handlers['Chaitin_CloudWalker.Chaitin_CloudWalker/ListClusters'](
      {
        config: {
          baseUrl,
          referer: 'https://cnapp.demo.chaitin.cn/profile/apitoken'
        },
        secret: {
          token: 'handler-token',
          cookie: 'session=handler'
        },
        request: { pageSize: 20, pageToken: 'cursor-1' }
      }
    );

    assert.equal(response.clusters[0].clusterId, 'cluster-1');
    const request = requests.at(-1);
    assert.equal(request.headers.authorization, 'Bearer handler-token');
    assert.equal(request.headers.cookie, 'session=handler');
    assert.equal(request.headers.referer, 'https://cnapp.demo.chaitin.cn/profile/apitoken');
  });

  it('accepts cluster vuln detail requests without clusterId', async () => {
    const response = await handlers['Chaitin_CloudWalker.Chaitin_CloudWalker/GetClusterVulnEvent'](
      {
        config: { baseUrl },
        secret: { token: 'handler-token' },
        request: { eventId: 'event-1' }
      }
    );

    assert.equal(response.eventId, 'event-1');
    assert.equal(requests.at(-1).url, '/cluster_vuln/vuln_event_info?id=event-1');
  });
});
