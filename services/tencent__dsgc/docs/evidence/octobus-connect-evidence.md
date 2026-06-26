# OctoBus Connect Evidence

Recorded from an actual local OctoBus connect run on 2026-06-27. Secrets, signatures, account IDs, instance IDs, and request IDs are redacted.

## Setup

```text
octobus serve
octobus service import tencent-dsgc services/tencent__dsgc
octobus instance create tencent-dsgc-live --service tencent-dsgc --config-json '{"region":"ap-guangzhou","timeoutMs":10000}' --secret-json '<redacted>'
octobus capset create cap --name cap
octobus capset add-instance cap tencent-dsgc-live
```

## ListDSPAClusters

### Request

```http
POST http://127.0.0.1:19123/capsets/cap/connect/tencent-dsgc-live/Tencent_DSGC.TencentDsgcService/ListDSPAClusters
Content-Type: application/json

{"limit":1}
```

### Response

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
{
  "action": "ListDSPAClusters",
  "requestId": "<redacted-request-id>",
  "totalCount": "1",
  "items": [
    {
      "AppId": "<redacted-app-id>",
      "Channel": "dsgc",
      "CosBindCount": 0,
      "CosQuotaUnit": "GB",
      "CosTotalQuota": 1,
      "DBAuthCount": 0,
      "DbTotalQuota": 2,
      "DspaDescription": "free edition",
      "DspaId": "<redacted-dspa-id>",
      "DspaName": "<redacted-dspa-name>",
      "InsAuthCount": 0,
      "InsTotalQuota": 2,
      "InstanceVersion": "free",
      "Status": "enabled"
    }
  ],
  "response": {
    "DenyAll": false,
    "InstanceList": [
      {
        "AppId": "<redacted-app-id>",
        "Channel": "dsgc",
        "CosBindCount": 0,
        "CosQuotaUnit": "GB",
        "CosTotalQuota": 1,
        "DBAuthCount": 0,
        "DbTotalQuota": 2,
        "DspaDescription": "free edition",
        "DspaId": "<redacted-dspa-id>",
        "DspaName": "<redacted-dspa-name>",
        "InsAuthCount": 0,
        "InsTotalQuota": 2,
        "InstanceVersion": "free",
        "Status": "enabled"
      }
    ],
    "RequestId": "<redacted-request-id>",
    "TotalCount": 1
  }
}
```
