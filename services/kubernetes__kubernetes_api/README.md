# Kubernetes API

OctoBus service package for read-only Kubernetes API operations.

## Methods

| Method | Description |
|--------|-------------|
| `ListNamespaces` | List all namespaces with optional label/field selectors |
| `ListPods` | List pods in a namespace or across all namespaces |
| `ListServices` | List services in a namespace or across all namespaces |
| `ListDeployments` | List deployments in a namespace or across all namespaces |
| `ListNodes` | List cluster nodes with resource and status information |
| `GetPod` | Get a single pod by namespace and name |
| `GetPodLogs` | Get container logs from a pod |

## Configuration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `baseUrl` | string | Yes | Kubernetes API server URL (e.g. `https://k8s-api.example.com:6443`) |
| `timeoutMs` | integer | No | HTTP timeout in milliseconds (default: 15000) |
| `skipTlsVerify` | boolean | No | Skip TLS certificate verification |

The package requires Node.js 20.18.1 or newer because TLS dispatcher support
is provided by undici 7. Use `skipTlsVerify` only for a trusted cluster whose
certificate cannot be verified through the runtime trust store.

## Secrets

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | Yes* | Kubernetes bearer token for authentication |
| `username` | string | Yes* | Username for HTTP Basic Auth (alternative to token) |
| `password` | string | Yes* | Password for HTTP Basic Auth |

\* Either token or username/password is required.

## API Reference

- [Kubernetes API Reference](https://kubernetes.io/docs/reference/kubernetes-api/)
- [Kubernetes API Concepts](https://kubernetes.io/docs/reference/using-api/)
