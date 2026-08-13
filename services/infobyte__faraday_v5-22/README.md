# Faraday v5.22 OctoBus Service

This package adapts Faraday v5.22.0 workspace, host, and vulnerability APIs for OctoBus.

## Configuration

`config`:

- `faraday_base_url`: Faraday base URL, for example `http://127.0.0.1:5985`.
- `headers`: optional extra HTTP headers.
- `timeoutMs`: optional HTTP timeout in milliseconds, default `5000`.

`secret`:

- `faraday_username`: Faraday username.
- `faraday_password`: Faraday password.

Authentication uses Faraday Basic authentication. The service intentionally rejects `skipTlsVerify`, `tlsInsecureSkipVerify`, and `insecureSkipVerify`; use a trusted TLS certificate for HTTPS endpoints.

## Methods

- `InfobyteFaradayV522.Faraday/ListWorkspaces`: `GET /_api/v3/ws`
- `InfobyteFaradayV522.Faraday/CreateWorkspace`: `POST /_api/v3/ws`
- `InfobyteFaradayV522.Faraday/ListHosts`: `GET /_api/v3/ws/{workspace_name}/hosts`
- `InfobyteFaradayV522.Faraday/CreateHost`: `POST /_api/v3/ws/{workspace_name}/hosts`
- `InfobyteFaradayV522.Faraday/ListVulnerabilities`: `GET /_api/v3/ws/{workspace_name}/vulns`
- `InfobyteFaradayV522.Faraday/GetVulnerability`: `GET /_api/v3/ws/{workspace_name}/vulns/{object_id}`
- `InfobyteFaradayV522.Faraday/CreateVulnerability`: `POST /_api/v3/ws/{workspace_name}/vulns`

## Risk and Authorization Notes

Recommended capset split:

- Read-only operations: `ListWorkspaces`, `ListHosts`, `ListVulnerabilities`, `GetVulnerability`.
- Write operations: `CreateWorkspace`, `CreateHost`, `CreateVulnerability`.

Write operations create data in Faraday and should be granted only to automation that is allowed to synchronize security assessment assets and vulnerabilities. Use a dedicated Faraday account with the minimum workspace permissions required by the workflow.

Write behavior:

- `CreateWorkspace` creates a workspace. If the same name already exists, Faraday returns an upstream error; callers should treat workspace names as unique.
- `CreateHost` creates a host in the target workspace. Use test-only IPs and hostnames when validating.
- `CreateVulnerability` creates a vulnerability under a host or other Faraday parent object. Use a test parent object and an `external_id` that identifies the source workflow.
- The service does not implement delete or update operations, so rollback should be performed in Faraday UI/API by deleting the test workspace or created objects.
- Audit fields can be carried through `external_id`, `tool`, `metadata`, `description`, and Faraday response metadata such as `owner`, `create_time`, and `update_time`.

Known limits:

- TLS verification cannot be disabled through service config.
- Responses include Faraday raw response bodies to preserve evidence and troubleshooting details; do not pass production secrets or sensitive business data in free-form fields.

## Example

```bash
node services/bin/infobyte-faraday-v5-22.js list-workspaces \
  --config '{"faraday_base_url":"http://127.0.0.1:5985"}' \
  --secret '{"faraday_username":"faraday","faraday_password":"***"}'
```

Responses include the upstream HTTP status, raw response body, parsed raw JSON, and list results where applicable so PR validation can cite the real Faraday request and response without inventing evidence.

## Validation

```bash
cd services
npm run validate -- --service-dir infobyte__faraday_v5-22
npm test -- --service-dir infobyte__faraday_v5-22
npm run pack:check
```

For integration validation, import the service into OctoBus, create an instance with `faraday_base_url`, `faraday_username`, and `faraday_password`, add that instance to a capset, and call at least one read method and one write method against a test Faraday workspace.
