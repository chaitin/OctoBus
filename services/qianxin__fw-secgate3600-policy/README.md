# QiAnXin SecGate3600 Security Policy

OctoBus service package for managing security policies on the QiAnXin (网神) SecGate3600 firewall.

## Import

```bash
octobus service import --id qianxin-fw-secgate3600-policy ./services/qianxin__fw-secgate3600-policy
```

## Configuration

Set `endpoint` to the firewall base URL. `timeoutMs` defaults to 5000.

```json
{
  "endpoint": "https://secgate3600.example.com",
  "timeoutMs": 5000
}
```

Secret: `username` and `password` for session-based authentication.

```json
{
  "username": "admin",
  "password": "secret"
}
```

## Behavior

Session management uses `POST /v1.0/login` to obtain a `PHPSESSID` cookie and `token` value, cached per endpoint. `POST /v1.0/out` is called on logout.

- `Login` establishes a session explicitly (optional; auto-called by other methods).
- `ListSecPolicy` calls `POST /v1.0/rest/` with `module=sec_policy&func=get_sec_policy`. Returns the policy list as Struct.
- `SetSecPolicy` calls `POST /v1.0/rest/` with `module=sec_policy&func=set_sec_policy`. Requires `action` and policy fields.
- `MoveSecPolicyPriority` calls `POST /v1.0/rest/` with `module=sec_policy&func=set_move_sec_policy_pri`. Requires `id` and `direct` (`top`, `end`, `before`, `after`).
- `Logout` clears the session cache and calls `POST /v1.0/out`.
- Missing endpoint or credentials returns `INVALID_ARGUMENT`. Network errors and 5xx map to `UNAVAILABLE`. Other errors map to `FAILED_PRECONDITION`.

## Local Checks

```bash
cd services
npm run validate -- --service-dir qianxin__fw-secgate3600-policy
npm test -- --service-dir qianxin__fw-secgate3600-policy --coverage
npm run pack:check
```
