# OctoBus Connect Evidence

Recorded from an actual local OctoBus connect run on 2026-06-27. Secrets, signatures, and request IDs are redacted.

## Setup

```text
octobus serve
octobus service import tencent-csip services/tencent__csip
octobus instance create tencent-csip-live --service tencent-csip --config-json '{"region":"ap-guangzhou","timeoutMs":10000}' --secret-json '<redacted>'
octobus capset create cap --name cap
octobus capset add-instance cap tencent-csip-live
```

## DescribeCSIPRiskStatistics

### Request

```http
POST http://127.0.0.1:19123/capsets/cap/connect/tencent-csip-live/Tencent_CSIP.Tencent_CSIP/DescribeCSIPRiskStatistics
Content-Type: application/json

{}
```

### Response

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
{
  "response": {
    "structValue": {
      "fields": {
        "Data": {
          "structValue": {
            "fields": {
              "CFGHighLevel": { "numberValue": 0 },
              "CFGTotal": { "numberValue": 0 },
              "HostBaseLineRiskHighLevel": { "numberValue": 0 },
              "HostBaseLineRiskTotal": { "numberValue": 0 },
              "LastScanTime": { "stringValue": "" },
              "PodBaseLineRiskHighLevel": { "numberValue": 0 },
              "PodBaseLineRiskTotal": { "numberValue": 0 },
              "PortHighLevel": { "numberValue": 0 },
              "PortTotal": { "numberValue": 0 },
              "ServerHighLevel": { "numberValue": 0 },
              "ServerTotal": { "numberValue": 0 },
              "VULHighLevel": { "numberValue": 0 },
              "VULTotal": { "numberValue": 0 },
              "WeakPasswordHighLevel": { "numberValue": 0 },
              "WeakPasswordTotal": { "numberValue": 0 },
              "WebsiteHighLevel": { "numberValue": 0 },
              "WebsiteTotal": { "numberValue": 0 }
            }
          }
        },
        "RequestId": { "stringValue": "<redacted-request-id>" }
      }
    }
  }
}
```
