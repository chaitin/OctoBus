# Volcengine Cloud Security Center OctoBus Service

OctoBus package for Volcengine Cloud Security Center read-only query APIs.

## Configuration

- `region`: defaults to `cn-beijing`.
- `timeoutMs`: HTTP timeout in milliseconds.
- `headers`: optional additional HTTP headers.
- `endpoint`: optional endpoint override.

## Secrets

- `accessKeyId`: Volcengine AccessKeyID.
- `secretAccessKey`: Volcengine SecretAccessKey.
- `sessionToken`: optional temporary security token.

`InvokeReadOnlyAction` only allows read-style Cloud Security Center actions (`Get*`, `Desc*`, `Describe*`, `List*`, `Query*`, `Search*`) and explicitly approved statistics actions for the Volcengine Cloud Security Center service.
