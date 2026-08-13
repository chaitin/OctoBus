# QIANXIN TianYan Platform

OctoBus service package for **QIANXIN TianYan** (奇安信网神威胁监测与分析系统 - 天眼分析平台) V4.0.12.0.

- **Vendor**: QIANXIN (奇安信)
- **Product**: 天眼分析平台 V4.0.12.0
- **Proto package**: `QIANXIN_TianYan_Platform`

## Authentication

Fully automatic — no manual token management required.

Set `secret.login_key` (the platform's passwordless login key, found under 系统管理 → 帐号管理 → 本地帐号管理 → 免密LOGIN密钥). On each call the package:

1. Derives `client_id` and `client_secret` from `login_key` via SHA-256.
2. POSTs to `/skyeye/v1/admin/auth` to obtain an `access_token`.
3. GETs `/skyeye/v1/admin/auth?token=...` to acquire a session cookie and CSRF token from the HTML response.
4. Calls the target API with the CSRF token and session cookie.

The default login username is `tapadmin`; override via `secret.username`.

## Config

| Field | Required | Description |
|-------|----------|-------------|
| `restBaseUrl` | Yes | TianYan base URL, e.g. `https://tianyan.example.com:443` |
| `timeoutMs` | No | HTTP timeout in ms (default 15000) |
| `tlsInsecureSkipVerify` | No | Skip TLS verification for self-signed certs |

## Methods

| Method | HTTP | Endpoint | Description |
|--------|------|----------|-------------|
| `ListAlarms` | GET | `/skyeye/v1/alarm/alarm/list` | Query threat alarms with optional filters for hazard level, time range, attacker/victim IP (gzip+base64 encoded), IOC, threat type, and disposition status. |
| `UpdateAlarmStatus` | PUT | `/alarm/alarm/list` | Update alarm disposition: 0=未处置, 1=已处置, 6=忽略, 7=误报. |
| `SearchLogs` | GET | `/analysis/log-search/list` | Search raw security logs by keyword, time range, log index, and category. |
| `SPLSearch` | GET | `/analysis/log-search/spl-search` | Expert SPL query with structured field extraction. |
| `ListAssets` | GET | `/asset/asset/manage/info` | Query asset inventory with optional IP, name, group, port, and type filters. |
| `ListVulnerabilities` | GET | `/asset/vul/leaks/list` | List asset vulnerabilities with optional IP, name, and severity filters. |
| `ThreatHuntSearch` | GET | `/analysis/hunt/search` | Build a threat relationship graph for an IOC keyword (IP, domain, URL, MD5, or email). |
| `AddFlowWhitelist` | POST | `/system/rule_cfg/white_list_flow` | Add an IP, IOC, or threat type to the flow sensor whitelist to suppress future alerts. |
| `GetCompromisedHostStatus` | GET | `/analysis/hunting/stuck_host/status` | Check whether a host is compromised and return its alarm count, risk score, and IOC count. |

## Test

```bash
cd services
npm run validate -- --service-dir qianxin__tianyan-platform
npm test -- --service-dir qianxin__tianyan-platform
npm run pack:check
```
