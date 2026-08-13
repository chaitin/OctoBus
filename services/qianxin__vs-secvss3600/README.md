# QIANXIN VS SecVSS3600

OctoBus service package for QIANXIN SecVSS 3600 vulnerability scanner (V3.0 async REST API).

## Import

```bash
octobus service import --id qianxin-vs-secvss3600 ./services/qianxin__vs-secvss3600
```

## Configuration

Set `restBaseUrl` to the scanner's base URL. `timeoutMs` (default 15000) and `tlsInsecureSkipVerify` are optional.

```json
{
  "restBaseUrl": "https://secvss.example.com",
  "timeoutMs": 15000,
  "tlsInsecureSkipVerify": false
}
```

Secret: `user` and `pwd` for device login.

```json
{
  "user": "admin",
  "pwd": "Admin@123"
}
```

## Behavior

- `GetDeviceStatus` calls `POST /async/device/status/` and returns CPU, memory, disk usage plus engine state.
- `SubmitScanTask` calls `POST /async/scan/task/` and returns `taskall_id` and `sys_task_id` for downstream calls.
- `ControlTask` calls `POST /async/control/` with the given action (`start`, `stop`, `pause`, `continue`, `enable`, `disable`, `delete`). Invalid action returns `INVALID_ARGUMENT` without making an HTTP request.
- `GetTaskStatus` calls `POST /async/scan/status/` and returns task status code and progress.
- `ListTasks` calls `POST /async/scan/tasklist/` with optional status filter and pagination.
- `QuerySysScanResult` calls `POST /async/scan/sys_result/` and returns host vuln counts.
- `QueryWebScanResult` calls `POST /async/scan/web_result/` and returns per-host web vuln detail.
- `QueryWeakPassResult` calls `POST /async/scan/weakpass_result/` and returns cracked accounts.
- All methods obtain a token via `POST /async/login/token/` automatically; a pre-obtained token can be passed in bindings to skip the login call.
- HTTP 401/403 maps to `PERMISSION_DENIED`. Upstream error codes for bad credentials or expired token also map to `PERMISSION_DENIED`. Other upstream 4xx map to `FAILED_PRECONDITION`. Network errors and 5xx map to `UNAVAILABLE`.

## Local Checks

```bash
cd services
npm run validate -- --service-dir qianxin__vs-secvss3600
npm test -- --service-dir qianxin__vs-secvss3600 --coverage
npm run pack:check
```
