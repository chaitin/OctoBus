# QianXin SkyEye V3.0.14.0

OctoBus service package for QianXin SkyEye (天眼) V3.0.14.0 alarm and log queries.

## Import

```bash
octobus service import --id qianxin-skyeye-v3-0-14-0 ./services/qianxin__skyeye_v3.0.14.0
```

## Package Layout

```
services/qianxin__skyeye_v3.0.14.0/
  package.json              # NPM manifest
  service.json              # OctoBus service manifest
  config.schema.json        # Config bindings schema
  secret.schema.json        # Secret bindings schema
  proto/qianxin_skyeye_v3_0_14_0.proto  # gRPC service definition
  src/qianxin-skyeye-v3.0.14.0.js        # Core handler logic
  src/service.js            # Service assembly
  bin/qianxin-skyeye-v3.0.14.0.js        # CLI entry point
  test/                     # Unit tests + mock upstream
  README.md
```

## Authentication

Two modes supported:

### Recommended: `login_key` dynamic auth

Uses `login_key` to dynamically authenticate via the 2-step SkyEye auth flow:

1. POST `/skyeye/v1/admin/auth` → `access_token`
2. GET `/skyeye/v1/admin/auth?token=...` → session cookies + csrf_token from HTML

Auth is performed for each call to match the verified Python script behavior. API requests carry cookies + csrf_token.

| Binding | Key | Aliases | Description |
|---------|-----|---------|-------------|
| secret | `skyeye_login_key` | `login_key` | SkyEye login key (derived to client_id/client_secret via SHA256) |
| config | `skyeye_domain` | `domain`, `baseUrl` | SkyEye API base URL (e.g. `https://10.0.0.1:443`) |
| config | `skyeye_user_name` | `user_name` | SkyEye platform username for auth |
| config | `client_id_random` | | Built-in random string for client_id derivation (default: empty) |
| config | `client_secret_random` | | Built-in random string for client_secret derivation (default: empty) |

### Legacy: static `csrf_token`

If `login_key` is not configured, falls back to a pre-obtained `csrf_token`. No session cookies are sent.

| Binding | Key | Aliases | Description |
|---------|-----|---------|-------------|
| secret | `skyeye_csrf_token` | `csrf_token` | Pre-obtained CSRF token |
| config | `skyeye_staff_name` | `staff_name` | Staff name for alarm list queries |

## Other Config Bindings

| Key | Aliases | Description |
|-----|---------|-------------|
| `skyeye_domain` | `domain`, `baseUrl` | SkyEye API base URL |
| `skyeye_staff_name` | `staff_name` | Staff name for alarm list queries |
| `timeoutMs` | | HTTP timeout in ms (default 10000) |
| `skipTlsVerify` | `tlsInsecureSkipVerify`, `insecureSkipVerify` | Skip TLS verification |

## RPC Methods

| Full Method | HTTP Path |
|-------------|-----------|
| `QianXin_SkyEye_V3_0_14_0.QianXin_SkyEye_V3_0_14_0/QueryAlarmList` | GET `/skyeye/v1/alarm/alarm/list` |
| `QianXin_SkyEye_V3_0_14_0.QianXin_SkyEye_V3_0_14_0/QueryAlarmPacket` | GET `/skyeye/v1/alarm/alarm/info/packet` |
| `QianXin_SkyEye_V3_0_14_0.QianXin_SkyEye_V3_0_14_0/DownloadAlarmPcap` | GET `/skyeye/v1/alarm/alarm/info/pcap/download` |
| `QianXin_SkyEye_V3_0_14_0.QianXin_SkyEye_V3_0_14_0/QueryNetworkLog` | GET `/skyeye/v1/analysis/log-search/list` |

## Behavior

Each handler:
1. Resolves auth: if `login_key` configured, performs 2-step auth flow; otherwise uses static `csrf_token`
2. Builds query params: request fields + `csrf_token` + auto-generated `r` (random number)
3. If auth flow was used, includes session cookies in Cookie header
4. Makes HTTP GET to the SkyEye API
5. Maps the upstream response `{ status, message, data }` to gRPC `{ response_code, verbose_msg, data }`

On upstream HTTP errors (4xx/5xx), returns a gRPC error with the status code and body.
