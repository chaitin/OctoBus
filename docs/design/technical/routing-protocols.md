# Routing And Protocols

## 协议范围

Octobus 公共协议网关按运行模式和协议区分 method 类型支持：

- long-running service 的 gRPC 网关支持 unary、server streaming、client streaming 和 bidirectional streaming。
- Connect RPC、MCP、OpenAPI、on-demand `--runtime invoke` 和 SDK 业务 CLI 只支持 unary methods。

若 proto 中包含 streaming method，导入阶段会记录 metadata。streaming method 可以通过 long-running gRPC 暴露和调用，但不会进入 Connect RPC、MCP、OpenAPI 或 on-demand 调用路径。

admin API、gRPC、Connect RPC、MCP 和 reflection 都通过同一个本地 daemon 端口暴露。

## Capset Access Token

capset 创建后默认没有 access token。没有 token 时，capset 下的公开资源保持开放访问，用于本地开发和可信环境。

当 capset 添加了一个或多个 token 后，公开资源必须携带有效 token：

- HTTP/Connect RPC/MCP/OpenAPI 使用 `Authorization: Bearer <token>`。
- gRPC 调用和 reflection 使用 metadata `authorization: Bearer <token>`。
- admin 管理 API 不受 capset token 保护，仍由部署侧网络边界负责保护。

token secret 只用于创建和请求校验，持久化存储为 hash，不明文保存。删除某个 token 后，该 token 立即失效；删除 capset 时同步删除该 capset 的 token。

## Connect RPC

Connect RPC 路由把 capset / instance / method 编码到 path 中，使用 `connectrpc.com/connect` 处理 Connect HTTP 协议。instance ID 全局唯一，并已关联 service，因此短路径不重复携带 service ID。

Connect RPC 入口：

```text
POST /capsets/{capset_id}/connect/{instance_id}/{full_service}/{method}
```

示例：

```text
POST /capsets/dev/connect/gitlab-test/gitlab.MergeRequestService/List
```

请求 body 支持 Connect unary 的 protobuf JSON 和 protobuf binary content type。

catalog 和 OpenAPI 输出该 `/capsets/{capset_id}/connect/...` 路径。旧 `/c/{capset_id}/i/...` 和完整 `/capsets/{capset_id}/services/{service_id}/instances/{instance_id}/connect/...` 路径不保留兼容。

JSON 约定：

- request unknown fields: strict，不允许未知字段。
- response field names: 使用 protobuf JSON mapping 的 `jsonName`。
- response zero values: 默认省略。

## MCP

MCP 按 capset 暴露工具集合。

MCP 入口：

```text
POST /capsets/{capset_id}/mcp
```

MCP 只支持 streamable HTTP。SSE 不纳入当前目标。

协议能力上只支持 unary tool call。

MCP tools/list 从 capset 绑定关系生成，只包含已选择的 unary methods；streaming methods 即使在 capset 中可供 gRPC 使用，也不会生成 MCP tools。

当同一个 capset 中存在同一个 service 的多个 instance 时，tool name 必须避免冲突。默认格式：

```text
{service_name}__{instance_name}__{method_name}
```

`method_name` 转为 snake_case。MCP tool name 必须包含 instance 信息，确保 agent 能区分同一 service 的不同 instance。

如果默认 tool name 冲突，capset add/select 操作失败，用户必须通过 `--mcp-tool` 显式指定 tool name。

更丰富的 method binding alias 不属于当前目标；当前只要求 MCP tool name 可配置。

### MCP inputSchema

`tools/list` 必须为每个 tool 返回由 protobuf request message descriptor 派生的 `inputSchema`。

设计要求：

- 字段名遵循 protobuf JSON mapping 的 `jsonName`。
- 转换规则优先复用社区 protobuf-to-MCP/JSON Schema 实现，或兼容类似 `protoc-gen-go-mcp` 的类型映射规则。
- Octobus 不发明私有 schema 语义。
- proto3 字段默认不标记为 JSON Schema `required`，除非未来引入并明确支持 `google.api.field_behavior = REQUIRED` 或自定义 option。
- `tools/call` 的最终参数校验仍以 protobuf JSON strict decode 为准，`inputSchema` 主要用于 agent 参数生成和客户端提示。
- 对无法精确表达的 protobuf 语义，schema 应保守降级，而不是产生误导性强约束。

## gRPC

gRPC 必须原样暴露原始接口，因此 method path 保持：

```text
/{package.Service}/{Method}
```

由于业务 request message 不能增加路由字段，capset / instance 不能编码到 protobuf body 中。instance ID 全局唯一，并且 instance 已经关联 service，因此 gRPC 路由只需要携带 instance ID。

已确认：gRPC 路由信息使用 metadata。

项目 codename 是 `octobus`，因此路由 metadata 使用明确的 `x-octobus-*` 控制字段：

```text
x-octobus-capset: dev
x-octobus-instance: gitlab-test
```

`grpcurl` 调用示例：

```text
grpcurl \
  -plaintext \
  -H 'x-octobus-capset: dev' \
  -H 'x-octobus-instance: gitlab-test' \
  -H 'authorization: Bearer dev-secret' \
  -d '{"projectId":"foo"}' \
  127.0.0.1:9000 \
  gitlab.MergeRequestService/List
```

Go gateway 使用上述 metadata 做确定性路由。gRPC catalog 中的 routing metadata 输出 `x-octobus-capset` 和 `x-octobus-instance`。

gateway 在转发给 Node instance 前剥离 Octobus 控制 metadata。控制 metadata 包括 `x-octobus-*` 中除 `x-octobus-ext-*` 以外的字段。需要透传给 service package 的 Octobus 业务扩展字段使用 `x-octobus-ext-*`，例如 `x-octobus-ext-business-request-id` 和 `x-octobus-ext-username`，不会被剥离。calculator 示例优先读取 `x-octobus-ext-business-request-id`，并 fallback 到旧的 `x-business-request-id`。

Connect RPC 普通 JSON 调用默认只从 HTTP header 透传明确允许的业务 metadata：`x-business-request-id` 和 `x-octobus-ext-*`。默认不全量透传 HTTP header，避免 hop-by-hop header、content negotiation header、`Host`、`Authorization` 或 Octobus 控制 header 泄漏到 service package；`Authorization` 只用于 capset 鉴权。

例外是 operator 显式启用的 header 改名转发：配置 `--http-header-forward SOURCE=x-octobus-ext-NAME`（或环境变量 `OCTOBUS_HTTP_HEADER_FORWARD`）后，gateway 在把 HTTP header 转换为 metadata 前按规则复制源 header。源 header 仍只用于 capset 鉴权，规则不改变认证语义；目标必须是 `x-octobus-ext-*`，因此仍落在既有透传通道内。该配置默认关闭；启用后所选 header 的原始值会交给 service package，信任边界由 operator 负责。

预期使用场景：系统会把 gRPC 调用规约通过 catalog/reflection 或外部文档交给 agent，agent 再根据文档使用 `grpcurl` 或自行写代码完成调用。

Octobus 不负责生成完整 agent 调用文档。外部平台通过 admin catalog 获取 capset 暴露面，并通过 Octobus 提供的 gRPC reflection 获取 service/method/message descriptor 后自行生成调用规约。Connect RPC 的字段级 schema 通过 capset OpenAPI 文档获取。

reflection 由 Octobus 基于导入阶段归档的 descriptor 提供，不直接透传到 Node instance。服务发现入口和 reflection 约定见 [service-discovery.md](service-discovery.md)。
