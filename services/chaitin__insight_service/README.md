# Chaitin Insight Service

[简体中文](README.zh-CN.md)

Community OctoBus service package for the public Chaitin Insight (鉴微) API capabilities exposed by [`chaitin-cli/products/insight`](https://github.com/chaitin/chaitin-cli/tree/b6f6a3fc6b5b15170eac75112dc6722da09394ab/products/insight).

This package exposes explicit RPCs instead of the CLI's generic raw-request command, so OctoBus capsets can authorize each capability independently.

## Interface source

- Reference repository: `chaitin/chaitin-cli`
- Reference commit: `b6f6a3fc6b5b15170eac75112dc6722da09394ab`
- Reference license: GPL-3.0
- Implementation: original JavaScript code using the request paths and payloads published in that reference
- Runtime dependencies: `@chaitin-ai/octobus-sdk`, `@bufbuild/protobuf`, and `undici`; no proprietary SDK is included

This package does not include private API documentation, vendor source, captured traffic, customer data, or credentials. Methods that are not explicitly implemented by the cited public CLI are intentionally absent.

## Configuration

Config:

```json
{
  "baseUrl": "https://insight.example.com",
  "rpcPath": "/pedestal/rpc",
  "timeoutMs": 10000,
  "skipTlsVerify": false,
  "sendJwtCookie": true
}
```

Secret:

```json
{
  "token": "<authorized-insight-api-token>"
}
```

The token is sent as both `Authorization: Bearer ...` and the `jwt` cookie by default, matching the public CLI. Disable `sendJwtCookie` only if the target deployment does not require the cookie. Enable `skipTlsVerify` only for a controlled private deployment with a self-signed certificate.

## RPCs

| Group | RPC | Public CLI mapping | Mutation |
| --- | --- | --- | --- |
| Connectivity | `HealthCheck` | `AssetMgrService.SoftwareAssetOverviewList` | No |
| Tasks | `ListTasks` | `ScanTaskService.SearchTaskList` | No |
| Tasks | `StartTask` | `POST /exposure/api/task/reexecute` | Yes |
| Tasks | `StopTask` | `POST /exposure/api/task/stop` | Yes |
| Tasks | `GetTaskStatus` | `GET /exposure/api/task/execution?id=...` | No |
| Assets | `ListIpAssets` | `AssetMgrService.IpAssetList` | No |
| Assets | `ListWebAssets` | `AssetMgrService.WebsiteAssetList` | No |
| Assets | `ListSoftwareAssets` | `AssetMgrService.SoftwareAssetOverviewList` | No |
| Assets | `ListAssetTags` | `AssetMgrService.AssetTagList` | No |
| Assets | `ListAssetBusinesses` | `AssetMgrService.AssetBusinessList` | No |
| Vulnerabilities | `ListIpVulnerabilities` | `ScanVulnIpService.SearchScanVulnIpList` | No |
| Vulnerabilities | `ListWebVulnerabilities` | `ScanVulnIpService.SearchScanVulnWebList` | No |
| Results | `ListTaskResults` | `GET /exposure/api/result` | No |
| Results | `CompareTaskResults` | `GET /exposure/api/result/comparison?exec_id=...` | No |
| Results | `GetAssetSnapshot` | `GET /exposure/api/snapshot/asset` | No |
| Workflow | `ListOrders` | `GET /workflow/api/orders/all` | No |
| System | `GetLicense` | `GET /mgt/api/license` | No |
| System | `GetMachineId` | `GET /mgt/api/noauth/machine_id` | No |

`StartTask` is non-idempotent. `StopTask` is not guaranteed to be idempotent. Neither method is automatically retried; after an ambiguous result, inspect task execution state before issuing another mutation. Restrict both methods to trusted method-level capsets.

Responses use `google.protobuf.Value` because the public CLI deliberately preserves the deployment's JSON response shape.

## Development

From the repository's `services` directory:

```bash
npm run validate -- --service-dir chaitin__insight_service
npm test -- --service-dir chaitin__insight_service
npm test -- --service-dir chaitin__insight_service --coverage
```

Users must have authorization from the Insight deployment owner and remain responsible for applicable product license, audit, rate-limit, and terms-of-service requirements.
