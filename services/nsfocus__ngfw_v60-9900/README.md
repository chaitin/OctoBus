# NSFOCUS NGFW V60-9900 OctoBus Service

Service root: `services/nsfocus__ngfw_v60-9900`.

Import it into OctoBus with:

```bash
octobus service import --id nsfocus-ngfw-v60-9900 ./services/nsfocus__ngfw_v60-9900
```

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/nsfocus_ngfw_v60_9900.proto`: gRPC API definition.
- `config.schema.json`: NETCONF host, port, and timeout settings.
- `secret.schema.json`: NETCONF SSH username/password settings.
- `src/nsfocus-ngfw-v60-9900.js`: NSFOCUS NGFW NETCONF over SSH client and handler implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/nsfocus-ngfw-v60-9900.js`: service-local executable entrypoint.
- `test/nsfocus-ngfw-v60-9900.test.js`: node:test coverage for NETCONF XML mapping and mutation request construction.

## Configuration

This service uses only NETCONF over SSH. It does not use the NSFOCUS REST API manual or any `/api/v1` endpoints.

Enable the SSH NETCONF server on the device first:

```text
system-view
netconf ssh server enable
quit
```

The service does not run `save`; decide separately whether the device-side setting should be persisted.

Config:

```json
{
  "host": "192.168.0.1",
  "port": 830,
  "timeoutMs": 20000
}
```

Secret:

```json
{
  "username": "admin",
  "password": "replace-with-password"
}
```

`host` may include a `https://` prefix for compatibility with older config values; the service strips the scheme and connects with SSH.

## RPC Methods

- `nsfocus.ngfw.v60_9900.NSFOCUSNGFWService/GetSystemStatus`: read-only NETCONF `<get>` for `<Device/>` status.
- `nsfocus.ngfw.v60_9900.NSFOCUSNGFWService/ListSecurityLogs`: read log buffer entries from `Syslog/Logs`.
- `nsfocus.ngfw.v60_9900.NSFOCUSNGFWService/ListSecurityPolicies`: read IPv4 or IPv6 rules from `SecurityPolicies/IPv4Rules` or `IPv6Rules`.
- `nsfocus.ngfw.v60_9900.NSFOCUSNGFWService/ListSecurityPolicyAddressObjects`: read source and destination address groups referenced by policy rules.
- `nsfocus.ngfw.v60_9900.NSFOCUSNGFWService/CreateNodeObject`: creates an `OMS/IPv4Groups` address group.
- `nsfocus.ngfw.v60_9900.NSFOCUSNGFWService/DeleteNodeObject`: removes an `OMS/IPv4Groups` address group.
- `nsfocus.ngfw.v60_9900.NSFOCUSNGFWService/BlockIP`: creates the address group if needed and adds `OMS/IPv4Objs` host entries.
- `nsfocus.ngfw.v60_9900.NSFOCUSNGFWService/UnblockIP`: removes `OMS/IPv4Objs` entries from the address group.
- `nsfocus.ngfw.v60_9900.NSFOCUSNGFWService/CreateIPv6AddressGroup`: creates an `OMS/IPv6Groups` address group.
- `nsfocus.ngfw.v60_9900.NSFOCUSNGFWService/DeleteIPv6AddressGroup`: removes an `OMS/IPv6Groups` address group.
- `nsfocus.ngfw.v60_9900.NSFOCUSNGFWService/AddIPv6ToGroup`: creates the IPv6 address group if needed and adds `OMS/IPv6Objs` host entries.
- `nsfocus.ngfw.v60_9900.NSFOCUSNGFWService/RemoveIPv6FromGroup`: removes `OMS/IPv6Objs` entries from the IPv6 address group.

Read-only methods use NETCONF `<get>`. Group and IP mutation methods send NETCONF `<edit-config>` to the running configuration. Validate them with a dedicated test group/IP before production use.

## Local Checks

```bash
cd services
npm run validate -- --service-dir nsfocus__ngfw_v60-9900
npm test -- --service-dir nsfocus__ngfw_v60-9900
npm run pack:check
```

Read-only real-device validation should call only `GetSystemStatus` first.
