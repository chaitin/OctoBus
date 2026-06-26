# QIANXIN FW SecGate3600 — Security Policy

OctoBus service package for **网神 (QiAnXin) SecGate3600 防火墙** security-policy
(`sec_policy`) management. This is an **incremental** package alongside the existing
`qianxin__fw-secgate3600` (address group) and `qianxin__fw-secgate3600-http-x` (blacklist)
adapters — it adds firewall **security policy** query / add-modify / reorder.

- **Vendor / product**: QiAnXin 网神 SecGate3600 firewall
- **Supported version**: V3.6.6.0 (RESTful API 使用指南 V1.1), `/v1.0` endpoints
- **Category**: 边界访问 (boundary access / firewall policy)
- **proto package**: `QIANXIN_FW_SecGate3600_Policy`
- **Derived from**: 网神SecGate 3600防火墙V3.6.6.0 RESTful API 使用指南 V1.1

## Stateful session

SecGate3600 is **session-based**. Call `Login` first; the package caches the session
(`PHPSESSID` cookie + `token`) per OctoBus instance and host. Business methods then call
`POST /v1.0/rest/` with the cached cookie. `Logout` clears the session. A business call
without a session returns `FAILED_PRECONDITION: call Login first`. A 401/403 from upstream
auto-clears the cached session (re-`Login`).

## Authentication / Configuration

| field | where | description |
|-------|-------|-------------|
| `host` | config / request | base URL with scheme + port, e.g. `https://198.51.100.10:8443` (required) |
| `user` / `username` | secret (or config) | login username |
| `password` | secret | login password |
| `timeoutMs` | config | HTTP timeout (default 5000) |
| `skipTlsVerify` | config | skip TLS verify for private deployments |

```json
{ "config": { "host": "https://198.51.100.10:8443" },
  "secret": { "user": "admin", "password": "<pw>" } }
```

## Methods

The `/v1.0/rest/` body is a JSON array `[{head:{module,function,…}, body:{…}}]`. Large
policy objects are passed through as `google.protobuf.Value`/`Struct`.

| Method | Type | function | Notes |
|--------|------|----------|-------|
| `Login` | — | `/v1.0/login` | Establishes + caches the session. |
| `ListSecPolicy` | read | `get_sec_policy` | `names` (empty = all; each 1-63 chars), `is_detail`, `page_index`(≥1, default 1), `page_size`(default 20). |
| `SetSecPolicy` | write | `set_sec_policy` | `policies` = `repeated Struct`, each needs non-empty `name`; rest passed through (desc/action/state/src_zone/dst_zone/user_item/…/option_item). Overwrite by name. |
| `MoveSecPolicyPriority` | write | `set_move_sec_policy_pri` | `moves` = `{name, direct(top/end/before/after), dst_name}`; `dst_name` required for before/after. |
| `Logout` | — | `/v1.0/out` | Clears the session. |

### Write-operation semantics

- **Idempotency**: `SetSecPolicy` overwrites by `name` (re-set is idempotent); `MoveSecPolicyPriority` to the same position is a no-op.
- **Rollback**: re-`SetSecPolicy` prior fields / delete; `MoveSecPolicyPriority` back to prior neighbor.
- **Audit**: upstream session cookie/token carried per call; OctoBus instance/host scope the session cache.
- **Business errors**: a non-zero upstream `head.error_code` is **surfaced** in the response (`head.error_code`/`head.message`), not thrown — callers inspect it.

## Error mapping

| Condition | gRPC status |
|-----------|-------------|
| Missing/invalid argument (host, names, policies, moves, direct) | `INVALID_ARGUMENT` |
| No cached session | `FAILED_PRECONDITION` |
| Network failure / 5xx | `UNAVAILABLE` |
| Non-JSON / empty body | `UNKNOWN` |

## Risk boundary

- `SetSecPolicy` / `MoveSecPolicyPriority` change live firewall policy and traffic
  enforcement — verify on a test policy, scope the login account to least privilege.
- Never commit real hosts, credentials, tokens, or policy data.

## Suggested capset

- Read-only: `Login`, `ListSecPolicy`, `Logout`.
- Change automation (with approval): add `SetSecPolicy`, `MoveSecPolicyPriority`.

## Verification

```bash
cd services
npm run validate -- --service-dir qianxin__fw-secgate3600-policy
npm test -- --service-dir qianxin__fw-secgate3600-policy
npm run pack:check
```

Real-device check (use a test policy):

```bash
octobus service import --service-dir ./qianxin__fw-secgate3600-policy
octobus instance create qianxin-fw-secgate3600-policy --config '{"host":"https://<host>:<port>"}' --secret '{"user":"<u>","password":"<p>"}'
octobus call <capset> qianxin-fw-secgate3600-policy Login '{}'
octobus call <capset> qianxin-fw-secgate3600-policy ListSecPolicy '{"page_size":20}'
```
