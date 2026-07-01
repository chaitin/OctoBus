# Octobus Design Overview

Octobus 是一个本地单程序能力网关。它管理可插拔的 Node.js service package，
把选定 instance 的 gRPC 能力按 capset 暴露给本地 agent、CLI 或其他调用方。

## Design Index

- `product/`：用户可见模型、CLI、生命周期、错误和安全边界。
- `technical/`：实现架构、协议、Node runtime、service package contract 和 service discovery。

### Product

- [product/domain-model.md](product/domain-model.md)
- [product/cli.md](product/cli.md)
- [product/operations.md](product/operations.md)
- [product/error-model.md](product/error-model.md)
- [product/security.md](product/security.md)

### Technical

- [technical/architecture.md](technical/architecture.md)
- [technical/routing-protocols.md](technical/routing-protocols.md)
- [technical/node-runtime.md](technical/node-runtime.md)
- [technical/service-package.md](technical/service-package.md)
- [technical/multi-service-npm-package.md](technical/multi-service-npm-package.md)
- [technical/services-package-quality.md](technical/services-package-quality.md)
- [technical/js-sdk.md](technical/js-sdk.md)
- [technical/service-discovery.md](technical/service-discovery.md)
- [technical/release.md](technical/release.md)

## Product Shape

Octobus 由一个 Go 实现的 `octobus` binary 提供。该 binary 同时承担 daemon、CLI
入口、本地 admin API、公共协议网关、SQLite registry 和 Node.js 子进程管理职责。

典型本地流程：

```text
octobus serve
octobus service import gitlab ./gitlab-wrapper.tgz
octobus instance create gitlab-test --service gitlab --config ./gitlab-test.config.json
octobus capset create dev --name DevAgent
octobus capset add-instance dev gitlab-test
```

配置完成后，同一个 daemon 端口提供：

- Admin API：CLI 通过 `/admin/v1/...` 完成管理操作。
- gRPC：保持原始 `/{package.Service}/{Method}` method path，通过 metadata 做确定性路由。
- Connect RPC：通过 capset-scoped HTTP path 调用已选择的一元方法。
- MCP：通过 streamable HTTP 暴露 capset 内的一元方法 tools。
- Reflection：基于 capset 裁剪后的 descriptor 提供 gRPC reflection。

## Core Model

核心实体是：

- service：导入后的 package artifact、runtime dir、descriptor 和 package metadata。
- instance：某个 service 的可运行实例，拥有独立 config、secret、workdir、日志和状态。
- capset：暴露给某个 agent 或使用场景的一组 instance methods。
- method binding：capset 到 service / instance / method 的静态绑定关系。
- artifact：导入时固定下来的 package 内容和 descriptor，可用于 daemon 重启恢复。

service 只维护当前版本。再次导入同一个 service id 会替换当前版本，并重启该 service
的所有 enabled long-running instances。capset method binding 不会因为 service 更新而
自动新增方法；已失效的方法在 catalog 和 MCP tools/list 中不再暴露。

## Public Protocols

Octobus 使用单一监听端口承载 admin API、gRPC、Connect RPC、MCP 和 reflection。
daemon 默认绑定 localhost，允许通过 `--addr` 显式绑定非 localhost 地址。

路由原则：

- gRPC 保持原始 method path，通过 `x-octobus-capset` 和
  `x-octobus-instance` metadata 选择目标。
- Connect RPC 使用 `/capsets/{capset_id}/connect/{instance_id}/{full_service}/{method}`。
- MCP 使用 `/capsets/{capset_id}/mcp`，tool name 默认
  `{service}__{instance}__{method}`，冲突时必须显式配置。
- Reflection 请求必须携带 `x-octobus-capset`，缺失时拒绝，不提供全局 descriptor。

long-running service 的 gRPC 网关支持 unary 和 streaming methods。Connect RPC、MCP、
OpenAPI、on-demand invoke 和 SDK 业务 CLI 只支持 unary methods。

## Service Package Contract

service package 是 npm-compatible package。Octobus import 只信任：

- service root 下的 `service.json`。
- distribution package 根目录的 `package.json bin`。
- `service.json` 引用的 proto、config schema 和 secret schema。
- Go 侧编译出的 protobuf descriptor。

`service.json` 不声明 Octobus service id 或 runtime entry。service id 由
`octobus service import SERVICE SOURCE` 的 `SERVICE` 位置参数指定；runtime entry 由根 `package.json bin` 解析。

distribution package 可以包含多个 service root。所有 source 类型都支持
`//service-dir` 选择其中一个 service root，runtime dir 仍保存完整 distribution
package。子目录 `package.json` 不参与 import/runtime 依赖解析或 entry 解析。

JavaScript SDK 包名为 `@chaitin-ai/octobus-sdk`。它封装
`--runtime serve` / `--runtime invoke` / `--runtime inspect` 等运行协议，但第三方
service package 命名不强制包含 `octobus`。

仓库内公开服务集成由 `services/` 下的 `@chaitin-ai/octobus-tentacles` 多服务
distribution package 维护。该包的长期质量线、validator/test/pack/smoke 门禁和安全面约束
记录在 [technical/services-package-quality.md](technical/services-package-quality.md)。

## Persistence And Runtime

SQLite 是控制面事实来源，记录 service、instance、capset、method binding、artifact
hash、descriptor metadata、instance enablement 和恢复所需状态。

instance 使用 service runtime dir 启动独立 Node.js 子进程。每个 instance 有独立
workdir、`config.json`、`secret.json`、stdout/stderr 日志和运行状态。config 与
secret 文件权限为 `0600`；如果 service 声明 JSON Schema，创建和更新时必须完整校验。

daemon 根据标准 gRPC health check 判断 long-running instance ready，并在重启后恢复
所有 `enabled=true` 的 long-running instances。on-demand instance 不预启动，请求到达
时通过 `--runtime invoke` 启动短生命周期进程。

## Observability And Release

daemon 主日志使用 Go `log/slog` text handler 输出到 stderr，记录 daemon 生命周期、
instance 生命周期、service import、Admin API 写操作、批量重启和协议异常摘要。成功的
capset 公共协议请求不写 daemon 主日志，而是追加到 `<data-dir>/access.log`。access log
为 `0600` 权限的 NDJSON 文件，可通过 `octobus logs` 或
`GET /admin/v1/logs/access` 按 capset、instance、service 过滤，也支持 follow/tail
场景。

公开仓库只保留 GitHub Actions 工作流。默认 CI 是轻量验证，覆盖 Go 格式/vet、Go
cmd/internal 包测试、binary build、OctoBus npm binary package dry-run，以及 SDK
`npm ci`、test、build 和 pack dry-run；完整 `task test` 仍是本地门禁。OctoBus
daemon/CLI 通过 `v<version>` tag push 发布到 npmjs 的 `@chaitin-ai/octobus` 及平台
binary 包，tag 版本必须与 `npm/octobus/package.json.version` 完全一致。SDK 只通过
`sdk-v<version>` tag push 发布到 npmjs，tag 版本必须与 `sdk/package.json.version`
完全一致。

## Design Boundaries

当前设计不包含：

- 鉴权、身份目录、agent registry、用户体系、审计、限流或策略发布。
- UI、远程 admin API 或 Unix socket admin API。
- service 级负载均衡、动态路由选择或自动 fallback。
- Connect RPC streaming、MCP SSE 或多轮流式 tool call。
- 多 revision service 管理；回滚通过重新导入旧 package artifact 完成。
- 自动把 service 更新新增的 methods 暴露到已有 capset。
- 默认物理清理 service artifact、runtime 或 instance workdir。
