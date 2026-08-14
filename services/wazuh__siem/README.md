# Wazuh SIEM OctoBus Service

This package provides OctoBus integration for Wazuh SIEM security monitoring platform.

Import it into OctoBus with:

```bash
octobus service import siem ./services/wazuh__siem
```

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/wazuh_siem.proto`: gRPC API definition.
- `config.schema.json`: dual endpoint, headers, timeout, and TLS settings.
- `secret.schema.json`: Manager JWT credentials and Indexer Basic Auth credentials.
- `src/wazuh-siem.js`: dual-endpoint REST proxy (Manager JWT + Indexer OpenSearch).
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/siem.js`: service-local executable entrypoint.
- `test/wazuh-siem.test.js`: node:test coverage for both endpoints.
- `test/mock_upstream.js`: optional local mock (JWT auth + OpenSearch).

## Architecture

Wazuh 4.9.x uses a dual-endpoint architecture:

| Endpoint | Component | Auth | Used By |
|----------|-----------|------|---------|
| `endpoint` | Manager API (port 55000) | JWT (Basic Auth → Bearer) | ListAgents |
| `indexerEndpoint` | Indexer (OpenSearch, port 9200) | Basic Auth | ListAlerts, GetAlertSummary, ListVulnerabilities, GetVulnerabilitySummary |

- The **Manager API** provides management operations (agents, rules, config).
- The **Indexer** (OpenSearch) stores alert and vulnerability data in `wazuh-alerts-*` and `wazuh-vulnerabilities-*` indices.

## Configuration

Use `endpoint` for the Wazuh Manager API and `indexerEndpoint` for the Wazuh Indexer (OpenSearch):

```json
{
  "endpoint": "https://wazuh-manager:55000",
  "indexerEndpoint": "https://wazuh-indexer:9200",
  "headers": {
    "X-Extra": "demo"
  },
  "timeoutMs": 5000,
  "skipTlsVerify": true
}
```

Use `secret.username` / `secret.password` for Manager JWT auth, and `secret.indexerUsername` / `secret.indexerPassword` for Indexer Basic Auth:

```json
{
  "username": "wazuh",
  "password": "your-manager-password",
  "indexerUsername": "admin",
  "indexerPassword": "your-indexer-password"
}
```

Requests may still pass `username` and `password` for Manager JWT auth; request values take precedence over the configured secret values.

## Authentication

### Manager API (JWT Token)

Wazuh Manager uses JWT token authentication:

1. **Token acquisition**: `POST /security/user/authenticate` with Basic Auth (`username:password`)
2. **Token caching**: JWT token cached with expiry time (default 900s/15min)
3. **Token refresh**: Token refreshed 60s before expiry
4. **Auto-retry**: On HTTP 401 (expired token), automatically re-authenticates and retries once

### Indexer API (Basic Auth)

Wazuh Indexer (OpenSearch) uses HTTP Basic Auth:

- `Authorization: Basic <base64(username:password)>`
- Default username is `admin`; password depends on your deployment

## RPC Methods

- `Wazuh_SIEM.Wazuh_SIEM/ListAlerts` — Query security alerts via OpenSearch `wazuh-alerts-*` indices with DSL query, time range, severity level filtering, and pagination.
- `Wazuh_SIEM.Wazuh_SIEM/GetAlertSummary` — Get alert severity distribution via OpenSearch range aggregation on `rule.level`.
- `Wazuh_SIEM.Wazuh_SIEM/ListVulnerabilities` — Query vulnerability results from `wazuh-vulnerabilities-*` indices for a specific agent (requires `agent_id`).
- `Wazuh_SIEM.Wazuh_SIEM/GetVulnerabilitySummary` — Get vulnerability severity counts via OpenSearch terms aggregation on `vulnerability.severity` (requires `agent_id`).
- `Wazuh_SIEM.Wazuh_SIEM/ListAgents` — List Wazuh agents via Manager API `/agents` with status, OS, and group information (useful for discovering `agent_id` for vulnerability queries).

## Behavior Notes

- `ListAlerts` sends `POST /wazuh-alerts-*/_search` to the Indexer with OpenSearch query DSL. The `query` field is built from `start_time`, `end_time`, `severity_min` (converted to range filters), and any raw `query` string (converted to `query_string`). Default sort is `timestamp:desc`.
- `GetAlertSummary` sends `POST /wazuh-alerts-*/_search` to the Indexer with `size: 0` and a range aggregation on `rule.level` (buckets: level_12_plus ≥12, level_8_11 8-11, level_4_7 4-7, level_0_3 <4).
- `ListVulnerabilities` sends `POST /wazuh-vulnerabilities-*/_search` to the Indexer with `agent.id` term filter plus optional `query_string` from the `query` field. `agent_id` is required.
- `GetVulnerabilitySummary` sends `POST /wazuh-vulnerabilities-*/_search` to the Indexer with `agent.id` term filter and `vulnerability.severity` terms aggregation. `agent_id` is required.
- `ListAgents` calls `GET /agents` on the Manager API with `status`, `limit`, `offset`, `search`, `q` parameters. Default status is "active".
- HTTP 401/403 maps to `PERMISSION_DENIED`.
- Other HTTP 4xx responses map to `FAILED_PRECONDITION`.
- HTTP 5xx, network, and TLS failures map to `UNAVAILABLE`.
- Non-JSON success bodies map to `UNKNOWN`.

## Local Checks

```bash
cd services
npm run validate -- --service-dir wazuh__siem
npm test -- --service-dir wazuh__siem --coverage
npm run pack:check
```

## Deployment

```bash
# Import service
octobus service import siem ./services/wazuh__siem

# Create instance with dual endpoint
octobus instance create wazuh-local \
  --service siem \
  --config-json '{"endpoint":"https://localhost:55000","indexerEndpoint":"https://localhost:9200","skipTlsVerify":true}' \
  --secret-json '{"username":"wazuh","password":"wazuh","indexerUsername":"admin","indexerPassword":"admin"}'

# Create capset
octobus capset create wazuh-readonly --name "Wazuh Read-Only"
octobus capset add-instance wazuh-readonly wazuh-local
octobus capset add-token wazuh-readonly wazuh-test-token --token wazuh-test-token

# Verify
grpcurl -plaintext -protoset <descriptor.protoset> \
  -H "authorization: Bearer wazuh-test-token" \
  -d '{"username":"wazuh","password":"wazuh"}' \
  <host>:<port> Wazuh_SIEM.Wazuh_SIEM/ListAgents
```
