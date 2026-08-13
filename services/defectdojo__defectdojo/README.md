# DefectDojo

OctoBus service for DefectDojo API v2.

- Service name: `defectdojo`
- Service dir: `defectdojo__defectdojo`
- Runtime mode: `long-running`

The implementation focuses on commonly used DefectDojo API v2 calls that are easy to validate against a local Docker deployment:

- `ListProducts`
- `ListEngagements`
- `ListFindings`
- `GetFinding`
- `ImportScan`
- `ReimportScan`

## Supported Version

Verified with DefectDojo `3.0.100` using the official Docker Compose deployment from `DefectDojo/django-DefectDojo`.

The service uses DefectDojo API v2 endpoints and should also work with nearby DefectDojo versions that keep the same API v2 request and response shapes.

## Configuration

`config.schema.json`

- `defectdojo_base_url`: DefectDojo base URL, for example `http://localhost:8080`.
- `baseUrl` / `restBaseUrl`: aliases for `defectdojo_base_url`.
- `headers`: optional extra HTTP headers.
- `timeoutMs`: HTTP timeout in milliseconds.

`secret.schema.json`

- `defectdojo_api_key`: DefectDojo API v2 token value, without the `Token ` prefix.
- `apiKey` / `token`: aliases for `defectdojo_api_key`.

DefectDojo API v2 uses the header `Authorization: Token <api.key>`.

Example instance config:

```json
{
  "config": {
    "defectdojo_base_url": "http://localhost:18088",
    "timeoutMs": 5000
  },
  "secret": {
    "defectdojo_api_key": "<api-key-without-Token-prefix>"
  }
}
```

## API Mapping

- `ListProducts` -> read-only `GET /api/v2/products/`
- `ListEngagements` -> read-only `GET /api/v2/engagements/`
- `ListFindings` -> read-only `GET /api/v2/findings/`
- `GetFinding` -> read-only `GET /api/v2/findings/{id}/`
- `ImportScan` -> write `POST /api/v2/import-scan/`
- `ReimportScan` -> write `POST /api/v2/reimport-scan/`

List responses expose the common Django REST Framework pagination fields `count`, `next`, `previous`, and `results`. `raw_json` is intentionally empty; complete upstream raw response bodies are not returned.

`ImportScan` and `ReimportScan` send `multipart/form-data`. The scan report is provided as `file_name` plus `file_content`; the service does not read local filesystem paths.

## Method Notes

- `ListProducts`: read-only product query with optional pagination and name filters.
- `ListEngagements`: read-only engagement query with optional product, status, pagination, and name filters.
- `ListFindings`: read-only finding query with optional product, engagement, test, severity, active, verified, duplicate, pagination, and title filters.
- `GetFinding`: read-only finding detail query by numeric finding ID.
- `ImportScan`: write operation that imports a scan report and may create a new Test/Finding set in DefectDojo.
- `ReimportScan`: write operation that reimports a scan report into an existing Test or matching context and may update finding status or deduplication results.

## Risk Boundary

- Read-only methods do not mutate DefectDojo data.
- `ImportScan` and `ReimportScan` can create or update products, engagements, tests, findings, notes, and import history depending on DefectDojo request flags and parser behavior.
- `auto_create_context=true` allows DefectDojo to create product hierarchy objects when the authenticated user has permission.
- `close_old_findings=true` may close findings that are no longer present in an imported report.
- `do_not_reactivate=true` on reimport prevents previously closed findings from being reactivated.
- The service never reads local file paths; callers must pass report content in `file_content`.
- TLS certificate verification is not skipped by this service. Use HTTP for local test deployments or a trusted TLS certificate for HTTPS DefectDojo endpoints.

## Write Semantics

- `ImportScan` is not idempotent by default. Repeating the same import can create additional tests or findings depending on DefectDojo deduplication settings.
- `ReimportScan` is intended for repeat scan uploads and uses DefectDojo's reimport behavior to match the target test or context.
- Rollback is handled in DefectDojo, for example by deleting the created test/imported findings or restoring finding states from DefectDojo history.
- Recommended audit fields to retain outside OctoBus: DefectDojo user, product, engagement, test ID, finding IDs, scan type, test title, import timestamp, and upstream response `raw_json`.

For local write verification, use dedicated test product, engagement, and test names. After verification, remove the created test data from the DefectDojo UI or API before reusing the instance for other checks.

