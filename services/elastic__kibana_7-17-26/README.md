# Elastic Kibana 7.17.26 OctoBus Service

- Service name: `elastic-kibana-7-17-26`
- Service dir: `elastic__kibana_7-17-26`
- Runtime mode: `long-running`

Import it into OctoBus with:

```bash
octobus service import elastic-kibana-7-17-26 ./services/elastic__kibana_7-17-26
```

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/elastic_kibana_7_17_26.proto`: gRPC API definition.
- `config.schema.json`: Kibana endpoint, space, timeout, TLS, and header settings.
- `secret.schema.json`: Basic auth or API key fields.
- `src/elastic-kibana-7-17-26.js`: Kibana REST proxy implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/elastic-kibana-7-17-26.js`: service-local executable entrypoint.
- `test/elastic-kibana-7-17-26.test.js`: node:test coverage for request validation, REST mapping, auth, and error mapping.

## Configuration

Use `endpoint` for the Kibana base URL. Aliases `baseUrl`, `restBaseUrl`, and `host` are also accepted.

```json
{
  "endpoint": "http://kibana.example.com:5601",
  "spaceId": "default",
  "kbnVersion": "7.17.26",
  "timeoutMs": 1500,
  "skipTlsVerify": false
}
```

Use `secret.username` and `secret.password` for Basic authentication:

```json
{
  "username": "elastic",
  "password": "replace-with-password"
}
```

Alternatively, use `secret.apiKey` for Kibana API key authentication.

## RPC Methods

- `Elastic_Kibana_7_17_26.Elastic_Kibana_7_17_26/CheckStatus`
- `Elastic_Kibana_7_17_26.Elastic_Kibana_7_17_26/CallKibanaAPI`
- `Elastic_Kibana_7_17_26.Elastic_Kibana_7_17_26/FindSavedObjects`
- `Elastic_Kibana_7_17_26.Elastic_Kibana_7_17_26/ListDashboards`
- `Elastic_Kibana_7_17_26.Elastic_Kibana_7_17_26/FindRules`

## Behavior Notes

- `CheckStatus` calls `GET /api/status`.
- `CallKibanaAPI` calls any Kibana relative REST API path with `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, or `HEAD`.
- `FindSavedObjects` calls `GET /api/saved_objects/_find`.
- `ListDashboards` calls `GET /api/saved_objects/_find?type=dashboard`.
- `FindRules` calls `GET /api/alerting/rules/_find`.
- Read RPCs: `CheckStatus`, `FindSavedObjects`, `ListDashboards`, and `FindRules`.
- Write-capable RPC: `CallKibanaAPI` when `method` is `POST`, `PUT`, `PATCH`, or `DELETE`.
- If `spaceId` or request `space_id` is set, requests use `/s/{spaceId}/api/...`.
- `CallKibanaAPI.path` must be a relative Kibana path beginning with `/`; full URLs are rejected so the instance endpoint and credentials remain centrally configured.
- `CallKibanaAPI.body` is passed through as-is for non-GET/HEAD requests; `Content-Type: application/json` is added when a body is present unless explicitly overridden.
- `kbn-version` defaults to `7.17.26`; override it with `config.kbnVersion`, `config.headers["kbn-version"]`, or request headers.
- `CallKibanaAPI` accepts string request/response bodies. Binary multipart uploads and streaming downloads are not represented by this RPC shape.
- HTTP 401/403 maps to `PERMISSION_DENIED`.
- Other HTTP 4xx responses map to `FAILED_PRECONDITION`.
- HTTP 5xx, network, and response read failures map to `UNAVAILABLE`.
- Timeout uses AbortController and `skipTlsVerify` uses a per-request dispatcher; global TLS verification is not changed.
- Errors return HTTP status and body length only. They do not return the Basic password, API key, Authorization header, or complete upstream raw body.

## Known Limits

- `CallKibanaAPI` is intentionally broad and write-capable; grant it only to trusted capsets.
- Binary multipart uploads and streaming downloads are outside this RPC shape.

## Generic API Examples

Find index patterns:

```json
{
  "method": "GET",
  "path": "/api/saved_objects/_find",
  "query": {
    "type": "index-pattern",
    "per_page": "3"
  }
}
```

Call a write API:

```json
{
  "method": "POST",
  "path": "/api/saved_objects/index-pattern",
  "body": "{\"attributes\":{\"title\":\"logs-*\"}}"
}
```

`CallKibanaAPI` is intentionally constrained to relative Kibana paths and an allow-list of HTTP methods, but it is still a privileged generic API surface. Put write calls in a separate capset from read-only discovery methods and test them against a non-production space first.

## OctoBus Example

```bash
octobus instance create kibana-test --service elastic-kibana-7-17-26 \
  --config-json '{"endpoint":"http://kibana.example.com:5601","spaceId":"default","timeoutMs":1500}' \
  --secret-json '{"username":"elastic","password":"replace-with-password"}'
octobus capset create kibana-read --name "Kibana Read"
octobus capset add-instance kibana-read kibana-test
```

## Local Checks

```bash
cd services
npm run validate -- --service-dir elastic__kibana_7-17-26
npm test -- --service-dir elastic__kibana_7-17-26
npm test -- --service-dir elastic__kibana_7-17-26 --coverage
npm run pack:check
```
