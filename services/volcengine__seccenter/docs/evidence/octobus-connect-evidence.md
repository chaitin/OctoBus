# OctoBus Connect Evidence

Recorded from an actual local OctoBus connect run on 2026-06-27. Secrets, signatures, tenant IDs, and request IDs are redacted.

## Setup

```text
octobus serve
octobus service import volcengine-seccenter services/volcengine__seccenter
octobus instance create volcengine-seccenter-live --service volcengine-seccenter --config-json '{"region":"cn-beijing","timeoutMs":10000}' --secret-json '<redacted>'
octobus capset create cap --name cap
octobus capset add-instance cap volcengine-seccenter-live
```

## ListAssetGroups

This request reached the Volcengine Cloud Security Center business API through OctoBus. The tested account is blocked by product tenant authorization.

### Request

```http
POST http://127.0.0.1:19123/capsets/cap/connect/volcengine-seccenter-live/Volcengine_Seccenter.Volcengine_Seccenter/ListAssetGroups
Content-Type: application/json

{"payload":{"PageNumber":1,"PageSize":1}}
```

### Response

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json
```

```json
{
  "code": "permission_denied",
  "message": "PERMISSION_DENIED: OperationDenied.TenantUnauthorized%!(EXTRA string=(<redacted-tenant-id>)): The request has failed due to tenant not found(<redacted-tenant-id>)"
}
```
