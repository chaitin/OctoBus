# AlienVault OTX Service Package

OctoBus package for [AlienVault OTX](https://otx.alienvault.com/) (Open Threat Exchange) — free IP and domain threat intelligence.

## Features

- **No API key required** — unlimited usage
- **200,000+ contributors** sharing threat data
- **2 RPC methods** covering IP and domain intelligence

## Methods

| RPC | HTTP API | Type | Description |
|-----|----------|------|-------------|
| `CheckIP` | `GET /api/v1/indicators/IPv4/{ip}/general` + `/malware` | Read | IP reputation, ASN, geo, malware samples |
| `CheckDomain` | `GET /api/v1/indicators/domain/{domain}/general` + `/malware` | Read | Domain intelligence, malware samples |

## Usage

```bash
# Create instance
octobus instance create otx-test --service alienvault-otx

# Create capset
octobus capset create threat-intel --name Threat-Intel
octobus capset add-instance threat-intel otx-test

# Check IP
curl -X POST 'http://127.0.0.1:9000/capsets/threat-intel/connect/otx-test/AlienVault_OTX.AlienVault_OTX/CheckIP' \
  -H 'Content-Type: application/json' -d '{"ip":"8.8.8.8"}'

# Check domain
curl -X POST 'http://127.0.0.1:9000/capsets/threat-intel/connect/otx-test/AlienVault_OTX.AlienVault_OTX/CheckDomain' \
  -H 'Content-Type: application/json' -d '{"domain":"example.com"}'
```
