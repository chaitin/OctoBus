# Multi-Service NPM Package Design

## 定位

OctoBus 支持一个 npm distribution package 中包含多个 service root。archive、Git
source、本地目录和 npm package 都保留完整 distribution package，只通过
`//service-dir` 选择其中的 service root。

- 仓库根目录作为唯一 npm package 发布。
- 仓库内每个子目录通过自己的 `service.json` 声明一个 service。
- `octobus service import` 可以从同一个 npm package 中选择某个 service root。
- service 可执行入口默认提供业务 CLI，OctoBus runtime 命令通过统一前缀进入。

## 核心模型

新模型区分两个概念：

- distribution package root：npm 安装、发布、依赖、版本和 `bin` 的根目录。
- service root：distribution package 内包含 `service.json` 的目录。

`service.json` 是 service root 的标识。子目录是否存在 `package.json` 不决定它
是不是 service package。

示例结构：

```text
platform-services/
  package.json
  bin/
    hanqing-ticket.js
  chaitin__hanqing-ticket/
    service.json
    proto/
    config.schema.json
    secret.schema.json
    src/
```

根 `package.json` 负责发布整个包，并暴露 service 入口：

```json
{
  "name": "@scope/platform-services",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "hanqing-ticket": "bin/hanqing-ticket.js"
  },
  "files": [
    "bin",
    "chaitin__hanqing-ticket"
  ],
  "dependencies": {
    "@chaitin-ai/octobus-sdk": "^0.6.0"
  }
}
```

`chaitin__hanqing-ticket/service.json` 中的 `name` 必须和根 `package.json bin` 的 key 匹配：

```json
{
  "schema": "chaitin.octobus.service.v1",
  "name": "hanqing-ticket",
  "proto": {
    "roots": ["proto"],
    "files": ["proto/hanqing_ticket.proto"]
  }
}
```

命名边界：

- service root 目录继续使用 `vendor__product_version` 结构，允许下划线分隔 vendor、
  product 和 version 信息。
- `service.json.name` 和根 `package.json bin` command 保持 lower-kebab，只允许小写字母、
  数字和短横线，不允许 `_` 或 `.`。
- 上游真实版本和型号保留在目录、`displayName` 和 `description` 中，例如 `V4.6.10`、
  `USG6000E` 或 `HTTP_X`。
- 命令名中的版本号使用短横线分隔，例如 `dptech-fw-v4-6-10`，避免在 shell、npm bin、
  URL path 和 MCP tool 前缀中引入点号歧义。

## Source 语法

所有 source 类型都支持可选的 `//service-dir` 后缀：

```text
octobus service import hanqing npm:@scope/platform-services@1.0.0//chaitin__hanqing-ticket
octobus service import hanqing ./platform-services//chaitin__hanqing-ticket
octobus service import hanqing ./platform-services-1.0.0.tgz//chaitin__hanqing-ticket
octobus service import hanqing ./platform-services.zip//chaitin__hanqing-ticket
octobus service import hanqing https://github.com/acme/platform-services.git//chaitin__hanqing-ticket@v1.0.0
```

需要一次导入 distribution package 中所有 service root 时，使用 recursive 模式：

```text
octobus service import --recursive npm:@chaitin-ai/octobus-tentacles
octobus service import --recursive ./platform-services//chaitin__subset
```

规则：

- `//service-dir` 选择 distribution artifact 内的 service root。
- recursive 模式中 `//service-dir` 表示递归发现的 scan root；该 scan root 下发现到的
  每个 `service.json` 都会按其 `name` 导入为独立 service。
- 缺省 `//service-dir` 时，distribution package root 本身就是 service root。
- service dir 必须是相对路径，不允许绝对路径、空路径或 `..`。
- service dir 不裁剪 artifact，也不改变 dependency install root。
- Git source 保留 `@ref` 语义；service dir 和 ref 的解析必须避免把 scoped npm package
  中的 `/` 或 version 中的 `@` 当成 service dir/ref 分隔符。

## Import 行为

导入流程以 distribution package root 为存储和运行基础：

1. 获取 source artifact，并解包到 staging package root。
2. 解析可选 `service_root`；没有指定时为 `"."`。
3. 从 `package_root/service_root/service.json` 读取 manifest。
4. 使用 service root 解析 proto roots/files、config schema 和 secret schema。
5. 从根 `package.json bin` 查找 `service.json.name` 对应的 entry。
6. 校验 entry target 是 distribution package root 内存在的普通文件。
7. runtime dir 保存完整 distribution package。
8. descriptor 编译以 service root 为 package dir。

导入结果需要保存：

- `node_entry`：根 package 相对路径，例如 `bin/hanqing-ticket.js`。
- `service_root`：根 package 相对路径，例如 `chaitin__hanqing-ticket`；根 service 使用 `"."`。
- `package_source`：保留规范化后的 source 字符串，包含 `//service-dir`。

recursive import 对每个 discovered service 写入一条现有 service 记录，不新增 store schema；
导入前会先校验本次发现到的所有 manifest、service id、bin、schema 和 descriptor，校验失败
时不提交任何 service。

recursive import 的发现规则是当前契约的一部分：

- scan root 缺省为 package root；`source//some-dir` 只限制递归发现范围。
- 含 `service.json` 的目录是 service root，发现后不再继续深入该目录。
- 扫描跳过 `node_modules`、`.git` 和点号开头的隐藏目录。
- 结果按 package root 相对 service root 稳定排序。
- scan root 不存在、不是目录、非法或没有发现任何 service 时，导入失败。

