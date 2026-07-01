# Hillstone FW V5.5R4 OctoBus Service

This package preserves legacy gRPC package and method names where applicable.

Import it into OctoBus with:

```bash
octobus service import --id hillstone-fw-v5-5-r4 ./services/hillstone__fw_v5-5-r4
```

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/hillstone_fw_v5_5_r4.proto`: gRPC API definition.
- `config.schema.json`: Hillstone host, username, timeout, TLS, and extra header settings.
- `secret.schema.json`: Hillstone username and password settings.
- `src/hillstone-fw-v5-5-r4.js`: Hillstone login and address-book implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/hillstone-fw-v5-5-r4.js`: service-local executable entrypoint.
- `test/hillstone-fw-v5-5-r4.test.js`: node:test coverage for login payloads, cookie handling, address book serialization, query encoding, HTTP error mapping, and SDK handler invocation.
- `test/mock_upstream.js`: optional local Hillstone HTTP API mock.

## Configuration

Every RPC accepts `host` in the request for legacy compatibility. New instances may also place login defaults in config/secret bindings.

```json
{
  "host": "https://203.0.113.10:8443",
  "user_name": "hillstone-admin",
  "timeoutMs": 5000,
  "headers": {
    "X-Custom": "value"
  }
}
```

```json
{
  "password": "base64-or-legacy-encoded-password"
}
```

## RPC Methods

- `HILLSTONE_FW_V55R4.HILLSTONE_FW_V55R4/Login`
- `HILLSTONE_FW_V55R4.HILLSTONE_FW_V55R4/CreateAddressGroup`
- `HILLSTONE_FW_V55R4.HILLSTONE_FW_V55R4/UpdateAddressGroup`
- `HILLSTONE_FW_V55R4.HILLSTONE_FW_V55R4/QueryAddressGroup`

## Behavior Notes

- `Login` posts Hillstone `userName`, `password`, `ifVsysId`, `vrId`, and `lang` fields using instance config/secret credentials. Deprecated request username/password fields are ignored.
- `Login` caches the upstream session by OctoBus instance and host and returns only `http_status`; it does not expose the token or raw login body.
- Address-group create, update, and query RPCs use the cached session from a prior successful `Login`. Deprecated request cookie fields are ignored.
- Create and update serialize the full `address_books` array, including optional `range`, `entry`, and `host` arrays.
- HTTP 2xx responses return gRPC OK with raw `http_status` and `http_body`.
- HTTP 401 and 403 map to `PERMISSION_DENIED`; other 4xx statuses map to `FAILED_PRECONDITION`; 5xx and network failures map to `UNAVAILABLE`.

## Local Checks

```bash
cd services
npm run validate -- --service-dir hillstone__fw_v5-5-r4
npm test -- --service-dir hillstone__fw_v5-5-r4 --coverage
npm run pack:check
```

## Service Contract

- Service name: `hillstone-fw-v5-5-r4`
- Service dir: `services/hillstone__fw_v5-5-r4`
- Runtime mode: `long-running`
- Config: `host` with scheme and port is required; `user_name`, `timeoutMs`, `skipTlsVerify`, and `headers` are optional. Request `host` is retained for legacy compatibility.
- Secret: `password` is required for login; `user_name` or `userName` may be supplied in secret.
- RPC read/write properties:
  - `Login`: write/session setup, logs in and caches the session for the OctoBus instance.
  - `CreateAddressGroup`: write, creates address-book entries.
  - `UpdateAddressGroup`: write, updates address-book entries.
  - `QueryAddressGroup`: read, queries an address group by name.

OctoBus example:

```bash
octobus service import --id hillstone-fw-v5-5-r4 ./services/hillstone__fw_v5-5-r4
octobus instance create hillstone-fw-v5-5-r4 hillstone-r4-demo --config config.json --secret secret.json
octobus capset create security-devices
octobus capset add-instance security-devices hillstone-r4-demo
```

Connect path example: `/capsets/security-devices/connect/hillstone-r4-demo/HILLSTONE_FW_V55R4.HILLSTONE_FW_V55R4/Login`.

Known limitations: address-group RPCs require a prior successful `Login` for the same instance and host. Legacy response fields may preserve non-sensitive upstream body fields on 2xx responses; error paths use structured summaries. `skipTlsVerify` is per request.
