# Volcengine Cloud Firewall OctoBus Service

OctoBus package for Volcengine Cloud Firewall read-only query APIs.

## Configuration

- `region`: defaults to `cn-beijing`, as recommended by the Cloud Firewall OpenAPI docs.
- `timeoutMs`: HTTP timeout in milliseconds.
- `headers`: optional additional HTTP headers.
- `endpoint`: optional endpoint override.

## Secrets

- `accessKeyId`: Volcengine AccessKeyID.
- `secretAccessKey`: Volcengine SecretAccessKey.
- `sessionToken`: optional temporary security token.

`InvokeReadOnlyAction` only allows read-style Cloud Firewall actions (`Get*`, `Desc*`, `Describe*`, `List*`, `Query*`, `Search*`) and the approved asset query action `AssetList`.
