# OctoBus Service Package: OpenCTI Threat Intelligence Platform

> `filigran__opencti` — OctoBus adapter for [OpenCTI](https://www.opencti.io/) by Filigran

## Supported Version

| Item | Detail |
|------|--------|
| **Target product** | OpenCTI (by Filigran) |
| **Supported versions** | OpenCTI 6.x / 7.x |
| **API type** | GraphQL (STIX 2.1 aligned) |
| **Authentication** | Bearer Token (Admin API token) |
| **Directory name** | `filigran__opencti` |
| **Service ID** | `opencti` |
| **Proto package** | `Filigran_OPENCTI` |
| **gRPC service** | `Filigran_OPENCTI.Filigran_OPENCTI` |
| **Runtime mode** | `long-running` |

## Configuration

### config (non-sensitive)

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `endpoint` | string | **yes** | — | OpenCTI platform base URL, e.g. `http://opencti.example.com:8080` |
| `timeoutMs` | integer | no | 30000 | HTTP request timeout in milliseconds |
| `skipTlsVerify` | boolean | no | false | Skip TLS certificate verification |

### secret (sensitive)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `api_token` / `apiToken` | string | **yes** | OpenCTI API authentication token (Bearer auth) |

### OctoBus Instance Configuration Example

```bash
octobus --addr 127.0.0.1:19000 instance create --service opencti opencti-local \
  --config '{"endpoint":"http://localhost:8080"}' \
  --secret '{"api_token":"<your-opencti-admin-token>"}'

octobus --addr 127.0.0.1:19000 capset add-instance --capset opencti-readonly --instance opencti-local \
  --access-token opencti-test-token
```

## RPC Methods

### SearchIndicators — 搜索威胁指标（IOC）

Search OpenCTI indicators by keyword, type, with pagination.

| Request Field | Type | Required | Description |
|---------------|------|----------|-------------|
| `search` | string | no | Search keyword (IP, domain, indicator name) |
| `indicator_types` | string[] | no | Filter by indicator types: `malicious-activity`, `anomaly`, `attribution`, etc. |
| `first` | Int64Value | no | Page size (default 20) |
| `cursor` | string | no | Pagination cursor from previous response |

**Response**: `items[]` (IndicatorRecord), `total`, `has_next_page`

### SearchObservables — 搜索网络可观测对象

Search OpenCTI cyber observables (IP, domain, hash, URL, etc.).

| Request Field | Type | Required | Description |
|---------------|------|----------|-------------|
| `search` | string | no | Search keyword |
| `entity_types` | string[] | no | Filter by entity type: `IPv4-Addr`, `Domain-Name`, `Url`, `File`, etc. |
| `first` | Int64Value | no | Page size (default 20) |
| `cursor` | string | no | Pagination cursor |

**Response**: `items[]` (ObservableRecord), `total`, `has_next_page`

### SearchReports — 搜索威胁报告

Search OpenCTI threat intelligence reports.

| Request Field | Type | Required | Description |
|---------------|------|----------|-------------|
| `search` | string | no | Search keyword |
| `report_types` | string[] | no | Filter by report type: `threat-report`, `internal-report`, etc. |
| `first` | Int64Value | no | Page size (default 20) |
| `cursor` | string | no | Pagination cursor |

**Response**: `items[]` (ReportRecord), `total`, `has_next_page`

### CreateIndicator — 创建威胁指标

Create a new threat indicator in OpenCTI.

| Request Field | Type | Required | Description |
|---------------|------|----------|-------------|
| `name` | string | **yes** | Indicator name |
| `pattern_type` | string | **yes** | Pattern type: `stix`, `sigma`, `pcre`, `snort`, `yara` |
| `pattern` | string | **yes** | Detection pattern expression |
| `valid_from` | string | no | Valid from (ISO 8601) |
| `indicator_types` | string[] | **yes** | Types: `malicious-activity`, `anomaly`, etc. |
| `description` | string | no | Description |
| `valid_until` | string | no | Valid until (ISO 8601) |
| `score` | Int64Value | no | Confidence score |

**Response**: `indicator` (IndicatorRecord)

**Idempotency**: OpenCTI allows duplicate indicator names. Callers should check existence before creating.

### CreateObservable — 创建可观测对象

Create a new cyber observable in OpenCTI.

| Request Field | Type | Required | Description |
|---------------|------|----------|-------------|
| `type` | string | **yes** | Observable type: `IPv4-Addr`, `IPv6-Addr`, `Domain-Name`, `Url`, `Hostname`, `Email-Addr`, `File`, `Text` |
| `value` | string | **yes** | Observable value (IP, domain, URL, hash, etc.) |

**Supported types**: IPv4-Addr, IPv6-Addr, IPv4-Addr-Range, IPv6-Addr-Range, Domain-Name, Hostname, Url, Email-Addr, File, Artifact, Mac-Addr, Text, Cryptographic-Key, User-Account, Mutex, Process, Software, Network-Traffic

**Response**: `observable` (ObservableRecord)

**Idempotency**: OpenCTI creates duplicate observables if value already exists. Use SearchObservables first.

### CreateReport — 创建威胁报告

Create a new threat intelligence report in OpenCTI.

| Request Field | Type | Required | Description |
|---------------|------|----------|-------------|
| `name` | string | **yes** | Report name |
| `published` | string | **yes** | Published date (ISO 8601) |
| `description` | string | no | Report description |
| `report_types` | string[] | no | Types: `threat-report`, `internal-report`, etc. |

**Response**: `report` (ReportRecord)

## Error Mapping

| OpenCTI HTTP / GraphQL | gRPC Code | Description |
|------------------------|-----------|-------------|
| 401 | `UNAUTHENTICATED` | Authentication failure |
| 403 | `PERMISSION_DENIED` | Access denied |
| 400 + GRAPHQL_VALIDATION_FAILED | `INVALID_ARGUMENT` | GraphQL validation error |
| 400 + FUNCTIONAL_ERROR | `FAILED_PRECONDITION` | Business rule violation |
| 404 + RESOURCE_NOT_FOUND | `FAILED_PRECONDITION` | Resource not found |
| Other 4xx | `FAILED_PRECONDITION` | Client error |
| 5xx / network error | `UNAVAILABLE` | Server or network error |

## Recommended Capsets

| Capset | Methods | Risk Level | Recommendation |
|--------|---------|------------|----------------|
| `opencti-readonly` | SearchIndicators, SearchObservables, SearchReports | Low | Read-only queries, safe for automated workflows |
| `opencti-write` | All 6 methods | Medium | Includes creation operations, requires audit control |

## Risk Notes

- **CreateIndicator / CreateObservable / CreateReport** are write operations that create new entities in OpenCTI. They are not idempotent — calling twice may create duplicates.
- **Bearer Token** grants access based on OpenCTI's role system. A token with admin privileges can access all data; consider using a restricted-privilege token for `opencti-readonly`.
- OpenCTI's GraphQL API does not support introspection in production; the service package uses hardcoded queries.

## Known Limitations

- `CreateObservable` for `File` type creates with both MD5 and SHA256 set to the same `value` input — callers should provide a hash value. For more complex File observable creation (different hashes), use OpenCTI's UI or API directly.
- OpenCTI GraphQL introspection is disabled; if the API changes in future versions, the hardcoded queries may need updating.

## Verification Commands

```bash
# npm validation
cd services
npm run validate -- --service-dir filigran__opencti
npm test -- --service-dir filigran__opencti
npm run pack:check

# OctoBus import
octobus --addr 127.0.0.1:19000 service import --id opencti services/filigran__opencti

# Instance creation
octobus --addr 127.0.0.1:19000 instance create --service opencti opencti-local \
  --config '{"endpoint":"http://localhost:8080"}' \
  --secret '{"api_token":"<your-token>"}'

# Capset configuration
octobus --addr 127.0.0.1:19000 capset add-instance --capset opencti-readonly --instance opencti-local \
  --access-token opencti-test-token

# gRPC call (OctoBus headers required)
grpcurl -plaintext \
  -H "authorization: Bearer opencti-test-token" \
  -H "x-octobus-capset: opencti-readonly" \
  -H "x-octobus-instance: opencti-local" \
  -d '{"search":"192.168"}' \
  127.0.0.1:19000 Filigran_OPENCTI.Filigran_OPENCTI/SearchIndicators

# Connect protocol call
curl -s -X POST http://127.0.0.1:19000/capsets/opencti-readonly/connect/opencti-local/Filigran_OPENCTI.Filigran_OPENCTI/SearchIndicators \
  -H "authorization: Bearer opencti-test-token" \
  -H "content-type: application/json" \
  -d '{"search":"192.168"}'
```

## Interface Source

- OpenCTI official public GraphQL API (STIX 2.1 aligned)
- No dependency on proprietary SDK or closed-source materials
- Code is original, written based on OpenCTI's publicly documented API patterns

## License

This service package is part of OctoBus and licensed under GPL-3.0, compatible with the project's license.
