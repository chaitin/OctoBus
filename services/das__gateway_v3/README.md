# DAS Gateway V3 OctoBus Service

This package preserves legacy gRPC package and method names where applicable.

Import it into OctoBus with:

```bash
octobus service import --id das-gateway-v3 ./services/das__gateway_v3
```

## Service Metadata

- Vendor/product/version: DAS Gateway V3 management API.
- Service name: `das-gateway-v3`.
- Service dir: `services/das__gateway_v3`.
- Runtime mode: `long-running`.
- Runtime inspect: `node bin/das-gateway-v3.js --runtime inspect --json`.

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/das_gateway_v3.proto`: gRPC API definition.
- `config.schema.json`: non-secret host, username alias, and timeout settings.
- `secret.schema.json`: DAS Gateway V3 password and optional username fields.
- `src/das-gateway-v3.js`: DAS Gateway V3 REST proxy implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/das-gateway-v3.js`: service-local executable entrypoint.
- `test/das-gateway-v3.test.js`: node:test coverage for request validation, HTTP mapping, error mapping, and SDK handler invocation.
- `test/mock_upstream.js`: optional local DAS Gateway V3 HTTP mock.

## Configuration

Use `host` for the DAS Gateway V3 management base URL. Legacy aliases `endpoint`, `baseUrl`, and `base_url` are also accepted.

```json
{
  "host": "https://10.2.28.106:9090",
  "user": "admin",
  "timeoutMs": 2000
}
```

Use `secret.password` for the login password. `secret.user` or `secret.username` can carry the username when it should not be stored in config.

```json
{
  "password": "replace-with-password"
}
```

The service sends `Authorization: Basic <base64(user:password)>` to the downstream device.

## RPC Methods

- `DAS_Gateway_V3.DAS_Gateway_V3/BlockIP` - write, adds one or more IPs to the device blacklist.
- `DAS_Gateway_V3.DAS_Gateway_V3/UnblockIP` - write, removes one IP from the device blacklist.

## Behavior Notes

- `BlockIP` calls `POST {host}/api/v3/Objects/Blacklist`.
- `BlockIP` treats HTTP 2xx or a JSON `msg` containing `已存在` as success.
- `UnblockIP` calls `DELETE {host}/api/v3/Objects/Blacklist/blist/{ip}`.
- `UnblockIP` treats JSON `code` `1`, JSON `code` `404`, or HTTP `404` as success.
- Missing `host`, `user`, or `password` maps to `FAILED_PRECONDITION`.
- Empty IP inputs map to `INVALID_ARGUMENT`.
- Downstream connection failures map to `UNAVAILABLE`.
- Downstream non-JSON error responses map to `UNKNOWN`.
- `timeoutMs` is enforced with `AbortController`; `skipTlsVerify` is supported only through a per-request undici dispatcher and is intended for private lab devices.
- Error details and response fields must not include the Basic Auth password or Authorization header. Successful legacy body fields may contain the device's non-secret business body.
- Known limitation: this package only covers blacklist create/delete APIs and does not provide a read/list RPC.

## OctoBus Usage

```bash
octobus service import --id das-gateway-v3 ./services/das__gateway_v3
octobus instance create das-gateway --service das-gateway-v3 \
  --config-json '{"host":"https://gateway.example:9090","user":"admin","timeoutMs":2000,"skipTlsVerify":false}' \
  --secret-json '{"password":"REDACTED"}'
octobus capset create edge-blocking
octobus capset add-instance edge-blocking das-gateway

curl -X POST http://127.0.0.1:9000/capsets/edge-blocking/connect/das-gateway/DAS_Gateway_V3.DAS_Gateway_V3/BlockIP \
  -H 'Content-Type: application/json' \
  -d '{"ips":["203.0.113.10"]}'
```

## Local Checks

```bash
cd services
npm run validate -- --service-dir das__gateway_v3
npm test -- --service-dir das__gateway_v3 --coverage
npm run pack:check
```
