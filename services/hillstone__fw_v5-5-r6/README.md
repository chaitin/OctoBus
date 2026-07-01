# Hillstone FW V5.5R6

This package preserves legacy gRPC package and method names where applicable.

`Login` reads the management host from instance config and credentials from instance secret/config, caches the upstream session by OctoBus instance and host, and returns only `http_status`. Deprecated request cookie fields on address-group RPCs are ignored; create, update, and query use the cached session from a prior successful `Login`.

## Import

```bash
octobus service import --id hillstone-fw-v5-5-r6 ./services/hillstone__fw_v5-5-r6
```

## Local Checks

```bash
cd services
npm run validate -- --service-dir hillstone__fw_v5-5-r6
npm test -- --service-dir hillstone__fw_v5-5-r6 --coverage
npm run pack:check
```

## Service Contract

- Service name: `hillstone-fw-v5-5-r6`
- Service dir: `services/hillstone__fw_v5-5-r6`
- Runtime mode: `long-running`
- Config: `host` with scheme and port is required; `username`, `timeoutMs`, `skipTlsVerify`, and `headers` are optional. Host aliases include `restBaseUrl`, `baseUrl`, and `endpoint`.
- Secret: `password` is required; `username`, `userName`, or `user` may be supplied in secret.
- RPC read/write properties:
  - `Login`: write/session setup, logs in and caches the device session.
  - `CreateAddrGroup`: write, creates address groups from `addr_groups`.
  - `UpdateAddrGroup`: write, updates address groups from `addr_groups`.
  - `QueryAddrGroup`: read, queries an address group by name.

OctoBus example:

```bash
octobus service import --id hillstone-fw-v5-5-r6 ./services/hillstone__fw_v5-5-r6
octobus instance create hillstone-fw-v5-5-r6 hillstone-r6-demo --config config.json --secret secret.json
octobus capset create security-devices
octobus capset add-instance security-devices hillstone-r6-demo
```

Connect path example: `/capsets/security-devices/connect/hillstone-r6-demo/HILLSTONE_FW_V55R6.HILLSTONE_FW_V55R6/QueryAddrGroup`.

Known limitations: create, update, and query require a cached session from `Login`. Deprecated request cookie fields are ignored. `skipTlsVerify` is only for private/self-signed devices and is applied per request.
