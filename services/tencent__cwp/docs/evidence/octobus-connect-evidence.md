# OctoBus Connect Evidence

Recorded from an actual local OctoBus connect run on 2026-06-27. Secrets, signatures, and request IDs are redacted.

## Setup

```text
octobus serve
octobus service import tencent-cwp services/tencent__cwp
octobus instance create tencent-cwp-live --service tencent-cwp --config-json '{"region":"ap-guangzhou","timeoutMs":10000}' --secret-json '<redacted>'
octobus capset create cap --name cap
octobus capset add-instance cap tencent-cwp-live
```

## DescribeMachineGeneral

### Request

```http
POST http://127.0.0.1:19124/capsets/cap/connect/tencent-cwp-live/Tencent_CWP.TencentCwpService/DescribeMachineGeneral
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
  "action": "DescribeMachineGeneral",
  "requestId": "<redacted-request-id>",
  "response": {
    "AliCloudMachineCnt": 0,
    "BaiduCloudMachineCnt": 0,
    "BaseMachineCnt": 0,
    "CloudFrom": [],
    "CompareYesterdayDeadlineMachineCnt": 0,
    "CompareYesterdayMachineCnt": 0,
    "CompareYesterdayNotProtectMachineCnt": 0,
    "CompareYesterdayRiskMachineCnt": 0,
    "DeadlineMachineCnt": 0,
    "FlagshipMachineCnt": 0,
    "IDCMachineCnt": 0,
    "LHGeneralDiscountCnt": 0,
    "MachineCnt": 0,
    "MachineDestroyAfterOfflineHours": 0,
    "NotProtectMachineCnt": 0,
    "OtherCloudMachineCnt": 0,
    "ProtectMachineCnt": 0,
    "RequestId": "<redacted-request-id>",
    "RiskMachineCnt": 0,
    "SpecialtyMachineCnt": 0,
    "TencentCloudMachineCnt": 0
  }
}
```
