# NSFOCUS ADS V4.5R90F06

This package preserves legacy gRPC package and method names where applicable.

The legacy proto package spelling is preserved as `Nsfcous_ADS_V45R90F06` because it is part of the external gRPC method path.

## Import

```bash
octobus service import --id nsfocus-ads-v4-5-r90-f06 ./services/nsfocus__ads_v4-5-r90-f06
```

## Service Metadata

- Vendor/product/version: NSFOCUS ADS V4.5R90F06 unified interface API.
- Service name: `nsfocus-ads-v4-5-r90-f06`.
- Service dir: `services/nsfocus__ads_v4-5-r90-f06`.
- Runtime mode: `long-running`.
- Runtime inspect: `node bin/nsfocus-ads-v4-5-r90-f06.js --runtime inspect --json`.

## Behavior

- `Nsfcous_ADS_V45R90F06.Nsfcous_ADS_V45R90F06/BlockIP` - write, calls `/facade/unifiedInterface.php` with `target=blackList` and `action_type=add`.
- `Nsfcous_ADS_V45R90F06.Nsfcous_ADS_V45R90F06/UnblockIP` - write, calls the same upstream path with `action_type=delete`.
- `restBaseUrl` or `baseUrl` are read from instance config.
- `key` is read from instance secret. Deprecated config or legacy binding credentials are accepted only as lower-priority compatibility fallbacks.
- `BlockIP` treats `content.actionErrors[0]` containing `记录已在黑名单中` as idempotent success.
- `timeoutMs` is enforced with `AbortController`; `skipTlsVerify` uses a per-request undici dispatcher and does not change global TLS settings.
- Error details and response fields expose sanitized status/body summaries only and must not include `auth_key`.
- Known limitation: the package only exposes blacklist add/delete. It does not provide a list/read RPC.

## Configuration

Use `config` for the ADS base URL and HTTP settings:

```json
{
  "restBaseUrl": "https://ads.example",
  "timeoutMs": 5000,
  "headers": {
    "X-Custom": "value"
  },
  "skipTlsVerify": false
}
```

Use `secret` for the upstream `auth_key`:

```json
{
  "key": "replace-with-auth-key"
}
```

## OctoBus Usage

```bash
octobus service import --id nsfocus-ads-v4-5-r90-f06 ./services/nsfocus__ads_v4-5-r90-f06
octobus instance create nsfocus-ads --service nsfocus-ads-v4-5-r90-f06 \
  --config-json '{"restBaseUrl":"https://ads.example","timeoutMs":5000,"skipTlsVerify":false}' \
  --secret-json '{"key":"REDACTED"}'
octobus capset create ads-blocking
octobus capset add-instance ads-blocking nsfocus-ads

curl -X POST http://127.0.0.1:9000/capsets/ads-blocking/connect/nsfocus-ads/Nsfcous_ADS_V45R90F06.Nsfcous_ADS_V45R90F06/BlockIP \
  -H 'Content-Type: application/json' \
  -d '{"ip":"203.0.113.10"}'
```

## Local Checks

```bash
cd services
npm run validate -- --service-dir nsfocus__ads_v4-5-r90-f06
npm test -- --service-dir nsfocus__ads_v4-5-r90-f06 --coverage
npm run pack:check
```
