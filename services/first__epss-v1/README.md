# first__epss-v1

FIRST Exploit Prediction Scoring System API wrapper — CVE 利用概率评分与百分位排名。

- Service name: `first-epss-v1`
- Service dir: `first__epss-v1`
- Runtime mode: `on-demand`

## 支持版本

| 组件 | 版本 | 说明 |
|---|---|---|
| EPSS API | v1 | `api.first.org/data/v1/epss` |
| SDK | `@chaitin-ai/octobus-sdk` ^0.6.0 | 运行时框架 |
| Node.js | ≥ 20 | 运行环境 |

## 配置示例

### config（非敏感）

```json
{
  "epssBaseUrl": "https://api.first.org/data/v1/epss",
  "timeoutMs": 30000
}
```

EPSS 无需 API Key，完全免费公开访问。速率限制 1000 请求/分钟。

### secret

EPSS does not require credentials. The service declares a strict empty secret schema:

```json
{}
```

## 方法说明

### GetScores

批量查询 CVE 的 EPSS 利用概率。

RPC read/write 属性：`GetScores` 是只读 unary RPC，对应 `GET /data/v1/epss?cve=...&limit=...`，不会修改上游 FIRST 数据。

| 字段 | 类型 | 说明 |
|---|---|---|
| **请求** `cveIds` | []string | CVE 编号列表（最多约 30 个/请求） |
| **响应** `data` | []EpssScoreEntry | 评分条目列表 |
| `data[].cveId` | string | CVE 编号 |
| `data[].epss` | double | EPSS 概率值（0-1），EPSS ≥ 0.1 视为高风险 |
| `data[].percentile` | double | 百分位排名（0-1），越高越危险 |
| `data[].date` | string | 评分日期 |

**错误码**：
- `INVALID_ARGUMENT` — cveIds 为空或包含非字符串元素
- `DEADLINE_EXCEEDED` — 请求超过 `timeoutMs`
- `UNAVAILABLE` — EPSS 服务不可用（HTTP 5xx、网络错误、非 JSON 响应或 body 读取失败）

**请求示例**：

```http
POST /capsets/dev/connect/first-epss-v1-test/first.epss.v1.EpssService/GetScores
Content-Type: application/json

{"cveIds": ["CVE-2021-44228", "CVE-2022-22965", "CVE-2026-49160"]}
```

**响应示例**：

```json
{
  "data": [
    {
      "cveId": "CVE-2022-22965",
      "epss": 0.99677,
      "percentile": 0.99948,
      "date": "2026-06-23"
    },
    {
      "cveId": "CVE-2021-44228",
      "epss": 0.99999,
      "percentile": 1,
      "date": "2026-06-23"
    },
    {
      "cveId": "CVE-2026-49160",
      "epss": 0.48438,
      "percentile": 0.98712,
      "date": "2026-06-23"
    }
  ]
}
```

**空请求的响应**：

```json
{"data": []}
```

## 风险说明

- EPSS 数据约每日更新，新 CVE（< 24h）可能无评分
- 批量请求建议控制在 30 个 CVE 以内
- EPSS 概率是统计预测，真实利用情况参考 CISA KEV（`cisa__kev` 服务）
- 该服务没有 secret，也不支持 `skipTlsVerify`；请使用可信系统 CA 访问 HTTPS FIRST API
- 错误不会包含 secret 或完整 raw response body；EPSS 无认证凭据

## 建议 capset

```bash
octobus service import first-epss-v1 ./services/first__epss-v1
octobus instance create first-epss-v1-test --service first-epss-v1 \
  --config-json '{"timeoutMs":15000}'

octobus capset create cve-intel
octobus capset add-instance cve-intel first-epss-v1-test
```

## 操作说明

## Local Checks

```bash
cd services
npm run validate -- --service-dir first__epss-v1
npm test -- --service-dir first__epss-v1
```

### 默认参数

| 参数 | 默认值 |
|---|---|
| `epssBaseUrl` | `https://api.first.org/data/v1/epss` |
| `timeoutMs` | 30000 |

### 幂等语义

- `GetScores` 为**只读查询**，天然幂等
- 多次请求相同参数返回相同结果（EPSS 数据每日更新）

### 回滚方式

无写入操作，无需回滚。

### 审计字段

所有调用记录在 OctoBus access log 中（`octobus logs --instance <id>`）。

## 文件结构

```
first__epss-v1/
├── service.json
├── config.schema.json
├── secret.schema.json
├── package.json
├── proto/epss.proto
├── src/service.js
├── src/first-epss-v1.js
├── bin/first-epss-v1.js
├── test/mock_upstream.js
├── test/first-epss-v1.test.js
└── README.md
```
