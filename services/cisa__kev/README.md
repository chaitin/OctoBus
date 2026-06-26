# cisa__kev

CISA Known Exploited Vulnerabilities (KEV) 目录包装器 — 检查 CVE 是否被活跃利用、关联勒索软件、修复期限。

## 支持版本

| 组件 | 版本 | 说明 |
|---|---|---|
| CISA KEV | 2026.06 | 静态 JSON 文件，约 1600+ 条目 |
| SDK | `@chaitin-ai/octobus-sdk` ^0.5.0 | 运行时框架 |
| Node.js | ≥ 20 | 运行环境 |

## 配置示例

### config（非敏感）

```json
{
  "kevPrimaryUrl": "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
  "kevFallbackUrl": "https://raw.githubusercontent.com/cisagov/kev-data/main/data/known_exploited_vulnerabilities.json",
  "kevCacheTtlMs": 3600000,
  "timeoutMs": 30000
}
```

无需 API Key 或认证。

## 方法说明

### Check

检查 CVE 是否在 CISA KEV 目录中。

| 字段 | 类型 | 说明 |
|---|---|---|
| **请求** `cveId` | string | CVE 编号，如 `CVE-2021-44228` |
| **响应** `inKev` | optional bool | 是否在 KEV 目录中 |
| `entry.cveId` | string | CVE 编号 |
| `entry.vendorProject` | string | 厂商/项目 |
| `entry.product` | string | 产品名称 |
| `entry.vulnerabilityName` | string | 漏洞名称 |
| `entry.dateAdded` | string | 加入 KEV 日期 |
| `entry.shortDescription` | string | 简要描述 |
| `entry.requiredAction` | string | CISA 要求的修复措施 |
| `entry.dueDate` | string | CISA 要求的修复截止日期 |
| `entry.knownRansomwareCampaignUse` | string | 是否已知被勒索软件利用（Known/Unknown） |
| `entry.notes` | string | 附加说明链接 |

**错误码**：
- `INVALID_ARGUMENT` — cveId 为空或格式错误
- `UNAVAILABLE` — CISA 和 GitHub 镜像均不可达

**请求示例**（在 KEV 目录中）:

```http
POST /capsets/dev/connect/cisa-kev-test/cisa.kev.KevService/Check
Content-Type: application/json

{"cveId": "CVE-2021-44228"}
```

**响应示例**（inKev = true）:

```json
{
  "inKev": true,
  "entry": {
    "cveId": "CVE-2021-44228",
    "vendorProject": "Apache",
    "product": "Log4j2",
    "vulnerabilityName": "Apache Log4j2 Remote Code Execution Vulnerability",
    "dateAdded": "2021-12-10",
    "shortDescription": "Apache Log4j2 contains a vulnerability where JNDI features do not protect against attacker-controlled JNDI-related endpoints, allowing for remote code execution.",
    "requiredAction": "For all affected software assets for which updates exist, the only acceptable remediation actions are: 1) Apply updates; OR 2) remove affected assets from agency networks. Temporary mitigations using one of the measures provided at https://www.cisa.gov/uscert/ed-22-02-apache-log4j-recommended-mitigation-measures are only acceptable until updates are available.",
    "dueDate": "2021-12-24",
    "knownRansomwareCampaignUse": "Known",
    "notes": "https://nvd.nist.gov/vuln/detail/CVE-2021-44228"
  }
}
```

**响应示例**（inKev = false）:

```json
{"inKev": false}
```

## 风险说明

- KEV 目录约 2MB，内存缓存 1 小时（可配置 `kevCacheTtlMs`）
- CISA 主 URL 和 GitHub 镜像双源容错
- KEV 仅在美国工作日更新
- `inKev=true` 代表已确认的活跃利用，是 CVE 研判中最强信号

## 建议 capset

```bash
octobus service import cisa-kev ./services/cisa__kev
octobus instance create cisa-kev-test --service cisa-kev \
  --config-json '{"kevCacheTtlMs":3600000,"timeoutMs":30000}'

octobus capset create cve-intel
octobus capset add-instance cve-intel cisa-kev-test
```

## 操作说明

### 默认参数

| 参数 | 默认值 |
|---|---|
| `kevPrimaryUrl` | `https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json` |
| `kevFallbackUrl` | `https://raw.githubusercontent.com/cisagov/kev-data/main/data/known_exploited_vulnerabilities.json` |
| `kevCacheTtlMs` | 3600000（1 小时），设 0 禁用缓存 |
| `timeoutMs` | 30000 |

### 幂等语义

- `Check` 为**只读查询**，天然幂等
- 缓存 TTL 内相同 CVE 返回一致结果；TTL 过期后可能反映 KEV 更新

### 回滚方式

无写入操作，无需回滚。

### 审计字段

所有调用记录在 OctoBus access log 中。

## 文件结构

```
cisa__kev/
├── service.json
├── config.schema.json
├── package.json
├── proto/kev.proto
├── src/service.js
├── src/cisa-kev.js
├── bin/cisa-kev.js
├── test/mock_upstream.js
├── test/cisa-kev.test.js
└── README.md
```
