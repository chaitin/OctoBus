# Service Package Contract

## 定位

service package 是 OctoBus 导入、保存、启动和恢复 service 的交付单元。

```text
service = package artifact + service.json + package.json bin + proto contract + gRPC implementation
```

OctoBus 的 service package 契约是 npm-compatible package 契约。OctoBus 只定义接口暴露方式、打包方式、package contract 和启动协议，不限制业务代码内部如何访问上游系统。

## Package 来源

`octobus service import` 支持以下来源：

- public / private npm registry package，使用 `npm:` 前缀。
- local package directory。
- local `.tgz` / `.tar.gz` tarball。
- local `.zip` archive。
- HTTPS Git repository URL。

示例：

```text
octobus service import gitlab npm:@vendor/gitlab-wrapper@1.2.3
octobus service import gitlab ./gitlab-wrapper
octobus service import gitlab ./gitlab-wrapper-1.2.3.tgz
octobus service import gitlab ./gitlab-wrapper.zip
octobus service import gitlab https://github.com/acme/services.git//gitlab-wrapper@v1.2.3
octobus service import gitlab https://gitlab.com/group/platform-services@latest
```

所有 source 类型都支持可选 `//service-dir` 后缀，用来选择 distribution package 内的 service root：

```text
octobus service import gitlab npm:@vendor/platform-services@1.2.3//gitlab-wrapper
octobus service import gitlab ./platform-services//gitlab-wrapper
octobus service import gitlab ./platform-services-1.2.3.tgz//gitlab-wrapper
octobus service import gitlab ./platform-services.zip//gitlab-wrapper
octobus service import gitlab https://github.com/acme/services.git//gitlab-wrapper@v1.2.3
```

缺省 `//service-dir` 时，distribution package root 本身就是 service root。

HTTPS Git source 使用以下格式：

```text
https://[user[:password]@]host/path/to/repo[.git][//service-dir][@ref]
```

规则：

- `//service-dir` 选择归档后的 distribution package 内 service root；Git archive 仍归档仓库根目录，不裁剪 artifact 或改变 dependency install root。
- `@ref` 可以是 branch、tag、commit 或 `latest`；缺省等价于 `latest`。
- `latest` 优先解析到最高 stable SemVer tag；没有 stable SemVer tag 时回退到远端默认分支 `HEAD`。
- OctoBus 将 ref 解析为完整 commit SHA，并记录为 `package_version`。
- URL 中的 import-time credential 不得以明文写入 SQLite、admin API 或 CLI 输出。
- Git import 使用 `git archive` 归档选定目录；不包含 `.git`、未跟踪文件、忽略文件、未物化的 LFS 内容或 submodule 内容。

## Artifact / Package Dir / Runtime Dir

OctoBus 使用三个目录或文件描述 package 的生命周期阶段。

`package artifact` 是 import 时固定下来的包文件。来源到 artifact 的规则：

```text
npm registry package -> npm pack -> npm-packed .tgz
local directory      -> npm pack -> npm-packed .tgz
local .tgz/.tar.gz   -> copy -> package.tgz
local .zip           -> copy -> package.zip
HTTPS Git repo       -> git archive to source dir -> npm pack -> npm-packed .tgz
```

local directory 和 HTTPS Git source 会按 `--build=auto|always|never` 决定是否先安装 dev dependencies 并执行构建；最终保存的 artifact 仍是 `npm pack` 产物。tarball 和 zip source 被视为已经发布的 artifact，不重新构建。

OctoBus 对 package artifact 计算 sha256，并把 hash 写入 SQLite。

`package dir` 是最终 artifact 解包后的 package 内容目录。OctoBus 从 `package_dir/service_root/service.json` 读取 manifest，并从 service root 解析 proto 文件和可选 config / secret schema。根 service 的 `service_root` 为 `"."`。

`runtime dir` 是可运行目录。OctoBus 先把 package dir 复制到 runtime dir，再准备 production dependencies。instance 启动和 daemon 恢复阶段只使用 runtime dir，不访问远程 registry，也不执行 dependency install。

