/* node:coverage disable */
import http from 'node:http';

const sendJson = (res, status, payload) => { const body = JSON.stringify(payload); res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }); res.end(body); };

export function createMockServer() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const fullUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const path = fullUrl.pathname;
    const entry = { method: req.method, path, query: Object.fromEntries(fullUrl.searchParams), headers: req.headers };
    requests.push(entry);

    if (path === '/api/v1/namespaces') {
      sendJson(res, 200, { kind: 'NamespaceList', items: [{ metadata: { name: 'default', uid: 'uid-1', resourceVersion: '1', creationTimestamp: '2026-01-01T00:00:00Z', labels: {}, annotations: {} }, status: { phase: 'Active' } }, { metadata: { name: 'kube-system', uid: 'uid-2', resourceVersion: '2', creationTimestamp: '2026-01-01T00:00:00Z', labels: {}, annotations: {} }, status: { phase: 'Active' } }], metadata: { continue: '', remainingItemCount: 0 } });
      return;
    }

    if (path === '/api/v1/pods' || path === '/api/v1/namespaces/default/pods') {
      sendJson(res, 200, { kind: 'PodList', items: [{ metadata: { name: 'nginx-pod', namespace: 'default', uid: 'pod-uid-1', resourceVersion: '10', creationTimestamp: '2026-01-01T00:00:00Z', labels: { app: 'nginx' }, annotations: {} }, spec: { nodeName: 'node-1', containers: [{ name: 'nginx', image: 'nginx:1.25' }] }, status: { phase: 'Running', hostIP: '10.0.0.1', podIP: '10.244.1.1', startTime: '2026-01-01T00:00:00Z', qosClass: 'Burstable', containerStatuses: [{ name: 'nginx', state: { running: { startedAt: '2026-01-01T00:00:00Z' } }, ready: true, started: true, restartCount: 0, image: 'nginx:1.25', imageID: 'nginx@sha256:...', containerID: 'containerd://abc' }] } }], metadata: { continue: '' } });
      return;
    }

    if (path === '/api/v1/services' || path === '/api/v1/namespaces/default/services') {
      sendJson(res, 200, { kind: 'ServiceList', items: [{ metadata: { name: 'kubernetes', namespace: 'default', uid: 'svc-uid-1', resourceVersion: '1', creationTimestamp: '2026-01-01T00:00:00Z', labels: { component: 'apiserver' } }, spec: { clusterIP: '10.96.0.1', type: 'ClusterIP', ports: [{ name: 'https', protocol: 'TCP', port: 443, targetPort: 6443 }] } }] });
      return;
    }

    if (path === '/apis/apps/v1/deployments' || path === '/apis/apps/v1/namespaces/default/deployments') {
      sendJson(res, 200, { kind: 'DeploymentList', items: [{ metadata: { name: 'nginx-deploy', namespace: 'default', uid: 'deploy-uid-1', resourceVersion: '20', creationTimestamp: '2026-01-01T00:00:00Z', labels: { app: 'nginx' } }, status: { replicas: 3, readyReplicas: 3, availableReplicas: 3, unavailableReplicas: 0, updatedReplicas: 3, conditions: [{ type: 'Available', status: 'True', reason: 'MinimumReplicasAvailable' }] } }] });
      return;
    }

    if (path === '/api/v1/nodes') {
      sendJson(res, 200, { kind: 'NodeList', items: [{ metadata: { name: 'node-1', uid: 'node-uid-1', resourceVersion: '5', creationTimestamp: '2026-01-01T00:00:00Z', labels: { 'kubernetes.io/hostname': 'node-1' } }, status: { phase: 'Running', addresses: [{ type: 'InternalIP', address: '10.0.0.1' }], conditions: [{ type: 'Ready', status: 'True', reason: 'KubeletReady', lastHeartbeatTime: '2026-01-01T00:00:00Z', lastTransitionTime: '2026-01-01T00:00:00Z' }], capacity: { cpu: '4', memory: '8Gi', pods: '110' }, allocatable: { cpu: '4', memory: '7Gi', pods: '110' }, nodeInfo: { kubeletVersion: 'v1.29.0', osImage: 'Ubuntu 22.04', kernelVersion: '5.15.0', containerRuntimeVersion: 'containerd://1.7', architecture: 'amd64' } } }] });
      return;
    }

    const podMatch = path.match(/^\/api\/v1\/namespaces\/([^/]+)\/pods\/([^/]+)$/);
    if (podMatch) {
      sendJson(res, 200, { metadata: { name: podMatch[2], namespace: podMatch[1], uid: 'pod-uid-1', resourceVersion: '10', creationTimestamp: '2026-01-01T00:00:00Z' }, spec: { nodeName: 'node-1', containers: [{ name: 'nginx', image: 'nginx:1.25' }] }, status: { phase: 'Running', hostIP: '10.0.0.1', podIP: '10.244.1.1', startTime: '2026-01-01T00:00:00Z', qosClass: 'Burstable', containerStatuses: [{ name: 'nginx', state: { running: {} }, ready: true, started: true, restartCount: 0, image: 'nginx:1.25', imageID: 'sha', containerID: 'cri://abc' }] } });
      return;
    }

    const logMatch = path.match(/^\/api\/v1\/namespaces\/([^/]+)\/pods\/([^/]+)\/log$/);
    if (logMatch) {
      const logBody = '2026-01-01T00:00:00Z INFO Server started\n';
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(logBody);
      return;
    }

    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  });

  return {
    requests,
    async start() { await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const addr = server.address(); return `http://${addr.address}:${addr.port}`; },
    async close() { await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))); },
  };
}