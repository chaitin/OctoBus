## ctyun-accessone

天翼云 AccessOne（ESA）CTAPI 服务包，基于 OctoBus service 形态封装 10 个 RPC（8 读 + 2 写），覆盖域名管理、防护规则引擎、WAF、访问控制、资源包、IPv6 检测 6 个产品域。

### 服务概览

| 项目 | 内容 |
|---|---|
| 用途 | AccessOne 配置查询 + 访问控制规则管理 |
| RPC 数 | 10 个（8 读 + 2 写） |
| 产品域 | 6 个（域名管理 / 防护规则引擎 / WAF / 访问控制 / 资源包 / IPv6 检测） |
| 输出形式 | CTAPI 原始 JSON 透传（`http_status` + `http_body`） |
| 鉴权方式 | EOP HMAC-SHA256 四步链式签名（AK/SK） |
| 运行模式 | `long-running` |
| 默认网关 | `accessone-global.ctapi.ctyun.cn` |
| 依赖 | `@chaitin-ai/octobus-sdk ^0.5.0` |
| 测试结果 | 默认单测 `46 pass / 0 fail / 1 skip`；`RUN_INTEGRATION=1` 为 `47 pass / 0 fail / 0 skip` |
| 真机联调 | ✅ 2026-06-27 已通过当前分支真实 OctoBus gRPC 读写验证（含写后回滚） |

### 命令速查

更多面向终端操作者的逐步执行说明，见：`services/ctyun__accessone/MANUAL-INVOKE.md`

```bash
cd /Users/lishengming/workspace/OctoBus/services
octobus-tentacles ctyun-accessone --help
ctyun-accessone --help
node --test ctyun__accessone/test/ctyun-accessone.test.js
RUN_INTEGRATION=1 node --test ctyun__accessone/test/ctyun-accessone.test.js
npm run validate -- --service-dir ctyun__accessone
```

### 接口清单

| RPC | 类型 | HTTP 方法 | 路径 | 产品域 | 说明 |
|---|---|---|---|---|---|
| `QueryDomainList` | 读 | GET | `/ctapi/v2/domain/query` | 域名管理 | 查询域名列表 |
| `QueryServiceDetail` | 读 | POST | `/ctapi/v1/sevice_detail` | 域名管理 | 查询服务详情 |
| `QueryDomainRuleAct` | 读 | POST | `/ctapi/v1/domainRule/getDomainRuleAct` | 防护规则引擎 | 查询域名规则状态 |
| `QueryDomainRuleConfig` | 读 | POST | `/ctapi/v1/domainRule/get` | 防护规则引擎 | 查询域名规则配置 |
| `QueryWafConfig` | 读 | POST | `/ctapi/v1/scdn/domain/wafConfigQuery` | WAF | 查询 WAF 配置 |
| `QueryAccessControlSwitch` | 读 | POST | `/ctapi/v1/scdn/domain/queryAccessControlAct` | 访问控制 | 查询访问控制开关状态 |
| `InsertAccessControl` | 写 | POST | `/ctapi/v1/scdn/domain/accessControlInsert` | 访问控制 | 新增访问控制规则 |
| `UpdateAccessControlSwitch` | 写 | POST | `/ctapi/v1/scdn/domain/updateAccessControlAct` | 访问控制 | 修改访问控制开关 |
| `QueryResourcePackages` | 读 | POST | `/ctapi/v1/accessone/purchase/queryResourcePackages` | 资源包 | 查询资源包 |
| `QueryIPv6NoSupLink` | 读 | POST | `/ctapi/v1/ipv6/checkResult/getNoSupLink` | IPv6 检测 | 查询不支持 IPv6 的链路 |

### 配置说明

实例配置（`config.schema.json`）：

| 键 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `ctyun_gateway` | string | `accessone-global.ctapi.ctyun.cn` | CTAPI 网关地址 |
| `gateway` | string | — | `ctyun_gateway` 别名 |
| `timeoutMs` | integer | `10000` | HTTP 超时（ms） |
| `skipTlsVerify` | boolean | `false` | 跳过 TLS 证书校验 |
| `tlsInsecureSkipVerify` | boolean | `false` | `skipTlsVerify` 兼容别名 |
| `insecureSkipVerify` | boolean | `false` | `skipTlsVerify` 兼容别名 |

密钥配置（`secret.schema.json`）：

| 键 | 类型 | 说明 |
|---|---|---|
| `ctyun_ak` | string | 天翼云 Access Key |
| `ctyun_sk` | string | 天翼云 Secret Key |
| `ak` | string | `ctyun_ak` 别名 |
| `sk` | string | `ctyun_sk` 别名 |

