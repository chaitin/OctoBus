# OctoBus Connect Evidence

Recorded from an actual local OctoBus connect run on 2026-06-27. Secrets and signatures are redacted.

## Setup

```text
octobus serve
octobus service import ctyun-cloud-firewall-c100 services/ctyun__cloud-firewall-c100
octobus instance create ctyun-cloud-firewall-c100-live --service ctyun-cloud-firewall-c100 --config-json '{"timeoutMs":10000,"regionId":"200000004263","urlType":"CTAPI"}' --secret-json '<redacted>'
octobus capset create cap --name cap
octobus capset add-instance cap ctyun-cloud-firewall-c100-live
```

## QueryFirewallSimpleInfo

### Request

```http
POST http://127.0.0.1:19122/capsets/cap/connect/ctyun-cloud-firewall-c100-live/CTYun_CloudFirewallC100.CTYun_CloudFirewallC100/QueryFirewallSimpleInfo
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
        "error": { "stringValue": "CFW_0000" },
        "message": { "stringValue": "成功！" },
        "returnObj": {
          "structValue": {
            "fields": {
              "endRow": { "numberValue": 0 },
              "hasNextPage": { "boolValue": false },
              "hasPreviousPage": { "boolValue": false },
              "isFirstPage": { "boolValue": true },
              "isLastPage": { "boolValue": true },
              "list": {
                "listValue": {
                  "values": []
                }
              },
              "navigateFirstPage": { "numberValue": 0 },
              "navigateLastPage": { "numberValue": 0 },
              "navigatePages": { "numberValue": 8 },
              "navigatepageNums": {
                "listValue": {
                  "values": []
                }
              },
              "nextPage": { "numberValue": 0 },
              "pageNum": { "numberValue": 1 },
              "pageSize": { "numberValue": 10 },
              "pages": { "numberValue": 0 },
              "prePage": { "numberValue": 0 },
              "size": { "numberValue": 0 },
              "startRow": { "numberValue": 0 },
              "total": { "numberValue": 0 }
            }
          }
        },
        "statusCode": { "stringValue": "800" }
      }
    }
  }
}
```
