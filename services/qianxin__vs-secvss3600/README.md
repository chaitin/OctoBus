# QIANXIN SecVSS 3600

OctoBus service package for the **QIANXIN SecVSS 3600** vulnerability scanner. Wraps the scanner's async REST API as gRPC methods for task management and result retrieval.

- **Vendor**: QIANXIN (奇安信)
- **Product**: 网神 SecVSS 3600 (V6, build V6.0.1.10001)
- **Proto package**: `QIANXIN_VS_SecVSS3600`
- **API base path**: `/async/`

## Authentication

Supports two modes:

1. **Pre-obtained token** — set `secret.token` (or pass `token` in the request). Skips login.
2. **Auto-login** — set `secret.user` + `secret.pwd`. Each request logs in automatically via `POST /async/login/token/`.

## Config

| Field | Required | Description |
|-------|----------|-------------|
| `restBaseUrl` | Yes | Scanner base URL, e.g. `https://secvss.example.com` |
| `timeoutMs` | No | HTTP timeout in ms (default 15000) |
| `tlsInsecureSkipVerify` | No | Skip TLS verification for self-signed certs |

## Methods

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GetDeviceStatus` | `POST /async/device/status/` | Scanner health: CPU, disk, memory, engine status. No auth required. |
| `ListTasks` | `POST /async/tasklist/query/` | List scan tasks with optional status/time/page filters. |
| `GetTaskStatus` | `POST /async/status/` | Task status code (0=pending … 4=done … 9=timeout) and progress %. |
| `SubmitScanTask` | `POST /async/newtask/add/` | Submit a new scan against an authorized target. Returns task IDs. |
| `ControlTask` | `POST /async/control/` | Action: `start` `stop` `pause` `continue` `enable` `disable` `delete`. |
| `QuerySysScanResult` | `POST /async/sysscan/query/` | System vuln results: host list, high/medium/low vuln counts. |
| `QueryWebScanResult` | `POST /async/webscan/query/` | Web vuln results per host. |
| `QueryWeakPassResult` | `POST /async/crack/query/` | Weak-password crack results: accounts, services, ports. |

## Test

```bash
cd services
npm run validate -- --service-dir qianxin__vs-secvss3600
npm test -- --service-dir qianxin__vs-secvss3600
npm run pack:check
```
