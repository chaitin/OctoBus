import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import http from 'node:http';
import { URL } from 'node:url';

import { createClient, collectFilteredItems } from '../src/cloudwalker.js';

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

    if (req.url === '/cluster/cluster_list?page_size=20&offset=cursor-1&name=prod&status=1') {
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
      const risk = params.getAll('risk');
      const state = params.getAll('state');
      const characteristic = params.getAll('characteristic');
      if (
        params.get('page_size') === '10' &&
        params.get('offset') === 'cursor-a' &&
        params.get('cluster_id') === 'cluster-1' &&
        params.get('cve') === 'CVE-2024-0001' &&
        params.get('name') === 'openssl vuln' &&
        params.get('cnvd') === 'CNVD-2024-1' &&
        params.get('cnnvd') === 'CNNVD-2024-1' &&
        params.get('node_name') === 'node-a' &&
        params.get('cluster_name') === 'prod-cluster' &&
        params.get('order_by') === 'risk' &&
        params.get('order') === '1' &&
        risk.join(',') === '4,5' &&
        state.join(',') === '1,2' &&
        characteristic.join(',') === 'EXP,NETWORK'
      ) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          data: {
            data: [
              {
                id: 'event-1',
                cluster_id: 'cluster-1',
                name: 'openssl vuln',
                cve: 'CVE-2024-0001',
                risk: 4,
                manage_status: 1,
                characteristic: ['EXP', 'NETWORK']
              }
            ]
          },
          next_page_token: 'cursor-b'
        }));
        return;
      }

      if (
        params.get('page_size') === '50' &&
        params.get('cluster_id') === 'cluster-1' &&
        !params.has('cluster_name') &&
        !params.has('cnvd') &&
        !params.has('cnnvd')
      ) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          data: {
            data: [
              { id: 'event-1', cluster_id: 'cluster-1', cluster_name: 'prod-cluster', name: 'openssl vuln', cve: 'CVE-2024-0001' },
              { id: 'event-2', cluster_id: 'cluster-1', cluster_name: 'other-cluster', name: 'other vuln', cve: 'CVE-2024-0002' }
            ]
          },
          next_page_token: ''
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
          fixed_version: '3.0.0',
          cnvd: 'CNVD-2024-1',
          cnnvd: 'CNNVD-2024-1',
          cluster_name: 'prod-cluster'
        }
      }));
      return;
    }

    if (req.url === '/cluster_vuln/vuln_event_info?id=event-2') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        data: {
          id: 'event-2',
          cluster_id: 'cluster-1',
          fixed_version: '4.0.0',
          cnvd: 'CNVD-2024-2',
          cnnvd: 'CNNVD-2024-2',
          cluster_name: 'other-cluster'
        }
      }));
      return;
    }

    if (req.url?.startsWith('/cluster_microservice/vuln_event_list?')) {
      const params = new URL(`http://127.0.0.1${req.url}`).searchParams;
      const risk = params.getAll('risk');
      const state = params.getAll('state');
      const characteristic = params.getAll('characteristic');
      if (
        params.get('page_size') === '5' &&
        params.get('offset') === 'cursor-m' &&
        params.get('service_name') === 'checkout' &&
        params.get('service_type') === 'ClusterIP' &&
        params.get('cluster_name') === 'prod-cluster' &&
        params.get('name') === 'jwt vuln' &&
        params.get('cve') === 'CVE-2019-20933' &&
        params.get('cnvd') === 'CNVD-2019-1' &&
        params.get('cnnvd') === 'CNNVD-2019-1' &&
        params.get('order_by') === 'risk' &&
        params.get('order') === '2' &&
        characteristic.join(',') === 'EXP,NETWORK' &&
        risk.join(',') === '4,5' &&
        state.join(',') === '1,2'
      ) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          data: {
            data: [
              {
                id: 'ms-event-1',
                cluster_id: 'cluster-1',
                service_uid: 'service-1',
                service_name: 'checkout',
                cve: 'CVE-2019-20933',
                risk: 5,
                manage_status: 1,
                characteristic: ['EXP', 'NETWORK']
              }
            ]
          },
          next_page_token: 'cursor-n'
        }));
        return;
      }

      if (
        params.get('page_size') === '50' &&
        !params.has('cluster_name') &&
        !params.has('cnvd') &&
        !params.has('cnnvd')
      ) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          data: {
            data: [
              { id: 'ms-event-1', cluster_id: 'cluster-1', cluster_name: 'prod-cluster', service_uid: 'service-1', service_name: 'checkout', cve: 'CVE-2019-20933' },
              { id: 'ms-event-2', cluster_id: 'cluster-1', cluster_name: 'other-cluster', service_uid: 'service-2', service_name: 'billing', cve: 'CVE-2019-0002' }
            ]
          },
          next_page_token: ''
        }));
        return;
      }
    }

    if (req.url === '/cluster_microservice/vuln_event_info?id=ms-event-1') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        data: {
          id: 'ms-event-1',
          service_uid: 'service-1',
          service_name: 'checkout',
          package_version: '1.0.0',
          cnvd: 'CNVD-2019-1',
          cnnvd: 'CNNVD-2019-1',
          cluster_name: 'prod-cluster'
        }
      }));
      return;
    }

    if (req.url === '/cluster_microservice/vuln_event_info?id=ms-event-2') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        data: {
          id: 'ms-event-2',
          service_uid: 'service-2',
          service_name: 'billing',
          package_version: '2.0.0',
          cnvd: 'CNVD-2019-2',
          cnnvd: 'CNNVD-2019-2',
          cluster_name: 'other-cluster'
        }
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

    const clusters = await client.listClusters({ pageSize: 20, pageToken: 'cursor-1', name: 'prod', status: 1 });
    assert.equal(clusters.clusters[0].clusterName, 'prod-cluster');

    const cluster = await client.getClusterInfo({ clusterId: 'cluster-1' });
    assert.equal(cluster.createdAt, '2024-01-01T00:00:00Z');

    const clusterEvents = await client.listClusterVulnEvents({
      clusterId: 'cluster-1',
      pageSize: 10,
      pageToken: 'cursor-a',
      cve: 'CVE-2024-0001',
      name: 'openssl vuln',
      cnvd: 'CNVD-2024-1',
      cnnvd: 'CNNVD-2024-1',
      nodeName: 'node-a',
      clusterName: 'prod-cluster',
      orderBy: 'risk',
      risk: [4, 5],
      state: [1, 2],
      characteristic: ['EXP', 'NETWORK'],
      order: 1,
    });
    assert.equal(clusterEvents.vulnEvents[0].title, 'openssl vuln');
    assert.deepEqual(clusterEvents.vulnEvents[0].characteristic, ['EXP', 'NETWORK']);

    const fallbackClusterEvents = await client.listClusterVulnEvents({
      clusterId: 'cluster-1',
      pageSize: 1,
      clusterName: 'prod-cluster',
      cnvd: 'CNVD-2024-1',
      cnnvd: 'CNNVD-2024-1',
    });
    assert.equal(fallbackClusterEvents.vulnEvents.length, 1);
    assert.equal(fallbackClusterEvents.vulnEvents[0].eventId, 'event-1');
    assert.equal(fallbackClusterEvents.vulnEvents[0].clusterName, 'prod-cluster');

    const clusterEvent = await client.getClusterVulnEvent({ eventId: 'event-1' });
    assert.equal(clusterEvent.fixedVersion, '3.0.0');

    const microserviceEvents = await client.listMicroserviceVulnEvents({
      pageSize: 5,
      pageToken: 'cursor-m',
      serviceName: 'checkout',
      serviceType: 'ClusterIP',
      clusterName: 'prod-cluster',
      name: 'jwt vuln',
      cve: 'CVE-2019-20933',
      cnvd: 'CNVD-2019-1',
      cnnvd: 'CNNVD-2019-1',
      orderBy: 'risk',
      characteristic: ['EXP', 'NETWORK'],
      risk: [4, 5],
      state: [1, 2],
      order: 2,
    });
    assert.equal(microserviceEvents.vulnEvents[0].microserviceName, 'checkout');
    assert.equal(microserviceEvents.vulnEvents[0].serviceType, '');

    const fallbackMicroserviceEvents = await client.listMicroserviceVulnEvents({
      pageSize: 1,
      clusterName: 'prod-cluster',
      cnvd: 'CNVD-2019-1',
      cnnvd: 'CNNVD-2019-1',
    });
    assert.equal(fallbackMicroserviceEvents.vulnEvents.length, 1);
    assert.equal(fallbackMicroserviceEvents.vulnEvents[0].eventId, 'ms-event-1');
    assert.equal(fallbackMicroserviceEvents.vulnEvents[0].microserviceName, 'checkout');

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

  it('preserves nextPageToken when fallback scan stops at maxPages', async () => {
    let pageCalls = 0;

    const result = await collectFilteredItems({
      request: { pageSize: 1 },
      maxPages: 2,
      fetchPage: async ({ pageToken }) => {
        pageCalls += 1;
        if (!pageToken) {
          return {
            items: [{ id: '1' }],
            nextPageToken: 'cursor-2',
          };
        }
        return {
          items: [{ id: '2' }],
          nextPageToken: 'cursor-3',
        };
      },
      matchesItem: async () => false,
    });

    assert.equal(pageCalls, 2);
    assert.deepEqual(result.items, []);
    assert.equal(result.nextPageToken, 'cursor-3');
  });

  it('falls back from html response and keeps pagination token for later pages', async () => {
    const client = createClient({
      baseUrl,
      token: 'test-token',
      fetchImpl: async (url) => {
        const path = typeof url === 'string' ? url : url.toString();
        if (path.includes('/cluster/cluster_list?page_size=1&name=fallback')) {
          return new Response('<!doctype html><html><body>login</body></html>', {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          });
        }
        if (path.includes('/cluster/cluster_list?page_size=50')) {
          return new Response(JSON.stringify({
            data: {
              data: [
                { id: 'cluster-1', name: 'prod-cluster', status: 1 },
              ],
            },
            next_page_token: 'cursor-2',
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        throw new Error(`unexpected path: ${path}`);
      },
    });

    const response = await client.listClusters({ pageSize: 1, name: 'fallback' });
    assert.equal(response.clusters.length, 0);
    assert.equal(response.nextPageToken, 'cursor-2');
  });

  it('preserves zero status values during cluster normalization', async () => {
    const client = createClient({
      baseUrl,
      token: 'test-token',
      fetchImpl: async () => new Response(JSON.stringify({
        data: {
          data: [
            { id: 'cluster-zero', name: 'zero-cluster', status: 0 }
          ]
        },
        next_page_token: ''
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    });

    const response = await client.listClusters({ pageSize: 1 });
    assert.equal(response.clusters[0].status, '0');
  });

  it('preserves zero risk and manageStatus values during vuln event normalization', async () => {
    const client = createClient({
      baseUrl,
      token: 'test-token',
      fetchImpl: async (url) => {
        const path = typeof url === 'string' ? url : url.toString();
        if (path.includes('/cluster_vuln/vuln_event_list')) {
          return new Response(JSON.stringify({
            data: {
              data: [
                { id: 'vuln-zero', cluster_id: 'c1', risk: 0, manage_status: 0 }
              ]
            },
            next_page_token: ''
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        throw new Error(`unexpected path: ${path}`);
      },
    });

    const response = await client.listClusterVulnEvents({ pageSize: 1 });
    assert.equal(response.vulnEvents[0].level, '0');
    assert.equal(response.vulnEvents[0].status, '0');
    assert.equal(response.vulnEvents[0].risk, 0);
    assert.equal(response.vulnEvents[0].manageStatus, 0);
  });
});
