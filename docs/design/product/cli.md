# CLI

## 形态

单一 Go binary 同时提供 daemon 和 CLI。

项目 codename 是 `octobus`。命令名前缀使用 `octobus`。

```text
octobus serve
octobus service import ...
octobus service list|get|update|delete ...
octobus instance create ...
octobus instance list|get|update|delete ...
octobus capset create ...
octobus capset list|get|update|delete ...
octobus capset add-instance ...
octobus capset remove-instance ...
octobus capset select-method ...
octobus capset unselect-method ...
octobus logs ...
octobus status
```

## CLI 与 daemon 通信

CLI 调用本地 admin API，而不是直接写 SQLite。

原因：

- daemon 可以立即启动/停止 Node 子进程。
- daemon 可以立即刷新内存 registry。
- 避免 CLI 与 daemon 并发写 SQLite 的状态同步问题。

admin API 暴露在 daemon 的同一个本地端口上，路径前缀为 `/admin/v1/...`。默认监听地址可以使用：

```text
127.0.0.1:9000
```

CLI 默认连接 daemon 端口，可通过全局 `--addr` 参数或 `OCTOBUS_ADDR` 覆盖。不维护独立 admin 端口。地址可使用 `host:port`、`http://host:port` 或 `https://host:port` 形式；省略 scheme 时默认使用 `http`。

CLI 不自动启动 daemon；daemon 未启动时，CLI 提示用户先运行 `octobus serve`。

CLI 写操作必须通过 admin API，不直接修改 SQLite。

## JSON 输出兼容性

CLI 默认把 admin API 的 JSON 响应格式化后输出。service、instance、capset、token 等管理对象当前保持历史 Go-style 字段名，例如 `ID`、`ServiceID`、`HasSecret`、`SecretSHA256` 和 `SecretSchemaPath`，首版不做批量 snake_case 迁移，避免破坏已有脚本。

catalog、MCP、Connect RPC OpenAPI 等协议面输出使用各自协议模型的字段命名；其中 catalog JSON 使用 snake_case 字段，例如 `capset_id`、`service_id`、`instance_id` 和 `descriptor_sha256`。

CLI 会隐藏常见敏感字段和 HTTPS URL credential。`SecretSHA256` 是 secret 派生值，在 CLI 输出中显示为 `******`；`HasSecret` 是布尔状态，保持原值；`SecretSchemaPath` 是 service package 内的 schema 文件路径，不包含 secret 内容，保持可见。

## 命令形态

资源对象使用位置参数，资源属性、输入来源和行为开关使用 flag。

示例：

```text
octobus service get calculator
octobus instance restart calculator-test
octobus capset add-instance dev calculator-test
octobus catalog dev --all --json
```

资源定位不使用 `--id`、`--instance`、`--capset`、`--method` 或 `--all-methods`。
这类定位信息必须由对应子命令的位置参数表达。保留的 flag 只表达属性或行为，
例如 `--name`、`--description`、`--enabled`、`--service`、`--config`、
`--config-json`、`--secret`、`--secret-json`、`--restart`、`--no-start`、
`--no-all-methods`、`--mcp-tool`、`--token`、`--token-file`、`--token-stdin`、
`--build`、`--offline`、`--reinstall` 和全局 `--addr`。

### 导入 service package

```text
octobus service import \
  gitlab \
  npm:@vendor/gitlab-wrapper@1.2.3 \
  --name GitLab
```

第一个位置参数是 Octobus 本地 service id，必填，不从 `service.json` 推导。`--name` 是可选的展示名覆盖值；未提供时，首次导入按 `service.json.displayName`、`service.json.name` 的顺序选择展示名。

multi-service distribution package 可以使用 recursive 模式一次导入发现到的所有 service：

```text
octobus service import --recursive npm:@chaitin-ai/octobus-tentacles
octobus service import --recursive ./platform-services//subset
```

recursive 模式只接受 `SOURCE` 一个位置参数，禁止 `--name`，service id 来自每个
discovered service 的 `service.json.name`。`SOURCE//some-dir` 在 recursive 模式下表示
递归发现的 scan root；依赖安装和 artifact 仍以 distribution package root 为准。

行为：

