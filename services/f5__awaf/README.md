# f5__awaf

OctoBus service package for **F5 Advanced WAF (AWAF)** — exposes IP blocking/unblocking via iControl REST API.

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
Login         → read
BlockIP       → write
UnblockIP     → write
Logout        → read
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

## Pending Real-Device Verification

The following behavior requires testing on physical F5 AWAF hardware:

- [ ] `POST /mgmt/tm/asm/policies/{id}/ip-exceptions` — confirm `blockRequests` field name and accepted values
- [ ] `GET /mgmt/tm/asm/policies?$filter=name+eq+...` — confirm query parameter format
- [ ] `POST /mgmt/tm/asm/tasks/apply-policy` — confirm request body format and task status polling
- [ ] Token expiry behavior with `DELETE /mgmt/shared/authz/tokens/{token}`

---

## Development

```bash
# start mock server manually
node test/mock_upstream.js

# run only unit tests
node --test test/ --test-name-pattern="unit|mergedBindings|rpcdef"
```
