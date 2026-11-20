# Architecture

## 目标形态

Octobus 是一个单一 Go 程序，承担控制面、数据面和本地进程管理职责。

```text
Client / Agent
  -> octobus daemon on one local port
       -> HTTP/2 h2c + HTTP/1.1 server
       -> admin API / gRPC / Connect RPC / MCP / reflection dispatch
       -> SQLite store
       -> descriptor loader
       -> Node supervisor
            -> Node.js gRPC instance processes
```

## 保留能力

- 将已注册 service 的 unary gRPC method 暴露为原始 gRPC 接口。
- 将同一批 unary method 暴露为 Connect RPC HTTP 接口。
- 将同一批 unary method 暴露为 MCP tools。
- 根据 capset / service / instance / method 做确定性路由。
- 管理 service、instance、capset 与 method 暴露关系。
- 程序重启后从 SQLite 恢复 enabled instance，并重新拉起对应 Node.js 子进程。

## 非目标

- 外部代理、独立控制面或远程 admin endpoint。
- 鉴权、可见性策略、身份目录、用户体系。
- 决策日志、策略发布、限流等治理能力。
- 图形界面。
- service 级负载均衡。
- Connect RPC streaming 或 MCP streaming tool call。long-running service 的原始 gRPC
  网关支持 unary 和 streaming methods。

## 组件划分

### Server

单端口入口。负责区分：

- 本地 admin API 请求。
- 原始 gRPC 请求。
- Connect RPC 请求。
- MCP 请求。
- gRPC reflection 请求。

同端口分发基于 `net/http` + `http2/h2c`：

- `Content-Type: application/grpc` 且 HTTP/2 请求进入 gRPC server，其中包含业务 unary proxy 和 reflection service。
- `/admin/v1/...` 进入本地 admin API。
- `/capsets/{capset_id}/mcp` 进入 MCP streamable HTTP adapter。
- `/capsets/{capset_id}/connect/{instance_id}/...` 进入 Connect RPC adapter。

默认监听地址为 `127.0.0.1:9000`，也可以通过 `--addr` 显式绑定非 localhost 地址。不再维护独立 admin 端口。

### Store And Registry

SQLite 是持久化事实来源，daemon 可在其上构建轻量内存视图或按请求读取。它维护：

- services
- instances
- capsets
- capset 与 instance / method 的绑定
- descriptor 与 method metadata。
- artifact/runtime 路径与 hash。
- instance config hash、enablement、运行端点和状态。

Store/Registry 不负责鉴权，只负责确定性查找和 capset 可见性校验。

### Observability

`internal/daemonlog` 提供基于 `log/slog` text handler 的 daemon 主日志。`cmd/octobus`
在启动时创建 logger，并注入 supervisor、admin server、protocol gateway 和 reflection
server。未注入 logger 的结构体使用 no-op fallback。

主日志写 stderr，覆盖 daemon 生命周期、启动恢复、startup inventory、instance 生命周期、
service import、Admin API 写操作、批量 restart、协议异常摘要和 access log 自身异常。
成功的 capset 协议请求不写 daemon 主日志。

`internal/accesslog` 管理 `<data-dir>/access.log`。daemon 启动时以 `0600` 创建该文件，
并把 logger 注入 HTTP/gRPC capset 入口。日志格式是 NDJSON，写入使用互斥锁保证单行不
交错。Admin API 的 `/admin/v1/logs/access` 复用同一包的过滤、tail 和 follow 能力。

### DescriptorStore

读取归档后的 descriptor set，按 `descriptor_path + message_full_name` 返回 dynamic protobuf message type。

Connect RPC 与 MCP 都依赖 DescriptorStore 做动态 protobuf message 构造。MCP `tools/list` 还依赖 DescriptorStore 从 request message 生成 `inputSchema`。

DescriptorStore 也用于 Octobus 自己提供 gRPC reflection。reflection 不转发到 Node instance，而是从已归档 descriptor 中返回按 capset 裁剪后的 proto 信息。

### Router

根据请求结构解析目标：

- capset
- service
- instance
- method

Connect RPC / MCP 可以直接从 URL path 获得 capset。gRPC 因为必须保持原始 method path，路由信息通过 metadata 获得。

gRPC 路由 metadata 使用项目 codename `octobus` 作为前缀：

- `x-octobus-capset`
- `x-octobus-instance`

转发到 Node instance 前，Go gateway 必须剥离 `x-octobus-*` 控制 metadata，避免污染后端业务 handler。需要透传给 service package 的 OctoBus 业务扩展 metadata 使用 `x-octobus-ext-*`，例如 `x-octobus-ext-username`。默认不全量透传 HTTP header；仅当 operator 显式配置 `--http-header-forward SOURCE=x-octobus-ext-NAME` 时，gateway 才把指定 HTTP header 复制进该透传通道，源 header 仍只用于 capset 鉴权。

### NodeSupervisor

负责启动、停止和恢复 Node.js 子进程。

职责包括：

- 分配本地监听端口。
- 以 `0600` 写入 instance config。
- 设置环境变量。
- 启动 Node runtime。
- 记录 PID、endpoint、status。
- 以 `0600` 采集 stdout / stderr 日志。
- 健康检查。
- Go 程序重启后恢复 enabled instances。

### Protocol Adapters

- gRPC adapter：保持原始 gRPC method path，转发到对应 Node instance；long-running service 支持 unary 和 streaming methods。
- Connect RPC adapter：Connect unary request -> dynamic protobuf -> gRPC unary -> Connect response。
- MCP adapter：capset tools/list 与 tools/call；仅暴露已选择的 unary methods，并返回 protobuf request 派生的 inputSchema。
- reflection adapter：基于 capset 选择面做 method 级 descriptor 可见性裁剪，供外部平台生成调用文档。
