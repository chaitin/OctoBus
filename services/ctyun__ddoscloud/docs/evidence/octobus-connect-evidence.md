# OctoBus Connect Evidence

Recorded from an actual local OctoBus connect run on 2026-06-27. Secrets and signatures are redacted.

## Exposed Interface Scope

This service package now exposes only the OctoBus Connect verified RPC `DomainQuery` in proto/rpcdef. Other vendor APIs are intentionally left out of proto/rpcdef until corresponding OctoBus runtime evidence is added.


## Setup

```text
octobus serve
octobus service import ctyun-ddoscloud services/ctyun__ddoscloud
octobus instance create ctyun-ddoscloud-live --service ctyun-ddoscloud --config-json '{"timeoutMs":10000}' --secret-json '<redacted>'
octobus capset create cap --name cap
octobus capset add-instance cap ctyun-ddoscloud-live
```

## DomainQuery

### Request

```http
POST http://127.0.0.1:19122/capsets/cap/connect/ctyun-ddoscloud-live/CTYun_DDoSCloud.CTYun_DDoSCloud/DomainQuery
Content-Type: application/json

{"payload":{"page":1,"page_size":1,"product_code":"011"}}
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
        "message": { "stringValue": "正确返回" },
        "returnObj": {
          "structValue": {
            "fields": {
              "page": { "numberValue": 1 },
              "page_count": { "numberValue": 0 },
              "page_size": { "numberValue": 1 },
              "result": {
                "listValue": {
                  "values": []
                }
              },
              "total": { "numberValue": 0 },
              "total_count": { "numberValue": 0 }
            }
          }
        },
        "statusCode": { "numberValue": 100000 }
      }
    }
  }
}
```
