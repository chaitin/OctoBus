# CloudWalker Adapter Design

## Goal

Build an OctoBus-format adapter for Chaitin CloudWalker / 牧云 API 3.0 under `services/chaitin__cloudwalker`.

The adapter must follow existing OctoBus service package conventions used by packages such as `qingteng__hids_v3-4`, `sangfor__xdr_v2-0-45`, and `chaitin__cloudatlas`.

## Source Material

- API document: `/Users/renchenhe/Desktop/牧云api文档.pdf`
- Extracted API behavior:
  - JSON-RPC 2.0 over `POST /rpc`
  - Request body: `{"jsonrpc":"2.0","method":"Service.Method","params":{...},"id":"..."}`
  - Authentication: `Cookie: API-Token=<token>`
  - Optional organization selector: `X-CW-OID: <orgId>`
  - Content type: `application/json`

## Package Layout

Create:

```text
services/chaitin__cloudwalker/
  README.md
  bin/cloudwalker.js
  config.schema.json
  package.json
  proto/cloudwalker.proto
  secret.schema.json
  service.json
  src/cloudwalker.js
  src/service.js
  test/cloudwalker.test.js
  test/mock_upstream.js
```

## Config And Secret

Config schema:

- `endpoint`: CloudWalker server URL, for example `https://192.168.1.3`
- `orgId`: optional organization ID; sent as `X-CW-OID`
- `timeoutMs`: request timeout, default `10000`
- `skipTlsVerify`: support self-signed private deployments

Secret schema:

- `apiToken`: CloudWalker API token

## RPC Scope

First version exposes read-only RPCs:

| OctoBus RPC | CloudWalker JSON-RPC method |
| --- | --- |
| `GetCurrentTime` | `CloudwalkerSettingService.GetCurrentTime` |
| `ListHosts` | `HostAssetService.GetHostAssetList` |
| `GetHostDetail` | `HostAssetService.GetHostInfoDetail` |
| `ListMalwareEvents` | `MalwareEventService.GetEventList` |
| `ListBruteForceEvents` | `BruteForceService.GetEventList` |
| `ListWebshellEvents` | `WebshellEventService.GetEventList` |
| `ListRevshellEvents` | `RevshellEventService.GetEventList` |
| `ListAbnormalLoginEvents` | `AbnormalLoginEventService.GetEventList` |
| `ListRealTimeThreatEvents` | `ThreatOverviewService.ListRealTimeEvents` |

The list-style RPCs accept generic pagination and filters:

- `count`
- `offset`
- `order_by`
- `filters`

`GetHostDetail` accepts `id`.

## Response Shape

To avoid overfitting the first version to a 1726-page API document, responses keep upstream data raw:

- `http_status`
- `raw_body`
- `result`

JSON-RPC errors are surfaced as OctoBus gRPC errors with the upstream error body preserved in the message.

## Testing

Unit tests must verify:

- Endpoint normalization
- Required token validation
- JSON-RPC request body construction
- `Cookie: API-Token=...`
- Optional `X-CW-OID`
- `skipTlsVerify`
- Mapping of all nine RPC paths to the expected CloudWalker method
- JSON-RPC error handling
- HTTP non-2xx handling

Live validation will use the deployment at `renchenhe@192.168.1.3`. It requires an API token from that environment; SSH credentials alone are not the API credential.
