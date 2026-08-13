# Qiming Tianqing WAF

OctoBus service package for Qiming Tianqing WAF IP block and unblock orchestration.

Service root: `services/qiming-tianqing__waf`.

Import it into OctoBus with:

```bash
octobus service import --id qiming-tianqing-waf ./services/qiming-tianqing__waf
```

The package preserves the legacy flow:

- `BlockIP`: login, optionally create an address object for each IP, add each IP to the blacklist, then logout by default.
- `UnblockIP`: login, delete each IP from the blacklist, then logout by default.

## Configuration

Instance config provides the base URL and username. Instance secret provides the password or precomputed password digest:

```json
{
  "baseUrl": "http://127.0.0.1:19090",
  "username": "demo",
  "skipTlsVerify": true
}
```

```json
{
  "password": "secret"
}
```

`restBaseUrl`, `base_url`, and `url` are accepted as base URL aliases. `password_sha256` and `passwordSha256` are accepted when a precomputed SHA-256 password digest is already available.
Deprecated request `credential` fields are ignored for credentials. `BlockIPResponse.authorization`, `BlockIPResponse.sid`, `UnblockIPResponse.authorization`, and `UnblockIPResponse.sid` are retained only for proto compatibility and are returned empty.

## Request Examples

Block IPs:

```json
{
  "ip_list": ["192.0.2.10"],
  "blacklist": {
    "name": "octobus-blacklist",
    "reason": "manual block"
  }
}
```

Unblock IPs:

```json
{
  "ip_list": ["192.0.2.10"],
  "blacklist": {
    "name": "octobus-blacklist"
  },
  "logout": false
}
```

`address_object.template_override`, `blacklist.template_override`, and `unblock.template_override` may override the JSON payload templates. Template placeholders include `{{ip}}`, `{{address_object_name}}`, `{{description}}`, `{{reason}}`, `{{blacklist_name}}`, `{{ip_list}}`, and `{{ip_list_json}}`.

## Local Checks

```bash
cd services
npm run validate -- --service-dir qiming-tianqing__waf
npm test -- --service-dir qiming-tianqing__waf --coverage
npm run pack:check
```

## Service Contract

- Service name: `qiming-tianqing-waf`
- Service dir: `services/qiming-tianqing__waf`
- Runtime mode: `long-running`
- Config: `baseUrl` and `username` are required; `timeoutMs`, `skipTlsVerify`, `headers`, `authHeaders`, and payload templates are optional.
- Secret: either `password` or `password_sha256` is required. Plain passwords are SHA-256 hashed before the login request.
- RPC read/write properties:
  - `BlockIP`: write, logs in, optionally creates address objects, adds IPs to the blacklist, and logs out by default.
  - `UnblockIP`: write, logs in, removes IPs from the blacklist, and logs out by default.

OctoBus example:

```bash
octobus service import --id qiming-tianqing-waf ./services/qiming-tianqing__waf
octobus instance create qiming-tianqing-waf qiming-waf-demo --config config.json --secret secret.json
octobus capset create security-devices
octobus capset add-instance security-devices qiming-waf-demo
```

Connect path example: `/capsets/security-devices/connect/qiming-waf-demo/Qiming_Tianqing_WAF.QimingTianqingWafService/BlockIP`.

Known limitations: login authorization and SID cookie are internal to the RPC and response compatibility fields remain empty. Deprecated request credential fields are ignored. `skipTlsVerify` is only for private/self-signed deployments and is applied per request.
