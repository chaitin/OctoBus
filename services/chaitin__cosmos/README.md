# Chaitin Cosmos (万象) OctoBus Service

OctoBus service package for Chaitin Cosmos (万象) platform log APIs via Pedestal JSON-RPC.

## Features

- **SearchLogInfo**: Get log details by IDs
- **SearchLogList**: Search log list with keyword, time range, condition query, filters, and pagination
- **SearchAggregationStatistics**: Get log aggregation statistics with time-series data

## Configuration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `endpoint` | string | yes | Cosmos Pedestal RPC base URL, e.g. `https://cosmos.example.com` |
| `headers` | object | no | Extra HTTP headers sent to Cosmos |
| `timeoutMs` | integer | no | HTTP timeout in ms, default 5000 |
| `skipTlsVerify` | boolean | no | Skip TLS cert verification, default false |

## Secret

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `api_token` | string | yes | Cosmos JWT token for Authorization bearer header |

## Quick Start

```bash
# Import service
octobus service import cosmos ./services/chaitin__cosmos

# Create instance
octobus instance create cosmos-test --service cosmos --config-json '{"endpoint":"https://cosmos.demo.chaitin.cn","skipTlsVerify":false}' --secret-json '{"api_token":"xxx"}'

# create capset

octobus capset create cosmos --name cosmos
octobus capset add-instance cosmos cosmos-test

# Call via gRPC (e.g. grpcurl)
grpcurl -plaintext \
    -H "x-octobus-capset: cosmos" \
    -H "x-octobus-service: cosmos" \
    -H "x-octobus-instance: cosmos-test" \
    -d '{"time_range_start": "1750550400", "time_range_end": "1750723200", "count": "1", "offset": "0"}' \
    octobus_addr:9000 \
    Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList

# Call via MCP 

curl -X POST \
     -H "Content-Type: application/json" \
     "http://octobus_addr:9000/capsets/cosmos/mcp" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Call via connect-rpc
curl -s -X POST \
    "http://octobus_addr:9000/capsets/cosmos/connect/cosmos-test/Chaitin_COSMOS.Chaitin_COSMOS/SearchLogList" \
    -H "Content-Type: application/json" \
    -d '{"time_range_start": "1750550400", "time_range_end": "1750723200", "count": "1", "offset": "0"}'
```