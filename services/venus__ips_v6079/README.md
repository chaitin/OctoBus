# Venus IPSV6079 OctoBus Service Package

This package connects the Venus IPSV6079 REST API to OctoBus.

Service root:

```text
services/venus__ips_v6079
```

Service name:

```text
venus-ips-v6079
```

Proto service:

```text
Venus_IPSV6079.IPSV6079Service
```

## Capabilities

- Login with `POST /api/v3/login` using a SHA256 password.
- Send `Authorization` and `Device-Type` headers on authenticated requests.
- Call any documented `/api/v3/...` endpoint through `Request`.
- Use named wrappers for license, system resources, upgrade/configuration, backup import/export, block policy, and white policy workflows.

## Config And Secret

Example config:

```json
{
  "baseUrl": "https://192.0.2.10",
  "username": "admin",
  "deviceType": "SOC",
  "skipTlsVerify": true,
  "timeoutMs": 10000
}
```

Example secret with a raw password:

```json
{
  "password": "your-password"
}
```

Example secret with a pre-issued token:

```json
{
  "token": "your-token"
}
```

## Generic Request

Use `Venus_IPSV6079.IPSV6079Service/Request` for endpoints that do not need a dedicated RPC.

```json
{
  "method": "POST",
  "path": "/api/v3/block_policy",
  "jsonBody": "{\"type\":2,\"block_content\":\"evil.example\",\"end_time\":60}",
  "requestId": "block-001"
}
```

The response returns upstream JSON as a string in `jsonBody`. Non-JSON responses, such as backup export files, are returned in `rawBodyBase64`.

## Local Checks

From `services`:

```bash
npm run validate -- --service-dir venus__ips_v6079
node --test venus__ips_v6079/test/venus-ips-v6079.test.js
npm --cache /tmp/octobus-npm-cache run pack:check
```