每个 recursive 导入项使用自己的 service root 编译 descriptor 和校验 schema，但共享同一次
source 获取、build/package 准备和 runtime dependency preparation。提交前可发现或可校验
错误保持零提交；提交阶段的单个 service 文件系统/SQLite 错误只保证该 service 的既有
rollback 语义，首版不提供跨多个 service 的强事务回滚。

admin import endpoint 在 recursive 模式下返回 `services`、`service_count`、
`restarted_instances` 和 `restart_errors`。导入成功后，daemon 会按 service id 聚合
enabled long-running instances 的重启结果；任一重启失败时返回 HTTP 409，并带
`status: "degraded"`。on-demand service 不执行持久进程重启。

依赖安装只以根 `package.json` 为准。子目录 `package.json` 不参与 import/runtime
依赖解析。

## Runtime 协议

service bin 默认进入业务 CLI。OctoBus runtime 命令统一通过 `--runtime` 前缀进入：

```text
hanqing-ticket list-tickets --data-json '{}' --secret secret.json
hanqing-ticket --runtime inspect
hanqing-ticket --runtime dev --port 0
hanqing-ticket --runtime serve --host 127.0.0.1 --port 50051
hanqing-ticket --runtime invoke --method pkg.Service/Method ...
```

OctoBus supervisor 启动 long-running instance 时调用：

```text
<runtime>/<node_entry> --runtime serve ...
```

Gateway 调用 on-demand instance 时调用：

```text
<runtime>/<node_entry> --runtime invoke ...
```

进程环境变量：

- `OCTOBUS_PACKAGE_DIR=<runtime>/<service_root>`
- `OCTOBUS_SERVICE_ID=<service_id>`
- `OCTOBUS_INSTANCE_ID=<instance_id>`
- `OCTOBUS_DESCRIPTOR_PATH=<descriptor.protoset>`
- `OCTOBUS_DESCRIPTOR_SHA256=<sha256>`

SDK 通过 `OCTOBUS_PACKAGE_DIR` 读取 service root 下的 `service.json`，因此 runtime
dir 可以保留完整 distribution package。

## SDK 行为

`runServiceMain(service)` 的默认行为改为业务 CLI：

- 未带 `--runtime`：把 argv 当作业务 CLI method command。
- 带 `--runtime`：去掉该前缀后交给 runtime parser，支持 `serve`、`invoke`、`dev`、
  `inspect`、`client-stub`、`client-package` 等命令。

Bootstrap 生成的新 service entry 必须符合该协议。

SDK 的 `findPackageRoot` 继续支持：

- `OCTOBUS_PACKAGE_DIR` 显式指定 service root。
- 从入口文件或 cwd 向上查找 `service.json`。

## 多服务分发包组织

多服务分发包根目录负责发布所有 service：

- 根 `files` 包含每个 service root、根 `bin/` 和运行所需共享文件。
- 根 `bin` 为每个 service 暴露一个命令，命令名等于对应 `service.json.name`。
- 根 dependencies 声明 SDK 和共享 runtime dependencies。
- 根 scripts 可以统一驱动各 service 的 validate、test 和 pack check。
- 子目录 `package.json` 不参与 OctoBus import/runtime 契约，只能作为本地开发辅助。

## 根包 Dispatcher

多服务根包可以同时暴露每个 service 命令和一个默认 dispatcher 命令。这样两种使用方式
都成立：

```bash
npx --yes --package . <service> --help
npx . <service> --help
```

根包 `package.json bin` 示例：

```json
{
  "bin": {
    "octobus-tentacles": "bin/octobus-tentacles.js",
    "service-a": "bin/service-a.js",
    "service-b": "bin/service-b.js"
  }
}
```

service wrapper 需要把真实 service package 入口传给 SDK：

```js
#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../service-a/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../service-a/bin/service-a.js", import.meta.url)),
});
```

`entryFile` 让 SDK 从真实 service package bin 文件向上查找 `service.json`，不会改变
用户当前工作目录。因此用户传入的相对路径参数仍按执行命令时的目录解析。

默认 dispatcher 根据第一个参数选择 service，并把剩余参数透传给对应 service
entry。dispatcher 自身只负责根包 help、未知 service 报错和 service 选择，不拦截
具体 service 的业务参数。

根包 dispatcher 直接依赖的 CLI 框架必须声明为根包直接 dependency；不要依赖 SDK 的
transitive dependency。根包和 service package 的 `bin/*.js` 文件都必须保持可执行。

## 测试要求

OctoBus 侧：

- 无 `//service-dir` 时仍以根目录作为 service root。
- npm/local/tgz/zip/git source 带 `//service-dir` 时能导入子目录 service。
- 非法 service dir 被拒绝：空路径、绝对路径、`..`、不存在 `service.json`。
- 根 bin 缺少 `service.json.name` 或 target 不存在时导入失败。
- long-running 和 on-demand runtime 调用都包含 `--runtime`。
- `OCTOBUS_PACKAGE_DIR` 指向 `<runtime>/<service_root>`。

SDK 侧：

- service entry 默认进入业务 CLI。
- `--runtime inspect/dev/serve/invoke` 进入 runtime 命令。
- `OCTOBUS_PACKAGE_DIR` 指向子目录时正常加载 manifest、proto 和 schema。

多服务分发包侧：

- 根 `npm pack --dry-run` 包含根入口和 service root。
- 安装后 `hanqing-ticket --help` 显示业务 CLI。
- `hanqing-ticket --runtime inspect` 可以读取 `chaitin__hanqing-ticket/service.json`。
