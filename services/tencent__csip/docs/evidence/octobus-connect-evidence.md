# OctoBus Connect Evidence

Recorded from actual local OctoBus connect runs on 2026-06-27 and 2026-07-01. Secrets, signatures, and request IDs are redacted.

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

## Expanded OctoBus Interface Coverage

The following calls were re-run through the local OctoBus connect endpoint on 2026-07-01 00:12 CST. The request entrypoint for every row was:

```text
POST http://127.0.0.1:19149/capsets/cap/connect/tencent-csip-live/Tencent_CSIP.Tencent_CSIP/<method>
```

These calls cover the dedicated RPC handlers and the generic `InvokeReadOnlyAction` handler. They are not direct Tencent Cloud API curls.

| Method | HTTP status | Response keys observed |
|---|---:|---|
| `DescribeCSIPRiskStatistics` | `200` | `Data`, `RequestId`, `CFGHighLevel`, `CFGTotal`, `HostBaseLineRiskHighLevel`, `HostBaseLineRiskTotal`, `LastScanTime`, `PodBaseLineRiskHighLevel` |
| `DescribeCVMAssets` | `200` | `AppIdList`, `AssetMapInstanceTypeList`, `AssetTypeList`, `Data`, `DefenseStatusList`, `IpTypeList`, `OsList`, `ProtectStatusList` |
| `DescribePublicIpAssets` | `200` | `AppIdList`, `AssetLocationList`, `AssetTypeList`, `Data`, `DefenseStatusList`, `IpTypeList`, `RegionList`, `RequestId` |
| `DescribeVpcAssets` | `200` | `AppIdList`, `Data`, `RegionList`, `RequestId`, `TotalCount`, `VpcList` |
| `DescribeRiskCenterServerRiskList` | `200` | `Data`, `InstanceTypeLists`, `RequestId`, `TotalCount` |
| `DescribeRiskCenterVULViewVULRiskList` | `200` | `Data`, `FromLists`, `LevelLists`, `RequestId`, `TotalCount`, `VULTypeLists`, `Text`, `Value` |
| `DescribeAccessKeyRisk` | `200` | `Data`, `RequestId`, `Total` |
| `InvokeReadOnlyAction` with `DescribeCSIPRiskStatistics` | `200` | `Data`, `RequestId`, `CFGHighLevel`, `CFGTotal`, `HostBaseLineRiskHighLevel`, `HostBaseLineRiskTotal`, `LastScanTime`, `PodBaseLineRiskHighLevel` |

### Representative Commands

```bash
curl -sS -H 'Content-Type: application/json' \
  -X POST \
  'http://127.0.0.1:19149/capsets/cap/connect/tencent-csip-live/Tencent_CSIP.Tencent_CSIP/DescribeCVMAssets' \
  --data '{}'

curl -sS -H 'Content-Type: application/json' \
  -X POST \
  'http://127.0.0.1:19149/capsets/cap/connect/tencent-csip-live/Tencent_CSIP.Tencent_CSIP/DescribeRiskCenterVULViewVULRiskList' \
  --data '{}'

curl -sS -H 'Content-Type: application/json' \
  -X POST \
  'http://127.0.0.1:19149/capsets/cap/connect/tencent-csip-live/Tencent_CSIP.Tencent_CSIP/InvokeReadOnlyAction' \
  --data '{"action":"DescribeCSIPRiskStatistics","payload":{}}'
```

### Representative Responses

`DescribeCVMAssets` returned the expected asset inventory shape:

```json
{
  "response": {
    "structValue": {
      "fields": {
        "AssetMapInstanceTypeList": {
          "listValue": {
            "values": [
              {
                "structValue": {
                  "fields": {
                    "Text": { "stringValue": "主机" },
                    "Value": { "stringValue": "Instance" }
                  }
                }
              }
            ]
          }
        },
        "Data": { "listValue": { "values": [] } },
        "RequestId": { "stringValue": "<redacted-request-id>" },
        "Total": { "numberValue": 0 }
      }
    }
  }
}
```

`DescribeRiskCenterVULViewVULRiskList` returned the expected vulnerability risk list metadata:

```json
{
  "response": {
    "structValue": {
      "fields": {
        "Data": { "listValue": { "values": [] } },
        "FromLists": {
          "listValue": {
            "values": [
              {
                "structValue": {
                  "fields": {
                    "Text": { "stringValue": "云安全中心" },
                    "Value": { "stringValue": "0" }
                  }
                }
              }
            ]
          }
        },
        "RequestId": { "stringValue": "<redacted-request-id>" },
        "TotalCount": { "numberValue": 0 }
      }
    }
  }
}
```

`InvokeReadOnlyAction` also reached Tencent CSIP through OctoBus and returned the same `DescribeCSIPRiskStatistics` shape:

```json
{
  "response": {
    "structValue": {
      "fields": {
        "Data": {
          "structValue": {
            "fields": {
              "CFGTotal": { "numberValue": 0 },
              "ServerTotal": { "numberValue": 0 },
              "VULTotal": { "numberValue": 0 },
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
