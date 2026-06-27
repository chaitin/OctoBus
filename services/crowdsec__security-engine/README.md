# Crowdsec Security Engine OctoBus Service

OctoBus service package for [Crowdsec](https://github.com/crowdsecurity/crowdsec) Security Engine — collaborative intrusion prevention and security automation.

Import it into OctoBus with:

```bash
octobus service import --id security-engine ./services/crowdsec__security-engine
```

## Supported Version

- Crowdsec v1.7.x (tested with v1.7.8)
- LAPI (Local API) on port 8080

## Authentication

Crowdsec LAPI uses two authentication mechanisms for different endpoints:

| Auth Type | Secret Fields | Used For |
|---|---|---|
| JWT (Machine) | `machineId` + `password` | Alerts CRUD, Decision management (BlockIP/UnblockIP/DeleteDecision) |
| API Key (Bouncer) | `apiKey` | ListDecisions (bouncer read endpoint) |

The service automatically logs in via `POST /v1/watchers/login` to obtain a JWT token, which is cached until expiry. For `ListDecisions`, the API Key (`X-Api-Key` header) is preferred when available; it falls back to JWT auth if no `apiKey` is configured.

## Configuration

```json
{
  "endpoint": "http://127.0.0.1:8080",
  "timeoutMs": 5000,
  "skipTlsVerify": false
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `endpoint` | string | (required) | Crowdsec LAPI base URL |
| `timeoutMs` | integer | 5000 | HTTP timeout in milliseconds |
| `skipTlsVerify` | boolean | false | Skip TLS verification for self-signed certs |

## Secret

```json
{
  "machineId": "your-machine-id",
  "password": "your-machine-password",
  "apiKey": "your-bouncer-api-key"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `machineId` | string | For JWT auth | Crowdsec machine ID |
| `password` | string | For JWT auth | Crowdsec machine password |
| `apiKey` | string | For ListDecisions | Bouncer API key (`cscli bouncers add <name>`) |

## RPC Methods

### ListAlerts

Query Crowdsec security alerts with optional filters.

- **Crowdsec API**: `GET /v1/alerts`
- **Auth**: JWT
- **Type**: Read

| Parameter | Type | Description |
|---|---|---|
| `scenario` | string | Filter by scenario name |
| `ip` | string | Filter by source IP |
| `scope` | string | Filter by source scope (ip, range, etc.) |
| `value` | string | Filter by source value (with scope) |
| `since` | string | Alerts newer than duration (Go duration: 1h, 24h, 7d) |
| `until` | string | Alerts older than duration |
| `simulated` | bool | Include simulated alerts |
| `has_active_decision` | bool | Only alerts with active decisions |
| `decision_type` | string | Filter by decision type (ban, captcha, etc.) |
| `limit` | int64 | Max number of results |
| `origin` | string | Filter by origin (crowdsec, cscli, CAPI, lists) |

### GetAlert

Get a specific alert by ID.

- **Crowdsec API**: `GET /v1/alerts/{alert_id}`
- **Auth**: JWT
- **Type**: Read

| Parameter | Type | Required | Description |
|---|---|---|---|
| `alert_id` | int64 | Yes | Alert ID |

### ListDecisions

List active Crowdsec decisions (blocked IPs/ranges).

- **Crowdsec API**: `GET /v1/decisions`
- **Auth**: API Key (preferred) or JWT (fallback)
- **Type**: Read

| Parameter | Type | Description |
|---|---|---|
| `scope` | string | Decision scope (ip, range, etc.) |
| `value` | string | Scope value |
| `type` | string | Decision type (ban, captcha, etc.) |
| `ip` | string | Shorthand for scope=ip&value= |
| `range` | string | Shorthand for scope=range&value= |
| `contains` | bool | Match decisions that contain or are contained within the value |
| `origins` | string | Comma-separated origins filter |
| `scenarios_containing` | string | Scenario name must contain one of these words |
| `scenarios_not_containing` | string | Scenario name must not contain any of these words |

### BlockIP

Block an IP address by creating a manual Crowdsec decision.

- **Crowdsec API**: `POST /v1/alerts` (creates an alert with an embedded decision)
- **Auth**: JWT
- **Type**: Write
- **Idempotency**: Not idempotent — repeated calls create duplicate decisions. Check with `ListDecisions` first.
- **Rollback**: Use `UnblockIP` or `DeleteDecision` to remove.
- **Audit**: The alert created has `origin=cscli`, `scenario=manual`, `kind=manual`.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `target_ip` | string | Yes | — | IP address to block |
| `duration` | string | No | `4h` | Block duration (Go duration: 4h, 24h, 7d) |
| `decision_type` | string | No | `ban` | Decision type (ban, captcha) |
| `reason` | string | No | `manual block via OctoBus` | Reason/description |

### UnblockIP

Unblock an IP address by deleting all matching decisions.

- **Crowdsec API**: `DELETE /v1/decisions?scope=ip&value=<ip>`
- **Auth**: JWT
- **Type**: Write
- **Idempotency**: Yes — unblocking an already-unblocked IP returns `deleted_count=0`.
- **Audit**: Returns count of deleted decisions.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `target_ip` | string | Yes | — | IP address to unblock |
| `scope` | string | No | `ip` | Decision scope to match |

### DeleteDecision

Delete a specific decision by ID.

- **Crowdsec API**: `DELETE /v1/decisions/{decision_id}`
- **Auth**: JWT
- **Type**: Write
- **Idempotency**: Yes — deleting a non-existent decision returns `deleted_count=0`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `decision_id` | int64 | Yes | Decision ID |

## Error Mapping

| Crowdsec HTTP | gRPC Code | Description |
|---|---|---|
| 400 | `INVALID_ARGUMENT` | Bad request / invalid parameters |
| 401 | `UNAUTHENTICATED` | Authentication failed |
| 403 | `PERMISSION_DENIED` | Access denied |
| 404 | `FAILED_PRECONDITION` | Resource not found |
| Other 4xx | `FAILED_PRECONDITION` | Client error |
| 5xx | `UNAVAILABLE` | Server error |
| Network error | `UNAVAILABLE` | Connection failure |
| Timeout | `DEADLINE_EXCEEDED` | Request timed out |

## Suggested Capsets

| Capset | Methods | Risk Level | Description |
|---|---|---|---|
| `crowdsec-readonly` | ListAlerts, GetAlert, ListDecisions | Low | Read-only queries |
| `crowdsec-block` | Above + BlockIP | Medium | Can block IPs (creates decisions) |
| `crowdsec-admin` | All methods | High | Full control including unblock/delete |

## Risk Notes

- **BlockIP** creates a manual decision that actually blocks traffic at the bouncer level. Use with caution.
- **UnblockIP** and **DeleteDecision** remove blocking decisions, which may re-allow malicious traffic.
- Crowdsec `DELETE /v1/decisions` and `DELETE /v1/alerts` endpoints require the caller to be from a trusted IP (127.0.0.1/::1 by default). If OctoBus is not running on the same host, these operations may fail with `PERMISSION_DENIED`.
- JWT tokens are cached in-process and auto-refreshed. If the Crowdsec LAPI restarts, the cache will be transparently refreshed.

## Local Checks

```bash
cd services
npm run validate -- --service-dir crowdsec__security-engine
npm test -- --service-dir crowdsec__security-engine
npm run pack:check
```

## Verification with Real Device

```bash
# 1. Create a bouncer API key
cscli bouncers add octobus-bouncer

# 2. Import into OctoBus
octobus --addr 127.0.0.1:19000 service import --id security-engine /tmp/OctoBus/services/crowdsec__security-engine

# 3. Create instance
octobus --addr 127.0.0.1:19000 instance create --service security-engine crowdsec-local \
  --config '{"endpoint":"http://127.0.0.1:8080"}' \
  --secret '{"machineId":"<machine-id>","password":"<password>","apiKey":"<bouncer-api-key>"}'

# 4. Add to capset
octobus --addr 127.0.0.1:19000 capset add-instance --capset crowdsec-readonly --instance crowdsec-local \
  --access-token crowdsec-test-token-2026

# 5. gRPC call
grpcurl -plaintext \
  -H "authorization: Bearer crowdsec-test-token-2026" \
  -H "x-octobus-capset: crowdsec-readonly" \
  -H "x-octobus-instance: crowdsec-local" \
  -d '{}' \
  127.0.0.1:19000 Crowdsec_SECURITY_ENGINE.Crowdsec_SECURITY_ENGINE/ListAlerts

# 6. Connect protocol
curl -s -X POST http://127.0.0.1:19000/capsets/crowdsec-readonly/connect/crowdsec-local/Crowdsec_SECURITY_ENGINE.Crowdsec_SECURITY_ENGINE/ListAlerts \
  -H "authorization: Bearer crowdsec-test-token-2026" \
  -H "content-type: application/json" \
  -d '{}'
```

## Known Limitations

- **No BlockIP REST endpoint**: Crowdsec LAPI does not provide a `POST /v1/decisions` endpoint. BlockIP is implemented by creating a manual alert with an embedded decision (same approach used by `cscli decisions add`). After creating the alert, the service fetches the full alert details via `GET /v1/alerts/{id}` to return complete decision information.
- **Decision stream not exposed**: The `GET /v1/decisions/stream` bouncer streaming endpoint is not included in this service. It uses chunked transfer encoding which is not well-suited for unary gRPC calls.
- **Trusted IP requirement**: Delete operations on decisions/alerts require the caller IP to be in Crowdsec's trusted IPs list (127.0.0.1/::1 by default).
- **Machine/Bouncer management**: Machine registration (`POST /v1/watchers`) and bouncer management are done via `cscli` CLI, not through this service.
- **User-Agent validation**: Crowdsec LAPI validates the User-Agent header. Node.js `fetch` sends `User-Agent: node` by default, which is rejected by Crowdsec. The service overrides this with `User-Agent: crowdsec-octobus/v1.0` on all requests.
- **DELETE decision parameters**: Crowdsec's `DELETE /v1/decisions` endpoint uses shortcut parameters (`ip=`, `range=`) rather than the `scope+value` combination. The UnblockIP method maps to the correct shortcut parameter based on the scope.
