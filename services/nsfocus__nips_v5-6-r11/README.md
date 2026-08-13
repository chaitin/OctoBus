# NSFOCUS NIPS V5.6R11

This package preserves legacy gRPC package and method names where applicable.

## Import

```bash
octobus service import --id nsfocus-nips-v5-6-r11 ./services/nsfocus__nips_v5-6-r11
```

## Service Metadata

- Vendor/product/version: NSFOCUS NIPS V5.6R11 REST API.
- Service name: `nsfocus-nips-v5-6-r11`.
- Service dir: `services/nsfocus__nips_v5-6-r11`.
- Runtime mode: `long-running`.
- Runtime inspect: `node bin/nsfocus-nips-v5-6-r11.js --runtime inspect --json`.

## Behavior

- Configure `host` in instance config and `user`/`password` in instance secret. Legacy `LoginRequest.username` and `LoginRequest.password` are deprecated and ignored.
- `Nsfocus_NIPS_V56R11.Nsfocus_NIPS_V56R11/Login` - write/session setup, maps to `POST /api/system/account/login/login` and caches cookie, `api_key`, and `security_key` internally per instance.
- `Nsfocus_NIPS_V56R11.Nsfocus_NIPS_V56R11/BlockIP` - write, adds one manual blacklist entry.
- `Nsfocus_NIPS_V56R11.Nsfocus_NIPS_V56R11/ListBlacklist` - read, lists manual blacklist entries.
- `Nsfocus_NIPS_V56R11.Nsfocus_NIPS_V56R11/UnblockByIds` - write, deletes manual blacklist entries by ID.
- `Nsfocus_NIPS_V56R11.Nsfocus_NIPS_V56R11/ApplyConfig` - write, applies pending configuration.
- `BlockIP`, `ListBlacklist`, `UnblockByIds`, and `ApplyConfig` require a prior `Login`.
- Signed query parameters are generated from `security_key`, `api_key`, timestamp, and REST URI.
- Login responses do not return cookie, `api_key`, `security_key`, raw login body, or raw JSON. Retained raw response proto fields are deprecated and returned empty.
- Any HTTP response with a non-empty JSON body returns gRPC OK with mapped status and message; transport, empty-body, and JSON parsing errors return non-OK gRPC errors.
- `timeoutMs` is enforced with `AbortController`; `skipTlsVerify` uses a per-request undici dispatcher and does not change global TLS settings.
- Known limitation: the runtime keeps session state in memory per instance. Call `Login` again after runtime restart or when the device expires the session.

## Config And Secret

Config:

```json
{
  "host": "https://198.51.100.10:8443",
  "timeoutMs": 1500,
  "skipTlsVerify": false
}
```

Secret:

```json
{
  "user": "api_user",
  "password": "REDACTED"
}
```

## OctoBus Usage

```bash
octobus service import --id nsfocus-nips-v5-6-r11 ./services/nsfocus__nips_v5-6-r11
octobus instance create nsfocus-nips --service nsfocus-nips-v5-6-r11 \
  --config-json '{"host":"https://nips.example:8443","timeoutMs":1500,"skipTlsVerify":false}' \
  --secret-json '{"user":"api_user","password":"REDACTED"}'
octobus capset create nips-blacklist
octobus capset add-instance nips-blacklist nsfocus-nips

curl -X POST http://127.0.0.1:9000/capsets/nips-blacklist/connect/nsfocus-nips/Nsfocus_NIPS_V56R11.Nsfocus_NIPS_V56R11/Login \
  -H 'Content-Type: application/json' \
  -d '{}'
```

## Local Checks

```bash
cd services
npm run validate -- --service-dir nsfocus__nips_v5-6-r11
npm test -- --service-dir nsfocus__nips_v5-6-r11 --coverage
npm run pack:check
```
