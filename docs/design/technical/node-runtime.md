# Node Runtime

## 当前结论

Go 程序使用本机子进程启动 Node.js service package。每个 service 对应一个 npm-compatible package，该 package 自身 serve 具体 gRPC service instance。

JS 侧不设计为“通用 Node runtime 加载任意 JS 文件”，而是 package contract：package 提供 `service.json`、根 `package.json bin`、proto、实现和 `--runtime serve` / `--runtime invoke` 协议。`@chaitin-ai/octobus-sdk` 帮助开发者实现这些协议。

## Go -> Node 启动协议

Go 创建或恢复 long-running instance 时：

- 分配本地端口。
- 写入 instance config JSON。secret JSON 只保存在 SQLite 中，不落盘，启动时通过管道从 fd 3 传给子进程。
- 从 service runtime dir 启动 `package.json bin` 解析出的 `node_entry`。
- 通过 CLI 参数传递监听地址、端口、config 路径、secret 所在的 fd、workdir、service id 和 instance id。
- 通过 env 传递 OctoBus 运行时标识。
- 使用独立 instance workdir 作为子进程 cwd。

启动命令形态：

```text
{data_dir}/artifacts/services/{service_id}/runtime/<node_entry> --runtime serve \
  --host 127.0.0.1 \
  --port 41001 \
  --config /path/to/instance.json \
  --secret-fd 3 \
  --workdir /path/to/instances/gitlab-test \
  --service gitlab \
  --instance gitlab-test
```

实际启动时：

- `cwd` 设置为 `{data_dir}/instances/{instance_id}`。
- `<node_entry>` 必须是 runtime dir 内存在的普通文件，不回退到 `PATH`。
- `--config` 指向 `{data_dir}/instances/{instance_id}/config.json`。
- `--secret-fd 3` 表示 secret JSON 从 fd 3 读取；OctoBus 通过管道写入，secret 不落盘。
- `--workdir` 指向 `{data_dir}/instances/{instance_id}`。
- `--service` 是 OctoBus service id。
- `--instance` 是 OctoBus instance id。

同一个 service 的多个 instance 共享 runtime dir，但每个 instance 有自己的 workdir。

instance workdir 用于：

- config.json
- stdout.log / stderr.log
- 临时文件
- cookie/session/cache
- 运行状态文件

运行时环境变量：

```text
OCTOBUS_SERVICE_ID=<service_id>
OCTOBUS_INSTANCE_ID=<instance_id>
OCTOBUS_PACKAGE_DIR={data_dir}/artifacts/services/{service_id}/runtime/<service_root>
OCTOBUS_DESCRIPTOR_PATH={data_dir}/artifacts/services/{service_id}/descriptor.protoset
OCTOBUS_DESCRIPTOR_SHA256=<sha256>
```

`service_root` 是导入 source 的 `//service-dir` 选择结果，未指定时为 `"."`。SDK 优先从 `OCTOBUS_PACKAGE_DIR` 读取 service root 下的 `service.json`，因此 runtime dir 可以保存完整 distribution package。

以上是默认 `off` 等级的启动契约：子进程继承 daemon 的全部环境变量，再追加上面的 `OCTOBUS_*` 变量。

## Runtime 加固

`octobus serve --runtime-hardening=node` 开启 `node` 等级后，long-running 和 on-demand runtime 都经过 `internal/hardening` 的 `Apply` 启动，启动契约有以下不同：

- 环境变量不再继承 daemon，只保留白名单（`PATH`、`LANG`、`LC_ALL`、`TZ`、代理和 CA 相关变量，Windows 上另有 `SystemRoot`、`PATHEXT`、`COMSPEC`），再追加 `OCTOBUS_*` 变量。
- `HOME`、`USERPROFILE` 指向 instance workdir；`TMPDIR`、`TEMP`、`TMP` 指向 `{workdir}/tmp`，该目录在启动前创建，其中的文件不会自动清理。
- 注入 `NODE_OPTIONS`（daemon 自己的 `NODE_OPTIONS` 被丢弃）：`--permission`，`{data_dir}/artifacts/services/{service_id}` 和 workdir 的 `--allow-fs-read`，workdir 的 `--allow-fs-write`，Node.js 25+ 上加 `--allow-net`，以及 `--max-old-space-size=512`。路径同时授权原路径和解析符号链接后的路径。
- 入口文件路径和 cwd 解析为真实路径后再启动，因为 Node 在权限模型下会对入口做 realpath，并检查途经的符号链接（例如 macOS 上的 `/var`）。
- 每个 runtime 运行在独立的进程组中（仅限 Unix）。停止、启动失败和 on-demand 调用结束时，信号和清理作用于整个进程组。

daemon 启动时先检查 `PATH` 中 `node` 的版本（22.13+、23.5+ 或 24+），再用同样的 `Apply` 准备流程试运行一次 `node`，任一检查失败都拒绝启动。安全含义和限制见 [product/security.md](../product/security.md)。

## Node 职责

Node service package 至少需要：

- 提供 `service.json`，声明 proto roots/files、runtime mode 和可选 config / secret schema。
- 提供根 `package.json bin`，声明 runtime entry；多 service package 中 `service.json.name` 必须匹配根 `bin` object 的 key。
- 提供 `--runtime serve --host ... --port ... --config ... --secret-fd ...`，启动 gRPC server。
- 对 on-demand service，提供 `--runtime invoke --method ... --config ... --secret-fd ... --metadata ...`。
- 加载 package 内 proto。
- 注册 gRPC server。
- 执行业务 handler。
- 对未实现 unary method 返回 `UNIMPLEMENTED`。
- 监听指定 host/port。
- 支持标准 gRPC health check。SDK 默认实现，非 SDK package 也必须实现。

`inspect --json` 不作为 import 协议。它可以作为 SDK/package 的开发调试能力，但 OctoBus import 的权威事实来源是 `service.json`、`package.json bin` 和 Go 侧编译出的 descriptor。

## Go 职责

Go NodeSupervisor 负责：

- 进程启动与停止。
- stdout / stderr 日志采集。
- 状态更新。
- 健康检查。
- 退出检测。
- daemon 重启后的自动恢复。
- 启动时保证子进程 cwd 是 instance workdir，避免多个 instance 共享运行状态。
- 使用 `grpc.health.v1.Health/Check service=""` 判断 ready。端口连通和 stdout ready line 不能替代 health check。

## 限制

OctoBus 当前公共数据面支持范围：

- long-running service 的 gRPC 网关支持 unary、server streaming、client streaming 和 bidirectional streaming。
- Connect RPC、MCP、本地 service CLI 和 on-demand `--runtime invoke` 只支持 unary methods。

如果 proto 中包含 streaming method，service 导入时会记录 method metadata；这些 methods 只适用于 long-running gRPC 调用，不进入 Connect RPC、MCP 或 on-demand 调用路径。

更多 package contract 见 [service-package.md](service-package.md)。
