# Cloudflare WAF

OctoBus service package for Cloudflare WAF firewall operations via Cloudflare API v4.

## Import

```bash
octobus service import --id cloudflare-waf ./services/cloudflare__waf
```

## Configuration

Set `endpoint` (default `https://api.cloudflare.com/client/v4`), `zoneId`, and `accountId` as needed. `timeoutMs` (default 1500) and `skipTlsVerify` are optional.

```json
{
  "zoneId": "<zone-id>",
  "timeoutMs": 3000
}
```

Secret: `apiToken` (Bearer, recommended) or `authEmail` + `authKey` (legacy global key).

```json
{
  "apiToken": "<scoped-api-token>"
}
```

## Behavior

- `BlockIP` calls `POST /…/firewall/access_rules/rules`. Idempotent: reuses an existing rule with the same target and mode instead of creating a duplicate.
- `UnblockIP` calls `DELETE /…/firewall/access_rules/rules/{id}`. Idempotent: no matching rule returns `deleted_count=0`.
- `ListAccessRules` calls `GET /…/firewall/access_rules/rules` with optional `value`, `mode`, `page`, and `per_page` filters.
- `GetSecurityLevel` calls `GET /zones/{zone}/settings/security_level`.
- `SetSecurityLevel` calls `PATCH /zones/{zone}/settings/security_level`. Idempotent.
- Each request carries `x-engine-instance` and `x-request-id` audit headers.
- Missing scope or credentials returns `INVALID_ARGUMENT`. HTTP 401/403 or Cloudflare error codes 9109/10000 map to `PERMISSION_DENIED`. Other `success:false` responses map to `FAILED_PRECONDITION`. Network errors and 5xx map to `UNAVAILABLE`.

## Local Checks

```bash
cd services
npm run validate -- --service-dir cloudflare__waf
npm test -- --service-dir cloudflare__waf --coverage
npm run pack:check
```
