# OctoBus Connect Evidence

Recorded from an actual local OctoBus connect run on 2026-06-27. Secrets, signatures, and request IDs are redacted.

## Setup

```text
octobus serve
octobus service import volcengine-ddos services/volcengine__ddos
octobus instance create volcengine-ddos-live --service volcengine-ddos --config-json '{"region":"cn-beijing","timeoutMs":10000}' --secret-json '<redacted>'
octobus capset create cap --name cap
octobus capset add-instance cap volcengine-ddos-live
```

## GetBasicAlarm

### Request

```http
POST http://127.0.0.1:19123/capsets/cap/connect/volcengine-ddos-live/Volcengine_DDoS.Volcengine_DDoS/GetBasicAlarm
Content-Type: application/json

{"payload":{"page":1,"pageSize":1}}
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
        "PageInfo": {
          "structValue": {
            "fields": {
              "Count": { "numberValue": 0 },
              "CurrentPage": { "numberValue": 1 },
              "PageSize": { "numberValue": 5 },
              "TotalCount": { "numberValue": 0 }
            }
          }
        },
        "ResponseMetadata": {
          "structValue": {
            "fields": {
              "Action": { "stringValue": "GetAlarm" },
              "Region": { "stringValue": "cn-beijing" },
              "RequestID": { "stringValue": "<redacted-request-id>" },
              "Service": { "stringValue": "ddos" },
              "Version": { "stringValue": "2020-12-08" }
            }
          }
        },
        "Result": {
          "listValue": {
            "values": []
          }
        }
      }
    }
  }
}
```
