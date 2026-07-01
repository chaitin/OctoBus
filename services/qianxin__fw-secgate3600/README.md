# QIANXIN FW SecGate3600

This package preserves legacy gRPC package and method names where applicable.

## Import

```bash
octobus service import --id qianxin-fw-secgate3600 ./services/qianxin__fw-secgate3600
```

## Service Metadata

- Vendor/product/version: QIANXIN SecGate3600 firewall REST API.
- Service name: `qianxin-fw-secgate3600`.
- Service dir: `services/qianxin__fw-secgate3600`.
- Runtime mode: `long-running`.
- Runtime inspect: `node bin/qianxin-fw-secgate3600.js --runtime inspect --json`.

## Behavior

- Configure `host` in instance config and `user`/`password` in instance secret. Legacy `LoginRequest.username`, `LoginRequest.password`, and `LogoutRequest.username` are deprecated and ignored for credentials.
- `QIANXIN_FW_SecGate3600.QIANXIN_FW_SecGate3600/Login` - write/session setup, maps to `POST /v1.0/login` and caches the returned token plus cookies internally per engine instance and host.
- `QIANXIN_FW_SecGate3600.QIANXIN_FW_SecGate3600/UpdateAddressGroup` - write, maps to `POST /v1.0/rest/`, requires a prior successful `Login`, and sends the normalized object-address payload as a JSON array.
- `QIANXIN_FW_SecGate3600.QIANXIN_FW_SecGate3600/Logout` - write/session cleanup, maps to `POST /v1.0/out`, reuses the cached cookie header, and clears the cached session.
- Login and logout responses do not return token, cookies, raw login body, raw JSON, `Set-Cookie`, or `Authorization`. Retained raw/header proto fields are deprecated and returned empty.
- Device JSON responses are mapped even when the HTTP status is an upstream error; transport, empty-body, malformed JSON, and invalid schema errors return non-OK gRPC errors.
- `timeoutMs` is enforced with `AbortController`; `skipTlsVerify` uses a per-request undici dispatcher and does not change global TLS settings.
- Known limitation: the package only updates object address groups. It does not expose generic firewall policy operations.

## Config And Secret

Config:

```json
{
  "host": "https://198.51.100.10:8443",
  "timeoutMs": 5000,
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
octobus service import --id qianxin-fw-secgate3600 ./services/qianxin__fw-secgate3600
octobus instance create secgate3600 --service qianxin-fw-secgate3600 \
  --config-json '{"host":"https://secgate.example:8443","timeoutMs":5000,"skipTlsVerify":false}' \
  --secret-json '{"user":"api_user","password":"REDACTED"}'
octobus capset create secgate-address-groups
octobus capset add-instance secgate-address-groups secgate3600

curl -X POST http://127.0.0.1:9000/capsets/secgate-address-groups/connect/secgate3600/QIANXIN_FW_SecGate3600.QIANXIN_FW_SecGate3600/Login \
  -H 'Content-Type: application/json' \
  -d '{}'
```

## Local Checks

```bash
cd services
npm run validate -- --service-dir qianxin__fw-secgate3600
npm test -- --service-dir qianxin__fw-secgate3600 --coverage
npm run pack:check
```
