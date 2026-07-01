# Hillstone FW V5.5R10 OctoBus Service

This package preserves legacy gRPC package and method names where applicable.

Import it into OctoBus with:

```bash
octobus service import --id hillstone-fw-v5-5-r10 ./services/hillstone__fw_v5-5-r10
```

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/hillstone_fw_v5_5_r10.proto`: gRPC API definition.
- `config.schema.json`: Hillstone host, username, timeout, TLS, and extra header settings.
- `secret.schema.json`: Hillstone username and password settings.
- `src/hillstone-fw-v5-5-r10.js`: Hillstone login and address-book implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/hillstone-fw-v5-5-r10.js`: service-local executable entrypoint.
- `test/hillstone-fw-v5-5-r10.test.js`: node:test coverage for login/session caching, address group mutations, query encoding, HTTP body wrapping, and SDK handler invocation.
- `test/mock_upstream.js`: optional local Hillstone HTTP API mock.

## Configuration

Every RPC accepts `host` in the request for legacy compatibility. New instances should place `username` in config or secret and `password` in secret. Deprecated `LoginRequest.username` and `LoginRequest.password` are ignored by the handler.

```json
{
  "host": "https://203.0.113.10:8443",
  "username": "api_user",
  "timeoutMs": 5000,
  "headers": {
    "X-Custom": "value"
  }
}
```

```json
{
  "password": "replace-with-password"
}
```

## RPC Methods

- `HILLSTONE_FW_V55R10.HILLSTONE_FW_V55R10/Login`
- `HILLSTONE_FW_V55R10.HILLSTONE_FW_V55R10/AddAddressGroup`
- `HILLSTONE_FW_V55R10.HILLSTONE_FW_V55R10/OverwriteAddressGroup`
- `HILLSTONE_FW_V55R10.HILLSTONE_FW_V55R10/QueryAddressGroup`

## Behavior Notes

- `Login` posts fixed Hillstone login fields and caches the latest successful session by OctoBus instance and host. Its response only returns HTTP status and does not expose the upstream token or raw login body.
- Address-group mutation and query RPCs require a prior successful `Login` for the same instance and host.
- Upstream HTTP failures still return gRPC OK and preserve upstream `http_status` and response body semantics, matching the legacy service.
- HTTP 401 and 403 on address-book calls clear the cached session.
- JSON upstream bodies are returned as protobuf `Value`; non-JSON bodies are preserved in `raw_text`.
- `host` must be an HTTP or HTTPS URL with an explicit port and no path, query, or fragment.

## Local Checks

```bash
cd services
npm run validate -- --service-dir hillstone__fw_v5-5-r10
npm test -- --service-dir hillstone__fw_v5-5-r10 --coverage
npm run pack:check
```

## Service Contract

- Service name: `hillstone-fw-v5-5-r10`
- Service dir: `services/hillstone__fw_v5-5-r10`
- Runtime mode: `long-running`
- Config: `host` with explicit port is required; `username`, `timeoutMs`, `skipTlsVerify`, and `headers` are optional.
- Secret: `password` is required; `username` or `user` may be supplied in secret.
- RPC read/write properties:
  - `Login`: write/session setup, logs in and caches the device session.
  - `AddAddressGroup`: write, adds an address-group definition.
  - `OverwriteAddressGroup`: write, replaces an address-group definition.
  - `QueryAddressGroup`: read, queries an address group by name and pagination fields.

OctoBus example:

```bash
octobus service import --id hillstone-fw-v5-5-r10 ./services/hillstone__fw_v5-5-r10
octobus instance create hillstone-fw-v5-5-r10 hillstone-r10-demo --config config.json --secret secret.json
octobus capset create security-devices
octobus capset add-instance security-devices hillstone-r10-demo
```

Connect path example: `/capsets/security-devices/connect/hillstone-r10-demo/HILLSTONE_FW_V55R10.HILLSTONE_FW_V55R10/QueryAddressGroup`.

Known limitations: address-group RPCs require a prior `Login`. Some legacy successful responses expose non-sensitive response body structure for compatibility; login tokens, cookies, and raw login bodies are not returned. `skipTlsVerify` is per request.
