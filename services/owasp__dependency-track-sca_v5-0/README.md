# OWASP Dependency-Track SCA v5.0

OctoBus service package for OWASP Dependency-Track SCA and SBOM workflows.

## Product

- Product: OWASP Dependency-Track
- Type: SCA / SBOM / software supply chain risk platform
- Tested API family: Dependency-Track REST API v1
- Public references:
  - https://docs.dependencytrack.org/integrations/rest-api/
  - https://docs.dependencytrack.org/getting-started/deploy-docker/
  - https://github.com/DependencyTrack/dependency-track

Dependency-Track exposes the OpenAPI document from the backend API server:

- `GET http://{backend-host}:{backend-port}/api/openapi.json`
- `GET http://{backend-host}:{backend-port}/api/openapi.yaml`

In the local validation environment for this PR, the backend API server was exposed on `http://127.0.0.1:8080` and the frontend UI on `http://127.0.0.1:8081`.

## Configuration

`config.schema.json`

| Field | Required | Description |
| --- | --- | --- |
| `dependency_track_base_url` | Yes | Dependency-Track backend API server base URL, for example `http://localhost:8080`. |
| `apiPrefix` | No | REST API prefix. Defaults to `/api/v1`. |
| `timeoutMs` | No | HTTP timeout in milliseconds. Defaults to `5000`. |
| `headers` | No | Optional JSON object or JSON string with extra HTTP headers. |

Aliases for `dependency_track_base_url`: `baseUrl`, `restBaseUrl`.

TLS verification skip options such as `skipTlsVerify`, `tlsInsecureSkipVerify`, and `insecureSkipVerify` are intentionally rejected by this service. Use a trusted certificate for HTTPS endpoints.

## Secrets

`secret.schema.json`

| Field | Required | Description |
| --- | --- | --- |
| `dependency_track_api_key` | Yes | Dependency-Track API key. Sent as `X-Api-Key`. |

Aliases for `dependency_track_api_key`: `apiKey`, `xApiKey`.

## Methods

| Method | Upstream API |
| --- | --- |
| `ListProjects` | `GET /api/v1/project`, `GET /api/v1/project/tag/{tag}`, `GET /api/v1/project/classifier/{classifier}` |
| `CreateProject` | `PUT /api/v1/project` |
| `GetProjectMetrics` | `GET /api/v1/metrics/project/{uuid}/current` |
| `UploadBom` | `PUT /api/v1/bom` |
| `ListFindings` | `GET /api/v1/finding/project/{uuid}` |

## Risk and Capset Guidance

Recommended capset scope:

- Read-only workflows: allow `ListProjects`, `GetProjectMetrics`, and `ListFindings`.
- SBOM import workflows: additionally allow `UploadBom` only for approved projects or test projects.
- Project provisioning workflows: additionally allow `CreateProject` for a dedicated Dependency-Track team or API key with limited portfolio permissions.

Write operation behavior:

- `CreateProject` uses Dependency-Track `PUT /api/v1/project`. It creates a project when the `name` and `version` pair does not exist. Dependency-Track returns a conflict for duplicate `name` and `version`; callers should treat that as a business precondition failure rather than a retryable network error.
- `UploadBom` uses Dependency-Track `PUT /api/v1/bom`. `auto_create` defaults to `true` only when `project_uuid` is not provided and both `project_name` and `project_version` are provided. When `project_uuid` is provided, `auto_create` defaults to `false`.
- This service does not implement destructive cleanup APIs. Roll back test writes in Dependency-Track by deleting the test project or uploading the previous BOM through Dependency-Track's own UI/API.
- Useful audit fields are Dependency-Track project `uuid`, project `name`, project `version`, BOM upload `token`, OctoBus `instance_id`, and OctoBus `request_id`. Do not log API keys or raw production SBOMs in shared PR evidence.

## Local CLI Examples

List projects:

```bash
owasp-dependency-track-sca-v5-0 call OWASP_DependencyTrack_SCA_V5.OWASP_DependencyTrack_SCA_V5/ListProjects \
  --config '{"dependency_track_base_url":"http://localhost:8080"}' \
  --secret '{"dependency_track_api_key":"******"}' \
  --input '{"limit":10,"exclude_inactive":true}'
```

Create a project:

```bash
owasp-dependency-track-sca-v5-0 call OWASP_DependencyTrack_SCA_V5.OWASP_DependencyTrack_SCA_V5/CreateProject \
  --config '{"dependency_track_base_url":"http://localhost:8080"}' \
  --secret '{"dependency_track_api_key":"******"}' \
  --input '{"name":"octobus-demo","version":"1.0.0","classifier":"APPLICATION","tags":["octobus","sca"],"active":true}'
```

Upload a CycloneDX BOM:

```bash
owasp-dependency-track-sca-v5-0 call OWASP_DependencyTrack_SCA_V5.OWASP_DependencyTrack_SCA_V5/UploadBom \
  --config '{"dependency_track_base_url":"http://localhost:8080"}' \
  --secret '{"dependency_track_api_key":"******"}' \
  --input '{"project_uuid":"00000000-0000-0000-0000-000000000000","auto_create":false,"bom":"BASE64_CYCLONEDX_JSON"}'
```

Get project metrics:

```bash
owasp-dependency-track-sca-v5-0 call OWASP_DependencyTrack_SCA_V5.OWASP_DependencyTrack_SCA_V5/GetProjectMetrics \
  --config '{"dependency_track_base_url":"http://localhost:8080"}' \
  --secret '{"dependency_track_api_key":"******"}' \
  --input '{"project_uuid":"00000000-0000-0000-0000-000000000000"}'
```

List project findings:

```bash
owasp-dependency-track-sca-v5-0 call OWASP_DependencyTrack_SCA_V5.OWASP_DependencyTrack_SCA_V5/ListFindings \
  --config '{"dependency_track_base_url":"http://localhost:8080"}' \
  --secret '{"dependency_track_api_key":"******"}' \
  --input '{"project_uuid":"00000000-0000-0000-0000-000000000000","suppressed":false,"source":"NVD"}'
```

## PR Validation Notes

Before submitting the PR, run the service against a real Dependency-Track instance and include complete redacted request and response evidence in the PR description. Keep the request path, HTTP status, request body, and response body visible; only redact secrets, tokens, and private asset identifiers.
