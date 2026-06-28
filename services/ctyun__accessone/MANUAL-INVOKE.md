# AccessOne OctoBus service 手动调用指南

适用对象：需要在本地终端直接执行 JS 脚本，调用已封装好的 OctoBus `ctyun-accessone` service，并验证接口返回是否正常的操作者。

适用入口：
- 脚本：`node services/scripts/accessone-verify.mjs`
- 协议：推荐 `--protocol connect`
- 实例：默认 `esa-demo / accessone-test`

## 1. 前置条件

| 项目 | 要求 |
|---|---|
| 项目根目录 | `/Users/lishengming/workspace/OctoBus` |
| OctoBus daemon | `127.0.0.1:19101` 可访问 |
| service instance | `accessone-test` 处于 `running` |
| 凭据 | instance 已配置有效 `ctyun_ak` / `ctyun_sk` |
| 默认业务参数 | `domain=test-jzb.ctcdn.cn`，`product=020` |

先进入项目根目录：

```bash
cd /Users/lishengming/workspace/OctoBus
```

## 2. 最小自检

| 目的 | 命令 | 正常预期 |
|---|---|---|
| 脚本语法 | `node --check services/scripts/accessone-verify.mjs` | 无输出，退出码 0 |
| 查看支持的 case/group | `node services/scripts/accessone-verify.mjs --list-rpcs` | 打印 `smoke / reads / writes` 和全部 case |
| 检查实例状态 | `./bin/octobus --addr 127.0.0.1:19101 instance get accessone-test` | `Status: running` |

## 3. 推荐执行顺序

| 顺序 | 命令 | 目的 |
|---|---|---|
| 1 | `node services/scripts/accessone-verify.mjs --protocol connect --group smoke` | 最小链路冒烟 |
| 2 | `node services/scripts/accessone-verify.mjs --protocol connect --group reads` | 8 个读接口完整验证 |
| 3 | `node services/scripts/accessone-verify.mjs --protocol connect --group writes --allow-write --demo-rule --switch-mod ON --rule-name "$RULE_NAME"` | 写接口联调取证 |
| 4 | `./bin/octobus --addr 127.0.0.1:19101 logs --capset esa-demo --instance accessone-test --tail 20` | 证明请求确实经过 service 边界 |

## 4. 读接口批量验证

### 4.1 最小冒烟

```bash
node services/scripts/accessone-verify.mjs --protocol connect --group smoke
```

覆盖：
- `QueryDomainList`
- `QueryAccessControlSwitch`
- `QueryIPv6NoSupLink`

正常预期：
- 每条输出都出现 `transport_status  : 200`
- 通常应出现 `business_code     : 100000`

### 4.2 全量读接口

```bash
READ_OUT=".temp/manual-reads-$(date +%Y%m%d%H%M%S)" && \
node services/scripts/accessone-verify.mjs \
  --protocol connect \
  --group reads \
  --out-dir "$READ_OUT"
```

覆盖的 8 个读接口：
- `QueryDomainList`
- `QueryServiceDetail`
- `QueryDomainRuleAct`
- `QueryDomainRuleConfig`
- `QueryWafConfig`
- `QueryAccessControlSwitch`
- `QueryResourcePackages`
- `QueryIPv6NoSupLink`

正常预期：
- 8 条均出现 `transport_status  : 200`
- 8 条均出现 `business_code     : 100000`
- 最后输出 `summary_file: .../summary.json`

## 5. 单个 RPC 手工调用示例

### 5.1 QueryDomainList

```bash
node services/scripts/accessone-verify.mjs --protocol connect --rpc QueryDomainList
```

正常预期：
- `transport_status  : 200`
- `business_code     : 100000`

### 5.2 QueryServiceDetail

```bash
node services/scripts/accessone-verify.mjs --protocol connect --rpc QueryServiceDetail
```

### 5.3 QueryDomainRuleAct

```bash
node services/scripts/accessone-verify.mjs --protocol connect --rpc QueryDomainRuleAct
```

