# Fortinet FW OctoBus Service

This package preserves legacy gRPC package and method names where applicable.

Import it into OctoBus with:

```bash
octobus service import --id fortinet-fw ./services/fortinet__fw
```

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/fortinet_fw.proto`: gRPC API definition.
- `config.schema.json`: Fortinet API endpoint, vdom, timeout, TLS, and extra header settings.
- `secret.schema.json`: Fortinet API token settings.
- `src/fortinet-fw.js`: Fortinet firewall address and address group implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/fortinet-fw.js`: service-local executable entrypoint.
- `test/fortinet-fw.test.js`: node:test coverage for validation, request mapping, HTTP behavior, idempotent Fortinet errors, and SDK handler invocation.
- `test/mock_upstream.js`: optional local Fortinet firewall API mock.

## Configuration

Use `host` or `restBaseUrl` for the Fortinet REST API base URL. Aliases `rest_base_url`, `baseUrl`, `base_url`, and `endpoint` are also accepted.

```json
{
  "restBaseUrl": "https://fortinet.example:8443",
  "is_vdom": true,
  "vdom": "root",
  "timeoutMs": 5000,
  "headers": {
    "X-Custom": "value"
  }
}
```

Use `token` for the Fortinet bearer token. Aliases `accessToken` and `access_token` are also accepted.

```json
{
  "token": "replace-with-api-token"
}
```

Deprecated compatibility only: `config.token`, `config.accessToken`, and `config.access_token` are still accepted as lower-priority fallbacks for older instances, but `secret` values always take precedence.

## RPC Methods

- `Fortinet_FW.Fortinet_FW/CreateAddress`
- `Fortinet_FW.Fortinet_FW/GetAddress`
- `Fortinet_FW.Fortinet_FW/DeleteAddress`
- `Fortinet_FW.Fortinet_FW/CreateAddrGroup`
- `Fortinet_FW.Fortinet_FW/GetAddrGroup`
- `Fortinet_FW.Fortinet_FW/AddAddrGroupMember`
- `Fortinet_FW.Fortinet_FW/RemoveAddrGroupMember`
- `Fortinet_FW.Fortinet_FW/DeleteAddrGroup`
- `Fortinet_FW.Fortinet_FW/AttachSubGroupToPolicyAddrGroup`
- `Fortinet_FW.Fortinet_FW/DetachSubGroupFromPolicyAddrGroup`

## Behavior Notes

- Address object names are the same as the IP text.
- `CreateAddrGroup` creates each member address object before creating the group.
- `AddAddrGroupMember` creates the target address object before adding it to the group.
- Fortinet error `-5` is treated as idempotent success for address creation and member add operations.
- Fortinet error `-23` is preserved as a continue-able response for address deletion.
- Removing a missing group member with payload `http_status: 404` is treated as idempotent success.
- Attach and detach operations read the current policy address group members, then update the merged or filtered member list.
- HTTP 401 and 403 map to `PERMISSION_DENIED`; other 4xx statuses map to `FAILED_PRECONDITION`; 5xx and network failures map to `UNAVAILABLE`.

## Local Checks

```bash
cd services
npm run validate -- --service-dir fortinet__fw
npm test -- --service-dir fortinet__fw --coverage
npm run pack:check
```

## Service Contract

- Service name: `fortinet-fw`
- Service dir: `services/fortinet__fw`
- Runtime mode: `long-running`
- Config: `host` or `restBaseUrl` is required; `is_vdom`, `vdom`, `timeoutMs`, `skipTlsVerify`, and `headers` are optional. Deprecated `config.token` aliases are fallback only.
- Secret: `token` is required for new instances; `accessToken` and `access_token` are accepted aliases.
- RPC read/write properties:
  - `CreateAddress`: write, `POST /api/v2/cmdb/firewall/address`.
  - `GetAddress`: read, `GET /api/v2/cmdb/firewall/address/{ip}`.
  - `DeleteAddress`: write, `DELETE /api/v2/cmdb/firewall/address/{ip}`.
  - `CreateAddrGroup`: write, creates address objects then `POST /api/v2/cmdb/firewall/addrgrp`.
  - `GetAddrGroup`: read, `GET /api/v2/cmdb/firewall/addrgrp/{group}`.
  - `AddAddrGroupMember`: write, creates address object then `POST /member`.
  - `RemoveAddrGroupMember`: write, `DELETE /member/{ip}`.
  - `DeleteAddrGroup`: write, `DELETE /api/v2/cmdb/firewall/addrgrp/{group}`.
  - `AttachSubGroupToPolicyAddrGroup`: read/write, reads current members then `PUT` merged members.
  - `DetachSubGroupFromPolicyAddrGroup`: read/write, reads current members then `PUT` filtered members.

OctoBus example:

```bash
octobus service import --id fortinet-fw ./services/fortinet__fw
octobus instance create fortinet-fw fortinet-fw-demo --config config.json --secret secret.json
octobus capset create security-devices
octobus capset add-instance security-devices fortinet-fw-demo
```

Connect path example: `/capsets/security-devices/connect/fortinet-fw-demo/Fortinet_FW.Fortinet_FW/GetAddress`.

Known limitations: mock tests cover API mapping; production behavior still depends on FortiGate REST API permissions, VDOM configuration, and address-group policy semantics. `skipTlsVerify` is only for private/self-signed device deployments and is applied per request.
