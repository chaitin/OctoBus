# Fortinet WAF OctoBus Service

This package preserves legacy gRPC package and method names where applicable.

Import it into OctoBus with:

```bash
octobus service import --id fortinet-waf ./services/fortinet__waf
```

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/fortinet_waf.proto`: gRPC API definition.
- `config.schema.json`: Fortinet WAF endpoint, username, timeout, TLS, and extra header settings.
- `secret.schema.json`: Fortinet WAF username and password settings.
- `src/fortinet-waf.js`: Fortinet WAF online check and IP list implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/fortinet-waf.js`: service-local executable entrypoint.
- `test/fortinet-waf.test.js`: node:test coverage for validation, request mapping, HTTP behavior, response parsing, and SDK handler invocation.
- `test/mock_upstream.js`: optional local Fortinet WAF API mock.

## Configuration

Use `host` for the Fortinet WAF base URL. Aliases `restBaseUrl`, `rest_base_url`, `baseUrl`, `base_url`, and `endpoint` are also accepted.

```json
{
  "host": "https://fortinet-waf.example:90",
  "username": "api_user",
  "timeoutMs": 1500,
  "headers": {
    "X-Custom": "value"
  }
}
```

Use `password` for the Fortinet WAF API password. The service sends the base64 encoded `username:password` value in `Authorization`, matching the legacy integration.

```json
{
  "password": "replace-with-api-password"
}
```

## RPC Methods

- `Fortinet_WAF.Fortinet_WAF/CheckOnline`
- `Fortinet_WAF.Fortinet_WAF/BlockIP`
- `Fortinet_WAF.Fortinet_WAF/ListIPListMembers`
- `Fortinet_WAF.Fortinet_WAF/UnblockIP`

## Behavior Notes

- `CheckOnline` succeeds only when the upstream HTTP response is successful, JSON is an object, and `status` equals `1`.
- `BlockIP` sends Fortinet's fixed IP list member payload with `type: 2`, `severity: 2`, and empty `triggerPolicy`.
- `ListIPListMembers` requires an array response and maps each member's `id`, `type`, `iPv4IPv6`, `severity`, `triggerPolicy`, and `status`.
- `UnblockIP` succeeds only when the upstream response object has `affected: 1`.
- HTTP 401 and 403 map to `PERMISSION_DENIED`; other 4xx statuses map to `FAILED_PRECONDITION`; 5xx and network failures map to `UNAVAILABLE`.
- Non-JSON or unexpected response shapes map to `UNKNOWN`; error payloads keep `raw_body` empty and expose only `raw_body_length`.

## Local Checks

```bash
cd services
npm run validate -- --service-dir fortinet__waf
npm test -- --service-dir fortinet__waf --coverage
npm run pack:check
```

## Service Contract

- Service name: `fortinet-waf`
- Service dir: `services/fortinet__waf`
- Runtime mode: `long-running`
- Config: `host` is required; `username`, `timeoutMs`, `skipTlsVerify`, and `headers` are optional. `restBaseUrl`, `baseUrl`, and `endpoint` are accepted host aliases.
- Secret: `password` is required; `username` or `user` may be supplied in secret instead of config.
- RPC read/write properties:
  - `CheckOnline`: read, checks the WAF status endpoint.
  - `BlockIP`: write, adds one IP list member.
  - `ListIPListMembers`: read, lists configured IP list members.
  - `UnblockIP`: write, deletes one IP list member by member ID.

OctoBus example:

```bash
octobus service import --id fortinet-waf ./services/fortinet__waf
octobus instance create fortinet-waf fortinet-waf-demo --config config.json --secret secret.json
octobus capset create security-devices
octobus capset add-instance security-devices fortinet-waf-demo
```

Connect path example: `/capsets/security-devices/connect/fortinet-waf-demo/Fortinet_WAF.Fortinet_WAF/CheckOnline`.

Known limitations: the service intentionally does not return upstream raw bodies or credentials. `skipTlsVerify` is only for private/self-signed deployments and is applied with a per-request dispatcher.