- 获取 package source。
- 生成或复制 package artifact。
- 计算 package artifact hash。
- 解包到 package dir。
- 解析可选 `//service-dir`；没有指定时 service root 为 package root。
- 准备 runtime dir。
- 按策略安装依赖：默认在线安装，支持 `--offline`，直接依赖都已存在于 `node_modules` 时默认跳过，支持 `--reinstall`。
- 从 service root 读取 `service.json` manifest。导入主路径不执行第三方 package 的 `inspect` 命令。
- 若 package 提供 `configSchema` / `secretSchema`，记录 schema 路径供 instance config / secret 校验使用。
- 编译 descriptor。
- 计算 descriptor hash / version。
- 解析 methods metadata。
- 创建或更新 service 当前版本并写入 SQLite。
- 如果这是对已有 service 的更新，更新成功后自动重启该 service 的所有 enabled instances。
- 输出受影响的 enabled / disabled instances，以及因 descriptor 变化产生的无效 capset method bindings。

其他来源示例：

```text
octobus service import gitlab ./gitlab-wrapper-1.2.3.tgz
octobus service import gitlab ./gitlab-wrapper.zip
octobus service import gitlab https://github.com/acme/services.git//gitlab-wrapper@v1.2.3
octobus service import gitlab https://gitlab.com/group/platform-services@latest
```

HTTPS Git 来源格式为：

```text
https://[user[:password]@]host/path/to/repo[.git][//service-dir][@ref]
```

只支持 `https://` Git remote。`//service-dir` 表示归档后的 distribution package 内 service root；Git artifact 仍以仓库根目录为 package root，不裁剪 archive，也不改变依赖安装根目录。省略 `//service-dir` 时使用 package root 作为 service root。`@ref` 可为 tag、branch 或 commit；省略等同于 `@latest`。`latest` 优先选择最高稳定 SemVer tag（忽略 prerelease），没有稳定 SemVer tag 时使用远端默认分支 `HEAD`。

HTTPS URL 可嵌入 user/password 或 token。用户名和密码中的特殊字符必须按 URL 规则 percent-encode，例如 `p@ss` 写成 `p%40ss`。凭据只在 import 期间用于 Git 拉取，不写入 SQLite、admin API 响应或 CLI 输出；展示时保存为 `******`。`--offline` 只影响后续 npm 安装，不阻止 Git 网络访问。

再次对同一个 service id 执行 import 会更新 service 当前版本。若本次没有显式传 `--name`，保留已有 service 展示名；若传了 `--name`，覆盖已有展示名。更新成功后，新版本立即对该 service 的所有 enabled instances 生效。

如果导入、依赖安装或 descriptor 编译失败，service 当前版本不变。如果 service 当前版本已经提交但 instance 启动失败，命令返回失败；失败的 instance 标记为 `failed` 或 `degraded`，capset 调用返回 `UNAVAILABLE`。Octobus 不继续运行旧 Node 进程，避免进入“控制面新、数据面旧”的状态。

service update 不自动重写 capset method binding。如果新 descriptor 删除了已绑定 method，或该 method 不再是 unary，CLI 会在 update 输出中报告无效 binding。

依赖安装相关示例：

```text
octobus service import gitlab ./gitlab-wrapper-1.2.3.tgz --offline
octobus service import gitlab ./gitlab-wrapper.zip --reinstall
```

### 管理 service 记录

```text
octobus service list
octobus service get gitlab
octobus service update gitlab --name GitLabRenamed
octobus service delete gitlab
```

`service import` 负责创建和更新 service 版本；`service update` 只更新控制面 metadata。

`service delete` 默认只允许删除无 instance 引用的 service。如果仍有 instance 引用该 service，命令失败并列出阻塞的 instance id。删除 service 记录默认保留 artifact/runtime；强制级联删除可作为未来显式 `--force` 能力。

### 创建 instance

```text
octobus instance create \
  gitlab-test \
  --service gitlab \
  --name GitLabTest \
  [--config ./gitlab-test.config.json] \
  [--secret ./gitlab-test.secret.json]
```

也可以直接传入 JSON 或从 stdin 读取：

