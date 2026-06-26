# Huayulab NGAF OctoBus Service

Read-only OctoBus adapter for Huayulab NGAF security operations APIs.

The service wraps the vendor API behind a stable OctoBus contract. It handles
login signing, token and session-cookie reuse, bounded query parameters, fixed
endpoint allowlists, timeout handling, and response normalization. It does not
expose destructive device actions or a raw upstream proxy.

## Status

| Item | Value |
| --- | --- |
| Service ID | `huayulab-ngaf` |
| Directory | `services/huayulab__ngaf` |
| Runtime | `long-running` |
| API document | Huayulab NGAF API document, 2026-05-27 |
| Operation class | Read-only |
| Implemented RPCs | 9 |
| Unit tests | Local mock upstream |
| Real-device validation | Login and representative read-only calls were validated during integration testing |

Use this service as the safe first production integration point for a Huayulab /
NGAF device. It is designed for inventory, health checks, security log review,
resource metrics, report dictionaries, and read-only policy-object visibility.

## Capability

```proto
service HUAYULAB_NGAF {
  rpc GetUserInfo(GetUserInfoRequest) returns (GetUserInfoResponse) {}
  rpc QuerySecurityLog(SecurityLogRequest) returns (NgafJsonResponse) {}
  rpc QueryBehaviorLog(BehaviorLogRequest) returns (NgafJsonResponse) {}
  rpc QueryAuditLog(AuditLogRequest) returns (NgafJsonResponse) {}
  rpc QuerySecurityStatistic(SecurityStatisticRequest)
      returns (NgafJsonResponse) {}
  rpc QueryFlowAnalysis(FlowAnalysisRequest) returns (NgafJsonResponse) {}
  rpc QueryResourceMetric(ResourceMetricRequest) returns (NgafJsonResponse) {}
  rpc QueryReferenceData(ReferenceDataRequest) returns (NgafJsonResponse) {}
  rpc ListPolicyObjects(PolicyObjectListRequest) returns (NgafJsonResponse) {}
}
```

| RPC | Purpose |
| --- | --- |
| `GetUserInfo` | Login if needed and read the current API user identity. |
| `QuerySecurityLog` | Read IPS, DDoS, antivirus, WAF, threat intelligence, weak-password, outbound, regional-access, and industrial-control logs. |
| `QueryBehaviorLog` | Read web, email, IM, login, outbound-file, session, alarm, and proxy-bypass behavior logs. |
| `QueryAuditLog` | Read HTTP, SSL, FTP, DNS, LDAP, RDP, SSH, database, authentication, command, event, and compliance audit logs. |
| `QuerySecurityStatistic` | Read IPS, antivirus, DDoS, and proxy-bypass security statistics. |
| `QueryFlowAnalysis` | Read traffic and behavior analytics by user, group, service, site, terminal, location, online dimension, and hot dimension. |
| `QueryResourceMetric` | Read CPU, memory, session, online IP/user, and physical-interface metrics. |
| `QueryReferenceData` | Read report selector dictionaries and reference data. |
| `ListPolicyObjects` | Read user blacklist, IP whitelist, and terminal anti-VPN list endpoints documented as `getList`. |

All read methods map a typed request to an internal allowlisted path. Callers
cannot provide an arbitrary path or URL.

## Runtime Flow

The upstream login signature follows the vendor document:

```text
sign = md5(md5(apiSecret) + "-api-!*195")
```

At runtime:

1. OctoBus receives a capset call.
2. The service normalizes `endpoint` to `/api.php`.
3. If no valid cached session exists, it logs in through
   `POST /api.php/Login/uInterlogin`.
4. It stores the returned token and `ci_session` cookie in memory only.
5. It calls a fixed read-only upstream endpoint with `Authorization`,
   `Cookie`, and `Lan` headers.
6. If the device reports an authentication failure, it clears the session,
   logs in again once, and retries the same read-only request once.

## Configuration

`config.schema.json` contains non-secret settings:

```json
{
  "endpoint": "https://DEVICE_HOST:PORT/api.php",
  "lan": "zh_CN",
  "timeoutMs": 5000,
  "skipTlsVerify": false,
  "allowInsecureHttp": false
}
```

| Field | Required | Default | Notes |
| --- | --- | --- | --- |
| `endpoint` | Yes | none | Huayulab NGAF API base URL. Console URLs ending in `/index.php` are normalized to `/api.php`. |
| `lan` | No | `zh_CN` | One of `zh_CN`, `zh_TW`, `en_US`. |
| `timeoutMs` | No | `5000` | Bounded by schema: 500 to 30000 ms. |
| `skipTlsVerify` | No | `false` | Use only for lab devices with self-signed certificates. |
| `allowInsecureHttp` | No | `false` | Keep disabled outside isolated tests. |