### 写接口参数说明

#### `InsertAccessControl`

| 参数 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `domains` | `[]string` | 是 | `1 <= len <= 50` | 域名列表 |
| `product_code` | `string` | 是 | 如 `020` | 产品代码 |
| `configs` | `[]Object` | 是 | `1 <= len <= 20` | 规则配置列表 |
| `configs[n].mod` | `string` | 是 | `ON` / `CLOSE` | 规则开关 |
| `configs[n].act` | `string` | 是 | `LOG` / `ACCEPT` / `BLOCK` / `DROP` / `CHECK` / `JUMP` / `JCJS` / `PIC` | 处置动作 |
| `configs[n].rule_name` | `string` | 是 | — | 规则名称 |
| `configs[n].rule_desc` | `string` | 否 | — | 规则描述 |
| `configs[n].jump_url` | `string` | 条件必填 | `act=JUMP` 时必填 | 跳转地址 |
| `configs[n].public_range` | `[]Object` | 是 | flat 输入数组，运行时折叠为厂商成功口径 `publicRange=[[...]]` | 匹配条件 |

`public_range` 输入示例：

```json
[
  {
    "zone": "IP",
    "equal": "TRUE",
    "public_content": "192.0.2.1"
  }
]
```

补充说明：
- `DENY` 是旧枚举，官方模型应使用 `BLOCK`；
- `OFF` 是旧枚举，官方模型应使用 `CLOSE`；
- 对外输入统一使用 flat `public_range[]`；service 运行时会折叠成厂商已验证成功的嵌套 `publicRange=[[{...}]]` 出站结构；
- `zone=HEADER/ARGS/GEO/FMT_TIME` 时需补充扩展字段，详见 `examples/insert-access-control.payload.example.md`。

#### `accessone-verify.mjs` 对 `InsertAccessControl` 的策略

| 模式 | 触发方式 | 行为 | 适用性 |
|---|---|---|---|
| 真实规则 | `--insert-payload-file <json>` | 从 JSON 文件读取完整规则请求体 | ✅ 推荐 |
| demo 规则 | `--demo-rule` | 使用内置 proof-only payload，固定写入 `IP = 192.0.2.1` 的演示规则 | ⚠️ 仅联调取证 |
| 裸跑 | 仅 `--rpc InsertAccessControl --allow-write` | 直接拒绝执行，避免误写默认规则 | ✅ 安全保护 |

推荐模板文件：

```bash
services/ctyun__accessone/examples/insert-access-control.payload.example.json
```

说明：
- 模板文件使用显式 `domains / product_code / configs / public_range` 结构，便于替换成真实业务规则；
- `services/ctyun__accessone/examples/insert-access-control.payload.example.json` 现在是“真实规则占位模板”，需要把业务域名、动作、匹配条件全部替换后再执行；
- 如需字段解释，可同时参考 `services/ctyun__accessone/examples/insert-access-control.payload.example.md`；
- 脚本读取模板时兼容 `snake_case` 与 `camelCase`；
- 如果只是想证明写接口打通，请显式加 `--demo-rule`，不要再裸跑 `InsertAccessControl`。

#### `UpdateAccessControlSwitch`

| 参数 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `domain` | `string` | 是 | — | 域名 |
| `product_code` | `string` | 是 | 如 `020` | 现场真机当前要求该字段；出站发送为 `productCode` |
| `mod` | `string` | 是 | `ON` / `CLOSE` | 目标开关状态 |

### 运行时说明

| 项目 | 说明 |
|---|---|
| 字段兼容 | 运行态统一兼容 ProtoJSON / SDK camelCase 字段，如 `productCode -> product_code`、`requestId -> request_id`、`publicRange -> public_range` |
| 超时控制 | 使用 `AbortController` / Node transport 显式处理，不依赖无效 fetch 扩展字段 |
| TLS fallback | `skipTlsVerify=true` 时切换到 `node:http` / `node:https` transport |
| 压缩响应 | Node transport 路径支持 `gzip` / `deflate` / `br` 解压 |
| 错误传播 | 已覆盖原始响应流错误与解压流错误两条路径 |

### 本地验证

```bash
cd /Users/lishengming/workspace/OctoBus/services
node --test ctyun__accessone/test/ctyun-accessone.test.js
RUN_INTEGRATION=1 node --test ctyun__accessone/test/ctyun-accessone.test.js
npm run validate -- --service-dir ctyun__accessone
```

验证结果：

