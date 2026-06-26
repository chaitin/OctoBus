# Tencent Cloud DSGC OctoBus Service

This package adapts Tencent Cloud Data Security Governance Center (DSGC) API 3.0 read-only operations for OctoBus.

## Configuration

`config.schema.json` accepts:

- `endpoint`: defaults to `https://dsgc.tencentcloudapi.com`.
- `region`: defaults to `ap-guangzhou`.
- `version`: defaults to `2019-07-23`.
- `language`: optional `X-TC-Language`.
- `timeoutMs`: request timeout in milliseconds.
- `headers`: optional extra HTTP headers.
- `allowActions`: extra read-only `Describe*`, `List*`, or `Get*` actions allowed by `InvokeReadOnlyAction`.
- `allowAllReadOnlyActions`: allow every `Describe*`, `List*`, or `Get*` action.

TLS certificate verification bypass is not supported by this Node.js fetch adapter.

`secret.schema.json` accepts:

- `secretId` or `secret_id`: Tencent Cloud SecretId.
- `secretKey` or `secret_key`: Tencent Cloud SecretKey.
- `token`: optional temporary security token.

## Methods

- `DescribeAssetOverview`
- `ListDSPAClusters`
- `DescribeDSPACOSDataAssetBuckets`
- `DescribeDSPARDBDataAssetByComplianceId`
- `DescribeDSPAESDataAssetByComplianceId`
- `DescribeDSPAAssessmentLatestRiskList`
- `DescribeDSPAAssessmentTasks`
- `DescribeReportTasks`
- `InvokeReadOnlyAction`

The adapter uses Tencent Cloud API 3.0 `TC3-HMAC-SHA256` signing. Dedicated methods and `InvokeReadOnlyAction` preserve the Tencent Cloud `Response` object and raw response envelope for troubleshooting.
