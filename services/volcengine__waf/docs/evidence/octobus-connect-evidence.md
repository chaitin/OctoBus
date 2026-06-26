# OctoBus Connect Evidence

Recorded from an actual local OctoBus connect run on 2026-06-27. Secrets, signatures, and request IDs are redacted.

## Setup

```text
octobus serve
octobus service import volcengine-waf services/volcengine__waf
octobus instance create volcengine-waf-live --service volcengine-waf --config-json '{"region":"cn-beijing","timeoutMs":10000}' --secret-json '<redacted>'
octobus capset create cap --name cap
octobus capset add-instance cap volcengine-waf-live
```

## ListDomain

### Request

```http
POST http://127.0.0.1:19123/capsets/cap/connect/volcengine-waf-live/Volcengine_WAF.Volcengine_WAF/ListDomain
Content-Type: application/json

{"payload":{"Page":1,"PageSize":1}}
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
        "ResponseMetadata": {
          "structValue": {
            "fields": {
              "Action": { "stringValue": "ListDomain" },
              "Region": { "stringValue": "cn-beijing" },
              "RequestId": { "stringValue": "<redacted-request-id>" },
              "Service": { "stringValue": "waf" },
              "Version": { "stringValue": "2023-12-25" }
            }
          }
        },
        "Result": {
          "structValue": {
            "fields": {
              "CurrentPage": { "numberValue": 1 },
              "Data": { "nullValue": "NULL_VALUE" },
              "PageSize": { "numberValue": 1 }
            }
          }
        }
      }
    }
  }
}
```
