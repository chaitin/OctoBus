# JumpServer Bastionhost V4.10.16 OctoBus Service

This package adapts JumpServer bastionhost REST APIs for OctoBus.

Validated target:

- Product: JumpServer
- Version: v4.10.16
- API documentation: `/api/swagger.json` on the deployed JumpServer instance
- Deployment used for validation: `jumpserver/jms_all:v4.10.16`

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/jumpserver_bastionhost_v4_10_16.proto`: gRPC API definition.
- `config.schema.json`: endpoint, API prefix, timeout, TLS, and extra header settings.
- `secret.schema.json`: Bearer token, full Authorization header, or username/password.
- `src/jumpserver-bastionhost-v4-10-16.js`: request validation, upstream mapping, response mapping, and error mapping.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/jumpserver-bastionhost-v4-10-16.js`: service-local executable entrypoint.
- `test/jumpserver-bastionhost-v4-10-16.test.js`: node:test coverage.
- `test/mock_upstream.js`: local JumpServer-like mock.

## Configuration

```json
{
  "endpoint": "http://jumpserver.example.local",
  "apiPrefix": "/api/v1",
  "timeoutMs": 10000,
  "rejectUnauthorized": false
}
```

Use an existing token:

```json
{
  "token": "replace-with-jumpserver-token"
}
```

Or let the service login before each call:

```json
{
  "username": "admin",
  "password": "replace-with-password"
}
```

## RPC Methods

- `JumpServer_Bastionhost_V41016.JumpServer_Bastionhost_V41016/ListAssets`
  - Upstream: `GET /api/v1/assets/assets/`
  - Risk: read-only
- `JumpServer_Bastionhost_V41016.JumpServer_Bastionhost_V41016/GetAsset`
  - Upstream: `GET /api/v1/assets/assets/{id}/`
  - Risk: read-only
- `JumpServer_Bastionhost_V41016.JumpServer_Bastionhost_V41016/ListUsers`
  - Upstream: `GET /api/v1/users/users/`
  - Risk: read-only
- `JumpServer_Bastionhost_V41016.JumpServer_Bastionhost_V41016/ListOnlineSessions`
  - Upstream: `GET /api/v1/terminal/sessions/?is_finished=false`
  - Risk: read-only

## Risk Boundary

- Risk level: `read-only`
- This version does not create, update, delete, disable, unblock, or terminate JumpServer resources.
- It only reads asset, user, and online session information.
- Future writable methods, such as user removal or session deletion, should document default parameters, idempotency, rollback path, and JumpServer audit fields before enablement.

## Suggested Capset

- `bastionhost-readonly`: `ListAssets`, `GetAsset`, `ListUsers`, `ListOnlineSessions`
- `access-audit-readonly`: `ListUsers`, `ListOnlineSessions`

## Error Mapping

- Bad input -> `INVALID_ARGUMENT`
- Login failure or HTTP 401 -> `UNAUTHENTICATED`
- HTTP 403 -> `PERMISSION_DENIED`
- Other HTTP 4xx -> `FAILED_PRECONDITION`
- Network errors and HTTP 5xx -> `UNAVAILABLE`

## Local Checks

```bash
cd services
npm run validate -- --service-dir jumpserver__bastionhost_v4-10-16
npm test -- --service-dir jumpserver__bastionhost_v4-10-16
npm run pack:check
```

## Real Validation Evidence

Sanitize token, password, cookies, and sensitive addresses before PR submission.

### ListUsers

# Request

```http
GET /api/v1/users/users/?limit=5 HTTP/1.1
Host: jumpserver.example.local
Authorization: Bearer ******
Accept: application/json
```

# Response

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
[
  {
    "id": "f2358d92-6564-49a7-8cc4-d98b3f0c7623",
    "name": "Administrator",
    "username": "admin",
    "email": "admin@example.com",
    "is_active": true
  }
]
```

### ListAssets

# Request

```http
GET /api/v1/assets/assets/?limit=5 HTTP/1.1
Host: jumpserver.example.local
Authorization: Bearer ******
Accept: application/json
```

# Response

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
[]
```

## Known Limitations

- First version only covers read-only asset, user, and online session query capabilities.
- JumpServer deployments can expose list responses either as arrays or paginated objects; both are supported.
- API token expiry follows JumpServer server-side policy.