```text
octobus instance create \
  gitlab-test \
  --service gitlab \
  --config-json '{"baseURL":"https://gitlab.example.com"}' \
  --secret-json '{"token":"..."}'

cat ./gitlab-test.config.json | octobus instance create \
  gitlab-test \
  --service gitlab \
  --config -
```

行为：

- 复制 instance 配置到 instance workdir；未指定 `--config` 时使用 `{}`。
- `--config` 和 `--config-json` 互斥；`--config -` 从 stdin 读取 JSON。
- 复制 instance secret 到 instance workdir；未指定 `--secret` 时使用 `{}`。
- `--secret` 和 `--secret-json` 互斥；`--secret -` 从 stdin 读取 JSON。
- `--config -` 和 `--secret -` 不能在同一个命令中同时使用，因为 stdin 只能消费一次。
- 敏感信息推荐通过 `--secret` 文件或 stdin 传入，避免进入 shell history 或进程参数。
- 绑定 service 当前版本。
- 若 service 提供 `configSchema` / `secretSchema`，按 JSON Schema Draft 2020-12 校验 instance config / secret。
- 以 `0600` 写入 instance workdir 下的 `config.json`。
- 以 `0600` 写入 instance workdir 下的 `secret.json`。
- 计算并记录 `config_sha256` 和 `secret_sha256`。
- 分配端口。
- 从 service runtime dir 启动 Node 子进程。
- 将子进程 cwd 设置为 instance workdir。
- 调用 gRPC health check 判断 ready。
- 记录 pid / listen_addr / status。

### 更新 instance config

```text
octobus instance update-config \
  gitlab-test \
  --config ./gitlab-test.config.json
```

也支持 `--config-json JSON` 或 `--config -`。`update-config` 必须显式提供一个 config 来源；如果要清空配置，使用 `--config-json '{}'`。

默认只更新落盘 config 和 `config_sha256`，不自动重启 instance。若希望立即生效：

```text
octobus instance update-config \
  gitlab-test \
  --config ./gitlab-test.config.json \
  --restart
```

CLI 查看 config 时必须脱敏常见敏感字段，例如 `password`、`token`、`secret`、`key`。

### 更新 instance secret

```text
octobus instance update-secret \
  gitlab-test \
  --secret ./gitlab-test.secret.json
```

也支持 `--secret-json JSON` 或 `--secret -`。`update-secret` 必须显式提供一个 secret 来源；如果要清空 secret，使用 `--secret-json '{}'`。

默认只更新落盘 secret 和 `secret_sha256`，不自动重启 instance。若希望立即生效：

```text
octobus instance update-secret \
  gitlab-test \
  --secret ./gitlab-test.secret.json \
  --restart
```

CLI 查看 secret 时必须脱敏常见敏感字段，例如 `password`、`token`、`secret`、`key`。

### 管理 instance 记录

```text
octobus instance list
octobus instance get gitlab-test
octobus instance update gitlab-test --name GitLabTestRenamed
octobus instance delete gitlab-test
```

删除 instance 时，daemon 会先停止对应子进程，删除 SQLite 中的 instance 记录，并清理引用它的 capset instance 和 method binding。instance workdir、配置和日志默认保留。

### 创建 capset

```text
octobus capset create dev --name DevAgent
octobus capset create local
```

未提供 `--name` 时，capset name 等于 capset id。新建 capset 默认 `enabled=true`。

### 管理 capset 记录

```text
octobus capset list
octobus capset get dev
octobus capset update dev --name DevAgentRenamed --description "developer tools" --enabled=false
octobus capset delete dev
```

`enabled=false` 的 capset 不再暴露 Connect RPC、gRPC、MCP 和 reflection 能力。删除 capset 会删除其 instance 和 method bindings，不影响 service、instance 本身。

### 管理 capset access token

```text
printf '%s' 'dev-secret' | octobus capset add-token dev local --name "Local dev" --token-stdin
octobus capset add-token dev ci --token-file ./dev.token
octobus capset list-tokens dev
octobus capset remove-token dev local
```

capset 未添加 token 时，公开资源保持开放访问。添加一个或多个 token 后，访问该 capset 的 Connect RPC、MCP、gRPC、reflection 和公开 OpenAPI 入口必须携带有效 token。HTTP 入口使用 `Authorization: Bearer <token>`；gRPC 和 reflection 使用 metadata `authorization: Bearer <token>`。token secret 只在创建时提交，服务端只保存校验 hash。

