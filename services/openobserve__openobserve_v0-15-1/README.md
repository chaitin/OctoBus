# OpenObserve v0.15.1

OctoBus service package for OpenObserve v0.15.1 read-only operations via the REST API.

## Methods

| Method | Description |
|--------|-------------|
| `ListOrganizations` | List all OpenObserve organizations |
| `ListStreams` | List streams in an organization |
| `GetStreamSchema` | Get schema for a specific stream |
| `SearchData` | Search data in a stream using SQL |
| `ListFunctions` | List functions in an organization |

## Configuration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `baseUrl` | string | Yes | OpenObserve base URL (e.g. `https://o2.example.com:5080`) |
| `timeoutMs` | integer | No | HTTP timeout in milliseconds (default: 10000) |
| `skipTlsVerify` | boolean | No | Skip TLS certificate verification |

## Secrets

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `username` | string | Yes* | OpenObserve username (email) |
| `password` | string | Yes* | OpenObserve password |
| `token` | string | Yes* | API token (alternative to username/password) |

\* Either username/password or token is required.

## API Reference

- [OpenObserve API Documentation](https://openobserve.ai/docs/api/)
- [OpenObserve GitHub](https://github.com/openobserve/openobserve)