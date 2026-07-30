# 长亭鉴微 OctoBus Service

[English](README.md)

这是一个社区维护的 OctoBus Service，只封装公开 [`chaitin-cli/products/insight`](https://github.com/chaitin/chaitin-cli/tree/b6f6a3fc6b5b15170eac75112dc6722da09394ab/products/insight) 已实现的鉴微 API 能力。

## 接口来源与边界

- 公开参考仓库：`chaitin/chaitin-cli`
- 固定参考提交：`b6f6a3fc6b5b15170eac75112dc6722da09394ab`
- 参考许可证：GPL-3.0
- 本 Service 为依据公开请求路径和参数重新编写的 JavaScript 实现
- 运行时仅依赖开源的 `@chaitin-ai/octobus-sdk`、`@bufbuild/protobuf` 和 `undici`

本包不包含私有接口文档、厂商源码、抓包内容、客户数据或凭据。公开 CLI 未明确实现的接口不会在这里暴露。CLI 的通用 raw 请求能力也不会暴露，以免绕过 OctoBus 的逐方法授权边界。

## 配置

```json
{
  "baseUrl": "https://insight.example.com",
  "rpcPath": "/pedestal/rpc",
  "timeoutMs": 10000,
  "skipTlsVerify": false,
  "sendJwtCookie": true
}
```

Secret：

```json
{
  "token": "<authorized-insight-api-token>"
}
```

默认同时发送 Bearer Token 和 `jwt` Cookie，与公开 CLI 行为一致。只有受控的自签名证书环境才应启用 `skipTlsVerify`。

## 已暴露能力

- 连通性：`HealthCheck`
- 任务：`ListTasks`、`StartTask`、`StopTask`、`GetTaskStatus`
- 资产：`ListIpAssets`、`ListWebAssets`、`ListSoftwareAssets`、`ListAssetTags`、`ListAssetBusinesses`
- 漏洞：`ListIpVulnerabilities`、`ListWebVulnerabilities`
- 结果：`ListTaskResults`、`CompareTaskResults`、`GetAssetSnapshot`
- 工单：`ListOrders`
- 系统：`GetLicense`、`GetMachineId`

`StartTask` 非幂等，`StopTask` 不保证幂等，Service 均不会自动重试。请求结果不明确时，应先检查执行状态再决定是否继续写操作。生产环境应通过方法级 capset 仅向可信 Agent 开放这两个接口。

响应使用 `google.protobuf.Value`，以保留公开 CLI 返回的部署相关 JSON 结构。

使用者必须获得鉴微环境所有者授权，并遵守目标环境的许可证、审计、限流和服务条款。
