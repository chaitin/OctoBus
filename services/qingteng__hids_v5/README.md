# Qingteng HIDS V5

OctoBus read-only service package for Qingteng Shenrui CWPP/HIDS OpenAPI v5.1.5.

The package covers host assets, agents, intrusion detections, response operation result queries, and baseline check queries. It intentionally does not expose destructive or enforcement APIs such as host isolation, process kill, file deletion, network blocking, or account disablement.

## Import

Service root: `services/qingteng__hids_v5`.

```bash
octobus service import --id qingteng-hids-v5 ./services/qingteng__hids_v5
```

## Package Layout

- `service.json`: OctoBus service package manifest.
- `proto/qingteng_hids_v5.proto`: gRPC API definition.
- `src/qingteng-hids-v5.js`: Runtime handler, request validation, HTTP request building, response mapping, and error mapping.
- `src/service.js`: OctoBus SDK service wrapper.
- `bin/qingteng-hids-v5.js`: Runtime entrypoint.
- `config.schema.json`: Non-secret binding schema.
- `secret.schema.json`: OpenAPI token schema.
- `test/`: Node test coverage and mock upstream.

## Bindings

Configuration:

- `baseUrl`: Qingteng CWPP/HIDS base URL, for example `https://hids.example.com`.
- `base_url`, `host`, `endpoint`: aliases for `baseUrl`.
- `timeoutMs`: optional request timeout in milliseconds, default `10000`.
- `timeout_ms`: alias for `timeoutMs`.
- `verifyTLS`: verifies TLS certificates when true, default `true`.
- `skipTlsVerify`: skips TLS verification for private deployments when true.
- `headers`: optional additional HTTP headers.

Secrets:

- `token`: Qingteng OpenAPI bearer token.

Example:

```json
{
  "baseUrl": "https://hids.example.com",
  "timeoutMs": 10000,
  "verifyTLS": true
}
```

```json
{
  "token": "your-openapi-token"
}
```

Requests include:

```http
Authorization: Bearer your-openapi-token
Content-Type: application/json
```

## RPC Methods

- `qingteng.hids.v5.QingtengHIDSService/ListHosts`
- `qingteng.hids.v5.QingtengHIDSService/GetHost`
- `qingteng.hids.v5.QingtengHIDSService/CountHosts`
- `qingteng.hids.v5.QingtengHIDSService/ListAgents`
- `qingteng.hids.v5.QingtengHIDSService/CountAgents`
- `qingteng.hids.v5.QingtengHIDSService/ListDetections`
- `qingteng.hids.v5.QingtengHIDSService/GetDetection`
- `qingteng.hids.v5.QingtengHIDSService/ListResponseResults`
- `qingteng.hids.v5.QingtengHIDSService/ListResponseHistory`
- `qingteng.hids.v5.QingtengHIDSService/GetElementOperationInfos`
- `qingteng.hids.v5.QingtengHIDSService/ListBaselines`
- `qingteng.hids.v5.QingtengHIDSService/GetBaseline`
- `qingteng.hids.v5.QingtengHIDSService/ListBaselineTasks`
- `qingteng.hids.v5.QingtengHIDSService/GetBaselineTaskStatus`
- `qingteng.hids.v5.QingtengHIDSService/ListBaselineTaskResults`

## Behavior

- Host, agent, detection, response result, response history, element operation, baseline, baseline task, and baseline result queries are sent to Qingteng OpenAPI with bearer-token authentication.
- Query requests support modeled fields and `rawQueryJson` / `rawQuery` pass-through for documented upstream filters that are not explicitly modeled yet.
- Successful responses include normalized fields plus a `raw` object containing `http_status`, `raw_body`, and `raw_json` for troubleshooting upstream field differences.
- HTTP `401` and `403` map to `PERMISSION_DENIED`.
- HTTP `404` maps to `NOT_FOUND`.
- HTTP `5xx` and network errors map to `UNAVAILABLE`.
- Non-JSON responses map to `UNKNOWN`.
- `GetDetection` returns `NOT_FOUND` when the upstream list response does not contain the requested detection.

## Requests

List hosts:

```json
{
  "page": {
    "page": 0,
    "size": 10
  },
  "query": {
    "ipLike": "10.0"
  }
}
```

List detections:

```json
{
  "page": {
    "page": 0,
    "size": 10
  },
  "query": {},
  "showDetail": true
}
```

Get detection:

```json
{
  "detectionId": "det-001"
}
```

List baseline task results:

```json
{
  "taskId": "task-001",
  "baselineId": "baseline-001",
  "page": {
    "page": 0,
    "size": 10
  },
  "query": {}
}
```

Pass through an upstream query field:

```json
{
  "page": {
    "page": 0,
    "size": 10
  },
  "query": {
    "rawQueryJson": "{\"is_builtin\":true}"
  }
}
```

## Mock Upstream

Start the local mock Qingteng OpenAPI service:

```bash
node services/qingteng__hids_v5/test/mock_upstream.js
```

Default values:

- URL: `http://127.0.0.1:18083`
- Token: `test-token-abc123`

Override them with environment variables:

```bash
HTTP_PORT=19083 MOCK_TOKEN=dev-token node services/qingteng__hids_v5/test/mock_upstream.js
```

Create a mock OctoBus instance:

```bash
octobus instance create \
  qingteng-mock \
  --service qingteng-hids-v5 \
  --config-json '{"baseUrl":"http://127.0.0.1:18083","timeoutMs":10000}' \
  --secret-json '{"token":"test-token-abc123"}'
```

## Integration Evidence

Manual integration was verified with redacted request and response data. Real device addresses, tokens, host IPs, hostnames, group names, alert IDs, baseline IDs, task IDs, user information, paths, file names, process names, and response values were removed from the evidence.

| Method | Connect HTTP | Product HTTP | Result |
|---|---:|---:|---|
| `ListHosts` | 200 | 200 | OK |
| `GetHost` | 200 | 200 | OK |
| `CountHosts` | 200 | 200 | OK |
| `ListAgents` | 200 | 200 | OK |
| `CountAgents` | 200 | 200 | OK |
| `ListDetections` | 200 | 200 | OK |
| `GetDetection` | 200 | 200 | OK |
| `ListResponseResults` | 200 | 200 | OK |
| `ListResponseHistory` | 200 | 200 | OK |
| `GetElementOperationInfos` | 200 | 200 | OK |
| `ListBaselines` | 200 | 200 | OK |
| `GetBaseline` | 200 | 200 | OK |
| `ListBaselineTasks` | 200 | 200 | OK |
| `GetBaselineTaskStatus` | 200 | 200 | OK |
| `ListBaselineTaskResults` | 503 | 500 | Upstream error mapping verified |

## Validation

```bash
cd services
npm run validate -- --service-dir qingteng__hids_v5
npm test -- --service-dir qingteng__hids_v5 --coverage
npm run pack:check
```
