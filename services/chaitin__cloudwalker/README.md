# CloudWalker

OctoBus adapter for Chaitin CloudWalker / 牧云云原生安全 JSON-RPC APIs.

This service covers the CloudWalker product line referenced by OctoBus issues
[#72](https://github.com/chaitin/OctoBus/issues/72) and
[#26](https://github.com/chaitin/OctoBus/issues/26).

## Configuration

`config.schema.json`:

- `endpoint`: CloudWalker server endpoint, for example `https://192.168.1.3`.
- `baseUrl` / `host`: aliases of `endpoint`.
- `orgId`: optional organization ID. When set, the adapter sends `X-CW-OID`.
- `timeoutMs`: optional HTTP timeout, default `15000`.
- `skipTlsVerify`: skip TLS verification for self-signed private deployments.
- `proxyUrl`: optional HTTP(S) proxy URL for local validation or proxied deployments.
- `headers`: optional extra headers.

`secret.schema.json`:

- `apiToken`: CloudWalker API token. The adapter sends it as `Cookie: API-Token=...`.

CloudWalker API 3.0 exposes JSON-RPC at `https://${SERVER_ADDR}/rpc`.

## RPC Mapping

- `GetCurrentTime` -> `CloudwalkerSettingService.GetCurrentTime`
- `ListHosts` -> `HostAssetService.GetHostAssetList`
- `GetHostDetail` -> `HostAssetService.GetHostInfoDetail`
- `ListMalwareEvents` -> `MalwareEventService.GetEventList`
- `ListBruteForceEvents` -> `BruteForceService.GetEventList`
- `ListWebshellEvents` -> `WebshellEventService.GetEventList`
- `ListRevshellEvents` -> `RevshellEventService.GetEventList`
- `ListAbnormalLoginEvents` -> `AbnormalLoginEventService.GetEventList`
- `ListRealTimeThreatEvents` -> `ThreatOverviewService.ListRealTimeEvents`

Responses keep the upstream result in `result` and include `http_status` and
`raw_body` for troubleshooting.

## Live Validation

Validated against `https://192.168.1.3/rpc` on 2026-06-28:

- HTTPS `/rpc` is reachable and returns JSON-RPC responses.
- HTTP `/rpc` is not the correct endpoint in this environment.
- A request without a valid `API-Token` cookie returns `{"code":1,"message":"需要登录"}` from CloudWalker.
- With a valid API token, `GetCurrentTime` succeeds and `ListHosts` returns one
  host: `renchenhe-virtual-machine` at `192.168.1.3`.

Local validation succeeds with direct access. `proxyUrl` is only needed in
environments that must reach CloudWalker through an HTTP(S) proxy.

OctoBus live validation on 2026-06-28:

- OctoBus host: `10.2.37.211`.
- Service: `cloudwalker`.
- Instance: `cloudwalker-live`.
- Capset: `cloudwalker-proof`.
- `GetCurrentTime` through Connect RPC returned HTTP 200.
- `ListHosts` through Connect RPC returned HTTP 200 and one host:
  `renchenhe-virtual-machine` at `192.168.1.3`.
- Access logs recorded `grpc_code=OK` for both calls.
- Evidence:
  - `evidence/live-validation-2026-06-28.txt`
  - `evidence/cloudwalker-platform-overview-2026-06-28.png`