示例：

```text
{data_dir}/artifacts/services/gitlab/
  gitlab-wrapper-1.2.3.tgz
  package/
    package.json
    gitlab-wrapper/
      service.json
      proto/
  runtime/
    package.json
    gitlab-wrapper/
      service.json
      proto/
    node_modules/
  descriptor.protoset
```

单 service package 没有 `//service-dir` 时，`service.json` 和 proto 通常直接位于根目录：

```text
{data_dir}/artifacts/services/gitlab/
  package/
    service.json
    package.json
    proto/
    bin/
  runtime/
    service.json
    package.json
    proto/
    bin/
    node_modules/
```

## service.json

`service.json` 是 import 阶段的 manifest。每个 service root 必须提供 `service.json`。单个 distribution package 可以包含多个 service root；导入时由 source 的 `//service-dir` 选择其中一个。

也可以使用 recursive import 一次导入 distribution package 中发现到的多个 service root：

```text
octobus service import --recursive npm:@chaitin-ai/octobus-tentacles
octobus service import --recursive ./platform-services//subset
```

recursive 模式不接受用户指定 service id，导入的 service id 来自各自 `service.json.name`；
`source//some-dir` 表示递归发现的 scan root，不裁剪 artifact，也不改变依赖安装根目录。

示例：

```json
{
  "schema": "chaitin.octobus.service.v1",
  "name": "gitlab-wrapper",
  "displayName": "GitLab Wrapper",
  "description": "GitLab API wrapper service",
  "runtime": {
    "mode": "long-running"
  },
  "proto": {
    "roots": ["proto"],
    "files": ["proto/gitlab.proto"]
  },
  "configSchema": "config.schema.json",
  "secretSchema": "secret.schema.json"
}
```

必要字段：

- `schema`
- `name`
- `proto.roots`
- `proto.files`

字段说明：

- `schema` 必须等于 `chaitin.octobus.service.v1`。
- `name` 是 package 内声明的 service package 名称，不要求等于 npm package name。单 service import 时，OctoBus service id 仍由 `octobus service import SERVICE SOURCE` 的 `SERVICE` 位置参数指定；recursive import 时，导入的 service id 来自各自 `service.json.name`。多 `bin` package 中，`name` 必须匹配根 `package.json bin` object 的 key。
- `displayName` 和 `description` 是可选展示信息。
- `runtime.mode` 可选，支持 `long-running` 和 `on-demand`，缺省等价于 `long-running`。
- `proto.roots` 是 proto import root 列表。
- `proto.files` 是入口 proto 文件列表。
- `configSchema` 是可选 JSON Schema 文件路径，用于校验 instance config。
- `secretSchema` 是可选 JSON Schema 文件路径，用于校验 instance secret。

运行模式行为：

- 未声明 `runtime`、声明为 `null`，或声明了 `runtime` 但没有 `mode` 时，OctoBus 都按 `long-running` 处理。
- `long-running` service 的 instance 创建或启动后会拉起常驻 Node.js gRPC 子进程；daemon 重启时会恢复 `enabled=true` 的 long-running instances。
- `on-demand` service 的 instance 不预启动、不保存 PID 或监听地址；请求到达时，OctoBus 为该请求启动一次短生命周期 `invoke` 子进程。
- `on-demand` instance 会保持 enabled/running 的逻辑状态，但不支持 `start`、`stop`、`restart` 或带 `--restart` 的配置/密钥更新。

校验规则：

- `service.json` 不允许声明顶层 `id`；service id 由 `octobus service import SERVICE SOURCE` 的 `SERVICE` 位置参数指定。
- `service.json` 不允许声明 `entry`；runtime entry 只从 `package.json bin` 解析。
- package 内路径必须是相对路径，必须留在当前 service root 内，且不允许包含 `..`。
- `configSchema` 若存在，必须指向 service root 内普通文件。
- `secretSchema` 若存在，必须指向 service root 内普通文件。

