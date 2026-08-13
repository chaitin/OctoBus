# DPtech FW V4.6.10 OctoBus Service

This package preserves legacy gRPC package and method names where applicable.

Import it into OctoBus with:

```bash
octobus service import --id dptech-fw-v4-6-10 ./services/dptech__fw_v4-6-10
```

## Service Metadata

- Vendor/product/version: DPtech FW V4.6.10 web management API.
- Service name: `dptech-fw-v4-6-10`.
- Service dir: `services/dptech__fw_v4-6-10`.
- Runtime mode: `long-running`.
- Runtime inspect: `node bin/dptech-fw-v4-6-10.js --runtime inspect --json`.

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/dptech_fw_v4_6_10.proto`: gRPC API definition.
- `config.schema.json`: non-secret endpoint, username, timeout, TLS, and extra header settings.
- `secret.schema.json`: DPtech FW Basic Auth password and optional username fields.
- `src/dptech-fw-v4-6-10.js`: DPtech FW REST proxy implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/dptech-fw-v4-6-10.js`: service-local executable entrypoint.
- `test/dptech-fw-v4-6-10.test.js`: node:test coverage for request mapping, parsing, validation, error classification, and SDK handler invocation.
- `test/mock_upstream.js`: optional local DPtech FW HTTP mock.

## Configuration

Use `host` for the DPtech FW management base URL. Legacy aliases `restBaseUrl`, `rest_base_url`, `baseUrl`, `base_url`, and `endpoint` are also accepted.

```json
{
  "host": "https://fw.example.net:8443",
  "user": "api-user",
  "timeoutMs": 3000,
  "skipTlsVerify": false,
  "headers": {
    "X-Trace": "demo"
  }
}
```

Use `secret.password`, `secret.pass`, or `secret.secret` for the Basic Auth password. `secret.user` or `secret.username` may carry the username when needed:

```json
{
  "password": "replace-with-password"
}
```

## RPC Methods

- `DPtech_FW_V4610.DPtech_FW_V4610/GetPacketFilterStatus` - read, gets packet filter immediate-effect status.
- `DPtech_FW_V4610.DPtech_FW_V4610/EnablePacketFilterImmediate` - write, enables packet filter immediate-effect mode.
- `DPtech_FW_V4610.DPtech_FW_V4610/ListAddressGroups` - read, lists address groups by name keyword.
- `DPtech_FW_V4610.DPtech_FW_V4610/CreateAddressGroup` - write, creates an address group.
- `DPtech_FW_V4610.DPtech_FW_V4610/UpdateAddressGroup` - write, updates an address group.
- `DPtech_FW_V4610.DPtech_FW_V4610/DeleteAddressGroup` - write, deletes an address group.
- `DPtech_FW_V4610.DPtech_FW_V4610/GetSecurityPolicy` - read, gets one security policy.
- `DPtech_FW_V4610.DPtech_FW_V4610/CreateSecurityPolicy` - write, creates a security policy.
- `DPtech_FW_V4610.DPtech_FW_V4610/UpdateSecurityPolicy` - write, updates a security policy.
- `DPtech_FW_V4610.DPtech_FW_V4610/DeleteSecurityPolicy` - write, deletes a security policy.

## Behavior Notes

- Packet filter APIs use fixed `ipVersion=4`.
- Address group and security policy APIs use fixed `vsysName=PublicSystem`.
- Bare IPv4 address group entries are normalized to `/32`; invalid IPv4/CIDR values are rejected.
- HTTP 401/403 maps to `PERMISSION_DENIED`.
- Other HTTP 4xx responses map to `FAILED_PRECONDITION`.
- HTTP 5xx and network failures map to `UNAVAILABLE`.
- HTTP 200 responses with non-zero `ret` map to `FAILED_PRECONDITION`.
- Empty successful update responses are treated as success. The device text `Duplicate IP address ranges.` is also treated as a successful address group update.
- `timeoutMs` is enforced with `AbortController`; `skipTlsVerify` uses a per-request undici dispatcher and does not change global TLS settings.
- Raw body proto fields are retained for compatibility but the implementation returns sanitized empty raw fields and structured summaries for errors.
- Known limitation: the service uses fixed `ipVersion=4` and `vsysName=PublicSystem`; it does not expose arbitrary vsys or generic REST calls.

## OctoBus Usage

```bash
octobus service import --id dptech-fw-v4-6-10 ./services/dptech__fw_v4-6-10
octobus instance create dptech-fw --service dptech-fw-v4-6-10 \
  --config-json '{"host":"https://fw.example:8443","user":"api-user","timeoutMs":3000,"skipTlsVerify":false}' \
  --secret-json '{"password":"REDACTED"}'
octobus capset create fw-policy
octobus capset add-instance fw-policy dptech-fw

curl -X POST http://127.0.0.1:9000/capsets/fw-policy/connect/dptech-fw/DPtech_FW_V4610.DPtech_FW_V4610/ListAddressGroups \
  -H 'Content-Type: application/json' \
  -d '{"search_value":"blocked"}'
```

## Local Checks

```bash
cd services
npm run validate -- --service-dir dptech__fw_v4-6-10
npm test -- --service-dir dptech__fw_v4-6-10 --coverage
npm run pack:check
```