| 项目 | 结果 |
|---|---|
| 默认单测 | ✅ `46 pass / 0 fail / 1 skip` |
| mock integration | ✅ `47 pass / 0 fail / 0 skip` |
| SDK 校验 | ✅ `npm run validate -- --service-dir ctyun__accessone` 通过 |
| 手工脚本语法 | ✅ `node --check services/scripts/accessone-verify.mjs` 通过 |
| 重点回归 | ✅ 覆盖 TLS fallback、压缩响应、原始响应流错误、解压流错误、camelCase 请求归一化、写接口回滚链路 |

说明：
- 默认 `1 skip` 为 mock integration 用例，需显式设置 `RUN_INTEGRATION=1` 开启。
- 已补充 `requestWithNodeTransport rejects on decompression stream error` 回归，覆盖 `stream !== res` 时解压流自身报错分支。

### 当前分支真实 OctoBus 联调记录（2026-06-27）

以下结果来自当前工作区代码经 `./bin/octobus --addr 127.0.0.1:19101 service import ... && instance restart accessone-test` 重载后的真实 gRPC 验证，不是历史遗留截图。

接入信息（脱敏）：

| 项目 | 内容 |
|---|---|
| daemon addr | `127.0.0.1:19101` |
| capset / instance | `esa-demo / accessone-test` |
| 厂商 | 天翼云 AccessOne（ESA） |
| 网关 | `accessone-global.ctapi.ctyun.cn` |
| 产品代码 | `020` |
| 测试域名 | `[REDACTED_DOMAIN]` |
| 写验证策略 | `InsertAccessControl` 写入演示规则 -> `UpdateAccessControlSwitch` 改为 `ON` -> 按原状态回滚到 `CLOSE` |
| 汇总文件 | `/Users/lishengming/workspace/OctoBus/.temp/octobus-accessone-manual-proof/results/20260627113511/summary.json` |

验证结果：

| 验证项 | 结果 |
|---|---|
| `QueryAccessControlSwitch` | ✅ `transport=200 business=100000`，初始状态 `mod=CLOSE` |
| `InsertAccessControl` | ✅ `transport=200 business=100000`，返回 `successIds=[644628]` |
| `UpdateAccessControlSwitch` | ✅ `transport=200 business=100000`，成功切到 `ON` |
| `UpdateAccessControlSwitchRestoreCurrent` | ✅ `transport=200 business=100000`，成功回滚到原状态 |
| `QueryAccessControlSwitchAfterRestore` | ✅ `transport=200 business=100000`，复查状态 `mod=CLOSE` |

结果文件：
- `/Users/lishengming/workspace/OctoBus/.temp/octobus-accessone-manual-proof/results/20260627113511/grpc-InsertAccessControl.json`
- `/Users/lishengming/workspace/OctoBus/.temp/octobus-accessone-manual-proof/results/20260627113511/grpc-UpdateAccessControlSwitch.json`
- `/Users/lishengming/workspace/OctoBus/.temp/octobus-accessone-manual-proof/results/20260627113511/grpc-UpdateAccessControlSwitchRestoreCurrent.json`
- `/Users/lishengming/workspace/OctoBus/.temp/octobus-accessone-manual-proof/results/20260627113511/grpc-QueryAccessControlSwitchAfterRestore.json`

### 公共 Connect/HTTP 直接调用示例（2026-06-27 实测）

以下示例不是项目内置验证脚本，而是外部调用方可直接复用的公共入口调用方式。调用路径固定为：

```text
POST /capsets/esa-demo/connect/accessone-test/Ctyun_AccessOne.Ctyun_AccessOne/{Method}
```

实际验证命令：

```bash
curl -sS -X POST http://127.0.0.1:19101/capsets/esa-demo/connect/accessone-test/Ctyun_AccessOne.Ctyun_AccessOne/QueryAccessControlSwitch \
  -H 'Content-Type: application/json' \
  -d '{"domain":"test-jzb.ctcdn.cn","productCode":"020"}'

curl -sS -X POST http://127.0.0.1:19101/capsets/esa-demo/connect/accessone-test/Ctyun_AccessOne.Ctyun_AccessOne/QueryServiceDetail \
  -H 'Content-Type: application/json' \
  -d '{"productCode":["020"]}'

curl -sS -X POST http://127.0.0.1:19101/capsets/esa-demo/connect/accessone-test/Ctyun_AccessOne.Ctyun_AccessOne/UpdateAccessControlSwitch \
  -H 'Content-Type: application/json' \
  -d '{"domain":"test-jzb.ctcdn.cn","productCode":"020","mod":"ON"}'
```

Connect 实测结果：