首次导入时，service 展示名按 `--name`、`service.json.displayName`、`service.json.name` 的顺序选择。再次导入同一个 service id 时，若没有显式传 `--name`，保留已有展示名；若传了 `--name`，覆盖已有展示名。

## package.json Bin

根 `package.json bin` 是 runtime entry 的权威来源。导入成功后，解析出的 target 写入 SQLite 的 `node_entry` 字段。子目录 `package.json` 不参与 OctoBus import/runtime 依赖解析或 entry 解析。

规则：

- package 必须提供 `package.json`。
- `bin` 可以是字符串，也可以是 object。
- 字符串或单 entry object 可用于单 service package。
- 多 entry object 可用于 multi-service package；OctoBus 用 `service.json.name` 查找同名 bin entry。
- `bin` target 必须是 package 内相对路径。
- `bin` target 必须在最终 artifact 中存在。
- `bin` target 启动时从 runtime dir 内按路径执行，不使用 shell 查找，也不回退到 `PATH`。

启动时的实际 entry：

```text
{data_dir}/artifacts/services/{service_id}/runtime/<node_entry>
```

## Repository And Naming Governance

OctoBus 本身只要求 service root 是 source 中可解析的相对路径；为了让多服务分发包
长期可读、可自动校验，仓库内服务包采用更严格的目录名和命令名规则。

仓库归属：

- 私有或组织专用的系统、平台、工具和业务数据服务放在私有分发包。
- 可公开维护的产品集成、外部公司、外部 SaaS、外部设备和外部开放平台集成放在
  `services` 分发包。
- 示例或模板不放入生产服务包分发包；确需保留时放到示例区域单独维护。

根 package name：

| 分发包 | 根 package name |
| --- | --- |
| `tentacle` | `@chaitin-ai/octobus-tentacles-internal` |
| `octobus/services` | `@chaitin-ai/octobus-tentacles` |

服务根目录名使用：

```text
<company>__<service>(_<version>)
```

目录名正则：

```text
^[a-z0-9][a-z0-9-]*__[a-z0-9][a-z0-9-]*(?:_[a-z0-9][a-z0-9-]*)?$
```

规则：

- 目录名全小写。
- `__` 分隔 company 和 service。
- `_` 分隔可选 version。
- `-` 用于片段内部分词。
- 目录名允许数字，适合保留产品型号或上游版本。
- 不使用大写字母、空格、驼峰、展示名或单下划线分词。

`service.json.name` 是命令名，必须与分发包根 `package.json bin` key 一致。

命令名正则：

```text
^[a-z0-9]+(?:-[a-z0-9]+)*$
```

规则：

- 只能使用小写英文字母、数字和短横线。
- 不允许下划线、点号、空格、大写字母或连续分隔符。
- 命令名应短小、稳定、适合作为 CLI 命令、npm bin key、dispatcher key、URL path
  片段和 MCP tool 前缀。
- 当目录名包含数字版本时，命令名保留数字并用短横线分隔版本段。
- 目录名继续允许 `vendor__product_version` 结构，用于承载来源、产品线和上游版本；
  这不代表 `service.json.name` 可以使用下划线。
- `displayName` 和 `description` 保留真实上游写法，例如 `V4.6.10`、`USG6000E`
  或 `HTTP_X`，不要为了匹配命令名而改写展示文本。

示例：

| 服务根目录 | `service.json.name` / bin key |
| --- | --- |
| `chaitin__hanqing-ticket` | `hanqing-ticket` |
| `chaitin__crm` | `crm` |
| `chaitin__safeline-waf` | `safeline-waf` |
| `fortinet__fw` | `fortinet-fw` |
| `dptech__fw_v4-6-10` | `dptech-fw-v4-6-10` |
| `hillstone__fw_v5-5-r10` | `hillstone-fw-v5-5-r10` |

版本号在目录名中保留上游产品版本，但转换成小写短横线形式：

