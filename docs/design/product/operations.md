# Operations And Lifecycle

## Admin API

daemon 只监听一个 TCP 端口，admin API 与 gRPC、Connect RPC、MCP、reflection 共用该端口。默认地址可以是：

```text
127.0.0.1:9000
```

CLI 默认连接该地址。可通过全局参数或环境变量覆盖：

```text
octobus --addr https://octobus.example.com:9000 status
OCTOBUS_ADDR=127.0.0.1:9000
```

admin API 路径前缀为 `/admin/v1/...`。daemon 默认绑定 localhost，也允许通过 `--addr` 显式绑定非 localhost 地址。远程暴露时需要由部署方提供网络访问控制；不支持 Unix socket。

## CLI 与 daemon

CLI 写操作必须通过 admin API，不直接修改 SQLite。

如果 daemon 未启动，CLI 不自动启动 daemon，而是提示用户先运行：

```text
octobus serve
```

原因：自动拉起 daemon 会引入进程归属、日志位置、生命周期管理等额外复杂度。

## 日志与可观测性

daemon 主日志默认写入 stderr，使用 `log/slog` text handler 的 `key=value` 风格输出。
它聚焦生命周期、控制面变更、后台任务和异常摘要，不承担完整访问审计职责。

主日志覆盖：

- daemon 启停：`daemon_starting`、`daemon_listening`、`daemon_shutdown_started`、
  `daemon_shutdown_done`、`daemon_server_error`。
- 启动恢复：`recover_enabled_started`、`recover_enabled_done`、
  `recover_enabled_failed`。
- startup inventory：`startup_inventory`、`startup_capset`、`startup_instance`。
- instance 生命周期：create/start/ready/stop/restart/delete、异常退出、degraded、
  backoff restart、config/secret 更新。
- service import 和 service update 后的 enabled instance 批量 restart。
- Admin API 写操作。Admin API 读操作不写 daemon 主日志。
- 协议异常摘要：成功协议请求只写 access log；失败的 gRPC、Connect RPC、MCP、
  OpenAPI 或 reflection 请求会写 `protocol_request_failed`。
- access log 自身异常：`access_log_write_failed` 和 `access_log_follow_failed`。

日志禁止写入请求体、响应体、Authorization、token、secret、完整 config、原始业务
metadata、multipart body、客户端绝对路径、service import 上传临时路径或带凭据的 Git source。
config/secret 更新只写 hash 和 restart 摘要。

capset 公共协议访问写入数据目录下的 `access.log`：

```text
<data-dir>/access.log
```

该文件权限为 `0600`，格式为 NDJSON，一行一条访问记录。记录字段包括时间、协议、
capset、service、instance、method、MCP tool、route、HTTP/gRPC 状态、耗时、
remote addr 和 user agent。记录不包含 body、Authorization、token、secret 或业务
metadata。

写入范围包括 Connect RPC、MCP、OpenAPI、capset gRPC 调用，以及携带
`x-octobus-capset` 的 gRPC reflection stream。Admin API 管理操作不写 access log。

Access log 可通过 CLI 或 Admin API 查询：

```text
octobus logs [--capset ID] [--instance ID] [--service ID] [--limit N]
octobus logs [--capset ID] [--tail N] --follow
GET /admin/v1/logs/access?capset=<id>&instance=<id>&service=<id>&limit=<n>
GET /admin/v1/logs/access?capset=<id>&tail=<n>&follow=true
```

响应 `Content-Type` 为 `application/x-ndjson`，并保留原始日志行。`limit` 默认 200；
`limit=0` 返回全部匹配记录。`tail` 返回最后 N 条匹配记录；follow 模式默认 tail 200，
`tail=0` 表示只流式输出新记录。缺失或空日志文件返回 200 空 body。

## Instance 状态

instance 状态枚举：

- `starting`
- `running`
- `degraded`
- `stopped`
- `failed`

`enabled=true` 表示 daemon 启动或恢复时应拉起该 instance。

`enabled=false` 表示该 instance 不应被自动拉起。

## 启停语义

`octobus instance stop`：

- 设置 `enabled=false`。
- 停止子进程。
- 状态变为 `stopped`。

`octobus instance start`：

- 设置 `enabled=true`。
- 启动子进程。

`octobus instance restart`：

- 不改变 `enabled`。
- 重启当前子进程。

daemon 启动恢复时，只拉起 `enabled=true` 的 instance。

## 异常退出与自动重启

enabled instance 的子进程异常退出后，Octobus 自动重启。

backoff 策略：

```text
1s -> 2s -> 5s -> 10s -> 30s
```

最大 backoff 为 30s。

如果连续失败超过阈值，instance 状态标记为 `degraded`，但仍低频重试。

## 删除策略

- 删除 capset 时，删除该 capset 下的 instance binding 和 method binding，不影响 service 或 instance。
- 删除 instance 时，默认停止进程、移除 SQLite instance 记录，并删除引用它的 capset binding。
- 删除 service 时，如果存在引用它的 instance，默认拒绝；用户必须先删除这些 instance。
- 默认删除操作不清理 service artifact/runtime 或 instance workdir，避免误删日志、配置和可审计材料。

物理清理可作为单独 `prune` 或 `purge` 命令实现。
