# ReportedIP Service Package

OctoBus package for [ReportedIP](https://reportedip.de/) — a free, EU-hosted IP reputation service.

## Features

- **No API key required** for public check endpoint (100 req/day per IP)
- **EU/GDPR compliant** — hosted in Germany
- **1 RPC method** for IP reputation check

## Methods

| RPC | HTTP API | Type | Description |
|-----|----------|------|-------------|
| `CheckIP` | `GET /check-public?ip={ip}` | Read | IP reputation (confidence score, ISP, geo, hostnames) |

## Usage

```bash
# Create instance
octobus instance create reportedip-test --service reportedip

# Create capset
octobus capset create threat-intel --name Threat-Intel
octobus capset add-instance threat-intel reportedip-test

# Check IP
curl -X POST 'http://127.0.0.1:9000/capsets/threat-intel/connect/reportedip-test/ReportedIP.ReportedIP/CheckIP' \
  -H 'Content-Type: application/json' -d '{"ip":"8.8.8.8"}'
```

## Configuration

- `baseUrl` — optional ReportedIP API base URL. It defaults to
  `https://reportedip.de/wp-json/reportedip/v2`; use an HTTP(S) compatible
  gateway URL only when required by your environment.
- `timeoutMs` — optional HTTP timeout in milliseconds (default: `10000`).