`secret.schema.json` contains credentials:

```json
{
  "username": "API_USERNAME",
  "apiSecret": "API_SECRET"
}
```

Do not commit real endpoints, usernames, API secrets, capset tokens, or device
session cookies.

## Local Validation

Run from the repository root:

```bash
node --check services/huayulab__ngaf/src/huayulab-ngaf.js
node --check services/huayulab__ngaf/src/service.js
node --check services/huayulab__ngaf/bin/huayulab-ngaf.js
node --test services/huayulab__ngaf/test/huayulab-ngaf.test.js
```

The unit tests cover:

- documented login signature generation;
- endpoint normalization and HTTPS-by-default enforcement;
- successful login, token and cookie forwarding;
- one-time token refresh after authentication failure;
- required config and secret validation;
- fixed endpoint allowlists for log, metric, and policy-object reads;
- bounded pagination and safe filter shape validation;
- upstream timeout handling.

## OctoBus Import

```bash
octobus service import huayulab-ngaf services/huayulab__ngaf
```

Create a real-device instance:

```bash
octobus instance create huayulab-ngaf-readonly \
  --service huayulab-ngaf \
  --config-json '{"endpoint":"https://DEVICE_HOST:PORT/api.php","lan":"zh_CN","timeoutMs":5000,"skipTlsVerify":true,"allowInsecureHttp":false}' \
  --secret-json '{"username":"API_USERNAME","apiSecret":"API_SECRET"}'
```

Add it to a capset:

```bash
octobus capset add-instance local huayulab-ngaf-readonly
```

Refresh the capset membership after re-importing a service if newly added
methods do not appear:

```bash
octobus capset remove-instance local huayulab-ngaf-readonly
octobus capset add-instance local huayulab-ngaf-readonly
```

Generate a test token and call through OctoBus:

```bash
TOKEN="$(openssl rand -hex 32)"
printf '%s' "$TOKEN" | octobus capset add-token local "huayulab-test-$(date +%s)" --token-stdin

curl -sS -X POST \
  'http://127.0.0.1:9000/capsets/local/connect/huayulab-ngaf-readonly/HUAYULAB_NGAF.HUAYULAB_NGAF/GetUserInfo' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  --data '{}'
```

Representative read-only metric call:

```bash
curl -sS -X POST \
  'http://127.0.0.1:9000/capsets/local/connect/huayulab-ngaf-readonly/HUAYULAB_NGAF.HUAYULAB_NGAF/QueryResourceMetric' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  --data '{"type":"RESOURCE_METRIC_CPU","query":{"page":1,"pageSize":10}}'
```

## Safety Model

This package intentionally keeps a narrow security boundary:

- read-only RPCs only;
- fixed endpoint allowlists only;
- no caller-controlled upstream URL;
- no raw proxy method;
- no write APIs such as add, delete, update, clear, reboot, shutdown, upgrade,
  block, unblock, blacklist mutation, network configuration, or VPN
  configuration;
- HTTPS is required by default;
- plaintext HTTP must be explicitly enabled for isolated tests;
- TLS verification skipping is explicit and intended only for lab appliances;
- upstream timeout is bounded;
- `pageSize` is capped at 200;
- `filters_json` must be a flat JSON object with scalar or bounded scalar-array
  values;
- token and cookie are cached in process memory only and are not logged.

## Troubleshooting

| Symptom | Likely cause | Check |
| --- | --- | --- |
| `method is not exposed by capset` | Capset membership was created before the service was re-imported. | Remove and add the instance to the capset again. |
| `upstream request failed: fetch failed` | Endpoint, port, routing, TLS, or trusted-host settings are wrong. | Confirm the API URL directly with `curl -k` from the OctoBus host. |
| `管理员登录失败` | Username or API secret does not match the device API account, or the wrong port was used. | Recreate the API account and verify the signed login with form-urlencoded data. |
| Empty result with `code:0` | The device has no data for the selected time range or module. | Try a wider time range or a different documented read-only type. |
| Timeout | Device API is slow or unreachable. | Increase `timeoutMs` within schema limits after checking network reachability. |

## Packaging

Before handing off or opening a pull request:

```bash
node --test services/huayulab__ngaf/test/huayulab-ngaf.test.js
rg -n 'REAL_DEVICE_IP|REAL_API_USERNAME|REAL_API_SECRET|[A-Fa-f0-9]{64}' services/huayulab__ngaf || true
tar --exclude='node_modules' -czf huayulab-ngaf.tar.gz -C services huayulab__ngaf
sha256sum huayulab-ngaf.tar.gz
```

The archive should contain only the service package files: manifest, schemas,
proto, runtime source, bin entrypoint, tests, mock upstream, and documentation.