| 验证项 | 结果 |
|---|---|
| `QueryAccessControlSwitch` | ✅ `httpStatus=200`，内层 `code=100000`，返回 `mod=CLOSE` |
| `QueryServiceDetail` | ✅ `httpStatus=200`，内层 `statusCode=100000` |
| `QueryResourcePackages` | ✅ `httpStatus=200`，内层 `statusCode=100000` |
| `QueryDomainList` | ✅ `httpStatus=200`，内层 `statusCode=100000` |
| `QueryIPv6NoSupLink` | ⚠️ `httpStatus=200`，但示例 `requestId=1502` 返回业务错误 `100013`；说明 service 链路正常，失败原因是业务数据归属/状态不满足 |
| `InsertAccessControl` | ✅ `httpStatus=200`，内层 `code=100000`，最新 Connect 重试已成功返回 `successIds`；若后续再次命中配额/业务状态限制，仍属于厂商业务层反馈，不是 service package 调用失败 |
| `UpdateAccessControlSwitch` | ✅ `httpStatus=200`，内层 `code=100000`，可正常切换并恢复 |

说明：上方 gRPC 写验证成功与这里的 Connect 写验证成功，发生在不同时间点；两轮验证共同说明 service package 调用链路正常。若后续再次命中配额/业务状态限制，应按厂商现场状态单独判断。

Connect 手工验证原始结果目录：
- `/Users/lishengming/workspace/OctoBus/.temp/connect-manual-demo-20260627121741/`
- `/Users/lishengming/workspace/OctoBus/.temp/retry-insert-after-clean-20260628231452/20260628231452/`

补充说明：
- 请求体字段使用 ProtoJSON / camelCase，例如 `productCode`、`requestId`、`ruleName`、`publicRange`；
- OctoBus 外层统一返回 `{httpStatus, httpBody}`；真正的厂商业务结果在 `httpBody` 内层 JSON；
- access log 已记录本轮调用为 `protocol=connect`、`user_agent=curl/8.7.1`，可证明这是公共 service 边界调用，而非项目脚本代调。

### 联调验证日志实例（脱敏）

本次联调验证通过 OctoBus gRPC service 边界发起，以下为当前分支真实输出摘要。

代表性验证结果：

| 验证项 | 结果 |
|---|---|
| `QueryAccessControlSwitch` | ✅ `business_code=100000`，返回 `mod=CLOSE` |
| `InsertAccessControl` | ✅ `business_code=100000`，成功写入规则并返回 `successIds` |
| `UpdateAccessControlSwitch` | ✅ `business_code=100000`，切换成功 |
| `UpdateAccessControlSwitchRestoreCurrent` | ✅ `business_code=100000`，回滚成功 |
| `QueryAccessControlSwitchAfterRestore` | ✅ `business_code=100000`，状态恢复为 `CLOSE` |

service 侧日志示例：

```text
[Ctyun_AccessOne][request][inst=inst req=req] POST https://accessone-global.ctapi.ctyun.cn/ctapi/v1/scdn/domain/accessControlInsert
[Ctyun_AccessOne][response][inst=inst req=req] HTTP 200 (69B)
[Ctyun_AccessOne][request][inst=inst req=req] POST https://accessone-global.ctapi.ctyun.cn/ctapi/v1/scdn/domain/updateAccessControlAct
[Ctyun_AccessOne][response][inst=inst req=req] HTTP 200 (57B)
```

### 安全说明

| 项目 | 说明 |
|---|---|
| 凭据保护 | 代码、测试和文档中未提交真实 AK/SK、Token、Cookie、Authorization 头或私钥材料 |
| 日志脱敏 | 联调证据中的测试域名、规则名、规则 ID 已做脱敏处理 |
| TLS 选项 | `skipTlsVerify` 默认关闭，仅建议在可信网络环境下排障使用 |
| 数据暴露面 | 响应体按 `http_status + http_body` 透传，调用方应注意控制上游原始数据的落盘与展示范围 |

### 已知限制

| 限制 | 影响 | 原因 |
|---|---|---|
| GET 带参签名能力有限 | `QueryDomainList` 暂不扩展复杂 query 参数场景 | 天翼云 EOP GET query string 签名规范公开信息有限 |
| 单条规则删除/修改 | 暂不支持 `updateAccessControl` / `deleteAccessControl` | 当前 AK/SK 缺少 `accessControlConf` 子模块权限 |
| insert 规则数上限 | 现场域名可能受厂商侧规则配额/状态影响；当前分支最新 Connect 重试已成功写入，若后续再次命中上限应按现场状态单独判断 | 属于厂商业务状态限制，不是 transport 或 service package 调用方式问题 |
| IPv6 数据依赖 | 需已有真实检测任务的 `requestId` | 接口本身为查询接口，不负责创建检测任务 |
