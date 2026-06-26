# CNCF Prometheus 3.0.1

OctoBus service package for Prometheus 3.0.1 read-only HTTP API v1.

## Methods

| Method | Description |
|--------|-------------|
| `InstantQuery` | Evaluate an instant PromQL query at a single point in time |
| `RangeQuery` | Evaluate a PromQL expression over a time range |
| `ListTargets` | List scrape targets and their health status |
| `ListRules` | List recording and alerting rules |
| `ListAlerts` | List current active and pending alerts |
| `ListSeries` | Find time series matching label matchers |
| `ListLabels` | List all label names known to Prometheus |
| `GetLabelValues` | Get all values for a given label name |
| `GetStatusConfig` | Get the Prometheus server configuration YAML |
| `GetStatusBuildinfo` | Get Prometheus server build information |
| `GetStatusFlags` | Get Prometheus server command-line flags |
| `ListAlertmanagers` | List known Alertmanager instances known to this Prometheus |
| `ListScrapePools` | List all configured scrape pool names |
| `ListTargetsMetadata` | List metadata for scrape targets, optionally filtered by target or metric |
| `ListMetadata` | List metric metadata known to Prometheus, optionally filtered by metric or target |

## Configuration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `baseUrl` | string | Yes | Prometheus server URL (e.g. `https://prometheus.example.com:9090`) |
| `timeoutMs` | integer | No | HTTP timeout in milliseconds (default: 10000) |
| `skipTlsVerify` | boolean | No | Skip TLS certificate verification |

## Secrets

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `username` | string | No | Username for HTTP Basic Auth |
| `password` | string | No | Password for HTTP Basic Auth |
| `bearerToken` | string | No | Bearer token for Authorization header |

Authentication is optional. If no credentials are provided, requests are sent without authentication.

## API Reference

- [Prometheus HTTP API](https://prometheus.io/docs/prometheus/latest/querying/api/)
- [Prometheus Querying Basics](https://prometheus.io/docs/prometheus/latest/querying/basics/)