# API7 Enterprise 3.10.2

OctoBus service package for API7 Enterprise Admin APIs with a phase-1 focus on security operations, API gateway governance, and read-oriented operational visibility.

Service name: `api7-enterprise-v3-10-2`.

Runtime: long-running Node.js service using `@chaitin-ai/octobus-sdk`.

## Import

Service root: `services/api7__enterprise_v3-10-2`.

```bash
octobus service import --id api7-enterprise-v3-10-2 ./services/api7__enterprise_v3-10-2
```

## Instance

```bash
octobus instance create api7-enterprise \
  --service api7-enterprise-v3-10-2 \
  --config-json '{"api7_base_url":"https://api7.example.com","gateway_group_id":"gw-1","timeoutMs":5000}' \
  --secret-json '{"api7_api_key":"<redacted>"}'
```

Basic auth is also supported:

```bash
octobus instance update-secret api7-enterprise \
  --secret-json '{"username":"admin@example.com","password":"<redacted>"}'
```

## Bindings

Configuration:

- `api7_base_url`: API7 Enterprise base URL.
- `baseUrl`, `restBaseUrl`: aliases for `api7_base_url`.
- `gateway_group_id`: optional default gateway group ID for APISIX admin list APIs.
- `timeoutMs`: optional timeout in milliseconds. Defaults to `5000`.
- `headers`: optional JSON object or JSON string with extra HTTP headers.
- `skipTlsVerify`, `tlsInsecureSkipVerify`, `insecureSkipVerify`: optional booleans for test environments with self-signed or untrusted TLS certificates.

Secrets:

- `api7_api_key`: API7 API key sent as `X-API-KEY`.
- `apiKey`, `xApiKey`: aliases for `api7_api_key`.
- `username` + `password`: fallback Basic Auth credentials when API key is not provided.

## Phase-1 Methods

### Security operations and governance

- `ListAuditLogs`
- `ExportAuditLogs`
- `ListAlertPolicies`
- `ListAlertHistories`
- `ListUsers`
- `ListRoles`
- `ListTokens`
- `ListApprovals`

### Consumer and credential visibility

- `ListConsumers`
- `ListConsumerCredentials`

### TLS and certificate visibility

- `ListCertificates`
- `ListCACertificates`
- `ListSNIs`
- `GetCertificateUsage`
- `ParseCertificate`
- `ValidateCertificateKey`

### Gateway configuration visibility

- `ListGatewayGroups`
- `ListGatewayInstances`
- `ListRoutes`
- `ListServices`
- `ListGlobalRules`
- `ListPlugins`
- `GetPluginSchema`
- `ListSecretProviders`
- `GetSecretProviderUsage`

### Debug and health visibility

- `ListDebugSessions`
- `ListDebugTraces`
- `GetServiceHealthcheck`

## Added write methods

- `CreateToken`
- `CreateConsumer`
- `CreateConsumerCredential`
- `CreateCertificate`
- `CreateSNI`
- `CreateService`
- `CreateRoute`
- `CreateGlobalRule`

## Behavior

- The package talks directly to API7 Enterprise REST endpoints under `/api/*` and `/apisix/admin/*`.
- API key auth is preferred; Basic Auth is used only when `api7_api_key` is absent.
- When `skipTlsVerify` (or its aliases) is true, the package disables TLS certificate verification for upstream API7 HTTPS calls. Use only in test environments.
- The package now includes a small set of creation-oriented write APIs for test and controlled operations, in addition to low-risk parsing/validation helpers.
- `ListRoutes` now requires `service_id`, matching the behavior observed from the API7 3.10.2 test environment.
- Response mapping is intentionally generic to keep the surface stable across API7 minor revisions:
  - list endpoints try to infer `results` from `list`, `items`, `results`, `data`, or top-level arrays
  - `count` is inferred from `count`, `total`, `total_size`, `totalSize`, or the results length
  - the original upstream payload is also preserved in `raw_json`

## Risk and capset guidance

Recommended capset scope for phase 1:

- Read-only operations for security operations dashboards and agent workflows.
- Avoid exposing future write methods such as route patching, certificate creation, token rotation, or admin key updates in broad capsets.
- Use separate instances or credentials for production and test gateway groups.

## Validation

```bash
cd services
npm run validate -- --service-dir api7__enterprise_v3-10-2
npm test -- --service-dir api7__enterprise_v3-10-2
```
