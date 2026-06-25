# Tencent Cloud DASB OctoBus Service

OctoBus package for Tencent Cloud Operation Security Center (DASB/Bastion Host) read-only and audit query APIs.

## Configuration

- `endpoint`: defaults to `https://dasb.tencentcloudapi.com`.
- `region`: optional Tencent Cloud region.
- `version`: defaults to `2019-10-18`.
- `timeoutMs`: HTTP timeout in milliseconds.
- `headers`: optional additional HTTP headers.

## Secrets

- `secretId`: Tencent Cloud API SecretId.
- `secretKey`: Tencent Cloud API SecretKey.
- `token`: optional temporary credential token.

`InvokeReadOnlyAction` only allows Tencent Cloud DASB `Describe*` and `Search*` actions.
