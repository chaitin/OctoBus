# Service Discovery

## 定位

Octobus 不生成完整 agent 调用文档。Markdown catalog 只作为紧凑调用清单。

调用文档由外部平台生成。外部平台需要从 Octobus 获得两类信息：

- capset 暴露了哪些 service / instance / method。
- 这些 method 对应的 proto descriptor，包括 request / response message 结构和注释信息。

因此，Octobus 提供稳定的 catalog API、gRPC reflection、MCP tools/list 和 Connect RPC OpenAPI，但不内置文档生成逻辑。

## 设计原则

- reflection 由 Octobus 基于导入阶段归档的 descriptor 提供。
- reflection 不直接透传到 Node instance。
- reflection 的可见范围应尽量与 capset 暴露面一致。
- 外部平台通过 catalog 获取路由信息，通过 reflection 获取 gRPC proto 类型信息，通过 MCP tools/list 获取 tool input schema，通过 OpenAPI 获取 Connect RPC schema。
- agent 实际调用时仍使用原始 gRPC path，并携带 `x-octobus-capset` 和 `x-octobus-instance` 路由 metadata。

## 发现入口

| 协议 | 发现入口 | 调用入口 | 路由信息 |
| --- | --- | --- | --- |
| gRPC | server reflection + `x-octobus-capset` metadata | 原始 `/{package.Service}/{Method}` | `x-octobus-capset`、`x-octobus-instance` metadata |
| MCP | `tools/list` | `tools/call` | capset endpoint 和 tool name |
| Connect RPC | capset OpenAPI | `/capsets/{capset_id}/connect/{instance_id}/{full_service}/{method}` | URL path |

schema 发现方式：

- gRPC：对 daemon 端口使用标准 server reflection，并携带 `x-octobus-capset`。
- MCP：调用 `POST /capsets/{capset_id}/mcp` 的 JSON-RPC `tools/list`，读取 tool 的 `inputSchema`。
- Connect RPC：读取 `/capsets/{capset_id}/openapi.json` 或 `/capsets/{capset_id}/openapi.yaml`。

## Catalog

admin API 需要提供 capset catalog，用于描述某个 capset 当前可调用的能力集合。

当前接口为：

```text
GET /admin/v1/catalog/{capset_id}
GET /admin/v1/catalog/{capset_id}/openapi.json
GET /admin/v1/catalog/{capset_id}/openapi.yaml
GET /capsets/{capset_id}/openapi.json
GET /capsets/{capset_id}/openapi.yaml
```

返回内容至少包括：

- capset id / name / description。
- service id。
- instance id。
- method full name，例如 `gitlab.MergeRequestService/List`。
- gRPC 调用所需 metadata：`x-octobus-capset`、`x-octobus-instance`。
- MCP tool name。
- Connect RPC endpoint / procedure / OpenAPI URL。
- descriptor version / hash。
- request / response message full name。

catalog 是最终可调用清单和路由事实来源。它回答“这个 capset 暴露了什么、应该如何路由”。gRPC 字段结构、枚举、注释等由 reflection 返回；Connect RPC 字段 schema 由 OpenAPI 返回。

## gRPC Reflection

Octobus 在同一个公开端口上提供标准 gRPC reflection service。

reflection 请求也使用 metadata 指定 capset：

```text
x-octobus-capset: dev
```

reflection 不要求携带 `x-octobus-instance`。原因是文档生成平台通常需要获取整个 capset 的可见 proto 集合，而不是只查询单个 instance。

当 reflection 请求带有 `x-octobus-capset` 时，Octobus 只返回该 capset 已暴露 gRPC methods 所需的 descriptor 依赖闭包，并对 service method 做可见性裁剪。这里的 gRPC methods 包括 long-running service 已暴露的 unary 和 streaming methods。

如果未携带 `x-octobus-capset`，Octobus 必须拒绝请求，避免默认暴露全局 descriptor。错误语义是“reflection 必须指定 capset”；具体 gRPC code 由实现阶段统一。

## 可见性过滤

capset 可能只选择某个 service 的部分 method。标准 gRPC reflection 的返回单位是 file descriptor，但 Octobus 可以在返回前对归档 descriptor 做可见性裁剪。

采用以下规则：

- catalog 精确列出 capset 已暴露的 method。
- reflection 返回这些 method 所属 proto file 的 descriptor 依赖闭包。
- reflection 中的 service descriptor 只保留 capset 已暴露的 gRPC methods。
- 依赖 message、enum、extension、import file 和 source info 尽量保留，以保证 request/response 类型可以被标准客户端解析。
- 外部平台生成文档时仍必须以 catalog 的 method 列表作为最终可调用清单。

这样可以降低外部平台误把未暴露 method 写入 agent 文档的概率，同时保留 catalog 作为权威路由面。reflection 裁剪不是鉴权边界，实际调用仍必须通过 capset binding 校验。

## 多 instance 场景

同一个 capset 中可能包含同一 service 的多个 instance。

reflection 返回的是 service 当前版本的 proto descriptor；实例差异不应改变 proto 类型结构。instance 级差异通过 catalog 中的 `instance_id` 和调用 metadata 表达。

service 更新成功后 descriptor version / hash 会变化，并且 enabled instances 会立即重启到新版本。外部平台应使用 catalog 中的 descriptor version / hash 判断调用文档是否需要重新生成。

## grpcurl 示例

列出 capset 可见 service：

```text
grpcurl \
  -plaintext \
  -H 'x-octobus-capset: dev' \
  127.0.0.1:9000 \
  list
```

查看某个 service descriptor：

```text
grpcurl \
  -plaintext \
  -H 'x-octobus-capset: dev' \
  127.0.0.1:9000 \
  describe gitlab.MergeRequestService
```

实际业务调用需要 capset 和 instance 路由 metadata：

```text
grpcurl \
  -plaintext \
  -H 'x-octobus-capset: dev' \
  -H 'x-octobus-instance: gitlab-test' \
  -d '{"projectId":"foo"}' \
  127.0.0.1:9000 \
  gitlab.MergeRequestService/List
```

业务扩展 metadata 使用 `x-octobus-ext-*` 命名，例如 `x-octobus-ext-business-request-id` 和 `x-octobus-ext-username`。这类 metadata 会透传给 service package，不参与 OctoBus 路由。默认不会把任意 HTTP header 映射进该通道；仅当 operator 显式配置 `--http-header-forward SOURCE=x-octobus-ext-NAME` 时，Connect RPC / MCP 的 HTTP 请求才会按规则复制指定 header，gRPC 客户端应直接发送 `x-octobus-ext-*` metadata。calculator 示例优先读取 `x-octobus-ext-business-request-id`，并兼容旧的 `x-business-request-id`。

## 非目标

- 不生成完整 agent 调用文档；Connect RPC OpenAPI schema 和紧凑 Markdown catalog 属于 catalog 能力。
- 不提供 agent SDK。
- 不从 Node instance 动态查询 descriptor。
- 不把 reflection 作为授权系统；未暴露 method 调用必须在网关路由阶段返回 `NOT_FOUND`。
