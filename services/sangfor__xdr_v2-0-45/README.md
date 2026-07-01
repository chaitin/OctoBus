# Sangfor XDR V2.0.45

OctoBus service package for the seven read-only investigation capabilities requested by [Issue #140](https://github.com/chaitin/OctoBus/issues/140).

## Supported Version

- Service name: `sangfor-xdr-v2-0-45`
- Service dir: `sangfor__xdr_v2-0-45`
- Runtime mode: `long-running`
- Vendor: Sangfor (深信服)
- Product: XDR
- Verified version: V2.0.45
- Authentication: Sangfor linkage code (`authCode`) or its decoded AK/SK pair

The package was implemented against the Sangfor XDR V2.0.45 OpenAPI documentation and verified with a real V2.0.45 device. Other XDR versions may have different request fields, enum values, response structures, or endpoint behavior and are not currently guaranteed.

## Package Files

- `service.json`: OctoBus service manifest and business CLI definitions.
- `proto/sangfor_xdr_v2_0_45.proto`: seven unary RPC definitions.
- `config.schema.json`: non-secret endpoint, timeout, TLS, and header settings.
- `secret.schema.json`: linkage code or AK/SK credentials.
- `src/signer.js`: linkage-code decoding and Sangfor HMAC-SHA256 signing.
- `src/client.js`: signed HTTPS client and error mapping.
- `src/sangfor-xdr-v2-0-45.js`: request/response mapping and RPC handlers.
- `src/service.js`: OctoBus SDK service definition.
- `bin/sangfor-xdr-v2-0-45.js`: service-local executable.
- `test/sangfor-xdr-v2-0-45.test.js`: signing, mapping, transport, error, and SDK-context tests.
- `test/mock_upstream.js`: in-process fake XDR HTTP upstream and fake fetch response helper used by tests.

## Import

From the OctoBus repository root:

```bash
./bin/octobus service import \
  sangfor-xdr-v2-0-45 \
  ./services/sangfor__xdr_v2-0-45
```

When importing from the multi-service npm distribution, select this service root:

```bash
./bin/octobus service import \
  sangfor-xdr-v2-0-45 \
  npm:@chaitin-ai/octobus-tentacles//sangfor__xdr_v2-0-45
```

## Configuration

Store non-sensitive settings in the instance config:

```json
{
  "baseUrl": "https://xdr.example.com",
  "timeoutMs": 15000,
  "skipTlsVerify": false,
  "headers": {}
}
```

- `baseUrl`: XDR platform URL without an API path.
- `timeoutMs`: request timeout from 1 to 300000 milliseconds.
- `skipTlsVerify`: accepts a private or self-signed appliance certificate. Enable only on a trusted network.
- `headers`: optional non-secret headers added before request signing. Do not place credentials, cookies, or authorization values here.

## Authentication

Store credentials in the instance secret, never in config or committed files.

Use a Sangfor linkage code:

```json
{
  "authCode": "replace-with-linkage-code"
}
```

Alternatively, use an AK/SK pair:

```json
{
  "accessKey": "replace-with-access-key",
  "secretKey": "replace-with-secret-key"
}
```

The implementation follows the supplied Sangfor examples: linkage-code hexadecimal parsing, AES-256-CBC credential decoding, canonical request construction, SHA-256 hashing, and HMAC-SHA256 authorization.

## Create an Instance

The following command uses placeholders and must not be committed with real credentials:

```bash
./bin/octobus instance create \
  sangfor-xdr-test \
  --service sangfor-xdr-v2-0-45 \
  --config-json '{
    "baseUrl": "https://xdr.example.com",
    "timeoutMs": 20000,
    "skipTlsVerify": false
  }' \
  --secret-json '{
    "authCode": "replace-with-linkage-code"
  }'
```

For a device using a private or self-signed certificate, set `skipTlsVerify` to `true` only after confirming the destination is the intended XDR appliance.

## RPC Methods

| RPC | Description | XDR endpoint |
| --- | --- | --- |
| `SearchIncidents` | Query correlated security incidents. | `POST /api/xdr/v1/incidents/list` |
| `GetIncidentContext` | Query incident proof and related process, file, host, external-IP, internal-IP, and DNS entities. | `GET /api/xdr/v1/incidents/:uuid/proof` and `/entities/*` |
| `SearchAlerts` | Query raw security alerts. | `POST /api/xdr/v1/alerts/list` |
| `GetAlertContext` | Query evidence and context for one alert. | `GET /api/xdr/v1/alerts/:uuid/proof` |
| `SearchAssets` | Query assets managed by XDR. | `POST /api/xdr/v1/assets/list` |
| `SearchRiskHosts` | Query hosts assessed as risky. | `POST /api/xdr/v1/riskassets/list` |
| `SearchVulnerabilities` | Query vulnerability and weak-password findings. | `POST /api/xdr/v1/vuls/risk/list` |

All methods are unary and available through gRPC, Connect RPC, MCP, OpenAPI, and the generated local business CLI.

## Business CLI Examples

From the `services` directory, provide config and secret through CLI files, CLI JSON, or `OCTOBUS_SERVICE_CONTEXT`. Never include a real linkage code in screenshots, shell history, documentation, or commits.

```bash
./bin/sangfor-xdr-v2-0-45.js search-incidents \
  --data-json '{"page":1,"pageSize":5}'
```

Use an incident `uuId` returned by `SearchIncidents`:

```bash
./bin/sangfor-xdr-v2-0-45.js get-incident-context \
  --data-json '{"uuid":"replace-with-incident-uuid","includeFiles":true}'
```

```bash
./bin/sangfor-xdr-v2-0-45.js search-alerts \
  --data-json '{"page":1,"pageSize":5}'
```

Use an alert `uuId` returned by `SearchAlerts`:

```bash
./bin/sangfor-xdr-v2-0-45.js get-alert-context \
  --data-json '{"uuid":"replace-with-alert-uuid"}'
```

```bash
./bin/sangfor-xdr-v2-0-45.js search-assets \
  --data-json '{"page":1,"pageSize":5}'
```

```bash
./bin/sangfor-xdr-v2-0-45.js search-risk-hosts \
  --data-json '{"page":1,"pageSize":5}'
```

```bash
./bin/sangfor-xdr-v2-0-45.js search-vulnerabilities \
  --data-json '{
    "startTimestamp": 1750000000,
    "endTimestamp": 1752592000,
    "timeField": "update_time",
    "pageSize": 5,
    "dataType": "loophole"
  }'
```

Replace example timestamps with the required query window. The verified device requires list `pageSize` values of at least 5. Verified vulnerability `timeField` values follow the XDR API convention, such as `update_time`, `found_time`, and `last_time`.

## Capset Setup

Create a capset and add the instance:

```bash
./bin/octobus capset create xdr-investigation --name "XDR Investigation"

./bin/octobus capset add-instance \
  xdr-investigation \
  sangfor-xdr-test
```

`capset add-instance` selects all current methods by default. For least privilege, use `--no-all-methods` and select only the methods required by the agent.

### Recommended Capsets

**XDR basic search**

- `SearchIncidents`
- `SearchAlerts`
- `SearchAssets`
- `SearchRiskHosts`
- `SearchVulnerabilities`

This capset is suitable for inventory, triage, reporting, and broad read-only search agents.

**XDR investigation**

- All methods in XDR basic search
- `GetIncidentContext`
- `GetAlertContext`

This capset is suitable for investigation agents that require evidence and entity context. Context methods may expose substantially more sensitive data and generate multiple upstream requests.

## Dynamic Filters and Responses

Common filters have typed protobuf fields. Every search request also supports `extraFilters`, an object merged into the XDR JSON request. Typed fields override keys with the same name in `extraFilters`.

XDR response models contain many version-dependent fields. Search responses therefore provide:

- normalized `code`, `message`, `total`, `page`, and `pageSize`;
- structured `data`;
- `rawJson`/`raw_json` fields are intentionally empty; complete upstream raw responses are not returned by this service.

`GetIncidentContext` always fetches proof. When no entity selector is set, it fetches every entity group. When one or more selectors are `true`, it fetches only those selected groups.

## Risk and Security Notes

- All seven capabilities are read-only. This package does not modify XDR state and therefore has no write-operation defaults, idempotency contract, rollback procedure, or cleanup requirement.
- Linkage codes and AK/SK credentials grant API access. Rotate credentials immediately if they appear in a terminal screenshot, shell history, log, issue, chat, or commit.
- `skipTlsVerify: true` disables certificate verification and permits man-in-the-middle attacks. Use it only for a known appliance on a trusted network.
- Search results and context responses may contain asset IPs, hostnames, MAC addresses, account names, vulnerabilities, event evidence, and other business-sensitive data.
- Complete upstream raw bodies are not returned. Structured result fields may still contain sensitive business data and should not be copied into external logs unless required.
- `GetIncidentContext` can issue up to seven upstream requests: one proof request plus six entity-group requests. Select only required entity groups to reduce load and data exposure.
- Use bounded time ranges and the minimum accepted page size for routine queries. Avoid unbounded or high-frequency polling.
- OctoBus access logs do not store request or response bodies, but external agent logs, terminal output, screenshots, and observability systems may do so.
- Use dedicated read-only XDR credentials and least-privilege capsets where supported.

## Error Mapping

- Invalid request, config, or linkage code: `INVALID_ARGUMENT`
- Missing credentials or HTTP 401: `UNAUTHENTICATED`
- HTTP 403: `PERMISSION_DENIED`
- HTTP 404: `NOT_FOUND`
- HTTP 429, HTTP 5xx, timeout, TLS, or network failure: `UNAVAILABLE`
- Other HTTP 4xx or XDR business errors: `FAILED_PRECONDITION`
- Invalid or empty successful JSON: `UNKNOWN`

Errors do not include credentials, authorization headers, or complete upstream bodies.

## Real Device Verification

The seven capabilities were verified on June 25, 2026 against a Sangfor XDR V2.0.45 device using linkage-code authentication:

- `SearchIncidents`
- `GetIncidentContext`
- `SearchAlerts`
- `GetAlertContext`
- `SearchAssets`
- `SearchRiskHosts`
- `SearchVulnerabilities`

Verification used read-only requests and did not create, modify, or delete device data. The device address, credential, UUIDs, asset details, event details, and response bodies are intentionally omitted. PR evidence must be redacted before upload.

## Known Limitations

- Only Sangfor XDR V2.0.45 has been verified.
- Response fields are partly dynamic and are exposed through `google.protobuf.Value`; consumers should tolerate additive or version-dependent fields.
- The package does not automatically paginate through all records.
- `GetIncidentContext` fails if any selected upstream entity request fails; it does not return a partial-success envelope.
- Request enum values and minimum page sizes are enforced by the device and may vary by XDR version.
- Vulnerability and weak-password results share one RPC and are selected with `dataType`.
- Private appliance certificates may require a trusted CA installation or, with explicit risk acceptance, `skipTlsVerify: true`.

## Local Checks

```bash
cd services
npm run validate -- --service-dir sangfor__xdr_v2-0-45
npm test -- --service-dir sangfor__xdr_v2-0-45
npm run pack:check
```

For coverage:

```bash
npm test -- --service-dir sangfor__xdr_v2-0-45 --coverage
```
