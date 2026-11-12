# Ruifosang DPS

Ruifosang DPS（DPS 平台 API v1）的 OctoBus 服务包。

本包把厂商 OpenAPI 3.1.0 定义中的 **152 个 HTTP 端点**逐个映射为同名 gRPC 方法，方法名与
vendor 文档的语义一致（资产与指纹确认、富化、传感器与采集、存储配置、报文/记录/文件检索、
协议分析、报表、威胁情报、管理与健康检查）。每个方法都直接对应一个 HTTP 端点，不做额外聚合，
因此上游返回什么，方法就返回什么。

## 配置

```json
{
  "baseUrl": "https://dps.example.com",
  "headers": { "x-tenant": "acme" },
  "cookie": "dps_session=...",
  "timeoutMs": 15000,
  "skipTlsVerify": false
}
```

- `baseUrl`：DPS 平台根地址，必填；只接受 `http://` 或 `https://`。
- `headers`：附加到每个请求的 HTTP 头。
- `cookie`：会话 Cookie（可选，见下文鉴权）。
- `timeoutMs`：单次请求超时，默认 15000 毫秒，超时映射为 `DEADLINE_EXCEEDED`。
- `skipTlsVerify`：私有部署自签证书时跳过 TLS 校验。
- `followRedirects`：是否跟随上游 3xx，默认关闭（见下方"说明与限制"）。

密钥：

```json
{
  "token": "…",
  "cookie": "dps_session=..."
}
```

`token` 以 `Authorization: Bearer <token>` 发送；`cookie` 覆盖 `config.cookie`。

## 鉴权

厂商文档**没有**声明 `securitySchemes`，也没有声明 `servers`，因此本包不臆造鉴权方案：

- 若部署使用 Bearer Token：把 token 放进 secret 的 `token`。
- 若部署使用会话 Cookie：先调 `Login`（bootstrap token）或 `LoginWithPassword`，
  从返回的 `headers` 里取出 `set-cookie`，再写进 secret 或 `config.cookie`。
- API 文档声明 `/v1/auth/me` 用来回显当前主体，可用它验证凭据是否生效。

## 响应结构

所有方法统一返回 `ApiResponse`：

| 字段 | 含义 |
| --- | --- |
| `http_status` | 上游 HTTP 状态码（200、204、206、304 等） |
| `content_type` | 上游 `Content-Type` |
| `data` | JSON 端点的解码结果，原样返回 |
| `binary_body` | 字节端点的原始内容（文件、归档条目、作业产物、报表导出） |
| `headers` | 转发的响应头：`content-length`、`content-range`、`accept-ranges`、`etag`、`last-modified`、`location`、`retry-after`、`set-cookie` |

非 JSON 的文本响应放在 `data` 里（字符串）；HEAD 端点只返回状态码与响应头。

## 方法

152 个方法名与端点一一对应，`service.json` 的 `sdk.cli.commands` 给出每个方法的
CLI 命令名与说明。按类别简要列举：

- 健康检查：`GetLiveness`、`GetReadiness`、`GetHealth`
- 资产：`ListAssets`、`GetAsset`、`PatchAsset`、`RefingerprintAsset`、`ListAssetServices`、
  `GetAssetOverview`，以及设备候选、临时端点、服务组件的列表/详情/确认
- 富化：`PreviewEnrichment`、`PublishEnrichment`、`ListEnrichmentVersions`、
  `RestoreEnrichmentVersion`、`ListEnrichmentSuggestions`、`PreviewEnrichmentBatch`、`CommitEnrichmentBatch`
- 传感器与采集：`ListSensors`、`GetSensor`、`PatchSensor`、`EnrollSensor`、`ApproveSensor`、
  `DecommissionSensor`、`RecommissionSensor`、`SensorHeartbeat`，以及 `PutSensor*` 系列配置写入与 `GetSensor*` 回读
- 报文与记录：`ListPackets`、`SearchPackets`、`GetPacketDetail`、`StreamPackets`、`QueryPacketFacets`、
  `PageRecords`、`SearchRecords`、`ListNpmFields`、`GetNpmSeries`、`GetNpmTop`
- 文件与归档：`SearchFiles`、`ListFileFields`、`ListArchiveEntries`、`GetFileBytes`、
  `GetArchiveEntryBytes`、`HeadArchiveEntryBytes`，带密码的归档读取用 `*WithPassword` 变体
