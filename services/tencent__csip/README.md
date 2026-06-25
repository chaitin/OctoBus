# Tencent Cloud CSIP OctoBus Service

OctoBus package for Tencent Cloud Cloud Security Center (CSIP) read-only APIs.

## Configuration

- `endpoint`: defaults to `https://csip.tencentcloudapi.com`.
- `region`: optional Tencent Cloud region.
- `version`: defaults to `2022-11-21`.
- `timeoutMs`: HTTP timeout in milliseconds.
- `headers`: optional additional HTTP headers.

## Secrets

- `secretId`: Tencent Cloud API SecretId.
- `secretKey`: Tencent Cloud API SecretKey.
- `token`: optional temporary credential token.

Only `Describe*` Tencent Cloud actions are allowed through `InvokeReadOnlyAction`.
