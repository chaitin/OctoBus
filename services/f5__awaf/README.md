# f5__awaf

OctoBus service package for **F5 Advanced WAF (AWAF)** — exposes IP management and policy control via iControl REST API.

## Supported Versions

| Product | Tested Version | Notes |
|---------|---------------|-------|
| F5 BIG-IP AWAF | 16.x, 17.x | iControl REST API v1 |

> **Note**: IP exception path and `blockRequests` field behavior requires verification on real hardware. See [Pending Real-Device Verification](#pending-real-device-verification).

## Configuration

### Instance Config (`config.schema.json`)

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `host` | string | ✓ | — | F5 management IP or hostname |
| `port` | integer | — | 443 | iControl REST API port |
| `verify_ssl` | boolean | — | false | Verify TLS certificate (set `true` in production) |
| `default_policy_name` | string | — | — | Default ASM policy name (used when BlockIP/UnblockIP don't specify one) |

### Instance Secret (`secret.schema.json`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `username` | string | ✓ | F5 admin username |
| `password` | string | ✓ | F5 admin password |

Example config JSON:

```json
{
  "host": "192.168.10.50",
  "port": 443,
  "verify_ssl": false,
  "default_policy_name": "Production_WAF_Policy"
}
```

## RPC Methods

### Login

Authenticate against F5 iControl REST and obtain a session token. Token expires in ~20 minutes (configurable on F5 side).

**Request**: empty (credentials come from Instance Secret)

**Response**:

| Field | Type | Description |
|-------|------|-------------|
| `code` | int32 | 0 = success |
| `message` | string | Human-readable status |
| `token` | string | Session token for subsequent calls |
| `token_id` | string | Token identifier (same as token for TMOS) |

---

### BlockIP

Add one or more IP addresses to an ASM policy's IP exception list with `blockRequests: always`.

**Request**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | ✓ | Token from Login |
| `addresses` | repeated string | ✓ | IP addresses to block |
| `policy_name` | string | — | ASM policy name (falls back to `config.default_policy_name`) |
| `description` | string | — | Audit description added to each IP exception |

**Response**:

| Field | Type | Description |
|-------|------|-------------|
| `code` | int32 | 0 = all blocked, 1 = partial failure |
| `message` | string | Summary |
| `blocked` | repeated string | Successfully blocked IPs |
| `failed` | repeated string | IPs that could not be blocked |

**Behavior**:
- If the IP already exists in the exception list, `PATCH` updates `blockRequests` to `always` (idempotent).
- After any successful block, triggers `POST /mgmt/tm/asm/tasks/apply-policy` (best-effort; failure is non-fatal).
- Partial failure returns `code: 1` with both `blocked` and `failed` populated.

---

### UnblockIP

Remove IP addresses from an ASM policy's IP exception list.

**Request**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | ✓ | Token from Login |
| `addresses` | repeated string | ✓ | IP addresses to unblock |
| `policy_name` | string | — | ASM policy name (falls back to `config.default_policy_name`) |

**Response**:

| Field | Type | Description |
|-------|------|-------------|
| `code` | int32 | 0 = all unblocked, 1 = partial failure |
| `message` | string | Summary |
| `unblocked` | repeated string | Successfully removed IPs |
| `failed` | repeated string | IPs that failed to remove |

**Behavior**:
- If the IP is **not** in the exception list, it is counted as successfully unblocked (idempotent).
- Triggers apply-policy after any removal.

---

### AllowIP

Add one or more IP addresses to an ASM policy's IP exception list with `blockRequests: never` (whitelist).

**Request**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | ✓ | Token from Login |
| `addresses` | repeated string | ✓ | IP addresses to whitelist |
| `policy_name` | string | — | ASM policy name (falls back to `config.default_policy_name`) |
| `description` | string | — | Audit description added to each IP exception |

**Response**:

| Field | Type | Description |
|-------|------|-------------|
| `code` | int32 | 0 = all allowed, 1 = partial failure |
| `message` | string | Summary |
| `allowed` | repeated string | Successfully whitelisted IPs |
| `failed` | repeated string | IPs that could not be whitelisted |

**Behavior**:
- If the IP already exists, `PATCH` updates `blockRequests` to `never` (idempotent).
- Triggers apply-policy after any change.

---

### SetEnforcementMode

Switch an ASM policy between `blocking` and `transparent` mode.

**Request**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | ✓ | Token from Login |
| `policy_name` | string | — | ASM policy name (falls back to `config.default_policy_name`) |
| `mode` | string | ✓ | `"blocking"` or `"transparent"` |

**Response**:

| Field | Type | Description |
|-------|------|-------------|
| `code` | int32 | 0 = success |
| `message` | string | Status |
| `policy_name` | string | Affected policy name |
| `mode` | string | Resulting enforcement mode |

**Behavior**:
- Issues `PATCH /mgmt/tm/asm/policies/{id}` with `{ enforcementMode: <mode> }`.
- Triggers apply-policy to activate the mode change.
- Invalid `mode` values return `INVALID_ARGUMENT` immediately without network calls.

---

### ListPolicies

Enumerate all ASM policies with their current enforcement mode.

**Request**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | ✓ | Token from Login |

**Response**:

| Field | Type | Description |
|-------|------|-------------|
| `code` | int32 | 0 = success |
| `message` | string | Summary (e.g., "Found 3 policy(ies)") |
| `policies` | repeated Policy | List of policies |

**Policy fields**:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Internal F5 policy ID |
| `name` | string | Policy name |
| `enforcement_mode` | string | `"blocking"` or `"transparent"` |
| `active` | bool | Whether the policy is active |

---

### Logout

Invalidate the session token.

**Request**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | ✓ | Token to invalidate |

**Response**:

| Field | Type | Description |
|-------|------|-------------|
| `code` | int32 | 0 = success |
| `message` | string | Status |

**Behavior**:
- HTTP 404 (token already expired) is treated as success.

---

## Error Mapping

| Condition | gRPC Status |
|-----------|-------------|
| Missing required param | `INVALID_ARGUMENT` |
| 401 or 403 from F5 | `PERMISSION_DENIED` |
| Other 4xx from F5 | `FAILED_PRECONDITION` |
| 5xx from F5 | `UNAVAILABLE` |
| Network / TLS error | `UNAVAILABLE` |
| Request timeout | `DEADLINE_EXCEEDED` |
| Policy not found | `NOT_FOUND` |

---

## Suggested Capset

```
Login                → read
BlockIP              → write
UnblockIP            → write
AllowIP              → write
SetEnforcementMode   → write
ListPolicies         → read
Logout               → read
```

---

## Risk Notes

- **`verify_ssl: false`** skips TLS certificate validation. Only use in trusted networks or lab environments.
- **Token lifetime**: F5 tokens expire in ~20 minutes by default. Always call `Logout` when done, and obtain a fresh token for new sessions.
- **Apply-policy**: After IP changes, the package triggers `apply-policy` to activate changes in the AWAF policy. This is async on the F5 side; enforcement may have a brief propagation delay.
- **write operations**: `BlockIP` and `UnblockIP` modify the ASM policy's IP exception list. These are tracked in F5 audit logs.

---

## Local Checks

```bash
npm run validate     # validate service.json + schemas
npm test             # run unit + integration tests (no real F5 needed)
npm run pack:check   # verify package structure
```

---

## Real-Device Verification ✅

Verified on BIG-IP 17.5.1 (`https://172.16.221.9:8443`) — 2026-06-26.

- [x] IP exception endpoint is `POST /mgmt/tm/asm/policies/{id}/whitelist-ips` (not `ip-exceptions`). `blockRequests` field name and accepted values (`always` / `never`) confirmed correct.
- [x] `GET /mgmt/tm/asm/policies?$select=id,name,enforcementMode,active` — query parameter format confirmed working.
- [x] `POST /mgmt/tm/asm/tasks/apply-policy` — request body `{"policyReference":{"link":"..."}}` confirmed; returns task id with `status: "NEW"`.
- [x] Token expiry: `DELETE /mgmt/shared/authz/tokens/{token}` invalidates immediately; subsequent requests return HTTP 401.

---

## Development

```bash
# start mock server manually
node test/mock_upstream.js

# run only unit tests
node --test test/ --test-name-pattern="unit|mergedBindings|rpcdef"
```
