# DPtech EDS OctoBus Service

This package preserves legacy gRPC package and method names where applicable.

Import it into OctoBus with:

```bash
octobus service import --id dptech-eds ./services/dptech__eds
```

## Service Metadata

- Vendor/product/version: DPtech EDS blacklist/address-group API.
- Service name: `dptech-eds`.
- Service dir: `services/dptech__eds`.
- Runtime mode: `long-running`.
- Runtime inspect: `node bin/dptech-eds.js --runtime inspect --json`.

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/dptech_eds.proto`: gRPC API definition.
- `config.schema.json`: non-secret endpoint, username, timeout, TLS, and extra header settings.
- `secret.schema.json`: DPtech EDS Basic Auth password and optional username fields.
- `src/dptech-eds.js`: DPtech EDS REST proxy implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/dptech-eds.js`: service-local executable entrypoint.
- `test/dptech-eds.test.js`: node:test coverage for validation, IPv4/IPv6 request mapping, error classification, idempotent unblock, aggregation, and SDK handler invocation.
- `test/mock_upstream.js`: optional local DPtech EDS HTTP mock.

## Configuration

Use `host` for the DPtech EDS base URL. Legacy aliases `baseUrl`, `base_url`, `restBaseUrl`, `rest_base_url`, `url`, and `endpoint` are also accepted.

```json
{
  "host": "https://eds.example.net:8443",
  "user": "api-user",
  "timeoutMs": 5000,
  "skipTlsVerify": false,
  "headers": {
    "X-Trace": "demo"
  }
}
```

Use `secret.password`, `secret.pass`, or `secret.secret` for the Basic Auth password. `secret.user` or `secret.username` may carry the username when needed:

```json
{
  "password": "replace-with-password"
}
```

## RPC Methods

- `DPtech_EDS.DPtech_EDS/BatchBlockIPs` - write, adds IPv4/IPv6 addresses to one or more address groups.
- `DPtech_EDS.DPtech_EDS/BatchUnblockIPs` - write, removes IPv4/IPv6 addresses from one or more address groups.

## Behavior Notes

- `BatchBlockIPs` splits each group into invalid, IPv4, and IPv6 buckets, then calls the corresponding DPtech EDS create endpoint per IP.
- `BatchUnblockIPs` calls the corresponding DPtech EDS delete endpoint per IP.
- Invalid IPs are returned as per-IP failures without making downstream requests.
- HTTP 401/403 maps to `FAILURE_CATEGORY_UNAUTHORIZED`.
- HTTP 5xx and network failures map to `FAILURE_CATEGORY_UPSTREAM_UNAVAILABLE`.
- Empty, non-JSON, or non-object HTTP 200 responses map to `FAILURE_CATEGORY_RESPONSE_REJECTED`.
- HTTP 200 payloads with an `error` field map to `FAILURE_CATEGORY_DEVICE_REJECTED`.
- Unblock responses containing not-found wording are treated as idempotent success.
- `timeoutMs` is enforced with `AbortController`; `skipTlsVerify` uses a per-request undici dispatcher and does not change global TLS settings.
- Authorization and password values are used only for Basic Auth request headers and are not returned in responses or structured error details.
- Known limitation: this service reports per-IP result categories instead of failing the whole batch for individual device rejections.

## OctoBus Usage

```bash
octobus service import --id dptech-eds ./services/dptech__eds
octobus instance create dptech-eds-prod --service dptech-eds \
  --config-json '{"host":"https://eds.example:8443","user":"api-user","timeoutMs":5000,"skipTlsVerify":false}' \
  --secret-json '{"password":"REDACTED"}'
octobus capset create eds-blacklist
octobus capset add-instance eds-blacklist dptech-eds-prod

curl -X POST http://127.0.0.1:9000/capsets/eds-blacklist/connect/dptech-eds-prod/DPtech_EDS.DPtech_EDS/BatchBlockIPs \
  -H 'Content-Type: application/json' \
  -d '{"request_id":"demo-1","groups":[{"address_group":"blocked","ip_addresses":["203.0.113.10"]}]}'
```

## Local Checks

```bash
cd services
npm run validate -- --service-dir dptech__eds
npm test -- --service-dir dptech__eds --coverage
npm run pack:check
```