| 原始形式 | 目录版本 |
| --- | --- |
| `V36` | `v3-6` |
| `V612` | `v6-1-2` |
| `V4610` | `v4-6-10` |
| `V8045` | `v8-0-45` |
| `V251` | `v2-5-1` |
| `V55R10` | `v5-5-r10` |
| `V45R90F06` | `v4-5-r90-f06` |
| `v5329` | `v5-3-29` |

如果数字是产品型号而非行为版本，应留在 service 片段中，例如 `usg6000e`、`2u`、
`5u`、`k01` 或 `secgate3600`。

仓库内 JavaScript service package 依赖基线是：

```json
{
  "dependencies": {
    "@chaitin-ai/octobus-sdk": "^0.6.0"
  }
}
```

每个 service root 应提供 `service.json`、proto、实现代码、测试、README，并在有非敏感
配置时提供 `config.schema.json`，有凭证、令牌、密码、API key、私钥等敏感信息时提供
`secret.schema.json`。

## Build Policy

import 支持构建策略：

```text
octobus service import --build=auto|always|never ...
```

默认值为 `auto`。

策略含义：

- `auto`：自动判断 package 是否需要构建。
- `always`：即使 `bin` target 已存在，也执行构建。
- `never`：不执行构建；`bin` target 必须已经存在。

构建只适用于 local directory 和 HTTPS Git source。npm registry package、local tarball 和 local zip 被视为已经发布的 artifact；对这些来源传 `--build=always` 会失败。

local directory 和 HTTPS Git source 的处理规则：

- 若 `--build=never`，`bin` target 必须已存在，然后执行 `npm pack`。
- 若 `--build=auto` 且 `bin` target 已存在，按 built package 处理并执行 `npm pack`。
- 若 `--build=auto` 且 `bin` target 不存在，但存在 `scripts.prepack`、`scripts.prepare` 或 `scripts.build`，按 source package 处理。
- 若 `--build=auto` 且 `bin` target 不存在，也没有可用构建脚本，import 失败。
- 若 `--build=always`，必须存在 `scripts.prepack`、`scripts.prepare` 或 `scripts.build`。

source package 构建流程在 staging 目录中执行：

1. 若存在 `package-lock.json` 或 `npm-shrinkwrap.json`，执行 `npm ci`。
2. 否则执行 `npm install`。
3. 构建阶段安装 dev dependencies。
4. 若传入 `--offline`，构建阶段安装依赖也使用 npm offline 模式。
5. 若存在 `prepack` 或 `prepare`，执行 `npm pack`，由 npm lifecycle script 负责产物构建。
6. 若没有 `prepack` / `prepare` 但存在 `build`，先执行 `npm run build`，再执行 `npm pack`。
7. 解包 `npm pack` 产生的 tarball，验证 `service.json`、`package.json bin`、proto 和 config / secret schema。

最终保存的 package artifact 是 npm-packed built artifact，内容选择遵循 npm 标准 `files` / `.npmignore` 规则。

## Runtime Dependencies

OctoBus 只在 import 阶段准备 runtime dependencies。

规则：

- 若传入 `--reinstall`，先删除 runtime dir 中的 `node_modules`。
- 若 runtime dir 没有 `package.json`，跳过 npm install。
- 若没有传 `--reinstall`，且 `package.json.dependencies` 中的直接依赖都已存在于 `node_modules`，跳过 npm install。
- 若存在 `package-lock.json` 或 `npm-shrinkwrap.json`，执行 `npm ci --omit=dev`。
- 否则执行 `npm install --omit=dev`。
- 若传入 `--offline`，追加 `--offline`。

local directory 和 HTTPS Git source 若声明了 `file:` dependencies，OctoBus 会在 source/build 目录安装依赖，并把得到的 `node_modules` 携带到 runtime dir。这样 package 可以依赖包内 tarball，例如：

```json
{
  "dependencies": {
    "private-helper": "file:vendor/private-helper-1.0.0.tgz"
  }
}
```

如果 service package 使用 npm package 的 `files` 字段控制发布内容，必须显式包含本地依赖所需文件，例如 `vendor/*.tgz`。lockfile 中记录的 `file:` 路径也必须仍然指向 package 内路径，例如 `file:vendor/private-helper-1.0.0.tgz`。

