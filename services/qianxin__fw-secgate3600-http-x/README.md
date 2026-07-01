# QIANXIN FW SecGate3600 HTTP_X

This package preserves legacy gRPC package and method names where applicable.

## Import

```bash
octobus service import --id qianxin-fw-secgate3600-http-x ./services/qianxin__fw-secgate3600-http-x
```

## Service Metadata

- Vendor/product/version: QIANXIN SecGate3600 WebUI HTTP_X API.
- Service name: `qianxin-fw-secgate3600-http-x`.
- Service dir: `services/qianxin__fw-secgate3600-http-x`.
- Runtime mode: `long-running`.
- Runtime inspect: `node bin/qianxin-fw-secgate3600-http-x.js --runtime inspect --json`.

## Behavior

- Configure `host` in instance config and `user`/`password` in instance secret. Legacy `LoginRequest.user` and `LoginRequest.password` are deprecated and ignored.
- `QIANXIN_FW_SecGate3600_HTTP_X.QIANXIN_FW_SecGate3600_HTTP_X/Login` - write/session setup, maps to `GET /webui/login/auth` with the WebUI login query parameters built from instance secret.
- `QIANXIN_FW_SecGate3600_HTTP_X.QIANXIN_FW_SecGate3600_HTTP_X/BlockIP` - write, maps to `POST /webui/blacklist/set?uuid=...` with JSON body `{ ip, mask, desc? }`, using the uuid cached by a prior `Login` for the same instance, host, and user.
- `QIANXIN_FW_SecGate3600_HTTP_X.QIANXIN_FW_SecGate3600_HTTP_X/UnblockIP` - write, uses the same endpoint and adds `undo=1` to the JSON body.
- `UnblockIP` uses the cached login uuid as well. Deprecated request `uuid` fields are ignored.
- Login responses do not return cookies, raw login body, raw JSON, `Set-Cookie`, `Authorization`, or an effective URL containing credentials. Retained raw/header/effective URL proto fields are deprecated.
- Non-login HTTP responses are returned as normalized `DeviceHttpResponse` objects with status, sanitized response headers, empty legacy raw body, parsed JSON when safe, and a sanitized effective URL.
- `timeoutMs` is enforced with `AbortSignal.timeout`; `skipTlsVerify` uses a per-request undici dispatcher and does not change global TLS settings.
- Known limitation: this package covers the WebUI blacklist endpoint only and keeps the login uuid in memory per instance.

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
  "user": "admin",
  "password": "REDACTED"
}
```

## OctoBus Usage

```bash
octobus service import --id qianxin-fw-secgate3600-http-x ./services/qianxin__fw-secgate3600-http-x
octobus instance create secgate-http-x --service qianxin-fw-secgate3600-http-x \
  --config-json '{"host":"https://secgate-webui.example:8443","timeoutMs":5000,"skipTlsVerify":false}' \
  --secret-json '{"user":"admin","password":"REDACTED"}'
octobus capset create secgate-webui-blacklist
octobus capset add-instance secgate-webui-blacklist secgate-http-x

curl -X POST http://127.0.0.1:9000/capsets/secgate-webui-blacklist/connect/secgate-http-x/QIANXIN_FW_SecGate3600_HTTP_X.QIANXIN_FW_SecGate3600_HTTP_X/Login \
  -H 'Content-Type: application/json' \
  -d '{}'
```

## Local Checks

```bash
cd services
npm run validate -- --service-dir qianxin__fw-secgate3600-http-x
npm test -- --service-dir qianxin__fw-secgate3600-http-x --coverage
npm run pack:check
```
