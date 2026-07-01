# Huawei FW USG6000E

This package preserves legacy gRPC package and method names where applicable.

## Import

```bash
octobus service import --id huawei-fw-usg6000e ./services/huawei__fw-usg6000e
```

## Behavior

`UpdateAddressGroup` performs one HTTPS `PUT` to replace a Huawei USG6000E address group with the requested full IPv4/IPv6 set. Empty `ipv4_list` and `ipv6_list` clear the group. Preview metadata (`preview_only`, `previewOnly`, `x-preview-only`, or `dry_run_preview`) returns status metadata without calling the upstream device.

Instance `config` supplies `host` and optional defaults such as `device_name`, `book_name`, timeout, TLS, and headers. Instance `secret` supplies `user` or `username` and `password`; deprecated request fields `host`, `user`, and `password` are ignored by the handler. Responses and error details do not include upstream raw bodies, request headers, request body, or credentials.

## Local Checks

```bash
cd services
npm run validate -- --service-dir huawei__fw-usg6000e
npm test -- --service-dir huawei__fw-usg6000e --coverage
npm run pack:check
```

## Service Contract

- Service name: `huawei-fw-usg6000e`
- Service dir: `services/huawei__fw-usg6000e`
- Runtime mode: `long-running`
- Config: `host` is required; `device_name`, `book_name`, `timeoutMs`, `skipTlsVerify`, and `headers` are optional. Deprecated `config.user` and `config.username` are fallback only.
- Secret: `password` is required; `user` or `username` is required unless provided as deprecated config fallback.
- RPC read/write properties:
  - `UpdateAddressGroup`: write, performs one RESTCONF `PUT` that replaces the configured address group with the supplied IPv4/IPv6 set. Preview metadata makes it a dry-run read-only planning response.

OctoBus example:

```bash
octobus service import --id huawei-fw-usg6000e ./services/huawei__fw-usg6000e
octobus instance create huawei-fw-usg6000e huawei-usg-demo --config config.json --secret secret.json
octobus capset create security-devices
octobus capset add-instance security-devices huawei-usg-demo
```

Connect path example: `/capsets/security-devices/connect/huawei-usg-demo/HUAWEI_FW_USG6000E.HUAWEI_FW_USG6000E/UpdateAddressGroup`.

Known limitations: this RPC replaces the full address group; callers must send the complete intended set. Error details do not include upstream raw bodies, Authorization headers, request body, username, or password. `skipTlsVerify` is per request.
