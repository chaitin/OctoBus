# RAY WAF V6.1.2

OctoBus service package for RAY WAF V6.1.2 blacklist APIs.

Service root: `services/ray__waf_v6-1-2`.

Import it into OctoBus with:

```bash
octobus service import --id ray-waf-v6-1-2 ./services/ray__waf_v6-1-2
```

## Configuration

Static connection details are provided through config. Put the login password in `secret.schema.json`:

```json
{
  "restBaseUrl": "http://127.0.0.1:18081",
  "user": "api_user",
  "skipTlsVerify": true
}
```

```json
{
  "password": "SuperSecret"
}
```

`host` and `baseUrl` are accepted as base URL aliases. `username` is accepted as a `user` alias.

## Methods

- `Login`: `GET /apicenter/login/?username=...&password=...`, caching the device `random` session token inside the OctoBus instance without returning it.
- `QueryBlacklist`: `GET /apicenter/?action=blacklist_query&username=...&random=...`.
- `BlockIP`: `POST /apicenter/?action=blacklist_update&username=...&random=...`.
- `UnblockIP`: `POST /apicenter/?action=blacklist_del&username=...&random=...`.

Call `Login` before query, block, and unblock. Deprecated request `random` fields are ignored.

## Request Examples

Block one IPv4:

```json
{
  "ip": "203.0.113.10"
}
```

Unblock by blacklist ID:

```json
{
  "ids": "6"
}
```

Errors map to legacy gRPC codes: `INVALID_ARGUMENT`, `PERMISSION_DENIED`, `FAILED_PRECONDITION`, `UNAVAILABLE`, and `UNKNOWN`.

## Local Checks

```bash
cd services
npm run validate -- --service-dir ray__waf_v6-1-2
npm test -- --service-dir ray__waf_v6-1-2 --coverage
npm run pack:check
```

## Service Contract

- Service name: `ray-waf-v6-1-2`
- Service dir: `services/ray__waf_v6-1-2`
- Runtime mode: `long-running`
- Config: `host` or `restBaseUrl` and `user` are required; `timeoutMs`, `skipTlsVerify`, and `headers` are optional. `username` is accepted as a user alias.
- Secret: `password` is required.
- RPC read/write properties:
  - `Login`: write/session setup, logs in and caches the `random` token internally.
  - `QueryBlacklist`: read, queries blacklist entries.
  - `BlockIP`: write, adds one IPv4 address.
  - `UnblockIP`: write, removes blacklist entries by ID.

OctoBus example:

```bash
octobus service import --id ray-waf-v6-1-2 ./services/ray__waf_v6-1-2
octobus instance create ray-waf-v6-1-2 ray-waf-demo --config config.json --secret secret.json
octobus capset create security-devices
octobus capset add-instance security-devices ray-waf-demo
```

Connect path example: `/capsets/security-devices/connect/ray-waf-demo/RAY_WAF_V612.RAY_WAF_V612/BlockIP`.

Known limitations: query, block, and unblock require a cached session from `Login`. Deprecated request `random` and `password` fields are ignored. HTTP errors do not include upstream body text or session tokens. `skipTlsVerify` is per request.
