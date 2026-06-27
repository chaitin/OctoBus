# Cortex OctoBus Service

This package provides OctoBus integration for Cortex (TheHive-Project) observable analysis engine.

Import it into OctoBus with:

```bash
octobus service import --id cortex ./services/thehive__cortex
```

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/cortex.proto`: gRPC API definition.
- `config.schema.json`: non-secret endpoint, headers, timeout, and TLS settings.
- `secret.schema.json`: Cortex API key or Basic Auth credentials.
- `src/cortex.js`: Cortex REST proxy implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/cortex.js`: service-local executable entrypoint.
- `test/cortex.test.js`: node:test coverage for request validation, REST mapping, error mapping, and SDK handler invocation.
- `test/mock_upstream.js`: optional local Cortex HTTP mock.

## Configuration

Use `endpoint` for the Cortex REST API base URL. Legacy aliases `restBaseUrl`, `rest_base_url`, `baseUrl`, and `base_url` are also accepted.

```json
{
  "endpoint": "http://localhost:9002",
  "headers": {
    "X-Extra": "demo"
  },
  "timeoutMs": 5000,
  "skipTlsVerify": false
}
```

Cortex supports two authentication methods. Use `secret.apiKey` for Bearer token auth (preferred), or `secret.username`/`secret.password` for Basic Auth (fallback):

```json
{
  "apiKey": "replace-with-cortex-api-key"
}
```

or:

```json
{
  "username": "admin",
  "password": "secret"
}
```

Request-level `api_key` takes precedence over secret-level `apiKey`, which takes precedence over `username`/`password` Basic Auth.

## RPC Methods

- `TheHive_CORTEX.TheHive_CORTEX/ListAnalyzers` — List available analyzers, optionally filtered by observable type.
- `TheHive_CORTEX.TheHive_CORTEX/AnalyzeObservable` — Submit an observable to a specific analyzer for analysis.
- `TheHive_CORTEX.TheHive_CORTEX/GetJobReport` — Get full analysis report for a completed job.
- `TheHive_CORTEX.TheHive_CORTEX/ListJobs` — List analysis jobs with filtering.
- `TheHive_CORTEX.TheHive_CORTEX/GetJobStatus` — Get status of analysis jobs (single or batch).

## Observable Data Types

Cortex supports the following observable `data_type` values:

| Type | Description |
|------|-------------|
| `ip` | IP address |
| `domain` | Domain name |
| `url` | URL |
| `hash` | File hash (MD5/SHA1/SHA256) |
| `mail` | Email address |
| `filename` | File name |
| `file` | File (with attachment) |
| `fqdn` | Fully qualified domain name |
| `uri` | URI |
| `autonomous-system` | ASN |
| `path` | File path |
| `other` | Other observable type |

## Job Status Values

| Status | Description |
|--------|-------------|
| `Waiting` | Job is queued |
| `InProgress` | Job is running |
| `Success` | Analysis completed successfully |
| `Failure` | Analysis failed |
| `Deleted` | Job has been deleted |

## Behavior Notes

- `ListAnalyzers` calls `GET /api/analyzer` or `GET /api/analyzer/type/:dataType` depending on whether a `data_type` filter is provided.
- `AnalyzeObservable` calls `POST /api/analyzer/:analyzerId/run` with `{ data, dataType, tlp, message, parameters }` JSON body.
- `GetJobReport` calls `GET /api/job/:jobId/report` and maps the response to structured `summary`, `full`, `operations`, and `artifacts` fields.
- `ListJobs` calls `GET /api/job` with query parameters `dataTypeFilter`, `dataFilter`, `analyzerFilter`, `range`.
- `GetJobStatus` calls `GET /api/job/:jobId` for single status or `POST /api/job/status` for batch status.
- Auth priority: request `api_key` → secret `apiKey` (Bearer) → secret `username`/`password` (Basic).
- HTTP 401/403 maps to `PERMISSION_DENIED`.
- Other HTTP 4xx responses map to `FAILED_PRECONDITION`.
- HTTP 5xx, network, and TLS failures map to `UNAVAILABLE`.
- Non-JSON success bodies map to `UNKNOWN`.

## Local Checks

```bash
cd services
npm run validate -- --service-dir thehive__cortex
npm test -- --service-dir thehive__cortex --coverage
npm run pack:check
```
