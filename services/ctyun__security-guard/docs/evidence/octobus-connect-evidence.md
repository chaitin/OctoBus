# OctoBus Connect Evidence

Recorded from an actual local OctoBus connect run on 2026-06-27. Secrets, signatures, and trace IDs are redacted.

## Setup

```text
octobus serve
octobus service import ctyun-security-guard services/ctyun__security-guard
octobus instance create ctyun-security-guard-live --service ctyun-security-guard --config-json '{"timeoutMs":10000}' --secret-json '<redacted>'
octobus capset create cap --name cap
octobus capset add-instance cap ctyun-security-guard-live
```

## AssetClassify

### Request

```http
POST http://127.0.0.1:19122/capsets/cap/connect/ctyun-security-guard-live/CTYun_SecurityGuard.CTYun_SecurityGuard/AssetClassify
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
        "error": { "stringValue": "CTCSSCN_000000" },
        "message": { "stringValue": "成功!" },
        "returnObj": {
          "structValue": {
            "fields": {
              "databaseCount": { "numberValue": 0 },
              "environmentCount": { "numberValue": 0 },
              "hostCount": { "numberValue": 0 },
              "kernelmoduleCount": { "numberValue": 0 },
              "middlewareCount": { "numberValue": 0 },
              "portCount": { "numberValue": 0 },
              "processCount": { "numberValue": 0 },
              "programCount": { "numberValue": 0 },
              "scheduleCount": { "numberValue": 0 },
              "selfStartCount": { "numberValue": 0 },
              "userInfoCount": { "numberValue": 0 },
              "webFrameworkCount": { "numberValue": 0 },
              "webServerCount": { "numberValue": 0 },
              "webappCount": { "numberValue": 0 },
              "websiteCount": { "numberValue": 0 }
            }
          }
        },
        "statusCode": { "stringValue": "200" },
        "traceId": { "stringValue": "<redacted-trace-id>" }
      }
    }
  }
}
```
