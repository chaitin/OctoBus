# DPtech UMC ADS V5.3.29 OctoBus Service

This package preserves legacy gRPC package and method names where applicable.

Import it into OctoBus with:

```bash
octobus service import --id dptech-umc-ads-v5-3-29 ./services/dptech__umc-ads_v5-3-29
```

## Service Metadata

- Vendor/product/version: DPtech UMC ADS V5.3.29 REST API.
- Service name: `dptech-umc-ads-v5-3-29`.
- Service dir: `services/dptech__umc-ads_v5-3-29`.
- Runtime mode: `long-running`.
- Runtime inspect: `node bin/dptech-umc-ads-v5-3-29.js --runtime inspect --json`.

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/dptech_umc_ads_v5_3_29.proto`: gRPC API definition.
- `config.schema.json`: non-secret endpoint, username, timeout, TLS, and extra header settings.
- `secret.schema.json`: DPtech UMC ADS password and optional username fields.
- `src/dptech-umc-ads-v5-3-29.js`: DPtech UMC ADS REST proxy implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/dptech-umc-ads-v5-3-29.js`: service-local executable entrypoint.
- `test/dptech-umc-ads-v5-3-29.test.js`: node:test coverage for login caching, request mapping, secret handling, validation, error classification, and SDK handler invocation.
- `test/mock_upstream.js`: optional local DPtech UMC ADS HTTP mock.

## Configuration

Use `host` for the DPtech UMC ADS base URL. Legacy aliases `baseUrl`, `base_url`, `restBaseUrl`, `rest_base_url`, and `endpoint` are also accepted.

```json
{
  "host": "https://203.0.113.10:8443",
  "user": "api-user",
  "timeoutMs": 5000,
  "skipTlsVerify": false,
  "headers": {
    "X-Trace": "demo"
  }
}
```

Use `secret.password`, `secret.pass`, or `secret.secret` for the login secret key. `secret.user` or `secret.username` may carry the username when needed:

```json
{
  "password": "replace-with-secret-key"
}
```

## RPC Methods

- `DPtech_UMC_ADS_v5329.DPtech_UMC_ADS_v5329/Login` - write/session setup, authenticates and caches a token internally.
- `DPtech_UMC_ADS_v5329.DPtech_UMC_ADS_v5329/QueryBlacklist` - read, queries blacklist records.
- `DPtech_UMC_ADS_v5329.DPtech_UMC_ADS_v5329/AddBlacklist` - write, adds blacklist IPs.
- `DPtech_UMC_ADS_v5329.DPtech_UMC_ADS_v5329/DeleteBlacklist` - write, removes blacklist IPs.

## Behavior Notes

- `Login` calls the UMC token API with `userName` and `secretKey`, then caches a successful token per OctoBus instance and host. The login response intentionally leaves raw fields empty because the upstream body contains the token.
- `QueryBlacklist`, `AddBlacklist`, and `DeleteBlacklist` require a prior successful `Login`; deprecated request token fields are ignored.
- Non-login upstream HTTP responses, including non-2xx statuses, are returned as gRPC OK payloads with `http_status`; legacy `raw_body` and `raw_json` fields are intentionally empty to avoid leaking token-bearing upstream bodies.
- Network failures and local validation errors return gRPC errors.
- Add/delete requests accept 1 to 100 IPv4 or IPv6 addresses. CIDR and address ranges are rejected.
- Add requests generate `strategyName`, `protectionName`, and the fixed DPtech strategy fields used by the legacy service.
- Cached tokens are cleared when an upstream business RPC returns HTTP 401 or 403.
- `timeoutMs` is enforced with `AbortController`; `skipTlsVerify` uses a per-request undici dispatcher and does not change global TLS settings.
- Known limitation: the business RPCs depend on instance-local cached login state, so callers should call `Login` before query/add/delete after runtime restart.

## OctoBus Usage

```bash
octobus service import --id dptech-umc-ads-v5-3-29 ./services/dptech__umc-ads_v5-3-29
octobus instance create dptech-umc-ads --service dptech-umc-ads-v5-3-29 \
  --config-json '{"host":"https://ads.example:8443","user":"api-user","timeoutMs":5000,"skipTlsVerify":false}' \
  --secret-json '{"password":"REDACTED"}'
octobus capset create ads-blacklist
octobus capset add-instance ads-blacklist dptech-umc-ads

curl -X POST http://127.0.0.1:9000/capsets/ads-blacklist/connect/dptech-umc-ads/DPtech_UMC_ADS_v5329.DPtech_UMC_ADS_v5329/Login \
  -H 'Content-Type: application/json' \
  -d '{}'
```

## Local Checks

```bash
cd services
npm run validate -- --service-dir dptech__umc-ads_v5-3-29
npm test -- --service-dir dptech__umc-ads_v5-3-29 --coverage
npm run pack:check
```
