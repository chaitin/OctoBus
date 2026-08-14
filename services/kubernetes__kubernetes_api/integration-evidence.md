## Deterministic mock evidence: ListNamespaces

This transcript is produced by the package's local HTTP fixture. It verifies
request/response mapping without requiring cluster credentials; it is not a
claim of compatibility with a real Kubernetes deployment. The repository L2
smoke separately exercises the packaged service through Connect, native gRPC,
and MCP. A maintainer must still review evidence from a real cluster before
claiming device compatibility.

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