- 协议分析：`QueryProtocolAnalysis`、`ListProtocolAnalysisScenarios`、`ListProtocolAnalysisSensors`、`PreviewScenarioPipeline`
- 作业：`ListJobs`、`CreateJob`、`GetJob`、`DeleteJob`、`CancelJob`、`GetJobArtifact`
- 报表：`RenderReport`、`ExportReport`、`EstimateScanExport`，以及报表模板与调度 CRUD
- 威胁情报：`ListThreatIntelSources`、`CreateThreatIntelSource`、`GetThreatIntelSource`、
  `PublishThreatIntelSourceVersion`、`PreviewThreatIntelMapping`
- 管理：`ListAppRules`、`PutAppRule`、`PublishAppRules`、`ReorderAppRules`、`ListApps`、
  `PutAppEntry`、`SwitchAdminScope`、`CreateAdminUser`、`GetBranding`

## 错误映射

上游非 2xx 响应转换为 `GrpcError`，并附带 `httpStatus`，以及 RFC 9457 `Problem` 里
出现过的 `problemCode` / `traceId`：

| 状态码 | gRPC |
| --- | --- |
| 400、415、422 | `INVALID_ARGUMENT` |
| 401 | `UNAUTHENTICATED` |
| 403 | `PERMISSION_DENIED` |
| 404、410 | `NOT_FOUND` |
| 409 | `ABORTED` |
| 413、429 | `RESOURCE_EXHAUSTED` |
| 416 | `OUT_OF_RANGE` |
| 428 | `FAILED_PRECONDITION` |
| 5xx | `UNAVAILABLE` |
| 其它 | `UNKNOWN` |

缺少必填的路径/查询/请求头参数或请求体时，本地直接返回 `INVALID_ARGUMENT`，不会发出请求。
`304 Not Modified`（归档条目端点带 `If-None-Match` 时出现）是正常响应，按原状态码返回。

## 使用示例

```bash
# 存活探针
octobus-tentacles ruifosang-dps-version --config config.json get-liveness

# 资产列表（from_sec / until_sec 为必填查询参数）
octobus-tentacles ruifosang-dps-version --config config.json list-assets \
  --data-json '{"fromSec":1700000000,"untilSec":1700003600,"role":["server"],"page":1,"pageSize":50}'

# 确认设备指纹候选（JSON 请求体放在 body 字段里）
octobus-tentacles ruifosang-dps-version --config config.json confirm-device-candidates \
  --data-json '{"body":{"confirmations":[{"detailId":"d-1","action":"confirm"}]}}'

# 请求体较大时可以写进文件，用 --data 传文件路径
octobus-tentacles ruifosang-dps-version --config config.json publish-enrichment --data payload.json
```

## 说明与限制

- 端点与参数名来自厂商 OpenAPI 文档；`src/endpoints.js` 是唯一映射表，方法名与说明在 `service.json`。
- 请求体用 `google.protobuf.Struct` 原样透传，字段名遵循 vendor 文档；本包不做 schema 级校验。
- `Struct` 用 double 表示数字，超过 2^53 的整数会丢精度。文档里有 24 个请求体 schema 含 `int64`
  字段（如 `expected_version`、`expected_draft_revision`、`from_sec`、`created_unix`、`rule_id`）。
  这些字段取值都是版本号、时间戳、记录 ID 量级，正常范围内精确；确需更大整数时请先在 2^53 内换算，
  或改用能直接表达 int64 的调用方自行构造请求。
- `StreamPackets` 在上游文档里是一次性 JSON 响应（"followed stream"），因此这里同样是普通 unary 方法。
- 字节端点（文件、归档条目、作业产物、报表导出）返回 `binary_body`；文档未声明它们的响应体，
  状态码按文档记录为 200/206/304。
- 请求统一带 `Accept-Encoding: identity`：字节端点必须拿到未压缩的原始字节，JSON 端点的
  `content-length` 也才能描述返回内容。若上游仍返回压缩体，本包不转发那个 `content-length`。
- **不跟随重定向**（`followRedirects` 默认 false）。跟随会把 POST/PUT/PATCH 降级成不带请求体的
  GET，也会把"未登录跳转登录页"变成 200 的 HTML——两种都是静默的错误结果。需要跟随请显式打开。
- `timeoutMs` 覆盖整个请求，包括读取响应体；响应体卡住同样映射为 `DEADLINE_EXCEEDED`。
