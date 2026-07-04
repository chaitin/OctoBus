# ThreatBook HFish Honeypot OctoBus Service

OctoBus service package for [HFish](https://hfish.net/) honeypot by ThreatBook (Chaitin). Provides APIs to query attack source IPs, attack details, captured credentials, and system status.

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/hfish.proto`: gRPC API definition.
- `config.schema.json`: non-secret endpoint, headers, timeout, and TLS settings.
- `secret.schema.json`: HFish API key.
- `src/hfish.js`: HFish REST API proxy implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/threatbook-hfish.js`: service-local executable entrypoint.
- `test/hfish.test.js`: node:test coverage for request validation, REST mapping, error mapping, and SDK handler invocation.
- `test/mock_upstream.js`: optional local HFish HTTP mock.

## Configuration

Use `endpoint` for the HFish server base URL.

```json
{
  "endpoint": "https://hfish.example.com:4433",
  "headers": {
    "X-Extra": "demo"
  },
  "timeoutMs": 1500,
  "skipTlsVerify": true
}
```

Use `secret.apiKey` for the HFish API key:

```json
{
  "apiKey": "replace-with-hfish-api-key"
}
```

Requests may still pass `api_key` or `apiKey`; configured secret values take precedence over request values (because gRPC proto3 string fields default to `""` which would shadow the real secret).

## RPC Methods

| Method | HTTP Mapping | Description |
|--------|-------------|-------------|
| `ThreatBook_HFISH.ThreatBook_HFISH/ListAttackIPs` | `POST /api/v1/attack/ip?api_key=...&page=...&limit=...` | List attack source IPs with pagination |
| `ThreatBook_HFISH.ThreatBook_HFISH/ListAttackDetails` | `POST /api/v1/attack/detail?api_key=...&page=...&limit=...` | List attack details with pagination |
| `ThreatBook_HFISH.ThreatBook_HFISH/ListAttackAccounts` | `POST /api/v1/attack/account?api_key=...&page=...&limit=...` | List captured credentials from attacks |
| `ThreatBook_HFISH.ThreatBook_HFISH/GetSystemInfo` | `GET /api/v1/hfish/sys_info?api_key=...` | Get honeypot system status |

## Parameter Notes

- All POST endpoints send an empty `{}` JSON body; authentication and pagination are via query parameters.
- `page` defaults to 1, `limit` defaults to 20.
- HFish API response codes: `0` = success, `1003` = authentication failure (maps to `PERMISSION_DENIED`).

## Verification Screenshots

### HFish Setup & Instance

![HFish setup and instance dashboard](https://raw.githubusercontent.com/boy331/OctoBus/docs/hfish-screenshots-hosting/docs/hfish-screenshots/00-setup-and-instance.png)

HFish honeypot management console showing deployed instance and service status.

### npm test Passing

![npm test hfish results](https://raw.githubusercontent.com/boy331/OctoBus/docs/hfish-screenshots-hosting/docs/hfish-screenshots/01-npm-test-hfish.png)

All unit tests passing for the `threatbook__hfish` service package.

### Reflection & CapSet Instance

![Reflection capset instance verification](https://raw.githubusercontent.com/boy331/OctoBus/docs/hfish-screenshots-hosting/docs/hfish-screenshots/02-reflection-capset-instance.png)

OctoBus reflection API returning the CapSet instance for HFish service validation.

### Four RPCs via OctoBus

![Four RPCs invoked through OctoBus](https://raw.githubusercontent.com/boy331/OctoBus/docs/hfish-screenshots-hosting/docs/hfish-screenshots/03-four-rpcs-via-octobus.png)

All four RPC methods (`ListAttackIPs`, `ListAttackDetails`, `ListAttackAccounts`, `GetSystemInfo`) successfully invoked through OctoBus.

### Direct API vs OctoBus jsonName Mapping

![Direct API call vs OctoBus jsonName mapping](https://raw.githubusercontent.com/boy331/OctoBus/docs/hfish-screenshots-hosting/docs/hfish-screenshots/04-direct-vs-octobus-jsonname.png)

Side-by-side comparison: direct HFish API call vs. OctoBus RPC with `jsonName` field mapping, confirming consistent response structure.

### Access Log (NDJSON)

![Access log NDJSON output](https://raw.githubusercontent.com/boy331/OctoBus/docs/hfish-screenshots-hosting/docs/hfish-screenshots/05-access-log-ndjson.png)

OctoBus access log showing NDJSON-formatted request/response entries for HFish RPC calls.

## Behavior Notes

- HTTP 401/403 maps to `PERMISSION_DENIED`.
- Other HTTP 4xx responses map to `FAILED_PRECONDITION`.
- HTTP 5xx, network, and TLS failures map to `UNAVAILABLE`.
- Non-JSON success bodies map to `UNKNOWN`.
- HFish response code `1003` (illegal apikey) maps to `PERMISSION_DENIED`.
- Other non-zero HFish response codes map to `FAILED_PRECONDITION`.

## Local Checks

```bash
cd services
npm run validate -- --service-dir threatbook__hfish
npm test -- --service-dir threatbook__hfish --coverage
npm run pack:check
```

## Supported Versions

- HFish v3.x (tested on v3.3.6)

## Risk & CapSet Notes

- **Read-only operations**: all four methods are read-only queries.
- **Suggested CapSet**: `threat-intel` with read-only constraints.
- **No side effects**: these APIs do not modify any HFish configuration or data.
