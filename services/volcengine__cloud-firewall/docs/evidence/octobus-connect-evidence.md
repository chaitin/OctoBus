# OctoBus Connect Evidence

Recorded from an actual local OctoBus connect run on 2026-06-27. Secrets, signatures, and request IDs are redacted.

## Setup

```text
octobus serve
octobus service import volcengine-cloud-firewall services/volcengine__cloud-firewall
octobus instance create volcengine-cloud-firewall-live --service volcengine-cloud-firewall --config-json '{"region":"cn-beijing","timeoutMs":10000}' --secret-json '<redacted>'
octobus capset create cap --name cap
octobus capset add-instance cap volcengine-cloud-firewall-live
```

## AssetList

This request reached the Volcengine Cloud Firewall business API through OctoBus. The tested account has not enabled Cloud Firewall.

### Request

```http
POST http://127.0.0.1:19123/capsets/cap/connect/volcengine-cloud-firewall-live/Volcengine_Cloud_Firewall.Volcengine_Cloud_Firewall/AssetList
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
  "message": "PERMISSION_DENIED: Service.NotOpened: 云防火墙服务未开通。"
}
```
