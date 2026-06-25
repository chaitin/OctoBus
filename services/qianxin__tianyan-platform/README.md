# QIANXIN TianYan Platform

OctoBus service package for **QIANXIN TianYan** (奇安信网神威胁监测与分析系统 - 天眼分析平台) V4.0.12.0. Wraps the platform's alarm query REST API as a gRPC method.

- **Vendor**: QIANXIN (奇安信)
- **Product**: 天眼分析平台 V4.0.12.0
- **Proto package**: `QIANXIN_TianYan_Platform`
- **API base path**: `/alarm/`

## Authentication

Fully automatic — no manual token management required.

Set `secret.login_key` (the platform's passwordless login key, found under 系统管理 → 帐号管理 → 本地帐号管理 → 免密LOGIN密钥). On each call the package:

1. Derives `client_id` and `client_secret` from `login_key` via SHA-256.
2. POSTs to `/skyeye/v1/admin/auth` to obtain an `access_token`.
3. GETs `/skyeye/v1/admin/auth?token=...` to acquire a session cookie and CSRF token from the HTML response.
4. Calls the alarm API with the CSRF token and session cookie.

The default login username is `tapadmin`; override via `secret.username`.

## Config

| Field | Required | Description |
|-------|----------|-------------|
| `restBaseUrl` | Yes | TianYan base URL, e.g. `https://tianyan.example.com:443` |
| `timeoutMs` | No | HTTP timeout in ms (default 15000) |
| `tlsInsecureSkipVerify` | No | Skip TLS verification for self-signed certs |

## Methods

| Method | Endpoint | Description |
|--------|----------|-------------|
| `ListAlarms` | `GET /alarm/alarm/list` | Query threat alarms with optional filters for hazard level, time range, attacker/victim IP, IOC, threat type, and disposition status. |

## Test

```bash
cd services
npm run validate -- --service-dir qianxin__tianyan-platform
npm test -- --service-dir qianxin__tianyan-platform
npm run pack:check
```
