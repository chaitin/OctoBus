# NSFOCUS RSAS V6.0R04F04SP09

OctoBus package for the NSFOCUS RSAS (Remote Security Assessment System,
绿盟网络安全漏洞扫描系统) V6.0R04F04SP09 REST API.

## Authentication

RSAS authenticates with a username/password pair passed as URL query
parameters (`?username=...&password=...`). Provide them through the secret
binding (`user`/`username` + `password`); every request also sends
`format=json` and `curr_lang` (default `cn`).

## Configuration

| Binding | Location | Description |
| --- | --- | --- |
| `host` | config | Base URL with scheme, e.g. `https://10.65.193.127` |
| `user` / `username` | secret (or config) | Login username |
| `password` | secret | Login password |
| `currLang` | config | Response language `cn` (default) or `en` |
| `timeoutMs` | config | HTTP timeout in ms (default 30000) |
| `skipTlsVerify` | config | Skip TLS verification for self-signed device certs |
| `headers` | config | Extra HTTP headers |

## RPCs

All responses carry the RSAS envelope fields `ret_code`, `ret_msg`, `data`
(as a `google.protobuf.Value`) and the transport `http_status`. Task-creation
RPCs additionally surface `task_id`. Download RPCs return `BinaryResponse`
with base64 body plus content metadata.

### Task lifecycle
- `CreateTask` — `POST /api/task/create` (config.xml payload)
- `CreateVulnTask` — `POST /api/task/vul/create`
- `CreateBaselineTask` — `POST /api/task/baseline/create`
- `CreatePwdTask` — `POST /api/task/pwd/create`
- `CreateWebTask` — `POST /api/task/web/create`
- `CreateOfflineTask` — `POST /api/task/offline/create`
- `CreateDockerTask` — `POST /api/task/docker/create`
- `CreateCodeauditTask` — `POST /api/task/codeaudit/create`
- `CreateHostAssetsTask` — `POST /api/task/hostassets/create`
- `CreateWebAssetsTask` — `POST /api/task/webassets/create`
- `GetTaskStatus` — `GET /api/task/status/{task_id}`
- `PauseTask` / `ResumeTask` / `StopTask` / `DeleteTask` — `POST /api/task/{action}/{task_id}`
- `BatchDeleteTasks` — `POST /api/task/batch_delete`
- `ListTasks` — `GET /api/task/list`
- `ListActiveTasks` — `GET /api/task/active_list`
- `GetTaskResult` — `GET /api/report/task/{task_id}`
- `CreateAuthInfo` — `POST /api/authinfo/create`
- `LoginVerify` — `POST /api/auth/login_verify`

### Templates and dictionaries
- `ListSysvulnTemplate` — `GET /api/template/sysvuln/list`
- `ListWebvulnTemplate` — `GET /api/template/webvuln/list`
- `ListBaselineTemplate` — `GET /api/template/baseline/list`
- `GetBaselineParams` — `GET /api/template/baseline/params`
- `ListCodeauditTemplate` — `GET /api/template/codeaudit/list`
- `ListAssetTemplate` — `GET /api/template/asset/list`
- `CreateBaselineTemplate` — `POST /api/template/baseline/create`
- `ListUserpwd` — `GET /api/userpwd/list`
- `CreateUserpwd` — `POST /api/userpwd/create`

### System and audit
- `GetSystemStatus` — `GET /api/system/status`
- `GetLogInfo` — `GET /api/log/getlogInfo`

### Reports
- `ListReportTemplate` — `GET /api/report/template/list`
- `GenerateReport` — `POST /api/generate_report/`
- `GetReportProgress` — `GET /api/get_report_progress/report_id/{report_id}`
- `DownloadReport` — `GET /api/download_report/report_id/{report_id}/report_type/{report_type}`
- `DeleteReports` — `POST /api/delete_reports`

### Agent
- `GetAgentMethodConfig` / `SetAgentMethodConfig` — `/api/agent/agent_method_config`
- `GetAgentAuth` — `GET /api/agent/get_agent_auth`
- `GetAgentPackageUrl` — `GET /api/agent/get_agentpackage_url`
- `DownloadAgent` — `GET /api/agent/download/{linux|windows}`

## Error mapping

| Condition | gRPC status |
| --- | --- |
| Missing required argument | `INVALID_ARGUMENT` |
| HTTP 401 / 403 | `PERMISSION_DENIED` |
| HTTP 404 / 405 | `INVALID_ARGUMENT` |
| HTTP 429 (rate limit) | `RESOURCE_EXHAUSTED` |
| HTTP 5xx / network failure | `UNAVAILABLE` |
| Non-JSON or empty body | `UNKNOWN` |

RSAS applies its own rate limits (600 req/min globally; 300 req/min for task
status and report progress; 150 req/min for other interfaces), returning HTTP
429 when exceeded.

## Testing

```
npm test -- --service-dir nsfocus__rsas_v6-0r04f04sp09
```
