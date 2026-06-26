# Tencent Cloud CWP

OctoBus service package for Tencent Cloud Host Security (Cloud Workload Protection, CWP) API 3.0 read-only operations.

## Supported Version

- Product: Tencent Cloud Host Security / CWP.
- API document: Tencent Cloud CWP API 3.0.
- Endpoint: `https://cwp.tencentcloudapi.com`.
- API version: `2018-02-28`.
- Auth: Tencent Cloud API 3.0 `TC3-HMAC-SHA256` signature with `SecretId` and `SecretKey`.

## Configuration

Instance config example:

```json
{
  "endpoint": "https://cwp.tencentcloudapi.com",
  "region": "ap-guangzhou",
  "version": "2018-02-28",
  "timeoutMs": 5000
}
```

Aliases `host` and `baseUrl` are accepted for `endpoint`. TLS certificate verification bypass is not supported by this Node.js fetch adapter.

Instance secret example:

```json
{
  "secretId": "your-secret-id",
  "secretKey": "your-secret-key"
}
```

Aliases `secret_id` and `secret_key` are accepted. Temporary credentials can pass `token`, which is sent as `X-TC-Token`.

## Methods

| Method | Tencent Cloud Action | Notes |
| --- | --- | --- |
| `DescribeMachines` | `DescribeMachines` | Query protected machine list. Pass `MachineRegion` and `MachineType` in `params`; supports `offset` and `limit`. |
| `DescribeMachineGeneral` | `DescribeMachineGeneral` | Query machine overview statistics. |
| `DescribeMalWareList` | `DescribeMalWareList` | Query malware events. |
| `DescribeVulList` | `DescribeVulList` | Query vulnerability list. |
| `DescribeBaselineDetectOverview` | `DescribeBaselineDetectOverview` | Query baseline overview statistics. |
| `DescribeMachineRiskCnt` | `DescribeMachineRiskCnt` | Query intrusion detection event counts for machines. |
| `InvokeReadOnlyAction` | configured `Describe*` action | Calls a CWP `Describe*` action only when allowed by `allowActions`, or by `allowAllDescribeActions=true`. |

All request-specific Tencent Cloud parameters can be passed through `params` as JSON. List methods return `items`, `total_count`, and preserve the full Tencent Cloud `Response` in `response` and the full envelope in `raw`.

`DescribeMachines` example params:

```json
{
  "MachineRegion": "all-regions",
  "MachineType": "CVM"
}
```

## Risk Notes

- This package intentionally exposes read-only CWP actions by default.
- `InvokeReadOnlyAction` rejects non-`Describe*` actions and rejects unlisted actions unless `allowAllDescribeActions=true`.
- The adapter does not log request bodies, SecretId, SecretKey, session tokens, or signatures.
- API calls may still reveal sensitive host, vulnerability, malware, and baseline findings. Bind read-only capsets only to trusted SOC workflows.

## Suggested Capsets

- Asset inventory capset: `DescribeMachines`, `DescribeMachineGeneral`
- Detection review capset: add `DescribeMalWareList`, `DescribeVulList`, `DescribeMachineRiskCnt`
- Compliance review capset: add `DescribeBaselineDetectOverview`
- Controlled exploration capset: add `InvokeReadOnlyAction` with a narrow `allowActions` list

## Local Validation

From the repository root:

```bash
cd services
npm run validate -- --service-dir tencent__cwp
npm test -- --service-dir tencent__cwp
npm run pack:check
```

## Example

```bash
./bin/octobus service import tencent-cwp ./services/tencent__cwp
./bin/octobus instance create tencent-cwp-prod \
  --service tencent-cwp \
  --config-json '{"region":"ap-guangzhou","timeoutMs":5000}' \
  --secret-json '{"secretId":"your-secret-id","secretKey":"your-secret-key"}'
./bin/octobus capset create cwp-read --name CwpRead
./bin/octobus capset add-instance cwp-read tencent-cwp-prod
```
