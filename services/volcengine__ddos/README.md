# Volcengine DDoS OctoBus Service

OctoBus package for Volcengine DDoS Protection read-only and audit query APIs.

## Configuration

- `region`: defaults to `cn-beijing`.
- `timeoutMs`: HTTP timeout in milliseconds.
- `headers`: optional additional HTTP headers.
- `endpoint`: optional endpoint override.

## Secrets

- `accessKeyId`: Volcengine AccessKeyID.
- `secretAccessKey`: Volcengine SecretAccessKey.
- `sessionToken`: optional temporary security token.

`InvokeReadOnlyAction` only allows read-style DDoS actions (`Get*`, `Desc*`, `Describe*`, `List*`, `Query*`) for the supported Volcengine DDoS service codes.
