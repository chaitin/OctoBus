## Deterministic mock evidence: ListNamespaces

This transcript is produced by the package's local HTTP fixture. It verifies
request/response mapping without requiring cluster credentials; it is not a
claim of compatibility with a real Kubernetes deployment. The repository L2
smoke separately exercises the packaged service through Connect, native gRPC,
and MCP. A maintainer must still review evidence from a real cluster before
claiming device compatibility.

## Maintainer verification against a real kube-apiserver

The service was additionally verified against a disposable Kubernetes v1.29.14
cluster created with kind on ARM64. This is a real kube-apiserver using its
self-signed TLS certificate, ServiceAccount Bearer authentication, and RBAC;
it is not the package's HTTP mock. The reproducible client is
`offline-test/verify-real-cluster.mjs`. No token, certificate, internal host,
or complete upstream response is stored in this repository.

The verification exercised every RPC against the API server:

- `ListNamespaces`, `ListPods`, `ListServices`, `ListDeployments`, and
  `ListNodes` returned live cluster resources.
- `GetPod` and `GetPodLogs` succeeded for a running control-plane workload.
- an invalid Bearer token mapped the API server's HTTP 401 to
  `PERMISSION_DENIED`.
- a nonexistent pod mapped the API server's HTTP 404 to `NOT_FOUND`.
- `skipTlsVerify` successfully connected through undici's dispatcher to the
  kind API server's self-signed HTTPS endpoint.

Sanitized result produced by the verification client:

```json
{"transport":"HTTPS with a self-signed kind kube-apiserver certificate","authentication":"Bearer ServiceAccount token accepted; invalid token rejected","namespaces":6,"pods":8,"services":1,"deployments":1,"nodes":1,"getPod":"success","getPodLogs":"success","missingPod":"NOT_FOUND"}
```

# Request
```
https://10.0.0.8:6443/api/v1/namespaces
Authorization: Bearer REDACTED_K8S_TOKEN
```

# Response   HTTP/1.1 200 OK
```json
{
  "kind": "NamespaceList",
  "items": [
    {
      "metadata": {
        "name": "default",
        "uid": "uid-1",
        "resourceVersion": "1",
        "creationTimestamp": "2026-01-01T00:00:00Z",
        "labels": {},
        "annotations": {}
      },
      "status": {
        "phase": "Active"
      }
    },
    {
      "metadata": {
        "name": "kube-system",
        "uid": "uid-2",
        "resourceVersion": "2",
        "creationTimestamp": "2026-01-01T00:00:00Z",
        "labels": {},
        "annotations": {}
      },
      "status": {
        "phase": "Active"
      }
    }
  ],
  "metadata": {
    "continue": "",
    "remainingItemCount": 0
  }
}
```
