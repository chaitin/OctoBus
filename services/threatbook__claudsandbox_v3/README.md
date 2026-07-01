# ThreatBook ClaudSandbox V3

OctoBus service package for ThreatBook ClaudSandbox V3 file upload, file reputation report, and multi-engine report APIs.

## Supported Version

- Vendor: ThreatBook
- APIs:
  - `POST /v3/file/upload`
  - `GET /v3/file/report`
  - `GET /v3/file/report/multiengines`
- Base URL: `https://api.threatbook.cn`
- Runtime: long-running Node.js service using `@chaitin-ai/octobus-sdk`

The implementation follows the public API shape documented at:

- `https://x.threatbook.com/apiDocs/file/upload`
- `https://x.threatbook.com/apiDocs/file/report`
- `https://x.threatbook.com/apiDocs/file/report_multiengines`

## Import

Service root: `services/threatbook__claudsandbox_v3`.

```bash
octobus service import --id threatbook-claudsandbox-v3 ./services/threatbook__claudsandbox_v3
```

## Instance

```bash
octobus instance create threatbook-claudsandbox \
  --service threatbook-claudsandbox-v3 \
  --config-json '{"baseUrl":"https://api.threatbook.cn","timeoutMs":1500}' \
  --secret-json '{"apiKey":"<redacted>"}'
```

Configuration:

- `threatbook_domain`: ThreatBook API base URL. Defaults to `https://api.threatbook.cn` when omitted.
- `domain`, `restBaseUrl`, `baseUrl`: aliases for `threatbook_domain`.
- `timeoutMs`: optional HTTP timeout in milliseconds, default `1500`.
- `skipTlsVerify`, `tlsInsecureSkipVerify`, `insecureSkipVerify`: optional TLS verification skip aliases for private deployments.

Secrets:

- `threatbook_apikey`: ThreatBook API key.
- `apikey`, `apiKey`: aliases for `threatbook_apikey`.

## Suggested Capset

```bash
octobus capset create threat-intel --name ThreatIntel
octobus capset add-instance threat-intel threatbook-claudsandbox
```

This service is suitable for threat-intelligence, malware triage, sample enrichment, and alert investigation capsets.

## Methods

### UploadFile

Full method:

```text
ThreatBook_ClaudSandbox_V3.ThreatBook_ClaudSandbox_V3/UploadFile
```

Request:

```json
{
  "fileBytesBase64": "dGVzdCBmaWxl",
  "fileName": "sample.bin",
  "sandboxType": "win7_sp1_enx86_office2013",
  "runTime": 60
}
```

Alternative local file request:

```json
{
  "filePath": "/tmp/sample.bin",
  "sandboxType": "win7_sp1_enx86_office2013",
  "runTime": 60
}
```

Behavior:

- Sends `POST {threatbook_domain}/v3/file/upload`.
- Sends multipart form fields `apikey`, `file`, optional `sandbox_type`, optional `run_time`.
- Success requires HTTP `200` and ThreatBook `response_code == 0`.
- Response returns `http_status`, `sha256`, and `permalink`. `raw_body` is intentionally empty and `raw_json` is not populated to avoid retaining upstream payloads that may contain sensitive data.

### GetFileReport

Full method:

```text
ThreatBook_ClaudSandbox_V3.ThreatBook_ClaudSandbox_V3/GetFileReport
```

Request:

```json
{
  "sha256": "<sample-sha256>",
  "sandboxType": "win7_sp1_enx86_office2013",
  "queryFields": ["summary", "multiengines"]
}
```

Behavior:

- Sends `GET {threatbook_domain}/v3/file/report`.
- Sends query parameters `apikey`, `resource`, `sandbox_type`, and repeated optional `query_fields`.
- `resource` and `sha256` are accepted aliases.
- Success requires HTTP `200` and ThreatBook `response_code == 0`.
- Response returns `http_status`, normalized `summary`, `permalink`, and raw `data`. `raw_body` is intentionally empty and `raw_json` is not populated to avoid retaining upstream payloads that may contain sensitive data.

### GetMultiEnginesReport

Full method:

```text
ThreatBook_ClaudSandbox_V3.ThreatBook_ClaudSandbox_V3/GetMultiEnginesReport
```

