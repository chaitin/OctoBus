# Anyi Cloud Native Security (DISS) OctoBus Service

OctoBus service package for [Anyi Technology](https://www.anyi.com.cn/) Cloud Native Security Platform (DISS).

Import it into OctoBus with:

```bash
octobus service import --id anyi-cloud-native-security ./services//anyi__cloud-native-security
```

## Supported Version

Tested against DISS API v1.0.0. The API uses apiKey authentication: the JWT token is sent directly in the `Authorization` header without a `Bearer` prefix (i.e., `Authorization: <token>`).

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/anyi_cloud_native_security.proto`: gRPC API definition.
- `config.schema.json`: non-secret endpoint, timeout, TLS, and user settings.
- `secret.schema.json`: DISS API token (sent as `Authorization: <token>`, no Bearer prefix).
- `src/anyi-cloud-native-security.js`: DISS API implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/anyi-cloud-native-security.js`: service-local executable entrypoint.
- `test/anyi-cloud-native-security.test.js`: node:test coverage for validation, request/response mapping, error handling, and SDK handler invocation.
- `test/mock_upstream.js`: local DISS API mock server.

## Configuration

Use `endpoint` for the DISS REST API base URL. `baseUrl` is accepted as a legacy alias.

```json
{
  "endpoint": "https://diss.example.com:8543",
  "timeoutMs": 15000,
  "skipTlsVerify": false,
  "defaultUser": "admin"
}
```

Use `secret.token` for the DISS API token (placed directly in the `Authorization` header, no `Bearer` prefix):

```json
{
  "token": "eyJhbGciOiJQQkVTMi1IUzI1NitBMTI4S1ciLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..."
}
```

## RPC Methods

| Method | Description |
|---|---|
| `Anyi_CloudNativeSecurity.Anyi_CloudNativeSecurity/ListWarnings` | List security warnings with pagination and filters |
| `Anyi_CloudNativeSecurity.Anyi_CloudNativeSecurity/ListWarningGroups` | List aggregated warning groups |
| `Anyi_CloudNativeSecurity.Anyi_CloudNativeSecurity/DisposeWarnings` | Dispose warnings (isolation/pause/stop/kill) |
| `Anyi_CloudNativeSecurity.Anyi_CloudNativeSecurity/DisposeWarningGroups` | Dispose aggregated warning groups |
| `Anyi_CloudNativeSecurity.Anyi_CloudNativeSecurity/ListVulnerabilities` | List image vulnerabilities |
| `Anyi_CloudNativeSecurity.Anyi_CloudNativeSecurity/ListHosts` | List host assets |
| `Anyi_CloudNativeSecurity.Anyi_CloudNativeSecurity/ListContainers` | List container assets |
| `Anyi_CloudNativeSecurity.Anyi_CloudNativeSecurity/ListClusters` | List K8s clusters |
| `Anyi_CloudNativeSecurity.Anyi_CloudNativeSecurity/ContainerControl` | Control container (resume/start/activate/deactivate) |
| `Anyi_CloudNativeSecurity.Anyi_CloudNativeSecurity/UnblockNetwork` | Unblock container network isolation |

## Behavior Notes

- All list methods support `from`/`limit` pagination parameters (default: 0/20).
- `ListHosts` uses `defaultUser` from config (default: `admin`); per-request `user` overrides it.
- Filter fields use `google.protobuf.Struct` to pass through DISS API body parameters without hardcoding the full DISS schema.
- `DisposeWarnings` and `DisposeWarningGroups` require `action` (one of: isolation, pause, stop, kill). These are write operations.
- `ContainerControl` requires `action` (one of: resume, start, activate, deactivate) and `container_id`.
- `UnblockNetwork` requires `container_id`.
- HTTP 401 maps to gRPC UNAUTHENTICATED, 403 to PERMISSION_DENIED, 4xx to FAILED_PRECONDITION, 5xx/network to UNAVAILABLE.
- When `skipTlsVerify` is true, TLS certificate verification is skipped (useful for self-signed certificates in private deployments).

## Risk Notes

- **Write operations**: `DisposeWarnings`, `DisposeWarningGroups`, `ContainerControl`, and `UnblockNetwork` modify system state.
  - `isolation` action isolates a container network; use `UnblockNetwork` to reverse.
  - `stop`/`kill` actions stop or kill containers; verify target before invocation.
  - `deactivate` deactivates a container; use `activate` or `start` to reverse.
- **Idempotency**: DISS disposal and control operations are idempotent for repeated identical requests.
- **Rollback**: Container isolation can be reversed via `UnblockNetwork`. Stopped containers may require manual restart.
- **Audit**: All write operations are logged by DISS with user context and timestamp.

## Suggested Capset

For a security monitoring agent:

```
ListWarnings, ListWarningGroups, ListVulnerabilities, ListHosts, ListContainers, ListClusters
```

For a security response agent (adds write operations):

```
ListWarnings, ListWarningGroups, DisposeWarnings, DisposeWarningGroups, ListVulnerabilities, ListHosts, ListContainers, ListClusters, ContainerControl, UnblockNetwork
```

## Local Checks

```bash
cd services
npm run validate -- --service-dir anyi__cloud-native-security
npm test -- --service-dir anyi__cloud-native-security --coverage
npm run pack:check
```
