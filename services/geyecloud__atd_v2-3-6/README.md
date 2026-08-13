# geyecloud-ATD OctoBus Service

Read-only OctoBus service adapter for the geyecloud-ATD / Advanced Threat Detection workbench API.

## Supported Product

- Product: geyecloud-ATD, shown by the UI as "高级威胁检测系统"
- API document: `ATD API接口汇总.pdf`
- Validated environment shape: `https://<host>:5443/workbenchApi/furious/...`

## Authentication

The UI login returns an `apiKey`. Runtime calls send it as the `api-key` header. The browser bundle also emits ATD request metadata headers:

- `api-key: <secret.apiKey>`
- `user-key: ""`
- `X-Ca-Timestamp`
- `X-Ca-Nonce`
- `X-Ca-Sign: md5(timestamp + nonce)`

The adapter does not store usernames or passwords.

## Configuration

```json
{
  "baseUrl": "https://192.0.2.10:5443",
  "skipTlsVerify": true,
  "timeoutMs": 10000
}
```

## Secret

```json
{
  "apiKey": "<masked>"
}
```

## Methods

| RPC | Upstream endpoint | Risk |
|---|---|---|
| `AggregateThreatEvents` | `POST /workbenchApi/furious/elasticSearch/aggregate` | read-only |
| `GetNetworkLogTimeTrend` | `POST /workbenchApi/furious/netWorkLog/timeTrend` | read-only |
| `GetNetworkLogDimensionStatistics` | `POST /workbenchApi/furious/netWorkLog/dimensionStatistics` | read-only |
| `ListNetworkLogs` | `POST /workbenchApi/furious/netWorkLog/list` | read-only |
| `GetNetworkLogDetail` | `POST /workbenchApi/furious/netWorkLog/details` | read-only |
| `ListFileDetectionLogs` | `POST /workbenchApi/furious/fileDetectionLog/list` | read-only |
| `GetFileDetectionLogDetail` | `POST /workbenchApi/furious/fileDetectionLog/details` | read-only |
| `GetFileDetectionSeverityStats` | `POST /workbenchApi/furious/fileDetectionLog/severityNumber` | read-only |
| `ListSceneMonitors` | `POST /workbenchApi/furious/sceneMonitor/querySceneMonitor` | read-only |
| `SearchSceneMonitorEvents` | `POST /workbenchApi/furious/sceneMonitor/searchFromMonitor` | read-only |
| `GetSituationOverview` | `GET /workbenchApi/furious/situationAwareness/...` | read-only |
| `SearchThreatEvents` | `POST /workbenchApi/furious/searchCenter/advanced/searchData` | read-only |
| `GetThreatEventDetail` | `POST /workbenchApi/furious/searchCenter/advanced/searchDataDetail` | read-only |

## Suggested Capset

Use this service in a read-only investigation capset, for example `geyecloud-atd-readonly-investigation`.

## Validation

Local checks:

```bash
npm test
npm run validate
npm run pack:check
```

Real API validation performed against the provided demo environment:

- Request: `POST /workbenchApi/furious/elasticSearch/aggregate`
- Headers: `api-key` masked, ATD signature headers present
- Body: `{"terms":"severity","tableName":"hw","from":1,"size":10,...}`
- Result: `HTTP 200`, `code: 200`, `msg: "success"`, aggregate buckets returned
- P0 expansion adds mocked coverage for file detection pagination, situation overview GET calls, and advanced threat search response mapping.

## Known Limits

- First version is intentionally read-only.
- Login automation is not part of the adapter because the current environment has captcha enabled. Provide an `apiKey` from login/API-key provisioning as the secret.
- The PDF contains many writable configuration and management APIs; those are deferred until a controlled write-test object and cleanup path are available.