token 来源支持三种互斥形式：

```text
--token TOKEN
--token-file PATH
--token-stdin
```

`--token-file -` 等价于 `--token-stdin`。从文件或 stdin 读取 token 后会去掉首尾空白字符；空 token 是无效输入。文档和脚本示例优先使用 `--token-file` 或 `--token-stdin`，避免密钥进入 shell history 或进程参数。

### 管理 admin access token

```text
printf '%s' 'admin-secret' | octobus admin-token add local --name "Local admin" --token-stdin
octobus admin-token list
octobus admin-token get local
octobus admin-token delete local
octobus admin-token remove local
```

admin token 用于保护 admin API。`remove` 是 `delete` 的别名，二者删除同一个 admin token 记录。`admin-token add` 使用与 capset token 相同的 token 来源规则：`--token`、`--token-file` 和 `--token-stdin` 三选一。

### 添加 instance 并默认选择全部 methods

```text
octobus capset add-instance \
  dev \
  gitlab-test
```

`capset add-instance` 接收 capset id 和 instance id 两个位置参数，service 会从 instance 记录反查。该命令默认选择全部 methods，会在执行时展开当前 service 的所有 methods，形成静态 method 绑定。gRPC catalog 可包含 unary 和 streaming methods；Connect RPC、MCP 和 OpenAPI 只包含 unary methods。service 后续更新新增 method 时，不会自动暴露到已有 capset。

### 添加 instance 并显式选择 method

```text
octobus capset add-instance \
  security \
  gitlab-prod \
  --no-all-methods

octobus capset select-method \
  security \
  gitlab-prod \
  /gitlab.MergeRequestService/List \
  --mcp-tool gitlab_prod__list_merge_requests
```

可查看或撤销 capset binding：

```text
octobus capset list-instances security
octobus capset list-methods security
octobus capset unselect-method security gitlab-prod /gitlab.MergeRequestService/List
octobus capset remove-instance security gitlab-prod
```

Connect RPC catalog/OpenAPI 输出 `/capsets/{capset_id}/connect/{instance_id}/{full_service}/{method}`。MCP tool name 默认生成为 `{service}__{instance}__{method}`；若冲突，命令失败并要求用户提供 `--mcp-tool`。

### 查看 catalog

```text
octobus catalog dev
octobus catalog dev --all --json
octobus catalog dev --connect --md
octobus catalog dev --openapi-json
octobus catalog dev --openapi-yaml
```

默认输出 gRPC catalog JSON。`--grpc`、`--mcp`、`--connect` 可组合选择协议，`--all` 选择全部协议。OpenAPI 输出仅描述 Connect RPC schema。

### 查看 access log

```text
octobus logs
octobus logs --capset dev
octobus logs --capset dev --instance calculator-test
octobus logs --service calculator --limit 1000
octobus logs --capset dev --tail 50
octobus logs --capset dev --tail 0 --follow
```

`octobus logs` 调用 Admin API 的 `GET /admin/v1/logs/access`，原样输出
`application/x-ndjson`。过滤参数按 exact match 工作，`capset`、`instance` 和
`service` 可以组合使用。

`--limit` 表示最多返回多少条匹配记录，默认 200，`--limit 0` 返回全部匹配记录。
`--tail` 表示返回最后 N 条匹配记录，`--tail 0` 在 follow 模式下只看新记录。
`--follow` / `-f` 以流式方式持续读取新匹配记录。`--limit` 与 `--tail` 互斥，
`--limit` 与 `--follow` 互斥；负数参数会在 CLI 发请求前被拒绝。

## 帮助文本和错误信息

帮助文本展示最终命令形态，位置参数使用资源术语：

```text
Usage:
  octobus instance restart INSTANCE [flags]
```

通用 CRUD 帮助文本使用明确资源展示名，例如：

```text
Get an instance record
Delete an admin token record
```

参数缺失错误使用对应资源术语，例如 `service id is required`、`instance id is required`、
`capset id is required`、`method is required`、`token id is required`。token 来源缺失时，
错误信息提示可用来源：`token source is required; use --token, --token-file, or --token-stdin`。
