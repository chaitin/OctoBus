# Prometheus Alertmanager 0.27.0

OctoBus service package for Prometheus Alertmanager 0.27.0 read-only HTTP API v2.

## Methods

| Method | Description |
|--------|-------------|
| `ListAlerts` | List all alerts with optional filters (silenced, inhibited, active) |
| `GetAlertGroups` | Get alerts grouped by label sets |
| `ListSilences` | List all configured silences |
| `GetSilence` | Get a single silence by ID |
| `GetStatus` | Get Alertmanager runtime and cluster status |
| `ListReceivers` | List configured Alertmanager receivers and their notification integrations |

## Configuration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `baseUrl` | string | Yes | Alertmanager URL (e.g. `https://alertmanager.example.com:9093`) |
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

- [Alertmanager HTTP API](https://prometheus.io/docs/alerting/latest/alerts_api/)
- [Alertmanager Documentation](https://prometheus.io/docs/alerting/latest/alertmanager/)