Request:

```json
{
  "sha256": "<sample-sha256>"
}
```

Behavior:

- Sends `GET {threatbook_domain}/v3/file/report/multiengines`.
- Sends query parameters `apikey` and `resource`.
- `resource` and `sha256` are accepted aliases.
- Success requires HTTP `200` and ThreatBook `response_code == 0`.
- Response returns `http_status`, normalized `multiengines`, and raw `data`. `raw_body` is intentionally empty and `raw_json` is not populated to avoid retaining upstream payloads that may contain sensitive data.

Connect RPC example:

```bash
curl -X POST \
  http://127.0.0.1:9000/capsets/threat-intel/connect/threatbook-claudsandbox/ThreatBook_ClaudSandbox_V3.ThreatBook_ClaudSandbox_V3/GetMultiEnginesReport \
  -H 'Content-Type: application/json' \
  -d '{"sha256":"<sample-sha256>"}'
```

Local business CLI example:

```bash
OCTOBUS_SERVICE_CONTEXT='{"config":{"baseUrl":"https://api.threatbook.cn"},"secret":{"apiKey":"<redacted>"}}' \
node threatbook__claudsandbox_v3/bin/threatbook-claudsandbox-v3.js get-multi-engines-report --data-json '{"sha256":"<sample-sha256>"}'
```

## Errors

- Invalid base URL, upload input, base64, `resource`, `sandbox_type`, or `run_time`: `INVALID_ARGUMENT`.
- Missing API key: `UNAUTHENTICATED`.
- HTTP `401`: `UNAUTHENTICATED`.
- HTTP `403`: `PERMISSION_DENIED`.
- Other HTTP `4xx`: `FAILED_PRECONDITION`.
- HTTP `5xx`, network errors, and response read errors: `UNAVAILABLE`.
- Invalid JSON or missing `response_code`: `UNKNOWN`.
- HTTP `200` with `response_code != 0`: `FAILED_PRECONDITION`, except known auth-like code `1101`, which maps to `UNAUTHENTICATED`.

Upstream failure messages are structured JSON containing `http_status`, empty `raw_body`, `raw_body_length`, and when available `response_code`, redacted `verbose_msg`, and `reason`.

## Write Semantics

`UploadFile` submits a file sample to ThreatBook for analysis. It is a remote write-like operation because it can create a sandbox analysis task and consume quota.

- Default parameters: `threatbook_domain=https://api.threatbook.cn`, `timeoutMs=1500`.
- Optional upload parameters: `sandbox_type` is omitted when not provided; `run_time` is omitted when not provided.
- Idempotency: repeated uploads of the same file may return the same sha256 but can still consume quota or refresh analysis state according to ThreatBook behavior.
- Rollback: no package-side rollback is available after submitting a sample. Use only test samples for validation.
- Cleanup: no local cleanup is required unless the caller created a temporary file for `filePath`; callers should remove their temporary files after invocation.
- Audit fields: record OctoBus instance id, capset id, caller identity, file hash, file name, sandbox type, run time, report permalink, and upstream response code. Do not log API keys or sensitive file contents.

`GetFileReport` and `GetMultiEnginesReport` are read-only enrichment calls.

## Risk Notes

- Uploaded files and queried hashes are transmitted to ThreatBook and may consume API quota.
- Do not upload production-sensitive files unless your organization explicitly allows that data flow.
- Use only benign test samples for device verification and PR evidence.
- Store API keys only in instance secrets.
- Mask tokens, sample names, hashes tied to sensitive incidents, and business-sensitive data in PRs, screenshots, logs, and test artifacts.

## Validation

```bash
cd services
npm run validate -- --service-dir threatbook__claudsandbox_v3
npm test -- --service-dir threatbook__claudsandbox_v3
npm run pack:check
```

## Device Verification

The package includes mock-upstream tests that cover request mapping, multipart upload, response mapping, config/secret handling, SDK invocation, and error mapping. Real ThreatBook verification requires a non-production API key with file upload and report permissions and a benign test file. Record the API version, auth method, command output, screenshot, and known limitations in the PR without exposing the key, sample contents, or production-sensitive hashes.
