# Shodan InternetDB Service Package

OctoBus package for [Shodan InternetDB](https://internetdb.shodan.io/) — a free, no-signup IP intelligence API.

## Features

- **No API key required** — unlimited usage
- **No signup needed**
- **Shodan** is a well-known security company (network device search engine)

## Methods

| RPC | HTTP API | Type | Description |
|-----|----------|------|-------------|
| `LookupIP` | `GET /{ip}` | Read | IP intelligence (ports, hostnames, CVEs, tags) |

## Configuration

| Config field | Default | Description |
|-------------|---------|-------------|
| `timeoutMs` | 10000 | HTTP request timeout |

No authentication required — `secret.schema.json` is empty.

## Usage

```bash
# Create instance
octobus instance create shodan-test \
  --service shodan-internetdb

# Create capset
octobus capset create threat-intel --name Threat-Intel
octobus capset add-instance threat-intel shodan-test

# Lookup IP
curl -X POST \
  'http://127.0.0.1:9000/capsets/threat-intel/connect/shodan-test/Shodan_InternetDB.Shodan_InternetDB/LookupIP' \
  -H 'Content-Type: application/json' \
  -d '{"ip":"8.8.8.8"}'
```
