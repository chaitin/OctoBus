# Chaitin T-Answer NDR OctoBus Service

OctoBus service package for Chaitin T-Answer (TA, 全悉/Quanxi), an NDR/full-traffic detection product.

This package exposes security-operations APIs from the supplied product OpenAPI
document and the offline pcap detection web workflow. Network configuration and
user/permission administration APIs are intentionally excluded. High-frequency
read-only methods keep typed request fields; complex mutating methods use
`raw_params_json` to pass the upstream JSON-RPC params unchanged.

Core read-only methods include:

- `ListAlerts` -> `AlarmService.SearchAlarmList`
- `GetAlert` -> `AlarmService.GetAlarm`
- `GetAlertRawDocument` -> `AlarmService.GetAlarmDocument`
- `ListAssets` -> `AssetService.GetAssetList`
- `GetAsset` -> `AssetService.GetAssetInfo`
- `SearchAssetTree` -> `AssetService.SearchAssetTree`
- `ListAssetGroups` -> `AssetService.SearchGroups`
- `ListAssetTags` -> `AssetService.SearchTags`
- `ListDiscoveredAssets` -> `AssetIdentifyApi.SearchAssetIdentify`

## Configuration

`config.endpoint` is the management platform base URL:

```json
{
  "endpoint": "https://t-answer.example.com",
  "timeoutMs": 5000,
  "skipTlsVerify": true
}
```

`secret.apiToken` is sent as the `API-Token` header. Offline pcap upload and
task creation can also use service-held web console credentials:

```json
{
  "apiToken": "replace-with-device-api-token",
  "webUsername": "replace-with-web-username",
  "webPassword": "replace-with-web-password"
}
```

`skipTlsVerify` passes OctoBus-compatible per-request TLS options to the runtime.
When running this package directly with Node.js against a private certificate,
TLS verification can be disabled for the isolated service process with:

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0
```

## Import Into OctoBus

```bash
octobus service import t-answer-ndr ./services/chaitin__t-answer-ndr

octobus instance create t-answer-ndr-demo \
  --service t-answer-ndr \
  --config-json '{"endpoint":"https://t-answer.example.com","timeoutMs":5000,"skipTlsVerify":true}' \
  --secret-json '{"apiToken":"replace-with-device-api-token"}'

octobus capset create soc-agent --name SOCAgent
octobus capset add-instance soc-agent t-answer-ndr-demo
octobus catalog soc-agent --all --json
```

## Local CLI Example

```bash
OCTOBUS_SERVICE_CONTEXT='{"config":{"endpoint":"https://t-answer.example.com","timeoutMs":5000,"skipTlsVerify":true},"secret":{"apiToken":"replace-with-device-api-token"}}' \
node bin/t-answer-ndr.js list-assets --data-json '{"count":10,"offset":0}'
```

## Risk Boundary

This package contains write, delete, enable/disable, block-rule, whitelist, and
tcpdump operations. The service does not implement an extra `approval_token`
gate; query/write separation should be enforced by OctoBus capsets, capset token
distribution, and the calling agent's human-approval workflow. For routine
demonstrations, prefer read-only tools such as `ListAssets`, `ListAlerts`,
`SearchAssetTree`, `ListPcapDetectTasks`, and `ListTcpdumpProcesses`.

Recommended capset design:

- Read-only SOC capset: list/search/get/analyze/report methods.
- Operator capset: read-only methods plus scoped write methods such as pcap
  task creation, tcpdump task control, custom intelligence/rule maintenance,
  and response whitelist/block-rule operations.
- Exclude full-delete methods such as `DeleteAllFirewallWhiteList` and
  `DeleteAllBlockRules` unless the operator workflow explicitly requires them.

## Local Checks

```bash
cd services
npm run validate -- --service-dir chaitin__t-answer-ndr
npm test -- --service-dir chaitin__t-answer-ndr
npm pack --dry-run
```