### 5.4 QueryDomainRuleConfig

```bash
node services/scripts/accessone-verify.mjs --protocol connect --rpc QueryDomainRuleConfig
```

### 5.5 QueryWafConfig

```bash
node services/scripts/accessone-verify.mjs --protocol connect --rpc QueryWafConfig
```

### 5.6 QueryAccessControlSwitch

```bash
node services/scripts/accessone-verify.mjs --protocol connect --rpc QueryAccessControlSwitch
```

正常预期：
- `transport_status  : 200`
- `business_code     : 100000`
- `inner_json.data.mod` 为 `ON` 或 `CLOSE`

### 5.7 QueryResourcePackages

```bash
node services/scripts/accessone-verify.mjs --protocol connect --rpc QueryResourcePackages
```

### 5.8 QueryIPv6NoSupLink

```bash
node services/scripts/accessone-verify.mjs --protocol connect --rpc QueryIPv6NoSupLink --request-id 20266
```

正常预期：
- 优先看 `transport_status  : 200`
- 若 `business_code != 100000`，说明 service 链路已通，但 `request_id` 对应业务数据不满足

## 6. 写接口验证（演示规则模式）

### 6.1 重要副作用说明

| 项目 | 说明 |
|---|---|
| `--demo-rule` | 会真实调用 `InsertAccessControl` 写入一条 proof-only 演示规则 |
| `UpdateAccessControlSwitch` | 会先切换为 `ON`，随后恢复原状态 |
| 自动回滚范围 | 仅恢复访问控制开关状态，不会自动删除新插入的演示规则 |
| 演示规则内容 | 固定为 `IP = 192.0.2.1`、`act = LOG` 的 proof-only payload |

### 6.2 单独开/关访问控制开关

适用场景：你只想下发“开启”或“关闭”访问控制开关，不想同时执行 `InsertAccessControl`。

开启访问控制开关：

```bash
node services/scripts/accessone-verify.mjs \
  --protocol connect \
  --rpc UpdateAccessControlSwitch \
  --allow-write \
  --switch-mod ON
```

关闭访问控制开关：

```bash
node services/scripts/accessone-verify.mjs \
  --protocol connect \
  --rpc UpdateAccessControlSwitch \
  --allow-write \
  --switch-mod CLOSE
```

正常预期：
- `transport_status  : 200`
- `business_code     : 100000`
- `inner_json.message` 为 `success`

建议执行顺序：
1. 先查当前状态：`QueryAccessControlSwitch`
2. 再执行 `ON` 或 `CLOSE`
3. 执行后再次查询，确认状态已变化

### 6.3 整组验证推荐命令

```bash
RULE_NAME="manual-proof-$(date +%Y%m%d-%H%M%S)" && \
WRITE_OUT=".temp/manual-writes-$(date +%Y%m%d%H%M%S)" && \
node services/scripts/accessone-verify.mjs \
  --protocol connect \
  --group writes \
  --allow-write \
  --demo-rule \
  --switch-mod ON \
  --rule-name "$RULE_NAME" \
  --out-dir "$WRITE_OUT"
```

该命令依次执行：
- `QueryAccessControlSwitch`
- `InsertAccessControl`
- `UpdateAccessControlSwitch`
- `UpdateAccessControlSwitchRestoreCurrent`
- `QueryAccessControlSwitchAfterRestore`

正常预期：
- `QueryAccessControlSwitch`：`200 / 100000`
- `InsertAccessControl`：`200 / 100000`
- `UpdateAccessControlSwitch`：`200 / 100000`
- `UpdateAccessControlSwitchRestoreCurrent`：`200 / 100000`
- `QueryAccessControlSwitchAfterRestore`：`200 / 100000` 且状态恢复

### 6.4 最新实测结果（2026-06-28）

当前环境在清理部分旧规则后，演示规则写入已再次成功：

