# Tencent Cloud Bastion Host (T-Sec 堡垒机) Service Package

OctoBus service package for [Tencent Cloud T-Sec Bastion Host](https://cloud.tencent.com/product/bh) (运维安全中心/堡垒机).

## Supported Version

Tencent Cloud BH API version `2023-04-18`.

## Authentication

Uses [Tencent Cloud API TC3-HMAC-SHA256](https://cloud.tencent.com/document/api) signing with `SecretId` and `SecretKey`.

- **SecretId**: Tencent Cloud API access key ID.
- **SecretKey**: Tencent Cloud API access key secret.

Obtain credentials from [Tencent Cloud CAM](https://console.cloud.tencent.com/cam/capi).

## Package Structure

```
services/tencent__bh/
  service.json          — OctoBus service manifest
  proto/tencent_bh.proto  — gRPC API definitions
  config.schema.json    — non-secret configuration schema
  secret.schema.json    — secret credentials schema
  src/service.js        — OctoBus SDK defineService wrapper
  src/tencent-bh.js     — TC3-HMAC-SHA256 signed API implementation
  bin/tencent-bh.js     — service-local executable entry point
  test/tencent-bh.test.js — node:test coverage for TC3 signing, request/response mapping, error handling
  README.md             — this file
```

## Configuration

### Config (non-secret fields)

```json
{
  "region": "ap-guangzhou",
  "endpoint": "bh.tencentcloudapi.com",
  "timeoutMs": 10000,
  "skipTlsVerify": false
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `region` | `ap-guangzhou` | Tencent Cloud region |
| `endpoint` | `bh.tencentcloudapi.com` | API endpoint hostname |
| `timeoutMs` | `10000` | HTTP request timeout (ms) |
| `skipTlsVerify` | `false` | Skip TLS verification |

### Secret (sensitive fields)

```json
{
  "secret_id": "your-secret-id-here",
  "secret_key": "your-secret-key-here"
}
```

Both `snake_case` (`secret_id`, `secret_key`) and `camelCase` (`secretId`, `secretKey`) field names are accepted.

## Import

```bash
octobus service import --id tencent-bh ./services//tencent__bh
```

## RPC Methods

| gRPC Method | CLI Command | Description |
|-------------|-------------|-------------|
| `Tencent_BH.Tencent_BH/ListSessions` | `list-sessions` | Query Bastion Host session list |
| `Tencent_BH.Tencent_BH/KillSession` | `kill-session` | Force terminate a session |
| `Tencent_BH.Tencent_BH/ListDevices` | `list-devices` | List managed devices/assets |
| `Tencent_BH.Tencent_BH/ListUsers` | `list-users` | List managed users |
| `Tencent_BH.Tencent_BH/LockUser` | `lock-user` | Lock a user account |
| `Tencent_BH.Tencent_BH/UnlockUser` | `unlock-user` | Unlock a user account |

### Session Management

**ListSessions** — Query sessions with optional filters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `offset` | int64 | Page offset (0-based) |
| `limit` | int64 | Page size (default 20, max 200) |
| `status` | string[] | Filter by status: `ACTIVE`, `FINISHED` |
| `user_name` | string | Filter by username (fuzzy) |
| `device_name` | string | Filter by device name (fuzzy) |

**KillSession** — Force terminate a session:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | Yes | Session ID to terminate |

### Asset Management

**ListDevices** — List managed devices (assets):

| Parameter | Type | Description |
|-----------|------|-------------|
| `offset` | int64 | Page offset |
| `limit` | int64 | Page size |
| `name` | string | Filter by device name (fuzzy) |
| `ip` | string | Filter by IP address |

### User Management

**ListUsers** — List users with optional filters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `offset` | int64 | Page offset |
| `limit` | int64 | Page size |
| `name` | string | Filter by username (fuzzy) |
| `status` | string | Filter by status: `NORMAL`, `LOCKED`, `DISABLED` |

**LockUser** — Lock a user account:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `user_id` | string | Yes | User ID to lock |

**UnlockUser** — Unlock a user account:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `user_id` | string | Yes | User ID to unlock |

## Behavior Notes

- All API calls use **POST** to `bh.tencentcloudapi.com` with TC3-HMAC-SHA256 signing.
- HTTP 401 maps to `UNAUTHENTICATED`; HTTP 403 maps to `PERMISSION_DENIED`.
- Other HTTP 4xx maps to `FAILED_PRECONDITION`.
- HTTP 5xx and network errors map to `UNAVAILABLE`.
- Tencent Cloud API `AuthFailure` errors map to `UNAUTHENTICATED` or `PERMISSION_DENIED`.
- Other HTTP 4xx maps to `FAILED_PRECONDITION`.
- HTTP 5xx and network errors map to `UNAVAILABLE`.
- Tencent Cloud API `AuthFailure` errors map to `UNAUTHENTICATED` or `PERMISSION_DENIED`.
- Non-JSON responses map to `UNKNOWN`.
- Missing credentials (secret_id/secret_key) map to `FAILED_PRECONDITION`.
- Missing required request parameters (e.g., `session_id`, `user_id`) map to `INVALID_ARGUMENT`.
- All API calls log `x-engine-instance` and `x-request-id` headers for traceability.

## Write Operation Semantics

### KillSession

| Aspect | Description |
|--------|-------------|
| **Default parameters** | `session_id` 必填，无默认值 |
| **Idempotency** | 幂等。对已终止的会话再次执行 KillSession 返回成功（BH API 幂等处理） |
| **Rollback** | 不可回滚。会话终止后无法恢复，用户需重新建立连接 |
| **Audit fields** | 请求通过 `x-engine-instance` 和 `x-request-id` 追踪；Tencent Cloud BH 侧自动记录操作审计日志 |

### LockUser

| Aspect | Description |
|--------|-------------|
| **Default parameters** | `user_id` 必填，无默认值 |
| **Idempotency** | 幂等。对已锁定的用户再次执行 LockUser 为 no-op |
| **Rollback** | 通过 `UnlockUser` 操作回滚解锁 |
| **Audit fields** | 同 KillSession，通过请求头和工作台审计日志追踪 |

### UnlockUser

| Aspect | Description |
|--------|-------------|
| **Default parameters** | `user_id` 必填，无默认值 |
| **Idempotency** | 幂等。对未锁定的用户执行 UnlockUser 为 no-op |
| **Rollback** | 通过 `LockUser` 操作重新锁定 |
| **Audit fields** | 同 KillSession，通过请求头和工作台审计日志追踪 |

## Risk & Recommended Capset

**Risk**: Write operations (`KillSession`, `LockUser`, `UnlockUser`) can disrupt normal operations. Use with caution.

**Recommended `capset`**:
- Read operations (`ListSessions`, `ListDevices`, `ListUsers`): `["recon"]` capability.
- Write operations (`KillSession`, `LockUser`, `UnlockUser`): `["recon", "intrusion-response"]` capability.

## Validation

```bash
cd services
npm run validate -- --service-dir tencent__bh
npm test -- --service-dir tencent__bh --coverage
npm run pack:check
```

## Known Limitations

1. Pagination for BH APIs with large result sets may require multiple calls.
2. The API filters support fuzzy matching for user/device names; exact behavior depends on Tencent Cloud BH API implementation.
3. Some BH API fields may use different naming conventions in raw API responses vs. the proto mapping.
