# Panabit TANG-R1

This package preserves legacy gRPC package and method names where applicable.

## Import

```bash
octobus service import --id panabit-tang-r1 ./services/panabit__tang-r1
```

## Behavior

- Put the Panabit endpoint and non-sensitive HTTP settings in config. Put `bindUser`/`bindPassword` or their aliases in `secret.schema.json`.
- `Login` maps to `GET /api/panabit.cgi/API` with `api_action=api_login`, caches a successful API token per OctoBus instance, and does not return the token or raw login body.
- `ListIPTable`, `AddIPTable`, `BlockIP`, and `UnblockIP` map to `POST /api/panabit.cgi` with multipart form data and use the cached token from `Login`. Deprecated request `api_token` fields are ignored.
- Business responses are passed through as device `code`, `msg`, and raw JSON struct fields.
- HTTP 401/403 map to `PERMISSION_DENIED`; other 4xx responses map to `FAILED_PRECONDITION`; 5xx and transport failures map to `UNAVAILABLE`.

Example config:

```json
{
  "restBaseUrl": "https://panabit.example.local",
  "timeoutMs": 1500,
  "skipTlsVerify": false
}
```

Example secret:

```json
{
  "bindUser": "api_user",
  "bindPassword": "replace-with-secret"
}
```

## Local Checks

```bash
cd services
npm run validate -- --service-dir panabit__tang-r1
npm test -- --service-dir panabit__tang-r1 --coverage
npm run pack:check
```

## Service Contract

- Service name: `panabit-tang-r1`
- Service dir: `services/panabit__tang-r1`
- Runtime mode: `long-running`
- Config: `restBaseUrl` is required; `bindUser`, `timeoutMs`, `skipTlsVerify`, and `headers` are optional. Host aliases include `baseUrl`, `host`, and snake_case variants.
- Secret: `bindPassword` is required; `bindUser` may be supplied in secret. Aliases `bind_password`, `user`, `username`, and `password` are accepted.
- RPC read/write properties:
  - `Login`: write/session setup, logs in and caches the API token; response `api_token` remains empty.
  - `ListIPTable`: read, lists IP table groups using the cached token.
  - `AddIPTable`: write, creates an IP table group.
  - `BlockIP`: write, adds an IP to a group.
  - `UnblockIP`: write, removes an IP from a group.

OctoBus example:

```bash
octobus service import --id panabit-tang-r1 ./services/panabit__tang-r1
octobus instance create panabit-tang-r1 panabit-demo --config config.json --secret secret.json
octobus capset create security-devices
octobus capset add-instance security-devices panabit-demo
```

Connect path example: `/capsets/security-devices/connect/panabit-demo/Panabit_TANG_R1.Panabit_TANG_R1/ListIPTable`.

Known limitations: business RPCs require a prior successful `Login` for the same instance. Deprecated request `api_token` fields are ignored. HTTP error messages do not include upstream body text or cached tokens. `skipTlsVerify` is per request.