| 验证项 | 结果 |
|---|---|
| `QueryAccessControlSwitch` | ✅ `transport=200 business=100000`，写前状态 `mod=CLOSE` |
| `InsertAccessControl` | ✅ `transport=200 business=100000`，返回 `successIds=[645264]` |
| `UpdateAccessControlSwitch` | ✅ `transport=200 business=100000`，切到 `ON` 成功 |
| `UpdateAccessControlSwitchRestoreCurrent` | ✅ `transport=200 business=100000`，恢复原状态成功 |
| `QueryAccessControlSwitchAfterRestore` | ✅ `transport=200 business=100000`，复查为 `mod=CLOSE` |

实测结果目录：

```text
/Users/lishengming/workspace/OctoBus/.temp/retry-insert-after-clean-20260628231452/20260628231452
```

## 7. 写接口验证（真实规则文件模式）

适用场景：你要验证的不是演示规则，而是真实业务规则。

模板文件：

```text
services/ctyun__accessone/examples/insert-access-control.payload.example.json
```

字段说明文档：

```text
services/ctyun__accessone/examples/insert-access-control.payload.example.md
```

执行命令：

```bash
node services/scripts/accessone-verify.mjs \
  --protocol connect \
  --rpc InsertAccessControl \
  --allow-write \
  --insert-payload-file services/ctyun__accessone/examples/insert-access-control.payload.example.json
```

执行前至少替换这些字段：
- `domains`
- `product_code`
- `configs[].rule_name`
- `configs[].act`
- `configs[].public_range`

注意：
- 模板是“真实规则占位模板”，不是演示 payload；
- 不要把 `DENY` / `OFF` / `items[]` 旧结构再写回去；
- 对外输入继续使用 flat `public_range[]`。

## 8. 结果判定标准

| 场景 | 判定标准 |
|---|---|
| 读接口成功 | `transport_status=200` 且 `business_code=100000` |
| 开关写接口成功 | `transport_status=200` 且 `business_code=100000`，并且恢复后复查状态正常 |
| Insert 写入成功 | `transport_status=200`、`business_code=100000`，且 `inner_json.data[].successIds` 非空 |
| 业务失败但链路正常 | `transport_status=200`，但内层业务状态提示配额/数据归属/业务校验失败 |
| service/协议失败 | `transport_status!=200` 或出现 `invalid_argument`、`serialization failure` 等协议侧错误 |

## 9. 日志取证

执行完任意命令后，可拉取 service 侧 access log：

```bash
./bin/octobus --addr 127.0.0.1:19101 logs --capset esa-demo --instance accessone-test --tail 20
```

正常预期能看到：
- `protocol":"connect"`
- `instance":"accessone-test"`
- `method":"Ctyun_AccessOne.Ctyun_AccessOne/..."`
- `http_status":200`
- `user_agent":"node"`

## 10. 常见问题

| 现象 | 含义 | 优先排查 |
|---|---|---|
| `transport_status != 200` | 协议边界/脚本请求形态有问题 | 先看实例状态、脚本参数、OctoBus log |
| `business_code != 100000` | 已到厂商业务层，但业务数据/权限/配额不满足 | 看 `inner_json` 里的详细提示 |
| `InsertAccessControl` 成功但留下规则 | 这是当前脚本设计使然 | 需要后续在控制台或其他接口手工清理 |
| `QueryIPv6NoSupLink` 业务失败 | 常见于 `request_id` 不匹配当前业务数据 | 更换有效 `request_id` 再测 |

## 11. 最短可复制执行清单

```bash
cd /Users/lishengming/workspace/OctoBus
node --check services/scripts/accessone-verify.mjs
node services/scripts/accessone-verify.mjs --list-rpcs
node services/scripts/accessone-verify.mjs --protocol connect --group reads
RULE_NAME="manual-proof-$(date +%Y%m%d-%H%M%S)" && node services/scripts/accessone-verify.mjs --protocol connect --group writes --allow-write --demo-rule --switch-mod ON --rule-name "$RULE_NAME"
./bin/octobus --addr 127.0.0.1:19101 logs --capset esa-demo --instance accessone-test --tail 20
```