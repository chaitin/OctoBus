# Volcengine WAF OctoBus Service

OctoBus package for Volcengine Web Application Firewall read-only query APIs.

## Configuration

- `region`: defaults to `cn-beijing`.
- `timeoutMs`: HTTP timeout in milliseconds.
- `headers`: optional additional HTTP headers.
- `endpoint`: optional endpoint override.

## Secrets

- `accessKeyId`: Volcengine AccessKeyID.
- `secretAccessKey`: Volcengine SecretAccessKey.
- `sessionToken`: optional temporary security token.

`InvokeReadOnlyAction` only allows read-style WAF actions (`Get*`, `Desc*`, `Describe*`, `List*`, `Query*`, `Search*`) for the Volcengine WAF service.