不要把依赖写成 package 目录外路径，例如 `file:../private-helper-1.0.0.tgz`。这种写法在开发机上可能可用，但 package 被 `npm pack`、复制或导入后，相对路径通常会失效。

对于 tarball 或 zip source，`file:` dependency 指向的文件必须已经包含在 artifact 中；否则 runtime dependency install 不会尝试从 package 外部路径补齐。

## SDK npmjs 分发

`@chaitin-ai/octobus-sdk` 通过 npmjs 分发。示例 service package 直接依赖发布后的 semver 版本：

```json
{
  "dependencies": {
    "@chaitin-ai/octobus-sdk": "^0.6.0"
  }
}
```

使用者可直接从 npmjs 安装 SDK，不需要配置私有 registry：

```bash
npm install @chaitin-ai/octobus-sdk
```

SDK 发布由 `sdk-v<version>` tag push 构建触发，tag 版本必须和 `sdk/package.json.version` 完全一致。发布 job 使用 GitHub secret `NPM_TOKEN` 认证到 npmjs。

SDK 发布要求：

- 先安装 SDK 依赖。
- 运行 SDK 测试。
- 构建 `dist` 并运行 `npm pack --dry-run`。
- 通过 `npm publish --access public --provenance` 发布到 npmjs。
- 发布 tag、npm package 版本和对应 commit 应保持可追溯。

## Config / Secret

instance config 和 secret 分别写入 instance workdir：

```text
{data_dir}/instances/{instance_id}/config.json
{data_dir}/instances/{instance_id}/secret.json
```

文件权限为 `0600`。未提供 config 或 secret 时，默认写入 `{}`。

行为：

- config 会写入 `config.json` 并记录 `config_sha256`。
- secret 会写入 `secret.json` 并记录 `secret_sha256`。
- 若 service 提供 `configSchema`，创建 instance 和更新 config 时都会校验 JSON Schema。
- 若 service 提供 `secretSchema`，创建 instance 和更新 secret 时都会校验 JSON Schema。
- update-config 默认只更新落盘 config 和 SQLite，不自动重启 instance。
- update-secret 默认只更新落盘 secret 和 SQLite，不自动重启 instance。
- `update-config --restart` 和 `update-secret --restart` 会重启 long-running instance；on-demand instance 不支持 restart 控制。

CLI / admin 输出 config 或 secret 时按字段名启发式脱敏常见敏感字段，例如 `password`、`token`、`secret`、`key`。

## Descriptor 编译

OctoBus 导入 package 后，由 Go 侧读取 service root 中的 proto 文件并编译 descriptor，记录 hash 和 version。

规则：

- 不直接信任 package 自报的 method 列表。
- method metadata 以 Go 侧编译 descriptor 的结果为准。
- proto 文件中允许包含 streaming method；long-running service 的 gRPC 网关可以暴露和调用 streaming methods。
- Connect RPC、MCP、OpenAPI、on-demand `--runtime invoke` 和 SDK 业务 CLI 只支持 unary methods。
- `service.json` 不提供 method metadata / description override。

## Long-Running 启动协议

`runtime.mode = "long-running"` 的 service package 会被 OctoBus 以子进程方式启动，并监听指定 host/port。

命令形态：

```text
<runtime>/<node_entry> --runtime serve \
  --host 127.0.0.1 \
  --port 41001 \
  --config /path/to/config.json \
  --secret /path/to/secret.json \
  --workdir /path/to/instances/gitlab-test \
  --service gitlab \
  --instance gitlab-test
```

其中：

- `--host` 是监听地址。
- `--port` 是监听端口。
- `--config` 是 instance config JSON。
- `--secret` 是 instance secret JSON。
- `--workdir` 是 instance workdir。
- `--service` 是 OctoBus service id。
- `--instance` 是 OctoBus instance id。

OctoBus 启动子进程时把 cwd 设置为 instance workdir。这样第三方 package 使用相对路径写入运行状态时，会自然落到该 instance 的目录中。

