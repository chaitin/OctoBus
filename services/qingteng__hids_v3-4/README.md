# QingTeng HIDS V3.4

OctoBus service package for QingTeng HIDS V3.4 login, host asset query, and host isolation APIs.

Service root: `services/qingteng__hids_v3-4`.

Import it into OctoBus with:

```bash
octobus service import --id qingteng-hids-v3-4 ./services/qingteng__hids_v3-4
```

## Configuration

Credentials are read from instance config/secret bindings, matching the legacy engine service:

```json
{
  "host": "https://qingteng.example.com",
  "username": "qt-user",
  "skipTlsVerify": true
}
```

```json
{
  "password": "qt-pass"
}
```

`restBaseUrl` and `baseUrl` are accepted as `host` aliases. `user` is accepted as a `username` alias.

## Methods

- `Login`: performs one login and returns the downstream HTTP status with empty `raw_body`.
- `QueryHostAssets`: signs and sends `GET /external/api/assets/host/{linux|win}?ip=...`.
- `CreateHostIsolation`: signs and sends a create-isolation request with `direction=all`.
- `DeleteHostIsolation`: signs and sends a delete-isolation request.

Non-login methods cache the login session per instance and host, and retry once after HTTP 401 or 403 by forcing a fresh login.

## Requests

Query assets:

```json
{
  "ip": "10.0.0.1",
  "system_type": "linux"
}
```

Create isolation:

```json
{
  "agent_ids": ["agent-1", "agent-2"],
  "remark": "manual isolation"
}
```

Delete isolation:

```json
{
  "agent_ids": ["agent-1"]
}
```

Errors preserve the legacy JSON message payload with `code`, `message`, `http_status`, empty `raw_body`, `raw_body_length`, and `reason`. Upstream raw bodies, JWT/sign keys, request headers, and credentials are not returned.

## Local Checks

```bash
cd services
npm run validate -- --service-dir qingteng__hids_v3-4
npm test -- --service-dir qingteng__hids_v3-4 --coverage
npm run pack:check
```

## Service Contract

- Service name: `qingteng-hids-v3-4`
- Service dir: `services/qingteng__hids_v3-4`
- Runtime mode: `long-running`
- Config: `host` and `username` are required; `timeoutMs`, `skipTlsVerify`, and `headers` are optional. `restBaseUrl`, `baseUrl`, and `user` aliases are accepted.
- Secret: `password` is required.
- RPC read/write properties:
  - `Login`: write/session setup, logs in and caches `comId`, JWT, and sign key internally.
  - `QueryHostAssets`: read, queries host assets by IP and OS type.
  - `CreateHostIsolation`: write, creates isolation tasks for agent IDs.
  - `DeleteHostIsolation`: write, removes isolation tasks for agent IDs.

OctoBus example:

```bash
octobus service import --id qingteng-hids-v3-4 ./services/qingteng__hids_v3-4
octobus instance create qingteng-hids-v3-4 qingteng-demo --config config.json --secret secret.json
octobus capset create security-devices
octobus capset add-instance security-devices qingteng-demo
```

Connect path example: `/capsets/security-devices/connect/qingteng-demo/QingTeng_HIDS_V34.QingTeng_HIDS_V34/QueryHostAssets`.

Known limitations: non-login methods may login internally and retry once after 401/403. `Login` returns only `http_status` with empty `raw_body`; credentials and session material are not returned. `skipTlsVerify` is per request.