## Suggested Capset

Use separate capsets for read and write operations:

- Read-only: `ListProducts`, `ListEngagements`, `ListFindings`, `GetFinding`.
- Import/write: `ImportScan`, `ReimportScan`.

For production automation, grant the import/write capset only to workflows that are expected to synchronize scanner results into DefectDojo.

## Local Verification

DefectDojo provides a Docker Compose deployment that can be used for local integration testing.

Start DefectDojo:

```bash
git clone https://github.com/DefectDojo/django-DefectDojo.git
cd django-DefectDojo
DD_PORT=18088 DD_TLS_PORT=18443 docker-compose up -d --no-build
```

Get the generated admin password:

```bash
docker-compose logs initializer | grep "Admin password:"
```

Generate an API token from the DefectDojo UI:

```text
http://localhost:18088/api/key-v2
```

Run the service CLI from the OctoBus `services` directory:

```bash
node bin/defectdojo.js list-products \
  --data-json '{"limit":10}' \
  --config-json '{"defectdojo_base_url":"http://localhost:18088"}' \
  --secret-json '{"defectdojo_api_key":"<api-key>"}'

node bin/defectdojo.js list-engagements \
  --data-json '{"product":1,"limit":10}' \
  --config-json '{"defectdojo_base_url":"http://localhost:18088"}' \
  --secret-json '{"defectdojo_api_key":"<api-key>"}'

node bin/defectdojo.js list-findings \
  --data-json '{"product":1,"severity":"High","active":true,"verified":true,"limit":10}' \
  --config-json '{"defectdojo_base_url":"http://localhost:18088"}' \
  --secret-json '{"defectdojo_api_key":"<api-key>"}'

node bin/defectdojo.js get-finding \
  --data-json '{"id":1}' \
  --config-json '{"defectdojo_base_url":"http://localhost:18088"}' \
  --secret-json '{"defectdojo_api_key":"<api-key>"}'
```

The list examples assume the target DefectDojo instance already contains a product, engagement, and finding. The methods also work against empty instances and return DefectDojo's paginated response shape with an empty `results` list.

For scan imports, pass report content in `file_content`. This example uses DefectDojo's Generic Findings Import parser:

```bash
node bin/defectdojo.js import-scan \
  --data-json '{
    "scan_type":"Generic Findings Import",
    "minimum_severity":"Info",
    "active":true,
    "verified":true,
    "product_type_name":"OctoBus Import Type",
    "product_name":"OctoBus Import Product",
    "engagement_name":"OctoBus Import Engagement",
    "test_title":"OctoBus Import Generic Findings",
    "auto_create_context":true,
    "close_old_findings":false,
    "file_name":"generic-findings.json",
    "file_content":"{\"name\":\"Example Report\",\"type\":\"Generic Findings Import\",\"findings\":[{\"title\":\"Example Finding\",\"description\":\"Imported by OctoBus\",\"severity\":\"High\",\"active\":true,\"verified\":true}]}",
    "file_content_type":"application/json"
  }' \
  --config-json '{"defectdojo_base_url":"http://localhost:18088"}' \
  --secret-json '{"defectdojo_api_key":"<api-key>"}'
```

Run OctoBus package checks from the OctoBus `services` directory:

```bash
npm run validate -- --service-dir defectdojo__defectdojo
npm test -- --service-dir defectdojo__defectdojo
npm run pack:check
```

The service can also be imported into a local OctoBus daemon with source path `./services/defectdojo__defectdojo`, then attached to a capset and called through Connect RPC, for example `POST /capsets/defectdojo-read/connect/defectdojo-test/DefectDojo.DefectDojo/ListProducts`.

## Known Limitations

- Verification currently covers DefectDojo `3.0.100` and API v2-compatible request and response shapes.
- Import and reimport behavior depends on DefectDojo parser support, user permissions, deduplication settings, and product hierarchy flags.
- `file_content` is treated as request text and sent directly as the multipart file body. Binary report uploads are not specially encoded.
- The service intentionally does not read local file paths from requests.
- `skipTlsVerify`, `tlsInsecureSkipVerify`, and `insecureSkipVerify` are rejected with `INVALID_ARGUMENT` because Node.js native `fetch` does not support those TLS-skip options.
- Errors return HTTP status and body length only; they do not return the API key, Authorization header, or complete upstream raw body.