运行时环境变量：

```text
OCTOBUS_SERVICE_ID=<service_id>
OCTOBUS_INSTANCE_ID=<instance_id>
OCTOBUS_PACKAGE_DIR=<runtime>/<service_root>
OCTOBUS_DESCRIPTOR_PATH=<descriptor.protoset>
OCTOBUS_DESCRIPTOR_SHA256=<sha256>
```

package 必须支持 gRPC health check。SDK 默认注册 `grpc.health.v1.Health`，OctoBus ready 判断使用 overall health：

```text
grpc.health.v1.Health/Check service=""
```

## On-Demand 启动协议

`runtime.mode = "on-demand"` 的 package 不维持常驻进程。OctoBus 每次调用时启动一次 service entry，并通过 `--runtime invoke` 进入 runtime 命令。

命令形态：

```text
<runtime>/<node_entry> --runtime invoke \
  --method gitlab.MergeRequestService/List \
  --config /path/to/config.json \
  --secret /path/to/secret.json \
  --metadata /path/to/metadata.json \
  --workdir /path/to/instances/gitlab-test \
  --service gitlab \
  --instance gitlab-test
```

OctoBus 会把 protobuf wire-format 请求写入 stdin，期望 stdout 只输出 protobuf wire-format 响应。on-demand 和 long-running 使用同一个 package artifact、runtime dir、node entry、config、secret 和 descriptor。`@chaitin-ai/octobus-sdk` 的 `runServiceMain(service)` 未带 `--runtime` 时进入业务 CLI；带 `--runtime` 时才解析 `serve`、`invoke`、`dev`、`inspect`、`client-stub` 和 `client-package` 等 runtime/tooling 命令。

## Inspect 协议

导入主路径只读取 service root 下的 `service.json`、proto 和 config / secret schema，以及根 `package.json bin`，不执行 `<node_entry> --runtime inspect --json`。

`inspect` 是 SDK/package 可以提供的开发调试能力，不是 import 的必需步骤。

## Service 更新语义

service 不维护多 revision。对已有 service id 再次执行 import，就是更新该 service 当前版本。

流程：

1. 在 staging 目录获取 package source。
2. 按来源和 `--build=auto|always|never` 生成或复制 package artifact。
3. 计算 artifact hash，解包最终 artifact。
4. 从 service root 读取 manifest，校验根 `package.json bin`、proto、schema 和 package 内路径边界。
5. 准备 runtime dir，编译 descriptor。
6. 在 staging 中组装新的 artifact、package dir、runtime dir 和 descriptor。
7. 通过目录 rename 提交 `{data_dir}/artifacts/services/{service_id}`；若 SQLite upsert 失败，回滚旧目录。
8. 更新 SQLite service 当前版本元数据。
9. admin import 成功后，重启该 service 的所有 enabled long-running instances。

on-demand service update 不执行持久进程重启。

若 enabled instance 重启失败，admin import 返回 HTTP 409，并在响应中包含 `status: "degraded"`、`restarted_instances` 和 `restart_errors`。

disabled instance 不会在 update 时被拉起；它们下次启动时使用 service 当前版本。

service update 不自动重写 capset method binding。如果新 descriptor 中删除了已绑定 method，或该 method 不再是 unary，该 binding 会变成无效 binding。catalog / MCP tools/list 不再暴露无效 binding；直接调用返回 `NOT_FOUND` 或 `UNIMPLEMENTED`。

需要回滚时，用户重新导入旧 package artifact。

## 安全边界

service package 是 trusted code。导入和运行第三方 npm package 等价于在本机执行第三方代码。

需要注意：

- runtime install 会执行 npm install lifecycle scripts。
- source package build 会执行 npm install、npm lifecycle scripts 和 build scripts。
- instance 启动会执行 `package.json bin` target。
- OctoBus 当前目标不对 Node service package 做沙箱隔离。

因此，用户只应导入可信来源 package。需要沙箱隔离时，应作为 runtime isolation 能力单独设计，而不是通过 package contract 隐式保证。
