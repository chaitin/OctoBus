# nist__nvd-v2

NIST National Vulnerability Database API 2.0 wrapper — CVE 详情查询与关键词/严重程度搜索。

## 支持版本

| 组件 | 版本 | 说明 |
|---|---|---|
| NVD API | 2.0 | `services.nvd.nist.gov/rest/json/cves/2.0` |
| SDK | `@chaitin-ai/octobus-sdk` ^0.5.0 | 运行时框架 |
| Node.js | ≥ 20 | 运行环境 |

## 配置示例

### config（非敏感）

```json
{
  "nvdBaseUrl": "https://services.nvd.nist.gov/rest/json/cves/2.0",
  "timeoutMs": 30000
}
```

### secret（敏感 — NVD API Key）

```json
{
  "nvdApiKey": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

NVD API Key 免费申请：https://nvd.nist.gov/developers/request-an-api-key
无 key：5 请求/30s；有 key：50 请求/30s。

## 方法说明

### LookupCve

查询单个 CVE 的完整记录。

| 字段 | 类型 | 说明 |
|---|---|---|
| **请求** `cveId` | string | CVE 编号，如 `CVE-2021-44228` |
| **响应** `cveId` | string | CVE 编号 |
| `description` | string | 英文描述 |
| `cvssV31Score` | double | CVSS v3.1 基础分 |
| `cvssV31Vector` | string | CVSS v3.1 向量字符串 |
| `cvssV30Score` | double | CVSS v3.0 基础分 |
| `cvssV2Score` | double | CVSS v2.0 基础分 |
| `severity` | string | CRITICAL/HIGH/MEDIUM/LOW |
| `publishedDate` | string | 发布日期 (ISO 8601) |
| `lastModifiedDate` | string | 最后修改日期 |
| `cweIds` | []string | CWE 编号列表 |
| `references` | []Reference | 参考链接列表 |
| `affectedProducts` | []AffectedProduct | 受影响产品（CPE 解析） |

**错误码**：
- `INVALID_ARGUMENT` — cveId 为空或未找到
- `PERMISSION_DENIED` — NVD API Key 无效（HTTP 401/403）
- `UNAVAILABLE` — NVD 服务不可用或被限流（HTTP 429/5xx）

**请求示例**：

```http
POST /capsets/dev/connect/nist-nvd-v2-test/nist.nvd.v2.NvdService/LookupCve
Content-Type: application/json

{"cveId": "CVE-2026-49160"}
```

**响应示例**（CVE-2026-49160 — Windows HTTP/2 DoS）：

```json
{
  "cveId": "CVE-2026-49160",
  "description": "Uncontrolled resource consumption in HTTP/2 allows an unauthorized attacker to deny service over a network.",
  "cvssV31Score": 7.5,
  "cvssV31Vector": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H",
  "severity": "HIGH",
  "publishedDate": "2026-06-09T17:17:46.963",
  "lastModifiedDate": "2026-06-17T10:55:33.230",
  "cweIds": ["CWE-400"],
  "references": [
    {
      "url": "https://msrc.microsoft.com/update-guide/vulnerability/CVE-2026-49160",
      "source": "secure@microsoft.com",
      "tags": ["Vendor Advisory"]
    }
  ],
  "affectedProducts": [
    {
      "vendor": "microsoft",
      "product": "windows_10_1607",
      "version": "10.0.14393.9234"
    }
  ]
}
```

**CVE 不存在时的响应**：

```json
{
  "code": "invalid_argument",
  "message": "CVE CVE-9999-99999 not found in NVD"
}
```

### SearchCves

按关键词或严重程度搜索 NVD。

| 字段 | 类型 | 说明 |
|---|---|---|
| **请求** `keyword` | string | 搜索关键词（可选） |
| `severity` | string | 严重程度筛选：CRITICAL/HIGH/MEDIUM/LOW（可选） |
| `skip` | int32 | 分页偏移 |
| `limit` | int32 | 每页条数（最大 50） |
| `pubStartDate` | string | 发布日期起始（ISO 8601） |
| `pubEndDate` | string | 发布日期截止 |
| **响应** `total` | int32 | 总结果数 |
| `data` | []CveRecord | CVE 记录列表 |

**请求示例**：

```http
POST /capsets/dev/connect/nist-nvd-v2-test/nist.nvd.v2.NvdService/SearchCves
Content-Type: application/json

{"keyword": "http/2 denial of service", "severity": "HIGH", "limit": 2}
```

**响应示例**：

```json
{
  "total": 2,
  "data": [
    {
      "cveId": "CVE-2026-49160",
      "description": "Uncontrolled resource consumption in HTTP/2 allows an unauthorized attacker to deny service over a network.",
      "cvssV31Score": 7.5,
      "severity": "HIGH",
      "publishedDate": "2026-06-09T17:17:46.963",
      "lastModifiedDate": "2026-06-17T10:55:33.230",
      "cweIds": ["CWE-400"],
      "references": [
        {"url": "https://msrc.microsoft.com/update-guide/vulnerability/CVE-2026-49160", "source": "secure@microsoft.com", "tags": ["Vendor Advisory"]}
      ],
      "affectedProducts": [
        {"vendor": "microsoft", "product": "windows_10_1607", "version": "10.0.14393.9234"}
      ]
    }
  ]
}
```

## 风险说明

- NVD 无认证时速率极低（5/30s），建议配置 `nvdApiKey`
- NVD 偶尔 503（Cloudflare 前端），内置无 sleep 重试（最多 2 次）
- 单次响应可能很大（Log4Shell 约 40KB），已配置 10MB maxBuffer

## 建议 capset

```bash
octobus service import nist-nvd-v2 ./services/nist__nvd-v2
octobus instance create nist-nvd-v2-test --service nist-nvd-v2 \
  --config-json '{"timeoutMs":30000}' \
  --secret-json '{"nvdApiKey":"your-key"}'

octobus capset create cve-intel
octobus capset add-instance cve-intel nist-nvd-v2-test
```

## 操作说明

### 默认参数

| 参数 | 默认值 |
|---|---|
| `nvdBaseUrl` | `https://services.nvd.nist.gov/rest/json/cves/2.0` |
| `timeoutMs` | 30000 |

### 幂等语义

- `LookupCve` / `SearchCves` 均为**只读查询**，天然幂等
- 多次请求相同参数返回相同结果（NVD 数据可能随时间更新）

### 回滚方式

无写入操作，无需回滚。

### 审计字段

OctoBus daemon 自动记录每次调用的 `ts`、`method`、`capset`、`instance`、`http_status`、`grpc_code`、`duration_ms`。可通过 `octobus logs --instance <id>` 查看。

## 文件结构

```
nist__nvd-v2/
├── service.json
├── config.schema.json
├── secret.schema.json
├── package.json
├── proto/nvd.proto
├── src/service.js
├── src/nist-nvd-v2.js
├── bin/nist-nvd-v2.js
├── test/mock_upstream.js
├── test/nist-nvd-v2.test.js
└── README.md
```
