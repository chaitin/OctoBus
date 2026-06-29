import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import http from 'node:http';
import { URL } from 'node:url';

import { createClient } from '../src/cloudwalker.js';

const requests = [];

function createMockServer() {
  return http.createServer((req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
    });

    if (req.url === '/html-success') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><body>login</body></html>');
      return;
    }

    if (req.url === '/cluster/cluster_list?page_size=20&offset=cursor-1') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        items: [
          {
            cluster_id: 'cluster-1',
            cluster_name: 'prod-cluster',
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
        cluster_id: 'cluster-1',
        cluster_name: 'prod-cluster',
        created_at: '2024-01-01T00:00:00Z'
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
              event_id: 'event-1',
              cluster_id: 'cluster-1',
              package_name: 'openssl'
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
        event_id: 'event-1',
        cluster_id: 'cluster-1',
        fixed_version: '3.0.0'
      }));
      return;
    }

    if (req.url === '/cluster_microservice/vuln_event_list?page_size=5&offset=cursor-m') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        items: [
          {
            event_id: 'ms-event-1',
            microservice_id: 'service-1',
            microservice_name: 'checkout'
          }
        ],
        next_page_token: 'cursor-n'
      }));
      return;
    }

    if (req.url === '/cluster_microservice/vuln_event_info?id=ms-event-1') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        event_id: 'ms-event-1',
        microservice_id: 'service-1',
        microservice_name: 'checkout',
        package_version: '1.0.0'
      }));
      return;
    }

    if (req.url === '/json-success') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ items: [], next_page_token: '' }));
      return;
    }

    if (req.url === '/unauthorized') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'invalid token' }));
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
  it('rejects html responses even when status is 200', async () => {
    const client = createClient({ baseUrl, token: 'test-token' });

    await assert.rejects(() => client.get('/html-success'), {
      name: 'CloudWalkerError',
      message: 'CloudWalker upstream returned non-JSON content',
      code: 14,
      httpStatus: 200,
    });
  });

  it('uses documented endpoints and auth headers', async () => {
    const client = createClient({ baseUrl, token: 'test-token' });

    const clusters = await client.listClusters({ pageSize: 20, pageToken: 'cursor-1' });
    assert.equal(clusters.clusters[0].clusterName, 'prod-cluster');

    const cluster = await client.getClusterInfo({ clusterId: 'cluster-1' });
    assert.equal(cluster.createdAt, '2024-01-01T00:00:00Z');

    const clusterEvents = await client.listClusterVulnEvents({ clusterId: 'cluster-1', pageSize: 10, pageToken: 'cursor-a' });
    assert.equal(clusterEvents.vulnEvents[0].packageName, 'openssl');

    const clusterEvent = await client.getClusterVulnEvent({ clusterId: 'cluster-1', eventId: 'event-1' });
    assert.equal(clusterEvent.fixedVersion, '3.0.0');

    const microserviceEvents = await client.listMicroserviceVulnEvents({ pageSize: 5, pageToken: 'cursor-m' });
    assert.equal(microserviceEvents.vulnEvents[0].microserviceName, 'checkout');

    const microserviceEvent = await client.getMicroserviceVulnEvent({ eventId: 'ms-event-1' });
    assert.equal(microserviceEvent.packageVersion, '1.0.0');

    const first = requests[0];
    assert.equal(first.headers.authorization, 'Bearer test-token');
    assert.equal(first.headers.token, 'test-token');
    assert.equal(first.headers['x-auth-token'], 'test-token');
    assert.equal(first.headers['x-requested-with'], 'XMLHttpRequest');
  });

  it('still accepts normal json responses and wraps auth failures', async () => {
    const client = createClient({ baseUrl, token: 'test-token' });

    const payload = await client.get('/json-success');
    assert.deepEqual(payload, { items: [], next_page_token: '' });

    await assert.rejects(() => client.get('/unauthorized'), { code: 16, details: 'invalid token' });
  });

  it('forwards optional cookie and referer headers', async () => {
    const client = createClient({
      baseUrl,
      token: 'test-token',
      cookie: 'session=abc123',
      referer: 'https://cnapp.demo.chaitin.cn/profile/apitoken'
    });

    await client.get('/json-success');

    const request = requests.at(-1);
    assert.equal(request.headers.cookie, 'session=abc123');
    assert.equal(request.headers.referer, 'https://cnapp.demo.chaitin.cn/profile/apitoken');
  });
});
