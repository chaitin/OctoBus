# MISP Threat Intelligence Platform Service Package

OctoBus service package for [MISP](https://www.misp-project.org/) (Malware Information Sharing Platform) — threat intelligence sharing and IoC management.

## Supported Version

MISP 2.4+ (REST API).

## Authentication

Uses API key authentication via `Authorization` header. Obtain your API key from the MISP web interface:
**Event Actions → Automation → Auth key**.

## Configuration

### Config (non-secret fields)

```json
{
  "endpoint": "https://misp.example.com",
  "timeoutMs": 10000,
  "skipTlsVerify": false
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `endpoint` | (required) | MISP instance base URL, e.g. `https://misp.example.com` |
| `timeoutMs` | `10000` | HTTP request timeout (ms) |
| `skipTlsVerify` | `false` | Skip TLS verification for private instances |

### Secret (sensitive fields)

```json
{
  "api_key": "your-misp-api-key"
}
```

Both `snake_case` (`api_key`) and `camelCase` (`apiKey`) field names are accepted.

## Import

```bash
octobus service import --id misp ./services//misp__misp
```

## RPC Methods

| gRPC Method | CLI Command | Description |
|-------------|-------------|-------------|
| `MISP.MISP/SearchEvents` | `search-events` | Search threat events |
| `MISP.MISP/GetEvent` | `get-event` | Get event details with attributes |
| `MISP.MISP/CreateEvent` | `create-event` | Create a new threat event |
| `MISP.MISP/SearchAttributes` | `search-attributes` | Search attributes/IoCs |
| `MISP.MISP/AddAttribute` | `add-attribute` | Add an IoC to an event |
| `MISP.MISP/SearchTags` | `search-tags` | Search tag collection |

### Event Search

**SearchEvents** — Search events with flexible filters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `value` | string | Search value (IP, domain, hash, etc.) |
| `type` | string[] | Attribute type filter: `ip-src`, `ip-dst`, `domain`, `md5`, `sha256`, `url` |
| `category` | string[] | Category filter |
| `tags` | string[] | Include tags (OR logic) |
| `not_tags` | string[] | Exclude tags |
| `org` | string | Creator organisation |
| `from` / `to` | string | Date range (`YYYY-MM-DD`) |
| `last` | string | Shorthand: `5d`, `12h`, `30m` |
| `limit` / `page` | int64 | Pagination |
| `metadata` | bool | Only return metadata (no attributes) |

### Event Detail

**GetEvent** — Get full event with attributes:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `event_id` | string | Yes | Event ID |

### Event Creation

**CreateEvent** — Create a new event:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `info` | string | Yes | Event description |
| `date` | string | No | Event date (default: today) |
| `threat_level_id` | int64 | No | 1=Low, 2=Medium, 3=High, 4=Critical |
| `analysis` | int64 | No | 0=Initial, 1=Ongoing, 2=Completed |
| `published` | bool | No | Publish status |
| `distribution` | int64 | No | 0=Your org, 1=Community, 2=Connected, 3=All |

### Attribute Search

**SearchAttributes** — Search IoCs/attributes:

| Parameter | Type | Description |
|-----------|------|-------------|
| `value` | string | Search value |
| `type` | string[] | Attribute type filter |
| `tags` / `not_tags` | string[] | Tag filters |
| `event_id` | string | Filter by event |
| `include_event` | bool | Include event info in results |
| `to_ids` | bool | Only IDS-signable attributes |

### Add Attribute (Write Operation)

**AddAttribute** — Add an IoC to an existing event:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `event_id` | string | Yes | Target event ID |
| `value` | string | Yes | IoC value (IP, domain, hash, etc.) |
| `type` | string | Yes | IoC type: `ip-src`, `ip-dst`, `domain`, `md5`, `sha256`, `url` |
| `category` | string | No | Attribute category |
| `to_ids` | bool | No | Mark for IDS rules |
| `comment` | string | No | Comment |
| `distribution` | int64 | No | Distribution level |

## Write Operation Semantics

### CreateEvent

| Aspect | Description |
|--------|-------------|
| **Default parameters** | `date`=today, `threat_level_id`=undefined (MISP default), `analysis`=0, `published`=false, `distribution`=0 |
| **Idempotency** | Not idempotent. Each call creates a new event. Use `event_id` deduplication externally |
| **Rollback** | Created event can be deleted via MISP web UI or custom API call (`POST /events/delete/[id]`) |
| **Audit fields** | Requests logged via `x-engine-instance` and `x-request-id` headers; MISP internally logs all changes |

### AddAttribute

| Aspect | Description |
|--------|-------------|
| **Default parameters** | `to_ids`=false, `distribution`=inherits from event |
| **Idempotency** | Not inherently idempotent. MISP may reject duplicates based on value+type+event combination |
| **Rollback** | Attribute can be deleted via MISP web UI or custom API call (`POST /attributes/deleteSelected/[event_id]`) |
| **Audit fields** | Same as CreateEvent |

## Behavior Notes

- All API calls use **POST** or **GET** to the configured MISP endpoint.
- Authentication is via `Authorization` header (API key).
- HTTP 401 maps to `UNAUTHENTICATED`; HTTP 403 maps to `PERMISSION_DENIED`.
- Other HTTP 4xx maps to `FAILED_PRECONDITION`.
- HTTP 5xx and network errors map to `UNAVAILABLE`.
- MISP API errors (`errors` field in response) map to `FAILED_PRECONDITION`.
- Non-JSON responses map to `UNKNOWN`.
- Missing `endpoint` or `api_key` map to `FAILED_PRECONDITION`.
- Missing required parameters map to `INVALID_ARGUMENT`.

## Risk & Recommended Capset

**Risk**: Write operations (`CreateEvent`, `AddAttribute`) create new data in MISP. Use with appropriate caution.

**Recommended `capset`**:
- Read operations: `["recon"]`
- Write operations: `["recon", "intrusion-response"]`

## Validation

```bash
cd services
npm run validate -- --service-dir misp__misp
npm test -- --service-dir misp__misp --coverage
npm run pack:check
```

## Known Limitations

1. Pagination with large result sets may require multiple API calls.
2. `SearchEvents` returns events but not their attributes by default; use `GetEvent` for full details.
3. MISP instance must be reachable from the OctoBus runtime.
4. The MISP API key must have appropriate permissions for write operations.
