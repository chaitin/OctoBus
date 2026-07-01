# CloudAtlas OctoBus Service

CloudAtlas attack surface management and threat intelligence API wrapper.

## Service

- Service name: `cloudatlas`
- Service dir: `chaitin__cloudatlas`
- Runtime mode: `long-running`
- Proto: `proto/cloudatlas.proto`

## Config

```json
{
  "baseUrl": "https://cloudatlas.example.com",
  "space": 1,
  "timeoutMs": 15000,
  "skipTlsVerify": false
}
```

`headers` may be used for non-secret extra HTTP headers required by a private deployment.

## Secret

```json
{
  "token": "cloudatlas-api-token"
}
```

Store credentials in instance secret. Do not put tokens in RPC request payloads.

## RPC Overview

The service exposes CloudAtlas asset, seed, vulnerability, monitoring, leak intelligence, task, tag, and business unit methods declared in `proto/cloudatlas.proto`. The SDK CLI names are listed in `service.json`.

Representative read methods include `ListEnterpriseSubjects`, `ListSubdomains`, `ListDNS`, `ListIPs`, `ListVulnerabilities`, `ListGithubLeaks`, and `ListTaskInstances`. Write methods include batch create/update/delete operations for CloudAtlas resources and should be exposed only to trusted capsets.

All RPCs are unary. Read RPCs use CloudAtlas `GET` list/detail APIs. Write RPCs use CloudAtlas batch create, update, delete, task creation, or monitoring-rule creation APIs and can change upstream asset-management state.

## Local Checks

```bash
cd services
npm run validate -- --service-dir chaitin__cloudatlas
npm test -- --service-dir chaitin__cloudatlas
```

## OctoBus Example

```bash
octobus service import cloudatlas ./services/chaitin__cloudatlas
octobus instance create cloudatlas-prod --service cloudatlas \
  --config-json '{"baseUrl":"https://cloudatlas.example.com","timeoutMs":15000}' \
  --secret-json '{"token":"cloudatlas-api-token"}'
octobus capset create asm --name "Attack Surface"
octobus capset add-instance asm cloudatlas-prod
```

Call unary RPCs through Connect or gRPC using the method names in `proto/cloudatlas.proto`, for example `POST /capsets/asm/connect/cloudatlas-prod/CloudAtlas.CloudAtlas/ListIPs`.

## Limits

- `skipTlsVerify` is intended only for private test deployments.
- Batch create, update, and delete RPCs modify upstream CloudAtlas data.
- Timeout uses AbortController and TLS skip uses a per-request dispatcher; neither behavior disables global TLS verification.
- Errors do not include the bearer token or complete upstream raw response body.
